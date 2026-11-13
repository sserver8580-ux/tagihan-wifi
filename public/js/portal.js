// public/js/portal.js - Logika Portal Pelanggan Tagihan Wifi Proxy.net
let currentSearchData = null;

// PWA Support Portal
let deferredPortalPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPortalPrompt = e;
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
});

function installPWA() {
  if (deferredPortalPrompt) {
    deferredPortalPrompt.prompt();
    deferredPortalPrompt.userChoice.then(choice => {
      deferredPortalPrompt = null;
      const banner = document.getElementById('pwa-install-banner');
      if (banner) banner.style.display = 'none';
    });
  } else {
    openModal('modal-install-guide');
  }
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});

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
  }, 4000);
}

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(number);
}

function copyText(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const text = el.innerText;
  navigator.clipboard.writeText(text);
  showToast('Nomor rekening berhasil disalin: ' + text, 'success');
}

async function handleSearch(e) {
  e.preventDefault();
  const query = document.getElementById('input-query').value.trim();
  if (!query) return;

  try {
    const res = await fetch(`/api/public/check-bill?query=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Data tidak ditemukan');
    }

    currentSearchData = data;
    renderPortalResult(data);
    showToast(`Data tagihan ditemukan untuk ${data.customer.name}`, 'success');
  } catch (err) {
    showToast(err.message, 'danger');
    document.getElementById('result-area').style.display = 'none';
  }
}

function renderPortalResult(data) {
  const cust = data.customer;
  const invoices = data.invoices;
  const set = data.settings;

  document.getElementById('result-area').style.display = 'block';

  // Update badge domain aktif
  const activeDomain = window.location.origin;
  const domainBadge = document.querySelector('.portal-hero .badge');
  if (domainBadge) {
    domainBadge.innerText = `🔒 ${activeDomain}`;
  }
  document.getElementById('res-code').innerText = cust.customer_code;
  document.getElementById('res-name').innerText = cust.name;
  document.getElementById('res-address').innerText = cust.address;
  document.getElementById('res-package').innerText = `${cust.package_name || 'Paket WiFi'} (${cust.package_speed || ''})`;
  document.getElementById('res-price').innerText = formatRupiah(cust.package_price || 0) + ' / bulan';
  document.getElementById('res-due').innerText = `Jatuh Tempo: Setiap Tanggal ${cust.due_day}`;

  const statusBadge = document.getElementById('res-status-badge');
  if (cust.status === 'active') {
    statusBadge.innerHTML = `<span class="badge badge-active" style="font-size: 13px; padding: 6px 14px;">🟢 Koneksi Internet AKTIF</span>`;
  } else if (cust.status === 'isolated') {
    statusBadge.innerHTML = `<span class="badge badge-isolated" style="font-size: 13px; padding: 6px 14px;">🔴 Status TERISOLIR (Tunggakan)</span>`;
  } else {
    statusBadge.innerHTML = `<span class="badge badge-inactive" style="font-size: 13px; padding: 6px 14px;">⚪ Nonaktif</span>`;
  }

  // Rekening Bank
  if (set.bank_account_1) document.getElementById('bank-info-1').innerText = set.bank_account_1;
  if (set.bank_account_2) document.getElementById('bank-info-2').innerText = set.bank_account_2;

  // Daftar Tagihan
  const listEl = document.getElementById('invoices-list');
  if (!invoices || invoices.length === 0) {
    listEl.innerHTML = `<div style="text-align: center; color: var(--gray-500); padding: 20px;">Tidak ada catatan tagihan untuk akun ini.</div>`;
    return;
  }

  listEl.innerHTML = invoices.map(inv => {
    const isPaid = inv.status === 'paid';
    return `
      <div class="invoice-card ${isPaid ? 'paid' : 'unpaid'}">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
          <div>
            <span style="font-size: 11px; font-weight: 700; color: var(--gray-500); text-transform: uppercase;">
              Periode: Bulan ${inv.period_month}/${inv.period_year}
            </span>
            <div style="font-size: 14px; font-weight: 800; color: var(--gray-900); margin-top: 2px;">
              ${inv.invoice_number}
            </div>
            <div style="font-size: 12px; color: var(--gray-500); margin-top: 4px;">
              Jatuh Tempo: <strong>${inv.due_date}</strong>
            </div>
          </div>
          <div style="text-align: right;">
            <span class="badge badge-${inv.status}" style="font-size: 12px;">
              ${isPaid ? '✅ LUNAS' : '⏳ BELUM DIBAYAR'}
            </span>
            <div style="font-size: 18px; font-weight: 800; color: ${isPaid ? '#10b981' : '#dc2626'}; margin-top: 6px;">
              ${formatRupiah(inv.total_amount)}
            </div>
          </div>
        </div>

        ${!isPaid ? `
          <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--gray-300); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <span style="font-size: 12.5px; color: var(--gray-600);">
              Silakan transfer sebesar <strong>${formatRupiah(inv.total_amount)}</strong> lalu konfirmasi:
            </span>
            <button class="btn btn-wa btn-sm" onclick="sendWaConfirmation('${inv.invoice_number}', ${inv.total_amount}, '${inv.period_month}/${inv.period_year}')">
              📲 Konfirmasi Bayar via WhatsApp
            </button>
          </div>
        ` : `
          <div style="margin-top: 10px; font-size: 12px; color: #15803d;">
            Dibayar via ${inv.payment_method || 'Kasir'} pada ${inv.paid_at || '-'}
          </div>
        `}
      </div>
    `;
  }).join('');
}

function sendWaConfirmation(invNumber, amount, period) {
  if (!currentSearchData) return;
  const cust = currentSearchData.customer;
  const set = currentSearchData.settings;
  const csPhone = (set.company_phone || '081234567890').replace(/^0/, '62').replace(/[^0-9]/g, '');

  const text = `Halo Admin Tagihan Wifi Proxy.net,\n\nSaya ingin konfirmasi pembayaran tagihan WiFi:\n- ID Pelanggan: ${cust.customer_code}\n- Nama: ${cust.name}\n- No. Invoice: ${invNumber}\n- Periode: ${period}\n- Jumlah: Rp ${amount.toLocaleString('id-ID')}\n\n(Berikut saya lampirkan bukti transfer pembayaran)`;
  const url = `https://wa.me/${csPhone}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

async function handleSubmitTicket(e) {
  e.preventDefault();
  if (!currentSearchData) {
    showToast('Silakan cari data pelanggan terlebih dahulu', 'warning');
    return;
  }

  const cust = currentSearchData.customer;
  const issue_type = document.getElementById('ticket-issue').value;
  const description = document.getElementById('ticket-desc').value.trim();

  try {
    const res = await fetch('/api/public/submit-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_identifier: cust.customer_code,
        issue_type,
        description
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengirim laporan');

    showToast(`Laporan terkirim! Nomor Tiket Anda: ${data.ticket_number}`, 'success');
    document.getElementById('ticket-desc').value = '';
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

