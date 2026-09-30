// Animates the hero patch panel: allowed requests travel through the gate to the
// subscription; the home server's Opus request is refused and its error is printed.
// Without JS or with reduced motion, the static panel already shows the refusal.
(() => {
  const panel = document.querySelector(".panel");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Copy buttons on setup code blocks.
  for (const pre of document.querySelectorAll(".steps pre")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(pre.querySelector("code").textContent);
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
    pre.append(btn);
  }

  if (!panel || reduced) return;

  const wires = [...panel.querySelectorAll(".lane .wire")];
  const trunk = panel.querySelector(".trunk .wire");
  const consoleEl = panel.querySelector(".console");
  const DENIED_LANE = 3;
  consoleEl.classList.add("idle");

  const send = (wire, { denied = false, duration = 1.2 } = {}) =>
    new Promise((resolve) => {
      const pkt = document.createElement("span");
      pkt.className = denied ? "pkt denied" : "pkt";
      pkt.style.setProperty("--t", `${duration}s`);
      pkt.addEventListener("animationend", () => (pkt.remove(), resolve()), { once: true });
      wire.append(pkt);
    });

  let visible = false;
  let tick = 0;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(panel);

  setInterval(() => {
    if (!visible || document.hidden) return;
    tick++;
    if (tick % 7 === 0) {
      send(wires[DENIED_LANE], { denied: true });
      setTimeout(() => consoleEl.classList.remove("idle"), 950);
      setTimeout(() => consoleEl.classList.add("idle"), 4200);
      return;
    }
    const lane = Math.floor(Math.random() * wires.length);
    if (lane === DENIED_LANE) return; // keep the home server mostly quiet
    send(wires[lane], { duration: 0.9 + Math.random() * 0.6 }).then(() => {
      if (getComputedStyle(trunk.parentElement).display !== "none") send(trunk, { duration: 0.5 });
    });
  }, 520);
})();
