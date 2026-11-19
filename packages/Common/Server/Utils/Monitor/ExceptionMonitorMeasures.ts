import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Span from "../../../Models/AnalyticsModels/Span";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
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
  getSessionsWithExceptionsPercent,
  getUsualExceptionCount,
} from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import { ExceptionLearnedBaseline } from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import ExceptionInstanceService from "../../Services/ExceptionInstanceService";
import SpanService from "../../Services/SpanService";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import AnalyticsQuery from "../../Types/AnalyticsDatabase/Query";
import DatabaseQuery from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import ExceptionLearnedBaselineUtil from "./ExceptionLearnedBaseline";

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
 * spread over windows of its length. What is normal for the hour of the week
 * is that same query over the earlier weeks (ExceptionLearnedBaseline). Each
 * is read only when a criteria checks it (getExceptionMonitorNeeds).
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
  exceptionLearnedBaselines?: Array<ExceptionLearnedBaseline> | undefined;
  sessionCount?: number | undefined;
  sessionsWithExceptionsCount?: number | undefined;
  sessionsWithExceptionsPercent?: number | null | undefined;
}

export interface ExceptionMonitorSessions {
  // The distinct session ids of the window's spans of the monitor's services.
  sessions: number;
  // The distinct session ids of the occurrences the monitor counts.
  sessionsWithExceptions: number;
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

    if (
      !needs.newExceptions &&
      !needs.regressedExceptions &&
      !needs.baseline &&
      !needs.sessions &&
      needs.learnedBaselineWindowDays.length === 0
    ) {
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
      // Every type it keeps is one it leaves out: no group can match.
      if (MonitorStepExceptionMonitorUtil.keepsNoType(data.config)) {
        return 0;
      }

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

    const [
      newCount,
      regressedCount,
      previousCount,
      learnedBaselines,
      sessions,
    ] = await Promise.all([
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
      ExceptionMonitorMeasureReader.readLearnedBaselines({
        projectId: data.projectId,
        config: data.config,
        countQuery: data.countQuery,
        windowStart,
        windowEnd,
        windowSeconds,
        windowDays: needs.learnedBaselineWindowDays,
      }),
      needs.sessions
        ? ExceptionMonitorMeasureReader.readSessions({
            projectId: data.projectId,
            config: data.config,
            countQuery: data.countQuery,
            windowStart,
            windowEnd,
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

    if (learnedBaselines.length > 0) {
      measures.exceptionLearnedBaselines = learnedBaselines;
    }

    if (sessions !== undefined) {
      measures.sessionCount = sessions.sessions;
      measures.sessionsWithExceptionsCount = Math.min(
        sessions.sessionsWithExceptions,
        sessions.sessions,
      );
      measures.sessionsWithExceptionsPercent =
        getSessionsWithExceptionsPercent(sessions);
    }

    return measures;
  }

  /*
   * The window's sessions, and those the occurrences the monitor counts
   * happened in, each a grouped count - the distinct session ids - over the
   * same window. The sessions are the spans' of the monitor's services and
   * entities, as a mobile app's Sessions tile counts them; the exceptions'
   * are its own count's occurrences, every filter with them. A session id
   * of '' is no session. A read the time limit stops reads 0 (countBy), so
   * a slow read alerts on nothing rather than on a rate it never knew.
   */
  public static async readSessions(data: {
    projectId: ObjectID;
    config: MonitorStepExceptionMonitor;
    countQuery: AnalyticsQuery<ExceptionInstance>;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<ExceptionMonitorSessions> {
    const spanQuery: AnalyticsQuery<Span> = {
      projectId: data.projectId,
      startTime: new InBetween(data.windowStart, data.windowEnd),
      sessionId: new NotEqual(""),
    };

    if (data.config.telemetryServiceIds?.length > 0) {
      spanQuery.primaryEntityId = new Includes(data.config.telemetryServiceIds);
    }

    if (MonitorStepExceptionMonitorUtil.hasEntityFilter(data.config)) {
      spanQuery.entityKeys = new Includes(data.config.entityKeys!);
    }

    const [sessions, sessionsWithExceptions]: [PositiveNumber, PositiveNumber] =
      await Promise.all([
        SpanService.countBy({
          query: spanQuery,
          groupBy: { sessionId: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
        ExceptionInstanceService.countBy({
          query: {
            ...data.countQuery,
            time: new InBetween(data.windowStart, data.windowEnd),
            sessionId: new NotEqual(""),
          },
          groupBy: { sessionId: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
      ]);

    return {
      sessions: sessions.toNumber(),
      sessionsWithExceptions: sessionsWithExceptions.toNumber(),
    };
  }

  /*
   * The learned baseline of each baseline window the criteria ask for. One
   * that cannot be read is left out: its criteria read as still learning,
   * and the count and every other measure of the check still stand.
   */
  private static async readLearnedBaselines(data: {
    projectId: ObjectID;
    config: MonitorStepExceptionMonitor;
    countQuery: AnalyticsQuery<ExceptionInstance>;
    windowStart: Date;
    windowEnd: Date;
    windowSeconds: number;
    windowDays: Array<number>;
  }): Promise<Array<ExceptionLearnedBaseline>> {
    const baselines: Array<ExceptionLearnedBaseline | null> = await Promise.all(
      data.windowDays.map(
        async (
          windowDays: number,
        ): Promise<ExceptionLearnedBaseline | null> => {
          try {
            return await ExceptionLearnedBaselineUtil.read({
              projectId: data.projectId,
              telemetryServiceIds: data.config.telemetryServiceIds,
              countQuery: data.countQuery,
              windowStart: data.windowStart,
              windowEnd: data.windowEnd,
              windowSeconds: Math.max(1, Math.round(data.windowSeconds)),
              windowDays,
            });
          } catch (err) {
            logger.error(
              "Error reading the learned baseline of an Exceptions monitor",
            );
            logger.error(err);
            return null;
          }
        },
      ),
    );

    return baselines.filter(
      (
        baseline: ExceptionLearnedBaseline | null,
      ): baseline is ExceptionLearnedBaseline => {
        return baseline !== null;
      },
    );
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

    /*
     * The types the occurrence query keeps (MonitorStepExceptionMonitorUtil
     * .toAnalyticsQuery), as the group's type: the kept ones, else every
     * type but the ones left out. A group with no type is no type left out.
     * A step that keeps no type at all counts no group: read() never asks.
     */
    const keptTypes: Array<string> =
      MonitorStepExceptionMonitorUtil.getKeptExceptionTypes(data.config);
    const excludedTypes: Array<string> =
      MonitorStepExceptionMonitorUtil.normalizeExceptionTypes(
        data.config.excludedExceptionTypes,
      );

    if (keptTypes.length > 0) {
      query.exceptionType = new Includes(keptTypes);
    } else if (excludedTypes.length > 0) {
      query.exceptionType = QueryHelper.notInOrNull(excludedTypes);
    }

    // The group's flag: at least one of its occurrences was unhandled.
    if (MonitorStepExceptionMonitorUtil.isUnhandledOnly(data.config)) {
      query.unhandled = true;
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
