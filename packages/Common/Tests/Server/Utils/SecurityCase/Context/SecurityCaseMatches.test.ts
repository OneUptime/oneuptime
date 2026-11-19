import DetectionRule from "../../../../../Models/DatabaseModels/DetectionRule";
import SecurityDetection from "../../../../../Models/DatabaseModels/SecurityDetection";
import DetectionRuleService from "../../../../../Server/Services/DetectionRuleService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../../Server/Services/SecurityDetectionService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../../Server/Utils/Logger";
import SecurityCaseMatches, {
  buildFallbackLookup,
  buildMatchWhere,
  buildMatchedEventsStatement,
  buildMatchedOutcomesStatement,
  buildRuleCondition,
  getGroupValues,
  getKeptEventsForReader,
  getRuleResponseSteps,
  isKeptEventReadable,
  pickDetectionsToExplain,
  readOutcomeRows,
  toMatchRule,
} from "../../../../../Server/Utils/SecurityCase/Context/SecurityCaseMatches";
import TelemetryReadAccess from "../../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SECURITY_CASE_MATCHES_MAX_DETECTIONS,
  SECURITY_CASE_MATCHES_MAX_EVENTS,
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
  SecurityCaseMatchesSource,
} from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityDetectionSource from "../../../../../Types/SecurityCase/SecurityDetectionSource";
import { DETECTION_RULE_LIBRARY } from "../../../../../Types/SecurityEvent/DetectionRuleLibrary";
import { getDetectionRuleLibraryResponseSteps } from "../../../../../Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import {
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
} from "../../../../../Types/SecurityEvent/DetectionRuleResponseSteps";
import { buildSecurityDetectionMatchedEvent } from "../../../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import SigmaRuleSetParser from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Why a case was opened, and what matched (#9556): the detection that
 * opened the case and the latest others, each with the events it matched -
 * a rule's own condition for its group over the windows it fired in, a
 * feed's indicator, a product's alert, or what it is about - read with the
 * reader's own permissions, a refusal or a failure said, never an empty
 * list that reads as "nothing matched".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RULE_ID: string = "33333333-3333-4333-8333-333333333333";
const DETECTION_ID: string = "44444444-4444-4444-8444-444444444444";
const LATER_ID: string = "55555555-5555-4555-8555-555555555555";
const FEED_ID: string = "66666666-6666-4666-8666-666666666666";
const CONNECTION_ID: string = "77777777-7777-4777-8777-777777777777";
const SERVICE_ID: string = "88888888-8888-4888-8888-888888888888";

const FIRED: Date = new Date("2026-11-17T19:28:00.000Z");
const NOW: Date = new Date("2026-11-17T21:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("99999999-9999-4999-8999-999999999999"),
  tenantId: PROJECT_ID,
};

const PATH_TRAVERSAL_YAML: string = `${
  DETECTION_RULE_LIBRARY.find((entry: { title: string }): boolean => {
    return entry.title === "Path traversal attempts";
  })!.sigmaRuleYaml
}falsepositives:
  - Vulnerability scanners your team runs
references:
  - https://owasp.org/www-community/attacks/Path_Traversal
`;

const CORRELATION_YAML: string = `title: Failed sign-in
id: 6d4c1f90-4f3d-4e55-9b71-2d0d7c8a1a01
name: failed_sign_in
level: low
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
---
title: Successful sign-in
id: 6d4c1f90-4f3d-4e55-9b71-2d0d7c8a1a02
name: successful_sign_in
level: low
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection
---
title: Failed then successful sign-in
id: 6d4c1f90-4f3d-4e55-9b71-2d0d7c8a1a03
level: high
correlation:
  type: temporal_ordered
  rules:
    - failed_sign_in
    - successful_sign_in
  group-by:
    - principalIp
  timespan: 10m
`;

function withId<T extends { _id?: string | undefined }>(
  model: T,
  id: string,
): T {
  model._id = id;
  return model;
}

