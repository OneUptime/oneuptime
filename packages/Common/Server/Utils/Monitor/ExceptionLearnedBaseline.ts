import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Project from "../../../Models/DatabaseModels/Project";
import Service from "../../../Models/DatabaseModels/Service";
import { DEFAULT_RETENTION_IN_DAYS } from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import {
  AnomalyDetectionMethod,
  FilterType,
  MetricAnomalyDetectionOptions,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  EXCEPTION_BASELINE_MINIMUM_WEEKS,
  ExceptionAnomalySettings,
  getExceptionAnomalySettings,
} from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import ExceptionMonitorResponse, {
  ExceptionLearnedBaseline,
} from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import GlobalCache from "../../Infrastructure/GlobalCache";
import ExceptionInstanceService from "../../Services/ExceptionInstanceService";
import ProjectService from "../../Services/ProjectService";
import ServiceService from "../../Services/ServiceService";
import AnalyticsQuery from "../../Types/AnalyticsDatabase/Query";
import logger from "../Logger";
import CountAnomaly, {
  CountAnomalyEvaluation,
  CountBaselineStats,
} from "./Criteria/CountAnomaly";
import crypto from "crypto";

/*
 * WHAT IS NORMAL FOR AN EXCEPTIONS MONITOR, LEARNED FROM ITS OWN HISTORY.
 *
 * Exception Count with an anomaly condition compares the window's count with
 * the same hours of the earlier weeks, so a Monday-morning peak is normal on
 * a Monday morning and the same count at 3am on a Sunday is not, and a slow
 * climb over several days shows as soon as it leaves last week's range.
 *
 * It shares what every anomaly condition shares (FilterType.Anomalously*,
 * the sensitivities, the CountAnomaly math) and differs in two ways, because
 * exceptions are not logs or spans:
 *
 *   - It reads the monitor's own query, not a rollup. A rollup keeps the
 *     dimensions it was built with, and an Exceptions monitor also filters
 *     on message text, infrastructure entities and which exception groups
 *     are resolved or archived right now. Its window's count is read with
 *     all of them; a baseline read with fewer would be a wider count than
 *     the one it judges, and a narrow monitor would never leave its range.
 *     Occurrences are sorted by time, so the few hours read here cost far
 *     less than the 24 hours Exception Increase counts on every check. What
 *     it trades away is depth: history is what OneUptime still keeps (15
 *     days unless a service or project says otherwise).
 *   - It is built for sparse counts. Logs and spans baseline the minutes
 *     that held something, per minute. An exception-free minute is the
 *     normal case, not a missing sample: read that way, a service throwing
 *     one exception a day looks like one throwing one a minute, or has no
 *     spread at all and is never judged. So the baseline here is one count
 *     per window of the monitor's own length, zeros included
 *     (toWindowCounts), no narrower than chance makes a count
 *     (CountAnomaly.withCountingNoise), and a window under the minimum
 *     count never reads as unusually high.
 *
 * The earlier weeks do not change, so a baseline is cached for the hour it
 * was read in, per monitor scope: an hour's worth of checks makes one read
 * of each earlier week. Silence is only evidence where the service existed
 * and OneUptime still holds what it threw (getHistoryStart), so a new
 * service stays Learning, and alerts on nothing, however much it throws. A
 * service quiet for months does not: quiet is what its baseline says, and a
 * real burst is a spike.
 */

const HOUR_IN_MS: number = 60 * 60 * 1000;
const WEEK_IN_MS: number = 7 * 24 * HOUR_IN_MS;

/*
 * At least this many of the monitor's windows are read per earlier week, so
 * a long window has some around it to compare with, not one sample a week.
 */
export const EXCEPTION_BASELINE_MINIMUM_WINDOWS_PER_WEEK: number = 3;

export const EXCEPTION_BASELINE_CACHE_NAMESPACE: string =
  "exception-learned-baseline";

/*
 * An hour: a baseline's key names the hours it was read for, so it is not
 * asked for again after that. What it read does not change meanwhile; the
 * resolved and archived exceptions it leaves out are in the key.
 */
export const EXCEPTION_BASELINE_CACHE_SECONDS: number = 60 * 60;

// One earlier week to read: the hours around the same time, in whole windows.
export interface ExceptionBaselineWeek {
  weeksBack: number;
  start: Date;
  end: Date;
  windowCount: number;
}

