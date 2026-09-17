/* eslint-disable no-console */
import logger from "./Logger";

process.on("exit", () => {
  logger.debug("Server Shutting Shutdown");
});

process.on(
  "unhandledRejection",
  (reason: unknown, promise: Promise<unknown>) => {
    logger.error("Unhandled rejection in server process occurred");
    logger.error(reason);
    logger.error(promise);
  },
);

process.on("uncaughtException", (err: Error) => {
  logger.error("Uncaught exception in server process occurred");
  logger.error(err);
});
