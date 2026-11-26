import RunCron from "../../Utils/Cron";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import SecurityBlocklistFeedHealth from "Common/Server/Utils/SecurityBlocklist/SecurityBlocklistFeedHealth";

/*
 * Whether each firewall still reads its blocklist feed (#10345), every five
 * minutes: how often it usually fetches the feed, kept on the feed, and -
 * once it has not fetched it for three times that - one email to the
 * project's owners each time it stops (SecurityBlocklistFeedHealth). The
 * feed's page and the Blocklist say so as soon as it happens; this is who
 * is told.
 */
RunCron(
  "SecurityBlocklist:CheckFeedsAreRead",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: 4 * 60 * 1000,
  },
  async () => {
    await SecurityBlocklistFeedHealth.checkFeeds();
  },
);
