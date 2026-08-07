/* SmartStock AI — Chart.js helpers */
(function () {
  const CHARTS = {};

  const PALETTE = ['#2563eb', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#f43f5e', '#6366f1'];

  function baseFont() {
    return { family: "'Inter', sans-serif", weight: 600 };
  }

  function render(canvasId, config) {
    const el = document.getElementById(canvasId);
    if (!el) return null;
    if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
    CHARTS[canvasId] = new Chart(el, config);
    return CHARTS[canvasId];
  }

  function salesTrend(id, labels, actual, forecast, highlight) {
    render(id, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Actual sales',
            data: actual,
            borderColor: '#2563eb',
            backgroundColor: (ctx) => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 280);
              g.addColorStop(0, 'rgba(37,99,235,.28)');
              g.addColorStop(1, 'rgba(37,99,235,0)');
              return g;
            },
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#2563eb'
          },
          {
            label: 'Forecast demand',
            data: forecast,
            borderColor: '#10b981',
            borderDash: [6, 6],
            borderWidth: 2.5,
            fill: false,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#10b981'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#64748b', usePointStyle: true, pointStyle: 'circle', boxWidth: 8, font: baseFont() }
          },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,.9)',
            padding: 12,
            cornerRadius: 12,
            titleFont: baseFont(),
            bodyFont: baseFont()
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8', font: baseFont(), maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(226,232,240,.6)' }, ticks: { color: '#94a3b8', font: baseFont() }, beginAtZero: true }
        }
      }
    });
  }

  function categoryDonut(id, labels, values) {
    render(id, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: PALETTE,
          borderWidth: 3,
          borderColor: '#ffffff',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#475569', usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14, font: baseFont() }
          },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,.9)',
            padding: 12,
            cornerRadius: 12,
            callbacks: { label: (c) => ` ${c.label}: ${c.parsed} units` }
          }
        }
      }
    });
  }

  function topProducts(id, labels, values) {
    render(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map((_, i) => (i % 2 === 0 ? '#2563eb' : '#10b981')),
          borderRadius: 10,
          barPercentage: 0.65
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,.9)',
            padding: 12,
            cornerRadius: 12,
            callbacks: { label: (c) => ` ${c.parsed.y} units sold` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8', font: baseFont() } },
          y: { grid: { color: 'rgba(226,232,240,.6)' }, ticks: { color: '#94a3b8', font: baseFont() }, beginAtZero: true }
        }
      }
    });
  }

  window.SmartCharts = { salesTrend, categoryDonut, topProducts };
})();