export enum ExceptionAnomalyState {
  // Too little history to compare with: nothing alerts.
  Learning = "Learning",
  Normal = "Normal",
  Anomalous = "Anomalous",
}

export interface ExceptionAnomalyJudgement {
  state: ExceptionAnomalyState;
  settings: ExceptionAnomalySettings;
  count: number;
  windowSeconds: number | undefined;
  weeksOfHistory: number;
  sampleCount: number;
  // The range as whole exceptions: a count inside it is normal. 0 to 0 while learning.
  expectedLow: number;
  expectedHigh: number;
  center: number;
  // (count - center) / spread: signed, in standard deviations.
  observedSigma: number;
}

export default class ExceptionLearnedBaselineUtil {
  /*
   * The earlier weeks a baseline reads: the clock hours the window touches,
   * in each of the `windowDays / 7` weeks before it. The same hours for the
   * whole hour, which is what lets it be cached. A window that straddles
   * two hours reads both, as a rhythm changes on the hour: judged against
   * only one, the window that reaches into the morning peak would read as a
   * spike. Rounded out to whole windows of the monitor's length, on the
   * boundaries countPerWindow groups by.
   *
   * None for a window of a week or more: it has no earlier week of its own.
   */
  public static getWeeks(data: {
    windowStart: Date;
    windowEnd: Date;
    windowSeconds: number;
    windowDays: number;
  }): Array<ExceptionBaselineWeek> {
    const windowInMs: number = data.windowSeconds * 1000;

    if (windowInMs >= WEEK_IN_MS) {
      return [];
    }

    let from: number =
      Math.floor(data.windowStart.getTime() / HOUR_IN_MS) * HOUR_IN_MS;
    let to: number =
      Math.ceil(data.windowEnd.getTime() / HOUR_IN_MS) * HOUR_IN_MS;

    const shortBy: number =
      Math.min(
        EXCEPTION_BASELINE_MINIMUM_WINDOWS_PER_WEEK * windowInMs,
        WEEK_IN_MS,
      ) -
      (to - from);

    if (shortBy > 0) {
      from -= Math.ceil(shortBy / 2);
      to += Math.ceil(shortBy / 2);
    }

    const weeks: Array<ExceptionBaselineWeek> = [];

    for (
      let weeksBack: number = 1;
      weeksBack <= Math.floor(data.windowDays / 7);
      weeksBack++
    ) {
      const start: number =
        Math.floor((from - weeksBack * WEEK_IN_MS) / windowInMs) * windowInMs;
      const end: number =
        Math.ceil((to - weeksBack * WEEK_IN_MS) / windowInMs) * windowInMs;

      weeks.push({
        weeksBack,
        start: new Date(start),
        end: new Date(end),
        windowCount: Math.round((end - start) / windowInMs),
      });
    }

    return weeks;
  }

  /*
   * One count per window of a week, zeros included: countPerWindow returns
   * only the windows that held something, and the ones that held nothing
   * are most of what a quiet service's baseline is. An occurrence at the
   * very end of the range is the next window's, so it is left out.
   */
  public static toWindowCounts(data: {
    week: ExceptionBaselineWeek;
    windowSeconds: number;
    counts: Array<{ time: Date; count: number }>;
  }): Array<number> {
    const windowCounts: Array<number> = new Array<number>(
      data.week.windowCount,
    ).fill(0);
    const windowInMs: number = data.windowSeconds * 1000;

    for (const { time, count } of data.counts) {
      const index: number = Math.floor(
        (time.getTime() - data.week.start.getTime()) / windowInMs,
      );

      if (index >= 0 && index < windowCounts.length) {
        windowCounts[index] = windowCounts[index]! + count;
      }
    }

    return windowCounts;
  }

  // What the windows of the earlier weeks say, one list of counts per week.
  public static summarize(data: {
    windowDays: number;
    windowSeconds: number;
    weeks: Array<Array<number>>;
  }): ExceptionLearnedBaseline {
    const stats: CountBaselineStats | null = CountAnomaly.computeStats(
      data.weeks.flat(),
    );

    return {
      windowDays: data.windowDays,
      windowSeconds: data.windowSeconds,
      weeksOfHistory: data.weeks.length,
      ...(stats
        ? CountAnomaly.withCountingNoise(stats)
        : {
            sampleCount: 0,
            mean: 0,
            stddev: 0,
            median: 0,
            madSigma: 0,
            minObserved: 0,
            maxObserved: 0,
          }),
    };
  }

