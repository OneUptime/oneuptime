import IconProp from "Common/Types/Icon/IconProp";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  ENTITY_RISK_EXPLAINED_SEVERITIES,
  ENTITY_RISK_POINTS_BY_SEVERITY,
  ENTITY_RISK_POINTS_MAX,
  ENTITY_RISK_WINDOW_IN_DAYS,
  SECURITY_ENTITY_CRITICALITY_WEIGHTS,
  SecurityEntityCriticality,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import { readRiskCaseThreshold } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import {
  SecurityEventsGuide,
  SecurityEventsGuideLevel,
  SecurityEventsGuideTemplate,
  fillGuideTemplate,
  markdownTable,
} from "./SecurityEventsGuide";

/*
 * What a security team needs to trust a risk score: what adds to it, why
 * one noisy rule cannot inflate it, how criticality weighs it, what each
 * level means against the project's threshold, and when a case opens. Every
 * number is the one the server runs on (Types/SecurityCase/SecurityEntityRisk)
 * and the levels are worked out from the project's own threshold, so the
 * card says what the server does for this project.
 */

const POINTS: Record<string, number> = {
  low: ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.Low],
  medium: ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.Medium],
  high: ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.High],
  critical: ENTITY_RISK_POINTS_BY_SEVERITY[OcsfSeverity.Critical],
};

// The first step's sentence, as the card looks it up in the reader's language.
const FINDINGS_ADD_POINTS: SecurityEventsGuideTemplate = {
  sentence:
    "Each finding adds points to the user, host or address it is about: {{low}} for Low, {{medium}} for Medium, {{high}} for High and {{critical}} for Critical, or the rule's own Risk Points.",
  values: POINTS,
};

const SOURCE_COUNTS_ONCE: SecurityEventsGuideTemplate = {
  sentence:
    "A detection rule, a threat intel feed or a product's rule counts once in {{days}} days, at the most it added, however often it fires. Different sources add up.",
  values: { days: ENTITY_RISK_WINDOW_IN_DAYS },
};

const CRITICALITY_WEIGHS: SecurityEventsGuideTemplate = {
  sentence:
    "Entity Criticality weighs the score: Low counts it ×{{low}}, High ×{{high}}, Extreme ×{{extreme}}.",
  values: {
    low: SECURITY_ENTITY_CRITICALITY_WEIGHTS[SecurityEntityCriticality.Low],
    high: SECURITY_ENTITY_CRITICALITY_WEIGHTS[SecurityEntityCriticality.High],
    extreme:
      SECURITY_ENTITY_CRITICALITY_WEIGHTS[SecurityEntityCriticality.Extreme],
  },
};

function thresholdReached(threshold: number): SecurityEventsGuideTemplate {
  return {
    sentence:
      "When the risk from sources new since its last risk case reaches {{threshold}}, a case opens about the entity - or its open case takes the risk in.",
    values: { threshold },
  };
}

/*
 * What a score reads as against the threshold T: Low below half of it,
 * Medium from half, High from T, Critical from twice T (getEntityRiskLevel).
 */
function riskLevels(threshold: number): Array<SecurityEventsGuideLevel> {
  const half: number = Math.ceil(threshold / 2);
  const twice: number = threshold * 2;

  const range: (
    from: number,
    to: number,
    severity: OcsfSeverity,
  ) => SecurityEventsGuideLevel = (
    from: number,
    to: number,
    severity: OcsfSeverity,
  ): SecurityEventsGuideLevel => {
    const labelTemplate: SecurityEventsGuideTemplate = {
      sentence: "{{from}} to {{to}}",
      values: { from, to },
    };

    return {
      label: fillGuideTemplate(labelTemplate),
      labelTemplate,
      severity,
    };
  };

  const fromOnly: SecurityEventsGuideTemplate = {
    sentence: "{{from}} or more",
    values: { from: twice },
  };

  return [
    range(1, half - 1, OcsfSeverity.Low),
    range(half, threshold - 1, OcsfSeverity.Medium),
    range(threshold, twice - 1, OcsfSeverity.High),
    {
      label: fillGuideTemplate(fromOnly),
      labelTemplate: fromOnly,
      severity: OcsfSeverity.Critical,
    },
  ];
}

function overviewMarkdown(threshold: number): string {
  return `A single finding rarely says much. A burst of failed sign-ins, a first sudo on a host and an Okta sign-in from a new country are each worth a glance; the same account in all three within a week is worth a case. Entity risk adds them up.

Every finding - a detection rule's match, a threat intel match, an alert a connected security product raised - adds risk points to the user, host or IP address it is about. An entity's **risk score** is what its sources of the last ${ENTITY_RISK_WINDOW_IN_DAYS} days add up to. **Entity Risk** lists every entity by its score, the riskiest first, and each one opens on a page of its own: what added to its risk, its risk over the last 30 days, the cases about it and its activity.

When an entity's risk reaches **${threshold}**, the project's threshold, a case opens about it, or the open case about it takes the risk in and rises to its level.`;
}

