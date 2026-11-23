import EvaluateOverTime from "./EvaluateOverTime";
import CriteriaFilterMatchHistory, {
  CriteriaFilterCheck,
  CriteriaFilterMatchHistoryReads,
} from "./CriteriaFilterMatchHistory";
import WindowCoverage from "./WindowCoverage";
import MetricService, {
  MonitorCheckComparison,
  MonitorCheckCondition,
  MonitorCheckSummaryRow,
} from "../../../Services/MetricService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";
import OneUptimeDate from "../../../../Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
  CRITERIA_FILTER_MATCHED_VALUE,
} from "../../../../Types/Monitor/CriteriaFilterMatchHistory";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import MonitorMetricTypeUtil from "../../../../Utils/Monitor/MonitorMetricType";

/**
 * COUNTING A WINDOW'S CHECKS (#10355).
 *
 * "All Values" and "Any Value" say whether every check of a window matched,
 * or one did. They cannot tell a device that is down from one that keeps
 * going down and coming back: both have failed checks, and neither has
 * failed every one. Counting tells them apart. A criteria filter judged over
 * a window can count:
 *
 *   - Count: how many of the window's checks its condition matched - "more
 *     than 30 checks where Is Online is False in the last 8 hours".
 *   - Percentage: what share of the window's checks it matched, in %.
 *   - Status Changes: how many times it changed between matching and not
 *     matching from one check to the next - how often a device went down or
 *     came back up. Flapping.
 *
 * The filter's own condition says which checks count (Is Online is False,
 * Response Time is greater than 300), and countFilterType and countValue
 * how many it takes (Greater Than 30).
 *
 * WHAT IS COUNTED
 *
 * Every check a monitor makes writes its values as series (MonitorMetricUtil):
 * the 1 or 0 of Is Online, the response time, the status code, a server's
 * CPU. A check nothing records as a series - a response body, a header, a
 * JavaScript expression - keeps a match history instead, a 1 or 0 for the
 * filter on each check (CriteriaFilterMatchHistory). Either is counted the
 * same way: in the database, one statement per filter and window, grouped by
 * probe - and by disk, for a disk's usage - and handed back as a row a group
 * (MetricService.summarizeMonitorChecks). A window of a day of checks every
 * 30 seconds from five probes is 14,400 rows read in place, not sent.
 *
 * Each probe's checks are counted on their own: a monitor checked from three
 * probes would otherwise count three times as fast, and its probes' checks,
 * interleaved, would read as a status change at every check. The monitor's
 * probes then agree as for any criteria. A monitor no probe checks (a
 * server, a probe status monitor) has one group.
 *
 * THIS CHECK
 *
 * A series row is written before the check is judged, and a monitor that
 * counts checks writes it before going on (MonitorResource asks
 * saveMonitorMetrics to wait until it can be read): the count includes the
 * check being judged, read from the database like the rest. A match history
 * row is written only after the check is judged, so this check's match is
 * counted from memory, as All Values counts it - unless it is a check read
 * back for probe agreement, whose row was written when it arrived.
 *
 * WHEN THE WINDOW IS NOT FULL YET
 *
 * A window whose checks do not reach back to its start - a monitor that only
 * just started, a probe that was just added - holds fewer checks than it
 * will. A count of it is judged as it stands only when more checks cannot
 * change the answer: a Count or Status Changes already above "more than 30"
 * stays above it. Anything else waits for the checks to cover the window,
 * and meanwhile its If No Data setting decides: Ignore waits, Trigger
 * matches, and Treat As Zero judges the window as if the checks it lacks
 * had not matched.
 */

// What a filter's counted window came to, for the evaluation log.
export interface CheckWindowJudgement {
  // Set exactly when the filter is met.
  rootCause: string | null;
  message: string;
}

// Where a filter's checks are counted from.
export interface CheckWindowSource {
  metricName: string;
  // Rows whose attribute has this value: a match history's filter key.
  attributes: Record<string, string>;
  // The attributes a group is one value of.
  groupByAttributeKeys: Array<string>;
  condition: MonitorCheckCondition;
  // A match history, whose rows are written after the check is judged.
  isMatchHistory: boolean;
}

