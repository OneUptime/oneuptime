import {
  findAddressAtEnd,
  findImageSpans,
  findLinkSpans,
  LinkSpan,
  replaceLinkSpans,
} from "../../../UI/Components/Markdown.tsx/MarkdownLinkSpans";
import { markdownToHtml } from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import { fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE IMAGES AND LINKS IN A LINE OF MARKDOWN ARE FOUND IN TIME IN LINE WITH
 * ITS LENGTH, MATCH FOR MATCH AS BEFORE.
 *
 * The markdown editor found images and links with
 * /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g and its link twin, tried
 * again from every "![" or "[": each try read on to the "]" that ends the
 * words, and to the end of the address after it. A run of openers that
 * close nothing - "![](![](![](..." - was read once for every opener: a
 * note of a few hundred kilobytes held the browser of everyone who opened
 * it for minutes. findImageSpans and findLinkSpans read the text once and
 * find the same matches, with the same words, address and title; these
 * tests hold them to the patterns on every text of up to seven pieces,
 * on drawn texts, and on the texts that were slow.
 *
 * findAddressAtEnd reads the address of the image placeholder the editor
 * puts in while an image uploads, as /\(([^)]+)\)\s*$/ read it.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);

// The patterns as they were: the references the readers must agree with.
const IMAGE_BEFORE: RegExp = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
const LINK_BEFORE: RegExp = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
const ADDRESS_AT_END_BEFORE: RegExp = /\(([^)]+)\)\s*$/;

// What a match is written as in these tests: its groups, a missing title as null.
const written: (
  words: string,
  address: string,
  title: string | undefined,
) => string = (
  words: string,
  address: string,
  title: string | undefined,
): string => {
  return `{${JSON.stringify([words, address, title === undefined ? null : title])}}`;
};

const replacedBefore: (text: string, pattern: RegExp) => string = (
  text: string,
  pattern: RegExp,
): string => {
  return text.replace(
    pattern,
    (
      _match: string,
      words: string,
      address: string,
      title: string | undefined,
    ): string => {
      return written(words, address, title);
    },
  );
};

const replacedNow: (text: string, spans: Array<LinkSpan>) => string = (
  text: string,
  spans: Array<LinkSpan>,
): string => {
  return replaceLinkSpans(text, spans, (span: LinkSpan): string => {
    return written(span.words, span.address, span.title);
  });
};

