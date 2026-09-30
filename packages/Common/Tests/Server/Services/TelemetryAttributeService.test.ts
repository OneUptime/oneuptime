import { TelemetryAttributeService } from "../../../Server/Services/TelemetryAttributeService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

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

  type FetchFunction = (
    data: JSONObject | undefined,
  ) => Promise<{ values: Array<string>; statements: Array<Statement> }>;

  const fetchValues: FetchFunction = async (
    data: JSONObject | undefined,
  ): Promise<{ values: Array<string>; statements: Array<Statement> }> => {
    const statements: Array<Statement> = [];

    const values: Array<string> = await (
      TelemetryAttributeService as unknown as {
        fetchAttributeValuesFromDatabase: (
          input: FetchInput,
        ) => Promise<Array<string>>;
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

    return { values, statements };
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
    const { values } = await fetchValues(undefined);

    expect(values).toEqual([]);
  });
});
