// ── State ──────────────────────────────────────────────────────
let allCustomers   = [];
let allBills       = [];
let trackerData    = [];   // by-customer tracker cache
let lastBSData     = null; // last loaded balance-sheet payload

// ── Validation helpers ─────────────────────────────────────────
function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('input-error');
  let err = el.parentElement.querySelector('.field-error');
  if (!err) { err = document.createElement('span'); err.className = 'field-error'; el.after(err); }
  err.textContent = msg;
}
function clearFieldError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('input-error');
  el.parentElement?.querySelector('.field-error')?.remove();
}
function validateFields(rules) {
  let ok = true;
  rules.forEach(r => {
    clearFieldError(r.id);
    const el = document.getElementById(r.id);
    if (!el) return;
    const raw = el.value;
    const val = typeof raw === 'string' ? raw.trim() : raw;
    if (r.required && !val) {
      showFieldError(r.id, `${r.label} is required.`); ok = false; return;
    }
    if (!val) return; // optional field left empty — skip further checks
    if (r.minLen && val.length < r.minLen) {
      showFieldError(r.id, `${r.label} must be at least ${r.minLen} characters.`); ok = false; return;
    }
    if (r.pattern && !r.pattern.test(val)) {
      showFieldError(r.id, r.patternMsg || `${r.label} is invalid.`); ok = false; return;
    }
    if (r.min !== undefined || r.max !== undefined) {
      const num = parseFloat(val);
      if (isNaN(num)) { showFieldError(r.id, `${r.label} must be a number.`); ok = false; return; }
      if (r.min !== undefined && num < r.min) { showFieldError(r.id, `${r.label} must be ≥ ${r.min}.`); ok = false; return; }
      if (r.max !== undefined && num > r.max) { showFieldError(r.id, `${r.label} must be ≤ ${r.max}.`); ok = false; return; }
    }
    if (r.isDate && isNaN(new Date(val).getTime())) {
      showFieldError(r.id, `${r.label} must be a valid date.`); ok = false; return;
    }
    if (r.afterField) {
      const other = document.getElementById(r.afterField)?.value;
      if (other && new Date(val) < new Date(other)) {
        showFieldError(r.id, `${r.label} must be on or after ${r.afterFieldLabel || r.afterField}.`); ok = false; return;
      }
    }
  });
  return ok;
}

// ── Bootstrap ──────────────────────────────────────────────────
// Load version from version.txt and populate About page
fetch('version.txt')
  .then(r => r.text())
  .then(v => {
    const ver = v.trim();
    const el1 = document.getElementById('app-version');
    const el2 = document.getElementById('app-version-contact');
    if (el1) el1.textContent = ver;
    if (el2) el2.textContent = ver;
  })
  .catch(() => {});

document.addEventListener('DOMContentLoaded', async () => {
  // Main tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'settings') loadSettings();
      if (btn.dataset.tab === 'home')     loadHome();
    });
  });

  // Load home on startup
  loadHome();

  // Default month/year selectors to current month
  const now = new Date();
  document.getElementById('filter-year').value     = now.getFullYear();
  selectTrackerMonth(now.getMonth() + 1);
  document.getElementById('bs-filter-year').value  = now.getFullYear();
  selectBSMonth(now.getMonth() + 1);

  // Bill preview live listeners
  ['ub-startdate', 'ub-stopdate', 'ub-qty', 'ub-perday'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateBillPreview);
  });

  // Clear field errors on user input
  [
    'c-name','c-mobile',
    'ec-name','ec-mobile',
    'b-customer','b-startdate','b-qty','b-perday','b-arrears',
    'ub-startdate','ub-stopdate','ub-qty','ub-perday','ub-collected','ub-arrears',
    'mc-year','mc-projected-amount','mc-units-charged','mc-bill-paid-date',
    'filter-year','bs-filter-year',
  ].forEach(id => {
    document.getElementById(id)?.addEventListener('input',  () => clearFieldError(id));
    document.getElementById(id)?.addEventListener('change', () => clearFieldError(id));
  });

  setDateChip('today');
  await Promise.all([loadCustomers(), loadBills()]);
  // Hide splash once initial data is ready
  const splash = document.getElementById('splash-screen');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('hide');
      setTimeout(() => splash.remove(), 520);
    }, 400);
  }

  // ── Android hardware back button ───────────────────────────────
  document.addEventListener('backbutton', function(e) {
    // 1. Close the topmost open modal
    const openModals = [...document.querySelectorAll('.modal-overlay.open')];
    if (openModals.length) {
      e.preventDefault();
      closeModal(openModals[openModals.length - 1].id);
      return;
    }
    // 2. Customer detail page is visible → go back to list
    if (document.getElementById('customer-detail-view')?.style.display !== 'none') {
      e.preventDefault();
      closeCustomerPage();
      return;
    }
    // 3. Already at root — minimize rather than exit
    e.preventDefault();
    if (window.Capacitor?.Plugins?.App) {
      window.Capacitor.Plugins.App.minimizeApp();
    }
  }, false);
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
}

// ══════════════════════════════════════════════════════════════
//  HOME
// ══════════════════════════════════════════════════════════════

