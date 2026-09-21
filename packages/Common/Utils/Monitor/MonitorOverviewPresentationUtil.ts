import OneUptimeDate from "../../Types/Date";
import { CheckOn } from "../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../Types/Monitor/MonitorMetricType";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import { formatDurationCompact } from "../Slo/SloDuration";
import MonitorCheckScheduleUtil, {
  MonitorCheckFreshness,
  MonitorCheckFreshnessResult,
} from "./MonitorCheckScheduleUtil";
import MonitorOverviewCriteriaUtil from "./MonitorOverviewCriteriaUtil";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
  MonitorOverviewLayout,
  MonitorOverviewSetupKind,
  MonitorOverviewSideCard,
  MonitorOverviewTelemetryPreview,
} from "./MonitorOverviewFamily";
import { MonitorOverviewProbeSummary } from "./MonitorOverviewProbeUtil";
import MonitorStatusHistoryUtil from "./MonitorStatusHistoryUtil";
import MonitorOverviewTargetUtil, {
  MonitorOverviewTarget,
} from "./MonitorOverviewTargetUtil";
import { MonitorUptimeCaveat } from "./MonitorUptimeSummaryUtil";

/*
 * The monitor overview's hero, facts, pulse and section switches, decided in
 * one pure function so every per-type and per-state rule is unit-tested
 * without React.
 *
 * The rule it is built around: never claim health that was not measured. A
 * paused monitor, one nobody is checking, one with no criteria and one still
 * waiting for its first result are never shown as Good, and never lead with
 * the stored status name (which only describes the last thing that was
 * recorded). Unknown is never rendered as zero.
 */

export enum MonitorOverviewRunState {
  Manual = "Manual",
  Paused = "Paused",
  NotChecking = "NotChecking",
  NotConfigured = "NotConfigured",
  AwaitingFirstData = "AwaitingFirstData",
  Overdue = "Overdue",
  Running = "Running",
}

export type MonitorOverviewTone =
  | "good"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

export type MonitorOverviewLinkKey =
  | "settings"
  | "probes"
  | "criteria"
  | "documentation"
  | "statusTimeline"
  | "incidents"
  | "alerts"
  | "metrics"
  | "owners"
  | "networkDevice";

export type MonitorOverviewFactKey =
  | "latest-result"
  | "certificate-expiry"
  | "domain-expiry"
  | "probes"
  | "missing-window"
  | "heartbeat-check"
  | "host"
  | "cpu"
  | "memory"
  | "evaluates"
  | "criteria"
  | "device"
  | "evaluated"
  | "checks"
  | "owners";

export interface MonitorOverviewStatusRef {
  id: string;
  name: string;
  color: string | undefined;
  isOperationalState: boolean;
  isOfflineState: boolean;
}

export interface MonitorOverviewFact {
  key: MonitorOverviewFactKey;
  label: string;
  value: string;
  secondary?: string | undefined;
  // When set, the value is shown as a relative time instead of `value`.
  valueDate?: Date | undefined;
  tone?: MonitorOverviewTone | undefined;
  isMono?: boolean | undefined;
  isMuted?: boolean | undefined;
  linkKey?: MonitorOverviewLinkKey | undefined;
  linkId?: string | undefined;
}

export interface MonitorOverviewPulse {
  // Null when there is nothing to time (Manual).
  label: string | null;
  at?: Date | undefined;
  // Shown instead of the time when there is no `at`.
  emptyText: string;
  cadenceText?: string | undefined;
  nextAt?: Date | undefined;
  overdueSeconds?: number | undefined;
  // True when the source could not be read, so "never" is not claimed.
  isUnavailable: boolean;
}

export interface MonitorOverviewSections {
  showUptime: boolean;
  setup: MonitorOverviewSetupKind | null;
  connection: MonitorOverviewSetupKind | null;
  summary: { isShown: boolean; description: string };
  sideCard: MonitorOverviewSideCard | null;
  responseTimeMetric: MonitorMetricType | null;
  telemetryPreview: MonitorOverviewTelemetryPreview | null;
  stepCount: number;
}

/*
 * Where the evaluation log (the newest MonitorLog rows) stands, as the page
 * loaded it. Only "loaded" means its times can be trusted, including the
 * absence of any.
 */
export type MonitorOverviewEvaluationStatus =
  | "loading"
  | "loaded"
  | "error"
  | "forbidden";

export interface MonitorOverviewPresentationInput {
  /*
   * On the server's clock (the browser's clock plus its measured offset).
   * Every age, due time and expiry here is measured against it, and every
   * time it is compared with was stamped by the server.
   */
  now: Date;
  monitorType: MonitorType;
  monitorSteps?: MonitorSteps | undefined;
  monitoringInterval?: string | undefined;
  createdAt?: Date | undefined;
  currentStatus?: MonitorOverviewStatusRef | undefined;
  statusSince?: Date | undefined;
  pause: {
    isDisabled: boolean;
    byManualIncident: boolean;
    byScheduledMaintenance: boolean;
  };
  probeFlags: { isNoProbeEnabled: boolean; isAllProbesDisconnected: boolean };
  // Null when the probes are unknown (forbidden or failed to load).
  probes: MonitorOverviewProbeSummary | null;
  heartbeat: {
    lastReceivedAt?: Date | undefined;
    lastCheckedAt?: Date | undefined;
    requestMethod?: string | undefined;
  };
  email: {
    lastReceivedAt?: Date | undefined;
    lastCheckedAt?: Date | undefined;
  };
  agent: {
    lastReportAt?: Date | undefined;
    hostname?: string | undefined;
    cpuPercent?: number | undefined;
    memoryPercent?: number | undefined;
  };
  telemetry: {
    /*
     * Monitor.telemetryMonitorLastMonitorAt. The worker stamps it when it
     * queues an evaluation, before (and whether or not) one runs, so it is
     * "last scheduled", never "last evaluated".
     */
    lastScheduledAt?: Date | undefined;
    /*
     * Deprecated: the same scheduler stamp under its old name, read only
     * when lastScheduledAt is not given.
     */
    lastEvaluatedAt?: Date | undefined;
    nextEvaluationAt?: Date | undefined;
  };
  /*
   * The newest MonitorLog time: when an evaluation last completed. It is
   * "Last evaluated" for telemetry, infrastructure and network devices.
   */
  latestEvaluationAt?: Date | undefined;
  /*
   * The evaluation log's section status. Without it, a latestEvaluationAt
   * counts as loaded and its absence as unknown.
   */
  evaluationStatus?: MonitorOverviewEvaluationStatus | undefined;
  minimumProbeAgreement?: number | undefined;
}

export interface MonitorOverviewBadge {
  text: string;
  tone: MonitorOverviewTone;
  // Set only when the badge names the monitor's status.
  statusColor?: string | undefined;
}

