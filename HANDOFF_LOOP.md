# 接手處理：選角待機片每 3 秒頓一次

> 由雲端 session 於 2026-09-08 交接（v1.94 · 0908-0940，main = b861a3a）。
> **動工前先 `git pull`。** 先讀 `BRAIN.md`（共用腦），特別是地雷區 ⑫ 和 ⑬。

## 睿哥回報的症狀（他親口確認：兩種都有）

1. 點下角色那一次會卡一下
2. **盯著同一個角色不動，每隔幾秒還會規律地再頓一次** ← 先修這個

## 已經查到的事實（不要重查）

第 2 項的原因量到了：等待片是 3 秒的 `video.loop = true`。
**每次繞回開頭，WebKit 都會掉回 `readyState` 1、丟一個 `waiting` 重新緩衝**
—— 就算整支都在本機 blob 裡也一樣，**跟網路完全無關**。

雲端實測：`循環頓 4 次 @349 / 3364 / 6392 / 9425ms`，
間隔正好 3030ms ＝ 片長，單次約 12ms（桌機看不出來，iPhone 未知）。

這就是為什麼 v1.80〜v1.93 十幾個版本的「載入」修正都沒讓他覺得變順
—— 一直在修第一次載入，而這個每 3 秒都會再來一次。

## 要做的事

把 3 秒 loop 的接點做成無縫：選角舞台本來就有 A／B 兩顆 `<video>`
（`.vp-video-a` / `.vp-video-b`），改成兩顆交替播同一支，在快到結尾時
把已經 seek 到 0 的另一顆接上去，避免 loop 造成的 seek 重新緩衝。

相關位置（`js/videoPlayer.js`）：

- `setSource(target, src, { loop: playKind === "wait" })`
- `primeMedia(id, kind)` 裡的 `loop: kind === "wait"`
- `prepare(id)` 裡的 `loop: true`

⚠️ **B 顆目前還被拿去預熱 confirm／下一個角色**，交棒方案要處理這個衝突。

## 你比雲端強的地方，請務必用上

雲端 session **沒有 Safari、解不了 H.264**，所以這題一直只能猜
（v1.90 就是這樣誤判過一次，見 `PROJECT_NOTES.md` v1.91／v1.92）。
你在 Mac 上有真的 Safari，也能讓睿哥的 iPhone 連區網測 ——
**請一定要在真機上驗過再收工**，這是整件事一直卡住的根本原因。

### 驗證方式

網址加 `?debug=1`，面板最上面會釘著上一次點擊的摘要，看「**循環頓**」
那一行的次數與間隔。修好之後應該是 0 次或大幅減少。

本機測要用 `tools/slow_server.py --kbps 130`
（`python3 -m http.server` 對 Range 回 200 不是 206，測出來的結論不能用）。

## 鐵則（完整版在 `CLAUDE.md`）

- **改 `js/rng.js` 前先問睿哥**（目前 SHA
  `9ab55a96f19f162c1380a06cc7b3f2d496fb088aa393d570afeef7ef662f021a`，不要動到）
- **影片絕對不要走 Service Worker**（`VIDEO_CACHE = false` 是刻意的）
- 純靜態 HTML/CSS/JS，**無 build、無框架**
- 收工要：`index.html` 的對應 `?v=` +1、更新 `.build-stamp`、
  跑 `python3 tools/sync_build.py`、更新 `PROJECT_NOTES.md`、`git push`
  （**沒 push 睿哥手機看不到**）

## 還沒處理的第 1 項

「點下去那一次的卡」還在。等第 2 項修好、睿哥重新感受過之後再判斷還剩多少。
**不要兩件一起改** —— v1.90 一次上四件事，炸了就無從二分。
