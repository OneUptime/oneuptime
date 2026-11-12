import {
  LinkReferenceDefinition,
  forEachBracketedLabel,
  getLinkReferenceDefinitions,
  normalizeLinkLabel,
} from "../../../Utils/Markdown/LinkReferenceDefinitions";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  MarkedReferences,
  isDefined,
  markedLinks,
  readMarkedReferences,
} from "../../Helpers/MarkedLinks";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { Links } from "marked";

/*
 * LINK REFERENCE DEFINITIONS, FOUND WHERE MARKED FINDS THEM (#6962, #6963).
 *
 * An email field cut to fit keeps the definitions its kept references need,
 * and a field sent as text shows a definition's screenshot rather than its
 * base64: both read the text's definitions with
 * Utils/Markdown/LinkReferenceDefinitions. These hold it to marked 12,
 * which renders the email: the same labels, the same first definition of
 * each, the same address and title - by hand for each form, and against
 * marked's own reading on generated texts - and to time that grows with the
 * text, whatever its shape: a definition's address can be megabytes of
 * base64 on one line.
 */

// The definitions found, as they are written.
interface Written {
  label: string;
  labelAsWritten: string;
  destination: string;
  whole: string;
}

const found: (text: string) => Array<Written> = (
  text: string,
): Array<Written> => {
  return getLinkReferenceDefinitions(text).map(
    (definition: LinkReferenceDefinition): Written => {
      return {
        label: definition.label,
        labelAsWritten: text.slice(definition.labelStart, definition.labelEnd),
        destination: text.slice(
          definition.destinationStart,
          definition.destinationEnd,
        ),
        whole: text.slice(definition.start, definition.end),
      };
    },
  );
};

// Every label forEachBracketedLabel calls back with, in order.
const bracketedLabels: (
  text: string,
  start?: number,
  end?: number,
) => Array<string> = (
  text: string,
  start: number = 0,
  end: number = text.length,
): Array<string> => {
  const labels: Array<string> = [];

  forEachBracketedLabel(text, start, end, (label: string): void => {
    labels.push(label);
  });

  return labels;
};

/*
 * Lines this finder says it does not read as marked does (see the top of
 * LinkReferenceDefinitions): a quote, a list item, HTML, a table row and a
 * setext heading's underline. Generated texts holding one are not compared.
 */
const UNREAD_CONTEXT_LINE: RegExp =
  /^ {0,3}(?:>|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|<|\||(?:=+|-+) *$)/;

const holdsUnreadContext: (text: string) => boolean = (
  text: string,
): boolean => {
  return text.split("\n").some((line: string): boolean => {
    return UNREAD_CONTEXT_LINE.test(line);
  });
};

/*
 * What is wrong with the definitions found in `text`, held to marked's
 * reading; null when nothing is. The first definition of each label is the
 * one marked reads: on its own it must be read as the same address and
 * title, and cut after its address it must still define that address.
 */
const differenceFromMarked: (text: string) => string | null = (
  text: string,
): string | null => {
  const links: Links = markedLinks(text);
  const first: Map<string, LinkReferenceDefinition> = new Map<
    string,
    LinkReferenceDefinition
  >();

  for (const definition of getLinkReferenceDefinitions(text)) {
    if (
      text.charAt(definition.labelStart - 1) !== "[" ||
      text.slice(definition.labelEnd, definition.labelEnd + 2) !== "]:" ||
      definition.label !==
        normalizeLinkLabel(
          text.slice(definition.labelStart, definition.labelEnd),
        )
    ) {
      return `a definition's label is not where it says: ${JSON.stringify(definition)}`;
    }

    if (!first.has(definition.label)) {
      first.set(definition.label, definition);
    }
  }

  const expected: Array<string> = Object.keys(links).sort();
  const actual: Array<string> = Array.from(first.keys()).sort();

  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    return `labels ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`;
  }

  for (const [label, definition] of first) {
    const want: Links[string] = links[label]!;
    const alone: Links = markedLinks(
      text.slice(definition.start, definition.end),
    );

    if (
      Object.keys(alone).length !== 1 ||
      alone[label]?.href !== want.href ||
      alone[label]?.title !== want.title
    ) {
      return `${JSON.stringify(label)} alone is ${JSON.stringify(alone)}, marked read ${JSON.stringify(want)}`;
    }

    const withoutTitle: Links = markedLinks(
      text.slice(definition.start, definition.destinationEnd),
    );

    if (withoutTitle[label]?.href !== want.href) {
      return `${JSON.stringify(label)} without its title is ${JSON.stringify(withoutTitle)}`;
    }
  }

  return null;
};

