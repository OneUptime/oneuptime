import RunCron from "../../Utils/Cron";
import registerSecurityProjectJob from "../../Utils/SecurityProjectJob";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import { SecurityProjectWorkLease } from "Common/Server/Utils/SecurityEvent/SecurityProjectWork";
import SecurityWatchlistExpiry from "Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistExpiry";
import SecurityWatchlistUrlImport, {
  SECURITY_WATCHLIST_URL_READ_PROJECT_WORK,
} from "Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistUrlImport";

/*
 * Watchlists (Types/SecurityEvent/SecurityWatchlist), kept up to date:
 *
 *   - Values that leave their list: each minute, the values whose moment to
 *     leave has come are deleted, as a person's delete would
 *     (SecurityWatchlistExpiry). No read has seen them since that moment.
 *   - Lists read from an address: each minute the cron queues one turn for
 *     each project with a list due; a turn reads that project's due lists
 *     under the project's lease, and each list is made what the file at its
 *     address holds (SecurityWatchlistUrlImport). A list left over when the
 *     turn runs out of time is still due next minute.
 */
RunCron(
  "SecurityWatchlists:RemoveExpiredValues",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityWatchlistExpiry.removeExpiredValues();
  },
);

RunCron(
  "SecurityWatchlists:ReadListsFromUrls",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 5 * 60 * 1000,
  },
  async () => {
    await SecurityWatchlistUrlImport.enqueueProjectsWithDueLists();
  },
);

export const readProjectWatchlistsFromUrls: ReturnType<
  typeof registerSecurityProjectJob
> = registerSecurityProjectJob(
  SECURITY_WATCHLIST_URL_READ_PROJECT_WORK,
  (projectId: ObjectID, lease: SecurityProjectWorkLease): Promise<void> => {
    return SecurityWatchlistUrlImport.runDueListsForProject(projectId, lease);
  },
);
