// ── State ──────────────────────────────────────────────────────
let allCustomers   = [];
let allBills       = [];
let trackerData    = [];   // by-customer tracker cache
let lastBSData     = null; // last loaded balance-sheet payload

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Load version from version.txt and inject into About page
  fetch('version.txt')
    .then(r => r.text())
    .then(v => {
      const ver = v.trim();
      const el1 = document.getElementById('about-version');
      const el2 = document.getElementById('about-version-footer');
      if (el1) el1.textContent = ver;
      if (el2) el2.textContent = ver;
    })
    .catch(() => {});

  // Main tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tracker') loadTrackerByCustomer();
    });
  });

  // Default month/year selectors to current month
  const now = new Date();
  document.getElementById('filter-month').value    = now.getMonth() + 1;
  document.getElementById('filter-year').value     = now.getFullYear();
  document.getElementById('bs-filter-month').value = now.getMonth() + 1;
  document.getElementById('bs-filter-year').value  = now.getFullYear();

  // Bill preview live listeners
  ['ub-startdate', 'ub-stopdate', 'ub-qty', 'ub-perday'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateBillPreview);
  });

  setDateChip('today');
  loadCustomers();
  loadBills();
  loadTrackerByCustomer();
});

// ── API helper — routes to localStorage DB (works offline / in APK) ──
async function apiFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const body   = opts.body ? JSON.parse(opts.body) : null;
  return DB.route(method, url, body);
}

