import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import ThreatIntelFeed from "../../../../Models/DatabaseModels/ThreatIntelFeed";
import { IndicatorMatchGroup } from "../../../Services/ThreatIntelIndicatorService";
import { DetectionMatchGroup } from "../../../Services/SecurityEventService";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../../Types/SecurityEvent/OcsfSeverity";
import SigmaRule, {
  SIGMA_LEVEL_TO_OCSF_SEVERITY,
} from "../../../../Types/SecurityEvent/SigmaRule";
import { ocsfSeverityForConfidence } from "../../../../Types/SecurityEvent/ThreatIntelConstants";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntity,
  SecurityEntityType,
  entitiesFromObservables,
  getDataStoreEntityValue,
  inferSecurityEntityType,
  securityEntityTypeForField,
} from "../../../../Types/SecurityCase/SecurityEntity";
import SecuritySeverity from "../../../../Types/SecuritySeverity";
import {
  getRiskEntities,
  getRiskPointsForSeverity,
  resolveRiskPoints,
} from "../../../../Utils/SecurityCase/SecurityEntityRiskScore";

/*
 * One finding, as risk reads it: who it is about, from which source, at what
 * severity and for how many points. The detection sources turn what they
 * found into these (the builders below), and the recorder adds each to the
 * risk of the entities it names (SecurityEntityRiskRecorder).
 */
export interface SecurityRiskFinding {
  projectId: ObjectID;
  source: SecurityDetectionSource;
  // One rule, one feed, or one product's rule of one connection.
  sourceKey: string;
  sourceName: string;
  severity: OcsfSeverity;
  points: number;
  // The users, hosts and addresses it is about: the ones it adds risk to.
  entities: Array<SecurityEntity>;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  seenAt: Date;
  detectionRuleId?: ObjectID | undefined;
  threatIntelFeedId?: ObjectID | undefined;
  securityEventConnectionId?: ObjectID | undefined;
}

// The most imported alerts one poll adds risk from: the most severe first.
export const IMPORTED_ALERT_RISK_LIMIT: number = 200;

// OCSF Detection Finding and Incident Finding: what a product calls an alert.
const IMPORTED_ALERT_CLASS_UIDS: ReadonlyArray<number> = [2004, 2005];

/*
 * A detection rule's matches: each group is about the value the rule groups
 * by (each value, for a correlation that groups by several), typed by the
 * field it came from. A rule that groups by nothing names nobody in
 * particular, and adds no risk.
 */
export function riskFindingsForRuleMatches(data: {
  rule: DetectionRule;
  parsedRule: SigmaRule;
  matchedGroups: Array<DetectionMatchGroup>;
  seenAt: Date;
}): Array<SecurityRiskFinding> {
  const { rule, parsedRule } = data;

  if (!rule.id || !rule.projectId) {
    return [];
  }

  const severity: OcsfSeverity =
    SIGMA_LEVEL_TO_OCSF_SEVERITY[parsedRule.level] || OcsfSeverity.Medium;
  const points: number = resolveRiskPoints({
    severity,
    riskPoints: rule.riskScore,
  });

  if (points <= 0) {
    return [];
  }

  const groupEntityType: SecurityEntityType | undefined =
    securityEntityTypeForField(rule.groupByField);

  const findings: Array<SecurityRiskFinding> = [];

  for (const matchGroup of data.matchedGroups) {
    const groupEntities: Array<SecurityEntity> = matchGroup.groupFields
      ? matchGroup.groupFields.map(
          (entry: { field: string; value: string }): SecurityEntity => {
            return {
              type:
                securityEntityTypeForField(entry.field) ||
                inferSecurityEntityType(entry.value),
              value: entry.value,
            };
          },
        )
      : matchGroup.groupValue
        ? [
            {
              type:
                groupEntityType ||
                inferSecurityEntityType(matchGroup.groupValue),
              value: matchGroup.groupValue,
            },
          ]
        : [];

    const entities: Array<SecurityEntity> = getRiskEntities(groupEntities);

    if (entities.length === 0) {
      continue;
    }

    findings.push({
      projectId: rule.projectId,
      source: SecurityDetectionSource.DetectionRule,
      sourceKey: `rule:${rule.id.toString()}`,
      sourceName: rule.name || parsedRule.title,
      severity,
      points,
      entities,
      mitreTactics: parsedRule.mitreTactics,
      mitreTechniques: parsedRule.mitreTechniques,
      seenAt: data.seenAt,
      detectionRuleId: rule.id,
    });
  }

  return findings;
}

