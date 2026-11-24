import {
  getChatMessageNotSent,
  getOtherSystemSaidNothing,
  TELEGRAM_WHAT_TO_CHECK,
} from "../../../../../Server/Types/Workflow/Components/OtherSystemSaidNothing";
import {
  isEmptyErrorPhrase,
  meetsErrorMessageRule,
} from "../../../../../Types/Exception/ErrorMessageRule";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A WORKFLOW STEP NEVER SAYS "Server Error." WHEN ANOTHER SYSTEM SAID
 * NOTHING (#7268).
 *
 * Slack's, Microsoft Teams', Discord's and Telegram's send steps and every
 * API step handed "Server Error." through their error port when the other
 * system refused and gave no words: one of the empty phrases, which read as
 * OneUptime failing. They say what did not happen, that the other system
 * did not say why, and what to check. The other system's own words, when
 * it gives some, are still handed on as they are.
 */

const COMPONENTS: string = path.resolve(
  __dirname,
  "../../../../../Server/Types/Workflow/Components",
);

describe("another system that said nothing", () => {
  test.each(["Slack", "Microsoft Teams", "Discord"])(
    "%s: the message was not sent, the tool did not say why, and what to check",
    (system: string) => {
      const words: string = getChatMessageNotSent(system);

      expect(words).toBe(
        `The message was not sent to ${system}. ${system} did not say why. Check the step's webhook URL and the message, then run the workflow again.`,
      );
      expect(meetsErrorMessageRule(words)).toBe(true);
    },
  );

  test("Telegram names its bot token and chat ID", () => {
    const words: string = getChatMessageNotSent(
      "Telegram",
      TELEGRAM_WHAT_TO_CHECK,
    );

    expect(words).toContain("bot token and chat ID");
    expect(meetsErrorMessageRule(words)).toBe(true);
  });

  test("an API's refusal names its status", () => {
    const words: string = getOtherSystemSaidNothing({
      whatFailed: "The request was refused with status 502.",
      system: "The server it was sent to",
      whatToCheck:
        "Check the step's URL, headers and body, then run the workflow again.",
    });

    expect(words).toContain("502");
    expect(isEmptyErrorPhrase(words)).toBe(false);
    expect(meetsErrorMessageRule(words)).toBe(true);
  });

  test.each([
    "Slack/SendMessageToChannel.ts",
    "MicrosoftTeams/SendMessageToChannel.ts",
    "Discord/SendMessageToChannel.ts",
    "Telegram/SendMessageToChat.ts",
    "API/Utils.ts",
  ])("%s falls back to none of the empty phrases", (file: string) => {
    const source: string = fs.readFileSync(path.join(COMPONENTS, file), "utf8");

    expect(source).not.toContain('"Server Error."');
    expect(source).not.toContain('"Telegram API Error."');
  });
});