async function loadHome() {
  try {
    const data = await apiFetch('/api/tracker/customers');   // same as loadCustomers uses

    // ── compute totals
    let totalPending = 0, totalCollected = 0, runningCount = 0;
    const runningCards = [];

    data.forEach(cust => {
      const bills = cust.bills || [];
      bills.forEach(b => {
        totalPending   += b.pendingAmount   || 0;
        totalCollected += b.collectedAmount || 0;
        if (b.status === 'active') {
          runningCount++;
          runningCards.push({ cust, bill: b });
        }
      });
    });

    // ── stat row
    document.getElementById('hs-val-customers').textContent  = data.length;
    document.getElementById('hs-val-running').textContent    = runningCount;
    document.getElementById('hs-val-pending').textContent    = '₹' + totalPending.toLocaleString();
    document.getElementById('hs-val-collected').textContent  = '₹' + totalCollected.toLocaleString();
    document.getElementById('hs-running-badge').textContent  = runningCount;

    // ── running set cards
    const list = document.getElementById('home-running-list');
    if (!runningCards.length) {
      list.innerHTML = '<p class="empty-row">No sets are currently running.</p>';
      return;
    }

    const today = new Date(); today.setHours(0,0,0,0);
    list.innerHTML = runningCards.map(({ cust, bill }) => {
      const start    = new Date(bill.startDate); start.setHours(0,0,0,0);
      const days     = Math.max(1, Math.round((today - start) / 86400000) + 1);
      const accrued  = days * (bill.perDayCharge || 0) * (bill.quantity || 1);
      const pending  = bill.pendingAmount || 0;
      const initials = cust.name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0,2);
      return `
        <div class="home-run-card" onclick="switchToCustomer('${cust.id}')">
          <div class="home-run-avatar">${initials}</div>
          <div class="home-run-body">
            <div class="home-run-top">
              <span class="home-run-name">${esc(cust.name)}</span>
              <span class="home-run-mobile">${esc(cust.mobile)}</span>
            </div>
            <div class="home-run-meta">
              <span>📅 ${fmtDate(bill.startDate)}</span>
              <span>⚡ ${days} day${days !== 1 ? 's' : ''} running</span>
              <span>📦 ${bill.quantity} set${bill.quantity !== 1 ? 's' : ''}</span>
              <span>₹${bill.perDayCharge}/day</span>
            </div>
            <div class="home-run-amounts">
              <div class="home-run-amt-block">
                <span class="home-run-amt-label">Accrued</span>
                <span class="home-run-amt-val">₹${accrued.toLocaleString()}</span>
              </div>
              <div class="home-run-amt-block home-run-amt-pending">
                <span class="home-run-amt-label">Pending</span>
                <span class="home-run-amt-val">₹${pending.toLocaleString()}</span>
              </div>
              <div class="home-run-amt-block home-run-amt-collected">
                <span class="home-run-amt-label">Collected</span>
                <span class="home-run-amt-val">₹${(bill.collectedAmount||0).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (e) {
    document.getElementById('home-running-list').innerHTML =
      `<p class="empty-row" style="color:var(--danger)">${e.message}</p>`;
  }
}

// Navigate to customer detail from Home
function switchToCustomer(id) {
  // activate customers tab then open the customer page
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="customers"]').classList.add('active');
  document.getElementById('tab-customers').classList.add('active');
  openCustomerPage(id);
}

// ══════════════════════════════════════════════════════════════
//  CUSTOMERS
// ══════════════════════════════════════════════════════════════

async function loadCustomers() {
  try {
    trackerData  = await apiFetch('/api/tracker/customers');
    allCustomers = trackerData.map(({ bills, ...c }) => c);
    renderCustomers(trackerData);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderCustomers(list) {
  const grid = document.getElementById('customer-grid');
  if (!list.length) {
    grid.innerHTML = '<p class="empty-row">No customers found.</p>';
    return;
  }
  grid.innerHTML = list.map((c, idx) => {
    const bills          = c.bills || [];
    const activeBills    = bills.filter(b => b.status === 'active');
    const totalPending   = bills.reduce((s, b) => s + (b.pendingAmount   || 0), 0);
    const totalCollected = bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
    const hasActive      = activeBills.length > 0;
    return `
      <div class="cust-card" onclick="openCustomerPage('${c.id}')">
        <div class="cust-card-top">
          <div class="cust-card-num">${idx + 1}</div>
          <div class="cust-card-info">
            <div class="cust-card-name">${esc(c.name)}</div>
            <div class="cust-card-mobile">${esc(c.mobile)}</div>
            <div class="cust-card-stats">
              <span class="cstat"><span>Bills</span><strong>${bills.length}</strong></span>
              <span class="cstat ${hasActive ? 'cstat-active' : ''}"><span>Active</span><strong>${activeBills.length}</strong></span>
              <span class="cstat cstat-pending"><span>Pending</span><strong>₹${totalPending.toLocaleString()}</strong></span>
              <span class="cstat cstat-collected"><span>Collected</span><strong>₹${totalCollected.toLocaleString()}</strong></span>
            </div>
          </div>
        </div>
        <div class="cust-card-actions" onclick="event.stopPropagation()">
          ${hasActive ? `<button class="btn btn-whatsapp btn-icon" title="WhatsApp Reminder" onclick="sendWhatsAppReminder('${c.id}')">📱</button>` : ''}
          <a class="btn btn-icon btn-call" title="Call" href="tel:${esc(c.mobile)}">📞</a>
          <button class="btn btn-icon btn-edit" title="Edit" onclick="openEditCustomer('${c.id}')">✏️</button>
          <button class="btn btn-icon btn-del"  title="Delete" onclick="confirmDelete('customer','${c.id}','${esc(c.name)}')">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Customer Detail Page ──────────────────────────────────────

let currentCustomerId = null;

async function openCustomerPage(id) {
  const customer = allCustomers.find(c => c.id === id);
  if (!customer) return;
  currentCustomerId = id;
  try {
    const bills = await apiFetch(`/api/bills?customerId=${id}`);
    document.getElementById('customer-list-view').style.display   = 'none';
    document.getElementById('customer-detail-view').style.display = 'block';
    document.getElementById('cdetail-title').textContent = customer.name;
    document.getElementById('cdetail-edit-btn').onclick = () => openEditCustomer(id);
    document.getElementById('cdetail-del-btn').onclick  = () => confirmDelete('customer', id, customer.name);
    renderCustomerPage(customer, bills);
  } catch (e) { showToast(e.message, 'error'); }
}

function closeCustomerPage() {
  currentCustomerId = null;
  document.getElementById('customer-detail-view').style.display = 'none';
  document.getElementById('customer-list-view').style.display   = 'block';
  renderCustomers(trackerData); // re-render with latest data after any bill edits
}

async function refreshCustomerPage() {
  if (currentCustomerId) await openCustomerPage(currentCustomerId);
}

function renderCustomerPage(customer, bills) {
  document.getElementById('cdetail-info').innerHTML = `
    <div class="cdetail-info-card">
      <div class="cdetail-info-row"><span>Name</span><strong>${esc(customer.name)}</strong></div>
      <div class="cdetail-info-row"><span>Mobile</span><strong>${esc(customer.mobile)}</strong></div>
      <div class="cdetail-info-row"><span>Address</span><strong>${esc(customer.address || '—')}</strong></div>
      <div class="cdetail-info-row"><span>Registered</span><strong>${fmtDate(customer.createdAt)}</strong></div>
    </div>
  `;

  const billsHtml = !bills.length
    ? '<p class="empty-row" style="padding:1rem 0;">No bills found for this customer.</p>'
    : bills.map(b => `
      <div class="cbill-card cbill-${b.status}">
        <div class="cbill-top">
          <span class="badge badge-${b.status}">${b.status}</span>
          <span class="cbill-period">${fmtDate(b.startDate)} → ${b.stopDate ? fmtDate(b.stopDate) : 'Running ⚡'}</span>
        </div>
        <div class="cbill-stats">
          <div class="cbill-stat"><span>Qty</span><strong>${b.quantity}</strong></div>
          <div class="cbill-stat"><span>Rate/day</span><strong>₹${b.perDayCharge}</strong></div>
          <div class="cbill-stat"><span>Days</span><strong>${b.numberOfDays ?? '—'}</strong></div>
          <div class="cbill-stat"><span>Total</span><strong>₹${(b.total ?? 0).toLocaleString()}</strong></div>
          <div class="cbill-stat"><span>Arrears</span><strong style="color:${(b.arrears ?? 0) > 0 ? 'var(--warning,#f59e0b)' : 'inherit'}">₹${(b.arrears ?? 0).toLocaleString()}</strong></div>
          <div class="cbill-stat"><span>Collected</span><strong style="color:var(--success)">₹${(b.collectedAmount ?? 0).toLocaleString()}</strong></div>
          <div class="cbill-stat"><span>Pending</span><strong style="color:${b.pendingAmount > 0 ? 'var(--danger)' : 'inherit'}">₹${(b.pendingAmount ?? 0).toLocaleString()}</strong></div>
        </div>
        ${b.comments ? `<div class="cbill-comments">💬 ${esc(b.comments)}</div>` : ''}
        <div class="cbill-actions">
          <button class="btn btn-icon btn-edit" onclick="openUpdateBill('${b.id}')">✏️ Edit</button>
          ${b.status === 'active' ? `<button class="btn btn-icon btn-stop" onclick="stopBill('${b.id}')">⏹ Stop</button>` : ''}
          <button class="btn btn-icon btn-del" onclick="confirmDelete('bill','${b.id}','bill for ${esc(customer.name)}')">🗑 Delete</button>
          <button class="btn btn-whatsapp btn-icon" onclick="sendWhatsAppBillReminderFromDetail('${customer.id}','${b.id}')">📱 Remind</button>
        </div>
      </div>
    `).join('');

  document.getElementById('cdetail-bills').innerHTML = `
    <div class="cdetail-bills-header">
      <h3 class="bs-section-title" style="margin:0;">Bills (${bills.length})</h3>
      <button class="btn btn-primary" onclick="openAddBillForCustomer('${customer.id}')">+ Add Bill</button>
    </div>
    <div class="cbill-list">${billsHtml}</div>
  `;
}

function openAddBillForCustomer(customerId) {
  populateCustomerDropdown('b-customer');
  document.getElementById('b-customer').value = customerId;
  setDateChip('today');
  openModal('modal-add-bill');
}

// Wrapper that can work without trackerData being loaded
function sendWhatsAppBillReminderFromDetail(customerId, billId) {
  // try trackerData first, fall back to allBills + allCustomers
  if (trackerData.find(c => c.id === customerId)) {
    sendWhatsAppBillReminder(customerId, billId);
    return;
  }
  const customer = allCustomers.find(c => c.id === customerId);
  const bill     = allBills.find(b => b.id === billId);
  if (!customer || !bill) { showToast('Could not load bill data.', 'error'); return; }
  const fmt      = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const days     = bill.numberOfDays || 1;
  const total    = bill.total || 0;
  const arrears  = bill.arrears || 0;
  const paid     = bill.collectedAmount || 0;
  const pending  = bill.pendingAmount || 0;
  showBillImageModal(customer.mobile, {
    name:       customer.name,
    period:     fmt(bill.startDate) + ' → ' + (bill.stopDate ? fmt(bill.stopDate) : 'Running'),
    days:       String(days),
    sets:       String(bill.quantity),
    rate:       '₹' + (bill.perDayCharge || 0) + '/day',
    total:      '₹' + total.toLocaleString('en-IN'),
    arrears:    '₹' + arrears.toLocaleString('en-IN'),
    arrearsAmt: arrears,
    paid:       '₹' + paid.toLocaleString('en-IN'),
    pending:    '₹' + pending.toLocaleString('en-IN'),
    pendingAmt: pending,
  });
}

function filterCustomers() {
  const q = document.getElementById('customer-search').value.toLowerCase();
  renderCustomers(trackerData.filter(c => c.name.toLowerCase().includes(q) || c.mobile.includes(q)));
}

async function submitAddCustomer(e) {
  e.preventDefault();
  if (!validateFields([
    { id: 'c-name',   label: 'Name',   required: true, minLen: 2 },
    { id: 'c-mobile', label: 'Mobile', required: true, pattern: /^\d{10}$/, patternMsg: 'Enter a valid 10-digit mobile number.' },
  ])) return;
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
  if (!validateFields([
    { id: 'ec-name',   label: 'Name',   required: true, minLen: 2 },
    { id: 'ec-mobile', label: 'Mobile', required: true, pattern: /^\d{10}$/, patternMsg: 'Enter a valid 10-digit mobile number.' },
  ])) return;
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
    tbody.innerHTML = '<tr><td colspan="14" class="empty-row">No bills found.</td></tr>';
    return;
  }
  tbody.innerHTML = bills.map((b, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(b.customerName || '—')}</strong></td>
      <td>${fmtDate(b.startDate)}</td>
      <td>${b.stopDate ? fmtDate(b.stopDate) : '—'}</td>
      <td>${b.numberOfDays ?? '—'}</td>
      <td>${b.quantity}</td>
      <td>₹${b.perDayCharge}</td>
      <td>₹${(b.total ?? 0).toLocaleString()}</td>
      <td>${(b.arrears ?? 0) > 0 ? `<span style="color:#f59e0b;font-weight:600">₹${(b.arrears).toLocaleString()}</span>` : '—'}</td>
      <td>₹${(b.collectedAmount ?? 0).toLocaleString()}</td>
      <td>₹${(b.pendingAmount ?? 0).toLocaleString()}</td>
      <td><span class="badge badge-${b.status}">${b.status}</span></td>
      <td style="max-width:120px;font-size:.8rem;color:#64748b;">${esc(b.comments || '—')}</td>
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
  const s = getSettings();
  document.getElementById('b-perday').value = s.defaultPerDay;
  document.getElementById('b-qty').value    = s.defaultQty;
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
  if (!validateFields([
    { id: 'b-customer',  label: 'Customer',       required: true },
    { id: 'b-startdate', label: 'Start Date',     required: true, isDate: true },
    { id: 'b-qty',       label: 'Quantity',       required: true, min: 1, max: 999 },
    { id: 'b-perday',    label: 'Per Day Charge', required: true, min: 1 },
    { id: 'b-arrears',   label: 'Arrears',        min: 0 },
  ])) return;
  const body = {
    customerId:   document.getElementById('b-customer').value,
    startDate:    document.getElementById('b-startdate').value,
    quantity:     parseInt(document.getElementById('b-qty').value),
    perDayCharge: parseInt(document.getElementById('b-perday').value),
    arrears:      parseFloat(document.getElementById('b-arrears').value) || 0,
    comments:     document.getElementById('b-comments').value.trim(),
  };
  try {
    const bill = await apiFetch('/api/bills', { method: 'POST', body: JSON.stringify(body) });
    closeModal('modal-add-bill');
    document.getElementById('form-add-bill').reset();
    showToast('Bill added!', 'success');
    loadBills();
    loadTrackerByCustomer();
    refreshCustomerPage();
    loadHome();
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
  document.getElementById('ub-arrears').value    = b.arrears || 0;
  document.getElementById('ub-comments').value   = b.comments || '';
  openModal('modal-update-bill');
  updateBillPreview();
}

function updateBillPreview() {
  const start     = document.getElementById('ub-startdate').value;
  const stop      = document.getElementById('ub-stopdate').value;
  const qty       = parseInt(document.getElementById('ub-qty').value)      || 0;
  const perDay    = parseInt(document.getElementById('ub-perday').value)    || 0;
  const collected = parseInt(document.getElementById('ub-collected').value) || 0;
  const arrears   = parseFloat(document.getElementById('ub-arrears').value) || 0;
  if (!start) return;
  const s    = new Date(start);
  const e2   = stop ? new Date(stop) : new Date();
  const days = Math.max(1, Math.ceil((e2 - s) / 86400000) + 1);
  const total   = days * qty * perDay;
  const pending = Math.max(0, total + arrears - collected);
  document.getElementById('prev-days').textContent    = days;
  document.getElementById('prev-total').textContent   = `₹${total.toLocaleString()}`;
  const arrearsWrap = document.getElementById('prev-arrears-wrap');
  if (arrears > 0) {
    document.getElementById('prev-arrears').textContent = `₹${arrears.toLocaleString()}`;
    arrearsWrap.style.display = '';
  } else {
    arrearsWrap.style.display = 'none';
  }
  document.getElementById('prev-pending').textContent = `₹${pending.toLocaleString()}`;
}

async function submitUpdateBill(e) {
  e.preventDefault();
  if (!validateFields([
    { id: 'ub-startdate', label: 'Start Date',      required: true, isDate: true },
    { id: 'ub-stopdate',  label: 'Stop Date',       isDate: true, afterField: 'ub-startdate', afterFieldLabel: 'Start Date' },
    { id: 'ub-qty',       label: 'Quantity',        required: true, min: 1 },
    { id: 'ub-perday',    label: 'Per Day Charge',  required: true, min: 1 },
    { id: 'ub-collected', label: 'Collected Amount',min: 0 },
    { id: 'ub-arrears',   label: 'Arrears',         min: 0 },
  ])) return;
  const id   = document.getElementById('ub-id').value;
  const body = {
    startDate:       document.getElementById('ub-startdate').value,
    stopDate:        document.getElementById('ub-stopdate').value || null,
    quantity:        parseInt(document.getElementById('ub-qty').value),
    perDayCharge:    parseInt(document.getElementById('ub-perday').value),
    collectedAmount: parseInt(document.getElementById('ub-collected').value) || 0,
    arrears:         parseFloat(document.getElementById('ub-arrears').value) || 0,
    comments:        document.getElementById('ub-comments').value.trim(),
  };
  try {
    const bill = await apiFetch(`/api/bills/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    closeModal('modal-update-bill');
    showToast('Bill updated!', 'success');
    loadBills();
    loadTrackerByCustomer();
    refreshCustomerPage();
    loadHome();
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
      ...((bill.arrears || 0) > 0 ? [`Arrears : ₹${(bill.arrears).toLocaleString()}`] : []),
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
    refreshCustomerPage();
    loadHome();
    const text = document.getElementById('stop-confirm-msg').value;
    const clean = (bill.customerMobile || '').replace(/\D/g, '');
    if (clean) window.open(`https://wa.me/91${clean}?text=${encodeURIComponent(text)}`, '_blank');
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Refresh tracker data and re-render customer cards ─────────
async function loadTrackerByCustomer() {
  try {
    trackerData  = await apiFetch('/api/tracker/customers');
    allCustomers = trackerData.map(({ bills, ...c }) => c);
    const listView = document.getElementById('customer-list-view');
    if (listView && listView.style.display !== 'none') renderCustomers(trackerData);
  } catch (e) { /* silent — customers already rendered */ }
}

// ── Settings helpers ──────────────────────────────────────────
const SETTINGS_KEY = 'ebt_settings';
const DEFAULT_SETTINGS = {
  appHeader:       '⚡ Electricity Bill',
  appSubHeader:    'iApp Solutions',
  defaultPerDay:   200,
  defaultQty:      1,
  operatorMobile:  '',
};

function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

function loadSettings() {
  const s = getSettings();
  document.getElementById('setting-app-header').value       = s.appHeader;
  document.getElementById('setting-app-subheader').value    = s.appSubHeader;
  document.getElementById('setting-default-perday').value   = s.defaultPerDay;
  document.getElementById('setting-default-qty').value      = s.defaultQty;
  document.getElementById('setting-operator-mobile').value  = s.operatorMobile;
}

function saveSettings() {
  const perday = parseInt(document.getElementById('setting-default-perday').value) || DEFAULT_SETTINGS.defaultPerDay;
  const qty    = parseInt(document.getElementById('setting-default-qty').value)    || DEFAULT_SETTINGS.defaultQty;
  const mobile = document.getElementById('setting-operator-mobile').value.trim();
  const s = {
    appHeader:      document.getElementById('setting-app-header').value.trim()    || DEFAULT_SETTINGS.appHeader,
    appSubHeader:   document.getElementById('setting-app-subheader').value.trim() || DEFAULT_SETTINGS.appSubHeader,
    defaultPerDay:  perday,
    defaultQty:     qty,
    operatorMobile: mobile,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  showToast('Settings saved!', 'success');
}

function resetSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  loadSettings();
  showToast('Settings reset to default.', 'success');
}

// ── Number to words (Indian rupees) ──────────────────────────
function numberToWords(n) {
  n = Math.round(n);
  if (n === 0) return 'Zero Rupees';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
                 'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
                 'Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function two(x) { return x < 20 ? ones[x] : tens[Math.floor(x/10)] + (x%10 ? ' '+ones[x%10] : ''); }
  let res = '';
  if (n >= 100000) { res += two(Math.floor(n/100000)) + ' Lakh ';   n %= 100000; }
  if (n >= 1000)   { res += two(Math.floor(n/1000))   + ' Thousand '; n %= 1000; }
  if (n >= 100)    { res += ones[Math.floor(n/100)]    + ' Hundred '; n %= 100; }
  if (n > 0)       res += two(n);
  return res.trim() + ' Rupees Only';
}

// ── Bill Image Generation ──────────────────────────────────────
// Renders a bill card onto a canvas element and returns it.
function generateBillCanvas(d) {
  const s = getSettings();
  const hasArrears = (d.arrearsAmt || 0) > 0;
  const W = 440, H = hasArrears ? 562 : 530, PAD = 28, SCALE = 2;
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

  // Green header
  c.fillStyle = '#16a34a';
  rr(0, 0, W, 96, 20); c.fill();
  c.fillRect(0, 76, W, 20);

  // Header text — from settings
  c.fillStyle = '#ffffff';
  c.font = 'bold 22px system-ui, -apple-system, sans-serif';
  c.fillText(s.appHeader, PAD, 48);
  c.font = '13px system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.75)';
  c.fillText(s.appSubHeader, PAD, 70);

  // Today's date — top right of header
  const todayStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  c.font = '11px system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.textAlign = 'right';
  c.fillText(todayStr, W - PAD, 48);
  c.textAlign = 'left';

  let y = 134;

  // Greeting
  c.fillStyle = '#1e293b';
  c.font = 'bold 17px system-ui, sans-serif';
  c.fillText('Dear ' + d.name + ',', PAD, y); y += 20;
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
    ['Total',                    d.total,   '#334155'],
    ...(hasArrears ? [['Arrears', d.arrears, '#f59e0b']] : []),
    ['Paid',                     d.paid,    '#16a34a'],
    ['Pending',                  d.pending, d.pendingAmt > 0 ? '#dc2626' : '#16a34a'],
  ];
  for (const [label, val, clr] of amts) {
    c.font = (label === 'Pending' ? 'bold ' : '') + '15px system-ui, sans-serif';
    c.fillStyle = '#64748b'; c.textAlign = 'left';
    c.fillText(label, PAD, y);
    c.fillStyle = clr; c.textAlign = 'right';
    c.fillText(val, W - PAD, y);
    c.textAlign = 'left'; y += 30;
  }

  // Written words for pending amount
  const pendingWords = numberToWords(d.pendingAmt || 0);
  c.font = 'italic 11px system-ui, sans-serif';
  c.fillStyle = d.pendingAmt > 0 ? '#dc2626' : '#16a34a';
  c.textAlign = 'right';
  c.fillText('(' + pendingWords + ')', W - PAD, y - 14);
  c.textAlign = 'left';

  divider(y + 2); y += 18;

  // Footer
  c.font = '12px system-ui, sans-serif';
  c.fillStyle = '#94a3b8';
  c.textAlign = 'center';
  const footerContact = s.operatorMobile ? `Contact: ${s.operatorMobile}  |  Thank you!` : 'For any queries, please contact us. Thank you!';
  c.fillText(footerContact, W / 2, y);
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

  // Share/download a canvas image using the most reliable method available.
  // Priority: Capacitor native plugins → Web Share API → anchor-click fallback.
  async function shareCanvasImage(filename, forWhatsApp) {
    const dataUrl  = cvs.toDataURL('image/png');
    const FS       = window.Capacitor?.Plugins?.Filesystem;
    const SharePl  = window.Capacitor?.Plugins?.Share;

    // 1. Native Capacitor path — works on all Android versions reliably.
    if (FS && SharePl) {
      try {
        const { uri } = await FS.writeFile({
          path: filename,
          data: dataUrl.split(',')[1],   // base64 portion only
          directory: 'CACHE',
        });
        await SharePl.share({ files: [uri], title: 'Electricity Bill' });
        return;
      } catch (e) {
        // AbortError / user cancelled — do not fall through to another UI action.
        if (e.errorMessage?.toLowerCase().includes('cancel') ||
            e.message?.toLowerCase().includes('cancel') ||
            e.name === 'AbortError') return;
        // Otherwise fall through to Web Share API below.
      }
    }

    // 2. Web Share API with file support (requires Android 10+ Chrome WebView).
    const b64   = dataUrl.split(',')[1];
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file  = new File([bytes], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Electricity Bill' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }

    // 3. Desktop / PWA anchor-click fallback.
    const a = document.createElement('a');
    a.download = filename;
    a.href = dataUrl;
    a.click();
    if (forWhatsApp && clean) {
      setTimeout(() => window.open('https://wa.me/91' + clean, '_blank'), 600);
    }
  }

  document.getElementById('bill-img-download').onclick = () =>
    shareCanvasImage('bill-' + (data.name || 'customer').replace(/\s+/g, '-') + '.png', false);

  document.getElementById('bill-img-share').onclick = () =>
    shareCanvasImage('electricity-bill.png', true);

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
  const lines  = activeBills.map((b, i) => {
    const arrearsNote = (b.arrears || 0) > 0 ? ` | Arrears: ₹${(b.arrears).toLocaleString()}` : '';
    return `${i + 1}. ${fmtDate(b.startDate)} → ${b.stopDate ? fmtDate(b.stopDate) : 'Running'} | Qty:${b.quantity}${arrearsNote} | Pending: ₹${(b.pendingAmount || 0).toLocaleString()}`;
  });
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

  const fmt      = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const days     = bill.numberOfDays || 1;
  const total    = bill.total || 0;
  const arrears  = bill.arrears || 0;
  const paid     = bill.collectedAmount || 0;
  const pending  = bill.pendingAmount || 0;

  showBillImageModal(customer.mobile, {
    name:       customer.name,
    period:     fmt(bill.startDate) + ' → ' + (bill.stopDate ? fmt(bill.stopDate) : 'Running'),
    days:       String(days),
    sets:       String(bill.quantity || 1),
    rate:       '₹' + (bill.perDayCharge || 0) + '/day',
    total:      '₹' + total.toLocaleString('en-IN'),
    arrears:    '₹' + arrears.toLocaleString('en-IN'),
    arrearsAmt: arrears,
    paid:       '₹' + paid.toLocaleString('en-IN'),
    pending:    '₹' + pending.toLocaleString('en-IN'),
    pendingAmt: pending,
  });
}

// ══════════════════════════════════════════════════════════════
//  TRACKER – By Month/Year
// ══════════════════════════════════════════════════════════════

let lastTrackerBills  = [];
let trackerBillSort   = { col: null, asc: true };

function selectTrackerMonth(m) {
  document.getElementById('filter-month').value = m;
  document.querySelectorAll('#tracker-month-chips .month-chip').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.month) === m);
  });
}

async function loadTrackerByBill() {
  if (!validateFields([{ id: 'filter-year', label: 'Year', required: true, min: 2000, max: 2100 }])) return;
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

    lastTrackerBills = bills;
    trackerBillSort  = { col: null, asc: true };
    renderTrackerBills(bills);
  } catch (e) { showToast(e.message, 'error'); }
}

function sortTrackerBills(col) {
  if (trackerBillSort.col === col) {
    trackerBillSort.asc = !trackerBillSort.asc;
  } else {
    trackerBillSort = { col, asc: true };
  }
  renderTrackerBills(lastTrackerBills);
}

function renderTrackerBills(bills) {
  const tbody = document.getElementById('tracker-bills-tbody');
  if (!bills.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">No bills found for this period.</td></tr>';
    return;
  }

  // Update header indicators
  ['startDate','stopDate','numberOfDays','total','status'].forEach(c => {
    const th = document.getElementById('th-' + c);
    if (!th) return;
    const base = { startDate:'Start Date', stopDate:'Stop Date', numberOfDays:'Days', total:'Total (₹)', status:'Status' }[c];
    if (trackerBillSort.col === c) {
      th.innerHTML = `${base} <span class="sort-icon">${trackerBillSort.asc ? '▲' : '▼'}</span>`;
      th.classList.add('th-sort-active');
    } else {
      th.innerHTML = base;
      th.classList.remove('th-sort-active');
    }
  });

  // Sort
  const sorted = [...bills].sort((a, b) => {
    const col = trackerBillSort.col;
    if (!col) return 0;
    let av = a[col], bv = b[col];
    // Numeric / date fields
    if (col === 'numberOfDays' || col === 'total') {
      av = av ?? 0; bv = bv ?? 0;
    } else if (col === 'startDate' || col === 'stopDate') {
      // nulls (no stopDate) sort last regardless of direction
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    } else {
      av = (av || '').toString().toLowerCase();
      bv = (bv || '').toString().toLowerCase();
    }
    if (av < bv) return trackerBillSort.asc ? -1 : 1;
    if (av > bv) return trackerBillSort.asc ?  1 : -1;
    return 0;
  });

  tbody.innerHTML = sorted.map((b, i) => `
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
}

// ══════════════════════════════════════════════════════════════
//  BALANCE SHEET
// ══════════════════════════════════════════════════════════════

const MONTH_NAMES = [
  '', 'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function selectBSMonth(m) {
  document.getElementById('bs-filter-month').value = m;
  document.querySelectorAll('#bs-month-chips .month-chip').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.month) === m);
  });
}

async function loadBalanceSheet() {
  if (!validateFields([{ id: 'bs-filter-year', label: 'Year', required: true, min: 2000, max: 2100 }])) return;
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

  function donutCard(title, v1, v2, color1, color2, label1, label2, fmt1, fmt2, centerText, note = '') {
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
      ${note ? `<div class="bs-donut-note">${note}</div>` : ''}
    </div>`;
  }

  const unitsPct = stats.unitsProjected
    ? Math.round((stats.unitsCharged / stats.unitsProjected) * 100) + '%' : '—';
  const chargePct = summary.totalCharged
    ? Math.round((stats.projectedAmount / summary.totalCharged) * 100) + '%' : '—';

  const unitsDiffNote = stats.unitsDiff >= 0
    ? `<span class="diff-over">+${stats.unitsDiff} units over projection</span>`
    : `<span class="diff-under">${Math.abs(stats.unitsDiff)} units under projection</span>`;

  const chargeDiffNote = summary.totalCharged >= stats.projectedAmount
    ? `<span class="diff-over">Billed ₹${(summary.totalCharged - stats.projectedAmount).toLocaleString()} more than board cost</span>`
    : `<span class="diff-under">Board cost ₹${(stats.projectedAmount - summary.totalCharged).toLocaleString()} more than billed</span>`;

  const collectionNote = `Collection rate: <strong>${stats.collectionRate}%</strong>
    &nbsp;·&nbsp; Pending: <strong style="color:var(--danger)">₹${summary.totalPending.toLocaleString()}</strong>`;

  document.getElementById('bs-donut-charts').innerHTML =
    donutCard('⚡ Units Projected vs Charged',
      stats.unitsProjected, stats.unitsCharged,
      '#3b82f6', '#f97316',
      'Projected', 'Board Charged',
      stats.unitsProjected, stats.unitsCharged,
      unitsPct, unitsDiffNote) +
    donutCard('💰 Expected Charge vs Board Bill',
      summary.totalCharged, stats.projectedAmount,
      '#3b82f6', '#f97316',
      'Billed to Customers', 'Board Bill',
      '₹' + summary.totalCharged.toLocaleString(),
      '₹' + stats.projectedAmount.toLocaleString(),
      chargePct, chargeDiffNote) +
    donutCard('🧾 Charged vs Collected',
      summary.totalCollected, summary.totalPending,
      '#22c55e', '#ef4444',
      'Collected', 'Pending',
      '₹' + summary.totalCollected.toLocaleString(),
      '₹' + summary.totalPending.toLocaleString(),
      stats.collectionRate + '%', collectionNote);

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
  document.getElementById('bs-bills-section').style.display = 'block';
  lastBSSort = { col: null, asc: true };
  renderBSBills(bills);
}

let lastBSSort = { col: null, asc: true };

function sortBSBills(col) {
  if (lastBSSort.col === col) {
    lastBSSort.asc = !lastBSSort.asc;
  } else {
    lastBSSort = { col, asc: true };
  }
  renderBSBills(lastBSData?.bills || []);
}

function renderBSBills(bills) {
  const tbody = document.getElementById('bs-bills-tbody');
  if (!bills.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-row">No bills active in this month.</td></tr>';
    return;
  }

  // Update sort header indicators
  const bsColLabels = {
    startDate: 'Start Date', stopDate: 'Stop Date',
    numberOfDays: 'Days', total: 'Total (₹)', status: 'Status',
  };
  Object.entries(bsColLabels).forEach(([c, label]) => {
    const th = document.getElementById('bs-th-' + c);
    if (!th) return;
    if (lastBSSort.col === c) {
      th.innerHTML = `${label} <span class="sort-icon">${lastBSSort.asc ? '▲' : '▼'}</span>`;
      th.classList.add('th-sort-active');
    } else {
      th.innerHTML = label;
      th.classList.remove('th-sort-active');
    }
  });

  // Sort
  const sorted = [...bills].sort((a, b) => {
    const col = lastBSSort.col;
    if (!col) return 0;
    let av = a[col], bv = b[col];
    if (col === 'numberOfDays' || col === 'total') {
      av = av ?? 0; bv = bv ?? 0;
    } else if (col === 'startDate' || col === 'stopDate') {
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    } else {
      av = (av || '').toString().toLowerCase();
      bv = (bv || '').toString().toLowerCase();
    }
    if (av < bv) return lastBSSort.asc ? -1 : 1;
    if (av > bv) return lastBSSort.asc ?  1 : -1;
    return 0;
  });

  tbody.innerHTML = sorted.map((b, i) => `
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
      <td>${(b.arrears ?? 0) > 0 ? `<span style="color:#f59e0b;font-weight:600">₹${(b.arrears).toLocaleString()}</span>` : '—'}</td>
      <td>₹${(b.collectedAmount ?? 0).toLocaleString()}</td>
      <td style="color:var(--danger);font-weight:600;">₹${(b.pendingAmount ?? 0).toLocaleString()}</td>
      <td><span class="badge badge-${b.status}">${b.status}</span></td>
    </tr>
  `).join('');
}

// ─── Balance Sheet Bills Export ───────────────────────────────

function exportBSBillsCSV() {
  const bills = lastBSData?.bills;
  if (!bills?.length) { showToast('No bills to export.', 'warning'); return; }
  const { month, year } = lastBSData;
  const label = `${MONTH_NAMES[month]}-${year}`;
  const headers = ['#', 'Customer', 'Mobile', 'Start Date', 'Stop Date', 'Days', 'Qty', 'Per Day (₹)', 'Total (₹)', 'Arrears (₹)', 'Collected (₹)', 'Pending (₹)', 'Status'];
  const rows = bills.map((b, i) => [
    i + 1, b.customerName, b.customerMobile || '',
    b.startDate || '', b.stopDate || '', b.numberOfDays ?? '',
    b.quantity, b.perDayCharge,
    b.total ?? 0, b.arrears ?? 0, b.collectedAmount ?? 0, b.pendingAmount ?? 0, b.status,
  ]);
  downloadCSV(`bills-active-${label}.csv`, buildCSV(headers, rows));
}

function shareBSBillsWhatsApp() {
  const bills = lastBSData?.bills;
  if (!bills?.length) { showToast('No bills to share.', 'warning'); return; }
  const { month, year, summary } = lastBSData;
  const label = `${MONTH_NAMES[month]} ${year}`;
  const lines = bills.map((b, i) => {
    const arrearsNote = (b.arrears ?? 0) > 0 ? ` | Arrears:₹${b.arrears.toLocaleString()}` : '';
    return `${i + 1}. ${b.customerName} | ${fmtDate(b.startDate)}→${b.stopDate ? fmtDate(b.stopDate) : 'Running'} | Days:${b.numberOfDays ?? '—'} | Qty:${b.quantity}${arrearsNote} | Total:₹${(b.total ?? 0).toLocaleString()} | Collected:₹${(b.collectedAmount ?? 0).toLocaleString()} | Pending:₹${(b.pendingAmount ?? 0).toLocaleString()} | ${b.status}`;
  });
  const msg = [
    `📒 Balance Sheet — ${label}`,
    ``,
    ...lines,
    ``,
    `💰 Total: ₹${summary.totalCharged.toLocaleString()} | Collected: ₹${summary.totalCollected.toLocaleString()} | Pending: ₹${summary.totalPending.toLocaleString()}`,
  ].join('\n');
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
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
  if (!validateFields([
    { id: 'mc-year',             label: 'Year',            required: true, min: 2000, max: 2100 },
    { id: 'mc-projected-amount', label: 'Board Bill Amount',required: true, min: 0 },
    { id: 'mc-units-charged',    label: 'Units Charged',   min: 0 },
    { id: 'mc-bill-paid-date',   label: 'Bill Paid Date',  isDate: true },
  ])) return;
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
    if (type === 'customer')       { loadCustomers(); loadTrackerByCustomer(); closeCustomerPage(); }
    if (type === 'bill')           { loadBills();     loadTrackerByCustomer(); refreshCustomerPage(); }
    if (type === 'monthly-charge') { loadBalanceSheet(); }
  } catch (e) { showToast(e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  BACKUP & RESTORE
// ══════════════════════════════════════════════════════════════

async function backupAllData() {
  const backup = {
    version:    '1',
    exportedAt: new Date().toISOString(),
    appId:      'ebt',
    customers:  JSON.parse(localStorage.getItem('ebt_customers') || '[]'),
    bills:      JSON.parse(localStorage.getItem('ebt_bills')     || '[]'),
    charges:    JSON.parse(localStorage.getItem('ebt_charges')   || '[]'),
  };
  const total = backup.customers.length + backup.bills.length + backup.charges.length;
  if (!total) { showToast('No data to backup.', 'warning'); return; }
  const date     = new Date().toISOString().split('T')[0];
  const filename = `ebt-backup-${date}.json`;
  const json     = JSON.stringify(backup, null, 2);
  const blob     = new Blob([json], { type: 'application/json' });
  const file     = new File([blob], filename, { type: 'application/json' });

  // Native Capacitor path — most reliable on Android.
  const FS      = window.Capacitor?.Plugins?.Filesystem;
  const SharePl = window.Capacitor?.Plugins?.Share;
  if (FS && SharePl) {
    try {
      const { uri } = await FS.writeFile({ path: filename, data: btoa(json), directory: 'CACHE' });
      await SharePl.share({ files: [uri], title: 'EBT Backup' });
      return;
    } catch (e) {
      if (e.errorMessage?.toLowerCase().includes('cancel') ||
          e.message?.toLowerCase().includes('cancel') ||
          e.name === 'AbortError') return;
    }
  }

  // Web Share API fallback.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'EBT Backup' });
      return;
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Share cancelled.', 'warning');
      return;
    }
  }

  // Desktop / PWA anchor-click fallback.
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Backup saved — ${backup.customers.length} customers, ${backup.bills.length} bills, ${backup.charges.length} charges.`, 'success');
}

function triggerRestoreBackup() {
  const inp = document.getElementById('restore-file-input');
  if (inp) { inp.value = ''; inp.click(); }
}

async function handleRestoreFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data.customers) || !Array.isArray(data.bills)) {
      showToast('Invalid backup file — missing customers or bills.', 'error'); return;
    }
    window._pendingRestore = data;
    const d = document;
    d.getElementById('restore-count').textContent =
      `${data.customers.length} customers · ${data.bills.length} bills · ${(data.charges || []).length} monthly charges`;
    d.getElementById('restore-exported-at').textContent =
      data.exportedAt ? new Date(data.exportedAt).toLocaleString('en-IN') : 'Unknown';
    openModal('modal-restore-confirm');
  } catch (e) { showToast('Could not read backup file.', 'error'); }
}

function doRestoreBackup() {
  const data = window._pendingRestore;
  if (!data) return;
  try {
    localStorage.setItem('ebt_customers', JSON.stringify(data.customers || []));
    localStorage.setItem('ebt_bills',     JSON.stringify(data.bills     || []));
    localStorage.setItem('ebt_charges',   JSON.stringify(data.charges   || []));
    window._pendingRestore = null;
    closeModal('modal-restore-confirm');
    showToast(`Restored: ${data.customers.length} customers, ${data.bills.length} bills, ${(data.charges||[]).length} charges.`, 'success');
    loadCustomers();
    loadBills();
    loadTrackerByCustomer();
  } catch (e) { showToast('Restore failed: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════
//  CSV EXPORT / IMPORT
// ══════════════════════════════════════════════════════════════

function buildCSV(headers, rows) {
  return [headers, ...rows]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

async function downloadCSV(filename, csv) {
  const content = '\uFEFF' + csv;  // UTF-8 BOM for Excel compatibility
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const file = new File([blob], filename, { type: 'text/csv;charset=utf-8;' });

  // Native Capacitor path — most reliable on Android.
  const FS      = window.Capacitor?.Plugins?.Filesystem;
  const SharePl = window.Capacitor?.Plugins?.Share;
  if (FS && SharePl) {
    try {
      const { uri } = await FS.writeFile({ path: filename, data: btoa(unescape(encodeURIComponent(content))), directory: 'CACHE' });
      await SharePl.share({ files: [uri], title: filename });
      return;
    } catch (e) {
      if (e.errorMessage?.toLowerCase().includes('cancel') ||
          e.message?.toLowerCase().includes('cancel') ||
          e.name === 'AbortError') return;
    }
  }

  // Web Share API fallback.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (err) { if (err.name !== 'AbortError') showToast('Share cancelled.', 'warning'); return; }
  }

  // Desktop / PWA anchor-click fallback.
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseCSVText(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  return lines.map(line => {
    const cols = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { cols.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  });
}

// ── Export ────────────────────────────────────────────────────

function exportCustomersCSV() {
  if (!allCustomers.length) { showToast('No customers to export.', 'warning'); return; }
  const headers = ['#', 'Name', 'Mobile', 'Address', 'Registered On'];
  const rows = allCustomers.map((c, i) => [i + 1, c.name, c.mobile, c.address || '', fmtDate(c.createdAt)]);
  downloadCSV('customers.csv', buildCSV(headers, rows));
}

function exportBillsCSV() {
  if (!allBills.length) { showToast('No bills to export.', 'warning'); return; }
  const headers = ['#', 'Customer', 'Mobile', 'Start Date', 'Stop Date', 'Days', 'Qty', 'Per Day', 'Arrears', 'Total', 'Collected', 'Pending', 'Status'];
  const rows = allBills.map((b, i) => [
    i + 1, b.customerName || '', b.customerMobile || '',
    b.startDate || '', b.stopDate || '', b.numberOfDays ?? '',
    b.quantity, b.perDayCharge, b.arrears ?? 0,
    b.total ?? 0, b.collectedAmount ?? 0, b.pendingAmount ?? 0, b.status,
  ]);
  downloadCSV('bills.csv', buildCSV(headers, rows));
}

async function exportMonthlyChargesCSV() {
  try {
    const charges = await apiFetch('/api/monthly-charges');
    if (!charges.length) { showToast('No monthly charges to export.', 'warning'); return; }
    const headers = ['#', 'Month', 'Year', 'Board Bill Amount', 'Bill Paid Date', 'Units Charged', 'Comments'];
    const rows = charges.map((c, i) => [
      i + 1, c.month, c.year, c.projectedAmount ?? 0,
      c.billPaidDate || '', c.unitsCharged ?? '', c.comments || '',
    ]);
    downloadCSV('monthly-charges.csv', buildCSV(headers, rows));
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Import ────────────────────────────────────────────────────

function importCSVFile(type) {
  const input = document.getElementById('csv-import-' + type);
  if (input) { input.value = ''; input.click(); }
}

async function handleCSVImport(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const rows = parseCSVText(text);
  if (rows.length < 2) { showToast('CSV is empty or has no data rows.', 'warning'); return; }
  const dataRows = rows.slice(1);
  const hdr = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  let imported = 0, skipped = 0;

  if (type === 'customers') {
    const iName   = hdr.findIndex(h => h.includes('name'));
    const iMobile = hdr.findIndex(h => h.includes('mobile'));
    const iAddr   = hdr.findIndex(h => h.includes('address') || h === 'addr');
    if (iName === -1 || iMobile === -1) { showToast('CSV must have Name and Mobile columns.', 'error'); return; }
    const existing = await apiFetch('/api/customers');
    const existingMobiles = new Set(existing.map(c => c.mobile));
    for (const row of dataRows) {
      const name = row[iName]?.trim(), mobile = row[iMobile]?.trim();
      const addr = iAddr !== -1 ? (row[iAddr]?.trim() || '') : '';
      if (!name || !mobile) { skipped++; continue; }
      if (existingMobiles.has(mobile)) { skipped++; continue; }
      try {
        await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify({ name, mobile, address: addr }) });
        existingMobiles.add(mobile); imported++;
      } catch { skipped++; }
    }
    showToast(`Imported ${imported} customer(s). Skipped ${skipped}.`, imported > 0 ? 'success' : 'warning');
    if (imported > 0) loadCustomers();

  } else if (type === 'bills') {
    const iMobile    = hdr.findIndex(h => h.includes('mobile'));
    const iStart     = hdr.findIndex(h => h.includes('start'));
    const iStop      = hdr.findIndex(h => h.includes('stop'));
    const iQty       = hdr.findIndex(h => h.includes('qty') || h.includes('quantity'));
    const iPerDay    = hdr.findIndex(h => h.includes('perday'));
    const iArrears   = hdr.findIndex(h => h.includes('arrear'));
    const iCollected = hdr.findIndex(h => h.includes('collected'));
    const iStatus    = hdr.findIndex(h => h === 'status');
    if (iMobile === -1 || iStart === -1) { showToast('CSV must have Mobile and Start Date columns.', 'error'); return; }
    const customers = await apiFetch('/api/customers');
    for (const row of dataRows) {
      const mobile    = row[iMobile]?.trim();
      const startDate = row[iStart]?.trim();
      if (!mobile || !startDate) { skipped++; continue; }
      const customer = customers.find(c => c.mobile === mobile);
      if (!customer) { skipped++; continue; }
      const stopDate  = iStop      !== -1 ? (row[iStop]?.trim()        || null) : null;
      const qty       = iQty       !== -1 ? (parseInt(row[iQty])       || 1)   : 1;
      const perDay    = iPerDay    !== -1 ? (parseInt(row[iPerDay])    || 200)  : 200;
      const arrears   = iArrears   !== -1 ? (parseFloat(row[iArrears]) || 0)   : 0;
      const collected = iCollected !== -1 ? (parseFloat(row[iCollected]) || 0) : 0;
      const status    = iStatus    !== -1 ? (row[iStatus]?.trim()      || 'active') : 'active';
      try {
        const bill = await apiFetch('/api/bills', { method: 'POST', body: JSON.stringify({ customerId: customer.id, startDate, quantity: qty, perDayCharge: perDay, arrears }) });
        if (stopDate || status === 'stopped' || collected > 0) {
          const upd = {};
          if (stopDate) upd.stopDate = stopDate;
          else if (status === 'stopped') upd.stopDate = toDateStr(new Date());
          if (collected > 0) upd.collectedAmount = collected;
          await apiFetch(`/api/bills/${bill.id}`, { method: 'PUT', body: JSON.stringify(upd) });
        }
        imported++;
      } catch { skipped++; }
    }
    showToast(`Imported ${imported} bill(s). Skipped ${skipped}.`, imported > 0 ? 'success' : 'warning');
    if (imported > 0) { loadBills(); loadTrackerByCustomer(); }

  } else if (type === 'monthly-charges') {
    const iMonth    = hdr.findIndex(h => h === 'month' || h.startsWith('month'));
    const iYear     = hdr.findIndex(h => h === 'year'  || h.startsWith('year'));
    const iAmount   = hdr.findIndex(h => h.includes('amount') || h.includes('projected'));
    const iPaidDate = hdr.findIndex(h => h.includes('paid'));
    const iUnits    = hdr.findIndex(h => h.includes('units'));
    const iComments = hdr.findIndex(h => h.includes('comment'));
    if (iMonth === -1 || iYear === -1) { showToast('CSV must have Month and Year columns.', 'error'); return; }
    const MONTH_MAP = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
    for (const row of dataRows) {
      const mRaw = row[iMonth]?.trim(), yRaw = row[iYear]?.trim();
      if (!mRaw || !yRaw) { skipped++; continue; }
      const monthNum = parseInt(mRaw) || MONTH_MAP[mRaw.toLowerCase()] || 0;
      if (!monthNum || monthNum < 1 || monthNum > 12) { skipped++; continue; }
      const amount   = iAmount   !== -1 ? (parseFloat(row[iAmount])  || 0)   : 0;
      const paidDate = iPaidDate !== -1 ? (row[iPaidDate]?.trim()    || null) : null;
      const units    = iUnits    !== -1 ? (parseFloat(row[iUnits])   || 0)   : 0;
      const comments = iComments !== -1 ? (row[iComments]?.trim()    || '')  : '';
      try {
        await apiFetch('/api/monthly-charges', { method: 'POST', body: JSON.stringify({ month: monthNum, year: parseInt(yRaw), projectedAmount: amount, billPaidDate: paidDate, unitsCharged: units, comments }) });
        imported++;
      } catch { skipped++; }
    }
    showToast(`Imported ${imported} monthly charge(s). Skipped ${skipped}.`, imported > 0 ? 'success' : 'warning');
    if (imported > 0) loadBalanceSheet();
  }
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
