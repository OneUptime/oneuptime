import { describe, expect, jest, test } from "@jest/globals";
import SlackAPI from "../../../../../Server/API/SlackAPI";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";

/*
 * TWO READINGS OF SLACK TEXT, IN TIME THAT GROWS WITH THE TEXT.
 *
 * Both read text somebody outside wrote, and both were patterns tried again
 * from many places to the end of the text, so their time grew with its
 * square:
 *
 *   - a question to OneUptime AI without its mentions
 *     (SlackAPI.cleanSlackMessageText): /<@[^>]+>/g ran from every "<@" of
 *     "<@<@<@..." to the end of the message (code scanning alert #1643). Its
 *     class leaves out "<" now: a mention Slack writes never holds one.
 *   - a section of a long message without the line breaks it starts and
 *     ends with (SlackUtil.trimLineBreaks): /^[\r\n]+|[\r\n]+$/g ran from
 *     every line break of a run that does not reach the end. A loop from
 *     each end now.
 *
 * Each is held to what it did with the text Slack sends, and to 400,000
 * characters of its worst case in under two seconds.
 */

jest.setTimeout(60000);

describe("a question without its mentions (SlackAPI.cleanSlackMessageText)", () => {
  test.each([
    [
      "the bot mentioned first",
      "<@U0ONEUPTIME> which monitors are down?",
      "which monitors are down?",
    ],
    [
      "a mention with the name Slack adds",
      "<@U0ONEUPTIME|oneuptime> why is checkout slow?",
      "why is checkout slow?",
    ],
    [
      "mentions in the middle",
      "is <@U0ALICE> or <@U0BOB|bob> on call?",
      "is or on call?",
    ],
    ["a mention at the end", "thanks <@U0ONEUPTIME>", "thanks"],
    [
      "whitespace runs and new lines",
      "  why\n\n is   it  down? ",
      "why is it down?",
    ],
    ["no text", "", ""],
  ])("%s", (_name: string, text: string, expected: string) => {
    expect(SlackAPI.cleanSlackMessageText(text)).toBe(expected);
  });

  test("undefined text reads as no text", () => {
    expect(SlackAPI.cleanSlackMessageText(undefined)).toBe("");
  });

  test.each([
    ["a channel", "see <#C0OPS|ops>"],
    ["everybody", "<!here> look"],
    ["a link", "<https://oneuptime.com|OneUptime>"],
    ["an escaped less-than sign", "is 3 &lt;@ 4?"],
  ])(
    "%s is not a person's mention, and stays",
    (_name: string, text: string) => {
      expect(SlackAPI.cleanSlackMessageText(text)).toBe(text);
    },
  );

  /*
   * Generated questions: words and mentions as Slack writes them, in any
   * order. What is left is the words, with each run of whitespace one space.
   */
  test("5,000 generated questions keep exactly their words", () => {
    const random: SeededRandom = seededRandom(1643);
    const words: Array<string> = [
      "why",
      "is",
      "checkout",
      "down?",
      "&lt;",
      "&gt;",
      "<#C0OPS|ops>",
      "<!here>",
      "@here",
      "a>b",
    ];
    const mentions: Array<string> = [
      "<@U0ONEUPTIME>",
      "<@U0ALICE|alice>",
      "<@W0123|Ana Ruiz (Ops)>",
    ];

    for (let index: number = 0; index < 5000; index++) {
      const parts: Array<string> = [];
      const expected: Array<string> = [];
      const count: number = random(10);

      for (let part: number = 0; part < count; part++) {
        if (random(3) === 0) {
          parts.push(mentions[random(mentions.length)]!);
          continue;
        }

        const word: string = words[random(words.length)]!;
        parts.push(word);
        expected.push(word);
      }

      expect(SlackAPI.cleanSlackMessageText(parts.join(" "))).toBe(
        expected.join(" "),
      );
    }
  });

  test.each([
    ["openings that never close", "<@"],
    ["openings with an id that never close", "<@U0"],
    ["openings with a name that never close", "<@U0|ana "],
    ["mentions that close at once", "<@>"],
  ])(
    "400,000 characters of %s are read in time that grows with them",
    (_name: string, piece: string) => {
      const text: string = piece.repeat(Math.ceil(400000 / piece.length));

      const read: FastestRun<string> = fastestRun({
        run: (): string => {
          return SlackAPI.cleanSlackMessageText(text);
        },
        limitInMs: 2000,
      });

      expect(read.inMs).toBeLessThan(2000);
    },
  );

  test("a mention after 100,000 that never close is still left out", () => {
    const text: string = `${"<@".repeat(100000)}<@U0ONEUPTIME> help`;

    const read: FastestRun<string> = fastestRun({
      run: (): string => {
        return SlackAPI.cleanSlackMessageText(text);
      },
      limitInMs: 2000,
    });

    expect(read.inMs).toBeLessThan(2000);
    expect(read.result.endsWith("help")).toBe(true);
    expect(read.result).not.toContain("U0ONEUPTIME");
  });
});

