import DataMigrationBase from "./DataMigrationBase";
import RunbookApprovalsMove, {
  RunbookApprovalsMoveSummary,
} from "Common/Server/Utils/Runbook/RunbookApprovalsMove";
import logger from "Common/Server/Utils/Logger";

/*
 * A RUNBOOK STEP ASKS FOR APPROVAL BEFORE IT RUNS, once for every stored
 * runbook.
 *
 * The approval switch used to sit on the step before the one it held back
 * ("Require approval before running the next step"); it sits on the step it
 * guards now ("Require approval before running this step"). Every stored
 * runbook is written the new way so it runs exactly as it did: an approval
 * after step N becomes an approval before step N+1, and one after the last
 * step a Manual step at the end that stops the run in the same place. Runs
 * already started keep their own copy of the steps and finish as they
 * started. What the move does, and why, is in
 * Common/Server/Utils/Runbook/RunbookApprovalsMove, where it is tested
 * against a migrated Postgres.
 *
 * Never throws for one runbook: its failure is logged, the others go on,
 * and the summary says how much moved. A failure to read the runbooks at
 * all stops the chain, so the move is tried again on the next start.
 */
export default class MoveRunbookApprovalsBeforeTheirSteps extends DataMigrationBase {
  public constructor() {
    super("MoveRunbookApprovalsBeforeTheirSteps");
  }

  public override async migrate(): Promise<void> {
    const summary: RunbookApprovalsMoveSummary =
      await RunbookApprovalsMove.moveAll();

    logger.info(
      `MoveRunbookApprovalsBeforeTheirSteps: ${summary.approvalsMoved} approval(s) of ${summary.runbooksMoved} runbook(s) moved before the step they guard, ${summary.approvalStepsAdded} of them after a last step became a Manual step at the end; ${summary.runbooksChangedMeanwhile} runbook(s) saved meanwhile were left as saved; ${summary.runbooksFailed} runbook(s) could not be moved (logged above).`,
    );
  }

  public override async rollback(): Promise<void> {
    // The approvals stay before their steps: that is what runbooks run with now.
    return;
  }
}
