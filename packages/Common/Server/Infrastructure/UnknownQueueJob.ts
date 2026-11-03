import { QueueJob, QueueName } from "./Queue";
import { AppVersion } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import { DelayedError, UnrecoverableError } from "bullmq";

/*
 * A job this process has nothing to run with: a name the Worker queue has no
 * job for, a type of telemetry the Telemetry queue does not know.
 *
 * Every process can run every job its own release queues, so such a job was
 * queued by a server running another release that shares the installation's
 * Redis: a newer one during a rolling upgrade or a rollout that stalled, an
 * older one after an upgrade. A worker of that release can run it. Failing
 * it, as workers used to ("No job found with name"), lost it - a page, an
 * import, a batch of telemetry - and a worker that could run it was often a
 * few seconds away. So it goes back to its queue instead, without using one
 * of its attempts, for such a worker to take, each time waiting a little
 * longer, up to a minute. A job nobody runs within HAND_BACK_FOR_MS fails,
 * once, saying why.
 *
 * Scheduled runs are not handed back: a cron fires again anyway, and two
 * runs of one cron must not pile up. UnknownWorkerJob in the Workers feature
 * set skips those, or retires a schedule no running process claims.
 */
export default class UnknownQueueJob {
  public static readonly HAND_BACK_FOR_MS: number = 30 * 60 * 1000;

  public static readonly FIRST_HAND_BACK_DELAY_MS: number = 5 * 1000;

  public static readonly LONGEST_HAND_BACK_DELAY_MS: number = 60 * 1000;

  // One warning per job name (or type) every this often, per process.
  public static readonly WARN_EVERY_MS: number = 15 * 60 * 1000;

  private static lastWarnedAt: Map<string, number> = new Map<string, number>();

  // "OneUptime 14.0.99", or what to say when the release is not known.
  public static describeRelease(release: string | null | undefined): string {
    const name: string = (release || "").trim();

    if (!name || name === "unknown") {
      return "a release of OneUptime that does not say its version";
    }

    return `OneUptime ${name}`;
  }

  public static describeThisRelease(): string {
    return this.describeRelease(AppVersion);
  }

  // Logs `message`, but not more than once every WARN_EVERY_MS for one key.
  public static warn(
    key: string,
    message: string,
    now: number = Date.now(),
  ): void {
    const lastWarnedAt: number | undefined = this.lastWarnedAt.get(key);

    if (lastWarnedAt !== undefined && now - lastWarnedAt < this.WARN_EVERY_MS) {
      return;
    }

    this.lastWarnedAt.set(key, now);
    logger.warn(message);
  }

  /*
   * When the job first became due: when it was queued, plus the delay it was
   * queued with. Handing it back changes the job's delay, not its options,
   * so this stays put however often it goes back.
   */
  public static getDueAt(job: QueueJob): number {
    const queuedAt: number = Number(job.timestamp) || 0;
    const queuedWithDelay: number = Number(job.opts?.delay) || 0;

    return queuedAt + Math.max(0, queuedWithDelay);
  }

  // 5 seconds at first, then as long as the job has waited, up to a minute.
  public static getHandBackDelayInMs(waitedInMs: number): number {
    return Math.min(
      this.LONGEST_HAND_BACK_DELAY_MS,
      Math.max(this.FIRST_HAND_BACK_DELAY_MS, waitedInMs),
    );
  }

  /*
   * Hands `job` back to its queue, or fails it when nobody has run it within
   * HAND_BACK_FOR_MS of it falling due. Never returns: it throws BullMQ's
   * DelayedError when the job is back in the queue (the worker then leaves
   * the job as it is) and UnrecoverableError when it is not (the job fails
   * and is not tried again). `what` names what could not be run, as in
   * `a job named "Incident:Example"`.
   */
  public static async handBack(input: {
    job: QueueJob;
    token?: string | undefined;
    queueName: QueueName;
    what: string;
    now?: number | undefined;
  }): Promise<never> {
    const job: QueueJob = input.job;
    const now: number = input.now ?? Date.now();
    const waitedInMs: number = Math.max(0, now - this.getDueAt(job));
    const token: string | undefined = input.token || job.token;
    const thisRelease: string = this.describeThisRelease();

    if (!token || waitedInMs >= this.HAND_BACK_FOR_MS) {
      throw new UnrecoverableError(
        `No worker ran ${input.what} within ${this.HAND_BACK_FOR_MS / 60000} minutes of it falling due. ` +
          `This worker runs ${thisRelease} and has nothing to run it with, so a server running another release of OneUptime queued it. ` +
          `Run the same release of OneUptime on every server (app and worker).`,
      );
    }

    await job.moveToDelayed(now + this.getHandBackDelayInMs(waitedInMs), token);

    this.warn(
      `${input.queueName}:${input.what}`,
      `Handed ${input.what} back to the ${input.queueName} queue for a worker that can run it. ` +
        `This worker runs ${thisRelease} and has nothing to run it with, so a server running another release of OneUptime queued it. ` +
        `Run the same release of OneUptime on every server (app and worker): until then such jobs wait for a worker of that release, ` +
        `and fail after ${this.HAND_BACK_FOR_MS / 60000} minutes if none takes them.`,
      now,
    );

    throw new DelayedError();
  }
}
