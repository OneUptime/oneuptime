import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import SigmaRule, { SigmaLevel } from "../../../Types/SecurityEvent/SigmaRule";
import {
  DETECTION_DISTINCT_COUNT_ATTRIBUTE,
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_MATCH_COUNT_ATTRIBUTE,
  DETECTION_RULE_ID_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
  DETECTION_SIGMA_ID_ATTRIBUTE,
} from "../../../Types/SecurityEvent/DetectionFindingConstants";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import DetectionRuleService from "../../Services/DetectionRuleService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../Services/OpenTelemetryIngestService";
import SecurityEventService, {
  DetectionMatchGroup,
  doesGroupMeetDetectionThreshold,
} from "../../Services/SecurityEventService";
import { resolveTelemetryRetentionInDays } from "../../../Types/Telemetry/TelemetryRetentionConfig";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { Statement } from "../AnalyticsDatabase/Statement";
import ConnectorErrorMessage from "./ConnectorErrorMessage";
import {
  AlertableMatch,
  openDedupedAlerts,
  openDedupedIncidents,
  resolveAlertSeverityIdForProject,
  resolveIncidentSeverityIdForProject,
} from "./SecurityEventAlerting";
import SigmaClickhouseCompiler, {
  buildSigmaDistinctCountExpression,
  buildSigmaFieldExpression,
} from "./Sigma/SigmaClickhouseCompiler";
import { buildSecurityEventDbRow } from "./SecurityEventRow";

const DETECTIONS_SERVICE_NAME: string = "OneUptime Detections";

/*
 * Cap on how far back one evaluation may scan, whatever lastEvaluatedAt
 * says — a rule re-enabled after a month must not trigger a month-long
 * table scan.
 */
const MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;

// One alert per distinct group value per cycle, at most.
const MAX_GROUPS_PER_EVALUATION: number = 100;

const SIGMA_LEVEL_TO_OCSF: Record<SigmaLevel, OcsfSeverity> = {
  [SigmaLevel.Informational]: OcsfSeverity.Informational,
  [SigmaLevel.Low]: OcsfSeverity.Low,
  [SigmaLevel.Medium]: OcsfSeverity.Medium,
  [SigmaLevel.High]: OcsfSeverity.High,
  [SigmaLevel.Critical]: OcsfSeverity.Critical,
};

export interface DetectionRuleEvaluationResult {
  ruleId: string;
  matchedGroups: number;
  totalMatches: number;
  alertsCreated: number;
  incidentsCreated: number;
  findingsWritten: number;
  error: string | null;
}

/*
 * The detections-as-code engine: every minute, evaluate due Sigma rules
 * against the SecurityEvent table; matches open deduped alerts and write
 * Detection Finding rows back into the events table.
 */
