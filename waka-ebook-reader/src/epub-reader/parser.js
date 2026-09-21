// js/parser.js
//
// Phân tích cấu trúc 1 file EPUB (đã giải nén qua ZipArchive):
// - META-INF/container.xml -> tìm file .opf
// - file .opf -> metadata, manifest, spine
// - toc.ncx (epub2) hoặc nav.xhtml (epub3) -> mục lục

function resolvePath(basePath, relativePath) {
  if (relativePath.startsWith("/")) return relativePath.slice(1);
  const baseParts = basePath.split("/");
  baseParts.pop(); // remove filename, keep directory
  const relParts = relativePath.split("/");
  for (const part of relParts) {
    if (part === "." || part === "") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("Không thể phân tích XML: " + err.textContent.slice(0, 200));
  return doc;
}

function titleFromFileName(fileName) {
  if (!fileName) return "";
  let name = fileName.replace(/\.epub$/i, "");
  name = name.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return name;
}

async function parseEpub(zip, fallbackFileName) {
  // 1. container.xml
  const containerXml = await zip.extractText("META-INF/container.xml");
  const containerDoc = parseXml(containerXml);
  const rootfileEl = containerDoc.querySelector("rootfile");
  if (!rootfileEl) throw new Error("Thiếu rootfile trong container.xml");
  const opfPath = rootfileEl.getAttribute("full-path");

  // 2. .opf
  const opfText = await zip.extractText(opfPath);
  const opfDoc = parseXml(opfText);
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  const getTag = (parent, tag) => {
    const el = parent.getElementsByTagName(tag)[0] || parent.getElementsByTagNameNS("*", tag)[0];
    return el ? el.textContent.trim() : "";
  };

  const metadataEl = opfDoc.getElementsByTagName("metadata")[0];
  const rawTitle = metadataEl ? (getTag(metadataEl, "dc:title") || getTag(metadataEl, "title")) : "";
  const title = rawTitle || titleFromFileName(fallbackFileName) || "Không tên";
  const creator = metadataEl ? (getTag(metadataEl, "dc:creator") || getTag(metadataEl, "creator")) : "";
  const language = metadataEl ? (getTag(metadataEl, "dc:language") || getTag(metadataEl, "language")) : "";
  const publisher = metadataEl ? (getTag(metadataEl, "dc:publisher") || getTag(metadataEl, "publisher")) : "";
  const description = metadataEl ? (getTag(metadataEl, "dc:description") || getTag(metadataEl, "description")) : "";
  const rights = metadataEl ? (getTag(metadataEl, "dc:rights") || getTag(metadataEl, "rights")) : "";
  const identifier = metadataEl ? (getTag(metadataEl, "dc:identifier") || getTag(metadataEl, "identifier")) : "";
  const pubDateRaw = metadataEl ? (getTag(metadataEl, "dc:date") || getTag(metadataEl, "date")) : "";  const pubDate = (pubDateRaw.match(/^\d{4}(-\d{2}(-\d{2})?)?/) || [""])[0];
  const subjects = metadataEl
    ? Array.from(metadataEl.getElementsByTagName("dc:subject"))
        .concat(Array.from(metadataEl.getElementsByTagNameNS("*", "subject")))
        .map((n) => n.textContent.trim())
        .filter(Boolean)
    : [];
  const subject = Array.from(new Set(subjects)).join(", ");

  // Bộ sách — Calibre: <meta name="calibre:series" content="…"/> · EPUB3: belongs-to-collection + group-position
  let series = "";
  let seriesIndex = 0;
  if (metadataEl) {
    const metas = Array.from(new Set([
      ...Array.from(metadataEl.getElementsByTagName("meta")),
      ...Array.from(metadataEl.getElementsByTagNameNS("*", "meta")),
    ]));
    for (const m of metas) {
      const name = m.getAttribute("name");
      const prop = m.getAttribute("property");
      if (name === "calibre:series" && !series) series = (m.getAttribute("content") || "").trim();
      else if (name === "calibre:series_index" && !seriesIndex) seriesIndex = parseFloat(m.getAttribute("content")) || 0;
      else if (prop === "belongs-to-collection" && !series) series = (m.textContent || "").trim();
      else if (prop === "group-position" && !seriesIndex) seriesIndex = parseFloat(m.textContent) || 0;
    }
  }

  // unique-identifier "thật" theo khai báo <package unique-identifier="..."> — dùng để
  // tính khoá giải mã font obfuscation (IDPF/Adobe), khác với "identifier" hiển thị ở
  // trên (vốn chỉ lấy đại dc:identifier đầu tiên, có thể không phải unique-identifier).
  const packageEl = opfDoc.documentElement;
  const uniqueIdAttr = packageEl ? packageEl.getAttribute("unique-identifier") : null;
  let uniqueIdentifierRaw = "";
  if (metadataEl) {
    const idEls = Array.from(metadataEl.getElementsByTagName("dc:identifier"))
      .concat(Array.from(metadataEl.getElementsByTagNameNS("*", "identifier")));
    let idTarget = null;
    if (uniqueIdAttr) idTarget = idEls.find((n) => n.getAttribute("id") === uniqueIdAttr);
    if (!idTarget) idTarget = idEls[0];
    uniqueIdentifierRaw = idTarget ? idTarget.textContent.trim() : "";
  }

  // manifest: id -> {href, mediaType, properties}
  const manifest = new Map();
  const manifestItems = opfDoc.getElementsByTagName("item");
  for (const item of manifestItems) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type") || "";
    const properties = item.getAttribute("properties") || "";
    const fullPath = resolvePath(opfPath, href);
    manifest.set(id, { id, href, fullPath, mediaType, properties });
  }

  // spine: ordered list of manifest ids
  const spineEl = opfDoc.getElementsByTagName("spine")[0];
  const spine = [];
  if (spineEl) {
    const itemrefs = spineEl.getElementsByTagName("itemref");
    for (const ref of itemrefs) {
      const idref = ref.getAttribute("idref");
      const linear = ref.getAttribute("linear");
      if (linear === "no") continue;
      const manifestItem = manifest.get(idref);
      if (manifestItem) spine.push(manifestItem);
    }
  }

  // cover image (epub3 properties="cover-image" or epub2 meta name="cover")
  let coverPath = null;
  for (const item of manifest.values()) {
    if (item.properties.includes("cover-image")) {
      coverPath = item.fullPath;
      break;
    }
  }
  if (!coverPath && metadataEl) {
    const metaEls = metadataEl.getElementsByTagName("meta");
    for (const m of metaEls) {
      if (m.getAttribute("name") === "cover") {
        const coverId = m.getAttribute("content");
        const coverItem = manifest.get(coverId);
        if (coverItem) coverPath = coverItem.fullPath;
        break;
      }
    }
  }
  // fallback: nhiều epub (đặc biệt từ công cụ export đơn giản) không khai báo
  // cover-image chuẩn — thử tìm ảnh đầu tiên trong vài trang đầu của spine.
  if (!coverPath && spine.length) {
    coverPath = await findFallbackCover(zip, spine);
  }

  // 3. Table of contents
  let toc = [];
  const navItem = Array.from(manifest.values()).find((i) => i.properties.includes("nav"));
  const ncxId = spineEl ? spineEl.getAttribute("toc") : null;
  const ncxItem = ncxId
    ? manifest.get(ncxId)
    : Array.from(manifest.values()).find((i) => i.mediaType === "application/x-dtbncx+xml");

  if (navItem) {
    try {
      toc = await parseNavToc(zip, navItem.fullPath);
    } catch (err) {
      console.warn("[EPUB Parser] Không đọc được nav XHTML, thử toc.ncx:", err);
      toc = [];
    }
  }
  if ((!toc || !toc.length) && ncxItem) {
    toc = await parseNcxToc(zip, ncxItem.fullPath);
  }

  // 4. META-INF/encryption.xml — danh sách resource bị obfuscate (thường là font nhúng)
  // theo chuẩn IDPF hoặc Adobe, cần giải mã trước khi dùng chứ không thể tạo Blob thẳng
  // từ bytes gốc.
  const encryptedResources = await parseEncryptionXml(zip);

  return {
    title: title || "Không tên",
    creator: creator || "Không rõ tác giả",
    language,
    publisher,
    description,
    rights,
    identifier,
    uniqueIdentifierRaw,
    pubDate,
    subject,
    series,
    seriesIndex,
    manifest,
    spine,
    coverPath,
    toc,
    opfDir,
    encryptedResources,
  };
}

