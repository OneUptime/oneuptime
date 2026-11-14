/*
 * SNAPPY, BLOCK FORMAT: WHAT PROMETHEUS REMOTE WRITE AND LOKI'S PUSH API
 * COMPRESS THEIR PROTOBUF BODIES WITH.
 *
 * Both send `Content-Encoding: snappy` (remote write) or a snappy body with
 * no coding header at all (Loki's protobuf push), and both mean the BLOCK
 * format - one varint length, then elements - not the framed stream format
 * with its "sNaPpY" magic. Only decompression is needed, and it is short
 * enough to own rather than pull in a native module:
 * https://github.com/google/snappy/blob/main/format_description.txt
 *
 * The preamble declares the uncompressed length. It is checked against the
 * caller's ceiling BEFORE anything is allocated, so a few bytes that claim
 * gigabytes cost nothing, and every copy is bounds-checked, so a body that
 * lies about its offsets is refused rather than read past.
 */

export class SnappyDecodeError extends Error {
  public constructor(message: string) {
    super(`Not a valid snappy block: ${message}`);
    this.name = "SnappyDecodeError";
  }
}

export class SnappyTooLargeError extends Error {
  public readonly declaredLength: number;

  public constructor(declaredLength: number, maxLength: number) {
    super(
      `The snappy block decompresses to ${declaredLength} bytes, more than the ${maxLength} allowed.`,
    );
    this.name = "SnappyTooLargeError";
    this.declaredLength = declaredLength;
  }
}

// Element types, the low two bits of each tag byte.
const LITERAL: number = 0;
const COPY_1_BYTE_OFFSET: number = 1;
const COPY_2_BYTE_OFFSET: number = 2;

export default class SnappyBlock {
  /*
   * The uncompressed length a block declares, without decompressing it:
   * null when the preamble is not a valid varint.
   */
  public static declaredLength(input: Uint8Array): number | null {
    try {
      return SnappyBlock.readPreamble(input).length;
    } catch {
      return null;
    }
  }

  public static decompress(input: Uint8Array, maxOutputBytes: number): Buffer {
    const preamble: { length: number; next: number } =
      SnappyBlock.readPreamble(input);

    if (preamble.length > maxOutputBytes) {
      throw new SnappyTooLargeError(preamble.length, maxOutputBytes);
    }

    const output: Buffer = Buffer.allocUnsafe(preamble.length);
    let inPos: number = preamble.next;
    let outPos: number = 0;

    while (inPos < input.length) {
      const tag: number = input[inPos]!;
      inPos++;
      const type: number = tag & 0x03;

      if (type === LITERAL) {
        let length: number = tag >>> 2;

        if (length >= 60) {
          // 60..63: the length minus one is in the next 1..4 bytes.
          const extraBytes: number = length - 59;

          if (inPos + extraBytes > input.length) {
            throw new SnappyDecodeError("a literal's length is cut off");
          }

          length = 0;

          for (let index: number = 0; index < extraBytes; index++) {
            length += input[inPos + index]! * 2 ** (8 * index);
          }

          inPos += extraBytes;
        }

        length += 1;

        if (inPos + length > input.length) {
          throw new SnappyDecodeError("a literal runs past the end");
        }

        if (outPos + length > output.length) {
          throw new SnappyDecodeError("it holds more than its declared length");
        }

        output.set(input.subarray(inPos, inPos + length), outPos);
        inPos += length;
        outPos += length;
        continue;
      }

      let length: number;
      let offset: number;

      if (type === COPY_1_BYTE_OFFSET) {
        if (inPos + 1 > input.length) {
          throw new SnappyDecodeError("a copy's offset is cut off");
        }

        length = 4 + ((tag >>> 2) & 0x07);
        offset = ((tag >>> 5) << 8) | input[inPos]!;
        inPos += 1;
      } else if (type === COPY_2_BYTE_OFFSET) {
        if (inPos + 2 > input.length) {
          throw new SnappyDecodeError("a copy's offset is cut off");
        }

        length = 1 + (tag >>> 2);
        offset = input[inPos]! | (input[inPos + 1]! << 8);
        inPos += 2;
      } else {
        if (inPos + 4 > input.length) {
          throw new SnappyDecodeError("a copy's offset is cut off");
        }

        length = 1 + (tag >>> 2);
        offset =
          input[inPos]! +
          input[inPos + 1]! * 2 ** 8 +
          input[inPos + 2]! * 2 ** 16 +
          input[inPos + 3]! * 2 ** 24;
        inPos += 4;
      }

      if (offset === 0 || offset > outPos) {
        throw new SnappyDecodeError("a copy points before the start");
      }

      if (outPos + length > output.length) {
        throw new SnappyDecodeError("it holds more than its declared length");
      }

      // Copies may overlap the bytes they write (a run), so byte by byte.
      const from: number = outPos - offset;

      for (let index: number = 0; index < length; index++) {
        output[outPos + index] = output[from + index]!;
      }

      outPos += length;
    }

    if (outPos !== output.length) {
      throw new SnappyDecodeError(
        `it holds ${outPos} bytes, not the ${output.length} it declares`,
      );
    }

    return output;
  }

  // The varint at the start: at most five bytes, for a 32-bit length.
  private static readPreamble(input: Uint8Array): {
    length: number;
    next: number;
  } {
    let length: number = 0;
    let shift: number = 0;
    let position: number = 0;

    while (true) {
      if (position >= input.length) {
        throw new SnappyDecodeError("its length is cut off");
      }

      if (position >= 5) {
        throw new SnappyDecodeError("its length is not a 32-bit varint");
      }

      const byte: number = input[position]!;
      position++;
      length += (byte & 0x7f) * 2 ** shift;
      shift += 7;

      if ((byte & 0x80) === 0) {
        break;
      }
    }

    if (length > 0xffffffff) {
      throw new SnappyDecodeError("its length is not a 32-bit varint");
    }

    return { length: length, next: position };
  }
}
