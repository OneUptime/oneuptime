import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import { ocsfCategoryForClassUid } from "../../../Types/SecurityEvent/OcsfEventClass";
import SigmaRule, {
  SIGMA_LEVEL_TO_OCSF_SEVERITY,
  isSevereSigmaLevel,
} from "../../../Types/SecurityEvent/SigmaRule";
import {
  DETECTION_CORRELATION_TYPE_ATTRIBUTE,
  DETECTION_DISTINCT_COUNT_ATTRIBUTE,
  DETECTION_EVALUATION_DELAY_IN_SECONDS,
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_MATCH_COUNT_ATTRIBUTE,
  DETECTION_MAX_FINDINGS_PER_EVALUATION,
  DETECTION_MAX_GROUPS_PER_EVALUATION,
  DETECTION_MAX_LOOKBACK_IN_MINUTES,
  DETECTION_RULE_ID_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
  DETECTION_SIGMA_ID_ATTRIBUTE,
  DETECTION_SUMMARY_ATTRIBUTE,
} from "../../../Types/SecurityEvent/DetectionFindingConstants";
import SigmaRuleSetParser, {
  detectionRuleHeader,
} from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  DetectionRuleDefinition,
  SigmaRuleReferenceResolver,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import CorrelationRuleMatcher, {
  CorrelationMatchResult,
} from "./Correlation/CorrelationRuleMatcher";
import { CORRELATION_TEMPORAL_CANDIDATE_LIMIT } from "./Correlation/CorrelationQueries";
import ProjectSigmaRules from "./Correlation/ProjectSigmaRules";
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
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
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
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  detectionOverflowMarkdown,
  detectionRuleMatchMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import {
  DetectionGroupSplit,
  describeDetectionOverflow,
  splitDetectionGroups,
} from "../../../Utils/SecurityEvent/DetectionOverflow";
import Select from "../../Types/Database/Select";
import SecurityProjectWork, {
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "./SecurityProjectWork";
import SecurityCaseIngest, {
  SecurityCaseIngestResult,
  SecurityDetectionSignal,
} from "../SecurityCase/SecurityCaseIngest";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityEntityRiskRecorder from "./EntityRisk/SecurityEntityRiskRecorder";
import { riskFindingsForRuleMatches } from "./EntityRisk/SecurityEntityRiskFindings";
import {
  SecurityEntity,
  SecurityEntityType,
  entitiesFromObservables,
  inferSecurityEntityType,
  mergeSecurityEntities,
  securityEntityTypeForField,
} from "../../../Types/SecurityCase/SecurityEntity";

const DETECTIONS_SERVICE_NAME: string = "OneUptime Detections";

export interface DetectionRuleEvaluationResult {
  ruleId: string;
  // Groups the run recorded (at most DETECTION_MAX_FINDINGS_PER_EVALUATION).
  matchedGroups: number;
  // Of those, the ones past DETECTION_MAX_GROUPS_PER_EVALUATION: one case about the rule holds them.
  overflowGroups: number;
  totalMatches: number;
  alertsCreated: number;
  incidentsCreated: number;
  findingsWritten: number;
  // Cases the matches opened; the rest joined cases already open.
  casesOpened: number;
  error: string | null;
}

/*
 * A setup test (SecuritySetup.runTest): the rule reads only the test's own
 * events (`restrictTo`) over the test's window. Its matches open a case,
 * whose playbooks run only if they stay inside OneUptime, and nothing
 * else: no alert, no incident, no Detection Finding, and the rule's own
 * schedule is left as it was.
 */
export interface DetectionRuleSetupTest {
  restrictTo: Statement;
  startTime: Date;
  endTime: Date;
}

/*
 * The detections-as-code engine: every minute, evaluate due Sigma rules
 * against the SecurityEvent table; matches open deduped alerts and write
 * Detection Finding rows back into the events table.
 *
 * A rule reads up to DETECTION_EVALUATION_DELAY_IN_SECONDS behind the
 * clock, and is due on that clock too, so its windows stay as long as its
 * interval and every event is in the table before its moment is read.
 *
 * The work is spread by project (SecurityProjectWork): the cron queues one
 * turn for each project with a rule due, and a turn evaluates that
 * project's due rules, the longest overdue first.
 */
export const DETECTION_RULES_PROJECT_WORK: SecurityProjectWorkDefinition = {
  jobName: "DetectionRules:EvaluateProject",
  key: "detection-rules",
  maxConcurrentProjects: 16,
};

// What a turn reads of each rule: everything evaluateRule needs.
const DETECTION_RULE_EVALUATION_SELECT: Select<DetectionRule> = {
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
  shouldCreateCase: true,
  riskScore: true,
  alertSeverityId: true,
  incidentSeverityId: true,
  lastEvaluatedAt: true,
};

// Detection Finding rows written per insert.
const DETECTION_FINDING_INSERT_BATCH_SIZE: number = 1000;

export default class DetectionRuleEvaluator {
  // The clock the rules read by: DETECTION_EVALUATION_DELAY_IN_SECONDS behind.
  private static evaluationClock(): Date {
    return OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      -DETECTION_EVALUATION_DELAY_IN_SECONDS,
    );
  }

  // When a rule is next due: one interval after its last run; 0 for a rule that never ran.
  private static dueTime(rule: DetectionRule): number {
    if (!rule.lastEvaluatedAt) {
      return 0;
    }

    return OneUptimeDate.addRemoveMinutes(
      rule.lastEvaluatedAt,
      Math.max(1, rule.evaluationIntervalInMinutes || 1),
    ).getTime();
  }

  private static isDue(rule: DetectionRule, now: Date): boolean {
    return this.dueTime(rule) <= now.getTime();
  }

  /*
   * The cron's half: every enabled rule in the instance, page by page, and
   * one turn queued for each project with a rule due. Returns how many
   * projects were queued.
   */
  @CaptureSpan()
  public static async enqueueProjectsWithDueRules(): Promise<number> {
    const rules: Array<DetectionRule> = await DetectionRuleService.findAllBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        projectId: true,
        evaluationIntervalInMinutes: true,
        lastEvaluatedAt: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    const now: Date = this.evaluationClock();

    return SecurityProjectWork.enqueueProjects(
      DETECTION_RULES_PROJECT_WORK,
      rules
        .filter((rule: DetectionRule): boolean => {
          return this.isDue(rule, now);
        })
        .map((rule: DetectionRule): ObjectID | undefined => {
          return rule.projectId;
        }),
    );
  }

  /*
   * One project's turn: its due rules, the longest overdue first, for as
   * long as the turn has time and keeps its lease. A rule left over is
   * still due next minute and resumes from its own lastEvaluatedAt.
   */
  @CaptureSpan()
  public static async evaluateDueRulesForProject(
    projectId: ObjectID,
    lease: SecurityProjectWorkLease = UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
  ): Promise<void> {
    const rules: Array<DetectionRule> = await DetectionRuleService.findAllBy({
      query: {
        projectId,
        isEnabled: true,
      },
      select: DETECTION_RULE_EVALUATION_SELECT,
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    const now: Date = this.evaluationClock();

    const dueRules: Array<DetectionRule> = rules
      .filter((rule: DetectionRule): boolean => {
        return this.isDue(rule, now);
      })
      .sort((a: DetectionRule, b: DetectionRule): number => {
        return this.dueTime(a) - this.dueTime(b);
      });

    for (const rule of dueRules) {
      if (!lease.hasTimeLeft()) {
        return;
      }

      await this.evaluateRuleRecordingFailure(rule);

      if (!(await lease.keep())) {
        return;
      }
    }
  }

  // evaluateRule, with a failure recorded on the rule rather than thrown.
  private static async evaluateRuleRecordingFailure(
    rule: DetectionRule,
  ): Promise<void> {
    try {
      await this.evaluateRule(rule);
    } catch (error) {
      logger.error(
        `DetectionRuleEvaluator: error evaluating rule ${rule.id?.toString()}:`,
      );
      logger.error(error);

      /*
       * Best-effort bookkeeping, guarded for the same reason as the
       * connection poller's: one rule whose error will not store must not
       * throw its way out of the turn and stop every other rule in the
       * project from being evaluated. ClickHouse errors echo the failing
       * query back, so they are the long ones.
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

  @CaptureSpan()
  public static async evaluateRule(
    rule: DetectionRule,
    options: { setupTest?: DetectionRuleSetupTest | undefined } = {},
  ): Promise<DetectionRuleEvaluationResult> {
    if (!rule.id || !rule.projectId || !rule.sigmaRuleYaml) {
      throw new Error("Detection rule is missing id, projectId, or YAML.");
    }

    const setupTest: DetectionRuleSetupTest | undefined = options.setupTest;
    const definition: DetectionRuleDefinition =
      await this.loadRuleDefinition(rule);
    // What the findings, alerts and cases are written as: the rule, or the correlation.
    const parsedRule: SigmaRule = detectionRuleHeader(definition);

    const endTime: Date = setupTest
      ? setupTest.endTime
      : OneUptimeDate.addRemoveSeconds(
          OneUptimeDate.getCurrentDate(),
          -DETECTION_EVALUATION_DELAY_IN_SECONDS,
        );
    const intervalInMinutes: number = Math.max(
      1,
      rule.evaluationIntervalInMinutes || 1,
    );

    const earliestAllowed: Date = OneUptimeDate.addRemoveMinutes(
      endTime,
      -DETECTION_MAX_LOOKBACK_IN_MINUTES,
    );

    let startTime: Date = rule.lastEvaluatedAt
      ? rule.lastEvaluatedAt
      : OneUptimeDate.addRemoveMinutes(endTime, -intervalInMinutes);

    if (OneUptimeDate.isBefore(startTime, earliestAllowed)) {
      startTime = earliestAllowed;
    }

    if (setupTest) {
      startTime = setupTest.startTime;
    }

    /*
     * A correlation's groups come from its own reads (CorrelationRuleMatcher);
     * a single rule's from its compiled condition, counted by the rule's
     * Group By Field and threshold. Everything after reads them alike.
     */
    let matchedGroups: Array<DetectionMatchGroup>;
    let readNotice: string | null = null;

    if (definition.kind === "correlation") {
      const correlationResult: CorrelationMatchResult =
        await CorrelationRuleMatcher.findMatches({
          projectId: rule.projectId,
          correlation: definition.correlation,
          steps: definition.steps,
          startTime,
          endTime,
          // One more than a run records, so it can tell "more than it reads".
          maxGroups: DETECTION_MAX_FINDINGS_PER_EVALUATION + 1,
          restrictTo: setupTest?.restrictTo,
        });

      matchedGroups = correlationResult.groups;

      if (correlationResult.candidatesCapped) {
        readNotice = `This run checked the ${CORRELATION_TEMPORAL_CANDIDATE_LIMIT} most recently active groups; the next runs check the rest.`;
      }
    } else {
      matchedGroups = await this.findSingleRuleMatches({
        rule,
        parsedRule,
        startTime,
        endTime,
        setupTest,
      });
    }

    /*
     * Every group is recorded; the ones with the highest counts open alerts
     * and cases of their own, and the rest open one case about the rule
     * (DetectionOverflow) - never dropped without a word.
     */
    const split: DetectionGroupSplit<DetectionMatchGroup> =
      splitDetectionGroups(matchedGroups, {
        openLimit: DETECTION_MAX_GROUPS_PER_EVALUATION,
        recordLimit: DETECTION_MAX_FINDINGS_PER_EVALUATION,
      });

    const writesFindings: boolean =
      !setupTest && rule.shouldWriteDetectionFinding !== false;

    const overflowNotice: string | null =
      split.overflow.length > 0 || split.moreThanRead
        ? describeDetectionOverflow({
            kind: "rule",
            matched: split.recorded.length,
            moreThanRead: split.moreThanRead,
            opened: split.opened.length,
            findingsWritten: writesFindings,
          })
        : null;

    let alertsCreated: number = 0;
    let incidentsCreated: number = 0;
    let findingsWritten: number = 0;
    let casesOpened: number = 0;
    let totalMatches: number = 0;
    // Each group's Detection Finding, for the case detection that points at it.
    let findingEventUids: Map<string, string> = new Map();

    for (const matchGroup of split.recorded) {
      totalMatches += matchGroup.matchCount;
    }

    if (split.recorded.length > 0) {
      if (!setupTest && rule.shouldCreateAlert !== false) {
        alertsCreated = await this.openAlertsForMatches({
          rule,
          parsedRule,
          matchedGroups: split.opened,
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
      if (!setupTest && rule.shouldCreateIncident === true) {
        incidentsCreated = await this.openIncidentsForMatches({
          rule,
          parsedRule,
          matchedGroups: split.opened,
          startTime,
          endTime,
        });
      }

      if (writesFindings) {
        findingEventUids = await this.writeDetectionFindings({
          rule,
          parsedRule,
          matchedGroups: split.recorded,
          correlationType:
            definition.kind === "correlation"
              ? definition.correlation.type
              : undefined,
        });
        findingsWritten = findingEventUids.size;
      }

      /*
       * !== false like alerts: cases are where a security team works
       * detections, and a rule saved before the switch existed opens them
       * too. A failure here is logged, never the rule's error - the
       * detections are already recorded as alerts and findings.
       */
      if (setupTest || rule.shouldCreateCase !== false) {
        const signals: Array<SecurityDetectionSignal> = this.buildCaseSignals({
          rule,
          parsedRule,
          matchedGroups: split.opened,
          findingEventUids,
          startTime,
          endTime,
        });

        if (overflowNotice && !setupTest) {
          signals.push(
            this.buildOverflowSignal({
              rule,
              parsedRule,
              overflowGroups: split.overflow,
              summary: overflowNotice,
              startTime,
              endTime,
            }),
          );
        }

        try {
          const ingestResult: SecurityCaseIngestResult =
            await SecurityCaseIngest.recordDetections(
              signals.map(
                (signal: SecurityDetectionSignal): SecurityDetectionSignal => {
                  return setupTest ? { ...signal, isSetupTest: true } : signal;
                },
              ),
            );

          casesOpened = ingestResult.casesOpened;
        } catch (error) {
          logger.error(
            `DetectionRuleEvaluator: rule ${rule.id.toString()} could not record its matches as security cases:`,
          );
          logger.error(error);
        }
      }

      /*
       * Each group the run opens adds to the risk of who it is about,
       * whether the rule opens cases or not - after its cases, so a risk
       * that reaches the threshold joins the case the match opened rather
       * than opening one of its own first. A setup test adds no risk: it is
       * a test, and nothing else is told of it either.
       */
      if (!setupTest) {
        await SecurityEntityRiskRecorder.record(
          riskFindingsForRuleMatches({
            rule,
            parsedRule,
            matchedGroups: split.opened,
            seenAt: endTime,
          }),
        );
      }
    }

    // A setup test leaves the rule's own schedule as it was.
    if (!setupTest) {
      if (overflowNotice) {
        logger.warn(
          `DetectionRuleEvaluator: rule ${rule.id.toString()}: ${overflowNotice}`,
        );
      }

      await DetectionRuleService.updateOneById({
        id: rule.id,
        data: {
          lastEvaluatedAt: endTime,
          /*
           * The rule ran; an overflow, or a correlation that had more groups
           * to check than one run reads, is what its row should say about it.
           */
          lastError: (overflowNotice || readNotice) as unknown as string,
          ...(split.recorded.length > 0 ? { lastMatchAt: endTime } : {}),
        },
        props: {
          isRoot: true,
        },
      });
    }

    return {
      ruleId: rule.id.toString(),
      matchedGroups: split.recorded.length,
      overflowGroups: split.overflow.length,
      totalMatches,
      alertsCreated,
      incidentsCreated,
      findingsWritten,
      casesOpened,
      error: null,
    };
  }

  /*
   * The rule's YAML, parsed: a single Sigma rule, or a correlation with the
   * rules it reads resolved - from its own file, or from the project's other
   * detection rules by their Sigma id or name (read only when the file names
   * one it does not hold). A rule the YAML names that no longer exists is
   * the rule's error, as every parse failure is.
   */
  public static async loadRuleDefinition(
    rule: DetectionRule,
  ): Promise<DetectionRuleDefinition> {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      rule.sigmaRuleYaml || "",
    );

    if (
      definition.kind === "single" ||
      definition.unresolvedReferences.length === 0
    ) {
      return definition;
    }

    const resolveReference: SigmaRuleReferenceResolver =
      await ProjectSigmaRules.load(rule.projectId!, {
        excludeRuleId: rule.id || undefined,
      });

    return SigmaRuleSetParser.parse(rule.sigmaRuleYaml || "", {
      resolveReference,
    });
  }

  /*
   * A single Sigma rule's groups: its compiled condition over the run's
   * window, counted per value of its Group By Field (or Distinct Count
   * Field), the groups that reach its threshold.
   */
  private static async findSingleRuleMatches(data: {
    rule: DetectionRule;
    parsedRule: SigmaRule;
    startTime: Date;
    endTime: Date;
    setupTest: DetectionRuleSetupTest | undefined;
  }): Promise<Array<DetectionMatchGroup>> {
    const { rule, setupTest } = data;
    const ruleWhereFragment: Statement = SigmaClickhouseCompiler.compile(
      data.parsedRule,
    );

    // A setup test reads only its own events.
    const whereFragment: Statement = setupTest
      ? SQL`(`
          .append(ruleWhereFragment)
          .append(") AND (")
          .append(setupTest.restrictTo)
          .append(")")
      : ruleWhereFragment;

    const groupByExpression: Statement | null = rule.groupByField
      ? buildSigmaFieldExpression(rule.groupByField)
      : null;

    const distinctCountExpression: Statement | null = rule.distinctCountField
      ? buildSigmaDistinctCountExpression(rule.distinctCountField)
      : null;

    const matchCountThreshold: number = this.effectiveThreshold(rule);

    const groups: Array<DetectionMatchGroup> =
      await SecurityEventService.findDetectionMatches({
        projectId: rule.projectId!,
        startTime: data.startTime,
        endTime: data.endTime,
        whereFragment,
        groupByExpression,
        distinctCountExpression,
        minMatchCount: matchCountThreshold,
        // One more than a run records, so it can tell "more than it reads".
        maxGroups: DETECTION_MAX_FINDINGS_PER_EVALUATION + 1,
      });

    /*
     * The query's HAVING clause already enforces the threshold — this
     * re-applies it (via the predicate exported next to that HAVING
     * builder) so the firing contract does not depend on which side
     * built the rows.
     */
    return groups.filter((row: DetectionMatchGroup): boolean => {
      return doesGroupMeetDetectionThreshold({
        group: row,
        usesDistinctCount: Boolean(rule.distinctCountField),
        minMatchCount: matchCountThreshold,
      });
    });
  }

  /*
   * The one case signal about a run's overflow: the groups past
   * DETECTION_MAX_GROUPS_PER_EVALUATION. It names no entity - nothing for a
   * playbook to contain - and its fingerprint is the rule's own, so every
   * run that overflows joins the same open case and counts it up.
   */
  public static buildOverflowSignal(data: {
    rule: DetectionRule;
    parsedRule: SigmaRule;
    overflowGroups: Array<DetectionMatchGroup>;
    summary: string;
    startTime: Date;
    endTime: Date;
  }): SecurityDetectionSignal {
    const { rule, parsedRule } = data;
    const ruleName: string = rule.name || parsedRule.title;

    let eventCount: number = 0;

    for (const matchGroup of data.overflowGroups) {
      eventCount += matchGroup.matchCount;
    }

    return {
      projectId: rule.projectId!,
      source: SecurityDetectionSource.DetectionRule,
      fingerprint: `detection-rule:${rule.id!.toString()}:overflow`,
      title: `${ruleName} — more matches than one run opens cases for`,
      description: detectionOverflowMarkdown({
        kind: "rule",
        sourceName: ruleName,
        summary: data.summary,
        windowStart: OneUptimeDate.getDateAsFormattedString(data.startTime),
        windowEnd: OneUptimeDate.getDateAsFormattedString(data.endTime),
        examples: data.overflowGroups
          .map((matchGroup: DetectionMatchGroup): string => {
            return matchGroup.groupValue;
          })
          .filter(Boolean),
      }).toString(),
      severity:
        SIGMA_LEVEL_TO_OCSF_SEVERITY[parsedRule.level] || OcsfSeverity.Medium,
      eventCount,
      entities: [],
      mitreTactics: parsedRule.mitreTactics,
      mitreTechniques: parsedRule.mitreTechniques,
      ruleName,
      detectionRuleId: rule.id!,
      seenAt: data.endTime,
    };
  }

  /*
   * One case signal per matched group: the detection a case holds. The
   * group's value is the entity the detection is about (typed by the field
   * the rule groups on: a principalIp group is an IP address), and the
   * group's sample observables are its other entities.
   */
  public static buildCaseSignals(data: {
    rule: DetectionRule;
    parsedRule: SigmaRule;
    matchedGroups: Array<DetectionMatchGroup>;
    findingEventUids: Map<string, string>;
    startTime: Date;
    endTime: Date;
  }): Array<SecurityDetectionSignal> {
    const { rule, parsedRule } = data;
    const severity: OcsfSeverity =
      SIGMA_LEVEL_TO_OCSF_SEVERITY[parsedRule.level] || OcsfSeverity.Medium;
    const groupEntityType: SecurityEntityType | undefined =
      securityEntityTypeForField(rule.groupByField);

    return data.matchedGroups.map(
      (matchGroup: DetectionMatchGroup): SecurityDetectionSignal => {
        /*
         * A correlation groups by one to three fields, each typed by its
         * own field; a single rule by its Group By Field.
         */
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

        return {
          projectId: rule.projectId!,
          source: SecurityDetectionSource.DetectionRule,
          fingerprint: this.buildFingerprint(rule.id!, matchGroup.groupValue),
          title: matchGroup.groupValue
            ? `${rule.name} — ${matchGroup.groupValue}`
            : rule.name || parsedRule.title,
          description: detectionRuleMatchMarkdown({
            ruleName: rule.name || parsedRule.title,
            ruleDescription: rule.description || parsedRule.description,
            matchCount: matchGroup.matchCount,
            // A correlation counts by its own YAML; its summary says how.
            distinctCount:
              rule.distinctCountField && !matchGroup.summary
                ? {
                    field: rule.distinctCountField,
                    count: matchGroup.distinctCount,
                    threshold: this.effectiveThreshold(rule),
                  }
                : undefined,
            windowStart: OneUptimeDate.getDateAsFormattedString(data.startTime),
            windowEnd: OneUptimeDate.getDateAsFormattedString(data.endTime),
            sampleMessage: matchGroup.sampleMessage || undefined,
            observables: matchGroup.sampleObservables,
            correlationSummary: matchGroup.summary,
          }).toString(),
          severity,
          eventCount: matchGroup.matchCount,
          groupValue: matchGroup.groupValue || undefined,
          entities: mergeSecurityEntities(
            groupEntities,
            entitiesFromObservables(matchGroup.sampleObservables),
          ),
          mitreTactics: parsedRule.mitreTactics,
          mitreTechniques: parsedRule.mitreTechniques,
          ruleName: rule.name || parsedRule.title,
          detectionRuleId: rule.id!,
          sampleMessage: matchGroup.sampleMessage || undefined,
          eventUid: data.findingEventUids.get(matchGroup.groupValue),
          seenAt: data.endTime,
        };
      },
    );
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
            rootCause:
              mdText`Sigma detection rule "${rule.name}" matched security events.`.toString(),
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
            rootCause:
              mdText`Sigma detection rule "${rule.name}" matched security events.`.toString(),
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

    if (matchGroup.summary) {
      descriptionParts.push(`What happened: ${matchGroup.summary}.`);
    } else if (rule.distinctCountField) {
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
    // A correlation rule's type, stamped on its findings so they can be told apart.
    correlationType?: string | undefined;
  }): Promise<Map<string, string>> {
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
      SIGMA_LEVEL_TO_OCSF_SEVERITY[parsedRule.level] || OcsfSeverity.Medium;

    const { categoryUid, categoryName } = ocsfCategoryForClassUid(
      DETECTION_FINDING_CLASS_UID,
    );

    const eventUids: Map<string, string> = new Map();

    const rows: Array<JSONObject> = matchedGroups.map(
      (matchGroup: DetectionMatchGroup): JSONObject => {
        // A correlation's own sentence, or a single rule's distinct count.
        const distinctSuffix: string = matchGroup.summary
          ? `; ${matchGroup.summary}`
          : rule.distinctCountField
            ? `, ${matchGroup.distinctCount} distinct ${rule.distinctCountField}`
            : "";

        const eventUid: string = `detection:${rule.id!.toString()}:${this.buildFingerprint(
          rule.id!,
          matchGroup.groupValue,
        )}:${OneUptimeDate.getCurrentDateAsUnixNano()}`;

        eventUids.set(matchGroup.groupValue, eventUid);

        /*
         * What the finding is about, first in its observables: each value a
         * correlation groups by, or a single rule's group value.
         */
        const groupObservables: Array<string> = matchGroup.groupFields
          ? matchGroup.groupFields.map(
              (entry: { field: string; value: string }): string => {
                return entry.value;
              },
            )
          : matchGroup.groupValue
            ? [matchGroup.groupValue]
            : [];

        const normalized: NormalizedSecurityEvent = {
          time: OneUptimeDate.getCurrentDate(),
          eventUid: eventUid,
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
          processName: "",
          processPath: "",
          processCommandLine: "",
          parentProcessName: "",
          parentProcessPath: "",
          parentProcessCommandLine: "",
          targetUser: "",
          targetHost: "",
          targetIp: "",
          targetPort: 0,
          targetResource: "",
          observables: [
            ...groupObservables,
            ...matchGroup.sampleObservables.filter(
              (observable: string): boolean => {
                return !groupObservables.includes(observable);
              },
            ),
          ],
          attributes: {
            [DETECTION_RULE_ID_ATTRIBUTE]: rule.id!.toString(),
            [DETECTION_RULE_NAME_ATTRIBUTE]: rule.name || parsedRule.title,
            [DETECTION_MATCH_COUNT_ATTRIBUTE]: String(matchGroup.matchCount),
            ...(rule.distinctCountField && !data.correlationType
              ? {
                  [DETECTION_DISTINCT_COUNT_ATTRIBUTE]: String(
                    matchGroup.distinctCount,
                  ),
                }
              : {}),
            ...(data.correlationType
              ? {
                  [DETECTION_CORRELATION_TYPE_ATTRIBUTE]: data.correlationType,
                  ...(matchGroup.summary
                    ? { [DETECTION_SUMMARY_ATTRIBUTE]: matchGroup.summary }
                    : {}),
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

    for (
      let index: number = 0;
      index < rows.length;
      index += DETECTION_FINDING_INSERT_BATCH_SIZE
    ) {
      await SecurityEventService.insertJsonRows(
        rows.slice(index, index + DETECTION_FINDING_INSERT_BATCH_SIZE),
      );
    }

    return eventUids;
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
      isSevere: isSevereSigmaLevel(data.parsedRule.level),
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
      isSevere: isSevereSigmaLevel(data.parsedRule.level),
    });
  }
}
