// js/zip.js
//
// Bộ đọc ZIP tối giản, tự viết, không phụ thuộc thư viện ngoài.
// Đủ dùng để đọc các file .epub (vốn chỉ là 1 file ZIP) hoàn toàn offline.
// Hỗ trợ 2 kiểu nén thường gặp trong epub: STORE (0) và DEFLATE (8),
// dùng DecompressionStream('deflate-raw') có sẵn trong Chrome để giải nén.

const ZipSignature = {
  LOCAL_FILE_HEADER: 0x04034b50,
  CENTRAL_DIRECTORY: 0x02014b50,
  END_OF_CENTRAL_DIRECTORY: 0x06054b50,
};

class ZipArchive {
  /**
   * @param {ArrayBuffer} buffer
   */
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    /** @type {Map<string, {name:string, method:number, compSize:number, size:number, localHeaderOffset:number}>} */
    this.entries = new Map();
  }

  static async open(buffer) {
    const zip = new ZipArchive(buffer);
    zip._readCentralDirectory();
    return zip;
  }

  _findEndOfCentralDirectory() {
    const bytes = this.bytes;
    // EOCD nằm ở cuối file, tối đa cách cuối 22 + 65535 byte (comment field)
    const minPos = Math.max(0, bytes.length - (22 + 65535));
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (this.view.getUint32(i, true) === ZipSignature.END_OF_CENTRAL_DIRECTORY) {
        return i;
      }
    }
    throw new Error("Không tìm thấy cấu trúc ZIP hợp lệ (EOCD) trong file.");
  }

  _readCentralDirectory() {
    const eocdOffset = this._findEndOfCentralDirectory();
    const view = this.view;

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirSize = view.getUint32(eocdOffset + 12, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);

    let pos = centralDirOffset;
    const decoder = new TextDecoder("utf-8");

    for (let i = 0; i < totalEntries; i++) {
      const sig = view.getUint32(pos, true);
      if (sig !== ZipSignature.CENTRAL_DIRECTORY) {
        throw new Error("Cấu trúc ZIP central directory không hợp lệ.");
      }
      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const size = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localHeaderOffset = view.getUint32(pos + 42, true);

      const nameBytes = this.bytes.subarray(pos + 46, pos + 46 + nameLen);
      const name = decoder.decode(nameBytes);

      this.entries.set(name, {
        name,
        method,
        compSize,
        size,
        localHeaderOffset,
      });

      pos += 46 + nameLen + extraLen + commentLen;
    }

    if (pos - centralDirOffset > centralDirSize + 4096) {
      // sanity guard only, không throw cứng vì vài epub có metadata lệch nhẹ
      console.warn("ZIP central directory size mismatch, file có thể không chuẩn.");
    }
  }

  hasFile(name) {
    return this.entries.has(name);
  }

  fileNames() {
    return Array.from(this.entries.keys());
  }

  /**
   * Trích xuất 1 file trong zip, trả về Uint8Array đã giải nén.
   */
  async extract(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Không tìm thấy "${name}" trong file epub.`);

    const view = this.view;
    const lh = entry.localHeaderOffset;
    if (view.getUint32(lh, true) !== ZipSignature.LOCAL_FILE_HEADER) {
      throw new Error(`Local file header không hợp lệ cho "${name}".`);
    }
    const nameLen = view.getUint16(lh + 26, true);
    const extraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;
    const compressed = this.bytes.subarray(dataStart, dataStart + entry.compSize);

    if (entry.method === 0) {
      return compressed.slice();
    }
    if (entry.method === 8) {
      return await inflateRaw(compressed);
    }
    throw new Error(`Phương thức nén (${entry.method}) chưa được hỗ trợ cho "${name}".`);
  }

  async extractText(name) {
    const bytes = await this.extract(name);
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Giải nén raw deflate bằng DecompressionStream có sẵn của trình duyệt.
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks = [];
  let total = 0;
  const reader = ds.readable.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

window.ZipArchive = ZipArchive;
