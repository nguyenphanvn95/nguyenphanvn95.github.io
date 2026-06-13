#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import process from 'process';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ENDPOINT_RE = /https:\/\/beta-api\.waka\.vn\/fm\/(?:getListAudioFile|listNextBackFm)[^"'`\s)\\]+/g;

function parseArgs(argv) {
  const args = {
    input: null,
    url: [],
    outDir: process.cwd(),
    contentId: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      args.input = argv[++i];
      continue;
    }
    if (arg === '--url' && argv[i + 1]) {
      args.url.push(argv[++i]);
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      args.outDir = argv[++i];
      continue;
    }
    if (arg === '--content-id' && argv[i + 1]) {
      args.contentId = String(argv[++i]);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    }
  }

  return args;
}

function printHelpAndExit() {
  console.log([
    'Usage:',
    '  node export-audio-chapters.mjs --input pasted-text.txt',
    '  node export-audio-chapters.mjs --url "<request-url>"',
    '',
    'Options:',
    '  --input <file>      DevTools pasted text or a text file containing requests',
    '  --url <url>         One or more direct Waka API request URLs',
    '  --out <dir>         Output directory for JSON/CSV files',
    '  --content-id <id>   Optional filter for a single audiobook content_id',
  ].join('\n'));
  process.exit(0);
}

function readUrlsFromText(text) {
  const urls = new Set();
  for (const match of text.matchAll(ENDPOINT_RE)) {
    urls.add(match[0]);
  }
  return [...urls];
}

