/*
 * Entity risk in the Security Operations fixture: the project's Entity
 * Criticality list, and the risk row of each user, host and address the
 * project's findings named this week, as the server keeps them
 * (SecurityEntityRiskRecorder). A row's score, ATT&CK ids, times and history
 * are worked out from its sources with the server's own arithmetic
 * (Common/Utils/SecurityCase/SecurityEntityRiskScore), so each row says what
 * the server would have written for those findings.
 *
 * The sources are the fixture's own: its library rules and correlation
 * rules (by id), its two threat intel feeds and the products its cases came
 * from. The entities are the ones its cases are about - the password spray's
 * address, the accounts it tried, the finance workstation Falcon caught
 * dumping credentials, the web server Defender flagged - and the
 * vulnerability scanner the project marked Low, whose expected scans count
 * for half.
 *
 * Scenarios, read by Fixture.js (readRiskScenario):
 *
 *   ?riskcases=off  the project opens no case from risk (as a project made
 *                   before entity risk): Entity Risk says so above its list.
 *   ?threshold=     the project's own threshold (a whole number from 10 to
 *                   10000), which every level and the guide read; 100 when
 *                   left out.
 *   ?riskcase=1     a.ng's risk reached the threshold 20 minutes ago and
 *                   opened CASE-143, a case of Entity Risk's own.
 */
import SecurityEntityCriticality from "Common/Models/DatabaseModels/SecurityEntityCriticality";
import SecurityEntityRisk from "Common/Models/DatabaseModels/SecurityEntityRisk";
import OcsfSeverity, {
  OcsfSeverityId,
} from "Common/Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  ENTITY_RISK_WINDOW_IN_DAYS,
  SecurityEntityCriticality as Criticality,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import OneUptimeDate from "Common/Types/Date";
import { entityRiskMarkdown } from "Common/Utils/SecurityCase/SecurityCaseMarkdown";
import {
  computeEntityRisk,
  findEntityCriticalityRule,
  getCriticalityWeight,
  getEntityCaseGroupingKey,
  getEntityRiskKey,
  getEntityRiskLevel,
  getRiskDetectionSeverity,
  readRiskCaseThreshold,
  updateRiskHistory,
} from "Common/Utils/SecurityCase/SecurityEntityRiskScore";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function readRiskScenario(params) {
  const threshold = params.get("threshold");

  return {
    isRiskCaseEnabled: params.get("riskcases") !== "off",
    threshold: readRiskCaseThreshold(
      threshold === null ? undefined : threshold,
    ),
    hasRiskCase: params.get("riskcase") === "1",
  };
}

// The user CASE-143 is about, when ?riskcase=1 opens it.
export const RISK_CASE_USER = "a.ng@acme-commerce.example";

// The project's Entity Criticality list, as Risk Scoring lists it.
export const CRITICALITY_ENTRIES = [
  {
    value: "k.morgan@acme-commerce.example",
    entityType: SecurityEntityType.User,
    criticality: Criticality.Extreme,
    description: "Chief Financial Officer: approves every payment run.",
  },
  {
    value: "fin-ws-*",
    entityType: SecurityEntityType.Host,
    criticality: Criticality.High,
    description: "The finance team's workstations.",
  },
  {
    value: "dc-*",
    entityType: SecurityEntityType.Host,
    criticality: Criticality.Extreme,
    description: "Domain controllers.",
  },
  {
    value: "192.0.2.15",
    entityType: SecurityEntityType.IpAddress,
    criticality: Criticality.Low,
    description: "The vulnerability scanner: its scans are expected.",
  },
];

/*
 * One source of an entity's risk: when it began counting (`first`) and when
 * it last named the entity (`last`), in minutes ago.
 */
function source(data) {
  return {
    mitreTactics: [],
    mitreTechniques: [],
    hits: 1,
    ...data,
  };
}

function ruleSource(ids, number, data) {
  return source({
    sourceKey: `rule:${ids.rule(number)}`,
    source: SecurityDetectionSource.DetectionRule,
    detectionRuleId: ids.rule(number),
    ...data,
  });
}

function intelSource(ids, number, data) {
  return source({
    sourceKey: `intel:${ids.intel(number)}`,
    source: SecurityDetectionSource.ThreatIntel,
    threatIntelFeedId: ids.intel(number),
    ...data,
  });
}

// An imported alert: keyed by its connection and its rule, case folded.
function connectionSource(ids, number, ruleName, productName, data) {
  return source({
    sourceKey: `connection:${ids.connection(number)}:${ruleName.toLowerCase()}`,
    source: SecurityDetectionSource.ConnectedProduct,
    sourceName: `${ruleName} (${productName})`,
    securityEventConnectionId: ids.connection(number),
    ...data,
  });
}

