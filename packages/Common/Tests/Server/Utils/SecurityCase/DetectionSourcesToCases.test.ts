import DetectionRuleEvaluator from "../../../../Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import ThreatIntelMatcher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityConnectionCases, {
  importedAlertEntities,
  importedAlertGroupValue,
  isAtLeastSeverity,
  readCaseMinimumSeverity,
} from "../../../../Server/Utils/SecurityCase/SecurityConnectionCases";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import SecurityEntityRiskRecorder from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { SecurityRiskFinding } from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import logger from "../../../../Server/Utils/Logger";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import ThreatIntelFeed from "../../../../Models/DatabaseModels/ThreatIntelFeed";
import ObjectID from "../../../../Types/ObjectID";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Each detection source hands the case ingest signals it can trust: the
 * right source, a fingerprint stable across runs, the entity typed by where
 * it came from, the rule's ATT&CK tags, and a pointer to the event that
 * records it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const FEED_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const CONNECTION_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const START: Date = new Date("2026-10-14T09:00:00Z");
const END: Date = new Date("2026-10-14T09:05:00Z");

const RULE_YAML: string = `
title: Brute force from one IP address
description: Many failed sign-ins.
level: critical
tags:
  - attack.credential_access
  - attack.t1110.001
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DetectionRuleEvaluator.buildCaseSignals", () => {
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

  test("one signal per group, the group value typed by the grouped field", () => {
    const signals: Array<SecurityDetectionSignal> =
      DetectionRuleEvaluator.buildCaseSignals({
        rule: rule("principalIp"),
        parsedRule: SigmaRuleParser.parse(RULE_YAML),
        matchedGroups: [
          {
            groupValue: "203.0.113.7",
            matchCount: 14,
            distinctCount: 0,
            sampleMessage: "Failed logon for [admin](https://evil.example)",
            sampleObservables: ["203.0.113.7", "alice@acme.com", "web-01"],
          },
        ],
        findingEventUids: new Map([["203.0.113.7", "detection:r:fp:1"]]),
        startTime: START,
        endTime: END,
      });

    expect(signals).toHaveLength(1);

    const signal: SecurityDetectionSignal = signals[0]!;

    expect(signal.source).toBe(SecurityDetectionSource.DetectionRule);
    expect(signal.title).toBe("Brute force — 203.0.113.7");
    expect(signal.severity).toBe(OcsfSeverity.Critical);
    expect(signal.eventCount).toBe(14);
    expect(signal.groupValue).toBe("203.0.113.7");
    expect(signal.detectionRuleId?.toString()).toBe(RULE_ID.toString());
    expect(signal.mitreTactics).toEqual(["TA0006"]);
    expect(signal.mitreTechniques).toEqual(["T1110.001"]);
    expect(signal.eventUid).toBe("detection:r:fp:1");
    expect(signal.seenAt).toEqual(END);
    expect(
      signal.fingerprint.startsWith(`detection-rule:${RULE_ID.toString()}:`),
    ).toBe(true);
    expect(signal.entities).toEqual([
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
      { type: SecurityEntityType.User, value: "alice@acme.com" },
      { type: SecurityEntityType.Other, value: "web-01" },
    ]);
    // The event text is code in the description, never a link.
    expect(signal.description).toContain(
      "`Failed logon for [admin](https://evil.example)`",
    );
  });

  test("a rule without a group signals once, about no entity of its own", () => {
    const signals: Array<SecurityDetectionSignal> =
      DetectionRuleEvaluator.buildCaseSignals({
        rule: rule(),
        parsedRule: SigmaRuleParser.parse(RULE_YAML),
        matchedGroups: [
          {
            groupValue: "",
            matchCount: 3,
            distinctCount: 0,
            sampleMessage: "",
            sampleObservables: [],
          },
        ],
        findingEventUids: new Map(),
        startTime: START,
        endTime: END,
      });

    expect(signals[0]!.title).toBe("Brute force");
    expect(signals[0]!.groupValue).toBeUndefined();
    expect(signals[0]!.eventUid).toBeUndefined();
  });

  test("the same group gets the same fingerprint run after run", () => {
    const build: () => string = (): string => {
      return DetectionRuleEvaluator.buildCaseSignals({
        rule: rule("principalIp"),
        parsedRule: SigmaRuleParser.parse(RULE_YAML),
        matchedGroups: [
          {
            groupValue: "203.0.113.7",
            matchCount: 1,
            distinctCount: 0,
            sampleMessage: "",
            sampleObservables: [],
          },
        ],
        findingEventUids: new Map(),
        startTime: START,
        endTime: END,
      })[0]!.fingerprint;
    };

    expect(build()).toBe(build());
  });
});

