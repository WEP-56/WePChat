/* WepChat - 已生成图片结果续接 */
'use strict';

(() => {
  window.WepChatAppMethodsImageRecovery = {
    async retryImageResult(msg) {
      const recovery = msg && msg.imageRecovery;
      if (!recovery || this.generating) return;
      const baseProvider = this.providers.find(p => p.id === recovery.providerId) || this.imageProvider;
      if (!baseProvider) {
        U.toast('原图片提供商已不存在');
        return;
      }
      const provider = Object.assign({}, baseProvider, {
        baseUrl: String(baseProvider.imageBaseUrl || baseProvider.baseUrl || '').trim(),
        apiKey: baseProvider.imageApiKey || baseProvider.apiKey || ''
      });
      this.generating = true;
      this.abortCtl = new AbortController();
      msg.status = 'streaming';
      msg.error = '';
      try {
        const result = await ImageAPI.recover({
          provider,
          model: recovery.model,
          resultUrl: recovery.resultUrl,
          pollUrl: recovery.pollUrl,
          format: recovery.format,
          settings: { outputFormat: recovery.format },
          signal: this.abortCtl.signal,
          onStatus: info => this.connectionStatus(Object.assign({ source: '图片结果续接' }, info || {}))
        });
        const saved = this.saveGeneratedImages(result.images || [], recovery.args || {}, provider, recovery.model);
        if (!saved.length) throw NetStability.createError('IMAGE-RESULT-MISSING', '续接成功，但仍没有可用图片');
        msg.images = (msg.images || []).concat(saved);
        msg.content = msg.content || ('已找回 ' + saved.length + ' 张图片，已保存到工作区 images/。');
        msg.status = 'done';
        delete msg.imageRecovery;
        this.connectionStatus({ state: 'recovered', source: '图片结果续接', code: 'IMAGE-RECOVERED', message: '已找回提供商生成的图片' });
      } catch (e) {
        msg.status = 'done';
        if (!(e && e.code === 'NET-ABORTED')) {
          const err = this.connectionError(e, '图片结果续接', e && e.code || 'IMAGE-RECOVERY-FAILED');
          msg.error = this.connectionErrorText(err);
        }
        if (e && e.resultUrl) recovery.resultUrl = e.resultUrl;
        if (e && e.pollUrl) recovery.pollUrl = e.pollUrl;
      } finally {
        this.generating = false;
        this.abortCtl = null;
        await this.flushSessionPersist(1200);
      }
    }
  };
})();
