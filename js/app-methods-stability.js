/* WepChat - connection status UI */
'use strict';

(() => {
  window.WepChatAppMethodsStability = {
    handleNetworkOffline() {
      this.connectionStatus({ state: 'error', source: '系统网络', code: 'NET-OFFLINE', message: '设备已离线，当前任务将等待连接恢复' });
    },
    handleNetworkOnline() {
      this.connectionStatus({ state: 'recovered', source: '系统网络', code: 'NET-RECOVERED', message: '设备网络已恢复' });
    },
    connectionStatus(info) {
      info = info || {};
      clearTimeout(this.connectionNoticeTimer);
      const recovered = info.state === 'connected' || info.state === 'recovered';
      const progress = info.state === 'progress';
      this.connectionNotice = {
        visible: true,
        level: recovered ? 'ok' : (progress ? 'info' : 'error'),
        source: info.source || '',
        code: info.code || (recovered ? 'NET-RECOVERED' : 'NET-CONNECT'),
        message: info.message || (recovered ? '连接已恢复' : '网络连接异常'),
        attempt: Number(info.attempt) || 0,
        max: Number(info.max) || 0,
        progress: info.progress || ''
      };
      if (recovered) {
        this.connectionNoticeTimer = setTimeout(() => this.clearConnectionNotice(), 2600);
      }
    },
    clearConnectionNotice() {
      clearTimeout(this.connectionNoticeTimer);
      this.connectionNoticeTimer = null;
      this.connectionNotice = Object.assign({}, this.connectionNotice, { visible: false });
    },
    connectionError(err, source, fallbackCode) {
      const e = NetStability.normalizeError(err, fallbackCode);
      this.connectionStatus({
        state: 'error',
        source: source || '',
        code: e.code,
        message: e.message,
        attempt: e.attempt || 0,
        max: e.max || 0
      });
      return e;
    },
    connectionErrorText(err, fallbackCode) {
      return NetStability.display(NetStability.normalizeError(err, fallbackCode));
    }
  };
})();
