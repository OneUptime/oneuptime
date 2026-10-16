import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import SlackDirectMessageHelp from "../../../../../Server/Utils/Workspace/Slack/SlackDirectMessageHelp";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceCommands from "../../../../../Server/Utils/Workspace/WorkspaceCommands";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * "HELP" IN THE APP'S DIRECT MESSAGES: THE COMMANDS, WITHOUT AI.
 *
 * Slack's reviewers write "help" in the app's Messages tab, in a project
 * that may have no AI model connected: a direct message that is only the help
 * word is answered with what `/oneuptime help` lists, never sent to AI. What
 * counts as only the help word is what /oneuptime and the Microsoft Teams bot
 * read as help; anything more is a question, as it was.
 */

// Slack's own: a zero-width space around a bold span it draws.
const ZWSP: string = "\u{200B}";

const HELP_TEXT: string = [
  `👋 ${ZWSP}*Here's what \`/oneuptime\` can do*${ZWSP}`,
  "",
  "•   `/oneuptime incident [title or number]`: declare an incident, or act on one by its number",
  "•   `/oneuptime maintenance [title]`: schedule maintenance",
  "•   `/oneuptime oncall`: see who is on call right now",
  "•   `/oneuptime page [who] [message]`: page a person, a team or whoever is on call",
  "•   `/oneuptime ask [question]`: ask OneUptime AI about your logs, traces, metrics, incidents and monitors",
  "•   `/oneuptime help`: list every command",
  "",
  "For example: `/oneuptime incident Checkout is down`. Anything else after `/oneuptime` is a question for OneUptime AI too, such as `/oneuptime which monitors are down?`",
  "",
].join("\n");

beforeEach(() => {
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SlackDirectMessageHelp.isHelp", () => {
  test.each([
    ["help"],
    ["Help"],
    ["HELP"],
    ["  help  "],
    // The punctuation a command may be typed with.
    ["help?"],
    ["help!"],
    ["?"],
    // The command as Slack knows it, typed as a message after a space.
    ["/help"],
    ["/oneuptime help"],
    ["/OneUptime Help"],
    ["/oneuptime"],
    // "ask" with nothing to ask, as `/oneuptime ask` is answered.
    ["ask"],
  ])("%j asks for the help", (text: string) => {
    expect(SlackDirectMessageHelp.isHelp(text)).toBe(true);
  });

  test.each([
    // Nothing typed asks for nothing, as before.
    [""],
    ["   "],
    // A question, as it is after /oneuptime.
    ["help me find slow queries"],
    ["helpful?"],
    ["which monitors are down?"],
    ["can you help?"],
    // Every other command typed in a direct message stays a question.
    ["oncall"],
    ["incident Checkout is down"],
    ["/oneuptime incident Checkout is down"],
    ["ask which monitors are down?"],
    ["//help"],
  ])("%j is no help request", (text: string) => {
    expect(SlackDirectMessageHelp.isHelp(text)).toBe(false);
  });
});

describe("SlackDirectMessageHelp.getAnswerText", () => {
  test("what /oneuptime help lists, as Slack text", () => {
    expect(SlackDirectMessageHelp.getAnswerText()).toBe(HELP_TEXT);
    expect(SlackDirectMessageHelp.getAnswerText()).toBe(
      SlackUtil.convertMarkdownToSlackRichText(
        WorkspaceCommands.getHelpAnswer({ workspaceType: WorkspaceType.Slack })
          .markdown,
      ),
    );
  });

  test("names the product as the server is branded", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    expect(SlackDirectMessageHelp.getAnswerText()).toContain(
      "is a question for Acme Status AI too",
    );
    expect(SlackDirectMessageHelp.getAnswerText()).not.toContain("OneUptime");
  });
});
