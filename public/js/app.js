// public/js/app.js - Logika Frontend Tagihan Wifi Proxy.net
let currentUser = null;
let currentSettings = {};
let cachedPackages = [];

// Helper Toast Notification
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'danger' ? '❌' : '⚠️'}</span>
    <div>${message}</div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Format Rupiah
function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(number);
}

// API Fetch Helper
async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers
  };

  try {
    const res = await fetch(endpoint, { credentials: 'omit', ...options, headers });
    if (res.status === 401 && endpoint !== '/api/auth/login') {
      localStorage.removeItem('token');
      showLoginView();
      throw new Error('Sesi telah berakhir, silakan login kembali');
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Terjadi kesalahan sistem');
    }
    return data;
  } catch (err) {
    showToast(err.message, 'danger');
    throw err;
  }
}

// PWA (Progressive Web App) Support
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
});

function installPWA() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') {
        showToast('Aplikasi berhasil dipasang di layar HP!', 'success');
      }
      deferredPrompt = null;
      const banner = document.getElementById('pwa-install-banner');
      if (banner) banner.style.display = 'none';
    });
  } else {
    // Tampilkan panduan pemasangan yang sangat jelas
    openModal('modal-install-guide');
  }
}

// Inisialisasi Saat Load
document.addEventListener('DOMContentLoaded', async () => {
  // Registrasi Service Worker PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Cek apakah sudah dalam mode aplikasi standalone di HP
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (!isStandalone) {
    // Tampilkan banner di dalam aplikasi jika dibuka di browser biasa
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'flex';
  } else {
    const loginBanner = document.getElementById('login-pwa-banner');
    if (loginBanner) loginBanner.style.display = 'none';
  }

  initMonthDropdowns();
  const token = localStorage.getItem('token');
  if (token) {
    try {
      const res = await apiFetch('/api/auth/me');
      currentUser = res.user;
      showAppLayout();
      await loadInitialData();
    } catch (e) {
      showLoginView();
    }
  } else {
    showLoginView();
  }
});

function showLoginView() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('app-layout').style.display = 'none';
}

function showAppLayout() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('app-layout').style.display = 'flex';

  document.getElementById('user-display-name').innerText = currentUser.full_name || currentUser.username;
  document.getElementById('user-display-role').innerText = currentUser.role.toUpperCase();
  document.getElementById('user-avatar-text').innerText = (currentUser.full_name || currentUser.username).charAt(0).toUpperCase();

  // Batasi menu untuk operator/teknisi
  if (currentUser.role !== 'admin') {
    const userNav = document.getElementById('nav-users');
    if (userNav) userNav.style.display = 'none';
  }
}

async function loadInitialData() {
  await loadSettings();
  await loadPackages();
  await loadDashboard();
}

// 1. AUTH LOGIN & LOGOUT
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    localStorage.setItem('token', res.token);
    currentUser = res.user;
    showToast('Selamat datang, ' + res.user.full_name, 'success');
    showAppLayout();
    await loadInitialData();
  } catch (err) {
    // Error ditangani apiFetch
  }
}

function handleLogout() {
  if (confirm('Apakah Anda yakin ingin keluar dari sistem?')) {
    localStorage.removeItem('token');
    currentUser = null;
    showLoginView();
    showToast('Berhasil keluar dari sistem', 'success');
  }
}

// 2. TAB NAVIGATION
function switchTab(tabId) {
  // Update class active pada link sidebar
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(btn => {
    btn.classList.remove('active');
  });

  const activeBtn = Array.from(document.querySelectorAll('.sidebar-nav .nav-link')).find(btn => 
    btn.getAttribute('onclick')?.includes(`'${tabId}'`)
  );
  if (activeBtn) activeBtn.classList.add('active');

  // Update class active pada mobile bottom nav
  document.querySelectorAll('.mobile-bottom-nav .bottom-nav-item').forEach(btn => {
    btn.classList.remove('active');
  });
  const bnavBtn = document.getElementById(`bnav-${tabId}`);
  if (bnavBtn) bnavBtn.classList.add('active');

  // Tutup sidebar jika sedang terbuka di mobile
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.remove('active');
  }

  // Sembunyikan semua tab
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.style.display = 'none';
  });

  // Tampilkan tab target
  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.style.display = 'block';

  // Perbarui judul topbar
  const titles = {
    dashboard: ['Dashboard', 'Ringkasan statistik operasional Tagihan Wifi Proxy.net'],
    customers: ['Data Pelanggan', 'Kelola informasi pelanggan, paket langganan dan status koneksi'],
    invoices: ['Tagihan & Invoice', 'Daftar tagihan bulanan, pencatatan pembayaran & cetak struk'],
    packages: ['Paket Internet', 'Manajemen kecepatan bandwidth dan tarif bulanan'],
    finance: ['Keuangan & Kas', 'Catatan pengeluaran operasional dan rekapan arus kas'],
    tickets: ['Tiket Gangguan', 'Daftar penanganan keluhan dan perbaikan teknis pelanggan'],
    mikrotik: ['Script Mikrotik', 'Otomatisasi isolir RouterOS untuk pelanggan menunggak'],
    settings: ['Pengaturan Sistem', 'Konfigurasi profil bisnis, rekening, dan template WhatsApp'],
    users: ['Kelola Pengguna', 'Manajemen hak akses Administrator, Operator, dan Teknisi']
  };

  if (titles[tabId]) {
    document.getElementById('topbar-title').innerText = titles[tabId][0];
    document.getElementById('topbar-subtitle').innerText = titles[tabId][1];
  }

  // Muat data spesifik tab
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'customers') loadCustomers();
  if (tabId === 'invoices') loadInvoices();
  if (tabId === 'packages') renderPackages();
  if (tabId === 'finance') loadExpenses();
  if (tabId === 'tickets') loadTickets();
  if (tabId === 'mikrotik') loadMikrotikScript();
  if (tabId === 'users') loadUsers();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('mobile-open');
  if (overlay) overlay.classList.toggle('active');
}

// 3. SETTINGS
async function loadSettings() {
  try {
    const res = await apiFetch('/api/settings');
    currentSettings = res.settings;

    // Deteksi domain aktif secara otomatis jika diakses lewat internet
    const currentOrigin = window.location.origin;
    const activeDomain = currentOrigin.includes('localhost') ? (res.settings.domain || 'http://localhost:3000') : currentOrigin;

    document.getElementById('set-app-name').value = res.settings.app_name || 'Tagihan Wifi Proxy.net';
    document.getElementById('set-domain').value = activeDomain;
    document.getElementById('set-company-phone').value = res.settings.company_phone || '';
    document.getElementById('set-company-address').value = res.settings.company_address || '';
    document.getElementById('set-bank-1').value = res.settings.bank_account_1 || '';
    document.getElementById('set-bank-2').value = res.settings.bank_account_2 || '';
    document.getElementById('set-wa-bill').value = res.settings.wa_template_bill || '';
    document.getElementById('set-wa-receipt').value = res.settings.wa_template_receipt || '';

    // Perbarui pill domain di topbar
    const domainPill = document.querySelector('.domain-pill');
    if (domainPill) {
      domainPill.href = activeDomain;
      domainPill.innerHTML = `<span>🔒</span> ${activeDomain.replace(/^https?:\/\//, '')}`;
    }
  } catch (err) {}
}

