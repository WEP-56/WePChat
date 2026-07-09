'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.pnpm-store', '.yarn', '.cache']);
const MAX_FILE_ROWS = 800;

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
    },
    listFiles(id, options) {
      const ws = this.require(id);
      return listWorkspaceFiles(ws.path, options);
    }
  };
}

function listWorkspaceFiles(root, options) {
  options = options || {};
  const maxRows = Math.max(1, Math.min(Number(options.limit || MAX_FILE_ROWS) || MAX_FILE_ROWS, 3000));
  const rows = [];
  let truncated = false;

  function shouldSkip(abs, name) {
    if (SKIP_DIRS.has(name)) return true;
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    return rel === 'unpackage/cache' || rel.startsWith('unpackage/cache/');
  }

  function push(row) {
    if (rows.length >= maxRows) {
      truncated = true;
      return false;
    }
    rows.push(row);
    return true;
  }

  function walk(abs, rel) {
    let dirents = [];
    try {
      dirents = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      return;
    }
    dirents.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const ent of dirents) {
      const childAbs = path.join(abs, ent.name);
      if (ent.isDirectory() && shouldSkip(childAbs, ent.name)) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      let stat = null;
      try { stat = fs.statSync(childAbs); } catch (err) {}
      if (ent.isDirectory()) {
        if (!push({ type: 'folder', path: childRel, size: 0, mtime: stat ? stat.mtimeMs : 0 })) return;
        walk(childAbs, childRel);
        if (truncated) return;
      } else if (ent.isFile()) {
        if (!push({ type: 'file', path: childRel, size: stat ? stat.size : 0, mtime: stat ? stat.mtimeMs : 0 })) return;
      }
    }
  }

  walk(root, '');
  return { data: rows, truncated };
}

module.exports = { createWorkspaceRegistry };
