import RunCron from "../../Utils/Cron";
import registerSecurityProjectJob from "../../Utils/SecurityProjectJob";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import { SecurityProjectWorkLease } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import DetectionRuleEvaluator, {
  DETECTION_RULES_PROJECT_WORK,
} from "Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator";

/*
 * Detections-as-code engine tick. Each run pages through every enabled
 * Sigma rule and queues one turn for each project with a rule due (per-rule
 * evaluation interval). A turn evaluates that project's due rules against
 * the SecurityEvent ClickHouse table under the project's lease; per-rule
 * windows resume from lastEvaluatedAt, so a turn that runs out of time
 * loses no events.
 */
RunCron(
  "DetectionRules:EvaluateDetectionRules",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await DetectionRuleEvaluator.enqueueProjectsWithDueRules();
  },
);

export const evaluateProjectDetectionRules: ReturnType<
  typeof registerSecurityProjectJob
> = registerSecurityProjectJob(
  DETECTION_RULES_PROJECT_WORK,
  (projectId: ObjectID, lease: SecurityProjectWorkLease): Promise<void> => {
    return DetectionRuleEvaluator.evaluateDueRulesForProject(projectId, lease);
  },
);
