// ── State ──────────────────────────────────────────────────────
let allCustomers   = [];
let allBills       = [];
let trackerData    = [];   // by-customer tracker cache
let lastBSData     = null; // last loaded balance-sheet payload
let homeSortBy     = 'line'; // sort mode for home page running sets

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

// ── Trial Gate ─────────────────────────────────────────────────
const TRIAL_KEY   = 'app_first_open';
const TOKEN_KEY   = 'app_access_token';
const ACCESS_TOKEN = '9908865378';
const TRIAL_MS    = 30 * 24 * 60 * 60 * 1000; // 30 days

function isTrialExpired() {
  const stored = localStorage.getItem(TRIAL_KEY);
  if (!stored) {
    localStorage.setItem(TRIAL_KEY, String(Date.now()));
    return false;
  }
  return (Date.now() - parseInt(stored, 10)) > TRIAL_MS;
}

function hasValidToken() {
  return localStorage.getItem(TOKEN_KEY) === ACCESS_TOKEN;
}

function showTrialExpiredScreen() {
  document.body.innerHTML = `
    <div class="trial-overlay">
      <div class="trial-box">
        <div class="trial-icon">🔒</div>
        <h2 class="trial-title">Trial Period Ended</h2>
        <p class="trial-msg">
          Your 1‑month free trial has been completed.<br>
          Please contact us on WhatsApp to continue.
        </p>
        <a class="trial-wa-btn" href="https://wa.me/919908865378" target="_blank">
          💬 Contact on WhatsApp
        </a>
        <div class="trial-token-section">
          <p class="trial-token-label">Have an access token?</p>
          <div class="trial-token-row">
            <input id="trial-token-input" type="password" placeholder="Enter access token" />
            <button onclick="unlockWithToken()">Unlock</button>
          </div>
          <p id="trial-token-error" class="trial-token-error"></p>
        </div>
      </div>
    </div>`;
}