function ruleRow(overrides: Partial<DetectionRule> = {}): DetectionRule {
  const rule: DetectionRule = withId(new DetectionRule(), RULE_ID);
  rule.name = "Path traversal attempts";
  rule.description =
    "Three or more requests from one IP address within five minutes trying to climb out of the web root with ../ sequences.";
  rule.sigmaRuleYaml = PATH_TRAVERSAL_YAML;
  rule.isEnabled = true;
  rule.isRealTime = false;
  rule.groupByField = "principalIp";
  rule.matchCountThreshold = 3;
  rule.evaluationIntervalInMinutes = 5;
  Object.assign(rule, overrides);
  return rule;
}

/*
 * A detection's fields to set over the defaults. A key given as undefined
 * clears its default (Object.assign copies it): a threat-intel match has no
 * detection rule.
 */
type DetectionOverrides = {
  [Key in keyof SecurityDetection]?: SecurityDetection[Key] | undefined;
};

function detectionRow(
  overrides: DetectionOverrides = {},
  id: string = DETECTION_ID,
): SecurityDetection {
  const detection: SecurityDetection = withId(new SecurityDetection(), id);
  detection.title = "Path traversal attempts — 35.196.249.14";
  detection.severity = OcsfSeverity.Medium;
  detection.source = SecurityDetectionSource.DetectionRule;
  detection.ruleName = "Path traversal attempts";
  detection.groupValue = "35.196.249.14";
  detection.entities = [
    { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
  ] as never;
  detection.eventCount = 12;
  detection.fireCount = 1;
  detection.firstSeenAt = FIRED;
  detection.lastSeenAt = FIRED;
  detection.sampleMessage = "Path traversal attempt: GET /x → 404";
  detection.eventUid = "detection:finding:1";
  detection.detectionRuleId = new ObjectID(RULE_ID);
  Object.assign(detection, overrides);
  return detection;
}

function eventRow(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-11-17 19:22:14.000000000",
    eventUid: "log:abc:0",
    primaryEntityId: SERVICE_ID,
    severityName: "Medium",
    className: "HTTP Activity",
    categoryName: "Application Activity",
    activityName: "Get",
    statusName: "Failure",
    message:
      "Path traversal attempt: GET /api/w/admins/jobs_u/get_log_file/../../../../proc/self/environ → 404",
    vendorName: "OneUptime",
    productName: "Your logs",
    ruleName: "",
    principalUser: "",
    principalHost: "",
    principalIp: "35.196.249.14",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    processName: "",
    processCommandLine: "",
    observables: ["35.196.249.14"],
    mitreTactics: [],
    mitreTechniques: [],
    attributes: {
      "oneuptime.log.id": "abc",
      "http.request.method": "GET",
      "http.response.status_code": "404",
    },
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    sessionId: "",
    requestOutcome: "Rejected",
    ...overrides,
  };
}

