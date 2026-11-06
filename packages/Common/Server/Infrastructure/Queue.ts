import { AppVersion, QueueDashboardSecret } from "../EnvironmentConfig";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import { Queue as BullQueue, Job, JobsOptions, RepeatableJob } from "bullmq";
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressRouter } from "../Utils/Express";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import QueueJobTraceContext from "../Utils/Telemetry/QueueJobTraceContext";
import logger from "../Utils/Logger";
import Telemetry from "../Utils/Telemetry";
import type { Attributes, ObservableResult } from "@opentelemetry/api";
import Redis from "./Redis";

export enum QueueName {
  Workflow = "Workflow",
  Worker = "Worker",
  Telemetry = "Telemetry",
  Runbook = "Runbook",
  /*
   * Outbound marketing conversion webhooks. Data-carrying (the job holds the
   * whole event), unlike Worker, which looks its function up by name. Nothing
   * stores these events, so this queue is the only thing that survives a
   * receiver being briefly unreachable.
   */
  MarketingEvent = "MarketingEvent",
  /*
   * AI investigations, remediation plans and executions, and insight triage
   * (AIInvestigationQueue): each job names a Queued AIRun for a worker-role
   * server to claim and run. The run row is the durable record, so a job
   * lost here is sent again by the queue's poller.
   */
  AIInvestigation = "AIInvestigation",
}

export type QueueJob = Job;
type BullBoardQueues = Parameters<typeof createBullBoard>[0]["queues"];

export default class Queue {
  private static queueDict: Dictionary<BullQueue> = {};
  // track queues we have already run initial cleanup on
  private static cleanedQueueNames: Set<string> = new Set<string>();
  private static queueSizeMetricRegistered: boolean = false;
  // store repeatable jobs to re-add on reconnect
  private static repeatableJobs: Dictionary<
    Dictionary<{
      jobName: string;
      data: JSONObject;
      options: JobsOptions;
    }>
  > = {};

  /*
   * Optional per-queue veto on the reconnect re-add below. The registry is
   * per process, so a pod that registered a repeatable keeps it after another
   * pod (or a delete) removed it; a queue whose schedules are owned by
   * persisted state can say "no longer wanted" here instead of resurrecting it.
   */
  private static reconnectGuards: Dictionary<
    (jobName: string, cronPattern?: string) => Promise<boolean>
  > = {};

  public static setReconnectGuard(
    queueName: QueueName,
    isStillWanted: (jobName: string, cronPattern?: string) => Promise<boolean>,
  ): void {
    this.reconnectGuards[queueName] = isStillWanted;
  }

  // A removed repeatable must also leave the reconnect registry.
  private static forgetRepeatable(queueName: QueueName, jobName: string): void {
    const jobs: Dictionary<{ jobName: string }> | undefined =
      this.repeatableJobs[queueName];

    for (const jobId in jobs) {
      if (jobs[jobId]?.jobName === jobName) {
        delete jobs[jobId];
      }
    }
  }

  /*
   * Schedule claims.
   *
   * The Worker queue's schedules belong to code: every OneUptime process
   * registers the same crons when it starts (RunCron). So a schedule that no
   * process registers any more - a cron an earlier release renamed or
   * removed, or one a newer release added before the installation went back
   * to an older one - stays in Redis and keeps firing, with no process that
   * can run it. And while servers of two releases share one Redis (a rolling
   * upgrade, a rollout that stalls), a worker gets runs of crons its release
   * does not have.
   *
   * So a process claims every schedule it registers: before the schedule is
   * written, every minute for as long as it runs, and before it re-adds its
   * schedules when Redis comes back. A claim holds the release of the process
   * that made it and lapses ten minutes after it was last made. A schedule
   * nobody claims belongs to no running process and can be retired
   * (retireUnclaimedSchedule); one claimed by another release tells a worker
   * that has no job by that name which release does.
   *
   * Only the Worker queue: a Workflow schedule belongs to its Workflow row,
   * and the process that registered it may be long gone while it is still
   * wanted.
   */
  public static readonly SCHEDULE_CLAIM_TTL_MS: number = 10 * 60 * 1000;

  public static readonly SCHEDULE_CLAIM_REFRESH_INTERVAL_MS: number = 60 * 1000;

  private static scheduleClaimRefreshTimer: ReturnType<
    typeof setInterval
  > | null = null;

  public static isScheduleClaimedQueue(queueName: QueueName): boolean {
    return queueName === QueueName.Worker;
  }

  private static getScheduleClaimKey(
    queueName: QueueName,
    jobName: string,
  ): string {
    return `queue:schedule-claim:${queueName}:${jobName}`;
  }

  /*
   * Left for a short while when a schedule nobody claimed is retired. A
   * process that registered that schedule in the moment between the check
   * and the removal finds it at its next refresh and adds the schedule again
   * (restoreRetiredSchedules), so no cron is lost to that race.
   */
  private static getRetiredScheduleKey(
    queueName: QueueName,
    jobName: string,
  ): string {
    return `queue:schedule-retired:${queueName}:${jobName}`;
  }

