# Rules 白話對照

這份文件用白話方式說明 `Rules` 分頁每一欄在做什麼。

## 欄位對照

| 原欄位 | 白話名稱 | 用途 |
|---|---|---|
| `priority` | 優先順序 | 數字越小越先執行 |
| `siteMatch` | 來源站點 | 例如 `omjg`、`sft`、`yoshiwara-soap`、`Common` |
| `field` | 寫入欄位 | 目標欄位，例如 `v_name`、`v_stats`、`v_schedule` |
| `ruleType` | 處理方式 | 要怎麼抓資料（Regex、預設值、標籤等） |
| `pattern` | 判斷條件 | 要匹配的字串或正則 |
| `action` | 輸出結果 | 抓到後要寫入什麼內容 |
| `note` | 備註 | 規則說明 |

## siteMatch（來源站點）怎麼用

- `Common`：所有站都會套用。
- `omjg` / `sft` / `kiwami_g`：只在該站網址或內容命中時套用。
- `yoshiwara-soap`：只給吉原站專用規則。

## ruleType（處理方式）怎麼選

- `Regex_Extract`：從內容抓值，最常用。
- `Set_Default`：命中條件就直接給預設值。
- `Regex_Tag`：命中後加上屬性標籤（AF/3P/Line私約等）。
- `Regex_Level`：抓等級資訊。
- `HTML_Img_Tag`：靠 html 圖示關鍵字加標籤。

## 建議維護流程

1. 先新增 `note`，寫清楚「這條規則是為了哪個站、哪個欄位」。
2. `priority` 先留空白或大數字，確認成功後再調高優先順序。
3. 每次改動後跑 `Rules Check`。
4. 再跑 `自動同步`，看戰報是否有明顯 `missing`。
