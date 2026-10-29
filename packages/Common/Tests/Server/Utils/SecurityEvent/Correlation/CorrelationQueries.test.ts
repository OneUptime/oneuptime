import CorrelationQueries, {
  CORRELATION_ROLLING_STEPS_PER_TIMESPAN,
  CORRELATION_STEP_TIMES_LIMIT,
  CorrelationReadWindow,
  CorrelationRollingWindow,
  buildGroupExpression,
  compileStepCondition,
  getCorrelationRollingWindow,
} from "../../../../../Server/Utils/SecurityEvent/Correlation/CorrelationQueries";
import {
  SQL,
  Statement,
} from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../../../../Types/ObjectID";
import {
  DetectionRuleDefinition,
  SigmaCorrelationStep,
} from "../../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { bindSigmaWatchlists } from "../../../../../Utils/SecurityEvent/Sigma/SigmaWatchlists";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import { SigmaWatchlist } from "../../../../../Types/SecurityEvent/SecurityWatchlist";
import { getJestSpyOn } from "../../../../Spy";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The statements behind correlation rules, pinned as text and bound
 * values: every read is one project's (the project the first condition),
 * every value a rule holds is a bound parameter, and each type reads what
 * the engine needs - a rolling window per group for counts, the latest
 * times per step for sequences, and this run's new (group, value) pairs
 * against the history of the same groups. The real-server suite
 * (App Tests/Telemetry/SecurityCorrelationRulesClickhouse) runs them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const FAILED: string = `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

const SUCCEEDED: string = `title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

function correlation(
  yaml: string,
): Extract<DetectionRuleDefinition, { kind: "correlation" }> {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);

  if (definition.kind !== "correlation") {
    throw new Error("expected a correlation");
  }

  return definition;
}

const WINDOW: CorrelationReadWindow = {
  projectId: PROJECT_ID,
  readFrom: new Date("2026-10-21T09:50:00.000Z"),
  startTime: new Date("2026-10-21T10:00:00.000Z"),
  endTime: new Date("2026-10-21T10:05:00.000Z"),
};

function boundValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("getCorrelationRollingWindow", () => {
  test("steps of a sixtieth of the timespan, a second at the finest", () => {
    const tenMinutes: CorrelationRollingWindow = getCorrelationRollingWindow({
      timespanInSeconds: 600,
      startTime: new Date("2026-10-21T10:00:00.000Z"),
    });

    expect(tenMinutes.bucketSeconds).toBe(
      600 / CORRELATION_ROLLING_STEPS_PER_TIMESPAN,
    );
    expect(tenMinutes.precedingBuckets).toBe(59);
    expect(tenMinutes.startBucket).toBe(
      Math.floor(Date.parse("2026-10-21T10:00:00.000Z") / 1000 / 10),
    );
    // The read starts a whole timespan of steps before the run's first step.
    expect(tenMinutes.readFrom.toISOString()).toBe("2026-10-21T09:50:10.000Z");

    const thirtySeconds: CorrelationRollingWindow = getCorrelationRollingWindow(
      {
        timespanInSeconds: 30,
        startTime: new Date("2026-10-21T10:00:07.500Z"),
      },
    );

    expect(thirtySeconds.bucketSeconds).toBe(1);
    expect(thirtySeconds.precedingBuckets).toBe(29);
    expect(thirtySeconds.readFrom.toISOString()).toBe(
      "2026-10-21T09:59:38.000Z",
    );
  });

  test("a timespan that is not a whole number of steps is rounded up to whole steps", () => {
    const window: CorrelationRollingWindow = getCorrelationRollingWindow({
      timespanInSeconds: 125,
      startTime: new Date("2026-10-21T10:00:00.000Z"),
    });

    expect(window.bucketSeconds).toBe(2);
    expect(window.precedingBuckets).toBe(62);
  });
});

