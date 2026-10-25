import {
  ENTITY_RISK_DETECTION_NAME,
  buildEntityRiskSignal,
  getEntityRiskFingerprint,
} from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskCases";
import {
  SecurityDetectionSignal,
  securityCaseGroupingKey,
} from "../../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import ObjectID from "../../../../../Types/ObjectID";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "../../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
} from "../../../../../Types/SecurityCase/SecurityEntityRisk";
import {
  ENTITY_RISK_MARKDOWN_SOURCE_LIMIT,
  entityRiskMarkdown,
} from "../../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import { computeEntityRisk } from "../../../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { describe, expect, test } from "@jest/globals";

/*
 * The detection an entity's risk raises: about the entity, so it joins the
 * open case about it; High at the threshold and Critical at twice it; with
 * every source that added to the risk said on it, in Markdown nothing from
 * an event or a product can turn into a link, an image or a mention.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

function contribution(
  overrides: Partial<SecurityEntityRiskContribution>,
): SecurityEntityRiskContribution {
  return {
    sourceKey: "rule:a",
    source: SecurityDetectionSource.DetectionRule,
    sourceName: "Brute force",
    severity: OcsfSeverity.High,
    points: 50,
    hits: 3,
    firstSeenAt: "2026-10-13T10:00:00.000Z",
    lastSeenAt: "2026-10-14T10:00:00.000Z",
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1110"],
    ...overrides,
  };
}

function signalFor(data: {
  contributions: Array<SecurityEntityRiskContribution>;
  threshold?: number;
  criticality?: SecurityEntityCriticality;
  value?: string;
}): SecurityDetectionSignal {
  return buildEntityRiskSignal({
    projectId: PROJECT_ID,
    entity: {
      type: SecurityEntityType.User,
      value: data.value || "Alice@Corp.Example",
    },
    summary: computeEntityRisk({
      contributions: data.contributions,
      criticality: data.criticality || null,
      now: NOW,
    }),
    criticality: data.criticality || null,
    threshold: data.threshold || 100,
    now: NOW,
  });
}

describe("the risk detection", () => {
  test("is about the entity, at High where a case opens, from Entity Risk", () => {
    const signal: SecurityDetectionSignal = signalFor({
      contributions: [
        contribution({}),
        contribution({
          sourceKey: "connection:c:new country",
          source: SecurityDetectionSource.ConnectedProduct,
          sourceName: "New country (Okta)",
          severity: OcsfSeverity.Medium,
          points: 25,
          hits: 1,
          mitreTactics: ["TA0001"],
          mitreTechniques: [],
        }),
        contribution({
          sourceKey: "intel:f",
          source: SecurityDetectionSource.ThreatIntel,
          sourceName: "Feodo Tracker",
          points: 25,
          hits: 2,
          mitreTactics: [],
          mitreTechniques: [],
        }),
      ],
    });

    expect(signal).toMatchObject({
      projectId: PROJECT_ID,
      source: SecurityDetectionSource.EntityRisk,
      fingerprint: "entity-risk:alice@corp.example",
      title: "High risk — Alice@Corp.Example",
      severity: OcsfSeverity.High,
      eventCount: 6,
      groupValue: "Alice@Corp.Example",
      entities: [
        { type: SecurityEntityType.User, value: "Alice@Corp.Example" },
      ],
      mitreTactics: ["TA0006", "TA0001"],
      mitreTechniques: ["T1110"],
      ruleName: ENTITY_RISK_DETECTION_NAME,
      seenAt: NOW,
    });

    // It joins the case about the entity, however the entity is spelled.
    expect(securityCaseGroupingKey(signal)).toBe(
      securityCaseGroupingKey({
        groupValue: "alice@corp.example",
        fingerprint: "other",
      }),
    );
    // One per entity: the same entity's risk again repeats it on its case.
    expect(getEntityRiskFingerprint(" ALICE@corp.example ")).toBe(
      signal.fingerprint,
    );
    expect(signal.detectionRuleId).toBeUndefined();
  });

  test("is Critical from twice the threshold", () => {
    expect(
      signalFor({
        contributions: [contribution({ points: 100 })],
        threshold: 50,
      }),
    ).toMatchObject({
      severity: OcsfSeverity.Critical,
      title: "Critical risk — Alice@Corp.Example",
    });
  });

  test("says what the risk reached, against what, and each source", () => {
    const description: string = signalFor({
      contributions: [
        contribution({}),
        contribution({
          sourceKey: "rule:b",
          sourceName: "First sudo on a host",
          severity: OcsfSeverity.Medium,
          points: 25,
          hits: 1,
        }),
      ],
      criticality: SecurityEntityCriticality.High,
    }).description!;

    expect(description).toContain(
      "The risk of `Alice@Corp.Example` (User) reached **113**, High against the project's threshold of 100. 2 sources found it in the last 7 days:",
    );
    expect(description).toContain(
      "- **Brute force** (Detection Rule, High): 50 points, fired 3 times, last ",
    );
    expect(description).toContain(
      "- **First sudo on a host** (Detection Rule, Medium): 25 points, fired once, last ",
    );
    expect(description).toContain(
      "Its criticality, High, weighs its risk ×1.5.",
    );
  });
});

describe("entityRiskMarkdown", () => {
  test("places a product's rule name and an event's value as text, never as Markdown", () => {
    const markdown: string = entityRiskMarkdown({
      entityValue: "`x` [click](https://evil.example)",
      entityType: "User",
      score: 150,
      level: "High",
      threshold: 100,
      windowInDays: 7,
      sources: [
        {
          name: "**Pwned** ![img](https://evil.example/p.png) <@U123>",
          source: "Connected Product",
          severity: "High",
          points: 50,
          hits: 1,
          lastSeen: "Oct 14, 2026",
        },
      ],
    }).toString();

    // The entity's value is code, written out whole whatever it holds.
    expect(markdown).toContain(
      "The risk of `` `x` [click](https://evil.example) `` (User)",
    );
    // The source's name is text: its marks, its image and its mention escaped.
    expect(markdown).toContain(
      "- **\\*\\*Pwned\\*\\* !\\[img\\](https://evil.example/p.png) \\<",
    );
    expect(markdown).not.toContain("![img](");
    expect(markdown).not.toContain("<@U123>");
  });

  test("lists at most ENTITY_RISK_MARKDOWN_SOURCE_LIMIT sources, and says how many more", () => {
    const sources: Array<{
      name: string;
      source: string;
      severity: string;
      points: number;
      hits: number;
      lastSeen: string;
    }> = [];

    for (
      let index: number = 0;
      index < ENTITY_RISK_MARKDOWN_SOURCE_LIMIT + 3;
      index++
    ) {
      sources.push({
        name: `Rule ${index}`,
        source: "Detection Rule",
        severity: "Low",
        points: 10,
        hits: 1,
        lastSeen: "Oct 14, 2026",
      });
    }

    const markdown: string = entityRiskMarkdown({
      entityValue: "web-01",
      entityType: "Host",
      score: 130,
      level: "High",
      threshold: 100,
      windowInDays: 7,
      sources,
    }).toString();

    // One bullet a source shown: the text before the first, then one part each.
    expect(markdown.split("\n- ").length - 1).toBe(
      ENTITY_RISK_MARKDOWN_SOURCE_LIMIT,
    );
    expect(markdown).toContain("And 3 more, on the entity's page.");
    expect(markdown).toContain("13 sources found it in the last 7 days:");
    expect(markdown).not.toContain("criticality");
  });

  test("one source, and one point, read as one", () => {
    const markdown: string = entityRiskMarkdown({
      entityValue: "203.0.113.7",
      entityType: "IP Address",
      score: 1,
      level: "Low",
      threshold: 10,
      windowInDays: 7,
      sources: [
        {
          name: "Tor exit nodes",
          source: "Threat Intel",
          severity: "Low",
          points: 1,
          hits: 1,
          lastSeen: "Oct 14, 2026",
        },
      ],
    }).toString();

    expect(markdown).toContain("1 source found it");
    expect(markdown).toContain(": 1 point, fired once, last Oct 14, 2026");
  });
});
