import SecurityEventService, {
  DetectionMatchGroup,
  FindDetectionMatchesData,
} from "../../../../Server/Services/SecurityEventService";
import { Results } from "../../../../Server/Services/AnalyticsDatabaseService";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import DetectionRuleRetrohunt, {
  DetectionRetrohuntCounting,
  buildSingleRuleRetrohuntStatement,
  buildUncountedRetrohuntStatement,
  getHiddenValueMarker,
  readUncountedRetrohuntRow,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleRetrohunt";
import DetectionRuleExceptionService from "../../../../Server/Services/DetectionRuleExceptionService";
import ProjectSigmaRules from "../../../../Server/Utils/SecurityEvent/Correlation/ProjectSigmaRules";
import SecurityWatchlists from "../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import {
  buildSigmaFieldExpression,
  buildSigmaFieldHasValue,
} from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { DetectionRetrohuntResult } from "../../../../Types/SecurityEvent/DetectionRetrohunt";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import { doesDetectionRuleLeaveOutEventsWithNoValue } from "../../../../Types/SecurityEvent/DetectionUncountedEvents";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * EVENTS WITH NO VALUE NEVER COUNT AS ONE VALUE (#10415).
 *
 * A rule that groups by a field and needs more than one event per group -
 * Brute force from one IP address, Password spraying - leaves out the
 * events that have no value for that field, in the scheduled read, in the
 * read a real-time write makes (its IN (SELECT ...) of the write's groups)
 * and in Run on Past Events. A rule that fires on each event keeps them.
 * Run on Past Events says how many it left out, and how many of those a
 * scrub rule hid the address of (#10397), so a rule that cannot count is
 * never quiet about it. The real ClickHouse reads are in App's
 * DetectionRuleArrivalsClickhouse suite; these pin the statements.
 */

type Spy = ReturnType<typeof jest.spyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10415104-1510-4415-8415-104151041510",
);
const START_TIME: Date = new Date("2026-11-20T10:00:00.000Z");
const END_TIME: Date = new Date("2026-11-20T10:05:00.000Z");
const DATABASE_NAME: string = "oneuptime";

function stubExecuteQuery(rows: Array<JSONObject> = []): Spy {
  getJestSpyOn(
    SecurityEventService.database,
    "getDatasourceOptions",
  ).mockReturnValue({ database: DATABASE_NAME } as never);

  return getJestSpyOn(SecurityEventService, "executeQuery").mockResolvedValue({
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results as never);
}

function failureWhere(): Statement {
  return SQL`statusName = ${{ type: TableColumnType.Text, value: "Failure" }}`;
}

async function read(
  overrides: Partial<FindDetectionMatchesData>,
): Promise<Statement> {
  const spy: Spy = stubExecuteQuery();

  const groups: Array<DetectionMatchGroup> =
    await SecurityEventService.findDetectionMatches({
      projectId: PROJECT_ID,
      startTime: START_TIME,
      endTime: END_TIME,
      whereFragment: failureWhere(),
      groupByExpression: buildSigmaFieldExpression("principalIp"),
      groupHasValueExpression: buildSigmaFieldHasValue("principalIp"),
      distinctCountExpression: null,
      minMatchCount: 10,
      maxGroups: 50,
      ...overrides,
    });

  expect(groups).toEqual([]);
  expect(spy).toHaveBeenCalledTimes(1);

  return spy.mock.calls[0]![0] as Statement;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which rules leave out events with no value", () => {
  test("a rule that groups and needs more than one event, or counts distinct values", () => {
    expect(
      doesDetectionRuleLeaveOutEventsWithNoValue({
        groupByField: "principalIp",
        matchCountThreshold: 10,
      }),
    ).toBe(true);
    expect(
      doesDetectionRuleLeaveOutEventsWithNoValue({
        groupByField: "principalIp",
        distinctCountField: "principalUser",
        matchCountThreshold: 1,
      }),
    ).toBe(true);
    expect(
      doesDetectionRuleLeaveOutEventsWithNoValue({
        groupByField: "attributes.ssh.method",
        matchCountThreshold: "3",
      }),
    ).toBe(true);
  });

  test("never one that fires on each event, nor one that groups nothing", () => {
    for (const rule of [
      { groupByField: "principalUser", matchCountThreshold: 1 },
      { groupByField: "principalUser", matchCountThreshold: null },
      { groupByField: "principalUser" },
      { groupByField: "", matchCountThreshold: 10 },
      { groupByField: "  ", distinctCountField: "principalUser" },
      { matchCountThreshold: 10, distinctCountField: "principalUser" },
      { groupByField: "principalIp", matchCountThreshold: "lots" },
    ]) {
      expect({
        rule,
        leaves: doesDetectionRuleLeaveOutEventsWithNoValue(rule),
      }).toEqual({ rule, leaves: false });
    }
  });

  test("the library's sign-in rules leave them out; a rule that fires on each event keeps them", () => {
    const byTitle: (title: string) => DetectionRuleLibraryEntry = (
      title: string,
    ): DetectionRuleLibraryEntry => {
      const entry: DetectionRuleLibraryEntry | undefined =
        DETECTION_RULE_LIBRARY.find((candidate: DetectionRuleLibraryEntry) => {
          return candidate.title === title;
        });

      if (!entry) {
        throw new Error(`No library rule ${title}`);
      }

      return entry;
    };

    for (const title of [
      "Brute force from one IP address",
      "Password spraying",
      "Repeated failed sign-ins for one account",
    ]) {
      expect({
        title,
        leaves: doesDetectionRuleLeaveOutEventsWithNoValue(byTitle(title)),
      }).toEqual({ title, leaves: true });
    }

    expect(
      doesDetectionRuleLeaveOutEventsWithNoValue(
        byTitle("Many records deleted at once in OneUptime"),
      ),
    ).toBe(false);
  });
});

describe("whether an event has a value, by the kind of field", () => {
  test("text, a number column, a list and an attribute each say none their own way", () => {
    expect(buildSigmaFieldHasValue("principalIp").query).toBe(
      "principalIp != ''",
    );
    // An alias reads the column it names.
    expect(buildSigmaFieldHasValue("src_ip").query).toBe("principalIp != ''");
    expect(buildSigmaFieldHasValue("targetPort").query).toBe("targetPort != 0");
    expect(buildSigmaFieldHasValue("observables").query).toBe(
      "notEmpty(observables)",
    );

    const attribute: Statement = buildSigmaFieldHasValue("ssh.method");
    expect(attribute.query).toBe("attributes[{p0:String}] != ''");
    expect(attribute.query_params).toEqual({ p0: "ssh.method" });
  });
});

describe("the read of a rule that counts", () => {
  test("leaves out the events with no value for its group field", async () => {
    const statement: Statement = await read({});

    expect(statement.query).toContain(
      "AND (statusName = {p3:String}) AND (principalIp != '') GROUP BY groupValue HAVING matchCount >= {p4:Int32}",
    );
  });

  test("and so does one that counts distinct values, at any threshold", async () => {
    const statement: Statement = await read({
      distinctCountExpression: buildSigmaFieldExpression("principalUser"),
      minMatchCount: 1,
    });

    expect(statement.query).toContain("AND (principalIp != '') GROUP BY");
  });

  test("a rule that fires on each event keeps them, in the read it always had", async () => {
    const statement: Statement = await read({ minMatchCount: 1 });

    expect(statement.query).not.toContain("principalIp != ''");
    expect(statement.query).toContain(
      "AND (statusName = {p3:String}) GROUP BY groupValue ORDER BY matchCount DESC",
    );
  });

  test("a rule with no group field keeps its one group", async () => {
    const statement: Statement = await read({
      groupByExpression: null,
      groupHasValueExpression: null,
    });

    expect(statement.query).not.toContain("!= ''");
  });

  test("a caller that says nothing of a value reads as it always did", async () => {
    const statement: Statement = await read({
      groupHasValueExpression: undefined,
    });

    expect(statement.query).not.toContain("principalIp != ''");
  });

  test("the read a real-time write makes leaves them out of the groups it names, too", async () => {
    const statement: Statement = await read({
      arrival: {
        candidateIds: ["019a4f00-0001-7000-8000-000000000001"],
        firstId: "019a4f00-0001-7000-8000-000000000001",
        lastId: "019a4f00-0001-7000-8000-000000000001",
        candidateStartTime: START_TIME,
        candidateEndTime: END_TIME,
      },
    });

    expect(statement.query).toContain(
      "AND (statusName = {p5:String}) AND (principalIp != '') AND _id <= {p6:String} AND principalIp IN (SELECT principalIp FROM",
    );
    expect(statement.query).toContain(
      "AND has({p10:Array(String)}, _id) AND (principalIp != '')) GROUP BY groupValue",
    );
  });

  test("as does a scheduled run's read of what arrived", async () => {
    const statement: Statement = await read({
      arrival: {
        kind: "run",
        arrivedAfter: new Date("2026-11-20T10:04:00.000Z"),
        arrivedUntil: new Date("2026-11-20T10:05:00.000Z"),
        candidateStartTime: START_TIME,
        candidateEndTime: END_TIME,
      },
    });

    expect(statement.query.split("(principalIp != '')").length - 1).toBe(2);
  });
});

describe("Run on Past Events", () => {
  const COUNTING: DetectionRetrohuntCounting = {
    windowInMinutes: 5,
    threshold: 10,
    groupByField: "principalIp",
    distinctCountField: "",
  };

  function retrohuntStatement(counting: DetectionRetrohuntCounting): Statement {
    return buildSingleRuleRetrohuntStatement({
      projectId: PROJECT_ID,
      tableName: "oneuptime.SecurityEvent",
      ruleWhere: failureWhere(),
      counting,
      skipped: null,
      serviceFilter: {},
      startTime: START_TIME,
      endTime: END_TIME,
      maxGroups: 51,
    });
  }

  function uncountedStatement(
    counting: DetectionRetrohuntCounting,
  ): Statement | null {
    return buildUncountedRetrohuntStatement({
      projectId: PROJECT_ID,
      tableName: "oneuptime.SecurityEvent",
      ruleWhere: failureWhere(),
      counting,
      skipped: SQL`principalUser = ${{
        type: TableColumnType.Text,
        value: "svc-backup",
      }}`,
      serviceFilter: {},
      startTime: START_TIME,
      endTime: END_TIME,
    });
  }

  test("counts a rule that counts per value as its runs do: no event with no value", () => {
    expect(retrohuntStatement(COUNTING).query).toContain(
      "AND (statusName = {p6:String}) AND (principalIp != '') GROUP BY __window, __group",
    );
    expect(
      retrohuntStatement({ ...COUNTING, threshold: 1 }).query,
    ).not.toContain("principalIp != ''");
  });

  test("reads what such a rule left out, apart: its exceptions' events out, a scrub rule's hidden addresses counted", () => {
    const statement: Statement | null = uncountedStatement(COUNTING);

    expect(statement).not.toBeNull();
    expect(statement!.query).toContain(
      "SELECT countIf(NOT __skipped) AS eventCount, countIf(NOT __skipped AND __hidden AND NOT __inTraces) AS hiddenInLogsCount, countIf(NOT __skipped AND __hidden AND __inTraces) AS hiddenInTracesCount FROM oneuptime.SecurityEvent",
    );
    expect(statement!.query).toContain(") AND NOT (principalIp != '')");
    expect(Object.values(statement!.query_params)).toEqual(
      expect.arrayContaining([
        "svc-backup",
        "oneuptime.request.client_address_hidden",
        "scrub-rule",
        "oneuptime.request.client_address_scrubbed_in",
        "span-attributes",
        "Failure",
      ]),
    );
  });

  test("reads nothing apart for a rule that leaves nothing out", () => {
    expect(uncountedStatement({ ...COUNTING, threshold: 1 })).toBeNull();
    expect(uncountedStatement({ ...COUNTING, groupByField: "" })).toBeNull();
  });

  test("a row of none is no figure; a row of some says the field and both kinds of record", () => {
    expect(
      readUncountedRetrohuntRow({ row: undefined, counting: COUNTING }),
    ).toBeNull();
    expect(
      readUncountedRetrohuntRow({
        row: { eventCount: "0" },
        counting: COUNTING,
      }),
    ).toBeNull();
    expect(
      readUncountedRetrohuntRow({
        row: {
          eventCount: "1204",
          hiddenInLogsCount: "1180",
          hiddenInTracesCount: "4",
        },
        counting: COUNTING,
      }),
    ).toEqual({
      field: "principalIp",
      eventCount: 1204,
      hiddenInLogsCount: 1180,
      hiddenInTracesCount: 4,
    });
  });

  test("a run's answer says what the rule left out, read with the rule's own condition", async () => {
    getJestSpyOn(ProjectSigmaRules, "load").mockResolvedValue((() => {
      return null;
    }) as never);
    getJestSpyOn(SecurityWatchlists, "readerFor").mockReturnValue({
      bind: async (definition: unknown): Promise<unknown> => {
        return definition;
      },
    } as never);
    getJestSpyOn(DetectionRuleExceptionService, "findBy").mockResolvedValue(
      [] as never,
    );

    getJestSpyOn(
      SecurityEventService.database,
      "getDatasourceOptions",
    ).mockReturnValue({ database: DATABASE_NAME } as never);

    const statements: Array<Statement> = [];
    getJestSpyOn(SecurityEventService, "executeQuery").mockImplementation(
      (async (statement: Statement): Promise<Results> => {
        statements.push(statement);

        const rows: Array<JSONObject> = statement.query.includes(
          "AS hiddenInLogsCount",
        )
          ? [
              {
                eventCount: "12",
                hiddenInLogsCount: "12",
                hiddenInTracesCount: "0",
              },
            ]
          : [];

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({ data: rows });
          },
        } as unknown as Results;
      }) as never,
    );

    const result: DetectionRetrohuntResult = await DetectionRuleRetrohunt.run({
      projectId: PROJECT_ID,
      rule: {
        sigmaRuleYaml: `title: Brute force from one IP address
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`,
        groupByField: "principalIp",
        matchCountThreshold: 10,
        evaluationIntervalInMinutes: 5,
      },
      periodInHours: 24,
      serviceFilter: {},
      now: END_TIME,
    });

    expect(statements).toHaveLength(2);
    expect(result.firedCount).toBe(0);
    expect(result.uncounted).toEqual({
      field: "principalIp",
      eventCount: 12,
      hiddenInLogsCount: 12,
      hiddenInTracesCount: 0,
    });
  });
});

