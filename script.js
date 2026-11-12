(function(){
  'use strict';

  // ---- Constants ----
  const COLS = 11, ROWS = 20;  // 11 wide fits "4 0 4" with a one-column gap between digits
  const CLEAR_MS = 320;        // blink duration before rows are removed
  const SHAKE_MS = 320;
  const BEST_KEY = 'find404_best';
  const MAX_CELL = 30, MIN_CELL = 14;
  const FRAME = 16.667;        // one 60fps frame; physics are scaled to it

  // Game-feel timings (keyboard). Touch keeps its 110ms repeat.
  const DAS_DELAY = 150;
  const ARR = 40;
  const SOFT_RATE = 35;
  const LOCK_DELAY = 500;
  const MAX_LOCK_RESETS = 15;

  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Piece palette: the brand's purple family (design system), one hue, seven shades
  const COLORS = {
    I:'#AB8CF0', J:'#7D68AE', T:'#8A2BE2', S:'#BEADD6',
    L:'#9940E6', Z:'#6E5A9A', O:'#A762E7'   // J and Z lifted to reach 3:1 on the well
  };

  // The 404 is set in cream "ink" blocks, 3 wide and 5 tall per digit
  const DIGIT = 'D';
  const INK = '#E9E7E1';
  const GLYPHS = {
    '4':['101','101','111','001','001'],
    '0':['111','101','101','101','111']
  };
  const WORD = [['4',0],['0',4],['4',8]];   // digit and its left column
  const DIGIT_ROWS = 5;
  const GOAL = 3;              // rows of the 404 to clear before the way home opens

  const SHAPES = {
    I:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O:[[1,1],[1,1]],
    T:[[0,1,0],[1,1,1],[0,0,0]],
    S:[[0,1,1],[1,1,0],[0,0,0]],
    Z:[[1,1,0],[0,1,1],[0,0,0]],
    J:[[1,0,0],[1,1,1],[0,0,0]],
    L:[[0,0,1],[1,1,1],[0,0,0]]
  };
  const KICKS = [0,-1,1,-2,2];
  const SCORE_TABLE = [0,100,300,500,800];
  // Line clears in sentences, the number word in italics like "Lost?"
  const CLEAR_NAME = [null,['One','row.'],['Two','rows.'],['Three','rows.'],['Four','rows.']];

  // ---- Elements ----
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const boardCanvas = $('board'), bctx = boardCanvas.getContext('2d');
  const nextCanvas = $('next'), nctx = nextCanvas.getContext('2d');
  const topEl = $('top'), annEl = $('announce'), annName = $('aname'), annPts = $('apts');
  const confettiCanvas = $('confetti'), cctx = confettiCanvas.getContext('2d');
  const vignetteEl = $('vignette'), overEl = $('over'), againBtn = $('again');
  const pauseBtn = $('pauseBtn'), startEl = $('start'), startText = $('startText');
  const foundEl = $('found'), foundHome = $('foundHome'), keepBtn = $('keepPlaying');
  const leftBox = document.querySelector('.stat-left');
  const shakeWrap = document.querySelector('.shake');
  const CONFETTI_COLORS = ['#8A2BE2', '#AB8CF0', INK];

  const isTouch = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
  if(isTouch){
    document.body.classList.add('touch-on');
    startText.textContent = 'Tap to play';
    startText.setAttribute('data-text', 'Tap to play');
  }

  const theme = { well:'#171717', grid:'#1d1d1d', muted:'#A6A6A2' };
  function readTheme(){
    const cs = getComputedStyle(root);
    theme.well  = cs.getPropertyValue('--well').trim()  || theme.well;
    theme.grid  = cs.getPropertyValue('--grid').trim()  || theme.grid;
    theme.muted = cs.getPropertyValue('--muted').trim() || theme.muted;
  }

  function readBest(){
    try{ return parseInt(localStorage.getItem(BEST_KEY)||'0',10) || 0; } catch(e){ return 0; }
  }
  function saveBest(v){ try{ localStorage.setItem(BEST_KEY, String(v)); } catch(e){} }

  // ---- Sizing: fit the whole page in the viewport ----
  let CELL = MAX_CELL, NEXT_W = 116, NEXT_H = 116;
  const QUEUE = 3;             // pieces shown in the Next box
  function px(v){ return parseFloat(v) || 0; }
  function fitCell(){
    const rs = getComputedStyle(root), bs = getComputedStyle(document.body);
    const frameExtra = 22;
    const availW = root.clientWidth - px(bs.paddingLeft) - px(bs.paddingRight)
                 - px(rs.getPropertyValue('--panel')) - px(rs.getPropertyValue('--gap')) - frameExtra;
    const kids = Array.prototype.filter.call(document.body.children, el=>{
      if(el.tagName==='SCRIPT') return false;
      const s = getComputedStyle(el);
      return s.position!=='fixed' && s.display!=='none';
    });
    let other = px(bs.paddingTop) + px(bs.paddingBottom) + px(bs.rowGap)*(kids.length-1) + frameExtra;
    for(const el of kids){ if(!el.classList.contains('game')) other += el.offsetHeight; }
    // phones: the panel sits in a row above the board, so its height counts too
    const game = document.querySelector('.game');
    if(getComputedStyle(game).flexDirection === 'column'){
      other += document.querySelector('.panel').offsetHeight + px(getComputedStyle(game).rowGap);
    }
    const availH = window.innerHeight - other;
    return Math.max(MIN_CELL, Math.floor(Math.min(MAX_CELL, availW/COLS, availH/ROWS)));
  }
  function setupCanvas(canvas, ctx, w, h){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.imageSmoothingEnabled = false;
  }
  function resize(){
    readTheme();
    const prev = CELL;
    CELL = fitCell();
    root.style.setProperty('--cell', CELL+'px');
    if(particles.length && prev !== CELL){
      const k = CELL/prev;
      for(const p of particles){ p.x*=k; p.y*=k; p.size*=k; }
    }
    setupCanvas(boardCanvas, bctx, COLS*CELL, ROWS*CELL);
    const box = document.querySelector('.next'), bs = getComputedStyle(box);
    // The queue canvas fills the Next box below its label (the box's size never depends on the canvas)
    const label = box.querySelector('.k');
    const top = label.offsetTop + label.offsetHeight + 10;
    NEXT_W = Math.max(40, Math.floor(box.clientWidth - px(bs.paddingLeft) - px(bs.paddingRight)));
    NEXT_H = Math.max(24, Math.floor(box.clientHeight - top - px(bs.paddingBottom)));
    nextCanvas.style.left = px(bs.paddingLeft) + 'px';
    nextCanvas.style.top = top + 'px';
    setupCanvas(nextCanvas, nctx, NEXT_W, NEXT_H);
    sizeConfetti();
    if(grid) render();
  }


  // ============================================================
  //  transitions.dev orchestration, adapted to this page's elements
  // ============================================================
  function cssMs(name, fallback){
    const v = parseFloat(getComputedStyle(root).getPropertyValue(name));
    return Number.isNaN(v) ? fallback : v;
  }

  // ---- Number subtle change (Score, Best) ----
  function subtleSet(el, prevNum, next, animate){
    const str = next.toLocaleString("en-US");
    el.setAttribute("aria-label", str);
    if(!animate){ el.classList.remove("is-animating"); el.textContent = str; return; }
    const prev = prevNum.toLocaleString("en-US");
    const sameLength = prev.length === str.length;
    el.style.setProperty("--subtle-dir", next >= prevNum ? "1" : "-1");
    el.classList.remove("is-animating");
    el.replaceChildren();
    [...str].forEach((ch, i) => {
      if (sameLength && prev[i] === ch) { el.append(ch); return; }
      const slot = document.createElement("span");
      slot.className = "t-subtle-slot";
      if (sameLength) {
        const old = document.createElement("span");
        old.className = "t-subtle-old";
        old.setAttribute("aria-hidden", "true");
        old.textContent = prev[i];
        slot.appendChild(old);
      }
      const fresh = document.createElement("span");
      fresh.className = "t-subtle-new";
      fresh.textContent = ch;
      slot.appendChild(fresh);
      el.appendChild(slot);
    });
    void el.offsetHeight; // force reflow
    el.classList.add("is-animating");
  }

  // ---- Spinning counter (404 rows left), engine copied verbatim ----
  // Wrapped in its own scope: its CLEAR_MS and helper names would clash with the game's.
  const Reel = (function(){
  const STEP = (50 * Math.PI) / 180; // drum angle between two digits
  const ENTER_MS = 120;              // rest to rolling
  const FADE_END = 1.8;              // steps from the middle where a digit is gone
  const LAND_AT = 0.6;               // steps from the middle where the target starts landing
  const ARRIVE_AT = 0.29;            // share of the spring where it reaches the middle
  const CLEAR_MS = 200;              // blur + neighbours clearing at the start of the spring

  function token(name, fallback) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isNaN(v) ? fallback : v;
  }
  // Lengths are in em (blur is a max() curve on the font size), so they are
  // measured in px on the drum itself and follow whatever size the number uses.
  function length(el, name, fallbackEm) {
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;width:var(${name})`;
    el.appendChild(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px || fallbackEm * (parseFloat(getComputedStyle(el).fontSize) || 24);
  }
  function readTokens(el) {
    const css = getComputedStyle(document.documentElement);
    const m = css.getPropertyValue("--reel-ease").match(/cubic-bezier\(([^)]+)\)/);
    return {
      stepDur: token("--reel-step-dur", 130),
      stagger: token("--reel-stagger", 90),
      ease: bezier(m ? m[1].split(",").map(parseFloat) : [0.35, -0.02, 0.43, 1]),
      offset: length(el, "--reel-side-offset", 0.52),
      sideScale: token("--reel-side-scale", 0.7),
      sideBlur: length(el, "--reel-side-blur", 0.083),
      sideOpacity: token("--reel-side-opacity", 0.17),
      centerScale: token("--reel-center-scale", 0.9),
      centerBlur: length(el, "--reel-center-blur", 0.042),
      anticDur: token("--reel-antic-dur", 100),
      anticScale: token("--reel-antic-scale", 0.94),
      anticLift: length(el, "--reel-antic-lift", 0.125),
      landDur: token("--reel-land-dur", 740),
      landPeak: token("--reel-land-peak", 1.03),
    };
  }
  function bezier([x1, y1, x2, y2]) {
    const at = (a, b, t) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 20; i++) {
        if (at(x1, x2, t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return at(y1, y2, t);
    };
  }
  function smooth(x) {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  }
  // Damped wave: starts at 1, crosses 0, swings negative (the bounce), ends at 0.
  function wave(s) {
    return s >= 1 ? 0 : Math.exp(-3 * s) * Math.cos(3 * Math.PI * s) * (1 - s);
  }
  const WAVE_TROUGH = (() => {
    let low = 0;
    for (let i = 1; i < 400; i++) low = Math.min(low, wave(i / 400));
    return -low;
  })();

  function buildColumns(el, str) {
    el.replaceChildren();
    const cols = [];
    for (const ch of str) {
      if (ch < "0" || ch > "9") {
        const sep = document.createElement("span");
        sep.className = "t-reel-sep";
        sep.textContent = ch;
        el.appendChild(sep);
        continue;
      }
      const col = document.createElement("span");
      col.className = "t-reel-col";
      const sizer = document.createElement("span");
      sizer.className = "t-reel-sizer";
      sizer.textContent = "0";
      col.appendChild(sizer);
      const cells = [];
      for (let d = 0; d < 10; d++) {
        const cell = document.createElement("span");
        cell.className = "t-reel-digit";
        cell.textContent = String(d);
        col.appendChild(cell);
        cells.push(cell);
      }
      el.appendChild(col);
      cols.push({ cells, digit: +ch });
    }
    return cols;
  }
  function rest(col, digit) {
    col.cells.forEach((cell, d) => {
      cell.style.transform = "none";
      cell.style.filter = "none";
      cell.style.zIndex = "";
      cell.style.opacity = d === digit ? "1" : "0";
    });
  }
  function look(dist, middle, o) {
    const angle = Math.min(dist * STEP, Math.PI / 2);
    // 1 in the middle, 0 at one step away, below 0 further back.
    const face = (Math.cos(angle) - Math.cos(STEP)) / (1 - Math.cos(STEP));
    return {
      angle,
      scale: o.sideScale + (middle - o.sideScale) * face,
      back: dist <= 1 ? 1 + (o.sideOpacity - 1) * dist : o.sideOpacity * (1 - (dist - 1) / (FADE_END - 1)),
    };
  }
  function place(col, pos, spread, middle, o, land) {
    const radius = o.offset / Math.sin(STEP);
    col.cells.forEach((cell, d) => {
      let p = (((d - pos) % 10) + 10) % 10;
      if (p > 5) p -= 10;
      const dist = Math.abs(p);
      if (dist >= FADE_END) { cell.style.opacity = "0"; return; }
      const l = look(dist, middle, o);
      // Upcoming digits sit above the middle, so the drum turns downward.
      let y = (p < 0 ? 1 : -1) * radius * Math.sin(l.angle);
      const blur = (o.centerBlur + (o.sideBlur - o.centerBlur) * Math.min(dist, 1)) * spread;
      const away = Math.max(0, Math.min(1, (dist - 0.3) / 0.5));
      let opacity = l.back * (1 - (1 - spread) * away);
      let scale = l.scale;
      let z = 100 - Math.round(dist * 10);
      if (land && d === col.digit) {
        y = y * land.arrive + land.lift;
        scale = land.scale;
        opacity = land.opacity;
        z = 200;
      }
      cell.style.transform = `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;
      cell.style.filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : "none";
      cell.style.opacity = opacity.toFixed(3);
      cell.style.zIndex = String(z);
    });
  }
  // Rolls `el` from one number to another. Returns a function that cancels it.
  function roll(el, from, to) {
    const str = to.toLocaleString("en-US");
    el.setAttribute("aria-label", str);
    const cols = buildColumns(el, str);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cols.forEach((c) => rest(c, c.digit));
      return () => {};
    }
    const o = readTokens(el);
    // Each column starts on its digit of the old number, aligned from the right.
    const fromDigits = String(from).padStart(cols.length, "0").slice(-cols.length);
    cols.forEach((c, i) => {
      c.from = +fromDigits[i];
      rest(c, c.from);
      if (c.from === c.digit) c.done = true; // nothing to do
    });
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const t = performance.now() - t0;
      let running = false;
      cols.forEach((c, i) => {
        if (c.done) return;
        const local = t - i * o.stagger;
        if (local <= 0) { running = true; return; }
        const total = (c.digit - c.from + 10) % 10;
        // Time per number is fixed, so a longer roll takes longer.
        const pos = c.from + total * o.ease(local / (total * o.stepDur));
        const enter = Math.min(1, local / ENTER_MS);
        if (c.landAt === undefined && c.from + total - pos < LAND_AT) c.landAt = t;
        const since = c.landAt === undefined ? -1 : t - c.landAt;
        if (since >= o.anticDur + o.landDur) {
          rest(c, c.digit);
          c.done = true;
          return;
        }
        running = true;
        const middle = 1 + (o.centerScale - 1) * enter;
        let spread = enter;
        let land = null;
        if (since >= 0) {
          // Start from how the target looks right now, so nothing jumps.
          if (!c.landFrom) c.landFrom = look(c.from + total - pos, middle, o);
          const arrive = 1 - smooth(since / (o.anticDur + o.landDur * ARRIVE_AT));
          if (since < o.anticDur) {
            // Anticipation: eases to --reel-antic-scale, pulling back against the roll.
            const a = smooth(since / o.anticDur);
            land = {
              scale: c.landFrom.scale + (o.anticScale - c.landFrom.scale) * a,
              lift: -o.anticLift * a,
              opacity: c.landFrom.back + (1 - c.landFrom.back) * a,
              arrive,
            };
          } else {
            // Spring: snaps into the middle, past 100%, then settles.
            const sp = since - o.anticDur;
            const sn = sp / o.landDur;
            const w = wave(sn);
            land = {
              scale: sn < 1 / 6 ? 1 + (o.anticScale - 1) * w : 1 - ((o.landPeak - 1) * w) / WAVE_TROUGH,
              lift: -o.anticLift * w,
              opacity: 1,
              arrive,
            };
            spread = 1 - Math.min(1, sp / CLEAR_MS);
          }
        }
        place(c, pos, spread, middle, o, land);
      });
      if (running) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }

  return { roll, buildColumns, rest };
  })();

  function reelSet(el, prevNum, next, animate){
    if(el._cancelRoll) el._cancelRoll();
    if(!animate){
      el.setAttribute("aria-label", String(next));
      Reel.buildColumns(el, String(next)).forEach((c) => Reel.rest(c, c.digit));
      return;
    }
    el._cancelRoll = Reel.roll(el, prevNum, next);
  }

  // ---- Text states swap (title <-> line-clear announcement) ----
  const SWAP_MS = cssMs("--text-swap-dur", 150);
  const ANNOUNCE_HOLD = 1300;     // how long an announcement stays before the title returns
  let swapTimers = [];
  function swapOut(el){ el.classList.add("is-exit"); }
  function swapIn(el){
    el.classList.remove("is-exit");
    el.classList.add("is-enter-start");
    void el.offsetHeight; // force reflow so the next change transitions
    el.classList.remove("is-enter-start");
  }
  function later(fn, ms){ swapTimers.push(setTimeout(fn, ms)); }

  // ---- Modal open / close (Game Over, Found it) ----
  const MODAL_CLOSE_MS = cssMs("--modal-close-dur", 150);
  function openModal(m){
    m.removeAttribute("inert");
    m.classList.remove("is-closing");
    m.classList.add("is-open");
  }
  function closeModal(m, instant){
    if(!m.classList.contains("is-open")) return;
    m.classList.remove("is-open");
    m.setAttribute("inert", "");
    if(instant) return;
    m.classList.add("is-closing");
    setTimeout(() => m.classList.remove("is-closing"), MODAL_CLOSE_MS);
  }

  // ---- Success check (Found it) ----
  const checkEl = $("foundCheck");
  function showCheck(){
    checkEl.setAttribute("data-state", "out");
    void checkEl.offsetWidth; // force reflow so keyframes restart
    checkEl.setAttribute("data-state", "in");
  }

  // ---- Toast (LEVEL UP) ----
  const bannerPill = $("bannerPill");
  let bannerTimer = null;
  function showBanner(){
    clearTimeout(bannerTimer);
    bannerPill.classList.add("is-open");
    bannerTimer = setTimeout(() => bannerPill.classList.remove("is-open"), 900);
  }

  // ---- Texts reveal (heading row entrance) ----
  function showHeading(){
    topEl.classList.remove("is-hiding");
    topEl.classList.remove("is-shown");
    void topEl.offsetHeight;
    topEl.classList.add("is-shown");
  }

  // ---- Next queue: pieces move up one place (in the spirit of banner stacking) ----
  const QUEUE_MS = 250;          // --duration-fast in the transitions.dev motion scale
  let qAnim = null;

  // ---- Confetti ----
  let confetti = [], confettiRaf = null, confettiLast;
  function sizeConfetti(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    confettiCanvas.width = Math.round(window.innerWidth * dpr);
    confettiCanvas.height = Math.round(window.innerHeight * dpr);
    cctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function burstConfetti(count, ox, oy, power){
    if(REDUCE) return;
    for(let i=0;i<count;i++){
      const ang = -Math.PI/2 + (Math.random()-0.5)*(Math.PI*1.3);
      const spd = (4 + Math.random()*8) * power;
      confetti.push({
        x:ox, y:oy,
        vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd - 2,
        rot:Math.random()*Math.PI*2, vrot:(Math.random()-0.5)*0.36,
        w:5+Math.random()*7, h:7+Math.random()*9,
        grav:0.14+Math.random()*0.07,
        color:CONFETTI_COLORS[(Math.random()*CONFETTI_COLORS.length)|0],
        ttl:1
      });
    }
    if(!confettiRaf){ confettiLast = undefined; confettiRaf = requestAnimationFrame(confettiTick); }
  }
  function confettiTick(time){
    if(confettiLast===undefined) confettiLast = time;
    const k = Math.min(time - confettiLast, 100) / FRAME;
    confettiLast = time;
    const W = window.innerWidth, H = window.innerHeight, drag = Math.pow(0.992, k);
    cctx.clearRect(0,0,W,H);
    for(const p of confetti){
      p.vy += p.grav*k; p.vx *= drag;
      p.x += p.vx*k; p.y += p.vy*k;
      p.rot += p.vrot*k; p.ttl -= 0.006*k;
      cctx.save();
      cctx.globalAlpha = p.ttl>0.25 ? 1 : Math.max(p.ttl/0.25,0);
      cctx.translate(p.x,p.y);
      cctx.rotate(p.rot);
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
      cctx.restore();
    }
    confetti = confetti.filter(p=>p.ttl>0 && p.y < H+40);
    if(confetti.length) confettiRaf = requestAnimationFrame(confettiTick);
    else { confettiRaf = null; cctx.clearRect(0,0,W,H); }
  }

  // ---- Line-clear announcement ----
  const titleEl = $('lostTitle'), annIn = $('announceIn');
  function showAnnounce(name, detail, tier){
    swapTimers.forEach(clearTimeout); swapTimers = [];
    const fill = ()=>{
      const em = document.createElement('em'); em.textContent = name[0];
      annName.replaceChildren(em, ' ' + name[1]);
      annPts.textContent = detail;
      annEl.classList.remove('t1','t2','t3','t4');
      annEl.classList.add('t'+tier);
      swapIn(annIn);
    };
    topEl.classList.add('busy');
    // whichever text is showing leaves first, then the new one comes in
    swapOut(titleEl.classList.contains('is-exit') ? annIn : titleEl);
    later(fill, SWAP_MS);
    later(()=>swapOut(annIn), SWAP_MS + ANNOUNCE_HOLD);
    later(()=>{ swapIn(titleEl); topEl.classList.remove('busy'); }, SWAP_MS*2 + ANNOUNCE_HOLD);
    const r = annEl.getBoundingClientRect();
    burstConfetti([0,52,90,130,200][tier] || 64, r.left + 80, r.top+r.height/2, tier>=4?1.4:1);
  }
  function clearAnnounce(){
    swapTimers.forEach(clearTimeout); swapTimers = [];
    annIn.classList.remove('is-enter-start');
    annIn.classList.add('is-exit');
    titleEl.classList.remove('is-exit','is-enter-start');
    annEl.classList.remove('t1','t2','t3','t4');
    topEl.classList.remove('busy');
  }

  // ---- Drawing helpers ----
  const shadeCache = {};
  function shade(hex, d){
    const key = hex+d;
    if(shadeCache[key]) return shadeCache[key];
    const n = parseInt(hex.slice(1),16);
    const c = v=> v<0?0:v>255?255:v;
    return (shadeCache[key] = 'rgb('+c(((n>>16)&255)+d)+','+c(((n>>8)&255)+d)+','+c((n&255)+d)+')');
  }
  function cellColor(v){ return v===DIGIT ? INK : v; }
  function drawCell(ctx, x0, y0, color, cell){
    // Flat block with a 1px inner hairline: no lit or shaded edges (no shadows in the brand)
    const gap = Math.max(1, Math.round(cell*0.06));
    const x = Math.round(x0)+gap, y = Math.round(y0)+gap;
    const w = cell-2*gap, h = cell-2*gap;
    ctx.fillStyle = shade(color,-34);
    ctx.fillRect(x,y,w,h);
    ctx.fillStyle = color;
    ctx.fillRect(x+1,y+1,w-2,h-2);
  }

  // ---- Game state ----
  let grid, current, queue = [], bag = [];
  let score, lines, level, best = readBest();
  let dropAcc, lastTime;
  let started, paused, gameOver, found, celebrating;
  let clearing = null;
  let particles = [];
  let shakeMag = 0, shakeT = 0;
  let lockTimer = 0, lockResets = 0;
  let dasDir = 0, dasTimer = 0, dasActive = false;
  let softHeld = false, softAcc = 0;

  function newGrid(){
    const g = [];
    for(let r=0;r<ROWS;r++) g.push(new Array(COLS).fill(null));
    // set the 404 into the bottom five rows
    const top = ROWS - DIGIT_ROWS;
    for(const [ch, col] of WORD){
      GLYPHS[ch].forEach((row, r)=>{
        for(let c=0;c<3;c++) if(row[c]==='1') g[top+r][col+c] = DIGIT;
      });
    }
    return g;
  }
  function digitRowsLeft(){
    let n = 0;
    for(let r=0;r<ROWS;r++) if(grid[r].includes(DIGIT)) n++;
    return n;
  }

  function refillBag(){
    bag = ['I','O','T','S','Z','J','L'];
    for(let i=bag.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [bag[i],bag[j]] = [bag[j],bag[i]];
    }
  }
  function nextFromBag(){ if(bag.length===0) refillBag(); return bag.pop(); }
  function topPadding(m){
    for(let r=0;r<m.length;r++) if(m[r].some(Boolean)) return r;
    return 0;
  }
  function makePiece(type){
    const m = SHAPES[type].map(row=>row.slice());
    return { type, m, x: Math.floor((COLS - m[0].length)/2), y: -topPadding(m) };
  }
  function rotateCW(m){
    const n = m.length, w = m[0].length, out = [];
    for(let c=0;c<w;c++){
      const row = [];
      for(let r=n-1;r>=0;r--) row.push(m[r][c]);
      out.push(row);
    }
    return out;
  }
  function collides(piece, gx, gy, mat){
    const m = mat || piece.m;
    for(let r=0;r<m.length;r++){
      for(let c=0;c<m[r].length;c++){
        if(!m[r][c]) continue;
        const x = gx + c, y = gy + r;
        if(x<0 || x>=COLS || y>=ROWS) return true;
        if(y>=0 && grid[y][x]) return true;
      }
    }
    return false;
  }
  function spawn(){
    while(queue.length < QUEUE + 1) queue.push(makePiece(nextFromBag()));
    const leaving = queue[0];
    current = queue.shift();
    if(started && !REDUCE && leaving) qAnim = { t0: performance.now(), leaving };
    lockTimer = 0; lockResets = 0; dropAcc = 0;
    if(collides(current, current.x, current.y)) endGame();
  }

  // ---- Actions ----
  function grounded(){ return collides(current, current.x, current.y+1); }
  function resetLockDelay(){
    if(grounded() && lockResets < MAX_LOCK_RESETS){ lockTimer = 0; lockResets++; }
  }
  function onFall(){ lockTimer = 0; lockResets = 0; }
  function playable(){ return started && !paused && !gameOver && !clearing && !celebrating; }

  function tryMove(dx){
    if(!playable()) return false;
    if(!collides(current, current.x+dx, current.y)){
      current.x += dx; resetLockDelay(); return true;
    }
    return false;
  }
  function tryRotate(){
    if(!playable()) return false;
    const rm = rotateCW(current.m);
    for(const k of KICKS){
      if(!collides(current, current.x+k, current.y, rm)){
        current.m = rm; current.x += k; resetLockDelay(); return true;
      }
    }
    return false;
  }
  function softStep(){
    if(!playable()) return false;
    if(!collides(current, current.x, current.y+1)){
      current.y += 1; score += 1; onFall(); updateStats(); return true;
    }
    return false;
  }
  function move(dx){ if(tryMove(dx)) render(); }
  function rotate(){ if(tryRotate()) render(); }
  function softDrop(){ if(softStep()) render(); }
  function hardDrop(){
    if(!playable()) return;
    let dist = 0;
    while(!collides(current, current.x, current.y+1)){ current.y += 1; dist++; }
    score += dist*2;
    updateStats();
    addShake(Math.min(3 + dist*0.4, 7));
    lock();
  }

  function lock(){
    const m = current.m, col = COLORS[current.type];
    for(let r=0;r<m.length;r++){
      for(let c=0;c<m[r].length;c++){
        if(!m[r][c]) continue;
        const y = current.y + r, x = current.x + c;
        if(y<0){ endGame(); return; }
        grid[y][x] = col;
      }
    }
    const full = getFullRows();
    if(full.length) startClear(full);
    else { spawn(); render(); }
  }
  function getFullRows(){
    const rows = [];
    for(let r=0;r<ROWS;r++) if(grid[r].every(Boolean)) rows.push(r);
    return rows;
  }

  function startClear(rows){
    const n = rows.length;
    const gained = SCORE_TABLE[n]*level;
    score += gained;
    const prevLevel = level;
    lines += n;
    level = Math.floor(lines/10)+1;

    // how much of the 404 this clear removes
    const digitHit = rows.filter(r=>grid[r].includes(DIGIT)).length;
    const leftAfter = found ? 0 : Math.max(0, goalLeft() - digitHit);
    let detail = '+'+gained;
    if(digitHit && leftAfter > 0) detail += ' · ' + leftAfter + (leftAfter===1 ? ' row left' : ' rows left');
    if(!(digitHit && leftAfter===0 && !found)) showAnnounce(CLEAR_NAME[n], detail, n);   // the winning clear gets the big reward instead

    updateStats(leftAfter);
    if(level>prevLevel){ levelUp(); updateAtmosphere(); }
    clearing = { rows: rows.slice(), t:0 };
  }

  // ---- Juice ----
  function restartAnim(el, cls){ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function flash(){ if(REDUCE) return; restartAnim($('flash'), 'go'); }
  function levelUp(){ bannerPill.textContent = 'Level ' + level; showBanner(); }
  function addShake(mag){
    if(REDUCE) return;
    shakeMag = Math.max(shakeMag, mag);
    shakeT = SHAKE_MS;
  }
  function spawnParticlesFrom(snapshot, rows){
    if(REDUCE) return;
    for(const r of rows){
      for(let c=0;c<COLS;c++){
        const col = cellColor(snapshot[r][c]) || COLORS.T;
        const many = snapshot[r][c]===DIGIT ? 5 : 3;   // the 404 breaks apart more
        for(let p=0;p<many;p++){
          particles.push({
            x:(c+0.2+Math.random()*0.6)*CELL, y:(r+0.2+Math.random()*0.6)*CELL,
            vx:(Math.random()-0.5)*3.2, vy:-Math.random()*3 - 1,
            size:CELL*0.18, life:1, col
          });
        }
      }
    }
  }

  // ---- Reward ----
  function foundIt(){
    found = true;
    celebrating = true;
    releaseKeys();
    flash();
    addShake(10);
    const r = boardCanvas.getBoundingClientRect();
    burstConfetti(240, r.left + r.width/2, r.top + r.height*0.75, 1.5);
    openModal(foundEl);
    showCheck();
    leftBox.classList.add('done');
    foundHome.focus({preventScroll:true});
  }
  function keepPlaying(){
    if(!celebrating) return;
    celebrating = false;
    closeModal(foundEl);
    checkEl.setAttribute('data-state','out');
    lastTime = undefined;
  }

  // ---- Stats ----
  // Each counter gets the transition that fits how often it changes
  let prevVals = {};
  // rows still to clear before the way home opens
  function goalLeft(){ return found ? 0 : Math.max(0, GOAL - (DIGIT_ROWS - digitRowsLeft())); }
  function updateStats(left){
    const map = { score, best:Math.max(best,score), left: left===undefined ? goalLeft() : left };
    for(const id in map){
      const val = map[id], prev = prevVals[id];
      if(prev === val) continue;
      const animate = prev !== undefined;
      if(id==='score' || id==='best') subtleSet($(id), prev, val, animate);
      else reelSet($(id), prev, val, animate);
      prevVals[id] = val;
    }
  }
  function updateAtmosphere(){
    vignetteEl.style.opacity = Math.min(0.3, Math.max(0,(level-1)*0.06)).toFixed(3);
  }

  // ---- Render ----
  function drawGrid(){
    bctx.fillStyle = theme.well;
    bctx.fillRect(0,0,COLS*CELL,ROWS*CELL);
    bctx.strokeStyle = theme.grid;
    bctx.lineWidth = 1;
    bctx.beginPath();
    for(let c=1;c<COLS;c++){ bctx.moveTo(c*CELL+0.5,0); bctx.lineTo(c*CELL+0.5,ROWS*CELL); }
    for(let r=1;r<ROWS;r++){ bctx.moveTo(0,r*CELL+0.5); bctx.lineTo(COLS*CELL,r*CELL+0.5); }
    bctx.stroke();
  }
  function render(){
    drawGrid();
    const blinkOff = clearing && !REDUCE && (Math.floor(clearing.t/110)%2===1);
    const clearSet = clearing ? new Set(clearing.rows) : null;
    for(let r=0;r<ROWS;r++){
      const blinking = clearSet && clearSet.has(r);
      for(let c=0;c<COLS;c++){
        if(!grid[r][c]) continue;
        if(blinking && blinkOff) continue;
        drawCell(bctx, c*CELL, r*CELL, blinking ? '#FFFFFF' : cellColor(grid[r][c]), CELL);
      }
    }
    if(started && current && !clearing && !gameOver){
      const m = current.m, col = COLORS[current.type];
      for(let r=0;r<m.length;r++){
        for(let c=0;c<m[r].length;c++){
          if(!m[r][c]) continue;
          const y = current.y+r;
          if(y<0) continue;
          drawCell(bctx, (current.x+c)*CELL, y*CELL, col, CELL);
        }
      }
    }
    drawParticles();
    if(paused && !gameOver && !clearing){
      const W = COLS*CELL, H = ROWS*CELL;
      bctx.fillStyle = 'rgba(20,20,20,.86)';
      bctx.fillRect(0,0,W,H);
      bctx.textAlign = 'center';
      bctx.textBaseline = 'middle';
      bctx.fillStyle = '#FFFFFF';
      bctx.font = '700 '+CELL+"px 'Playfair Display', serif";
      bctx.fillText('Paused', W/2, H/2 - CELL*0.4);
      bctx.fillStyle = theme.muted;
      bctx.font = '500 '+Math.max(11, Math.round(CELL*0.37))+"px 'Inter', sans-serif";
      if('letterSpacing' in bctx) bctx.letterSpacing = '0.14em';
      bctx.fillText(isTouch ? 'TAP PLAY TO RESUME' : 'PRESS P TO RESUME', W/2, H/2 + CELL*0.6);
      if('letterSpacing' in bctx) bctx.letterSpacing = '0px';
    }
    drawNext();
  }
  function drawParticles(){
    for(const p of particles){
      bctx.globalAlpha = Math.max(p.life,0);
      bctx.fillStyle = p.col;
      bctx.fillRect(p.x, p.y, p.size, p.size);
    }
    bctx.globalAlpha = 1;
  }
  function drawNext(){
    nctx.clearRect(0,0,NEXT_W,NEXT_H);
    if(!queue.length) return;
    // same block size as the board when it fits, so pieces read at one scale
    const cell = Math.max(6, Math.min(CELL, Math.floor(NEXT_W/4), Math.floor(NEXT_H/2)));
    const gap = Math.round(cell*0.8);
    const items = queue.slice(0, QUEUE).map(p=>{
      let minR=99,maxR=-1,minC=99,maxC=-1;
      p.m.forEach((row,r)=>row.forEach((v,c)=>{
        if(v){ if(r<minR)minR=r; if(r>maxR)maxR=r; if(c<minC)minC=c; if(c>maxC)maxC=c; }
      }));
      return { p, minR, minC, w:maxC-minC+1, h:maxR-minR+1 };
    });
    // show as many queued pieces as fit, at least one
    const height = n => items.slice(0,n).reduce((s,it)=>s+it.h*cell,0) + gap*(n-1);
    let n = items.length;
    while(n > 1 && height(n) > NEXT_H) n--;
    let y = Math.round((NEXT_H - height(n))/2);
    const fade = [1, .5, .3, 0];
    // queue moving up one place: e runs 0 -> 1 with an ease-out
    let e = 1, shift = 0;
    if(qAnim){
      const p = Math.min(1, (performance.now() - qAnim.t0) / QUEUE_MS);
      e = 1 - Math.pow(1 - p, 3);
      const lv = qAnim.leaving.m.filter(row=>row.some(Boolean)).length;
      shift = lv*cell + gap;
      // the piece that just entered the board leaves the top of the box
      if(p < 1){
        const m = qAnim.leaving.m, col = COLORS[qAnim.leaving.type];
        const rows = m.filter(row=>row.some(Boolean));
        const cols = [...Array(m[0].length).keys()].filter(c=>rows.some(row=>row[c]));
        const ox = Math.round((NEXT_W - cols.length*cell)/2);
        nctx.globalAlpha = 1 - e;
        rows.forEach((row,r)=>cols.forEach((c,ci)=>{
          if(row[c]) drawCell(nctx, ox+ci*cell, y - shift*e + r*cell, col, cell);
        }));
      } else qAnim = null;
    }
    const off = Math.round(shift*(1-e));
    for(let i=0;i<n;i++){
      const it = items[i], m = it.p.m, col = COLORS[it.p.type];
      const ox = Math.round((NEXT_W - it.w*cell)/2);
      nctx.globalAlpha = fade[i+1] + (fade[i] - fade[i+1]) * e;
      for(let r=0;r<it.h;r++) for(let c=0;c<it.w;c++){
        if(m[it.minR+r][it.minC+c]) drawCell(nctx, ox+c*cell, y+off+r*cell, col, cell);
      }
      y += it.h*cell + gap;
    }
    nctx.globalAlpha = 1;
  }

  // ---- Loop ----
  function gravityMs(){ return Math.max(90, 800-(level-1)*70); }
  function tick(time){
    requestAnimationFrame(tick);
    if(lastTime===undefined) lastTime = time;
    let dt = time - lastTime;
    lastTime = time;
    if(dt>100) dt = 100;
    const k = dt/FRAME;
    let dirty = !!qAnim;

    if(shakeT>0){
      shakeT -= dt;
      const amp = shakeMag*Math.max(shakeT/SHAKE_MS,0);
      shakeWrap.style.transform = 'translate('+((Math.random()*2-1)*amp).toFixed(1)+'px,'+((Math.random()*2-1)*amp).toFixed(1)+'px)';
      if(shakeT<=0){ shakeMag=0; shakeWrap.style.transform=''; }
    }
    if(particles.length){
      for(const p of particles){
        p.vy += 0.22*k; p.x += p.vx*k; p.y += p.vy*k; p.life -= dt/700;
      }
      particles = particles.filter(p=>p.life>0);
      dirty = true;
    }

    if(clearing){
      clearing.t += dt;
      dirty = true;
      if(clearing.t>=CLEAR_MS) finishClear(grid.map(row=>row.slice()), clearing.rows.slice());
    } else if(playable()){
      if(dasDir !== 0){
        dasTimer += dt;
        if(!dasActive && dasTimer >= DAS_DELAY){
          dasActive = true; dasTimer -= DAS_DELAY;
          if(tryMove(dasDir)) dirty = true;
        }
        if(dasActive){
          while(dasTimer >= ARR){
            dasTimer -= ARR;
            if(!tryMove(dasDir)){ dasTimer = 0; break; }
            dirty = true;
          }
        }
      }
      if(softHeld){
        softAcc += dt;
        while(softAcc >= SOFT_RATE){
          softAcc -= SOFT_RATE;
          if(!softStep()) break;
          dirty = true;
        }
      }
      dropAcc += dt;
      const iv = gravityMs();
      while(dropAcc >= iv){
        dropAcc -= iv;
        if(!collides(current, current.x, current.y+1)){ current.y += 1; onFall(); dirty = true; }
        else break;
      }
      if(grounded()){
        dropAcc = 0;
        lockTimer += dt;
        if(lockTimer >= LOCK_DELAY) lock();
        dirty = true;
      } else lockTimer = 0;
    }
    if(dirty || shakeT>0) render();
  }

  function finishClear(snapshot, rows){
    const cut = new Set(rows), kept = [];
    for(let r=0;r<ROWS;r++) if(!cut.has(r)) kept.push(grid[r]);
    const fresh = [];
    for(let i=0;i<ROWS-kept.length;i++) fresh.push(new Array(COLS).fill(null));
    grid = fresh.concat(kept);
    spawnParticlesFrom(snapshot, rows);
    flash();
    addShake(rows.length>=3 ? 9 : 5);
    clearing = null;
    spawn();
    if(!found && !gameOver && DIGIT_ROWS - digitRowsLeft() >= GOAL) foundIt();
  }

  // ---- Lifecycle ----
  function releaseKeys(){
    dasDir = 0; dasTimer = 0; dasActive = false;
    softHeld = false; softAcc = 0;
    stopRepeat();
  }
  function begin(){
    if(started) return;
    started = true;
    lastTime = undefined;
    startEl.classList.add('gone');
  }
  function setPaused(p){
    if(gameOver || !started) return;
    paused = p;
    if(!paused) lastTime = undefined;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    $('pauseIcon').setAttribute('data-state', paused ? 'b' : 'a');
    $('status').textContent = paused ? 'Paused' : 'Resumed';
    render();
  }
  function togglePause(){ setPaused(!paused); }

  function endGame(){
    gameOver = true;
    releaseKeys();
    best = Math.max(best, score);
    saveBest(best);
    $('finScore').textContent = score;
    $('finBest').textContent = best;
    const cleared = Math.min(GOAL, DIGIT_ROWS - digitRowsLeft());
    $('finLeft').textContent = 'You cleared ' + cleared + ' of ' + GOAL + ' rows of the 404.';
    openModal(overEl);
    if(!isTouch) againBtn.focus({preventScroll:true});
    updateStats();
    render();
  }

  function reset(startNow){
    grid = newGrid();
    bag = [];
    score = 0; lines = 0; level = 1;
    dropAcc = 0; lastTime = undefined;
    started = false; paused = false; gameOver = false; found = false; celebrating = false;
    clearing = null; particles = [];
    shakeMag = 0; shakeT = 0;
    lockTimer = 0; lockResets = 0;
    releaseKeys();
    shakeWrap.style.transform = '';
    queue = [];
    prevVals = {};
    closeModal(overEl);
    closeModal(foundEl, true);
    checkEl.setAttribute('data-state','out');
    qAnim = null;
    clearTimeout(bannerTimer); bannerPill.classList.remove('is-open');
    leftBox.classList.remove('done');
    startEl.classList.remove('gone');
    pauseBtn.setAttribute('aria-pressed','false');
    pauseBtn.setAttribute('aria-label','Pause');
    $('pauseIcon').setAttribute('data-state','a');
    clearAnnounce();
    spawn();
    updateStats();
    // Best only means something once a game has been played
    document.querySelector('.stat-best').hidden = best === 0;
    updateAtmosphere();
    if(startNow) begin();
    render();
  }

  // ---- Keyboard ----
  const GAME_KEYS = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Spacebar'];
  window.addEventListener('keydown', function(e){
    const onControl = e.target.closest && e.target.closest('a, button');
    if(onControl && (e.key==='Enter' || e.key===' ')) return;

    if(celebrating){
      if(e.key==='Escape') keepPlaying();
      return;
    }
    // before the game starts, leave the keys alone unless the page or the board has focus
    if(!started && !gameOver && e.target !== document.body && e.target !== boardCanvas) return;
    if(GAME_KEYS.includes(e.key)) e.preventDefault();
    if(gameOver){
      if(!e.repeat && (e.key==='Enter' || e.key===' ' || e.key==='Spacebar')) reset(true);
      return;
    }
    if(!started){
      if(!GAME_KEYS.includes(e.key)) return;
      begin();
    }
    switch(e.key){
      case 'ArrowLeft':
        if(e.repeat) break;
        dasDir = -1; dasTimer = 0; dasActive = false; move(-1); break;
      case 'ArrowRight':
        if(e.repeat) break;
        dasDir = 1; dasTimer = 0; dasActive = false; move(1); break;
      case 'ArrowDown':
        if(e.repeat) break;
        softHeld = true; softAcc = 0; softDrop(); break;
      case 'ArrowUp':
        if(!e.repeat) rotate(); break;
      case ' ':
      case 'Spacebar':
        if(!e.repeat) hardDrop(); break;
      case 'p':
      case 'P':
        if(!e.repeat) togglePause(); break;
    }
  }, {passive:false});

  window.addEventListener('keyup', function(e){
    switch(e.key){
      case 'ArrowLeft':  if(dasDir===-1){ dasDir = 0; dasActive = false; } break;
      case 'ArrowRight': if(dasDir===1){  dasDir = 0; dasActive = false; } break;
      case 'ArrowDown':  softHeld = false; softAcc = 0; break;
    }
  });

  function onLeave(){
    releaseKeys();
    if(playable()) setPaused(true);
  }
  window.addEventListener('blur', onLeave);
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) onLeave(); });

  againBtn.addEventListener('click', ()=>reset(true));
  keepBtn.addEventListener('click', keepPlaying);
  boardCanvas.addEventListener('click', ()=>{ if(!started && !gameOver) begin(); });

  // ---- Touch pad ----
  const touch = $('touch');
  const REPEAT = {left:()=>move(-1), right:()=>move(1), down:()=>softDrop()};
  let repeatTimer = null;
  function stopRepeat(){ if(repeatTimer){ clearInterval(repeatTimer); repeatTimer = null; } }
  function actOnce(act){
    switch(act){
      case 'left': move(-1); break;
      case 'right': move(1); break;
      case 'down': softDrop(); break;
      case 'rotate': rotate(); break;
      case 'hard': if(gameOver) reset(true); else hardDrop(); break;
      case 'pause': togglePause(); break;
    }
  }
  function startHold(btn, act){
    if(celebrating) return;
    if(gameOver && act!=='hard') return;
    if(!started && !gameOver){
      if(act==='pause') return;      // nothing to pause yet
      begin();
    }
    btn.classList.add('active');
    actOnce(act);
    stopRepeat();
    if(REPEAT[act]) repeatTimer = setInterval(()=>{ if(playable()) REPEAT[act](); }, 110);
  }
  function endHold(btn){ btn.classList.remove('active'); stopRepeat(); }
  touch.querySelectorAll('button').forEach(btn=>{
    const act = btn.dataset.act;
    btn.addEventListener('touchstart', e=>{ e.preventDefault(); startHold(btn,act); }, {passive:false});
    btn.addEventListener('touchend',  e=>{ e.preventDefault(); endHold(btn); }, {passive:false});
    btn.addEventListener('touchcancel', ()=> endHold(btn));
    btn.addEventListener('mousedown', e=>{ e.preventDefault(); startHold(btn,act); });
    btn.addEventListener('mouseup', ()=> endHold(btn));
    btn.addEventListener('mouseleave', ()=> endHold(btn));
  });

  window.addEventListener('resize', resize);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(resize);

  // ---- Go ----
  resize();
  reset(false);
  showHeading();
  requestAnimationFrame(tick);
})();
