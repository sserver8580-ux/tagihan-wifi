// server.js - Backend Web Server Tagihan Wifi Proxy.net
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');
const { db, hashPassword, verifyPassword } = require('./db.js');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'proxy-net-super-secret-key-2026-wifi';

// Helper Token HMAC (Stateless Auth)
function createToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// MIME Types untuk file statis
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Log Aktivitas Helper
function logActivity(userName, action, details) {
  try {
    db.prepare('INSERT INTO activity_logs (user_name, action, details) VALUES (?, ?, ?)').run(userName, action, details);
  } catch (err) {
    console.error('Log error:', err.message);
  }
}

// Helper parsing JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) { // max 5MB
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Format JSON tidak valid'));
      }
    });
    req.on('error', reject);
  });
}

// Response JSON Helper
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// Handler request utama
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  // Auth Middleware
  const authHeader = req.headers['authorization'];
  let currentUser = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    currentUser = verifyToken(token);
  }

  // --- API ROUTING ---
  if (pathname.startsWith('/api/')) {
    try {
      // 1. AUTH: Login
      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await parseJsonBody(req);
        const { username, password } = body;
        if (!username || !password) {
          return sendJson(res, 400, { success: false, message: 'Username dan password wajib diisi' });
        }

        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
          return sendJson(res, 401, { success: false, message: 'Username atau password salah' });
        }

        const token = createToken({
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role
        });

        logActivity(user.username, 'LOGIN', `User ${user.username} berhasil login`);

        return sendJson(res, 200, {
          success: true,
          message: 'Login berhasil',
          token,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role
          }
        });
      }

      // 2. AUTH: Me
      if (pathname === '/api/auth/me' && method === 'GET') {
        if (!currentUser) {
          return sendJson(res, 401, { success: false, message: 'Tidak terautentikasi' });
        }
        return sendJson(res, 200, { success: true, user: currentUser });
      }

      // 3. SETTINGS: Get Settings (Publik & Terotentikasi)
      if (pathname === '/api/settings' && method === 'GET') {
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        for (const row of rows) {
          settings[row.key] = row.value;
        }
        return sendJson(res, 200, { success: true, settings });
      }

      // 4. SETTINGS: Update Settings (Admin Only)
      if (pathname === '/api/settings' && method === 'PUT') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Hanya Admin yang dapat mengubah pengaturan' });
        }
        const body = await parseJsonBody(req);
        const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        for (const [key, val] of Object.entries(body)) {
          updateStmt.run(key, String(val));
        }
        logActivity(currentUser.username, 'UPDATE_SETTINGS', 'Mengubah konfigurasi sistem/perusahaan');
        return sendJson(res, 200, { success: true, message: 'Pengaturan berhasil disimpan' });
      }

      // 5. DASHBOARD: Statistik Lengkap
      if (pathname === '/api/dashboard/stats' && method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });

        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM customers').get().count;
        const activeCustomers = db.prepare("SELECT COUNT(*) as count FROM customers WHERE status = 'active'").get().count;
        const isolatedCustomers = db.prepare("SELECT COUNT(*) as count FROM customers WHERE status = 'isolated'").get().count;

        // Invoice stats bulan ini
        const monthlyInvoices = db.prepare(`
          SELECT 
            COUNT(*) as total_invoices,
            SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as total_paid,
            SUM(CASE WHEN status = 'unpaid' THEN total_amount ELSE 0 END) as total_unpaid,
            COUNT(CASE WHEN status = 'paid' THEN 1 END) as count_paid,
            COUNT(CASE WHEN status = 'unpaid' THEN 1 END) as count_unpaid
          FROM invoices 
          WHERE period_month = ? AND period_year = ?
        `).get(currentMonth, currentYear);

        // Pengeluaran bulan ini
        const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        const monthlyExpenses = db.prepare(`
          SELECT SUM(amount) as total FROM expenses WHERE expense_date LIKE ?
        `).get(`${monthStr}%`).total || 0;

        const income = monthlyInvoices.total_paid || 0;
        const netProfit = income - monthlyExpenses;

        // Data 6 bulan terakhir untuk chart
        const chartData = [];
        for (let i = 5; i >= 0; i--) {
          const d = new Date(currentYear, currentMonth - 1 - i, 1);
          const m = d.getMonth() + 1;
          const y = d.getFullYear();
          const label = d.toLocaleString('id-ID', { month: 'short', year: '2-digit' });

          const inc = db.prepare(`
            SELECT SUM(amount_paid) as total FROM payments WHERE payment_date LIKE ?
          `).get(`${y}-${String(m).padStart(2, '0')}%`).total || 0;

          const exp = db.prepare(`
            SELECT SUM(amount) as total FROM expenses WHERE expense_date LIKE ?
          `).get(`${y}-${String(m).padStart(2, '0')}%`).total || 0;

          chartData.push({ label, income: inc, expense: exp, net: inc - exp });
        }

        const recentPayments = db.prepare(`
          SELECT p.*, i.invoice_number, c.name as customer_name
          FROM payments p
          JOIN invoices i ON p.invoice_id = i.id
          JOIN customers c ON i.customer_id = c.id
          ORDER BY p.id DESC LIMIT 5
        `).all();

        const openTickets = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status != 'resolved' AND status != 'closed'").get().count;

        return sendJson(res, 200, {
          success: true,
          stats: {
            totalCustomers,
            activeCustomers,
            isolatedCustomers,
            monthlyPaid: income,
            monthlyUnpaid: monthlyInvoices.total_unpaid || 0,
            monthlyExpenses,
            netProfit,
            countPaid: monthlyInvoices.count_paid || 0,
            countUnpaid: monthlyInvoices.count_unpaid || 0,
            openTickets,
            chartData,
            recentPayments
          }
        });
      }

      // 6. CUSTOMERS: CRUD
      if (pathname === '/api/customers' && method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const { search, status, package_id } = parsedUrl.query;
        let query = `
          SELECT c.*, p.name as package_name, p.speed as package_speed, p.price as package_price
          FROM customers c
          LEFT JOIN packages p ON c.package_id = p.id
          WHERE 1=1
        `;
        const params = [];
        if (search) {
          query += ` AND (c.name LIKE ? OR c.customer_code LIKE ? OR c.phone LIKE ? OR c.address LIKE ? OR c.pppoe_user LIKE ?)`;
          const s = `%${search}%`;
          params.push(s, s, s, s, s);
        }
        if (status && status !== 'all') {
          query += ` AND c.status = ?`;
          params.push(status);
        }
        if (package_id) {
          query += ` AND c.package_id = ?`;
          params.push(package_id);
        }
        query += ` ORDER BY c.id DESC`;
        const customers = db.prepare(query).all(...params);
        return sendJson(res, 200, { success: true, customers });
      }

      if (pathname === '/api/customers' && method === 'POST') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const body = await parseJsonBody(req);
        let { customer_code, name, phone, email, address, package_id, ip_address, pppoe_user, pppoe_password, installation_date, due_day, status, notes } = body;

        if (!name || !phone || !address || !package_id) {
          return sendJson(res, 400, { success: false, message: 'Nama, No WhatsApp, Alamat, dan Paket wajib diisi' });
        }

        // Auto-generate code jika kosong
        if (!customer_code) {
          const last = db.prepare('SELECT id FROM customers ORDER BY id DESC LIMIT 1').get();
          const nextNum = (last ? last.id + 1 : 1);
          customer_code = `PXY-${String(nextNum).padStart(3, '0')}`;
        }

        const stmt = db.prepare(`
          INSERT INTO customers (customer_code, name, phone, email, address, package_id, ip_address, pppoe_user, pppoe_password, installation_date, due_day, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
          customer_code, name, phone, email || '', address, package_id,
          ip_address || '', pppoe_user || '', pppoe_password || '',
          installation_date || new Date().toISOString().slice(0, 10),
          due_day || 10, status || 'active', notes || ''
        );

        logActivity(currentUser.username, 'ADD_CUSTOMER', `Menambahkan pelanggan baru: ${name} (${customer_code})`);
        return sendJson(res, 201, { success: true, message: 'Pelanggan berhasil ditambahkan', id: result.lastInsertRowid });
      }

      if (pathname.match(/^\/api\/customers\/(\d+)$/) && method === 'PUT') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const id = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const { customer_code, name, phone, email, address, package_id, ip_address, pppoe_user, pppoe_password, installation_date, due_day, status, notes } = body;

        db.prepare(`
          UPDATE customers SET
            customer_code = ?, name = ?, phone = ?, email = ?, address = ?, package_id = ?,
            ip_address = ?, pppoe_user = ?, pppoe_password = ?, installation_date = ?,
            due_day = ?, status = ?, notes = ?
          WHERE id = ?
        `).run(
          customer_code, name, phone, email || '', address, package_id,
          ip_address || '', pppoe_user || '', pppoe_password || '',
          installation_date, due_day, status, notes || '', id
        );

        logActivity(currentUser.username, 'UPDATE_CUSTOMER', `Memperbarui data pelanggan ID #${id} (${name})`);
        return sendJson(res, 200, { success: true, message: 'Data pelanggan berhasil diperbarui' });
      }

      if (pathname.match(/^\/api\/customers\/(\d+)$/) && method === 'DELETE') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Hanya Admin yang dapat menghapus pelanggan' });
        }
        const id = pathname.split('/')[3];
        const cust = db.prepare('SELECT name, customer_code FROM customers WHERE id = ?').get(id);
        db.prepare('DELETE FROM customers WHERE id = ?').run(id);
        logActivity(currentUser.username, 'DELETE_CUSTOMER', `Menghapus pelanggan ${cust ? cust.name : id}`);
        return sendJson(res, 200, { success: true, message: 'Pelanggan berhasil dihapus' });
      }

      if (pathname.match(/^\/api\/customers\/(\d+)\/toggle-status$/) && method === 'POST') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const id = pathname.split('/')[3];
        const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
        if (!cust) return sendJson(res, 404, { success: false, message: 'Pelanggan tidak ditemukan' });

        const newStatus = cust.status === 'active' ? 'isolated' : 'active';
        db.prepare('UPDATE customers SET status = ? WHERE id = ?').run(newStatus, id);
        logActivity(currentUser.username, 'STATUS_CHANGE', `Mengubah status ${cust.name} menjadi ${newStatus}`);
        return sendJson(res, 200, { success: true, message: `Status diubah menjadi ${newStatus}`, status: newStatus });
      }

      // 7. PACKAGES: CRUD
      if (pathname === '/api/packages' && method === 'GET') {
        const packages = db.prepare('SELECT * FROM packages ORDER BY price ASC').all();
        return sendJson(res, 200, { success: true, packages });
      }

      if (pathname === '/api/packages' && method === 'POST') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const body = await parseJsonBody(req);
        const { name, speed, price, description } = body;
        if (!name || !speed || !price) {
          return sendJson(res, 400, { success: false, message: 'Nama paket, kecepatan, dan harga wajib diisi' });
        }
        const result = db.prepare('INSERT INTO packages (name, speed, price, description) VALUES (?, ?, ?, ?)').run(name, speed, price, description || '');
        logActivity(currentUser.username, 'ADD_PACKAGE', `Membuat paket internet: ${name} (${speed})`);
        return sendJson(res, 201, { success: true, message: 'Paket berhasil ditambahkan', id: result.lastInsertRowid });
      }

      if (pathname.match(/^\/api\/packages\/(\d+)$/) && method === 'PUT') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const id = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const { name, speed, price, description } = body;
        db.prepare('UPDATE packages SET name = ?, speed = ?, price = ?, description = ? WHERE id = ?').run(name, speed, price, description || '', id);
        logActivity(currentUser.username, 'UPDATE_PACKAGE', `Mengubah paket internet ID #${id}`);
        return sendJson(res, 200, { success: true, message: 'Paket berhasil diperbarui' });
      }

      if (pathname.match(/^\/api\/packages\/(\d+)$/) && method === 'DELETE') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Hanya Admin yang dapat menghapus paket' });
        }
        const id = pathname.split('/')[3];
        // Cek apakah paket masih dipakai pelanggan
        const inUse = db.prepare('SELECT COUNT(*) as count FROM customers WHERE package_id = ?').get(id).count;
        if (inUse > 0) {
          return sendJson(res, 400, { success: false, message: `Paket tidak dapat dihapus karena masih digunakan oleh ${inUse} pelanggan` });
        }
        db.prepare('DELETE FROM packages WHERE id = ?').run(id);
        logActivity(currentUser.username, 'DELETE_PACKAGE', `Menghapus paket ID #${id}`);
        return sendJson(res, 200, { success: true, message: 'Paket berhasil dihapus' });
      }

      // 8. INVOICES: List, Create, Generate Bulanan, Pay
      if (pathname === '/api/invoices' && method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const { month, year, status, search, customer_id } = parsedUrl.query;
        let query = `
          SELECT i.*, c.name as customer_name, c.customer_code, c.phone as customer_phone, c.address as customer_address
          FROM invoices i
          JOIN customers c ON i.customer_id = c.id
          WHERE 1=1
        `;
        const params = [];
        if (month) {
          query += ` AND i.period_month = ?`;
          params.push(month);
        }
        if (year) {
          query += ` AND i.period_year = ?`;
          params.push(year);
        }
        if (status && status !== 'all') {
          query += ` AND i.status = ?`;
          params.push(status);
        }
        if (customer_id) {
          query += ` AND i.customer_id = ?`;
          params.push(customer_id);
        }
        if (search) {
          query += ` AND (i.invoice_number LIKE ? OR c.name LIKE ? OR c.customer_code LIKE ? OR c.phone LIKE ?)`;
          const s = `%${search}%`;
          params.push(s, s, s, s);
        }
        query += ` ORDER BY i.id DESC`;
        const invoices = db.prepare(query).all(...params);
        return sendJson(res, 200, { success: true, invoices });
      }

      // Generate Otomatis Tagihan Bulanan untuk Semua Pelanggan Aktif
      if (pathname === '/api/invoices/generate-monthly' && method === 'POST') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const body = await parseJsonBody(req);
        const now = new Date();
        const month = parseInt(body.month) || (now.getMonth() + 1);
        const year = parseInt(body.year) || now.getFullYear();

        // Ambil pelanggan aktif / isolir yang punya paket
        const customers = db.prepare(`
          SELECT c.*, p.name as pkg_name, p.speed as pkg_speed, p.price as pkg_price
          FROM customers c
          JOIN packages p ON c.package_id = p.id
          WHERE c.status != 'inactive'
        `).all();

        let generatedCount = 0;
        let skippedCount = 0;

        const checkInvoice = db.prepare('SELECT id FROM invoices WHERE customer_id = ? AND period_month = ? AND period_year = ?');
        const insertInvoice = db.prepare(`
          INSERT INTO invoices (invoice_number, customer_id, package_id, package_name, amount, discount, fine, total_amount, period_month, period_year, due_date, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const cust of customers) {
          const exists = checkInvoice.get(cust.id, month, year);
          if (exists) {
            skippedCount++;
            continue;
          }

          const dueDay = cust.due_day || 10;
          const dueDayFormatted = String(dueDay).padStart(2, '0');
          const monthFormatted = String(month).padStart(2, '0');
          const dueDate = `${year}-${monthFormatted}-${dueDayFormatted}`;
          const cleanCode = cust.customer_code.replace(/[^a-zA-Z0-9]/g, '');
          const invNumber = `INV/${year}${monthFormatted}/${cleanCode}`;
          const packageName = `${cust.pkg_name} (${cust.pkg_speed})`;
          const amount = cust.pkg_price;
          const totalAmount = amount;

          insertInvoice.run(
            invNumber, cust.id, cust.package_id, packageName, amount, 0, 0,
            totalAmount, month, year, dueDate, 'unpaid', `Tagihan Bulanan ${month}/${year}`
          );
          generatedCount++;
        }

        logActivity(currentUser.username, 'GENERATE_INVOICES', `Generate ${generatedCount} tagihan untuk periode ${month}/${year} (${skippedCount} dilewati)`);
        return sendJson(res, 200, {
          success: true,
          message: `Berhasil menerbitkan ${generatedCount} tagihan baru untuk periode ${month}/${year}. (${skippedCount} sudah ada sebelumnya)`,
          generatedCount,
          skippedCount
        });
      }

      // Buat invoice manual tunggal
      if (pathname === '/api/invoices' && method === 'POST') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const body = await parseJsonBody(req);
        const { customer_id, package_id, amount, discount, fine, period_month, period_year, due_date, notes } = body;

        const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
        if (!cust) return sendJson(res, 404, { success: false, message: 'Pelanggan tidak ditemukan' });

        const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(package_id || cust.package_id);
        const pkgName = pkg ? `${pkg.name} (${pkg.speed})` : 'Paket Internet';
        const finalAmount = parseInt(amount) || (pkg ? pkg.price : 0);
        const disc = parseInt(discount) || 0;
        const fn = parseInt(fine) || 0;
        const total = finalAmount - disc + fn;

        const cleanCode = cust.customer_code.replace(/[^a-zA-Z0-9]/g, '');
        const randomSuffix = Math.floor(100 + Math.random() * 900);
        const invNumber = `INV/${period_year}${String(period_month).padStart(2, '0')}/${cleanCode}-${randomSuffix}`;

        const result = db.prepare(`
          INSERT INTO invoices (invoice_number, customer_id, package_id, package_name, amount, discount, fine, total_amount, period_month, period_year, due_date, status, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          invNumber, cust.id, pkg ? pkg.id : null, pkgName, finalAmount, disc, fn,
          total, period_month, period_year, due_date, 'unpaid', notes || ''
        );

        logActivity(currentUser.username, 'CREATE_INVOICE', `Membuat invoice manual ${invNumber} untuk ${cust.name}`);
        return sendJson(res, 201, { success: true, message: 'Tagihan berhasil dibuat', id: result.lastInsertRowid, invoice_number: invNumber });
      }

      // Bayar Tagihan (Konfirmasi Lunas)
      if (pathname.match(/^\/api\/invoices\/(\d+)\/pay$/) && method === 'POST') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const invoiceId = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const { payment_method, notes } = body;

        const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
        if (!inv) return sendJson(res, 404, { success: false, message: 'Tagihan tidak ditemukan' });
        if (inv.status === 'paid') return sendJson(res, 400, { success: false, message: 'Tagihan ini sudah berstatus LUNAS' });

        const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const methodUsed = payment_method || 'Cash / Tunai';

        // 1. Update invoice
        db.prepare(`
          UPDATE invoices SET status = 'paid', payment_method = ?, paid_at = ?, notes = ?
          WHERE id = ?
        `).run(methodUsed, nowStr, notes || 'Lunas', invoiceId);

        // 2. Insert payment record
        db.prepare(`
          INSERT INTO payments (invoice_id, amount_paid, payment_method, cashier_name, payment_date, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(invoiceId, inv.total_amount, methodUsed, currentUser.full_name || currentUser.username, nowStr, notes || '');

        // 3. Jika pelanggan sebelumnya diisolir, otomatis aktifkan kembali
        const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(inv.customer_id);
        if (cust && cust.status === 'isolated') {
          db.prepare("UPDATE customers SET status = 'active' WHERE id = ?").run(cust.id);
          logActivity('SYSTEM', 'AUTO_UNISOLATE', `Pelanggan ${cust.name} otomatis diaktifkan kembali setelah pelunasan`);
        }

        logActivity(currentUser.username, 'PAYMENT', `Menerima pembayaran invoice ${inv.invoice_number} senilai Rp ${inv.total_amount.toLocaleString('id-ID')}`);
        return sendJson(res, 200, { success: true, message: 'Pembayaran berhasil dicatat & status tagihan LUNAS' });
      }

      // Hapus / Batalkan Invoice
      if (pathname.match(/^\/api\/invoices\/(\d+)$/) && method === 'DELETE') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Hanya Admin yang dapat membatalkan/menghapus tagihan' });
        }
        const invoiceId = pathname.split('/')[3];
        const inv = db.prepare('SELECT invoice_number FROM invoices WHERE id = ?').get(invoiceId);
        db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
        logActivity(currentUser.username, 'DELETE_INVOICE', `Menghapus tagihan ${inv ? inv.invoice_number : invoiceId}`);
        return sendJson(res, 200, { success: true, message: 'Tagihan berhasil dihapus' });
      }

      // Detail Print Struk Thermal / Nota Invoice
      if (pathname.match(/^\/api\/invoices\/(\d+)\/print$/) && method === 'GET') {
        const invoiceId = pathname.split('/')[3];
        const invoice = db.prepare(`
          SELECT i.*, c.name as customer_name, c.customer_code, c.phone as customer_phone, c.address as customer_address, c.pppoe_user
          FROM invoices i
          JOIN customers c ON i.customer_id = c.id
          WHERE i.id = ?
        `).get(invoiceId);

        if (!invoice) return sendJson(res, 404, { success: false, message: 'Tagihan tidak ditemukan' });

        const settingsRows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        for (const s of settingsRows) settings[s.key] = s.value;

        return sendJson(res, 200, { success: true, invoice, settings });
      }

      // 9. PUBLIC PORTAL: Cek Tagihan Mandiri Pelanggan
      if (pathname === '/api/public/check-bill' && method === 'GET') {
        const { query } = parsedUrl.query;
        if (!query || query.trim() === '') {
          return sendJson(res, 400, { success: false, message: 'Silakan masukkan Kode Pelanggan atau Nomor WhatsApp Anda' });
        }

        const cleanQuery = query.trim();
        // Cari pelanggan berdasarkan customer_code atau nomor phone
        const customer = db.prepare(`
          SELECT c.*, p.name as package_name, p.speed as package_speed, p.price as package_price
          FROM customers c
          LEFT JOIN packages p ON c.package_id = p.id
          WHERE c.customer_code LIKE ? OR c.phone LIKE ?
        `).get(`%${cleanQuery}%`, `%${cleanQuery}%`);

        if (!customer) {
          return sendJson(res, 404, { success: false, message: 'Data pelanggan tidak ditemukan. Pastikan Kode Pelanggan atau Nomor WhatsApp sudah sesuai.' });
        }

        // Ambil semua tagihan pelanggan (unpaid di atas, lalu paid)
        const invoices = db.prepare(`
          SELECT * FROM invoices
          WHERE customer_id = ?
          ORDER BY CASE WHEN status = 'unpaid' THEN 0 ELSE 1 END, id DESC
        `).all(customer.id);

        const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('app_name', 'domain', 'company_phone', 'bank_account_1', 'bank_account_2', 'qris_info')").all();
        const settings = {};
        for (const s of settingsRows) settings[s.key] = s.value;

        return sendJson(res, 200, {
          success: true,
          customer: {
            customer_code: customer.customer_code,
            name: customer.name,
            phone: customer.phone,
            address: customer.address,
            package_name: customer.package_name,
            package_speed: customer.package_speed,
            package_price: customer.package_price,
            status: customer.status,
            due_day: customer.due_day
          },
          invoices,
          settings
        });
      }

      // 10. PUBLIC PORTAL: Buat Laporan Pengaduan / Tiket
      if (pathname === '/api/public/submit-ticket' && method === 'POST') {
        const body = await parseJsonBody(req);
        const { customer_identifier, issue_type, description } = body;

        if (!customer_identifier || !issue_type || !description) {
          return sendJson(res, 400, { success: false, message: 'Semua bidang wajib diisi' });
        }

        const cust = db.prepare(`
          SELECT id, name, customer_code FROM customers WHERE customer_code = ? OR phone = ?
        `).get(customer_identifier.trim(), customer_identifier.trim());

        if (!cust) {
          return sendJson(res, 404, { success: false, message: 'ID Pelanggan / Nomor HP tidak ditemukan' });
        }

        const ticketNum = `TCK-${Date.now().toString().slice(-6)}`;
        db.prepare(`
          INSERT INTO tickets (ticket_number, customer_id, issue_type, description, priority, status)
          VALUES (?, ?, ?, ?, 'normal', 'open')
        `).run(ticketNum, cust.id, issue_type, description);

        logActivity('PORTAL', 'NEW_TICKET', `Tiket ${ticketNum} dibuat oleh ${cust.name}`);
        return sendJson(res, 201, {
          success: true,
          message: 'Laporan pengaduan berhasil dikirim. Teknisi kami akan segera memprosesnya.',
          ticket_number: ticketNum
        });
      }

      // 11. EXPENSES & FINANCE: CRUD
      if (pathname === '/api/expenses' && method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const { month, year } = parsedUrl.query;
        let query = 'SELECT * FROM expenses WHERE 1=1';
        const params = [];
        if (month && year) {
          query += ' AND expense_date LIKE ?';
          params.push(`${year}-${String(month).padStart(2, '0')}%`);
        }
        query += ' ORDER BY expense_date DESC, id DESC';
        const expenses = db.prepare(query).all(...params);
        return sendJson(res, 200, { success: true, expenses });
      }

      if (pathname === '/api/expenses' && method === 'POST') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const body = await parseJsonBody(req);
        const { category, amount, description, expense_date } = body;
        if (!category || !amount || !expense_date) {
          return sendJson(res, 400, { success: false, message: 'Kategori, jumlah, dan tanggal pengeluaran wajib diisi' });
        }
        const result = db.prepare(`
          INSERT INTO expenses (category, amount, description, expense_date, created_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(category, amount, description || '', expense_date, currentUser.full_name || currentUser.username);

        logActivity(currentUser.username, 'ADD_EXPENSE', `Mencatat pengeluaran: ${category} Rp ${parseInt(amount).toLocaleString('id-ID')}`);
        return sendJson(res, 201, { success: true, message: 'Pengeluaran berhasil dicatat', id: result.lastInsertRowid });
      }

      if (pathname.match(/^\/api\/expenses\/(\d+)$/) && method === 'DELETE') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Hanya Admin yang dapat menghapus pengeluaran' });
        }
        const id = pathname.split('/')[3];
        db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
        logActivity(currentUser.username, 'DELETE_EXPENSE', `Menghapus pengeluaran ID #${id}`);
        return sendJson(res, 200, { success: true, message: 'Pengeluaran berhasil dihapus' });
      }

      // 12. TICKETS: List & Update
      if (pathname === '/api/tickets' && method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const tickets = db.prepare(`
          SELECT t.*, c.name as customer_name, c.customer_code, c.phone as customer_phone, c.address as customer_address
          FROM tickets t
          JOIN customers c ON t.customer_id = c.id
          ORDER BY CASE WHEN t.status = 'open' THEN 0 WHEN t.status = 'in_progress' THEN 1 ELSE 2 END, t.id DESC
        `).all();
        return sendJson(res, 200, { success: true, tickets });
      }

      if (pathname.match(/^\/api\/tickets\/(\d+)$/) && method === 'PUT') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });
        const id = pathname.split('/')[3];
        const body = await parseJsonBody(req);
        const { status, technician_notes, priority } = body;
        const nowResolved = (status === 'resolved' || status === 'closed') ? new Date().toISOString().replace('T', ' ').substring(0, 19) : null;

        db.prepare(`
          UPDATE tickets SET
            status = COALESCE(?, status),
            technician_notes = COALESCE(?, technician_notes),
            priority = COALESCE(?, priority),
            resolved_at = CASE WHEN ? IS NOT NULL THEN ? ELSE resolved_at END
          WHERE id = ?
        `).run(status, technician_notes, priority, nowResolved, nowResolved, id);

        logActivity(currentUser.username, 'UPDATE_TICKET', `Memperbarui tiket #${id} (Status: ${status})`);
        return sendJson(res, 200, { success: true, message: 'Status tiket berhasil diperbarui' });
      }

      // 13. USERS: List, Create, Update, Delete
      if (pathname === '/api/users' && method === 'GET') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Hanya Admin yang dapat melihat pengguna' });
        }
        const users = db.prepare('SELECT id, username, full_name, role, phone, created_at FROM users ORDER BY id ASC').all();
        return sendJson(res, 200, { success: true, users });
      }

      if (pathname === '/api/users' && method === 'POST') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Hanya Admin yang dapat menambah pengguna' });
        }
        const body = await parseJsonBody(req);
        const { username, password, full_name, role, phone } = body;
        if (!username || !password || !full_name) {
          return sendJson(res, 400, { success: false, message: 'Username, password, dan nama lengkap wajib diisi' });
        }

        const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (exists) {
          return sendJson(res, 400, { success: false, message: 'Username sudah digunakan' });
        }

        const { salt, hash } = hashPassword(password);
        const result = db.prepare(`
          INSERT INTO users (username, password_hash, salt, full_name, role, phone)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(username, hash, salt, full_name, role || 'operator', phone || '');

        logActivity(currentUser.username, 'ADD_USER', `Menambahkan pengguna: ${username} (${role})`);
        return sendJson(res, 201, { success: true, message: 'Pengguna berhasil ditambahkan', id: result.lastInsertRowid });
      }

      if (pathname.match(/^\/api\/users\/(\d+)$/) && method === 'DELETE') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Akses ditolak' });
        }
        const id = pathname.split('/')[3];
        if (parseInt(id) === currentUser.id) {
          return sendJson(res, 400, { success: false, message: 'Tidak dapat menghapus akun Anda sendiri' });
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        logActivity(currentUser.username, 'DELETE_USER', `Menghapus pengguna ID #${id}`);
        return sendJson(res, 200, { success: true, message: 'Pengguna berhasil dihapus' });
      }

      // 14. MIKROTIK SCRIPT GENERATOR (Otomatisasi Isolir & Buka Isolir)
      if (pathname === '/api/mikrotik/generate-script' && method === 'GET') {
        if (!currentUser) return sendJson(res, 401, { success: false, message: 'Akses ditolak' });

        const isolated = db.prepare("SELECT * FROM customers WHERE status = 'isolated'").all();
        const active = db.prepare("SELECT * FROM customers WHERE status = 'active'").all();

        let isolateScript = '# ====================================================\n';
        isolateScript += '# SCRIPT ISOLIR OTOMATIS - Tagihan Wifi Proxy.net\n';
        isolateScript += '# Jalankan di Mikrotik RouterOS Terminal (Winbox)\n';
        isolateScript += '# ====================================================\n\n';
        isolateScript += '/ip firewall address-list\n';

        for (const cust of isolated) {
          if (cust.ip_address) {
            isolateScript += `add list=ISOLIR_TAGIHAN address=${cust.ip_address} comment="${cust.customer_code} - ${cust.name} (Tunggakan Tagihan)"\n`;
          }
          if (cust.pppoe_user) {
            isolateScript += `/ppp secret set [find name="${cust.pppoe_user}"] profile=ISOLIR-PROFILE comment="TERISOLIR"\n`;
          }
        }

        let restoreScript = '# ====================================================\n';
        restoreScript += '# SCRIPT BUKA ISOLIR SEMUA PELANGGAN AKTIF\n';
        restoreScript += '# ====================================================\n\n';
        for (const cust of active) {
          if (cust.ip_address) {
            restoreScript += `/ip firewall address-list remove [find address="${cust.ip_address}" and list=ISOLIR_TAGIHAN]\n`;
          }
          if (cust.pppoe_user) {
            restoreScript += `/ppp secret set [find name="${cust.pppoe_user}"] profile=default comment="AKTIF"\n`;
          }
        }

        return sendJson(res, 200, {
          success: true,
          total_isolated: isolated.length,
          total_active: active.length,
          isolateScript,
          restoreScript
        });
      }

      // 15. BACKUP & EXPORT
      if (pathname === '/api/backup/export-json' && method === 'GET') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Hanya Admin yang dapat mengunduh backup' });
        }

        const data = {
          export_date: new Date().toISOString(),
          settings: db.prepare('SELECT * FROM settings').all(),
          packages: db.prepare('SELECT * FROM packages').all(),
          customers: db.prepare('SELECT * FROM customers').all(),
          invoices: db.prepare('SELECT * FROM invoices').all(),
          payments: db.prepare('SELECT * FROM payments').all(),
          expenses: db.prepare('SELECT * FROM expenses').all(),
          tickets: db.prepare('SELECT * FROM tickets').all()
        };

        const jsonStr = JSON.stringify(data, null, 2);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="backup-tagihan-wifi-proxynet-${new Date().toISOString().slice(0, 10)}.json"`
        });
        return res.end(jsonStr);
      }

      // 16. ACTIVITY LOGS
      if (pathname === '/api/logs' && method === 'GET') {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendJson(res, 403, { success: false, message: 'Akses ditolak' });
        }
        const logs = db.prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 50').all();
        return sendJson(res, 200, { success: true, logs });
      }

      // Route API tidak ditemukan
      return sendJson(res, 404, { success: false, message: 'Endpoint API tidak ditemukan' });

    } catch (apiErr) {
      console.error('API Error:', apiErr);
      return sendJson(res, 500, { success: false, message: 'Terjadi kesalahan server internal: ' + apiErr.message });
    }
  }

  // --- STATIC FILE SERVING ---
  try {
    let filePath = '';
    if (pathname === '/' || pathname === '/login' || pathname === '/admin') {
      filePath = path.join(__dirname, 'public', 'index.html');
    } else if (pathname === '/portal' || pathname === '/cek-tagihan' || pathname === '/cek') {
      filePath = path.join(__dirname, 'public', 'portal.html');
    } else {
      filePath = path.join(__dirname, 'public', pathname);
    }

    // Hindari directory traversal
    const safePath = path.normalize(filePath);
    if (!safePath.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403);
      return res.end('Access Denied');
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      return fs.createReadStream(safePath).pipe(res);
    } else {
      // Fallback ke index.html untuk SPA
      const indexPath = path.join(__dirname, 'public', 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        return fs.createReadStream(indexPath).pipe(res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }
  } catch (fsErr) {
    res.writeHead(500);
    return res.end('Server Error: ' + fsErr.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Aplikasi Tagihan Wifi Proxy.net Berhasil Berjalan!`);
  console.log(`📡 URL Lokal:   http://localhost:${PORT}`);
  console.log(`🌐 Domain Target: https://Tagihan.wifi.my.id`);
  console.log(`🔑 Login Admin Default:`);
  console.log(`   Username: admin`);
  console.log(`   Password: admin123`);
  console.log(`=======================================================`);
});

