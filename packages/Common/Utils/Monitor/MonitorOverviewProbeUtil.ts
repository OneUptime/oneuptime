import MonitorLog from "../../Models/AnalyticsModels/MonitorLog";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../Models/DatabaseModels/MonitorProbe";
import Probe, {
  ProbeConnectionStatus,
} from "../../Models/DatabaseModels/Probe";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import MonitorEvaluationSummary from "../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import MonitorCheckScheduleUtil from "./MonitorCheckScheduleUtil";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
} from "./MonitorOverviewFamily";

/*
 * Everything the monitor overview derives from the monitor's MonitorProbe
 * rows and its MonitorLog evaluations.
 *
 * Two timestamps are easy to confuse here:
 * - MonitorProbe.lastPingAt is when a probe CLAIMED the job (and is also set
 *   when the row is created). It says nothing about whether a result came
 *   back, so it is only used to notice that a newer result may be pending.
 * - lastMonitoringLog[stepId].monitoredAt is stamped by the server when a
 *   result is ingested. That is "last checked".
 */

export enum MonitorOverviewProbeHealth {
  Down = "Down",
  Disconnected = "Disconnected",
  Late = "Late",
  NoResultYet = "NoResultYet",
  Up = "Up",
  Reported = "Reported",
  TurnedOff = "TurnedOff",
}

export interface MonitorOverviewProbeResult {
  probeId: string;
  monitoredAt?: Date | undefined;
  isOnline?: boolean | undefined;
  responseTimeInMs?: number | undefined;
  responseCode?: number | undefined;
  failureCause?: string | undefined;
  sslExpiresAt?: Date | undefined;
  isValidCertificate?: boolean | undefined;
  domainExpiresAt?: Date | undefined;
}

export interface MonitorOverviewProbeRow {
  probeId: string;
  name: string;
  iconFileId?: string | undefined;
  isEnabled: boolean;
  // Null when the probe relation (and so its connection status) is unknown.
  isConnected: boolean | null;
  lastPingAt?: Date | undefined;
  nextPingAt?: Date | undefined;
  latestResult?: MonitorOverviewProbeResult | undefined;
  health: MonitorOverviewProbeHealth;
}

export interface MonitorOverviewResponseTime {
  medianMs: number;
  minMs: number;
  maxMs: number;
  // Enabled probes whose latest result carries a response time.
  respondedCount: number;
  // Enabled probes.
  totalCount: number;
}

export interface MonitorOverviewProbeSummary {
  rows: Array<MonitorOverviewProbeRow>;
  attachedCount: number;
  enabledCount: number;
  // Enabled probes whose latest result is current (Up, Down or Reported).
  reportingCount: number;
  disabledCount: number;
  // Enabled probes whose connection is lost.
  disconnectedCount: number;
  lastResultAt?: Date | undefined;
  nextCheckAt?: Date | undefined;
  latestResult?:
    | (MonitorOverviewProbeResult & { probeName: string })
    | undefined;
  responseTime: MonitorOverviewResponseTime | null;
}

/*
 * What the Summary card's probe picker needs, in the shape the old overview
 * built it.
 */
export interface MonitorAttachedProbes {
  probes: Array<Probe>;
  disabledProbeIds: Array<string>;
  probeResponses: Array<MonitorStepProbeResponse>;
}

export interface MonitorEvaluationByProbe {
  latest?:
    | {
        summary: MonitorEvaluationSummary;
        at: Date;
        probeId?: string | undefined;
      }
    | undefined;
  byProbeId: Dictionary<MonitorEvaluationSummary>;
  latestAt?: Date | undefined;
}

// The order the Probes card lists rows in: what needs attention first.
const HEALTH_ORDER: Record<MonitorOverviewProbeHealth, number> = {
  [MonitorOverviewProbeHealth.Down]: 0,
  [MonitorOverviewProbeHealth.Disconnected]: 1,
  [MonitorOverviewProbeHealth.Late]: 2,
  [MonitorOverviewProbeHealth.NoResultYet]: 3,
  [MonitorOverviewProbeHealth.Up]: 4,
  [MonitorOverviewProbeHealth.Reported]: 4,
  [MonitorOverviewProbeHealth.TurnedOff]: 5,
};

