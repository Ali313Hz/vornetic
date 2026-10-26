// test/image-meta.test.js — review photos lose their metadata (EXIF/XMP: GPS position, time,
// camera) before they are saved; the picture itself and a JPEG's orientation stay.
const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { stripImageMeta } = require('../image-meta');

const SECRET = 'GPS 40.4168N 3.7038W Lucia-iPhone SN123';
const has = (buf, s) => buf.includes(Buffer.from(s, 'latin1'));

// ---------- builders for small but well-formed files ----------
function crc32(b) {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function pngChunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}
// a real 1×1 green PNG; extra chunks go before IDAT
function png(extra = []) {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), ...extra,
    pngChunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 200, 0]))), pngChunk('IEND', Buffer.alloc(0))]);
}
const seg = (marker, data) => Buffer.concat([Buffer.from([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff]), data]);
// "Exif\0\0" + little-endian TIFF: Orientation, then a text tag holding the secret
function exifApp1(orientation) {
  const t = Buffer.alloc(8 + 2 + 2 * 12 + 4 + SECRET.length + 1);
  t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4); t.writeUInt16LE(2, 8);
  t.writeUInt16LE(0x0112, 10); t.writeUInt16LE(3, 12); t.writeUInt32LE(1, 14); t.writeUInt16LE(orientation, 18);
  t.writeUInt16LE(0x010f, 22); t.writeUInt16LE(2, 24); t.writeUInt32LE(SECRET.length + 1, 26); t.writeUInt32LE(38, 30);
  t.write(SECRET, 38, 'latin1');
  return seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]));
}
// the segments of a baseline JPEG (tables and scan data are placeholders: only the structure matters here)
function jpeg({ orientation = 1, trailer = '' } = {}) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    exifApp1(orientation),
    seg(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>' + SECRET + '</x:xmpmeta>', 'latin1')),
    seg(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01colour-profile', 'latin1')),
    seg(0xed, Buffer.from('Photoshop 3.0\0' + SECRET, 'latin1')),
    seg(0xfe, Buffer.from('comment ' + SECRET, 'latin1')),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    seg(0xc4, Buffer.alloc(20, 2)),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),    // scan data with a stuffed 0xFF and a restart marker
    Buffer.from([0xff, 0xd9]),
    Buffer.from(trailer, 'latin1'),
  ]);
}
const SCAN = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9]);

function riffChunk(type, data) {
  const h = Buffer.alloc(8); h.write(type, 0, 'latin1'); h.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, data, Buffer.alloc(data.length & 1)]);
}
function webp(chunks) {
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(12); h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(body.length + 4, 4); h.write('WEBP', 8, 'latin1');
  return Buffer.concat([h, body]);
}

test('JPEG: EXIF, XMP, Photoshop data, comments and data after the image are removed; picture and colours stay', () => {
  const src = jpeg({ trailer: 'SEFT ' + SECRET });
  assert.ok(has(src, SECRET));
  const out = stripImageMeta(src, '.jpg');
  assert.ok(out, 'readable');
  assert.ok(!has(out, SECRET), 'no metadata left');
  assert.ok(!has(out, 'Exif\0\0'), 'orientation 1 (normal): no EXIF at all');
  assert.ok(!has(out, 'http://ns.adobe.com/xap'));
  assert.ok(has(out, 'JFIF\0') && has(out, 'ICC_PROFILE\0'), 'JFIF header and colour profile kept');
  assert.ok(out.subarray(-SCAN.length).equals(SCAN), 'scan data unchanged, file ends at the end of the image');
  assert.ok(out.subarray(0, 2).equals(Buffer.from([0xff, 0xd8])));
});

test('JPEG: a rotated phone photo keeps only its orientation, so it is not shown sideways', () => {
  const out = stripImageMeta(jpeg({ orientation: 6 }), '.jpg');
  assert.ok(!has(out, SECRET));
  const i = out.indexOf(Buffer.from('Exif\0\0', 'latin1'));
  assert.ok(i > 0, 'a minimal EXIF is written');
  assert.ok(out.indexOf(Buffer.from('JFIF\0', 'latin1')) < i, 'after the JFIF header');
  const tiff = out.subarray(i + 6);
  assert.deepStrictEqual([tiff.toString('latin1', 0, 2), tiff.readUInt16BE(8), tiff.readUInt16BE(10), tiff.readUInt16BE(18)],
    ['MM', 1, 0x0112, 6], 'one tag: Orientation = 6');
  // stripping again gives the same file
  assert.ok(stripImageMeta(out, '.jpg').equals(out));
});