async function saveSettings() {
  const payload = {
    app_name: document.getElementById('set-app-name').value,
    domain: document.getElementById('set-domain').value,
    company_phone: document.getElementById('set-company-phone').value,
    company_address: document.getElementById('set-company-address').value,
    bank_account_1: document.getElementById('set-bank-1').value,
    bank_account_2: document.getElementById('set-bank-2').value,
    wa_template_bill: document.getElementById('set-wa-bill').value,
    wa_template_receipt: document.getElementById('set-wa-receipt').value
  };

  try {
    await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showToast('Pengaturan sistem berhasil disimpan!', 'success');
    await loadSettings();
  } catch (err) {}
}

// 4. DASHBOARD
async function loadDashboard() {
  try {
    const res = await apiFetch('/api/dashboard/stats');
    const stats = res.stats;

    document.getElementById('stat-total-customers').innerText = stats.totalCustomers;
    document.getElementById('stat-active-customers').innerText = `${stats.activeCustomers} Aktif`;
    document.getElementById('stat-isolated-customers').innerText = `${stats.isolatedCustomers} Terisolir`;

    document.getElementById('stat-monthly-paid').innerText = formatRupiah(stats.monthlyPaid);
    document.getElementById('stat-count-paid').innerText = `${stats.countPaid} Tagihan Lunas`;

    document.getElementById('stat-monthly-unpaid').innerText = formatRupiah(stats.monthlyUnpaid);
    document.getElementById('stat-count-unpaid').innerText = `${stats.countUnpaid} Belum Bayar`;

    document.getElementById('stat-net-profit').innerText = formatRupiah(stats.netProfit);
    document.getElementById('stat-monthly-expenses').innerText = `Beban: ${formatRupiah(stats.monthlyExpenses)}`;

    // Render Bar Chart Sederhana (Clean CSS Bars)
    const chartContainer = document.getElementById('chart-bars-container');
    chartContainer.innerHTML = '';

    const maxVal = Math.max(...stats.chartData.map(d => Math.max(d.income, d.expense)), 500000);

    stats.chartData.forEach(d => {
      const incHeight = Math.max(4, (d.income / maxVal) * 140);
      const expHeight = Math.max(4, (d.expense / maxVal) * 140);

      const col = document.createElement('div');
      col.style.flex = '1';
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.alignItems = 'center';
      col.style.gap = '4px';

      col.innerHTML = `
        <div style="display: flex; align-items: flex-end; gap: 4px; height: 140px;">
          <div title="Pemasukan: ${formatRupiah(d.income)}" style="width: 14px; height: ${incHeight}px; background: #2563eb; border-radius: 3px 3px 0 0;"></div>
          <div title="Pengeluaran: ${formatRupiah(d.expense)}" style="width: 14px; height: ${expHeight}px; background: #ef4444; border-radius: 3px 3px 0 0;"></div>
        </div>
        <span style="font-size: 11px; color: var(--gray-500); font-weight: 600;">${d.label}</span>
      `;
      chartContainer.appendChild(col);
    });

    // Render Tabel Pembayaran Terakhir
    const tableRecent = document.getElementById('table-recent-payments');
    if (stats.recentPayments && stats.recentPayments.length > 0) {
      tableRecent.innerHTML = stats.recentPayments.map(p => `
        <tr>
          <td><strong style="color: var(--primary);">${p.invoice_number}</strong></td>
          <td>${p.customer_name}</td>
          <td><strong style="color: #10b981;">${formatRupiah(p.amount_paid)}</strong></td>
          <td><span class="badge" style="background: #f1f5f9;">${p.payment_method}</span></td>
          <td style="font-size: 12px; color: var(--gray-500);">${p.payment_date}</td>
        </tr>
      `).join('');
    } else {
      tableRecent.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--gray-400); padding: 20px;">Belum ada riwayat pembayaran bulan ini.</td></tr>`;
    }

  } catch (err) {}
}

// 5. PACKAGES
async function loadPackages() {
  try {
    const res = await apiFetch('/api/packages');
    cachedPackages = res.packages;
    renderPackages();
    updatePackageSelectDropdown();
  } catch (err) {}
}

function renderPackages() {
  const grid = document.getElementById('packages-grid');
  if (!grid) return;
  grid.innerHTML = cachedPackages.map(pkg => `
    <div class="panel" style="margin-bottom: 0; display: flex; flex-direction: column; justify-content: space-between;">
      <div class="panel-body">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <h4 style="font-size: 17px; font-weight: 700; color: var(--gray-900);">${pkg.name}</h4>
          <span class="badge" style="background: #eff6ff; color: #1d4ed8; font-size: 12px;">${pkg.speed}</span>
        </div>
        <div style="margin: 16px 0; font-size: 24px; font-weight: 800; color: #10b981;">
          ${formatRupiah(pkg.price)} <span style="font-size: 13px; font-weight: normal; color: var(--gray-500);">/bln</span>
        </div>
        <p style="font-size: 13px; color: var(--gray-600); line-height: 1.5; min-height: 40px;">
          ${pkg.description || 'Layanan koneksi internet dedicated tanpa batas kuota.'}
        </p>
      </div>
      <div style="padding: 12px 20px; background: var(--gray-50); border-top: 1px solid var(--gray-200); display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-secondary btn-sm" onclick="editPackage(${pkg.id})">✏️ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deletePackage(${pkg.id})">🗑️ Hapus</button>
      </div>
    </div>
  `).join('');
}

function updatePackageSelectDropdown() {
  const sel = document.getElementById('cust-package');
  if (sel) {
    sel.innerHTML = cachedPackages.map(p => `
      <option value="${p.id}">${p.name} (${p.speed}) - ${formatRupiah(p.price)}/bln</option>
    `).join('');
  }
}

function openPackageModal() {
  document.getElementById('form-package').reset();
  document.getElementById('pkg-id').value = '';
  document.getElementById('modal-package-title').innerText = 'Buat Paket Internet Baru';
  openModal('modal-package');
}

