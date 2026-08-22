import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import SigmaRule, { SigmaLevel } from "../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import DetectionRuleService from "../../Services/DetectionRuleService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../Services/OpenTelemetryIngestService";
import SecurityEventService, {
  DetectionMatchGroup,
} from "../../Services/SecurityEventService";
import { resolveTelemetryRetentionInDays } from "../../../Types/Telemetry/TelemetryRetentionConfig";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { Statement } from "../AnalyticsDatabase/Statement";
import SigmaClickhouseCompiler, {
  buildSigmaFieldExpression,
} from "./Sigma/SigmaClickhouseCompiler";
import { buildSecurityEventDbRow } from "./SecurityEventRow";

const DETECTION_FINDING_CLASS_UID: number = 2004;
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
        shouldCreateAlert: true,
        shouldWriteDetectionFinding: true,
        alertSeverityId: true,
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

        if (rule.id) {
          await DetectionRuleService.updateOneById({
            id: rule.id,
            data: {
              lastEvaluatedAt: OneUptimeDate.getCurrentDate(),
              lastError: error instanceof Error ? error.message : String(error),
            },
            props: {
              isRoot: true,
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

    const groups: Array<DetectionMatchGroup> =
      await SecurityEventService.findDetectionMatches({
        projectId: rule.projectId,
        startTime,
        endTime,
        whereFragment,
        groupByExpression,
        maxGroups: MAX_GROUPS_PER_EVALUATION,
      });

    const matchedGroups: Array<DetectionMatchGroup> = groups.filter(
      (row: DetectionMatchGroup): boolean => {
        return row.matchCount > 0;
      },
    );

    let alertsCreated: number = 0;
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
     * resolved alert can re-open as a fresh one.
     */
    const fingerprints: Array<string> = matchedGroups.map(
      (matchGroup: DetectionMatchGroup): string => {
        return this.buildFingerprint(rule.id!, matchGroup.groupValue);
      },
    );

    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId,
        currentAlertState: {
          isResolvedState: false,
        },
      },
      select: {
        _id: true,
        seriesFingerprint: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const openFingerprints: Set<string> = new Set<string>(
      openAlerts
        .map((alert: Alert): string => {
          return alert.seriesFingerprint || "";
        })
        .filter((fingerprint: string): boolean => {
          return Boolean(fingerprint);
        }),
    );

    let created: number = 0;

    for (let index: number = 0; index < matchedGroups.length; index++) {
      const matchGroup: DetectionMatchGroup = matchedGroups[index]!;
      const fingerprint: string = fingerprints[index]!;

      if (openFingerprints.has(fingerprint)) {
        continue;
      }

      const alert: Alert = new Alert();
      alert.projectId = projectId;
      alert.title = matchGroup.groupValue
        ? `[Detection] ${rule.name} — ${matchGroup.groupValue}`
        : `[Detection] ${rule.name}`;

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

      if (matchGroup.sampleMessage) {
        descriptionParts.push(`Sample event: ${matchGroup.sampleMessage}`);
      }

      if (matchGroup.sampleObservables.length > 0) {
        descriptionParts.push(
          `Observables: ${matchGroup.sampleObservables.slice(0, 20).join(", ")}`,
        );
      }

      alert.description = descriptionParts.join("\n\n");
      alert.alertSeverityId = alertSeverityId;
      alert.seriesFingerprint = fingerprint;
      alert.isCreatedAutomatically = true;
      alert.rootCause = `Sigma detection rule "${rule.name}" matched security events.`;

      try {
        await AlertService.create({
          data: alert,
          props: {
            isRoot: true,
          },
        });
        created++;
      } catch (error) {
        logger.error(
          `DetectionRuleEvaluator: failed creating alert for rule ${rule.id?.toString()}:`,
        );
        logger.error(error);
      }
    }

    return created;
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
        const normalized: NormalizedSecurityEvent = {
          time: OneUptimeDate.getCurrentDate(),
          eventUid: `detection:${rule.id!.toString()}:${this.buildFingerprint(
            rule.id!,
            matchGroup.groupValue,
          )}:${OneUptimeDate.getCurrentDateAsUnixNano()}`,
          categoryUid,
          categoryName,
          classUid: DETECTION_FINDING_CLASS_UID,
          className: "Detection Finding",
          activityName: "Create",
          severityId: OcsfSeverityId[severityName],
          severityName,
          statusName: "New",
          message: matchGroup.groupValue
            ? `Detection: ${rule.name} — ${matchGroup.groupValue} (${matchGroup.matchCount} events)`
            : `Detection: ${rule.name} (${matchGroup.matchCount} events)`,
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
            "oneuptime.detection.rule_id": rule.id!.toString(),
            "oneuptime.detection.rule_name": rule.name || parsedRule.title,
            "oneuptime.detection.match_count": String(matchGroup.matchCount),
            ...(matchGroup.groupValue
              ? { "oneuptime.detection.group_value": matchGroup.groupValue }
              : {}),
            ...(parsedRule.id
              ? { "oneuptime.detection.sigma_id": parsedRule.id }
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
   */
  private static async resolveAlertSeverityId(data: {
    projectId: ObjectID;
    rule: DetectionRule;
    parsedRule: SigmaRule;
  }): Promise<ObjectID | null> {
    const severities: Array<AlertSeverity> = await AlertSeverityService.findBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    if (severities.length === 0) {
      return null;
    }

    if (data.rule.alertSeverityId) {
      const explicit: AlertSeverity | undefined = severities.find(
        (severity: AlertSeverity): boolean => {
          return (
            severity.id?.toString() === data.rule.alertSeverityId?.toString()
          );
        },
      );

      if (explicit && explicit.id) {
        return explicit.id;
      }
    }

    const level: SigmaLevel = data.parsedRule.level;

    const nameMatch: AlertSeverity | undefined = severities.find(
      (severity: AlertSeverity): boolean => {
        return (severity.name || "").toLowerCase() === level.toLowerCase();
      },
    );

    if (nameMatch && nameMatch.id) {
      return nameMatch.id;
    }

    const isSevere: boolean =
      level === SigmaLevel.Critical || level === SigmaLevel.High;

    const chosen: AlertSeverity = isSevere
      ? severities[0]!
      : severities[severities.length - 1]!;

    return chosen.id || null;
  }
}
