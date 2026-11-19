import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import type { SpyInstance } from "jest-mock";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../Server/Utils/Logger";
import SecurityDetectionMatchedEventsReader, {
  MatchedEventsRead,
  buildMatchedEventsStatement,
  buildMatchedOutcomesStatement,
  getMatchedEventsOfStoredRow,
  getMatchedEventsReadGroupCount,
  readMatchedEventsRows,
} from "../../../../Server/Utils/SecurityCase/SecurityDetectionMatchedEventsReader";
import { buildSigmaFieldExpression } from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_DETECTION_MATCHED_EVENTS_FIRING_DETECTIONS,
  SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX,
  SECURITY_DETECTION_MATCHED_EVENTS_MAX,
  SecurityDetectionMatchedEvents,
  SecurityDetectionMatchedEventsShare,
  getSecurityDetectionMatchedEventsShare,
} from "../../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import { DETECTION_MAX_GROUPS_PER_EVALUATION } from "../../../../Types/SecurityEvent/DetectionFindingConstants";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The events a detection keeps, read as it fires (#9619): two bounded reads
 * for every group of a firing - the earliest events of each, and how far
 * all of their requests got - that never throw. The SQL itself runs against
 * a real ClickHouse in App's SecurityDetectionMatchedEventsClickhouse.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SOURCE_ID: string = "88888888-8888-4888-8888-888888888888";
const START: Date = new Date("2026-11-17T19:20:00.000Z");
const END: Date = new Date("2026-11-17T19:30:00.000Z");

function read(overrides: Partial<MatchedEventsRead> = {}): MatchedEventsRead {
  return {
    projectId: PROJECT_ID,
    start: START,
    end: END,
    condition: SQL`statusName = ${{
      type: TableColumnType.Text,
      value: "Failure",
    }}`,
    groupExpression: buildSigmaFieldExpression("principalIp"),
    groupValues: ["203.0.113.7", "198.51.100.9"],
    ...overrides,
  };
}

function eventRow(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-11-17 19:22:14.000000000",
    eventUid: "log:abc:0",
    primaryEntityId: SOURCE_ID,
    severityName: "Medium",
    className: "Authentication",
    statusName: "Failure",
    message: "Failed sign-in",
    principalIp: "203.0.113.7",
    observables: ["203.0.113.7"],
    attributes: { "oneuptime.log.id": "abc" },
    requestOutcome: "",
    retentionDate: "2026-11-24 19:22:20",
    keptGroup: "203.0.113.7",
    ...overrides,
  };
}

let statements: Array<Statement>;
let eventRows: Array<JSONObject>;
let outcomeRows: Array<JSONObject>;
let executeQuery: SpyInstance<typeof SecurityEventService.executeQuery>;

