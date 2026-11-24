import SliType from "../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";
import { fillTemplate, translationKey } from "../../Types/Translator";
import {
  SloMetricKind,
  getSloMetricQueryProblem,
  normalizeSloMetricQueryConfig,
} from "./SloMetricSli";
import { isEventSliType } from "./SloRequestSli";

/**
 * The "should I be worried, and about what?" layer of the SLO UI.
 *
 * Two things live here, both pure and both previously inlined (and
 * subtly wrong) in the React pages:
 *
 * 1. The remaining-budget tier that drives every red/amber/green in the
 *    SLO surfaces. The pages hardcoded `remaining <= 20`, which silently
 *    disagreed with any SLO whose `atRiskThresholdPercentage` was not the
 *    default 20 — an SLO could render green while the worker had already
 *    moved it to At Risk.
 *
 * 2. The reason an SLO is not producing numbers. `Misconfigured` and
 *    `Paused` are the two statuses that mean "we are not measuring
 *    anything", and the pages showed them as a bare grey pill with no
 *    explanation and no way to act. The reasons here mirror exactly the
 *    guard clauses in the evaluation worker (EvaluateSlos.evaluateSlo).
 *
 * Kept free of React so both the SLO pages and the dashboard SLO widget
 * can import it, and so every branch is unit-testable without a DOM.
 */

/** The DB default for `ServiceLevelObjective.atRiskThresholdPercentage`. */
export const DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE: number = 20;

/** The DB default for `ServiceLevelObjective.windowDays`. */
export const DEFAULT_ROLLING_WINDOW_DAYS: number = 30;

export enum SloBudgetTier {
  /** The worker has not evaluated this SLO yet — assert nothing. */
  Unknown = "Unknown",
  Healthy = "Healthy",
  AtRisk = "AtRisk",
  Exhausted = "Exhausted",
}

type ToFiniteNumberFunction = (
  value: number | undefined | null,
) => number | null;

const toFiniteNumber: ToFiniteNumberFunction = (
  value: number | undefined | null,
): number | null => {
  if (typeof value !== "number" || !isFinite(value)) {
    return null;
  }

  return value;
};

/**
 * Tier from the SIGNED remaining-budget percentage, using the SLO's own
 * at-risk threshold rather than a hardcoded 20.
 *
 * Boundaries match SloUtil.computeSloStatus (`<= 0` is exhausted, `<=
 * threshold` is at risk) so the colour never contradicts the status pill
 * the worker computed. The hysteresis SloUtil applies is deliberately NOT
 * reproduced here: this function colours a number the user is looking at,
 * and hysteresis depends on the previous status, which is not part of
 * "what does this number mean".
 */
export type GetSloBudgetTierFunction = (data: {
  errorBudgetRemainingPercentage: number | undefined | null;
  atRiskThresholdPercentage?: number | undefined | null;
}) => SloBudgetTier;

export const getSloBudgetTier: GetSloBudgetTierFunction = (data: {
  errorBudgetRemainingPercentage: number | undefined | null;
  atRiskThresholdPercentage?: number | undefined | null;
}): SloBudgetTier => {
  const remaining: number | null = toFiniteNumber(
    data.errorBudgetRemainingPercentage,
  );

  if (remaining === null) {
    return SloBudgetTier.Unknown;
  }

  if (remaining <= 0) {
    return SloBudgetTier.Exhausted;
  }

  const threshold: number =
    toFiniteNumber(data.atRiskThresholdPercentage) ??
    DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE;

  if (remaining <= threshold) {
    return SloBudgetTier.AtRisk;
  }

  return SloBudgetTier.Healthy;
};

export enum SloNoticeType {
  Info = "Info",
  Warning = "Warning",
  Danger = "Danger",
}

/**
 * Where a notice's call to action leads. Named by destination rather than
 * carrying a route: this module is imported by plain-node tests and by the
 * dashboard SLO widget, and RouteMap reads `window` at module load. The
 * banner, which already lives in the Dashboard, turns a target into a link.
 *
 * One target is not a page: TurnEvaluationOn is done where the notice is.
 * The banner draws it as a button that saves what the Evaluation card's
 * switch on Settings saves, so a disabled SLO is turned back on in one
 * press instead of a trip to Settings.
 */
