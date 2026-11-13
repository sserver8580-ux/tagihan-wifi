// db.js - Database Handler menggunakan Node.js built-in SQLite (DatabaseSync)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Di Vercel Serverless, filesystem bersifat read-only kecuali folder /tmp
const isVercel = Boolean(process.env.VERCEL);
const dbPath = isVercel ? path.join('/tmp', 'database.sqlite') : path.join(__dirname, 'database.sqlite');

// Salin database awal ke /tmp jika di Vercel
if (isVercel && !fs.existsSync(dbPath)) {
  const localDb = path.join(__dirname, 'database.sqlite');
  if (fs.existsSync(localDb)) {
    try {
      fs.copyFileSync(localDb, dbPath);
    } catch (e) {}
  }
}

let db = null;
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(dbPath);
} catch (e) {
  console.warn('node:sqlite tidak tersedia, menggunakan fallback memory db:', e.message);
}

// Helper hash password dengan crypto bawaan
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, originalHash) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

// Inisialisasi skema tabel
function initDatabase() {
  // Aktifkan WAL mode untuk performa dan konkurensi optimal
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // 1. Tabel Pengaturan Sistem
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 2. Tabel Pengguna (Admin, Operator, Teknisi)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator', -- admin, operator, teknisi
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Tabel Paket Internet WiFi
  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      speed TEXT NOT NULL,
      price INTEGER NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Tabel Pelanggan
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT NOT NULL,
      package_id INTEGER REFERENCES packages(id),
      ip_address TEXT,
      pppoe_user TEXT,
      pppoe_password TEXT,
      installation_date TEXT,
      due_day INTEGER DEFAULT 10,
      status TEXT DEFAULT 'active', -- active, isolated, inactive
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Tabel Tagihan / Invoices
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      package_id INTEGER REFERENCES packages(id),
      package_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      discount INTEGER DEFAULT 0,
      fine INTEGER DEFAULT 0,
      total_amount INTEGER NOT NULL,
      period_month INTEGER NOT NULL,
      period_year INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT DEFAULT 'unpaid', -- unpaid, paid, cancelled
      payment_method TEXT,
      paid_at DATETIME,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 6. Tabel Pembayaran
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount_paid INTEGER NOT NULL,
      payment_method TEXT NOT NULL, -- Cash, Transfer BCA, Transfer Mandiri, QRIS, dll
      cashier_name TEXT NOT NULL,
      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
  `);

  // 7. Tabel Pengeluaran Operasional (Beban Internet, Perbaikan, Tiang, Listrik, dll)
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT,
      expense_date TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 8. Tabel Tiket Gangguan / Komplain Pelanggan
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      issue_type TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT DEFAULT 'normal', -- low, normal, high, urgent
      status TEXT DEFAULT 'open', -- open, in_progress, resolved, closed
      technician_notes TEXT,
      reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );
  `);

  // 9. Log Aktivitas
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Default Settings jika belum ada
  const defaultSettings = [
    ['app_name', 'Tagihan Wifi Proxy.net'],
    ['domain', 'https://Tagihan.wifi.my.id'],
    ['company_phone', '081234567890'],
    ['company_address', 'Jl. Jaringan Merdeka No. 88, Pusat Layanan Internet'],
    ['company_tagline', 'Koneksi Cepat, Tagihan Praktis & Transparan'],
    ['bank_account_1', 'BCA: 1234567890 a.n Proxy.net Official'],
    ['bank_account_2', 'Mandiri: 9876543210 a.n Proxy.net Official'],
    ['qris_info', 'Menerima pembayaran QRIS / All E-Wallet'],
    ['receipt_footer', 'Terima kasih atas kepercayaan Anda menggunakan layanan Tagihan Wifi Proxy.net.'],
    ['wa_template_bill', 'Halo Pelanggan Terhormat {nama},\n\nTagihan internet WiFi Anda periode {periode} telah diterbitkan dengan rincian:\n- No. Tagihan: {no_invoice}\n- Paket: {paket}\n- Total Tagihan: Rp {total}\n- Jatuh Tempo: {jatuh_tempo}\n\nSilakan melakukan pembayaran ke:\n{rekening}\n\nKonfirmasi pembayaran: {cs_phone}\nCek tagihan online: {domain}/portal\n\nTerima kasih,\n*Tagihan Wifi Proxy.net*'],
    ['wa_template_receipt', 'Halo {nama},\n\nPembayaran tagihan WiFi periode {periode} sebesar Rp {total} telah kami terima dan *LUNAS*.\nNo. Invoice: {no_invoice}\nMetode: {metode}\nTanggal: {tanggal}\n\nTerima kasih telah setia bersama *Tagihan Wifi Proxy.net*.'],
    ['mikrotik_host', '192.168.88.1'],
    ['mikrotik_port', '8728'],
    ['mikrotik_user', 'admin'],
    ['mikrotik_secret', 'proxy123']
  ];

  const checkSetting = db.prepare('SELECT key FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

  for (const [key, val] of defaultSettings) {
    if (!checkSetting.get(key)) {
      insertSetting.run(key, val);
    }
  }

  // Cek apakah ada admin default
  const checkAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!checkAdmin) {
    const { salt, hash } = hashPassword('admin123');
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, full_name, role, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('admin', hash, salt, 'Administrator Utama', 'admin', '081234567890');
  }

  // Cek apakah ada data paket default
  const checkPackages = db.prepare('SELECT COUNT(*) as count FROM packages').get();
  if (checkPackages.count === 0) {
    const insertPackage = db.prepare('INSERT INTO packages (name, speed, price, description) VALUES (?, ?, ?, ?)');
    insertPackage.run('Paket Hemat Rumah', '10 Mbps', 100000, 'Cocok untuk browsing santai dan media sosial keluarga kecil');
    insertPackage.run('Paket Keluarga Ceria', '20 Mbps', 150000, 'Streaming Full HD lancar dan game online bebas lag');
    insertPackage.run('Paket Bisnis & Gamer', '50 Mbps', 250000, 'Prioritas bandwidth tinggi untuk kantor, wfh, dan streamer');
    insertPackage.run('Paket Ultra Proxy Pro', '100 Mbps', 400000, 'Kecepatan tanpa batas untuk kebutuhan kapasitas besar');
  }

  // Cek data sampel pelanggan jika belum ada
  const checkCustomers = db.prepare('SELECT COUNT(*) as count FROM customers').get();
  if (checkCustomers.count === 0) {
    const insertCustomer = db.prepare(`
      INSERT INTO customers (customer_code, name, phone, email, address, package_id, ip_address, pppoe_user, pppoe_password, installation_date, due_day, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertCustomer.run('PXY-001', 'Budi Santoso', '081234567891', 'budi@gmail.com', 'Jl. Melati No. 12 RT 02/03', 2, '192.168.10.11', 'budi_pxy', 'budi123', '2026-01-10', 10, 'active', 'Router ZTE F609');
    insertCustomer.run('PXY-002', 'Siti Rahmawati', '081234567892', 'siti@gmail.com', 'Jl. Mawar No. 45 RT 01/02', 1, '192.168.10.12', 'siti_pxy', 'siti123', '2026-02-15', 15, 'active', 'Router Huawei HG8245H');
    insertCustomer.run('PXY-003', 'Hendra Wijaya', '081234567893', 'hendra@gmail.com', 'Ruko Sentra Bisnis Blok B-3', 3, '192.168.10.13', 'hendra_pxy', 'hendra123', '2026-03-01', 5, 'active', 'Router Mikrotik hEX');
    insertCustomer.run('PXY-004', 'Ahmad Dani', '081234567894', 'dani@gmail.com', 'Jl. Kenanga No. 8', 2, '192.168.10.14', 'dani_pxy', 'dani123', '2026-03-12', 10, 'isolated', 'Menunggak 1 bulan, status isolir');

    // Generate sampel invoice bulan ini (Nov 2026)
    const insertInvoice = db.prepare(`
      INSERT INTO invoices (invoice_number, customer_id, package_id, package_name, amount, discount, fine, total_amount, period_month, period_year, due_date, status, payment_method, paid_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertInvoice.run('INV/202611/PXY001', 1, 2, 'Paket Keluarga Ceria (20 Mbps)', 150000, 0, 0, 150000, 11, 2026, '2026-11-10', 'paid', 'Transfer BCA', '2026-11-08 09:30:00', 'Lunas tepat waktu');
    insertInvoice.run('INV/202611/PXY002', 2, 1, 'Paket Hemat Rumah (10 Mbps)', 100000, 0, 0, 100000, 11, 2026, '2026-11-15', 'unpaid', null, null, 'Jatuh tempo 15 Nov');
    insertInvoice.run('INV/202611/PXY003', 3, 3, 'Paket Bisnis & Gamer (50 Mbps)', 250000, 0, 0, 250000, 11, 2026, '2026-11-05', 'paid', 'QRIS', '2026-11-04 14:15:00', 'Lunas');
    insertInvoice.run('INV/202611/PXY004', 4, 2, 'Paket Keluarga Ceria (20 Mbps)', 150000, 0, 10000, 160000, 11, 2026, '2026-11-10', 'unpaid', null, null, 'Terlambat + denda Rp 10.000');

    // Catat pembayaran sampel
    db.prepare(`
      INSERT INTO payments (invoice_id, amount_paid, payment_method, cashier_name, payment_date, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(1, 150000, 'Transfer BCA', 'admin', '2026-11-08 09:30:00', 'Bukti transfer valid');

    db.prepare(`
      INSERT INTO payments (invoice_id, amount_paid, payment_method, cashier_name, payment_date, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(3, 250000, 'QRIS', 'admin', '2026-11-04 14:15:00', 'Auto QRIS Settlement');

    // Catat pengeluaran sampel
    db.prepare(`
      INSERT INTO expenses (category, amount, description, expense_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run('Bandwidth ISP Utama', 1200000, 'Langganan Dedicated Uplink 200 Mbps', '2026-11-01', 'admin');

    db.prepare(`
      INSERT INTO expenses (category, amount, description, expense_date, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run('Pemeliharaan Kabel FO', 150000, 'Penggantian dropcore putus di RW 02', '2026-11-05', 'admin');

    // Sampel tiket gangguan
    db.prepare(`
      INSERT INTO tickets (ticket_number, customer_id, issue_type, description, priority, status, technician_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('TCK-202611-001', 2, 'Lampu PON Merah', 'Lampu indikator modem LOS berkedip merah sejak pagi', 'high', 'open', 'Menunggu teknisi cek jalur ODP-03');
  }
}

// Inisialisasi DB saat modul dimuat
initDatabase();

module.exports = {
  db,
  hashPassword,
  verifyPassword
};

