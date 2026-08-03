import { ONEUPTIME_BASE_URL } from "../Config";
import RunnerAPIRequest from "../Utils/RunnerAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";

/*
 * Liveness for the CLUSTER-scoped Runner's code-fix identity. Registration
 * assigned it an AIAgent row, and that row's lastAlive is what the readiness
 * checks and the orphaned-run sweeper read — without this tick, queued
 * code-fix runs would be failed as "no agent available".
 *
 * A project-scoped Runner is not registered in that table at all: its
 * liveness is the runbook heartbeat against its own RunbookAgent row, so this
 * job is only started in cluster mode (see Runner/Index.ts).
 */
const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Runner:CodeFixAlive",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    },
    runFunction: async () => {
      /*
       * A liveness tick must never take the process down: the server being
       * briefly unreachable is normal, and the next tick recovers.
       */
      try {
        const aliveUrl: URL = URL.fromString(
          ONEUPTIME_BASE_URL.toString(),
        ).addRoute("/api/ai-agent/alive");

        const result: HTTPResponse<JSONObject> = await API.post({
          url: aliveUrl,
          data: RunnerAPIRequest.getDefaultRequestBody(),
        });

        if (result.isSuccess()) {
          logger.debug("Runner code-fix liveness sent to server successfully.");
        } else {
          logger.error(
            `Failed to send Runner code-fix liveness to server. Status: ${result.statusCode}`,
          );
        }
      } catch (err) {
        logger.error("Failed to send Runner code-fix liveness to server.");
        logger.error(err);
      }
    },
  });
};

export default InitJob;
