#!/usr/bin/env node
/**
 * download-all-chapters.mjs  –  Waka Downloader v3.6.1
 *
 * Đọc chapters.json → fetch playlist từng chương qua listNextBackFm API
 * → tải HLS segments → giải mã AES-128-CBC → lưu file .aac mỗi chương.
 *
 * Yêu cầu:
 *   Node.js 18+ (built-in fetch + crypto.subtle)
 *   File chapters.json đã có (export từ extension)
 *
 * Cách dùng:
 *   node download-all-chapters.mjs --chapters chapters.json --cookie "token=xxx; ..." --out ./output
 *
 * Lấy cookie: F12 → Network → click bất kỳ request tới beta-api.waka.vn
 *             → Copy → Copy as cURL → lấy phần -H 'cookie: ...'
 *
 * Options:
 *   --chapters <file>   Path đến file chapters.json     (bắt buộc)
 *   --cookie   <str>    Cookie string từ browser        (bắt buộc để tải paid chapters)
 *   --out      <dir>    Thư mục lưu file (mặc định: ./waka-audio)
 *   --delay    <ms>     Delay giữa các chương (mặc định: 1500ms)
 *   --from     <n>      Bắt đầu từ chương thứ n (1-based, mặc định: 1)
 *   --to       <n>      Kết thúc ở chương thứ n (mặc định: tất cả)
 *   --resume           Bỏ qua chương đã có file, tiếp tục từ chỗ còn thiếu
 *   --dry-run          Chỉ liệt kê chương, không tải
 *   --help
 */

import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { createWriteStream } from 'fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ─── Waka API ────────────────────────────────────────────────────────────────

const BASE_API = 'https://beta-api.waka.vn';

