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
    },
    setRealGlassEnabled(value) {
      this.settings.realGlassEnabled = value === true;
      if (!this.settings.realGlassEnabled) {
        this.liquidScrolling = false;
        if (this.liquidScrollTimer) clearTimeout(this.liquidScrollTimer);
        this.liquidScrollTimer = null;
      }
      this.persistSettings();
      if (this.settings.realGlassEnabled) {
        this.$nextTick(() => {
          if (window.WepChatSyncLiquidGlassFilters) window.WepChatSyncLiquidGlassFilters();
        });
      }
    }
  };
})();
