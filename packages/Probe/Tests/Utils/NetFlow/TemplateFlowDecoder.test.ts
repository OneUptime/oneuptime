import TemplateFlowDecoder, {
  MAX_PENDING_BYTES,
  MAX_PENDING_SETS_PER_TEMPLATE,
  MAX_SAMPLING_RATE,
  PENDING_TTL_MS,
  TemplateDecodeResult,
} from "../../../Utils/NetFlow/TemplateFlowDecoder";
import DecodedFlowRecord from "../../../Utils/NetFlow/DecodedFlowRecord";
import {
  FieldSpec,
  IE,
  IPFIX_EXPORT_TIME,
  IPV4_TEMPLATE,
  OptionsTemplateSpec,
  TemplateSpec,
  V9_SYS_UPTIME_MS,
  V9_UNIX_SECS,
  dataSet,
  encodeRecord,
  ipfixMessage,
  ipfixOptionsTemplateSet,
  ipfixTemplateSet,
  ipv4Record,
  netFlowV9Datagram,
  netFlowV9OptionsTemplateSet,
  netFlowV9TemplateSet,
} from "./FlowFixtureBuilders";
import { describe, expect, test } from "@jest/globals";

/*
 * The state a template-based collector has to keep, per exporter, to read
 * NetFlow v9 and IPFIX at all: sampling rates from option records (for the
 * whole exporter, or per sampler / selector the flows name), data that
 * arrives before its template (held, bounded, decoded later), and exporters
 * that share an address behind NAT.
 */

const EXPORT_MS: number = IPFIX_EXPORT_TIME * 1000;

const FLOW: {
  source: string;
  destination: string;
  sourcePort: number;
  destinationPort: number;
  protocol: number;
  octets: number;
  packets: number;
  startMs: number;
  endMs: number;
} = {
  source: "10.0.0.5",
  destination: "198.51.100.20",
  sourcePort: 51000,
  destinationPort: 443,
  protocol: 6,
  octets: 1500,
  packets: 3,
  startMs: EXPORT_MS - 10000,
  endMs: EXPORT_MS - 5000,
};

function ipfix(
  decoder: TemplateFlowDecoder,
  sets: Array<Buffer>,
  options?: { address?: string; port?: number; domain?: number },
): TemplateDecodeResult {
  const decoded: { result: TemplateDecodeResult } | null =
    decoder.decodeIpfix(
      ipfixMessage(sets, { observationDomainId: options?.domain ?? 0 }),
      options?.address ?? "192.0.2.1",
      options?.port ?? 50000,
    );
  expect(decoded).not.toBeNull();
  return decoded!.result;
}

function rates(result: TemplateDecodeResult): Array<number> {
  return result.records.map((record: DecodedFlowRecord): number => {
    return record.samplingRate;
  });
}

// An IPv4 template whose records name the sampler (selector) that saw them.
const SELECTOR_TEMPLATE: TemplateSpec = {
  templateId: 260,
  fields: [...IPV4_TEMPLATE.fields, { id: IE.selectorId, length: 4 }],
};

function selectorRecord(selectorId: number): Buffer {
  return Buffer.concat([
    ipv4Record(FLOW),
    encodeRecord([{ id: IE.selectorId, length: 4 }], [selectorId]),
  ]);
}

// Cisco IOS XE: a selector option table - 1 out of (interval + space).
const SELECTOR_OPTIONS: OptionsTemplateSpec = {
  templateId: 900,
  scopeFieldCount: 1,
  fields: [
    { id: IE.selectorId, length: 4 },
    { id: IE.selectorAlgorithm, length: 2 },
    { id: IE.samplingPacketInterval, length: 4 },
    { id: IE.samplingPacketSpace, length: 4 },
  ],
};

