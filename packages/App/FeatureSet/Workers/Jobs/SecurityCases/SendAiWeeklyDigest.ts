import RunCron from "../../Utils/Cron";
import SecurityCaseAiWeeklyDigest from "Common/Server/Utils/SecurityCase/SecurityCaseAiWeeklyDigest";
import { EVERY_MONDAY_MORNING } from "Common/Utils/CronTime";

/*
 * "What OneUptime AI did on security cases this week" (#10353): each Monday
 * morning, every project OneUptime AI did something on a security case of
 * in the week before gets its digest, sent to its security owners - its
 * Project Owners and Security Admins who can read security cases
 * (SecurityCaseAiWeeklyDigest). A week it did nothing sends nothing.
 *
 * runOnStartup is false: a deploy, a crash loop or a scale-up would
 * otherwise send it again, and a digest that comes three times a rollout
 * is filtered away the week it has something to say.
 */
RunCron(
  "SecurityCases:SendAiWeeklyDigest",
  {
    schedule: EVERY_MONDAY_MORNING,
    runOnStartup: false,
    timeoutInMS: 30 * 60 * 1000,
  },
  async () => {
    await SecurityCaseAiWeeklyDigest.sendAll();
  },
);
