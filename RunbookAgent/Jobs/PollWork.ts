import { MAX_CONCURRENT_JOBS, POLL_INTERVAL_MS } from "../Config";
import AgentClient, { ClaimedJob } from "../Services/AgentClient";
import Executor from "../Services/Executor";
import logger from "Common/Server/Utils/Logger";

export default function startPolling(): void {
  const state: { inFlight: number; stopped: boolean } = {
    inFlight: 0,
    stopped: false,
  };

  const handleExecutorError: (err: unknown) => void = (err: unknown): void => {
    logger.error("Executor crashed");
    logger.error(err);
  };

  const decrementInFlight: () => void = (): void => {
    state.inFlight--;
  };

  const launch: (job: ClaimedJob) => void = (job: ClaimedJob): void => {
    state.inFlight++;
    Executor.executeAndReport(job)
      .catch(handleExecutorError)
      .finally(decrementInFlight);
  };

  const tick: () => Promise<void> = async (): Promise<void> => {
    if (state.stopped) {
      return;
    }

    while (state.inFlight < MAX_CONCURRENT_JOBS) {
      let job: ClaimedJob | null = null;
      try {
        job = await AgentClient.claimNextJob();
      } catch (err) {
        logger.warn(
          `claim-next-job error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        break;
      }

      if (!job) {
        break;
      }

      launch(job);
    }
  };

  // Initial tick on startup, then on a steady cadence.
  tick();
  const timer: ReturnType<typeof setInterval> = setInterval(() => {
    tick().catch((err: unknown) => {
      logger.error("Poll tick failed");
      logger.error(err);
    });
  }, POLL_INTERVAL_MS);

  const shutdown: () => void = (): void => {
    state.stopped = true;
    clearInterval(timer);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
