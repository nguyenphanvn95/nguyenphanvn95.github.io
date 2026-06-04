/**
 * hls-parser.js
 * Parse HLS playlists (master + chunklist).
 * Expose global object: HLSParser
 */
const HLSParser = (() => {
  'use strict';

  /**
   * Resolve URL tương đối so với URL gốc
   */
  function resolveUrl(relativeUrl, baseUrl) {
    if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
    try {
      return new URL(relativeUrl, baseUrl).href;
    } catch {
      const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
      return base + relativeUrl;
    }
  }

  /**
   * Parse master playlist → trả về URL chunklist tốt nhất (128kbps ưu tiên).
   * @param {string} text   - nội dung file playlist.m3u8
   * @param {string} baseUrl
   * @returns {string|null} URL của chunklist
   */
  function parseMasterPlaylist(text, baseUrl) {
    const lines = text.split('\n').map((l) => l.trim());
    const variants = [];
    let pendingBandwidth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
        pendingBandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
        continue;
      }

      if (!line.startsWith('#') && line.length > 0 && pendingBandwidth > 0) {
        variants.push({ url: resolveUrl(line, baseUrl), bandwidth: pendingBandwidth });
        pendingBandwidth = 0;
      }
    }

    if (variants.length === 0) {
      // Playlist đơn giản (không có STREAM-INF), tìm dòng m3u8 đầu tiên
      for (const line of lines) {
        if (!line.startsWith('#') && line.includes('.m3u8')) {
          return resolveUrl(line, baseUrl);
        }
      }
      return null;
    }

    // Chọn variant đầu tiên (thường là 128kbps duy nhất với Waka)
    return variants[0].url;
  }

  /**
   * @typedef {Object} KeyInfo
   * @property {'AES-128'|'NONE'} method
   * @property {string|null}      uri
   * @property {string|null}      iv  - hex string, không có prefix 0x
   */

  /**
   * @typedef {Object} Segment
   * @property {string}       url
   * @property {KeyInfo|null} keyInfo
   * @property {number}       sequence - số thứ tự segment (dùng làm IV mặc định)
   */

  /**
   * Parse chunklist → mảng Segment
   * @param {string} text
   * @param {string} baseUrl
   * @returns {Segment[]}
   */
  function parseChunklist(text, baseUrl) {
    const lines = text.split('\n').map((l) => l.trim());
    /** @type {Segment[]} */
    const segments = [];
    /** @type {KeyInfo|null} */
    let currentKey = null;
    let sequence = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Sequence number khởi đầu
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        sequence = parseInt(line.split(':')[1]) || 0;
        continue;
      }

      // KEY line → AES-128 encryption info
      if (line.startsWith('#EXT-X-KEY:')) {
        const methodMatch = line.match(/METHOD=([^,\s]+)/i);
        const uriMatch = line.match(/URI="([^"]+)"/i);
        const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/i);

        const method = methodMatch ? methodMatch[1].toUpperCase() : 'NONE';

        if (method === 'NONE') {
          currentKey = null;
        } else {
          currentKey = {
            method,
            uri: uriMatch ? resolveUrl(uriMatch[1], baseUrl) : null,
            iv: ivMatch ? ivMatch[1].padStart(32, '0') : null,
          };
        }
        continue;
      }

      // Dòng URL segment (không bắt đầu bằng #, không rỗng)
      if (!line.startsWith('#') && line.length > 0) {
        segments.push({
          url: resolveUrl(line, baseUrl),
          keyInfo: currentKey ? { ...currentKey } : null,
          sequence,
        });
        sequence++;
      }
    }

    return segments;
  }

  return { parseMasterPlaylist, parseChunklist, resolveUrl };
})();
