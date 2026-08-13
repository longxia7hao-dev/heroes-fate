/** Seeded RNG — result decided before presentation (GDD fair rule) */
window.HF_RNG = (() => {
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeSeed() {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return (a[0] ^ a[1]) >>> 0;
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * 命運卡：每局翻一張，改變本局規則。
   * 卡片本身也在 seed-first 階段抽出，且對所有玩家一視同仁，
   * 不會讓任何人被抽中的機率高於別人。
   */
  const FATE_CARDS = [
    { id: "calm", name: "風平浪靜", desc: "普通的一局，照常進行", effect: {} },
    { id: "reverse", name: "逆命", desc: "改抽「最安全」的那一位", effect: { reverse: true } },
    { id: "doubleDoom", name: "加倍判決", desc: "懲罰任務抽兩張", effect: { doomTimes: 2 } },
    { id: "mercy", name: "命運仁慈", desc: "這局不抽懲罰", effect: { noDoom: true } },
  ];

  function drawFateCard(rand) {
    return FATE_CARDS[Math.floor(rand() * FATE_CARDS.length)];
  }

  function seedRun(mode, players, opts = {}) {
    const seed = makeSeed();
    const rand = mulberry32(seed);
    const runId = `${Date.now().toString(36)}-${seed.toString(16)}`;
    const n = players.length;
    let result;

    // 先抽命運卡，之後的抽籤才依卡片規則進行（仍然 seed-first）
    const card = opts.useFateCard ? drawFateCard(rand) : null;
    const eff = card?.effect || {};
    let effectiveMode = mode;
    if (eff.reverse) {
      if (mode === "boss") effectiveMode = "doom";
      else if (mode === "doom") effectiveMode = "boss";
    }

    if (effectiveMode === "boss" || effectiveMode === "doom") {
      const isDoom = effectiveMode === "doom";
      const order = shuffle(
        players.map((p, i) => ({ ...p, slot: i })),
        rand
      );
      const take = eff.pickTwo ? Math.min(2, n) : 1;
      const chosen = order.slice(0, take);
      result = {
        mode: effectiveMode,
        requestedMode: mode,
        isDoom,
        card,
        chosen,
        winnerSlot: chosen[0]?.slot ?? 0,
        winner: chosen[0],
      };
    } else if (mode === "order") {
      const order = shuffle(
        players.map((p, i) => ({ ...p, slot: i })),
        rand
      );
      result = { mode, order, card };
    } else if (mode === "pair") {
      const shuffled = shuffle(
        players.map((p, i) => ({ ...p, slot: i })),
        rand
      );
      const pairs = [];
      let bye = null;
      for (let i = 0; i < shuffled.length; i += 2) {
        if (i + 1 >= shuffled.length) bye = shuffled[i];
        else pairs.push([shuffled[i], shuffled[i + 1]]);
      }
      result = { mode, pairs, bye, card };
    } else if (mode === "survival") {
      // 洗牌後的順序即淘汰順序，最後一位是生還者（純均勻隨機）
      const shuffled = shuffle(
        players.map((p, i) => ({ ...p, slot: i })),
        rand
      );
      const survivor = shuffled[shuffled.length - 1];
      result = {
        mode,
        card,
        eliminated: shuffled.slice(0, -1),
        survivor,
        winnerSlot: survivor?.slot ?? 0,
        winner: survivor,
      };
    } else if (mode === "teams") {
      const wanted = Math.max(2, Math.min(4, opts.teamCount | 0 || 2));
      const teamCount = Math.max(2, Math.min(wanted, n));
      const shuffled = shuffle(
        players.map((p, i) => ({ ...p, slot: i })),
        rand
      );
      const teams = Array.from({ length: teamCount }, () => []);
      // 依序發牌，人數自然平均（差距最多 1 人）
      shuffled.forEach((p, i) => teams[i % teamCount].push(p));
      result = { mode, teams, teamCount, card };
    } else {
      result = { mode: "unknown" };
    }

    return { runId, seed, result, players, mode };
  }

  return { seedRun, mulberry32, shuffle, FATE_CARDS };
})();
