import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import LlmCostBudgetEvaluator from "Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator";

/**
 * LLM cost budget watch loop: sums the UTC day's LLM span spend for every
 * enabled budget, stamps it on the budget row, and publishes the
 * oneuptime.llm.budget.* gauge metrics that Metrics monitors alert on.
 */
const SWEEP_TIMEOUT_MINUTES: number = 10;

/*
 * One sweep at a time, and a sweep that stops at its deadline (issue #8103).
 *
 * RunCron runs one copy of this job at a time across every worker replica
 * (CronLock), so two sweeps no longer interleave and publish duplicate metric
 * points into the budget series monitors evaluate. The job used to take a
 * Redis lock of its own for that, from when RunCron had no overlap guard; the
 * lease does it now. The sweep stops between budgets once its deadline has
 * passed - its time limit, or its lease lost - and the next tick, fifteen
 * minutes on, evaluates every budget again.
 */
RunCron(
  "Llm:EvaluateLlmCostBudgets",
  {
    schedule: EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(
      SWEEP_TIMEOUT_MINUTES,
    ),
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    await LlmCostBudgetEvaluator.evaluateAllBudgets({ deadline: deadline });
  },
);