// The labels marked looked up in `text` and found defined.
const labelsMarkedResolves: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const read: MarkedReferences = readMarkedReferences(text);

  return read.lookedUp.filter((label: string): boolean => {
    return isDefined(read.links, label);
  });
};

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

describe("normalizeLinkLabel", () => {
  test("lower case, each run of white space one space, as marked matches a label", () => {
    expect(normalizeLinkLabel("Home Page")).toBe("home page");
    expect(normalizeLinkLabel("HOME   page")).toBe("home page");
    expect(normalizeLinkLabel("Home\t\n Page")).toBe("home page");
    expect(normalizeLinkLabel(`Home${NO_BREAK_SPACE}Page`)).toBe("home page");
    expect(normalizeLinkLabel(`a${LINE_SEPARATOR}b`)).toBe("a b");
  });

  test("not trimmed, and escapes stay as written: marked does neither", () => {
    expect(normalizeLinkLabel(" home ")).toBe(" home ");
    expect(normalizeLinkLabel("\thome\n")).toBe(" home ");
    expect(normalizeLinkLabel("a\\]b")).toBe("a\\]b");
  });

  test("a label already as marked makes it is returned as it is", () => {
    const label: string = "already normal";

    expect(normalizeLinkLabel(label)).toBe(label);
  });

  test("every generated label is the key marked defines it by", () => {
    const labels: Array<string> = generatedTexts(3000, 6963, [
      "a",
      "B",
      " ",
      "  ",
      "\t",
      "\n",
      NO_BREAK_SPACE,
      "\\]",
      "\\[",
      "\\\\",
      "-",
      "É",
      "ß",
    ]);
    let compared: number = 0;

    for (const label of labels) {
      const keys: Array<string> = Object.keys(
        markedLinks(`[${label}]: /address`),
      );

      if (keys.length === 0) {
        // Not a label marked reads: empty, all white space, or a blank line.
        continue;
      }

      compared++;
      expect([label, normalizeLinkLabel(label)]).toEqual([label, keys[0]]);
    }

    expect(compared).toBeGreaterThan(2000);
  });
});

