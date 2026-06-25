/* keymap.js — 电脑键盘 → 钢琴音符 的预定义映射
 *
 * 设计（GarageBand「音乐键入」同款，最贴近真实钢琴手感）：
 *   主键盘行 A S D F G H J K L ; '  = 白键（一字排开，手指自然平放）
 *   上方一行 W E   T Y U   O P   ]  = 黑键（错落在白键之间，和真钢琴位置一致）
 *
 * 偏移量 = 相对「当前基准八度的 C」的半音数。
 * 实际音高 = baseMidi + 偏移，baseMidi 默认 = 60(C4)，用 Z/X 上下移八度。
 * 整排覆盖约 1.5 个八度（C 到 F#，19 个半音），配合移八度可达全键盘。
 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  // event.code -> 半音偏移
  const OFFSETS = {
    // —— 白键（home row）——
    KeyA: 0,   // C
    KeyS: 2,   // D
    KeyD: 4,   // E
    KeyF: 5,   // F
    KeyG: 7,   // G
    KeyH: 9,   // A
    KeyJ: 11,  // B
    KeyK: 12,  // C
    KeyL: 14,  // D
    Semicolon: 16, // E
    Quote: 17,     // F
    // —— 黑键（top row）——
    KeyW: 1,   // C#
    KeyE: 3,   // D#
    KeyT: 6,   // F#
    KeyY: 8,   // G#
    KeyU: 10,  // A#
    KeyO: 13,  // C#
    KeyP: 15,  // D#
    BracketRight: 18, // F#
  };

  // 给屏幕上的键帽显示用的「人类可读」标签
  const LABELS = {
    KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyG: 'G', KeyH: 'H',
    KeyJ: 'J', KeyK: 'K', KeyL: 'L', Semicolon: ';', Quote: "'",
    KeyW: 'W', KeyE: 'E', KeyT: 'T', KeyY: 'Y', KeyU: 'U',
    KeyO: 'O', KeyP: 'P', BracketRight: ']',
  };

  // 反向：偏移 -> event.code（同一偏移只会有一个键）
  const OFFSET_TO_CODE = {};
  Object.keys(OFFSETS).forEach((code) => { OFFSET_TO_CODE[OFFSETS[code]] = code; });

  // 控制键
  const CONTROL = {
    KeyZ: 'octaveDown',
    KeyX: 'octaveUp',
  };

  const MIN_OFFSET = Math.min(...Object.values(OFFSETS)); // 0
  const MAX_OFFSET = Math.max(...Object.values(OFFSETS)); // 18

  const state = {
    baseMidi: 60, // 当前基准八度的 C，默认中央 C
    minBase: 24,  // C1
    maxBase: 96,  // C7
  };

  function codeToMidi(code) {
    if (!(code in OFFSETS)) return null;
    return state.baseMidi + OFFSETS[code];
  }

  // 给定一个目标 MIDI，返回当前基准下能弹它的键（event.code），不在范围内则 null
  function midiToCode(midi) {
    const offset = midi - state.baseMidi;
    if (offset < MIN_OFFSET || offset > MAX_OFFSET) return null;
    return OFFSET_TO_CODE[offset] || null;
  }

  // 当前映射覆盖的 MIDI 范围 [lo, hi]
  function range() {
    return [state.baseMidi + MIN_OFFSET, state.baseMidi + MAX_OFFSET];
  }

  // 当前所有「已映射」的音：返回 [{midi, code, label}]
  function mappedNotes() {
    const out = [];
    Object.keys(OFFSETS).forEach((code) => {
      const offset = OFFSETS[code];
      out.push({ midi: state.baseMidi + offset, code, label: LABELS[code], offset });
    });
    out.sort((a, b) => a.midi - b.midi);
    return out;
  }

  function shiftOctave(dir) {
    const next = state.baseMidi + dir * 12;
    if (next < state.minBase || next > state.maxBase) return false;
    state.baseMidi = next;
    return true;
  }

  function setBase(midi) {
    state.baseMidi = Math.max(state.minBase, Math.min(state.maxBase, midi));
  }

  PG.keymap = {
    OFFSETS,
    LABELS,
    CONTROL,
    state,
    codeToMidi,
    midiToCode,
    range,
    mappedNotes,
    shiftOctave,
    setBase,
    get baseMidi() { return state.baseMidi; },
  };
})(window.PG);