describe("sampling rates from option records", () => {
  test("a selector's packet interval and space give its rate, for the flows that name it", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixOptionsTemplateSet([SELECTOR_OPTIONS]),
      dataSet(900, [
        // Selector 1: 1 out of 100; selector 2: 1 out of 4096.
        encodeRecord(SELECTOR_OPTIONS.fields, [1, 1, 1, 99]),
        encodeRecord(SELECTOR_OPTIONS.fields, [2, 1, 1, 4095]),
      ]),
      ipfixTemplateSet([SELECTOR_TEMPLATE]),
      dataSet(260, [selectorRecord(1), selectorRecord(2), selectorRecord(3)]),
    ]);

    // Selector 3 was never described: every packet, as far as anyone knows.
    expect(rates(result)).toEqual([100, 4096, 1]);
  });

  test("NetFlow v9 sampler options (FLOW_SAMPLER_ID, mode, random interval) apply to the flows naming the sampler", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const samplerOptionFields: Array<FieldSpec> = [
      { id: IE.samplerId, length: 1 },
      { id: IE.samplerMode, length: 1 },
      { id: IE.samplerRandomInterval, length: 4 },
    ];
    const template: TemplateSpec = {
      templateId: 1024,
      fields: [...IPV4_TEMPLATE.fields, { id: IE.samplerId, length: 1 }],
    };

    const decoded: { result: TemplateDecodeResult } | null =
      decoder.decodeNetFlowV9(
        netFlowV9Datagram([
          netFlowV9OptionsTemplateSet(
            4096,
            [{ id: 1, length: 4 }], // scope: System
            samplerOptionFields,
          ),
          dataSet(4096, [
            encodeRecord(
              [{ id: 0, length: 4 }, ...samplerOptionFields],
              [0, 1, 2, 10],
            ),
          ]),
          netFlowV9TemplateSet([template]),
          dataSet(1024, [
            Buffer.concat([
              ipv4Record(FLOW),
              encodeRecord([{ id: IE.samplerId, length: 1 }], [1]),
            ]),
          ]),
        ]),
        "192.0.2.1",
        2055,
      );

    expect(rates(decoded!.result)).toEqual([10]);
  });

  test("a rate with no sampler named is the exporter's rate for every flow", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const options: OptionsTemplateSpec = {
      templateId: 901,
      scopeFieldCount: 1,
      fields: [
        { id: IE.meteringProcessId, length: 4 },
        { id: IE.samplingInterval, length: 4 },
      ],
    };

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixOptionsTemplateSet([options]),
      dataSet(901, [encodeRecord(options.fields, [1, 512])]),
      ipfixTemplateSet([IPV4_TEMPLATE]),
      dataSet(256, [ipv4Record(FLOW), ipv4Record(FLOW)]),
    ]);

    expect(rates(result)).toEqual([512, 512]);
  });

  test("n-of-N sampling (size out of population) is population / size", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const options: OptionsTemplateSpec = {
      templateId: 902,
      scopeFieldCount: 1,
      fields: [
        { id: IE.meteringProcessId, length: 4 },
        { id: IE.samplingSize, length: 4 },
        { id: IE.samplingPopulation, length: 4 },
      ],
    };

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixOptionsTemplateSet([options]),
      dataSet(902, [encodeRecord(options.fields, [1, 10, 1000])]),
      ipfixTemplateSet([IPV4_TEMPLATE]),
      dataSet(256, [ipv4Record(FLOW)]),
    ]);

    expect(rates(result)).toEqual([100]);
  });

  test("a rate in the flow record itself wins over the exporter's", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const options: OptionsTemplateSpec = {
      templateId: 903,
      scopeFieldCount: 1,
      fields: [
        { id: IE.meteringProcessId, length: 4 },
        { id: IE.samplingInterval, length: 4 },
      ],
    };
    const template: TemplateSpec = {
      templateId: 261,
      fields: [...IPV4_TEMPLATE.fields, { id: IE.samplingInterval, length: 4 }],
    };

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixOptionsTemplateSet([options]),
      dataSet(903, [encodeRecord(options.fields, [1, 512])]),
      ipfixTemplateSet([template]),
      dataSet(261, [
        Buffer.concat([
          ipv4Record(FLOW),
          encodeRecord([{ id: IE.samplingInterval, length: 4 }], [64]),
        ]),
      ]),
    ]);

    expect(rates(result)).toEqual([64]);
  });

  test("an absurd rate is held to the maximum, and a rate below 1 means every packet", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const template: TemplateSpec = {
      templateId: 262,
      fields: [...IPV4_TEMPLATE.fields, { id: IE.samplingInterval, length: 4 }],
    };

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([template]),
      dataSet(262, [
        Buffer.concat([
          ipv4Record(FLOW),
          encodeRecord([{ id: IE.samplingInterval, length: 4 }], [0xffffffff]),
        ]),
        Buffer.concat([
          ipv4Record(FLOW),
          encodeRecord([{ id: IE.samplingInterval, length: 4 }], [0]),
        ]),
      ]),
    ]);

    expect(rates(result)).toEqual([MAX_SAMPLING_RATE, 1]);
  });

  test("an option record in the same message as data that waited applies to that data", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    // The data comes first (the exporter restarted; the probe knows nothing yet).
    const early: TemplateDecodeResult = ipfix(decoder, [
      dataSet(260, [selectorRecord(1)]),
    ]);
    expect(early.dataSetsWaitingForTemplate).toBe(1);

    /*
     * The refresh carries the data template BEFORE the sampler table: the
     * held data is decoded at the end of the message, after the rate is known.
     */
    const refresh: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([SELECTOR_TEMPLATE]),
      ipfixOptionsTemplateSet([SELECTOR_OPTIONS]),
      dataSet(900, [encodeRecord(SELECTOR_OPTIONS.fields, [1, 1, 1, 19])]),
    ]);

    expect(refresh.dataSetsReplayed).toBe(1);
    expect(rates(refresh)).toEqual([20]);
  });

  test("sampling state belongs to one exporter", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const options: OptionsTemplateSpec = {
      templateId: 904,
      scopeFieldCount: 1,
      fields: [
        { id: IE.meteringProcessId, length: 4 },
        { id: IE.samplingInterval, length: 4 },
      ],
    };

    ipfix(
      decoder,
      [
        ipfixOptionsTemplateSet([options]),
        dataSet(904, [encodeRecord(options.fields, [1, 1000])]),
      ],
      { address: "192.0.2.1" },
    );

    const other: TemplateDecodeResult = ipfix(
      decoder,
      [ipfixTemplateSet([IPV4_TEMPLATE]), dataSet(256, [ipv4Record(FLOW)])],
      { address: "192.0.2.2" },
    );

    expect(rates(other)).toEqual([1]);
  });
});

