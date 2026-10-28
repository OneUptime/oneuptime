import NetworkFlowIngest, {
  FlowIngestResult,
  MAX_ADDRESS_NAMES_PER_REQUEST,
  MAX_FLOW_SAMPLING_RATE,
} from "../../../../Server/Utils/NetworkFlow/NetworkFlowIngest";
import {
  FlowExporterAttribution,
  FlowProbe,
} from "../../../../Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import { JSONObject } from "../../../../Types/JSON";
import NetworkFlowFormat from "../../../../Types/NetFlow/NetworkFlowFormat";
import NetworkFlowRecord from "../../../../Types/NetFlow/NetworkFlowRecord";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What ingest makes of what a probe forwards: which records are flows at
 * all, what an older probe's records read as, and where each flow lands -
 * on every device its exporter is, in the project's bucket when the
 * exporter is nobody's yet (a project's own probe), or nowhere (a global
 * probe with no project to keep it for).
 */

const INGESTED_AT: Date = new Date("2026-09-01T12:00:00.000Z");

const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();
const DEVICE: ObjectID = ObjectID.generate();
const OTHER_PROJECT_DEVICE: ObjectID = ObjectID.generate();
const PROBE: ObjectID = ObjectID.generate();

const PROJECT_PROBE: FlowProbe = { id: PROBE, projectId: PROJECT };
const GLOBAL_PROBE: FlowProbe = { id: PROBE, projectId: null };

function raw(overrides: JSONObject = {}): JSONObject {
  return {
    exporterIpAddress: "10.0.0.1",
    sourceIpAddress: "10.0.0.5",
    destinationIpAddress: "198.51.100.20",
    sourcePort: 0,
    destinationPort: 443,
    protocolNumber: 6,
    octets: 1500,
    packets: 3,
    flowStartAt: "2026-09-01T11:59:00.000Z",
    flowEndAt: "2026-09-01T11:59:30.000Z",
    inputInterfaceIndex: 1,
    outputInterfaceIndex: 2,
    tcpFlags: 24,
    tos: 0,
    flowFormat: "IPFIX",
    samplingRate: 100,
    flowCount: 4,
    ...overrides,
  };
}

describe("NetworkFlowIngest.deserializeFlowRecord", () => {
  test("reads every field a current probe sends", () => {
    const record: NetworkFlowRecord | null =
      NetworkFlowIngest.deserializeFlowRecord(raw(), INGESTED_AT);

    expect(record).toEqual({
      exporterIpAddress: "10.0.0.1",
      sourceIpAddress: "10.0.0.5",
      destinationIpAddress: "198.51.100.20",
      sourcePort: 0,
      destinationPort: 443,
      protocolNumber: 6,
      octets: 1500,
      packets: 3,
      flowStartAt: new Date("2026-09-01T11:59:00.000Z"),
      flowEndAt: new Date("2026-09-01T11:59:30.000Z"),
      inputInterfaceIndex: 1,
      outputInterfaceIndex: 2,
      tcpFlags: 24,
      tos: 0,
      flowFormat: NetworkFlowFormat.Ipfix,
      samplingRate: 100,
      flowCount: 4,
    } as NetworkFlowRecord);
  });

  test("an older probe's record - no format, rate or count - is one unsampled record of unknown format", () => {
    const old: JSONObject = raw();
    delete old["flowFormat"];
    delete old["samplingRate"];
    delete old["flowCount"];

    const record: NetworkFlowRecord | null =
      NetworkFlowIngest.deserializeFlowRecord(old, INGESTED_AT);

    expect(record!.flowFormat).toBeUndefined();
    expect(record!.samplingRate).toBe(1);
    expect(record!.flowCount).toBe(1);
  });

  test("a format nobody sends is no format; a rate or count past its bound is the default", () => {
    const record: NetworkFlowRecord | null =
      NetworkFlowIngest.deserializeFlowRecord(
        raw({
          flowFormat: "NetFlow v8",
          samplingRate: MAX_FLOW_SAMPLING_RATE + 1,
          flowCount: 0,
        }),
        INGESTED_AT,
      );

    expect(record!.flowFormat).toBeUndefined();
    expect(record!.samplingRate).toBe(1);
    expect(record!.flowCount).toBe(1);
  });

  test.each([
    ["no exporter", { exporterIpAddress: "" }],
    ["no source", { sourceIpAddress: undefined }],
    ["no destination", { destinationIpAddress: 7 }],
    ["an address longer than any address", { sourceIpAddress: "1".repeat(80) }],
    ["a port past 65535", { destinationPort: 70000 }],
    ["a negative port", { sourcePort: -1 }],
    ["a protocol past 255", { protocolNumber: 300 }],
    ["no byte count", { octets: null }],
    ["a packet count that is not a number", { packets: "lots" }],
  ])("a record with %s is malformed", (_name: string, change: JSONObject) => {
    expect(
      NetworkFlowIngest.deserializeFlowRecord(raw(change), INGESTED_AT),
    ).toBeNull();
  });

  test("anything that is not a record is malformed", () => {
    for (const value of [null, undefined, "flow", 7, [raw()]]) {
      expect(
        NetworkFlowIngest.deserializeFlowRecord(value, INGESTED_AT),
      ).toBeNull();
    }
  });

  test("a time that does not parse, or lies far in the future, is the ingest time", () => {
    const unparsed: NetworkFlowRecord | null =
      NetworkFlowIngest.deserializeFlowRecord(
        raw({ flowStartAt: "yesterday-ish", flowEndAt: undefined }),
        INGESTED_AT,
      );

    expect(unparsed!.flowStartAt.getTime()).toBe(INGESTED_AT.getTime());
    // A missing end is the start.
    expect(unparsed!.flowEndAt.getTime()).toBe(INGESTED_AT.getTime());

    const future: NetworkFlowRecord | null =
      NetworkFlowIngest.deserializeFlowRecord(
        raw({
          flowStartAt: "2027-01-01T00:00:00.000Z",
          flowEndAt: "2027-01-01T00:00:00.000Z",
        }),
        INGESTED_AT,
      );

    expect(future!.flowStartAt.getTime()).toBe(INGESTED_AT.getTime());
  });

  test("an end before the start is the start", () => {
    const record: NetworkFlowRecord | null =
      NetworkFlowIngest.deserializeFlowRecord(
        raw({
          flowStartAt: "2026-09-01T11:59:00.000Z",
          flowEndAt: "2026-09-01T11:00:00.000Z",
        }),
        INGESTED_AT,
      );

    expect(record!.flowEndAt.getTime()).toBe(record!.flowStartAt.getTime());
  });
});

