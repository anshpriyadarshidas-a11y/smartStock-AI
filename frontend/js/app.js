/* SmartStock AI — application */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    user: null,
    section: 'dashboard',
    products: [],
    suppliers: [],
    sales: [],
    predictions: [],
    alerts: [],
    auditLogs: [],
    notifSeen: new Set(),
    recFilter: 'pending',
    invQuery: '',
    invCategory: 'all'
  };

  const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const RING_C = 2 * Math.PI * 42;

  /* ---------------- Toasts ---------------- */
  function toast(message, type = 'info') {
    const root = $('toast-root');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
    root.appendChild(t);
    setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 320); }, 3600);
  }

  /* ---------------- Counters ---------------- */
  function animateCount(el, target, decimals = 0, prefix = '') {
    const dur = 800;
    const start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = target * eased;
      el.textContent = prefix + val.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------------- Data loading ---------------- */
  async function loadAll() {
    const calls = {
      products: SmartStockAPI.getProducts(),
      suppliers: SmartStockAPI.getSuppliers(),
      sales: SmartStockAPI.getSales(),
      predictions: SmartStockAPI.getForecast(),
      alerts: SmartStockAPI.getAlerts(),
      auditLogs: SmartStockAPI.getAuditLogs()
    };
    const settled = await Promise.allSettled(Object.values(calls));
    const keys = Object.keys(calls);
    let failed = 0;
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') state[keys[i]] = r.value;
      else { failed += 1; console.warn(`loadAll: ${keys[i]} failed`, r.reason); }
    });
    if (failed > 0) toast(`Some data failed to load (${failed} source${failed > 1 ? 's' : ''})`, 'error');
    updateNotifBadges();
  }

  function supplierName(id) {
    const s = state.suppliers.find((x) => x.id === id);
    return s ? s.name : '—';
  }

  /* ---------------- Helpers ---------------- */
  function confColor(pct) {
    if (pct >= 85) return '#10b981';
    if (pct >= 70) return '#2563eb';
    return '#f59e0b';
  }

  function stockHealth(product) {
    if (product.currentStock < product.minimumStock) return { label: 'Low', cls: 'badge-red' };
    if (product.currentStock < product.minimumStock * 1.5) return { label: 'Reorder', cls: 'badge-amber' };
    return { label: 'In stock', cls: 'badge-green' };
  }

  function statusBadge(status) {
    const map = {
      pending: { label: '⏳ Awaiting approval', cls: 'badge-amber' },
      approved: { label: '✓ Approved', cls: 'badge-green' },
      rejected: { label: '✕ Rejected', cls: 'badge-red' }
    };
    const m = map[status] || { label: status, cls: 'badge-slate' };
    return `<span class="badge ${m.cls}">${m.label}</span>`;
  }

  function riskBadge(p) {
    if (p >= 0.6) return `<span class="badge badge-red">High · ${Math.round(p * 100)}%</span>`;
    if (p >= 0.3) return `<span class="badge badge-amber">Medium · ${Math.round(p * 100)}%</span>`;
    return `<span class="badge badge-green">Low · ${Math.round(p * 100)}%</span>`;
  }

  function confidenceRing(pct) {
    const color = confColor(pct);
    const offset = RING_C * (1 - pct / 100);
    return `
      <div class="conf-ring" title="Confidence ${pct}%">
        <svg viewBox="0 0 100 100" width="54" height="54">
          <circle class="ring-bg" cx="50" cy="50" r="42" stroke-width="7"></circle>
          <circle class="ring-fg" cx="50" cy="50" r="42" stroke="${color}" stroke-dasharray="${RING_C.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
        </svg>
        <span class="ring-txt" style="color:${color}">${pct}%</span>
      </div>`;
  }

  function dailyTotals(days) {
    const byDate = {};
    const labels = [];
    const values = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(key.slice(5));
      values.push(0);
      byDate[key] = values.length - 1;
    }
    for (const s of state.sales) {
      const idx = byDate[s.date];
      if (idx !== undefined) values[idx] += s.quantity;
    }
    return { labels, values };
  }

  function categoryTotals() {
    const map = {};
    for (const p of state.products) map[p.category] = (map[p.category] || 0) + p.currentStock;
    return { labels: Object.keys(map), values: Object.values(map) };
  }

  /* ---------------- Navigation ---------------- */
  function switchSection(section) {
    state.section = section;
    document.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.section === section);
    });
    closeSidebar();
    const renderers = {
      dashboard: renderDashboard,
      inventory: renderInventory,
      predictions: renderPredictions,
      sales: renderSales,
      suppliers: renderSuppliers,
      audit: renderAudit
    };
    (renderers[section] || renderDashboard)();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSidebar() { $('sidebar').classList.add('open'); $('sidebar-overlay').classList.add('open'); }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebar-overlay').classList.remove('open'); }

  /* ---------------- Dashboard ---------------- */
  function renderDashboard() {
    const pending = state.predictions.filter((p) => p.status === 'pending');
    const lowStock = state.products.filter((p) => p.currentStock < p.minimumStock);
    const stockValue = state.products.reduce((a, p) => a + p.currentStock * p.price, 0);
    const totalUnits = state.products.reduce((a, p) => a + p.currentStock, 0);
    const critical = state.alerts.filter((a) => a.severity === 'high').length;

    $('content').innerHTML = `
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6 animate-fade-up">
        <div>
          <h2 class="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Inventory Control Center</h2>
          <p class="text-sm text-slate-500 mt-1">Live agent analysis · market-aware forecasts · human-approved restocks</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-primary" data-action="run-agent"><span>⚡</span> Run agent analysis</button>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        ${kpiCard('kpi-value', '🗃️', 'bg-blue-50', 'Total stock units', 'totalUnits', totalUnits, 'across warehouses')}
        ${kpiCard('kpi-value', '💰', 'bg-emerald-50', 'Stock value', 'stockValue', stockValue, 'retail value', true)}
        ${kpiCard('kpi-value', '⏳', 'bg-amber-50', 'Pending approvals', 'pendingCount', pending.length, 'awaiting review')}
        ${kpiCard('kpi-value', '🚨', 'bg-rose-50', 'Shortage alerts', 'alertCount', critical, 'high severity')}
      </div>

      <div class="grid lg:grid-cols-3 gap-5 mb-6">
        <div class="card lg:col-span-2">
          <div class="card-title"><span>Sales vs forecasted demand</span>
            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-widest">30 days · units</span>
          </div>
          <div class="h-64"><canvas id="chart-sales"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title"><span>Inventory by category</span></div>
          <div class="h-64"><canvas id="chart-category"></canvas></div>
        </div>
      </div>

      <div class="grid lg:grid-cols-3 gap-5">
        <div class="card lg:col-span-2">
          <div class="card-title"><span>AI restock recommendations</span>
            <button class="text-[11px] font-bold text-brand-600 hover:text-brand-700" data-action="goto-predictions">View all →</button>
          </div>
          <div id="dash-rec-list" class="space-y-3"></div>
        </div>
        <div class="card">
          <div class="card-title"><span>Alerts</span>
            <span id="alert-count" class="badge badge-red">${state.alerts.length}</span>
          </div>
          <div id="alert-feed" class="space-y-2.5"></div>
        </div>
      </div>
    `;

    const recList = $('dash-rec-list');
    if (pending.length) {
      recList.innerHTML = pending.slice(0, 3).map(recCard).join('');
    } else {
      recList.innerHTML = `<div class="empty-state"><div class="big">✅</div><p class="text-sm">No pending recommendations. Run the agent to re-analyze.</p></div>`;
    }

    const feed = $('alert-feed');
    if (state.alerts.length) {
      feed.innerHTML = state.alerts.slice(0, 4).map((a) => `
        <div class="flex gap-3 p-3 rounded-2xl ${a.severity === 'high' ? 'bg-rose-50/80 border border-rose-100' : 'bg-amber-50/80 border border-amber-100'}">
          <span class="text-lg">${a.severity === 'high' ? '🚨' : '⚠️'}</span>
          <div>
            <p class="text-xs font-semibold text-slate-700 leading-snug">${escapeHtml(a.message)}</p>
            <p class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(a.createdAt || '')}</p>
          </div>
        </div>`).join('');
    } else {
      feed.innerHTML = `<div class="empty-state"><div class="big">🎉</div><p class="text-sm">All stock levels healthy.</p></div>`;
    }

    animateCount($('totalUnits'), totalUnits);
    animateCount($('stockValue'), stockValue, 0, '$');
    animateCount($('pendingCount'), pending.length);
    animateCount($('alertCount'), critical);

    const { labels, values } = dailyTotals(30);
    const forecastSum = state.predictions.reduce((a, p) => a + p.predictedDailyDemand, 0);
    const fLabels = [];
    const fValues = [];
    for (let i = 1; i <= 16; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      fLabels.push(d.toISOString().slice(5, 10));
      fValues.push(forecastSum);
    }
    SmartCharts.salesTrend('chart-sales', [...labels, ...fLabels], [...values, ...Array(16).fill(null)], [...Array(30).fill(null), ...fValues]);
    const cat = categoryTotals();
    SmartCharts.categoryDonut('chart-category', cat.labels, cat.values);
  }

  function kpiCard(id, ico, bg, label, kpiId, value, sub, money) {
    return `
      <div class="card hoverable animate-fade-up">
        <div class="flex items-center justify-between mb-3">
          <div class="kpi-icon ${bg}">${ico}</div>
        </div>
        <p id="${kpiId}" class="kpi-value" data-value="${value}" data-money="${money ? 1 : 0}">0</p>
        <p class="kpi-label mt-1">${label}</p>
        <p class="text-[11px] text-slate-400 mt-0.5">${sub}</p>
      </div>`;
  }

  /* ---------------- Recommendation card ---------------- */
  function recCard(rec, compact) {
    const canDecide = state.user && (state.user.role === 'admin' || state.user.role === 'manager');
    const actions = rec.status === 'pending' && canDecide ? `
      <div class="flex gap-2 mt-4">
        <button class="btn btn-emerald btn-sm flex-1" data-action="decide" data-id="${rec.productId}" data-decision="approved">✓ Approve</button>
        <button class="btn btn-danger btn-sm flex-1" data-action="decide" data-id="${rec.productId}" data-decision="rejected">✕ Reject</button>
      </div>` : '';
    const note = rec.status === 'pending' && !canDecide
      ? `<p class="text-[11px] font-semibold text-slate-400 mt-3">🔒 Awaiting manager approval</p>` : '';
    const stockBarPct = rec.product ? Math.min(100, (rec.product.currentStock / Math.max(rec.product.minimumStock * 1.5, 1)) * 100) : 60;

    return `
      <div class="rec-card" data-rec="${rec.productId}">
        <div class="flex items-start gap-4">
          ${confidenceRing(rec.confidence)}
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="font-bold text-slate-900 truncate">${escapeHtml(rec.productName)}</h4>
              <span class="badge badge-blue">${escapeHtml(rec.category)}</span>
              ${statusBadge(rec.status)}
            </div>
            <p class="text-xs text-slate-500 mt-0.5">${rec.model || 'builtin-linear-regression'} · trend score ${rec.trendScore ?? 50}</p>
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div class="stat-mini"><p class="stat-label">Forecast demand</p><p class="stat-value">${fmtInt(rec.forecastDemand)} <span class="text-[10px] text-slate-400">units</span></p></div>
          <div class="stat-mini"><p class="stat-label">Recommend order</p><p class="stat-value text-emerald-600 font-black">${rec.recommendedOrderQty} <span class="text-[10px] text-slate-400">units</span></p></div>
          <div class="stat-mini"><p class="stat-label">Shortage risk</p><p>${riskBadge(rec.shortageProbability)}</p></div>
          <div class="stat-mini"><p class="stat-label">Order by</p><p class="stat-value">${escapeHtml(rec.suggestedOrderDate || '—')}</p></div>
        </div>

        <details class="mt-4 group">
          <summary class="cursor-pointer text-xs font-bold text-brand-600 hover:text-brand-700 select-none">🧠 Why did the agent recommend this? <span class="group-open:hidden">▸</span><span class="hidden group-open:inline">▾</span></summary>
          <div class="reason-box mt-2">${escapeHtml(rec.reason)}</div>
        </details>
        ${actions}${note}
      </div>`;
  }

  /* ---------------- Inventory ---------------- */
  function renderInventory() {
    const cats = [...new Set(state.products.map((p) => p.category))];
    const canAdmin = state.user && state.user.role === 'admin';

    $('content').innerHTML = `
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6 animate-fade-up">
        <div>
          <h2 class="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Inventory</h2>
          <p class="text-sm text-slate-500 mt-1">${state.products.length} products across ${state.suppliers.length} suppliers</p>
        </div>
        ${canAdmin ? `<button class="btn btn-primary" data-action="open-add-product">＋ Add product</button>` : ''}
      </div>

      <div class="card mb-5">
        <div class="flex flex-col sm:flex-row gap-3">
          <div class="relative flex-1">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input id="inv-search" class="input-base pl-9" placeholder="Filter by name, category or warehouse…" value="${escapeHtml(state.invQuery)}" />
          </div>
          <select id="inv-category" class="input-base sm:w-56">
            <option value="all" ${state.invCategory === 'all' ? 'selected' : ''}>All categories</option>
            ${cats.map((c) => `<option value="${escapeHtml(c)}" ${state.invCategory === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="card p-0 overflow-hidden">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Product</th><th>Warehouse</th><th>Stock</th><th>Min</th><th>Health</th><th>Price</th><th>Supplier</th><th>Trend</th><th>Actions</th>
              </tr>
            </thead>
            <tbody id="inv-body"></tbody>
          </table>
        </div>
      </div>
    `;

    $('inv-search').addEventListener('input', (e) => {
      state.invQuery = e.target.value;
      const body = $('inv-body');
      if (body) body.innerHTML = invRows();
    });
    $('inv-category').addEventListener('change', (e) => {
      state.invCategory = e.target.value;
      const body = $('inv-body');
      if (body) body.innerHTML = invRows();
    });

    $('inv-body').innerHTML = invRows();
  }

  function invRows() {
    const q = state.invQuery.toLowerCase();
    const filtered = state.products.filter((p) => {
      const matchQ = !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.warehouse.toLowerCase().includes(q);
      const matchC = state.invCategory === 'all' || p.category === state.invCategory;
      return matchQ && matchC;
    });
    if (!filtered.length) {
      return `<tr><td colspan="9"><div class="empty-state"><div class="big">🔍</div><p class="text-sm">No products match your filters.</p></div></td></tr>`;
    }
    return filtered.map((p) => {
      const h = stockHealth(p);
      const pct = Math.min(100, (p.currentStock / Math.max(p.minimumStock * 1.5, 1)) * 100);
      const trend = state.predictions.find((r) => r.productId === p.id);
      return `
        <tr>
          <td>
            <p class="font-bold text-slate-800">${escapeHtml(p.name)}</p>
            <p class="text-[11px] text-slate-400">${escapeHtml(p.category)}</p>
          </td>
          <td class="text-slate-500">${escapeHtml(p.warehouse)}</td>
          <td>
            <p class="font-bold text-slate-800">${fmtInt(p.currentStock)}</p>
            <div class="stock-bar mt-1.5 w-24"><div style="width:${pct}%" class="${p.currentStock < p.minimumStock ? 'bg-rose-500' : p.currentStock < p.minimumStock * 1.5 ? 'bg-amber-400' : 'bg-emerald-500'}"></div></div>
          </td>
          <td class="text-slate-500">${fmtInt(p.minimumStock)}</td>
          <td><span class="badge ${h.cls}">${h.label}</span></td>
          <td class="font-semibold text-slate-700">${fmtMoney(p.price)}</td>
          <td class="text-slate-500">${escapeHtml(supplierName(p.supplierId))}</td>
          <td>${trend ? `<span class="badge ${trend.trendScore >= 60 ? 'badge-emerald' : trend.trendScore >= 50 ? 'badge-blue' : 'badge-slate'}">${trend.trendScore}%</span>` : '—'}</td>
          <td>
            <div class="flex items-center gap-2">
              <button class="btn btn-ghost btn-sm" data-action="adjust" data-id="${p.id}">✎ Adjust</button>
              <button class="btn btn-ghost btn-sm" data-action="record-sale-for" data-id="${p.id}" title="Record a sale">🛒 Sell</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  /* ---------------- Predictions / approval ---------------- */
  function renderPredictions() {
    const counts = {
      all: state.predictions.length,
      pending: state.predictions.filter((p) => p.status === 'pending').length,
      approved: state.predictions.filter((p) => p.status === 'approved').length,
      rejected: state.predictions.filter((p) => p.status === 'rejected').length
    };
    const list = state.predictions.filter((p) => state.recFilter === 'all' || p.status === state.recFilter);

    $('content').innerHTML = `
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6 animate-fade-up">
        <div>
          <h2 class="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">AI Recommendations</h2>
          <p class="text-sm text-slate-500 mt-1">Explainable, human-approved purchase suggestions from the Inventory Agent</p>
        </div>
        <button class="btn btn-primary" data-action="run-agent"><span>⚡</span> Re-run agent</button>
      </div>

      <div class="tab-row mb-5">
        ${['all', 'pending', 'approved', 'rejected'].map((f) => `
          <button class="tab-pill ${state.recFilter === f ? 'active' : ''}" data-action="rec-filter" data-filter="${f}">
            ${f[0].toUpperCase() + f.slice(1)} <span class="opacity-60">(${counts[f]})</span>
          </button>`).join('')}
      </div>

      <div id="rec-list" class="grid lg:grid-cols-2 gap-5"></div>
    `;

    const wrap = $('rec-list');
    if (!list.length) {
      wrap.innerHTML = `<div class="lg:col-span-2 card"><div class="empty-state"><div class="big">🤖</div><p class="text-sm">No ${state.recFilter} recommendations right now.</p></div></div>`;
      return;
    }
    wrap.innerHTML = list.map((r) => {
      const product = state.products.find((p) => p.id === r.productId);
      return recCard({ ...r, product });
    }).join('');
  }

  /* ---------------- Sales ---------------- */
  function renderSales() {
    const last30 = state.sales.filter((s) => s.date >= new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    const revenue = last30.reduce((a, s) => a + (s.revenue || s.quantity * (state.products.find((p) => p.id === s.productId)?.price || 0)), 0);
    const units = last30.reduce((a, s) => a + s.quantity, 0);
    const perProduct = {};
    for (const s of state.sales) perProduct[s.productId] = (perProduct[s.productId] || 0) + s.quantity;
    const top = Object.entries(perProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const recent = [...state.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

    $('content').innerHTML = `
      <div class="flex flex-wrap items-end justify-between gap-4 mb-6 animate-fade-up">
        <div>
          <h2 class="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Sales Analytics</h2>
          <p class="text-sm text-slate-500 mt-1">Historical demand feeds every agent forecast</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-primary" data-action="open-record-sale"><span>＋</span> Record sale</button>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        ${kpiCard('', '💰', 'bg-blue-50', 'Revenue · 30 days', 'kpi-rev', revenue, 'across all products', true)}
        ${kpiCard('', '📦', 'bg-emerald-50', 'Units sold · 30 days', 'kpi-units', units, 'all categories')}
        ${kpiCard('', '🚀', 'bg-violet-50', 'Top product', 'kpi-top', top.length ? perProduct[top[0][0]] : 0, state.products.find((p) => p.id === Number(top[0]?.[0]))?.name || '—')}
      </div>

      <div class="grid lg:grid-cols-3 gap-5 mb-6">
        <div class="card lg:col-span-2">
          <div class="card-title"><span>Top selling products</span></div>
          <div class="h-64"><canvas id="chart-top"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title"><span>Sales velocity</span></div>
          <div class="space-y-3">
            ${top.map(([pid, qty], i) => {
              const p = state.products.find((x) => x.id === Number(pid));
              const max = top[0][1];
              return `
                <div>
                  <div class="flex justify-between text-xs mb-1">
                    <span class="font-semibold text-slate-600">${escapeHtml(p?.name || pid)}</span>
                    <span class="font-bold text-slate-800">${fmtInt(qty)}</span>
                  </div>
                  <div class="stock-bar"><div style="width:${Math.max(6, (qty / max) * 100)}%" class="bg-gradient-to-r from-brand-500 to-emerald-500"></div></div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="card p-0 overflow-hidden">
        <div class="card-title px-5 pt-5 mb-0"><span>Recent sales</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Date</th><th>Product</th><th>Category</th><th>Qty</th><th>Revenue</th></tr></thead>
            <tbody>
              ${recent.map((s) => {
                const p = state.products.find((x) => x.id === s.productId);
                return `<tr>
                  <td class="text-slate-500">${escapeHtml(s.date)}</td>
                  <td class="font-semibold text-slate-700">${escapeHtml(p?.name || 'Unknown')}</td>
                  <td><span class="badge badge-slate">${escapeHtml(p?.category || '—')}</span></td>
                  <td class="font-bold">${fmtInt(s.quantity)}</td>
                  <td class="font-semibold">${fmtMoney(s.revenue || s.quantity * (p?.price || 0))}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    animateCount($('kpi-rev'), revenue, 0, '$');
    animateCount($('kpi-units'), units);
    animateCount($('kpi-top'), top.length ? perProduct[top[0][0]] : 0);

    SmartCharts.topProducts('chart-top',
      top.map(([pid]) => state.products.find((p) => p.id === Number(pid))?.name || '—'),
      top.map(([, qty]) => qty));
  }

  /* ---------------- Suppliers ---------------- */
  function renderSuppliers() {
    $('content').innerHTML = `
      <div class="mb-6 animate-fade-up">
        <h2 class="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Suppliers</h2>
        <p class="text-sm text-slate-500 mt-1">Lead times drive the agent's reorder planning horizon</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-5" id="supplier-grid"></div>
    `;
    const grid = $('supplier-grid');
    if (!state.suppliers.length) {
      grid.innerHTML = `<div class="sm:col-span-2 lg:col-span-3 card"><div class="empty-state"><div class="big">🚚</div><p class="text-sm">No suppliers configured.</p></div></div>`;
      return;
    }
    grid.innerHTML = state.suppliers.map((s) => {
      const products = state.products.filter((p) => p.supplierId === s.id);
      const fast = s.averageDeliveryDays <= 4;
      return `
        <div class="card hoverable">
          <div class="flex items-start justify-between mb-3">
            <div class="kpi-icon bg-blue-50">🚚</div>
            <span class="badge ${fast ? 'badge-green' : 'badge-amber'}">${fast ? 'Fast lead' : 'Standard lead'}</span>
          </div>
          <h3 class="font-bold text-slate-900">${escapeHtml(s.name)}</h3>
          <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(s.contact)}</p>
          <div class="flex gap-6 mt-4">
            <div><p class="stat-label">Avg delivery</p><p class="text-lg font-black text-slate-800">${s.averageDeliveryDays}<span class="text-xs text-slate-400"> days</span></p></div>
            <div><p class="stat-label">Products</p><p class="text-lg font-black text-slate-800">${products.length}</p></div>
          </div>
          <div class="mt-4 flex flex-wrap gap-1.5">
            ${products.slice(0, 4).map((p) => `<span class="badge badge-slate">${escapeHtml(p.name)}</span>`).join('')}
            ${products.length > 4 ? `<span class="badge badge-slate">+${products.length - 4} more</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  /* ---------------- Audit ---------------- */
  function renderAudit() {
    $('content').innerHTML = `
      <div class="mb-6 animate-fade-up">
        <h2 class="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Audit Trail</h2>
        <p class="text-sm text-slate-500 mt-1">Every AI decision and human approval, fully traceable</p>
      </div>
      <div class="card p-0 overflow-hidden">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Timestamp</th><th>Product</th><th>Prediction</th><th>Confidence</th><th>AI reasoning</th><th>Decision</th><th>Approved by</th><th>Comment</th></tr>
            </thead>
            <tbody>
              ${state.auditLogs.length ? state.auditLogs.map((l) => `
                <tr>
                  <td class="text-slate-500">${escapeHtml(l.timestamp || '—')}</td>
                  <td class="font-semibold text-slate-700">${escapeHtml(l.productName)}</td>
                  <td class="text-slate-500">${escapeHtml(l.prediction || '—')}</td>
                  <td>${confidenceRing(l.confidence)}</td>
                  <td class="max-w-[220px]"><span class="text-slate-500" title="${escapeHtml(l.aiReason || '')}">${escapeHtml((l.aiReason || '').slice(0, 72))}${(l.aiReason || '').length > 72 ? '…' : ''}</span></td>
                  <td>${statusBadge(l.managerDecision)}</td>
                  <td class="text-slate-500">${escapeHtml(l.approvedBy || '—')}</td>
                  <td class="text-slate-500 max-w-[200px]">${escapeHtml(l.comment || '—')}</td>
                </tr>`).join('') : `
                <tr><td colspan="8"><div class="empty-state"><div class="big">🧾</div><p class="text-sm">No audit records yet.</p></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /* ---------------- Notifications ---------------- */
  function updateNotifBadges() {
    const unread = state.alerts.filter((a) => !state.notifSeen.has(a.id));
    const pending = state.predictions.filter((p) => p.status === 'pending').length;
    $('bell-dot').classList.toggle('hidden', unread.length === 0);
    const dash = $('nav-badge-dashboard');
    const pred = $('nav-badge-predictions');
    if (pending > 0) { pred.textContent = pending; pred.classList.remove('hidden'); } else pred.classList.add('hidden');
    const critical = state.alerts.filter((a) => a.severity === 'high').length;
    if (critical > 0) { dash.textContent = critical; dash.classList.remove('hidden'); } else dash.classList.add('hidden');
  }

  function renderNotifs() {
    const list = $('notif-list');
    if (!list) return;
    if (!state.alerts.length) {
      list.innerHTML = `<div class="empty-state py-6"><div class="big">🔕</div><p class="text-xs">No notifications.</p></div>`;
      return;
    }
    list.innerHTML = state.alerts.map((a) => `
      <div class="notif-item ${state.notifSeen.has(a.id) ? '' : 'unread'}">
        <span>${a.severity === 'high' ? '🚨' : '⚠️'}</span>
        <div class="flex-1">
          <p class="text-xs font-semibold text-slate-700 leading-snug">${escapeHtml(a.message)}</p>
          <p class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(a.createdAt || '')}</p>
        </div>
      </div>`).join('');
  }

  /* ---------------- Approval modal ---------------- */
  function openApproval(rec, decision) {
    if (!rec) return;
    state.modalRec = rec;
    state.modalDecision = decision;
    $('modal-subtitle').textContent = decision === 'approved' ? 'Approve this AI recommendation and place the supplier order.' : 'Reject this recommendation. Nothing will be ordered.';
    const approveBtn = $('confirm-approve-btn');
    approveBtn.className = `btn ${decision === 'approved' ? 'btn-emerald' : 'btn-danger'} w-full justify-center`;
    approveBtn.textContent = decision === 'approved' ? '✓ Approve & place order' : '✕ Reject recommendation';
    const product = state.products.find((p) => p.id === rec.productId);
    $('modal-product').innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p class="font-bold text-slate-900">${escapeHtml(rec.productName)}</p>
          <p class="text-xs text-slate-500">${escapeHtml(rec.category)} · recommend ${rec.recommendedOrderQty} units · confidence ${rec.confidence}%</p>
        </div>
        ${confidenceRing(rec.confidence)}
      </div>
      ${product ? `<p class="text-xs text-slate-500 mt-2">Current stock: <b>${product.currentStock}</b> → after order: <b class="text-emerald-600">${product.currentStock + rec.recommendedOrderQty}</b> units</p>` : ''}`;
    $('approve-modal').classList.remove('hidden');
    $('modal-comment').value = '';
  }

  function closeModal() {
    $('approve-modal').classList.add('hidden');
    state.modalRec = null;
  }

  async function confirmApproval() {
    const rec = state.modalRec;
    const decision = state.modalDecision;
    const comment = $('modal-comment').value;
    if (!rec) return;
    closeModal();
    try {
      await SmartStockAPI.approve({ id: rec.productId, decision, comment });
      await loadAll();
      toast(decision === 'approved' ? `Order approved — ${rec.recommendedOrderQty} units of ${rec.productName} queued` : `${rec.productName} recommendation rejected`, decision === 'approved' ? 'success' : 'info');
      renderPredictions();
    } catch (err) {
      toast(err.message || 'Approval failed', 'error');
      renderPredictions();
    }
  }

  /* ---------------- Add product modal (inline builder) ---------------- */
  function renderAddProductModal() {
    const cats = [...new Set(state.products.map((p) => p.category))];
    const html = `
      <div id="add-modal" class="modal">
        <div class="modal-backdrop" data-close-modal></div>
        <div class="modal-panel glass rounded-3xl p-6 sm:p-8 max-w-md w-full">
          <h3 class="text-xl font-bold text-slate-900 mb-5">Add product</h3>
          <div class="space-y-4">
            <div><label class="form-label">Product name</label><input id="ap-name" class="input-base" placeholder="e.g. Steel Water Bottle" /></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="form-label">Category</label>
                <select id="ap-category" class="input-base">
                  ${cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('')}
                  <option>General</option>
                </select></div>
              <div><label class="form-label">Warehouse</label>
                <select id="ap-warehouse" class="input-base"><option>Main Warehouse</option><option>East Depot</option></select></div>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="form-label">Stock</label><input id="ap-stock" type="number" min="0" value="50" class="input-base" /></div>
              <div><label class="form-label">Min stock</label><input id="ap-min" type="number" min="0" value="20" class="input-base" /></div>
              <div><label class="form-label">Price</label><input id="ap-price" type="number" min="0" step="0.01" value="10" class="input-base" /></div>
            </div>
            <div><label class="form-label">Supplier</label>
              <select id="ap-supplier" class="input-base">
                ${state.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
              </select></div>
            <div class="flex gap-3 mt-2 justify-end">
              <button class="btn btn-ghost" data-close-modal>Cancel</button>
              <button class="btn btn-primary" data-action="submit-add">＋ Add product</button>
            </div>
          </div>
        </div>
      </div>`;
    const div = document.createElement('div');
    div.id = 'add-modal-root';
    div.innerHTML = html;
    document.body.appendChild(div);
  }

  async function submitAddProduct() {
    const name = $('ap-name').value.trim();
    if (!name) { toast('Product name is required', 'error'); return; }
    const product = {
      name,
      category: $('ap-category').value,
      warehouse: $('ap-warehouse').value,
      currentStock: Number($('ap-stock').value) || 0,
      minimumStock: Number($('ap-min').value) || 0,
      price: Number($('ap-price').value) || 0,
      supplierId: Number($('ap-supplier').value)
    };
    try {
      await SmartStockAPI.createProduct(product);
      $('add-modal-root').remove();
      toast(`${name} added to inventory`, 'success');
      await loadAll();
      renderInventory();
    } catch (err) {
      toast(err.message || 'Failed to add product', 'error');
    }
  }

  /* ---------------- Record sale modal ---------------- */
  function renderRecordSaleModal(productId = null) {
    const opts = state.products.map((p) =>
      `<option value="${p.id}" ${Number(productId) === p.id ? 'selected' : ''}>${escapeHtml(p.name)} (in stock: ${p.currentStock})</option>`
    ).join('');
    const html = `
      <div id="record-sale-modal" class="modal">
        <div class="modal-backdrop" data-close-modal></div>
        <div class="modal-panel glass rounded-3xl p-6 sm:p-8 max-w-md w-full">
          <h3 class="text-xl font-bold text-slate-900 mb-1">Record a sale</h3>
          <p class="text-sm text-slate-500 mb-5">Sales automatically consume inventory for the next forecast.</p>
          <div class="space-y-4">
            <div><label class="form-label">Product</label>
              <select id="sale-product" class="input-base">${opts}</select></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="form-label">Quantity</label><input id="sale-qty" type="number" min="1" step="1" value="1" class="input-base" /></div>
              <div><label class="form-label">Date</label><input id="sale-date" type="date" value="${new Date().toISOString().slice(0, 10)}" class="input-base" /></div>
            </div>
            <div class="flex gap-3 mt-2 justify-end">
              <button class="btn btn-ghost" data-close-modal>Cancel</button>
              <button class="btn btn-primary" data-action="submit-sale">＋ Record sale</button>
            </div>
          </div>
        </div>
      </div>`;
    const div = document.createElement('div');
    div.id = 'record-sale-root';
    div.innerHTML = html;
    document.body.appendChild(div);
  }

  async function submitSale() {
    const productId = Number($('sale-product').value);
    const quantity = Number($('sale-qty').value);
    const date = $('sale-date').value || undefined;
    if (!productId || !quantity || quantity <= 0) { toast('Enter a valid quantity', 'error'); return; }
    const btn = document.querySelector('[data-action="submit-sale"]');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await SmartStockAPI.recordSale({ productId, quantity, date });
      $('record-sale-root').remove();
      toast('Sale recorded — inventory updated', 'success');
      await loadAll();
      switchSection(state.section);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '＋ Record sale';
      toast(err.message || 'Failed to record sale', 'error');
    }
  }

  /* ---------------- Adjust stock modal ---------------- */
  function renderAdjustStockModal(productId) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    const html = `
      <div id="adjust-modal" class="modal">
        <div class="modal-backdrop" data-close-modal></div>
        <div class="modal-panel glass rounded-3xl p-6 sm:p-8 max-w-md w-full">
          <h3 class="text-xl font-bold text-slate-900 mb-1">Adjust stock</h3>
          <p class="text-sm text-slate-500 mb-5">${escapeHtml(p.name)} · currently <b>${fmtInt(p.currentStock)}</b> units (min ${p.minimumStock})</p>
          <div class="space-y-4">
            <div><label class="form-label">New stock level</label><input id="adj-stock" type="number" min="0" step="1" value="${p.currentStock}" class="input-base" /></div>
            <div class="flex gap-3 mt-2 justify-end">
              <button class="btn btn-ghost" data-close-modal>Cancel</button>
              <button class="btn btn-primary" data-action="submit-adjust" data-id="${p.id}">✓ Save stock</button>
            </div>
          </div>
        </div>
      </div>`;
    const div = document.createElement('div');
    div.id = 'adjust-root';
    div.innerHTML = html;
    document.body.appendChild(div);
  }

  async function submitAdjust() {
    const btn = document.querySelector('[data-action="submit-adjust"]');
    const productId = Number(btn.dataset.id);
    const currentStock = Number($('adj-stock').value);
    if (Number.isNaN(currentStock) || currentStock < 0) { toast('Enter a valid stock level', 'error'); return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await SmartStockAPI.updateProduct(productId, { currentStock });
      $('adjust-root').remove();
      toast('Inventory updated', 'success');
      await loadAll();
      switchSection(state.section);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '✓ Save stock';
      toast(err.message || 'Failed to update stock', 'error');
    }
  }

  /* ---------------- Login ---------------- */
  async function handleLogin(email, password) {
    const statusEl = $('login-status');
    const submitBtn = $('login-form').querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const label = submitBtn.querySelector('.btn-label');
    const spinner = submitBtn.querySelector('.btn-spinner');
    label.textContent = 'Signing in…';
    spinner.classList.remove('hidden');

    try {
      const result = await SmartStockAPI.login(email, password);
      state.user = result.user;
      localStorage.setItem('ssai_user', JSON.stringify(state.user));
      if (result.token) localStorage.setItem('ssai_token', result.token);
      if (result.demo) {
        $('demo-mode').classList.remove('hidden');
      } else {
        $('demo-mode').classList.add('hidden');
      }
      showApp();
    } catch (err) {
      label.textContent = 'Sign in';
      spinner.classList.add('hidden');
      submitBtn.disabled = false;
      statusEl.textContent = err.message || 'Sign in failed';
    }
  }

  function showApp() {
    $('login-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    $('user-name').textContent = state.user.name || 'User';
    $('user-role').textContent = state.user.role || 'member';
    $('user-avatar').textContent = (state.user.name || 'U').charAt(0).toUpperCase();
    loadAll().then(() => switchSection('dashboard'));
  }

  function showLogin() {
    $('app-view').classList.add('hidden');
    $('login-view').classList.remove('hidden');
  }

  /* ---------------- Boot & events ---------------- */
  function bindEvents() {
    $('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      handleLogin($('login-email').value, $('login-password').value);
    });

    document.querySelectorAll('.role-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('login-email').value = btn.dataset.email;
        $('login-password').value = 'password123';
        document.querySelectorAll('.role-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        handleLogin(btn.dataset.email, 'password123');
      });
    });

    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchSection(btn.dataset.section));
    });

    $('menu-btn').addEventListener('click', openSidebar);
    $('sidebar-overlay').addEventListener('click', closeSidebar);

    $('bell-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = $('bell-dropdown');
      dd.classList.toggle('hidden');
      $('user-dropdown').classList.add('hidden');
      renderNotifs();
      state.alerts.forEach((a) => state.notifSeen.add(a.id));
      updateNotifBadges();
    });

    $('user-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('user-dropdown').classList.toggle('hidden');
      $('bell-dropdown').classList.add('hidden');
    });

    $('logout-btn').addEventListener('click', () => {
      localStorage.removeItem('ssai_user');
      localStorage.removeItem('ssai_token');
      showLogin();
    });

    document.addEventListener('click', (e) => {
      if (!$('user-dropdown').contains(e.target) && e.target.closest('#user-btn') === null) {
        $('user-dropdown').classList.add('hidden');
      }
      if (!$('bell-dropdown').contains(e.target) && e.target.closest('#bell-btn') === null) {
        $('bell-dropdown').classList.add('hidden');
      }
      const modal = $('approve-modal');
      if (modal && !modal.classList.contains('hidden') && e.target.dataset.closeModal !== undefined) closeModal();
      if (e.target.dataset.closeModal !== undefined) {
        ['add-modal-root', 'record-sale-root', 'adjust-root'].forEach((id) => {
          const root = $(id);
          if (root && root.contains(e.target)) root.remove();
        });
      }
    });

    document.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const kind = action.dataset.action;

      if (kind === 'goto-predictions') { state.recFilter = 'pending'; switchSection('predictions'); }
      if (kind === 'rec-filter') { state.recFilter = action.dataset.filter; renderPredictions(); }
      if (kind === 'run-agent' || action.id === 'dash-run-agent') { runAgent(action); }
      if (kind === 'decide') {
        const rec = state.predictions.find((r) => r.productId === Number(action.dataset.id));
        if (rec) openApproval(rec, action.dataset.decision);
      }
      if (kind === 'open-add-product') renderAddProductModal();
      if (kind === 'submit-add') submitAddProduct();
      if (kind === 'open-record-sale') renderRecordSaleModal();
      if (kind === 'record-sale-for') renderRecordSaleModal(Number(action.dataset.id));
      if (kind === 'submit-sale') submitSale();
      if (kind === 'adjust') renderAdjustStockModal(Number(action.dataset.id));
      if (kind === 'submit-adjust') submitAdjust();
    });

    $('confirm-approve-btn').addEventListener('click', confirmApproval);

    $('global-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.invQuery = e.target.value.trim();
        state.invCategory = 'all';
        switchSection('inventory');
        e.target.value = '';
      }
    });
  }

  async function runAgent(btn) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '⏳ Analyzing…';
    try {
      await SmartStockAPI.runAnalysis();
      await loadAll();
      btn.disabled = false;
      btn.textContent = '⚡ Run agent analysis';
      toast('Inventory agent analysis complete — recommendations refreshed', 'success');
      switchSection(state.section);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      toast(err.message || 'Agent analysis failed', 'error');
    }
  }

  (function boot() {
    bindEvents();
    const saved = localStorage.getItem('ssai_user');
    if (saved) {
      try {
        state.user = JSON.parse(saved);
        if (SmartStockAPI) SmartStockAPI.setToken(localStorage.getItem('ssai_token'));
      } catch (err) { /* fall through */ }
    }
    if (state.user) showApp(); else showLogin();
  })();
})();
