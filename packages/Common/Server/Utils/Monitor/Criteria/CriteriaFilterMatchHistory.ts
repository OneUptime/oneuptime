import { createHash } from "crypto";
import EvaluateOverTime from "./EvaluateOverTime";
import MonitorMetricUtil from "../MonitorMetricUtil";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import logger from "../../Logger";
import Metric from "../../../../Models/AnalyticsModels/Metric";
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
import stableStringify from "../../../../Utils/StableStringify";

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

// A check of a filter as its history holds it, with the probe that made it.
export interface RecordedMatch {
  matched: boolean;
  at: Date;
  probeId: string | undefined;
}

interface JudgedCheck {
  matched: boolean;
  at: Date;
}

// Why a run of matching checks, followed back from the newest, stops.
enum RunStart {
  // The check before it did not match.
  CheckNotMatched = "CheckNotMatched",
  // Too long went by between it and the check before it.
  GapInChecks = "GapInChecks",
  // Nothing was recorded before it.
  HistoryStart = "HistoryStart",
}

const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

/*
 * Two checks more than two and a half monitoring intervals apart have at
 * least two checks missing between them - the probe was down, the monitor
 * was paused, or their rows could not be written. A run of matching checks
 * is not followed back across such a gap: nobody knows what the missing
 * checks found. One missing check (two intervals) is bridged, so a single
 * row that failed to write does not cost a whole window.
 */
const GAP_IN_CHECKS_FACTOR: number = 2.5;

/*
 * A run of matching checks counts as reaching back over the window when it
 * starts at most a quarter of the monitoring interval (and of the window)
 * short of it. Checks land a few seconds off their schedule; without this, a
 * check that arrived late would push the decision to the next check.
 */
const RUN_START_ALLOWANCE_FACTOR: number = 0.25;

/*
 * A stored check is stamped as it is stored, and its row is written once it
 * has been evaluated, a moment later. A row of the same probe at or after
 * this long before the stamp is that check's own row.
 */
