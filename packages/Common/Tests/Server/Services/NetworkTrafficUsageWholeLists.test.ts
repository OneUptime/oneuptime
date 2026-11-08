import NetworkTrafficUsageAggregationService, {
  NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS,
  NetworkTrafficUsageAggregates,
  NetworkTrafficUsageApplianceRow,
  NetworkTrafficUsageListQuery,
  NetworkTrafficUsageQuery,
  NetworkTrafficUsageRefile,
  NetworkTrafficUsageStorageTable,
} from "../../../Server/Services/NetworkTrafficUsageAggregationService";
import NetworkTrafficUsageService from "../../../Server/Services/NetworkTrafficUsageService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  MAX_NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE,
  MAX_NETWORK_TRAFFIC_USAGE_LIST_SKIP,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageListSort,
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
 * The Meraki side's reads and the one write of issue #5762, as ClickHouse
 * receives them (the real ClickHouse suite, App Tests/Telemetry/
 * NetworkTrafficUsageClickhouse, runs them):
 *
 *   - how many rows Top networks, Top applications and Top clients have in
 *     all, counted in the totals the page reads anyway, by the very keys
 *     the lists group by;
 *   - a page of a whole list: the top list's rows, searched, sorted and
 *     paged by the database, held exactly as the page's reads are held;
 *   - the appliances a device can be linked to;
 *   - the refile: an ALTER ... UPDATE of networkDeviceId, of the rows one
 *     device - the project's bucket, or a device whose link was undone -
 *     holds, every value a bound parameter.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CONNECTION: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const READABLE: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000001");