export enum SloNoticeActionTarget {
  Settings = "settings",
  Monitors = "monitors",
  MonitorRules = "monitor-rules",
  TurnEvaluationOn = "turn-evaluation-on",
}

export interface SloNoticeAction {
  /** Short link text naming what the user will do there. */
  label: string;
  target: SloNoticeActionTarget;
}

/** A figure a notice's sentence states, written in the reader's digits. */
export interface SloNoticeFigure {
  value: number;
  isPercent: boolean;
}

/*
 * A notice's title, body and action label are translation keys: the banner
 * looks each up in the reader's language (the title through AlertBanner).
 * Here they are English, as plain-node tests and the docs read them.
 */
export interface SloNotice {
  type: SloNoticeType;
  title: string;
  /** One sentence of "here is what to do about it". */
  body: string;
  /*
   * When the body states figures: the same sentence as a template, and its
   * figures, so the banner words the sentence and writes each figure the
   * reader's way ("99,9" in German, "۹۹٫۹" in Persian). `body` is the
   * template filled in, in English.
   */
  bodyTemplate?: string | undefined;
  bodyFigures?: Record<string, SloNoticeFigure> | undefined;
  /**
   * The page where the user can fix it. Absent when there is nothing to
   * do but wait, or when no page in the product can fix it.
   */
  action?: SloNoticeAction | undefined;
}

/**
 * The fields a notice can be derived from. Declared structurally rather
 * than importing the database model so this stays dependency-free and
 * tests can pass plain objects.
 */
export interface SloNoticeData {
  isArchived?: boolean | undefined | null;
  isEnabled?: boolean | undefined | null;
  sloStatus?: SloStatus | undefined | null;
  sliType?: SliType | undefined | null;
  /** Number of monitors currently attached. */
  monitorCount?: number | undefined | null;
  /** A request SLO's services: how many are chosen. */
  serviceCount?: number | undefined | null;
  /** A Request Latency SLO's threshold, in milliseconds. */
  latencyThresholdInMilliseconds?: number | undefined | null;
  /** A Metric SLO's metric (#8445), as stored. */
  metricQueryConfig?: unknown;
  /*
   * The kind of point its metric's newest one is (Metric.metricPointType:
   * "Sum", "Histogram", "Gauge"...), where the page read it: a gauge has
   * no events to count (#10027). Unknown counts as countable.
   */
  metricPointType?: string | undefined | null;
  /** Of the attached monitors, how many have active monitoring disabled. */
  disabledMonitorCount?: number | undefined | null;
  /*
   * Whether nothing has checked the attached monitors that are not paused
   * yet (SloMonitorsFirstCheck.areSloMonitorsWaitingForFirstCheck), the
   * reason the worker gives a Monitor Uptime SLO it marks Misconfigured for
   * measuring no time (#9089). Unknown counts as no.
   */
  isWaitingForFirstCheck?: boolean | undefined | null;
  targetPercentage?: number | undefined | null;
  lastEvaluatedAt?: Date | string | undefined | null;
}

/*
 * The target's limits and an example, as figures of the sentence: a reader
 * writes "greater than 0" and "99.9" in their own digits.
 */
export const SLO_TARGET_OUT_OF_RANGE_BODY_TEMPLATE: string = translationKey(
  "A target must be greater than {{min}} and less than {{max}} — a {{fullTarget}} target leaves no error budget to track. Set a target such as {{exampleTarget}} in Settings.",
);

export const SLO_TARGET_OUT_OF_RANGE_FIGURES: Record<string, SloNoticeFigure> =
  {
    min: { value: 0, isPercent: false },
    max: { value: 100, isPercent: false },
    fullTarget: { value: 100, isPercent: true },
    exampleTarget: { value: 99.9, isPercent: false },
  };

const SLO_TARGET_OUT_OF_RANGE_ENGLISH_VALUES: Record<string, string> = {
  min: "0",
  max: "100",
  fullTarget: "100%",
  exampleTarget: "99.9",
};

