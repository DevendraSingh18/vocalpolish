/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AudioProcessingOptions {
  noiseGateThreshold: number; // -100 to 0 (dB)
  clarityBoost: number; // 0 to 12 (dB)
  bassBoost: number; // 0 to 12 (dB)
  compressionRatio: number; // 1 to 20
  subCutoff: number; // 20 to 200 (Hz)
}

export const DEFAULT_OPTIONS: AudioProcessingOptions = {
  noiseGateThreshold: -42, // Effective on room noise without cutting off quiet speech
  clarityBoost: 5.5, // Crisp podcast presence
  bassBoost: 3.0, // Warm bottom end
  compressionRatio: 6, // Punchy broadcast volume leveling
  subCutoff: 85, // Standard rumble removal
};

/**
 * Encodes AudioBuffer to a WAV blob.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded for simplicity)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7fff) | 0; // scale to 16nd bit signed int
      view.setInt16(pos, sample, true); // update data
      pos += 2;
    }
    offset++; // next source sample
  }

  // create Blob
  return new Blob([bufferArr], { type: 'audio/wav' });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

/**
 * Applies a smooth noise gate directly to the AudioBuffer's float data.
 */
function applyNoiseGate(buffer: AudioBuffer, thresholdDb: number) {
  if (thresholdDb <= -95) return; // Effectively bypassed

  const threshold = Math.pow(10, thresholdDb / 20);
  const sampleRate = buffer.sampleRate;
  
  const attackTime = 0.005; // 5ms
  const releaseTime = 0.150; // 150ms
  
  const alphaAttack = Math.exp(-1.0 / (sampleRate * attackTime));
  const alphaRelease = Math.exp(-1.0 / (sampleRate * releaseTime));

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    let gain = 1.0;

    for (let i = 0; i < data.length; i++) {
      const absSample = Math.abs(data[i]);
      const isAbove = absSample > threshold;
      const targetGain = isAbove ? 1.0 : 0.0;

      if (targetGain > gain) {
         gain = alphaAttack * gain + (1.0 - alphaAttack) * targetGain;
      } else {
         gain = alphaRelease * gain + (1.0 - alphaRelease) * targetGain;
      }

      data[i] *= gain;
    }
  }
}

/**
 * Normalizes an AudioBuffer to peak at 0dB (1.0 amplitude).
 */
function normalizeBuffer(buffer: AudioBuffer) {
  let maxAmplitude = 0;
  const channels = buffer.numberOfChannels;
  
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxAmplitude) maxAmplitude = abs;
    }
  }

  if (maxAmplitude === 0) return;

  const multiplier = 1.0 / maxAmplitude; // scale to 0dB peak
  
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      data[i] *= multiplier;
    }
  }
}

/**
 * Processes audio through a "Vocal Polish" pipeline using OfflineAudioContext.
 */
export async function polishAudio(
  arrayBuffer: ArrayBuffer,
  options: AudioProcessingOptions = DEFAULT_OPTIONS
): Promise<AudioBuffer> {
  const audioCtx = new AudioContext();
  const rawBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  // Apply pre-processing before the effects graph
  applyNoiseGate(rawBuffer, options.noiseGateThreshold);
  normalizeBuffer(rawBuffer);

  const offlineCtx = new OfflineAudioContext(
    rawBuffer.numberOfChannels,
    rawBuffer.length,
    rawBuffer.sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = rawBuffer;

  // 1. High Pass Filter (Remove Low End Rumble)
  const hpFilter = offlineCtx.createBiquadFilter();
  hpFilter.type = 'highpass';
  hpFilter.frequency.value = options.subCutoff;

  // 1.5. Bass Boost (Warmth)
  const bassEQ = offlineCtx.createBiquadFilter();
  bassEQ.type = 'lowshelf';
  bassEQ.frequency.value = 120; // 120Hz warmth
  bassEQ.gain.value = options.bassBoost;

  // 2. Presence/Clarity EQ (Boost Mid-Highs)
  const clarityEQ = offlineCtx.createBiquadFilter();
  clarityEQ.type = 'peaking';
  clarityEQ.frequency.value = 3500;
  clarityEQ.Q.value = 1.0;
  clarityEQ.gain.value = options.clarityBoost;

  // 3. Air EQ (Top end sparkle)
  const airEQ = offlineCtx.createBiquadFilter();
  airEQ.type = 'highshelf';
  airEQ.frequency.value = 8000;
  airEQ.gain.value = options.clarityBoost / 2;

  // 4. Dynamics Compressor (Radio Voice Feel)
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -18; // Trigger on normalized audio optimally
  compressor.knee.value = 15;
  compressor.ratio.value = options.compressionRatio;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  // 5. Gain (Makeup)
  const makeupGain = offlineCtx.createGain();
  makeupGain.gain.value = 2.5; // Bump the compressed signal back up

  // 6. Limiter (Final output level)
  const limiter = offlineCtx.createDynamicsCompressor();
  limiter.threshold.value = -1.0;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  // Chain: Source -> HP -> Bass -> EQ -> Air -> Compressor -> Makeup -> Limiter -> Destination
  source.connect(hpFilter);
  hpFilter.connect(bassEQ);
  bassEQ.connect(clarityEQ);
  clarityEQ.connect(airEQ);
  airEQ.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(limiter);
  limiter.connect(offlineCtx.destination);

  source.start();

  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
}
