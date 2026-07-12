/* WepChat - 首次启动幻灯片引导 */
'use strict';

(() => {
  const LAST_PAGE = 3;

  window.WepChatAppMethodsOnboarding = {
    goToOnboardingPage(page) {
      const next = Math.max(0, Math.min(LAST_PAGE, Number(page) || 0));
      if (next === this.onboardingPage) return;
      this.onboardingDirection = next > this.onboardingPage ? 1 : -1;
      this.onboardingPage = next;
      this.lastBackAt = 0;
    },
    nextOnboardingPage() {
      if (this.onboardingPage >= LAST_PAGE) return this.finishOnboarding();
      this.goToOnboardingPage(this.onboardingPage + 1);
    },
    previousOnboardingPage() {
      this.goToOnboardingPage(this.onboardingPage - 1);
    },
    finishOnboarding() {
      this.settings.onboardingCompleted = true;
      this.onboardingOpen = false;
      this.lastBackAt = 0;
      this.persistSettings();
    },
    replayOnboarding() {
      this.onboardingDirection = 1;
      this.onboardingPage = 0;
      this.onboardingOpen = true;
      this.lastBackAt = 0;
    },
    openOnboardingLink(url) {
      U.openExternal(url);
    },
    onboardingTouchStart(event) {
      const touch = event && event.touches && event.touches[0];
      if (!touch) return;
      this.onboardingTouchX = touch.clientX;
      this.onboardingTouchY = touch.clientY;
    },
    onboardingTouchEnd(event) {
      const touch = event && event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - this.onboardingTouchX;
      const dy = touch.clientY - this.onboardingTouchY;
      this.onboardingTouchX = 0;
      this.onboardingTouchY = 0;
      if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.15) return;
      if (dx < 0 && this.onboardingPage < LAST_PAGE) this.nextOnboardingPage();
      else if (dx > 0 && this.onboardingPage > 0) this.previousOnboardingPage();
    }
  };
})();
