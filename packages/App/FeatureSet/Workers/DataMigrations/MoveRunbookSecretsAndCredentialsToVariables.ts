import DataMigrationBase from "./DataMigrationBase";
import RunbookVariablesMove, {
  RunbookVariablesMoveSummary,
} from "Common/Server/Utils/Runbook/RunbookVariablesMove";
import logger from "Common/Server/Utils/Logger";

/*
 * RUNBOOK SECRETS AND THE CREDENTIALS RUNBOOK STEPS USED BECOME VARIABLES,
 * once.
 *
 * Runbook variables took the place of runbook secrets and of the
 * credentials SSH and Kubernetes steps named. Every secret becomes a secret
 * global variable of the same name; every credential a step names becomes
 * the secret variables its key, password or kubeconfig went into; and every
 * step is rewritten to use them - an SSH step signs in with the variable and
 * runs its command as its script, a Kubernetes step runs the kubectl command
 * its action made - so every runbook keeps running as it did. What the move
 * does, and why, is in Common/Server/Utils/Runbook/RunbookVariablesMove,
 * where it is tested against a migrated Postgres.
 *
 * Never throws for one project: its failure is logged, the others go on,
 * and the summary says how much moved.
 */
export default class MoveRunbookSecretsAndCredentialsToVariables extends DataMigrationBase {
  public constructor() {
    super("MoveRunbookSecretsAndCredentialsToVariables");
  }

  public override async migrate(): Promise<void> {
    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll();

    logger.info(
      `MoveRunbookSecretsAndCredentialsToVariables: ${summary.secretsMoved} runbook secret(s) moved to variables, ${summary.secretsAlreadyMoved} already moved, ${summary.secretsSkipped} with no value skipped; ${summary.credentialsMoved} credential(s) runbook steps named moved to variables; ${summary.stepsMoved} step(s) of ${summary.runbooksRewritten} runbook(s) rewritten; ${summary.projectsFailed} project(s) could not be moved (logged above).`,
    );
  }

  public override async rollback(): Promise<void> {
    // The variables stay: they are what runbooks run with now.
    return;
  }
}
