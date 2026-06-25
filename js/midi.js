/* midi.js — 可选的 Web MIDI 支持：插了真实 MIDI 键盘也能用。
 * 处理热插拔：设备断开时释放仍按住的音，避免卡住长鸣；并实时更新设备状态。
 */
window.PG = window.PG || {};

(function (PG) {
  'use strict';

  let access = null;
  const handlers = { on: null, off: null, status: null };
  const onNotes = new Set(); // 当前按住的 MIDI 音

  function onMessage(e) {
    const [status, note, vel] = e.data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && vel > 0) {
      onNotes.add(note);
      if (handlers.on) handlers.on(note, vel / 127);
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      onNotes.delete(note);
      if (handlers.off) handlers.off(note);
    }
  }

  function flushNotes() {
    onNotes.forEach((n) => { if (handlers.off) handlers.off(n); });
    onNotes.clear();
  }

  function bindInputs() {
    if (!access) return;
    access.inputs.forEach((input) => { input.onmidimessage = onMessage; });
  }

  function reportStatus() {
    if (!handlers.status) return;
    const names = [];
    if (access) access.inputs.forEach((i) => names.push(i.name));
    handlers.status({ supported: true, devices: names });
  }

  function onState(e) {
    bindInputs();
    if (e && e.port && e.port.state === 'disconnected') flushNotes(); // 拔线时释放卡住的音
    reportStatus();
  }

  function init(onNoteOn, onNoteOff, onStatus) {
    handlers.on = onNoteOn;
    handlers.off = onNoteOff;
    handlers.status = onStatus;
    if (!navigator.requestMIDIAccess) {
      if (onStatus) onStatus({ supported: false });
      return;
    }
    navigator.requestMIDIAccess().then((acc) => {
      access = acc;
      bindInputs();
      access.onstatechange = onState;
      reportStatus();
    }).catch(() => {
      if (onStatus) onStatus({ supported: false });
    });
  }

  PG.midi = { init };
})(window.PG);