// Probe responses arrive as JSON: every field is read defensively.
interface ProbeResponseLike {
  monitoredAt?: unknown;
  isOnline?: unknown;
  responseTimeInMs?: unknown;
  responseCode?: unknown;
  failureCause?: unknown;
  sslResponse?:
    | { expiresAt?: unknown; isValidCertificate?: unknown }
    | undefined;
  domainResponse?: { expiresDate?: unknown } | undefined;
}

const toFiniteNumber: (value: unknown) => number | undefined = (
  value: unknown,
): number | undefined => {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

// An id that may be a string, an ObjectID or a typed JSON envelope.
const toIdString: (value: unknown) => string = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const envelopeValue: unknown = (value as JSONObject)["value"];

    if (typeof envelopeValue === "string") {
      return envelopeValue;
    }

    const text: string = String(value);

    return text === "[object Object]" ? "" : text;
  }

  return "";
};

const clamp: (value: number, min: number, max: number) => number = (
  value: number,
  min: number,
  max: number,
): number => {
  const whole: number = Number.isFinite(value) ? Math.floor(value) : min;

  return Math.min(max, Math.max(min, whole));
};

const getLogEntries: (
  monitorProbe: MonitorProbe,
  validStepIds: Set<string> | null,
) => Array<[string, ProbeResponseLike]> = (
  monitorProbe: MonitorProbe,
  validStepIds: Set<string> | null,
): Array<[string, ProbeResponseLike]> => {
  const log: unknown = monitorProbe.lastMonitoringLog;

  if (!log || typeof log !== "object") {
    return [];
  }

  return Object.entries(log as Dictionary<unknown>)
    .filter((entry: [string, unknown]) => {
      return (
        Boolean(entry[1]) &&
        typeof entry[1] === "object" &&
        (validStepIds === null || validStepIds.has(entry[0]))
      );
    })
    .map((entry: [string, unknown]): [string, ProbeResponseLike] => {
      return [entry[0], entry[1] as ProbeResponseLike];
    });
};

// The newest result time in a row's log, across all its steps.
const getNewestMonitoredAt: (monitorProbe: MonitorProbe) => Date | undefined = (
  monitorProbe: MonitorProbe,
): Date | undefined => {
  let newest: Date | undefined = undefined;

  for (const entry of getLogEntries(monitorProbe, null)) {
    const monitoredAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
      entry[1].monitoredAt,
    );

    if (monitoredAt && (!newest || monitoredAt.getTime() > newest.getTime())) {
      newest = monitoredAt;
    }
  }

  return newest;
};

const getProbeKey: (monitorProbe: MonitorProbe) => string = (
  monitorProbe: MonitorProbe,
): string => {
  return monitorProbe.probeId?.toString() || "";
};

export default class MonitorOverviewProbeUtil {
  /*
   * The picker's probes, disabled ids and raw responses. Moved verbatim from
   * the old overview page, where it was pinned by source-text tests.
   */
  public static toAttachedProbes(
    monitorProbes: Array<MonitorProbe>,
  ): MonitorAttachedProbes {
    const probeMonitorResponses: Array<MonitorStepProbeResponse> = [];
    const attachedProbes: Array<Probe> = [];
    const disabledProbeIds: Array<string> = [];

    for (let i: number = 0; i < (monitorProbes || []).length; i++) {
      const monitorProbe: MonitorProbe | undefined = monitorProbes[i];

      if (!monitorProbe) {
        continue;
      }

      if (!monitorProbe.probeId) {
        continue;
      }

      if (monitorProbe.probe) {
        const probe: Probe = monitorProbe.probe;

        /*
         * The relation select carries _id back on its own, but the join row
         * is the authority on which probe this is - and the picker keys its
         * options on that id.
         */
        probe._id = monitorProbe.probeId.toString();
        attachedProbes.push(probe);

        if (monitorProbe.isEnabled === false) {
          disabledProbeIds.push(monitorProbe.probeId.toString());
        }
      }

      if (!monitorProbe.lastMonitoringLog) {
        continue;
      }

      probeMonitorResponses.push(monitorProbe.lastMonitoringLog);
    }

    return {
      probes: attachedProbes,
      disabledProbeIds: disabledProbeIds,
      probeResponses: probeMonitorResponses,
    };
  }

