import NetFlowV9Parser, {
  NetFlowV9Record,
  ParsedNetFlowV9Datagram,
} from "../../Utils/NetFlow/NetFlowV9Parser";

const HEADER_LENGTH_BYTES: number = 20;

// Header values shared by the synthetic datagrams below.
const SYS_UPTIME_MS: number = 3600000; // device booted an hour ago
const UNIX_SECS: number = 1750000000;
const SEQUENCE_NUMBER: number = 42;
const SOURCE_ID: number = 7;

const EXPORTER_IP: string = "203.0.113.10";

// RFC 3954 field type IDs used by the synthetic templates below.
const IN_BYTES: number = 1;
const IN_PKTS: number = 2;
const PROTOCOL: number = 4;
const SRC_TOS: number = 5;
const TCP_FLAGS: number = 6;
const L4_SRC_PORT: number = 7;
const IPV4_SRC_ADDR: number = 8;
const INPUT_SNMP: number = 10;
const L4_DST_PORT: number = 11;
const IPV4_DST_ADDR: number = 12;
const OUTPUT_SNMP: number = 14;
const LAST_SWITCHED: number = 21;
const FIRST_SWITCHED: number = 22;
const IPV6_SRC_ADDR: number = 27;
const IPV6_DST_ADDR: number = 28;

interface TemplateFieldSpec {
  fieldType: number;
  fieldLength: number;
}

interface TemplateSpec {
  templateId: number;
  fields: Array<TemplateFieldSpec>;
}

interface HeaderOptions {
  version?: number | undefined;
  count?: number | undefined;
  sysUptime?: number | undefined;
  unixSecs?: number | undefined;
  sourceId?: number | undefined;
}

function buildHeader(options?: HeaderOptions): Buffer {
  const buffer: Buffer = Buffer.alloc(HEADER_LENGTH_BYTES);

  buffer.writeUInt16BE(options?.version ?? 9, 0);
  buffer.writeUInt16BE(options?.count ?? 0, 2);
  buffer.writeUInt32BE(options?.sysUptime ?? SYS_UPTIME_MS, 4);
  buffer.writeUInt32BE(options?.unixSecs ?? UNIX_SECS, 8);
  buffer.writeUInt32BE(SEQUENCE_NUMBER, 12);
  buffer.writeUInt32BE(options?.sourceId ?? SOURCE_ID, 16);

  return buffer;
}

/*
 * Builds a template FlowSet (ID 0) carrying one or more templates back to
 * back, plus `paddingBytes` trailing zero bytes.
 */
function buildTemplateFlowSet(
  templates: Array<TemplateSpec>,
  paddingBytes: number = 0,
): Buffer {
  let bodyLength: number = 0;

  for (const template of templates) {
    bodyLength += 4 + template.fields.length * 4;
  }

  const buffer: Buffer = Buffer.alloc(4 + bodyLength + paddingBytes);

  buffer.writeUInt16BE(0, 0); // FlowSet ID 0 = templates
  buffer.writeUInt16BE(buffer.length, 2);

  let offset: number = 4;

  for (const template of templates) {
    buffer.writeUInt16BE(template.templateId, offset);
    buffer.writeUInt16BE(template.fields.length, offset + 2);
    offset += 4;

    for (const field of template.fields) {
      buffer.writeUInt16BE(field.fieldType, offset);
      buffer.writeUInt16BE(field.fieldLength, offset + 2);
      offset += 4;
    }
  }

  return buffer;
}

/*
 * Builds a data FlowSet whose ID names the template that decodes it,
 * carrying the given pre-encoded records plus `paddingBytes` trailing zero
 * bytes (RFC 3954 pads FlowSets to a 32-bit boundary).
 */
function buildDataFlowSet(
  templateId: number,
  records: Array<Buffer>,
  paddingBytes: number = 0,
): Buffer {
  const body: Buffer = Buffer.concat(records);
  const buffer: Buffer = Buffer.alloc(4 + body.length + paddingBytes);

  buffer.writeUInt16BE(templateId, 0);
  buffer.writeUInt16BE(buffer.length, 2);
  body.copy(buffer, 4);

  return buffer;
}

function buildDatagram(
  flowSets: Array<Buffer>,
  headerOptions?: HeaderOptions,
): Buffer {
  return Buffer.concat([buildHeader(headerOptions), ...flowSets]);
}

