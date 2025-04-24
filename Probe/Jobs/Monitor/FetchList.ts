import {
  PROBE_INGEST_URL,
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
import OneUptimeDate from "Common/Types/Date";
import APIException from "Common/Types/Exception/ApiException";
import { JSONArray } from "Common/Types/JSON";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";

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

        logger.debug(`Starting worker ${currentWorker}`);

        new FetchListAndProbe("Worker " + currentWorker)
          .run()
          .catch((err: any) => {
            logger.error(`Worker ${currentWorker} failed: `);
            logger.error(err);
          });
      }
    } catch (err) {
      logger.error("Starting workers failed");
      logger.error(err);
    }
  },
});

export default class FetchListAndProbe {
  private workerName: string = "";

  public constructor(workerName: string) {
    this.workerName = workerName;
  }

  public async run(): Promise<void> {
    logger.debug(`Running worker ${this.workerName}`);

    try {
      // Sleep randomly between 500 and 1300 milliseconds
      // We do this to avoid all workers hitting the server at the same time and fetching the same monitors.
      const sleepTime: number = Math.floor(Math.random() * 1300) + 500;
      logger.debug(`Worker ${this.workerName} is sleeping for ${sleepTime}ms`);
      await Sleep.sleep(Math.round(sleepTime) % 5000);

      const runTime: Date = OneUptimeDate.getCurrentDate();

      logger.debug(`Probing monitors ${this.workerName}`);

      await this.fetchListAndProbe();

      logger.debug(`Probing monitors ${this.workerName} complete`);

      // if rumTime  + 5 seconds is in the future, then this fetchLst either errored out or had no monitors in the list. Either way, wait for 5 seconds and proceed.

      const twoSecondsAdded: Date = OneUptimeDate.addRemoveSeconds(runTime, 2);

      if (OneUptimeDate.isInTheFuture(twoSecondsAdded)) {
        logger.debug(`Worker ${this.workerName} is waiting for 1 seconds`);
        await Sleep.sleep(1000);
      }
    } catch (err) {
      logger.error(`Error in worker ${this.workerName}`);
      logger.error(err);
      await Sleep.sleep(1000);
    }
  }

  private async fetchListAndProbe(): Promise<void> {
    try {
      logger.debug("Fetching monitor list");

      const monitorListUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/monitor/list");

      const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
        await API.fetch<JSONArray>(
          HTTPMethod.POST,
          monitorListUrl,
          {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            limit: PROBE_MONITOR_FETCH_LIMIT || 100,
          },
          {},
          {},
        );

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
        logger.error(JSON.stringify(err.error, null, 2));
      }
    }
  }
}
