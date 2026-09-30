import { TelemetryAttributeService } from "../../../Server/Services/TelemetryAttributeService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

describe("TelemetryAttributeService.buildAttributeValuesStatement", () => {
  /*
   * Only the column/table names are read while building the statement, so a
   * lightweight source literal is enough — no real AnalyticsDatabaseService.
   */
  const source: unknown = {
    tableName: "MetricItemV3",
    attributesColumn: "attributes",
    attributeKeysColumn: "attributeKeys",
    timeColumn: "time",
  };

  type BuildInput = {
    projectId: ObjectID;
    source: unknown;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
  };

  const buildValuesStatement: (overrides?: Partial<BuildInput>) => Statement = (
    overrides: Partial<BuildInput> = {},
  ): Statement => {
    return (
      TelemetryAttributeService as unknown as {
        buildAttributeValuesStatement: (data: BuildInput) => Statement;
      }
    ).buildAttributeValuesStatement({
      projectId: ObjectID.generate(),
      source,
      attributeKey: "host.name",
      ...overrides,
    });
  };

  test("omits the ILIKE filter when no search text is provided", () => {
    const statement: Statement = buildValuesStatement();

    expect(statement.query).not.toContain("ILIKE");
  });

  /*
   * Sorting before the LIMIT made ClickHouse read every row in the window to
   * find the alphabetically first values. Without it, DISTINCT ... LIMIT
   * stops once it has enough: on a production day of logs, 9 s and 56
   * CPU-seconds became 32 ms for a key with thousands of values.
   */
  test("leaves ordering to the caller so DISTINCT ... LIMIT can stop early", () => {
    const statement: Statement = buildValuesStatement();

    expect(statement.query).not.toContain("ORDER BY");
    expect(statement.query).toMatch(/LIMIT \{p\d+:Int32\}/);
    expect(Object.values(statement.query_params)).toContain(100);
  });

  /*
   * The value picker fires for every prefix of a key being typed after `@`,
   * and each prefix used to scan a day of attribute maps to return nothing.
   */
  test("prunes granules with the attributeKeys bloom index", () => {
    const statement: Statement = buildValuesStatement();

    expect(statement.query).toMatch(
      /AND indexHint\(has\(\{p\d+:Identifier\}, \{p\d+:String\}\)\)/,
    );
    expect(Object.values(statement.query_params)).toContain("attributeKeys");
  });

  // Outside indexHint() the array would be read and checked on every row.
  test("only uses attributeKeys inside indexHint()", () => {
    const statement: Statement = buildValuesStatement();

    expect(statement.query.match(/\bhas\(/g)).toHaveLength(1);
    expect(statement.query).not.toContain("hasAny(");
  });

  test("omits the index hint when the source has no attributeKeys column", () => {
    const statement: Statement = buildValuesStatement({
      source: {
        tableName: "MetricItemV3",
        attributesColumn: "attributes",
        timeColumn: "time",
      },
    });

    expect(statement.query).not.toContain("indexHint");
    expect(statement.query).toContain("mapContains(");
  });

  /*
   * `attributes[key] != ''` reads the same, but through a Distributed table
   * it drops the map after PREWHERE and ClickHouse sizes read blocks by the
   * small value column: the same full scan took ten times the memory.
   */
  test("filters rows with mapContains rather than a subscript comparison", () => {
    const statement: Statement = buildValuesStatement();

    expect(statement.query).toMatch(
      /AND mapContains\(\{p\d+:Identifier\}, \{p\d+:String\}\)/,
    );
    expect(statement.query).not.toContain("!= ''");
  });

  test("never inlines the attribute key into the SQL text", () => {
    const statement: Statement = buildValuesStatement({
      attributeKey: "it's.a[key]",
    });

    expect(statement.query).not.toContain("it's");
    expect(Object.values(statement.query_params)).toContain("it's.a[key]");
  });

  test("omits the ILIKE filter when search text is only whitespace", () => {
    const statement: Statement = buildValuesStatement({ searchText: "   " });

    expect(statement.query).not.toContain("ILIKE");
  });

  test("adds a case-insensitive substring filter when search text is provided", () => {
    const statement: Statement = buildValuesStatement({ searchText: "web" });

    expect(statement.query).toContain("ILIKE");
    // The value is parameterized and wrapped with % wildcards.
    expect(Object.values(statement.query_params)).toContain("%web%");
    // The attribute key is always parameterized — never inlined into SQL.
    expect(Object.values(statement.query_params)).toContain("host.name");
  });

  test("trims surrounding whitespace from the search text", () => {
    const statement: Statement = buildValuesStatement({
      searchText: "  web-server  ",
    });

    expect(Object.values(statement.query_params)).toContain("%web-server%");
  });

  test("scopes to a metric when metricName is provided", () => {
    const statement: Statement = buildValuesStatement({
      metricName: "http.server.duration",
      searchText: "web",
    });

    expect(statement.query).toContain("AND name =");
    expect(Object.values(statement.query_params)).toContain(
      "http.server.duration",
    );
  });
});

describe("TelemetryAttributeService.fetchAttributeValuesFromDatabase", () => {
  type FetchInput = {
    projectId: ObjectID;
    source: unknown;
    attributeKey: string;
  };

  type FetchResult = {
    values: Array<string>;
    isComplete: boolean;
    statements: Array<Statement>;
  };

  type FetchFunction = (data: JSONObject | undefined) => Promise<FetchResult>;

  const fetchValues: FetchFunction = async (
    data: JSONObject | undefined,
  ): Promise<FetchResult> => {
    const statements: Array<Statement> = [];

    const entry: { values: Array<string>; isComplete: boolean } = await (
      TelemetryAttributeService as unknown as {
        fetchAttributeValuesFromDatabase: (
          input: FetchInput,
        ) => Promise<{ values: Array<string>; isComplete: boolean }>;
      }
    ).fetchAttributeValuesFromDatabase({
      projectId: ObjectID.generate(),
      source: {
        tableName: "LogItemV3",
        attributesColumn: "attributes",
        attributeKeysColumn: "attributeKeys",
        timeColumn: "time",
        service: {
          executeQuery: async (statement: Statement): Promise<unknown> => {
            statements.push(statement);
            return {
              json: async (): Promise<JSONObject> => {
                return data || {};
              },
            };
          },
        },
      },
      attributeKey: "RequestPath",
    });

    return { values: entry.values, isComplete: entry.isComplete, statements };
  };

  type RowsFunction = (count: number) => Array<JSONObject>;

  const rows: RowsFunction = (count: number): Array<JSONObject> => {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return { attributeValue: `/path/${index}` };
    });
  };

  test("runs the values statement once", async () => {
    const { statements } = await fetchValues({ data: [] });

    expect(statements).toHaveLength(1);
    expect(statements[0]!.query).toContain("indexHint(");
  });

  // Code-unit order, which is the byte order ClickHouse sorted ASCII by.
  test("sorts the values the query no longer orders", async () => {
    const { values } = await fetchValues({
      data: [
        { attributeValue: "/orders" },
        { attributeValue: "/Health" },
        { attributeValue: "/api" },
        { attributeValue: "/api/v2" },
      ],
    });

    expect(values).toEqual(["/Health", "/api", "/api/v2", "/orders"]);
  });

  test("drops empty, whitespace-only and non-string values", async () => {
    const { values } = await fetchValues({
      data: [
        { attributeValue: "" },
        { attributeValue: "   " },
        { attributeValue: null },
        { attributeValue: 42 },
        { attributeValue: "/api" },
      ],
    });

    expect(values).toEqual(["/api"]);
  });

  test("merges values that only differed by surrounding whitespace", async () => {
    const { values } = await fetchValues({
      data: [
        { attributeValue: "/api " },
        { attributeValue: "/api" },
        { attributeValue: " /api" },
      ],
    });

    expect(values).toEqual(["/api"]);
  });

  test("returns no values when the response has no data", async () => {
    const { values, isComplete } = await fetchValues(undefined);

    expect(values).toEqual([]);
    // Without statistics nothing says the query was not stopped early.
    expect(isComplete).toBe(false);
  });

  test("is complete when the query finished below the limit", async () => {
    const { isComplete } = await fetchValues({
      data: rows(99),
      statistics: { elapsed: 7.2, rows_read: 35000000, bytes_read: 1 },
    });

    expect(isComplete).toBe(true);
  });

  test("is incomplete once the rows reach the limit", async () => {
    const { values, isComplete } = await fetchValues({
      data: [{ attributeValue: "" }, ...rows(99)],
      statistics: { elapsed: 0.2, rows_read: 8192, bytes_read: 1 },
    });

    // The empty value took one of the hundred rows.
    expect(values).toHaveLength(99);
    expect(isComplete).toBe(false);
  });

  // ClickHouse reported 0.297s for a query 'break' stopped at 0.3s.
  test.each([40.5, 44.6, 45.3])(
    "is incomplete when the query ran %ss, as long as the time limit allows",
    async (elapsed: number) => {
      const { isComplete } = await fetchValues({
        data: rows(3),
        statistics: { elapsed, rows_read: 1, bytes_read: 1 },
      });

      expect(isComplete).toBe(false);
    },
  );

  test("puts the time limit it checks against into the statement", async () => {
    const { statements } = await fetchValues({ data: [] });

    expect(statements[0]!.query).toContain(
      "SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break'",
    );
  });
});

