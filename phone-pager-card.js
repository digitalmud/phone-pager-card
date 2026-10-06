// phone-pager-card: the Phone dashboard as ONE screen — pages side by side, swipe/scroll sideways with snapping
// (like iPhone home screens); each page scrolls up/down on its own.
// Config: { type: custom:phone-pager-card, start: 1, pages: [{ name, icon, sections: [<section config>, ...] }],
//           popups: [<bubble pop-up card>, ...] }
// Sections are rendered with Home Assistant's own <hui-section>, so grid sizes and visibility rules work as in a
// sections view. Links to /<dashboard>/<view>?page=<name> scroll the strip to that page instead.
class PhonePagerCard extends HTMLElement {
  setConfig(config) {
    if (!Array.isArray(config.pages) || !config.pages.length) throw new Error("pages required");
    this._config = config;
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    for (const el of this._live || []) el.hass = hass;
  }

  _lovelace() {
    const find = (root, d = 0) => {
      if (!root || d > 14) return null;
      const hit = root.querySelector("hui-root");
      if (hit) return hit;
      for (const n of root.querySelectorAll("*")) if (n.shadowRoot) { const r = find(n.shadowRoot, d + 1); if (r) return r; }
      return null;
    };
    const root = find(document);
    return root && root.lovelace;
  }

