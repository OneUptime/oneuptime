import CheckWindowCounts, {
  CheckWindowJudgement,
  CheckWindowSource,
} from "./CheckWindowCounts";
import CriteriaFilterMatchHistory, {
  CriteriaFilterMatchHistoryReads,
} from "./CriteriaFilterMatchHistory";
import MetricService, {
  MonitorCheckAttributeFilter,
  MonitorCheckCondition,
  MonitorPreviousCheckRow,
} from "../../../Services/MetricService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  FilterType,
  NoDataPolicy,
  PreviousCheckChangeType,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  DatabaseMetricDefinition,
  getDatabaseMetricByMetricType,
} from "../../../../Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import { MonitorStepSeriesScope } from "../../../../Types/Monitor/MonitorStepSeries";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import MonitorMetricTypeUtil from "../../../../Utils/Monitor/MonitorMetricType";

/**
 * COMPARING A CHECK WITH THE ONE BEFORE IT (#10821).
 *
 * "The response time is more than 50% above the previous check", "the
 * certificate check stopped returning the page's title": a criteria filter
 * whose window type is Previous Check compares this check with the one its
 * probe made before it.
 *
 * WHERE THE PREVIOUS CHECK IS READ FROM
 *
 * Every check writes its values as series before it is judged
 * (MonitorMetricUtil.saveMonitorMetrics), and a check that keeps a match
 * history writes whether it matched once it is judged
 * (CriteriaFilterMatchHistory). The previous check is the newest row of the
 * probe - and of the disk, for a disk's usage - and of the step (#10906),
 * written before this check was, read for every probe in one bounded
 * statement
 * (MetricService.readPreviousMonitorChecks): the sort key's prefix and a
 * time range, one row a group. This check's own rows are written after
 * MonitorResource takes the time it hands in as checkWrittenAt, so they are
 * never read as its previous check; a stored check read back for probe
 * agreement was written after it was stamped, so its stamp serves.
 *
 * HOW IT IS COMPARED
 *
 * A measured value - a response time, a CPU, a packet loss - is judged on
 * this check, by the filter's own comparison, against a threshold made from
 * the previous check's value (CriteriaFilterUtil.getPreviousCheckComparison):
 * the previous value plus the change for Greater Than, minus it for Less
 * Than, the value itself for Equal To and Not Equal To. Every check type
 * reads its value and compares it as it always has, so nothing compares a
 * value of its own here.
 *
 * A yes or no check - Is Online and the other true/false series, and a
 * body, header or expression judged from its match history - matches on
 * the check that started to meet its condition: this check meets it and
 * the previous one did not. "Is Online is False" matches on the check a
 * device went down on; "Is Online is True" on the one it came back on.
 *
 * NO PREVIOUS CHECK
 *
 * The window is how long ago the previous check may be. With none in it -
 * the monitor's first check, a probe just added, a check after a gap longer
 * than the window - If No Data decides, as it does for any window: Ignore
 * waits, Trigger matches, and Treat As Zero compares with a previous value
 * of 0 (or, for a yes or no check, a previous check that did not meet the
 * condition).
 */

// Where a filter's previous check is read from.
export interface PreviousCheckSource {
  metricName: string;
  /*
   * Rows whose attribute has this value, or one of these values: a match
   * history's filter key, the step of a series.
   */
  attributes: MonitorCheckAttributeFilter;
  // The attributes a group is one value of: probeId, and diskPath.
  groupByAttributeKeys: Array<string>;
  // A match history, written after each check is judged.
  isMatchHistory: boolean;
  /*
   * For a yes or no check: whether a row's value met the filter's condition.
   * Null for a measured value, whose previous value makes the threshold.
   */
  condition: MonitorCheckCondition | null;
}

const PROBE_ID_ATTRIBUTE: string = "probeId";
const DISK_PATH_ATTRIBUTE: string = "diskPath";

const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

/*
 * A threshold is made with the previous value and a share of it: kept to
 * ten decimals, so 0.1 + 0.2 compares as 0.3.
 */
const THRESHOLD_DECIMALS: number = 1e10;

