/* ════════════════════════════════════════════════════════════════
   Electricity Bills Tracker — Frontend App
   ════════════════════════════════════════════════════════════════ */

const API = '';  // same-origin

// ── State ─────────────────────────────────────────────────────────
let allCustomers = [];
let allBills = [];

// ── Bootstrap ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  loadCustomers();
  loadBills();
  loadTrackerByCustomer();

  // Set default month/year filter to current month
  const now = new Date();
  document.getElementById('filter-month').value = now.getMonth() + 1;
  document.getElementById('filter-year').value  = now.getFullYear();

  // Wire up update-bill form live preview inputs
  ['ub-startdate','ub-stopdate','ub-qty','ub-perday','ub-collected'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateBillPreview);
  });
});

// ── Tab Navigation ─────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tracker') loadTrackerByCustomer();
    });
  });
}

function switchTracker(type) {
  document.querySelectorAll('.tracker-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tracker-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tracker-tab[data-tracker="${type}"]`).classList.add('active');
  document.getElementById(`tracker-${type}`).classList.add('active');
  if (type === 'by-customer') loadTrackerByCustomer();
}

// ── API Helpers ────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const res = await fetch(API + url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ══════════════════════════════════════════════════════════════════
//  CUSTOMERS
// ══════════════════════════════════════════════════════════════════

async function loadCustomers() {
  try {
    allCustomers = await apiFetch('/api/customers');
    renderCustomers(allCustomers);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderCustomers(customers) {
  const tbody = document.getElementById('customer-tbody');
  if (!customers.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No customers found. Add your first customer!</td></tr>';
    return;
  }
  tbody.innerHTML = customers.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.mobileNumber)}</td>
      <td>${esc(c.address) || '<span style="color:var(--gray-400)">—</span>'}</td>
      <td>${formatDate(c.createdAt)}</td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-icon btn-edit" onclick="openEditCustomer('${c.id}')">✏️ Edit</button>
          <button class="btn btn-icon btn-del"  onclick="confirmDelete('customer','${c.id}','${esc(c.name)}')">🗑️ Delete</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterCustomers() {
  const q = document.getElementById('customer-search').value.toLowerCase();
  const filtered = allCustomers.filter(c =>
    c.name.toLowerCase().includes(q) || c.mobileNumber.includes(q)
  );
  renderCustomers(filtered);
}

// Add customer
async function submitAddCustomer(e) {
  e.preventDefault();
  try {
    await apiFetch('/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        name:         document.getElementById('c-name').value.trim(),
        mobileNumber: document.getElementById('c-mobile').value.trim(),
        address:      document.getElementById('c-address').value.trim()
      })
    });
    closeModal('modal-add-customer');
    document.getElementById('form-add-customer').reset();
    showToast('Customer added successfully!', 'success');
    await loadCustomers();
  } catch (e) { showToast(e.message, 'error'); }
}

// Edit customer
function openEditCustomer(id) {
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  document.getElementById('ec-id').value      = c.id;
  document.getElementById('ec-name').value    = c.name;
  document.getElementById('ec-mobile').value  = c.mobileNumber;
  document.getElementById('ec-address').value = c.address;
  openModal('modal-edit-customer');
}

