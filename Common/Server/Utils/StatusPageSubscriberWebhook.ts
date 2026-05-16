import API from "../../Utils/API";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import logger from "./Logger";

export interface StatusPageWebhookPayload extends JSONObject {
  eventType: string;
  statusPageId: string;
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
  data: JSONObject;
}

export default class StatusPageSubscriberWebhookUtil {
  public static async sendWebhookNotification(data: {
    webhookUrl: URL;
    payload: StatusPageWebhookPayload;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending status page subscriber webhook notification.");

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: data.webhookUrl,
        data: data.payload,
        options: {
          retries: 3,
          exponentialBackoff: true,
        },
      });

    logger.debug("Status page subscriber webhook response:");
    logger.debug(apiResult);

    return apiResult;
  }
}
