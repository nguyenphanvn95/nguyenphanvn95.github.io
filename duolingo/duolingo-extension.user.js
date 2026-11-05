// ==UserScript==
// @name         Extension for Duolingo
// @name:vi      Extension for Duolingo (Userscript)
// @namespace    https://nguyenphanvn95.github.io/duolingo/
// @version      1.4.6
// @description  Userscript chuyển từ "Extension for Duolingo" 1.4.6: ẩn bảng giải đấu, phím tắt khi luyện tập, tự bấm Next, hiển thị tiến độ đúng/sai & tim, và nhiều hơn nữa.
// @author       nmhillusion (extension gốc) · chuyển userscript: nguyenphanvn95
// @homepageURL  https://nguyenphanvn95.github.io/duolingo/
// @icon         https://nguyenphanvn95.github.io/duolingo/icon.png
// @downloadURL  https://nguyenphanvn95.github.io/duolingo/duolingo-extension.user.js
// @updateURL    https://nguyenphanvn95.github.io/duolingo/duolingo-extension.user.js
// @match        https://www.duolingo.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      goals-api.duolingo.com
// @connect      www.duolingo.com
// ==/UserScript==

(function () {
  "use strict";

  /* =====================================================================
   * Tuỳ chọn của userscript (không có trong extension gốc)
   * ===================================================================== */
  const SHOW_FLOATING_BUTTON = true; // false = chỉ mở cài đặt qua menu Tampermonkey/Violentmonkey
  const ICON_URL = "https://nguyenphanvn95.github.io/duolingo/icon.png";
  const GUIDE_URL =
    "https://gitlab.com/nmhillusion/duolingo-chrome-extension/-/tree/main/docs/popup/README.md";

  /* =====================================================================
   * Hằng số & trạng thái (giữ nguyên giá trị của bản gốc)
   * ===================================================================== */
  const APP = {
    TOURNAMENT_DIV_INDEX: 7,
    INTERVAL_IN_MILLIS: 600,
    ACTIVE_HREF_DAILY_QUEST: null,
    HOME_PAGE_URL: "/learn",
    PRACTICE_PAGE_URL: "/practice",
    COOLING_TIME_IN_MILLIS: 1000,
  };

  const MY_CLASS = "n2-duolingo-ext";
  const N2_COMP = "n2comp";
  const N2_REMOVED = "n2-removed";
  const CLS_SHORTCUT_DESC = "n2-shortcut-desc";
  const CLS_ANSWER_TEXT = "n2-answer-text";

  const DEFAULTS = {
    running: true,
    onlyShowExp: false,
    showHintOfWordBank: true,
    autoClickNext: true,
    showExtraStatusInTest: true,
    autoEnableToggleToKeyboard: true,
  };
  const CONFIG = Object.assign({}, DEFAULTS);

  const STATE = {
    currentUrl: "",
    monitor: { correctAnswers: 0, incorrectAnswers: 0, currentHeartsInPractice: -1 },
    cooling: { coolingClickNextButton: null },
  };

  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  /* =====================================================================
   * Log
   * ===================================================================== */
  const LOG_TAG = "[n2duolingo]";
  const LV = {
    DEBUG: ["DEBUG", "color: gray"],
    INFO: ["INFO", "color: #359bed"],
    WARN: ["WARN", "color: goldenrod"],
    ERROR: ["ERROR", "color: red"],
  };
  function log(lv, ...a) {
    console.log(`%c${LOG_TAG} %c[${lv[0]}]`, "color: rgb(147, 211, 51)", lv[1], ...a);
  }
  const logInfo = (...a) => log(LV.INFO, ...a);
  const logWarn = (...a) => log(LV.WARN, ...a);
  const logError = (...a) => log(LV.ERROR, ...a);
  const logDebug = (...a) => log(LV.DEBUG, ...a);

  /* =====================================================================
   * Tiện ích chung
   * ===================================================================== */
  const parseBoolean = (v) => v === 1 || String(v).toLowerCase() === "true";
  const prefillTextWithChar = (s, len, ch = " ") => {
    let o = s;
    while (o.length < len) o = ch + o;
    return o;
  };
  const formatTimeInSeconds = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec - 3600 * h) / 60);
    const s = sec - 3600 * h - 60 * m;
    return `${prefillTextWithChar(String(h), 2, "0")}:${prefillTextWithChar(String(m), 2, "0")}:${prefillTextWithChar(String(s), 2, "0")}`;
  };
  const parseCookie = () => {
    const r = {};
    const c = document.cookie;
    if (c) {
      c.split(";").forEach((p) => {
        const [k, v] = p.trim().split("=");
        r[String(k).trim()] = String(v).trim();
      });
    }
    return r;
  };
  const combineQueryParams = (o) => Object.keys(o).map((k) => `${k}=${o[k]}`).join("&");
  const checkExistsElementInTreeObject = (obj, ...keys) => {
    let n = obj;
    for (const k of keys) {
      if (!(k in n)) return false;
      n = n[k];
    }
    return true;
  };
  const coolingTask = (ms) => ({
    startTime: Date.now(),
    isCooling() {
      return ms > Date.now() - this.startTime;
    },
  });
  function repeatActionWithDebounce(fn, times, delay, r = 0) {
    if (fn() && r < times - 1) {
      setTimeout(() => repeatActionWithDebounce(fn, times, delay, r + 1), delay);
    }
  }
  function getUserId() {
    try {
      const o = JSON.parse(localStorage.getItem("duo.avatarsIntro"));
      return o ? Object.keys(o)[0] : null;
    } catch (e) {
      return null;
    }
  }
  function findButtonInTreeNode(el, selector) {
    let n = el;
    if (n instanceof HTMLButtonElement) return n;
    while (n && n.parentElement) {
      if (n.parentElement instanceof HTMLButtonElement) return n.parentElement;
      n = n.parentElement;
    }
    return selector && n && n.querySelector(selector) ? null : el;
  }
  function injectStyle(cssClass, css) {
    let el = null;
    try {
      if (typeof GM_addStyle === "function") el = GM_addStyle(css);
    } catch (e) {}
    if (!el || !el.classList) {
      el = document.createElement("style");
      el.textContent = css;
      document.head.appendChild(el);
    }
    el.classList.add(cssClass);
    return el;
  }

  /* =====================================================================
   * Truy cập phần tử DOM của Duolingo
   * ===================================================================== */
  const getRootElement = () => document.querySelector("#root");
  const getProgressBarElement = () => document.querySelector('[role="progressbar"]');
  const getProgressBarThumbElement = (bar) => {
    const b = bar || getProgressBarElement();
    return b ? b.querySelector("*:first-child *:nth-child(2)") : undefined;
  };
  const getSessionPlayerFooter = () => document.querySelector("#session\\/PlayerFooter");
  const getSideBarContainer = () =>
    document.querySelector('[data-test="home"] > *:nth-child(1) > *:first-child');
  const getCorrectAnswerEl = () =>
    getSessionPlayerFooter() ? document.querySelector('[data-test="blame blame-correct"]') : null;
  const getIncorrectAnswerEl = () =>
    getSessionPlayerFooter() ? document.querySelector('[data-test="blame blame-incorrect"]') : null;
  const isHomePage = () => {
    const p = location.pathname;
    return !p || p === APP.HOME_PAGE_URL;
  };
  const isPracticePage = () => {
    const p = location.pathname;
    return !p || p === APP.PRACTICE_PAGE_URL;
  };
  function getSkipButton() {
    const f = getSessionPlayerFooter();
    if (f) {
      const l = f.querySelectorAll('[data-test="player-skip"]');
      return l.length === 1 ? l.item(0) : null;
    }
  }
  function getLastSpeakerButton() {
    const r = getRootElement();
    if (!r) return null;
    const l = Array.from(r.querySelectorAll('[data-test="audio-button"]')).filter((e) => {
      const b = e.getBoundingClientRect();
      return 0 < b.width * b.height;
    });
    return l.length > 0 ? l[l.length - 1] : null;
  }
  function addElementToBeforeFooterOfSidebar(el) {
    const sb = getSideBarContainer();
    if (sb) {
      const footer = sb.querySelector('[data-test="footer-links"]');
      footer ? sb.insertBefore(el, footer) : sb.appendChild(el);
    }
  }

  /* =====================================================================
   * API (tim, mục tiêu hằng ngày)
   * ===================================================================== */
  function gmGetJson(url, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers,
        anonymous: false,
        onload: (r) => {
          try {
            resolve(JSON.parse(r.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject,
        ontimeout: reject,
      });
    });
  }
  async function getJson(url, params = {}, headers = {}) {
    const full = url + (url.includes("?") ? "&" : "?") + combineQueryParams(params);
    logInfo("GET ", full);
    const jwt = parseCookie()["jwt_token"];
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    try {
      return await fetch(full, { headers }).then((r) => r.json());
    } catch (err) {
      // CORS chặn -> thử lại bằng GM_xmlhttpRequest (cùng cookie/Authorization)
      if (typeof GM_xmlhttpRequest === "function") {
        logWarn("fetch failed, fallback to GM_xmlhttpRequest: ", err);
        return gmGetJson(full, headers);
      }
      throw err;
    }
  }

  class ApiBase {
    constructor(expired = 60000) {
      this.EXPIRED_DATA_TIME_IN_MILLIS = expired;
      this.userId = null;
      this.info = null;
      this.latestUpdate = null;
      this.isExecuting = false;
    }
    isExpiredData() {
      return Date.now() - this.EXPIRED_DATA_TIME_IN_MILLIS > this.latestUpdate;
    }
    async exec(userId) {
      if (this.isExecuting) return Promise.reject("executing");
      try {
        this.isExecuting = true;
        if (this.info && !this.isExpiredData()) {
          logDebug("existed info: ", this.info);
          return this.info;
        }
        this.userId = userId;
        this.latestUpdate = Date.now();
        this.info = await this.__exec__();
        return this.info;
      } catch (e) {
        console.error(e);
        return Promise.reject(e);
      } finally {
        this.isExecuting = false;
      }
    }
  }
  class HealthApi extends ApiBase {
    constructor() {
      super(15000);
    }
    __exec__() {
      return getJson(
        `https://www.duolingo.com/2017-06-30/users/${this.userId}`,
        { fields: "health", timezone: "Asia/Bangkok", ui_language: "en", _: this.latestUpdate },
        { Accept: "application/json; charset=UTF-8" }
      );
    }
  }
  class DailyGoalQuestApi extends ApiBase {
    constructor() {
      super(60000);
    }
    __exec__() {
      return getJson(
        `https://goals-api.duolingo.com/users/${this.userId}/progress`,
        { timezone: "Asia/Bangkok", ui_language: "en", _: this.latestUpdate },
        { Accept: "application/json; charset=UTF-8" }
      );
    }
  }
  const healthApi = new HealthApi();
  const dailyGoalQuestApi = new DailyGoalQuestApi();

  /* =====================================================================
   * Style
   * ===================================================================== */
  const N2_CSS = `
.n2-heart-panel{display:flex;justify-content:space-around;position:absolute;top:0;left:100%;padding:0 .5em}.n2-heart-panel .n2-heart-value{padding:0 .25em;font-weight:900}.n2-decayed-skills-container{border:solid 1px #359bed;padding:1em 2em;margin:1.5em;border-radius:4px}.n2-decayed-skills-container .n2-decayed-skills-container-title{font-family:monospace;font-size:x-large;font-weight:900}.n2-decayed-skills-container .n2-decayed-skills-container-content{display:flex;justify-content:center;flex-wrap:wrap}.n2-decayed-skills-container .n2-decayed-skills-container-content .n2-decayed-skill{display:flex;justify-content:center;align-items:center;border:solid 1px #36f;padding:1em 2em;margin:1em;cursor:pointer;border-radius:4px}.n2-decayed-skills-container .n2-decayed-skills-container-content .n2-decayed-skill:hover{background-color:#36f;color:#fff}.n2-decayed-skills-container .n2-decayed-skills-container-content .n2-decayed-skill:hover .n2-decayed-skill-text{color:#fff}.n2-decayed-skills-container .n2-decayed-skills-container-content .n2-decayed-skill .n2-decayed-skill-text{font-family:monospace;color:#36f;font-size:large;font-weight:900}.n2-goalOfDailyQuestContainer{border-radius:.5em;border:solid 5px rgb(var(--color-owl))}.n2-goalOfDailyQuestContainer .n2-goalOfDailyQuest{font-weight:900;margin:1em}.n2-goalOfDailyQuestContainer .n2-goalOfDailyQuest .n2-goalOfDailyQuest-dailyGoalXP{font-size:30px;line-height:1.5em}.n2-goalOfDailyQuestContainer .n2-goalOfDailyQuest .n2-goalOfDailyQuest-dailyQuestSpentTime{font-size:16px;color:rgb(var(--color-macaw))}.n2-btn{background-color:rgb(var(--color-macaw));border:solid .1em #aed5f5;border-bottom-width:.25em;color:var(--web-ui_button-color, rgb(var(--color-snow)));font:700 var(--web-ui_button-font-size, 22px)/var(--web-ui_button-line-height, 1.2) din-round,sans-serif;border-radius:var(--__internal__border-radius, 0.3em);padding:1em 1.2em;margin:.5em;cursor:pointer;box-shadow:0 0 .1em #999;transition:all .14s ease-in;position:relative}.n2-btn:hover{box-shadow:0em .12em .2em #999}.n2-btn:active{border-width:.1em;transform:translateY(0.25em)}.n2-shortcut-desc{font-size:11px;font-weight:100;margin:.25em;top:0;right:0;position:absolute}.n2-answer-status{position:absolute;font-size:.85rem;top:120%}.n2-removed{position:fixed !important;z-index:-1;top:-100vh}:root[data-duo-theme=dark]{--web-ui_button-color: rgb(var(--color-black-text))}:root[data-duo-theme=dark] button:not(._2eG05,._1iDMv),:root[data-duo-theme=dark] [data-test*=button]{--web-ui_button-color: rgb(var(--color-black-text))}:root[data-duo-theme=dark] [data-test*=listenTap] .animated-speaker-icon-lottie{fill:rgb(var(--color-black-text));stroke:rgb(var(--color-black-text))}[role=progressbar]{position:relative}
`;

  function addN2StyleElement() {
    document.querySelectorAll("." + MY_CLASS).forEach((e) => e.remove());
    if (CONFIG.running) injectStyle(MY_CLASS, N2_CSS);
  }

  function addStylesheetForDisableHint() {
    const cls = "n2-disabled-hint";
    document.querySelectorAll("." + cls).forEach((e) => e.remove());
    logInfo(`addStylesheetForDisableHint(showHintOfWordBank: boolean = ${CONFIG.showHintOfWordBank})`);
    if (!CONFIG.showHintOfWordBank) {
      injectStyle(
        cls,
        `[data-test="hint-token"],
html[data-duo-theme=dark] [data-test="hint-token"] {
  user-select: none;
  z-index: -1;
  background: none !important;
  background-image: none !important;
}
[data-test*="challenge"] ._3OOoT {
  border-bottom: solid 1.3px #36f;
}`
      );
      logInfo("add style for disabled show hint of word bank");
    }
  }

  /* =====================================================================
   * Chọn nút trả lời / nút Next
   * ===================================================================== */
  // true nếu nút đã có số 0-9 (Duolingo tự gắn phím tắt) -> không đánh số thêm
  function hasNumberBadge(el) {
    for (const n of el.children) {
      if (n.children.length > 0) return hasNumberBadge(n);
      if (!n.textContent || n.textContent.trim().length === 0) continue;
      if (n.classList.contains(CLS_SHORTCUT_DESC)) continue;
      const v = Number(n.textContent);
      if (Number.isInteger(v) && 0 <= v && 9 >= v) return true;
    }
    return false;
  }

  function getWordBankButtons() {
    const out = [];
    const list = document.querySelectorAll(
      `
    [data-test*="challenge"] [data-test='word-bank'] button ._27oGP,
    [data-test*="challenge-tapComplete"] [data-test='word-bank'] button [data-test='challenge-tap-token-text'],
    [data-test*="challenge-patternTapComplete"] [data-test='word-bank'] button [data-test='challenge-tap-token-text'],
    [data-test*="stories-element"] [data-test='word-bank'] button
    `.trim()
    );
    for (const n of list) {
      const b = findButtonInTreeNode(n);
      if (b) out.push(b);
    }
    return out;
  }

  function getSelectableButton() {
    let e = Array.from(document.querySelectorAll("ul li button")).filter((b) => !hasNumberBadge(b));
    if (e.length === 0) {
      e = Array.from(document.querySelectorAll("button[data-test='challenge-tap-token']")).filter(
        (b) => !hasNumberBadge(b)
      );
    }
    if (e.length === 0) e = getWordBankButtons().filter((b) => !hasNumberBadge(b));
    if (e.length === 0) {
      const t = Array.from(document.querySelectorAll('[data-test="stories-element"] button'))
        .filter((b) => !hasNumberBadge(b))
        .flatMap((b) => Array.from(b.querySelectorAll('[data-test="challenge-tap-token-text"]')));
      if (0 < t.length) {
        e = [];
        for (const n of t) {
          const b = findButtonInTreeNode(n, "._2R_o5._2S0Zh._2TrnF");
          if (b) e.push(b);
        }
      }
    }
    if (e.length === 0) {
      const t = Array.from(document.querySelectorAll("button ._16XFG")).filter((b) => !hasNumberBadge(b));
      if (0 < t.length) {
        e = [];
        for (const n of t) {
          const b = findButtonInTreeNode(n);
          if (b) e.push(b);
        }
      }
    }
    if (e.length === 0 && !getProgressBarElement()) {
      const f = getSessionPlayerFooter();
      if (f) {
        const btns = f.querySelectorAll("button");
        if (0 < btns.length) {
          e = [];
          for (const t of btns) {
            const b = findButtonInTreeNode(t);
            if (b) e.push(b);
          }
        }
      }
    }
    return e;
  }

  function fnGetBtnNextList() {
    let e = [];
    if (getProgressBarElement() && (getCorrectAnswerEl() || getIncorrectAnswerEl())) {
      e = e.concat(
        Array.from(
          document.querySelectorAll(
            `button[data-test="player-next"]:not([aria-disabled="true"]),
          [data-test="stories-player-done"]:not([disabled])
      `.trim()
          )
        )
      );
    }
    const footer = getSessionPlayerFooter();
    if (footer) {
      e = e.concat(Array.from(footer.querySelectorAll('button._1N-oo:not([data-test="player-skip"])')));
    }
    if (getProgressBarElement()) {
      e = e.concat(
        Array.from(
          document.querySelectorAll(
            `
          button[data-test="stories-player-continue"]:not([disabled])
      `.trim()
          )
        )
      );
    }
    if (e.length === 0) {
      const f = getSessionPlayerFooter();
      if (getProgressBarElement() && f) {
        const n = Array.from(f.querySelectorAll("button"));
        if (n.length === 1) e.push(n[0]);
      }
    }
    return e.map((x) => findButtonInTreeNode(x));
  }

  /* =====================================================================
   * Các tính năng
   * ===================================================================== */
  // --- Tự bấm Next ---
  function findAndClickNextButton() {
    if (isHomePage()) return;
    if (getSessionPlayerFooter() && getProgressBarElement() && !getIncorrectAnswerEl() && !getCorrectAnswerEl()) return;
    if (STATE.cooling.coolingClickNextButton && STATE.cooling.coolingClickNextButton.isCooling()) return;
    STATE.cooling.coolingClickNextButton = coolingTask(APP.COOLING_TIME_IN_MILLIS);
    const incorrect = !!getIncorrectAnswerEl();
    const list = fnGetBtnNextList();
    if (list && 0 < list.length && !incorrect) {
      list.forEach((btn) => {
        repeatActionWithDebounce(
          () => {
            if (btn) btn.click();
            return !!btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
          },
          3,
          1000
        );
      });
    }
  }

  // --- Bật chế độ bàn phím ---
  function enableKeyboardMode() {
    const el = document.querySelector('[data-test="player-toggle-keyboard"]');
    if (
      el &&
      ["sử dụng bàn phím", "nâng độ khó"].some((t) => String(el.textContent).trim().toLowerCase().includes(t))
    ) {
      logInfo("click to toggle Keyboard mode");
      el.click();
    }
  }

  // --- Ẩn bảng giải đấu / xếp hạng (chế độ onlyShowExp) ---
  function removeTournamentBoard() {
    if (CONFIG.running && CONFIG.onlyShowExp) {
      const list = Array.from(document.querySelectorAll("div")).filter((d) =>
        d.textContent.includes("Giải đấu")
      );
      if (list && APP.TOURNAMENT_DIV_INDEX < list.length) {
        const t = list[APP.TOURNAMENT_DIV_INDEX];
        if (t) t.remove();
      }
    }
  }
  function removePromotionRank() {
    if (CONFIG.running && CONFIG.onlyShowExp) {
      const sb = getSideBarContainer();
      if (sb) {
        for (const c of sb.children) {
          if (!c.classList.contains(N2_COMP) && !c.classList.contains(N2_REMOVED)) c.classList.add(N2_REMOVED);
        }
      }
    }
  }
  function markN2KeepComponents() {
    if (isHomePage()) {
      const sb = getSideBarContainer();
      if (sb) {
        sb.querySelectorAll(`[data-test="courses-menu"]:not(.${N2_COMP})`).forEach((e) => {
          e.parentElement.classList.add(N2_COMP);
        });
        sb.querySelectorAll(`[data-test="footer-links"]:not(.${N2_COMP})`).forEach((e) => {
          e.classList.add(N2_COMP);
        });
      }
    }
  }

  // --- Bỏ slide hoàn thành bài ---
  function removeSessionCompleteSlide() {
    if (!CONFIG.running) return;
    {
      const list = Array.from(
        document.querySelectorAll(
          ['[data-test="session-complete-slide"]', '[data-test="daily-quest-progress-slide"]'].join(",")
        )
      );
      if (getProgressBarElement()) list.push(document.querySelector(".wPvQK._18W4a.xtPuL"));
      if (0 < list.length) {
        for (const o of list) {
          const gp = o && o.parentElement && o.parentElement.parentElement;
          if (gp) gp.remove();
        }
      }
    }
    {
      const list = document.querySelectorAll(".Lwvas._2C9ly");
      if (0 < list.length) {
        for (const t of list) {
          if (t && t.parentElement) t.parentElement.remove();
        }
      }
    }
  }

  // --- Đếm đúng/sai trên thanh tiến độ ---
  const CLS_ANSWER_STATUS = "n2-answer-status";
  const CLS_ALREADY_COUNTED = "n2-already-counted";

  function updateCorrectAnswerStatusPosition() {
    const bar = getProgressBarElement();
    if (!bar) return;
    const thumb = getProgressBarThumbElement(bar);
    const st = bar.querySelector("." + CLS_ANSWER_STATUS);
    if (st && thumb) {
      st.style.left = Math.max(0, thumb.getBoundingClientRect().width - st.getBoundingClientRect().width) + "px";
    }
  }
  function monitorTestProgress() {
    {
      const t = getCorrectAnswerEl();
      if (t && !t.classList.contains(CLS_ALREADY_COUNTED)) {
        t.classList.add(CLS_ALREADY_COUNTED);
        STATE.monitor.correctAnswers += 1;
      }
    }
    {
      const t = getIncorrectAnswerEl();
      if (t && !t.classList.contains(CLS_ALREADY_COUNTED)) {
        t.classList.add(CLS_ALREADY_COUNTED);
        STATE.monitor.incorrectAnswers += 1;
      }
    }
    {
      const bar = getProgressBarElement();
      if (!bar) return;
      const thumb = getProgressBarThumbElement(bar);
      const m = STATE.monitor;
      if (thumb && 0 < m.correctAnswers + m.incorrectAnswers) {
        bar.style.position = "relative";
        if (!bar.querySelector("." + CLS_ANSWER_STATUS)) {
          const d = document.createElement("div");
          d.classList.add(N2_COMP);
          d.classList.add(CLS_ANSWER_STATUS);
          bar.appendChild(d);
        }
        const st = bar.querySelector("." + CLS_ANSWER_STATUS);
        if (st) {
          updateCorrectAnswerStatusPosition();
          st.textContent = `${m.correctAnswers}/${m.correctAnswers + m.incorrectAnswers}`;
        }
      }
    }
  }

  // --- Hiển thị tim trong luyện tập ---
  function buildCurrentHeartsInPractice() {
    if (!isPracticePage() || !CONFIG.showExtraStatusInTest) return;
    const bar = getProgressBarElement();
    if (!bar) return;
    if (bar.querySelector(".n2-heart-panel") || -1 != STATE.monitor.currentHeartsInPractice) return;
    healthApi
      .exec(getUserId())
      .then((data) => {
        logInfo("health date: ", data);
        if (data && data.health && 0 < data.health.maxHearts) {
          STATE.monitor.currentHeartsInPractice = data.health.hearts;
          const panel = document.createElement("div");
          panel.classList.add("n2-heart-panel");
          const icon = document.createElement("span");
          icon.classList.add("n2-heart-icon");
          icon.textContent = "❤️";
          panel.appendChild(icon);
          const val = document.createElement("span");
          val.classList.add("n2-heart-value");
          val.textContent = String(data.health.hearts);
          panel.appendChild(val);
          bar.appendChild(panel);
        }
      })
      .catch((e) => logError("buildCurrentHeartsInPractice error: ", e));
  }

  // --- Exp / thời gian hôm nay (onlyShowExp) ---
  async function buildGoalOfDailyQuest() {
    if (isHomePage() && getSideBarContainer() && !document.querySelector(".n2-goalOfDailyQuestContainer")) {
      logInfo("start buildGoalOfDailyQuest");
      const c = document.createElement("div");
      c.classList.add("n2-goalOfDailyQuestContainer");
      c.classList.add(N2_COMP);
      const inner = document.createElement("div");
      inner.classList.add("n2-goalOfDailyQuest");
      inner.classList.add(N2_COMP);
      c.appendChild(inner);
      addElementToBeforeFooterOfSidebar(c);
    }
    {
      const holder = document.querySelector(".n2-goalOfDailyQuestContainer .n2-goalOfDailyQuest");
      if (holder && 0 == holder.childElementCount) {
        try {
          const data = await dailyGoalQuestApi.exec(getUserId());
          logInfo("goalOfDailyQuest = ", data);
          if (!data) throw new Error("cannot obtain Duo Goal of Daily Quest");
          let xp = 0,
            spent = 0;
          if (
            checkExistsElementInTreeObject(data, "goals", "progress", "daily_goal_daily_quest") &&
            Number.isInteger(Number(data.goals.progress.daily_goal_daily_quest))
          ) {
            xp = Number(data.goals.progress.daily_goal_daily_quest);
          }
          if (
            checkExistsElementInTreeObject(data, "goals", "progress", "time_spent_core_daily_quest") &&
            Number.isInteger(Number(data.goals.progress.time_spent_core_daily_quest))
          ) {
            spent = Number(data.goals.progress.time_spent_core_daily_quest);
          }
          const dxp = document.createElement("div");
          dxp.classList.add("n2-goalOfDailyQuest-dailyGoalXP");
          dxp.textContent = `Daily Exp: ${xp}`;
          const dt = document.createElement("div");
          dt.classList.add("n2-goalOfDailyQuest-dailyQuestSpentTime");
          dt.textContent = `Spent time: ${formatTimeInSeconds(spent)}`;
          if (holder && 0 == holder.childElementCount) {
            holder.appendChild(dxp);
            holder.appendChild(dt);
          }
        } catch (e) {
          logError(e);
        }
      }
    }
    APP.ACTIVE_HREF_DAILY_QUEST = location.href;
  }

  // --- Nút tắt Lesson / Practice / Story ở sidebar ---
  function buildShortcutForCommonActions() {
    if (document.querySelector(".n2-shortcutForCommonActions")) return;
    const box = document.createElement("div");
    box.classList.add("n2-shortcutForCommonActions");
    box.classList.add(N2_COMP);
    const mk = (text, cls, href, hint, logMsg) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.classList.add("n2-btn");
      b.classList.add(cls);
      b.onclick = () => {
        logInfo(logMsg);
        window.location.href = href;
      };
      const s = document.createElement("span");
      s.classList.add(CLS_SHORTCUT_DESC);
      s.textContent = hint;
      b.appendChild(s);
      box.appendChild(b);
    };
    mk("Lesson", "n2-btn-lesson", "/lesson", "(Shift + L)", "do click to lesson");
    mk("Practice", "n2-btn-practice", "/practice", "(Shift + P)", "do click to practice");
    mk("Story", "n2-btn-story", "/practice-hub/stories", "(Alt + Shift + Q)", "do click to Story");
    addElementToBeforeFooterOfSidebar(box);
  }

  // --- Số thứ tự phím tắt trên nút đáp án ---
  function updateShortcutDescForButton() {
    document
      .querySelectorAll(`.${CLS_SHORTCUT_DESC}.${CLS_ANSWER_TEXT}`)
      .forEach((e) => e.remove());
    const btns = getSelectableButton();
    if (0 < btns.length) {
      let i = 0;
      for (const n of btns) {
        const b = findButtonInTreeNode(n);
        if (b && !b.querySelector(`.${CLS_SHORTCUT_DESC}`)) {
          i += 1;
          const s = document.createElement("span");
          s.classList.add(CLS_SHORTCUT_DESC);
          s.classList.add(CLS_ANSWER_TEXT);
          s.textContent = String(i % 10);
          b.appendChild(s);
        }
      }
    }
    const skip = getSkipButton();
    if (skip && !skip.querySelector(`.${CLS_SHORTCUT_DESC}`)) {
      const s = document.createElement("span");
      s.classList.add(CLS_SHORTCUT_DESC);
      s.classList.add(CLS_ANSWER_TEXT);
      s.textContent = " (Esc)";
      skip.appendChild(s);
    }
  }

  // --- Phím tắt ---
  let shortcutsReady = false;
  function onKeyUp(e) {
    if (!CONFIG.running) return;
    const a = String(e.key).trim() || e.code;
    if (Number.isInteger(Number(a))) {
      const num = Number(a);
      const btns = getSelectableButton();
      if (!btns || 1 > btns.length) {
        logWarn("not found any button to click");
        return;
      }
      for (const b of btns) {
        b.onkeydown = null;
        b.onkeyup = null;
        b.onkeypress = null;
      }
      if (0 <= num && num <= Math.min(9, btns.length)) {
        const t = btns[0 == num ? 9 : num - 1];
        if (t) t.click();
      }
    } else {
      const k = String(a).toLowerCase();
      if (e.shiftKey) {
        if (k == "l") {
          logInfo("shortcut to lesson");
          window.location.href = "/lesson";
          e.preventDefault();
          e.stopPropagation();
        } else if (k == "p") {
          logInfo("shortcut to practice");
          window.location.href = "/practice";
          e.preventDefault();
          e.stopPropagation();
        }
      }
      if (k == "q" && e.shiftKey && e.altKey) {
        logInfo("shortcut to stories");
        window.location.href = "/stories";
      }
      if (k == "space" && e.ctrlKey) {
        logInfo("shortcut to speak again");
        const sp = getLastSpeakerButton();
        if (sp) sp.click();
      }
      if (k == "escape") {
        const sk = getSkipButton();
        if (sk) sk.click();
      }
      if (k == "home" && e.ctrlKey) {
        logInfo("shortcut to go home");
        window.location.href = "/";
      }
    }
  }
  function setupShortcuts() {
    if (CONFIG.running && !shortcutsReady) {
      shortcutsReady = true;
      W.onkeydown = null;
      W.onkeypress = null;
      window.removeEventListener("keyup", onKeyUp, true);
      window.addEventListener("keyup", onKeyUp, { capture: true, once: false, passive: false });
    }
  }

  /* =====================================================================
   * Theo dõi đổi trang / làm lại bài
   * ===================================================================== */
  function resetMonitorStatus() {
    STATE.monitor.correctAnswers = STATE.monitor.incorrectAnswers = 0;
    STATE.monitor.currentHeartsInPractice = -1;
  }
  function detectChangePageUrl() {
    if (STATE.currentUrl) {
      const href = location.href;
      if (href != STATE.currentUrl) {
        logInfo("exec for listener on event[onPageChanged]: resetMonitorStatus");
        resetMonitorStatus();
        STATE.currentUrl = href;
      }
    } else {
      STATE.currentUrl = location.href;
    }
  }
  function detectRePractice() {
    const m = STATE.monitor;
    if (2 < m.correctAnswers + m.incorrectAnswers) {
      const bar = getProgressBarElement();
      if (bar) {
        const thumb = getProgressBarThumbElement(bar);
        if (!thumb || 0 == thumb.getBoundingClientRect().width) {
          logInfo("exec for listener on event[onRePractice]: resetMonitorStatus");
          resetMonitorStatus();
        }
      }
    }
  }

  /* =====================================================================
   * Dọn giao diện khi tắt tính năng
   * ===================================================================== */
  function cleanupInjected(all) {
    if (all) {
      document
        .querySelectorAll(
          ".n2-shortcutForCommonActions,.n2-answer-status,.n2-heart-panel,.n2-shortcut-desc"
        )
        .forEach((e) => e.remove());
    }
    if (all || !CONFIG.onlyShowExp) {
      document.querySelectorAll(".n2-goalOfDailyQuestContainer").forEach((e) => e.remove());
      document.querySelectorAll("." + N2_REMOVED).forEach((e) => e.classList.remove(N2_REMOVED));
    }
  }

  /* =====================================================================
   * Vòng lặp chính
   * ===================================================================== */
  let obsBusy = false;
  function onMutation(rec) {
    if (obsBusy) return;
    try {
      obsBusy = true;
      if (!CONFIG.running) return;
      const r = rec.target;
      if (r && r.getAttribute && r.getAttribute("role") === "progressbar") {
        if (!isHomePage() && CONFIG.showExtraStatusInTest) monitorTestProgress();
        if (isPracticePage() && CONFIG.showExtraStatusInTest) buildCurrentHeartsInPractice();
      }
      detectChangePageUrl();
      detectRePractice();
      if (rec.addedNodes && 0 < rec.addedNodes.length) {
        markN2KeepComponents();
        removeTournamentBoard();
        removePromotionRank();
        removeSessionCompleteSlide();
      }
    } catch (e) {
      logError(e);
    } finally {
      obsBusy = false;
    }
  }

  let tickBusy = false;
  function tick() {
    if (tickBusy) {
      logWarn("Not running loop function due to not finished the last one");
      return;
    }
    if (!CONFIG.running) return;
    try {
      tickBusy = true;
      markN2KeepComponents();
      removeTournamentBoard();
      removePromotionRank();
      removeSessionCompleteSlide();
      if (!isHomePage() && CONFIG.showExtraStatusInTest) updateCorrectAnswerStatusPosition();
      if (CONFIG.autoClickNext) findAndClickNextButton();
      updateShortcutDescForButton();
      detectChangePageUrl();
      buildShortcutForCommonActions();
      if (CONFIG.autoEnableToggleToKeyboard) enableKeyboardMode();
      if (CONFIG.onlyShowExp) buildGoalOfDailyQuest();
      if (isPracticePage() && CONFIG.showExtraStatusInTest) buildCurrentHeartsInPractice();
    } catch (e) {
      logError(e);
    } finally {
      tickBusy = false;
    }
  }

  /* =====================================================================
   * Cấu hình (thay chrome.storage.sync bằng GM_getValue / GM_setValue)
   * ===================================================================== */
  function loadConfig() {
    for (const k of Object.keys(DEFAULTS)) {
      const raw = GM_getValue(k, undefined);
      CONFIG[k] = raw === undefined ? DEFAULTS[k] : parseBoolean(raw);
    }
  }
  function saveConfig(key, value) {
    logInfo("do save to storage: ", { key, value });
    GM_setValue(key, String(value));
  }
  function initDefaultConfig() {
    for (const k of Object.keys(DEFAULTS)) {
      if (GM_getValue(k, undefined) === undefined) {
        GM_setValue(k, String(DEFAULTS[k]));
        console.log(`Set default [${k}] successfully: `, DEFAULTS[k]);
      }
    }
  }

  let observer = null;
  let ticker = null;
  function attachObserver(retry = 0) {
    const root = getRootElement();
    if (!root) {
      if (retry < 50) return void setTimeout(() => attachObserver(retry + 1), 200);
      return logError("Element to observable is null: ", root);
    }
    if (observer) observer.disconnect();
    observer = new MutationObserver((records) => {
      for (const r of records) onMutation(r);
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
  }

  function applyConfig() {
    loadConfig();
    logInfo("___ main duolingo ext process ___ > running: ", CONFIG);
    addN2StyleElement();
    addStylesheetForDisableHint();
    if (CONFIG.running) {
      markN2KeepComponents();
      setupShortcuts();
      removeTournamentBoard();
      cleanupInjected(false);
    } else {
      cleanupInjected(true);
    }
    renderSettingsPanel();
  }

  /* =====================================================================
   * Bảng cài đặt (thay cho popup của extension)
   * ===================================================================== */
  const SETTING_TEXT = {
    running: { on: "Is Running", off: "Is Stopped" },
    onlyShowExp: { on: "Home Page Goal: Is Only show exp", off: "Home Page Goal: Default by Duolingo" },
    showHintOfWordBank: { on: "Enabled hint of word bank", off: "Disabled hint of word bank" },
    autoClickNext: { on: "Enabled: Auto click Next Buttons", off: "Disabled: Auto click Next Buttons" },
    showExtraStatusInTest: {
      on: "Enabled: Show Extra Status in progress bar in Exam mode",
      off: "Disabled: NOT Show Extra Status in progress bar in Exam mode",
    },
    autoEnableToggleToKeyboard: {
      on: 'Enabled: Auto enable "Toggle Keyboard Mode" in Duolingo',
      off: 'Disabled: Default "Toggle Keyboard Mode" of Duolingo',
    },
  };
  const PANEL_CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
:host{--mainColor:#00ce7f;--sw:28px;--sr:3px;--st:20px;--sm:1px}
.fab{position:fixed;left:14px;bottom:14px;width:36px;height:36px;border-radius:50%;border:none;padding:0;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.35);cursor:pointer;opacity:.4;transition:opacity .15s;z-index:2147483646;display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden}
.fab:hover{opacity:1}
.fab img{width:100%;height:100%;object-fit:cover}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483647;display:none;align-items:center;justify-content:center}
.overlay.open{display:flex}
.container{width:min(30em,94vw);max-height:92vh;overflow:auto;background:#fff;color:#222;border-radius:8px;box-shadow:0 6px 30px rgba(0,0,0,.4)}
.title{padding:1em;color:#fff;background:var(--mainColor);font-weight:900;display:flex;justify-content:space-between;align-items:center;border-radius:8px 8px 0 0}
.close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}
.description{padding:.5em;font-size:13px}
.description a{color:#1a73e8}
.controls{padding:.5em;margin:.25em;border:solid 1px #eee}
.control{display:grid;grid-template-columns:5em 1fr;font-size:12px;align-items:center;margin:.5em 0}
.control label{cursor:pointer}
button.btn-switch{cursor:pointer;display:block;border:none;margin:0 1em;width:var(--sw);height:15px;position:relative;background:#c9c9c9;box-sizing:content-box;border-radius:var(--sr);padding:calc(2*var(--sm))}
.btn-switch::after{content:"";box-sizing:content-box;display:block;height:calc(100% - 2*var(--sm));width:var(--st);position:absolute;top:var(--sm);z-index:1;transition:all ease-in .43s;border-radius:var(--sr)}
.btn-switch.off{border:solid 1px #555}
.btn-switch.off::after{left:calc(100% - var(--st) - var(--sm));background:#444}
.btn-switch.on{border:solid 1px var(--mainColor)}
.btn-switch.on::after{left:var(--sm);background:var(--mainColor)}
.note{margin:0;padding:.5em;color:#daa520;font-size:13px}
`;
  const KEYS_GROUP_1 = ["running"];
  const KEYS_GROUP_2 = [
    "onlyShowExp",
    "showHintOfWordBank",
    "autoClickNext",
    "showExtraStatusInTest",
    "autoEnableToggleToKeyboard",
  ];
  let panel = null; // { host, root, overlay }

  function ensurePanel() {
    if (panel) return panel;
    const host = document.createElement("div");
    host.id = "n2-duolingo-userscript-settings";
    const root = host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = PANEL_CSS;
    root.appendChild(st);

    if (SHOW_FLOATING_BUTTON) {
      const fab = document.createElement("button");
      fab.className = "fab";
      fab.title = "Duolingo Extension Setting";
      const img = document.createElement("img");
      img.src = ICON_URL;
      img.alt = "";
      img.onerror = () => {
        img.remove();
        fab.textContent = "⚙";
      };
      fab.appendChild(img);
      fab.onclick = () => openPanel(true);
      root.appendChild(fab);
    }

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) openPanel(false);
    });
    root.appendChild(overlay);
    // chặn phím tắt của Duolingo khi đang mở bảng
    ["keyup", "keydown", "keypress"].forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));

    document.documentElement.appendChild(host);
    panel = { host, root, overlay };
    return panel;
  }
  function openPanel(open) {
    const p = ensurePanel();
    p.overlay.classList.toggle("open", !!open);
    if (open) renderSettingsPanel();
  }
  function renderSettingsPanel() {
    const p = ensurePanel();
    const c = document.createElement("div");
    c.className = "container";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Duolingo Extension Setting";
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "✕";
    close.onclick = () => openPanel(false);
    title.appendChild(close);
    c.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "description";
    const a = document.createElement("a");
    a.href = GUIDE_URL;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "How does it work?";
    desc.appendChild(a);
    c.appendChild(desc);

    const addGroup = (keys) => {
      const g = document.createElement("div");
      g.className = "controls";
      for (const k of keys) {
        const row = document.createElement("div");
        row.className = "control";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = "btn-" + k;
        btn.className = "btn-switch " + (CONFIG[k] ? "on" : "off");
        const lb = document.createElement("label");
        lb.setAttribute("for", btn.id);
        lb.textContent = CONFIG[k] ? SETTING_TEXT[k].on : SETTING_TEXT[k].off;
        const toggle = () => {
          const v = !CONFIG[k];
          saveConfig(k, v);
          applyConfig(); // áp dụng ngay + vẽ lại bảng
        };
        btn.onclick = toggle;
        row.appendChild(btn);
        row.appendChild(lb);
        g.appendChild(row);
      }
      c.appendChild(g);
    };
    addGroup(KEYS_GROUP_1);
    addGroup(KEYS_GROUP_2);

    const note = document.createElement("p");
    note.className = "note";
    note.innerHTML = "<i>Thay đổi được áp dụng ngay. Nếu giao diện chưa đổi, hãy tải lại trang.</i>";
    c.appendChild(note);

    const wasOpen = p.overlay.classList.contains("open");
    p.overlay.replaceChildren(c);
    p.overlay.classList.toggle("open", wasOpen);
  }

  /* =====================================================================
   * Khởi động
   * ===================================================================== */
  function main() {
    initDefaultConfig();
    applyConfig();
    attachObserver();
    if (ticker) clearInterval(ticker);
    ticker = setInterval(tick, APP.INTERVAL_IN_MILLIS);

    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("⚙️ Duolingo Extension Setting", () => openPanel(true));
    }
    // thay đổi từ tab khác (tương đương chrome.storage.onChanged)
    if (typeof GM_addValueChangeListener === "function") {
      for (const k of Object.keys(DEFAULTS)) {
        GM_addValueChangeListener(k, (name, oldV, newV, remote) => {
          if (remote) {
            logDebug({ changes: { [name]: { oldV, newV } } });
            applyConfig();
          }
        });
      }
    }
  }

  main();
})();
