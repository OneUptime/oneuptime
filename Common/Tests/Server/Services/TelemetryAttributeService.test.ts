import { TelemetryAttributeService } from "../../../Server/Services/TelemetryAttributeService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
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
    expect(statement.query).toContain("ORDER BY attributeValue ASC");
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
