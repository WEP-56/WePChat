'use strict';

const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(data);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : '';
}

function authorized(req, url, token) {
  return bearer(req) === token || url.searchParams.get('token') === token;
}

function sanitizeThread(thread) {
  return {
    id: thread.id,
    sessionId: thread.sessionId,
    preview: thread.preview || '',
    name: thread.name || '',
    cwd: thread.cwd || '',
    status: thread.status || '',
    source: thread.source || '',
    createdAt: thread.createdAt || 0,
    updatedAt: thread.updatedAt || 0,
    recencyAt: thread.recencyAt || null
  };
}

function createHostServer(options) {
  const { host, port, token, workspaces, codex, protocol, version } = options;
  const clients = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'OPTIONS') {
      json(res, 204, {});
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, {
          ok: true,
          version,
          codex: !!(codex && codex.ready),
          workspaces: workspaces.list().length
        });
        return;
      }

      if (!authorized(req, url, token)) {
        json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/pairing') {
        json(res, 200, {
          ok: true,
          version,
          token,
          websocketPath: '/session',
          workspaces: workspaces.list()
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/workspaces') {
        json(res, 200, { ok: true, data: workspaces.list() });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/workspace-files') {
        const result = workspaces.listFiles(url.searchParams.get('workspaceId'), {
          limit: Number(url.searchParams.get('limit') || 800)
        });
        json(res, 200, { ok: true, data: result.data, truncated: !!result.truncated });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/threads') {
        const workspaceId = url.searchParams.get('workspaceId');
        const result = await protocol.listThreads(workspaceId, {
          limit: Number(url.searchParams.get('limit') || 30)
        });
        json(res, 200, {
          ok: true,
          data: (result.data || []).map(sanitizeThread),
          nextCursor: result.nextCursor || null,
          backwardsCursor: result.backwardsCursor || null
        });
        return;
      }

      json(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      json(res, 500, { ok: false, error: err && err.message || String(err) });
    }
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname !== '/session' || !authorized(req, url, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ].join('\r\n'));

    const ws = createWebSocketPeer(socket);
    clients.add(ws);
    protocol.addClient(ws);
    ws.onMessage = message => {
      let parsed;
      try {
        parsed = JSON.parse(message);
      } catch (err) {
        ws.send({ type: 'error', error: 'invalid json' });
        return;
      }
      protocol.handleClientMessage(ws, parsed);
    };
    ws.onClose = () => {
      clients.delete(ws);
      protocol.removeClient(ws);
    };
    ws.send({
      type: 'hello',
      version,
      workspaces: workspaces.list(),
      codex: !!(codex && codex.ready)
    });
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    close() {
      clients.forEach(ws => ws.close());
      return new Promise(resolve => server.close(resolve));
    }
  };
}

function createWebSocketPeer(socket) {
  let buffer = Buffer.alloc(0);
  let closed = false;
  const peer = {
    onMessage: null,
    onClose: null,
    send(payload) {
      if (closed) return;
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      socket.write(encodeFrame(0x1, Buffer.from(text)));
    },
    close() {
      if (closed) return;
      closed = true;
      try { socket.write(encodeFrame(0x8, Buffer.alloc(0))); } catch (err) {}
      try { socket.end(); } catch (err) {}
    }
  };

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = decodeFrame(buffer);
      if (!frame) break;
      buffer = buffer.slice(frame.consumed);
      if (frame.opcode === 0x8) {
        peer.close();
        break;
      }
      if (frame.opcode === 0x9) {
        socket.write(encodeFrame(0xA, frame.payload));
        continue;
      }
      if (frame.opcode === 0x1 && peer.onMessage) {
        peer.onMessage(frame.payload.toString('utf8'));
      }
    }
  });
  socket.on('close', () => {
    closed = true;
    if (peer.onClose) peer.onClose();
  });
  socket.on('error', () => {
    closed = true;
    if (peer.onClose) peer.onClose();
  });
  return peer;
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const b1 = buf[0];
  const b2 = buf[1];
  const opcode = b1 & 0x0f;
  const masked = (b2 & 0x80) !== 0;
  let len = b2 & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < off + 2) return null;
    len = buf.readUInt16BE(off);
    off += 2;
  } else if (len === 127) {
    if (buf.length < off + 8) return null;
    const high = buf.readUInt32BE(off);
    const low = buf.readUInt32BE(off + 4);
    len = high * 2 ** 32 + low;
    off += 8;
  }
  let mask;
  if (masked) {
    if (buf.length < off + 4) return null;
    mask = buf.slice(off, off + 4);
    off += 4;
  }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.slice(off, off + len));
  if (masked) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, consumed: off + len };
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
    head.writeUInt32BE(len >>> 0, 6);
  }
  return Buffer.concat([head, payload]);
}

module.exports = { createHostServer };
