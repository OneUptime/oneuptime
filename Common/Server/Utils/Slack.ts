import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";

export default class SlackUtil {
  public static async sendMessageToChannel(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    let apiResult: HTTPResponse<JSONObject> | HTTPErrorResponse | null = null;

    // https://api.slack.com/messaging/webhooks#advanced_message_formatting
    apiResult = await API.post(data.url, {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${data.text}`,
          },
        },
      ],
    });

    return apiResult;
  }
}
