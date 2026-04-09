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
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";

export default class Register {
  public static async registerAIAgent(): Promise<void> {
    // register AI agent with 10 retries and 30 second interval between each retry.

    let currentRetry: number = 0;

    const maxRetry: number = 10;

    const retryIntervalInSeconds: number = 30;

    while (currentRetry < maxRetry) {
      try {
        logger.debug(`Registering AI Agent. Attempt: ${currentRetry + 1}`, {
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
        await Register._registerAIAgent();
        logger.debug(`AI Agent registered successfully.`, {
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
        break;
      } catch (error) {
        logger.error(
          `Failed to register AI Agent. Retrying after ${retryIntervalInSeconds} seconds...`,
          { aiAgentName: AI_AGENT_NAME } as LogAttributes,
        );
        logger.error(error, { aiAgentName: AI_AGENT_NAME } as LogAttributes);
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

      logger.debug("Registering AI Agent...", {
        aiAgentName: AI_AGENT_NAME,
      } as LogAttributes);
      logger.debug("Sending request to: " + aiAgentRegistrationUrl.toString(), {
        aiAgentName: AI_AGENT_NAME,
      } as LogAttributes);

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
          { aiAgentName: AI_AGENT_NAME } as LogAttributes,
        );
        logger.error(result.data, {
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
        throw new Error(
          "Failed to register AI Agent: HTTP " + result.statusCode,
        );
      }

      logger.debug("AI Agent Registered", {
        aiAgentName: AI_AGENT_NAME,
      } as LogAttributes);
      logger.debug(result.data, {
        aiAgentName: AI_AGENT_NAME,
      } as LogAttributes);

      const aiAgentId: string | undefined = result.data["_id"] as
        | string
        | undefined;

      if (!aiAgentId) {
        logger.error("AI Agent ID not found in response", {
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
        logger.error(result.data, {
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
        throw new Error("AI Agent ID not found in registration response");
      }

      LocalCache.setString("AI_AGENT", "AI_AGENT_ID", aiAgentId);
    } else {
      // Non-clustered mode: Validate AI agent by sending alive request
      if (!AI_AGENT_ID) {
        logger.error("AI_AGENT_ID or ONEUPTIME_SECRET should be set", {
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
        return process.exit();
      }

      const aliveUrl: URL = URL.fromString(ONEUPTIME_URL.toString()).addRoute(
        "/api/ai-agent/alive",
      );

      logger.debug("Registering AI Agent...", {
        aiAgentId: AI_AGENT_ID?.toString(),
        aiAgentName: AI_AGENT_NAME,
      } as LogAttributes);
      logger.debug("Sending request to: " + aliveUrl.toString(), {
        aiAgentId: AI_AGENT_ID?.toString(),
        aiAgentName: AI_AGENT_NAME,
      } as LogAttributes);

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
        logger.debug("AI Agent registered successfully", {
          aiAgentId: AI_AGENT_ID?.toString(),
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
      } else {
        throw new Error("Failed to register AI Agent: " + result.statusCode);
      }
    }

    logger.debug(
      `AI Agent ID: ${LocalCache.getString("AI_AGENT", "AI_AGENT_ID") || "Unknown"}`,
      { aiAgentName: AI_AGENT_NAME } as LogAttributes,
    );
  }
}
