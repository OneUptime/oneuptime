import DetectionRuleRetrohunt, {
  DetectionRetrohuntCounting,
  buildSingleRuleRetrohuntStatement,
  getRetrohuntEntityType,
  readDetectionRetrohuntCounting,
  readSingleRuleRetrohuntRows,
  summarizeCorrelationRetrohunt,
  summarizeSingleRuleRetrohunt,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleRetrohunt";
import CorrelationRuleMatcher, {
  CorrelationMatchResult,
  CorrelationRuleMatchInput,
} from "../../../../Server/Utils/SecurityEvent/Correlation/CorrelationRuleMatcher";
import { CORRELATION_TEMPORAL_CANDIDATE_LIMIT } from "../../../../Server/Utils/SecurityEvent/Correlation/CorrelationQueries";
import ProjectSigmaRules from "../../../../Server/Utils/SecurityEvent/Correlation/ProjectSigmaRules";
import DetectionRuleExceptionService from "../../../../Server/Services/DetectionRuleExceptionService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import DetectionRuleException from "../../../../Models/DatabaseModels/DetectionRuleException";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RETROHUNT_MAX_GROUPS,
  DetectionRetrohuntResult,
} from "../../../../Types/SecurityEvent/DetectionRetrohunt";
import { DetectionRuleExceptionKind } from "../../../../Types/SecurityEvent/DetectionRuleException";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * RETROHUNT: A RULE RUN OVER PAST EVENTS, ON THE SERVER.
 *
 * How a run is counted (in windows as long as the rule's interval, each
 * group firing in a window when its count there reaches the threshold - as
 * the rule's runs fire), the one statement a single rule is read with, what
 * its rows say, and what run() reads and refuses. Nothing here writes: the
 * only reads are the statement, a correlation's matcher and the rule's
 * exceptions. App's DetectionRuleExceptionsClickhouse suite runs the
 * statement against real ClickHouse.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "34343434-3434-4434-8434-343434343434",
);
const RULE_ID: ObjectID = new ObjectID("45454545-4545-4545-8545-454545454545");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const WEEK_AGO: Date = new Date("2026-10-20T12:00:00.000Z");

const FAILED_SIGN_IN_YAML: string = `title: Failed sign-in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

const CORRELATION_YAML: string = `title: Brute force then success
correlation:
  type: temporal_ordered
  rules: [failed_sign_in, successful_sign_in]
  group-by: [principalIp]
  timespan: 10m
---
title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    statusName: Failure
  condition: selection
