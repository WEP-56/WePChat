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
    window.WepChatAppMethodsSessions,
    window.WepChatAppMethodsGeneration,
    window.WepChatAppMethodsWorkspace,
    window.WepChatAppMethodsPreview,
    window.WepChatAppMethodsStability,
    window.WepChatAppMethodsImageRecovery
  );
  Vue.createApp(options).mount('#app');
})();
