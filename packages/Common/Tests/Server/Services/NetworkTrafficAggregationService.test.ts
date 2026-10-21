import NetworkTrafficAggregationService, {
  NETWORK_TRAFFIC_QUERY_TIMEOUT_SECONDS,
  NetworkTrafficAggregates,
  NetworkTrafficQuery,
  SERVICE_PORT_SQL,
} from "../../../Server/Services/NetworkTrafficAggregationService";
import NetworkFlowService from "../../../Server/Services/NetworkFlowService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../Types/Exception/BadDataException";
import NetworkFlowApplicationUtil from "../../../Types/NetFlow/NetworkFlowApplication";
import { NETWORK_TRAFFIC_TOP_LIMIT } from "../../../Types/NetFlow/NetworkTraffic";
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
];

const ALIASED_TO_A_COLUMN: RegExp = new RegExp(
  `\\)\\s+AS\\s+(${COLUMN_NAMES.join("|")})\\b`,
);

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
