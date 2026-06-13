/**
 * downloader.js
 * Tải toàn bộ HLS segments, giải mã AES-128-CBC, ghép thành buffer AAC.
 * Expose global object: HLSDownloader
 *
 * Phụ thuộc: hls-parser.js (HLSParser phải load trước)
 */
const HLSDownloader = (() => {
  'use strict';

  /** @type {Function|null} */
  let _onProgress = null;
  /** @type {Function|null} */
  let _onStatus = null;

  function setCallbacks(onProgress, onStatus) {
    _onProgress = onProgress;
    _onStatus = onStatus;
  }

  function reportProgress(current, total, msg) {
    if (_onProgress) _onProgress(current, total, msg);
  }

  function reportStatus(msg) {
    if (_onStatus) _onStatus(msg);
    console.log('[Waka DL]', msg);
  }

  // ─── Fetch helpers ────────────────────────────────────────────────────────

  async function fetchArrayBuffer(url) {
    // CDN vegacdn.vn là cross-site → KHÔNG dùng credentials (gây CORS block).
    // URL chứa token thời gian → KHÔNG cache (token hết hạn = lỗi).
    const resp = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} khi tải: ${url}`);
    return resp.arrayBuffer();
  }

  async function fetchText(url) {
    // Playlist m3u8 cũng từ CDN cross-site → omit credentials
    const resp = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} khi tải playlist`);
    return resp.text();
  }

  // ─── AES-128-CBC decryption ───────────────────────────────────────────────

  /** Cache key để không fetch lại nhiều lần */
  const _keyCache = {};

  async function fetchKey(keyUrl) {
    if (!_keyCache[keyUrl]) {
      const buf = await fetchArrayBuffer(keyUrl);
      _keyCache[keyUrl] = buf; // 16 bytes
    }
    return _keyCache[keyUrl];
  }

  /**
   * Chuyển số thứ tự segment thành IV 16 bytes (big-endian)
   * Theo HLS spec: IV mặc định = media sequence number
   */
  function sequenceToIV(seq) {
    const iv = new Uint8Array(16);
    let n = seq;
    for (let i = 15; i >= 0; i--) {
      iv[i] = n & 0xff;
      n = Math.floor(n / 256);
    }
    return iv;
  }

  /**
   * Chuyển hex string IV (32 ký tự) thành Uint8Array 16 bytes
   */
  function hexToIV(hexStr) {
    const padded = hexStr.padStart(32, '0');
    const iv = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      iv[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
    }
    return iv;
  }

  /**
   * Giải mã AES-128-CBC
   * @param {ArrayBuffer} encrypted
   * @param {ArrayBuffer} keyBuffer  - 16 bytes
   * @param {Uint8Array}  iv         - 16 bytes
   * @returns {Promise<ArrayBuffer>}
   */
  async function decryptAES128(encrypted, keyBuffer, iv) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );

    return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, encrypted);
  }

  // ─── Main download pipeline ───────────────────────────────────────────────

  /**
   * Tải toàn bộ stream HLS từ playlistUrl, giải mã và ghép lại.
   * @param {string} playlistUrl - URL của playlist.m3u8
   * @returns {Promise<Uint8Array>} - Raw AAC (ADTS) audio data
   */
  async function downloadAll(playlistUrl) {
    // 1. Master playlist → lấy chunklist URL
    reportStatus('Đang tải master playlist...');
    const masterText = await fetchText(playlistUrl);
    const chunklistUrl = HLSParser.parseMasterPlaylist(masterText, playlistUrl);

    if (!chunklistUrl) {
      throw new Error('Không tìm thấy chunklist trong master playlist.');
    }

    // 2. Chunklist → danh sách segments
    reportStatus('Đang phân tích chunklist...');
    const chunklistText = await fetchText(chunklistUrl);
    const segments = HLSParser.parseChunklist(chunklistText, chunklistUrl);

    if (segments.length === 0) {
      throw new Error('Chunklist không có segment nào.');
    }

    reportStatus(`Tìm thấy ${segments.length} segments. Bắt đầu tải...`);

    // 3. Tải và giải mã từng segment
    const decryptedBuffers = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      reportProgress(i, segments.length, `Tải segment ${i + 1} / ${segments.length}...`);

      const encData = await fetchArrayBuffer(seg.url);

      if (seg.keyInfo && seg.keyInfo.method === 'AES-128' && seg.keyInfo.uri) {
        // Giải mã AES-128-CBC
        const keyBuffer = await fetchKey(seg.keyInfo.uri);
        const iv = seg.keyInfo.iv ? hexToIV(seg.keyInfo.iv) : sequenceToIV(seg.sequence);
        const decrypted = await decryptAES128(encData, keyBuffer, iv);
        decryptedBuffers.push(new Uint8Array(decrypted));
      } else {
        // Không mã hoá
        decryptedBuffers.push(new Uint8Array(encData));
      }
    }

    // 4. Ghép tất cả buffer lại
    reportProgress(segments.length, segments.length, 'Đang ghép các đoạn audio...');

    const totalBytes = decryptedBuffers.reduce((sum, b) => sum + b.length, 0);
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const buf of decryptedBuffers) {
      merged.set(buf, offset);
      offset += buf.length;
    }

    return merged; // Raw ADTS AAC
  }

  return { downloadAll, setCallbacks };
})();
