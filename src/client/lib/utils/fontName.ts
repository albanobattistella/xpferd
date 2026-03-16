/**
 * Extracts the font family name from an OpenType/TrueType binary buffer by
 * parsing the 'name' table. Returns null if parsing fails or the format is
 * unrecognised — callers should fall back to the filename in that case.
 *
 * Priority: Windows name ID 16 (Typographic Family) → ID 1 (Font Family) →
 *           Mac Roman equivalents. Weight/style descriptors like "Book" or
 *           "Bold" are intentionally excluded by avoiding name ID 4 (Full Name).
 */
export function extractFontName(buffer: ArrayBuffer): string | null {
  try {
    const view = new DataView(buffer);
    if (buffer.byteLength < 12) return null;

    // Validate sfVersion signature
    const sig = view.getUint32(0, false);
    if (sig !== 0x00010000 && sig !== 0x4F54544F && sig !== 0x74727565) return null;

    // Scan table directory for the 'name' table
    const numTables = view.getUint16(4, false);
    let nameOffset = -1;
    for (let i = 0; i < numTables; i++) {
      const base = 12 + i * 16;
      if (base + 16 > buffer.byteLength) break;
      const tag =
        String.fromCharCode(view.getUint8(base)) +
        String.fromCharCode(view.getUint8(base + 1)) +
        String.fromCharCode(view.getUint8(base + 2)) +
        String.fromCharCode(view.getUint8(base + 3));
      if (tag === 'name') {
        nameOffset = view.getUint32(base + 8, false);
        break;
      }
    }
    if (nameOffset < 0) return null;

    const count = view.getUint16(nameOffset + 2, false);
    const storageOffset = view.getUint16(nameOffset + 4, false);
    const strBase = nameOffset + storageOffset;

    // name ID 16 = Typographic Family Name (preferred, no weight suffix)
    // name ID 1  = Font Family Name (fallback)
    let winTypo: string | null = null;
    let winFamily: string | null = null;
    let macTypo: string | null = null;
    let macFamily: string | null = null;

    for (let i = 0; i < count; i++) {
      const nr = nameOffset + 6 + i * 12;
      if (nr + 12 > buffer.byteLength) break;
      const platformID = view.getUint16(nr, false);
      const encodingID = view.getUint16(nr + 2, false);
      const nameID = view.getUint16(nr + 6, false);
      const length = view.getUint16(nr + 8, false);
      const offset = view.getUint16(nr + 10, false);

      if (nameID !== 1 && nameID !== 16) continue;

      if (platformID === 3 && encodingID === 1) {
        // Windows Unicode BMP (UTF-16 BE)
        let str = '';
        for (let j = 0; j < length; j += 2) {
          str += String.fromCodePoint(view.getUint16(strBase + offset + j, false));
        }
        if (nameID === 16 && !winTypo) winTypo = str;
        if (nameID === 1 && !winFamily) winFamily = str;
      } else if (platformID === 1 && encodingID === 0) {
        // Mac Roman
        let str = '';
        for (let j = 0; j < length; j++) {
          str += String.fromCharCode(view.getUint8(strBase + offset + j));
        }
        if (nameID === 16 && !macTypo) macTypo = str;
        if (nameID === 1 && !macFamily) macFamily = str;
      }
    }

    return winTypo ?? winFamily ?? macTypo ?? macFamily ?? null;
  } catch {
    return null;
  }
}

/** Converts an ArrayBuffer to a base64 string in chunks to avoid stack overflow. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
