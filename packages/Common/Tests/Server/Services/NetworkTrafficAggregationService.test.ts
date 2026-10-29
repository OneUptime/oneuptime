import NetworkTrafficAggregationService, {
  NETWORK_TRAFFIC_FIND_NAMES_LIMIT,
  NETWORK_TRAFFIC_QUERY_TIMEOUT_SECONDS,
  NetworkTrafficAggregates,
  NetworkTrafficDnsName,
  NetworkTrafficQuery,
  SERVICE_PORT_SQL,
  keepNewestDnsName,
} from "../../../Server/Services/NetworkTrafficAggregationService";
import NetworkFlowService from "../../../Server/Services/NetworkFlowService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../Types/Exception/BadDataException";
import NetworkFlowApplicationUtil from "../../../Types/NetFlow/NetworkFlowApplication";
import {
  NETWORK_TRAFFIC_FIND_LIMIT,
  NETWORK_TRAFFIC_TOP_LIMIT,
} from "../../../Types/NetFlow/NetworkTraffic";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The SQL the Traffic pages send, as ClickHouse receives it. The real
 * ClickHouse suite (App Tests/Telemetry/NetworkTrafficClickhouse) runs it;
 * these pin what keeps it safe and bounded whatever the request says:
 *
 *   - every statement is held to the project, the window and the caller's
 *     devices - the readable ones kept, the blocked ones left out;
 *   - every value from the request is a bound parameter, never spliced;
 *   - every statement times out with 'throw' under the client's own timeout
 *     ('break' answers a grouped read that ran out of time with NOTHING);
 *   - every top table is capped at NETWORK_TRAFFIC_TOP_LIMIT rows;
 *   - no aggregate is aliased to a column name (ClickHouse would read the
 *     column inside another aggregate as the alias).
 */

const PROJECT: ObjectID = ObjectID.generate();
const READABLE: ObjectID = ObjectID.generate();
const BLOCKED: ObjectID = ObjectID.generate();

const HOSTILE: string = "10.0.0.1' OR 1=1 --";

function query(
  filters: NetworkTrafficQuery["filters"] = {},
): NetworkTrafficQuery {
  return {
    projectId: PROJECT,
    startTime: new Date("2026-09-01T10:00:00.000Z"),
    endTime: new Date("2026-09-01T11:00:00.000Z"),
    devices: { serviceIds: [READABLE], excludedServiceIds: [BLOCKED] },
    filters: filters,
  };
}

function allStatements(q: NetworkTrafficQuery): Array<[string, Statement]> {
  return [
    ["totals", NetworkTrafficAggregationService.buildTotalsStatement(q)],
    ["series", NetworkTrafficAggregationService.buildSeriesStatement(q, 60)],
    [
      "top sources",
      NetworkTrafficAggregationService.buildTopAddressStatement(q, "srcIp"),
    ],
    [
      "top destinations",
      NetworkTrafficAggregationService.buildTopAddressStatement(q, "dstIp"),
    ],
    [
      "top conversations",
      NetworkTrafficAggregationService.buildTopConversationsStatement(q),
    ],
    [
      "top applications",
      NetworkTrafficAggregationService.buildTopApplicationsStatement(q),
    ],
    [
      "top interfaces",
      NetworkTrafficAggregationService.buildTopInterfacesStatement(q),
    ],
    [
      "top devices",
      NetworkTrafficAggregationService.buildTopDevicesStatement(q),
    ],
    [
      "find by DNS name",
      NetworkTrafficAggregationService.buildNameSearchStatement(q, "fs01"),
    ],
    [
      "find's traffic",
      NetworkTrafficAggregationService.buildAddressTrafficStatement(q, [
        "10.0.0.5",
      ]),
    ],
  ];
}

const COLUMN_NAMES: Array<string> = [
  "octets",
  "packets",
  "flowCount",
  "samplingRate",
  "flowFormat",
  "probeId",
  "exporterIp",
  "srcIp",
  "dstIp",
  "srcPort",
  "dstPort",
  "protocol",
  "srcName",
  "dstName",
];

