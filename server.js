const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3500;

// ── Data file paths ────────────────────────────────────────────
const DATA_DIR        = path.join(__dirname, 'data');
const CUSTOMERS_FILE  = path.join(DATA_DIR, 'customers.json');
const BILLS_FILE      = path.join(DATA_DIR, 'bills.json');
const CHARGES_FILE    = path.join(DATA_DIR, 'monthly-charges.json');

// ── Ensure data files exist ────────────────────────────────────
[CUSTOMERS_FILE, BILLS_FILE, CHARGES_FILE].forEach(f => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]');
});

// ── JSON helpers ───────────────────────────────────────────────
const readJSON  = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

// Normalize legacy `mobileNumber` field to `mobile`
function normalizeCustomer(c) {
  if (!c.mobile && c.mobileNumber) {
    const { mobileNumber, ...rest } = c;
    return { ...rest, mobile: mobileNumber };
  }
  return c;
}
const readCustomers = () => readJSON(CUSTOMERS_FILE).map(normalizeCustomer);

// ── Middleware ─────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Bill enrichment ────────────────────────────────────────────
function enrichBill(bill, customers) {
  const customer = customers.find(c => c.id === bill.customerId);
  const startDate = new Date(bill.startDate);
  const stopDate  = bill.stopDate ? new Date(bill.stopDate) : new Date();
  const days      = Math.max(0, Math.ceil((stopDate - startDate) / (1000 * 60 * 60 * 24)));
  const total     = days * (bill.quantity || 1) * (bill.perDayCharge || 0);
  const pending   = Math.max(0, total - (bill.collectedAmount || 0));
  return {
    ...bill,
    customerName:   customer ? customer.name   : 'Unknown',
    customerMobile: customer ? customer.mobile : '',
    numberOfDays:   days,
    total,
    pendingAmount:  pending,
  };
}

