const express = require('express');
const cors = require('cors');
const config = require('./config');
const { initStore, getMode } = require('./db/db');
const routes = require('./routes');
const { fail } = require('./utils/http');

function buildApp() {
  const app = express();

  app.disable('x-powered-by');

  const origins = config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: origins.includes('*') ? true : origins,
      credentials: true,
    })
  );

  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  app.get('/health', (req, res) => {
    res.json({
      success: true,
      service: 'smartstock-backend',
      status: 'ok',
      db: getMode(),
      aiService: config.aiServiceUrl || 'builtin',
      time: new Date().toISOString(),
    });
  });

  app.use(routes);

  app.use((req, res) => fail(res, 404, `Route not found: ${req.method} ${req.path}`));

  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return fail(res, 400, 'Invalid JSON body');
    }
    console.error('[error]', err);
    return fail(res, err.status || 500, err.expose ? err.message : 'Internal server error');
  });

  return app;
}

async function createApp() {
  await initStore();
  return buildApp();
}

async function start() {
  const app = await createApp();
  const server = app.listen(config.port, () => {
    console.log(`SmartStock AI backend running on http://localhost:${config.port} (db: ${getMode()})`);
  });
  server.on('error', (err) => {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  });
  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[server] fatal:', err);
    process.exit(1);
  });
}

module.exports = { createApp, buildApp, start };
