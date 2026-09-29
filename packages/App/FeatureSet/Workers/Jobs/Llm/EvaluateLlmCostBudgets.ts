import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import LlmCostBudgetEvaluator from "Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator";
import logger from "Common/Server/Utils/Logger";

/**
 * LLM cost budget watch loop: sums the UTC day's LLM span spend for every
 * enabled budget, stamps it on the budget row, and publishes the
 * oneuptime.llm.budget.* gauge metrics that Metrics monitors alert on.
 */
const SWEEP_TIMEOUT_MINUTES: number = 10;

/*
 * The job timeout does NOT prevent overlap — runJobWithTimeout is a
 * Promise.race with no cancellation, so a sweep body that outlives its
 * timeout keeps running while the queue schedules the next tick. Two
 * interleaved sweeps would publish duplicate metric points into the budget
 * series monitors evaluate. Serialize sweeps with a Redis lock, same as
 * Slo:EvaluateSlos. The lock timeout stays under the 15-minute tick so a
 * crashed holder self-heals within one tick.
 */
const SWEEP_LOCK_KEY: string = "Llm:EvaluateLlmCostBudgets";
const SWEEP_LOCK_NAMESPACE: string = "Workers.Cron";
const SWEEP_LOCK_TIMEOUT_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(14);

RunCron(
  "Llm:EvaluateLlmCostBudgets",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(
      SWEEP_TIMEOUT_MINUTES,
    ),
  },
  async () => {
    /*
     * acquireAttemptsLimit: 1 — never queue behind the in-flight sweep. The
     * job re-runs every fifteen minutes anyway; skipping is the correct
     * backpressure.
     */
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: SWEEP_LOCK_KEY,
        namespace: SWEEP_LOCK_NAMESPACE,
        lockTimeout: SWEEP_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `Llm:EvaluateLlmCostBudgets - Could not acquire the sweep lock; a sweep is already in flight (or Redis is unavailable). Skipping this tick: ${err}`,
      );
      return;
    }

    /*
     * The lock is released in `finally` so a throw anywhere in the sweep
     * still frees it for the next tick instead of wedging the job until the
     * lock times out.
     */
    try {
      await LlmCostBudgetEvaluator.evaluateAllBudgets();
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        // a release failure only means the lock expires on its own timeout.
        logger.error(
          `Llm:EvaluateLlmCostBudgets - Error releasing the sweep lock: ${err}`,
        );
      }
    }
  },
);
