import NetworkTrafficUsageAggregationService, {
  NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS,
  NetworkTrafficUsageAggregates,
  NetworkTrafficUsageFreshness,
  NetworkTrafficUsageQuery,
} from "../../../Server/Services/NetworkTrafficUsageAggregationService";
import NetworkTrafficUsageService from "../../../Server/Services/NetworkTrafficUsageService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { NetworkTrafficUsageStoredEnds } from "../../../Server/Utils/NetworkController/NetworkControllerTypes";
import { getWindowKey } from "../../../Server/Utils/NetworkController/NetworkTrafficUsageRows";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  NETWORK_TRAFFIC_USAGE_TOP_LIMIT,
  NetworkTrafficUsageKind,
} from "../../../Types/NetFlow/NetworkTrafficUsage";
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
 * The SQL the Meraki side of a Traffic page sends, as ClickHouse receives
 * it. The real ClickHouse suite (App Tests/Telemetry/
 * NetworkTrafficUsageClickhouse) runs it; these pin what keeps it safe and
 * bounded whatever the request says:
 *
 *   - every statement is held to the project, the kind, the windows that
 *     reach into the range and the caller's devices;
 *   - every value from the request is a bound parameter, never spliced;
 *   - every statement times out with 'throw' under the client's own timeout;
 *   - every top table is capped, and no aggregate is aliased to a column;
 *   - a window counts for the part of it inside the range.
 */

const PROJECT: ObjectID = ObjectID.generate();
const CONNECTION: ObjectID = ObjectID.generate();
const READABLE: ObjectID = ObjectID.generate();
const BLOCKED: ObjectID = ObjectID.generate();
const HOSTILE: string = "L_1' OR 1=1 --";

function query(
  filters: NetworkTrafficUsageQuery["filters"] = {},
): NetworkTrafficUsageQuery {
  return {
    projectId: PROJECT,
    startTime: new Date("2026-10-24T10:00:00.000Z"),
    endTime: new Date("2026-10-24T12:00:00.000Z"),
    devices: { serviceIds: [READABLE], excludedServiceIds: [BLOCKED] },
    filters,
  };
}

function pageStatements(
  q: NetworkTrafficUsageQuery,
): Array<[string, Statement]> {
  const service: typeof NetworkTrafficUsageAggregationService =
    NetworkTrafficUsageAggregationService;

  return [
    [
      "uplink totals",
      service.buildTotalsStatement(q, NetworkTrafficUsageKind.Uplink),
    ],
    [
      "application totals",
      service.buildTotalsStatement(q, NetworkTrafficUsageKind.Application),
    ],
    [
      "client totals",
      service.buildTotalsStatement(q, NetworkTrafficUsageKind.Client),
    ],
    [
      "series",
      service.buildSeriesStatement(q, NetworkTrafficUsageKind.Uplink, 300),
    ],
    [
      "top networks",
      service.buildTopNetworksStatement(q, NetworkTrafficUsageKind.Uplink),
    ],
    ["top uplinks", service.buildTopUplinksStatement(q)],
    ["top applications", service.buildTopApplicationsStatement(q)],
    ["top destinations", service.buildTopDestinationsStatement(q)],
    ["top clients", service.buildTopClientsStatement(q)],
    ["top conversations", service.buildTopConversationsStatement(q)],
    ["uplink interfaces", service.buildUplinkInterfacesStatement(q)],
    ["uplink health", service.buildUplinkHealthStatement(q)],
    ["uplink series", service.buildUplinkSeriesStatement(q, 300)],
    ["uplink health series", service.buildUplinkHealthSeriesStatement(q, 300)],
  ];
}

function allStatements(
  q: NetworkTrafficUsageQuery,
): Array<[string, Statement]> {
  return [
    ...pageStatements(q),
    [
      "freshness",
      NetworkTrafficUsageAggregationService.buildFreshnessStatement({
        projectId: PROJECT,
        devices: q.devices,
        now: q.endTime,
      }),
    ],
    [
      "stored windows",
      NetworkTrafficUsageAggregationService.buildStoredWindowsStatement({
        projectId: PROJECT,
        connectionId: CONNECTION,
        windows: [
          {
            kind: NetworkTrafficUsageKind.Uplink,
            controllerNetworkId: "",
            windowStartAt: q.startTime,
          },
        ],
      }),
    ],
    [
      "stored window ends",
      NetworkTrafficUsageAggregationService.buildStoredWindowEndsStatement({
        projectId: PROJECT,
        connectionId: CONNECTION,
        since: q.startTime,
      }),
    ],
  ];
}