const PASSWORD_SPRAYING = {
  sourceName: "Password spraying",
  severity: OcsfSeverity.High,
  points: 50,
  mitreTactics: ["TA0006"],
  mitreTechniques: ["T1110.003"],
};
const REPEATED_FAILURES = {
  sourceName: "Repeated failed sign-ins for one account",
  severity: OcsfSeverity.Medium,
  points: 25,
  mitreTactics: ["TA0006"],
  mitreTechniques: ["T1110"],
};
const ACCOUNT_LOCKED_OUT = {
  sourceName: "Account locked out",
  severity: OcsfSeverity.Medium,
  points: 25,
  mitreTactics: ["TA0006"],
  mitreTechniques: ["T1110"],
};

/*
 * Each entity: its sources, the score at the end of each earlier day
 * (`history`, oldest first, ending yesterday) and, for one whose risk opened
 * or joined a case, when it last did (`riskCaseMinutesAgo`).
 */
export function riskyEntities(ids, options) {
  const hasRiskCase = Boolean(options && options.hasRiskCase);

  return [
    {
      type: SecurityEntityType.IpAddress,
      value: "203.0.113.47",
      // The spray, then the success from it: 125, joining CASE-142.
      riskCaseMinutesAgo: 41,
      history: [25, 25],
      sources: [
        ruleSource(ids, 2, {
          ...PASSWORD_SPRAYING,
          hits: 14,
          first: 3 * 60 + 12,
          last: 9,
        }),
        ruleSource(ids, 30, {
          sourceName: "Spray, then a success",
          severity: OcsfSeverity.High,
          points: 50,
          first: 41,
          last: 41,
        }),
        intelSource(ids, 2, {
          sourceName: "Corporate MISP",
          severity: OcsfSeverity.Medium,
          points: 25,
          hits: 31,
          first: (2 * DAY) / MINUTE,
          last: 12,
        }),
      ],
    },
    {
      type: SecurityEntityType.User,
      value: "k.morgan@acme-commerce.example",
      // Extreme: 100 of findings weighs 200. Its last case 38 minutes ago.
      riskCaseMinutesAgo: 38,
      history: [],
      sources: [
        ruleSource(ids, 4, {
          sourceName: "MFA push fatigue",
          severity: OcsfSeverity.High,
          points: 50,
          hits: 2,
          first: 38,
          last: 20,
          mitreTactics: ["TA0006"],
          mitreTechniques: ["T1621"],
        }),
        ruleSource(ids, 3, {
          ...REPEATED_FAILURES,
          hits: 2,
          first: 3 * 60,
          last: 15,
        }),
        ruleSource(ids, 31, {
          sourceName: "Admin console from a new address",
          severity: OcsfSeverity.Medium,
          points: 25,
          first: 7 * 60,
          last: 7 * 60,
        }),
      ],
    },
    {
      type: SecurityEntityType.Host,
      value: "fin-ws-112",
      // High, by fin-ws-*: 75 weighs 113. Its risk joined CASE-140.
      riskCaseMinutesAgo: 26 * 60,
      history: [113],
      sources: [
        connectionSource(ids, 2, "Credential Dumping", "Falcon", {
          severity: OcsfSeverity.Critical,
          points: 75,
          hits: 2,
          first: 26 * 60,
          last: 25 * 60,
          mitreTactics: ["TA0006"],
          mitreTechniques: ["T1003.001"],
        }),
      ],
    },
    {
      type: SecurityEntityType.User,
      value: "r.alvarez@acme-commerce.example",
      // The same alert's user: the one signed in on the host.
      history: [75],
      sources: [
        connectionSource(ids, 2, "Credential Dumping", "Falcon", {
          severity: OcsfSeverity.Critical,
          points: 75,
          hits: 2,
          first: 26 * 60,
          last: 25 * 60,
          mitreTactics: ["TA0006"],
          mitreTechniques: ["T1003.001"],
        }),
      ],
    },
    {
      type: SecurityEntityType.IpAddress,
      value: "198.51.100.23",
      // On Feodo Tracker at a confidence of 90: Critical.
      history: [],
      sources: [
        intelSource(ids, 1, {
          sourceName: "Feodo Tracker botnet C2 servers",
          severity: OcsfSeverity.Critical,
          points: 75,
          hits: 3,
          first: 48,
          last: 31,
        }),
      ],
    },
    {
      type: SecurityEntityType.Host,
      value: "web-03",
      history: [],
      sources: [
        connectionSource(
          ids,
          3,
          "Suspicious PowerShell",
          "Microsoft Defender XDR",
          {
            severity: OcsfSeverity.High,
            points: 50,
            first: 2 * 60,
            last: 2 * 60,
            mitreTactics: ["TA0002"],
            mitreTechniques: ["T1059.001"],
          },
        ),
      ],
    },
    {
      type: SecurityEntityType.User,
      value: RISK_CASE_USER,
      // ?riskcase=1: a rejected push 20 minutes ago takes it to 100.
      ...(hasRiskCase ? { riskCaseMinutesAgo: 20 } : {}),
      history: [],
      sources: [
        ...(hasRiskCase
          ? [
              ruleSource(ids, 5, {
                sourceName: "MFA push rejected or reported",
                severity: OcsfSeverity.High,
                points: 50,
                first: 20,
                last: 20,
                mitreTactics: ["TA0006"],
                mitreTechniques: ["T1621"],
              }),
            ]
          : []),
        ruleSource(ids, 6, {
          ...ACCOUNT_LOCKED_OUT,
          first: 2 * 60 + 50,
          last: 2 * 60 + 50,
        }),
        ruleSource(ids, 3, {
          ...REPEATED_FAILURES,
          first: 2 * 60 + 55,
          last: 2 * 60 + 55,
        }),
      ],
    },
    {
      type: SecurityEntityType.IpAddress,
      value: "192.0.2.15",
      // Low: the scanner's 100 of findings weighs 50, and opens no case.
      history: [50, 50, 50, 50, 50],
      sources: [
        ruleSource(ids, 1, {
          sourceName: "Brute force from one IP address",
          severity: OcsfSeverity.High,
          points: 50,
          hits: 96,
          first: (5 * DAY) / MINUTE,
          last: 20,
          mitreTactics: ["TA0006"],
          mitreTechniques: ["T1110.001"],
        }),
        ruleSource(ids, 2, {
          ...PASSWORD_SPRAYING,
          hits: 40,
          first: (5 * DAY) / MINUTE,
          last: 22,
        }),
      ],
    },
    {
      type: SecurityEntityType.User,
      value: "j.wilson@acme-commerce.example",
      history: [],
      sources: [
        ruleSource(ids, 6, {
          ...ACCOUNT_LOCKED_OUT,
          first: 2 * 60 + 48,
          last: 2 * 60 + 48,
        }),
      ],
    },
    /*
     * An entity whose one source went quiet over a week ago: kept for its
     * history, listed nowhere (its score is 0).
     */
    {
      type: SecurityEntityType.Host,
      value: "old-laptop-9",
      history: [25, 25, 0, 0],
      sources: [
        ruleSource(ids, 6, {
          ...ACCOUNT_LOCKED_OUT,
          first: (12 * DAY) / MINUTE,
          last: (9 * DAY) / MINUTE,
        }),
      ],
    },
  ];
}

