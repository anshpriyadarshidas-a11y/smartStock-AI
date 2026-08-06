const config = require('../config');
const { forecast: builtinForecast } = require('./agent/forecast');

/**
 * Client for the optional Python ML service (FastAPI + scikit-learn).
 * Falls back to the built-in forecast engine when the service is unreachable
 * or not configured, so the product always works end-to-end.
 */
async function predict(product, supplier, sales, marketTrendScore = 50) {
  if (!config.aiServiceUrl) {
    return { model: 'builtin-linear-regression', ...builtinForecast(product, supplier, sales, { marketTrendScore }) };
  }

  try {
    const res = await fetch(`${config.aiServiceUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product,
        supplierLeadTime: supplier ? supplier.averageDeliveryDays : 5,
        sales: sales.map((s) => ({ date: s.date, quantity: s.quantity })),
        marketTrendScore,
      }),
    });
    if (!res.ok) throw new Error(`AI service returned ${res.status}`);
    const data = await res.json();
    return { model: 'python-scikit-learn', ...data.forecast };
  } catch (err) {
    console.warn('[mlClient] python service unavailable, using built-in engine:', err.message);
    return { model: 'builtin-linear-regression', ...builtinForecast(product, supplier, sales, { marketTrendScore }) };
  }
}

module.exports = { predict };