function editPackage(id) {
  const pkg = cachedPackages.find(p => p.id === id);
  if (!pkg) return;
  document.getElementById('pkg-id').value = pkg.id;
  document.getElementById('pkg-name').value = pkg.name;
  document.getElementById('pkg-speed').value = pkg.speed;
  document.getElementById('pkg-price').value = pkg.price;
  document.getElementById('pkg-desc').value = pkg.description || '';
  document.getElementById('modal-package-title').innerText = 'Edit Paket Internet';
  openModal('modal-package');
}

async function savePackage(e) {
  e.preventDefault();
  const id = document.getElementById('pkg-id').value;
  const payload = {
    name: document.getElementById('pkg-name').value,
    speed: document.getElementById('pkg-speed').value,
    price: parseInt(document.getElementById('pkg-price').value),
    description: document.getElementById('pkg-desc').value
  };

  try {
    if (id) {
      await apiFetch(`/api/packages/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Paket berhasil diperbarui', 'success');
    } else {
      await apiFetch('/api/packages', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Paket baru berhasil ditambahkan', 'success');
    }
    closeModal('modal-package');
    await loadPackages();
  } catch (err) {}
}

async function deletePackage(id) {
  if (confirm('Yakin ingin menghapus paket ini?')) {
    try {
      await apiFetch(`/api/packages/${id}`, { method: 'DELETE' });
      showToast('Paket berhasil dihapus', 'success');
      await loadPackages();
    } catch (err) {}
  }
}

// 6. CUSTOMERS
let cachedCustomers = [];

async function loadCustomers() {
  const search = document.getElementById('filter-customer-search')?.value || '';
  const status = document.getElementById('filter-customer-status')?.value || 'all';

  try {
    const res = await apiFetch(`/api/customers?search=${encodeURIComponent(search)}&status=${status}`);
    cachedCustomers = res.customers || [];
    const tbody = document.getElementById('table-customers');

    if (!res.customers || res.customers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--gray-400); padding: 30px;">Tidak ada data pelanggan yang sesuai.</td></tr>`;
      return;
    }

    tbody.innerHTML = res.customers.map(c => `
      <tr>
        <td>
          <strong style="color: var(--primary);">${c.customer_code}</strong>
        </td>
        <td>
          <div style="font-weight: 700; color: var(--gray-900); cursor: pointer;" onclick="viewCustomerDetail(${c.id})" title="Klik untuk lihat riwayat & detail">
            ${c.name} 🔍
          </div>
          <div style="font-size: 12px; color: var(--gray-500); display: flex; align-items: center; gap: 6px; margin-top: 2px;">
            <span>📱 ${c.phone}</span>
            <a href="https://wa.me/${c.phone.replace(/^0/, '62').replace(/[^0-9]/g, '')}" target="_blank" style="color: #25d366; text-decoration: none;" title="Chat WhatsApp">
              💬
            </a>
          </div>
        </td>
        <td style="max-width: 180px; font-size: 12.5px; color: var(--gray-600);">${c.address}</td>
        <td>
          <strong>${c.package_name || '-'}</strong>
          <div style="font-size: 11.5px; color: #10b981;">${c.package_speed || ''} (${formatRupiah(c.package_price || 0)})</div>
        </td>
        <td style="font-size: 12px; font-family: monospace;">
          <div>IP: ${c.ip_address || '-'}</div>
          <div>User: ${c.pppoe_user || '-'}</div>
        </td>
        <td>Tgl ${c.due_day}</td>
        <td>
          <span class="badge badge-${c.status}">
            ${c.status === 'active' ? '🟢 Aktif' : c.status === 'isolated' ? '🔴 Terisolir' : '⚪ Nonaktif'}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" onclick="viewCustomerDetail(${c.id})" title="Lihat Detail & Riwayat Tagihan">👁️</button>
            <button class="btn btn-secondary btn-sm" onclick="editCustomer(${c.id})" title="Edit Data">✏️</button>
            <button class="btn btn-${c.status === 'active' ? 'warning' : 'success'} btn-sm" onclick="toggleCustomerStatus(${c.id})" title="${c.status === 'active' ? 'Isolir' : 'Aktifkan'}">
              ${c.status === 'active' ? '🔒 Isolir' : '🔓 Aktif'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteCustomer(${c.id})" title="Hapus">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {}
}

async function viewCustomerDetail(id) {
  try {
    const res = await apiFetch(`/api/customers?search=`);
    const cust = res.customers.find(c => c.id === id);
    if (!cust) return;

    document.getElementById('cust-det-title').innerText = `Detail Pelanggan: ${cust.name} (${cust.customer_code})`;
    document.getElementById('cust-det-name').innerText = cust.name;
    document.getElementById('cust-det-code').innerText = cust.customer_code;
    document.getElementById('cust-det-phone').innerText = cust.phone;
    document.getElementById('cust-det-address').innerText = cust.address;
    document.getElementById('cust-det-pkg').innerText = `${cust.package_name || '-'} (${cust.package_speed || ''})`;
    document.getElementById('cust-det-price').innerText = formatRupiah(cust.package_price || 0) + ' / bulan';
    document.getElementById('cust-det-ip').innerText = cust.ip_address || '-';
    document.getElementById('cust-det-pppoe').innerText = cust.pppoe_user || '-';
    document.getElementById('cust-det-due').innerText = cust.due_day || 10;

    const badge = document.getElementById('cust-det-status-badge');
    badge.innerHTML = `<span class="badge badge-${cust.status}">${cust.status === 'active' ? '🟢 Aktif' : cust.status === 'isolated' ? '🔴 Terisolir' : '⚪ Nonaktif'}</span>`;

    const btnWa = document.getElementById('btn-cust-det-wa');
    btnWa.onclick = () => {
      const cleanPhone = cust.phone.replace(/^0/, '62').replace(/[^0-9]/g, '');
      window.open(`https://wa.me/${cleanPhone}`, '_blank');
    };

    // Ambil seluruh tagihan pelanggan ini
    const invRes = await apiFetch(`/api/invoices?customer_id=${cust.id}`);
    const tbody = document.getElementById('cust-det-invoices-table');
    if (!invRes.invoices || invRes.invoices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--gray-400); padding: 20px;">Belum ada riwayat tagihan.</td></tr>`;
    } else {
      tbody.innerHTML = invRes.invoices.map(i => `
        <tr>
          <td><strong style="color: var(--primary);">${i.invoice_number}</strong></td>
          <td>${i.period_month}/${i.period_year}</td>
          <td><strong>${formatRupiah(i.total_amount)}</strong></td>
          <td style="font-size: 12px;">${i.due_date}</td>
          <td><span class="badge badge-${i.status}">${i.status === 'paid' ? 'Lunas' : 'Belum Bayar'}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="previewReceipt(${i.id})">🖨️</button>
            <button class="btn btn-wa btn-sm" onclick="sendWhatsAppInvoice(${i.id})">📲</button>
          </td>
        </tr>
      `).join('');
    }

    openModal('modal-customer-detail');
  } catch (err) {}
}

