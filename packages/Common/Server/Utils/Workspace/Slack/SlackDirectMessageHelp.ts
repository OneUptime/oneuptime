import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceCommands, { WorkspaceCommandName } from "../WorkspaceCommands";
import SlackUtil from "./Slack";
import SlackAiConversations, { SlackMessage } from "./SlackAiConversations";

/*
 * "HELP" IN THE APP'S DIRECT MESSAGES: THE COMMANDS, WITHOUT AI.
 *
 * A direct message to the app is a question for OneUptime AI (SlackAPI's
 * answerMessage), and "help" was one too: answered by AI for somebody
 * connected in a project with AI on, and otherwise with "Connect your Slack
 * account" or "AI features are disabled for this project" - never with what
 * the app does. Somebody who writes "help" to an app wants to know that, and
 * Slack's reviewers write it in the Messages tab first, in a project that may
 * have no AI model connected (customers bring their own).
 *
 * So a direct message that is only the help word is answered with the
 * commands, as /oneuptime help lists them (WorkspaceCommands.getHelpAnswer),
 * in a thread under it as every answer there is: connected or not, AI on or
 * off. A workspace connected to no project is still answered nothing.
 *
 * "Only the help word" is what /oneuptime and the Microsoft Teams bot read as
 * help (WorkspaceCommands.parse): "help" in any case, with the punctuation a
 * command may be typed with ("help?"), or "?" - with @mentions taken out
 * (SlackAPI.cleanSlackMessageText), and the command as Slack knows it typed
 * as a message, "/oneuptime help" or "/help", read the same. "help me find
 * slow queries" is a question, as it is after /oneuptime.
 */
export default class SlackDirectMessageHelp {
  /*
   * Whether a direct message - its text without @mentions - asks for the
   * help (see the header). Nothing typed asks for nothing.
   */
  public static isHelp(text: string): boolean {
    const typed: string = text.trim();

    if (!typed) {
      return false;
    }

    return (
      WorkspaceCommands.parse(SlackDirectMessageHelp.withoutSlash(typed))
        .command === WorkspaceCommandName.Help
    );
  }

  // The help, as Slack text: what `/oneuptime help` answers.
  public static getAnswerText(): string {
    return SlackUtil.convertMarkdownToSlackRichText(
      WorkspaceCommands.getHelpAnswer({ workspaceType: WorkspaceType.Slack })
        .markdown,
    );
  }

  /*
   * Answers a direct message that asks for the help (isHelp): in a thread
   * under it, with the project's bot token. Throws when Slack refuses it.
   */
  @CaptureSpan()
  public static async answer(data: {
    projectAuthToken: string;
    message: SlackMessage;
  }): Promise<void> {
    await SlackUtil.sendMessageToThread({
      authToken: data.projectAuthToken,
      channelId: data.message.channelId,
      threadTs: SlackAiConversations.getThreadTs(data.message),
      text: SlackDirectMessageHelp.getAnswerText(),
    });
  }

  /*
   * The command typed as a message: "/oneuptime help" is "help", and so is
   * "/help". Slack runs a message that starts with "/" as a command, so one
   * reaches the app only typed after a space.
   */
  private static withoutSlash(typed: string): string {
    const command: string = WorkspaceCommands.SLACK_COMMAND;
    const lower: string = typed.toLowerCase();

    if (lower === command || lower.startsWith(`${command} `)) {
      return typed.substring(command.length).trim();
    }

    return typed.startsWith("/") ? typed.substring(1) : typed;
  }
}
