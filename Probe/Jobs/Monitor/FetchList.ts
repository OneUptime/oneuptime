import {
  PROBE_INGEST_URL,
  PROBE_MONITOR_FETCH_CRON,
  PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS,
  PROBE_MONITOR_FETCH_JITTER_IN_MS,
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
import BasicCron from "Common/Server/Utils/BasicCron";
import NumberUtil from "Common/Utils/Number";
import Sleep from "Common/Types/Sleep";

/*
 * How many ticks' worth of workers may be in flight at once.
 *
 * Workers are spawned detached - the tick does not wait for them - so a tick
 * that fires while the previous batch is still running simply adds more. That
 * was survivable at one tick a minute; at one every ten seconds an unbounded
 * spawn rate is a pile-up waiting to happen, because a single /monitor/list
 * call can legitimately take up to PROBE_API_REQUEST_TIMEOUT_IN_MS (45s, or
 * four and a half ticks).
 *
 * The cap is a multiple of PROBE_MONITORING_WORKERS rather than a plain
 * single-flight guard: a single-flight guard would pin the probe to one
 * worker and throw away the configured concurrency, whereas this lets normal
 * slowness overlap while still refusing to grow without bound.
 */
const MAX_IN_FLIGHT_TICK_MULTIPLIER: number = 3;

const MAX_IN_FLIGHT_WORKERS: number =
  PROBE_MONITORING_WORKERS * MAX_IN_FLIGHT_TICK_MULTIPLIER;

let inFlightWorkers: number = 0;

// Test-only: clears the in-flight guard between cases.
export const resetInFlightMonitorWorkers: VoidFunction = (): void => {
  inFlightWorkers = 0;
};

// Test-only: how many workers are currently running.
export const getInFlightMonitorWorkers: () => number = (): number => {
  return inFlightWorkers;
};

/*
 * Spawns one detached worker and holds the in-flight count for as long as it
 * runs. Deliberately not inlined in the spawn loop: the release has to happen
 * in a .finally() closure, and a closure over the counter declared inside the
 * loop is exactly the footgun no-loop-func exists to catch.
 */
type StartWorkerFunction = (workerNumber: number) => void;

const startWorker: StartWorkerFunction = (workerNumber: number): void => {
  logger.debug(`Starting worker ${workerNumber}`);

  inFlightWorkers++;

  new FetchListAndProbe("Worker " + workerNumber)
    .run()
    .catch((err: unknown) => {
      logger.error(`Worker ${workerNumber} failed: `);
      logger.error(err);
    })
    .finally(() => {
      inFlightWorkers--;
    });
};

const InitJob: VoidFunction = (): void => {
  logger.debug(
    `Probe:MonitorFetchList will run every ${PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS} seconds (${PROBE_MONITOR_FETCH_CRON})`,
  );

  BasicCron({
    jobName: "Probe:MonitorFetchList",
    options: {
      schedule: PROBE_MONITOR_FETCH_CRON,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        const workersToStart: number = Math.min(
          PROBE_MONITORING_WORKERS,
          MAX_IN_FLIGHT_WORKERS - inFlightWorkers,
        );

        if (workersToStart <= 0) {
          logger.warn(
            `Probe:MonitorFetchList - ${inFlightWorkers} workers still running (max ${MAX_IN_FLIGHT_WORKERS}). Skipping this tick.`,
          );
          return;
        }

        let workers: number = 0;

        while (workers < workersToStart) {
          workers++;

          startWorker(workers);
        }
      } catch (err) {
        logger.error("Starting workers failed");
        logger.error(err);
      }
    },
  });
};
class FetchListAndProbe {
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

      /*
       * A small stagger so several workers in the same probe do not hit the
       * server in lockstep. It is derived from the fetch interval and stays
       * inside a tenth of one tick - jitter wider than the interval itself
       * would smear a 20-second monitor across anything from 15 to 105
       * seconds, which is exactly the problem sub-minute intervals exist to
       * solve.
       */
      const sleepTime: number = NumberUtil.getRandomNumber(
        0,
        PROBE_MONITOR_FETCH_JITTER_IN_MS,
      );
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
        probeMonitorPromises.push(MonitorUtil.probeMonitor(monitor));
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
