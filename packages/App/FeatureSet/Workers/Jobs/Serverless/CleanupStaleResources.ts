import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import ServerlessFunctionInstanceService from "Common/Server/Services/ServerlessFunctionInstanceService";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * ------------------------------------------------------------------
 * Serverless:CleanupStaleResources
 *
 * Runs every 5 minutes. Two steps:
 *   1. Flip serverless functions to "disconnected" when telemetry has
 *      stopped arriving. ServerlessFunctionService.markDisconnectedFunctions
 *      was written but never scheduled — verified: this cron is its
 *      only scheduled caller in the repo — so until now every function's
 *      status pill read "Connected" forever, including functions that
 *      had been deleted from the cloud account months earlier. The
 *      15-minute threshold and the reason it must stay well above the
 *      5-minute OTel ingest maintenance fence both live in that
 *      service, so this cron carries no duplicate policy. Every other
 *      pillar has the identical sweeper (Docker / IoT / Proxmox / Ceph /
 *      DockerSwarm / Host / RUM / Cloud).
 *   2. For each CONNECTED function, hard-delete ServerlessFunctionInstance
 *      rows (warm execution environments, faas.instance) whose
 *      lastSeenAt is older than the stale threshold. FaaS platforms
 *      recycle environments constantly — every cold start mints a new
 *      one and nothing ever reports the old one as retired; it just
 *      stops sending — so without this the Instances tab counts every
 *      environment that ever ran the function. Threshold and delete
 *      both live in ServerlessFunctionInstanceService
 *      (getStaleThresholdDate / deleteStaleForFunction — default 15
 *      minutes = 3x the ingest fence; override with
 *      SERVERLESS_INSTANCE_STALE_MINUTES, minimum 10) so this cron
 *      carries no duplicate policy. The cutoff is anchored to each
 *      function's own lastSeenAt rather than wall-clock now: instance
 *      rows and the function row are refreshed on the same fence-gated
 *      ingest path, so when invocations stop both go stale together,
 *      and with the disconnect and prune thresholds both at 15 minutes
 *      a wall-clock cutoff could wipe the last-known instance list of a
 *      still-"connected" function on the tick just before step 1 would
 *      have flipped it. Anchoring freezes the prune clock at the last
 *      telemetry the function actually sent.
 *
 * Skipping disconnected functions is deliberate: a function that is
 * merely idle (no invocations for a while) should keep its last-known
 * inventory rather than have the overview page wiped. When invocations
 * resume, the next batch refreshes lastSeenAt on the function and on
 * every environment that is still warm, and only the environments that
 * were really recycled age out on the following tick.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Serverless:CleanupStaleResources";

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    try {
      /*
       * Step 1: flip stale functions to disconnected so step 2 skips
       * them. Its own try block — a failure here must not stop the
       * prune, and vice versa.
       */
      try {
        await ServerlessFunctionService.markDisconnectedFunctions();
      } catch (err) {
        logger.error(
          `${JOB_NAME}: markDisconnectedFunctions failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      /*
       * Step 2: prune stale instance rows for functions that are still
       * believed to be connected.
       */
      const connectedFunctions: Array<ServerlessFunction> =
        await ServerlessFunctionService.findBy({
          query: {
            otelCollectorStatus: "connected",
          },
          select: {
            _id: true,
            projectId: true,
            lastSeenAt: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      if (connectedFunctions.length === 0) {
        return;
      }

      let totalDeleted: number = 0;
      for (const serverlessFunction of connectedFunctions) {
        if (!serverlessFunction._id) {
          continue;
        }

        // Anchor the cutoff to this function's lastSeenAt (see header).
        const cutoff: Date =
          ServerlessFunctionInstanceService.getStaleThresholdDate(
            serverlessFunction.lastSeenAt || undefined,
          );

        try {
          const deleted: number =
            await ServerlessFunctionInstanceService.deleteStaleForFunction({
              serverlessFunctionId: new ObjectID(
                serverlessFunction._id.toString(),
              ),
              olderThan: cutoff,
            });
          totalDeleted += deleted;
        } catch (err) {
          logger.error(
            `${JOB_NAME}: deleteStaleForFunction failed for serverless function ${serverlessFunction._id.toString()} (project ${serverlessFunction.projectId?.toString() || "unknown"}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (totalDeleted > 0) {
        logger.debug(
          `${JOB_NAME}: pruned ${totalDeleted} stale ServerlessFunctionInstance row(s) across ${connectedFunctions.length} connected serverless function(s)`,
        );
      }
    } catch (err) {
      logger.error(
        `${JOB_NAME} cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);
