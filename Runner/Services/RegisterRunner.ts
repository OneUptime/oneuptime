import {
  ONEUPTIME_BASE_URL,
  RUNNER_ID,
  RUNNER_INGEST_URL,
  RUNNER_KEY,
  RUNNER_NAME,
  RUNNER_DESCRIPTION,
  RUNNER_VERSION,
} from "../Config";
import RunnerCapabilities from "../Utils/RunnerCapabilities";
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
  public static async registerRunner(): Promise<void> {
    let attempt: number = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;

      try {
        logger.debug(`Registering Runner. Attempt: ${attempt}`, {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        await Register._registerRunner();
        logger.debug(`Runner registered successfully.`, {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        return;
      } catch (error) {
        const waitSeconds: number = Math.min(
          Register.baseRetryIntervalInSeconds * Math.pow(2, attempt - 1),
          Register.maxRetryIntervalInSeconds,
        );

        logger.error(
          `Failed to register Runner (attempt ${attempt}). Retrying after ${waitSeconds} seconds — the agent keeps retrying until the server is reachable.`,
          { runnerName: RUNNER_NAME } as LogAttributes,
        );
        logger.error(error, { runnerName: RUNNER_NAME } as LogAttributes);
        await Sleep.sleep(waitSeconds * 1000);
      }
    }
  }

  private static async _registerRunner(): Promise<void> {
    if (HasClusterKey) {
      // Clustered mode: Auto-register and get ID from server
      const aiAgentRegistrationUrl: URL = URL.fromString(
        ONEUPTIME_BASE_URL.toString(),
      ).addRoute("/api/ai-agent/register");

      logger.debug("Registering Runner...", {
        runnerName: RUNNER_NAME,
      } as LogAttributes);
      logger.debug("Sending request to: " + aiAgentRegistrationUrl.toString(), {
        runnerName: RUNNER_NAME,
      } as LogAttributes);

      const result: HTTPResponse<JSONObject> = await API.post({
        url: aiAgentRegistrationUrl,
        data: {
          aiAgentKey: RUNNER_KEY,
          runnerName: RUNNER_NAME,
          aiAgentDescription: RUNNER_DESCRIPTION,
          clusterKey: ClusterKeyAuthorization.getClusterKey(),
        },
      });

      if (!result.isSuccess()) {
        logger.error(
          `Failed to register Runner. Status: ${result.statusCode}`,
          { runnerName: RUNNER_NAME } as LogAttributes,
        );
        logger.error(result.data, {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        throw new Error("Failed to register Runner: HTTP " + result.statusCode);
      }

      logger.debug("Runner Registered", {
        runnerName: RUNNER_NAME,
      } as LogAttributes);
      logger.debug(result.data, {
        runnerName: RUNNER_NAME,
      } as LogAttributes);

      const aiAgentId: string | undefined = result.data["_id"] as
        | string
        | undefined;

      if (!aiAgentId) {
        logger.error("Runner ID not found in response", {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        logger.error(result.data, {
          runnerName: RUNNER_NAME,
        } as LogAttributes);
        throw new Error("Runner ID not found in registration response");
      }

      LocalCache.setString("RUNNER", "RUNNER_ID", aiAgentId);
    } else {
      /*
       * Project-scoped mode: the id and key were issued by the dashboard
       * (Settings > Runners), so they identify a Runner row. Validate
       * them against the Runner work mount, which is the endpoint that
       * authenticates against that table — the AIAgent alive endpoint would
       * reject them, since no AIAgent row is ever created for a
       * dashboard-issued Runner.
       *
       * A missing RUNNER_ID is thrown (NOT process.exit) so the retry-forever
       * loop keeps the container alive and logging the misconfiguration — a
       * crash loop hides the message.
       */
      if (!RUNNER_ID) {
        throw new Error(
          "ONEUPTIME_RUNNER_ID must be set for a project-scoped Runner (create one in Project Settings > Runners), or a cluster key for the in-cluster Runner. The Runner keeps retrying until one is provided.",
        );
      }

      const heartbeatUrl: URL = URL.fromString(
        RUNNER_INGEST_URL.toString(),
      ).addRoute("/heartbeat");

      logger.debug("Registering Runner...", {
        runnerId: RUNNER_ID?.toString(),
        runnerName: RUNNER_NAME,
      } as LogAttributes);
      logger.debug("Sending request to: " + heartbeatUrl.toString(), {
        runnerId: RUNNER_ID?.toString(),
        runnerName: RUNNER_NAME,
      } as LogAttributes);

      const result: HTTPResponse<JSONObject> = await API.post({
        url: heartbeatUrl,
        data: {
          agentId: RUNNER_ID.toString(),
          agentKey: RUNNER_KEY.toString(),
          agentVersion: RUNNER_VERSION,
        },
      });

      if (result.isSuccess()) {
        LocalCache.setString(
          "RUNNER",
          "RUNNER_ID",
          RUNNER_ID.toString() as string,
        );

        /*
         * The dashboard's capability toggles for this Runner. Absent when the
         * server predates them — RunnerCapabilities then keeps the historical
         * env-var behaviour.
         */
        const capabilities: JSONObject | undefined = result.data[
          "capabilities"
        ] as JSONObject | undefined;

        if (capabilities) {
          RunnerCapabilities.setGrantedByServer({
            canRunRunbooks: capabilities["canRunRunbooks"] !== false,
            canRunCodeFixTasks: capabilities["canRunCodeFixTasks"] === true,
          });
        }

        logger.debug("Runner registered successfully", {
          runnerId: RUNNER_ID?.toString(),
          runnerName: RUNNER_NAME,
        } as LogAttributes);
      } else {
        /*
         * The credentials may predate the Runner merge — an AI Agent's id and
         * key, which live in a different table and validate on a different
         * endpoint. Fall back to it so an upgraded container with old
         * credentials still comes up; it keeps the code-fix capability, which
         * is all an AI Agent ever had.
         */
        const aliveUrl: URL = URL.fromString(
          ONEUPTIME_BASE_URL.toString(),
        ).addRoute("/api/ai-agent/alive");

        const legacyResult: HTTPResponse<JSONObject> = await API.post({
          url: aliveUrl,
          data: {
            aiAgentId: RUNNER_ID.toString(),
            aiAgentKey: RUNNER_KEY.toString(),
          },
        });

        if (!legacyResult.isSuccess()) {
          throw new Error("Failed to register Runner: " + result.statusCode);
        }

        LocalCache.setString(
          "RUNNER",
          "RUNNER_ID",
          RUNNER_ID.toString() as string,
        );

        RunnerCapabilities.setGrantedByServer({
          canRunRunbooks: false,
          canRunCodeFixTasks: true,
        });

        logger.warn(
          "Registered with legacy AI Agent credentials. Create a Runner under Settings > Runners and switch to its id and key — runbook execution needs one.",
          { runnerName: RUNNER_NAME } as LogAttributes,
        );
      }
    }

    logger.debug(
      `Runner ID: ${LocalCache.getString("RUNNER", "RUNNER_ID") || "Unknown"}`,
      { runnerName: RUNNER_NAME } as LogAttributes,
    );
  }
}
