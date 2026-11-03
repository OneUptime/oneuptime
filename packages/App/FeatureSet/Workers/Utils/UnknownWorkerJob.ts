import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import UnknownQueueJob from "Common/Server/Infrastructure/UnknownQueueJob";
import logger from "Common/Server/Utils/Logger";

/*
 * A Worker queue job whose name this process has no job for (JobDictionary).
 *
 * Every process registers its release's jobs, so the job comes from a server
 * running another release that shares this installation's Redis - a newer
 * one during a rolling upgrade or a rollout that stalled, an older one after
 * an upgrade - or from a schedule a release that no longer runs here left in
 * Redis. Issue #5546: a worker still on 14.0.97 failed every run of
 * "SecurityHunts:RunScheduledHunts" and
 * "AIAgent:FindPullRequestsToReviewInProduction", crons that servers on
 * 14.0.99 scheduled, with "No job found with name", once a minute each.
 *
 * Such a job is not failed:
 *   - a scheduled run is skipped when a running process claims its schedule
 *     (Queue's schedule claims): the cron fires again, and a worker of the
 *     release that claims it runs those runs. The warning says which
 *     release that is.
 *   - a scheduled run whose schedule nobody claims comes from a cron no
 *     running release has: its schedule is retired, so it stops firing.
 *   - any other job goes back to its queue for a worker that can run it
 *     (UnknownQueueJob.handBack).
 */
export default class UnknownWorkerJob {
  // A run a cron schedule made, as opposed to a job queued once.
  public static isScheduledRun(job: QueueJob): boolean {
    return Boolean(job.repeatJobKey || job.opts?.repeat);
  }

  public static async handle(job: QueueJob, token?: string): Promise<void> {
    if (UnknownWorkerJob.isScheduledRun(job)) {
      await UnknownWorkerJob.skipScheduledRun(job);
      return;
    }

    await UnknownQueueJob.handBack({
      job,
      token,
      queueName: QueueName.Worker,
      what: `a job named "${job.name}"`,
    });
  }

  private static async skipScheduledRun(job: QueueJob): Promise<void> {
    const thisRelease: string = UnknownQueueJob.describeThisRelease();

    let retirement: { claimedBy: string | null; removedCount: number };

    try {
      retirement = await Queue.retireUnclaimedSchedule(
        QueueName.Worker,
        job.name,
      );
    } catch (err) {
      /*
       * Without an answer the schedule may still be someone's: skip this run
       * and leave the schedule be. The next run asks again.
       */
      logger.error(
        `Skipped a run of "${job.name}", which this worker has no job for, and could not check whether a running OneUptime server still schedules it.`,
      );
      logger.error(err);
      return;
    }

    if (retirement.claimedBy !== null) {
      UnknownQueueJob.warn(
        `${QueueName.Worker}:${job.name}`,
        `Skipped a run of "${job.name}": this worker runs ${thisRelease}, which has no job by that name, ` +
          `and a server running ${UnknownQueueJob.describeRelease(retirement.claimedBy)} schedules it. ` +
          `Run the same release of OneUptime on every server (app and worker). Until then, runs that reach a worker of that release run, ` +
          `and runs that reach this worker are skipped.`,
      );
      return;
    }

    if (retirement.removedCount > 0) {
      logger.info(
        `Removed the schedule of "${job.name}": no running OneUptime server schedules it any more, so a release that no longer runs here left it in Redis. ` +
          `This worker runs ${thisRelease}, which has no job by that name.`,
      );
    }
  }
}