describe("exporters behind one NAT", () => {
  test("two exporters on one address, numbering their templates alike, never share them", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    // Router A: template 256 is the IPv4 5-tuple.
    ipfix(decoder, [ipfixTemplateSet([IPV4_TEMPLATE])], {
      address: "203.0.113.9",
      port: 40001,
    });

    // Router B, same NAT address, other port: its template 256 is different.
    const otherLayout: TemplateSpec = {
      templateId: 256,
      fields: [
        { id: IE.destinationIPv4Address, length: 4 },
        { id: IE.sourceIPv4Address, length: 4 },
        { id: IE.octetDeltaCount, length: 4 },
        { id: IE.protocolIdentifier, length: 1 },
      ],
    };
    ipfix(decoder, [ipfixTemplateSet([otherLayout])], {
      address: "203.0.113.9",
      port: 40002,
    });

    const fromA: TemplateDecodeResult = ipfix(
      decoder,
      [dataSet(256, [ipv4Record(FLOW)])],
      { address: "203.0.113.9", port: 40001 },
    );
    const fromB: TemplateDecodeResult = ipfix(
      decoder,
      [
        dataSet(256, [
          encodeRecord(otherLayout.fields, ["10.9.9.9", "10.8.8.8", 77, 17]),
        ]),
      ],
      { address: "203.0.113.9", port: 40002 },
    );

    expect(fromA.records[0]!.sourceIpAddress).toBe("10.0.0.5");
    expect(fromA.records[0]!.octets).toBe(1500);
    expect(fromB.records[0]!.sourceIpAddress).toBe("10.8.8.8");
    expect(fromB.records[0]!.destinationIpAddress).toBe("10.9.9.9");
    expect(fromB.records[0]!.octets).toBe(77);
  });

  test("NetFlow v9 and IPFIX templates of one exporter are kept apart", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    ipfix(decoder, [ipfixTemplateSet([IPV4_TEMPLATE])]);

    const v9: { result: TemplateDecodeResult } | null =
      decoder.decodeNetFlowV9(
        netFlowV9Datagram([dataSet(256, [ipv4Record(FLOW)])]),
        "192.0.2.1",
        50000,
      );

    expect(v9!.result.records).toHaveLength(0);
    expect(v9!.result.dataSetsWaitingForTemplate).toBe(1);
  });
});