function openCustomerModal() {
  document.getElementById('form-customer').reset();
  document.getElementById('cust-id').value = '';
  document.getElementById('modal-customer-title').innerText = 'Tambah Pelanggan Baru';
  openModal('modal-customer');
}

async function editCustomer(id) {
  try {
    const res = await apiFetch(`/api/customers?search=`);
    const cust = res.customers.find(c => c.id === id);
    if (!cust) return;

    document.getElementById('cust-id').value = cust.id;
    document.getElementById('cust-code').value = cust.customer_code;
    document.getElementById('cust-name').value = cust.name;
    document.getElementById('cust-phone').value = cust.phone;
    document.getElementById('cust-email').value = cust.email || '';
    document.getElementById('cust-address').value = cust.address;
    document.getElementById('cust-package').value = cust.package_id;
    document.getElementById('cust-due-day').value = cust.due_day || 10;
    document.getElementById('cust-ip').value = cust.ip_address || '';
    document.getElementById('cust-pppoe-user').value = cust.pppoe_user || '';
    document.getElementById('cust-pppoe-pass').value = cust.pppoe_password || '';
    document.getElementById('cust-status').value = cust.status || 'active';
    document.getElementById('cust-notes').value = cust.notes || '';

    document.getElementById('modal-customer-title').innerText = 'Edit Pelanggan #' + cust.customer_code;
    openModal('modal-customer');
  } catch (err) {}
}

async function saveCustomer(e) {
  e.preventDefault();
  const id = document.getElementById('cust-id').value;
  const payload = {
    customer_code: document.getElementById('cust-code').value.trim(),
    name: document.getElementById('cust-name').value.trim(),
    phone: document.getElementById('cust-phone').value.trim(),
    email: document.getElementById('cust-email').value.trim(),
    address: document.getElementById('cust-address').value.trim(),
    package_id: parseInt(document.getElementById('cust-package').value),
    due_day: parseInt(document.getElementById('cust-due-day').value) || 10,
    ip_address: document.getElementById('cust-ip').value.trim(),
    pppoe_user: document.getElementById('cust-pppoe-user').value.trim(),
    pppoe_password: document.getElementById('cust-pppoe-pass').value.trim(),
    status: document.getElementById('cust-status').value,
    notes: document.getElementById('cust-notes').value.trim()
  };

  try {
    if (id) {
      await apiFetch(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Data pelanggan berhasil diperbarui', 'success');
    } else {
      await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Pelanggan baru berhasil didaftarkan!', 'success');
    }
    closeModal('modal-customer');
    await loadCustomers();
  } catch (err) {}
}

async function toggleCustomerStatus(id) {
  try {
    const res = await apiFetch(`/api/customers/${id}/toggle-status`, { method: 'POST' });
    showToast(res.message, 'success');
    await loadCustomers();
    await loadDashboard();
  } catch (err) {}
}

async function deleteCustomer(id) {
  if (confirm('PERINGATAN: Menghapus pelanggan akan menghapus seluruh data tagihannya. Lanjutkan?')) {
    try {
      await apiFetch(`/api/customers/${id}`, { method: 'DELETE' });
      showToast('Pelanggan berhasil dihapus', 'success');
      await loadCustomers();
      await loadDashboard();
    } catch (err) {}
  }
}

// 7. INVOICES
function initMonthDropdowns() {
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const curMonth = new Date().getMonth() + 1;

  const filterSel = document.getElementById('filter-invoice-month');
  if (filterSel) {
    filterSel.innerHTML = `<option value="">Semua Bulan</option>` + months.map((m, idx) => `
      <option value="${idx + 1}" ${idx + 1 === curMonth ? 'selected' : ''}>${m}</option>
    `).join('');
  }

  const genSel = document.getElementById('gen-month');
  if (genSel) {
    genSel.innerHTML = months.map((m, idx) => `
      <option value="${idx + 1}" ${idx + 1 === curMonth ? 'selected' : ''}>${m}</option>
    `).join('');
  }

  const manMonthSel = document.getElementById('inv-man-month');
  if (manMonthSel) {
    manMonthSel.innerHTML = months.map((m, idx) => `
      <option value="${idx + 1}" ${idx + 1 === curMonth ? 'selected' : ''}>${m}</option>
    `).join('');
  }

  const expMonthSel = document.getElementById('filter-expense-month');
  if (expMonthSel) {
    expMonthSel.innerHTML = `<option value="">Semua Bulan</option>` + months.map((m, idx) => `
      <option value="${idx + 1}">${m}</option>
    `).join('');
  }
}

// Buka Modal Buat Tagihan Manual
async function openManualInvoiceModal() {
  // Ambil daftar pelanggan jika belum ter-cache
  try {
    const res = await apiFetch('/api/customers?search=');
    cachedCustomers = res.customers || [];

    const custSel = document.getElementById('inv-man-customer');
    custSel.innerHTML = `<option value="">-- Pilih Pelanggan --</option>` + cachedCustomers.map(c => `
      <option value="${c.id}" data-pkg="${c.package_id}" data-price="${c.package_price || 0}" data-due="${c.due_day || 10}">
        ${c.customer_code} - ${c.name} (${c.package_name || 'Tanpa Paket'})
      </option>
    `).join('');

    const pkgSel = document.getElementById('inv-man-package');
    pkgSel.innerHTML = cachedPackages.map(p => `
      <option value="${p.id}" data-price="${p.price}">${p.name} (${p.speed}) - ${formatRupiah(p.price)}</option>
    `).join('');

    // Default form values
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('inv-man-year').value = curYear;
    document.getElementById('inv-man-discount').value = 0;
    document.getElementById('inv-man-fine').value = 0;
    document.getElementById('inv-man-duedate').value = `${curYear}-${curMonth}-10`;
    document.getElementById('inv-man-amount').value = '';
    document.getElementById('inv-man-notes').value = '';

    openModal('modal-manual-invoice');
  } catch (err) {}
}

function onCustomerSelectForInvoice(customerId) {
  if (!customerId) return;
  const cust = cachedCustomers.find(c => c.id == customerId);
  if (cust) {
    if (cust.package_id) {
      document.getElementById('inv-man-package').value = cust.package_id;
    }
    document.getElementById('inv-man-amount').value = cust.package_price || 0;
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    const dueDay = String(cust.due_day || 10).padStart(2, '0');
    document.getElementById('inv-man-duedate').value = `${curYear}-${curMonth}-${dueDay}`;
  }
}

function onPackageSelectForInvoice(packageId) {
  const pkg = cachedPackages.find(p => p.id == packageId);
  if (pkg) {
    document.getElementById('inv-man-amount').value = pkg.price;
  }
}

async function saveManualInvoice(e) {
  e.preventDefault();
  const customer_id = document.getElementById('inv-man-customer').value;
  const package_id = document.getElementById('inv-man-package').value;
  const amount = parseInt(document.getElementById('inv-man-amount').value) || 0;
  const discount = parseInt(document.getElementById('inv-man-discount').value) || 0;
  const fine = parseInt(document.getElementById('inv-man-fine').value) || 0;
  const period_month = parseInt(document.getElementById('inv-man-month').value);
  const period_year = parseInt(document.getElementById('inv-man-year').value);
  const due_date = document.getElementById('inv-man-duedate').value;
  const notes = document.getElementById('inv-man-notes').value;

  if (!customer_id) {
    return showToast('Silakan pilih pelanggan terlebih dahulu', 'warning');
  }

  try {
    const res = await apiFetch('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        customer_id,
        package_id,
        amount,
        discount,
        fine,
        period_month,
        period_year,
        due_date,
        notes
      })
    });

    showToast(`Tagihan ${res.invoice_number} berhasil dibuat!`, 'success');
    closeModal('modal-manual-invoice');
    await loadInvoices();
    await loadDashboard();
  } catch (err) {}
}

