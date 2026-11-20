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
  DETECTION_MAX_WINDOWS_PER_RUN,
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
  getCorrelationMatchedEventsStart,
} from "./Correlation/CorrelationRuleMatcher";
import {
  CORRELATION_TEMPORAL_CANDIDATE_LIMIT,
  buildCorrelationEventsRead,
} from "./Correlation/CorrelationQueries";
import ProjectSigmaRules from "./Correlation/ProjectSigmaRules";
import DetectionRuleService from "../../Services/DetectionRuleService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../Services/OpenTelemetryIngestService";
import SecurityEventService, {
  DetectionArrivalRead,
  DetectionArrivalWindow,
  DetectionMatchGroup,
  DetectionRunArrival,
  detectionArrivedBy,
  doesGroupMeetDetectionThreshold,
  isDetectionArrivalCandidate,
} from "../../Services/SecurityEventService";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import { resolveTelemetryRetentionInDays } from "../../../Types/Telemetry/TelemetryRetentionConfig";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { Statement } from "../AnalyticsDatabase/Statement";
import { SecurityDetectionMatchedEvents } from "../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import SecurityDetectionMatchedEventsReader from "../SecurityCase/SecurityDetectionMatchedEventsReader";
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
import {
  floorToSecond,
  getArrivalEventTimeBounds as getSecurityEventArrivalTimeBounds,
} from "../../../Types/SecurityEvent/SecurityEventArrival";
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
  SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS,
  SecurityProjectWorkDefinition,
  SecurityProjectWorkLease,
  UNLIMITED_SECURITY_PROJECT_WORK_LEASE,
} from "./SecurityProjectWork";
import SecurityCaseIngest, {
  SecurityCaseIngestResult,
  SecurityDetectionSignal,
} from "../SecurityCase/SecurityCaseIngest";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import { DetectionRuleExceptionShape } from "../../../Types/SecurityEvent/DetectionRuleException";
import DetectionRuleExceptions, {
  andRestrictions,
  buildDetectionRuleExceptionsFilter,
} from "./DetectionRuleExceptions";
import SecurityEntityRiskRecorder from "./EntityRisk/SecurityEntityRiskRecorder";
import SecurityWatchlists, {
  SecurityWatchlistReader,
} from "./Watchlists/SecurityWatchlists";
import {
  RealTimeCountWindow,
  doesRealTimeRuleCountInWindows,
  getRealTimeCountWindow,
} from "../../../Types/SecurityEvent/RealTimeDetection";
import type { RealTimeCandidate } from "./RealTime/RealTimeJobs";
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
  // The rule's exceptions the run read with (DetectionRuleExceptions); none for a setup test.
  exceptionsApplied: number;
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
 * A real-time run (RealTime/RealTimeDetections): the rule reads only the
 * events ingest screened for it (`restrictTo`, their ids) over the times
 * they happened - or, handing a rule over to real time (RealTimeJobs, a
 * window and nothing else), every event that ARRIVED from `startTime` to
 * `endTime`, judged as a scheduled run judges what arrived - and does
 * everything a scheduled run does: alert, incident, finding, case, risk. It
 * leaves the rule's schedule as it was: a real-time rule runs on no
 * interval.
 *
 * A rule that counts in windows (Types/SecurityEvent/RealTimeDetection)
 * reads the window of its interval each of the events (`candidates`) falls
 * in instead, as it stood when they came in (`countWindow`, one run a
 * window, which evaluateRealTime cuts).
 */
export interface DetectionRuleRealTimeRun {
  restrictTo?: Statement | undefined;
  startTime: Date;
  endTime: Date;
  // The events a write handed the rule, when they happened.
  candidates?: Array<RealTimeCandidate> | undefined;
  countWindow?: DetectionRuleCountWindow | undefined;
}

/*
 * One window of a rule that counts, as the events it judges found it: the
 * window of its interval (getRealTimeCountWindow), and those events - a
 * write's in real time, or what arrived in a scheduled run.
 */
export interface DetectionRuleCountWindow {
  window: RealTimeCountWindow;
  arrival: DetectionArrivalRead;
}

/*
 * What a scheduled run, or a rule's handover to real time, judges: every
 * event that arrived (createdAt) after `arrivedAfter`, up to and including
 * `arrivedUntil`, both whole seconds as createdAt is.
 */
export interface DetectionRuleArrivalRange {
  arrivedAfter: Date;
  arrivedUntil: Date;
}

/*
 * What a scheduled run at `now` judges: what arrived since the rule's last
 * run (lastEvaluatedAt, where that run got to), or - a rule that never ran
 * - in the interval before; at most DETECTION_MAX_LOOKBACK_IN_MINUTES back,
 * so a rule turned on again after a month does not read a month. Up to
 * DETECTION_EVALUATION_DELAY_IN_SECONDS ago, so every event stamped by
 * then is in the table.
 */
export function getScheduledArrivalRange(data: {
  now: Date;
  lastEvaluatedAt?: Date | null | undefined;
  evaluationIntervalInMinutes?: number | null | undefined;
}): DetectionRuleArrivalRange {
  const arrivedUntil: Date = floorToSecond(
    OneUptimeDate.addRemoveSeconds(
      data.now,
      -DETECTION_EVALUATION_DELAY_IN_SECONDS,
    ),
  );
  const earliest: Date = OneUptimeDate.addRemoveMinutes(
    arrivedUntil,
    -DETECTION_MAX_LOOKBACK_IN_MINUTES,
  );
  const lastRun: Date | null = data.lastEvaluatedAt
    ? new Date(data.lastEvaluatedAt)
    : null;
  let arrivedAfter: Date =
    lastRun && !Number.isNaN(lastRun.getTime())
      ? floorToSecond(lastRun)
      : OneUptimeDate.addRemoveMinutes(
          arrivedUntil,
          -Math.max(1, data.evaluationIntervalInMinutes || 1),
        );

  if (OneUptimeDate.isBefore(arrivedAfter, earliest)) {
    arrivedAfter = earliest;
  }

  return { arrivedAfter, arrivedUntil };
}

/*
 * When the events a run judges may have happened: up to
 * DETECTION_LATE_EVENT_WINDOW_IN_MINUTES before the first of them arrived,
 * and as far ahead of the last as a source's clock may run
 * (MAX_SECURITY_EVENT_FUTURE_SKEW_IN_MINUTES, past which ingest stamps an
 * event with when it arrived). Every read of the run is held to it, so the
 * table's sort by event time keeps each read to these parts of it. Shared
 * with a scheduled hunt and the Events page (SecurityEventArrival).
 */
export function getArrivalEventTimeBounds(range: DetectionRuleArrivalRange): {
  happenedAfter: Date;
  happenedBefore: Date;
} {
  return getSecurityEventArrivalTimeBounds(range);
}

