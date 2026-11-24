import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import SecurityBlocklistReconciler from "Common/Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";

/*
 * The blocklist kept true at every destination, every minute (#10338):
 * each project with an active block, or a block a destination may still
 * hold, gets a reconcile on the worker queue (RunSecurityBlocklistReconcile),
 * which re-adds what someone removed at the provider and confirms what
 * holds. A change to a block queues its project's at once; this is what
 * catches drift and retries. Nothing is queued while no kind of destination
 * exists.
 */
RunCron(
  "SecurityBlocklist:ReconcileSecurityBlocklist",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityBlocklistReconciler.queueDueProjects();
  },
);
