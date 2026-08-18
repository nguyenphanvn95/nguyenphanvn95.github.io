/**
 * MAIN world – generate secure_code đúng thuật toán Waka
 * verified: Base64(HmacSHA1("account item_id content_type id os", key))
 * key = cookie fm.auth.tid  ||  md5(account)
 */
(function () {
  'use strict';
  if (window.__wakaEbookInterceptorV45) return;
  window.__wakaEbookInterceptorV45 = true;

  const API_BASE = 'beta-api.waka.vn';
  const DOWNLOAD_FIELDS = ['account', 'item_id', 'content_type', 'id', 'os'];

  let state = {
    item_id: null,
    account: 'guest',
    deviceId: null,
    tid: null,
    download_url: null
  };
  let _inFlight = false;

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ===== MD5 =====
  function md5(str) {
    function cmn(q,a,b,x,s,t){a=a+(q+x+t)|0;return(((a<<s)|(a>>>32-s))+b)|0}
    function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t)}
    function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t)}
    function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)}
    function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t)}
    function md5cycle(x,k){
      var a=x[0],b=x[1],c=x[2],d=x[3];
      a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);
      c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
      a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);
      c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
      a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);
      c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
      a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);
      c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
      a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);
      c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
      a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);
      c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
      a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);
      c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
      a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);
      c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
      a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);
      c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
      a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);
      c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
      a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);
      c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
      a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);
      c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
      a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);
      c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
      a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);
      c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
      a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);
      c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
      a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);
      c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
      x[0]=(a+x[0])|0;x[1]=(b+x[1])|0;x[2]=(c+x[2])|0;x[3]=(d+x[3])|0;
    }
    function md5blk(s){var i,md5blks=[];for(i=0;i<64;i+=4)md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);return md5blks}
    function md51(s){
      var n=s.length,state=[1732584193,-271733879,-1732584194,271733878],i;
      for(i=64;i<=n;i+=64) md5cycle(state, md5blk(s.substring(i-64,i)));
      s=s.substring(i-64); var tail=Array(16).fill(0);
      for(i=0;i<s.length;i++) tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);
      tail[i>>2]|=0x80<<((i%4)<<3);
      if(i>55){md5cycle(state,tail);tail=Array(16).fill(0)}
      tail[14]=n*8; md5cycle(state,tail); return state;
    }
    function rhex(n){var s='',j;for(j=0;j<4;j++)s+=('0'+((n>>(j*8))&255).toString(16)).slice(-2);return s}
    function hex(x){for(var i=0;i<x.length;i++)x[i]=rhex(x[i]);return x.join('')}
    return hex(md51(str));
  }

  async function hmacSha1Base64(message, key) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
    const bytes = new Uint8Array(sig);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }

  function encodeParam(t) {
    return encodeURIComponent(String(t))
      .replace(/!/g, '%21').replace(/'/g, '%27')
      .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
  }

  async function makeSecureCode(params, key) {
    const parts = DOWNLOAD_FIELDS.map(f => encodeParam(params[f] ?? ''));
    return hmacSha1Base64(parts.join(' '), key);
  }

  function getCookie(name) {
    try {
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name.replace(/\./g, '\\.') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch { return null; }
  }

  function getTid() {
    // nuxt-auth cookie names
    const candidates = [
      'fm.auth.tid',
      'tidToken',
      'tid',
      'fm.auth.tidToken'
    ];
    for (const c of candidates) {
      const v = getCookie(c);
      if (v && v.length > 8) return v;
    }
    // localStorage / sessionStorage
    try {
      for (const store of [localStorage, sessionStorage]) {
        for (const k of ['fm.auth.tid', 'tidToken', 'tid', 'auth.tid']) {
          const v = store.getItem(k);
          if (v && v.length > 8) return v.replace(/^"|"$/g, '');
        }
        // scan all keys
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && /tid/i.test(k)) {
            const v = store.getItem(k);
            if (v && v.length > 8 && v.length < 200) return v.replace(/^"|"$/g, '');
          }
        }
      }
    } catch {}
    // Vuex / window state
    try {
      if (window.__NUXT__?.state?.auth?.user?.tid) return window.__NUXT__.state.auth.user.tid;
      if (window.$nuxt?.$store?.state?.auth?.user?.tid) return window.$nuxt.$store.state.auth.user.tid;
    } catch {}
    return null;
  }

  function getAccountFromState() {
    try {
      const u = window.__NUXT__?.state?.auth?.user || window.$nuxt?.$store?.state?.auth?.user;
      if (u?.userId) return String(u.userId);
      if (u?.id) return String(u.id);
    } catch {}
    const c = getCookie('fm.auth.user') || getCookie('account');
    if (c) {
      try {
        const j = JSON.parse(c);
        if (j.userId) return String(j.userId);
      } catch {}
    }
    return null;
  }

  function parseQuery(url) {
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://x/' + url);
      const o = {};
      u.searchParams.forEach((v, k) => { o[k] = v; });
      return o;
    } catch { return {}; }
  }

  function extractDownloadUrl(text) {
    try {
      const json = JSON.parse(text);
      if (json && json.code && json.code !== 0 && json.code !== 200) {
        return { error: json.message || ('code ' + json.code), code: json.code };
      }
      const cands = [
        json?.data?.download_url, json?.data?.url, json?.data?.epub_url,
        json?.data?.file_url, json?.data?.link,
        json?.download_url, json?.url, json?.epub_url, json?.file_url, json?.link
      ];
      for (const c of cands) {
        if (typeof c === 'string' && c.startsWith('http')) return { url: c };
      }
      if (json?.message) return { error: json.message, code: json.code };
    } catch {}
    const m = text.match(/"(https?:\/\/[^"]*(?:epub|book|download|vegacdn)[^"]*)"/i);
    if (m) return { url: m[1] };
    return null;
  }

  function handleUrl(url) {
    if (!url || !url.includes(API_BASE)) return;
    const p = parseQuery(url);
    if (p.id && p.id.length > 16) state.deviceId = p.id;
    if (p.account) state.account = p.account;

    const isShop = /\/shop\//i.test(location.pathname);

    // /ebook/* (và trang khác): giữ cơ chế v5.0 — nhận item_id / content_id từ network
    // /shop/*: lọc theo book_id trang để tránh dính id sách gợi ý
    if (p.item_id) {
      if (isShop) {
        const shopIds = getShopCandidateIds();
        const pageId = extractItemIdFromPage();
        if (shopIds.length && shopIds.includes(String(p.item_id))) {
          state.item_id = p.item_id;
        } else if (pageId && String(p.item_id) === String(pageId)) {
          state.item_id = p.item_id;
        } else if (!pageId && !shopIds.length) {
          state.item_id = p.item_id;
        }
      } else {
        state.item_id = p.item_id;
      }
    }
    if (p.content_id && !state.item_id) {
      if (isShop) {
        const pageId = extractItemIdFromPage();
        if (!pageId || String(p.content_id) === String(pageId)) {
          state.item_id = p.content_id;
        }
      } else {
        state.item_id = p.content_id;
      }
    }

    const tid = getTid();
    if (tid) state.tid = tid;
    const acc = getAccountFromState();
    if (acc) state.account = acc;
    emit('__waka_params__', { ...state });
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      handleUrl(url);
      if (url.includes('getDownloadItemWeb')) {
        const clone = resp.clone();
        clone.text().then(text => {
          const r = extractDownloadUrl(text);
          if (r?.url) {
            state.download_url = r.url;
            emit('__waka_ebook_ready__', { url: r.url });
          }
        }).catch(() => {});
      }
    } catch {}
    return resp;
  };

  const NX = window.XMLHttpRequest;
  function PX() {
    const xhr = new NX();
    let _url = '';
    const oo = xhr.open;
    xhr.open = function (m, u, ...r) { _url = u || ''; return oo.apply(this, [m, u, ...r]); };
    xhr.addEventListener('load', function () {
      try {
        handleUrl(_url);
        if (_url.includes('getDownloadItemWeb') && xhr.responseText) {
          const r = extractDownloadUrl(xhr.responseText);
          if (r?.url) {
            state.download_url = r.url;
            emit('__waka_ebook_ready__', { url: r.url });
          }
        }
      } catch {}
    });
    return xhr;
  }
  PX.prototype = NX.prototype;
  window.XMLHttpRequest = PX;

  window.addEventListener('__waka_request_params__', () => {
    state.tid = getTid() || state.tid;
    const acc = getAccountFromState();
    if (acc) state.account = acc;
    emit('__waka_params__', { ...state });
  });

  function getOrCreateDeviceId() {
    try {
      const k = 'waka_toolkit_device_id';
      let id = localStorage.getItem(k);
      if (id && id.length >= 20) return id;
      // 32-char hex, tương tự id thiết bị Waka web
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(k, id);
      return id;
    } catch {
      return 'web' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
    }
  }

  function iterNuxtDataEntries() {
    const out = [];
    try {
      const nuxt = window.__NUXT__;
      if (!nuxt) return out;
      const data = nuxt.data;
      // Nuxt 2: data có thể là Array hoặc object {"0":..., "1":...}
      if (Array.isArray(data)) {
        for (const d of data) out.push(d);
      } else if (data && typeof data === 'object') {
        for (const k of Object.keys(data)) out.push(data[k]);
      }
    } catch {}
    return out;
  }

  function getProductDetailFromNuxt() {
    try {
      for (const d of iterNuxtDataEntries()) {
        if (!d || typeof d !== 'object') continue;
        const pd = d.productDetail || d.props?.productDetail || d.data?.productDetail;
        if (pd && (pd.title || pd.id || pd.ebook || pd.book_id)) return pd;
      }
      // shallow walk state (không đi sâu vào reader.*)
      const nuxt = window.__NUXT__;
      const st = nuxt && nuxt.state;
      if (st && typeof st === 'object') {
        for (const k of Object.keys(st)) {
          if (/reader/i.test(k)) continue;
          const v = st[k];
          if (v && typeof v === 'object') {
            const pd = v.productDetail || v.props?.productDetail;
            if (pd && (pd.title || pd.id || pd.ebook || pd.book_id)) return pd;
          }
        }
      }
    } catch {}
    return null;
  }

  /** Lấy item_id đúng của trang hiện tại.
   * ƯU TIÊN book_id (id thư viện Waka, vd 48136) — dùng cho getDownloadItemWeb.
   * Tránh nhầm ebook[0].id / product_id trên một số trang.
   */
  function extractItemIdFromPage() {
    const isShop = /\/shop\//i.test(location.pathname);

    try {
      const pd = getProductDetailFromNuxt();
      if (pd) {
        // book_id là id đúng nhất trên cả /ebook/* và /shop/*
        if (pd.book_id && Number(pd.book_id) > 100) return String(pd.book_id);
        if (!isShop) {
          if (Array.isArray(pd.ebook) && pd.ebook[0]?.id && Number(pd.ebook[0].id) > 100) {
            return String(pd.ebook[0].id);
          }
          if (pd.ebook_price?.id && Number(pd.ebook_price.id) > 100) {
            return String(pd.ebook_price.id);
          }
        }
        if (pd.id && Number(pd.id) > 100) return String(pd.id);
      }
    } catch {}

    // Trang /ebook/*: ebookInfo / bookInfo trong nuxt.data (array hoặc object keys)
    if (!isShop) {
      try {
        for (const d of iterNuxtDataEntries()) {
          if (!d || typeof d !== 'object') continue;
          const info =
            d.ebookInfo ||
            d.bookInfo ||
            d.props?.ebookInfo ||
            d.data?.ebookInfo ||
            d.productDetail;
          if (info?.book_id && Number(info.book_id) > 100) return String(info.book_id);
          if (info?.id && Number(info.id) > 100) return String(info.id);
          if (Array.isArray(info?.ebook) && info.ebook[0]?.id && Number(info.ebook[0].id) > 100) {
            return String(info.ebook[0].id);
          }
        }
      } catch {}
    }

    // Regex HTML / payload nhúng
    try {
      const html = document.documentElement.innerHTML;
      // book_id:48136 — pattern phổ biến trong productDetail (cả shop + ebook)
      const mBook = html.match(/book_id:(\d{4,})(?:,audio_id:|[,}])/);
      if (mBook && Number(mBook[1]) > 100) return mBook[1];
      const mBook2 = html.match(/["']book_id["']\s*:\s*(\d{4,})/);
      if (mBook2 && Number(mBook2[1]) > 100) return mBook2[1];
      const mBook3 = html.match(/is_store_waka[^,]*,book_id:(\d{3,})/);
      if (mBook3 && Number(mBook3[1]) > 100) return mBook3[1];
      if (!isShop) {
        const mMeta = html.match(/ebook:\[\s*\{\s*id:(\d{4,})\s*,\s*product_id:/);
        if (mMeta) return mMeta[1];
        const m2 = html.match(/"item_id"\s*:\s*(\d{4,})/);
        if (m2) return m2[1];
        const m3 = html.match(/ebookInfo[^{]{0,40}\{[^}]{0,200}?["']?(?:content_id|id)["']?\s*[:=]\s*(\d{4,})/);
        if (m3) return m3[1];
      }
    } catch {}

    try {
      const m = location.pathname.match(/-b(\d+)\.html$/);
      if (m) return m[1];
    } catch {}

    return null;
  }

  /** Danh sách id hợp lệ trang shop.
   * CHỈ dùng book_id (id thư viện Waka). Không dùng ebook[0].id (dễ trỏ nhầm sách).
   * KHÔNG dùng shop.waka_id (ID nhà bán).
   */
  function getShopCandidateIds() {
    const ids = [];
    const push = (v) => {
      if (v == null || v === 0 || v === '0') return;
      const n = Number(v);
      if (!(n > 100)) return;
      const s = String(v);
      if (!ids.includes(s)) ids.push(s);
    };
    try {
      const pd = getProductDetailFromNuxt();
      if (pd) {
        push(pd.book_id); // ƯU TIÊN — id đúng để tải (vd 48136)
        // Không push ebook[0].id / ebook_price.id — user confirm dễ nhầm sách
        // Không push pd.shop?.waka_id — seller
      }
    } catch {}
    try {
      const html = document.documentElement.innerHTML;
      const mBook = html.match(/book_id:(\d{4,}),audio_id:/);
      if (mBook) push(mBook[1]);
      const mBook2 = html.match(/is_store_waka[^,]*,book_id:(\d{3,})/);
      if (mBook2) push(mBook2[1]);
    } catch {}
    return ids;
  }

  async function tryDownload(account, item_id, deviceId, key, label, contentType) {
    const ct = contentType || 'book';
    const params = { account, item_id, content_type: ct, id: deviceId, os: 'web' };
    const secure_code = await makeSecureCode(params, key);
    const qs = new URLSearchParams({
      os: 'web', id: deviceId, account, item_id,
      content_type: ct, rf: location.href, secure_code
    });
    const url = `https://${API_BASE}/super/getDownloadItemWeb?${qs}`;
    console.log('[Waka Đọc Thử] try', label, 'ct=', ct, 'account=', account, 'item_id=', item_id);
    const resp = await origFetch(url, { credentials: 'omit' });
    const text = await resp.text();
    console.log('[Waka Đọc Thử] response', label, resp.status, text.slice(0, 200));
    return extractDownloadUrl(text);
  }

  window.addEventListener('__waka_force_download__', async (e) => {
    if (_inFlight) {
      emit('__waka_ebook_status__', { msg: 'Đang xử lý...' });
      return;
    }
    const detail = e.detail || {};
    let deviceId = detail.id || state.deviceId;
    const tid = getTid() || state.tid;
    let account = getAccountFromState() || detail.account || state.account || 'guest';
    const isShop = /\/shop\//i.test(location.pathname);

    // Thu thập item_id ứng viên
    // - /ebook/*: khôi phục cơ chế v5.0 (state từ network + performance + extract trang)
    // - /shop/*: chỉ dùng book_id trang hiện tại (tránh dính sách gợi ý)
    const pushId = (list, v) => {
      if (v == null || v === 0 || v === '0') return;
      const n = Number(v);
      if (!(n > 100)) return;
      const s = String(v);
      if (!list.includes(s)) list.push(s);
    };

    let pageIds = [];
    let itemIds = [];

    try {
      if (isShop) {
        pageIds = getShopCandidateIds();
        pageIds.forEach((id) => pushId(itemIds, id));
        // fallback extract
        pushId(itemIds, extractItemIdFromPage());
      } else {
        // === /ebook/* — logic gần v5.0 ===
        // 1) state.item_id từ interceptor network (quan trọng nhất)
        pushId(itemIds, detail.item_id);
        pushId(itemIds, state.item_id);

        // 2) item_id / content_id trên performance resource (như v5.0)
        try {
          performance.getEntriesByType('resource').forEach((en) => {
            const name = en.name || '';
            const mm = name.match(/[?&](?:item_id|content_id)=(\d{3,})/);
            if (mm) pushId(itemIds, mm[1]);
            const dd = name.match(/[?&]id=([a-f0-9]{20,})/);
            if (dd) deviceId = dd[1];
          });
        } catch {}

        // 3) extract từ Nuxt / HTML (book_id ưu tiên)
        try {
          const pd = getProductDetailFromNuxt();
          if (pd) {
            pushId(itemIds, pd.book_id);
            if (Array.isArray(pd.ebook) && pd.ebook[0]?.id) pushId(itemIds, pd.ebook[0].id);
            if (pd.ebook_price?.id) pushId(itemIds, pd.ebook_price.id);
            pushId(itemIds, pd.id);
          }
        } catch {}
        pushId(itemIds, extractItemIdFromPage());
        pageIds = itemIds.slice();
      }
    } catch {}

    // deviceId từ network nếu có (shop path cũng cần)
    if (isShop) {
      try {
        performance.getEntriesByType('resource').forEach((en) => {
          const dd = (en.name || '').match(/[?&]id=([a-f0-9]{20,})/);
          if (dd) deviceId = dd[1];
        });
      } catch {}
    }

    if (!deviceId) {
      deviceId = getOrCreateDeviceId();
      state.deviceId = deviceId;
    }

    if (!itemIds.length) {
      emit('__waka_ebook_status__', {
        msg: 'Thiếu item_id. Refresh trang, đợi load xong rồi thử lại.',
        isError: true
      });
      return;
    }

    console.log('[Waka Đọc Thử] force download itemIds=', itemIds, 'page=', location.pathname);

    _inFlight = true;
    emit('__waka_ebook_status__', { msg: 'Đang lấy link EPUB...' });

    try {
      const attempts = [];
      if (tid && account && account !== 'guest') {
        attempts.push({ account, key: tid, label: 'login+tid' });
      }
      if (account && account !== 'guest') {
        attempts.push({ account, key: md5(account), label: 'login+md5(account)' });
      }
      attempts.push({ account: 'guest', key: md5('guest'), label: 'guest' });

      const contentTypes = isShop ? ['book', 'book_retail'] : ['book'];

      let lastError = null;
      for (const a of attempts) {
        for (const iid of itemIds) {
          for (const ct of contentTypes) {
            const result = await tryDownload(a.account, iid, deviceId, a.key, a.label, ct);
            if (result?.url) {
              // Chỉ lọc URL lệch id trên /shop/ (tránh nhầm sách gợi ý)
              if (isShop) {
                const urlId = String(result.url).match(/\/(\d{4,})_\d+\//);
                if (urlId && pageIds.length && !pageIds.includes(urlId[1]) && urlId[1] !== iid) {
                  console.warn('[Waka Đọc Thử] bỏ URL lệch id', urlId[1], 'expected', pageIds);
                  lastError = 'URL không khớp sách hiện tại';
                  continue;
                }
              }
              state.download_url = result.url;
              state.item_id = iid;
              emit('__waka_ebook_ready__', { url: result.url });
              return;
            }
            lastError = result?.error || 'unknown';
          }
        }
      }

      emit('__waka_ebook_status__', {
        msg: lastError || 'Không lấy được link EPUB',
        isError: true
      });
    } catch (err) {
      emit('__waka_ebook_status__', { msg: 'Lỗi: ' + err.message, isError: true });
    } finally {
      _inFlight = false;
    }
  });

  // Reset + auto-detect item_id theo từng trang (tránh dính id sách cũ)
  function refreshPageIdentity() {
    state.download_url = null;
    const id = extractItemIdFromPage();
    const isShop = /\/shop\//i.test(location.pathname);
    if (isShop) {
      // shop: luôn ưu tiên id trang hiện tại
      state.item_id = id || null;
    } else {
      // ebook: chỉ ghi đè khi extract được id; giữ state từ network nếu extract fail
      if (id) state.item_id = id;
    }
    if (!state.deviceId) state.deviceId = getOrCreateDeviceId();
    if (state.item_id) console.log('[Waka Đọc Thử] page item_id =', state.item_id, location.pathname);
  }

  try {
    setTimeout(refreshPageIdentity, 400);
    setTimeout(refreshPageIdentity, 1200);
    setTimeout(refreshPageIdentity, 2500);
    setTimeout(refreshPageIdentity, 4500);
  } catch {}

  // SPA navigation
  try {
    const _ps = history.pushState.bind(history);
    history.pushState = function (...args) {
      _ps(...args);
      state.item_id = null;
      state.download_url = null;
      setTimeout(refreshPageIdentity, 700);
    };
    window.addEventListener('popstate', () => {
      state.item_id = null;
      state.download_url = null;
      setTimeout(refreshPageIdentity, 700);
    });
  } catch {}

  console.log('[Waka Đọc Thử] interceptor v5.1.1 – shop id fix');
})();
