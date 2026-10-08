import { describe, expect, test } from "@jest/globals";
import {
  MAX_CALL_TWIML_LENGTH,
  MAX_DISCORD_MESSAGE_LENGTH,
  MAX_PUSH_TEXT_BYTES,
  MAX_SMS_LENGTH,
  MAX_TELEGRAM_MESSAGE_LENGTH,
  MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH,
  TRUNCATED_NAME_NOTE,
  TRUNCATED_TEXT_NOTE,
  TRUNCATED_TEXT_NOTE_PLAIN,
  fitTextToLength,
  fitTextsToBudget,
  getWaterLevel,
} from "../../Utils/MessageFit";
import SlackUtil from "../../Server/Utils/Workspace/Slack/Slack";

/*
 * TEXT HELD TO WHAT A CHANNEL TAKES (Utils/MessageFit).
 *
 * Every provider refuses a message over its own limit, and the
 * notification is lost. A text over the limit is cut, and ends with a note
 * that the rest is in OneUptime; a text within it is sent as it was.
 */

describe("the providers' limits", () => {
  test("are the documented ones", () => {
    // Twilio: error 21617 over 1,600; TwiML of at most 4,000.
    expect(MAX_SMS_LENGTH).toBe(1600);
    expect(MAX_CALL_TWIML_LENGTH).toBe(4000);
    // Meta: a template's text with its variables filled in.
    expect(MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH).toBe(1024);
    expect(MAX_TELEGRAM_MESSAGE_LENGTH).toBe(4096);
    expect(MAX_DISCORD_MESSAGE_LENGTH).toBe(2000);
    // Expo, APNs, FCM and web push take 4,096 bytes in all.
    expect(MAX_PUSH_TEXT_BYTES).toBeLessThan(4096);
  });

  test("the note says what a cut chat message says", () => {
    expect(SlackUtil.TRUNCATED_SECTION_NOTE.trim()).toBe(
      `_${TRUNCATED_TEXT_NOTE}_`,
    );
    // ...and in plain characters every SMS encoding has, it reads the same.
    expect(TRUNCATED_TEXT_NOTE_PLAIN).toBe(
      TRUNCATED_TEXT_NOTE.replace("…", "...").replace("—", "-"),
    );
    expect(/^[\x20-\x7e]*$/.test(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
  });
});

describe("fitTextToLength", () => {
  test("a text within the length is returned as it is", () => {
    expect(fitTextToLength("abc", 3)).toBe("abc");
  });

  test("a longer one is cut, and ends with the note, within the length", () => {
    const fitted: string = fitTextToLength("word ".repeat(100), 120);

    expect(fitted.length).toBeLessThanOrEqual(120);
    expect(fitted.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(fitted.startsWith("word word")).toBe(true);
  });

  test("at the last line break in the second half of what fits", () => {
    const fitted: string = fitTextToLength(
      `${"a".repeat(30)}\n${"b".repeat(30)}\n${"c".repeat(100)}`,
      70 + TRUNCATED_TEXT_NOTE_PLAIN.length,
      TRUNCATED_TEXT_NOTE_PLAIN,
    );

    expect(fitted).toBe(
      `${"a".repeat(30)}\n${"b".repeat(30)}${TRUNCATED_TEXT_NOTE_PLAIN}`,
    );
  });

  test("never in the middle of an emoji", () => {
    const fitted: string = fitTextToLength("😀".repeat(100), 60, "…");

    expect(fitted).toBe(`${"😀".repeat(29)}…`);
  });

  test("a length too small for the note gets the text cut alone", () => {
    expect(fitTextToLength("abcdefgh", 5, TRUNCATED_TEXT_NOTE)).toBe("abcde");
  });
});

describe("getWaterLevel", () => {
  test("is Infinity when everything fits", () => {
    expect(getWaterLevel([10, 20, 30], 60)).toBe(Number.POSITIVE_INFINITY);
    expect(getWaterLevel([], 0)).toBe(Number.POSITIVE_INFINITY);
  });

  test("is the level the largest are held to, the small ones counted as they are", () => {
    // 10 fits; 50 left for two: 25 each.
    expect(getWaterLevel([10, 100, 200], 60)).toBe(25);
    // Nothing fits: an even share of what there is.
    expect(getWaterLevel([100, 200], 60)).toBe(30);
    expect(getWaterLevel([100], -5)).toBe(0);
  });
});

describe("fitTextsToBudget", () => {
  test("texts within the budget are returned as they are", () => {
    expect(fitTextsToBudget(["a", "bb"], 3)).toEqual(["a", "bb"]);
  });

  test("the longest are cut to about the same size, the short ones kept", () => {
    const fitted: Array<string> = fitTextsToBudget(
      ["Title", "x".repeat(1000), "y".repeat(3000)],
      1000,
    );

    expect(fitted[0]).toBe("Title");
    expect(fitted[1]!.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(fitted[2]!.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(Math.abs(fitted[1]!.length - fitted[2]!.length)).toBeLessThan(5);
    expect(
      fitted.reduce((sum: number, text: string): number => {
        return sum + text.length;
      }, 0),
    ).toBeLessThanOrEqual(1000);
  });

  test("measured as the channel counts, each cut with its own note", () => {
    const measure: (text: string) => number = (text: string): number => {
      return Buffer.byteLength(JSON.stringify(text), "utf8");
    };
    const fitted: Array<string> = fitTextsToBudget(
      ["障害".repeat(500), '"'.repeat(1000)],
      600,
      {
        measure: measure,
        getNote: (index: number): string => {
          return index === 0 ? TRUNCATED_NAME_NOTE : TRUNCATED_TEXT_NOTE;
        },
      },
    );

    expect(measure(fitted[0]!) + measure(fitted[1]!)).toBeLessThanOrEqual(600);
    expect(fitted[0]!.endsWith(TRUNCATED_NAME_NOTE)).toBe(true);
    expect(fitted[1]!.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
  });
});
