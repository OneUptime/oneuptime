import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import logger from "Common/Server/Utils/Logger";

interface SchedulerOptions {
  maxConcurrentScans: number;
  fetchScans: (
    excludeScanIds: Array<string>,
  ) => Promise<Array<NetworkDeviceDiscoveryScan>>;
  runScan: (scan: NetworkDeviceDiscoveryScan) => Promise<void>;
}

interface QueuedScan {
  scan: NetworkDeviceDiscoveryScan;
  scanId: string;
  resolve: () => void;
}

/**
 * Serializes claims, while allowing independent scans to run across cron ticks.
 * A reservation lasts through the result upload, so another tick cannot exceed
 * the limit or start the same scan while its previous result is still in flight.
 */
export default class DiscoveryScanScheduler {
  private readonly options: SchedulerOptions;
  private isFetching: boolean = false;
  private activeScanCount: number = 0;
  private readonly scanIds: Set<string> = new Set();
  private readonly queue: Array<QueuedScan> = [];

  public constructor(options: SchedulerOptions) {
    this.options = options;
  }

  public async run(): Promise<void> {
    /*
     * The server marks a scan In Progress as soon as it hands it out. Leave
     * work Pending on the server until this probe has room to execute it.
     */
    if (
      this.isFetching ||
      this.scanIds.size >= this.options.maxConcurrentScans
    ) {
      return;
    }

    const runs: Array<Promise<void>> = [];
    this.isFetching = true;

    try {
      /*
       * An edit can requeue a running scan. Exclude reserved IDs BEFORE
       * the server claims them, so the old run's result is still rejected
       * while that edited row remains Pending.
       */
      const scans: Array<NetworkDeviceDiscoveryScan> =
        await this.options.fetchScans(Array.from(this.scanIds));

      for (const scan of scans) {
        const scanId: string | undefined = scan.id?.toString();

        if (!scanId) {
          logger.error("Ignoring a discovery scan without an ID.");
          continue;
        }

        if (this.scanIds.has(scanId)) {
          continue;
        }

        this.scanIds.add(scanId);
        runs.push(
          new Promise<void>((resolve: () => void) => {
            this.queue.push({ scan, scanId, resolve });
          }),
        );
      }

      this.startQueuedScans();
    } finally {
      /*
       * Only claiming is single-flight. Waiting for a sweep here would block
       * every later cron tick for the duration of the longest scan (#3597).
       */
      this.isFetching = false;
    }

    await Promise.all(runs);
  }

  private startQueuedScans(): void {
    /*
     * The current server returns one scan per poll. Also handle batches
     * without exceeding the execution limit or discarding already claimed work.
     */
    while (
      this.activeScanCount < this.options.maxConcurrentScans &&
      this.queue.length > 0
    ) {
      const queued: QueuedScan = this.queue.shift()!;
      this.activeScanCount++;
      void this.executeScan(queued);
    }
  }

  private async executeScan(queued: QueuedScan): Promise<void> {
    try {
      await this.options.runScan(queued.scan);
    } catch (err) {
      /*
       * runScan normally reports failures itself. An unexpected exception
       * must still release capacity and let the other scans finish.
       */
      logger.error(`Discovery scan ${queued.scanId} failed unexpectedly.`);
      logger.error(err);
    } finally {
      this.activeScanCount--;
      this.scanIds.delete(queued.scanId);
      queued.resolve();
      this.startQueuedScans();
    }
  }
}
