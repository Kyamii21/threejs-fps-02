// Synthesised sound, no audio files. Every effect is built from oscillators and filtered
// noise through one master gain, so the game ships no media and loads nothing over the
// network. The AudioContext is created lazily on the first user gesture (the play click),
// which is what browsers require; until then every call is a silent no-op.
const NOISE_SECONDS = 1;

export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, context.sampleRate * NOISE_SECONDS, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise({ duration, frequency, gain, type = 'lowpass', when = 0 }) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start(t, Math.random());
    source.stop(t + duration + 0.05);
  }

  function tone({ frequency, endFrequency = frequency, duration, gain, type = 'sine', when = 0 }) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (endFrequency !== frequency) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), t + duration);
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  return {
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted() {
      return muted;
    },
    // A gunshot is a short noise crack plus a low thump; the weapon's pitch picks the filter.
    shot(kind) {
      const pitch = kind === 'sniper' ? 900 : kind === 'smg' ? 2400 : kind === 'pistol' ? 1800 : 1500;
      noise({ duration: 0.09, frequency: pitch, gain: 0.9 });
      tone({ frequency: kind === 'sniper' ? 140 : 90, endFrequency: 45, duration: 0.12, gain: 0.7, type: 'triangle' });
    },
    dryClick() {
      tone({ frequency: 1400, duration: 0.03, gain: 0.25, type: 'square' });
    },
    reload() {
      tone({ frequency: 900, duration: 0.04, gain: 0.2, type: 'square', when: 0 });
      tone({ frequency: 620, duration: 0.04, gain: 0.2, type: 'square', when: 0.35 });
      tone({ frequency: 1100, duration: 0.05, gain: 0.25, type: 'square', when: 1.15 });
    },
    hit() {
      tone({ frequency: 2200, duration: 0.05, gain: 0.3, type: 'square' });
    },
    kill() {
      tone({ frequency: 1320, duration: 0.07, gain: 0.3, type: 'square' });
      tone({ frequency: 1760, duration: 0.09, gain: 0.3, type: 'square', when: 0.07 });
    },
    hurt() {
      tone({ frequency: 160, endFrequency: 90, duration: 0.18, gain: 0.5, type: 'sawtooth' });
    },
    step() {
      noise({ duration: 0.05, frequency: 500, gain: 0.08 });
    },
    beep() {
      tone({ frequency: 980, duration: 0.09, gain: 0.35, type: 'square' });
    },
    plant() {
      tone({ frequency: 660, duration: 0.08, gain: 0.3, type: 'square' });
      tone({ frequency: 660, duration: 0.08, gain: 0.3, type: 'square', when: 0.18 });
    },
    explosion() {
      noise({ duration: 0.7, frequency: 320, gain: 1.0 });
      tone({ frequency: 70, endFrequency: 28, duration: 0.8, gain: 0.9, type: 'sine' });
    },
    buy() {
      tone({ frequency: 880, duration: 0.06, gain: 0.25, type: 'square' });
      tone({ frequency: 1174, duration: 0.08, gain: 0.25, type: 'square', when: 0.06 });
    },
    denied() {
      tone({ frequency: 220, duration: 0.12, gain: 0.3, type: 'square' });
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ frequency: f, duration: 0.16, gain: 0.3, type: 'triangle', when: i * 0.12 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ frequency: f, duration: 0.18, gain: 0.3, type: 'triangle', when: i * 0.13 }));
    },
  };
}
