import GlobalCache from "../../Infrastructure/GlobalCache";
import OneUptimeDate from "../../../Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import Typeof from "../../../Types/Typeof";
import logger from "../Logger";
import { createHash } from "crypto";

/*
 * What the heartbeat paths keep in Redis so they stop rewriting the Monitor
 * row on every beat.
 *
 * A server agent reports every 30 seconds, an incoming request monitor's
 * sender can call every few, and the two heartbeat sweeps visited every
 * incoming request and incoming email monitor every 30 seconds - each of
 * those wrote the Monitor row, and each sweep visit evaluated the monitor.
 * Now:
 *
 * - Writes are fenced (isWriteDue / markWritten). A server report writes the
 *   row at most every SERVER_REPORT_WRITE_EVERY_SECONDS; an incoming request
 *   writes it when the request differs from the last one written (its
 *   fingerprint) and otherwise at most every so often; a sweep stamps "status
 *   checked at" at most every CHECK_STAMP_WRITE_EVERY_SECONDS. A fence is set
 *   only after its write succeeded.
 * - A server report's arrival is kept here on every report
 *   (recordServerReport), so a check of the monitor judges the latest
 *   arrival, not the last one written.
 * - A sweep skips evaluating a heartbeat monitor while nothing it would judge
 *   can have changed (canSkipEvaluation): its latest arrival was already
 *   evaluated, against the same criteria and the same status, and less time
 *   has passed since that arrival than the shortest heartbeat window its
 *   criteria name. No "received in N minutes" filter can have turned in that
 *   time, and nothing else the criteria judge changes without a new arrival.
 *   Once the window has passed it is evaluated every sweep, as before.
 *
 * Nothing here throws. A Redis that cannot be reached fences nothing (every
 * write happens), keeps no arrival (the row's is used) and lets no
 * evaluation be skipped - as before.
 */

export enum HeartbeatWrite {
  // A server agent's report: when it arrived and what it said.
  ServerReport = "server-report",
  // An incoming request: the latest request, as it came and as people read it.
  IncomingRequest = "incoming-request",
  // The heartbeat sweeps' "status checked at" stamps.
  IncomingRequestCheck = "incoming-request-check",
  IncomingEmailCheck = "incoming-email-check",
}

export enum HeartbeatKind {
  IncomingRequest = "incoming-request",
  IncomingEmail = "incoming-email",
}

// What a monitor's criteria judge of its heartbeats (scanFilters).
interface HeartbeatFilters {
  // The shortest "received in N minutes" window, in ms; null when none.
  shortestWindowInMs: number | null;
  // Whether every filter changes only with a new arrival or a window.
  changesOnlyWithArrivals: boolean;
  checkOns: Set<CheckOn>;
}

// When one filter can turn (getFilterTurns).
interface FilterTurns {
  windowInMs?: number | undefined;
  withoutArrival: boolean;
}

// What an evaluation of a heartbeat judged, for the sweep to compare.
export interface HeartbeatEvaluation {
  kind: HeartbeatKind;
  monitorId: ObjectID;
  // The arrival judged.
  receivedAt: Date | string | undefined;
  monitorSteps: MonitorSteps | undefined;
  // The monitor's status as the evaluation found it.
  monitorStatusId: ObjectID | string | undefined | null;
}

const TIME_CHECK_ON: Record<HeartbeatKind, CheckOn> = {
  [HeartbeatKind.IncomingRequest]: CheckOn.IncomingRequest,
  [HeartbeatKind.IncomingEmail]: CheckOn.EmailReceivedAt,
};

// What these criteria judge that only a new arrival changes.
const ARRIVAL_CHECK_ONS: Record<HeartbeatKind, Array<CheckOn>> = {
  [HeartbeatKind.IncomingRequest]: [
    CheckOn.RequestBody,
    CheckOn.RequestHeader,
    CheckOn.RequestHeaderValue,
  ],
  [HeartbeatKind.IncomingEmail]: [
    CheckOn.EmailSubject,
    CheckOn.EmailFrom,
    CheckOn.EmailBody,
    CheckOn.EmailTo,
  ],
};

export default class MonitorHeartbeatState {
  public static readonly NAMESPACE: string = "monitor-heartbeat";