let detections: Array<SecurityDetection>;
let rules: Array<DetectionRule>;
let eventRows: Array<JSONObject>;
let outcomeRows: Array<JSONObject>;
let statements: Array<Statement>;
let ruleRead: jest.SpyInstance;
let executeQuery: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});

  detections = [detectionRow()];
  rules = [ruleRow()];
  eventRows = [
    eventRow(),
    eventRow({
      time: "2026-11-17 19:22:15.000000000",
      eventUid: "log:abc:1",
      message: "Path traversal attempt: GET /..%2f..%2fetc/passwd → 404",
    }),
  ];
  outcomeRows = [{ requestOutcome: "Rejected", matched: "12" }];
  statements = [];

  jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
    _id: CASE_ID.toString(),
    id: CASE_ID,
    projectId: PROJECT_ID,
    entities: [{ type: SecurityEntityType.IpAddress, value: "35.196.249.14" }],
    createdAt: FIRED,
    firstDetectedAt: FIRED,
    lastDetectedAt: FIRED,
    detectionCount: 1,
  } as never);

  jest
    .spyOn(SecurityDetectionService, "findBy")
    .mockImplementation(async (): Promise<Array<SecurityDetection>> => {
      return detections;
    });

  ruleRead = jest
    .spyOn(DetectionRuleService, "findBy")
    .mockImplementation(async (): Promise<Array<DetectionRule>> => {
      return rules;
    });

  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockResolvedValue({} as never);

  executeQuery = jest
    .spyOn(SecurityEventService, "executeQuery")
    .mockImplementation(async (statement: unknown): Promise<never> => {
      const read: Statement = statement as Statement;
      statements.push(read);
      const isTally: boolean = read.query.includes("GROUP BY requestOutcome");

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

async function matches(): Promise<SecurityCaseMatchesJson> {
  const answer: SecurityCaseMatchesJson | null =
    await SecurityCaseMatches.build({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      props: CALLER,
      now: NOW,
    });

  expect(answer).not.toBeNull();

  return answer!;
}

function eventsStatement(): Statement {
  const found: Statement | undefined = statements.find(
    (statement: Statement): boolean => {
      return statement.query.includes("ORDER BY time ASC");
    },
  );

  expect(found).toBeDefined();

  return found!;
}

describe("a case it may not read", () => {
  test("is no case", async () => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue(null);

    expect(
      await SecurityCaseMatches.build({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
        now: NOW,
      }),
    ).toBeNull();
    expect(executeQuery).not.toHaveBeenCalled();
  });
});

describe("a detection rule's detection", () => {
  test("says how the rule counts, its own guidance and what it looks for", async () => {
    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.isOpening).toBe(true);
    expect(detection.basis).toBe(SecurityCaseMatchBasis.RuleCondition);
    expect(detection.rule).toMatchObject({
      id: RULE_ID,
      name: "Path traversal attempts",
      isEnabled: true,
      isRealTime: false,
      isCorrelation: false,
      threshold: 3,
      groupByField: "principalIp",
      distinctCountField: "",
      windowInMinutes: 5,
      falsePositives: ["Vulnerability scanners your team runs"],
      references: ["https://owasp.org/www-community/attacks/Path_Traversal"],
    });
    expect(detection.rule!.lookFor).toEqual([
      {
        field: "targetResource",
        values: ["../../", "..%2f", "%2e%2e%2f", "/etc/passwd"],
      },
    ]);
  });

  test("reads exactly what it matched: its condition, for its group, over the window it fired in", async () => {
    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    // A five-minute window before it fired, and a minute either side.
    expect(detection.windowStart).toBe("2026-11-17T19:22:00.000Z");
    expect(detection.windowEnd).toBe("2026-11-17T19:29:00.000Z");

    const statement: Statement = eventsStatement();

    expect(statement.query).toContain("targetResource");
    expect(statement.query).toContain("principalIp = ");
    expect(JSON.stringify(statement.query_params)).toContain("35.196.249.14");
    // The rule's own matches: a finding the rule matches is one of them.
    expect(statement.query).not.toContain("classUid NOT IN");
    expect(statement.query).toContain(
      `LIMIT {p${Object.keys(statement.query_params).length - 1}:Int32}`,
    );
    expect(
      Object.values(statement.query_params)[
        Object.keys(statement.query_params).length - 1
      ],
    ).toBe(SECURITY_CASE_MATCHES_MAX_EVENTS);
    expect(statement.query).toContain("max_execution_time");
  });

  test("lists the events with the request each happened in, and counts them by how far they got", async () => {
    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.matchedEventCount).toBe(12);
    expect(detection.outcomes).toEqual({ Rejected: 12 });
    expect(detection.events).toHaveLength(2);
    expect(detection.events[0]).toMatchObject({
      time: "2026-11-17T19:22:14.000Z",
      eventUid: "log:abc:0",
      sourceId: SERVICE_ID,
      principalIp: "35.196.249.14",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      requestOutcome: "Rejected",
    });
    expect(detection.events[0]!.attributes["oneuptime.log.id"]).toBe("abc");
  });

  test("never counts fewer than it lists", async () => {
    outcomeRows = [];

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.matchedEventCount).toBe(2);
  });

  test("lists at most its bound of events", async () => {
    eventRows = Array.from(
      { length: SECURITY_CASE_MATCHES_MAX_EVENTS + 1 },
      (_: unknown, index: number): JSONObject => {
        return eventRow({ eventUid: `log:abc:${index}` });
      },
    );

    expect((await matches()).detections[0]!.events).toHaveLength(
      SECURITY_CASE_MATCHES_MAX_EVENTS,
    );
  });

  test("reads a rule that does not group for every match it made", () => {
    const condition: ReturnType<typeof buildRuleCondition> = buildRuleCondition(
      {
        rule: { groupByField: "" },
        definition: SigmaRuleSetParser.parse(PATH_TRAVERSAL_YAML),
        groupValue: "35.196.249.14",
      },
    );

    expect(condition!.basis).toBe(SecurityCaseMatchBasis.RuleCondition);
    expect(condition!.condition.query).not.toContain("principalIp");
  });

  test("reads a correlation's rules, naming its group, over its timespan and its interval", async () => {
    rules = [
      ruleRow({
        name: "Failed then successful sign-in",
        sigmaRuleYaml: CORRELATION_YAML,
        groupByField: "",
        matchCountThreshold: 1,
        evaluationIntervalInMinutes: 5,
      }),
    ];
    detections = [detectionRow({ groupValue: "203.0.113.7" })];

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.basis).toBe(SecurityCaseMatchBasis.CorrelationSteps);
    expect(detection.rule!.isCorrelation).toBe(true);
    // Ten minutes it looks across, five it reads, and a minute of slack.
    expect(detection.windowStart).toBe("2026-11-17T19:12:00.000Z");

    const statement: Statement = eventsStatement();

    expect(statement.query).toContain(" OR ");
    expect(statement.query).toContain("hasAny(observables");
    expect(JSON.stringify(statement.query_params)).toContain("203.0.113.7");
  });

  test("falls back to what it is about when its rule no longer reads", async () => {
    rules = [ruleRow({ sigmaRuleYaml: "title: [unclosed" })];

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.rule).not.toBeNull();
    expect(detection.rule!.lookFor).toEqual([]);
    expect(detection.basis).toBe(SecurityCaseMatchBasis.NamedEntities);
    expect(eventsStatement().query).toContain("hasAny(observables");
    expect(eventsStatement().query).toContain("classUid NOT IN (2004, 2005)");
  });

  test("says the rules are not the reader's to read, and still explains the detection", async () => {
    ruleRead.mockRejectedValue(new NotAuthorizedException("No."));

    const answer: SecurityCaseMatchesJson = await matches();

    expect(answer.unreadableSources).toEqual([SecurityCaseMatchesSource.Rules]);
    expect(answer.detections[0]!.rule).toBeNull();
    expect(answer.detections[0]!.basis).toBe(
      SecurityCaseMatchBasis.NamedEntities,
    );
    expect(answer.detections[0]!.events).toHaveLength(2);
  });
});

