/* WepChat - Vue 应用入口 */
'use strict';

(async () => {
  /* 存储层先就绪（IndexedDB 预热 + localStorage 旧数据迁移）再挂载应用 */
  await Store.init();

  const options = window.WepChatAppOptions;
  options.methods = Object.assign(
    {},
    window.WepChatAppMethodsCore,
    window.WepChatAppMethodsTheme,
    window.WepChatAppMethodsOnboarding,
    window.WepChatAppMethodsLock,
    window.WepChatAppMethodsSessions,
    window.WepChatAppMethodsGeneration,
    window.WepChatAppMethodsWorkspace,
    window.WepChatAppMethodsPreview,
    window.WepChatAppMethodsStability,
    window.WepChatAppMethodsImageRecovery
  );
  const app = Vue.createApp(options);
  const liquidGlass = window.WepChatLiquidGlassVue;
  if (liquidGlass) {
    if (liquidGlass.default) app.use(liquidGlass.default);
    if (liquidGlass.GlassFilter) app.component('GlassFilter', liquidGlass.GlassFilter);
  }
  window.WepChatSyncLiquidGlassFilters = () => requestAnimationFrame(() => {
    const regions = {
      'wc-liquid-panel': ['-18%', '-18%', '136%', '136%'],
      'wc-liquid-composer': ['-6%', '-35%', '112%', '170%'],
      'wc-liquid-confirm': ['-8%', '-12%', '116%', '124%']
    };
    Object.keys(regions).forEach(id => {
      const filter = document.getElementById(id);
      const region = regions[id];
      if (!filter || !region) return;
      filter.setAttribute('x', region[0]);
      filter.setAttribute('y', region[1]);
      filter.setAttribute('width', region[2]);
      filter.setAttribute('height', region[3]);
    });
  });
  app.mount('#app');
  window.WepChatSyncLiquidGlassFilters();
})();
