import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import Exception from "../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../Types/JSON";
import WorkspaceRefusal from "../../../../Utils/Workspace/WorkspaceRefusal";
import ProductBrandingText from "../../ProductBrandingText";
import WorkspaceBase from "../WorkspaceBase";
import MicrosoftTeamsMessageSize from "./MicrosoftTeamsMessageSize";

// What Microsoft answered when it refused a call.
export interface MicrosoftTeamsAnswer {
  statusCode?: number | undefined;
  code?: string | undefined;
  message?: string | undefined;
}

/*
 * A REFUSAL FROM MICROSOFT TEAMS, IN WORDS A PERSON CAN ACT ON (#7119).
 *
 * A post the Bot Framework refuses throws its RestError ("RestError 403
 * ConversationBlockedByUser: User blocked the conversation with the
 * bot."), and a Microsoft Graph call its HTTP error response, whose body
 * holds Graph's code and words ({"error": {"code": "TooManyRequests",
 * "message": "…"}}). Their message reached Notification Logs as it was:
 * Microsoft's words, which say what went wrong for Microsoft, not what to
 * change in OneUptime. They are said in OneUptime's words now, with
 * Microsoft's status, code and words after them (WorkspaceRefusal).
 *
 * What OneUptime threw itself - the app not installed in the team, a
 * shared channel, the roster's answer - is a sentence already, and is
 * said as it is.
 */
export default class MicrosoftTeamsRefusal {
  /*
   * What Microsoft answered: an HTTP status, a code, and its words. Null
   * for an error that is no answer of Microsoft's: one OneUptime threw,
   * or one that carries neither a status nor a code.
   */
  public static getAnswer(error: unknown): MicrosoftTeamsAnswer | null {
    if (!error || typeof error !== "object" || error instanceof Exception) {
      return null;
    }

    const graphError: JSONObject | undefined =
      MicrosoftTeamsRefusal.getGraphError(error as Record<string, unknown>);

    const statusCode: number | undefined =
      MicrosoftTeamsMessageSize.getErrorStatusCode(error);

    const code: string | undefined =
      (typeof graphError?.["code"] === "string" &&
        (graphError["code"] as string)) ||
      MicrosoftTeamsMessageSize.getErrorCode(error);

    if (statusCode === undefined && !code) {
      return null;
    }

    const message: string =
      (typeof graphError?.["message"] === "string" &&
        (graphError["message"] as string)) ||
      String((error as { message?: unknown }).message ?? "");

    return {
      statusCode: statusCode,
      code: code || undefined,
      message: message.trim() || undefined,
    };
  }

  /*
   * What a person reads of a Microsoft Teams call that failed: Microsoft's
   * refusal in OneUptime's words, then Microsoft's answer; anything else
   * as it reads (WorkspaceBase.getSendErrorMessage).
   */
  public static describe(error: unknown): string {
    const answer: MicrosoftTeamsAnswer | null =
      MicrosoftTeamsRefusal.getAnswer(error);

    if (!answer) {
      return WorkspaceBase.getSendErrorMessage(error);
    }

    return ProductBrandingText.brandText(
      WorkspaceRefusal.describeMicrosoftTeamsRefusal(answer),
    );
  }

  // Graph's error, in the body of its HTTP error response: {"error": {"code", "message"}}.
  private static getGraphError(
    error: Record<string, unknown>,
  ): JSONObject | undefined {
    const body: unknown =
      error instanceof HTTPErrorResponse
        ? error.jsonData
        : (error as { body?: unknown }).body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return undefined;
    }

    const graphError: unknown = (body as JSONObject)["error"];

    return graphError &&
      typeof graphError === "object" &&
      !Array.isArray(graphError)
      ? (graphError as JSONObject)
      : undefined;
  }
}