// The window's checks, counted, for one probe (and one disk).
export interface CheckWindowTally {
  checkCount: number;
  matchCount: number;
  changeCount: number;
  firstAt: Date | null;
  lastAt: Date | null;
  lastMatched: boolean | null;
}

const PROBE_ID_ATTRIBUTE: string = "probeId";
const DISK_PATH_ATTRIBUTE: string = "diskPath";

const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

export default class CheckWindowCounts {
  /*
   * Where this filter's checks are counted from, and which of them match:
   * its match history on a monitor that keeps one for it, else the series
   * its check writes. Null when neither can say which checks match - a
   * condition no number can be compared with.
   */
  public static getSource(data: {
    criteriaFilter: CriteriaFilter;
    monitorType: MonitorType | undefined;
    monitorStepId: ObjectID | string;
  }): CheckWindowSource | null {
    if (
      CriteriaFilterUtil.hasMatchHistory({
        checkOn: data.criteriaFilter.checkOn,
        monitorType: data.monitorType,
      })
    ) {
      return {
        metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
        attributes: {
          [CRITERIA_FILTER_KEY_ATTRIBUTE]: CriteriaFilterMatchHistory.getFilterKey(
            {
              monitorStepId: data.monitorStepId,
              criteriaFilter: data.criteriaFilter,
            },
          ),
        },
        groupByAttributeKeys: [PROBE_ID_ATTRIBUTE],
        condition: {
          comparison: "eq",
          threshold: CRITERIA_FILTER_MATCHED_VALUE,
        },
        isMatchHistory: true,
      };
    }

    const metricName: MonitorMetricType | null =
      MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
        data.criteriaFilter,
      );

    if (!metricName) {
      return null;
    }

    const condition: MonitorCheckCondition | null =
      CheckWindowCounts.getSeriesCondition(data.criteriaFilter);

    if (!condition) {
      return null;
    }