describe("NetworkFlowIngest.buildRows", () => {
  test("a flow lands on every device its exporter is, each row in that device's project", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: GLOBAL_PROBE,
      rawRecords: [raw()],
      ingestedAt: INGESTED_AT,
      attribute: async (): Promise<FlowExporterAttribution> => {
        return {
          devices: [
            { networkDeviceId: DEVICE, projectId: PROJECT },
            {
              networkDeviceId: OTHER_PROJECT_DEVICE,
              projectId: OTHER_PROJECT,
            },
          ],
          unmatchedProjectId: null,
        };
      },
    });

    expect(result.rows).toHaveLength(2);
    expect(
      result.rows.map((row: JSONObject) => {
        return [row["projectId"], row["networkDeviceId"]];
      }),
    ).toEqual([
      [PROJECT.toString(), DEVICE.toString()],
      [OTHER_PROJECT.toString(), OTHER_PROJECT_DEVICE.toString()],
    ]);
  });

  test("a row carries the probe, the format, the rate and the count, as ClickHouse values", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: PROJECT_PROBE,
      rawRecords: [raw()],
      ingestedAt: INGESTED_AT,
      attribute: async (): Promise<FlowExporterAttribution> => {
        return {
          devices: [{ networkDeviceId: DEVICE, projectId: PROJECT }],
          unmatchedProjectId: null,
        };
      },
    });

    expect(result.rows[0]).toMatchObject({
      probeId: PROBE.toString(),
      exporterIp: "10.0.0.1",
      srcIp: "10.0.0.5",
      dstIp: "198.51.100.20",
      srcPort: 0,
      dstPort: 443,
      protocol: 6,
      inputInterfaceIndex: 1,
      outputInterfaceIndex: 2,
      octets: 1500,
      packets: 3,
      flowFormat: "IPFIX",
      samplingRate: 100,
      flowCount: 4,
      flowStartAt: "2026-09-01 11:59:00.000000000",
    });
    expect(typeof result.rows[0]!["_id"]).toBe("string");
  });

  test("on a project's own probe, an exporter that is nobody's yet is kept for the project", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: PROJECT_PROBE,
      rawRecords: [raw({ exporterIpAddress: "10.9.9.9" })],
      ingestedAt: INGESTED_AT,
      attribute: async (): Promise<FlowExporterAttribution> => {
        return { devices: [], unmatchedProjectId: PROJECT };
      },
    });

    expect(result.unmatchedKept).toBe(1);
    expect(result.droppedUnmatched).toBe(0);
    expect(result.rows[0]).toMatchObject({
      projectId: PROJECT.toString(),
      networkDeviceId: PROJECT.toString(),
      exporterIp: "10.9.9.9",
    });
  });

  test("on a global probe, an exporter that is nobody's is dropped - there is no project to keep it for", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: GLOBAL_PROBE,
      rawRecords: [raw(), raw()],
      ingestedAt: INGESTED_AT,
      attribute: async (): Promise<FlowExporterAttribution> => {
        return { devices: [], unmatchedProjectId: null };
      },
    });

    expect(result.rows).toHaveLength(0);
    expect(result.droppedUnmatched).toBe(2);
  });

  test("each exporter is matched once per batch, however many flows it sent", async () => {
    const asked: Array<string> = [];

    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: PROJECT_PROBE,
      rawRecords: [
        raw(),
        raw(),
        raw({ exporterIpAddress: "10.0.0.2" }),
        raw(),
        { not: "a flow" },
      ],
      ingestedAt: INGESTED_AT,
      attribute: async (
        _probe: FlowProbe,
        exporter: string,
      ): Promise<FlowExporterAttribution> => {
        asked.push(exporter);
        return {
          devices: [{ networkDeviceId: DEVICE, projectId: PROJECT }],
          unmatchedProjectId: null,
        };
      },
    });

    expect(asked).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(result.rows).toHaveLength(4);
    expect(result.malformed).toBe(1);
  });
});