  private static async claimSchedules(
    queueName: QueueName,
    jobNames: Array<string>,
  ): Promise<void> {
    if (!this.isScheduleClaimedQueue(queueName) || jobNames.length === 0) {
      return;
    }

    const client: Awaited<BullQueue["client"]> =
      await this.getQueue(queueName).client;

    const pipeline: ReturnType<typeof client.pipeline> = client.pipeline();

    for (const jobName of new Set<string>(jobNames)) {
      pipeline.set(
        this.getScheduleClaimKey(queueName, jobName),
        AppVersion,
        "PX",
        this.SCHEDULE_CLAIM_TTL_MS,
      );
    }

    const results: Array<[Error | null, unknown]> | null =
      await pipeline.exec();

    for (const [error] of results || []) {
      if (error) {
        throw error;
      }
    }
  }

  /*
   * A claim that cannot be written must not keep the schedule from being
   * added: the schedule is what makes the cron run, and the next refresh
   * writes the claim.
   */
  private static async claimSchedulesOrLog(
    queueName: QueueName,
    jobNames: Array<string>,
  ): Promise<void> {
    try {
      await this.claimSchedules(queueName, jobNames);
    } catch (err) {
      logger.error(
        `Could not claim the schedule of ${jobNames.join(", ")} on queue ${queueName}; the next refresh will`,
      );
      logger.error(err);
    }
  }

  private static startScheduleClaimRefresh(): void {
    if (this.scheduleClaimRefreshTimer) {
      return;
    }

    this.scheduleClaimRefreshTimer = setInterval(() => {
      void this.refreshScheduleClaims();
    }, this.SCHEDULE_CLAIM_REFRESH_INTERVAL_MS);

    // A claim is no reason to keep a process alive.
    this.scheduleClaimRefreshTimer.unref?.();
  }

  // Claims again every schedule this process holds. Never throws.
  public static async refreshScheduleClaims(): Promise<void> {
    const queueName: QueueName = QueueName.Worker;

    const held: Array<{
      jobName: string;
      data: JSONObject;
      options: JobsOptions;
    }> = Object.values(this.repeatableJobs[queueName] || {}).filter(
      (
        entry:
          | { jobName: string; data: JSONObject; options: JobsOptions }
          | undefined,
      ): entry is {
        jobName: string;
        data: JSONObject;
        options: JobsOptions;
      } => {
        return Boolean(entry);
      },
    );

    if (held.length === 0) {
      return;
    }

    try {
      await this.claimSchedules(
        queueName,
        held.map((entry: { jobName: string }) => {
          return entry.jobName;
        }),
      );

      await this.restoreRetiredSchedules(queueName, held);
    } catch (err) {
      logger.error(
        `Could not refresh the schedule claims on queue ${queueName}`,
      );
      logger.error(err);
    }
  }

  private static async restoreRetiredSchedules(
    queueName: QueueName,
    held: Array<{ jobName: string; data: JSONObject; options: JobsOptions }>,
  ): Promise<void> {
    const jobNames: Array<string> = Array.from(
      new Set<string>(
        held.map((entry: { jobName: string }) => {
          return entry.jobName;
        }),
      ),
    );

    const queue: BullQueue = this.getQueue(queueName);
    const client: Awaited<BullQueue["client"]> = await queue.client;

    const retired: Array<string | null> = await client.mget(
      jobNames.map((jobName: string) => {
        return this.getRetiredScheduleKey(queueName, jobName);
      }),
    );

    for (let index: number = 0; index < jobNames.length; index++) {
      if (retired[index] === null || retired[index] === undefined) {
        continue;
      }

      const jobName: string = jobNames[index] as string;

      for (const entry of held) {
        if (entry.jobName === jobName) {
          await queue.add(entry.jobName, entry.data, entry.options);
        }
      }

      await client.del(this.getRetiredScheduleKey(queueName, jobName));

      logger.info(
        `Added the schedule of ${jobName} on queue ${queueName} again: a worker that has no job by that name retired it while this process was registering it.`,
      );
    }
  }

  /*
   * The release of the process that claimed `jobName`'s schedule last, or
   * null when no running process has claimed it for SCHEDULE_CLAIM_TTL_MS.
   */
  @CaptureSpan()
  public static async getScheduleClaim(
    queueName: QueueName,
    jobName: string,
  ): Promise<string | null> {
    const client: Awaited<BullQueue["client"]> =
      await this.getQueue(queueName).client;

    return await client.get(this.getScheduleClaimKey(queueName, jobName));
  }

  /*
   * Removes the schedules named `jobName` unless a running process claims
   * them. Returns the release of the process that claims them (and removes
   * nothing), or null and how many schedules were removed.
   *
   * Call it only for a name this process has no job for: a worker that can
   * run the job keeps its schedule whoever claims it.
   */
  @CaptureSpan()
  public static async retireUnclaimedSchedule(
    queueName: QueueName,
    jobName: string,
  ): Promise<{ claimedBy: string | null; removedCount: number }> {
    if (!this.isScheduleClaimedQueue(queueName) || !jobName) {
      return { claimedBy: null, removedCount: 0 };
    }

    const claimedBy: string | null = await this.getScheduleClaim(
      queueName,
      jobName,
    );

    if (claimedBy !== null) {
      return { claimedBy, removedCount: 0 };
    }

    const removedCount: number = await this.removeSchedulesNamed(
      queueName,
      jobName,
    );

    if (removedCount > 0) {
      const client: Awaited<BullQueue["client"]> =
        await this.getQueue(queueName).client;

      await client.set(
        this.getRetiredScheduleKey(queueName, jobName),
        AppVersion,
        "PX",
        this.SCHEDULE_CLAIM_TTL_MS,
      );
    }

    return { claimedBy: null, removedCount };
  }