export interface MonitorOverviewSecondaryBadge {
  text: string;
  tone: MonitorOverviewTone;
}

export interface MonitorOverviewPresentation {
  family: MonitorOverviewFamily;
  runState: MonitorOverviewRunState;
  tone: MonitorOverviewTone;
  badge: MonitorOverviewBadge;
  secondaryBadges: Array<MonitorOverviewSecondaryBadge>;
  headline: { text: string; since?: Date | undefined };
  explanation?: string | undefined;
  lastKnownStatus?: string | undefined;
  callToAction?: { text: string; linkKey: MonitorOverviewLinkKey } | undefined;
  pulse: MonitorOverviewPulse;
  freshness: MonitorCheckFreshness;
  /*
   * Overdue with nothing ever received (state 6b): no check result, or no
   * evaluation, since the monitor was created.
   */
  isNeverReported?: boolean | undefined;
  facts: Array<MonitorOverviewFact>;
  target: MonitorOverviewTarget | null;
  sections: MonitorOverviewSections;
}

// The part of the presentation that depends on the run state.
type MonitorOverviewHeroParts = Pick<
  MonitorOverviewPresentation,
  | "tone"
  | "badge"
  | "secondaryBadges"
  | "headline"
  | "explanation"
  | "lastKnownStatus"
  | "callToAction"
>;

// Everything build() and getRunState() both need, worked out once.
interface MonitorOverviewContext {
  family: MonitorOverviewFamily;
  layout: MonitorOverviewLayout;
  cadenceSeconds: number;
  intervalText: string;
  // describeInterval with a lower-case first letter: "every 5 minutes".
  intervalPhrase: string;
  stepCount: number;
  networkDeviceId: string | null;
  isPaused: boolean;
  isNoProbeEnabled: boolean;
  isAllProbesDisconnected: boolean;
  isNotChecking: boolean;
  // Null when the input neither says nor implies how the log loaded.
  evaluationStatus: MonitorOverviewEvaluationStatus | null;
  /*
   * Telemetry and infrastructure: when an evaluation last completed, once
   * the evaluation log is loaded. Until then, the scheduler's stamp, which
   * only says an evaluation was queued.
   */
  telemetryLastAt: Date | undefined;
  freshness: MonitorCheckFreshnessResult;
  runState: MonitorOverviewRunState;
  /*
   * A heartbeat or agent monitor that has never reported, but that the
   * server has already judged: its status is not operational, or its
   * missing-signal window since creation has passed. Its history is real.
   */
  hasPushVerdict: boolean;
}

const MAX_FACTS: number = 4;

/*
 * ServerMonitor/CheckOnlineStatus judges an agent that has not reported for
 * three minutes, counting from creation when it never has.
 */
const AGENT_MISSING_MINUTES: number = 3;

const PAUSED_EXPLANATION: Record<
  "disabled" | "incident" | "maintenance",
  string
> = {
  disabled:
    "No checks run while monitoring is off, so the status stays at the last one recorded.",
  incident:
    "Checks resume when the incident that paused this monitor is resolved.",
  maintenance: "Checks resume automatically when the maintenance event ends.",
};

const MANUAL_EXPLANATION: string =
  "Manual monitor: OneUptime runs no checks. The status changes when someone sets it, or when an incident or scheduled maintenance event changes it.";

const pluralize: (count: number, singular: string, plural: string) => string = (
  count: number,
  singular: string,
  plural: string,
): string => {
  return `${count} ${count === 1 ? singular : plural}`;
};

const lowerFirst: (text: string) => string = (text: string): string => {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
};

const secondsSince: (now: Date, then: Date) => number = (
  now: Date,
  then: Date,
): number => {
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
};

const HOUR_MS: number = 3600 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// "3 hours", or "20 minutes" under an hour. Never "0 minutes".
const describeUnderADay: (ms: number) => string = (ms: number): string => {
  const hours: number = Math.floor(ms / HOUR_MS);

  if (hours >= 1) {
    return pluralize(hours, "hour", "hours");
  }

  return pluralize(Math.max(1, Math.floor(ms / 60000)), "minute", "minutes");
};

/*
 * Calendar days from `earlier` to `later` in the zone dates are printed in.
 * Only called for times at least a day apart, so it is at least 1 (a
 * 25-hour daylight-saving day could otherwise make it 0).
 */
const getCalendarDaysBetween: (earlier: Date, later: Date) => number = (
  earlier: Date,
  later: Date,
): number => {
  const timezone: string = OneUptimeDate.getCurrentTimezone();
  const days: number = Math.round(
    (OneUptimeDate.getStartOfDay(later, timezone).getTime() -
      OneUptimeDate.getStartOfDay(earlier, timezone).getTime()) /
      DAY_MS,
  );

  return Math.max(1, days);
};

const isFutureOf: (date: Date | undefined, now: Date) => boolean = (
  date: Date | undefined,
  now: Date,
): boolean => {
  return Boolean(date && date.getTime() > now.getTime());
};

export default class MonitorOverviewPresentationUtil {
  public static build(
    input: MonitorOverviewPresentationInput,
  ): MonitorOverviewPresentation {
    const context: MonitorOverviewContext =
      MonitorOverviewPresentationUtil.getContext(input);

    const hero: MonitorOverviewHeroParts =
      MonitorOverviewPresentationUtil.getHero(input, context);

    return {
      family: context.family,
      runState: context.runState,
      ...hero,
      pulse: MonitorOverviewPresentationUtil.getPulse(input, context),
      freshness: context.freshness.freshness,
      isNeverReported: MonitorOverviewPresentationUtil.isNeverReported(context),
      facts: MonitorOverviewPresentationUtil.getFacts(input, context),
      target: MonitorOverviewTargetUtil.getTarget({
        monitorType: input.monitorType,
        monitorSteps: input.monitorSteps,
        serverHostname: input.agent.hostname,
      }),
      sections: MonitorOverviewPresentationUtil.getSections(context),
    };
  }

  /*
   * First match wins: Manual, Paused, NotChecking (probe checks only),
   * NotConfigured, AwaitingFirstData, Overdue, Running.
   */
  public static getRunState(
    input: MonitorOverviewPresentationInput,
  ): MonitorOverviewRunState {
    return MonitorOverviewPresentationUtil.getContext(input).runState;
  }

  /*
   * What the uptime tiles must add about time the status timeline counts
   * but nothing measured: its open row keeps the last status while
   * monitoring is paused, while nothing checks, and before the first check
   * completes. A manual monitor has no checks to pause, so it never gets
   * one.
   */
  public static getUptimeCaveat(
    presentation: Pick<
      MonitorOverviewPresentation,
      "family" | "runState" | "isNeverReported"
    >,
  ): MonitorUptimeCaveat | null {
    if (presentation.family === MonitorOverviewFamily.Manual) {
      return null;
    }

    switch (presentation.runState) {
      case MonitorOverviewRunState.Paused:
        return "paused";
      case MonitorOverviewRunState.NotChecking:
      case MonitorOverviewRunState.NotConfigured:
        return "not-checking";
      case MonitorOverviewRunState.Overdue:
        return presentation.isNeverReported ? "no-results" : null;
      default:
        return null;
    }
  }

