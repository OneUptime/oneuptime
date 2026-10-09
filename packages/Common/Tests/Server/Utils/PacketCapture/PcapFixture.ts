/*
 * pcap files for tests, written the way tcpdump writes them (-w): a 24-byte
 * global header, then a 16-byte record header and the bytes of each packet.
 * The byte order and the timestamp precision are the ones the magic number
 * says, so a test can hand the readers every flavour a capture tool writes.
 */

export enum PcapByteOrder {
  LittleEndian = "LittleEndian",
  BigEndian = "BigEndian",
}

export interface PcapFixtureOptions {
  // The captured length of each packet, in order.
  packetLengths: Array<number>;
  byteOrder?: PcapByteOrder | undefined;
  isNanosecond?: boolean | undefined;
  // 1 is Ethernet, 113 Linux "cooked" (tcpdump -i any).
  linkType?: number | undefined;
  snapLength?: number | undefined;
}

const MAGIC_MICROSECONDS: number = 0xa1b2c3d4;
const MAGIC_NANOSECONDS: number = 0xa1b23c4d;

function writeNumber(
  buffer: Buffer,
  value: number,
  offset: number,
  byteOrder: PcapByteOrder,
): void {
  if (byteOrder === PcapByteOrder.BigEndian) {
    buffer.writeUInt32BE(value >>> 0, offset);
  } else {
    buffer.writeUInt32LE(value >>> 0, offset);
  }
}

function writeShort(
  buffer: Buffer,
  value: number,
  offset: number,
  byteOrder: PcapByteOrder,
): void {
  if (byteOrder === PcapByteOrder.BigEndian) {
    buffer.writeUInt16BE(value, offset);
  } else {
    buffer.writeUInt16LE(value, offset);
  }
}

export function makePcapHeader(
  options: Omit<PcapFixtureOptions, "packetLengths"> = {},
): Buffer {
  const byteOrder: PcapByteOrder =
    options.byteOrder || PcapByteOrder.LittleEndian;
  const header: Buffer = Buffer.alloc(24);

  writeNumber(
    header,
    options.isNanosecond ? MAGIC_NANOSECONDS : MAGIC_MICROSECONDS,
    0,
    byteOrder,
  );
  writeShort(header, 2, 4, byteOrder);
  writeShort(header, 4, 6, byteOrder);
  writeNumber(header, 0, 8, byteOrder);
  writeNumber(header, 0, 12, byteOrder);
  writeNumber(header, options.snapLength || 262144, 16, byteOrder);
  writeNumber(header, options.linkType ?? 1, 20, byteOrder);

  return header;
}

/*
 * One record: its header, then `capturedLength` bytes, each the packet's
 * index so a test can tell packets apart.
 */
export function makePcapRecord(data: {
  capturedLength: number;
  index?: number | undefined;
  byteOrder?: PcapByteOrder | undefined;
  // What the header says it holds, when a test needs it to lie.
  declaredLength?: number | undefined;
}): Buffer {
  const byteOrder: PcapByteOrder = data.byteOrder || PcapByteOrder.LittleEndian;
  const record: Buffer = Buffer.alloc(16 + data.capturedLength);
  const declared: number = data.declaredLength ?? data.capturedLength;

  writeNumber(record, 1760000000 + (data.index || 0), 0, byteOrder);
  writeNumber(record, 0, 4, byteOrder);
  writeNumber(record, declared, 8, byteOrder);
  writeNumber(record, declared, 12, byteOrder);
  record.fill((data.index || 0) & 0xff, 16);

  return record;
}

export function makePcap(options: PcapFixtureOptions): Buffer {
  return Buffer.concat([
    makePcapHeader(options),
    ...options.packetLengths.map((capturedLength: number, index: number) => {
      return makePcapRecord({
        capturedLength: capturedLength,
        index: index,
        byteOrder: options.byteOrder,
      });
    }),
  ]);
}

// The length of a file with these packets: the header and each record.
export function pcapLength(packetLengths: Array<number>): number {
  return packetLengths.reduce((total: number, length: number): number => {
    return total + 16 + length;
  }, 24);
}
