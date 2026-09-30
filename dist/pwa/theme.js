// 全域配色。放在 <head> 同步執行，第一次繪製前就套上 data-theme，避免先閃出另一套顏色。
// 配色只存在目前瀏覽器／網站來源，不屬於計畫，也不隨設定備份搬移。
(function () {
  const THEMES = ['pastel', 'night', 'classic'];
  const STORAGE_KEY = 'retirement-theme';
  // v9.2.0–v9.3.x 只有 MC 圖表能選色系；沿用那個選擇，升級後畫面不會突然換掉。
  const LEGACY_KEY = 'retirement-mc-chart-palette';
  // 與 styles.css 各主題的 --bg 一致：瀏覽器網址列／PWA 標題列跟著換色。
  const BAR_COLORS = { pastel: '#eef2f6', night: '#16212b', classic: '#091512' };
  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function stored() {
    const saved = read(STORAGE_KEY);
    if (THEMES.includes(saved)) return saved;
    const legacy = read(LEGACY_KEY);
    return THEMES.includes(legacy) ? legacy : 'pastel';
  }
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLORS[theme]);
  }
  function set(theme) {
    if (!THEMES.includes(theme)) return false;
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* 無法保存時本次仍套用。 */
    }
    return true;
  }
  apply(stored());
  globalThis.RetirementTheme = { THEMES, get: () => document.documentElement.dataset.theme, set };
})();
