import {
  IMPORTED_ALERT_RISK_LIMIT,
  SecurityRiskFinding,
  importedAlertRiskEntities,
  riskFindingsForImportedAlerts,
  riskFindingsForIndicatorMatches,
  riskFindingsForRuleMatches,
} from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import { DetectionMatchGroup } from "../../../../../Server/Services/SecurityEventService";
import { IndicatorMatchGroup } from "../../../../../Server/Services/ThreatIntelIndicatorService";
import DetectionRule from "../../../../../Models/DatabaseModels/DetectionRule";
import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import ThreatIntelFeed from "../../../../../Models/DatabaseModels/ThreatIntelFeed";
import ObjectID from "../../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../../../Types/SecurityEvent/OcsfSeverity";
import SigmaRule from "../../../../../Types/SecurityEvent/SigmaRule";
import SecurityDetectionSource from "../../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SigmaRuleParser from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { describe, expect, test } from "@jest/globals";

/*
 * What each detection source hands entity risk: who a finding is about -
 * the value a rule groups by, typed by its field; the address an indicator
 * names; the user and host a product's alert names - from which source, at
 * what severity and for how many points. A finding about nobody who
 * carries risk, or worth nothing, is never handed over.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const FEED_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const CONNECTION_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const SEEN_AT: Date = new Date("2026-10-14T09:05:00Z");

function sigma(level: string): SigmaRule {
  return SigmaRuleParser.parse(`
title: Brute force from one address
level: ${level}
tags:
  - attack.credential_access
  - attack.t1110.001
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`);
}

function rule(overrides: Partial<DetectionRule> = {}): DetectionRule {
  const model: DetectionRule = new DetectionRule();
  model._id = RULE_ID.toString();
  model.projectId = PROJECT_ID;
  model.name = "Brute force";
  model.groupByField = "principalIp";
  Object.assign(model, overrides);
  return model;
}

function group(
  overrides: Partial<DetectionMatchGroup> = {},
): DetectionMatchGroup {
  return {
    groupValue: "203.0.113.7",
    matchCount: 12,
    distinctCount: 0,
    sampleMessage: "",
    sampleObservables: ["203.0.113.7", "alice"],
    ...overrides,
  };
}

describe("a detection rule's matches", () => {
  test("each group adds the rule's level points to the value it groups by, typed by the field", () => {
    const findings: Array<SecurityRiskFinding> = riskFindingsForRuleMatches({
      rule: rule(),
      parsedRule: sigma("high"),
      matchedGroups: [group(), group({ groupValue: "198.51.100.9" })],
      seenAt: SEEN_AT,
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      projectId: PROJECT_ID,
      source: SecurityDetectionSource.DetectionRule,
      sourceKey: `rule:${RULE_ID.toString()}`,
      sourceName: "Brute force",
      severity: OcsfSeverity.High,
      points: 50,
      // Only what the rule grouped by: the sample's user is not who it is about.
      entities: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.7" }],
      mitreTactics: ["TA0006"],
      mitreTechniques: ["T1110.001"],
      seenAt: SEEN_AT,
      detectionRuleId: rule().id,
    });
  });

  test("a rule's own Risk Points win over its level's", () => {
    expect(
      riskFindingsForRuleMatches({
        rule: rule({ riskScore: 80 }),
        parsedRule: sigma("low"),
        matchedGroups: [group()],
        seenAt: SEEN_AT,
      })[0]!.points,
    ).toBe(80);
  });

  test("a rule worth nothing - Risk Points 0, or informational - adds nothing", () => {
    expect(
      riskFindingsForRuleMatches({
        rule: rule({ riskScore: 0 }),
        parsedRule: sigma("critical"),
        matchedGroups: [group()],
        seenAt: SEEN_AT,
      }),
    ).toEqual([]);

    expect(
      riskFindingsForRuleMatches({
        rule: rule(),
        parsedRule: sigma("informational"),
        matchedGroups: [group()],
        seenAt: SEEN_AT,
      }),
    ).toEqual([]);
  });

  test("a rule that groups by nothing names nobody in particular, and adds nothing", () => {
    expect(
      riskFindingsForRuleMatches({
        rule: rule({ groupByField: "" }),
        parsedRule: sigma("high"),
        matchedGroups: [group({ groupValue: "" })],
        seenAt: SEEN_AT,
      }),
    ).toEqual([]);
  });

  test("a group that is not a user, a host or an address adds nothing", () => {
    expect(
      riskFindingsForRuleMatches({
        rule: rule({ groupByField: "processName" }),
        parsedRule: sigma("high"),
        matchedGroups: [group({ groupValue: "powershell.exe" })],
        seenAt: SEEN_AT,
      }),
    ).toEqual([]);
  });

  test("a group by an attribute is typed by its name, or by the value's shape", () => {
    const byUserAttribute: Array<SecurityRiskFinding> =
      riskFindingsForRuleMatches({
        rule: rule({ groupByField: "userIdentity.arn" }),
        parsedRule: sigma("medium"),
        matchedGroups: [
          group({ groupValue: "arn:aws:iam::123456789012:user/alice" }),
        ],
        seenAt: SEEN_AT,
      });

    expect(byUserAttribute[0]!.entities).toEqual([
      {
        type: SecurityEntityType.User,
        value: "arn:aws:iam::123456789012:user/alice",
      },
    ]);
    expect(byUserAttribute[0]!.points).toBe(25);

    const byShape: Array<SecurityRiskFinding> = riskFindingsForRuleMatches({
      rule: rule({ groupByField: "client.addr.v4" }),
      parsedRule: sigma("medium"),
      matchedGroups: [group({ groupValue: "192.0.2.10" })],
      seenAt: SEEN_AT,
    });

    expect(byShape[0]!.entities).toEqual([
      { type: SecurityEntityType.IpAddress, value: "192.0.2.10" },
    ]);
  });

  test("a correlation's group adds to each value it groups by, typed by each field", () => {
    const findings: Array<SecurityRiskFinding> = riskFindingsForRuleMatches({
      rule: rule({ groupByField: "" }),
      parsedRule: sigma("high"),
      matchedGroups: [
        group({
          groupValue: "alice | 203.0.113.7",
          groupFields: [
            { field: "principalUser", value: "alice" },
            { field: "principalIp", value: "203.0.113.7" },
            { field: "targetResource", value: "s3://bucket" },
          ],
        }),
      ],
      seenAt: SEEN_AT,
    });

    expect(findings[0]!.entities).toEqual([
      { type: SecurityEntityType.User, value: "alice" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ]);
  });

  test("a rule not saved yet adds nothing", () => {
    const unsaved: DetectionRule = new DetectionRule();
    unsaved.name = "Unsaved";

    expect(
      riskFindingsForRuleMatches({
        rule: unsaved,
        parsedRule: sigma("high"),
        matchedGroups: [group()],
        seenAt: SEEN_AT,
      }),
    ).toEqual([]);
  });
});

describe("a threat intel feed's matches", () => {
  function feed(): ThreatIntelFeed {
    const model: ThreatIntelFeed = new ThreatIntelFeed();
    model._id = FEED_ID.toString();
    model.projectId = PROJECT_ID;
    model.name = "Feodo Tracker";
    return model;
  }

  function indicator(
    overrides: Partial<IndicatorMatchGroup> = {},
  ): IndicatorMatchGroup {
    return {
      indicatorValue: "203.0.113.7",
      stixId: "",
      indicatorType: "ipv4-addr",
      indicatorName: "",
      confidence: 75,
      matchCount: 3,
      sampleMessage: "",
      sampleObservables: ["203.0.113.7", "web-01"],
      ...overrides,
    };
  }

  test("an address indicator adds its confidence's points to the address", () => {
    const findings: Array<SecurityRiskFinding> =
      riskFindingsForIndicatorMatches({
        feed: feed(),
        matchedGroups: [
          indicator(),
          indicator({ indicatorValue: "198.51.100.1", confidence: 95 }),
          indicator({ indicatorValue: "198.51.100.2", confidence: 45 }),
        ],
        seenAt: SEEN_AT,
      });

    expect(
      findings.map((item: SecurityRiskFinding) => {
        return [item.entities[0]!.value, item.severity, item.points];
      }),
    ).toEqual([
      ["203.0.113.7", OcsfSeverity.High, 50],
      ["198.51.100.1", OcsfSeverity.Critical, 75],
      ["198.51.100.2", OcsfSeverity.Medium, 25],
    ]);
    expect(findings[0]).toMatchObject({
      source: SecurityDetectionSource.ThreatIntel,
      sourceKey: `intel:${FEED_ID.toString()}`,
      sourceName: "Feodo Tracker",
      mitreTactics: [],
      threatIntelFeedId: FEED_ID,
    });
  });

  test("a domain, a URL or a file hash is threat intel's to judge, and adds nothing", () => {
    expect(
      riskFindingsForIndicatorMatches({
        feed: feed(),
        matchedGroups: [
          indicator({ indicatorValue: "evil.example", indicatorType: "domain-name" }),
          indicator({ indicatorValue: "https://evil.example/x", indicatorType: "url" }),
          indicator({
            indicatorValue: "d41d8cd98f00b204e9800998ecf8427e",
            indicatorType: "file",
          }),
        ],
        seenAt: SEEN_AT,
      }),
    ).toEqual([]);
  });
});

describe("a connected product's imported alerts", () => {
  function event(
    overrides: Partial<NormalizedSecurityEvent> = {},
  ): NormalizedSecurityEvent {
    return {
      time: SEEN_AT,
      eventUid: "alert-1",
      categoryUid: 2,
      categoryName: "Findings",
      classUid: 2004,
      className: "Detection Finding",
      activityName: "Create",
      severityId: OcsfSeverityId[OcsfSeverity.High],
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
      principalIp: "10.0.0.4",
      principalProcess: "",
      processName: "",
      processPath: "",
      processCommandLine: "",
      parentProcessName: "",
      parentProcessPath: "",
      parentProcessCommandLine: "",
      targetUser: "bob",
      targetHost: "db-01",
      targetIp: "10.0.0.5",
      targetPort: 0,
      targetResource: "",
      observables: ["web-01", "alice", "10.0.0.5", "evil.example"],
      attributes: {},
      ...overrides,
    };
  }

  function connection(): SecurityEventConnection {
    const model: SecurityEventConnection = new SecurityEventConnection();
    model._id = CONNECTION_ID.toString();
    model.projectId = PROJECT_ID;
    model.name = "Falcon";
    return model;
  }

  test("the user and the host that acted, not every value the alert mentions", () => {
    expect(importedAlertRiskEntities(event())).toEqual([
      { type: SecurityEntityType.User, value: "alice" },
      { type: SecurityEntityType.Host, value: "web-01" },
    ]);
  });

  test("else the ones acted on, else one address", () => {
    expect(
      importedAlertRiskEntities(event({ principalUser: "", principalHost: " " })),
    ).toEqual([
      { type: SecurityEntityType.User, value: "bob" },
      { type: SecurityEntityType.Host, value: "db-01" },
    ]);

    expect(
      importedAlertRiskEntities(
        event({
          principalUser: "",
          principalHost: "",
          targetUser: "",
          targetHost: "",
        }),
      ),
    ).toEqual([{ type: SecurityEntityType.IpAddress, value: "10.0.0.4" }]);

    expect(
      importedAlertRiskEntities(
        event({
          principalUser: "",
          principalHost: "",
          targetUser: "",
          targetHost: "",
          principalIp: "",
          targetIp: "",
        }),
      ),
    ).toEqual([]);
  });

  test("every alert at any severity adds risk; each product rule is a source of its own", () => {
    const findings: Array<SecurityRiskFinding> = riskFindingsForImportedAlerts({
      connection: connection(),
      productName: "CrowdStrike Falcon",
      events: [
        event(),
        event({
          eventUid: "alert-2",
          severityName: OcsfSeverity.Low,
          severityId: OcsfSeverityId[OcsfSeverity.Low],
          ruleName: "",
        }),
        // A sign-in is an event, never a finding.
        event({ eventUid: "signin", classUid: 3002 }),
        // Informational adds nothing.
        event({
          eventUid: "alert-3",
          severityName: OcsfSeverity.Informational,
          severityId: OcsfSeverityId[OcsfSeverity.Informational],
        }),
      ],
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      projectId: PROJECT_ID,
      source: SecurityDetectionSource.ConnectedProduct,
      sourceKey: `connection:${CONNECTION_ID.toString()}:suspicious powershell`,
      sourceName: "Suspicious PowerShell (CrowdStrike Falcon)",
      severity: OcsfSeverity.High,
      points: 50,
      entities: [
        { type: SecurityEntityType.User, value: "alice" },
        { type: SecurityEntityType.Host, value: "web-01" },
      ],
      mitreTactics: ["TA0002"],
      mitreTechniques: ["T1059"],
      seenAt: SEEN_AT,
      securityEventConnectionId: CONNECTION_ID,
    });
    // An alert without a rule of its own is the product's.
    expect(findings[1]).toMatchObject({
      sourceKey: `connection:${CONNECTION_ID.toString()}:crowdstrike falcon`,
      sourceName: "CrowdStrike Falcon",
      points: 10,
    });
  });

  test("at most IMPORTED_ALERT_RISK_LIMIT alerts a poll, the most severe first", () => {
    const events: Array<NormalizedSecurityEvent> = [];

    for (let index: number = 0; index < IMPORTED_ALERT_RISK_LIMIT + 10; index++) {
      events.push(
        event({
          eventUid: `low-${index}`,
          severityName: OcsfSeverity.Low,
          severityId: OcsfSeverityId[OcsfSeverity.Low],
        }),
      );
    }

    events.push(
      event({
        eventUid: "critical",
        severityName: OcsfSeverity.Critical,
        severityId: OcsfSeverityId[OcsfSeverity.Critical],
      }),
    );

    const findings: Array<SecurityRiskFinding> = riskFindingsForImportedAlerts({
      connection: connection(),
      productName: "CrowdStrike Falcon",
      events,
    });

    expect(findings).toHaveLength(IMPORTED_ALERT_RISK_LIMIT);
    expect(findings[0]!.severity).toBe(OcsfSeverity.Critical);
  });

  test("a connection not saved yet adds nothing", () => {
    expect(
      riskFindingsForImportedAlerts({
        connection: new SecurityEventConnection(),
        productName: "CrowdStrike Falcon",
        events: [event()],
      }),
    ).toEqual([]);
  });
});