type GetNoMonitorsNoticeFunction = () => SloNotice;

const getNoMonitorsNotice: GetNoMonitorsNoticeFunction = (): SloNotice => {
  return {
    type: SloNoticeType.Warning,
    title: translationKey("No monitors attached"),
    body: translationKey(
      "An SLO measures uptime from its monitors, so it cannot be evaluated without at least one. Attach monitors on the Monitors page, or add a monitor rule that attaches matching monitors for you.",
    ),
    action: {
      label: translationKey("Attach monitors"),
      target: SloNoticeActionTarget.Monitors,
    },
  };
};

/*
 * Nothing has checked the SLO's monitors yet (#9089, #9354): a monitor
 * created a minute ago, or a self-hosted probe not connected yet. The SLO is
 * set up right, and is measured from their first check, so it says so
 * rather than sending the owner to look for a mistake.
 */
type GetWaitingForFirstCheckNoticeFunction = () => SloNotice;

const getWaitingForFirstCheckNotice: GetWaitingForFirstCheckNoticeFunction =
  (): SloNotice => {
    return {
      type: SloNoticeType.Info,
      title: translationKey("Waiting for the first check"),
      body: translationKey(
        "Nothing has checked this SLO's monitors yet. It is measured from their first check.",
      ),
      action: {
        label: translationKey("View monitors"),
        target: SloNoticeActionTarget.Monitors,
      },
    };
  };

type GetNoServicesNoticeFunction = (
  sliType: SliType | undefined | null,
) => SloNotice;

const getNoServicesNotice: GetNoServicesNoticeFunction = (
  sliType: SliType | undefined | null,
): SloNotice => {
  return {
    type: SloNoticeType.Warning,
    title: translationKey("No services chosen"),
    body:
      sliType === SliType.Metric
        ? translationKey(
            "A Metric SLO measures the metric its services send, so it cannot be evaluated without at least one. Choose its services in Settings.",
          )
        : translationKey(
            "A request SLO measures the requests its services serve, so it cannot be evaluated without at least one. Choose its services in Settings.",
          ),
    action: {
      label: translationKey("Choose services"),
      target: SloNoticeActionTarget.Settings,
    },
  };
};

/*
 * A Metric SLO with no metric it can count (#8445): none chosen yet, or one
 * stored before a rule tightened. The worker counts nothing until it is
 * fixed (EvaluateSlos.getRequestSloMisconfiguredReason).
 */
type GetNoMetricNoticeFunction = () => SloNotice;

const getNoMetricNotice: GetNoMetricNoticeFunction = (): SloNotice => {
  return {
    type: SloNoticeType.Warning,
    title: translationKey("No metric to count"),
    body: translationKey(
      "A Metric SLO counts good and total events from a counter or a histogram its services send. Choose the metric, and how its good events are told apart, in Settings.",
    ),
    action: {
      label: translationKey("Choose the metric"),
      target: SloNoticeActionTarget.Settings,
    },
  };
};

/*
 * The kinds of point a Metric SLO counts (SloMetricCounting): a counter's
 * Sum points, a histogram's Histogram points. A gauge, a summary or an
 * exponential histogram of the same name counts nothing.
 */
export const SLO_COUNTABLE_METRIC_POINT_TYPES: ReadonlyArray<string> = [
  "Sum",
  "Histogram",
];

export const SLO_GAUGE_METRIC_POINT_TYPE: string = "Gauge";

// The kind of point each kind of Metric SLO counts (SloMetricCounting).
export const SLO_METRIC_KIND_POINT_TYPES: Readonly<
  Record<SloMetricKind, string>
> = {
  [SloMetricKind.Counter]: "Sum",
  [SloMetricKind.Histogram]: "Histogram",
};

/*
 * A Metric SLO waiting for events its metric's points cannot hold (#10027):
 * a gauge - every cloud metric OneUptime reads is one - is a level read now
 * and then, not events; a summary or an exponential histogram has no
 * buckets the counting reads; and a counter counted as a histogram, or a
 * histogram as a counter, has none of the points its kind counts. It would
 * wait for ever, so it says why, and what measures it instead. Null when
 * its metric's kind is the one it counts, or not known.
 */