describe("the other sources", () => {
  test("a threat-intel match reads the events carrying its indicator", async () => {
    detections = [
      detectionRow({
        source: SecurityDetectionSource.ThreatIntel,
        detectionRuleId: undefined,
        threatIntelFeedId: new ObjectID(FEED_ID),
        ruleName: "Abuse IPs",
      }),
    ];

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(ruleRead).not.toHaveBeenCalled();
    expect(detection.basis).toBe(SecurityCaseMatchBasis.Indicator);
    expect(detection.threatIntelFeedId).toBe(FEED_ID);
    expect(eventsStatement().query).toContain("hasAny(observables");
    expect(eventsStatement().query).toContain("classUid NOT IN (2004, 2005)");
  });

  test("a connected product's alert reads the event it was recorded as", async () => {
    detections = [
      detectionRow({
        source: SecurityDetectionSource.ConnectedProduct,
        detectionRuleId: undefined,
        securityEventConnectionId: new ObjectID(CONNECTION_ID),
        eventUid: "crowdstrike:alert:9",
        groupValue: "",
      }),
    ];

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.basis).toBe(SecurityCaseMatchBasis.RecordedEvent);
    expect(detection.securityEventConnectionId).toBe(CONNECTION_ID);
    expect(eventsStatement().query).toContain("eventUid = ");
    expect(JSON.stringify(eventsStatement().query_params)).toContain(
      "crowdstrike:alert:9",
    );
  });

  test("a detection that names nothing to look up reads no events, and says it could not", async () => {
    detections = [
      detectionRow({
        source: SecurityDetectionSource.EntityRisk,
        detectionRuleId: undefined,
        groupValue: "",
        entities: [] as never,
      }),
    ];

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.basis).toBe(SecurityCaseMatchBasis.NamedEntities);
    expect(detection.windowStart).toBeNull();
    expect(detection.events).toEqual([]);
    expect(detection.matchedEventCount).toBeNull();
    expect(executeQuery).not.toHaveBeenCalled();
  });
});