---
title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    statusName: Success
  condition: selection`;

const COUNTING: DetectionRetrohuntCounting = {
  windowInMinutes: 5,
  threshold: 3,
  groupByField: "principalUser",
  distinctCountField: "",
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how a run is counted", () => {
  test("a rule's own interval, threshold and fields; a minute and one match for a form that says none", () => {
    expect(
      readDetectionRetrohuntCounting({
        sigmaRuleYaml: FAILED_SIGN_IN_YAML,
        evaluationIntervalInMinutes: 15,
        matchCountThreshold: 10,
        groupByField: " principalIp ",
        distinctCountField: " principalUser ",
      }),
    ).toEqual({
      windowInMinutes: 15,
      threshold: 10,
      groupByField: "principalIp",
      distinctCountField: "principalUser",
    });

    expect(
      readDetectionRetrohuntCounting({ sigmaRuleYaml: FAILED_SIGN_IN_YAML }),
    ).toEqual({
      windowInMinutes: 1,
      threshold: 1,
      groupByField: "",
      distinctCountField: "",
    });
  });

  test.each([
    [{ evaluationIntervalInMinutes: 0 }, "Evaluation interval"],
    [{ evaluationIntervalInMinutes: 1441 }, "Evaluation interval"],
    [{ evaluationIntervalInMinutes: 2.5 }, "Evaluation interval"],
    [{ matchCountThreshold: 0 }, "Match count threshold"],
    [{ matchCountThreshold: 1000001 }, "Match count threshold"],
    [{ matchCountThreshold: 1.5 }, "Match count threshold"],
  ])(
    "a value a save refuses is refused here too: %o",
    (values: JSONObject, words: string) => {
      expect(() => {
        readDetectionRetrohuntCounting({
          sigmaRuleYaml: FAILED_SIGN_IN_YAML,
          ...values,
        });
      }).toThrow(words);
    },
  );
});

describe("the single rule's statement", () => {
  function statement(
    overrides: Partial<{
      counting: DetectionRetrohuntCounting;
      skipped: Statement | null;
    }> = {},
  ): Statement {
    return buildSingleRuleRetrohuntStatement({
      projectId: PROJECT_ID,
      tableName: "oneuptime.SecurityEvent",
      ruleWhere: SQL`statusName = ${{ type: "Text" as never, value: "Failure" }}`,
      counting: overrides.counting || COUNTING,
      skipped: overrides.skipped === undefined ? null : overrides.skipped,
      serviceFilter: {},
      startTime: WEEK_AGO,
      endTime: NOW,
      maxGroups: DETECTION_RETROHUNT_MAX_GROUPS + 1,
    });
  }

  test("counts per window as long as the rule's interval, and per group", () => {
    const query: string = statement().query;

    expect(query).toContain(
      "toStartOfInterval(time, toIntervalMinute({p0:Int32})) AS __window",
    );
    expect(query).toContain("toString(principalUser) AS __group");
    expect(query).toContain("GROUP BY __window, __group");
    expect(statement().query_params["p0"]).toBe(5);
  });

  test("a group fires in a window when its count there reaches the threshold - with the exceptions, and without them", () => {
    const query: string = statement().query;

    expect(query).toContain("(__kept > 0 AND __keptDistinct >= {p1:Int32}) AS __fired");
    expect(query).toContain("(__all > 0 AND __allDistinct >= {p2:Int32}) AS __firedWithout");
    expect(query).toContain("__kept AS __keptDistinct, __all AS __allDistinct");
    expect(statement().query_params["p1"]).toBe(3);
    expect(statement().query_params["p2"]).toBe(3);
  });

  test("a distinct count field counts its distinct values, empty ones left out", () => {
    const query: string = statement({
      counting: { ...COUNTING, distinctCountField: "targetUser" },
    }).query;

    expect(query).toContain("uniqExactIf(nullIf(");
    expect(query).toContain("NOT __skipped) AS __keptDistinct");
    expect(query).toContain("uniqExact(nullIf(");
  });

  test("a rule with no group by field is one group of every match", () => {
    expect(
      statement({ counting: { ...COUNTING, groupByField: "" } }).query,
    ).toContain("'' AS __group");
  });

  test("the exceptions decide what is skipped; with none, nothing is", () => {
    expect(statement().query).toContain("WITH false AS __skipped");

    const withExceptions: Statement = statement({
      skipped: SQL`principalUser = ${{ type: "Text" as never, value: "svc" }}`,
    });

    expect(withExceptions.query).toContain(
      "WITH (principalUser = {p0:String}) AS __skipped",
    );
    expect(withExceptions.query).toContain("countIf(NOT __skipped) AS __kept");
    expect(withExceptions.query).toContain("anyIf(message, NOT __skipped)");
  });

  test("reads only the project's events in the period, matching the rule", () => {
    const built: Statement = statement();

    expect(built.query).toContain("FROM oneuptime.SecurityEvent WHERE projectId = ");
    expect(built.query).toContain("AND time >= ");
    expect(built.query).toContain("AND time < ");
    expect(built.query).toContain("AND (statusName = ");
    expect(Object.values(built.query_params)).toContain("Failure");
  });

  test("per group: the windows it fired in, the events behind them, the firings prevented, the events skipped and every match", () => {
    const query: string = statement().query;

    expect(query).toContain("countIf(__fired) AS firedCount");
    expect(query).toContain("sumIf(__kept, __fired) AS eventCount");
    expect(query).toContain("minIf(__window, __fired) AS firstFiredAt");
    expect(query).toContain("maxIf(__window, __fired) AS lastFiredAt");
    expect(query).toContain("countIf(__firedWithout AND NOT __fired) AS preventedCount");
    expect(query).toContain("sum(__all - __kept) AS skippedCount");
    expect(query).toContain("sum(__kept) AS matchedCount");
  });

  test("the totals cover every group, and the ones that fired most come first", () => {
    const built: Statement = statement();

    expect(built.query).toContain("sum(firedCount) OVER () AS totalFired");
    expect(built.query).toContain("countIf(firedCount > 0) OVER () AS totalGroups");
    expect(built.query).toContain("sum(matchedCount) OVER () AS totalMatched");
    expect(built.query).toContain(
      "ORDER BY firedCount DESC, eventCount DESC, groupValue ASC LIMIT ",
    );
    expect(Object.values(built.query_params)).toContain(
      DETECTION_RETROHUNT_MAX_GROUPS + 1,
    );
  });

  test("stops at the interactive read limit, as a timeout the API answers with 504", () => {
    expect(statement().query).toContain("max_execution_time = 45");
    expect(statement().query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("reads only the sources the person may read", () => {
    const narrowed: Statement = buildSingleRuleRetrohuntStatement({
      projectId: PROJECT_ID,
      tableName: "oneuptime.SecurityEvent",
      ruleWhere: SQL`1 = 1`,
      counting: COUNTING,
      skipped: null,
      serviceFilter: {
        serviceIds: [new ObjectID("56565656-5656-4656-8656-565656565656")],
      },
      startTime: WEEK_AGO,
      endTime: NOW,
      maxGroups: 10,
    });

    expect(narrowed.query).toContain("primaryEntityId");
  });
});

describe("what a single rule's rows say", () => {
  function row(values: JSONObject): JSONObject {
    return {
      groupValue: "",
      firedCount: 0,
      eventCount: 0,
      firstFiredAt: "1970-01-01 00:00:00",
      lastFiredAt: "1970-01-01 00:00:00",
      sampleMessage: "",
      preventedCount: 0,
      skippedCount: 0,
      matchedCount: 0,
      totalFired: 31,
      totalGroups: 2,
      totalEvents: 97,
      totalPrevented: 4,
      totalSkipped: 12,
      totalMatched: 140,
      ...values,
    };
  }

  test("ClickHouse's numbers as text and times without a zone are read as numbers and UTC times", () => {
    const [first] = readSingleRuleRetrohuntRows([
      row({
        groupValue: "alice",
        firedCount: "30",
        eventCount: "90",
        firstFiredAt: "2026-10-21 03:05:00",
        lastFiredAt: "2026-10-27 09:40:00.000000000",
      }),
    ]);

    expect(first!.firedCount).toBe(30);
    expect(first!.eventCount).toBe(90);
    expect(first!.firstFiredAt).toEqual(new Date("2026-10-21T03:05:00.000Z"));
    expect(first!.lastFiredAt).toEqual(new Date("2026-10-27T09:40:00.000Z"));
  });

  test("the epoch - what minIf answers for a group that never fired - is no time", () => {
    const [first] = readSingleRuleRetrohuntRows([row({})]);

    expect(first!.firstFiredAt).toBeNull();
    expect(first!.lastFiredAt).toBeNull();
  });

  test("lists the groups that fired, most first; counts the others in the totals only", () => {
    const result: DetectionRetrohuntResult = summarizeSingleRuleRetrohunt({
      rows: readSingleRuleRetrohuntRows([
        row({
          groupValue: "alice@example.com",
          firedCount: 30,
          eventCount: 90,
          sampleMessage: "Failed sign-in for alice",
          lastFiredAt: "2026-10-27 09:40:00",
        }),
        row({ groupValue: "10.0.0.5", firedCount: 1, eventCount: 7 }),
        // Kept from firing by the exceptions, or never enough: not listed.
        row({ groupValue: "svc-backup", preventedCount: 4, skippedCount: 12 }),
      ]),
      counting: COUNTING,
      exceptionCount: 2,
      startTime: WEEK_AGO,
      endTime: NOW,
      periodInHours: 168,
      maxGroups: DETECTION_RETROHUNT_MAX_GROUPS,
    });

    expect(result).toMatchObject({
      isCorrelation: false,
      windowInMinutes: 5,
      threshold: 3,
      firedCount: 31,
      groupCount: 2,
      eventCount: 97,
      matchedEventCount: 140,
      exceptionCount: 2,
      skippedEventCount: 12,
      preventedFiredCount: 4,
      hasMoreGroups: false,
      candidateLimit: null,
    });
    expect(
      result.groups.map((group: { value: string }): string => {
        return group.value;
      }),
    ).toEqual(["alice@example.com", "10.0.0.5"]);
    expect(result.groups[0]!.entityType).toBe(SecurityEntityType.User);
    expect(result.groups[0]!.sampleMessage).toBe("Failed sign-in for alice");
    expect(result.groups[0]!.lastFiredAt).toEqual(
      new Date("2026-10-27T09:40:00.000Z"),
    );
  });

  test("more groups fired than it lists: it says so", () => {
    const rows: Array<JSONObject> = [];

    for (let index: number = 0; index < 4; index++) {
      rows.push(
        row({
          groupValue: `user-${index}`,
          firedCount: 10 - index,
          totalGroups: 7,
        }),
      );
    }

    const result: DetectionRetrohuntResult = summarizeSingleRuleRetrohunt({
      rows: readSingleRuleRetrohuntRows(rows),
      counting: COUNTING,
      exceptionCount: 0,
      startTime: WEEK_AGO,
      endTime: NOW,
      periodInHours: 168,
      maxGroups: 3,
    });

    expect(result.groups).toHaveLength(3);
    expect(result.groupCount).toBe(7);
    expect(result.hasMoreGroups).toBe(true);
  });

  test("no rows: it would not have fired, and matched nothing", () => {
    const result: DetectionRetrohuntResult = summarizeSingleRuleRetrohunt({
      rows: [],
      counting: COUNTING,
      exceptionCount: 0,
      startTime: WEEK_AGO,
      endTime: NOW,
      periodInHours: 168,
      maxGroups: DETECTION_RETROHUNT_MAX_GROUPS,
    });

    expect(result).toMatchObject({
      firedCount: 0,
      groupCount: 0,
      eventCount: 0,
      matchedEventCount: 0,
      skippedEventCount: 0,
      preventedFiredCount: 0,
      groups: [],
      hasMoreGroups: false,
    });
  });
});

describe("the kind of entity a group is", () => {
  test("by the field the rule groups by, else by the value's shape", () => {
    expect(getRetrohuntEntityType("principalHost", "alice")).toBe(
      SecurityEntityType.Host,
    );
    expect(getRetrohuntEntityType(undefined, "10.0.0.5")).toBe(
      SecurityEntityType.IpAddress,
    );
    expect(getRetrohuntEntityType("", "alice@example.com")).toBe(
      SecurityEntityType.User,
    );
    expect(getRetrohuntEntityType("principalUser", "")).toBe("");
  });

  test("a value that is nothing in particular is no kind", () => {
    expect(getRetrohuntEntityType("targetResource", "/api/login")).toBe("");
  });
});

describe("what a correlation's groups say", () => {
  function correlationResult(
    groupCount: number,
    candidatesCapped: boolean,
  ): CorrelationMatchResult {
    const groups: CorrelationMatchResult["groups"] = [];

    for (let index: number = 0; index < groupCount; index++) {
      groups.push({
        groupValue: `203.0.113.${index}`,
        matchCount: 6,
        distinctCount: 0,
        sampleMessage: "Accepted password",
        sampleObservables: [],
        groupFields: [{ field: "principalIp", value: `203.0.113.${index}` }],
        summary: "Failed sign-in, then Successful sign-in, 2 minutes apart",
      });
    }

    return { groups, readFrom: WEEK_AGO, candidatesCapped };
  }

  test("each group fired once, with its sentence; no exceptions to compare", () => {
    const result: DetectionRetrohuntResult = summarizeCorrelationRetrohunt({
      match: correlationResult(2, false),
      exceptionCount: 1,
      startTime: WEEK_AGO,
      endTime: NOW,
      periodInHours: 168,
      maxGroups: DETECTION_RETROHUNT_MAX_GROUPS,
      groupByFields: ["principalIp"],
    });

    expect(result).toMatchObject({
      isCorrelation: true,
      windowInMinutes: 0,
      threshold: null,
      firedCount: 2,
      groupCount: 2,
      eventCount: 12,
      matchedEventCount: null,
      exceptionCount: 1,
      skippedEventCount: null,
      preventedFiredCount: null,
      hasMoreGroups: false,
      candidateLimit: null,
    });
    expect(result.groups[0]).toMatchObject({
      value: "203.0.113.0",
      entityType: SecurityEntityType.IpAddress,
      firedCount: 1,
      eventCount: 6,
      summary: "Failed sign-in, then Successful sign-in, 2 minutes apart",
    });
  });

  test("a read that had more groups than it may check says how many it checked", () => {
    const result: DetectionRetrohuntResult = summarizeCorrelationRetrohunt({
      match: correlationResult(3, true),
      exceptionCount: 0,
      startTime: WEEK_AGO,
      endTime: NOW,
      periodInHours: 168,
      maxGroups: 2,
      groupByFields: ["principalIp"],
    });

    expect(result.candidateLimit).toBe(CORRELATION_TEMPORAL_CANDIDATE_LIMIT);
    expect(result.groups).toHaveLength(2);
    expect(result.firedCount).toBe(2);
    expect(result.hasMoreGroups).toBe(true);
  });
});

describe("a run", () => {
  function scannerException(): DetectionRuleException {
    const exception: DetectionRuleException = new DetectionRuleException();
    exception._id = "67676767-6767-4767-8767-676767676767";
    exception.detectionRuleId = RULE_ID;
    exception.kind = DetectionRuleExceptionKind.Entity;
    exception.entityType = SecurityEntityType.IpAddress;
    exception.value = "10.9.9.9";
    return exception;
  }

  function stubQuery(rows: Array<JSONObject>): Spy {
    return getJestSpyOn(SecurityEventService, "executeQuery").mockResolvedValue(
      {
        json: async (): Promise<JSONObject> => {
          return { data: rows };
        },
      } as never,
    );
  }

  test("a period other than a day, a week or a month is refused", async () => {
    await expect(
      DetectionRuleRetrohunt.run({
        projectId: PROJECT_ID,
        rule: { sigmaRuleYaml: FAILED_SIGN_IN_YAML },
        periodInHours: 48,
        serviceFilter: {},
        now: NOW,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("a rule with no YAML, or one a save would refuse, is answered with what to change", async () => {
    await expect(
      DetectionRuleRetrohunt.run({
        projectId: PROJECT_ID,
        rule: { sigmaRuleYaml: "  " },
        periodInHours: 168,
        serviceFilter: {},
        now: NOW,
      }),
    ).rejects.toThrow("Sigma rule YAML is required.");

    await expect(
      DetectionRuleRetrohunt.run({
        projectId: PROJECT_ID,
        rule: {
          sigmaRuleYaml: `title: Broken