describe("getLinkReferenceDefinitions - the forms marked reads", () => {
  test.each([
    ["an address", "[home]: https://example.com", "https://example.com", ""],
    [
      "an address in angle brackets, a space in it",
      "[home]: <https://example.com/a b>",
      "<https://example.com/a b>",
      "",
    ],
    [
      "a title in double quotes",
      '[home]: /a "The title"',
      "/a",
      ' "The title"',
    ],
    [
      "a title in single quotes",
      "[home]: /a 'The title'",
      "/a",
      " 'The title'",
    ],
    ["a title in parentheses", "[home]: /a (The title)", "/a", " (The title)"],
    [
      "a title on the next line",
      '[home]: /a\n   "The title"',
      "/a",
      '\n   "The title"',
    ],
    [
      "the address on the next line",
      '[home]:\n  /a "The title"',
      "/a",
      ' "The title"',
    ],
    ["no space after the colon", "[home]:/a", "/a", ""],
    ["three spaces before it", "   [home]: /a", "/a", ""],
    [
      "a double-quoted title over a blank line",
      '[home]: /a "one\n\ntwo"',
      "/a",
      ' "one\n\ntwo"',
    ],
    [
      "a double-quoted title with a quote a backslash keeps",
      '[home]: /a "say \\"hi\\""',
      "/a",
      ' "say \\"hi\\""',
    ],
    ["spaces after it", "[home]: /a   ", "/a", ""],
    [
      "a data: address of base64",
      "[home]: data:image/png;base64,iVBORw0KGgo=",
      "data:image/png;base64,iVBORw0KGgo=",
      "",
    ],
  ])(
    "%s",
    (_name: string, text: string, destination: string, title: string) => {
      const definitions: Array<Written> = found(text);

      expect(definitions).toHaveLength(1);
      expect(definitions[0]!.destination).toBe(destination);
      expect(definitions[0]!.label).toBe("home");
      expect(definitions[0]!.whole.endsWith(`${destination}${title}`)).toBe(
        true,
      );
      // marked reads it the same.
      expect(differenceFromMarked(text)).toBeNull();
      expect(Object.keys(markedLinks(text))).toEqual(["home"]);
    },
  );

  test.each([
    ["four spaces: indented code", "    [home]: /a"],
    ["a tab: indented code", "\t[home]: /a"],
    ["an empty label", "[]: /a"],
    ["a label of white space", "[  ]: /a"],
    ["a bracket in the label", "[ho[me]: /a"],
    ["nothing after the colon", "[home]:"],
    ["only spaces after the colon", "[home]:   "],
    ["no colon", "[home] /a"],
    ["text after the title", '[home]: /a "The title" and more'],
    ["text after the address", "[home]: /a and more"],
    ["an angle bracket the line does not close", "[home]: <a b"],
    ["a backslash before the label's line break", "[ho\\\nme]: /a"],
    ["two line breaks before the address", "[home]:\n\n/a"],
  ])("none: %s", (_name: string, text: string) => {
    expect(found(text)).toEqual([]);
    expect(markedLinks(text)).toEqual({});
  });

  test("a title its line does not end after is no title: the definition ends after its address, and the title's line is text", () => {
    const text: string = '[home]: /a\n"The title" and more';

    expect(found(text)).toEqual([
      {
        label: "home",
        labelAsWritten: "home",
        destination: "/a",
        whole: "[home]: /a",
      },
    ]);
    expect(markedLinks(text)).toEqual({
      home: { href: "/a", title: undefined },
    });
  });

  test("a label runs over lines, keeps its escapes and case as written, and matches normalized", () => {
    const text: string = "[Home\n  Page \\] B]: /a";

    expect(found(text)).toEqual([
      {
        label: "home page \\] b",
        labelAsWritten: "Home\n  Page \\] B",
        destination: "/a",
        whole: text,
      },
    ]);
    expect(Object.keys(markedLinks(text))).toEqual(["home page \\] b"]);
  });

  test("a label defined twice is found twice, in order: marked reads the first", () => {
    const text: string = "[home]: /first\n[HOME]: /second";

    expect(
      found(text).map((definition: Written): string => {
        return definition.destination;
      }),
    ).toEqual(["/first", "/second"]);
    expect(markedLinks(text)["home"]!.href).toBe("/first");
  });

  test("where each definition starts and ends", () => {
    const text: string =
      'Intro.\n\n  [one]: /a "Title"   \n[two]: <b c>\n\nAfter.';
    const definitions: Array<LinkReferenceDefinition> =
      getLinkReferenceDefinitions(text);

    expect(definitions).toEqual([
      {
        start: 8,
        labelStart: 11,
        labelEnd: 14,
        label: "one",
        destinationStart: 17,
        destinationEnd: 19,
        end: 27,
      },
      {
        start: 31,
        labelStart: 32,
        labelEnd: 35,
        label: "two",
        destinationStart: 38,
        destinationEnd: 43,
        end: 43,
      },
    ]);
    expect(text.slice(8, 27)).toBe('  [one]: /a "Title"');
    expect(text.slice(31, 43)).toBe("[two]: <b c>");
  });

  test("a text with no definition-shaped colon is not read further", () => {
    expect(getLinkReferenceDefinitions("[home] and [away]")).toEqual([]);
    expect(getLinkReferenceDefinitions("")).toEqual([]);
  });
});