describe("what the reader may not read, and what fails", () => {
  test("events the reader's role cannot read are said to be, never an empty list", async () => {
    jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockRejectedValue(new NotAuthorizedException("No."));

    const answer: SecurityCaseMatchesJson = await matches();

    expect(answer.unreadableSources).toEqual([
      SecurityCaseMatchesSource.Events,
    ]);
    expect(answer.detections[0]!.matchedEventCount).toBeNull();
    expect(answer.detections[0]!.events).toEqual([]);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("events that could not be read are said to have failed", async () => {
    executeQuery.mockRejectedValue(new Error("ClickHouse is down"));

    const answer: SecurityCaseMatchesJson = await matches();

    expect(answer.failedSources).toEqual([SecurityCaseMatchesSource.Events]);
    expect(answer.detections[0]!.matchedEventCount).toBeNull();
  });

  test("detections the reader may not read leave nothing to explain, said so", async () => {
    jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("No."));

    const answer: SecurityCaseMatchesJson = await matches();

    expect(answer.detections).toEqual([]);
    expect(answer.detectionCount).toBe(1);
    expect(answer.unreadableSources).toEqual([
      SecurityCaseMatchesSource.Detections,
    ]);
  });

  test("reads only the reader's resources", async () => {
    jest.spyOn(TelemetryReadAccess, "getServiceFilter").mockResolvedValue({
      serviceIds: [new ObjectID(SERVICE_ID)],
    } as never);

    await matches();

    expect(eventsStatement().query).toContain("primaryEntityId IN (");
  });
});

describe("which detections are explained", () => {
  test("the one that opened the case first, then the latest, each once, at most the bound", async () => {
    const opening: SecurityDetection = detectionRow();
    const later: SecurityDetection = detectionRow(
      { firstSeenAt: NOW, lastSeenAt: NOW },
      LATER_ID,
    );

    const picked: Array<SecurityDetection> = pickDetectionsToExplain({
      opening: [opening],
      latest: [later, opening],
      max: SECURITY_CASE_MATCHES_MAX_DETECTIONS,
    });

    expect(
      picked.map((detection: SecurityDetection): string => {
        return detection._id!;
      }),
    ).toEqual([DETECTION_ID, LATER_ID]);

    expect(
      pickDetectionsToExplain({
        opening: [opening],
        latest: [later],
        max: 1,
      }),
    ).toHaveLength(1);
  });

  test("marks only the first to fire as the one that opened the case", async () => {
    detections = [
      detectionRow(),
      detectionRow(
        {
          source: SecurityDetectionSource.ThreatIntel,
          detectionRuleId: undefined,
        },
        LATER_ID,
      ),
    ];

    const answer: SecurityCaseMatchesJson = await matches();

    expect(
      answer.detections.map((detection: SecurityCaseMatchedDetectionJson) => {
        return [detection.id, detection.isOpening];
      }),
    ).toEqual([
      [DETECTION_ID, true],
      [LATER_ID, false],
    ]);
  });
});

describe("the pieces", () => {
  test("a correlation's group is each value it holds", () => {
    expect(getGroupValues("203.0.113.7 / ana@acme.example")).toEqual([
      "203.0.113.7",
      "ana@acme.example",
    ]);
    expect(getGroupValues("")).toEqual([]);
    expect(getGroupValues(undefined)).toEqual([]);
  });

  test("the tally adds up each outcome, the requests no trace was followed for under none", () => {
    expect(
      readOutcomeRows([
        { requestOutcome: "Rejected", matched: "9" },
        { requestOutcome: "Reached App", matched: 2 },
        { requestOutcome: "", matched: "1" },
        { requestOutcome: "Errored", matched: "0" },
      ]),
    ).toEqual({
      matchedEventCount: 12,
      outcomes: { Rejected: 9, "Reached App": 2, "": 1 },
    });
  });

  test("a value a person wrote never becomes SQL", () => {
    const where: Statement = buildMatchWhere({
      projectId: PROJECT_ID,
      lookup: buildFallbackLookup({
        detection: detectionRow({
          source: SecurityDetectionSource.EntityRisk,
          groupValue: "x'); DROP TABLE SecurityEvent; --",
        }),
        now: NOW,
      })!,
      serviceFilter: {},
    });

    const events: Statement = buildMatchedEventsStatement({
      tableName: "SecurityEventItemV1",
      where,
      limit: 5,
    });
    const tally: Statement = buildMatchedOutcomesStatement({
      tableName: "SecurityEventItemV1",
      where,
    });

    expect(events.query).not.toContain("DROP TABLE");
    expect(tally.query).not.toContain("DROP TABLE");
    expect(tally.query).toContain("GROUP BY requestOutcome");
  });

  test("a rule reads its counting as its runs do", () => {
    const rule: ReturnType<typeof toMatchRule> = toMatchRule({
      rule: ruleRow({
        matchCountThreshold: 0,
        evaluationIntervalInMinutes: 0,
        description: "",
      }),
      definition: SigmaRuleSetParser.parse(PATH_TRAVERSAL_YAML),
    });

    expect(rule.threshold).toBe(1);
    expect(rule.windowInMinutes).toBe(1);
    // The YAML's own description, when the rule has none.
    expect(rule.description).toBe(
      "Requests trying to read files outside the web root.",
    );
  });
});

/*
 * What a detection kept when it fired (#9619): listed first, exactly as it
 * matched - whatever its rule says now, and after the events pass their
 * retention - each only when the reader's role reads its source. A
 * detection that kept nothing has its events read again, as before.
 */
describe("what a detection kept when it fired", () => {
  const OTHER_SOURCE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function keptEvents(
    rows: Array<JSONObject>,
    outcomes: Record<string, number> = { Rejected: 12 },
  ): JSONObject {
    return {
      events: rows.map((row: JSONObject) => {
        return buildSecurityDetectionMatchedEvent(row);
      }),
      outcomes,
    } as unknown as JSONObject;
  }

  function keptRows(): Array<JSONObject> {
    return [
      eventRow({ eventUid: "kept:0", retentionDate: "2026-11-24 19:22:20" }),
      eventRow({
        eventUid: "kept:1",
        time: "2026-11-17 19:22:15.000000000",
        retentionDate: "2026-11-24 19:22:21",
      }),
    ];
  }

  function uids(detection: SecurityCaseMatchedDetectionJson): Array<string> {
    return detection.events.map((event: { eventUid: string }): string => {
      return event.eventUid;
    });
  }

  test("lists what it kept, exactly as it matched, without reading the events table", async () => {
    detections = [detectionRow({ matchedEvents: keptEvents(keptRows()) })];

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.isKept).toBe(true);
    expect(uids(detection)).toEqual(["kept:0", "kept:1"]);
    expect(detection.events[0]!.retentionDate).toBe("2026-11-24T19:22:20.000Z");
    expect(detection.outcomes).toEqual({ Rejected: 12 });
    // What it counted as it fired, never fewer than it lists.
    expect(detection.matchedEventCount).toBe(12);
    expect(detection.hiddenEventCount).toBe(0);
    expect(detection.keptPastRetentionCount).toBe(0);
    // The rule's window still says when, and its basis what they are.
    expect(detection.windowStart).toBe("2026-11-17T19:22:00.000Z");
    expect(detection.basis).toBe(SecurityCaseMatchBasis.RuleCondition);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("lists what it matched then, not what its rule matches now", async () => {
    detections = [detectionRow({ matchedEvents: keptEvents(keptRows()) })];
    rules = [
      ruleRow({
        sigmaRuleYaml: PATH_TRAVERSAL_YAML.replace(
          "../../",
          "a value nothing matched then",
        ),
      }),
    ];

    expect(uids((await matches()).detections[0]!)).toEqual([
      "kept:0",
      "kept:1",
    ]);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("events past their retention are still listed, and counted as such", async () => {
    detections = [
      detectionRow({
        matchedEvents: keptEvents([
          eventRow({ eventUid: "gone", retentionDate: "2026-11-10 00:00:00" }),
          eventRow({ eventUid: "kept", retentionDate: "2026-12-10 00:00:00" }),
        ]),
      }),
    ];

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.events).toHaveLength(2);
    expect(detection.keptPastRetentionCount).toBe(1);
  });

  test("shows only the events of sources the reader's role reads, and counts the rest", async () => {
    detections = [
      detectionRow({
        matchedEvents: keptEvents([
          eventRow({ eventUid: "readable" }),
          eventRow({ eventUid: "hidden", primaryEntityId: OTHER_SOURCE_ID }),
          eventRow({ eventUid: "no source", primaryEntityId: "" }),
        ]),
      }),
    ];
    jest.spyOn(TelemetryReadAccess, "getServiceFilter").mockResolvedValue({
      serviceIds: [new ObjectID(SERVICE_ID)],
    } as never);

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(uids(detection)).toEqual(["readable"]);
    expect(detection.hiddenEventCount).toBe(2);
  });

  test("a source the reader's role is kept from is hidden, whatever else it reads", async () => {
    detections = [
      detectionRow({
        matchedEvents: keptEvents([
          eventRow({ eventUid: "readable", primaryEntityId: OTHER_SOURCE_ID }),
          eventRow({ eventUid: "blocked" }),
        ]),
      }),
    ];
    jest.spyOn(TelemetryReadAccess, "getServiceFilter").mockResolvedValue({
      excludedServiceIds: [new ObjectID(SERVICE_ID)],
    } as never);

    expect(uids((await matches()).detections[0]!)).toEqual(["readable"]);
  });

  test("a reader who may read no security events sees none of them, said so", async () => {
    detections = [detectionRow({ matchedEvents: keptEvents(keptRows()) })];
    jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockRejectedValue(new NotAuthorizedException("No."));

    const answer: SecurityCaseMatchesJson = await matches();

    expect(answer.unreadableSources).toEqual([
      SecurityCaseMatchesSource.Events,
    ]);
    expect(answer.detections[0]!.isKept).toBe(true);
    expect(answer.detections[0]!.events).toEqual([]);
    expect(answer.detections[0]!.hiddenEventCount).toBe(2);
  });

  test("is read as OneUptime - no role reads the column - and the reader's own reads never ask for it", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockImplementation(async (): Promise<Array<SecurityDetection>> => {
        return [detectionRow({ matchedEvents: keptEvents(keptRows()) })];
      });

    await matches();

    const reads: Array<{
      props: DatabaseCommonInteractionProps;
      select: Record<string, unknown>;
    }> = findBy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        props: DatabaseCommonInteractionProps;
        select: Record<string, unknown>;
      };
    });
    const keptReads: Array<{ props: DatabaseCommonInteractionProps }> =
      reads.filter((read: { select: Record<string, unknown> }): boolean => {
        return "matchedEvents" in read.select;
      });

    expect(keptReads).toHaveLength(1);
    expect(keptReads[0]!.props).toEqual({ isRoot: true });

    for (const read of reads) {
      if (!read.props.isRoot) {
        expect("matchedEvents" in read.select).toBe(false);
      }
    }
  });

  test("a detection that kept nothing has its events read again, beside one that kept them", async () => {
    detections = [
      detectionRow({ matchedEvents: keptEvents(keptRows()) }),
      detectionRow(
        { firstSeenAt: NOW, lastSeenAt: NOW, matchedEvents: undefined },
        LATER_ID,
      ),
    ];

    const answer: SecurityCaseMatchesJson = await matches();

    expect(answer.detections[0]!.isKept).toBe(true);
    expect(answer.detections[1]!.isKept).toBe(false);
    expect(answer.detections[1]!.events).toHaveLength(2);
    expect(
      statements.filter((statement: Statement): boolean => {
        return statement.query.includes("ORDER BY time ASC");
      }),
    ).toHaveLength(1);
  });

  test("when what they kept cannot be read, the events are read again, as before", async () => {
    jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockImplementation(
        async (findBy: unknown): Promise<Array<SecurityDetection>> => {
          if (
            "matchedEvents" in
            (findBy as { select: Record<string, unknown> }).select
          ) {
            throw new Error("Postgres is down");
          }

          return [detectionRow({ matchedEvents: keptEvents(keptRows()) })];
        },
      );

    const detection: SecurityCaseMatchedDetectionJson = (await matches())
      .detections[0]!;

    expect(detection.isKept).toBe(false);
    expect(uids(detection)).toEqual(["log:abc:0", "log:abc:1"]);
  });

  test("a kept event's source is read as an id, whatever its case", () => {
    expect(
      isKeptEventReadable({
        event: { sourceId: SERVICE_ID.toUpperCase() },
        serviceFilter: { serviceIds: [new ObjectID(SERVICE_ID)] },
      }),
    ).toBe(true);
    expect(
      isKeptEventReadable({
        event: { sourceId: "" },
        serviceFilter: {},
      }),
    ).toBe(true);
    expect(
      isKeptEventReadable({
        event: { sourceId: "" },
        serviceFilter: { serviceIds: [new ObjectID(SERVICE_ID)] },
      }),
    ).toBe(false);
  });

  test("the reader's events and the ones past retention are counted from what it kept", () => {
    const kept: ReturnType<typeof getKeptEventsForReader> =
      getKeptEventsForReader({
        kept: keptEvents([
          eventRow({ eventUid: "a", retentionDate: "2026-11-01 00:00:00" }),
          eventRow({
            eventUid: "b",
            primaryEntityId: OTHER_SOURCE_ID,
            retentionDate: "2026-11-01 00:00:00",
          }),
        ]) as never,
        serviceFilter: { serviceIds: [new ObjectID(SERVICE_ID)] },
        now: NOW,
      });

    expect(kept.events).toHaveLength(1);
    expect(kept.hiddenEventCount).toBe(1);
    expect(kept.pastRetentionCount).toBe(1);
  });
});

