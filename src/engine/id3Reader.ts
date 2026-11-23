export interface ParsedId3Metadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  coverObjectUrl?: string;
}

function decodeTextFrame(bytes: Uint8Array): string {
  if (bytes.length < 2) return "";
  const encoding = bytes[0];
  const body = bytes.slice(1);
  try {
    if (encoding === 0) {
      return new TextDecoder("iso-8859-1").decode(body).replace(/\0+$/, "").trim();
    }
    if (encoding === 1 || encoding === 2) {
      return new TextDecoder("utf-16").decode(body).replace(/\0+$/, "").trim();
    }
    return new TextDecoder("utf-8").decode(body).replace(/\0+$/, "").trim();
  } catch {
    return "";
  }
}

function parseApicFrame(bytes: Uint8Array): string | undefined {
  if (bytes.length < 10) return undefined;
  let pos = 1; // skip text encoding
  let mimeEnd = pos;
  while (mimeEnd < bytes.length && bytes[mimeEnd] !== 0) mimeEnd++;
  const mime = new TextDecoder("ascii").decode(bytes.slice(pos, mimeEnd)) || "image/jpeg";
  pos = mimeEnd + 2; // skip null + picture type byte

  const enc = bytes[0];
  if (enc === 1 || enc === 2) {
    while (pos + 1 < bytes.length && !(bytes[pos] === 0 && bytes[pos + 1] === 0)) {
      pos += 2;
    }
    pos += 2;
  } else {
    while (pos < bytes.length && bytes[pos] !== 0) pos++;
    pos += 1;
  }

  if (pos >= bytes.length) return undefined;
  const imgBytes = bytes.slice(pos);
  if (imgBytes.length < 16) return undefined;
  const blob = new Blob([imgBytes], { type: mime });
  return URL.createObjectURL(blob);
}

export async function readBasicId3(file: File): Promise<ParsedId3Metadata> {
  const result: ParsedId3Metadata = {};
  try {
    const headerBuf = await file.slice(0, 10).arrayBuffer();
    const hdr = new Uint8Array(headerBuf);
    if (hdr[0] !== 0x49 || hdr[1] !== 0x44 || hdr[2] !== 0x33) {
      return result; // Not ID3v2
    }
    const version = hdr[3];
    const tagSize =
      ((hdr[6] & 0x7f) << 21) |
      ((hdr[7] & 0x7f) << 14) |
      ((hdr[8] & 0x7f) << 7) |
      (hdr[9] & 0x7f);

    const readLen = Math.min(tagSize + 10, 1024 * 1024 * 2);
    const tagBuf = await file.slice(10, readLen).arrayBuffer();
    const data = new Uint8Array(tagBuf);
    let offset = 0;

    while (offset + 10 < data.length) {
      const frameId = String.fromCharCode(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      );
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      let frameSize = 0;
      if (version >= 4) {
        frameSize =
          ((data[offset + 4] & 0x7f) << 21) |
          ((data[offset + 5] & 0x7f) << 14) |
          ((data[offset + 6] & 0x7f) << 7) |
          (data[offset + 7] & 0x7f);
      } else {
        frameSize =
          (data[offset + 4] << 24) |
          (data[offset + 5] << 16) |
          (data[offset + 6] << 8) |
          data[offset + 7];
      }

      if (frameSize <= 0 || offset + 10 + frameSize > data.length) break;
      const payload = data.slice(offset + 10, offset + 10 + frameSize);

      if (frameId === "TIT2") result.title = decodeTextFrame(payload);
      else if (frameId === "TPE1") result.artist = decodeTextFrame(payload);
      else if (frameId === "TALB") result.album = decodeTextFrame(payload);
      else if (frameId === "TCON") result.genre = decodeTextFrame(payload);
      else if (frameId === "APIC" && !result.coverObjectUrl) {
        result.coverObjectUrl = parseApicFrame(payload);
      }

      offset += 10 + frameSize;
    }
  } catch {
    return result;
  }
  return result;
}
