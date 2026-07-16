import NetFlowV5Parser, {
  NetFlowV5Record,
  ParsedNetFlowV5Datagram,
} from "../../Utils/NetFlow/NetFlowV5Parser";

const HEADER_LENGTH_BYTES: number = 24;
const RECORD_LENGTH_BYTES: number = 48;

// Header values shared by the synthetic datagrams below.
const SYS_UPTIME_MS: number = 3600000; // device booted an hour ago
const UNIX_SECS: number = 1750000000;
const UNIX_NSECS: number = 500000000; // +500ms
const FLOW_SEQUENCE: number = 42;
const ENGINE_TYPE: number = 1;
const ENGINE_ID: number = 7;
const SAMPLING_INTERVAL: number = 0;

interface RecordFields {
  srcAddr: [number, number, number, number];
  dstAddr: [number, number, number, number];
  nextHop?: [number, number, number, number];
  inputIf?: number;
  outputIf?: number;
  dPkts: number;
  dOctets: number;
  first: number;
  last: number;
  srcPort: number;
  dstPort: number;
  tcpFlags?: number;
  prot: number;
  tos?: number;
  srcAs?: number;
  dstAs?: number;
  srcMask?: number;
  dstMask?: number;
}

function writeHeader(
  buffer: Buffer,
  options?: {
    version?: number | undefined;
    count?: number | undefined;
  },
): void {
  buffer.writeUInt16BE(options?.version ?? 5, 0);
  buffer.writeUInt16BE(options?.count ?? 1, 2);
  buffer.writeUInt32BE(SYS_UPTIME_MS, 4);
  buffer.writeUInt32BE(UNIX_SECS, 8);
  buffer.writeUInt32BE(UNIX_NSECS, 12);
  buffer.writeUInt32BE(FLOW_SEQUENCE, 16);
  buffer.writeUInt8(ENGINE_TYPE, 20);
  buffer.writeUInt8(ENGINE_ID, 21);
  buffer.writeUInt16BE(SAMPLING_INTERVAL, 22);
}

function writeRecord(
  buffer: Buffer,
  recordIndex: number,
  fields: RecordFields,
): void {
  const offset: number =
    HEADER_LENGTH_BYTES + recordIndex * RECORD_LENGTH_BYTES;

  const nextHop: [number, number, number, number] = fields.nextHop ?? [
    0, 0, 0, 0,
  ];

  buffer.writeUInt8(fields.srcAddr[0], offset);
  buffer.writeUInt8(fields.srcAddr[1], offset + 1);
  buffer.writeUInt8(fields.srcAddr[2], offset + 2);
  buffer.writeUInt8(fields.srcAddr[3], offset + 3);
  buffer.writeUInt8(fields.dstAddr[0], offset + 4);
  buffer.writeUInt8(fields.dstAddr[1], offset + 5);
  buffer.writeUInt8(fields.dstAddr[2], offset + 6);
  buffer.writeUInt8(fields.dstAddr[3], offset + 7);
  buffer.writeUInt8(nextHop[0], offset + 8);
  buffer.writeUInt8(nextHop[1], offset + 9);
  buffer.writeUInt8(nextHop[2], offset + 10);
  buffer.writeUInt8(nextHop[3], offset + 11);
  buffer.writeUInt16BE(fields.inputIf ?? 0, offset + 12);
  buffer.writeUInt16BE(fields.outputIf ?? 0, offset + 14);
  buffer.writeUInt32BE(fields.dPkts, offset + 16);
  buffer.writeUInt32BE(fields.dOctets, offset + 20);
  buffer.writeUInt32BE(fields.first, offset + 24);
  buffer.writeUInt32BE(fields.last, offset + 28);
  buffer.writeUInt16BE(fields.srcPort, offset + 32);
  buffer.writeUInt16BE(fields.dstPort, offset + 34);
  buffer.writeUInt8(0, offset + 36); // pad1
  buffer.writeUInt8(fields.tcpFlags ?? 0, offset + 37);
  buffer.writeUInt8(fields.prot, offset + 38);
  buffer.writeUInt8(fields.tos ?? 0, offset + 39);
  buffer.writeUInt16BE(fields.srcAs ?? 0, offset + 40);
  buffer.writeUInt16BE(fields.dstAs ?? 0, offset + 42);
  buffer.writeUInt8(fields.srcMask ?? 0, offset + 44);
  buffer.writeUInt8(fields.dstMask ?? 0, offset + 45);
  buffer.writeUInt16BE(0, offset + 46); // pad2
}