    return {
      metricName: metricName,
      attributes: {},
      /*
       * Every disk's usage is one series: each disk is a group of its own,
       * read in the one statement with the others.
       */
      groupByAttributeKeys:
        data.criteriaFilter.checkOn === CheckOn.DiskUsagePercent
          ? [PROBE_ID_ATTRIBUTE, DISK_PATH_ATTRIBUTE]
          : [PROBE_ID_ATTRIBUTE],
      condition: condition,
      isMatchHistory: false,
    };
  }

  /*
   * The filter's condition as a comparison of a series row's value: a
   * number compared with the filter's value, or a 1 / 0 series read as true
   * or false the way the over-time window reads it (a row is true when its
   * value is 1). Null for a condition that compares no number.
   */
  public static getSeriesCondition(
    criteriaFilter: CriteriaFilter,
  ): MonitorCheckCondition | null {
    if (CriteriaFilterUtil.isBooleanSeries(criteriaFilter.checkOn)) {
      if (criteriaFilter.filterType === FilterType.True) {
        return { comparison: "eq", threshold: 1 };
      }

      if (criteriaFilter.filterType === FilterType.False) {
        return { comparison: "ne", threshold: 1 };
      }

      return null;
    }

    const comparison: MonitorCheckComparison | null =
      CheckWindowCounts.toComparison(criteriaFilter.filterType);

    if (!comparison) {
      return null;
    }

    const threshold: number = Number(criteriaFilter.value);

    if (
      criteriaFilter.value === undefined ||
      criteriaFilter.value === null ||
      String(criteriaFilter.value).trim() === "" ||
      !Number.isFinite(threshold)
    ) {
      return null;
    }

    return { comparison: comparison, threshold: threshold };
  }

  private static toComparison(
    filterType: FilterType | undefined,
  ): MonitorCheckComparison | null {
    switch (filterType) {
      case FilterType.GreaterThan:
        return "gt";
      case FilterType.GreaterThanOrEqualTo:
        return "gte";
      case FilterType.LessThan:
        return "lt";
      case FilterType.LessThanOrEqualTo:
        return "lte";
      case FilterType.EqualTo:
        return "eq";
      case FilterType.NotEqualTo:
        return "ne";
      default:
        return null;
    }
  }

  /**
   * Judge a filter that counts its window's checks: read the window - once
   * for every filter, probe and disk that share it (CheckWindowCountReads) -
   * pick this check's group, and judge it.
   */
  @CaptureSpan()
  public static async judgeFilter(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    monitorStepId: ObjectID | string;
    monitorType: MonitorType | undefined;
    // The probe that made the check: its checks are counted on their own.
    probeId?: ObjectID | string | undefined;
    criteriaFilter: CriteriaFilter;
    /*
     * This check's match of the filter, judged on this check alone. Counted
     * from memory when the filter keeps a match history and the check just
     * arrived (its row is written after it is judged).
     */
    check: CriteriaFilterCheck;
    isStoredCheck?: boolean | undefined;
    monitoringInterval?: string | undefined;
    /*
     * A disk's usage: the paths the agent reports the disks it names under,
     * every disk for "*" (ServerMonitorCriteria.getAgentDiskPaths). The
     * typed path when not given.
     */
    diskPaths?: Array<string> | undefined;
    reads?: CheckWindowCountReads | undefined;
  }): Promise<CheckWindowJudgement> {
    const label: string = CriteriaFilterMatchHistory.getFilterLabel(
      data.criteriaFilter,
    );

    const type: EvaluateOverTimeType | undefined =
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        data.criteriaFilter,
        data.monitorType,
      );

    const windowInMinutes: number = CriteriaFilterUtil.getEvaluateOverTimeMinutes(
      data.criteriaFilter,
    );

    const source: CheckWindowSource | null = CheckWindowCounts.getSource({
      criteriaFilter: data.criteriaFilter,
      monitorType: data.monitorType,
      monitorStepId: data.monitorStepId,
    });

    if (
      !source ||
      !type ||
      !CriteriaFilterUtil.isCountedWindowType(type) ||
      windowInMinutes <= 0
    ) {
      // Never reached from the evaluator (isCountedOverChecks).
      return {
        rootCause: null,
        message: `${label} cannot be counted over a window of checks, so it was not judged.`,
      };
    }

    const reads: CheckWindowCountReads =
      data.reads || new CheckWindowCountReads();

    const windowEndMs: number = reads.now.getTime();
    const windowStartMs: number =
      windowEndMs - windowInMinutes * MILLISECONDS_IN_A_MINUTE;

    let groups: Map<string, MonitorCheckSummaryRow>;

    try {
      groups = await reads.getSummaries({
        projectId: data.projectId,
        monitorId: data.monitorId,
        source: source,
        windowStart: new Date(windowStartMs),
      });
    } catch (err) {
      logger.error(
        `Could not count the checks of monitor ${data.monitorId.toString()} over a window.`,
      );
      logger.error(err);

      // A window that could not be read is never reported as a breach.
      return {
        rootCause: null,
        message: `The checks of the last ${CheckWindowCounts.describeWindow(windowInMinutes)} could not be read, so ${label} was not counted over them.`,
      };
    }

    const scheduledIntervalSeconds: number | null =
      EvaluateOverTime.getSamplingIntervalInSeconds({
        monitoringInterval: data.monitoringInterval,
        sortedSampleTimes: [],
      });

    /*
     * A disk's usage is judged disk by disk - every disk the report names
     * for "*" - and is met when any disk meets it, as "*" reads everywhere
     * else (ServerMonitorCriteria). Anything else is one group: this probe's.
     */
    const isPerDisk: boolean = source.groupByAttributeKeys.includes(
      DISK_PATH_ATTRIBUTE,
    );

    const diskPaths: Array<string | undefined> = isPerDisk
      ? data.diskPaths && data.diskPaths.length > 0
        ? data.diskPaths
        : [data.criteriaFilter.serverMonitorOptions?.diskPath]
      : [undefined];

    let firstJudgement: CheckWindowJudgement | null = null;

    for (const diskPath of diskPaths) {
      const judgement: CheckWindowJudgement = CheckWindowCounts.judgeGroup({
        data: data,
        source: source,
        type: type,
        label: label,
        row: groups.get(
          CheckWindowCounts.getGroupKey({
            groupByAttributeKeys: source.groupByAttributeKeys,
            probeId: data.probeId,
            diskPath: diskPath,
          }),
        ),
        windowStartMs: windowStartMs,
        windowEndMs: windowEndMs,
        scheduledIntervalSeconds: scheduledIntervalSeconds,
      });

      const named: CheckWindowJudgement =
        isPerDisk && diskPaths.length > 1 && diskPath
          ? {
              rootCause: judgement.rootCause
                ? `Disk ${diskPath} - ${judgement.rootCause}`
                : null,
              message: `Disk ${diskPath} - ${judgement.message}`,
            }
          : judgement;

      if (named.rootCause) {
        return named;
      }

      firstJudgement = firstJudgement || named;
    }

    return (
      firstJudgement || {
        rootCause: null,
        message: `${label} has no disk to count the checks of.`,
      }
    );
  }

  // One group's checks - one probe's, of one disk - judged.
  private static judgeGroup(input: {
    data: {
      criteriaFilter: CriteriaFilter;
      check: CriteriaFilterCheck;
      isStoredCheck?: boolean | undefined;
    };
    source: CheckWindowSource;
    type: EvaluateOverTimeType;
    label: string;
    row: MonitorCheckSummaryRow | undefined;
    windowStartMs: number;
    windowEndMs: number;
    scheduledIntervalSeconds: number | null;
  }): CheckWindowJudgement {
    const data: {
      criteriaFilter: CriteriaFilter;
      check: CriteriaFilterCheck;
      isStoredCheck?: boolean | undefined;
    } = input.data;
    const row: MonitorCheckSummaryRow | undefined = input.row;
    const source: CheckWindowSource = input.source;

    let tally: CheckWindowTally = row
      ? {
          checkCount: row.checkCount,
          matchCount: row.matchCount,
          changeCount: row.changeCount,
          firstAt: row.firstAt,
          lastAt: row.lastAt,
          lastMatched: row.lastMatched,
        }
      : {
          checkCount: 0,
          matchCount: 0,
          changeCount: 0,
          firstAt: null,
          lastAt: null,
          lastMatched: null,
        };

    /*
     * A match history holds the checks before this one: this one is counted
     * from memory, once - unless it is a stored check, already written.
     */
    if (source.isMatchHistory && !data.isStoredCheck) {
      tally = CheckWindowCounts.addCheck({
        tally: tally,
        matched: data.check.matched,
        at: data.check.at,
      });
    }

    return CheckWindowCounts.judge({
      criteriaFilter: data.criteriaFilter,
      type: input.type,
      label: input.label,
      tally: tally,
      windowStartMs: input.windowStartMs,
      windowEndMs: input.windowEndMs,
      intervalMs:
        input.scheduledIntervalSeconds && input.scheduledIntervalSeconds > 0
          ? input.scheduledIntervalSeconds * 1000
          : null,
    });
  }

  // A tally with one more check at its end.
  public static addCheck(data: {
    tally: CheckWindowTally;
    matched: boolean;
    at: Date;
  }): CheckWindowTally {
    const changed: boolean =
      data.tally.lastMatched !== null && data.tally.lastMatched !== data.matched;

    return {
      checkCount: data.tally.checkCount + 1,
      matchCount: data.tally.matchCount + (data.matched ? 1 : 0),
      changeCount: data.tally.changeCount + (changed ? 1 : 0),
      firstAt:
        data.tally.firstAt && data.tally.firstAt.getTime() < data.at.getTime()
          ? data.tally.firstAt
          : data.at,
      lastAt:
        data.tally.lastAt && data.tally.lastAt.getTime() > data.at.getTime()
          ? data.tally.lastAt
          : data.at,
      lastMatched: data.matched,
    };
  }

  /*
   * What a window's checks, counted, come to: met, not met, or not judged
   * yet - with what they came to, in words, either way. Pure: everything it
   * reads is handed in.
   */
  public static judge(data: {
    criteriaFilter: CriteriaFilter;
    type: EvaluateOverTimeType;
    label: string;
    tally: CheckWindowTally;
    windowStartMs: number;
    windowEndMs: number;
    // How far apart the checks are meant to be; null when unknown.
    intervalMs: number | null;
  }): CheckWindowJudgement {
    const windowInMinutes: number = Math.round(
      (data.windowEndMs - data.windowStartMs) / MILLISECONDS_IN_A_MINUTE,
    );
    const windowName: string = CheckWindowCounts.describeWindow(windowInMinutes);
    const comparison: { filterType: FilterType; value: number } =
      CriteriaFilterUtil.getCountComparison(data.criteriaFilter);
    const tally: CheckWindowTally = data.tally;

    if (tally.checkCount === 0 || !tally.firstAt) {
      return CheckWindowCounts.applyNoDataPolicy({
        criteriaFilter: data.criteriaFilter,
        judgeAsZero: (): CheckWindowJudgement => {
          return CheckWindowCounts.compare({
            data: data,
            comparison: comparison,
            figure: 0,
            figureText: CheckWindowCounts.describeFigure({
              type: data.type,
              tally: tally,
              figure: 0,
              windowName: windowName,
              label: data.label,
            }),
          });
        },
        waitingMessage: `${data.label} has no checks over the last ${windowName}, so it was not counted.`,
        triggeredMessage: `${data.label} has no checks over the last ${windowName}, and its If No Data setting is Trigger.`,
      });
    }

    const intervalMs: number | null =
      data.intervalMs ?? CheckWindowCounts.getTypicalGapMs(tally);

    /*
     * Covered when the checks reach back to the start of the window and up
     * to its end, by WindowCoverage's rule - the one All Values waits on.
     * Without a cadence to measure against (one check, no schedule), only
     * checks that reach the start count as covering it.
     */
    const isCovered: boolean =
      intervalMs !== null
        ? WindowCoverage.judge({
            windowStartMs: data.windowStartMs,
            windowEndMs: data.windowEndMs,
            readingTimesMs: [
              tally.firstAt.getTime(),
              (tally.lastAt || tally.firstAt).getTime(),
            ],
            intervalMs: intervalMs,
          }).isCovered
        : tally.firstAt.getTime() <= data.windowStartMs;

    const figure: number = CheckWindowCounts.getFigure({
      type: data.type,
      tally: tally,
    });

    const figureText: string = CheckWindowCounts.describeFigure({
      type: data.type,
      tally: tally,
      figure: figure,
      windowName: windowName,
      label: data.label,
    });

    if (isCovered) {
      return CheckWindowCounts.compare({
        data: data,
        comparison: comparison,
        figure: figure,
        figureText: figureText,
      });
    }

    /*
     * Not covered yet: more checks can only add to a count or to a number
     * of changes, so one already past "more than" or "at least" stays past
     * it. Every other answer waits for the window.
     */
    const onlyGrows: boolean =
      data.type === EvaluateOverTimeType.Count ||
      data.type === EvaluateOverTimeType.StatusChanges;

    const isPastAlready: boolean =
      onlyGrows &&
      (comparison.filterType === FilterType.GreaterThan ||
        comparison.filterType === FilterType.GreaterThanOrEqualTo) &&
      CheckWindowCounts.isMet({ comparison: comparison, figure: figure });

    if (isPastAlready) {
      return CheckWindowCounts.compare({
        data: data,
        comparison: comparison,
        figure: figure,
        figureText: figureText,
      });
    }

    const reachesBack: string = CheckWindowCounts.describeDuration(
      data.windowEndMs - tally.firstAt.getTime(),
    );

    return CheckWindowCounts.applyNoDataPolicy({
      criteriaFilter: data.criteriaFilter,
      judgeAsZero: (): CheckWindowJudgement => {
        /*
         * The checks the window lacks count as checks that did not match:
         * a share is of the checks the window should hold.
         */
        const expectedChecks: number =
          intervalMs !== null && intervalMs > 0
            ? Math.max(
                tally.checkCount,
                Math.floor(
                  (data.windowEndMs - data.windowStartMs) / intervalMs,
                ),
              )
            : tally.checkCount;

        const padded: CheckWindowTally = {
          ...tally,
          checkCount: expectedChecks,
        };

        const paddedFigure: number = CheckWindowCounts.getFigure({
          type: data.type,
          tally: padded,
        });

        return CheckWindowCounts.compare({
          data: data,
          comparison: comparison,
          figure: paddedFigure,
          figureText: CheckWindowCounts.describeFigure({
            type: data.type,
            tally: padded,
            figure: paddedFigure,
            windowName: windowName,
            label: data.label,
          }),
        });
      },
      waitingMessage: `${figureText} The checks reach back ${reachesBack} so far, so ${data.type} waits until they cover the last ${windowName}.`,
      triggeredMessage: `${figureText} The checks reach back ${reachesBack} so far, not the last ${windowName}, and its If No Data setting is Trigger.`,
    });
  }

  // The number a window comes to: a count, a share in %, or changes.
  public static getFigure(data: {
    type: EvaluateOverTimeType;
    tally: CheckWindowTally;
  }): number {
    if (data.type === EvaluateOverTimeType.Percentage) {
      return data.tally.checkCount > 0
        ? (data.tally.matchCount / data.tally.checkCount) * 100
        : 0;
    }

    if (data.type === EvaluateOverTimeType.StatusChanges) {
      return data.tally.changeCount;
    }

    return data.tally.matchCount;
  }

  public static isMet(data: {
    comparison: { filterType: FilterType; value: number };
    figure: number;
  }): boolean {
    const value: number = data.comparison.value;

    switch (data.comparison.filterType) {
      case FilterType.GreaterThan:
        return data.figure > value;
      case FilterType.GreaterThanOrEqualTo:
        return data.figure >= value;
      case FilterType.LessThan:
        return data.figure < value;
      case FilterType.LessThanOrEqualTo:
        return data.figure <= value;
      case FilterType.EqualTo:
        return data.figure === value;
      case FilterType.NotEqualTo:
        return data.figure !== value;
      default:
        return false;
    }
  }

  private static compare(input: {
    data: { type: EvaluateOverTimeType };
    comparison: { filterType: FilterType; value: number };
    figure: number;
    figureText: string;
  }): CheckWindowJudgement {
    const needed: string = CheckWindowCounts.describeComparison({
      type: input.data.type,
      comparison: input.comparison,
    });

    if (
      CheckWindowCounts.isMet({
        comparison: input.comparison,
        figure: input.figure,
      })
    ) {
      const message: string = `${input.figureText} That is ${needed}.`;

      return { rootCause: message, message: message };
    }

    return {
      rootCause: null,
      message: `${input.figureText} The criteria needs ${needed}.`,
    };
  }

  /*
   * A window that cannot be judged as it stands, by the filter's If No Data
   * setting: Ignore waits, Trigger matches, Treat As Zero judges the window
   * with the checks it lacks counted as checks that did not match.
   */
  private static applyNoDataPolicy(data: {
    criteriaFilter: CriteriaFilter;
    judgeAsZero: () => CheckWindowJudgement;
    waitingMessage: string;
    triggeredMessage: string;
  }): CheckWindowJudgement {
    const policy: NoDataPolicy =
      data.criteriaFilter.evaluateOverTimeOptions?.onNoDataPolicy ||
      NoDataPolicy.Ignore;

    if (policy === NoDataPolicy.Trigger) {
      return { rootCause: data.triggeredMessage, message: data.triggeredMessage };
    }

    if (policy === NoDataPolicy.TreatAsZero) {
      return data.judgeAsZero();
    }

    return { rootCause: null, message: data.waitingMessage };
  }

  /*
   * What the window held, in a sentence: "Is Online False matched on 31 of
   * the 480 checks over the last 8 hours."
   */
  private static describeFigure(data: {
    type: EvaluateOverTimeType;
    tally: CheckWindowTally;
    figure: number;
    windowName: string;
    label: string;
  }): string {
    const checks: string = CheckWindowCounts.countChecks(data.tally.checkCount);

    if (data.type === EvaluateOverTimeType.Percentage) {
      return `${data.label} matched on ${CheckWindowCounts.formatNumber(data.figure)}% of the checks over the last ${data.windowName} (${data.tally.matchCount} of ${checks}).`;
    }

    if (data.type === EvaluateOverTimeType.StatusChanges) {
      return `${data.label} changed between matching and not matching ${CheckWindowCounts.countTimes(data.tally.changeCount)} over the last ${data.windowName} (${checks}).`;
    }

    return `${data.label} matched on ${data.tally.matchCount} of the ${checks} over the last ${data.windowName}.`;
  }

  // "more than 30", "at most 10%".
  public static describeComparison(data: {
    type: EvaluateOverTimeType | undefined;
    comparison: { filterType: FilterType; value: number };
  }): string {
    const value: string = `${CheckWindowCounts.formatNumber(data.comparison.value)}${
      data.type === EvaluateOverTimeType.Percentage ? "%" : ""
    }`;

    switch (data.comparison.filterType) {
      case FilterType.GreaterThan:
        return `more than ${value}`;
      case FilterType.GreaterThanOrEqualTo:
        return `at least ${value}`;
      case FilterType.LessThan:
        return `fewer than ${value}`;
      case FilterType.LessThanOrEqualTo:
        return `at most ${value}`;
      case FilterType.EqualTo:
        return `exactly ${value}`;
      default:
        return `anything but ${value}`;
    }
  }

  // "8 hours", "hour", "90 minutes", "minute".
  public static describeWindow(windowInMinutes: number): string {
    if (windowInMinutes >= 60 && windowInMinutes % 60 === 0) {
      const hours: number = windowInMinutes / 60;
      return hours === 1 ? "hour" : `${hours} hours`;
    }

    return windowInMinutes === 1 ? "minute" : `${windowInMinutes} minutes`;
  }

  // "3 hours", "20 minutes", "less than a minute": rounded down.
  private static describeDuration(milliseconds: number): string {
    const minutes: number = Math.floor(milliseconds / MILLISECONDS_IN_A_MINUTE);

    if (minutes < 1) {
      return "less than a minute";
    }

    if (minutes >= 120) {
      const hours: number = Math.floor(minutes / 60);
      return `${hours} hours`;
    }

    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  private static countChecks(count: number): string {
    return count === 1 ? "1 check" : `${count} checks`;
  }

  private static countTimes(count: number): string {
    return count === 1 ? "1 time" : `${count} times`;
  }

  // At most one decimal: 12.5, 33.3, 30.
  private static formatNumber(value: number): string {
    return Number.isInteger(value)
      ? String(value)
      : String(Math.round(value * 10) / 10);
  }

  /*
   * How far apart a group's checks are, from its first and last and how
   * many there are: the cadence when the monitor's schedule is unknown.
   * Null for fewer than two checks apart.
   */
  private static getTypicalGapMs(tally: CheckWindowTally): number | null {
    if (!tally.firstAt || !tally.lastAt || tally.checkCount < 2) {
      return null;
    }

    const spanMs: number = tally.lastAt.getTime() - tally.firstAt.getTime();

    return spanMs > 0 ? spanMs / (tally.checkCount - 1) : null;
  }

  /*
   * Whether a monitor counts checks of a series in any enabled criteria -
   * its filters or its recovery filters. Such a monitor's check writes its
   * series rows before it is judged and waits until they can be read, so
   * the count includes it (MonitorMetricUtil.saveMonitorMetrics).
   */
  public static countsSeriesChecks(data: {
    monitorSteps: MonitorSteps | undefined | null;
    monitorType: MonitorType | undefined;
  }): boolean {
    for (const step of data.monitorSteps?.data?.monitorStepsInstanceArray ||
      []) {
      for (const criteriaInstance of step.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || []) {
        if (!criteriaInstance.data || criteriaInstance.data.isEnabled === false) {
          continue;
        }

        for (const filter of [
          ...(criteriaInstance.data.filters || []),
          ...(criteriaInstance.data.recoveryFilters || []),
        ]) {
          if (
            CriteriaFilterUtil.isCountedOverChecks(filter, data.monitorType) &&
            !CriteriaFilterUtil.hasMatchHistory({
              checkOn: filter.checkOn,
              monitorType: data.monitorType,
            })
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // The key of a group, as getSummaries keys them.
  public static getGroupKey(data: {
    groupByAttributeKeys: Array<string>;
    probeId?: ObjectID | string | undefined;
    diskPath?: string | undefined;
  }): string {
    return data.groupByAttributeKeys
      .map((key: string): string => {
        if (key === PROBE_ID_ATTRIBUTE) {
          return data.probeId ? data.probeId.toString() : "";
        }

        if (key === DISK_PATH_ATTRIBUTE) {
          return data.diskPath || "";
        }

        return "";
      })
      .join("|");
  }
}

/**
 * The counted windows read while one check is judged: its own evaluation,
 * every disk a criteria fans out over and the probe agreement pass judge
 * the same window of the same series, so each is read once, for every group,
 * and split up in memory. Everything judged through one instance is judged
 * as of the moment it was made.
 */
export class CheckWindowCountReads {
  public readonly now: Date;

  private readonly reads: Map<
    string,
    Promise<Map<string, MonitorCheckSummaryRow>>
  >;

  /*
   * The counted windows of each probe result being handled, beside its
   * match histories: whatever shares those reads - the check's own
   * evaluation, its disks, the probe agreement pass - shares these, as of
   * the same moment.
   */
  private static readonly byMatchHistoryReads: WeakMap<
    CriteriaFilterMatchHistoryReads,
    CheckWindowCountReads
  > = new WeakMap<CriteriaFilterMatchHistoryReads, CheckWindowCountReads>();

  public constructor(now?: Date | undefined) {
    this.now = now || OneUptimeDate.getCurrentDate();
    this.reads = new Map<
      string,
      Promise<Map<string, MonitorCheckSummaryRow>>
    >();
  }

  public static forMatchHistoryReads(
    matchHistoryReads: CriteriaFilterMatchHistoryReads,
  ): CheckWindowCountReads {
    let reads: CheckWindowCountReads | undefined =
      CheckWindowCountReads.byMatchHistoryReads.get(matchHistoryReads);

    if (!reads) {
      reads = new CheckWindowCountReads(matchHistoryReads.now);
      CheckWindowCountReads.byMatchHistoryReads.set(matchHistoryReads, reads);
    }

    return reads;
  }

  // Every group's checks of one source, from windowStart until this instance's now.
  public getSummaries(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    source: CheckWindowSource;
    windowStart: Date;
  }): Promise<Map<string, MonitorCheckSummaryRow>> {
    const readKey: string = JSON.stringify([
      data.projectId.toString(),
      data.monitorId.toString(),
      data.source.metricName,
      data.source.attributes,
      data.source.groupByAttributeKeys,
      data.source.condition,
      data.windowStart.getTime(),
    ]);

    let read: Promise<Map<string, MonitorCheckSummaryRow>> | undefined =
      this.reads.get(readKey);

    if (!read) {
      read = MetricService.summarizeMonitorChecks({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: data.source.metricName,
        windowStart: data.windowStart,
        windowEnd: this.now,
        attributes: data.source.attributes,
        groupByAttributeKeys: data.source.groupByAttributeKeys,
        condition: data.source.condition,
      }).then((rows: Array<MonitorCheckSummaryRow>) => {
        const groups: Map<string, MonitorCheckSummaryRow> = new Map<
          string,
          MonitorCheckSummaryRow
        >();

        for (const row of rows) {
          groups.set(
            data.source.groupByAttributeKeys
              .map((key: string): string => {
                return row.group[key] || "";
              })
              .join("|"),
            row,
          );
        }

        return groups;
      });

      this.reads.set(readKey, read);
    }

    return read;
  }
}
