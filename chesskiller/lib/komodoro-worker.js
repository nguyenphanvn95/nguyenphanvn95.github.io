(function () {
  'use strict';

  function resolveLib(file) {
    // Resolve relative to this worker script URL (GitHub Pages)
    return new URL(file, self.location.href).href;
  }

  self.Module = self.Module || {};
  self.Module.wasmBinaryFile = resolveLib('komodoro.wasm');
  self.Module.mainScriptUrlOrBlob = resolveLib('komodoro.js');
  self.Module.locateFile = function (path) {
    let name = String(path || '').split('/').pop();
    if (name === 'komodoro-worker.wasm' || name === 'engine.wasm') name = 'komodoro.wasm';
    return resolveLib(name);
  };

  try {
    const NativeXHR = self.XMLHttpRequest;
    if (NativeXHR) {
      self.XMLHttpRequest = function PatchedXMLHttpRequest() {
        const xhr = new NativeXHR();
        const nativeOpen = xhr.open;
        xhr.open = function patchedOpen(method, url, ...rest) {
          const nextUrl = typeof url === 'string'
            ? url.replace(/engine\.wasm(\b|$)/, 'komodoro.wasm').replace(/komodoro-worker\.wasm(\b|$)/, 'komodoro.wasm')
            : url;
          return nativeOpen.call(this, method, nextUrl, ...rest);
        };
        return xhr;
      };
      self.XMLHttpRequest.prototype = NativeXHR.prototype;
    }
  } catch (err) {
    // Ignore if XMLHttpRequest cannot be patched in this worker context.
  }

  try {
    self.fetch = undefined;
  } catch (err) {
    // Ignore if the runtime blocks overwriting fetch.
  }

  importScripts(resolveLib('komodoro.js'));
})();
