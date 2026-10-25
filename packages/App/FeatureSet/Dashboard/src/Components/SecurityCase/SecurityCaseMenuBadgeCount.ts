import { SecurityCaseMenuBadge } from "../../Utils/SecurityCaseNavigation";
import { getSecurityPlaybookRunView } from "../SecurityPlaybook/SecurityPlaybookRunViews";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import ProjectUtil from "Common/UI/Utils/Project";

export interface SecurityCaseMenuBadgeCount {
  modelType: { new (): BaseModel };
  countQuery: Query<BaseModel>;
  badgeType: BadgeType;
}

/*
 * The live count beside an entry of a case's side menu: what on this case
 * waits for somebody. Beside Playbook Runs, the case's runs held for an
 * approval - the same runs Security Events > Approvals lists,
 * on this case only - in the warning colour that list's own count has: a
 * held run does nothing until somebody decides. Read with the person's own
 * permissions, so a role that cannot read runs sees no number at all.
 */
export function getSecurityCaseMenuBadgeCount(
  badge: SecurityCaseMenuBadge | undefined,
  caseId: ObjectID,
): SecurityCaseMenuBadgeCount | undefined {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  if (!badge || !projectId || !caseId.toString()) {
    return undefined;
  }

  switch (badge) {
    case "runsWaitingForApproval":
      return {
        modelType: SecurityPlaybookRun,
        countQuery: {
          projectId: projectId,
          securityCaseId: caseId.toString(),
          ...getSecurityPlaybookRunView("waiting").query,
        } as Query<BaseModel>,
        badgeType: BadgeType.WARNING,
      };
    default:
      return undefined;
  }
}
