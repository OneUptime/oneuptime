import { INGESTOR_URL, PROBE_MONITOR_FETCH_LIMIT } from "../../Config";
import MonitorUtil from "../../Utils/Monitors/Monitor";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import BaseModel from "Common/Models/BaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONArray } from "Common/Types/JSON";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import logger from "CommonServer/Utils/Logger";
import Monitor from "Model/Models/Monitor";

export default class FetchListAndProbe {
  private workerName: string = "";

  public constructor(workerName: string) {
    this.workerName = workerName;
  }

  public async run(): Promise<void> {
    logger.debug(`Running worker ${this.workerName}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const runTime: Date = OneUptimeDate.getCurrentDate();

        logger.debug(`Probing monitors ${this.workerName}`);

        await this.fetchListAndProbe();

        logger.debug(`Probing monitors ${this.workerName} complete`);

        // if rumTime  + 5 seconds is in the future, then this fetchLst either errored out or had no monitors in the list. Either way, wait for 5 seconds and proceed.

        const twoSecondsAdded: Date = OneUptimeDate.addRemoveSeconds(
          runTime,
          2,
        );

        if (OneUptimeDate.isInTheFuture(twoSecondsAdded)) {
          logger.debug(`Worker ${this.workerName} is waiting for 2 seconds`);
          await Sleep.sleep(2000);
        }
      } catch (err) {
        logger.error(`Error in worker ${this.workerName}`);
        logger.error(err);
        await Sleep.sleep(2000);
      }
    }
  }

  private async fetchListAndProbe(): Promise<void> {
    try {
      logger.debug("Fetching monitor list");

      const monitorListUrl: URL = URL.fromString(
        INGESTOR_URL.toString(),
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
    }
  }
}
