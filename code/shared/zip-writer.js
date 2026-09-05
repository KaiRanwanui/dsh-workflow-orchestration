// ============================================================================
// workflow-agent — 纯 JS 最小 zip writer（Iter-29）
// 文件：code/shared/zip-writer.js
// 说明：
//   - STORE 模式（compression method 0，不压缩）：实现最小、正确性最易验证，
//     工作流产物以文本为主体积可控，不引入 zlib/Node 依赖——mjs 内联、CJS 构建、
//     Node 单测三语境均可直接运行（纯函数，无 require）。
//   - 产物为标准 ZIP（PKWARE APPNOTE 6.3.x 子集）：本地文件头 + 数据 + 中央目录
//     + EOCD；UTF-8 文件名（通用位标志 bit11 恒置，目录名/中文安全）。
//   - CRC32：IEEE 802.3（多项式 0xEDB88320 反射），查表法，首建缓存。
//   - buildZip(entries)：entries = [{ path: 'a/b.txt', text: '...' , mtime?: Date }]
//     或 { path, bytes: Uint8Array }；path 恒以 '/' 分隔、不得以 '/' 开头；
//     返回 Uint8Array（Node http res.end 可直接写）。
//   - dosTime/dosDate：本地时间转 DOS 格式（zip 规范；秒按 2 秒粒度截断）。
// ============================================================================

var ZIP_CRC_TABLE = null

function zipCrcTable() {
  if (ZIP_CRC_TABLE) return ZIP_CRC_TABLE
  ZIP_CRC_TABLE = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    ZIP_CRC_TABLE[n] = c >>> 0
  }
  return ZIP_CRC_TABLE
}

function zipCrc32(bytes) {
  const table = zipCrcTable()
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

// UTF-8 编码：TextEncoder 优先（Node ≥11 全局 / 动态沙箱内置），缺省回退手写编码
function zipUtf8(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str)
  const out = []
  for (let i = 0; i < str.length; i++) {
    let cp = str.codePointAt(i)
    if (cp > 0xFFFF) i++ // 代理对占两个 code unit
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63))
    else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
  }
  return new Uint8Array(out)
}

function dosTime(date) {
  const h = date.getHours(), m = date.getMinutes(), s = date.getSeconds()
  return ((h << 11) | (m << 5) | Math.floor(s / 2)) & 0xFFFF
}

function dosDate(date) {
  const y = Math.max(1980, date.getFullYear()), mo = date.getMonth() + 1, d = date.getDate()
  return (((y - 1980) << 9) | (mo << 5) | d) & 0xFFFF
}

function u16(arr, v) { arr.push(v & 0xFF, (v >>> 8) & 0xFF) }
function u32(arr, v) { arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF) }

// 校验并规整条目：path 规范（无前导/尾随 '/'、无 '..' 段、无反斜杠），返回 {path, bytes, mtime}
function zipNormalizeEntry(e) {
  if (!e || typeof e !== 'object') throw new Error('zip entry path required')
  const p = String(e.path || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  if (!p) throw new Error('zip entry path required')
  if (p.split('/').some((seg) => seg === '.' || seg === '..')) throw new Error('zip entry path traversal: ' + p)
  let bytes
  if (e.bytes instanceof Uint8Array) bytes = e.bytes
  else if (typeof e.text === 'string') bytes = zipUtf8(e.text)
  else throw new Error('zip entry needs text or bytes: ' + p)
  const mtime = e.mtime instanceof Date && !isNaN(e.mtime.getTime()) ? e.mtime : new Date()
  return { path: p, bytes, mtime }
}

// 构建 STORE zip。entries 顺序即包内顺序；同路径重复以最后者为准（中央目录逐一登记，不做去重——调用方保证唯一）。
function buildZip(entries) {
  const list = (entries || []).map(zipNormalizeEntry)
  const out = []        // byte 数组（数量级 ~ 数 MB，push 拼接可接受；保持零依赖）
  const central = []    // 中央目录记录
  for (const en of list) {
    const nameBytes = zipUtf8(en.path)
    const crc = zipCrc32(en.bytes)
    const offset = out.length
    // 本地文件头（30 + name）
    u32(out, 0x04034b50)
    u16(out, 20)        // version needed
    u16(out, 0x0800)    // flags: bit11 UTF-8 文件名
    u16(out, 0)         // method STORE
    u16(out, dosTime(en.mtime))
    u16(out, dosDate(en.mtime))
    u32(out, crc)
    u32(out, en.bytes.length)  // compressed == uncompressed（STORE）
    u32(out, en.bytes.length)
    u16(out, nameBytes.length)
    u16(out, 0)         // extra len
    for (const b of nameBytes) out.push(b)
    for (const b of en.bytes) out.push(b)
    central.push({ nameBytes, crc, size: en.bytes.length, mtime: en.mtime, offset })
  }
  const cdStart = out.length
  for (const c of central) {
    u32(out, 0x02014b50)
    u16(out, 20)        // version made by
    u16(out, 20)        // version needed
    u16(out, 0x0800)
    u16(out, 0)
    u16(out, dosTime(c.mtime))
    u16(out, dosDate(c.mtime))
    u32(out, c.crc)
    u32(out, c.size)
    u32(out, c.size)
    u16(out, c.nameBytes.length)
    u16(out, 0); u16(out, 0)   // extra/comment len
    u16(out, 0)                // disk number start
    u16(out, 0)                // internal attrs
    u32(out, 0)                // external attrs
    u32(out, c.offset)
    for (const b of c.nameBytes) out.push(b)
  }
  const cdSize = out.length - cdStart
  // EOCD（22）
  u32(out, 0x06054b50)
  u16(out, 0); u16(out, 0)
  u16(out, central.length); u16(out, central.length)
  u32(out, cdSize)
  u32(out, cdStart)
  u16(out, 0)
  return new Uint8Array(out)
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildZip, zipCrc32, zipUtf8 }
}
