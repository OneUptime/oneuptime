import { ApiKeyShownOnceCopy } from "./ApiKeyShownOnceCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  getResetApiKeyRoute,
  parseResetApiKeyAnswer,
  ResetApiKeyAnswer,
} from "Common/Types/ApiKey/ApiKeyShownOnce";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translateText } from "Common/UI/Utils/TranslateTemplate";

/*
 * Reset API Key, over HTTP (#8902): POST /api-key/:id/reset-key
 * (Types/ApiKey/ApiKeyShownOnce). A new key in place of the key's current
 * one, answered once: the page shows it once and keeps it nowhere. A
 * refusal throws, with the server's words for the page to show.
 */
export const resetApiKey: (
  apiKeyId: ObjectID,
) => Promise<ResetApiKeyAnswer> = async (
  apiKeyId: ObjectID,
): Promise<ResetApiKeyAnswer> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        new Route(getResetApiKeyRoute(apiKeyId)),
      ),
      data: {},
      /*
       * The tenantid header is what the server resolves this request's
       * project permissions from: API.post does not add it as ModelAPI does.
       */
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  const answer: ResetApiKeyAnswer | null = parseResetApiKeyAnswer(
    response.data,
  );

  if (!answer) {
    throw new Error(
      (translateText(ApiKeyShownOnceCopy.notAnswered) as string) ||
        ApiKeyShownOnceCopy.notAnswered,
    );
  }

  return answer;
};
