'use strict';

const crypto = require('crypto');

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function textInput(text) {
  return {
    type: 'text',
    text: String(text == null ? '' : text),
    text_elements: []
  };
}

function sanitizeThread(thread) {
  if (!thread) return null;
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

class RemoteProtocol {
  constructor(options) {
    this.codex = options.codex;
    this.workspaces = options.workspaces;
    this.codexDefaults = options.codexDefaults || {};
    this.clients = new Set();
    this.sessions = new Map();
    this.activeTurnByThread = new Map();
    this.approvals = new Map();
    this.events = [];
    this.eventSeq = 0;

    if (this.codex) {
      this.codex.on('notification', msg => this._onCodexNotification(msg));
      this.codex.on('serverRequest', msg => this._onCodexServerRequest(msg));
      this.codex.on('exit', info => this.emit('remote.codex.exit', info));
      this.codex.on('error', err => this.emit('remote.codex.error', { error: err.message }));
    }
  }

  addClient(ws) {
    this.clients.add(ws);
  }

  removeClient(ws) {
    this.clients.delete(ws);
  }

  send(ws, payload) {
    ws.send(payload);
  }

  emit(type, payload) {
    const event = Object.assign({ type, seq: ++this.eventSeq, at: Date.now() }, payload || {});
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    this.clients.forEach(ws => ws.send(event));
  }

  async listThreads(workspaceId, options) {
    this._requireCodex();
    const ws = this.workspaces.require(workspaceId);
    return this.codex.request('thread/list', {
      cwd: ws.path,
      sortKey: 'recency_at',
      sortDirection: 'desc',
      limit: options && options.limit || 30
    });
  }

  async handleClientMessage(ws, msg) {
    const id = msg.id || null;
    try {
      switch (msg.type) {
        case 'remote.ping':
          this._reply(ws, id, { pong: true, at: Date.now() });
          return;
        case 'remote.events.replay':
          this._reply(ws, id, {
            events: this.events.filter(ev => ev.seq > Number(msg.afterSeq || 0))
          });
          return;
        case 'remote.threads.list':
          this._reply(ws, id, await this._listThreadsMessage(msg));
          return;
        case 'remote.thread.start':
          this._reply(ws, id, await this._startThread(msg));
          return;
        case 'remote.thread.resume':
          this._reply(ws, id, await this._resumeThread(msg));
          return;
        case 'remote.thread.read':
          this._reply(ws, id, await this._readThread(msg));
          return;
        case 'remote.turn.start':
          this._reply(ws, id, await this._startTurn(msg));
          return;
        case 'remote.turn.steer':
          this._reply(ws, id, await this._steerTurn(msg));
          return;
        case 'remote.turn.interrupt':
          this._reply(ws, id, await this._interruptTurn(msg));
          return;
        case 'remote.approval.respond':
          this._reply(ws, id, await this._respondApproval(msg));
          return;
        default:
          throw new Error(`Unknown remote message type: ${msg.type}`);
      }
    } catch (err) {
      this._replyError(ws, id, err);
    }
  }

  _reply(ws, id, result) {
    if (!id) return;
    ws.send({ type: 'response', id, ok: true, result });
  }

  _replyError(ws, id, err) {
    const body = { type: 'response', id, ok: false, error: err && err.message || String(err) };
    if (id) ws.send(body);
    else ws.send({ type: 'error', error: body.error });
  }

  _requireCodex() {
    if (!this.codex || !this.codex.ready) throw new Error('Codex app-server is not ready');
  }

  _workspaceFromMessage(msg) {
    const workspaceId = msg.workspaceId || (msg.remote && msg.remote.workspaceId);
    return workspaceId ? this.workspaces.require(workspaceId) : null;
  }

  _threadParamsForWorkspace(ws) {
    const params = {
      cwd: ws.path,
      approvalPolicy: this.codexDefaults.approvalPolicy || 'on-request',
      sandbox: this.codexDefaults.sandbox || 'workspace-write',
      threadSource: 'wepchat-host'
    };
    if (this.codexDefaults.model) params.model = this.codexDefaults.model;
    return params;
  }

  async _listThreadsMessage(msg) {
    const result = await this.listThreads(msg.workspaceId, { limit: msg.limit || 30 });
    return {
      data: (result.data || []).map(sanitizeThread),
      nextCursor: result.nextCursor || null,
      backwardsCursor: result.backwardsCursor || null
    };
  }

  async _startThread(msg) {
    this._requireCodex();
    const ws = this._workspaceFromMessage(msg);
    if (!ws) throw new Error('workspaceId is required');
    const result = await this.codex.request('thread/start', this._threadParamsForWorkspace(ws));
    const thread = result.thread;
    const hostSessionId = newId('rmt');
    this.sessions.set(hostSessionId, {
      hostSessionId,
      workspaceId: ws.id,
      workspacePath: ws.path,
      codexThreadId: thread.id,
      activeTurnId: ''
    });
    this.emit('remote.thread.started', {
      hostSessionId,
      workspaceId: ws.id,
      thread: sanitizeThread(thread)
    });
    return {
      hostSessionId,
      workspace: ws,
      thread: sanitizeThread(thread),
      codex: {
        model: result.model,
        modelProvider: result.modelProvider,
        approvalPolicy: result.approvalPolicy,
        sandbox: result.sandbox
      }
    };
  }

  async _resumeThread(msg) {
    this._requireCodex();
    if (!msg.threadId) throw new Error('threadId is required');
    const ws = this._workspaceFromMessage(msg);
    const params = { threadId: msg.threadId };
    if (ws) params.cwd = ws.path;
    const result = await this.codex.request('thread/resume', params);
    const thread = result.thread;
    const hostSessionId = msg.hostSessionId || newId('rmt');
    this.sessions.set(hostSessionId, {
      hostSessionId,
      workspaceId: ws && ws.id || '',
      workspacePath: ws && ws.path || thread.cwd || '',
      codexThreadId: thread.id,
      activeTurnId: ''
    });
    this.emit('remote.thread.resumed', {
      hostSessionId,
      workspaceId: ws && ws.id || '',
      thread: sanitizeThread(thread)
    });
    return {
      hostSessionId,
      workspace: ws,
      thread: sanitizeThread(thread),
      turns: (thread.turns || [])
    };
  }

  async _readThread(msg) {
    this._requireCodex();
    if (!msg.threadId) throw new Error('threadId is required');
    const result = await this.codex.request('thread/read', {
      threadId: msg.threadId,
      includeTurns: msg.includeTurns !== false
    });
    return result;
  }

  async _startTurn(msg) {
    this._requireCodex();
    if (!msg.threadId) throw new Error('threadId is required');
    const text = msg.text != null ? msg.text : msg.prompt;
    if (!String(text || '').trim()) throw new Error('text is required');
    const params = {
      threadId: msg.threadId,
      input: [textInput(text)]
    };
    if (msg.clientUserMessageId) params.clientUserMessageId = msg.clientUserMessageId;
    const ws = this._workspaceFromMessage(msg);
    if (ws) params.cwd = ws.path;
    const result = await this.codex.request('turn/start', params);
    return result;
  }

  async _steerTurn(msg) {
    this._requireCodex();
    if (!msg.threadId) throw new Error('threadId is required');
    const expectedTurnId = msg.expectedTurnId || this.activeTurnByThread.get(msg.threadId);
    if (!expectedTurnId) throw new Error('expectedTurnId is required when no active turn is known');
    const text = msg.text != null ? msg.text : msg.prompt;
    if (!String(text || '').trim()) throw new Error('text is required');
    return this.codex.request('turn/steer', {
      threadId: msg.threadId,
      expectedTurnId,
      clientUserMessageId: msg.clientUserMessageId || null,
      input: [textInput(text)]
    });
  }

  async _interruptTurn(msg) {
    this._requireCodex();
    if (!msg.threadId) throw new Error('threadId is required');
    const turnId = msg.turnId || this.activeTurnByThread.get(msg.threadId);
    if (!turnId) throw new Error('turnId is required when no active turn is known');
    return this.codex.request('turn/interrupt', { threadId: msg.threadId, turnId });
  }

  async _respondApproval(msg) {
    if (!msg.approvalId) throw new Error('approvalId is required');
    const approval = this.approvals.get(msg.approvalId);
    if (!approval) throw new Error(`Unknown approval: ${msg.approvalId}`);
    const decision = msg.decision || 'decline';
    if (!['accept', 'decline', 'cancel', 'acceptForSession'].includes(decision)) {
      throw new Error(`Unsupported approval decision: ${decision}`);
    }
    this.approvals.delete(msg.approvalId);
    this.codex.respond(approval.codexRequestId, { decision });
    this.emit('remote.approval.resolved', {
      approvalId: msg.approvalId,
      decision,
      threadId: approval.threadId,
      turnId: approval.turnId,
      itemId: approval.itemId
    });
    return { approvalId: msg.approvalId, decision };
  }

  _onCodexNotification(msg) {
    const method = msg.method;
    const params = msg.params || {};
    if (method === 'turn/started') {
      const turnId = params.turn && params.turn.id;
      if (params.threadId && turnId) this.activeTurnByThread.set(params.threadId, turnId);
      this.emit('remote.turn.started', { threadId: params.threadId, turn: params.turn });
      return;
    }
    if (method === 'turn/completed') {
      const turnId = params.turn && params.turn.id;
      if (params.threadId && this.activeTurnByThread.get(params.threadId) === turnId) {
        this.activeTurnByThread.delete(params.threadId);
      }
      this.emit('remote.turn.completed', { threadId: params.threadId, turn: params.turn });
      return;
    }
    if (method === 'item/agentMessage/delta') {
      this.emit('remote.message.delta', params);
      return;
    }
    if (method === 'item/commandExecution/outputDelta') {
      this.emit('remote.command.output.delta', params);
      return;
    }
    if (method === 'item/started') {
      this.emit('remote.item.started', params);
      return;
    }
    if (method === 'item/completed') {
      this.emit('remote.item.completed', params);
      return;
    }
    if (method === 'turn/diff/updated') {
      this.emit('remote.turn.diff.updated', params);
      return;
    }
    if (method === 'error' || method === 'warning' || method === 'configWarning') {
      this.emit(`remote.codex.${method}`, params);
    }
  }

  _onCodexServerRequest(msg) {
    const method = msg.method;
    const params = msg.params || {};
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const approvalId = newId('appr');
      this.approvals.set(approvalId, {
        approvalId,
        codexRequestId: msg.id,
        method,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId
      });
      this.emit('remote.approval.required', {
        approvalId,
        kind: method === 'item/commandExecution/requestApproval' ? 'command' : 'fileChange',
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        command: params.command || '',
        cwd: params.cwd || '',
        reason: params.reason || '',
        grantRoot: params.grantRoot || '',
        commandActions: params.commandActions || []
      });
      return;
    }
    this.emit('remote.serverRequest.unsupported', {
      codexRequestId: msg.id,
      method,
      params
    });
    this.codex.respondError(msg.id, -32010, `Unsupported server request: ${method}`);
  }
}

module.exports = { RemoteProtocol };
