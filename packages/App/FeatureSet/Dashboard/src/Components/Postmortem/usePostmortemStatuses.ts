import IncidentPostmortemStatus from "Common/Models/DatabaseModels/IncidentPostmortemStatus";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";
import {
  PostmortemStatusChoice,
  toPostmortemStatusChoices,
} from "./PostmortemStatusChoices";

export interface PostmortemStatusesState {
  // Every status, archived ones too, top first, with what each counts as.
  choices: Array<PostmortemStatusChoice>;
  // Whether the request has answered, with statuses, none or an error.
  hasLoaded: boolean;
}

/*
 * What a status is read with: what the pills, the menu, the filter and the
 * counts draw, and the built-in flags and the place that decide what each
 * counts as. Archived ones are read too (isArchived): incidents in them keep
 * them, and the pickers leave them out of what a postmortem can move to.
 */
export const POSTMORTEM_STATUS_SELECT: Record<string, true> = {
  _id: true,
  name: true,
  description: true,
  color: true,
  order: true,
  isNotStartedStatus: true,
  isDraftStatus: true,
  isCompletedStatus: true,
  isArchived: true,
};

// The project's postmortem statuses, top first.
export const loadPostmortemStatusChoices: (
  projectId: ObjectID,
) => Promise<Array<PostmortemStatusChoice>> = async (
  projectId: ObjectID,
): Promise<Array<PostmortemStatusChoice>> => {
  const result: ListResult<IncidentPostmortemStatus> =
    await ModelAPI.getList<IncidentPostmortemStatus>({
      modelType: IncidentPostmortemStatus,
      query: {
        projectId: projectId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: POSTMORTEM_STATUS_SELECT,
      sort: {
        order: SortOrder.Ascending,
      },
    });

  return toPostmortemStatusChoices(result.data);
};

/*
 * The project's postmortem statuses, loaded once when a page that shows them
 * opens. Best effort: a page whose statuses cannot be read shows a
 * postmortem's status as the incident holds it, and offers no menu to move
 * it - nothing pops up over the page about it.
 */
export default function usePostmortemStatuses(): PostmortemStatusesState {
  const [state, setState] = useState<PostmortemStatusesState>({
    choices: [],
    hasLoaded: false,
  });

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setState({ choices: [], hasLoaded: true });
      return;
    }

    let isCancelled: boolean = false;

    loadPostmortemStatusChoices(projectId)
      .then((choices: Array<PostmortemStatusChoice>) => {
        if (!isCancelled) {
          setState({ choices: choices, hasLoaded: true });
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setState({ choices: [], hasLoaded: true });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return state;
}
