import { describe, expect, test } from "@jest/globals";
import {
  Base64Run,
  HELD_BASE64_MIN_LENGTH,
  getBase64Runs,
  holdBackBase64Data,
} from "../../../Utils/Markdown/Base64Data";
import { HoldBackFunction } from "../../../Utils/Markdown/OverLongText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Base64 data in Markdown, kept from the parser that reads it (issue #6010).
 *
 * A synthetic monitor's screenshot reaches a description as an image whose
 * address carries the image itself, and its data - tens of thousands of
 * characters for a JPEG, millions for a PNG - is held back before a parser
 * reads the Markdown, all but its last character. The email renderer and
 * the dashboard's viewer both do, with what is tested here. What each of
 * them makes of it is tested with them (SyntheticScreenshotInEmail,
 * MarkdownViewerScreenshots).
 */

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// A real 1x1 PNG, as the probe's Buffer.toString("base64") writes it.
const PNG_1X1: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The bytes a JPEG file starts with, then random bytes: a screenshot's data.
function jpegScreenshot(byteCount: number, seed: number): string {
  const random: SeededRandom = seededRandom(seed);
  const bytes: Buffer = Buffer.alloc(byteCount);

  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;

  for (let index: number = 4; index < byteCount; index++) {
    bytes[index] = random(256);
  }

  return bytes.toString("base64");
}

// `length` characters of base64's alphabet, the same on every run.
function base64Characters(length: number, seed: number): string {
  const random: SeededRandom = seededRandom(seed);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += BASE64_ALPHABET[random(BASE64_ALPHABET.length)];
  }

  return text;
}

// The data of a base64 string, without its "=" padding.
function withoutPadding(base64: string): string {
  let end: number = base64.length;

  while (end > 0 && base64[end - 1] === "=") {
    end--;
  }

  return base64.slice(0, end);
}

/*
 * What a caller does: each held-back text gets a token, and the tokens are
 * put back to read the text again. The texts given here hold no token
 * character of their own.
 */
interface Holder {
  hold: HoldBackFunction;
  held: Array<string>;
  putBack: (text: string) => string;
}

function makeHolder(): Holder {
  const held: Array<string> = [];

  return {
    held: held,
    hold: (text: string): string => {
      held.push(text);

      return `${held.length - 1}`;
    },
    putBack: (text: string): string => {
      let restored: string = "";
      let restoredUpTo: number = 0;

      for (
        let open: number = text.indexOf("");
        open !== -1;
        open = text.indexOf("", restoredUpTo)
      ) {
        const close: number = text.indexOf("", open);

        restored +=
          text.slice(restoredUpTo, open) +
          held[Number(text.slice(open + 1, close))];
        restoredUpTo = close + 1;
      }

      return restored + text.slice(restoredUpTo);
    },
  };
}

// The issue's description template, with the screenshot the probe took.
function issueDescription(base64: string): string {
  return `Monitor is down - Timeout 30000ms exceeded\n![](data:image/jpeg;base64,${base64})`;
}

