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
 * The probe summary the hero, the Probes card and the response-time card
 * share. Null when the probes are unknown (the read was forbidden or failed
 * with nothing kept), which the presentation never renders as "no probes".
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
  });
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

export function toPresentationInput(data: {
  monitor: Monitor;
  probes: OverviewSection<MonitorOverviewProbeData>;
  statusRows: OverviewSection<Array<MonitorStatusTimeline>>;
  evaluation: OverviewSection<MonitorEvaluationByProbe>;
  now: Date;
}): MonitorOverviewPresentationInput {
  const monitor: Monitor = data.monitor;
  const currentStatusId: string | undefined = getCurrentStatusId(monitor);
  const incomingRequest: IncomingRequestLike | undefined =
    monitor.incomingMonitorRequest as unknown as
      | IncomingRequestLike
      | undefined;
  const serverResponse: ServerResponseLike | undefined =
    monitor.serverMonitorResponse as unknown as ServerResponseLike | undefined;

  return {
    now: data.now,
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
    probes: summarizeProbeSection({
      monitor: monitor,
      probes: data.probes,
      now: data.now,
    }),
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
      lastEvaluatedAt: MonitorCheckScheduleUtil.parseDate(
        monitor.telemetryMonitorLastMonitorAt,
      ),
      nextEvaluationAt: MonitorCheckScheduleUtil.parseDate(
        monitor.telemetryMonitorNextMonitorAt,
      ),
    },
    // The newest MonitorLog row: "Last evaluated" for network devices.
    latestEvaluationAt: data.evaluation.value?.latestAt,
    minimumProbeAgreement: toFiniteNumber(monitor.minimumProbeAgreement),
  };
}
