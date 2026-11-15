import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ActionItemCodeTaskKind } from "Common/Utils/Incident/PostmortemActionItemCodeTask";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The two routes a postmortem's action items have beside the generic ones
 * (IncidentPostmortemActionItemAPI, #6801): track the items the
 * postmortem's note lists, and ask OneUptime AI for an item's pull request
 * or test. A refusal is thrown as the server's answer, for the page to say
 * with API.getFriendlyMessage.
 */

export const POSTMORTEM_ACTION_ITEM_API_PATH: string =
  "/incident-postmortem-action-item";

export interface TrackedFromPostmortem {
  trackedCount: number;
  listedCount: number;
}

async function post(path: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `${POSTMORTEM_ACTION_ITEM_API_PATH}${path}`,
      ),
      data,
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data as JSONObject) || {};
}

export default class PostmortemActionItemsApi {
  /*
   * The note's untracked items become action items; a due day the note gives
   * is placed in the reader's time zone, as the Due Date picker places one.
   */
  public static async trackFromPostmortem(data: {
    incidentId: ObjectID;
    timezone: string;
  }): Promise<TrackedFromPostmortem> {
    const answer: JSONObject = await post("/track-from-postmortem", {
      incidentId: data.incidentId.toString(),
      timezone: data.timezone,
    });

    return {
      trackedCount: Number(answer["trackedCount"]) || 0,
      listedCount: Number(answer["listedCount"]) || 0,
    };
  }

  // OneUptime AI writes the item's pull request, or a test: the task it starts.
  public static async startCodeTask(data: {
    actionItemId: ObjectID;
    kind: ActionItemCodeTaskKind;
    repositoryId: string;
    instructions?: string | undefined;
  }): Promise<{ taskId: string }> {
    const answer: JSONObject = await post("/start-code-task", {
      actionItemId: data.actionItemId.toString(),
      kind: data.kind,
      repositoryId: data.repositoryId,
      ...(data.instructions ? { instructions: data.instructions } : {}),
    });

    return { taskId: String(answer["taskId"] || "") };
  }
}