function contributionsOf(entity, now) {
  return entity.sources.map((item) => {
    const { first, last, ...rest } = item;

    return {
      ...rest,
      firstSeenAt: new Date(now.getTime() - first * MINUTE).toISOString(),
      lastSeenAt: new Date(now.getTime() - last * MINUTE).toISOString(),
    };
  });
}

function criticalityOf(entity) {
  return (
    findEntityCriticalityRule({
      entity: { type: entity.type, value: entity.value },
      rules: CRITICALITY_ENTRIES,
    })?.criticality || null
  );
}

/*
 * The rows, as the server writes them: the sources with their times, the
 * score they add up to weighted by the entity's criticality, and a point a
 * day of history - the earlier days as listed, today's the score now. The
 * Entity Criticality list is a set-up project's; the risk, one with history.
 */
export function seedEntityRisk(data) {
  const { insert, table, now, uuid, ids } = data;
  const ago = (milliseconds) => {
    return new Date(now.getTime() - milliseconds);
  };

  // Both tables are every project's, empty or not.
  table(SecurityEntityRisk);
  table(SecurityEntityCriticality);

  if (data.isEmpty) {
    return;
  }

  CRITICALITY_ENTRIES.forEach((entry, index) => {
    insert(SecurityEntityCriticality, {
      _id: uuid("2e000000", index + 1),
      ...entry,
      createdAt: ago((index + 2) * DAY),
    });
  });

  if (!data.hasHistory) {
    return;
  }

  riskyEntities(ids, { hasRiskCase: data.hasRiskCase }).forEach(
    (entity, index) => {
      const contributions = contributionsOf(entity, now);
      const criticality = criticalityOf(entity);
      const summary = computeEntityRisk({ contributions, criticality, now });

      let history = [];

      entity.history.forEach((score, dayIndex) => {
        history = updateRiskHistory(
          history,
          score,
          ago((entity.history.length - dayIndex) * DAY),
        );
      });

      history = updateRiskHistory(history, summary.score, now);

      insert(SecurityEntityRisk, {
        _id: uuid("2d000000", index + 1),
        entityType: entity.type,
        entityValue: entity.value,
        entityKey: getEntityRiskKey(entity.value),
        riskScore: summary.score,
        ...(criticality ? { criticality } : {}),
        contributorCount: summary.contributors.length,
        // A quiet entity's sources stopped counting: its row keeps none.
        contributions: summary.contributors,
        mitreTactics: summary.mitreTactics,
        mitreTechniques: summary.mitreTechniques,
        firstRiskAt: summary.firstRiskAt || undefined,
        // Kept when the last source goes, for the month it is forgotten after.
        lastRiskAt:
          summary.lastRiskAt ||
          ago(Math.min(...entity.sources.map((item) => item.last)) * MINUTE),
        riskExpiresAt: summary.expiresAt || undefined,
        riskCaseAt:
          entity.riskCaseMinutesAgo !== undefined
            ? ago(entity.riskCaseMinutesAgo * MINUTE)
            : undefined,
        riskHistory: history,
        createdAt: ago(
          Math.max(...entity.sources.map((item) => item.first)) * MINUTE,
        ),
      });
    },
  );
}

