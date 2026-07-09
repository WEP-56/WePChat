'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function idForPath(absPath) {
  return 'ws_' + crypto.createHash('sha1').update(absPath.toLowerCase()).digest('hex').slice(0, 12);
}

function displayName(absPath, name) {
  return String(name || '').trim() || path.basename(absPath) || absPath;
}

function createWorkspaceRegistry(entries) {
  const byId = new Map();
  const byPath = new Map();

  (entries || []).forEach(entry => {
    const abs = path.resolve(String(entry.path || ''));
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (err) {
      throw new Error(`Workspace does not exist: ${abs}`);
    }
    if (!stat.isDirectory()) throw new Error(`Workspace is not a directory: ${abs}`);

    const real = fs.realpathSync(abs);
    const id = entry.id || idForPath(real);
    const ws = {
      id,
      name: displayName(real, entry.name),
      path: real
    };
    byId.set(id, ws);
    byPath.set(real.toLowerCase(), ws);
  });

  return {
    list() {
      return Array.from(byId.values()).map(ws => Object.assign({}, ws));
    },
    get(id) {
      const ws = byId.get(String(id || ''));
      return ws ? Object.assign({}, ws) : null;
    },
    require(id) {
      const ws = this.get(id);
      if (!ws) throw new Error(`Unknown workspace: ${id}`);
      return ws;
    },
    isAllowed(candidate) {
      const abs = fs.realpathSync(path.resolve(candidate));
      return byPath.has(abs.toLowerCase());
    }
  };
}

module.exports = { createWorkspaceRegistry };