const ALIASED_TO_A_COLUMN: RegExp = new RegExp(
  `\\)\\s+AS\\s+(${COLUMN_NAMES.join("|")})\\b`,
);

// A name read with argMax and no condition: an unnamed newest flow wins.
const UNCONDITIONAL_NAME_ARGMAX: RegExp = /argMax\((srcName|dstName),/;

// Find's text searched in each end's name, as a bound parameter.
const SOURCE_NAME_SEARCH: RegExp =
  /positionCaseInsensitive\(srcName, \{p\d+:String\}\) > 0/;
const DESTINATION_NAME_SEARCH: RegExp =
  /positionCaseInsensitive\(dstName, \{p\d+:String\}\) > 0/;

// Anything that would read the text as a pattern.
const PATTERN_MATCHING: RegExp = /LIKE|match\(|REGEXP/i;

// The addresses found, as one bound array.
const SOURCE_IN_ADDRESSES: RegExp = /srcIp IN \(\{p\d+:Array\(String\)\}\)/;
const DESTINATION_IN_ADDRESSES: RegExp =
  /dstIp IN \(\{p\d+:Array\(String\)\}\)/;

describe("every page read is held to the project, the window and the caller's devices", () => {
  test.each(allStatements(query()))(
    "%s",
    (_name: string, statement: Statement) => {
      const sql: string = statement.query;
      const values: Array<unknown> = Object.values(statement.query_params);

      expect(sql).toMatch(/WHERE projectId = \{p\d+:String\}/);
      expect(values).toContain(PROJECT.toString());
      expect(sql).toMatch(/flowStartAt >= \{p\d+:DateTime64\(9\)\}/);
      expect(sql).toMatch(/flowStartAt < \{p\d+:DateTime64\(9\)\}/);

      expect(sql).toMatch(/networkDeviceId IN \(/);
      expect(sql).toMatch(/networkDeviceId NOT IN \(/);
      expect(values).toContainEqual([READABLE.toString()]);
      expect(values).toContainEqual([BLOCKED.toString()]);
    },
  );

  test("a caller who reads every device gets no device list at all", () => {
    const everything: NetworkTrafficQuery = { ...query(), devices: {} };

    for (const [, statement] of allStatements(everything)) {
      expect(statement.query).not.toMatch(/networkDeviceId (NOT )?IN/);
    }
  });
});

describe("every page read is bounded in time and memory", () => {
  test.each(allStatements(query()))(
    "%s",
    (_name: string, statement: Statement) => {
      expect(statement.query).toContain(
        `max_execution_time = ${NETWORK_TRAFFIC_QUERY_TIMEOUT_SECONDS}`,
      );
      expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
      expect(statement.query).not.toContain("'break'");
      expect(statement.query).toContain("max_memory_usage = ");
    },
  );

  test("the timeout is under the ClickHouse client's own (58 seconds)", () => {
    expect(NETWORK_TRAFFIC_QUERY_TIMEOUT_SECONDS).toBeLessThan(58);
  });

  test("every top table is capped", () => {
    const tops: Array<[string, Statement]> = allStatements(query()).filter(
      ([name]: [string, Statement]) => {
        return name.startsWith("top");
      },
    );

    expect(tops).toHaveLength(6);

    for (const [, statement] of tops) {
      expect(statement.query).toMatch(
        new RegExp(`LIMIT\\s+${NETWORK_TRAFFIC_TOP_LIMIT}\\b`),
      );
    }
  });

  test("the sources list is capped and looks back a fixed hour, whatever the page's window", () => {
    const now: Date = new Date("2026-09-01T12:00:00.000Z");
    const statement: Statement =
      NetworkTrafficAggregationService.buildSourcesStatement({
        projectId: PROJECT,
        devices: { serviceIds: [READABLE] },
        now: now,
      });

    expect(statement.query).toMatch(/LIMIT 100\b/);
    expect(Object.values(statement.query_params)).toContain(
      "2026-09-01 11:00:00.000000000",
    );
    expect(statement.query).toMatch(/networkDeviceId IN \(/);
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("the sources list takes the newest format a row recorded, never an older probe's empty one", () => {
    const statement: Statement =
      NetworkTrafficAggregationService.buildSourcesStatement({
        projectId: PROJECT,
        devices: { serviceIds: [READABLE] },
        now: new Date("2026-09-01T12:00:00.000Z"),
      });

    expect(statement.query).toContain(
      "argMaxIf(flowFormat, ingestedAt, flowFormat != '') AS latestFormat",
    );
  });

  test("a device's newest flow reads one row, backwards along the sort key", () => {
    const statement: Statement =
      NetworkTrafficAggregationService.buildLastFlowStatement({
        projectId: PROJECT,
        networkDeviceId: READABLE,
      });

    expect(statement.query).toMatch(/ORDER BY flowStartAt DESC\s+LIMIT 1/);
    expect(Object.values(statement.query_params)).toEqual(
      expect.arrayContaining([PROJECT.toString(), READABLE.toString()]),
    );
  });

  test("a bucket under a minute is refused", () => {
    expect(() => {
      return NetworkTrafficAggregationService.buildSeriesStatement(query(), 30);
    }).toThrow(BadDataException);
    expect(() => {
      return NetworkTrafficAggregationService.buildSeriesStatement(
        query(),
        90.5,
      );
    }).toThrow(BadDataException);
  });
});

describe("filters reach SQL as bound parameters only", () => {
  test("an address, however hostile, is a parameter - never SQL", () => {
    const filtered: NetworkTrafficQuery = query({
      sourceIp: HOSTILE,
      destinationIp: HOSTILE,
      hostIp: HOSTILE,
      exporterIp: HOSTILE,
    });

    for (const [, statement] of allStatements(filtered)) {
      expect(statement.query).not.toContain("OR 1=1");
      expect(Object.values(statement.query_params)).toContain(HOSTILE);
    }
  });

  test("each filter becomes its condition", () => {
    const sql: string = NetworkTrafficAggregationService.buildTotalsStatement(
      query({
        sourceIp: "10.0.0.5",
        destinationIp: "10.0.0.6",
        hostIp: "10.0.0.7",
        protocolNumber: 6,
        port: 443,
        interfaceIndex: 3,
        networkDeviceId: READABLE.toString(),
        exporterIp: "10.9.9.9",
      }),
    ).query;

    expect(sql).toMatch(/AND srcIp = \{p\d+:String\}/);
    expect(sql).toMatch(/AND dstIp = \{p\d+:String\}/);
    expect(sql).toMatch(
      /AND \(srcIp = \{p\d+:String\} OR dstIp = \{p\d+:String\}\)/,
    );
    expect(sql).toMatch(/AND protocol = \{p\d+:Int32\}/);
    expect(sql).toMatch(
      /AND \(srcPort = \{p\d+:Int32\} OR dstPort = \{p\d+:Int32\}\)/,
    );
    expect(sql).toMatch(
      /AND \(inputInterfaceIndex = \{p\d+:Int64\} OR outputInterfaceIndex = \{p\d+:Int64\}\)/,
    );
    expect(sql).toMatch(/AND networkDeviceId = \{p\d+:String\}/);
    expect(sql).toMatch(/AND exporterIp = \{p\d+:String\}/);
  });

  test("port 0 and protocol 0 filter; an absent filter adds nothing", () => {
    const zero: string = NetworkTrafficAggregationService.buildTotalsStatement(
      query({ port: 0, protocolNumber: 0 }),
    ).query;

    expect(zero).toMatch(/AND protocol = /);
    expect(zero).toMatch(/srcPort = /);

    const none: string =
      NetworkTrafficAggregationService.buildTotalsStatement(query()).query;

    expect(none).not.toMatch(
      /srcIp =|dstIp =|protocol =|srcPort =|exporterIp =/,
    );
  });

  test("with an interface filter, the series splits in and out through it", () => {
    const sql: string = NetworkTrafficAggregationService.buildSeriesStatement(
      query({ interfaceIndex: 7 }),
      60,
    ).query;

    expect(sql).toMatch(
      /sumIf\(octets, inputInterfaceIndex = \{p\d+:Int64\}\) AS inOctets/,
    );
    expect(sql).toMatch(
      /sumIf\(octets, outputInterfaceIndex = \{p\d+:Int64\}\) AS outOctets/,
    );
  });
});

describe("the SQL ClickHouse can read without surprises", () => {
  test.each(allStatements(query({ interfaceIndex: 2 })))(
    "%s aliases no aggregate to a column's name",
    (_name: string, statement: Statement) => {
      expect(statement.query).not.toMatch(ALIASED_TO_A_COLUMN);
    },
  );

  test("the service-port expression names the service the way the probe and the dashboard do", () => {
    expect(SERVICE_PORT_SQL).toContain("protocol IN (6, 17, 33, 132)");

    // The TypeScript rule it mirrors, on the shapes stored rows take.
    expect(NetworkFlowApplicationUtil.getServicePort(6, 0, 443)).toBe(443);
    expect(NetworkFlowApplicationUtil.getServicePort(6, 443, 0)).toBe(443);
    expect(NetworkFlowApplicationUtil.getServicePort(17, 5000, 5001)).toBe(
      5000,
    );
    expect(NetworkFlowApplicationUtil.getServicePort(1, 0, 2048)).toBe(0);
  });

  test("the interfaces read counts each flow in and out from one scan", () => {
    const sql: string =
      NetworkTrafficAggregationService.buildTopInterfacesStatement(
        query(),
      ).query;

    expect(sql).toContain(
      "ARRAY JOIN [(toUInt64(inputInterfaceIndex), 1), (toUInt64(outputInterfaceIndex), 2)] AS direction",
    );
    expect(sql).toContain("HAVING interfaceIndex > 0");
  });

  test("the devices read tells the project's unknown exporters apart by address", () => {
    const statement: Statement =
      NetworkTrafficAggregationService.buildTopDevicesStatement(query());

    expect(statement.query).toMatch(
      /GROUP BY networkDeviceId, if\(networkDeviceId = \{p\d+:String\}, exporterIp, ''\)/,
    );
  });
});

describe("NetworkTrafficAggregationService.getAggregates", () => {
  let sent: Array<Statement> = [];

  beforeEach(() => {
    sent = [];
    jest
      .spyOn(NetworkFlowService, "executeQuery")
      .mockImplementation(async (statement: unknown): Promise<never> => {
        sent.push(statement as Statement);
        const sql: string = (statement as Statement).query;

        const data: Array<Record<string, unknown>> = sql.includes(
          "AS totalFlows",
        )
          ? [
              {
                totalOctets: "123",
                totalPackets: "4",
                totalFlows: "5",
                maxSamplingRate: 0,
              },
            ]
          : [];

        return {
          json: async (): Promise<unknown> => {
            return { data: data };
          },
        } as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a device's page reads its interfaces and not the devices table", async () => {
    const result: NetworkTrafficAggregates =
      await NetworkTrafficAggregationService.getAggregates({
        query: query(),
        bucketSeconds: 60,
        includeInterfaces: true,
        includeDevices: false,
      });

    expect(sent).toHaveLength(7);
    expect(
      sent.some((statement: Statement) => {
        return statement.query.includes("ARRAY JOIN");
      }),
    ).toBe(true);
    expect(result.topDevices).toEqual([]);
    // ClickHouse sends UInt64 sums as strings; a rate below 1 is 1.
    expect(result.totals).toEqual({ octets: 123, packets: 4, flows: 5 });
    expect(result.maxSamplingRate).toBe(1);
  });

  test("a site's or the network's page reads the devices table and not interfaces", async () => {
    await NetworkTrafficAggregationService.getAggregates({
      query: query(),
      bucketSeconds: 60,
      includeInterfaces: false,
      includeDevices: true,
    });

    expect(sent).toHaveLength(7);
    expect(
      sent.some((statement: Statement) => {
        return statement.query.includes("ARRAY JOIN");
      }),
    ).toBe(false);
  });
});

/*
 * Names (issue #5340): the DNS names the probe sent with the flows are read
 * in the same pass as the bytes - the newest name of each listed address,
 * never one lookup a row - and "find an address" searches them, and the
 * window's traffic of what it found, held like every other read.
 */
describe("names ride on the reads the page already makes", () => {
  test("top sources and destinations carry each address's newest name and when it was seen", () => {
    const sources: string =
      NetworkTrafficAggregationService.buildTopAddressStatement(
        query(),
        "srcIp",
      ).query;
    const destinations: string =
      NetworkTrafficAggregationService.buildTopAddressStatement(
        query(),
        "dstIp",
      ).query;

    expect(sources).toContain(
      "argMaxIf(srcName, flowStartAt, srcName != '') AS resolvedName",
    );
    expect(sources).toContain(
      "maxIf(flowStartAt, srcName != '') AS resolvedAt",
    );
    expect(destinations).toContain(
      "argMaxIf(dstName, flowStartAt, dstName != '') AS resolvedName",
    );
    expect(destinations).not.toContain("srcName");
  });

  test("top conversations carry both ends' newest names", () => {
    const sql: string =
      NetworkTrafficAggregationService.buildTopConversationsStatement(
        query(),
      ).query;

    expect(sql).toContain(
      "argMaxIf(srcName, flowStartAt, srcName != '') AS sourceName",
    );
    expect(sql).toContain("maxIf(flowStartAt, srcName != '') AS sourceNameAt");
    expect(sql).toContain(
      "argMaxIf(dstName, flowStartAt, dstName != '') AS destinationName",
    );
    expect(sql).toContain(
      "maxIf(flowStartAt, dstName != '') AS destinationNameAt",
    );
  });

  test("a flow that carried no name never wins over one that did", () => {
    // argMax over ''-named rows would pick '' whenever an unnamed flow is newest.
    for (const sql of [
      NetworkTrafficAggregationService.buildTopAddressStatement(
        query(),
        "srcIp",
      ).query,
      NetworkTrafficAggregationService.buildTopConversationsStatement(query())
        .query,
    ]) {
      expect(sql).not.toMatch(UNCONDITIONAL_NAME_ARGMAX);
    }
  });
});

describe("keepNewestDnsName", () => {
  test("keeps the name of the later flow, whichever side it was read on", () => {
    const names: Map<string, NetworkTrafficDnsName> = new Map();

    keepNewestDnsName(
      names,
      "10.0.0.5",
      "old.corp.example",
      "2026-09-01 10:00:00.000000000",
    );
    keepNewestDnsName(
      names,
      "10.0.0.5",
      "new.corp.example",
      "2026-09-01 10:30:00.000000000",
    );
    keepNewestDnsName(
      names,
      "10.0.0.5",
      "older.corp.example",
      "2026-09-01 09:00:00.000000000",
    );

    expect(names.get("10.0.0.5")).toEqual({
      name: "new.corp.example",
      at: "2026-09-01 10:30:00.000000000",
    });
  });

  test("no name, a name that is not text, or no address keeps nothing", () => {
    const names: Map<string, NetworkTrafficDnsName> = new Map();

    keepNewestDnsName(names, "10.0.0.5", "", "2026-09-01 10:00:00.000000000");
    keepNewestDnsName(names, "10.0.0.6", 5, "2026-09-01 10:00:00.000000000");
    keepNewestDnsName(
      names,
      "",
      "a.corp.example",
      "2026-09-01 10:00:00.000000000",
    );
    keepNewestDnsName(names, "10.0.0.7", null, undefined);

    expect(names.size).toBe(0);
  });

  test("a name with no time is kept until one with a time comes", () => {
    const names: Map<string, NetworkTrafficDnsName> = new Map();

    keepNewestDnsName(names, "10.0.0.5", "a.corp.example", undefined);
    expect(names.get("10.0.0.5")?.name).toBe("a.corp.example");

    keepNewestDnsName(
      names,
      "10.0.0.5",
      "b.corp.example",
      "2026-09-01 10:00:00.000000000",
    );
    expect(names.get("10.0.0.5")?.name).toBe("b.corp.example");
  });
});

describe("find an address by its DNS name", () => {
  test("searches both ends' names in the page's window, literally and without case, newest first", () => {
    const statement: Statement =
      NetworkTrafficAggregationService.buildNameSearchStatement(
        query(),
        "FS01",
      );
    const sql: string = statement.query;

    expect(sql).toMatch(SOURCE_NAME_SEARCH);
    expect(sql).toMatch(DESTINATION_NAME_SEARCH);
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("ORDER BY foundAt DESC");
    expect(sql).toContain(`LIMIT ${NETWORK_TRAFFIC_FIND_NAMES_LIMIT}`);
    expect(Object.values(statement.query_params)).toContain("FS01");
    // Both halves are held to the project, the window and the devices.
    expect(sql.split("WHERE projectId = ")).toHaveLength(3);
    expect(sql.split("networkDeviceId IN (")).toHaveLength(3);
  });

  test("the text typed is a parameter, never SQL or a pattern", () => {
    const statement: Statement =
      NetworkTrafficAggregationService.buildNameSearchStatement(
        query(),
        HOSTILE,
      );

    expect(statement.query).not.toContain("OR 1=1");
    expect(statement.query).not.toMatch(PATTERN_MATCHING);
    expect(Object.values(statement.query_params)).toContain(HOSTILE);
  });

  test("the window's traffic of what was found: both ends, busiest first, at most the find limit", () => {
    const statement: Statement =
      NetworkTrafficAggregationService.buildAddressTrafficStatement(query(), [
        "10.0.0.5",
        "2001:db8::5",
      ]);

    expect(statement.query).toMatch(SOURCE_IN_ADDRESSES);
    expect(statement.query).toMatch(DESTINATION_IN_ADDRESSES);
    expect(statement.query).toContain("ORDER BY totalOctets DESC");
    expect(statement.query).toContain(`LIMIT ${NETWORK_TRAFFIC_FIND_LIMIT}`);
    expect(Object.values(statement.query_params)).toContainEqual([
      "10.0.0.5",
      "2001:db8::5",
    ]);
  });

  test("no addresses to read is refused, never an unbounded read", () => {
    expect(() => {
      return NetworkTrafficAggregationService.buildAddressTrafficStatement(
        query(),
        [],
      );
    }).toThrow(BadDataException);
  });
});

describe("names in what the reads answer", () => {
  let rows: Record<string, Array<Record<string, unknown>>> = {};
  let sentCount: number = 0;

  beforeEach(() => {
    rows = {};
    sentCount = 0;
    jest
      .spyOn(NetworkFlowService, "executeQuery")
      .mockImplementation(async (statement: unknown): Promise<never> => {
        sentCount++;
        const sql: string = (statement as Statement).query;
        let data: Array<Record<string, unknown>> = [];

        if (sql.includes("AS totalFlows")) {
          data = [{ totalOctets: "1", totalPackets: "1", totalFlows: "1" }];
        } else if (sql.includes("foundName")) {
          data = rows["find"] || [];
        } else if (sql.includes("sideOctets")) {
          data = rows["traffic"] || [];
        } else if (sql.includes("AS sourceName")) {
          data = rows["conversations"] || [];
        } else if (sql.includes("SELECT srcIp AS ip")) {
          data = rows["sources"] || [];
        } else if (sql.includes("SELECT dstIp AS ip")) {
          data = rows["destinations"] || [];
        }

        return {
          json: async (): Promise<unknown> => {
            return { data: data };
          },
        } as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the aggregates hand back each listed address's newest DNS name, from every list", async () => {
    rows["sources"] = [
      {
        ip: "10.0.0.5",
        resolvedName: "old.corp.example",
        resolvedAt: "2026-09-01 10:00:00.000000000",
        totalOctets: "10",
        totalPackets: "1",
      },
      {
        ip: "10.0.0.6",
        resolvedName: "",
        resolvedAt: "1970-01-01 00:00:00.000000000",
        totalOctets: "5",
        totalPackets: "1",
      },
    ];
    rows["destinations"] = [
      {
        ip: "10.0.0.5",
        resolvedName: "new.corp.example",
        resolvedAt: "2026-09-01 10:40:00.000000000",
        totalOctets: "10",
        totalPackets: "1",
      },
    ];
    rows["conversations"] = [
      {
        sourceIp: "10.0.0.7",
        destinationIp: "198.51.100.20",
        sourceName: "",
        sourceNameAt: "1970-01-01 00:00:00.000000000",
        destinationName: "www.example.com",
        destinationNameAt: "2026-09-01 10:20:00.000000000",
        totalOctets: "5",
        totalPackets: "1",
      },
    ];

    const result: NetworkTrafficAggregates =
      await NetworkTrafficAggregationService.getAggregates({
        query: query(),
        bucketSeconds: 60,
        includeInterfaces: false,
        includeDevices: true,
      });

    expect(
      Array.from(result.dnsNames.entries()).map(
        ([address, name]: [string, NetworkTrafficDnsName]) => {
          return [address, name.name];
        },
      ),
    ).toEqual([
      ["10.0.0.5", "new.corp.example"],
      ["198.51.100.20", "www.example.com"],
    ]);
    // The rows themselves are what they were: names are no part of them.
    expect(Object.keys(result.topSources[0]!).sort()).toEqual(
      ["ip", "octets", "packets"].sort(),
    );
  });

  test("findAddressesByDnsName answers { address: name }, each address once", async () => {
    rows["find"] = [
      {
        ip: "10.0.0.5",
        foundName: "fs01.corp.example",
        foundAt: "2026-09-01 10:40:00",
      },
      {
        ip: "10.0.0.5",
        foundName: "fs01-old.corp.example",
        foundAt: "2026-09-01 10:00:00",
      },
      { ip: "10.0.0.9", foundName: "", foundAt: "2026-09-01 10:00:00" },
      {
        ip: "",
        foundName: "nothing.corp.example",
        foundAt: "2026-09-01 10:00:00",
      },
    ];

    const found: Map<string, string> =
      await NetworkTrafficAggregationService.findAddressesByDnsName({
        query: query(),
        text: "fs01",
      });

    expect(Array.from(found.entries())).toEqual([
      ["10.0.0.5", "fs01.corp.example"],
    ]);
  });

  test("getAddressTraffic answers the bytes of each address found, and reads nothing for none", async () => {
    rows["traffic"] = [
      { ip: "10.0.0.5", totalOctets: "1500" },
      { ip: "10.0.0.6", totalOctets: "not a number" },
    ];

    const traffic: Map<string, number> =
      await NetworkTrafficAggregationService.getAddressTraffic({
        query: query(),
        addresses: ["10.0.0.5", "10.0.0.6"],
      });

    expect(Array.from(traffic.entries())).toEqual([
      ["10.0.0.5", 1500],
      ["10.0.0.6", 0],
    ]);
    expect(sentCount).toBe(1);

    const none: Map<string, number> =
      await NetworkTrafficAggregationService.getAddressTraffic({
        query: query(),
        addresses: [],
      });

    expect(none.size).toBe(0);
    expect(sentCount).toBe(1);
  });
});
