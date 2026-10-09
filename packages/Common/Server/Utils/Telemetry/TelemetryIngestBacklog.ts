import Queue, { QueueJob, QueueName } from "../../Infrastructure/Queue";
import Redis from "../../Infrastructure/Redis";
import CaptureSpan from "./CaptureSpan";

/*
 * How far behind OneUptime is in reading what it has received.
 *
 * Every ingest request is accepted, put on the Telemetry queue, and only
 * becomes readable once a worker has processed it. Jobs are processed in the
 * order they were added (nothing on this queue uses priorities), so the
 * oldest job still waiting says how far behind processing is: everything
 * added before it has been picked up, everything added after it - up to now -
 * may not be readable yet. A check that judges a resource by "no data in the
 * last minute" while the queue is five minutes behind is judging data
 * OneUptime has not read yet, and ReceivingCoverage keeps it from doing that.
 */
export default class TelemetryIngestBacklog {
  /*
   * When the oldest job still waiting on the Telemetry queue was added, or
   * null when nothing is waiting. Also null when it cannot be told: no queue
   * connection, or a head job that is a retry - a retried job keeps the time
   * it was first added, so its age is its backoff, not the queue's.
   *
   * Two Redis round trips (the oldest waiting id, then that job); callers
   * cache the answer (ReceivingCoverage).
   */
  @CaptureSpan()
  public static async getOldestWaitingSince(): Promise<Date | null> {
    if (!Redis.isConnected()) {
      return null;
    }

    const jobs: Array<QueueJob | undefined> = (await Queue.getQueue(
      QueueName.Telemetry,
    ).getJobs(["wait"], 0, 0, true)) as Array<QueueJob | undefined>;

    return this.getAddedAt(jobs[0]);
  }

  // When a waiting job was added, or null when it says nothing about the queue.
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
}
