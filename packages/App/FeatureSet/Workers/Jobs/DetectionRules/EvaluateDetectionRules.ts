import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DetectionRuleEvaluator from "Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator";

/*
 * Detections-as-code engine tick. Each run evaluates every enabled Sigma
 * detection rule that is due (per-rule evaluation interval), against the
 * SecurityEvent ClickHouse table. The 10-minute timeout keeps a
 * pathological rule set from overlapping with the next tick's work —
 * per-rule windows resume from lastEvaluatedAt, so a timed-out run loses
 * no events.
 */
RunCron(
  "DetectionRules:EvaluateDetectionRules",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await DetectionRuleEvaluator.evaluateAllDueRules();
  },
);