  // BullMQ rejects custom IDs containing colons, so normalize them early.
  private static sanitizeJobId(jobId: string): string {
    return jobId.replace(/:/g, "-");
  }

  private static async setupReconnectListener(
    queue: BullQueue,
    queueName: QueueName,
  ): Promise<void> {
    const client: Awaited<typeof queue.client> = await queue.client;
    client.on("ready", async () => {
      logger.debug(`Queue ${queueName} reconnected, re-adding repeatable jobs`);
      const jobs:
        | Dictionary<{
            jobName: string;
            data: JSONObject;
            options: JobsOptions;
          }>
        | undefined = Queue.repeatableJobs[queueName];
      if (jobs) {
        for (const jobId in jobs) {
          const job:
            | { jobName: string; data: JSONObject; options: JobsOptions }
            | undefined = jobs[jobId];
          if (job) {
            try {
              const guard:
                | ((jobName: string, cronPattern?: string) => Promise<boolean>)
                | undefined = Queue.reconnectGuards[queueName];

              /*
               * The guard sees the registered cron too: a stale pod must not
               * replay cron A for a workflow since changed to cron B.
               */
              const registeredPattern: string | undefined = (
                job.options.repeat as { pattern?: string } | undefined
              )?.pattern;

              let isStillWanted: boolean = true;

              if (guard) {
                /*
                 * A guard that cannot answer (say its database is down)
                 * re-adds, as before guards existed: a schedule Valkey lost
                 * would otherwise stay lost, with nothing to say so, while
                 * one re-added in error is removed by its owner later.
                 */
                try {
                  isStillWanted = await guard(job.jobName, registeredPattern);
                } catch (err: unknown) {
                  logger.error(
                    `Could not check repeatable job ${job.jobName} on queue ${queueName} before re-adding it, re-adding it anyway`,
                  );
                  logger.error(err);
                }
              }

              if (!isStillWanted) {
                delete jobs[jobId];
                continue;
              }

              // Claimed before it exists again (see Schedule claims).
              await Queue.claimSchedulesOrLog(queueName, [job.jobName]);

              logger.debug(
                `Re-adding repeatable job ${job.jobName} to queue ${queueName}`,
              );
              await queue.add(job.jobName, job.data, job.options);
            } catch (err: unknown) {
              logger.error("Error re-adding repeatable job");
              logger.error(err);
            }
          }
        }
      }
    });
  }

  public static getQueue(queueName: QueueName): BullQueue {
    // check if the queue is already created
    if (this.queueDict[queueName]) {
      return this.queueDict[queueName] as BullQueue;
    }

    const queue: BullQueue = new BullQueue(queueName, {
      connection: Redis.getRedisOptions(),
      // Keep BullMQ data under control to avoid Redis bloat
      defaultJobOptions: {
        // keep only recent completed/failed jobs
        removeOnComplete: { count: 500 }, // keep last 500 completed jobs
        removeOnFail: { count: 100 }, // keep last 100 failed jobs
      },
      /*
       * Optionally cap the event stream length (supported in BullMQ >= v5)
       * This helps prevent the :events stream from growing indefinitely
       */
      streams: {
        events: { maxLen: 1000 },
      },
    });

    // save it to the dictionary
    this.queueDict[queueName] = queue;

    // Register the observable gauge once any queue exists in this process.
    this.registerQueueSizeMetric();

    // Add event listener to re-add repeatable jobs on reconnect
    this.setupReconnectListener(queue, queueName).catch((err: unknown) => {
      logger.error("Error setting up reconnect listener for queue");
      logger.error(err);
    });

    /*
     * Lazy fallback for the startup sweep: the first time a queue is created in
     * this process, kick off its once-per-process terminal-job cleanup. The
     * eager path (cleanAllQueuesOnStartup, called at service boot) normally
     * wins; whichever runs first is the only one to sweep, via the gate inside
     * cleanQueueOnStartup(). Fire and forget so it never blocks enqueue.
     */
    void this.cleanQueueOnStartup(queueName);

    return queue;
  }

  /**
   * Eagerly sweeps every queue's terminal (completed/failed) jobs at process
   * startup, so the Completed/Failed counts on the admin Health page reset on a
   * pod (re)start regardless of when — or whether — each queue next produces a
   * job. Call once during service boot (see App/Index.ts). Each queue is swept
   * at most once per process via the cleanedQueueNames gate, so this is safe to
   * call alongside the lazy getQueue() path and from any service role.
   */
  @CaptureSpan()
  public static async cleanAllQueuesOnStartup(): Promise<void> {
    await Promise.all(
      Object.values(QueueName).map((queueName: QueueName) => {
        return this.cleanQueueOnStartup(queueName);
      }),
    );
  }

