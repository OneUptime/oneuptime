import { SecurityDetectionSignal } from "../../SecurityCase/SecurityCaseIngest";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntity } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  ENTITY_RISK_WINDOW_IN_DAYS,
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
} from "../../../../Types/SecurityCase/SecurityEntityRisk";
import { entityRiskMarkdown } from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import {
  SecurityEntityRiskSummary,
  getCriticalityWeight,
  getEntityRiskKey,
  getEntityRiskLevel,
  getRiskDetectionSeverity,
} from "../../../../Utils/SecurityCase/SecurityEntityRiskScore";

/*
 * The rule every risk detection is written under: the project's risk
 * threshold. Not "Entity Risk" - that is its source, and a case's
 * detections name both side by side.
 */
export const ENTITY_RISK_DETECTION_NAME: string = "Risk threshold";

// Stable for one entity: its risk is one detection on the case about it.
export function getEntityRiskFingerprint(entityValue: string): string {
  return `entity-risk:${getEntityRiskKey(entityValue)}`;
}

/*
 * The detection an entity's risk raises when it reaches the project's
 * threshold (SecurityEntityRiskRecorder): about the entity - so it joins the
 * open case about it, or opens one titled after it - at High, or Critical
 * from twice the threshold, with every source that added to the risk on it.
 * Its ATT&CK ids are its sources'.
 */
export function buildEntityRiskSignal(data: {
  projectId: ObjectID;
  entity: SecurityEntity;
  summary: SecurityEntityRiskSummary;
  criticality?: SecurityEntityCriticality | null | undefined;
  threshold: number;
  now: Date;
}): SecurityDetectionSignal {
  const { summary } = data;
  const level: string = getEntityRiskLevel(summary.score, data.threshold);
  const severity: OcsfSeverity = getRiskDetectionSeverity(
    summary.score,
    data.threshold,
  );

  let eventCount: number = 0;

  for (const contribution of summary.contributors) {
    eventCount += contribution.hits;
  }

  return {
    projectId: data.projectId,
    source: SecurityDetectionSource.EntityRisk,
    fingerprint: getEntityRiskFingerprint(data.entity.value),
    title: `${level} risk — ${data.entity.value}`,
    description: entityRiskMarkdown({
      entityValue: data.entity.value,
      entityType: data.entity.type,
      score: summary.score,
      level,
      threshold: data.threshold,
      windowInDays: ENTITY_RISK_WINDOW_IN_DAYS,
      ...(data.criticality
        ? {
            criticality: {
              name: data.criticality,
              weight: getCriticalityWeight(data.criticality),
            },
          }
        : {}),
      sources: summary.contributors.map(
        (contribution: SecurityEntityRiskContribution) => {
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
        },
      ),
    }).toString(),
    severity,
    eventCount,
    groupValue: data.entity.value,
    entities: [data.entity],
    mitreTactics: summary.mitreTactics,
    mitreTechniques: summary.mitreTechniques,
    ruleName: ENTITY_RISK_DETECTION_NAME,
    seenAt: data.now,
  };
}
