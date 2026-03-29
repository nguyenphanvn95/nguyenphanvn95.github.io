(function () {
  const BASE_URL = 'https://nguyenphanvn95.github.io/onlooker/';

  window.__ONLOOKER_HOSTED_CONFIG__ = {
    baseUrl: BASE_URL,
    getValue(key, fallback) {
      try {
        return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
      } catch (_) {
        return fallback;
      }
    },
    setValue(key, value) {
      try {
        if (typeof GM_setValue === 'function') GM_setValue(key, value);
      } catch (_) {}
    },
    deleteValue(key) {
      try {
        if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
      } catch (_) {}
    },
  };
})();