async function submitEditCustomer(e) {
  e.preventDefault();
  const id = document.getElementById('ec-id').value;
  try {
    await apiFetch(`/api/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name:         document.getElementById('ec-name').value.trim(),
        mobileNumber: document.getElementById('ec-mobile').value.trim(),
        address:      document.getElementById('ec-address').value.trim()
      })
    });
    closeModal('modal-edit-customer');
    showToast('Customer updated!', 'success');
    await loadCustomers();
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════
//  BILLS
// ══════════════════════════════════════════════════════════════════

async function loadBills() {
  try {
    allBills = await apiFetch('/api/bills');
    renderBills(allBills);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderBills(bills) {
  const tbody = document.getElementById('bills-tbody');
  if (!bills.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">No bills found.</td></tr>';
    return;
  }
  tbody.innerHTML = bills.map((b, i) => {
    const cust = allCustomers.find(c => c.id === b.customerId) || {};
    return `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(cust.name || '—')}</strong></td>
      <td>${formatDate(b.startDate)}</td>
      <td>${b.stopDate ? formatDate(b.stopDate) : '<span class="badge badge-active">Running</span>'}</td>
      <td>${b.numberOfDays}</td>
      <td>${b.quantity}</td>
      <td>₹${b.perDayCharge}</td>
      <td><strong>₹${b.total.toLocaleString()}</strong></td>
      <td style="color:var(--success)">₹${(b.collectedAmount||0).toLocaleString()}</td>
      <td style="color:${b.pendingAmount>0?'var(--danger)':'var(--success)'}">₹${b.pendingAmount.toLocaleString()}</td>
      <td><span class="badge badge-${b.status}">${b.status}</span></td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-icon btn-edit" onclick="openUpdateBill('${b.id}')">✏️ Update</button>
          <button class="btn btn-icon btn-del"  onclick="confirmDelete('bill','${b.id}','bill #${i+1}')">🗑️ Delete</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterBills() {
  const q      = document.getElementById('bill-search').value.toLowerCase();
  const status = document.getElementById('bill-filter-status').value;
  const filtered = allBills.filter(b => {
    const cust = allCustomers.find(c => c.id === b.customerId) || {};
    const matchName = (cust.name || '').toLowerCase().includes(q);
    const matchStatus = !status || b.status === status;
    return matchName && matchStatus;
  });
  renderBills(filtered);
}

// Add bill
function openAddBillModal() {
  populateCustomerDropdown('b-customer');
  setDateChip('today');
  openModal('modal-add-bill');
}

let activeDateChip = 'today';
function setDateChip(chip) {
  activeDateChip = chip;
  ['today','yesterday','custom'].forEach(c =>
    document.getElementById(`chip-${c}`).classList.toggle('active', c === chip)
  );
  const inp = document.getElementById('b-startdate');
  const today = new Date();
  if (chip === 'today') {
    inp.value = toInputDate(today);
    inp.style.display = '';
  } else if (chip === 'yesterday') {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    inp.value = toInputDate(y);
    inp.style.display = '';
  } else {
    inp.value = '';
    inp.style.display = '';
    inp.focus();
  }
}

async function submitAddBill(e) {
  e.preventDefault();
  try {
    await apiFetch('/api/bills', {
      method: 'POST',
      body: JSON.stringify({
        customerId:   document.getElementById('b-customer').value,
        startDate:    document.getElementById('b-startdate').value,
        quantity:     document.getElementById('b-qty').value,
        perDayCharge: document.getElementById('b-perday').value
      })
    });
    closeModal('modal-add-bill');
    document.getElementById('form-add-bill').reset();
    showToast('Bill added successfully!', 'success');
    await loadBills();
  } catch (e) { showToast(e.message, 'error'); }
}

// Update bill
function openUpdateBill(id) {
  const b = allBills.find(x => x.id === id);
  if (!b) return;
  const cust = allCustomers.find(c => c.id === b.customerId) || {};

  document.getElementById('ub-id').value         = b.id;
  document.getElementById('ub-startdate').value  = b.startDate ? b.startDate.substring(0,10) : '';
  document.getElementById('ub-stopdate').value   = b.stopDate  ? b.stopDate.substring(0,10)  : '';
  document.getElementById('ub-qty').value        = b.quantity;
  document.getElementById('ub-perday').value     = b.perDayCharge;
  document.getElementById('ub-collected').value  = b.collectedAmount || 0;

  document.getElementById('ub-customer-card').innerHTML = `
    <strong>${esc(cust.name || '—')}</strong>
    📞 ${esc(cust.mobileNumber || '—')}
    ${cust.address ? `<br>📍 ${esc(cust.address)}` : ''}
  `;

  updateBillPreview();
  openModal('modal-update-bill');
}

function updateBillPreview() {
  const start     = document.getElementById('ub-startdate').value;
  const stop      = document.getElementById('ub-stopdate').value || null;
  const qty       = parseFloat(document.getElementById('ub-qty').value) || 0;
  const perDay    = parseFloat(document.getElementById('ub-perday').value) || 0;
  const collected = parseFloat(document.getElementById('ub-collected').value) || 0;

  if (!start) return;
  const s = new Date(start);
  const e = stop ? new Date(stop) : new Date();
  s.setHours(0,0,0,0); e.setHours(0,0,0,0);
  const days    = Math.max(0, Math.floor((e - s) / 86400000));
  const total   = days * perDay * qty;
  const pending = Math.max(0, total - collected);

  document.getElementById('prev-days').textContent    = days;
  document.getElementById('prev-total').textContent   = '₹' + total.toLocaleString();
  document.getElementById('prev-pending').textContent = '₹' + pending.toLocaleString();
}

async function submitUpdateBill(e) {
  e.preventDefault();
  const id = document.getElementById('ub-id').value;
  try {
    await apiFetch(`/api/bills/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        startDate:       document.getElementById('ub-startdate').value,
        stopDate:        document.getElementById('ub-stopdate').value || null,
        quantity:        document.getElementById('ub-qty').value,
        perDayCharge:    document.getElementById('ub-perday').value,
        collectedAmount: document.getElementById('ub-collected').value
      })
    });
    closeModal('modal-update-bill');
    showToast('Bill updated successfully!', 'success');
    await loadBills();
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════
//  TRACKER
// ══════════════════════════════════════════════════════════════════

async function loadTrackerByCustomer() {
  try {
    const data = await apiFetch('/api/tracker/customers');
    renderTrackerByCustomer(data);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderTrackerByCustomer(data) {
  const container = document.getElementById('tracker-customer-list');
  if (!data.length) {
    container.innerHTML = '<p class="hint">No customers yet.</p>';
    return;
  }
  container.innerHTML = data.map(c => {
    const totalAmt      = c.bills.reduce((s, b) => s + b.total, 0);
    const totalCollected = c.bills.reduce((s, b) => s + (b.collectedAmount||0), 0);
    const totalPending  = c.bills.reduce((s, b) => s + b.pendingAmount, 0);
    const activeBills   = c.bills.filter(b => b.status === 'active').length;

    const billRows = c.bills.length ? c.bills.map((b, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${b.quantity}</td>
        <td>${formatDate(b.startDate)}</td>
        <td>${b.stopDate ? formatDate(b.stopDate) : '—'}</td>
        <td>${b.numberOfDays}</td>
        <td>₹${b.perDayCharge}</td>
        <td><strong>₹${b.total.toLocaleString()}</strong></td>
        <td style="color:var(--success)">₹${(b.collectedAmount||0).toLocaleString()}</td>
        <td style="color:${b.pendingAmount>0?'var(--danger)':'var(--success)'}">₹${b.pendingAmount.toLocaleString()}</td>
        <td><span class="badge badge-${b.status}">${b.status}</span></td>
      </tr>`).join('') :
      '<tr><td colspan="10" class="empty-row">No bills for this customer.</td></tr>';

    return `
    <div class="tracker-customer-card" id="tcc-${c.id}">
      <div class="tracker-customer-header" onclick="toggleTrackerCard('${c.id}')">
        <div>
          <div class="tracker-customer-name">${esc(c.name)}</div>
          <div class="tracker-customer-meta">📞 ${esc(c.mobileNumber)}${c.address ? ' · ' + esc(c.address) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;">
          <span class="badge ${activeBills > 0 ? 'badge-active' : 'badge-stopped'}">${c.bills.length} bill${c.bills.length !== 1 ? 's' : ''}</span>
          <span class="tracker-chevron">▼</span>
        </div>
      </div>
      <div class="tracker-customer-body">
        <div class="tracker-stats">
          <span>Total Bills: <strong>${c.bills.length}</strong></span>
          <span>Active: <strong>${activeBills}</strong></span>
          <span>Total Amount: <strong>₹${totalAmt.toLocaleString()}</strong></span>
          <span>Collected: <strong style="color:var(--success)">₹${totalCollected.toLocaleString()}</strong></span>
          <span>Pending: <strong style="color:var(--danger)">₹${totalPending.toLocaleString()}</strong></span>
        </div>
        <div class="table-wrap" style="border:none;border-radius:0;box-shadow:none;">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Set Qty</th>
                <th>From Date</th>
                <th>Stopped Date</th>
                <th>No. of Days</th>
                <th>Per Day (₹)</th>
                <th>Total (₹)</th>
                <th>Collected (₹)</th>
                <th>Pending (₹)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${billRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleTrackerCard(id) {
  const card = document.getElementById(`tcc-${id}`);
  card.classList.toggle('expanded');
}

async function loadTrackerByBill() {
  const month = document.getElementById('filter-month').value;
  const year  = document.getElementById('filter-year').value;
  try {
    const data = await apiFetch(`/api/tracker/bills?month=${month}&year=${year}`);
    renderTrackerByBill(data, month, year);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderTrackerByBill(data, month, year) {
  // Summary cards
  const months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('tracker-summary-cards').innerHTML = `
    <div class="summary-card">
      <div class="sc-label">Period</div>
      <div class="sc-value" style="font-size:1.1rem">${months[month]} ${year}</div>
    </div>
    <div class="summary-card">
      <div class="sc-label">Total Bills</div>
      <div class="sc-value">${data.totalBills}</div>
    </div>
    <div class="summary-card sc-total">
      <div class="sc-label">Total Amount</div>
      <div class="sc-value">₹${data.totalAmount.toLocaleString()}</div>
    </div>
    <div class="summary-card sc-collected">
      <div class="sc-label">Collected</div>
      <div class="sc-value">₹${data.totalCollected.toLocaleString()}</div>
    </div>
    <div class="summary-card sc-pending">
      <div class="sc-label">Pending</div>
      <div class="sc-value">₹${data.totalPending.toLocaleString()}</div>
    </div>
  `;

  const tbody = document.getElementById('tracker-bills-tbody');
  if (!data.bills.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">No bills found for this period.</td></tr>';
    return;
  }
  tbody.innerHTML = data.bills.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(b.customerName)}</strong></td>
      <td>${esc(b.customerMobile)}</td>
      <td>${formatDate(b.startDate)}</td>
      <td>${b.stopDate ? formatDate(b.stopDate) : '<span class="badge badge-active">Running</span>'}</td>
      <td>${b.numberOfDays}</td>
      <td>${b.quantity}</td>
      <td>₹${b.perDayCharge}</td>
      <td><strong>₹${b.total.toLocaleString()}</strong></td>
      <td style="color:var(--success)">₹${(b.collectedAmount||0).toLocaleString()}</td>
      <td style="color:${b.pendingAmount>0?'var(--danger)':'var(--success)'}">₹${b.pendingAmount.toLocaleString()}</td>
      <td><span class="badge badge-${b.status}">${b.status}</span></td>
    </tr>`).join('');
}

// ══════════════════════════════════════════════════════════════════
//  DELETE (Shared)
// ══════════════════════════════════════════════════════════════════

function confirmDelete(type, id, label) {
  document.getElementById('confirm-delete-msg').textContent =
    `Are you sure you want to delete "${label}"? This cannot be undone.`;
  document.getElementById('confirm-delete-btn').onclick = () => doDelete(type, id);
  openModal('modal-confirm-delete');
}

async function doDelete(type, id) {
  closeModal('modal-confirm-delete');
  try {
    if (type === 'customer') {
      await apiFetch(`/api/customers/${id}`, { method: 'DELETE' });
      showToast('Customer deleted.', 'success');
      await loadCustomers();
      await loadBills();
    } else {
      await apiFetch(`/api/bills/${id}`, { method: 'DELETE' });
      showToast('Bill deleted.', 'success');
      await loadBills();
    }
    loadTrackerByCustomer();
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════
//  MODAL HELPERS
// ══════════════════════════════════════════════════════════════════

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

function closeModalOutside(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

// ══════════════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════════════

function populateCustomerDropdown(selectId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">-- Select Customer --</option>' +
    allCustomers.map(c => `<option value="${c.id}">${esc(c.name)} — ${esc(c.mobileNumber)}</option>`).join('');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toInputDate(d) {
  return d.toISOString().substring(0, 10);
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3000);
}