  /*
   * Whether a window's count is normal for its hour of the week, as an
   * anomaly condition with these options reads it. No baseline, or one
   * with too little history, is Learning, never a breach. An unusually high
   * count also needs the minimum count: a service that throws almost
   * nothing has almost no range, and its first few are not a spike.
   */
  public static judge(data: {
    count: number;
    baseline: ExceptionLearnedBaseline | undefined;
    filterType: FilterType | undefined;
    options: MetricAnomalyDetectionOptions | undefined;
  }): ExceptionAnomalyJudgement {
    const settings: ExceptionAnomalySettings = getExceptionAnomalySettings(
      data.options,
    );
    const baseline: ExceptionLearnedBaseline | undefined = data.baseline;

    const judgement: ExceptionAnomalyJudgement = {
      state: ExceptionAnomalyState.Learning,
      settings,
      count: data.count,
      windowSeconds: baseline?.windowSeconds,
      weeksOfHistory: baseline?.weeksOfHistory || 0,
      sampleCount: baseline?.sampleCount || 0,
      expectedLow: 0,
      expectedHigh: 0,
      center: 0,
      observedSigma: 0,
    };

    if (
      !baseline ||
      baseline.weeksOfHistory < EXCEPTION_BASELINE_MINIMUM_WEEKS ||
      baseline.sampleCount < settings.minSamples
    ) {
      return judgement;
    }

    const evaluation: CountAnomalyEvaluation | null = CountAnomaly.evaluate({
      observed: data.count,
      stats: baseline,
      sigmaCount: settings.sigmaCount,
      method: settings.method,
      filterType: data.filterType,
    });

    if (!evaluation) {
      return judgement;
    }

    const isTooFewToAlert: boolean =
      data.count > evaluation.center && data.count < settings.minimumCount;
    const expectedHigh: number = Math.floor(evaluation.expectedHigh);

    return {
      ...judgement,
      state:
        evaluation.breaches && !isTooFewToAlert
          ? ExceptionAnomalyState.Anomalous
          : ExceptionAnomalyState.Normal,
      expectedLow: Math.min(
        Math.max(0, Math.ceil(evaluation.expectedLow)),
        expectedHigh,
      ),
      expectedHigh,
      center: evaluation.center,
      observedSigma: evaluation.observedSigma,
    };
  }

  // The baseline a filter's options read: the one of its baseline window.
  public static getBaseline(
    response: Pick<ExceptionMonitorResponse, "exceptionLearnedBaselines">,
    options: MetricAnomalyDetectionOptions | undefined,
  ): ExceptionLearnedBaseline | undefined {
    const windowDays: number = getExceptionAnomalySettings(options).windowDays;

    return response.exceptionLearnedBaselines?.find(
      (baseline: ExceptionLearnedBaseline) => {
        return baseline.windowDays === windowDays;
      },
    );
  }

  /*
   * The range a judgement read, and how far outside it the window was, for
   * what the alert or incident says. Only for an Anomalous judgement.
   */
  public static describeBreach(judgement: ExceptionAnomalyJudgement): string {
    const { settings, count } = judgement;
    const isAbove: boolean = count > judgement.expectedHigh;
    const distance: number = isAbove
      ? count - judgement.expectedHigh
      : judgement.expectedLow - count;
    const centerName: string =
      settings.method === AnomalyDetectionMethod.MedianMad
        ? "median"
        : "average";
    const window: string = judgement.windowSeconds
      ? ` over the last ${ExceptionLearnedBaselineUtil.describeDuration(judgement.windowSeconds)}`
      : "";

    return (
      `Exception count ${count}${window} is ${isAbove ? "above" : "below"} ` +
      `the ${judgement.expectedLow} to ${judgement.expectedHigh} expected for this hour of the week, by ${distance}: ` +
      `${Math.abs(judgement.observedSigma).toFixed(2)}σ from the ${centerName} of ${judgement.center.toFixed(2)} ` +
      `(${judgement.sampleCount} windows over ${judgement.weeksOfHistory} weeks, ` +
      `${ExceptionLearnedBaselineUtil.describeThreshold(settings)}).`
    );
  }

