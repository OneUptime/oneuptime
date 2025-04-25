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

const InitJob: VoidFunction = (): void => {
  BasicCron({
    jobName: "Basic:Alive",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    },
    runFunction: async () => {
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

      const result: HTTPResponse<JSONObject> = await API.post(
        URL.fromString(PROBE_INGEST_URL.toString()).addRoute("/alive"),
        ProbeAPIRequest.getDefaultRequestBody(),
      );

      if (result.isSuccess()) {
        logger.debug("Probe update sent to server successfully.");
      } else {
        logger.error("Failed to send probe update to server.");
      }
    },
  });
};

export default InitJob;