describe("ThreatIntelMatcher.buildCaseSignals", () => {
  test("a signal about the indicator's value, at its confidence's severity", () => {
    const feed: ThreatIntelFeed = new ThreatIntelFeed();
    feed._id = FEED_ID.toString();
    feed.projectId = PROJECT_ID;
    feed.name = "Abuse feed";

    const signals: Array<SecurityDetectionSignal> =
      ThreatIntelMatcher.buildCaseSignals({
        feed,
        matchedGroups: [
          {
            indicatorValue: "203.0.113.7",
            stixId: "indicator--1",
            indicatorType: "ipv4-addr",
            indicatorName: "Known C2",
            confidence: 95,
            matchCount: 2,
            sampleMessage: "connection to 203.0.113.7",
            sampleObservables: ["203.0.113.7", "web-01.acme.internal"],
          },
        ],
        findingEventUids: new Map([["203.0.113.7", "threat-intel:f:1"]]),
        startTime: START,
        endTime: END,
      });

    expect(signals[0]).toMatchObject({
      source: SecurityDetectionSource.ThreatIntel,
      title: "Abuse feed — 203.0.113.7",
      severity: OcsfSeverity.Critical,
      groupValue: "203.0.113.7",
      eventCount: 2,
      eventUid: "threat-intel:f:1",
      ruleName: "Abuse feed",
    });
    expect(signals[0]!.threatIntelFeedId?.toString()).toBe(FEED_ID.toString());
    expect(signals[0]!.entities[0]).toEqual({
      type: SecurityEntityType.IpAddress,
      value: "203.0.113.7",
    });
  });
});

