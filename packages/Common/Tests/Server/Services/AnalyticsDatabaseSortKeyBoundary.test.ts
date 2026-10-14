import AnalyticsDatabaseService, {
  SORT_KEY_PAGE_BOUND_ALIAS,
  SORT_KEY_PAGE_VALUES_ALIAS,
} from "../../../Server/Services/AnalyticsDatabaseService";
import {
  SQL,
  Statement,
} from "../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../Server/Utils/Logger";
import "../TestingUtils/Init";
import { orderByColumns } from "../TestingUtils/AnalyticsOrderBy";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
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
 * The sort-key page bound (AnalyticsDatabaseService.toSortKeyPageBound).
 *
 * ClickHouse reads in sorting-key order — and stops early — only when the
 * ORDER BY lines up with the table's physical key. The `_id` tiebreaker
 * appended by toPaginationStableSort is deliberately NOT a sorting-key
 * column, so it denies that plan: the engine reads every row matching the
 * WHERE and sorts the lot to keep one page. On the Logs viewer that turned a
 * 100-row page into a full-window scan past the 3 GiB max_memory_usage
 * ceiling ("Server Error").
 *
 * The bound finds the page in two steps of one statement:
 *
 *   1. a narrow read of the leading sort key alone, in key order, stopping
 *      after skip + limit matching rows. Its sorted values give the page's
 *      own key values and how many rows tied with its first value belong to
 *      earlier pages — one scalar subquery, named in a WITH clause;
 *   2. the wide read of the rows whose key is one of the page's values,
 *      sorted with the tiebreaker, skipping those earlier-page ties.
 *
 * Before #4710 step 2 read every row with key >= min(the first skip + limit
 * values). A filter matching a few rows spread over the range made that
 * range cover it all, and with no match min() was the column default (1970):
 * either way the wide read repeated the range the narrow read had just
 * scanned. Now a page past the last match reads no granule in step 2, and a
 * sparse page reads only the granules holding its own values.
 *
 * The suites below pin (a) the statement, (b) every gate that withholds the
 * bound, (c) that the page found this way is the unbounded page — modelled
 * step by step in the SQL's own terms, over seeded datasets heavy with ties,
 * both directions, every offset — and (d) what the wide read touches. The
 * same claims are checked against a real ClickHouse in
 * App/Tests/Telemetry/PagedFindBoundClickhouse.test.ts.
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
 * A model whose rows outlive their retention on disk until TTL drops them:
 * both reads of a bounded find must leave the expired ones out.
 */
class RetainedModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<retained-table>",
      singularName: "<singular-name>",
      pluralName: "<plural-name>",
      tableColumns: [
        new AnalyticsTableColumn({
          key: TIME_COLUMN,
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.DateTime64,
        }),
        new AnalyticsTableColumn({
          key: "retentionDate",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.Date,
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

const SETTINGS: string =
  "SETTINGS max_execution_time = 45, timeout_overflow_mode = 'throw', max_memory_usage = 3221225472, max_bytes_before_external_group_by = 1610612736, max_bytes_before_external_sort = 1610612736";

// Where the WITH clause hands over to the page's own SELECT.
const SELECT_AFTER_BOUND: string = `AS ${SORT_KEY_PAGE_BOUND_ALIAS} SELECT `;

const PAGE_OFFSET: string = `OFFSET tupleElement(${SORT_KEY_PAGE_BOUND_ALIAS}, 2)`;

// The bound is the only thing that puts a WITH clause in front of a find.
function hasBound(statement: Statement): boolean {
  return statement.query.startsWith("WITH (");
}

// The WITH clause: everything before the page's own SELECT.
function boundClause(statement: Statement): string {
  const query: string = statement.query;
  const at: number = query.indexOf(SELECT_AFTER_BOUND);
  return at < 0 ? "" : query.slice(0, at + SELECT_AFTER_BOUND.length);
}

// The page's own SELECT, from its SELECT keyword to the end.
function pageSelect(statement: Statement): string {
  const query: string = statement.query;
  const at: number = query.indexOf(SELECT_AFTER_BOUND);
  return at < 0
    ? query
    : query.slice(at + SELECT_AFTER_BOUND.length - "SELECT ".length);
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function count(text: string, piece: string): number {
  return text.split(piece).length - 1;
}

describe("AnalyticsDatabaseService sort key page bound", () => {
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

  describe("emitted statement", () => {
    /*
     * The whole statement, so any change to its shape is a decision made
     * here. Positions are 1-based in ClickHouse arrays: the page is
     * positions skip + 1 onwards of the sorted first skip + limit values.
     */
    test("a newest-first page: the narrow read in a WITH clause, the page's values on the WHERE, its ties as the OFFSET", () => {
      const statement: Statement = runFind({
        sort: { [TIME_COLUMN]: SortOrder.Descending },
        limit: 50,
        skip: 100,
      });

      expect(statement.query).toBe(
        "WITH (SELECT (arraySlice(__sortKeyTopValues, {p0:Int32}), countEqual(arraySlice(__sortKeyTopValues, 1, {p1:Int32}), __sortKeyTopValues[{p2:Int32}])) " +
          "FROM (SELECT arrayReverseSort(groupArray({p3:Identifier})) AS __sortKeyTopValues " +
          "FROM (SELECT {p4:Identifier} FROM {p5:Identifier}.{p6:Identifier} WHERE TRUE <where> ORDER BY {p7:Identifier} DESC LIMIT {p8:Int32}))) AS __sortKeyPage " +
          "SELECT <select> FROM {p9:Identifier}.{p10:Identifier} WHERE TRUE <where> " +
          "AND {p11:Identifier} GLOBAL IN (SELECT arrayJoin(tupleElement(__sortKeyPage, 1))) " +
          "ORDER BY {p12:Identifier} DESC, {p13:Identifier} DESC LIMIT {p14:Int32} OFFSET tupleElement(__sortKeyPage, 2)\n" +
          SETTINGS,
      );
      expect(statement.query_params).toStrictEqual({
        p0: 101, // the page starts at position skip + 1
        p1: 100, // the earlier pages' values: positions 1 .. skip
        p2: 101, // the page's first value, whose earlier-page ties are skipped
        p3: TIME_COLUMN,
        p4: TIME_COLUMN,
        p5: "oneuptime",
        p6: "<log-like-table>",
        p7: TIME_COLUMN,
        p8: 150, // skip + limit values of the leading key
        p9: "oneuptime",
        p10: "<log-like-table>",
        p11: TIME_COLUMN,
        p12: TIME_COLUMN,
        p13: "_id",
        p14: 50, // the page's own LIMIT is unchanged
      });
    });

    test("an oldest-first page sorts the values ascending and reads the key ascending", () => {
      const statement: Statement = runFind({
        sort: { [TIME_COLUMN]: SortOrder.Ascending },
        limit: 25,
        skip: 0,
      });

      expect(boundClause(statement)).toContain(
        "FROM (SELECT arraySort(groupArray({p3:Identifier})) AS __sortKeyTopValues",
      );
      expect(boundClause(statement)).not.toContain("arrayReverseSort");
      expect(boundClause(statement)).toContain(
        "ORDER BY {p7:Identifier} ASC LIMIT {p8:Int32}",
      );
      expect(orderByColumns(statement)).toStrictEqual([TIME_COLUMN, "_id"]);
      expect(pageSelect(statement)).toContain(
        "ORDER BY {p12:Identifier} ASC, {p13:Identifier} ASC LIMIT",
      );
    });

    test("the narrow read sorts in the same direction as the page", () => {
      expect(
        boundClause(runFind({ sort: { [TIME_COLUMN]: SortOrder.Descending } })),
      ).toContain(" DESC LIMIT ");
      expect(
        boundClause(runFind({ sort: { [TIME_COLUMN]: SortOrder.Ascending } })),
      ).toContain(" ASC LIMIT ");
    });

    /*
     * The narrow read keeps skip + limit values: fewer would cut the page
     * off, more would waste the read.
     */
    test.each([
      [50, 0, 50, 1, 0],
      [100, 0, 100, 1, 0],
      [50, 100, 150, 101, 100],
      [25, 975, 1000, 976, 975],
      [1, 131100, 131101, 131101, 131100],
    ])(
      "limit %i, skip %i: reads %i key values, the page from position %i, ties among the first %i",
      (
        limit: number,
        skip: number,
        read: number,
        from: number,
        earlier: number,
      ) => {
        const params: Record<string, unknown> = runFind({
          limit,
          skip,
        }).query_params;

        expect(params["p8"]).toBe(read);
        expect(params["p0"]).toBe(from);
        expect(params["p1"]).toBe(earlier);
        expect(params["p2"]).toBe(from);
        expect(params["p14"]).toBe(limit);
      },
    );

    /*
     * The narrow read reads only the leading key: one narrow column read in
     * key order is what lets it stop after skip + limit rows.
     */
    test("the narrow read selects the leading sort key and nothing else", () => {
      const clause: string = boundClause(runFind({}));

      expect(clause).toContain(
        "FROM (SELECT {p4:Identifier} FROM {p5:Identifier}.{p6:Identifier} WHERE",
      );
      expect(clause).not.toContain("<select>");
    });

    // The bound must be worked out over the rows the page filters on.
    test("the narrow read repeats the caller's WHERE, regenerated rather than shared", () => {
      const statement: Statement = runFind({});

      expect(count(boundClause(statement), "<where>")).toBe(1);
      expect(count(pageSelect(statement), "<where>")).toBe(1);
      expect(service.statementGenerator.toWhereStatement).toHaveBeenCalledTimes(
        2,
      );
    });

    test("both reads leave expired rows out", () => {
      const retained: AnalyticsDatabaseService<RetainedModel> =
        new AnalyticsDatabaseService({ modelType: RetainedModel });

      retained.statementGenerator.toSelectStatement = jest.fn(() => {
        return { statement: SQL`<select>`, columns: ["<column>"] };
      });
      retained.statementGenerator.toWhereStatement = jest.fn(() => {
        return SQL`<where>`;
      });

      const statement: Statement = retained.toFindStatement({
        select: {} as GenericObject,
        query: {} as GenericObject,
        props: {} as GenericObject,
        sort: { [TIME_COLUMN]: SortOrder.Descending },
        limit: 10,
        skip: 0,
      } as never).statement;

      expect(hasBound(statement)).toBe(true);
      expect(
        count(boundClause(statement), "<where> AND retentionDate >= now()"),
      ).toBe(1);
      expect(
        count(pageSelect(statement), "<where> AND retentionDate >= now()"),
      ).toBe(1);
    });

    /*
     * A set, not a range: a range from the page's last value to the newest
     * one is what read the time range twice. GLOBAL, because the table is
     * Distributed: every shard gets the page's values as a table.
     */
    test("the wide read takes the rows whose key is one of the page's values, as a set", () => {
      const select: string = pageSelect(runFind({}));

      expect(select).toContain(
        " AND {p11:Identifier} GLOBAL IN (SELECT arrayJoin(tupleElement(__sortKeyPage, 1))) ORDER BY ",
      );
      expect(select).not.toContain(">=");
      expect(select).not.toContain("<=");
      expect(select).not.toContain("min(");
      expect(select).not.toContain("max(");
      expect(select).not.toContain("has(");
    });

    test("the page's values are its own: no min or max of the values is read", () => {
      const clause: string = boundClause(runFind({}));

      expect(clause).not.toContain("min(");
      expect(clause).not.toContain("max(");
      expect(clause).not.toContain("OrNull(");
    });

    test("the page skips only the earlier pages' ties with its first value", () => {
      const statement: Statement = runFind({ limit: 50, skip: 100 });

      expect(statement.query).toContain(`LIMIT {p14:Int32} ${PAGE_OFFSET}\n`);
      // `skip` itself is only the length of the earlier pages' values.
      expect(
        Object.entries(statement.query_params).filter(
          ([, value]: [string, unknown]): boolean => {
            return value === 100;
          },
        ),
      ).toStrictEqual([["p1", 100]]);
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

    test("a page sorted by several keys is bounded by the first one and ordered by all of them", () => {
      const statement: Statement = runFind({
        sort: {
          [TIME_COLUMN]: SortOrder.Descending,
          [SEVERITY_COLUMN]: SortOrder.Ascending,
        },
      });

      expect(statement.query_params["p3"]).toBe(TIME_COLUMN);
      expect(statement.query_params["p11"]).toBe(TIME_COLUMN);
      expect(orderByColumns(statement)).toStrictEqual([
        TIME_COLUMN,
        SEVERITY_COLUMN,
        "_id",
      ]);
    });

    /*
     * One WITH clause, named once and used twice: the narrow read runs
     * once however often the page's parts are read.
     */
    test("the narrow read is written once, and its name used twice", () => {
      const query: string = runFind({}).query;

      expect(count(query, "WITH (")).toBe(1);
      expect(count(query, `) AS ${SORT_KEY_PAGE_BOUND_ALIAS} `)).toBe(1);
      expect(count(query, `tupleElement(${SORT_KEY_PAGE_BOUND_ALIAS}, `)).toBe(
        2,
      );
      expect(count(query, "groupArray(")).toBe(1);
      expect(count(query, " GLOBAL IN ")).toBe(1);
    });

    test("renders valid parameter placeholders throughout", () => {
      const statement: Statement = runFind({ limit: 50, skip: 100 });
      const placeholders: Array<string> =
        statement.query.match(/\{p\d+:[A-Za-z0-9()]+\}/g) ?? [];

      expect(placeholders.length).toBeGreaterThan(0);

      for (const placeholder of placeholders) {
        const name: string = placeholder.slice(1).split(":")[0]!;
        expect(statement.query_params).toHaveProperty(name);
      }

      expect(Object.keys(statement.query_params)).toHaveLength(
        placeholders.length,
      );
    });

    test("the aliases are internal names, not identifiers a caller passes", () => {
      expect(SORT_KEY_PAGE_BOUND_ALIAS).toBe("__sortKeyPage");
      expect(SORT_KEY_PAGE_VALUES_ALIAS).toBe("__sortKeyTopValues");
      expect(paramValues(runFind({}))).not.toContain(SORT_KEY_PAGE_BOUND_ALIAS);
    });
  });

  describe("gates: the bound is withheld when it cannot help or cannot be proven exact", () => {
    /*
     * Under GROUP BY the predicate would restrict the aggregation INPUT
     * rather than the page, which WOULD change results.
     */
    test("no bound on a GROUP BY query", () => {
      const statement: Statement = runFind({
        groupBy: { [SEVERITY_COLUMN]: true },
      });

      expect(hasBound(statement)).toBe(false);
      expect(statement.query).not.toContain("GLOBAL IN");
    });

    /*
     * A non-required column is Nullable in the DDL. A NULL is never IN a
     * set, so the bound would DROP those rows rather than narrow the scan.
     * `endedAt` IS in sortKeys, so only the `required` gate can stop this.
     */
    test("no bound on a nullable leading sort column", () => {
      const statement: Statement = runFind({
        sort: { [NULLABLE_SORT_COLUMN]: SortOrder.Descending },
      });

      expect(hasBound(statement)).toBe(false);
    });

    /*
     * Off-key leads already plan a bounded top-N, so the extra pass would
     * be pure waste.
     */
    test("no bound when the leading sort key is not in sortKeys", () => {
      const statement: Statement = runFind({
        sort: { [SEVERITY_COLUMN]: SortOrder.Descending },
      });

      expect(hasBound(statement)).toBe(false);
    });

    test("a key column that only trails the sort does not get the bound", () => {
      const statement: Statement = runFind({
        sort: {
          [SEVERITY_COLUMN]: SortOrder.Descending,
          [TIME_COLUMN]: SortOrder.Descending,
        },
      });

      expect(hasBound(statement)).toBe(false);
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

      expect(hasBound(statement)).toBe(false);
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

      expect(hasBound(statement)).toBe(false);
    });

    test("no bound on an empty sort", () => {
      const statement: Statement = runFind({ sort: {} as GenericObject });

      expect(hasBound(statement)).toBe(false);
    });

    /*
     * The bound is built from LIMIT and OFFSET themselves. A page that is
     * not a whole number of rows from a whole offset is sent as written.
     */
    test.each([
      ["NaN limit", NaN, 0],
      ["NaN skip", 50, NaN],
      ["undefined limit", undefined, 0],
      ["undefined skip", 50, undefined],
      ["Infinity limit", Infinity, 0],
      ["zero limit with zero skip", 0, 0],
      ["zero limit past a skip", 0, 100],
      ["negative limit", -10, 0],
      ["negative limit that a skip would make positive", -10, 100],
      ["negative skip", 50, -1],
      ["fractional limit", 10.5, 0],
      ["fractional skip", 10, 2.5],
      ["a limit past the safe integers", 2 ** 53, 0],
    ])("no bound for %s", (_label: string, limit: unknown, skip: unknown) => {
      expect(hasBound(runFind({ limit, skip }))).toBe(false);
    });

    test("a first page of one row is bounded", () => {
      expect(hasBound(runFind({ limit: 1, skip: 0 }))).toBe(true);
    });

    /*
     * Every gate returns the statement as it was before the bound existed,
     * byte for byte: no WITH clause, the caller's OFFSET.
     */
    test("a withheld bound leaves the statement byte-identical to the unbounded form", () => {
      const withheld: Statement = runFind({
        sort: { [SEVERITY_COLUMN]: SortOrder.Descending },
        limit: 50,
        skip: 100,
      });

      expect(withheld.query).toBe(
        "SELECT <select> FROM {p0:Identifier}.{p1:Identifier} WHERE TRUE <where> ORDER BY {p2:Identifier} DESC, {p3:Identifier} DESC LIMIT {p4:Int32} OFFSET {p5:Int32}\n" +
          SETTINGS,
      );
      expect(withheld.query_params).toStrictEqual({
        p0: "oneuptime",
        p1: "<log-like-table>",
        p2: SEVERITY_COLUMN,
        p3: "_id",
        p4: 50,
        p5: 100,
      });
    });

    test("a withheld bound calls the WHERE generator once", () => {
      runFind({ groupBy: { [SEVERITY_COLUMN]: true } });

      expect(service.statementGenerator.toWhereStatement).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  /*
   * The page the bound finds is the unbounded page. Modelled in the SQL's
   * own terms — what each function of the statement does — and compared
   * with the unbounded page over seeded datasets heavy with ties, both
   * directions, one and two sort keys, and every offset up to past the end.
   *
   * What the engine is free to do is modelled too: the narrow read's LIMIT
   * keeps whichever of several tied rows it meets first, so each read
   * shuffles the rows before sorting them by the key alone.
   */
  describe("the page the bound finds is the unbounded page", () => {
    interface Row {
      key: number;
      second: number;
      _id: string;
      matches: boolean;
    }

    interface Sorting {
      key: SortOrder;
      // A second sort key between the leading key and the tiebreaker.
      second?: SortOrder | undefined;
    }

    const sign: (order: SortOrder) => number = (order: SortOrder): number => {
      return order === SortOrder.Ascending ? 1 : -1;
    };

    // ORDER BY key, [second,] _id — the tiebreaker follows the last key.
    const totalOrder: (
      sorting: Sorting,
    ) => (left: Row, right: Row) => number = (sorting: Sorting) => {
      const tiebreak: SortOrder = sorting.second ?? sorting.key;

      return (left: Row, right: Row): number => {
        return (
          sign(sorting.key) * (left.key - right.key) ||
          (sorting.second ? sign(sorting.second) * (left.second - right.second) : 0) ||
          sign(tiebreak) * left._id.localeCompare(right._id)
        );
      };
    };

    const shuffled: (rows: Array<Row>, random: SeededRandom) => Array<Row> = (
      rows: Array<Row>,
      random: SeededRandom,
    ): Array<Row> => {
      const out: Array<Row> = [...rows];

      for (let index: number = out.length - 1; index > 0; index--) {
        const other: number = random(index + 1);
        [out[index], out[other]] = [out[other]!, out[index]!];
      }

      return out;
    };

    // The find as it was sent before the bound: sort everything, then slice.
    const unboundedPage: (
      rows: Array<Row>,
      sorting: Sorting,
      skip: number,
      limit: number,
    ) => Array<string> = (
      rows: Array<Row>,
      sorting: Sorting,
      skip: number,
      limit: number,
    ): Array<string> => {
      return rows
        .filter((row: Row): boolean => {
          return row.matches;
        })
        .sort(totalOrder(sorting))
        .slice(skip, skip + limit)
        .map((row: Row): string => {
          return row._id;
        });
    };

    // ClickHouse's 1-based array functions, as the statement calls them.
    const arraySlice: (
      values: Array<number>,
      offset: number,
      length?: number,
    ) => Array<number> = (
      values: Array<number>,
      offset: number,
      length?: number,
    ): Array<number> => {
      return length === undefined
        ? values.slice(offset - 1)
        : values.slice(offset - 1, offset - 1 + length);
    };

    // Out of range, arrayElement is the type's default: 0 here, 1970 for a time.
    const arrayElement: (values: Array<number>, index: number) => number = (
      values: Array<number>,
      index: number,
    ): number => {
      return values[index - 1] ?? 0;
    };

    const countEqual: (values: Array<number>, value: number) => number = (
      values: Array<number>,
      value: number,
    ): number => {
      return values.filter((each: number): boolean => {
        return each === value;
      }).length;
    };

    interface PageBound {
      values: Array<number>;
      offset: number;
    }

    /*
     * The WITH clause: the first skip + limit key values in key order —
     * whichever tied rows the read met first — sorted, then the page's own
     * values and the count of earlier-page ties with its first value.
     */
    const pageBound: (
      rows: Array<Row>,
      sorting: Sorting,
      skip: number,
      limit: number,
      random: SeededRandom,
    ) => PageBound = (
      rows: Array<Row>,
      sorting: Sorting,
      skip: number,
      limit: number,
      random: SeededRandom,
    ): PageBound => {
      const narrowRead: Array<number> = shuffled(rows, random)
        .filter((row: Row): boolean => {
          return row.matches;
        })
        // Array.prototype.sort is stable: ties keep the shuffled order.
        .sort((left: Row, right: Row): number => {
          return sign(sorting.key) * (left.key - right.key);
        })
        .slice(0, skip + limit)
        .map((row: Row): number => {
          return row.key;
        });

      // arrayReverseSort / arraySort of groupArray(key).
      const topValues: Array<number> = [...narrowRead].sort(
        (left: number, right: number): number => {
          return sign(sorting.key) * (left - right);
        },
      );

      return {
        values: arraySlice(topValues, skip + 1),
        offset: countEqual(
          arraySlice(topValues, 1, skip),
          arrayElement(topValues, skip + 1),
        ),
      };
    };

    // The page's SELECT: key IN the page's values, the total order, LIMIT, OFFSET.
    const boundedPage: (
      rows: Array<Row>,
      sorting: Sorting,
      skip: number,
      limit: number,
      random: SeededRandom,
    ) => Array<string> = (
      rows: Array<Row>,
      sorting: Sorting,
      skip: number,
      limit: number,
      random: SeededRandom,
    ): Array<string> => {
      const bound: PageBound = pageBound(rows, sorting, skip, limit, random);
      const values: Set<number> = new Set(bound.values);

      return shuffled(rows, random)
        .filter((row: Row): boolean => {
          return row.matches && values.has(row.key);
        })
        .sort(totalOrder(sorting))
        .slice(bound.offset, bound.offset + limit)
        .map((row: Row): string => {
          return row._id;
        });
    };

    // Rows with keys from a small domain, so ties are everywhere.
    const dataset: (
      random: SeededRandom,
      size: number,
      keys: number,
      matchOneIn: number,
    ) => Array<Row> = (
      random: SeededRandom,
      size: number,
      keys: number,
      matchOneIn: number,
    ): Array<Row> => {
      return Array.from({ length: size }, (_unused: unknown, index: number) => {
        return {
          key: 1 + random(keys),
          second: random(3),
          // Zero padded, so text order is number order.
          _id: `row-${String(index).padStart(5, "0")}`,
          matches: random(matchOneIn) === 0,
        };
      });
    };

    const SORTINGS: Array<[string, Sorting]> = [
      ["newest first", { key: SortOrder.Descending }],
      ["oldest first", { key: SortOrder.Ascending }],
      [
        "newest first, then a second key ascending",
        { key: SortOrder.Descending, second: SortOrder.Ascending },
      ],
      [
        "oldest first, then a second key descending",
        { key: SortOrder.Ascending, second: SortOrder.Descending },
      ],
    ];

    test.each(SORTINGS)(
      "%s: every page of every size, from every offset, is the unbounded page",
      (_label: string, sorting: Sorting) => {
        const random: SeededRandom = seededRandom(4710);
        let pagesCompared: number = 0;

        for (const [size, keys, matchOneIn] of [
          [40, 4, 1], // four big tie groups, every row matches
          [60, 30, 2], // small tie groups, half the rows match
          [80, 8, 7], // a sparse filter
          [30, 1, 1], // one tie group holds every row
          [25, 25, 1], // no ties at all
          [50, 10, 1000], // almost certainly no match at all
        ] as Array<[number, number, number]>) {
          const rows: Array<Row> = dataset(random, size, keys, matchOneIn);

          for (const limit of [1, 2, 3, 5, 7, 13, 50]) {
            for (let skip: number = 0; skip <= size + limit; skip++) {
              expect([size, keys, limit, skip, boundedPage(rows, sorting, skip, limit, random)]).toEqual([
                size,
                keys,
                limit,
                skip,
                unboundedPage(rows, sorting, skip, limit),
              ]);
              pagesCompared++;
            }
          }
        }

        expect(pagesCompared).toBeGreaterThan(1500);
      },
    );

    test.each(SORTINGS)(
      "%s: paging through the whole result returns every matching row exactly once",
      (_label: string, sorting: Sorting) => {
        const random: SeededRandom = seededRandom(14710);

        for (let round: number = 0; round < 20; round++) {
          const rows: Array<Row> = dataset(random, 120, 1 + random(12), 1 + random(4));
          const limit: number = 1 + random(17);
          const seen: Array<string> = [];

          for (let skip: number = 0; ; skip += limit) {
            const page: Array<string> = boundedPage(rows, sorting, skip, limit, random);

            if (page.length === 0) {
              break;
            }

            seen.push(...page);
          }

          expect(seen).toStrictEqual(unboundedPage(rows, sorting, 0, rows.length));
        }
      },
    );

    /*
     * Ties straddling a page boundary: the rows tied with the page's first
     * value that belong to earlier pages are skipped, and only those.
     */
    test("the offset is the number of earlier-page rows tied with the page's first value", () => {
      // Keys, newest first: 9 9 9 | 9 9 7 | 7 7 7 | 5
      const rows: Array<Row> = [9, 9, 9, 9, 9, 7, 7, 7, 7, 5].map(
        (key: number, index: number): Row => {
          return { key, second: 0, _id: `r${index}`, matches: true };
        },
      );
      const random: SeededRandom = seededRandom(1);
      const newestFirst: Sorting = { key: SortOrder.Descending };

      expect(pageBound(rows, newestFirst, 0, 3, random)).toStrictEqual({
        values: [9, 9, 9],
        offset: 0,
      });
      expect(pageBound(rows, newestFirst, 3, 3, random)).toStrictEqual({
        values: [9, 9, 7],
        offset: 3,
      });
      expect(pageBound(rows, newestFirst, 6, 3, random)).toStrictEqual({
        values: [7, 7, 7],
        offset: 1,
      });
      expect(pageBound(rows, newestFirst, 9, 3, random)).toStrictEqual({
        values: [5],
        offset: 0,
      });
    });

    test("a page past the last match has no values, so the wide read admits no row", () => {
      const rows: Array<Row> = [3, 2, 1].map((key: number, index: number): Row => {
        return { key, second: 0, _id: `r${index}`, matches: true };
      });

      expect(
        pageBound(rows, { key: SortOrder.Descending }, 3, 2, seededRandom(2)),
      ).toStrictEqual({ values: [], offset: 0 });
      expect(
        pageBound(rows, { key: SortOrder.Descending }, 10, 2, seededRandom(2)),
      ).toStrictEqual({ values: [], offset: 0 });
    });

    test("no match at all gives no values: the column default is never a value", () => {
      const rows: Array<Row> = [0, 0, 4].map((key: number, index: number): Row => {
        return { key, second: 0, _id: `r${index}`, matches: false };
      });

      // A real key equal to the type default (0 / 1970) changes nothing.
      expect(
        pageBound(rows, { key: SortOrder.Descending }, 0, 5, seededRandom(3)),
      ).toStrictEqual({ values: [], offset: 0 });
      expect(boundedPage(rows, { key: SortOrder.Ascending }, 0, 5, seededRandom(3))).toStrictEqual([]);
    });
  });

  /*
   * What the wide read touches, on a table laid out in key order in
   * granules: the unbounded find reads every granule of the range; the
   * range bound of before #4710 read every granule from min(top values)
   * to the newest; the page bound reads the granules holding the page's
   * values. Counted here on a model of the layout; the real-ClickHouse
   * suite counts the marks ClickHouse selects.
   */
  describe("what the wide read touches", () => {
    const GRANULE_ROWS: number = 8;

    interface Laid {
      key: number;
      matches: boolean;
      granule: number;
    }

    // 64 granules of 8 rows, one key value per row, oldest first on disk.
    const layout: (matches: (index: number) => boolean) => Array<Laid> = (
      matches: (index: number) => boolean,
    ): Array<Laid> => {
      return Array.from({ length: 64 * GRANULE_ROWS }, (_unused: unknown, index: number) => {
        return {
          key: index,
          matches: matches(index),
          granule: Math.floor(index / GRANULE_ROWS),
        };
      });
    };

    // The first skip + limit matching key values, newest first.
    const topValues: (rows: Array<Laid>, n: number) => Array<number> = (
      rows: Array<Laid>,
      n: number,
    ): Array<number> => {
      return rows
        .filter((row: Laid): boolean => {
          return row.matches;
        })
        .map((row: Laid): number => {
          return row.key;
        })
        .sort((left: number, right: number): number => {
          return right - left;
        })
        .slice(0, n);
    };

    const granulesWhere: (
      rows: Array<Laid>,
      admit: (row: Laid) => boolean,
    ) => number = (rows: Array<Laid>, admit: (row: Laid) => boolean): number => {
      return new Set(
        rows.filter(admit).map((row: Laid): number => {
          return row.granule;
        }),
      ).size;
    };

    // Before #4710: key >= min(top values) — and min() of nothing is 0.
    const rangeBoundGranules: (
      rows: Array<Laid>,
      skip: number,
      limit: number,
    ) => number = (rows: Array<Laid>, skip: number, limit: number): number => {
      const top: Array<number> = topValues(rows, skip + limit);
      const lowest: number = top.length === 0 ? 0 : Math.min(...top);

      return granulesWhere(rows, (row: Laid): boolean => {
        return row.key >= lowest;
      });
    };

    // Now: key IN the page's values.
    const pageBoundGranules: (
      rows: Array<Laid>,
      skip: number,
      limit: number,
    ) => number = (rows: Array<Laid>, skip: number, limit: number): number => {
      const values: Set<number> = new Set(
        topValues(rows, skip + limit).slice(skip),
      );

      return granulesWhere(rows, (row: Laid): boolean => {
        return values.has(row.key);
      });
    };

    const ALL_GRANULES: number = 64;

    test("no match: the range bound read every granule again, the page bound reads none", () => {
      const rows: Array<Laid> = layout((): boolean => {
        return false;
      });

      expect(rangeBoundGranules(rows, 0, 100)).toBe(ALL_GRANULES);
      expect(pageBoundGranules(rows, 0, 100)).toBe(0);
    });

    test("a few matches spread over the range: the page bound reads only the granules holding them", () => {
      // One match in every eighth granule.
      const rows: Array<Laid> = layout((index: number): boolean => {
        return index % (8 * GRANULE_ROWS) === 3;
      });

      expect(rangeBoundGranules(rows, 0, 100)).toBe(ALL_GRANULES);
      expect(pageBoundGranules(rows, 0, 100)).toBe(8);
    });

    test("a page past the last match: the page bound reads no granule", () => {
      const rows: Array<Laid> = layout((index: number): boolean => {
        return index % 50 === 0;
      });

      expect(rangeBoundGranules(rows, 1000, 100)).toBeGreaterThan(ALL_GRANULES / 2);
      expect(pageBoundGranules(rows, 1000, 100)).toBe(0);
    });

    test("a deep page of a moderately sparse filter: the page bound reads the page's granules, not the pages before it", () => {
      // One match in every second granule; page 4 of 5 rows each.
      const rows: Array<Laid> = layout((index: number): boolean => {
        return index % (2 * GRANULE_ROWS) === 0;
      });

      expect(rangeBoundGranules(rows, 15, 5)).toBe(40);
      expect(pageBoundGranules(rows, 15, 5)).toBe(5);
    });

    test("every row matches: both read the newest granules only — the saving the bound exists for", () => {
      const rows: Array<Laid> = layout((): boolean => {
        return true;
      });

      expect(rangeBoundGranules(rows, 0, 20)).toBe(3);
      expect(pageBoundGranules(rows, 0, 20)).toBe(3);
      expect(pageBoundGranules(rows, 40, 20)).toBe(3);
    });
  });
});
