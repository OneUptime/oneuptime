import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityCaseTargetCheck from "Common/Server/Utils/SecurityCase/SecurityCaseTargetCheck";

/*
 * Security cases' response targets, every minute: each case whose moment
 * has come - one of its targets is about to be missed, or is missed - has
 * it recorded on its timeline, and the people on it are told
 * (SecurityCaseTargetCheck; the rules are Common/Utils/SecurityCase/
 * SecurityCaseTargets). A case is read only when its moment comes, by an
 * index, so a project with a thousand open cases costs one small read a
 * minute.
 */
RunCron(
  "SecurityCases:CheckResponseTargets",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityCaseTargetCheck.checkDueCases();
  },
);
