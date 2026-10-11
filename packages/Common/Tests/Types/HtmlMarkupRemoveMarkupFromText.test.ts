import {
  MarkupInTextReading,
  removeMarkupFromText,
} from "../../Types/HtmlMarkup";
import {
  MARKUP_ALPHABET,
  SINGLE_PASS_LEFTOVERS,
  WELL_FORMED_MARKUP,
} from "./HtmlMarkupCases";
import { describe, expect, it } from "@jest/globals";

/*
 * removeMarkupFromText reads markup the way Markdown read as plain text
 * (Markdown.convertToPlainText: custom SMS and email subjects) always has:
 * a tag is "<", a letter (or "/" and one) and what follows up to the first
 * ">", with no "<" before it; "<!" and "<?" start a comment, a declaration
 * or a processing instruction the same way; any other "<" is text and
 * stays. convertToPlainText took them out with one pass of that rule, so
 * where taking one out joined the text either side into another
 * ("<scr<script>ipt>"), that one stayed. These tests hold the walk to:
 *
 *   - a "<" that starts nothing stays, exactly where it was;
 *   - markup comes out, read as narrowly as before;
 *   - it comes out completely: what the walk returns holds nothing the rule
 *     takes out, and reading it again changes nothing;
 *   - it is exactly the one pass, repeated until the text stops changing -
 *     on 20,000 generated texts, for four readings - and exactly the one
 *     pass wherever one pass left no markup, so such text reads as before;
 *   - it takes time that grows with the length of the text alone, where
 *     the repeated pass takes a pass per level of nesting.
 *
 * The one pass is written here with RegExp.exec, as the reference the walk
 * is held to; nothing in product code reads markup that way any more.
 */

/*
 * The rule as one pattern, for a reading: the characters no tag holds, as a
 * character class's ranges, and the most a tag or comment holds after its
 * first character (null: no limit).
 */
function patternFor(maxLength: number | null, tagCannotHold: string): RegExp {
  const bound: string = maxLength === null ? "*" : `{0,${maxLength}}`;

  return new RegExp(
    `<(?:\\/?[A-Za-z][^<>${tagCannotHold}]${bound}|[!?][^<>]${bound})>`,
    "g",
  );
}

// Every match taken out once, left to right: one pass of the rule.
function onePass(text: string, pattern: RegExp): string {
  let read: string = "";
  let from: number = 0;

  pattern.lastIndex = 0;

  for (
    let match: RegExpExecArray | null = pattern.exec(text);
    match !== null;
    match = pattern.exec(text)
  ) {
    read += text.slice(from, match.index);
    from = match.index + match[0].length;
  }

  return read + text.slice(from);
}

// One pass after another, until the text stops changing.
function untilNothingChanges(text: string, pattern: RegExp): string {
  let read: string = text;

  for (;;) {
    const next: string = onePass(read, pattern);

    if (next === read) {
      return read;
    }

    read = next;
  }
}

// Whether the rule finds markup in a text.
function holdsMarkup(text: string, pattern: RegExp): boolean {
  return new RegExp(pattern.source).test(text);
}

/*
 * A seeded 32-bit generator, so every run checks the same texts and a
 * failure reproduces. Math.imul keeps the multiply exact; a plain "*" passes
 * 2^53, loses the low bits and soon repeats itself.
 */
function makeRandom(seed: number): (limit: number) => number {
  let state: number = seed >>> 0;

  return (limit: number): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return Math.floor((state / 4294967296) * limit);
  };
}

// Texts of up to 29 characters drawn from an alphabet.
function textsOf(
  count: number,
  seed: number,
  alphabet: ReadonlyArray<string>,
): Array<string> {
  const random: (limit: number) => number = makeRandom(seed);
  const texts: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    let text: string = "";
    const length: number = random(30);

    for (let position: number = 0; position < length; position++) {
      text += alphabet[random(alphabet.length)];
    }

    texts.push(text);
  }

  return texts;
}

