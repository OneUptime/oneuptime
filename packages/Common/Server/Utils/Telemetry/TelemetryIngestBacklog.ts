import Queue, { QueueJob, QueueName } from "../../Infrastructure/Queue";
import Redis from "../../Infrastructure/Redis";
import CaptureSpan from "./CaptureSpan";

/*
 * How far behind OneUptime is in reading what it has received.
 *
 * Every ingest request is accepted, put on the Telemetry queue, and only
 * becomes readable once a worker has processed it. The queue keeps its jobs
 * in two lines (TelemetryQueueService, OneUptime issue #11131): monitoring
 * work - a probe's monitor result, an incoming request, a server monitor's
 * report - waits with no priority and is taken first; bulk telemetry - logs,
 * traces, metrics - waits with a priority, behind it. Each line is processed
 * in the order its jobs were added, so the oldest job still waiting in
 * either says how far behind processing is: everything added before it has
 * been picked up, everything added after it - up to now - may not be
 * readable yet. A check that judges a resource by "no data in the last
 * minute" while the queue is five minutes behind is judging data OneUptime
 * has not read yet, and ReceivingCoverage keeps it from doing that.
 */
export default class TelemetryIngestBacklog {
  /*
   * When the oldest job still waiting on the Telemetry queue was added - the
   * older of the two lines' heads - or null when nothing is waiting. Also
   * null when it cannot be told: no queue connection, or heads that are
   * retries (getAddedAt).
   *
   * The prioritized line is read by its lowest score - its highest
   * priority, then the order its jobs were added - and every bulk telemetry
   * job has the same priority, so its head is its oldest job.
   *
   * Four Redis round trips (each line's oldest waiting id, then that job),
   * two at a time; callers cache the answer (ReceivingCoverage).
   */
  @CaptureSpan()
  public static async getOldestWaitingSince(): Promise<Date | null> {
    if (!Redis.isConnected()) {
      return null;
    }

    const queue: ReturnType<typeof Queue.getQueue> = Queue.getQueue(
      QueueName.Telemetry,
    );

    const [waiting, prioritized]: [
      Array<QueueJob | undefined>,
      Array<QueueJob | undefined>,
    ] = (await Promise.all([
      queue.getJobs(["wait"], 0, 0, true),
      queue.getJobs(["prioritized"], 0, 0, true),
    ])) as [Array<QueueJob | undefined>, Array<QueueJob | undefined>];

    return this.getOldest([
      this.getAddedAt(waiting[0]),
      this.getAddedAt(prioritized[0]),
    ]);
  }

  /*
   * When a waiting job was added, or null when it says nothing about the
   * queue: a retried job keeps the time it was first added, so its age is
   * its backoff, not the queue's.
   */
  public static getAddedAt(job: QueueJob | undefined | null): Date | null {
    if (!job) {
      return null;
    }

    if (Number(job.attemptsMade || 0) > 0) {
      return null;
    }

    const addedAtMs: number = Number(job.timestamp);

    if (!Number.isFinite(addedAtMs) || addedAtMs <= 0) {
      return null;
    }

    return new Date(addedAtMs);
  }

  // The earliest of the times that say something, or null when none does.
  public static getOldest(times: Array<Date | null>): Date | null {
    let oldest: Date | null = null;

    for (const time of times) {
      if (time && (!oldest || time.getTime() < oldest.getTime())) {
        oldest = time;
      }
    }

    return oldest;
  }
}
