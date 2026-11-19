import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  ServiceKnowledgeSummary,
  isServiceKnowledgeSummary,
} from "Common/Types/AI/ServiceKnowledgeSummary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { COULD_NOT_READ_KNOWLEDGE } from "./ServiceAiMemoryCopy";

/*
 * WHAT ONEUPTIME AI LEARNED ABOUT A SERVICE, as its page asks for it
 * (Common/Server/API/ServiceKnowledgeAPI, #7672): one request per card,
 * answered with the viewer's own permissions.
 */

export const SERVICE_KNOWLEDGE_API_PATH: string = "/service-knowledge";

export function getServiceKnowledgeUrl(serviceId: ObjectID): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `${SERVICE_KNOWLEDGE_API_PATH}/${serviceId.toString()}`,
  );
}

export class ServiceKnowledgeApiError extends Error {
  public statusCode: number | undefined;

  public constructor(message: string, statusCode?: number | undefined) {
    super(message);
    this.statusCode = statusCode;
  }
}

export default class ServiceKnowledgeApi {
  public static async getSummary(
    serviceId: ObjectID,
  ): Promise<ServiceKnowledgeSummary> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: getServiceKnowledgeUrl(serviceId),
        headers: { ...ModelAPI.getCommonHeaders() },
      });

    if (response instanceof HTTPErrorResponse) {
      throw new ServiceKnowledgeApiError(
        API.getFriendlyMessage(response),
        response.statusCode,
      );
    }

    if (!isServiceKnowledgeSummary(response.data)) {
      throw new ServiceKnowledgeApiError(COULD_NOT_READ_KNOWLEDGE);
    }

    return response.data;
  }
}