test('PNG: text, EXIF and time chunks are removed; the image chunks stay byte for byte', () => {
  const clean = png();
  const src = png([pngChunk('tEXt', Buffer.from('Comment\0' + SECRET, 'latin1')), pngChunk('eXIf', Buffer.from('MM\0*' + SECRET, 'latin1')),
    pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0' + SECRET, 'latin1')), pngChunk('tIME', Buffer.alloc(7, 1))]);
  const out = stripImageMeta(Buffer.concat([src, Buffer.from('after-IEND ' + SECRET, 'latin1')]), '.png');
  assert.ok(out.equals(clean), 'exactly the plain image');
});

test('WEBP: EXIF and XMP chunks are removed and the header flags and size are corrected', () => {
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x04 | 0x10;    // EXIF + XMP + alpha flags
  const src = webp([riffChunk('VP8X', vp8x), riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])),
    riffChunk('EXIF', Buffer.from('MM\0*' + SECRET, 'latin1')), riffChunk('XMP ', Buffer.from(SECRET, 'latin1'))]);
  const out = stripImageMeta(src, '.webp');
  assert.ok(!has(out, SECRET) && !has(out, 'EXIF') && !has(out, 'XMP '));
  assert.strictEqual(out.readUInt32LE(4), out.length - 8, 'RIFF size matches');
  assert.strictEqual(out[20], 0x10, 'EXIF/XMP flags off, alpha flag kept');
  assert.ok(out.includes(riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0]))));
});

test('files that cannot be read as their type are refused, not saved as they came', () => {
  assert.strictEqual(stripImageMeta(Buffer.concat([png().subarray(0, 8), Buffer.alloc(64, 1)]), '.png'), null);
  assert.strictEqual(stripImageMeta(png().subarray(0, 40), '.png'), null, 'cut off before IEND');
  assert.strictEqual(stripImageMeta(jpeg().subarray(0, 120), '.jpg'), null, 'cut off');
  assert.strictEqual(stripImageMeta(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1]), '.jpg'), null, 'segment longer than the file');
  assert.strictEqual(stripImageMeta(webp([riffChunk('EXIF', Buffer.from(SECRET))]), '.webp'), null, 'no image in it');
  assert.strictEqual(stripImageMeta(png(), '.gif'), null);
});

test('WEBP: a rotated photo keeps only its orientation (minimal EXIF chunk), never GPS or camera data', () => {
  // EXIF in a WEBP chunk: TIFF as written by most tools, or with the "Exif\0\0" prefix some add
  const tiff = exifApp1(6).subarray(10);                          // the TIFF part of the JPEG builder: Orientation 6 + secret
  for (const exif of [tiff, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])]) {
    const vp8x = Buffer.alloc(10); vp8x[0] = 0x08 | 0x10;          // EXIF + alpha
    const out = stripImageMeta(webp([riffChunk('VP8X', vp8x), riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])), riffChunk('EXIF', exif)]), '.webp');
    assert.ok(!has(out, SECRET), 'no camera text');
    const i = out.indexOf(Buffer.from('EXIF', 'latin1'));
    assert.ok(i > 0, 'an EXIF chunk with the orientation');
    const t = out.subarray(i + 8, i + 8 + out.readUInt32LE(i + 4));
    assert.deepStrictEqual([t.length, t.toString('latin1', 0, 2), t.readUInt16BE(8), t.readUInt16BE(10), t.readUInt16BE(18)], [26, 'MM', 1, 0x0112, 6]);
    assert.strictEqual(out[20], 0x08 | 0x10, 'EXIF flag on (only the orientation is in it), alpha kept');
    assert.strictEqual(out.readUInt32LE(4), out.length - 8);
    assert.ok(stripImageMeta(out, '.webp').equals(out), 'stripping again gives the same file');
  }
  // orientation 1, or a simple WEBP without the extended header: no EXIF at all
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x08;
  const upright = stripImageMeta(webp([riffChunk('VP8X', vp8x), riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])), riffChunk('EXIF', exifApp1(1).subarray(10))]), '.webp');
  assert.ok(!has(upright, 'EXIF') && upright[20] === 0);
  const simple = stripImageMeta(webp([riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])), riffChunk('EXIF', tiff)]), '.webp');
  assert.ok(!has(simple, 'EXIF') && !has(simple, SECRET));
});