export default class PreviousCheckComparison {
  /*
   * Where this filter's previous check is read from: the match history or
   * the series a yes or no check is counted from (CheckWindowCounts), or the
   * series a measured value is written to. Null when nothing records it.
   */
  public static getSource(data: {
    criteriaFilter: CriteriaFilter;
    monitorType: MonitorType | undefined;
    monitorStepId: ObjectID | string;
    /*
     * The rows of a series the step's previous check is read from
     * (MonitorStepSeries): its own, never another step's. Every row of the
     * series when not given.
     */
    stepScope?: MonitorStepSeriesScope | undefined;
  }): PreviousCheckSource | null {
    if (
      CriteriaFilterUtil.isJudgedCheckByCheck(
        data.criteriaFilter.checkOn,
        data.monitorType,
      )
    ) {
      const counted: CheckWindowSource | null =
        CheckWindowCounts.getSource(data);

      return counted
        ? {
            metricName: counted.metricName,
            attributes: counted.attributes,
            groupByAttributeKeys: counted.groupByAttributeKeys,
            isMatchHistory: counted.isMatchHistory,
            condition: counted.condition,
          }
        : null;
    }

    const metricName: MonitorMetricType | null =
      MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
        data.criteriaFilter,
      );

    if (!metricName) {
      return null;
    }