function unlockWithToken() {
  const val = document.getElementById('trial-token-input').value.trim();
  if (val === ACCESS_TOKEN) {
    localStorage.setItem(TOKEN_KEY, ACCESS_TOKEN);
    location.reload();
  } else {
    const err = document.getElementById('trial-token-error');
    err.textContent = 'Invalid token. Please try again.';
    setTimeout(() => { err.textContent = ''; }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Trial / token gate
  if (isTrialExpired() && !hasValidToken()) {
    showTrialExpiredScreen();
    return;
  }

  // Main tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'settings') loadSettings();
      if (btn.dataset.tab === 'home')     loadHome();
      if (btn.dataset.tab === 'payments') loadPayments();
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
    'ub-startdate','ub-stopdate','ub-qty','ub-perday','ub-collected','ub-collecteddate','ub-arrears',
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

function setSortRunning(sortBy) {
  homeSortBy = sortBy;
  document.querySelectorAll('.home-sort-buttons .sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortBy);
  });
  loadHome();
}

// Helper: calculate monthly breakdown for a bill
function getMonthlyBreakdown(bill, today) {
  const monthlyMap = {}; // 'MMM YYYY' -> amount
  const start = new Date(bill.startDate); start.setHours(0,0,0,0);
  const stop  = bill.stopDate ? new Date(bill.stopDate) : today;
  stop.setHours(0,0,0,0);

  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  const rate = (bill.perDayCharge || 0) * (bill.quantity || 1);

  while (current <= stop) {
    const mStart = new Date(current);
    const mEnd   = new Date(current.getFullYear(), current.getMonth() + 1, 0);

    const billStart = mStart > start ? mStart : start;
    const billEnd   = mEnd < stop ? mEnd : stop;

    if (billStart <= billEnd) {
      const days   = Math.round((billEnd - billStart) / 86400000) + 1;
      const amount = days * rate;
      const key    = mStart.toLocaleString('default', { month: 'short', year: 'numeric' });
      monthlyMap[key] = (monthlyMap[key] || 0) + amount;
    }

    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }

  return monthlyMap;
}

// ══════════════════════════════════════════════════════════════
//  HOME
// ══════════════════════════════════════════════════════════════

async function loadHome() {
  try {
    const [data, charges] = await Promise.all([
      apiFetch('/api/tracker/customers'),
      apiFetch('/api/monthly-charges'),
    ]);

    // ── aggregate active bills by customer
    let totalPending = 0, totalCollected = 0, totalQuantity = 0;
    const customerBills = new Map(); // customerId -> { cust, bills: [], totalQty: 0, totalDays: 0, ... }
    const today = new Date(); today.setHours(0,0,0,0);

    data.forEach(cust => {
      const bills = cust.bills || [];
      const activeBills = bills.filter(b => b.status === 'active');

      if (activeBills.length > 0) {
        let custQty = 0, custPending = 0, custCollected = 0, custDays = 0;
        activeBills.forEach(b => {
          custQty += b.quantity || 1;
          custPending += b.pendingAmount || 0;
          custCollected += b.collectedAmount || 0;
          totalPending += b.pendingAmount || 0;
          totalCollected += b.collectedAmount || 0;
          totalQuantity += b.quantity || 1;

          const start = new Date(b.startDate); start.setHours(0,0,0,0);
          const stop  = b.stopDate ? new Date(b.stopDate) : today;
          stop.setHours(0,0,0,0);
          const days   = Math.max(1, Math.round((stop - start) / 86400000) + 1);
          custDays += days;
        });
        customerBills.set(cust.id, {
          cust,
          bills: activeBills,
          totalQty: custQty,
          totalDays: custDays,
          totalPending: custPending,
          totalCollected: custCollected,
        });
      }
    });

    // ── build cards array for sorting
    const runningCards = Array.from(customerBills.values());

    // ── sort based on selected mode
    if (homeSortBy === 'line') {
      runningCards.sort((a, b) => {
        const lineA = a.cust.line || '—';
        const lineB = b.cust.line || '—';
        return lineA.localeCompare(lineB) || a.cust.name.localeCompare(b.cust.name);
      });
    } else if (homeSortBy === 'days') {
      runningCards.sort((a, b) => {
        return b.totalDays - a.totalDays;
      });
    } else if (homeSortBy === 'sets') {
      runningCards.sort((a, b) => {
        return b.totalQty - a.totalQty;
      });
    }

    // ── stat row
    document.getElementById('hs-val-customers').textContent = data.length;
    document.getElementById('hs-val-running').textContent   = totalQuantity;
    document.getElementById('hs-val-pending').textContent   = '₹' + totalPending.toLocaleString();
    document.getElementById('hs-val-collected').textContent = '₹' + totalCollected.toLocaleString();

    // ── running set cards
    const list = document.getElementById('home-running-list');
    if (!runningCards.length) {
      list.innerHTML = '<p class="empty-row">No sets are currently running.</p>';
      return;
    }

    list.innerHTML = runningCards.map(({ cust, bills, totalQty, totalDays }) => {
      const initials = cust.name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0,2);

      let grandTotal = 0;
      const monthlyTotals = {}; // 'MMM YYYY' -> amount

      const billRows = bills.map(b => {
        const start = new Date(b.startDate); start.setHours(0,0,0,0);
        const stop  = b.stopDate ? new Date(b.stopDate) : today;
        stop.setHours(0,0,0,0);
        const days   = Math.max(1, Math.round((stop - start) / 86400000) + 1);
        const amount = days * (b.quantity || 1) * (b.perDayCharge || 0);
        grandTotal  += amount;

        // Aggregate monthly breakdown
        const monthly = getMonthlyBreakdown(b, today);
        Object.entries(monthly).forEach(([month, amt]) => {
          monthlyTotals[month] = (monthlyTotals[month] || 0) + amt;
        });

        return `<div class="home-bill-row">${fmtDate(start)} → ${days} day${days !== 1 ? 's' : ''} · ₹${amount.toLocaleString()}</div>`;
      }).join('');

      // Format monthly breakdown
      const monthlyStr = Object.entries(monthlyTotals)
        .map(([month, amt]) => `${month}: ${amt.toLocaleString()}`)
        .join('  |  ');

      return `
        <div class="home-run-card" onclick="switchToCustomer('${cust.id}')">
          <div class="home-run-avatar">${initials}</div>
          <div class="home-run-qty-badge">${totalQty} set${totalQty !== 1 ? 's' : ''}</div>
          <div class="home-run-body">
            <div class="home-run-top">
              <span class="home-run-name">${esc(cust.name)}${cust.line ? ` (${esc(cust.line)})` : ''}</span>
              <span class="home-run-mobile">${esc(cust.mobile)}</span>
            </div>
            <div class="home-bill-list">${billRows}</div>
            ${monthlyStr ? `<div class="home-bill-monthly">${monthlyStr}</div>` : ''}
            <div class="home-bill-total">Days: ${totalDays}  |  Total: ₹${grandTotal.toLocaleString()}</div>
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
  if (viewByLine) { renderCustomersByLine(list); return; }
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
        ${c.line ? `<div class="cust-line-corner-badge">${esc(c.line)}</div>` : ''}
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
          <button class="btn btn-icon btn-pay" title="All payments" onclick="openCustomerPayments('${c.id}')">💰</button>
          <a class="btn btn-icon btn-call" title="Call" href="tel:${esc(c.mobile)}">📞</a>
          <button class="btn btn-icon btn-edit" title="Edit" onclick="openEditCustomer('${c.id}')">✏️</button>
          <button class="btn btn-icon btn-del"  title="Delete" onclick="confirmDelete('customer','${c.id}','${esc(c.name)}')">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── View by Line toggle ───────────────────────────────────────

let viewByLine = false;

function toggleViewByLine() {
  viewByLine = !viewByLine;
  const btn = document.getElementById('btn-view-by-line');
  if (btn) btn.classList.toggle('active', viewByLine);
  renderCustomers(trackerData);
}

function renderCustomersByLine(list) {
  const grid = document.getElementById('customer-grid');
  const lines = ['L1','L2','L3','L4','L5','L6'];
  const grouped = {};
  lines.forEach(l => grouped[l] = []);
  grouped['—'] = [];
  list.forEach(c => {
    const key = lines.includes(c.line) ? c.line : '—';
    grouped[key].push(c);
  });
  const allLines = [...lines, '—'].filter(l => grouped[l].length > 0);
  if (!allLines.length) {
    grid.innerHTML = '<p class="empty-row">No customers found.</p>';
    return;
  }
  grid.innerHTML = allLines.map(line => {
    const customers = grouped[line];
    const cards = customers.map((c, idx) => {
      const bills          = c.bills || [];
      const activeBills    = bills.filter(b => b.status === 'active');
      const totalPending   = bills.reduce((s, b) => s + (b.pendingAmount   || 0), 0);
      const totalCollected = bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
      const hasActive      = activeBills.length > 0;
      return `
        <div class="cust-card" onclick="openCustomerPage('${c.id}')">
          ${c.line ? `<div class="cust-line-corner-badge">${esc(c.line)}</div>` : ''}
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
            <button class="btn btn-icon btn-pay" title="All payments" onclick="openCustomerPayments('${c.id}')">💰</button>
            <a class="btn btn-icon btn-call" title="Call" href="tel:${esc(c.mobile)}">📞</a>
            <button class="btn btn-icon btn-edit" title="Edit" onclick="openEditCustomer('${c.id}')">✏️</button>
            <button class="btn btn-icon btn-del"  title="Delete" onclick="confirmDelete('customer','${c.id}','${esc(c.name)}')">🗑</button>
          </div>
        </div>
      `;
    }).join('');
    return `<div class="line-group"><div class="line-group-header">${line}</div><div class="line-group-cards">${cards}</div></div>`;
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
      <div class="cdetail-info-row"><span>Line</span><strong>${esc(customer.line || '—')}</strong></div>
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
          ${b.collectedDate ? `<div class="cbill-stat"><span>Collected Date</span><strong>${fmtDate(b.collectedDate)}</strong></div>` : ''}
          <div class="cbill-stat"><span>Pending</span><strong style="color:${b.pendingAmount > 0 ? 'var(--danger)' : 'inherit'}">₹${(b.pendingAmount ?? 0).toLocaleString()}</strong></div>
        </div>
        ${b.comments ? `<div class="cbill-comments">💬 ${esc(b.comments)}</div>` : ''}
        <div class="cbill-actions">
          <button class="btn btn-icon btn-edit" onclick="openUpdateBill('${b.id}')">✏️ Edit</button>
          ${b.status === 'active' ? `<button class="btn btn-icon btn-stop" onclick="stopBill('${b.id}')">⏹ Stop</button>` : ''}
          <button class="btn btn-icon btn-del" onclick="confirmDelete('bill','${b.id}','bill for ${esc(customer.name)}')">🗑 Delete</button>
          <button class="btn btn-whatsapp btn-icon" onclick="sendWhatsAppBillReminderFromDetail('${customer.id}','${b.id}')">📱 Remind</button>
          <button class="btn btn-notify btn-icon" onclick="openBillNotification('${customer.id}','${b.id}')">💬 Notify</button>
          ${b.status === 'active' ? `<button class="btn btn-monthly btn-icon" onclick="openMonthlyReminder('${customer.id}','${b.id}')">📅 Monthly</button>` : ''}
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
    line:    document.getElementById('c-line').value,
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
  document.getElementById('ec-line').value    = c.line || '';
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
    line:    document.getElementById('ec-line').value,
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

function setBillStatusFilter(btn) {
  document.querySelectorAll('.status-toggle-group .status-toggle').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('bill-filter-status').value = btn.dataset.status;
  loadBills();
}

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
      <td>${b.collectedDate ? fmtDate(b.collectedDate) : '—'}</td>
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
  document.getElementById('ub-collected').value      = b.collectedAmount || 0;
  document.getElementById('ub-collecteddate').value  = b.collectedDate || '';
  document.getElementById('ub-arrears').value        = b.arrears || 0;
  document.getElementById('ub-comments').value       = b.comments || '';
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
    { id: 'ub-arrears',   label: 'Arrears',         min: 0 },
  ])) return;
  const id   = document.getElementById('ub-id').value;
  const body = {
    startDate:       document.getElementById('ub-startdate').value,
    stopDate:        document.getElementById('ub-stopdate').value || null,
    quantity:        parseInt(document.getElementById('ub-qty').value),
    perDayCharge:    parseInt(document.getElementById('ub-perday').value),
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

        if (forWhatsApp && clean) {
          // Share mode: include customer name + number in the share text so
          // WhatsApp pre-fills the message. After sharing, open WhatsApp
          // directly to the customer's chat so the user can send it instantly.
          await SharePl.share({
            files: [uri],
            title: 'Electricity Bill',
            text: (data.name || '') + (clean ? '\n📞 ' + clean : ''),
            dialogTitle: 'Send bill to ' + (data.name || 'customer'),
          });
          // Open the customer's WhatsApp chat (1 s delay lets the share
          // intent land in WhatsApp before the deep-link navigates to the chat).
          setTimeout(() => window.open('whatsapp://send?phone=91' + clean, '_system'), 1000);
        } else {
          // Download mode: plain file share, no WhatsApp context.
          await SharePl.share({ files: [uri], title: 'Electricity Bill' });
        }
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

// Open month picker for monthly reminder
function openMonthlyReminder(customerId, billId) {
  const customer = trackerData.find(c => c.id === customerId) ||
    { ...allCustomers.find(c => c.id === customerId), bills: allBills.filter(b => b.customerId === customerId) };
  if (!customer) return;

  const bill = (customer.bills || []).find(b => b.id === billId) || allBills.find(b => b.id === billId);
  if (!bill) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(bill.startDate); start.setHours(0,0,0,0);
  const stop  = bill.stopDate ? new Date(bill.stopDate) : today;
  stop.setHours(0,0,0,0);

  // Build list of months this bill spans
  const months = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= stop) {
    months.push({ month: cur.getMonth() + 1, year: cur.getFullYear() });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  const container = document.getElementById('monthly-reminder-months');
  container.innerHTML = months.map(({ month, year }) => {
    const label = new Date(year, month - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' });
    return `<button class="btn btn-monthly-chip" onclick="sendMonthlyBillReminder('${customerId}','${billId}',${month},${year})">${label}</button>`;
  }).join('');

  openModal('modal-monthly-reminder');
}

// Send reminder for a specific bill restricted to a single month
function sendMonthlyBillReminder(customerId, billId, month, year) {
  closeModal('modal-monthly-reminder');

  const customer = trackerData.find(c => c.id === customerId) ||
    { ...allCustomers.find(c => c.id === customerId), bills: allBills.filter(b => b.customerId === customerId) };
  const bill = (customer?.bills || []).find(b => b.id === billId) || allBills.find(b => b.id === billId);
  if (!customer || !bill) { showToast('Could not load bill data.', 'error'); return; }

  const toMidnight = d => { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
  const mStart = new Date(year, month - 1, 1);
  const mEnd   = new Date(year, month, 0);
  const today  = toMidnight(new Date());

  const billStart = toMidnight(bill.startDate);
  const billStop  = bill.stopDate ? toMidnight(bill.stopDate) : today;

  const clippedStart = billStart > mStart ? billStart : mStart;
  const clippedStop  = billStop  < mEnd   ? billStop  : mEnd;
  const days = clippedStop >= clippedStart
    ? Math.round((clippedStop - clippedStart) / 86400000) + 1
    : 0;

  const total    = days * (bill.quantity || 1) * (bill.perDayCharge || 0);
  const arrears  = bill.arrears || 0;
  const paid     = bill.collectedAmount || 0;
  const pending  = Math.max(0, total + arrears - paid);
  const monthLabel = mStart.toLocaleString('default', { month: 'long', year: 'numeric' });
  const fmt = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  showBillImageModal(customer.mobile, {
    name:       customer.name,
    period:     monthLabel,
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

// Open bill notification with editable message
function openBillNotification(customerId, billId) {
  const customer = trackerData.find(c => c.id === customerId) ||
    { ...allCustomers.find(c => c.id === customerId), bills: allBills.filter(b => b.customerId === customerId) };
  const bill = (customer?.bills || []).find(b => b.id === billId) || allBills.find(b => b.id === billId);
  if (!customer || !bill) { showToast('Could not load bill data.', 'error'); return; }

  const message = formatBillNotification(customer, [bill]);
  promptWhatsApp(customer.mobile, message);
}

// Format bill notification message
function formatBillNotification(customer, bills) {
  const s = getSettings();
  const today = new Date(); today.setHours(0,0,0,0);
  const lines = [];

  lines.push(`Dear ${customer.name},`);
  lines.push(`Reminder for your outstanding bill`);
  lines.push('');

  // Per-bill rows
  const billPrefix = bills.length > 1;
  bills.forEach((b, i) => {
    const start = new Date(b.startDate); start.setHours(0,0,0,0);
    const stop  = b.stopDate ? new Date(b.stopDate) : today;
    stop.setHours(0,0,0,0);
    const days   = Math.max(1, Math.round((stop - start) / 86400000) + 1);
    const amount = days * (b.quantity || 1) * (b.perDayCharge || 0);
    const prefix = billPrefix ? `Set${i + 1}: ` : '';
    lines.push(`${prefix}${fmtDate(start)} → ${b.stopDate ? fmtDate(stop) : 'Running'} · ${days} day${days !== 1 ? 's' : ''} · ₹${amount.toLocaleString()}`);
  });

  // Monthly breakdown
  const monthlyTotals = {};
  let totalDays = 0, totalAmount = 0;
  bills.forEach(b => {
    const start = new Date(b.startDate); start.setHours(0,0,0,0);
    const stop  = b.stopDate ? new Date(b.stopDate) : today;
    stop.setHours(0,0,0,0);
    const days   = Math.max(1, Math.round((stop - start) / 86400000) + 1);
    const amount = days * (b.quantity || 1) * (b.perDayCharge || 0);
    totalDays   += days;
    totalAmount += amount;
    const monthly = getMonthlyBreakdown(b, today);
    Object.entries(monthly).forEach(([month, amt]) => {
      monthlyTotals[month] = (monthlyTotals[month] || 0) + amt;
    });
  });

  const monthlyStr = Object.entries(monthlyTotals)
    .map(([month, amt]) => `${month}: ₹${amt.toLocaleString()}`)
    .join('  |  ');

  if (monthlyStr) lines.push(monthlyStr);

  lines.push(`Days: ${totalDays}`);

  const arrears  = bills.reduce((s, b) => s + (b.arrears || 0), 0);
  const collected = bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);

  if (arrears > 0) lines.push(`Arrears: ₹${arrears.toLocaleString()}`);
  lines.push(`Paid: ₹${collected.toLocaleString()}`);
  lines.push(`-----`);
  lines.push(`Total: ₹${totalAmount.toLocaleString()}`);
  lines.push('');

  if (s.operatorMobile) {
    lines.push(`Please pay outstanding amount to ${s.operatorMobile} and share the receipt.`);
  } else {
    lines.push(`Please pay the outstanding amount and share the receipt.`);
  }
  lines.push(`For any queries, please contact us. Thank you.`);

  return lines.join('\n');
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
      <td>${b.collectedDate ? fmtDate(b.collectedDate) : '—'}</td>
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

function selectUnitsPerDay(n) {
  document.getElementById('bs-units-per-day').value = n;
  document.querySelectorAll('.bs-units-toggle .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.units) === n);
  });
}

async function loadBalanceSheet() {
  if (!validateFields([{ id: 'bs-filter-year', label: 'Year', required: true, min: 2000, max: 2100 }])) return;
  const month       = document.getElementById('bs-filter-month').value;
  const year        = document.getElementById('bs-filter-year').value;
  const unitsPerDay = document.getElementById('bs-units-per-day').value || 20;
  try {
    lastBSData = await apiFetch(`/api/balance-sheet?month=${month}&year=${year}&unitsPerDay=${unitsPerDay}`);
    renderBalanceSheet(lastBSData);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderBalanceSheet(data) {
  const { month, year, bills, monthlyCharge, summary, stats } = data;
  const label = `${MONTH_NAMES[month]} ${year}`;
  const hasCharge = !!monthlyCharge;

  // ─── Profit hero (two components) ────────────────────────────
  const expClass = stats.expectedProfit >= 0 ? 'bs-profit-half-green' : 'bs-profit-half-red';
  const actClass = stats.actualProfit   >= 0 ? 'bs-profit-half-green' : 'bs-profit-half-red';
  document.getElementById('bs-revenue-card').innerHTML = `
    <div class="bs-revenue-card">
      <div class="bs-revenue-label">${label} — Profit Summary</div>
      <div class="bs-profit-row">
        <div class="bs-profit-half ${expClass}">
          <div class="bs-profit-left">
            <div class="bs-profit-half-label">📊 Expected Profit</div>
            <div class="bs-profit-half-value">₹${Math.abs(stats.expectedProfit).toLocaleString()}</div>
          </div>
          <div class="bs-profit-right">
            <div class="bs-profit-half-tag">${stats.expectedProfit >= 0 ? '📈 Profit' : '📉 Loss'}</div>
            <div class="bs-profit-half-formula">
              ₹${summary.totalCharged.toLocaleString()} Total<br>
              + ₹${(summary.totalArrears || 0).toLocaleString()} Arrears<br>
              − ₹${stats.projectedAmount.toLocaleString()} Board Bill
            </div>
          </div>
        </div>
        <div class="bs-profit-half ${actClass}">
          <div class="bs-profit-left">
            <div class="bs-profit-half-label">💰 Actual Profit</div>
            <div class="bs-profit-half-value">₹${Math.abs(stats.actualProfit).toLocaleString()}</div>
          </div>
          <div class="bs-profit-right">
            <div class="bs-profit-half-tag">${stats.actualProfit >= 0 ? '📈 Profit' : '📉 Loss'}</div>
            <div class="bs-profit-half-formula">
              ₹${summary.totalCollected.toLocaleString()} Collected<br>
              − ₹${stats.projectedAmount.toLocaleString()} Board Bill
            </div>
          </div>
        </div>
      </div>
      ${!hasCharge ? '<div class="bs-no-charge-hint">⚠️ No monthly charge recorded yet. Add one to see accurate profit figures.</div>' : ''}
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
      <td>${b.collectedDate ? fmtDate(b.collectedDate) : '—'}</td>
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
  const urls = { customer: `/api/customers/${id}`, bill: `/api/bills/${id}`, 'monthly-charge': `/api/monthly-charges/${id}`, payment: `/api/payments/${id}` };
  try {
    await apiFetch(urls[type], { method: 'DELETE' });
    closeModal('modal-confirm-delete');
    showToast('Deleted successfully.', 'success');
    if (type === 'customer')       { loadCustomers(); loadTrackerByCustomer(); closeCustomerPage(); }
    if (type === 'bill')           { loadBills();     loadTrackerByCustomer(); refreshCustomerPage(); }
    if (type === 'monthly-charge') { loadBalanceSheet(); }
    if (type === 'payment')        { refreshAfterPaymentChange(); refreshCustomerPaymentsModal(); if (document.getElementById('modal-all-payments').classList.contains('open')) openAllPayments(); }
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
    payments:   JSON.parse(localStorage.getItem('ebt_payments')  || '[]'),
  };
  const total = backup.customers.length + backup.bills.length + backup.charges.length + backup.payments.length;
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
  showToast(`Backup saved — ${backup.customers.length} customers, ${backup.bills.length} bills, ${backup.payments.length} payments, ${backup.charges.length} charges.`, 'success');
}

function triggerRestoreBackup() {
  const inp = document.getElementById('restore-file-input');
  if (inp) { inp.value = ''; inp.click(); }
}

// Reads a picked file as text. Older Android WebViews lack Blob.text(),
// so fall back to FileReader.
function readFileAsText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('unknown read error'));
    reader.readAsText(file);
  });
}

