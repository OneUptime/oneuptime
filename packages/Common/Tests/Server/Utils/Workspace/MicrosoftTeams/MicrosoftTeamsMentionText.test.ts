import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsMentionText from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMentionText";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";

/*
 * A MICROSOFT TEAMS MESSAGE WITHOUT ITS MENTIONS (MicrosoftTeamsMentionText).
 *
 * The bot reads "@OneUptime show active incidents" as "show active
 * incidents": Teams writes the mention as <at>OneUptime</at>, and the bot
 * leaves it out before it reads the command or the question. It used to do
 * that with /<at[^>]*>.*?<\/at>/g, which is tried again from every "<at" of
 * a message to its end - minutes for a long message of them. These hold the
 * walk that replaced it to what the pattern did with every mention Teams
 * sends, and to time in line with the message.
 */

describe("the mentions Microsoft Teams writes into a message", () => {
  test.each([
    [
      "the bot, mentioned before a command",
      "<at>OneUptime</at> show active incidents",
      " show active incidents",
    ],
    [
      "a mention with the id attribute Graph writes",
      '<at id="0">OneUptime</at> which monitors are down?',
      " which monitors are down?",
    ],
    [
      "a mention in the middle",
      "page <at>Nawaz Dhandala</at> the checkout is down",
      "page  the checkout is down",
    ],
    [
      "several mentions",
      "<at>OneUptime</at> page <at>Ana</at> and <at>Bo</at>: disk full",
      " page  and : disk full",
    ],
    [
      "a mention at the very end",
      "thanks <at>OneUptime</at>",
      "thanks ",
    ],
    ["nothing but a mention", "<at>OneUptime</at>", ""],
    [
      "a name with Teams' escaped characters",
      "<at>R&amp;D &lt;ops&gt;</at> hi",
      " hi",
    ],
  ])("%s is left out", (_name: string, text: string, expected: string) => {
    expect(MicrosoftTeamsMentionText.removeMentions(text)).toBe(expected);
  });

  test.each([
    ["no mention at all", "show active incidents"],
    ["an empty message", ""],
    [
      "another tag that starts with the same letters",
      '<attachment id="1"></attachment> see the screenshot',
    ],
    ["an opening that never ends", "look <at no end"],
    ["a mention that never closes", "look <at>OneUptime and more"],
    [
      "a name with a tag in it, which Teams never sends",
      "<at>One<b>Uptime</b></at> hi",
    ],
    ["a lone '<at'", "a <at b"],
  ])("%s is kept as it is", (_name: string, text: string) => {
    expect(MicrosoftTeamsMentionText.removeMentions(text)).toBe(text);
  });

  /*
   * The pattern ran from an "<attachment ...>" tag to the "</at>" of a
   * mention after it, and took the attachment and everything between with
   * the mention. Only the mention goes now.
   */
  test("an attachment before a mention stays; only the mention goes", () => {
    expect(
      MicrosoftTeamsMentionText.removeMentions(
        '<attachment id="1"></attachment> ask <at>OneUptime</at> why',
      ),
    ).toBe('<attachment id="1"></attachment> ask  why');
  });

  test("a mention after one that never closed is still left out", () => {
    expect(
      MicrosoftTeamsMentionText.removeMentions(
        "<at>Broken name <at>OneUptime</at> help",
      ),
    ).toBe("<at>Broken name  help");
  });

  /*
   * Generated messages: words and mentions in any order, the mentions as
   * Teams writes them (with or without an id, any display name without a
   * "<"). The text left is exactly the words, in their order.
   */
  test("10,000 generated messages keep exactly their words", () => {
    const random: SeededRandom = seededRandom(4220);
    const words: Array<string> = [
      "show",
      "active",
      " incidents",
      "page",
      " ",
      "\n",
      "a",
      "<",
      ">",
      "</at>",
      "&lt;at&gt;",
      "<b>bold</b>",
      "@here",
    ];
    const names: Array<string> = [
      "OneUptime",
      "Nawaz Dhandala",
      "R&amp;D",
      "",
      "Ana (Ops)",
      "José",
    ];

    for (let index: number = 0; index < 10000; index++) {
      let message: string = "";
      let expected: string = "";
      const pieces: number = random(12);

      for (let piece: number = 0; piece < pieces; piece++) {
        if (random(3) === 0) {
          const name: string = names[random(names.length)]!;
          message +=
            random(2) === 0 ? `<at>${name}</at>` : `<at id="${piece}">${name}</at>`;
          continue;
        }

        let word: string = words[random(words.length)]!;

        /*
         * A word that ends with "<" would open a mention with the next
         * one's "at": written as Teams writes a "<", like a person's.
         */
        if (word === "<") {
          word = "&lt;";
        }

        message += word;
        expected += word;
      }

      expect(MicrosoftTeamsMentionText.removeMentions(message)).toBe(expected);
    }
  });
});

describe("a message read in time that grows with its length", () => {
  /*
   * 400,000 characters of each shape that made the pattern try again from
   * every "<at" to the end of the message, and of the ones that would make a
   * walk read on past the next "<".
   */
  test.each([
    ["openings that never end", "<at"],
    ["mentions that never close", "<at>"],
    ["openings with attributes", '<at id="0"'],
    ["names that never close", "<at>Nawaz "],
    ["names cut short by another tag", "<at>a<"],
    ["closings with no opening", "</at>"],
    ["attachment tags", "<attachment>"],
  ])("%s", (_name: string, piece: string) => {
    const text: string = piece.repeat(Math.ceil(400000 / piece.length));

    const read: FastestRun<string> = fastestRun({
      run: (): string => {
        return MicrosoftTeamsMentionText.removeMentions(text);
      },
      limitInMs: 2000,
    });

    expect(read.inMs).toBeLessThan(2000);
    expect(read.result.length).toBeLessThanOrEqual(text.length);
  });

  test("one long name, then a close: one mention, read once", () => {
    const text: string = `<at>${"a".repeat(400000)}</at> help`;

    const read: FastestRun<string> = fastestRun({
      run: (): string => {
        return MicrosoftTeamsMentionText.removeMentions(text);
      },
      limitInMs: 2000,
    });

    expect(read.inMs).toBeLessThan(2000);
    expect(read.result).toBe(" help");
  });

  test("100,000 mentions in a row are all left out", () => {
    const text: string = "<at>OneUptime</at>".repeat(100000);

    const read: FastestRun<string> = fastestRun({
      run: (): string => {
        return MicrosoftTeamsMentionText.removeMentions(text);
      },
      limitInMs: 2000,
    });

    expect(read.inMs).toBeLessThan(2000);
    expect(read.result).toBe("");
  });
});
