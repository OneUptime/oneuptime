import SecurityEventService, {
  DetectionMatchGroup,
  FindDetectionMatchesData,
} from "../../../Server/Services/SecurityEventService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { getQuerySettings } from "../../../Server/Utils/AnalyticsDatabase/QuerySettingsHelper";
import {
  SQL,
  Statement,
} from "../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The SQL contract of SecurityEventService.findDetectionMatches — the one
 * query the detection engine runs per due rule (issue #3398 added the
 * distinct-count semantics).
 *
 * Everything asserted here is invisible from the TypeScript call site and
 * only observable as query text / bound params, so this file pins the
 * rendered Statement:
 *
 *   - a rule WITHOUT a distinct-count field selects a constant
 *     `0 AS distinctCount` (never an aggregate), gets NO HAVING clause at
 *     threshold 1, and orders by matchCount;
 *   - a raw-count threshold > 1 becomes `HAVING matchCount >= {bound}`;
 *   - a distinct-count rule counts `uniqExact(nullIf(<expr>, ''))` — empty
 *     values excluded — thresholds and orders on distinctCount, and gets
 *     the HAVING clause EVEN at threshold 1, because a group whose matches
 *     all lack the counted field has distinctCount 0 and must not fire;
 *   - the threshold is clamped to >= 1 before it is bound;
 *   - projectId / time-window predicates and the maxGroups LIMIT stay
 *     bound parameters, whatever the threshold shape;
 *   - result rows map distinctCount (default 0 when the column is absent)
 *     without disturbing the existing field mapping;
 *   - a window of a rule that counts in real time (`arrival`) reads the
 *     window as one write found it - ids no later than its last - and
 *     keeps a group only when the write brought it to the threshold.
 *
 * Every service boundary is stubbed: executeQuery captures the Statement,
 * and the database handle only supplies the schema name. No ClickHouse.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const START_TIME: Date = new Date("2026-08-25T10:00:00.000Z");
const END_TIME: Date = new Date("2026-08-25T10:05:00.000Z");
const DATABASE_NAME: string = "oneuptime";
const MAX_GROUPS: number = 50;

// The trailing SETTINGS clause is shared verbatim by every variant below.
const SETTINGS_SUFFIX: string = getQuerySettings({
  maxExecutionTimeInSeconds: 60,
});

/*
 * Captures the Statement handed to executeQuery, returning canned rows.
 * `rows: undefined` simulates a response body with no `data` key at all.
 */
function stubExecuteQuery(rows?: Array<JSONObject>): Spy {
  getJestSpyOn(
    SecurityEventService.database,
    "getDatasourceOptions",
  ).mockReturnValue({ database: DATABASE_NAME } as never);

  const fakeResult: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve(rows === undefined ? {} : { data: rows });
    },
  } as unknown as Results;

  return getJestSpyOn(SecurityEventService, "executeQuery").mockResolvedValue(
    fakeResult as never,
  );
}

/*
 * Fragments the way SigmaClickhouseCompiler hands them over: every
 * rule-controlled value is a bound parameter, field references are bound
 * Identifiers.
 */
function buildWhereFragment(): Statement {
  return SQL`statusName = ${{
    type: TableColumnType.Text,
    value: "Failure",
  }}`;
}

function buildFieldExpression(field: string): Statement {
  return SQL`${field}`;
}

async function callFindDetectionMatches(
  overrides: Partial<FindDetectionMatchesData> = {},
): Promise<Array<DetectionMatchGroup>> {
  return SecurityEventService.findDetectionMatches({
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    whereFragment: buildWhereFragment(),
    groupByExpression: null,
    distinctCountExpression: null,
    minMatchCount: 1,
    maxGroups: MAX_GROUPS,
    ...overrides,
  });
}

function capturedStatement(spy: Spy): Statement {
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0]![0] as Statement;
}

