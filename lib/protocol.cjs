const MAX_JSON = 1024 * 1024;
const READ_ONLY_IDS = new Set([0, 10, 20, 30, 40]);
function encodeReadRequest(id, payload) {
  if (!READ_ONLY_IDS.has(id)) throw new Error('Only documented read/query packet IDs are allowed');
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length > MAX_JSON) throw new Error('Request too large');
  const header = Buffer.alloc(8);
  header.write('ACER', 'ascii'); header.writeUInt32LE(id, 4);
  return Buffer.concat([header, body]);
}
// Unlike the vendor brace counter, this handles JSON strings across TCP chunks.
class JsonObjects {
  constructor(maxBytes = MAX_JSON) { this.maxBytes = maxBytes; this.buffer = ''; }
  push(text) {
    this.buffer += text;
    if (Buffer.byteLength(this.buffer, 'utf8') > this.maxBytes) throw new Error('Response size limit');
    let depth = 0, quoted = false, escaped = false, start = -1, consumed = 0;
    const results = [];
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (start < 0) {
        if (/\s/.test(c)) { consumed = i + 1; continue; }
        if (c !== '{') throw new Error('Expected a JSON object response');
        start = i;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        if (--depth === 0) {
          results.push(JSON.parse(this.buffer.slice(start, i + 1)));
          start = -1; consumed = i + 1;
        }
        if (depth < 0) throw new Error('Malformed JSON response');
      }
    }
    this.buffer = this.buffer.slice(consumed);
    return results;
  }
}
module.exports = { encodeReadRequest, JsonObjects };
