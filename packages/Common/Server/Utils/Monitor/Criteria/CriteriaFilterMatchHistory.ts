import { createHash } from "crypto";
import EvaluateOverTime from "./EvaluateOverTime";
import MonitorMetricUtil from "../MonitorMetricUtil";
import MetricService from "../../../Services/MetricService";
import Query from "../../../Types/AnalyticsDatabase/Query";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
  CRITERIA_FILTER_MATCHED_VALUE,
} from "../../../../Types/Monitor/CriteriaFilterMatchHistory";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * One check of one filter that keeps a match history: whether the filter
 * matched the response this check produced, and when the check was judged.
 */
export interface CriteriaFilterCheck {
  filterKey: string;
  matched: boolean;
  // On the server's clock, like the rows the history is written as.
  at: Date;
}

// A filter that keeps a match history, with the key its history is kept under.
export interface FilterKeepingMatchHistory {
  filterKey: string;
  criteriaFilter: CriteriaFilter;
}

/*
 * How a filter judged from its match history came out over its window.
 * `rootCause` is set exactly when the filter is met; `message` says what the
 * window held either way, for the evaluation log.
 */
export interface MatchHistoryJudgement {
  rootCause: string | null;
  message: string;
}

interface RecordedCheck {
  matched: boolean;
  at: Date;
}

const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

/**
 * Evaluating a criteria filter over a period of time when nothing records
 * what it checks.
 *
 * Response Time and Status Code are written as series on every check, so
 * "over the last 5 minutes" reads those values back (EvaluateOverTime). A
 * response body, a header, a JavaScript expression or a request timeout is
 * not. What can be recorded is whether the FILTER matched: so for every
 * filter that asks to be evaluated over time and has no series
 * (CriteriaFilterUtil.hasMatchHistory), each check writes 1 or 0 for it, and
 * the filter is then judged from that history:
 *
 *   - All Values: the filter matched on every check, and the checks reach
 *     back over the whole window (EvaluateOverTime.isWindowCovered). Until
 *     they do, the filter waits, so the first page of a restarting app does
 *     not fire it - issue #4686, a body check that fired the moment an app
 *     answered "Application starting..." instead of its title.
 *   - Any Value: the filter matched on at least one check in the window.
 *
 * This check's own result is judged here from memory, not read back: rows
 * are written after the criteria are evaluated, so the history read holds
 * only earlier checks, and "the newest check recovered" is never missed
 * because its row had not landed yet.
 *
 * The history is written for every such filter on every check, whichever
 * criteria wins (MonitorCriteriaEvaluator.processMonitorStep). A criteria
 * after the first match is not evaluated, and if its filters only wrote
 * history when evaluated, the checks the app was healthy on would be missing
 * from it - and an app that recovered for a minute would still read as
 * "every check failed".
 */
export default class CriteriaFilterMatchHistory {
  /**
   * The key a filter's history is kept under: the monitor step and what
   * the filter checks, so two identical filters share one history and a
   * filter edited to check something else starts a new one. The window and
   * the evaluation type are left out - widening the window from 5 to 10
   * minutes does not change what any past check found.
   */
  public static getFilterKey(data: {
    monitorStepId: ObjectID | string;
    criteriaFilter: CriteriaFilter;
  }): string {
    const whatItChecks: Record<string, unknown> = {
      ...(data.criteriaFilter as unknown as Record<string, unknown>),
    };

    delete whatItChecks["evaluateOverTime"];
    delete whatItChecks["evaluateOverTimeOptions"];
    delete whatItChecks["metricCriteriaContext"];

    return createHash("sha256")
      .update(
        CriteriaFilterMatchHistory.stableStringify({
          monitorStepId: data.monitorStepId.toString(),
          filter: whatItChecks,
        }),
        "utf8",
      )
      .digest("hex")
      .slice(0, 32);
  }

  /**
   * Whether this filter, on this monitor, is judged from its match history:
   * it asks to be evaluated over a period of time, says how, and checks
   * something no series records.
   *
   * A filter with the checkbox on but no window (saved before the form
   * filled one in) is not: like every other over-time filter without
   * options, it is judged on this check alone (EvaluateOverTime).
   */
  public static isJudgedFromHistory(data: {
    criteriaFilter: CriteriaFilter;
    monitorType: MonitorType | undefined;
  }): boolean {
    return (
      Boolean(data.criteriaFilter.evaluateOverTime) &&
      Boolean(data.criteriaFilter.evaluateOverTimeOptions) &&
      CriteriaFilterUtil.hasMatchHistory({
        checkOn: data.criteriaFilter.checkOn,
        monitorType: data.monitorType,
      })
    );
  }

