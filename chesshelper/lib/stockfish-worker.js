(function () {
  'use strict';

  function resolveLib(file) {
    var name = String(file || '').split('/').pop() || file;
    return 'https://nguyenphanvn95.github.io/chesshelper/lib/' + name;
  }
    } catch (err) {
      // Fall through to relative URL.
    }
    return new URL(file, self.location.href).href;
  }

  self.Module = self.Module || {};
  self.Module.locateFile = function (path) {
    let name = String(path || '').split('/').pop();
    if (name === 'stockfish-worker.wasm') name = 'stockfish.wasm';
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
            ? url.replace(/stockfish-worker\.wasm(\b|$)/, 'stockfish.wasm')
            : url;
          return nativeOpen.call(this, method, nextUrl, ...rest);
        };
        return xhr;
      };
      self.XMLHttpRequest.prototype = NativeXHR.prototype;
    }
  } catch (err) {
    // Ignore if XMLHttpRequest cannot be patched here.
  }

  try {
    self.fetch = undefined;
  } catch (err) {
    // Ignore if fetch is read-only.
  }

  importScripts(resolveLib('stockfish.js'));
})();
