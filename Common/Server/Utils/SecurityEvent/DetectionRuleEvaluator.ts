import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import SigmaRule, { SigmaLevel } from "../../../Types/SecurityEvent/SigmaRule";
import {
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
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
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
     * resolved alert can re-open as a fresh one.
     */
    const fingerprints: Array<string> = matchedGroups.map(
      (matchGroup: DetectionMatchGroup): string => {
        return this.buildFingerprint(rule.id!, matchGroup.groupValue);
      },
    );

    /*
     * Scoped to THIS rule's candidate fingerprints (≤ MAX_GROUPS_PER_
     * EVALUATION), not a scan of every open alert: a project with more
     * open alerts than LIMIT_PER_PROJECT would otherwise age still-open
     * detections out of the fetched window and re-open them every cycle.
     */
    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId,
        seriesFingerprint: new Includes(fingerprints),
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
      alert.title = this.buildMatchTitle(rule, matchGroup);
      alert.description = this.buildMatchDescription({
        rule,
        parsedRule,
        matchGroup,
        startTime: data.startTime,
        endTime: data.endTime,
      });
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

    const fingerprints: Array<string> = matchedGroups.map(
      (matchGroup: DetectionMatchGroup): string => {
        return this.buildFingerprint(rule.id!, matchGroup.groupValue);
      },
    );

    /*
     * Same fingerprint-scoped dedupe as the alert path — and it matters
     * more here: a missed fingerprint re-fires IncidentService.create's
     * whole side-effect train and burns a user-visible incident number.
     */
    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId,
        seriesFingerprint: new Includes(fingerprints),
        currentIncidentState: {
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
      openIncidents
        .map((incident: Incident): string => {
          return incident.seriesFingerprint || "";
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

      const incident: Incident = new Incident();
      incident.projectId = projectId;
      incident.title = this.buildMatchTitle(rule, matchGroup);
      incident.description = this.buildMatchDescription({
        rule,
        parsedRule,
        matchGroup,
        startTime: data.startTime,
        endTime: data.endTime,
      });
      incident.incidentSeverityId = incidentSeverityId;
      incident.seriesFingerprint = fingerprint;
      incident.isCreatedAutomatically = true;
      incident.rootCause = `Sigma detection rule "${rule.name}" matched security events.`;

      try {
        /*
         * Per-incident try/catch, like the alert path — but here it also
         * guards IncidentService.onBeforeCreate, which throws when the
         * project has no "created" incident state. That cannot be
         * pre-checked the way an empty severity list can.
         */
        await IncidentService.create({
          data: incident,
          props: {
            isRoot: true,
          },
        });
        created++;
      } catch (error) {
        logger.error(
          `DetectionRuleEvaluator: failed creating incident for rule ${rule.id?.toString()}:`,
        );
        logger.error(error);
      }
    }

    return created;
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
            [DETECTION_RULE_ID_ATTRIBUTE]: rule.id!.toString(),
            [DETECTION_RULE_NAME_ATTRIBUTE]: rule.name || parsedRule.title,
            [DETECTION_MATCH_COUNT_ATTRIBUTE]: String(matchGroup.matchCount),
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

    return this.pickSeverityByPrecedence({
      severities,
      explicitSeverityId: data.rule.alertSeverityId,
      level: data.parsedRule.level,
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
    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
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

    return this.pickSeverityByPrecedence({
      severities,
      explicitSeverityId: data.rule.incidentSeverityId,
      level: data.parsedRule.level,
    });
  }

  /*
   * The precedence logic both resolvers share. Severities arrive sorted
   * by order ascending — lowest order is most severe, per the model's
   * own convention — so "most severe" is the first element and "least
   * severe" the last. An explicit id that is not in the list (deleted, or
   * belonging to another project) falls through silently rather than
   * failing the rule.
   */
  private static pickSeverityByPrecedence<
    TSeverity extends {
      id?: ObjectID | null | undefined;
      name?: string | undefined;
    },
  >(data: {
    severities: Array<TSeverity>;
    explicitSeverityId: ObjectID | undefined;
    level: SigmaLevel;
  }): ObjectID | null {
    const { severities, explicitSeverityId, level } = data;

    if (severities.length === 0) {
      return null;
    }

    if (explicitSeverityId) {
      const explicit: TSeverity | undefined = severities.find(
        (severity: TSeverity): boolean => {
          return severity.id?.toString() === explicitSeverityId.toString();
        },
      );

      if (explicit && explicit.id) {
        return explicit.id;
      }
    }

    const nameMatch: TSeverity | undefined = severities.find(
      (severity: TSeverity): boolean => {
        return (severity.name || "").toLowerCase() === level.toLowerCase();
      },
    );

    if (nameMatch && nameMatch.id) {
      return nameMatch.id;
    }

    const isSevere: boolean =
      level === SigmaLevel.Critical || level === SigmaLevel.High;

    const chosen: TSeverity = isSevere
      ? severities[0]!
      : severities[severities.length - 1]!;

    return chosen.id || null;
  }
}
