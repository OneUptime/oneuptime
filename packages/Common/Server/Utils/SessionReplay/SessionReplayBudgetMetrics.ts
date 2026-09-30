import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import TelemetryUtil from "../Telemetry/Telemetry";
import SessionReplayUsage from "./SessionReplayUsage";
import GlobalConfigService from "../../Services/GlobalConfigService";
import MetricService from "../../Services/MetricService";
import ProjectService from "../../Services/ProjectService";
import RumApplicationService from "../../Services/RumApplicationService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Project from "../../../Models/DatabaseModels/Project";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SessionReplayBudgetMetricType from "../../../Types/Rum/SessionReplayBudgetMetricType";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import SessionReplayBudgetMetricTypeUtil, {
  SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE,
  SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_ID_ATTRIBUTE,
  SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE,
} from "../../../Utils/SessionReplay/SessionReplayBudgetMetricType";

/*
 * Publishes the two session replay storage budgets as metrics, so running out
 * of one can page someone instead of only turning a meter red on the Replay
 * Health page.
 *
 * The budgets themselves are Redis counters the ingest gate charges
 * (SessionReplayUsage keys, SessionReplayRateLimiter): one per project per
 * UTC day against the deployment's daily limit, and one per application per
 * UTC month against the budget a customer set on it. Once either is spent
 * the recorders are told to stop, quietly - which is the whole problem this
 * solves. The worker job (App/FeatureSet/Workers/Jobs/Rum/
 * PublishSessionReplayBudgetMetrics.ts) calls publishAll() every five
 * minutes, and it posts the `oneuptime.rum.session.replay.budget.*` gauges
 * (SessionReplayBudgetMetricType) that ordinary Metrics monitors - and the
 * RUM application's one-click alert templates - alert on. Same shape as the
 * LLM cost budgets: the budget never alerts directly.
 *
 * What a point means, and when there is none:
 *
 *  - Rows are keyed to a RUM application (primaryEntityId = its id,
 *    RealUserMonitor), because that is the scope a monitor on one
 *    application filters by. The project's daily figure is therefore posted
 *    under EVERY application of the project that records, with the same
 *    value, and carries only a projectId attribute: it is the project's
 *    budget, not that application's usage.
 *  - Only applications that have ever recorded a replay are swept
 *    (sessionReplayLastChunkReceivedAt set). Replay is on by default for
 *    every RUM application, so "enabled" alone would post the project's
 *    figure under applications that only send web vitals.
 *  - The monthly series exists only while the application has a monthly
 *    budget, because the gate only charges the monthly counter then.
 *  - Zero usage posts nothing: a zero cannot cross a threshold, and five
 *    minutes of rows for every idle application would buy no alert.
 *  - An unreadable counter posts nothing, never 0 - a 0 would read as "no
 *    usage" to every monitor watching the series.
 *
 * A monitor on these series must use a window of at least three sweeps
 * (15 minutes): a window with no point in it resolves open incidents.
 */

// Applications per keyset page. Two MGETs of at most 500 keys each.
export const SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE: number = 500;

/*
 * A page whose Project query or insert throws is skipped and the sweep moves
 * on - but three in a row means ClickHouse or Postgres is down for everyone,
 * and the remaining pages would only repeat the same error. (A failed catalog
 * write does not fail its page: the rows are already written, and a later
 * sweep registers the names.)
 */
export const SESSION_REPLAY_BUDGET_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES: number = 3;

/*
 * Same knob and default as monitor and SLO metrics
 * (GlobalConfig.monitorMetricRetentionInDays). Never longer: the metric table
 * drops whole daily partitions (ttl_only_drop_parts), so a long retention on
 * any row pins its day for that long.
 */
const DEFAULT_RETENTION_DAYS: number = 30;

// "GB" in session replay is GiB everywhere: the gate, /config and the UI.
const BYTES_PER_GIB: number = 1024 * 1024 * 1024;

/*
 * Why a sweep ended. Only "done" means every application was looked at.
 */