describe("CorrelationQueries.buildCountStatement", () => {
  const eventCount: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
    correlation(`title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 10m
  condition:
    gte: 10
---
${FAILED}`);

  test("counts a rolling window per group, one project's, with every value bound", () => {
    const statement: Statement = CorrelationQueries.buildCountStatement({
      window: WINDOW,
      correlation: eventCount.correlation,
      steps: eventCount.steps,
      countDistinct: false,
      tableName: "oneuptime.SecurityEvent",
      limit: 101,
    });

    const query: string = statement.query;

    expect(query).toContain("intDiv(toUnixTimestamp(time), 10) AS __b");
    expect(query).toContain(
      "OVER (PARTITION BY __g0 ORDER BY __b ASC RANGE BETWEEN 59 PRECEDING AND CURRENT ROW) AS __rolling",
    );
    expect(query).toContain("toString(principalIp) AS __g0");
    expect(query).toContain(
      `WHERE __b >= ${Math.floor(WINDOW.startTime.getTime() / 10000)}`,
    );
    expect(query).toContain(
      "HAVING __g0 != '' AND eventsInRun > 0 AND matchCount >= ",
    );
    expect(query).toContain("ORDER BY matchCount DESC LIMIT ");
    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(query).not.toContain("Authentication");
    expect(query).not.toContain(PROJECT_ID.toString());

    const values: Array<unknown> = boundValues(statement);

    expect(values).toContain(PROJECT_ID.toString());
    expect(values).toContain("authentication");
    expect(values).toContain("failure");
    expect(values).toContain(10);
    expect(values).toContain(101);
    // The project is the first condition of the read.
    expect(query.indexOf("projectId = {p")).toBeLessThan(
      query.indexOf("lowerUTF8"),
    );
  });

  test("value_count counts different values, rolling, empty values left out", () => {
    const valueCount: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Spraying
correlation:
  type: value_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 10m
  condition:
    field: principalUser
    gte: 5
---
${FAILED}`);

    const query: string = CorrelationQueries.buildCountStatement({
      window: WINDOW,
      correlation: valueCount.correlation,
      steps: valueCount.steps,
      countDistinct: true,
      tableName: "oneuptime.SecurityEvent",
      limit: 10,
    }).query;

    expect(query).toContain(
      "uniqExactStateIf(toString(ifNull(principalUser, '')), toString(ifNull(principalUser, '')) != '') AS __s",
    );
    expect(query).toContain("uniqExactMerge(__s) OVER");
    expect(query).toContain("max(__rollingDistinct) AS distinctCount");
    expect(query).toContain("distinctCount >= ");
    expect(query).toContain("ORDER BY distinctCount DESC");
  });

  test("several value fields count their combinations", () => {
    const valueCount: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Spraying
correlation:
  type: value_count
  rules: [failed_sign_in]
  timespan: 10m
  condition:
    field: [principalUser, targetHost]
    gte: 5
---
${FAILED}`);

    const query: string = CorrelationQueries.buildCountStatement({
      window: WINDOW,
      correlation: valueCount.correlation,
      steps: valueCount.steps,
      countDistinct: true,
      tableName: "oneuptime.SecurityEvent",
      limit: 10,
    }).query;

    expect(query).toContain(
      "uniqExactStateIf(tuple(toString(ifNull(principalUser, '')), toString(ifNull(targetHost, ''))), toString(ifNull(principalUser, '')) != '' AND toString(ifNull(targetHost, '')) != '')",
    );
  });

  test("without group-by everything is one group, and a run with no events never fires", () => {
    const global: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
      correlation(`title: Fewer than five
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 10m
  condition:
    lt: 5
---
${FAILED}`);

    const query: string = CorrelationQueries.buildCountStatement({
      window: WINDOW,
      correlation: global.correlation,
      steps: global.steps,
      countDistinct: false,
      tableName: "oneuptime.SecurityEvent",
      limit: 10,
    }).query;

    expect(query).not.toContain("GROUP BY __g0");
    expect(query).toContain(
      "OVER (ORDER BY __b ASC RANGE BETWEEN 59 PRECEDING AND CURRENT ROW)",
    );
    expect(query).toContain("HAVING eventsInRun > 0 AND matchCount < ");
  });

  test("a range condition is every comparison, ANDed", () => {
    const range: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
      correlation(`title: Range
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 10m
  condition:
    gt: 100
    lte: 200
---
${FAILED}`);

    const query: string = CorrelationQueries.buildCountStatement({
      window: WINDOW,
      correlation: range.correlation,
      steps: range.steps,
      countDistinct: false,
      tableName: "oneuptime.SecurityEvent",
      limit: 10,
    }).query;

    expect(query).toMatch(
      /matchCount > \{p\d+:Int32\} AND matchCount <= \{p\d+:Int32\}/,
    );
  });

  test("a setup test's restriction is ANDed into the read", () => {
    const query: string = CorrelationQueries.buildCountStatement({
      window: {
        ...WINDOW,
        restrictTo: SQL`principalIp = ${{
          type: TableColumnType.Text,
          value: "203.0.113.77",
        }}`,
      },
      correlation: eventCount.correlation,
      steps: eventCount.steps,
      countDistinct: false,
      tableName: "oneuptime.SecurityEvent",
      limit: 10,
    }).query;

    expect(query).toMatch(/AND \(principalIp = \{p\d+:String\}\)/);
  });
});