    return {
      metricName: metricName,
      attributes: CheckWindowCounts.getSeriesAttributes(data.stepScope),
      // Each disk's usage is a series of its own, read with the others.
      groupByAttributeKeys:
        data.criteriaFilter.checkOn === CheckOn.DiskUsagePercent
          ? [PROBE_ID_ATTRIBUTE, DISK_PATH_ATTRIBUTE]
          : [PROBE_ID_ATTRIBUTE],
      isMatchHistory: false,
      condition: null,
    };
  }

  /**
   * Judge a filter that compares this check with the previous one: read the
   * previous checks - once for every filter, probe and disk that share them
   * (PreviousCheckReads) - pick this check's group, and judge it.
   */
  @CaptureSpan()
  public static async judgeFilter(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    monitorStepId: ObjectID | string;
    /*
     * The rows of a series the step's previous check is read from
     * (MonitorStepSeries): a step of a monitor with several is compared with
     * its own previous check, never with the step checked just before it.
     */
    stepScope?: MonitorStepSeriesScope | undefined;
    monitorType: MonitorType | undefined;
    // The probe that made the check: its previous check is its own.
    probeId?: ObjectID | string | undefined;
    criteriaFilter: CriteriaFilter;
    /*
     * When this check's rows were written, or began to be: the previous
     * check is the newest row before it.
     */
    checkWrittenAt: Date;
    /*
     * A disk's usage: the paths the agent reports the disks it names under,
     * every disk for "*" (ServerMonitorCriteria.getAgentDiskPaths). The
     * typed path when not given.
     */
    diskPaths?: Array<string> | undefined;
    reads?: PreviousCheckReads | undefined;
    // Whether this check meets the filter, judged on it alone.
    isMetOnThisCheck: () => Promise<boolean>;
    /*
     * This check judged by a filter of its own - the threshold made from
     * the previous check's value - as any filter is judged on one check:
     * its finding when it is met, null when not.
     */
    judgeThisCheck: (criteriaFilter: CriteriaFilter) => Promise<string | null>;
  }): Promise<CheckWindowJudgement> {
    const label: string = PreviousCheckComparison.getFilterLabel(
      data.criteriaFilter,
      data.monitorType,
    );

    const windowInMinutes: number =
      CriteriaFilterUtil.getEvaluateOverTimeMinutes(data.criteriaFilter);

    const source: PreviousCheckSource | null =
      PreviousCheckComparison.getSource({
        criteriaFilter: data.criteriaFilter,
        monitorType: data.monitorType,
        monitorStepId: data.monitorStepId,
        stepScope: data.stepScope,
      });

    if (
      !source ||
      windowInMinutes <= 0 ||
      !CriteriaFilterUtil.isComparedWithPreviousCheck(
        data.criteriaFilter,
        data.monitorType,
      )
    ) {
      // Never reached from the evaluator (isComparedWithPreviousCheck).
      return {
        rootCause: null,
        message: `${label} cannot be compared with the previous check, so it was not judged.`,
      };
    }

    const reads: PreviousCheckReads = data.reads || new PreviousCheckReads();

    const before: Date = data.checkWrittenAt;
    const windowStart: Date = new Date(
      before.getTime() - windowInMinutes * MILLISECONDS_IN_A_MINUTE,
    );

    let groups: Map<string, MonitorPreviousCheckRow>;

    try {
      groups = await reads.getPreviousChecks({
        projectId: data.projectId,
        monitorId: data.monitorId,
        source: source,
        windowStart: windowStart,
        before: before,
      });
    } catch (err) {
      logger.error(
        `Could not read the previous check of monitor ${data.monitorId.toString()}.`,
      );
      logger.error(err);

      // A previous check that could not be read is never reported as a breach.
      return {
        rootCause: null,
        message: `The previous check could not be read, so ${label} was not compared with it.`,
      };
    }

    /*
     * A disk's usage is compared disk by disk - every disk the report names
     * for "*" - and is met when any disk is, as "*" reads everywhere else
     * (ServerMonitorCriteria). Anything else is one group: this probe's.
     */
    const isPerDisk: boolean =
      source.groupByAttributeKeys.includes(DISK_PATH_ATTRIBUTE);

    const diskPaths: Array<string | undefined> = isPerDisk
      ? data.diskPaths && data.diskPaths.length > 0
        ? data.diskPaths
        : [data.criteriaFilter.serverMonitorOptions?.diskPath]
      : [undefined];

    let firstJudgement: CheckWindowJudgement | null = null;

    for (const diskPath of diskPaths) {
      const previous: MonitorPreviousCheckRow | undefined = groups.get(
        CheckWindowCounts.getGroupKey({
          groupByAttributeKeys: source.groupByAttributeKeys,
          probeId: data.probeId,
          diskPath: diskPath,
        }),
      );

      const judgement: CheckWindowJudgement = source.condition
        ? await PreviousCheckComparison.judgeYesOrNo({
            criteriaFilter: data.criteriaFilter,
            label: label,
            condition: source.condition,
            previous: previous,
            checkWrittenAt: before,
            windowInMinutes: windowInMinutes,
            isMetOnThisCheck: data.isMetOnThisCheck,
          })
        : await PreviousCheckComparison.judgeValue({
            criteriaFilter: data.criteriaFilter,
            label: label,
            previous: previous,
            checkWrittenAt: before,
            windowInMinutes: windowInMinutes,
            diskPath: isPerDisk ? diskPath : undefined,
            judgeThisCheck: data.judgeThisCheck,
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
        message: `${label} has no disk to compare with its previous check.`,
      }
    );
  }

  /*
   * A measured value against the previous check's: this check judged by
   * the filter's own comparison with a threshold made from the previous
   * value.
   */
  private static async judgeValue(data: {
    criteriaFilter: CriteriaFilter;
    label: string;
    previous: MonitorPreviousCheckRow | undefined;
    checkWrittenAt: Date;
    windowInMinutes: number;
    diskPath: string | undefined;
    judgeThisCheck: (criteriaFilter: CriteriaFilter) => Promise<string | null>;
  }): Promise<CheckWindowJudgement> {
    const relation: string = PreviousCheckComparison.describeRelation(
      data.criteriaFilter,
    );

    const compareWith: (previousValue: number) => Promise<{
      met: boolean;
      threshold: number | null;
      finding: string | null;
    }> = async (
      previousValue: number,
    ): Promise<{
      met: boolean;
      threshold: number | null;
      finding: string | null;
    }> => {
      const comparison: { filterType: FilterType; threshold: number } | null =
        CriteriaFilterUtil.getPreviousCheckComparison({
          previousValue: previousValue,
          filterType: data.criteriaFilter.filterType,
          change: CriteriaFilterUtil.getPreviousCheckChange(
            data.criteriaFilter,
          ),
        });

      if (!comparison) {
        return { met: false, threshold: null, finding: null };
      }

      const threshold: number =
        Math.round(comparison.threshold * THRESHOLD_DECIMALS) /
        THRESHOLD_DECIMALS;

      const finding: string | null = await data.judgeThisCheck(
        PreviousCheckComparison.toThisCheckFilter({
          criteriaFilter: data.criteriaFilter,
          filterType: comparison.filterType,
          threshold: threshold,
          diskPath: data.diskPath,
        }),
      );

      return { met: Boolean(finding), threshold: threshold, finding: finding };
    };

    if (!data.previous) {
      const windowName: string = CheckWindowCounts.describeWindow(
        data.windowInMinutes,
      );

      return PreviousCheckComparison.applyNoDataPolicy({
        criteriaFilter: data.criteriaFilter,
        waitingMessage: `${data.label} has no previous check in the last ${windowName}, so it was not compared with one.`,
        triggeredMessage: `${data.label} has no previous check in the last ${windowName}, and its If No Data setting is Trigger.`,
        judgeAsZero: async (): Promise<CheckWindowJudgement> => {
          const result: {
            met: boolean;
            threshold: number | null;
            finding: string | null;
          } = await compareWith(0);

          const comparedWith: string = `It has no previous check in the last ${windowName}, so it was compared with 0 (its If No Data setting is Treat As Zero)`;

          return PreviousCheckComparison.toValueJudgement({
            label: data.label,
            relation: relation,
            comparedWith: comparedWith,
            criteriaFilter: data.criteriaFilter,
            ...result,
          });
        },
      });
    }

    const result: {
      met: boolean;
      threshold: number | null;
      finding: string | null;
    } = await compareWith(data.previous.value);

    return PreviousCheckComparison.toValueJudgement({
      label: data.label,
      relation: relation,
      comparedWith: `The previous check, ${PreviousCheckComparison.describeAgo(
        data.checkWrittenAt.getTime() - data.previous.at.getTime(),
      )}, read ${PreviousCheckComparison.formatNumber(data.previous.value)}`,
      criteriaFilter: data.criteriaFilter,
      ...result,
    });
  }

  // What a measured value's comparison came to, in words.
  private static toValueJudgement(data: {
    label: string;
    relation: string;
    comparedWith: string;
    criteriaFilter: CriteriaFilter;
    met: boolean;
    threshold: number | null;
    finding: string | null;
  }): CheckWindowJudgement {
    if (data.threshold === null) {
      return {
        rootCause: null,
        message: `${data.label} compares a number with the previous check's, and ${data.criteriaFilter.filterType || "no condition"} does not, so it was not judged.`,
      };
    }

    const needed: string = PreviousCheckComparison.describeNeeded({
      criteriaFilter: data.criteriaFilter,
      threshold: data.threshold,
    });

    if (data.met) {
      const message: string = `${data.label} is ${data.relation} the previous check. ${data.comparedWith}, so this check needed ${needed}: ${data.finding}`;

      return { rootCause: message, message: message };
    }

    return {
      rootCause: null,
      message: `${data.label} is not ${data.relation} the previous check. ${data.comparedWith}, so this check needed ${needed}.`,
    };
  }

  /*
   * A yes or no check: met on the check that started to meet the filter's
   * condition - this check meets it, and the previous check did not.
   */
  private static async judgeYesOrNo(data: {
    criteriaFilter: CriteriaFilter;
    label: string;
    condition: MonitorCheckCondition;
    previous: MonitorPreviousCheckRow | undefined;
    checkWrittenAt: Date;
    windowInMinutes: number;
    isMetOnThisCheck: () => Promise<boolean>;
  }): Promise<CheckWindowJudgement> {
    const isMetNow: boolean = await data.isMetOnThisCheck();

    if (!data.previous) {
      const windowName: string = CheckWindowCounts.describeWindow(
        data.windowInMinutes,
      );

      return PreviousCheckComparison.applyNoDataPolicy({
        criteriaFilter: data.criteriaFilter,
        waitingMessage: `${data.label} has no previous check in the last ${windowName}, so it was not compared with one.`,
        triggeredMessage: `${data.label} has no previous check in the last ${windowName}, and its If No Data setting is Trigger.`,
        judgeAsZero: async (): Promise<CheckWindowJudgement> => {
          // With no previous check, it did not match on one.
          if (isMetNow) {
            const message: string = `${data.label} matched on this check. It has no previous check in the last ${windowName}, which its If No Data setting (Treat As Zero) reads as one it did not match on.`;

            return { rootCause: message, message: message };
          }

          return {
            rootCause: null,
            message: `${data.label} did not match on this check.`,
          };
        },
      });
    }

    const ago: string = PreviousCheckComparison.describeAgo(
      data.checkWrittenAt.getTime() - data.previous.at.getTime(),
    );

    const wasMet: boolean = PreviousCheckComparison.meetsCondition(
      data.condition,
      data.previous.value,
    );

    if (!isMetNow) {
      return {
        rootCause: null,
        message: wasMet
          ? `${data.label} did not match on this check, though it did on the previous check, ${ago}: it stopped matching.`
          : `${data.label} did not match on this check, nor on the previous check, ${ago}.`,
      };
    }

    if (wasMet) {
      return {
        rootCause: null,
        message: `${data.label} matched on this check, as it did on the previous check, ${ago}: it did not start matching on this one.`,
      };
    }

    const message: string = `${data.label} matched on this check, and did not on the previous check, ${ago}: it started matching.`;

    return { rootCause: message, message: message };
  }

  /*
   * The filter this check is judged by: the same check, on this check alone,
   * compared by the filter's own comparison (or its strict form, from a
   * previous value of 0) with the threshold - for one disk of a disk series.
   */
  public static toThisCheckFilter(data: {
    criteriaFilter: CriteriaFilter;
    filterType: FilterType;
    threshold: number;
    diskPath?: string | undefined;
  }): CriteriaFilter {
    const thisCheck: CriteriaFilter = {
      ...data.criteriaFilter,
      filterType: data.filterType,
      /*
       * A number, never its text: a threshold written as text is read with
       * parseInt by most checks (CompareCriteria.convertToNumber), which
       * would compare 615.5 as 615.
       */
      value: data.threshold,
      evaluateOverTime: false,
    };

    delete thisCheck.evaluateOverTimeOptions;

    if (data.diskPath) {
      thisCheck.serverMonitorOptions = {
        ...data.criteriaFilter.serverMonitorOptions,
        diskPath: data.diskPath,
      };
    }

    return thisCheck;
  }

  // Whether a row's value met a yes or no check's condition.
  public static meetsCondition(
    condition: MonitorCheckCondition,
    value: number,
  ): boolean {
    switch (condition.comparison) {
      case "gt":
        return value > condition.threshold;
      case "gte":
        return value >= condition.threshold;
      case "lt":
        return value < condition.threshold;
      case "lte":
        return value <= condition.threshold;
      case "eq":
        return value === condition.threshold;
      case "ne":
        return value !== condition.threshold;
      default:
        return false;
    }
  }

  /*
   * A comparison with no previous check, by the filter's If No Data
   * setting: Ignore waits, Trigger matches, Treat As Zero compares with a
   * previous check of 0, or one that did not match.
   */
  private static async applyNoDataPolicy(data: {
    criteriaFilter: CriteriaFilter;
    waitingMessage: string;
    triggeredMessage: string;
    judgeAsZero: () => Promise<CheckWindowJudgement>;
  }): Promise<CheckWindowJudgement> {
    const policy: NoDataPolicy =
      data.criteriaFilter.evaluateOverTimeOptions?.onNoDataPolicy ||
      NoDataPolicy.Ignore;

    if (policy === NoDataPolicy.Trigger) {
      return {
        rootCause: data.triggeredMessage,
        message: data.triggeredMessage,
      };
    }

    if (policy === NoDataPolicy.TreatAsZero) {
      return await data.judgeAsZero();
    }

    return { rootCause: null, message: data.waitingMessage };
  }

  /*
   * The filter as the evaluation log names it. A measured value by what it
   * checks - "Response Time (in ms)", a database metric by its name - since
   * its threshold comes from the previous check; a yes or no check as the
   * form shows it, condition and all: Response Body Contains "Error".
   */
  public static getFilterLabel(
    criteriaFilter: CriteriaFilter,
    monitorType?: MonitorType | undefined,
  ): string {
    if (
      CriteriaFilterUtil.isJudgedCheckByCheck(
        criteriaFilter.checkOn,
        monitorType,
      )
    ) {
      return CriteriaFilterMatchHistory.getFilterLabel(criteriaFilter);
    }

    const databaseMetric: DatabaseMetricDefinition | null =
      criteriaFilter.checkOn === CheckOn.DatabaseMetric &&
      criteriaFilter.databaseMonitorOptions?.metricType
        ? getDatabaseMetricByMetricType(
            criteriaFilter.databaseMonitorOptions.metricType,
          )
        : null;

    return databaseMetric?.friendlyName || criteriaFilter.checkOn;
  }

  /*
   * How this check must stand to the previous one: "more than 50% above",
   * "at least 1 below", "above" for no change, "the same as", "different
   * from".
   */
  public static describeRelation(criteriaFilter: CriteriaFilter): string {
    const change: { type: PreviousCheckChangeType; value: number } =
      CriteriaFilterUtil.getPreviousCheckChange(criteriaFilter);
    const amount: string = `${PreviousCheckComparison.formatNumber(change.value)}${
      change.type === PreviousCheckChangeType.Percentage ? "%" : ""
    }`;
    const hasChange: boolean = change.value > 0;

    switch (criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        return hasChange ? `more than ${amount} above` : "above";
      case FilterType.GreaterThanOrEqualTo:
        return hasChange ? `at least ${amount} above` : "at or above";
      case FilterType.LessThan:
        return hasChange ? `more than ${amount} below` : "below";
      case FilterType.LessThanOrEqualTo:
        return hasChange ? `at least ${amount} below` : "at or below";
      case FilterType.EqualTo:
        return "the same as";
      case FilterType.NotEqualTo:
        return "different from";
      default:
        return "compared with";
    }
  }

  // What this check's value had to be: "more than 615", "anything but 410".
  private static describeNeeded(data: {
    criteriaFilter: CriteriaFilter;
    threshold: number;
  }): string {
    const threshold: string = PreviousCheckComparison.formatNumber(
      data.threshold,
    );

    switch (data.criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        return `more than ${threshold}`;
      case FilterType.GreaterThanOrEqualTo:
        return `at least ${threshold}`;
      case FilterType.LessThan:
        return `less than ${threshold}`;
      case FilterType.LessThanOrEqualTo:
        return `at most ${threshold}`;
      case FilterType.EqualTo:
        return `exactly ${threshold}`;
      default:
        return `anything but ${threshold}`;
    }
  }

  // "1 minute ago", "3 minutes ago", "2 hours ago": rounded down.
  public static describeAgo(milliseconds: number): string {
    const minutes: number = Math.floor(
      Math.max(0, milliseconds) / MILLISECONDS_IN_A_MINUTE,
    );

    if (minutes < 1) {
      return "less than a minute ago";
    }

    if (minutes >= 120) {
      return `${Math.floor(minutes / 60)} hours ago`;
    }

    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }

  // At most two decimals: 615, 12.5, 0.33.
  public static formatNumber(value: number): string {
    return Number.isInteger(value)
      ? String(value)
      : String(Math.round(value * 100) / 100);
  }
}