// Accepts plain JSON, or the same JSON wrapped as base64 text (some file
// handlers re-save the backup that way).
function parseBackupText(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (plainErr) {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) throw plainErr;
    const decoded = decodeURIComponent(escape(atob(trimmed.replace(/\s+/g, ''))));
    return JSON.parse(decoded); // throws if this is not JSON either
  }
}

async function handleRestoreFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  let text;
  try {
    text = await readFileAsText(file);
  } catch (e) {
    showToast(`Could not read the file: ${e.message || e.name || 'unknown error'}. Try copying it to Downloads and picking it again.`, 'error');
    return;
  }
  if (!text || !text.trim()) {
    showToast('The selected file is empty.', 'error');
    return;
  }

  let data;
  try {
    data = parseBackupText(text);
  } catch (e) {
    // Show size and the first characters only (no customer data) to help diagnose.
    const head = text.slice(0, 12).replace(/[^\x20-\x7E]/g, '?');
    showToast(`Not a valid backup: ${file.name || 'file'} (${text.length} characters, starts with "${head}"). Export a new backup and try again.`, 'error');
    return;
  }
  if (!data || !Array.isArray(data.customers) || !Array.isArray(data.bills)) {
    showToast('Invalid backup file — missing customers or bills.', 'error');
    return;
  }

  try {
    window._pendingRestore = data;
    document.getElementById('restore-count').textContent =
      `${data.customers.length} customers · ${data.bills.length} bills · ${(data.payments || []).length} payments · ${(data.charges || []).length} monthly charges`;
    document.getElementById('restore-exported-at').textContent =
      data.exportedAt ? new Date(data.exportedAt).toLocaleString('en-IN') : 'Unknown';
    openModal('modal-restore-confirm');
  } catch (e) {
    showToast(`Could not show backup details: ${e.message}`, 'error');
  }
}