detection:
  selection:
    statusName|nosuchmodifier: Failure
  condition: selection`,
        },
        periodInHours: 168,
        serviceFilter: {},
        now: NOW,
      }),
    ).rejects.toThrow();
  });

  test("a saved rule's exceptions skip what they name; the period ends now", async () => {
    const findAll: Spy = getJestSpyOn(
      DetectionRuleExceptionService,
      "findAllBy",
    ).mockResolvedValue([scannerException()] as never);
    const query: Spy = stubQuery([]);

    const result: DetectionRetrohuntResult = await DetectionRuleRetrohunt.run({
      projectId: PROJECT_ID,
      rule: {
        id: RULE_ID,
        sigmaRuleYaml: FAILED_SIGN_IN_YAML,
        groupByField: "principalIp",
        matchCountThreshold: 5,
        evaluationIntervalInMinutes: 10,
      },
      periodInHours: 24,
      serviceFilter: {},
      now: NOW,
    });

    expect(findAll).toHaveBeenCalledTimes(1);

    const statement: Statement = query.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain("WITH (((((lowerUTF8(principalIp) = ");
    expect(statement.query).toContain(") AS __skipped SELECT ");
    expect(Object.values(statement.query_params)).toContain("10.9.9.9");
    expect(result.exceptionCount).toBe(1);
    expect(result.startTime).toEqual(new Date("2026-10-26T12:00:00.000Z"));
    expect(result.endTime).toEqual(NOW);
    expect(result.windowInMinutes).toBe(10);
    expect(result.threshold).toBe(5);
  });

  test("a rule not saved yet has no exceptions to read", async () => {
    const findAll: Spy = getJestSpyOn(
      DetectionRuleExceptionService,
      "findAllBy",
    ).mockResolvedValue([] as never);
    const query: Spy = stubQuery([]);

    const result: DetectionRetrohuntResult = await DetectionRuleRetrohunt.run({
      projectId: PROJECT_ID,
      rule: { sigmaRuleYaml: FAILED_SIGN_IN_YAML },
      periodInHours: 168,
      serviceFilter: {},
      now: NOW,
    });

    expect(findAll).not.toHaveBeenCalled();
    expect((query.mock.calls[0]![0] as Statement).query).toContain(
      "WITH false AS __skipped",
    );
    expect(result.exceptionCount).toBe(0);
  });

  test("a correlation is read by its matcher, over the whole period, with the exceptions and the person's sources", async () => {
    getJestSpyOn(DetectionRuleExceptionService, "findAllBy").mockResolvedValue(
      [scannerException()] as never,
    );
    const query: Spy = stubQuery([]);
    const findMatches: Spy = getJestSpyOn(
      CorrelationRuleMatcher,
      "findMatches",
    ).mockResolvedValue({
      groups: [],
      readFrom: WEEK_AGO,
      candidatesCapped: false,
    } as never);

    const result: DetectionRetrohuntResult = await DetectionRuleRetrohunt.run({
      projectId: PROJECT_ID,
      rule: { id: RULE_ID, sigmaRuleYaml: CORRELATION_YAML },
      periodInHours: 168,
      serviceFilter: {
        excludedServiceIds: [new ObjectID("78787878-7878-4878-8878-787878787878")],
      },
      now: NOW,
    });

    expect(query).not.toHaveBeenCalled();

    const input: CorrelationRuleMatchInput = findMatches.mock
      .calls[0]![0] as CorrelationRuleMatchInput;

    expect(input.startTime).toEqual(WEEK_AGO);
    expect(input.endTime).toEqual(NOW);
    expect(input.maxGroups).toBe(DETECTION_RETROHUNT_MAX_GROUPS + 1);
    expect(input.restrictTo!.query).toContain("primaryEntityId");
    expect(input.restrictTo!.query).toContain("NOT ((");
    expect(result.isCorrelation).toBe(true);
    expect(result.exceptionCount).toBe(1);
  });

  test("a correlation naming the project's rules reads them, never the rule itself", async () => {
    const load: Spy = getJestSpyOn(ProjectSigmaRules, "load").mockResolvedValue(
      (() => {
        return undefined;
      }) as never,
    );

    await expect(
      DetectionRuleRetrohunt.run({
        projectId: PROJECT_ID,
        rule: {
          id: RULE_ID,
          sigmaRuleYaml: `title: Two of ours
correlation:
  type: temporal
  rules: [rule_one, rule_two]
  group-by: [principalUser]
  timespan: 5m`,
        },
        periodInHours: 24,
        serviceFilter: {},
        now: NOW,
      }),
    ).rejects.toThrow();

    expect(load).toHaveBeenCalledWith(PROJECT_ID, { excludeRuleId: RULE_ID });
  });
});
