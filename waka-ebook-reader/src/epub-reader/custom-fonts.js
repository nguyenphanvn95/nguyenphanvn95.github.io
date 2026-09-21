// custom-fonts.js — font tuỳ chỉnh đóng gói sẵn trong assets/fonts/ (chọn được ở cả desktop lẫn mobile).
//
// NGUỒN SỰ THẬT DUY NHẤT cho danh sách font tuỳ chỉnh: thêm 1 font mới = bỏ file vào assets/fonts/
// rồi thêm 1 mục vào FONTS bên dưới — nút chọn font (pane Typography ở desktop, bảng "Cài đặt chữ"
// ở mobile) tự sinh từ danh sách này, không phải sửa reader.html.
//
// • app.js gọi ReaderFonts.stack(key) để ra chuỗi font-family và ReaderFonts.faceCss(key) để
//   nhúng @font-face vào iframe chương — CHỈ font đang chọn mới được nhúng/tải (không tải cả bộ).
// • Nạp TRƯỚC app.js và reader-ui.js/mobile-reader.js (file này tạo sẵn các nút để 2 file kia bắt được).
// • Chỉ chứa font đã kiểm tra đủ chữ tiếng Việt (ă â đ ê ô ơ ư và toàn bộ dấu).
//   Các font đã có sẵn trong danh sách từ trước (Bookerly, Minion, Noto Serif, Roboto) không khai báo lại ở đây.

(() => {
  "use strict";

  const BASE =
    globalThis.chrome && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL("assets/fonts/")
      : new URL("../assets/fonts/", document.baseURI).href;

  // Fallback khi font chưa nạp xong / thiếu glyph.
  const SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif';
  const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const MONO = '"Courier New", Courier, monospace';

  // key: giá trị lưu trong settings.fontFamily (chữ thường, không dấu/cách).
  // faces: [tên file trong assets/fonts/, font-weight]. Font chỉ có 1 độ đậm thì để 400.
  const FONTS = [
    { key: "icieldomaine", label: "iCiel Domaine", fallback: SERIF, faces: [["icieldomaine-regular.ttf", 400]] },
    { key: "svntimes", label: "SVN-Times New Roman", fallback: SERIF, faces: [["svntimesnewroman-regular.ttf", 400]] },
    { key: "notosans", label: "Noto Sans", fallback: SANS, faces: [["notosans-regular.ttf", 400]] },
    { key: "netflixsans", label: "Netflix Sans", fallback: SANS, faces: [
      ["netflixsans-light.otf", 300], ["netflixsans-regular.otf", 400],
      ["netflixsans-medium.otf", 500], ["netflixsans-bold.otf", 700],
    ] },
    { key: "quicksand", label: "Quicksand", fallback: SANS, faces: [["quicksand-regular.ttf", 400]] },
    { key: "svnhelvetica", label: "SVN-Helvetica Neue", fallback: SANS, faces: [["svnhelveticaneue-regular.ttf", 400]] },
    { key: "mtodom", label: "MTO Dom", fallback: SANS, faces: [["mtodom-regular.ttf", 400]] },
    { key: "pattaya", label: "Pattaya", fallback: SANS, faces: [["pattaya-regular.ttf", 400]] },
    { key: "p22typewriter", label: "P22 Typewriter", fallback: MONO, faces: [["p22typewriter-regular.ttf", 400]] },
    { key: "trixipro", label: "Trixi Pro", fallback: MONO, faces: [["trixipro-regular.ttf", 400]] },
  ];

  // Tên family khai báo trong @font-face có tiền tố riêng, để không đụng font cùng tên
  // (nhúng trong EPUB hoặc cài trong máy).
  const familyOf = (f) => `Waka ${f.label}`;
  const byKey = (key) => FONTS.find((f) => f.key === key) || null;

  function stack(key) {
    const f = byKey(key);
    return f ? `"${familyOf(f)}", ${f.fallback}` : null;
  }

  /** @font-face của ĐÚNG font đang chọn ("" nếu key không phải font tuỳ chỉnh). */
  function faceCss(key) {
    const f = byKey(key);
    if (!f) return "";
    return f.faces.map(([file, weight]) => {
      const fmt = /\.otf$/i.test(file) ? "opentype" : "truetype";
      return `@font-face{font-family:"${familyOf(f)}";src:url("${BASE}${file}") format("${fmt}");font-weight:${weight};font-style:normal;font-display:block;}`;
    }).join("\n");
  }

  /** Sinh nút chọn font vào 2 danh sách có sẵn (bỏ qua nếu nút đó đã tồn tại). */
  function injectButtons() {
    const desktop = document.querySelector(".rd-font-presets");
    const mobile = document.getElementById("mobile-font-pills");
    for (const f of FONTS) {
      if (desktop && !desktop.querySelector(`[data-font-preset="${f.key}"]`)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "rd-font-preset";
        b.dataset.fontPreset = f.key;
        b.textContent = f.label;
        desktop.appendChild(b);
      }
      if (mobile && !mobile.querySelector(`[data-font-family="${f.key}"]`)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mobile-pill";
        b.dataset.fontFamily = f.key;
        b.textContent = f.label;
        mobile.appendChild(b);
      }
    }
  }
  injectButtons();

  window.ReaderFonts = {
    fonts: FONTS.map((f) => ({ key: f.key, label: f.label })),
    isCustom: (key) => !!byKey(key),
    stack,
    faceCss,
  };
})();
