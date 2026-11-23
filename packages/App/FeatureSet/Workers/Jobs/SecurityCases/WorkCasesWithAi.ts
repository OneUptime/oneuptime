import RunCron from "../../Utils/Cron";
import SecurityCaseResponse from "Common/Server/Utils/AI/Security/Response/SecurityCaseResponse";
import { EVERY_MINUTE } from "Common/Utils/CronTime";

/*
 * OneUptime AI working security cases end to end (#10352): every minute,
 * each case it works whose next look has come - an approval decided, a
 * step's check written, a step of its own finished, the quiet window before
 * a close over - gets a look, queued on the AI queue as a
 * SecurityCaseResponse run (SecurityCaseResponse.startDueLooks). A case is
 * read only when its moment comes, by an index (SecurityCase.aiNextLookAt),
 * and has one look on its way at a time.
 */
RunCron(
  "SecurityCases:WorkCasesWithAi",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 2 * 60 * 1000,
  },
  async () => {
    await SecurityCaseResponse.startDueLooks();
  },
);
