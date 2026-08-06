const path = require('path');
const { Store } = require('./store');
const config = require('../config');

let instance = null;

function getStore(filePath = path.join(config.dataDir, 'db.json')) {
  if (!instance) instance = new Store(filePath);
  return instance;
}

module.exports = { getStore };
