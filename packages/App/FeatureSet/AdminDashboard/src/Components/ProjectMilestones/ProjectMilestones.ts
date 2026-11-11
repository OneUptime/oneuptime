import AdminModelAPI from "../../Utils/ModelAPI";
import ProjectMilestone from "Common/Models/DatabaseModels/ProjectMilestone";
import ActivationMilestone, {
  isActivationMilestone,
} from "Common/Types/Analytics/ActivationMilestone";
import Includes from "Common/Types/BaseDatabase/Includes";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";

/*
 * A project's activation milestones as this server keeps them (issue #6830,
 * ProjectMilestone): read here, on the admin's own server, to show which
 * projects are stuck - "No monitor yet", "Nobody reachable yet". Nothing is
 * sent anywhere.
 */

export const PROJECT_MILESTONE_SELECT: {
  projectId: true;
  milestone: true;
  reachedAt: true;
  wasBackfilled: true;
} = {
  projectId: true,
  milestone: true,
  reachedAt: true,
  wasBackfilled: true,
};

// One project's milestones, oldest first.
export const fetchProjectMilestones: (
  projectId: ObjectID,
) => Promise<Array<ProjectMilestone>> = async (
  projectId: ObjectID,
): Promise<Array<ProjectMilestone>> => {
  const result: ListResult<ProjectMilestone> =
    await AdminModelAPI.getList<ProjectMilestone>({
      modelType: ProjectMilestone,
      query: { projectId: projectId },
      limit: LIMIT_MAX,
      skip: 0,
      select: PROJECT_MILESTONE_SELECT,
      sort: {},
    });

  return result.data;
};

/*
 * The milestones each of these projects reached, by project id, in one
 * read: what the Projects list shows a page of projects with.
 */
export const fetchReachedMilestonesByProject: (
  projectIds: Array<ObjectID>,
) => Promise<Dictionary<Array<ActivationMilestone>>> = async (
  projectIds: Array<ObjectID>,
): Promise<Dictionary<Array<ActivationMilestone>>> => {
  const reached: Dictionary<Array<ActivationMilestone>> = {};

  for (const projectId of projectIds) {
    reached[projectId.toString()] = [];
  }

  if (projectIds.length === 0) {
    return reached;
  }

  const result: ListResult<ProjectMilestone> =
    await AdminModelAPI.getList<ProjectMilestone>({
      modelType: ProjectMilestone,
      query: { projectId: new Includes(projectIds) },
      limit: LIMIT_MAX,
      skip: 0,
      select: PROJECT_MILESTONE_SELECT,
      sort: {},
    });

  for (const row of result.data) {
    const projectId: string | undefined = row.projectId?.toString();

    if (projectId && isActivationMilestone(row.milestone)) {
      (reached[projectId] = reached[projectId] || []).push(row.milestone);
    }
  }

  return reached;
};
