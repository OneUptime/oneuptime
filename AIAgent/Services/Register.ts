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
  // Base retry interval; backoff doubles from here up to the cap below.
  private static readonly baseRetryIntervalInSeconds: number = 30;

  // Backoff cap: never wait longer than this between attempts.
  private static readonly maxRetryIntervalInSeconds: number = 5 * 60;

  /*
   * Register the AI agent, retrying FOREVER on failure. The server being
   * temporarily unreachable (boot ordering, migrations, network blips) must
   * never kill or give up on the agent container — it registers whenever
   * the server comes back. Backoff starts at 30s and doubles per
   * consecutive failure, capped at 5 minutes; every failure is logged with
   * the attempt count and the next wait.
   */
  public static async registerAIAgent(): Promise<void> {
    let attempt: number = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;

      try {
        logger.debug(`Registering AI Agent. Attempt: ${attempt}`, {
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
        await Register._registerAIAgent();
        logger.debug(`AI Agent registered successfully.`, {
          aiAgentName: AI_AGENT_NAME,
        } as LogAttributes);
        return;
      } catch (error) {
        const waitSeconds: number = Math.min(
          Register.baseRetryIntervalInSeconds * Math.pow(2, attempt - 1),
          Register.maxRetryIntervalInSeconds,
        );

        logger.error(
          `Failed to register AI Agent (attempt ${attempt}). Retrying after ${waitSeconds} seconds — the agent keeps retrying until the server is reachable.`,
          { aiAgentName: AI_AGENT_NAME } as LogAttributes,
        );
        logger.error(error, { aiAgentName: AI_AGENT_NAME } as LogAttributes);
        await Sleep.sleep(waitSeconds * 1000);
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
      /*
       * Non-clustered mode: validate the AI agent by sending an alive
       * request. A missing AI_AGENT_ID is thrown (NOT process.exit) so the
       * retry-forever loop keeps the container alive and logging the
       * misconfiguration — a crash loop hides the message.
       */
      if (!AI_AGENT_ID) {
        throw new Error(
          "AI_AGENT_ID or ONEUPTIME_SECRET should be set for the AI agent to register. Set one of them and the agent will register on its next retry.",
        );
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
