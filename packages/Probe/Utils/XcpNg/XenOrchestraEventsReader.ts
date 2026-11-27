import { selectNewMessages } from "./XapiCollector";
import {
  XCP_NG_USER_AGENT,
  XcpNgHttpResponse,
  XcpNgTransport,
  readJsonBody,
} from "./XcpNgHttp";
import {
  XCP_NG_MAX_EVENT_MESSAGES_PER_POOL,
  XCP_NG_OPEN_MESSAGE_ID_CHUNK,
  XcpNgBackupJobInfo,
  XcpNgBackupRun,
  XcpNgBackupWatermark,
  XcpNgEventsJobState,
  XcpNgEventsReport,
  XcpNgHostPatches,
  XcpNgPoolEventsJobState,
  XcpNgPoolEventsReport,
} from "Common/Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgApiTokenSummary,
  XcpNgMessageWatermark,
  XcpNgPoolMessage,
  XcpNgPoolState,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import XcpNgCollectionErrorCode from "Common/Types/XcpNg/XcpNgCollectionError";
import {
  XcpNgBackupReadPlan,
  advanceXcpNgBackupWatermark,
  getXcpNgBackupReadSince,
  getXcpNgTrackedBackupRunIds,
  mergeXcpNgBackupSummaries,
  planXcpNgBackupRead,
} from "Common/Utils/XcpNg/XcpNgBackupReading";
import {
  XO_ALARM_FIELDS,
  XO_BACKUP_JOB_FIELDS,
  XO_BACKUP_LOG_SUMMARY_FIELDS,
  XO_HOST_FIELDS,
  XO_MESSAGE_FIELDS,
  XO_POOL_FIELDS,
  XO_SCHEDULE_FIELDS,
  XoBackupLogSummary,
  XoHostReading,
  XoPoolSince,
  buildXcpNgBackupJobInfos,
  buildXoBackupLogFilter,
  buildXoIdFilter,
  buildXoPath,
  buildXoPerPoolTimeFilter,
  buildXoPoolFilter,
  readXoAlarms,
  readXoBackupJobs,
  readXoBackupLogSummaries,
  readXoBackupRun,
  readXoHosts,
  readXoIds,
  readXoMessages,
  readXoMissingPatches,
  readXoPools,
  readXoSchedules,
} from "Common/Utils/XcpNg/XenOrchestraRest";

/*
 * ------------------------------------------------------------------
 * A pool's alarms, HA, master, patches and backups, read from Xen
 * Orchestra's REST API by the probe (#10997)
 * ------------------------------------------------------------------
 *
 * Runs in the same collection as the metrics (XenOrchestraCollector), over
 * the same verified TLS transport, with the connection's API token as Xen
 * Orchestra's `authenticationToken` cookie - the only way its REST API
 * takes one. Every read is a GET; nothing here can change Xen Orchestra.
 *
 * One collection reads, for the pools this connection reads:
 *
 *   1. /pools: whether HA is on, and the master;
 *   2. /messages and /alarms: what is new since each pool's watermark, one
 *      request each for every pool (a per-pool OR filter), and which of the
 *      messages with an open alert XAPI no longer lists;
 *   3. /backup-logs (with /backup-jobs and /schedules): the runs that
 *      finished since the backup watermark (XcpNgBackupReading);
 *   4. every six hours, each running host's missing patches.
 *
 * Each part stands on its own: one that fails says why in `problems` and
 * leaves its watermark where it was, so the next collection reads it
 * again, and the others still report. The token never reaches a log line,
 * a report or an error.
 * ------------------------------------------------------------------
 */

export const XO_EVENTS_READ_BUDGET_IN_MS: number = 90_000;

// The most hosts one patch check asks, and how many at once.
export const XO_MAX_HOSTS_PER_PATCH_CHECK: number = 100;
const PATCH_CHECK_CONCURRENCY: number = 2;