describe("TelemetryAttributeService.fetchAttributeValues", () => {
  type Response = {
    values?: Array<string>;
    rowCount?: number;
    elapsed?: number;
  };

  type Database = {
    statements: Array<Statement>;
    service: TelemetryAttributeService;
  };

  type RespondFunction = (statement: Statement) => Promise<Response>;

  type DatabaseOptions = {
    isMutableMetricSource?: boolean;
  };

  type CreateDatabaseFunction = (
    respond: RespondFunction,
    options?: DatabaseOptions,
  ) => Database;

  const createDatabase: CreateDatabaseFunction = (
    respond: RespondFunction,
    options?: DatabaseOptions,
  ): Database => {
    const statements: Array<Statement> = [];
    const service: TelemetryAttributeService = new TelemetryAttributeService();

    (
      service as unknown as {
        getTelemetrySource: () => unknown;
      }
    ).getTelemetrySource = (): unknown => {
      return {
        tableName: "LogItemV3",
        attributesColumn: "attributes",
        attributeKeysColumn: "attributeKeys",
        timeColumn: "time",
        isMutableMetricSource: options?.isMutableMetricSource,
        service: {
          executeQuery: async (statement: Statement): Promise<unknown> => {
            statements.push(statement);
            const response: Response = await respond(statement);
            const values: Array<string> = response.values || [];

            return {
              json: async (): Promise<JSONObject> => {
                return {
                  data: Array.from(
                    { length: response.rowCount ?? values.length },
                    (_value: unknown, index: number) => {
                      return {
                        attributeValue: values[index] ?? `value-${index}`,
                      };
                    },
                  ),
                  statistics: {
                    elapsed: response.elapsed ?? 0.1,
                    rows_read: 1,
                    bytes_read: 1,
                  },
                };
              },
            };
          },
        },
      };
    };

    return { statements, service };
  };

  type Cache = {
    entries: Map<string, JSONObject>;
    expiries: Array<number | undefined>;
  };

  type MockCacheFunction = () => Cache;

  const mockCache: MockCacheFunction = (): Cache => {
    const cache: Cache = { entries: new Map(), expiries: [] };

    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockImplementation(
        async (namespace: string, key: string): Promise<JSONObject | null> => {
          return cache.entries.get(`${namespace}-${key}`) || null;
        },
      );

    jest
      .spyOn(GlobalCache, "setJSON")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: JSONObject,
          options?: { expiresInSeconds: number },
        ): Promise<void> => {
          cache.entries.set(
            `${namespace}-${key}`,
            JSON.parse(JSON.stringify(value)) as JSONObject,
          );
          cache.expiries.push(options?.expiresInSeconds);
        },
      );

    return cache;
  };

  type Gate = {
    opened: Promise<void>;
    open: () => void;
  };

  type CreateGateFunction = () => Gate;

  const createGate: CreateGateFunction = (): Gate => {
    let open: () => void = (): void => {};

    const opened: Promise<void> = new Promise<void>((resolve: () => void) => {
      open = resolve;
    });

    return { opened, open };
  };

  type Request = {
    projectId: ObjectID;
    telemetryType: TelemetryType;
    attributeKey: string;
    searchText?: string;
    metricName?: string;
  };

  const environments: Array<string> = ["development", "production", "staging"];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("serves a repeat request from the cache for five minutes", async () => {
    const cache: Cache = mockCache();
    const { service, statements } = createDatabase(async () => {
      return { values: environments };
    });
    const projectId: ObjectID = ObjectID.generate();

    const first: Array<string> = await service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "env",
    });
    const second: Array<string> = await service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "env",
    });

    expect(first).toEqual(environments);
    expect(second).toEqual(environments);
    expect(statements).toHaveLength(1);
    expect(cache.expiries).toEqual([300]);
  });

  test("shares one query between identical requests that arrive together", async () => {
    mockCache();
    const gate: Gate = createGate();
    const { service, statements } = createDatabase(async () => {
      await gate.opened;
      return { values: environments };
    });
    const request: Request = {
      projectId: ObjectID.generate(),
      telemetryType: TelemetryType.Log,
      attributeKey: "env",
    };

    const pending: Promise<Array<Array<string>>> = Promise.all([
      service.fetchAttributeValues(request),
      service.fetchAttributeValues(request),
      service.fetchAttributeValues(request),
    ]);
    gate.open();

    expect(await pending).toEqual([environments, environments, environments]);
    expect(statements).toHaveLength(1);
  });

  test("answers a search by filtering the values an unfiltered load found", async () => {
    mockCache();
    const { service, statements } = createDatabase(async () => {
      return { values: environments };
    });
    const projectId: ObjectID = ObjectID.generate();

    await service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "env",
    });

    // Case-insensitive, as ILIKE is.
    expect(
      await service.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
        searchText: " PROD ",
      }),
    ).toEqual(["production"]);
    expect(
      await service.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
        searchText: "o",
      }),
    ).toEqual(["development", "production"]);
    expect(statements).toHaveLength(1);
  });

  test("answers a search that arrives while the unfiltered load runs", async () => {
    mockCache();
    const gate: Gate = createGate();
    const { service, statements } = createDatabase(async () => {
      await gate.opened;
      return { values: environments };
    });
    const projectId: ObjectID = ObjectID.generate();

    const unfiltered: Promise<Array<string>> = service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "env",
    });
    const search: Promise<Array<string>> = service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "env",
      searchText: "stag",
    });
    gate.open();

    expect(await unfiltered).toEqual(environments);
    expect(await search).toEqual(["staging"]);
    expect(statements).toHaveLength(1);
  });

  test("asks the database when the unfiltered load reached the limit", async () => {
    mockCache();
    const { service, statements } = createDatabase(
      async (statement: Statement) => {
        if (statement.query.includes("ILIKE")) {
          return { values: ["/api/orders/archived"] };
        }

        return { rowCount: 100 };
      },
    );
    const projectId: ObjectID = ObjectID.generate();

    await service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "RequestPath",
    });
    const values: Array<string> = await service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "RequestPath",
      searchText: "archived",
    });

    expect(values).toEqual(["/api/orders/archived"]);
    expect(statements).toHaveLength(2);
    expect(statements[1]!.query).toContain("ILIKE");
  });

  test("asks the database when the unfiltered load may have been cut short", async () => {
    mockCache();
    const { service, statements } = createDatabase(
      async (statement: Statement) => {
        if (statement.query.includes("ILIKE")) {
          return { values: ["qa"] };
        }

        return { values: environments, elapsed: 45.1 };
      },
    );
    const projectId: ObjectID = ObjectID.generate();

    await service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "env",
    });

    expect(
      await service.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
        searchText: "qa",
      }),
    ).toEqual(["qa"]);
    expect(statements).toHaveLength(2);
  });

  test("keeps searches, keys, metrics and projects apart", async () => {
    mockCache();
    const { service, statements } = createDatabase(
      async (statement: Statement) => {
        // Unfiltered loads reach the limit, so each search asks too.
        return {
          values: [JSON.stringify(Object.values(statement.query_params))],
          rowCount: statement.query.includes("ILIKE") ? 1 : 100,
        };
      },
    );
    const projectId: ObjectID = ObjectID.generate();
    const requests: Array<Request> = [
      { projectId, telemetryType: TelemetryType.Log, attributeKey: "env" },
      {
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
        searchText: "a",
      },
      {
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
        searchText: "b",
      },
      { projectId, telemetryType: TelemetryType.Log, attributeKey: "region" },
      {
        projectId: ObjectID.generate(),
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
      },
      {
        projectId,
        telemetryType: TelemetryType.Metric,
        attributeKey: "c",
        metricName: "a:b",
      },
      {
        projectId,
        telemetryType: TelemetryType.Metric,
        attributeKey: "b:c",
        metricName: "a",
      },
    ];

    const firstAnswers: Array<Array<string>> = [];

    for (const request of requests) {
      firstAnswers.push(await service.fetchAttributeValues(request));
    }

    expect(statements).toHaveLength(requests.length);
    expect(
      new Set(
        firstAnswers.map((answer: Array<string>) => {
          return JSON.stringify(answer);
        }),
      ).size,
    ).toBe(requests.length);

    for (const [index, request] of requests.entries()) {
      expect(await service.fetchAttributeValues(request)).toEqual(
        firstAnswers[index],
      );
    }

    expect(statements).toHaveLength(requests.length);
  });

  test("does not cache a failed load", async () => {
    const cache: Cache = mockCache();
    let failuresLeft: number = 1;
    const { service, statements } = createDatabase(async () => {
      if (failuresLeft > 0) {
        failuresLeft--;
        throw new Error("Timeout error.");
      }

      return { values: environments };
    });
    const projectId: ObjectID = ObjectID.generate();

    await expect(
      service.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
      }),
    ).rejects.toThrow("Timeout error.");
    expect(cache.entries.size).toBe(0);

    expect(
      await service.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
      }),
    ).toEqual(environments);
    expect(statements).toHaveLength(2);
  });

  test("still answers when the cache is unreachable", async () => {
    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockRejectedValue(new Error("Cache is not connected"));
    jest
      .spyOn(GlobalCache, "setJSON")
      .mockRejectedValue(new Error("Cache is not connected"));
    const { service, statements } = createDatabase(async () => {
      return { values: environments };
    });
    const projectId: ObjectID = ObjectID.generate();

    for (let attempt: number = 0; attempt < 2; attempt++) {
      expect(
        await service.fetchAttributeValues({
          projectId,
          telemetryType: TelemetryType.Log,
          attributeKey: "env",
        }),
      ).toEqual(environments);
    }

    expect(statements).toHaveLength(2);
  });

  test("ignores a cache entry of the wrong shape", async () => {
    const cache: Cache = mockCache();
    const { service, statements } = createDatabase(async () => {
      return { values: environments };
    });
    const projectId: ObjectID = ObjectID.generate();

    await service.fetchAttributeValues({
      projectId,
      telemetryType: TelemetryType.Log,
      attributeKey: "env",
    });

    for (const key of cache.entries.keys()) {
      cache.entries.set(key, { attributes: environments });
    }

    expect(
      await service.fetchAttributeValues({
        projectId,
        telemetryType: TelemetryType.Log,
        attributeKey: "env",
      }),
    ).toEqual(environments);
    expect(statements).toHaveLength(2);
  });

  test("reads mutable metrics fresh every time", async () => {
    const cache: Cache = mockCache();
    const { service, statements } = createDatabase(
      async () => {
        return { values: ["critical", "warning"] };
      },
      { isMutableMetricSource: true },
    );
    const projectId: ObjectID = ObjectID.generate();

    for (let attempt: number = 0; attempt < 2; attempt++) {
      expect(
        await service.fetchAttributeValues({
          projectId,
          telemetryType: TelemetryType.Metric,
          metricName: "oneuptime.incident.count",
          attributeKey: "severity",
        }),
      ).toEqual(["critical", "warning"]);
    }

    expect(statements).toHaveLength(2);
    expect(cache.entries.size).toBe(0);
  });
});