  public static getStatusTone(
    status: MonitorOverviewStatusRef | undefined,
  ): MonitorOverviewTone {
    if (!status) {
      return "neutral";
    }

    // Offline first: a status flagged both ways must never read as good.
    if (status.isOfflineState) {
      return "danger";
    }

    if (status.isOperationalState) {
      return "good";
    }

    return "warning";
  }

  public static getExpiryFact(data: {
    key: "certificate-expiry" | "domain-expiry";
    expiresAt: Date | undefined;
    isValidCertificate?: boolean | undefined;
    now: Date;
  }): MonitorOverviewFact {
    const label: string =
      data.key === "certificate-expiry"
        ? "Certificate expires"
        : "Domain expires";

    const secondary: string | undefined = data.expiresAt
      ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          data.expiresAt,
          true,
        )
      : undefined;

    if (data.isValidCertificate === false) {
      return {
        key: data.key,
        label: label,
        value: "Not valid",
        secondary: secondary,
        tone: "danger",
      };
    }

    if (!data.expiresAt) {
      return { key: data.key, label: label, value: "—", isMuted: true };
    }

    const msLeft: number = data.expiresAt.getTime() - data.now.getTime();

    /*
     * Within a day either way, hours say it exactly. Beyond that, days are
     * counted on the calendar of the zone the date below is printed in, so
     * "in 2 days" and the printed date agree: 36 hours from noon is two
     * calendar days away, not the one day a floor would give.
     */
    if (msLeft < 0) {
      return {
        key: data.key,
        label: label,
        value:
          -msLeft < DAY_MS
            ? `Expired ${describeUnderADay(-msLeft)} ago`
            : `Expired ${pluralize(
                getCalendarDaysBetween(data.expiresAt, data.now),
                "day",
                "days",
              )} ago`,
        secondary: secondary,
        tone: "danger",
      };
    }

    if (msLeft < DAY_MS) {
      return {
        key: data.key,
        label: label,
        value: `Expires in ${describeUnderADay(msLeft)}`,
        secondary: secondary,
        tone: "danger",
      };
    }

    // The tone keeps counting whole days left, as it always has.
    const wholeDays: number = Math.floor(msLeft / DAY_MS);
    let tone: MonitorOverviewTone = "neutral";

    if (wholeDays <= 7) {
      tone = "danger";
    } else if (wholeDays <= 30) {
      tone = "warning";
    }

