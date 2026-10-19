import { SecurityEventsMenuBadge } from "../../Utils/SecurityEventsNavigation";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import ProjectUtil from "Common/UI/Utils/Project";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import { OPEN_SECURITY_CASE_STATUSES } from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityPlaybookRunStatus from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";

export interface SecurityEventsBadgeCount {
  modelType: { new (): BaseModel };
  countQuery: Query<BaseModel>;
  badgeType: BadgeType;
}

/*
 * The live counts beside a Security Events menu entry or tab: the open
 * cases, and the playbook runs waiting for somebody to approve a step. Both
 * are read with the person's own permissions, so a role that cannot read
 * cases sees no number at all. The side menu and the page tabs count the
 * same way, so the number beside Playbooks is the one on its Playbook Runs
 * tab.
 */
export function getSecurityEventsBadgeCount(
  badge: SecurityEventsMenuBadge | undefined,
): SecurityEventsBadgeCount | undefined {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  if (!badge || !projectId) {
    return undefined;
  }

  switch (badge) {
    case "openCases":
      return {
        modelType: SecurityCase,
        countQuery: {
          projectId: projectId,
          status: new Includes([...OPEN_SECURITY_CASE_STATUSES]),
        } as Query<BaseModel>,
        badgeType: BadgeType.DANGER,
      };
    case "runsWaitingForApproval":
      return {
        modelType: SecurityPlaybookRun,
        countQuery: {
          projectId: projectId,
          status: SecurityPlaybookRunStatus.WaitingForApproval,
        } as Query<BaseModel>,
        badgeType: BadgeType.WARNING,
      };
    default:
      return undefined;
  }
}