  /*
   * How old (in ms) a completed/failed job must be before the startup sweep
   * removes it. 0 means "remove all terminal jobs on every restart", which
   * resets the Completed/Failed counts on the admin Health page so operators
   * stop seeing stale failures after a deploy/restart. Raise this (e.g. to
   * 24 * 60 * 60 * 1000) if you'd rather keep recent failures around for
   * crash-loop debugging.
   */
  private static readonly STARTUP_CLEANUP_GRACE_MS: number = 0;
  // Number of jobs removed per clean() call; we loop until the state is drained.
  private static readonly STARTUP_CLEANUP_BATCH_SIZE: number = 1000;
  // Safety cap so a pathologically large backlog can't loop forever.
  private static readonly STARTUP_CLEANUP_MAX_BATCHES: number = 1000;

  /**
   * Removes terminal (completed/failed) jobs for a single queue, at most once
   * per process (gated by cleanedQueueNames). Drains in batches because
   * BullMQ's clean() caps each call at `limit` removals. Leaves live states
   * (waiting/active/delayed) untouched. Best-effort: any error is logged and
   * swallowed so a transient Redis hiccup at boot never breaks queue setup.
   */
  private static async cleanQueueOnStartup(
    queueName: QueueName,
  ): Promise<void> {
    /*
     * Gate synchronously, before any await, so the lazy getQueue() trigger and
     * the eager cleanAllQueuesOnStartup() call can't both sweep the same queue.
     */
    if (this.cleanedQueueNames.has(queueName)) {
      return;
    }
    this.cleanedQueueNames.add(queueName);

    const queue: BullQueue = this.getQueue(queueName);

    const terminalStates: Array<"completed" | "failed"> = [
      "completed",
      "failed",
    ];

    for (const state of terminalStates) {
      try {
        let removedTotal: number = 0;

        for (
          let batch: number = 0;
          batch < this.STARTUP_CLEANUP_MAX_BATCHES;
          batch++
        ) {
          const removed: string[] = await queue.clean(
            this.STARTUP_CLEANUP_GRACE_MS,
            this.STARTUP_CLEANUP_BATCH_SIZE,
            state,
          );

          removedTotal += removed.length;

          // A short batch means the state is drained; stop looping.
          if (removed.length < this.STARTUP_CLEANUP_BATCH_SIZE) {
            break;
          }
        }

        if (removedTotal > 0) {
          logger.debug(
            `Queue ${queueName}: removed ${removedTotal} ${state} job(s) on startup`,
          );
        }
      } catch (err) {
        // Ignore cleanup errors to not impact normal flow.
        logger.debug(`Queue ${queueName}: startup ${state} cleanup failed`);
        logger.debug(err);
      }
    }
  }

  /**
   * Removes a one-off job by id, and also removes a repeatable whose repeat
   * KEY equals `jobId` (QueueWorkflow persists `job.repeatJobKey` on the
   * Workflow row and passes it back here).
   *
   * Note the asymmetry between the two removals, which is easy to get wrong:
   * BullMQ rejects custom job ids containing ":", so the job lookup must use
   * the sanitized id. But removeRepeatableByKey() expects the repeat KEY
   * exactly as it appears in the `bull:<queue>:repeat` zset (an md5 hash, or a
   * legacy "name:id:endDate:tz:pattern" string) — it ZREMs that exact member.
   * Sanitizing would mangle the legacy colon form into a member that does not
   * exist, and the removal would silently no-op. So the raw value is passed
   * through.
   *
   * To remove a repeatable by its job NAME (e.g. to retire a renamed cron),
   * use removeRepeatableByName() — passing a job name here does nothing.
   */
  @CaptureSpan()
  public static async removeJob(
    queueName: QueueName,
    jobId: string,
  ): Promise<void> {
    if (!jobId) {
      return;
    }

    const queue: BullQueue = this.getQueue(queueName);

    const sanitizedJobId: string = this.sanitizeJobId(jobId.toString());

    const job: Job | undefined = await queue.getJob(sanitizedJobId);

    if (job) {
      await job.remove();
    }

    /*
     * Remove an existing repeatable keyed by this value. Raw, not sanitized —
     * see the note above.
     */
    await queue.removeRepeatableByKey(jobId.toString());
  }

  /**
   * Removes every repeatable job DEFINITION on `queueName` whose job NAME is
   * `jobName`, and returns how many were removed. Idempotent: removing a name
   * that isn't registered is a no-op that returns 0.
   *
   * Why this cannot be done with removeJob(): BullMQ keys a repeatable by an
   * opaque `key` (the member of the `bull:<queue>:repeat` zset — an md5 hash),
   * never by the job's name. removeRepeatableByKey() ZREMs that exact member,
   * so handing it a job name (or a job id) matches nothing and silently
   * succeeds as a no-op. BullMQ's own docs say so:
   *
   *   "Removes a repeatable job by its key. Note that the key is the one used
   *    to store the repeatable job metadata and not one of the job iterations
   *    themselves. You can use "getRepeatableJobs" in order to get the keys."
   *
   * So the only supported name -> key path is to enumerate getRepeatableJobs()
   * and match on `.name`. Removing by key also deletes the already-materialized
   * next delayed iteration, so the job stops firing immediately.
   *
   * This exists to retire a RENAMED cron: RunCron registers a repeatable keyed
   * by the new name, and addJob() above only clears a pre-existing repeatable
   * that matches the NEW name — nothing clears the old one, so a renamed cron
   * leaves its old definition behind in Redis, firing forever.
   */
  @CaptureSpan()
  public static async removeRepeatableByName(
    queueName: QueueName,
    jobName: string,
  ): Promise<number> {
    if (!jobName) {
      return 0;
    }

    this.forgetRepeatable(queueName, jobName);

    return await this.removeSchedulesNamed(queueName, jobName);
  }

