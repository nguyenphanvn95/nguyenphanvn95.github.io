/**
 * mp3-encoder.js
 * Chuyển raw AAC (ADTS) ArrayBuffer → MP3 Blob bằng Web Audio API + lamejs.
 * Expose global: MP3Encoder
 *
 * Phụ thuộc: lib/lame.min.js (lamejs phải load trước)
 */
const MP3Encoder = (() => {
  'use strict';

  /** @type {Function|null} */
  let _onStatus = null;
  let _onProgress = null;

  function setCallbacks(onStatus, onProgress) {
    _onStatus = onStatus;
    _onProgress = onProgress;
  }

  function status(msg) {
    if (_onStatus) _onStatus(msg);
    console.log('[MP3Encoder]', msg);
  }

  function progress(pct, msg) {
    if (_onProgress) _onProgress(pct, msg);
  }

  /**
   * Chuyển Float32Array PCM → Int16Array (format lamejs cần)
   */
  function float32ToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    return int16;
  }

  /**
   * Ghép nhiều Int8Array / Uint8Array thành 1 Uint8Array
   */
  function concatUint8Arrays(arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const arr of arrays) {
      out.set(arr, off);
      off += arr.length;
    }
    return out;
  }

  /**
   * Decode raw AAC buffer qua Web Audio API → AudioBuffer (PCM Float32)
   * @param {Uint8Array} aacData
   * @param {AudioContext} audioCtx
   * @returns {Promise<AudioBuffer>}
   */
  async function decodeAAC(aacData, audioCtx) {
    // decodeAudioData cần ArrayBuffer
    const buffer = aacData.buffer.slice(aacData.byteOffset, aacData.byteOffset + aacData.byteLength);
    return new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(buffer, resolve, reject);
    });
  }

  /**
   * Encode AudioBuffer → MP3 Blob bằng lamejs
   * @param {AudioBuffer} audioBuffer
   * @param {number} bitrate - kbps (128)
   * @returns {Uint8Array}
   */
  function encodePCMtoMP3(audioBuffer, bitrate) {
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const mp3Bitrate = bitrate || 128;

    const leftPCM = audioBuffer.getChannelData(0);
    const rightPCM = channels > 1 ? audioBuffer.getChannelData(1) : leftPCM;

    const lame = new lamejs();
    const encoder = new lame.Mp3Encoder(channels > 1 ? 2 : 1, sampleRate, mp3Bitrate);

    const BLOCK = 1152; // lamejs block size (phải là bội số của 576)
    const mp3Chunks = [];
    const total = Math.ceil(leftPCM.length / BLOCK);

    for (let i = 0; i < leftPCM.length; i += BLOCK) {
      const leftChunk = leftPCM.subarray(i, i + BLOCK);
      const rightChunk = rightPCM.subarray(i, i + BLOCK);

      const left16 = float32ToInt16(leftChunk);
      const right16 = float32ToInt16(rightChunk);

      let encoded;
      if (channels > 1) {
        encoded = encoder.encodeBuffer(left16, right16);
      } else {
        encoded = encoder.encodeBuffer(left16);
      }

      if (encoded.length > 0) {
        mp3Chunks.push(new Uint8Array(encoded));
      }

      // Report progress mỗi 50 block
      if (i % (BLOCK * 50) === 0) {
        const blockIdx = Math.floor(i / BLOCK);
        progress(Math.round((blockIdx / total) * 100), `Encoding MP3: ${Math.round((blockIdx / total) * 100)}%`);
      }
    }

    // Flush encoder
    const flushed = encoder.flush();
    if (flushed.length > 0) {
      mp3Chunks.push(new Uint8Array(flushed));
    }

    return concatUint8Arrays(mp3Chunks);
  }

  /**
   * Pipeline chính: AAC buffer → MP3 Blob
   * @param {Uint8Array} aacData      - dữ liệu AAC thô (ADTS)
   * @param {AudioContext} audioCtx   - AudioContext đã được tạo trong user gesture
   * @returns {Promise<{blob: Blob, ext: string}>}
   */
  async function encode(aacData, audioCtx) {
    try {
      status('Đang giải mã audio (AAC → PCM)...');
      const audioBuffer = await decodeAAC(aacData, audioCtx);
      status(`Giải mã OK – ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz. Đang encode MP3...`);

      const mp3Data = encodePCMtoMP3(audioBuffer, 128);
      status(`Encode hoàn tất – ${(mp3Data.length / 1024 / 1024).toFixed(1)} MB`);

      return {
        blob: new Blob([mp3Data], { type: 'audio/mpeg' }),
        ext: 'mp3',
      };
    } catch (err) {
      // Fallback: lưu thẳng AAC nếu decode thất bại
      console.warn('[MP3Encoder] Không decode được AAC, lưu .aac thay thế:', err);
      status('⚠ Không thể encode MP3, lưu dạng .aac...');
      return {
        blob: new Blob([aacData], { type: 'audio/aac' }),
        ext: 'aac',
      };
    }
  }

  return { encode, setCallbacks };
})();
