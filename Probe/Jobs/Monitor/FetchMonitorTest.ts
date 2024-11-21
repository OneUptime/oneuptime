import { PROBE_INGEST_URL, PROBE_MONITOR_FETCH_LIMIT } from "../../Config";
import MonitorUtil from "../../Utils/Monitors/Monitor";
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import APIException from "Common/Types/Exception/ApiException";
import { JSONArray } from "Common/Types/JSON";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";

export default class FetchMonitorTestAndProbe {
  private workerName: string = "";

  public constructor(workerName: string) {
    this.workerName = workerName;
  }

  public async run(): Promise<void> {
    logger.debug(`Running worker ${this.workerName}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        logger.debug(`Probing monitors ${this.workerName}`);

        await this.fetchListAndProbe();

        logger.debug(`Probing monitors ${this.workerName} complete`);

        // sleep for 15 seconds

        await Sleep.sleep(15000);
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
        PROBE_INGEST_URL.toString(),
      ).addRoute("/monitor-test/list");

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

      logger.debug("Fetched monitor test list");
      logger.debug(result);

      const monitorTests: Array<MonitorTest> = BaseModel.fromJSONArray(
        result.data as JSONArray,
        MonitorTest,
      );

      const probeMonitorPromises: Array<
        Promise<Array<ProbeMonitorResponse | null>>
      > = []; // Array of promises to probe monitors

      for (const monitorTest of monitorTests) {
        probeMonitorPromises.push(MonitorUtil.probeMonitorTest(monitorTest));
      }

      // all settled
      // eslint-disable-next-line no-undef
      const results: PromiseSettledResult<(ProbeMonitorResponse | null)[]>[] =
        await Promise.allSettled(probeMonitorPromises);

      let resultIndex: number = 0;

      for (const result of results) {
        if (monitorTests && monitorTests[resultIndex]) {
          logger.debug("Monitor Test:");
          logger.debug(monitorTests[resultIndex]);
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
