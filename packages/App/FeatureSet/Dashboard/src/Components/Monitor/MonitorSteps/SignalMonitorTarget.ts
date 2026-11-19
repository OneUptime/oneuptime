import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE,
  SESSION_REPLAY_SIGNAL_SESSIONS_METRIC,
} from "Common/Types/Rum/SessionReplaySignalMetric";
import {
  normalizeSessionReplayFrustrationSettings,
  SessionReplayCustomSignal,
} from "Common/Types/Rum/SessionReplayFrustrationSignals";

/*
 * Whether a monitor watches one of a RUM application's own signals (issue
 * #6518) - the Metrics monitor a "Sessions hit <signal>" recommendation
 * creates - and which: the application and the signal's id, read from the
 * step the way the worker evaluates it. The monitor's page then links to
 * the sessions that hit the signal, under the name the signal has now, so
 * a rename on the Frustration Signals page is followed.
 *
 * Plain TypeScript, so the App suite can hold it to the step a template
 * builds without a renderer.
 */

export interface SignalMonitorTarget {
  rumApplicationId: string;
  signalId: string;
}

export function readSignalMonitorTarget(
  monitorType: MonitorType | undefined,
  monitorStep: MonitorStep | undefined,
): SignalMonitorTarget | null {
  if (monitorType !== MonitorType.Metrics) {
    return null;
  }

  const metricMonitor:
    | NonNullable<MonitorStep["data"]>["metricMonitor"]
    | undefined = monitorStep?.data?.metricMonitor;

  const serviceIds: Array<unknown> = Array.isArray(
    metricMonitor?.telemetryServiceIds,
  )
    ? (metricMonitor?.telemetryServiceIds as Array<unknown>)
    : [];

  // One application: a signal belongs to the application it was named on.
  if (serviceIds.length !== 1) {
    return null;
  }

  const rumApplicationId: string = String(serviceIds[0] ?? "").trim();

  if (!rumApplicationId) {
    return null;
  }

  for (const query of metricMonitor?.metricViewConfig?.queryConfigs || []) {
    const filter: { metricName?: unknown; attributes?: unknown } | undefined =
      query?.metricQueryData?.filterData as
        | { metricName?: unknown; attributes?: unknown }
        | undefined;

    if (filter?.metricName !== SESSION_REPLAY_SIGNAL_SESSIONS_METRIC) {
      continue;
    }

    const attributes: Record<string, unknown> =
      filter.attributes && typeof filter.attributes === "object"
        ? (filter.attributes as Record<string, unknown>)
        : {};
    const signalId: unknown = attributes[SESSION_REPLAY_SIGNAL_ID_ATTRIBUTE];

    if (typeof signalId === "string" && signalId.trim()) {
      return { rumApplicationId: rumApplicationId, signalId: signalId };
    }
  }

  return null;
}

/*
 * The signal's name now, from the application's stored settings, or null
 * when the application no longer has it.
 */
export function findSignalName(
  storedSettings: unknown,
  signalId: string,
): string | null {
  const signal: SessionReplayCustomSignal | undefined =
    normalizeSessionReplayFrustrationSettings(
      storedSettings,
    ).customSignals.find((candidate: SessionReplayCustomSignal): boolean => {
      return candidate.id === signalId;
    });

  return signal ? signal.name : null;
}
