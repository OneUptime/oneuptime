import { DashboardClientUrl } from "../../EnvironmentConfig";
import GlobalConfigService from "../../Services/GlobalConfigService";
import MetricService from "../../Services/MetricService";
import ProjectService from "../../Services/ProjectService";
import TelemetryIngestionKeyService from "../../Services/TelemetryIngestionKeyService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "./CaptureSpan";
import TelemetryUtil from "./Telemetry";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetActiveMember,
  TelemetryIngestionBudgetDayCounters,
  TelemetryIngestionBudgetNoticeKind,
} from "./TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings, {
  TelemetryIngestionBudgetInstanceSettings,
} from "./TelemetryIngestionBudgetSettings";
import { formatTelemetryIngestionBudgetResetsAt } from "./TelemetryIngestionBudget";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Project from "../../../Models/DatabaseModels/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SafeHtml from "../../../Types/SafeHtml";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TelemetryIngestionBudgetMetricType from "../../../Types/Telemetry/TelemetryIngestionBudgetMetricType";
import {
  computeTelemetryIngestionBudgetPercentUsed,
  formatTelemetryIngestionBudgetGB,
  getTelemetryIngestionBudgetDay,
  getTelemetryIngestionBudgetSignalFromSlug,
  getTelemetryIngestionBudgetSignalWords,
  readTelemetryIngestionBudgetStoredSettings,
  resolveTelemetryIngestionBudget,
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_PROJECT_LOCATION,
  TelemetryIngestionBudgetDay,
  TelemetryIngestionBudgetResolved,
  TelemetryIngestionBudgetResolvedScope,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionBudgetMetricTypeUtil, {
  TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_ID_ATTRIBUTE,
  TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_NAME_ATTRIBUTE,
  TELEMETRY_INGESTION_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE,
  TELEMETRY_INGESTION_BUDGET_METRIC_SCOPE_ATTRIBUTE,
  TELEMETRY_INGESTION_BUDGET_METRIC_SIGNAL_ATTRIBUTE,
} from "../../../Utils/Telemetry/TelemetryIngestionBudgetMetricType";

/*
 * The ingestion budget sweep, every five minutes (the worker job
 * TelemetryIngestionBudget:PublishTelemetryIngestionBudgetMetrics):
 *
 *   1. Publishes every budgeted scope's figures for the day as the
 *      `oneuptime.telemetry.budget.*` gauges (TelemetryIngestionBudgetMetric-
 *      Type), so a Metrics monitor can page someone at 80% of a budget, when
 *      it is used up, or when telemetry starts being dropped - instead of a
 *      used-up budget only showing on the Usage page.
 *   2. Emails the project's owners, once a day for each budget, the first
 *      time it crosses the warning threshold and the first time it is used up
 *      (a budget crossed and used up between two sweeps gets one email: the
 *      used-up one).
 *
 * It reads only the scopes that counted anything today - the day's active
 * set the ingest counters keep (TelemetryIngestionBudgetCounter) - never the
 * whole project table.
 *
 * The metrics are written straight into the project's metrics, not through
 * ingest, so they are never counted against (or refused by) the very budget
 * they report on; and they are left out of usage and billing by name
 * (TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES), so reporting on a budget costs
 * a project nothing.
 *
 * What a point means, and when there is none:
 *
 *   - Rows are keyed to the project (primaryEntityId = its id): a budget is
 *     the project's or one of its keys', never a service's. Each carries
 *     `projectId`, `signal` and `scope`, and a key's `ingestionKeyId` and
 *     `ingestionKeyName`.
 *   - A zero is never posted: a zero cannot cross a threshold.
 *   - An unreadable counter posts nothing, never 0 - a 0 would read as "no
 *     usage" to every monitor watching the series.
 *
 * A monitor on these series needs a window of at least three sweeps (15
 * minutes): a window with no point in it resolves open incidents.
 */

// Scopes per page: one counter read and one insert each.
export const TELEMETRY_INGESTION_BUDGET_SWEEP_PAGE_SIZE: number = 500;

// Three failed pages in a row: ClickHouse or Postgres is down for everyone.
export const TELEMETRY_INGESTION_BUDGET_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES: number = 3;

// As the session replay budget series: GlobalConfig.monitorMetricRetentionInDays.
const DEFAULT_RETENTION_DAYS: number = 30;

// Where the Usage page is under a project's own route.
export const TELEMETRY_INGESTION_BUDGET_USAGE_PAGE_PATH: string =
  "settings/usage-history";

export type TelemetryIngestionBudgetSweepStopReason =
  | "done"
  | "counters-unavailable"
  | "too-many-failed-pages"
  | "deadline"
  | "lock-lost";

export interface TelemetryIngestionBudgetSweepOptions {
  shouldContinue?: (() => boolean) | undefined;
  deadline?: Date | undefined;
  now?: Date | undefined;
}

export interface TelemetryIngestionBudgetSweepSummary {
  stopReason: TelemetryIngestionBudgetSweepStopReason;
  dayId: string;
  scopesScanned: number;
  pagesFailed: number;
  rowsWritten: number;
  noticesSent: number;
}

// One budgeted scope and signal as the sweep needs it.
export interface TelemetryIngestionBudgetSweepScope {
  member: TelemetryIngestionBudgetActiveMember;
  signal: TelemetryIngestionBudgetSignal;
  limits: TelemetryIngestionBudgetResolvedScope;
  ingestionKeyName: string | null;
}

interface PageResult {
  countersAvailable: boolean;
  rowsWritten: number;
  noticesSent: number;
}

export default class TelemetryIngestionBudgetMetrics {
  /*
   * The rows one scope and signal gets in one sweep. Pure, so the series'
   * shape is testable without a sweep around it.
   */
  public static buildScopeRows(data: {
    scope: TelemetryIngestionBudgetSweepScope;
    counters: TelemetryIngestionBudgetDayCounters;
    ingestionDate: Date;
    retentionDate: Date;
  }): Array<JSONObject> {
    const attributes: JSONObject = {
      [TELEMETRY_INGESTION_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE]:
        data.scope.member.projectId,
      [TELEMETRY_INGESTION_BUDGET_METRIC_SIGNAL_ATTRIBUTE]:
        data.scope.member.signalSlug,
      [TELEMETRY_INGESTION_BUDGET_METRIC_SCOPE_ATTRIBUTE]:
        data.scope.member.scope,
    };

    if (data.scope.member.scope === TelemetryIngestionBudgetScope.IngestionKey) {
      attributes[TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_ID_ATTRIBUTE] =
        data.scope.member.scopeId;

      if (data.scope.ingestionKeyName && data.scope.ingestionKeyName.trim()) {
        attributes[
          TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_NAME_ATTRIBUTE
        ] = data.scope.ingestionKeyName;
      }
    }

    const rows: Array<JSONObject> = [];

    const push: (
      metricType: TelemetryIngestionBudgetMetricType,
      value: number | null,
    ) => void = (
      metricType: TelemetryIngestionBudgetMetricType,
      value: number | null,
    ): void => {
      if (value === null || !Number.isFinite(value) || value <= 0) {
        return;
      }

      rows.push(
        this.buildMetricRow({
          projectId: data.scope.member.projectId,
          metricType: metricType,
          value: value,
          attributes: attributes,
          ingestionDate: data.ingestionDate,
          retentionDate: data.retentionDate,
        }),
      );
    };

    const usedBytes: number = Math.max(0, data.counters.usedBytes);

    push(TelemetryIngestionBudgetMetricType.UsedBytes, usedBytes);

    if (usedBytes > 0) {
      push(
        TelemetryIngestionBudgetMetricType.UsedPercent,
        computeTelemetryIngestionBudgetPercentUsed({
          usedBytes: usedBytes,
          dailyBudgetBytes: data.scope.limits.dailyBudget.bytes,
        }),
      );
    }

    push(
      TelemetryIngestionBudgetMetricType.DroppedBytes,
      data.counters.droppedBytes,
    );
    push(
      TelemetryIngestionBudgetMetricType.ThrottledRequests,
      data.counters.throttledRequests,
    );

    return rows;
  }

  // Row shape kept in step with SessionReplayBudgetMetrics.buildMetricRow.
  public static buildMetricRow(data: {
    projectId: string;
    metricType: TelemetryIngestionBudgetMetricType;
    value: number;
    attributes: JSONObject;
    ingestionDate: Date;
    retentionDate: Date;
  }): JSONObject {
    const ingestionTimestamp: string = OneUptimeDate.toClickhouseDateTime(
      data.ingestionDate,
    );
    const attributes: JSONObject = { ...data.attributes };

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: ingestionTimestamp,
      projectId: data.projectId,
      primaryEntityId: data.projectId,
      primaryEntityType: ServiceType.Unknown,
      name: data.metricType,
      aggregationTemporality: null,
      // A reading of a counter at one moment: a Gauge.
      metricPointType: MetricPointType.Gauge,
      time: ingestionTimestamp,
      startTime: null,
      timeUnixNano: OneUptimeDate.toUnixNano(data.ingestionDate).toString(),
      startTimeUnixNano: null,
      attributes: attributes,
      attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
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

  // The email a crossed warning or a used-up budget sends the owners.
  public static getNotice(data: {
    kind: TelemetryIngestionBudgetNoticeKind;
    projectId: string;
    projectName: string | null;
    scope: TelemetryIngestionBudgetSweepScope;
    counters: TelemetryIngestionBudgetDayCounters;
    warningPercent: number;
    resetsAt: Date;
  }): { subject: string; html: string } | null {
    const dailyBudgetBytes: number | null =
      data.scope.limits.dailyBudget.bytes;

    if (dailyBudgetBytes === null) {
      return null;
    }

    const words: string = getTelemetryIngestionBudgetSignalWords(
      data.scope.signal,
    );
    const capitalized: string = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
    const projectName: string = data.projectName?.trim() || "your project";
    const isKey: boolean =
      data.scope.member.scope === TelemetryIngestionBudgetScope.IngestionKey;
    const keyName: string =
      data.scope.ingestionKeyName?.trim() || data.scope.member.scopeId;
    const budget: string = formatTelemetryIngestionBudgetGB(dailyBudgetBytes);
    const resetsAt: string = formatTelemetryIngestionBudgetResetsAt(
      data.resetsAt,
    );
    const whose: string = isKey
      ? `The ingestion key "${keyName}" of ${projectName}`
      : projectName;
    const isExhausted: boolean =
      data.kind === TelemetryIngestionBudgetNoticeKind.Exhausted;
    const percent: number =
      computeTelemetryIngestionBudgetPercentUsed({
        usedBytes: data.counters.usedBytes,
        dailyBudgetBytes: dailyBudgetBytes,
      }) || 0;

    const subject: string = isExhausted
      ? `${capitalized} ingestion budget used up${isKey ? ` for ingestion key "${keyName}"` : ""} in ${projectName}`
      : `${capitalized} ingestion budget ${Math.floor(percent)}% used${isKey ? ` for ingestion key "${keyName}"` : ""} in ${projectName}`;

    const paragraphs: Array<string> = [
      SafeHtml.escape(
        isExhausted
          ? `${whose} has used up its daily ${words} ingestion budget of ${budget}. OneUptime is not storing ${words} ${isKey ? "sent with this key" : "from this project"} until the budget resets at ${resetsAt}. Senders are told why and do not retry.`
          : `${whose} has used ${Math.floor(percent)}% of its daily ${words} ingestion budget of ${budget} (the warning is at ${data.warningPercent}%). Once it is used up, ${words} ${isKey ? "sent with this key are" : "from this project are"} refused until the budget resets at ${resetsAt}.`,
      ),
      SafeHtml.escape(
        isKey
          ? "Anyone who can edit the ingestion key can change its budget, up to the project's own."
          : "Only the instance admin can change the project's budget. Find what is sending the most on the Usage page, and drop what you do not need with drop filters.",
      ),
    ];

    const link: URL | null = this.getUsagePageLink(data.projectId);

    paragraphs.push(
      link
        ? `${SafeHtml.escape(
            `See today's budgets under ${TELEMETRY_INGESTION_BUDGET_PROJECT_LOCATION}:`,
          )} <br/> <a href="${SafeHtml.escape(link.toString())}">${SafeHtml.escape(link.toString())}</a>`
        : SafeHtml.escape(
            `See today's budgets under ${TELEMETRY_INGESTION_BUDGET_PROJECT_LOCATION}.`,
          ),
    );

    paragraphs.push(
      SafeHtml.escape(
        "Project owners get this email once a day for each budget: when it crosses the warning threshold, and when it is used up.",
      ),
    );

    return { subject: subject, html: paragraphs.join(" <br/> <br/> ") };
  }

  /*
   * One sweep over every scope that counted anything today. Never throws:
   * every failure ends in the summary and the logs, and the next tick starts
   * over.
   */
  @CaptureSpan()
  public static async publishAll(
    options: TelemetryIngestionBudgetSweepOptions,
  ): Promise<TelemetryIngestionBudgetSweepSummary> {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    const instance: TelemetryIngestionBudgetInstanceSettings =
      await TelemetryIngestionBudgetSettings.getInstanceSettings();
    const day: TelemetryIngestionBudgetDay = getTelemetryIngestionBudgetDay({
      now: now,
      resetTime: instance.resetTime,
      timezone: instance.timezone,
    });

    const summary: TelemetryIngestionBudgetSweepSummary = {
      stopReason: "done",
      dayId: day.id,
      scopesScanned: 0,
      pagesFailed: 0,
      rowsWritten: 0,
      noticesSent: 0,
    };

    const members: Array<TelemetryIngestionBudgetActiveMember> | null =
      await TelemetryIngestionBudgetCounter.listActiveMembers(day.id);

    if (members === null) {
      summary.stopReason = "counters-unavailable";
      return summary;
    }

    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      now,
      await this.getRetentionDays(),
    );
    const registeredMetricNames: Set<string> = new Set<string>();
    let consecutiveFailedPages: number = 0;

    for (
      let start: number = 0;
      start < members.length;
      start += TELEMETRY_INGESTION_BUDGET_SWEEP_PAGE_SIZE
    ) {
      if (options.shouldContinue && !options.shouldContinue()) {
        summary.stopReason = "lock-lost";
        break;
      }

      if (
        options.deadline &&
        OneUptimeDate.getCurrentDate().getTime() >= options.deadline.getTime()
      ) {
        summary.stopReason = "deadline";
        break;
      }

      const page: Array<TelemetryIngestionBudgetActiveMember> = members.slice(
        start,
        start + TELEMETRY_INGESTION_BUDGET_SWEEP_PAGE_SIZE,
      );

      summary.scopesScanned += page.length;

      try {
        const result: PageResult = await this.publishPage({
          members: page,
          instance: instance,
          day: day,
          ingestionDate: now,
          retentionDate: retentionDate,
          registeredMetricNames: registeredMetricNames,
        });

        if (!result.countersAvailable) {
          summary.stopReason = "counters-unavailable";
          break;
        }

        summary.rowsWritten += result.rowsWritten;
        summary.noticesSent += result.noticesSent;
        consecutiveFailedPages = 0;
      } catch (err) {
        summary.pagesFailed++;
        consecutiveFailedPages++;
        logger.error(
          `TelemetryIngestionBudgetMetrics: could not publish ${page.length} budget scope(s); skipping them this tick.`,
        );
        logger.error(err);

        if (
          consecutiveFailedPages >=
          TELEMETRY_INGESTION_BUDGET_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES
        ) {
          summary.stopReason = "too-many-failed-pages";
          break;
        }
      }
    }

    logger.debug(
      `TelemetryIngestionBudgetMetrics: ${summary.stopReason} - ${summary.scopesScanned} scope(s) on budget day ${day.id}, ${summary.rowsWritten} row(s), ${summary.noticesSent} notice(s).`,
    );

    return summary;
  }

  /*
   * Resolve the limits every scope of a page is held to: projects' overrides
   * through the settings cache, keys' own budgets (and names) in one read.
   */
  public static async resolveScopes(data: {
    members: Array<TelemetryIngestionBudgetActiveMember>;
    instance: TelemetryIngestionBudgetInstanceSettings;
  }): Promise<Array<TelemetryIngestionBudgetSweepScope>> {
    const keyIds: Array<string> = Array.from(
      new Set<string>(
        data.members
          .filter((member: TelemetryIngestionBudgetActiveMember): boolean => {
            return member.scope === TelemetryIngestionBudgetScope.IngestionKey;
          })
          .map((member: TelemetryIngestionBudgetActiveMember): string => {
            return member.scopeId;
          }),
      ),
    );

    const keys: Map<
      string,
      { name: string; budgets: TelemetryIngestionBudgetStoredSettings }
    > = new Map();

    if (keyIds.length > 0) {
      const rows: Array<TelemetryIngestionKey> =
        await TelemetryIngestionKeyService.findBy({
          query: { _id: QueryHelper.any(keyIds) },
          select: Object.fromEntries([
            ["_id", true],
            ["name", true],
            ...TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES.map(
              (column: string): [string, boolean] => {
                return [column, true];
              },
            ),
          ]) as never,
          skip: 0,
          limit: keyIds.length,
          props: { isRoot: true },
        });

      for (const row of rows) {
        if (row.id) {
          keys.set(row.id.toString(), {
            name: typeof row.name === "string" ? row.name : "",
            budgets: readTelemetryIngestionBudgetStoredSettings(row),
          });
        }
      }
    }

    const scopes: Array<TelemetryIngestionBudgetSweepScope> = [];

    for (const member of data.members) {
      const signal: TelemetryIngestionBudgetSignal | null =
        getTelemetryIngestionBudgetSignalFromSlug(member.signalSlug);

      if (!signal) {
        continue;
      }

      const project: TelemetryIngestionBudgetStoredSettings | null =
        await TelemetryIngestionBudgetSettings.getProjectOverrides(
          new ObjectID(member.projectId),
        );

      const isKey: boolean =
        member.scope === TelemetryIngestionBudgetScope.IngestionKey;
      const key:
        | { name: string; budgets: TelemetryIngestionBudgetStoredSettings }
        | undefined = isKey ? keys.get(member.scopeId) : undefined;

      // A key deleted since it counted: nothing left to report it under.
      if (isKey && !key) {
        continue;
      }

      const resolved: TelemetryIngestionBudgetResolved =
        resolveTelemetryIngestionBudget({
          signal: signal,
          instance: data.instance.budgets,
          project: project,
          ingestionKey: key ? key.budgets : null,
        });

      const limits: TelemetryIngestionBudgetResolvedScope | null = isKey
        ? resolved.ingestionKey
        : resolved.project;

      scopes.push({
        member: member,
        signal: signal,
        limits: limits || {
          dailyBudget: { bytes: null, source: null },
          rateLimit: { bytes: null, source: null },
        },
        ingestionKeyName: key ? key.name : null,
      });
    }

    return scopes;
  }

  @CaptureSpan()
  private static async publishPage(data: {
    members: Array<TelemetryIngestionBudgetActiveMember>;
    instance: TelemetryIngestionBudgetInstanceSettings;
    day: TelemetryIngestionBudgetDay;
    ingestionDate: Date;
    retentionDate: Date;
    registeredMetricNames: Set<string>;
  }): Promise<PageResult> {
    const scopes: Array<TelemetryIngestionBudgetSweepScope> =
      await this.resolveScopes({
        members: data.members,
        instance: data.instance,
      });

    if (scopes.length === 0) {
      return { countersAvailable: true, rowsWritten: 0, noticesSent: 0 };
    }

    const counters: Array<TelemetryIngestionBudgetDayCounters> | null =
      await TelemetryIngestionBudgetCounter.readDayCounters(
        scopes.map((scope: TelemetryIngestionBudgetSweepScope) => {
          return {
            dayId: data.day.id,
            scope: scope.member.scope,
            scopeId: scope.member.scopeId,
            signalSlug: scope.member.signalSlug,
          };
        }),
      );

    if (counters === null) {
      return { countersAvailable: false, rowsWritten: 0, noticesSent: 0 };
    }

    const rows: Array<JSONObject> = [];
    const metricNamesByProject: Map<
      string,
      Set<TelemetryIngestionBudgetMetricType>
    > = new Map();

    scopes.forEach(
      (scope: TelemetryIngestionBudgetSweepScope, index: number): void => {
        const scopeRows: Array<JSONObject> = this.buildScopeRows({
          scope: scope,
          counters: counters[index]!,
          ingestionDate: data.ingestionDate,
          retentionDate: data.retentionDate,
        });

        if (scopeRows.length === 0) {
          return;
        }

        const names: Set<TelemetryIngestionBudgetMetricType> =
          metricNamesByProject.get(scope.member.projectId) ||
          new Set<TelemetryIngestionBudgetMetricType>();

        for (const row of scopeRows) {
          rows.push(row);
          names.add(row["name"] as TelemetryIngestionBudgetMetricType);
        }

        metricNamesByProject.set(scope.member.projectId, names);
      },
    );

    if (rows.length > 0) {
      await MetricService.insertJsonRows(rows);

      await this.registerMetricNames({
        metricNamesByProject: metricNamesByProject,
        registeredMetricNames: data.registeredMetricNames,
      });
    }

    const noticesSent: number = await this.sendNotices({
      scopes: scopes,
      counters: counters,
      instance: data.instance,
      day: data.day,
    });

    return {
      countersAvailable: true,
      rowsWritten: rows.length,
      noticesSent: noticesSent,
    };
  }

  /*
   * The day's warning and used-up emails that are due on this page. Each is
   * claimed in Redis before it is sent, so however many workers sweep, one
   * sends it. A budget both crossed and used up since the last sweep sends
   * only the used-up email, and its warning is claimed with it.
   */
  private static async sendNotices(data: {
    scopes: Array<TelemetryIngestionBudgetSweepScope>;
    counters: Array<TelemetryIngestionBudgetDayCounters>;
    instance: TelemetryIngestionBudgetInstanceSettings;
    day: TelemetryIngestionBudgetDay;
  }): Promise<number> {
    let sent: number = 0;
    const projectNames: Map<string, string | null> = new Map();

    for (let index: number = 0; index < data.scopes.length; index++) {
      const scope: TelemetryIngestionBudgetSweepScope = data.scopes[index]!;
      const counters: TelemetryIngestionBudgetDayCounters =
        data.counters[index]!;

      if (scope.limits.dailyBudget.bytes === null) {
        continue;
      }

      const exhaustedDue: boolean =
        counters.exhaustedAt !== null && counters.exhaustedNoticeSentAt === null;
      const warningDue: boolean =
        counters.warningCrossedAt !== null &&
        counters.warningNoticeSentAt === null;

      if (!exhaustedDue && !warningDue) {
        continue;
      }

      const dayKey: {
        dayId: string;
        scope: TelemetryIngestionBudgetScope;
        scopeId: string;
        signalSlug: string;
      } = {
        dayId: data.day.id,
        scope: scope.member.scope,
        scopeId: scope.member.scopeId,
        signalSlug: scope.member.signalSlug,
      };

      let kind: TelemetryIngestionBudgetNoticeKind | null = null;

      if (exhaustedDue) {
        const claimed: boolean =
          await TelemetryIngestionBudgetCounter.claimNotice({
            day: dayKey,
            kind: TelemetryIngestionBudgetNoticeKind.Exhausted,
            nowMs: Date.now(),
          });

        // The warning is moot once the budget is used up.
        await TelemetryIngestionBudgetCounter.claimNotice({
          day: dayKey,
          kind: TelemetryIngestionBudgetNoticeKind.Warning,
          nowMs: Date.now(),
        });

        kind = claimed ? TelemetryIngestionBudgetNoticeKind.Exhausted : null;
      } else if (
        await TelemetryIngestionBudgetCounter.claimNotice({
          day: dayKey,
          kind: TelemetryIngestionBudgetNoticeKind.Warning,
          nowMs: Date.now(),
        })
      ) {
        kind = TelemetryIngestionBudgetNoticeKind.Warning;
      }

      if (!kind) {
        continue;
      }

      try {
        const projectId: string = scope.member.projectId;

        if (!projectNames.has(projectId)) {
          const project: Project | null = await ProjectService.findOneById({
            id: new ObjectID(projectId),
            select: { name: true },
            props: { isRoot: true },
          });

          projectNames.set(projectId, project?.name || null);
        }

        const notice: { subject: string; html: string } | null =
          this.getNotice({
            kind: kind,
            projectId: projectId,
            projectName: projectNames.get(projectId) || null,
            scope: scope,
            counters: counters,
            warningPercent: data.instance.warningPercent,
            resetsAt: data.day.resetsAt,
          });

        if (!notice) {
          continue;
        }

        await ProjectService.sendEmailToProjectOwners(
          new ObjectID(projectId),
          notice.subject,
          notice.html,
        );

        sent++;
      } catch (err) {
        logger.error(
          `TelemetryIngestionBudgetMetrics: could not tell the owners of project ${scope.member.projectId} about its ${scope.member.signalSlug} ingestion budget.`,
        );
        logger.error(err);
      }
    }

    return sent;
  }

  /*
   * Put the names written in the project's metric catalog, so the metric
   * picker and the Metrics-monitor builder offer them with their units. Once
   * per (project, name) per sweep; a failure only delays the names.
   */
  private static async registerMetricNames(data: {
    metricNamesByProject: Map<string, Set<TelemetryIngestionBudgetMetricType>>;
    registeredMetricNames: Set<string>;
  }): Promise<void> {
    for (const [projectId, names] of data.metricNamesByProject) {
      const metricNameServiceNameMap: Dictionary<MetricType> = {};

      for (const name of names) {
        if (data.registeredMetricNames.has(`${projectId}:${name}`)) {
          continue;
        }

        const metricType: MetricType = new MetricType();
        metricType.name = name;
        metricType.description =
          TelemetryIngestionBudgetMetricTypeUtil.getDescription(name);
        metricType.unit = TelemetryIngestionBudgetMetricTypeUtil.getUnit(name);
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
        logger.error(
          `TelemetryIngestionBudgetMetrics: could not register the ingestion budget metric names for project ${projectId}.`,
        );
        logger.error(err);
      }
    }
  }

  // The Usage page of a project, or null without a configured host.
  private static getUsagePageLink(projectId: string): URL | null {
    if (!DashboardClientUrl || !DashboardClientUrl.hostname?.toString()) {
      return null;
    }

    return URL.fromString(DashboardClientUrl.toString()).addRoute(
      `/${projectId}/${TELEMETRY_INGESTION_BUDGET_USAGE_PAGE_PATH}`,
    );
  }

  private static async getRetentionDays(): Promise<number> {
    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneById({
          id: ObjectID.getZeroObjectID(),
          select: { monitorMetricRetentionInDays: true },
          props: { isRoot: true },
        });

      const retentionInDays: unknown =
        globalConfig?.monitorMetricRetentionInDays;

      if (
        typeof retentionInDays === "number" &&
        Number.isFinite(retentionInDays) &&
        retentionInDays > 0
      ) {
        return retentionInDays;
      }
    } catch (err) {
      logger.error(
        "TelemetryIngestionBudgetMetrics: could not read the monitor metric retention; using the default.",
      );
      logger.error(err);
    }

    return DEFAULT_RETENTION_DAYS;
  }
}