const pointsMarkdown: string = `${markdownTable(
  ["A finding of severity", "Adds"],
  ENTITY_RISK_EXPLAINED_SEVERITIES.map((severity: OcsfSeverity) => {
    return [severity, `${ENTITY_RISK_POINTS_BY_SEVERITY[severity]} points`];
  }),
)}

- An informational finding adds nothing, and a finding of unknown severity counts as Medium.
- A detection rule can set its own **Risk Points**, from 0 (adds no risk) to ${ENTITY_RISK_POINTS_MAX}, under **More fields** on its form.
- A rule's points go to the value it groups by - its **Group By Field**, or each field a correlation groups by. A rule that groups by nothing names nobody in particular, and adds no risk.
- A threat intel match adds to the address the indicator names; a connected product's alert to the user and the host it names.

**Each source counts once.** A rule, a feed or a product's rule counts once in ${ENTITY_RISK_WINDOW_IN_DAYS} days, at the most it added, however often it fires. One noisy rule can never make an entity look worse than three different ones. A source that has said nothing for ${ENTITY_RISK_WINDOW_IN_DAYS} days stops counting, and the score falls.`;

function levelsMarkdown(threshold: number): string {
  return `${markdownTable(
    ["Risk score", "Reads as", "What happens"],
    [
      [
        `1 to ${Math.ceil(threshold / 2) - 1}`,
        "Low",
        "Listed under Entity Risk",
      ],
      [
        `${Math.ceil(threshold / 2)} to ${threshold - 1}`,
        "Medium",
        "Listed under Entity Risk",
      ],
      [`${threshold} to ${threshold * 2 - 1}`, "High", "A case opens, at High"],
      [`${threshold * 2} or more`, "Critical", "A case opens, at Critical"],
    ],
  )}

The threshold is set under **Settings → Risk Scoring**. Once a case opens about an entity's risk, what was behind it is not counted again: another case opens only when sources new since then add up to the threshold again, so a case closed as handled is not opened again by the same findings.`;
}

const criticalityMarkdown: string = `${markdownTable(
  ["Criticality", "Counts its risk"],
  [
    [
      "Low",
      `×${SECURITY_ENTITY_CRITICALITY_WEIGHTS[SecurityEntityCriticality.Low]}`,
    ],
    ["Not listed", "×1"],
    [
      "High",
      `×${SECURITY_ENTITY_CRITICALITY_WEIGHTS[SecurityEntityCriticality.High]}`,
    ],
    [
      "Extreme",
      `×${SECURITY_ENTITY_CRITICALITY_WEIGHTS[SecurityEntityCriticality.Extreme]}`,
    ],
  ],
)}

List the entities that matter more - domain controllers, executives, payment servers - or less, such as test machines and scanners, under **Settings → Risk Scoring → Entity Criticality**. An entry is a value or a \`*\` pattern, matched whatever its case: \`dc-*\` names every domain controller. When several entries name an entity, the most specific one counts.`;

/*
 * The Entity Risk guide for a project's threshold: its levels and its case
 * sentence say the project's own number.
 */
export function getEntityRiskGuide(
  thresholdValue: number,
): SecurityEventsGuide {
  const threshold: number = readRiskCaseThreshold(thresholdValue);
  const reached: SecurityEventsGuideTemplate = thresholdReached(threshold);

  return {
    id: "entity-risk",
    title: "How entity risk works",
    summary:
      "Everything found about one user, host or address adds up to its risk. The riskiest come first, and one that reaches the threshold opens a case.",
    steps: [
      {
        title: "Findings add points",
        icon: IconProp.Add,
        description: fillGuideTemplate(FINDINGS_ADD_POINTS),
        descriptionTemplate: FINDINGS_ADD_POINTS,
      },
      {
        title: "Each source counts once",
        icon: IconProp.Funnel,
        description: fillGuideTemplate(SOURCE_COUNTS_ONCE),
        descriptionTemplate: SOURCE_COUNTS_ONCE,
      },
      {
        title: "What matters more counts more",
        icon: IconProp.Star,
        description: fillGuideTemplate(CRITICALITY_WEIGHS),
        descriptionTemplate: CRITICALITY_WEIGHS,
      },
      {
        title: "At the threshold, a case opens",
        icon: IconProp.ShieldExclamation,
        description: fillGuideTemplate(reached),
        descriptionTemplate: reached,
      },
    ],
    levels: {
      title: "Risk levels",
      linkText: "What each level means",
      description:
        "What a score reads as against the project's threshold. From High up, a case opens.",
      items: riskLevels(threshold),
      sectionId: "levels",
    },
    // Keys in SecurityEventsGuideCopy, which the card looks up when it opens.
    guideTitle: "Entity Risk Guide",
    guideDescription:
      "What adds to an entity's risk, how its score is counted and weighed, and when it opens a case.",
    sections: [
      {
        id: "overview",
        title: "Overview",
        markdown: overviewMarkdown(threshold),
      },
      { id: "points", title: "Risk Points", markdown: pointsMarkdown },
      {
        id: "levels",
        title: "Levels and Cases",
        markdown: levelsMarkdown(threshold),
      },
      {
        id: "criticality",
        title: "Criticality",
        markdown: criticalityMarkdown,
      },
    ],
    documentationPath: "/telemetry/security-entity-risk",
  };
}
