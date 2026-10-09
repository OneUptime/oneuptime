import RelationListPermission from "../../Types/Database/Permissions/RelationListPermission";
import type AccessTokenServiceType from "../../Services/AccessTokenService";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
 * runbook's steps (RunbookService) - and the one way each names who may: the
 * read list of RunbookCredential (RelationListPermission.mayReadTable).
 *
 * A WORKFLOW DOES NOT LEND THE READ. A workflow's steps act as a Project Admin
 * of its project (WorkflowPrincipal), and a Project Admin may read runbook
 * credentials - but whoever may edit the workflow decides what its steps do.
 * So a step is answered for the person who last saved the workflow's steps,
 * in the workflow's project, as their permissions are when the step asks
 * (props.workflowSavedByUserId, read with the steps it ran). A workflow whose
 * steps were last saved by nobody - with an API key, or before OneUptime
 * recorded who saved them - may not, until someone who may saves them.
 *
 * A runbook credential a workflow's step names in any write - a cluster's
 * credential, say - is asked of the saver the same way, by the check of the
 * records a write names (RelationListPermission, isAskedOfWorkflowSaver).
 *
 * It imports no service at load time (the saver's permissions are read
 * through AccessTokenService when a step asks), so DatabaseService's own
 * checks, and any service, may ask it.
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
    return props.userType === UserType.Workflow;
  }

  /*
   * Whether a write that names a record of `modelType` - a cluster's
   * credential, say (RelationListPermission's check of the records a
   * write names) - is answered by this rule rather than by the step's own
   * read of the table: a runbook credential named by a workflow's step.
   */
  public static isAskedOfWorkflowSaver(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return (
      !props.isRoot &&
      !props.isMasterAdmin &&
      RunbookCredentialReaders.isWorkflowStep(props) &&
      new modelType().tableName === new RunbookCredential().tableName
    );
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
   * The person who last saved the steps of the workflow a step belongs to, as they are in
   * the step's project now - or null when the workflow names nobody, or the
   * step no project.
   */
  private static async getWorkflowSaverProps(
    props: DatabaseCommonInteractionProps,
  ): Promise<DatabaseCommonInteractionProps | null> {
    if (!props.tenantId || !props.workflowSavedByUserId) {
      return null;
    }

    /*
     * Required here, when a step asks, rather than imported at the top as
     * every other import is: loaded at the top it stops the server from
     * loading at all. DatabaseService loads RelationListPermission, which
     * loads this file (a runbook credential a workflow's step names is
     * asked of its saver: isAskedOfWorkflowSaver), and AccessTokenService
     * loads the team services, whose classes extend DatabaseService before
     * it is defined ("Class extends value undefined").
     */
    const accessTokenService: typeof AccessTokenServiceType =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/AccessTokenService").default;

    const saverProps: DatabaseCommonInteractionProps =
      await accessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
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
