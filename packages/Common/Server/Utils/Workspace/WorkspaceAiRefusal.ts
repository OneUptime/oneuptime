import AIService, {
  AI_DISABLED_MESSAGE,
  PROJECT_DAILY_AI_LIMIT_REACHED_PATTERN,
} from "../../Services/AIService";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../Utils/Project/ProjectBalance";

/*
 * WHY ONEUPTIME AI DID NOT ANSWER A QUESTION ASKED IN A CHAT.
 *
 * AIService.executeWithLogging refuses a call for reasons somebody chose and
 * can undo, each said in a sentence that names where: AI switched off for the
 * project (AI_DISABLED_MESSAGE), the project's own daily AI limit reached
 * (getProjectDailyLimitMessage), and its AI credits used up
 * (PROJECT_AI_CREDITS_USED_UP_MESSAGE, written for "a Slack or Microsoft
 * Teams question"). Slack and Microsoft Teams answered every failure with
 * "Sorry, I ran into a problem ... Please try again", and a project with no
 * AI credits - every new one - was told that on every question: no retry
 * ever answers it, and nobody learnt who could add them (Microsoft's
 * reviewers, testing the Teams app in a project they had just created, were).
 *
 * The chats check the switch and the daily limits before they acknowledge a
 * question; getCreditsRefusal is the same check for the credits. What
 * changes while an answer is written - its calls use up the last credits, or
 * cross the day's limit - is read from the error (getRefusalMessage).
 */
export default class WorkspaceAiRefusal {
  /*
   * PROJECT_AI_CREDITS_USED_UP_MESSAGE when a question in this project would
   * be refused for want of AI credits - they are used up, and Auto Recharge
   * is off or its last charge failed (AIService.getAiBalanceBlocker, which
   * tells the project's owners too) - or null when it may run.
   */
  public static async getCreditsRefusal(
    projectId: ObjectID,
  ): Promise<string | null> {
    const blocker: string | null = await AIService.getAiBalanceBlocker({
      projectId: projectId,
    });

    return blocker ? PROJECT_AI_CREDITS_USED_UP_MESSAGE : null;
  }

  /*
   * The sentence a chat says for an error that is one of these refusals, as
   * AIService wrote it; null for any other failure, whose message - a
   * provider's error, a timeout - is not for a chat.
   */
  public static getRefusalMessage(error: unknown): string | null {
    if (!(error instanceof BadDataException)) {
      return null;
    }

    const message: string = error.message;

    if (
      message === PROJECT_AI_CREDITS_USED_UP_MESSAGE ||
      message === AI_DISABLED_MESSAGE ||
      PROJECT_DAILY_AI_LIMIT_REACHED_PATTERN.test(message)
    ) {
      return message;
    }

    return null;
  }
}
