/** Quiet procedural engine and tyre noise; initialized by the Start gesture. */
export class RaceAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: OscillatorNode;
  private engineGain?: GainNode;
  private tyreGain?: GainNode;
  private enabled = true;

  async start(): Promise<boolean> {
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        this.master = context.createGain();
        this.master.gain.value = this.enabled ? 0.32 : 0;
        this.master.connect(context.destination);
        const engine = context.createOscillator();
        engine.type = "sawtooth";
        engine.frequency.value = 45;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 450;
        this.engineGain = context.createGain();
        this.engineGain.gain.value = 0;
        engine.connect(filter).connect(this.engineGain).connect(this.master);
        engine.start();
        this.engine = engine;
        const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const samples = noise.getChannelData(0);
        for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
        const tyre = context.createBufferSource();
        tyre.buffer = noise;
        tyre.loop = true;
        const tyreFilter = context.createBiquadFilter();
        tyreFilter.type = "bandpass";
        tyreFilter.frequency.value = 1800;
        this.tyreGain = context.createGain();
        this.tyreGain.gain.value = 0;
        tyre.connect(tyreFilter).connect(this.tyreGain).connect(this.master);
        tyre.start();
      }
      await this.context.resume();
      return true;
    } catch {
      return false;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.context && this.master) this.master.gain.setTargetAtTime(enabled ? 0.32 : 0, this.context.currentTime, 0.03);
    if (enabled && this.context?.state === "suspended") void this.context.resume().catch(() => {});
  }

  update(speed: number, throttle: number, drift: number, racing: boolean): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.engine?.frequency.setTargetAtTime(42 + speed * 3.2 + Math.max(0, throttle) * 22, now, 0.08);
    this.engineGain?.gain.setTargetAtTime(racing ? 0.06 + Math.min(0.08, speed * 0.003) : 0, now, 0.08);
    this.tyreGain?.gain.setTargetAtTime(racing && speed > 5 ? drift * 0.11 : 0, now, 0.08);
  }
}
