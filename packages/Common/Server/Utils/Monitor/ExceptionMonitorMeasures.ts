import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  EXCEPTION_BASELINE_LOOKBACK_SECONDS,
  ExceptionMonitorNeeds,
  getExceptionIncreasePercent,
  getExceptionMonitorNeeds,
  getUsualExceptionCount,
} from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import ExceptionInstanceService from "../../Services/ExceptionInstanceService";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import AnalyticsQuery from "../../Types/AnalyticsDatabase/Query";
import DatabaseQuery from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * WHAT AN EXCEPTIONS MONITOR READS BEYOND ITS COUNT, WHEN ITS CRITERIA ASK.
 *
 * New and regressed exceptions are exception groups (TelemetryException, in
 * Postgres): their first seen and their regressed at are kept on the group,
 * filtered by the monitor's services, exception types, environments and
 * message. An infrastructure entity is a property of each occurrence, not of
 * the group, so a monitor with an entity filter counts the groups of the
 * occurrences it counts: the fingerprints of the window's matching
 * occurrences (ExceptionInstance, in ClickHouse) are read first, and only
 * their groups are counted - a merged exception's fingerprint counting for
 * the exception it was merged into, as every lookup by fingerprint does
 * (TelemetryExceptionService.withMergedFingerprintAliases). A monitor
 * without one reads exactly what it always did. The usual count is the
 * monitor's own occurrence count over the day before its window, with the
 * same filters and the same resolved and archived exceptions left out,
 * spread over windows of its length. Each is read only when a criteria
 * checks it (getExceptionMonitorNeeds).
 */

/*
 * The most fingerprints the groups of an entity filter are counted among.
 * More than that in one window is not a set of new exceptions: past it, the
 * groups of the first ones are counted, and it is logged.
 */
export const ENTITY_FINGERPRINT_LIMIT: number = 5000;

export interface ExceptionMonitorMeasures {
  newExceptionCount?: number | undefined;
  regressedExceptionCount?: number | undefined;
  exceptionCountBaseline?: number | undefined;
  exceptionCountIncreasePercent?: number | undefined;
}

export default class ExceptionMonitorMeasureReader {
  public static async read(data: {
    projectId: ObjectID;
    monitorStep: MonitorStep;
    config: MonitorStepExceptionMonitor;
    // The occurrence count query of the window, resolved and archived left out.
    countQuery: AnalyticsQuery<ExceptionInstance>;
    exceptionCount: number;
    evaluateUntil?: Date | undefined;
  }): Promise<ExceptionMonitorMeasures> {
    const needs: ExceptionMonitorNeeds = getExceptionMonitorNeeds(
      data.monitorStep,
    );

    if (!needs.newExceptions && !needs.regressedExceptions && !needs.baseline) {
      return {};
    }

    const windowSeconds: number =
      data.config.lastXSecondsOfExceptions &&
      data.config.lastXSecondsOfExceptions > 0
        ? data.config.lastXSecondsOfExceptions
        : 60;
    const windowEnd: Date =
      data.evaluateUntil || OneUptimeDate.getCurrentDate();
    const windowStart: Date = OneUptimeDate.addRemoveSeconds(
      windowEnd,
      -windowSeconds,
    );

    const measures: ExceptionMonitorMeasures = {};

    /*
     * With an entity filter, the groups new and regressed exceptions are
     * counted among: read once, for both.
     */
    const fingerprints: Promise<Array<string> | undefined> =
      (needs.newExceptions || needs.regressedExceptions) &&
      MonitorStepExceptionMonitorUtil.hasEntityFilter(data.config)
        ? ExceptionMonitorMeasureReader.readOccurrenceFingerprints({
            countQuery: data.countQuery,
            windowStart,
            windowEnd,
          })
        : Promise.resolve(undefined);

    const countGroupsWhere: (
      condition: DatabaseQuery<TelemetryException>,
    ) => Promise<number> = async (
      condition: DatabaseQuery<TelemetryException>,
    ): Promise<number> => {
      const groupFingerprints: Array<string> | undefined = await fingerprints;

      // No matching occurrence in the window: no group to count.
      if (groupFingerprints && groupFingerprints.length === 0) {
        return 0;
      }

      return ExceptionMonitorMeasureReader.countGroups({
        query: {
          ...ExceptionMonitorMeasureReader.getGroupQuery({
            projectId: data.projectId,
            config: data.config,
            fingerprints: groupFingerprints,
          }),
          ...condition,
        },
      });
    };

    const [newCount, regressedCount, previousCount] = await Promise.all([
      needs.newExceptions
        ? countGroupsWhere({
            firstSeenAt: QueryHelper.inBetween(windowStart, windowEnd),
          })
        : Promise.resolve(undefined),
      needs.regressedExceptions
        ? countGroupsWhere({
            regressedAt: QueryHelper.inBetween(windowStart, windowEnd),
            // Came back and still open: resolved again since, it is fixed.
            isResolved: false,
          })
        : Promise.resolve(undefined),
      needs.baseline
        ? ExceptionMonitorMeasureReader.countPreviousOccurrences({
            countQuery: data.countQuery,
            windowStart,
          })
        : Promise.resolve(undefined),
    ]);

    if (newCount !== undefined) {
      measures.newExceptionCount = newCount;
    }

    if (regressedCount !== undefined) {
      measures.regressedExceptionCount = regressedCount;
    }

    if (previousCount !== undefined) {
      const usual: number = getUsualExceptionCount({
        previousCount,
        windowSeconds,
      });

      // Two decimals: "the usual 0.35 per 5 minutes" reads as it is.
      measures.exceptionCountBaseline = Math.round(usual * 100) / 100;
      measures.exceptionCountIncreasePercent = getExceptionIncreasePercent({
        currentCount: data.exceptionCount,
        usualCount: usual,
      });
    }

    return measures;
  }

