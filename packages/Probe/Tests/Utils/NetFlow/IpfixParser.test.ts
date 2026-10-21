import IpfixParser, {
  ParsedIpfixMessage,
} from "../../../Utils/NetFlow/IpfixParser";
import DecodedFlowRecord from "../../../Utils/NetFlow/DecodedFlowRecord";
import {
  IE,
  IPFIX_EXPORT_TIME,
  IPV4_TEMPLATE,
  TemplateSpec,
  VARIABLE_LENGTH,
  dataSet,
  encodeRecord,
  ipfixMessage,
  ipfixOptionsTemplateSet,
  ipfixTemplateSet,
  ipfixTemplateWithdrawalSet,
  ipv4Record,
} from "./FlowFixtureBuilders";
import { describe, expect, test } from "@jest/globals";

/*
 * IPFIX (RFC 7011): what makes it more than NetFlow v9 with a new number -
 * its 16-byte header and declared message length, set IDs 2 and 3, vendor
 * fields, fields whose length each record gives, every kind of timestamp,
 * template withdrawal - decoded by the probe's collector.
 */

const EXPORTER: string = "192.0.2.1";
const EXPORT_MS: number = IPFIX_EXPORT_TIME * 1000;

function parse(
  parser: IpfixParser,
  message: Buffer,
  port: number = 4739,
): ParsedIpfixMessage {
  const parsed: ParsedIpfixMessage | null = parser.parse(
    message,
    EXPORTER,
    port,
  );
  expect(parsed).not.toBeNull();
  return parsed!;
}

const HTTPS_DOWNLOAD: {
  source: string;
  destination: string;
  sourcePort: number;
  destinationPort: number;
  protocol: number;
  tcpFlags: number;
  ingress: number;
  egress: number;
  octets: number;
  packets: number;
  startMs: number;
  endMs: number;
} = {
  source: "198.51.100.20",
  destination: "10.0.0.5",
  sourcePort: 443,
  destinationPort: 51000,
  protocol: 6,
  tcpFlags: 0x18,
  ingress: 3,
  egress: 7,
  octets: 1234567,
  packets: 900,
  startMs: EXPORT_MS - 60000,
  endMs: EXPORT_MS - 2000,
};

