import DetectionRuleEvaluator, {
  CORRELATION_MATCHED_EVENTS_MAX_GROUPS,
} from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import ThreatIntelMatcher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityConnectionCases, {
  getStoredRowsByEventUid,
} from "../../../../Server/Utils/SecurityCase/SecurityConnectionCases";
import { logThreatSignal } from "../../../../Server/Utils/SecurityCase/SecurityLogCases";
import SecurityDetectionMatchedEventsReader, {
  MatchedEventsRead,
} from "../../../../Server/Utils/SecurityCase/SecurityDetectionMatchedEventsReader";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import SecurityEntityRiskRecorder from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { DetectionMatchGroup } from "../../../../Server/Services/SecurityEventService";
import { SQL } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import ThreatIntelFeed from "../../../../Models/DatabaseModels/ThreatIntelFeed";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityDetectionMatchedEvents,
  buildSecurityDetectionMatchedEvent,
} from "../../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { DetectionRuleDefinition } from "../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleSetParser, {
  detectionRuleHeader,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Each detection source keeps the events a detection matched as it fires
 * (#9619), read as it read them: a rule's run - its condition, its window,
 * its exceptions and its bounds - for every group it opens; a correlation's
 * steps for its first groups; a feed's indicator; a product's alert, or a
 * threat in the logs, as it was stored.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const FEED_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const CONNECTION_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const SOURCE_ID: string = "77777777-7777-4777-8777-777777777777";
const START: Date = new Date("2026-10-14T09:00:00Z");
const END: Date = new Date("2026-10-14T09:05:00Z");

const RULE_YAML: string = `
title: Brute force from one IP address
level: critical
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
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

function rule(groupByField?: string): DetectionRule {
  const model: DetectionRule = new DetectionRule();
  model._id = RULE_ID.toString();
  model.projectId = PROJECT_ID;
  model.name = "Brute force";
  if (groupByField !== undefined) {
    model.groupByField = groupByField;
  }
  model.sigmaRuleYaml = RULE_YAML;
  return model;
}

function group(
  groupValue: string,
  matchCount: number = 5,
): DetectionMatchGroup {
  return {
    groupValue,
    matchCount,
    distinctCount: 0,
    sampleMessage: "failed sign-in",
    sampleObservables: [groupValue],
  };
}

function kept(uid: string): SecurityDetectionMatchedEvents {
  return {
    events: [
      buildSecurityDetectionMatchedEvent({
        time: "2026-10-14 09:01:00.000000000",
        eventUid: uid,
        primaryEntityId: SOURCE_ID,
        message: "failed sign-in",
      })!,
    ],
    outcomes: { "": 1 },
  };
}

function storedRow(uid: string): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    time: "2026-10-14 09:00:00.000000000",
    eventUid: uid,
    primaryEntityId: SOURCE_ID,
    severityName: OcsfSeverity.High,
    className: "Detection Finding",
    message: "Suspicious PowerShell",
    attributes: { "crowdstrike.detection_id": "ldt:1" },
    requestOutcome: "",
    retentionDate: "2026-11-13 09:00:00",
  };
}

function lastRead(spy: ReturnType<typeof getJestSpyOn>): MatchedEventsRead {
  return spy.mock.calls[spy.mock.calls.length - 1]![0] as MatchedEventsRead;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a detection rule's run", () => {
  test("each signal carries what its group matched", () => {
    const signals: Array<SecurityDetectionSignal> =
      DetectionRuleEvaluator.buildCaseSignals({
        rule: rule("principalIp"),
        parsedRule: detectionRuleHeader(SigmaRuleSetParser.parse(RULE_YAML)),
        matchedGroups: [group("203.0.113.7"), group("198.51.100.9")],
        findingEventUids: new Map(),
        matchedEvents: new Map([["203.0.113.7", kept("event-a")]]),
        startTime: START,
        endTime: END,
      });

    expect(signals[0]!.matchedEvents).toEqual(kept("event-a"));
    // A group whose events were not read keeps none, and its case reads them again.
    expect(signals[1]!.matchedEvents).toBeUndefined();
  });

  test("reads every group it opens at once, by its Group By Field, over the window it read", async () => {
    const readForGroups: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityDetectionMatchedEventsReader,
      "readForGroups",
    ).mockResolvedValue(new Map() as never);
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(RULE_YAML);

    await DetectionRuleEvaluator.readMatchedEvents({
      rule: rule("principalIp"),
      definition,
      parsedRule: detectionRuleHeader(definition),
      matchedGroups: [group("203.0.113.7"), group("198.51.100.9")],
      startTime: START,
      endTime: END,
      restrictTo: undefined,
      exceptionsFilter: null,
    });

    expect(readForGroups).toHaveBeenCalledTimes(1);

    const read: MatchedEventsRead = lastRead(readForGroups);

    expect(read.projectId).toEqual(PROJECT_ID);
    expect(read.start).toEqual(START);
    expect(read.end).toEqual(END);
    expect(read.groupValues).toEqual(["203.0.113.7", "198.51.100.9"]);
    expect(read.groupExpression!.query).toBe("principalIp");
    expect(read.condition.query).toContain("className");
    expect(read.condition.query).toContain("statusName");
  });

  test("reads as the run read: its exceptions, the events it was handed, up to where a write's events came in", async () => {
    const readForGroups: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityDetectionMatchedEventsReader,
      "readForGroups",
    ).mockResolvedValue(new Map() as never);
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(RULE_YAML);

    await DetectionRuleEvaluator.readMatchedEvents({
      rule: rule("principalIp"),
      definition,
      parsedRule: detectionRuleHeader(definition),
      matchedGroups: [group("203.0.113.7")],
      startTime: START,
      endTime: END,
      restrictTo: SQL`setupTestMarker = 1`,
      exceptionsFilter: SQL`NOT (exceptionMarker = 1)`,
      arrival: {
        candidateIds: ["0192f000-0000-7000-8000-000000000009"],
        firstId: "0192f000-0000-7000-8000-000000000009",
        lastId: "0192f000-0000-7000-8000-000000000009",
        candidateStartTime: START,
        candidateEndTime: END,
      },
    });

    const read: MatchedEventsRead = lastRead(readForGroups);

    expect(read.condition.query).toContain("setupTestMarker = 1");
    expect(read.condition.query).toContain("NOT (exceptionMarker = 1)");
    expect(read.condition.query).toContain("_id <= ");
    expect(JSON.stringify(read.condition.query_params)).toContain(
      "0192f000-0000-7000-8000-000000000009",
    );
  });

  test("a rule that does not group reads its matches as one group", async () => {
    const readForGroups: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityDetectionMatchedEventsReader,
      "readForGroups",
    ).mockResolvedValue(new Map() as never);
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(RULE_YAML);

    await DetectionRuleEvaluator.readMatchedEvents({
      rule: rule(),
      definition,
      parsedRule: detectionRuleHeader(definition),
      matchedGroups: [group("")],
      startTime: START,
      endTime: END,
      restrictTo: undefined,
      exceptionsFilter: null,
    });

    expect(lastRead(readForGroups).groupExpression).toBeNull();
  });

  test("a run that opens nothing reads nothing", async () => {
    const readForGroups: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityDetectionMatchedEventsReader,
      "readForGroups",
    );
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(RULE_YAML);

    expect(
      (
        await DetectionRuleEvaluator.readMatchedEvents({
          rule: rule("principalIp"),
          definition,
          parsedRule: detectionRuleHeader(definition),
          matchedGroups: [],
          startTime: START,
          endTime: END,
          restrictTo: undefined,
          exceptionsFilter: null,
        })
      ).size,
    ).toBe(0);
    expect(readForGroups).not.toHaveBeenCalled();
  });

  test("a correlation reads the rules it reads naming each group, from as far back as it looks, for its first groups", async () => {
    const readForGroups: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityDetectionMatchedEventsReader,
      "readForGroups",
    ).mockImplementation((async () => {
      return new Map([["", kept("event-c")]]);
    }) as never);
    const definition: DetectionRuleDefinition =
      SigmaRuleSetParser.parse(CORRELATION_YAML);
    const parsedRule: SigmaRule = detectionRuleHeader(definition);
    const groups: Array<DetectionMatchGroup> = Array.from(
      { length: CORRELATION_MATCHED_EVENTS_MAX_GROUPS + 3 },
      (_: unknown, index: number): DetectionMatchGroup => {
        return group(`203.0.113.${index}`);
      },
    );

    const read: Map<string, SecurityDetectionMatchedEvents> =
      await DetectionRuleEvaluator.readMatchedEvents({
        rule: rule(""),
        definition,
        parsedRule,
        matchedGroups: groups,
        startTime: START,
        endTime: END,
        restrictTo: undefined,
        exceptionsFilter: null,
      });

    expect(readForGroups).toHaveBeenCalledTimes(
      CORRELATION_MATCHED_EVENTS_MAX_GROUPS,
    );
    expect(read.size).toBe(CORRELATION_MATCHED_EVENTS_MAX_GROUPS);
    expect(read.has("203.0.113.0")).toBe(true);
    expect(read.has(`203.0.113.${CORRELATION_MATCHED_EVENTS_MAX_GROUPS}`)).toBe(
      false,
    );

    const first: MatchedEventsRead = readForGroups.mock
      .calls[0]![0] as MatchedEventsRead;

    // Ten minutes it looks across before the run's window.
    expect(first.start).toEqual(new Date(START.getTime() - 10 * 60 * 1000));
    expect(first.end).toEqual(END);
    expect(first.groupExpression).toBeNull();
    expect(first.condition.query).toContain(" OR ");
    expect(first.condition.query).toContain("hasAny(observables");
    expect(JSON.stringify(first.condition.query_params)).toContain(
      "203.0.113.0",
    );
  });
});

describe("a threat intel feed's check", () => {
  function feed(): ThreatIntelFeed {
    const model: ThreatIntelFeed = new ThreatIntelFeed();
    model._id = FEED_ID.toString();
    model.projectId = PROJECT_ID;
    model.name = "Abuse IPs";
    return model;
  }

  test("reads the events carrying each indicator it opens, but the Detection Findings", async () => {
    const readForGroups: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityDetectionMatchedEventsReader,
      "readForGroups",
    ).mockResolvedValue(new Map() as never);

    await ThreatIntelMatcher.readMatchedEvents({
      projectId: PROJECT_ID,
      matchedGroups: [
        {
          indicatorValue: "evil.example.com",
          stixId: "indicator--1",
          indicatorType: "domain-name",
          indicatorName: "Evil",
          confidence: 90,
          matchCount: 3,
          sampleMessage: "",
          sampleObservables: [],
        },
      ],
      startTime: START,
      endTime: END,
    });

    const read: MatchedEventsRead = lastRead(readForGroups);

    expect(read.groupByObservable).toBe(true);
    expect(read.groupValues).toEqual(["evil.example.com"]);
    expect(read.excludeClassUids).toEqual([2004]);
    expect(read.start).toEqual(START);
    expect(read.end).toEqual(END);
  });

  test("each signal carries what its indicator matched", () => {
    const signals: Array<SecurityDetectionSignal> =
      ThreatIntelMatcher.buildCaseSignals({
        feed: feed(),
        matchedGroups: [
          {
            indicatorValue: "evil.example.com",
            stixId: "indicator--1",
            indicatorType: "domain-name",
            indicatorName: "Evil",
            confidence: 90,
            matchCount: 3,
            sampleMessage: "",
            sampleObservables: [],
          },
        ],
        findingEventUids: new Map(),
        matchedEvents: new Map([["evil.example.com", kept("event-i")]]),
        startTime: START,
        endTime: END,
      });

    expect(signals[0]!.matchedEvents).toEqual(kept("event-i"));
  });
});

describe("an alert as it was stored", () => {
  function alert(eventUid: string): NormalizedSecurityEvent {
    return {
      time: START,
      eventUid,
      categoryUid: 2,
      categoryName: "Findings",
      classUid: 2004,
      className: "Detection Finding",
      activityName: "Create",
      severityId: 4,
      severityName: OcsfSeverity.High,
      statusName: "New",
      message: "Suspicious PowerShell",
      vendorName: "CrowdStrike",
      productName: "CrowdStrike Falcon",
      ruleId: "r",
      ruleName: "Suspicious PowerShell",
      mitreTactics: [],
      mitreTechniques: [],
      principalUser: "alice",
      principalHost: "web-01",
      principalIp: "",
      principalProcess: "",
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
      targetUser: "",
      targetHost: "",
      targetIp: "",
      targetPort: 0,
      targetResource: "",
      observables: ["web-01"],
      attributes: {},
    };
  }

  test("finds each event's row by its id, the first of an id", () => {
    const rows: Map<string, JSONObject> = getStoredRowsByEventUid([
      storedRow("a"),
      { ...storedRow("a"), message: "a second row of a" },
      storedRow("b"),
      { message: "no id" },
    ]);

    expect(Array.from(rows.keys())).toEqual(["a", "b"]);
    expect(rows.get("a")!["message"]).toBe("Suspicious PowerShell");
    expect(getStoredRowsByEventUid(undefined).size).toBe(0);
  });

  test("a connected product's alert keeps itself, as stored", async () => {
    getJestSpyOn(SecurityEntityRiskRecorder, "record").mockResolvedValue({
      entitiesUpdated: 0,
      riskCasesRaised: 0,
    } as never);

    const stored: SecurityEventConnection = new SecurityEventConnection();
    stored.caseMinimumSeverity = "High";
    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(stored as never);

    const record: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCaseIngest,
      "recordDetections",
    ).mockResolvedValue({
      casesOpened: 1,
      detectionsAdded: 1,
      detectionsRepeated: 0,
    } as never);

    const connection: SecurityEventConnection = new SecurityEventConnection();
    connection._id = CONNECTION_ID.toString();
    connection.projectId = PROJECT_ID;
    connection.name = "Falcon";

    await SecurityConnectionCases.recordImportedAlerts({
      connection,
      definition: { productName: "CrowdStrike Falcon" },
      events: [alert("alert-1"), alert("alert-2")],
      rows: [storedRow("alert-1")],
    });

    const signals: Array<SecurityDetectionSignal> = record.mock
      .calls[0]![0] as Array<SecurityDetectionSignal>;

    expect(signals[0]!.matchedEvents!.events[0]).toMatchObject({
      eventUid: "alert-1",
      sourceId: SOURCE_ID,
      retentionDate: "2026-11-13T09:00:00.000Z",
    });
    // An alert whose row it was not handed keeps nothing; its case reads it again.
    expect(signals[1]!.matchedEvents).toBeUndefined();
  });

  test("a threat a security product wrote in the logs keeps itself, as stored", () => {
    const signal: SecurityDetectionSignal = logThreatSignal({
      projectId: PROJECT_ID,
      event: alert("threat-1"),
      storedRow: storedRow("threat-1"),
    });

    expect(signal.matchedEvents!.events[0]).toMatchObject({
      eventUid: "threat-1",
      sourceId: SOURCE_ID,
    });
    expect(
      logThreatSignal({ projectId: PROJECT_ID, event: alert("threat-2") })
        .matchedEvents,
    ).toBeUndefined();
  });
});
