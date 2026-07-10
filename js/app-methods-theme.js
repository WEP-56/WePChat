/* WepChat - 主题设置方法 */
'use strict';

(() => {
  window.WepChatAppMethodsTheme = {
    applyTheme() {
      WepChatThemeSystem.apply(this.settings);
    },
    setThemeStyle(value) {
      this.settings.themeStyle = WepChatThemeSystem.normalizeStyle(value);
      this.persistSettings();
    }
  };
})();