describe("CorrelationQueries.buildTemporalStatement", () => {
  const sequence: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
    correlation(`title: Failures then success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m
---
${FAILED}
---
${SUCCEEDED}`);

  test("reads each step's count and latest times for the groups that can match", () => {
    const query: string = CorrelationQueries.buildTemporalStatement({
      window: WINDOW,
      correlation: sequence.correlation,
      steps: sequence.steps,
      stepMinimums: [5, 1],
      minimumSteps: 2,
      tableName: "oneuptime.SecurityEvent",
      limit: 2000,
    }).query;

    expect(query).toContain(") AS __n0, ");
    expect(query).toContain(") AS __n1, ");
    expect(query).toContain(
      `groupArraySortedIf(${CORRELATION_STEP_TIMES_LIMIT})(0 - toUnixTimestamp64Milli(time), `,
    );
    expect(query).toContain(") AS __t0, ");
    expect(query).toContain(") AS __t1, ");
    expect(query).toContain("GROUP BY __g0");
    expect(query).toMatch(
      /HAVING __g0 != '' AND lastMatchAt >= \{p\d+:DateTime64\(9\)\} AND \(\(__n0 >= \{p\d+:Int32\}\) \+ \(__n1 >= \{p\d+:Int32\}\)\) >= \{p\d+:Int32\}/,
    );
    expect(query).toContain("ORDER BY lastMatchAt DESC LIMIT ");
  });

  test("an aliased group-by takes the field of the step each event matched", () => {
    const aliased: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
      correlation(`title: Aliased
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in]
  group-by: [address]
  timespan: 5m
  aliases:
    address:
      failed_sign_in: principalIp
      successful_sign_in: targetIp
---
${FAILED}
---
${SUCCEEDED}`);

    const conditions: Array<Statement> =
      aliased.steps.map(compileStepCondition);

    const expression: string = buildGroupExpression({
      field: "address",
      correlation: aliased.correlation,
      steps: aliased.steps,
      stepConditions: conditions,
    }).query;

    expect(expression).toMatch(/^multiIf\(\(\(/);
    expect(expression).toContain("principalIp, ");
    expect(expression).toContain("targetIp, ''");

    // A field that is not an alias is the field itself.
    expect(
      buildGroupExpression({
        field: "principalUser",
        correlation: aliased.correlation,
        steps: aliased.steps,
        stepConditions: conditions,
      }).query,
    ).toBe("principalUser");
  });

  test("an event_count step is any of the rules it counts", () => {
    const counted: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
      correlation(`title: Many failures then success
correlation:
  type: temporal_ordered
  rules: [many_failures, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m
---
title: Many failures
name: many_failures
correlation:
  type: event_count
  rules: [failed_sign_in, other_failure]
  timespan: 10m
  condition:
    gte: 5
---
${FAILED}
---
title: Other failure
name: other_failure
detection:
  selection:
    className: Account Change
    statusName: Failure
  condition: selection`);

    const condition: string = compileStepCondition(counted.steps[0]!).query;

    // Both rules' conditions, ORed: "((first) OR (second))", over several lines.
    expect(condition.startsWith("((")).toBe(true);
    expect(condition.endsWith("))")).toBe(true);
    expect(condition).toContain(") OR (");
  });

  test("a step that is not resolved to a rule cannot be compiled", () => {
    const unresolved: SigmaCorrelationStep = {
      reference: "elsewhere",
      title: "elsewhere",
      origin: "project",
    };

    expect(() => {
      compileStepCondition(unresolved);
    }).toThrow('Correlation step "elsewhere" is not resolved to a rule.');
  });
});

describe("CorrelationQueries.buildNewValueStatement", () => {
  const newValue: Extract<DetectionRuleDefinition, { kind: "correlation" }> =
    correlation(`title: New address
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 30d
  condition:
    field: principalIp
---
${SUCCEEDED}`);

  test("this run's pairs, against the history of the same groups", () => {
    const statement: Statement = CorrelationQueries.buildNewValueStatement({
      window: WINDOW,
      historyFrom: new Date("2026-09-21T10:00:00.000Z"),
      correlation: newValue.correlation,
      steps: newValue.steps,
      tableName: "oneuptime.SecurityEvent",
      limit: 50,
    });
    const query: string = statement.query;

    expect(query.startsWith("WITH __recent AS (SELECT ")).toBe(true);
    expect(query).toContain(
      "toString(ifNull(principalUser, '')) AS __g0, toString(ifNull(principalIp, '')) AS __v0",
    );
    expect(query).toContain("HAVING __g0 != '' AND __v0 != ''");
    expect(query).toContain("FROM __recent WHERE (__g0) IN (SELECT ");
    expect(query).toContain(") AND (__g0, __v0) NOT IN (SELECT ");
    expect(query).toContain(") IN (SELECT __g0 FROM __recent)");
    expect(query).toContain("GROUP BY __g0 ORDER BY firstSeenAt DESC LIMIT ");

    // Three reads of the project: this run's, and the history twice; never another project's.
    const projectReads: number = query.split("projectId = {p").length - 1;
    expect(projectReads).toBe(3);

    const values: Array<unknown> = boundValues(statement);
    expect(values).toContain("2026-09-21 10:00:00.000000000");
  });
});

/*
 * A correlation's steps that read watchlists carry them bound
 * (bindSigmaWatchlists): each step's condition matches the list's values,
 * in every place a statement names the step - and a read that would carry
 * more than one request can is refused before it is sent.
 */
describe("correlation steps that read watchlists", () => {
  const VIP_COUNT: string = `title: Five VIP failures
correlation:
  type: event_count
  rules:
    - vip_failure
  group-by:
    - principalUser
  timespan: 10m
  condition:
    gte: 5
---
title: VIP failure
name: vip_failure
detection:
  selection:
    principalUser|expand: '%vip_users%'
    statusName: Failure
  condition: selection`;

  function vipList(values: Array<string>): SigmaWatchlist {
    return {
      name: "vip_users",
      entityType: SecurityEntityType.User,
      exactValues: values,
      patterns: [],
      ranges: [],
    };
  }

  function boundSteps(values: Array<string>): Array<SigmaCorrelationStep> {
    const definition: DetectionRuleDefinition = bindSigmaWatchlists(
      correlation(VIP_COUNT),
      { vip_users: vipList(values) },
    );

    return (definition as { steps: Array<SigmaCorrelationStep> }).steps;
  }

  test("a bound step's condition matches the list's values", () => {
    const condition: Statement = compileStepCondition(
      boundSteps(["alice", "bob"])[0]!,
    );

    expect(condition.query).toContain(
      "lowerUTF8(principalUser) IN {p0:Array(String)}",
    );
    expect(boundValues(condition)).toContainEqual(["alice", "bob"]);
  });

  test("a step that is not bound is refused by name", () => {
    expect(() => {
      return compileStepCondition(correlation(VIP_COUNT).steps[0]!);
    }).toThrow("There is no watchlist named vip_users in this project.");
  });

  test("a read too large for one request is refused before it is sent", async () => {
    const values: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      values.push(`${"u".repeat(240)}${index}`);
    }

    getJestSpyOn(
      SecurityEventService.database,
      "getDatasourceOptions",
    ).mockReturnValue({ database: "oneuptime" } as never);
    const execute: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventService,
      "executeQuery",
    );

    await expect(
      CorrelationQueries.findCountGroups({
        window: WINDOW,
        correlation: correlation(VIP_COUNT).correlation,
        steps: boundSteps(values),
        countDistinct: false,
        limit: 10,
      }),
    ).rejects.toThrow(
      "This rule reads more watchlist values than one read can send to the database",
    );
    expect(execute).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});