/*
 * The windows one run of a rule that counts reads, from the windows that
 * hold what arrived (SecurityEventService.findDetectionArrivalWindows,
 * earliest first arrival first, at most maxWindows + 1 of them), and how
 * far through the arrivals the run gets. Up to maxWindows windows: every
 * one, when there are no more. Past that, the run judges only what arrived
 * before the first event of the first window left out - which falls in the
 * windows kept, and no other - and the next run goes on from there. When
 * even that first second holds more windows than the read returned
 * (`readFirstSecond`), the run judges that one second, whole, reading its
 * windows again without a limit.
 */
export function pickArrivalWindows(data: {
  windows: Array<DetectionArrivalWindow>;
  range: DetectionRuleArrivalRange;
  maxWindows: number;
}): {
  judgedUntil: Date;
  windows: Array<DetectionArrivalWindow>;
  readFirstSecond: boolean;
} {
  const byStart: (
    windows: Array<DetectionArrivalWindow>,
  ) => Array<DetectionArrivalWindow> = (
    windows: Array<DetectionArrivalWindow>,
  ): Array<DetectionArrivalWindow> => {
    return [...windows].sort(
      (a: DetectionArrivalWindow, b: DetectionArrivalWindow): number => {
        return a.windowStart.getTime() - b.windowStart.getTime();
      },
    );
  };

  if (data.windows.length <= data.maxWindows) {
    return {
      judgedUntil: data.range.arrivedUntil,
      windows: byStart(data.windows),
      readFirstSecond: false,
    };
  }

  const firstLeftOut: DetectionArrivalWindow = data.windows[data.maxWindows]!;
  const judgedUntil: Date = new Date(
    floorToSecond(firstLeftOut.firstArrivedAt).getTime() - 1000,
  );

  if (judgedUntil.getTime() <= data.range.arrivedAfter.getTime()) {
    return {
      judgedUntil: new Date(data.range.arrivedAfter.getTime() + 1000),
      windows: [],
      readFirstSecond: true,
    };
  }

  return {
    judgedUntil,
    windows: byStart(
      data.windows.filter((window: DetectionArrivalWindow): boolean => {
        return window.firstArrivedAt.getTime() <= judgedUntil.getTime();
      }),
    ),
    readFirstSecond: false,
  };
}

/*
 * The events one judgement reads, and what its matches say they cover.
 */
interface DetectionRuleRead {
  // The read, by when the events happened: from, up to (not including).
  startTime: Date;
  endTime: Date;
  // What the matches say they cover: from (the read's start when left out), up to.
  coveredFrom?: Date | undefined;
  coveredUntil: Date;
  // A setup test's events, a real-time write's, or what arrived in a scheduled run.
  restrictTo?: Statement | undefined;
  // A window of a rule that counts, as the events it judges found it.
  countWindow?: DetectionRuleCountWindow | undefined;
  // Read when each group's earliest match happened, to say from when the matches cover.
  readFirstSeen?: boolean | undefined;
}

// What one judgement did, and what the rule's row should say of it.
interface DetectionRuleJudgement {
  result: DetectionRuleEvaluationResult;
  overflowNotice: string | null;
  readNotice: string | null;
}

/*
 * The detections-as-code engine: every minute, evaluate due Sigma rules
 * against the SecurityEvent table; matches open deduped alerts and write
 * Detection Finding rows back into the events table.
 *
 * A scheduled rule judges the events that ARRIVED since its last run
 * (getScheduledArrivalRange), whenever they happened (#10337): an event
 * that reached OneUptime long after it happened - a batch a log shipper
 * held, a span read when it ended, a flow read in whole windows, a cloud
 * audit log that lags - is judged by the first run after it arrived, once.
 *
 *   - A rule that fires on each match judges those events: each group of
 *     them fires.
 *   - A rule that counts, and a correlation, read the windows of their
 *     interval on the clock that hold those events (as real time cuts
 *     them, getRealTimeCountWindow), each as it stood when the run's last
 *     event arrived, and a group fires when the run's events are what
 *     brought its window to the count (DetectionRunArrival). So a group
 *     fires at most once a window, whether its events arrived on time, late,
 *     out of order or across several runs.
 *
 * A run judges up to DETECTION_EVALUATION_DELAY_IN_SECONDS behind the
 * clock, so every event stamped by then is in the table, and records where
 * it got to only once it has done what its matches ask: a run that fails,
 * or a worker that stops part way, leaves the rule where it was and the
 * next run judges the same events again.
 *
 * The work is spread by project (SecurityProjectWork): the cron queues one
 * turn for each project with a rule due, and a turn evaluates that
 * project's due rules, the longest overdue first, each under a lock of its
 * own (evaluateScheduledRule), so two turns that overlap never judge the
 * same events twice.
 *
 * A real-time rule (isRealTime) is never due: every path that writes
 * security events screens them against it as they arrive
 * (RealTime/RealTimeDetections), and a job confirms what it may match
 * (evaluateRealTime).
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

// ...and what a real-time run reads, to tell a rule turned off or back to its schedule since.
export const DETECTION_RULE_REAL_TIME_SELECT: Select<DetectionRule> = {
  ...DETECTION_RULE_EVALUATION_SELECT,
  isEnabled: true,
  isRealTime: true,
};

// Detection Finding rows written per insert.
const DETECTION_FINDING_INSERT_BATCH_SIZE: number = 1000;

// Room around the events' own times, for the read of the groups they name.
const COUNT_WINDOW_CANDIDATE_PADDING_MS: number = 1000;

/*
 * The windows a write's events fall in, for a rule that counts in real
 * time: one for each window of the rule's interval its events happened in,
 * with the write's events in it and where they came in (the lowest and the
 * highest id: ids are time-ordered), in the order the windows come.
 */