/**
 * Đọc META-INF/encryption.xml (nếu có) và trả về Map<fullPath, "idpf"|"adobe">
 * cho các resource (thường là font) bị obfuscate theo 2 thuật toán phổ biến:
 * - IDPF:   Algorithm URI = http://www.idpf.org/2008/embedding
 * - Adobe:  Algorithm URI = http://ns.adobe.com/pdf/enc#RC
 * Đường dẫn trong CipherReference/@URI tính từ gốc container (giống full-path của
 * <rootfile>), không phải tương đối theo .opf, nên dùng thẳng không cần resolvePath.
 */
async function parseEncryptionXml(zip) {
  const map = new Map();
  if (!zip.hasFile("META-INF/encryption.xml")) return map;

  let text;
  try { text = await zip.extractText("META-INF/encryption.xml"); } catch { return map; }

  let doc;
  try { doc = parseXml(text); } catch { return map; }

  const encDataEls = Array.from(doc.getElementsByTagName("EncryptedData"))
    .concat(Array.from(doc.getElementsByTagNameNS("*", "EncryptedData")));

  for (const encData of encDataEls) {
    const algoEl = encData.getElementsByTagName("EncryptionMethod")[0] ||
      encData.getElementsByTagNameNS("*", "EncryptionMethod")[0];
    const algoUri = algoEl ? algoEl.getAttribute("Algorithm") : "";

    let algo = null;
    if (algoUri === "http://www.idpf.org/2008/embedding") algo = "idpf";
    else if (algoUri === "http://ns.adobe.com/pdf/enc#RC") algo = "adobe";
    if (!algo) continue; // thuật toán không nhận diện được — bỏ qua, không đụng vào bytes

    const cipherRefEl = encData.getElementsByTagName("CipherReference")[0] ||
      encData.getElementsByTagNameNS("*", "CipherReference")[0];
    const uri = cipherRefEl ? cipherRefEl.getAttribute("URI") : "";
    if (!uri) continue;

    const path = decodeURIComponent(uri).replace(/^\/+/, "");
    map.set(path, algo);
  }

  return map;
}

