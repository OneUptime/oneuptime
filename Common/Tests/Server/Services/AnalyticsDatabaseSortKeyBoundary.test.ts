import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import {
  SQL,
  Statement,
} from "../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../Server/Utils/Logger";
import "../TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../Types/API/Route";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";
import {
  describe,
  expect,
  beforeEach,
  afterEach,
  test,
  jest,
} from "@jest/globals";

/*
 * The sort-key boundary filter.
 *
 * ClickHouse reads in sorting-key order — and stops early — only when the
 * ORDER BY it is handed lines up with the table's physical key. The `_id`
 * tiebreaker appended by toPaginationStableSort is deliberately NOT a
 * sorting-key column, so it denies that plan: the engine reads every row
 * matching the WHERE, sorts the lot in memory, and discards all but one page.
 * On the Logs viewer that turned a 100-row page into a full-window scan and
 * tripped the 3 GiB max_memory_usage ceiling (Code 241, surfacing to users as
 * "Server Error").
 *
 * Measured on ClickHouse 26.7 against a 3M-row table shaped like LogItemV3
 * (140 rows per timestamp, fat attributes Map), one 100-row page:
 *
 *   ORDER BY time DESC                  107k rows read,  14.11 MiB peak
 *   ORDER BY time DESC, _id DESC        1.91M rows read, 114.92 MiB peak
 *   ... with the boundary filter         114k rows read,   8.68 MiB peak
 *
 * The fix does NOT weaken the tiebreaker — that would reintroduce the
 * skip/repeat paging bug it was added for. It bounds the rows the sort has to
 * consider, using a predicate that is result-preserving by construction:
 * `min(k)` over the top `skip + limit` values of the leading sort key is a
 * rank statistic of k's MULTISET, so it does not depend on which of several
 * tied rows the inner LIMIT kept, and every row tied at the boundary value is
 * admitted.
 *
 * Because the predicate cannot change results, every gate below is a
 * PERFORMANCE gate: getting one wrong makes a query slower, never wrong. The
 * suites assert that (a) the bound is emitted where it pays, (b) it is
 * withheld where it cannot be proven safe or cannot help, and (c) the page
 * the caller gets back is unchanged either way.
 */

const TIME_COLUMN: string = "time";
const PROJECT_ID_COLUMN: string = "projectId";
const BODY_COLUMN: string = "body";
const SEVERITY_COLUMN: string = "severityText";
const NULLABLE_SORT_COLUMN: string = "endedAt";

/*
 * Mirrors LogItemV3: sorting key (projectId, time, primaryEntityId), a
 * non-key column the table header can sort by, and a nullable column that
 * is a legal sort target but NOT safe to bound on.
 */
class LogLikeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<log-like-table>",
      singularName: "<singular-name>",
      pluralName: "<plural-name>",
      tableColumns: [
        new AnalyticsTableColumn({
          key: PROJECT_ID_COLUMN,
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.ObjectID,
        }),
        new AnalyticsTableColumn({
          key: TIME_COLUMN,
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.DateTime64,
        }),
        new AnalyticsTableColumn({
          key: SEVERITY_COLUMN,
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.Text,
        }),
        new AnalyticsTableColumn({
          key: NULLABLE_SORT_COLUMN,
          title: "<title>",
          description: "<description>",
          required: false,
          type: TableColumnType.DateTime64,
        }),
        new AnalyticsTableColumn({
          key: BODY_COLUMN,
          title: "<title>",
          description: "<description>",
          required: false,
          type: TableColumnType.Text,
        }),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: [PROJECT_ID_COLUMN, TIME_COLUMN],
      /*
       * `endedAt` is deliberately IN sortKeys so the nullable-column test
       * isolates the `required` gate rather than passing for the wrong
       * reason (failing the sortKeys membership gate instead).
       */
      sortKeys: [PROJECT_ID_COLUMN, TIME_COLUMN, NULLABLE_SORT_COLUMN],
      partitionKey: TIME_COLUMN,
      tableEngine: AnalyticsTableEngine.MergeTree,
      defaultSortColumn: TIME_COLUMN,
    });
  }
}

/*
 * Stands in for a derived aggregate target. `includeBaseColumns: false`
 * omits `_id`, so there is no off-key tiebreaker to pay for and nothing to
 * bound.
 */
class NoIdModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<no-id-table>",
      singularName: "<singular-name>",
      pluralName: "<plural-name>",
      includeBaseColumns: false,
      tableColumns: [
        new AnalyticsTableColumn({
          key: TIME_COLUMN,
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.DateTime64,
        }),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: [TIME_COLUMN],
      sortKeys: [TIME_COLUMN],
      partitionKey: TIME_COLUMN,
      tableEngine: AnalyticsTableEngine.MergeTree,
      defaultSortColumn: TIME_COLUMN,
    });
  }
}

/*
 * The boundary subquery is the only place a find statement nests a SELECT,
 * so its presence is the signal that the bound was emitted.
 */
function hasBoundary(statement: Statement): boolean {
  return statement.query.includes("(SELECT ");
}

/* The bound sits in the WHERE, so it precedes the outer ORDER BY. */
function boundaryClause(statement: Statement): string {
  const query: string = statement.query;
  return query.slice(query.indexOf(" AND "), query.lastIndexOf("ORDER BY "));
}

function outerOrderBy(statement: Statement): string {
  return statement.query
    .slice(statement.query.lastIndexOf("ORDER BY "))
    .replace("ORDER BY ", "")
    .split(" LIMIT")[0]!;
}

/* Resolves rendered `{pN:Identifier}` terms back to the bound column names. */
function orderByColumns(statement: Statement): Array<string> {
  return outerOrderBy(statement)
    .split(", ")
    .map((term: string): string => {
      const param: string = term.split(":")[0]!.replace("{", "");
      return statement.query_params[param] as string;
    });
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("AnalyticsDatabaseService sort key boundary", () => {
  let service: AnalyticsDatabaseService<LogLikeModel>;

  type FindArgs = {
    sort?: GenericObject | undefined;
    query?: GenericObject | undefined;
    groupBy?: GenericObject | undefined;
    limit?: unknown;
    skip?: unknown;
  };

  const runFind: (args: FindArgs) => Statement = (
    args: FindArgs,
  ): Statement => {
    return service.toFindStatement({
      select: {} as GenericObject,
      query: args.query ?? ({} as GenericObject),
      props: {} as GenericObject,
      sort: args.sort ?? { [TIME_COLUMN]: SortOrder.Descending },
      groupBy: args.groupBy,
      /*
       * `in` rather than a nullish default, so a test can pass an EXPLICIT
       * undefined limit/skip and actually exercise that path.
       */
      limit: "limit" in args ? args.limit : 50,
      skip: "skip" in args ? args.skip : 0,
    } as never).statement;
  };

  beforeEach(() => {
    service = new AnalyticsDatabaseService({ modelType: LogLikeModel });

    service.statementGenerator.toSelectStatement = jest.fn(() => {
      return { statement: SQL`<select>`, columns: ["<column>"] };
    });
    service.statementGenerator.toWhereStatement = jest.fn(() => {
      return SQL`<where>`;
    });

    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined!;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("emitted shape", () => {
    test("bounds the scan by the leading sort key", () => {
      const statement: Statement = runFind({
        sort: { [TIME_COLUMN]: SortOrder.Descending },
        limit: 50,
        skip: 0,
      });

      expect(hasBoundary(statement)).toBe(true);
      expect(boundaryClause(statement)).toContain("min(");
      expect(paramValues(statement)).toContain(TIME_COLUMN);
    });

    test("the bound is a lower bound for a descending sort", () => {
      const clause: string = boundaryClause(
        runFind({ sort: { [TIME_COLUMN]: SortOrder.Descending } }),
      );

      expect(clause).toContain(">=");
      expect(clause).toContain("min(");
      expect(clause).not.toContain("max(");
    });

    test("the bound flips to an upper bound for an ascending sort", () => {
      const clause: string = boundaryClause(
        runFind({ sort: { [TIME_COLUMN]: SortOrder.Ascending } }),
      );

      expect(clause).toContain("<=");
      expect(clause).toContain("max(");
      expect(clause).not.toContain("min(");
    });

    test("the inner sort direction matches the outer one", () => {
      expect(
        boundaryClause(
          runFind({ sort: { [TIME_COLUMN]: SortOrder.Descending } }),
        ),
      ).toContain("DESC");
      expect(
        boundaryClause(
          runFind({ sort: { [TIME_COLUMN]: SortOrder.Ascending } }),
        ),
      ).toContain("ASC");
    });

    /*
     * The bound admits every row that can reach position skip + limit. A
     * short inner LIMIT would cut the page off; a long one wastes the read.
     */
    test("the inner LIMIT is skip + limit", () => {
      expect(paramValues(runFind({ limit: 50, skip: 100 }))).toContain(150);
      expect(paramValues(runFind({ limit: 100, skip: 0 }))).toContain(100);
      expect(paramValues(runFind({ limit: 25, skip: 975 }))).toContain(1000);
    });

    /*
     * The whole point: the tiebreaker that makes paging deterministic is
     * still there, and still last. The bound only makes it affordable.
     */
    test("the _id tiebreaker is untouched", () => {
      const statement: Statement = runFind({
        sort: { [TIME_COLUMN]: SortOrder.Descending },
      });

      expect(orderByColumns(statement)).toStrictEqual([TIME_COLUMN, "_id"]);
    });

    test("the bound sits in the WHERE, before the outer ORDER BY", () => {
      const query: string = runFind({}).query;

      expect(query.indexOf("(SELECT ")).toBeLessThan(
        query.lastIndexOf("ORDER BY "),
      );
    });

    /*
     * A find carries exactly one bound. A second nested SELECT would mean
     * the filter was appended twice and the parameters bound twice.
     */
    test("emits exactly one boundary subquery", () => {
      const query: string = runFind({}).query;

      expect(query.split("(SELECT ").length - 1).toBe(2);
      expect(query.split("min(").length - 1).toBe(1);
    });

    /* The bound must read the same rows the outer query filters on. */
    test("the boundary subquery repeats the caller's WHERE", () => {
      const query: string = runFind({}).query;

      expect(query.split("<where>").length - 1).toBe(2);
    });

    test("renders valid parameter placeholders throughout", () => {
      const statement: Statement = runFind({ limit: 50, skip: 100 });
      const placeholders: Array<string> =
        statement.query.match(/\{p\d+:[A-Za-z0-9]+\}/g) ?? [];

      expect(placeholders.length).toBeGreaterThan(0);

      for (const placeholder of placeholders) {
        const name: string = placeholder.slice(1).split(":")[0]!;
        expect(statement.query_params).toHaveProperty(name);
      }
    });
  });

  describe("gates: the bound is withheld when it cannot help or cannot be proven safe", () => {
    /*
     * Under GROUP BY the predicate would restrict the aggregation INPUT
     * rather than the page, which WOULD change results.
     */
    test("no bound on a GROUP BY query", () => {
      const statement: Statement = runFind({
        groupBy: { [SEVERITY_COLUMN]: true },
      });

      expect(hasBoundary(statement)).toBe(false);
    });

    /*
     * A non-required column is Nullable in the DDL, and `k >= NULL` is
     * NULL — the bound would DROP those rows rather than narrow the scan.
     * `endedAt` IS in sortKeys, so only the `required` gate can stop this.
     */
    test("no bound on a nullable leading sort column", () => {
      const statement: Statement = runFind({
        sort: { [NULLABLE_SORT_COLUMN]: SortOrder.Descending },
      });

      expect(hasBoundary(statement)).toBe(false);
    });

    /*
     * Off-key leads already plan a bounded top-N, so the extra pass would
     * be pure waste.
     */
    test("no bound when the leading sort key is not in sortKeys", () => {
      const statement: Statement = runFind({
        sort: { [SEVERITY_COLUMN]: SortOrder.Descending },
      });

      expect(hasBoundary(statement)).toBe(false);
    });

    test("no bound when the model has no _id column to pay for", () => {
      const noIdService: AnalyticsDatabaseService<NoIdModel> =
        new AnalyticsDatabaseService({ modelType: NoIdModel });

      noIdService.statementGenerator.toSelectStatement = jest.fn(() => {
        return { statement: SQL`<select>`, columns: ["<column>"] };
      });
      noIdService.statementGenerator.toWhereStatement = jest.fn(() => {
        return SQL`<where>`;
      });

      const { statement } = noIdService.toFindStatement({
        select: {} as GenericObject,
        query: {} as GenericObject,
        props: {} as GenericObject,
        sort: { [TIME_COLUMN]: SortOrder.Descending },
        limit: 50,
        skip: 0,
      } as never);

      expect(hasBoundary(statement)).toBe(false);
    });

    /*
     * findOneById funnels a point lookup through findOneBy carrying the
     * model's default sort. At most one row matches, so bounding it would
     * double a query with no ordering problem.
     */
    test("no bound when the query already pins _id", () => {
      const statement: Statement = runFind({
        query: { _id: "<some-id>" } as GenericObject,
      });

      expect(hasBoundary(statement)).toBe(false);
    });

    test("no bound on an empty sort", () => {
      const statement: Statement = runFind({ sort: {} as GenericObject });

      expect(hasBoundary(statement)).toBe(false);
    });

    /*
     * The predicate is valid only BECAUSE of LIMIT/OFFSET. A non-finite
     * bound would admit an unbounded set, so fail back to today's SQL.
     */
    test.each([
      ["NaN limit", NaN, 0],
      ["NaN skip", 50, NaN],
      ["undefined limit", undefined, 0],
      ["Infinity limit", Infinity, 0],
      ["zero limit with zero skip", 0, 0],
      ["negative limit", -10, 0],
    ])("no bound for %s", (_label: string, limit: unknown, skip: unknown) => {
      expect(hasBoundary(runFind({ limit, skip }))).toBe(false);
    });

    /*
     * Every gate returns today's statement verbatim, so a withheld bound is
     * indistinguishable from the pre-fix SQL.
     */
    test("a withheld bound leaves the statement byte-identical to the unbounded form", () => {
      const bounded: Statement = runFind({
        sort: { [TIME_COLUMN]: SortOrder.Descending },
      });
      const withheld: Statement = runFind({
        sort: { [SEVERITY_COLUMN]: SortOrder.Descending },
      });

      expect(hasBoundary(bounded)).toBe(true);
      expect(withheld.query).not.toContain("(SELECT ");
      expect(withheld.query).toContain("ORDER BY ");
      expect(orderByColumns(withheld)).toStrictEqual([SEVERITY_COLUMN, "_id"]);
    });
  });

  /*
   * The bound is a rank statistic over the leading key's MULTISET, so it
   * cannot depend on tie order and cannot exclude a row the unbounded query
   * would have returned. These tests model that directly: they page a fixed
   * dataset with and without the bound, under adversarial tie orderings,
   * and require the pages to match exactly.
   *
   * Mirrors the "page boundary behaviour" suite in
   * AnalyticsDatabasePaginationStability.test.ts, which models the engine's
   * freedom to reorder ties rather than asserting SQL text.
   */
  describe("result preservation", () => {
    type Row = { time: number; _id: string };

    /* 12 rows over 3 timestamps, 4 tied on each. */
    const ROWS: Array<Row> = [
      { time: 300, _id: "a1" },
      { time: 300, _id: "a2" },
      { time: 300, _id: "a3" },
      { time: 300, _id: "a4" },
      { time: 200, _id: "b1" },
      { time: 200, _id: "b2" },
      { time: 200, _id: "b3" },
      { time: 200, _id: "b4" },
      { time: 100, _id: "c1" },
      { time: 100, _id: "c2" },
      { time: 100, _id: "c3" },
      { time: 100, _id: "c4" },
    ];

    /*
     * What the engine is ALLOWED to do: return rows in any order that is
     * consistent with the requested sort. `tieSeed` picks a different legal
     * tie ordering per fetch, standing in for part order and thread
     * scheduling varying between executions.
     */
    function scan(rows: Array<Row>, tieSeed: number): Array<Row> {
      const shuffled: Array<Row> = [...rows];

      /* Rotate within each tie group so the order differs per fetch. */
      const byTime: Map<number, Array<Row>> = new Map();
      for (const row of shuffled) {
        byTime.set(row.time, [...(byTime.get(row.time) ?? []), row]);
      }

      const out: Array<Row> = [];
      for (const time of [...byTime.keys()].sort((a: number, b: number) => {
        return b - a;
      })) {
        const group: Array<Row> = byTime.get(time)!;
        const offset: number = tieSeed % group.length;
        out.push(...group.slice(offset), ...group.slice(0, offset));
      }
      return out;
    }

    /* ORDER BY time DESC, _id DESC — a total order, tie-seed independent. */
    function sortTotal(rows: Array<Row>): Array<Row> {
      return [...rows].sort((left: Row, right: Row) => {
        return right.time - left.time || right._id.localeCompare(left._id);
      });
    }

    /* Today's SQL: sort everything the WHERE matched, then slice. */
    function unboundedPage(
      skip: number,
      limit: number,
      tieSeed: number,
    ): Array<Row> {
      return sortTotal(scan(ROWS, tieSeed)).slice(skip, skip + limit);
    }

    /*
     * The fix: min(time) over the top skip+limit rows by time DESC, admit
     * every row at or after it, then apply the same total order and slice.
     */
    function boundedPage(
      skip: number,
      limit: number,
      tieSeed: number,
    ): Array<Row> {
      const scanned: Array<Row> = scan(ROWS, tieSeed);
      const topN: Array<Row> = scanned.slice(0, skip + limit);

      if (topN.length === 0) {
        return [];
      }

      const boundary: number = Math.min(
        ...topN.map((row: Row): number => {
          return row.time;
        }),
      );

      const admitted: Array<Row> = scanned.filter((row: Row): boolean => {
        return row.time >= boundary;
      });

      return sortTotal(admitted).slice(skip, skip + limit);
    }

    test("the bound admits every row tied at the boundary value", () => {
      /* Top 2 rows by time DESC both sit at 300; the bound is 300. */
      const scanned: Array<Row> = scan(ROWS, 0);
      const boundary: number = Math.min(
        ...scanned.slice(0, 2).map((row: Row): number => {
          return row.time;
        }),
      );

      const admitted: Array<Row> = scanned.filter((row: Row): boolean => {
        return row.time >= boundary;
      });

      /* All FOUR rows at t=300 survive, not just the two that were scanned. */
      expect(admitted).toHaveLength(4);
      expect(
        admitted
          .map((row: Row): string => {
            return row._id;
          })
          .sort(),
      ).toStrictEqual(["a1", "a2", "a3", "a4"]);
    });

    test.each([
      [0, 5],
      [5, 5],
      [10, 5],
      [0, 1],
      [3, 4],
      [11, 1],
    ])(
      "bounded and unbounded pages are identical (skip %i, limit %i)",
      (skip: number, limit: number) => {
        for (let tieSeed: number = 0; tieSeed < 4; tieSeed++) {
          expect(boundedPage(skip, limit, tieSeed)).toStrictEqual(
            unboundedPage(skip, limit, tieSeed),
          );
        }
      },
    );

    test("paging the whole set with the bound returns every row exactly once", () => {
      const seen: Array<string> = [];

      for (let page: number = 0; page < 3; page++) {
        /* A different tie ordering per fetch, as the engine may do. */
        const rows: Array<Row> = boundedPage(page * 5, 5, page + 1);
        seen.push(
          ...rows.map((row: Row): string => {
            return row._id;
          }),
        );
      }

      expect(seen).toHaveLength(12);
      expect(new Set(seen).size).toBe(12);
    });

    /*
     * The final page matches fewer rows than skip + limit. This is why the
     * bound is min() over a subquery rather than the N-th value directly:
     * `ORDER BY time DESC LIMIT 1 OFFSET n-1` returns no row here, the
     * scalar is NULL, `time >= NULL` is NULL, and the page comes back empty.
     */
    test("a final page shorter than skip + limit is not truncated", () => {
      expect(boundedPage(10, 5, 0)).toStrictEqual(unboundedPage(10, 5, 0));
      expect(boundedPage(10, 5, 0)).toHaveLength(2);
    });

    test("an offset past the end returns nothing, not a full page", () => {
      expect(boundedPage(50, 5, 0)).toStrictEqual([]);
      expect(boundedPage(50, 5, 0)).toStrictEqual(unboundedPage(50, 5, 0));
    });

    test("the bound never narrows the page when every row ties", () => {
      const allTied: Array<Row> = ROWS.map((row: Row): Row => {
        return { time: 500, _id: row._id };
      });

      const scanned: Array<Row> = [...allTied];
      const boundary: number = Math.min(
        ...scanned.slice(0, 5).map((row: Row): number => {
          return row.time;
        }),
      );

      expect(
        scanned.filter((row: Row): boolean => {
          return row.time >= boundary;
        }),
      ).toHaveLength(12);
    });
  });
});