/*
 * ?riskcase=1: the case a.ng's risk opened, and its one detection, as
 * buildEntityRiskSignal and SecurityCaseIngest write them - High at the
 * threshold, titled after the entity and grouped on it, its description
 * every source that added to the risk.
 */
export function entityRiskCase(data) {
  const { ids, now, threshold } = data;
  const entity = riskyEntities(ids, { hasRiskCase: true }).find((item) => {
    return item.value === RISK_CASE_USER;
  });
  const criticality = criticalityOf(entity);
  const summary = computeEntityRisk({
    contributions: contributionsOf(entity, now),
    criticality,
    now,
  });
  const level = getEntityRiskLevel(summary.score, threshold);
  const openedAt = new Date(now.getTime() - entity.riskCaseMinutesAgo * MINUTE);
  const title = `${level} risk — ${entity.value}`;
  const entities = [{ type: entity.type, value: entity.value }];

  let eventCount = 0;

  for (const contribution of summary.contributors) {
    eventCount += contribution.hits;
  }

  const description = entityRiskMarkdown({
    entityValue: entity.value,
    entityType: entity.type,
    score: summary.score,
    level,
    threshold,
    windowInDays: ENTITY_RISK_WINDOW_IN_DAYS,
    ...(criticality
      ? {
          criticality: {
            name: criticality,
            weight: getCriticalityWeight(criticality),
          },
        }
      : {}),
    sources: summary.contributors.map((contribution) => {
      return {
        name: contribution.sourceName || contribution.source,
        source: contribution.source,
        severity: contribution.severity,
        points: contribution.points,
        hits: contribution.hits,
        lastSeen: OneUptimeDate.getDateAsFormattedString(
          new Date(contribution.lastSeenAt),
        ),
      };
    }),
  }).toString();

  return {
    securityCase: {
      title,
      description,
      source: SecurityDetectionSource.EntityRisk,
      entities,
      mitreTactics: summary.mitreTactics,
      mitreTechniques: summary.mitreTechniques,
      detectionCount: 1,
      firstDetectedAt: openedAt,
      lastDetectedAt: openedAt,
      groupingKey: getEntityCaseGroupingKey(entity.value),
      createdAt: openedAt,
    },
    detection: {
      title,
      description,
      severity: getRiskDetectionSeverity(summary.score, threshold),
      source: SecurityDetectionSource.EntityRisk,
      ruleName: "Risk threshold",
      groupValue: entity.value,
      entities,
      mitreTactics: summary.mitreTactics,
      mitreTechniques: summary.mitreTechniques,
      eventCount,
      fireCount: 1,
      firstSeenAt: openedAt,
      lastSeenAt: openedAt,
      createdAt: openedAt,
    },
  };
}

/*
 * What the entity-activity route answers for an entity only its risk names:
 * as many findings as its sources fired, up to when it was last found - in
 * the [value, findings, rules, worst severity id, minutes ago] shape of the
 * fixture's top entities.
 */
export function riskActivityRow(table, value, now) {
  const row = table(SecurityEntityRisk).find((item) => {
    return item.entityKey === getEntityRiskKey(value);
  });

  if (
    !row ||
    !Array.isArray(row.contributions) ||
    row.contributions.length === 0 ||
    !row.lastRiskAt
  ) {
    return undefined;
  }

  let findings = 0;
  let worst = 0;

  for (const contribution of row.contributions) {
    findings += contribution.hits;
    // Unknown and Other (0, 99) count as Informational.
    const id = OcsfSeverityId[contribution.severity] || 0;
    worst = Math.max(worst, id > 0 && id < 99 ? id : 1);
  }

  return [
    row.entityValue,
    findings,
    row.contributions.length,
    worst,
    Math.round((now.getTime() - row.lastRiskAt.getTime()) / MINUTE),
  ];
}

// The table a Reset Risk deletes from, for ModelAPI.deleteItem.
export function isEntityRiskTable(modelType) {
  return new modelType().tableName === new SecurityEntityRisk().tableName;
}
