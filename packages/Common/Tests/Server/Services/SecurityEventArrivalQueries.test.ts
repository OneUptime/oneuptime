import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import LogService, {
  LogService as LogServiceClass,
  SECURITY_LOG_SCAN_MAX_BODY_LENGTH,
} from "../../../Server/Services/LogService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_LOG_PREFILTER,
  SecurityLogPrefilterGroup,
} from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { SECURITY_EVENT_RECORD_COLUMNS } from "../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import { getJestSpyOn } from "../../Spy";

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AFTER: Date = new Date("2026-10-19T10:00:00.000Z");
const UNTIL: Date = new Date("2026-10-19T10:05:00.000Z");
const HAPPENED_AFTER: Date = new Date("2026-10-18T10:00:00.000Z");

function stubExecuteQuery(
  service: typeof SecurityEventService | typeof LogService,
  rows: Array<JSONObject>,
): Spy {
  getJestSpyOn(service.database, "getDatasourceOptions").mockReturnValue({
    database: "oneuptime",
  } as never);

  const result: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return getJestSpyOn(service, "executeQuery").mockResolvedValue(
    result as never,
  );
}

function boundValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * What a SIEM destination reads: one project's events by when they
 * arrived, in a fixed order, a page at a time - and every value bound as a
 * parameter, never written into the SQL.
 */
describe("SecurityEventService.findArrivedEvents", () => {
  test("reads one project's events that arrived in the window, oldest first", async () => {
    const spy: Spy = stubExecuteQuery(SecurityEventService, [
      { _id: "a", eventUid: "x" },
    ]);

    const rows: Array<JSONObject> =
      await SecurityEventService.findArrivedEvents({
        projectId: PROJECT_ID,
        arrivedAfter: AFTER,
        arrivedUntil: UNTIL,
        happenedAfter: HAPPENED_AFTER,
        findingsOnly: false,
        excludeProductNames: [],
        limit: 1000,
        offset: 2000,
      });

    expect(rows).toEqual([{ _id: "a", eventUid: "x" }]);

    const statement: Statement = spy.mock.calls[0]![0] as Statement;
    const query: string = statement.query;

    expect(query).toContain(
      `SELECT ${SECURITY_EVENT_RECORD_COLUMNS.join(", ")} FROM oneuptime.${SecurityEventService.model.tableName} WHERE projectId = {p0:String}`,
    );
    expect(query).toContain("AND time >= {p1:DateTime64(9)}");
    expect(query).toContain("AND createdAt > {p2:DateTime}");
    expect(query).toContain("AND createdAt <= {p3:DateTime}");
    expect(query).toContain(
      "ORDER BY createdAt ASC, _id ASC LIMIT {p4:Int32} OFFSET {p5:Int32}",
    );
    expect(query).not.toContain("categoryUid =");
    expect(query).not.toContain("NOT has(");
    expect(boundValues(statement).slice(0, 6)).toEqual([
      PROJECT_ID.toString(),
      "2026-10-18 10:00:00.000000000",
      "2026-10-19 10:00:00",
      "2026-10-19 10:05:00",
      1000,
      2000,
    ]);
  });

  test("detections only, and without the products named", async () => {
    const spy: Spy = stubExecuteQuery(SecurityEventService, []);

    await SecurityEventService.findArrivedEvents({
      projectId: PROJECT_ID,
      arrivedAfter: AFTER,
      arrivedUntil: UNTIL,
      happenedAfter: HAPPENED_AFTER,
      findingsOnly: true,
      excludeProductNames: ["Google SecOps", "OneUptime setup test"],
      limit: 10,
      offset: 0,
    });

    const statement: Statement = spy.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain("AND categoryUid = {p4:Int32}");
    expect(statement.query).toContain(
      "AND NOT has({p5:Array(String)}, productName)",
    );
    expect(boundValues(statement)).toContainEqual([
      "Google SecOps",
      "OneUptime setup test",
    ]);
    expect(boundValues(statement)).toContain(2);
    expect(statement.query).not.toContain("Google SecOps");
  });

  test("a limit and offset out of range are made whole and safe", async () => {
    const spy: Spy = stubExecuteQuery(SecurityEventService, []);

    await SecurityEventService.findArrivedEvents({
      projectId: PROJECT_ID,
      arrivedAfter: AFTER,
      arrivedUntil: UNTIL,
      happenedAfter: HAPPENED_AFTER,
      findingsOnly: false,
      excludeProductNames: [],
      limit: 0.5,
      offset: -3,
    });

    const values: Array<unknown> = boundValues(
      spy.mock.calls[0]![0] as Statement,
    );

    expect(values.slice(4, 6)).toEqual([1, 0]);
  });
});

