import { AdaptiveCard } from "adaptivecards";
import URL from "../../../../Types/API/URL";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import API from "../../../API/API";
import logger from "../../../Utils/Logger";

export default class MicrosoftTeamsUtil {
  public static async sendMessageToChannelViaIncomingWebhook(data: {
    url: URL;
    text: string;
  }): Promise<void> {
    try {
      const response: HTTPResponse<any> | HTTPErrorResponse = await API.fetch(
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
        throw response;
      }

      logger.debug("Message sent to Microsoft Teams channel successfully");
    } catch (err) {
      logger.error("Error sending message to Microsoft Teams channel:");
      logger.error(err);
      throw err;
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