// Markdown's placeholders and blank-line marks, which no tag holds there.
const MARK_RANGE: string = "\\uE000-\\uE002";
const OPEN_MARK: string = String.fromCharCode(0xe000);
const CLOSE_MARK: string = String.fromCharCode(0xe001);
const BLANK_LINE_MARK: string = String.fromCharCode(0xe002);
const OTHER_MARK: string = String.fromCharCode(0xe003);

const isMark: (code: number) => boolean = (code: number): boolean => {
  return code >= 0xe000 && code <= 0xe002;
};

interface Reading {
  name: string;
  reading: MarkupInTextReading | undefined;
  pattern: RegExp;
}

const READINGS: Array<Reading> = [
  {
    name: "with no limit",
    reading: undefined,
    pattern: patternFor(null, ""),
  },
  {
    name: "as Markdown reads it (no tag holds a mark; 65536 at most)",
    reading: { tagCannotHold: isMark, maxLength: 65536 },
    pattern: patternFor(65536, MARK_RANGE),
  },
  {
    name: "with no tag holding a mark, and 3 characters at most",
    reading: { tagCannotHold: isMark, maxLength: 3 },
    pattern: patternFor(3, MARK_RANGE),
  },
  {
    name: "with nothing after the first character",
    reading: { maxLength: 0 },
    pattern: patternFor(0, ""),
  },
];

const NO_LIMIT: RegExp = patternFor(null, "");

function read(text: string): string {
  return removeMarkupFromText(text);
}