  /*
   * The removal in Redis alone. Retiring a schedule nobody claims uses only
   * this: the worker that retires it does not hold it, and must not touch
   * the registry of a process that does.
   */
  private static async removeSchedulesNamed(
    queueName: QueueName,
    jobName: string,
  ): Promise<number> {
    const queue: BullQueue = this.getQueue(queueName);

    const repeatableJobs: RepeatableJob[] = await queue.getRepeatableJobs();

    let removedCount: number = 0;

    for (const repeatableJob of repeatableJobs) {
      if (repeatableJob.name !== jobName) {
        continue;
      }

      // `.key` is the zset member BullMQ expects here — never the name or id.
      const isRemoved: boolean = await queue.removeRepeatableByKey(
        repeatableJob.key,
      );

      if (isRemoved) {
        removedCount++;
      }
    }

    return removedCount;
  }

  public static getInspectorRoute(): string {
    return "/worker/inspect/queue/:dashboardSecret";
  }

  @CaptureSpan()
  public static getQueueInspectorRouter(): ExpressRouter {
    const serverAdapter: ExpressAdapter = new ExpressAdapter();

    const queueAdapters: BullMQAdapter[] = Object.values(QueueName).map(
      (queueName: QueueName) => {
        return new BullMQAdapter(this.getQueue(queueName));
      },
    );

    createBullBoard({
      // Cast keeps compatibility until bull-board widens QueueJob.progress
      queues: queueAdapters as unknown as BullBoardQueues,
      serverAdapter: serverAdapter,
    });

    serverAdapter.setBasePath(
      this.getInspectorRoute().replace(
        "/:dashboardSecret",
        "/" + QueueDashboardSecret,
      ),
    );

    return serverAdapter.getRouter();
  }

