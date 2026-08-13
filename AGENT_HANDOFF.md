# Heroes' Fate（英雄命運）— AI Agent 交接手冊

> ## ⚠️ 先讀這段
>
> **本檔的架構說明與檔案地圖仍然有效，但內文的「現況」數字整理於 2026-08-01，已經過時**（當時 13 角、v0.94，還沒有 final／魔王降臨／命運卡／命運審判）。
>
> **目前狀態的單一事實來源是 [`PROJECT_NOTES.md`](PROJECT_NOTES.md)**；開工前先讀它與 [`CLAUDE.md`](CLAUDE.md)。本檔與其衝突時一律以 `PROJECT_NOTES.md` 為準。
>
> 最後整理：2026-08-01（Grok）／2026-08-13 加註過時提醒（Claude Code）  
> 專案擁有者：睿哥（製作人）

---

## 0. 60 秒摘要

| 項目 | 內容 |
|------|------|
| 產品 | 聚會用「動畫抽籤」網頁原型，非數值養成 RPG |
| 口號 | 讓抽籤變成一場冒險；抽中的，不只是命運 |
| 技術 | 純靜態 **HTML / CSS / JS**（無 build、無框架） |
| 路徑 | `/Users/longxia7hao/Heroes_Fate/` |
| GDD | `/Users/longxia7hao/Heroes_Fate_GDD/GDD.md`（v0.9，目標最終 Unity） |
| 規模 | 整包約 **476MB**；實際在用的只有約 70MB（`assets/videos/mobile` 55MB＋`poster` 1.3MB＋`audio` 4.1MB＋`heroes` 7MB＋少數背景），其餘是舊高碼率原片與已停用的 `assets/anim`（128MB） |
| 目前版本 | **v1.8（2026-08-13）**：14 角色，每角 wait／confirm／attack／**final**／victory 五支影片（manifest 70 條引用零缺檔）；六模式＋命運卡＋命運一擊＋懲罰任務＋今晚戰績＋命運卷軸。細節一律看 `PROJECT_NOTES.md` |

**鐵則（GDD）**

1. **公平**：結果必須 **先 RNG 定案，再播演出**（seed-first）
2. **不影響勝率的課金／外觀**才可考慮；本原型未接金流
3. **不需輸入名字**：玩家 N · 角色名
4. 同局角色 **不可重複**

---

## 1. 如何啟動

### 1.1 本機（Mac）

```bash
cd /Users/longxia7hao/Heroes_Fate
python3 -m http.server 8888 --bind 0.0.0.0
```

瀏覽器：**http://127.0.0.1:8888/index.html**  
改碼後務必 **強制重新整理**（Cmd+Shift+R）。

> ⚠️ **禁止用 `file://` 開**：影片／JSON 會 CORS 或載入失敗。

### 1.2 同一 Wi‑Fi 手機

```
http://<Mac區網IP>:8888/index.html
```

目前例：`http://192.168.68.52:8888/index.html`（IP 可能隨網路變更）  
（IP 會變；用 `ipconfig getifaddr en0` 查）

**手機不要開 `127.0.0.1`**（那是手機自己，會白屏）。

### 1.3 網際網路／4G（不必同 Wi‑Fi）

需要 **本機 8888 + 隧道** 同時開著：

```bash
# 終端 1
cd /Users/longxia7hao/Heroes_Fate && python3 -m http.server 8888 --bind 0.0.0.0

# 終端 2
cloudflared tunnel --url http://127.0.0.1:8888 --no-autoupdate
```

輸出的 `https://xxxx.trycloudflare.com` 即公開網址。  
**每次重開隧道網址會變**；見 `PHONE_ONLINE.txt`。

備援：`npx localtunnel --port 8888`（可能有驗證頁，較不穩）。

### 1.4 依賴

- 無需 npm install
- 可選：`ffmpeg`（處理影格／裁片）、`cloudflared`（公開隧道）、Pillow（舊 sheet 管線）

---

## 2. 目錄結構

