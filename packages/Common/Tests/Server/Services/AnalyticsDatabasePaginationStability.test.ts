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
 * Pagination stability for analytics reads.
 *
 * `ORDER BY time DESC` is not a TOTAL order: rows that tie on `time` may be
 * returned in any order, and ClickHouse is free to order them differently
 * between two executions of the same query. Paging with LIMIT/OFFSET on top
 * of a partial order silently drops rows at page boundaries and repeats
 * others — a row sitting at offset 49 on page 1 can shift to offset 50
 * before page 2 is fetched, so it is never rendered.
 *
 * Ties are the normal case, not an edge case: a service emitting a burst of
 * logs writes many rows carrying an identical timestamp.
 *
 * The fix appends the unique, time-ordered `_id` as a final sort key.
 *
 * Two suites below:
 *  - "sort shape" pins the sort object the service hands to the generator.
 *  - "page boundary behaviour" simulates the engine's freedom to reorder
 *    ties and proves paging is lossless with the tiebreaker and lossy
 *    without it.
 */

const TIME_COLUMN: string = "time";
const BODY_COLUMN: string = "body";

class LogLikeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<log-like-table>",
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
          key: BODY_COLUMN,
          title: "<title>",
          description: "<description>",
          required: false,
          type: TableColumnType.Text,
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
 * Stands in for a derived aggregate target. `includeBaseColumns: false`
 * omits `_id` because the aggregation key IS the row identity there, so the
 * tiebreaker has nothing to append and must not invent a column.
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

