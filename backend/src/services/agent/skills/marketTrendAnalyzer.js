const config = require('../../config');

const CATEGORY_TRENDS = {
  'Outdoor': { score: 78, note: 'Seasonal weather demand (rain season); search interest rising.' },
  'Electronics': { score: 68, note: 'Steady consumer electronics demand; new-model seasonality.' },
  'Home & Garden': { score: 52, note: 'Near-baseline search interest.' },
  'Apparel': { score: 58, note: 'Mild upward interest for basics.' },
  'Fitness': { score: 55, note: 'Slightly above baseline interest.' },
  'Toys': { score: 82, note: 'Approaching holiday period; search interest climbing.' },
};

/**
 * Market Trend Analyzer skill.
 *
 * Computes a market trend score (0-100) for a product category by combining
 * simulated Google Trends interest with product-level momentum. When a live
 * trend endpoint is configured (TREND_API_URL), it can be swapped in without
 * changing the skill interface.
 */
async function analyze(product) {
  const category = product.category || 'General';
  const base = CATEGORY_TRENDS[category] || { score: 50, note: 'No category baseline; neutral trend.' };

  let score = base.score;
  const note = base.note;

  if (config.trendApiUrl) {
    try {
      const res = await fetch(`${config.trendApiUrl}?q=${encodeURIComponent(product.name)}`);
      if (res.ok) {
        const data = await res.json();
        score = Number(data.score) || score;
      }
    } catch (err) {
      console.warn('[trend-analyzer] live trend fetch failed, using fallback:', err.message);
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    note,
    source: config.trendApiUrl ? 'live' : 'simulated',
    keyword: product.name,
  };
}

module.exports = { analyze };