    return {
      key: data.key,
      label: label,
      value: `in ${pluralize(
        getCalendarDaysBetween(data.now, data.expiresAt),
        "day",
        "days",
      )}`,
      secondary: secondary,
      tone: tone,
    };
  }

  private static getContext(
    input: MonitorOverviewPresentationInput,
  ): MonitorOverviewContext {
    const layout: MonitorOverviewLayout = MonitorOverviewFamilyUtil.getLayout(
      input.monitorType,
    );
    const family: MonitorOverviewFamily = layout.family;
    const cadenceSeconds: number =
      MonitorCheckScheduleUtil.resolveCadenceSeconds({
        monitoringInterval: input.monitoringInterval,
        from: input.now,
      });
    const intervalText: string = MonitorCheckScheduleUtil.describeInterval(
      input.monitoringInterval,
    );
    const stepCount: number = MonitorOverviewCriteriaUtil.getStepCount(
      input.monitorSteps,
    );
    const networkDeviceId: string | null =
      MonitorOverviewCriteriaUtil.getNetworkDeviceId(input.monitorSteps);

    const isPaused: boolean =
      input.pause.isDisabled ||
      input.pause.byManualIncident ||
      input.pause.byScheduledMaintenance;

    const isProbeCheck: boolean = family === MonitorOverviewFamily.ProbeCheck;

    /*
     * The server keeps these flags on the Monitor row; the probe rows, when
     * they could be read, say the same thing sooner.
     */
    const isNoProbeEnabled: boolean =
      isProbeCheck &&
      (input.probeFlags.isNoProbeEnabled ||
        (input.probes !== null && input.probes.enabledCount === 0));
    const isAllProbesDisconnected: boolean =
      isProbeCheck &&
      (input.probeFlags.isAllProbesDisconnected ||
        (input.probes !== null &&
          input.probes.enabledCount > 0 &&
          input.probes.disconnectedCount === input.probes.enabledCount));
    const isNotChecking: boolean = isNoProbeEnabled || isAllProbesDisconnected;

    const evaluationStatus: MonitorOverviewEvaluationStatus | null =
      MonitorOverviewPresentationUtil.getEvaluationStatus(input);
    const isEvaluationLoaded: boolean = evaluationStatus === "loaded";
    const telemetryLastAt: Date | undefined = isEvaluationLoaded
      ? input.latestEvaluationAt
      : input.telemetry.lastScheduledAt || input.telemetry.lastEvaluatedAt;

    const freshness: MonitorCheckFreshnessResult =
      MonitorOverviewPresentationUtil.getFreshness({
        input: input,
        family: family,
        cadenceSeconds: cadenceSeconds,
        isScheduled: !isPaused && !isNotChecking,
        telemetryLastAt: telemetryLastAt,
      });

    let runState: MonitorOverviewRunState = MonitorOverviewRunState.Running;

    if (family === MonitorOverviewFamily.Manual) {
      runState = MonitorOverviewRunState.Manual;
    } else if (isPaused) {
      runState = MonitorOverviewRunState.Paused;
    } else if (isNotChecking) {
      runState = MonitorOverviewRunState.NotChecking;
    } else if (
      stepCount === 0 ||
      (family === MonitorOverviewFamily.NetworkDevice && !networkDeviceId)
    ) {
      runState = MonitorOverviewRunState.NotConfigured;
    } else if (
      MonitorOverviewPresentationUtil.isAwaitingFirstData({
        input: input,
        family: family,
        freshness: freshness.freshness,
        isEvaluationLoaded: isEvaluationLoaded,
        telemetryLastAt: telemetryLastAt,
      })
    ) {
      runState = MonitorOverviewRunState.AwaitingFirstData;
    } else if (freshness.freshness === MonitorCheckFreshness.Stale) {
      runState = MonitorOverviewRunState.Overdue;
    }

    return {
      family: family,
      layout: layout,
      cadenceSeconds: cadenceSeconds,
      intervalText: intervalText,
      intervalPhrase: lowerFirst(intervalText),
      stepCount: stepCount,
      networkDeviceId: networkDeviceId,
      isPaused: isPaused,
      isNoProbeEnabled: isNoProbeEnabled,
      isAllProbesDisconnected: isAllProbesDisconnected,
      isNotChecking: isNotChecking,
      evaluationStatus: evaluationStatus,
      telemetryLastAt: telemetryLastAt,
      freshness: freshness,
      runState: runState,
      hasPushVerdict:
        runState === MonitorOverviewRunState.AwaitingFirstData &&
        MonitorOverviewPresentationUtil.hasPushVerdict({
          input: input,
          family: family,
        }),
    };
  }

  /*
   * Without an explicit status (callers from before evaluationStatus), a
   * time means the log was read; its absence says nothing.
   */
  private static getEvaluationStatus(
    input: MonitorOverviewPresentationInput,
  ): MonitorOverviewEvaluationStatus | null {
    if (input.evaluationStatus) {
      return input.evaluationStatus;
    }

    return input.latestEvaluationAt ? "loaded" : null;
  }

  /*
   * A push monitor's missing-signal check counts from creation when nothing
   * has arrived yet, so the server judges it once this window has passed.
   * Null when its criteria have no such check.
   */
  private static getPushMissingMinutes(data: {
    input: MonitorOverviewPresentationInput;
    family: MonitorOverviewFamily;
  }): number | null {
    const monitorSteps: MonitorSteps | undefined = data.input.monitorSteps;

    if (data.family === MonitorOverviewFamily.Agent) {
      return MonitorOverviewCriteriaUtil.hasFilterOn({
        monitorSteps: monitorSteps,
        checkOn: CheckOn.IsOnline,
      })
        ? AGENT_MISSING_MINUTES
        : null;
    }

    if (data.family !== MonitorOverviewFamily.Heartbeat) {
      return null;
    }

    return MonitorOverviewCriteriaUtil.getMissingSignalMinutes({
      monitorSteps: monitorSteps,
      checkOn:
        data.input.monitorType === MonitorType.IncomingEmail
          ? CheckOn.EmailReceivedAt
          : CheckOn.IncomingRequest,
    });
  }

  private static hasPushVerdict(data: {
    input: MonitorOverviewPresentationInput;
    family: MonitorOverviewFamily;
  }): boolean {
    if (
      data.family !== MonitorOverviewFamily.Heartbeat &&
      data.family !== MonitorOverviewFamily.Agent
    ) {
      return false;
    }

    if (MonitorOverviewPresentationUtil.isJudgedStatus(data.input)) {
      return true;
    }

    const minutes: number | null =
      MonitorOverviewPresentationUtil.getPushMissingMinutes(data);
    const createdAt: Date | undefined = data.input.createdAt;

    return (
      minutes !== null &&
      createdAt !== undefined &&
      data.input.now.getTime() - createdAt.getTime() > minutes * 60 * 1000
    );
  }

  /*
   * A status that is not operational was set by something: for a push
   * monitor that never reported, the server's missing-signal check.
   */
  private static isJudgedStatus(
    input: MonitorOverviewPresentationInput,
  ): boolean {
    const tone: MonitorOverviewTone =
      MonitorOverviewPresentationUtil.getStatusTone(input.currentStatus);

    return tone === "danger" || tone === "warning";
  }

  /*
   * Freshness is only judged for the families that run on a schedule we can
   * see: probe checks and the worker-evaluated telemetry and infrastructure
   * monitors. Push-based monitors decide "missing" in their own criteria.
   */
  private static getFreshness(data: {
    input: MonitorOverviewPresentationInput;
    family: MonitorOverviewFamily;
    cadenceSeconds: number;
    isScheduled: boolean;
    telemetryLastAt: Date | undefined;
  }): MonitorCheckFreshnessResult {
    const input: MonitorOverviewPresentationInput = data.input;

    if (data.family === MonitorOverviewFamily.ProbeCheck) {
      return MonitorCheckScheduleUtil.getCheckFreshness({
        isScheduled: data.isScheduled,
        isKnown: input.probes !== null,
        lastResultAt: input.probes?.lastResultAt,
        /*
         * Behind schedule only when every probe that is checking is: a
         * summary from before latestNextCheckAt existed has only the
         * earliest.
         */
        nextCheckAt:
          input.probes?.latestNextCheckAt || input.probes?.nextCheckAt,
        cadenceSeconds: data.cadenceSeconds,
        createdAt: input.createdAt,
        now: input.now,
        monitoringInterval: input.monitoringInterval,
      });
    }

    if (
      data.family === MonitorOverviewFamily.TelemetrySignal ||
      data.family === MonitorOverviewFamily.Infrastructure
    ) {
      return MonitorCheckScheduleUtil.getCheckFreshness({
        isScheduled: data.isScheduled,
        isKnown: true,
        lastResultAt: data.telemetryLastAt,
        nextCheckAt: input.telemetry.nextEvaluationAt,
        cadenceSeconds: data.cadenceSeconds,
        createdAt: input.createdAt,
        now: input.now,
        monitoringInterval: input.monitoringInterval,
      });
    }

    return MonitorCheckScheduleUtil.getCheckFreshness({
      isScheduled: false,
      isKnown: true,
      lastResultAt: undefined,
      nextCheckAt: undefined,
      cadenceSeconds: data.cadenceSeconds,
      createdAt: input.createdAt,
      now: input.now,
    });
  }

  private static isAwaitingFirstData(data: {
    input: MonitorOverviewPresentationInput;
    family: MonitorOverviewFamily;
    freshness: MonitorCheckFreshness;
    isEvaluationLoaded: boolean;
    telemetryLastAt: Date | undefined;
  }): boolean {
    const input: MonitorOverviewPresentationInput = data.input;

    switch (data.family) {
      case MonitorOverviewFamily.ProbeCheck:
        return (
          input.probes !== null &&
          input.probes.enabledCount > 0 &&
          data.freshness === MonitorCheckFreshness.AwaitingFirstResult
        );
      case MonitorOverviewFamily.Heartbeat:
        return input.monitorType === MonitorType.IncomingEmail
          ? !input.email.lastReceivedAt
          : !input.heartbeat.lastReceivedAt;
      case MonitorOverviewFamily.Agent:
        return !input.agent.lastReportAt;
      case MonitorOverviewFamily.TelemetrySignal:
      case MonitorOverviewFamily.Infrastructure:
        /*
         * With the evaluation log, "waiting" ends at the first completed
         * evaluation and, like a probe check, lasts only while the monitor
         * is young: past that, no evaluation is overdue (6b). Without it,
         * the scheduler's stamp is all there is.
         */
        return data.isEvaluationLoaded
          ? data.freshness === MonitorCheckFreshness.AwaitingFirstResult
          : !data.telemetryLastAt;
      case MonitorOverviewFamily.NetworkDevice:
        /*
         * A device is evaluated on its polls and traps, which leave no
         * trace on the monitor row: only a loaded, empty log says none has
         * been evaluated yet.
         */
        return data.isEvaluationLoaded && !input.latestEvaluationAt;
      default:
        // Manual monitors are never evaluated.
        return false;
    }
  }

  private static getHero(
    input: MonitorOverviewPresentationInput,
    context: MonitorOverviewContext,
  ): MonitorOverviewHeroParts {
    const status: MonitorOverviewStatusRef | undefined = input.currentStatus;
    const statusTone: MonitorOverviewTone =
      MonitorOverviewPresentationUtil.getStatusTone(status);
    const lastKnownStatus: string | undefined = status
      ? `Last recorded status: ${status.name}`
      : undefined;

    // The badge and headline for the states that lead with the status.
    const statusBadge: MonitorOverviewBadge = status
      ? {
          text: status.name,
          tone: statusTone,
          statusColor: MonitorStatusHistoryUtil.normalizeColor(status.color),
        }
      : { text: "Unknown status", tone: "neutral" };
    const statusHeadline: { text: string; since?: Date | undefined } = status
      ? { text: status.name, since: input.statusSince }
      : { text: "No status recorded yet" };

    switch (context.runState) {
      case MonitorOverviewRunState.Manual:
        return {
          tone: statusTone,
          badge: statusBadge,
          secondaryBadges: [{ text: "Manual", tone: "neutral" }],
          headline: statusHeadline,
          explanation: MANUAL_EXPLANATION,
          callToAction: { text: "Change status", linkKey: "statusTimeline" },
        };

      case MonitorOverviewRunState.Paused: {
        const secondaryBadges: Array<MonitorOverviewSecondaryBadge> = [];

        /*
         * Pausing does not fix a probe problem, and the problem is still
         * there when monitoring resumes, so it stays visible.
         */
        if (context.isNoProbeEnabled) {
          secondaryBadges.push({ text: "Probes Not Enabled", tone: "danger" });
        } else if (context.isAllProbesDisconnected) {
          secondaryBadges.push({
            text: "Probes Disconnected",
            tone: "danger",
          });
        }

        if (input.pause.isDisabled) {
          return {
            tone: "neutral",
            badge: { text: "Disabled", tone: "neutral" },
            secondaryBadges: secondaryBadges,
            headline: { text: "Monitoring is turned off" },
            explanation: PAUSED_EXPLANATION.disabled,
            lastKnownStatus: lastKnownStatus,
            callToAction: { text: "Open settings", linkKey: "settings" },
          };
        }

        if (input.pause.byManualIncident) {
          return {
            tone: "neutral",
            badge: { text: "Paused", tone: "neutral" },
            secondaryBadges: secondaryBadges,
            headline: { text: "Monitoring is paused by an incident" },
            explanation: PAUSED_EXPLANATION.incident,
            lastKnownStatus: lastKnownStatus,
            callToAction: { text: "View incidents", linkKey: "incidents" },
          };
        }

        return {
          tone: "neutral",
          badge: { text: "Paused", tone: "neutral" },
          secondaryBadges: secondaryBadges,
          headline: { text: "Monitoring is paused for scheduled maintenance" },
          explanation: PAUSED_EXPLANATION.maintenance,
          lastKnownStatus: lastKnownStatus,
        };
      }

      case MonitorOverviewRunState.NotChecking:
        return MonitorOverviewPresentationUtil.getNotCheckingHero({
          input: input,
          context: context,
          lastKnownStatus: lastKnownStatus,
        });

      case MonitorOverviewRunState.NotConfigured: {
        const isMissingDevice: boolean =
          context.family === MonitorOverviewFamily.NetworkDevice &&
          context.stepCount > 0;

        return {
          tone: "neutral",
          badge: { text: "Not set up", tone: "neutral" },
          secondaryBadges: [],
          headline: {
            text: isMissingDevice
              ? "No network device is selected"
              : "This monitor has no criteria yet",
          },
          explanation: isMissingDevice
            ? "Choose the device this monitor alerts on."
            : "Add criteria to tell this monitor what to check.",
          callToAction: {
            text: isMissingDevice ? "Choose a device" : "Set up criteria",
            linkKey: "criteria",
          },
        };
      }

      case MonitorOverviewRunState.AwaitingFirstData:
        return MonitorOverviewPresentationUtil.getAwaitingHero({
          input: input,
          context: context,
          lastKnownStatus: lastKnownStatus,
        });

      case MonitorOverviewRunState.Overdue: {
        const isProbeCheck: boolean =
          context.family === MonitorOverviewFamily.ProbeCheck;
        /*
         * Nothing has ever been measured (6b), so the stored status is only
         * the default the monitor was created with: it is not the headline,
         * and it has not "held" for any length of time.
         */
        const isNeverReported: boolean =
          MonitorOverviewPresentationUtil.isNeverReported(context);

        return {
          // A late check cannot vouch for "good"; danger stays danger.
          tone: statusTone === "danger" ? "danger" : "warning",
          badge: isNeverReported
            ? { text: "No results yet", tone: "warning" }
            : statusBadge,
          secondaryBadges: [{ text: "Checks overdue", tone: "warning" }],
          headline: isNeverReported
            ? {
                text: isProbeCheck
                  ? "No check has completed yet"
                  : "No evaluation has completed yet",
              }
            : statusHeadline,
          explanation: MonitorOverviewPresentationUtil.getOverdueExplanation({
            input: input,
            context: context,
          }),
          lastKnownStatus: isNeverReported ? lastKnownStatus : undefined,
          callToAction: isProbeCheck
            ? { text: "Check probes", linkKey: "probes" }
            : undefined,
        };
      }

      default:
        return {
          tone: statusTone,
          badge: statusBadge,
          secondaryBadges: [],
          headline: statusHeadline,
        };
    }
  }

  private static getNotCheckingHero(data: {
    input: MonitorOverviewPresentationInput;
    context: MonitorOverviewContext;
    lastKnownStatus: string | undefined;
  }): MonitorOverviewHeroParts {
    const probes: MonitorOverviewProbeSummary | null = data.input.probes;

    if (!data.context.isNoProbeEnabled) {
      return {
        tone: "danger",
        badge: { text: "Probes Disconnected", tone: "danger" },
        secondaryBadges: [],
        headline: { text: "Every probe checking this monitor is disconnected" },
        explanation:
          "Checks stopped when the probes lost their connection. The status shown is the last one recorded.",
        lastKnownStatus: data.lastKnownStatus,
        callToAction: { text: "Check probes", linkKey: "probes" },
      };
    }

    const badge: MonitorOverviewBadge = {
      text: "Probes Not Enabled",
      tone: "danger",
    };

    // Unknown probes must never be described as "no probes attached".
    if (probes === null) {
      return {
        tone: "danger",
        badge: badge,
        secondaryBadges: [],
        headline: { text: "Nothing is checking this monitor" },
        explanation: "No probe is enabled for this monitor, so no checks run.",
        lastKnownStatus: data.lastKnownStatus,
        callToAction: { text: "Manage probes", linkKey: "probes" },
      };
    }

    if (probes.attachedCount === 0) {
      return {
        tone: "danger",
        badge: badge,
        secondaryBadges: [],
        headline: { text: "No probes are attached to this monitor" },
        explanation: "Add a probe to start checking this resource.",
        lastKnownStatus: data.lastKnownStatus,
        callToAction: { text: "Add a probe", linkKey: "probes" },
      };
    }

    return {
      tone: "danger",
      badge: badge,
      secondaryBadges: [],
      headline: { text: "Every probe is turned off for this monitor" },
      explanation: `${
        probes.attachedCount === 1
          ? "1 probe is"
          : `${probes.attachedCount} probes are`
      } attached but switched off, so nothing is checking this resource.`,
      lastKnownStatus: data.lastKnownStatus,
      callToAction: { text: "Manage probes", linkKey: "probes" },
    };
  }

  private static getAwaitingHero(data: {
    input: MonitorOverviewPresentationInput;
    context: MonitorOverviewContext;
    lastKnownStatus: string | undefined;
  }): MonitorOverviewHeroParts {
    const input: MonitorOverviewPresentationInput = data.input;
    const context: MonitorOverviewContext = data.context;

    let headline: string = "Waiting for the first evaluation";
    let explanation: string = `This monitor is evaluated ${context.intervalPhrase} once saved.`;
    let hasSetup: boolean = false;
    // What has never arrived, for a push monitor the server has judged.
    let missingSince: string | null = null;

    if (context.family === MonitorOverviewFamily.ProbeCheck) {
      const enabledCount: number = input.probes?.enabledCount || 0;

      headline = "Waiting for the first check";
      explanation = `${
        enabledCount === 1 ? "1 probe checks" : `${enabledCount} probes check`
      } this ${context.intervalPhrase}. The first result usually arrives within a few minutes.`;
    } else if (context.family === MonitorOverviewFamily.NetworkDevice) {
      headline = "Waiting for the first poll";
      explanation =
        "No poll or trap from this device has been evaluated yet. Check that a probe is assigned to poll it.";
    } else if (input.monitorType === MonitorType.IncomingRequest) {
      headline = "Waiting for the first heartbeat";
      explanation =
        "Send a GET or POST request to this monitor's heartbeat URL to start tracking it.";
      hasSetup = true;
      missingSince = "No heartbeat has arrived";
    } else if (input.monitorType === MonitorType.IncomingEmail) {
      headline = "Waiting for the first email";
      explanation =
        "Send an email to this monitor's address to start tracking it.";
      hasSetup = true;
      missingSince = "No email has arrived";
    } else if (context.family === MonitorOverviewFamily.Agent) {
      headline = "Waiting for the agent to report";
      explanation = "Install the server agent to start sending reports.";
      hasSetup = true;
      missingSince = "The agent has not reported";
    }

    const callToAction: MonitorOverviewHeroParts["callToAction"] = hasSetup
      ? { text: "Setup instructions", linkKey: "documentation" }
      : undefined;
    const status: MonitorOverviewStatusRef | undefined = input.currentStatus;

    /*
     * The server judges a push monitor that never reported as if its last
     * signal arrived at creation, so it can be Offline, with an incident
     * open, while the page is still "waiting". Lead with that verdict's
     * tone and keep the setup steps: sending the first signal is still the
     * fix.
     */
    if (
      missingSince !== null &&
      status &&
      MonitorOverviewPresentationUtil.isJudgedStatus(input)
    ) {
      const statusTone: MonitorOverviewTone =
        MonitorOverviewPresentationUtil.getStatusTone(status);

      return {
        tone: statusTone,
        badge: { text: "Waiting for data", tone: "info" },
        secondaryBadges: [{ text: status.name, tone: statusTone }],
        headline: {
          text: input.createdAt
            ? `${missingSince} since this monitor was created ${formatDurationCompact(
                secondsSince(input.now, input.createdAt),
              )} ago`
            : headline,
        },
        explanation: explanation,
        callToAction: callToAction,
      };
    }

    return {
      tone: "info",
      badge: { text: "Waiting for data", tone: "info" },
      secondaryBadges: [],
      headline: { text: headline },
      explanation: explanation,
      lastKnownStatus: data.lastKnownStatus,
      callToAction: callToAction,
    };
  }

  private static isNeverReported(context: MonitorOverviewContext): boolean {
    return (
      context.runState === MonitorOverviewRunState.Overdue &&
      context.freshness.resultAgeSeconds === null
    );
  }

  /*
   * "No result for 12m" states how long it has been since the last result -
   * the same age the pulse's "Last checked" shows - so the two never
   * disagree. The pulse's "Overdue by" line carries how late that is.
   */
  private static getOverdueExplanation(data: {
    input: MonitorOverviewPresentationInput;
    context: MonitorOverviewContext;
  }): string {
    const input: MonitorOverviewPresentationInput = data.input;
    const context: MonitorOverviewContext = data.context;
    const isProbeCheck: boolean =
      context.family === MonitorOverviewFamily.ProbeCheck;
    const resultAgeSeconds: number | null = context.freshness.resultAgeSeconds;

    if (resultAgeSeconds === null) {
      const createdAgo: string = input.createdAt
        ? formatDurationCompact(secondsSince(input.now, input.createdAt))
        : formatDurationCompact(context.freshness.overdueSeconds || 0);

      return isProbeCheck
        ? `No check result has arrived since this monitor was created ${createdAgo} ago.`
        : `No evaluation has run since this monitor was created ${createdAgo} ago.`;
    }

    const age: string = formatDurationCompact(resultAgeSeconds);

    return isProbeCheck
      ? `No result for ${age}, but this monitor checks ${context.intervalPhrase}. A probe may be overloaded or offline.`
      : `No evaluation for ${age}, but this monitor is evaluated ${context.intervalPhrase}.`;
  }

  private static getPulse(
    input: MonitorOverviewPresentationInput,
    context: MonitorOverviewContext,
  ): MonitorOverviewPulse {
    const isScheduled: boolean =
      context.runState !== MonitorOverviewRunState.Paused &&
      context.runState !== MonitorOverviewRunState.NotChecking &&
      context.runState !== MonitorOverviewRunState.NotConfigured;
    const overdueSeconds: number | undefined =
      context.runState === MonitorOverviewRunState.Overdue &&
      context.freshness.overdueSeconds !== null
        ? context.freshness.overdueSeconds
        : undefined;

    switch (context.family) {
      case MonitorOverviewFamily.ProbeCheck: {
        const nextAt: Date | undefined = input.probes?.nextCheckAt;

        return {
          label: "Last checked",
          at: input.probes?.lastResultAt,
          emptyText: "Not checked yet",
          // A paused or unchecked monitor has no cadence to promise.
          cadenceText: isScheduled ? context.intervalText : undefined,
          nextAt:
            isScheduled && isFutureOf(nextAt, input.now) ? nextAt : undefined,
          overdueSeconds: overdueSeconds,
          isUnavailable: input.probes === null,
        };
      }

      case MonitorOverviewFamily.Heartbeat: {
        const isEmail: boolean =
          input.monitorType === MonitorType.IncomingEmail;

        /*
         * No cadence line: the missing-request check time is already the
         * "Last missing-request check" fact, and a push-based monitor has no
         * schedule of its own to promise.
         */
        return {
          label: isEmail ? "Last email" : "Last request",
          at: isEmail
            ? input.email.lastReceivedAt
            : input.heartbeat.lastReceivedAt,
          emptyText: isEmail ? "No email yet" : "No request yet",
          isUnavailable: false,
        };
      }

      case MonitorOverviewFamily.Agent:
        return {
          label: "Last report",
          at: input.agent.lastReportAt,
          emptyText: "No report yet",
          isUnavailable: false,
        };

      case MonitorOverviewFamily.TelemetrySignal:
      case MonitorOverviewFamily.Infrastructure: {
        const nextAt: Date | undefined = input.telemetry.nextEvaluationAt;
        /*
         * Until the evaluation log is read, the only time is the worker's
         * stamp, which it writes when it queues an evaluation: it is named
         * for what it is.
         */
        const isEvaluated: boolean = context.evaluationStatus === "loaded";

        return {
          label: isEvaluated ? "Last evaluated" : "Last scheduled",
          at: context.telemetryLastAt,
          emptyText: isEvaluated ? "Not evaluated yet" : "Not scheduled yet",
          cadenceText: isScheduled ? context.intervalText : undefined,
          nextAt:
            isScheduled && isFutureOf(nextAt, input.now) ? nextAt : undefined,
          overdueSeconds: overdueSeconds,
          isUnavailable: false,
        };
      }

      case MonitorOverviewFamily.NetworkDevice:
        // The time only comes from the evaluation log, so it follows its read.
        return {
          label: "Last evaluated",
          at:
            context.evaluationStatus === "loaded"
              ? input.latestEvaluationAt
              : undefined,
          emptyText:
            context.evaluationStatus === "loading"
              ? "Loading…"
              : "Not evaluated yet",
          isUnavailable:
            context.evaluationStatus === "error" ||
            context.evaluationStatus === "forbidden",
        };

      default:
        return {
          label: null,
          emptyText: "No automated checks",
          isUnavailable: false,
        };
    }
  }

  private static getFacts(
    input: MonitorOverviewPresentationInput,
    context: MonitorOverviewContext,
  ): Array<MonitorOverviewFact> {
    const facts: Array<MonitorOverviewFact> = [];

    switch (context.family) {
      case MonitorOverviewFamily.ProbeCheck:
        facts.push(MonitorOverviewPresentationUtil.getLatestResultFact(input));

        if (input.monitorType === MonitorType.SSLCertificate) {
          facts.push(
            input.probes === null
              ? {
                  key: "certificate-expiry",
                  label: "Certificate expires",
                  value: "Unavailable",
                  isMuted: true,
                }
              : MonitorOverviewPresentationUtil.getExpiryFact({
                  key: "certificate-expiry",
                  expiresAt: input.probes.latestResult?.sslExpiresAt,
                  isValidCertificate:
                    input.probes.latestResult?.isValidCertificate,
                  now: input.now,
                }),
          );
        }

        if (input.monitorType === MonitorType.Domain) {
          facts.push(
            input.probes === null
              ? {
                  key: "domain-expiry",
                  label: "Domain expires",
                  value: "Unavailable",
                  isMuted: true,
                }
              : MonitorOverviewPresentationUtil.getExpiryFact({
                  key: "domain-expiry",
                  expiresAt: input.probes.latestResult?.domainExpiresAt,
                  now: input.now,
                }),
          );
        }

        facts.push(
          MonitorOverviewPresentationUtil.getProbesFact(input, context),
        );
        break;

      case MonitorOverviewFamily.Heartbeat: {
        const isEmail: boolean =
          input.monitorType === MonitorType.IncomingEmail;
        const minutes: number | null =
          MonitorOverviewCriteriaUtil.getMissingSignalMinutes({
            monitorSteps: input.monitorSteps,
            checkOn: isEmail
              ? CheckOn.EmailReceivedAt
              : CheckOn.IncomingRequest,
          });
        const lastCheckedAt: Date | undefined = isEmail
          ? input.email.lastCheckedAt
          : input.heartbeat.lastCheckedAt;

        facts.push(
          minutes === null
            ? {
                key: "missing-window",
                label: isEmail
                  ? "Missing-email window"
                  : "Missing-request window",
                value: "Set in Criteria",
                linkKey: "criteria",
              }
            : {
                key: "missing-window",
                label: isEmail
                  ? "Missing-email window"
                  : "Missing-request window",
                value: pluralize(minutes, "minute", "minutes"),
                secondary: "From this monitor's criteria",
              },
        );

        facts.push(
          lastCheckedAt
            ? {
                key: "heartbeat-check",
                label: isEmail
                  ? "Last missing-email check"
                  : "Last missing-request check",
                value: "",
                valueDate: lastCheckedAt,
              }
            : {
                key: "heartbeat-check",
                label: isEmail
                  ? "Last missing-email check"
                  : "Last missing-request check",
                value: "Not run yet",
                isMuted: true,
              },
        );
        break;
      }

      case MonitorOverviewFamily.Agent: {
        const hostname: string = (input.agent.hostname || "").trim();

        facts.push(
          hostname
            ? { key: "host", label: "Host", value: hostname, isMono: true }
            : {
                key: "host",
                label: "Host",
                value: "Not reported yet",
                isMuted: true,
              },
        );
        facts.push(
          MonitorOverviewPresentationUtil.getPercentFact({
            key: "cpu",
            label: "CPU",
            percent: input.agent.cpuPercent,
          }),
        );
        facts.push(
          MonitorOverviewPresentationUtil.getPercentFact({
            key: "memory",
            label: "Memory",
            percent: input.agent.memoryPercent,
          }),
        );
        break;
      }

      case MonitorOverviewFamily.TelemetrySignal:
      case MonitorOverviewFamily.Infrastructure:
        facts.push({
          key: "evaluates",
          label: "Evaluates",
          value: context.intervalText,
        });
        facts.push({
          key: "criteria",
          label: "Criteria",
          value: pluralize(context.stepCount, "step", "steps"),
          linkKey: "criteria",
        });
        break;

      case MonitorOverviewFamily.NetworkDevice:
        facts.push(
          context.networkDeviceId
            ? {
                key: "device",
                label: "Device",
                value: "View device",
                linkKey: "networkDevice",
                linkId: context.networkDeviceId,
              }
            : {
                key: "device",
                label: "Device",
                value: "Not selected",
                isMuted: true,
              },
        );
        facts.push({
          key: "evaluated",
          label: "Evaluated",
          value: "On every poll and matching trap",
        });
        break;

      default:
        facts.push({
          key: "checks",
          label: "Checks",
          value: "None",
          secondary: "Status is set by hand or by incidents",
        });
        break;
    }

    /*
     * Owners always close the band; the component renders them from the
     * owners section, so the value here is empty.
     */
    return [
      ...facts.slice(0, MAX_FACTS - 1),
      { key: "owners", label: "Owners", value: "" },
    ];
  }

  private static getLatestResultFact(
    input: MonitorOverviewPresentationInput,
  ): MonitorOverviewFact {
    const base: { key: MonitorOverviewFactKey; label: string } = {
      key: "latest-result",
      label: "Latest result",
    };

    if (input.probes === null) {
      return { ...base, value: "Unavailable", isMuted: true };
    }

    const result: MonitorOverviewProbeSummary["latestResult"] =
      input.probes.latestResult;

    if (!result) {
      return {
        ...base,
        value: "—",
        secondary: "No results yet",
        isMuted: true,
      };
    }

    const isScripted: boolean =
      input.monitorType === MonitorType.SyntheticMonitor ||
      input.monitorType === MonitorType.CustomJavaScriptCode;
    const upCount: number = input.probes.upCount || 0;
    const downCount: number = input.probes.downCount || 0;

    /*
     * When the probes disagree, the newest single result is just whichever
     * probe reported last, and would flip between Up and Down from one poll
     * to the next. Say they disagree instead.
     */
    if (upCount > 0 && downCount > 0) {
      return {
        ...base,
        value: isScripted
          ? `Mixed · ${upCount} passed, ${downCount} failed`
          : `Mixed · ${upCount} up, ${downCount} down`,
        tone: "warning",
      };
    }

    let value: string = "Reported";
    let tone: MonitorOverviewTone = "neutral";

    if (result.isOnline === true) {
      value = isScripted ? "Passed" : "Up";
      tone = "good";
    } else if (result.isOnline === false) {
      value = isScripted ? "Failed" : "Down";
      tone = "danger";
    }

    if (result.responseTimeInMs !== undefined) {
      value += ` · ${Math.round(result.responseTimeInMs)} ms`;
    }

    if (
      result.responseCode !== undefined &&
      (input.monitorType === MonitorType.API ||
        input.monitorType === MonitorType.Website)
    ) {
      value += ` · HTTP ${result.responseCode}`;
    }

    return {
      ...base,
      value: value,
      secondary:
        result.isOnline === false && result.failureCause
          ? result.failureCause
          : `from ${result.probeName}`,
      tone: tone,
    };
  }

  private static getProbesFact(
    input: MonitorOverviewPresentationInput,
    context: MonitorOverviewContext,
  ): MonitorOverviewFact {
    const base: {
      key: MonitorOverviewFactKey;
      label: string;
      linkKey: MonitorOverviewLinkKey;
    } = { key: "probes", label: "Probes", linkKey: "probes" };

    if (input.probes === null) {
      return { ...base, value: "Unavailable", isMuted: true };
    }

    const probes: MonitorOverviewProbeSummary = input.probes;
    const downCount: number = probes.downCount || 0;
    const connectionParts: Array<string> = [];

    if (probes.disabledCount > 0) {
      connectionParts.push(`${probes.disabledCount} disabled`);
    }

    if (probes.disconnectedCount > 0) {
      connectionParts.push(`${probes.disconnectedCount} disconnected`);
    }

    const joinParts: (parts: Array<string>) => string | undefined = (
      parts: Array<string>,
    ): string | undefined => {
      return parts.length > 0 ? parts.join(" · ") : undefined;
    };

    if (probes.enabledCount === 0) {
      return {
        ...base,
        value: "None enabled",
        secondary: joinParts(connectionParts),
        tone: "danger",
      };
    }

    /*
     * No probe is meant to report while monitoring is paused, so a
     * reporting ratio would read as a probe fault that does not exist.
     */
    if (context.isPaused) {
      return {
        ...base,
        value: `${probes.enabledCount} enabled`,
        secondary: joinParts(["Checks paused", ...connectionParts]),
        tone: "neutral",
      };
    }

    let tone: MonitorOverviewTone = "neutral";

    if (probes.reportingCount === 0 || downCount >= probes.reportingCount) {
      // Nothing reporting, or every probe that reports sees it down.
      tone = "danger";
    } else if (downCount > 0 || probes.reportingCount < probes.enabledCount) {
      tone = "warning";
    }

    const isScripted: boolean =
      input.monitorType === MonitorType.SyntheticMonitor ||
      input.monitorType === MonitorType.CustomJavaScriptCode;
    // A probe that reports Down is reporting, but it is not fine.
    const downPart: string = `${downCount} ${isScripted ? "failing" : "down"}`;

    return {
      ...base,
      value: `${probes.reportingCount} of ${probes.enabledCount} reporting`,
      secondary: joinParts(
        downCount > 0 ? [downPart, ...connectionParts] : connectionParts,
      ),
      tone: tone,
    };
  }

  private static getPercentFact(data: {
    key: "cpu" | "memory";
    label: string;
    percent: number | undefined;
  }): MonitorOverviewFact {
    if (data.percent === undefined || !Number.isFinite(data.percent)) {
      return { key: data.key, label: data.label, value: "—", isMuted: true };
    }

    return {
      key: data.key,
      label: data.label,
      value: `${Math.round(data.percent)}%`,
    };
  }

  private static getSections(
    context: MonitorOverviewContext,
  ): MonitorOverviewSections {
    const isAwaiting: boolean =
      context.runState === MonitorOverviewRunState.AwaitingFirstData;
    const layout: MonitorOverviewLayout = context.layout;
    const isPushFamily: boolean =
      context.family === MonitorOverviewFamily.Heartbeat ||
      context.family === MonitorOverviewFamily.Agent;

    return {
      /*
       * Bars for a monitor that has never reported would all be "No data",
       * unless the server has already judged it: then its history (and what
       * is open now) is the point.
       */
      showUptime: !isAwaiting || context.hasPushVerdict,
      setup: isAwaiting ? layout.setupKind : null,
      connection: isAwaiting ? null : layout.setupKind,
      summary: {
        isShown:
          layout.summaryDescription !== null && !(isAwaiting && isPushFamily),
        description: layout.summaryDescription || "",
      },
      // The connection card only makes sense once something has connected.
      sideCard:
        layout.sideCard === "connection" && isAwaiting ? null : layout.sideCard,
      responseTimeMetric: isAwaiting ? null : layout.responseTimeMetric,
      telemetryPreview: context.stepCount > 0 ? layout.telemetryPreview : null,
      stepCount: context.stepCount,
    };
  }
}
