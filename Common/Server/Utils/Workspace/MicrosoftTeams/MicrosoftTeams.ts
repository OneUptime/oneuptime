import URL from "../../../../Types/API/URL";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import API from "../../../../Utils/API";
import logger from "../../Logger";
import WorkspaceBase from "../WorkspaceBase";
import { JSONObject } from "../../../../Types/JSON";

export default class MicrosoftTeamsWorkspace extends WorkspaceBase {
  public static override async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.fetch(
        HTTPMethod.POST,
        data.url,
        {
          type: "message",
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              contentUrl: null,
              content: {
                $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                type: "AdaptiveCard",
                version: "1.2",
                body: [
                  {
                    type: "TextBlock",
                    text: data.text,
                    wrap: true,
                    markdown: true,
                  },
                ],
              },
            },
          ],
        }
      );

      if (response instanceof HTTPErrorResponse) {
        return response;
      }

      logger.debug("Message sent to Microsoft Teams channel successfully");
      return response;
    } catch (err) {
      logger.error("Error sending message to Microsoft Teams channel:");
      logger.error(err);
      
      if (err instanceof HTTPErrorResponse) {
        return err;
      }
      
      return new HTTPErrorResponse(
        500,
        {
          message: "Failed to send message to Microsoft Teams channel",
        },
        {}
      );
    }
  }

  public static convertMarkdownToTeamsRichText(markdown: string): string {
    // Microsoft Teams supports a subset of Markdown in Adaptive Cards
    // Convert common markdown elements to Teams-supported format
    let teamsText: string = markdown;

    // Convert headers
    teamsText = teamsText.replace(/^### (.*$)/gim, "**$1**");
    teamsText = teamsText.replace(/^## (.*$)/gim, "**$1**");
    teamsText = teamsText.replace(/^# (.*$)/gim, "**$1**");

    // Links are supported as-is in Teams markdown
    // Bold and italic are supported as-is

    // Convert bullet points
    teamsText = teamsText.replace(/^\* /gm, "• ");
    teamsText = teamsText.replace(/^- /gm, "• ");

    // Remove HTML if any
    teamsText = teamsText.replace(/<[^>]*>/g, "");

    return teamsText;
  }
}