describe("getLinkReferenceDefinitions - where marked looks", () => {
  test.each([
    ["the first line", "[a]: /a\nText"],
    ["after a blank line", "Text\n\n[a]: /a"],
    ["after a line of spaces and tabs", "Text\n  \t \n[a]: /a"],
    ["right after another definition", "[b]: /b\n[a]: /a"],
    ["right after an ATX heading", "# Heading\n[a]: /a"],
    ["right after an ATX heading of six", "###### Heading\n[a]: /a"],
    ["right after a thematic break", "Text\n\n***\n[a]: /a"],
    ["right after a thematic break of spaced marks", "_ _ _\n[a]: /a"],
    ["right after a fenced code block", "```\ncode\n```\n[a]: /a"],
    ["right after a fence of tildes", "~~~~\ncode\n~~~~~\n[a]: /a"],
    ["right after indented code", "    code\n[a]: /a"],
    ["after indented code over a blank line", "    code\n\n    more\n[a]: /a"],
  ])("found at %s", (_name: string, text: string) => {
    const labels: Array<string> = found(text).map(
      (definition: Written): string => {
        return definition.label;
      },
    );

    expect(labels[labels.length - 1]).toBe("a");
    expect(labels).toEqual(Object.keys(markedLinks(text)));
  });

  test.each([
    ["a line that carries on a paragraph", "Text\n[a]: /a"],
    ["inside a fenced code block", "```\n[a]: /a\n```"],
    ["inside a fence of tildes", "~~~\n[a]: /a\n~~~"],
    ["inside a fence a shorter run does not close", "````\n```\n[a]: /a\n````"],
    [
      "inside a fence a run of the other mark does not close",
      "```\n~~~\n[a]: /a\n```",
    ],
    ["inside a fence that never closes", "```js\n\n[a]: /a"],
    ["inside indented code", "    code\n    [a]: /a"],
    ["after seven hashes: a paragraph", "####### Text\n[a]: /a"],
    ["after a hash with no space: a paragraph", "#Text\n[a]: /a"],
    [
      "after a heading line that holds a line separator: a paragraph",
      `# Head${LINE_SEPARATOR}ing\n[a]: /a`,
    ],
  ])("none %s", (_name: string, text: string) => {
    expect(found(text)).toEqual([]);
    expect(markedLinks(text)).toEqual({});
  });

  test("an opening backtick fence with a backtick after it on its line is no fence: what follows is read", () => {
    const text: string = "``` a`b\n\n[a]: /a";

    expect(found(text)).toHaveLength(1);
    expect(Object.keys(markedLinks(text))).toEqual(["a"]);
  });

  /*
   * What the finder says it does not read as marked does, held here so a
   * change to either is seen: each is rare in a description, and costs no
   * more than a reference a cut field shows as Markdown, or a definition it
   * keeps that nothing reads.
   */
  test.each([
    ["inside a block quote", "> [a]: /a"],
    ["inside a list item indented four spaces", "- item\n\n    [a]: /a"],
    ["right after a setext heading", "Heading\n===\n[a]: /a"],
  ])("not found, where marked reads one: %s", (_name: string, text: string) => {
    expect(found(text)).toEqual([]);
    expect(Object.keys(markedLinks(text))).toEqual(["a"]);
  });

  test("found inside an HTML comment over blank lines, which marked reads as HTML", () => {
    const text: string = "<!--\n\n[a]: /a\n\n-->";

    expect(found(text)).toHaveLength(1);
    expect(markedLinks(text)).toEqual({});
  });
});

describe("getLinkReferenceDefinitions - against marked's own reading", () => {
  // Pieces of definitions and of what surrounds them.
  const ALPHABET: ReadonlyArray<string> = [
    "[a]",
    "[a]:",
    "[A]: ",
    "[b]: ",
    "[ a ]:",
    "[a\nb]:",
    "[a\\]b]:",
    "[\\\\]:",
    "[]:",
    "[ ]:",
    " ",
    "  ",
    "   ",
    "    ",
    "\t",
    "\n",
    "\n\n",
    "\n  ",
    "\n\t",
    "x",
    "url",
    "https://e.com/a",
    "<u>",
    "<u v>",
    "<",
    ">",
    "<>",
    '"',
    '"t"',
    '"t\\"',
    '\\"',
    "'",
    "'t'",
    "'t\nu'",
    "(",
    ")",
    "(t)",
    "\\",
    "\\[",
    "]",
    "[",
    "# h",
    "## ",
    "```",
    "~~~",
    "`",
    "***",
    "[x][a]",
    "![y][a]",
    "[a][]",
    "text",
    " more",
    "&",
    "*e*",
  ];

  test("generated texts: the same labels, and the same address and title for the first of each", () => {
    let compared: number = 0;
    let withDefinitions: number = 0;
    const differences: Array<string> = [];

    for (const text of generatedTexts(30000, 6962, ALPHABET, 24)) {
      if (holdsUnreadContext(text)) {
        continue;
      }

      compared++;

      if (Object.keys(markedLinks(text)).length > 0) {
        withDefinitions++;
      }

      const difference: string | null = differenceFromMarked(text);

      if (difference !== null) {
        differences.push(`${JSON.stringify(text)}: ${difference}`);
      }
    }

    expect(differences.slice(0, 5)).toEqual([]);
    // The texts are worth comparing: many hold definitions marked reads.
    expect(compared).toBeGreaterThan(20000);
    expect(withDefinitions).toBeGreaterThan(1500);
  });

  test("generated lines that start like definitions, with every kind of tail", () => {
    const starts: ReadonlyArray<string> = [
      "[a]:",
      "[A]: ",
      " [b]:",
      "   [c]: ",
      "    [d]: ",
      "\t[e]: ",
      "[a b]:",
      "[a\\]]:",
      "[ ]:",
      "text",
      "# h",
      "```",
      "~~~",
      "***",
      "",
      "  ",
      "[a]:\n",
      "[f]:\n  ",
      "[g]:\n\t",
      "    code",
    ];
    const tails: ReadonlyArray<string> = [
      "u",
      "<u>",
      "<u v>",
      "<>",
      "<a>b>",
      "<a> >",
      'x"t"',
      ' "t"',
      " 't'",
      " (t)",
      ' "a\\"',
      '"',
      "'",
      "(",
      ")",
      '\n"t"',
      "\n  't\nu'",
      "\n(p)",
      ' "a\nb"',
      " 'a\n\nb'",
      " (a\n\nb)",
      " (a(b)",
      '\\"',
      "\\",
      " ",
      "\t",
      "\n",
      "\n\n",
      " ok",
      '""',
      " ''",
      " ()",
      "y z",
      "<a b>",
      ' "a\\"\n',
    ];
    const random: SeededRandom = seededRandom(6963);
    let compared: number = 0;
    let withDefinitions: number = 0;
    const differences: Array<string> = [];

    for (let index: number = 0; index < 20000; index++) {
      const lines: Array<string> = [];
      const lineCount: number = 1 + random(6);

      for (let line: number = 0; line < lineCount; line++) {
        let written: string = starts[random(starts.length)]!;
        const tailCount: number = random(5);

        for (let tail: number = 0; tail < tailCount; tail++) {
          written += tails[random(tails.length)]!;
        }

        lines.push(written);
      }

      const text: string = lines.join(random(2) === 0 ? "\n" : "\n\n");

      if (holdsUnreadContext(text)) {
        continue;
      }

      compared++;

      if (Object.keys(markedLinks(text)).length > 0) {
        withDefinitions++;
      }

      const difference: string | null = differenceFromMarked(text);

      if (difference !== null) {
        differences.push(`${JSON.stringify(text)}: ${difference}`);
      }
    }

    expect(differences.slice(0, 5)).toEqual([]);
    expect(compared).toBeGreaterThan(15000);
    expect(withDefinitions).toBeGreaterThan(6000);
  });
});