describe("data that arrives before its template", () => {
  test("is held, then decoded with the times of the datagram it came in", () => {
    let now: number = 1_800_000_000_000;
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder({
      now: (): number => {
        return now;
      },
    });

    const template: TemplateSpec = {
      templateId: 300,
      fields: [
        { id: IE.sourceIPv4Address, length: 4 },
        { id: IE.destinationIPv4Address, length: 4 },
        { id: IE.octetDeltaCount, length: 4 },
        { id: IE.flowStartSysUpTime, length: 4 },
        { id: IE.flowEndSysUpTime, length: 4 },
      ],
    };

    // A v9 datagram whose header ties uptime to the wall clock.
    const early: { result: TemplateDecodeResult } | null =
      decoder.decodeNetFlowV9(
        netFlowV9Datagram([
          dataSet(300, [
            encodeRecord(template.fields, [
              "10.0.0.1",
              "10.0.0.2",
              100,
              V9_SYS_UPTIME_MS - 4000,
              V9_SYS_UPTIME_MS - 3000,
            ]),
          ]),
        ]),
        "192.0.2.1",
      );

    expect(early!.result.dataSetsWaitingForTemplate).toBe(1);
    expect(decoder.getPendingDataSetCount()).toBe(1);

    // The template arrives a minute later, in a datagram with LATER times.
    now += 60000;
    const refresh: { result: TemplateDecodeResult } | null =
      decoder.decodeNetFlowV9(
        netFlowV9Datagram([netFlowV9TemplateSet([template])], {
          sysUptime: V9_SYS_UPTIME_MS + 60000,
          unixSecs: V9_UNIX_SECS + 60,
        }),
        "192.0.2.1",
      );

    expect(refresh!.result.dataSetsReplayed).toBe(1);
    expect(refresh!.result.records[0]!.flowStartAt.getTime()).toBe(
      V9_UNIX_SECS * 1000 - 4000,
    );
    expect(decoder.getPendingDataSetCount()).toBe(0);
    expect(decoder.getPendingByteCount()).toBe(0);
  });

  test("held data older than the holding time is never decoded", () => {
    let now: number = 1_800_000_000_000;
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder({
      now: (): number => {
        return now;
      },
    });

    ipfix(decoder, [dataSet(256, [ipv4Record(FLOW)])]);
    expect(decoder.getPendingDataSetCount()).toBe(1);

    now += PENDING_TTL_MS + 1;

    const refresh: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([IPV4_TEMPLATE]),
    ]);

    expect(refresh.dataSetsReplayed).toBe(0);
    expect(refresh.records).toHaveLength(0);
    expect(decoder.getPendingDataSetCount()).toBe(0);
    expect(decoder.getPendingByteCount()).toBe(0);
  });

  test("past its per-template limit, more data for a missing template is dropped and counted", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    for (let i: number = 0; i < MAX_PENDING_SETS_PER_TEMPLATE; i++) {
      expect(
        ipfix(decoder, [dataSet(256, [ipv4Record(FLOW)])])
          .dataSetsWaitingForTemplate,
      ).toBe(1);
    }

    const over: TemplateDecodeResult = ipfix(decoder, [
      dataSet(256, [ipv4Record(FLOW)]),
    ]);

    expect(over.dataSetsWaitingForTemplate).toBe(0);
    expect(over.dataSetsDroppedWithoutTemplate).toBe(1);

    const refresh: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([IPV4_TEMPLATE]),
    ]);

    expect(refresh.dataSetsReplayed).toBe(MAX_PENDING_SETS_PER_TEMPLATE);
    expect(refresh.records).toHaveLength(MAX_PENDING_SETS_PER_TEMPLATE);
  });

  test("held data is bounded in bytes across every exporter", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    // ~60 KB data sets from many exporters until the holding area is full.
    const big: Buffer = dataSet(
      256,
      Array.from({ length: 1000 }, () => {
        return ipv4Record(FLOW);
      }),
    );

    let held: number = 0;
    let dropped: number = 0;

    for (let exporter: number = 0; exporter < 200; exporter++) {
      const result: TemplateDecodeResult = ipfix(decoder, [big], {
        address: `10.1.${Math.floor(exporter / 250)}.${exporter % 250}`,
      });
      held += result.dataSetsWaitingForTemplate;
      dropped += result.dataSetsDroppedWithoutTemplate;
    }

    expect(dropped).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(0);
    expect(decoder.getPendingByteCount()).toBeLessThanOrEqual(
      MAX_PENDING_BYTES,
    );
  });
});

