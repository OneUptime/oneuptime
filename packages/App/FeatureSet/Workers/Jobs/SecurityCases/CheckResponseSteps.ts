import RunCron from "../../Utils/Cron";
import JobDictionary from "../../Utils/JobDictionary";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import SecurityCaseStepCheckRunner from "Common/Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import SecurityCaseStepChecks, {
  SECURITY_CASE_STEP_CHECK_JOB,
} from "Common/Server/Utils/SecurityCase/StepChecks/SecurityCaseStepChecks";
import { JSONObject } from "Common/Types/JSON";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * Security cases' Response Plan steps, checked by OneUptime itself (#10340):
 * every minute, each open case whose moment has come has the steps OneUptime
 * can check read again - the app's own requests from an address, the
 * account in the identity provider, the host in the EDR, the monitors - and
 * what it found written beside each step, with its evidence
 * (SecurityCaseStepCheckRunner). A case is read only when its moment comes,
 * by an index, so a project with a thousand open cases costs one small read
 * a minute.
 *
 * A change on a case - a step ticked, a playbook step finished, a block
 * applied - checks its steps at once, through the job below
 * (SecurityCaseStepChecks).
 */
RunCron(
  "SecurityCases:CheckResponseSteps",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityCaseStepCheckRunner.checkDueCases();
  },
);

export async function checkResponseStepsNow(job?: QueueJob): Promise<void> {
  await SecurityCaseStepChecks.runJob((job?.data || {}) as JSONObject);
}

JobDictionary.setJobFunction(
  SECURITY_CASE_STEP_CHECK_JOB,
  checkResponseStepsNow,
);
