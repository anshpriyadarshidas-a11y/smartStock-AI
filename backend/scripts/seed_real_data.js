const path = require('path');
const config = require('../src/config');
config.mongoUri = ''; // ensure file store mode
const db = require('../src/db/db');
const { runAnalysis } = require('../src/services/agent/inventoryAgent');

async function seed() {
  console.log('=== Starting Real ML Data Seeding ===');

  const store = db.getStore();

  // 1. Add recent sales data up to 2026-08-08 for all products
  console.log('1. Updating sales history up to 2026-08-08...');
  const products = store.col('products');
  let maxSaleId = store.col('sales').reduce((max, s) => Math.max(max, s.id || 0), 0);

  const datesToAppend = ['2026-08-07', '2026-08-08'];
  const dailySalesPattern = {
    1: 12, // Umbrella
    2: 10, // Earbuds
    3: 7,  // Coffee Mug
    4: 8,  // T-Shirt
    5: 5,  // Rain Jacket
    6: 5,  // Smart Bulb
    7: 4,  // Kettlebell
    8: 6,  // Board Game
  };

  for (const d of datesToAppend) {
    for (const p of products) {
      const existing = store.find('sales', (s) => s.productId === p.id && s.date === d);
      if (existing.length === 0) {
        maxSaleId += 1;
        const qty = dailySalesPattern[p.id] || 5;
        await store.insert('sales', {
          id: maxSaleId,
          productId: p.id,
          quantity: qty,
          date: d,
          revenue: Number((qty * p.price).toFixed(2)),
        });
      }
    }
  }

  // 2. Clear existing old predictions & audit logs to start clean
  console.log('2. Preparing predictions and audit logs...');
  store.data.predictions = [];
  store.data.auditLogs = [];
  store.data.alerts = [];
  store._persist();

  // 3. Run ML Analysis via inventoryAgent
  console.log('3. Running ML Inventory Operations Agent analysis on all products...');
  const predictions = await runAnalysis({ productId: null });
  console.log(`Generated ${predictions.length} real ML predictions.`);

  // 4. Simulate Manager Approvals and Rejections for realistic audit history
  console.log('4. Simulating Manager (Priya Manager) approvals & audit log entries...');

  const manager = { name: 'Priya Manager', role: 'manager' };

  // Item 2: Wireless Earbuds Pro -> Approve reorder
  const earbudsPred = store.find('predictions', (p) => p.productId === 2 && p.status === 'pending')[0];
  if (earbudsPred) {
    await store.update('predictions', earbudsPred.id, {
      status: 'approved',
      decisionComment: 'High demand spike detected ahead of festive season. Reorder approved.',
      approvedBy: manager.name,
      approvedAt: '2026-08-08T10:15:00.000Z',
    });
    const p = store.findById('products', 2);
    if (p) {
      await store.update('products', 2, { currentStock: p.currentStock + earbudsPred.recommendedOrderQty });
    }
    await store.insert('auditLogs', {
      productId: 2,
      productName: earbudsPred.productName,
      prediction: `Demand ${earbudsPred.forecastDemand} units over ${earbudsPred.horizonDays || 14} days`,
      aiReason: earbudsPred.reason,
      managerDecision: 'approved',
      approvedBy: manager.name,
      comment: 'High demand spike detected ahead of festive season. Reorder approved.',
      confidence: earbudsPred.confidence,
      timestamp: '2026-08-08T10:15:00.000Z',
      recommendedOrderQty: earbudsPred.recommendedOrderQty,
    });
  }

  // Item 7: Kettlebell 8kg -> Reject reorder
  const kettlebellPred = store.find('predictions', (p) => p.productId === 7 && p.status === 'pending')[0];
  if (kettlebellPred) {
    await store.update('predictions', kettlebellPred.id, {
      status: 'rejected',
      decisionComment: 'Sufficient backup stock in warehouse B. Postponing reorder.',
      approvedBy: manager.name,
      approvedAt: '2026-08-08T11:30:00.000Z',
    });
    await store.insert('auditLogs', {
      productId: 7,
      productName: kettlebellPred.productName,
      prediction: `Demand ${kettlebellPred.forecastDemand} units over ${kettlebellPred.horizonDays || 14} days`,
      aiReason: kettlebellPred.reason,
      managerDecision: 'rejected',
      approvedBy: manager.name,
      comment: 'Sufficient backup stock in warehouse B. Postponing reorder.',
      confidence: kettlebellPred.confidence,
      timestamp: '2026-08-08T11:30:00.000Z',
      recommendedOrderQty: kettlebellPred.recommendedOrderQty,
    });
  }

  // Keep items 1 (Umbrella), 4 (T-shirt), 5 (Rain Jacket) as PENDING reorders for human-in-the-loop testing on the dashboard!

  store._persist();

  console.log('=== Real ML Data Seeding Completed Successfully! ===');
  console.log(`- Products: ${store.col('products').length}`);
  console.log(`- Total Sales: ${store.col('sales').length}`);
  console.log(`- ML Predictions: ${store.col('predictions').length}`);
  console.log(`  - Pending: ${store.find('predictions', p => p.status === 'pending').length}`);
  console.log(`  - Approved: ${store.find('predictions', p => p.status === 'approved').length}`);
  console.log(`  - Rejected: ${store.find('predictions', p => p.status === 'rejected').length}`);
  console.log(`- Manager Audit Logs: ${store.col('auditLogs').length}`);
  console.log(`- Risk Alerts: ${store.col('alerts').length}`);
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