export type SessionReplayBudgetSweepStopReason =
  | "done"
  | "counters-unavailable"
  | "page-fetch-failed"
  | "too-many-failed-pages"
  | "deadline"
  | "lock-lost";

export interface SessionReplayBudgetSweepOptions {
  /*
   * The deployment's daily byte limit, as the ingest gate enforces it
   * (App/FeatureSet/Telemetry/Config.ts). Passed in rather than parsed here,
   * so the worker and the gate cannot grow a third copy of the env parse.
   */
  dailyByteLimit: number;

  /*
   * Checked between pages. The job passes `() => mutex.isAcquired`, so a
   * sweep stops early once it knows it lost its lock - which it learns at
   * the lock's next refresh. The deadline is what keeps a sweep out of the
   * next tick's way; this only ends a lockless one sooner.
   */
  shouldContinue?: (() => boolean) | undefined;

  /*
   * Stop between pages once this passes. The job's timeout cannot cancel a
   * sweep, and a sweep still writing when the next tick starts would stamp
   * stale rows with a time that is no longer "now".
   */
  deadline?: Date | undefined;
}

export interface SessionReplayBudgetSweepSummary {
  stopReason: SessionReplayBudgetSweepStopReason;
  dailyByteLimit: number;
  pagesScanned: number;
  pagesFailed: number;
  applicationsScanned: number;
  rowsWritten: number;
  /*
   * Set when some project's daily counter is more than twice the limit this
   * worker was given - which cannot happen while the worker and the ingest
   * pods agree on the limit (see isDailyLimitMismatchSuspected).
   */
  dailyLimitMismatchSuspected: boolean;
}

/*
 * One application as the sweep needs it, read off its RumApplication row.
 */
export interface SessionReplayBudgetApplication {
  rumApplicationId: ObjectID;
  projectId: ObjectID;
  name: string;
  monthlyBudgetInBytes: number | null;
}

interface PageResult {
  countersAvailable: boolean;
  rowsWritten: number;
  dailyLimitMismatchSuspected: boolean;
}

export default class SessionReplayBudgetMetrics {
  /*
   * Percent of a budget used, rounded DOWN to 0.01 so that ">= 100" holds
   * exactly when the gate considers the budget spent (counter >= limit):
   * rounding to nearest would read 100.00 a byte early, while the gate is
   * still letting uploads through, and page someone for a stop that has not
   * happened. Not capped at 100 - the request that crosses the limit stays
   * charged, and a budget lowered below usage is honestly over it.
   *
   * null when there is no usable limit; a negative count (a refund that
   * straddled 00:00 UTC) reads as 0.
   */
  public static computePercentUsed(data: {
    usedBytes: number;
    limitBytes: number;
  }): number | null {
    if (!Number.isFinite(data.limitBytes) || data.limitBytes <= 0) {
      return null;
    }

    if (!Number.isFinite(data.usedBytes)) {
      return null;
    }

    const usedBytes: number = Math.max(0, data.usedBytes);

    return Math.floor((usedBytes / data.limitBytes) * 10000) / 100;
  }

  /*
   * An application's monthly budget in bytes, or null for "no budget" - the
   * gate's rule exactly: only a finite number above 0 is a ceiling, and it is
   * GiB rounded down to a whole byte.
   */
  public static getMonthlyBudgetInBytes(
    monthlyBudgetInGB: unknown,
  ): number | null {
    const gigabytes: number =
      typeof monthlyBudgetInGB === "number"
        ? monthlyBudgetInGB
        : typeof monthlyBudgetInGB === "string" &&
            monthlyBudgetInGB.trim().length > 0
          ? Number(monthlyBudgetInGB)
          : NaN;

    if (!Number.isFinite(gigabytes) || gigabytes <= 0) {
      return null;
    }

    return Math.floor(gigabytes * BYTES_PER_GIB);
  }

  /*
   * Once a sweep has seen more than twice the limit on a daily counter, the
   * worker and the ingest pods are almost certainly reading different values
   * of SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY: the gate leaves a spent
   * counter at most one request over its own limit. The percentages this
   * worker posts are then measured against the wrong limit.
   */
  public static isDailyLimitMismatchSuspected(data: {
    usedBytes: number;
    dailyByteLimit: number;
  }): boolean {
    return (
      Number.isFinite(data.dailyByteLimit) &&
      data.dailyByteLimit > 0 &&
      data.usedBytes > data.dailyByteLimit * 2
    );
  }

