import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import { JSONObject } from "../../../../Types/JSON";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceRefusal, {
  WorkspaceRefusalReading,
} from "../../../../Utils/Workspace/WorkspaceRefusal";
import ProductBrandingText from "../../ProductBrandingText";
import WorkspaceBase from "../WorkspaceBase";

/*
 * A REFUSAL FROM SLACK, THROWN IN WORDS A PERSON CAN ACT ON (#7119).
 *
 * Slack answers a call it refuses with {"ok": false, "error": "<code>"}.
 * Each such answer used to be thrown as "Error from Slack <code>", in some
 * 25 places, and reached Notification Logs, Test Rule's and Send Test
 * Now's Test Failed and the API as the bare code. It is thrown as
 * SlackRefusalException now: OneUptime's words for the code
 * (WorkspaceRefusal), with Slack's code after them - "The Slack channel is
 * archived. Unarchive it in Slack, or pick another channel. Slack said:
 * is_archived." - and the code itself on the exception (slackCode), which
 * the code that tells one refusal from another reads (getCode): a taken
 * channel name, a workspace OneUptime is not added to, a message that is
 * gone.
 */
export class SlackRefusalException extends BadRequestException {
  // Slack's code: "is_archived". Empty for a refusal Slack gave none for.
  public readonly slackCode: string;

  public constructor(slackCode: string) {
    super(
      ProductBrandingText.brandText(
        WorkspaceRefusal.describeSlackRefusal(slackCode),
      ),
    );
    this.slackCode = slackCode;
  }
}

// What "undefined" in a message meant before: Slack gave no code.
const NO_CODE_WORDS: ReadonlyArray<string> = ["undefined", "null"];

// A code as Slack writes one: lower case, digits and underscores.
const SLACK_CODE: RegExp = /^[a-z0-9_]+$/;

export default class SlackRefusal {
  /*
   * Slack's code in an answer it gave: its "error". Empty when the answer
   * has none - one that was no JSON object, or a refusal without a code.
   */
  public static getCodeOfAnswer(answer: unknown): string {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      return "";
    }

    const code: unknown = (answer as JSONObject)["error"];

    if (typeof code !== "string") {
      return "";
    }

    const trimmed: string = code.trim();

    return NO_CODE_WORDS.includes(trimmed) ? "" : trimmed;
  }

  // Words that are a code as Slack writes one ("internal_error"), else empty.
  private static getCodeOfWords(words: string | undefined): string {
    const trimmed: string = (words || "").trim();

    return SLACK_CODE.test(trimmed) && !NO_CODE_WORDS.includes(trimmed)
      ? trimmed
      : "";
  }

  // The refusal an {"ok": false, "error": …} answer is thrown as.
  public static fromAnswer(answer: unknown): SlackRefusalException {
    return new SlackRefusalException(SlackRefusal.getCodeOfAnswer(answer));
  }

  /*
   * The refusal an HTTP error from Slack is said as: Slack's code when its
   * body carries one - a 429 answers {"ok": false, "error": "ratelimited"}
   * - else the status, as "http_503".
   */
  public static fromHttpError(
    response: HTTPErrorResponse,
  ): SlackRefusalException {
    const code: string =
      SlackRefusal.getCodeOfAnswer(response.jsonData) ||
      SlackRefusal.getCodeOfWords(response.message);

    if (code) {
      return new SlackRefusalException(code);
    }

    return new SlackRefusalException(
      typeof response.statusCode === "number"
        ? `http_${response.statusCode}`
        : "",
    );
  }

  /*
   * The Slack code an error carries: a SlackRefusalException's - read by
   * its field, so one from another realm is read too - else the code its
   * message names ("Slack said: name_taken.", or "Error from Slack
   * name_taken" from code that still writes it so), else an HTTP error's
   * body's. Null when it carries none.
   */
  public static getCode(error: unknown): string | null {
    if (!error || typeof error !== "object") {
      return typeof error === "string"
        ? WorkspaceRefusal.getSlackCodeOfMessage(error)
        : null;
    }

    const slackCode: unknown = (error as { slackCode?: unknown }).slackCode;

    if (typeof slackCode === "string" && slackCode) {
      return slackCode;
    }

    const message: unknown = (error as { message?: unknown }).message;

    if (typeof message === "string") {
      const fromMessage: string | null =
        WorkspaceRefusal.getSlackCodeOfMessage(message);

      if (fromMessage) {
        return fromMessage;
      }
    }

    if (error instanceof HTTPErrorResponse) {
      return SlackRefusal.getCodeOfAnswer(error.jsonData) || null;
    }

    return null;
  }

  /*
   * What a person reads of a Slack call that failed - in a Notification
   * Logs row, Test Rule's Test Failed, a summary's channel: a refusal's
   * own words; an HTTP error said as Slack's code in its body, or its
   * status; and a message that still says "Error from Slack <code>", or
   * is Slack's bare code, in OneUptime's words for that code. Anything
   * else reads as it is (WorkspaceBase.getSendErrorMessage).
   */
  public static describe(error: unknown): string {
    if (error instanceof SlackRefusalException) {
      return error.message;
    }

    if (error instanceof HTTPErrorResponse) {
      return SlackRefusal.fromHttpError(error).message;
    }

    const message: string = WorkspaceBase.getSendErrorMessage(error);

    const reading: WorkspaceRefusalReading = WorkspaceRefusal.read({
      message: message,
      workspaceType: WorkspaceType.Slack,
    });

    if (!reading.detail) {
      return message;
    }

    return ProductBrandingText.brandText(
      WorkspaceRefusal.toText({
        reading: reading,
        workspaceType: WorkspaceType.Slack,
      }),
    );
  }

  // Whether an error is Slack refusing with one of `codes`.
  public static isRefusedWith(
    error: unknown,
    codes: ReadonlyArray<string>,
  ): boolean {
    const code: string | null = SlackRefusal.getCode(error);

    return code !== null && codes.includes(code);
  }
}
