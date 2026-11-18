import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";
import { APP_API_URL } from "../Config";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import {
  PROJECT_MEMBER_SEARCH_ROUTE,
  ProjectMemberSearchMatch,
  readProjectMemberSearchAnswer,
} from "../../Types/Team/ProjectMemberSearch";

/*
 * The current project's people whose name or email holds what was typed,
 * as the server finds them for this reader (#7036, Types/Team/
 * ProjectMemberSearch): Search's Users results. A refusal or a failure is
 * thrown, for the caller to show nothing.
 */
export default class ProjectMemberSearch {
  public static async search(
    text: string,
  ): Promise<Array<ProjectMemberSearchMatch>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          PROJECT_MEMBER_SEARCH_ROUTE,
        ),
        data: { text: text },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readProjectMemberSearchAnswer(response.data);
  }
}
