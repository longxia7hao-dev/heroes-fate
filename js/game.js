(() => {
  const parts = ["js/game.p0.js", "js/game.p1.js", "js/game.p2.js", "js/game.p3.js", "js/game.p4.js", "js/game.p5.js", "js/game.p6.js"];
  const v = "34";
  Promise.all(parts.map((p) => fetch(p + "?v=" + v).then((r) => {
    if (!r.ok) throw new Error(p);
    return r.text();
  }))).then((texts) => {
    (0, eval)(texts.join(""));
  }).catch((err) => {
    console.error("HF game load failed", err);
  });
})();
