import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Dictionary from "Common/Types/Dictionary";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";
import {
  MonitorOverviewPresentationInput,
  MonitorOverviewStatusRef,
} from "Common/Utils/Monitor/MonitorOverviewPresentationUtil";
import MonitorOverviewProbeUtil, {
  MonitorEvaluationByProbe,
  MonitorOverviewProbeSummary,
} from "Common/Utils/Monitor/MonitorOverviewProbeUtil";
import MonitorStatusHistoryUtil from "Common/Utils/Monitor/MonitorStatusHistoryUtil";
import { OverviewSection } from "../../../Utils/OverviewSection";
import { MonitorOverviewProbeData } from "./MonitorOverviewTypes";

/*
 * Turns what the overview's data hook loaded into the input of
 * MonitorOverviewPresentationUtil.build.
 *
 * Pure: no React, routing, Navigation or API imports, so it is unit tested
 * directly. JSON columns (incomingMonitorRequest, serverMonitorResponse) can
 * carry dates as strings or typed envelopes, so every timestamp goes through
 * MonitorCheckScheduleUtil.parseDate, and every number is checked before it
 * is trusted: a malformed payload yields "unknown", never NaN.
 */

// Structural reads of the JSON columns; nothing in them is trusted blindly.
interface IncomingRequestLike {
  incomingRequestReceivedAt?: unknown;
  requestMethod?: unknown;
}

interface ServerResponseLike {
  hostname?: unknown;
  basicInfrastructureMetrics?:
    | {
        cpuMetrics?: { percentUsed?: unknown } | undefined;
        memoryMetrics?: { percentUsed?: unknown } | undefined;
      }
    | undefined;
}

type StepLogLike = Dictionary<{ monitoredAt?: unknown } | null | undefined>;

const toFiniteNumber: (value: unknown) => number | undefined = (
  value: unknown,
): number | undefined => {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

const toTrimmedString: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed: string = value.trim();

  return trimmed ? trimmed : undefined;
};

/*
 * The status the monitor row says it is in. The id column wins over the
 * relation's _id: it is the one the timeline rows are compared against.
 */
export function getCurrentStatusId(monitor: Monitor): string | undefined {
  return (
    monitor.currentMonitorStatusId?.toString() ||
    monitor.currentMonitorStatus?._id?.toString() ||
    undefined
  );
}

export function getCurrentStatusRef(
  monitor: Monitor,
): MonitorOverviewStatusRef | undefined {
  const status: MonitorStatus | undefined = monitor.currentMonitorStatus;

  if (!status) {
    return undefined;
  }

  return {
    id: getCurrentStatusId(monitor) || "",
    name: status.name || "Unknown status",
    color: MonitorStatusHistoryUtil.normalizeColor(status.color),
    isOperationalState: Boolean(status.isOperationalState),
    isOfflineState: Boolean(status.isOfflineState),
  };
}

/*
 * Whether the probes are meant to be checking now. Any of the three pause
 * flags stops them, so while one is set a probe's old result is simply the
 * last one, not a late one.
 */
export function isMonitorScheduled(monitor: Monitor): boolean {
  return !(
    Boolean(monitor.disableActiveMonitoring) ||
    Boolean(monitor.disableActiveMonitoringBecauseOfManualIncident) ||
    Boolean(monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent)
  );
}

/*
 * The probe summary the hero, the Probes card and the response-time card
 * share. Null when the probes are unknown (the read was forbidden or failed
 * with nothing kept), which the presentation never renders as "no probes".
 *
 * `now` is on the server's clock, like every time the rows carry. The
 * schedule itself is passed so a cron with gaps (office hours) does not
 * mark every probe late through the gap.
 */
export function summarizeProbeSection(data: {
  monitor: Monitor;
  probes: OverviewSection<MonitorOverviewProbeData>;
  now: Date;
}): MonitorOverviewProbeSummary | null {
  const probeData: MonitorOverviewProbeData | null = data.probes.value;

  if (!probeData) {
    return null;
  }

  return MonitorOverviewProbeUtil.summarizeProbes({
    monitorProbes: probeData.rows,
    validStepIds: MonitorOverviewProbeUtil.getValidStepIds(
      data.monitor.monitorSteps,
    ),
    primaryStepId: MonitorOverviewProbeUtil.getPrimaryStepId(
      data.monitor.monitorSteps,
    ),
    cadenceSeconds: MonitorCheckScheduleUtil.resolveCadenceSeconds({
      monitoringInterval: data.monitor.monitoringInterval,
      from: data.now,
    }),
    now: data.now,
    monitoringInterval: data.monitor.monitoringInterval,
    isScheduled: isMonitorScheduled(data.monitor),
  });
}