async function findFallbackCover(zip, spine) {
  const isImagePath = (p) => /\.(png|jpe?g|gif|webp)$/i.test(p);
  const limit = Math.min(3, spine.length);
  for (let i = 0; i < limit; i++) {
    const item = spine[i];
    if (!zip.hasFile(item.fullPath)) continue;
    let text;
    try { text = await zip.extractText(item.fullPath); } catch { continue; }
    let doc;
    try {
      doc = parseXml(text);
      if (doc.querySelector("parsererror")) doc = new DOMParser().parseFromString(text, "text/html");
    } catch {
      doc = new DOMParser().parseFromString(text, "text/html");
    }
    const img = doc.querySelector("img[src]");
    if (img) {
      const full = resolvePath(item.fullPath, img.getAttribute("src"));
      if (isImagePath(full) && zip.hasFile(full)) return full;
    }
    const svgImg = doc.querySelector("image");
    if (svgImg) {
      const href = svgImg.getAttribute("href") || svgImg.getAttribute("xlink:href");
      if (href) {
        const full = resolvePath(item.fullPath, href);
        if (isImagePath(full) && zip.hasFile(full)) return full;
      }
    }
  }
  return null;
}

async function parseNavToc(zip, navPath) {
  const text = await zip.extractText(navPath);
  let doc;
  try {
    doc = parseXml(text);
  } catch (err) {
    doc = new DOMParser().parseFromString(text, "text/html");
  }
  const navEl =
    Array.from(doc.getElementsByTagName("nav")).find(
      (n) => n.getAttribute("epub:type") === "toc" || n.getAttribute("type") === "toc"
    ) || doc.getElementsByTagName("nav")[0];
  if (!navEl) return [];

  function walkList(listEl) {
    const items = [];
    for (const li of Array.from(listEl.children).filter((c) => c.tagName.toLowerCase() === "li")) {
      const a = li.querySelector("a, span");
      const label = a ? a.textContent.trim() : "";
      const href = a && a.getAttribute("href") ? resolvePath(navPath, a.getAttribute("href")) : null;
      const childOl = li.querySelector("ol");
      const children = childOl ? walkList(childOl) : [];
      items.push({ label, href, children });
    }
    return items;
  }

  const topOl = navEl.querySelector("ol");
  return topOl ? walkList(topOl) : [];
}

async function parseNcxToc(zip, ncxPath) {
  const text = await zip.extractText(ncxPath);
  const doc = parseXml(text);
  const navMap = doc.getElementsByTagName("navMap")[0];
  if (!navMap) return [];

  function walkNavPoints(parentEl) {
    const items = [];
    for (const navPoint of Array.from(parentEl.children).filter((c) => c.tagName === "navPoint")) {
      const labelEl = navPoint.getElementsByTagName("text")[0];
      const contentEl = navPoint.getElementsByTagName("content")[0];
      const label = labelEl ? labelEl.textContent.trim() : "";
      const src = contentEl ? contentEl.getAttribute("src") : null;
      const href = src ? resolvePath(ncxPath, src) : null;
      const children = walkNavPoints(navPoint);
      items.push({ label, href, children });
    }
    return items;
  }

  return walkNavPoints(navMap);
}

window.parseEpub = parseEpub;
window.resolvePath = resolvePath;
