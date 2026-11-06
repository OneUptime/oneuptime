import {
  MarkdownHeading,
  getMarkdownHeadingShape,
  readMarkdownHeadings,
} from "../../../Server/Types/MarkdownHeadings";
import { slugifyMarkdownHeading } from "../../../Server/Types/MarkdownSlugify";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A DOCS PAGE'S HEADINGS, READ ONCE EACH, AS THEY WERE READ BEFORE.
 *
 * docs:localize-anchors and the docs site (App/FeatureSet/Docs/Utils/
 * AnchorAliases.ts, on every translated page it serves) read a page's
 * headings with MarkdownHeadings, to pair a translation's headings with the
 * English page's. Its heading line took the fewest characters before a
 * closing run of "#" between white space, and on a long run of white space
 * with a line separator after it that tried every split of the run - in
 * time with the run's length to the fourth power. It reads the line's text
 * whole now, and every heading keeps its level and its anchor: the reader
 * as it was, kept here, gives the same headings on drawn texts and on every
 * docs page in every language.
 */

const LENGTH: number = 400000;
const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);

const CONTENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
);

// The reader as it was, with the heading line it had.
const FORMER_FENCE: RegExp = /^ {0,3}(`{3,}(?!`)|~{3,}(?!~))(.*)$/;
const FORMER_HEADING: RegExp = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

const formerReading: (markdown: string) => Array<MarkdownHeading> = (
  markdown: string,
): Array<MarkdownHeading> => {
  const headings: Array<MarkdownHeading> = [];
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch: RegExpMatchArray | null = line.match(FORMER_FENCE);
    if (fenceMatch) {
      const marker: string = fenceMatch[1]!;
      if (fence === null) {
        fence = marker;
        const language: string =
          (fenceMatch[2] || "").trim().split(/\s+/)[0] || "";
        if (headings.length > 0) {
          headings[headings.length - 1]!.code.push(language.toLowerCase());
        }
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const heading: RegExpMatchArray | null = line.match(FORMER_HEADING);
    if (heading) {
      headings.push({
        anchor: slugifyMarkdownHeading(heading[2]!.trim()),
        level: heading[1]!.length,
        code: [],
      });
    }
  }

  return headings;
};

const HEADING_ALPHABET: ReadonlyArray<string> = [
  "#",
  "##",
  "#######",
  " ",
  "\t",
  "   ",
  "\n",
  "\r",
  LINE_SEPARATOR,
  PARAGRAPH_SEPARATOR,
  "Foo",
  "é",
  "_",
  "-",
  "&",
  ";",
  "&amp;",
  "<b>",
  "`code`",
  "[a link](/docs/x/y)",
  "```",
  "~~~",
  "yaml",
];

// Every docs page in every language, by its path under Content.
const docsPages: () => Array<string> = (): Array<string> => {
  const pages: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(full);
      }
    }
  };
  walk(CONTENT_DIR);
  return pages;
};

describe("a docs page's headings", () => {
  test("are read as they were on a hundred and twenty thousand drawn texts", () => {
    const mismatches: Array<{ text: string; now: string; before: string }> = [];
    let headings: number = 0;

    for (const drawn of generatedTexts(40000, 2718, HEADING_ALPHABET, 14)) {
      // As drawn, and as the text of a heading of each kind of opening.
      for (const text of [drawn, `## ${drawn}`, `#\t${drawn} ##`]) {
        const before: Array<MarkdownHeading> = formerReading(text);
        const now: Array<MarkdownHeading> = readMarkdownHeadings(text);

        headings += before.length;

        if (JSON.stringify(now) !== JSON.stringify(before)) {
          mismatches.push({
            text,
            now: JSON.stringify(now),
            before: JSON.stringify(before),
          });
        }
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    // Most texts open with a heading, so the comparison reads them.
    expect(headings).toBeGreaterThan(30000);
  });

  test("are read as they were on every docs page in every language", () => {
    const pages: Array<string> = docsPages();
    const mismatches: Array<string> = [];
    let headings: number = 0;

    for (const page of pages) {
      const markdown: string = fs.readFileSync(page, "utf8");
      const before: Array<MarkdownHeading> = formerReading(markdown);

      headings += before.length;

      if (
        JSON.stringify(readMarkdownHeadings(markdown)) !==
        JSON.stringify(before)
      ) {
        mismatches.push(path.relative(CONTENT_DIR, page));
      }
    }

    expect(mismatches).toEqual([]);
    // Seventeen languages of three hundred pages and more.
    expect(pages.length).toBeGreaterThan(5000);
    expect(headings).toBeGreaterThan(50000);
  });

  test("keep a closing run of # out of the anchor, and a level past six out of the headings", () => {
    expect(
      readMarkdownHeadings(
        [
          "## Broker health metrics ##",
          "### C# clients",
          "####### Not a heading",
          "#Not a heading either",
        ].join("\n"),
      ),
    ).toEqual([
      { anchor: "broker-health-metrics", level: 2, code: [] },
      { anchor: "c-clients", level: 3, code: [] },
    ]);
  });

  test("give a page its shape: each heading's level and the languages of its code", () => {
    const fence: string = "```";

    expect(
      getMarkdownHeadingShape(
        readMarkdownHeadings(
          [
            "## Install",
            `${fence}bash`,
            "# a comment",
            fence,
            "~~~yaml",
            "key: value",
            "~~~",
            "### Check",
            `${fence}`,
            "plain",
            fence,
          ].join("\n"),
        ),
      ),
    ).toBe("2[bash,yaml] 3[]");
  });

  test.each([
    [
      "white space and a line separator",
      `#\t${"\t".repeat(LENGTH)}${LINE_SEPARATOR}`,
    ],
    ["white space and a carriage return", `## ${" ".repeat(LENGTH)}\r`],
    ["white space between runs of #", `# ${"# ".repeat(LENGTH / 2)}\r`],
  ])(
    "are read quickly from a line that was slow: %s",
    (_case: string, line: string) => {
      const read: FastestRun<Array<MarkdownHeading>> = fastestRun({
        run: (): Array<MarkdownHeading> => {
          return readMarkdownHeadings(line);
        },
        limitInMs: 2000,
      });

      expect(read.inMs).toBeLessThan(2000);
    },
  );
});
