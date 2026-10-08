import RelationListPermission from "../../Types/Database/Permissions/RelationListPermission";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PermissionHelper } from "../../../Types/Permission";

/*
 * WHO MAY LET A COMMAND RUN WITH A RUNBOOK CREDENTIAL: WHOEVER MAY READ
 * RUNBOOK CREDENTIALS.
 *
 * The one answer every check of it gives - approving an AI command plan and
 * saving a rule that runs OneUptime AI's commands without asking
 * (AiRemediationCredentialUse), turning on a Runner's "Runs AI Remediation
 * Commands" (RunnerService) - and the one way each names who may: the read
 * list of RunbookCredential (RelationListPermission.mayReadTable). It imports
 * no service, so a service may ask it too.
 */
export default class RunbookCredentialReaders {
  // Whether `props` may read runbook credentials, so let commands use them.
  public static mayRead(props: DatabaseCommonInteractionProps): boolean {
    return RelationListPermission.mayReadTable(RunbookCredential, props);
  }

  // The permissions that read runbook credentials, by title.
  public static getTitles(): string {
    return PermissionHelper.getPermissionTitles(
      new RunbookCredential().getReadPermissions(),
    ).join(", ");
  }
}
