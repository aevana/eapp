const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3500;

const CUSTOMERS_FILE = path.join(__dirname, 'data', 'customers.json');
const BILLS_FILE = path.join(__dirname, 'data', 'bills.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── helpers ──────────────────────────────────────────────────────────────────

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function daysBetween(start, end) {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  const diff = Math.floor((e - s) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function enrichBill(bill) {
  const days = daysBetween(bill.startDate, bill.stopDate || null);
  const total = days * bill.perDayCharge * bill.quantity;
  const pending = total - (bill.collectedAmount || 0);
  return { ...bill, numberOfDays: days, total, pendingAmount: pending < 0 ? 0 : pending };
}

// ── Customer Routes ───────────────────────────────────────────────────────────

// GET all customers
app.get('/api/customers', (req, res) => {
  res.json(readJSON(CUSTOMERS_FILE));
});

// GET single customer
app.get('/api/customers/:id', (req, res) => {
  const customers = readJSON(CUSTOMERS_FILE);
  const c = customers.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  res.json(c);
});

// POST create customer
app.post('/api/customers', (req, res) => {
  const { name, mobileNumber, address } = req.body;
  if (!name || !mobileNumber) {
    return res.status(400).json({ error: 'Name and mobile number are required' });
  }
  const customers = readJSON(CUSTOMERS_FILE);
  const customer = { id: uuidv4(), name, mobileNumber, address: address || '', createdAt: new Date().toISOString() };
  customers.push(customer);
  writeJSON(CUSTOMERS_FILE, customers);
  res.status(201).json(customer);
});

// PUT update customer
app.put('/api/customers/:id', (req, res) => {
  const customers = readJSON(CUSTOMERS_FILE);
  const idx = customers.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found' });
  const { name, mobileNumber, address } = req.body;
  if (!name || !mobileNumber) {
    return res.status(400).json({ error: 'Name and mobile number are required' });
  }
  customers[idx] = { ...customers[idx], name, mobileNumber, address: address || '' };
  writeJSON(CUSTOMERS_FILE, customers);
  res.json(customers[idx]);
});

// DELETE customer
app.delete('/api/customers/:id', (req, res) => {
  const customers = readJSON(CUSTOMERS_FILE);
  const idx = customers.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found' });
  customers.splice(idx, 1);
  writeJSON(CUSTOMERS_FILE, customers);
  // Also remove associated bills
  const bills = readJSON(BILLS_FILE).filter(b => b.customerId !== req.params.id);
  writeJSON(BILLS_FILE, bills);
  res.json({ success: true });
});

// ── Bill Routes ───────────────────────────────────────────────────────────────

// GET all bills (enriched)
app.get('/api/bills', (req, res) => {
  const bills = readJSON(BILLS_FILE).map(enrichBill);
  res.json(bills);
});

// GET bills for a specific customer
app.get('/api/bills/customer/:customerId', (req, res) => {
  const bills = readJSON(BILLS_FILE)
    .filter(b => b.customerId === req.params.customerId)
    .map(enrichBill);
  res.json(bills);
});

// GET single bill
app.get('/api/bills/:id', (req, res) => {
  const bills = readJSON(BILLS_FILE);
  const b = bills.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Bill not found' });
  res.json(enrichBill(b));
});

// POST create bill
app.post('/api/bills', (req, res) => {
  const { customerId, startDate, quantity, perDayCharge } = req.body;
  if (!customerId || !startDate || !quantity) {
    return res.status(400).json({ error: 'customerId, startDate and quantity are required' });
  }
  const customers = readJSON(CUSTOMERS_FILE);
  if (!customers.find(c => c.id === customerId)) {
    return res.status(404).json({ error: 'Customer not found' });
  }
  const bills = readJSON(BILLS_FILE);
  const bill = {
    id: uuidv4(),
    customerId,
    startDate,
    stopDate: null,
    quantity: Number(quantity),
    perDayCharge: Number(perDayCharge) || 200,
    collectedAmount: 0,
    status: 'active',
    createdAt: new Date().toISOString()
  };
  bills.push(bill);
  writeJSON(BILLS_FILE, bills);
  res.status(201).json(enrichBill(bill));
});

// PUT update bill
app.put('/api/bills/:id', (req, res) => {
  const bills = readJSON(BILLS_FILE);
  const idx = bills.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Bill not found' });

  const { stopDate, collectedAmount, quantity, perDayCharge, startDate } = req.body;
  if (stopDate !== undefined) bills[idx].stopDate = stopDate || null;
  if (collectedAmount !== undefined) bills[idx].collectedAmount = Number(collectedAmount);
  if (quantity !== undefined) bills[idx].quantity = Number(quantity);
  if (perDayCharge !== undefined) bills[idx].perDayCharge = Number(perDayCharge);
  if (startDate !== undefined) bills[idx].startDate = startDate;
  if (bills[idx].stopDate) bills[idx].status = 'stopped';
  else bills[idx].status = 'active';

  writeJSON(BILLS_FILE, bills);
  res.json(enrichBill(bills[idx]));
});

// DELETE bill
app.delete('/api/bills/:id', (req, res) => {
  const bills = readJSON(BILLS_FILE);
  const idx = bills.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Bill not found' });
  bills.splice(idx, 1);
  writeJSON(BILLS_FILE, bills);
  res.json({ success: true });
});

// ── Tracker Routes ────────────────────────────────────────────────────────────

// GET tracker: all customers with their bills
app.get('/api/tracker/customers', (req, res) => {
  const customers = readJSON(CUSTOMERS_FILE);
  const allBills = readJSON(BILLS_FILE).map(enrichBill);
  const result = customers.map(c => ({
    ...c,
    bills: allBills.filter(b => b.customerId === c.id)
  }));
  res.json(result);
});

// GET tracker: bills filtered by month/year
app.get('/api/tracker/bills', (req, res) => {
  const { month, year } = req.query;
  const customers = readJSON(CUSTOMERS_FILE);
  let bills = readJSON(BILLS_FILE).map(enrichBill);

  if (month && year) {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    bills = bills.filter(b => {
      const start = new Date(b.startDate);
      const stop = b.stopDate ? new Date(b.stopDate) : new Date();
      // Include bill if it overlaps with the selected month
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0);
      return start <= monthEnd && stop >= monthStart;
    });
  }

  const result = bills.map(b => ({
    ...b,
    customerName: (customers.find(c => c.id === b.customerId) || {}).name || 'Unknown',
    customerMobile: (customers.find(c => c.id === b.customerId) || {}).mobileNumber || ''
  }));

  const summary = {
    totalBills: result.length,
    totalAmount: result.reduce((s, b) => s + b.total, 0),
    totalCollected: result.reduce((s, b) => s + (b.collectedAmount || 0), 0),
    totalPending: result.reduce((s, b) => s + b.pendingAmount, 0),
    bills: result
  };

  res.json(summary);
});

// ── Serve frontend ────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n⚡ Electricity Bills Tracker running at http://localhost:${PORT}\n`);
});