function doRestoreBackup() {
  const data = window._pendingRestore;
  if (!data) return;
  try {
    localStorage.setItem('ebt_customers', JSON.stringify(data.customers || []));
    localStorage.setItem('ebt_bills',     JSON.stringify(data.bills     || []));
    localStorage.setItem('ebt_charges',   JSON.stringify(data.charges   || []));
    localStorage.setItem('ebt_payments',  JSON.stringify(data.payments  || []));
    DB.migrate(); // converts paid amounts from older backups into payments
    window._pendingRestore = null;
    closeModal('modal-restore-confirm');
    showToast(`Restored: ${data.customers.length} customers, ${data.bills.length} bills, ${(data.payments||[]).length} payments, ${(data.charges||[]).length} charges.`, 'success');
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

// ── Payments exports ─────────────────────────────────────────
function paymentRowsForCSV(list) {
  const headers = ['Date', 'Customer', 'Mobile', 'Amount', 'Applied To', 'Applied Amount', 'Credit', 'Mode', 'Note', 'Payment ID'];
  const rows = list.map(p => [
    p.date, p.customerName || '', p.customerMobile || '', p.amount,
    p.allocations.map(a => `${billPeriodLabel(a.billStartDate, a.billStopDate)}: ${a.amount}`).join('; '),
    p.allocated, p.credit, p.mode || '', p.note || '', p.id,
  ]);
  return { headers, rows };
}

function stampDate() { return toDateStr(new Date()); }

function exportAllPaymentsCSV() {
  const list = filteredAllPayments();
  if (!list.length) { showToast('No payments to export.', 'warning'); return; }
  const { headers, rows } = paymentRowsForCSV(list);
  downloadCSV(`payments-${stampDate()}.csv`, buildCSV(headers, rows));
}

function exportCustomerPaymentsCSV() {
  if (!customerPaymentsCache.length) { showToast('No payments to export.', 'warning'); return; }
  const { headers, rows } = paymentRowsForCSV(customerPaymentsCache);
  const name = (customerPaymentsCache[0].customerName || 'customer').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  downloadCSV(`payments-${name}-${stampDate()}.csv`, buildCSV(headers, rows));
}

// Receivables for the selected month: summary, aging, and who owes what.
function exportReceivablesCSV() {
  if (!lastReceivables) { showToast('Open the Payments tab first.', 'warning'); return; }
  const r = lastReceivables;
  const headers = ['Section', 'Name', 'Mobile', 'Open Bills', 'Amount (₹)'];
  const rows = [
    ['Summary', `Billed in ${r.month}/${r.year}`, '', '', r.summary.billedInMonth],
    ['Summary', 'Collected in month', '', '', r.summary.collectedInMonth],
    ['Summary', 'Applied to bills in month', '', '', r.summary.allocatedInMonth],
    ['Summary', 'Outstanding now', '', '', r.summary.outstandingNow],
    ['Summary', 'Customer credit', '', '', r.summary.customerCredit],
    ...r.aging.map(a => ['Aging', a.label, '', a.bills, a.amount]),
    ...r.customers.map(c => ['Pending by customer', c.customerName, c.mobile || '', c.openBills, c.pending]),
  ];
  downloadCSV(`receivables-${r.year}-${String(r.month).padStart(2, '0')}.csv`, buildCSV(headers, rows));
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
  const text = await readFileAsText(file);
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
        if (stopDate || status === 'stopped') {
          const upd = {};
          if (stopDate) upd.stopDate = stopDate;
          else upd.stopDate = toDateStr(new Date());
          await apiFetch(`/api/bills/${bill.id}`, { method: 'PUT', body: JSON.stringify(upd) });
        }
        if (collected > 0) {
          // Paid amounts are recorded as payments, capped at what the bill owes.
          const applied = Math.min(collected, bill.pendingAmount || 0);
          await apiFetch('/api/payments', { method: 'POST', body: JSON.stringify({
            customerId: customer.id, date: stopDate || toDateStr(new Date()), amount: collected,
            mode: 'Imported', note: 'Imported from CSV',
            allocations: applied > 0 ? [{ billId: bill.id, amount: applied }] : [],
          }) });
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

// ══════════════════════════════════════════════════════════════
//  PAYMENTS & RECEIVABLES
// ══════════════════════════════════════════════════════════════

let editingAlloc = {}; // billId -> amount the payment being edited already holds

function paymentMonthParams() {
  const now = new Date();
  const m = document.getElementById('pay-month');
  const y = document.getElementById('pay-year');
  if (!m.dataset.ready) { // first visit: open on the current month
    m.value = now.getMonth() + 1;
    y.value = now.getFullYear();
    m.dataset.ready = '1';
  }
  return { month: parseInt(m.value), year: parseInt(y.value) };
}

function billPeriodLabel(start, stop) {
  if (!start) return 'Deleted bill';
  return `${fmtDate(start)} → ${stop ? fmtDate(stop) : 'Running'}`;
}

let lastReceivables = null; // last receivables payload, for CSV export

async function loadPayments() {
  const { month, year } = paymentMonthParams();
  const customerId = document.getElementById('pay-customer-filter').value;
  try {
    const [receivables, payments, customers] = await Promise.all([
      apiFetch(`/api/receivables?month=${month}&year=${year}`),
      apiFetch(`/api/payments${customerId ? `?customerId=${customerId}` : ''}`),
      apiFetch('/api/customers'),
    ]);
    allCustomers = customers;
    fillCustomerSelect(document.getElementById('pay-customer-filter'), customers, 'All customers');
    lastReceivables = receivables;
    renderReceivables(receivables);
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    renderPaymentsTable(payments.filter(p => p.date.startsWith(prefix)));
  } catch (e) { showToast(e.message, 'error'); }
}

function fillCustomerSelect(sel, customers, firstLabel) {
  const keep = sel.value;
  sel.innerHTML = `<option value="">${firstLabel}</option>` +
    customers.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.mobile)})</option>`).join('');
  sel.value = keep;
}

function renderReceivables(rec) {
  const s = rec.summary;
  const money = n => `₹${(n || 0).toLocaleString()}`;
  document.getElementById('pay-summary').innerHTML = `
    <div class="summary-card sc-total"><div class="sc-label">Billed this month</div><div class="sc-value">${money(s.billedInMonth)}</div></div>
    <div class="summary-card sc-collected"><div class="sc-label">Collected this month</div><div class="sc-value">${money(s.collectedInMonth)}</div></div>
    <div class="summary-card sc-pending"><div class="sc-label">Outstanding now</div><div class="sc-value">${money(s.outstandingNow)}</div></div>
    <div class="summary-card"><div class="sc-label">Customer credit</div><div class="sc-value">${money(s.customerCredit)}</div></div>`;

  document.getElementById('pay-aging-body').innerHTML = rec.aging.map(a =>
    `<tr><td>${a.label}</td><td>${a.bills}</td><td>${money(a.amount)}</td></tr>`).join('');

  const tb = document.getElementById('pay-customers-body');
  tb.innerHTML = rec.customers.length
    ? rec.customers.map(c => `<tr>
        <td><strong>${esc(c.customerName)}</strong></td><td>${esc(c.mobile || '')}</td><td>${c.openBills}</td><td>${money(c.pending)}</td>
        <td><button class="btn btn-whatsapp btn-sm" onclick="openRemind('${c.customerId}')">📱 Remind</button></td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty-row">No pending amounts 🎉</td></tr>';
}

function renderPaymentsTable(list) {
  const tb = document.getElementById('payments-tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty-row">No payments recorded for this month</td></tr>';
    return;
  }
  tb.innerHTML = list.map(p => {
    const applied = p.allocations.length
      ? p.allocations.map(a => `${esc(billPeriodLabel(a.billStartDate, a.billStopDate))}: ₹${a.amount.toLocaleString()}`).join('<br>')
      : '<span class="pay-hint">Not applied (credit)</span>';
    return `<tr>
      <td>${fmtDate(p.date)}</td>
      <td><strong>${esc(p.customerName)}</strong><br><span class="pay-hint">${esc(p.customerMobile || '')}</span></td>
      <td>₹${p.amount.toLocaleString()}</td>
      <td>${applied}</td>
      <td>${p.credit > 0 ? `₹${p.credit.toLocaleString()}` : '—'}</td>
      <td>${esc(p.mode || '')}</td>
      <td>${esc(p.note || '')}</td>
      <td><div class="actions-cell">
        <button class="btn btn-icon btn-edit" title="Edit" onclick="openPaymentModal('${p.id}')">✏️</button>
        <button class="btn btn-icon btn-del" title="Delete" onclick="confirmDelete('payment','${p.id}','₹${p.amount.toLocaleString()} payment')">🗑</button>
      </div></td>
    </tr>`;
  }).join('');
}

async function openPaymentModal(id = null, presetCustomerId = null) {
  try {
    const customers = await apiFetch('/api/customers');
    allCustomers = customers;
    document.getElementById('form-payment').reset();
    document.getElementById('pay-id').value = id || '';
    document.getElementById('pay-modal-title').textContent = id ? 'Edit Payment' : 'Record Payment';
    document.getElementById('pay-submit-btn').disabled = false;
    fillCustomerSelect(document.getElementById('pay-customer'), customers, '-- Select Customer --');
    editingAlloc = {};
    if (id) {
      const p = (await apiFetch('/api/payments')).find(x => x.id === id);
      if (!p) throw new Error('Payment not found');
      p.allocations.forEach(a => { editingAlloc[a.billId] = a.amount; });
      document.getElementById('pay-customer').value = p.customerId;
      document.getElementById('pay-date').value     = p.date;
      document.getElementById('pay-amount').value   = p.amount;
      document.getElementById('pay-mode').value     = p.mode || 'Cash';
      document.getElementById('pay-note').value     = p.note || '';
    } else {
      document.getElementById('pay-date').value = toDateStr(new Date());
      if (presetCustomerId) document.getElementById('pay-customer').value = presetCustomerId;
    }
    await loadPaymentBills();
    openModal('modal-payment');
  } catch (e) { showToast(e.message, 'error'); }
}

function onPaymentCustomerChange() {
  editingAlloc = {}; // a different customer starts with nothing applied
  loadPaymentBills();
}

async function loadPaymentBills() {
  const customerId = document.getElementById('pay-customer').value;
  const tb = document.getElementById('pay-alloc-body');
  if (!customerId) {
    tb.innerHTML = '<tr><td colspan="3" class="empty-row">Select a customer</td></tr>';
    updateAllocSummary();
    return;
  }
  try {
    const bills = (await apiFetch(`/api/bills?customerId=${customerId}`))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (!bills.length) {
      tb.innerHTML = '<tr><td colspan="3" class="empty-row">This customer has no bills</td></tr>';
    } else {
      tb.innerHTML = bills.map(b => {
        // In edit mode, the amount this payment already holds is available again.
        const own = editingAlloc[b.id] || 0;
        const available = Math.max(0, round2Js(b.pendingAmount + own));
        return `<tr>
          <td>${esc(billPeriodLabel(b.startDate, b.stopDate))}<br>
              <span class="pay-hint">${b.numberOfDays} days · ₹${b.perDayCharge}/day × ${b.quantity} · ${b.paymentStatus}</span></td>
          <td>₹${available.toLocaleString()}</td>
          <td><input type="number" min="0" step="1" class="pay-alloc-input" data-bill-id="${b.id}" data-max="${available}"
                     value="${own || ''}" oninput="updateAllocSummary()" /></td>
        </tr>`;
      }).join('');
    }
  } catch (e) { showToast(e.message, 'error'); }
  updateAllocSummary();
}

function round2Js(n) { return Math.round((n || 0) * 100) / 100; }

async function autoAllocatePayment() {
  const customerId = document.getElementById('pay-customer').value;
  const amount     = parseFloat(document.getElementById('pay-amount').value) || 0;
  if (!customerId || amount <= 0) { showToast('Select a customer and enter the amount first.', 'warning'); return; }
  const id = document.getElementById('pay-id').value;
  try {
    const res = await apiFetch(`/api/payments/auto-allocate?customerId=${customerId}&amount=${amount}${id ? `&excludeId=${id}` : ''}`);
    document.querySelectorAll('.pay-alloc-input').forEach(i => { i.value = ''; });
    res.allocations.forEach(a => {
      const el = document.querySelector(`.pay-alloc-input[data-bill-id="${a.billId}"]`);
      if (el) el.value = a.amount;
    });
    updateAllocSummary();
  } catch (e) { showToast(e.message, 'error'); }
}

function clearAllocations() {
  document.querySelectorAll('.pay-alloc-input').forEach(i => { i.value = ''; });
  updateAllocSummary();
}

function updateAllocSummary() {
  const amount = parseFloat(document.getElementById('pay-amount').value) || 0;
  let applied = 0, overBill = false;
  document.querySelectorAll('.pay-alloc-input').forEach(i => {
    const v = parseFloat(i.value) || 0;
    const max = parseFloat(i.dataset.max) || 0;
    applied += v;
    const over = v > max + 0.001;
    i.classList.toggle('pay-over', over);
    if (over) overBill = true;
  });
  const credit = round2Js(amount - applied);
  const problems = [];
  if (applied > amount + 0.001) problems.push('Applied is more than the amount received');
  if (overBill) problems.push('A bill gets more than its pending amount');
  document.getElementById('pay-alloc-summary').innerHTML = `
    <span>Received: <strong>₹${amount.toLocaleString()}</strong></span>
    <span>Applied: <strong>₹${round2Js(applied).toLocaleString()}</strong></span>
    <span>${credit < 0 ? 'Short' : 'Credit'}: <strong style="color:${credit < 0 ? 'var(--danger)' : 'inherit'}">₹${Math.abs(credit).toLocaleString()}</strong></span>
    ${problems.length ? `<span style="color:var(--danger)">${problems.join(' · ')}</span>` : ''}`;
  document.getElementById('pay-submit-btn').disabled = problems.length > 0;
}

async function submitPayment(e) {
  e.preventDefault();
  if (!validateFields([
    { id: 'pay-customer', label: 'Customer',        required: true },
    { id: 'pay-date',     label: 'Payment Date',    required: true, isDate: true },
    { id: 'pay-amount',   label: 'Amount Received', required: true, min: 1 },
  ])) return;
  const id = document.getElementById('pay-id').value;
  const body = readPaymentForm();
  if (id) {
    // Editing an existing payment saves directly.
    try {
      await apiFetch(`/api/payments/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      closeModal('modal-payment');
      showToast('Payment updated!', 'success');
      refreshAfterPaymentChange();
    } catch (err) { showToast(err.message, 'error'); }
    return;
  }
  // New payment: show the receipt message first; nothing is saved until the user chooses.
  try {
    const { mobile, text } = await buildPaymentReceipt(body);
    pendingPayment = { body, mobile };
    paymentReceiptDefault = text;
    document.getElementById('wa-pay-msg').value = text;
    document.getElementById('wa-pay-whatsapp-btn').disabled = !mobile.replace(/\D/g, '');
    document.getElementById('wa-pay-mobile-hint').textContent = mobile
      ? `Will be sent to ${mobile}`
      : 'Customer has no mobile number, so WhatsApp is not available.';
    openModal('modal-payment-wa');
  } catch (err) { showToast(err.message, 'error'); }
}

function readPaymentForm() {
  return {
    customerId:  document.getElementById('pay-customer').value,
    date:        document.getElementById('pay-date').value,
    amount:      parseFloat(document.getElementById('pay-amount').value),
    mode:        document.getElementById('pay-mode').value,
    note:        document.getElementById('pay-note').value.trim(),
    allocations: [...document.querySelectorAll('.pay-alloc-input')]
      .map(i => ({ billId: i.dataset.billId, amount: parseFloat(i.value) || 0 }))
      .filter(a => a.amount > 0),
  };
}

// Receipt text for a payment that is about to be saved. Pending is what the
// customer still owes after this payment is applied.
async function buildPaymentReceipt(body) {
  const customers = await apiFetch('/api/customers');
  const customer  = customers.find(c => c.id === body.customerId);
  const bills     = await apiFetch(`/api/bills?customerId=${body.customerId}`);
  const applied   = round2Js(body.allocations.reduce((s, a) => s + a.amount, 0));
  const credit    = round2Js(body.amount - applied);
  const pendingBefore = bills.reduce((s, b) => s + (b.pendingAmount || 0), 0);
  const pendingAfter  = Math.max(0, round2Js(pendingBefore - applied));
  const money = n => `₹${round2Js(n).toLocaleString()}`;
  const operator = getSettings().operatorMobile;

  const lines = [
    `Dear ${customer ? customer.name : ''},`,
    '',
    `*Payment received* ✅`,
    '',
    `*Date:* ${fmtDate(body.date)}`,
    `*Amount:* ${money(body.amount)}`,
    `*Mode:* ${body.mode}`,
  ];
  if (body.note) lines.push(`*Note:* ${body.note}`);
  if (body.allocations.length) {
    lines.push('', '*Applied to:*');
    body.allocations.forEach(a => {
      const b = bills.find(x => x.id === a.billId);
      lines.push(`• ${b ? billPeriodLabel(b.startDate, b.stopDate) : 'Bill'} — ${money(a.amount)}`);
    });
  }
  if (credit > 0) lines.push('', `*Advance / credit:* ${money(credit)}`);
  lines.push('', `*Balance pending:* ${money(pendingAfter)}`, '');
  lines.push(operator ? `Contact: ${operator} | Thank you!` : 'For any queries, please contact us. Thank you!');
  return { mobile: customer ? customer.mobile : '', text: lines.join('\n') };
}

let pendingPayment = null;        // { body, mobile } waiting for the user's choice
let paymentReceiptDefault = '';   // generated text, used by "Reset"

// Formatting buttons: wrap the selected text in WhatsApp markers.
function wrapReceiptSelection(marker) { wrapSelection('wa-pay-msg', marker); }

function wrapSelection(textareaId, marker) {
  const ta = document.getElementById(textareaId);
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const selected = value.slice(a, b) || 'text';
  ta.value = value.slice(0, a) + marker + selected + marker + value.slice(b);
  ta.focus();
  ta.setSelectionRange(a + marker.length, a + marker.length + selected.length);
}

function resetReceiptText() {
  document.getElementById('wa-pay-msg').value = paymentReceiptDefault;
}

// "Skip & Save" (sendWhatsApp = false) or "WhatsApp & Save".
async function savePendingPayment(sendWhatsApp) {
  if (!pendingPayment) return;
  const { body, mobile } = pendingPayment;
  const text = document.getElementById('wa-pay-msg').value;
  const digits = (mobile || '').replace(/\D/g, '');
  // Open WhatsApp first, while the click is still a user gesture (pop-up blockers).
  if (sendWhatsApp && digits) {
    window.open(`https://wa.me/91${digits}?text=${encodeURIComponent(text)}`, '_blank');
  }
  try {
    await apiFetch('/api/payments', { method: 'POST', body: JSON.stringify(body) });
    pendingPayment = null;
    closeModal('modal-payment-wa');
    closeModal('modal-payment');
    showToast(sendWhatsApp ? 'Payment saved and WhatsApp opened.' : 'Payment saved.', 'success');
    refreshAfterPaymentChange();
  } catch (err) {
    showToast(`Payment NOT saved: ${err.message}`, 'error');
  }
}

// Payments change what every bill shows as paid, so refresh all views.
function refreshAfterPaymentChange() {
  loadPayments();
  loadBills();
  loadTrackerByCustomer();
  refreshCustomerPage();
  loadHome();
}

// ══════════════════════════════════════════════════════════════
//  ALL PAYMENTS OF ONE CUSTOMER
// ══════════════════════════════════════════════════════════════

let customerPaymentsId    = null; // customer shown in the customer-payments modal
let customerPaymentsCache = []; // that customer's payments, for CSV export

async function openCustomerPayments(customerId) {
  customerPaymentsId = customerId;
  openModal('modal-customer-payments');
  await refreshCustomerPaymentsModal();
}

async function refreshCustomerPaymentsModal() {
  const customerId = customerPaymentsId;
  if (!customerId || !document.getElementById('modal-customer-payments').classList.contains('open')) return;
  const money = n => `₹${(n || 0).toLocaleString()}`;
  try {
    const [customers, payments, bills] = await Promise.all([
      apiFetch('/api/customers'),
      apiFetch(`/api/payments?customerId=${customerId}`),
      apiFetch(`/api/bills?customerId=${customerId}`),
    ]);
    const c = customers.find(x => x.id === customerId);
    document.getElementById('cp-title').textContent = `Payments · ${c ? c.name : ''}`;
    document.getElementById('cp-sub').textContent   = c ? c.mobile : '';

    customerPaymentsCache = payments;
    const received = payments.reduce((s, p) => s + p.amount, 0);
    const applied  = payments.reduce((s, p) => s + p.allocated, 0);
    const credit   = payments.reduce((s, p) => s + p.credit, 0);
    const pending  = bills.reduce((s, b) => s + (b.pendingAmount || 0), 0);
    document.getElementById('cp-summary').innerHTML = `
      <div class="summary-card sc-collected"><div class="sc-label">Received</div><div class="sc-value">${money(received)}</div></div>
      <div class="summary-card sc-pending"><div class="sc-label">Pending</div><div class="sc-value">${money(pending)}</div></div>
      <div class="summary-card"><div class="sc-label">Applied to bills</div><div class="sc-value">${money(applied)}</div></div>
      <div class="summary-card"><div class="sc-label">Credit</div><div class="sc-value">${money(credit)}</div></div>`;

    const tb = document.getElementById('cp-tbody');
    tb.innerHTML = payments.length
      ? payments.map(p => {
          const applied = p.allocations.length
            ? p.allocations.map(a => `${esc(billPeriodLabel(a.billStartDate, a.billStopDate))}: ₹${a.amount.toLocaleString()}`).join('<br>')
            : '<span class="pay-hint">Not applied (credit)</span>';
          return `<tr>
            <td>${fmtDate(p.date)}</td>
            <td>${money(p.amount)}</td>
            <td>${applied}</td>
            <td>${p.credit > 0 ? money(p.credit) : '—'}</td>
            <td>${esc(p.mode || '')}${p.note ? `<br><span class="pay-hint">${esc(p.note)}</span>` : ''}</td>
            <td><div class="actions-cell">
              <button class="btn btn-icon btn-edit" title="Edit" onclick="editPaymentFromCustomer('${p.id}')">✏️</button>
              <button class="btn btn-icon btn-del" title="Delete" onclick="confirmDelete('payment','${p.id}','${money(p.amount)} payment')">🗑</button>
            </div></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="6" class="empty-row">No payments recorded for this customer</td></tr>';
  } catch (e) { showToast(e.message, 'error'); }
}

function recordPaymentForCustomer() {
  closeModal('modal-customer-payments');
  openPaymentModal(null, customerPaymentsId);
}

function editPaymentFromCustomer(paymentId) {
  closeModal('modal-customer-payments');
  openPaymentModal(paymentId);
}

// ══════════════════════════════════════════════════════════════
//  ALL PAYMENTS (filterable)
// ══════════════════════════════════════════════════════════════

let allPaymentsList = []; // every payment, loaded when the modal opens

async function openAllPayments() {
  try {
    const [customers, payments] = await Promise.all([
      apiFetch('/api/customers'),
      apiFetch('/api/payments'),
    ]);
    allCustomers = customers;
    allPaymentsList = payments;
    fillCustomerSelect(document.getElementById('ap-customer'), customers, 'All customers');
    openModal('modal-all-payments');
    renderAllPayments();
  } catch (e) { showToast(e.message, 'error'); }
}

function resetAllPaymentsFilters() {
  ['ap-from', 'ap-to'].forEach(id => { document.getElementById(id).value = ''; });
  ['ap-customer', 'ap-mode', 'ap-status'].forEach(id => { document.getElementById(id).value = ''; });
  renderAllPayments();
}

function filteredAllPayments() {
  const from     = document.getElementById('ap-from').value;
  const to       = document.getElementById('ap-to').value;
  const customer = document.getElementById('ap-customer').value;
  const mode     = document.getElementById('ap-mode').value;
  const status   = document.getElementById('ap-status').value;
  return allPaymentsList.filter(p => {
    if (from && p.date < from) return false;
    if (to   && p.date > to)   return false;
    if (customer && p.customerId !== customer) return false;
    if (mode && p.mode !== mode) return false;
    if (status === 'applied'   && !(p.credit <= 0.001 && p.allocated > 0)) return false;
    if (status === 'credit'    && !(p.credit > 0.001)) return false;
    if (status === 'unapplied' && p.allocated > 0) return false;
    return true;
  });
}

function renderAllPayments() {
  const list = filteredAllPayments();
  const money = n => `₹${round2Js(n).toLocaleString()}`;
  const received = list.reduce((s, p) => s + p.amount, 0);
  const applied  = list.reduce((s, p) => s + p.allocated, 0);
  const credit   = list.reduce((s, p) => s + p.credit, 0);
  document.getElementById('ap-summary').innerHTML = `
    <div class="summary-card"><div class="sc-label">Payments</div><div class="sc-value">${list.length}</div></div>
    <div class="summary-card sc-collected"><div class="sc-label">Received</div><div class="sc-value">${money(received)}</div></div>
    <div class="summary-card"><div class="sc-label">Applied to bills</div><div class="sc-value">${money(applied)}</div></div>
    <div class="summary-card sc-pending"><div class="sc-label">Credit</div><div class="sc-value">${money(credit)}</div></div>`;

  const tb = document.getElementById('ap-tbody');
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty-row">No payments match these filters</td></tr>';
    return;
  }
  tb.innerHTML = list.map(p => {
    const applied = p.allocations.length
      ? p.allocations.map(a => `${esc(billPeriodLabel(a.billStartDate, a.billStopDate))}: ₹${a.amount.toLocaleString()}`).join('<br>')
      : '<span class="pay-hint">Not applied (credit)</span>';
    return `<tr>
      <td>${fmtDate(p.date)}</td>
      <td><strong>${esc(p.customerName)}</strong><br><span class="pay-hint">${esc(p.customerMobile || '')}</span></td>
      <td>₹${p.amount.toLocaleString()}</td>
      <td>${applied}</td>
      <td>${p.credit > 0 ? `₹${p.credit.toLocaleString()}` : '—'}</td>
      <td>${esc(p.mode || '')}${p.note ? `<br><span class="pay-hint">${esc(p.note)}</span>` : ''}</td>
      <td><div class="actions-cell">
        <button class="btn btn-icon btn-edit" title="Edit" onclick="editPaymentFromAll('${p.id}')">✏️</button>
        <button class="btn btn-icon btn-del" title="Delete" onclick="confirmDelete('payment','${p.id}','₹${p.amount.toLocaleString()} payment')">🗑</button>
      </div></td>
    </tr>`;
  }).join('');
}

function editPaymentFromAll(paymentId) {
  closeModal('modal-all-payments');
  openPaymentModal(paymentId);
}

// ══════════════════════════════════════════════════════════════
//  PAYMENT REMINDER (WhatsApp, per customer with pending amount)
// ══════════════════════════════════════════════════════════════

let remindCustomerId = null;
let remindMobile     = '';
let remindDefault    = '';   // text generated from the current options
// Which details go into the message. Kept between opens.
const remindOpts = { perBill: true, arrears: true, lastPayment: true, contact: true };

const REMIND_OPTION_LABELS = {
  perBill:     'Each set: charges, paid, due',
  arrears:     'Arrears line (where present)',
  lastPayment: 'Last payment date',
  contact:     'Operator contact line',
};

async function openRemind(customerId) {
  remindCustomerId = customerId;
  const box = document.getElementById('remind-options');
  box.innerHTML = Object.keys(REMIND_OPTION_LABELS).map(k => `
    <label class="remind-opt"><input type="checkbox" data-opt="${k}" ${remindOpts[k] ? 'checked' : ''}
      onchange="setRemindOption('${k}', this.checked)" /> ${REMIND_OPTION_LABELS[k]}</label>`).join('');
  try {
    await regenerateRemind();
    openModal('modal-remind');
  } catch (e) { showToast(e.message, 'error'); }
}

async function buildRemindText(customerId, opts) {
  const customers = await apiFetch('/api/customers');
  const c = customers.find(x => x.id === customerId);
  if (!c) throw new Error('Customer not found');
  const bills = (await apiFetch(`/api/bills?customerId=${customerId}`))
    .filter(b => b.pendingAmount > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const payments = await apiFetch(`/api/payments?customerId=${customerId}`); // newest first
  const money = n => `₹${round2Js(n).toLocaleString()}`;
  const total = round2Js(bills.reduce((s, b) => s + b.pendingAmount, 0));

  const lines = [
    `Dear ${c.name},`,
    '',
    `*Payment reminder* 🔔`,
    `Your electricity bill has a pending balance.`,
  ];
  if (opts.perBill && bills.length) {
    lines.push('');
    bills.forEach(b => {
      const charges = b.total || 0;
      lines.push(`• ${billPeriodLabel(b.startDate, b.stopDate)}`);
      lines.push(`   Charges ${money(charges)}${opts.arrears && b.arrears > 0 ? ` + Arrears ${money(b.arrears)}` : ''}`);
      lines.push(`   Paid ${money(b.collectedAmount)} · *Due ${money(b.pendingAmount)}*`);
    });
  }
  lines.push('', `*Total pending: ${money(total)}*`);
  if (opts.lastPayment && payments.length) lines.push(`Last payment: ${fmtDate(payments[0].date)}`);
  lines.push('', 'Please pay the pending amount at your earliest and share the receipt.');
  const operator = getSettings().operatorMobile;
  lines.push(opts.contact && operator ? `Contact: ${operator} | Thank you!` : 'Thank you!');
  return { mobile: c.mobile || '', text: lines.join('\n') };
}

async function regenerateRemind() {
  const d = await buildRemindText(remindCustomerId, remindOpts);
  remindMobile  = d.mobile;
  remindDefault = d.text;
  document.getElementById('remind-msg').value = d.text;
  const hasMobile = !!remindMobile.replace(/\D/g, '');
  document.getElementById('remind-send-btn').disabled = !hasMobile;
  document.getElementById('remind-hint').textContent = hasMobile
    ? `Will be sent to ${remindMobile}`
    : 'This customer has no mobile number, so WhatsApp is not available.';
}

// Changing a detail rebuilds the message. Edits made to the text are replaced,
// so ask first if the text was changed by hand.
async function setRemindOption(key, checked) {
  const ta = document.getElementById('remind-msg');
  if (ta.value !== remindDefault && !window.confirm('Replace your edits with the updated message?')) {
    document.querySelector(`#remind-options input[data-opt="${key}"]`).checked = !checked;
    return;
  }
  remindOpts[key] = checked;
  try { await regenerateRemind(); } catch (e) { showToast(e.message, 'error'); }
}

function resetRemindText() {
  document.getElementById('remind-msg').value = remindDefault;
}

function sendRemind() {
  const digits = remindMobile.replace(/\D/g, '');
  if (!digits) return;
  const text = document.getElementById('remind-msg').value;
  window.open(`https://wa.me/91${digits}?text=${encodeURIComponent(text)}`, '_blank');
}