```
Heroes_Fate/
├── index.html              # 單頁：所有畫面 section
├── css/game.css            # 全站樣式（含選角 U 字、勝利片框、手機 safe-area）
├── js/
│   ├── data.js             # HF_DATA.heroes（13 角）★ 改角色先改這
│   ├── rng.js              # HF_RNG.seedRun — 公平 seed-first
│   ├── game.js             # 主流程 UI / 狀態機 / 演出編排 ★
│   ├── videoPlayer.js      # HF_VideoPlayer — 選角 wait/confirm
│   ├── victoryFilm.js      # HF_VictoryFilm — 勝利短片 + 字幕同框
│   ├── frameAnimator.js    # 舊：逐幀 walk/attack（目前勝利優先用影片）
│   ├── spritePlayer.js     # 舊管線（可忽略）
│   ├── characterStage.js   # 舊管線（可忽略）
│   ├── victory.js          # 舊分鏡板（可忽略）
│   └── viewer3d.js         # 舊 Three.js 預覽（目前未掛 index）
├── assets/
│   ├── videos/
│   │   ├── manifest.json   # id → wait/confirm/victory 路徑 ★
│   │   ├── wait/*.mp4      # 13 支（選角預覽循環）
│   │   ├── confirm/*.mp4   # 13 支（按「決定」播一次）
│   │   └── victory/*.mp4   # 10 支（缺 3 支見下）
│   ├── heroes/{id}.png     # 13 張靜圖（列表／結果／影片後備）
│   ├── heroes/_legacy/     # 舊 12 角立繪封存
│   ├── anim/               # 舊 Imagine/sheet 逐幀（walk/attack）— 次要
│   ├── bg_boss.jpg, bg_party.jpg, boss_model.png, ref_battle.mp4, cine_*.jpg
│   └── ...
├── PROJECT_NOTES.md        # 輕量共享筆記（多 AI 協作用）
├── PHONE_ONLINE.txt        # 公開網址備忘
├── AGENT_HANDOFF.md        # 本檔
└── README.md
```

**關聯企劃（勿與程式混放）：**

- GDD 全文：`/Users/longxia7hao/Heroes_Fate_GDD/`
- Sora 原始片來源（Google Drive）：  
  `.../我的雲端硬碟/英雄旅途/角色圖/角色{等待選擇,確定選擇,勝利}動畫/`  
  （檔名多為 UUID，需用畫面辨識對應角色）

---

## 3. 畫面流程（state machine）

```
boot → home → count(2–13人) → pick(選角) → mode → play(演出) → result
                ↑                │           │
                └────────────────┴─ 返回 ────┘
```

| Screen id | 說明 |
|-----------|------|
| `boot` | 開場 splash，約 0.8s 後進 home |
| `home` | 開始／設定；顯示手機連線提示 `#phone-url-hint` |
| `count` | 人數 2–13；進入時 **clearPicks()** |
| `pick` | U 字選角 + 影片預覽 |
| `mode` | 魔王討伐 / 命運排序 / 命運配對 |
| `play` | 演出舞台 |
| `result` | 結果；再來一局／換模式／重新選角／回主選單 |

設定 modal：`#modal-settings`（允許跳過、快速、音效）。

---

## 4. 13 角色表（權威資料）

定義於 `js/data.js`；影片對照 `assets/videos/manifest.json`；靜圖 `assets/heroes/{id}.png`。

| id | 中文名 | 武器 | 顏色 | wait | confirm | victory |
|----|--------|------|------|------|---------|---------|
| knight | 騎士 | 長劍與盾 | #90caf9 | ✓ | ✓ | ✓ |
| paladin | 聖騎士 | 聖錘與盾 | #ffd54f | ✓ | ✓ | ✓ |
| ranger | 遊俠 | 長弓 | #81c784 | ✓ | ✓ | ✓ |
| orc_archer | 半獸人射手 | 戰弓 | #9ccc65 | ✓ | ✓ | ✓* |
| axeman | 斧戰士 | 巨斧 | #43a047 | ✓ | ✓ | ✓ |
| amazon | 女戰士 | 鏈錘 | #ff8a65 | ✓ | ✓ | ✓ |
| dark_fighter | 暗黑武鬥家 | 雙拳 | #ef5350 | ✓ | ✓ | ✓ |
| assassin | 黑袍刺客 | 紫影短刃 | #ab47bc | ✓ | ✓ | ✓ |
| archmage | 大魔導師 | 紫晶法杖 | #b39ddb | ✓ | ✓ | ✓ |
| dark_mage | 黑暗法師 | 闇晶法杖 | #7e57c2 | ✓ | ✓ | ✓ |
| dark_elf | 黑暗精靈 | 毒綠法杖 | #66bb6a | ✓ | ✓ | **缺** → fallback confirm/wait |
| monk | 僧侶 | 聖鈴錫杖 | #fff59d | ✓ | ✓ | **缺** |
| princess | 公主 | 星光權杖 | #f48fb1 | ✓ | ✓ | **缺** |

