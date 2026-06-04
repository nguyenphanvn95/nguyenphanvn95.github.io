/**
 * epub-decode.js
 * Shared Waka EPUB XHTML decoder.
 *
 * Requires: lib/crypto-js.min.js
 * Exposes: WakaEpubDecode
 */
const WakaEpubDecode = (() => {
  'use strict';

  function toText(input) {
    if (typeof input === 'string') return input;
    if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
    if (ArrayBuffer.isView(input)) return new TextDecoder().decode(input);
    if (input && typeof input.text === 'function') return input.text();
    return String(input ?? '');
  }

  function toTextSync(input) {
    if (typeof input === 'string') return input;
    if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
    if (ArrayBuffer.isView(input)) return new TextDecoder().decode(input);
    return String(input ?? '');
  }

  function isWrappedJson(text) {
    const trimmed = String(text || '').trim();
    return trimmed.startsWith('{') && trimmed.includes('"cd"') && trimmed.includes('"wd"');
  }

  function decodeWrappedJson(text) {
    const raw = String(text ?? '');
    const trimmed = raw.trim();

    if (!isWrappedJson(trimmed)) return raw;
    if (typeof CryptoJS === 'undefined') {
      throw new Error('CryptoJS not loaded');
    }

    const data = JSON.parse(trimmed);
    if (!data.wd || !data.cd || !data.sw || !data.sd) {
      return raw;
    }

    const keyStr = String(data.wd) + 'a|w8' + String(data.sw) + String(data.sd);
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const ciphertext = CryptoJS.enc.Base64.parse(String(data.cd));

    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext },
      key,
      {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
      }
    );

    const plain = decrypted.toString(CryptoJS.enc.Utf8);
    if (!plain) {
      throw new Error('Decode failed: empty plaintext');
    }

    return plain;
  }

  async function decodeFileContent(input) {
    const text = await toText(input);
    return decodeWrappedJson(text);
  }

  function decodeFileSync(input) {
    const text = toTextSync(input);
    return decodeWrappedJson(text);
  }

  function looksLikeEncryptedXhtml(text) {
    try {
      return isWrappedJson(text);
    } catch {
      return false;
    }
  }

  function extractTitleFromOpf(opfText, fallbackTitle = 'waka-ebook') {
    const raw = String(opfText || '');
    const titleMatch =
      raw.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) ||
      raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

    if (!titleMatch) return fallbackTitle;

    const title = titleMatch[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();

    return title || fallbackTitle;
  }

  function safeName(s) {
    return String(s || 'waka-ebook')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 100);
  }

  function normalizeFileName(name) {
    return String(name || '').replace(/^\/+/, '');
  }

  return {
    toText,
    toTextSync,
    decodeWrappedJson,
    decodeFileContent,
    decodeFileSync,
    looksLikeEncryptedXhtml,
    extractTitleFromOpf,
    safeName,
    normalizeFileName,
  };
})();

window.WakaEpubDecode = WakaEpubDecode;
