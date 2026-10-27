/*
 * The note builders below reach the native isolated-vm addon through their
 * imports. Nothing here runs a sandbox, and the prebuilt binary cannot
 * always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { describe, expect, test } from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import {
  FormNoteAnswerFormat,
  getFormSubmissionNote,
} from "../../../../../Server/Utils/Form/FormSubmissionNote";
import IncomingEmailOpenForEveryEmail from "../../../../../Server/Utils/Monitor/IncomingEmailOpenForEveryEmail";
import ChatMessageMarkdown from "../../../../../Utils/Markdown/ChatMessageMarkdown";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * A HARD BREAK IN SLACK IS A LINE BREAK.
 *
 * A note keeps the lines of what somebody wrote with hard breaks - two
 * spaces at the end of a line: a reply to an Incoming Email monitor's
 * thread (IncomingEmailOpenForEveryEmail.getReplyNote), a form's multi-line
 * answer (FormSubmissionNote), a chat message saved as a note
 * (ChatMessageMarkdown). The note is posted to the record's Slack channels,
 * and slackify wrote each hard break the way Markdown does - a backslash
 * before the line break - so Slack showed a backslash at the end of every
 * line: "Thanks,\" over "Priya".
 */

// The longest a reading of 400,000 characters of its worst case may take.
const LINEAR_TIME_BUDGET_IN_MS: number = 2000;

// A backslash at the end of a line: how a hard break showed in Slack.
function hasBackslashLineEnd(text: string): boolean {
  return text.includes("\\\n") || text.endsWith("\\");
}

describe("Slack reads a hard break as a line break", () => {
  test("two spaces before a line break: a line break, and no backslash", () => {
    const slack: string = SlackUtil.slackify("Thanks,  \nPriya");

    expect(slack).toContain("Thanks,\nPriya");
    expect(hasBackslashLineEnd(slack)).toBe(false);
  });

  test("so does every hard break of a paragraph, and paragraphs stay apart", () => {
    const slack: string = SlackUtil.slackify(
      "Still broken.  \nError 41 again.\n\nThanks,  \nPriya",
    );

    expect(slack).toContain("Still broken.\nError 41 again.\n\nThanks,\nPriya");
    expect(hasBackslashLineEnd(slack)).toBe(false);
  });

  test("a reply to an email thread reads line by line", () => {
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "priya@acme.example",
      body: "Same here - floor 3 too.\nRestarted it twice.\n\nThanks,\nPriya",
    });
    const slack: string = SlackUtil.slackify(note);

    expect(slack).toContain("Same here - floor 3 too.\nRestarted it twice.");
    expect(slack).toContain("Thanks,\nPriya");
    expect(hasBackslashLineEnd(slack)).toBe(false);
  });

  test("a form's multi-line answer reads line by line", () => {
    const note: string = getFormSubmissionNote({
      formName: "Report a Problem",
      submitterName: "Jane",
      answers: [
        {
          label: "Steps",
          displayValue: "Open the app\nPress Pay\nNothing happens",
          format: FormNoteAnswerFormat.MultiLine,
        },
      ],
    });
    const slack: string = SlackUtil.slackify(note);

    expect(slack).toContain("Open the app\nPress Pay\nNothing happens");
    expect(hasBackslashLineEnd(slack)).toBe(false);
  });

  test("a chat message saved as a note keeps its lines", () => {
    const note: string = ChatMessageMarkdown.toMarkdown({
      blocks: [
        {
          type: "paragraph",
          inlines: [{ type: "text", text: "Deploy rolled back\nat 9:02" }],
        },
      ],
    }).toString();
    const slack: string = SlackUtil.slackify(note);

    expect(slack).toContain("Deploy rolled back\nat 9:02");
    expect(hasBackslashLineEnd(slack)).toBe(false);
  });
});

describe("SlackUtil.withoutHardBreakSpaces", () => {
  test("takes the spaces of a hard break off its line", () => {
    expect(SlackUtil.withoutHardBreakSpaces("a  \nb")).toBe("a\nb");
    expect(SlackUtil.withoutHardBreakSpaces("a     \nb  \nc")).toBe("a\nb\nc");
  });

  test("leaves every other line as it is", () => {
    // One space is no hard break.
    expect(SlackUtil.withoutHardBreakSpaces("a \nb")).toBe("a \nb");
    // Spaces that end the text break no line.
    expect(SlackUtil.withoutHardBreakSpaces("a\nb  ")).toBe("a\nb  ");
    // Spaces at the start of a line indent it.
    expect(SlackUtil.withoutHardBreakSpaces("a  \n    b")).toBe("a\n    b");
    expect(SlackUtil.withoutHardBreakSpaces("")).toBe("");
  });

  test.each([
    ["400,000 spaces before one line break", `${" ".repeat(400000)}\n`],
    ["100,000 hard breaks", "a  \n".repeat(100000)],
    ["400,000 spaces and no line break", " ".repeat(400000)],
  ])("takes time in line with the text: %s", (_name: string, text: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        SlackUtil.withoutHardBreakSpaces(text);
      },
      limitInMs: LINEAR_TIME_BUDGET_IN_MS,
    });
    expect(timed.inMs).toBeLessThan(LINEAR_TIME_BUDGET_IN_MS);
  });
});