  // What the status timeline says the window was, whatever the verdict.
  public static describeObservation(
    judgement: ExceptionAnomalyJudgement,
  ): string {
    const { count, expectedLow, expectedHigh, settings } = judgement;

    if (judgement.state === ExceptionAnomalyState.Learning) {
      return `Exception count was ${count}. Still learning what is normal for this hour of the week: ${judgement.weeksOfHistory} of the ${EXCEPTION_BASELINE_MINIMUM_WEEKS} weeks of history it needs.`;
    }

    const range: string = `the ${expectedLow} to ${expectedHigh} expected for this hour of the week`;

    if (count > expectedHigh) {
      return judgement.state === ExceptionAnomalyState.Normal &&
        count < settings.minimumCount
        ? `Exception count was ${count}, above ${range}, but under the ${settings.minimumCount} it takes to alert.`
        : `Exception count was ${count}, above ${range}.`;
    }

    if (count < expectedLow) {
      return `Exception count was ${count}, below ${range}.`;
    }

    return `Exception count was ${count}, within ${range}.`;
  }

  /*
   * The baseline of one baseline window: from the cache, or read from the
   * earlier weeks the monitor's history reaches. `countQuery` is the query
   * of the window's own count, filters and left-out exceptions included.
   */
  public static async read(data: {
    projectId: ObjectID;
    telemetryServiceIds: Array<ObjectID> | undefined;
    countQuery: AnalyticsQuery<ExceptionInstance>;
    windowStart: Date;
    windowEnd: Date;
    windowSeconds: number;
    windowDays: number;
  }): Promise<ExceptionLearnedBaseline> {
    const weeks: Array<ExceptionBaselineWeek> =
      ExceptionLearnedBaselineUtil.getWeeks(data);

    if (weeks.length === 0) {
      return ExceptionLearnedBaselineUtil.summarize({ ...data, weeks: [] });
    }

    const cacheKey: string = ExceptionLearnedBaselineUtil.getCacheKey({
      ...data,
      week: weeks[0]!,
    });

    const cached: ExceptionLearnedBaseline | null =
      await ExceptionLearnedBaselineUtil.getCached(cacheKey);

    if (cached) {
      return cached;
    }

    const historyStart: Date =
      await ExceptionLearnedBaselineUtil.getHistoryStart({
        projectId: data.projectId,
        telemetryServiceIds: data.telemetryServiceIds || [],
        now: data.windowEnd,
      });

    const weeksOfHistory: Array<ExceptionBaselineWeek> = weeks.filter(
      (week: ExceptionBaselineWeek) => {
        return week.start.getTime() >= historyStart.getTime();
      },
    );

    const baseline: ExceptionLearnedBaseline =
      ExceptionLearnedBaselineUtil.summarize({
        windowDays: data.windowDays,
        windowSeconds: data.windowSeconds,
        weeks: await Promise.all(
          weeksOfHistory.map(
            async (week: ExceptionBaselineWeek): Promise<Array<number>> => {
              return ExceptionLearnedBaselineUtil.toWindowCounts({
                week,
                windowSeconds: data.windowSeconds,
                counts: await ExceptionInstanceService.countPerWindow({
                  query: {
                    ...data.countQuery,
                    time: new InBetween(week.start, week.end),
                  },
                  timeColumnName: "time",
                  windowInSeconds: data.windowSeconds,
                  props: { isRoot: true },
                }),
              });
            },
          ),
        ),
      });

    await ExceptionLearnedBaselineUtil.setCached(cacheKey, baseline);

    return baseline;
  }