// Ekspor Tabel ke Format CSV / Excel
function exportTableToCSV(tableId, filename = 'export') {
  const table = document.getElementById(tableId);
  if (!table) return;

  const rows = [];
  const trList = table.closest('.panel')?.querySelectorAll('thead tr, tbody tr') || table.querySelectorAll('tr');

  trList.forEach(tr => {
    const row = [];
    const cells = tr.querySelectorAll('th, td');
    cells.forEach((cell, idx) => {
      // Abaikan kolom terakhir (Aksi)
      if (idx === cells.length - 1 && cell.innerText.includes('Aksi')) return;
      if (idx === cells.length - 1 && cell.querySelector('button, a')) return;

      let text = cell.innerText.replace(/(\r\n|\n|\r)/gm, ' ').replace(/"/g, '""').trim();
      row.push(`"${text}"`);
    });
    if (row.length > 0) rows.push(row.join(','));
  });

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast('Laporan berhasil diekspor ke file CSV!', 'success');
}

async function loadInvoices() {
  const search = document.getElementById('filter-invoice-search')?.value || '';
  const status = document.getElementById('filter-invoice-status')?.value || 'all';
  const month = document.getElementById('filter-invoice-month')?.value || '';

  try {
    let url = `/api/invoices?status=${status}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (month) url += `&month=${month}`;

    const res = await apiFetch(url);
    const tbody = document.getElementById('table-invoices');

    if (!res.invoices || res.invoices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--gray-400); padding: 30px;">Belum ada data tagihan pada filter ini.</td></tr>`;
      return;
    }

    tbody.innerHTML = res.invoices.map(inv => {
      const isPaid = inv.status === 'paid';
      return `
        <tr>
          <td>
            <strong style="color: var(--primary);">${inv.invoice_number}</strong>
          </td>
          <td>
            <div style="font-weight: 700;">${inv.customer_name} (${inv.customer_code})</div>
            <div style="font-size: 11.5px; color: var(--gray-500);">${inv.package_name}</div>
          </td>
          <td>${inv.period_month}/${inv.period_year}</td>
          <td>
            <strong style="font-size: 14px; color: ${isPaid ? '#10b981' : '#dc2626'};">
              ${formatRupiah(inv.total_amount)}
            </strong>
          </td>
          <td style="font-size: 12.5px;">${inv.due_date}</td>
          <td>
            <span class="badge badge-${inv.status}">
              ${isPaid ? '✅ Lunas' : '⏳ Belum Bayar'}
            </span>
          </td>
          <td>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              ${!isPaid ? `
                <button class="btn btn-success btn-sm" onclick="openPayModal(${inv.id}, '${inv.invoice_number}', '${inv.customer_name}', '${inv.package_name}', ${inv.total_amount})">
                  💵 Bayar
                </button>
              ` : ''}
              <button class="btn btn-secondary btn-sm" onclick="previewReceipt(${inv.id})" title="Cetak Struk">
                🖨️ Struk
              </button>
              <button class="btn btn-wa btn-sm" onclick="sendWhatsAppInvoice(${inv.id})" title="Kirim Tagihan via WhatsApp">
                📲 WA
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteInvoice(${inv.id})" title="Hapus Tagihan">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {}
}

function openMonthlyInvoiceModal() {
  openModal('modal-generate-monthly');
}

async function executeGenerateMonthly() {
  const month = document.getElementById('gen-month').value;
  const year = document.getElementById('gen-year').value;

  try {
    const res = await apiFetch('/api/invoices/generate-monthly', {
      method: 'POST',
      body: JSON.stringify({ month, year })
    });
    showToast(res.message, 'success');
    closeModal('modal-generate-monthly');
    await loadInvoices();
    await loadDashboard();
  } catch (err) {}
}

function openPayModal(id, invNumber, custName, pkgName, amount) {
  document.getElementById('pay-inv-id').value = id;
  document.getElementById('pay-inv-number').innerText = invNumber;
  document.getElementById('pay-inv-customer').innerText = custName;
  document.getElementById('pay-inv-package').innerText = pkgName;
  document.getElementById('pay-inv-amount').innerText = formatRupiah(amount);
  openModal('modal-pay-invoice');
}

async function handlePayInvoice(e) {
  e.preventDefault();
  const id = document.getElementById('pay-inv-id').value;
  const method = document.getElementById('pay-inv-method').value;
  const notes = document.getElementById('pay-inv-notes').value;

  try {
    const res = await apiFetch(`/api/invoices/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify({ payment_method: method, notes })
    });
    showToast(res.message, 'success');
    closeModal('modal-pay-invoice');
    await loadInvoices();
    await loadDashboard();
    // Buka dialog preview struk untuk langsung dicetak
    previewReceipt(id);
  } catch (err) {}
}

async function deleteInvoice(id) {
  if (confirm('Yakin ingin membatalkan & menghapus tagihan ini?')) {
    try {
      await apiFetch(`/api/invoices/${id}`, { method: 'DELETE' });
      showToast('Tagihan berhasil dihapus', 'success');
      await loadInvoices();
      await loadDashboard();
    } catch (err) {}
  }
}

// 8. CETAK STRUK THERMAL & INVOICE A4
let currentPrintInvoice = null;
let currentReceiptFormat = 'thermal'; // 'thermal' atau 'a4'

