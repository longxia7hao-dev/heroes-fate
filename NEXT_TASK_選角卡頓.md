# 交接：選角影片「播到一半卡住」

**這份給在 Mac 上跑的 Claude。** 雲端 session 查到這裡就沒辦法再往下了 ——
原因與已知事實都寫在下面，不用重查。做完請刪掉這個檔案。

## 一句話

`playing` 事件只代表「第一幀解出來了」，不代表「後面接得上」。
選角的等待片一就緒就開播，然後**播到一半餓死**，畫面靜止約 1.9 秒。

## 已經量到的事實（不用重做）

- 睿哥的實際連線速度約 **120〜150 KB/s**（約 1 Mbps）。
- 等待片 v1.82 壓完平均 **168K**；`168K ÷ 130KB/s ≈ 1.3 秒`。
  兩支螢幕錄影逐幀分析，靜止時間分別是 **1.67 秒**與 **1.87 秒**，與當時的檔案大小吻合。
- **卡牌本身很快**：實測 **376ms** 就翻好了，用的是已經在選角格快取裡的
  13K 頭像（`prepareFallback` → `assets/heroes/portraits/<id>.jpg`）。
  **這條後備路徑是對的，不要動它。**
- 重壓救不了：540 寬 ＋ CRF34 ＋ 15fps 也只從 1.9 秒降到 1.0 秒，而且畫質明顯掉。

## 該改哪裡

`js/videoPlayer.js` 的 `runPlay()`：

```js
target.addEventListener("playing", showVideo, { once: true });
```

想法是 wait 片改成等 `canplaythrough`（或 `readyState >= 4`）才讓影片上場，
中間維持顯示靜圖 —— 總等待時間差不多，但**不會出現「卡住」的觀感**。

## ⚠️ 雲端試過、失敗的原因（關鍵）

直接把上面那行換成 `canplaythrough`，**影片會完全不上場**。因為：

```js
const showVideo = () => {
  if (shown || destroyed || token !== playToken || reveal.settled) return;
```

`reveal.settled` 這個守門條件會擋掉。卡牌一旦已經用後備（頭像）翻開，
`reveal` 就 settled 了，之後才來的 `canplaythrough` 會被直接 return 掉，
結果永遠停在靜圖。

**所以真正要改的是「牌已經翻開之後，影片就緒要能直接接手」這條路徑**
（大致是：`reveal.settled` 時不要 return，改成直接 `activateVideo(target, token, id)`，
並且不要走 `pendingReveal`，因為揭露點早就過去了）。

同時要留保險：`canplaythrough` 不一定會來，逾時（約 3 秒）要退回原本的 `playing` 行為。

## 為什麼一定要在 Mac 做

雲端只有 headless Chromium：**解不了 H.264**（所有 mp4 都 `ERR_FAILED`），
所以「影片播放」這件事在那裡根本驗不到，`reveal.settled` 的時序也跟真機不同。

在 Mac 上請這樣驗：

1. iPhone 用線接上 Mac，iPhone「設定 → Safari → 進階 → 網頁檢閱器」打開。
2. Mac 的 Safari →「開發」選單 → 選你的 iPhone → 選 Heroes' Fate 的分頁。
3. 在 Console 觀察選角時那顆 `<video>` 的 `readyState`、`buffered.end(0)`、
   以及 `playing` / `canplaythrough` / `waiting` / `stalled` 的先後順序。
4. **驗收條件：連續點五個沒看過的角色，不能出現「影片動一下又靜止」。**

## 收工

改完照 CLAUDE.md：`?v=` +1、更新版本印記、`python3 tools/sync_build.py`、
更新 `PROJECT_NOTES.md`、`git push`，然後刪掉這個檔案。