export default class DetectionRuleEvaluator {
  @CaptureSpan()
  public static async evaluateAllDueRules(): Promise<void> {
    const rules: Array<DetectionRule> = await DetectionRuleService.findBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        description: true,
        sigmaRuleYaml: true,
        evaluationIntervalInMinutes: true,
        groupByField: true,
        distinctCountField: true,
        matchCountThreshold: true,
        shouldCreateAlert: true,
        shouldWriteDetectionFinding: true,
        shouldCreateIncident: true,
        alertSeverityId: true,
        incidentSeverityId: true,
        lastEvaluatedAt: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const rule of rules) {
      const intervalInMinutes: number = Math.max(
        1,
        rule.evaluationIntervalInMinutes || 1,
      );

      if (rule.lastEvaluatedAt) {
        const dueAt: Date = OneUptimeDate.addRemoveMinutes(
          rule.lastEvaluatedAt,
          intervalInMinutes,
        );

        if (OneUptimeDate.isAfter(dueAt, now)) {
          continue;
        }
      }

      try {
        await this.evaluateRule(rule);
      } catch (error) {
        logger.error(
          `DetectionRuleEvaluator: error evaluating rule ${rule.id?.toString()}:`,
        );
        logger.error(error);

        /*
         * Best-effort bookkeeping, guarded for the same reason as the
         * SecOps poller's: one rule whose error will not store must not
         * throw its way out of this loop and stop every other rule in
         * the project from being evaluated. ClickHouse errors echo the
         * failing query back, so they are the long ones.
         */
        if (rule.id) {
          const ruleId: ObjectID = rule.id;

          await ConnectorErrorMessage.recordFailure({
            label: `DetectionRuleEvaluator: rule ${ruleId.toString()}`,
            write: async (): Promise<void> => {
              await DetectionRuleService.updateOneById({
                id: ruleId,
                data: {
                  lastEvaluatedAt: OneUptimeDate.getCurrentDate(),
                  lastError: ConnectorErrorMessage.toMessage(error),
                },
                props: {
                  isRoot: true,
                },
              });
            },
          });
        }
      }
    }
  }

  @CaptureSpan()
  public static async evaluateRule(
    rule: DetectionRule,
  ): Promise<DetectionRuleEvaluationResult> {
    if (!rule.id || !rule.projectId || !rule.sigmaRuleYaml) {
      throw new Error("Detection rule is missing id, projectId, or YAML.");
    }

    const parsedRule: SigmaRule = SigmaRuleParser.parse(rule.sigmaRuleYaml);
    const whereFragment: Statement =
      SigmaClickhouseCompiler.compile(parsedRule);

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const intervalInMinutes: number = Math.max(
      1,
      rule.evaluationIntervalInMinutes || 1,
    );

    const earliestAllowed: Date = OneUptimeDate.addRemoveMinutes(
      endTime,
      -MAX_LOOKBACK_IN_MINUTES,
    );

    let startTime: Date = rule.lastEvaluatedAt
      ? rule.lastEvaluatedAt
      : OneUptimeDate.addRemoveMinutes(endTime, -intervalInMinutes);

    if (OneUptimeDate.isBefore(startTime, earliestAllowed)) {
      startTime = earliestAllowed;
    }

    const groupByExpression: Statement | null = rule.groupByField
      ? buildSigmaFieldExpression(rule.groupByField)
      : null;

    const distinctCountExpression: Statement | null = rule.distinctCountField
      ? buildSigmaDistinctCountExpression(rule.distinctCountField)
      : null;

    const matchCountThreshold: number = this.effectiveThreshold(rule);

    const groups: Array<DetectionMatchGroup> =
      await SecurityEventService.findDetectionMatches({
        projectId: rule.projectId,
        startTime,
        endTime,
        whereFragment,
        groupByExpression,
        distinctCountExpression,
        minMatchCount: matchCountThreshold,
        maxGroups: MAX_GROUPS_PER_EVALUATION,
      });

    /*
     * The query's HAVING clause already enforces the threshold — this
     * re-applies it (via the predicate exported next to that HAVING
     * builder) so the firing contract does not depend on which side
     * built the rows.
     */
    const matchedGroups: Array<DetectionMatchGroup> = groups.filter(
      (row: DetectionMatchGroup): boolean => {
        return doesGroupMeetDetectionThreshold({
          group: row,
          usesDistinctCount: Boolean(rule.distinctCountField),
          minMatchCount: matchCountThreshold,
        });
      },
    );

    let alertsCreated: number = 0;
    let incidentsCreated: number = 0;
    let findingsWritten: number = 0;
    let totalMatches: number = 0;

    for (const matchGroup of matchedGroups) {
      totalMatches += matchGroup.matchCount;
    }

    if (matchedGroups.length > 0) {
      if (rule.shouldCreateAlert !== false) {
        alertsCreated = await this.openAlertsForMatches({
          rule,
          parsedRule,
          matchedGroups,
          startTime,
          endTime,
        });
      }

      /*
       * === true, not !== false like the alert gate: incidents are the
       * heavy machinery (on-call, SLAs, status pages), and the column
       * defaults to false — a rule fetched without the column selected
       * must read as off, never as "probably on".
       */
      if (rule.shouldCreateIncident === true) {
        incidentsCreated = await this.openIncidentsForMatches({
          rule,
          parsedRule,
          matchedGroups,
          startTime,
          endTime,
        });
      }

      if (rule.shouldWriteDetectionFinding !== false) {
        findingsWritten = await this.writeDetectionFindings({
          rule,
          parsedRule,
          matchedGroups,
        });
      }
    }

    await DetectionRuleService.updateOneById({
      id: rule.id,
      data: {
        lastEvaluatedAt: endTime,
        lastError: null as unknown as string,
        ...(matchedGroups.length > 0 ? { lastMatchAt: endTime } : {}),
      },
      props: {
        isRoot: true,
      },
    });

    return {
      ruleId: rule.id.toString(),
      matchedGroups: matchedGroups.length,
      totalMatches,
      alertsCreated,
      incidentsCreated,
      findingsWritten,
      error: null,
    };
  }

  private static async openAlertsForMatches(data: {
    rule: DetectionRule;
    parsedRule: SigmaRule;
    matchedGroups: Array<DetectionMatchGroup>;
    startTime: Date;
    endTime: Date;
  }): Promise<number> {
    const { rule, parsedRule, matchedGroups } = data;
    const projectId: ObjectID = rule.projectId!;

    const alertSeverityId: ObjectID | null = await this.resolveAlertSeverityId({
      projectId,
      rule,
      parsedRule,
    });

    if (!alertSeverityId) {
      logger.warn(
        `DetectionRuleEvaluator: project ${projectId.toString()} has no alert severities; skipping alert creation for rule ${rule.id?.toString()}.`,
      );
      return 0;
    }

    /*
     * Dedupe: one open alert per (rule, group value). Fingerprints are
     * stable across cycles, so a still-firing rule updates nothing and a
     * resolved alert can re-open as a fresh one. The fingerprint-scoped
     * dedupe and per-create guarding live in SecurityEventAlerting,
     * shared with the threat-intel matcher.
     */
    return openDedupedAlerts({
      projectId,
      alertSeverityId,
      logLabel: `DetectionRuleEvaluator: rule ${rule.id?.toString()}`,
      matches: matchedGroups.map(
        (matchGroup: DetectionMatchGroup): AlertableMatch => {
          return {
            fingerprint: this.buildFingerprint(rule.id!, matchGroup.groupValue),
            title: this.buildMatchTitle(rule, matchGroup),
            description: this.buildMatchDescription({
              rule,
              parsedRule,
              matchGroup,
              startTime: data.startTime,
              endTime: data.endTime,
            }),
            rootCause: `Sigma detection rule "${rule.name}" matched security events.`,
          };
        },
      ),
    });
  }

  /*
   * The incident twin of openAlertsForMatches: same fingerprint, same
   * title and description, deduped against the project's UNRESOLVED
   * incidents the same way alerts dedupe against open alerts. Kept as a
   * separate method rather than a parameterized one because the two
   * models genuinely differ where it matters — severity comes from
   * IncidentSeverity, and IncidentService.create is far heavier
   * (workspace channels, SLAs, on-call execution), so each create is
   * wrapped so one failing project cannot sink the whole rule.
   *
   * Detection incidents carry no monitors, so monitor-driven auto-resolve
   * never touches them: the fingerprint dedupe is the only thing keeping
   * a still-firing rule from stacking incidents. Dedupe must therefore
   * run BEFORE create — incident numbers are user-visible and consumed
   * per create.
   */
  private static async openIncidentsForMatches(data: {
    rule: DetectionRule;
    parsedRule: SigmaRule;
    matchedGroups: Array<DetectionMatchGroup>;
    startTime: Date;
    endTime: Date;
  }): Promise<number> {
    const { rule, parsedRule, matchedGroups } = data;
    const projectId: ObjectID = rule.projectId!;

    const incidentSeverityId: ObjectID | null =
      await this.resolveIncidentSeverityId({
        projectId,
        rule,
        parsedRule,
      });

    if (!incidentSeverityId) {
      logger.warn(
        `DetectionRuleEvaluator: project ${projectId.toString()} has no incident severities; skipping incident creation for rule ${rule.id?.toString()}.`,
      );
      return 0;
    }

    return openDedupedIncidents({
      projectId,
      incidentSeverityId,
      logLabel: `DetectionRuleEvaluator: rule ${rule.id?.toString()}`,
      matches: matchedGroups.map(
        (matchGroup: DetectionMatchGroup): AlertableMatch => {
          return {
            fingerprint: this.buildFingerprint(rule.id!, matchGroup.groupValue),
            title: this.buildMatchTitle(rule, matchGroup),
            description: this.buildMatchDescription({
              rule,
              parsedRule,
              matchGroup,
              startTime: data.startTime,
              endTime: data.endTime,
            }),
            rootCause: `Sigma detection rule "${rule.name}" matched security events.`,
          };
        },
      ),
    });
  }

  private static buildMatchTitle(
    rule: DetectionRule,
    matchGroup: DetectionMatchGroup,
  ): string {
    return matchGroup.groupValue
      ? `[Detection] ${rule.name} — ${matchGroup.groupValue}`
      : `[Detection] ${rule.name}`;
  }

  private static buildMatchDescription(data: {
    rule: DetectionRule;
    parsedRule: SigmaRule;
    matchGroup: DetectionMatchGroup;
    startTime: Date;
    endTime: Date;
  }): string {
    const { rule, parsedRule, matchGroup } = data;
    const descriptionParts: Array<string> = [];

    if (rule.description || parsedRule.description) {
      descriptionParts.push(rule.description || parsedRule.description);
    }

    descriptionParts.push(
      `Detection rule matched ${matchGroup.matchCount} security event${
        matchGroup.matchCount === 1 ? "" : "s"
      } between ${OneUptimeDate.getDateAsFormattedString(
        data.startTime,
      )} and ${OneUptimeDate.getDateAsFormattedString(data.endTime)}.`,
    );

    if (rule.distinctCountField) {
      descriptionParts.push(
        `${matchGroup.distinctCount} distinct ${rule.distinctCountField} value${
          matchGroup.distinctCount === 1 ? "" : "s"
        } across these events (rule threshold: ${this.effectiveThreshold(
          rule,
        )}).`,
      );
    }

    if (matchGroup.sampleMessage) {
      descriptionParts.push(`Sample event: ${matchGroup.sampleMessage}`);
    }

    if (matchGroup.sampleObservables.length > 0) {
      descriptionParts.push(
        `Observables: ${matchGroup.sampleObservables.slice(0, 20).join(", ")}`,
      );
    }

    return descriptionParts.join("\n\n");
  }

  private static async writeDetectionFindings(data: {
    rule: DetectionRule;
    parsedRule: SigmaRule;
    matchedGroups: Array<DetectionMatchGroup>;
  }): Promise<number> {
    const { rule, parsedRule, matchedGroups } = data;
    const projectId: ObjectID = rule.projectId!;

    const serviceMetadata: TelemetryServiceMetadata =
      await OTelIngestService.telemetryServiceFromName({
        serviceName: DETECTIONS_SERVICE_NAME,
        projectId,
      });

    const retentionDays: number = resolveTelemetryRetentionInDays({
      pillar: "securityEvents",
      serviceConfig: serviceMetadata.serviceRetentionConfig,
      serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
      projectConfig: serviceMetadata.projectRetentionConfig,
      projectRetentionInDays: serviceMetadata.projectRetentionInDays,
    });

    const severityName: OcsfSeverity =
      SIGMA_LEVEL_TO_OCSF[parsedRule.level] || OcsfSeverity.Medium;

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    const rows: Array<JSONObject> = matchedGroups.map(
      (matchGroup: DetectionMatchGroup): JSONObject => {
        const distinctSuffix: string = rule.distinctCountField
          ? `, ${matchGroup.distinctCount} distinct ${rule.distinctCountField}`
          : "";

        const normalized: NormalizedSecurityEvent = {
          time: OneUptimeDate.getCurrentDate(),
          eventUid: `detection:${rule.id!.toString()}:${this.buildFingerprint(
            rule.id!,
            matchGroup.groupValue,
          )}:${OneUptimeDate.getCurrentDateAsUnixNano()}`,
          categoryUid,
          categoryName,
          classUid: DETECTION_FINDING_CLASS_UID,
          className: DETECTION_FINDING_CLASS_NAME,
          activityName: "Create",
          severityId: OcsfSeverityId[severityName],
          severityName,
          statusName: "New",
          message: matchGroup.groupValue
            ? `Detection: ${rule.name} — ${matchGroup.groupValue} (${matchGroup.matchCount} events${distinctSuffix})`
            : `Detection: ${rule.name} (${matchGroup.matchCount} events${distinctSuffix})`,
          vendorName: "OneUptime",
          productName: "OneUptime Detections",
          ruleId: rule.id!.toString(),
          ruleName: rule.name || parsedRule.title,
          mitreTactics: parsedRule.mitreTactics,
          mitreTechniques: parsedRule.mitreTechniques,
          principalUser: "",
          principalHost: "",
          principalIp: "",
          principalProcess: "",
          targetUser: "",
          targetHost: "",
          targetIp: "",
          targetPort: 0,
          targetResource: "",
          observables: matchGroup.groupValue
            ? [
                matchGroup.groupValue,
                ...matchGroup.sampleObservables.filter(
                  (observable: string): boolean => {
                    return observable !== matchGroup.groupValue;
                  },
                ),
              ]
            : matchGroup.sampleObservables,
          attributes: {
            [DETECTION_RULE_ID_ATTRIBUTE]: rule.id!.toString(),
            [DETECTION_RULE_NAME_ATTRIBUTE]: rule.name || parsedRule.title,
            [DETECTION_MATCH_COUNT_ATTRIBUTE]: String(matchGroup.matchCount),
            ...(rule.distinctCountField
              ? {
                  [DETECTION_DISTINCT_COUNT_ATTRIBUTE]: String(
                    matchGroup.distinctCount,
                  ),
                }
              : {}),
            ...(matchGroup.groupValue
              ? { [DETECTION_GROUP_VALUE_ATTRIBUTE]: matchGroup.groupValue }
              : {}),
            ...(parsedRule.id
              ? { [DETECTION_SIGMA_ID_ATTRIBUTE]: parsedRule.id }
              : {}),
          },
        };

        return buildSecurityEventDbRow({
          normalized,
          projectId,
          serviceMetadata,
          retentionDays,
        });
      },
    );

    await SecurityEventService.insertJsonRows(rows);

    return rows.length;
  }

  /*
   * Unset and 0 both read as 1 so every rule saved before the threshold
   * column existed keeps its fire-on-any-match behavior.
   */
  private static effectiveThreshold(rule: DetectionRule): number {
    return Math.max(1, rule.matchCountThreshold || 1);
  }

  private static buildFingerprint(
    ruleId: ObjectID,
    groupValue: string,
  ): string {
    return `detection-rule:${ruleId.toString()}:${MetricSeriesFingerprint.computeFingerprint(
      {
        groupValue: groupValue || "",
      },
    )}`;
  }

  /*
   * Alert severity precedence: the rule's explicit severity (validated to
   * belong to this project), else a project severity whose name matches
   * the Sigma level, else severity by rank — critical/high map to the
   * project's most severe (lowest order), everything else to the least
   * severe. Returns null only when the project has no severities at all.
   * The precedence logic lives in SecurityEventAlerting, shared with the
   * threat-intel matcher.
   */
  private static async resolveAlertSeverityId(data: {
    projectId: ObjectID;
    rule: DetectionRule;
    parsedRule: SigmaRule;
  }): Promise<ObjectID | null> {
    return resolveAlertSeverityIdForProject({
      projectId: data.projectId,
      explicitSeverityId: data.rule.alertSeverityId,
      severityLabel: data.parsedRule.level,
      isSevere: this.isSevereLevel(data.parsedRule.level),
    });
  }

  /*
   * Incident severity precedence, identical in shape to the alert
   * resolver: the rule's explicit incident severity (validated to belong
   * to this project — IncidentService.onBeforeCreate rejects cross-project
   * ids with a thrown exception, so pre-validating here keeps a stale id
   * a soft fallback instead of a hard failure), else a name match on the
   * Sigma level, else severity by rank. Null only when the project has no
   * incident severities at all.
   */
  private static async resolveIncidentSeverityId(data: {
    projectId: ObjectID;
    rule: DetectionRule;
    parsedRule: SigmaRule;
  }): Promise<ObjectID | null> {
    return resolveIncidentSeverityIdForProject({
      projectId: data.projectId,
      explicitSeverityId: data.rule.incidentSeverityId,
      severityLabel: data.parsedRule.level,
      isSevere: this.isSevereLevel(data.parsedRule.level),
    });
  }

  private static isSevereLevel(level: SigmaLevel): boolean {
    return level === SigmaLevel.Critical || level === SigmaLevel.High;
  }
}
