// ── Offline localStorage data layer ─────────────────────────────
// Mirrors all server.js API routes so the app works without a backend.

const DB = (() => {
  const KEYS = {
    customers: 'ebt_customers',
    bills:     'ebt_bills',
    charges:   'ebt_charges',
    payments:  'ebt_payments',
  };

  // ── Storage helpers ────────────────────────────────────────────
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }
  function write(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ── Data helpers (ported from server.js) ──────────────────────
  function normalizeCustomer(c) {
    if (!c.mobile && c.mobileNumber) {
      const { mobileNumber, ...rest } = c;
      return { ...rest, mobile: mobileNumber };
    }
    return c;
  }

  function readCustomers() {
    return read(KEYS.customers).map(normalizeCustomer);
  }

  // ── Payments ledger helpers ────────────────────────────────────
  // A bill's paid amount is derived from payment allocations; it is never
  // stored on the bill itself.
  const round2   = n => Math.round((parseFloat(n) || 0) * 100) / 100;
  const dateOnly = d => String(d || '').slice(0, 10);

  function readPayments() { return read(KEYS.payments); }

  // Paid amount and last payment date per bill. excludeId ignores one payment,
  // which is used when validating an edit of that payment.
  function paymentIndex(excludeId) {
    const paid = {}, last = {};
    readPayments().forEach(p => {
      if (p.id === excludeId) return;
      (p.allocations || []).forEach(a => {
        paid[a.billId] = round2((paid[a.billId] || 0) + a.amount);
        if (!last[a.billId] || p.date > last[a.billId]) last[a.billId] = p.date;
      });
    });
    return { paid, last };
  }

  // Derived payment fields for one bill. `total` is the charge for the period
  // being shown (the whole bill, or only the days inside a selected month).
  function paymentFields(bill, idx, total) {
    const paid    = idx.paid[bill.id] || 0;
    const due     = round2(total + (bill.arrears || 0));
    const pending = Math.max(0, round2(due - paid));
    const paymentStatus = due <= 0 ? 'no-charge' : pending === 0 ? 'settled' : paid > 0 ? 'partial' : 'unpaid';
    return {
      collectedAmount: paid,
      collectedDate:   idx.last[bill.id] || null,
      pendingAmount:   pending,
      paymentStatus,
    };
  }

  function enrichBill(bill, customers, idx = paymentIndex()) {
    const customer  = customers.find(c => c.id === bill.customerId);
    const toMidnight = d => { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
    const startDate = toMidnight(bill.startDate);
    const stopDate  = bill.stopDate ? toMidnight(bill.stopDate) : toMidnight(new Date());
    const days      = Math.max(1, Math.round((stopDate - startDate) / 86400000) + 1);
    const total     = days * (bill.quantity || 1) * (bill.perDayCharge || 0);
    return {
      ...bill,
      customerName:   customer ? customer.name   : 'Unknown',
      customerMobile: customer ? customer.mobile : '',
      numberOfDays:   days,
      total,
      ...paymentFields(bill, idx, total),
    };
  }

  function billOverlapsMonth(bill, month, year) {
    const start  = new Date(bill.startDate);
    const stop   = bill.stopDate ? new Date(bill.stopDate) : new Date();
    const mStart = new Date(year, month - 1, 1);
    const mEnd   = new Date(year, month, 0, 23, 59, 59);
    return start <= mEnd && stop >= mStart;
  }

  // Clips bill active days to the selected month only.
  function enrichBillForMonth(bill, customers, month, year, idx = paymentIndex()) {
    const customer = customers.find(c => c.id === bill.customerId);
    const toDate = d => { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
    const mStart     = new Date(year, month - 1, 1);
    const mEnd       = new Date(year, month, 0);
    const daysInMonth = mEnd.getDate();
    const billStartD = toDate(bill.startDate);
    const billStopD  = bill.stopDate ? toDate(bill.stopDate) : toDate(new Date());
    const clippedStart = billStartD > mStart ? billStartD : mStart;
    const clippedStop  = billStopD  < mEnd   ? billStopD  : mEnd;
    const days = clippedStop >= clippedStart
      ? Math.min(Math.round((clippedStop - clippedStart) / 86400000) + 1, daysInMonth)
      : 0;
    const total = days * (bill.quantity || 1) * (bill.perDayCharge || 0);
    return {
      ...bill,
      customerName:   customer ? customer.name   : 'Unknown',
      customerMobile: customer ? customer.mobile : '',
      numberOfDays:   days,
      total,
      ...paymentFields(bill, idx, total),
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  CUSTOMERS
  // ══════════════════════════════════════════════════════════════

  function getCustomers() {
    return readCustomers();
  }

  function addCustomer({ name, mobile, address, line }) {
    if (!name || !mobile) throw new Error('Name and mobile are required');
    const customers = readCustomers();
    const customer = { id: uuid(), name, mobile, line: line || '', address: address || '', createdAt: new Date().toISOString() };
    customers.push(customer);
    write(KEYS.customers, customers);
    return customer;
  }

  function updateCustomer(id, data) {
    const customers = readCustomers();
    const idx = customers.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Customer not found');
    customers[idx] = { ...customers[idx], ...data, id };
    write(KEYS.customers, customers);
    return customers[idx];
  }

  function deleteCustomer(id) {
    let customers = readCustomers();
    if (!customers.find(c => c.id === id)) throw new Error('Customer not found');
    customers = customers.filter(c => c.id !== id);
    write(KEYS.customers, customers);
    // cascade delete bills
    let bills = read(KEYS.bills);
    bills = bills.filter(b => b.customerId !== id);
    write(KEYS.bills, bills);
    write(KEYS.payments, readPayments().filter(p => p.customerId !== id));
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════
  //  BILLS
  // ══════════════════════════════════════════════════════════════

  function getBills(status, customerId) {
    const customers = readCustomers();
    const idx = paymentIndex();
    let bills = read(KEYS.bills).map(b => enrichBill(b, customers, idx));
    if (status)     bills = bills.filter(b => b.status === status);
    if (customerId) bills = bills.filter(b => b.customerId === customerId);
    return bills;
  }

  function addBill({ customerId, startDate, quantity, perDayCharge, arrears, comments }) {
    if (!customerId || !startDate) throw new Error('Customer and start date required');
    const bills = read(KEYS.bills);
    const bill = {
      id: uuid(),
      customerId,
      startDate,
      stopDate: null,
      quantity: quantity || 1,
      perDayCharge: perDayCharge || 200,
      arrears: parseFloat(arrears) || 0,
      comments: comments || '',
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    bills.push(bill);
    write(KEYS.bills, bills);
    return enrichBill(bill, readCustomers());
  }

  function updateBill(id, data) {
    const bills = read(KEYS.bills);
    const idx = bills.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('Bill not found');
    // Paid amounts come from the payments ledger, never from the bill form.
    const { collectedAmount, collectedDate, ...editable } = data;
    const updated = { ...bills[idx], ...editable, id };
    delete updated.collectedAmount;
    delete updated.collectedDate;
    if (updated.stopDate) updated.status = 'stopped';
    bills[idx] = updated;
    write(KEYS.bills, bills);
    return enrichBill(bills[idx], readCustomers());
  }

  function deleteBill(id) {
    let bills = read(KEYS.bills);
    if (!bills.find(b => b.id === id)) throw new Error('Bill not found');
    // Refuse while money is allocated to it, so no received amount silently
    // becomes credit. The user reallocates or removes those payments first.
    if (readPayments().some(p => (p.allocations || []).some(a => a.billId === id))) {
      throw new Error('This bill has payments recorded. Reallocate or delete those payments first.');
    }
    bills = bills.filter(b => b.id !== id);
    write(KEYS.bills, bills);
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════
  //  TRACKER
  // ══════════════════════════════════════════════════════════════

  function getTrackerByCustomer() {
    const customers = readCustomers();
    const bills = read(KEYS.bills);
    const idx = paymentIndex();
    return customers.map(c => ({
      ...c,
      bills: bills.filter(b => b.customerId === c.id).map(b => enrichBill(b, customers, idx)),
    }));
  }

  function getTrackerByMonth(month, year) {
    const m = parseInt(month), y = parseInt(year);
    if (!m || !y) throw new Error('month and year required');
    const customers = readCustomers();
    const idx = paymentIndex();
    const bills = read(KEYS.bills)
      .filter(b => billOverlapsMonth(b, m, y))
      .map(b => enrichBillForMonth(b, customers, m, y, idx));
    const totalBills     = bills.length;
    const totalCharged   = bills.reduce((s, b) => s + (b.total || 0), 0);
    const totalCollected = bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
    const totalPending   = bills.reduce((s, b) => s + (b.pendingAmount  || 0), 0);
    return { bills, summary: { totalBills, totalCharged, totalCollected, totalPending } };
  }

  // ══════════════════════════════════════════════════════════════
  //  MONTHLY CHARGES
  // ══════════════════════════════════════════════════════════════

  function getMonthlyCharges() {
    return read(KEYS.charges);
  }

  function upsertMonthlyCharge({ month, year, projectedAmount, billPaidDate, unitsCharged, comments }) {
    if (!month || !year) throw new Error('Month and year are required');
    const charges = read(KEYS.charges);
    const existing = charges.findIndex(c => c.month === parseInt(month) && c.year === parseInt(year));
    if (existing !== -1) {
      charges[existing] = {
        ...charges[existing], projectedAmount, billPaidDate, unitsCharged, comments,
        updatedAt: new Date().toISOString(),
      };
      write(KEYS.charges, charges);
      return charges[existing];
    }
    const charge = {
      id: uuid(),
      month: parseInt(month),
      year: parseInt(year),
      projectedAmount: parseFloat(projectedAmount) || 0,
      billPaidDate: billPaidDate || null,
      unitsCharged: parseFloat(unitsCharged) || 0,
      comments: comments || '',
      createdAt: new Date().toISOString(),
    };
    charges.push(charge);
    write(KEYS.charges, charges);
    return charge;
  }

  function updateMonthlyCharge(id, data) {
    const charges = read(KEYS.charges);
    const idx = charges.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Charge record not found');
    charges[idx] = { ...charges[idx], ...data, id, updatedAt: new Date().toISOString() };
    write(KEYS.charges, charges);
    return charges[idx];
  }

  function deleteMonthlyCharge(id) {
    let charges = read(KEYS.charges);
    if (!charges.find(c => c.id === id)) throw new Error('Charge record not found');
    charges = charges.filter(c => c.id !== id);
    write(KEYS.charges, charges);
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════
  //  BALANCE SHEET
  // ══════════════════════════════════════════════════════════════

  function getBalanceSheet(month, year, unitsPerDay) {
    const m = parseInt(month), y = parseInt(year);
    if (!m || !y) throw new Error('month and year required');
    const customers = readCustomers();
    const idx = paymentIndex();
    const bills = read(KEYS.bills)
      .filter(b => billOverlapsMonth(b, m, y))
      .map(b => enrichBillForMonth(b, customers, m, y, idx));
    const charges = read(KEYS.charges);
    const monthlyCharge = charges.find(c => c.month === m && c.year === y) || null;

    const totalCharged   = bills.reduce((s, b) => s + (b.total || 0), 0);
    const totalCollected = bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
    const totalPending   = bills.reduce((s, b) => s + (b.pendingAmount  || 0), 0);
    const totalActiveQty = bills.reduce((s, b) => s + (b.quantity || 0), 0);
    const totalArrears   = bills.reduce((s, b) => s + (b.arrears || 0), 0);

    const UNITS_PER_DAY  = parseInt(unitsPerDay) === 25 ? 25 : 20;
    const totalBillDays  = bills.reduce((s, b) => s + ((b.numberOfDays || 0) * (b.quantity || 1)), 0);
    const unitsProjected = totalBillDays * UNITS_PER_DAY;
    const unitsCharged    = monthlyCharge ? (monthlyCharge.unitsCharged || 0) : 0;
    const projectedAmount = monthlyCharge ? (monthlyCharge.projectedAmount || 0) : 0;
    const expectedProfit  = totalCharged + totalArrears - projectedAmount;
    const actualProfit    = totalCollected - projectedAmount;

    return {
      month: m, year: y,
      bills,
      monthlyCharge,
      summary: { totalBills: bills.length, totalCharged, totalCollected, totalPending, totalActiveQty, totalArrears },
      stats: {
        unitsProjected,
        unitsCharged,
        unitsDiff:      unitsCharged - unitsProjected,
        projectedAmount,
        expectedProfit,
        actualProfit,
        collectionRate: totalCharged > 0 ? Math.round((totalCollected / totalCharged) * 100) : 0,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  URL ROUTER  — drop-in replacement for server apiFetch calls
  // ══════════════════════════════════════════════════════════════

  function route(method, url, body) {
    const [path, query] = url.split('?');
    const params   = Object.fromEntries(new URLSearchParams(query || ''));
    const segments = path.replace(/^\/api\//, '').split('/');
    const resource = segments[0];
    const id       = segments[1];

    switch (resource) {
      case 'customers':
        if (method === 'GET')    return getCustomers();
        if (method === 'POST')   return addCustomer(body);
        if (method === 'PUT')    return updateCustomer(id, body);
        if (method === 'DELETE') return deleteCustomer(id);
        break;

      case 'bills':
        if (method === 'GET')    return getBills(params.status, params.customerId);
        if (method === 'POST')   return addBill(body);
        if (method === 'PUT')    return updateBill(id, body);
        if (method === 'DELETE') return deleteBill(id);
        break;

      case 'tracker':
        if (id === 'customers') return getTrackerByCustomer();
        if (id === 'by-month')  return getTrackerByMonth(params.month, params.year);
        break;

      case 'monthly-charges':
        if (method === 'GET')    return getMonthlyCharges();
        if (method === 'POST')   return upsertMonthlyCharge(body);
        if (method === 'PUT')    return updateMonthlyCharge(id, body);
        if (method === 'DELETE') return deleteMonthlyCharge(id);
        break;

      case 'balance-sheet':
        return getBalanceSheet(params.month, params.year, params.unitsPerDay);

      case 'payments':
        if (id === 'auto-allocate') return autoAllocate(params.customerId, params.amount, params.excludeId);
        if (method === 'GET')    return getPayments(params.customerId);
        if (method === 'POST')   return addPayment(body);
        if (method === 'PUT')    return updatePayment(id, body);
        if (method === 'DELETE') return deletePayment(id);
        break;

      case 'receivables':
        return getReceivables(params.month, params.year);
    }
    throw new Error(`Unknown route: ${method} ${url}`);
  }

  // ══════════════════════════════════════════════════════════════
  //  PAYMENTS
  //  Each payment: { id, customerId, date, amount, mode, note,
  //                  allocations: [{ billId, amount }] }
  //  Allocations are optional; any part of `amount` not allocated is
  //  customer credit.
  // ══════════════════════════════════════════════════════════════

  function enrichPayment(p, customers, bills) {
    const customer  = customers.find(c => c.id === p.customerId);
    const allocated = round2((p.allocations || []).reduce((s, a) => s + a.amount, 0));
    return {
      ...p,
      customerName:   customer ? customer.name   : 'Unknown',
      customerMobile: customer ? customer.mobile : '',
      allocated,
      credit: round2(p.amount - allocated),
      allocations: (p.allocations || []).map(a => {
        const b = bills.find(x => x.id === a.billId);
        return { ...a, billStartDate: b ? b.startDate : null, billStopDate: b ? (b.stopDate || null) : null };
      }),
    };
  }

  function getPayments(customerId) {
    const customers = readCustomers();
    const bills = read(KEYS.bills);
    let list = readPayments();
    if (customerId) list = list.filter(p => p.customerId === customerId);
    return list
      .map(p => enrichPayment(p, customers, bills))
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  // Checks a payment before it is saved. excludeId is the payment being edited.
  function validatePayment(data, excludeId) {
    const customers = readCustomers();
    const customer  = customers.find(c => c.id === data.customerId);
    if (!customer) throw new Error('Customer not found');
    const amount = round2(data.amount);
    if (!(amount > 0)) throw new Error('Amount must be greater than 0');
    const date = dateOnly(data.date);
    if (!date) throw new Error('Payment date is required');

    const allocations = (data.allocations || [])
      .map(a => ({ billId: a.billId, amount: round2(a.amount) }))
      .filter(a => a.amount > 0);
    const allocSum = round2(allocations.reduce((s, a) => s + a.amount, 0));
    if (allocSum > amount) throw new Error('Allocations add up to more than the payment amount');

    const idx   = paymentIndex(excludeId);
    const bills = read(KEYS.bills);
    const seen  = new Set();
    allocations.forEach(a => {
      if (seen.has(a.billId)) throw new Error('The same bill is allocated twice');
      seen.add(a.billId);
      const bill = bills.find(b => b.id === a.billId);
      if (!bill || bill.customerId !== customer.id) throw new Error('Allocation refers to a bill that is not this customer’s');
      const pending = enrichBill(bill, customers, idx).pendingAmount;
      if (a.amount > pending) throw new Error(`Allocation is more than the pending amount (₹${pending.toLocaleString()})`);
    });

    return {
      customerId:  customer.id,
      date,
      amount,
      mode:        data.mode || 'Cash',
      note:        (data.note || '').trim(),
      allocations,
    };
  }

  function addPayment(body) {
    const data = validatePayment(body);
    const payment = { id: uuid(), ...data, createdAt: new Date().toISOString() };
    const payments = readPayments();
    payments.push(payment);
    write(KEYS.payments, payments);
    return enrichPayment(payment, readCustomers(), read(KEYS.bills));
  }

  function updatePayment(id, body) {
    const payments = readPayments();
    const idx = payments.findIndex(p => p.id === id);
    if (idx === -1) throw new Error('Payment not found');
    const data = validatePayment({ ...payments[idx], ...body }, id);
    payments[idx] = { ...payments[idx], ...data, id, updatedAt: new Date().toISOString() };
    write(KEYS.payments, payments);
    return enrichPayment(payments[idx], readCustomers(), read(KEYS.bills));
  }

  function deletePayment(id) {
    const payments = readPayments();
    if (!payments.find(p => p.id === id)) throw new Error('Payment not found');
    write(KEYS.payments, payments.filter(p => p.id !== id));
    return { success: true };
  }

  // Suggests how to split an amount across a customer's unpaid bills,
  // oldest bill first. Any leftover is returned as credit.
  function autoAllocate(customerId, amount, excludeId) {
    const customers = readCustomers();
    const idx = paymentIndex(excludeId);
    let remaining = round2(amount);
    const bills = read(KEYS.bills)
      .filter(b => b.customerId === customerId)
      .sort((a, b) => dateOnly(a.startDate).localeCompare(dateOnly(b.startDate)) ||
                      String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const allocations = [];
    bills.forEach(b => {
      if (remaining <= 0) return;
      const pending = enrichBill(b, customers, idx).pendingAmount;
      const take = round2(Math.min(pending, remaining));
      if (take > 0) {
        allocations.push({ billId: b.id, amount: take });
        remaining = round2(remaining - take);
      }
    });
    return { allocations, credit: Math.max(0, remaining) };
  }

  // Monthly receivables: billed vs collected in the month, what is still
  // outstanding, how old it is, and who owes the most.
  function getReceivables(month, year) {
    const m = parseInt(month), y = parseInt(year);
    if (!m || !y) throw new Error('month and year required');
    const customers = readCustomers();
    const idx = paymentIndex();
    const billRows = read(KEYS.bills);
    const payments = readPayments();

    const monthBills = billRows
      .filter(b => billOverlapsMonth(b, m, y))
      .map(b => enrichBillForMonth(b, customers, m, y, idx));
    const billedInMonth = round2(monthBills.reduce((s, b) => s + b.total, 0));

    const prefix = `${y}-${String(m).padStart(2, '0')}`;
    const monthPayments = payments.filter(p => dateOnly(p.date).startsWith(prefix));
    const collectedInMonth  = round2(monthPayments.reduce((s, p) => s + p.amount, 0));
    const allocatedInMonth  = round2(monthPayments.reduce((s, p) =>
      s + (p.allocations || []).reduce((t, a) => t + a.amount, 0), 0));

    const allBills = billRows.map(b => enrichBill(b, customers, idx));
    const open = allBills.filter(b => b.pendingAmount > 0);
    const outstandingNow = round2(open.reduce((s, b) => s + b.pendingAmount, 0));

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const bands = [
      { label: '0–30 days',  min: 0,  max: 30 },
      { label: '31–60 days', min: 31, max: 60 },
      { label: '61–90 days', min: 61, max: 90 },
      { label: 'Over 90 days', min: 91, max: Infinity },
    ];
    const aging = bands.map(band => {
      const items = open.filter(b => {
        const start = new Date(b.startDate); start.setHours(0, 0, 0, 0);
        const age = Math.floor((today - start) / 86400000);
        return age >= band.min && age <= band.max;
      });
      return { label: band.label, bills: items.length, amount: round2(items.reduce((s, b) => s + b.pendingAmount, 0)) };
    });

    const byCustomer = customers
      .map(c => {
        const mine = open.filter(b => b.customerId === c.id);
        return {
          customerId:   c.id,
          customerName: c.name,
          mobile:       c.mobile,
          openBills:    mine.length,
          pending:      round2(mine.reduce((s, b) => s + b.pendingAmount, 0)),
        };
      })
      .filter(r => r.pending > 0)
      .sort((a, b) => b.pending - a.pending);

    const totalCredit = round2(payments.reduce((s, p) =>
      s + p.amount - (p.allocations || []).reduce((t, a) => t + a.amount, 0), 0));

    return {
      month: m, year: y,
      summary: {
        billedInMonth,
        collectedInMonth,
        allocatedInMonth,
        unallocatedInMonth: round2(collectedInMonth - allocatedInMonth),
        outstandingNow,
        customerCredit:     totalCredit,
      },
      aging,
      customers: byCustomer,
    };
  }

  // One-time (and repeatable) conversion of the old per-bill `collectedAmount`
  // and `collectedDate` fields into a payment on that bill. Runs at load; once
  // the fields are removed it does nothing.
  function migrateLegacyCollections() {
    const bills = read(KEYS.bills);
    let payments = null, billsChanged = false;
    bills.forEach(b => {
      if (!('collectedAmount' in b) && !('collectedDate' in b)) return;
      const amt = round2(b.collectedAmount);
      if (amt > 0) {
        payments = payments || readPayments();
        payments.push({
          id:          uuid(),
          customerId:  b.customerId,
          date:        dateOnly(b.collectedDate || b.startDate),
          amount:      amt,
          mode:        'Migrated',
          note:        'Migrated from bill collected amount',
          allocations: [{ billId: b.id, amount: amt }],
          createdAt:   new Date().toISOString(),
        });
      }
      delete b.collectedAmount;
      delete b.collectedDate;
      billsChanged = true;
    });
    if (payments) write(KEYS.payments, payments);
    if (billsChanged) write(KEYS.bills, bills);
  }

  try { migrateLegacyCollections(); } catch (e) { console.error('Payment migration failed', e); }

  return { route, migrate: migrateLegacyCollections };
})();