  /*
   * The rows one application gets in one sweep: the project's daily pair when
   * the project has used anything today, and its own monthly pair when it has
   * a budget and has used any of it. Pure, so the series shape is testable
   * without a sweep around it.
   */
  public static buildApplicationRows(data: {
    application: SessionReplayBudgetApplication;
    projectDailyUsedBytes: number | null;
    applicationMonthlyUsedBytes: number | null;
    dailyByteLimit: number;
    ingestionDate: Date;
    retentionDate: Date;
  }): Array<JSONObject> {
    const rows: Array<JSONObject> = [];

    const pushPair: (pair: {
      bytesMetric: SessionReplayBudgetMetricType;
      percentMetric: SessionReplayBudgetMetricType;
      usedBytes: number | null;
      limitBytes: number | null;
      attributes: JSONObject;
    }) => void = (pair: {
      bytesMetric: SessionReplayBudgetMetricType;
      percentMetric: SessionReplayBudgetMetricType;
      usedBytes: number | null;
      limitBytes: number | null;
      attributes: JSONObject;
    }): void => {
      if (pair.usedBytes === null || !Number.isFinite(pair.usedBytes)) {
        return;
      }

      const usedBytes: number = Math.max(0, pair.usedBytes);

      if (usedBytes === 0) {
        return;
      }

      rows.push(
        this.buildMetricRow({
          projectId: data.application.projectId,
          rumApplicationId: data.application.rumApplicationId,
          metricType: pair.bytesMetric,
          value: usedBytes,
          attributes: pair.attributes,
          ingestionDate: data.ingestionDate,
          retentionDate: data.retentionDate,
        }),
      );

      const percentUsed: number | null =
        pair.limitBytes === null
          ? null
          : this.computePercentUsed({
              usedBytes: usedBytes,
              limitBytes: pair.limitBytes,
            });

      if (percentUsed !== null) {
        rows.push(
          this.buildMetricRow({
            projectId: data.application.projectId,
            rumApplicationId: data.application.rumApplicationId,
            metricType: pair.percentMetric,
            value: percentUsed,
            attributes: pair.attributes,
            ingestionDate: data.ingestionDate,
            retentionDate: data.retentionDate,
          }),
        );
      }
    };

    pushPair({
      bytesMetric: SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
      percentMetric: SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      usedBytes: data.projectDailyUsedBytes,
      limitBytes: data.dailyByteLimit,
      attributes: {
        [SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE]:
          data.application.projectId.toString(),
      },
    });

    if (data.application.monthlyBudgetInBytes !== null) {
      const monthlyAttributes: JSONObject = {
        [SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE]:
          data.application.projectId.toString(),
        [SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_ID_ATTRIBUTE]:
          data.application.rumApplicationId.toString(),
      };

      if (data.application.name.trim().length > 0) {
        monthlyAttributes[
          SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE
        ] = data.application.name;
      }

      pushPair({
        bytesMetric: SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
        percentMetric:
          SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
        usedBytes: data.applicationMonthlyUsedBytes,
        limitBytes: data.application.monthlyBudgetInBytes,
        attributes: monthlyAttributes,
      });
    }

    return rows;
  }

