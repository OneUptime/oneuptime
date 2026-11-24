import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  AutomaticTrustedProxies,
  readAutomaticTrustedProxies,
} from "Common/Types/SecurityEvent/AutomaticTrustedProxies";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What Security Events trusts as a proxy without being listed (#10546), as
 * the server answers it (Server/API/SecurityTrustedProxiesAPI): the edges
 * the project connected, and its own application load balancers as the
 * reader may read them. Throws the server's error, for the card to say.
 */
export async function fetchAutomaticTrustedProxies(): Promise<AutomaticTrustedProxies> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(AUTOMATIC_TRUSTED_PROXIES_PATH),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readAutomaticTrustedProxies(response.data);
}
