/*
 * The single source of truth for "how often may a monitor be checked".
 *
 * Everything that offers, stores or honours a monitoring interval reads this
 * file: the dashboard dropdowns, MonitorService / MonitorTemplateService write
 * validation, and the tests that prove the two can never drift apart. If the
 * dropdown offers a value this file would reject, the user gets a 400 from the
 * API - so the list and the validator deliberately live side by side.
 *
 * Intervals are cron expressions. Anything of a minute or coarser is a
 * standard 5-field expression and has been supported forever. Sub-minute
 * intervals are 6-field expressions with a leading seconds field
 * (`*\/10 * * * * *`), which both cron engines in the repo already parse:
 * cron-parser (Common/Server/Utils/CronTab.ts, used to compute nextPingAt) and
 * node-cron (Common/Server/Utils/BasicCron.ts, used to fire the probe's fetch
 * loop).
 *
 * Sub-minute intervals are restricted three ways, and all three are enforced
 * server-side because the dropdown is not a control - the API accepts a raw
 * cron string:
 *
 *  1. Self-hosted only. On a billing-enabled (SaaS) instance they are refused.
 *  2. An explicit allow-list of 10s / 20s / 30s. Not a "faster than 60s"
 *     range check: 10, 20 and 30 all divide 60 evenly, so `*\/N * * * * *`
 *     produces a uniform grid across the minute rollover. `*\/45 * * * * *`
 *     would alternate 45s and 15s gaps, and 1s/5s are simply too aggressive to
 *     serve reliably.
 *  3. Probe-monitored types only. Telemetry and infrastructure monitors are
 *     scheduled by a worker cron that ticks once a minute
 *     (ScheduleTelemetryMonitorEvaluations), so a sub-minute value there would
 *     be accepted, displayed, and then quietly honoured as 60 seconds.
 */

import CronTab from "../CronTab";
import {
  EVERY_TEN_SECONDS,
  EVERY_THIRTY_SECONDS,
  EVERY_TWENTY_SECONDS,
} from "../CronTime";
import MonitorType, {
  MonitorTypeHelper,
} from "../../Types/Monitor/MonitorType";

export interface MonitoringIntervalOption {
  value: string;
  label: string;
}

/*
 * The floor. Values faster than this are refused everywhere, including on
 * self-hosted instances and including through the API.
 */
export const MINIMUM_MONITORING_INTERVAL_IN_SECONDS: number = 10;

// Sorted fastest-first; these render above the minute+ options in the picker.
export const SubMinuteMonitoringIntervalOptions: Array<MonitoringIntervalOption> =
  [
    {
      value: EVERY_TEN_SECONDS,
      label: "Every 10 Seconds",
    },
    {
      value: EVERY_TWENTY_SECONDS,
      label: "Every 20 Seconds",
    },
    {
      value: EVERY_THIRTY_SECONDS,
      label: "Every 30 Seconds",
    },
  ];

export const MinuteAndAboveMonitoringIntervalOptions: Array<MonitoringIntervalOption> =
  [
    {
      value: "* * * * *",
      label: "Every Minute",
    },
    {
      value: "*/2 * * * *",
      label: "Every 2 Minutes",
    },
    {
      value: "*/5 * * * *",
      label: "Every 5 Minutes",
    },
    {
      value: "*/10 * * * *",
      label: "Every 10 Minutes",
    },
    {
      value: "*/15 * * * *",
      label: "Every 15 Minutes",
    },
    {
      value: "*/30 * * * *",
      label: "Every 30 Minutes",
    },
    {
      value: "0 * * * *",
      label: "Every Hour",
    },
    {
      value: "0 0 * * *",
      label: "Every Day",
    },
    {
      value: "0 0 * * 0",
      label: "Every Week",
    },
  ];

export const AllMonitoringIntervalOptions: Array<MonitoringIntervalOption> = [
  ...SubMinuteMonitoringIntervalOptions,
  ...MinuteAndAboveMonitoringIntervalOptions,
];

/*
 * Monitor types whose checks are too slow, or too expensive, to run more than
 * once every few minutes. The dashboard has always hidden "Every Minute" and
 * "Every 2 Minutes" for these; sub-minute follows the same rule.
 */
const SLOW_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.SyntheticMonitor,
  MonitorType.CustomJavaScriptCode,
  MonitorType.SSLCertificate,
];

/*
 * How many fire times to sample when measuring an expression's cadence. Four
 * is enough to see a full sub-minute grid including a minute rollover, and
 * cheap enough to run on every monitor write.
 */
const CADENCE_SAMPLE_COUNT: number = 4;

/*
 * A fixed, minute-aligned reference point. Measuring from a wall clock would
 * make getSmallestGapInSeconds non-deterministic for expressions whose gaps
 * are uneven (the first sampled gap depends on where in the grid "now" falls),
 * which in turn would make validation flaky.
 */
const CADENCE_REFERENCE_DATE: Date = new Date(Date.UTC(2020, 0, 1, 0, 0, 0, 0));

export default class MonitoringIntervalUtil {
  /**
   * The shortest gap between two consecutive fire times of the expression, in
   * seconds. Returns null when the expression is not a valid cron.
   *
   * The *shortest* gap, not the first: `*\/45 * * * * *` fires at :00 and :45,
   * so its gaps alternate 45s and 15s and it must be treated as a 15-second
   * interval, not a 45-second one.
   */
  public static getSmallestGapInSeconds(
    monitoringInterval: string,
  ): number | null {
    let fireTimes: Array<Date> = [];

    try {
      fireTimes = CronTab.getNextExecutionTimes(
        monitoringInterval,
        CADENCE_SAMPLE_COUNT,
        CADENCE_REFERENCE_DATE,
      );
    } catch {
      return null;
    }

    if (fireTimes.length < 2) {
      return null;
    }

    let smallestGapInSeconds: number | null = null;

    for (let i: number = 1; i < fireTimes.length; i++) {
      const gapInSeconds: number =
        (fireTimes[i]!.getTime() - fireTimes[i - 1]!.getTime()) / 1000;

      if (
        smallestGapInSeconds === null ||
        gapInSeconds < smallestGapInSeconds
      ) {
        smallestGapInSeconds = gapInSeconds;
      }
    }

    return smallestGapInSeconds;
  }

