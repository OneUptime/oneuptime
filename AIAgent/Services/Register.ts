import { ONEUPTIME_URL, AI_AGENT_ID, AI_AGENT_KEY } from "../Config";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import logger from "Common/Server/Utils/Logger";

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
    // Validate AI agent by sending alive request
    if (!AI_AGENT_ID) {
      logger.error("AI_AGENT_ID should be set");
      return process.exit();
    }

    const aliveUrl: URL = URL.fromString(
      ONEUPTIME_URL.toString(),
    ).addRoute("/api/ai-agent/alive");

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

    logger.debug(
      `AI Agent ID: ${LocalCache.getString("AI_AGENT", "AI_AGENT_ID") || "Unknown"}`,
    );
  }
}
