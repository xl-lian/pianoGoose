/* waterfall.js — 落键瀑布引擎（canvas）
 * 音符自上而下落，落到判定线时按下对应电脑键。支持：
 *   - stream 模式：连续播放，漏掉算 miss
 *   - wait   模式：练习用，落到线上会停下等你按对
 *   - 自动演奏（先听一遍）
 * 与 piano.js 的几何对齐，瀑布画在键盘正上方。
 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  const core = PG.core;
  const piano = PG.piano;
  const keymap = PG.keymap;

  function reachable(midi) { return !!keymap.midiToCode(midi); }

  // 在画布上画一个迷你五线谱音符（识谱练习）。middleY = 中线(B4)位置，g = 线间距
  function drawStaffNote(ctx, cx, middleY, midi, g) {
    const topY = middleY - 2 * g;
    const halfW = g * 3;
    const info = core.staffInfo(midi);
    const yOf = (d) => topY + (core.STAFF_TOP - d) * (g / 2);
    ctx.strokeStyle = 'rgba(26,31,46,0.7)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = topY + i * g;
      ctx.beginPath(); ctx.moveTo(cx - halfW, y); ctx.lineTo(cx + halfW, y); ctx.stroke();
    }
    info.ledgers.forEach((L) => {
      const ly = yOf(L);
      ctx.beginPath(); ctx.moveTo(cx - g * 1.7, ly); ctx.lineTo(cx + g * 1.7, ly); ctx.stroke();
    });
    const ny = yOf(info.diatonic);
    ctx.fillStyle = 'rgba(15,19,30,0.96)';
    ctx.beginPath();
    ctx.ellipse(cx + g * 0.1, ny, g * 0.92, g * 0.66, -0.35, 0, Math.PI * 2);
    ctx.fill();
    if (info.sharp) {
      ctx.font = '700 ' + Math.round(g * 2.5) + 'px ui-sans-serif, system-ui';
      ctx.textAlign = 'right';
      ctx.fillText('♯', cx - g * 1.6, ny + g * 0.85);
      ctx.textAlign = 'center';
    }
  }

  const WF = {
    canvas: null, ctx: null, dpr: 1,
    w: 0, h: 0,
    song: null, notes: [],
    secPerBeat: 0.5, leadTime: 2.2, speed: 1,
    mode: 'wait',           // 'wait' | 'stream'
    showFinger: true, showKey: true, showName: true, showStaff: false,
    playing: false, finished: false, demo: false, midiConnected: false,
    songTime: 0, lastTs: 0,
    raf: 0,
    cb: {},                 // onJudge, onNoteOn, onNoteOff, onComplete, onProgress
    stats: null,
  };

  const PERFECT = 0.085, GOOD = 0.17; // 判定窗口（秒，真实时间）

  function resize() {
    if (!WF.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    WF.dpr = dpr;
    const rect = WF.canvas.getBoundingClientRect();
    WF.w = rect.width;
    WF.h = rect.height;
    WF.canvas.width = Math.round(rect.width * dpr);
    WF.canvas.height = Math.round(rect.height * dpr);
    WF.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(); // 重设画布尺寸会清空内容，立即重绘
  }

  function init(canvas, cb) {
    WF.canvas = canvas;
    WF.ctx = canvas.getContext('2d');
    WF.cb = cb || {};
    resize();
    renderStatic();
  }

  function freshStats(total) {
    return { total, perfect: 0, good: 0, miss: 0, streak: 0, maxStreak: 0, score: 0 };
  }

  function setSong(song, opts) {
    WF.song = song;
    WF.speed = (opts && opts.speed) || 1;
    WF.mode = (opts && opts.mode) || 'wait';
    WF.secPerBeat = (60 / song.bpm) / WF.speed;
    WF.notes = song.notes.map((n, i) => ({
      i, midi: n.midi, finger: n.finger || 0, hand: n.hand || 'R',
      hitT: n.time * WF.secPerBeat,
      endT: (n.time + (n.durBeats != null ? n.durBeats : n.dur / 0.92)) * WF.secPerBeat,
      durSec: (n.dur != null ? n.dur : 0.9) * WF.secPerBeat,
      state: 'pending', // pending | hit | miss
      label: n.label,
    }));
    // 连奏时长：撑到下一个音的起点（连续音不留缝）；遇到明显休止则只响本音时值
    for (let k = 0; k < WF.notes.length; k++) {
      const nx = WF.notes[k + 1];
      const toNext = nx ? nx.hitT - WF.notes[k].hitT : WF.notes[k].durSec;
      WF.notes[k].legatoDur = (toNext > 0 && toNext <= WF.notes[k].durSec * 1.6)
        ? toNext * 1.04
        : WF.notes[k].durSec;
    }
    WF.stats = freshStats(WF.notes.length);
    WF.songTime = -WF.leadTime - 0.6; // 留出引子
    WF.finished = false;
    renderStatic();
  }

  function pitchRange() {
    if (!WF.notes.length) return [60, 72];
    let lo = 999, hi = 0;
    WF.notes.forEach((n) => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    return [lo, hi];
  }

  function start(demo) {
    if (!WF.song) return;
    WF.demo = !!demo;
    WF.playing = true;
    WF.finished = false;
    WF.lastTs = performance.now();
    loop();
  }

  function pause() { WF.playing = false; cancelAnimationFrame(WF.raf); }

  function stop() {
    WF.playing = false;
    cancelAnimationFrame(WF.raf);
    if (WF.song) setSong(WF.song, { speed: WF.speed, mode: WF.mode });
  }

  function setSpeed(mult) {
    const ratioTime = WF.songTime; // 简单处理：重置歌曲时间映射
    WF.speed = mult;
    if (WF.song) {
      const wasPlaying = WF.playing;
      pause();
      setSong(WF.song, { speed: mult, mode: WF.mode });
      if (wasPlaying) start();
    }
  }

  function setMode(mode) {
    WF.mode = mode;
    WF.notes.forEach((n) => {}); // 模式即时生效
  }

  // 当前最早一个待命音（用于 wait 模式的「墙」）
  function earliestPending() {
    let e = null;
    for (let k = 0; k < WF.notes.length; k++) {
      if (WF.notes[k].state === 'pending') { e = WF.notes[k]; break; }
    }
    return e;
  }

  function loop() {
    if (!WF.playing) return;
    const ts = performance.now();
    let dt = (ts - WF.lastTs) / 1000;
    WF.lastTs = ts;
    if (dt > 0.1) dt = 0.1; // 防止切后台后跳变

    let target = WF.songTime + dt;

    if (WF.demo) {
      // 自动演奏：音符过线即发声，不计分、不暂停
      WF.notes.forEach((n) => {
        if (n.state === 'pending' && target >= n.hitT) {
          n.state = 'hit';
          if (WF.cb.onNoteOn) WF.cb.onNoteOn(n);
        }
      });
    } else if (WF.mode === 'wait') {
      // 跳过当前键位够不到、又没插 MIDI 的音，避免「墙」死锁
      let e = earliestPending();
      while (e && !WF.midiConnected && !reachable(e.midi)) { e.state = 'skip'; e = earliestPending(); }
      if (e && target > e.hitT) {
        target = e.hitT; // 停在判定线等待
      }
    } else {
      // stream：自动判漏
      WF.notes.forEach((n) => {
        if (n.state !== 'pending' || target <= n.hitT + GOOD) return;
        if (!WF.midiConnected && !reachable(n.midi)) { n.state = 'skip'; return; }
        n.state = 'miss';
        WF.stats.miss++;
        WF.stats.streak = 0;
        if (WF.cb.onJudge) WF.cb.onJudge({ note: n, kind: 'miss' });
      });
    }
    WF.songTime = target;

    render();
    if (WF.cb.onProgress) WF.cb.onProgress(progress());

    // 结束判定
    const lastEnd = WF.notes.length ? WF.notes[WF.notes.length - 1].endT : 0;
    const remaining = WF.notes.some((n) => n.state === 'pending');
    if (!remaining && WF.songTime > lastEnd + 0.3 && !WF.finished) {
      WF.finished = true;
      WF.playing = false;
      if (!WF.demo && WF.cb.onComplete) WF.cb.onComplete(finalStats());
      WF.demo = false;
      render();
      return;
    }
    WF.raf = requestAnimationFrame(loop);
  }

  function progress() {
    const lastEnd = WF.notes.length ? WF.notes[WF.notes.length - 1].endT : 1;
    return Math.max(0, Math.min(1, (WF.songTime + WF.leadTime) / (lastEnd + WF.leadTime)));
  }

  function finalStats() {
    const s = WF.stats;
    const hits = s.perfect + s.good;
    const judged = hits + s.miss; // 不把够不到的跳过音算进准确率
    const acc = judged ? hits / judged : 1;
    return Object.assign({}, s, { accuracy: acc, stars: acc >= 0.95 ? 3 : acc >= 0.8 ? 2 : acc >= 0.5 ? 1 : 0 });
  }

  // 玩家按下某个 MIDI：判定
  function press(midi) {
    if (!WF.playing && !WF.finished) return null;
    let best = null, bestDist = Infinity;
    for (let k = 0; k < WF.notes.length; k++) {
      const n = WF.notes[k];
      if (n.state !== 'pending' || n.midi !== midi) continue;
      const dist = Math.abs(n.hitT - WF.songTime);
      if (dist < bestDist) { bestDist = dist; best = n; }
    }
    if (!best || bestDist > GOOD) return null; // 没有可判定的目标
    const kind = bestDist <= PERFECT ? 'perfect' : 'good';
    best.state = 'hit';
    WF.stats[kind]++;
    WF.stats.streak++;
    WF.stats.maxStreak = Math.max(WF.stats.maxStreak, WF.stats.streak);
    WF.stats.score += (kind === 'perfect' ? 100 : 60) + WF.stats.streak * 2;
    if (WF.cb.onJudge) WF.cb.onJudge({ note: best, kind });
    return kind;
  }

  // —— 渲染 ——
  function renderStatic() {
    if (!WF.ctx) return;
    render();
  }

  function laneFor(midi) {
    const geo = piano.geometry();
    return geo.lanes.get(midi);
  }

  function colorFor(midi, black) {
    const pc = ((midi % 12) + 12) % 12;
    const hue = (pc * 30) % 360;
    return {
      fill: `hsl(${hue} 80% ${black ? 52 : 62}%)`,
      edge: `hsl(${hue} 85% ${black ? 38 : 46}%)`,
      glow: `hsl(${hue} 90% 70%)`,
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render() {
    const ctx = WF.ctx;
    if (!ctx) return;
    const W = WF.w, H = WF.h;
    ctx.clearRect(0, 0, W, H);

    // 竖向 lane 分隔（白键边界）
    const geo = piano.geometry();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    geo.lanes.forEach((lane, midi) => {
      if (!lane.black) {
        ctx.beginPath();
        ctx.moveTo(lane.x, 0);
        ctx.lineTo(lane.x, H);
        ctx.stroke();
      }
    });
    ctx.restore();

    // 判定线
    const lineY = H - 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,200,255,0.55)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(120,200,255,0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(W, lineY);
    ctx.stroke();
    ctx.restore();

    // 音符块
    for (let k = 0; k < WF.notes.length; k++) {
      const n = WF.notes[k];
      const lane = laneFor(n.midi);
      if (!lane) continue;
      const dtHit = n.hitT - WF.songTime;   // >0 还没到
      const yHead = H * (1 - dtHit / WF.leadTime);
      const tileH = Math.max(14, H * (n.durSec / WF.leadTime));
      const yTop = yHead - tileH;
      if (yTop > H || yHead < -tileH) continue; // 不在可视区

      const black = lane.black;
      const pad = black ? 2 : 3;
      const x = lane.x + pad;
      const w = lane.w - pad * 2;
      const col = colorFor(n.midi, black);

      ctx.save();
      let alpha = 1;
      if (n.state === 'hit') alpha = 0.28;
      else if (n.state === 'miss') alpha = 0.18;
      else if (n.state === 'skip') alpha = 0.1;
      ctx.globalAlpha = alpha;

      // 接近判定线时发光
      const near = dtHit < 0.25 && dtHit > -GOOD && n.state === 'pending';
      if (near) {
        ctx.shadowColor = col.glow;
        ctx.shadowBlur = 16;
      }
      roundRect(ctx, x, Math.min(yTop, yHead), w, Math.abs(tileH), 6);
      const grad = ctx.createLinearGradient(0, yTop, 0, yHead);
      grad.addColorStop(0, col.fill);
      grad.addColorStop(1, col.edge);
      ctx.fillStyle = (n.state === 'miss' || n.state === 'skip') ? 'rgba(140,140,150,0.5)' : grad;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.stroke();
      ctx.restore();

      // 标签（贴近落点的电脑键 + 音名/唱名 + 指法）
      if (tileH > 16 && n.state === 'pending') {
        ctx.save();
        ctx.textAlign = 'center';
        const cx = lane.centerX;
        // 电脑键：画在贴近判定线的落点处，告诉你「该按哪个键」
        if (WF.showKey) {
          const code = keymap.midiToCode(n.midi);
          const klabel = code ? keymap.LABELS[code] : null;
          if (klabel) {
            ctx.font = '700 11px ui-sans-serif, system-ui';
            const chipW = ctx.measureText(klabel).width + 10;
            const chipH = 15;
            const chipY = yHead - chipH - 3;
            ctx.fillStyle = 'rgba(16,20,32,0.92)';
            roundRect(ctx, cx - chipW / 2, chipY, chipW, chipH, 4);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(klabel, cx, chipY + 11);
          }
        }
        // 五线谱音符卡片（识谱练习）
        if (WF.showStaff && tileH > 34) {
          const g = 5, cardW = 38, cardH = 44;
          const cardCy = yHead - (WF.showKey ? 22 : 8) - cardH / 2;
          ctx.fillStyle = 'rgba(246,248,252,0.96)';
          roundRect(ctx, cx - cardW / 2, cardCy - cardH / 2, cardW, cardH, 6);
          ctx.fill();
          drawStaffNote(ctx, cx, cardCy, n.midi, g);
        }
        // 音名 / 唱名
        let ly = yHead - (WF.showKey ? 24 : 8);
        if (WF.showName) {
          ctx.font = '600 12px ui-sans-serif, system-ui';
          ctx.fillStyle = black ? 'rgba(255,255,255,0.95)' : 'rgba(20,20,30,0.92)';
          ctx.fillText(n.label || core.midiToPitch(n.midi), cx, Math.max(ly, yTop + 12));
          ly -= 14;
        }
        // 指法
        if (WF.showFinger && n.finger) {
          ctx.font = '700 10px ui-sans-serif';
          ctx.fillStyle = black ? 'rgba(180,230,255,0.95)' : 'rgba(40,90,160,0.95)';
          ctx.fillText('指' + n.finger, cx, Math.max(ly, yTop + 11));
        }
        ctx.restore();
      }
    }
  }

  PG.waterfall = {
    init, setSong, start, pause, stop, press, resize, render,
    setSpeed, setMode,
    setMidi: (c) => { WF.midiConnected = !!c; },
    pitchRange, progress, finalStats,
    setLabels: (o) => { if (o.finger != null) WF.showFinger = o.finger; if (o.key != null) WF.showKey = o.key; if (o.name != null) WF.showName = o.name; if (o.staff != null) WF.showStaff = o.staff; },
    setLead: (s) => { WF.leadTime = s; },
    get state() { return WF; },
    get playing() { return WF.playing; },
  };
})(window.PG);