  // Row shape must stay in lockstep with MonitorMetricUtil.buildMonitorMetricRow.
  public static buildMetricRow(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    metricType: SessionReplayBudgetMetricType;
    value: number;
    attributes: JSONObject;
    ingestionDate: Date;
    retentionDate: Date;
  }): JSONObject {
    const ingestionTimestamp: string = OneUptimeDate.toClickhouseDateTime(
      data.ingestionDate,
    );
    const timeUnixNano: string = OneUptimeDate.toUnixNano(
      data.ingestionDate,
    ).toString();

    // A copy per row, so no two rows share (and can mutate) one object.
    const attributes: JSONObject = { ...data.attributes };
    const attributeKeys: Array<string> =
      TelemetryUtil.getAttributeKeys(attributes);

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      primaryEntityId: data.rumApplicationId.toString(),
      primaryEntityType: ServiceType.RealUserMonitor,
      name: data.metricType,
      aggregationTemporality: null,
      // A reading of a counter at one moment, i.e. a Gauge.
      metricPointType: MetricPointType.Gauge,
      time: ingestionTimestamp,
      startTime: null,
      timeUnixNano: timeUnixNano,
      startTimeUnixNano: null,
      attributes: attributes,
      attributeKeys: attributeKeys,
      isMonotonic: null,
      count: null,
      sum: null,
      min: null,
      max: null,
      bucketCounts: [],
      explicitBounds: [],
      value: data.value,
      retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
    } as JSONObject;
  }

  /*
   * Read an application row into what the sweep needs. null for a row that
   * cannot be keyed (no id or no project), which the sweep skips.
   */
  public static toBudgetApplication(
    application: RumApplication,
  ): SessionReplayBudgetApplication | null {
    const rumApplicationId: ObjectID | null = application.id;
    const projectId: ObjectID | undefined = application.projectId;

    if (!rumApplicationId || !projectId) {
      return null;
    }

    return {
      rumApplicationId: rumApplicationId,
      projectId: projectId,
      name: typeof application.name === "string" ? application.name : "",
      monthlyBudgetInBytes: this.getMonthlyBudgetInBytes(
        (application as unknown as JSONObject)[
          "sessionReplayMonthlyBudgetInGB"
        ],
      ),
    };
  }

  /*
   * One sweep over every application that records session replay. Never
   * throws: every failure ends in the summary and the logs, and the next tick
   * starts over.
   */
  @CaptureSpan()
  public static async publishAll(
    options: SessionReplayBudgetSweepOptions,
  ): Promise<SessionReplayBudgetSweepSummary> {
    const summary: SessionReplayBudgetSweepSummary = {
      stopReason: "done",
      dailyByteLimit: options.dailyByteLimit,
      pagesScanned: 0,
      pagesFailed: 0,
      applicationsScanned: 0,
      rowsWritten: 0,
      dailyLimitMismatchSuspected: false,
    };

    /*
     * One timestamp for the whole sweep, so every application's points from
     * this tick land on the same x and the project's shared daily value reads
     * as one reading, not as many.
     */
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      await this.getRetentionDays(),
    );

    // (project, metric name) pairs already put in the catalog this tick.
    const registeredMetricNames: Set<string> = new Set<string>();

    let cursor: ObjectID | undefined = undefined;
    let consecutiveFailedPages: number = 0;

    for (;;) {
      if (options.shouldContinue && !options.shouldContinue()) {
        summary.stopReason = "lock-lost";
        logger.warn(
          `SessionReplayBudgetMetrics: stopping after ${summary.pagesScanned} page(s) - the sweep lock was lost.`,
        );
        break;
      }

      if (
        options.deadline &&
        OneUptimeDate.getCurrentDate().getTime() >= options.deadline.getTime()
      ) {
        summary.stopReason = "deadline";
        logger.warn(
          `SessionReplayBudgetMetrics: stopping after ${summary.pagesScanned} page(s) - the sweep ran out of time; the next tick starts over.`,
        );
        break;
      }

      let rows: Array<RumApplication>;

      try {
        rows = await RumApplicationService.findBy({
          query: {
            isSessionReplayEnabled: true,
            sessionReplayLastChunkReceivedAt: QueryHelper.notNull(),
            ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
          },
          select: {
            _id: true,
            projectId: true,
            name: true,
            sessionReplayMonthlyBudgetInGB: true,
          },
          sort: {
            _id: SortOrder.Ascending,
          },
          skip: 0,
          limit: SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE,
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        /*
         * Without the page there is no cursor to move past it, so the rest of
         * the sweep cannot run.
         */
        summary.stopReason = "page-fetch-failed";
        logger.error(
          `SessionReplayBudgetMetrics: could not read the applications after ${cursor ? cursor.toString() : "the start"}; ending this sweep.`,
        );
        logger.error(err);
        break;
      }

      if (rows.length === 0) {
        break;
      }

      const lastId: ObjectID | null = rows[rows.length - 1]!.id;

      if (!lastId || (cursor && lastId.toString() <= cursor.toString())) {
        summary.stopReason = "page-fetch-failed";
        logger.error(
          `SessionReplayBudgetMetrics: the application page after ${cursor ? cursor.toString() : "the start"} did not advance the cursor; ending this sweep.`,
        );
        break;
      }

      // Moved before the page is processed, so a failed page is never retried.
      const pageStart: string = cursor ? cursor.toString() : "the start";
      cursor = lastId;

      summary.pagesScanned++;
      summary.applicationsScanned += rows.length;

      try {
        const result: PageResult = await this.publishPage({
          rows: rows,
          dailyByteLimit: options.dailyByteLimit,
          ingestionDate: ingestionDate,
          retentionDate: retentionDate,
          registeredMetricNames: registeredMetricNames,
        });

        if (!result.countersAvailable) {
          summary.stopReason = "counters-unavailable";
          logger.warn(
            `SessionReplayBudgetMetrics: the budget counters could not be read from Redis, so the applications after ${pageStart} are not published this tick (${summary.rowsWritten} row(s) from earlier pages were; an unknown count is never posted as 0).`,
          );
          break;
        }

        summary.rowsWritten += result.rowsWritten;

        if (result.dailyLimitMismatchSuspected) {
          summary.dailyLimitMismatchSuspected = true;
        }

        consecutiveFailedPages = 0;
      } catch (err) {
        summary.pagesFailed++;
        consecutiveFailedPages++;

        logger.error(
          `SessionReplayBudgetMetrics: could not publish the ${rows.length} application(s) after ${pageStart}; skipping them this tick.`,
        );
        logger.error(err);

        if (
          consecutiveFailedPages >=
          SESSION_REPLAY_BUDGET_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES
        ) {
          summary.stopReason = "too-many-failed-pages";
          logger.error(
            `SessionReplayBudgetMetrics: ${consecutiveFailedPages} pages in a row failed; ending this sweep.`,
          );
          break;
        }
      }

      if (rows.length < SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE) {
        break;
      }
    }

    if (summary.dailyLimitMismatchSuspected) {
      logger.warn(
        `SessionReplayBudgetMetrics: a project's daily session replay counter is more than twice the daily limit this worker uses (${options.dailyByteLimit} bytes). The ingest pods probably read a different SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY, so the published daily percentages are measured against the wrong limit - set it for every component (on Helm, in the chart-wide extraEnv, and also in app.extraEnv or worker.extraEnv if either is set, because a component's own list replaces the chart-wide one).`,
      );
    }

    logger.debug(
      `SessionReplayBudgetMetrics: ${summary.stopReason} - ${summary.applicationsScanned} application(s) in ${summary.pagesScanned} page(s), ${summary.rowsWritten} row(s) written, ${summary.pagesFailed} page(s) failed, daily limit ${options.dailyByteLimit} bytes.`,
    );

    return summary;
  }

  /*
   * One page: drop applications whose project has replay switched off, read
   * every counter the page needs in one batch, write the rows, and register
   * the names written. Throws on a Project query or insert failure (the
   * sweep skips the page); a catalog failure is logged and swallowed in
   * registerMetricNames. Reports unreadable counters separately, because
   * those end the sweep.
   */
  @CaptureSpan()
  private static async publishPage(data: {
    rows: Array<RumApplication>;
    dailyByteLimit: number;
    ingestionDate: Date;
    retentionDate: Date;
    registeredMetricNames: Set<string>;
  }): Promise<PageResult> {
    const candidates: Array<SessionReplayBudgetApplication> = [];

    for (const row of data.rows) {
      const application: SessionReplayBudgetApplication | null =
        this.toBudgetApplication(row);

      if (application) {
        candidates.push(application);
      }
    }

    const projectIds: Array<string> = Array.from(
      new Set<string>(
        candidates.map((application: SessionReplayBudgetApplication) => {
          return application.projectId.toString();
        }),
      ),
    );

    if (projectIds.length === 0) {
      return {
        countersAvailable: true,
        rowsWritten: 0,
        dailyLimitMismatchSuspected: false,
      };
    }

    /*
     * The project-wide switch. The gate refuses every upload of a project
     * that has it off before charging a byte, so its counters can only hold
     * what was sent before it was switched off today.
     */
    const allowedProjects: Array<Project> = await ProjectService.findBy({
      query: {
        _id: QueryHelper.any(projectIds),
        isSessionReplayAllowed: true,
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: projectIds.length,
      props: {
        isRoot: true,
      },
    });

    const allowedProjectIds: Set<string> = new Set<string>(
      allowedProjects
        .map((project: Project) => {
          return project.id?.toString() || "";
        })
        .filter((id: string) => {
          return id.length > 0;
        }),
    );

    const applications: Array<SessionReplayBudgetApplication> =
      candidates.filter((application: SessionReplayBudgetApplication) => {
        return allowedProjectIds.has(application.projectId.toString());
      });

    if (applications.length === 0) {
      return {
        countersAvailable: true,
        rowsWritten: 0,
        dailyLimitMismatchSuspected: false,
      };
    }

    /*
     * One daily key per project (it is the project's counter, however many of
     * its applications are on the page) and one monthly key per application
     * with a budget, all in one batch.
     */
    const keys: Array<string> = [];
    const dailyKeyIndexByProject: Map<string, number> = new Map<
      string,
      number
    >();
    const monthlyKeyIndexByApplication: Map<string, number> = new Map<
      string,
      number
    >();

    for (const application of applications) {
      const projectKey: string = application.projectId.toString();

      if (!dailyKeyIndexByProject.has(projectKey)) {
        dailyKeyIndexByProject.set(projectKey, keys.length);
        keys.push(
          SessionReplayUsage.getDailyProjectByteKey(application.projectId),
        );
      }

      if (application.monthlyBudgetInBytes !== null) {
        monthlyKeyIndexByApplication.set(
          application.rumApplicationId.toString(),
          keys.length,
        );
        keys.push(
          SessionReplayUsage.getMonthlyApplicationByteKey({
            projectId: application.projectId,
            rumApplicationId: application.rumApplicationId,
          }),
        );
      }
    }

    const counters: Array<number> | null =
      await SessionReplayUsage.readByteCounters(keys);

    if (counters === null) {
      return {
        countersAvailable: false,
        rowsWritten: 0,
        dailyLimitMismatchSuspected: false,
      };
    }

    const readCounter: (index: number | undefined) => number | null = (
      index: number | undefined,
    ): number | null => {
      if (index === undefined) {
        return null;
      }

      const value: number | undefined = counters[index];

      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };

    let dailyLimitMismatchSuspected: boolean = false;

    for (const index of dailyKeyIndexByProject.values()) {
      const usedBytes: number | null = readCounter(index);

      if (
        usedBytes !== null &&
        this.isDailyLimitMismatchSuspected({
          usedBytes: usedBytes,
          dailyByteLimit: data.dailyByteLimit,
        })
      ) {
        dailyLimitMismatchSuspected = true;
      }
    }

    const metricRows: Array<JSONObject> = [];
    const metricNamesByProject: Map<
      string,
      Set<SessionReplayBudgetMetricType>
    > = new Map<string, Set<SessionReplayBudgetMetricType>>();

    for (const application of applications) {
      const applicationRows: Array<JSONObject> = this.buildApplicationRows({
        application: application,
        projectDailyUsedBytes: readCounter(
          dailyKeyIndexByProject.get(application.projectId.toString()),
        ),
        applicationMonthlyUsedBytes: readCounter(
          monthlyKeyIndexByApplication.get(
            application.rumApplicationId.toString(),
          ),
        ),
        dailyByteLimit: data.dailyByteLimit,
        ingestionDate: data.ingestionDate,
        retentionDate: data.retentionDate,
      });

      if (applicationRows.length === 0) {
        continue;
      }

      const projectKey: string = application.projectId.toString();
      const names: Set<SessionReplayBudgetMetricType> =
        metricNamesByProject.get(projectKey) ||
        new Set<SessionReplayBudgetMetricType>();

      for (const row of applicationRows) {
        metricRows.push(row);
        names.add(row["name"] as SessionReplayBudgetMetricType);
      }

      metricNamesByProject.set(projectKey, names);
    }

    if (metricRows.length === 0) {
      return {
        countersAvailable: true,
        rowsWritten: 0,
        dailyLimitMismatchSuspected: dailyLimitMismatchSuspected,
      };
    }

    // One insert per page, however many applications it covers.
    await MetricService.insertJsonRows(metricRows);

    await this.registerMetricNames({
      metricNamesByProject: metricNamesByProject,
      registeredMetricNames: data.registeredMetricNames,
    });

    return {
      countersAvailable: true,
      rowsWritten: metricRows.length,
      dailyLimitMismatchSuspected: dailyLimitMismatchSuspected,
    };
  }

  /*
   * Registering a name is what puts the series in the metric picker and the
   * Metrics-monitor builder (they read MetricType rows), with the unit charts
   * and thresholds convert from. Awaited one project at a time and only once
   * per (project, name) per sweep: a page can span hundreds of projects, and
   * each registration can reach Postgres whenever its cache fence has lapsed.
   * Only names actually written, and never with services - RUM applications
   * are not Service rows.
   */
  private static async registerMetricNames(data: {
    metricNamesByProject: Map<string, Set<SessionReplayBudgetMetricType>>;
    registeredMetricNames: Set<string>;
  }): Promise<void> {
    for (const [projectId, names] of data.metricNamesByProject) {
      const metricNameServiceNameMap: Dictionary<MetricType> = {};

      for (const name of names) {
        const registrationKey: string = `${projectId}:${name}`;

        if (data.registeredMetricNames.has(registrationKey)) {
          continue;
        }

        const metricType: MetricType = new MetricType();
        metricType.name = name;
        metricType.description =
          SessionReplayBudgetMetricTypeUtil.getDescription(name);
        metricType.unit = SessionReplayBudgetMetricTypeUtil.getUnit(name);

        metricNameServiceNameMap[name] = metricType;
      }

      const newNames: Array<string> = Object.keys(metricNameServiceNameMap);

      if (newNames.length === 0) {
        continue;
      }

      try {
        await TelemetryUtil.indexMetricNameServiceNameMap({
          projectId: new ObjectID(projectId),
          metricNameServiceNameMap: metricNameServiceNameMap,
        });

        for (const name of newNames) {
          data.registeredMetricNames.add(`${projectId}:${name}`);
        }
      } catch (err) {
        /*
         * The rows are already written; a catalog miss only delays the names
         * appearing in the picker until a later sweep registers them.
         */
        logger.error(
          `SessionReplayBudgetMetrics: could not register the session replay budget metric names for project ${projectId}.`,
        );
        logger.error(err);
      }
    }
  }

  /*
   * Read once per sweep: the sweep runs every five minutes, so there is no
   * burst of lookups to cache away.
   */
  private static async getRetentionDays(): Promise<number> {
    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: {
            _id: ObjectID.getZeroObjectID().toString(),
          },
          select: {
            monitorMetricRetentionInDays: true,
          },
          props: {
            isRoot: true,
          },
        });

      const retentionInDays: unknown =
        globalConfig?.monitorMetricRetentionInDays;

      /*
       * Zero or less would stamp a retention date at or before the row's own
       * time, and ClickHouse would drop the point as soon as its part merged.
       */
      if (
        typeof retentionInDays === "number" &&
        Number.isFinite(retentionInDays) &&
        retentionInDays > 0
      ) {
        return retentionInDays;
      }
    } catch (err) {
      logger.error(
        "SessionReplayBudgetMetrics: could not read the monitor metric retention; using the default.",
      );
      logger.error(err);
    }

    return DEFAULT_RETENTION_DAYS;
  }
}