function setReceiptFormat(fmt) {
  currentReceiptFormat = fmt;
  const btnThermal = document.getElementById('btn-fmt-thermal');
  const btnA4 = document.getElementById('btn-fmt-a4');
  if (fmt === 'thermal') {
    btnThermal.className = 'btn btn-sm btn-primary';
    btnA4.className = 'btn btn-sm btn-secondary';
  } else {
    btnThermal.className = 'btn btn-sm btn-secondary';
    btnA4.className = 'btn btn-sm btn-primary';
  }
  renderReceiptDocument();
}

function renderReceiptDocument() {
  if (!currentPrintInvoice) return;
  const { inv, set } = currentPrintInvoice;
  const isPaid = inv.status === 'paid';

  let html = '';
  if (currentReceiptFormat === 'thermal') {
    html = `
      <div class="receipt-wrapper">
        <div class="receipt-header">
          <h3>${set.app_name || 'Tagihan Wifi Proxy.net'}</h3>
          <p style="font-size: 11px;">${set.company_address || 'Pusat Layanan Internet'}</p>
          <p style="font-size: 11px;">WA/CS: ${set.company_phone || '-'}</p>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-row"><span>No. Struk</span><strong>${inv.invoice_number}</strong></div>
        <div class="receipt-row"><span>Tanggal</span><span>${inv.paid_at || new Date().toISOString().slice(0, 10)}</span></div>
        <div class="receipt-row"><span>Pelanggan</span><strong>${inv.customer_name} (${inv.customer_code})</strong></div>
        <div class="receipt-row"><span>Status</span><strong>${isPaid ? 'LUNAS' : 'BELUM BAYAR'}</strong></div>
        <div class="receipt-divider"></div>
        <div class="receipt-row">
          <span>${inv.package_name}</span>
          <span>${formatRupiah(inv.amount)}</span>
        </div>
        ${inv.fine > 0 ? `<div class="receipt-row"><span>Denda</span><span>${formatRupiah(inv.fine)}</span></div>` : ''}
        ${inv.discount > 0 ? `<div class="receipt-row"><span>Diskon</span><span>-${formatRupiah(inv.discount)}</span></div>` : ''}
        <div class="receipt-divider"></div>
        <div class="receipt-row receipt-total">
          <span>TOTAL</span>
          <span>${formatRupiah(inv.total_amount)}</span>
        </div>
        <div class="receipt-row">
          <span>Metode</span>
          <span>${inv.payment_method || 'Cash / Tunai'}</span>
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-footer">
          <p>${set.receipt_footer || 'Terima kasih atas pembayaran Anda.'}</p>
          <p style="margin-top: 4px; font-size: 10px;">Cek tagihan online: ${set.domain || 'https://Tagihan.wifi.my.id'}/portal</p>
        </div>
      </div>
    `;
  } else {
    // Format Invoice A4 Formal
    html = `
      <div class="invoice-a4-wrapper">
        <div class="invoice-a4-header">
          <div>
            <div class="invoice-a4-title">INVOICE TAGIHAN INTERNET</div>
            <p style="font-size: 12px; color: var(--gray-500); margin-top: 2px;">No: <strong>${inv.invoice_number}</strong></p>
            <p style="font-size: 12px; color: var(--gray-500);">Tanggal Terbit: ${inv.created_at || new Date().toISOString().slice(0, 10)}</p>
            <p style="font-size: 12px; color: var(--gray-500);">Jatuh Tempo: <strong>${inv.due_date}</strong></p>
          </div>
          <div style="text-align: right;">
            <h3 style="font-size: 16px; font-weight: 800; color: var(--gray-900);">${set.app_name || 'Tagihan Wifi Proxy.net'}</h3>
            <p style="font-size: 12px; color: var(--gray-600);">${set.company_address || 'Layanan Internet Mandiri'}</p>
            <p style="font-size: 12px; color: var(--gray-600);">WhatsApp / CS: ${set.company_phone || '-'}</p>
            <div style="margin-top: 8px;">
              <span class="badge ${isPaid ? 'badge-paid' : 'badge-unpaid'}" style="font-size: 14px; padding: 6px 16px;">
                ${isPaid ? 'LUNAS (PAID)' : 'MENUNGGU PEMBAYARAN'}
              </span>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; margin-bottom: 20px; background: #f8fafc; padding: 14px; border-radius: 6px;">
          <div>
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--gray-500);">Ditagihkan Kepada:</div>
            <strong style="font-size: 15px; color: var(--gray-900); display: block; margin-top: 4px;">${inv.customer_name}</strong>
            <div style="font-size: 12.5px; color: var(--gray-600);">ID Pelanggan: <strong>${inv.customer_code}</strong></div>
            <div style="font-size: 12.5px; color: var(--gray-600);">No. HP: ${inv.customer_phone || '-'}</div>
            <div style="font-size: 12px; color: var(--gray-500); max-width: 320px;">${inv.customer_address || '-'}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--gray-500);">Periode Pemakaian:</div>
            <strong style="font-size: 14px; color: var(--primary); display: block; margin-top: 4px;">Bulan ${inv.period_month} / ${inv.period_year}</strong>
            <div style="font-size: 12.5px; color: var(--gray-600); margin-top: 4px;">Status Akun: <strong>${inv.pppoe_user ? 'PPPoE: ' + inv.pppoe_user : 'Static IP'}</strong></div>
          </div>
        </div>

        <table class="invoice-a4-table">
          <thead>
            <tr>
              <th>Deskripsi Layanan</th>
              <th style="text-align: center;">Periode</th>
              <th style="text-align: right;">Jumlah (Rp)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>${inv.package_name}</strong>
                <div style="font-size: 11.5px; color: var(--gray-500);">Langganan Akses Internet Unlimited Kuota (Dedicated Bandwidth)</div>
              </td>
              <td style="text-align: center;">${inv.period_month}/${inv.period_year}</td>
              <td style="text-align: right;">${formatRupiah(inv.amount)}</td>
            </tr>
            ${inv.fine > 0 ? `
              <tr>
                <td>Denda Keterlambatan Pembayaran</td>
                <td style="text-align: center;">-</td>
                <td style="text-align: right;">${formatRupiah(inv.fine)}</td>
              </tr>
            ` : ''}
            ${inv.discount > 0 ? `
              <tr>
                <td>Potongan Diskon Khusus</td>
                <td style="text-align: center;">-</td>
                <td style="text-align: right; color: #16a34a;">-${formatRupiah(inv.discount)}</td>
              </tr>
            ` : ''}
          </tbody>
          <tfoot>
            <tr style="font-size: 15px; font-weight: 800; border-top: 2px solid #cbd5e1;">
              <td colspan="2" style="text-align: right; padding-top: 14px;">TOTAL PEMBAYARAN:</td>
              <td style="text-align: right; color: ${isPaid ? '#10b981' : '#dc2626'}; padding-top: 14px;">${formatRupiah(inv.total_amount)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="margin-top: 24px; display: flex; justify-content: space-between; align-items: flex-end;">
          <div style="font-size: 12px; color: var(--gray-600); max-width: 360px;">
            <strong>Rekening Pembayaran:</strong><br>
            ${set.bank_account_1 || '-'}<br>
            ${set.bank_account_2 || '-'}<br>
            <span style="font-size: 11px; color: var(--gray-500); margin-top: 4px; display: block;">${set.receipt_footer || ''}</span>
          </div>
          <div style="text-align: center; width: 180px;">
            <div style="font-size: 12px; color: var(--gray-500);">Petugas / Kasir:</div>
            <div style="height: 40px; margin-top: 6px; font-weight: 800; color: ${isPaid ? '#10b981' : '#dc2626'}; font-size: 18px; border: 2px dashed ${isPaid ? '#10b981' : '#dc2626'}; display: flex; align-items: center; justify-content: center; border-radius: 4px;">
              ${isPaid ? '✓ LUNAS' : 'TAGIHAN'}
            </div>
            <div style="font-size: 12px; margin-top: 6px; font-weight: 600;">Tagihan Wifi Proxy.net</div>
          </div>
        </div>
      </div>
    `;
  }

  document.getElementById('receipt-preview-content').innerHTML = html;
  document.getElementById('print-area').innerHTML = html;
}

