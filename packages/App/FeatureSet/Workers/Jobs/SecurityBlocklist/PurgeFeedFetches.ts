import RunCron from "../../Utils/Cron";
import { EVERY_DAY } from "Common/Utils/CronTime";
import SecurityBlocklistFeedFetchService from "Common/Server/Services/SecurityBlocklistFeedFetchService";

/*
 * The blocklist feeds' fetch log keeps 30 days (#10345): every day, each
 * fetch older than that is deleted, a batch at a time, by the index on
 * when it was fetched. A feed's own last fetch stays on the feed.
 */
RunCron(
  "SecurityBlocklist:PurgeFeedFetches",
  {
    schedule: EVERY_DAY,
    runOnStartup: false,
    timeoutInMS: 30 * 60 * 1000,
  },
  async () => {
    await SecurityBlocklistFeedFetchService.purgeExpired();
  },
);