  public static readonly SERVER_REPORT_WRITE_EVERY_SECONDS: number = 120;

  public static readonly INCOMING_REQUEST_WRITE_EVERY_SECONDS: number = 120;

  // However short a monitor's window, a write is fenced at least this long.
  public static readonly SHORTEST_WRITE_EVERY_SECONDS: number = 15;

  public static readonly CHECK_STAMP_WRITE_EVERY_SECONDS: number = 300;

  public static readonly RECEIPT_EXPIRES_IN_SECONDS: number = 24 * 60 * 60;

  public static readonly EVALUATION_EXPIRES_IN_SECONDS: number = 60 * 60;

  /*
   * Whether these columns are due to be written: no write is fenced, or the
   * fingerprint given differs from the one last written. True when Redis
   * cannot tell.
   */
  public static async isWriteDue(input: {
    monitorId: ObjectID;
    write: HeartbeatWrite;
    fingerprint?: string | undefined;
  }): Promise<boolean> {
    try {
      const fence: string | null = await GlobalCache.getString(
        this.NAMESPACE,
        this.getKey(["write", input.write, input.monitorId.toString()]),
      );

      if (fence === null) {
        return true;
      }

      return (
        input.fingerprint !== undefined &&
        fence !== this.toFenceValue(input.fingerprint)
      );
    } catch (err) {
      logger.debug("Could not read a heartbeat write fence.");
      logger.debug(err);
      return true;
    }
  }

  // Fences the write just made for everySeconds. Never throws.
  public static async markWritten(input: {
    monitorId: ObjectID;
    write: HeartbeatWrite;
    fingerprint?: string | undefined;
    everySeconds: number;
  }): Promise<void> {
    try {
      await GlobalCache.setString(
        this.NAMESPACE,
        this.getKey(["write", input.write, input.monitorId.toString()]),
        this.toFenceValue(input.fingerprint),
        {
          expiresInSeconds: Math.max(1, Math.floor(input.everySeconds)),
        },
      );
    } catch (err) {
      logger.debug("Could not fence a heartbeat write.");
      logger.debug(err);
    }
  }

  // Keeps a server report's arrival, the latest of all. Never throws.
  public static async recordServerReport(input: {
    monitorId: ObjectID;
    receivedAt: Date | string | undefined;
  }): Promise<void> {
    const receivedAtInMs: number | null = this.toEpochMs(input.receivedAt);

    if (receivedAtInMs === null) {
      return;
    }

    try {
      await GlobalCache.setNumberIfGreater(
        this.NAMESPACE,
        this.getKey(["server-report", input.monitorId.toString()]),
        receivedAtInMs,
        { expiresInSeconds: this.RECEIPT_EXPIRES_IN_SECONDS },
      );
    } catch (err) {
      logger.debug("Could not keep a server report's arrival.");
      logger.debug(err);
    }
  }

  // The latest server report kept for the monitor; null when unknown.
  public static async getServerReportReceivedAt(
    monitorId: ObjectID,
  ): Promise<Date | null> {
    try {
      const value: string | null = await GlobalCache.getString(
        this.NAMESPACE,
        this.getKey(["server-report", monitorId.toString()]),
      );
      const receivedAtInMs: number = Number(value);

      return value && Number.isFinite(receivedAtInMs) && receivedAtInMs > 0
        ? new Date(receivedAtInMs)
        : null;
    } catch (err) {
      logger.debug("Could not read a server report's arrival.");
      logger.debug(err);
      return null;
    }
  }

