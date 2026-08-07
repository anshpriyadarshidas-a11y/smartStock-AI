const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

process.env.MONGO_URI = '';
process.env.AI_SERVICE_URL = '';
process.env.JWT_SECRET = 'test-secret';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ssai-test-'));
process.env.PORT = '0';

const { createApp } = require('../src/server');
const { getStore } = require('../src/db/db');
const { seedData } = require('../src/db/seed');

let app;
let tokens = {};

async function login(email, password = 'password123') {
  const res = await request(app).post('/auth/login').send({ email, password });
  assert.equal(res.status, 200, `login failed for ${email}: ${res.body.error || ''}`);
  return res.body.data.token;
}

before(async () => {
  app = await createApp();
  await seedData({ store: getStore(), force: true });
  tokens.admin = await login('admin@smartstock.dev');
  tokens.manager = await login('manager@smartstock.dev');
  tokens.employee = await login('employee@smartstock.dev');
});

after(() => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('health endpoint reports ok', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.db, 'file');
});

test('protected routes require a token', async () => {
  const res = await request(app).get('/products');
  assert.equal(res.status, 401);
});

test('login returns user + jwt', async () => {
  const res = await request(app).post('/auth/login').send({
    email: 'admin@smartstock.dev',
    password: 'password123',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.role, 'admin');
  assert.ok(res.body.data.token);
});

test('wrong password is rejected', async () => {
  const res = await request(app).post('/auth/login').send({
    email: 'admin@smartstock.dev',
    password: 'nope',
  });
  assert.equal(res.status, 401);
});

test('GET /products lists seeded products', async () => {
  const res = await request(app).get('/products').set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length >= 8);
});

test('POST /products creates a product (admin)', async () => {
  const res = await request(app)
    .post('/products')
    .set('Authorization', `Bearer ${tokens.admin}`)
    .send({ name: 'Steel Water Bottle', category: 'Fitness', currentStock: 12, minimumStock: 20, price: 18.5, supplierId: 1, warehouse: 'Main Warehouse' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'Steel Water Bottle');
  assert.ok(res.body.data.id);
});

test('employee cannot create products (403)', async () => {
  const res = await request(app)
    .post('/products')
    .set('Authorization', `Bearer ${tokens.employee}`)
    .send({ name: 'Nope', category: 'General', currentStock: 1, minimumStock: 2, price: 1, supplierId: 1 });
  assert.equal(res.status, 403);
});

test('PUT /products/:id updates inventory (admin)', async () => {
  const list = await request(app).get('/products').set('Authorization', `Bearer ${tokens.admin}`);
  const target = list.body.data.find((p) => p.name === 'Steel Water Bottle');
  const res = await request(app)
    .put(`/products/${target.id}`)
    .set('Authorization', `Bearer ${tokens.admin}`)
    .send({ currentStock: 40 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.currentStock, 40);
});

test('invalid product is rejected', async () => {
  const res = await request(app)
    .post('/products')
    .set('Authorization', `Bearer ${tokens.admin}`)
    .send({ name: '', category: 'General', currentStock: -5, minimumStock: 2, price: 1, supplierId: 1 });
  assert.equal(res.status, 400);
});

test('POST /sales records a sale and consumes inventory', async () => {
  const list = await request(app).get('/products').set('Authorization', `Bearer ${tokens.admin}`);
  const p = list.body.data.find((x) => x.name === 'Ceramic Coffee Mug');
  const before = p.currentStock;

  const res = await request(app)
    .post('/sales')
    .set('Authorization', `Bearer ${tokens.employee}`)
    .send({ productId: p.id, quantity: 3 });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.sale.quantity, 3);
  assert.equal(res.body.data.product.currentStock, before - 3);

  const history = await request(app).get('/sales/history').set('Authorization', `Bearer ${tokens.employee}`);
  assert.ok(history.body.data.length > 0);
});

test('GET /sales/history filters by product', async () => {
  const list = await request(app).get('/products').set('Authorization', `Bearer ${tokens.admin}`);
  const p = list.body.data.find((x) => x.name === 'Ceramic Coffee Mug');
  const res = await request(app)
    .get(`/sales/history?productId=${p.id}`)
    .set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.every((s) => s.productId === p.id));
});