/*
 * The DNS names a probe sends with its records (issue #5340): checked as
 * any outside text is, kept on the rows so a name read later is the name
 * the address had when its flows arrived, and - from a hosted instance's
 * shared global probes - kept for public addresses only.
 */
describe("NetworkFlowIngest.readAddressNames", () => {
  test("reads { address: name }, each address written one way, each name a DNS name as DNS wrote it", () => {
    const names: Map<string, string> = NetworkFlowIngest.readAddressNames({
      "10.0.0.5": "web-1.corp.example.",
      "2001:DB8:0:0:0:0:0:5": "V6-Host.Corp.Example",
    });

    expect(Array.from(names.entries())).toEqual([
      ["10.0.0.5", "web-1.corp.example"],
      // The root label's dot is dropped; the name's case is DNS's own.
      ["2001:db8::5", "V6-Host.Corp.Example"],
    ]);
  });

  test("drops what is not an address or not a name - never the batch", () => {
    const names: Map<string, string> = NetworkFlowIngest.readAddressNames({
      "not-an-address": "web-1.corp.example",
      "10.0.0.6": "<script>alert(1)</script>",
      "10.0.0.7": "has spaces in it",
      "10.0.0.8": 42,
      "10.0.0.9": "",
      "10.0.0.10": "5.0.0.10.in-addr.arpa",
      "10.0.0.11": "x".repeat(300),
      "10.0.0.12": "ok.corp.example",
    });

    expect(Array.from(names.entries())).toEqual([
      ["10.0.0.12", "ok.corp.example"],
    ]);
  });

  test("anything that is not an object of names is no names", () => {
    for (const value of [undefined, null, "names", 5, [["10.0.0.5", "a"]]]) {
      expect(NetworkFlowIngest.readAddressNames(value).size).toBe(0);
    }
  });

  test("at most MAX_ADDRESS_NAMES_PER_REQUEST names are read from one request", () => {
    const many: JSONObject = {};

    for (
      let index: number = 0;
      index < MAX_ADDRESS_NAMES_PER_REQUEST + 50;
      index++
    ) {
      many[
        `10.${Math.floor(index / 65536) % 256}.${Math.floor(index / 256) % 256}.${index % 256}`
      ] = `host-${index}.corp.example`;
    }

    expect(NetworkFlowIngest.readAddressNames(many).size).toBe(
      MAX_ADDRESS_NAMES_PER_REQUEST,
    );
  });
});

