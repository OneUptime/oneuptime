import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";
import { APP_API_URL } from "../Config";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import {
  INVITE_SUGGESTIONS_ROUTE,
  InviteSuggestion,
  getInviteSuggestionsInProjectRoute,
  readInviteSuggestionsAnswer,
} from "../../Types/Team/InviteSuggestions";

/*
 * The people an invitation's email box suggests for what was typed, as the
 * server finds them for this reader (#9701, Common/Types/Team/
 * InviteSuggestions): the project's people, and on a server somebody runs
 * its other accounts for its master admin, or for anyone who may invite
 * while the server lets them (#9744), each with where they stand for the
 * team the invitation is for. A refusal or a failure is thrown, for the
 * box to suggest nothing: typing an address works without it.
 *
 * Asked in the request's own project - the Dashboard's, named by its
 * tenant header - or, for a page that works in no project, in the one it
 * names (the Admin Dashboard, #9826): through the master admins' route,
 * which takes the project from its path, with no tenant.
 */
export default class InviteSuggestionsApi {
  public static async suggest(data: {
    text: string;
    teamId?: string | null | undefined;
    // The project, from a page that works in none (the Admin Dashboard).
    projectId?: string | null | undefined;
  }): Promise<Array<InviteSuggestion>> {
    const projectId: string = (data.projectId || "").trim();

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          projectId
            ? getInviteSuggestionsInProjectRoute(projectId)
            : INVITE_SUGGESTIONS_ROUTE,
        ),
        data: {
          text: data.text,
          ...(data.teamId ? { teamId: data.teamId } : {}),
        },
        headers: projectId ? {} : ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readInviteSuggestionsAnswer(response.data);
  }
}