  /*
   * The monitor's filters, as a query of exception groups: its services,
   * exception types, environments and message, and - unless it counts them
   * - neither resolved nor archived groups. With `fingerprints`, only the
   * groups of those occurrences.
   */
  public static getGroupQuery(data: {
    projectId: ObjectID;
    config: MonitorStepExceptionMonitor;
    fingerprints?: Array<string> | undefined;
  }): DatabaseQuery<TelemetryException> {
    const query: DatabaseQuery<TelemetryException> = {
      projectId: data.projectId,
    };

    if (data.config.telemetryServiceIds?.length > 0) {
      query.primaryEntityId = new Includes(data.config.telemetryServiceIds);
    }

    if (data.config.exceptionTypes?.length > 0) {
      query.exceptionType = new Includes(data.config.exceptionTypes);
    }

    const environments: Array<string> =
      MonitorStepExceptionMonitorUtil.normalizeEnvironments(
        data.config.environments,
      );

    if (environments.length > 0) {
      query.environment = new Includes(environments);
    }

    if (data.config.message) {
      query.message = new Search(data.config.message);
    }

    if (!data.config.includeResolved) {
      query.isResolved = false;
    }

    if (!data.config.includeArchived) {
      query.isArchived = false;
    }

    if (data.fingerprints) {
      query.fingerprint = new Includes(data.fingerprints);
    }

    return query;
  }

  /*
   * The fingerprints of the occurrences the monitor counts in its window -
   * the window's own occurrence query, its entity filter with the rest -
   * each once (grouped by fingerprint), at most ENTITY_FINGERPRINT_LIMIT.
   */
  public static async readOccurrenceFingerprints(data: {
    countQuery: AnalyticsQuery<ExceptionInstance>;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<string>> {
    const rows: Array<ExceptionInstance> =
      await ExceptionInstanceService.findBy({
        query: {
          ...data.countQuery,
          time: new InBetween(data.windowStart, data.windowEnd),
        },
        groupBy: { fingerprint: true },
        select: { fingerprint: true },
        sort: { fingerprint: SortOrder.Ascending },
        limit: ENTITY_FINGERPRINT_LIMIT,
        skip: 0,
        props: { isRoot: true },
      });

    const fingerprints: Array<string> = [];

    for (const row of rows) {
      const fingerprint: string = row.fingerprint?.toString() || "";

      if (fingerprint && !fingerprints.includes(fingerprint)) {
        fingerprints.push(fingerprint);
      }
    }

    if (rows.length >= ENTITY_FINGERPRINT_LIMIT) {
      logger.warn(
        `An Exceptions monitor's infrastructure entity filter matched at least ${ENTITY_FINGERPRINT_LIMIT} exception fingerprints in its window; its new and regressed exceptions are counted among the first ${ENTITY_FINGERPRINT_LIMIT}.`,
      );
    }

    return fingerprints;
  }

  private static async countGroups(data: {
    query: DatabaseQuery<TelemetryException>;
  }): Promise<number> {
    const count: PositiveNumber = await TelemetryExceptionService.countBy({
      query: data.query,
      props: { isRoot: true },
    });

    return count.toNumber();
  }

  // The window's own occurrence query, moved to the day before it.
  private static async countPreviousOccurrences(data: {
    countQuery: AnalyticsQuery<ExceptionInstance>;
    windowStart: Date;
  }): Promise<number> {
    const previousStart: Date = OneUptimeDate.addRemoveSeconds(
      data.windowStart,
      -EXCEPTION_BASELINE_LOOKBACK_SECONDS,
    );

    const count: PositiveNumber = await ExceptionInstanceService.countBy({
      query: {
        ...data.countQuery,
        time: new InBetween(previousStart, data.windowStart),
      },
      // As the window's own count is read (MonitorTelemetryMonitor).
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    return count.toNumber();
  }
}