export function getDetectionRuleCountWindows(data: {
  candidates: Array<RealTimeCandidate>;
  evaluationIntervalInMinutes?: number | null | undefined;
}): Array<DetectionRuleCountWindow> {
  const byWindow: Map<
    number,
    { window: RealTimeCountWindow; events: Array<RealTimeCandidate> }
  > = new Map();

  for (const candidate of data.candidates) {
    const time: Date = new Date(candidate.time);

    if (Number.isNaN(time.getTime()) || !candidate.id) {
      continue;
    }

    const window: RealTimeCountWindow = getRealTimeCountWindow({
      time,
      evaluationIntervalInMinutes: data.evaluationIntervalInMinutes,
    });
    const key: number = window.startTime.getTime();
    const entry: {
      window: RealTimeCountWindow;
      events: Array<RealTimeCandidate>;
    } = byWindow.get(key) || { window, events: [] };

    entry.events.push(candidate);
    byWindow.set(key, entry);
  }

  return Array.from(byWindow.values())
    .sort(
      (
        a: { window: RealTimeCountWindow },
        b: { window: RealTimeCountWindow },
      ): number => {
        return a.window.startTime.getTime() - b.window.startTime.getTime();
      },
    )
    .map(
      (entry: {
        window: RealTimeCountWindow;
        events: Array<RealTimeCandidate>;
      }): DetectionRuleCountWindow => {
        const ids: Array<string> = entry.events
          .map((event: RealTimeCandidate): string => {
            return event.id;
          })
          .sort();
        const times: Array<number> = entry.events.map(
          (event: RealTimeCandidate): number => {
            return new Date(event.time).getTime();
          },
        );

        return {
          window: entry.window,
          arrival: {
            candidateIds: ids,
            firstId: ids[0]!,
            lastId: ids[ids.length - 1]!,
            candidateStartTime: new Date(
              Math.min(...times) - COUNT_WINDOW_CANDIDATE_PADDING_MS,
            ),
            candidateEndTime: new Date(
              Math.max(...times) + COUNT_WINDOW_CANDIDATE_PADDING_MS,
            ),
          },
        };
      },
    );
}

// Two runs' results, as one: what a write's windows did between them.
function addEvaluationResults(
  first: DetectionRuleEvaluationResult,
  second: DetectionRuleEvaluationResult,
): DetectionRuleEvaluationResult {
  return {
    ruleId: first.ruleId,
    matchedGroups: first.matchedGroups + second.matchedGroups,
    overflowGroups: first.overflowGroups + second.overflowGroups,
    totalMatches: first.totalMatches + second.totalMatches,
    alertsCreated: first.alertsCreated + second.alertsCreated,
    incidentsCreated: first.incidentsCreated + second.incidentsCreated,
    findingsWritten: first.findingsWritten + second.findingsWritten,
    casesOpened: first.casesOpened + second.casesOpened,
    exceptionsApplied: Math.max(
      first.exceptionsApplied,
      second.exceptionsApplied,
    ),
    error: first.error || second.error,
  };
}

// What a judgement did and should say, with another's: what a run's windows, or a turn's runs, did between them.
function addJudgements(
  first: DetectionRuleJudgement,
  second: DetectionRuleJudgement,
): DetectionRuleJudgement {
  return {
    result: addEvaluationResults(first.result, second.result),
    overflowNotice: second.overflowNotice || first.overflowNotice,
    readNotice: second.readNotice || first.readNotice,
  };
}

/*
 * The lock a scheduled run of a rule holds (evaluateScheduledRule), by the
 * rule's id: one run at a time judges what arrived for it.
 */
export const DETECTION_RULE_RUN_LOCK_NAMESPACE: string = "DetectionRuleRun";

/*
 * The most windows a run reads for the one second its arrivals start in,
 * when that second alone holds more than DETECTION_MAX_WINDOWS_PER_RUN
 * (pickArrivalWindows): a second is judged whole, or not at all.
 */
const DETECTION_FIRST_SECOND_WINDOWS_LIMIT: number = 10000;

export default class DetectionRuleEvaluator {
  // The clock the rules are due by: DETECTION_EVALUATION_DELAY_IN_SECONDS behind.
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
        // A real-time rule checks events as they arrive, on no interval.
        isRealTime: false,
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
        isRealTime: false,
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

    if (dueRules.length === 0) {
      return;
    }

    /*
     * The due rules' exceptions, in one read for the turn: those that take
     * part in any window a rule may read now - what arrived over the last
     * DETECTION_MAX_LOOKBACK_IN_MINUTES, which happened up to
     * DETECTION_LATE_EVENT_WINDOW_IN_MINUTES before that
     * (getArrivalEventTimeBounds). A read that fails fails the turn before
     * any rule runs - every rule resumes from its own last run next minute,
     * so nothing is missed, and no rule runs blind to the exceptions
     * somebody added.
     */
    const readable: { happenedAfter: Date; happenedBefore: Date } =
      getArrivalEventTimeBounds({
        arrivedAfter: OneUptimeDate.addRemoveMinutes(
          now,
          -DETECTION_MAX_LOOKBACK_IN_MINUTES,
        ),
        arrivedUntil: now,
      });

