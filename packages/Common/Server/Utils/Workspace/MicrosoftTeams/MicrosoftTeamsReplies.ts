import { Activity, TurnContext } from "botbuilder";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DatabaseConfig from "../../../DatabaseConfig";
import { ProjectScopedReferenceException } from "../../Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../../Logger";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES,
} from "./MicrosoftTeamsMessageSize";

/*
 * Replies the Microsoft Teams bot sends, and the rule they follow: an inbound
 * message gets one answer, and an answer that cannot be sent never turns into
 * a second one.
 *
 * Issue #4111: a failed command replied "Sorry, I encountered an error..."
 * and then rethrew, the adapter answered Teams with HTTP 500, and Teams
 * delivered the message again, so every error showed up twice. Replies that
 * are not the point of the turn (an error text, removing a submitted form) are
 * therefore sent best-effort: a failure is logged, never thrown.
 */

export const MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE: string =
  "application/vnd.microsoft.card.adaptive";

/*
 * The reply for a submit that references a record the project does not have
 * (deleted since the form was sent, or another project's id in a tampered
 * submit). Fixed text: the validator's own message names the other project's
 * record, which is not for this chat.
 */
export const MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE: string =
  "One of the values you picked (a monitor, label, on-call policy, severity or status) is not available in this project any more. Please pick it again.";

export default class MicrosoftTeamsReplies {
  // Sends a reply; logs instead of throwing. Returns whether Teams took it.
  public static async sendBestEffort(
    turnContext: TurnContext,
    reply: string | Partial<Activity>,
  ): Promise<boolean> {
    try {
      await turnContext.sendActivity(reply);
      return true;
    } catch (error) {
      logger.error(
        `Could not send a Microsoft Teams reply: ${this.describeError(error)}`,
      );
      return false;
    }
  }

  /*
   * Removes a message the bot posted, such as the form a user just submitted;
   * logs instead of throwing. It runs after the record the form created
   * exists, so a failure here must never be reported as a failed create.
   */
  public static async deleteBestEffort(
    turnContext: TurnContext,
    activityId: string | undefined,
  ): Promise<void> {
    if (!activityId) {
      return;
    }

    try {
      await turnContext.deleteActivity(activityId);
    } catch (error) {
      logger.debug(
        `Could not remove a submitted Microsoft Teams card: ${this.describeError(error)}`,
      );
    }
  }

  /*
   * Sends an adaptive card built for each size budget in turn, until Teams
   * accepts one. Only a "too large" refusal moves on to the next, smaller
   * budget; any other error is thrown at once, and so is the last "too
   * large". A budget whose card is no different from the one just refused
   * is skipped.
   */
  public static async sendCardWithinSizeLimit(data: {
    turnContext: TurnContext;
    buildCard: (budgetInBytes: number) => JSONObject;
    budgetsInBytes?: ReadonlyArray<number> | undefined;
  }): Promise<void> {
    const budgetsInBytes: ReadonlyArray<number> =
      data.budgetsInBytes || MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES;

    let lastError: unknown = undefined;
    let lastRefusedCard: string | null = null;

    for (const budgetInBytes of budgetsInBytes) {
      const card: JSONObject = data.buildCard(budgetInBytes);
      const serializedCard: string = JSON.stringify(card);

      if (serializedCard === lastRefusedCard) {
        continue;
      }

      try {
        await data.turnContext.sendActivity({
          attachments: [
            {
              contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
              content: card,
            },
          ],
        });
        return;
      } catch (error) {
        if (!MicrosoftTeamsMessageSize.isMessageTooLargeError(error)) {
          throw error;
        }

        logger.warn(
          `Microsoft Teams refused a ${MicrosoftTeamsMessageSize.getSizeInBytes(
            serializedCard,
          )} byte card as too large (budget ${budgetInBytes} bytes); trying a smaller one.`,
        );

        lastError = error;
        lastRefusedCard = serializedCard;
      }
    }

    throw lastError;
  }

  /*
   * One line that says what went wrong, for the log. Bot Framework errors
   * carry the HTTP status and Teams' error code, e.g.
   * "RestError 413 MessageSizeTooBig: Message size too large.".
   */
  public static describeError(error: unknown): string {
    if (!error || typeof error !== "object") {
      return String(error);
    }

    /*
     * OneUptime's exceptions keep Error's name, so the class they were thrown
     * as comes from the constructor instead.
     */
    const errorName: string =
      ((error as { name?: unknown }).name as string | undefined) || "";
    const constructorName: string =
      ((error as { constructor?: { name?: unknown } }).constructor?.name as
        | string
        | undefined) || "";
    const name: string =
      errorName && errorName !== "Error"
        ? errorName
        : constructorName && constructorName !== "Object"
          ? constructorName
          : errorName || "Error";
    const message: string = String(
      (error as { message?: unknown }).message ?? "",
    );
    const statusCode: number | undefined =
      MicrosoftTeamsMessageSize.getErrorStatusCode(error);
    const code: string | undefined =
      MicrosoftTeamsMessageSize.getErrorCode(error);

    return [name, statusCode, code]
      .filter((part: string | number | undefined) => {
        return part !== undefined && part !== "";
      })
      .join(" ")
      .concat(`: ${message}`);
  }

  /*
   * Logs a failure: one line that says what failed and why, then the error
   * itself, which keeps its stack and lets the log tell a refusal from a
   * fault. A Bot Framework HTTP error is left at the one line: its status and
   * code say it all, and the object carries the whole request and response.
   */
  public static logFailure(
    summary: string,
    error: unknown,
    attributes?: LogAttributes | undefined,
  ): void {
    logger.error(`${summary}: ${this.describeError(error)}`, attributes);

    if (MicrosoftTeamsMessageSize.getErrorStatusCode(error) === undefined) {
      logger.error(error, attributes);
    }
  }

  /*
   * The message of an error OneUptime writes for the person who caused it: a
   * validation or a permission refusal. Null for anything else, whose text is
   * meant for operators.
   */
  public static getUserFacingErrorMessage(error: unknown): string | null {
    if (error instanceof ProjectScopedReferenceException) {
      return MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE;
    }

    if (
      (error instanceof BadDataException ||
        error instanceof NotAuthorizedException) &&
      error.message
    ) {
      return error.message;
    }

    return null;
  }

  // A link into the project in the OneUptime dashboard, or null if unknown.
  public static async getDashboardLink(data: {
    projectId: ObjectID;
    route: string; // below the project, e.g. "/incidents/create"
  }): Promise<string | null> {
    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

      return URL.fromString(dashboardUrl.toString())
        .addRoute(`/${data.projectId.toString()}${data.route}`)
        .toString();
    } catch (error) {
      logger.debug("Could not build a OneUptime dashboard link");
      logger.debug(error);
      return null;
    }
  }

  /*
   * What to tell a Teams user who has not connected their Microsoft Teams
   * account to OneUptime yet: where to do it. `purpose` completes "To ...",
   * e.g. "create incidents from Microsoft Teams".
   */
  public static async getAccountNotLinkedMessage(data: {
    projectId: ObjectID;
    purpose: string;
  }): Promise<string> {
    const settingsLink: string | null = await this.getDashboardLink({
      projectId: data.projectId,
      route: "/user-settings/microsoft-teams-integration",
    });

    const where: string = settingsLink
      ? `in [OneUptime → User Settings → Microsoft Teams](${settingsLink})`
      : "in OneUptime under User Settings → Microsoft Teams";

    return `To ${data.purpose}, first connect your Microsoft Teams account to OneUptime ${where}, then try again.`;
  }
}
