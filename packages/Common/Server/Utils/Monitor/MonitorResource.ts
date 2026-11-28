import MonitorService from "../../Services/MonitorService";
import TableColumnType from "../../../Types/Database/TableColumnType";
import PresentedKey from "../PresentedKey/PresentedKey";
import ProjectService from "../../Services/ProjectService";
import MonitorStatusTimelineService, {
  MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../Services/MonitorStatusTimelineService";
import ServerException from "../../../Types/Exception/ServerException";
import logger, { LogAttributes } from "../Logger";
import { isPostgresLockContentionError } from "../Database/PostgresLockContention";
import MonitorCriteriaEvaluator from "./MonitorCriteriaEvaluator";
import { CriteriaFilterMatchHistoryReads } from "./Criteria/CriteriaFilterMatchHistory";
import CheckWindowCounts from "./Criteria/CheckWindowCounts";
import CriteriaInEffect from "./CriteriaInEffect";
import MonitorLogUtil from "./MonitorLogUtil";
import MonitorEvaluationClock from "./MonitorEvaluationClock";
import MonitorMetricUtil from "./MonitorMetricUtil";
import DataToProcess from "./DataToProcess";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorEvaluationLock from "./MonitorEvaluationLock";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
  SeriesKeepingStatus,
} from "../../../Types/Probe/ProbeApiIngestResponse";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import {
  MONITOR_PAUSE_FLAGS_SELECT,
  MonitorPauseReason,
} from "../../../Utils/Monitor/MonitorPauseState";
import MonitorNotEvaluated from "./MonitorNotEvaluated";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import OneUptimeDate from "../../../Types/Date";
import EvaluationEventText from "./EvaluationEventText";
import {
  EvaluationSentence,
  EvaluationSentenceValue,
  translatablePluralSentence,
  translatableSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import { translationKey } from "../../../Types/Translator";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import SecurityEventsMonitorResponse from "../../../Types/Monitor/SecurityEventsMonitor/SecurityEventsMonitorResponse";
import LlmMonitorResponse from "../../../Types/Monitor/LlmMonitor/LlmMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ExceptionMonitorResponse from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import MetricTelemetrySnapshot from "../../../Utils/Monitor/MetricTelemetrySnapshot";
import MonitorIncident from "./MonitorIncident";
import MonitorAlert from "./MonitorAlert";
import MonitorAutoResolveTemplates, {
  MonitorAutoResolveTemplateIds,
} from "../../../Utils/Monitor/MonitorAutoResolveTemplates";
import MonitorSummaryCapture from "./MonitorSummaryCapture";
import MonitorResourceContextUtil, {
  MonitorRecordResources,
} from "./MonitorResourceContext";
import MonitorRecordEvidence from "./MonitorRecordEvidence";
import MonitorStoredCheck from "./MonitorStoredCheck";
import MonitorCheckSecretValues from "./MonitorCheckSecretValues";
import LatestIncomingRequest, {
  LatestIncomingRequestColumns,
} from "./LatestIncomingRequest";
import MonitorEvaluationDetailsCapture, {
  GetEvaluationDetails,
} from "./MonitorEvaluationDetailsCapture";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import IncomingRequestIncidentGrouping, {
  IncomingRequestRecoveries,
} from "./IncomingRequestIncidentGrouping";
import IncomingEmailOpenForEveryEmail, {
  EveryEmailMatches,
} from "./IncomingEmailOpenForEveryEmail";
import LogGroupCriteriaFanOut, {
  LOG_GROUP_ALERT_RESOLVED_MESSAGE,
  LOG_GROUP_INCIDENT_RESOLVED_MESSAGE,
  LOG_GROUP_RESOLVED_ROOT_CAUSE,
} from "./LogGroupCriteriaFanOut";
import TraceGroupCriteriaFanOut from "./TraceGroupCriteriaFanOut";
import ManagedDeviceCheckInSilence from "./ManagedDeviceCheckInSilence";
import MonitorMaintenanceSuppression, {
  MonitorMaintenanceSuppressionResult,
} from "./MonitorMaintenanceSuppression";
import MonitorDependencySuppression, {
  DependencySuppressionResult,
} from "./MonitorDependencySuppression";
import OpenStackDependencySuppression from "../OpenStack/OpenStackDependencySuppression";
import MonitorStatusTimelineUtil from "./MonitorStatusTimeline";
import CaptureSpan from "../Telemetry/CaptureSpan";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
  MonitorEvaluationWindow,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStatusService from "../../Services/MonitorStatusService";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import MonitorProbeLastResults, {
  MonitorProbeOfResult,
  MonitorProbesOfResult,
} from "./MonitorProbeLastResults";
import MonitorProbeResultOrder from "./MonitorProbeResultOrder";
import SeriesBehindStatus from "./SeriesBehindStatus";
import { SeriesBehindStatusReader } from "./GroupedMonitorRecovery";
import MonitorFirstMeasured from "./MonitorFirstMeasured";
import MonitorHeartbeatState, {
  HeartbeatKind,
  HeartbeatWrite,
} from "./MonitorHeartbeatState";
import MonitorOpenRecords, {
  MonitorOpenRecordsReading,
  MonitorRecordKind,
  NOTHING_KNOWN,
} from "./MonitorOpenRecords";
import { toStorableJson } from "../Database/PostgresStorableValue";
import ProbeReportIdentity from "../Probe/ProbeReportIdentity";

import FeedMarkdown, { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { getProbeAgreementRequiredCount } from "../../../Utils/Monitor/ProbeAgreementRule";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import CriteriaBands from "./CriteriaBands";
import EvaluationEventSeries from "./EvaluationEventSeries";

/*
 * The series the criteria of one evaluation have claimed for one kind of
 * record (claimUnclaimedSeries): by band (CriteriaBands.getBandKey), each
 * series claimed in it by its fingerprint, with the name of the criteria
 * that claimed it.
 */
export type SeriesClaims = Map<string, Map<string, string>>;

interface ProbeAgreementResult {
  hasAgreement: boolean;
  agreementCount: number;
  requiredCount: number;
  totalActiveProbes: number;
  agreedCriteriaId: string | null;
  agreedRootCause: string | null;
  agreedProbeNames: Array<string>;
  /*
   * What the probes agree the monitor's status is (#11238): the criteria
   * that sets it on their checks - the first match that changes the status
   * - or none. Said only when it can differ from the agreement above: some
   * probe's first match changes no status. Absent, every probe's check was
   * decided by its first match, as on every monitor whose criteria all
   * change the status, and the status follows the agreement above.
   */
  status?: ProbeStatusAgreement | undefined;
}

interface ProbeStatusAgreement {
  hasAgreement: boolean;
  agreementCount: number;
  agreedCriteriaId: string | null;
  agreedRootCause: string | null;
  agreedProbeNames: Array<string>;
}

// The probes that judged a check one way, and what that way's root cause is.
interface ProbeVerdictCount {
  count: number;
  rootCause: string | null;
  probeNames: Array<string>;
}

/*
 * How long a result must have waited for the monitor's lock before it asks
 * whether a newer one from the same probe was seen meanwhile: a lock taken at
 * the first attempt (retryInterval is 100 ms) had nothing waiting behind it.
 */
const LOCK_WAIT_WORTH_ORDERING_MS: number = 100;

/*
 * How many of the series that keep a grouped monitor's status its evaluation
 * log names, before "and N more" (keepStatusForSeriesBehindIt).
 */
const SERIES_NAMED_WHEN_STATUS_KEPT: number = 3;

// What a check did to the monitor's status (MonitorResourceUtil.setStatusOfCheck).
export enum StatusOfCheck {
  // A criteria that changes the status set it, or it was already that.
  SetByCriteria = "SetByCriteria",
  // No criteria that changes the status matched: back to the default status.
  BackToDefault = "BackToDefault",
  /*
   * No criteria that changes the status matched, and the status is kept: a
   * recovery criteria is waited for (GroupedMonitorRecovery).
   */
  Kept = "Kept",
  /*
   * Left as it is: already the default, a trap, a check that read nothing,
   * planned work, a status that could not be written.
   */
  Unchanged = "Unchanged",
}

// Why a check moves the monitor back to its default status.
export enum DefaultStatusBecause {
  // No criteria matched at all.
  NoCriteriaMet = "NoCriteriaMet",
  /*
   * Criteria matched, and none of them changes the status: an alert-only
   * criteria decides no status (#11238).
   */
  NoStatusCriteriaMet = "NoStatusCriteriaMet",
}

/*
 * The root cause a move back to the default status is written with, for
 * View Cause on the status timeline: read back in the reader's language by
 * StatusChangeNotes, which knows each one by these words.
 */
export const DEFAULT_STATUS_ROOT_CAUSES: Readonly<
  Record<DefaultStatusBecause, string>
> = {
  [DefaultStatusBecause.NoCriteriaMet]:
    "No monitoring criteria met. Change to default status. ",
  [DefaultStatusBecause.NoStatusCriteriaMet]:
    "No monitoring criteria that changes the status met. Change to default status.",
};

export interface MonitorResourceOptions {
  /*
   * The probe that reported this check result, as it authenticated to probe
   * ingest (ProcessProbeIngest). Its result is its own (ProbeReportIdentity)
   * and is taken only for a monitor probes check, from a probe assigned to
   * it: anything else is refused before the monitor's stored probe results,
   * metrics, logs or criteria are touched. Results OneUptime builds itself -
   * a trap or a device poll fanned out to the monitors watching a device,
   * a heartbeat, a telemetry evaluation - pass none.
   */
  reportingProbeId?: ObjectID | undefined;
  /*
   * The secret key the result came in with, and the monitor column that
   * holds it, from a caller that may have found the monitor by a key it
   * kept (MonitorSecretKeyCache): the read of the monitor this makes anyway
   * checks the key is still the monitor's, and a key that is not - rotated,
   * or its monitor deleted - finds no monitor, as the caller's own lookup
   * would have.
   */
  secretKey?:
    | {
        column: "serverMonitorSecretKey" | "incomingRequestSecretKey";
        value: string;
      }
    | undefined;
  /*
   * Requests to this Incoming Request monitor skipped before this one, which
   * its log has not said yet: this evaluation's log says so first
   * (describeSkippedIncomingRequests). Only from a monitor that evaluates
   * every request it receives (#10582).
   */
  skippedIncomingRequests?: SkippedIncomingRequestsNote | undefined;
  /*
   * When the evaluation began, on MonitorEvaluationClock's clock, when it
   * began before this call: a telemetry check's reads come first, and its
   * time counts them (#10317). Left out, it begins here.
   */
  evaluationStartedAtMs?: number | undefined;
  /*
   * The window of telemetry a telemetry check judged (issue #11248): its log
   * entry says it, and so does the root cause of what it opens.
   */
  judgedWindow?: MonitorEvaluationWindow | undefined;
}

/*
 * Requests an Incoming Request monitor that evaluates every request skipped
 * (IncomingRequestPendingStore, in the Telemetry worker).
 */
export interface SkippedIncomingRequestsNote {
  // More were waiting than a monitor keeps, so the oldest were skipped.
  overLimit: number;
  /*
   * Of those, the ones skipped because more than `requestLimit` requests
   * were waiting, and the ones skipped because the waiting requests took
   * more than `byteLimit` bytes - each limit as it was when it skipped them
   * (#10652). The rest of overLimit was skipped by a release that did not
   * say which.
   */
  overRequestLimit?: number | undefined;
  requestLimit?: number | undefined;
  overByteLimit?: number | undefined;
  byteLimit?: number | undefined;
  // Evaluating each failed `attempts` times, so it was skipped.
  afterFailures: number;
  attempts: number;
}

const BYTES_PER_MEGABYTE: number = 1024 * 1024;

export default class MonitorResourceUtil {
  /*
   * Whether this monitor's per-series incidents and alerts are resolved
   * only when something says so, and never because a series is missing
   * from an evaluation:
   *
   *   - an Incoming Request monitor, where a payload describes only the
   *     keys it carries;
   *   - a Logs monitor whose groups are resolved by a log
   *     (MonitorStepLogMonitor.resolvedByAttributes), where a group with
   *     no log in the window has said nothing.
   */
  public static isSeriesResolvedExplicitly(input: {
    monitor: Monitor;
    dataToProcess: DataToProcess;
  }): boolean {
    if (input.monitor.monitorType === MonitorType.IncomingRequest) {
      return true;
    }

    return (
      input.monitor.monitorType === MonitorType.Logs &&
      LogGroupCriteriaFanOut.isResolvedByLog(input.dataToProcess)
    );
  }

  /*
   * Whether a telemetry check of an infrastructure monitor read nothing at
   * all: every query of its window came back empty, grouped or not.
   *
   * That is the agent (or the resource) going quiet, not the resource
   * recovering. A template's criteria compare values, so silence matches
   * none of them, and "no criteria met" used to put the monitor back on its
   * default status and close its open incidents and alerts: an OSD Down or
   * Node Offline incident resolved itself the moment the agent that reported
   * it stopped, and the monitor turned green. The monitor now keeps its
   * status, and its open incidents and alerts stay open, until data comes
   * back. A criteria that asks for silence - Has No Data, or If No Data set
   * to Trigger - still matches it as before, and a grouped recovery criteria
   * that counts a missing series as zero matches it while the resource still
   * reports (GroupedSeriesGone): then this is never reached.
   */
  public static isSilentInfrastructureWindow(input: {
    monitor: Monitor;
    dataToProcess: DataToProcess;
  }): boolean {
    /*
     * A grouped Traces monitor that counts quiet groups, none of whose
     * groups sent a span in the window (#9711): the whole app went quiet,
     * not one of its devices. Its devices' alerts stay open until spans
     * arrive, rather than resolving as if they had all come back.
     */
    if (
      input.monitor.monitorType === MonitorType.Traces &&
      TraceGroupCriteriaFanOut.isQuietWindow(input.dataToProcess)
    ) {
      return true;
    }

    /*
     * A Metrics monitor of managed devices' check-ins none of whose devices
     * has a reading in the window (#9835): their connection stopped reading,
     * not every device checked in again. Their alerts stay open until it
     * reads again (ManagedDeviceCheckInSilence).
     */
    if (
      input.monitor.monitorType === MonitorType.Metrics &&
      ManagedDeviceCheckInSilence.isQuietWindow(input.dataToProcess)
    ) {
      return true;
    }

    if (!MonitorTypeHelper.isInfrastructureMonitor(input.monitor.monitorType)) {
      return false;
    }

    const response: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    // Not a telemetry check's answer: nothing here to judge.
    if (!Array.isArray(response.metricResult)) {
      return false;
    }

    const hasData: (results: Array<AggregatedResult> | undefined) => boolean = (
      results: Array<AggregatedResult> | undefined,
    ): boolean => {
      return (results || []).some((result: AggregatedResult): boolean => {
        return Array.isArray(result?.data) && result.data.length > 0;
      });
    };

    if (hasData(response.metricResult)) {
      return false;
    }

    return !(response.seriesBreakdown || []).some(
      (series: MetricSeriesResult): boolean => {
        return hasData(series?.aggregatedResults);
      },
    );
  }

  /*
   * What an Incoming Request monitor's log says of requests skipped before
   * the one it evaluates: never nothing. An incident or alert one of them
   * would have opened or resolved was not, so the reader knows to look.
   *
   * Those skipped over a limit say which limit, and what it was (#10652):
   * the requests a monitor keeps waiting, or the megabytes of them. A
   * self-hosted install sets its own, so the reader - or the operator they
   * ask - knows which to raise. Those an earlier release skipped, which did
   * not say which, say only that more were waiting than the monitor keeps.
   */
  public static describeSkippedIncomingRequests(
    skipped: SkippedIncomingRequestsNote,
  ): Array<MonitorEvaluationEvent> {
    const events: Array<MonitorEvaluationEvent> = [];
    const at: Date = OneUptimeDate.getCurrentDate();

    const skippedRequestsEvent: (
      count: number,
      message: EvaluationSentence,
    ) => MonitorEvaluationEvent = (
      count: number,
      message: EvaluationSentence,
    ): MonitorEvaluationEvent => {
      return {
        type: "requests-skipped",
        ...EvaluationEventText.from({
          title: translatableSentence("Requests not evaluated: {{skipped}}", {
            skipped: count,
          }),
          message: message,
        }),
        at: at,
      };
    };

    const overLimit: number = Math.max(0, skipped.overLimit);
    const overRequestLimit: number =
      skipped.requestLimit && skipped.requestLimit > 0
        ? Math.min(overLimit, Math.max(0, skipped.overRequestLimit || 0))
        : 0;
    const overByteLimit: number =
      skipped.byteLimit && skipped.byteLimit > 0
        ? Math.min(
            overLimit - overRequestLimit,
            Math.max(0, skipped.overByteLimit || 0),
          )
        : 0;
    const overAnUnnamedLimit: number =
      overLimit - overRequestLimit - overByteLimit;

    if (overRequestLimit > 0) {
      events.push(
        skippedRequestsEvent(
          overRequestLimit,
          translatableSentence(
            "More requests were waiting to be evaluated than the {{limit}} this monitor keeps, so the oldest of them were skipped. An incident or alert a skipped request would have opened or resolved may be missing or still open.",
            { limit: skipped.requestLimit! },
          ),
        ),
      );
    }

    if (overByteLimit > 0) {
      events.push(
        skippedRequestsEvent(
          overByteLimit,
          translatableSentence(
            "The requests waiting to be evaluated took more than the {{size}} MB this monitor keeps, so the oldest of them were skipped. An incident or alert a skipped request would have opened or resolved may be missing or still open.",
            {
              // A whole number of megabytes as set, else to a tenth.
              size:
                Math.round((skipped.byteLimit! / BYTES_PER_MEGABYTE) * 10) / 10,
            },
          ),
        ),
      );
    }

    if (overAnUnnamedLimit > 0) {
      events.push(
        skippedRequestsEvent(
          overAnUnnamedLimit,
          translatableSentence(
            "More requests were waiting to be evaluated than this monitor keeps, so the oldest of them were skipped. An incident or alert a skipped request would have opened or resolved may be missing or still open.",
          ),
        ),
      );
    }

    if (skipped.afterFailures > 0) {
      events.push(
        skippedRequestsEvent(
          skipped.afterFailures,
          translatableSentence(
            "A request is skipped once evaluating it has failed {{attempts}} times. An incident or alert a skipped request would have opened or resolved may be missing or still open.",
            { attempts: skipped.attempts },
          ),
        ),
      );
    }

    return events;
  }

  @CaptureSpan()
  public static async monitorResource(
    dataToProcess: DataToProcess,
    options?: MonitorResourceOptions | undefined,
  ): Promise<ProbeApiIngestResponse> {
    const reportingProbeId: ObjectID | undefined = options?.reportingProbeId;

    /*
     * A probe's check result names the probe it is from, and that is the
     * probe that reported it - checked before anything reads the id below
     * (the MonitorProbe row it is stored under, probe agreement).
     */
    if (reportingProbeId) {
      try {
        ProbeReportIdentity.bindResultToSender(
          dataToProcess as ProbeMonitorResponse,
          reportingProbeId,
        );
      } catch (err) {
        /*
         * Logged once, at warn, naming the probe: the telemetry worker
         * completes the job rather than retrying it - the result does not
         * change between attempts (isNonActionableIngestError, issue
         * #8424). Probe ingest holds a result to its sender before it gets
         * here, so this is the line for a caller that does not.
         */
        logger.warn(
          `Probe ${reportingProbeId.toString()} reported a check result for monitor ${dataToProcess.monitorId?.toString()} that names another probe. A probe can only report its own results, so the result was refused.`,
          {
            monitorId: dataToProcess.monitorId?.toString(),
            probeId: reportingProbeId.toString(),
          } as LogAttributes,
        );

        throw err;
      }
    }

    let response: ProbeApiIngestResponse = {
      monitorId: dataToProcess.monitorId,
      criteriaMetId: undefined,
      rootCause: null,
    };

    const evaluationSummary: MonitorEvaluationSummary = {
      evaluatedAt: OneUptimeDate.getCurrentDate(),
      criteriaResults: [],
      events: [],
    };

    // The window a telemetry check judged (#11248), for its log entry.
    if (options?.judgedWindow) {
      evaluationSummary.judgedWindow = {
        startsAt: new Date(options.judgedWindow.startsAt),
        endsAt: new Date(options.judgedWindow.endsAt),
        // Which end it held (#11334), when the check says.
        ...(typeof options.judgedWindow.includesEnd === "boolean"
          ? { includesEnd: options.judgedWindow.includesEnd }
          : {}),
      };
    }

    response.evaluationSummary = evaluationSummary;
    dataToProcess.evaluationSummary = evaluationSummary;

    // Its log entry says how long it took (MonitorEvaluationClock, #10317).
    MonitorEvaluationClock.begin(
      evaluationSummary,
      options?.evaluationStartedAtMs,
    );

    if (options?.skippedIncomingRequests) {
      evaluationSummary.events.push(
        ...MonitorResourceUtil.describeSkippedIncomingRequests(
          options.skippedIncomingRequests,
        ),
      );
    }

    const monitorStatusNameCache: Dictionary<string | null> = {};

    const getMonitorStatusName: (
      statusId: ObjectID | undefined | null,
    ) => Promise<string | null> = async (
      statusId: ObjectID | undefined | null,
    ): Promise<string | null> => {
      if (!statusId) {
        return null;
      }

      const cacheKey: string = statusId.toString();

      if (monitorStatusNameCache[cacheKey] !== undefined) {
        return monitorStatusNameCache[cacheKey] ?? null;
      }

      const monitorStatus: MonitorStatus | null =
        await MonitorStatusService.findOneBy({
          query: {
            _id: statusId,
          },
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

      const statusName: string | null = monitorStatus?.name || null;
      monitorStatusNameCache[cacheKey] = statusName;

      return statusName;
    };

    logger.debug("Processing probe response");
    logger.debug("Monitor ID: " + dataToProcess.monitorId);

    /*
     * A probe's result is recorded as seen before it waits for the lock, so
     * that one which waited behind a newer result from the same probe can
     * tell (MonitorProbeResultOrder).
     */
    const probeResultOrder: {
      monitorId: ObjectID;
      probeId: ObjectID;
      checkedAt: Date | undefined;
    } | null = reportingProbeId
      ? {
          monitorId: dataToProcess.monitorId,
          probeId: reportingProbeId,
          checkedAt: (dataToProcess as ProbeMonitorResponse).monitoredAt,
        }
      : null;

    if (probeResultOrder) {
      await MonitorProbeResultOrder.record(probeResultOrder);
    }

    /*
     * The per-monitor lock comes first, and the monitor is read once, under
     * it, so concurrent results for the same monitor are processed serially
     * and every decision below is made against the monitor as whichever
     * evaluation held the lock last left it. Read before the lock, the
     * monitor's status could be one that evaluation had just changed: the
     * heartbeat cron flips a monitor Offline, the heartbeat that was already
     * waiting on the lock matches "Online", the status timeline sees "already
     * Online" and writes nothing - and the monitor stays Offline until the
     * next evaluation. The status used to be read a second time once the
     * lock was held for that; now the one read is.
     *
     * Every exit below - a refusal, a skipped project, a thrown error - gives
     * the lock back (the finally at the end): redis-semaphore keeps a refresh
     * timer alive until release() is called, so a lock leaked on a throw path
     * pinned the Redis key until pod restart and forced every other worker to
     * spin on acquire. acquireTimeout/retryInterval cap the acquire spin so a
     * contended lock fails fast instead of polling Redis for 10s.
     *
     * On acquire timeout we DO NOT continue unlocked. Falling through without
     * the lock silently abandons the per-monitor serialization this lock exists
     * to provide — concurrent results for the same monitor would then race
     * incident/alert dedup and status-timeline writes (duplicate
     * incidents/alerts, status flaps) exactly under the high contention the
     * lock is meant to handle. Instead we surface the contention so the work is
     * retried once the lock frees: the Telemetry queue re-runs each ingest job
     * up to 3x with exponential backoff, and the per-monitor crons catch-and-
     * skip to re-evaluate on their next tick - unless the result is a probe's
     * and a newer one from the same probe is waiting too: then it is dropped,
     * and only the newest is judged (MonitorProbeResultOrder). The dominant
     * source of same-monitor contention (an external sender hammering one
     * Incoming Request URL) is collapsed upstream by BullMQ job coalescing at
     * enqueue time (see TelemetryQueueService.addIncomingRequestIngestJob), so
     * this throw is a correctness backstop for the rare residual collision
     * (e.g. cron vs ingest), not the steady-state path.
     */
    let evaluationLock: MonitorEvaluationLock | null = null;
    const lockRequestedAt: number = Date.now();

    try {
      /*
       * Kept by a refresh every second, and never lost in silence: a loss
       * stops the evaluation at its next write (MonitorEvaluationLock,
       * #10108).
       */
      evaluationLock = await MonitorEvaluationLock.acquire({
        monitorId: dataToProcess.monitorId,
        acquireTimeout: 2000,
        retryInterval: 100,
        acquireAttemptsLimit: 20,
      });
    } catch (err) {
      if (
        probeResultOrder &&
        (await MonitorProbeResultOrder.isSuperseded(probeResultOrder))
      ) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - A newer result from probe ${probeResultOrder.probeId.toString()} is waiting for this monitor's lock; this one is dropped.`,
        );
        return response;
      }

      logger.debug(
        `${dataToProcess.monitorId.toString()} - Could not acquire per-monitor processing lock within the acquire window; another worker is processing this monitor. Deferring to retry to preserve serialization.`,
      );
      throw err;
    }

    const lock: MonitorEvaluationLock = evaluationLock;

    const releaseMutex: () => Promise<void> = async (): Promise<void> => {
      await lock.release();
    };

    /*
     * Before each write the lock protects: stops the evaluation, rather
     * than write without the lock, once it is lost (MonitorEvaluationLock).
     */
    const keepEvaluationLock: () => Promise<void> = async (): Promise<void> => {
      await lock.keep();
    };

    try {
      /*
       * A result that waited for the lock behind a newer one from the same
       * probe: judged after it, it would put the monitor back where the probe
       * saw it before. Dropped - only the newest is judged. A result that got
       * the lock at once has nothing newer behind it worth asking about.
       */
      if (
        probeResultOrder &&
        Date.now() - lockRequestedAt >= LOCK_WAIT_WORTH_ORDERING_MS &&
        (await MonitorProbeResultOrder.isSuperseded(probeResultOrder))
      ) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - A newer result from probe ${probeResultOrder.probeId.toString()} was seen while this one waited for the monitor's lock; this one is dropped.`,
        );
        return response;
      }

      logger.debug("Fetching Monitor...");

      // fetch monitor
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: dataToProcess.monitorId,
        select: {
          monitorSteps: true,
          monitorType: true,
          projectId: true,
          ...MONITOR_PAUSE_FLAGS_SELECT,
          currentMonitorStatusId: true,
          _id: true,
          name: true,
          minimumProbeAgreement: true,
          /*
           * Whether the incidents and alerts this check opens keep its
           * response content (MonitorRecordEvidence).
           */
          keepResponseContent: true,
          /*
           * How often this monitor is checked. Over-time criteria filters need
           * it to work out how many samples a fully covered evaluation window
           * should hold - without it a monitor that has only just started
           * looks the same as one whose whole window is breaching.
           */
          monitoringInterval: true,
          /*
           * Recorded as oneuptime.label.* / oneuptime.customField.* attributes on
           * every monitor metric this result produces, so response time and
           * uptime are groupable by a project's own taxonomy. Selected here
           * rather than re-read inside MonitorMetricUtil: this is the hottest
           * Postgres path in the product and it already loads the monitor.
           */
          labels: {
            _id: true,
            name: true,
          },
          customFields: true,
          /*
           * Alert-dependency suppression inputs. Selected here for the same
           * reason as labels: this query already loads the monitor on the
           * hottest path, and both lists are empty for the overwhelming
           * majority of monitors, in which case suppression costs nothing.
           * Ids only — names are fetched by the suppression util's own
           * parents query, so selecting them here would just duplicate the
           * joined row payload on every evaluation.
           */
          dependsOnMonitors: {
            _id: true,
          },
          suppressAlertsWhenParentMonitorStatuses: {
            _id: true,
          },
          // A key resolved from a cache is checked against the monitor's own.
          ...(options?.secretKey ? { [options.secretKey.column]: true } : {}),
          /*
           * Whether anything has measured it yet: the first result that
           * does stamps it (MonitorFirstMeasured, issue #8899).
           */
          ...MonitorFirstMeasured.SELECT,
        },
        props: {
          isRoot: true,
        },
      });

      logger.debug("Monitor found");
      logger.debug("Monitor ID: " + dataToProcess.monitorId);

      if (!monitor) {
        logger.debug(`${dataToProcess.monitorId.toString()} Monitor not found`);
        throw new BadDataException(ExceptionMessages.MonitorNotFound);
      }

      if (!monitor.projectId) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} Monitor does not have a projectId`,
        );
        throw new BadDataException("Monitor does not have a projectId");
      }

      /*
       * A key the caller resolved from its cache that is no longer this
       * monitor's - rotated, or the monitor gone and the id reused by nothing -
       * finds no monitor, exactly as the caller's own lookup would have
       * (MonitorSecretKeyCache).
       */
      if (
        options?.secretKey &&
        !PresentedKey.matches({
          presented: options.secretKey.value,
          stored:
            (
              (monitor as unknown as Record<string, unknown>)[
                options.secretKey.column
              ] as ObjectID | string | undefined
            )?.toString() || null,
          // An ObjectID column's key, whatever the case of its hex digits.
          columnType: TableColumnType.ObjectID,
        })
      ) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - The secret key this result came in with is no longer the monitor's.`,
        );
        throw new BadDataException(ExceptionMessages.MonitorNotFound);
      }

      dataToProcess.projectId = monitor.projectId;

      // What its time is weighed against: how often it is evaluated.
      MonitorEvaluationClock.schedule(evaluationSummary, monitor);

      /*
       * Probes check only the monitor types probes run (isProbableMonitor),
       * and only the monitors they are assigned to - the assignment is held
       * below, once the monitor's probe rows are read. A probe's result for any
       * other monitor - a heartbeat, an incoming request, a telemetry or
       * network device monitor - is no check that probe ran, and would
       * otherwise be judged against that monitor's criteria and stored as its
       * last request.
       */
      if (
        reportingProbeId &&
        !(
          monitor.monitorType &&
          MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
        )
      ) {
        /*
         * Logged once, at warn, naming the probe: the telemetry worker
         * completes the job rather than retrying it (the monitor's type
         * does not change between attempts), so this line is the one place
         * a probe that keeps reporting for monitors it does not check is
         * seen (isNonActionableIngestError, issue #8161).
         */
        logger.warn(
          `Probe ${reportingProbeId.toString()} reported a check result for monitor ${dataToProcess.monitorId.toString()}, a ${monitor.monitorType || "type of"} monitor probes do not check. The result was refused.`,
          {
            projectId: monitor.projectId?.toString(),
            monitorId: dataToProcess.monitorId.toString(),
            probeId: reportingProbeId.toString(),
          } as LogAttributes,
        );

        throw new BadDataException(ExceptionMessages.ProbeNotAssignedToMonitor);
      }

      /*
       * Archived first: an archived monitor is out of service whatever its
       * other flags say, and a result that still reaches it (a probe that
       * claimed it just before it was archived, an incoming request, an email)
       * must open nothing and change nothing.
       *
       * Each of the four refusals below is an ExceptionMessages entry, never
       * words written here: the telemetry worker completes a job refused for a
       * monitor that is not being monitored instead of failing and retrying
       * it, and it knows these refusals by those entries
       * (isNonActionableIngestError).
       */
      if (monitor.isArchived) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} Monitor is archived. Unarchive it to start monitoring again.`,
        );

        await MonitorResourceUtil.listNotEvaluated({
          monitor: monitor,
          dataToProcess: dataToProcess,
          reason: MonitorPauseReason.Archived,
        });

        throw new BadDataException(ExceptionMessages.MonitorArchived);
      }

      if (monitor.disableActiveMonitoring) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} Monitor is disabled. Please enable it to start monitoring again.`,
        );

        await MonitorResourceUtil.listNotEvaluated({
          monitor: monitor,
          dataToProcess: dataToProcess,
          reason: MonitorPauseReason.Disabled,
        });

        throw new BadDataException(ExceptionMessages.MonitorDisabled);
      }
      if (monitor.disableActiveMonitoringBecauseOfManualIncident) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} Monitor is disabled because an incident which is created manually is not resolved. Please resolve the incident to start monitoring again.`,
        );

        await MonitorResourceUtil.listNotEvaluated({
          monitor: monitor,
          dataToProcess: dataToProcess,
          reason: MonitorPauseReason.ManualIncident,
        });

        throw new BadDataException(
          ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
        );
      }

      if (monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} Monitor is disabled because one of the maintenance events this monitor is attached to has not ended. Please end that maintenance event to start monitoring again.`,
        );

        await MonitorResourceUtil.listNotEvaluated({
          monitor: monitor,
          dataToProcess: dataToProcess,
          reason: MonitorPauseReason.ScheduledMaintenance,
        });

        throw new BadDataException(
          ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
        );
      }

      /*
       * A project a master admin blocked is not monitored: its monitors are no
       * longer handed to probes or swept (getActiveProjectStatusQuery), and a
       * result that still reaches one - a probe that claimed it just before
       * the block, a heartbeat or an email its sender keeps sending, a trap -
       * opens nothing and changes nothing. Returned rather than thrown: an
       * outside sender keeps sending whatever OneUptime answers, and each of
       * those would otherwise be a failed job. Cached per server
       * (ProjectService.isProjectBlocked).
       */
      if (await ProjectService.isProjectBlocked(monitor.projectId)) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} Monitor's project is blocked. Skipping.`,
        );

        return response;
      }

      /*
       * The values of the monitor secrets the server filled into the
       * monitor's steps, hidden wherever a probe's check says them back - a
       * script's error and log lines, a response that echoes the request -
       * before anything below reads the check: its criteria, the probe's
       * latest check, the monitor's logs and summary, an incident's root
       * cause (MonitorCheckSecretValues, #10825). Here rather than as the
       * queue takes the check in, so it costs no read of the monitor of its
       * own: a monitor whose steps name no secret costs nothing more.
       */
      if (
        monitor.monitorType &&
        MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
      ) {
        dataToProcess = await MonitorCheckSecretValues.hideInMonitorCheck({
          check: dataToProcess as ProbeMonitorResponse,
          monitor: monitor,
        });
      }

      // What a heartbeat sweep compares with (MonitorHeartbeatState).
      const monitorStatusIdFound: ObjectID | undefined =
        monitor.currentMonitorStatusId;

      /*
       * A server agent's report is written to the monitor at most every few
       * minutes; its arrival is kept on every report, and a check of the
       * monitor judges the latest kept (MonitorResourceUtil.keepServerReport).
       */
      if (monitor.monitorType === MonitorType.Server) {
        await MonitorResourceUtil.keepServerReport({
          monitorId: monitor.id!,
          dataToProcess: dataToProcess as ServerMonitorResponse,
        });
      }

      /*
       * So is an incoming request's, by its monitor, for the monitor page:
       * the row is written only every so often, and a reader of the monitor
       * may not read the secret key the sweep keeps arrivals by
       * (MonitorResourceUtil.keepIncomingRequestArrival, issue #8123).
       */
      if (monitor.monitorType === MonitorType.IncomingRequest) {
        await MonitorResourceUtil.keepIncomingRequestArrival({
          monitorId: monitor.id!,
          dataToProcess: dataToProcess as IncomingMonitorRequest,
        });
      }

      let probeName: string | undefined = undefined;
      const monitorName: string | undefined = monitor.name || undefined;

      /*
       * This monitor's probes, read once per result with the statement that
       * stores the result (MonitorProbeLastResults) and reused by
       * checkProbeAgreement below. Of each probe's lastMonitoringLog only
       * what agreement judges is read: the step judged, from the other
       * enabled, connected probes. Safe to reuse: the per-monitor semaphore
       * above serializes every writer of these rows for the duration of this
       * function.
       */
      let monitorProbesForMonitor: Array<MonitorProbe> | null = null;

      /*
       * SNMP trap responses are event-driven, not check results. They are
       * evaluated ONLY against trap criteria; they must not overwrite the
       * last check's counters, participate in probe agreement, or reset the
       * monitor to its default status when no criteria matches.
       */
      const isSnmpTrapEvent: boolean = Boolean(
        (dataToProcess as ProbeMonitorResponse).snmpTrapResponse,
      );

      // save the last log to MonitorProbe.

      // get last log. We do this because there are many monitoring steps and we need to store those.
      logger.debug(
        `${dataToProcess.monitorId.toString()} - monitor type ${
          monitor.monitorType
        }`,
      );

      if (
        monitor.monitorType &&
        MonitorTypeHelper.isProbableMonitor(monitor.monitorType)
      ) {
        dataToProcess = dataToProcess as ProbeMonitorResponse;
        if ((dataToProcess as ProbeMonitorResponse).probeId) {
          const probeResult: ProbeMonitorResponse =
            dataToProcess as ProbeMonitorResponse;

          /*
           * The probe the result is from must be one of this monitor's own:
           * its result is stored under that probe's row and nowhere else.
           * Ids compared as Postgres compares uuids, whatever their case.
           */
          const resultProbeId: string = probeResult
            .probeId!.toString()
            .toLowerCase();

          /*
           * Network Device monitors no longer flow through here: they are
           * not probeable — the NetworkDevice resource owns its own polling
           * and NetworkDeviceWalkUtil computes interface rates, syncs
           * inventory, and evaluates watching monitors on each device walk.
           */

          /*
           * The result as the probe's last for its step, stored once per
           * probe check result — the hottest recurring write in the
           * product. A single statement merges it into the probe's
           * lastMonitoringLog in Postgres and reads the monitor's probes
           * (MonitorProbeLastResults); the column is never read out to be
           * written back. MonitorProbe has no workflow/audit/realtime
           * decorators, so the hook pipeline would have been inert anyway.
           *
           * The copy written is a storable one: a single NUL in the
           * response body or headers made Postgres refuse the whole jsonb
           * value, failing this job before the result was evaluated, on
           * every retry. dataToProcess itself stays as the probe sent it,
           * for the criteria below. The other steps' entries stay in the
           * column as they were, so they are storable already.
           *
           * Kept as the probe sent it, unlike the monitor's logs:
           * checkProbeAgreement judges it again against the criteria, and
           * a filter on the body needs the body. People read it redacted
           * as the logs are (MonitorProbeService.onFindSuccess).
           *
           * A trap is not a check of its own, and a result that names no
           * step has no entry to be: nothing is stored for either, and the
           * probes are only read.
           */
          const reportedStepId: string =
            probeResult.monitorStepId?.toString() || "";

          const storedResult: ProbeMonitorResponse | undefined =
            isSnmpTrapEvent || !reportedStepId
              ? undefined
              : ({
                  ...toStorableJson(probeResult),
                  monitoredAt: OneUptimeDate.getCurrentDate(),
                } as ProbeMonitorResponse);

          /*
           * What probe agreement will read of the other probes: the step
           * this result is judged against. A trap is not judged by
           * agreement.
           */
          const judgedStepId: string | undefined = isSnmpTrapEvent
            ? undefined
            : MonitorResourceUtil.findStepToJudge({
                monitorSteps: monitor.monitorSteps,
                dataToProcess: dataToProcess,
              })?.id.toString();

          let probesOfResult: MonitorProbesOfResult;

          try {
            probesOfResult =
              await MonitorProbeLastResults.storeResultAndReadProbes({
                monitorId: monitor.id!,
                reportingProbeId: probeResult.probeId!,
                reportedStepId: reportedStepId,
                judgedStepId: judgedStepId,
                result: storedResult as unknown as JSONObject | undefined,
              });
          } catch (err) {
            /*
             * A row lock another writer held past lock_timeout costs the
             * stored copy of this one result, not the result (OneUptime
             * issue #7194): the probes are read without the write, the
             * evaluation below runs on the result all the same, and the
             * probe's next result is stored over it. Thrown, it failed the
             * whole job, and the queue ran it again from the start - twice
             * - on the database that was already too busy. Any other
             * failure is still thrown.
             */
            if (!storedResult || !isPostgresLockContentionError(err)) {
              throw err;
            }

            logger.warn(
              `${dataToProcess.monitorId.toString()} - the result of probe ${resultProbeId} is evaluated but not stored as its last result: another writer held the monitor probe's row (${
                err instanceof Error ? err.message : String(err)
              }). Its next result is stored as usual.`,
              {
                projectId: monitor.projectId?.toString(),
                monitorId: monitor.id?.toString(),
              } as LogAttributes,
            );

            probesOfResult =
              await MonitorProbeLastResults.storeResultAndReadProbes({
                monitorId: monitor.id!,
                reportingProbeId: probeResult.probeId!,
                reportedStepId: reportedStepId,
                judgedStepId: judgedStepId,
                result: undefined,
              });
          }

          const reportingProbe: MonitorProbeOfResult | undefined =
            probesOfResult.probes.find((probe: MonitorProbeOfResult) => {
              return probe.probeId.toString().toLowerCase() === resultProbeId;
            });

          if (!reportingProbe) {
            /*
             * Usually harmless: the probe was taken off the monitor, or the
             * monitor switched off for it, while a check it had already
             * claimed was in flight. Logged once, at warn, naming the probe,
             * and the job is completed rather than retried - the monitor's
             * probes do not change between attempts
             * (isNonActionableIngestError, issue #8161).
             */
            logger.warn(
              `Probe ${resultProbeId} reported a check result for monitor ${monitor.id?.toString()}, which it is not assigned to. The result was refused.`,
              {
                projectId: monitor.projectId?.toString(),
                monitorId: monitor.id?.toString(),
                probeId: resultProbeId,
              } as LogAttributes,
            );

            throw new BadDataException(
              ExceptionMessages.ProbeNotAssignedToMonitor,
            );
          }

          probeName = reportingProbe.probeName || undefined;

          /*
           * The probes as checkProbeAgreement reads them: the reporting
           * probe with this result as its last for the step it reported
           * (stored or, under another writer's lock, not), the others with
           * their last result for the step judged.
           */
          monitorProbesForMonitor = probesOfResult.probes.map(
            (probe: MonitorProbeOfResult): MonitorProbe => {
              return MonitorResourceUtil.toMonitorProbeForAgreement({
                probe: probe,
                judgedStepId: judgedStepId,
                reportedResult:
                  probe === reportingProbe && storedResult
                    ? { stepId: reportedStepId, result: storedResult }
                    : undefined,
              });
            },
          );
        }
      }

      /*
       * The result is the monitor's now: past every refusal, and stored
       * under its own probe when a probe sent it. The first one that
       * measured the monitor - not a heartbeat sweep's look at what has not
       * arrived - says so on its row, once, so the lists and status pages
       * stop saying it is waiting for its first check, and announces it, so
       * a Monitors list left open follows even when the status stays as it
       * was (MonitorFirstMeasured). It never fails the result.
       */
      await MonitorFirstMeasured.stampIfFirst({
        monitor: monitor,
        dataToProcess: dataToProcess,
      });

      const serverMonitorResponse: ServerMonitorResponse | undefined =
        monitor.monitorType === MonitorType.Server &&
        (dataToProcess as ServerMonitorResponse).requestReceivedAt
          ? (dataToProcess as ServerMonitorResponse)
          : undefined;

      const incomingMonitorRequest: IncomingMonitorRequest | undefined =
        monitor.monitorType === MonitorType.IncomingRequest &&
        (dataToProcess as IncomingMonitorRequest).incomingRequestReceivedAt &&
        !(dataToProcess as IncomingMonitorRequest)
          .onlyCheckForIncomingRequestReceivedAt
          ? (dataToProcess as IncomingMonitorRequest)
          : undefined;

      let hasPersistedMonitorData: boolean = false;

      const persistLatestMonitorPayload: () => Promise<void> = async () => {
        if (hasPersistedMonitorData) {
          return;
        }

        if (serverMonitorResponse) {
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Server request received at ${serverMonitorResponse.requestReceivedAt}`,
          );

          logger.debug(dataToProcess);

          /*
           * Skip persistence when this evaluation originated from the
           * CheckOnlineStatus cron (onlyCheckRequestReceivedAt=true). The cron
           * re-evaluates using the already-stale value read from the DB and has
           * no new heartbeat data to persist — writing it back would race with
           * (and overwrite) the ingest path's fresh heartbeat update, causing
           * the monitor to flap between Online and Offline every minute.
           */
          if (
            !serverMonitorResponse.onlyCheckRequestReceivedAt &&
            !(await MonitorHeartbeatState.isWriteDue({
              monitorId: monitor.id!,
              write: HeartbeatWrite.ServerReport,
            }))
          ) {
            /*
             * Written less than SERVER_REPORT_WRITE_EVERY_SECONDS ago. Its
             * arrival is kept (keepServerReport), and the CheckOnlineStatus
             * sweep only looks at a server whose written report is older
             * than its window.
             */
            logger.debug(
              `${dataToProcess.monitorId.toString()} - Server report not written: the last one was written less than ${MonitorHeartbeatState.SERVER_REPORT_WRITE_EVERY_SECONDS} seconds ago.`,
            );
          } else if (!serverMonitorResponse.onlyCheckRequestReceivedAt) {
            /*
             * Heartbeat write: single-statement UPDATE, no hooks and no
             * `version` bump. This DELIBERATELY drops the per-update workflow
             * trigger and audit-log entry that Monitor's @EnableWorkflow /
             * @EnableAuditLog fire on every changed update — the old
             * `ignoreHooks: true` did NOT suppress those (they are gated on
             * the model flag, not on ignoreHooks), so a heartbeat used to
             * spam an on-update workflow + an audit row every ingest. A
             * liveness ping should do neither. onUpdateSuccess is inert here
             * regardless (gated on status/interval/steps/name/etc., none of
             * which are written). Also skips the pre-SELECT that would reload
             * the large serverMonitorResponse jsonb row. See
             * ServiceService.updateLastSeen.
             */
            await MonitorService.updateColumnsByIdWithoutHooks({
              id: monitor.id!,
              data: {
                serverMonitorRequestReceivedAt:
                  serverMonitorResponse.requestReceivedAt!,
                /*
                 * A storable copy; the live response is still being
                 * evaluated. Cut as the monitor's logs are - a process's
                 * command line can carry a password - since nothing judges
                 * it again: the CheckOnlineStatus cron reads only when it
                 * arrived and the host's name.
                 */
                serverMonitorResponse: MonitorRecordEvidence.toStoredCheck({
                  dataToProcess: serverMonitorResponse,
                  keepResponseContent:
                    MonitorRecordEvidence.keepsResponseContent(monitor),
                }) as unknown as ServerMonitorResponse,
              },
            });

            await MonitorHeartbeatState.markWritten({
              monitorId: monitor.id!,
              write: HeartbeatWrite.ServerReport,
              everySeconds:
                MonitorHeartbeatState.SERVER_REPORT_WRITE_EVERY_SECONDS,
            });

            logger.debug(
              `${dataToProcess.monitorId.toString()} - Monitor Server Response Updated`,
            );
          } else {
            logger.debug(
              `${dataToProcess.monitorId.toString()} - Skipping Monitor Server Response persist (cron re-evaluation).`,
            );
          }
        }

        if (incomingMonitorRequest) {
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Incoming request received at ${incomingMonitorRequest.incomingRequestReceivedAt}`,
          );

          /*
           * Heartbeat write: single-statement UPDATE, no hooks and no
           * `version` bump. As with the server-monitor branch above, this
           * deliberately drops the per-update workflow trigger + audit-log
           * entry Monitor would otherwise fire on every heartbeat, and skips
           * the pre-SELECT of the large incomingMonitorRequest jsonb row. See
           * ServiceService.updateLastSeen.
           */
          /*
           * Both copies of the latest request, in this one statement
           * (LatestIncomingRequest): as it came, for the heartbeat job, which
           * judges it again - a filter on its body needs the body the sender
           * sent - and which no one else reads; and the copy people read,
           * cut as the monitor's logs are, by its switch.
           */
          const latestRequest: LatestIncomingRequestColumns =
            LatestIncomingRequest.toColumns({
              request: incomingMonitorRequest,
              keepResponseContent:
                MonitorRecordEvidence.keepsResponseContent(monitor),
            });

          /*
           * Written when the request differs from the last one written in
           * anything the heartbeat sweep judges again, and otherwise at most
           * every so often (MonitorHeartbeatState): a sender repeating the
           * same ping rewrote the row on every call. Its arrival is in
           * IncomingRequestReceivedAtStore, which the sweep judges; the row's
           * is only the floor, so it is never left older than half the
           * monitor's shortest window.
           */
          const requestFingerprint: string =
            MonitorHeartbeatState.getIncomingRequestFingerprint({
              request: incomingMonitorRequest,
              monitorSteps: monitor.monitorSteps,
            });

          if (
            !(await MonitorHeartbeatState.isWriteDue({
              monitorId: monitor.id!,
              write: HeartbeatWrite.IncomingRequest,
              fingerprint: requestFingerprint,
            }))
          ) {
            logger.debug(
              `${dataToProcess.monitorId.toString()} - Incoming request not written: the same request was written moments ago.`,
            );
            hasPersistedMonitorData = true;
            return;
          }

          await MonitorService.updateColumnsByIdWithoutHooks({
            id: monitor.id!,
            data: {
              incomingRequestMonitorHeartbeatCheckedAt:
                OneUptimeDate.getCurrentDate(),
              incomingMonitorRequest: latestRequest.incomingMonitorRequest,
              incomingMonitorRequestAsReceived:
                latestRequest.incomingMonitorRequestAsReceived,
            } as any,
          });

          await MonitorHeartbeatState.markWritten({
            monitorId: monitor.id!,
            write: HeartbeatWrite.IncomingRequest,
            fingerprint: requestFingerprint,
            everySeconds:
              MonitorHeartbeatState.getIncomingRequestWriteEverySeconds(
                monitor.monitorSteps,
              ),
          });

          logger.debug(
            `${dataToProcess.monitorId.toString()} - Monitor Incoming Request Updated`,
          );
        }

        hasPersistedMonitorData = true;
      };

      logger.debug(
        `${dataToProcess.monitorId.toString()} - Saving monitor metrics`,
      );

      /*
       * When this check's rows begin to be written: a criteria that compares
       * the check with the previous one reads the newest row before it, so
       * the check's own rows are never read as its previous check (#10821).
       */
      const checkWrittenAt: Date = OneUptimeDate.getCurrentDate();

      /*
       * The step this result was actually produced for. A probe result carries
       * the monitorStepId it ran, and a monitor can have several steps whose
       * criteria differ - so the step must be looked up, not assumed to be the
       * first one. The lookup used to be performed and its result thrown away,
       * which silently evaluated every result against step 0's criteria and fed
       * step 0's id into checkProbeAgreement (so agreement compared this
       * result against other probes' logs for the wrong step).
       *
       * Decided before the check's rows are written: each row names the step
       * it is judged as, so a window of one step reads that step's checks
       * alone (#10906).
       */
      const monitorStep: MonitorStep | undefined =
        MonitorResourceUtil.findStepToJudge({
          monitorSteps: monitor.monitorSteps,
          dataToProcess: dataToProcess,
        });

      try {
        await MonitorMetricUtil.saveMonitorMetrics({
          monitorId: monitor.id!,
          projectId: monitor.projectId!,
          dataToProcess: dataToProcess,
          probeName: probeName || undefined,
          monitorName: monitorName || undefined,
          monitorLabels: monitor.labels || undefined,
          monitorCustomFields: monitor.customFields || undefined,
          monitorStepId: monitorStep?.id,
          /*
           * A monitor that counts a window's checks of a series counts this
           * one too, read from the series right after (#10355).
           */
          waitUntilReadable: CheckWindowCounts.countsSeriesChecks({
            monitorSteps: monitor.monitorSteps,
            monitorType: monitor.monitorType,
          }),
        });
      } catch (err) {
        logger.error("Unable to save metrics");
        logger.error(err);
      }

      logger.debug(
        `${dataToProcess.monitorId.toString()} - Monitor metrics saved`,
      );

      /*
       * `monitorSteps` is optional on the model. When a monitor has none
       * configured, `monitor.monitorSteps` is undefined and the previous
       * non-null assertion (`!`) was a lie — `monitorSteps.data` then threw
       * "Cannot read properties of null (reading 'data')" inside the probe
       * ingest worker. Guard the value itself and take the existing
       * "no monitoring steps" early return.
       */
      const monitorSteps: MonitorSteps | undefined = monitor.monitorSteps;

      if (
        !monitorSteps ||
        !monitorSteps.data?.monitorStepsInstanceArray ||
        monitorSteps.data?.monitorStepsInstanceArray.length === 0
      ) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - No monitoring steps.`,
        );
        await persistLatestMonitorPayload();

        MonitorLogUtil.saveMonitorLog({
          monitorId: monitor.id!,
          projectId: monitor.projectId!,
          dataToProcess: dataToProcess,
          keepResponseContent:
            MonitorRecordEvidence.keepsResponseContent(monitor),
        });
        return response;
      }

      logger.debug(
        `${dataToProcess.monitorId.toString()} - Auto resolving criteria instances.`,
      );

      const criteriaInstances: Array<MonitorCriteriaInstance> =
        monitorSteps.data.monitorStepsInstanceArray
          .map((step: MonitorStep) => {
            return step.data?.monitorCriteria;
          })
          .filter((criteria: MonitorCriteria | undefined) => {
            return Boolean(criteria);
          })
          .map((criteria: MonitorCriteria | undefined) => {
            return [...(criteria?.data?.monitorCriteriaInstanceArray || [])];
          })
          .flat();

      /*
       * For each criteria, its incident and alert templates that resolve on
       * their own (MonitorAutoResolveTemplates): what a result that no longer
       * meets that criteria resolves. Turning monitoring off reads the same
       * (MonitorTurnedOff), so the two never disagree about which incidents
       * and alerts are this monitor's to resolve.
       */
      const autoResolveTemplateIds: MonitorAutoResolveTemplateIds =
        MonitorAutoResolveTemplates.fromCriteriaInstances(criteriaInstances);

      const autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
        Array<string>
      > = autoResolveTemplateIds.incidents;

      // alerts.

      const autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<
        Array<string>
      > = autoResolveTemplateIds.alerts;

      const criteriaInstanceMap: Dictionary<MonitorCriteriaInstance> = {};

      const criteriaInstanceAlertMap: Dictionary<MonitorCriteriaInstance> = {};

      for (const criteriaInstance of criteriaInstances) {
        criteriaInstanceMap[criteriaInstance.data?.id || ""] = criteriaInstance;
        criteriaInstanceAlertMap[criteriaInstance.data?.id || ""] =
          criteriaInstance;
      }

      logger.debug(
        `Monitor Step: ${monitorStep ? monitorStep.id : "undefined"} (reported: ${(dataToProcess as ProbeMonitorResponse).monitorStepId})`,
      );

      if (!monitorStep) {
        logger.debug("No steps found, ignoring everything.");
        await persistLatestMonitorPayload();

        MonitorLogUtil.saveMonitorLog({
          monitorId: monitor.id!,
          projectId: monitor.projectId!,
          dataToProcess: dataToProcess,
          keepResponseContent:
            MonitorRecordEvidence.keepsResponseContent(monitor),
        });
        return response;
      }

      // now process the monitor step
      response.ingestedMonitorStepId = monitorStep.id;
      logger.debug(`Ingested Monitor Step ID: ${monitorStep.id}`);

      //find next monitor step after this one.
      const nextMonitorStepIndex: number =
        monitorSteps.data.monitorStepsInstanceArray.findIndex(
          (step: MonitorStep) => {
            return step.id.toString() === monitorStep.id.toString();
          },
        );

      response.nextMonitorStepId =
        monitorSteps.data.monitorStepsInstanceArray[
          nextMonitorStepIndex + 1
        ]?.id;

      logger.debug(`Next Monitor Step ID: ${response.nextMonitorStepId}`);

      // now process probe response monitors
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Processing monitor step...`,
      );

      /*
       * The match histories this result is judged with, read once for its
       * own evaluation and the probe agreement pass below alike.
       */
      const matchHistoryReads: CriteriaFilterMatchHistoryReads =
        new CriteriaFilterMatchHistoryReads();

      /*
       * The series behind a grouped monitor's status, which its recovery
       * criteria wait for (GroupedMonitorRecovery): read once, for this
       * result and the probe agreement pass alike, and kept again below once
       * the result is judged.
       */
      const seriesBehindStatus: SeriesBehindStatus =
        SeriesBehindStatus.forMonitorStep({
          monitorId: monitor.id,
          monitorStepId: monitorStep.id,
        });

      /*
       * What this monitor's criteria have already opened, read only if an
       * "All Values" metric series is waiting for a full window - a series
       * whose alert is open keeps being judged on its data points - or a
       * criteria with a recovery condition of its own may be holding
       * (#10355). Read once, for this result and the probe agreement pass,
       * so every probe's check is judged on the same records.
       */
      const criteriaInEffect: CriteriaInEffect =
        CriteriaInEffect.forMonitor(monitor);

      response = await MonitorCriteriaEvaluator.processMonitorStep({
        dataToProcess: dataToProcess,
        monitorStep: monitorStep,
        monitor: monitor,
        probeApiIngestResponse: response,
        evaluationSummary: evaluationSummary,
        /*
         * This is the check that just arrived: record its results for the
         * filters judged from their match history. The probe agreement pass
         * below re-reads other probes' stored checks and records nothing.
         */
        recordMatchHistory: true,
        checkWrittenAt: checkWrittenAt,
        matchHistoryReads: matchHistoryReads,
        criteriaInEffect: criteriaInEffect,
        seriesBehindStatus: seriesBehindStatus,
      });

      /*
       * The criteria that sets the status on this check (#11238), as the
       * evaluator says it: its first match whenever that one changes the
       * status.
       */
      response.statusCriteriaId =
        MonitorResourceUtil.getStatusCriteriaIdOfCheck({
          response: response,
          criteriaInstancesById: criteriaInstanceMap,
        });

      if (
        response.statusCriteriaId &&
        response.statusCriteriaId === response.criteriaMetId &&
        !response.statusRootCause
      ) {
        response.statusRootCause = response.rootCause;
      }

      // What this result's own evaluation decided, before probes agree.
      const evaluatedCriteriaMetId: string | undefined = response.criteriaMetId;
      const evaluatedStatusCriteriaId: string | undefined =
        response.statusCriteriaId;

      /*
       * Whether the monitor's status follows this evaluation (#11238):
       * always, but when the probes agree on what acts on the check - a
       * criteria that changes no status - and not on what sets the status.
       * The status is then kept, as it is when they agree on nothing.
       */
      let isStatusAgreed: boolean = true;

      // Judged; everything from here writes what was decided.
      await keepEvaluationLock();

      // Check probe agreement for probe-based monitors
      if (
        monitor.monitorType &&
        MonitorTypeHelper.isProbableMonitor(monitor.monitorType) &&
        /*
         * Traps arrive on exactly one probe — other probes' polled state
         * cannot corroborate them, so agreement would always veto the trap.
         */
        !isSnmpTrapEvent
      ) {
        const probeAgreementResult: ProbeAgreementResult =
          await MonitorResourceUtil.checkProbeAgreement({
            monitor: monitor,
            monitorStep: monitorStep,
            currentCriteriaMetId: response.criteriaMetId || null,
            currentRootCause: response.rootCause || null,
            currentStatusCriteriaId: response.statusCriteriaId || null,
            currentStatusRootCause: response.statusRootCause || null,
            currentProbeId: (dataToProcess as ProbeMonitorResponse).probeId,
            monitorProbes: monitorProbesForMonitor || undefined,
            matchHistoryReads: matchHistoryReads,
            seriesBehindStatus: seriesBehindStatus,
            criteriaInEffect: criteriaInEffect,
          });

        /*
         * What they agree sets the status, when some probe's first match
         * changes no status (#11238). Absent, every probe's check was
         * decided by its first match, and the status follows what they
         * agree on above, as it always did.
         */
        const statusAgreement: ProbeStatusAgreement | undefined =
          probeAgreementResult.status;

        /*
         * What the monitor's status follows when probes agree on what acts
         * (#11238): that criteria, when it changes the status, and no
         * criteria when they agree none matched - as it always was. Only a
         * criteria that changes no status leaves the status to what the
         * probes agree sets it.
         */
        const isStatusOfAgreedCriteria: boolean =
          !statusAgreement ||
          !probeAgreementResult.agreedCriteriaId ||
          MonitorResourceUtil.getStatusCriteriaIdOfCheck({
            response: { criteriaMetId: probeAgreementResult.agreedCriteriaId },
            criteriaInstancesById: criteriaInstanceMap,
          }) === probeAgreementResult.agreedCriteriaId;

        /*
         * Probes that do not agree on what acts can still agree on the status,
         * when what they disagree on is a criteria that changes no status
         * (#11238): one probe sees a slow answer, another a fast one, and
         * both see the site up. Nothing opens or resolves, as before, and the
         * status follows them: it used to stay where an earlier check left
         * it, for as long as they disagreed.
         */
        const isStatusAloneAgreed: boolean =
          !probeAgreementResult.hasAgreement &&
          Boolean(statusAgreement?.hasAgreement);

        // Add probe agreement event to evaluation summary
        const probeCounts: {
          agreeing: string;
          required: string;
          active: string;
        } = {
          agreeing: String(probeAgreementResult.agreementCount),
          required: String(probeAgreementResult.requiredCount),
          active: String(probeAgreementResult.totalActiveProbes),
        };

        evaluationSummary.events.push({
          type: "probe-agreement",
          ...EvaluationEventText.from({
            title: translatableSentence("Probe Agreement Check"),
            message: probeAgreementResult.hasAgreement
              ? translatableSentence(
                  "Probe agreement reached: {{agreeing}}/{{required}} probes agree ({{active}} active probes total).",
                  probeCounts,
                )
              : isStatusAloneAgreed
                ? translatableSentence(
                    "Probe agreement not reached: {{agreeing}}/{{required}} probes agree ({{active}} active probes total). Nothing opens or resolves.",
                    probeCounts,
                  )
                : translatableSentence(
                    "Probe agreement not reached: {{agreeing}}/{{required}} probes agree ({{active}} active probes total). Skipping status change.",
                    probeCounts,
                  ),
          }),
          at: OneUptimeDate.getCurrentDate(),
        });

        /*
         * What they agree of the status, said when it is decided apart
         * from what acts: the agreed criteria changes no status, or they
         * agree on nothing else.
         */
        if (
          statusAgreement &&
          (isStatusAloneAgreed ||
            (probeAgreementResult.hasAgreement && !isStatusOfAgreedCriteria))
        ) {
          const statusCounts: {
            agreeing: string;
            required: string;
            active: string;
          } = {
            agreeing: String(statusAgreement.agreementCount),
            required: String(probeAgreementResult.requiredCount),
            active: String(probeAgreementResult.totalActiveProbes),
          };

          evaluationSummary.events.push({
            type: "probe-agreement",
            ...EvaluationEventText.from({
              title: translatableSentence("Probe Agreement Check"),
              message: statusAgreement.hasAgreement
                ? translatableSentence(
                    "Probe agreement on the monitor's status reached: {{agreeing}}/{{required}} probes agree ({{active}} active probes total).",
                    statusCounts,
                  )
                : translatableSentence(
                    "Probe agreement on the monitor's status not reached: {{agreeing}}/{{required}} probes agree ({{active}} active probes total). Keeping its status.",
                    statusCounts,
                  ),
            }),
            at: OneUptimeDate.getCurrentDate(),
          });
        }

        if (!probeAgreementResult.hasAgreement) {
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Probe agreement not met. ${probeAgreementResult.agreementCount}/${probeAgreementResult.requiredCount} probes agree.${isStatusAloneAgreed ? " They agree on the status." : " Skipping status change."}`,
          );

          if (isStatusAloneAgreed && statusAgreement) {
            MonitorResourceUtil.useAgreedStatus({
              response: response,
              statusAgreement: statusAgreement,
            });

            await MonitorResourceUtil.setStatusOfCheck({
              monitor: monitor,
              monitorStep: monitorStep,
              dataToProcess: dataToProcess,
              response: response,
              evaluationSummary: evaluationSummary,
              criteriaInstancesById: criteriaInstanceMap,
              isSnmpTrapEvent: isSnmpTrapEvent,
              telemetryQuery: undefined,
              seriesActedOn: new Set<string>(),
              isEveryBreachUnderMaintenance: false,
              getMonitorStatusName: getMonitorStatusName,
              keepEvaluationLock: keepEvaluationLock,
            });
          }

          // Release lock and return early - nothing opens or resolves
          await releaseMutex();

          await persistLatestMonitorPayload();

          MonitorLogUtil.saveMonitorLog({
            monitorId: monitor.id!,
            projectId: monitor.projectId!,
            dataToProcess: dataToProcess,
            keepResponseContent:
              MonitorRecordEvidence.keepsResponseContent(monitor),
            monitorStep: monitorStep,
          });

          response.evaluationSummary = evaluationSummary;
          return response;
        }

        // Use the agreed criteria result
        response.criteriaMetId = probeAgreementResult.agreedCriteriaId
          ? probeAgreementResult.agreedCriteriaId
          : undefined;
        response.rootCause = probeAgreementResult.agreedRootCause;

        // Add probe names in agreement to the root cause
        if (
          response.rootCause &&
          probeAgreementResult.agreedProbeNames.length > 0
        ) {
          // Each probe's name is text, placed into the root cause's Markdown.
          response.rootCause += mdText`
**Probes in Agreement**: ${FeedMarkdown.join(probeAgreementResult.agreedProbeNames)}
`.toString();
        }

        /*
         * And the agreed status: the agreed criteria's own, or what the
         * probes agree sets it when that criteria changes none.
         */
        if (isStatusOfAgreedCriteria) {
          // Its root cause already names the probes that agree.
          MonitorResourceUtil.useAgreedStatus({
            response: response,
            statusAgreement: {
              hasAgreement: true,
              agreementCount: probeAgreementResult.agreementCount,
              agreedCriteriaId: probeAgreementResult.agreedCriteriaId,
              agreedRootCause: response.rootCause,
              agreedProbeNames: [],
            },
          });
        } else if (statusAgreement?.hasAgreement) {
          MonitorResourceUtil.useAgreedStatus({
            response: response,
            statusAgreement: statusAgreement,
          });
        } else {
          isStatusAgreed = false;
        }
      }

      /*
       * What is behind a grouped monitor's status after this result, kept
       * once it is acted on (GroupedMonitorRecovery). Only when the probes
       * agreed with this result's own evaluation: what that saw is not what
       * the monitor's status follows otherwise, and the next result reads
       * what was kept before.
       */
      let seriesBehindStatusAfter: Array<string> | undefined =
        response.criteriaMetId === evaluatedCriteriaMetId &&
        response.statusCriteriaId === evaluatedStatusCriteriaId &&
        isStatusAgreed
          ? response.seriesBehindStatus
          : undefined;

      /*
       * Incoming Request / webhook grouped resolution (event-driven). A
       * payload can explicitly mark keys as resolved (e.g. Grafana
       * status=resolved). Resolve exactly those keys' incidents — never by
       * absence — and each criteria's only for the keys its own recovery
       * fields read resolved (#10585). Runs regardless of whether a firing
       * criteria matched, so a pure "resolved" webhook still closes the
       * right incident. No-op unless a criteria has incidentGrouping
       * configured.
       *
       * A request the matched grouped criteria reads with every item
       * without a value recovered also resolves that criteria's incident
       * and alert for the whole monitor - what a request with no value
       * opened. Only the matched criteria's: a request another criteria
       * matched says nothing of this one's, and that one's are resolved by
       * the other criteria matching anyway.
       */
      if (
        monitor.monitorType === MonitorType.IncomingRequest &&
        criteriaInstances.some((criteriaInstance: MonitorCriteriaInstance) => {
          return IncomingRequestIncidentGrouping.isGroupingConfigured(
            criteriaInstance,
          );
        })
      ) {
        const recoveries: IncomingRequestRecoveries =
          IncomingRequestIncidentGrouping.collectRecoveries({
            dataToProcess: dataToProcess,
            criteriaInstances: criteriaInstances,
            matchedCriteriaId: response.criteriaMetId?.toString(),
          });

        const wholeMonitor:
          | { criteriaIds: Array<string>; rootCause: string }
          | undefined =
          recoveries.wholeMonitorCriteriaIds.length > 0
            ? {
                criteriaIds: recoveries.wholeMonitorCriteriaIds,
                rootCause:
                  "Incoming request with no value to group by reported recovered.",
              }
            : undefined;

        if (recoveries.fingerprints.length > 0 || wholeMonitor) {
          await keepEvaluationLock();

          /*
           * A recovery resolves only what its criteria's incident or alert
           * lets resolve on its own (Auto Resolve). One it leaves open is
           * named in the monitor log, with why (#10550).
           */
          await MonitorIncident.resolveSeriesIncidentsByFingerprint({
            monitor: monitor,
            fingerprints: recoveries.fingerprints,
            /*
             * Each criteria's records resolve on its own recoveries only:
             * another criteria may read the same value as still firing,
             * and resolving its record there reopened it at once (#10585).
             */
            fingerprintsByCriteriaId: recoveries.fingerprintsByCriteriaId,
            rootCause: "Incoming request reported this key as resolved.",
            wholeMonitor: wholeMonitor,
            dataToProcess: dataToProcess,
            autoResolveCriteriaInstanceIdIncidentIdsDictionary,
            evaluationSummary: evaluationSummary,
            noteLeftOpen: true,
          });

          await MonitorAlert.resolveSeriesAlertsByFingerprint({
            monitor: monitor,
            fingerprints: recoveries.fingerprints,
            fingerprintsByCriteriaId: recoveries.fingerprintsByCriteriaId,
            rootCause: "Incoming request reported this key as resolved.",
            wholeMonitor: wholeMonitor,
            dataToProcess: dataToProcess,
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
            evaluationSummary: evaluationSummary,
            noteLeftOpen: true,
          });
        }
      }

      /*
       * A Logs monitor whose groups are resolved by a log ("interface.down"
       * per interface, resolved by "interface.up"). The worker names the
       * groups such a log has arrived for; exactly those groups' incidents
       * and alerts are resolved - never one that has merely gone quiet.
       * Runs whether or not a criteria matched, so the log that brings the
       * last interface back still closes its alert.
       */
      if (monitor.monitorType === MonitorType.Logs) {
        const resolvedLogGroupFingerprints: Array<string> =
          LogGroupCriteriaFanOut.getResolvedFingerprints(dataToProcess);

        if (resolvedLogGroupFingerprints.length > 0) {
          await keepEvaluationLock();

          await MonitorIncident.resolveSeriesIncidentsByFingerprint({
            monitor: monitor,
            fingerprints: resolvedLogGroupFingerprints,
            rootCause: LOG_GROUP_RESOLVED_ROOT_CAUSE,
            resolvedMessage: LOG_GROUP_INCIDENT_RESOLVED_MESSAGE,
            dataToProcess: dataToProcess,
            autoResolveCriteriaInstanceIdIncidentIdsDictionary,
            evaluationSummary: evaluationSummary,
          });

          await MonitorAlert.resolveSeriesAlertsByFingerprint({
            monitor: monitor,
            fingerprints: resolvedLogGroupFingerprints,
            rootCause: LOG_GROUP_RESOLVED_ROOT_CAUSE,
            resolvedMessage: LOG_GROUP_ALERT_RESOLVED_MESSAGE,
            dataToProcess: dataToProcess,
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
            evaluationSummary: evaluationSummary,
          });
        }
      }

      if (response.criteriaMetId && response.rootCause) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Criteria met: ${
            response.criteriaMetId
          }`,
        );
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Root cause: ${
            response.rootCause
          }`,
        );

        let telemetryQuery: TelemetryQuery | undefined = undefined;

        if (dataToProcess && (dataToProcess as LogMonitorResponse).logQuery) {
          telemetryQuery = {
            telemetryQuery: (dataToProcess as LogMonitorResponse).logQuery,
            telemetryType: TelemetryType.Log,
            metricViewData: null,
          };
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Log query found.`,
          );
        }

        if (
          dataToProcess &&
          (dataToProcess as SecurityEventsMonitorResponse).securityEventQuery
        ) {
          telemetryQuery = {
            telemetryQuery: (dataToProcess as SecurityEventsMonitorResponse)
              .securityEventQuery,
            telemetryType: TelemetryType.SecurityEvent,
            metricViewData: null,
          };
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Security event query found.`,
          );
        }

        /*
         * An AI / LLM check links to the AI calls it read, in the trace
         * explorer: they are spans.
         */
        if (
          dataToProcess &&
          (dataToProcess as LlmMonitorResponse).llmSpanQuery
        ) {
          telemetryQuery = {
            telemetryQuery: (dataToProcess as LlmMonitorResponse).llmSpanQuery,
            telemetryType: TelemetryType.Trace,
            metricViewData: null,
          };
          logger.debug(
            `${dataToProcess.monitorId.toString()} - AI call query found.`,
          );
        }

        if (
          dataToProcess &&
          (dataToProcess as TraceMonitorResponse).spanQuery
        ) {
          telemetryQuery = {
            telemetryQuery: (dataToProcess as TraceMonitorResponse).spanQuery,
            telemetryType: TelemetryType.Trace,
            metricViewData: null,
          };
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Span query found.`,
          );
        }

        if (
          dataToProcess &&
          (dataToProcess as MetricMonitorResponse).metricViewConfig &&
          (dataToProcess as MetricMonitorResponse).startAndEndDate
        ) {
          /*
           * Each query as the check read it: with the cluster, host or
           * fleet an infrastructure monitor narrows it to, so the event's
           * card charts what the monitor evaluated (issue #6265). And a
           * resource monitor's logs and traces, which the event's tabs read
           * (#10451).
           */
          telemetryQuery = MetricTelemetrySnapshot.fromResponse(
            dataToProcess as MetricMonitorResponse,
            { monitorType: monitor.monitorType, monitorStep: monitorStep },
          );
          logger.debug(
            `${dataToProcess.monitorId.toString()} - Metric query found.`,
          );
        }

        if (
          dataToProcess &&
          (dataToProcess as ExceptionMonitorResponse).exceptionQuery
        ) {
          const exceptionResponse: ExceptionMonitorResponse =
            dataToProcess as ExceptionMonitorResponse;
          telemetryQuery = {
            telemetryQuery: exceptionResponse.exceptionQuery,
            telemetryType: TelemetryType.Exception,
            metricViewData: null,
          };

          logger.debug(
            `${dataToProcess.monitorId.toString()} - Exception query found.`,
          );
        }

        const matchedCriteriaInstance: MonitorCriteriaInstance =
          criteriaInstanceMap[response.criteriaMetId!]!;

        /*
         * The criteria this evaluation is going to act on.
         *
         * Grouped monitors evaluate every criteria and can match several
         * at once — host A critical while host B is only warning — so
         * they hand back a list. Everything else keeps the historical
         * single-winner shape, reconstructed here so both cases go down
         * exactly the same code path below.
         */
        const criteriaFanOut: Array<MatchedCriteriaResult> =
          response.matchedCriteria ?? [
            {
              criteriaId: response.criteriaMetId!,
              rootCause: response.rootCause,
              perSeriesMatches: response.perSeriesMatches ?? [],
            },
          ];

        const isPerSeriesEvaluation: boolean =
          response.perSeriesMatches !== undefined;

        /*
         * Every series breaching anything on this tick, and the same
         * broken out per criteria.
         *
         * The resolve pass needs the per-criteria view: "is host B still
         * breaching?" has to be answered against the criteria that
         * raised host B's alert, not against whichever criteria happened
         * to win the tick. Answering it against the winner resolved a
         * still-valid warning alert the moment another host went
         * critical. A criteria that ran and matched nothing maps to an
         * empty set — that is what lets a recovered series resolve —
         * while a criteria that never ran is absent, and its records are
         * left alone.
         */
        const breachingSeriesFingerprintsByCriteriaId: Dictionary<Set<string>> =
          {};

        if (response.evaluatedCriteriaIds) {
          for (const evaluatedCriteriaId of response.evaluatedCriteriaIds) {
            breachingSeriesFingerprintsByCriteriaId[evaluatedCriteriaId] =
              new Set<string>();
          }
        }

        const allBreachingSeriesFingerprints: Set<string> = new Set<string>();

        for (const matched of criteriaFanOut) {
          const forCriteria: Set<string> =
            breachingSeriesFingerprintsByCriteriaId[matched.criteriaId] ||
            new Set<string>();

          breachingSeriesFingerprintsByCriteriaId[matched.criteriaId] =
            forCriteria;

          for (const seriesMatch of matched.perSeriesMatches) {
            forCriteria.add(seriesMatch.fingerprint);
            allBreachingSeriesFingerprints.add(seriesMatch.fingerprint);
          }
        }

        /*
         * Scheduled-maintenance suppression, computed once and shared by
         * both the incident and alert paths:
         *
         *   - per series: for grouped monitors, the breaching series whose
         *     own resource is inside an ongoing maintenance window. Those
         *     series are suppressed below so the monitor keeps alerting on
         *     the rest.
         *   - whole monitor: a monitor whose own configuration names a
         *     database under maintenance (and nothing outside the window) —
         *     every recommended database monitor is ungrouped, so it has no
         *     series for the first half to match. Creation is skipped in the
         *     loop below.
         *
         * Cheap on the common path: a monitor with no per-series matches
         * that names no database costs nothing, and no ongoing maintenance
         * costs one query.
         */
        const maintenanceSuppression: MonitorMaintenanceSuppressionResult =
          await MonitorMaintenanceSuppression.getMaintenanceSuppression({
            monitor: monitor,
            matchesPerSeries: isPerSeriesEvaluation
              ? criteriaFanOut.flatMap((matched: MatchedCriteriaResult) => {
                  return matched.perSeriesMatches;
                })
              : undefined,
          });

        const suppressedSeriesFingerprints: Set<string> =
          maintenanceSuppression.suppressedSeriesFingerprints;

        await keepEvaluationLock();

        /*
         * The check's status: from the first criteria that matched among
         * those that change it, which is the matched criteria itself
         * whenever that one changes the status - or, when none of them
         * matched, wherever a check that matched nothing takes it (#11238).
         * Kept when the probes agree on what acts but not on the status.
         *
         * Planned work on one host of an OpenStack cloud keeps the monitor's
         * status, so a status page stays as it is: see
         * isEveryBreachUnderMaintenance.
         */
        if (isStatusAgreed) {
          const statusCriteriaInstance: MonitorCriteriaInstance | undefined =
            response.statusCriteriaId
              ? criteriaInstanceMap[response.statusCriteriaId]
              : undefined;

          const statusOfCheck: StatusOfCheck =
            await MonitorResourceUtil.setStatusOfCheck({
              monitor: monitor,
              monitorStep: monitorStep,
              dataToProcess: dataToProcess,
              response: response,
              evaluationSummary: evaluationSummary,
              criteriaInstancesById: criteriaInstanceMap,
              isSnmpTrapEvent: isSnmpTrapEvent,
              telemetryQuery: telemetryQuery,
              seriesActedOn: allBreachingSeriesFingerprints,
              isEveryBreachUnderMaintenance:
                MonitorMaintenanceSuppression.isEveryBreachUnderMaintenance({
                  monitor: monitor,
                  isPerSeriesEvaluation: isPerSeriesEvaluation,
                  criteriaInstance: statusCriteriaInstance,
                  breachingFingerprints: new Set<string>(
                    criteriaFanOut.flatMap((matched: MatchedCriteriaResult) => {
                      const criteria: MonitorCriteriaInstance | undefined =
                        criteriaInstanceMap[matched.criteriaId];

                      return criteria?.data?.createIncidents ||
                        criteria?.data?.createAlerts
                        ? matched.perSeriesMatches.map(
                            (series: PerSeriesCriteriaMatch): string => {
                              return series.fingerprint;
                            },
                          )
                        : [];
                    }),
                  ),
                  suppressedFingerprints: suppressedSeriesFingerprints,
                }),
              getMonitorStatusName: getMonitorStatusName,
              keepEvaluationLock: keepEvaluationLock,
            });

          // Back on its default status: nothing is behind it any more.
          if (
            statusOfCheck === StatusOfCheck.BackToDefault &&
            seriesBehindStatusAfter !== undefined
          ) {
            seriesBehindStatusAfter = [];
          }
        }

        /*
         * Alert-dependency suppression: if any parent monitor this monitor
         * depends on is currently in a suppressing status (offline by
         * default), skip creating incidents/alerts for this evaluation.
         * Deliberately computed AFTER the status timeline update above —
         * the child's own status must keep tracking reality (status pages,
         * transitive dependency checks); only the redundant paging is
         * silenced. The resolve path for already-open incidents/alerts is
         * likewise untouched. Zero queries when the monitor has no
         * dependencies configured.
         */
        const dependencySuppression: DependencySuppressionResult =
          await OpenStackDependencySuppression.forEvaluation({
            monitor: monitor,
            suppression:
              await MonitorDependencySuppression.getDependencySuppression({
                monitor: monitor,
              }),
          });

        /*
         * Freeze the Monitor Summary as it stands right now, before any
         * incident or alert is created from it. Both creators store the
         * same capture, so the incident page can show what the monitor
         * saw long after MonitorLog's TTL (one day by default) has
         * dropped the underlying log.
         *
         * Built only when a record is really created, once for every one
         * (getMonitorSummary): almost every matched result creates nothing,
         * and a Network Device monitor's capture reads its probe's name.
         * What it captures is still the evaluation as it stands here - its
         * events up to this point are copied now - so a record opened below
         * shows what it showed when the capture was made up front.
         */
        const evaluationSummaryAtCapture: MonitorEvaluationSummary = {
          ...evaluationSummary,
          criteriaResults: [...evaluationSummary.criteriaResults],
          events: [...evaluationSummary.events],
        };

        let monitorSummary: Promise<MonitorSummarySnapshot | null> | null =
          null;

        const getMonitorSummary: () => Promise<MonitorSummarySnapshot | null> =
          (): Promise<MonitorSummarySnapshot | null> => {
            if (!monitorSummary) {
              monitorSummary = MonitorSummaryCapture.capture({
                monitor: monitor,
                dataToProcess: dataToProcess,
                evaluationSummary: evaluationSummaryAtCapture,
                probeName: probeName,
              });
            }

            return monitorSummary;
          };

        /*
         * What every incident and alert opened below is about beyond its
         * series - the resources the monitor's config names and those it
         * was linked to by hand - read the first time a record is really
         * created, and once for all of them (issue #8118): an evaluation
         * that opened an incident and an alert read the linked resources
         * twice, once per creator. One that opens nothing reads neither.
         */
        const recordResources: MonitorRecordResources =
          MonitorResourceContextUtil.forEvaluation({ monitor: monitor });

        /*
         * Incoming-request grouping is event-driven: a webhook describes
         * only the keys in its payload, so absence from this tick is not
         * recovery. Skip the snapshot absence-resolve pass; grouped
         * incidents/alerts are resolved explicitly via the resolution
         * block above. Per-key create + dedupe still run from
         * matchesPerSeries.
         */
        const disableSeriesAbsenceResolution: boolean =
          MonitorResourceUtil.isSeriesResolvedExplicitly({
            monitor: monitor,
            dataToProcess: dataToProcess,
          });

        const breachingSeriesFingerprints: Set<string> | undefined =
          isPerSeriesEvaluation && !disableSeriesAbsenceResolution
            ? allBreachingSeriesFingerprints
            : undefined;

        /*
         * Resolve first, once, for the whole evaluation — then create.
         *
         * The resolve pass has to see every criteria's breaching set at
         * the same time. Running it once per matching criteria would let
         * each criteria absence-resolve the records the others just
         * justified. The creators are handed the survivors so they never
         * dedupe a new alert against one this pass has already closed.
         *
         * A kind of record no criteria met opens is read only to
         * auto-resolve it, and is not read at all when the monitor is known
         * to have none open that a criteria raised (MonitorOpenRecords): a
         * healthy check, almost every result, reads neither.
         */
        const opensIncidents: boolean = criteriaFanOut.some(
          (matched: MatchedCriteriaResult): boolean => {
            return (
              criteriaInstanceMap[matched.criteriaId]?.data?.createIncidents ===
              true
            );
          },
        );

        const opensAlerts: boolean = criteriaFanOut.some(
          (matched: MatchedCriteriaResult): boolean => {
            return (
              criteriaInstanceAlertMap[matched.criteriaId]?.data
                ?.createAlerts === true
            );
          },
        );

        const openRecordsReading: MonitorOpenRecordsReading =
          await MonitorResourceUtil.readWhatIsKnownOfOpenRecords({
            monitor: monitor,
            opensIncidents: opensIncidents,
            opensAlerts: opensAlerts,
          });

        await keepEvaluationLock();

        const openIncidents: Array<Incident> =
          await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
            monitor: monitor,
            kind: MonitorRecordKind.Incident,
            reading: openRecordsReading,
            opensRecords: opensIncidents,
            read: (): Promise<Array<Incident>> => {
              return MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
                monitorId: monitor.id!,
                projectId: monitor.projectId!,
                autoResolveCriteriaInstanceIdIncidentIdsDictionary,
                rootCause: response.rootCause!,
                criteriaInstance: matchedCriteriaInstance,
                dataToProcess: dataToProcess,
                evaluationSummary: evaluationSummary,
                breachingSeriesFingerprints,
                breachingSeriesFingerprintsByCriteriaId:
                  response.matchedCriteria
                    ? breachingSeriesFingerprintsByCriteriaId
                    : undefined,
                disableSeriesAbsenceResolution,
                criteriaInstancesById: criteriaInstanceMap,
                keepResponseContent:
                  MonitorRecordEvidence.keepsResponseContent(monitor),
                monitorStep: monitorStep,
                keepEvaluationLock: keepEvaluationLock,
              });
            },
          });

        const openAlerts: Array<Alert> =
          await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
            monitor: monitor,
            kind: MonitorRecordKind.Alert,
            reading: openRecordsReading,
            opensRecords: opensAlerts,
            read: (): Promise<Array<Alert>> => {
              return MonitorAlert.checkOpenAlertsAndCloseIfResolved({
                monitorId: monitor.id!,
                projectId: monitor.projectId!,
                autoResolveCriteriaInstanceIdAlertIdsDictionary,
                rootCause: response.rootCause!,
                criteriaInstance: matchedCriteriaInstance,
                dataToProcess: dataToProcess,
                evaluationSummary: evaluationSummary,
                breachingSeriesFingerprints,
                breachingSeriesFingerprintsByCriteriaId:
                  response.matchedCriteria
                    ? breachingSeriesFingerprintsByCriteriaId
                    : undefined,
                disableSeriesAbsenceResolution,
                criteriaInstancesById: criteriaInstanceAlertMap,
                keepResponseContent:
                  MonitorRecordEvidence.keepsResponseContent(monitor),
                monitorStep: monitorStep,
                keepEvaluationLock: keepEvaluationLock,
              });
            },
          });

        /*
         * De-escalation: a host that breaches both "critical" and
         * "warning" of one check gets one record, from the first (highest
         * priority) of those bands that claims it - criteria are in
         * user-defined order. Only bands of one another share a series
         * (CriteriaBands, #11349): a criteria that checks something else
         * claims it for itself, so a busy port and a port logging errors
         * are two alerts. Tracked separately for incidents and alerts
         * because a criteria can create one without the other.
         */
        const seriesClaimedByIncidentCriteria: SeriesClaims = new Map();
        const seriesClaimedByAlertCriteria: SeriesClaims = new Map();

        for (const matched of criteriaFanOut) {
          const criteriaInstance: MonitorCriteriaInstance | undefined =
            criteriaInstanceMap[matched.criteriaId];

          if (!criteriaInstance) {
            continue;
          }

          /*
           * The monitor watches a database that is inside an ongoing
           * scheduled maintenance window: create nothing for this
           * criteria. The status timeline was updated above and the
           * resolve pass has already run, so only creation is silenced —
           * the same contract as per-series and dependency suppression.
           */
          if (
            MonitorMaintenanceSuppression.isMonitorSuppressed(
              maintenanceSuppression,
            )
          ) {
            MonitorMaintenanceSuppression.recordMonitorSuppressed({
              evaluationSummary: evaluationSummary,
              criteriaInstance: criteriaInstance,
              suppression: maintenanceSuppression,
            });
            continue;
          }

          /*
           * An Incoming Email criteria that opens an incident for every
           * email hands the creators this email's own match - or none, for
           * a reply, a second delivery, an automatic reply or a monitor at
           * its hourly limit (IncomingEmailOpenForEveryEmail). Anything
           * else gets nothing here and opens one at a time, as always.
           */
          const everyEmail: EveryEmailMatches = isPerSeriesEvaluation
            ? {}
            : await IncomingEmailOpenForEveryEmail.getMatches({
                monitor: monitor,
                criteriaInstance: criteriaInstance,
                dataToProcess: dataToProcess,
                rootCause: matched.rootCause,
                evaluationSummary: evaluationSummary,
              });

          /*
           * Why this criteria fired, for the incident and the alert it
           * opens: built the first time either is really created, once
           * for both.
           */
          const getEvaluationDetails: GetEvaluationDetails =
            MonitorEvaluationDetailsCapture.forCriteria({
              monitor: monitor,
              monitorStep: monitorStep,
              criteriaInstance: criteriaInstance,
              evaluationSummary: evaluationSummary,
              dataToProcess: dataToProcess,
              probeName: probeName,
            });

          await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus(
            {
              monitor: monitor,
              rootCause: matched.rootCause,
              dataToProcess: dataToProcess,
              autoResolveCriteriaInstanceIdIncidentIdsDictionary,
              criteriaInstance: criteriaInstance,
              evaluationSummary: evaluationSummary,
              getMonitorSummary: getMonitorSummary,
              getEvaluationDetails: getEvaluationDetails,
              recordResources: recordResources,
              props: {
                telemetryQuery: telemetryQuery,
              },
              matchesPerSeries: isPerSeriesEvaluation
                ? MonitorResourceUtil.claimUnclaimedSeries({
                    matches: matched.perSeriesMatches,
                    claimed: seriesClaimedByIncidentCriteria,
                    criteriaInstance: criteriaInstance,
                    kind: MonitorRecordKind.Incident,
                    isClaiming: criteriaInstance.data?.createIncidents === true,
                    evaluationSummary: evaluationSummary,
                  })
                : everyEmail.incidents,
              openIncidents,
              suppressedSeriesFingerprints,
              dependencySuppression,
              disableSeriesAbsenceResolution,
              keepEvaluationLock: keepEvaluationLock,
            },
          );

          await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
            monitor: monitor,
            rootCause: matched.rootCause,
            dataToProcess: dataToProcess,
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
            criteriaInstance: criteriaInstanceAlertMap[matched.criteriaId]!,
            evaluationSummary: evaluationSummary,
            getMonitorSummary: getMonitorSummary,
            getEvaluationDetails: getEvaluationDetails,
            recordResources: recordResources,
            props: {
              telemetryQuery: telemetryQuery,
            },
            matchesPerSeries: isPerSeriesEvaluation
              ? MonitorResourceUtil.claimUnclaimedSeries({
                  matches: matched.perSeriesMatches,
                  claimed: seriesClaimedByAlertCriteria,
                  criteriaInstance: criteriaInstance,
                  kind: MonitorRecordKind.Alert,
                  isClaiming: criteriaInstance.data?.createAlerts === true,
                  evaluationSummary: evaluationSummary,
                })
              : everyEmail.alerts,
            openAlerts,
            suppressedSeriesFingerprints,
            dependencySuppression,
            disableSeriesAbsenceResolution,
            keepEvaluationLock: keepEvaluationLock,
          });
        }
      } else if (
        !response.criteriaMetId &&
        !isSnmpTrapEvent &&
        (response.seriesKeepingStatus || []).length > 0 &&
        monitorSteps.data.defaultMonitorStatusId &&
        monitor.currentMonitorStatusId?.toString() !==
          monitorSteps.data.defaultMonitorStatusId.toString()
      ) {
        /*
         * No criteria matched, and a grouped monitor's recovery criteria wait
         * for series behind its status that have not met them yet
         * (GroupedMonitorRecovery): the monitor keeps its status. Going to
         * its default status would bring it back all the same, and the
         * margin its recovery criteria keeps would not hold.
         */
        await MonitorResourceUtil.keepStatusForSeriesBehindIt({
          monitor: monitor,
          monitorStep: monitorStep,
          dataToProcess: dataToProcess,
          response: response,
          evaluationSummary: evaluationSummary,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            autoResolveCriteriaInstanceIdIncidentIdsDictionary,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
          criteriaInstancesById: criteriaInstanceMap,
          alertCriteriaInstancesById: criteriaInstanceAlertMap,
          keepEvaluationLock: keepEvaluationLock,
        });
      } else if (
        !response.criteriaMetId &&
        !isSnmpTrapEvent &&
        (response.statusKeptForRecoveryCriteriaIds || []).length > 0 &&
        // Silence keeps everything as it is, below.
        !MonitorResourceUtil.isSilentInfrastructureWindow({
          monitor: monitor,
          dataToProcess: dataToProcess,
        }) &&
        monitorSteps.data.defaultMonitorStatusId &&
        monitor.currentMonitorStatusId?.toString() !==
          monitorSteps.data.defaultMonitorStatusId.toString()
      ) {
        /*
         * No criteria matched a monitor that judges no series on its own,
         * whose status a problem criteria set: it keeps it until a recovery
         * criteria brings it back (#10743), so the margin between the two
         * holds. Going to its default status would bring it back all the
         * same.
         */
        await MonitorResourceUtil.keepStatusUntilRecovered({
          monitor: monitor,
          monitorStep: monitorStep,
          dataToProcess: dataToProcess,
          response: response,
          evaluationSummary: evaluationSummary,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            autoResolveCriteriaInstanceIdIncidentIdsDictionary,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
          criteriaInstancesById: criteriaInstanceMap,
          keepEvaluationLock: keepEvaluationLock,
        });
      } else if (
        !response.criteriaMetId &&
        /*
         * A trap that matches no criteria is simply ignored — it must not
         * reset the monitor to its default status (the polled checks own
         * the monitor's state).
         */
        !isSnmpTrapEvent &&
        /*
         * An infrastructure monitor whose agent sent nothing in the window
         * keeps its status and its open incidents and alerts: silence is
         * not recovery (isSilentInfrastructureWindow).
         */
        !MonitorResourceUtil.isSilentInfrastructureWindow({
          monitor: monitor,
          dataToProcess: dataToProcess,
        }) &&
        monitorSteps.data.defaultMonitorStatusId &&
        monitor.currentMonitorStatusId?.toString() !==
          monitorSteps.data.defaultMonitorStatusId.toString()
      ) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - No criteria met. Change to default status.`,
        );

        // Back on its default status: nothing is behind it any more.
        if (seriesBehindStatusAfter !== undefined) {
          seriesBehindStatusAfter = [];
        }

        /*
         * No criteria met opens anything: each kind is read only to
         * auto-resolve it, and not read when none a criteria raised is open
         * (MonitorOpenRecords).
         */
        const noCriteriaOpenRecords: MonitorOpenRecordsReading =
          await MonitorResourceUtil.readWhatIsKnownOfOpenRecords({
            monitor: monitor,
            opensIncidents: false,
            opensAlerts: false,
          });

        await keepEvaluationLock();

        await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
          monitor: monitor,
          kind: MonitorRecordKind.Incident,
          reading: noCriteriaOpenRecords,
          opensRecords: false,
          read: (): Promise<Array<Incident>> => {
            return MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
              monitorId: monitor.id!,
              projectId: monitor.projectId!,
              autoResolveCriteriaInstanceIdIncidentIdsDictionary,
              rootCause:
                "No monitoring criteria met. Change to default status.",
              criteriaInstance: null, // no criteria met!
              dataToProcess: dataToProcess,
              evaluationSummary: evaluationSummary,
              keepResponseContent:
                MonitorRecordEvidence.keepsResponseContent(monitor),
              monitorStep: monitorStep,
              keepEvaluationLock: keepEvaluationLock,
              /*
               * Event-driven grouping: for incoming-request monitors, never
               * absence-resolve per-key (seriesFingerprint) incidents on the
               * no-criteria-met path — a heartbeat tick or a rejected webhook
               * must not bulk-close grouped incidents. They resolve only via
               * the explicit resolution block above. Non-grouped incoming
               * incidents have no seriesFingerprint, so they still resolve
               * normally; non-incoming-request types are unaffected (flag
               * false).
               *
               * A Logs monitor whose groups are resolved by a log is the same
               * case: with no log in the window no criteria is met, and that
               * is silence, not recovery.
               */
              disableSeriesAbsenceResolution:
                MonitorResourceUtil.isSeriesResolvedExplicitly({
                  monitor: monitor,
                  dataToProcess: dataToProcess,
                }),
            });
          },
        });

        await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
          monitor: monitor,
          kind: MonitorRecordKind.Alert,
          reading: noCriteriaOpenRecords,
          opensRecords: false,
          read: (): Promise<Array<Alert>> => {
            return MonitorAlert.checkOpenAlertsAndCloseIfResolved({
              monitorId: monitor.id!,
              projectId: monitor.projectId!,
              autoResolveCriteriaInstanceIdAlertIdsDictionary,
              rootCause:
                "No monitoring criteria met. Change to default status.",
              criteriaInstance: null, // no criteria met!
              dataToProcess: dataToProcess,
              evaluationSummary: evaluationSummary,
              keepResponseContent:
                MonitorRecordEvidence.keepsResponseContent(monitor),
              monitorStep: monitorStep,
              keepEvaluationLock: keepEvaluationLock,
              disableSeriesAbsenceResolution:
                MonitorResourceUtil.isSeriesResolvedExplicitly({
                  monitor: monitor,
                  dataToProcess: dataToProcess,
                }),
            });
          },
        });

        // if no criteria is met then update monitor to default state.
        await MonitorResourceUtil.moveToDefaultStatus({
          monitor: monitor,
          defaultMonitorStatusId: monitorSteps.data.defaultMonitorStatusId,
          monitorStep: monitorStep,
          dataToProcess: dataToProcess,
          evaluationSummary: evaluationSummary,
          because: DefaultStatusBecause.NoCriteriaMet,
          getMonitorStatusName: getMonitorStatusName,
          keepEvaluationLock: keepEvaluationLock,
        });
      } else if (
        !response.criteriaMetId &&
        !isSnmpTrapEvent &&
        !MonitorResourceUtil.isSilentInfrastructureWindow({
          monitor: monitor,
          dataToProcess: dataToProcess,
        }) &&
        monitorSteps.data.defaultMonitorStatusId &&
        monitor.currentMonitorStatusId?.toString() ===
          monitorSteps.data.defaultMonitorStatusId.toString()
      ) {
        /*
         * No criteria matched a monitor already on its default status: what
         * a criteria that changes no status raised - an alert-only criteria
         * - resolves now, as it does when the monitor goes back to its
         * default status from another one. It stayed open for as long as
         * the monitor stayed on its default status, which on a monitor
         * whose healthy state matches nothing is for ever: a Network Device
         * monitor from the recommended alert pack kept "SNMP walk failing"
         * open on a switch whose SNMP had been fixed (issue #11071).
         */
        await MonitorResourceUtil.resolveWhatNoCriteriaHolds({
          monitor: monitor,
          monitorStep: monitorStep,
          dataToProcess: dataToProcess,
          evaluationSummary: evaluationSummary,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            autoResolveCriteriaInstanceIdIncidentIdsDictionary,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            autoResolveCriteriaInstanceIdAlertIdsDictionary,
          keepEvaluationLock: keepEvaluationLock,
        });
      }

      /*
       * What is behind a grouped monitor's status after this check, for the
       * next one to wait for (GroupedMonitorRecovery), written while the
       * monitor's lock is still held.
       */
      if (seriesBehindStatusAfter !== undefined) {
        await keepEvaluationLock();
        await seriesBehindStatus.keep(seriesBehindStatusAfter);
      }

      await releaseMutex();

      await persistLatestMonitorPayload();

      /*
       * An incoming request or email evaluated: what it judged is recorded,
       * so a heartbeat sweep that would judge the same again can skip it
       * (MonitorHeartbeatState.canSkipEvaluation).
       */
      await MonitorResourceUtil.markHeartbeatEvaluated({
        monitor: monitor,
        dataToProcess: dataToProcess,
        monitorStatusIdFound: monitorStatusIdFound,
      });

      MonitorLogUtil.saveMonitorLog({
        monitorId: monitor.id!,
        projectId: monitor.projectId!,
        dataToProcess: dataToProcess,
        keepResponseContent:
          MonitorRecordEvidence.keepsResponseContent(monitor),
        monitorStep: monitorStep,
        seriesActedOn: MonitorResourceUtil.getSeriesActedOn(response),
      });

      return response;
    } finally {
      await releaseMutex();
    }
  }

  /*
   * A grouped monitor whose recovery criteria wait for series behind its
   * status that have not met them yet (GroupedMonitorRecovery), on a check no
   * criteria matched: the monitor keeps its status, rather than going to its
   * default status. What is open still resolves series by series, exactly as
   * when a recovery criteria matches: each incident and alert whose series no
   * longer meets the criteria that opened it, and whose criteria resolves it
   * on its own. The evaluation log says the status was kept, and for which
   * series.
   */
  public static async keepStatusForSeriesBehindIt(input: {
    monitor: Monitor;
    monitorStep: MonitorStep;
    dataToProcess: DataToProcess;
    response: ProbeApiIngestResponse;
    evaluationSummary: MonitorEvaluationSummary;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    criteriaInstancesById: Dictionary<MonitorCriteriaInstance>;
    alertCriteriaInstancesById: Dictionary<MonitorCriteriaInstance>;
    keepEvaluationLock: () => Promise<void>;
  }): Promise<void> {
    const seriesKeepingStatus: Array<SeriesKeepingStatus> =
      input.response.seriesKeepingStatus || [];

    logger.debug(
      `${input.dataToProcess.monitorId.toString()} - No criteria met, and ${seriesKeepingStatus.length} series behind the monitor's status have not met a recovery criteria yet. Keeping the status.`,
    );

    /*
     * Nothing breaches on this check: every criteria that ran matched no
     * series, which is what lets each open record resolve on its own series.
     */
    const breachingSeriesFingerprintsByCriteriaId: Dictionary<Set<string>> = {};

    for (const criteriaId of input.response.evaluatedCriteriaIds || []) {
      breachingSeriesFingerprintsByCriteriaId[criteriaId] = new Set<string>();
    }

    const disableSeriesAbsenceResolution: boolean =
      MonitorResourceUtil.isSeriesResolvedExplicitly({
        monitor: input.monitor,
        dataToProcess: input.dataToProcess,
      });

    const breachingSeriesFingerprints: Set<string> | undefined =
      disableSeriesAbsenceResolution ? undefined : new Set<string>();

    const rootCause: string =
      "No monitoring criteria met. The monitor keeps its status until the series behind it meet a criteria that brings it back.";

    const openRecords: MonitorOpenRecordsReading =
      await MonitorResourceUtil.readWhatIsKnownOfOpenRecords({
        monitor: input.monitor,
        opensIncidents: false,
        opensAlerts: false,
      });

    await input.keepEvaluationLock();

    await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
      monitor: input.monitor,
      kind: MonitorRecordKind.Incident,
      reading: openRecords,
      opensRecords: false,
      read: (): Promise<Array<Incident>> => {
        return MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
          rootCause: rootCause,
          criteriaInstance: null,
          dataToProcess: input.dataToProcess,
          evaluationSummary: input.evaluationSummary,
          breachingSeriesFingerprints: breachingSeriesFingerprints,
          breachingSeriesFingerprintsByCriteriaId:
            breachingSeriesFingerprintsByCriteriaId,
          disableSeriesAbsenceResolution: disableSeriesAbsenceResolution,
          criteriaInstancesById: input.criteriaInstancesById,
          keepResponseContent: MonitorRecordEvidence.keepsResponseContent(
            input.monitor,
          ),
          monitorStep: input.monitorStep,
          keepEvaluationLock: input.keepEvaluationLock,
        });
      },
    });

    await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
      monitor: input.monitor,
      kind: MonitorRecordKind.Alert,
      reading: openRecords,
      opensRecords: false,
      read: (): Promise<Array<Alert>> => {
        return MonitorAlert.checkOpenAlertsAndCloseIfResolved({
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
          rootCause: rootCause,
          criteriaInstance: null,
          dataToProcess: input.dataToProcess,
          evaluationSummary: input.evaluationSummary,
          breachingSeriesFingerprints: breachingSeriesFingerprints,
          breachingSeriesFingerprintsByCriteriaId:
            breachingSeriesFingerprintsByCriteriaId,
          disableSeriesAbsenceResolution: disableSeriesAbsenceResolution,
          criteriaInstancesById: input.alertCriteriaInstancesById,
          keepResponseContent: MonitorRecordEvidence.keepsResponseContent(
            input.monitor,
          ),
          monitorStep: input.monitorStep,
          keepEvaluationLock: input.keepEvaluationLock,
        });
      },
    });

    input.evaluationSummary.events.push(
      MonitorResourceUtil.describeSeriesKeepingStatus(seriesKeepingStatus),
    );
  }

  /*
   * The evaluation log's word that a grouped monitor keeps its status, and
   * for which series: the first few by name, then how many more.
   */
  public static describeSeriesKeepingStatus(
    seriesKeepingStatus: Array<SeriesKeepingStatus>,
  ): MonitorEvaluationEvent {
    const named: Array<string> = seriesKeepingStatus
      .slice(0, SERIES_NAMED_WHEN_STATUS_KEPT)
      .map((series: SeriesKeepingStatus): string => {
        return (
          SeriesLabelDisplay.buildInlineSummary(series.labels, {
            context: series.context,
          }) || series.fingerprint
        );
      });

    const unnamedCount: number = seriesKeepingStatus.length - named.length;

    // "Mount: /a; Mount: /b; Mount: /c and 4 more", in the reader's words.
    const series: EvaluationSentenceValue =
      unnamedCount > 0
        ? translatablePluralSentence(
            {
              one: translationKey("{{names}} and {{count}} more"),
              other: translationKey("{{names}} and {{count}} more"),
            },
            unnamedCount,
            { names: named.join("; ") },
          )
        : named.join("; ");

    return {
      type: "monitor-status-kept",
      ...EvaluationEventText.from({
        title: translatableSentence("Monitor status kept"),
        message: translatableSentence(
          "The monitor keeps its status: it waits for {{series}} to meet a criteria that brings it back.",
          { series: series },
        ),
      }),
      at: OneUptimeDate.getCurrentDate(),
    };
  }

  /*
   * A monitor that judges no series on its own, on a check no criteria
   * matched, whose status a problem criteria set while its step has a
   * recovery criteria (GroupedMonitorRecovery.judgeWholeMonitor, #10743):
   * it keeps its status until a recovery criteria matches, so the margin
   * between a criteria that fires above 90% and one that recovers at or
   * below 81% holds. What is open resolves as on any check no criteria
   * matched: each incident and alert whose criteria resolves it on its own.
   * The evaluation log says the status was kept, and for which criteria.
   */
  /*
   * A monitor already on its default status, on a check no criteria
   * matched: it stays there, and what its criteria raised and resolve on
   * their own - an alert-only criteria's alert - resolves, exactly as when
   * the monitor goes back to its default status from another one. The
   * monitor's open records are read only when some may be open
   * (MonitorOpenRecords), so a healthy check of a monitor with nothing open
   * reads nothing.
   */
  public static async resolveWhatNoCriteriaHolds(input: {
    monitor: Monitor;
    monitorStep: MonitorStep;
    dataToProcess: DataToProcess;
    evaluationSummary: MonitorEvaluationSummary;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    keepEvaluationLock: () => Promise<void>;
  }): Promise<void> {
    const rootCause: string = "No monitoring criteria met.";

    const openRecords: MonitorOpenRecordsReading =
      await MonitorResourceUtil.readWhatIsKnownOfOpenRecords({
        monitor: input.monitor,
        opensIncidents: false,
        opensAlerts: false,
      });

    await input.keepEvaluationLock();

    const disableSeriesAbsenceResolution: boolean =
      MonitorResourceUtil.isSeriesResolvedExplicitly({
        monitor: input.monitor,
        dataToProcess: input.dataToProcess,
      });

    await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
      monitor: input.monitor,
      kind: MonitorRecordKind.Incident,
      reading: openRecords,
      opensRecords: false,
      read: (): Promise<Array<Incident>> => {
        return MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
          rootCause: rootCause,
          criteriaInstance: null,
          dataToProcess: input.dataToProcess,
          evaluationSummary: input.evaluationSummary,
          keepResponseContent: MonitorRecordEvidence.keepsResponseContent(
            input.monitor,
          ),
          monitorStep: input.monitorStep,
          keepEvaluationLock: input.keepEvaluationLock,
          disableSeriesAbsenceResolution: disableSeriesAbsenceResolution,
        });
      },
    });

    await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
      monitor: input.monitor,
      kind: MonitorRecordKind.Alert,
      reading: openRecords,
      opensRecords: false,
      read: (): Promise<Array<Alert>> => {
        return MonitorAlert.checkOpenAlertsAndCloseIfResolved({
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
          rootCause: rootCause,
          criteriaInstance: null,
          dataToProcess: input.dataToProcess,
          evaluationSummary: input.evaluationSummary,
          keepResponseContent: MonitorRecordEvidence.keepsResponseContent(
            input.monitor,
          ),
          monitorStep: input.monitorStep,
          keepEvaluationLock: input.keepEvaluationLock,
          disableSeriesAbsenceResolution: disableSeriesAbsenceResolution,
        });
      },
    });
  }

  public static async keepStatusUntilRecovered(input: {
    monitor: Monitor;
    monitorStep: MonitorStep;
    dataToProcess: DataToProcess;
    response: ProbeApiIngestResponse;
    evaluationSummary: MonitorEvaluationSummary;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    criteriaInstancesById: Dictionary<MonitorCriteriaInstance>;
    keepEvaluationLock: () => Promise<void>;
  }): Promise<void> {
    logger.debug(
      `${input.dataToProcess.monitorId.toString()} - No criteria met, and the monitor's status waits for a recovery criteria. Keeping the status.`,
    );

    const rootCause: string =
      "No monitoring criteria met. The monitor keeps its status until a criteria that brings it back is met.";

    const openRecords: MonitorOpenRecordsReading =
      await MonitorResourceUtil.readWhatIsKnownOfOpenRecords({
        monitor: input.monitor,
        opensIncidents: false,
        opensAlerts: false,
      });

    await input.keepEvaluationLock();

    const disableSeriesAbsenceResolution: boolean =
      MonitorResourceUtil.isSeriesResolvedExplicitly({
        monitor: input.monitor,
        dataToProcess: input.dataToProcess,
      });

    await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
      monitor: input.monitor,
      kind: MonitorRecordKind.Incident,
      reading: openRecords,
      opensRecords: false,
      read: (): Promise<Array<Incident>> => {
        return MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
          rootCause: rootCause,
          criteriaInstance: null,
          dataToProcess: input.dataToProcess,
          evaluationSummary: input.evaluationSummary,
          keepResponseContent: MonitorRecordEvidence.keepsResponseContent(
            input.monitor,
          ),
          monitorStep: input.monitorStep,
          keepEvaluationLock: input.keepEvaluationLock,
          disableSeriesAbsenceResolution: disableSeriesAbsenceResolution,
        });
      },
    });

    await MonitorResourceUtil.readOpenRecordsUnlessNoneOpen({
      monitor: input.monitor,
      kind: MonitorRecordKind.Alert,
      reading: openRecords,
      opensRecords: false,
      read: (): Promise<Array<Alert>> => {
        return MonitorAlert.checkOpenAlertsAndCloseIfResolved({
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
          rootCause: rootCause,
          criteriaInstance: null,
          dataToProcess: input.dataToProcess,
          evaluationSummary: input.evaluationSummary,
          keepResponseContent: MonitorRecordEvidence.keepsResponseContent(
            input.monitor,
          ),
          monitorStep: input.monitorStep,
          keepEvaluationLock: input.keepEvaluationLock,
          disableSeriesAbsenceResolution: disableSeriesAbsenceResolution,
        });
      },
    });

    // "Online" or "Online or Back up", by name, in the reader's words.
    const names: Array<string> = (
      input.response.statusKeptForRecoveryCriteriaIds || []
    )
      .map((criteriaId: string): string => {
        return input.criteriaInstancesById[criteriaId]?.data?.name || "";
      })
      .filter((name: string): boolean => {
        return Boolean(name);
      });

    input.evaluationSummary.events.push({
      type: "monitor-status-kept",
      ...EvaluationEventText.from({
        title: translatableSentence("Monitor status kept"),
        message:
          names.length > 0
            ? translatableSentence(
                'The monitor keeps its status: no criteria matched, and it comes back only when "{{criteria}}" is met.',
                { criteria: names.join('", "') },
              )
            : translatableSentence(
                "The monitor keeps its status: no criteria matched, and it comes back only when a criteria that brings it back is met.",
              ),
      }),
      at: OneUptimeDate.getCurrentDate(),
    });
  }

  /*
   * WHAT SETS A MONITOR'S STATUS ON A CHECK (#11238).
   *
   * The criteria that change the status decide it: the first of them that
   * matched, in the order given (ProbeApiIngestResponse.statusCriteriaId) -
   * the check's first match itself whenever that one changes the status, as
   * on every monitor whose criteria all do.
   *
   * A criteria that changes no status - an alert-only criteria - decides
   * none. When only such criteria matched, the status goes where a check
   * that matched nothing takes it: to the monitor's default status, unless a
   * recovery criteria is waited for (GroupedMonitorRecovery), the check is
   * an SNMP trap (the polled checks own the status), or it read nothing at
   * all (isSilentInfrastructureWindow). It used to stay where an earlier
   * check had left it for as long as such a criteria kept matching: a switch
   * the recommended network device alert pack watches went Offline for one
   * missed poll, answered the next with a port above 80%, and stayed Offline
   * - its status page red - while the port stayed busy.
   *
   * The status alone: what the check opens and resolves is its passes' own,
   * and each incident and alert still opens and resolves with the criteria
   * that raised it.
   */
  public static async setStatusOfCheck(input: {
    monitor: Monitor;
    monitorStep: MonitorStep;
    dataToProcess: DataToProcess;
    response: ProbeApiIngestResponse;
    evaluationSummary: MonitorEvaluationSummary;
    criteriaInstancesById: Dictionary<MonitorCriteriaInstance>;
    isSnmpTrapEvent: boolean;
    telemetryQuery: TelemetryQuery | undefined;
    // The series the check acted on, which the status change's log keeps first.
    seriesActedOn: ReadonlySet<string>;
    // Planned work on one host of an OpenStack cloud keeps the status.
    isEveryBreachUnderMaintenance: boolean;
    getMonitorStatusName: (
      statusId: ObjectID | undefined | null,
    ) => Promise<string | null>;
    keepEvaluationLock: () => Promise<void>;
  }): Promise<StatusOfCheck> {
    const statusCriteriaInstance: MonitorCriteriaInstance | undefined = input
      .response.statusCriteriaId
      ? input.criteriaInstancesById[input.response.statusCriteriaId]
      : undefined;

    if (statusCriteriaInstance) {
      if (input.isEveryBreachUnderMaintenance) {
        return StatusOfCheck.Unchanged;
      }

      const monitorStatusTimelineChange: MonitorStatusTimeline | null =
        await MonitorStatusTimelineUtil.updateMonitorStatusTimeline({
          monitor: input.monitor,
          rootCause:
            input.response.statusRootCause || input.response.rootCause || "",
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          criteriaInstance: statusCriteriaInstance,
          props: {
            telemetryQuery: input.telemetryQuery,
          },
          seriesActedOn: input.seriesActedOn,
        });

      if (monitorStatusTimelineChange) {
        const changedStatusName: string | null =
          await input.getMonitorStatusName(
            statusCriteriaInstance.data?.monitorStatusId ||
              monitorStatusTimelineChange.monitorStatusId,
          );

        /*
         * The status is the project's own name for it, as written; the
         * criteria, its name, or "Unnamed criteria" in the reader's words.
         */
        const metCriteria: EvaluationSentenceValue =
          EvaluationEventText.criteriaName(statusCriteriaInstance.data?.name);

        input.evaluationSummary.events.push({
          type: "monitor-status-changed",
          ...EvaluationEventText.from({
            title: translatableSentence("Monitor status updated"),
            message: changedStatusName
              ? translatableSentence(
                  'Monitor status changed to "{{status}}" because criteria "{{criteria}}" was met.',
                  { status: changedStatusName, criteria: metCriteria },
                )
              : translatableSentence(
                  'Monitor status changed because criteria "{{criteria}}" was met.',
                  { criteria: metCriteria },
                ),
          }),
          relatedCriteriaId: statusCriteriaInstance.data?.id,
          at: OneUptimeDate.getCurrentDate(),
        });
      }

      return StatusOfCheck.SetByCriteria;
    }

    /*
     * No criteria that changes the status matched: whatever matched only
     * alerts, the status goes where a check that matched nothing takes it.
     */
    const defaultMonitorStatusId: ObjectID | undefined =
      input.monitor.monitorSteps?.data?.defaultMonitorStatusId;

    // A trap is no check of the monitor's: the polled checks own the status.
    if (input.isSnmpTrapEvent || !defaultMonitorStatusId) {
      return StatusOfCheck.Unchanged;
    }

    if (
      input.monitor.currentMonitorStatusId?.toString() ===
      defaultMonitorStatusId.toString()
    ) {
      return StatusOfCheck.Unchanged;
    }

    /*
     * A grouped monitor's series behind its status that met no recovery
     * criteria yet keep it (GroupedMonitorRecovery), as on a check that
     * matched nothing.
     */
    const seriesKeepingStatus: Array<SeriesKeepingStatus> =
      input.response.seriesKeepingStatus || [];

    if (seriesKeepingStatus.length > 0) {
      input.evaluationSummary.events.push(
        MonitorResourceUtil.describeSeriesKeepingStatus(seriesKeepingStatus),
      );

      return StatusOfCheck.Kept;
    }

    // Silence is not recovery (isSilentInfrastructureWindow).
    if (
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: input.monitor,
        dataToProcess: input.dataToProcess,
      })
    ) {
      return StatusOfCheck.Unchanged;
    }

    /*
     * A problem criteria set the status, and a recovery criteria brings it
     * back (#10743): the margin between them holds.
     */
    const recoveryCriteriaIds: Array<string> =
      input.response.statusKeptForRecoveryCriteriaIds || [];

    if (recoveryCriteriaIds.length > 0) {
      const names: Array<string> = recoveryCriteriaIds
        .map((criteriaId: string): string => {
          return input.criteriaInstancesById[criteriaId]?.data?.name || "";
        })
        .filter((name: string): boolean => {
          return Boolean(name);
        });

      input.evaluationSummary.events.push({
        type: "monitor-status-kept",
        ...EvaluationEventText.from({
          title: translatableSentence("Monitor status kept"),
          message:
            names.length > 0
              ? translatableSentence(
                  'The monitor keeps its status: no criteria that changes the status matched, and it comes back only when "{{criteria}}" is met.',
                  { criteria: names.join('", "') },
                )
              : translatableSentence(
                  "The monitor keeps its status: no criteria that changes the status matched, and it comes back only when a criteria that brings it back is met.",
                ),
        }),
        at: OneUptimeDate.getCurrentDate(),
      });

      return StatusOfCheck.Kept;
    }

    logger.debug(
      `${input.dataToProcess.monitorId.toString()} - No criteria that changes the status met. Change to default status.`,
    );

    const isBackToDefault: boolean =
      await MonitorResourceUtil.moveToDefaultStatus({
        monitor: input.monitor,
        defaultMonitorStatusId: defaultMonitorStatusId,
        monitorStep: input.monitorStep,
        dataToProcess: input.dataToProcess,
        evaluationSummary: input.evaluationSummary,
        because: DefaultStatusBecause.NoStatusCriteriaMet,
        getMonitorStatusName: input.getMonitorStatusName,
        keepEvaluationLock: input.keepEvaluationLock,
      });

    return isBackToDefault
      ? StatusOfCheck.BackToDefault
      : StatusOfCheck.Unchanged;
  }

  /*
   * The monitor back on its default status, with a row of its own on the
   * status timeline: unless the last row is that status already, the status
   * no longer exists in the project (a monitor saved before #3039), or the
   * timeline's lock could not be had - the next check writes it then. Its
   * owners are not told: a default status is no news. True when the monitor
   * is on its default status after it.
   */
  public static async moveToDefaultStatus(input: {
    monitor: Monitor;
    defaultMonitorStatusId: ObjectID;
    monitorStep: MonitorStep;
    dataToProcess: DataToProcess;
    evaluationSummary: MonitorEvaluationSummary;
    because: DefaultStatusBecause;
    getMonitorStatusName: (
      statusId: ObjectID | undefined | null,
    ) => Promise<string | null>;
    keepEvaluationLock: () => Promise<void>;
  }): Promise<boolean> {
    const monitor: Monitor = input.monitor;
    const dataToProcess: DataToProcess = input.dataToProcess;

    // get last monitor status timeline.
    const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: {
          monitorId: monitor.id!,
          projectId: monitor.projectId!,
        },
        select: {
          _id: true,
          monitorStatusId: true,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      lastMonitorStatusTimeline &&
      lastMonitorStatusTimeline.monitorStatusId &&
      lastMonitorStatusTimeline.monitorStatusId.toString() ===
        input.defaultMonitorStatusId.toString()
    ) {
      /*
       * status is same as last status. do not create new status timeline.
       * do nothing! status is same as last status.
       */
      return true;
    }

    const monitorStatusTimeline: MonitorStatusTimeline =
      new MonitorStatusTimeline();
    monitorStatusTimeline.monitorId = monitor.id!;
    monitorStatusTimeline.monitorStatusId = input.defaultMonitorStatusId;
    monitorStatusTimeline.projectId = monitor.projectId!;
    monitorStatusTimeline.isOwnerNotified = true; // no need to notify owner as this is default status.
    /*
     * Cut as the monitor's logs are: everyone who reads the monitor
     * reads it. And bounded (MonitorStoredCheck).
     */
    monitorStatusTimeline.statusChangeLog = MonitorStoredCheck.toStoredCheck({
      dataToProcess: dataToProcess,
      keepResponseContent: MonitorRecordEvidence.keepsResponseContent(monitor),
      monitorStep: input.monitorStep,
    });
    monitorStatusTimeline.rootCause = DEFAULT_STATUS_ROOT_CAUSES[input.because];

    /*
     * The stored default status can be a status that no longer exists, or
     * one from another project: monitorSteps is a JSON blob with no
     * foreign key behind it, and before issue #3039 was fixed the API
     * accepted any uuid for it. Writing it raised the
     * "violates foreign key constraint" error from the probe/telemetry
     * worker and failed the whole ingest run for this monitor, losing the
     * monitor log and payload persisted below. Skip the revert and log,
     * the same way the criteria path in Utils/Monitor/MonitorStatusTimeline
     * does. New writes are rejected up front by
     * MonitorStepsProjectValidator.
     */
    const isDefaultStatusUsable: boolean =
      await ProjectScopedReferenceValidator.isUsableInProject({
        projectId: monitor.projectId!,
        id: input.defaultMonitorStatusId,
        service: MonitorStatusService,
      });

    if (!isDefaultStatusUsable) {
      logger.error(
        `${dataToProcess.monitorId.toString()} - The default monitor status ${input.defaultMonitorStatusId.toString()} does not exist in project ${monitor.projectId?.toString()}. Skipping revert to default status. Please pick a default monitor status that exists in this project.`,
      );

      /*
       * The monitor is not at its default status: recording a "reverted"
       * event would put a false entry in the monitor log.
       */
      return false;
    }

    await input.keepEvaluationLock();

    try {
      await MonitorStatusTimelineService.create({
        data: monitorStatusTimeline,
        props: {
          isRoot: true,
        },
      });
      logger.debug(
        `${dataToProcess.monitorId.toString()} - Monitor status updated to default.`,
      );
    } catch (err) {
      /*
       * Idempotent concurrency race (see MonitorStatusTimeline.ts): a
       * concurrent result already moved the monitor to this default status,
       * so onBeforeCreate's dedupe check throws this exact BadDataException.
       * Treat as a no-op at debug level rather than failing the job. Match the
       * exact message so unrelated BadDataExceptions still propagate.
       */
      if (
        err instanceof BadDataException &&
        err.message === MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE
      ) {
        logger.debug(
          `${dataToProcess.monitorId.toString()} - Monitor status already at default; skipping duplicate status timeline (concurrent race).`,
        );
      } else if (
        err instanceof ServerException &&
        err.message === MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE
      ) {
        /*
         * The per-monitor timeline mutex could not be acquired (fail-closed
         * create, see MonitorStatusTimelineService). Skipping is recoverable:
         * the next probe result re-evaluates the same criteria and recreates
         * the revert-to-default, while failing here would abort the whole
         * ingest run and lose the monitor log for this probe result.
         *
         * The write was REFUSED: recording a "reverted" event would put a
         * false entry in the monitor log and mask the very lock failure the
         * error log surfaces.
         */
        logger.error(
          `${dataToProcess.monitorId.toString()} - Could not acquire the monitor status timeline lock; skipping revert to default status. It will be retried on the next probe result.`,
        );

        return false;
      } else {
        throw err;
      }
    }

    const defaultStatusName: string | null = await input.getMonitorStatusName(
      input.defaultMonitorStatusId,
    );

    input.evaluationSummary.events.push({
      type: "monitor-status-changed",
      ...EvaluationEventText.from({
        title: translatableSentence("Monitor status reverted"),
        message:
          input.because === DefaultStatusBecause.NoStatusCriteriaMet
            ? defaultStatusName
              ? translatableSentence(
                  'Monitor status reverted to "{{status}}" because no criteria that changes the status was met.',
                  { status: defaultStatusName },
                )
              : translatableSentence(
                  "Monitor status reverted to its default state because no criteria that changes the status was met.",
                )
            : defaultStatusName
              ? translatableSentence(
                  'Monitor status reverted to "{{status}}" because no monitoring criteria were met.',
                  { status: defaultStatusName },
                )
              : translatableSentence(
                  "Monitor status reverted to its default state because no monitoring criteria were met.",
                ),
      }),
      at: OneUptimeDate.getCurrentDate(),
    });

    return true;
  }

  /*
   * The status the probes agree on, as the check's own (#11238): the
   * criteria that sets it, with its root cause and the probes that agree,
   * or none - and the status then goes where a check that matched nothing
   * takes it.
   */
  private static useAgreedStatus(input: {
    response: ProbeApiIngestResponse;
    statusAgreement: ProbeStatusAgreement;
  }): void {
    input.response.statusCriteriaId =
      input.statusAgreement.agreedCriteriaId || undefined;

    if (!input.response.statusCriteriaId) {
      input.response.statusRootCause = undefined;
      return;
    }

    let rootCause: string | null = input.statusAgreement.agreedRootCause;

    // Each probe's name is text, placed into the root cause's Markdown.
    if (rootCause && input.statusAgreement.agreedProbeNames.length > 0) {
      rootCause += mdText`
**Probes in Agreement**: ${FeedMarkdown.join(input.statusAgreement.agreedProbeNames)}
`.toString();
    }

    input.response.statusRootCause = rootCause;
  }

  /*
   * The series a grouped evaluation matched, under any criteria: what its
   * monitor log keeps first when it cannot keep every series
   * (MonitorStoredCheck.boundSeries). Empty for any other evaluation.
   */
  public static getSeriesActedOn(
    response: ProbeApiIngestResponse,
  ): Set<string> {
    const fingerprints: Set<string> = new Set<string>();

    // The series that keep the monitor's status, which its log names.
    for (const series of response.seriesKeepingStatus || []) {
      if (series.fingerprint) {
        fingerprints.add(series.fingerprint);
      }
    }

    for (const matched of response.matchedCriteria || []) {
      for (const series of matched.perSeriesMatches || []) {
        if (series.fingerprint) {
          fingerprints.add(series.fingerprint);
        }
      }
    }

    for (const series of response.perSeriesMatches || []) {
      if (series.fingerprint) {
        fingerprints.add(series.fingerprint);
      }
    }

    return fingerprints;
  }

  /*
   * An incoming request that arrived (not the heartbeat sweep's look at the
   * last one): its arrival is kept by its monitor, the latest of all, on
   * every request. The monitor page reads it over the row's, which is
   * written at most every so often (MonitorAPI.onBeforeSendRecords, issue
   * #8123). Never throws.
   */
  /*
   * A request, an email or an agent's report that reached a monitor that is
   * not being checked, listed in its Logs as not evaluated and why, with its
   * arrival kept (MonitorNotEvaluated, #11141), before it is refused: it
   * used to be dropped without a trace. Not for a blocked project, which
   * records nothing of what reaches it. Never throws.
   */
  public static async listNotEvaluated(data: {
    monitor: Monitor;
    dataToProcess: DataToProcess;
    reason: MonitorPauseReason;
  }): Promise<void> {
    if (
      !data.monitor.projectId ||
      !MonitorNotEvaluated.isSentFromOutside(data.monitor.monitorType)
    ) {
      return;
    }

    try {
      if (await ProjectService.isProjectBlocked(data.monitor.projectId)) {
        return;
      }
    } catch (error) {
      logger.error(error);
      return;
    }

    await MonitorNotEvaluated.record(data);
  }

  public static async keepIncomingRequestArrival(input: {
    monitorId: ObjectID;
    dataToProcess: IncomingMonitorRequest;
  }): Promise<void> {
    if (
      input.dataToProcess.onlyCheckForIncomingRequestReceivedAt ||
      !input.dataToProcess.incomingRequestReceivedAt
    ) {
      return;
    }

    await MonitorHeartbeatState.recordIncomingRequest({
      monitorId: input.monitorId,
      receivedAt: input.dataToProcess.incomingRequestReceivedAt,
    });
  }

  /*
   * A server agent's report: its arrival is kept on every report, before
   * the report is judged (the row is written at most every few minutes). A
   * check of the monitor - the CheckOnlineStatus sweep, which passes the
   * arrival it read from the row - judges the latest arrival kept, so a
   * report that was not written is never taken for silence.
   */
  public static async keepServerReport(input: {
    monitorId: ObjectID;
    dataToProcess: ServerMonitorResponse;
  }): Promise<void> {
    if (!input.dataToProcess.onlyCheckRequestReceivedAt) {
      await MonitorHeartbeatState.recordServerReport({
        monitorId: input.monitorId,
        receivedAt: input.dataToProcess.requestReceivedAt,
      });
      return;
    }

    const kept: Date | null =
      await MonitorHeartbeatState.getServerReportReceivedAt(input.monitorId);

    if (!kept) {
      return;
    }

    const written: Date | null = input.dataToProcess.requestReceivedAt
      ? OneUptimeDate.fromString(input.dataToProcess.requestReceivedAt)
      : null;

    if (!written || kept.getTime() > written.getTime()) {
      input.dataToProcess.requestReceivedAt = kept;
    }
  }

  // An incoming request or email evaluated, recorded for the heartbeat sweeps.
  public static async markHeartbeatEvaluated(input: {
    monitor: Monitor;
    dataToProcess: DataToProcess;
    monitorStatusIdFound: ObjectID | undefined;
  }): Promise<void> {
    const kind: HeartbeatKind | null =
      input.monitor.monitorType === MonitorType.IncomingRequest
        ? HeartbeatKind.IncomingRequest
        : input.monitor.monitorType === MonitorType.IncomingEmail
          ? HeartbeatKind.IncomingEmail
          : null;

    if (!kind || !input.monitor.id) {
      return;
    }

    await MonitorHeartbeatState.markEvaluated({
      kind: kind,
      monitorId: input.monitor.id,
      receivedAt:
        kind === HeartbeatKind.IncomingRequest
          ? (input.dataToProcess as IncomingMonitorRequest)
              .incomingRequestReceivedAt
          : (input.dataToProcess as IncomingEmailMonitorRequest)
              .emailReceivedAt,
      monitorSteps: input.monitor.monitorSteps,
      monitorStatusId: input.monitorStatusIdFound,
    });
  }

  /*
   * What is known of the monitor's open incidents and alerts its criteria
   * raised (MonitorOpenRecords), read under the monitor's lock before the
   * result reads or leaves out its records. A result whose criteria opens
   * both kinds reads both whatever is known, so it asks nothing of Redis.
   */
  public static async readWhatIsKnownOfOpenRecords(input: {
    monitor: Monitor;
    opensIncidents: boolean;
    opensAlerts: boolean;
  }): Promise<MonitorOpenRecordsReading> {
    if (
      (input.opensIncidents && input.opensAlerts) ||
      !input.monitor.id ||
      !input.monitor.projectId
    ) {
      return NOTHING_KNOWN;
    }

    return await MonitorOpenRecords.read({
      monitorId: input.monitor.id,
      projectId: input.monitor.projectId,
    });
  }

  /*
   * The monitor's open records of one kind, as the resolve pass left them -
   * or none, unread, when nothing the criteria met opens that kind and the
   * monitor is known to have none open that a criteria raised: the read
   * would only look for something to auto-resolve, and only a record a
   * criteria raised is ever auto-resolved (createdCriteriaId).
   *
   * A read of a kind nothing met opens that leaves no such record open is
   * recorded, stamped as of the reading taken before it, so the next result
   * can leave it out. A kind something met opens is read always - it opens
   * none beside one already open - and recorded never: the result that
   * opens one would make the record unusable at once.
   */
  public static async readOpenRecordsUnlessNoneOpen<
    TRecord extends Incident | Alert,
  >(input: {
    monitor: Monitor;
    kind: MonitorRecordKind;
    reading: MonitorOpenRecordsReading;
    opensRecords: boolean;
    read: () => Promise<Array<TRecord>>;
  }): Promise<Array<TRecord>> {
    if (!input.opensRecords && input.reading.noneOpen[input.kind]) {
      return [];
    }

    const records: Array<TRecord> = await input.read();

    if (
      !input.opensRecords &&
      input.monitor.id &&
      !records.some((record: TRecord): boolean => {
        return Boolean(record.createdCriteriaId);
      })
    ) {
      await MonitorOpenRecords.markNoneOpen({
        monitorId: input.monitor.id,
        kind: input.kind,
        reading: input.reading,
      });
    }

    return records;
  }

  /*
   * The step a result is judged against. A probe result carries the
   * monitorStepId it ran, and a monitor can have several steps whose
   * criteria differ - so the step must be looked up, not assumed to be the
   * first one. An id that matches no step is stale - the step was deleted
   * after the probe was scheduled - and the first step is judged instead
   * rather than dropping the result. Undefined for a monitor with no steps.
   */
  public static findStepToJudge(input: {
    monitorSteps: MonitorSteps | undefined;
    dataToProcess: DataToProcess;
  }): MonitorStep | undefined {
    const steps: Array<MonitorStep> =
      input.monitorSteps?.data?.monitorStepsInstanceArray || [];

    const reportedStepId: string | undefined = (
      input.dataToProcess as ProbeMonitorResponse
    ).monitorStepId?.toString();

    if (reportedStepId) {
      const reportedStep: MonitorStep | undefined = steps.find(
        (step: MonitorStep) => {
          return step.id.toString() === reportedStepId;
        },
      );

      if (reportedStep) {
        return reportedStep;
      }
    }

    return steps[0];
  }

  /*
   * A probe of the monitor as checkProbeAgreement reads it: its last result
   * of the step judged, and - for the probe that reported the result being
   * handled - that result as its last of the step it reported.
   */
  public static toMonitorProbeForAgreement(input: {
    probe: MonitorProbeOfResult;
    judgedStepId: string | undefined;
    reportedResult?:
      | { stepId: string; result: ProbeMonitorResponse }
      | undefined;
  }): MonitorProbe {
    const probe: Probe = new Probe();

    if (input.probe.probeName !== undefined) {
      probe.name = input.probe.probeName;
    }

    if (input.probe.probeConnectionStatus !== undefined) {
      probe.connectionStatus = input.probe.probeConnectionStatus;
    }

    const lastMonitoringLog: MonitorStepProbeResponse = {};

    if (input.judgedStepId && input.probe.resultForJudgedStep) {
      lastMonitoringLog[input.judgedStepId] = input.probe.resultForJudgedStep;
    }

    if (input.reportedResult) {
      lastMonitoringLog[input.reportedResult.stepId] =
        input.reportedResult.result;
    }

    const monitorProbe: MonitorProbe = new MonitorProbe();
    monitorProbe.id = input.probe.monitorProbeId;
    monitorProbe.probeId = input.probe.probeId;
    monitorProbe.isEnabled = input.probe.isEnabled;
    monitorProbe.probe = probe;
    monitorProbe.lastMonitoringLog = lastMonitoringLog;

    return monitorProbe;
  }

  /**
   * Turn a probe response read back out of MonitorProbe.lastMonitoringLog
   * into one the criteria evaluators can actually use.
   *
   * The column stores `JSON.parse(JSON.stringify(response))`, which turns
   * every ObjectID into a plain `{ _type: "ObjectID", value: "..." }` object
   * and every Date into a string. Those plain objects are not `instanceof
   * ObjectID`, so the analytics query builder binds them as-is and the
   * "evaluate over time" lookup silently matches zero rows - which used to
   * be indistinguishable from "this monitor has no history" and sent the
   * evaluator down its instantaneous-value fallback. The result was a
   * decision that disagreed with the evaluation summary shown beside it.
   */
  public static hydrateStoredProbeResponse(
    probeResponse: ProbeMonitorResponse,
  ): ProbeMonitorResponse {
    const hydrated: ProbeMonitorResponse = {
      ...probeResponse,
    };

    const toObjectID: (value: unknown) => ObjectID | undefined = (
      value: unknown,
    ): ObjectID | undefined => {
      if (!value) {
        return undefined;
      }

      if (value instanceof ObjectID) {
        return value;
      }

      if (typeof value === "string") {
        return new ObjectID(value);
      }

      if (typeof value === "object") {
        const asJson: JSONObject = value as JSONObject;

        if (asJson["value"]) {
          return new ObjectID(asJson["value"].toString());
        }
      }

      return undefined;
    };

    const toDate: (value: unknown) => Date | undefined = (
      value: unknown,
    ): Date | undefined => {
      if (!value) {
        return undefined;
      }

      if (value instanceof Date) {
        return value;
      }

      const parsed: Date = new Date(value as string);

      return isNaN(parsed.getTime()) ? undefined : parsed;
    };

    const projectId: ObjectID | undefined = toObjectID(probeResponse.projectId);
    if (projectId) {
      hydrated.projectId = projectId;
    }

    const monitorId: ObjectID | undefined = toObjectID(probeResponse.monitorId);
    if (monitorId) {
      hydrated.monitorId = monitorId;
    }

    const monitorStepId: ObjectID | undefined = toObjectID(
      probeResponse.monitorStepId,
    );
    if (monitorStepId) {
      hydrated.monitorStepId = monitorStepId;
    }

    const probeId: ObjectID | undefined = toObjectID(probeResponse.probeId);
    if (probeId) {
      hydrated.probeId = probeId;
    }

    const monitoredAt: Date | undefined = toDate(probeResponse.monitoredAt);
    if (monitoredAt) {
      hydrated.monitoredAt = monitoredAt;
    }

    const ingestedAt: Date | undefined = toDate(probeResponse.ingestedAt);
    if (ingestedAt) {
      hydrated.ingestedAt = ingestedAt;
    }

    return hydrated;
  }

  @CaptureSpan()
  /**
   * Take the series this criteria may act on, given what earlier
   * (higher-priority) criteria have already claimed.
   *
   * A host breaching both "critical" and "warning" should page once,
   * from the more severe band: a series an earlier band of this criteria
   * claimed (CriteriaBands) is left to it, and the evaluation log says so.
   * A criteria that checks something else is no band of it and claims the
   * series for itself, so a port above 80% and a port logging errors are
   * two alerts (#11349). Criteria that create nothing claim nothing, so a
   * passive recovery criteria never steals a series from the criteria that
   * would have alerted on it.
   */
  public static claimUnclaimedSeries(input: {
    matches: Array<PerSeriesCriteriaMatch>;
    claimed: SeriesClaims;
    criteriaInstance: MonitorCriteriaInstance;
    kind: MonitorRecordKind;
    isClaiming: boolean;
    evaluationSummary: MonitorEvaluationSummary;
  }): Array<PerSeriesCriteriaMatch> {
    if (!input.isClaiming) {
      return input.matches;
    }

    const bandKey: string = CriteriaBands.getBandKey(
      input.criteriaInstance.data,
    );

    let claimedInBand: Map<string, string> | undefined =
      input.claimed.get(bandKey);

    if (!claimedInBand) {
      claimedInBand = new Map<string, string>();
      input.claimed.set(bandKey, claimedInBand);
    }

    const unclaimed: Array<PerSeriesCriteriaMatch> = [];

    for (const match of input.matches) {
      const claimedBy: string | undefined = claimedInBand.get(
        match.fingerprint,
      );

      if (claimedBy === undefined) {
        unclaimed.push(match);
        continue;
      }

      input.evaluationSummary.events.push(
        MonitorResourceUtil.getLeftToEarlierBandEvent({
          match: match,
          kind: input.kind,
          claimedBy: claimedBy,
          criteriaId: input.criteriaInstance.data?.id,
        }),
      );
    }

    for (const match of unclaimed) {
      claimedInBand.set(
        match.fingerprint,
        input.criteriaInstance.data?.name || "",
      );
    }

    return unclaimed;
  }

  /*
   * What the evaluation log says of a series a criteria leaves to an earlier
   * band of it (claimUnclaimedSeries): no record of its own, and which
   * criteria speaks for the series.
   */
  public static getLeftToEarlierBandEvent(input: {
    match: PerSeriesCriteriaMatch;
    kind: MonitorRecordKind;
    // The name of the earlier band that claimed the series.
    claimedBy: string;
    criteriaId: string | undefined;
  }): MonitorEvaluationEvent {
    const criteria: EvaluationSentenceValue = EvaluationEventText.criteriaName(
      input.claimedBy,
    );

    const series: string =
      input.match.fingerprint ===
      MetricSeriesFingerprint.WholeMonitorFingerprint
        ? ""
        : SeriesLabelDisplay.buildInlineSummary(input.match.labels);

    const isAlert: boolean = input.kind === MonitorRecordKind.Alert;

    const title: EvaluationSentence = isAlert
      ? translatableSentence('Alert left to "{{criteria}}"', {
          criteria: criteria,
        })
      : translatableSentence('Incident left to "{{criteria}}"', {
          criteria: criteria,
        });

    let message: EvaluationSentence;

    if (isAlert) {
      message = series
        ? translatableSentence(
            'Skipped creating an alert for this series ({{series}}) because "{{criteria}}", listed before this criteria, checks the same thing and matched it too. A series in two bands of one check gets one alert, from the first.',
            { series: series, criteria: criteria },
          )
        : translatableSentence(
            'Skipped creating an alert because "{{criteria}}", listed before this criteria, checks the same thing and matched too. Two bands of one check open one alert, from the first.',
            { criteria: criteria },
          );
    } else {
      message = series
        ? translatableSentence(
            'Skipped creating an incident for this series ({{series}}) because "{{criteria}}", listed before this criteria, checks the same thing and matched it too. A series in two bands of one check gets one incident, from the first.',
            { series: series, criteria: criteria },
          )
        : translatableSentence(
            'Skipped creating an incident because "{{criteria}}", listed before this criteria, checks the same thing and matched too. Two bands of one check open one incident, from the first.',
            { criteria: criteria },
          );
    }

    return {
      type: isAlert ? "alert-skipped" : "incident-skipped",
      ...EvaluationEventSeries.of(input.match.fingerprint),
      ...EvaluationEventText.from({ title: title, message: message }),
      relatedCriteriaId: input.criteriaId,
      at: OneUptimeDate.getCurrentDate(),
    };
  }

  private static async checkProbeAgreement(input: {
    monitor: Monitor;
    monitorStep: MonitorStep;
    currentCriteriaMetId: string | null;
    currentRootCause: string | null;
    /*
     * The criteria that sets the status on the current probe's check, and
     * its root cause (ProbeApiIngestResponse.statusCriteriaId): null when
     * none of the criteria that change the status matched. Left out, it is
     * the current criteria, as a check decided by its first match has it.
     */
    currentStatusCriteriaId?: string | null | undefined;
    currentStatusRootCause?: string | null | undefined;
    /*
     * Probe that produced the result being handled right now. Its verdict is
     * already in currentCriteriaMetId / currentRootCause, so it is reused
     * rather than recomputed - see the loop below.
     */
    currentProbeId?: ObjectID | undefined;
    /*
     * Pre-fetched MonitorProbe rows for this monitor (probeId, isEnabled,
     * probe.name/connectionStatus, and the step judged of lastMonitoringLog).
     * The probe-result hot path passes the ones it read with the statement
     * that stored its result; safe because the caller holds the per-monitor
     * lock, so the rows cannot change underneath us. When absent, they are
     * read - with no more of lastMonitoringLog than the step judged.
     */
    monitorProbes?: Array<MonitorProbe> | undefined;
    /*
     * The match history reads of the result being handled: every other
     * probe's check is judged by that probe's own history, read once for
     * all of them (CriteriaFilterMatchHistoryReads).
     */
    matchHistoryReads?: CriteriaFilterMatchHistoryReads | undefined;
    /*
     * The series behind a grouped monitor's status, read once for every
     * probe's check: each is judged by the same recovery rule as the result
     * being handled (GroupedMonitorRecovery). Only read here, never kept.
     */
    seriesBehindStatus?: SeriesBehindStatusReader | undefined;
    /*
     * What the monitor's criteria have opened, read once for every probe's
     * check: a criteria with a recovery condition of its own holds on each
     * probe's check as on the result being handled (#10355).
     */
    criteriaInEffect?: CriteriaInEffect | undefined;
  }): Promise<ProbeAgreementResult> {
    const { monitor, monitorStep, currentCriteriaMetId, currentRootCause } =
      input;

    // What sets the status on the current probe's check (#11238).
    const currentStatusCriteriaId: string | null =
      input.currentStatusCriteriaId === undefined
        ? currentCriteriaMetId
        : input.currentStatusCriteriaId;

    const currentStatusRootCause: string | null =
      input.currentStatusCriteriaId === undefined
        ? currentRootCause
        : input.currentStatusRootCause || null;

    // The step's criteria, by id: whether each probe's first match changes the status.
    const criteriaInstancesById: Dictionary<MonitorCriteriaInstance> = {};

    for (const criteriaInstance of monitorStep.data?.monitorCriteria?.data
      ?.monitorCriteriaInstanceArray || []) {
      if (criteriaInstance.data?.id) {
        criteriaInstancesById[criteriaInstance.data.id.toString()] =
          criteriaInstance;
      }
    }

    /*
     * Whether some probe's check was not decided by its first match: that
     * one changes no status. Only then is the status agreed on apart.
     */
    let isStatusApart: boolean =
      (currentStatusCriteriaId || null) !== (currentCriteriaMetId || null);

    /*
     * If minimumProbeAgreement is not set, all probes must agree
     * Get all MonitorProbes for this monitor with their probe connection status
     */
    const monitorProbes: Array<MonitorProbe> =
      input.monitorProbes ||
      (
        await MonitorProbeLastResults.readProbes({
          monitorId: monitor.id!,
          judgedStepId: monitorStep.id.toString(),
        })
      ).map((probe: MonitorProbeOfResult): MonitorProbe => {
        return MonitorResourceUtil.toMonitorProbeForAgreement({
          probe: probe,
          judgedStepId: monitorStep.id.toString(),
        });
      });

    // Filter to only active probes (enabled AND connected)
    const activeProbes: Array<MonitorProbe> = monitorProbes.filter(
      (mp: MonitorProbe) => {
        return (
          mp.isEnabled &&
          mp.probe?.connectionStatus === ProbeConnectionStatus.Connected
        );
      },
    );

    // If no active probes, treat as agreement met (nothing to compare)
    if (activeProbes.length === 0) {
      logger.debug(
        `${monitor.id?.toString()} - No active probes found. Treating as agreement met.`,
      );
      return {
        hasAgreement: true,
        agreementCount: 0,
        requiredCount: 0,
        totalActiveProbes: 0,
        agreedCriteriaId: currentCriteriaMetId,
        agreedRootCause: currentRootCause,
        agreedProbeNames: [],
        ...(isStatusApart
          ? {
              status: {
                hasAgreement: true,
                agreementCount: 0,
                agreedCriteriaId: currentStatusCriteriaId,
                agreedRootCause: currentStatusRootCause,
                agreedProbeNames: [],
              },
            }
          : {}),
      };
    }

    /*
     * How many must agree: the monitor's minimum, all of them when it is
     * not set, never more than take part. The pages that say what this
     * decides (the probes card, the website-down guided setup) read the
     * same rule (Common/Utils/Monitor/ProbeAgreementRule).
     */
    const effectiveThreshold: number = getProbeAgreementRequiredCount({
      minimumProbeAgreement: monitor.minimumProbeAgreement,
      activeProbeCount: activeProbes.length,
    });

    /*
     * Count how many probes agree on each criteria result
     * Key: criteriaId or "none" for no criteria met
     * Value: { count, rootCause, probeNames }
     */
    const criteriaAgreements: Map<string, ProbeVerdictCount> = new Map();

    /*
     * And on the criteria that sets the status (#11238), keyed the same way:
     * the same counts as above on every check whose first match changes the
     * status.
     */
    const statusAgreements: Map<string, ProbeVerdictCount> = new Map();

    const stepId: string = monitorStep.id.toString();

    for (const monitorProbe of activeProbes) {
      const probeResponse: ProbeMonitorResponse | undefined =
        monitorProbe.lastMonitoringLog?.[stepId];

      if (!probeResponse) {
        // No response yet for this step from this probe - skip
        logger.debug(
          `${monitor.id?.toString()} - Probe ${monitorProbe.probeId?.toString()} has no response for step ${stepId}. Skipping.`,
        );
        continue;
      }

      let evaluatedCriteriaMetId: string | undefined = undefined;
      let evaluatedRootCause: string | null = null;
      let evaluatedStatusCriteriaId: string | undefined = undefined;
      let evaluatedStatusRootCause: string | null = null;

      const isCurrentProbe: boolean = Boolean(
        input.currentProbeId &&
          monitorProbe.probeId?.toString() === input.currentProbeId.toString(),
      );

      if (isCurrentProbe) {
        /*
         * The probe whose result we are handling right now was already
         * evaluated by the caller, and that evaluation is the one the user
         * sees in the evaluation summary. Re-running it here would evaluate
         * a *different* window for any "evaluate over time" filter - seconds
         * have passed, and this pass reads the payload back out of
         * lastMonitoringLog rather than using the live object. That is how
         * an incident could be created citing a criteria the summary right
         * next to it reported as not met.
         */
        evaluatedCriteriaMetId = currentCriteriaMetId || undefined;
        evaluatedRootCause = currentRootCause;
        evaluatedStatusCriteriaId = currentStatusCriteriaId || undefined;
        evaluatedStatusRootCause = currentStatusRootCause;
      } else {
        // Evaluate this probe's response against criteria
        const tempResponse: ProbeApiIngestResponse = {
          monitorId: monitor.id!,
          criteriaMetId: undefined,
          rootCause: null,
        };

        const tempEvaluationSummary: MonitorEvaluationSummary = {
          evaluatedAt: OneUptimeDate.getCurrentDate(),
          criteriaResults: [],
          events: [],
        };

        const evaluatedResponse: ProbeApiIngestResponse =
          await MonitorCriteriaEvaluator.processMonitorStep({
            dataToProcess: MonitorResourceUtil.hydrateStoredProbeResponse(
              probeResponse,
            ) as DataToProcess,
            monitorStep: monitorStep,
            monitor: monitor,
            probeApiIngestResponse: tempResponse,
            evaluationSummary: tempEvaluationSummary,
            matchHistoryReads: input.matchHistoryReads,
            seriesBehindStatus: input.seriesBehindStatus,
            criteriaInEffect: input.criteriaInEffect,
          });

        evaluatedCriteriaMetId = evaluatedResponse.criteriaMetId;
        evaluatedRootCause = evaluatedResponse.rootCause;
        evaluatedStatusCriteriaId =
          MonitorResourceUtil.getStatusCriteriaIdOfCheck({
            response: evaluatedResponse,
            criteriaInstancesById: criteriaInstancesById,
          });
        evaluatedStatusRootCause =
          evaluatedResponse.statusRootCause ||
          (evaluatedStatusCriteriaId &&
          evaluatedStatusCriteriaId === evaluatedCriteriaMetId
            ? evaluatedRootCause
            : null);
      }

      if (
        (evaluatedStatusCriteriaId || null) !== (evaluatedCriteriaMetId || null)
      ) {
        isStatusApart = true;
      }

      // Get probe name for this monitor probe
      const probeName: string = monitorProbe.probe?.name || "Unknown Probe";

      // Record the result: what acts on the check, and what sets the status.
      MonitorResourceUtil.countProbeVerdict({
        counts: criteriaAgreements,
        criteriaId: evaluatedCriteriaMetId,
        rootCause: evaluatedRootCause,
        probeName: probeName,
      });

      MonitorResourceUtil.countProbeVerdict({
        counts: statusAgreements,
        criteriaId: evaluatedStatusCriteriaId,
        rootCause: evaluatedStatusRootCause,
        probeName: probeName,
      });
    }

    // Find the criteria with the most agreement
    const winning: ProbeStatusAgreement = MonitorResourceUtil.pickProbeVerdict({
      counts: criteriaAgreements,
      requiredCount: effectiveThreshold,
    });

    const winningStatus: ProbeStatusAgreement =
      MonitorResourceUtil.pickProbeVerdict({
        counts: statusAgreements,
        requiredCount: effectiveThreshold,
      });

    logger.debug(
      `${monitor.id?.toString()} - Probe agreement check: ${winning.agreementCount}/${effectiveThreshold} probes agree on criteria "${winning.agreedCriteriaId || "none"}". Agreement ${winning.hasAgreement ? "reached" : "not reached"}.${isStatusApart ? ` On the status: ${winningStatus.agreementCount}/${effectiveThreshold}, ${winningStatus.hasAgreement ? "reached" : "not reached"}.` : ""}`,
    );

    return {
      hasAgreement: winning.hasAgreement,
      agreementCount: winning.agreementCount,
      requiredCount: effectiveThreshold,
      totalActiveProbes: activeProbes.length,
      agreedCriteriaId: winning.agreedCriteriaId,
      agreedRootCause: winning.agreedRootCause,
      agreedProbeNames: winning.agreedProbeNames,
      ...(isStatusApart ? { status: winningStatus } : {}),
    };
  }

  /*
   * The criteria that sets the status on a check (#11238), from its
   * evaluation: what the evaluator says of it
   * (ProbeApiIngestResponse.statusCriteriaId), or its first match whenever
   * that one changes the status - the same, said of a check decided by its
   * first match. Undefined: none of the criteria that change the status
   * matched. A first match this monitor's criteria do not name sets the
   * status, as any first match always did.
   */
  public static getStatusCriteriaIdOfCheck(input: {
    response: Pick<
      ProbeApiIngestResponse,
      "criteriaMetId" | "statusCriteriaId"
    >;
    criteriaInstancesById: Dictionary<MonitorCriteriaInstance>;
  }): string | undefined {
    if (input.response.statusCriteriaId) {
      return input.response.statusCriteriaId;
    }

    const criteriaMetId: string | undefined = input.response.criteriaMetId;

    if (!criteriaMetId) {
      return undefined;
    }

    const criteriaInstance: MonitorCriteriaInstance | undefined =
      input.criteriaInstancesById[criteriaMetId];

    if (
      !criteriaInstance ||
      MonitorCriteriaInstance.changesMonitorStatus(criteriaInstance.data)
    ) {
      return criteriaMetId;
    }

    return undefined;
  }

  // One probe's verdict, counted with the others' (checkProbeAgreement).
  private static countProbeVerdict(input: {
    counts: Map<string, ProbeVerdictCount>;
    criteriaId: string | undefined;
    rootCause: string | null;
    probeName: string;
  }): void {
    const criteriaKey: string = input.criteriaId || "none";
    const existing: ProbeVerdictCount | undefined =
      input.counts.get(criteriaKey);

    if (existing) {
      existing.count += 1;
      existing.probeNames.push(input.probeName);
      return;
    }

    input.counts.set(criteriaKey, {
      count: 1,
      rootCause: input.rootCause,
      probeNames: [input.probeName],
    });
  }

  /*
   * The verdict most probes reached, the first counted on a tie, and
   * whether enough of them reached it. Nothing is agreed when they are too
   * few.
   */
  private static pickProbeVerdict(input: {
    counts: Map<string, ProbeVerdictCount>;
    requiredCount: number;
  }): ProbeStatusAgreement {
    let maxCount: number = 0;
    let winningCriteriaId: string | null = null;
    let winningRootCause: string | null = null;
    let winningProbeNames: Array<string> = [];

    for (const [criteriaId, data] of input.counts) {
      if (data.count > maxCount) {
        maxCount = data.count;
        winningCriteriaId = criteriaId === "none" ? null : criteriaId;
        winningRootCause = data.rootCause;
        winningProbeNames = data.probeNames;
      }
    }

    // Check if the winning criteria has reached the agreement threshold
    const hasAgreement: boolean = maxCount >= input.requiredCount;

    return {
      hasAgreement: hasAgreement,
      agreementCount: maxCount,
      agreedCriteriaId: hasAgreement ? winningCriteriaId : null,
      agreedRootCause: hasAgreement ? winningRootCause : null,
      agreedProbeNames: hasAgreement ? winningProbeNames : [],
    };
  }
}
