const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/** Tyre scrub is broadband rubber noise, with a quiet resonant squeal at high load. */
export function tyreSound(speed: number, slip: number, grounded = true) {
  const amount = grounded && speed > 8 ? clamp((slip - 0.08) / 0.72) : 0;
  return { gain: amount ** 1.15 * Math.min(0.18, speed * 0.0035),
    frequency: 580 + Math.min(90, speed) * 2.6 + amount * 260,
    toneGain: amount ** 1.5 * 0.009 };
}

export function vehicleSound(speed: number, throttle: number, rpm: number, brake: number, grounded = true) {
  const revs = clamp(rpm, 800, 10000);const load = clamp(throttle);
  const rolling = clamp(speed / 84);
  const highRevs = clamp((revs - 3200) / 4800);
  return { firingHz: revs / 24, subHz: revs / 60,
    engineGain: (0.065 + load * 0.12 + clamp((revs - 900) / 8000) * 0.025) * (1 - highRevs * 0.62),
    exhaustCutoff: Math.min(1250, 280 + revs * (0.07 + load * 0.12)),
    intakeGain: load ** 1.5 * rolling * 0.022,
    brakeGain: grounded && speed > 3 ? clamp(brake) * Math.min(0.065, speed * 0.0011) : 0,
    windGain: rolling ** 2 * 0.07 };
}

