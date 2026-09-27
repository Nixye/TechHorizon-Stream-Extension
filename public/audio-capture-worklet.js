class ScreenAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.packet = new Int16Array(640);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (const sample of input) {
        this.sum += sample;
        this.count++;
        this.phase++;
        if (this.phase < this.ratio) continue;
        const normalized = Math.max(-1, Math.min(1, this.sum / this.count));
        this.packet[this.offset++] = Math.round(normalized * (normalized < 0 ? 32768 : 32767));
        this.phase -= this.ratio;
        this.sum = 0;
        this.count = 0;
        if (this.offset === this.packet.length) {
          this.port.postMessage(this.packet.buffer, [this.packet.buffer]);
          this.packet = new Int16Array(640);
          this.offset = 0;
        }
      }
    }
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}

registerProcessor('screen-audio-capture', ScreenAudioCapture);
