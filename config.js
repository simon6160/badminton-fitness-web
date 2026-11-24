/**
 * 羽球員體適能訓練管理網站 — 全域團隊設定檔
 * ------------------------------------------------------------
 * 1. 預設零設定即可運作（資料自動保存於瀏覽器 localStorage）。
 * 2. 若需「全隊手機跨裝置雲端同步」，請依 README.md 部署免費的
 *    Google Apps Script，並將產生的 Web App 網址貼入 CLOUD_API_URL。
 */
window.TEAM_CONFIG = {
  // 網站顯示的球隊名稱
  TEAM_NAME: '羽球專項體適能訓練中心',

  // 選填：Google Apps Script Web App 網址（留空即使用單機本機儲存模式）
  // 範例：'https://script.google.com/macros/s/XXXXXXXXXXXX/exec'
  CLOUD_API_URL: '',

  // 選填：教練管理端簡易密碼（留空表示不鎖密碼，一鍵即可切換）
  // 範例：'8888'
  COACH_PASSCODE: ''
};
