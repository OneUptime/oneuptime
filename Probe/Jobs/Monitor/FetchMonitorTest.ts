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

/*
 * Single-flight guard for the LIST FETCH only. This job fires every 10
 * seconds and node-cron does not wait for the previous run — against an
 * unresponsive server that is 6 new hung requests per minute, the
 * fastest-growing pile-up of all the probe's cron jobs.
 *
 * The guard deliberately does NOT cover the test execution that follows:
 * the server hands out each test exactly once (the list endpoint claims
 * tests atomically), so overlapping ticks execute disjoint batches — and
 * "Test monitor" is an interactive dashboard flow, so a long-running
 * synthetic test must not delay the pickup of the next user's test.
 */
let isMonitorTestFetchInProgress: boolean = false;

// Exported for tests: lets a wedged-state test reset between cases.
export function resetMonitorTestRunInProgress(): void {
  isMonitorTestFetchInProgress = false;
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Probe:MonitorTest",
    options: {
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    },
    runFunction: async () => {
      if (isMonitorTestFetchInProgress) {
        logger.debug(
          "Previous monitor test fetch is still in flight. Skipping this tick.",
        );
        return;
      }

      isMonitorTestFetchInProgress = true;

      let monitorTests: Array<MonitorTest> = [];

      try {
        monitorTests = await FetchMonitorTestAndProbe.fetchTestList();
      } catch (err) {
        logger.error("Error in worker");
        logger.error(err);
      } finally {
        // Release as soon as the fetch settles — see the guard comment.
        isMonitorTestFetchInProgress = false;
      }

      try {
        await FetchMonitorTestAndProbe.probeTests(monitorTests);
      } catch (err) {
        logger.error("Error in worker");
        logger.error(err);
      }
    },
  });
};

class FetchMonitorTestAndProbe {
  public static async fetchTestList(): Promise<Array<MonitorTest>> {
    try {
      logger.debug("MONITOR TEST: Fetching monitor  list");

      const monitorListUrl: URL = URL.fromString(
        PROBE_INGEST_URL.toString(),
      ).addRoute("/monitor-test/list");

      const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
        await API.fetch<JSONArray>({
          method: HTTPMethod.POST,
          url: monitorListUrl,
          data: {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            limit: 100,
          },
          headers: {},
          options: ProbeAPIRequest.getDefaultRequestOptions(monitorListUrl),
        });

      logger.debug("MONITOR TEST: Fetched monitor test list");
      logger.debug(result);

      return BaseModel.fromJSONArray(result.data as JSONArray, MonitorTest);
    } catch (err) {
      logger.error("Error in fetching monitor list");
      logger.error(err);

      if (err instanceof APIException) {
        logger.error("API Exception Error");
        logger.error(JSON.stringify(err.error, null, 2));
      }

      return [];
    }
  }

  public static async probeTests(
    monitorTests: Array<MonitorTest>,
  ): Promise<void> {
    if (monitorTests.length === 0) {
      return;
    }

    logger.debug(`MONITOR TEST: Probing monitors `);

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

    logger.debug(`MONITOR TEST: Probing monitors  complete`);
  }
}

export default InitJob;