type GetUncountableMetricNoticeFunction = (data: {
  metricPointType: string | undefined | null;
  metricQueryConfig: unknown;
}) => SloNotice | null;

const getUncountableMetricNotice: GetUncountableMetricNoticeFunction = (data: {
  metricPointType: string | undefined | null;
  metricQueryConfig: unknown;
}): SloNotice | null => {
  const metricPointType: string | undefined | null = data.metricPointType;
  const kind: SloMetricKind | undefined = normalizeSloMetricQueryConfig(
    data.metricQueryConfig,
  )?.kind;

  if (!metricPointType) {
    return null;
  }

  if (SLO_COUNTABLE_METRIC_POINT_TYPES.includes(metricPointType)) {
    // Counted as the kind it is, or as no kind yet: its setup says so.
    if (!kind || SLO_METRIC_KIND_POINT_TYPES[kind] === metricPointType) {
      return null;
    }

    return kind === SloMetricKind.Counter
      ? {
          type: SloNoticeType.Warning,
          title: translationKey(
            "Its metric is a histogram, counted as a counter",
          ),
          body: translationKey(
            'This SLO counts what its metric grew by, as a counter\'s events are counted, and its metric is a histogram, which has none of them. Choose "A histogram, by a value" under Good Events in Settings.',
          ),
          action: {
            label: translationKey("Open Settings"),
            target: SloNoticeActionTarget.Settings,
          },
        }
      : {
          type: SloNoticeType.Warning,
          title: translationKey(
            "Its metric is a counter, counted as a histogram",
          ),
          body: translationKey(
            "This SLO counts its metric's observations at or under a value, as a histogram's are counted, and its metric is a counter, which has none of them. Choose \"A counter, by a condition\" under Good Events in Settings.",
          ),
          action: {
            label: translationKey("Open Settings"),
            target: SloNoticeActionTarget.Settings,
          },
        };
  }

  if (metricPointType === SLO_GAUGE_METRIC_POINT_TYPE) {
    return {
      type: SloNoticeType.Warning,
      title: translationKey("Its metric is a gauge, which cannot be counted"),
      body: translationKey(
        "A Metric SLO counts the events of a counter or a histogram, and a gauge is a level read now and then, with no events in it. Every cloud metric OneUptime reads is a gauge. To measure one, create a metric monitor on it and choose monitor uptime as what this SLO measures, or choose a counter or a histogram your services send.",
      ),
      action: {
        label: translationKey("Open Settings"),
        target: SloNoticeActionTarget.Settings,
      },
    };
  }

  return {
    type: SloNoticeType.Warning,
    title: translationKey("Its metric cannot be counted"),
    body: translationKey(
      "A Metric SLO counts the events of a counter or an explicit-bucket histogram, and its metric is neither: a summary or an exponential histogram has no buckets to count from. Choose a counter or a histogram your services send in Settings.",
    ),
    action: {
      label: translationKey("Open Settings"),
      target: SloNoticeActionTarget.Settings,
    },
  };
};

/*
 * What stops a request SLO (Request Success, Request Latency) from being
 * measured, in the order a person fixes it - the worker's own guards
 * (EvaluateSlos.getRequestSloMisconfiguredReason) - or null when nothing in
 * its setup does.
 */
type GetRequestSetupNoticeFunction = (data: SloNoticeData) => SloNotice | null;

const getRequestSetupNotice: GetRequestSetupNoticeFunction = (
  data: SloNoticeData,
): SloNotice | null => {
  if ((toFiniteNumber(data.serviceCount) ?? 0) === 0) {
    return getNoServicesNotice(data.sliType);
  }

  if (
    data.sliType === SliType.Metric &&
    getSloMetricQueryProblem(
      normalizeSloMetricQueryConfig(data.metricQueryConfig),
    ) !== null
  ) {
    return getNoMetricNotice();
  }

  const threshold: number | null = toFiniteNumber(
    data.latencyThresholdInMilliseconds,
  );

  if (
    data.sliType === SliType.RequestLatency &&
    (threshold === null || threshold < 1)
  ) {
    return {
      type: SloNoticeType.Warning,
      title: translationKey("No latency threshold"),
      body: translationKey(
        "A Request Latency SLO counts a request as good when it is served within its latency threshold. Set the threshold in Settings.",
      ),
      action: {
        label: translationKey("Set the threshold"),
        target: SloNoticeActionTarget.Settings,
      },
    };
  }

  return null;
};