  /*
   * Polls read the probe rows without lastMonitoringLog (synthetic results
   * carry screenshots). This lays the newest light fields over the last
   * full read's results. The rows are copied, never mutated.
   */
  public static mergeProbeRows(data: {
    lightRows: Array<MonitorProbe>;
    fullRows: Array<MonitorProbe>;
  }): Array<MonitorProbe> {
    const fullByProbeId: Map<string, MonitorProbe> = new Map<
      string,
      MonitorProbe
    >();

    for (const fullRow of data.fullRows || []) {
      const key: string = fullRow ? getProbeKey(fullRow) : "";

      if (key && !fullByProbeId.has(key)) {
        fullByProbeId.set(key, fullRow);
      }
    }

    return (data.lightRows || [])
      .filter((lightRow: MonitorProbe) => {
        return Boolean(lightRow);
      })
      .map((lightRow: MonitorProbe): MonitorProbe => {
        const merged: MonitorProbe = Object.assign(
          Object.create(Object.getPrototypeOf(lightRow)) as MonitorProbe,
          lightRow,
        );
        const fullRow: MonitorProbe | undefined = fullByProbeId.get(
          getProbeKey(lightRow),
        );

        if (fullRow?.lastMonitoringLog) {
          merged.lastMonitoringLog = fullRow.lastMonitoringLog;
        }

        return merged;
      });
  }

  /*
   * Whether a FULL probe read would show something the last one did not:
   * a probe was added, removed, switched on or off, or a probe has claimed
   * a check after the newest result we hold (so its result is on the way or
   * already in).
   */
  public static hasPendingProbeResults(data: {
    lightRows: Array<MonitorProbe>;
    fullRows: Array<MonitorProbe>;
  }): boolean {
    const lightRows: Array<MonitorProbe> = (data.lightRows || []).filter(
      (row: MonitorProbe) => {
        return Boolean(row);
      },
    );
    const fullRows: Array<MonitorProbe> = (data.fullRows || []).filter(
      (row: MonitorProbe) => {
        return Boolean(row);
      },
    );

    if (lightRows.length === 0) {
      return false;
    }

    const toPairs: (rows: Array<MonitorProbe>) => string = (
      rows: Array<MonitorProbe>,
    ): string => {
      return rows
        .map((row: MonitorProbe) => {
          return `${getProbeKey(row)}:${row.isEnabled === false ? "off" : "on"}`;
        })
        .sort()
        .join(",");
    };

    if (toPairs(lightRows) !== toPairs(fullRows)) {
      return true;
    }

    const fullByProbeId: Map<string, MonitorProbe> = new Map<
      string,
      MonitorProbe
    >();

    for (const fullRow of fullRows) {
      fullByProbeId.set(getProbeKey(fullRow), fullRow);
    }

    for (const lightRow of lightRows) {
      if (lightRow.isEnabled === false) {
        continue;
      }

      const claimedAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
        lightRow.lastPingAt,
      );

      if (!claimedAt) {
        continue;
      }

      const fullRow: MonitorProbe | undefined = fullByProbeId.get(
        getProbeKey(lightRow),
      );
      const newestResultAt: Date | undefined = fullRow
        ? getNewestMonitoredAt(fullRow)
        : undefined;

      if (!newestResultAt || claimedAt.getTime() > newestResultAt.getTime()) {
        return true;
      }
    }