const COLUMN_NAMES: Array<string> = [
  "kind",
  "controllerNetworkId",
  "controllerNetworkName",
  "deviceSerial",
  "deviceName",
  "interfaceName",
  "application",
  "destination",
  "protocol",
  "port",
  "clientKey",
  "clientName",
  "clientIp",
  "clientMac",
  "clientManufacturer",
  "sentOctets",
  "receivedOctets",
  "flows",
  "clients",
  "windowStartAt",
  "windowEndAt",
  "networkDeviceId",
];

const ALIASED_TO_A_COLUMN: RegExp = new RegExp(
  `\\bAS\\s+(${COLUMN_NAMES.join("|")})\\b`,
);

describe("every page read is held to the project, the kind, the range and the caller's devices", () => {
  test.each(pageStatements(query()))(
    "%s",
    (_name: string, statement: Statement) => {
      const sql: string = statement.query;
      const values: Array<unknown> = Object.values(statement.query_params);

      expect(sql).toMatch(/WHERE projectId = \{p\d+:String\}/);
      expect(values).toContain(PROJECT.toString());
      expect(sql).toMatch(/AND kind = \{p\d+:String\}/);
      // Windows that reach into the range: started before its end, ending after its start.
      expect(sql).toMatch(/windowStartAt >= \{p\d+:DateTime64\(9\)\}/);
      expect(sql).toMatch(/windowStartAt < \{p\d+:DateTime64\(9\)\}/);
      expect(sql).toMatch(/windowEndAt > \{p\d+:DateTime64\(9\)\}/);
      // Looking back past the start by the longest window there is.
      expect(values).toContain("2026-10-23 09:00:00.000000000");

      expect(sql).toMatch(/networkDeviceId IN \(/);
      expect(sql).toMatch(/networkDeviceId NOT IN \(/);
      expect(values).toContainEqual([READABLE.toString()]);
      expect(values).toContainEqual([BLOCKED.toString()]);
    },
  );

  test("a caller who reads every device gets no device list at all", () => {
    for (const [, statement] of pageStatements({ ...query(), devices: {} })) {
      expect(statement.query).not.toMatch(/networkDeviceId (NOT )?IN/);
    }
  });

  test("the freshness read is held to the project and the caller's devices too", () => {
    const statement: Statement =
      NetworkTrafficUsageAggregationService.buildFreshnessStatement({
        projectId: PROJECT,
        devices: { serviceIds: [READABLE] },
        now: new Date("2026-10-24T12:00:00.000Z"),
      });

    expect(statement.query).toMatch(/WHERE projectId = \{p\d+:String\}/);
    expect(statement.query).toMatch(/networkDeviceId IN \(/);
    expect(statement.query).toContain(
      "toUnixTimestamp64Milli(max(windowEndAt))",
    );
  });

  test("the runner's reads are held to the project and the connection", () => {
    for (const name of ["stored windows", "stored window ends"]) {
      const statement: Statement = allStatements(query()).find(
        ([candidate]: [string, Statement]) => {
          return candidate === name;
        },
      )![1];
      const values: Array<unknown> = Object.values(statement.query_params);

      expect(statement.query).toMatch(/WHERE projectId = \{p\d+:String\}/);
      expect(statement.query).toMatch(/AND connectionId = \{p\d+:String\}/);
      expect(values).toContain(PROJECT.toString());
      expect(values).toContain(CONNECTION.toString());
      expect(statement.query).toContain("toUnixTimestamp64Milli(");
    }
  });

  test("the stored ends are of windows that end after the time given, found by their start", () => {
    const statement: Statement =
      NetworkTrafficUsageAggregationService.buildStoredWindowEndsStatement({
        projectId: PROJECT,
        connectionId: CONNECTION,
        since: new Date("2026-10-23T11:00:00.000Z"),
      });
    const values: Array<unknown> = Object.values(statement.query_params);

    expect(statement.query).toMatch(/windowEndAt > \{p\d+:DateTime64\(9\)\}/);
    expect(values).toContain("2026-10-23 11:00:00.000000000");
    expect(values).toContain("2026-10-22 10:00:00.000000000");
  });
});

describe("every read is bounded in time and memory", () => {
  test.each(allStatements(query()))(
    "%s",
    (_name: string, statement: Statement) => {
      expect(statement.query).toContain(
        `max_execution_time = ${NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS}`,
      );
      expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
      expect(statement.query).not.toContain("'break'");
      expect(statement.query).toContain("max_memory_usage = ");
      expect(statement.query).not.toMatch(ALIASED_TO_A_COLUMN);
    },
  );

  test("the timeout is under the ClickHouse client's own (58 seconds)", () => {
    expect(NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS).toBeLessThan(58);
  });

  test("every top table is capped", () => {
    const tops: Array<[string, Statement]> = pageStatements(query()).filter(
      ([name]: [string, Statement]) => {
        return name.startsWith("top");
      },
    );

    expect(tops).toHaveLength(6);

    for (const [, statement] of tops) {
      expect(statement.query).toMatch(
        new RegExp(`LIMIT\\s+${NETWORK_TRAFFIC_USAGE_TOP_LIMIT}\\b`),
      );
    }
  });

  test("the rows that sum a busy window's rest stay out of the top tables", () => {
    expect(
      NetworkTrafficUsageAggregationService.buildTopApplicationsStatement(
        query(),
      ).query,
    ).toContain("AND application != ''");
    expect(
      NetworkTrafficUsageAggregationService.buildTopClientsStatement(query())
        .query,
    ).toContain("AND clientKey != ''");
    expect(
      NetworkTrafficUsageAggregationService.buildTopDestinationsStatement(
        query(),
      ).query,
    ).toContain("AND destination != ''");
  });

  test("a conversation keeps traffic Meraki names only by its application, but never that rest row", () => {
    expect(
      NetworkTrafficUsageAggregationService.buildTopConversationsStatement(
        query(),
      ).query,
    ).toContain("AND (destination != '' OR application != '')");
  });

  test("a bucket under a minute, or not whole, is refused", () => {
    for (const bucket of [30, 90.5, 0, -60]) {
      expect(() => {
        return NetworkTrafficUsageAggregationService.buildSeriesStatement(
          query(),
          NetworkTrafficUsageKind.Uplink,
          bucket,
        );
      }).toThrow(BadDataException);
      expect(() => {
        return NetworkTrafficUsageAggregationService.buildUplinkSeriesStatement(
          query(),
          bucket,
        );
      }).toThrow(BadDataException);
      expect(() => {
        return NetworkTrafficUsageAggregationService.buildUplinkHealthSeriesStatement(
          query(),
          bucket,
        );
      }).toThrow(BadDataException);
    }
  });
});

describe("a window counts for the part of it inside the range", () => {
  test("its overlap over its length, in milliseconds, never below zero nor divided by zero", () => {
    const weight: Statement =
      NetworkTrafficUsageAggregationService.buildWeight(query());

    expect(weight.query).toMatch(
      /greatest\(0, least\(toUnixTimestamp64Milli\(windowEndAt\), \{p\d+:Int64\}\) - greatest\(toUnixTimestamp64Milli\(windowStartAt\), \{p\d+:Int64\}\)\) \/ greatest\(1, toUnixTimestamp64Milli\(windowEndAt\) - toUnixTimestamp64Milli\(windowStartAt\)\)/,
    );
    expect(Object.values(weight.query_params)).toEqual(
      expect.arrayContaining([
        new Date("2026-10-24T12:00:00.000Z").getTime(),
        new Date("2026-10-24T10:00:00.000Z").getTime(),
      ]),
    );
  });

  test("the chart splits each window over the buckets it spans", () => {
    const series: string =
      NetworkTrafficUsageAggregationService.buildSeriesStatement(
        query(),
        NetworkTrafficUsageKind.Application,
        300,
      ).query;

    expect(series).toContain("ARRAY JOIN range(intDiv(clippedStart,");
    expect(series).toContain("WHERE clippedEnd > clippedStart");
    expect(series).toMatch(/ORDER BY bucketIndex ASC/);
  });

  test("an uplink's chart splits them the same way, uplink by uplink", () => {
    const uplinks: string =
      NetworkTrafficUsageAggregationService.buildUplinkSeriesStatement(
        query(),
        300,
      ).query;

    expect(uplinks).toContain("ARRAY JOIN range(intDiv(clippedStart,");
    expect(uplinks).toContain("interfaceName AS uplinkKey");
    expect(uplinks).toMatch(/GROUP BY bucketIndex, uplinkKey/);
    expect(uplinks).toMatch(/ORDER BY bucketIndex ASC, uplinkKey ASC/);
  });

  test("the page's own chart is not split by uplink", () => {
    const series: string =
      NetworkTrafficUsageAggregationService.buildSeriesStatement(
        query(),
        NetworkTrafficUsageKind.Uplink,
        300,
      ).query;

    expect(series).not.toContain("uplinkKey");
    expect(series).toMatch(/GROUP BY bucketIndex\n/);
  });

  test("a trusted column stays a column: the SQL tag would bind a plain string as an Identifier", () => {
    const uplinks: Statement =
      NetworkTrafficUsageAggregationService.buildUplinkSeriesStatement(
        query(),
        300,
      );

    expect(uplinks.query).not.toContain(":Identifier}AS");
    expect(Object.values(uplinks.query_params)).not.toContain("uplinkKey,");
  });

  test("a measurement is averaged, never shared out by how much of its window is in range", () => {
    const service: typeof NetworkTrafficUsageAggregationService =
      NetworkTrafficUsageAggregationService;

    for (const statement of [
      service.buildUplinkHealthStatement(query()),
      service.buildUplinkHealthSeriesStatement(query(), 300),
    ]) {
      expect(statement.query).toContain("avg(lossPercent) AS averageLoss");
      expect(statement.query).toContain("avg(latencyMs) AS averageLatency");
      expect(statement.query).not.toContain("sum(");
      expect(Object.values(statement.query_params)).toContain(
        NetworkTrafficUsageKind.UplinkHealth,
      );
    }
  });
});

describe("an uplink's filter", () => {
  const service: typeof NetworkTrafficUsageAggregationService =
    NetworkTrafficUsageAggregationService;
  const HOSTILE_UPLINK: string = "wan1' OR 1=1 --";

  function narrowed(
    filters: NetworkTrafficUsageQuery["filters"] = {},
  ): NetworkTrafficUsageQuery {
    return query({ interfaceName: "wan2", ...filters });
  }

  test.each([
    [
      "the totals",
      service.buildTotalsStatement(narrowed(), NetworkTrafficUsageKind.Uplink),
    ],
    [
      "the chart",
      service.buildSeriesStatement(
        narrowed(),
        NetworkTrafficUsageKind.Uplink,
        300,
      ),
    ],
    [
      "Top networks",
      service.buildTopNetworksStatement(
        narrowed(),
        NetworkTrafficUsageKind.Uplink,
      ),
    ],
    ["the Uplinks list", service.buildTopUplinksStatement(narrowed())],
  ])("holds %s to it", (_name: string, statement: Statement) => {
    expect(statement.query).toMatch(/AND interfaceName = \{p\d+:String\}/);
    expect(Object.values(statement.query_params)).toContain("wan2");
  });

  test.each([
    ["applications", service.buildTopApplicationsStatement(narrowed())],
    ["destinations", service.buildTopDestinationsStatement(narrowed())],
    ["clients", service.buildTopClientsStatement(narrowed())],
    ["conversations", service.buildTopConversationsStatement(narrowed())],
    [
      "application totals",
      service.buildTotalsStatement(
        narrowed(),
        NetworkTrafficUsageKind.Application,
      ),
    ],
  ])(
    "leaves %s alone: Meraki counts them per network, and knows no uplink of them",
    (_name: string, statement: Statement) => {
      expect(statement.query).not.toContain("interfaceName =");
    },
  );

  test.each([
    ["their traffic", service.buildUplinkInterfacesStatement(narrowed())],
    ["their health", service.buildUplinkHealthStatement(narrowed())],
    ["their chart", service.buildUplinkSeriesStatement(narrowed(), 300)],
    [
      "their health's chart",
      service.buildUplinkHealthSeriesStatement(narrowed(), 300),
    ],
  ])(
    "never holds the comparison's %s to it: narrowed to wan2, wan1 stays beside it",
    (_name: string, statement: Statement) => {
      expect(statement.query).not.toContain("interfaceName =");
      expect(Object.values(statement.query_params)).not.toContain("wan2");
    },
  );

  test("the comparison stays held to the network and the appliance", () => {
    const filtered: NetworkTrafficUsageQuery = narrowed({
      controllerNetworkId: "L_1",
      deviceSerial: "Q2XX-AAAA-0001",
    });

    for (const statement of [
      service.buildUplinkInterfacesStatement(filtered),
      service.buildUplinkHealthStatement(filtered),
      service.buildUplinkSeriesStatement(filtered, 300),
      service.buildUplinkHealthSeriesStatement(filtered, 300),
    ]) {
      expect(statement.query).toMatch(
        /AND controllerNetworkId = \{p\d+:String\}/,
      );
      expect(statement.query).toMatch(/AND deviceSerial = \{p\d+:String\}/);
    }
  });

  test("leaves the query it was given as it was", () => {
    const original: NetworkTrafficUsageQuery = narrowed();

    service.buildUplinkInterfacesStatement(original);

    expect(original.filters.interfaceName).toBe("wan2");
  });

  test("a name, however hostile, is a parameter - never SQL", () => {
    const hostile: NetworkTrafficUsageQuery = query({
      interfaceName: HOSTILE_UPLINK,
    });

    for (const [, statement] of pageStatements(hostile)) {
      expect(statement.query).not.toContain("OR 1=1");
    }

    expect(
      Object.values(service.buildTopUplinksStatement(hostile).query_params),
    ).toContain(HOSTILE_UPLINK);
  });

  test("an appliance's filter holds an uplink's health to it too", () => {
    expect(
      service.buildUplinkHealthStatement(
        query({ deviceSerial: "Q2XX-AAAA-0001" }),
      ).query,
    ).toMatch(/AND deviceSerial = \{p\d+:String\}/);
  });
});

describe("filters reach SQL as bound parameters only", () => {
  test("a network ID, however hostile, is a parameter - never SQL", () => {
    for (const [, statement] of pageStatements(
      query({ controllerNetworkId: HOSTILE, deviceSerial: "Q2XX' --" }),
    )) {
      expect(statement.query).not.toContain("OR 1=1");
      expect(statement.query).not.toContain("Q2XX'");
      expect(Object.values(statement.query_params)).toContain(HOSTILE);
    }
  });

  test("an appliance's serial holds its uplinks; a network holds every kind", () => {
    const filtered: NetworkTrafficUsageQuery = query({
      controllerNetworkId: "L_1",
      deviceSerial: "Q2XX-AAAA-0001",
    });

    expect(
      NetworkTrafficUsageAggregationService.buildTopUplinksStatement(filtered)
        .query,
    ).toMatch(/AND deviceSerial = \{p\d+:String\}/);
    expect(
      NetworkTrafficUsageAggregationService.buildTopApplicationsStatement(
        filtered,
      ).query,
    ).not.toContain("deviceSerial =");
    expect(
      NetworkTrafficUsageAggregationService.buildTopClientsStatement(filtered)
        .query,
    ).toMatch(/AND controllerNetworkId = \{p\d+:String\}/);
  });
});

describe("what the reads answer", () => {
  let answers: Map<string, Array<JSONObject>>;
  let statements: Array<Statement>;

  function answerFor(statement: Statement): Array<JSONObject> {
    for (const [marker, rows] of answers) {
      if (statement.query.includes(marker)) {
        return rows;
      }
    }

    return [];
  }

  beforeEach(() => {
    answers = new Map();
    statements = [];

    jest
      .spyOn(NetworkTrafficUsageService, "executeQuery")
      .mockImplementation((async (statement: Statement) => {
        statements.push(statement);
        return {
          json: async () => {
            return { data: answerFor(statement) };
          },
        };
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("totals, chart and tables, rounded to whole bytes; the project's bucket names no device", async () => {
    answers.set("AS totalFlows FROM", [
      { totalSent: "1536.4", totalReceived: 4096.6, totalFlows: "12.2" },
    ]);
    answers.set("AS bucketStartMs", [
      {
        bucketStartMs: String(new Date("2026-10-24T10:00:00.000Z").getTime()),
        bucketSent: 99.5,
        bucketReceived: "NaN",
      },
    ]);
    answers.set("AS serialKey", [
      {
        serialKey: "Q2XX-AAAA-0001",
        uplinkKey: "wan1",
        applianceName: "MX 1",
        networkKey: "L_1",
        networkName: "Branch 1",
        deviceId: READABLE.toString(),
        totalSent: 10,
        totalReceived: 20,
      },
      {
        serialKey: "Q2XX-AAAA-0002",
        uplinkKey: "wan1",
        applianceName: "MX 2",
        networkKey: "L_2",
        networkName: "Branch 2",
        deviceId: PROJECT.toString(),
        totalSent: 1,
        totalReceived: 2,
      },
    ]);

    const aggregates: NetworkTrafficUsageAggregates =
      await NetworkTrafficUsageAggregationService.getAggregates({
        query: query(),
        bucketSeconds: 300,
        primaryKind: NetworkTrafficUsageKind.Application,
      });

    expect(statements).toHaveLength(14);
    expect(aggregates.primaryKind).toBe(NetworkTrafficUsageKind.Application);
    expect(aggregates.totals).toEqual({
      sentOctets: 1536,
      receivedOctets: 4097,
      flows: 12,
    });
    expect(aggregates.series).toEqual([
      {
        time: "2026-10-24T10:00:00.000Z",
        sentOctets: 100,
        receivedOctets: 0,
      },
    ]);
    expect(aggregates.topUplinks[0]).toEqual({
      deviceSerial: "Q2XX-AAAA-0001",
      deviceName: "MX 1",
      controllerNetworkId: "L_1",
      controllerNetworkName: "Branch 1",
      interfaceName: "wan1",
      sentOctets: 10,
      receivedOctets: 20,
      networkDeviceId: READABLE.toString(),
    });
    expect(aggregates.topUplinks[1]!.networkDeviceId).toBeUndefined();
  });

  test("the applications, destinations and conversations say their protocol and port", async () => {
    answers.set("AS applicationKey", [
      {
        applicationKey: "Microsoft Teams",
        topProtocol: "UDP",
        topPort: "3478",
        totalSent: 1,
        totalReceived: 2,
        totalFlows: 3,
      },
    ]);
    answers.set("AS destinationKey, argMax", [
      {
        destinationKey: "teams.microsoft.com",
        topApplication: "Microsoft Teams",
        topProtocol: "UDP",
        topPort: 3478,
        totalSent: 1,
        totalReceived: 2,
      },
    ]);
    answers.set("AS mostClients", [
      {
        networkKey: "L_1",
        networkName: "Branch 1",
        destinationKey: "teams.microsoft.com",
        protocolKey: "UDP",
        portKey: "3478",
        topApplication: "Microsoft Teams",
        mostClients: "12",
        totalSent: 10.4,
        totalReceived: 20.6,
        totalFlows: 4.2,
      },
    ]);

    const aggregates: NetworkTrafficUsageAggregates =
      await NetworkTrafficUsageAggregationService.getAggregates({
        query: query(),
        bucketSeconds: 300,
        primaryKind: NetworkTrafficUsageKind.Uplink,
      });

    expect(aggregates.topApplications[0]).toMatchObject({
      protocol: "UDP",
      port: 3478,
    });
    expect(aggregates.topDestinations[0]).toMatchObject({
      protocol: "UDP",
      port: 3478,
    });
    expect(aggregates.topConversations).toEqual([
      {
        controllerNetworkId: "L_1",
        controllerNetworkName: "Branch 1",
        destination: "teams.microsoft.com",
        application: "Microsoft Teams",
        protocol: "UDP",
        port: 3478,
        sentOctets: 10,
        receivedOctets: 21,
        flows: 4,
        clients: 12,
      },
    ]);
  });

  test("the stored windows, keyed as the runner keys them", async () => {
    const start: Date = new Date("2026-10-24T10:00:00.250Z");
    answers.set("AS windowStartMs", [
      {
        usageKind: "application",
        networkKey: "L_1",
        windowStartMs: String(start.getTime()),
      },
      { usageKind: "uplink", networkKey: "", windowStartMs: "0" },
    ]);

    const keys: Set<string> =
      await NetworkTrafficUsageAggregationService.findStoredWindowKeys({
        projectId: PROJECT,
        connectionId: CONNECTION,
        windows: [
          {
            kind: NetworkTrafficUsageKind.Application,
            controllerNetworkId: "L_1",
            windowStartAt: start,
          },
        ],
      });

    expect(Array.from(keys)).toEqual([
      getWindowKey({
        kind: NetworkTrafficUsageKind.Application,
        controllerNetworkId: "L_1",
        windowStartAt: start,
      }),
    ]);
  });

  test("a window of uplink health is the organization's, keyed as an uplink's is", async () => {
    const start: Date = new Date("2026-10-24T10:00:00.000Z");
    answers.set("AS windowStartMs", [
      {
        usageKind: "uplinkHealth",
        networkKey: "",
        windowStartMs: String(start.getTime()),
      },
    ]);

    const keys: Set<string> =
      await NetworkTrafficUsageAggregationService.findStoredWindowKeys({
        projectId: PROJECT,
        connectionId: CONNECTION,
        windows: [
          {
            kind: NetworkTrafficUsageKind.UplinkHealth,
            controllerNetworkId: "",
            windowStartAt: start,
          },
        ],
      });

    expect(Array.from(keys)).toEqual([
      getWindowKey({
        kind: NetworkTrafficUsageKind.UplinkHealth,
        controllerNetworkId: "L_ANY",
        windowStartAt: start,
      }),
    ]);
  });

  test.each([
    [
      "the stored windows",
      NetworkTrafficUsageAggregationService.buildStoredWindowsStatement({
        projectId: PROJECT,
        connectionId: CONNECTION,
        windows: [
          {
            kind: NetworkTrafficUsageKind.UplinkHealth,
            controllerNetworkId: "",
            windowStartAt: new Date("2026-10-24T10:00:00.000Z"),
          },
        ],
      }),
    ],
    [
      "the stored ends",
      NetworkTrafficUsageAggregationService.buildStoredWindowEndsStatement({
        projectId: PROJECT,
        connectionId: CONNECTION,
        since: new Date("2026-10-23T11:00:00.000Z"),
      }),
    ],
  ])(
    "%s drop the network of both uplink kinds: one call covers them all",
    (_name: string, statement: Statement) => {
      expect(statement.query).toMatch(
        /if\(kind IN \(\{p\d+:String\}, \{p\d+:String\}\), '', controllerNetworkId\)/,
      );

      const values: Array<unknown> = Object.values(statement.query_params);

      expect(values).toContain(NetworkTrafficUsageKind.Uplink);
      expect(values).toContain(NetworkTrafficUsageKind.UplinkHealth);
    },
  );

  test("no windows to look for: nothing is asked", async () => {
    expect(
      await NetworkTrafficUsageAggregationService.findStoredWindowKeys({
        projectId: PROJECT,
        connectionId: CONNECTION,
        windows: [],
      }),
    ).toEqual(new Set());
    expect(statements).toHaveLength(0);
  });

  test("the stored ends: the newest uplink window, and each network's newest of either kind", async () => {
    answers.set("AS lastWindowEndMs", [
      { usageKind: "uplink", networkKey: "", lastWindowEndMs: "1792835700000" },
      {
        usageKind: "application",
        networkKey: "L_1",
        lastWindowEndMs: "1792836000123",
      },
      {
        usageKind: "client",
        networkKey: "L_1",
        lastWindowEndMs: "1792836000456",
      },
      { usageKind: "client", networkKey: "", lastWindowEndMs: "1792836000456" },
      { usageKind: "client", networkKey: "L_2", lastWindowEndMs: "0" },
    ]);

    const ends: NetworkTrafficUsageStoredEnds =
      await NetworkTrafficUsageAggregationService.findStoredWindowEnds({
        projectId: PROJECT,
        connectionId: CONNECTION,
        since: new Date("2026-10-23T11:00:00.000Z"),
      });

    expect(ends.uplinkEnd?.getTime()).toBe(1792835700000);
    expect(Array.from(ends.analyticsEnds.entries())).toEqual([
      ["L_1", new Date(1792836000456)],
    ]);
    expect(ends.uplinkHealthEnd).toBeNull();
  });

  test("uplink health has an end of its own, and never moves a network's analytics cursor", () => {
    /*
     * Were its rows read as a network's, a five-minute window of health would
     * say that network's two-hour window of applications had been stored, and
     * the next read would skip the applications it had never read.
     */
    const ends: NetworkTrafficUsageStoredEnds =
      NetworkTrafficUsageAggregationService.readStoredWindowEnds([
        {
          usageKind: "uplinkHealth",
          networkKey: "L_1",
          lastWindowEndMs: "1792835700000",
        },
        {
          usageKind: "uplinkHealth",
          networkKey: "",
          lastWindowEndMs: "1792836000000",
        },
        {
          usageKind: "uplinkHealth",
          networkKey: "",
          lastWindowEndMs: "1792830000000",
        },
      ]);

    expect(ends.uplinkHealthEnd?.getTime()).toBe(1792836000000);
    expect(ends.analyticsEnds.size).toBe(0);
    expect(ends.uplinkEnd).toBeNull();
  });

  test("how fresh a page is: ISO times, the applications' newest for analytics", async () => {
    answers.set("AS lastWindowEndMs", [
      { usageKind: "uplink", lastWindowEndMs: "1792835700000" },
      { usageKind: "application", lastWindowEndMs: "1792828800000" },
      { usageKind: "client", lastWindowEndMs: "1792836000000" },
    ]);

    const freshness: NetworkTrafficUsageFreshness =
      await NetworkTrafficUsageAggregationService.getFreshness({
        projectId: PROJECT,
        devices: {},
        now: new Date("2026-10-24T12:00:00.000Z"),
      });

    expect(freshness).toEqual({
      lastUplinkAt: new Date(1792835700000).toISOString(),
      lastAnalyticsAt: new Date(1792828800000).toISOString(),
    });
  });

  test("a page's freshness is its traffic's: a health window makes it no fresher", async () => {
    answers.set("AS lastWindowEndMs", [
      { usageKind: "uplink", lastWindowEndMs: "1792835700000" },
      { usageKind: "uplinkHealth", lastWindowEndMs: "1792836000000" },
    ]);

    const freshness: NetworkTrafficUsageFreshness =
      await NetworkTrafficUsageAggregationService.getFreshness({
        projectId: PROJECT,
        devices: {},
        now: new Date("2026-10-24T12:00:00.000Z"),
      });

    expect(freshness).toEqual({
      lastUplinkAt: new Date(1792835700000).toISOString(),
      lastAnalyticsAt: null,
    });
  });

  test("nothing stored: no freshness", async () => {
    expect(
      await NetworkTrafficUsageAggregationService.getFreshness({
        projectId: PROJECT,
        devices: {},
        now: new Date("2026-10-24T12:00:00.000Z"),
      }),
    ).toEqual({ lastUplinkAt: null, lastAnalyticsAt: null });
  });
});

describe("the page's uplinks, side by side", () => {
  const service: typeof NetworkTrafficUsageAggregationService =
    NetworkTrafficUsageAggregationService;
  const BUCKET: number = new Date("2026-10-24T10:00:00.000Z").getTime();

  test("what each carried, with what was measured on it", () => {
    expect(
      service.readUplinkInterfaces(
        [
          {
            uplinkKey: "wan1",
            applianceTotal: "1024",
            totalSent: 10.4,
            totalReceived: "20.6",
          },
        ],
        [{ uplinkKey: "wan1", averageLoss: "0.25", averageLatency: 21.5 }],
      ),
    ).toEqual([
      {
        interfaceName: "wan1",
        applianceCount: 1024,
        sentOctets: 10,
        receivedOctets: 21,
        lossPercent: 0.25,
        latencyMs: 21.5,
      },
    ]);
  });

  test("an uplink nobody measured says so: null, never a perfect 0", () => {
    const rows: ReturnType<typeof service.readUplinkInterfaces> =
      service.readUplinkInterfaces(
        [{ uplinkKey: "wan1", totalSent: 1, totalReceived: 1 }],
        [],
      );

    expect(rows[0]!.lossPercent).toBeNull();
    expect(rows[0]!.latencyMs).toBeNull();
  });

  test.each([[null], [undefined], [""], ["nan"], ["NaN"], [Number.NaN]])(
    "ClickHouse's %p for an average of nothing is null",
    (value: JSONValue) => {
      const rows: ReturnType<typeof service.readUplinkInterfaces> =
        service.readUplinkInterfaces(
          [{ uplinkKey: "wan1" }],
          [{ uplinkKey: "wan1", averageLoss: value, averageLatency: value }],
        );

      expect(rows[0]!.lossPercent).toBeNull();
      expect(rows[0]!.latencyMs).toBeNull();
    },
  );

  test("a real 0 stays 0: a perfect line is not an unknown one", () => {
    expect(
      service.readUplinkInterfaces(
        [{ uplinkKey: "wan1" }],
        [{ uplinkKey: "wan1", averageLoss: 0, averageLatency: "0" }],
      )[0],
    ).toMatchObject({ lossPercent: 0, latencyMs: 0 });
  });

  test("a standby line that carried nothing but was measured is listed, on no appliance's traffic", () => {
    expect(
      service.readUplinkInterfaces(
        [{ uplinkKey: "wan1", applianceTotal: 3, totalSent: 5 }],
        [
          { uplinkKey: "wan1", averageLoss: 0, averageLatency: 20 },
          { uplinkKey: "wan2", averageLoss: 0, averageLatency: 31 },
        ],
      ),
    ).toEqual([
      expect.objectContaining({ interfaceName: "wan1", applianceCount: 3 }),
      {
        interfaceName: "wan2",
        applianceCount: 0,
        sentOctets: 0,
        receivedOctets: 0,
        lossPercent: 0,
        latencyMs: 31,
      },
    ]);
  });

  test("a row with no name is no uplink, and the list stays capped", () => {
    const names: Array<JSONObject> = [];

    for (let index: number = 0; index < 30; index++) {
      names.push({ uplinkKey: `wan${index}` });
    }

    expect(
      service.readUplinkInterfaces(names, [{ uplinkKey: "" }]),
    ).toHaveLength(NETWORK_TRAFFIC_USAGE_TOP_LIMIT);
  });

  test("each bucket's bytes meet what was measured in it, by time and uplink", () => {
    expect(
      service.readUplinkSeries(
        [
          {
            bucketStartMs: String(BUCKET),
            uplinkKey: "wan2",
            bucketSent: 1.4,
            bucketReceived: 2.6,
          },
          {
            bucketStartMs: BUCKET,
            uplinkKey: "wan1",
            bucketSent: 10,
            bucketReceived: 20,
          },
        ],
        [
          {
            bucketStartMs: BUCKET,
            uplinkKey: "wan1",
            averageLoss: 0.5,
            averageLatency: 22,
          },
        ],
      ),
    ).toEqual([
      {
        time: "2026-10-24T10:00:00.000Z",
        interfaceName: "wan1",
        sentOctets: 10,
        receivedOctets: 20,
        lossPercent: 0.5,
        latencyMs: 22,
      },
      {
        time: "2026-10-24T10:00:00.000Z",
        interfaceName: "wan2",
        sentOctets: 1,
        receivedOctets: 3,
        lossPercent: null,
        latencyMs: null,
      },
    ]);
  });

  test("a bucket that was measured but carried nothing has a point of its own", () => {
    expect(
      service.readUplinkSeries(
        [],
        [
          {
            bucketStartMs: BUCKET,
            uplinkKey: "wan2",
            averageLoss: 0,
            averageLatency: 31,
          },
        ],
      ),
    ).toEqual([
      {
        time: "2026-10-24T10:00:00.000Z",
        interfaceName: "wan2",
        sentOctets: 0,
        receivedOctets: 0,
        lossPercent: 0,
        latencyMs: 31,
      },
    ]);
  });

  test("the points come oldest first, whichever kind found them first", () => {
    const later: number = BUCKET + 300000;

    expect(
      service
        .readUplinkSeries(
          [{ bucketStartMs: later, uplinkKey: "wan1" }],
          [{ bucketStartMs: BUCKET, uplinkKey: "wan1", averageLoss: 1 }],
        )
        .map((point: { time: string }): string => {
          return point.time;
        }),
    ).toEqual(["2026-10-24T10:00:00.000Z", "2026-10-24T10:05:00.000Z"]);
  });
});
