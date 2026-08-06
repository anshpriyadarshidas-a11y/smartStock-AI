function dailySeries(sales, days, today) {
  const byDate = {};
  for (const s of sales) byDate[s.date] = (byDate[s.date] || 0) + s.quantity;
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, qty: byDate[key] || 0 });
  }
  return series;
}

function weightedMean(values) {
  if (values.length === 0) return 0;
  let total = 0;
  let weightSum = 0;
  values.forEach((v, i) => {
    const w = i + 1;
    total += v * w;
    weightSum += w;
  });
  return total / weightSum;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values, m) {
  if (values.length < 2) return 0;
  const mu = m === undefined ? mean(values) : m;
  return Math.sqrt(values.reduce((a, v) => a + (v - mu) ** 2, 0) / (values.length - 1));
}

function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const muX = mean(xs);
  const muY = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - muX) * (values[i] - muY);
    den += (xs[i] - muX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function roundUp(n) {
  return Math.ceil(n);
}

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Forecast demand for a product.
 *
 * @param {Object} product        Product with currentStock, minimumStock, supplierId.
 * @param {Object} supplier       Supplier with averageDeliveryDays.
 * @param {Array}  sales          Sales rows for the product ({date, quantity}).
 * @param {Object} opts           { marketTrendScore: 0..100, safetyDays }
 * @returns {Object} explainable forecast
 */
function forecast(product, supplier, sales, opts = {}) {
  const marketTrendScore = clamp(Number(opts.marketTrendScore) || 50, 0, 100);
  const safetyDays = Number(opts.safetyDays) || 7;
  const leadTime = supplier ? supplier.averageDeliveryDays : 5;
  const horizonDays = leadTime + safetyDays;
  const lookback = 90;

  const series = dailySeries(sales, lookback, new Date());
  const quantities = series.map((s) => s.qty);

  const lastWeek = quantities.slice(-7);
  const recentMean = weightedMean(lastWeek);
  const overallMean = mean(quantities);
  const sigma = stddev(quantities, overallMean);

  const recent28 = quantities.slice(-28);
  const slope = linearSlope(recent28);

  const projectedGrowth = (slope * horizonDays) / 2;
  const trendAdj = (marketTrendScore - 50) / 50; // -1 .. 1

  const base = recentMean > 0 ? recentMean : overallMean;
  const predictedDailyDemand = Math.max(0, base * (1 + projectedGrowth / Math.max(base, 0.001)) * (1 + trendAdj * 0.4));
  const predictedDemand = roundUp(predictedDailyDemand * horizonDays);

  const daysOfStockRemaining = predictedDailyDemand > 0 ? product.currentStock / predictedDailyDemand : Infinity;

  const leadThreshold = leadTime + 1;
  const shortageProbability = predictedDailyDemand > 0
    ? clamp(1 / (1 + Math.exp(-(leadThreshold - daysOfStockRemaining))) * 1.35, 0, 1)
    : 0;

  const isShortageRisk = shortageProbability >= 0.5 || daysOfStockRemaining <= leadTime;

  const stockAfterDemand = product.currentStock - predictedDemand;
  const gap = Math.max(product.minimumStock, predictedDemand) - product.currentStock;
  const recommendedOrderQty = isShortageRisk && gap > 0 ? roundUp(gap) : 0;

  const safetyStock = product.minimumStock;
  const suggestedOrderDate = !isShortageRisk
    ? isoDaysFromNow(Math.max(0, Math.floor(daysOfStockRemaining - leadTime)))
    : isoDaysFromNow(0);

  const dataPoints = quantities.filter((q) => q > 0).length;
  const cv = overallMean > 0 ? sigma / overallMean : 0;
  let confidence = clamp(95 - dataPoints * 0.2 - cv * 45 - Math.min(horizonDays, 30) * 0.4, 40, 98);
  confidence = Math.round(confidence);

  const reasoning = [];
  if (sales.length > 0) {
    reasoning.push(
      `Average daily sales are ${overallMean.toFixed(1)} units over the past ${lookback} days, with ${overallMean.toFixed(1)} moving average of ${recentMean.toFixed(1)} over the last week.`
    );
  } else {
    reasoning.push('No sales history found for this product; forecast is based on minimum stock policy.');
  }
  if (Math.abs(slope) > 0.01) {
    const direction = slope > 0 ? 'increasing' : 'declining';
    reasoning.push(`Sales trend over the last 28 days is ${direction} by approximately ${Math.abs(slope).toFixed(2)} units/day.`);
  }
  if (marketTrendScore !== 50) {
    const dir = marketTrendScore > 50 ? 'above' : 'below';
    reasoning.push(`Market search interest is ${dir} normal (trend score ${marketTrendScore}), adjusting expected demand ${trendAdj >= 0 ? 'up' : 'down'} by ${(Math.abs(trendAdj) * 40).toFixed(0)}%.`);
  } else {
    reasoning.push('Market trend data unavailable; using neutral trend score.');
  }
  reasoning.push(
    `Supplier lead time is ${leadTime} days; with a ${safetyDays}-day safety buffer, the planning horizon is ${horizonDays} days.`
  );
  reasoning.push(
    `Current stock (${product.currentStock}) covers approximately ${daysOfStockRemaining === Infinity ? 'unlimited' : daysOfStockRemaining.toFixed(1)} days of expected demand.`
  );
  if (isShortageRisk) {
    reasoning.push(
      `Shortage risk estimated at ${(shortageProbability * 100).toFixed(0)}%. Recommended order: ${recommendedOrderQty} units to restore stock to at least ${product.minimumStock} units.`
    );
  } else {
    reasoning.push(`No immediate shortage risk (${(shortageProbability * 100).toFixed(0)}%). Next review suggested for ${suggestedOrderDate}.`);
  }

  return {
    productId: product.id,
    productName: product.name,
    category: product.category,
    predictedDailyDemand: Number(predictedDailyDemand.toFixed(2)),
    predictedDemand,
    horizonDays,
    confidence,
    shortageProbability: Number(shortageProbability.toFixed(2)),
    shortageRisk: isShortageRisk,
    recommendedOrderQty,
    suggestedOrderDate,
    daysOfStockRemaining: daysOfStockRemaining === Infinity ? null : Number(daysOfStockRemaining.toFixed(1)),
    reasoning,
    inputs: {
      currentStock: product.currentStock,
      minimumStock: product.minimumStock,
      leadTime,
      safetyDays,
      marketTrendScore,
      salesCount: sales.length,
    },
  };
}

module.exports = { forecast, dailySeries };