describe("what a flow record carries", () => {
  test("a firewall's initiator and responder counts (Cisco ASA NSEL) are the flow's bytes and packets", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const template: TemplateSpec = {
      templateId: 263,
      fields: [
        { id: IE.sourceIPv4Address, length: 4 },
        { id: IE.destinationIPv4Address, length: 4 },
        { id: IE.sourceTransportPort, length: 2 },
        { id: IE.destinationTransportPort, length: 2 },
        { id: IE.protocolIdentifier, length: 1 },
        { id: IE.initiatorOctets, length: 4 },
        { id: IE.responderOctets, length: 4 },
        { id: IE.initiatorPackets, length: 4 },
        { id: IE.responderPackets, length: 4 },
        { id: IE.observationTimeMilliseconds, length: 8 },
      ],
    };

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([template]),
      dataSet(263, [
        encodeRecord(template.fields, [
          "10.0.0.5",
          "198.51.100.20",
          51000,
          443,
          6,
          2000,
          50000,
          20,
          40,
          BigInt(EXPORT_MS - 3000),
        ]),
      ]),
    ]);

    expect(result.records[0]!.octets).toBe(52000);
    expect(result.records[0]!.packets).toBe(60);
    expect(result.records[0]!.flowStartAt.getTime()).toBe(EXPORT_MS - 3000);
  });

  test("counts after the device's own processing stand in for missing ones", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const template: TemplateSpec = {
      templateId: 264,
      fields: [
        { id: IE.sourceIPv4Address, length: 4 },
        { id: IE.destinationIPv4Address, length: 4 },
        { id: IE.postOctetDeltaCount, length: 4 },
        { id: IE.postPacketDeltaCount, length: 4 },
      ],
    };

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([template]),
      dataSet(264, [
        encodeRecord(template.fields, ["10.0.0.5", "10.0.0.6", 700, 7]),
      ]),
    ]);

    expect(result.records[0]!.octets).toBe(700);
    expect(result.records[0]!.packets).toBe(7);
  });

  test("an IPv6 flow reads its addresses in their short form", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();
    const template: TemplateSpec = {
      templateId: 265,
      fields: [
        { id: IE.sourceIPv6Address, length: 16 },
        { id: IE.destinationIPv6Address, length: 16 },
        { id: IE.octetDeltaCount, length: 4 },
        { id: IE.protocolIdentifier, length: 1 },
      ],
    };

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([template]),
      dataSet(265, [
        encodeRecord(template.fields, [
          "2001:db8:0:0:0:0:0:1",
          "fe80:0:0:0:1:0:0:2",
          100,
          58,
        ]),
      ]),
    ]);

    expect(result.records[0]!.sourceIpAddress).toBe("2001:db8::1");
    expect(result.records[0]!.destinationIpAddress).toBe("fe80::1:0:0:2");
  });

  test("a flow time after the export (a clock running ahead) is the export time", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([IPV4_TEMPLATE]),
      dataSet(256, [
        ipv4Record({
          ...FLOW,
          startMs: EXPORT_MS + 3600000,
          endMs: EXPORT_MS + 3700000,
        }),
      ]),
    ]);

    expect(result.records[0]!.flowStartAt.getTime()).toBe(EXPORT_MS);
    expect(result.records[0]!.flowEndAt.getTime()).toBe(EXPORT_MS);
  });

  test("an end before its start is moved to the start", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([IPV4_TEMPLATE]),
      dataSet(256, [
        ipv4Record({
          ...FLOW,
          startMs: EXPORT_MS - 1000,
          endMs: EXPORT_MS - 9000,
        }),
      ]),
    ]);

    expect(result.records[0]!.flowEndAt.getTime()).toBe(EXPORT_MS - 1000);
  });

  test("a template whose records would be zero bytes long is never learned", () => {
    const decoder: TemplateFlowDecoder = new TemplateFlowDecoder();

    const result: TemplateDecodeResult = ipfix(decoder, [
      ipfixTemplateSet([
        {
          templateId: 266,
          fields: [
            { id: IE.sourceIPv4Address, length: 0 },
            { id: IE.destinationIPv4Address, length: 0 },
          ],
        },
      ]),
    ]);

    expect(result.templatesLearned).toBe(0);
    expect(decoder.getCachedTemplateCount()).toBe(0);
  });
});