/*
 * The "standard" template most tests use: an IPv4 5-tuple with 4-byte
 * counters, sysUptime timestamps, TCP details, and 2-byte SNMP ifIndexes.
 *
 * Field layout / record offsets:
 *   IPV4_SRC_ADDR(4)@0, IPV4_DST_ADDR(4)@4, IN_PKTS(4)@8, IN_BYTES(4)@12,
 *   FIRST_SWITCHED(4)@16, LAST_SWITCHED(4)@20, L4_SRC_PORT(2)@24,
 *   L4_DST_PORT(2)@26, INPUT_SNMP(2)@28, OUTPUT_SNMP(2)@30, PROTOCOL(1)@32,
 *   TCP_FLAGS(1)@33, SRC_TOS(1)@34 — 35 bytes total.
 */
const STANDARD_TEMPLATE_ID: number = 256;
const STANDARD_RECORD_LENGTH_BYTES: number = 35;

const STANDARD_TEMPLATE: TemplateSpec = {
  templateId: STANDARD_TEMPLATE_ID,
  fields: [
    { fieldType: IPV4_SRC_ADDR, fieldLength: 4 },
    { fieldType: IPV4_DST_ADDR, fieldLength: 4 },
    { fieldType: IN_PKTS, fieldLength: 4 },
    { fieldType: IN_BYTES, fieldLength: 4 },
    { fieldType: FIRST_SWITCHED, fieldLength: 4 },
    { fieldType: LAST_SWITCHED, fieldLength: 4 },
    { fieldType: L4_SRC_PORT, fieldLength: 2 },
    { fieldType: L4_DST_PORT, fieldLength: 2 },
    { fieldType: INPUT_SNMP, fieldLength: 2 },
    { fieldType: OUTPUT_SNMP, fieldLength: 2 },
    { fieldType: PROTOCOL, fieldLength: 1 },
    { fieldType: TCP_FLAGS, fieldLength: 1 },
    { fieldType: SRC_TOS, fieldLength: 1 },
  ],
};

interface StandardRecordFields {
  srcAddr: [number, number, number, number];
  dstAddr: [number, number, number, number];
  packets: number;
  octets: number;
  first: number;
  last: number;
  srcPort: number;
  dstPort: number;
  inputIf?: number | undefined;
  outputIf?: number | undefined;
  prot: number;
  tcpFlags?: number | undefined;
  tos?: number | undefined;
}

function buildStandardRecord(fields: StandardRecordFields): Buffer {
  const buffer: Buffer = Buffer.alloc(STANDARD_RECORD_LENGTH_BYTES);

  buffer.writeUInt8(fields.srcAddr[0], 0);
  buffer.writeUInt8(fields.srcAddr[1], 1);
  buffer.writeUInt8(fields.srcAddr[2], 2);
  buffer.writeUInt8(fields.srcAddr[3], 3);
  buffer.writeUInt8(fields.dstAddr[0], 4);
  buffer.writeUInt8(fields.dstAddr[1], 5);
  buffer.writeUInt8(fields.dstAddr[2], 6);
  buffer.writeUInt8(fields.dstAddr[3], 7);
  buffer.writeUInt32BE(fields.packets, 8);
  buffer.writeUInt32BE(fields.octets, 12);
  buffer.writeUInt32BE(fields.first, 16);
  buffer.writeUInt32BE(fields.last, 20);
  buffer.writeUInt16BE(fields.srcPort, 24);
  buffer.writeUInt16BE(fields.dstPort, 26);
  buffer.writeUInt16BE(fields.inputIf ?? 0, 28);
  buffer.writeUInt16BE(fields.outputIf ?? 0, 30);
  buffer.writeUInt8(fields.prot, 32);
  buffer.writeUInt8(fields.tcpFlags ?? 0, 33);
  buffer.writeUInt8(fields.tos ?? 0, 34);

  return buffer;
}

