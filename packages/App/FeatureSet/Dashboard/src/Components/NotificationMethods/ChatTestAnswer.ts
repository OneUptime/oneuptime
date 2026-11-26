import { JSONObject } from "Common/Types/JSON";
import { UNEXPLAINED_ERROR_MESSAGES } from "Common/Types/Exception/UnexplainedError";

/*
 * WHAT A CHAT TOOL'S SEND TEST ANSWERED.
 *
 * Slack's, Microsoft Teams' and Mattermost's Send Test answer a test that
 * went out and one that did not alike, as a successful request: { ok,
 * statusMessage }, with ok false and the reason when the message was not
 * sent (Common/Server/API/UserSlackAPI and its siblings). Each page read
 * only statusMessage, so a test that failed - the person's account not
 * connected, the app not installed in Teams - was said in a green "sent"
 * toast with the failure's words in it. A failure stays in the page's
 * "Test message not sent" dialog, to be read; only a test that went out is
 * said in the corner.
 */
export interface ChatTestAnswer {
  isSent: boolean;
  message: string;
}

export const readChatTestAnswer: (
  data: JSONObject | undefined,
  // What to say when the test went out and the server said nothing.
  sentMessage: string,
) => ChatTestAnswer = (
  data: JSONObject | undefined,
  sentMessage: string,
): ChatTestAnswer => {
  const statusMessage: string =
    typeof data?.["statusMessage"] === "string"
      ? (data["statusMessage"] as string)
      : "";

  if (data?.["ok"] === false) {
    return {
      isSent: false,
      message: statusMessage || UNEXPLAINED_ERROR_MESSAGES.server,
    };
  }

  return { isSent: true, message: statusMessage || sentMessage };
};