describe("getBase64Runs", () => {
  test("finds a screenshot's data, from right after ';base64,' to its padding", () => {
    const screenshot: string = jpegScreenshot(30 * 1024 + 1, 6010);
    const text: string = issueDescription(screenshot);
    const start: number = text.indexOf(";base64,") + ";base64,".length;

    // 30 KB and a byte: the data ends in "==".
    expect(screenshot.endsWith("==")).toBe(true);
    expect(getBase64Runs(text)).toEqual([
      { start: start, end: start + screenshot.length - 2 },
    ]);
  });

  test.each([";BASE64,", ";Base64,", ";bAsE64,", ";base64,"])(
    "reads %s, in any case of its letters",
    (start: string) => {
      const data: string = base64Characters(2000, 1);
      const text: string = `![](DATA:IMAGE/PNG${start}${data})`;

      expect(getBase64Runs(text)).toEqual([
        { start: text.indexOf(data), end: text.indexOf(data) + data.length },
      ]);
    },
  );

  test.each([
    ["a long s, which upper-cases to S", ";baſe64,"],
    ["a fullwidth letter", ";ｂase64,"],
    ["a dotless i in place of nothing", ";base64ı,"],
    ["no comma", ";base64"],
    ["a space before the comma", ";base64 ,"],
    ["no semicolon", "base64,"],
    ["a colon for the semicolon", ":base64,"],
  ])(
    "never reads a start of data written with %s",
    (_label: string, start: string) => {
      expect(
        getBase64Runs(`data:image/png${start}${base64Characters(2000, 2)})`),
      ).toEqual([]);
    },
  );

  test("finds runs of at least the length it is asked for: HELD_BASE64_MIN_LENGTH by default", () => {
    expect(HELD_BASE64_MIN_LENGTH).toBe(1024);

    const short: string = `;base64,${base64Characters(1023, 3)})`;
    const long: string = `;base64,${base64Characters(1024, 4)})`;

    expect(getBase64Runs(short)).toEqual([]);
    expect(getBase64Runs(long)).toEqual([{ start: 8, end: 8 + 1024 }]);
    expect(getBase64Runs(short, 1023)).toEqual([{ start: 8, end: 8 + 1023 }]);
    expect(getBase64Runs(`![](data:image/png;base64,${PNG_1X1})`, 1)).toEqual(
      [
        {
          start: 26,
          end: 26 + PNG_1X1.length - 2,
        },
      ],
    );
  });

  test.each([
    ["padding", "="],
    ["an image's closing parenthesis", ")"],
    ["a space before a title", ' "Home")'],
    ["a line break", "\nnext line"],
    ["a line break written as \\r\\n", "\r\nnext line"],
    ["base64url's minus", "-AAAA"],
    ["base64url's underscore", "_AAAA"],
    ["a percent sign", "%2BAAAA"],
    ["a token character", ""],
    ["a letter of another alphabet", "éAAAA"],
    ["an emoji", "😀AAAA"],
  ])(
    "ends a run at %s",
    (_label: string, after: string) => {
      const data: string = base64Characters(1500, 5);

      expect(getBase64Runs(`;base64,${data}${after}`)).toEqual([
        { start: 8, end: 8 + data.length },
      ]);
    },
  );

  test("finds every run, in order - one right after another too", () => {
    const first: string = base64Characters(1100, 6);
    const second: string = base64Characters(1200, 7);
    const third: string = base64Characters(3000, 8);
    const text: string = `;base64,${first};base64,${second}\n\n![a](data:image/png;base64,${third})`;
    const runs: Array<Base64Run> = getBase64Runs(text);

    expect(
      runs.map((run: Base64Run): string => {
        return text.slice(run.start, run.end);
      }),
    ).toEqual([first, second, third]);
    expect(
      getBase64Runs(";base64,AAAA;base64,BBBB;base64,", 1).map(
        (run: Base64Run): Array<number> => {
          return [run.start, run.end];
        },
      ),
    ).toEqual([
      [8, 12],
      [20, 24],
    ]);
  });

  test.each([
    ["an empty text", ""],
    ["a text with no data", "Monitor is down; see the run"],
    ["';base64,' at the very end", "data:image/png;base64,"],
    ["';base64,' with no data after it", "data:image/png;base64,)"],
    ["semicolons alone", ";;;;;;;;;;"],
  ])("finds nothing in %s", (_label: string, text: string) => {
    expect(getBase64Runs(text, 1)).toEqual([]);
  });

  test("finds nothing in a value that is not a string", () => {
    expect(getBase64Runs(undefined as unknown as string)).toEqual([]);
    expect(getBase64Runs(null as unknown as string)).toEqual([]);
  });
});

