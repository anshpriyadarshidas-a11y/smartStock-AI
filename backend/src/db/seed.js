const bcrypt = require('bcryptjs');
const { initStore, getStore } = require('./db');

function daysAgoISO(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function seededData() {
  const suppliers = [
    { id: 1, name: 'Prime Supply Co.', contact: 'supply@prime.example', averageDeliveryDays: 4 },
    { id: 2, name: 'Northline Distributors', contact: 'sales@northline.example', averageDeliveryDays: 6 },
    { id: 3, name: 'Global Goods LLC', contact: 'orders@globalgoods.example', averageDeliveryDays: 9 },
    { id: 4, name: 'Evergreen Wholesale', contact: 'hello@evergreen.example', averageDeliveryDays: 3 },
  ];

  const products = [
    { id: 1, name: 'Umbrella 65cm Auto', category: 'Outdoor', currentStock: 22, minimumStock: 30, price: 12.5, supplierId: 1, warehouse: 'Main Warehouse' },
    { id: 2, name: 'Wireless Earbuds Pro', category: 'Electronics', currentStock: 14, minimumStock: 25, price: 49.99, supplierId: 2, warehouse: 'Main Warehouse' },
    { id: 3, name: 'Ceramic Coffee Mug', category: 'Home & Garden', currentStock: 120, minimumStock: 40, price: 8.0, supplierId: 4, warehouse: 'East Depot' },
    { id: 4, name: 'Cotton T-Shirt (Pack of 3)', category: 'Apparel', currentStock: 18, minimumStock: 35, price: 21.0, supplierId: 3, warehouse: 'Main Warehouse' },
    { id: 5, name: 'Rain Jacket Shell', category: 'Outdoor', currentStock: 9, minimumStock: 20, price: 55.0, supplierId: 1, warehouse: 'East Depot' },
    { id: 6, name: 'Smart LED Bulb 9W', category: 'Electronics', currentStock: 60, minimumStock: 50, price: 14.5, supplierId: 2, warehouse: 'Main Warehouse' },
    { id: 7, name: 'Kettlebell 8kg', category: 'Fitness', currentStock: 11, minimumStock: 15, price: 34.0, supplierId: 4, warehouse: 'East Depot' },
    { id: 8, name: 'Board Game: Strategy Nights', category: 'Toys', currentStock: 45, minimumStock: 25, price: 29.0, supplierId: 3, warehouse: 'East Depot' },
  ];

  // Deterministic pseudo-random generator so the demo is reproducible.
  let seedValue = 42;
  function rand() {
    seedValue = (seedValue * 9301 + 49297) % 233280;
    return seedValue / 233280;
  }

  const sales = [];
  const lastDays = 90;
  const baseDaily = {
    1: { base: 9, trend: 0.35 }, // umbrella: rising trend (rainy season)
    2: { base: 8, trend: 0.18 }, // earbuds: rising trend
    3: { base: 6, trend: 0 },    // mugs: steady
    4: { base: 7, trend: 0.1 },  // t-shirts: mild
    5: { base: 4, trend: 0.25 }, // rain jackets: rising
    6: { base: 5, trend: 0 },    // bulbs: steady
    7: { base: 3, trend: 0.05 }, // kettlebells
    8: { base: 5, trend: 0.4 },  // board games: rising (holiday)
  };

  let saleId = 1;
  for (let day = lastDays; day >= 1; day -= 1) {
    const date = daysAgoISO(day);
    for (const p of products) {
      const cfg = baseDaily[p.id];
      const season = 1 + 0.25 * Math.sin(((day % 30) / 30) * Math.PI * 2);
      const weekly = day % 7 === 0 || day % 7 === 6 ? 1.3 : 1.0; // weekend bump
      const grown = cfg.base * (1 + cfg.trend * (1 - day / lastDays));
      const qty = Math.max(0, Math.round(grown * season * weekly * (0.7 + rand() * 0.6)));
      if (qty === 0) continue;
      sales.push({
        id: saleId++,
        productId: p.id,
        quantity: qty,
        date: date.slice(0, 10),
        revenue: Number((qty * p.price).toFixed(2)),
      });
    }
  }

  return {
    users: [],
    suppliers,
    products,
    sales,
    predictions: [],
    auditLogs: [],
    alerts: [],
    notifications: [],
  };
}

async function seedData({ force = false, store = null } = {}) {
  store = store || getStore();
  const hasData = store.count('products') > 0 || store.count('sales') > 0;

  if (hasData && !force) {
    console.log('[seed] database already has data. Use --force to reseed.');
    return { seeded: false };
  }

  const data = seededData();

  const password = await bcrypt.hash('password123', 10);
  data.users = [
    { id: 1, name: 'System Admin', email: 'admin@smartstock.dev', passwordHash: password, role: 'admin' },
    { id: 2, name: 'Priya Manager', email: 'manager@smartstock.dev', passwordHash: password, role: 'manager' },
    { id: 3, name: 'Ravi Employee', email: 'employee@smartstock.dev', passwordHash: password, role: 'employee' },
  ];

  if (store.seedFrom) {
    await store.seedFrom(data);
  } else {
    store.data = data;
    store._persist();
  }

  console.log('[seed] demo data seeded: 3 users, 4 suppliers, 8 products, ~90 days of sales.');
  return { seeded: true };
}

if (require.main === module) {
  initStore()
    .then((store) => seedData({ force: process.argv.includes('--force'), store }))
    .then(async ({ seeded }) => {
      const active = getStore();
      if (active && typeof active.close === 'function') {
        await active.close().catch(() => {});
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed] failed:', err);
      process.exit(1);
    });
}

module.exports = { seedData, seededData };