const STORED_CHECK_ROW_ALLOWANCE_MS: number = 2000;

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
 * the filter is then judged from that history, one probe's checks at a time:
 *
 *   - All Values: the filter has matched on every check for the whole
 *     window. The run of matching checks is followed back from the newest
 *     one, and must reach back to the start of the window, over no gap in
 *     the checks (GAP_IN_CHECKS_FACTOR). Until it does the filter waits, so
 *     a restarting app's placeholder page fires nothing until it has lasted
 *     the window - issue #4686, a body check that fired the moment an app
 *     answered "Application starting..." instead of its title. A single
 *     check never lasts a window: on a monitor checked every 5 minutes, a
 *     5 minute window takes two checks in a row.
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
   * minutes does not change what any past check found - and so is anything
   * a re-save can write differently without changing what is checked
   * (normalizeForKey).
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
        stableStringify({
          monitorStepId: data.monitorStepId.toString(),
          filter:
            CriteriaFilterMatchHistory.normalizeForKey(whatItChecks) || {},
        }),
        "utf8",
      )
      .digest("hex")
      .slice(0, 32);
  }

  /**
   * Whether this filter, on this monitor, is judged from its match history:
   * it asks to be evaluated over a period of time, over a window of some
   * minutes, and checks something no series records.
   *
   * A filter with the checkbox on but no window - none saved, or no minutes
   * in it (through the API, or a cleared dropdown) - is not: it is judged
   * on this check alone, as it always was, rather than by its If No Data
   * setting on every check.
   */
  public static isJudgedFromHistory(data: {
    criteriaFilter: CriteriaFilter;
    monitorType: MonitorType | undefined;
  }): boolean {
    return (
      Boolean(data.criteriaFilter.evaluateOverTime) &&
      CriteriaFilterUtil.getEvaluateOverTimeMinutes(data.criteriaFilter) > 0 &&
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
   * Write one check's results. Never throws, so a history that could not be
   * written never costs the monitor this evaluation. The check is missing
   * from the history instead: one missing check is bridged, and two or more
   * in a row are a gap the run of matching checks is not followed across
   * (judgeWindow), so All Values waits a new window rather than read over
   * checks nobody saw.
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
   * Each probe is judged by its own checks: on a monitor checked from
   * several probes, a placeholder page one region is served must not be
   * diluted by the real page another region gets, and the probe agreement
   * pass then counts the probes that agree.
   *
   * The window ends at the probe's newest check, so the probe agreement
   * pass, judging another probe's stored check, comes to what that probe
   * came to itself - it never assumes a probe still sees what it saw a
   * minute ago. A probe whose newest check is older than a gap in its
   * checks has no checks to judge the window by.
   *
   * The history is read only when it can change the answer. All Values is
   * settled by a newest check that did not match, and Any Value by one that
   * did. So a healthy app, whose body check does not match, costs All Values
   * no read at all.
   */
  @CaptureSpan()
  public static async judgeWindow(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    // The probe that made the check. Each probe is judged by its own checks.
    probeId?: ObjectID | undefined;
    criteriaFilter: CriteriaFilter;
    check: CriteriaFilterCheck;
    /*
     * The check was read back from where it was stored - the probe
     * agreement pass judging another probe's last check - rather than having
     * just arrived. Its row was written when it arrived, so it is not
     * counted again.
     */
    isStoredCheck?: boolean | undefined;
    // The monitor's monitoringInterval cron: how far apart checks should be.
    monitoringInterval?: string | undefined;
    /*
     * The reads of the probe result being handled, shared by every filter
     * and every probe judged for it. A one-off read when not passed.
     */
    reads?: CriteriaFilterMatchHistoryReads | undefined;
  }): Promise<MatchHistoryJudgement> {
    const filterLabel: string = CriteriaFilterMatchHistory.getFilterLabel(
      data.criteriaFilter,
    );

    const windowInMinutes: number =
      CriteriaFilterUtil.getEvaluateOverTimeMinutes(data.criteriaFilter);

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
      /*
       * Never reached from the evaluator (isJudgedFromHistory), and judged
       * the way the evaluator judges such a filter: on this check alone.
       */
      const message: string = `${filterLabel} ${
        data.check.matched ? "matched" : "did not match"
      } on this check, and has no window to look back over.`;

      return {
        rootCause: data.check.matched ? message : null,
        message: message,
      };
    }

    const windowName: string =
      CriteriaFilterMatchHistory.getWindowName(windowInMinutes);
    const windowMs: number = windowInMinutes * MILLISECONDS_IN_A_MINUTE;

    const reads: CriteriaFilterMatchHistoryReads =
      data.reads || new CriteriaFilterMatchHistoryReads();
    const now: Date = reads.now;

    const scheduledIntervalMs: number | null =
      CriteriaFilterMatchHistory.toMilliseconds(
        EvaluateOverTime.getSamplingIntervalInSeconds({
          monitoringInterval: data.monitoringInterval,
          sortedSampleTimes: [],
        }),
      );

    /*
     * The check is its probe's newest. One that just arrived settles the
     * answer on its own; so does a stored one while it is recent, but a
     * stale one is judged with the history, which says how stale.
     */
    const isRecentCheck: boolean =
      !data.isStoredCheck ||
      (scheduledIntervalMs !== null &&
        now.getTime() - data.check.at.getTime() <=
          GAP_IN_CHECKS_FACTOR * scheduledIntervalMs);

    if (isRecentCheck && isAnyValue && data.check.matched) {
      const message: string = `${filterLabel} matched on this check (Any Value over the last ${windowName}).`;

      return { rootCause: message, message: message };
    }

    if (isRecentCheck && !isAnyValue && !data.check.matched) {
      return {
        rootCause: null,
        message: `${filterLabel} did not match on this check, so it has not matched on every check over the last ${windowName}.`,
      };
    }

    /*
     * Back far enough for the check the run of matching checks may start
     * from, a gap before the window, and for another probe's newest check,
     * which may be a gap old.
     */
    const lookBackMs: number =
      2 *
      (scheduledIntervalMs === null
        ? windowMs
        : GAP_IN_CHECKS_FACTOR * scheduledIntervalMs);

    const readFrom: Date = new Date(now.getTime() - windowMs - lookBackMs);

    let recordedMatches: Array<RecordedMatch> = [];

    try {
      recordedMatches = (
        await reads.getMatches({
          projectId: data.projectId,
          monitorId: data.monitorId,
          filterKey: data.check.filterKey,
          from: readFrom,
        })
      ).filter((match: RecordedMatch) => {
        return data.probeId
          ? match.probeId === data.probeId.toString()
          : !match.probeId;
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

    const checks: Array<JudgedCheck> = recordedMatches.map(
      (match: RecordedMatch): JudgedCheck => {
        return { matched: match.matched, at: match.at };
      },
    );

    const isCheckRecorded: boolean =
      Boolean(data.isStoredCheck) &&
      recordedMatches.some((match: RecordedMatch) => {
        return (
          match.at.getTime() >=
          data.check.at.getTime() - STORED_CHECK_ROW_ALLOWANCE_MS
        );
      });

    let thisCheck: JudgedCheck | null = null;

    if (!isCheckRecorded && data.check.at.getTime() >= readFrom.getTime()) {
      thisCheck = { matched: data.check.matched, at: data.check.at };
      checks.push(thisCheck);
    }

    checks.sort((a: JudgedCheck, b: JudgedCheck) => {
      return a.at.getTime() - b.at.getTime();
    });

    const newestCheck: JudgedCheck | undefined = checks[checks.length - 1];

    if (!newestCheck) {
      return CriteriaFilterMatchHistory.applyNoDataPolicy({
        criteriaFilter: data.criteriaFilter,
        waitingMessage: `${filterLabel} has no checks over the last ${windowName}, so it was not judged.`,
        triggeredMessage: `${filterLabel} has no checks over the last ${windowName}, and its If No Data setting is Trigger.`,
      });
    }

    /*
     * The monitor's schedule; without one, the typical gap between its
     * checks. Not the widest gap, as a series window takes it: a gap is
     * measured against the interval, and would never be wider than itself.
     */
    const intervalMs: number | null =
      scheduledIntervalMs ?? CriteriaFilterMatchHistory.getTypicalGapMs(checks);

    const gapInChecksMs: number | null =
      intervalMs === null ? null : GAP_IN_CHECKS_FACTOR * intervalMs;

    const sinceNewestCheckMs: number = now.getTime() - newestCheck.at.getTime();

    if (gapInChecksMs !== null && sinceNewestCheckMs > gapInChecksMs) {
      const silence: string =
        CriteriaFilterMatchHistory.describeDuration(sinceNewestCheckMs);

      return CriteriaFilterMatchHistory.applyNoDataPolicy({
        criteriaFilter: data.criteriaFilter,
        waitingMessage: `${filterLabel} has not been checked for ${silence}, so it was not judged over the last ${windowName}.`,
        triggeredMessage: `${filterLabel} has not been checked for ${silence}, and its If No Data setting is Trigger.`,
      });
    }

    const windowEndMs: number = newestCheck.at.getTime();
    const windowStartMs: number = windowEndMs - windowMs;

    const windowChecks: Array<JudgedCheck> = checks.filter(
      (check: JudgedCheck) => {
        return check.at.getTime() >= windowStartMs;
      },
    );

    const checkCount: number = windowChecks.length;

    const matchedCount: number = windowChecks.filter((check: JudgedCheck) => {
      return check.matched;
    }).length;

    if (isAnyValue) {
      if (matchedCount > 0) {
        const notOnThisOne: string =
          newestCheck === thisCheck && !newestCheck.matched
            ? ", though not on this one"
            : "";

        const message: string = `${filterLabel} matched on ${matchedCount} of the ${CriteriaFilterMatchHistory.countChecks(checkCount)} over the last ${windowName}${notOnThisOne}.`;

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

    if (matchedCount < checkCount && !newestCheck.matched) {
      return {
        rootCause: null,
        message: `${filterLabel} matched on ${matchedCount} of the ${CriteriaFilterMatchHistory.countChecks(checkCount)} over the last ${windowName}; All Values needs every check.`,
      };
    }

    /*
     * The newest check matched. Follow the run of matching checks back from
     * it: how long has the filter matched on every check? That is what the
     * evaluation log says while the filter waits - "has matched on every
     * check for 3 minutes (4 checks)" - rather than how many checks of the
     * window matched: a window that still holds the healthy checks from
     * before the run (an app that was fine until it restarted) says nothing
     * of how long is left to wait.
     */
    let runStartIndex: number = checks.length - 1;
    let runStart: RunStart = RunStart.HistoryStart;
    let gapBeforeRunMs: number = 0;

    for (let index: number = checks.length - 2; index >= 0; index--) {
      const gapMs: number =
        checks[index + 1]!.at.getTime() - checks[index]!.at.getTime();

      if (gapInChecksMs !== null && gapMs > gapInChecksMs) {
        runStart = RunStart.GapInChecks;
        gapBeforeRunMs = gapMs;
        break;
      }

      if (!checks[index]!.matched) {
        runStart = RunStart.CheckNotMatched;
        break;
      }

      runStartIndex = index;
    }

    const runCheckCount: number = checks.length - runStartIndex;
    const runLastedMs: number =
      windowEndMs - checks[runStartIndex]!.at.getTime();

    const runStartAllowanceMs: number =
      intervalMs === null
        ? 0
        : RUN_START_ALLOWANCE_FACTOR * Math.min(intervalMs, windowMs);

    /*
     * Met only when every check of the window matched, as All Values says,
     * and the run lasts the window.
     */
    if (
      matchedCount === checkCount &&
      runLastedMs >= windowMs - runStartAllowanceMs
    ) {
      const message: string = `${filterLabel} matched on every check over the last ${windowName} (${CriteriaFilterMatchHistory.countChecks(checkCount)}).`;

      return { rootCause: message, message: message };
    }

    const sinceGap: string =
      runStart === RunStart.GapInChecks
        ? ` since a ${CriteriaFilterMatchHistory.describeGap(gapBeforeRunMs)} gap in its checks`
        : "";

    const soFar: string =
      runCheckCount === 1
        ? `${filterLabel} has matched on 1 check${sinceGap || " so far"}`
        : `${filterLabel} has matched on every check for ${CriteriaFilterMatchHistory.describeDuration(
            runLastedMs,
          )} (${CriteriaFilterMatchHistory.countChecks(runCheckCount)})${sinceGap}`;

    const waitingMessage: string = `${soFar}; All Values waits until it has matched on every check for ${windowName}.`;

    if (runStart === RunStart.CheckNotMatched || matchedCount < checkCount) {
      /*
       * A check before the run did not match, in the window or just before
       * it: the history reaches back, and says the run is younger than the
       * window. That is no missing data, so If No Data has no say.
       */
      return { rootCause: null, message: waitingMessage };
    }

    // Nothing recorded before the run, or a gap: the history falls short.
    return CriteriaFilterMatchHistory.applyNoDataPolicy({
      criteriaFilter: data.criteriaFilter,
      waitingMessage: waitingMessage,
      triggeredMessage: `${soFar}, not yet for ${windowName}, and its If No Data setting is Trigger.`,
    });
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
   * Every probe's checks of one filter from `from` to `to`. Rows that cannot
   * be read are skipped.
   *
   * Newest first: a read of every probe's checks over a long window can
   * reach the row limit, and what it then leaves out must be the oldest
   * checks - a history that starts later, which makes All Values wait -
   * never checks at random from the middle of a run.
   */
  public static async readMatches(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    filterKey: string;
    from: Date;
    to: Date;
  }): Promise<Array<RecordedMatch>> {
    const filterKeyAttribute: JSONObject = {};
    filterKeyAttribute[CRITERIA_FILTER_KEY_ATTRIBUTE] = data.filterKey;

    const rows: Array<Metric> = await EvaluateOverTime.readWindowRows({
      projectId: data.projectId,
      monitorId: data.monitorId,
      metricName: CRITERIA_FILTER_MATCH_METRIC_NAME,
      windowStart: data.from,
      windowEnd: data.to,
      attributes: filterKeyAttribute,
      selectAttributes: true,
      newestFirst: true,
    });

    const matches: Array<RecordedMatch> = [];

    for (const row of rows) {
      if (row.value === undefined || row.value === null || !row.time) {
        continue;
      }

      const at: Date = OneUptimeDate.fromString(row.time);

      if (isNaN(at.getTime())) {
        continue;
      }

      const probeId: unknown = row.attributes?.["probeId"];

      matches.push({
        matched: Number(row.value) === CRITERIA_FILTER_MATCHED_VALUE,
        at: at,
        probeId: probeId ? String(probeId) : undefined,
      });
    }

    return matches;
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

  /*
   * A filter as its key sees it. A form re-save can write the same filter
   * differently - a field null, empty or left out, a number as its digits -
   * without changing what it checks, and must not start its history over:
   * empty values are dropped at every depth, and every other value is
   * compared as its text, so 5 and "5" are one value.
   */
  private static normalizeForKey(value: unknown): unknown {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (Array.isArray(value)) {
      const items: Array<unknown> = value
        .map((item: unknown): unknown => {
          return CriteriaFilterMatchHistory.normalizeForKey(item);
        })
        .filter((item: unknown): boolean => {
          return item !== undefined;
        });

      return items.length > 0 ? items : undefined;
    }

    if (typeof value === "object") {
      const record: Record<string, unknown> = value as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};

      for (const key of Object.keys(record)) {
        const item: unknown = CriteriaFilterMatchHistory.normalizeForKey(
          record[key],
        );

        if (item !== undefined) {
          normalized[key] = item;
        }
      }

      return Object.keys(normalized).length > 0 ? normalized : undefined;
    }

    const text: string = String(value);

    return text.length > 0 ? text : undefined;
  }

  /*
   * The lower median of the gaps between consecutive checks (the checks
   * sorted oldest first): what the cadence is most of the time, so the gaps
   * that are not stand out. Checks written at the same moment say nothing
   * of the cadence and are left out. Null without two checks apart.
   */
  private static getTypicalGapMs(checks: Array<JudgedCheck>): number | null {
    const gaps: Array<number> = [];

    for (let index: number = 1; index < checks.length; index++) {
      const gapMs: number =
        checks[index]!.at.getTime() - checks[index - 1]!.at.getTime();

      if (gapMs > 0) {
        gaps.push(gapMs);
      }
    }

    if (gaps.length === 0) {
      return null;
    }

    gaps.sort((a: number, b: number) => {
      return a - b;
    });

    return gaps[Math.floor((gaps.length - 1) / 2)]!;
  }

  private static toMilliseconds(seconds: number | null): number | null {
    return seconds === null || seconds <= 0 ? null : seconds * 1000;
  }

  private static getWindowName(windowInMinutes: number): string {
    return windowInMinutes === 1 ? "minute" : `${windowInMinutes} minutes`;
  }

  private static countChecks(count: number): string {
    return count === 1 ? "1 check" : `${count} checks`;
  }

  // 3 minutes, 1 minute, less than a minute: whole minutes, rounded down.
  private static describeDuration(milliseconds: number): string {
    const minutes: number = Math.floor(milliseconds / MILLISECONDS_IN_A_MINUTE);

    if (minutes < 1) {
      return "less than a minute";
    }

    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }

  // 13-minute, as in "a 13-minute gap"; seconds below a minute.
  private static describeGap(milliseconds: number): string {
    const minutes: number = Math.floor(milliseconds / MILLISECONDS_IN_A_MINUTE);

    if (minutes < 1) {
      return `${Math.max(1, Math.floor(milliseconds / 1000))}-second`;
    }

    return `${minutes}-minute`;
  }
}

/**
 * The match histories read while one probe result is handled.
 *
 * A probe result is judged by its own probe, and, on a monitor checked from
 * several probes, the probe agreement pass then judges every other probe's
 * last check. Each probe is judged by its own checks, but each filter's
 * history is read once here, for every probe, and split up in memory -
 * otherwise the agreement pass would read it once per probe, on every
 * probe's every check.
 *
 * Everything judged through one instance is judged as of the moment it was
 * made, which is what lets the reads be shared.
 */
export class CriteriaFilterMatchHistoryReads {
  public readonly now: Date;

  private readonly reads: Map<string, Promise<Array<RecordedMatch>>>;

  public constructor() {
    this.now = OneUptimeDate.getCurrentDate();
    this.reads = new Map<string, Promise<Array<RecordedMatch>>>();
  }

  // Every probe's checks of one filter, from `from` until this instance's now.
  public getMatches(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    filterKey: string;
    from: Date;
  }): Promise<Array<RecordedMatch>> {
    const readKey: string = [
      data.projectId.toString(),
      data.monitorId.toString(),
      data.filterKey,
      data.from.getTime().toString(),
    ].join("|");

    let read: Promise<Array<RecordedMatch>> | undefined =
      this.reads.get(readKey);

    if (!read) {
      read = CriteriaFilterMatchHistory.readMatches({
        projectId: data.projectId,
        monitorId: data.monitorId,
        filterKey: data.filterKey,
        from: data.from,
        to: this.now,
      });

      this.reads.set(readKey, read);
    }

    return read;
  }
}
