import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  MAX_CHECKED_TEXT_LENGTH,
  SECURITY_LOG_LINE_CHECK_PATH,
  SecurityLogLineCheckResult,
  readSecurityLogLineCheckResult,
} from "Common/Types/SecurityEvent/SecurityLogLineCheck";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * What pasted lines become, as the server reads them with the project's
 * trusted proxies (#11046, Server/API/SecurityTrustedProxiesAPI): the
 * events a scan would store of them, and why each proxy they came through
 * is trusted. Throws the server's error, for the check to say.
 */
export async function fetchSecurityLogLineCheck(
  text: string,
): Promise<SecurityLogLineCheckResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(SECURITY_LOG_LINE_CHECK_PATH),
      headers: ModelAPI.getCommonHeaders(),
      data: { text: text.slice(0, MAX_CHECKED_TEXT_LENGTH) },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readSecurityLogLineCheckResult(response.data);
}
