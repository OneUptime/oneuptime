import { MasterApiKeyCopy } from "./MasterApiKeyCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  CreatedMasterApiKey,
  MASTER_API_KEY_ROUTE,
  MasterApiKeyState,
  parseCreatedMasterApiKey,
  parseMasterApiKeyState,
} from "Common/Types/MasterApiKey/MasterApiKeyAnswer";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { translateText } from "Common/UI/Utils/TranslateTemplate";

/*
 * Admin Dashboard > Settings > API Key, over HTTP (#7901): GET and POST
 * /global-config/master-api-key (Types/MasterApiKey/MasterApiKeyAnswer).
 * Whether the server has a master API key, and a new one, which the page
 * shows once and keeps nowhere. A refusal throws, with the server's words
 * for the page to show.
 */

const masterApiKeyUrl: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(new Route(MASTER_API_KEY_ROUTE));
};

const readData: (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => JSONObject = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): JSONObject => {
  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  return response.data as JSONObject;
};

const notAnswered: () => Error = (): Error => {
  return new Error(
    (translateText(MasterApiKeyCopy.notAnswered) as string) ||
      MasterApiKeyCopy.notAnswered,
  );
};

export const fetchMasterApiKeyState: () => Promise<MasterApiKeyState> =
  async (): Promise<MasterApiKeyState> => {
    const state: MasterApiKeyState | null = parseMasterApiKeyState(
      readData(
        await API.fetch<JSONObject>({
          method: HTTPMethod.GET,
          url: masterApiKeyUrl(),
        }),
      ),
    );

    if (!state) {
      throw notAnswered();
    }

    return state;
  };

// A new key, in place of the one before: the only time it is ever sent.
export const createMasterApiKey: () => Promise<CreatedMasterApiKey> =
  async (): Promise<CreatedMasterApiKey> => {
    const created: CreatedMasterApiKey | null = parseCreatedMasterApiKey(
      readData(
        await API.post<JSONObject>({
          url: masterApiKeyUrl(),
          data: {},
        }),
      ),
    );

    if (!created) {
      throw notAnswered();
    }

    return created;
  };