\* `orc_archer` confirm 曾誤用 15s wait 片，已裁成約 3s。

新增角色 checklist：

1. 三類影片放入 `assets/videos/{wait,confirm,victory}/`
2. 更新 `manifest.json`
3. 靜圖 `assets/heroes/{id}.png`
4. `data.js` 加 hero 物件（含 `victory` 字幕陣列）
5. 人數上限已 13；若 >13 需改 `setCount` / range max

---

## 5. 核心模組職責

### 5.1 `js/rng.js` — `HF_RNG`

- `seedRun(mode, players)` → `{ seed, runId, result }`
- **必須先呼叫再播動畫**（已在 `startMode` 內）
- modes: `boss`（winnerSlot）、`order`（shuffle 順位）、`pair`（兩兩配對 + bye）

### 5.2 `js/game.js` — 主狀態

關鍵狀態：

```js
state = {
  count, players: [{ heroId, hero }], pickIndex, selectedHeroId,
  mode, run, skip, opts: { allowSkip, fast, sound }, presenting
}
```

**選角契約（易踩坑）：**

| 操作 | 行為 |
|------|------|
| 點角色卡 | 只 `selectedHeroId` + 播 **wait**（預覽） |
| 按「決定」 | `applyPick()` 寫入 `players[i]` + 播 **confirm** |
| 全隊鎖定 | 才可進 mode / 開打 |
| `clearPicks()` | 回 home、進 count、結果頁「重新選角」 |
| 模式頁返回 pick | **不清** 已選 |
| 再來一局 | 保留同一批角色再 RNG |

**U 字排卡 `renderHeroGrid()`：**

- `#hero-rail-left` / `#hero-rail-right` / `#hero-rail-bottom`
- 約左 4 + 右 4 + 底剩餘

**魔王討伐演出 `presentBossRaid`：**

集結 → 降臨 → `ref_battle.mp4` → 輪切懸念 → 怒吼煙霧 → 揭示勝者 → `HF_VictoryFilm.play`

### 5.3 `js/videoPlayer.js` — `HF_VideoPlayer`

- `create(container)` → `{ play, playOnce, destroy }`
- `play(id, 'wait')`：循環
- `playOnce(id, 'confirm', maxMs)`：等 canplay、硬上限防卡死
- 選角等待：`object-fit: contain` + 紫底（避免裁頭與黑邊）

### 5.4 `js/victoryFilm.js` — `HF_VictoryFilm`

- 影片 + 底部字幕 + **VICTORY** 大字（在底部，不擋臉）
- 片尾 **凍結最後一幀**，整段字幕結束才清 DOM
- 無 victory 片：`manifest` 的 confirm/wait 或靜圖

### 5.5 舊模組

`frameAnimator.js`、`spritePlayer.js`、`characterStage.js`、`victory.js`、`viewer3d.js`、`assets/anim/**`  
→ 歷史管線（Imagine sheet / 軟遮罩 / 3D 轉台）。**現行主路徑是 Sora 影片**；改動畫優先改 videos + victoryFilm，不要先碰舊 anim。

---

## 6. UI / CSS 重點

| 主題 | 位置／規則 |
|------|------------|
| 手機優先 | `#app` max-width 480px；`100dvh`；safe-area |
| 選角 U 字 | `.pick-u` grid：`left | stage | right` + bottom |
| 等待片全身 | `.screen-pick .vp-video` contain + scale(1.08) + 紫底 |
| 勝利片 | `.vf-shell` / `.vf-caption` / `.vf-title` bottom |
| 黑屏禁忌 | 勝利中途不要 destroy 影片；letterbox 勿純黑長時間 |

---

## 7. 已修 Bug 清單（勿重開）

1. **file:// / 錯 port** → 必須 HTTP 8888  
2. **選角只點不鎖定** → 必須按「決定」；全隊檢查才進 mode  
3. **最後一位卡住** → confirm 硬上限；寫入優先於動畫  
4. **跨局角色鎖死** → clearPicks 於 home/count/重新選角  
5. **勝利黑屏** → 字幕與片同框；片尾 hold frame  
6. **VICTORY 擋臉** → 字移到底部字幕上方  
7. **手機 127.0.0.1 白屏** → 用區網 IP 或 Cloudflare 隧道  
8. **半獸人 confirm 15 秒** → 已裁 ~3s  

---

## 8. 已知限制 / 待辦