// ── Tracker tab switcher ───────────────────────────────────────
function switchTracker(type) {
  document.querySelectorAll('.tracker-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tracker-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tracker-tab[data-tracker="${type}"]`).classList.add('active');
  document.getElementById(`tracker-${type}`).classList.add('active');
  if (type === 'by-customer') loadTrackerByCustomer();
}

// ══════════════════════════════════════════════════════════════
//  CUSTOMERS
// ══════════════════════════════════════════════════════════════

async function loadCustomers() {
  try {
    allCustomers = await apiFetch('/api/customers');
    renderCustomers(allCustomers);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderCustomers(list) {
  const tbody = document.getElementById('customer-tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No customers found.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.mobile)}</td>
      <td>${esc(c.address || '—')}</td>
      <td>${fmtDate(c.createdAt)}</td>
      <td class="actions-cell">
        <button class="btn btn-icon btn-edit" onclick="openEditCustomer('${c.id}')">✏️ Edit</button>
        <button class="btn btn-icon btn-del"  onclick="confirmDelete('customer','${c.id}','${esc(c.name)}')">🗑 Delete</button>
      </td>
    </tr>
  `).join('');
}

function filterCustomers() {
  const q = document.getElementById('customer-search').value.toLowerCase();
  renderCustomers(allCustomers.filter(c => c.name.toLowerCase().includes(q) || c.mobile.includes(q)));
}

async function submitAddCustomer(e) {
  e.preventDefault();
  const body = {
    name:    document.getElementById('c-name').value.trim(),
    mobile:  document.getElementById('c-mobile').value.trim(),
    address: document.getElementById('c-address').value.trim(),
  };
  try {
    const customer = await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(body) });
    closeModal('modal-add-customer');
    document.getElementById('form-add-customer').reset();
    showToast('Customer added!', 'success');
    loadCustomers();
    promptWhatsApp(customer.mobile, [
      `Dear ${customer.name},`,
      ``,
      `Welcome to iApp Solutions Electricity Service! ⚡`,
      `Your account has been successfully registered.`,
      ``,
      `Name   : ${customer.name}`,
      `Mobile : ${customer.mobile}`,
      `Address: ${customer.address || 'N/A'}`,
      ``,
      `We will notify you when your electricity bill is generated.`,
      `Thank you for choosing our service!`,
    ].join('\n'));
  } catch (e) { showToast(e.message, 'error'); }
}

function openEditCustomer(id) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  document.getElementById('ec-id').value      = c.id;
  document.getElementById('ec-name').value    = c.name;
  document.getElementById('ec-mobile').value  = c.mobile;
  document.getElementById('ec-address').value = c.address || '';
  openModal('modal-edit-customer');
}

async function submitEditCustomer(e) {
  e.preventDefault();
  const id   = document.getElementById('ec-id').value;
  const body = {
    name:    document.getElementById('ec-name').value.trim(),
    mobile:  document.getElementById('ec-mobile').value.trim(),
    address: document.getElementById('ec-address').value.trim(),
  };
  try {
    await apiFetch(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    closeModal('modal-edit-customer');
    showToast('Customer updated!', 'success');
    loadCustomers();
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  BILLS
// ══════════════════════════════════════════════════════════════

async function loadBills() {
  const status = document.getElementById('bill-filter-status').value;
  try {
    const url = status ? `/api/bills?status=${status}` : '/api/bills';
    allBills = await apiFetch(url);
    renderBills(allBills);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderBills(bills) {
  const tbody = document.getElementById('bills-tbody');
  if (!bills.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">No bills found.</td></tr>';
    return;
  }
  tbody.innerHTML = bills.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(b.customerName || '—')}</strong></td>
      <td>${fmtDate(b.startDate)}</td>
      <td>${b.stopDate ? fmtDate(b.stopDate) : `<span class="running-date">${fmtDate(toDateStr(new Date()))} ⏳</span>`}</td>
      <td>${b.numberOfDays ?? 0}</td>
      <td>${b.quantity}</td>
      <td>₹${b.perDayCharge}</td>
      <td>₹${(b.total ?? 0).toLocaleString()}</td>
      <td>₹${(b.collectedAmount ?? 0).toLocaleString()}</td>
      <td>₹${(b.pendingAmount ?? 0).toLocaleString()}</td>
      <td><span class="badge badge-${b.status}">${b.status}</span></td>
      <td class="actions-cell">
        <button class="btn btn-icon btn-edit" onclick="openUpdateBill('${b.id}')">✏️ Edit</button>
        ${b.status === 'active' ? `<button class="btn btn-icon btn-stop" onclick="stopBill('${b.id}')">⏹ Stop</button>` : ''}
        <button class="btn btn-icon btn-del" onclick="confirmDelete('bill','${b.id}','bill #${i + 1}')">🗑 Delete</button>
      </td>
    </tr>
  `).join('');
}

function filterBills() {
  const q = document.getElementById('bill-search').value.toLowerCase();
  renderBills(allBills.filter(b => (b.customerName || '').toLowerCase().includes(q)));
}

function openAddBillModal() {
  populateCustomerDropdown('b-customer');
  setDateChip('today');
  openModal('modal-add-bill');
}

function setDateChip(chip) {
  ['today', 'yesterday', 'custom'].forEach(c => document.getElementById(`chip-${c}`)?.classList.remove('active'));
  document.getElementById(`chip-${chip}`)?.classList.add('active');
  const inp = document.getElementById('b-startdate');
  const now = new Date();
  if (chip === 'today') {
    inp.value    = toDateStr(now);
    inp.readOnly = true;
  } else if (chip === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    inp.value    = toDateStr(y);
    inp.readOnly = true;
  } else {
    inp.value    = '';
    inp.readOnly = false;
    inp.focus();
  }
}

async function submitAddBill(e) {
  e.preventDefault();
  const body = {
    customerId:   document.getElementById('b-customer').value,
    startDate:    document.getElementById('b-startdate').value,
    quantity:     parseInt(document.getElementById('b-qty').value),
    perDayCharge: parseInt(document.getElementById('b-perday').value),
  };
  try {
    const bill = await apiFetch('/api/bills', { method: 'POST', body: JSON.stringify(body) });
    closeModal('modal-add-bill');
    document.getElementById('form-add-bill').reset();
    showToast('Bill added!', 'success');
    loadBills();
    loadTrackerByCustomer();
    promptWhatsApp(bill.customerMobile, [
      `Dear ${bill.customerName},`,
      ``,
      `Your electricity meter has been started. ⚡`,
      ``,
      `Start Date : ${fmtDate(bill.startDate)}`,
      `Sets (Qty) : ${bill.quantity}`,
      `Rate       : ₹${bill.perDayCharge}/day per set`,
      ``,
      `Billing is now active. You will receive a final bill once the meter is stopped.`,
      `For any queries, please contact us.`,
      `Thank you!`,
    ].join('\n'));
  } catch (e) { showToast(e.message, 'error'); }
}

function openUpdateBill(id) {
  const b = allBills.find(x => x.id === id);
  if (!b) return;
  const c = allCustomers.find(x => x.id === b.customerId);
  document.getElementById('ub-customer-card').innerHTML = c
    ? `<strong>${esc(c.name)}</strong> · ${esc(c.mobile)} · ${esc(c.address || '')}`
    : '';
  document.getElementById('ub-id').value        = b.id;
  document.getElementById('ub-startdate').value  = b.startDate || '';
  document.getElementById('ub-stopdate').value   = b.stopDate  || '';
  document.getElementById('ub-qty').value        = b.quantity;
  document.getElementById('ub-perday').value     = b.perDayCharge;
  document.getElementById('ub-collected').value  = b.collectedAmount || 0;
  openModal('modal-update-bill');
  updateBillPreview();
}

function updateBillPreview() {
  const start     = document.getElementById('ub-startdate').value;
  const stop      = document.getElementById('ub-stopdate').value;
  const qty       = parseInt(document.getElementById('ub-qty').value)      || 0;
  const perDay    = parseInt(document.getElementById('ub-perday').value)    || 0;
  const collected = parseInt(document.getElementById('ub-collected').value) || 0;
  if (!start) return;
  const s    = new Date(start);
  const e2   = stop ? new Date(stop) : new Date();
  const days = Math.max(0, Math.ceil((e2 - s) / 86400000));
  const total   = days * qty * perDay;
  const pending = Math.max(0, total - collected);
  document.getElementById('prev-days').textContent    = days;
  document.getElementById('prev-total').textContent   = `₹${total.toLocaleString()}`;
  document.getElementById('prev-pending').textContent = `₹${pending.toLocaleString()}`;
}

async function submitUpdateBill(e) {
  e.preventDefault();
  const id   = document.getElementById('ub-id').value;
  const body = {
    startDate:       document.getElementById('ub-startdate').value,
    stopDate:        document.getElementById('ub-stopdate').value || null,
    quantity:        parseInt(document.getElementById('ub-qty').value),
    perDayCharge:    parseInt(document.getElementById('ub-perday').value),
    collectedAmount: parseInt(document.getElementById('ub-collected').value) || 0,
  };
  try {
    const bill = await apiFetch(`/api/bills/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    closeModal('modal-update-bill');
    showToast('Bill updated!', 'success');
    loadBills();
    loadTrackerByCustomer();
    promptWhatsApp(bill.customerMobile, [
      `Dear ${bill.customerName},`,
      ``,
      `Your electricity bill has been updated. 📋`,
      ``,
      `Period  : ${fmtDate(bill.startDate)} → ${bill.stopDate ? fmtDate(bill.stopDate) : 'Running'}`,
      `Days    : ${bill.numberOfDays}`,
      `Sets    : ${bill.quantity}`,
      `Rate    : ₹${bill.perDayCharge}/day`,
      `Total   : ₹${(bill.total || 0).toLocaleString()}`,
      `Paid    : ₹${(bill.collectedAmount || 0).toLocaleString()}`,
      `Pending : ₹${(bill.pendingAmount || 0).toLocaleString()}`,
      ``,
      `For any queries, please contact us.`,
      `Thank you!`,
    ].join('\n'));
  } catch (e) { showToast(e.message, 'error'); }
}

function stopBill(id) {
  const bill = allBills.find(b => b.id === id);
  const name = bill?.customerName || 'Customer';
  document.getElementById('stop-sure-msg').textContent =
    `Are you sure you want to stop the bill for "${name}"?`;
  document.getElementById('stop-sure-confirm-btn').onclick = () => {
    closeModal('modal-stop-sure');
    const msg = [
      `Dear ${name},`,
      ``,
      `Your electricity meter has been stopped. ⏹`,
      ``,
      `Please make the pending payment at your earliest convenience.`,
      `Thank you!`,
    ].join('\n');
    document.getElementById('stop-confirm-msg').value = msg;
    document.getElementById('stop-confirm-send-btn').onclick = () => doStopBill(id);
    openModal('modal-stop-confirm');
  };
  openModal('modal-stop-sure');
}

async function doStopBill(id) {
  closeModal('modal-stop-confirm');
  try {
    const bill = await apiFetch(`/api/bills/${id}`, { method: 'PUT', body: JSON.stringify({ stopDate: toDateStr(new Date()) }) });
    showToast('Bill stopped!', 'warning');
    loadBills();
    loadTrackerByCustomer();
    const text = document.getElementById('stop-confirm-msg').value;
    const clean = (bill.customerMobile || '').replace(/\D/g, '');
    if (clean) window.open(`https://wa.me/91${clean}?text=${encodeURIComponent(text)}`, '_blank');
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  TRACKER – By Customer  (with WhatsApp reminder)
// ══════════════════════════════════════════════════════════════

async function loadTrackerByCustomer() {
  try {
    trackerData = await apiFetch('/api/tracker/customers');
    renderTrackerByCustomer(trackerData);
  } catch (e) {
    document.getElementById('tracker-customer-list').innerHTML =
      '<p class="hint">Failed to load tracker data.</p>';
  }
}

function renderTrackerByCustomer(data) {
  const container = document.getElementById('tracker-customer-list');
  if (!data.length) {
    container.innerHTML = '<p class="hint">No customers found.</p>';
    return;
  }

  container.innerHTML = data.map(c => {
    const activeBills    = c.bills.filter(b => b.status === 'active');
    const totalPending   = c.bills.reduce((s, b) => s + (b.pendingAmount   || 0), 0);
    const totalCollected = c.bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
    const hasActive      = activeBills.length > 0;

    return `
      <div class="tracker-customer-card" id="tcard-${c.id}">
        <div class="tracker-customer-header" onclick="toggleCustomerCard('${c.id}')">
          <div>
            <div class="tracker-customer-name">
              ${esc(c.name)}
              <span style="font-weight:400;font-size:.85rem;color:#64748b;">· ${esc(c.mobile)}</span>
            </div>
            <div class="tracker-customer-meta">
              ${c.bills.length} bill(s) · ${activeBills.length} active
              · ₹${totalPending.toLocaleString()} pending
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:.6rem;">
            ${hasActive ? `
              <button class="btn btn-whatsapp" title="Send WhatsApp reminder"
                onclick="event.stopPropagation(); sendWhatsAppReminder('${c.id}')">
                📱 WhatsApp
              </button>` : ''}
            <span class="tracker-chevron">▼</span>
          </div>
        </div>

        <div class="tracker-customer-body">
          <div class="tracker-stats">
            <span>Bills: <strong>${c.bills.length}</strong></span>
            <span>Active: <strong>${activeBills.length}</strong></span>
            <span>Collected: <strong>₹${totalCollected.toLocaleString()}</strong></span>
            <span>Pending: <strong style="color:var(--danger)">₹${totalPending.toLocaleString()}</strong></span>
          </div>
          <div class="table-wrap" style="border:none;box-shadow:none;border-radius:0;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th><th>Start</th><th>Stop</th><th>Days</th>
                  <th>Qty</th><th>Per Day</th><th>Total</th>
                  <th>Collected</th><th>Pending</th><th>Status</th><th>Remind</th>
                </tr>
              </thead>
              <tbody>
                ${c.bills.map((b, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td>${fmtDate(b.startDate)}</td>
                    <td>${b.stopDate ? fmtDate(b.stopDate) : '—'}</td>
                    <td>${b.numberOfDays ?? '—'}</td>
                    <td>${b.quantity}</td>
                    <td>₹${b.perDayCharge}</td>
                    <td>₹${(b.total ?? 0).toLocaleString()}</td>
                    <td>₹${(b.collectedAmount ?? 0).toLocaleString()}</td>
                    <td style="color:var(--danger);font-weight:600;">
                      ₹${(b.pendingAmount ?? 0).toLocaleString()}
                    </td>
                    <td><span class="badge badge-${b.status}">${b.status}</span></td>
                    <td>
                      ${b.status === 'active' ? `
                        <button class="btn btn-whatsapp btn-icon"
                          title="Remind via WhatsApp"
                          onclick="sendWhatsAppBillReminder('${c.id}', '${b.id}')">
                          📱
                        </button>` : '—'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleCustomerCard(id) {
  document.getElementById(`tcard-${id}`)?.classList.toggle('expanded');
}

// ── Bill Image Generation ──────────────────────────────────────
// Renders a bill card onto a canvas element and returns it.
function generateBillCanvas(d) {
  const W = 440, H = 490, PAD = 28, SCALE = 2;
  const cvs = document.createElement('canvas');
  cvs.width = W * SCALE; cvs.height = H * SCALE;
  cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
  const c = cvs.getContext('2d');
  c.scale(SCALE, SCALE);

  function rr(x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  const divider = yy => {
    c.strokeStyle = '#e2e8f0'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(PAD, yy); c.lineTo(W - PAD, yy); c.stroke();
  };

  // Card background
  rr(0, 0, W, H, 20); c.fillStyle = '#ffffff'; c.fill();

  // Green header (top corners rounded, bottom square via filled rect)
  c.fillStyle = '#16a34a';
  rr(0, 0, W, 96, 20); c.fill();
  c.fillRect(0, 76, W, 20);

  // Header text
  c.fillStyle = '#ffffff';
  c.font = 'bold 24px system-ui, -apple-system, sans-serif';
  c.fillText('\u26A1 Electricity Bill', PAD, 50);
  c.font = '13px system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.fillText('iApp Solutions', PAD, 78);

  let y = 114;

  // Greeting
  c.fillStyle = '#1e293b';
  c.font = 'bold 17px system-ui, sans-serif';
  c.fillText('Dear ' + d.name + ',', PAD, y); y += 24;
  c.font = '13px system-ui, sans-serif';
  c.fillStyle = '#64748b';
  c.fillText('Your electricity bill has been updated.', PAD, y); y += 18;

  divider(y + 4); y += 18;

  // Detail rows
  const details = [['Period', d.period], ['Days', d.days], ['Sets', d.sets], ['Rate', d.rate]];
  c.font = '13px system-ui, sans-serif';
  for (const [label, val] of details) {
    c.fillStyle = '#64748b'; c.textAlign = 'left';
    c.fillText(label, PAD, y);
    c.fillStyle = '#334155'; c.textAlign = 'right';
    c.fillText(val, W - PAD, y);
    c.textAlign = 'left'; y += 26;
  }

  divider(y + 2); y += 16;

  // Amount rows
  const amts = [
    ['Total',   d.total,   '#334155'],
    ['Paid',    d.paid,    '#16a34a'],
    ['Pending', d.pending, d.pendingAmt > 0 ? '#dc2626' : '#16a34a'],
  ];
  for (const [label, val, clr] of amts) {
    c.font = (label === 'Pending' ? 'bold ' : '') + '15px system-ui, sans-serif';
    c.fillStyle = '#64748b'; c.textAlign = 'left';
    c.fillText(label, PAD, y);
    c.fillStyle = clr; c.textAlign = 'right';
    c.fillText(val, W - PAD, y);
    c.textAlign = 'left'; y += 30;
  }

  divider(y + 2); y += 18;

  // Footer
  c.font = '12px system-ui, sans-serif';
  c.fillStyle = '#94a3b8';
  c.textAlign = 'center';
  c.fillText('For any queries, please contact us. Thank you!', W / 2, y);
  c.textAlign = 'left';

  return cvs;
}

// Shows the bill as a canvas image in a modal with Download & Share options.
function showBillImageModal(mobile, data) {
  const cvs = generateBillCanvas(data);
  const container = document.getElementById('bill-image-container');
  container.innerHTML = '';
  cvs.style.maxWidth = '100%';
  cvs.style.borderRadius = '12px';
  cvs.style.boxShadow = '0 2px 16px rgba(0,0,0,0.10)';
  container.appendChild(cvs);

  const clean = (mobile || '').replace(/\D/g, '');

  document.getElementById('bill-img-download').onclick = () => {
    const a = document.createElement('a');
    a.download = 'bill-' + (data.name || 'customer').replace(/\s+/g, '-') + '.png';
    a.href = cvs.toDataURL('image/png');
    a.click();
  };

  document.getElementById('bill-img-share').onclick = () => {
    cvs.toBlob(async blob => {
      const file = new File([blob], 'electricity-bill.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Electricity Bill' }); return; } catch (e) {}
      }
      // Fallback: download image then open WhatsApp
      const a = document.createElement('a');
      a.download = 'electricity-bill.png';
      a.href = cvs.toDataURL('image/png');
      a.click();
      if (clean) setTimeout(() => window.open('https://wa.me/91' + clean, '_blank'), 600);
    });
  };

  openModal('modal-bill-image');
}

// ── WhatsApp Notification Prompt ──────────────────────────────
// Shows a modal with an editable message preview before opening WhatsApp.
function promptWhatsApp(mobile, message) {
  const clean = (mobile || '').replace(/\D/g, '');
  if (!clean) return; // no mobile number — skip silently
  document.getElementById('wa-prompt-msg').value = message;
  document.getElementById('wa-prompt-send-btn').onclick = () => {
    const text = document.getElementById('wa-prompt-msg').value;
    window.open(`https://wa.me/91${clean}?text=${encodeURIComponent(text)}`, '_blank');
    closeModal('modal-wa-prompt');
  };
  openModal('modal-wa-prompt');
}

// Send reminder for ALL active bills of a customer
function sendWhatsAppReminder(customerId) {
  const customer = trackerData.find(c => c.id === customerId);
  if (!customer) return;

  const activeBills  = customer.bills.filter(b => b.status === 'active');
  const totalPending = activeBills.reduce((s, b) => s + (b.pendingAmount || 0), 0);
  if (!totalPending) { showToast('No pending amount for this customer.', 'warning'); return; }

  const mobile = customer.mobile.replace(/\D/g, '');
  const lines  = activeBills.map((b, i) =>
    `${i + 1}. ${fmtDate(b.startDate)} → ${b.stopDate ? fmtDate(b.stopDate) : 'Running'} | Qty:${b.quantity} | Pending: ₹${(b.pendingAmount || 0).toLocaleString()}`
  );
  const msg = [
    `Dear ${customer.name},`,
    ``,
    `This is a reminder for your pending electricity bill(s):`,
    ...lines,
    ``,
    `Total Pending: ₹${totalPending.toLocaleString()}`,
    ``,
    `Please make the payment at your earliest convenience.`,
    `Thank you!`,
  ].join('\n');

  window.open(`https://wa.me/91${mobile}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Send reminder for a specific bill — renders as a shareable image
function sendWhatsAppBillReminder(customerId, billId) {
  const customer = trackerData.find(c => c.id === customerId);
  if (!customer) return;
  const bill = customer.bills.find(b => b.id === billId);
  if (!bill) return;

  const start = bill.startDate ? new Date(bill.startDate) : null;
  const stop  = bill.stopDate  ? new Date(bill.stopDate)  : new Date();
  const days  = start ? Math.max(1, Math.ceil((stop - start) / 86400000)) : 1;
  const sets  = bill.quantity || 1;
  const total = bill.total || 0;
  const paid  = bill.collectedAmount || 0;
  const pending = bill.pendingAmount || 0;
  const rate  = (days && sets) ? Math.round(total / (days * sets)) : 0;
  const fmt   = d => d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';

  showBillImageModal(customer.mobile, {
    name:       customer.name,
    period:     fmt(start) + ' \u2192 ' + (bill.stopDate ? fmt(stop) : 'Running'),
    days:       String(days),
    sets:       String(sets),
    rate:       '\u20B9' + rate + '/day',
    total:      '\u20B9' + total.toLocaleString('en-IN'),
    paid:       '\u20B9' + paid.toLocaleString('en-IN'),
    pending:    '\u20B9' + pending.toLocaleString('en-IN'),
    pendingAmt: pending,
  });
}

// ══════════════════════════════════════════════════════════════
//  TRACKER – By Month/Year
// ══════════════════════════════════════════════════════════════

async function loadTrackerByBill() {
  const month = document.getElementById('filter-month').value;
  const year  = document.getElementById('filter-year').value;
  try {
    const data = await apiFetch(`/api/tracker/by-month?month=${month}&year=${year}`);
    const { bills, summary } = data;

    // Summary cards
    document.getElementById('tracker-summary-cards').innerHTML = `
      <div class="summary-card sc-total">
        <div class="sc-label">Total Bills</div>
        <div class="sc-value">${summary.totalBills}</div>
      </div>
      <div class="summary-card sc-total">
        <div class="sc-label">Total Charged</div>
        <div class="sc-value">₹${summary.totalCharged.toLocaleString()}</div>
      </div>
      <div class="summary-card sc-collected">
        <div class="sc-label">Collected</div>
        <div class="sc-value">₹${summary.totalCollected.toLocaleString()}</div>
      </div>
      <div class="summary-card sc-pending">
        <div class="sc-label">Pending</div>
        <div class="sc-value">₹${summary.totalPending.toLocaleString()}</div>
      </div>
    `;

    const tbody = document.getElementById('tracker-bills-tbody');
    if (!bills.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="empty-row">No bills found for this period.</td></tr>';
      return;
    }
    tbody.innerHTML = bills.map((b, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${esc(b.customerName)}</strong></td>
        <td>${esc(b.customerMobile || '')}</td>
        <td>${fmtDate(b.startDate)}</td>
        <td>${b.stopDate ? fmtDate(b.stopDate) : '—'}</td>
        <td>${b.numberOfDays ?? '—'}</td>
        <td>${b.quantity}</td>
        <td>₹${b.perDayCharge}</td>
        <td>₹${(b.total ?? 0).toLocaleString()}</td>
        <td>₹${(b.collectedAmount ?? 0).toLocaleString()}</td>
        <td>₹${(b.pendingAmount ?? 0).toLocaleString()}</td>
        <td><span class="badge badge-${b.status}">${b.status}</span></td>
      </tr>
    `).join('');
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  BALANCE SHEET
// ══════════════════════════════════════════════════════════════

const MONTH_NAMES = [
  '', 'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

async function loadBalanceSheet() {
  const month = document.getElementById('bs-filter-month').value;
  const year  = document.getElementById('bs-filter-year').value;
  try {
    lastBSData = await apiFetch(`/api/balance-sheet?month=${month}&year=${year}`);
    renderBalanceSheet(lastBSData);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderBalanceSheet(data) {
  const { month, year, bills, monthlyCharge, summary, stats } = data;
  const label = `${MONTH_NAMES[month]} ${year}`;
  const hasCharge = !!monthlyCharge;

  // ─── Revenue hero ────────────────────────────────────────────
  const revenueClass = stats.revenue >= 0 ? 'bs-revenue-profit' : 'bs-revenue-loss';
  const revenueLabel = stats.revenue >= 0 ? '📈 Profit' : '📉 Loss';
  document.getElementById('bs-revenue-card').innerHTML = `
    <div class="bs-revenue-card ${revenueClass}">
      <div class="bs-revenue-label">${label} — Revenue</div>
      <div class="bs-revenue-value">₹${Math.abs(stats.revenue).toLocaleString()}</div>
      <div class="bs-revenue-sub">${revenueLabel}
        &nbsp;=&nbsp; Collected ₹${summary.totalCollected.toLocaleString()}
        &nbsp;−&nbsp; Board Bill ₹${stats.projectedAmount.toLocaleString()}
      </div>
      ${!hasCharge ? '<div class="bs-no-charge-hint">⚠️ No monthly charge recorded yet. Add one to see accurate revenue.</div>' : ''}
    </div>
  `;

  // ─── Stats grid ──────────────────────────────────────────────
  document.getElementById('bs-stats-grid').innerHTML = `
    <div class="bs-stat-card">
      <div class="bs-stat-title">📦 Total Active Sets (Qty)</div>
      <div class="bs-stat-value">${summary.totalActiveQty}</div>
      <div class="bs-stat-hint">Avg ${summary.totalActiveQty * 20}–${summary.totalActiveQty * 25} units expected this month</div>
    </div>
    <div class="bs-stat-card">
      <div class="bs-stat-title">⚡ Units Projected vs Charged</div>
      <div class="bs-stat-row">
        <span class="bs-stat-chip bs-chip-blue">Projected: <strong>${stats.unitsProjected}</strong></span>
        <span class="bs-stat-chip bs-chip-orange">Board Charged: <strong>${stats.unitsCharged}</strong></span>
      </div>
      <div class="bs-stat-diff ${stats.unitsDiff >= 0 ? 'diff-over' : 'diff-under'}">
        ${stats.unitsDiff >= 0
          ? `+${stats.unitsDiff} units over projection`
          : `${stats.unitsDiff} units under projection`}
      </div>
    </div>
    <div class="bs-stat-card">
      <div class="bs-stat-title">💰 Expected Charge vs Board Bill</div>
      <div class="bs-stat-row">
        <span class="bs-stat-chip bs-chip-blue">Billed to Customers: <strong>₹${summary.totalCharged.toLocaleString()}</strong></span>
        <span class="bs-stat-chip bs-chip-orange">Board Bill: <strong>₹${stats.projectedAmount.toLocaleString()}</strong></span>
      </div>
      <div class="bs-stat-diff ${summary.totalCharged >= stats.projectedAmount ? 'diff-over' : 'diff-under'}">
        ${summary.totalCharged >= stats.projectedAmount
          ? `Billed ₹${(summary.totalCharged - stats.projectedAmount).toLocaleString()} more than board cost`
          : `Board cost ₹${(stats.projectedAmount - summary.totalCharged).toLocaleString()} more than billed`}
      </div>
    </div>
    <div class="bs-stat-card">
      <div class="bs-stat-title">🧾 Charged vs Collected</div>
      <div class="bs-stat-row">
        <span class="bs-stat-chip bs-chip-blue">Total Charged: <strong>₹${summary.totalCharged.toLocaleString()}</strong></span>
        <span class="bs-stat-chip bs-chip-green">Collected: <strong>₹${summary.totalCollected.toLocaleString()}</strong></span>
      </div>
      <div class="bs-collection-bar">
        <div class="bs-collection-fill" style="width:${stats.collectionRate}%"></div>
      </div>
      <div class="bs-stat-hint">Collection rate: <strong>${stats.collectionRate}%</strong>
        &nbsp;·&nbsp; Pending: <strong style="color:var(--danger)">₹${summary.totalPending.toLocaleString()}</strong>
      </div>
    </div>
  `;

  // ─── Donut charts ────────────────────────────────────────────
  function donutSVG(v1, v2, color1, color2, centerText) {
    const total = (v1 + v2) || 1;
    const r = 46, cx = 60, cy = 60;
    const circ = 2 * Math.PI * r;
    const arc1 = (v1 / total) * circ;
    const arc2 = circ - arc1;
    const offset = -(circ / 4);
    return `<svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color2}" stroke-width="15"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color1}" stroke-width="15"
        stroke-dasharray="${arc1.toFixed(2)} ${arc2.toFixed(2)}"
        stroke-dashoffset="${offset.toFixed(2)}" stroke-linecap="butt"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dy=".35em"
        font-size="12" font-weight="800" fill="#1e293b" font-family="inherit">${centerText}</text>
    </svg>`;
  }

  function donutCard(title, v1, v2, color1, color2, label1, label2, fmt1, fmt2, centerText) {
    return `<div class="bs-donut-card">
      <div class="bs-donut-title">${title}</div>
      <div class="bs-donut-svg-wrap">${donutSVG(v1, v2, color1, color2, centerText)}</div>
      <div class="bs-donut-legend">
        <div class="bs-donut-legend-item">
          <span class="bs-donut-legend-dot" style="background:${color1}"></span>
          <span>${label1}</span><strong>${fmt1}</strong>
        </div>
        <div class="bs-donut-legend-item">
          <span class="bs-donut-legend-dot" style="background:${color2}"></span>
          <span>${label2}</span><strong>${fmt2}</strong>
        </div>
      </div>
    </div>`;
  }

  const unitsPct = stats.unitsProjected
    ? Math.round((stats.unitsCharged / stats.unitsProjected) * 100) + '%' : '—';
  const chargePct = summary.totalCharged
    ? Math.round((stats.projectedAmount / summary.totalCharged) * 100) + '%' : '—';

  document.getElementById('bs-donut-charts').innerHTML =
    donutCard('⚡ Units Projected vs Charged',
      stats.unitsProjected, stats.unitsCharged,
      '#3b82f6', '#f97316',
      'Projected', 'Board Charged',
      stats.unitsProjected, stats.unitsCharged,
      unitsPct) +
    donutCard('💰 Expected Charge vs Board Bill',
      summary.totalCharged, stats.projectedAmount,
      '#3b82f6', '#f97316',
      'Billed to Customers', 'Board Bill',
      '₹' + summary.totalCharged.toLocaleString(),
      '₹' + stats.projectedAmount.toLocaleString(),
      chargePct) +
    donutCard('🧾 Charged vs Collected',
      summary.totalCollected, summary.totalPending,
      '#22c55e', '#ef4444',
      'Collected', 'Pending',
      '₹' + summary.totalCollected.toLocaleString(),
      '₹' + summary.totalPending.toLocaleString(),
      stats.collectionRate + '%');

  // ─── Monthly charge detail ───────────────────────────────────
  if (hasCharge) {
    document.getElementById('bs-comparison').innerHTML = `
      <div class="bs-charge-detail">
        <h4 class="bs-section-title">📋 Monthly Charge Details — ${label}</h4>
        <div class="bs-charge-grid">
          <div class="bs-charge-item"><span>Board Bill Paid</span><strong>₹${monthlyCharge.projectedAmount.toLocaleString()}</strong></div>
          <div class="bs-charge-item"><span>Bill Paid Date</span><strong>${monthlyCharge.billPaidDate ? fmtDate(monthlyCharge.billPaidDate) : '—'}</strong></div>
          <div class="bs-charge-item"><span>Units Charged</span><strong>${monthlyCharge.unitsCharged || '—'}</strong></div>
          <div class="bs-charge-item"><span>Comments</span><strong>${esc(monthlyCharge.comments || '—')}</strong></div>
        </div>
        <div style="margin-top:.75rem;text-align:right;">
          <button class="btn btn-secondary" onclick="openEditMonthlyCharge('${monthlyCharge.id}')">✏️ Edit</button>
          <button class="btn btn-danger" onclick="confirmDelete('monthly-charge','${monthlyCharge.id}','${label} charge')">🗑 Delete</button>
        </div>
      </div>
    `;
  } else {
    document.getElementById('bs-comparison').innerHTML = `
      <div class="bs-charge-empty">
        No monthly charge recorded for ${label}.
        <button class="btn btn-primary" style="margin-left:1rem;" onclick="openAddMonthlyChargeModal()">+ Add Now</button>
      </div>
    `;
  }

  // ─── Bills table ─────────────────────────────────────────────
  const billsSection = document.getElementById('bs-bills-section');
  billsSection.style.display = 'block';
  const tbody = document.getElementById('bs-bills-tbody');
  if (!bills.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No bills active in this month.</td></tr>';
    return;
  }
  tbody.innerHTML = bills.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(b.customerName)}</strong></td>
      <td>${esc(b.customerMobile || '')}</td>
      <td>${b.quantity}</td>
      <td>₹${(b.total ?? 0).toLocaleString()}</td>
      <td>₹${(b.collectedAmount ?? 0).toLocaleString()}</td>
      <td style="color:var(--danger);font-weight:600;">₹${(b.pendingAmount ?? 0).toLocaleString()}</td>
      <td><span class="badge badge-${b.status}">${b.status}</span></td>
    </tr>
  `).join('');
}

// ─── Monthly Charge Modal ─────────────────────────────────────

function openAddMonthlyChargeModal() {
  const month = document.getElementById('bs-filter-month').value;
  const year  = document.getElementById('bs-filter-year').value;
  document.getElementById('mc-modal-title').textContent = 'Add Monthly Charge';
  document.getElementById('mc-id').value             = '';
  document.getElementById('mc-month').value          = month;
  document.getElementById('mc-year').value           = year;
  document.getElementById('mc-projected-amount').value = '';
  document.getElementById('mc-bill-paid-date').value   = '';
  document.getElementById('mc-units-charged').value    = '';
  document.getElementById('mc-comments').value         = '';
  openModal('modal-monthly-charge');
}

function openEditMonthlyCharge(id) {
  if (!lastBSData?.monthlyCharge) return;
  const mc = lastBSData.monthlyCharge;
  document.getElementById('mc-modal-title').textContent    = 'Edit Monthly Charge';
  document.getElementById('mc-id').value                   = mc.id;
  document.getElementById('mc-month').value                = mc.month;
  document.getElementById('mc-year').value                 = mc.year;
  document.getElementById('mc-projected-amount').value     = mc.projectedAmount;
  document.getElementById('mc-bill-paid-date').value       = mc.billPaidDate || '';
  document.getElementById('mc-units-charged').value        = mc.unitsCharged || '';
  document.getElementById('mc-comments').value             = mc.comments || '';
  openModal('modal-monthly-charge');
}

async function submitMonthlyCharge(e) {
  e.preventDefault();
  const id   = document.getElementById('mc-id').value;
  const body = {
    month:           parseInt(document.getElementById('mc-month').value),
    year:            parseInt(document.getElementById('mc-year').value),
    projectedAmount: parseFloat(document.getElementById('mc-projected-amount').value) || 0,
    billPaidDate:    document.getElementById('mc-bill-paid-date').value || null,
    unitsCharged:    parseFloat(document.getElementById('mc-units-charged').value) || 0,
    comments:        document.getElementById('mc-comments').value.trim(),
  };
  try {
    if (id) {
      await apiFetch(`/api/monthly-charges/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await apiFetch('/api/monthly-charges', { method: 'POST', body: JSON.stringify(body) });
    }
    closeModal('modal-monthly-charge');
    showToast('Monthly charge saved!', 'success');
    loadBalanceSheet();
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  DELETE (customers / bills / monthly-charges)
// ══════════════════════════════════════════════════════════════

function confirmDelete(type, id, label) {
  document.getElementById('confirm-delete-msg').textContent =
    `Are you sure you want to delete "${label}"? This cannot be undone.`;
  document.getElementById('confirm-delete-btn').onclick = () => doDelete(type, id);
  openModal('modal-confirm-delete');
}

async function doDelete(type, id) {
  const urls = { customer: `/api/customers/${id}`, bill: `/api/bills/${id}`, 'monthly-charge': `/api/monthly-charges/${id}` };
  try {
    await apiFetch(urls[type], { method: 'DELETE' });
    closeModal('modal-confirm-delete');
    showToast('Deleted successfully.', 'success');
    if (type === 'customer')       { loadCustomers(); loadTrackerByCustomer(); }
    if (type === 'bill')           { loadBills();     loadTrackerByCustomer(); }
    if (type === 'monthly-charge') { loadBalanceSheet(); }
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  MODAL UTILITIES
// ══════════════════════════════════════════════════════════════

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function closeModalOutside(e, id) { if (e.target.id === id) closeModal(id); }

// ══════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════

function populateCustomerDropdown(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">-- Select Customer --</option>' +
    allCustomers.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.mobile)})</option>`).join('');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast show${type ? ' ' + type : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
