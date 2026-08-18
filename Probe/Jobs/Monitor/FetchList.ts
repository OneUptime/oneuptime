import {
  PROBE_INGEST_URL,
  PROBE_MONITOR_CHECK_TIMEOUT_IN_MS,
  PROBE_MONITOR_FETCH_LIMIT,
  PROBE_MONITORING_WORKERS,
} from "../../Config";
import MonitorUtil from "../../Utils/Monitors/Monitor";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import APIException from "Common/Types/Exception/ApiException";
import { JSONArray } from "Common/Types/JSON";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import NumberUtil from "Common/Utils/Number";
import Sleep from "Common/Types/Sleep";

/*
 * Single-flight guard, scoped to each WORKER SLOT.
 *
 * node-cron fires this job every minute and never waits for the previous
 * tick, so every tick used to spawn PROBE_MONITORING_WORKERS brand-new
 * un-awaited workers regardless of how many were still running. A worker
 * that wedged never came back, and sixty seconds later another one was
 * spawned beside it — unbounded accumulation, with the probe quietly
 * consuming more sockets and memory every minute.
 *
 * Per slot rather than one flag for the whole job: PROBE_MONITORING_WORKERS
 * is the operator's concurrency dial, and one slow slot must not silence
 * the free ones.
 *
 * Unlike the fetch-only guards on the other probe jobs, this one covers the
 * WHOLE run (list fetch plus probing). Overlapping runs would be correct —
 * the server claims monitors atomically, so they would fetch disjoint
 * batches — but they would also push real concurrency past the number of
 * workers the operator configured, which is the pile-up this guard exists
 * to stop. A probe that needs more throughput raises
 * PROBE_MONITORING_WORKERS; it should not get it by accident from slow
 * cycles stacking on each other.
 */
const workerRunsInProgress: Set<number> = new Set<number>();

// Exported for tests: lets a wedged-worker test reset between cases.
export function resetProbeWorkerRunState(): void {
  workerRunsInProgress.clear();
}

/*
 * Exported for tests: bounds ONE monitor's full check in time.
 *
 * Promise.race subscribes to both promises, so a check that settles late is
 * still observed and can never surface as an unhandled rejection. It does
 * not — cannot — cancel the check: nothing here can reach into an arbitrary
 * monitor implementation and unwind it. The point is that the WORKER stops
 * waiting. The rest of the batch settles, the worker slot is released, and
 * the wedged monitor loses exactly one cycle instead of leaking a worker
 * forever.
 */
export async function probeMonitorWithDeadline(
  monitor: Monitor,
  deadlineInMs: number = PROBE_MONITOR_CHECK_TIMEOUT_IN_MS,
): Promise<Array<ProbeMonitorResponse | null>> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  const deadline: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (err: Error) => void) => {
      deadlineTimer = setTimeout(() => {
        /*
         * Logged here, at the moment the deadline is crossed, rather than
         * left to the caller: this is the one line that turns a silently
         * skipped cycle into something an operator can grep for.
         */
        logger.error(
          `Monitor ${monitor.id?.toString()} (${monitor.monitorType}) did not finish probing within ${deadlineInMs}ms. Abandoning this check — the monitor implementation is not settling. Raise PROBE_MONITOR_CHECK_TIMEOUT_IN_MS if this monitor legitimately needs longer.`,
        );

        reject(
          new Error(
            `Probing monitor ${monitor.id?.toString()} (${monitor.monitorType}) exceeded the ${deadlineInMs}ms deadline`,
          ),
        );
      }, deadlineInMs);
    },
  );

  try {
    return await Promise.race([MonitorUtil.probeMonitor(monitor), deadline]);
  } finally {
    /*
     * Always clear it: an un-cleared timer holds the event loop open after
     * an otherwise healthy check.
     */
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
  }
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:MonitorFetchList",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        let workers: number = 0;

        while (workers < PROBE_MONITORING_WORKERS) {
          workers++;

          const currentWorker: number = workers;

          if (workerRunsInProgress.has(currentWorker)) {
            logger.debug(
              `Worker ${currentWorker} is still running from a previous tick. Skipping this tick for it.`,
            );
            continue;
          }

          workerRunsInProgress.add(currentWorker);

          logger.debug(`Starting worker ${currentWorker}`);

          try {
            new FetchListAndProbe("Worker " + currentWorker)
              .run()
              .catch((err: unknown) => {
                logger.error(`Worker ${currentWorker} failed: `);
                logger.error(err);
              })
              .finally(() => {
                // Free the slot for the next tick — failures included.
                workerRunsInProgress.delete(currentWorker);
              });
          } catch (err) {
            /*
             * Nothing above is expected to throw synchronously, but a slot
             * marked busy for a worker that never actually started would be
             * lost for the lifetime of the process — exactly the leak this
             * guard exists to prevent.
             */
            workerRunsInProgress.delete(currentWorker);
            logger.error(`Worker ${currentWorker} failed to start: `);
            logger.error(err);
          }
        }
      } catch (err) {
        logger.error("Starting workers failed");
        logger.error(err);
      }
    },
  });
};