### 內容

- [ ] 補 3 支 **victory**：`dark_elf`, `monk`, `princess`
- [ ] 部分 Sora 立繪與最早 Q 版想像不完全一致（以影片為準）
- [ ] 勝利片多數約 3s；字幕節拍已對齊，可再人工調文案

### 產品

- [ ] 正式上架目標為 **Unity（GDD）**；本 repo 是驗證體驗的 web prototype
- [ ] 無後端、無帳號、無廣告 SDK
- [ ] 公開隧道不永久；正式需固定網域或 App 包體

### 技術債

- [ ] 清理未掛載的舊 JS（viewer3d / victory.js 等）降低混淆
- [ ] `assets/anim` 體積大（128MB）若只走影片可封存
- [ ] 行動數據播 270MB 影片偏重；可考慮壓碼 / 低解析備援

---

## 9. 改碼指引（給 Agent）

### 9.1 只改文案／角色名

→ `js/data.js` 的 `name` / `flavor` / `victory` 陣列

### 9.2 換影片

1. 覆蓋 `assets/videos/{wait|confirm|victory}/{id}.mp4`
2. 確認 `manifest.json` 路徑
3. 靜圖可從 wait 抽幀：`ffmpeg -ss 0.5 -i wait.mp4 -frames:v 1 heroes/{id}.png`

### 9.3 改選角流程

→ `js/game.js`：`applyPick` / `loadPickSelection` / `clearPicks` / `goModeIfReady`  
→ 佈局：`index.html` `#screen-pick` + `css/game.css` `.pick-u*`

### 9.4 改勝利演出

→ `js/victoryFilm.js` + 相關 CSS `.vf-*`  
→ 魔王分幕節奏：`presentBossRaid` in `game.js`

### 9.5 改 RNG 公平邏輯

→ **只** `js/rng.js`；禁止在動畫 callback 裡重抽勝者

### 9.6 多 Agent 協作

- 改完更新 `PROJECT_NOTES.md` 的「目前狀態」與「變更日誌」
- 遵守使用者 `CLAUDE.md`：非交易系統專案用 `PROJECT_NOTES`，不寫 `SHARED_BRAIN.md`
- 同檔案避免與其他 Agent 並行大改

---

## 10. 驗收清單（手動）

1. `python3 -m http.server 8888 --bind 0.0.0.0` 後本機可開  
2. 2–13 人編成 → 每位「點角色 → 決定」→ 圓點有頭像  
3. 最後一位決定後進模式；未滿員會提示缺誰  
4. 魔王討伐：有懸念 → 揭示 → 勝利片 + 字幕 + VICTORY 不擋臉、不中途黑屏  
5. 結果「重新選角」後上一局角色可再選  
6. 回主選單再開新局，選角清空  
7. 手機：區網 IP 或 trycloudflare URL 可進；**非** 127.0.0.1  

---

## 11. Script 載入順序（index.html）

```html
data.js → rng.js → videoPlayer.js → frameAnimator.js → victoryFilm.js → game.js
```

全域命名空間：`HF_DATA` / `HF_RNG` / `HF_VideoPlayer` / `HF_FrameAnimator` / `HF_VictoryFilm`

---

## 12. 給接手 Agent 的第一句指令範例

```
專案在 /Users/longxia7hao/Heroes_Fate/。
先完整閱讀 AGENT_HANDOFF.md 與 PROJECT_NOTES.md，再動工。
用 python3 -m http.server 8888 --bind 0.0.0.0 驗證。
公平 RNG 必須 seed-first（js/rng.js）。選角必須「決定」才鎖定。
改完更新 PROJECT_NOTES.md 變更日誌。
```

---

## 13. 快速檔案對照

| 你想… | 開哪個檔 |
|--------|----------|
| 角色列表／台詞 | `js/data.js` |
| 影片路徑 | `assets/videos/manifest.json` |
| 選角／模式／演出 | `js/game.js` |
| 選角播片 | `js/videoPlayer.js` |
| 勝利短片 | `js/victoryFilm.js` |
| 樣式／U 字／手機 | `css/game.css` |
| 畫面 DOM | `index.html` |
| 公平隨機 | `js/rng.js` |
| 企劃全文 | `Heroes_Fate_GDD/GDD.md` |
| 協作狀態 | `PROJECT_NOTES.md` |

---

**EOF — 交接完成。有衝突以 GDD 公平原則 + 本檔「現行主路徑＝Sora 影片」為準。**
