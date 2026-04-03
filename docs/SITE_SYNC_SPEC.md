# Site Sync 規格（Yoasobi + Yoshiwara）

## 目標

1. `girls-list` / `schedule` 能抓到姓名與班表。
2. 能用 URL / 姓名 + 店名 對照到現有卡片。
3. 能補齊個人頁資料（屬性、數值、價格、等級）。

## Handler 註冊

- `core/site-sync-registry.js` 提供註冊與路由。
- `core/site-sync-yoasobi-heaven.js` 負責非 `yoshiwara-soap` 站點（含 girls-list）。
- `core/site-sync-yoshiwara-soap.js` 負責吉原站 7 天班表。

## Yoasobi 流程

1. 下載 `girls-list`。
2. 轉純文字並切 block（支援 `No.xxx`）。
3. 先抓出 name/store/stats/url/schedule。
4. 若資料不足或出現 `from/口コミ` 等字樣，進個人頁二段補抓。
5. 用 `findRecordIndex` 做 URL 優先匹配，找不到才用姓名+店名。
6. 更新既有列；缺失列記入 `missing`。

## Yoshiwara 流程

1. 固定輪詢 7 個 URL：
   - `/schedule/`
   - `/schedule/tomorrow.html`
   - `/schedule/in-2-days.html`
   - ...
   - `/schedule/in-6-days.html`
2. 每頁從 `/cast/` 卡片抓：
   - 姓名、年齡、數值、當日班表時間。
3. 以 `storeName + name/url` 對照資料庫列。
4. 將 7 天班表合併回 `v_schedule`，未命中列計入 `missing`。

## 個人頁屬性更新

- 已支援：透過 `extractCommonRuleData + Rules` 抓 `v_af / v_level / v_price / v_stats`。
- 建議：`Rules` 針對兩站各自維護 `v_af` 的 `Regex_Tag`，可降低站台小改版風險。

## 失敗判定與排查

看到 `找不到 xxx 的同步處理器` 時，檢查：

1. `manifest.coreFiles` 是否包含 3 個 site-sync 檔案 id。
2. `site-sync-registry.js` 是否先於兩個 handler 載入。
3. `Rules` 是否有 `System_AutoSync` 且 `action=Y`。
4. 站點代碼（`siteMatch`）拼字是否一致。