describe("forEachBracketedLabel", () => {
  test("the label of every pair of brackets that holds no other, as references write it", () => {
    expect(
      bracketedLabels("![Alt][Home] [Text][ HOME ] [home][] [Home]"),
    ).toEqual(["alt", "home", "text", " home ", "home", "home"]);
  });

  test("the innermost pair only: a link's text around a reference is no label", () => {
    expect(bracketedLabels("[![Shot][s]](https://example.com)")).toEqual([
      "shot",
      "s",
    ]);
    expect(bracketedLabels("[a [b] c]")).toEqual(["b"]);
  });

  test("brackets a backslash escapes are no brackets, and stay in a label as written", () => {
    expect(bracketedLabels("\\[a] [b\\]c] \\\\[d]")).toEqual(["b\\]c", "d"]);
  });

  test("an empty pair, or one of white space, is no label", () => {
    expect(bracketedLabels("[] [  ] [\n] [x]")).toEqual(["x"]);
  });

  test("labels run over lines and are normalized as marked matches them", () => {
    expect(bracketedLabels("[Home\n   Page]")).toEqual(["home page"]);
  });

  test("only what lies between start and end", () => {
    const text: string = "[a] [b] [c]";

    expect(bracketedLabels(text, 3, 8)).toEqual(["b"]);
    expect(bracketedLabels(text, 0, 2)).toEqual([]);
    // A backslash at the end escapes nothing past it.
    expect(bracketedLabels("[a\\", 0, 3)).toEqual([]);
  });

  test("every label marked looks up and finds, in generated texts, is one it calls back with", () => {
    const alphabet: ReadonlyArray<string> = [
      "[a]",
      "[A]",
      "[a][]",
      "[x][a]",
      "![y][A]",
      "[a b]",
      "[A\n B]",
      "[a\\]b]",
      "[[a]]",
      "`",
      "\\[",
      "\\]",
      "[",
      "]",
      " ",
      "\n",
      "\n\n",
      "text",
      "*",
      "\n\n[a]: /a\n\n",
      "\n\n[a b]: /b\n\n",
      "\n\n[a\\]b]: /c\n\n",
      "\n\n[x]: /x\n\n",
    ];
    let resolved: number = 0;
    const missed: Array<string> = [];

    for (const text of generatedTexts(6000, 6481, alphabet, 20)) {
      const labels: Set<string> = new Set<string>(bracketedLabels(text));

      for (const label of labelsMarkedResolves(text)) {
        resolved++;

        if (!labels.has(label)) {
          missed.push(`${JSON.stringify(text)}: ${JSON.stringify(label)}`);
        }
      }
    }

    expect(missed.slice(0, 5)).toEqual([]);
    expect(resolved).toBeGreaterThan(3500);
  });
});

