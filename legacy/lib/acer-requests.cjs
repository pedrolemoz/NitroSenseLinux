// Incremental ACER + uint32 LE + JSON decoder. No Acer code is evaluated.
const MAGIC = Buffer.from('ACER');
class AcerRequests {
  constructor({ maxBytes = 1024 * 1024, maxFrames = 64 } = {}) {
    this.maxBytes = maxBytes;
    this.maxFrames = maxFrames;
    this.reset();
  }
  reset() {
    this.header = [];
    this.body = [];
    this.stack = [];
    this.quoted = false;
    this.escaped = false;
  }
  push(bytes) {
    const frames = [];
    for (const byte of bytes) {
      if (this.header.length < 8) {
        this.header.push(byte);
        if (this.header.length <= 4 && byte !== MAGIC[this.header.length - 1]) {
          throw new Error('Invalid ACER header');
        }
        continue;
      }
      if (this.body.length >= this.maxBytes) throw new Error('Request size limit');
      if (!this.body.length && byte !== 123) throw new Error('Expected JSON object payload');
      this.body.push(byte);
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (byte === 92) this.escaped = true;
        else if (byte === 34) this.quoted = false;
      } else if (byte === 34) this.quoted = true;
      else if (byte === 123 || byte === 91) this.stack.push(byte);
      else if (byte === 125 || byte === 93) {
        if (this.stack.pop() !== (byte === 125 ? 123 : 91)) throw new Error('Malformed JSON nesting');
        if (!this.stack.length) {
          const body = Buffer.from(this.body);
          // Reject invalid UTF-8 rather than silently replacing bytes in a function name.
          const text = body.toString('utf8');
          if (!Buffer.from(text).equals(body)) throw new Error('Invalid UTF-8 payload');
          frames.push({ id: Buffer.from(this.header).readUInt32LE(4), payload: JSON.parse(text) });
          if (frames.length > this.maxFrames) throw new Error('Request count limit');
          this.reset();
        }
      }
    }
    return frames;
  }
}
module.exports = { AcerRequests };
