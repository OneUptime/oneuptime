import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityBlockExpiry from "Common/Server/Utils/SecurityBlocklist/SecurityBlockExpiry";

/*
 * Blocks whose time is up, every minute (#10338): each active block past
 * its expiry is ended in one compare-and-set, its case's timeline says so,
 * and the project's blocklist is reconciled, which takes it away from every
 * destination (SecurityBlockExpiry). Read by an index that holds only active
 * blocks, so a project with thousands of ended blocks costs nothing here.
 */
RunCron(
  "SecurityBlocklist:ExpireSecurityBlocks",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityBlockExpiry.expireDueBlocks();
  },
);
