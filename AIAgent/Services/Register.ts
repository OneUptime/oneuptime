import {
  ONEUPTIME_URL,
  AI_AGENT_ID,
  AI_AGENT_KEY,
  AI_AGENT_NAME,
  AI_AGENT_DESCRIPTION,
} from "../Config";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import { HasClusterKey } from "Common/Server/EnvironmentConfig";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import logger from "Common/Server/Utils/Logger";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";

export default class Register {
  public static async registerAIAgent(): Promise<void> {
    // register AI agent with 10 retries and 30 second interval between each retry.

    let currentRetry: number = 0;

    const maxRetry: number = 10;

    const retryIntervalInSeconds: number = 30;

    while (currentRetry < maxRetry) {
      try {
        logger.debug(`Registering AI Agent. Attempt: ${currentRetry + 1}`);
        await Register._registerAIAgent();
        logger.debug(`AI Agent registered successfully.`);
        break;
      } catch (error) {
        logger.error(
          `Failed to register AI Agent. Retrying after ${retryIntervalInSeconds} seconds...`,
        );
        logger.error(error);
        currentRetry++;
        await Sleep.sleep(retryIntervalInSeconds * 1000);
      }
    }
  }

  private static async _registerAIAgent(): Promise<void> {
    if (HasClusterKey) {
      // Clustered mode: Auto-register and get ID from server
      const aiAgentRegistrationUrl: URL = URL.fromString(
        ONEUPTIME_URL.toString(),
      ).addRoute("/api/ai-agent/register");

      logger.debug("Registering AI Agent...");
      logger.debug("Sending request to: " + aiAgentRegistrationUrl.toString());

      const result: HTTPResponse<JSONObject> = await API.post({
        url: aiAgentRegistrationUrl,
        data: {
          aiAgentKey: AI_AGENT_KEY,
          aiAgentName: AI_AGENT_NAME,
          aiAgentDescription: AI_AGENT_DESCRIPTION,
          clusterKey: ClusterKeyAuthorization.getClusterKey(),
        },
      });

      if (!result.isSuccess()) {
        logger.error(
          `Failed to register AI Agent. Status: ${result.statusCode}`,
        );
        logger.error(result.data);
        throw new Error(
          "Failed to register AI Agent: HTTP " + result.statusCode,
        );
      }

      logger.debug("AI Agent Registered");
      logger.debug(result.data);

      const aiAgentId: string | undefined = result.data["_id"] as
        | string
        | undefined;

      if (!aiAgentId) {
        logger.error("AI Agent ID not found in response");
        logger.error(result.data);
        throw new Error("AI Agent ID not found in registration response");
      }

      LocalCache.setString("AI_AGENT", "AI_AGENT_ID", aiAgentId);
    } else {
      // Non-clustered mode: Validate AI agent by sending alive request
      if (!AI_AGENT_ID) {
        logger.error("AI_AGENT_ID or ONEUPTIME_SECRET should be set");
        return process.exit();
      }

      const aliveUrl: URL = URL.fromString(ONEUPTIME_URL.toString()).addRoute(
        "/api/ai-agent/alive",
      );

      logger.debug("Registering AI Agent...");
      logger.debug("Sending request to: " + aliveUrl.toString());

      const result: HTTPResponse<JSONObject> = await API.post({
        url: aliveUrl,
        data: {
          aiAgentKey: AI_AGENT_KEY.toString(),
          aiAgentId: AI_AGENT_ID.toString(),
        },
      });

      if (result.isSuccess()) {
        LocalCache.setString(
          "AI_AGENT",
          "AI_AGENT_ID",
          AI_AGENT_ID.toString() as string,
        );
        logger.debug("AI Agent registered successfully");
      } else {
        throw new Error("Failed to register AI Agent: " + result.statusCode);
      }
    }

    logger.debug(
      `AI Agent ID: ${LocalCache.getString("AI_AGENT", "AI_AGENT_ID") || "Unknown"}`,
    );
  }
}
