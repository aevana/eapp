#!/usr/bin/env node
/**
 * generate-migration.js
 *
 * Reads the server-side JSON data files and produces a self-contained
 * migrate.html file. Open migrate.html once in your browser (the same
 * browser / device you use the app on) to import all data into localStorage.
 *
 * Usage:
 *   node scripts/generate-migration.js
 *
 * Output:
 *   migrate.html   ← open this in your browser
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR      = path.join(__dirname, '..', 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const BILLS_FILE     = path.join(DATA_DIR, 'bills.json');
const CHARGES_FILE   = path.join(DATA_DIR, 'monthly-charges.json');
const OUT_FILE       = path.join(__dirname, '..', 'migrate.html');

// ── Read data files ─────────────────────────────────────────────
function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn(`⚠  Could not read ${filePath}: ${err.message}`);
    return [];
  }
}

// Normalize legacy mobileNumber → mobile
function normalizeCustomer(c) {
  if (!c.mobile && c.mobileNumber) {
    const { mobileNumber, ...rest } = c;
    return { ...rest, mobile: mobileNumber };
  }
  return c;
}

const customers = readJSON(CUSTOMERS_FILE).map(normalizeCustomer);
const bills     = readJSON(BILLS_FILE);
const charges   = readJSON(CHARGES_FILE);

console.log(`\nData found:`);
console.log(`  Customers       : ${customers.length}`);
console.log(`  Bills           : ${bills.length}`);
console.log(`  Monthly Charges : ${charges.length}`);

if (customers.length === 0 && bills.length === 0 && charges.length === 0) {
  console.log('\n⚠  All data files are empty. Nothing to migrate.\n');
  console.log('   Populate your data/ JSON files and re-run this script.\n');
  process.exit(0);
}

// ── Embed data as JSON strings safely for inline <script> ────────
const customersJSON = JSON.stringify(customers);
const billsJSON     = JSON.stringify(bills);
const chargesJSON   = JSON.stringify(charges);

// ── Generate migrate.html ────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>⚡ Data Migration — Electricity Bills Tracker</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #f1f5f9; color: #1e293b;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: #fff; border-radius: 16px; padding: 2rem;
      box-shadow: 0 10px 30px rgba(0,0,0,.1); max-width: 520px; width: 100%;
    }
    .logo  { font-size: 2.5rem; text-align: center; margin-bottom: .5rem; }
    h1     { font-size: 1.35rem; font-weight: 800; text-align: center; margin-bottom: .25rem; }
    .sub   { text-align: center; color: #64748b; font-size: .875rem; margin-bottom: 1.5rem; }
    .stats {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: .75rem; margin-bottom: 1.5rem;
    }
    .stat {
      background: #eff6ff; border-radius: 10px; padding: .85rem;
      text-align: center; border: 1px solid #bfdbfe;
    }
    .stat-num   { font-size: 1.8rem; font-weight: 800; color: #1e40af; }
    .stat-label { font-size: .75rem; color: #475569; font-weight: 600;
                  text-transform: uppercase; letter-spacing: .04em; margin-top: .15rem; }
    .warn {
      background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
      padding: .85rem 1rem; font-size: .85rem; color: #92400e;
      margin-bottom: 1.25rem; display: none;
    }
    .warn strong { display: block; margin-bottom: .2rem; }
    .btn {
      display: block; width: 100%; padding: .85rem;
      border-radius: 10px; border: none; font-size: 1rem; font-weight: 700;
      cursor: pointer; transition: all .18s; margin-bottom: .6rem;
    }
    .btn-primary  { background: #1e40af; color: #fff; }
    .btn-primary:hover  { background: #1e3a8a; }
    .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
    .btn-danger   { background: #fef2f2; color: #dc2626;
                    border: 1px solid #fecaca; font-size: .875rem; }
    .btn-danger:hover { background: #fee2e2; }
    .result {
      border-radius: 10px; padding: .85rem 1rem; font-size: .9rem;
      font-weight: 600; text-align: center; display: none; margin-top: .5rem;
    }
    .result.success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .result.error   { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .note { font-size: .78rem; color: #94a3b8; text-align: center; margin-top: 1rem; }
  </style>
</head>
<body>
<div class="card">
  <div class="logo">⚡</div>
  <h1>Data Migration</h1>
  <p class="sub">Import server data into browser localStorage for the offline app</p>

  <!-- Stats -->
  <div class="stats">
    <div class="stat">
      <div class="stat-num" id="cnt-customers">${customers.length}</div>
      <div class="stat-label">Customers</div>
    </div>
    <div class="stat">
      <div class="stat-num" id="cnt-bills">${bills.length}</div>
      <div class="stat-label">Bills</div>
    </div>
    <div class="stat">
      <div class="stat-num" id="cnt-charges">${charges.length}</div>
      <div class="stat-label">Monthly<br>Charges</div>
    </div>
  </div>

  <!-- Existing data warning (shown by JS if localStorage already has data) -->
  <div class="warn" id="warn-existing">
    <strong>⚠ Existing data detected!</strong>
    Your browser already has data in localStorage. Importing will
    <strong>overwrite</strong> it. Use "Merge (keep existing)" to safely add
    only new records instead.
  </div>

  <!-- Action buttons -->
  <button class="btn btn-primary" id="btn-overwrite" onclick="doImport('overwrite')">
    ⬇ Import &amp; Overwrite localStorage
  </button>
  <button class="btn btn-danger" id="btn-merge" onclick="doImport('merge')" style="display:none;">
    🔀 Merge — add only new records (skip duplicates)
  </button>

  <div class="result" id="result"></div>

  <p class="note">
    This page is safe to close after a successful import.<br>
    The app reads data from localStorage on every load.
  </p>
</div>

<script>
  // ── Embedded data (generated by generate-migration.js) ──────
  const IMPORTED_CUSTOMERS = ${customersJSON};
  const IMPORTED_BILLS     = ${billsJSON};
  const IMPORTED_CHARGES   = ${chargesJSON};

  const KEYS = {
    customers: 'ebt_customers',
    bills:     'ebt_bills',
    charges:   'ebt_charges',
  };

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }
  function write(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // Check for existing data on load
  window.addEventListener('DOMContentLoaded', () => {
    const existing =
      read(KEYS.customers).length +
      read(KEYS.bills).length +
      read(KEYS.charges).length;

    if (existing > 0) {
      document.getElementById('warn-existing').style.display = 'block';
      document.getElementById('btn-merge').style.display     = 'block';
      document.getElementById('btn-overwrite').textContent   =
        '⬇ Import & Overwrite (replaces existing data)';
    }
  });

  function doImport(mode) {
    const btnO = document.getElementById('btn-overwrite');
    const btnM = document.getElementById('btn-merge');
    const res  = document.getElementById('result');
    btnO.disabled = true;
    btnM.disabled = true;

    try {
      let customers, bills, charges;

      if (mode === 'overwrite') {
        customers = IMPORTED_CUSTOMERS;
        bills     = IMPORTED_BILLS;
        charges   = IMPORTED_CHARGES;
      } else {
        // Merge: keep existing, add records whose id doesn't already exist
        const existingC = read(KEYS.customers);
        const existingB = read(KEYS.bills);
        const existingCh = read(KEYS.charges);

        const existingCIds  = new Set(existingC.map(x => x.id));
        const existingBIds  = new Set(existingB.map(x => x.id));
        const existingChIds = new Set(existingCh.map(x => x.id));

        const newC  = IMPORTED_CUSTOMERS.filter(x => !existingCIds.has(x.id));
        const newB  = IMPORTED_BILLS.filter(x => !existingBIds.has(x.id));
        const newCh = IMPORTED_CHARGES.filter(x => !existingChIds.has(x.id));

        customers = [...existingC,  ...newC];
        bills     = [...existingB,  ...newB];
        charges   = [...existingCh, ...newCh];

        const added = newC.length + newB.length + newCh.length;
        if (added === 0) {
          showResult('success',
            '✅ Merge complete — no new records to add (all IDs already exist).');
          return;
        }
        showResult('success',
          \`✅ Merge complete! Added \${newC.length} customer(s), \${newB.length} bill(s), \${newCh.length} charge(s).\`);
      }

      write(KEYS.customers, customers);
      write(KEYS.bills,     bills);
      write(KEYS.charges,   charges);

      if (mode === 'overwrite') {
        showResult('success',
          \`✅ Import complete! \${customers.length} customer(s), \${bills.length} bill(s), \${charges.length} charge(s) saved to localStorage.\`);
      }
    } catch (err) {
      btnO.disabled = false;
      btnM.disabled = false;
      showResult('error', '❌ Import failed: ' + err.message);
    }
  }

  function showResult(type, msg) {
    const el = document.getElementById('result');
    el.textContent  = msg;
    el.className    = 'result ' + type;
    el.style.display = 'block';
  }
</script>
</body>
</html>
`;

fs.writeFileSync(OUT_FILE, html, 'utf8');

console.log(`\n✅ Migration page generated: migrate.html`);
console.log(`\nNext steps:`);
console.log(`  1. Open migrate.html in the browser where you use the app`);
console.log(`     (same browser + same origin as index.html)`);
console.log(`  2. Click "Import & Overwrite" (or "Merge" if you already`);
console.log(`     have some data in the app)`);
console.log(`  3. Open the app — your data will be loaded from localStorage\n`);