// What a cookie value may hold: Xen Orchestra's tokens are base64url.
const COOKIE_SAFE_TOKEN: RegExp = /^[A-Za-z0-9._~+/=-]+$/;

const EPOCH_ISO: string = new Date(0).toISOString();

export interface XenOrchestraEventsReadInput {
  transport: XcpNgTransport;
  // host:port, for the sentences a person reads.
  where: string;
  token: string;
  state: XcpNgEventsJobState;
  // The pools this connection reads, from the scrape (lower-case UUIDs).
  poolIds: Array<string>;
  /*
   * What the collection's last token check found: events are read only with
   * a token that reads messages and alarms and nothing more.
   */
  tokenSummary?: XcpNgApiTokenSummary | undefined;
  now: () => Date;
  budgetInMs?: number | undefined;
}

class XoReadError extends Error {
  public readonly status: number | null;
  // Its message already says why, in words fitter than the status's.
  public readonly isExplained: boolean;

  public constructor(
    message: string,
    status: number | null,
    isExplained: boolean = false,
  ) {
    super(message);
    this.status = status;
    this.isExplained = isExplained;
  }
}

/*
 * Whether events may be read with this token at all, and why not: a token
 * Xen Orchestra refused, or one that could change it, is never used for
 * them (the connection already says so); one that cannot read messages or
 * alarms would read empty lists and miss every alarm.
 */
export function getXoEventsBlocker(
  summary: XcpNgApiTokenSummary | undefined,
): string | null {
  if (!summary) {
    return null;
  }

  if (summary.errorCode === XcpNgCollectionErrorCode.TokenRejected) {
    return "Xen Orchestra refused the API token, so alarms, HA and backups were not read. Create a new token for the read-only user and save it on the connection.";
  }

  if (summary.errorCode === XcpNgCollectionErrorCode.TokenNotReadOnly) {
    return "The API token could change Xen Orchestra, so OneUptime does not use it: alarms, HA and backups were not read. Save a token of a user holding only a copy of the built-in Read only role.";
  }

  if (summary.canReadAlarms === false) {
    return "The API token cannot read alarms, so alarms, HA and backups were not read. Give its user a copy of Xen Orchestra's built-in Read only role.";
  }

  if (summary.canReadMessages === false) {
    return "The API token cannot read messages, so alarms, HA and backups were not read. Give its user a copy of Xen Orchestra's built-in Read only role.";
  }

  return null;
}

/*
 * Whether backups may be read with a token events are read with: one whose
 * user may not read backup logs reads an empty list, which would say "no
 * backups" of a Xen Orchestra that has them.
 */
export function getXoBackupsBlocker(
  summary: XcpNgApiTokenSummary | undefined,
): string | null {
  if (summary?.canReadBackupLogs === false) {
    return "The API token cannot read backup logs, so backups were not read (alarms and HA still are). Give its user a copy of Xen Orchestra's built-in Read only role.";
  }
  return null;
}

export default class XenOrchestraEventsReader {
  private readonly input: XenOrchestraEventsReadInput;
  private readonly startedAtMs: number;
  private readonly budgetInMs: number;
  private tokenRejected: boolean = false;

  private constructor(input: XenOrchestraEventsReadInput) {
    this.input = input;
    this.startedAtMs = input.now().getTime();
    this.budgetInMs = input.budgetInMs ?? XO_EVENTS_READ_BUDGET_IN_MS;
  }

  public static async read(
    input: XenOrchestraEventsReadInput,
  ): Promise<XcpNgEventsReport> {
    return await new XenOrchestraEventsReader(input).readAll();
  }

  private isOverBudget(): boolean {
    return this.input.now().getTime() - this.startedAtMs > this.budgetInMs;
  }