describe("holdBackBase64Data", () => {
  test("holds back the data of the issue's 30 KB JPEG screenshot, all but its last character", () => {
    const screenshot: string = jpegScreenshot(30 * 1024 + 1, 6010);
    const data: string = withoutPadding(screenshot);
    const text: string = issueDescription(screenshot);
    const holder: Holder = makeHolder();

    const markdown: string = holdBackBase64Data(text, holder.hold);

    expect(holder.held).toEqual([data.slice(0, -1)]);
    expect(markdown).toBe(
      `Monitor is down - Timeout 30000ms exceeded\n![](data:image/jpeg;base64,0${data.slice(-1)}==)`,
    );
    expect(holder.putBack(markdown)).toBe(text);
  });

  test("leaves data shorter than HELD_BASE64_MIN_LENGTH where it is, and the text the same string", () => {
    const holder: Holder = makeHolder();
    const tiny: string = `Down\n![](data:image/png;base64,${PNG_1X1})`;
    const justShort: string = `Down ${"x".repeat(2000)}\n![](data:image/png;base64,${base64Characters(HELD_BASE64_MIN_LENGTH - 1, 9)})`;

    expect(holdBackBase64Data(tiny, holder.hold)).toBe(tiny);
    expect(holdBackBase64Data(justShort, holder.hold)).toBe(justShort);
    expect(holdBackBase64Data("abc", holder.hold)).toBe("abc");
    expect(holder.held).toEqual([]);
  });

  test("holds back the data of the least length it holds back", () => {
    const data: string = base64Characters(HELD_BASE64_MIN_LENGTH, 10);
    const holder: Holder = makeHolder();

    expect(
      holdBackBase64Data(`![](data:image/png;base64,${data})`, holder.hold),
    ).toBe(`![](data:image/png;base64,0${data.slice(-1)})`);
    expect(holder.held).toEqual([data.slice(0, -1)]);
  });

  test("holds back each screenshot of a description on its own, in order", () => {
    const shots: Array<string> = [
      jpegScreenshot(12 * 1024, 11),
      jpegScreenshot(30 * 1024, 12),
      jpegScreenshot(47 * 1024, 13),
    ];
    const text: string = [
      "**Checkout failed** on step 3:",
      `![Home](data:image/jpeg;base64,${shots[0]})`,
      `![Cart](data:image/png;base64,${shots[1]} "The cart")`,
      "",
      `- ![Payment](data:image/jpeg;base64,${shots[2]})`,
      `- ![Logo](data:image/png;base64,${PNG_1X1})`,
    ].join("\n");
    const holder: Holder = makeHolder();

    const markdown: string = holdBackBase64Data(text, holder.hold);

    expect(holder.held).toEqual(
      shots.map((shot: string): string => {
        return withoutPadding(shot).slice(0, -1);
      }),
    );
    expect(markdown.length).toBeLessThan(500);
    expect(markdown).toContain(`![Logo](data:image/png;base64,${PNG_1X1})`);
    expect(holder.putBack(markdown)).toBe(text);
  });

  test.each([
    ["a link to a file", "[The report](data:application/pdf;base64,"],
    ["an SVG image", "![Graph](data:image/svg+xml;base64,"],
    ["an HTML image", '<img src="data:image/png;base64,'],
    ["a reference definition", "[home]: data:image/png;base64,"],
    ["a sentence", "The probe sent payload;base64,"],
    ["a code span", "`data:image/png;base64,"],
  ])(
    "holds back long base64 data after any ';base64,': %s",
    (_label: string, before: string) => {
      const data: string = base64Characters(5000, 14);
      const text: string = `${before}${data}) and after`;
      const holder: Holder = makeHolder();

      const markdown: string = holdBackBase64Data(text, holder.hold);

      expect(markdown).toBe(
        `${before}0${data.slice(-1)}) and after`,
      );
      expect(holder.putBack(markdown)).toBe(text);
    },
  );

  test.each([
    ["an image's closing parenthesis", ")"],
    ["padding and the parenthesis", "==)"],
    ["one padding character", "=)"],
    ["a title", ' "The home page")'],
    ["emphasis right after the data", "**bold**"],
    ["an underscore right after the data", "_word_"],
    ["a line break and a paragraph", "\n\nThe next paragraph"],
    ["the end of the text", ""],
  ])(
    "keeps what follows the data as it was, after its last character: %s",
    (_label: string, after: string) => {
      const data: string = base64Characters(2000, 15);
      const holder: Holder = makeHolder();

      expect(
        holdBackBase64Data(`;base64,${data}${after}`, holder.hold),
      ).toBe(`;base64,0${data.slice(-1)}${after}`);
    },
  );

  test("generated texts of data, Markdown and line breaks: what it holds back is what a plain reading finds, and all of it comes back", () => {
    const alphabet: ReadonlyArray<string> = [
      ";base64,",
      ";BASE64,",
      ";Base64,",
      ";base64",
      "data:image/png",
      "![",
      "](",
      ")",
      "=",
      "==",
      "\n",
      "\r\n",
      " ",
      "*",
      "_",
      "`",
      "[",
      "]",
      "<",
      "%",
      "é",
      "😀",
      "+/",
      "A",
      base64Characters(300, 16),
      base64Characters(1023, 17),
      base64Characters(1100, 18),
      base64Characters(2500, 19),
      // A screenshot's data, whole: these texts hold one often.
      `;base64,${base64Characters(1024, 22)}`,
      `;BASE64,${base64Characters(1800, 23)}==`,
      `![](data:image/png;base64,${base64Characters(1023, 24)}`,
    ];
    const texts: Array<string> = generatedTexts(1500, 6010, alphabet, 12);
    let heldSome: number = 0;

    for (const text of texts) {
      const holder: Holder = makeHolder();
      const markdown: string = holdBackBase64Data(text, holder.hold);

      /*
       * A plain reading of the same rule, on these short texts: a run of
       * base64 after ";base64," in any case, of HELD_BASE64_MIN_LENGTH or
       * more, all but its last character.
       */
      const expected: Array<string> = Array.from(
        text.matchAll(/;base64,([A-Za-z0-9+/]+)/gi),
      )
        .map((match: RegExpMatchArray): string => {
          return match[1]!;
        })
        .filter((data: string): boolean => {
          return data.length >= HELD_BASE64_MIN_LENGTH;
        })
        .map((data: string): string => {
          return data.slice(0, -1);
        });

      expect({ text: text, held: holder.held }).toEqual({
        text: text,
        held: expected,
      });
      expect(holder.putBack(markdown)).toBe(text);
      // Nothing long enough to hold back is left.
      expect(getBase64Runs(markdown)).toEqual([]);

      if (holder.held.length > 0) {
        heldSome++;
      } else {
        expect(markdown).toBe(text);
      }
    }

    // The texts hold screenshots often enough to tell.
    expect(heldSome).toBeGreaterThan(300);
  });

  test("reads sixteen megabytes of every shape in time that grows with its length", () => {
    const sixteenMegabytes: number = 16 * 1024 * 1024;
    const repeatTo: (unit: string) => string = (unit: string): string => {
      return unit.repeat(Math.ceil(sixteenMegabytes / unit.length));
    };
    const shapes: Array<[string, string, number]> = [
      [
        "one screenshot",
        `Down\n![](data:image/png;base64,${repeatTo("iVBO+/ab")})`,
        1,
      ],
      ["semicolons", repeatTo(";"), 0],
      ["starts of data with none after them", repeatTo(";base64,"), 0],
      ["starts of data with a character each", repeatTo(";base64,A"), 0],
      [
        "data a character short of being held back",
        repeatTo(`;BASE64,${base64Characters(1023, 20)}=`),
        0,
      ],
      [
        "screenshots one after another",
        repeatTo(`![](data:image/png;base64,${base64Characters(1500, 21)})`),
        Math.ceil(sixteenMegabytes / 1527),
      ],
    ];

    for (const [name, text, heldCount] of shapes) {
      let held: number = 0;
      const timed: FastestRun<string> = fastestRun({
        run: (): string => {
          held = 0;

          return holdBackBase64Data(text, (): string => {
            held++;

            return "";
          });
        },
        limitInMs: 2000,
      });

      expect({ name: name, held: held }).toEqual({
        name: name,
        held: heldCount,
      });
      expect({ name: name, inMs: timed.inMs < 2000 }).toEqual({
        name: name,
        inMs: true,
      });
    }
  });
});
