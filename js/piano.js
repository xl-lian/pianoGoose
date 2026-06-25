/* piano.js — 屏幕钢琴键盘渲染 + 几何信息（供瀑布对齐）
 * 每个键标注：音名 + 当前映射的电脑键。提供 lane 几何给 waterfall。
 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  const core = PG.core;
  const keymap = PG.keymap;

  const PS = {
    el: null,
    lo: 48, hi: 84,       // 渲染范围（MIDI），默认 C3..C6
    whiteW: 0, blackW: 0,
    lanes: new Map(),     // midi -> {x, w, black, centerX}
    keyEls: new Map(),    // midi -> DOM
    labelMode: 'both',    // key | note | solfege | both
    onPress: null,        // (midi) =>
    onRelease: null,      // (midi) =>
  };

  function isWhite(midi) { return !core.isBlack(midi); }

  function countWhite(lo, hi) {
    let n = 0;
    for (let m = lo; m <= hi; m++) if (isWhite(m)) n++;
    return n;
  }

  function computeGeometry() {
    const totalW = PS.el.clientWidth || 900;
    const nWhite = countWhite(PS.lo, PS.hi);
    const whiteW = totalW / nWhite;
    const blackW = whiteW * 0.62;
    PS.whiteW = whiteW;
    PS.blackW = blackW;
    PS.lanes.clear();
    let wi = 0;
    for (let m = PS.lo; m <= PS.hi; m++) {
      if (isWhite(m)) {
        const x = wi * whiteW;
        PS.lanes.set(m, { x, w: whiteW, black: false, centerX: x + whiteW / 2 });
        wi++;
      } else {
        const x = wi * whiteW - blackW / 2;
        PS.lanes.set(m, { x, w: blackW, black: true, centerX: wi * whiteW });
      }
    }
  }

  function labelFor(midi) {
    const code = keymap.midiToCode(midi);
    const keyChip = code ? keymap.LABELS[code] : null;
    const note = core.midiToPitch(midi) + core.octaveOf(midi);
    const sol = core.midiToSolfege(midi);
    return { keyChip, note, sol };
  }

  function buildKey(midi) {
    const lane = PS.lanes.get(midi);
    const el = document.createElement('div');
    el.className = 'key ' + (lane.black ? 'black' : 'white');
    el.style.left = lane.x + 'px';
    el.style.width = lane.w + 'px';
    el.dataset.midi = midi;

    const lab = document.createElement('div');
    lab.className = 'key-label';
    el.appendChild(lab);

    PS.keyEls.set(midi, el);
    bindPointer(el, midi);
    return el;
  }

  function bindPointer(el, midi) {
    let down = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      down = true;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      if (PS.onPress) PS.onPress(midi);
    });
    const up = () => { if (down) { down = false; if (PS.onRelease) PS.onRelease(midi); } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  }

  // 键面迷你五线谱（识谱练习）
  function staffSVG(midi) {
    const g = 4, w = 30, H = 50, topY = 14, cx = w / 2;
    const info = core.staffInfo(midi);
    const yOf = (d) => topY + (core.STAFF_TOP - d) * (g / 2);
    let lines = '';
    for (let i = 0; i < 5; i++) { const y = topY + i * g; lines += `<line x1="4" y1="${y}" x2="${w - 4}" y2="${y}"/>`; }
    info.ledgers.forEach((L) => { const ly = yOf(L); lines += `<line x1="${cx - 7}" y1="${ly}" x2="${cx + 7}" y2="${ly}"/>`; });
    const ny = yOf(info.diatonic);
    const sharp = info.sharp ? `<text x="${cx - 7.5}" y="${ny + 3.5}" class="sf">♯</text>` : '';
    return `<svg class="staff" viewBox="0 0 ${w} ${H}"><g class="ln">${lines}</g><ellipse class="nh" cx="${cx}" cy="${ny}" rx="3.6" ry="2.7"/>${sharp}</svg>`;
  }

  function refreshLabels() {
    PS.keyEls.forEach((el, midi) => {
      const lab = el.querySelector('.key-label');
      const { keyChip, note, sol } = labelFor(midi);
      let html = '';
      if (PS.labelMode === 'staff') {
        html += staffSVG(midi);
        if (keyChip) html += '<span class="chip">' + keyChip + '</span>';
      } else {
        if ((PS.labelMode === 'key' || PS.labelMode === 'both') && keyChip) {
          html += '<span class="chip">' + keyChip + '</span>';
        }
        if (PS.labelMode === 'note' || PS.labelMode === 'both') {
          html += '<span class="note">' + note + '</span>';
        } else if (PS.labelMode === 'solfege') {
          html += '<span class="note">' + sol + '</span>';
        }
      }
      lab.innerHTML = html;
      el.classList.toggle('mapped', !!keyChip);
      el.classList.toggle('staff-mode', PS.labelMode === 'staff');
    });
  }

  function render() {
    computeGeometry();
    PS.el.innerHTML = '';
    PS.keyEls.clear();
    PS.el.style.position = 'relative';
    // 先白键再黑键，保证黑键在上层
    const whites = [], blacks = [];
    for (let m = PS.lo; m <= PS.hi; m++) (isWhite(m) ? whites : blacks).push(m);
    whites.forEach((m) => PS.el.appendChild(buildKey(m)));
    blacks.forEach((m) => PS.el.appendChild(buildKey(m)));
    refreshLabels();
  }

  function setActive(midi, on) {
    const el = PS.keyEls.get(midi);
    if (el) el.classList.toggle('active', on);
  }

  // 命中反馈：good / perfect / miss 闪一下
  function flash(midi, kind) {
    const el = PS.keyEls.get(midi);
    if (!el) return;
    el.classList.add('hit-' + kind);
    setTimeout(() => el.classList.remove('hit-' + kind), 220);
  }

  function setRange(lo, hi) {
    // 对齐到 C 边界，留一点余量
    PS.lo = lo - (((lo % 12) + 12) % 12);
    let h = hi;
    const hipc = (((h % 12) + 12) % 12);
    if (hipc !== 0) h = h + (12 - hipc); // 收到下一个 C
    PS.hi = h;
    render();
  }

  function init(el, opts) {
    PS.el = el;
    PS.onPress = opts.onPress;
    PS.onRelease = opts.onRelease;
    if (opts.labelMode) PS.labelMode = opts.labelMode;
    render();
    window.addEventListener('resize', debounce(() => { render(); if (opts.onResize) opts.onResize(); }, 120));
  }

  function debounce(fn, ms) {
    let t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  PG.piano = {
    init, render, setActive, flash, refreshLabels, setRange,
    setLabelMode: (m) => { PS.labelMode = m; refreshLabels(); },
    geometry: () => ({ whiteW: PS.whiteW, blackW: PS.blackW, lanes: PS.lanes, lo: PS.lo, hi: PS.hi }),
    state: PS,
  };
})(window.PG);
