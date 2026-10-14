import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupConnectRequest,
  WorkspaceUserGroupTeam,
  WorkspaceUserGroupView,
} from "Common/Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The routes the schedule page's user group card calls
 * (Common/Server/API/WorkspaceUserGroupAPI). Every method throws the
 * server's answer on failure, for the card to show through
 * API.getFriendlyMessage.
 */
export const USER_GROUP_API_PATH: string = "/workspace-user-group";

export interface AvailableUserGroups {
  groups: Array<WorkspaceAvailableUserGroup>;
  teams: Array<WorkspaceUserGroupTeam>;
}

const getUrl: (route: string) => URL = (route: string): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${USER_GROUP_API_PATH}${route}`,
  );
};

export default class UserGroupsAPI {
  // The groups that follow a schedule, as the card draws them.
  public static async getForSchedule(
    scheduleId: string,
  ): Promise<Array<WorkspaceUserGroupView>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: getUrl(`/schedule/${scheduleId}`),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return ((response.data["userGroups"] as JSONArray | undefined) ||
      []) as unknown as Array<WorkspaceUserGroupView>;
  }

  // What the Connect form offers in a workspace (and a Teams team's tags).
  public static async getAvailable(data: {
    workspaceType: WorkspaceType;
    teamId?: string | undefined;
  }): Promise<AvailableUserGroups> {
    let url: URL = getUrl("/available").addQueryParam(
      "workspaceType",
      data.workspaceType,
      true,
    );

    if (data.teamId) {
      url = url.addQueryParam("teamId", data.teamId, true);
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: url,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return {
      groups: ((response.data["groups"] as JSONArray | undefined) ||
        []) as unknown as Array<WorkspaceAvailableUserGroup>,
      teams: ((response.data["teams"] as JSONArray | undefined) ||
        []) as unknown as Array<WorkspaceUserGroupTeam>,
    };
  }

  public static async connect(
    request: WorkspaceUserGroupConnectRequest,
  ): Promise<WorkspaceUserGroupView> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: getUrl("/connect"),
        data: request as unknown as JSONObject,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return response.data["userGroup"] as unknown as WorkspaceUserGroupView;
  }

  public static async disconnect(data: {
    workspaceUserGroupId: string;
    scheduleId: string;
  }): Promise<void> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: getUrl("/disconnect"),
        data: {
          workspaceUserGroupId: data.workspaceUserGroupId,
          onCallDutyPolicyScheduleId: data.scheduleId,
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }
  }

  // Try again: the group looked at now.
  public static async syncAgain(data: {
    workspaceUserGroupId: string;
    scheduleId: string;
  }): Promise<WorkspaceUserGroupView> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: getUrl(`/sync/${data.workspaceUserGroupId}`),
        data: {
          onCallDutyPolicyScheduleId: data.scheduleId,
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return response.data["userGroup"] as unknown as WorkspaceUserGroupView;
  }
}