/**
 * The previous checks read while one check is judged: its own evaluation,
 * every disk a criteria fans out over and its recovery filters read the
 * same previous checks of the same series, so each is read once, for every
 * group, and split up in memory. A stored check read back for probe
 * agreement was written at another time, and is read with its own.
 */
export class PreviousCheckReads {
  private readonly reads: Map<
    string,
    Promise<Map<string, MonitorPreviousCheckRow>>
  >;

  /*
   * The previous checks of each probe result being handled, beside its
   * match histories: whatever shares those reads - the check's own
   * evaluation, its disks, the probe agreement pass - shares these.
   */
  private static readonly byMatchHistoryReads: WeakMap<
    CriteriaFilterMatchHistoryReads,
    PreviousCheckReads
  > = new WeakMap<CriteriaFilterMatchHistoryReads, PreviousCheckReads>();

  public constructor() {
    this.reads = new Map<
      string,
      Promise<Map<string, MonitorPreviousCheckRow>>
    >();
  }

  public static forMatchHistoryReads(
    matchHistoryReads: CriteriaFilterMatchHistoryReads,
  ): PreviousCheckReads {
    let reads: PreviousCheckReads | undefined =
      PreviousCheckReads.byMatchHistoryReads.get(matchHistoryReads);

    if (!reads) {
      reads = new PreviousCheckReads();
      PreviousCheckReads.byMatchHistoryReads.set(matchHistoryReads, reads);
    }

    return reads;
  }

  // Every group's previous check of one source, before `before`.
  public getPreviousChecks(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    source: PreviousCheckSource;
    windowStart: Date;
    before: Date;
  }): Promise<Map<string, MonitorPreviousCheckRow>> {
    const readKey: string = JSON.stringify([
      data.projectId.toString(),
      data.monitorId.toString(),
      data.source.metricName,
      data.source.attributes,
      data.source.groupByAttributeKeys,
      data.windowStart.getTime(),
      data.before.getTime(),
    ]);

    let read: Promise<Map<string, MonitorPreviousCheckRow>> | undefined =
      this.reads.get(readKey);

    if (!read) {
      read = MetricService.readPreviousMonitorChecks({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: data.source.metricName,
        windowStart: data.windowStart,
        before: data.before,
        attributes: data.source.attributes,
        groupByAttributeKeys: data.source.groupByAttributeKeys,
      }).then((rows: Array<MonitorPreviousCheckRow>) => {
        const groups: Map<string, MonitorPreviousCheckRow> = new Map<
          string,
          MonitorPreviousCheckRow
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
