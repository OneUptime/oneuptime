import DataMigrationBase from "./DataMigrationBase";
import HuntressConnectionsToWorkflows, {
  HuntressMoveSummary,
} from "Common/Server/Utils/Huntress/HuntressConnectionsToWorkflows";
import logger from "Common/Server/Utils/Logger";

/*
 * HUNTRESS CONNECTIONS BECOME WORKFLOWS, once.
 *
 * Huntress used to be a connection of its own, under Incidents >
 * Integrations. It is a workflow trigger now, and each connection becomes
 * the workflow that does what it did - same id, same address Huntress posts
 * to (/api/huntress/webhook/<id>), same signing secret, on - with its
 * incidents given their report's number and the deliveries it applied in
 * the last week remembered. What the move does, and why, is in
 * Common/Server/Utils/Huntress/HuntressConnectionsToWorkflows, where it is
 * tested against a migrated Postgres.
 *
 * Never throws for one connection: its failure is logged, the others go on,
 * and the summary says how many moved.
 */
export default class MoveHuntressConnectionsToWorkflows extends DataMigrationBase {
  public constructor() {
    super("MoveHuntressConnectionsToWorkflows");
  }

  public override async migrate(): Promise<void> {
    const summary: HuntressMoveSummary =
      await HuntressConnectionsToWorkflows.moveAll();

    logger.info(
      `MoveHuntressConnectionsToWorkflows: ${summary.moved} Huntress connection(s) moved to workflows, ${summary.alreadyMoved} already moved, ${summary.failed} could not be moved (logged above); ${summary.incidentsLinked} incident(s) given their Huntress report's number; owners of ${summary.ownersTold} project(s) told their plan runs no workflows.`,
    );
  }

  public override async rollback(): Promise<void> {
    // The workflows stay: they are what Huntress is set up with now.
    return;
  }
}
