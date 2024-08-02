import CodeRepositoryUtil from "./Utils/CodeRepository";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import logger from "CommonServer/Utils/Logger";
import dotenv from "dotenv";
import Init from "./Init";
import Telemetry from "CommonServer/Utils/Telemetry";

const APP_NAME: string = "copilot";

dotenv.config();

logger.info("OneUptime Copilot is starting...");

// Initialize telemetry
Telemetry.init({
  serviceName: APP_NAME,
});

Init()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error: Error | HTTPErrorResponse) => {
    try {
      logger.error(error);
      await CodeRepositoryUtil.discardChanges();

      // change back to main branch.
      await CodeRepositoryUtil.checkoutMainBranch();
    } catch (e) {
      // do nothing.
    }

    logger.error("Error in starting OneUptime Copilot: ");

    if (error instanceof HTTPErrorResponse) {
      logger.error(error.message);
    } else if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error(error);
    }

    process.exit(1);
  });