    return false;
  }

  /*
   * The ids of the monitor's current steps. A probe's lastMonitoringLog can
   * still hold results for steps that were deleted; those must not count.
   * Null when the steps are unknown, which means "do not filter".
   */
  public static getValidStepIds(
    monitorSteps: MonitorSteps | undefined,
  ): Set<string> | null {
    const steps: unknown = monitorSteps?.data?.monitorStepsInstanceArray;

    if (!Array.isArray(steps)) {
      return null;
    }

    const ids: Set<string> = new Set<string>();

    for (const step of steps) {
      const id: unknown = (step as { data?: { id?: unknown } } | undefined)
        ?.data?.id;

      if (typeof id === "string" && id) {
        ids.add(id);
      }
    }

    return ids;
  }

  public static getPrimaryStepId(
    monitorSteps: MonitorSteps | undefined,
  ): string | null {
    const steps: unknown = monitorSteps?.data?.monitorStepsInstanceArray;

    if (!Array.isArray(steps)) {
      return null;
    }

    const id: unknown = (steps[0] as { data?: { id?: unknown } } | undefined)
      ?.data?.id;

    return typeof id === "string" && id ? id : null;
  }

  public static summarizeProbes(data: {
    monitorProbes: Array<MonitorProbe>;
    validStepIds: Set<string> | null;
    primaryStepId: string | null;
    cadenceSeconds: number;
    now: Date;
  }): MonitorOverviewProbeSummary {
    const graceSeconds: number = MonitorCheckScheduleUtil.getGraceSeconds(
      data.cadenceSeconds,
    );
    const lateAfterMs: number =
      ((Number.isFinite(data.cadenceSeconds) ? data.cadenceSeconds : 0) +
        graceSeconds) *
      1000;

    const rows: Array<MonitorOverviewProbeRow> = [];

    for (const monitorProbe of data.monitorProbes || []) {
      if (!monitorProbe) {
        continue;
      }

      const probeId: string = getProbeKey(monitorProbe);

      if (!probeId) {
        continue;
      }

      const latestResult: MonitorOverviewProbeResult | undefined =
        MonitorOverviewProbeUtil.getLatestResult({
          monitorProbe: monitorProbe,
          probeId: probeId,
          validStepIds: data.validStepIds,
          primaryStepId: data.primaryStepId,
          now: data.now,
        });

      const isEnabled: boolean = monitorProbe.isEnabled !== false;
      const connectionStatus: ProbeConnectionStatus | undefined =
        monitorProbe.probe?.connectionStatus;

      let health: MonitorOverviewProbeHealth =
        MonitorOverviewProbeHealth.Reported;

      if (!isEnabled) {
        health = MonitorOverviewProbeHealth.TurnedOff;
      } else if (connectionStatus === ProbeConnectionStatus.Disconnected) {
        health = MonitorOverviewProbeHealth.Disconnected;
      } else if (!latestResult?.monitoredAt) {
        health = MonitorOverviewProbeHealth.NoResultYet;
      } else if (
        data.now.getTime() - latestResult.monitoredAt.getTime() >
        lateAfterMs
      ) {
        health = MonitorOverviewProbeHealth.Late;
      } else if (latestResult.isOnline === false) {
        health = MonitorOverviewProbeHealth.Down;
      } else if (latestResult.isOnline === true) {
        health = MonitorOverviewProbeHealth.Up;
      }

      rows.push({
        probeId: probeId,
        name: monitorProbe.probe?.name || "Unknown probe",
        iconFileId: monitorProbe.probe?.iconFileId?.toString() || undefined,
        isEnabled: isEnabled,
        isConnected: connectionStatus
          ? connectionStatus !== ProbeConnectionStatus.Disconnected
          : null,
        lastPingAt: MonitorCheckScheduleUtil.parseDate(monitorProbe.lastPingAt),
        nextPingAt: MonitorCheckScheduleUtil.parseDate(monitorProbe.nextPingAt),
        latestResult: latestResult,
        health: health,
      });
    }

    rows.sort((a: MonitorOverviewProbeRow, b: MonitorOverviewProbeRow) => {
      const byHealth: number = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];

      if (byHealth !== 0) {
        return byHealth;
      }

      return a.name.localeCompare(b.name);
    });

    const enabledRows: Array<MonitorOverviewProbeRow> = rows.filter(
      (row: MonitorOverviewProbeRow) => {
        return row.isEnabled;
      },
    );

    let lastResultAt: Date | undefined = undefined;
    let nextCheckAt: Date | undefined = undefined;
    let latestRow: MonitorOverviewProbeRow | undefined = undefined;
    const responseTimes: Array<number> = [];

    for (const row of enabledRows) {
      const monitoredAt: Date | undefined = row.latestResult?.monitoredAt;

      if (
        monitoredAt &&
        (!lastResultAt || monitoredAt.getTime() > lastResultAt.getTime())
      ) {
        lastResultAt = monitoredAt;
        latestRow = row;
      }

      if (
        row.nextPingAt &&
        (!nextCheckAt || row.nextPingAt.getTime() < nextCheckAt.getTime())
      ) {
        nextCheckAt = row.nextPingAt;
      }

      const responseTimeInMs: number | undefined =
        row.latestResult?.responseTimeInMs;

      if (responseTimeInMs !== undefined && responseTimeInMs > 0) {
        responseTimes.push(responseTimeInMs);
      }
    }

    return {
      rows: rows,
      attachedCount: rows.length,
      enabledCount: enabledRows.length,
      reportingCount: enabledRows.filter((row: MonitorOverviewProbeRow) => {
        return (
          row.health === MonitorOverviewProbeHealth.Up ||
          row.health === MonitorOverviewProbeHealth.Down ||
          row.health === MonitorOverviewProbeHealth.Reported
        );
      }).length,
      disabledCount: rows.length - enabledRows.length,
      disconnectedCount: rows.filter((row: MonitorOverviewProbeRow) => {
        return row.health === MonitorOverviewProbeHealth.Disconnected;
      }).length,
      lastResultAt: lastResultAt,
      nextCheckAt: nextCheckAt,
      latestResult:
        latestRow && latestRow.latestResult
          ? { ...latestRow.latestResult, probeName: latestRow.name }
          : undefined,
      responseTime: MonitorOverviewProbeUtil.getResponseTime({
        responseTimes: responseTimes,
        totalCount: enabledRows.length,
      }),
    };
  }

  /*
   * The criteria verdicts behind each probe's latest result. They are only
   * in MonitorLog.logBody: the evaluationSummary on MonitorProbe's
   * lastMonitoringLog is copied before evaluation fills it, so it is always
   * empty. Logs must be sorted newest first; the first verdict per probe
   * wins.
   */
  public static getEvaluationByProbe(
    logs: Array<MonitorLog>,
  ): MonitorEvaluationByProbe {
    const byProbeId: Dictionary<MonitorEvaluationSummary> = {};
    let latest: MonitorEvaluationByProbe["latest"] = undefined;
    let latestAt: Date | undefined = undefined;

    for (let i: number = 0; i < (logs || []).length; i++) {
      const log: MonitorLog | undefined = logs[i];

      if (!log) {
        continue;
      }

      const time: Date | undefined = MonitorCheckScheduleUtil.parseDate(
        log.time,
      );

      if (i === 0) {
        latestAt = time;
      }

      const body: JSONObject | undefined = log.logBody;

      if (!body || typeof body !== "object") {
        continue;
      }

      const summary: MonitorEvaluationSummary | undefined = body[
        "evaluationSummary"
      ] as unknown as MonitorEvaluationSummary | undefined;

      if (!MonitorOverviewProbeUtil.hasVerdict(summary)) {
        continue;
      }

      const probeId: string = toIdString(body["probeId"]);

      if (probeId && !byProbeId[probeId]) {
        byProbeId[probeId] = summary as MonitorEvaluationSummary;
      }

      const at: Date | undefined =
        time ||
        MonitorCheckScheduleUtil.parseDate(
          (summary as MonitorEvaluationSummary).evaluatedAt,
        );

      if (!latest && at) {
        latest = {
          summary: summary as MonitorEvaluationSummary,
          at: at,
          probeId: probeId || undefined,
        };
      }
    }

    return {
      latest: latest,
      byProbeId: byProbeId,
      latestAt: latestAt,
    };
  }

  /*
   * How many MonitorLog rows to read. Probe checks need one verdict per
   * probe, and probes interleave, so twice the probe count (capped) is
   * enough to find each probe's newest. Scripted checks log their payloads,
   * so they read fewer. Everything else is evaluated centrally: one row.
   */
  public static getEvaluationLogLimit(data: {
    monitorType: MonitorType;
    enabledProbeCount: number;
  }): number {
    if (
      MonitorOverviewFamilyUtil.getFamily(data.monitorType) !==
      MonitorOverviewFamily.ProbeCheck
    ) {
      return 1;
    }

    if (
      data.monitorType === MonitorType.SyntheticMonitor ||
      data.monitorType === MonitorType.CustomJavaScriptCode
    ) {
      return clamp(data.enabledProbeCount, 1, 10);
    }

    return clamp(2 * data.enabledProbeCount, 1, 20);
  }

  private static hasVerdict(
    summary: MonitorEvaluationSummary | undefined,
  ): boolean {
    if (!summary || typeof summary !== "object") {
      return false;
    }

    const criteriaResults: unknown = summary.criteriaResults;
    const events: unknown = summary.events;

    return (
      (Array.isArray(criteriaResults) && criteriaResults.length > 0) ||
      (Array.isArray(events) && events.length > 0)
    );
  }

  /*
   * The result a row reports: the first step's, when it has one, because
   * that is the step the hero describes; otherwise the newest result among
   * the monitor's current steps.
   */
  private static getLatestResult(data: {
    monitorProbe: MonitorProbe;
    probeId: string;
    validStepIds: Set<string> | null;
    primaryStepId: string | null;
    now: Date;
  }): MonitorOverviewProbeResult | undefined {
    const entries: Array<[string, ProbeResponseLike]> = getLogEntries(
      data.monitorProbe,
      data.validStepIds,
    );

    if (entries.length === 0) {
      return undefined;
    }

    let chosen: ProbeResponseLike | undefined = undefined;

    if (data.primaryStepId) {
      chosen = entries.find((entry: [string, ProbeResponseLike]) => {
        return entry[0] === data.primaryStepId;
      })?.[1];
    }

    if (!chosen) {
      let newestAt: number = -Infinity;

      for (const entry of entries) {
        const monitoredAt: Date | undefined =
          MonitorCheckScheduleUtil.parseDate(entry[1].monitoredAt);
        const time: number = monitoredAt ? monitoredAt.getTime() : -Infinity;

        if (!chosen || time > newestAt) {
          chosen = entry[1];
          newestAt = time;
        }
      }
    }

    if (!chosen) {
      return undefined;
    }

    let monitoredAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
      chosen.monitoredAt,
    );

    // Clock skew between servers must not produce a check from the future.
    if (monitoredAt && monitoredAt.getTime() > data.now.getTime()) {
      monitoredAt = data.now;
    }

    const failureCause: string | undefined =
      typeof chosen.failureCause === "string" && chosen.failureCause.trim()
        ? chosen.failureCause.trim()
        : undefined;

    return {
      probeId: data.probeId,
      monitoredAt: monitoredAt,
      isOnline:
        typeof chosen.isOnline === "boolean" ? chosen.isOnline : undefined,
      responseTimeInMs: toFiniteNumber(chosen.responseTimeInMs),
      responseCode: toFiniteNumber(chosen.responseCode),
      failureCause: failureCause,
      sslExpiresAt: MonitorCheckScheduleUtil.parseDate(
        chosen.sslResponse?.expiresAt,
      ),
      isValidCertificate:
        typeof chosen.sslResponse?.isValidCertificate === "boolean"
          ? chosen.sslResponse.isValidCertificate
          : undefined,
      domainExpiresAt: MonitorCheckScheduleUtil.parseDate(
        chosen.domainResponse?.expiresDate,
      ),
    };
  }

  private static getResponseTime(data: {
    responseTimes: Array<number>;
    totalCount: number;
  }): MonitorOverviewResponseTime | null {
    if (data.responseTimes.length === 0) {
      return null;
    }

    const sorted: Array<number> = [...data.responseTimes].sort(
      (a: number, b: number) => {
        return a - b;
      },
    );
    const middle: number = Math.floor(sorted.length / 2);
    const median: number =
      sorted.length % 2 === 0
        ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
        : (sorted[middle] as number);

    return {
      medianMs: Math.round(median),
      minMs: Math.round(sorted[0] as number),
      maxMs: Math.round(sorted[sorted.length - 1] as number),
      respondedCount: sorted.length,
      totalCount: data.totalCount,
    };
  }
}