  @CaptureSpan()
  public static async addJob(
    queueName: QueueName,
    jobId: string,
    jobName: string,
    data: JSONObject,
    options?: {
      scheduleAt?: string | undefined;
      repeatableKey?: string | undefined;
      /**
       * One-off delay in milliseconds before the job becomes eligible to run.
       * Mutually exclusive with `scheduleAt` (a repeatable cron pattern); if
       * both are set, `scheduleAt` wins. Used to park a delayed job (e.g. the
       * Sleep component's durable resume).
       */
      delayInMs?: number | undefined;
      /**
       * Total number of times BullMQ runs the job before marking it
       * failed (1 = no retries). Defaults to 3 for the Telemetry queue
       * (consumers there are idempotent via insert dedup tokens) and 1
       * everywhere else, preserving prior behavior.
       */
      attempts?: number | undefined;
      /**
       * Base delay in milliseconds for exponential backoff between
       * attempts (delay * 2^attempt). Only used when attempts > 1.
       */
      backoffDelayInMs?: number | undefined;
      /**
       * Skip the getJob()+remove() round trips that guard against
       * duplicate job ids. Safe (and two Redis calls cheaper per
       * enqueue) when the caller's job ids are globally unique, e.g.
       * the telemetry enqueue path which suffixes ids with a unix-nano
       * timestamp. Also what a caller wants when adding an id that is
       * still stored should do nothing: BullMQ then keeps the job it has
       * (AIInvestigationQueue sends a queued run again this way).
       */
      skipExistenceCheck?: boolean | undefined;
      /**
       * BullMQ priority: 0 (the default) is the highest, and a worker
       * takes no job with a higher number while one with a lower number
       * is waiting.
       */
      priority?: number | undefined;
      /**
       * Remove the job as soon as it completes or fails, instead of
       * keeping it in the queue's recent history. An add with its id is
       * then a new job again the moment it is done.
       */
      removeWhenDone?: boolean | undefined;
      /**
       * Coalesce same-key jobs so they are never processed in parallel.
       * When set, BullMQ keeps at most one active + one waiting job per
       * `deduplication.id`. With keepLastIfActive, adds that arrive while
       * that job is ACTIVE collapse into the single job queued after it, and
       * the latest job data wins. Adds that arrive while it is still WAITING
       * (or delayed for a retry) are discarded: the waiting job runs with its
       * OLDER data. A caller that needs the newest data processed must keep
       * that data outside the job, as the incoming-request ingest path does
       * (TelemetryQueueService.addIncomingRequestIngestJob). Independent of
       * `jobId`, which stays unique.
       */
      deduplication?:
        | { id: string; keepLastIfActive?: boolean | undefined }
        | undefined;
    },
  ): Promise<Job> {
    const sanitizedJobId: string = this.sanitizeJobId(jobId.toString());

    const optionsObject: JobsOptions = {
      jobId: sanitizedJobId,
    };

    if (options && options.delayInMs && options.delayInMs > 0) {
      optionsObject.delay = options.delayInMs;
    }

    const attempts: number =
      options?.attempts ?? (queueName === QueueName.Telemetry ? 3 : 1);

    if (attempts > 1) {
      optionsObject.attempts = attempts;
      optionsObject.backoff = {
        type: "exponential",
        delay: options?.backoffDelayInMs ?? 5000,
      };
    }

    if (options?.priority && options.priority > 0) {
      optionsObject.priority = options.priority;
    }

    if (options?.removeWhenDone) {
      optionsObject.removeOnComplete = true;
      optionsObject.removeOnFail = true;
    }

    if (options?.deduplication?.id) {
      optionsObject.deduplication = {
        id: this.sanitizeJobId(options.deduplication.id),
        keepLastIfActive: options.deduplication.keepLastIfActive ?? false,
      };
    }

    const queue: BullQueue = this.getQueue(queueName);

    if (options && options.scheduleAt) {
      optionsObject.repeat = {
        pattern: options.scheduleAt,
        // keep repeatable job keyed by jobId so multiple workers do not register duplicates
        jobId: sanitizedJobId,
      };

      const isClaimed: boolean = this.isScheduleClaimedQueue(queueName);

      if (isClaimed) {
        /*
         * Claimed before the schedule is written, so no worker that has no
         * job by this name finds it unclaimed and retires it (see Schedule
         * claims).
         */
        await this.claimSchedulesOrLog(queueName, [jobName]);
        this.startScheduleClaimRefresh();
      }

      const repeatableJobs: RepeatableJob[] = await queue.getRepeatableJobs();

      for (const repeatableJob of repeatableJobs) {
        /*
         * A claimed queue's job has one schedule, so its schedules with
         * another pattern are the ones an earlier release registered before
         * the cron's schedule changed: left alone, they would keep running the
         * job on the old schedule too, forever.
         */
        const isSameJob: boolean =
          repeatableJob.name === jobName &&
          (isClaimed || repeatableJob.pattern === options.scheduleAt);

        if (isSameJob) {
          await queue.removeRepeatableByKey(repeatableJob.key);
        }
      }
    }

    if (!options?.skipExistenceCheck) {
      const job: Job | undefined = await queue.getJob(sanitizedJobId);

      if (job) {
        await job.remove();
      }
    }

    if (options?.repeatableKey) {
      // remove existing repeatable job
      await queue.removeRepeatableByKey(options?.repeatableKey);
    }

    // Store repeatable jobs for re-adding on reconnect
    if (options && options.scheduleAt) {
      if (!this.repeatableJobs[queueName]) {
        this.repeatableJobs[queueName] = {};
      }
      this.repeatableJobs[queueName]![sanitizedJobId] = {
        jobName,
        data,
        options: optionsObject,
      };
    }

    /*
     * A one-off job carries this span's context, so its own trace links back
     * to the request or job that enqueued it (QueueJobTraceContext). A
     * repeatable job does not: every run would link to whoever registered it.
     */
    const jobData: JSONObject =
      options && options.scheduleAt
        ? data
        : QueueJobTraceContext.addToJobData(data);

    const jobAdded: Job = await queue.add(jobName, jobData, optionsObject);

    return jobAdded;
  }

  private static registerQueueSizeMetric(): void {
    if (this.queueSizeMetricRegistered) {
      return;
    }

    if (!Telemetry.isMetricsEnabled()) {
      return;
    }

    try {
      Telemetry.getObservableGauge({
        name: "queue.size",
        description:
          "Number of BullMQ jobs in each queue, partitioned by job state.",
        unit: "1",
        callback: async (
          result: ObservableResult<Attributes>,
        ): Promise<void> => {
          for (const queueName of Object.keys(this.queueDict)) {
            try {
              const stats: {
                waiting: number;
                active: number;
                completed: number;
                failed: number;
                delayed: number;
                total: number;
              } = await this.getQueueStats(queueName as QueueName);

              const baseAttrs: Attributes = {
                "messaging.system": "bullmq",
                "messaging.destination.name": queueName,
              };

              result.observe(stats.waiting, { ...baseAttrs, state: "waiting" });
              result.observe(stats.active, { ...baseAttrs, state: "active" });
              result.observe(stats.delayed, { ...baseAttrs, state: "delayed" });
              result.observe(stats.failed, { ...baseAttrs, state: "failed" });
            } catch (err) {
              // Don't let one queue's stat failure break others.
              logger.debug("Failed to read queue stats");
              logger.debug(err);
            }
          }
        },
      });

      this.queueSizeMetricRegistered = true;
    } catch (err) {
      logger.error("Failed to register queue.size metric");
      logger.error(err);
    }
  }

  private static normalizeFailedReason(reason: string | undefined): string {
    if (typeof reason !== "string") {
      return "No reason provided";
    }

    const normalized: string = reason.trim().toLowerCase();
    if (
      normalized.length === 0 ||
      normalized === "null" ||
      normalized === "undefined"
    ) {
      return "No reason provided";
    }

    return reason;
  }