  /**
   * True when the expression fires more than once a minute - whether or not it
   * is one we are willing to accept.
   */
  public static isSubMinuteInterval(monitoringInterval: string): boolean {
    /*
     * A five-field cron has no seconds field, so its finest possible cadence
     * is once a minute. Answering from the field count means every existing
     * monitoring interval - which is all of them, on every write - skips the
     * fire-time walk entirely.
     */
    if (!this.hasSecondsField(monitoringInterval)) {
      return false;
    }

    const smallestGapInSeconds: number | null =
      this.getSmallestGapInSeconds(monitoringInterval);

    if (smallestGapInSeconds === null) {
      return false;
    }

    return smallestGapInSeconds < 60;
  }

  private static hasSecondsField(monitoringInterval: string): boolean {
    if (typeof monitoringInterval !== "string") {
      return false;
    }

    return monitoringInterval.trim().split(/\s+/).length === 6;
  }

  /**
   * True when the expression is one of the sub-minute intervals we support.
   */
  public static isSupportedSubMinuteInterval(
    monitoringInterval: string,
  ): boolean {
    return SubMinuteMonitoringIntervalOptions.some(
      (option: MonitoringIntervalOption) => {
        return option.value === monitoringInterval;
      },
    );
  }

  /**
   * Sub-minute intervals are only meaningful for monitors a probe actively
   * polls. Telemetry / infrastructure monitors are driven by a once-a-minute
   * worker cron, and the slow monitor types cannot finish a check that fast.
   */
  public static isMonitorTypeEligibleForSubMinuteInterval(
    monitorType: MonitorType,
  ): boolean {
    if (SLOW_MONITOR_TYPES.includes(monitorType)) {
      return false;
    }

    return MonitorTypeHelper.isProbableMonitor(monitorType);
  }

  /**
   * The human-readable label for a stored interval, looked up across every
   * option we have ever offered - never the gated subset. A monitor whose
   * interval was set on a self-hosted instance, or through the API, still has
   * to render something in the dashboard.
   */
  public static getLabel(monitoringInterval: string): string | null {
    const option: MonitoringIntervalOption | undefined =
      AllMonitoringIntervalOptions.find((option: MonitoringIntervalOption) => {
        return option.value === monitoringInterval;
      });

    return option?.label || null;
  }

  /**
   * The options to offer in a picker.
   *
   * `isSubMinuteAllowed` is the self-hosted gate and is supplied by the caller
   * (BILLING_ENABLED in the browser, IsBillingEnabled on the server) so this
   * module stays free of environment config and therefore unit-testable.
   */
  public static getOptions(data: {
    monitorType?: MonitorType | undefined;
    isSubMinuteAllowed: boolean;
  }): Array<MonitoringIntervalOption> {
    const isSubMinuteEligible: boolean =
      data.isSubMinuteAllowed &&
      Boolean(data.monitorType) &&
      this.isMonitorTypeEligibleForSubMinuteInterval(data.monitorType!);

    const options: Array<MonitoringIntervalOption> = [
      ...(isSubMinuteEligible ? SubMinuteMonitoringIntervalOptions : []),
      ...MinuteAndAboveMonitoringIntervalOptions,
    ];

    if (data.monitorType && SLOW_MONITOR_TYPES.includes(data.monitorType)) {
      return options.filter((option: MonitoringIntervalOption) => {
        return option.value !== "* * * * *" && option.value !== "*/2 * * * *";
      });
    }

    return options;
  }

  /**
   * The write-time validator. Returns a user-facing message when the interval
   * may not be stored, or null when it may.
   *
   * An absent interval is allowed - the column is nullable and existing
   * monitors created before it was required still have no value.
   */
  public static getValidationError(data: {
    monitoringInterval?: string | undefined | null;
    monitorType?: MonitorType | undefined | null;
    isBillingEnabled: boolean;
  }): string | null {
    const monitoringInterval: string | undefined | null =
      data.monitoringInterval;

    if (!monitoringInterval) {
      return null;
    }

    if (!CronTab.isValid(monitoringInterval)) {
      return `Invalid monitoring interval: ${monitoringInterval}`;
    }

    // Everything a minute or coarser has always been allowed, unconditionally.
    if (!this.isSubMinuteInterval(monitoringInterval)) {
      return null;
    }

    if (data.isBillingEnabled) {
      return "Sub-minute monitoring intervals are only available on self-hosted OneUptime instances.";
    }

    if (!this.isSupportedSubMinuteInterval(monitoringInterval)) {
      return `Sub-minute monitoring intervals must be one of: ${SubMinuteMonitoringIntervalOptions.map(
        (option: MonitoringIntervalOption) => {
          return option.label.toLowerCase();
        },
      ).join(
        ", ",
      )}. The fastest supported interval is ${MINIMUM_MONITORING_INTERVAL_IN_SECONDS} seconds.`;
    }

    if (
      data.monitorType &&
      !this.isMonitorTypeEligibleForSubMinuteInterval(data.monitorType)
    ) {
      return `${data.monitorType} monitors do not support sub-minute monitoring intervals. Please choose an interval of one minute or more.`;
    }

    return null;
  }
}