beforeEach(() => {
  statements = [];
  eventRows = [eventRow()];
  outcomeRows = [{ keptGroup: "203.0.113.7", requestOutcome: "", matched: 9 }];
  jest.spyOn(logger, "warn").mockImplementation((): void => {});

  executeQuery = jest
    .spyOn(SecurityEventService, "executeQuery")
    .mockImplementation(async (statement: unknown): Promise<never> => {
      const sql: Statement = statement as Statement;
      statements.push(sql);
      const isTally: boolean = sql.query.includes("count() AS matched");

      return {
        json: async (): Promise<JSONObject> => {
          return {
            data: isTally ? outcomeRows : eventRows,
          } as unknown as JSONObject;
        },
      } as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the reads", () => {
  test("the events: the earliest of each group, at most the bound, with when each leaves the table", () => {
    const statement: Statement = buildMatchedEventsStatement({
      read: read(),
      limitPerGroup: SECURITY_DETECTION_MATCHED_EVENTS_MAX,
    });

    expect(statement.query).toContain("retentionDate");
    expect(statement.query).toContain("AS keptGroup");
    expect(statement.query).toContain("ORDER BY time ASC");
    expect(statement.query).toMatch(/LIMIT \{p\d+:Int32\} BY keptGroup LIMIT/);
    expect(statement.query).toContain("time >= ");
    expect(statement.query).toContain("time < ");
    expect(statement.query).toContain("has(");
    expect(statement.query).toContain("max_execution_time");
    expect(Object.values(statement.query_params)).toContain(
      SECURITY_DETECTION_MATCHED_EVENTS_MAX,
    );
    // The bound of all the groups together.
    expect(Object.values(statement.query_params)).toContain(
      SECURITY_DETECTION_MATCHED_EVENTS_MAX * 2,
    );
  });

  test("the outcomes: every matching event counted, by group and by how far it got", () => {
    const statement: Statement = buildMatchedOutcomesStatement(read());

    expect(statement.query).toContain("count() AS matched");
    expect(statement.query).toContain("GROUP BY keptGroup, requestOutcome");
    expect(statement.query).not.toContain("LIMIT");
  });

  test("a source that counts its matches as one group reads them all under one", () => {
    const statement: Statement = buildMatchedEventsStatement({
      read: read({ groupExpression: null, groupValues: [] }),
      limitPerGroup: 5,
    });

    expect(statement.query).toContain("'' AS keptGroup");
    expect(statement.query).not.toContain("has(");
  });

  test("a feed's indicators: each event under each observable it carries, lower-cased, without the classes it never reads", () => {
    const statement: Statement = buildMatchedEventsStatement({
      read: read({
        condition: SQL`1`,
        groupExpression: null,
        groupByObservable: true,
        groupValues: ["evil.example.com"],
        excludeClassUids: [2004],
      }),
      limitPerGroup: 5,
    });

    expect(statement.query).toContain(
      "ARRAY JOIN observables AS keptObservable",
    );
    expect(statement.query).toContain("lowerUTF8(keptObservable) AS keptGroup");
    expect(statement.query).toContain("classUid != 2004");
  });

  test("only the project's events, and a value never becomes SQL", () => {
    const statement: Statement = buildMatchedEventsStatement({
      read: read({ groupValues: ["x'); DROP TABLE SecurityEvent; --"] }),
      limitPerGroup: 5,
    });
    const tally: Statement = buildMatchedOutcomesStatement(
      read({ groupValues: ["x'); DROP TABLE SecurityEvent; --"] }),
    );

    expect(statement.query).toContain("projectId = ");
    expect(statement.query).not.toContain("DROP TABLE");
    expect(tally.query).not.toContain("DROP TABLE");
    expect(JSON.stringify(statement.query_params)).toContain(
      PROJECT_ID.toString(),
    );
  });
});

describe("what each group keeps", () => {
  test("its events, as a detection keeps them, and its outcomes", () => {
    const kept: Map<string, SecurityDetectionMatchedEvents> =
      readMatchedEventsRows({
        eventRows: [
          eventRow({ eventUid: "b", time: "2026-11-17 19:22:15.000000000" }),
          eventRow({ eventUid: "a" }),
          eventRow({ eventUid: "c", keptGroup: "198.51.100.9" }),
        ],
        outcomeRows: [
          {
            keptGroup: "203.0.113.7",
            requestOutcome: "Rejected",
            matched: "7",
          },
          { keptGroup: "203.0.113.7", requestOutcome: "", matched: 2 },
          { keptGroup: "198.51.100.9", requestOutcome: "", matched: "0" },
        ],
      });

    expect(
      kept.get("203.0.113.7")!.events.map((event: { eventUid: string }) => {
        return event.eventUid;
      }),
    ).toEqual(["a", "b"]);
    expect(kept.get("203.0.113.7")!.outcomes).toEqual({ Rejected: 7, "": 2 });
    expect(kept.get("203.0.113.7")!.events[0]).toMatchObject({
      sourceId: SOURCE_ID,
      retentionDate: "2026-11-24T19:22:20.000Z",
    });
    expect(kept.get("198.51.100.9")!.outcomes).toEqual({});
  });

  test("a row that names no event is left out", () => {
    const kept: Map<string, SecurityDetectionMatchedEvents> =
      readMatchedEventsRows({
        eventRows: [eventRow({ eventUid: "", time: "" })],
        outcomeRows: [],
      });

    expect(kept.size).toBe(0);
  });

  test("keeps at most the bound of a group, however many rows come back", () => {
    const kept: Map<string, SecurityDetectionMatchedEvents> =
      readMatchedEventsRows({
        eventRows: Array.from(
          { length: SECURITY_DETECTION_MATCHED_EVENTS_MAX + 10 },
          (_: unknown, index: number): JSONObject => {
            return eventRow({ eventUid: `e${index}` });
          },
        ),
        outcomeRows: [],
      });

    expect(kept.get("203.0.113.7")!.events).toHaveLength(
      SECURITY_DETECTION_MATCHED_EVENTS_MAX,
    );
  });
});

describe("reading for a firing", () => {
  test("reads the events and the outcomes of every group in two reads", async () => {
    const kept: Map<string, SecurityDetectionMatchedEvents> =
      await SecurityDetectionMatchedEventsReader.readForGroups(read());

    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(kept.get("203.0.113.7")!.events).toHaveLength(1);
    expect(kept.get("203.0.113.7")!.outcomes).toEqual({ "": 9 });
  });

  test("a firing with no group to read reads nothing", async () => {
    expect(
      (
        await SecurityDetectionMatchedEventsReader.readForGroups(
          read({ groupValues: [] }),
        )
      ).size,
    ).toBe(0);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("a read that fails keeps nothing, says so in the log, and never throws", async () => {
    executeQuery.mockRejectedValue(new Error("ClickHouse is down"));

    const kept: Map<string, SecurityDetectionMatchedEvents> =
      await SecurityDetectionMatchedEventsReader.readForGroups(read());

    expect(kept.size).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});

/*
 * What one firing keeps across every group it fires for (#9795): each
 * group an equal share of 1,000 events and 2.5 MB, so a firing for a run's
 * 100 groups reads at most 1,000 rows and every group keeps 10.
 */
describe("a firing's budget, shared by its groups", () => {
  function addresses(count: number): Array<string> {
    return Array.from({ length: count }, (_: unknown, index: number) => {
      return `203.0.${Math.floor(index / 250)}.${index % 250}`;
    });
  }

  // The two LIMITs of the events' read: per group, then for the firing.
  function limitsOf(statement: Statement): Array<number> {
    return Object.values(statement.query_params).filter(
      (value: unknown): value is number => {
        return typeof value === "number";
      },
    );
  }

  test("each group is one, once each, or one group for a source that does not group", () => {
    expect(getMatchedEventsReadGroupCount(read())).toBe(2);
    expect(
      getMatchedEventsReadGroupCount(
        read({ groupValues: ["203.0.113.7", "203.0.113.7", "198.51.100.9"] }),
      ),
    ).toBe(2);
    expect(
      getMatchedEventsReadGroupCount(
        read({ groupExpression: null, groupValues: [] }),
      ),
    ).toBe(1);
    expect(
      getMatchedEventsReadGroupCount(
        read({
          groupExpression: null,
          groupByObservable: true,
          groupValues: ["evil.example.com", "bad.example.net"],
        }),
      ),
    ).toBe(2);
  });

  test("a firing for a few groups reads a whole detection's 25 of each", async () => {
    await SecurityDetectionMatchedEventsReader.readForGroups(
      read({
        groupValues: addresses(
          SECURITY_DETECTION_MATCHED_EVENTS_FIRING_DETECTIONS,
        ),
      }),
    );

    const events: Statement = statements.find((statement: Statement) => {
      return statement.query.includes("BY keptGroup");
    })!;

    expect(limitsOf(events)).toEqual([
      SECURITY_DETECTION_MATCHED_EVENTS_MAX,
      SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX,
    ]);
  });

  test("a firing for a run's 100 groups reads 10 of each, and 1,000 at most in all", async () => {
    await SecurityDetectionMatchedEventsReader.readForGroups(
      read({ groupValues: addresses(DETECTION_MAX_GROUPS_PER_EVALUATION) }),
    );

    const events: Statement = statements.find((statement: Statement) => {
      return statement.query.includes("BY keptGroup");
    })!;

    expect(limitsOf(events)).toEqual([10, 1000]);
    // Still two reads, however many groups.
    expect(executeQuery).toHaveBeenCalledTimes(2);
  });

  test("however many rows come back, a group keeps no more than its share", async () => {
    const groups: Array<string> = addresses(
      DETECTION_MAX_GROUPS_PER_EVALUATION,
    );

    eventRows = groups.flatMap((group: string): Array<JSONObject> => {
      return Array.from({ length: 30 }, (_: unknown, index: number) => {
        return eventRow({
          eventUid: `${group}:${index}`,
          keptGroup: group,
          time: `2026-11-17 19:2${index % 10}:00.000000000`,
        });
      });
    });
    outcomeRows = groups.map((group: string): JSONObject => {
      return { keptGroup: group, requestOutcome: "Rejected", matched: 30 };
    });

    const kept: Map<string, SecurityDetectionMatchedEvents> =
      await SecurityDetectionMatchedEventsReader.readForGroups(
        read({ groupValues: groups }),
      );

    // Every group keeps events, and every one keeps its share.
    expect(kept.size).toBe(DETECTION_MAX_GROUPS_PER_EVALUATION);

    let total: number = 0;

    for (const group of groups) {
      expect(kept.get(group)!.events).toHaveLength(10);
      // How far its requests got counts all of them, not only the kept.
      expect(kept.get(group)!.outcomes).toEqual({ Rejected: 30 });
      total += kept.get(group)!.events.length;
    }

    expect(total).toBeLessThanOrEqual(
      SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX,
    );
  });

  test("a group keeps its share of the firing's size too, and always its first event", () => {
    const share: SecurityDetectionMatchedEventsShare =
      getSecurityDetectionMatchedEventsShare(
        DETECTION_MAX_GROUPS_PER_EVALUATION,
      );
    const attributes: JSONObject = {};

    for (let key: number = 0; key < 40; key++) {
      attributes[`a.${key}`] = "x".repeat(450);
    }

    const kept: Map<string, SecurityDetectionMatchedEvents> =
      readMatchedEventsRows({
        eventRows: Array.from({ length: 10 }, (_: unknown, index: number) => {
          return eventRow({ eventUid: `big-${index}`, attributes });
        }),
        outcomeRows: [],
        share,
      });
    const events: SecurityDetectionMatchedEvents["events"] =
      kept.get("203.0.113.7")!.events;

    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(10);
    expect(JSON.stringify(events).length).toBeLessThanOrEqual(share.maxBytes);
  });
});

describe("an event recorded as it was stored", () => {
  test("keeps the row as stored, with its source and its request's outcome", () => {
    const kept: SecurityDetectionMatchedEvents | null =
      getMatchedEventsOfStoredRow({
        _id: "0192f000-0000-7000-8000-000000000000",
        time: "2026-11-17 19:22:14.000000000",
        eventUid: "crowdstrike:alert:9",
        primaryEntityId: SOURCE_ID,
        severityName: "High",
        className: "Detection Finding",
        message: "Malware blocked",
        attributes: { "crowdstrike.tactic": "Execution" },
        requestOutcome: "",
        retentionDate: "2026-12-17 19:22:14",
      });

    expect(kept!.events).toHaveLength(1);
    expect(kept!.events[0]).toMatchObject({
      eventUid: "crowdstrike:alert:9",
      sourceId: SOURCE_ID,
      className: "Detection Finding",
      retentionDate: "2026-12-17T19:22:14.000Z",
    });
    expect(kept!.outcomes).toEqual({ "": 1 });
  });

  test("a row that names no event keeps nothing", () => {
    expect(getMatchedEventsOfStoredRow({ message: "no id" })).toBeNull();
  });
});
