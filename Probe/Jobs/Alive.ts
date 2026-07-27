import { PROBE_INGEST_URL } from "../Config";
import Register from "../Services/Register";
import ProbeAPIRequest from "../Utils/ProbeAPIRequest";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import BasicCron from "Common/Server/Utils/BasicCron";
import logger from "Common/Server/Utils/Logger";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";

/*
 * node-cron fires every tick regardless of whether the previous run
 * finished, so without this guard a heartbeat that is stuck waiting on a
 * slow server stacks a brand-new hung request every minute (each pinning a
 * socket) until the process is restarted. One in-flight heartbeat at a time;
 * a skipped tick just means the next one reports slightly later.
 */
let isAliveCheckInProgress: boolean = false;

// Exported for tests: lets a wedged-state test reset between cases.
export function resetAliveCheckInProgress(): void {
  isAliveCheckInProgress = false;
}

// Exported for tests: one heartbeat tick, exactly as the cron runs it.
export async function checkAliveAndReport(): Promise<void> {
  if (isAliveCheckInProgress) {
    logger.warn(
      "Previous alive check is still in progress. Skipping this tick.",
    );
    return;
  }

  isAliveCheckInProgress = true;

  try {
    logger.debug("Checking if probe is alive...");

    const probeId: string | undefined = LocalCache.getString(
      "PROBE",
      "PROBE_ID",
    );

    if (!probeId) {
      logger.warn(
        "Probe is not registered yet. Skipping alive check. Trying to register probe again...",
      );
      await Register.registerProbe();
      return;
    }

    logger.debug("Probe ID: " + probeId.toString());

    const aliveUrl: URL = URL.fromString(PROBE_INGEST_URL.toString()).addRoute(
      "/alive",
    );

    const result: HTTPResponse<JSONObject> = await API.post({
      url: aliveUrl,
      data: ProbeAPIRequest.getDefaultRequestBody(),
      options: ProbeAPIRequest.getDefaultRequestOptions(aliveUrl),
    });

    if (result.isSuccess()) {
      logger.debug("Probe update sent to server successfully.");
    } else {
      logger.error("Failed to send probe update to server.");
    }
  } finally {
    isAliveCheckInProgress = false;
  }
}

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Basic:Alive",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    },
    runFunction: checkAliveAndReport,
  });
};

export default InitJob;