/**
 * The single most important thing to tell the user about this SLO right
 * now, or null when the SLO is measuring normally.
 *
 * Ordered by how completely each condition stops the SLO from producing
 * numbers, so the banner always names the root cause rather than a
 * downstream symptom: a disabled SLO is not evaluated at all, so saying
 * "no monitors attached" would send the user to fix the wrong thing.
 * Archived comes before disabled for the same reason — turning evaluation
 * back on does not bring an SLO out of the archive, so it would still
 * measure nothing.
 *
 * Every branch mirrors a guard in the evaluation worker
 * (App/FeatureSet/Workers/Jobs/Slo/EvaluateSlos.ts):
 *   isArchived=true      -> the SLO is skipped entirely by getDueSlos()
 *   isEnabled=false      -> the SLO is skipped entirely by getDueSlos()
 *   sliType is Metric    -> Misconfigured (Metric SLIs are not built yet)
 *   request SLI with no services, or a latency SLI with no threshold,
 *   or no requests in its window -> Misconfigured
 *   monitorCount == 0    -> Misconfigured
 *   target outside (0,100) -> Misconfigured
 *   no time measured, nothing has checked its monitors yet -> Waiting,
 *                           said as "Waiting for the first check" (and so is
 *                           an SLO stored as Misconfigured for that reason
 *                           before Waiting existed, until its next evaluation)
 *   all monitors disabled -> Paused
 */
export type GetSloNoticeFunction = (data: SloNoticeData) => SloNotice | null;

