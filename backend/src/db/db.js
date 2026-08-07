const path = require('path');
const { Store } = require('./store');
const { MongoStore } = require('./mongoStore');
const config = require('../config');

let instance = null;
let mode = 'file';

/**
 * Connect the data layer. Uses MongoDB when MONGO_URI is configured and
 * reachable; otherwise degrades gracefully to the local JSON file store so
 * the platform always boots and works end-to-end.
 */
async function initStore() {
  if (instance) return instance;

  if (config.mongoUri) {
    const mongo = new MongoStore(config.mongoUri, { dbName: config.mongoDbName });
    try {
      await mongo.init();
      instance = mongo;
      mode = 'mongo';
      const host = config.mongoUri.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, '').split('/')[0];
      console.log(`[db] connected to MongoDB at ${host} (db: ${config.mongoDbName})`);
      return instance;
    } catch (err) {
      console.warn(`[db] MongoDB unavailable (${err.message}); falling back to local file store.`);
      if (mongo.client) await mongo.close().catch(() => {});
    }
  }

  instance = new Store(path.join(config.dataDir, 'db.json'));
  mode = 'file';
  console.log('[db] using local JSON file store (no MongoDB configured or reachable)');
  return instance;
}

function getStore() {
  if (!instance) {
    instance = new Store(path.join(config.dataDir, 'db.json'));
    mode = 'file';
  }
  return instance;
}

function getMode() {
  return mode;
}

module.exports = { initStore, getStore, getMode };
