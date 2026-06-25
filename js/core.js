/* core.js — 音乐基础工具：音名 / 频率 / MIDI 编号
 * 内部统一用 MIDI 编号表示音高：60 = C4 = 中央 C。
 * 全局命名空间 PG。
 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  // 十二平均律音名（升号体系）
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // 唱名（do re mi）—— 只给白键，黑键沿用下方白键的 #
  const SOLFEGE = {
    0: 'Do', 2: 'Re', 4: 'Mi', 5: 'Fa', 7: 'Sol', 9: 'La', 11: 'Si',
  };
  // 半音里属于黑键的位置
  const BLACK_SET = new Set([1, 3, 6, 8, 10]);

  // MIDI -> "C4" 这种带八度的音名
  function midiToName(midi) {
    const octave = Math.floor(midi / 12) - 1;
    return NOTE_NAMES[((midi % 12) + 12) % 12] + octave;
  }

  // MIDI -> 纯音名（不带八度），如 "C#"
  function midiToPitch(midi) {
    return NOTE_NAMES[((midi % 12) + 12) % 12];
  }

  // MIDI -> 唱名（黑键返回 null，由调用方决定显示）
  function midiToSolfege(midi) {
    const pc = ((midi % 12) + 12) % 12;
    if (SOLFEGE[pc]) return SOLFEGE[pc];
    // 黑键：取下方白键的唱名 + #
    return SOLFEGE[pc - 1] + '#';
  }

  // "C4" / "F#3" -> MIDI 编号
  function nameToMidi(name) {
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
    if (!m) return null;
    const letterToPc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let pc = letterToPc[m[1].toUpperCase()];
    if (m[2] === '#') pc += 1;
    else if (m[2] === 'b') pc -= 1;
    const octave = parseInt(m[3], 10);
    return (octave + 1) * 12 + pc;
  }

  // MIDI -> 频率（Hz），A4(69)=440Hz
  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function isBlack(midi) {
    return BLACK_SET.has(((midi % 12) + 12) % 12);
  }

  // 八度数字，用于显示
  function octaveOf(midi) {
    return Math.floor(midi / 12) - 1;
  }

  // —— 五线谱定位（识谱练习用）——
  // 高音谱表：底线 E4=30，中线 B4=34，顶线 F5=38（diatonic = 八度*7 + 字母序号）
  const STAFF_TOP = 38, STAFF_BOTTOM = 30;
  function staffInfo(midi) {
    const pc = ((midi % 12) + 12) % 12;
    const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // 黑键取下方白键字母
    const SHARP  = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    const diatonic = (Math.floor(midi / 12) - 1) * 7 + LETTER[pc];
    const ledgers = [];
    for (let L = STAFF_TOP + 2; L <= diatonic; L += 2) ledgers.push(L);    // 上加线
    for (let L = STAFF_BOTTOM - 2; L >= diatonic; L -= 2) ledgers.push(L); // 下加线
    return { diatonic, sharp: !!SHARP[pc], ledgers };
  }

  PG.core = {
    STAFF_TOP, STAFF_BOTTOM, staffInfo,
    NOTE_NAMES,
    SOLFEGE,
    midiToName,
    midiToPitch,
    midiToSolfege,
    nameToMidi,
    midiToFreq,
    isBlack,
    octaveOf,
    MIDDLE_C: 60,
  };
})(window.PG);