/** One reusable audio graph: firing harmonics, exhaust, intake, rubber and brake friction. */
export class RaceAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: OscillatorNode;
  private sub?: OscillatorNode;
  private engineGain?: GainNode;
  private subGain?: GainNode;
  private engineFilter?: BiquadFilterNode;
  private intakeGain?: GainNode;
  private intakeFilter?: BiquadFilterNode;
  private tyreGain?: GainNode;
  private tyreToneGain?: GainNode;
  private tyreFilter?: BiquadFilterNode;
  private tyreTone?: OscillatorNode;
  private brakeGain?: GainNode;
  private brakeFilter?: BiquadFilterNode;
  private windGain?: GainNode;
  private burbleGain?: GainNode;
  private noise?: AudioBuffer;
  private enabled = true;
  private previousThrottle = 0;
  private previousRpm = 950;
  private shiftUntil = 0;

  async start(): Promise<boolean> {
    try {
      if (!this.context) {
        const context = new AudioContext();this.context = context;
        this.master = context.createGain();this.master.gain.value = this.enabled ? 0.48 : 0;
        const limiter = context.createDynamicsCompressor();limiter.threshold.value = -16;limiter.knee.value = 18;
        limiter.ratio.value = 4;limiter.attack.value = 0.006;limiter.release.value = 0.16;
        this.master.connect(limiter).connect(context.destination);
        // An uneven firing spectrum gives the exhaust a growl rather than a sawtooth buzz.
        const real = new Float32Array(17);const imag = new Float32Array([0, 1, 0.45, 0.15, 0.16, 0.06, 0.10, 0.03, 0.04, 0.015, 0.025, 0.01, 0.015, 0.008, 0.01, 0.005, 0.006]);
        this.engine = context.createOscillator();this.engine.setPeriodicWave(context.createPeriodicWave(real, imag));this.engine.frequency.value = 40;
        this.engineFilter = context.createBiquadFilter();this.engineFilter.type = "lowpass";this.engineFilter.frequency.value = 450;this.engineFilter.Q.value = 0.65;
        this.engineGain = context.createGain();this.engineGain.gain.value = 0;
        this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master);this.engine.start();
        this.sub = context.createOscillator();this.sub.type = "triangle";this.sub.frequency.value = 32;
        this.subGain = context.createGain();this.subGain.gain.value = 0;this.sub.connect(this.subGain).connect(this.master);this.sub.start();
        const noise = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
        const samples = noise.getChannelData(0);let low = 0;
        for (let i = 0; i < samples.length; i++) {
          const white = Math.random() * 2 - 1;low = low * 0.97 + white * 0.03;
          samples[i] = white * 0.55 + low * 2.2;
        }
        this.noise = noise;
        const source = context.createBufferSource();source.buffer = noise;source.loop = true;
        const noiseLayer = (type: BiquadFilterType, frequency: number, q: number) => {
          const filter = context.createBiquadFilter();filter.type = type;filter.frequency.value = frequency;filter.Q.value = q;
          const gain = context.createGain();gain.gain.value = 0;source.connect(filter).connect(gain).connect(this.master!);return { filter, gain };
        };
        const tyres = noiseLayer("bandpass", 1000, 0.65);this.tyreFilter = tyres.filter;this.tyreGain = tyres.gain;
        const intake = noiseLayer("bandpass", 1200, 0.6);this.intakeFilter = intake.filter;this.intakeGain = intake.gain;
        const brakes = noiseLayer("bandpass", 1650, 0.9);this.brakeFilter = brakes.filter;this.brakeGain = brakes.gain;
        this.windGain = noiseLayer("lowpass", 700, 0.5).gain;
        this.burbleGain = noiseLayer("lowpass", 240, 0.7).gain;
        this.tyreTone = context.createOscillator();this.tyreTone.type = "sine";this.tyreTone.frequency.value = 900;
        this.tyreToneGain = context.createGain();this.tyreToneGain.gain.value = 0;
        this.tyreTone.connect(this.tyreToneGain).connect(this.master);this.tyreTone.start();source.start();
      }
      await this.context.resume();return true;
    } catch { return false; }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.context && this.master) this.master.gain.setTargetAtTime(enabled ? 0.48 : 0, this.context.currentTime, 0.03);
    if (enabled && this.context?.state === "suspended") void this.context.resume().catch(() => {});
  }

  playSplash(): void {
    if (!this.context || !this.master || !this.noise) return;
    const context = this.context;const now = context.currentTime;
    const source = context.createBufferSource();source.buffer = this.noise;
    const filter = context.createBiquadFilter();filter.type = "lowpass";filter.frequency.value = 1800;
    filter.frequency.exponentialRampToValueAtTime(230, now + 0.6);
    const gain = context.createGain();gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.45, now + 0.025);gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    source.connect(filter).connect(gain).connect(this.master);source.start();source.stop(now + 0.7);
    source.onended = () => { source.disconnect();filter.disconnect();gain.disconnect(); };
  }

  update(speed: number, throttle: number, drift: number, racing: boolean, rpm = 950 + speed * 70, grounded = true, submerged = false, brake = 0): void {
    if (!this.context) return;
    const now = this.context.currentTime;const tyre = tyreSound(speed, racing ? drift : 0, grounded);
    const sound = vehicleSound(speed, throttle, rpm, racing ? brake : 0, grounded);
    if (racing && throttle > 0.25 && this.previousRpm - rpm > 650) this.shiftUntil = now + 0.11;
    if (racing && this.previousThrottle > 0.55 && throttle < 0.1 && speed > 15 && this.burbleGain) {
      this.burbleGain.gain.cancelScheduledValues(now);this.burbleGain.gain.setValueAtTime(0.045, now);
      this.burbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
    }
    const muffle = submerged ? 0.52 : 1;const shift = now < this.shiftUntil ? 0.55 : 1;
    const gain = (node: GainNode | undefined, value: number, response = 0.045) => node?.gain.setTargetAtTime(racing ? value * muffle : 0, now, response);
    this.engine?.frequency.setTargetAtTime(sound.firingHz, now, 0.035);
    this.sub?.frequency.setTargetAtTime(Math.max(28, sound.subHz), now, 0.05);
    this.engineFilter?.frequency.setTargetAtTime(sound.exhaustCutoff * (submerged ? 0.55 : 1), now, 0.065);
    gain(this.engineGain, sound.engineGain * shift);gain(this.subGain, sound.engineGain * 0.28 * shift);
    gain(this.intakeGain, sound.intakeGain);this.intakeFilter?.frequency.setTargetAtTime(650 + rpm * 0.18, now, 0.08);
    gain(this.tyreGain, tyre.gain, 0.035);this.tyreFilter?.frequency.setTargetAtTime(tyre.frequency, now, 0.05);
    this.tyreTone?.frequency.setTargetAtTime(tyre.frequency * (1.08 + Math.sin(now * 23) * 0.012), now, 0.05);
    gain(this.tyreToneGain, tyre.toneGain, 0.045);gain(this.brakeGain, sound.brakeGain, 0.035);
    this.brakeFilter?.frequency.setTargetAtTime(1100 + speed * 9, now, 0.08);gain(this.windGain, sound.windGain, 0.2);
    if (!racing) this.burbleGain?.gain.setTargetAtTime(0, now, 0.05);
    this.previousThrottle = throttle;this.previousRpm = rpm;
  }
}
