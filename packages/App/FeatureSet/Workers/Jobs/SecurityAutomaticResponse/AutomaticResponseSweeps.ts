import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityAutomaticResponseDoubt from "Common/Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseDoubt";
import SecurityAutomaticResponseRecorder from "Common/Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRecorder";
import SecurityAutomaticResponseTrial from "Common/Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseTrial";

/*
 * Automatic response's minute (#10350), one job each so a slow one never
 * holds up the others:
 *
 *   - a policy's block that took hold since is said on its case, with its
 *     time to block (SecurityAutomaticResponseRecorder), and one never made
 *     is failed with why;
 *   - undo on doubt: a block whose address a signed-in user was seen from
 *     since is lifted, and the project's security owners told
 *     (SecurityAutomaticResponseDoubt);
 *   - a trial run whose week is up is written down as finished, and the
 *     security owners are told what it would have done
 *     (SecurityAutomaticResponseTrial).
 */
RunCron(
  "SecurityAutomaticResponse:RecordBlocksTakingHold",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityAutomaticResponseRecorder.recordBlocksTakingHold();
  },
);

RunCron(
  "SecurityAutomaticResponse:LiftOnDoubt",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityAutomaticResponseDoubt.liftOnDoubt();
  },
);

RunCron(
  "SecurityAutomaticResponse:FinishTrials",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityAutomaticResponseTrial.finishDueTrials();
  },
);
