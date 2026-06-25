/* app.js — 主控制器：键盘输入、三种模式、音频、HUD、设置 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  const { core, keymap, audio, piano, waterfall, theory, songs, midi } = PG;
  const $ = (id) => document.getElementById(id);

  const S = {
    mode: 'free',          // free | song | theory
    down: new Set(),       // 当前按下的 event.code
    sounding: new Set(),   // 当前发声的 midi
    current: null,         // 当前曲谱/练习
    started: false,        // 瀑布是否已开始
    customs: [],           // 用户自定义曲目（localStorage）
  };

  // ——————————————————— 发声 ———————————————————
  function noteDown(midi, fromUser) {
    if (S.sounding.has(midi)) return;
    S.sounding.add(midi);
    audio.noteOn(midi, 0.85);
    piano.setActive(midi, true);
    if (S.mode === 'free') showFreeReadout(midi);
    if (fromUser && S.started) {
      const kind = waterfall.press(midi);
      // 判定反馈在 onJudge 里处理
    }
  }

  function noteUp(midi) {
    if (!S.sounding.has(midi)) return;
    S.sounding.delete(midi);
    audio.noteOff(midi);
    piano.setActive(midi, false);
  }

  // ——————————————————— 键盘 ———————————————————
  function inEditable(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKeyDown(e) {
    if (inEditable(e.target)) return; // 焦点在设置控件/输入框时，保留原生键盘行为
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    audio.resume();
    const code = e.code;

    // 控制键：移八度
    if (code === 'KeyZ') { e.preventDefault(); if (keymap.shiftOctave(-1)) afterOctaveChange(); return; }
    if (code === 'KeyX') { e.preventDefault(); if (keymap.shiftOctave(1)) afterOctaveChange(); return; }
    if (code === 'Space') {
      if (S.mode !== 'free') { e.preventDefault(); togglePlay(); }
      return;
    }

    if (!(code in keymap.OFFSETS)) return;
    e.preventDefault();
    if (e.repeat || S.down.has(code)) return;
    S.down.add(code);
    const midi = keymap.codeToMidi(code);
    if (midi != null) noteDown(midi, true);
  }

  function onKeyUp(e) {
    if (inEditable(e.target)) return;
    const code = e.code;
    if (!(code in keymap.OFFSETS)) return;
    S.down.delete(code);
    const midi = keymap.codeToMidi(code);
    if (midi != null) noteUp(midi);
  }

  function afterOctaveChange() {
    // 松开所有声音，刷新键盘标签 & 八度显示
    Array.from(S.sounding).forEach(noteUp);
    S.down.clear();
    piano.refreshLabels();
    updateOctaveLabel();
    renderLegend();
  }

  // ——————————————————— 模式切换 ———————————————————
  function setMode(mode) {
    S.mode = mode;
    waterfall.stop();
    audio.allOff();
    S.started = false;
    ['free', 'song', 'theory'].forEach((m) => {
      $('tab-' + m).classList.toggle('active', m === mode);
      const p = $('panel-' + m);
      if (p) p.classList.toggle('hidden', m !== mode);
    });
    $('stage').classList.toggle('free-mode', mode === 'free');
    resetHud();
    if (mode === 'free') {
      piano.setRange(48, 84);
      waterfall.render();
    }
  }

  // ——————————————————— 曲目 ———————————————————
  const CUSTOM_KEY = 'pg-custom-songs';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function loadCustoms() {
    let defs = [];
    try { defs = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch (e) { defs = []; }
    S.customs = defs.map((d) => PG.jianpu.toSong(Object.assign({}, d, { custom: true })));
  }
  function customDefs() {
    return S.customs.map((s) => ({ id: s.id, title: s.title, cn: s.cn, category: s.category, difficulty: s.difficulty, bpm: s.bpm, keyMidi: s.keyMidi, text: s.jianpu }));
  }
  function persistCustoms() { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customDefs())); }
  function allSongs() { return songs.LIB.concat(S.customs); }

  function buildSongList() {
    const list = $('songList');
    list.innerHTML = '';
    allSongs().forEach((song) => {
      const item = document.createElement('div');
      item.className = 'song-item';
      item.dataset.songid = song.id;
      const stars = '★'.repeat(song.difficulty) + '☆'.repeat(3 - song.difficulty);
      const badge = song.approx ? '<span class="badge warn">≈待校对</span>' : (song.custom ? '<span class="badge">自定义</span>' : '');
      item.innerHTML = `<span class="s-title">${esc(song.title)} ${badge}</span>
        <span class="s-sub">${esc(song.cn || '')}${song.category ? ' · ' + esc(song.category) : ''}</span>
        <span class="s-diff">${stars}</span>` +
        (song.custom ? '<button class="s-del" title="删除">✕</button>' : '');
      item.addEventListener('click', (e) => { if (e.target.classList.contains('s-del')) return; loadSong(song); });
      const del = item.querySelector('.s-del');
      if (del) del.addEventListener('click', (e) => { e.stopPropagation(); deleteCustom(song.id); });
      list.appendChild(item);
    });
    if (S.current) markSelected(S.current.id);
  }

  function markSelected(id) {
    document.querySelectorAll('.song-item').forEach((el) => el.classList.toggle('selected', el.dataset.songid === id));
  }

  function deleteCustom(id) {
    S.customs = S.customs.filter((s) => s.id !== id);
    persistCustoms();
    buildSongList();
  }

  function loadSong(song) {
    S.current = song;
    $('nowPlaying').textContent = song.title + (song.approx ? '（≈待校对）' : '');
    markSelected(song.id);
    prepareWaterfall(song);
  }

  // —— 简谱导入 ——
  function buildKeyOptions() {
    const sel = $('jpKey');
    if (!sel) return;
    sel.innerHTML = '';
    for (let m = 53; m <= 67; m++) { // F3 .. G4 常用主音
      const o = document.createElement('option');
      o.value = m; o.textContent = core.midiToPitch(m) + core.octaveOf(m);
      if (m === 60) o.selected = true;
      sel.appendChild(o);
    }
  }

  function readImporter() {
    const text = $('jpText').value.trim();
    const tokens = PG.jianpu.parse(text, parseInt($('jpKey').value, 10));
    const realNotes = tokens.filter((t) => t[0] !== 'rest');
    if (!realNotes.length) { $('jpErr').textContent = '没解析到音符，检查一下简谱内容。'; return null; }
    $('jpErr').textContent = '';
    const name = $('jpName').value.trim() || '自定义曲';
    return PG.jianpu.toSong({
      id: 'custom-' + name + '-' + text.length,
      title: name, category: '自定义', difficulty: 2,
      bpm: parseInt($('jpBpm').value, 10) || 90,
      keyMidi: parseInt($('jpKey').value, 10),
      text, custom: true,
    });
  }

  function importerLoad() {
    const song = readImporter();
    if (!song) return;
    setMode('song');
    loadSong(song);
  }

  function importerSave() {
    const song = readImporter();
    if (!song) return;
    // 同名覆盖
    S.customs = S.customs.filter((s) => s.id !== song.id);
    S.customs.push(song);
    persistCustoms();
    buildSongList();
    loadSong(song);
  }

  // ——————————————————— 乐理 ———————————————————
  function buildTheoryControls() {
    // 根音下拉
    const rootSel = $('thRoot');
    rootSel.innerHTML = '';
    for (let m = 48; m <= 72; m++) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = core.midiToPitch(m) + core.octaveOf(m);
      if (m === 60) o.selected = true;
      rootSel.appendChild(o);
    }
    // 音阶类型
    const scaleSel = $('thScale');
    scaleSel.innerHTML = '';
    Object.keys(theory.SCALES).forEach((k) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = theory.SCALES[k].name;
      scaleSel.appendChild(o);
    });
    // 和弦类型
    const chordSel = $('thChord');
    chordSel.innerHTML = '';
    Object.keys(theory.CHORD_TYPES).forEach((k) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = theory.CHORD_TYPES[k].name;
      chordSel.appendChild(o);
    });
    // 和弦进行
    const progSel = $('thProg');
    progSel.innerHTML = '';
    theory.PROGRESSIONS.forEach((p, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = p.title;
      progSel.appendChild(o);
    });

    $('thScaleGo').addEventListener('click', () => {
      const root = parseInt($('thRoot').value, 10);
      const type = $('thScale').value;
      const hand = $('thHand').value;
      const lesson = theory.scaleLesson(root, type, hand);
      labelNotes(lesson);
      $('nowPlaying').textContent = lesson.title;
      S.current = lesson;
      prepareWaterfall(lesson);
    });
    $('thChordGo').addEventListener('click', () => {
      const root = parseInt($('thRoot').value, 10);
      const type = $('thChord').value;
      const lesson = theory.chordLesson(root, type);
      labelNotes(lesson);
      $('nowPlaying').textContent = lesson.title;
      S.current = lesson;
      prepareWaterfall(lesson);
    });
    $('thProgGo').addEventListener('click', () => {
      const p = theory.PROGRESSIONS[parseInt($('thProg').value, 10)];
      const lesson = theory.progressionLesson(p.title, p.chords, 72);
      labelNotes(lesson);
      $('nowPlaying').textContent = lesson.title;
      S.current = lesson;
      prepareWaterfall(lesson);
    });
  }

  // 给每个音补上显示标签（按当前显示模式）
  function labelNotes(song) {
    const mode = $('labelMode').value;
    song.notes.forEach((n) => {
      if (mode === 'solfege') n.label = core.midiToSolfege(n.midi);
      else n.label = core.midiToPitch(n.midi);
    });
  }

  // ——————————————————— 瀑布装载 / 控制 ———————————————————
  function prepareWaterfall(song) {
    labelNotes(song);
    waterfall.stop();
    audio.allOff();
    S.started = false;
    const opts = { speed: parseFloat($('speed').value), mode: $('waitToggle').checked ? 'wait' : 'stream' };
    waterfall.setSong(song, opts);
    // 根据曲目音域设置钢琴范围，并自动把映射移到合适八度
    const [lo, hi] = waterfall.pitchRange();
    piano.setRange(Math.min(lo, 48), Math.max(hi, 72));
    autoFitOctave(lo, hi);
    waterfall.render();
    resetHud();
    $('btnPlay').textContent = '▶ 开始';
  }

  // 把键盘映射的基准八度移到能覆盖曲目大部分音的位置
  function autoFitOctave(lo, hi) {
    const mid = Math.round((lo + hi) / 2);
    // 让映射范围中心 (base + 9) 尽量接近曲目中心
    let base = mid - 9;
    base = Math.round(base / 12) * 12; // 对齐到 C
    keymap.setBase(base);
    piano.refreshLabels();
    updateOctaveLabel();
    renderLegend();
  }

  function togglePlay() {
    if (!S.current) return;
    if (waterfall.playing) {
      waterfall.pause();
      $('btnPlay').textContent = '▶ 继续';
    } else {
      audio.resume();
      if (waterfall.state.finished) { prepareWaterfall(S.current); }
      S.started = true;
      waterfall.start(false);
      $('btnPlay').textContent = '⏸ 暂停';
    }
  }

  function listen() {
    if (!S.current) return;
    audio.resume();
    prepareWaterfall(S.current);
    S.started = false;
    waterfall.start(true);
    $('btnPlay').textContent = '▶ 开始';
  }

  function restart() {
    if (!S.current) return;
    prepareWaterfall(S.current);
  }

  // ——————————————————— HUD ———————————————————
  function resetHud() {
    $('combo').textContent = '0';
    $('score').textContent = '0';
    $('accuracy').textContent = '100%';
    $('progressBar').style.width = '0%';
    $('results').classList.add('hidden');
  }

  function onJudge(ev) {
    const { note, kind } = ev;
    piano.flash(note.midi, kind === 'miss' ? 'miss' : (kind === 'perfect' ? 'perfect' : 'good'));
    const st = waterfall.state.stats;
    $('combo').textContent = st.streak;
    $('score').textContent = st.score;
    const hits = st.perfect + st.good;
    const acc = st.total ? Math.round((hits) / (hits + st.miss || 1) * 100) : 100;
    $('accuracy').textContent = (st.perfect + st.good + st.miss ? Math.round((st.perfect + st.good) / (st.perfect + st.good + st.miss) * 100) : 100) + '%';
    popJudge(kind, note.midi);
  }

  function popJudge(kind, midi) {
    const pop = document.createElement('div');
    const txt = { perfect: 'PERFECT', good: 'GOOD', miss: 'MISS' }[kind];
    pop.className = 'judge-pop ' + kind;
    pop.textContent = txt;
    const lane = piano.geometry().lanes.get(midi);
    const stage = $('stage');
    if (lane) pop.style.left = (lane.centerX) + 'px';
    $('judgeLayer').appendChild(pop);
    setTimeout(() => pop.remove(), 600);
  }

  function onProgress(p) {
    $('progressBar').style.width = (p * 100).toFixed(1) + '%';
  }

  function onComplete(stats) {
    $('btnPlay').textContent = '▶ 再来一次';
    const starEl = $('stars');
    starEl.textContent = '★'.repeat(stats.stars) + '☆'.repeat(3 - stats.stars);
    $('resAcc').textContent = Math.round(stats.accuracy * 100) + '%';
    $('resScore').textContent = stats.score;
    $('resDetail').textContent = `完美 ${stats.perfect} · 良好 ${stats.good} · 失误 ${stats.miss} · 最高连击 ${stats.maxStreak}`;
    $('results').classList.remove('hidden');
  }

  function onDemoNoteOn(note) {
    const dur = Math.max(0.18, note.legatoDur || note.durSec);
    audio.pluck(note.midi, dur, 0.8);
    piano.flash(note.midi, 'good');
    piano.setActive(note.midi, true);
    setTimeout(() => piano.setActive(note.midi, false), Math.min(500, dur * 1000));
  }

  // ——————————————————— 自由演奏读出 ———————————————————
  function showFreeReadout(midi) {
    if (S.mode !== 'free') return;
    $('freeNote').textContent = core.midiToPitch(midi) + core.octaveOf(midi);
    $('freeSol').textContent = core.midiToSolfege(midi);
    const code = keymap.midiToCode(midi);
    $('freeKey').textContent = code ? keymap.LABELS[code] : '—';
  }

  // ——————————————————— 设置 / 图例 ———————————————————
  function updateOctaveLabel() {
    const [lo, hi] = keymap.range();
    $('octLabel').textContent = core.midiToName(keymap.baseMidi) + ' 起';
  }

  function renderLegend() {
    const wrap = $('legend');
    if (!wrap) return;
    wrap.innerHTML = '';
    keymap.mappedNotes().forEach((n) => {
      const chip = document.createElement('div');
      chip.className = 'legend-chip ' + (core.isBlack(n.midi) ? 'b' : 'w');
      chip.innerHTML = `<b>${n.label}</b><span>${core.midiToPitch(n.midi)}</span>`;
      wrap.appendChild(chip);
    });
  }

  function applyLabelMode() {
    const mode = $('labelMode').value; // both | key | note | solfege | staff
    piano.setLabelMode(mode);
    waterfall.setLabels({
      name: mode === 'note' || mode === 'solfege' || mode === 'both',
      key: mode === 'key' || mode === 'both' || mode === 'staff',
      staff: mode === 'staff',
      finger: $('fingerToggle').checked,
    });
    if (S.current) { labelNotes(S.current); waterfall.render(); }
  }

  // ——————————————————— 初始化 ———————————————————
  function bindControls() {
    $('tab-free').addEventListener('click', () => setMode('free'));
    $('tab-song').addEventListener('click', () => setMode('song'));
    $('tab-theory').addEventListener('click', () => setMode('theory'));

    $('btnPlay').addEventListener('click', togglePlay);
    $('btnListen').addEventListener('click', listen);
    $('btnRestart').addEventListener('click', restart);
    $('btnRetry').addEventListener('click', () => { $('results').classList.add('hidden'); restart(); setTimeout(togglePlay, 50); });
    $('btnClose').addEventListener('click', () => $('results').classList.add('hidden'));

    $('volume').addEventListener('input', (e) => audio.setVolume(parseFloat(e.target.value)));
    $('speed').addEventListener('change', () => {
      if (!S.current) return;
      const wasPlaying = waterfall.playing;
      prepareWaterfall(S.current); // 按新速度重建
      if (wasPlaying) togglePlay();  // 之前在播就接着播，不要冻住
    });
    $('waitToggle').addEventListener('change', (e) => { waterfall.setMode(e.target.checked ? 'wait' : 'stream'); });
    $('labelMode').addEventListener('change', applyLabelMode);
    $('fingerToggle').addEventListener('change', applyLabelMode);

    $('octDown').addEventListener('click', () => { if (keymap.shiftOctave(-1)) afterOctaveChange(); });
    $('octUp').addEventListener('click', () => { if (keymap.shiftOctave(1)) afterOctaveChange(); });

    $('jpLoad').addEventListener('click', importerLoad);
    $('jpSave').addEventListener('click', importerSave);

    $('themeSel').addEventListener('change', (e) => applyTheme(e.target.value));

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { Array.from(S.sounding).forEach(noteUp); S.down.clear(); });
  }

  const THEME_KEY = 'pg-theme';
  function applyTheme(t) {
    document.body.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }

  function init() {
    const savedTheme = (function () { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } })() || 'midnight';
    document.body.dataset.theme = savedTheme;
    $('themeSel').value = savedTheme;

    piano.init($('piano'), {
      labelMode: 'both',
      onPress: (midi) => { audio.resume(); noteDown(midi, true); },
      onRelease: (midi) => noteUp(midi),
      onResize: () => waterfall.resize(),
    });
    waterfall.init($('waterfall'), {
      onJudge, onProgress, onComplete, onNoteOn: onDemoNoteOn,
    });
    bindControls();
    loadCustoms();
    buildSongList();
    buildTheoryControls();
    buildKeyOptions();
    renderLegend();
    updateOctaveLabel();
    audio.setVolume(parseFloat($('volume').value));
    setMode('free');

    // MIDI（可选）
    midi.init(
      (note, vel) => { audio.resume(); noteDown(note, true); },
      (note) => noteUp(note),
      (status) => {
        const el = $('midiStatus');
        if (!status.supported) { el.textContent = 'MIDI: 浏览器不支持'; waterfall.setMidi(false); }
        else if (status.devices && status.devices.length) { el.textContent = 'MIDI: ' + status.devices.join(', '); el.classList.add('ok'); waterfall.setMidi(true); }
        else { el.textContent = 'MIDI: 未检测到设备'; el.classList.remove('ok'); waterfall.setMidi(false); }
      }
    );

    // 首次交互解锁音频
    const unlock = () => { audio.resume(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  PG.app = { setMode, S };
})(window.PG);