  /*
   * Where silence stops being evidence: no earlier than the monitor's
   * services existed - the oldest of them, since exceptions of a service
   * added later are a real change to the count - and no earlier than
   * OneUptime still holds them, by the shortest retention among them, as a
   * week that has expired reads as a week without exceptions. A monitor
   * without services watches its whole project.
   */
  private static async getHistoryStart(data: {
    projectId: ObjectID;
    telemetryServiceIds: Array<ObjectID>;
    now: Date;
  }): Promise<Date> {
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { createdAt: true, defaultTelemetryRetentionInDays: true },
      props: { isRoot: true },
    });

    const projectRetentionInDays: number =
      project?.defaultTelemetryRetentionInDays || DEFAULT_RETENTION_IN_DAYS;

    const services: Array<Service> =
      data.telemetryServiceIds.length > 0
        ? await ServiceService.findBy({
            query: {
              projectId: data.projectId,
              _id: new Includes(data.telemetryServiceIds),
            },
            select: { createdAt: true, retainTelemetryDataForDays: true },
            skip: 0,
            limit: data.telemetryServiceIds.length,
            props: { isRoot: true },
          })
        : [];

    const retentionInDays: number =
      services.length > 0
        ? Math.min(
            ...services.map((service: Service): number => {
              return (
                service.retainTelemetryDataForDays || projectRetentionInDays
              );
            }),
          )
        : projectRetentionInDays;

    const existedSince: Array<number> = (
      services.length > 0 ? services : [project]
    )
      .map((item: Service | Project | null): number => {
        return item?.createdAt ? new Date(item.createdAt).getTime() : NaN;
      })
      .filter((time: number): boolean => {
        return Number.isFinite(time);
      });

    /*
     * Nothing says when it began: read as beginning now, so it learns
     * rather than taking the silence before it for a quiet service.
     */
    const firstExisted: number =
      existedSince.length > 0 ? Math.min(...existedSince) : data.now.getTime();

    return new Date(
      Math.max(
        firstExisted,
        data.now.getTime() - retentionInDays * 24 * HOUR_IN_MS,
      ),
    );
  }

  /*
   * What decides a baseline: the monitor's filters and left-out exceptions,
   * the window's length, the baseline window and the hours read. Monitors
   * that ask the same share one read.
   */
  private static getCacheKey(data: {
    projectId: ObjectID;
    countQuery: AnalyticsQuery<ExceptionInstance>;
    windowSeconds: number;
    windowDays: number;
    week: ExceptionBaselineWeek;
  }): string {
    const scope: string = JSON.stringify(
      JSONFunctions.anyObjectToJSONObject({
        query: { ...data.countQuery, time: undefined },
        windowSeconds: data.windowSeconds,
        windowDays: data.windowDays,
        start: data.week.start,
        end: data.week.end,
      }),
    );

    return `${data.projectId.toString()}:${crypto
      .createHash("sha256")
      .update(scope)
      .digest("hex")}`;
  }

  // The cache only saves a read: without it, a check still reads and judges.
  private static async getCached(
    key: string,
  ): Promise<ExceptionLearnedBaseline | null> {
    try {
      return (await GlobalCache.getJSONObject(
        EXCEPTION_BASELINE_CACHE_NAMESPACE,
        key,
      )) as unknown as ExceptionLearnedBaseline | null;
    } catch (err) {
      logger.debug("Could not read a learned exception baseline from cache");
      logger.debug(err);
      return null;
    }
  }

  private static async setCached(
    key: string,
    baseline: ExceptionLearnedBaseline,
  ): Promise<void> {
    try {
      await GlobalCache.setJSON(
        EXCEPTION_BASELINE_CACHE_NAMESPACE,
        key,
        baseline as unknown as JSONObject,
        { expiresInSeconds: EXCEPTION_BASELINE_CACHE_SECONDS },
      );
    } catch (err) {
      logger.debug("Could not cache a learned exception baseline");
      logger.debug(err);
    }
  }

  private static describeThreshold(settings: ExceptionAnomalySettings): string {
    const threshold: string = `threshold ${settings.sigmaCount}σ`;

    return settings.sigmaCount ===
      getExceptionAnomalySettings({ sensitivity: settings.sensitivity })
        .sigmaCount
      ? `sensitivity ${settings.sensitivity}`
      : threshold;
  }

  // "15 minutes", "1 hour": a window in the largest unit that is whole.
  private static describeDuration(seconds: number): string {
    const units: Array<{ name: string; seconds: number }> = [
      { name: "day", seconds: 24 * 60 * 60 },
      { name: "hour", seconds: 60 * 60 },
      { name: "minute", seconds: 60 },
    ];

    for (const unit of units) {
      if (seconds % unit.seconds === 0) {
        const count: number = seconds / unit.seconds;

        return `${count} ${unit.name}${count === 1 ? "" : "s"}`;
      }
    }

    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
}