  private async get(path: string): Promise<unknown> {
    if (this.tokenRejected) {
      throw new XoReadError("Xen Orchestra refused the API token.", 401);
    }

    let response: XcpNgHttpResponse;

    try {
      response = await this.input.transport({
        method: "GET",
        path: path,
        headers: {
          "User-Agent": XCP_NG_USER_AGENT,
          Accept: "application/json",
          Cookie: `authenticationToken=${this.input.token}`,
        },
      });
    } catch (error) {
      /*
       * The transport's own words: an address, a timeout, a certificate.
       * Never the request, which holds the token.
       */
      throw new XoReadError(
        `Xen Orchestra at ${this.input.where} did not answer: ${
          error instanceof Error ? error.message : String(error)
        }`,
        null,
      );
    }

    if (response.status === 200) {
      const json: unknown | null = readJsonBody(response);
      if (json === null) {
        throw new XoReadError(
          `Xen Orchestra at ${this.input.where} answered with something that is not JSON.`,
          200,
        );
      }
      return json;
    }

    if (response.status === 401) {
      this.tokenRejected = true;
      throw new XoReadError(
        `Xen Orchestra at ${this.input.where} refused the API token: it is wrong, or it expired. Create a new token for the read-only user and save it on the connection.`,
        401,
      );
    }

    throw new XoReadError(
      `Xen Orchestra at ${this.input.where} answered HTTP ${response.status}.`,
      response.status,
    );
  }

  private async readAll(): Promise<XcpNgEventsReport> {
    const report: XcpNgEventsReport = {
      pools: [],
      problems: {},
      warnings: [],
    };

    const blocker: string | null = getXoEventsBlocker(this.input.tokenSummary);
    if (blocker) {
      report.problems.messages = blocker;
      report.problems.backups = blocker;
      return report;
    }

    if (!COOKIE_SAFE_TOKEN.test(this.input.token)) {
      const problem: string =
        "The API token holds characters Xen Orchestra's tokens never do, so it was not sent. Copy the token again.";
      report.problems.messages = problem;
      report.problems.backups = problem;
      return report;
    }

    const poolIds: Set<string> = new Set<string>(
      this.input.poolIds.map((poolId: string): string => {
        return poolId.toLowerCase();
      }),
    );

    // 1. HA and the master.
    const poolStates: Map<string, XcpNgPoolState> = new Map();
    try {
      for (const state of readXoPools(
        await this.get(
          buildXoPath("/rest/v0/pools", { fields: XO_POOL_FIELDS }),
        ),
      )) {
        if (poolIds.has(state.poolId)) {
          poolStates.set(state.poolId, state);
        }
      }
    } catch (error) {
      report.problems.messages = this.describe(error, "its pools");
    }

    // 2. Messages and alarms.
    if (!this.tokenRejected) {
      try {
        report.pools = await this.readMessages({
          poolIds: poolIds,
          poolStates: poolStates,
        });
      } catch (error) {
        report.problems.messages = this.describe(error, "its alarms");
        report.pools = [];
      }
    }

    // A pool whose messages were not read still reports its HA and master.
    for (const [poolId, state] of poolStates) {
      if (
        !report.pools.some((pool: XcpNgPoolEventsReport): boolean => {
          return pool.poolId === poolId;
        })
      ) {
        const known: XcpNgPoolEventsJobState | undefined =
          this.input.state.pools.find(
            (pool: XcpNgPoolEventsJobState): boolean => {
              return pool.poolId === poolId;
            },
          );
        if (known?.messageWatermark) {
          report.pools.push({
            poolId: poolId,
            poolState: state,
            messages: [],
            messageWatermark: known.messageWatermark,
            clearedMessageIds: [],
          });
        }
      }
    }

    // 3. Backups.
    const backupsBlocker: string | null = getXoBackupsBlocker(
      this.input.tokenSummary,
    );
    if (backupsBlocker) {
      report.problems.backups = backupsBlocker;
    } else if (!this.tokenRejected && !this.isOverBudget()) {
      try {
        const backups: {
          runs: Array<XcpNgBackupRun>;
          watermark: XcpNgBackupWatermark;
          jobs: Array<XcpNgBackupJobInfo> | undefined;
          jobsWarning?: string | undefined;
        } = await this.readBackups();
        report.backupRuns = backups.runs;
        report.backupWatermark = backups.watermark;
        if (backups.jobs) {
          report.backupJobs = backups.jobs;
        }
        if (backups.jobsWarning) {
          report.warnings.push(backups.jobsWarning);
        }
      } catch (error) {
        report.problems.backups = this.describe(error, "its backup logs");
      }
    } else if (!this.tokenRejected) {
      report.warnings.push(
        "Backups were not read this time: reading Xen Orchestra took too long. They are read next time.",
      );
    }

    // 4. Missing patches, every six hours.
    if (this.input.state.checkPatches && !this.tokenRejected) {
      try {
        report.hostPatches = await this.readPatches(poolIds);
      } catch (error) {
        report.problems.patches = this.describe(error, "its hosts' patches");
      }
    }

    if (this.tokenRejected) {
      const problem: string = `Xen Orchestra at ${this.input.where} refused the API token: it is wrong, or it expired. Create a new token for the read-only user and save it on the connection.`;
      report.problems.messages = problem;
      report.problems.backups = problem;
      delete report.backupRuns;
      delete report.backupWatermark;
      delete report.backupJobs;
      delete report.hostPatches;
      report.pools = [];
    }

    return report;
  }