/*
 * A threat intel feed's matches: each is about the indicator the events
 * named, which carries risk when it is an address (a domain or a file hash
 * is threat intel's to judge, not somebody to look into).
 */
export function riskFindingsForIndicatorMatches(data: {
  feed: ThreatIntelFeed;
  matchedGroups: Array<IndicatorMatchGroup>;
  seenAt: Date;
}): Array<SecurityRiskFinding> {
  const { feed } = data;

  if (!feed.id || !feed.projectId) {
    return [];
  }

  const findings: Array<SecurityRiskFinding> = [];

  for (const matchGroup of data.matchedGroups) {
    const entities: Array<SecurityEntity> = getRiskEntities(
      entitiesFromObservables([matchGroup.indicatorValue]),
    );
    const severity: OcsfSeverity = ocsfSeverityForConfidence(
      matchGroup.confidence,
    );
    const points: number = getRiskPointsForSeverity(severity);

    if (entities.length === 0 || points <= 0) {
      continue;
    }

    findings.push({
      projectId: feed.projectId,
      source: SecurityDetectionSource.ThreatIntel,
      sourceKey: `intel:${feed.id.toString()}`,
      sourceName: feed.name || "Threat intel",
      severity,
      points,
      entities,
      mitreTactics: [],
      mitreTechniques: [],
      seenAt: data.seenAt,
      threatIntelFeedId: feed.id,
    });
  }

  return findings;
}

/*
 * Who an imported alert is about, for its risk: the user and the host that
 * acted, or else the ones acted on, or else the address. Not every value it
 * mentions - an EDR alert names the host it fired on, not every address the
 * host talked to.
 */
export function importedAlertRiskEntities(
  event: NormalizedSecurityEvent,
): Array<SecurityEntity> {
  const pick: (
    candidates: Array<[SecurityEntityType, string | undefined]>,
  ) => Array<SecurityEntity> = (
    candidates: Array<[SecurityEntityType, string | undefined]>,
  ): Array<SecurityEntity> => {
    return getRiskEntities(
      candidates
        .filter(([, value]: [SecurityEntityType, string | undefined]) => {
          return Boolean(value && value.trim());
        })
        .map(
          ([type, value]: [
            SecurityEntityType,
            string | undefined,
          ]): SecurityEntity => {
            return { type, value: (value as string).trim() };
          },
        ),
    );
  };

  const actors: Array<SecurityEntity> = pick([
    [SecurityEntityType.User, event.principalUser],
    [SecurityEntityType.Host, event.principalHost],
  ]);

  if (actors.length > 0) {
    return actors;
  }

  const targets: Array<SecurityEntity> = pick([
    [SecurityEntityType.User, event.targetUser],
    [SecurityEntityType.Host, event.targetHost],
  ]);

  if (targets.length > 0) {
    return targets;
  }

  return pick([
    [SecurityEntityType.IpAddress, event.principalIp],
    [SecurityEntityType.IpAddress, event.targetIp],
  ]).slice(0, 1);
}

/*
 * A connection's imported alerts, at every severity - the product judged
 * them, and an alert below the connection's Open Cases From still says
 * something about who it names. Each of the product's rules is a source of
 * its own, so one product rule firing all day counts once.
 */