async function previewReceipt(id) {
  try {
    const res = await apiFetch(`/api/invoices/${id}/print`);
    const inv = res.invoice;
    const set = res.settings;
    currentPrintInvoice = { inv, set };

    renderReceiptDocument();

    // Pasang tombol kirim WA bukti bayar
    const btnWaShare = document.getElementById('btn-wa-receipt-share');
    btnWaShare.onclick = () => sendWhatsAppReceiptDirect(inv, set);

    openModal('modal-receipt');
  } catch (err) {}
}

function printReceipt() {
  window.print();
}

// 9. WHATSAPP GATEWAY INTEGRATION
async function sendWhatsAppInvoice(id) {
  try {
    const res = await apiFetch(`/api/invoices/${id}/print`);
    const inv = res.invoice;
    const set = res.settings;

    let text = set.wa_template_bill || `Halo Pelanggan Terhormat {nama},\nTagihan internet WiFi Anda periode {periode} telah diterbitkan.\nTotal: Rp {total}\nJatuh tempo: {jatuh_tempo}\n\nTerima kasih,\nTagihan Wifi Proxy.net`;
    text = text
      .replace(/{nama}/g, inv.customer_name)
      .replace(/{no_invoice}/g, inv.invoice_number)
      .replace(/{periode}/g, `${inv.period_month}/${inv.period_year}`)
      .replace(/{paket}/g, inv.package_name)
      .replace(/{total}/g, inv.total_amount.toLocaleString('id-ID'))
      .replace(/{jatuh_tempo}/g, inv.due_date)
      .replace(/{rekening}/g, `${set.bank_account_1 || ''}\n${set.bank_account_2 || ''}`)
      .replace(/{cs_phone}/g, set.company_phone || '')
      .replace(/{domain}/g, set.domain || 'https://Tagihan.wifi.my.id');

    const cleanPhone = (inv.customer_phone || '').replace(/^0/, '62').replace(/[^0-9]/g, '');
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  } catch (err) {}
}

function sendWhatsAppReceiptDirect(inv, set) {
  let text = set.wa_template_receipt || `Halo {nama},\nPembayaran tagihan WiFi periode {periode} sebesar Rp {total} telah kami terima dan LUNAS.\nNo: {no_invoice}\nTerima kasih.`;
  text = text
    .replace(/{nama}/g, inv.customer_name)
    .replace(/{no_invoice}/g, inv.invoice_number)
    .replace(/{periode}/g, `${inv.period_month}/${inv.period_year}`)
    .replace(/{total}/g, inv.total_amount.toLocaleString('id-ID'))
    .replace(/{metode}/g, inv.payment_method || 'Cash / Tunai')
    .replace(/{tanggal}/g, inv.paid_at || new Date().toISOString().slice(0, 10))
    .replace(/{cs_phone}/g, set.company_phone || '')
    .replace(/{domain}/g, set.domain || 'https://Tagihan.wifi.my.id');

  const cleanPhone = (inv.customer_phone || '').replace(/^0/, '62').replace(/[^0-9]/g, '');
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

// 10. EXPENSES & FINANCE
async function loadExpenses() {
  const month = document.getElementById('filter-expense-month')?.value || '';
  const now = new Date();
  const year = now.getFullYear();

  try {
    let url = '/api/expenses';
    if (month) {
      url += `?month=${month}&year=${year}`;
    }
    const res = await apiFetch(url);
    const tbody = document.getElementById('table-expenses');

    if (!res.expenses || res.expenses.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--gray-400); padding: 30px;">Belum ada catatan pengeluaran operasional pada periode ini.</td></tr>`;
      return;
    }

    tbody.innerHTML = res.expenses.map(e => `
      <tr>
        <td>${e.expense_date}</td>
        <td><strong style="color: var(--gray-900);">${e.category}</strong></td>
        <td>${e.description || '-'}</td>
        <td><strong style="color: #ef4444;">${formatRupiah(e.amount)}</strong></td>
        <td style="font-size: 12px;">${e.created_by}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="deleteExpense(${e.id})">🗑️</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {}
}

function openExpenseModal() {
  document.getElementById('form-expense').reset();
  document.getElementById('exp-date').value = new Date().toISOString().slice(0, 10);
  openModal('modal-expense');
}

async function saveExpense(e) {
  e.preventDefault();
  const payload = {
    category: document.getElementById('exp-category').value,
    amount: parseInt(document.getElementById('exp-amount').value),
    expense_date: document.getElementById('exp-date').value,
    description: document.getElementById('exp-desc').value.trim()
  };

  try {
    await apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Pengeluaran berhasil dicatat', 'success');
    closeModal('modal-expense');
    await loadExpenses();
    await loadDashboard();
  } catch (err) {}
}

async function deleteExpense(id) {
  if (confirm('Yakin ingin menghapus catatan pengeluaran ini?')) {
    try {
      await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
      showToast('Pengeluaran dihapus', 'success');
      await loadExpenses();
      await loadDashboard();
    } catch (err) {}
  }
}

// 11. TICKETS GANGGUAN
async function loadTickets() {
  try {
    const res = await apiFetch('/api/tickets');
    const tbody = document.getElementById('table-tickets');

    if (!res.tickets || res.tickets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--gray-400); padding: 30px;">Tidak ada tiket gangguan yang dilaporkan.</td></tr>`;
      return;
    }

    tbody.innerHTML = res.tickets.map(t => `
      <tr>
        <td><strong style="color: var(--primary);">${t.ticket_number}</strong></td>
        <td>
          <div style="font-weight: 700;">${t.customer_name} (${t.customer_code})</div>
          <div style="font-size: 11.5px; color: var(--gray-500);">${t.customer_phone} | ${t.customer_address}</div>
        </td>
        <td>
          <strong style="color: #dc2626;">${t.issue_type}</strong>
          <div style="font-size: 12px; color: var(--gray-600); margin-top: 2px;">${t.description}</div>
        </td>
        <td>
          <span class="badge badge-${t.priority}">${t.priority.toUpperCase()}</span>
        </td>
        <td>
          <select class="form-control" style="font-size: 12px; padding: 4px;" onchange="updateTicketStatus(${t.id}, this.value)">
            <option value="open" ${t.status === 'open' ? 'selected' : ''}>⏳ Open (Baru)</option>
            <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>🔧 Diproses Teknisi</option>
            <option value="resolved" ${t.status === 'resolved' ? 'selected' : ''}>✅ Selesai (Resolved)</option>
            <option value="closed" ${t.status === 'closed' ? 'selected' : ''}>🔒 Ditutup</option>
          </select>
        </td>
        <td style="font-size: 12px; color: var(--gray-600);">${t.technician_notes || '-'}</td>
        <td>
          <a href="https://wa.me/${(t.customer_phone || '').replace(/^0/, '62').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Halo ${t.customer_name}, perihal laporan gangguan ${t.ticket_number} (${t.issue_type}), tim teknisi kami sedang menuju lokasi...`)}" target="_blank" class="btn btn-wa btn-sm">
            💬 Hubungi
          </a>
        </td>
      </tr>
    `).join('');
  } catch (err) {}
}

async function updateTicketStatus(id, newStatus) {
  try {
    await apiFetch(`/api/tickets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    showToast('Status tiket berhasil diperbarui', 'success');
    await loadTickets();
  } catch (err) {}
}

