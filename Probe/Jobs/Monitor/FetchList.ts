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
import ProxyConfig from "../../Utils/ProxyConfig";

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

          logger.debug(`Starting worker ${currentWorker}`);

          new FetchListAndProbe("Worker " + currentWorker)
            .run()
            .catch((err: unknown) => {
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
          options: { ...ProxyConfig.getRequestProxyAgents(monitorListUrl) },
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
