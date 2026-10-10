import RelationListPermission from "../../Types/Database/Permissions/RelationListPermission";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import WorkflowPrincipal from "../Workflow/WorkflowPrincipal";

/*
 * WHO MAY LET A COMMAND RUN WITH A RUNBOOK CREDENTIAL: WHOEVER MAY READ
 * RUNBOOK CREDENTIALS.
 *
 * The one answer every check of it gives - approving an AI command plan and
 * saving a rule that runs OneUptime AI's commands without asking
 * (AiRemediationCredentialUse), turning on a Runner's "Runs AI Remediation
 * Commands" and assigning an SSH credential to a Runner that has it on
 * (RunnerService, RunbookCredentialService), naming a credential in a
 * runbook's steps (RunbookService), binding one to a cluster for its AI
 * agent (KubernetesClusterService) - and the one way each names who may:
 * the read list of RunbookCredential (RelationListPermission.mayReadTable).
 * It imports no service, so a service may ask it too.
 *
 * A WORKFLOW'S STEP NEVER HAS IT. A step acts as a Project Admin of its
 * project (WorkflowPrincipal), and a Project Admin may read runbook
 * credentials - but whoever may edit a workflow decides what its steps do,
 * and whatever its variables, webhooks and runs hand them. So the read of a
 * setting that holds credentials is not lent to a step
 * (RelationListPermission.mayReadTable answers no for one), and a change
 * that takes it has to be made by a person who has it (getWorkflowNote).
 * No workflow step writes a Runner, a runbook credential, an auto
 * remediation rule, a runbook or a cluster today; the rule holds for any
 * that ever does.
 */
export default class RunbookCredentialReaders {
  // Whether `props` may read runbook credentials, so let commands use them.
  public static mayRead(props: DatabaseCommonInteractionProps): boolean {
    return RelationListPermission.mayReadTable(RunbookCredential, props);
  }

  // The permissions that read runbook credentials: RunbookCredential's read list.
  public static getReadPermissions(): Array<Permission> {
    return new RunbookCredential().getReadPermissions();
  }

  // The permissions that read runbook credentials, by title.
  public static getTitles(): string {
    return PermissionHelper.getPermissionTitles(
      RunbookCredentialReaders.getReadPermissions(),
    ).join(", ");
  }

  /*
   * What a refusal adds for a workflow's step: that no step has the
   * permission, so a person has to make the change. Nothing for anyone
   * else.
   */
  public static getWorkflowNote(props: DatabaseCommonInteractionProps): string {
    if (!WorkflowPrincipal.isWorkflow(props)) {
      return "";
    }

    return ` ${RunbookCredentialReaders.WORKFLOW_NOTE}`;
  }

  public static readonly WORKFLOW_NOTE: string =
    "Workflow steps never have this permission, so a person who has it has to make this change.";
}
