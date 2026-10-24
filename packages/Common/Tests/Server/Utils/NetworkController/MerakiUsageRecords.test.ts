import {
  KIBIBYTE,
  MAX_APPLICATION_ROWS,
  MAX_CLIENT_ROWS,
  TEXT_LIMITS,
  buildApplicationRecords,
  buildClientRecords,
  buildUplinkRecords,
  capRecords,
  cleanMac,
  cleanSerial,
  cleanText,
  readAppliances,
  readCount,
  readOctets,
} from "../../../../Server/Utils/NetworkController/Meraki/MerakiUsageRecords";
import {
  NetworkControllerAppliance,
  NetworkTrafficUsageRecord,
} from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import { NetworkTrafficUsageKind } from "../../../../Types/NetFlow/NetworkTrafficUsage";
import { describe, expect, test } from "@jest/globals";

/*
 * Meraki's answers as NetworkTrafficUsage records, nothing of them trusted:
 * units turned into bytes (the uplinks are bytes, the traffic analytics and
 * client usage kibibytes), every number a whole, non-negative count, every
 * text cleaned and cut to the length its column keeps, and a busy window
 * held to the rows a page needs - with every total kept whole.
 */

const START: Date = new Date("2026-10-24T10:00:00.000Z");
const END: Date = new Date("2026-10-24T12:00:00.000Z");

function sumBytes(records: Array<NetworkTrafficUsageRecord>): {
  sent: number;
  received: number;
} {
  let sent: number = 0;
  let received: number = 0;

  for (const record of records) {
    sent += record.sentOctets;
    received += record.receivedOctets;
  }

  return { sent, received };
}

