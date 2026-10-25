import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import SecurityEventService, {
  OBSERVABLE_ACTIVITY_MAX_VALUES,
  SECURITY_CONNECTION_READ_TIME_LIMIT,
  SecurityEventLogResource,
  SecurityEventsNamingSummary,
} from "../../../Server/Services/SecurityEventService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "../../../Types/SecurityCase/SecurityConnection";
import { getJestSpyOn } from "../../Spy";

/*
 * The security-event reads behind Security Events' connections - a record
 * page's counts, the logs behind a case's events, whether a project uses
 * Security Events at all. One project's rows only (the project is the first
 * condition), a bounded window, every value bound as a parameter, and a
 * time limit that fails a slow read rather than answering "nothing". Their
 * answers on a real ClickHouse, under both analyzers, are pinned in
 * SecurityConnectionsClickhouse.test.ts.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const HOST_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const START: Date = new Date("2026-10-18T12:00:00.000Z");
const END: Date = new Date("2026-10-25T12:00:00.000Z");

function stubExecuteQuery(rows: Array<JSONObject>): Spy {
  getJestSpyOn(
    SecurityEventService.database,
    "getDatasourceOptions",
  ).mockReturnValue({
    database: "oneuptime",
  } as never);

  const result: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return getJestSpyOn(SecurityEventService, "executeQuery").mockResolvedValue(
    result as never,
  );
}

function statementOf(spy: Spy): Statement {
  return spy.mock.calls[0]![0] as Statement;
}

function boundValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityEventService.countEventsNaming", () => {
  test("one project's events naming any of the values in the window: counts, findings, the worst and the latest", async () => {
    const spy: Spy = stubExecuteQuery([
      {
        eventCount: "42",
        findingCount: "3",
        maxSeverityId: 4,
        lastSeen: "2026-10-25 11:00:00.000000000",
      },
    ]);

    const summary: SecurityEventsNamingSummary =
      await SecurityEventService.countEventsNaming({
        projectId: PROJECT_ID,
        values: ["web-1", " WEB-1 ", "", "203.0.113.9"],
        startTime: START,
        endTime: END,
      });

    expect(summary).toEqual({
      eventCount: 42,
      findingCount: 3,
      maxSeverityId: 4,
      lastSeen: new Date("2026-10-25T11:00:00.000Z"),
    });

    const statement: Statement = statementOf(spy);

    expect(statement.query).toContain(
      "SELECT count() AS eventCount, countIf(classUid IN (2004, 2005)) AS findingCount",
    );
    expect(statement.query).toContain(
      `FROM oneuptime.${SecurityEventService.model.tableName} WHERE projectId = {p0:String}`,
    );
    expect(statement.query).toContain(
      "AND (hasAny(observables, {p3:Array(String)}))",
    );
    expect(statement.query).not.toContain("attributes[");
    expect(boundValues(statement)).toEqual([
      PROJECT_ID.toString(),
      expect.anything(),
      expect.anything(),
      ["web-1", "WEB-1", "203.0.113.9"],
    ]);
    expect(statement.query).toContain(
      `max_execution_time = ${SECURITY_CONNECTION_READ_TIME_LIMIT.maxExecutionTimeInSeconds}`,
    );
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
    // Not one value is written into the SQL.
    expect(statement.query).not.toContain("web-1");
  });

  test("a service's events: the ones read from its logs, by the attribute only they carry", async () => {
    const spy: Spy = stubExecuteQuery([{ eventCount: 2 }]);

    await SecurityEventService.countEventsNaming({
      projectId: PROJECT_ID,
      values: [],
      logResourceId: HOST_ID,
      startTime: START,
      endTime: END,
    });

    const statement: Statement = statementOf(spy);

    expect(statement.query).toContain(
      "AND ((has(attributeKeys, {p3:String}) AND attributes[{p4:String}] = {p5:String}))",
    );
    expect(statement.query).not.toContain("hasAny(observables");
    expect(boundValues(statement).slice(3)).toEqual([
      SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
      SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
      HOST_ID.toString(),
    ]);
  });

  test("both: the values, or the logs", async () => {
    const spy: Spy = stubExecuteQuery([{ eventCount: 1 }]);

    await SecurityEventService.countEventsNaming({
      projectId: PROJECT_ID,
      values: ["web-1"],
      logResourceId: HOST_ID,
      startTime: START,
      endTime: END,
    });

    expect(statementOf(spy).query).toContain(
      "AND (hasAny(observables, {p3:Array(String)}) OR (has(attributeKeys,",
    );
  });

  test("an empty window: nothing seen, and its max(time) of the epoch is no time anything was seen", async () => {
    stubExecuteQuery([
      {
        eventCount: 0,
        findingCount: 0,
        maxSeverityId: 0,
        lastSeen: "1970-01-01 00:00:00.000000000",
      },
    ]);

    expect(
      await SecurityEventService.countEventsNaming({
        projectId: PROJECT_ID,
        values: ["web-1"],
        startTime: START,
        endTime: END,
      }),
    ).toEqual({
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      lastSeen: null,
    });
  });

  test("nothing to look for reads nothing", async () => {
    const spy: Spy = stubExecuteQuery([]);

    expect(
      await SecurityEventService.countEventsNaming({
        projectId: PROJECT_ID,
        values: [" ", ""],
        startTime: START,
        endTime: END,
      }),
    ).toEqual({
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      lastSeen: null,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test("at most a lookup's worth of values", async () => {
    const spy: Spy = stubExecuteQuery([{ eventCount: 0 }]);
    const many: Array<string> = [];

    for (let index: number = 0; index < 120; index++) {
      many.push(`host-${index}`);
    }

    await SecurityEventService.countEventsNaming({
      projectId: PROJECT_ID,
      values: many,
      startTime: START,
      endTime: END,
    });

    expect((boundValues(statementOf(spy))[3] as Array<string>).length).toBe(
      OBSERVABLE_ACTIVITY_MAX_VALUES,
    );
  });
});

describe("SecurityEventService.findLogResourcesNaming", () => {
  test("the records the log lines behind events naming the values were sent under, the most named first", async () => {
    const spy: Spy = stubExecuteQuery([
      { resourceType: "Host", resourceId: HOST_ID.toString(), eventCount: "9" },
      // Not a record anyone can be sent to: dropped.
      { resourceType: "Host", resourceId: "project-1", eventCount: 3 },
      { resourceType: "", resourceId: HOST_ID.toString(), eventCount: 1 },
    ]);

    const resources: Array<SecurityEventLogResource> =
      await SecurityEventService.findLogResourcesNaming({
        projectId: PROJECT_ID,
        values: ["web-1"],
        startTime: START,
        endTime: END,
        limit: 500,
      });

    expect(resources).toEqual([
      { type: "Host", id: HOST_ID.toString(), eventCount: 9 },
    ]);

    const statement: Statement = statementOf(spy);

    expect(statement.query).toContain(
      "SELECT attributes[{p0:String}] AS resourceType, attributes[{p1:String}] AS resourceId, count() AS eventCount FROM",
    );
    expect(statement.query).toContain("WHERE projectId = {p2:String}");
    expect(statement.query).toContain(
      "AND hasAny(observables, {p5:Array(String)})",
    );
    expect(statement.query).toContain("AND has(attributeKeys, {p6:String})");
    expect(statement.query).toContain(
      "GROUP BY resourceType, resourceId ORDER BY eventCount DESC, resourceId ASC LIMIT {p7:Int32}",
    );
    expect(boundValues(statement)[0]).toBe(
      SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
    );
    expect(boundValues(statement)[1]).toBe(SECURITY_LOG_RESOURCE_ID_ATTRIBUTE);
    // The limit is held to a hundred whatever is asked.
    expect(boundValues(statement)[7]).toBe(100);
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("no value reads nothing", async () => {
    const spy: Spy = stubExecuteQuery([]);

    expect(
      await SecurityEventService.findLogResourcesNaming({
        projectId: PROJECT_ID,
        values: [],
        startTime: START,
        endTime: END,
        limit: 10,
      }),
    ).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("SecurityEventService.hasEventsSince", () => {
  test("one row at most, from the start of the project's range", async () => {
    const spy: Spy = stubExecuteQuery([{ found: 1 }]);

    expect(
      await SecurityEventService.hasEventsSince({
        projectId: PROJECT_ID,
        startTime: START,
      }),
    ).toBe(true);

    const statement: Statement = statementOf(spy);

    expect(statement.query).toContain(
      "WHERE projectId = {p0:String} AND time >= {p1:DateTime64(9)} LIMIT 1",
    );
    expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("a project with no event says no", async () => {
    stubExecuteQuery([]);

    expect(
      await SecurityEventService.hasEventsSince({
        projectId: PROJECT_ID,
        startTime: START,
      }),
    ).toBe(false);
  });
});