  /**
   * Every filter of a step that keeps a match history, once per key.
   *
   * Disabled criteria are left out: they are not evaluated, and a criteria
   * switched back on should wait for a window of its own checks rather
   * than lean on checks it never judged.
   */
  public static getFiltersKeepingHistory(data: {
    monitorType: MonitorType | undefined;
    monitorStep: MonitorStep;
  }): Array<FilterKeepingMatchHistory> {
    const filters: Array<FilterKeepingMatchHistory> = [];
    const seenKeys: Set<string> = new Set<string>();

    const criteriaInstances: Array<MonitorCriteriaInstance> =
      data.monitorStep.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || [];

    for (const criteriaInstance of criteriaInstances) {
      if (!criteriaInstance.data || criteriaInstance.data.isEnabled === false) {
        continue;
      }

      for (const criteriaFilter of criteriaInstance.data.filters || []) {
        if (
          !CriteriaFilterMatchHistory.isJudgedFromHistory({
            criteriaFilter: criteriaFilter,
            monitorType: data.monitorType,
          })
        ) {
          continue;
        }

        const filterKey: string = CriteriaFilterMatchHistory.getFilterKey({
          monitorStepId: data.monitorStep.id,
          criteriaFilter: criteriaFilter,
        });

        if (seenKeys.has(filterKey)) {
          continue;
        }

        seenKeys.add(filterKey);
        filters.push({ filterKey: filterKey, criteriaFilter: criteriaFilter });
      }
    }

    return filters;
  }

