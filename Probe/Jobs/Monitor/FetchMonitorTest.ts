import { PROBE_INGEST_URL } from "../../Config";
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
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import BasicCron from "Common/Server/Utils/BasicCron";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:MonitorTest",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async () => {
      try {
        await FetchMonitorTestAndProbe.run();
      } catch (err) {
        logger.error("Error in worker");
        logger.error(err);
      }
    },
  });
};

class FetchMonitorTestAndProbe {
  public static async run(): Promise<void> {
    try {
      logger.debug(`MONITOR TEST: Probing monitors `);

      await this.fetchListAndProbe();

      logger.debug(`MONITOR TEST: Probing monitors  complete`);
    } catch (err) {
      logger.error(`Error in worker `);
      logger.error(err);
    }
  }

  private static async fetchListAndProbe(): Promise<void> {
    try {
      logger.debug("MONITOR TEST: Fetching monitor  list");

      const monitorListUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/monitor-test/list");

      const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
        await API.fetch<JSONArray>(
          HTTPMethod.POST,
          monitorListUrl,
          {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            limit: 100,
          },
          {},
          {},
        );

      logger.debug("MONITOR TEST: Fetched monitor test list");
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

export default InitJob;
