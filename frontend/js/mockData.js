/* SmartStock AI — offline demo dataset (mirrors backend seed + agent output) */
(function () {
  const DAY = 86400000;
  const iso = (d) => d.toISOString().slice(0, 10);

  function daysAgo(n) {
    const d = new Date(Date.now() - n * DAY);
    return iso(d);
  }

  const SUPPLIERS = [
    { id: 1, name: 'Prime Supply Co.', contact: 'supply@prime.example', averageDeliveryDays: 4 },
    { id: 2, name: 'Northline Distributors', contact: 'sales@northline.example', averageDeliveryDays: 6 },
    { id: 3, name: 'Global Goods LLC', contact: 'orders@globalgoods.example', averageDeliveryDays: 9 },
    { id: 4, name: 'Evergreen Wholesale', contact: 'hello@evergreen.example', averageDeliveryDays: 3 }
  ];

  const PRODUCTS = [
    { id: 1, name: 'Umbrella 65cm Auto', category: 'Outdoor', currentStock: 22, minimumStock: 30, price: 12.5, supplierId: 1, warehouse: 'Main Warehouse' },
    { id: 2, name: 'Wireless Earbuds Pro', category: 'Electronics', currentStock: 14, minimumStock: 25, price: 49.99, supplierId: 2, warehouse: 'Main Warehouse' },
    { id: 3, name: 'Ceramic Coffee Mug', category: 'Home & Garden', currentStock: 120, minimumStock: 40, price: 8.0, supplierId: 4, warehouse: 'East Depot' },
    { id: 4, name: 'Cotton T-Shirt (Pack of 3)', category: 'Apparel', currentStock: 18, minimumStock: 35, price: 21.0, supplierId: 3, warehouse: 'Main Warehouse' },
    { id: 5, name: 'Rain Jacket Shell', category: 'Outdoor', currentStock: 9, minimumStock: 20, price: 55.0, supplierId: 1, warehouse: 'East Depot' },
    { id: 6, name: 'Smart LED Bulb 9W', category: 'Electronics', currentStock: 60, minimumStock: 50, price: 14.5, supplierId: 2, warehouse: 'Main Warehouse' },
    { id: 7, name: 'Kettlebell 8kg', category: 'Fitness', currentStock: 11, minimumStock: 15, price: 34.0, supplierId: 4, warehouse: 'East Depot' },
    { id: 8, name: 'Board Game: Strategy Nights', category: 'Toys', currentStock: 45, minimumStock: 25, price: 29.0, supplierId: 3, warehouse: 'East Depot' }
  ];

  let seedValue = 42;
  function rand() {
    seedValue = (seedValue * 9301 + 49297) % 233280;
    return seedValue / 233280;
  }

  const baseDaily = {
    1: { base: 9, trend: 0.35 },
    2: { base: 8, trend: 0.18 },
    3: { base: 6, trend: 0 },
    4: { base: 7, trend: 0.1 },
    5: { base: 4, trend: 0.25 },
    6: { base: 5, trend: 0 },
    7: { base: 3, trend: 0.05 },
    8: { base: 5, trend: 0.4 }
  };

  const SALES = [];
  let saleId = 1;
  for (let day = 89; day >= 0; day -= 1) {
    const date = daysAgo(day);
    for (const p of PRODUCTS) {
      const cfg = baseDaily[p.id];
      const season = 1 + 0.25 * Math.sin(((day % 30) / 30) * Math.PI * 2);
      const weekly = day % 7 === 0 || day % 7 === 6 ? 1.3 : 1.0;
      const grown = cfg.base * (1 + cfg.trend * (1 - day / 90));
      const qty = Math.max(0, Math.round(grown * season * weekly * (0.7 + rand() * 0.6)));
      if (qty === 0) continue;
      SALES.push({ id: saleId++, productId: p.id, quantity: qty, date, revenue: Number((qty * p.price).toFixed(2)) });
    }
  }

  const CATEGORY_TRENDS = {
    Outdoor: { score: 78, note: 'Seasonal weather demand (rain season); search interest rising.' },
    Electronics: { score: 68, note: 'Steady consumer electronics demand; new-model seasonality.' },
    'Home & Garden': { score: 52, note: 'Near-baseline search interest.' },
    Apparel: { score: 58, note: 'Mild upward interest for basics.' },
    Fitness: { score: 55, note: 'Slightly above baseline interest.' },
    Toys: { score: 82, note: 'Approaching holiday period; search interest climbing.' }
  };

  const PREDICTIONS = PRODUCTS.map((p) => {
    const sales = SALES.filter((s) => s.productId === p.id);
    const qty = sales.map((s) => s.quantity);
    const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const overall = mean(qty);
    const recent = qty.length >= 7 ? mean(qty.slice(-7)) : overall;
    const lead = SUPPLIERS.find((s) => s.id === p.supplierId).averageDeliveryDays;
    const horizon = lead + 7;
    const trend = CATEGORY_TRENDS[p.category] || { score: 50, note: 'neutral' };
    const trendAdj = (trend.score - 50) / 50;
    const daily = Math.max(0, recent * (1 + trendAdj * 0.4));
    const predictedDemand = Math.ceil(daily * horizon);
    const daysLeft = daily > 0 ? p.currentStock / daily : Infinity;
    const shortageProbability = daily > 0 ? Math.min(1, Math.max(0, (1 / (1 + Math.exp(-(lead + 1 - daysLeft))) * 1.35))) : 0;
    const shortageRisk = shortageProbability >= 0.5 || daysLeft <= lead;
    const gap = Math.max(p.minimumStock, predictedDemand) - p.currentStock;
    const recommendedOrderQty = shortageRisk && gap > 0 ? Math.ceil(gap) : 0;
    const confidence = Math.min(98, Math.max(40, Math.round(95 - sales.length * 0.2 - Math.min(horizon, 30) * 0.4)));
    const reason = [
      `Average daily sales are ${overall.toFixed(1)} units over the past 90 days, with ${recent.toFixed(1)} over the last week.`,
      `Market search interest is above normal (trend score ${trend.score}), adjusting expected demand up by ${(Math.abs(trendAdj) * 40).toFixed(0)}%.`,
      `Supplier lead time is ${lead} days; with a 7-day safety buffer, the planning horizon is ${horizon} days.`,
      `Current stock (${p.currentStock}) covers approximately ${daysLeft === Infinity ? 'unlimited' : daysLeft.toFixed(1)} days of expected demand.`,
      shortageRisk
        ? `Shortage risk estimated at ${(shortageProbability * 100).toFixed(0)}%. Recommended order: ${recommendedOrderQty} units to restore stock to at least ${p.minimumStock} units.`
        : `No immediate shortage risk (${(shortageProbability * 100).toFixed(0)}%). Next review suggested for ${daysAgo(-Math.max(0, Math.floor(daysLeft - lead)))}.`
    ];
    return {
      id: p.id,
      productId: p.id,
      productName: p.name,
      category: p.category,
      forecastDemand: predictedDemand,
      predictedDailyDemand: Number(daily.toFixed(2)),
      confidence,
      recommendedOrderQty,
      suggestedOrderDate: shortageRisk ? daysAgo(0) : daysAgo(-Math.max(0, Math.floor(daysLeft - lead))),
      shortageProbability: Number(shortageProbability.toFixed(2)),
      shortageRisk,
      reason: reason.join(' '),
      trendScore: trend.score,
      trendNote: trend.note,
      trendSource: 'simulated',
      model: 'builtin-linear-regression',
      status: 'pending',
      createdAt: daysAgo(0)
    };
  });

  const AUDIT_LOGS = [
    {
      id: 1, productId: 8, productName: 'Board Game: Strategy Nights', prediction: 'Demand 84 in 16 days',
      aiReason: 'Holiday search interest climbing (trend score 82).',
      managerDecision: 'approved', approvedBy: 'Priya Manager', comment: 'Ramp for festive season.',
      timestamp: daysAgo(1), confidence: 92
    },
    {
      id: 2, productId: 6, productName: 'Smart LED Bulb 9W', prediction: 'Demand 91 in 13 days',
      aiReason: 'Steady electronics demand, neutral trend.',
      managerDecision: 'rejected', approvedBy: 'Priya Manager', comment: 'Supplier out of stock; revisit next week.',
      timestamp: daysAgo(2), confidence: 76
    },
    {
      id: 3, productId: 1, productName: 'Umbrella 65cm Auto', prediction: 'Demand 128 in 11 days',
      aiReason: 'Sales up 32% in 4 weeks; Google Trends +40% for umbrellas.',
      managerDecision: 'approved', approvedBy: 'Priya Manager', comment: 'Monsoon demand confirmed.',
      timestamp: daysAgo(3), confidence: 91
    }
  ];

  const ALERTS = [
    {
      id: 1, type: 'critical', productId: 5, message: 'Rain Jacket Shell: stock (9) covers ~2.4 days. Recommended order 24 units (confidence 93%).',
      severity: 'high', read: false, createdAt: daysAgo(0)
    },
    {
      id: 2, type: 'critical', productId: 2, message: 'Wireless Earbuds Pro: stock (14) covers ~4.1 days. Recommended order 32 units (confidence 89%).',
      severity: 'high', read: false, createdAt: daysAgo(0)
    },
    {
      id: 3, type: 'shortage_risk', productId: 1, message: 'Umbrella 65cm Auto: stock (22) covers ~6.0 days. Recommended order 40 units (confidence 91%).',
      severity: 'medium', read: false, createdAt: daysAgo(0)
    },
    {
      id: 4, type: 'shortage_risk', productId: 4, message: 'Cotton T-Shirt: stock (18) covers ~5.4 days. Recommended order 32 units (confidence 84%).',
      severity: 'medium', read: false, createdAt: daysAgo(0)
    }
  ];

  const USERS = [
    { id: 1, name: 'System Admin', email: 'admin@smartstock.dev', role: 'admin' },
    { id: 2, name: 'Priya Manager', email: 'manager@smartstock.dev', role: 'manager' },
    { id: 3, name: 'Ravi Employee', email: 'employee@smartstock.dev', role: 'employee' }
  ];

  window.MockData = {
    users: USERS,
    suppliers: SUPPLIERS,
    products: PRODUCTS,
    sales: SALES,
    predictions: PREDICTIONS,
    auditLogs: AUDIT_LOGS,
    alerts: ALERTS
  };
})();