// Exported for tests: one worker's fetch-then-probe cycle.
export class FetchListAndProbe {
  private workerName: string = "";

  public constructor(workerName: string) {
    this.workerName = workerName;
  }

  public async run(): Promise<void> {
    logger.debug(`Running worker ${this.workerName}`);

    try {
      logger.debug(`Probing monitors ${this.workerName}`);

      await this.fetchListAndProbe();

      logger.debug(`Probing monitors ${this.workerName} complete`);
    } catch (err) {
      logger.error(`Error in worker ${this.workerName}`);
      logger.error(err);
    }
  }

  private async fetchListAndProbe(): Promise<void> {
    try {
      logger.debug("Fetching monitor list");

      // sleep randomly between 0 and 45 seconds

      const sleepTime: number = NumberUtil.getRandomNumber(0, 45000);
      logger.debug(
        `Sleeping for ${sleepTime} ms, just to give probe API's some time to load balance between different workers`,
      );
      await Sleep.sleep(sleepTime);

      const monitorListUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/monitor/list");

      const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
        await API.fetch<JSONArray>({
          method: HTTPMethod.POST,
          url: monitorListUrl,
          data: {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            limit: PROBE_MONITOR_FETCH_LIMIT || 100,
          },
          headers: {},
          options: ProbeAPIRequest.getDefaultRequestOptions(monitorListUrl),
        });

      logger.debug("Fetched monitor list");
      logger.debug(result);

      const monitors: Array<Monitor> = BaseModel.fromJSONArray(
        result.data as JSONArray,
        Monitor,
      );

      const probeMonitorPromises: Array<
        Promise<Array<ProbeMonitorResponse | null>>
      > = []; // Array of promises to probe monitors

      for (const monitor of monitors) {
        /*
         * Every check carries its own deadline. Without one, a single
         * monitor implementation that never settles keeps this
         * Promise.allSettled — and therefore this worker — pending forever.
         */
        probeMonitorPromises.push(probeMonitorWithDeadline(monitor));
      }

      // all settled
      // eslint-disable-next-line no-undef
      const results: PromiseSettledResult<(ProbeMonitorResponse | null)[]>[] =
        await Promise.allSettled(probeMonitorPromises);

      let resultIndex: number = 0;

      for (const result of results) {
        if (monitors && monitors[resultIndex]) {
          logger.debug("Monitor:");
          logger.debug(monitors[resultIndex]);
        }

        if (result.status === "rejected") {
          logger.error("Error in probing monitor:");
          logger.error(result.reason);
        } else {
          logger.debug("Probed monitor: ");
          logger.debug(result.value);
        }

        resultIndex++;
      }
    } catch (err) {
      logger.error("Error in fetching monitor list");
      logger.error(err);

      if (err instanceof APIException) {
        logger.error("API Exception Error");
        logger.error(JSON.stringify((err as APIException).error, null, 2));
      }
    }
  }
}

export default InitJob;