// Variant of enrichBill that clips the bill's active days to within the given
// month only — used by Tracker by-month and Balance Sheet so that a bill
// spanning multiple months only shows the days/cost relevant to that month.
function enrichBillForMonth(bill, customers, month, year) {
  const customer = customers.find(c => c.id === bill.customerId);

  const toDate = d => { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
  const mStart     = new Date(year, month - 1, 1);           // first day of month
  const mEnd       = new Date(year, month, 0);               // last day of month
  const daysInMonth = mEnd.getDate();

  const billStartD = toDate(bill.startDate);
  const billStopD  = bill.stopDate ? toDate(bill.stopDate) : toDate(new Date());

  const clippedStart = billStartD > mStart ? billStartD : mStart;
  const clippedStop  = billStopD  < mEnd   ? billStopD  : mEnd;

  const days = clippedStop >= clippedStart
    ? Math.min(Math.round((clippedStop - clippedStart) / 86400000) + 1, daysInMonth)
    : 0;

  const total   = days * (bill.quantity || 1) * (bill.perDayCharge || 0);
  const arrears = bill.arrears || 0;
  const pending = Math.max(0, total + arrears - (bill.collectedAmount || 0));
  return {
    ...bill,
    customerName:   customer ? customer.name   : 'Unknown',
    customerMobile: customer ? customer.mobile : '',
    numberOfDays:   days,
    total,
    pendingAmount:  pending,
  };
}

// ── Bill overlaps a given month/year ──────────────────────────
function billOverlapsMonth(bill, month, year) {
  const start  = new Date(bill.startDate);
  const stop   = bill.stopDate ? new Date(bill.stopDate) : new Date();
  const mStart = new Date(year, month - 1, 1);
  const mEnd   = new Date(year, month, 0, 23, 59, 59);
  return start <= mEnd && stop >= mStart;
}

// ══════════════════════════════════════════════════════════════
//  CUSTOMERS
// ══════════════════════════════════════════════════════════════

app.get('/api/customers', (req, res) => {
  res.json(readCustomers());
});

app.post('/api/customers', (req, res) => {
  const { name, mobile, address } = req.body;
  if (!name || !mobile) return res.status(400).json({ error: 'Name and mobile are required' });
  const customers = readCustomers();
  const customer = { id: uuidv4(), name, mobile, address: address || '', createdAt: new Date().toISOString() };
  customers.push(customer);
  writeJSON(CUSTOMERS_FILE, customers);
  res.status(201).json(customer);
});

app.put('/api/customers/:id', (req, res) => {
  const customers = readCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found' });
  customers[idx] = { ...customers[idx], ...req.body, id: req.params.id };
  writeJSON(CUSTOMERS_FILE, customers);
  res.json(customers[idx]);
});

app.delete('/api/customers/:id', (req, res) => {
  let customers = readCustomers();
  if (!customers.find(c => c.id === req.params.id)) return res.status(404).json({ error: 'Customer not found' });
  customers = customers.filter(c => c.id !== req.params.id);
  writeJSON(CUSTOMERS_FILE, customers);
  // cascade delete bills
  let bills = readJSON(BILLS_FILE);
  bills = bills.filter(b => b.customerId !== req.params.id);
  writeJSON(BILLS_FILE, bills);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  BILLS
// ══════════════════════════════════════════════════════════════

app.get('/api/bills', (req, res) => {
  const customers = readCustomers();
  let bills = readJSON(BILLS_FILE).map(b => enrichBill(b, customers));
  if (req.query.status)     bills = bills.filter(b => b.status === req.query.status);
  if (req.query.customerId) bills = bills.filter(b => b.customerId === req.query.customerId);
  res.json(bills);
});

app.post('/api/bills', (req, res) => {
  const { customerId, startDate, quantity, perDayCharge } = req.body;
  if (!customerId || !startDate) return res.status(400).json({ error: 'Customer and start date required' });
  const bills = readJSON(BILLS_FILE);
  const bill = {
    id: uuidv4(),
    customerId,
    startDate,
    stopDate: null,
    quantity: quantity || 1,
    perDayCharge: perDayCharge || 200,
    collectedAmount: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  bills.push(bill);
  writeJSON(BILLS_FILE, bills);
  const customers = readCustomers();
  res.status(201).json(enrichBill(bill, customers));
});

app.put('/api/bills/:id', (req, res) => {
  const bills = readJSON(BILLS_FILE);
  const idx = bills.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Bill not found' });
  const updated = { ...bills[idx], ...req.body, id: req.params.id };
  if (updated.stopDate) updated.status = 'stopped';
  bills[idx] = updated;
  writeJSON(BILLS_FILE, bills);
  const customers = readCustomers();
  res.json(enrichBill(bills[idx], customers));
});

app.delete('/api/bills/:id', (req, res) => {
  let bills = readJSON(BILLS_FILE);
  if (!bills.find(b => b.id === req.params.id)) return res.status(404).json({ error: 'Bill not found' });
  bills = bills.filter(b => b.id !== req.params.id);
  writeJSON(BILLS_FILE, bills);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  TRACKER
// ══════════════════════════════════════════════════════════════

app.get('/api/tracker/customers', (req, res) => {
  const customers = readCustomers();
  const bills     = readJSON(BILLS_FILE);
  const result = customers.map(c => ({
    ...c,
    bills: bills
      .filter(b => b.customerId === c.id)
      .map(b => enrichBill(b, customers)),
  }));
  res.json(result);
});

app.get('/api/tracker/by-month', (req, res) => {
  const month = parseInt(req.query.month);
  const year  = parseInt(req.query.year);
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });

  const customers = readCustomers();
  const bills     = readJSON(BILLS_FILE)
    .filter(b => billOverlapsMonth(b, month, year))
    .map(b => enrichBillForMonth(b, customers, month, year));

  const totalBills     = bills.length;
  const totalCharged   = bills.reduce((s, b) => s + (b.total || 0), 0);
  const totalCollected = bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
  const totalPending   = bills.reduce((s, b) => s + (b.pendingAmount  || 0), 0);

  res.json({ bills, summary: { totalBills, totalCharged, totalCollected, totalPending } });
});

// ══════════════════════════════════════════════════════════════
//  MONTHLY CHARGES  (electricity board bill per month)
// ══════════════════════════════════════════════════════════════

app.get('/api/monthly-charges', (req, res) => {
  res.json(readJSON(CHARGES_FILE));
});

app.post('/api/monthly-charges', (req, res) => {
  const { month, year, projectedAmount, billPaidDate, unitsCharged, comments } = req.body;
  if (!month || !year) return res.status(400).json({ error: 'Month and year are required' });

  const charges = readJSON(CHARGES_FILE);
  // Enforce one record per month/year
  const existing = charges.findIndex(c => c.month === month && c.year === year);
  if (existing !== -1) {
    charges[existing] = { ...charges[existing], projectedAmount, billPaidDate, unitsCharged, comments, updatedAt: new Date().toISOString() };
    writeJSON(CHARGES_FILE, charges);
    return res.json(charges[existing]);
  }

  const charge = {
    id: uuidv4(),
    month: parseInt(month),
    year: parseInt(year),
    projectedAmount: parseFloat(projectedAmount) || 0,
    billPaidDate: billPaidDate || null,
    unitsCharged: parseFloat(unitsCharged) || 0,
    comments: comments || '',
    createdAt: new Date().toISOString(),
  };
  charges.push(charge);
  writeJSON(CHARGES_FILE, charges);
  res.status(201).json(charge);
});

app.put('/api/monthly-charges/:id', (req, res) => {
  const charges = readJSON(CHARGES_FILE);
  const idx = charges.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Charge record not found' });
  charges[idx] = { ...charges[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  writeJSON(CHARGES_FILE, charges);
  res.json(charges[idx]);
});

app.delete('/api/monthly-charges/:id', (req, res) => {
  let charges = readJSON(CHARGES_FILE);
  if (!charges.find(c => c.id === req.params.id)) return res.status(404).json({ error: 'Charge record not found' });
  charges = charges.filter(c => c.id !== req.params.id);
  writeJSON(CHARGES_FILE, charges);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════
//  BALANCE SHEET  GET /api/balance-sheet?month=&year=
// ══════════════════════════════════════════════════════════════

app.get('/api/balance-sheet', (req, res) => {
  const month = parseInt(req.query.month);
  const year  = parseInt(req.query.year);
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });

  const customers = readCustomers();
  const bills     = readJSON(BILLS_FILE)
    .filter(b => billOverlapsMonth(b, month, year))
    .map(b => enrichBillForMonth(b, customers, month, year));

  const charges   = readJSON(CHARGES_FILE);
  const monthlyCharge = charges.find(c => c.month === month && c.year === year) || null;

  // Bill-side aggregates (all based on the month-clipped values)
  const totalCharged   = bills.reduce((s, b) => s + (b.total || 0), 0);
  const totalCollected = bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
  const totalPending   = bills.reduce((s, b) => s + (b.pendingAmount  || 0), 0);
  const totalActiveQty = bills.reduce((s, b) => s + (b.quantity || 0), 0);
  const totalArrears   = bills.reduce((s, b) => s + (b.arrears || 0), 0);

  // Unit projection: each qty set consumes avg 22.5 units/month
  const AVG_UNITS_PER_QTY = 22.5;
  const unitsProjected = Math.round(totalActiveQty * AVG_UNITS_PER_QTY);
  const unitsCharged   = monthlyCharge ? (monthlyCharge.unitsCharged || 0) : 0;

  const projectedAmount = monthlyCharge ? (monthlyCharge.projectedAmount || 0) : 0;
  // Expected profit: what we should earn if everyone pays (total billed + arrears − board bill)
  const expectedProfit  = totalCharged + totalArrears - projectedAmount;
  // Actual profit: what we actually received minus what we paid the board
  const actualProfit    = totalCollected - projectedAmount;

  res.json({
    month, year,
    bills,
    monthlyCharge,
    summary: {
      totalBills:    bills.length,
      totalCharged,
      totalCollected,
      totalPending,
      totalActiveQty,
      totalArrears,
    },
    stats: {
      unitsProjected,
      unitsCharged,
      unitsDiff:      unitsCharged - unitsProjected,
      projectedAmount,
      expectedProfit,
      actualProfit,
      collectionRate: totalCharged > 0 ? Math.round((totalCollected / totalCharged) * 100) : 0,
    },
  });
});

// ── Fallback ───────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