describe("cleaning outside text", () => {
  test("control characters become one space, and the ends are trimmed", () => {
    expect(cleanText("  Branch\u0000\t\n 12\u007f\u0085Main  ", 64)).toBe(
      "Branch 12 Main",
    );
  });

  test("cut to the column's length", () => {
    expect(cleanText("x".repeat(500), TEXT_LIMITS.serial)).toHaveLength(
      TEXT_LIMITS.serial,
    );
  });

  test("a cut never leaves half of a character", () => {
    const text: string = `${"a".repeat(9)}\u{1F600}tail`;
    const cleaned: string = cleanText(text, 10);

    expect(cleaned).toBe("a".repeat(9));
    expect(Buffer.from(cleaned, "utf8").toString("utf8")).toBe(cleaned);
  });

  test("a number is text too; anything else is nothing", () => {
    expect(cleanText(549236, 32)).toBe("549236");
    expect(cleanText(undefined, 32)).toBe("");
    expect(cleanText(null, 32)).toBe("");
    expect(cleanText({ name: "x" }, 32)).toBe("");
    expect(cleanText(["x"], 32)).toBe("");
    expect(cleanText(true, 32)).toBe("");
  });

  test("a megabyte of it is cut before it is looked at", () => {
    const startedAt: number = Date.now();

    expect(
      cleanText("\u0001 a".repeat(400_000), 128).length,
    ).toBeLessThanOrEqual(128);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test("a MAC is lower case, a serial upper case", () => {
    expect(cleanMac(" 00:18:0A:12:34:56 ")).toBe("00:18:0a:12:34:56");
    expect(cleanSerial("q2xx-abcd-1234")).toBe("Q2XX-ABCD-1234");
  });
});

describe("reading numbers", () => {
  test.each([
    [1234, 1, 1234],
    ["1234", 1, 1234],
    [1.5, KIBIBYTE, 1536],
    ["0.25", KIBIBYTE, 256],
    [0, 1, 0],
    [-5, 1, 0],
    ["", 1, 0],
    ["  ", 1, 0],
    ["12 MB", 1, 0],
    [NaN, 1, 0],
    [Infinity, 1, 0],
    [null, 1, 0],
    [undefined, 1, 0],
    [true, 1, 0],
    [[5], 1, 0],
    [{ value: 5 }, 1, 0],
  ])(
    "bytes of %p (x%p) are %p",
    (value: unknown, multiplier: number, expected: number) => {
      expect(readOctets(value, multiplier)).toBe(expected);
    },
  );

  test("bytes never pass the largest safe integer", () => {
    expect(readOctets(1e300)).toBe(Number.MAX_SAFE_INTEGER);
    expect(readOctets(Number.MAX_SAFE_INTEGER, KIBIBYTE)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  test.each([
    [42.9, 1000, 42],
    ["17", 1000, 17],
    [70000, 65535, 65535],
    [-1, 1000, 0],
    ["", 1000, 0],
    [null, 1000, 0],
    [[5], 1000, 0],
    [true, 1000, 0],
  ])(
    "a count of %p (at most %p) is %p",
    (value: unknown, max: number, expected: number) => {
      expect(readCount(value, max)).toBe(expected);
    },
  );
});

describe("the appliances of a device list", () => {
  test("serial, name, model, MAC and network; nothing else kept", () => {
    expect(
      readAppliances([
        {
          serial: "q2xx-aaaa-0001",
          name: " MX\tBranch 1 ",
          model: "MX68",
          mac: "00:18:0A:00:00:01",
          networkId: "L_1",
          lanIp: "10.0.0.1",
          tags: ["store"],
        },
      ]),
    ).toEqual([
      {
        serial: "Q2XX-AAAA-0001",
        name: "MX Branch 1",
        model: "MX68",
        mac: "00:18:0a:00:00:01",
        controllerNetworkId: "L_1",
      },
    ]);
  });

  test("no serial, no network, a repeat or not an object: skipped", () => {
    const appliances: Array<NetworkControllerAppliance> = readAppliances([
      { serial: "", networkId: "L_1" },
      { serial: "Q2XX-AAAA-0002" },
      { serial: "Q2XX-AAAA-0003", networkId: "L_3" },
      { serial: "q2xx-aaaa-0003", networkId: "L_4" },
      "Q2XX-AAAA-0004",
      null,
      [],
      7,
    ]);

    expect(
      appliances.map((appliance: NetworkControllerAppliance) => {
        return [appliance.serial, appliance.controllerNetworkId];
      }),
    ).toEqual([["Q2XX-AAAA-0003", "L_3"]]);
  });
});

describe("uplink usage", () => {
  const appliances: Map<string, NetworkControllerAppliance> = new Map([
    [
      "Q2XX-AAAA-0001",
      {
        serial: "Q2XX-AAAA-0001",
        name: "MX Branch 1",
        model: "MX68",
        mac: "00:18:0a:00:00:01",
        controllerNetworkId: "L_1",
      },
    ],
  ]);

  test("a record per appliance and uplink, in bytes as Meraki sends them", () => {
    const records: Array<NetworkTrafficUsageRecord> = buildUplinkRecords({
      answer: [
        {
          networkId: "L_1",
          name: "Branch 1",
          byUplink: [
            {
              serial: "Q2XX-AAAA-0001",
              interface: "wan1",
              sent: 1200,
              received: 34000,
            },
            {
              serial: "Q2XX-AAAA-0001",
              interface: "cellular",
              sent: 10,
              received: 0,
            },
          ],
        },
      ],
      appliances,
      networkNames: new Map(),
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      kind: NetworkTrafficUsageKind.Uplink,
      controllerNetworkId: "L_1",
      controllerNetworkName: "Branch 1",
      deviceSerial: "Q2XX-AAAA-0001",
      deviceName: "MX Branch 1",
      interfaceName: "wan1",
      sentOctets: 1200,
      receivedOctets: 34000,
      application: "",
      clientKey: "",
      windowStartAt: START,
      windowEndAt: END,
    });
    expect(records[1]!.interfaceName).toBe("cellular");
  });

  test("an uplink that carried nothing is left out", () => {
    expect(
      buildUplinkRecords({
        answer: [
          {
            networkId: "L_1",
            byUplink: [
              {
                serial: "Q2XX-AAAA-0001",
                interface: "wan2",
                sent: 0,
                received: 0,
              },
              {
                serial: "Q2XX-AAAA-0001",
                interface: "wan2",
                sent: -4,
                received: "x",
              },
            ],
          },
        ],
        appliances,
        networkNames: new Map(),
        windowStartAt: START,
        windowEndAt: END,
      }),
    ).toEqual([]);
  });

  test("the network's name from the listing when the answer has none; an unknown appliance has no name", () => {
    const records: Array<NetworkTrafficUsageRecord> = buildUplinkRecords({
      answer: [
        {
          networkId: "L_9",
          byUplink: [{ serial: "Q2XX-ZZZZ-9999", sent: 5, received: 5 }],
        },
      ],
      appliances,
      networkNames: new Map([["L_9", "Warehouse"]]),
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(records[0]).toMatchObject({
      controllerNetworkName: "Warehouse",
      deviceSerial: "Q2XX-ZZZZ-9999",
      deviceName: "",
      interfaceName: "uplink",
    });
  });

  test("rows without a network, or whose uplinks are not a list, are skipped", () => {
    expect(
      buildUplinkRecords({
        answer: [
          { byUplink: [{ serial: "A", sent: 5, received: 5 }] },
          { networkId: "L_1", byUplink: "wan1" },
          { networkId: "L_1", byUplink: [null, 5, "x"] },
          "L_1",
          null,
        ],
        appliances,
        networkNames: new Map(),
        windowStartAt: START,
        windowEndAt: END,
      }),
    ).toEqual([]);
  });
});

describe("traffic analytics", () => {
  test("kibibytes become bytes, the protocol upper case, the port a port", () => {
    const records: Array<NetworkTrafficUsageRecord> = buildApplicationRecords({
      answer: [
        {
          application: "Microsoft Teams",
          destination: "teams.microsoft.com",
          protocol: "udp",
          port: 3478,
          sent: 1.5,
          recv: 1024,
          numClients: 12,
          activeTime: 7200,
          flows: 120,
        },
      ],
      controllerNetworkId: "L_1",
      controllerNetworkName: "Branch 1",
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(records).toEqual([
      expect.objectContaining({
        kind: NetworkTrafficUsageKind.Application,
        controllerNetworkId: "L_1",
        controllerNetworkName: "Branch 1",
        application: "Microsoft Teams",
        destination: "teams.microsoft.com",
        protocol: "UDP",
        port: 3478,
        sentOctets: 1536,
        receivedOctets: 1024 * 1024,
        flows: 120,
        clients: 12,
        deviceSerial: "",
        windowStartAt: START,
        windowEndAt: END,
      }),
    ]);
  });

  test("a row without an application is named by its destination", () => {
    const records: Array<NetworkTrafficUsageRecord> = buildApplicationRecords({
      answer: [
        { application: "", destination: "203.0.113.7", sent: 1, recv: 1 },
      ],
      controllerNetworkId: "L_1",
      controllerNetworkName: "Branch 1",
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(records[0]!.application).toBe("203.0.113.7");
  });

  test("a port past 65535 is held to it, an empty row is left out", () => {
    const records: Array<NetworkTrafficUsageRecord> = buildApplicationRecords({
      answer: [
        { application: "Odd", port: 99999, sent: 1, recv: 0 },
        { application: "Idle", sent: 0, recv: 0, flows: 0 },
        { application: "Flows only", sent: 0, recv: 0, flows: 3 },
        "row",
      ],
      controllerNetworkId: "L_1",
      controllerNetworkName: "Branch 1",
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(
      records.map((record: NetworkTrafficUsageRecord) => {
        return [record.application, record.port];
      }),
    ).toEqual([
      ["Odd", 65535],
      ["Flows only", 0],
    ]);
  });

  test("a busy window keeps the busiest rows and sums the rest, its totals whole", () => {
    const answer: Array<unknown> = Array.from(
      { length: MAX_APPLICATION_ROWS + 250 },
      (_: unknown, index: number) => {
        return {
          application: `App ${index}`,
          destination: `host${index}.example`,
          sent: index + 1,
          recv: 2 * (index + 1),
          flows: 1,
        };
      },
    );

    const records: Array<NetworkTrafficUsageRecord> = buildApplicationRecords({
      answer,
      controllerNetworkId: "L_1",
      controllerNetworkName: "Branch 1",
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(records).toHaveLength(MAX_APPLICATION_ROWS + 1);

    const rest: NetworkTrafficUsageRecord = records[records.length - 1]!;
    expect(rest.application).toBe("");
    expect(rest.destination).toBe("");
    expect(rest.flows).toBe(250);

    // The busiest is first; the smallest kept is busier than the rest's largest.
    expect(records[0]!.application).toBe(`App ${MAX_APPLICATION_ROWS + 249}`);
    expect(records[MAX_APPLICATION_ROWS - 1]!.application).toBe("App 250");

    let expectedSent: number = 0;
    for (let index: number = 0; index < answer.length; index++) {
      expectedSent += (index + 1) * KIBIBYTE;
    }

    expect(sumBytes(records)).toEqual({
      sent: expectedSent,
      received: 2 * expectedSent,
    });
  });
});

describe("client usage", () => {
  test("a record per client, its usage in bytes", () => {
    const records: Array<NetworkTrafficUsageRecord> = buildClientRecords({
      answer: [
        {
          id: "k74272e",
          mac: "22:33:44:55:66:77",
          ip: "10.0.0.25",
          description: "Kiosk 3",
          manufacturer: "Apple",
          usage: { sent: 138.0, recv: 61.0 },
        },
      ],
      controllerNetworkId: "L_1",
      controllerNetworkName: "Branch 1",
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(records).toEqual([
      expect.objectContaining({
        kind: NetworkTrafficUsageKind.Client,
        clientKey: "k74272e",
        clientName: "Kiosk 3",
        clientIp: "10.0.0.25",
        clientMac: "22:33:44:55:66:77",
        clientManufacturer: "Apple",
        sentOctets: 138 * KIBIBYTE,
        receivedOctets: 61 * KIBIBYTE,
        controllerNetworkName: "Branch 1",
      }),
    ]);
  });

  test("a client without an ID is keyed by its MAC, else its address", () => {
    const records: Array<NetworkTrafficUsageRecord> = buildClientRecords({
      answer: [
        { mac: "AA:BB:CC:DD:EE:FF", usage: { sent: 1, recv: 1 } },
        { ip: "10.0.0.9", usage: { sent: 1, recv: 1 } },
      ],
      controllerNetworkId: "L_1",
      controllerNetworkName: "Branch 1",
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(
      records.map((record: NetworkTrafficUsageRecord) => {
        return record.clientKey;
      }),
    ).toEqual(["aa:bb:cc:dd:ee:ff", "10.0.0.9"]);
  });

  test("a client that sent and received nothing, or has no usage, is left out", () => {
    expect(
      buildClientRecords({
        answer: [
          { id: "a", usage: { sent: 0, recv: 0 } },
          { id: "b" },
          { id: "c", usage: "lots" },
        ],
        controllerNetworkId: "L_1",
        controllerNetworkName: "Branch 1",
        windowStartAt: START,
        windowEndAt: END,
      }),
    ).toEqual([]);
  });

  test("a campus window keeps the busiest clients and one row for the others", () => {
    const answer: Array<unknown> = Array.from(
      { length: MAX_CLIENT_ROWS * 10 },
      (_: unknown, index: number) => {
        return {
          id: `k${index}`,
          usage: { sent: index % 7, recv: index % 11 },
        };
      },
    );

    const records: Array<NetworkTrafficUsageRecord> = buildClientRecords({
      answer,
      controllerNetworkId: "L_1",
      controllerNetworkName: "Campus",
      windowStartAt: START,
      windowEndAt: END,
    });

    expect(records.length).toBe(MAX_CLIENT_ROWS + 1);
    expect(records[records.length - 1]!.clientKey).toBe("");

    let sent: number = 0;
    let received: number = 0;
    for (let index: number = 0; index < answer.length; index++) {
      sent += (index % 7) * KIBIBYTE;
      received += (index % 11) * KIBIBYTE;
    }

    expect(sumBytes(records)).toEqual({ sent, received });
  });
});

describe("holding a window to its rows", () => {
  function record(
    sentOctets: number,
    flows: number,
    name: string,
  ): NetworkTrafficUsageRecord {
    return {
      ...buildApplicationRecords({
        answer: [{ application: name, sent: 1, recv: 0 }],
        controllerNetworkId: "L_1",
        controllerNetworkName: "Branch 1",
        windowStartAt: START,
        windowEndAt: END,
      })[0]!,
      sentOctets,
      flows,
    };
  }

  test("as many as the limit are kept as they are", () => {
    const records: Array<NetworkTrafficUsageRecord> = [
      record(1, 0, "a"),
      record(2, 0, "b"),
    ];

    expect(
      capRecords(records, 2, () => {
        throw new Error("nothing to sum");
      }),
    ).toBe(records);
  });

  test("ties in bytes go to the row with more flows", () => {
    const capped: Array<NetworkTrafficUsageRecord> = capRecords(
      [record(5, 1, "few"), record(5, 9, "many"), record(1, 0, "small")],
      1,
      (rest: Array<NetworkTrafficUsageRecord>) => {
        return { ...rest[0]!, application: "" };
      },
    );

    expect(capped[0]!.application).toBe("many");
    expect(capped[1]!.sentOctets).toBe(6);
  });
});
