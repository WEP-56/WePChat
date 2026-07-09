#!/usr/bin/env node
'use strict';

const { createConfig } = require('../lib/config');
const { createHostServer } = require('../lib/http-server');
const { createWorkspaceRegistry } = require('../lib/workspaces');
const { CodexClient } = require('../lib/codex-client');
const { RemoteProtocol } = require('../lib/remote-protocol');

const VERSION = '0.1.0';

function printHelp() {
  console.log(`WepChat Host ${VERSION}

Usage:
  wepchat-host [options]

Options:
  --lan                    Listen on 0.0.0.0 instead of 127.0.0.1.
  --host <addr>            Listen address. Overrides --lan.
  --port <port>            Listen port. Default: 8797.
  --workspace <path>       Register a workspace. Repeatable.
  --config <path>          Config file path. Default: ~/.wepchat-host/config.json.
  --codex <command>        Codex command. Default: codex.
  --model <model>          Codex model override.
  --approval <policy>      Approval policy. Default: on-request.
  --sandbox <mode>         Sandbox mode. Default: workspace-write.
  --no-codex               Start HTTP/WebSocket server without Codex app-server.
  --help                   Show this help.
  --version                Show version.

Examples:
  cd E:\\wepchat\\wepchat
  npx wepchat-host --lan

  wepchat-host --lan --workspace E:\\wepchat\\wepchat --workspace D:\\projects\\foo
`);
}

function parseArgs(argv) {
  const opts = { workspaces: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[++i];
    };
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-V') opts.version = true;
    else if (arg === '--lan') opts.lan = true;
    else if (arg === '--host') opts.host = next();
    else if (arg === '--port') opts.port = Number(next());
    else if (arg === '--workspace') opts.workspaces.push(next());
    else if (arg === '--config') opts.configPath = next();
    else if (arg === '--codex') opts.codexCommand = next();
    else if (arg === '--model') opts.model = next();
    else if (arg === '--approval') opts.approvalPolicy = next();
    else if (arg === '--sandbox') opts.sandbox = next();
    else if (arg === '--no-codex') opts.noCodex = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function localAddresses(port) {
  const os = require('os');
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(name => {
    (nets[name] || []).forEach(info => {
      if (info.family === 'IPv4' && !info.internal) out.push(`http://${info.address}:${port}`);
    });
  });
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }

  const config = createConfig(args);
  const workspaces = createWorkspaceRegistry(config.workspaces);
  let codex = null;

  if (!args.noCodex) {
    codex = new CodexClient({
      command: config.codex.command,
      version: VERSION
    });
    codex.on('stderr', line => {
      if (config.verbose) console.error(`[codex] ${line}`);
    });
    await codex.start();
  }

  const protocol = new RemoteProtocol({
    codex,
    workspaces,
    codexDefaults: config.codex
  });

  const server = createHostServer({
    host: config.bind,
    port: config.port,
    token: config.token,
    workspaces,
    codex,
    protocol,
    version: VERSION
  });

  await server.listen();

  const local = `http://127.0.0.1:${config.port}`;
  const lan = localAddresses(config.port);
  console.log('');
  console.log(`WepChat Host ${VERSION}`);
  console.log('');
  console.log(`Local:  ${local}`);
  if (config.bind !== '127.0.0.1') {
    lan.forEach(url => console.log(`LAN:    ${url}`));
  }
  console.log(`Token:  ${config.token}`);
  console.log('');
  console.log('Workspaces:');
  workspaces.list().forEach(ws => console.log(`  - ${ws.name}  ${ws.path}`));
  console.log('');
  console.log('WepChat remote URL:');
  console.log(`  ${local}?token=${encodeURIComponent(config.token)}`);
  if (config.bind !== '127.0.0.1' && lan[0]) {
    console.log(`  ${lan[0]}?token=${encodeURIComponent(config.token)}`);
  }
  console.log('');

  const shutdown = async () => {
    console.log('\nStopping WepChat Host...');
    await server.close();
    if (codex) codex.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error(`wepchat-host: ${err && err.message || err}`);
  process.exit(1);
});
