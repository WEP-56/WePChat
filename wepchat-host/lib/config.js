'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultConfigPath() {
  return path.join(os.homedir(), '.wepchat-host', 'config.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw new Error(`Failed to read config ${file}: ${err.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function randomToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function normalizeWorkspaceEntry(entry) {
  if (typeof entry === 'string') return { path: entry };
  return entry && typeof entry === 'object' ? entry : null;
}

function createConfig(args) {
  const configPath = args.configPath ? path.resolve(args.configPath) : defaultConfigPath();
  const fileConfig = readJson(configPath);
  const shouldPersist = !fileConfig.token;
  const token = fileConfig.token || randomToken();

  if (shouldPersist) {
    writeJson(configPath, Object.assign({}, fileConfig, { token }));
  }

  const cliWorkspaces = (args.workspaces || []).map(p => ({ path: p }));
  const fileWorkspaces = Array.isArray(fileConfig.workspaces)
    ? fileConfig.workspaces.map(normalizeWorkspaceEntry).filter(Boolean)
    : [];
  const workspaces = cliWorkspaces.length ? cliWorkspaces : fileWorkspaces;
  if (!workspaces.length) workspaces.push({ path: process.cwd() });

  const bind = args.host || (args.lan ? '0.0.0.0' : (fileConfig.bind || '127.0.0.1'));
  const port = Number(args.port || fileConfig.port || 8797);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port value');

  const codexFile = fileConfig.codex || {};
  return {
    configPath,
    bind,
    port,
    token,
    verbose: !!fileConfig.verbose,
    workspaces,
    codex: {
      command: args.codexCommand || codexFile.command || 'codex',
      model: args.model || codexFile.model || '',
      approvalPolicy: args.approvalPolicy || codexFile.approvalPolicy || 'on-request',
      sandbox: args.sandbox || codexFile.sandbox || 'workspace-write'
    }
  };
}

module.exports = { createConfig };