  private describe(error: unknown, what: string): string {
    if (error instanceof XoReadError) {
      if (error.isExplained) {
        return error.message;
      }
      if (error.status === 403) {
        return `Xen Orchestra at ${this.input.where} does not let the API token read ${what} (HTTP 403). Give its user a copy of the built-in Read only role.`;
      }
      if (error.status === 404) {
        return `Xen Orchestra at ${this.input.where} has no REST API for ${what} (HTTP 404). It needs Xen Orchestra 6.9 or later.`;
      }
      return error.message;
    }
    return `Reading ${what} failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  private async readMessages(data: {
    poolIds: Set<string>;
    poolStates: Map<string, XcpNgPoolState>;
  }): Promise<Array<XcpNgPoolEventsReport>> {
    const statesById: Map<string, XcpNgPoolEventsJobState> = new Map();
    for (const pool of this.input.state.pools) {
      if (data.poolIds.has(pool.poolId.toLowerCase())) {
        statesById.set(pool.poolId.toLowerCase(), pool);
      }
    }

    // Every pool the scrape reports is read; one with no state starts now.
    for (const poolId of data.poolIds) {
      if (!statesById.has(poolId)) {
        statesById.set(poolId, { poolId: poolId, openMessageIds: [] });
      }
    }

    const reports: Array<XcpNgPoolEventsReport> = [];
    const withWatermark: Array<XcpNgPoolEventsJobState> = [];

    for (const pool of statesById.values()) {
      if (pool.messageWatermark) {
        withWatermark.push(pool);
        continue;
      }
      // First read: from the pool's newest message on, not its history.
      reports.push({
        poolId: pool.poolId,
        poolState: data.poolStates.get(pool.poolId),
        messages: [],
        messageWatermark: await this.readFirstWatermark(pool.poolId),
        clearedMessageIds: [],
      });
    }

    if (withWatermark.length === 0) {
      return reports;
    }

    const sinceSeconds: Array<XoPoolSince> = withWatermark.map(
      (pool: XcpNgPoolEventsJobState): XoPoolSince => {
        const readUntil: number = new Date(
          (pool.messageWatermark as XcpNgMessageWatermark).readUntil,
        ).getTime();
        // A second early: times are whole seconds, and the watermark dedupes.
        return {
          poolId: pool.poolId,
          since: Number.isFinite(readUntil)
            ? Math.max(0, Math.floor(readUntil / 1000) - 1)
            : 0,
        };
      },
    );

    const messageFilter: string | null = buildXoPerPoolTimeFilter(sinceSeconds);
    const alarmFilter: string | null = buildXoPerPoolTimeFilter(
      sinceSeconds.map((pool: XoPoolSince): XoPoolSince => {
        return { poolId: pool.poolId, since: pool.since * 1000 };
      }),
    );

    const received: Array<XcpNgPoolMessage> = [];

    if (messageFilter && alarmFilter) {
      received.push(
        ...readXoMessages(
          await this.get(
            buildXoPath("/rest/v0/messages", {
              fields: XO_MESSAGE_FIELDS,
              filter: messageFilter,
            }),
          ),
        ),
        ...readXoAlarms(
          await this.get(
            buildXoPath("/rest/v0/alarms", {
              fields: XO_ALARM_FIELDS,
              filter: alarmFilter,
            }),
          ),
        ),
      );
    }

    for (const pool of withWatermark) {
      const selected: {
        messages: Array<XcpNgPoolMessage>;
        watermark: XcpNgMessageWatermark;
      } = selectNewMessages({
        watermark: pool.messageWatermark as XcpNgMessageWatermark,
        received: received.filter((message: XcpNgPoolMessage): boolean => {
          return message.poolId === pool.poolId;
        }),
        max: XCP_NG_MAX_EVENT_MESSAGES_PER_POOL,
      });

      reports.push({
        poolId: pool.poolId,
        poolState: data.poolStates.get(pool.poolId),
        messages: selected.messages,
        messageWatermark: selected.watermark,
        clearedMessageIds: await this.findClearedMessages(pool),
      });
    }

    return reports;
  }

  /*
   * A pool's first watermark: its newest message, so what XAPI said before
   * OneUptime read the pool is not raised now. A pool with no message at
   * all starts at the epoch: whatever comes next is new.
   */
  private async readFirstWatermark(
    poolId: string,
  ): Promise<XcpNgMessageWatermark> {
    const filter: string | null = buildXoPoolFilter(poolId);
    if (!filter) {
      return { readUntil: EPOCH_ISO, uuidsAtReadUntil: [] };
    }

    const known: Array<XcpNgPoolMessage> = [
      ...readXoMessages(
        await this.get(
          buildXoPath("/rest/v0/messages", {
            fields: "id,name,time,$pool",
            filter: filter,
          }),
        ),
      ),
      ...readXoAlarms(
        await this.get(
          buildXoPath("/rest/v0/alarms", {
            fields: "id,name,time,$pool",
            filter: filter,
          }),
        ),
      ),
    ];

    let newest: number = 0;
    for (const message of known) {
      const time: number = new Date(message.timestamp).getTime();
      if (time > newest) {
        newest = time;
      }
    }

    return {
      readUntil: new Date(newest).toISOString(),
      uuidsAtReadUntil: known
        .filter((message: XcpNgPoolMessage): boolean => {
          return new Date(message.timestamp).getTime() === newest;
        })
        .map((message: XcpNgPoolMessage): string => {
          return message.uuid;
        }),
    };
  }

  /*
   * Of the messages with an open alert, those XAPI no longer lists. An id
   * is cleared only when both lists were read and neither holds it: a read
   * that failed proves nothing. Without a token summary saying it may read
   * messages, nothing is cleared - an empty list might only mean it may not.
   */
  private async findClearedMessages(
    pool: XcpNgPoolEventsJobState,
  ): Promise<Array<string>> {
    const ids: Array<string> = Array.from(new Set(pool.openMessageIds || []));
    const canReadMessages: boolean | undefined =
      this.input.tokenSummary?.canReadMessages;

    if (ids.length === 0 || canReadMessages !== true) {
      return [];
    }

    const cleared: Array<string> = [];

    for (
      let index: number = 0;
      index < ids.length && !this.isOverBudget();
      index += XCP_NG_OPEN_MESSAGE_ID_CHUNK
    ) {
      const chunk: Array<string> = ids.slice(
        index,
        index + XCP_NG_OPEN_MESSAGE_ID_CHUNK,
      );
      const filter: string | null = buildXoIdFilter(chunk);
      if (!filter) {
        continue;
      }

      try {
        const present: Set<string> = new Set<string>([
          ...readXoIds(
            await this.get(
              buildXoPath("/rest/v0/messages", {
                fields: "id",
                filter: filter,
              }),
            ),
          ),
          ...readXoIds(
            await this.get(
              buildXoPath("/rest/v0/alarms", { fields: "id", filter: filter }),
            ),
          ),
        ]);

        for (const id of chunk) {
          if (!present.has(id)) {
            cleared.push(id);
          }
        }
      } catch {
        // Not proven gone: asked again next time.
      }
    }

    return cleared;
  }

  private async readBackups(): Promise<{
    runs: Array<XcpNgBackupRun>;
    watermark: XcpNgBackupWatermark;
    jobs: Array<XcpNgBackupJobInfo> | undefined;
    jobsWarning?: string | undefined;
  }> {
    const nowMs: number = this.input.now().getTime();
    const watermark: XcpNgBackupWatermark | undefined =
      this.input.state.backupWatermark;
    const readSince: number = getXcpNgBackupReadSince({
      watermark: watermark,
      nowMs: nowMs,
    });

    const sinceSummaries: Array<XoBackupLogSummary> = readXoBackupLogSummaries(
      await this.get(
        buildXoPath("/rest/v0/backup-logs", {
          fields: XO_BACKUP_LOG_SUMMARY_FIELDS,
          filter: buildXoBackupLogFilter(readSince),
        }),
      ),
    );

    // The runs followed by id: still pending, or waiting their turn.
    const trackedIds: Array<string> = getXcpNgTrackedBackupRunIds(watermark);
    const trackedSummaries: Array<XoBackupLogSummary> = [];
    for (
      let index: number = 0;
      index < trackedIds.length;
      index += XCP_NG_OPEN_MESSAGE_ID_CHUNK
    ) {
      const filter: string | null = buildXoIdFilter(
        trackedIds.slice(index, index + XCP_NG_OPEN_MESSAGE_ID_CHUNK),
      );
      if (filter) {
        trackedSummaries.push(
          ...readXoBackupLogSummaries(
            await this.get(
              buildXoPath("/rest/v0/backup-logs", {
                fields: XO_BACKUP_LOG_SUMMARY_FIELDS,
                filter: filter,
              }),
            ),
          ),
        );
      }
    }

    const summaries: Array<XoBackupLogSummary> = mergeXcpNgBackupSummaries(
      sinceSummaries,
      trackedSummaries,
    );

    const plan: XcpNgBackupReadPlan = planXcpNgBackupRead({
      watermark: watermark,
      summaries: summaries,
    });

    const runs: Array<XcpNgBackupRun> = [];
    const delivered: Array<string> = plan.passedOver.map(
      (summary: XoBackupLogSummary): string => {
        return summary.id;
      },
    );

    for (const summary of plan.toFetch) {
      if (this.isOverBudget()) {
        break;
      }
      try {
        const run: XcpNgBackupRun | null = readXoBackupRun(
          await this.get(
            `/rest/v0/backup-logs/${encodeURIComponent(summary.id)}`,
          ),
        );
        if (run) {
          // The summary names the job even when the full log does not.
          if (run.jobName === run.jobId && summary.jobName) {
            run.jobName = summary.jobName;
          }
          runs.push(run);
        }
        // A log that is not a run any more is not asked for again.
        delivered.push(summary.id);
      } catch (error) {
        if (this.tokenRejected) {
          throw error;
        }
        // Read again next time: it stays waiting.
      }
    }

    /*
     * Each job, and when it runs. Not read is not "no jobs": the server
     * keeps the ones it knows until a read lists the jobs again.
     */
    let jobs: Array<XcpNgBackupJobInfo> | undefined = undefined;
    let jobsWarning: string | undefined = undefined;
    try {
      const jobReadings: ReturnType<typeof readXoBackupJobs> = readXoBackupJobs(
        await this.get(
          buildXoPath("/rest/v0/backup-jobs", {
            fields: XO_BACKUP_JOB_FIELDS,
          }),
        ),
      );
      const scheduleReadings: ReturnType<typeof readXoSchedules> =
        readXoSchedules(
          await this.get(
            buildXoPath("/rest/v0/schedules", { fields: XO_SCHEDULE_FIELDS }),
          ),
        );

      /*
       * A list the token's user may not read comes back empty, never
       * refused: runs of jobs with no job listed, or jobs with no schedule
       * at all, are read as not known - never as "no jobs" or "never
       * scheduled", which would call every VM's backups unscheduled.
       */
      const isUnreadable: boolean =
        (jobReadings.length === 0 && summaries.length > 0) ||
        (jobReadings.length > 0 && scheduleReadings.length === 0);

      if (isUnreadable) {
        jobsWarning =
          "The API token reads no backup jobs or no schedules, so how often each VM is backed up is not known and VM Not Backed Up cannot fire. Give the token's user read access to backup jobs and schedules.";
      } else {
        jobs = buildXcpNgBackupJobInfos({
          jobs: jobReadings,
          schedules: scheduleReadings,
        });
      }
    } catch (error) {
      if (this.tokenRejected) {
        throw error;
      }
      // The runs still count; the jobs' intervals are read next time.
    }

    return {
      runs: runs,
      jobsWarning: jobsWarning,
      watermark: advanceXcpNgBackupWatermark({
        watermark: watermark,
        summaries: summaries,
        deliveredRunIds: delivered,
        nowMs: nowMs,
      }),
      jobs: jobs,
    };
  }

  private async readPatches(
    poolIds: Set<string>,
  ): Promise<Array<XcpNgHostPatches>> {
    const hosts: Array<XoHostReading> = readXoHosts(
      await this.get(buildXoPath("/rest/v0/hosts", { fields: XO_HOST_FIELDS })),
    )
      .filter((host: XoHostReading): boolean => {
        // A halted host cannot say what it misses.
        return poolIds.has(host.poolId) && host.isRunning;
      })
      .slice(0, XO_MAX_HOSTS_PER_PATCH_CHECK);

    const results: Array<XcpNgHostPatches> = [];
    let refusal: XoReadError | null = null;
    let next: number = 0;

    const work: () => Promise<void> = async (): Promise<void> => {
      while (next < hosts.length && !refusal && !this.isOverBudget()) {
        const host: XoHostReading = hosts[next++] as XoHostReading;
        try {
          const read: ReturnType<typeof readXoMissingPatches> =
            readXoMissingPatches(
              await this.get(
                `/rest/v0/hosts/${encodeURIComponent(host.hostId)}/missing_patches`,
              ),
            );
          results.push({
            hostId: host.hostId,
            patchCount: read.patchCount,
            patches: read.patches,
          });
        } catch (error) {
          /*
           * 403 is the licence (an Appliance whose plan does not list
           * patches) or the role, and the same for every host: stop.
           */
          if (
            error instanceof XoReadError &&
            (error.status === 403 || error.status === 401)
          ) {
            refusal = error;
          }
          // Any other failure leaves this host's last count as it was.
        }
      }
    };

    await Promise.all(
      Array.from({
        length: Math.min(PATCH_CHECK_CONCURRENCY, hosts.length),
      }).map(() => {
        return work();
      }),
    );

    if (refusal && results.length === 0) {
      const status: number | null = (refusal as XoReadError).status;
      throw status === 403
        ? new XoReadError(
            `Xen Orchestra at ${this.input.where} does not list missing patches for the API token (HTTP 403): on the Xen Orchestra Appliance it needs a plan that includes them, and the token's user needs host read access.`,
            403,
            true,
          )
        : (refusal as XoReadError);
    }

    results.sort((left: XcpNgHostPatches, right: XcpNgHostPatches): number => {
      return left.hostId < right.hostId ? -1 : 1;
    });

    return results;
  }
}