export function riskFindingsForImportedAlerts(data: {
  connection: SecurityEventConnection;
  productName: string;
  events: Array<NormalizedSecurityEvent>;
}): Array<SecurityRiskFinding> {
  const connectionId: ObjectID | undefined = data.connection.id || undefined;
  const projectId: ObjectID | undefined =
    data.connection.projectId || undefined;

  if (!connectionId || !projectId) {
    return [];
  }

  const alerts: Array<NormalizedSecurityEvent> = data.events
    .filter((event: NormalizedSecurityEvent): boolean => {
      return IMPORTED_ALERT_CLASS_UIDS.includes(event.classUid);
    })
    .sort((a: NormalizedSecurityEvent, b: NormalizedSecurityEvent): number => {
      return (
        (OcsfSeverityId[b.severityName] || 0) -
        (OcsfSeverityId[a.severityName] || 0)
      );
    })
    .slice(0, IMPORTED_ALERT_RISK_LIMIT);

  const findings: Array<SecurityRiskFinding> = [];

  for (const event of alerts) {
    const points: number = getRiskPointsForSeverity(event.severityName);
    const entities: Array<SecurityEntity> = importedAlertRiskEntities(event);

    if (points <= 0 || entities.length === 0) {
      continue;
    }

    const ruleName: string = (event.ruleName || "").trim();

    findings.push({
      projectId,
      source: SecurityDetectionSource.ConnectedProduct,
      sourceKey: `connection:${connectionId.toString()}:${(
        ruleName || data.productName
      ).toLowerCase()}`,
      sourceName: ruleName
        ? `${ruleName} (${data.productName})`
        : data.productName,
      severity: event.severityName,
      points,
      entities,
      mitreTactics: event.mitreTactics,
      mitreTechniques: event.mitreTechniques,
      seenAt: event.time,
      securityEventConnectionId: connectionId,
    });
  }

  return findings;
}

// One issue Data Security opened, as its risk reads it.
export interface DataSecurityRiskIssue {
  // The check that failed: each check is a source of its own.
  checkId: string;
  title: string;
  severity: SecuritySeverity;
  // The store's key (DataStore.storeKey), which its entity is named by.
  dataStoreKey: string;
  seenAt: Date;
}

const DATA_SECURITY_OCSF_SEVERITY: Readonly<
  Record<SecuritySeverity, OcsfSeverity>
> = {
  [SecuritySeverity.Critical]: OcsfSeverity.Critical,
  [SecuritySeverity.High]: OcsfSeverity.High,
  [SecuritySeverity.Medium]: OcsfSeverity.Medium,
  [SecuritySeverity.Low]: OcsfSeverity.Low,
};

/*
 * The issues Data Security opened, each about the store it was found on -
 * the store's Data Store entity, as the issue's case names it - at the
 * points of its severity. Each check is a source of its own, as each rule
 * is: the same check failing on a store again in the week adds nothing
 * more, a second check failing on it adds its own. Called with the issues
 * an evaluation opened (DataSecurityIntegrations), after their cases.
 */
export function riskFindingsForDataSecurityIssues(data: {
  projectId: ObjectID;
  issues: Array<DataSecurityRiskIssue>;
}): Array<SecurityRiskFinding> {
  const findings: Array<SecurityRiskFinding> = [];

  for (const issue of data.issues) {
    const checkId: string = (issue.checkId || "").trim();
    const severity: OcsfSeverity =
      DATA_SECURITY_OCSF_SEVERITY[issue.severity] || OcsfSeverity.Medium;
    const points: number = getRiskPointsForSeverity(severity);
    const entities: Array<SecurityEntity> = getRiskEntities(
      (issue.dataStoreKey || "").trim()
        ? [
            {
              type: SecurityEntityType.DataStore,
              value: getDataStoreEntityValue(issue.dataStoreKey),
            },
          ]
        : [],
    );

    if (!checkId || points <= 0 || entities.length === 0) {
      continue;
    }

    findings.push({
      projectId: data.projectId,
      source: SecurityDetectionSource.DataSecurity,
      sourceKey: `data-security:${checkId.toLowerCase()}`,
      sourceName: (issue.title || "").trim() || checkId,
      severity,
      points,
      entities,
      mitreTactics: [],
      mitreTechniques: [],
      seenAt: issue.seenAt,
    });
  }

  return findings;
}