describe("SecurityConnectionCases", () => {
  // Entity risk has its own suite (SecurityEntityRiskRecorder); here it only records.
  beforeEach(() => {
    getJestSpyOn(SecurityEntityRiskRecorder, "record").mockResolvedValue({
      entitiesUpdated: 0,
      riskCasesRaised: 0,
    } as never);
  });

  function event(
    overrides: Partial<NormalizedSecurityEvent>,
  ): NormalizedSecurityEvent {
    return {
      time: START,
      eventUid: "alert-1",
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
      mitreTactics: ["TA0002"],
      mitreTechniques: ["T1059"],
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
      targetIp: "10.0.0.5",
      targetPort: 0,
      targetResource: "",
      observables: ["web-01", "alice", "10.0.0.5", "evil.example"],
      attributes: {},
      ...overrides,
    };
  }

  function connectionModel(): SecurityEventConnection {
    const model: SecurityEventConnection = new SecurityEventConnection();
    model._id = CONNECTION_ID.toString();
    model.projectId = PROJECT_ID;
    model.name = "Falcon";
    return model;
  }

  function threshold(value: string | undefined): void {
    const stored: SecurityEventConnection = new SecurityEventConnection();
    if (value !== undefined) {
      stored.caseMinimumSeverity = value;
    }

    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(stored as never);
  }

  test("reads the connection's threshold, empty meaning off", () => {
    expect(readCaseMinimumSeverity("High")).toBe(OcsfSeverity.High);
    expect(readCaseMinimumSeverity("critical")).toBe(OcsfSeverity.Critical);
    expect(readCaseMinimumSeverity("")).toBeNull();
    expect(readCaseMinimumSeverity(undefined)).toBeNull();
    expect(readCaseMinimumSeverity("whenever")).toBeNull();
    expect(isAtLeastSeverity(OcsfSeverity.Critical, OcsfSeverity.High)).toBe(
      true,
    );
    expect(isAtLeastSeverity(OcsfSeverity.Medium, OcsfSeverity.High)).toBe(
      false,
    );
    expect(isAtLeastSeverity(OcsfSeverity.Other, OcsfSeverity.Low)).toBe(false);
  });

  test("types an alert's entities by their fields, the host first", () => {
    const alert: NormalizedSecurityEvent = event({});

    expect(importedAlertGroupValue(alert)).toBe("web-01");
    expect(importedAlertEntities(alert)).toEqual([
      { type: SecurityEntityType.User, value: "alice" },
      { type: SecurityEntityType.Host, value: "web-01" },
      { type: SecurityEntityType.IpAddress, value: "10.0.0.5" },
      { type: SecurityEntityType.Domain, value: "evil.example" },
    ]);
  });

  test("opens cases for the alerts at or above the threshold, and nothing else", async () => {
    threshold("High");
    const record: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCaseIngest,
      "recordDetections",
    ).mockResolvedValue({
      casesOpened: 1,
      detectionsAdded: 1,
      detectionsRepeated: 0,
    } as never);

    const opened: number = await SecurityConnectionCases.recordImportedAlerts({
      connection: connectionModel(),
      definition: { productName: "CrowdStrike Falcon" },
      events: [
        event({}),
        event({ eventUid: "alert-2", severityName: OcsfSeverity.Medium }),
        // A sign-in is an event, never a case.
        event({
          eventUid: "signin",
          classUid: 3002,
          className: "Authentication",
        }),
      ],
    });

    expect(opened).toBe(1);

    const signals: Array<SecurityDetectionSignal> = record.mock
      .calls[0]![0] as Array<SecurityDetectionSignal>;

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      source: SecurityDetectionSource.ConnectedProduct,
      fingerprint: `connection:${CONNECTION_ID.toString()}:alert-1`,
      title: "Suspicious PowerShell — web-01",
      groupValue: "web-01",
      eventUid: "alert-1",
      mitreTechniques: ["T1059"],
    });
    expect(signals[0]!.securityEventConnectionId?.toString()).toBe(
      CONNECTION_ID.toString(),
    );
  });

  test("opens nothing when the connection's threshold is empty", async () => {
    threshold("");
    const record: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCaseIngest,
      "recordDetections",
    );

    expect(
      await SecurityConnectionCases.recordImportedAlerts({
        connection: connectionModel(),
        definition: { productName: "CrowdStrike Falcon" },
        events: [event({ severityName: OcsfSeverity.Critical })],
      }),
    ).toBe(0);
    expect(record).not.toHaveBeenCalled();
  });

  /*
   * Every imported alert, at any severity, adds to the risk of the user and
   * host it names (SecurityEntityRiskRecorder) - after the poll's cases, so
   * a risk that reaches the threshold joins theirs, and whatever the
   * connection opens cases from.
   */
  function recordRisk(order?: Array<string>): ReturnType<typeof getJestSpyOn> {
    return getJestSpyOn(SecurityEntityRiskRecorder, "record").mockImplementation(
      async () => {
        order?.push("risk");
        return { entitiesUpdated: 1, riskCasesRaised: 0 } as never;
      },
    );
  }

  function riskFindingsOf(
    risk: ReturnType<typeof getJestSpyOn>,
  ): Array<SecurityRiskFinding> {
    return risk.mock.calls[0]![0] as Array<SecurityRiskFinding>;
  }

  test("every alert adds risk to the user and host it names, after the cases, below the threshold too", async () => {
    threshold("High");
    const order: Array<string> = [];

    getJestSpyOn(SecurityCaseIngest, "recordDetections").mockImplementation(
      async () => {
        order.push("cases");
        return {
          casesOpened: 1,
          detectionsAdded: 1,
          detectionsRepeated: 0,
        } as never;
      },
    );

    const risk: ReturnType<typeof getJestSpyOn> = recordRisk(order);

    await SecurityConnectionCases.recordImportedAlerts({
      connection: connectionModel(),
      definition: { productName: "CrowdStrike Falcon" },
      events: [
        event({}),
        event({ eventUid: "alert-2", severityName: OcsfSeverity.Medium }),
      ],
    });

    expect(order).toEqual(["cases", "risk"]);

    const findings: Array<SecurityRiskFinding> = riskFindingsOf(risk);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      source: SecurityDetectionSource.ConnectedProduct,
      sourceName: "Suspicious PowerShell (CrowdStrike Falcon)",
      points: 50,
      entities: [
        { type: SecurityEntityType.User, value: "alice" },
        { type: SecurityEntityType.Host, value: "web-01" },
      ],
    });
    expect(findings[1]).toMatchObject({ points: 25 });
  });

  test("a connection that opens no cases still adds risk", async () => {
    threshold("");
    const risk: ReturnType<typeof getJestSpyOn> = recordRisk();

    await SecurityConnectionCases.recordImportedAlerts({
      connection: connectionModel(),
      definition: { productName: "CrowdStrike Falcon" },
      events: [event({ severityName: OcsfSeverity.Critical })],
    });

    expect(riskFindingsOf(risk)[0]).toMatchObject({ points: 75 });
  });

  test("alerts all below the threshold add risk though they open no case", async () => {
    threshold("Critical");
    const cases: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCaseIngest,
      "recordDetections",
    );
    const risk: ReturnType<typeof getJestSpyOn> = recordRisk();

    await SecurityConnectionCases.recordImportedAlerts({
      connection: connectionModel(),
      definition: { productName: "CrowdStrike Falcon" },
      events: [event({ severityName: OcsfSeverity.Low })],
    });

    expect(cases).not.toHaveBeenCalled();
    expect(riskFindingsOf(risk)[0]).toMatchObject({ points: 10 });
  });

  test("a poll that imported no alert adds no risk", async () => {
    threshold("Low");
    const risk: ReturnType<typeof getJestSpyOn> = recordRisk();

    await SecurityConnectionCases.recordImportedAlerts({
      connection: connectionModel(),
      definition: { productName: "CrowdStrike Falcon" },
      events: [event({ classUid: 3002, className: "Authentication" })],
    });

    expect(risk).not.toHaveBeenCalled();
  });

  test("never fails the poll that imported the alerts", async () => {
    threshold("Low");
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    getJestSpyOn(SecurityCaseIngest, "recordDetections").mockRejectedValue(
      new Error("lock timed out") as never,
    );

    await expect(
      SecurityConnectionCases.recordImportedAlerts({
        connection: connectionModel(),
        definition: { productName: "CrowdStrike Falcon" },
        events: [event({})],
      }),
    ).resolves.toBe(0);
  });
});
