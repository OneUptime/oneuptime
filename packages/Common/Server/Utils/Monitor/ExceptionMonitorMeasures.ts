import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
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

/*
 * WHAT AN EXCEPTIONS MONITOR READS BEYOND ITS COUNT, WHEN ITS CRITERIA ASK.
 *
 * New and regressed exceptions are exception groups (TelemetryException, in
 * Postgres): their first seen and their regressed at are kept on the group,
 * filtered by the monitor's services, exception types, environments and
 * message - an infrastructure entity is a property of occurrences, so that
 * filter applies to the counts of occurrences only. The usual count is the
 * monitor's own occurrence count over the day before its window
 * (ExceptionInstance, in ClickHouse), with the same filters and the same
 * resolved and archived exceptions left out, spread over windows of its
 * length. Each is read only when a criteria checks it
 * (getExceptionMonitorNeeds).
 */

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

    const [newCount, regressedCount, previousCount] = await Promise.all([
      needs.newExceptions
        ? ExceptionMonitorMeasureReader.countGroups({
            query: {
              ...ExceptionMonitorMeasureReader.getGroupQuery(data),
              firstSeenAt: QueryHelper.inBetween(windowStart, windowEnd),
            },
          })
        : Promise.resolve(undefined),
      needs.regressedExceptions
        ? ExceptionMonitorMeasureReader.countGroups({
            query: {
              ...ExceptionMonitorMeasureReader.getGroupQuery(data),
              regressedAt: QueryHelper.inBetween(windowStart, windowEnd),
              // Came back and still open: resolved again since, it is fixed.
              isResolved: false,
            },
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
   * - neither resolved nor archived groups.
   */
  public static getGroupQuery(data: {
    projectId: ObjectID;
    config: MonitorStepExceptionMonitor;
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

    return query;
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
