/**
 * DataView wrapper for sequential little-endian binary parsing.
 * All reads advance the internal offset.
 */
export class BinaryReader {
  private view: DataView;
  private offset: number;
  private buffer: ArrayBuffer;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  get position(): number {
    return this.offset;
  }

  set position(pos: number) {
    this.offset = pos;
  }

  get remaining(): number {
    return this.buffer.byteLength - this.offset;
  }

  get byteLength(): number {
    return this.buffer.byteLength;
  }

  readUint8(): number {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readInt16(): number {
    const val = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readUint16(): number {
    const val = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readInt32(): number {
    const val = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readUint32(): number {
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readFloat32(): number {
    const val = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readFloat64(): number {
    const val = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return val;
  }

  readBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    return new Uint8Array(bytes);
  }

  /** Read a fixed-length string, trimming at first null byte */
  readString(length: number): string {
    const bytes = this.readBytes(length);
    let end = bytes.indexOf(0);
    if (end === -1) end = length;
    const decoder = new TextDecoder('latin1');
    return decoder.decode(bytes.subarray(0, end));
  }

  /** Read encrypted bytes using Elma's XOR encryption */
  readEncrypted(length: number): Uint8Array {
    const bytes = this.readBytes(length);
    return decryptBytes(bytes);
  }

  skip(length: number): void {
    this.offset += length;
  }

  seek(position: number): void {
    this.offset = position;
  }
}

/**
 * BinaryWriter for writing binary data in little-endian format.
 */
export class BinaryWriter {
  private chunks: Uint8Array[] = [];
  private currentChunk: DataView;
  private currentBuffer: ArrayBuffer;
  private offset: number;
  private chunkSize: number;

  constructor(initialSize = 4096) {
    this.chunkSize = initialSize;
    this.currentBuffer = new ArrayBuffer(initialSize);
    this.currentChunk = new DataView(this.currentBuffer);
    this.offset = 0;
  }

  private ensureCapacity(bytes: number): void {
    if (this.offset + bytes > this.currentBuffer.byteLength) {
      this.chunks.push(new Uint8Array(this.currentBuffer, 0, this.offset));
      const newSize = Math.max(this.chunkSize, bytes);
      this.currentBuffer = new ArrayBuffer(newSize);
      this.currentChunk = new DataView(this.currentBuffer);
      this.offset = 0;
    }
  }

  writeUint8(value: number): void {
    this.ensureCapacity(1);
    this.currentChunk.setUint8(this.offset, value);
    this.offset += 1;
  }

  writeInt16(value: number): void {
    this.ensureCapacity(2);
    this.currentChunk.setInt16(this.offset, value, true);
    this.offset += 2;
  }

  writeInt32(value: number): void {
    this.ensureCapacity(4);
    this.currentChunk.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  writeFloat32(value: number): void {
    this.ensureCapacity(4);
    this.currentChunk.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  writeFloat64(value: number): void {
    this.ensureCapacity(8);
    this.currentChunk.setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.length);
    new Uint8Array(this.currentBuffer, this.offset, bytes.length).set(bytes);
    this.offset += bytes.length;
  }

  writeString(str: string, fixedLength: number): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const padded = new Uint8Array(fixedLength);
    padded.set(bytes.subarray(0, fixedLength));
    this.writeBytes(padded);
  }

  toArrayBuffer(): ArrayBuffer {
    const totalLength = this.chunks.reduce((sum, c) => sum + c.length, 0) + this.offset;
    const result = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }
    result.set(new Uint8Array(this.currentBuffer, 0, this.offset), pos);
    return result.buffer;
  }
}

/** Decrypt bytes using Elma's top-ten XOR encryption */
export function decryptBytes(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length);
  // Use Int16 arithmetic (signed 16-bit) as in the original C++
  let a = 21;
  let b = 9783;
  let c = 3389;
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i]! ^ (a & 0xFF);
    a = toInt16(a % c);
    b = toInt16(b + toInt16(a * c));
    a = toInt16(toInt16(31 * b) + c);
  }
  return result;
}

/** Encrypt bytes using Elma's top-ten XOR encryption */
export function encryptBytes(bytes: Uint8Array): Uint8Array {
  // Same operation - XOR is its own inverse with the same key stream
  return decryptBytes(bytes);
}

/** Convert to signed 16-bit integer */
function toInt16(value: number): number {
  const v = value & 0xFFFF;
  return v > 0x7FFF ? v - 0x10000 : v;
}