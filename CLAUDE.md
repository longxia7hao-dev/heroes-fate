# Heroes' Fate — 開工必讀（任何 AI／任何裝置）

這份檔案會在每個 session 自動載入，所以**不管是 Mac 終端機、桌面版、手機端還是雲端 session，看到的規則都一樣**。

## 動工前的閱讀順序

1. **`PROJECT_NOTES.md`** ← **目前狀態的單一事實來源**。「目前狀態」＋「變更日誌」最上面那一條就是最新進度。有衝突時**以這份為準**。
2. `AGENT_HANDOFF.md` — 架構與檔案地圖的長篇說明，但**內文有些數字是舊的**（整理於 2026-08-01，當時 13 角、v0.94）。當背景知識讀，別當現況。
3. `/Users/longxia7hao/Heroes_Fate_GDD/GDD.md` — 企劃書（若在雲端 session 看不到此路徑，跳過）。

## 收工後一定要做

更新 `PROJECT_NOTES.md` 的「目前狀態」與「變更日誌」（在日誌最上方新增一條，格式照既有的：`日期｜誰｜**版本與標題**：①…②…`）。這是 Claude Code 與 Codex 共用的交接介面，不寫下一個接手的人就會重複踩坑。

## 專案鐵則

1. **公平**：結果必須「先 RNG 定案，再播演出」（seed-first）。`js/rng.js` 的 `seedRun()` 在任何演出開始前就決定好一切。
2. **改 `js/rng.js` 前先問睿哥**。改完務必在日誌記下新的 SHA-256（`shasum -a 256 js/rng.js`）。目前基準：`9ab55a96f19f162c1380a06cc7b3f2d496fb088aa393d570afeef7ef662f021a`
3. 一局**只有一位勝利者**（2026-08-12 已移除「雙重命運」卡）。
4. 不需輸入名字（玩家 N · 角色名）；同局角色不可重複。
5. 純靜態 HTML/CSS/JS，**無 build、無框架**。不要引入打包工具或前端框架。

## 怎麼跑起來

```bash
cd /Users/longxia7hao/Heroes_Fate && python3 -m http.server 8888 --bind 0.0.0.0
```

`http://127.0.0.1:8888/index.html`，改碼後**強制重新整理**（Cmd+Shift+R）。手機／公開隧道見 `PHONE_ONLINE.txt`。

## 三個最常踩的坑

1. **改了檔案但手機看到舊的** → 快取版本沒 +1。三層都要顧：
   - 改 JS／CSS → `index.html` 裡對應的 `?v=N` +1
   - 換影片 → `js/videoPlayer.js` 的 `MEDIA_VERSION` +1（改 manifest 則另加 `MANIFEST_VERSION`）
   - 換立繪／頭像／poster → `js/game.js` 的 `ART_VERSION` +1
2. **換了影片就要重製 poster**（`assets/videos/poster/{attack,victory,final}/`、`poster/boss/arrival.jpg`）。切入層在影片載入前顯示的是 poster 首幀，忘了重製就會「先閃一張舊角色圖」。
3. **演出流程有 early return，加新段落要看清楚位置**。`presentBossRaid()` 曾因為 `if (isDoom) { … return; }` 排在播 final 之前，導致命運審判模式整段最後一擊從來沒播過。加新 ACT 前先確認它在所有 return 之前。

## 驗證方式

用瀏覽器工具開 360×640，注入 log 記錄 `#stage` 的 `dataset.act` 與切入層 video 的 `currentSrc`，靠截圖推進被節流的動畫，最後讀 log ＋ 確認 console error 為 0。設定裡的「命運卡」「命運一擊」是**按設定視窗「關閉」時才寫回** `state.opts`，用程式勾選 checkbox 不會生效。