    const exceptionsByRule: Map<
      string,
      Array<DetectionRuleExceptionShape>
    > = await DetectionRuleExceptions.loadForProject({
      projectId,
      ruleIds: dueRules
        .map((rule: DetectionRule): ObjectID | undefined => {
          return rule.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
      from: readable.happenedAfter,
      until: readable.happenedBefore,
      now: OneUptimeDate.getCurrentDate(),
    });

    /*
     * The watchlists the turn's rules read, each read once for the turn
     * however many rules name it (SecurityWatchlists).
     */
    const watchlists: SecurityWatchlistReader =
      SecurityWatchlists.readerFor(projectId);

    for (const rule of dueRules) {
      if (!lease.hasTimeLeft()) {
        return;
      }

      await this.evaluateScheduledRule(rule, {
        exceptions: exceptionsByRule.get(rule.id?.toString() || "") || [],
        watchlists,
        lease,
      });

      if (!(await lease.keep())) {
        return;
      }
    }
  }

  /*
   * One due rule's scheduled run, under the rule's own lock
   * (DETECTION_RULE_RUN_LOCK_NAMESPACE): two turns of the project that
   * overlap - one whose lease ran out while a rule was still running, a job
   * BullMQ started again - never judge the same events for one rule at
   * once. The rule is read again under the lock, so a run that finished
   * since the turn read it is gone on from, not repeated: a rule that is no
   * longer due, turned off or moved to real time is left alone. A rule
   * another run holds is left for the next turn, which resumes from where
   * that run got to.
   */
  private static async evaluateScheduledRule(
    rule: DetectionRule,
    data: {
      exceptions: Array<DetectionRuleExceptionShape>;
      watchlists: SecurityWatchlistReader;
      lease: SecurityProjectWorkLease;
    },
  ): Promise<void> {
    if (!rule.id) {
      return;
    }

    const ruleId: ObjectID = rule.id;
    let lockLost: boolean = false;
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        namespace: DETECTION_RULE_RUN_LOCK_NAMESPACE,
        key: ruleId.toString(),
        lockTimeout: SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
        onLockLost: (): void => {
          lockLost = true;
          logger.warn(
            `DetectionRuleEvaluator: rule ${ruleId.toString()} lost its run lock part way through; it stops after what it is judging now.`,
          );
        },
      });
    } catch {
      // Another run judges this rule's events: the next turn goes on from where it gets to.
      logger.debug(
        `DetectionRuleEvaluator: rule ${ruleId.toString()} is being run elsewhere; left to the next turn.`,
      );
      return;
    }

    try {
      let current: DetectionRule | null;

      try {
        current = await DetectionRuleService.findOneById({
          id: ruleId,
          select: DETECTION_RULE_REAL_TIME_SELECT,
          props: {
            isRoot: true,
          },
        });
      } catch (error) {
        // Read again next turn: nothing was judged, so nothing is lost.
        logger.error(
          `DetectionRuleEvaluator: rule ${ruleId.toString()} could not be read again under its run lock; left to the next turn:`,
        );
        logger.error(error);
        return;
      }

      if (
        !current ||
        current.isEnabled === false ||
        current.isRealTime === true ||
        !this.isDue(current, this.evaluationClock())
      ) {
        return;
      }

      await this.evaluateRuleRecordingFailure(
        current,
        data.exceptions,
        data.watchlists,
        (): boolean => {
          return !lockLost && data.lease.hasTimeLeft();
        },
      );
    } finally {
      await Semaphore.release(mutex).catch((): void => {
        // The lock runs out on its own.
      });
    }
  }

  /*
   * A real-time run of a rule (DetectionRuleRealTimeRun), with a failure
   * recorded on the rule rather than thrown - its Last Error, as a scheduled
   * run's is, but never its schedule.
   */
  @CaptureSpan()
  public static async evaluateRealTime(
    rule: DetectionRule,
    run: DetectionRuleRealTimeRun,
  ): Promise<DetectionRuleEvaluationResult | null> {
    try {
      if (this.isHandover(run)) {
        return await this.handOver(rule, run);
      }

      const countWindows: Array<DetectionRuleCountWindow> | null =
        this.readCountWindows(rule, run);

      // A rule that fires on each event: one run.
      if (!countWindows) {
        return await this.evaluateRule(rule, { realTime: run });
      }

      let total: DetectionRuleEvaluationResult | null = null;

      for (const countWindow of countWindows) {
        const result: DetectionRuleEvaluationResult = await this.evaluateRule(
          rule,
          {
            realTime: {
              startTime: countWindow.window.startTime,
              endTime: countWindow.window.endTime,
              countWindow,
            },
          },
        );

        total = total ? addEvaluationResults(total, result) : result;
      }

      return total;
    } catch (error) {
      logger.error(
        `DetectionRuleEvaluator: real-time run of rule ${rule.id?.toString()} failed:`,
      );
      logger.error(error);

      if (rule.id) {
        const ruleId: ObjectID = rule.id;

        await ConnectorErrorMessage.recordFailure({
          label: `DetectionRuleEvaluator: rule ${ruleId.toString()}`,
          write: async (): Promise<void> => {
            await DetectionRuleService.updateOneById({
              id: ruleId,
              data: {
                lastError: ConnectorErrorMessage.toMessage(error),
              },
              props: {
                isRoot: true,
              },
            });
          },
        });
      }

      return null;
    }
  }

  // A handover (RealTimeJobs) names a window and nothing else: no events of a write.
  private static isHandover(run: DetectionRuleRealTimeRun): boolean {
    return (
      !run.restrictTo &&
      !run.countWindow &&
      !(run.candidates && run.candidates.length > 0)
    );
  }

  /*
   * A rule's handover to real time (RealTimeJobs): what arrived from where
   * its schedule stopped until every process screens for it, judged as a
   * scheduled run judges what arrived - every stretch of it, as the job
   * runs once - so an event that arrived late in between is judged too.
   * The schedule is left as it was: a real-time rule runs on no interval.
   */
  private static async handOver(
    rule: DetectionRule,
    run: DetectionRuleRealTimeRun,
  ): Promise<DetectionRuleEvaluationResult> {
    if (!rule.id || !rule.projectId || !rule.sigmaRuleYaml) {
      throw new Error("Detection rule is missing id, projectId, or YAML.");
    }

    const definition: DetectionRuleDefinition = await this.bindDefinition(
      rule,
      undefined,
    );
    const parsedRule: SigmaRule = detectionRuleHeader(definition);
    const handover: DetectionRuleArrivalRange = {
      arrivedAfter: floorToSecond(run.startTime),
      arrivedUntil: floorToSecond(run.endTime),
    };
    const readable: { happenedAfter: Date; happenedBefore: Date } =
      getArrivalEventTimeBounds(handover);
    const exceptions: Array<DetectionRuleExceptionShape> =
      await DetectionRuleExceptions.loadForRule({
        projectId: rule.projectId,
        ruleId: rule.id,
        from: readable.happenedAfter,
        until: readable.happenedBefore,
        now: OneUptimeDate.getCurrentDate(),
      });

    let arrivedAfter: Date = handover.arrivedAfter;
    let judgement: DetectionRuleJudgement | null = null;

    while (OneUptimeDate.isBefore(arrivedAfter, handover.arrivedUntil)) {
      const judged: { judgedUntil: Date; judgement: DetectionRuleJudgement } =
        await this.judgeArrivals(rule, {
          definition,
          parsedRule,
          range: { arrivedAfter, arrivedUntil: handover.arrivedUntil },
          exceptions,
        });

      judgement = judgement
        ? addJudgements(judgement, judged.judgement)
        : judged.judgement;
      arrivedAfter = judged.judgedUntil;
    }

    const done: DetectionRuleJudgement =
      judgement || this.emptyJudgement(rule, exceptions);

    await this.recordRealTimeRun(rule, {
      overflowNotice: done.overflowNotice,
      matched: done.result.matchedGroups > 0,
      coveredUntil: handover.arrivedUntil,
    });

    return done.result;
  }

  /*
   * The windows a real-time run reads, for a rule that counts in windows
   * and was handed a write's events; null for a rule that fires on each
   * event.
   */
  private static readCountWindows(
    rule: DetectionRule,
    run: DetectionRuleRealTimeRun,
  ): Array<DetectionRuleCountWindow> | null {
    if (run.countWindow || !run.candidates || run.candidates.length === 0) {
      return null;
    }

    const countsInWindows: boolean = doesRealTimeRuleCountInWindows({
      definition: SigmaRuleSetParser.parse(rule.sigmaRuleYaml || ""),
      matchCountThreshold: rule.matchCountThreshold,
      distinctCountField: rule.distinctCountField,
    });

    if (!countsInWindows) {
      return null;
    }

    return getDetectionRuleCountWindows({
      candidates: run.candidates,
      evaluationIntervalInMinutes: rule.evaluationIntervalInMinutes,
    });
  }

  /*
   * evaluateRule, with a failure recorded on the rule rather than thrown.
   * The rule stays where it was: what the run did not finish judging is
   * judged again by the next one, a minute later, so a failed run loses no
   * event.
   */
  private static async evaluateRuleRecordingFailure(
    rule: DetectionRule,
    exceptions: Array<DetectionRuleExceptionShape>,
    watchlists: SecurityWatchlistReader,
    hasTimeLeft: () => boolean,
  ): Promise<void> {
    try {
      await this.evaluateRule(rule, { exceptions, watchlists, hasTimeLeft });
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

  /*
   * One run of a rule. Its exceptions (`exceptions`, or read here when the
   * caller hands none over) skip the events they name before anything is
   * counted. A setup test reads none: it checks that the pipeline works,
   * and an exception must not hide it.
   *
   * The watchlists the rule names are read (through `watchlists`, the
   * turn's reader, or a reader of its own) and bound to it before it is
   * compiled; a list the project no longer has is the run's error.
   *
   * A scheduled run - neither a setup test nor real time - judges what
   * arrived since the rule's last run (runScheduled); `hasTimeLeft` says
   * whether it may go on to the next stretch of a backlog.
   */
  @CaptureSpan()
  public static async evaluateRule(
    rule: DetectionRule,
    options: {
      setupTest?: DetectionRuleSetupTest | undefined;
      realTime?: DetectionRuleRealTimeRun | undefined;
      exceptions?: Array<DetectionRuleExceptionShape> | undefined;
      watchlists?: SecurityWatchlistReader | undefined;
      hasTimeLeft?: (() => boolean) | undefined;
    } = {},
  ): Promise<DetectionRuleEvaluationResult> {
    if (!rule.id || !rule.projectId || !rule.sigmaRuleYaml) {
      throw new Error("Detection rule is missing id, projectId, or YAML.");
    }

    const setupTest: DetectionRuleSetupTest | undefined = options.setupTest;
    const realTime: DetectionRuleRealTimeRun | undefined = setupTest
      ? undefined
      : options.realTime;

    if (!setupTest && !realTime) {
      return await this.runScheduled(rule, options);
    }

    const definition: DetectionRuleDefinition = await this.bindDefinition(
      rule,
      options.watchlists,
    );
    // What the findings, alerts and cases are written as: the rule, or the correlation.
    const parsedRule: SigmaRule = detectionRuleHeader(definition);
    // A window of a rule that counts, as one write found it (evaluateRealTime).
    const countWindow: DetectionRuleCountWindow | undefined =
      realTime?.countWindow;

    // A correlation reads events together: in real time, a window of them, never a handful.
    if (
      definition.kind === "correlation" &&
      realTime?.restrictTo &&
      !countWindow
    ) {
      throw new Error(
        "A correlation reads the window of its interval around the events it is handed, never the events alone.",
      );
    }

    const startTime: Date = setupTest
      ? setupTest.startTime
      : realTime!.startTime;
    const endTime: Date = setupTest ? setupTest.endTime : realTime!.endTime;

    const read: DetectionRuleRead = {
      startTime,
      endTime,
      /*
       * What the matches say they cover: the run's window - for a window of
       * a rule that counts, up to now, as the window is still filling.
       */
      coveredUntil: countWindow
        ? new Date(
            Math.min(
              endTime.getTime(),
              OneUptimeDate.getCurrentDate().getTime(),
            ),
          )
        : endTime,
      restrictTo: setupTest?.restrictTo || realTime?.restrictTo,
      countWindow,
    };

    const exceptions: Array<DetectionRuleExceptionShape> = setupTest
      ? []
      : options.exceptions ||
        (await DetectionRuleExceptions.loadForRule({
          projectId: rule.projectId,
          ruleId: rule.id,
          from: startTime,
          until: endTime,
          now: OneUptimeDate.getCurrentDate(),
        }));

    const judgement: DetectionRuleJudgement = await this.judge(rule, {
      definition,
      parsedRule,
      read,
      exceptions,
      isSetupTest: Boolean(setupTest),
    });

    /*
     * A real-time run says how it went - a match, an overflow - but leaves
     * the schedule as it was: when the rule goes back to its interval, the
     * service starts it from then (DetectionRuleService). A setup test
     * leaves the rule as it was altogether.
     */
    if (realTime) {
      await this.recordRealTimeRun(rule, {
        overflowNotice: judgement.overflowNotice,
        matched: judgement.result.matchedGroups > 0,
        coveredUntil: read.coveredUntil,
      });
    }

    return judgement.result;
  }

  /*
   * A scheduled run: what arrived since the rule's last run
   * (getScheduledArrivalRange), judged a stretch at a time (judgeArrivals)
   * for as long as the turn has time, each stretch recorded on the rule as
   * soon as it is done (lastEvaluatedAt: where the rule got to) - so a run
   * that stops, fails or loses its worker part way leaves the rule where
   * its last finished stretch got it, and the next run judges the rest.
   */
  private static async runScheduled(
    rule: DetectionRule,
    options: {
      exceptions?: Array<DetectionRuleExceptionShape> | undefined;
      watchlists?: SecurityWatchlistReader | undefined;
      hasTimeLeft?: (() => boolean) | undefined;
    },
  ): Promise<DetectionRuleEvaluationResult> {
    const definition: DetectionRuleDefinition = await this.bindDefinition(
      rule,
      options.watchlists,
    );
    const parsedRule: SigmaRule = detectionRuleHeader(definition);
    const scheduled: DetectionRuleArrivalRange = getScheduledArrivalRange({
      now: OneUptimeDate.getCurrentDate(),
      lastEvaluatedAt: rule.lastEvaluatedAt,
      evaluationIntervalInMinutes: rule.evaluationIntervalInMinutes,
    });
    const readable: { happenedAfter: Date; happenedBefore: Date } =
      getArrivalEventTimeBounds(scheduled);
    const exceptions: Array<DetectionRuleExceptionShape> =
      options.exceptions ||
      (await DetectionRuleExceptions.loadForRule({
        projectId: rule.projectId!,
        ruleId: rule.id!,
        from: readable.happenedAfter,
        until: readable.happenedBefore,
        now: OneUptimeDate.getCurrentDate(),
      }));
    const hasTimeLeft: () => boolean =
      options.hasTimeLeft ||
      ((): boolean => {
        return true;
      });

    let arrivedAfter: Date = scheduled.arrivedAfter;
    let total: DetectionRuleEvaluationResult | null = null;

    while (OneUptimeDate.isBefore(arrivedAfter, scheduled.arrivedUntil)) {
      const judged: { judgedUntil: Date; judgement: DetectionRuleJudgement } =
        await this.judgeArrivals(rule, {
          definition,
          parsedRule,
          range: { arrivedAfter, arrivedUntil: scheduled.arrivedUntil },
          exceptions,
        });

      await this.recordScheduledRun(rule, {
        judgedUntil: judged.judgedUntil,
        judgement: judged.judgement,
      });

      total = total
        ? addEvaluationResults(total, judged.judgement.result)
        : judged.judgement.result;
      arrivedAfter = judged.judgedUntil;

      if (!hasTimeLeft()) {
        break;
      }
    }

    return total || this.emptyJudgement(rule, exceptions).result;
  }

  /*
   * One stretch of what arrived for a rule (`range`), judged, and how far
   * through it the judging got:
   *
   *   - A rule that fires on each match: every event of the stretch that
   *     matches, grouped by its Group By Field, read by when it arrived and
   *     held to when it may have happened (getArrivalEventTimeBounds). Its
   *     matches cover events from the first of them.
   *   - A rule that counts, and a correlation: each window of its interval
   *     that holds an event of the stretch it may match, read as it stood
   *     when the stretch's last event arrived, firing a group the stretch
   *     brought to the count. At most DETECTION_MAX_WINDOWS_PER_RUN windows
   *     (pickArrivalWindows): a stretch whose events fall in more is judged
   *     up to where they fill that many.
   */
  private static async judgeArrivals(
    rule: DetectionRule,
    data: {
      definition: DetectionRuleDefinition;
      parsedRule: SigmaRule;
      range: DetectionRuleArrivalRange;
      exceptions: Array<DetectionRuleExceptionShape>;
    },
  ): Promise<{ judgedUntil: Date; judgement: DetectionRuleJudgement }> {
    const { definition, parsedRule, range } = data;
    const readable: { happenedAfter: Date; happenedBefore: Date } =
      getArrivalEventTimeBounds(range);

    const countsInWindows: boolean = doesRealTimeRuleCountInWindows({
      definition,
      matchCountThreshold: rule.matchCountThreshold,
      distinctCountField: rule.distinctCountField,
    });

    if (!countsInWindows) {
      const arrival: DetectionRunArrival = {
        kind: "run",
        arrivedAfter: range.arrivedAfter,
        arrivedUntil: range.arrivedUntil,
        candidateStartTime: readable.happenedAfter,
        candidateEndTime: readable.happenedBefore,
      };

      return {
        judgedUntil: range.arrivedUntil,
        judgement: await this.judge(rule, {
          definition,
          parsedRule,
          exceptions: data.exceptions,
          isSetupTest: false,
          read: {
            startTime: readable.happenedAfter,
            endTime: readable.happenedBefore,
            coveredFrom: range.arrivedAfter,
            coveredUntil: range.arrivedUntil,
            restrictTo: isDetectionArrivalCandidate(arrival),
            readFirstSeen: true,
          },
        }),
      };
    }

    const exceptionsFilter: Statement | null =
      buildDetectionRuleExceptionsFilter(data.exceptions);
    const windowInMinutes: number = Math.max(
      1,
      Math.floor(Number(rule.evaluationIntervalInMinutes) || 1),
    );
    const readWindows: (
      stretch: DetectionRuleArrivalRange,
      limit: number,
    ) => Promise<Array<DetectionArrivalWindow>> = async (
      stretch: DetectionRuleArrivalRange,
      limit: number,
    ): Promise<Array<DetectionArrivalWindow>> => {
      return await SecurityEventService.findDetectionArrivalWindows({
        projectId: rule.projectId!,
        arrivedAfter: stretch.arrivedAfter,
        arrivedUntil: stretch.arrivedUntil,
        ...getArrivalEventTimeBounds(stretch),
        whereFragment:
          andRestrictions(
            this.arrivalCondition(definition, parsedRule),
            exceptionsFilter,
          ) || this.arrivalCondition(definition, parsedRule),
        windowInMinutes,
        limit,
      });
    };

    let picked: {
      judgedUntil: Date;
      windows: Array<DetectionArrivalWindow>;
      readFirstSecond: boolean;
    } = pickArrivalWindows({
      windows: await readWindows(range, DETECTION_MAX_WINDOWS_PER_RUN + 1),
      range,
      maxWindows: DETECTION_MAX_WINDOWS_PER_RUN,
    });

    if (picked.readFirstSecond) {
      picked = pickArrivalWindows({
        windows: await readWindows(
          {
            arrivedAfter: range.arrivedAfter,
            arrivedUntil: picked.judgedUntil,
          },
          DETECTION_FIRST_SECOND_WINDOWS_LIMIT,
        ),
        range: {
          arrivedAfter: range.arrivedAfter,
          arrivedUntil: picked.judgedUntil,
        },
        maxWindows: DETECTION_FIRST_SECOND_WINDOWS_LIMIT,
      });
    }

    let judgement: DetectionRuleJudgement | null = null;

    for (const arrivalWindow of picked.windows) {
      const window: RealTimeCountWindow = getRealTimeCountWindow({
        time: arrivalWindow.windowStart,
        evaluationIntervalInMinutes: windowInMinutes,
      });
      const arrival: DetectionRunArrival = {
        kind: "run",
        arrivedAfter: range.arrivedAfter,
        arrivedUntil: picked.judgedUntil,
        candidateStartTime: window.startTime,
        candidateEndTime: window.endTime,
      };

      const windowJudgement: DetectionRuleJudgement = await this.judge(rule, {
        definition,
        parsedRule,
        exceptions: data.exceptions,
        isSetupTest: false,
        read: {
          startTime: window.startTime,
          endTime: window.endTime,
          // A window still filling covers up to where the run judged.
          coveredUntil: new Date(
            Math.min(window.endTime.getTime(), picked.judgedUntil.getTime()),
          ),
          countWindow: { window, arrival },
        },
      });

      judgement = judgement
        ? addJudgements(judgement, windowJudgement)
        : windowJudgement;
    }

    return {
      judgedUntil: picked.judgedUntil,
      judgement: judgement || this.emptyJudgement(rule, data.exceptions),
    };
  }

  /*
   * What an event must be for a rule that counts to read its window: one
   * its condition matches - for a correlation, one any of its steps does.
   */
  private static arrivalCondition(
    definition: DetectionRuleDefinition,
    parsedRule: SigmaRule,
  ): Statement {
    if (definition.kind === "correlation") {
      return buildCorrelationEventsRead({
        correlation: definition.correlation,
        steps: definition.steps,
      }).condition;
    }

    return SigmaClickhouseCompiler.compile(parsedRule);
  }

  // The rule's YAML, parsed, with the watchlists it names bound to it.
  private static async bindDefinition(
    rule: DetectionRule,
    watchlists: SecurityWatchlistReader | undefined,
  ): Promise<DetectionRuleDefinition> {
    return await (
      watchlists || SecurityWatchlists.readerFor(rule.projectId!)
    ).bind(await this.loadRuleDefinition(rule));
  }

  // A judgement that matched nothing.
  private static emptyJudgement(
    rule: DetectionRule,
    exceptions: Array<DetectionRuleExceptionShape>,
  ): DetectionRuleJudgement {
    return {
      result: {
        ruleId: rule.id!.toString(),
        matchedGroups: 0,
        overflowGroups: 0,
        totalMatches: 0,
        alertsCreated: 0,
        incidentsCreated: 0,
        findingsWritten: 0,
        casesOpened: 0,
        exceptionsApplied: buildDetectionRuleExceptionsFilter(exceptions)
          ? exceptions.length
          : 0,
        error: null,
      },
      overflowNotice: null,
      readNotice: null,
    };
  }

  /*
   * Where a scheduled run got to, once it has done what its matches ask:
   * the rule's next run judges what arrived after `judgedUntil`. Written
   * as OneUptime: nobody writes when a rule last ran.
   */
  private static async recordScheduledRun(
    rule: DetectionRule,
    data: { judgedUntil: Date; judgement: DetectionRuleJudgement },
  ): Promise<void> {
    const { overflowNotice, readNotice } = data.judgement;

    if (overflowNotice) {
      logger.warn(
        `DetectionRuleEvaluator: rule ${rule.id!.toString()}: ${overflowNotice}`,
      );
    }

    await DetectionRuleService.updateOneById({
      id: rule.id!,
      data: {
        lastEvaluatedAt: data.judgedUntil,
        /*
         * The rule ran; an overflow, or a correlation that had more groups
         * to check than one run reads, is what its row should say about it.
         */
        lastError: (overflowNotice || readNotice) as unknown as string,
        ...(data.judgement.result.matchedGroups > 0
          ? { lastMatchAt: data.judgedUntil }
          : {}),
      },
      props: {
        isRoot: true,
      },
    });
  }

  // How a real-time run went - a match, an overflow - leaving the schedule as it was.
  private static async recordRealTimeRun(
    rule: DetectionRule,
    data: {
      overflowNotice: string | null;
      matched: boolean;
      coveredUntil: Date;
    },
  ): Promise<void> {
    if (data.overflowNotice) {
      logger.warn(
        `DetectionRuleEvaluator: rule ${rule.id!.toString()}: ${data.overflowNotice}`,
      );
    }

    await DetectionRuleService.updateOneById({
      id: rule.id!,
      data: {
        lastError: data.overflowNotice as unknown as string,
        ...(data.matched ? { lastMatchAt: data.coveredUntil } : {}),
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * One judgement of a rule over one read (DetectionRuleRead): its groups
   * - a correlation's from its own reads (CorrelationRuleMatcher), a single
   * rule's from its compiled condition, counted by the rule's Group By
   * Field and threshold - and everything they ask for: alerts, incidents,
   * Detection Findings, cases and risk. Nothing about the rule's own row:
   * each kind of run records that itself.
   */
  private static async judge(
    rule: DetectionRule,
    data: {
      definition: DetectionRuleDefinition;
      parsedRule: SigmaRule;
      read: DetectionRuleRead;
      exceptions: Array<DetectionRuleExceptionShape>;
      isSetupTest: boolean;
    },
  ): Promise<DetectionRuleJudgement> {
    const { definition, parsedRule, read, exceptions } = data;
    const setupTest: boolean = data.isSetupTest;
    const countWindow: DetectionRuleCountWindow | undefined = read.countWindow;
    const startTime: Date = read.startTime;
    const endTime: Date = read.endTime;
    const coveredUntil: Date = read.coveredUntil;

    // What the run ANDs into its reads: the events no exception skips.
    const exceptionsFilter: Statement | null =
      buildDetectionRuleExceptionsFilter(exceptions);

    let matchedGroups: Array<DetectionMatchGroup>;
    let readNotice: string | null = null;

    if (definition.kind === "correlation") {
      const correlationResult: CorrelationMatchResult =
        await CorrelationRuleMatcher.findMatches({
          projectId: rule.projectId!,
          correlation: definition.correlation,
          steps: definition.steps,
          startTime,
          endTime,
          // One more than a run records, so it can tell "more than it reads".
          maxGroups: DETECTION_MAX_FINDINGS_PER_EVALUATION + 1,
          restrictTo: andRestrictions(read.restrictTo, exceptionsFilter),
          arrival: countWindow?.arrival,
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
        restrictTo: read.restrictTo,
        exceptionsFilter,
        arrival: countWindow?.arrival,
        readFirstSeen: read.readFirstSeen,
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

    /*
     * Where the matches say they start: the read's own start, or - for a
     * read of what arrived, whenever it happened - the earlier of where the
     * run's arrivals start and when the first event it matched happened.
     */
    let coveredFrom: Date = read.coveredFrom || startTime;

    for (const matchGroup of split.recorded) {
      if (
        matchGroup.firstSeenAt &&
        matchGroup.firstSeenAt.getTime() < coveredFrom.getTime()
      ) {
        coveredFrom = matchGroup.firstSeenAt;
      }
    }

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
          startTime: coveredFrom,
          endTime: coveredUntil,
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
          startTime: coveredFrom,
          endTime: coveredUntil,
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
        /*
         * The events behind each group the run opens, as the run counted
         * them: its case keeps them (#9619).
         */
        const matchedEvents: Map<string, SecurityDetectionMatchedEvents> =
          await this.readMatchedEvents({
            rule,
            definition,
            parsedRule,
            matchedGroups: split.opened,
            startTime,
            endTime,
            restrictTo: read.restrictTo,
            exceptionsFilter,
            arrival: countWindow?.arrival,
          });

        const signals: Array<SecurityDetectionSignal> = this.buildCaseSignals({
          rule,
          parsedRule,
          matchedGroups: split.opened,
          findingEventUids,
          matchedEvents,
          startTime: coveredFrom,
          endTime: coveredUntil,
        });

        if (overflowNotice && !setupTest) {
          signals.push(
            this.buildOverflowSignal({
              rule,
              parsedRule,
              overflowGroups: split.overflow,
              summary: overflowNotice,
              startTime: coveredFrom,
              endTime: coveredUntil,
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
            `DetectionRuleEvaluator: rule ${rule.id!.toString()} could not record its matches as security cases:`,
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
            seenAt: coveredUntil,
          }),
        );
      }
    }

    return {
      result: {
        ruleId: rule.id!.toString(),
        matchedGroups: split.recorded.length,
        overflowGroups: split.overflow.length,
        totalMatches,
        alertsCreated,
        incidentsCreated,
        findingsWritten,
        casesOpened,
        exceptionsApplied: exceptionsFilter ? exceptions.length : 0,
        error: null,
      },
      overflowNotice,
      readNotice,
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
    // A setup test's own events, a real-time write's, or what arrived in a scheduled run.
    restrictTo: Statement | undefined;
    // The events no exception skips (buildDetectionRuleExceptionsFilter), or null.
    exceptionsFilter: Statement | null;
    // A window of a rule that counts, as the events it judges found it.
    arrival?: DetectionArrivalRead | undefined;
    // Read when each group's first match happened (a scheduled run's events may be late).
    readFirstSeen?: boolean | undefined;
  }): Promise<Array<DetectionMatchGroup>> {
    const { rule } = data;
    const ruleWhereFragment: Statement = SigmaClickhouseCompiler.compile(
      data.parsedRule,
    );

    /*
     * A setup test reads only its own events, a real-time run only the
     * events it was handed, and a scheduled run of a rule that fires on
     * each match only what arrived since its last; a run reads only the
     * events the rule's exceptions leave it.
     */
    const whereFragment: Statement =
      andRestrictions(
        andRestrictions(ruleWhereFragment, data.restrictTo),
        data.exceptionsFilter,
      ) || ruleWhereFragment;

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
        arrival: data.arrival,
        readFirstSeen: data.readFirstSeen,
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
   * What a matched group is about: the group's value is the entity the
   * detection is about (typed by the field the rule groups on: a principalIp
   * group is an IP address) - a correlation's one to three group-by values,
   * each typed by its own field - and the group's sample observables are its
   * other entities. Its case holds them, and the alert or incident it opens
   * is linked to the records they name exactly.
   */
  public static getMatchGroupEntities(data: {
    rule: DetectionRule;
    matchGroup: DetectionMatchGroup;
  }): Array<SecurityEntity> {
    const { rule, matchGroup } = data;
    const groupEntityType: SecurityEntityType | undefined =
      securityEntityTypeForField(rule.groupByField);

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

    return mergeSecurityEntities(
      groupEntities,
      entitiesFromObservables(matchGroup.sampleObservables),
    );
  }

  /*
   * One case signal per matched group: the detection a case holds, about
   * the group's entities (getMatchGroupEntities).
   */
  public static buildCaseSignals(data: {
    rule: DetectionRule;
    parsedRule: SigmaRule;
    matchedGroups: Array<DetectionMatchGroup>;
    findingEventUids: Map<string, string>;
    // What each group matched, by its value (readMatchedEvents).
    matchedEvents?: Map<string, SecurityDetectionMatchedEvents> | undefined;
    startTime: Date;
    endTime: Date;
  }): Array<SecurityDetectionSignal> {
    const { rule, parsedRule } = data;
    const severity: OcsfSeverity =
      SIGMA_LEVEL_TO_OCSF_SEVERITY[parsedRule.level] || OcsfSeverity.Medium;

    return data.matchedGroups.map(
      (matchGroup: DetectionMatchGroup): SecurityDetectionSignal => {
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
          entities: this.getMatchGroupEntities({ rule, matchGroup }),
          mitreTactics: parsedRule.mitreTactics,
          mitreTechniques: parsedRule.mitreTechniques,
          ruleName: rule.name || parsedRule.title,
          detectionRuleId: rule.id!,
          sampleMessage: matchGroup.sampleMessage || undefined,
          eventUid: data.findingEventUids.get(matchGroup.groupValue),
          matchedEvents: data.matchedEvents?.get(matchGroup.groupValue),
          seenAt: data.endTime,
        };
      },
    );
  }

  /*
   * The events behind each group a run opens (#9619), read as the run read
   * them, for every group at once - one read, whatever the number of
   * groups, each group keeping its share of what one firing keeps
   * (SecurityDetectionMatchedEventsReader): a single rule's condition -
   * with the run's watchlists, its exceptions and the events it was handed
   * or that arrived in it, up to where the events it judged came in - by
   * its Group By Field; a correlation's steps, by its own group-by, from
   * where the events it matched start (#9795). A read that fails keeps
   * nothing.
   */
  public static async readMatchedEvents(data: {
    rule: DetectionRule;
    definition: DetectionRuleDefinition;
    parsedRule: SigmaRule;
    matchedGroups: Array<DetectionMatchGroup>;
    startTime: Date;
    endTime: Date;
    restrictTo: Statement | undefined;
    exceptionsFilter: Statement | null;
    arrival?: DetectionArrivalRead | undefined;
  }): Promise<Map<string, SecurityDetectionMatchedEvents>> {
    const { rule } = data;

    if (data.matchedGroups.length === 0 || !rule.projectId) {
      return new Map();
    }

    // What the run ANDed into its reads, beside the rule's own condition.
    const restrict: (condition: Statement) => Statement = (
      condition: Statement,
    ): Statement => {
      let restricted: Statement =
        andRestrictions(
          andRestrictions(condition, data.restrictTo),
          data.exceptionsFilter,
        ) || condition;

      // The window as it stood when the events judged came in.
      if (data.arrival) {
        restricted = andRestrictions(
          restricted,
          detectionArrivedBy(data.arrival),
        )!;
      }

      return restricted;
    };

    if (data.definition.kind !== "correlation") {
      return SecurityDetectionMatchedEventsReader.readForGroups({
        projectId: rule.projectId,
        start: data.startTime,
        end: data.endTime,
        condition: restrict(SigmaClickhouseCompiler.compile(data.parsedRule)),
        groupExpression: rule.groupByField
          ? buildSigmaFieldExpression(rule.groupByField)
          : null,
        groupValues: data.matchedGroups.map(
          (matchGroup: DetectionMatchGroup): string => {
            return matchGroup.groupValue;
          },
        ),
      });
    }

    /*
     * Every group the correlation fired for, in one read - grouped as its
     * own reads group them (buildCorrelationEventsRead) - where it used to
     * read its first ten one by one, and the rest kept nothing.
     */
    let correlationRead: ReturnType<typeof buildCorrelationEventsRead>;

    try {
      correlationRead = buildCorrelationEventsRead({
        correlation: data.definition.correlation,
        steps: data.definition.steps,
      });
    } catch (error) {
      // A step it cannot read: nothing to keep, and the run goes on.
      logger.warn(
        `DetectionRuleEvaluator: rule ${rule.id?.toString()} keeps no matched events: ${error}`,
      );

      return new Map();
    }

    return SecurityDetectionMatchedEventsReader.readForGroups({
      projectId: rule.projectId,
      start: getCorrelationMatchedEventsStart({
        correlation: data.definition.correlation,
        steps: data.definition.steps,
        startTime: data.startTime,
      }),
      end: data.endTime,
      condition: restrict(correlationRead.condition),
      groupExpression: correlationRead.groupExpression,
      groupValues: data.matchedGroups.map(
        (matchGroup: DetectionMatchGroup): string => {
          return matchGroup.groupValue;
        },
      ),
    });
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
      eventWindow: { start: data.startTime, end: data.endTime },
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
            // What it is about, as its case reads it: linked to the alert.
            entities: this.getMatchGroupEntities({ rule, matchGroup }),
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
      eventWindow: { start: data.startTime, end: data.endTime },
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
            // What it is about, as its case reads it: linked to the incident.
            entities: this.getMatchGroupEntities({ rule, matchGroup }),
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
