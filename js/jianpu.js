/* jianpu.js — 简谱解析器
 * 把一行简谱文本解析成 token 列表 [[音名, 时值拍], ...]，供曲谱使用。
 * 语法（纯文本，方便粘贴）：
 *   1-7   = 当前调的 do re mi fa sol la si；0 = 休止
 *   '     = 高八度（可叠加 ''），  , = 低八度（可叠加 ,,）
 *   #/b   = 升/降（写在数字前，如 #4、b7）
 *   .     = 附点（时值 ×1.5，如 5.）
 *   /     = 减半 / 八分音符（每个 / 再 ×0.5，如 5/ 是八分，5// 是十六分）
 *   -     = 单独的 - 把前一个音延长一拍（如 5 - 是二分音符）
 *   |     = 小节线，忽略
 * 例：  1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 -   （小星星，调=C）
 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  const DEG = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };

  // keyMidi = 简谱「1」对应的 MIDI（默认 60 = C4）
  function parse(text, keyMidi) {
    keyMidi = (keyMidi == null || isNaN(keyMidi)) ? 60 : keyMidi;
    const raw = String(text).replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
    const tokens = [];
    let last = null;
    for (let r = 0; r < raw.length; r++) {
      let s = raw[r];
      if (s === '-') { if (last) last[1] += 1; continue; }
      let acc = 0;
      while (s[0] === '#' || s[0] === 'b') { acc += s[0] === '#' ? 1 : -1; s = s.slice(1); }
      const d = s[0];
      if (!/[0-7]/.test(d)) continue; // 跳过无法识别的字符
      s = s.slice(1);
      let oct = 0, dur = 1;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "'") oct++;
        else if (ch === ',') oct--;
        else if (ch === '.') dur *= 1.5;
        else if (ch === '/') dur *= 0.5;
      }
      if (d === '0') { const t = ['rest', dur]; tokens.push(t); last = t; continue; }
      const midi = keyMidi + DEG[d] + 12 * oct + acc;
      const t = [PG.core.midiToName(midi), dur];
      tokens.push(t);
      last = t;
    }
    return tokens;
  }

  // 直接产出一首歌（notes 用 songs.melody 展开）
  function toSong(opts) {
    const tokens = parse(opts.text, opts.keyMidi);
    return {
      id: opts.id || ('custom-' + (opts.title || 'song')),
      title: opts.title || '自定义曲',
      cn: opts.cn || '',
      category: opts.category || '自定义',
      difficulty: opts.difficulty || 2,
      bpm: opts.bpm || 90,
      custom: opts.custom || false,
      approx: opts.approx || false,
      jianpu: opts.text,
      keyMidi: opts.keyMidi == null ? 60 : opts.keyMidi,
      notes: PG.songs.melody(tokens, opts.hand || 'R'),
    };
  }

  PG.jianpu = { parse, toSong };
})(window.PG);
