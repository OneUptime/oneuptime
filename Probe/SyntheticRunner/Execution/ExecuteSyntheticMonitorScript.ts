import SyntheticMonitorExecutor from "./SyntheticMonitorExecutor";
import logger from "Common/Server/Utils/Logger";
import {
  SyntheticMonitorExecutionChildMessage,
  SyntheticMonitorExecutionRequest,
} from "../Types/SyntheticMonitorExecution";

let hasHandledMessage: boolean = false;

const sendAndExit: (
  message: SyntheticMonitorExecutionChildMessage,
  exitCode: number,
) => void = (
  message: SyntheticMonitorExecutionChildMessage,
  exitCode: number,
): void => {
  if (process.send) {
    process.send(message, (error: Error | null) => {
      if (error) {
        logger.error(error);
      }

      process.exit(exitCode);
    });

    return;
  }

  process.exit(exitCode);
};

const handleFatalError: (error: unknown) => void = (error: unknown): void => {
  sendAndExit(
    {
      type: "error",
      error: {
        message:
          (error as Error)?.message ||
          (error as Error)?.toString() ||
          String(error),
        stack: (error as Error)?.stack,
      },
    },
    1,
  );
};

process.once("message", async (message: unknown): Promise<void> => {
  hasHandledMessage = true;

  try {
    const request: SyntheticMonitorExecutionRequest =
      message as SyntheticMonitorExecutionRequest;

    const results = await SyntheticMonitorExecutor.execute(request);

    sendAndExit(
      {
        type: "success",
        payload: {
          results,
        },
      },
      0,
    );
  } catch (error: unknown) {
    handleFatalError(error);
  }
});

process.on("uncaughtException", (error: Error): void => {
  handleFatalError(error);
});

process.on("unhandledRejection", (error: unknown): void => {
  handleFatalError(error);
});

global.setTimeout(() => {
  if (!hasHandledMessage) {
    handleFatalError(new Error("Synthetic runner child did not receive a job"));
  }
}, 10000);