const addressAtEndBefore: (text: string) => string | null = (
  text: string,
): string | null => {
  const match: RegExpMatchArray | null = text.match(ADDRESS_AT_END_BEFORE);

  return match ? match[1] || null : null;
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("the images and links people write", () => {
  test("an image, a link, a titled one and an empty alt text", () => {
    const text: string =
      'See ![chart](a.png) and [docs](https://e.com "The docs") or ![](b.png "B") [x](y z)';

    expect(findImageSpans(text)).toEqual([
      { start: 4, end: 19, words: "chart", address: "a.png", title: undefined },
      { start: 60, end: 74, words: "", address: "b.png", title: "B" },
    ]);
    expect(findLinkSpans(text)).toEqual([
      {
        start: 5,
        end: 19,
        words: "chart",
        address: "a.png",
        title: undefined,
      },
      {
        start: 24,
        end: 56,
        words: "docs",
        address: "https://e.com",
        title: "The docs",
      },
    ]);
    expect(replacedNow(text, findImageSpans(text))).toBe(
      replacedBefore(text, IMAGE_BEFORE),
    );
    expect(replacedNow(text, findLinkSpans(text))).toBe(
      replacedBefore(text, LINK_BEFORE),
    );
  });

  test("an empty title is a title, and a link needs words", () => {
    expect(findLinkSpans('[a](b "")')).toEqual([
      { start: 0, end: 9, words: "a", address: "b", title: "" },
    ]);
    expect(findLinkSpans("[](b)")).toEqual([]);
    expect(findImageSpans("![](b)")).toEqual([
      { start: 0, end: 6, words: "", address: "b", title: undefined },
    ]);
  });

  test.each([
    "![a](b",
    "[a](b",
    "[a] (b)",
    "[a](b c)",
    "[a](",
    "[a]",
    '![a](b "c"',
    '![a](b "c" )',
  ])("%j is no image and no link, as before", (text: string) => {
    expect(findImageSpans(text)).toEqual([]);
    expect(findLinkSpans(text)).toEqual([]);
    expect(text.match(IMAGE_BEFORE)).toBeNull();
    expect(text.match(LINK_BEFORE)).toBeNull();
  });

  test("an opener inside an address that ends nothing can still open a link of its own", () => {
    const text: string = "![](a![b c](d)";

    expect(replacedNow(text, findImageSpans(text))).toBe(
      replacedBefore(text, IMAGE_BEFORE),
    );
    expect(findImageSpans(text)).toEqual([
      { start: 5, end: 14, words: "b c", address: "d", title: undefined },
    ]);
  });

  test("replaceLinkSpans writes the spans in order, once each", () => {
    const order: Array<string> = [];
    const text: string = "[a](1) [b](2) [c](3)";

    expect(
      replaceLinkSpans(text, findLinkSpans(text), (span: LinkSpan): string => {
        order.push(span.words);
        return span.words.toUpperCase();
      }),
    ).toBe("A B C");
    expect(order).toEqual(["a", "b", "c"]);
    expect(
      replaceLinkSpans("plain", [], () => {
        throw new Error("no spans, no writes");
      }),
    ).toBe("plain");
  });
});

describe("the spans are exactly what the patterns matched", () => {
  const exhaustive: (
    pieces: Array<string>,
    most: number,
    check: (text: string) => boolean,
  ) => { texts: number; differences: Array<string> } = (
    pieces: Array<string>,
    most: number,
    check: (text: string) => boolean,
  ): { texts: number; differences: Array<string> } => {
    const differences: Array<string> = [];
    let texts: number = 0;

    const visit: (text: string, depth: number) => void = (
      text: string,
      depth: number,
    ): void => {
      texts++;

      if (!check(text) && differences.length < 10) {
        differences.push(JSON.stringify(text));
      }

      if (depth < most) {
        for (const piece of pieces) {
          visit(text + piece, depth + 1);
        }
      }
    };

    visit("", 0);

    return { texts: texts, differences: differences };
  };

  test("images, on every text of up to six pieces", () => {
    const { texts, differences } = exhaustive(
      ["!", "[", "]", "(", ")", " ", '"', "a", "![", "](", LINE_SEPARATOR],
      6,
      (text: string): boolean => {
        return (
          replacedNow(text, findImageSpans(text)) ===
          replacedBefore(text, IMAGE_BEFORE)
        );
      },
    );

    expect(differences).toEqual([]);
    expect(texts).toBe(1948717);
  });

  test("links, on every text of up to six pieces", () => {
    const { texts, differences } = exhaustive(
      ["!", "[", "]", "(", ")", " ", '"', "a", "[a", "](", "\t"],
      6,
      (text: string): boolean => {
        return (
          replacedNow(text, findLinkSpans(text)) ===
          replacedBefore(text, LINK_BEFORE)
        );
      },
    );

    expect(differences).toEqual([]);
    expect(texts).toBe(1948717);
  });

  test("both, on a hundred thousand drawn texts of up to thirty pieces", () => {
    const differences: Array<string> = [];
    let matched: number = 0;

    for (const text of generatedTexts(
      100000,
      7477,
      [
        "!",
        "[",
        "]",
        "(",
        ")",
        " ",
        "\t",
        "\n",
        '"',
        "a",
        "b c",
        "![",
        "](",
        "[a](",
        "x.png",
        ' "t")',
        LINE_SEPARATOR,
        "\\",
        "*",
      ],
      30,
    )) {
      const images: string = replacedBefore(text, IMAGE_BEFORE);
      const links: string = replacedBefore(text, LINK_BEFORE);

      if (images !== text || links !== text) {
        matched++;
      }

      if (
        replacedNow(text, findImageSpans(text)) !== images ||
        replacedNow(text, findLinkSpans(text)) !== links
      ) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    expect(matched).toBeGreaterThan(10000);
  });

  test("findAddressAtEnd, on every text of up to eight pieces and on drawn ones", () => {
    const { texts, differences } = exhaustive(
      ["(", ")", "a", " ", "\t", "!", "[", "]"],
      8,
      (text: string): boolean => {
        return findAddressAtEnd(text) === addressAtEndBefore(text);
      },
    );

    expect(differences).toEqual([]);
    expect(texts).toBe(19173961);

    const drawn: Array<string> = [];

    for (const text of generatedTexts(
      50000,
      9091,
      ["(", ")", "((", "))", "a", " ", "\n", LINE_SEPARATOR, "![x](", "y)"],
      30,
    )) {
      if (findAddressAtEnd(text) !== addressAtEndBefore(text)) {
        drawn.push(JSON.stringify(text));
      }
    }

    expect(drawn).toEqual([]);
    expect(
      findAddressAtEnd("![Uploading a.png…](oneuptime-uploading-1f-2a)"),
    ).toBe("oneuptime-uploading-1f-2a");
  });
});

describe("a line built to be slow is read quickly", () => {
  test.each([
    ["images that close none", repeat("![](\u0000", LENGTH)],
    ["links that close none", repeat("[(](((", LENGTH) + "][\t](\u0000)"],
    [
      "openers inside an address that ends in a space",
      repeat("![](", LENGTH) + 'a "t',
    ],
    ["openers inside an address that runs to the end", repeat("[a](", LENGTH)],
    ["titles that close none", repeat('[a](b "', LENGTH)],
    ["titles closed by no parenthesis", repeat('![a](b "c" ', LENGTH)],
    ["a run of opening brackets", repeat("[", LENGTH)],
    ["a run of image openers", repeat("![", LENGTH) + "]("],
    /*
     * The "]" every opener reaches is found once: looked for again from
     * each opener, the search is fast enough per character that it takes
     * four times the length, and a character only two bytes hold, to show.
     */
    [
      "a long run of image openers before one bracket",
      repeat("![", 4 * LENGTH) + LINE_SEPARATOR + "](",
    ],
    [
      "a long run of link openers before one bracket",
      repeat("[", 4 * LENGTH) + LINE_SEPARATOR + "](",
    ],
    ["words that run to the end", "![" + repeat("a", LENGTH)],
  ])("%s", (_label: string, text: string) => {
    expect(
      timeOf(() => {
        replacedNow(text, findImageSpans(text));
        replacedNow(text, findLinkSpans(text));
        findAddressAtEnd(text);
      }),
    ).toBeLessThan(2000);

    // The editor reads the line when it opens the note.
    expect(
      timeOf(() => {
        markdownToHtml(text);
      }),
    ).toBeLessThan(2000);
  });

  test("an upload placeholder's address after many parentheses", () => {
    const text: string = repeat("(", LENGTH) + "a)" + repeat(" ", LENGTH);

    expect(
      timeOf(() => {
        findAddressAtEnd(text);
      }),
    ).toBeLessThan(2000);
    expect(findAddressAtEnd(text)).toBe(repeat("(", LENGTH - 1) + "a");
  });
});
