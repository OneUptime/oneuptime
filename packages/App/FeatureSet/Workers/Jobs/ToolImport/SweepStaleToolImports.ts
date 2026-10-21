import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";
import ToolImportRunExecutor from "Common/Server/Utils/ToolImport/ToolImportRunExecutor";
import logger from "Common/Server/Utils/Logger";

/*
 * The backstop of imports from another tool. A read or an import runs inside
 * one queue job, so a Worker that dies mid-way (a deploy, an OOM) would leave
 * the run Reading or Importing forever - and, for a read, its API key stored.
 * This fails such runs (clearing the key and what was read), and expires
 * previews nobody started within a day, so a stale picture of the other tool
 * is never imported.
 */
RunCron(
  "ToolImport:SweepStaleToolImports",
  { schedule: EVERY_FIFTEEN_MINUTE, runOnStartup: false },
  async () => {
    try {
      await ToolImportRunExecutor.sweepStaleRuns();
    } catch (error) {
      logger.error("ToolImport: the stale import sweep failed.");
      logger.error(error);
    }
  },
);
