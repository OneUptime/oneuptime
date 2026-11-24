import Queue, { QueueName } from "../../Infrastructure/Queue";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import SecurityBlockDestinations from "./SecurityBlockDestinations";

/*
 * THE BLOCKLIST'S WORK ON THE WORKER QUEUE (#10338): a project's blocklist
 * reconciled as soon as one of its blocks changes - made, lifted, extended,
 * expired - and again every minute (ReconcileSecurityBlocklist), so a
 * destination holds a block within seconds of it being made, and puts back
 * an item someone removed at the provider within a minute.
 *
 * At most one reconcile of a project runs and one waits: a change while
 * one runs queues the next (deduplication with keepLastIfActive), so a burst
 * of blocks is one pass, and none is lost.
 */

export const SECURITY_BLOCKLIST_RECONCILE_JOB: string =
  "SecurityBlocklist:ReconcileProject";

export default class SecurityBlocklistJobs {
  /*
   * Queues a reconcile of the project's blocklist. Never throws: a block
   * stands whether or not its reconcile could be queued, and the
   * every-minute pass picks it up. Nothing is queued while no kind of
   * destination exists: there is nothing to apply a block at.
   */
  public static async queueReconcile(projectId: ObjectID): Promise<void> {
    if (!SecurityBlockDestinations.hasSources()) {
      return;
    }

    try {
      await Queue.addJob(
        QueueName.Worker,
        `security-blocklist-reconcile-${projectId.toString()}-${ObjectID.generate().toString()}`,
        SECURITY_BLOCKLIST_RECONCILE_JOB,
        { projectId: projectId.toString() },
        {
          deduplication: {
            id: `security-blocklist-reconcile-${projectId.toString()}`,
            keepLastIfActive: true,
          },
          removeWhenDone: true,
          skipExistenceCheck: true,
        },
      );
    } catch (error) {
      logger.error(
        `SecurityBlocklistJobs: could not queue a reconcile of project ${projectId.toString()}'s blocklist; the every-minute pass will reconcile it:`,
      );
      logger.error(error);
    }
  }
}
