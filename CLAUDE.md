# Heroes' Fate — 開工必讀（任何 AI／任何裝置）

這份檔案會在每個 session 自動載入，所以**不管是 Mac 終端機、桌面版、手機端還是雲端 session，看到的規則都一樣**。

## 這個專案在哪、怎麼上線

- **GitHub**：`longxia7hao-dev/heroes-fate`（公開）。本機開發目錄 `/Users/longxia7hao/Heroes_Fate`。
- **正式網址**：<https://longxia7hao-dev.github.io/heroes-fate/> —— **push 到 `main` 就自動上線**，不需要任何機器開著。這是睿哥手機遊玩與驗收的入口。
- **收工要 `git push`**，不然手機看不到你的改動。改完 → commit → push → 等約 1 分鐘 Pages 重建 → 手機下拉重載。
- **repo 是程式碼的事實來源。** 雲端 session 動工前先 `git pull`；本機動工前也先 `git pull`，避免兩邊各改一份。
- **版本控制只收遊戲實際在用的素材**（約 73MB）。舊高碼率原片與已停用的 `assets/anim` 由 `.gitignore` 排除，只留在本機與 Google Drive。**別把它們加回來。**
- **雲端 session 做不到的事**：讀 Google Drive 素材夾（`tools/*.py` 需要）—— 那個要在本機做。純 JS／CSS／HTML 的修改在雲端完全沒問題。
- **ffmpeg 在雲端可以用**（這條 2026-08-15 更正，舊版寫「做不到」是錯的）：`pip install imageio-ffmpeg` 會帶一份**靜態 ffmpeg 7.0.2**，H.264／AAC 都能解能編。已用它做過：抽影片音軌做音效（v1.22／v1.32）、把 18MB 的原片壓成行動版（v1.36）。

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

`http://127.0.0.1:8888/index.html`，改碼後**強制重新整理**（Cmd+Shift+R）。這只是本機預覽；**要讓睿哥手機看到，一定要 push**（見上方）。

注意：本機的 `python3 -m http.server` 對 Range 請求會回 200 而不是 206，這是 iOS Safari 音訊曾經播不出來的根因（見 v1.2.1）。GitHub Pages 正確回 206，所以**手機測試優先用 Pages 網址**，本機 server 只用來看未 push 的改動。

## 三個最常踩的坑

1. **改了檔案但手機看到舊的** → 快取版本沒 +1。三層都要顧：
   - 改 JS／CSS → `index.html` 裡對應的 `?v=N` +1
   - 換影片 → `js/videoPlayer.js` 的 `MEDIA_VERSION` +1（改 manifest 則另加 `MANIFEST_VERSION`）
   - 換素材（影片／圖／音檔）→ 跑 `python3 tools/gen_asset_versions.py`（逐檔雜湊表；`ART_VERSION`／`MEDIA_VERSION` 只是查不到時的退路）

   **但最陰的一層是 `index.html` 自己**：頂端那三個 `<meta http-equiv="Cache-Control">`／`Pragma`／`Expires`
   **對瀏覽器的 HTTP 快取完全沒有作用**（只有真的 HTTP header 算數），而 GitHub Pages 給 HTML 的是
   `max-age=600`；更要命的是**分頁只要一直開著不重新整理，`index.html` 根本不會再被抓一次**，
   於是上面所有 `?v=` 的努力全部白費。2026-08-13～14 為此誤判過三次。

   現在有兩道防線，**改版時兩件事都要做**：
   **還有一層是 CSS 自己的 `url()`**：`css/ornate.css` 的框與按鈕素材（`assets/ui/*.webp`）
   走的是 CSS，**吃不到 `HF_ASSET_V` 那張逐檔雜湊表**（那是 JS 讀的）。換這幾張圖時要
   **手動把 CSS 裡的 `?v=` +1**，只 +ornate.css 自己的版本沒有用。

   - 更新 `index.html` 的 `.build-stamp`（首頁最下面那行版本印記，**看得到才是新版**）
   - 跑 `python3 tools/sync_build.py` 把印記同步到 `build.txt` ——
     `game.js` 會以 `no-store` 抓它跟頁面比對，不一樣就跳「有新版本 · 點一下更新」。
     **忘了跑，玩家就永遠收不到更新提示。**
2. **換了影片就要重製 poster**（`assets/videos/poster/{attack,victory,final}/`、`poster/boss/arrival.jpg`）。切入層在影片載入前顯示的是 poster 首幀，忘了重製就會「先閃一張舊角色圖」。
3. **演出流程有 early return，加新段落要看清楚位置**。`presentBossRaid()` 曾因為 `if (isDoom) { … return; }` 排在播 final 之前，導致命運審判模式整段最後一擊從來沒播過。加新 ACT 前先確認它在所有 return 之前。

## 驗證方式

用瀏覽器工具開 360×640，注入 log 記錄 `#stage` 的 `dataset.act` 與切入層 video 的 `currentSrc`，靠截圖推進被節流的動畫，最後讀 log ＋ 確認 console error 為 0。設定裡的「命運卡」「命運一擊」是**按設定視窗「關閉」時才寫回** `state.opts`，用程式勾選 checkbox 不會生效。
