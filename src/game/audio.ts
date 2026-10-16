/** Tyre sound follows grip loss and load, with no stationary/airborne squeal. */
export function tyreSound(speed: number, slip: number, grounded = true) {
  const amount = grounded && speed > 8 ? Math.max(0, Math.min(1, (slip - 0.12) / 0.65)) : 0;
  return { gain: amount * Math.min(0.12, speed * 0.0025),
    frequency: 520 + Math.min(90, speed) * 3.2 + amount * 280,
    toneGain: amount * 0.021 };
}

export class RaceAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: OscillatorNode;
  private engineGain?: GainNode;
  private tyreGain?: GainNode;
  private tyreToneGain?: GainNode;
  private tyreFilter?: BiquadFilterNode;
  private tyreTone?: OscillatorNode;
  private windGain?: GainNode;
  private noise?: AudioBuffer;
  private enabled = true;

  async start(): Promise<boolean> {
    try {
      if (!this.context) {
        const context = new AudioContext();this.context = context;
        this.master = context.createGain();this.master.gain.value = this.enabled ? 0.32 : 0;
        this.master.connect(context.destination);
        const engine = context.createOscillator();engine.type = "sawtooth";engine.frequency.value = 45;
        const engineFilter = context.createBiquadFilter();engineFilter.type = "lowpass";engineFilter.frequency.value = 450;
        this.engineGain = context.createGain();this.engineGain.gain.value = 0;
        engine.connect(engineFilter).connect(this.engineGain).connect(this.master);engine.start();this.engine = engine;
        const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const samples = noise.getChannelData(0);let brown = 0;
        for (let index = 0; index < samples.length; index++) {
          brown = (brown + (Math.random() * 2 - 1) * 0.08) / 1.025;
          samples[index] = brown * 2.7;
        }
        this.noise = noise;
        const source = context.createBufferSource();source.buffer = noise;source.loop = true;
        const tyreFilter = context.createBiquadFilter();tyreFilter.type = "bandpass";tyreFilter.frequency.value = 800;tyreFilter.Q.value = 0.75;
        this.tyreFilter = tyreFilter;this.tyreGain = context.createGain();this.tyreGain.gain.value = 0;
        source.connect(tyreFilter).connect(this.tyreGain).connect(this.master);
        const tone = context.createOscillator();tone.type = "triangle";tone.frequency.value = 700;
        this.tyreTone = tone;this.tyreToneGain = context.createGain();this.tyreToneGain.gain.value = 0;
        const wobble = context.createOscillator();wobble.frequency.value = 5.5;
        const wobbleDepth = context.createGain();wobbleDepth.gain.value = 16;
        wobble.connect(wobbleDepth).connect(tone.frequency);wobble.start();
        tone.connect(this.tyreToneGain).connect(this.master);tone.start();
        const windFilter = context.createBiquadFilter();windFilter.type = "lowpass";windFilter.frequency.value = 650;
        this.windGain = context.createGain();this.windGain.gain.value = 0;
        source.connect(windFilter).connect(this.windGain).connect(this.master);source.start();
      }
      await this.context.resume();return true;
    } catch { return false; }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.context && this.master) this.master.gain.setTargetAtTime(enabled ? 0.32 : 0, this.context.currentTime, 0.03);
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

  update(speed: number, throttle: number, drift: number, racing: boolean, rpm = 950 + speed * 70, grounded = true, submerged = false): void {
    if (!this.context) return;
    const now = this.context.currentTime;const tyre = tyreSound(speed, racing ? drift : 0, grounded);
    this.engine?.frequency.setTargetAtTime(40 + rpm * 0.025, now, 0.06);
    this.engineGain?.gain.setTargetAtTime(racing ? (0.045 + Math.min(0.06, speed * 0.002) + Math.abs(throttle) * 0.025) * (submerged ? 0.5 : 1) : 0, now, 0.08);
    this.tyreGain?.gain.setTargetAtTime(tyre.gain, now, 0.055);
    this.tyreFilter?.frequency.setTargetAtTime(tyre.frequency, now, 0.12);
    this.tyreTone?.frequency.setTargetAtTime(tyre.frequency * 1.12, now, 0.09);
    this.tyreToneGain?.gain.setTargetAtTime(tyre.toneGain, now, 0.07);
    this.windGain?.gain.setTargetAtTime(racing ? Math.min(0.11, (speed / 84) ** 2 * 0.11) * (submerged ? 0.3 : 1) : 0, now, 0.2);
  }
}