test('POST /predict runs the agent and creates recommendations', async () => {
  const res = await request(app)
    .post('/predict')
    .set('Authorization', `Bearer ${tokens.admin}`)
    .send({});
  assert.equal(res.status, 201);
  assert.ok(res.body.data.count > 0);
  assert.ok(res.body.data.predictions.every((p) => p.status === 'pending'));
  assert.ok(res.body.data.predictions.every((p) => typeof p.confidence === 'number'));
});

test('GET /forecast returns latest prediction per product', async () => {
  const res = await request(app).get('/forecast').set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(res.status, 200);
  const ids = res.body.data.map((p) => p.productId);
  assert.equal(new Set(ids).size, ids.length, 'one forecast per product');
});

test('GET /recommendations returns pending list', async () => {
  const res = await request(app)
    .get('/recommendations?status=pending')
    .set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);
});

test('GET /alerts lists shortage alerts', async () => {
  const res = await request(app).get('/alerts').set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.some((a) => a.severity === 'high'));
});

test('employee cannot approve (403)', async () => {
  const recs = await request(app)
    .get('/recommendations?status=pending')
    .set('Authorization', `Bearer ${tokens.employee}`);
  const rec = recs.body.data[0];
  const res = await request(app)
    .post('/approve')
    .set('Authorization', `Bearer ${tokens.employee}`)
    .send({ id: rec.productId, decision: 'approved' });
  assert.equal(res.status, 403);
});

test('manager approval executes order, logs audit, updates stock', async () => {
  const recs = await request(app)
    .get('/recommendations?status=pending')
    .set('Authorization', `Bearer ${tokens.manager}`);
  const rec = recs.body.data.find((r) => r.shortageRisk && r.recommendedOrderQty > 0);
  assert.ok(rec, 'expected a pending shortage recommendation');

  const productBefore = await request(app)
    .get('/products')
    .set('Authorization', `Bearer ${tokens.manager}`);
  const pb = productBefore.body.data.find((p) => p.id === rec.productId).currentStock;

  const res = await request(app)
    .post('/approve')
    .set('Authorization', `Bearer ${tokens.manager}`)
    .send({ id: rec.productId, decision: 'approved', comment: 'Approve for rainy season' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.prediction.status, 'approved');
  assert.equal(res.body.data.audit.managerDecision, 'approved');
  assert.equal(res.body.data.audit.approvedBy, 'Priya Manager');
  assert.ok(res.body.data.product.currentStock === pb + rec.recommendedOrderQty);

  const audit = await request(app).get('/audit').set('Authorization', `Bearer ${tokens.manager}`);
  assert.ok(audit.body.data.some((l) => l.productId === rec.productId && l.managerDecision === 'approved'));
});

test('re-approving an already-decided recommendation is rejected (409)', async () => {
  const recs = await request(app)
    .get('/recommendations?status=approved')
    .set('Authorization', `Bearer ${tokens.manager}`);
  const rec = recs.body.data[0];
  const res = await request(app)
    .post('/approve')
    .set('Authorization', `Bearer ${tokens.manager}`)
    .send({ id: rec.productId, decision: 'approved' });
  assert.equal(res.status, 409);
});

test('DELETE /products/:id removes a product (admin)', async () => {
  const list = await request(app).get('/products').set('Authorization', `Bearer ${tokens.admin}`);
  const target = list.body.data.find((p) => p.name === 'Steel Water Bottle');
  const res = await request(app)
    .delete(`/products/${target.id}`)
    .set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.deleted, true);
});
