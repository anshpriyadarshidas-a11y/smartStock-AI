const BASE = process.env.API_BASE || 'http://localhost:4000';
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

async function call(path, opts = {}, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function check(name, cond, extra = '') {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' | ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

(async () => {
  console.log('=== SmartStock AI end-to-end workflow ===\n');

  // 1. Login
  const login = await call('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'admin@smartstock.dev', password: 'password123' }),
  });
  check('login admin', login.status === 200 && login.body.data.token, `role=${login.body.data?.user?.role}`);
  const adminToken = login.body.data.token;

  const mlogin = await call('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: 'manager@smartstock.dev', password: 'password123' }),
  });
  const managerToken = mlogin.body.data.token;
  check('login manager', mlogin.status === 200 && mlogin.body.data.user.role === 'manager');

  // 2. Add Product
  const name = `Steel Bottle E2E ${Date.now()}`;
  const prod = await call('/products', {
    method: 'POST',
    body: JSON.stringify({ name, category: 'Fitness', warehouse: 'Main Warehouse', currentStock: 18, minimumStock: 25, price: 19.99, supplierId: 1 }),
  }, adminToken);
  check('add product', prod.status === 201, `id=${prod.body.data?.id}`);
  const productId = prod.body.data.id;

  // 3. Record Sales (10 days of demand)
  let salesOk = true;
  const pattern = [5, 6, 7, 8, 9, 10, 9, 11, 12, 13];
  for (let i = 0; i < pattern.length; i += 1) {
    const s = await call('/sales', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity: pattern[i], date: day(i) }),
    }, adminToken);
    if (s.status !== 201) salesOk = false;
  }
  check('record 10 days of sales', salesOk, 'stock consumed by sales');

  // 4. Update Inventory (adjust stock)
  const put = await call(`/products/${productId}`, { method: 'PUT', body: JSON.stringify({ currentStock: 15 }) }, adminToken);
  check('update inventory (PUT /products/:id)', put.status === 200 && put.body.data.currentStock === 15);

  // 5. Run ML Prediction (Inventory Operations Agent)
  const predict = await call('/predict', { method: 'POST', body: JSON.stringify({ productId }) }, adminToken);
  const rec = predict.body.data?.predictions?.[0];
  check('run ML prediction', predict.status === 201 && rec, `model=${rec?.model}`);
  check('ML output: predicted demand + confidence', typeof rec?.forecastDemand === 'number' && typeof rec?.confidence === 'number', `demand=${rec?.forecastDemand} conf=${rec?.confidence}`);
  check('ML output: shortage probability + recommended stock', typeof rec?.shortageProbability === 'number' && typeof rec?.recommendedOrderQty === 'number', `shortage=${rec?.shortageProbability} order=${rec?.recommendedOrderQty}`);
  check('ML output: suggested order date', typeof rec?.suggestedOrderDate === 'string' && rec.suggestedOrderDate.length > 0, rec?.suggestedOrderDate);
  check('AI explanation present', typeof rec?.reason === 'string' && rec.reason.length > 40, rec?.reason?.slice(0, 80) + '…');
  check('recommendation waits for approval (pending)', rec?.status === 'pending');

  // 6. Forecast + Recommendations + Alerts
  const forecast = await call('/forecast', {}, adminToken);
  const myForecast = forecast.body.data.find((f) => f.productId === productId);
  check('GET /forecast returns product forecast', !!myForecast, `trend=${myForecast?.trendScore}`);

  const recs = await call('/recommendations?status=pending', {}, adminToken);
  const pendingRec = recs.body.data.find((r) => r.productId === productId);
  check('GET /recommendations lists pending', !!pendingRec);

  const alerts = await call('/alerts', {}, adminToken);
  check('GET /alerts returns alerts', Array.isArray(alerts.body.data));

  // 7. Manager Approval (human-in-the-loop)
  const before = (await call('/products', {}, adminToken)).body.data.find((p) => p.id === productId).currentStock;
  const approve = await call('/approve', {
    method: 'POST',
    body: JSON.stringify({ id: pendingRec.id, decision: 'approved', comment: 'E2E: approved for demand spike' }),
  }, managerToken);
  check('manager approves recommendation', approve.status === 200 && approve.body.data.prediction.status === 'approved', `order=${approve.body.data.prediction?.recommendedOrderQty}`);
  check('audit log entry created', approve.body.data.audit?.managerDecision === 'approved' && approve.body.data.audit?.approvedBy === 'Priya Manager');
  const after = (await call('/products', {}, adminToken)).body.data.find((p) => p.id === productId).currentStock;
  check('approved order executed -> stock raised', after > before, `stock ${before} -> ${after}`);

  // 8. Audit log
  const audit = await call('/audit', {}, managerToken);
  check('GET /audit contains the decision', audit.body.data.some((l) => l.productId === productId && l.managerDecision === 'approved'));

  // 9. Permissions
  const employee = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'employee@smartstock.dev', password: 'password123' }) });
  const et = employee.body.data.token;
  const empApprove = await call('/approve', { method: 'POST', body: JSON.stringify({ id: productId, decision: 'rejected' }) }, et);
  check('employee cannot approve (403)', empApprove.status === 403);
  const empCreate = await call('/products', { method: 'POST', body: JSON.stringify({ name: 'nope', category: 'x', currentStock: 1, minimumStock: 2, price: 1, supplierId: 1 }) }, et);
  check('employee cannot create product (403)', empCreate.status === 403);
  const noAuth = await call('/products');
  check('no token -> 401', noAuth.status === 401);

  // 10. Cleanup
  const del = await call(`/products/${productId}`, { method: 'DELETE' }, adminToken);
  check('cleanup: delete test product', del.status === 200);

  console.log('\n=== workflow complete ===');
})().catch((err) => { console.error('E2E crashed:', err); process.exit(1); });
