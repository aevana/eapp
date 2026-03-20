// ── Offline localStorage data layer ─────────────────────────────
// Mirrors all server.js API routes so the app works without a backend.

const DB = (() => {
  const KEYS = {
    customers: 'ebt_customers',
    bills:     'ebt_bills',
    charges:   'ebt_charges',
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

  function enrichBill(bill, customers) {
    const customer  = customers.find(c => c.id === bill.customerId);
    const startDate = new Date(bill.startDate);
    const stopDate  = bill.stopDate ? new Date(bill.stopDate) : new Date();
    const days      = Math.max(1, Math.ceil((stopDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
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

  function getCustomers() {
    return readCustomers();
  }

  function addCustomer({ name, mobile, address }) {
    if (!name || !mobile) throw new Error('Name and mobile are required');
    const customers = readCustomers();
    const customer = { id: uuid(), name, mobile, address: address || '', createdAt: new Date().toISOString() };
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
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════
  //  BILLS
  // ══════════════════════════════════════════════════════════════

  function getBills(status) {
    const customers = readCustomers();
    let bills = read(KEYS.bills).map(b => enrichBill(b, customers));
    if (status) bills = bills.filter(b => b.status === status);
    return bills;
  }

  function addBill({ customerId, startDate, quantity, perDayCharge }) {
    if (!customerId || !startDate) throw new Error('Customer and start date required');
    const bills = read(KEYS.bills);
    const bill = {
      id: uuid(),
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
    write(KEYS.bills, bills);
    return enrichBill(bill, readCustomers());
  }

  function updateBill(id, data) {
    const bills = read(KEYS.bills);
    const idx = bills.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('Bill not found');
    const updated = { ...bills[idx], ...data, id };
    if (updated.stopDate) updated.status = 'stopped';
    bills[idx] = updated;
    write(KEYS.bills, bills);
    return enrichBill(bills[idx], readCustomers());
  }

  function deleteBill(id) {
    let bills = read(KEYS.bills);
    if (!bills.find(b => b.id === id)) throw new Error('Bill not found');
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
    return customers.map(c => ({
      ...c,
      bills: bills.filter(b => b.customerId === c.id).map(b => enrichBill(b, customers)),
    }));
  }

  function getTrackerByMonth(month, year) {
    const m = parseInt(month), y = parseInt(year);
    if (!m || !y) throw new Error('month and year required');
    const customers = readCustomers();
    const bills = read(KEYS.bills)
      .filter(b => billOverlapsMonth(b, m, y))
      .map(b => enrichBill(b, customers));
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

  function getBalanceSheet(month, year) {
    const m = parseInt(month), y = parseInt(year);
    if (!m || !y) throw new Error('month and year required');
    const customers = readCustomers();
    const bills = read(KEYS.bills)
      .filter(b => billOverlapsMonth(b, m, y))
      .map(b => enrichBill(b, customers));
    const charges = read(KEYS.charges);
    const monthlyCharge = charges.find(c => c.month === m && c.year === y) || null;

    const totalCharged   = bills.reduce((s, b) => s + (b.total || 0), 0);
    const totalCollected = bills.reduce((s, b) => s + (b.collectedAmount || 0), 0);
    const totalPending   = bills.reduce((s, b) => s + (b.pendingAmount  || 0), 0);
    const totalActiveQty = bills.reduce((s, b) => s + (b.quantity || 0), 0);

    const AVG_UNITS_PER_QTY = 22.5;
    const unitsProjected  = Math.round(totalActiveQty * AVG_UNITS_PER_QTY);
    const unitsCharged    = monthlyCharge ? (monthlyCharge.unitsCharged || 0) : 0;
    const projectedAmount = monthlyCharge ? (monthlyCharge.projectedAmount || 0) : 0;
    const revenue         = totalCollected - projectedAmount;

    return {
      month: m, year: y,
      bills,
      monthlyCharge,
      summary: { totalBills: bills.length, totalCharged, totalCollected, totalPending, totalActiveQty },
      stats: {
        unitsProjected,
        unitsCharged,
        unitsDiff:        unitsCharged - unitsProjected,
        projectedAmount,
        revenue,
        collectionRate:   totalCharged > 0 ? Math.round((totalCollected / totalCharged) * 100) : 0,
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
        if (method === 'GET')    return getBills(params.status);
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
        return getBalanceSheet(params.month, params.year);
    }
    throw new Error(`Unknown route: ${method} ${url}`);
  }

  return { route };
})();
