import { ONEUPTIME_URL } from "../Config";
import Register from "../Services/Register";
import AIAgentAPIRequest from "../Utils/AIAgentAPIRequest";
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
    jobName: "AIAgent:Alive",
    options: {
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    },
    runFunction: async () => {
      logger.debug("Checking if AI Agent is alive...");

      const aiAgentId: string | undefined = LocalCache.getString(
        "AI_AGENT",
        "AI_AGENT_ID",
      );

      if (!aiAgentId) {
        logger.warn(
          "AI Agent is not registered yet. Skipping alive check. Trying to register AI Agent again...",
        );
        await Register.registerAIAgent();
        return;
      }

      logger.debug("AI Agent ID: " + aiAgentId.toString());

      const aliveUrl: URL = URL.fromString(
        ONEUPTIME_URL.toString(),
      ).addRoute("/alive");

      const result: HTTPResponse<JSONObject> = await API.post({
        url: aliveUrl,
        data: AIAgentAPIRequest.getDefaultRequestBody(),
      });

      if (result.isSuccess()) {
        logger.debug("AI Agent update sent to server successfully.");
      } else {
        logger.error("Failed to send AI Agent update to server.");
      }
    },
  });
};

export default InitJob;
