# 打卡工時（GPS 上班打卡）

iPhone「捷徑」在抵達／離開工作地點時，自動把一筆打卡寫進**私人** GitHub 存放庫（例如 `gps-clock-data`）的 `punches/` 資料夾。
這個網頁讀取那些紀錄，配對成工作時段，算出每月工時和預估薪資；也可以用手機 GPS 在網頁上手動打卡。

- 純前端、沒有任何套件、沒有 build。程式在這個公開存放庫，**紀錄只存在你的私人存放庫**。
- GitHub Token 只存在手機的 localStorage。Token 請用 Fine-grained token，只給紀錄存放庫的 Contents 讀寫權限。
- 網址（開啟 GitHub Pages 後）：`https://raykuan80-design.github.io/for-claude-using/gps-clock/`

## 資料格式

紀錄存放庫裡：

| 路徑 | 內容 |
|---|---|
| `punches/*.csv` | 打卡紀錄，每個檔案一行或多行 `yyyy-MM-dd HH:mm:ss,上班或下班,地點[,手動]` |
| `gps-clock-settings.json` | 地點（名稱、時薪、顏色、座標、範圍）與配對規則 |

捷徑寫入的檔名是 `punches/yyyyMMdd-HHmmss.csv`；網頁打卡是 `punches/yyyyMMdd-HHmmss-in|out-m.csv`；匯入是 `punches/import-….csv`。
去重用「時間＋類型＋地點」。

## 工時配對規則（`src/core/pairing.js`）

依地點分組、照時間排序（同一秒先處理下班）：

1. 上班＋下班配成一段。
2. GPS 飄移：下班後 `mergeGapMinutes`（預設 10）分鐘內同地點又上班，接回前一段。
3. 上班中又來上班 → 忽略；下班後 `mergeGapMinutes` 內又下班 → 延後下班時間。
4. 少於 `minSessionMinutes`（預設 5）分鐘 → 已忽略，不計工時。
5. 超過 20 小時沒下班 → 缺下班。
6. 跨午夜算在上班那天；只有下班的算在下班那天；凌晨 6 點前、離上一段下班 3 小時內又上班（例如去吃飯），也算在前一天。

狀態：正常、上班中、缺下班、缺上班、已忽略。

## 課表（`src/core/schedule.js`）

設定檔的 `schedule` 是幾行文字：`期間 …`（可寫好幾段，每段管到下一個期間）、`每週一 18:00-21:00 地點 課名`、`日期 停課 [課名或地點]`、`日期 時間 地點 課名`（補課／加課）。
算工時前，每段打卡時段裡和課表重疊的時間會切出來，改算到上課地點（帶 `course`），其餘留在原地點。
已經上完但沒打到卡的課（或沒打到的那一段）也照課表直接補上，明細裡標「照課表」。地點的 `payUnit: "class"` 表示薪資按堂算（每段一堂）。

## 檔案

| 路徑 | 內容 |
|---|---|
| `index.html` | 5 個分頁：總覽、明細、紀錄、設定、說明（含捷徑設定步驟） |
| `src/app.js` | 畫面與操作 |
| `src/store.js` | 本機快取、離線待上傳、和 GitHub 同步 |
| `src/github.js` | GitHub REST API |
| `src/core/` | 純函式：`time`、`parse`、`pairing`、`stats`、`geo`、`schedule`（測試都在這層） |
| `test/` | 單元測試 |
| `scripts/serve.mjs` | 本機伺服器 |
| `scripts/make-icons.mjs` | 用 Playwright 產生 PNG 圖示 |

## 指令

```
npm test      # 單元測試（Node 20 以上）
npm run dev   # http://localhost:5173/
npm run stamp # 推上線前執行：所有檔案引用加版本號，手機才不會混用新舊檔案
```
