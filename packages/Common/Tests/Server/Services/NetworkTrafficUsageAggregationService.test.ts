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
import { JSONObject } from "../../../Types/JSON";
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

    expect(tops).toHaveLength(5);

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

  test("a bucket under a minute, or not whole, is refused", () => {
    for (const bucket of [30, 90.5, 0, -60]) {
      expect(() => {
        return NetworkTrafficUsageAggregationService.buildSeriesStatement(
          query(),
          NetworkTrafficUsageKind.Uplink,
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

    expect(statements).toHaveLength(9);
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