describe("SecurityEventService.findDetectionMatches — SQL contract", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("no distinct-count expression, threshold 1 (the pre-#3398 shape)", () => {
    test("selects a constant 0 distinctCount, emits no HAVING, and orders by matchCount", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches();

      const statement: Statement = capturedStatement(spy);

      /*
       * Full-text equality: this is the exact query every existing rule
       * (threshold 1, no distinct field) runs, so nothing about it may
       * drift as a side effect of the new parameters.
       */
      expect(statement.query).toBe(
        "SELECT '' AS groupValue, count() AS matchCount, 0 AS distinctCount, " +
          "any(message) AS sampleMessage, " +
          "arrayDistinct(arrayFlatten(groupArray(20)(observables))) AS sampleObservables " +
          `FROM ${DATABASE_NAME}.SecurityEventItemV1 ` +
          "WHERE projectId = {p0:String} AND time >= {p1:DateTime64(9)} AND time < {p2:DateTime64(9)} " +
          "AND (statusName = {p3:String}) " +
          "GROUP BY groupValue ORDER BY matchCount DESC LIMIT {p4:Int32}" +
          SETTINGS_SUFFIX,
      );

      expect(statement.query).not.toContain("HAVING");
      expect(statement.query).not.toContain("uniqExact");

      expect(statement.query_params).toStrictEqual({
        p0: PROJECT_ID.toString(),
        p1: OneUptimeDate.toClickhouseDateTime64(START_TIME),
        p2: OneUptimeDate.toClickhouseDateTime64(END_TIME),
        p3: "Failure",
        p4: MAX_GROUPS,
      });
    });
  });

  describe("raw match-count threshold above 1", () => {
    test("threshold 5 becomes HAVING matchCount >= a bound param and every other binding survives the renumbering", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({ minMatchCount: 5 });

      const statement: Statement = capturedStatement(spy);

      expect(statement.query).toContain(
        "GROUP BY groupValue HAVING matchCount >= {p4:Int32} ORDER BY matchCount DESC LIMIT {p5:Int32}",
      );
      // The threshold thresholds the RAW count — never the constant 0.
      expect(statement.query).not.toContain("distinctCount >=");
      expect(statement.query).not.toContain("ORDER BY distinctCount");

      /*
       * HAVING is appended mid-statement, which renumbers the params after
       * it — the tenant/time/limit bindings must survive that renumbering
       * with their values intact.
       */
      expect(statement.query).toContain(
        "WHERE projectId = {p0:String} AND time >= {p1:DateTime64(9)} AND time < {p2:DateTime64(9)} AND (statusName = {p3:String})",
      );

      expect(statement.query_params).toStrictEqual({
        p0: PROJECT_ID.toString(),
        p1: OneUptimeDate.toClickhouseDateTime64(START_TIME),
        p2: OneUptimeDate.toClickhouseDateTime64(END_TIME),
        p3: "Failure",
        p4: 5,
        p5: MAX_GROUPS,
      });
    });
  });

  describe("distinct-count expression", () => {
    test("aggregates uniqExact(nullIf(expr, '')) and gets HAVING distinctCount EVEN at threshold 1", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({
        distinctCountExpression: buildFieldExpression("targetUser"),
        minMatchCount: 1,
      });

      const statement: Statement = capturedStatement(spy);

      /*
       * nullIf(expr, '') keeps empty values out of the distinct count —
       * "5 distinct usernames" must never count rows carrying no
       * username. And the HAVING clause exists at threshold 1 because a
       * group whose matches all lack the field has distinctCount 0.
       */
      expect(statement.query).toContain(
        "count() AS matchCount, uniqExact(nullIf({p0:Identifier}, '')) AS distinctCount",
      );
      expect(statement.query).toContain(
        "GROUP BY groupValue HAVING distinctCount >= {p5:Int32} ORDER BY distinctCount DESC LIMIT {p6:Int32}",
      );
      expect(statement.query).not.toContain("matchCount >=");

      expect(statement.query_params["p0"]).toBe("targetUser");
      expect(statement.query_params["p5"]).toBe(1);
      expect(statement.query_params["p6"]).toBe(MAX_GROUPS);
    });

    test("group-by and distinct expressions bind as separate identifiers, threshold on distinctCount", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({
        groupByExpression: buildFieldExpression("principalUser"),
        distinctCountExpression: buildFieldExpression("targetUser"),
        minMatchCount: 3,
      });

      const statement: Statement = capturedStatement(spy);

      expect(statement.query).toContain(
        "SELECT {p0:Identifier} AS groupValue, count() AS matchCount, uniqExact(nullIf({p1:Identifier}, '')) AS distinctCount",
      );
      expect(statement.query).toContain(
        "HAVING distinctCount >= {p6:Int32} ORDER BY distinctCount DESC LIMIT {p7:Int32}",
      );

      expect(statement.query_params["p0"]).toBe("principalUser");
      expect(statement.query_params["p1"]).toBe("targetUser");
      expect(statement.query_params["p6"]).toBe(3);
      expect(statement.query_params["p7"]).toBe(MAX_GROUPS);
    });
  });

  describe("threshold clamping", () => {
    test("minMatchCount 0 clamps to 1 — no HAVING on a raw-count rule", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({ minMatchCount: 0 });

      const statement: Statement = capturedStatement(spy);

      /*
       * Clamped-to-1 raw-count rules keep the HAVING-free shape: emitting
       * `HAVING matchCount >= 1` would be harmless but is pinned away so
       * the pre-#3398 query stays byte-identical for existing rules.
       */
      expect(statement.query).not.toContain("HAVING");
      expect(statement.query).toContain("ORDER BY matchCount DESC");
      expect(statement.query_params["p4"]).toBe(MAX_GROUPS);
    });

    test("a negative minMatchCount binds 1, not the negative value, on a distinct-count rule", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({
        distinctCountExpression: buildFieldExpression("principalIp"),
        minMatchCount: -5,
      });

      const statement: Statement = capturedStatement(spy);

      expect(statement.query).toContain("HAVING distinctCount >= {p5:Int32}");
      expect(statement.query_params["p5"]).toBe(1);
      // The clamp must never leak a value <= 0 into any bound param.
      expect(Object.values(statement.query_params)).not.toContain(-5);
    });
  });

  describe("a window of a rule that counts in real time, as one write found it", () => {
    const ARRIVAL: NonNullable<FindDetectionMatchesData["arrival"]> = {
      candidateIds: [
        "019a4f00-0001-7000-8000-000000000001",
        "019a4f00-0002-7000-8000-000000000002",
      ],
      firstId: "019a4f00-0001-7000-8000-000000000001",
      lastId: "019a4f00-0002-7000-8000-000000000002",
      candidateStartTime: new Date("2026-08-25T10:00:59.000Z"),
      candidateEndTime: new Date("2026-08-25T10:03:11.000Z"),
    };

    test("counts what had come in before the write beside the window, and keeps a group the write brought to the threshold", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({ minMatchCount: 5, arrival: ARRIVAL });

      const statement: Statement = capturedStatement(spy);

      expect(statement.query).toBe(
        "SELECT '' AS groupValue, count() AS matchCount, 0 AS distinctCount, " +
          "countIf(_id < {p0:String}) AS matchCountBefore, 0 AS distinctCountBefore, " +
          "countIf(has({p1:Array(String)}, _id)) AS candidateMatches, " +
          "any(message) AS sampleMessage, " +
          "arrayDistinct(arrayFlatten(groupArray(20)(observables))) AS sampleObservables " +
          `FROM ${DATABASE_NAME}.SecurityEventItemV1 ` +
          "WHERE projectId = {p2:String} AND time >= {p3:DateTime64(9)} AND time < {p4:DateTime64(9)} " +
          "AND (statusName = {p5:String}) AND _id <= {p6:String} " +
          "GROUP BY groupValue HAVING candidateMatches > 0 AND matchCount >= {p7:Int32} AND matchCountBefore < {p8:Int32} " +
          "ORDER BY matchCount DESC LIMIT {p9:Int32}" +
          SETTINGS_SUFFIX,
      );
      expect(statement.query_params).toStrictEqual({
        p0: ARRIVAL.firstId,
        p1: ARRIVAL.candidateIds,
        p2: PROJECT_ID.toString(),
        p3: OneUptimeDate.toClickhouseDateTime64(START_TIME),
        p4: OneUptimeDate.toClickhouseDateTime64(END_TIME),
        p5: "Failure",
        p6: ARRIVAL.lastId,
        p7: 5,
        p8: 5,
        p9: MAX_GROUPS,
      });
    });

    test("a distinct count counts the values that had come in before, and thresholds on them", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({
        distinctCountExpression: buildFieldExpression("targetUser"),
        minMatchCount: 3,
        arrival: ARRIVAL,
      });

      const statement: Statement = capturedStatement(spy);

      expect(statement.query).toContain(
        "uniqExact(nullIf({p0:Identifier}, '')) AS distinctCount, countIf(_id < {p1:String}) AS matchCountBefore, uniqExactIf(nullIf({p2:Identifier}, ''), _id < {p3:String}) AS distinctCountBefore",
      );
      expect(statement.query).toContain(
        "HAVING candidateMatches > 0 AND distinctCount >= {p10:Int32} AND distinctCountBefore < {p11:Int32}",
      );
      expect(statement.query_params["p10"]).toBe(3);
      expect(statement.query_params["p11"]).toBe(3);
    });

    test("only the groups the write's events name, read where they happened", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({
        groupByExpression: buildFieldExpression("principalIp"),
        minMatchCount: 5,
        arrival: ARRIVAL,
      });

      const statement: Statement = capturedStatement(spy);

      expect(statement.query).toContain(
        "AND _id <= {p7:String} AND {p8:Identifier} IN (SELECT {p9:Identifier} " +
          `FROM ${DATABASE_NAME}.SecurityEventItemV1 ` +
          "WHERE projectId = {p10:String} AND time >= {p11:DateTime64(9)} AND time < {p12:DateTime64(9)} AND has({p13:Array(String)}, _id)) GROUP BY groupValue",
      );
      expect(statement.query_params["p10"]).toBe(PROJECT_ID.toString());
      expect(statement.query_params["p11"]).toBe(
        OneUptimeDate.toClickhouseDateTime64(ARRIVAL.candidateStartTime),
      );
      expect(statement.query_params["p12"]).toBe(
        OneUptimeDate.toClickhouseDateTime64(ARRIVAL.candidateEndTime),
      );
      expect(statement.query_params["p13"]).toEqual(ARRIVAL.candidateIds);
    });

    test("a rule at threshold 1 still waits for the write to bring it there", async () => {
      const spy: Spy = stubExecuteQuery([]);

      await callFindDetectionMatches({ minMatchCount: 1, arrival: ARRIVAL });

      expect(capturedStatement(spy).query).toContain(
        "HAVING candidateMatches > 0 AND matchCount >= {p7:Int32} AND matchCountBefore < {p8:Int32}",
      );
    });
  });

  describe("row mapping", () => {
    test("maps every column, parsing ClickHouse's stringly counts", async () => {
      /*
       * ClickHouse's JSON format renders UInt64 aggregates as strings —
       * matchCount and distinctCount must come back as numbers anyway.
       */
      stubExecuteQuery([
        {
          groupValue: "alice",
          matchCount: "7",
          distinctCount: "3",
          sampleMessage: "failed login for alice",
          sampleObservables: ["alice", "10.0.0.9"],
        },
      ]);

      const groups: Array<DetectionMatchGroup> = await callFindDetectionMatches(
        {
          distinctCountExpression: buildFieldExpression("targetUser"),
        },
      );

      expect(groups).toStrictEqual([
        {
          groupValue: "alice",
          matchCount: 7,
          distinctCount: 3,
          sampleMessage: "failed login for alice",
          sampleObservables: ["alice", "10.0.0.9"],
        },
      ]);
    });

    test("distinctCount defaults to 0 when the column is missing or null", async () => {
      stubExecuteQuery([
        {
          // A row from before the column existed — no distinctCount key.
          groupValue: "bob",
          matchCount: 2,
          sampleMessage: "m",
          sampleObservables: [],
        },
        {
          groupValue: "eve",
          matchCount: 4,
          distinctCount: null,
          sampleMessage: "n",
          sampleObservables: [],
        },
      ]);

      const groups: Array<DetectionMatchGroup> =
        await callFindDetectionMatches();

      expect(groups[0]!.distinctCount).toBe(0);
      expect(groups[1]!.distinctCount).toBe(0);
      // ...without disturbing the fields that were there.
      expect(groups[0]!.matchCount).toBe(2);
      expect(groups[1]!.matchCount).toBe(4);
    });

    test("degenerate rows fall back field-by-field instead of throwing", async () => {
      stubExecuteQuery([
        {
          sampleObservables: "not-an-array",
        },
      ]);

      const groups: Array<DetectionMatchGroup> =
        await callFindDetectionMatches();

      expect(groups).toStrictEqual([
        {
          groupValue: "",
          matchCount: 0,
          distinctCount: 0,
          sampleMessage: "",
          sampleObservables: [],
        },
      ]);
    });

    test("a response with no data key maps to an empty group list", async () => {
      stubExecuteQuery(undefined);

      const groups: Array<DetectionMatchGroup> =
        await callFindDetectionMatches();

      expect(groups).toStrictEqual([]);
    });
  });
});
