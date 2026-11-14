import {
  LinkReferenceDefinition,
  MAX_DEFINITION_NESTING_DEPTH,
  NestedLinkReferenceDefinition,
  forEachBracketedLabel,
  getLinkReferenceDefinitions,
  normalizeLinkLabel,
} from "../../../Utils/Markdown/LinkReferenceDefinitions";
import { SLOW_MARKDOWN_MAX_NESTING_DEPTH } from "../../../Utils/Markdown/SlowMarkdown";
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
 * LINK REFERENCE DEFINITIONS, FOUND WHERE MARKED FINDS THEM (#6962, #6963,
 * #7230).
 *
 * An email field cut to fit keeps the definitions its kept references need,
 * and a field sent as text shows a definition's screenshot rather than its
 * base64: both read the text's definitions with
 * Utils/Markdown/LinkReferenceDefinitions. These hold it to marked 12,
 * which renders the email: the same labels, the same first definition of
 * each, the same address and title - by hand for each form and for each
 * place marked reads one (in a block quote or a list item, right after a
 * setext heading or an HTML block; never inside HTML, code, a table or a
 * paragraph), and against marked's own reading on generated texts of every
 * kind of block - and to time that grows with the text, whatever its
 * shape: a definition's address can be megabytes of base64 on one line,
 * and quotes and lists nest.
 *
 * A definition in a quote or a list item is found where it is, and as
 * marked reads it there (`nested`): without the quote's markers and the
 * item's indentation, which is what a cut field writes on a line of its
 * own. Held to marked as the whole text's definitions are: that text alone
 * defines the same address and title, and so does it without its title.
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
 * A definition as marked reads it: its text - in a quote or a list item,
 * `nested`, without the markers and indentation of its lines - and where
 * its label and the end of its address are in that.
 */
const asMarkedReadsIt: (
  text: string,
  definition: LinkReferenceDefinition,
) => NestedLinkReferenceDefinition = (
  text: string,
  definition: LinkReferenceDefinition,
): NestedLinkReferenceDefinition => {
  if (definition.nested) {
    return definition.nested;
  }

  return {
    text: text.slice(definition.start, definition.end),
    labelStart: definition.labelStart - definition.start,
    labelEnd: definition.labelEnd - definition.start,
    destinationEnd: definition.destinationEnd - definition.start,
  };
};

// What may come before a definition's "[" on its line, as marked reads it.
const UP_TO_THREE_SPACES: RegExp = /^ {0,3}$/;

/*
 * What is wrong with the definitions found in `text`, held to marked's
 * reading; null when nothing is. Each is where it says, in the text and as
 * marked reads it, up to three spaces before its "[". The first definition
 * of each label is the one marked reads: as marked reads it, on its own -
 * and from its "[", as a field cut to fit writes it - it must be read as
 * the same address and title; cut after its address it must still define
 * that address; and its label must make an empty definition of it.
 */
const differenceFromMarked: (text: string) => string | null = (
  text: string,
): string | null => {
  const links: Links = markedLinks(text);
  const first: Map<string, NestedLinkReferenceDefinition> = new Map<
    string,
    NestedLinkReferenceDefinition
  >();

  for (const definition of getLinkReferenceDefinitions(text)) {
    const read: NestedLinkReferenceDefinition = asMarkedReadsIt(
      text,
      definition,
    );
    const destination: string = text.slice(
      definition.destinationStart,
      definition.destinationEnd,
    );

    if (
      text.charAt(definition.labelStart - 1) !== "[" ||
      text.slice(definition.labelEnd, definition.labelEnd + 2) !== "]:" ||
      read.text.charAt(read.labelStart - 1) !== "[" ||
      !UP_TO_THREE_SPACES.test(read.text.slice(0, read.labelStart - 1)) ||
      read.text.slice(read.labelEnd, read.labelEnd + 2) !== "]:" ||
      definition.label !==
        normalizeLinkLabel(read.text.slice(read.labelStart, read.labelEnd)) ||
      read.text.slice(
        read.destinationEnd - destination.length,
        read.destinationEnd,
      ) !== destination ||
      definition.start > definition.labelStart ||
      definition.end < definition.destinationEnd
    ) {
      return `a definition is not where it says: ${JSON.stringify(definition)}`;
    }

    if (!first.has(definition.label)) {
      first.set(definition.label, read);
    }
  }

  const expected: Array<string> = Object.keys(links).sort();
  const actual: Array<string> = Array.from(first.keys()).sort();

  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    return `labels ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`;
  }

  for (const [label, read] of first) {
    const want: Links[string] = links[label]!;

    for (const from of [0, read.labelStart - 1]) {
      const alone: Links = markedLinks(read.text.slice(from));

      if (
        Object.keys(alone).length !== 1 ||
        alone[label]?.href !== want.href ||
        alone[label]?.title !== want.title
      ) {
        return `${JSON.stringify(label)} alone is ${JSON.stringify(alone)}, marked read ${JSON.stringify(want)}`;
      }

      const withoutTitle: Links = markedLinks(
        read.text.slice(from, read.destinationEnd),
      );

      if (withoutTitle[label]?.href !== want.href) {
        return `${JSON.stringify(label)} without its title is ${JSON.stringify(withoutTitle)}`;
      }
    }

    const empty: Links = markedLinks(
      `[${read.text.slice(read.labelStart, read.labelEnd)}]: <>`,
    );

    if (Object.keys(empty).length !== 1 || empty[label]?.href !== "") {
      return `${JSON.stringify(label)} as an empty definition is ${JSON.stringify(empty)}`;
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
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);
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
    // #7230: in quotes and list items, and after the blocks marked ends there.
    ["in a block quote", "> [a]: /a"],
    [
      "in a block quote after its paragraph and a blank line",
      "> Text\n>\n> [a]: /a",
    ],
    ["in a block quote in a block quote", "> > [a]: /a"],
    ["in a list item", "- [a]: /a"],
    ["in a list item after a blank line", "- item\n\n  [a]: /a"],
    ["in a list item indented four spaces", "- item\n\n    [a]: /a"],
    ["in a numbered list item", "1. item\n\n   [a]: /a"],
    ["in a task list item", "- [ ] [a]: /a"],
    ["in the second item of a list", "- item\n- [a]: /a"],
    ["in a block quote in a list item", "- > [a]: /a"],
    ["in a list item in a block quote", "> - [a]: /a"],
    ["in a list item in a list item", "- a\n  - b\n\n    [a]: /a"],
    ["right after a setext heading of '='", "Heading\n===\n[a]: /a"],
    ["right after a setext heading of '-'", "Heading\n---\n[a]: /a"],
    ["right after a setext heading over two lines", "Head\ning\n===\n[a]: /a"],
    ["right after an HTML comment", "<!-- note -->\n[a]: /a"],
    ["right after a processing instruction, on its line", "<?x?>[a]: /a"],
    ["after a table and a blank line", "a|b\n-|-\n\n[a]: /a"],
    ["after a block quote and a blank line", "> quote\n\n[a]: /a"],
    ["after a list and a blank line", "- item\n\n[a]: /a"],
    ["in a block quote after an HTML block's blank line", "<div>\n\n> [a]: /a"],
    [
      "in a block quote in a list item's second paragraph",
      "- one\n\n  > [a]: /a",
    ],
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
    // #7230: HTML, quotes, list items and tables, as marked reads them.
    ["inside an HTML comment over blank lines", "<!--\n\n[a]: /a\n\n-->"],
    ["inside a <pre> block over blank lines", "<pre>\n\n[a]: /a\n\n</pre>"],
    ["inside an HTML block of a block tag", "<div>\n[a]: /a"],
    ["on a lazy line of a block quote's paragraph", "> Text\n[a]: /a"],
    ["on a lazy line of a list item's paragraph", "- item\n[a]: /a"],
    ["inside a fenced code block in a block quote", "> ```\n> [a]: /a\n> ```"],
    ["inside indented code in a list item", "- item\n\n      [a]: /a"],
    ["a row of a table", "a|b\n-|-\n[a]: /a"],
    [
      "a quote's marker after a line separator: what follows it is the line's",
      `> a${LINE_SEPARATOR}> [b]: /b`,
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
   * The places the finder did not look before #7230, where marked reads a
   * definition: a screenshot defined there shows in a field cut to fit.
   */
  test.each([
    ["inside a block quote", "> [a]: /a"],
    ["inside a list item indented four spaces", "- item\n\n    [a]: /a"],
    ["right after a setext heading", "Heading\n===\n[a]: /a"],
  ])("found, as marked reads one: %s", (_name: string, text: string) => {
    expect(
      found(text).map((definition: Written): string => {
        return definition.label;
      }),
    ).toEqual(["a"]);
    expect(Object.keys(markedLinks(text))).toEqual(["a"]);
    expect(differenceFromMarked(text)).toBeNull();
  });

  /*
   * Line and paragraph separators: no line break to marked's block rules,
   * but where "^" of its replacements matches - so a quote's marker after
   * one is stripped, and the tabs after one are spaces.
   */
  test.each([
    [
      "a quote's marker after a separator, at the end of a definition's line, is stripped",
      `>- [b]:b${LINE_SEPARATOR}>`,
      ["b"],
    ],
    [
      "in a label, a quote's marker after a separator is stripped",
      `> [a${LINE_SEPARATOR}> b]: /x`,
      ["a b"],
    ],
    [
      "an HTML block a quote's marker after a separator no longer ends",
      `><!X${LINE_SEPARATOR}>[b]:>`,
      [],
    ],
    [
      "the tab after a separator is spaces: the list item's line is indented code, and ends the item",
      `- p\n${LINE_SEPARATOR}\t ]\n[-]:>`,
      ["-"],
    ],
    [
      "a paragraph separator as a line separator",
      `>- [b]:b${PARAGRAPH_SEPARATOR}>`,
      ["b"],
    ],
  ])("%s", (_name: string, text: string, labels: Array<string>) => {
    expect(
      found(text).map((definition: Written): string => {
        return definition.label;
      }),
    ).toEqual(labels);
    expect(Object.keys(markedLinks(text))).toEqual(labels);
    expect(differenceFromMarked(text)).toBeNull();
  });

  test("not inside quotes or lists nested deeper than an email reads: it holds such Markdown back, where a definition is text", () => {
    const deep: string = `${"> ".repeat(MAX_DEFINITION_NESTING_DEPTH + 1)}[a]: /a`;
    const deepest: string = `${"> ".repeat(MAX_DEFINITION_NESTING_DEPTH)}[a]: /a`;
    const bullets: string = `${"- ".repeat(MAX_DEFINITION_NESTING_DEPTH + 1)}[a]: /a`;

    expect(MAX_DEFINITION_NESTING_DEPTH).toBe(SLOW_MARKDOWN_MAX_NESTING_DEPTH);
    expect(found(deep)).toEqual([]);
    expect(found(bullets)).toEqual([]);
    expect(
      found(deepest).map((definition: Written): string => {
        return definition.label;
      }),
    ).toEqual(["a"]);
    // marked itself reads all three.
    expect(Object.keys(markedLinks(deep))).toEqual(["a"]);
    expect(Object.keys(markedLinks(bullets))).toEqual(["a"]);
  });
});

describe("getLinkReferenceDefinitions - a definition in a block quote or a list item, as marked reads it there (#7230)", () => {
  test.each([
    ["a block quote", "> [home]: /a 'Title'", "[home]: /a 'Title'", 0],
    ["a quote's marker with no space after it", ">[home]: /a", "[home]: /a", 0],
    ["a quote's marker and a tab", ">\t[home]: /a", "[home]: /a", 0],
    ["a block quote in a block quote", "> > [home]: /a", "[home]: /a", 0],
    ["a list item", "- [home]: /a", "[home]: /a", 0],
    [
      "a list item's line indented four spaces, after a blank line: two spaces past the item's",
      "- Screenshot\n\n    [home]: /a",
      "  [home]: /a",
      14,
    ],
    ["a numbered list item", "10. [home]: /a", "[home]: /a", 0],
    ["a task list item", "- [x] [home]: /a", "[home]: /a", 0],
    [
      "a label over lines in a block quote",
      "> [Home\n> Page]: /a",
      "[Home\nPage]: /a",
      0,
    ],
    [
      "a title over lines in a block quote",
      '> [home]: /a\n> "one\n> two"',
      '[home]: /a\n"one\ntwo"',
      0,
    ],
    [
      "a title over lines in a list item",
      '- [home]: /a\n  "one\n  two"',
      '[home]: /a\n"one\ntwo"',
      0,
    ],
    ["a block quote in a list item", "- > [home]: /a", "[home]: /a", 0],
    [
      "a list item in a list item",
      "- a\n  - b\n\n    [home]: /a",
      "[home]: /a",
      11,
    ],
    [
      "a quote's marker after a line separator in its label",
      `> [Ho${LINE_SEPARATOR}> me]: /a`,
      `[Ho${LINE_SEPARATOR}me]: /a`,
      0,
    ],
  ])("%s", (_name: string, text: string, asRead: string, lineStart: number) => {
    const definitions: Array<LinkReferenceDefinition> =
      getLinkReferenceDefinitions(text);

    expect(definitions).toHaveLength(1);

    const definition: LinkReferenceDefinition = definitions[0]!;
    const nested: NestedLinkReferenceDefinition = definition.nested!;

    // Found where it is: from its line's start, markers and all.
    expect(nested.text).toBe(asRead);
    expect(definition.start).toBe(lineStart);
    expect(definition.end).toBe(text.length);
    expect(
      text.slice(definition.destinationStart, definition.destinationEnd),
    ).toBe("/a");
    expect(nested.text.slice(nested.labelStart, nested.labelEnd)).toBe(
      asRead.slice(asRead.indexOf("[") + 1, asRead.indexOf("]:")),
    );
    expect(nested.text.slice(0, nested.destinationEnd).endsWith("/a")).toBe(
      true,
    );
    // On lines of its own, it defines what marked reads in the quote or item.
    expect(markedLinks(nested.text)).toEqual(markedLinks(text));
    expect(differenceFromMarked(text)).toBeNull();
  });

  test("a definition on lines of its own, at the top level, has no nested reading", () => {
    for (const text of [
      "[home]: /a",
      "Heading\n===\n[home]: /a",
      "<!-- note -->\n[home]: /a",
      "- item\n\n[home]: /a",
    ]) {
      const definitions: Array<LinkReferenceDefinition> =
        getLinkReferenceDefinitions(text);

      expect(definitions).toHaveLength(1);
      expect(definitions[0]!.nested).toBeUndefined();
    }
  });

  test("of a label defined in a quote and again on lines of its own, marked reads the first, and both are found in order", () => {
    const text: string = "> [home]: /first\n\n[home]: /second";
    const definitions: Array<LinkReferenceDefinition> =
      getLinkReferenceDefinitions(text);

    expect(
      definitions.map((definition: LinkReferenceDefinition): string => {
        return text.slice(
          definition.destinationStart,
          definition.destinationEnd,
        );
      }),
    ).toEqual(["/first", "/second"]);
    expect(definitions[0]!.nested?.text).toBe("[home]: /first");
    expect(definitions[1]!.nested).toBeUndefined();
    expect(markedLinks(text)["home"]!.href).toBe("/first");
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
    // Every text is compared, quotes, lists and HTML too (#7230): many hold definitions marked reads.
    expect(compared).toBe(30000);
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
    expect(compared).toBe(20000);
    expect(withDefinitions).toBeGreaterThan(6000);
  });
});

describe("getLinkReferenceDefinitions - against marked's own reading, in every kind of block (#7230)", () => {
  /*
   * Alphabets of the blocks marked reads a definition in, after, or never
   * in: quotes, lists, setext headings, HTML of every kind, tables, code,
   * and the line and paragraph separators "^" matches after.
   */
  const ALPHABETS: Record<string, ReadonlyArray<string>> = {
    blocks: [
      "[a]: /a",
      "[b]: /b 't'",
      "[a]:\n/c",
      "[c]: <x y>",
      "[d]: /d\n'ti\ntle'",
      "[e\nf]: /e",
      '[g]: /g "q"',
      "\n",
      "\n",
      "\n\n",
      " ",
      "  ",
      "   ",
      "    ",
      "\t",
      "> ",
      ">",
      "> > ",
      "- ",
      "* ",
      "+ ",
      "1. ",
      "2) ",
      "-",
      "- [ ] ",
      "-\t",
      "===",
      "---",
      "--",
      "***",
      "# h",
      "#",
      "```",
      "~~~",
      "    code",
      "text",
      "x",
      "a|b",
      "|-|",
      "-|-",
      ":-",
      "<div>",
      "<div",
      "<pre>",
      "</pre>",
      "<!--",
      "-->",
      "<?x?>",
      "<!X>",
      "<x a=1>",
      "</x>",
      "<DIV>",
      "<p>",
      NO_BREAK_SPACE,
      LINE_SEPARATOR,
      "\\",
      "[",
      "]",
      "]:",
      "'",
      '"',
      "(",
      ")",
    ],
    lists: [
      "[a]: /a",
      "[b]: /b",
      "[c]: /c 't'",
      "\n",
      "\n",
      "\n",
      "\n\n",
      " ",
      "  ",
      "   ",
      "    ",
      "     ",
      "\t",
      "- ",
      "-",
      "* ",
      "1. ",
      "1.",
      "10) ",
      "- [x] ",
      "text",
      "x",
      "===",
      "---",
      "> ",
      "```",
      "# h",
      NO_BREAK_SPACE,
      "<div>",
    ],
    quotes: [
      "[a]: /a",
      "[b]: /b",
      "[c]:\n/c",
      "\n",
      "\n",
      "\n\n",
      " ",
      "  ",
      "    ",
      "\t",
      "> ",
      ">",
      ">\t",
      "> > ",
      "text",
      "x",
      "===",
      "--",
      "---",
      "- ",
      "1. ",
      "```",
      "# h",
      "<div>",
      "<!--",
      NO_BREAK_SPACE,
    ],
    nesting: [
      "[a]: /a",
      "[b]: /b 't'",
      "[c\nd]: /c",
      "\n",
      "\n",
      "\n\n",
      " ",
      "  ",
      "> ",
      "> > ",
      ">",
      "- ",
      "  - ",
      "    - ",
      "1. ",
      "   ",
      "    ",
      "\t",
      "* ",
      "+ ",
      "x",
      "===",
      "---",
      "```",
      "~~~",
      "    code",
      "<div>",
      "a|b\n-|-",
    ],
    html: [
      "[a]: /a",
      "[b]: /b",
      "\n",
      "\n",
      "\n\n",
      "\n  \n",
      " ",
      "   ",
      "\t",
      "<div>",
      "<div",
      "<DIV ",
      "</div>",
      "<div/>",
      "<p>",
      "<h1>",
      "<colgroup>",
      "<col",
      "<pre>",
      "<PRE ",
      "</pre>",
      "</PRE>",
      "<script>",
      "</script>",
      "<textarea>",
      "<style",
      "<prefix>",
      "<!--",
      "-->",
      "<!-->",
      "<!--->",
      "<?",
      "?>",
      "<!X",
      "<!x>",
      ">",
      "<![CDATA[",
      "]]>",
      "<x>",
      "<x a=1>",
      "<x a='1'>",
      '<x a="1">',
      "<x a = b c>",
      "<x a=>",
      "<x/>",
      "</x>",
      "</x\n>",
      "<x-y_z>",
      "x",
      "text",
      "> ",
      "- ",
      "    ",
      "===",
      "# h",
      LINE_SEPARATOR,
    ],
    tables: [
      "[a]: /a",
      "[b]: /b",
      "\n",
      "\n",
      "\n\n",
      " ",
      "  ",
      "    ",
      "|",
      "a|b",
      "a | b",
      "\\|",
      "-|-",
      "|-|-|",
      ":-:",
      "--:",
      "---",
      "- -",
      "-",
      "|",
      "x",
      "text",
      "> ",
      "- ",
      "1. ",
      "# h",
      "```",
      "<div>",
      LINE_SEPARATOR,
      NO_BREAK_SPACE,
      "===",
    ],
    separators: [
      "[a]: /a",
      "[b]: /b 't'",
      "[c\nd]: /c",
      "[e]: /e\n'ti\ntle'",
      "\n",
      "\n",
      "\n\n",
      " ",
      "  ",
      "    ",
      "\t",
      "\t\t",
      " \t",
      LINE_SEPARATOR,
      LINE_SEPARATOR,
      PARAGRAPH_SEPARATOR,
      `${LINE_SEPARATOR}>`,
      `${LINE_SEPARATOR}> `,
      `${LINE_SEPARATOR}>\t`,
      `${LINE_SEPARATOR}\t`,
      `${PARAGRAPH_SEPARATOR}  \t`,
      "> ",
      ">",
      ">\t",
      "- ",
      "-\t",
      "1. ",
      "* ",
      "x",
      "text",
      "===",
      "---",
      "```",
      "# h",
      "<div>",
      "<!--",
      "-->",
      "a|b",
      "-|-",
      "'",
      '"',
      "(",
      ")",
      "[",
      "]",
      "]:",
      NO_BREAK_SPACE,
    ],
  };

  /*
   * Of the 8,000 texts of each, at least so many hold a definition marked
   * reads, and at least so many definitions are found in a quote or a list
   * item: about four fifths of what seed 7230 makes (HTML and tables hide
   * most of theirs, as they should).
   */
  test.each([
    ["blocks", 400, 80],
    ["lists", 600, 200],
    ["quotes", 650, 220],
    ["nesting", 550, 200],
    ["html", 140, 25],
    ["tables", 240, 40],
    ["separators", 350, 65],
  ])(
    "generated texts of %s: the same labels, the same address and title for the first of each, and each in a quote or a list item read as marked reads it there",
    (name: string, leastWithDefinitions: number, leastNested: number) => {
      let withDefinitions: number = 0;
      let nestedFound: number = 0;
      const differences: Array<string> = [];

      for (const text of generatedTexts(8000, 7230, ALPHABETS[name]!, 30)) {
        if (Object.keys(markedLinks(text)).length > 0) {
          withDefinitions++;
        }

        nestedFound += getLinkReferenceDefinitions(text).filter(
          (definition: LinkReferenceDefinition): boolean => {
            return definition.nested !== undefined;
          },
        ).length;

        const difference: string | null = differenceFromMarked(text);

        if (difference !== null) {
          differences.push(`${JSON.stringify(text)}: ${difference}`);
        }
      }

      expect(differences.slice(0, 5)).toEqual([]);
      // The texts are worth comparing: many define, many in quotes and lists.
      expect(withDefinitions).toBeGreaterThan(leastWithDefinitions);
      expect(nestedFound).toBeGreaterThan(leastNested);
    },
  );

  test("every alphabet is compared", () => {
    expect(Object.keys(ALPHABETS).sort()).toEqual(
      [
        "blocks",
        "html",
        "lists",
        "nesting",
        "quotes",
        "separators",
        "tables",
      ].sort(),
    );
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
  /*
   * Quotes and lists sixteen deep are read sixteen times over, a level each,
   * as marked reads them: half a megabyte of them is as much work.
   */
  const HALF_A_MEGABYTE: number = ONE_MEGABYTE / 2;

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

  // A list item in a list item, `deep` items deep, a line each.
  const staircase: (deep: number) => string = (deep: number): string => {
    return Array.from({ length: deep }, (_: unknown, depth: number): string => {
      return `${"  ".repeat(depth)}- x\n`;
    }).join("");
  };

  // Eight quotes and eight list items in turn, then a definition in the deepest.
  const QUOTES_AND_ITEMS: string = `${"> - ".repeat(8)}x\n${">   ".repeat(8).trimEnd()}\n${">   ".repeat(8)}[a]: /u\n`;

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
    // #7230: quotes, lists, setext headings, HTML and tables.
    [
      "a megabyte-long line of quote markers, then a definition nested too deep",
      `${"> ".repeat(ONE_MEGABYTE / 2)}[a]: /a`,
      0,
    ],
    [
      "a megabyte-long line of quote markers with no space",
      `${">".repeat(ONE_MEGABYTE)}[a]: /a`,
      0,
    ],
    [
      "a megabyte-long line of bullets, then a definition nested too deep",
      `${"- ".repeat(ONE_MEGABYTE / 2)}[a]: /a`,
      0,
    ],
    [
      "a megabyte-long line of list indentation, then a definition",
      `- x\n${" ".repeat(ONE_MEGABYTE)}[a]: /a`,
      0,
    ],
    [
      "a megabyte-long line of list indentation after a blank line",
      `- x\n\n${" ".repeat(ONE_MEGABYTE)}[a]: /a`,
      0,
    ],
    [
      "sixteen quotes deep, a definition on every line",
      repeated(`${"> ".repeat(16)}[a]: /u\n`, ONE_MEGABYTE),
      timesRepeated(`${"> ".repeat(16)}[a]: /u\n`, ONE_MEGABYTE),
    ],
    [
      "seventeen quotes deep, a definition on every line: none",
      repeated(`${"> ".repeat(17)}[a]: /u\n`, ONE_MEGABYTE),
      0,
    ],
    ["a quote's lazy lines", `> x\n${repeated("y ]:\n", ONE_MEGABYTE)}`, 0],
    [
      "quotes, each with a lazy line, then a definition",
      repeated("> x\ny\n\n> [a]: /u\n", ONE_MEGABYTE),
      timesRepeated("> x\ny\n\n> [a]: /u\n", ONE_MEGABYTE),
    ],
    [
      "list items, a definition each",
      repeated("- [a]: /u\n", ONE_MEGABYTE),
      timesRepeated("- [a]: /u\n", ONE_MEGABYTE),
    ],
    [
      "task list items, a definition each",
      repeated("- [ ] [a]: /u\n", ONE_MEGABYTE),
      timesRepeated("- [ ] [a]: /u\n", ONE_MEGABYTE),
    ],
    [
      "list items, each a definition after a blank line",
      repeated("- x\n\n  [a]: /u\n", ONE_MEGABYTE),
      timesRepeated("- x\n\n  [a]: /u\n", ONE_MEGABYTE),
    ],
    [
      "staircases of lists sixteen deep, each line a lazy one of the deepest item",
      repeated(`${staircase(16)}${"  ".repeat(16)}[a]: /u\n`, HALF_A_MEGABYTE),
      0,
    ],
    [
      "staircases of lists sixteen deep, a definition in the deepest item of each",
      repeated(
        `${staircase(16)}\n${"  ".repeat(16)}[a]: /u\n`,
        HALF_A_MEGABYTE,
      ),
      timesRepeated(
        `${staircase(16)}\n${"  ".repeat(16)}[a]: /u\n`,
        HALF_A_MEGABYTE,
      ),
    ],
    [
      "quotes and list items in turn, four deep, each definition a lazy line",
      repeated("> - > - > - > - x\n>   >   >   >   [a]: /u\n", HALF_A_MEGABYTE),
      0,
    ],
    [
      "quotes and list items in turn, sixteen deep, a definition in each",
      repeated(QUOTES_AND_ITEMS, HALF_A_MEGABYTE),
      timesRepeated(QUOTES_AND_ITEMS, HALF_A_MEGABYTE),
    ],
    [
      "quotes in list items in quotes, a definition each",
      repeated("- > - > [a]: /u\n", HALF_A_MEGABYTE),
      timesRepeated("- > - > [a]: /u\n", HALF_A_MEGABYTE),
    ],
    [
      "paragraph lines a quote ends, each looking for an underline",
      `${repeated("x\n> y\n", ONE_MEGABYTE)}]:`,
      0,
    ],
    [
      "setext headings, a definition after each",
      repeated("h\n===\n[a]: /u\n", ONE_MEGABYTE),
      timesRepeated("h\n===\n[a]: /u\n", ONE_MEGABYTE),
    ],
    [
      "HTML blocks of a block tag, a definition after each",
      repeated("<div>\n\n[a]: /u\n", ONE_MEGABYTE),
      timesRepeated("<div>\n\n[a]: /u\n", ONE_MEGABYTE),
    ],
    ["HTML comments that never close", repeated("<!-- x\n\n[a]: /u\n"), 0],
    [
      "<pre> blocks closed on their lines, a definition after each",
      repeated("<pre>x</pre>\n[a]: /u\n", ONE_MEGABYTE),
      timesRepeated("<pre>x</pre>\n[a]: /u\n", ONE_MEGABYTE),
    ],
    [
      "a tag of four megabytes of attributes",
      `<x ${"a=1 ".repeat(FOUR_MEGABYTES / 4)}>\n\n[a]: /u`,
      1,
    ],
    ["a table's rows", `a|b\n-|-\n${repeated("c|d ]:\n")}`, 0],
    [
      "a table header of four megabytes of cells",
      `${"a|".repeat(FOUR_MEGABYTES / 2)}\n${"-|".repeat(FOUR_MEGABYTES / 2)}\n\n[a]: /u`,
      1,
    ],
    [
      "line separators on every line of quotes sixteen deep",
      `${repeated(`${"> ".repeat(16)}# h${PARAGRAPH_SEPARATOR}\n`, ONE_MEGABYTE)}]:`,
      0,
    ],
    [
      "a screenshot of four megabytes of base64 defined in a block quote",
      `> [s]: data:image/png;base64,${"iVBO".repeat(FOUR_MEGABYTES / 4)}`,
      1,
    ],
    [
      "a screenshot of four megabytes of base64 defined in a list item",
      `- [s]: data:image/png;base64,${"iVBO".repeat(FOUR_MEGABYTES / 4)}`,
      1,
    ],
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