  @CaptureSpan()
  public static async getQueueSize(queueName: QueueName): Promise<number> {
    const queue: BullQueue = this.getQueue(queueName);
    const waitingCount: number = await queue.getWaitingCount();
    const activeCount: number = await queue.getActiveCount();
    const delayedCount: number = await queue.getDelayedCount();

    return waitingCount + activeCount + delayedCount;
  }

  /*
   * How many job schedulers (BullMQ's repeatable/cron registrations) this
   * queue holds. This is a ZCARD of the repeat zset, so it is O(1) and safe
   * to call on every scrape of the scaling metric — unlike getJobSchedulers(),
   * which pages the whole set.
   *
   * Guarded because the count is only ever used to *correct* the backlog
   * number: a BullMQ build without this method (it is newer than the
   * repeatable API it replaces) must degrade to the uncorrected
   * waiting + delayed sum rather than throw and take the whole scaling
   * metric offline with it.
   */
  private static async getJobSchedulerCount(queue: BullQueue): Promise<number> {
    if (typeof queue.getJobSchedulersCount !== "function") {
      return 0;
    }

    return (await queue.getJobSchedulersCount()) || 0;
  }

  /*
   * How many jobs wait with a priority. BullMQ keeps them in a set of their
   * own, which getWaitingCount() does not count, but they are waiting work
   * all the same. Only the AIInvestigation queue adds such jobs (its
   * background runs), so this is 0 for every other queue - and guarded like
   * the scheduler count, so a client without it reads 0 instead of taking
   * the whole scaling metric offline.
   */
  private static async getPrioritizedJobCount(
    queue: BullQueue,
  ): Promise<number> {
    if (typeof queue.getPrioritizedCount !== "function") {
      return 0;
    }

    return (await queue.getPrioritizedCount()) || 0;
  }

  /*
   * Backlog = jobs still waiting for a worker, for autoscaling signals.
   *
   * ACTIVE jobs are deliberately excluded: they are already being served, so
   * to a scaler they are capacity, not demand. Telemetry jobs in particular
   * sit in the active state for the fan-in writer's full flush window (up to
   * TELEMETRY_FANIN_MAX_WAIT_MS) while awaiting their ClickHouse ack, so a
   * fleet scaled on an active-inclusive count converges on pod count =
   * job rate x ack latency — every new pod just parks more jobs without
   * shortening the flush window. Scaling on waiting + delayed only breaks
   * that feedback loop. getQueueSize above keeps the active-inclusive sum for
   * ingest backpressure checks, where in-flight work genuinely counts against
   * capacity.
   *
   * The job SCHEDULERS are then subtracted back off — but ONLY from the
   * delayed side, which is the whole subtlety here. Every RunCron()
   * registration parks exactly one entry in the DELAYED set: the placeholder
   * holding its next fire time. That placeholder is not work anybody can
   * drain, and getDelayedCount() counts it. Left in, the placeholders put a
   * hard floor under the metric equal to the number of registered crons (127
   * on the Worker queue today), which sits above every sensible scale-down
   * target, so the fleet could never scale in no matter how idle it was.
   *
   * The subtraction is deliberately NOT `max(0, waiting + delayed - n)`,
   * because a scheduler entry stops being a parked placeholder the moment it
   * comes due. BullMQ's promoteDelayedJobs ZREMs the placeholder out of
   * `delayed` and LPUSHes it onto `wait`, and the SUCCESSOR placeholder is
   * not created until a worker actually moves that job to active
   * (Worker.nextJobFromJobData -> upsertJobScheduler). So for the whole
   * promotion window there are k due cron jobs sitting in `waiting` with
   * delayed = n - k, while the repeat zset — and therefore the scheduler
   * count — still reads n.
   *
   * Those k jobs are real, drainable demand: they are queued work waiting for
   * a worker. Subtracting the full scheduler count off the combined sum would
   * cancel them out exactly, so the metric would read 0. That is not a
   * rounding error, it is the dangerous direction: at the top of a minute a
   * large batch of EVERY_MINUTE crons is promoted at once, and an idle-looking
   * zero would tell KEDA to scale in precisely when the work arrived.
   * Discounting the placeholders only where they actually live — the delayed
   * set — leaves `waiting` untouched and reports that burst at face value.
   *
   * When delayed >= schedulerCount (the steady state, every placeholder
   * parked) the two forms agree exactly, so this costs nothing in the common
   * case.
   *
   * The inner Math.max(0, ...) clamp still matters: the three counts are read
   * concurrently and are not a consistent snapshot, so delayed can be read
   * mid-promotion and come back below the scheduler count. Without the clamp
   * that shortfall would be subtracted out of `waiting`, re-introducing the
   * masking this form exists to avoid, and could drive the gauge negative —
   * which KEDA reads as a garbage value.
   */
  @CaptureSpan()
  public static async getQueueBacklogSize(
    queueName: QueueName,
  ): Promise<number> {
    const queue: BullQueue = this.getQueue(queueName);
    const [waitingCount, prioritizedCount, delayedCount, schedulerCount]: [
      number,
      number,
      number,
      number,
    ] = await Promise.all([
      queue.getWaitingCount(),
      // Jobs waiting with a priority are backlog too (getPrioritizedJobCount).
      this.getPrioritizedJobCount(queue),
      queue.getDelayedCount(),
      this.getJobSchedulerCount(queue),
    ]);

    return (
      waitingCount +
      prioritizedCount +
      Math.max(0, delayedCount - schedulerCount)
    );
  }

