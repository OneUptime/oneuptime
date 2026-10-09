import RelationListPermission from "../../Types/Database/Permissions/RelationListPermission";
import AccessTokenService from "../../Services/AccessTokenService";
import WorkflowPrincipal from "../Workflow/WorkflowPrincipal";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PermissionHelper } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

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
 *
 * A WORKFLOW DOES NOT LEND THE READ. A workflow's steps act as a Project Admin
 * of its project (WorkflowPrincipal), and a Project Admin may read runbook
 * credentials - but whoever may edit the workflow decides what its steps do.
 * So a step is answered for the person who last saved the workflow's steps,
 * in the workflow's project, as their permissions are there when the step
 * asks (props.workflowSavedByUserId, read with the steps it ran): what they
 * may do elsewhere - as a server admin, say - is not lent to the step
 * either. A workflow whose steps were last saved by nobody - with an API
 * key, or before OneUptime recorded who saved them - may not, until someone
 * who may saves them.
 */
export default class RunbookCredentialReaders {
  // Whether `props` may read runbook credentials, so let commands use them.
  public static async mayRead(
    props: DatabaseCommonInteractionProps,
  ): Promise<boolean> {
    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    if (!RunbookCredentialReaders.isWorkflowStep(props)) {
      return RelationListPermission.mayReadTable(RunbookCredential, props);
    }

    const saverProps: DatabaseCommonInteractionProps | null =
      await RunbookCredentialReaders.getWorkflowSaverProps(props);

    return (
      saverProps !== null &&
      RelationListPermission.mayReadTable(RunbookCredential, saverProps)
    );
  }

  // Whether `props` are a workflow step's (WorkflowPrincipal).
  public static isWorkflowStep(props: DatabaseCommonInteractionProps): boolean {
    return WorkflowPrincipal.isWorkflow(props);
  }

  // The permissions that read runbook credentials, by title.
  public static getTitles(): string {
    return PermissionHelper.getPermissionTitles(
      new RunbookCredential().getReadPermissions(),
    ).join(", ");
  }

  /*
   * What a refusal adds for a workflow's step: whose permission it was asked
   * about, and how to let the workflow do it. Nothing for anyone else.
   */
  public static getWorkflowNote(props: DatabaseCommonInteractionProps): string {
    if (!RunbookCredentialReaders.isWorkflowStep(props)) {
      return "";
    }

    return " A workflow's step has this permission only when the person who last saved the workflow's steps has it, and they do not. Ask someone who has it to save the workflow's steps.";
  }

  /*
   * The person who last saved the steps of the workflow a step belongs to,
   * as they are in the step's project now - or null when the workflow names
   * nobody, or the step no project.
   */
  private static async getWorkflowSaverProps(
    props: DatabaseCommonInteractionProps,
  ): Promise<DatabaseCommonInteractionProps | null> {
    if (!props.tenantId || !props.workflowSavedByUserId) {
      return null;
    }

    const saverProps: DatabaseCommonInteractionProps =
      await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
        {
          userId: props.workflowSavedByUserId,
          projectId: props.tenantId,
        },
      );

    return {
      ...saverProps,
      userType: UserType.User,
    };
  }
}
