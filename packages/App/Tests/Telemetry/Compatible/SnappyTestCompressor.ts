/*
 * A small snappy BLOCK compressor for the compatible-ingest suites: it
 * writes what a Prometheus server or Promtail would send, so the decoder
 * is tested against real element encodings - literals of every length
 * form, and copies with 1-, 2- and 4-byte offsets, overlapping ones
 * included - rather than only against hand-built bytes.
 *
 * Greedy and unoptimised on purpose: it only has to be correct.
 * https://github.com/google/snappy/blob/main/format_description.txt
 */

export interface SnappyTestCompressorOptions {
  // Write every copy with a 4-byte offset (the form Go's encoder rarely uses).
  forceFourByteOffsets?: boolean | undefined;
  // Never write a copy: a body of literals only.
  literalsOnly?: boolean | undefined;
}

function pushVarint(output: Array<number>, value: number): void {
  let remaining: number = value;

  while (remaining >= 0x80) {
    output.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }

  output.push(remaining);
}

function pushLiteral(
  output: Array<number>,
  input: Uint8Array,
  start: number,
  end: number,
): void {
  let position: number = start;

  while (position < end) {
    // At most 2^16 per literal here, which covers the 1- and 2-byte forms.
    const length: number = Math.min(end - position, 65536);
    const lengthMinusOne: number = length - 1;

    if (lengthMinusOne < 60) {
      output.push(lengthMinusOne << 2);
    } else if (lengthMinusOne < 256) {
      output.push(60 << 2, lengthMinusOne);
    } else {
      output.push(61 << 2, lengthMinusOne & 0xff, lengthMinusOne >> 8);
    }

    for (let index: number = position; index < position + length; index++) {
      output.push(input[index]!);
    }

    position += length;
  }
}

function pushCopy(
  output: Array<number>,
  offset: number,
  length: number,
  options: SnappyTestCompressorOptions,
): void {
  let remaining: number = length;

  while (remaining > 0) {
    let chunk: number = Math.min(remaining, 64);

    // Leave at least 4 behind when a 1-byte-offset copy might take the rest.
    if (remaining - chunk > 0 && remaining - chunk < 4) {
      chunk = remaining - 4;
    }

    if (
      !options.forceFourByteOffsets &&
      chunk >= 4 &&
      chunk <= 11 &&
      offset < 2048
    ) {
      output.push(1 | ((chunk - 4) << 2) | ((offset >> 8) << 5), offset & 0xff);
    } else if (!options.forceFourByteOffsets && offset < 65536) {
      output.push(2 | ((chunk - 1) << 2), offset & 0xff, offset >> 8);
    } else {
      output.push(
        3 | ((chunk - 1) << 2),
        offset & 0xff,
        (offset >> 8) & 0xff,
        (offset >> 16) & 0xff,
        (offset >>> 24) & 0xff,
      );
    }

    remaining -= chunk;
  }
}

export function snappyCompress(
  input: Uint8Array,
  options: SnappyTestCompressorOptions = {},
): Buffer {
  const output: Array<number> = [];
  pushVarint(output, input.length);

  const lastSeen: Map<number, number> = new Map<number, number>();
  let literalStart: number = 0;
  let position: number = 0;

  while (position + 4 <= input.length) {
    const key: number =
      input[position]! |
      (input[position + 1]! << 8) |
      (input[position + 2]! << 16) |
      (input[position + 3]! << 24);
    const candidate: number | undefined = lastSeen.get(key);
    lastSeen.set(key, position);

    if (options.literalsOnly || candidate === undefined) {
      position++;
      continue;
    }

    let length: number = 0;

    while (
      position + length < input.length &&
      input[candidate + length] === input[position + length]
    ) {
      length++;
    }

    if (length < 4) {
      position++;
      continue;
    }

    pushLiteral(output, input, literalStart, position);
    pushCopy(output, position - candidate, length, options);
    position += length;
    literalStart = position;
  }

  pushLiteral(output, input, literalStart, input.length);

  return Buffer.from(output);
}
