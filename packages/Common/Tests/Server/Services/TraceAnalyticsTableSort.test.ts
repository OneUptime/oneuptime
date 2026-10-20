import TraceAggregationService, {
  TRACE_ANALYTICS_TABLE_GROUP_SORT_KEY,
  TRACE_ANALYTICS_TABLE_SORT_ALIASES,
  TraceAnalyticsRequest,
  parseTraceAnalyticsTableSort,
} from "../../../Server/Services/TraceAggregationService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The dashboard Trace Table's sortable columns (issue #5082), on the server:
 * the table's groups are ranked by the chosen aggregate in ClickHouse BEFORE
 * the top limit, so "the ten slowest by p99" is the slowest ten of the whole
 * window - never the slowest of the ten busiest. The request names a column
 * from a fixed list; the ORDER BY is built from that list and the group's own
 * alias, never from the request's text. Unset, the table ranks the busiest
 * groups first, written exactly as before.
 */

const projectId: ObjectID = ObjectID.generate();

function tableRequest(
  overrides: Partial<TraceAnalyticsRequest>,
): TraceAnalyticsRequest {
  return {
    projectId,
    startTime: new Date("2026-10-20T11:00:00.000Z"),
    endTime: new Date("2026-10-20T12:00:00.000Z"),
    bucketSizeInMinutes: 5,
    chartType: "table",
    metric: "count",
    groupBy: ["name"],
    limit: 10,
    ...overrides,
  };
}

// The query text of the one statement the table runs.
async function tableQuery(request: TraceAnalyticsRequest): Promise<string> {
  const statements: Array<Statement> = [];

  jest.spyOn(SpanService, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<Results> => {
    statements.push(statement);

    return Promise.resolve({
      json: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    } as unknown as Results);
  }) as never);

  await TraceAggregationService.getAnalyticsTable(request);

  expect(statements).toHaveLength(1);
  return statements[0]!.query;
}

// The text between ORDER BY and LIMIT.
function orderBy(query: string): string {
  const start: number = query.indexOf(" ORDER BY ");
  const end: number = query.indexOf(" LIMIT ", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return query.slice(start + " ORDER BY ".length, end);
}

describe("a trace table's order", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("unset, the busiest groups first, written exactly as the table always ranked them", async () => {
    const query: string = await tableQuery(tableRequest({}));

    expect(orderBy(query)).toBe("cnt DESC");
    expect(query).toContain(" ORDER BY cnt DESC LIMIT ");
  });

  test.each(
    Object.entries(TRACE_ANALYTICS_TABLE_SORT_ALIASES).flatMap(
      ([column, alias]: [string, string]) => {
        return [
          [column, "desc", alias, "DESC"],
          [column, "asc", alias, "ASC"],
        ];
      },
    ),
  )(
    "by %s %s: ranked by %s %s before the limit, the busiest first among ties",
    async (
      column: string,
      direction: string,
      alias: string,
      sqlDirection: string,
    ) => {
      const query: string = await tableQuery(
        tableRequest({
          tableSort: { column, direction: direction as "asc" | "desc" },
        }),
      );

      expect(orderBy(query)).toBe(
        alias === "cnt"
          ? `cnt ${sqlDirection}`
          : `${alias} ${sqlDirection}, cnt DESC`,
      );
    },
  );

  test("by the group column: the group's own alias, top-level or attribute", async () => {
    expect(
      orderBy(
        await tableQuery(
          tableRequest({
            groupBy: ["name"],
            tableSort: {
              column: TRACE_ANALYTICS_TABLE_GROUP_SORT_KEY,
              direction: "asc",
            },
          }),
        ),
      ),
    ).toBe("name ASC, cnt DESC");

    expect(
      orderBy(
        await tableQuery(
          tableRequest({
            groupBy: ["http.route"],
            tableSort: {
              column: TRACE_ANALYTICS_TABLE_GROUP_SORT_KEY,
              direction: "desc",
            },
          }),
        ),
      ),
    ).toBe("attr_0_http_route DESC, cnt DESC");
  });

  test("a sort the table cannot be ordered by is the busiest first", async () => {
    for (const tableSort of [
      { column: "cnt; DROP TABLE Span", direction: "desc" },
      { column: "p99", direction: "sideways" },
      { column: "durationUnixNano", direction: "desc" },
      { column: "constructor", direction: "asc" },
    ]) {
      expect(
        orderBy(
          await tableQuery(
            tableRequest({
              tableSort: tableSort as TraceAnalyticsRequest["tableSort"],
            }),
          ),
        ),
      ).toBe("cnt DESC");
    }
  });

  test("the limit still applies after the order", async () => {
    const query: string = await tableQuery(
      tableRequest({ limit: 25, tableSort: { column: "p99", direction: "desc" } }),
    );

    expect(query.indexOf(" LIMIT ")).toBeGreaterThan(
      query.indexOf(" ORDER BY "),
    );
  });
});

describe("a table sort a request names", () => {
  test("is read only from the fixed list, both ways", () => {
    expect(parseTraceAnalyticsTableSort("p99", "desc")).toEqual({
      column: "p99",
      direction: "desc",
    });
    expect(parseTraceAnalyticsTableSort("group", "asc")).toEqual({
      column: "group",
      direction: "asc",
    });

    for (const [column, direction] of [
      ["p99", "DESC"],
      ["p99", undefined],
      ["P99", "desc"],
      ["toString", "asc"],
      ["__proto__", "asc"],
      [5, "asc"],
      [undefined, undefined],
      [{ column: "p99" }, "desc"],
    ] as Array<[unknown, unknown]>) {
      expect(parseTraceAnalyticsTableSort(column, direction)).toBeNull();
    }
  });
});
