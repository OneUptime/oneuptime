import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import logger from "../../Logger";
import WorkspaceBase  from "../WorkspaceBase";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class MicrosoftTeams extends WorkspaceBase {



  @CaptureSpan()
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    logger.debug("Sending message to Teams channel via incoming webhook:");
    logger.debug(data);

    // Microsoft Teams webhook format
    const payload = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      text: data.text,
    };

    const apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null =
      await API.post(data.url, payload);

    if (!apiResult) {
      logger.error("Could not send message to Teams channel via incoming webhook.");
      throw new Error("Could not send message to Teams channel via incoming webhook.");
    }

    if (apiResult instanceof HTTPErrorResponse) {
      logger.error("Error sending message to Teams channel via incoming webhook:");
      logger.error(apiResult);
      throw apiResult;
    }

    logger.debug("Message sent to Teams channel via incoming webhook successfully:");
    logger.debug(apiResult);
    
    return apiResult;
  }

  public static isValidMicrosoftTeamsIncomingWebhookUrl(
    incomingWebhookUrl: URL,
  ): boolean {
    // Check if the URL contains outlook.office.com or office.com webhook pattern
    const urlString = incomingWebhookUrl.toString();
    return urlString.includes("outlook.office.com") || urlString.includes("office.com");
  }
}
