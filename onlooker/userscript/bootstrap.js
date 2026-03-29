(function () {
  const BASE_URL = 'https://nguyenphanvn95.github.io/onlooker/';

  window.__ONLOOKER_HOSTED_CONFIG__ = {
    baseUrl: BASE_URL,
    resourceMap: {
      'icons/icon-app.png': 'ONLOOKER_ICON_APP',
      'icons/ui/play.svg': 'ONLOOKER_UI_PLAY',
      'icons/ui/camera.svg': 'ONLOOKER_UI_CAMERA',
      'icons/ui/search.svg': 'ONLOOKER_UI_SEARCH',
      'icons/pieces/wK.svg': 'ONLOOKER_PIECE_WK',
      'icons/pieces/wQ.svg': 'ONLOOKER_PIECE_WQ',
      'icons/pieces/wR.svg': 'ONLOOKER_PIECE_WR',
      'icons/pieces/wB.svg': 'ONLOOKER_PIECE_WB',
      'icons/pieces/wN.svg': 'ONLOOKER_PIECE_WN',
      'icons/pieces/wP.svg': 'ONLOOKER_PIECE_WP',
      'icons/pieces/bK.svg': 'ONLOOKER_PIECE_BK',
      'icons/pieces/bQ.svg': 'ONLOOKER_PIECE_BQ',
      'icons/pieces/bR.svg': 'ONLOOKER_PIECE_BR',
      'icons/pieces/bB.svg': 'ONLOOKER_PIECE_BB',
      'icons/pieces/bN.svg': 'ONLOOKER_PIECE_BN',
      'icons/pieces/bP.svg': 'ONLOOKER_PIECE_BP',
    },
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
    getResourceUrl(name) {
      try {
        return typeof GM_getResourceURL === 'function' ? GM_getResourceURL(name) : '';
      } catch (_) {
        return '';
      }
    },
  };
})();
