const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/** Quiet rubber scrub builds into a rough, two-band squeal as traction breaks. */
export function tyreSound(speed: number, slip: number, grounded = true) {
  const rolling = grounded ? clamp((speed - 4) / 32) : 0;
  const scrub = clamp((slip - 0.035) / 0.45);
  const slide = clamp((slip - 0.24) / 0.62);
  return { gain: scrub ** 0.85 * rolling * 0.12,
    frequency: 1150 + clamp(speed / 90) * 230 - slide * 280,
    toneGain: slide ** 1.3 * rolling * 0.11,
    overtoneGain: slide ** 1.7 * rolling * 0.045 };
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
  private vehicleBus?: GainNode;
  private engine?: OscillatorNode;
  private sub?: OscillatorNode;
  private engineGain?: GainNode;
  private subGain?: GainNode;
  private engineFilter?: BiquadFilterNode;
  private intakeGain?: GainNode;
  private intakeFilter?: BiquadFilterNode;
  private tyreGain?: GainNode;
  private tyreToneGain?: GainNode;
  private tyreOvertoneGain?: GainNode;
  private tyreFilter?: BiquadFilterNode;
  private tyreResonance?: BiquadFilterNode;
  private tyreOvertone?: BiquadFilterNode;
  private brakeGain?: GainNode;
  private brakeFilter?: BiquadFilterNode;
  private windGain?: GainNode;
  private burbleGain?: GainNode;
  private enabled = true;
  private previousThrottle = 0;
  private previousRpm = 950;
  private shiftUntil = 0;

  async start(): Promise<boolean> {
    try {
      if (!this.context) {
        const context = new AudioContext();this.context = context;
        this.master = context.createGain();this.master.gain.value = this.enabled ? 0.48 : 0;
        // Keep normal driving below the former underwater volume. The existing
        // underwater gain and filter still muffle it further on water entry.
        this.vehicleBus = context.createGain();this.vehicleBus.gain.value = 0.36;
        this.vehicleBus.connect(this.master);
        const limiter = context.createDynamicsCompressor();limiter.threshold.value = -16;limiter.knee.value = 18;
        limiter.ratio.value = 4;limiter.attack.value = 0.006;limiter.release.value = 0.16;
        this.master.connect(limiter).connect(context.destination);
        // An uneven firing spectrum gives the exhaust a growl rather than a sawtooth buzz.
        const real = new Float32Array(17);const imag = new Float32Array([0, 1, 0.45, 0.15, 0.16, 0.06, 0.10, 0.03, 0.04, 0.015, 0.025, 0.01, 0.015, 0.008, 0.01, 0.005, 0.006]);
        this.engine = context.createOscillator();this.engine.setPeriodicWave(context.createPeriodicWave(real, imag));this.engine.frequency.value = 40;
        this.engineFilter = context.createBiquadFilter();this.engineFilter.type = "lowpass";this.engineFilter.frequency.value = 450;this.engineFilter.Q.value = 0.65;
        this.engineGain = context.createGain();this.engineGain.gain.value = 0;
        this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.vehicleBus);this.engine.start();
        this.sub = context.createOscillator();this.sub.type = "triangle";this.sub.frequency.value = 32;
        this.subGain = context.createGain();this.subGain.gain.value = 0;this.sub.connect(this.subGain).connect(this.vehicleBus);this.sub.start();
        const noise = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
        const samples = noise.getChannelData(0);let low = 0;
        for (let i = 0; i < samples.length; i++) {
          const white = Math.random() * 2 - 1;low = low * 0.97 + white * 0.03;
          samples[i] = white * 0.55 + low * 2.2;
        }
        const source = context.createBufferSource();source.buffer = noise;source.loop = true;
        const noiseLayer = (type: BiquadFilterType, frequency: number, q: number, vehicle = false) => {
          const filter = context.createBiquadFilter();filter.type = type;filter.frequency.value = frequency;filter.Q.value = q;
          const gain = context.createGain();gain.gain.value = 0;
          source.connect(filter).connect(gain).connect(vehicle ? this.vehicleBus! : this.master!);return { filter, gain };
        };
        const tyres = noiseLayer("bandpass", 650, 0.7);this.tyreFilter = tyres.filter;this.tyreGain = tyres.gain;
        const intake = noiseLayer("bandpass", 1200, 0.6, true);this.intakeFilter = intake.filter;this.intakeGain = intake.gain;
        const brakes = noiseLayer("bandpass", 1650, 0.9);this.brakeFilter = brakes.filter;this.brakeGain = brakes.gain;
        this.windGain = noiseLayer("lowpass", 700, 0.5, true).gain;
        this.burbleGain = noiseLayer("lowpass", 240, 0.7, true).gain;
        // Excite rubber resonances with noise instead of a clean electronic
        // oscillator. Slow random amplitude variation gives the slide texture.
        const tyreSource = context.createBufferSource();tyreSource.buffer = noise;tyreSource.loop = true;
        const flutterFilter = context.createBiquadFilter();flutterFilter.type = "lowpass";flutterFilter.frequency.value = 18;
        const flutterDepth = context.createGain();flutterDepth.gain.value = 1.5;
        const friction = context.createGain();friction.gain.value = 0.85;
        tyreSource.connect(flutterFilter).connect(flutterDepth).connect(friction.gain);
        tyreSource.connect(friction);
        const resonance = (frequency: number, q: number) => {
          const filter = context.createBiquadFilter();filter.type = "bandpass";filter.frequency.value = frequency;filter.Q.value = q;
          const gain = context.createGain();gain.gain.value = 0;friction.connect(filter).connect(gain).connect(this.master!);
          return { filter, gain };
        };
        const fundamental = resonance(1100, 4.5);this.tyreResonance = fundamental.filter;this.tyreToneGain = fundamental.gain;
        const overtone = resonance(1900, 6);this.tyreOvertone = overtone.filter;this.tyreOvertoneGain = overtone.gain;
        tyreSource.start(0, 0.731);source.start();
      }
      await this.context.resume();return true;
    } catch { return false; }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.context && this.master) this.master.gain.setTargetAtTime(enabled ? 0.48 : 0, this.context.currentTime, 0.03);
    if (enabled && this.context?.state === "suspended") void this.context.resume().catch(() => {});
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
    gain(this.tyreGain, tyre.gain, 0.025);this.tyreFilter?.frequency.setTargetAtTime(420 + Math.min(90, speed) * 4, now, 0.06);
    this.tyreResonance?.frequency.setTargetAtTime(tyre.frequency, now, 0.055);
    this.tyreOvertone?.frequency.setTargetAtTime(tyre.frequency * 1.73, now, 0.07);
    gain(this.tyreToneGain, tyre.toneGain, 0.035);gain(this.tyreOvertoneGain, tyre.overtoneGain, 0.045);
    gain(this.brakeGain, sound.brakeGain, 0.035);
    this.brakeFilter?.frequency.setTargetAtTime(1100 + speed * 9, now, 0.08);gain(this.windGain, sound.windGain, 0.2);
    if (!racing) this.burbleGain?.gain.setTargetAtTime(0, now, 0.05);
    this.previousThrottle = throttle;this.previousRpm = rpm;
  }
}