const BLOCKED: ObjectID = new ObjectID("30000000-0000-4000-8000-000000000002");
const ROUTER: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000002");
const HOSTILE: string = "x') OR 1=1 --";
// A bound parameter's number: two statements number theirs apart.
const PARAMETER_NUMBER: RegExp = /\{p\d+:/g;

function query(): NetworkTrafficUsageQuery {
  return {
    projectId: PROJECT,
    startTime: new Date("2026-10-24T10:00:00.000Z"),
    endTime: new Date("2026-10-24T12:00:00.000Z"),
    devices: { serviceIds: [READABLE], excludedServiceIds: [BLOCKED] },
    filters: {},
  };
}

function listQuery(
  overrides: Partial<NetworkTrafficUsageListQuery> = {},
): NetworkTrafficUsageListQuery {
  return {
    query: query(),
    list: NetworkTrafficUsageListKind.Networks,
    primaryKind: NetworkTrafficUsageKind.Uplink,
    search: "",
    sortBy: NetworkTrafficUsageListSort.Total,
    skip: 0,
    limit: 25,
    ...overrides,
  };
}

function valuesOf(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function expectHeldToThePage(statement: Statement, kind: string): void {
  const sql: string = statement.query;

  expect(sql).toMatch(/WHERE projectId = \{p\d+:String\}/);
  expect(valuesOf(statement)).toContain(PROJECT.toString());
  expect(sql).toMatch(/AND kind = \{p\d+:String\}/);
  expect(valuesOf(statement)).toContain(kind);
  expect(sql).toMatch(/windowStartAt >= \{p\d+:DateTime64\(9\)\}/);
  expect(sql).toMatch(/windowEndAt > \{p\d+:DateTime64\(9\)\}/);
  expect(sql).toMatch(/networkDeviceId IN \(/);
  expect(sql).toMatch(/networkDeviceId NOT IN \(/);
  expect(valuesOf(statement)).toContainEqual([READABLE.toString()]);
  expect(valuesOf(statement)).toContainEqual([BLOCKED.toString()]);
}

function expectBounded(statement: Statement): void {
  expect(statement.query).toContain(
    `max_execution_time = ${NETWORK_TRAFFIC_USAGE_QUERY_TIMEOUT_SECONDS}`,
  );
  expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
  expect(statement.query).toContain("max_memory_usage = ");
}

describe("how many rows each top list has in all", () => {
  test("every kind's totals count its networks: Top networks' rows of that kind", () => {
    for (const kind of [
      NetworkTrafficUsageKind.Uplink,
      NetworkTrafficUsageKind.Application,
      NetworkTrafficUsageKind.Client,
    ]) {
      const statement: Statement =
        NetworkTrafficUsageAggregationService.buildTotalsStatement(
          query(),
          kind,
        );

      expect(statement.query).toContain(
        "uniqExact(controllerNetworkId) AS networkTotal",
      );
      expectHeldToThePage(statement, kind);
      expectBounded(statement);
    }
  });

  test("the applications and clients are counted by their lists' own keys, the rest rows left out", () => {
    expect(
      NetworkTrafficUsageAggregationService.buildTotalsStatement(
        query(),
        NetworkTrafficUsageKind.Application,
      ).query,
    ).toContain("uniqExactIf(application, application != '') AS listTotal");
    expect(
      NetworkTrafficUsageAggregationService.buildTotalsStatement(
        query(),
        NetworkTrafficUsageKind.Client,
      ).query,
    ).toContain("uniqExactIf(clientKey, clientKey != '') AS listTotal");
    expect(
      NetworkTrafficUsageAggregationService.buildTotalsStatement(
        query(),
        NetworkTrafficUsageKind.Uplink,
      ).query,
    ).not.toContain("listTotal");
  });

  describe("as the page reads them", () => {
    let statements: Array<Statement>;

    function totalsRow(statement: Statement): Array<JSONObject> {
      if (!statement.query.includes("AS networkTotal")) {
        return [];
      }

      const values: Array<unknown> = valuesOf(statement);

      if (values.includes(NetworkTrafficUsageKind.Uplink)) {
        return [{ totalSent: 10, totalReceived: 20, networkTotal: "1205" }];
      }

      if (values.includes(NetworkTrafficUsageKind.Application)) {
        return [
          {
            totalSent: 3,
            totalReceived: 4,
            totalFlows: 5,
            networkTotal: "1180",
            listTotal: "347",
          },
        ];
      }

      return [
        { totalSent: 1, totalReceived: 2, networkTotal: 9, listTotal: "8644" },
      ];
    }

    beforeEach(() => {
      statements = [];

      jest
        .spyOn(NetworkTrafficUsageService, "executeQuery")
        .mockImplementation((async (statement: Statement) => {
          statements.push(statement);
          return {
            json: async () => {
              return { data: totalsRow(statement) };
            },
          };
        }) as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the networks of the page's own kind: its uplinks when it has any", async () => {
      const aggregates: NetworkTrafficUsageAggregates =
        await NetworkTrafficUsageAggregationService.getAggregates({
          query: query(),
          bucketSeconds: 300,
          primaryKind: NetworkTrafficUsageKind.Uplink,
        });

      expect(aggregates.networkCount).toBe(1205);
      expect(aggregates.applicationCount).toBe(347);
      expect(aggregates.clientCount).toBe(8644);
    });

    test("an organization without appliances counts its networks by their applications", async () => {
      const aggregates: NetworkTrafficUsageAggregates =
        await NetworkTrafficUsageAggregationService.getAggregates({
          query: query(),
          bucketSeconds: 300,
          primaryKind: NetworkTrafficUsageKind.Application,
        });

      expect(aggregates.networkCount).toBe(1180);
    });

    test("a count that is no number is none", async () => {
      jest.restoreAllMocks();
      jest
        .spyOn(NetworkTrafficUsageService, "executeQuery")
        .mockImplementation((async () => {
          return {
            json: async () => {
              return {
                data: [{ networkTotal: "NaN", listTotal: -4 }],
              };
            },
          };
        }) as never);

      const aggregates: NetworkTrafficUsageAggregates =
        await NetworkTrafficUsageAggregationService.getAggregates({
          query: query(),
          bucketSeconds: 300,
          primaryKind: NetworkTrafficUsageKind.Uplink,
        });

      expect(aggregates.networkCount).toBe(0);
      expect(aggregates.applicationCount).toBe(0);
      expect(aggregates.clientCount).toBe(0);
    });
  });
});

describe("a page of a whole list", () => {
  test.each([
    [NetworkTrafficUsageListKind.Networks, NetworkTrafficUsageKind.Uplink],
    [
      NetworkTrafficUsageListKind.Applications,
      NetworkTrafficUsageKind.Application,
    ],
    [NetworkTrafficUsageListKind.Clients, NetworkTrafficUsageKind.Client],
  ])(
    "%s: held to the project, the kind, the range and the caller's devices, and bounded",
    (list: NetworkTrafficUsageListKind, kind: NetworkTrafficUsageKind) => {
      for (const statement of [
        NetworkTrafficUsageAggregationService.buildListStatement(
          listQuery({ list }),
        ),
        NetworkTrafficUsageAggregationService.buildListCountStatement(
          listQuery({ list }),
        ),
      ]) {
        expectHeldToThePage(statement, kind);
        expectBounded(statement);
      }
    },
  );

  test("the networks add up as Top networks does: of the page's primary kind", () => {
    const statement: Statement =
      NetworkTrafficUsageAggregationService.buildListStatement(
        listQuery({ primaryKind: NetworkTrafficUsageKind.Application }),
      );

    expect(valuesOf(statement)).toContain(NetworkTrafficUsageKind.Application);
    expect(valuesOf(statement)).not.toContain(NetworkTrafficUsageKind.Uplink);
    expect(statement.query).toContain("GROUP BY networkKey");
  });

  test("each grouped as its top list groups, with the same rows left out", () => {
    const applications: string =
      NetworkTrafficUsageAggregationService.buildListStatement(
        listQuery({ list: NetworkTrafficUsageListKind.Applications }),
      ).query;
    const clients: string =
      NetworkTrafficUsageAggregationService.buildListStatement(
        listQuery({ list: NetworkTrafficUsageListKind.Clients }),
      ).query;

    expect(applications).toContain("AND application != ''");
    expect(applications).toContain("GROUP BY applicationKey");
    expect(applications).toContain("AS topProtocol");
    expect(clients).toContain("AND clientKey != ''");
    expect(clients).toContain("GROUP BY clientKeyValue");

    expect(
      NetworkTrafficUsageAggregationService.buildListCountStatement(
        listQuery({ list: NetworkTrafficUsageListKind.Applications }),
      ).query,
    ).toContain("uniqExact(application) AS listTotal");
    expect(
      NetworkTrafficUsageAggregationService.buildListCountStatement(
        listQuery({ list: NetworkTrafficUsageListKind.Clients }),
      ).query,
    ).toContain("uniqExact(clientKey) AS listTotal");
    expect(
      NetworkTrafficUsageAggregationService.buildListCountStatement(listQuery())
        .query,
    ).toContain("uniqExact(controllerNetworkId) AS listTotal");
  });

  test.each([
    [NetworkTrafficUsageListSort.Total, "(totalSent + totalReceived) DESC"],
    [NetworkTrafficUsageListSort.In, "totalReceived DESC"],
    [NetworkTrafficUsageListSort.Out, "totalSent DESC"],
  ])(
    "sorted by %s, busiest first, then by the row's key so pages never overlap",
    (sortBy: NetworkTrafficUsageListSort, order: string) => {
      expect(
        NetworkTrafficUsageAggregationService.buildListStatement(
          listQuery({ sortBy }),
        ).query,
      ).toContain(`ORDER BY ${order}, networkKey ASC`);
    },
  );

  test("the page: LIMIT and OFFSET from whole numbers checked first", () => {
    expect(
      NetworkTrafficUsageAggregationService.buildListStatement(
        listQuery({ skip: 75, limit: 25 }),
      ).query,
    ).toContain("LIMIT 25 OFFSET 75");
  });

  test.each([
    [{ skip: -1 }],
    [{ skip: 2.5 }],
    [{ skip: MAX_NETWORK_TRAFFIC_USAGE_LIST_SKIP + 1 }],
    [{ limit: 0 }],
    [{ limit: MAX_NETWORK_TRAFFIC_USAGE_LIST_PAGE_SIZE + 1 }],
    [{ limit: Number.NaN }],
  ])("a page out of range is refused: %p", (page: JSONObject) => {
    expect(() => {
      return NetworkTrafficUsageAggregationService.buildListStatement(
        listQuery(page as Partial<NetworkTrafficUsageListQuery>),
      );
    }).toThrow(BadDataException);
  });

  test.each([
    [
      NetworkTrafficUsageListKind.Networks,
      ["controllerNetworkName", "controllerNetworkId"],
    ],
    [NetworkTrafficUsageListKind.Applications, ["application"]],
    [
      NetworkTrafficUsageListKind.Clients,
      ["clientName", "clientIp", "clientMac", "clientManufacturer"],
    ],
  ])(
    "%s are searched in their names, without case, the text a bound parameter",
    (list: NetworkTrafficUsageListKind, columns: Array<string>) => {
      for (const statement of [
        NetworkTrafficUsageAggregationService.buildListStatement(
          listQuery({ list, search: HOSTILE }),
        ),
        NetworkTrafficUsageAggregationService.buildListCountStatement(
          listQuery({ list, search: HOSTILE }),
        ),
      ]) {
        for (const column of columns) {
          expect(statement.query).toMatch(
            new RegExp(
              `positionCaseInsensitiveUTF8\\(${column}, \\{p\\d+:String\\}\\) > 0`,
            ),
          );
        }

        expect(statement.query).not.toContain(HOSTILE);
        expect(valuesOf(statement)).toContain(HOSTILE);
      }
    },
  );

  test("no search, no condition", () => {
    expect(
      NetworkTrafficUsageAggregationService.buildListStatement(listQuery())
        .query,
    ).not.toContain("positionCaseInsensitiveUTF8");
  });

  describe("as read", () => {
    let statements: Array<Statement>;

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function answer(rows: Array<JSONObject>, total: unknown): void {
      statements = [];

      jest
        .spyOn(NetworkTrafficUsageService, "executeQuery")
        .mockImplementation((async (statement: Statement) => {
          statements.push(statement);
          return {
            json: async () => {
              return {
                data: statement.query.includes("AS listTotal FROM")
                  ? [{ listTotal: total }]
                  : rows,
              };
            },
          };
        }) as never);
    }

    test("the networks: their rows and how many the search matches", async () => {
      answer(
        [
          {
            networkKey: "L_1",
            networkName: "Store 001",
            totalSent: "10.4",
            totalReceived: 20,
          },
        ],
        "523",
      );

      const result: NetworkTrafficUsageListResult =
        await NetworkTrafficUsageAggregationService.getList(listQuery());

      expect(statements).toHaveLength(2);
      expect(result).toEqual({
        list: NetworkTrafficUsageListKind.Networks,
        count: 523,
        networks: [
          {
            controllerNetworkId: "L_1",
            name: "Store 001",
            sentOctets: 10,
            receivedOctets: 20,
          },
        ],
        applications: [],
        clients: [],
      });
    });

    test("the applications and the clients, each in its own list only", async () => {
      answer(
        [
          {
            applicationKey: "Zoom",
            topProtocol: "UDP",
            topPort: "8801",
            totalSent: 1,
            totalReceived: 2,
            totalFlows: 3,
          },
        ],
        2,
      );

      const applications: NetworkTrafficUsageListResult =
        await NetworkTrafficUsageAggregationService.getList(
          listQuery({ list: NetworkTrafficUsageListKind.Applications }),
        );

      expect(applications.applications).toEqual([
        {
          application: "Zoom",
          protocol: "UDP",
          port: 8801,
          sentOctets: 1,
          receivedOctets: 2,
          flows: 3,
        },
      ]);
      expect(applications.networks).toEqual([]);
      expect(applications.clients).toEqual([]);

      jest.restoreAllMocks();
      answer(
        [
          {
            clientKeyValue: "k1",
            clientNameValue: "POS 3",
            clientIpValue: "10.0.0.3",
            clientMacValue: "aa:bb:cc:dd:ee:ff",
            manufacturerValue: "Ingenico",
            networkName: "Store 001",
            totalSent: 5,
            totalReceived: 6,
          },
        ],
        "1",
      );

      const clients: NetworkTrafficUsageListResult =
        await NetworkTrafficUsageAggregationService.getList(
          listQuery({ list: NetworkTrafficUsageListKind.Clients }),
        );

      expect(clients.clients[0]).toEqual({
        clientKey: "k1",
        name: "POS 3",
        ip: "10.0.0.3",
        mac: "aa:bb:cc:dd:ee:ff",
        manufacturer: "Ingenico",
        controllerNetworkName: "Store 001",
        sentOctets: 5,
        receivedOctets: 6,
      });
      expect(clients.count).toBe(1);
    });
  });
});

describe("the appliances a device can be linked to", () => {
  function statementOf(
    overrides: Partial<{
      serials: Array<string>;
      controllerNetworkIds: Array<string>;
      limit: number;
    }> = {},
  ): Statement {
    return NetworkTrafficUsageAggregationService.buildAppliancesStatement({
      projectId: PROJECT,
      devices: { serviceIds: [READABLE] },
      since: new Date("2026-10-17T12:00:00.000Z"),
      limit: 20000,
      ...overrides,
    });
  }

  test("the project's uplink rows since the time given, as the caller may read them", () => {
    const statement: Statement = statementOf();

    expect(statement.query).toMatch(/WHERE projectId = \{p\d+:String\}/);
    expect(valuesOf(statement)).toContain(PROJECT.toString());
    expect(valuesOf(statement)).toContain(NetworkTrafficUsageKind.Uplink);
    expect(valuesOf(statement)).toContain("2026-10-17 12:00:00.000000000");
    expect(statement.query).toContain("AND deviceSerial != ''");
    expect(statement.query).toMatch(/networkDeviceId IN \(/);
    expectBounded(statement);
  });

  test("each by its newest window: a window that named none never wins over one that did", () => {
    const sql: string = statementOf().query;

    expect(sql).toContain(
      "argMaxIf(deviceName, windowEndAt, deviceName != '') AS applianceName",
    );
    expect(sql).toContain(
      "argMaxIf(controllerNetworkName, windowEndAt, controllerNetworkName != '') AS networkName",
    );
    expect(sql).toContain("argMax(networkDeviceId, windowEndAt) AS deviceKey");
    expect(sql).toContain("argMax(connectionId, windowEndAt) AS connectionKey");
    expect(sql).toContain(
      "GROUP BY serialKey ORDER BY serialKey ASC LIMIT 20000",
    );
  });

  test("only some serial numbers, or one network's, as bound arrays", () => {
    const bySerial: Statement = statementOf({ serials: [HOSTILE] });
    const byNetwork: Statement = statementOf({
      controllerNetworkIds: ["L_1"],
    });

    expect(bySerial.query).toMatch(
      /has\(\{p\d+:Array\(String\)\}, deviceSerial\)/,
    );
    expect(bySerial.query).not.toContain(HOSTILE);
    expect(valuesOf(bySerial)).toContainEqual([HOSTILE]);
    expect(byNetwork.query).toMatch(
      /has\(\{p\d+:Array\(String\)\}, controllerNetworkId\)/,
    );
    expect(statementOf().query).not.toContain("has(");
  });

  test("a limit below one is refused", () => {
    expect(() => {
      return statementOf({ limit: 0 });
    }).toThrow(BadDataException);
  });

  describe("as read", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("each as it reads now, its newest window an ISO time; a row with no serial is none", async () => {
      jest
        .spyOn(NetworkTrafficUsageService, "executeQuery")
        .mockImplementation((async () => {
          return {
            json: async () => {
              return {
                data: [
                  {
                    serialKey: "Q2PN-LDS0-0012",
                    applianceName: "LDS MX68",
                    networkKey: "L_12",
                    networkName: "Branch 012",
                    connectionKey: CONNECTION.toString(),
                    deviceKey: PROJECT.toString(),
                    lastWindowEndMs: String(
                      new Date("2026-10-24T11:55:00.000Z").getTime(),
                    ),
                    totalOctets: "1234.6",
                  },
                  { serialKey: "", applianceName: "nothing" },
                ],
              };
            },
          };
        }) as never);

      const rows: Array<NetworkTrafficUsageApplianceRow> =
        await NetworkTrafficUsageAggregationService.getAppliances({
          projectId: PROJECT,
          devices: {},
          since: new Date("2026-10-17T12:00:00.000Z"),
          limit: 10,
        });

      expect(rows).toEqual([
        {
          serial: "Q2PN-LDS0-0012",
          name: "LDS MX68",
          controllerNetworkId: "L_12",
          controllerNetworkName: "Branch 012",
          connectionId: CONNECTION.toString(),
          networkDeviceId: PROJECT.toString(),
          lastWindowEndAt: "2026-10-24T11:55:00.000Z",
          octets: 1235,
        },
      ]);
    });
  });
});

describe("filing stored traffic under another device", () => {
  const TABLE: NetworkTrafficUsageStorageTable = {
    databaseName: "oneuptime",
    storageTable: "NetworkTrafficUsageV1Local",
    onCluster: " ON CLUSTER 'oneuptime'",
  };

  function refile(
    overrides: Partial<NetworkTrafficUsageRefile> = {},
  ): NetworkTrafficUsageRefile {
    return {
      projectId: PROJECT,
      connectionId: CONNECTION,
      fromDeviceId: PROJECT,
      appliances: [{ serial: "Q2PN-LDS0-0012", deviceId: ROUTER }],
      networks: [{ controllerNetworkId: "L_12", deviceId: ROUTER }],
      since: new Date("2026-09-23T12:00:00.000Z"),
      ...overrides,
    };
  }

  test("the rows the device holds now, of the project and the connection, still kept", () => {
    const statement: Statement =
      NetworkTrafficUsageAggregationService.buildRefileStatement(
        refile(),
        TABLE,
      );
    const sql: string = statement.query;

    expect(sql).toMatch(/WHERE projectId = \{p\d+:String\}/);
    expect(sql).toMatch(/AND networkDeviceId = \{p\d+:String\}/);
    expect(sql).toMatch(/AND windowStartAt >= \{p\d+:DateTime64\(9\)\}/);
    expect(sql).toMatch(/AND connectionId = \{p\d+:String\}/);
    expect(valuesOf(statement)).toContain(PROJECT.toString());
    expect(valuesOf(statement)).toContain(CONNECTION.toString());
    expect(valuesOf(statement)).toContain("2026-09-23 12:00:00.000000000");
  });

  test("an appliance's uplinks and their health by its serial, a network's applications and clients by the network", () => {
    const statement: Statement =
      NetworkTrafficUsageAggregationService.buildRefileStatement(
        refile(),
        TABLE,
      );
    const sql: string = statement.query;

    expect(sql).toMatch(
      /UPDATE networkDeviceId = if\(kind IN \(\{p\d+:String\}, \{p\d+:String\}\), transform\(deviceSerial, \{p\d+:Array\(String\)\}, \{p\d+:Array\(String\)\}, networkDeviceId\), transform\(controllerNetworkId, \{p\d+:Array\(String\)\}, \{p\d+:Array\(String\)\}, networkDeviceId\)\)/,
    );
    expect(valuesOf(statement)).toContainEqual(["Q2PN-LDS0-0012"]);
    expect(valuesOf(statement)).toContainEqual(["L_12"]);
    expect(valuesOf(statement)).toContainEqual([ROUTER.toString()]);
    expect(valuesOf(statement)).toEqual(
      expect.arrayContaining([
        NetworkTrafficUsageKind.Uplink,
        NetworkTrafficUsageKind.UplinkHealth,
        NetworkTrafficUsageKind.Application,
        NetworkTrafficUsageKind.Client,
      ]),
    );
  });

  test("on the local storage table, on every node; the table's names are identifiers", () => {
    const statement: Statement =
      NetworkTrafficUsageAggregationService.buildRefileStatement(
        refile(),
        TABLE,
      );

    expect(statement.query).toMatch(
      /^ALTER TABLE \{p0:Identifier\}\.\{p1:Identifier\} ON CLUSTER 'oneuptime' UPDATE /,
    );
    expect(statement.query_params["p0"]).toBe("oneuptime");
    expect(statement.query_params["p1"]).toBe("NetworkTrafficUsageV1Local");
  });

  test("a table of one node has no cluster clause", () => {
    expect(
      NetworkTrafficUsageAggregationService.buildRefileStatement(refile(), {
        ...TABLE,
        onCluster: "",
      }).query,
    ).not.toContain("ON CLUSTER");
  });

  test("every connection's rows when none is named (a link a person made)", () => {
    expect(
      NetworkTrafficUsageAggregationService.buildRefileStatement(
        refile({ connectionId: undefined }),
        TABLE,
      ).query,
    ).not.toContain("connectionId");
  });

  test("a serial number, however hostile, is a parameter - never SQL", () => {
    const statement: Statement =
      NetworkTrafficUsageAggregationService.buildRefileStatement(
        refile({ appliances: [{ serial: HOSTILE, deviceId: ROUTER }] }),
        TABLE,
      );

    expect(statement.query).not.toContain(HOSTILE);
    expect(valuesOf(statement)).toContainEqual([HOSTILE]);
  });

  test("the production table: the service's database, its local table, on the cluster", () => {
    const table: NetworkTrafficUsageStorageTable =
      NetworkTrafficUsageAggregationService.getStorageTable();

    expect(table.storageTable).toBe("NetworkTrafficUsageV1Local");
    expect(table.onCluster).toMatch(/^ ON CLUSTER '.+'$/);
    expect(table.databaseName).toBeTruthy();
  });

  describe("as run", () => {
    let reads: Array<Statement>;
    let writes: Array<Statement | string>;
    let found: Array<JSONObject>;

    beforeEach(() => {
      reads = [];
      writes = [];
      found = [];

      jest
        .spyOn(NetworkTrafficUsageService, "executeQuery")
        .mockImplementation((async (statement: Statement) => {
          reads.push(statement);
          return {
            json: async () => {
              return { data: found };
            },
          };
        }) as never);
      jest
        .spyOn(NetworkTrafficUsageService, "execute")
        .mockImplementation((async (statement: Statement | string) => {
          writes.push(statement);
          return {} as never;
        }) as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("nothing to file: nothing is asked at all", async () => {
      expect(
        await NetworkTrafficUsageAggregationService.refile(
          refile({ appliances: [], networks: [] }),
          TABLE,
        ),
      ).toBe(false);
      expect(reads).toHaveLength(0);
      expect(writes).toHaveLength(0);
    });

    test("no row to move: no mutation is queued - never one per read", async () => {
      expect(
        await NetworkTrafficUsageAggregationService.refile(refile(), TABLE),
      ).toBe(false);
      expect(reads).toHaveLength(1);
      expect(reads[0]!.query).toContain("SELECT 1 AS found");
      expect(reads[0]!.query).toContain("LIMIT 1");
      expectBounded(reads[0]!);
      expect(writes).toHaveLength(0);
    });

    test("rows to move: one mutation, queued", async () => {
      found = [{ found: 1 }];

      expect(
        await NetworkTrafficUsageAggregationService.refile(refile(), TABLE),
      ).toBe(true);
      expect(writes).toHaveLength(1);
      expect((writes[0] as Statement).query).toMatch(/^ALTER TABLE /);
      expect((writes[0] as Statement).query).toContain(
        "UPDATE networkDeviceId = ",
      );
    });

    test("the check and the mutation name the same rows", async () => {
      found = [{ found: 1 }];

      await NetworkTrafficUsageAggregationService.refile(refile(), TABLE);

      // The WHERE of each, its parameters numbered alike, up to the check's LIMIT.
      const where: (sql: string) => string = (sql: string): string => {
        const from: string = sql.substring(sql.indexOf("WHERE projectId"));
        const end: number = from.indexOf(" LIMIT 1");

        return (end === -1 ? from : from.substring(0, end))
          .replace(PARAMETER_NUMBER, "{p:")
          .trim();
      };

      expect(where((writes[0] as Statement).query)).toBe(
        where(reads[0]!.query),
      );
    });
  });
});
