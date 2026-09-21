/**
 * zip-shim.js — setImmediate an toàn cho JSZip trong sandbox userscript.
 *
 * Vấn đề: JSZip 3.x tự chèn polyfill `setImmediate` dựa trên window.postMessage và chỉ chạy
 * callback khi `event.source === window`. Trong sandbox của Tampermonkey/Violentmonkey/Firefox,
 * `window` của userscript là bản proxy/wrapper nên phép so sánh này luôn sai → callback không
 * bao giờ chạy → `zip.generateAsync()` / `JSZip.loadAsync()` treo vĩnh viễn (không lỗi, không
 * timeout). Hậu quả: bấm "Đọc ngay" tải xong các file rồi đứng ở bước "Đang dựng EPUB...".
 *
 * Cách xử lý: định nghĩa sẵn `setImmediate` bằng MessageChannel (không phụ thuộc event.source)
 * TRƯỚC khi jszip.min.js được nạp → JSZip thấy đã có `setImmediate` và bỏ qua polyfill lỗi.
 * File này phải đứng trước lib/jszip.min.js trong danh sách @require.
 */
(function () {
  'use strict';
  const g = typeof window !== 'undefined' ? window : self;
  if (typeof g.setImmediate === 'function') return;

  const queue = [];
  let seq = 0;
  let channel = null;
  try { channel = new MessageChannel(); } catch (e) { channel = null; }

  if (channel) {
    channel.port1.onmessage = () => {
      const job = queue.shift();
      if (job && !job.cancelled) job.run();
    };
  }

  g.setImmediate = function (fn) {
    const args = Array.prototype.slice.call(arguments, 1);
    const job = { id: ++seq, cancelled: false, run() { fn.apply(null, args); } };
    if (channel) {
      queue.push(job);
      channel.port2.postMessage(0);
    } else {
      setTimeout(job.run, 0);
    }
    return job.id;
  };

  g.clearImmediate = function (id) {
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].id === id) { queue[i].cancelled = true; return; }
    }
  };
})();
