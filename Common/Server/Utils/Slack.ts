import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";

export default class SlackUtil {


  public async getTextboxField(data: {
    title: string;
    placeholder: string;
    actionId: string;
    initialValue?: string;
  }): Promise<JSONObject> {
    return {
      type: "input",
      element: {
        type: "plain_text_input",
        action_id: data.actionId,
        placeholder: {
          type: "plain_text",
          text: data.placeholder,
        },
        initial_value: data.initialValue,
      },
      label: {
        type: "plain_text",
        text: data.title,
      },
    };
  };

  public getButtonField(data: {
    text: string;
    actionId: string;
    value: string;
  }): JSONObject {
    return {
      type: "button",
      text: {
        type: "plain_text",
        text: data.text,
      },
      action_id: data.actionId,
      value: data.value,
    };
  }

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
