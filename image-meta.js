// image-meta.js — removes metadata from customer photos (review photos) before they are saved.
// Phone photos carry EXIF/XMP: GPS position, time, camera serial numbers, sometimes the owner's
// name. The browser only re-encodes large photos, so the server strips every photo itself.
// No image library: the file is rebuilt from its own blocks, keeping only what draws the picture
// (and its colour profile). JPEG and WEBP keep the orientation as a minimal EXIF (one tag, nothing
// else), so a photo is shown the way it was taken. A file whose structure can't be read is refused (null), never saved as it came.

// ---------- JPEG ----------
// Kept: APP0 (JFIF), APP2 ICC_PROFILE (colours), APP14 (Adobe colour transform), every image segment.
// Dropped: APP1 (EXIF, XMP), the other APPn, COM, and anything after the end of the image.
// The Orientation tag (1–8) of EXIF data: TIFF, with or without the "Exif\0\0" prefix; 1 if none
function exifOrientation(exif) {
  const t = exif.toString('latin1', 0, 6) === 'Exif\0\0' ? exif.subarray(6) : exif;
  if (t.length < 8) return 1;
  const le = t.toString('latin1', 0, 2) === 'II';
  if (!le && t.toString('latin1', 0, 2) !== 'MM') return 1;
  const u16 = o => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = o => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return 1;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}
// Big-endian TIFF with one tag: Orientation
const orientationTiff = v => Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0, 0, 0, 0, 0]);
function orientationApp1(v) {
  const d = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), orientationTiff(v)]);
  return Buffer.concat([Buffer.from([0xff, 0xe1, (d.length + 2) >> 8, (d.length + 2) & 0xff]), d]);
}
function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = [buf.subarray(0, 2)];
  let orientation = 1;
  let pos = 2;
  let insertAt = 1;                               // where the orientation EXIF goes: after SOI (and JFIF)
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return null;
    let m = pos + 1;
    while (m < buf.length && buf[m] === 0xff) m++; // fill bytes
    if (m >= buf.length) return null;
    const marker = buf[m];
    pos = m + 1;
    if (marker === 0xd9) {                         // end of image: anything after it is dropped
      out.push(Buffer.from([0xff, 0xd9]));
      if (orientation !== 1) out.splice(insertAt, 0, orientationApp1(orientation));
      return Buffer.concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(Buffer.from([0xff, marker])); continue; }
    if (pos + 2 > buf.length) return null;
    const len = buf.readUInt16BE(pos);
    if (len < 2 || pos + len > buf.length) return null;
    const data = buf.subarray(pos + 2, pos + len);
    const seg = buf.subarray(m - 1, pos + len);
    pos += len;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe1) { if (orientation === 1 && data.toString('latin1', 0, 6) === 'Exif\0\0') orientation = exifOrientation(data); continue; }
    if (marker === 0xfe) continue;                 // COM
    if (isApp && !(marker === 0xe0 || marker === 0xee || (marker === 0xe2 && data.toString('latin1', 0, 12) === 'ICC_PROFILE\0'))) continue;
    out.push(seg);
    if (marker === 0xe0 && out.length === 2) insertAt = 2;
    if (marker === 0xda) {                         // start of scan: copy the compressed data up to the next marker
      let e = pos;
      while (e + 1 < buf.length && !(buf[e] === 0xff && buf[e + 1] !== 0x00 && !(buf[e + 1] >= 0xd0 && buf[e + 1] <= 0xd7) && buf[e + 1] !== 0xff)) e++;
      if (e + 1 >= buf.length) return null;        // no end of image
      out.push(buf.subarray(pos, e));
      pos = e;
    }
  }
  return null;
}

// ---------- PNG ----------
// Dropped: text chunks (tEXt, zTXt, iTXt), eXIf, tIME, and anything after IEND.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const out = [PNG_SIG];
  let pos = 8;
  let first = true;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (!/^[A-Za-z]{4}$/.test(type) || end > buf.length || (first && type !== 'IHDR')) return null;
    first = false;
    if (!PNG_DROP.has(type)) out.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  return null;
}

// ---------- WEBP ----------
// Kept: the image chunks (VP8, VP8L, VP8X, ALPH, ANIM, ANMF) and ICCP. Dropped: EXIF, XMP, others.
// An EXIF orientation comes back as a minimal EXIF chunk, only in an extended file (VP8X: the one
// kind that may carry EXIF). Chrome ignores it, other browsers may not: the photo shows as uploaded.
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
function stripWebp(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const end = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const out = [];
  let pos = 12;
  let image = false;
  let vp8x = null;
  let orientation = 1;
  while (pos + 8 <= end) {
    const type = buf.toString('latin1', pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    const next = pos + 8 + len + (len & 1);
    if (pos + 8 + len > end) return null;
    if (WEBP_KEEP.has(type)) {
      let chunk = buf.subarray(pos, Math.min(next, end));
      if (type === 'VP8X') { chunk = Buffer.from(chunk); chunk[8] &= ~0x0c; vp8x = chunk; }   // flags: no EXIF (0x08), no XMP (0x04)
      if (chunk.length & 1) chunk = Buffer.concat([chunk, Buffer.alloc(1)]);
      out.push(chunk);
      if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') image = true;
    } else if (type === 'EXIF' && orientation === 1) orientation = exifOrientation(buf.subarray(pos + 8, pos + 8 + len));
    pos = next;
  }
  if (!image) return null;
  if (vp8x && orientation !== 1) {
    vp8x[8] |= 0x08;
    const exif = orientationTiff(orientation);
    const head = Buffer.alloc(8); head.write('EXIF', 0, 'latin1'); head.writeUInt32LE(exif.length, 4);
    out.push(head, exif);                         // 26 bytes: no padding needed
  }
  const body = Buffer.concat(out);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

// The photo without metadata, or null when the file can't be read as that image type
function stripImageMeta(buf, ext) {
  try {
    if (ext === '.jpg') return stripJpeg(buf);
    if (ext === '.png') return stripPng(buf);
    if (ext === '.webp') return stripWebp(buf);
  } catch { /* broken file */ }
  return null;
}

module.exports = { stripImageMeta };
