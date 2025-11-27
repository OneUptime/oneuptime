import logger from "Common/Server/Utils/Logger";
import dotenv from "dotenv";
import Telemetry from "Common/Server/Utils/Telemetry";

const APP_NAME: string = "copilot";

dotenv.config();

logger.info("OneUptime Copilot is starting...");

// Initialize telemetry
Telemetry.init({
  serviceName: APP_NAME,
});

// Initialize the application