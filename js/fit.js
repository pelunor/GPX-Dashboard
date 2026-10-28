// Minimal, tolerant decoder for Garmin FIT files.
// Reads only what the dashboard needs: `record` messages (GPS, altitude,
// speed, distance, heart rate) and the activity's sport. Malformed field
// definitions (wrong size for their type) are read as "missing" instead of
// aborting the whole file.

const FIT_EPOCH = 631065600;          // 1989-12-31T00:00:00Z in unix seconds
const SEMICIRCLE = 180 / 2 ** 31;

const MSG_RECORD = 20, MSG_SESSION = 18, MSG_SPORT = 12;

// base type number -> [size, reader, invalid value]
const TYPES = {
  0: [1, 'u8', 0xff], 1: [1, 'i8', 0x7f], 2: [1, 'u8', 0xff], 3: [2, 'i16', 0x7fff],
  4: [2, 'u16', 0xffff], 5: [4, 'i32', 0x7fffffff], 6: [4, 'u32', 0xffffffff],
  8: [4, 'f32', null], 9: [8, 'f64', null], 10: [1, 'u8', 0], 11: [2, 'u16', 0],
  12: [4, 'u32', 0], 13: [1, 'u8', 0xff],
};

export const FIT_SPORTS = {
  1: 'Run', 2: 'Ride', 4: 'Workout', 5: 'Swim', 10: 'Workout', 11: 'Walk',
  12: 'Nordic Ski', 13: 'Alpine Ski', 14: 'Snowboard', 15: 'Rowing', 17: 'Hike',
};

function readField(view, off, f, le) {
  const t = TYPES[f.type];
  if (!t || f.size < t[0]) return null;
  let v;
  switch (t[1]) {
    case 'u8': v = view.getUint8(off); break;
    case 'i8': v = view.getInt8(off); break;
    case 'u16': v = view.getUint16(off, le); break;
    case 'i16': v = view.getInt16(off, le); break;
    case 'u32': v = view.getUint32(off, le); break;
    case 'i32': v = view.getInt32(off, le); break;
    case 'f32': v = view.getFloat32(off, le); break;
    case 'f64': v = view.getFloat64(off, le); break;
  }
  return v === t[2] || !Number.isFinite(v) ? null : v;
}

export function decodeFit(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = { records: [], sport: null };
  let pos = 0;

  // A file can contain several chained FIT sections
  while (pos + 12 <= bytes.length) {
    const headerSize = bytes[pos];
    const sig = String.fromCharCode(bytes[pos + 8], bytes[pos + 9], bytes[pos + 10], bytes[pos + 11]);
    if (headerSize < 12 || sig !== '.FIT') break;
    const dataSize = view.getUint32(pos + 4, true);
    const end = Math.min(pos + headerSize + dataSize, bytes.length);
    let p = pos + headerSize;
    const defs = [];
    let lastTs = 0;

    while (p < end) {
      const header = bytes[p++];
      let local, compressedTs = null;

      if (header & 0x80) {
        // compressed-timestamp data message
        local = (header >> 5) & 0x3;
        const offset = header & 0x1f;
        let ts = (lastTs & ~0x1f) + offset;
        if (offset < (lastTs & 0x1f)) ts += 0x20;
        compressedTs = lastTs = ts;
      } else if (header & 0x40) {
        // definition message
        if (p + 5 > end) break;
        local = header & 0x0f;
        const le = bytes[p + 1] === 0;
        const global = view.getUint16(p + 2, le);
        const count = bytes[p + 4];
        p += 5;
        const fields = [];
        let size = 0;
        for (let i = 0; i < count; i++, p += 3) {
          fields.push({ num: bytes[p], size: bytes[p + 1], type: bytes[p + 2] & 0x1f });
          size += bytes[p + 1];
        }
        if (header & 0x20) {
          // developer fields: skip their bytes
          const devCount = bytes[p++];
          for (let i = 0; i < devCount; i++, p += 3) size += bytes[p + 1];
        }
        defs[local] = { global, le, fields, size };
        continue;
      } else {
        local = header & 0x0f;
      }

      const def = defs[local];
      if (!def || p + def.size > end) break;

      const wanted = def.global === MSG_RECORD || def.global === MSG_SESSION || def.global === MSG_SPORT;
      const msg = {};
      let q = p;
      for (const f of def.fields) {
        if (wanted || f.num === 253) msg[f.num] = readField(view, q, f, def.le);
        q += f.size;
      }
      if (compressedTs !== null) msg[253] = compressedTs;
      else if (msg[253] != null) lastTs = msg[253];

      if (def.global === MSG_RECORD) {
        out.records.push({
          t: msg[253] != null ? msg[253] + FIT_EPOCH : NaN,
          lat: msg[0] != null ? msg[0] * SEMICIRCLE : NaN,
          lon: msg[1] != null ? msg[1] * SEMICIRCLE : NaN,
          ele: msg[78] != null ? msg[78] / 5 - 500 : msg[2] != null ? msg[2] / 5 - 500 : NaN,
          dist: msg[5] != null ? msg[5] / 100 : NaN,
          speed: msg[73] != null ? msg[73] / 1000 : msg[6] != null ? msg[6] / 1000 : NaN,
          hr: msg[3] != null && msg[3] > 0 ? msg[3] : NaN,
        });
      } else if ((def.global === MSG_SESSION && msg[5] != null) || (def.global === MSG_SPORT && msg[0] != null)) {
        out.sport ??= def.global === MSG_SESSION ? msg[5] : msg[0];
      }
      p += def.size;
    }
    pos = end + 2;   // skip CRC
  }
  return out;
}
