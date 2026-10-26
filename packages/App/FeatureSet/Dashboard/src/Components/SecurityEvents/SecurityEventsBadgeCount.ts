import { SecurityEventsMenuBadge } from "../../Utils/SecurityEventsNavigation";
import { getSecurityCaseQueueQuery } from "../SecurityCase/SecurityCaseQueueViews";
import { getSecurityPlaybookRunView } from "../SecurityPlaybook/SecurityPlaybookRunViews";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";

export interface SecurityEventsBadgeCount {
  modelType: { new (): BaseModel };
  countQuery: Query<BaseModel>;
  // Unset: a plain grey count, for what is yours rather than what is wrong.
  badgeType?: BadgeType | undefined;
}

/*
 * The live counts beside a Security Events menu entry, each counting what
 * its own page lists, with the page's own query: the open cases beside
 * Open Cases, the open cases assigned to you beside Assigned to Me, and the
 * playbook runs held for an approval beside Approvals. They are
 * read with the person's own permissions, so a role that cannot read cases
 * sees no number at all.
 *
 * Which cases are open is what the project's statuses count as: the case
 * counts wait for them (`statuses`, null until read) and are not drawn
 * before, as the Incidents menu's Active badge waits for its states.
 */
export function getSecurityEventsBadgeCount(
  badge: SecurityEventsMenuBadge | undefined,
  statuses: ReadonlyArray<unknown> | null,
): SecurityEventsBadgeCount | undefined {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  if (!badge || !projectId) {
    return undefined;
  }

  switch (badge) {
    case "openCases":
      if (!statuses) {
        return undefined;
      }

      return {
        modelType: SecurityCase,
        countQuery: {
          projectId: projectId,
          ...getSecurityCaseQueueQuery("open", undefined, statuses),
        } as Query<BaseModel>,
        badgeType: BadgeType.DANGER,
      };
    case "myOpenCases": {
      const userId: ObjectID = User.getUserId();

      // Nobody signed in has no cases of their own to count.
      if (!userId.toString() || !statuses) {
        return undefined;
      }

      return {
        modelType: SecurityCase,
        countQuery: {
          projectId: projectId,
          ...getSecurityCaseQueueQuery("mine", userId, statuses),
        } as Query<BaseModel>,
      };
    }
    case "runsWaitingForApproval":
      return {
        modelType: SecurityPlaybookRun,
        countQuery: {
          projectId: projectId,
          ...getSecurityPlaybookRunView("waiting").query,
        } as Query<BaseModel>,
        badgeType: BadgeType.WARNING,
      };
    default:
      return undefined;
  }
}