describe("NetworkFlowIngest.namesTheProbeMayGive", () => {
  const NAMES: Map<string, string> = new Map([
    ["10.0.0.5", "web-1.corp.example"],
    ["100.64.0.9", "cgnat.corp.example"],
    ["fd00::9", "ula.corp.example"],
    ["198.51.100.20", "www.example.com"],
    ["2001:db8::5", "v6.example.com"],
  ]);

  test("a project's own probe gives every name", () => {
    expect(
      NetworkFlowIngest.namesTheProbeMayGive({
        names: NAMES,
        probe: PROJECT_PROBE,
        isBillingEnabled: true,
      }),
    ).toBe(NAMES);
  });

  test("a self-hosted instance's own global probe gives every name", () => {
    expect(
      NetworkFlowIngest.namesTheProbeMayGive({
        names: NAMES,
        probe: GLOBAL_PROBE,
        isBillingEnabled: false,
      }),
    ).toBe(NAMES);
  });

  test("a hosted instance's shared global probe gives public addresses' names only", () => {
    expect(
      Array.from(
        NetworkFlowIngest.namesTheProbeMayGive({
          names: NAMES,
          probe: GLOBAL_PROBE,
          isBillingEnabled: true,
        }).keys(),
      ),
    ).toEqual(["198.51.100.20", "2001:db8::5"]);
  });
});

describe("NetworkFlowIngest.nameOf", () => {
  test("the name sent for a record's address, however the record writes it", () => {
    const names: Map<string, string> = new Map([
      ["2001:db8::5", "v6.corp.example"],
    ]);

    expect(NetworkFlowIngest.nameOf(names, "2001:DB8::5")).toBe(
      "v6.corp.example",
    );
    expect(NetworkFlowIngest.nameOf(names, "10.0.0.5")).toBe("");
    expect(NetworkFlowIngest.nameOf(undefined, "2001:db8::5")).toBe("");
    expect(NetworkFlowIngest.nameOf(new Map(), "2001:db8::5")).toBe("");
  });
});

describe("NetworkFlowIngest.buildRows: names", () => {
  const attribute: () => Promise<FlowExporterAttribution> =
    async (): Promise<FlowExporterAttribution> => {
      return {
        devices: [{ networkDeviceId: DEVICE, projectId: PROJECT }],
        unmatchedProjectId: null,
      };
    };

  test("each row keeps both ends' names as the probe sent them, '' for none", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: PROJECT_PROBE,
      rawRecords: [
        raw(),
        raw({ sourceIpAddress: "10.0.0.6", destinationIpAddress: "10.0.0.5" }),
      ],
      ingestedAt: INGESTED_AT,
      attribute: attribute,
      addressNames: new Map([
        ["10.0.0.5", "web-1.corp.example"],
        ["198.51.100.20", "www.example.com"],
      ]),
      isBillingEnabled: false,
    });

    expect(
      result.rows.map((row: JSONObject) => {
        return [row["srcName"], row["dstName"]];
      }),
    ).toEqual([
      ["web-1.corp.example", "www.example.com"],
      ["", "web-1.corp.example"],
    ]);
  });

  test("a probe older than the lookups sends none: every row's names are ''", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: PROJECT_PROBE,
      rawRecords: [raw()],
      ingestedAt: INGESTED_AT,
      attribute: attribute,
    });

    expect(result.rows[0]).toMatchObject({ srcName: "", dstName: "" });
  });

  test("a hosted instance's shared global probe: a private address's name is not kept", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: GLOBAL_PROBE,
      rawRecords: [raw()],
      ingestedAt: INGESTED_AT,
      attribute: attribute,
      addressNames: new Map([
        ["10.0.0.5", "internal.oneuptime.example"],
        ["198.51.100.20", "www.example.com"],
      ]),
      isBillingEnabled: true,
    });

    expect(result.rows[0]).toMatchObject({
      srcName: "",
      dstName: "www.example.com",
    });
  });

  test("the same global probe on a self-hosted instance keeps both", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: GLOBAL_PROBE,
      rawRecords: [raw()],
      ingestedAt: INGESTED_AT,
      attribute: attribute,
      addressNames: new Map([
        ["10.0.0.5", "web-1.corp.example"],
        ["198.51.100.20", "www.example.com"],
      ]),
      isBillingEnabled: false,
    });

    expect(result.rows[0]).toMatchObject({
      srcName: "web-1.corp.example",
      dstName: "www.example.com",
    });
  });

  test("an unmatched exporter's rows, kept for the project, carry the names too", async () => {
    const result: FlowIngestResult = await NetworkFlowIngest.buildRows({
      probe: PROJECT_PROBE,
      rawRecords: [raw({ exporterIpAddress: "10.9.9.9" })],
      ingestedAt: INGESTED_AT,
      attribute: async (): Promise<FlowExporterAttribution> => {
        return { devices: [], unmatchedProjectId: PROJECT };
      },
      addressNames: new Map([["10.0.0.5", "web-1.corp.example"]]),
      isBillingEnabled: false,
    });

    expect(result.rows[0]).toMatchObject({
      srcName: "web-1.corp.example",
      dstName: "",
    });
  });
});