/*
 * A rule's own response steps (#9621) come with the rule: its own, once it
 * has any; a library rule added before rules had steps reads its library
 * entry's; an author who took them all out has none.
 */
describe("a rule's response steps", () => {
  test("are the rule's own, once it has any", async () => {
    rules = [
      ruleRow({
        responseSteps: [
          {
            id: "page-payments",
            phase: DetectionRuleResponsePhase.Contain,
            text: "Page the payments on-call.",
          },
        ] as never,
      }),
    ];

    expect((await matches()).detections[0]!.rule!.responseSteps).toEqual([
      {
        id: "page-payments",
        phase: DetectionRuleResponsePhase.Contain,
        text: "Page the payments on-call.",
      },
    ]);
  });

  test("a library rule added before rules had steps reads its library entry's", async () => {
    const steps: Array<DetectionRuleResponseStep> = (await matches())
      .detections[0]!.rule!.responseSteps;
    const entry: { id: string } = DETECTION_RULE_LIBRARY.find(
      (candidate: { title: string }): boolean => {
        return candidate.title === "Path traversal attempts";
      },
    )!;

    expect(steps.length).toBeGreaterThan(0);
    expect(steps).toEqual(getDetectionRuleLibraryResponseSteps(entry.id));
  });

  test("an author who took them all out has none, library rule or not", () => {
    expect(
      getRuleResponseSteps({
        responseSteps: [] as never,
        sigmaRuleYaml: PATH_TRAVERSAL_YAML,
      }),
    ).toEqual([]);
    expect(
      getRuleResponseSteps({
        responseSteps: undefined as never,
        sigmaRuleYaml: CORRELATION_YAML,
      }),
    ).toEqual([]);
  });
});
