/* theory.js — 乐理数据与练习生成：音阶 / 和弦 / 指法
 * 所有「练习」都生成统一的曲谱格式：{ title, bpm, notes:[{time,midi,dur,finger,hand,label?}] }
 * time / dur 单位是「拍」(beat)。
 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  const { nameToMidi, midiToPitch } = PG.core;

  // 音阶：相对根音的半音步进
  const SCALES = {
    major:        { name: '大调',     steps: [0, 2, 4, 5, 7, 9, 11] },
    naturalMinor: { name: '自然小调', steps: [0, 2, 3, 5, 7, 8, 10] },
    pentMajor:    { name: '大调五声', steps: [0, 2, 4, 7, 9] },
    pentMinor:    { name: '小调五声', steps: [0, 3, 5, 7, 10] },
    blues:        { name: '布鲁斯',   steps: [0, 3, 5, 6, 7, 10] },
    chromatic:    { name: '半音阶',   steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  };

  // 和弦：相对根音的半音
  const CHORD_TYPES = {
    maj:  { name: '大三和弦', steps: [0, 4, 7],     suffix: '' },
    min:  { name: '小三和弦', steps: [0, 3, 7],     suffix: 'm' },
    dim:  { name: '减三和弦', steps: [0, 3, 6],     suffix: 'dim' },
    aug:  { name: '增三和弦', steps: [0, 4, 8],     suffix: 'aug' },
    maj7: { name: '大七和弦', steps: [0, 4, 7, 11], suffix: 'maj7' },
    min7: { name: '小七和弦', steps: [0, 3, 7, 10], suffix: 'm7' },
    dom7: { name: '属七和弦', steps: [0, 4, 7, 10], suffix: '7' },
    sus4: { name: '挂四和弦', steps: [0, 5, 7],     suffix: 'sus4' },
  };

  // 标准 C 大调音阶右手指法（上行 8 音含八度），黑键调近似沿用
  const RH_UP   = [1, 2, 3, 1, 2, 3, 4, 5];
  const RH_DOWN = [5, 4, 3, 2, 1, 3, 2, 1];
  const LH_UP   = [5, 4, 3, 2, 1, 3, 2, 1];
  const LH_DOWN = [1, 2, 3, 1, 2, 3, 4, 5];

  function scaleMidis(rootMidi, type) {
    const sc = SCALES[type] || SCALES.major;
    const ups = sc.steps.map((s) => rootMidi + s);
    ups.push(rootMidi + 12); // 加八度收尾
    return ups;
  }

  // 生成「上行 + 下行」音阶练习
  function scaleLesson(rootMidi, type, hand) {
    const sc = SCALES[type] || SCALES.major;
    const ups = scaleMidis(rootMidi, type);
    const downs = ups.slice(0, -1).reverse(); // 不重复最高音
    const up = (hand === 'L') ? LH_UP : RH_UP;
    const down = (hand === 'L') ? LH_DOWN : RH_DOWN;
    const notes = [];
    let t = 0;
    ups.forEach((midi, i) => {
      notes.push({ time: t, midi, dur: 0.9, finger: up[i] || 0, hand: hand || 'R' });
      t += 1;
    });
    downs.forEach((midi, i) => {
      notes.push({ time: t, midi, dur: 0.9, finger: down[i] || 0, hand: hand || 'R' });
      t += 1;
    });
    return {
      id: 'scale-' + type + '-' + rootMidi,
      title: midiToPitch(rootMidi) + ' ' + sc.name + '音阶',
      bpm: 80,
      kind: 'scale',
      notes,
    };
  }

  function chordMidis(rootMidi, type) {
    const ct = CHORD_TYPES[type] || CHORD_TYPES.maj;
    return ct.steps.map((s) => rootMidi + s);
  }

  function chordName(rootMidi, type) {
    const ct = CHORD_TYPES[type] || CHORD_TYPES.maj;
    return midiToPitch(rootMidi) + ct.suffix;
  }

  // 和弦进行练习：每个和弦整块同时落下、保持一小节
  function progressionLesson(title, chords, bpm) {
    // chords: [{root:'C4', type:'maj'}, ...]
    const notes = [];
    let t = 0;
    const beatsPerChord = 4;
    chords.forEach((c) => {
      const root = nameToMidi(c.root);
      const midis = chordMidis(root, c.type);
      const fingers = midis.length === 3 ? [1, 3, 5] : [1, 2, 3, 5];
      midis.forEach((midi, i) => {
        notes.push({ time: t, midi, dur: beatsPerChord * 0.92, finger: fingers[i] || 0, hand: 'R', chord: chordName(root, c.type) });
      });
      t += beatsPerChord;
    });
    return { id: 'prog-' + title, title, bpm: bpm || 72, kind: 'chord', notes };
  }

  // 单个和弦的琶音 + 整块练习
  function chordLesson(rootMidi, type) {
    const midis = chordMidis(rootMidi, type);
    const fingers = midis.length === 3 ? [1, 3, 5] : [1, 2, 3, 5];
    const notes = [];
    let t = 0;
    // 琶音上行
    midis.forEach((midi, i) => { notes.push({ time: t, midi, dur: 0.9, finger: fingers[i], hand: 'R' }); t += 1; });
    // 整块
    midis.forEach((midi, i) => { notes.push({ time: t, midi, dur: 1.9, finger: fingers[i], hand: 'R' }); });
    return { id: 'chord-' + type + '-' + rootMidi, title: chordName(rootMidi, type) + ' 和弦', bpm: 80, kind: 'chord', notes };
  }

  // 预置常用进行
  const PROGRESSIONS = [
    { title: '卡农 I–V–vi–iii–IV', chords: [
      { root: 'C4', type: 'maj' }, { root: 'G3', type: 'maj' }, { root: 'A3', type: 'min' }, { root: 'E3', type: 'min' },
      { root: 'F3', type: 'maj' }, { root: 'C4', type: 'maj' }, { root: 'F3', type: 'maj' }, { root: 'G3', type: 'maj' },
    ] },
    { title: '流行 I–V–vi–IV', chords: [
      { root: 'C4', type: 'maj' }, { root: 'G3', type: 'maj' }, { root: 'A3', type: 'min' }, { root: 'F3', type: 'maj' },
    ] },
    { title: '小调 vi–IV–I–V', chords: [
      { root: 'A3', type: 'min' }, { root: 'F3', type: 'maj' }, { root: 'C4', type: 'maj' }, { root: 'G3', type: 'maj' },
    ] },
    { title: '爵士 ii–V–I', chords: [
      { root: 'D4', type: 'min7' }, { root: 'G3', type: 'dom7' }, { root: 'C4', type: 'maj7' },
    ] },
  ];

  PG.theory = {
    SCALES, CHORD_TYPES, PROGRESSIONS,
    scaleMidis, scaleLesson, chordMidis, chordName, chordLesson, progressionLesson,
  };
})(window.PG);