export const getSloNotice: GetSloNoticeFunction = (
  data: SloNoticeData,
): SloNotice | null => {
  if (data.isArchived === true) {
    return {
      type: SloNoticeType.Info,
      title: translationKey("This SLO is archived"),
      body: translationKey(
        "Archived SLOs are hidden from the SLO list and are not evaluated, so its numbers are frozen and its burn rate rules will not fire. Unarchive it in Settings to resume measuring.",
      ),
      action: {
        label: translationKey("Open Settings"),
        target: SloNoticeActionTarget.Settings,
      },
    };
  }

  if (data.isEnabled === false) {
    return {
      type: SloNoticeType.Info,
      title: translationKey("This SLO is disabled"),
      body: translationKey(
        "It is not being evaluated and its burn rate rules will not fire alerts. Turn evaluation back on to resume measuring.",
      ),
      action: {
        label: translationKey("Turn evaluation on"),
        target: SloNoticeActionTarget.TurnEvaluationOn,
      },
    };
  }

  const monitorCount: number = toFiniteNumber(data.monitorCount) ?? 0;

  // Counted in events, from traces or from a metric (#8445).
  const isRequestSli: boolean = isEventSliType(data.sliType);

  /*
   * The status of its own the worker gives an SLO whose monitors nothing
   * has checked yet (#9354): the same notice an SLO it stored as
   * Misconfigured for that reason, before that status existed, gets below.
   */
  if (data.sloStatus === SloStatus.Waiting) {
    return getWaitingForFirstCheckNotice();
  }

  if (data.sloStatus === SloStatus.Misconfigured) {
    // The SLI type is chosen in Settings, What It Measures.
    if (
      data.sliType &&
      data.sliType !== SliType.MonitorUptime &&
      !isRequestSli
    ) {
      return {
        type: SloNoticeType.Warning,
        title: translationKey("This SLO cannot be evaluated"),
        body: translationKey(
          "OneUptime does not measure this SLI type. Choose what this SLO measures in Settings: monitor uptime, request success, request latency or a metric.",
        ),
        action: {
          label: translationKey("Open Settings"),
          target: SloNoticeActionTarget.Settings,
        },
      };
    }

    if (isRequestSli) {
      const setupNotice: SloNotice | null = getRequestSetupNotice(data);

      if (setupNotice) {
        return setupNotice;
      }
    } else if (monitorCount === 0) {
      return getNoMonitorsNotice();
    }

    const target: number | null = toFiniteNumber(data.targetPercentage);

    if (target === null || target <= 0 || target >= 100) {
      return {
        type: SloNoticeType.Warning,
        title: translationKey("The target is out of range"),
        body: fillTemplate(
          SLO_TARGET_OUT_OF_RANGE_BODY_TEMPLATE,
          SLO_TARGET_OUT_OF_RANGE_ENGLISH_VALUES,
        ),
        bodyTemplate: SLO_TARGET_OUT_OF_RANGE_BODY_TEMPLATE,
        bodyFigures: SLO_TARGET_OUT_OF_RANGE_FIGURES,
        action: {
          label: translationKey("Edit objective"),
          target: SloNoticeActionTarget.Settings,
        },
      };
    }

    /*
     * A request SLO whose services have served no request in its window yet
     * - a quiet service, or one whose traces do not reach OneUptime.
     */
    if (data.sliType === SliType.Metric) {
      /*
       * Its metric's points are of a kind the counting reads none of: it
       * waits for ever (#10027). Every cloud metric is a gauge.
       */
      const uncountable: SloNotice | null = getUncountableMetricNotice({
        metricPointType: data.metricPointType,
        metricQueryConfig: data.metricQueryConfig,
      });

      if (uncountable) {
        return uncountable;
      }

      return {
        type: SloNoticeType.Info,
        title: translationKey("Waiting for its metric"),
        body: translationKey(
          "None of this SLO's services has sent an event of its metric in its window yet. It is measured automatically once the metric reaches OneUptime.",
        ),
        action: {
          label: translationKey("View services"),
          target: SloNoticeActionTarget.Settings,
        },
      };
    }

    if (isRequestSli) {
      return {
        type: SloNoticeType.Info,
        title: translationKey("Waiting for requests"),
        body: translationKey(
          "None of this SLO's services has served a request in its window yet. It is measured automatically once their traces reach OneUptime.",
        ),
        action: {
          label: translationKey("View services"),
          target: SloNoticeActionTarget.Settings,
        },
      };
    }

    /*
     * Nothing has checked its monitors yet (#9089), on an SLO the worker
     * stored as Misconfigured for it before it had Waiting (#9354): its
     * next evaluation moves it to Waiting, and it says so already.
     */
    if (data.isWaitingForFirstCheck === true) {
      return getWaitingForFirstCheckNotice();
    }

    /*
     * Monitors may have been attached since the last evaluation, or the
     * worker may still be waiting for their status data. A stored
     * Misconfigured status alone does not mean the current setup is wrong.
     * Keep the monitor link so users can check data that is still missing.
     */
    return {
      type: SloNoticeType.Info,
      title: translationKey("Waiting for SLO evaluation"),
      body: translationKey(
        "Monitors are attached. OneUptime evaluates this SLO every few minutes. Results will appear once monitor status data is available and the next evaluation completes.",
      ),
      action: {
        label: translationKey("View monitors"),
        target: SloNoticeActionTarget.Monitors,
      },
    };
  }

  if (data.sloStatus === SloStatus.Paused) {
    return {
      type: SloNoticeType.Info,
      title: translationKey("Measurement is paused"),
      body: translationKey(
        "Every monitor attached to this SLO has active monitoring disabled — by hand, by a manual incident, or by a maintenance event — so there is no signal to measure. The SLO resumes automatically when a monitor starts reporting again.",
      ),
      action: {
        label: translationKey("View monitors"),
        target: SloNoticeActionTarget.Monitors,
      },
    };
  }

  if (!data.lastEvaluatedAt) {
    /*
     * The create form no longer picks monitors, so a brand-new SLO starts
     * with none, and the worker's first pass will mark it Misconfigured for
     * exactly that reason. Saying so now, instead of "numbers will appear
     * shortly", points the user at the one step that makes numbers appear.
     * Only an explicit, loaded 0 counts: a caller that did not select the
     * monitors has not told us anything.
     */
    if (isRequestSli) {
      const setupNotice: SloNotice | null =
        data.serviceCount === undefined || data.serviceCount === null
          ? null
          : getRequestSetupNotice(data);

      if (setupNotice) {
        return setupNotice;
      }
    } else if (toFiniteNumber(data.monitorCount) === 0) {
      return getNoMonitorsNotice();
    }

    return {
      type: SloNoticeType.Info,
      title: translationKey("Not evaluated yet"),
      body: translationKey(
        "OneUptime evaluates SLOs every few minutes. The first numbers will appear shortly after this SLO is created.",
      ),
    };
  }

  return null;
};