describe("removeMarkupFromText", () => {
  it.each([
    ["a comparison", "a < b and c > d"],
    ["comparisons with no space", "x <= 5 and 1<2 and 3>2"],
    ["a heart", "Plain <3 text"],
    ["a '<' at the end", "a <"],
    ["a run of '<'", "<< 2 <<<"],
    ["arrows", "a <- b <-> c <=> d"],
    ["a '<' before a space", "< b>"],
    ["a '<' before a digit", "<1> and <2a>"],
    ["empty angle brackets", "<> and </>"],
    ["an end tag with no letter", "</ b> and </1>"],
    ["a '<' before a letter outside ASCII", "<é> <語> <😀>"],
    ["a tag that never ends", "if x <y then"],
    ["an end tag that never ends", "a </b"],
    ["a comment that never ends", "a <!-- note"],
    ["a tag that reaches another '<' first", "a <b <1> c"],
    ["a tag that reaches the end", "Map<String"],
    ["entities", "&lt;b&gt; &amp; &quot;"],
  ])("keeps %s", (_case: string, text: string) => {
    expect(read(text)).toBe(text);
  });

  it.each([
    ["a tag pair", "<p>Restarted</p>", "Restarted"],
    [
      "nested elements",
      "<p>Do <strong><em>this</em></strong>.</p>",
      "Do this.",
    ],
    ["an end tag", "a</b>c", "ac"],
    ["a self-closing tag", "one<br/>two<br />three", "onetwothree"],
    ["a tag in capitals", "<P>Upper</P><BR>", "Upper"],
    ["attributes", '<a href="/x" class="y">link</a>', "link"],
    ["a tag across lines", '<a\n  href="/docs/a_b">guide</a>', "guide"],
    ["a comment", "a<!-- note -->b", "ab"],
    ["a comment across lines", "a<!--\nnote\n-->b", "ab"],
    ["a declaration", "<!DOCTYPE html>text", "text"],
    ["a processing instruction", '<?xml version="1.0"?>text', "text"],
    ["markup beside a '<' that is text", "1 < 2 <b>bold</b>", "1 < 2 bold"],
    ["a Go nil", 'err="<nil>"', 'err=""'],
  ])("takes out %s", (_case: string, text: string, expected: string) => {
    expect(read(text)).toBe(expected);
  });

  it.each([
    [
      "a tag at its first '>', quoted or not",
      '<a title="x > y">z</a>',
      ' y">z',
    ],
    ["a comment at its first '>'", "<!-- a > b -->c", " b -->c"],
    ["a comment with '<' in it, at nothing", "<!-- a <b -->c", "<!-- a c"],
  ])(
    "reads %s, as Markdown read as plain text always has",
    (_case: string, text: string, expected: string) => {
      expect(read(text)).toBe(expected);
    },
  );

  describe("takes markup out completely", () => {
    it.each([
      ["a tag inside a tag's name", "<scr<script>ipt>alert(1)", "alert(1)"],
      ["a '<' before a tag", "<<b>script>x", "x"],
      ["tags inside a tag", "<b<i>x</i>>y", "y"],
      ["a tag inside a tag inside a tag", "<a<b<c>>>d", "d"],
      ["a comment inside a tag's name", "<scr<!-- -->ipt>x", "x"],
      ["a comment inside a comment", "<!<!-- a -->-- b -->c", "c"],
      ["a tag holding a whole tag", "<img alt='<b>x</b>' src=y>after", "after"],
      ["markup either side of a tag", "<a <b>c<d>>e", "e"],
      ["end tags inside a tag", "<x</b>y</i>>z", "z"],
    ])("%s", (_case: string, text: string, expected: string) => {
      expect(onePass(text, NO_LIMIT)).not.toBe(expected);
      expect(holdsMarkup(onePass(text, NO_LIMIT), NO_LIMIT)).toBe(true);
      expect(read(text)).toBe(expected);
    });

    it.each([
      ["a comment whose end was inside it", "<!<!---->--", "<!--"],
      ["a tag that a tag inside never lets end", "<scr<script>ipt", "<script"],
      ["a run of '<' around a tag", "<<<b>>>", "<<>>"],
      ["a tag that starts nothing once joined", "<1<b>2>", "<12>"],
    ])(
      "keeps what starts nothing once markup is out: %s",
      (_case: string, text: string, expected: string) => {
        expect(read(text)).toBe(expected);
        expect(holdsMarkup(read(text), NO_LIMIT)).toBe(false);
      },
    );

    it("leaves none of the markup one pass of /<[^>]*>/ leaves behind", () => {
      for (const text of SINGLE_PASS_LEFTOVERS) {
        const once: string = read(text);

        expect([text, holdsMarkup(once, NO_LIMIT)]).toEqual([text, false]);
        expect([text, read(once)]).toEqual([text, once]);
      }
    });
  });

  describe("a reading", () => {
    it("keeps a tag that reaches a character no tag holds", () => {
      const reading: MarkupInTextReading = { tagCannotHold: isMark };

      expect(
        removeMarkupFromText(`<b ${OPEN_MARK}0${CLOSE_MARK}>`, reading),
      ).toBe(`<b ${OPEN_MARK}0${CLOSE_MARK}>`);
      expect(
        removeMarkupFromText(`a <b\n${BLANK_LINE_MARK}\nc> d`, reading),
      ).toBe(`a <b\n${BLANK_LINE_MARK}\nc> d`);
      expect(removeMarkupFromText(`</b${OPEN_MARK}>`, reading)).toBe(
        `</b${OPEN_MARK}>`,
      );
    });

    it("lets a tag hold any other character, and a comment any but '<' and '>'", () => {
      const reading: MarkupInTextReading = { tagCannotHold: isMark };

      expect(removeMarkupFromText(`a<b ${OTHER_MARK}>c`, reading)).toBe("ac");
      expect(
        removeMarkupFromText(
          `a<!-- ${OPEN_MARK}0${CLOSE_MARK}\n${BLANK_LINE_MARK} -->b`,
          reading,
        ),
      ).toBe("ab");
    });

    it("reads a tag on once a comment holding such a character is out", () => {
      const reading: MarkupInTextReading = { tagCannotHold: isMark };

      expect(
        removeMarkupFromText(
          `<a<!-- ${OPEN_MARK}0${CLOSE_MARK} -->c>d`,
          reading,
        ),
      ).toBe("d");
      // A tag holding one is not markup, so it never comes out of another.
      expect(removeMarkupFromText(`<a<b ${OPEN_MARK}>c>d`, reading)).toBe(
        `<a<b ${OPEN_MARK}>c>d`,
      );
    });

    it("keeps markup that holds more than the most it may", () => {
      // After the first letter, "!" or "?": "bcd" is 3, "bcde" 4.
      expect(removeMarkupFromText("<abcd>x", { maxLength: 3 })).toBe("x");
      expect(removeMarkupFromText("<abcde>x", { maxLength: 3 })).toBe(
        "<abcde>x",
      );
      expect(removeMarkupFromText("</abcd>x", { maxLength: 3 })).toBe("x");
      expect(removeMarkupFromText("<!abc>x", { maxLength: 3 })).toBe("x");
      expect(removeMarkupFromText("<!abcd>x", { maxLength: 3 })).toBe(
        "<!abcd>x",
      );
      expect(removeMarkupFromText("<a>x", { maxLength: 0 })).toBe("x");
      expect(removeMarkupFromText("<ab>x", { maxLength: 0 })).toBe("<ab>x");
    });

    it("measures markup by what is left of it once what it held is out", () => {
      expect(removeMarkupFromText("<ab<c>cd>x", { maxLength: 3 })).toBe("x");
      expect(removeMarkupFromText("<ab<c>cd>x", { maxLength: 2 })).toBe(
        "<abcd>x",
      );
    });
  });

  describe("whatever it is given", () => {
    const alphabets: Array<ReadonlyArray<string>> = [
      [
        "<",
        ">",
        "/",
        "!",
        "?",
        "a",
        "b",
        "Z",
        " ",
        "\n",
        "-",
        "1",
        "é",
        "=",
        '"',
        OPEN_MARK,
        CLOSE_MARK,
        BLANK_LINE_MARK,
        OTHER_MARK,
      ],
      ["<", "<", ">", ">", "a", "/", "!", "x"],
      ["<", ">", "s", "c", "r", "i", "p", "t", "!", "-", "?", "/"],
    ];

    const generated: Array<string> = [
      ...SINGLE_PASS_LEFTOVERS,
      ...WELL_FORMED_MARKUP,
      ...textsOf(5000, 9161, MARKUP_ALPHABET),
      ...alphabets.flatMap(
        (alphabet: ReadonlyArray<string>, index: number): Array<string> => {
          return textsOf(5000, 9162 + index, alphabet);
        },
      ),
    ];

    it("generates texts that one pass does not read completely", () => {
      expect(
        generated.filter((text: string): boolean => {
          const once: string = onePass(text, NO_LIMIT);
          return onePass(once, NO_LIMIT) !== once;
        }).length,
      ).toBeGreaterThan(300);
    });

    it.each(READINGS)(
      "is the one pass repeated until the text stops changing, read $name",
      ({ reading, pattern }: Reading) => {
        const differences: Array<[string, string, string]> = [];

        for (const text of generated) {
          const walked: string = removeMarkupFromText(text, reading);
          const repeated: string = untilNothingChanges(text, pattern);

          if (walked !== repeated) {
            differences.push([text, walked, repeated]);
          }
        }

        expect(differences.slice(0, 5)).toEqual([]);
      },
    );

    it.each(READINGS)(
      "reads text one pass leaves no markup in exactly as one pass, read $name",
      ({ reading, pattern }: Reading) => {
        let compared: number = 0;

        for (const text of generated) {
          const once: string = onePass(text, pattern);

          if (holdsMarkup(once, pattern)) {
            continue;
          }

          compared++;
          expect([text, removeMarkupFromText(text, reading)]).toEqual([
            text,
            once,
          ]);
        }

        expect(compared).toBeGreaterThan(15000);
      },
    );

    it.each(READINGS)(
      "leaves nothing it takes out, and reads the same a second time, read $name",
      ({ reading, pattern }: Reading) => {
        for (const text of generated) {
          const once: string = removeMarkupFromText(text, reading);

          expect([text, holdsMarkup(once, pattern)]).toEqual([text, false]);
          expect([text, removeMarkupFromText(once, reading)]).toEqual([
            text,
            once,
          ]);
        }
      },
    );

    it("keeps every character it does not take out, in order", () => {
      for (const text of generated.slice(0, 5000)) {
        let at: number = 0;

        for (const character of read(text)) {
          at = text.indexOf(character, at);
          expect(at).toBeGreaterThanOrEqual(0);
          at += character.length;
        }
      }
    });

    it("gives back the text itself when it holds no markup", () => {
      for (const text of [
        "",
        "plain",
        "a < b",
        "a > b",
        "x <y",
        "<<<",
        "a <b <1> c",
      ]) {
        expect(read(text)).toBe(text);
      }
    });
  });

  describe("time", () => {
    // Far above what these take, so a slow machine does not fail them.
    const LIMIT_IN_MS: number = 3000;
    const SIZE: number = 1024 * 1024;
    const random: (limit: number) => number = makeRandom(2718);

    const repeatTo: (unit: string, length: number) => string = (
      unit: string,
      length: number,
    ): string => {
      return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
    };

    // A megabyte of markup and text, drawn at random.
    const mixed: () => string = (): string => {
      const pieces: Array<string> = [
        "<b>",
        "</b>",
        "<scr",
        "ipt>",
        "<!--",
        "-->",
        "<",
        ">",
        "a",
        " ",
        "\n",
      ];
      let text: string = "";

      while (text.length < SIZE) {
        text += pieces[random(pieces.length)];
      }

      return text;
    };

    it.each([
      [
        "tags nested in tags' names",
        (): string => {
          return "<a".repeat(SIZE / 4) + ">".repeat(SIZE / 4);
        },
        "",
      ],
      [
        "comments nested in comments",
        (): string => {
          return "<!".repeat(SIZE / 4) + ">".repeat(SIZE / 4);
        },
        "",
      ],
      [
        "tags that join once one is out",
        (): string => {
          return "<scr".repeat(SIZE / 8) + "<b>" + "ipt>".repeat(SIZE / 8);
        },
        "",
      ],
      [
        "lines of tags nested in tags' names",
        (): string => {
          return "<a\n".repeat(SIZE / 6) + ">\n".repeat(SIZE / 6);
        },
        null,
      ],
      [
        "a run of '<'",
        (): string => {
          return "<".repeat(SIZE);
        },
        null,
      ],
      [
        "a '<' before every tag",
        (): string => {
          return repeatTo("<<b>", SIZE);
        },
        null,
      ],
      [
        "tags that never end, then one '>'",
        (): string => {
          return repeatTo("<a ", SIZE) + ">";
        },
        null,
      ],
      ["markup and text drawn at random", mixed, null],
    ])(
      "reads %s in linear time",
      (_case: string, build: () => string, expected: string | null) => {
        const text: string = build();
        const started: number = Date.now();
        const once: string = read(text);

        expect(Date.now() - started).toBeLessThan(LIMIT_IN_MS);

        if (expected !== null) {
          expect(once).toBe(expected);
        }

        expect(holdsMarkup(once, NO_LIMIT)).toBe(false);
      },
    );
  });

  /*
   * A "<" waiting for its ">" is remembered, but a run of them with nothing
   * between counts once: sixteen million of them, remembered one by one,
   * took 350 MB.
   */
  describe("memory", () => {
    const MEGABYTE: number = 1024 * 1024;

    it.each([
      ["a run of '<' then a '>'", "<".repeat(8 * MEGABYTE) + ">"],
      ["a '<' before every tag", "<<b>".repeat(2 * MEGABYTE)],
    ])(
      "remembers %s in a few bytes, not bytes for each '<'",
      (_case: string, text: string) => {
        const before: number = process.memoryUsage().arrayBuffers;
        const once: string = read(text);
        const grew: number = process.memoryUsage().arrayBuffers - before;

        expect(holdsMarkup(once, NO_LIMIT)).toBe(false);
        expect(grew).toBeLessThan(4 * MEGABYTE);
      },
    );
  });
});