describe("NetFlowV9Parser", () => {
  test("parses a template and its data records from a single datagram", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    const datagram: Buffer = buildDatagram(
      [
        buildTemplateFlowSet([STANDARD_TEMPLATE]),
        buildDataFlowSet(STANDARD_TEMPLATE_ID, [
          buildStandardRecord({
            srcAddr: [10, 0, 0, 1],
            dstAddr: [192, 168, 1, 20],
            packets: 100,
            octets: 123456,
            first: SYS_UPTIME_MS - 60000, // started a minute before export
            last: SYS_UPTIME_MS - 1000, // ended a second before export
            srcPort: 54321,
            dstPort: 443,
            inputIf: 2,
            outputIf: 3,
            prot: 6,
            tcpFlags: 0x1b,
            tos: 0x10,
          }),
        ]),
      ],
      { count: 2 },
    );

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      datagram,
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();

    expect(parsed!.header.version).toBe(9);
    expect(parsed!.header.count).toBe(2);
    expect(parsed!.header.sysUptime).toBe(SYS_UPTIME_MS);
    expect(parsed!.header.unixSecs).toBe(UNIX_SECS);
    expect(parsed!.header.sequenceNumber).toBe(SEQUENCE_NUMBER);
    expect(parsed!.header.sourceId).toBe(SOURCE_ID);

    expect(parsed!.templatesLearned).toBe(1);
    expect(parsed!.dataFlowSetsSkippedForUnknownTemplate).toBe(0);
    expect(parsed!.records).toHaveLength(1);

    const record: NetFlowV9Record = parsed!.records[0]!;
    expect(record.sourceIpAddress).toBe("10.0.0.1");
    expect(record.destinationIpAddress).toBe("192.168.1.20");
    expect(record.packets).toBe(100);
    expect(record.octets).toBe(123456);
    expect(record.sourcePort).toBe(54321);
    expect(record.destinationPort).toBe(443);
    expect(record.inputInterfaceIndex).toBe(2);
    expect(record.outputInterfaceIndex).toBe(3);
    expect(record.protocolNumber).toBe(6);
    expect(record.tcpFlags).toBe(0x1b);
    expect(record.tos).toBe(0x10);

    // Wall clock = unixSecs * 1000 + (recordUptime - sysUptime).
    expect(record.flowStartAt.getTime()).toBe(UNIX_SECS * 1000 - 60000);
    expect(record.flowEndAt.getTime()).toBe(UNIX_SECS * 1000 - 1000);
  });

  test("skips data that arrives before its template, then decodes once the template is learned", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    const dataFlowSet: Buffer = buildDataFlowSet(STANDARD_TEMPLATE_ID, [
      buildStandardRecord({
        srcAddr: [10, 0, 0, 1],
        dstAddr: [10, 0, 0, 2],
        packets: 1,
        octets: 60,
        first: SYS_UPTIME_MS - 5000,
        last: SYS_UPTIME_MS - 4000,
        srcPort: 1111,
        dstPort: 53,
        prot: 17,
      }),
    ]);

    // Data first: the template is unknown, so the FlowSet cannot decode.
    const beforeTemplate: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([dataFlowSet]),
      EXPORTER_IP,
    );

    expect(beforeTemplate).not.toBeNull();
    expect(beforeTemplate!.records).toHaveLength(0);
    expect(beforeTemplate!.dataFlowSetsSkippedForUnknownTemplate).toBe(1);

    // The exporter's periodic template refresh arrives.
    const templateOnly: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([buildTemplateFlowSet([STANDARD_TEMPLATE])]),
      EXPORTER_IP,
    );

    expect(templateOnly).not.toBeNull();
    expect(templateOnly!.templatesLearned).toBe(1);
    expect(templateOnly!.records).toHaveLength(0);

    // The same data FlowSet now decodes.
    const afterTemplate: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([dataFlowSet]),
      EXPORTER_IP,
    );

    expect(afterTemplate).not.toBeNull();
    expect(afterTemplate!.dataFlowSetsSkippedForUnknownTemplate).toBe(0);
    expect(afterTemplate!.records).toHaveLength(1);
    expect(afterTemplate!.records[0]!.destinationPort).toBe(53);
    expect(afterTemplate!.records[0]!.protocolNumber).toBe(17);
  });

  test("parses multiple records in one data FlowSet", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    const datagram: Buffer = buildDatagram([
      buildTemplateFlowSet([STANDARD_TEMPLATE]),
      buildDataFlowSet(
        STANDARD_TEMPLATE_ID,
        [
          buildStandardRecord({
            srcAddr: [10, 0, 0, 1],
            dstAddr: [10, 0, 0, 2],
            packets: 1,
            octets: 60,
            first: SYS_UPTIME_MS - 5000,
            last: SYS_UPTIME_MS - 4000,
            srcPort: 1111,
            dstPort: 53,
            prot: 17,
          }),
          buildStandardRecord({
            srcAddr: [172, 16, 5, 9],
            dstAddr: [8, 8, 8, 8],
            packets: 25,
            octets: 4000,
            first: SYS_UPTIME_MS - 30000,
            last: SYS_UPTIME_MS - 10000,
            srcPort: 40000,
            dstPort: 80,
            prot: 6,
          }),
          buildStandardRecord({
            srcAddr: [192, 168, 0, 5],
            dstAddr: [192, 168, 0, 6],
            packets: 3,
            octets: 300,
            first: SYS_UPTIME_MS - 100,
            last: SYS_UPTIME_MS,
            srcPort: 0,
            dstPort: 0,
            prot: 1,
          }),
        ],
        // 3 * 35 + 4 = 109 bytes; pad to the next 32-bit boundary.
        3,
      ),
    ]);

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      datagram,
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.records).toHaveLength(3);

    expect(parsed!.records[0]!.destinationPort).toBe(53);
    expect(parsed!.records[0]!.protocolNumber).toBe(17);
    expect(parsed!.records[1]!.sourceIpAddress).toBe("172.16.5.9");
    expect(parsed!.records[1]!.destinationIpAddress).toBe("8.8.8.8");
    expect(parsed!.records[1]!.octets).toBe(4000);
    expect(parsed!.records[2]!.protocolNumber).toBe(1);
    expect(parsed!.records[2]!.flowEndAt.getTime()).toBe(UNIX_SECS * 1000);
  });

  test("tolerates FlowSet padding in both template and data FlowSets", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    /*
     * The template FlowSet gets 4 zero padding bytes — enough that a naive
     * scanner would read them as templateId 0 / fieldCount 0. The data
     * FlowSet gets 1 padding byte (35-byte record + 4-byte header = 39,
     * padded to 40).
     */
    const datagram: Buffer = buildDatagram([
      buildTemplateFlowSet([STANDARD_TEMPLATE], 4),
      buildDataFlowSet(
        STANDARD_TEMPLATE_ID,
        [
          buildStandardRecord({
            srcAddr: [10, 0, 0, 1],
            dstAddr: [10, 0, 0, 2],
            packets: 7,
            octets: 700,
            first: SYS_UPTIME_MS - 2000,
            last: SYS_UPTIME_MS - 1000,
            srcPort: 5000,
            dstPort: 22,
            prot: 6,
          }),
        ],
        1,
      ),
    ]);

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      datagram,
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();
    // The padding must not be mistaken for another template or record.
    expect(parsed!.templatesLearned).toBe(1);
    expect(parsed!.records).toHaveLength(1);
    expect(parsed!.records[0]!.destinationPort).toBe(22);
    expect(parsed!.records[0]!.octets).toBe(700);
  });

  test("reads 8-byte counters", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    const wideCounterTemplate: TemplateSpec = {
      templateId: 257,
      fields: [
        { fieldType: IPV4_SRC_ADDR, fieldLength: 4 },
        { fieldType: IPV4_DST_ADDR, fieldLength: 4 },
        { fieldType: IN_BYTES, fieldLength: 8 },
        { fieldType: IN_PKTS, fieldLength: 8 },
        { fieldType: PROTOCOL, fieldLength: 1 },
      ],
    };

    // Values above 2^32 prove the high half of the counter is read.
    const octets: number = 5 * 0x100000000 + 0x12345678;
    const packets: number = 2 * 0x100000000 + 99;

    const record: Buffer = Buffer.alloc(25);
    record.writeUInt8(10, 0);
    record.writeUInt8(0, 1);
    record.writeUInt8(0, 2);
    record.writeUInt8(1, 3);
    record.writeUInt8(10, 4);
    record.writeUInt8(0, 5);
    record.writeUInt8(0, 6);
    record.writeUInt8(2, 7);
    // 8-byte counters written as two 32-bit halves to avoid BigInt.
    record.writeUInt32BE(5, 8);
    record.writeUInt32BE(0x12345678, 12);
    record.writeUInt32BE(2, 16);
    record.writeUInt32BE(99, 20);
    record.writeUInt8(6, 24);

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([
        buildTemplateFlowSet([wideCounterTemplate]),
        buildDataFlowSet(257, [record], 3), // 25 + 4 = 29, pad to 32
      ]),
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.records).toHaveLength(1);
    expect(parsed!.records[0]!.octets).toBe(octets);
    expect(parsed!.records[0]!.packets).toBe(packets);
    expect(parsed!.records[0]!.protocolNumber).toBe(6);
  });

  test("formats IPv6 addresses in standard colon notation", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    const ipv6Template: TemplateSpec = {
      templateId: 258,
      fields: [
        { fieldType: IPV6_SRC_ADDR, fieldLength: 16 },
        { fieldType: IPV6_DST_ADDR, fieldLength: 16 },
        { fieldType: L4_SRC_PORT, fieldLength: 2 },
        { fieldType: L4_DST_PORT, fieldLength: 2 },
        { fieldType: PROTOCOL, fieldLength: 1 },
      ],
    };

    const record: Buffer = Buffer.alloc(37);
    // 2001:db8::1 — leading zeros stripped, longest zero run compressed.
    Buffer.from("20010db8000000000000000000000001", "hex").copy(record, 0);
    // fe80::202:b3ff:fe1e:8329
    Buffer.from("fe800000000000000202b3fffe1e8329", "hex").copy(record, 16);
    record.writeUInt16BE(52000, 32);
    record.writeUInt16BE(443, 34);
    record.writeUInt8(6, 36);

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([
        buildTemplateFlowSet([ipv6Template]),
        buildDataFlowSet(258, [record], 3), // 37 + 4 = 41, pad to 44
      ]),
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.records).toHaveLength(1);
    expect(parsed!.records[0]!.sourceIpAddress).toBe("2001:db8::1");
    expect(parsed!.records[0]!.destinationIpAddress).toBe(
      "fe80::202:b3ff:fe1e:8329",
    );
    expect(parsed!.records[0]!.sourcePort).toBe(52000);
    expect(parsed!.records[0]!.destinationPort).toBe(443);

    // Timestamps absent from the template fall back to the export time.
    expect(parsed!.records[0]!.flowStartAt.getTime()).toBe(UNIX_SECS * 1000);
    expect(parsed!.records[0]!.flowEndAt.getTime()).toBe(UNIX_SECS * 1000);
  });

  test("skips unknown field types by their declared length", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    /*
     * An unknown 3-byte field sits BETWEEN known fields — if it were not
     * skipped by exactly its declared length, every field after it would
     * decode garbage.
     */
    const templateWithUnknownField: TemplateSpec = {
      templateId: 259,
      fields: [
        { fieldType: IPV4_SRC_ADDR, fieldLength: 4 },
        { fieldType: 61, fieldLength: 1 }, // DIRECTION — not extracted
        { fieldType: 9999, fieldLength: 3 }, // vendor-proprietary
        { fieldType: IPV4_DST_ADDR, fieldLength: 4 },
        { fieldType: L4_DST_PORT, fieldLength: 2 },
        { fieldType: PROTOCOL, fieldLength: 1 },
      ],
    };

    const record: Buffer = Buffer.alloc(15);
    record.writeUInt8(10, 0);
    record.writeUInt8(1, 1);
    record.writeUInt8(1, 2);
    record.writeUInt8(1, 3);
    record.writeUInt8(0xff, 4); // unknown field payloads: junk on purpose
    record.writeUInt8(0xde, 5);
    record.writeUInt8(0xad, 6);
    record.writeUInt8(0xbe, 7);
    record.writeUInt8(10, 8);
    record.writeUInt8(2, 9);
    record.writeUInt8(2, 10);
    record.writeUInt8(2, 11);
    record.writeUInt16BE(8080, 12);
    record.writeUInt8(17, 14);

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([
        buildTemplateFlowSet([templateWithUnknownField]),
        buildDataFlowSet(259, [record], 1), // 15 + 4 = 19, pad to 20
      ]),
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.records).toHaveLength(1);
    expect(parsed!.records[0]!.sourceIpAddress).toBe("10.1.1.1");
    expect(parsed!.records[0]!.destinationIpAddress).toBe("10.2.2.2");
    expect(parsed!.records[0]!.destinationPort).toBe(8080);
    expect(parsed!.records[0]!.protocolNumber).toBe(17);
  });

  test("skips options template FlowSets without losing FlowSet alignment", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    /*
     * Options template FlowSet (ID 1): templateId, scope length, option
     * length, then scope/option field definitions. The parser must skip it
     * wholesale and still decode the FlowSets after it.
     */
    const optionsTemplateFlowSet: Buffer = Buffer.alloc(4 + 14 + 2);
    optionsTemplateFlowSet.writeUInt16BE(1, 0); // FlowSet ID 1
    optionsTemplateFlowSet.writeUInt16BE(optionsTemplateFlowSet.length, 2);
    optionsTemplateFlowSet.writeUInt16BE(512, 4); // options template ID
    optionsTemplateFlowSet.writeUInt16BE(4, 6); // scope length: 1 field
    optionsTemplateFlowSet.writeUInt16BE(4, 8); // option length: 1 field
    optionsTemplateFlowSet.writeUInt16BE(1, 10); // scope: System
    optionsTemplateFlowSet.writeUInt16BE(4, 12); // scope field length
    optionsTemplateFlowSet.writeUInt16BE(34, 14); // option: SAMPLING_INTERVAL
    optionsTemplateFlowSet.writeUInt16BE(4, 16); // option field length

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([
        optionsTemplateFlowSet,
        buildTemplateFlowSet([STANDARD_TEMPLATE]),
        buildDataFlowSet(
          STANDARD_TEMPLATE_ID,
          [
            buildStandardRecord({
              srcAddr: [10, 0, 0, 1],
              dstAddr: [10, 0, 0, 2],
              packets: 1,
              octets: 60,
              first: SYS_UPTIME_MS - 1000,
              last: SYS_UPTIME_MS - 500,
              srcPort: 1234,
              dstPort: 80,
              prot: 6,
            }),
          ],
          1,
        ),
      ]),
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();
    // The options template must not be cached as a data template.
    expect(parsed!.templatesLearned).toBe(1);
    expect(parsed!.records).toHaveLength(1);
    expect(parsed!.records[0]!.destinationPort).toBe(80);
  });

  test("returns null only for a buffer that cannot be a v9 datagram", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    // Shorter than a header.
    expect(parser.parse(Buffer.alloc(10), EXPORTER_IP)).toBeNull();

    // Wrong version.
    expect(
      parser.parse(buildDatagram([], { version: 5 }), EXPORTER_IP),
    ).toBeNull();

    // A bare header with no FlowSets is valid — just empty.
    const headerOnly: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([]),
      EXPORTER_IP,
    );

    expect(headerOnly).not.toBeNull();
    expect(headerOnly!.records).toHaveLength(0);
    expect(headerOnly!.templatesLearned).toBe(0);
  });

  test("never throws on truncated datagrams and returns the records that decoded cleanly", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    parser.parse(
      buildDatagram([buildTemplateFlowSet([STANDARD_TEMPLATE])]),
      EXPORTER_IP,
    );

    const goodDataFlowSet: Buffer = buildDataFlowSet(
      STANDARD_TEMPLATE_ID,
      [
        buildStandardRecord({
          srcAddr: [10, 0, 0, 1],
          dstAddr: [10, 0, 0, 2],
          packets: 1,
          octets: 60,
          first: SYS_UPTIME_MS - 1000,
          last: SYS_UPTIME_MS - 500,
          srcPort: 1234,
          dstPort: 80,
          prot: 6,
        }),
      ],
      1,
    );

    /*
     * A second FlowSet declares 100 bytes but the datagram was cut after 8
     * — the walk must stop there and keep the first FlowSet's record.
     */
    const truncatedTail: Buffer = Buffer.alloc(8);
    truncatedTail.writeUInt16BE(300, 0);
    truncatedTail.writeUInt16BE(100, 2);

    const partial: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([goodDataFlowSet, truncatedTail]),
      EXPORTER_IP,
    );

    expect(partial).not.toBeNull();
    expect(partial!.records).toHaveLength(1);

    // A FlowSet length below its own 4-byte header can never advance.
    const bogusLength: Buffer = Buffer.alloc(4);
    bogusLength.writeUInt16BE(300, 0);
    bogusLength.writeUInt16BE(2, 2);

    const stopped: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([bogusLength]),
      EXPORTER_IP,
    );

    expect(stopped).not.toBeNull();
    expect(stopped!.records).toHaveLength(0);

    /*
     * A datagram cut mid-record: the data FlowSet's declared length
     * overruns the buffer, so none of it can be trusted.
     */
    const wholeDatagram: Buffer = buildDatagram([goodDataFlowSet]);
    const cutMidRecord: ParsedNetFlowV9Datagram | null = parser.parse(
      wholeDatagram.subarray(0, wholeDatagram.length - 10),
      EXPORTER_IP,
    );

    expect(cutMidRecord).not.toBeNull();
    expect(cutMidRecord!.records).toHaveLength(0);

    /*
     * A template cut mid-definition (fieldCount promises 10 fields, only 2
     * are present) must not be cached.
     */
    const truncatedTemplate: Buffer = Buffer.alloc(4 + 4 + 8);
    truncatedTemplate.writeUInt16BE(0, 0);
    truncatedTemplate.writeUInt16BE(truncatedTemplate.length, 2);
    truncatedTemplate.writeUInt16BE(999, 4); // template ID
    truncatedTemplate.writeUInt16BE(10, 6); // claims 10 fields
    truncatedTemplate.writeUInt16BE(IPV4_SRC_ADDR, 8);
    truncatedTemplate.writeUInt16BE(4, 10);
    truncatedTemplate.writeUInt16BE(IPV4_DST_ADDR, 12);
    truncatedTemplate.writeUInt16BE(4, 14);

    const badTemplate: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([truncatedTemplate]),
      EXPORTER_IP,
    );

    expect(badTemplate).not.toBeNull();
    expect(badTemplate!.templatesLearned).toBe(0);
  });

  test("decodes a flow stamped just before a sysUptime wrap as its real age", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    /*
     * The device's 32-bit ms uptime counter wrapped between the flow being
     * stamped and the export: record timestamps sit just below 2^32 while
     * the header's sysUptime restarted near zero. Same wrap-safe delta
     * interpretation as the v5 parser.
     */
    const datagram: Buffer = buildDatagram(
      [
        buildTemplateFlowSet([STANDARD_TEMPLATE]),
        buildDataFlowSet(
          STANDARD_TEMPLATE_ID,
          [
            buildStandardRecord({
              srcAddr: [10, 0, 0, 1],
              dstAddr: [10, 0, 0, 2],
              packets: 1,
              octets: 60,
              first: 0xffffffff - 59999, // 60s + 5s before the export
              last: 0xffffffff - 9999, // 10s + 5s before the export
              srcPort: 1,
              dstPort: 2,
              prot: 6,
            }),
          ],
          1,
        ),
      ],
      { sysUptime: 5000 }, // 5s after the wrap
    );

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      datagram,
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.records[0]!.flowStartAt.getTime()).toBe(
      UNIX_SECS * 1000 - 65000,
    );
    expect(parsed!.records[0]!.flowEndAt.getTime()).toBe(
      UNIX_SECS * 1000 - 15000,
    );
  });

  test("clamps a small positive uptime delta to the export time instead of backdating it a wrap period", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    const datagram: Buffer = buildDatagram([
      buildTemplateFlowSet([STANDARD_TEMPLATE]),
      buildDataFlowSet(
        STANDARD_TEMPLATE_ID,
        [
          buildStandardRecord({
            srcAddr: [10, 0, 0, 1],
            dstAddr: [10, 0, 0, 2],
            packets: 1,
            octets: 60,
            first: SYS_UPTIME_MS - 1000,
            last: SYS_UPTIME_MS + 50, // 50ms ahead of the header's sysUptime
            srcPort: 1,
            dstPort: 2,
            prot: 6,
          }),
        ],
        1,
      ),
    ]);

    const parsed: ParsedNetFlowV9Datagram | null = parser.parse(
      datagram,
      EXPORTER_IP,
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.records[0]!.flowStartAt.getTime()).toBe(
      UNIX_SECS * 1000 - 1000,
    );
    /*
     * v9 export time is whole seconds (no nanosecond residual), so the
     * +50ms exporter jitter clamps to the export time exactly — the point
     * is it is NOT ~49.7 days in the past.
     */
    expect(parsed!.records[0]!.flowEndAt.getTime()).toBe(UNIX_SECS * 1000);
  });

  test("expires cached templates after 30 minutes", () => {
    let nowMs: number = 1_800_000_000_000;

    const parser: NetFlowV9Parser = new NetFlowV9Parser({
      now: () => {
        return nowMs;
      },
    });

    const dataFlowSet: Buffer = buildDataFlowSet(
      STANDARD_TEMPLATE_ID,
      [
        buildStandardRecord({
          srcAddr: [10, 0, 0, 1],
          dstAddr: [10, 0, 0, 2],
          packets: 1,
          octets: 60,
          first: SYS_UPTIME_MS - 1000,
          last: SYS_UPTIME_MS - 500,
          srcPort: 1234,
          dstPort: 80,
          prot: 6,
        }),
      ],
      1,
    );

    parser.parse(
      buildDatagram([buildTemplateFlowSet([STANDARD_TEMPLATE])]),
      EXPORTER_IP,
    );

    // 29 minutes later the template is still fresh.
    nowMs += 29 * 60 * 1000;

    const fresh: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([dataFlowSet]),
      EXPORTER_IP,
    );

    expect(fresh).not.toBeNull();
    expect(fresh!.records).toHaveLength(1);

    // 31 minutes after learning, the template has aged out.
    nowMs += 2 * 60 * 1000;

    const stale: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([dataFlowSet]),
      EXPORTER_IP,
    );

    expect(stale).not.toBeNull();
    expect(stale!.records).toHaveLength(0);
    expect(stale!.dataFlowSetsSkippedForUnknownTemplate).toBe(1);

    // A template refresh restores decoding.
    parser.parse(
      buildDatagram([buildTemplateFlowSet([STANDARD_TEMPLATE])]),
      EXPORTER_IP,
    );

    const relearned: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([dataFlowSet]),
      EXPORTER_IP,
    );

    expect(relearned).not.toBeNull();
    expect(relearned!.records).toHaveLength(1);
  });

  test("evicts the oldest template once the cache exceeds its cap", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    // A minimal 1-byte-record template so 1000+ fit in one FlowSet.
    const minimalTemplate: (templateId: number) => TemplateSpec = (
      templateId: number,
    ) => {
      return {
        templateId: templateId,
        fields: [{ fieldType: PROTOCOL, fieldLength: 1 }],
      };
    };

    // Fill the cache to exactly its 1000-entry cap: templates 256..1255.
    const fillTemplates: Array<TemplateSpec> = [];

    for (let templateId: number = 256; templateId <= 1255; templateId++) {
      fillTemplates.push(minimalTemplate(templateId));
    }

    const filled: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([buildTemplateFlowSet(fillTemplates)]),
      EXPORTER_IP,
    );

    expect(filled).not.toBeNull();
    expect(filled!.templatesLearned).toBe(1000);

    // One more template pushes the cache over the cap, evicting the oldest.
    parser.parse(
      buildDatagram([buildTemplateFlowSet([minimalTemplate(1256)])]),
      EXPORTER_IP,
    );

    /*
     * No padding on these FlowSets: with a contrived 1-byte record,
     * padding bytes are indistinguishable from additional records (the
     * parser can only treat a remainder SHORTER than one record as
     * padding), so padding here would inflate the record count.
     */
    const protocolRecord: Buffer = Buffer.from([6]);

    // Template 256 (the oldest) is gone...
    const evicted: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([buildDataFlowSet(256, [protocolRecord])]),
      EXPORTER_IP,
    );

    expect(evicted).not.toBeNull();
    expect(evicted!.records).toHaveLength(0);
    expect(evicted!.dataFlowSetsSkippedForUnknownTemplate).toBe(1);

    // ...while its neighbour and the newcomer still decode.
    const survivor: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([
        buildDataFlowSet(257, [protocolRecord]),
        buildDataFlowSet(1256, [protocolRecord]),
      ]),
      EXPORTER_IP,
    );

    expect(survivor).not.toBeNull();
    expect(survivor!.records).toHaveLength(2);
    expect(survivor!.records[0]!.protocolNumber).toBe(6);
  });

  test("scopes templates to the exporter address and source ID", () => {
    const parser: NetFlowV9Parser = new NetFlowV9Parser();

    parser.parse(
      buildDatagram([buildTemplateFlowSet([STANDARD_TEMPLATE])]),
      EXPORTER_IP,
    );

    const dataFlowSet: Buffer = buildDataFlowSet(
      STANDARD_TEMPLATE_ID,
      [
        buildStandardRecord({
          srcAddr: [10, 0, 0, 1],
          dstAddr: [10, 0, 0, 2],
          packets: 1,
          octets: 60,
          first: SYS_UPTIME_MS - 1000,
          last: SYS_UPTIME_MS - 500,
          srcPort: 1234,
          dstPort: 80,
          prot: 6,
        }),
      ],
      1,
    );

    // Same template ID from a DIFFERENT exporter: not decodable.
    const otherExporter: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([dataFlowSet]),
      "198.51.100.99",
    );

    expect(otherExporter).not.toBeNull();
    expect(otherExporter!.records).toHaveLength(0);
    expect(otherExporter!.dataFlowSetsSkippedForUnknownTemplate).toBe(1);

    // Same exporter but a different source ID (another line card): also not.
    const otherSourceId: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([dataFlowSet], { sourceId: SOURCE_ID + 1 }),
      EXPORTER_IP,
    );

    expect(otherSourceId).not.toBeNull();
    expect(otherSourceId!.records).toHaveLength(0);

    // The (exporter, sourceId) pair that announced the template decodes.
    const matching: ParsedNetFlowV9Datagram | null = parser.parse(
      buildDatagram([dataFlowSet]),
      EXPORTER_IP,
    );

    expect(matching).not.toBeNull();
    expect(matching!.records).toHaveLength(1);
  });
});
