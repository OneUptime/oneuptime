import DataMigrationBase from "./DataMigrationBase";
import RunbookCredentialsRemoval, {
  RunbookCredentialsRemovalSummary,
} from "Common/Server/Utils/Runbook/RunbookCredentialsRemoval";
import logger from "Common/Server/Utils/Logger";

/*
 * RUNBOOK CREDENTIALS ARE REMOVED, once.
 *
 * Runbooks > Runners > AI Access - the runbook credentials OneUptime AI's
 * own commands reached a host or a cluster with through a Runner - is gone:
 * hosts and Kubernetes clusters have AI agents of their own, and runbook
 * steps sign in with runbook variables. This moves the runbook steps that
 * still name a credential to variables, clears the clusters bound to a
 * Runner outside them, and deletes every credential. What it does, and why,
 * is in Common/Server/Utils/Runbook/RunbookCredentialsRemoval, where it is
 * tested against a migrated Postgres.
 *
 * Never throws: a step that fails is logged, and the summary says what was
 * done.
 */
export default class RemoveRunbookCredentials extends DataMigrationBase {
  public constructor() {
    super("RemoveRunbookCredentials");
  }

  public override async migrate(): Promise<void> {
    const summary: RunbookCredentialsRemovalSummary =
      await RunbookCredentialsRemoval.removeAll();

    logger.info(
      `RemoveRunbookCredentials: ${summary.move?.credentialsMoved ?? 0} credential(s) runbook steps still named moved to variables; ${summary.move?.stepsMoved ?? 0} step(s) of ${summary.move?.runbooksRewritten ?? 0} runbook(s) rewritten; ${summary.clusterBindingsCleared} Kubernetes cluster(s) bound to a Runner outside them cleared; ${summary.credentialsDeleted} runbook credential(s) deleted${
        summary.failedSteps.length > 0
          ? `; failed: ${summary.failedSteps.join(", ")} (logged above)`
          : ""
      }.`,
    );
  }

  public override async rollback(): Promise<void> {
    // The credentials are gone: there is nothing to put back.
    return;
  }
}
