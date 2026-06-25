/* audio.js — Web Audio 合成钢琴音色（无需采样文件，离线可用）
 * 三层振荡器 + ADSR 包络 + 低通滤波 + 简易混响，模拟电钢琴质感。
 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  const { midiToFreq } = PG.core;

  let ctx = null;
  let master = null;
  let reverbWet = null;
  let reverbDry = null;
  const active = new Map(); // midi -> voice

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    // —— 简易混响：用算法生成脉冲响应 ——
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(2.2, 2.5);
    reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.18;
    reverbDry = ctx.createGain();
    reverbDry.gain.value = 1.0;
    convolver.connect(reverbWet).connect(master);
    reverbDry.connect(master);

    PG.audio._bus = { dry: reverbDry, wet: convolver };
    return ctx;
  }

  function makeImpulse(duration, decay) {
    const rate = (ctx || new (window.AudioContext || window.webkitAudioContext)()).sampleRate;
    const len = Math.floor(rate * duration);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // 解除浏览器自动播放限制（首次用户交互时调用）
  function resume() {
    ensureCtx();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setVolume(v) {
    ensureCtx();
    master.gain.setTargetAtTime(v, ctx.now ? ctx.now() : ctx.currentTime, 0.01);
  }

  function noteOn(midi, velocity) {
    ensureCtx();
    if (active.has(midi)) noteOff(midi, true);
    const vel = velocity == null ? 0.8 : velocity;
    const freq = midiToFreq(midi);
    const t = ctx.currentTime;

    const voiceGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    // 高音更亮、低音更暗
    filter.frequency.value = Math.min(16000, 1200 + freq * 5);
    filter.Q.value = 0.4;

    const oscs = [];
    // 基音(三角) + 八度泛音(正弦) + 轻微失谐(锯齿弱)
    const specs = [
      { type: 'triangle', detune: 0, gain: 0.6, mult: 1 },
      { type: 'sine', detune: 4, gain: 0.25, mult: 1 },
      { type: 'sine', detune: 0, gain: 0.15, mult: 2 },
    ];
    specs.forEach((s) => {
      const o = ctx.createOscillator();
      o.type = s.type;
      o.frequency.value = freq * s.mult;
      o.detune.value = s.detune;
      const g = ctx.createGain();
      g.gain.value = s.gain;
      o.connect(g).connect(filter);
      o.start(t);
      oscs.push(o);
    });

    filter.connect(voiceGain);
    voiceGain.connect(reverbDry);
    voiceGain.connect(PG.audio._bus.wet);

    // ADSR：快起音、缓慢衰减（钢琴是无延音的自然衰减）
    const peak = 0.32 * vel;
    const sustain = peak * 0.62;
    voiceGain.gain.setValueAtTime(0.0001, t);
    voiceGain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    voiceGain.gain.exponentialRampToValueAtTime(sustain, t + 0.28);
    // 长期缓降，松键前不会完全消失（尾音放长，旋律更连贯）
    voiceGain.gain.setTargetAtTime(0.0001, t + 0.28, 3.2);

    active.set(midi, { oscs, voiceGain, filter, startedAt: t });
  }

  function noteOff(midi, immediate) {
    const v = active.get(midi);
    if (!v) return;
    active.delete(midi);
    const t = ctx.currentTime;
    const release = immediate ? 0.03 : 0.24;
    try {
      v.voiceGain.gain.cancelScheduledValues(t);
      const cur = Math.max(0.0001, v.voiceGain.gain.value);
      v.voiceGain.gain.setValueAtTime(cur, t);
      v.voiceGain.gain.exponentialRampToValueAtTime(0.0001, t + release);
    } catch (e) { /* noop */ }
    v.oscs.forEach((o) => { try { o.stop(t + release + 0.05); } catch (e) {} });
  }

  // 预览：弹一下并在 dur 秒后自动松开
  function pluck(midi, dur, velocity) {
    noteOn(midi, velocity);
    const v = active.get(midi); // 绑定到这一次创建的声音
    const ms = (dur == null ? 0.5 : dur) * 1000;
    setTimeout(() => { if (active.get(midi) === v) noteOff(midi); }, ms);
  }

  function allOff() {
    Array.from(active.keys()).forEach((m) => noteOff(m, true));
  }

  PG.audio = {
    resume,
    setVolume,
    noteOn,
    noteOff,
    pluck,
    allOff,
    _bus: null,
    get ctx() { return ctx; },
  };
})(window.PG);
