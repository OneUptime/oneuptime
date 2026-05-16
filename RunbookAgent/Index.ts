import {
  ONEUPTIME_BASE_URL,
  POLL_INTERVAL_MS,
  RUNBOOK_AGENT_ID,
  RUNBOOK_AGENT_VERSION,
} from "./Config";
import startHeartbeat from "./Jobs/Heartbeat";
import startPolling from "./Jobs/PollWork";
import logger from "Common/Server/Utils/Logger";

const APP_NAME: string = "runbook-agent";

const init: () => Promise<void> = async (): Promise<void> => {
  try {
    logger.info(
      `${APP_NAME} ${RUNBOOK_AGENT_VERSION} starting | agentId=${RUNBOOK_AGENT_ID.toString()} | server=${ONEUPTIME_BASE_URL.toString()} | poll=${POLL_INTERVAL_MS}ms`,
    );

    startHeartbeat();
    startPolling();

    logger.info(`${APP_NAME} ready.`);
  } catch (err) {
    logger.error("Runbook Agent init failed");
    logger.error(err);
    process.exit(1);
  }
};

init().catch((err: Error) => {
  logger.error(err);
  process.exit(1);
});