  // Records what an evaluation of a heartbeat judged. Never throws.
  public static async markEvaluated(
    evaluation: HeartbeatEvaluation,
  ): Promise<void> {
    const value: string | null = this.toEvaluationValue(evaluation);

    if (!value) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.NAMESPACE,
        this.getKey([
          "evaluated",
          evaluation.kind,
          evaluation.monitorId.toString(),
        ]),
        value,
        { expiresInSeconds: this.EVALUATION_EXPIRES_IN_SECONDS },
      );
    } catch (err) {
      logger.debug("Could not record a heartbeat evaluation.");
      logger.debug(err);
    }
  }

  /*
   * Whether evaluating the monitor now would judge exactly what its last
   * evaluation judged: the same arrival, criteria and status, and too little
   * time since the arrival for any heartbeat window to have turned. False
   * when it cannot be told.
   */
  public static async canSkipEvaluation(
    evaluation: HeartbeatEvaluation & { now: Date },
  ): Promise<boolean> {
    const windowInMs: number | null = this.getShortestWindowInMs({
      kind: evaluation.kind,
      monitorSteps: evaluation.monitorSteps,
    });

    const receivedAtInMs: number | null = this.toEpochMs(evaluation.receivedAt);

    if (windowInMs === null || receivedAtInMs === null) {
      return false;
    }

    if (evaluation.now.getTime() - receivedAtInMs >= windowInMs) {
      return false;
    }

    const value: string | null = this.toEvaluationValue(evaluation);

    if (!value) {
      return false;
    }

    try {
      const evaluated: string | null = await GlobalCache.getString(
        this.NAMESPACE,
        this.getKey([
          "evaluated",
          evaluation.kind,
          evaluation.monitorId.toString(),
        ]),
      );

      return evaluated === value;
    } catch (err) {
      logger.debug("Could not read a heartbeat evaluation.");
      logger.debug(err);
      return false;
    }
  }

  /*
   * The shortest heartbeat window the monitor's criteria name, in
   * milliseconds - the soonest any of its "received in N minutes" filters
   * can turn after an arrival. Null when its criteria judge anything that
   * can change without a new arrival (another check, or a filter evaluated
   * over time), or name no window at all: such a monitor is evaluated every
   * sweep.
   */
  public static getShortestWindowInMs(input: {
    kind: HeartbeatKind;
    monitorSteps: MonitorSteps | undefined;
  }): number | null {
    const filters: HeartbeatFilters = this.scanFilters(input);

    return filters.changesOnlyWithArrivals ? filters.shortestWindowInMs : null;
  }

  /*
   * What the heartbeat sweep judges of an incoming request again, as a
   * fingerprint: its method and body (filters and grouping read the body),
   * and its headers when any filter could judge them. A sender repeating
   * the same ping has the same fingerprint whenever it arrives - a header a
   * proxy adds to every request (a request id) changes nothing unless the
   * criteria could read it.
   */
  public static getIncomingRequestFingerprint(input: {
    request: IncomingMonitorRequest;
    monitorSteps: MonitorSteps | undefined;
  }): string {
    const filters: HeartbeatFilters = this.scanFilters({
      kind: HeartbeatKind.IncomingRequest,
      monitorSteps: input.monitorSteps,
    });

    const judgesHeaders: boolean = Array.from(filters.checkOns).some(
      (checkOn: CheckOn) => {
        return (
          checkOn !== CheckOn.IncomingRequest && checkOn !== CheckOn.RequestBody
        );
      },
    );

    return this.getFingerprint({
      method: input.request.requestMethod || null,
      body: input.request.requestBody ?? null,
      headers: judgesHeaders ? input.request.requestHeaders ?? null : null,
    });
  }

  /*
   * How long an unchanged incoming request is fenced: half the monitor's
   * shortest heartbeat window, so the arrival the row keeps - the floor the
   * sweep falls back to when Redis has none - is never older than that, and
   * at most INCOMING_REQUEST_WRITE_EVERY_SECONDS.
   */
  public static getIncomingRequestWriteEverySeconds(
    monitorSteps: MonitorSteps | undefined,
  ): number {
    const windowInMs: number | null = this.scanFilters({
      kind: HeartbeatKind.IncomingRequest,
      monitorSteps: monitorSteps,
    }).shortestWindowInMs;

    if (windowInMs === null) {
      return this.INCOMING_REQUEST_WRITE_EVERY_SECONDS;
    }

    return Math.min(
      this.INCOMING_REQUEST_WRITE_EVERY_SECONDS,
      Math.max(
        this.SHORTEST_WRITE_EVERY_SECONDS,
        Math.floor(windowInMs / 2 / 1000),
      ),
    );
  }

  private static scanFilters(input: {
    kind: HeartbeatKind;
    monitorSteps: MonitorSteps | undefined;
  }): HeartbeatFilters {
    const filters: HeartbeatFilters = {
      shortestWindowInMs: null,
      changesOnlyWithArrivals: true,
      checkOns: new Set<CheckOn>(),
    };

    const steps: Array<MonitorStep> =
      input.monitorSteps?.data?.monitorStepsInstanceArray || [];

    for (const step of steps) {
      const instances: Array<MonitorCriteriaInstance> =
        step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

      for (const instance of instances) {
        for (const filter of instance?.data?.filters || []) {
          if (!filter) {
            continue;
          }

          filters.checkOns.add(filter.checkOn);

          const turns: FilterTurns = this.getFilterTurns({
            kind: input.kind,
            filter: filter,
          });

          if (turns.withoutArrival) {
            filters.changesOnlyWithArrivals = false;
          }

          if (
            turns.windowInMs !== undefined &&
            (filters.shortestWindowInMs === null ||
              turns.windowInMs < filters.shortestWindowInMs)
          ) {
            filters.shortestWindowInMs = turns.windowInMs;
          }
        }
      }
    }

    if (filters.shortestWindowInMs === null) {
      filters.changesOnlyWithArrivals = false;
    }

    return filters;
  }

  /*
   * When this filter can turn: windowInMs after an arrival, for a "received
   * in N minutes" filter; withoutArrival, for one that can turn with no new
   * arrival at all - another check, or a filter evaluated over time.
   */
  private static getFilterTurns(input: {
    kind: HeartbeatKind;
    filter: CriteriaFilter;
  }): FilterTurns {
    const filter: CriteriaFilter = input.filter;

    if (ARRIVAL_CHECK_ONS[input.kind].includes(filter.checkOn)) {
      return { withoutArrival: Boolean(filter.evaluateOverTime) };
    }

    if (filter.checkOn !== TIME_CHECK_ON[input.kind]) {
      return { withoutArrival: true };
    }

    const windowInMs: number | undefined = this.getWindowInMs(filter);

    return {
      withoutArrival: Boolean(filter.evaluateOverTime),
      ...(windowInMs !== undefined ? { windowInMs: windowInMs } : {}),
    };
  }

  /*
   * A "received in N minutes" filter's N, in ms, read as the criteria read it
   * (IncomingRequestCriteria, IncomingEmailCriteria). Undefined for a filter
   * those criteria never meet: another filter type, or no N.
   */
  private static getWindowInMs(filter: CriteriaFilter): number | undefined {
    if (
      filter.filterType !== FilterType.RecievedInMinutes &&
      filter.filterType !== FilterType.NotRecievedInMinutes
    ) {
      return undefined;
    }

    let value: number | string | undefined = filter.value;

    if (!value) {
      return undefined;
    }

    if (typeof value === Typeof.String) {
      value = parseInt(value as string);
    }

    if (typeof value !== Typeof.Number || !Number.isFinite(value)) {
      return undefined;
    }

    return (value as number) * 60 * 1000;
  }

  // A fingerprint of what a check judges, for isWriteDue.
  public static getFingerprint(value: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(value ?? null))
      .digest("hex");
  }

  private static toEvaluationValue(
    evaluation: HeartbeatEvaluation,
  ): string | null {
    const receivedAtInMs: number | null = this.toEpochMs(evaluation.receivedAt);

    if (receivedAtInMs === null || !evaluation.monitorSteps) {
      return null;
    }

    const steps: unknown =
      typeof (evaluation.monitorSteps as { toJSON?: unknown }).toJSON ===
      "function"
        ? evaluation.monitorSteps.toJSON()
        : evaluation.monitorSteps;

    return [
      receivedAtInMs,
      this.getFingerprint(steps),
      evaluation.monitorStatusId?.toString().toLowerCase() || "-",
    ].join(":");
  }

  private static toFenceValue(fingerprint: string | undefined): string {
    return fingerprint || "-";
  }

  private static getKey(parts: Array<string>): string {
    return parts.join("-").toLowerCase();
  }

  private static toEpochMs(value: Date | string | undefined): number | null {
    if (!value) {
      return null;
    }

    try {
      const time: number = OneUptimeDate.fromString(value).getTime();
      return Number.isFinite(time) ? Math.floor(time) : null;
    } catch {
      return null;
    }
  }
}