/**
 * True when a rolling-window SLO is younger than its own window, so the
 * budget it is measuring against is smaller than the full-window budget.
 *
 * The SLI denominator is clamped forward to the earliest monitor event
 * (SloUtil.computeAnyDownSli), which means `errorBudgetTotalSeconds` for a
 * young SLO is proportionally short — a 30-day SLO with a week of data
 * carries a 7-day budget. Both the SLOs Overview and the Error Budgets
 * doc promise the dashboard flags this as "window not yet full"; this is
 * the detection behind that flag.
 *
 * Two cases are excluded on purpose:
 *
 * - Calendar-month windows: their budget is fixed at the FULL period from
 *   day one (never prorated), so the concept does not apply.
 *
 * - Monitor Seconds Average: its denominator is the SUM of monitored
 *   seconds ACROSS monitors (SloUtil.computeMonitorSecondsAverageSli), so
 *   `errorBudgetTotalSeconds` scales with the monitor count and cannot be
 *   compared against a single-window budget. A five-monitor SLO with a
 *   week of data would carry 35 monitor-days against a 30-day yardstick
 *   and read as mature. Rather than guess at a monitor count the caller
 *   may not have loaded, say nothing — a missing hint beats a wrong one.
 *
 * The 1% tolerance absorbs the gap between "now" and the worker's last
 * evaluation — without it, a fully mature SLO would flicker the flag on
 * every evaluation cycle.
 */
const WINDOW_FULL_TOLERANCE_FRACTION: number = 0.99;

export type IsRollingWindowNotYetFullFunction = (data: {
  windowType?: SloWindowType | undefined | null;
  windowDays?: number | undefined | null;
  targetPercentage?: number | undefined | null;
  errorBudgetTotalSeconds?: number | undefined | null;
  multiMonitorMode?: SloMultiMonitorMode | undefined | null;
}) => boolean;

export const isRollingWindowNotYetFull: IsRollingWindowNotYetFullFunction =
  (data: {
    windowType?: SloWindowType | undefined | null;
    windowDays?: number | undefined | null;
    targetPercentage?: number | undefined | null;
    errorBudgetTotalSeconds?: number | undefined | null;
    multiMonitorMode?: SloMultiMonitorMode | undefined | null;
  }): boolean => {
    if (data.windowType === SloWindowType.CalendarMonth) {
      return false;
    }

    if (data.multiMonitorMode === SloMultiMonitorMode.MonitorSecondsAverage) {
      return false;
    }

    const budgetTotalSeconds: number | null = toFiniteNumber(
      data.errorBudgetTotalSeconds,
    );
    const target: number | null = toFiniteNumber(data.targetPercentage);

    /*
     * Not evaluated yet, or a target that would make the full-window budget
     * meaningless: the "not evaluated" notice already covers the first case,
     * and the Misconfigured notice covers the second.
     */
    if (
      budgetTotalSeconds === null ||
      budgetTotalSeconds <= 0 ||
      target === null ||
      target <= 0 ||
      target >= 100
    ) {
      return false;
    }

    const windowDays: number =
      toFiniteNumber(data.windowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS;

    if (windowDays <= 0) {
      return false;
    }

    const fullWindowBudgetSeconds: number =
      (1 - target / 100) * windowDays * 24 * 60 * 60;

    return (
      budgetTotalSeconds <
      fullWindowBudgetSeconds * WINDOW_FULL_TOLERANCE_FRACTION
    );
  };