// 12. MIKROTIK INTEGRATION
async function loadMikrotikScript() {
  try {
    const res = await apiFetch('/api/mikrotik/generate-script');
    document.getElementById('mikrotik-script-isolate').value = res.isolateScript;
    document.getElementById('mikrotik-script-restore').value = res.restoreScript;
    showToast(`Script Mikrotik terupdate: ${res.total_isolated} terisolir, ${res.total_active} aktif`, 'success');
  } catch (err) {}
}

function copyToClipboard(elementId) {
  const el = document.getElementById(elementId);
  el.select();
  navigator.clipboard.writeText(el.value);
  showToast('Script berhasil disalin ke clipboard!', 'success');
}

// 13. USERS MANAGEMENT
async function loadUsers() {
  try {
    const res = await apiFetch('/api/users');
    const tbody = document.getElementById('table-users');

    tbody.innerHTML = res.users.map(u => `
      <tr>
        <td><strong>${u.username}</strong></td>
        <td>${u.full_name}</td>
        <td><span class="badge" style="background: #e0e7ff; color: #4338ca;">${u.role.toUpperCase()}</span></td>
        <td>${u.phone || '-'}</td>
        <td style="font-size: 12px; color: var(--gray-500);">${u.created_at}</td>
        <td>
          ${u.id !== currentUser.id ? `
            <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">🗑️</button>
          ` : '<span style="font-size: 11px; color: var(--gray-400);">(Anda)</span>'}
        </td>
      </tr>
    `).join('');
  } catch (err) {}
}

function openUserModal() {
  document.getElementById('form-user').reset();
  openModal('modal-user');
}

async function saveUser(e) {
  e.preventDefault();
  const payload = {
    username: document.getElementById('user-uname').value.trim(),
    password: document.getElementById('user-pword').value,
    full_name: document.getElementById('user-fname').value.trim(),
    role: document.getElementById('user-role').value,
    phone: document.getElementById('user-ph').value.trim()
  };

  try {
    await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Pengguna baru berhasil ditambahkan', 'success');
    closeModal('modal-user');
    await loadUsers();
  } catch (err) {}
}

async function deleteUser(id) {
  if (confirm('Yakin ingin menghapus user ini?')) {
    try {
      await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
      showToast('User berhasil dihapus', 'success');
      await loadUsers();
    } catch (err) {}
  }
}

// Modal Helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

// 14. KALKULATOR PRORATE PASANG BARU
let calculatedProrateAmount = 0;

function openProrateModal() {
  const pkgSel = document.getElementById('pro-pkg');
  pkgSel.innerHTML = cachedPackages.map(p => `
    <option value="${p.id}" data-price="${p.price}">${p.name} (${p.speed}) - ${formatRupiah(p.price)}/bln</option>
  `).join('');

  if (cachedPackages.length > 0) {
    document.getElementById('pro-full-price').value = cachedPackages[0].price;
  }
  document.getElementById('pro-install-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('pro-due-day').value = 10;
  calculateProrate();
  openModal('modal-prorate');
}

function calculateProrate() {
  const pkgSel = document.getElementById('pro-pkg');
  const selectedOpt = pkgSel.options[pkgSel.selectedIndex];
  if (selectedOpt && selectedOpt.dataset.price && !document.getElementById('pro-full-price').matches(':focus')) {
    document.getElementById('pro-full-price').value = selectedOpt.dataset.price;
  }

  const fullPrice = parseInt(document.getElementById('pro-full-price').value) || 0;
  const installDateStr = document.getElementById('pro-install-date').value;
  if (!installDateStr) return;

  const installDate = new Date(installDateStr);
  const year = installDate.getFullYear();
  const month = installDate.getMonth();
  const installDay = installDate.getDate();

  // Jumlah total hari dalam bulan pemasangan
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  // Sisa hari aktif termasuk hari pasang
  const activeDays = Math.max(1, totalDaysInMonth - installDay + 1);

  const dailyRate = Math.round(fullPrice / totalDaysInMonth);
  calculatedProrateAmount = Math.round(dailyRate * activeDays);

  document.getElementById('pro-days').innerText = `${activeDays} hari (dari ${totalDaysInMonth} hari)`;
  document.getElementById('pro-daily-rate').innerText = formatRupiah(dailyRate);
  document.getElementById('pro-total').innerText = formatRupiah(calculatedProrateAmount);
}

function copyProrateToManualInvoice() {
  closeModal('modal-prorate');
  openManualInvoiceModal();
  setTimeout(() => {
    document.getElementById('inv-man-amount').value = calculatedProrateAmount;
    document.getElementById('inv-man-notes').value = `Tagihan Pertama (Prorate Pasang Baru)`;
    showToast(`Biaya prorate ${formatRupiah(calculatedProrateAmount)} disalin ke form tagihan!`, 'success');
  }, 200);
}