/*
 * When the probe results on screen were read, on the server's clock, if
 * the page is holding them after a probe read that failed; otherwise null.
 * fullLoadedAt is when the read that returned them was sent, on the
 * browser's clock, so the offset moves it onto the server's.
 */
export function getHeldProbeResultsReadAt(data: {
  probes: OverviewSection<MonitorOverviewProbeData>;
  serverClockOffsetMs: number;
}): Date | null {
  const fullLoadedAt: Date | null | undefined = data.probes.value?.fullLoadedAt;

  if (!data.probes.refreshError || !fullLoadedAt) {
    return null;
  }

  const offsetMs: number = Number.isFinite(data.serverClockOffsetMs)
    ? data.serverClockOffsetMs
    : 0;

  return new Date(fullLoadedAt.getTime() + offsetMs);
}

/*
 * The moment the page's health judgements are made at: `now` (the commit,
 * on the server's clock), unless the probe results on screen are held
 * after a failed read. Those are judged at the moment they were read. The
 * page cannot see what happened since, and ageing them on every commit
 * would blame the probes ("Checks overdue") for the page's own failure to
 * read them. The Probes card says the read failed.
 */
export function getJudgedAt(data: {
  now: Date;
  probes: OverviewSection<MonitorOverviewProbeData>;
  serverClockOffsetMs: number;
}): Date {
  const readAt: Date | null = getHeldProbeResultsReadAt({
    probes: data.probes,
    serverClockOffsetMs: data.serverClockOffsetMs,
  });

  return readAt && readAt.getTime() < data.now.getTime() ? readAt : data.now;
}

/*
 * What the Summary card shows as a telemetry or infrastructure monitor's
 * last check. Like the hero, the newest evaluation in the log when there is
 * one: the scheduler's stamp moves whenever an evaluation is queued, even
 * when none lands, so next to an overdue hero it would say the monitor was
 * checked a minute ago. Otherwise the stamp: the log is still loading or
 * could not be read, or is empty, which after its one-day retention does
 * not mean no evaluation ever ran.
 */
export function getTelemetryLastCheckedAt(data: {
  monitor: Monitor;
  evaluation: OverviewSection<MonitorEvaluationByProbe>;
}): Date | undefined {
  return (
    data.evaluation.value?.latestAt ||
    MonitorCheckScheduleUtil.parseDate(
      data.monitor.telemetryMonitorLastMonitorAt,
    )
  );
}

/*
 * The label for getTelemetryLastCheckedAt's time, so the Summary card names
 * what it shows: an evaluation that ran, or only a run that was queued.
 */
export function getTelemetryLastCheckedLabel(data: {
  evaluation: OverviewSection<MonitorEvaluationByProbe>;
}): string {
  return data.evaluation.value?.latestAt ? "Evaluated At" : "Scheduled At";
}

/*
 * The newest result time across the enabled probes and the monitor's
 * current steps. The data hook fingerprints it to decide whether the
 * evaluation log is worth reading again. Unlike the summary's lastResultAt
 * it is not clamped to "now", so a result stamped slightly in the future
 * (clock skew) does not change the fingerprint on every poll.
 */
export function getProbeLastResultAt(data: {
  monitorSteps: MonitorSteps | undefined;
  rows: Array<MonitorProbe>;
}): Date | undefined {
  const validStepIds: Set<string> | null =
    MonitorOverviewProbeUtil.getValidStepIds(data.monitorSteps);
  let newest: Date | undefined = undefined;

  for (const row of data.rows || []) {
    if (!row || row.isEnabled === false) {
      continue;
    }

    const log: unknown = row.lastMonitoringLog;

    if (!log || typeof log !== "object") {
      continue;
    }

    for (const [stepId, response] of Object.entries(log as StepLogLike)) {
      if (!response || (validStepIds !== null && !validStepIds.has(stepId))) {
        continue;
      }

      const monitoredAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
        response.monitoredAt,
      );

      if (
        monitoredAt &&
        (!newest || monitoredAt.getTime() > newest.getTime())
      ) {
        newest = monitoredAt;
      }
    }
  }

  return newest;
}

/*
 * `now` is when the data on screen was committed, on the server's clock,
 * and `serverClockOffsetMs` is server time minus browser time. The input's
 * own `now` is getJudgedAt's, so held probe results are judged as of their
 * read; how long the status has held still runs to `now`, because the
 * status rows were read with the commit.
 */
