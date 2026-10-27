import { SecurityApiError } from "../SecurityCaseApi";
import {
  parseSecurityCaseImpact,
  parseSecurityCaseStory,
} from "./SecurityCaseContextModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_CASE_IMPACT_API_PATH,
  SECURITY_CASE_STORY_API_PATH,
  SecurityCaseImpactJson,
  SecurityCaseStoryJson,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * A case's Story and Impact, from Common/Server/API/SecurityCaseContextAPI.ts.
 * Each answer is read defensively (SecurityCaseContextModel), and a refusal or
 * failure comes back as the API's sentence with its status, as the rest of
 * the Security product's routes do (SecurityApiError).
 */

async function post(route: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data: data,
      headers: { ...ModelAPI.getCommonHeaders() },
    });

  if (response instanceof HTTPErrorResponse) {
    throw new SecurityApiError(
      API.getFriendlyMessage(response),
      response.statusCode,
    );
  }

  const body: JSONValue = response.data as JSONValue;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

export default class SecurityCaseContextApi {
  public static async getStory(
    caseId: ObjectID,
  ): Promise<SecurityCaseStoryJson> {
    return parseSecurityCaseStory(
      await post(SECURITY_CASE_STORY_API_PATH, { caseId: caseId.toString() }),
    );
  }

  public static async getImpact(
    caseId: ObjectID,
  ): Promise<SecurityCaseImpactJson> {
    return parseSecurityCaseImpact(
      await post(SECURITY_CASE_IMPACT_API_PATH, { caseId: caseId.toString() }),
    );
  }
}