function parseQuery(url) {
  const u = new URL(url);
  return Object.fromEntries(u.searchParams.entries());
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeItem(item, meta, source) {
  if (!item || typeof item !== 'object') return null;

  const id = item.id ?? item.audio_file_id ?? item.chapter_id ?? null;
  if (id == null) return null;

  return {
    id: String(id),
    audio_id: item.audio_id ?? meta.content_id ?? null,
    content_id: meta.content_id ? Number(meta.content_id) : null,
    source,
    order: toInt(item.order) ?? 0,
    name: item.name ?? '',
    description: item.description ?? '',
    zone: item.zone ?? '',
    thumb: item.thumb ?? '',
    duration: toInt(item.duration) ?? 0,
    created_time: item.created_time ?? '',
    content_type: item.content_type ?? '',
    parent_type: item.parent_type ?? '',
    parent_name: item.parent_name ?? '',
    content_detail_url: item.content_detail_url ?? '',
    audio_data: Array.isArray(item.audio_data) ? item.audio_data : [],
    is_summary: item.is_summary ?? null,
    is_download: item.is_download ?? null,
    read: item.read ?? null,
    raw: item,
  };
}

function normalizeResponse(json, url) {
  if (!json || typeof json !== 'object') return null;
  if (json.code !== 0) return null;

  const meta = parseQuery(url);
  const source = url.includes('/getListAudioFile') ? 'getListAudioFile' : 'listNextBackFm';
  const raw = json.data;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const normalizedItems = items.map((item) => normalizeItem(item, meta, source)).filter(Boolean);

  if (!normalizedItems.length) return null;

  return {
    content_id: meta.content_id ? Number(meta.content_id) : null,
    chapter_id: meta.chapter_id ? Number(meta.chapter_id) : null,
    action: meta.action ?? null,
    page_no: meta.page_no ? Number(meta.page_no) : null,
    page_size: meta.page_size ? Number(meta.page_size) : null,
    total: toInt(json.total) ?? normalizedItems.length,
    source,
    url,
    items: normalizedItems,
  };
}

function mergeGroups(groups, payload) {
  const contentId = payload.content_id ?? payload.items[0]?.content_id ?? null;
  if (contentId == null) return;

  const key = String(contentId);
  const group = groups.get(key) || {
    content_id: contentId,
    title: '',
    sourceUrls: [],
    items: new Map(),
  };

  if (payload.url && !group.sourceUrls.includes(payload.url)) {
    group.sourceUrls.push(payload.url);
  }

  for (const item of payload.items) {
    if (item.parent_name && !group.title) group.title = item.parent_name;
    if (item.name && !group.title && payload.source === 'getListAudioFile') group.title = item.name;
    group.items.set(item.id, item);
  }

  groups.set(key, group);
}

function sortItems(items) {
  return items.sort((a, b) => {
    const ao = a.order ?? 0;
    const bo = b.order ?? 0;
    if (ao !== bo) return ao - bo;
    const aid = Number(a.id);
    const bid = Number(b.id);
    if (Number.isFinite(aid) && Number.isFinite(bid) && aid !== bid) return aid - bid;
    return String(a.id).localeCompare(String(b.id));
  });
}

function safeFileName(name) {
  return String(name || 'waka-audio')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function itemToCsvRow(item) {
  const columns = [
    item.content_id,
    item.id,
    item.order,
    item.name,
    item.duration,
    item.zone,
    item.parent_name,
    item.content_type,
    item.parent_type,
    item.content_detail_url,
    item.source,
    item.description,
  ];
  return columns.map(csvEscape).join(',');
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
    },
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response for ${url}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inputs = [];
  if (args.input) {
    const maybePath = path.resolve(args.input);
    const fileText = await fs.readFile(maybePath, 'utf8');
    inputs.push(...readUrlsFromText(fileText));
  }

  inputs.push(...args.url);

  const urls = [...new Set(inputs.filter(Boolean))];
  if (!urls.length) {
    printHelpAndExit();
  }

  const groups = new Map();
  for (const url of urls) {
    if (!url.includes('/fm/getListAudioFile') && !url.includes('/fm/listNextBackFm')) continue;

    const meta = parseQuery(url);
    if (args.contentId && String(meta.content_id ?? '') !== args.contentId) continue;

    console.log(`[waka-export] fetching ${meta.content_id ?? 'unknown'} :: ${url}`);
    try {
      const json = await fetchJson(url);
      const payload = normalizeResponse(json, url);
      if (!payload) {
        console.warn(`[waka-export] skipped non-success payload for ${url}`);
        continue;
      }
      mergeGroups(groups, payload);
    } catch (err) {
      console.warn(`[waka-export] failed ${url}`);
      console.warn(`  ${err.message}`);
    }
  }

  await fs.mkdir(args.outDir, { recursive: true });

  if (!groups.size) {
    console.warn('[waka-export] no chapter payloads were collected.');
    return;
  }

  for (const group of groups.values()) {
    const items = sortItems([...group.items.values()]);
    const title = group.title || `content_${group.content_id}`;
    const base = safeFileName(title || `content_${group.content_id}`);
    const stamp = new Date().toISOString();

    const jsonOut = {
      content_id: group.content_id,
      title,
      count: items.length,
      exportedAt: stamp,
      sourceUrls: group.sourceUrls,
      items,
    };

    const jsonPath = path.join(args.outDir, `${base}_${group.content_id}_chapters.json`);
    const csvPath = path.join(args.outDir, `${base}_${group.content_id}_chapters.csv`);

    const csvLines = [
      [
        'content_id',
        'id',
        'order',
        'name',
        'duration',
        'zone',
        'parent_name',
        'content_type',
        'parent_type',
        'content_detail_url',
        'source',
        'description',
      ].join(','),
      ...items.map(itemToCsvRow),
    ];

    await fs.writeFile(jsonPath, `${JSON.stringify(jsonOut, null, 2)}\n`, 'utf8');
    await fs.writeFile(csvPath, `${csvLines.join('\n')}\n`, 'utf8');

    console.log(`[waka-export] wrote ${items.length} chapters`);
    console.log(`  JSON: ${jsonPath}`);
    console.log(`  CSV : ${csvPath}`);
  }
}

main().catch((err) => {
  console.error('[waka-export] fatal:', err);
  process.exitCode = 1;
});
