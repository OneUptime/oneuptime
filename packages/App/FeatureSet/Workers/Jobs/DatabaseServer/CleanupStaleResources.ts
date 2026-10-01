import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";

/*
 * ------------------------------------------------------------------
 * DatabaseServer:CleanupStaleResources
 *
 * Runs every 5 minutes. Three independent steps, each in its own try so
 * one failing never costs the others their run:
 *   1. Flip databases whose COLLECTOR went quiet to "disconnected"
 *      (DatabaseServerService.markDisconnectedDatabaseServers). Keyed
 *      on collectorLastSeenAt, not lastSeenAt: an application still
 *      querying the database keeps lastSeenAt fresh, and that must not
 *      hide a dead collector. The threshold (default 15 minutes of
 *      silence, measured from the last data: the heartbeat behind the
 *      5-minute ingest maintenance fence may trail it by up to 7 more)
 *      lives in the service, so this cron carries no duplicate policy.
 *   2. Delete the databases application traces created for the CLIENT
 *      end of a connection (deleteClientSocketDatabaseServers): eBPF
 *      instrumentation that swapped a connection's two ends named the
 *      client's ephemeral port as the server, one "database" per
 *      connection. Discovery no longer creates them; this removes the ones
 *      created before, as long as nobody renamed, described, archived,
 *      restored or invested in them. Before the archive step, so they are
 *      deleted rather than archived (an archived row keeps its endpoints,
 *      and the next swapped span would restore it).
 *   3. Archive DISCOVERED databases nobody has seen — or touched — for
 *      DATABASE_SERVER_AUTO_ARCHIVE_DAYS (autoArchiveStaleDatabaseServers).
 *      Discovery creates rows on its own, so without this sweep a
 *      decommissioned database, or a connection string seen once in a
 *      trace, would sit in the list forever. Manual rows and rows a
 *      person invested in (labels and owners a PERSON added — not the
 *      ones label / owner rules or telemetry attached — incident / alert
 *      / scheduled maintenance links, user-added endpoints, retention
 *      overrides) are never archived. Neither is a row a person just
 *      restored from the archive (until it is seen again, or a grace
 *      period passes), nor one whose Kubernetes cluster / Docker / Podman
 *      host has itself gone quiet: last-known state is kept while the
 *      parent is disconnected. A row archived here comes back by itself
 *      the next time any discovery path sees it. Bounded per run.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "DatabaseServer:CleanupStaleResources";

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    let disconnected: number = 0;
    let deleted: number = 0;
    let archived: number = 0;

    try {
      disconnected =
        await DatabaseServerService.markDisconnectedDatabaseServers();
    } catch (err) {
      logger.error(
        `${JOB_NAME}: markDisconnectedDatabaseServers failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      deleted = await DatabaseServerService.deleteClientSocketDatabaseServers();
    } catch (err) {
      logger.error(
        `${JOB_NAME}: deleteClientSocketDatabaseServers failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      archived = await DatabaseServerService.autoArchiveStaleDatabaseServers();
    } catch (err) {
      logger.error(
        `${JOB_NAME}: autoArchiveStaleDatabaseServers failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (disconnected > 0 || deleted > 0 || archived > 0) {
      logger.debug(
        `${JOB_NAME}: marked ${disconnected} database(s) disconnected, deleted ${deleted} database(s) traces created for a client's end of a connection and auto-archived ${archived} stale discovered database(s)`,
      );
    }
  },
);