describe("IpfixParser", () => {
  test("reads the header, a template and its data from one message", () => {
    const parser: IpfixParser = new IpfixParser();

    const parsed: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage(
        [
          ipfixTemplateSet([IPV4_TEMPLATE]),
          dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)]),
        ],
        { sequenceNumber: 77, observationDomainId: 5 },
      ),
    );

    expect(parsed.header.version).toBe(10);
    expect(parsed.header.exportTime).toBe(IPFIX_EXPORT_TIME);
    expect(parsed.header.sequenceNumber).toBe(77);
    expect(parsed.header.observationDomainId).toBe(5);
    expect(parsed.templatesLearned).toBe(1);
    expect(parsed.isMalformed).toBe(false);
    expect(parsed.records).toHaveLength(1);

    const record: DecodedFlowRecord = parsed.records[0]!;
    expect(record.sourceIpAddress).toBe("198.51.100.20");
    expect(record.destinationIpAddress).toBe("10.0.0.5");
    expect(record.sourcePort).toBe(443);
    expect(record.destinationPort).toBe(51000);
    expect(record.protocolNumber).toBe(6);
    expect(record.tcpFlags).toBe(0x18);
    expect(record.inputInterfaceIndex).toBe(3);
    expect(record.outputInterfaceIndex).toBe(7);
    expect(record.octets).toBe(1234567);
    expect(record.packets).toBe(900);
    expect(record.flowStartAt.getTime()).toBe(EXPORT_MS - 60000);
    expect(record.flowEndAt.getTime()).toBe(EXPORT_MS - 2000);
    expect(record.samplingRate).toBe(1);
  });

  test("returns null for what cannot be an IPFIX message", () => {
    const parser: IpfixParser = new IpfixParser();

    expect(parser.parse(Buffer.alloc(0), EXPORTER)).toBeNull();
    expect(parser.parse(Buffer.alloc(15), EXPORTER)).toBeNull();

    // NetFlow v9 is not IPFIX.
    const v9: Buffer = ipfixMessage([]);
    v9.writeUInt16BE(9, 0);
    expect(parser.parse(v9, EXPORTER)).toBeNull();

    // A declared length shorter than the header itself.
    expect(
      parser.parse(ipfixMessage([], { declaredLength: 12 }), EXPORTER),
    ).toBeNull();
  });

  test("a message cut short keeps the sets that arrived whole and says it was cut", () => {
    const parser: IpfixParser = new IpfixParser();
    const whole: Buffer = ipfixMessage([
      ipfixTemplateSet([IPV4_TEMPLATE]),
      dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)]),
      dataSet(256, [ipv4Record({ ...HTTPS_DOWNLOAD, destinationPort: 22 })]),
    ]);

    // Drop the last 10 bytes: the second data set no longer fits.
    const parsed: ParsedIpfixMessage = parse(
      parser,
      whole.subarray(0, whole.length - 10),
    );

    expect(parsed.isMalformed).toBe(true);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]!.destinationPort).toBe(51000);
  });

  test("bytes past the declared message length are not part of the message", () => {
    const parser: IpfixParser = new IpfixParser();
    const message: Buffer = ipfixMessage([
      ipfixTemplateSet([IPV4_TEMPLATE]),
      dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)]),
    ]);

    // Trailing garbage that would read as a set header is ignored.
    const parsed: ParsedIpfixMessage = parse(
      parser,
      Buffer.concat([message, Buffer.from([1, 0, 0, 8, 9, 9, 9, 9])]),
    );

    expect(parsed.isMalformed).toBe(false);
    expect(parsed.records).toHaveLength(1);
  });

  test("vendor (enterprise) fields are skipped, even one numbered like a counter", () => {
    const parser: IpfixParser = new IpfixParser();
    const template: TemplateSpec = {
      templateId: 300,
      fields: [
        { id: IE.sourceIPv4Address, length: 4 },
        { id: IE.destinationIPv4Address, length: 4 },
        // Cisco's private element 1 - not IANA's octetDeltaCount.
        { id: IE.octetDeltaCount, length: 8, enterpriseNumber: 9 },
        { id: IE.octetDeltaCount, length: 4 },
        { id: IE.packetDeltaCount, length: 4 },
        { id: IE.protocolIdentifier, length: 1 },
      ],
    };

    const parsed: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([
        ipfixTemplateSet([template]),
        dataSet(300, [
          encodeRecord(template.fields, [
            "10.1.1.1",
            "10.2.2.2",
            BigInt(999999999),
            5000,
            5,
            17,
          ]),
        ]),
      ]),
    );

    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]!.octets).toBe(5000);
    expect(parsed.records[0]!.packets).toBe(5);
    expect(parsed.records[0]!.protocolNumber).toBe(17);
  });

  test("variable-length fields (short and long length prefix) keep every field after them aligned", () => {
    const parser: IpfixParser = new IpfixParser();
    const template: TemplateSpec = {
      templateId: 301,
      fields: [
        { id: IE.sourceIPv4Address, length: 4 },
        { id: IE.interfaceName, length: VARIABLE_LENGTH },
        { id: IE.destinationIPv4Address, length: 4 },
        { id: IE.octetDeltaCount, length: 4 },
        { id: IE.packetDeltaCount, length: 4 },
        { id: IE.protocolIdentifier, length: 1 },
      ],
    };

    const shortName: Buffer = Buffer.from("Gi0/1");
    const longName: Buffer = Buffer.alloc(300, 0x41);

    const parsed: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([
        ipfixTemplateSet([template]),
        dataSet(301, [
          encodeRecord(template.fields, [
            "10.0.0.1",
            shortName,
            "10.0.0.2",
            100,
            1,
            6,
          ]),
          encodeRecord(template.fields, [
            "10.0.0.3",
            longName,
            "10.0.0.4",
            200,
            2,
            17,
          ]),
        ]),
      ]),
    );

    expect(parsed.isMalformed).toBe(false);
    expect(
      parsed.records.map((record: DecodedFlowRecord) => {
        return [
          record.sourceIpAddress,
          record.destinationIpAddress,
          record.octets,
          record.protocolNumber,
        ];
      }),
    ).toEqual([
      ["10.0.0.1", "10.0.0.2", 100, 6],
      ["10.0.0.3", "10.0.0.4", 200, 17],
    ]);
  });

  test("a variable-length field that runs past its set ends the walk without throwing", () => {
    const parser: IpfixParser = new IpfixParser();
    const template: TemplateSpec = {
      templateId: 302,
      fields: [
        { id: IE.sourceIPv4Address, length: 4 },
        { id: IE.interfaceName, length: VARIABLE_LENGTH },
      ],
    };

    // Declares 200 bytes of name but carries 3.
    const broken: Buffer = Buffer.concat([
      Buffer.from([10, 0, 0, 1, 200]),
      Buffer.from("abc"),
    ]);

    const parsed: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([ipfixTemplateSet([template]), dataSet(302, [broken])]),
    );

    expect(parsed.isMalformed).toBe(true);
    expect(parsed.records).toHaveLength(0);
  });

  test("every kind of IPFIX timestamp lands on the same wall clock", () => {
    const startMs: number = EXPORT_MS - 90000;
    const endMs: number = EXPORT_MS - 30000;

    const ntp: (ms: number) => Buffer = (ms: number): Buffer => {
      const buffer: Buffer = Buffer.alloc(8);
      const seconds: number = Math.floor(ms / 1000) + 2208988800;
      buffer.writeUInt32BE(seconds, 0);
      buffer.writeUInt32BE(Math.round(((ms % 1000) / 1000) * 0x100000000), 4);
      return buffer;
    };

    const variants: Array<{
      name: string;
      fields: Array<{ id: number; length: number }>;
      values: Array<number | bigint | Buffer>;
    }> = [
      {
        name: "seconds",
        fields: [
          { id: IE.flowStartSeconds, length: 4 },
          { id: IE.flowEndSeconds, length: 4 },
        ],
        values: [startMs / 1000, endMs / 1000],
      },
      {
        name: "milliseconds",
        fields: [
          { id: IE.flowStartMilliseconds, length: 8 },
          { id: IE.flowEndMilliseconds, length: 8 },
        ],
        values: [BigInt(startMs), BigInt(endMs)],
      },
      {
        name: "NTP microseconds",
        fields: [
          { id: IE.flowStartMicroseconds, length: 8 },
          { id: IE.flowEndMicroseconds, length: 8 },
        ],
        values: [ntp(startMs), ntp(endMs)],
      },
      {
        name: "delta microseconds before the export",
        fields: [
          { id: IE.flowStartDeltaMicroseconds, length: 4 },
          { id: IE.flowEndDeltaMicroseconds, length: 4 },
        ],
        values: [(EXPORT_MS - startMs) * 1000, (EXPORT_MS - endMs) * 1000],
      },
    ];

    variants.forEach((variant: (typeof variants)[number], index: number) => {
      const parser: IpfixParser = new IpfixParser();
      const template: TemplateSpec = {
        templateId: 400 + index,
        fields: [
          { id: IE.sourceIPv4Address, length: 4 },
          { id: IE.destinationIPv4Address, length: 4 },
          { id: IE.octetDeltaCount, length: 4 },
          ...variant.fields,
        ],
      };

      const parsed: ParsedIpfixMessage = parse(
        parser,
        ipfixMessage([
          ipfixTemplateSet([template]),
          dataSet(template.templateId, [
            encodeRecord(template.fields, [
              "10.0.0.1",
              "10.0.0.2",
              100,
              ...variant.values,
            ]),
          ]),
        ]),
      );

      expect([variant.name, parsed.records[0]!.flowStartAt.getTime()]).toEqual([
        variant.name,
        startMs,
      ]);
      expect([variant.name, parsed.records[0]!.flowEndAt.getTime()]).toEqual([
        variant.name,
        endMs,
      ]);
    });
  });

  test("uptimes become wall clock with the boot time an option record gives, else the export time", () => {
    const template: TemplateSpec = {
      templateId: 500,
      fields: [
        { id: IE.sourceIPv4Address, length: 4 },
        { id: IE.destinationIPv4Address, length: 4 },
        { id: IE.octetDeltaCount, length: 4 },
        { id: IE.flowStartSysUpTime, length: 4 },
        { id: IE.flowEndSysUpTime, length: 4 },
      ],
    };
    const record: Buffer = encodeRecord(template.fields, [
      "10.0.0.1",
      "10.0.0.2",
      100,
      50000,
      60000,
    ]);

    // Without a boot time an uptime cannot be placed: the export time stands in.
    const blind: IpfixParser = new IpfixParser();
    const unplaced: ParsedIpfixMessage = parse(
      blind,
      ipfixMessage([ipfixTemplateSet([template]), dataSet(500, [record])]),
    );
    expect(unplaced.records[0]!.flowStartAt.getTime()).toBe(EXPORT_MS);

    // The device booted two minutes before the export.
    const bootMs: number = EXPORT_MS - 120000;
    const options: TemplateSpec & { scopeFieldCount: number } = {
      templateId: 600,
      scopeFieldCount: 1,
      fields: [
        { id: IE.meteringProcessId, length: 4 },
        { id: IE.systemInitTimeMilliseconds, length: 8 },
      ],
    };

    const informed: IpfixParser = new IpfixParser();
    const placed: ParsedIpfixMessage = parse(
      informed,
      ipfixMessage([
        ipfixOptionsTemplateSet([options]),
        dataSet(600, [encodeRecord(options.fields, [1, BigInt(bootMs)])]),
        ipfixTemplateSet([template]),
        dataSet(500, [record]),
      ]),
    );

    expect(placed.records[0]!.flowStartAt.getTime()).toBe(bootMs + 50000);
    expect(placed.records[0]!.flowEndAt.getTime()).toBe(bootMs + 60000);
  });

  test("a withdrawn template stops decoding; its data waits for the template again", () => {
    const parser: IpfixParser = new IpfixParser();

    parse(parser, ipfixMessage([ipfixTemplateSet([IPV4_TEMPLATE])]));

    const withdrawn: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([ipfixTemplateWithdrawalSet([256])]),
    );
    expect(withdrawn.templatesWithdrawn).toBe(1);

    const waiting: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)])]),
    );
    expect(waiting.records).toHaveLength(0);
    expect(waiting.dataSetsWaitingForTemplate).toBe(1);

    // Re-announced: the waiting data decodes with it.
    const back: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([ipfixTemplateSet([IPV4_TEMPLATE])]),
    );
    expect(back.dataSetsReplayed).toBe(1);
    expect(back.records).toHaveLength(1);
  });

  test("withdrawing template ID 2 withdraws every data template of the domain", () => {
    const parser: IpfixParser = new IpfixParser();
    const second: TemplateSpec = { ...IPV4_TEMPLATE, templateId: 257 };

    parse(parser, ipfixMessage([ipfixTemplateSet([IPV4_TEMPLATE, second])]));

    const withdrawn: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([ipfixTemplateWithdrawalSet([2])]),
    );

    expect(withdrawn.templatesWithdrawn).toBe(2);

    const after: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([
        dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)]),
        dataSet(257, [ipv4Record(HTTPS_DOWNLOAD)]),
      ]),
    );
    expect(after.records).toHaveLength(0);
    expect(after.dataSetsWaitingForTemplate).toBe(2);
  });

  test("templates belong to one observation domain", () => {
    const parser: IpfixParser = new IpfixParser();

    parse(
      parser,
      ipfixMessage([ipfixTemplateSet([IPV4_TEMPLATE])], {
        observationDomainId: 1,
      }),
    );

    const otherDomain: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)])], {
        observationDomainId: 2,
      }),
    );
    expect(otherDomain.records).toHaveLength(0);

    const sameDomain: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)])], {
        observationDomainId: 1,
      }),
    );
    expect(sameDomain.records).toHaveLength(1);
  });

  test("an options template whose scope count is 0, or larger than its fields, is malformed", () => {
    for (const scopeFieldCount of [0, 3]) {
      const parser: IpfixParser = new IpfixParser();
      const parsed: ParsedIpfixMessage = parse(
        parser,
        ipfixMessage([
          ipfixOptionsTemplateSet([
            {
              templateId: 700,
              scopeFieldCount: scopeFieldCount,
              fields: [
                { id: IE.selectorId, length: 4 },
                { id: IE.samplingPacketInterval, length: 4 },
              ],
            },
          ]),
        ]),
      );

      expect(parsed.isMalformed).toBe(true);
      expect(parsed.templatesLearned).toBe(0);
    }
  });

  test("a template that claims a reserved ID is malformed and not learned", () => {
    const parser: IpfixParser = new IpfixParser();
    const parsed: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([ipfixTemplateSet([{ ...IPV4_TEMPLATE, templateId: 255 }])]),
    );

    expect(parsed.isMalformed).toBe(true);
    expect(parsed.templatesLearned).toBe(0);
  });

  test("set padding after the last record is not read as a record", () => {
    const parser: IpfixParser = new IpfixParser();
    const parsed: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([
        ipfixTemplateSet([IPV4_TEMPLATE], 3),
        dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)], 3),
      ]),
    );

    expect(parsed.isMalformed).toBe(false);
    expect(parsed.records).toHaveLength(1);
  });

  test("an exporter that names its own address in an option record is known by it", () => {
    const parser: IpfixParser = new IpfixParser();
    const options: TemplateSpec & { scopeFieldCount: number } = {
      templateId: 800,
      scopeFieldCount: 1,
      fields: [
        { id: IE.exporterIPv4Address, length: 4 },
        { id: IE.meteringProcessId, length: 4 },
      ],
    };

    const parsed: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([
        ipfixOptionsTemplateSet([options]),
        dataSet(800, [encodeRecord(options.fields, ["10.255.0.1", 1])]),
        ipfixTemplateSet([IPV4_TEMPLATE]),
        dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)]),
      ]),
    );

    expect(parsed.exporterAddress).toBe("10.255.0.1");

    // And it stays known by it in the messages after.
    const later: ParsedIpfixMessage = parse(
      parser,
      ipfixMessage([dataSet(256, [ipv4Record(HTTPS_DOWNLOAD)])]),
    );
    expect(later.exporterAddress).toBe("10.255.0.1");
  });
});
