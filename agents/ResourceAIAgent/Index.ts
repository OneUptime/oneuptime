import ResourceAiAgent, { FORCE_EXIT_AFTER_MS } from "./Agent";
import Logger from "./Logger";

/*
 * Entry point: `node build/dist/Index.js` in the image (see Agent.ts for
 * what start-up and shutdown do).
 *
 * Docker gives the container 10 seconds between SIGTERM and SIGKILL by
 * default; shutdown gives the command in progress, and any heartbeat or
 * registration still on the wire, most of them and the sign-off a couple
 * more, and this hard stop makes sure the process exits before Docker has
 * to kill it.
 */

const agent: ResourceAiAgent = new ResourceAiAgent({ env: process.env });

let exiting: boolean = false;

const exitAfterShutdown: (signal: string) => void = (signal: string): void => {
  if (exiting) {
    return;
  }
  exiting = true;

  setTimeout((): void => {
    Logger.warn("Shutdown took too long; exiting now.");
    process.exit(0);
  }, FORCE_EXIT_AFTER_MS).unref();

  agent
    .shutdown(signal)
    .catch((err: unknown): void => {
      Logger.error("Shutdown failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally((): void => {
      process.exit(0);
    });
};

process.on("SIGTERM", (): void => {
  exitAfterShutdown("SIGTERM");
});

process.on("SIGINT", (): void => {
  exitAfterShutdown("SIGINT");
});

process.on("unhandledRejection", (reason: unknown): void => {
  Logger.error("Unhandled rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

agent.start().catch((err: unknown): void => {
  // Only the health server failing to listen gets here (the port is taken).
  Logger.error(`The ${agent.getDisplayName()} could not start`, {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