/*
 * What the scan of "Your logs" reads: one project's logs by when they
 * arrived, only the lines holding a security record's words, and only the
 * start of each body.
 */
describe("LogService.findSecurityLogCandidates", () => {
  test("reads one project's candidate lines that arrived in the window", async () => {
    const spy: Spy = stubExecuteQuery(LogService, [
      { _id: "l1", body: "Failed password for root from 203.0.113.7" },
    ]);

    const rows: Array<JSONObject> = await LogService.findSecurityLogCandidates({
      projectId: PROJECT_ID,
      arrivedAfter: AFTER,
      arrivedUntil: UNTIL,
      happenedAfter: HAPPENED_AFTER,
      limit: 1000,
      offset: 0,
    });

    expect(rows).toHaveLength(1);

    const statement: Statement = spy.mock.calls[0]![0] as Statement;
    const query: string = statement.query;

    expect(query).toContain(
      `SELECT _id, time, createdAt, primaryEntityId, primaryEntityType, traceId, spanId, sessionId, attributes, substring(body, 1, {p0:Int32}) AS body FROM oneuptime.${LogService.model.tableName} WHERE projectId = {p1:String}`,
    );
    expect(query).toContain("AND createdAt > {p3:DateTime}");
    expect(query).toContain("AND createdAt <= {p4:DateTime}");
    expect(query).toContain("multiSearchAnyCaseInsensitive(body,");
    expect(query).toContain("ORDER BY createdAt ASC, _id ASC");
    expect(boundValues(statement)[0]).toBe(SECURITY_LOG_SCAN_MAX_BODY_LENGTH);
    expect(boundValues(statement)[1]).toBe(PROJECT_ID.toString());
    // Not one of the words is written into the SQL.
    expect(query).not.toContain("failed password");
    expect(query).not.toContain("audit.k8s.io");
  });

  test("the prefilter binds every word of the shared prefilter, group by group", () => {
    const statement: Statement = LogServiceClass.buildSecurityLogPrefilter();
    const values: Array<unknown> = boundValues(statement);

    expect(values[0]).toEqual([...SECURITY_LOG_PREFILTER.anyOf]);

    for (const group of SECURITY_LOG_PREFILTER.groups) {
      expect(values).toContain(group.requires);
      expect(values).toContainEqual([...group.anyOf]);

      if (group.noneOf) {
        expect(values).toContainEqual([...group.noneOf]);
      }

      if (group.unlessAnyOf) {
        expect(values).toContainEqual([...group.unlessAnyOf]);
      }
    }

    const groupsWithExceptions: number = SECURITY_LOG_PREFILTER.groups.filter(
      (group: SecurityLogPrefilterGroup): boolean => {
        return Boolean(group.noneOf);
      },
    ).length;

    expect(
      statement.query.split("NOT multiSearchAnyCaseInsensitive").length - 1,
    ).toBe(groupsWithExceptions);
    expect(
      statement.query.split("positionCaseInsensitive(body,").length - 1,
    ).toBe(SECURITY_LOG_PREFILTER.groups.length);
    // Balanced, so it ANDs into the query as one condition.
    expect(statement.query.split("(").length).toBe(
      statement.query.split(")").length,
    );
  });
});
