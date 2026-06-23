import LogAggregationService, {
  FacetRequest,
} from "../../../Server/Services/LogAggregationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, test } from "@jest/globals";


const expectedLogTableName: string = (LogAggregationService as any).TABLE_NAME;
describe("LogAggregationService", () => {
  const defaultRequest: FacetRequest = {
    projectId: ObjectID.generate(),
    startTime: new Date("2026-03-01T00:00:00.000Z"),
    endTime: new Date("2026-03-12T00:00:00.000Z"),
    facetKey: "severityText",
    limit: 15,
  };

  const buildFacetStatement: (
    overrides?: Partial<FacetRequest>,
  ) => Statement = (overrides: Partial<FacetRequest> = {}): Statement => {
    return (LogAggregationService as any).buildFacetStatement({
      ...defaultRequest,
      ...overrides,
    });
  };

  test("builds a parameterized query for top-level facet keys", () => {
    const statement: Statement = buildFacetStatement({
      facetKey: "severityText",
    });

    expect(statement.query).toBe(
      "SELECT toString({p0:Identifier}) AS val, count() AS cnt FROM {p1:Identifier} WHERE projectId = {p2:String} AND time >= {p3:DateTime} AND time <= {p4:DateTime} AND retentionDate >= now() GROUP BY val ORDER BY cnt DESC LIMIT {p5:Int32} SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736",
    );

    expect(statement.query_params).toStrictEqual({
      p0: "severityText",
      p1: expectedLogTableName,
      p2: defaultRequest.projectId.toString(),
      p3: OneUptimeDate.toClickhouseDateTime(defaultRequest.startTime),
      p4: OneUptimeDate.toClickhouseDateTime(defaultRequest.endTime),
      p5: 15,
    });
  });

  test("builds a parameterized query for attribute facet keys", () => {
    const facetKey: string = "resource/service:name";
    const statement: Statement = buildFacetStatement({
      facetKey,
    });

    /*
     * attributes is Map(String, String) — facet reads MUST use subscript
     * access + mapContains. The previous JSONExtractRaw/JSONHas shape
     * throws ILLEGAL_TYPE_OF_ARGUMENT (Code 43) against Map columns.
     */
    expect(statement.query).toBe(
      "SELECT attributes[{p0:String}] AS val, count() AS cnt FROM {p1:Identifier} WHERE projectId = {p2:String} AND time >= {p3:DateTime} AND time <= {p4:DateTime} AND mapContains(attributes, {p5:String}) AND retentionDate >= now() GROUP BY val ORDER BY cnt DESC LIMIT {p6:Int32} SETTINGS max_execution_time = 45, timeout_overflow_mode = 'break', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736",
    );

    expect(statement.query_params).toStrictEqual({
      p0: facetKey,
      p1: expectedLogTableName,
      p2: defaultRequest.projectId.toString(),
      p3: OneUptimeDate.toClickhouseDateTime(defaultRequest.startTime),
      p4: OneUptimeDate.toClickhouseDateTime(defaultRequest.endTime),
      p5: facetKey,
      p6: 15,
    });
  });

  test("rejects malicious facet keys", () => {
    expect(() => {
      buildFacetStatement({
        facetKey: "x') AS val, version() AS cnt FROM system.functions -- ",
      });
    }).toThrow("Invalid facetKey");
  });

  test("rejects facet keys with unsupported characters", () => {
    expect(() => {
      buildFacetStatement({
        facetKey: "service name",
      });
    }).toThrow("Invalid facetKey");
  });

  test("histogram attribute filter matches attribute keys case-insensitively", () => {
    /*
     * Users typing `requestid` should still match data stored with the key
     * `requestId` (camelCase). The histogram filter shares the same WHERE
     * clause builder (`appendCommonFilters`) with the list/facet queries, so
     * verifying it on histogram covers all three.
     */
    const statement: Statement = (
      LogAggregationService as any
    ).buildHistogramStatement({
      ...defaultRequest,
      facetKey: undefined,
      attributes: { requestid: "uuid-123" },
    });

    expect(statement.query).toContain(
      "arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(",
    );
    expect(statement.query).toContain(
      ", mapKeys(attributes), mapValues(attributes))",
    );
    expect(Object.values(statement.query_params)).toContain("requestid");
    expect(Object.values(statement.query_params)).toContain("uuid-123");
  });
});