describe("a section without the line breaks around it (SlackUtil.trimLineBreaks)", () => {
  test.each([
    ["line breaks before and after", "\n\nhello\r\n", "hello"],
    ["line breaks inside stay", "\nhello\n\nworld\n", "hello\n\nworld"],
    ["spaces are not line breaks", " \nhello\n ", " \nhello\n "],
    ["nothing but line breaks", "\r\n\n\r", ""],
    ["no line breaks", "hello", "hello"],
    ["empty", "", ""],
  ])("%s", (_name: string, text: string, expected: string) => {
    expect(SlackUtil.trimLineBreaks(text)).toBe(expected);
  });

  // Generated texts of line breaks, spaces and letters.
  test("5,000 generated texts lose exactly the line breaks at each end", () => {
    const random: SeededRandom = seededRandom(3317);
    const alphabet: Array<string> = ["\n", "\r", " ", "a", "b"];

    for (let index: number = 0; index < 5000; index++) {
      let text: string = "";
      const length: number = random(16);

      for (let position: number = 0; position < length; position++) {
        text += alphabet[random(alphabet.length)];
      }

      let start: number = 0;

      while (start < text.length && "\r\n".includes(text.charAt(start))) {
        start++;
      }

      let end: number = text.length;

      while (end > start && "\r\n".includes(text.charAt(end - 1))) {
        end--;
      }

      expect(SlackUtil.trimLineBreaks(text)).toBe(text.substring(start, end));
    }
  });

  test.each([
    [
      "a run of line breaks that does not reach the end",
      (n: number): string => {
        return `a${"\n".repeat(n)}a`;
      },
    ],
    [
      "a run of line breaks at the start",
      (n: number): string => {
        return `${"\n".repeat(n)}a`;
      },
    ],
    [
      "nothing but line breaks",
      (n: number): string => {
        return "\r\n".repeat(Math.ceil(n / 2));
      },
    ],
  ])(
    "400,000 characters of %s are read in time that grows with them",
    (_name: string, make: (n: number) => string) => {
      const text: string = make(400000);

      const read: FastestRun<string> = fastestRun({
        run: (): string => {
          return SlackUtil.trimLineBreaks(text);
        },
        limitInMs: 2000,
      });

      expect(read.inMs).toBeLessThan(2000);
    },
  );

  test("a long message is still split into sections with no line break at either end", () => {
    const text: string = `${"word ".repeat(700)}\n\n\n\n${"next ".repeat(700)}`;

    const sections: Array<string> = SlackUtil.splitSectionText({ text: text });

    expect(sections.length).toBeGreaterThan(1);

    for (const section of sections) {
      expect(section.startsWith("\n")).toBe(false);
      expect(section.endsWith("\n")).toBe(false);
    }
  });
});