function buildDatagram(
  records: Array<RecordFields>,
  options?: {
    version?: number | undefined;
    declaredCount?: number | undefined;
  },
): Buffer {
  const buffer: Buffer = Buffer.alloc(
    HEADER_LENGTH_BYTES + records.length * RECORD_LENGTH_BYTES,
  );

  writeHeader(buffer, {
    version: options?.version,
    count: options?.declaredCount ?? records.length,
  });

  records.forEach((fields: RecordFields, index: number) => {
    writeRecord(buffer, index, fields);
  });

  return buffer;
}

describe("NetFlowV5Parser", () => {
  test("parses a valid single-record datagram", () => {
    const datagram: Buffer = buildDatagram([
      {
        srcAddr: [10, 0, 0, 1],
        dstAddr: [192, 168, 1, 20],
        nextHop: [10, 0, 0, 254],
        inputIf: 2,
        outputIf: 3,
        dPkts: 100,
        dOctets: 123456,
        first: SYS_UPTIME_MS - 60000, // started a minute before export
        last: SYS_UPTIME_MS - 1000, // ended a second before export
        srcPort: 54321,
        dstPort: 443,
        tcpFlags: 0x1b,
        prot: 6,
        tos: 0x10,
        srcAs: 64512,
        dstAs: 64513,
        srcMask: 24,
        dstMask: 16,
      },
    ]);

    const parsed: ParsedNetFlowV5Datagram | null =
      NetFlowV5Parser.parse(datagram);

    expect(parsed).not.toBeNull();

    expect(parsed!.header.version).toBe(5);
    expect(parsed!.header.count).toBe(1);
    expect(parsed!.header.sysUptime).toBe(SYS_UPTIME_MS);
    expect(parsed!.header.unixSecs).toBe(UNIX_SECS);
    expect(parsed!.header.unixNsecs).toBe(UNIX_NSECS);
    expect(parsed!.header.flowSequence).toBe(FLOW_SEQUENCE);
    expect(parsed!.header.engineType).toBe(ENGINE_TYPE);
    expect(parsed!.header.engineId).toBe(ENGINE_ID);
    expect(parsed!.header.samplingInterval).toBe(SAMPLING_INTERVAL);

    expect(parsed!.records).toHaveLength(1);

    const record: NetFlowV5Record = parsed!.records[0]!;
    expect(record.sourceIpAddress).toBe("10.0.0.1");
    expect(record.destinationIpAddress).toBe("192.168.1.20");
    expect(record.nextHopIpAddress).toBe("10.0.0.254");
    expect(record.inputInterfaceIndex).toBe(2);
    expect(record.outputInterfaceIndex).toBe(3);
    expect(record.packets).toBe(100);
    expect(record.octets).toBe(123456);
    expect(record.sourcePort).toBe(54321);
    expect(record.destinationPort).toBe(443);
    expect(record.tcpFlags).toBe(0x1b);
    expect(record.protocolNumber).toBe(6);
    expect(record.tos).toBe(0x10);
    expect(record.sourceAs).toBe(64512);
    expect(record.destinationAs).toBe(64513);
    expect(record.sourceMaskBits).toBe(24);
    expect(record.destinationMaskBits).toBe(16);

    // Wall clock = unixSecs * 1000 + (recordUptime - sysUptime).
    expect(record.flowStartAt.getTime()).toBe(UNIX_SECS * 1000 - 60000);
    expect(record.flowEndAt.getTime()).toBe(UNIX_SECS * 1000 - 1000);
  });

  test("parses a valid multi-record datagram", () => {
    const datagram: Buffer = buildDatagram([
      {
        srcAddr: [10, 0, 0, 1],
        dstAddr: [10, 0, 0, 2],
        dPkts: 1,
        dOctets: 60,
        first: SYS_UPTIME_MS - 5000,
        last: SYS_UPTIME_MS - 4000,
        srcPort: 1111,
        dstPort: 53,
        prot: 17,
      },
      {
        srcAddr: [172, 16, 5, 9],
        dstAddr: [8, 8, 8, 8],
        dPkts: 25,
        dOctets: 4000,
        first: SYS_UPTIME_MS - 30000,
        last: SYS_UPTIME_MS - 10000,
        srcPort: 40000,
        dstPort: 80,
        prot: 6,
      },
      {
        srcAddr: [192, 168, 0, 5],
        dstAddr: [192, 168, 0, 6],
        dPkts: 3,
        dOctets: 300,
        first: SYS_UPTIME_MS - 100,
        last: SYS_UPTIME_MS,
        srcPort: 0,
        dstPort: 0,
        prot: 1,
      },
    ]);

    const parsed: ParsedNetFlowV5Datagram | null =
      NetFlowV5Parser.parse(datagram);

    expect(parsed).not.toBeNull();
    expect(parsed!.header.count).toBe(3);
    expect(parsed!.records).toHaveLength(3);

    expect(parsed!.records[0]!.destinationPort).toBe(53);
    expect(parsed!.records[0]!.protocolNumber).toBe(17);
    expect(parsed!.records[1]!.sourceIpAddress).toBe("172.16.5.9");
    expect(parsed!.records[1]!.destinationIpAddress).toBe("8.8.8.8");
    expect(parsed!.records[1]!.octets).toBe(4000);
    expect(parsed!.records[2]!.protocolNumber).toBe(1);
    expect(parsed!.records[2]!.flowEndAt.getTime()).toBe(UNIX_SECS * 1000);
  });

  test("clamps a flow timestamp that computes before the epoch to the export time", () => {
    /*
     * unixSecs so small that (first - sysUptime) pushes the computed wall
     * clock below zero — the parser must fall back to the export time
     * (unixSecs * 1000 + unixNsecs as ms) instead of a pre-1970 date.
     */
    const buffer: Buffer = Buffer.alloc(
      HEADER_LENGTH_BYTES + RECORD_LENGTH_BYTES,
    );

    buffer.writeUInt16BE(5, 0); // version
    buffer.writeUInt16BE(1, 2); // count
    buffer.writeUInt32BE(3600000, 4); // sysUptime: 1h
    buffer.writeUInt32BE(1, 8); // unixSecs: 1s after epoch
    buffer.writeUInt32BE(0, 12); // unixNsecs
    buffer.writeUInt32BE(0, 16); // flowSequence

    writeRecord(buffer, 0, {
      srcAddr: [1, 2, 3, 4],
      dstAddr: [5, 6, 7, 8],
      dPkts: 1,
      dOctets: 40,
      first: 0, // 1000 + (0 - 3600000) < 0
      last: 3600000,
      srcPort: 1,
      dstPort: 2,
      prot: 6,
    });

    const parsed: ParsedNetFlowV5Datagram | null =
      NetFlowV5Parser.parse(buffer);

    expect(parsed).not.toBeNull();
    expect(parsed!.records[0]!.flowStartAt.getTime()).toBe(1000);
    expect(parsed!.records[0]!.flowEndAt.getTime()).toBe(1000);
  });

  test("returns null for a wrong version", () => {
    const v9Datagram: Buffer = buildDatagram(
      [
        {
          srcAddr: [10, 0, 0, 1],
          dstAddr: [10, 0, 0, 2],
          dPkts: 1,
          dOctets: 60,
          first: 0,
          last: 0,
          srcPort: 1,
          dstPort: 2,
          prot: 6,
        },
      ],
      { version: 9 },
    );

    expect(NetFlowV5Parser.parse(v9Datagram)).toBeNull();
  });

  test("returns null for a truncated packet", () => {
    const datagram: Buffer = buildDatagram([
      {
        srcAddr: [10, 0, 0, 1],
        dstAddr: [10, 0, 0, 2],
        dPkts: 1,
        dOctets: 60,
        first: 0,
        last: 0,
        srcPort: 1,
        dstPort: 2,
        prot: 6,
      },
    ]);

    // Cut 10 bytes off the record — shorter than header + count * 48.
    const truncated: Buffer = datagram.subarray(0, datagram.length - 10);

    expect(NetFlowV5Parser.parse(truncated)).toBeNull();

    // Shorter than even a header.
    expect(NetFlowV5Parser.parse(Buffer.alloc(10))).toBeNull();
  });

  test("returns null when the declared count does not match the payload", () => {
    // Header says 2 records but only 1 record's worth of bytes follows.
    const datagram: Buffer = buildDatagram(
      [
        {
          srcAddr: [10, 0, 0, 1],
          dstAddr: [10, 0, 0, 2],
          dPkts: 1,
          dOctets: 60,
          first: 0,
          last: 0,
          srcPort: 1,
          dstPort: 2,
          prot: 6,
        },
      ],
      { declaredCount: 2 },
    );

    expect(NetFlowV5Parser.parse(datagram)).toBeNull();
  });

  test("returns null for a count outside the 1-30 bound", () => {
    const zeroCount: Buffer = Buffer.alloc(HEADER_LENGTH_BYTES);
    writeHeader(zeroCount, { count: 0 });
    expect(NetFlowV5Parser.parse(zeroCount)).toBeNull();

    const oversizedCount: Buffer = Buffer.alloc(
      HEADER_LENGTH_BYTES + 31 * RECORD_LENGTH_BYTES,
    );
    writeHeader(oversizedCount, { count: 31 });
    expect(NetFlowV5Parser.parse(oversizedCount)).toBeNull();
  });
});