  async _build() {
    this._built = true;
    const lovelace = this._lovelace();
    // page-wide touches: a light, tinted pop-up backdrop (Bubble's default is a heavy grey haze) and a dark base
    // colour under the wallpaper so nothing flashes white between paints
    document.documentElement.style.setProperty("--bubble-backdrop-background-color", "rgba(14, 16, 40, 0.18)");
    document.documentElement.style.backgroundColor = "#2c3e7a"; this._ll = lovelace; window.__phonePager = this;
    await window.loadCardHelpers();   // makes sure hui-card / hui-section are defined
    PhonePagerCard.patchFades();
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { display: block; position: relative; width: 100%; max-width: 100vw; overflow: hidden;
        --ha-card-border-radius: 18px; --ha-border-radius-lg: 18px; }   /* every card on the pages gets the tiles' corners (e.g. media players) */
      .sky { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
      .strip { position: relative; z-index: 1; display: flex; width: 100%; height: calc(100dvh - var(--safe-area-inset-top, 0px));   /* HA pads the view's top for the status bar, not its bottom */ overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory;
        overscroll-behavior-x: none; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
      .strip::-webkit-scrollbar, .page::-webkit-scrollbar { display: none; }
      .page { flex: 0 0 100%; height: 100%; overflow-y: auto; overflow-x: hidden; scroll-snap-align: start;
        scroll-snap-stop: always; box-sizing: border-box; scrollbar-width: none; overscroll-behavior-y: contain;   /* our own pull-to-refresh below */
        padding: 4px 16px calc(var(--safe-area-inset-bottom, 0px) + 99px);   /* pill top is safe-area + 68px up; + ~31px gap */
        display: block; }
      .inner { min-height: calc(100% + 1px); display: flex; flex-direction: column; gap: 24px; }   /* every page scrolls ≥1px, so overscroll-behavior holds and the app's own pull stays off */
      hui-section[hidden] { display: none; }
      .nav { position: fixed; z-index: 3; left: 50%; transform: translateX(-50%);
        bottom: calc(var(--safe-area-inset-bottom, 0px) - 8px); display: flex; gap: 4px; padding: 8px;
        border-radius: 999px; background: color-mix(in srgb, var(--card-background-color, #fff) 72%, transparent);
        backdrop-filter: blur(22px) saturate(170%); -webkit-backdrop-filter: blur(22px) saturate(170%);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18); }
      .nav button { all: unset; cursor: pointer; width: 88px; height: 60px; border-radius: 999px; display: flex;
        flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        color: var(--secondary-text-color); font: 500 13px var(--ha-font-family-body, Roboto, sans-serif);
        transition: background .25s, color .25s; -webkit-tap-highlight-color: transparent; }
      .nav button ha-icon { --mdc-icon-size: 26px; }
      .nav button.on { color: var(--primary-text-color); background: color-mix(in srgb, var(--primary-text-color) 12%, transparent); }
      .pops { height: 0; overflow: visible; }
      .ptr { position: fixed; z-index: 4; left: 50%; top: calc(var(--safe-area-inset-top, 0px) + 8px); width: 40px; height: 40px;
        margin-left: -20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; opacity: 0;
        transform: translateY(-60px); pointer-events: none; color: #fff;
        background: rgba(255,255,255,0.18); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
      .ptr ha-icon { --mdc-icon-size: 22px; transition: transform .1s; }
      .ptr.go ha-icon { animation: ptr-spin .8s linear infinite; }
      @keyframes ptr-spin { to { transform: rotate(360deg); } }
      .setwrap { position: absolute; left: 0; right: 0; top: 0; z-index: 2;   /* anchored to the same box as the pages, so it lines up on any phone */ transform: translateX(100%); will-change: transform;
        height: calc(100dvh - var(--safe-area-inset-top, 0px)); }
      .setwrap .page { width: 100%; }
    </style>
    <div class="sky"></div><div class="strip"></div><div class="nav"></div><div class="pops"></div><div class="ptr"><ha-icon icon="mdi:refresh"></ha-icon></div>`;
    const strip = root.querySelector(".strip"), nav = root.querySelector(".nav"), pops = root.querySelector(".pops");
    this._sky = root.querySelector(".sky"); this._loadPrefs(); this._frostDialogs(true); this._skyTimer = setInterval(() => this._paintSky(), 60000);
    this._strip = strip;
    this._live = [];

    this._config.pages.forEach((page, p) => {
      const div = document.createElement("div");
      div.className = "page";
      const inner = document.createElement("div");
      inner.className = "inner"; div.appendChild(inner);
      (page.sections || []).forEach((cfg, i) => {
        const s = document.createElement("hui-section");
        s.hass = this._hass; s.lovelace = lovelace; s.config = cfg; s.index = p * 100 + i; s.viewIndex = 0; s.preview = false;
        inner.appendChild(s); this._live.push(s);
      });
      strip.appendChild(div);
      const b = document.createElement("button");
      b.innerHTML = `<ha-icon icon="${page.icon}"></ha-icon><span>${page.name}</span>`;
      b.addEventListener("click", () => { if (this._setOpen) this._openSettings(false); this._go(p, true); });
      nav.appendChild(b);
    });
    this._buttons = [...nav.children];
    PhonePagerCard.patchFades();   // again, in case hui-section was defined late
    // hidden last page: swipe left past the final page to reach it; no nav button
    if (this._config.settings !== false) {
      // Settings is NOT a snap page: it sits off-screen to the right and is pulled in with an elastic gesture
      // from the last page
      this._setw = document.createElement("div"); this._setw.className = "setwrap";
      this._setw.appendChild(this._settingsPage());
      root.insertBefore(this._setw, nav);
      this._elastic(strip);
    }

    // each pop-up gets its own <hui-card>: Bubble hides the nearest hui-card while a pop-up is closed,
    // which would otherwise be the pager itself.
    for (const cfg of this._config.popups || []) {
      const hc = document.createElement("hui-card");
      hc.hass = this._hass; hc.preview = false; hc.config = cfg;
      if (hc.load) hc.load();
      pops.appendChild(hc); this._live.push(hc);
    }

    // pull-to-refresh: drag down from the top of a page (~240px of finger travel) → reload. The Companion app's
    // own pull doesn't work reliably inside a scrolling page, so the pager does it.
    const ptr = root.querySelector(".ptr"), ptrIcon = ptr.querySelector("ha-icon");
    let py = null, px = 0, pull = 0;
    strip.addEventListener("touchstart", (e) => {
      const pg = e.composedPath().find((el) => el.classList && el.classList.contains("page"));
      py = (!location.hash && pg && pg.scrollTop <= 0 && e.touches.length === 1) ? e.touches[0].clientY : null;
      px = e.touches[0].clientX; pull = 0;
    }, { passive: true });
    strip.addEventListener("touchmove", (e) => {
      if (py === null) return;
      const dy = e.touches[0].clientY - py, dx = Math.abs(e.touches[0].clientX - px);
      if (dx > Math.abs(dy) || dy <= 0) { if (dx > 12) py = null; pull = 0; ptr.style.opacity = 0; return; }
      pull = Math.min(dy * 0.5, 150);
      ptr.style.transition = "none";
      ptr.style.opacity = Math.min(1, pull / 90);
      ptr.style.transform = `translateY(${pull - 70}px)`;
      ptrIcon.style.transform = `rotate(${pull * 4}deg)`;
    }, { passive: true });
    strip.addEventListener("touchend", () => {
      if (py === null) return;
      py = null;
      if (pull >= 120) { ptr.classList.add("go"); setTimeout(() => location.reload(), 250); return; }
      ptr.style.transition = "transform .25s, opacity .25s"; ptr.style.transform = "translateY(-60px)"; ptr.style.opacity = 0;
    }, { passive: true });

    let t;
    strip.addEventListener("scroll", () => { this._mark(); clearTimeout(t); t = setTimeout(() => this._remember(), 150); }, { passive: true });
    this._onLoc = () => { this._fromUrl(); this._popScroll(); };
    window.addEventListener("location-changed", this._onLoc);
    // first position once the strip has a real width (panel views lay the card out late); keep the page on resize
    let first = true;
    new ResizeObserver(() => {
      if (!strip.clientWidth) return;
      if (first) { first = false; if (!this._fromUrl()) this._go(this._saved() ?? this._config.start ?? 0, false); }
      else { this._go(this._cur ?? this._index(), false); if (this._openSettings) this._openSettings(!!this._setOpen); }
    }).observe(strip);
  }

  // pop-ups listed in config.scroll_to ({"#whats-on": ["Today", "Tomorrow"]}) open at the top, then
  // glide to the first card whose subtitle starts with one of those words
  _deep(root, test, out = [], d = 0) {
    if (!root || d > 25) return out;
    for (const el of root.querySelectorAll("*")) {
      if (test(el)) out.push(el);
      if (el.shadowRoot) this._deep(el.shadowRoot, test, out, d + 1);
    }
    return out;
  }
  _popScroll() {
    const words = (this._config.scroll_to || {})[location.hash];
    if (!words || !this.shadowRoot) return;
    let tries = 0;
    const find = () => {
      const pop = this._deep(this.shadowRoot, (el) => el.classList && el.classList.contains("bubble-pop-up")
        && el.classList.contains("is-popup-opened"))[0];
      const box = pop && this._deep(pop, (el) => el.classList && el.classList.contains("bubble-pop-up-container"))[0];
      if (!box) { if (tries++ < 20) setTimeout(find, 100); return; }
      box.scrollTop = 0;
      setTimeout(() => {
        const ps = this._deep(box, (el) => el.tagName === "P");
        let hit = null;
        for (const w of words) { hit = ps.find((p) => p.textContent.trim().startsWith(w)); if (hit) break; }
        if (!hit) return;
        const top = hit.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 72;
        // ease-in-out glide instead of the browser's built-in smooth scroll
        const from = box.scrollTop, to = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight)), dur = 1100;
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) { box.scrollTop = to; return; }
        const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          box.scrollTop = from + (to - from) * ease(k);
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, 900);
    };
    setTimeout(find, 100);
  }

  // wallpaper that follows the time of day: colours blend between these hours, 165° gradient,
  // 4 stops; all dark enough for white text. Preview any hour with ?sky=13.5
  _timeStops() {
    const K = [
      [0,    ["#141a3a", "#0e1430", "#231c48", "#3a2350"]],   // night
      [5,    ["#141a3a", "#0e1430", "#231c48", "#3a2350"]],
      [6.5,  ["#3b4f8f", "#5a5a9e", "#c47a8e", "#e39a74"]],   // dawn
      [8.5,  ["#4a7fd0", "#3f6cc0", "#6a83cf", "#b993ad"]],   // morning
      [12.5, ["#3f86dc", "#2f6cc8", "#4a7fd4", "#7fa7dd"]],   // midday
      [16,   ["#4876c8", "#34529e", "#6a5fa8", "#c28394"]],   // late afternoon
      [18.5, ["#4b6cb7", "#2c3e7a", "#5b3f8c", "#b06a7a"]],   // sunset (the original wallpaper)
      [20.5, ["#2c3a78", "#1e2758", "#3b2a66", "#6a3a6a"]],   // dusk
      [22,   ["#141a3a", "#0e1430", "#231c48", "#3a2350"]],   // night
      [24,   ["#141a3a", "#0e1430", "#231c48", "#3a2350"]],
    ];
    const q = Number(new URLSearchParams(location.search).get("sky"));
    const d = new Date(), h = Number.isFinite(q) && q > 0 ? q : d.getHours() + d.getMinutes() / 60;
    let i = 0; while (i < K.length - 2 && K[i + 1][0] <= h) i++;
    const [h0, a] = K[i], [h1, b] = K[i + 1], f = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
    const mix = (x, y) => "#" + [1, 3, 5].map((k) => Math.round(parseInt(x.substr(k, 2), 16) * (1 - f) + parseInt(y.substr(k, 2), 16) * f)
      .toString(16).padStart(2, "0")).join("");
    return a.map((c, k) => mix(c, b[k]));
  }
  _paintSky() {
    if (!this._sky) return;
    const p = PhonePagerCard.PRESETS.find((x) => x[0] === this._wall());
    this._sky.style.background = this._grad(p && p[3] ? p[3] : this._timeStops());
    this._markSwatches();
  }

  // wallpaper presets: 'time' follows the clock (see _paintSky); the rest are fixed 4-stop gradients, all dark
  // enough for white text
  static get PRESETS() {
    return [
      ["time", "Time of day", "Shifts from dawn to night", null],
      ["sunset", "Sunset", "Blue to rose", ["#4b6cb7", "#2c3e7a", "#5b3f8c", "#b06a7a"]],
      ["dawn", "Dawn", "Blue to peach", ["#3b4f8f", "#5a5a9e", "#b4728a", "#d48e6c"]],
      ["ocean", "Ocean", "Deep teal", ["#1f6fa8", "#134f7e", "#0f3a5e", "#1d7f8a"]],
      ["forest", "Forest", "Pine and moss", ["#2f5d50", "#1e3f37", "#28483a", "#5f7448"]],
      ["aurora", "Aurora", "Green to violet", ["#1b2a4a", "#1d5b66", "#2f7a68", "#6a4a8c"]],
      ["rose", "Rose", "Plum to coral", ["#6a3f78", "#4e3366", "#8a4f78", "#c27c72"]],
      ["graphite", "Graphite", "Quiet greys", ["#3c4048", "#26282d", "#2f3137", "#4b4f57"]],
      ["midnight", "Midnight", "Navy, always", ["#141a3a", "#0e1430", "#231c48", "#3a2350"]],
    ];
  }
  _grad(s) { return `linear-gradient(165deg, ${s[0]} 0%, ${s[1]} 38%, ${s[2]} 70%, ${s[3]} 100%)`; }
  _wall() { return (this._prefs && this._prefs.wallpaper) || "time"; }
  // per-user prefs live in Home Assistant's own per-user frontend store (follows the login, not the device);
  // a localStorage copy paints the right wallpaper before the websocket answers
  async _loadPrefs() {
    try { this._prefs = JSON.parse(localStorage.getItem("phone-pager-prefs") || "{}"); } catch (e) { this._prefs = {}; }
    this._paintSky();
    try {
      const r = await this._hass.callWS({ type: "frontend/get_user_data", key: "phone-pager" });
      if (r && r.value) { this._prefs = r.value; try { localStorage.setItem("phone-pager-prefs", JSON.stringify(r.value)); } catch (e) {} }
    } catch (e) {}
    this._paintSky(); this._markSwatches();
  }
  async _savePrefs(patch) {
    this._prefs = { ...(this._prefs || {}), ...patch };
    try { localStorage.setItem("phone-pager-prefs", JSON.stringify(this._prefs)); } catch (e) {}
    this._paintSky(); this._markSwatches();
    try { await this._hass.callWS({ type: "frontend/set_user_data", key: "phone-pager", value: this._prefs }); } catch (e) {}
  }
  // Settings is built from Home Assistant's own sections + cards (title markdown, heading card, a wallpaper card),
  // so its spacing comes from the same layout engine as the pages. Override with `settings_sections`.
  _settingsSections() {
    const white = "ha-card { --primary-text-color: #fff; --secondary-text-color: rgba(255,255,255,.8); color: #fff; }";
    return this._config.settings_sections || [
      { type: "grid", cards: [{ type: "markdown", text_only: true, grid_options: { columns: "full" },
        content: "# Settings\n\nSaved to {{ user }}'s account, so it follows you to every device.",
        card_mod: { style: white + " ha-card { height: 112px !important; box-sizing: border-box; overflow: hidden; }" } }] },
      { type: "grid", cards: [
        { type: "heading", heading: "Wallpaper", heading_style: "title", icon: "mdi:palette-outline", card_mod: { style: white } },
        { type: "custom:phone-wallpaper-card", grid_options: { columns: "full", rows: "auto" } }] },
    ];
  }
  _settingsPage() {
    const div = document.createElement("div");
    div.className = "page";
    const inner = document.createElement("div");
    inner.className = "inner"; div.appendChild(inner);
    this._settingsSections().forEach((cfg, i) => {
      const s = document.createElement("hui-section");
      s.hass = this._hass; s.lovelace = this._ll; s.config = cfg; s.index = 900 + i; s.viewIndex = 0; s.preview = false;
      inner.appendChild(s); this._live.push(s);
    });
    return div;
  }
  _markSwatches() { window.dispatchEvent(new CustomEvent("phone-pager-prefs")); }


  // cards and sections that come and go (alerts, TV, bedtime…) fade instead of popping: HA hides them through
  // _setElementVisibility on hui-card / hui-section; inside this pager we fade out first, then let HA hide, and fade in
  // after HA shows. Everywhere else HA's behaviour is untouched.
  static patchFades() {
    for (const tag of ["hui-card", "hui-section"]) {
      const C = customElements.get(tag);
      if (!C || C.prototype.__phoneFade || typeof C.prototype._setElementVisibility !== "function") continue;
      const orig = C.prototype._setElementVisibility;
      C.prototype.__phoneFade = true;
      C.prototype._setElementVisibility = function (show) {
        // where am I? → the pager page I'm on (null = not in the pager: HA behaves as usual)
        let page = null;
        for (let n = this, i = 0; i < 60 && n; i++) {
          if (n.classList && n.classList.contains("page")) page = page || n;
          if (n.tagName === "PHONE-PAGER-CARD") break;
          n = n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode;
          if (!n) page = null;
        }
        const changing = this.hidden === !!show;
        if (!changing || !this.isConnected || !page || matchMedia("(prefers-reduced-motion: reduce)").matches)
          return orig.call(this, show);
        if (show) {
          if (this.__fadeOut) { this.__fadeOut.cancel(); this.__fadeOut = null; return; }   // came back mid-fade
          // a card appearing inside a still-hidden section (e.g. the first alert): no fade of its own — the section's
          // fade brings the heading and the card in together
          if (tag === "hui-card") {
            let sec = this;
            for (let i = 0; i < 40 && sec && sec.tagName !== "HUI-SECTION"; i++)
              sec = sec.parentNode && sec.parentNode.nodeType === 11 ? sec.parentNode.host : sec.parentNode;
            if (sec && sec.hidden) return orig.call(this, show);
          }
          PhonePagerCard.flip(page, () => orig.call(this, show));
          this.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 120, easing: "ease-out", fill: "backwards" });
          return;
        }
        if (this.__fadeOut) return;
        const a = this.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-in", fill: "forwards" });
        this.__fadeOut = a;
        a.onfinish = () => {
          if (this.__fadeOut !== a) return;
          this.__fadeOut = null;
          PhonePagerCard.flip(page, () => { orig.call(this, false); a.cancel(); });   // what's below glides up
        };
      };
    }
  }
  // FLIP: note where every section and card on the page sits, make the change, wait for HA's grid to re-lay out
  // (Lit updates in microtasks, before the next paint), then animate each moved item from its old spot to the new one
  static async flip(page, change) {
    const deep = (r, test, o = [], d = 0) => { if (!r || d > 25) return o; for (const el of r.querySelectorAll("*")) { if (test(el)) o.push(el); if (el.shadowRoot) deep(el.shadowRoot, test, o, d + 1); } return o; };
    const secs = deep(page, (el) => el.tagName === "HUI-SECTION");
    const cards = deep(page, (el) => el.tagName === "HUI-CARD");
    const top = (el) => el.getBoundingClientRect().top;
    const before = new Map([...secs, ...cards].map((el) => [el, top(el)]));
    change();
    const waits = [];
    for (const s of secs) { if (s.updateComplete) waits.push(s.updateComplete); if (s._layoutElement && s._layoutElement.updateComplete) waits.push(s._layoutElement.updateComplete); }
    await Promise.all(waits).catch(() => {});
    const secOf = (el) => { for (let n = el, i = 0; i < 40 && n; i++) { n = n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode; if (n && n.tagName === "HUI-SECTION") return n; } return null; };
    const moved = new Map();
    for (const el of secs) if (!el.hidden) moved.set(el, before.get(el) - top(el));
    const ease = { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" };
    for (const [el, dy] of moved) if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], ease);
    for (const el of cards) {
      if (el.hidden || !before.has(el)) continue;
      const s = secOf(el), dy = (before.get(el) - top(el)) - (s ? moved.get(s) || 0 : 0);   // only its own move within the section
      // hui-card renders inline (transforms don't apply) → move the grid cell it sits in
      const box = getComputedStyle(el).display === "inline" && el.parentElement ? el.parentElement : el;
      if (Math.abs(dy) > 1) box.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], ease);
    }
  }

  // HA's own more-info dialogs (e.g. a Sonos player) in the frosted pop-up style — set on the dialog element only, and
  // only while this dashboard is on screen
  static get DIALOG_VARS() {
    const glass = "rgba(22, 24, 42, 0.62)", blur = "blur(30px) saturate(160%)", card = "rgba(255,255,255,0.10)";
    return {
      "--ha-dialog-surface-background": glass, "--ha-bottom-sheet-surface-background": glass,
      "--ha-dialog-surface-backdrop-filter": blur, "--ha-bottom-sheet-surface-backdrop-filter": blur,
      "--ha-bottom-sheet-scrim-color": "rgba(14, 16, 40, 0.18)", "--mdc-dialog-scrim-color": "rgba(14, 16, 40, 0.18)",
      "--ha-dialog-border-radius": "28px", "--ha-bottom-sheet-border-radius": "28px",
      "--primary-text-color": "#fff", "--secondary-text-color": "rgba(255,255,255,0.65)",
      "--ha-dialog-header-title-color": "#fff", "--ha-dialog-header-subtitle-color": "rgba(255,255,255,0.65)",
      "--ha-card-background": card, "--card-background-color": card, "--ha-card-border-radius": "18px",
      "--divider-color": "rgba(255,255,255,0.15)", "--state-icon-color": "rgba(255,255,255,0.85)",
      "--ha-bottom-sheet-handle-color": "rgba(255,255,255,0.4)",
      // accents white, like iOS: sliders, progress, play/pause
      "--primary-color": "#ffffff", "--text-primary-color": "#1c1c2a", "--accent-color": "#ffffff",
      "--ha-color-fill-primary-quiet-resting": "rgba(255,255,255,0.16)", "--ha-color-fill-primary-normal-resting": "rgba(255,255,255,0.22)",
      "--ha-color-fill-primary-loud-resting": "#ffffff", "--ha-color-fill-primary-loud-hover": "#f2f2f2",
      "--ha-color-on-primary-quiet": "#ffffff", "--ha-color-on-primary-normal": "#ffffff", "--ha-color-on-primary-loud": "#1c1c2a",
      "--slider-track-color": "rgba(255,255,255,0.25)",
      // HA buttons (the centre play/pause) take Web Awesome "brand" colours, resolved once at the page root, so set them
      // here directly: a frosted white circle with a white icon (a solid white one hid its icon — icons share one colour)
      "--wa-color-brand-fill-quiet": "rgba(255,255,255,0.22)", "--wa-color-brand-fill-normal": "rgba(255,255,255,0.22)",
      "--wa-color-brand-fill-loud": "rgba(255,255,255,0.22)",
      "--wa-color-brand-on-quiet": "#ffffff", "--wa-color-brand-on-normal": "#ffffff", "--wa-color-brand-on-loud": "#ffffff",
      "--wa-color-brand-border-quiet": "transparent", "--wa-color-brand-border-normal": "transparent", "--wa-color-brand-border-loud": "transparent",
      // HA's newer colour tokens (titles, transport icons, round buttons)
      "--ha-color-text-primary": "#fff", "--ha-color-text-secondary": "rgba(255,255,255,0.65)",
      "--ha-color-on-neutral-normal": "#fff", "--ha-color-on-neutral-quiet": "rgba(255,255,255,0.85)", "--ha-color-on-neutral-loud": "#fff",
      "--icon-primary-color": "#fff", "--control-button-icon-color": "#fff", "--control-button-background-color": "rgba(255,255,255,0.9)",
      "--control-button-background-opacity": "0.14",
      "--ha-color-fill-neutral-quiet-resting": "rgba(255,255,255,0.08)", "--ha-color-fill-neutral-quiet-hover": "rgba(255,255,255,0.14)",
      "--ha-color-fill-neutral-quiet-active": "rgba(255,255,255,0.18)",
      "--ha-color-fill-neutral-normal-resting": "rgba(255,255,255,0.14)", "--ha-color-fill-neutral-normal-hover": "rgba(255,255,255,0.2)",
      "--ha-color-fill-neutral-normal-active": "rgba(255,255,255,0.24)",
      "--ha-color-fill-neutral-loud-resting": "rgba(255,255,255,0.24)", "--ha-color-fill-neutral-loud-hover": "rgba(255,255,255,0.3)",
      "--ha-color-fill-neutral-loud-active": "rgba(255,255,255,0.34)",
      "--ha-color-border-neutral-quiet": "rgba(255,255,255,0.12)", "--ha-color-border-neutral-normal": "rgba(255,255,255,0.2)",
      "--ha-color-border-neutral-loud": "rgba(255,255,255,0.3)",
    };
  }
  _frostDialogs(on) {
    const ha = document.querySelector("home-assistant"), root = ha && ha.shadowRoot;
    if (!root) return;
    const apply = (el) => {
      for (const [k, v] of Object.entries(PhonePagerCard.DIALOG_VARS)) on ? el.style.setProperty(k, v) : el.style.removeProperty(k);
      // plain inherited text colour was already resolved (near-black) above the dialog, so set it here too
      on ? el.style.setProperty("color", "#fff") : el.style.removeProperty("color");
    };
    root.querySelectorAll("ha-more-info-dialog").forEach(apply);
    if (this._dlgObs) { this._dlgObs.disconnect(); this._dlgObs = null; }
    if (on) {
      this._dlgObs = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.tagName === "HA-MORE-INFO-DIALOG") apply(n);
      })));
      this._dlgObs.observe(root, { childList: true });
    }
  }

  // elastic reveal of the Settings sheet: iOS-style rubber band (resistance grows with distance); release past ~28%
  // of the width opens / closes it, otherwise it springs back with a little overshoot
  _elastic(strip) {
    const W = () => strip.clientWidth || window.innerWidth;
    const rub = (d) => (1 - 1 / ((d * 0.85) / W() + 1)) * W();   // lighter resistance
    const SPRING = "transform .38s cubic-bezier(.25,1.08,.45,1), opacity .3s";   // gentle, barely overshoots
    const GLIDE = "transform .36s cubic-bezier(.25,.8,.25,1), opacity .3s";
    const set = (sx, ox, op, tr) => {
      strip.style.transition = this._setw.style.transition = tr || "none";
      strip.style.transform = `translateX(${sx}px)`; strip.style.opacity = op;
      this._setw.style.transform = `translateX(${ox}px)`;
    };
    this._openSettings = (open) => {
      this._setOpen = open;
      set(open ? -W() * 0.3 : 0, open ? 0 : W(), open ? 0 : 1, GLIDE);
      this._mark();
    };
    let x0 = null, y0 = 0, mode = null, r = 0;
    const atEnd = () => strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 2;
    const start = (e, which) => {
      if (location.hash || e.touches.length !== 1) { x0 = null; return; }
      if (which === "open" && (this._setOpen || !atEnd())) { x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; mode = null; r = 0; this._which = which;
    };
    const move = (e) => {
      if (x0 === null) return;
      const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
      if (!mode) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mode = Math.abs(dx) > Math.abs(dy) && (this._which === "open" ? dx < 0 : dx > 0) ? "h" : "v";
      }
      if (mode !== "h") return;
      r = rub(Math.abs(dx));
      if (this._which === "open") set(-r, W() - r, 1 - (r / W()) * 0.4);
      else set(-W() * 0.3 + (r / W()) * W() * 0.3, r, r / W());
    };
    const end = () => {
      if (x0 === null) return;
      x0 = null;
      if (mode !== "h") return;
      const far = r > W() * 0.36;   // commit a little later (was 0.28: "too aggressive")
      if (this._which === "open") far ? this._openSettings(true) : set(0, W(), 1, SPRING);
      else far ? this._openSettings(false) : set(-W() * 0.3, 0, 0, SPRING);
    };
    strip.addEventListener("touchstart", (e) => start(e, "open"), { passive: true });
    this._setw.addEventListener("touchstart", (e) => start(e, "close"), { passive: true });
    for (const el of [strip, this._setw]) {
      el.addEventListener("touchmove", move, { passive: true });
      el.addEventListener("touchend", end, { passive: true });
      el.addEventListener("touchcancel", end, { passive: true });
    }
    // the sheet keeps its gestures: nothing above it (e.g. a swipe-to-open-sidebar handler) sees them, and a sideways
    // drag on it is claimed
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"])
      this._setw.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === "touchmove" && mode === "h" && e.cancelable) e.preventDefault();
      }, { passive: false });
    set(0, W(), 1);
  }

  _index() { return this._strip ? Math.round(this._strip.scrollLeft / Math.max(1, this._strip.clientWidth)) : 0; }
  _mark() { const i = this._index(); this._cur = i; (this._buttons || []).forEach((b, k) => b.classList.toggle("on", k === i && !this._setOpen)); }
  _go(i, smooth) {
    if (!this._strip) return;
    this._strip.scrollTo({ left: i * this._strip.clientWidth, behavior: smooth ? "smooth" : "instant" });
    this._mark(); this._remember(i);
  }
  _saved() { try { const v = sessionStorage.getItem("phone-pager"); return v === null ? null : Number(v); } catch (e) { return null; } }
  _remember(i = this._index()) { if (i >= this._config.pages.length) return; try { sessionStorage.setItem("phone-pager", String(i)); } catch (e) {} }
  _fromUrl() {   // ?page=media (from a tile's navigate action) → scroll there, then tidy the URL
    const want = new URLSearchParams(location.search).get("page");
    if (!want) return false;
    const i = this._config.pages.findIndex((p) => p.name.toLowerCase() === want.toLowerCase());
    history.replaceState(history.state, "", location.pathname + location.hash);
    if (i < 0) return false;
    this._go(i, true);
    return true;
  }

  connectedCallback() { if (this._onLoc) window.addEventListener("location-changed", this._onLoc); if (this._built) this._frostDialogs(true); }
  disconnectedCallback() { if (this._onLoc) window.removeEventListener("location-changed", this._onLoc); this._frostDialogs(false); }
  getCardSize() { return 12; }
}
customElements.define("phone-pager-card", PhonePagerCard);

// phone-wallpaper-card: the swatch grid on the Settings page. Talks to the pager that's on screen.
class PhoneWallpaperCard extends HTMLElement {
  setConfig(config) { this._config = config; }
  set hass(hass) { this._hass = hass; if (!this._done) this._render(); }
  connectedCallback() { this._onPrefs = () => this._mark(); window.addEventListener("phone-pager-prefs", this._onPrefs); this._mark(); }
  disconnectedCallback() { window.removeEventListener("phone-pager-prefs", this._onPrefs); }
  _render() {
    this._done = true;
    const pager = window.__phonePager, P = PhonePagerCard.PRESETS;
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { display: block; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ha-section-grid-column-gap, 16px); }
      .sw { all: unset; position: relative; height: 157px;   /* tall tile height */ border-radius: 18px; cursor: pointer; box-sizing: border-box;
        padding: 14px 16px; display: flex; flex-direction: column; justify-content: flex-end; color: #fff;
        font: 600 15px var(--ha-font-family-body, Roboto, sans-serif); -webkit-tap-highlight-color: transparent;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); transition: transform .15s, box-shadow .2s; }
      .sw small { font-weight: 400; font-size: 12px; opacity: .75; margin-top: 2px; }
      .sw:active { transform: scale(.97); }
      .sw.on { box-shadow: inset 0 0 0 3px #fff; }
      .sw ha-icon { position: absolute; top: 12px; right: 12px; --mdc-icon-size: 22px; opacity: 0; }
      .sw.on ha-icon { opacity: 1; }
    </style><div class="grid"></div>`;
    const grid = root.querySelector(".grid");
    for (const [id, label, sub, stops] of P) {
      const b = document.createElement("button");
      b.className = "sw"; b.dataset.id = id;
      b.innerHTML = `<ha-icon icon="mdi:check-circle"></ha-icon>${label}<small>${sub}</small>`;
      if (stops && pager) b.style.background = pager._grad(stops);
      b.addEventListener("click", () => window.__phonePager && window.__phonePager._savePrefs({ wallpaper: id }));
      grid.appendChild(b);
    }
    this._mark();
  }
  _mark() {
    const pager = window.__phonePager;
    if (!pager || !this.shadowRoot) return;
    for (const b of this.shadowRoot.querySelectorAll(".sw")) {
      b.classList.toggle("on", b.dataset.id === pager._wall());
      if (b.dataset.id === "time") b.style.background = pager._grad(pager._timeStops());
    }
  }
  getCardSize() { return 5; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
}
customElements.define("phone-wallpaper-card", PhoneWallpaperCard);

// phone-now-playing-card: an iPhone-lock-screen style "Now Playing" card for one media player.
// Config: { type: custom:phone-now-playing-card, entity: media_player.x, name: "Kitchen + 2" }
// Blurred album art behind, the art itself on the left, then three bottom-left lines in the tile text style:
// room/group (small), song title (bold), artist. Tapping it opens Home Assistant's
// more-info dialog, which has the controls.
class PhoneNowPlayingCard extends HTMLElement {
  setConfig(config) { if (!config.entity) throw new Error("entity required"); this._config = config; }
  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot) this._build();
    this._update();
  }
  _build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { display: block; }
      ha-card { position: relative; height: 157px;   /* the tall tile height (2.4 rows) — only two tile heights */ overflow: hidden; border-radius: 18px; border: none; box-shadow: none;
        background: rgba(28,28,40,0.32); color: #fff; cursor: pointer; isolation: isolate; clip-path: inset(0 round 18px);
        animation: npIn .38s ease-out; }
      @keyframes npIn { from { opacity: 0; transform: scale(.97); } }
      .bg { position: absolute; inset: -30px; background-size: cover; background-position: center; filter: blur(28px) saturate(1.5);
        transform: scale(1.15); opacity: .9; transition: background-image .6s; z-index: -2; }
      .shade { position: absolute; inset: 0; background: linear-gradient(100deg, rgba(10,10,20,.55), rgba(10,10,20,.25)); z-index: -1; }
      .row { display: flex; gap: 16px; padding: 16px; height: 100%; box-sizing: border-box; align-items: center; }
      .art { flex: 0 0 125px; height: 125px; border-radius: 12px; background: rgba(255,255,255,.12) center/cover no-repeat;
        box-shadow: 0 8px 24px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; }
      .art ha-icon { --mdc-icon-size: 40px; opacity: .7; }
      /* text follows the tile convention: name 14px/600, state line 12px/400, bottom-aligned 16px up */
      .meta { flex: 1; min-width: 0; height: 125px; display: flex; flex-direction: column; justify-content: flex-end; }
      .name { font: 600 14px/16px var(--ha-font-family-body, Roboto, sans-serif); letter-spacing: .1px; color: rgba(255,255,255,0.95);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font: 400 12px/14.4px var(--ha-font-family-body, Roboto, sans-serif); letter-spacing: .4px;
        color: rgba(255,255,255,0.62); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* 3 lines, bottom-left: room small · song title bold · artist */
      .sub.r { margin-bottom: 9px; }   /* same line rhythm as a tile: name top → state top = 25px */
      .sub.a { margin-top: 9px; color: rgba(255,255,255,0.85); }
    </style>
    <ha-card><div class="bg"></div><div class="shade"></div>
      <div class="row"><div class="art"></div>
        <div class="meta"><div class="sub r"></div><div class="name"></div><div class="sub a"></div></div></div></ha-card>`;   /* controls: a tap away */
    const $ = (s) => root.querySelector(s);
    this._el = { bg: $(".bg"), art: $(".art"), room: $(".sub.r"), name: $(".name"), artist: $(".sub.a") };
    $("ha-card").addEventListener("click", () => this.dispatchEvent(new CustomEvent("hass-more-info",
      { detail: { entityId: this._config.entity }, bubbles: true, composed: true })));
  }
  _update() {
    const s = this._hass && this._hass.states[this._config.entity];
    if (!s || !this._el) return;
    const a = s.attributes, e = this._el;
    const pic = a.entity_picture ? `url("${a.entity_picture}")` : "";
    if (e._pic !== pic) {
      e._pic = pic; e.bg.style.backgroundImage = pic; e.art.style.backgroundImage = pic;
      e.art.innerHTML = pic ? "" : '<ha-icon icon="mdi:music"></ha-icon>';
    }
    e.room.textContent = this._config.name || a.friendly_name || "";
    e.name.textContent = a.media_title || a.media_channel || "Playing";
    e.artist.textContent = a.media_artist || a.media_album_name || "";
    e.artist.style.display = e.artist.textContent ? "" : "none";
  }
  disconnectedCallback() { clearInterval(this._tick); }
  getCardSize() { return 3; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
}
customElements.define("phone-now-playing-card", PhoneNowPlayingCard);
window.customCards.push({ type: "phone-now-playing-card", name: "Now playing", description: "Lock-screen style now-playing card." });
window.customCards = window.customCards || [];
window.customCards.push({ type: "phone-pager-card", name: "Phone pager", description: "Pages side by side, snap-scrolled sideways." });