  @CaptureSpan()
  public static async getQueueStats(queueName: QueueName): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    const queue: BullQueue = this.getQueue(queueName);
    // Jobs waiting with a priority are waiting too (getPrioritizedJobCount).
    const waitingCount: number =
      (await queue.getWaitingCount()) +
      (await this.getPrioritizedJobCount(queue));
    const activeCount: number = await queue.getActiveCount();
    const completedCount: number = await queue.getCompletedCount();
    const failedCount: number = await queue.getFailedCount();
    const delayedCount: number = await queue.getDelayedCount();

    return {
      waiting: waitingCount,
      active: activeCount,
      completed: completedCount,
      failed: failedCount,
      delayed: delayedCount,
      total:
        waitingCount +
        activeCount +
        completedCount +
        failedCount +
        delayedCount,
    };
  }

  /**
   * A queue's failed jobs, the FULL job for deep debugging: the job
   * body (data), its options, return value, progress, all the timing/attempt
   * metadata, and the per-job log lines BullMQ keeps (job.log()/getJobLogs).
   * Used by the master-admin health dashboard / support bundle. The caller is
   * responsible for redacting / size-capping before exposing this, since the
   * job body can contain customer data.
   */
  @CaptureSpan()
  public static async getFailedJobsWithDetails(
    queueName: QueueName,
    options?: {
      start?: number;
      end?: number;
    },
  ): Promise<
    Array<{
      id: string;
      name: string;
      data: JSONObject;
      opts: JSONObject;
      returnValue: unknown;
      progress: number | Record<string, unknown> | null;
      failedReason: string;
      stackTrace: Array<string>;
      logs: Array<string>;
      attemptsMade: number;
      attemptsStarted: number | null;
      stalledCounter: number | null;
      priority: number | null;
      delay: number | null;
      createdAt: Date | null;
      processedOn: Date | null;
      finishedOn: Date | null;
      queueQualifiedName: string | null;
      repeatJobKey: string | null;
      deduplicationId: string | null;
      processedBy: string | null;
      parentKey: string | null;
    }>
  > {
    const queue: BullQueue = this.getQueue(queueName);
    const start: number = options?.start || 0;
    const end: number = options?.end ?? 100;
    const failed: Job[] = await queue.getFailed(start, end);

    const results: Array<{
      id: string;
      name: string;
      data: JSONObject;
      opts: JSONObject;
      returnValue: unknown;
      progress: number | Record<string, unknown> | null;
      failedReason: string;
      stackTrace: Array<string>;
      logs: Array<string>;
      attemptsMade: number;
      attemptsStarted: number | null;
      stalledCounter: number | null;
      priority: number | null;
      delay: number | null;
      createdAt: Date | null;
      processedOn: Date | null;
      finishedOn: Date | null;
      queueQualifiedName: string | null;
      repeatJobKey: string | null;
      deduplicationId: string | null;
      processedBy: string | null;
      parentKey: string | null;
    }> = [];

    for (const job of failed) {
      // Per-job log lines are best-effort — older jobs may have none.
      let logs: Array<string> = [];

      try {
        if (job.id) {
          const jobLogs: { logs: string[]; count: number } =
            await queue.getJobLogs(job.id, 0, -1);
          logs = jobLogs?.logs || [];
        }
      } catch (err) {
        logger.debug(`Failed to read logs for job ${job.id} on ${queueName}`);
        logger.debug(err);
      }

      results.push({
        id: job.id || "unknown",
        name: job.name || "unknown",
        data: (job.data as JSONObject) || {},
        opts: (job.opts as unknown as JSONObject) || {},
        returnValue: job.returnvalue ?? null,
        progress: (job.progress as number | Record<string, unknown>) ?? null,
        failedReason: Queue.normalizeFailedReason(job.failedReason),
        stackTrace: job.stacktrace || [],
        logs: logs,
        attemptsMade: job.attemptsMade || 0,
        attemptsStarted:
          typeof job.attemptsStarted === "number" ? job.attemptsStarted : null,
        stalledCounter:
          typeof job.stalledCounter === "number" ? job.stalledCounter : null,
        priority: typeof job.priority === "number" ? job.priority : null,
        delay: typeof job.delay === "number" ? job.delay : null,
        createdAt:
          typeof job.timestamp === "number" ? new Date(job.timestamp) : null,
        processedOn:
          typeof job.processedOn === "number"
            ? new Date(job.processedOn)
            : null,
        finishedOn:
          typeof job.finishedOn === "number" ? new Date(job.finishedOn) : null,
        queueQualifiedName: job.queueQualifiedName || null,
        repeatJobKey: job.repeatJobKey || null,
        deduplicationId: job.deduplicationId || null,
        processedBy: job.processedBy || null,
        parentKey: job.parentKey || null,
      });
    }

    return results;
  }
}