/*
 * A USER A SCRUB RULE HID IS NO USER TO COUNT BY (#10435). A rule that
 * counts per user - Repeated failed sign-ins for one account, fifteen per
 * user - leaves out the events whose user a rule redacted or masked: the
 * scans store them with no user now, and one stored before them, holding
 * "[REDACTED]", reads the same. Run on Past Events says how many of those a
 * rule hid, from the user's marker (ScrubbedUser).
 */
describe("a user a scrub rule hid (#10435)", () => {
  const BY_USER: DetectionRetrohuntCounting = {
    windowInMinutes: 15,
    threshold: 15,
    groupByField: "principalUser",
    distinctCountField: "",
  };

  test("a user column has a value only when it is not what Redact or Mask left", () => {
    for (const column of ["principalUser", "targetUser"]) {
      const statement: Statement = buildSigmaFieldHasValue(column);

      expect(statement.query).toBe(
        `(${column} != '' AND NOT (position(${column}, {p0:String}) > 0 OR position(${column}, {p1:String}) > 0))`,
      );
      expect(Object.values(statement.query_params)).toEqual([
        "[REDACTED]",
        "***",
      ]);
    }

    // Any other column says none as it did.
    expect(buildSigmaFieldHasValue("principalHost").query).toBe(
      "principalHost != ''",
    );
  });

  test("Run on Past Events counts the events whose user a rule hid, from the user's marker", () => {
    const statement: Statement | null = buildUncountedRetrohuntStatement({
      projectId: PROJECT_ID,
      tableName: "oneuptime.SecurityEvent",
      ruleWhere: SQL`statusName = ${{
        type: TableColumnType.Text,
        value: "Failure",
      }}`,
      counting: BY_USER,
      skipped: null,
      serviceFilter: {},
      startTime: START_TIME,
      endTime: END_TIME,
    });

    expect(statement).not.toBeNull();
    expect(Object.values(statement!.query_params)).toEqual(
      expect.arrayContaining([
        "oneuptime.principal_user_hidden",
        "scrub-rule",
        "oneuptime.principal_user_scrubbed_in",
        "trace",
      ]),
    );
    expect(Object.values(statement!.query_params)).not.toContain(
      "oneuptime.request.client_address_hidden",
    );
    expect(statement!.query).toContain(") AND NOT ((principalUser != ''");
  });

  test("each field reads its own marker: a target user its own, an address the address's", () => {
    expect(getHiddenValueMarker("targetUser")).toEqual({
      hiddenKey: "oneuptime.target_user_hidden",
      hiddenValue: "scrub-rule",
      inKey: "oneuptime.target_user_scrubbed_in",
      inTracesValue: "trace",
    });
    expect(getHiddenValueMarker("principalIp")).toEqual({
      hiddenKey: "oneuptime.request.client_address_hidden",
      hiddenValue: "scrub-rule",
      inKey: "oneuptime.request.client_address_scrubbed_in",
      inTracesValue: "span-attributes",
    });
  });

  test("the library's rules that count per user leave out the events with no user", () => {
    const byUser: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return entry.groupByField === "principalUser";
        },
      );

    expect(
      byUser.some((entry: DetectionRuleLibraryEntry): boolean => {
        return entry.title === "Repeated failed sign-ins for one account";
      }),
    ).toBe(true);

    for (const entry of byUser) {
      if ((entry.matchCountThreshold ?? 1) > 1) {
        expect([
          entry.title,
          doesDetectionRuleLeaveOutEventsWithNoValue(entry),
        ]).toEqual([entry.title, true]);
      }
    }
  });
});