  /**
   * Write one check's results. Never throws: a history that could not be
   * written makes the next windows wait longer, which is the safe way for
   * it to fail, and must not cost the monitor this evaluation.
   */
  @CaptureSpan()
  public static async record(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    probeId?: ObjectID | undefined;
    checks: Array<CriteriaFilterCheck>;
  }): Promise<void> {
    if (data.checks.length === 0) {
      return;
    }

    try {
      await MonitorMetricUtil.saveCriteriaFilterMatches({
        projectId: data.projectId,
        monitorId: data.monitorId,
        probeId: data.probeId,
        matches: data.checks.map((check: CriteriaFilterCheck) => {
          return { filterKey: check.filterKey, matched: check.matched };
        }),
      });
    } catch (err) {
      logger.error(
        `Could not record the criteria filter match history of monitor ${data.monitorId.toString()}`,
      );
      logger.error(err);
    }
  }

  /**
   * Judge a filter over its window from its match history and this check.
   *
   * The history is read only when it can change the answer. All Values is
   * settled by a check that did not match - nothing still to come can make
   * every check have matched - and Any Value by a check that did. So a
   * healthy app, whose body check does not match, costs All Values no read
   * at all.
   */
  @CaptureSpan()
  public static async judgeWindow(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    criteriaFilter: CriteriaFilter;
    check: CriteriaFilterCheck;
    // The monitor's monitoringInterval cron: how far apart checks should be.
    monitoringInterval?: string | undefined;
  }): Promise<MatchHistoryJudgement> {
    const filterLabel: string = CriteriaFilterMatchHistory.getFilterLabel(
      data.criteriaFilter,
    );

    /*
     * The dashboard has saved the window as a string, the API and Terraform
     * send a number.
     */
    const windowInMinutes: number =
      Number(data.criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes) ||
      0;

    /*
     * An aggregate saved on a yes/no check means nothing, so it is judged as
     * All Values, the stricter choice - and so is a window saved without a
     * type at all.
     */
    const isAnyValue: boolean =
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
        data.criteriaFilter,
      ) === EvaluateOverTimeType.AnyValue;

    if (windowInMinutes <= 0) {
      return CriteriaFilterMatchHistory.applyNoDataPolicy({
        criteriaFilter: data.criteriaFilter,
        waitingMessage: `${filterLabel} has no window to look back over, so it was not judged.`,
        triggeredMessage: `${filterLabel} has no window to look back over, and its If No Data setting is Trigger.`,
      });
    }

    const windowName: string =
      CriteriaFilterMatchHistory.getWindowName(windowInMinutes);

    if (isAnyValue && data.check.matched) {
      const message: string = `${filterLabel} matched on this check (Any Value over the last ${windowName}).`;

      return { rootCause: message, message: message };
    }

    if (!isAnyValue && !data.check.matched) {
      return {
        rootCause: null,
        message: `${filterLabel} did not match on this check, so it has not matched on every check over the last ${windowName}.`,
      };
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const windowStart: Date = OneUptimeDate.getSomeMinutesAgo(windowInMinutes);

    let earlierChecks: Array<RecordedCheck> = [];

    try {
      earlierChecks = await CriteriaFilterMatchHistory.readHistory({
        projectId: data.projectId,
        monitorId: data.monitorId,
        filterKey: data.check.filterKey,
        windowStart: windowStart,
        windowEnd: now,
      });
    } catch (err) {
      logger.error(
        `Could not read the criteria filter match history of monitor ${data.monitorId.toString()}`,
      );
      logger.error(err);

      // A history that cannot be read is never reported as a breach.
      return {
        rootCause: null,
        message: `The checks of the last ${windowName} could not be read, so ${filterLabel} was not judged over them.`,
      };
    }

    const checks: Array<RecordedCheck> = [
      ...earlierChecks,
      { matched: data.check.matched, at: data.check.at },
    ];

    const checkCount: number = checks.length;

    const matchedCount: number = checks.filter((check: RecordedCheck) => {
      return check.matched;
    }).length;

    if (isAnyValue) {
      // This check did not match, so only an earlier one can meet the filter.
      if (matchedCount > 0) {
        const message: string = `${filterLabel} matched on ${matchedCount} of the ${CriteriaFilterMatchHistory.countChecks(checkCount)} over the last ${windowName}, though not on this one.`;

        return { rootCause: message, message: message };
      }

      return {
        rootCause: null,
        message: `${filterLabel} did not match on ${
          checkCount === 1
            ? "the only check"
            : `any of the ${CriteriaFilterMatchHistory.countChecks(checkCount)}`
        } over the last ${windowName}.`,
      };
    }

    // All Values, and this check matched.
    if (matchedCount < checkCount) {
      return {
        rootCause: null,
        message: `${filterLabel} matched on ${matchedCount} of the ${CriteriaFilterMatchHistory.countChecks(checkCount)} over the last ${windowName}; All Values needs every check.`,
      };
    }

    const isCovered: boolean = EvaluateOverTime.isWindowCovered({
      windowStart: windowStart,
      windowEnd: now,
      sampleTimes: checks.map((check: RecordedCheck) => {
        return check.at;
      }),
      monitoringInterval: data.monitoringInterval,
    });

    if (!isCovered) {
      const soFar: string = `${filterLabel} has matched on every check for ${CriteriaFilterMatchHistory.describeCoveredTime(
        {
          checks: checks,
          now: now,
          monitoringInterval: data.monitoringInterval,
        },
      )} (${CriteriaFilterMatchHistory.countChecks(checkCount)})`;

      return CriteriaFilterMatchHistory.applyNoDataPolicy({
        criteriaFilter: data.criteriaFilter,
        waitingMessage: `${soFar}; All Values waits until it has for ${windowName}.`,
        triggeredMessage: `${soFar}, not yet ${windowName}, and its If No Data setting is Trigger.`,
      });
    }

    const message: string = `${filterLabel} matched on every check over the last ${windowName} (${CriteriaFilterMatchHistory.countChecks(checkCount)}).`;

    return { rootCause: message, message: message };
  }

  /*
   * The filter as the criteria form shows it: Response Body Not Contains
   * "App Title". Its own words, so the evaluation log names the filter the
   * user set up rather than paraphrasing it.
   */
  public static getFilterLabel(criteriaFilter: CriteriaFilter): string {
    const parts: Array<string> = [criteriaFilter.checkOn];

    if (criteriaFilter.filterType) {
      parts.push(criteriaFilter.filterType);
    }

    if (
      criteriaFilter.value !== undefined &&
      criteriaFilter.value !== null &&
      String(criteriaFilter.value).length > 0 &&
      CriteriaFilterUtil.hasValueField({
        checkOn: criteriaFilter.checkOn,
        filterType: criteriaFilter.filterType,
      })
    ) {
      parts.push(`"${String(criteriaFilter.value)}"`);
    }

    return parts.join(" ");
  }

  /*
   * What a window that cannot back the filter yet comes to, by the filter's
   * If No Data setting. Only Trigger makes it met: Ignore waits, and Treat
   * As Zero counts the missing checks as checks the filter did not match -
   * which cannot make it met either.
   */
  private static applyNoDataPolicy(data: {
    criteriaFilter: CriteriaFilter;
    waitingMessage: string;
    triggeredMessage: string;
  }): MatchHistoryJudgement {
    const policy: NoDataPolicy =
      data.criteriaFilter.evaluateOverTimeOptions?.onNoDataPolicy ||
      NoDataPolicy.Ignore;

    if (policy === NoDataPolicy.Trigger) {
      return {
        rootCause: data.triggeredMessage,
        message: data.triggeredMessage,
      };
    }

    return { rootCause: null, message: data.waitingMessage };
  }

  private static async readHistory(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    filterKey: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<RecordedCheck>> {
    const query: Query<Metric> = {
      projectId: data.projectId,
      time: new InBetween(data.windowStart, data.windowEnd),
      primaryEntityId: data.monitorId,
      name: CRITERIA_FILTER_MATCH_METRIC_NAME,
    };

    const filterKeyAttribute: JSONObject = {};
    filterKeyAttribute[CRITERIA_FILTER_KEY_ATTRIBUTE] = data.filterKey;
    query.attributes = filterKeyAttribute;

    const rows: Array<Metric> = await MetricService.findBy({
      query: query,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        value: true,
        time: true,
      },
    });

    const checks: Array<RecordedCheck> = [];

    for (const row of rows) {
      if (row.value === undefined || row.value === null || !row.time) {
        continue;
      }

      const at: Date = OneUptimeDate.fromString(row.time);

      if (isNaN(at.getTime())) {
        continue;
      }

      checks.push({
        matched: Number(row.value) === CRITERIA_FILTER_MATCHED_VALUE,
        at: at,
      });
    }

    return checks;
  }

  private static getWindowName(windowInMinutes: number): string {
    return windowInMinutes === 1 ? "minute" : `${windowInMinutes} minutes`;
  }

  private static countChecks(count: number): string {
    return count === 1 ? "1 check" : `${count} checks`;
  }

  /*
   * How much time the checks have covered so far, counted the way the
   * coverage rule counts it (EvaluateOverTime.isWindowCovered): each check
   * stands for the interval before it. Five checks a minute apart cover five
   * minutes, which is when a five minute window is met - so "matched for 4
   * minutes" is never followed, one check later, by "matched over the last 5
   * minutes" as if a minute had gone missing.
   */
  private static describeCoveredTime(data: {
    checks: Array<RecordedCheck>;
    now: Date;
    monitoringInterval?: string | undefined;
  }): string {
    const sortedCheckTimes: Array<number> = data.checks
      .map((check: RecordedCheck) => {
        return check.at.getTime();
      })
      .sort((a: number, b: number) => {
        return a - b;
      });

    const intervalInSeconds: number | null =
      EvaluateOverTime.getSamplingIntervalInSeconds({
        monitoringInterval: data.monitoringInterval,
        sortedSampleTimes: sortedCheckTimes,
      });

    const coveredMs: number =
      data.now.getTime() -
      (sortedCheckTimes[0] ?? data.now.getTime()) +
      (intervalInSeconds || 0) * 1000;

    const minutes: number = Math.floor(coveredMs / MILLISECONDS_IN_A_MINUTE);

    if (minutes < 1) {
      return "less than a minute";
    }

    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  /*
   * JSON with object keys sorted at every depth, so a filter read back from
   * Postgres (jsonb hands keys back in its own order) keeps the key it was
   * written under.
   */
  private static stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value
        .map((item: unknown): string => {
          return CriteriaFilterMatchHistory.stableStringify(item);
        })
        .join(",")}]`;
    }

    if (value !== null && typeof value === "object") {
      const record: Record<string, unknown> = value as Record<string, unknown>;

      return `{${Object.keys(record)
        .filter((key: string): boolean => {
          return record[key] !== undefined;
        })
        .sort()
        .map((key: string): string => {
          return `${JSON.stringify(key)}:${CriteriaFilterMatchHistory.stableStringify(record[key])}`;
        })
        .join(",")}}`;
    }

    return JSON.stringify(value === undefined ? null : value);
  }
}