describe("AnalyticsDatabaseService pagination stability", () => {
  describe("sort shape", () => {
    let service: AnalyticsDatabaseService<LogLikeModel>;
    let capturedSorts: Array<Record<string, SortOrder>>;

    beforeEach(() => {
      service = new AnalyticsDatabaseService({ modelType: LogLikeModel });
      capturedSorts = [];

      service.statementGenerator.toSelectStatement = jest.fn(() => {
        return { statement: SQL`<select>`, columns: ["<column>"] };
      });
      service.statementGenerator.toWhereStatement = jest.fn(() => {
        return SQL`<where>`;
      });
      service.statementGenerator.toGroupByStatement = jest.fn(() => {
        return SQL`<group-by>`;
      });
      service.statementGenerator.toSortStatement = jest.fn(
        (sort: unknown): Statement => {
          capturedSorts.push({ ...(sort as Record<string, SortOrder>) });
          return SQL`<sort>`;
        },
      ) as never;

      jest.spyOn(logger, "debug").mockImplementation(() => {
        return undefined!;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    type FindArgs = {
      sort: GenericObject;
      groupBy?: GenericObject | undefined;
    };

    const runFind: (args: FindArgs) => void = (args: FindArgs): void => {
      service.toFindStatement({
        select: {} as GenericObject,
        query: {} as GenericObject,
        props: {} as GenericObject,
        sort: args.sort,
        groupBy: args.groupBy,
        limit: 50,
        skip: 0,
      } as never);
    };

    test("appends _id when the caller did not sort by it", () => {
      runFind({ sort: { [TIME_COLUMN]: SortOrder.Descending } });

      expect(capturedSorts[0]).toStrictEqual({
        [TIME_COLUMN]: SortOrder.Descending,
        _id: SortOrder.Descending,
      });
    });

    test("_id is the LAST key, so it only ever breaks ties", () => {
      runFind({ sort: { [TIME_COLUMN]: SortOrder.Descending } });

      expect(Object.keys(capturedSorts[0]!)).toStrictEqual([
        TIME_COLUMN,
        "_id",
      ]);
    });

    test("tiebreaker direction follows a descending sort", () => {
      runFind({ sort: { [TIME_COLUMN]: SortOrder.Descending } });

      expect(capturedSorts[0]!["_id"]).toBe(SortOrder.Descending);
    });

    test("tiebreaker direction follows an ascending sort", () => {
      runFind({ sort: { [TIME_COLUMN]: SortOrder.Ascending } });

      expect(capturedSorts[0]!["_id"]).toBe(SortOrder.Ascending);
    });

    test("follows the LAST key when several columns are sorted", () => {
      runFind({
        sort: {
          [TIME_COLUMN]: SortOrder.Descending,
          [BODY_COLUMN]: SortOrder.Ascending,
        },
      });

      expect(Object.keys(capturedSorts[0]!)).toStrictEqual([
        TIME_COLUMN,
        BODY_COLUMN,
        "_id",
      ]);
      expect(capturedSorts[0]!["_id"]).toBe(SortOrder.Ascending);
    });

    test("does not append a second _id when already sorted by it", () => {
      runFind({ sort: { _id: SortOrder.Ascending } });

      expect(capturedSorts[0]).toStrictEqual({ _id: SortOrder.Ascending });
    });

    test("keeps a caller's _id in its original position and direction", () => {
      runFind({
        sort: {
          _id: SortOrder.Descending,
          [TIME_COLUMN]: SortOrder.Ascending,
        },
      });

      expect(Object.keys(capturedSorts[0]!)).toStrictEqual([
        "_id",
        TIME_COLUMN,
      ]);
      expect(capturedSorts[0]!["_id"]).toBe(SortOrder.Descending);
    });

    /*
     * Under GROUP BY, `_id` is neither a grouping key nor an aggregate, so
     * referencing it is an error rather than a tiebreak.
     */
    test("does not append _id to a GROUP BY query", () => {
      runFind({
        sort: { [TIME_COLUMN]: SortOrder.Descending },
        groupBy: { [TIME_COLUMN]: true },
      });

      expect(capturedSorts[0]).toStrictEqual({
        [TIME_COLUMN]: SortOrder.Descending,
      });
    });

    test("falls back to descending when the sort is empty", () => {
      runFind({ sort: {} });

      expect(capturedSorts[0]).toStrictEqual({ _id: SortOrder.Descending });
    });

    test("does not mutate the caller's sort object", () => {
      const callerSort: GenericObject = {
        [TIME_COLUMN]: SortOrder.Descending,
      };

      runFind({ sort: callerSort });

      expect(callerSort).toStrictEqual({ [TIME_COLUMN]: SortOrder.Descending });
      expect(callerSort).not.toHaveProperty("_id");
    });

    test("a model without an _id column is left alone", () => {
      const noIdService: AnalyticsDatabaseService<NoIdModel> =
        new AnalyticsDatabaseService({ modelType: NoIdModel });

      const noIdSorts: Array<Record<string, SortOrder>> = [];

      noIdService.statementGenerator.toSelectStatement = jest.fn(() => {
        return { statement: SQL`<select>`, columns: ["<column>"] };
      });
      noIdService.statementGenerator.toWhereStatement = jest.fn(() => {
        return SQL`<where>`;
      });
      noIdService.statementGenerator.toSortStatement = jest.fn(
        (sort: unknown): Statement => {
          noIdSorts.push({ ...(sort as Record<string, SortOrder>) });
          return SQL`<sort>`;
        },
      ) as never;

      noIdService.toFindStatement({
        select: {} as GenericObject,
        query: {} as GenericObject,
        props: {} as GenericObject,
        sort: { [TIME_COLUMN]: SortOrder.Descending },
        limit: 50,
        skip: 0,
      } as never);

      expect(noIdSorts[0]).toStrictEqual({
        [TIME_COLUMN]: SortOrder.Descending,
      });
    });
  });

  describe("rendered SQL", () => {
    let service: AnalyticsDatabaseService<LogLikeModel>;

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

    /*
     * The sort-key boundary filter (toSortKeyBoundaryFilter) puts its own
     * `ORDER BY <key> LIMIT n` in a subquery inside the WHERE, so the
     * statement now carries two. The tiebreaker lives on the LAST one —
     * the outer sort that actually orders the page.
     */
    const outerOrderBy: (query: string) => string = (query: string): string => {
      return query
        .slice(query.lastIndexOf("ORDER BY "))
        .replace("ORDER BY ", "")
        .split(" LIMIT")[0]!;
    };

    /*
     * Resolves the rendered `{pN:Identifier}` terms of an ORDER BY back to
     * the column names they are bound to, so the assertions do not depend
     * on parameter numbering.
     */
    const orderByColumns: (statement: Statement) => Array<string> = (
      statement: Statement,
    ): Array<string> => {
      return outerOrderBy(statement.query)
        .split(", ")
        .map((term: string): string => {
          const param: string = term.split(":")[0]!.replace("{", "");
          return statement.query_params[param] as string;
        });
    };

    /*
     * The generator is NOT mocked here, so this asserts the real ORDER BY
     * text — the separator fix and the tiebreaker together.
     */
    test("emits a comma separated, _id terminated ORDER BY", () => {
      const { statement } = service.toFindStatement({
        select: {} as GenericObject,
        query: {} as GenericObject,
        props: {} as GenericObject,
        sort: { [TIME_COLUMN]: SortOrder.Descending },
        limit: 50,
        skip: 100,
      } as never);

      expect(outerOrderBy(statement.query)).toMatch(
        /^\{p\d+:Identifier\} DESC, \{p\d+:Identifier\} DESC$/,
      );
      expect(orderByColumns(statement)).toStrictEqual([TIME_COLUMN, "_id"]);
    });

    test("the ORDER BY ends with _id, immediately before LIMIT", () => {
      const { statement } = service.toFindStatement({
        select: {} as GenericObject,
        query: {} as GenericObject,
        props: {} as GenericObject,
        sort: { [TIME_COLUMN]: SortOrder.Descending },
        limit: 50,
        skip: 0,
      } as never);

      expect(orderByColumns(statement).pop()).toBe("_id");
    });
  });

  /*
   * The regression itself. These tests do not touch SQL text; they model
   * what the engine is ALLOWED to do with a partial order and check whether
   * paging survives it.
   */
  describe("page boundary behaviour", () => {
    interface Row {
      _id: string;
      time: number;
      body: string;
    }

    /*
     * Order rows the way an engine may for a given ORDER BY spec. Rows that
     * tie on every sort key fall back to `tieOrder` — standing in for the
     * arbitrary, between-query-unstable order the engine is free to return.
     */
    const orderRows: (
      rows: Array<Row>,
      sort: Record<string, SortOrder>,
      tieOrder: Array<string>,
    ) => Array<Row> = (
      rows: Array<Row>,
      sort: Record<string, SortOrder>,
      tieOrder: Array<string>,
    ): Array<Row> => {
      return [...rows].sort((a: Row, b: Row): number => {
        for (const key of Object.keys(sort)) {
          const left: string | number = (
            a as unknown as Record<string, string | number>
          )[key]!;
          const right: string | number = (
            b as unknown as Record<string, string | number>
          )[key]!;

          if (left !== right) {
            const ascending: number = left < right ? -1 : 1;
            return sort[key] === SortOrder.Ascending ? ascending : -ascending;
          }
        }

        return tieOrder.indexOf(a._id) - tieOrder.indexOf(b._id);
      });
    };

    const fetchPage: (
      rows: Array<Row>,
      sort: Record<string, SortOrder>,
      tieOrder: Array<string>,
      skip: number,
      limit: number,
    ) => Array<Row> = (
      rows: Array<Row>,
      sort: Record<string, SortOrder>,
      tieOrder: Array<string>,
      skip: number,
      limit: number,
    ): Array<Row> => {
      return orderRows(rows, sort, tieOrder).slice(skip, skip + limit);
    };

    /*
     * 12 rows across 3 timestamps, 4 rows tied on each — the shape a burst
     * of logs produces.
     */
    const buildRows: () => Array<Row> = (): Array<Row> => {
      const rows: Array<Row> = [];
      for (let bucket: number = 0; bucket < 3; bucket++) {
        for (let index: number = 0; index < 4; index++) {
          const ordinal: number = bucket * 4 + index;
          rows.push({
            // Zero padded so lexical order matches numeric order.
            _id: `id-${String(ordinal).padStart(2, "0")}`,
            time: 1000 - bucket,
            body: `Solver ${ordinal}% complete`,
          });
        }
      }
      return rows;
    };

    /*
     * Three different tie orders, one per page fetch, modelling the engine
     * returning ties differently for each of the three queries the UI runs.
     */
    const tieOrders: Array<Array<string>> = [
      buildRows().map((row: Row): string => {
        return row._id;
      }),
      [...buildRows()].reverse().map((row: Row): string => {
        return row._id;
      }),
      buildRows()
        .map((row: Row): string => {
          return row._id;
        })
        .sort(),
    ];

    /*
     * Page size 5 against tie groups of 4 is deliberate: the page boundaries
     * (offset 5 and 10) fall INSIDE a tie group. Aligning them with group
     * boundaries would hide the bug, because a reordering that stays within
     * one page is unobservable.
     */
    const pageThrough: (sort: Record<string, SortOrder>) => Array<string> = (
      sort: Record<string, SortOrder>,
    ): Array<string> => {
      const pageSize: number = 5;
      const rows: Array<Row> = buildRows();
      const seen: Array<string> = [];

      for (let page: number = 0; page < 3; page++) {
        const fetched: Array<Row> = fetchPage(
          rows,
          sort,
          tieOrders[page]!,
          page * pageSize,
          pageSize,
        );
        for (const row of fetched) {
          seen.push(row._id);
        }
      }

      return seen;
    };

    test("WITHOUT the tiebreaker, paging loses and repeats rows", () => {
      const seen: Array<string> = pageThrough({ time: SortOrder.Descending });
      const unique: Set<string> = new Set(seen);

      // Rows were fetched, but not the right ones.
      expect(seen).toHaveLength(12);
      expect(unique.size).toBeLessThan(12);
    });

    test("WITH the tiebreaker, every row is returned exactly once", () => {
      const seen: Array<string> = pageThrough({
        time: SortOrder.Descending,
        _id: SortOrder.Descending,
      });

      expect(seen).toHaveLength(12);
      expect(new Set(seen).size).toBe(12);
      expect([...seen].sort()).toStrictEqual(
        buildRows()
          .map((row: Row): string => {
            return row._id;
          })
          .sort(),
      );
    });

    test("WITH the tiebreaker, page contents do not depend on tie order", () => {
      const sort: Record<string, SortOrder> = {
        time: SortOrder.Descending,
        _id: SortOrder.Descending,
      };
      const rows: Array<Row> = buildRows();

      // Offset 3 / limit 5 straddles two tie groups.
      const underFirstTieOrder: Array<Row> = fetchPage(
        rows,
        sort,
        tieOrders[0]!,
        3,
        5,
      );
      const underSecondTieOrder: Array<Row> = fetchPage(
        rows,
        sort,
        tieOrders[1]!,
        3,
        5,
      );

      expect(underFirstTieOrder).toStrictEqual(underSecondTieOrder);
    });

    test("WITH the tiebreaker, ordering is fully deterministic", () => {
      const sort: Record<string, SortOrder> = {
        time: SortOrder.Descending,
        _id: SortOrder.Descending,
      };
      const rows: Array<Row> = buildRows();

      const ordered: Array<string> = orderRows(rows, sort, tieOrders[0]!).map(
        (row: Row): string => {
          return row._id;
        },
      );

      /*
       * `time` is 1000 - bucket, so bucket 0 (ids 00-03) is newest and comes
       * first under DESC; within each tied bucket, _id descends.
       */
      expect(ordered).toStrictEqual([
        "id-03",
        "id-02",
        "id-01",
        "id-00",
        "id-07",
        "id-06",
        "id-05",
        "id-04",
        "id-11",
        "id-10",
        "id-09",
        "id-08",
      ]);
    });

    test("an ascending tiebreaker is equally stable", () => {
      const seen: Array<string> = pageThrough({
        time: SortOrder.Ascending,
        _id: SortOrder.Ascending,
      });

      expect(new Set(seen).size).toBe(12);
    });
  });
});
