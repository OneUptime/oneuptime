import { APP_API_URL } from "Common/UI/Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  INVITE_SUGGESTIONS_ROUTE,
  InviteSuggestion,
  readInviteSuggestionsAnswer,
} from "Common/Types/Team/InviteSuggestions";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The people an invitation's email box suggests for what was typed, as the
 * server finds them for this reader (#9701, Common/Types/Team/
 * InviteSuggestions): the project's people, and on a server somebody runs
 * its other accounts for its master admin, or for anyone who may invite
 * while the server lets them (#9744), each with where they stand for the
 * team the invitation is for. A refusal or a failure is thrown, for the
 * box to suggest nothing: typing an address works without it.
 */
export default class InviteSuggestionsApi {
  public static async suggest(data: {
    text: string;
    teamId?: string | null | undefined;
  }): Promise<Array<InviteSuggestion>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          INVITE_SUGGESTIONS_ROUTE,
        ),
        data: {
          text: data.text,
          ...(data.teamId ? { teamId: data.teamId } : {}),
        },
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readInviteSuggestionsAnswer(response.data);
  }
}