export function toPresentationInput(data: {
  monitor: Monitor;
  probes: OverviewSection<MonitorOverviewProbeData>;
  statusRows: OverviewSection<Array<MonitorStatusTimeline>>;
  evaluation: OverviewSection<MonitorEvaluationByProbe>;
  now: Date;
  serverClockOffsetMs?: number | undefined;
}): MonitorOverviewPresentationInput {
  const monitor: Monitor = data.monitor;
  const currentStatusId: string | undefined = getCurrentStatusId(monitor);
  const judgedAt: Date = getJudgedAt({
    now: data.now,
    probes: data.probes,
    serverClockOffsetMs: data.serverClockOffsetMs ?? 0,
  });
  const incomingRequest: IncomingRequestLike | undefined =
    monitor.incomingMonitorRequest as unknown as
      | IncomingRequestLike
      | undefined;
  const serverResponse: ServerResponseLike | undefined =
    monitor.serverMonitorResponse as unknown as ServerResponseLike | undefined;

  const judgedProbes: MonitorOverviewProbeSummary | null =
    summarizeProbeSection({
      monitor: monitor,
      probes: data.probes,
      now: judgedAt,
    });

  /*
   * Held results are judged as of their read, but "is the next check still
   * ahead" is a question about now: judged at the read time, a next ping
   * that has passed since would still read as upcoming. So the next check
   * comes from the commit; rows from a failed read then show no "next".
   */
  const probes: MonitorOverviewProbeSummary | null =
    judgedProbes && judgedAt.getTime() < data.now.getTime()
      ? {
          ...judgedProbes,
          nextCheckAt: summarizeProbeSection({
            monitor: monitor,
            probes: data.probes,
            now: data.now,
          })?.nextCheckAt,
        }
      : judgedProbes;

  return {
    now: judgedAt,
    /*
     * monitorType is a required column and Layout refuses to render the
     * overview without one, so the fallback is only a type-level guard.
     */
    monitorType: monitor.monitorType || MonitorType.Manual,
    monitorSteps: monitor.monitorSteps,
    monitoringInterval: monitor.monitoringInterval,
    createdAt: MonitorCheckScheduleUtil.parseDate(monitor.createdAt),
    currentStatus: getCurrentStatusRef(monitor),
    /*
     * Only a newest open row with the current status vouches for how long
     * the status has held. Without the rows (forbidden or failed), the
     * headline simply drops the duration.
     */
    statusSince: MonitorStatusHistoryUtil.getStatusSince({
      currentStatusId: currentStatusId,
      latestRow: data.statusRows.value?.[0],
      now: data.now,
    }),
    pause: {
      isDisabled: Boolean(monitor.disableActiveMonitoring),
      byManualIncident: Boolean(
        monitor.disableActiveMonitoringBecauseOfManualIncident,
      ),
      byScheduledMaintenance: Boolean(
        monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent,
      ),
    },
    probeFlags: {
      isNoProbeEnabled: Boolean(monitor.isNoProbeEnabledOnThisMonitor),
      isAllProbesDisconnected: Boolean(
        monitor.isAllProbesDisconnectedFromThisMonitor,
      ),
    },
    probes: probes,
    heartbeat: {
      lastReceivedAt: MonitorCheckScheduleUtil.parseDate(
        incomingRequest?.incomingRequestReceivedAt,
      ),
      lastCheckedAt: MonitorCheckScheduleUtil.parseDate(
        monitor.incomingRequestMonitorHeartbeatCheckedAt,
      ),
      requestMethod: toTrimmedString(incomingRequest?.requestMethod),
    },
    email: {
      lastReceivedAt: MonitorCheckScheduleUtil.parseDate(
        monitor.incomingEmailMonitorLastEmailReceivedAt,
      ),
      lastCheckedAt: MonitorCheckScheduleUtil.parseDate(
        monitor.incomingEmailMonitorHeartbeatCheckedAt,
      ),
    },
    agent: {
      lastReportAt: MonitorCheckScheduleUtil.parseDate(
        monitor.serverMonitorRequestReceivedAt,
      ),
      hostname: toTrimmedString(serverResponse?.hostname),
      cpuPercent: toFiniteNumber(
        serverResponse?.basicInfrastructureMetrics?.cpuMetrics?.percentUsed,
      ),
      memoryPercent: toFiniteNumber(
        serverResponse?.basicInfrastructureMetrics?.memoryMetrics?.percentUsed,
      ),
    },
    telemetry: {
      /*
       * The worker stamps this when it queues an evaluation, whether or
       * not one then runs, so it is only ever "last scheduled".
       */
      lastScheduledAt: MonitorCheckScheduleUtil.parseDate(
        monitor.telemetryMonitorLastMonitorAt,
      ),
      nextEvaluationAt: MonitorCheckScheduleUtil.parseDate(
        monitor.telemetryMonitorNextMonitorAt,
      ),
    },
    /*
     * The newest MonitorLog row: when an evaluation last completed. The
     * section's status goes with it, because only a loaded log can say
     * that none has completed; a log still loading, failed or forbidden
     * says nothing either way.
     */
    latestEvaluationAt: data.evaluation.value?.latestAt,
    evaluationStatus: data.evaluation.status,
    minimumProbeAgreement: toFiniteNumber(monitor.minimumProbeAgreement),
  };
}