// Headers giả lập browser để tránh bị API block
function makeHeaders(cookie) {
  const h = {
    accept: 'application/json',
    'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    origin: 'https://waka.vn',
    referer: 'https://waka.vn/',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  if (cookie) h['cookie'] = cookie;
  return h;
}

/**
 * Gọi listNextBackFm với action=current để lấy ĐÚNG chương này.
 * action=next trả về chương KẾ TIẾP → audio_data là của chương tiếp theo, không phải chương đang cần.
 *
 * Thứ tự thử: current → next (fallback)
 */
async function fetchChapterAudioInfo(contentId, chapterId, cookie, action = 'current') {
  const params = new URLSearchParams({
    content_id: String(contentId),
    chapter_id: String(chapterId),
    action,
    page_no: '1',
    page_size: '1',
  });
  const url = `${BASE_API}/fm/listNextBackFm?${params}`;
  const resp = await fetch(url, { headers: makeHeaders(cookie) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} khi fetch chapter ${chapterId} (action=${action})`);
  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`API code=${json.code}: ${json.message ?? '(no message)'} [chapter=${chapterId}]`);
  }
  return json;
}

/**
 * Tìm URL playlist .m3u8 hoặc URL vegacdn trong bất kỳ object lồng nhau nào.
 * Duyệt đệ quy: audio_data[], các field string, object con.
 */
function extractAudioUrlFromObj(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;

  // Các field string trực tiếp
  for (const f of ['url', 'play_url', 'hls_url', 'stream_url', 'file', 'src', 'link']) {
    const v = obj[f];
    if (typeof v === 'string' && v && (v.includes('.m3u8') || v.includes('vegacdn.vn'))) return v;
  }

  // audio_data array (cấu trúc chính của Waka)
  if (Array.isArray(obj.audio_data)) {
    for (const ad of obj.audio_data) {
      const u = extractAudioUrlFromObj(ad, depth + 1);
      if (u) return u;
    }
  }

  // Các field array khác
  for (const key of Object.keys(obj)) {
    if (['thumb', 'raw', 'avatar', 'cover'].includes(key)) continue;
    if (Array.isArray(obj[key])) {
      for (const el of obj[key]) {
        if (el && typeof el === 'object') {
          const u = extractAudioUrlFromObj(el, depth + 1);
          if (u) return u;
        }
      }
    } else if (obj[key] && typeof obj[key] === 'object') {
      const u = extractAudioUrlFromObj(obj[key], depth + 1);
      if (u) return u;
    }
  }
  return null;
}

function extractPlaylistUrl(json) {
  if (!json || json.code !== 0) return null;
  const rawData = json.data;
  const items = Array.isArray(rawData) ? rawData : rawData ? [rawData] : [];
  for (const item of items) {
    const u = extractAudioUrlFromObj(item);
    if (u) return u;
  }
  return null;
}

// ─── HLS downloader (pure Node, tái sử dụng logic từ downloader.js) ──────────

async function fetchBuf(url, cookie) {
  const headers = { 'user-agent': 'Mozilla/5.0' };
  if (cookie) headers['cookie'] = cookie;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function fetchText(url, cookie) {
  const buf = await fetchBuf(url, cookie);
  return buf.toString('utf8');
}

function resolveUrl(rel, base) {
  if (/^https?:\/\//i.test(rel)) return rel;
  return new URL(rel, base).href;
}

function parseMasterPlaylist(text, baseUrl) {
  const lines = text.split('\n').map((l) => l.trim());
  const variants = [];
  let bw = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const m = line.match(/BANDWIDTH=(\d+)/i);
      bw = m ? parseInt(m[1]) : 0;
      continue;
    }
    if (!line.startsWith('#') && line.length > 0 && bw > 0) {
      variants.push({ url: resolveUrl(line, baseUrl), bandwidth: bw });
      bw = 0;
    }
  }
  if (variants.length === 0) {
    for (const line of lines) {
      if (!line.startsWith('#') && line.includes('.m3u8')) return resolveUrl(line, baseUrl);
    }
    return null;
  }
  return variants[0].url;
}

function parseChunklist(text, baseUrl) {
  const lines = text.split('\n').map((l) => l.trim());
  const segments = [];
  let currentKey = null;
  let seq = 0;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      seq = parseInt(line.split(':')[1]) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const method = (line.match(/METHOD=([^,\s]+)/i)?.[1] ?? 'NONE').toUpperCase();
      if (method === 'NONE') {
        currentKey = null;
      } else {
        const uri = line.match(/URI="([^"]+)"/i)?.[1] ?? null;
        const iv = line.match(/IV=0x([0-9a-fA-F]+)/i)?.[1]?.padStart(32, '0') ?? null;
        currentKey = { method, uri: uri ? resolveUrl(uri, baseUrl) : null, iv };
      }
      continue;
    }
    if (!line.startsWith('#') && line.length > 0) {
      segments.push({ url: resolveUrl(line, baseUrl), keyInfo: currentKey ? { ...currentKey } : null, seq });
      seq++;
    }
  }
  return segments;
}

const _keyCache = new Map();

async function fetchKey(uri, cookie) {
  if (_keyCache.has(uri)) return _keyCache.get(uri);
  const buf = await fetchBuf(uri, cookie);
  _keyCache.set(uri, buf);
  return buf;
}

function seqToIV(seq) {
  const iv = Buffer.alloc(16, 0);
  let n = seq;
  for (let i = 15; i >= 0; i--) {
    iv[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return iv;
}

function hexToIV(hex) {
  return Buffer.from(hex.padStart(32, '0'), 'hex');
}

async function decryptAES128(encBuf, keyBuf, ivBuf) {
  const key = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);
  const dec = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBuf }, key, encBuf);
  return Buffer.from(dec);
}

/**
 * Tải toàn bộ HLS stream → ghép thành Buffer AAC thô.
 */
async function downloadHLS(playlistUrl, cookie, onProgress) {
  const masterText = await fetchText(playlistUrl, cookie);
  const chunklistUrl = parseMasterPlaylist(masterText, playlistUrl) ?? playlistUrl;
  const chunklistText = await fetchText(chunklistUrl, cookie);
  const segments = parseChunklist(chunklistText, chunklistUrl);

  if (segments.length === 0) throw new Error('Không tìm thấy segment trong chunklist');

  const buffers = [];
  for (let i = 0; i < segments.length; i++) {
    onProgress?.(i + 1, segments.length);
    const seg = segments[i];
    const enc = await fetchBuf(seg.url, cookie);

    if (seg.keyInfo?.method === 'AES-128' && seg.keyInfo.uri) {
      const keyBuf = await fetchKey(seg.keyInfo.uri, cookie);
      const ivBuf = seg.keyInfo.iv ? hexToIV(seg.keyInfo.iv) : seqToIV(seg.seq);
      const dec = await decryptAES128(enc, keyBuf, ivBuf);
      buffers.push(dec);
    } else {
      buffers.push(enc);
    }
  }

  return Buffer.concat(buffers);
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function safeFileName(name) {
  return String(name || 'chapter')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function fmtDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${pad(s)}`;
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Args parser ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    chapters: null,
    cookie: null,
    outDir: './waka-audio',
    delay: 1500,
    from: 1,
    to: Infinity,
    resume: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--chapters' || a === '--input') && argv[i + 1]) { args.chapters = argv[++i]; continue; }
    if (a === '--cookie' && argv[i + 1]) { args.cookie = argv[++i]; continue; }
    if (a === '--out' && argv[i + 1]) { args.outDir = argv[++i]; continue; }
    if (a === '--delay' && argv[i + 1]) { args.delay = Number(argv[++i]); continue; }
    if (a === '--from' && argv[i + 1]) { args.from = Number(argv[++i]); continue; }
    if (a === '--to' && argv[i + 1]) { args.to = Number(argv[++i]); continue; }
    if (a === '--resume') { args.resume = true; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--help' || a === '-h') { printHelpAndExit(); }
  }
  return args;
}

function printHelpAndExit() {
  console.log(`
Waka Downloader v3.6 – Tải tất cả chương từ chapters.json

Cách dùng:
  node download-all-chapters.mjs --chapters <file.json> [options]

Tùy chọn:
  --chapters <file>   File chapters.json đã export từ extension    (bắt buộc)
  --cookie   <str>    Cookie từ browser (lấy từ F12 > Network)     (cần cho paid)
  --out      <dir>    Thư mục lưu audio (mặc định: ./waka-audio)
  --delay    <ms>     Nghỉ giữa mỗi chương, tránh bị block         (mặc định: 1500)
  --from     <n>      Bắt đầu từ chương thứ n (1-based)
  --to       <n>      Dừng ở chương thứ n
  --resume            Bỏ qua chương đã có file .aac, tải tiếp phần còn lại
  --dry-run           Chỉ in danh sách chương, không tải
  --help

Lấy cookie (QUAN TRỌNG – cần cho chương paid):
  1. Mở waka.vn → đăng nhập tài khoản có gói
  2. Vào trang sách → nhấn "Nghe" bất kỳ chương nào để trigger API
  3. F12 → tab Network → lọc "listNextBackFm" → click vào request đó
  4. Headers → Request Headers → tìm dòng "cookie:" → copy toàn bộ giá trị
  5. Paste vào --cookie "..." (giữ nguyên dấu ngoặc kép)

  Lưu ý: cookie có thời hạn ~24h, cần copy lại nếu bị lỗi 401/403

Ví dụ:
  node download-all-chapters.mjs \\
    --chapters "Logic_hoc_Phat_Giao_6052_chapters.json" \\
    --cookie "token=abc123; waka_uid=456" \\
    --out ./sach-audio \\
    --resume
`);
  process.exit(0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.chapters) {
    console.error('[v3.6] Thiếu --chapters. Dùng --help để xem hướng dẫn.');
    process.exit(1);
  }

  // Đọc chapters.json
  const chaptersPath = path.resolve(args.chapters);
  let chaptersData;
  try {
    const raw = await fs.readFile(chaptersPath, 'utf8');
    chaptersData = JSON.parse(raw);
  } catch (err) {
    console.error(`[v3.6] Không đọc được file: ${chaptersPath}\n  ${err.message}`);
    process.exit(1);
  }

  const allItems = Array.isArray(chaptersData.items) ? chaptersData.items : [];
  if (allItems.length === 0) {
    console.error('[v3.6] File chapters.json không có items nào.');
    process.exit(1);
  }

  const bookTitle = chaptersData.title || `content_${chaptersData.content_id}`;
  const contentId = chaptersData.content_id ?? chaptersData.items[0]?.content_id;

  if (!contentId) {
    console.error('[v3.6] Không tìm thấy content_id trong chapters.json.');
    process.exit(1);
  }

  // Sắp xếp theo order
  const sorted = [...allItems].sort((a, b) => {
    const ao = Number(a.order ?? 0);
    const bo = Number(b.order ?? 0);
    if (ao !== bo) return ao - bo;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
  });

  // Slice theo --from / --to
  const selected = sorted.slice(args.from - 1, args.to === Infinity ? undefined : args.to);

  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║  Waka Downloader v3.6.1                   ║`);
  console.log(`╚═══════════════════════════════════════════╝`);
  console.log(`📚 Sách   : ${bookTitle}`);
  console.log(`🆔 ID     : ${contentId}`);
  console.log(`📑 Tổng   : ${allItems.length} chương → tải ${selected.length} chương`);
  console.log(`📂 Output : ${path.resolve(args.outDir)}`);
  if (args.dryRun) console.log(`⚠️  Chế độ dry-run: chỉ liệt kê, không tải`);
  if (!args.cookie) console.log(`⚠️  Chưa có cookie – chương "paid" có thể thất bại`);
  console.log('');

  // Dry run: chỉ liệt kê
  if (args.dryRun) {
    selected.forEach((item, idx) => {
      const zone = item.zone === 'free' ? '🟢 free' : '🔴 paid';
      console.log(`  ${pad(idx + args.from, 3)}. [${zone}] ${item.name} (${fmtDuration(item.duration || 0)})`);
    });
    return;
  }

  await fs.mkdir(path.resolve(args.outDir), { recursive: true });

  // Log file
  const logPath = path.join(path.resolve(args.outDir), `download_log_${Date.now()}.txt`);
  const logLines = [`Waka Downloader v3.6 – ${new Date().toISOString()}`, `Sách: ${bookTitle} (${contentId})`, ''];

  const results = { ok: 0, skip: 0, fail: 0 };

  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    const chapterNum = args.from + i;
    const prefix = `[${pad(chapterNum)}/${pad(args.from + selected.length - 1)}]`;
    const safeName = safeFileName(`${pad(chapterNum, 3)}_${item.name}`);
    const outPath = path.join(path.resolve(args.outDir), `${safeName}.aac`);

    // Resume: bỏ qua nếu đã tồn tại
    if (args.resume) {
      try {
        await fs.access(outPath);
        console.log(`${prefix} ⏭️  Bỏ qua (đã có): ${item.name}`);
        results.skip++;
        logLines.push(`SKIP  ${safeName}.aac`);
        continue;
      } catch {
        // Chưa có → tải tiếp
      }
    }

    const zone = item.zone === 'free' ? '🟢' : '🔴';
    process.stdout.write(`${prefix} ${zone} Đang xử lý: ${item.name}...`);

    try {
      // 1. Fetch playlist URL qua listNextBackFm
      //    action=current → lấy đúng chương này
      //    action=next    → fallback (trả chương tiếp theo, nhưng đôi khi có audio_data)
      let playlistUrl = null;

      try {
        const jsonCurrent = await fetchChapterAudioInfo(contentId, item.id, args.cookie, 'current');
        playlistUrl = extractPlaylistUrl(jsonCurrent);
      } catch (err) {
        process.stdout.write(`\r${prefix} ${zone} [current failed: ${err.message}] `);
      }

      if (!playlistUrl) {
        try {
          const jsonNext = await fetchChapterAudioInfo(contentId, item.id, args.cookie, 'next');
          playlistUrl = extractPlaylistUrl(jsonNext);
        } catch (err) {
          // ignore, will throw below
        }
      }

      if (!playlistUrl) {
        throw new Error(
          'Không lấy được playlist URL. ' +
          'Nguyên nhân có thể: (1) cookie hết hạn – copy lại cookie mới từ F12; ' +
          '(2) chương "paid" – cần tài khoản có gói đọc; ' +
          '(3) thử mở chương đó trên waka.vn, nhấn "Nghe" 1 lần rồi chạy lại với --resume'
        );
      }

      // 2. Tải HLS
      let lastSeg = 0;
      const aacBuf = await downloadHLS(playlistUrl, args.cookie, (cur, total) => {
        if (cur !== lastSeg) {
          process.stdout.write(`\r${prefix} ${zone} Tải segment ${cur}/${total}... `);
          lastSeg = cur;
        }
      });

      // 3. Lưu file .aac
      await fs.writeFile(outPath, aacBuf);

      const size = fmtBytes(aacBuf.length);
      process.stdout.write(`\r${prefix} ${zone} ✅ ${item.name} (${size})\n`);
      results.ok++;
      logLines.push(`OK    ${safeName}.aac  ${size}`);
    } catch (err) {
      process.stdout.write(`\r${prefix} ${zone} ❌ ${item.name}\n`);
      console.error(`       Lỗi: ${err.message}`);
      results.fail++;
      logLines.push(`FAIL  ${safeName}.aac  – ${err.message}`);
    }

    // Delay giữa các chương (trừ chương cuối)
    if (i < selected.length - 1) {
      await sleep(args.delay);
    }
  }

  // Tổng kết
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`✅ Thành công : ${results.ok} chương`);
  if (results.skip > 0) console.log(`⏭️  Bỏ qua    : ${results.skip} chương (đã có)`);
  if (results.fail > 0) console.log(`❌ Thất bại  : ${results.fail} chương`);
  console.log(`📂 Lưu tại   : ${path.resolve(args.outDir)}`);

  // Ghi log
  logLines.push('');
  logLines.push(`Kết quả: OK=${results.ok} SKIP=${results.skip} FAIL=${results.fail}`);
  await fs.writeFile(logPath, logLines.join('\n') + '\n', 'utf8');
  console.log(`📋 Log       : ${logPath}`);

  if (results.fail > 0) {
    console.log('\n💡 Gợi ý với chương thất bại:');
    console.log('   1. Cập nhật --cookie (token có thể đã hết hạn)');
    console.log('   2. Mở chương đó trên waka.vn, nhấn "Nghe" rồi chạy lại với --resume');
    console.log('   3. Kiểm tra file log để xem chi tiết lỗi');
  }
}

main().catch((err) => {
  console.error('[v3.6] Lỗi nghiêm trọng:', err);
  process.exitCode = 1;
});