describe("Link reference definitions - read in time that grows with the text", () => {
  const LIMIT_IN_MS: number = 2000;
  const FOUR_MEGABYTES: number = 4 * 1024 * 1024;
  /*
   * A text of a definition on every line or two makes an object of each:
   * a megabyte of it is a hundred thousand definitions.
   */
  const ONE_MEGABYTE: number = 1024 * 1024;

  // How many times `unit` is in repeated(unit, length).
  const timesRepeated: (unit: string, length?: number) => number = (
    unit: string,
    length: number = FOUR_MEGABYTES,
  ): number => {
    return Math.ceil(length / unit.length);
  };

  // `unit` again and again, to about `length` characters.
  const repeated: (unit: string, length?: number) => string = (
    unit: string,
    length: number = FOUR_MEGABYTES,
  ): string => {
    return unit.repeat(timesRepeated(unit, length));
  };

  test.each([
    [
      "a definition of four megabytes of base64",
      `[s]: data:image/png;base64,${"iVBO".repeat(FOUR_MEGABYTES / 4)}`,
      1,
    ],
    ["a title of four megabytes", `[s]: /a "${"t".repeat(FOUR_MEGABYTES)}"`, 1],
    ["double-quoted titles that never close", repeated('[a]: /u "x\n\n'), 0],
    ["single-quoted titles that never close", repeated("[a]: /u 'x\n\n"), 0],
    ["parenthesized titles that never close", repeated("[a]: /u (x\n\n"), 0],
    [
      "double-quoted titles whose escaped quotes end their lines: each a title",
      repeated('[a]: /u "x\\"\n\n', ONE_MEGABYTE),
      timesRepeated('[a]: /u "x\\"\n\n', ONE_MEGABYTE),
    ],
    /*
     * What a title is closed by lies at the end of the text, past every
     * line that looks for it: it is looked for once, not once a line. (The
     * last line's title runs to it.)
     */
    [
      "double-quoted titles freed only at the end of the text",
      `${repeated('[a]: /u "x\\"y\n# h\n')}"`,
      1,
    ],
    [
      "single-quoted titles with no blank line after them",
      repeated("[a]: /u 'x\n# h\n"),
      0,
    ],
    [
      "parenthesized titles closed only at the end of the text",
      `${repeated("[a]: /u (x\n# h\n")})`,
      1,
    ],
    ["labels that never close", repeated("[aaaaaaaa\n\n"), 0],
    ["a label that never closes", `[${"a".repeat(FOUR_MEGABYTES)}`, 0],
    [
      "angle brackets closed again and again on one line: the last one closes it",
      `[a]: <${"x>".repeat(FOUR_MEGABYTES / 2)}`,
      1,
    ],
    ["a fence that never closes", `\`\`\`\n${repeated("[a]: /u\n")}`, 0],
    [
      "definitions, line after line",
      repeated("[a]: /u\n", ONE_MEGABYTE),
      timesRepeated("[a]: /u\n", ONE_MEGABYTE),
    ],
    [
      "headings between definitions",
      repeated("# h\n[a]: /u\n", ONE_MEGABYTE),
      timesRepeated("# h\n[a]: /u\n", ONE_MEGABYTE),
    ],
    [
      "definitions with titles over two lines",
      repeated("[a]: /u\n  'one\ntwo'\n", ONE_MEGABYTE),
      timesRepeated("[a]: /u\n  'one\ntwo'\n", ONE_MEGABYTE),
    ],
    ["colons and brackets", repeated("]:["), 0],
  ])(
    "getLinkReferenceDefinitions: %s",
    (_name: string, text: string, count: number) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return getLinkReferenceDefinitions(text).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.result).toBe(count);
      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    },
  );

  test.each([
    ["opening brackets", repeated("[")],
    ["closing brackets", repeated("]")],
    ["short labels", repeated("[a]")],
    ["escaped brackets", repeated("\\[")],
    ["one label of four megabytes", `[${"A b".repeat(FOUR_MEGABYTES / 3)}]`],
    ["labels of white space", repeated("[ \t ]")],
  ])("forEachBracketedLabel: %s", (_name: string, text: string) => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        let labels: number = 0;

        forEachBracketedLabel(text, 0, text.length, (): void => {
          labels++;
        });

        return labels;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
  });
});
