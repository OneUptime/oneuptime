import {
  OVER_LONG_LINE_KEPT_LENGTH,
  OVER_LONG_LINE_LENGTH,
  OverLongTextParser,
  holdBackOverLongLines,
} from "../../../Utils/Markdown/OverLongText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { htmlAsText } from "../../Helpers/HtmlText";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  DashboardReading,
  DashboardSpan,
  readAsDashboard,
  renderAsDashboard,
} from "./DashboardMarkdownRenderer";
import { Token, Tokens, marked } from "marked";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #8238: A LINK'S TEXT ACROSS A CUT, AS EACH PARSER READS IT.
 *
 * A line over 64 KB keeps its first and last 1 KB in view and holds its
 * middle back as a token (Utils/Markdown/OverLongText). A link whose text
 * crosses a cut keeps its "[" and "](" in view, and the middle's part of
 * its text is a piece of its own (#7600). That only worked where the text
 * read plainly at the cut: where the cut fell inside brackets nested in
 * the text, a code span or an escape, or a reference's text or label
 * crossed it, the email (marked) and the dashboard (remark) showed the
 * link as Markdown.
 *
 * Now the token stands where the text reads plainly - as the parser that
 * reads it reads it, since marked and remark read a link's text each in
 * a way of its own - and a reference keeps its label in view. The tests
 * render with the real parsers: marked here, remark (micromark and its
 * GitHub extensions, as react-markdown reads) in a child process. Each
 * held line must link as the parser alone links the line - every link
 * but one wholly in the middle, which is held back as text - show no
 * link's Markdown that the parser alone does not, and never stand a token
 * after a backslash or inside a code span the parser alone does not read.
 */

const PARSERS: ReadonlyArray<OverLongTextParser> = ["marked", "remark"];

const HELD_OPEN: string = "\uE005";
const HELD_CLOSE: string = "\uE006";
const TOKEN: RegExp = /\uE005(\d+)\uE006/g;

const FILLER: string = "log line text ".repeat(5000);
const RUNS: string = "run ".repeat(400);

interface HeldLine {
  heldText: string;
  held: Array<string>;
  // What the parser reads, between the tokens.
  inView: Array<string>;
}

// The held text with every token replaced by what it stands for, run through `map`.
const putBack: (
  value: string,
  held: ReadonlyArray<string>,
  map?: (text: string) => string,
) => string = (
  value: string,
  held: ReadonlyArray<string>,
  map: (text: string) => string = (text: string): string => {
    return text;
  },
): string => {
  return value.replace(TOKEN, (_match: string, index: string): string => {
    return map(held[Number(index)] ?? "");
  });
};

// `text` held back for `parser` - and always put back exactly.
const holdBack: (text: string, parser: OverLongTextParser) => HeldLine = (
  text: string,
  parser: OverLongTextParser,
): HeldLine => {
  const held: Array<string> = [];
  const heldText: string = holdBackOverLongLines(
    text,
    (value: string): string => {
      held.push(putBack(value, held));

      return `${HELD_OPEN}${held.length - 1}${HELD_CLOSE}`;
    },
    parser,
  );

  expect(putBack(heldText, held) === text).toBe(true);

  return {
    heldText: heldText,
    held: held,
    inView: heldText.split(/\uE005\d+\uE006/),
  };
};

// Where something is written in a text: from `start` up to `end`.
interface SourceSpan {
  start: number;
  end: number;
}

interface SourceLink extends SourceSpan {
  href: string;
}

interface SourceReading {
  links: Array<SourceLink>;
  codeSpans: Array<SourceSpan>;
}

/*
 * The links marked reads in a text - its paragraphs' own - and the code
 * spans outside them, with where each is written.
 */
const readAsMarked: (markdown: string) => SourceReading = (
  markdown: string,
): SourceReading => {
  const reading: SourceReading = { links: [], codeSpans: [] };
  let at: number = 0;

  for (const block of marked.lexer(markdown)) {
    if (block.type === "paragraph") {
      let inlineAt: number = at;

      for (const token of (block as Tokens.Paragraph).tokens as Array<Token>) {
        const span: SourceSpan = {
          start: inlineAt,
          end: inlineAt + token.raw.length,
        };

        if (token.type === "link" || token.type === "image") {
          reading.links.push({ ...span, href: (token as Tokens.Link).href });
        } else if (token.type === "codespan") {
          reading.codeSpans.push(span);
        }

        inlineAt += token.raw.length;
      }
    }

    at += block.raw.length;
  }

  return reading;
};

const renderAsMarked: (markdown: string) => string = (
  markdown: string,
): string => {
  return marked.parse(markdown) as string;
};

const HTML_ESCAPES: ReadonlyArray<[RegExp, string]> = [
  [/&quot;/g, '"'],
  [/&#39;|&#x27;/g, "'"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&amp;/g, "&"],
];

const unescapeHtml: (html: string) => string = (html: string): string => {
  let text: string = html;

  for (const [pattern, character] of HTML_ESCAPES) {
    text = text.replace(pattern, character);
  }

  return text;
};

// The text of the HTML a reader sees outside code - where a link's Markdown would show.
const textOutsideCode: (html: string) => string = (html: string): string => {
  // The code spans out, then the rest read through the shared walk.
  return htmlAsText(html.replace(/<code>[\s\S]*?<\/code>/g, ""));
};

// What each code span of the HTML holds, its escapes undone and white space as one space.
const codeSpansOf: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  return Array.from(html.matchAll(/<code>([\s\S]*?)<\/code>/g)).map(
    (match: RegExpMatchArray): string => {
      return unescapeHtml(match[1]!).replace(/\s+/g, " ");
    },
  );
};

/*
 * How the parser read a text and its held line, for one check: the links
 * of the text but those wholly in the held middle, the held line's links
 * with what their tokens stand for, the code spans of the text that one
 * end of the middle parts - one end held back, the other in view - and
 * both HTMLs.
 */
interface Reading {
  // Every link the parser alone reads.
  aloneLinks: Array<string>;
  expectedLinks: Array<string>;
  heldLinks: Array<string>;
  partedCodeSpans: Array<SourceSpan>;
  html: string;
  heldHtml: string;
}

const readAs: (data: {
  text: string;
  heldLine: HeldLine;
  alone: SourceReading;
  heldLinks: Array<SourceLink>;
  html: string;
  heldHtml: string;
}) => Reading = (data: {
  text: string;
  heldLine: HeldLine;
  alone: SourceReading;
  heldLinks: Array<SourceLink>;
  html: string;
  heldHtml: string;
}): Reading => {
  const inView: Array<string> = data.heldLine.inView;
  const middleStart: number = inView[0]!.length;
  const middleEnd: number =
    data.text.length - inView[inView.length - 1]!.length;
  const links: Array<SourceLink> = data.alone.links;

  return {
    partedCodeSpans: data.alone.codeSpans.filter(
      (span: SourceSpan): boolean => {
        return (
          (span.start < middleStart &&
            span.end > middleStart &&
            span.end <= middleEnd) ||
          (span.start >= middleStart &&
            span.start < middleEnd &&
            span.end > middleEnd)
        );
      },
    ),
    aloneLinks: links.map((link: SourceLink): string => {
      return link.href;
    }),
    expectedLinks: links
      .filter((link: SourceLink): boolean => {
        return !(link.start >= middleStart && link.end <= middleEnd);
      })
      .map((link: SourceLink): string => {
        return link.href;
      }),
    heldLinks: data.heldLinks.map((link: SourceLink): string => {
      return putBack(link.href, data.heldLine.held);
    }),
    html: data.html,
    heldHtml: data.heldHtml,
  };
};

// The Markdown of the links these tests write, where a reader sees it as text.
const LINK_MARKDOWN: RegExp = /\]\(\/(?:runs|x)\/|\]\[(?:run-42|r[ab])\]/g;

const countLinkMarkdown: (html: string) => number = (html: string): number => {
  return (textOutsideCode(html).match(LINK_MARKDOWN) ?? []).length;
};

/*
 * What a held line must keep of how the parser alone read its text: the
 * same links, no link's Markdown in view where the parser alone shows
 * none, no code span the parser alone reads parted by a cut, and no
 * token after a backslash, or inside a code span the parser alone does not
 * read. The problems found, empty when there are none.
 */
const problemsOf: (reading: Reading, heldLine: HeldLine) => Array<string> = (
  reading: Reading,
  heldLine: HeldLine,
): Array<string> => {
  const problems: Array<string> = [];

  if (
    JSON.stringify(reading.heldLinks) !== JSON.stringify(reading.expectedLinks)
  ) {
    problems.push(
      `links ${JSON.stringify(reading.heldLinks)}, alone ${JSON.stringify(reading.expectedLinks)}`,
    );
  }

  if (
    countLinkMarkdown(reading.html) === 0 &&
    countLinkMarkdown(reading.heldHtml) !== 0
  ) {
    problems.push("a link's Markdown shows");
  }

  for (const match of heldLine.heldText.matchAll(/(\\*)\uE005/g)) {
    if (match[1]!.length % 2 === 1) {
      problems.push("a token after a backslash");
    }
  }

  if (reading.partedCodeSpans.length > 0) {
    problems.push(
      `a code span parted at ${JSON.stringify(reading.partedCodeSpans)}`,
    );
  }

  const aloneCode: Array<string> = codeSpansOf(reading.html);

  for (const code of codeSpansOf(reading.heldHtml)) {
    if (code.indexOf(HELD_OPEN) === -1) {
      continue;
    }

    const written: string = putBack(code, heldLine.held)
      .replace(/\s+/g, " ")
      .trim();

    if (
      !aloneCode.some((aloneSpan: string): boolean => {
        return aloneSpan.indexOf(written) !== -1;
      })
    ) {
      problems.push("a token inside a code span");
    }
  }

  return problems;
};

/*
 * Reads every case with both parsers - remark for all of them in one
 * child process - and returns, for each, how each parser read it.
 */
const readWithBothParsers: (
  texts: ReadonlyArray<{ text: string; aloneText?: string; shift?: Shift }>,
) => Array<
  Record<OverLongTextParser, { reading: Reading; heldLine: HeldLine }>
> = (
  texts: ReadonlyArray<{ text: string; aloneText?: string; shift?: Shift }>,
): Array<
  Record<OverLongTextParser, { reading: Reading; heldLine: HeldLine }>
> => {
  const heldLines: Array<Record<OverLongTextParser, HeldLine>> = texts.map(
    (item: { text: string }): Record<OverLongTextParser, HeldLine> => {
      return {
        marked: holdBack(item.text, "marked"),
        remark: holdBack(item.text, "remark"),
      };
    },
  );
  const aloneTexts: Array<string> = texts.map(
    (item: { text: string; aloneText?: string }): string => {
      return item.aloneText ?? item.text;
    },
  );
  const remarkHeldTexts: Array<string> = heldLines.map(
    (lines: Record<OverLongTextParser, HeldLine>): string => {
      return lines.remark.heldText;
    },
  );
  const remarkReadings: Array<DashboardReading> = readAsDashboard([
    ...aloneTexts,
    ...remarkHeldTexts,
  ]);
  const remarkHtml: Array<string> = renderAsDashboard([
    ...aloneTexts,
    ...remarkHeldTexts,
  ]);

  return texts.map(
    (
      item: { text: string; shift?: Shift },
      index: number,
    ): Record<OverLongTextParser, { reading: Reading; heldLine: HeldLine }> => {
      const markedHeld: HeldLine = heldLines[index]!.marked;
      const remarkHeld: HeldLine = heldLines[index]!.remark;
      // Where what the parser read in a shortened text is in the text it stands for.
      const shifted: (alone: SourceReading) => SourceReading = (
        alone: SourceReading,
      ): SourceReading => {
        const shift: Shift | undefined = item.shift;

        if (!shift) {
          return alone;
        }

        return {
          links: alone.links.map((link: SourceLink): SourceLink => {
            return { ...shift(link), href: link.href };
          }),
          codeSpans: alone.codeSpans.map(shift),
        };
      };
      const remarkAlone: DashboardReading = remarkReadings[index]!;

      return {
        marked: {
          heldLine: markedHeld,
          reading: readAs({
            text: item.text,
            heldLine: markedHeld,
            alone: shifted(readAsMarked(aloneTexts[index]!)),
            heldLinks: readAsMarked(markedHeld.heldText).links,
            html: renderAsMarked(aloneTexts[index]!),
            heldHtml: renderAsMarked(markedHeld.heldText),
          }),
        },
        remark: {
          heldLine: remarkHeld,
          reading: readAs({
            text: item.text,
            heldLine: remarkHeld,
            alone: shifted({
              links: remarkAlone.links,
              codeSpans: remarkAlone.codeSpans.map(
                (span: DashboardSpan): SourceSpan => {
                  return span;
                },
              ),
            }),
            heldLinks: remarkReadings[texts.length + index]!.links,
            html: remarkHtml[index]!,
            heldHtml: remarkHtml[texts.length + index]!,
          }),
        },
      };
    },
  );
};

// Where something read in a shortened text is in the text it stands for.
type Shift = (span: SourceSpan) => SourceSpan;

// A link's text across the end's cut, or the start's: the same text crosses each.
const atTheEnd: (text: string, suffix: string) => string = (
  text: string,
  suffix: string,
): string => {
  return `${FILLER}see [${text}${suffix} now`;
};

const atTheStart: (text: string, suffix: string) => string = (
  text: string,
  suffix: string,
): string => {
  return `[${text}${suffix} ${FILLER}`;
};

// A backslash right before the cut, with no space near it: the cut is exactly 1 KB from the end.
const ESCAPE_AT_THE_END: (escaped: string) => string = (
  escaped: string,
): string => {
  const tail: string = "](/runs/42) now";

  return `${FILLER}see [${"a".repeat(600)}\\${escaped}${"b".repeat(OVER_LONG_LINE_KEPT_LENGTH - 1 - tail.length)}${tail}`;
};

// A backslash right before the start's cut: the kept start ends with it.
const ESCAPE_AT_THE_START: (escaped: string) => string = (
  escaped: string,
): string => {
  return `[${"a".repeat(OVER_LONG_LINE_KEPT_LENGTH - 2)}\\${escaped}${"b".repeat(600)}](/runs/42) ${FILLER}`;
};

const DEFINITION: string = "\n\n[run-42]: /runs/42";

interface Case {
  name: string;
  text: string;
  // The addresses each parser links, as it links them alone.
  links: Record<OverLongTextParser, Array<string>>;
}

const BOTH: Record<OverLongTextParser, Array<string>> = {
  marked: ["/runs/42"],
  remark: ["/runs/42"],
};

// marked reads brackets nested in a link's text one deep, remark as deep as they go.
const REMARK_ONLY: Record<OverLongTextParser, Array<string>> = {
  marked: [],
  remark: ["/runs/42"],
};

const NEITHER: Record<OverLongTextParser, Array<string>> = {
  marked: [],
  remark: [],
};

const SHAPES: ReadonlyArray<
  [string, string, Record<OverLongTextParser, Array<string>>]
> = [
  ["brackets nested one deep", `run [42 ${RUNS}run] x`, BOTH],
  [
    "brackets nested twice, one after another",
    `[a] run [42 ${RUNS}run] [b] x`,
    BOTH,
  ],
  ["brackets nested two deep", `run [a [42 ${RUNS}run] b] x`, REMARK_ONLY],
  [
    "brackets nested three deep",
    `run [a [b [42 ${RUNS}run] c] d] x`,
    REMARK_ONLY,
  ],
  ["a code span", `run \`code ${RUNS}code\` x`, BOTH],
  ["a code span holding brackets", `run \`] code ${RUNS}code [\` x`, BOTH],
  // marked pairs a link text's backticks one by one: the fifth is left open.
  [
    "a code span of two backticks holding one",
    `run \`\`co\`de ${RUNS}code\`\` x`,
    REMARK_ONLY,
  ],
  ["a code span of two backticks", `run \`\`code ${RUNS}code\`\` x`, BOTH],
  [
    "a code span of three backticks",
    `run \`\`\`code ${RUNS}code\`\`\` x`,
    BOTH,
  ],
  ["a code span in nested brackets", `run [42 \`code ${RUNS}code\`] x`, BOTH],
  [
    "nested brackets holding an escaped bracket",
    `run [42 \\] ${RUNS}run] x`,
    BOTH,
  ],
];

/*
 * Where marked reads no full reference, it reads its "[run-42]" as a
 * shortcut one: a link where that is in view - in the kept end - and held
 * back as text where it is in the middle.
 */
const asFullReference: (
  links: Record<OverLongTextParser, Array<string>>,
  isAtTheEnd: boolean,
) => Record<OverLongTextParser, Array<string>> = (
  links: Record<OverLongTextParser, Array<string>>,
  isAtTheEnd: boolean,
): Record<OverLongTextParser, Array<string>> => {
  return {
    marked: links.marked.length > 0 || isAtTheEnd ? ["/runs/42"] : [],
    remark: links.remark,
  };
};

// After a label across the end's cut: what keeps the cut inside it.
const END_PADDING: string = ` ${"z ".repeat(400)}now`;
const LABEL: string = `run 42 ${"of the nightly build ".repeat(12)}`;
const LABEL_DEFINITION: string = `\n\n[${LABEL}]: /runs/42`;

const CASES: ReadonlyArray<Case> = [
  ...SHAPES.flatMap(
    ([shape, text, links]: [
      string,
      string,
      Record<OverLongTextParser, Array<string>>,
    ]): Array<Case> => {
      return [
        {
          name: `${shape}, across the end`,
          text: atTheEnd(text, "](/runs/42)"),
          links: links,
        },
        {
          name: `${shape}, across the start`,
          text: atTheStart(text, "](/runs/42)"),
          links: links,
        },
        {
          name: `${shape}, a full reference across the end`,
          text: `${atTheEnd(text, "][run-42]")}${DEFINITION}`,
          links: asFullReference(links, true),
        },
        {
          name: `${shape}, a full reference across the start`,
          text: `${atTheStart(text, "][run-42]")}${DEFINITION}`,
          links: asFullReference(links, false),
        },
      ];
    },
  ),
  ...["*", "]", "\\", "`", "["].flatMap((escaped: string): Array<Case> => {
    return [
      {
        name: `an escaped '${escaped}' the end's cut parts`,
        text: ESCAPE_AT_THE_END(escaped),
        links: BOTH,
      },
      {
        name: `an escaped '${escaped}' the start's cut parts`,
        text: ESCAPE_AT_THE_START(escaped),
        links: BOTH,
      },
    ];
  }),
  {
    name: "an image's text with nested brackets, across the end",
    text: `${FILLER}see ![shot [42 ${RUNS}run] x](/runs/42.png) now`,
    links: { marked: ["/runs/42.png"], remark: ["/runs/42.png"] },
  },
  {
    name: "an image's text with a code span, across the start",
    text: `![shot \`code ${RUNS}code\` x](/runs/42.png) ${FILLER}`,
    links: { marked: ["/runs/42.png"], remark: ["/runs/42.png"] },
  },
  {
    name: "a full reference's text, across the end",
    text: `${atTheEnd(RUNS, "][run-42]")}${DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a full reference's text, across the start",
    text: `${atTheStart(RUNS, "][run-42]")}${DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a full reference's label, across the end",
    text: `${FILLER}see [${RUNS}][${LABEL}]${END_PADDING}${LABEL_DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a full reference's label, right at the end's cut",
    text: `${FILLER}see [${RUNS}${"x".repeat(80)}][run-42] ${"z".repeat(OVER_LONG_LINE_KEPT_LENGTH - 9)}${DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a full reference's label, across the start",
    text: `[a ${"b".repeat(OVER_LONG_LINE_KEPT_LENGTH - 60)}][${LABEL}] ${FILLER}${LABEL_DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a full reference's label, right at the start's cut",
    text: `[a ${"b".repeat(OVER_LONG_LINE_KEPT_LENGTH - 4)}][run-42] ${FILLER}${DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a collapsed reference, across the end",
    text: `${FILLER}see [${LABEL}][]${END_PADDING}${LABEL_DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a collapsed reference, across the start",
    text: `${"x ".repeat(400)}[${LABEL}][] ${FILLER}${LABEL_DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a collapsed reference whose '[]' the end's cut parts",
    text: `${FILLER}see [${LABEL.trim()}${"x".repeat(80)}][]${"z".repeat(OVER_LONG_LINE_KEPT_LENGTH - 1)}\n\n[${LABEL.trim()}${"x".repeat(80)}]: /runs/42`,
    links: BOTH,
  },
  {
    name: "a shortcut reference, across the end",
    text: `${FILLER}see [${LABEL}]${END_PADDING}${LABEL_DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a shortcut reference, across the start",
    text: `${"x ".repeat(400)}[${LABEL}] ${FILLER}${LABEL_DEFINITION}`,
    links: BOTH,
  },
  {
    name: "a shortcut reference with escapes in its label, across the end",
    text: `${FILLER}see [run \\* 42 ${"of the \\_nightly\\_ build ".repeat(10)}]${END_PADDING}\n\n[run \\* 42 ${"of the \\_nightly\\_ build ".repeat(10)}]: /runs/42`,
    links: BOTH,
  },
  {
    name: "a shortcut image, across the end",
    text: `${FILLER}see ![${LABEL}]${END_PADDING}\n\n[${LABEL}]: /runs/42.png`,
    links: { marked: ["/runs/42.png"], remark: ["/runs/42.png"] },
  },
  {
    // Before #8238 the "[" in the code span opened a link the line never had.
    name: "a '[' in a code span of two backticks across the end opens no link",
    text: `${FILLER}see \`\`x [y${RUNS}\`\` z](/runs/42) now`,
    links: NEITHER,
  },
  {
    name: "a '[' in a code span across the start opens no link",
    text: `\`\`[y${RUNS}\`\` z](/runs/42) ${FILLER}`,
    links: NEITHER,
  },
  {
    // Its code span closes past it, where the middle holds the closing backticks.
    name: "a full reference's label holding a code span, across the start",
    text: `[${RUNS}][run \`\`42] then ${"w ".repeat(60)}\`\` x ${FILLER} \`\`tail\`\` now`,
    links: NEITHER,
  },
  {
    name: "a text whose nested brackets never close, across the end",
    text: `${FILLER}see [run [42 ${RUNS} x](/runs/42) now`,
    links: BOTH,
  },
];

describe("OverLongText - a link's text across a cut, as marked and remark read it (#8238)", () => {
  let readings: Array<
    Record<OverLongTextParser, { reading: Reading; heldLine: HeldLine }>
  > = [];

  beforeAll(() => {
    readings = readWithBothParsers(
      CASES.map((item: Case): { text: string } => {
        return { text: item.text };
      }),
    );
  }, 300000);

  test("every case is a line over 64 KB", () => {
    for (const item of CASES) {
      expect(item.text.split("\n")[0]!.length).toBeGreaterThan(
        OVER_LONG_LINE_LENGTH,
      );
    }
  });

  test.each(
    CASES.flatMap(
      (
        item: Case,
        index: number,
      ): Array<[string, OverLongTextParser, number]> => {
        return PARSERS.map(
          (
            parser: OverLongTextParser,
          ): [string, OverLongTextParser, number] => {
            return [item.name, parser, index];
          },
        );
      },
    ),
  )(
    "%s, read by %s: links as the parser alone links it, and shows none of its Markdown",
    (_name: string, parser: OverLongTextParser, index: number) => {
      const { reading, heldLine } = readings[index]![parser];

      expect(reading.expectedLinks).toEqual(CASES[index]!.links[parser]);
      expect(problemsOf(reading, heldLine)).toEqual([]);
    },
  );
});

describe("OverLongText - where the token for a link's text stands (#8238)", () => {
  // Where the middle ends with no construct to keep whole: right after a space near 1 KB from the line's end.
  const middleEndOf: (text: string) => number = (text: string): number => {
    const lineEnd: number =
      text.indexOf("\n") === -1 ? text.length : text.indexOf("\n");
    const cut: number = lineEnd - OVER_LONG_LINE_KEPT_LENGTH;
    const space: number = text.lastIndexOf(" ", cut - 1);

    return cut - space - 1 < 64 ? space + 1 : cut;
  };

  const middleStartOf: (line: string) => number = (line: string): number => {
    const cut: number = OVER_LONG_LINE_KEPT_LENGTH;
    const space: number = line.lastIndexOf(" ", cut - 1);

    return cut - space - 1 < 64 ? space + 1 : cut;
  };

  test.each(PARSERS)(
    "across the end, read by %s: the middle's piece of the text runs on past the cut to where the nested brackets close",
    (parser: OverLongTextParser) => {
      const line: string = atTheEnd(`run [42 ${RUNS}run] x`, "](/runs/42)");
      const open: number = line.indexOf("[run");
      const nestedClose: number = line.indexOf("run] x") + 4;
      const heldLine: HeldLine = holdBack(line, parser);

      expect(middleEndOf(line)).toBeLessThan(nestedClose);
      expect(heldLine.inView).toEqual([
        line.slice(0, middleStartOf(line)),
        "[",
        line.slice(nestedClose),
      ]);
      expect(heldLine.held[1]).toBe(line.slice(open + 1, nestedClose));
    },
  );

  test.each(PARSERS)(
    "across the start, read by %s: the middle's piece of the text starts back before the cut, where the nested brackets open",
    (parser: OverLongTextParser) => {
      const line: string = atTheStart(`run [42 ${RUNS}run] x`, "](/runs/42)");
      const nestedOpen: number = line.indexOf("[42");
      const close: number = line.indexOf("](");
      const heldLine: HeldLine = holdBack(line, parser);

      expect(nestedOpen).toBeLessThan(middleStartOf(line));
      expect(heldLine.inView.slice(0, 3)).toEqual([
        line.slice(0, nestedOpen),
        "](",
        ") ",
      ]);
      expect(heldLine.held[0]).toBe(line.slice(nestedOpen, close));
    },
  );

  test("brackets nested two deep: marked reads no link, so the middle is one piece; remark's piece runs on to where both close", () => {
    const line: string = atTheEnd(`run [a [42 ${RUNS}run] b] x`, "](/runs/42)");
    const outerClose: number = line.indexOf("run] b]") + 7;

    expect(holdBack(line, "marked").held).toHaveLength(1);
    expect(holdBack(line, "remark").inView.slice(1)).toEqual([
      "[",
      line.slice(outerClose),
    ]);
  });

  test.each(PARSERS)(
    "a code span across the end, read by %s: the piece takes in the code span to its closing backtick",
    (parser: OverLongTextParser) => {
      const line: string = atTheEnd(
        `run \`code ${RUNS}code\` x`,
        "](/runs/42)",
      );
      const codeEnd: number = line.indexOf("code` x") + 5;

      expect(holdBack(line, parser).inView.slice(1)).toEqual([
        "[",
        line.slice(codeEnd),
      ]);
    },
  );

  test.each(PARSERS)(
    "a code span across the start, read by %s: the piece starts at its opening backtick",
    (parser: OverLongTextParser) => {
      const line: string = atTheStart(
        `run \`code ${RUNS}code\` x`,
        "](/runs/42)",
      );

      expect(holdBack(line, parser).inView[0]).toBe("[run ");
    },
  );

  test.each(PARSERS)(
    "a code span of three backticks across the end, read by %s: the piece ends past all three closing ones",
    (parser: OverLongTextParser) => {
      const line: string = atTheEnd(
        `run \`\`\`code ${RUNS}code\`\`\` x`,
        "](/runs/42)",
      );

      expect(holdBack(line, parser).inView[2]).toBe(" x](/runs/42) now");
    },
  );

  /*
   * marked's link rule reads "``" as an empty code span, so the text reads
   * plainly at the cut as the rule reads it; but the text, once found, is
   * read as a code span closes, and that one closes past the cut.
   */
  test.each(PARSERS)(
    "a code span of two backticks across each cut, read by %s: the piece takes it in whole",
    (parser: OverLongTextParser) => {
      const text: string = `run \`\`code ${RUNS}code\`\` x`;
      const atEnd: string = atTheEnd(text, "](/runs/42)");
      const atStart: string = atTheStart(text, "](/runs/42)");

      expect(holdBack(atEnd, parser).inView[2]).toBe(" x](/runs/42) now");
      expect(holdBack(atStart, parser).inView[0]).toBe("[run ");
    },
  );

  test.each(PARSERS)(
    "a backslash right before the end's cut, read by %s, stays in view with what it escapes",
    (parser: OverLongTextParser) => {
      const line: string = ESCAPE_AT_THE_END("*");
      const backslash: number = line.lastIndexOf("\\");
      const heldLine: HeldLine = holdBack(line, parser);

      expect(middleEndOf(line)).toBe(backslash + 1);
      expect(heldLine.inView[2]).toBe(line.slice(backslash));
    },
  );

  test.each(PARSERS)(
    "a backslash at the start's cut, read by %s, goes with what it escapes into the middle's piece",
    (parser: OverLongTextParser) => {
      const line: string = ESCAPE_AT_THE_START("*");
      const backslash: number = line.indexOf("\\");
      const heldLine: HeldLine = holdBack(line, parser);

      expect(middleStartOf(line)).toBe(backslash + 1);
      expect(heldLine.inView[0]).toBe(line.slice(0, backslash));
      expect(heldLine.held[0]!.startsWith("\\*bbb")).toBe(true);
    },
  );

  test.each(PARSERS)(
    "a full reference across the end, read by %s, keeps its '[' and its '][label]' in view",
    (parser: OverLongTextParser) => {
      const line: string = `${atTheEnd(RUNS, "][run-42]")}${DEFINITION}`;

      expect(holdBack(line, parser).inView.slice(1)).toEqual([
        "[",
        line.slice(middleEndOf(line)),
      ]);
    },
  );

  test.each(PARSERS)(
    "a full reference across the start, read by %s, keeps its '][label]' in view and holds back what follows apart",
    (parser: OverLongTextParser) => {
      const line: string = `${atTheStart(RUNS, "][run-42]")}${DEFINITION}`;
      const close: number = line.indexOf("][run-42]");
      const heldLine: HeldLine = holdBack(line, parser);

      expect(heldLine.inView.slice(0, 2)).toEqual([
        line.slice(0, middleStartOf(line)),
        "][run-42]",
      ]);
      expect(heldLine.held[0]).toBe(line.slice(middleStartOf(line), close));
    },
  );

  test.each(PARSERS)(
    "a shortcut reference across the end, read by %s, stays in view whole: the middle ends before its '['",
    (parser: OverLongTextParser) => {
      const line: string = `${FILLER}see [${LABEL}]${END_PADDING}${LABEL_DEFINITION}`;
      const open: number = line.indexOf(`[${LABEL}]`);
      const heldLine: HeldLine = holdBack(line, parser);

      expect(open).toBeLessThan(middleEndOf(line));
      expect(heldLine.inView[heldLine.inView.length - 1]).toBe(
        line.slice(open),
      );
    },
  );

  test.each(PARSERS)(
    "a collapsed reference across the start, read by %s, stays in view whole: the kept start ends past its '[]'",
    (parser: OverLongTextParser) => {
      const line: string = `${"x ".repeat(400)}[${LABEL}][] ${FILLER}`;
      const end: number = line.indexOf("][]") + 3;
      const heldLine: HeldLine = holdBack(line, parser);

      expect(end).toBeGreaterThan(middleStartOf(line));
      expect(heldLine.inView[0]).toBe(line.slice(0, end));
    },
  );

  test.each(PARSERS)(
    "a label longer than a reference's - 999 characters - is not kept whole, read by %s: only its '[' stays in view, for its ']' to close (#8668)",
    (parser: OverLongTextParser) => {
      const label: string = `run ${"x ".repeat(500)}`;
      const line: string = `${FILLER}see [${label}]${END_PADDING}`;
      const heldLine: HeldLine = holdBack(line, parser);

      expect(label.length).toBeGreaterThan(999);
      expect(heldLine.inView).toHaveLength(3);
      expect(heldLine.inView[1]).toBe("[");
      expect(heldLine.inView[2]).toBe(line.slice(middleEndOf(line)));
    },
  );

  test.each(PARSERS)(
    "a code span the end's cut is inside of, outside any link, read by %s, is held back to its end",
    (parser: OverLongTextParser) => {
      const line: string = `${FILLER}see \`\`code ${RUNS}code\`\` and \`x\` now`;
      const codeEnd: number = line.indexOf("code`` and") + 6;

      expect(holdBack(line, parser).inView).toEqual([
        line.slice(0, middleStartOf(line)),
        line.slice(codeEnd),
      ]);
    },
  );

  test.each(PARSERS)(
    "a code span the start's cut is inside of, outside any link, read by %s, is held back from its start",
    (parser: OverLongTextParser) => {
      const line: string = `see \`\`code ${RUNS}code\`\` and \`x\` ${FILLER}`;

      expect(holdBack(line, parser).inView[0]).toBe("see ");
    },
  );

  test.each(PARSERS)(
    "a code span over the whole middle, read by %s, keeps both its ends in view: the token stands for code",
    (parser: OverLongTextParser) => {
      const line: string = `see \`${FILLER}\` now`;
      const heldLine: HeldLine = holdBack(line, parser);

      expect(heldLine.inView[0]).toBe(line.slice(0, middleStartOf(line)));
      expect(heldLine.inView[heldLine.inView.length - 1]).toBe(
        line.slice(middleEndOf(line)),
      );
    },
  );

  test.each(PARSERS)(
    "an escape the end's cut parts, outside any link, read by %s, stays in view whole",
    (parser: OverLongTextParser) => {
      const line: string = `${FILLER}see ${"a".repeat(600)}\\*${"b".repeat(OVER_LONG_LINE_KEPT_LENGTH - 1)}`;
      const backslash: number = line.lastIndexOf("\\");

      expect(holdBack(line, parser).inView[1]).toBe(line.slice(backslash));
    },
  );
});

/*
 * Lines drawn at random: a link, an image or a reference whose text
 * crosses the start's cut, and another the end's, the cut at a place drawn
 * at random in each text - in brackets nested in it, a code span, an
 * escape, or plain text - and read with both parsers. A text is drawn from
 * what people write in one: words, some longer than the 64 characters a
 * cut looks back for a space in, nested brackets up to three deep, code
 * spans of one to three backticks, escapes. Emphasis is left out: marked
 * pairs backticks around it in ways of its own, which is not this test's.
 *
 * A parser that reads no link where one is drawn - marked, for a text
 * with brackets nested two deep, or a code span of two backticks holding
 * a "]" - reads the brackets inside it as labels of their own, which
 * brackets in the middle close: those stay in view (#8668), so such a
 * line too links as the parser alone links it.
 */
describe("OverLongText - links whose text crosses a cut at a place drawn at random (#8238)", () => {
  const ESCAPES: ReadonlyArray<string> = [
    "\\[",
    "\\]",
    "\\`",
    "\\*",
    "\\\\",
    "\\!",
    "\\_",
    "\\a",
  ];
  const SHORT_FILLER: string = "log line text ".repeat(20);
  const LONG_FILLER: string = "log line text ".repeat(5000);

  const drawWord: (random: SeededRandom) => string = (
    random: SeededRandom,
  ): string => {
    const length: number = random(4) === 0 ? 70 + random(30) : 1 + random(12);
    let word: string = "";

    for (let index: number = 0; index < length; index++) {
      word += "abcdefghij".charAt(random(10));
    }

    return word;
  };

  // A code span, of one to three backticks, with brackets and backslashes in it.
  const drawCode: (random: SeededRandom) => string = (
    random: SeededRandom,
  ): string => {
    const run: string = "`".repeat(1 + random(3));
    const pieces: Array<string> = [" ", "[", "]", "\\", drawWord(random)];
    let content: string = drawWord(random);

    for (let index: number = random(6); index > 0; index--) {
      content += pieces[random(pieces.length)]!;
    }

    // Apart from the next code span by a letter, as people write them.
    return `${run}${content}x${run}x`;
  };

  const drawPiece: (
    random: SeededRandom,
    depth: number,
    maxDepth: number,
  ) => string = (
    random: SeededRandom,
    depth: number,
    maxDepth: number,
  ): string => {
    const draw: number = random(100);

    if (draw < 40) {
      return drawWord(random);
    }

    if (draw < 55) {
      return " ";
    }

    if (draw < 65 && depth < maxDepth) {
      let inner: string = "";

      for (let index: number = 1 + random(6); index > 0; index--) {
        inner += drawPiece(random, depth + 1, maxDepth);
      }

      return `[${inner}]`;
    }

    if (draw < 77) {
      return drawCode(random);
    }

    if (draw < 90) {
      return ESCAPES[random(ESCAPES.length)]!;
    }

    return `${drawWord(random)} `;
  };

  const drawText: (
    random: SeededRandom,
    length: number,
    maxDepth: number,
  ) => string = (
    random: SeededRandom,
    length: number,
    maxDepth: number,
  ): string => {
    let text: string = "";

    while (text.length < length) {
      text += drawPiece(random, 0, maxDepth);
    }

    return text;
  };

  const drawLabel: (random: SeededRandom, length: number) => string = (
    random: SeededRandom,
    length: number,
  ): string => {
    let label: string = "";

    while (label.length < length) {
      label += [drawWord(random), " ", "\\*", "\\`"][random(4)]!;
    }

    return label.slice(0, 990).replace(/\\$/, "").trim() || "label";
  };

  interface DrawnLink {
    // What comes before the text: "[" or "![".
    opening: string;
    text: string;
    // What closes it: "](address)", "][label]", "][]" or "]".
    suffix: string;
    definition: string;
    // Where it links to.
    href: string;
  }

  const drawLink: (
    random: SeededRandom,
    name: string,
    maxDepth: number,
  ) => DrawnLink = (
    random: SeededRandom,
    name: string,
    maxDepth: number,
  ): DrawnLink => {
    const kind: number = random(10);

    if (kind < 4) {
      return {
        opening: "[",
        text: drawText(random, 1100 + random(1500), maxDepth),
        suffix: `](/x/${name})`,
        definition: "",
        href: `/x/${name}`,
      };
    }

    if (kind < 6) {
      return {
        opening: "[",
        text: drawText(random, 1100 + random(1500), maxDepth),
        suffix: `][r${name}]`,
        definition: `[r${name}]: /x/r${name}`,
        href: `/x/r${name}`,
      };
    }

    if (kind < 7) {
      return {
        opening: "![",
        text: drawText(random, 1100 + random(1500), maxDepth),
        suffix: `](/x/${name}.png)`,
        definition: "",
        href: `/x/${name}.png`,
      };
    }

    const label: string = drawLabel(random, 40 + random(900));

    return {
      opening: "[",
      text: label,
      suffix: kind < 8 ? "][]" : "]",
      definition: `[${label}]: /x/s${name}`,
      href: `/x/s${name}`,
    };
  };

  interface DrawnLine {
    text: string;
    aloneText: string;
    shift: Shift;
    // Where each cut would be with no construct to keep whole.
    startCut: number;
    endCut: number;
    // Where the links drawn link to.
    hrefs: Array<string>;
  }

  /*
   * A line whose start's cut falls `startInto` characters into the first
   * link's text and whose end's cut falls inside the second's, at a place
   * drawn at random; and the same line with a short filler, which the
   * parser alone reads the same way, faster.
   */
  const drawLine: (random: SeededRandom, maxDepth: number) => DrawnLine = (
    random: SeededRandom,
    maxDepth: number,
  ): DrawnLine => {
    const first: DrawnLink = drawLink(random, "a", maxDepth);
    const last: DrawnLink = drawLink(random, "b", maxDepth);
    const startInto: number =
      1 +
      random(
        Math.min(
          first.text.length,
          OVER_LONG_LINE_KEPT_LENGTH - first.opening.length - 1,
        ) - 1,
      );
    const prefixLength: number =
      OVER_LONG_LINE_KEPT_LENGTH - first.opening.length - startInto;
    const prefix: string =
      prefixLength > 1
        ? `${"p".repeat(prefixLength - 1)} `
        : "p".repeat(prefixLength);
    const start: string = `${prefix}${first.opening}${first.text}${first.suffix} `;
    // The end's cut falls `endInto` characters into the last link's text.
    const keptAfterText: number = last.suffix.length + " now".length;
    const endInto: number = Math.max(
      1,
      last.text.length -
        (OVER_LONG_LINE_KEPT_LENGTH - keptAfterText) +
        random(Math.max(1, Math.min(400, last.text.length - 1))),
    );
    const tailLength: number =
      OVER_LONG_LINE_KEPT_LENGTH -
      (last.text.length - Math.min(endInto, last.text.length - 1)) -
      last.suffix.length;
    const tail: string =
      tailLength > 1 ? ` ${"t".repeat(tailLength - 1)}` : " t";
    const end: string = ` ${last.opening}${last.text}${last.suffix}${tail}`;
    const definitions: string = [first.definition, last.definition]
      .filter((definition: string): boolean => {
        return definition !== "";
      })
      .join("\n");
    const after: string = definitions ? `\n\n${definitions}` : "";
    const text: string = `${start}${LONG_FILLER}${end}${after}`;
    const aloneText: string = `${start}${SHORT_FILLER}${end}${after}`;
    const shiftFrom: number = start.length + SHORT_FILLER.length;
    const shiftBy: number = LONG_FILLER.length - SHORT_FILLER.length;

    return {
      text: text,
      aloneText: aloneText,
      shift: (span: SourceSpan): SourceSpan => {
        return {
          start: span.start >= shiftFrom ? span.start + shiftBy : span.start,
          end: span.end > shiftFrom ? span.end + shiftBy : span.end,
        };
      },
      startCut: OVER_LONG_LINE_KEPT_LENGTH,
      endCut:
        start.length +
        LONG_FILLER.length +
        end.length -
        OVER_LONG_LINE_KEPT_LENGTH,
      hrefs: [first.href, last.href],
    };
  };

  // Where a cut is made with no construct to keep whole: right after a space near it.
  const plainCutOf: (text: string, position: number) => number = (
    text: string,
    position: number,
  ): number => {
    const space: number = text.lastIndexOf(" ", position - 1);

    return position - space - 1 < 64 ? space + 1 : position;
  };

  const LINES: number = 120;
  // Lines nested one deep, then lines nested up to three deep.
  let lines: Array<DrawnLine> = [];
  let readings: Array<
    Record<OverLongTextParser, { reading: Reading; heldLine: HeldLine }>
  > = [];

  beforeAll(() => {
    const random: SeededRandom = seededRandom(8238);

    lines = [
      ...Array.from({ length: LINES }, (): DrawnLine => {
        return drawLine(random, 1);
      }),
      ...Array.from({ length: LINES }, (): DrawnLine => {
        return drawLine(random, 3);
      }),
    ];
    readings = readWithBothParsers(lines);
  }, 300000);

  test("the lines are over 64 KB, and most of them link across a cut", () => {
    let linked: number = 0;

    for (let index: number = 0; index < lines.length; index++) {
      expect(lines[index]!.text.split("\n")[0]!.length).toBeGreaterThan(
        OVER_LONG_LINE_LENGTH,
      );

      if (readings[index]!.remark.reading.expectedLinks.length > 0) {
        linked++;
      }
    }

    expect(linked).toBeGreaterThan(lines.length * 0.75);
  });

  test("many cuts fall inside nested brackets, a code span, an escape or a label: the token does not stand at the cut there", () => {
    let movedAtTheStart: number = 0;
    let movedAtTheEnd: number = 0;

    for (let index: number = 0; index < lines.length; index++) {
      const line: DrawnLine = lines[index]!;
      const inView: Array<string> = readings[index]!.remark.heldLine.inView;

      if (inView[0]!.length !== plainCutOf(line.text, line.startCut)) {
        movedAtTheStart++;
      }

      if (
        line.text.length - inView[inView.length - 1]!.length !==
        plainCutOf(line.text, line.endCut)
      ) {
        movedAtTheEnd++;
      }
    }

    expect(movedAtTheStart).toBeGreaterThan(lines.length * 0.1);
    expect(movedAtTheEnd).toBeGreaterThan(lines.length * 0.1);
  });

  // Whether the parser alone reads every link drawn on the line.
  const readsEveryLink: (
    index: number,
    parser: OverLongTextParser,
  ) => boolean = (index: number, parser: OverLongTextParser): boolean => {
    return lines[index]!.hrefs.every((href: string): boolean => {
      return readings[index]![parser].reading.aloneLinks.includes(href);
    });
  };

  // The problems of every line read by `parser`.
  const failuresOf: (parser: OverLongTextParser) => Array<string> = (
    parser: OverLongTextParser,
  ): Array<string> => {
    const failures: Array<string> = [];

    for (let index: number = 0; index < lines.length; index++) {
      const { reading, heldLine } = readings[index]![parser];

      for (const problem of problemsOf(reading, heldLine)) {
        failures.push(`line ${index}: ${problem}`);
      }
    }

    return failures;
  };

  test("remark reads every link drawn; marked reads every one on many lines, and not on many others, whose brackets are labels of their own", () => {
    let markedReadsEvery: number = 0;

    for (let index: number = 0; index < lines.length; index++) {
      expect(readsEveryLink(index, "remark")).toBe(true);

      if (readsEveryLink(index, "marked")) {
        markedReadsEvery++;
      }
    }

    expect(markedReadsEvery).toBeGreaterThan(lines.length * 0.1);
    expect(markedReadsEvery).toBeLessThan(lines.length * 0.9);
  });

  test.each(PARSERS)(
    "read by %s, every line links as the parser alone links it, shows none of its Markdown, and no token stands inside a construct",
    (parser: OverLongTextParser) => {
      expect(failuresOf(parser)).toEqual([]);
    },
  );
});

/*
 * Lines of every shape near both cuts - brackets, backticks, backslashes,
 * "](" anywhere - drawn at random: whatever either parser makes of them,
 * the line is put back exactly, no token stands after a backslash, no
 * emoji is parted, and no link's Markdown shows that the parser alone
 * does not show.
 */
describe("OverLongText - lines of brackets, backticks and backslashes at random near both cuts (#8238)", () => {
  const PIECES: ReadonlyArray<string> = [
    "[",
    "]",
    "](",
    "][",
    "[]",
    "![",
    "`",
    "``",
    "```",
    "\\",
    "\\]",
    "\\`",
    "run",
    "run ",
    " ",
    "a".repeat(70),
    "😀",
  ];
  const LONE_HIGH_SURROGATE: RegExp = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
  const LONE_LOW_SURROGATE: RegExp = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  test.each(PARSERS)("read by %s", (parser: OverLongTextParser) => {
    const random: SeededRandom = seededRandom(82380);
    const middle: string = "log line text ".repeat(5000);

    for (let attempt: number = 0; attempt < 400; attempt++) {
      let start: string = "";
      let end: string = "";

      while (start.length < 1300) {
        start += PIECES[random(PIECES.length)]!;
      }

      while (end.length < 1300) {
        end += PIECES[random(PIECES.length)]!;
      }

      const line: string = `${start}${middle}${end}](/x/b)`;
      const heldLine: HeldLine = holdBack(line, parser);

      for (const piece of [...heldLine.inView, ...heldLine.held]) {
        expect(LONE_HIGH_SURROGATE.test(piece)).toBe(false);
        expect(LONE_LOW_SURROGATE.test(piece)).toBe(false);
      }

      for (const match of heldLine.heldText.matchAll(/(\\*)\uE005/g)) {
        expect(match[1]!.length % 2).toBe(0);
      }
    }
  });
});

/*
 * ISSUE #8668: the brackets the middle holds paired with brackets in view.
 * A "]" in the middle that closed a label of the kept start was held back,
 * and that label read on, past the token, to a "](" in the kept end - a
 * link across the whole middle that neither parser reads. A "[" the middle
 * left open was held back, and the kept end's "]" closed a label of the
 * kept start instead, so the kept end's "](" linked nothing. Now those
 * brackets stay in view, and each parser pairs them as in the whole line.
 */
describe("OverLongText - brackets the middle leaves unmatched pair with brackets in view (#8668)", () => {
  // A case whose name says "code span" or "escaped" has Markdown in the middle, shown as written.
  const BRACKET_CASES: ReadonlyArray<[string, string]> = [
    [
      "a ']' in the middle closes a label of the kept start, with no link",
      `see [a ${"b".repeat(1100)}] ${FILLER} ${"x ".repeat(100)}](/x) now`,
    ],
    [
      "two ']' in the middle close two labels of the kept start",
      `see [a [b ${"c ".repeat(600)}] d ] ${FILLER} ${"x ".repeat(100)}](/x) now`,
    ],
    [
      "a ']' in the middle closes the inner of two labels: the outer reads on to the kept end's '](' as in the whole line",
      `see [a [b ${"c ".repeat(600)}] d ${FILLER} ${"x ".repeat(100)}](/x) now`,
    ],
    [
      "a '[' the middle leaves open is closed by the kept end's ']', and the kept start's label by its '](')",
      `see [a ${"x ".repeat(600)}${FILLER}[c ${"y ".repeat(600)}] then](/x) now`,
    ],
    [
      "two '[' the middle leaves open, closed by the kept end",
      `see [a ${"x ".repeat(600)}${FILLER}[c [d ${"y ".repeat(600)}] e] then](/x) now`,
    ],
    [
      "a '[' the middle leaves open, which nothing in the kept end closes",
      `see [a ${"x ".repeat(600)}${FILLER}[c ${"y ".repeat(600)} then](/x) now`,
    ],
    [
      "both at once",
      `see [a [b ${"c ".repeat(600)}] ${FILLER}[d ${"y ".repeat(600)}] then](/x) now`,
    ],
    [
      "a ']' in a code span in the middle closes nothing",
      `see [a ${"b ".repeat(600)}\`]\` ${FILLER} x](/x) now`,
    ],
    [
      "an escaped ']' in the middle closes nothing",
      `see [a ${"b ".repeat(600)}\\] ${FILLER} x](/x) now`,
    ],
    [
      "a '[' in a code span in the middle opens nothing",
      `see [a ${"x ".repeat(600)}${FILLER}\`[c\` ${"y ".repeat(600)}] then](/x) now`,
    ],
    [
      "a '[' the middle leaves open that marked reads no label from - nested two deep",
      `see ${FILLER}[o [a [b] c] d ${"y ".repeat(600)} e](/x) now`,
    ],
    [
      "a ']' in a word the start's cut is inside of",
      `see [a ${"b".repeat(1100)}]${"c".repeat(40)} ${FILLER} ${"x ".repeat(100)}](/x) now`,
    ],
  ];

  let readings: Array<
    Record<OverLongTextParser, { reading: Reading; heldLine: HeldLine }>
  > = [];

  beforeAll(() => {
    readings = readWithBothParsers(
      BRACKET_CASES.map(([, text]: [string, string]): { text: string } => {
        return { text: text };
      }),
    );
  }, 300000);

  test.each(
    BRACKET_CASES.flatMap(
      (
        [name]: [string, string],
        index: number,
      ): Array<[string, OverLongTextParser, number]> => {
        return PARSERS.map(
          (
            parser: OverLongTextParser,
          ): [string, OverLongTextParser, number] => {
            return [name, parser, index];
          },
        );
      },
    ),
  )(
    "%s, read by %s: links as the parser alone links the line - and, where the middle holds no Markdown, renders exactly as it does",
    (name: string, parser: OverLongTextParser, index: number) => {
      const { reading, heldLine } = readings[index]![parser];

      expect(BRACKET_CASES[index]![1].length).toBeGreaterThan(
        OVER_LONG_LINE_LENGTH,
      );
      expect(problemsOf(reading, heldLine)).toEqual([]);

      if (!name.includes("code span") && !name.includes("escaped")) {
        // A boolean, so a failure does not print hundreds of kilobytes.
        expect(putBack(reading.heldHtml, heldLine.held) === reading.html).toBe(
          true,
        );
      }
    },
  );

  test.each(PARSERS)(
    "read by %s, the ']' that closes the kept start's label stays in view, between two pieces of the middle",
    (parser: OverLongTextParser) => {
      const line: string = BRACKET_CASES[0]![1];
      const closer: number = line.indexOf("]");
      const heldLine: HeldLine = holdBack(line, parser);

      expect(heldLine.inView.slice(0, 2)).toEqual([
        line.slice(0, OVER_LONG_LINE_KEPT_LENGTH),
        "]",
      ]);
      expect(heldLine.held[0]).toBe(
        line.slice(OVER_LONG_LINE_KEPT_LENGTH, closer),
      );
    },
  );

  test.each(PARSERS)(
    "read by %s, the '[' the kept end's ']' closes stays in view, between two pieces of the middle",
    (parser: OverLongTextParser) => {
      const line: string = BRACKET_CASES[3]![1];
      const opener: number = line.indexOf("[c");
      const heldLine: HeldLine = holdBack(line, parser);

      expect(heldLine.inView).toHaveLength(3);
      expect(heldLine.inView[1]).toBe("[");
      expect(heldLine.held[1]!.startsWith("c y y")).toBe(true);
      expect(heldLine.held[0]!.endsWith(line.slice(opener - 20, opener))).toBe(
        true,
      );
    },
  );

  test("the '[' marked reads no label from stays held back for marked; remark keeps it, to close", () => {
    const line: string = BRACKET_CASES[10]![1];

    expect(holdBack(line, "marked").inView).toHaveLength(2);
    expect(holdBack(line, "remark").inView[1]).toBe("[");
  });

  /*
   * A bracket kept for nothing to pair with reads as the same text either
   * way: these pin that only those that pair are kept.
   */
  test.each(PARSERS)(
    "read by %s, a ']' after a link across the start closes nothing in view: it is held back with the middle",
    (parser: OverLongTextParser) => {
      const line: string = `[${RUNS}](/x) b ] ${FILLER}`;
      const heldLine: HeldLine = holdBack(line, parser);

      expect(heldLine.inView[1]).toBe("](");
      expect(heldLine.inView).not.toContain("]");
    },
  );

  test.each(PARSERS)(
    "read by %s, a ']' after a reference kept whole across the start closes nothing in view: it is held back with the middle",
    (parser: OverLongTextParser) => {
      const line: string = `${"x ".repeat(400)}[${LABEL}] b ] ${FILLER}`;
      const heldLine: HeldLine = holdBack(line, parser);

      expect(heldLine.inView[0]!.endsWith(`[${LABEL}]`)).toBe(true);
      expect(heldLine.inView).not.toContain("]");
    },
  );

  test.each(PARSERS)(
    "read by %s, a ']' in a code span of the kept end closes nothing: the '[' the middle leaves open is held back",
    (parser: OverLongTextParser) => {
      const line: string = `see ${FILLER}[c ${"y ".repeat(600)}\`]\` then now`;

      expect(holdBack(line, parser).inView).not.toContain("[");
    },
  );

  test.each(PARSERS)(
    "read by %s, at most eight brackets stay in view at each end",
    (parser: OverLongTextParser) => {
      const line: string = `see ${"[a ".repeat(12)}${"b".repeat(1100)} ${"] ".repeat(12)}${FILLER}${"[c ".repeat(12)}${"y ".repeat(600)}${"] ".repeat(12)}](/x) now`;
      const inView: Array<string> = holdBack(line, parser).inView;

      expect(
        inView.filter((piece: string): boolean => {
          return piece === "]" || piece === "] ";
        }).length,
      ).toBeLessThanOrEqual(8);
      expect(
        inView.filter((piece: string): boolean => {
          return piece === "[";
        }).length,
      ).toBeLessThanOrEqual(8);
    },
  );
});

describe("OverLongText - lines of megabytes read in time in line with their length (#8238, #8668)", () => {
  const MB: number = 1024 * 1024;

  const repeatTo: (unit: string, length: number) => string = (
    unit: string,
    length: number,
  ): string => {
    return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
  };

  // Runs of backticks of every length, none closed: each search for a closing run would read on to the end.
  const runsOfEveryLength: (length: number) => string = (
    length: number,
  ): string => {
    let line: string = "";

    for (let run: number = 1; line.length < length; run++) {
      line += `${"`".repeat(run)} `;
    }

    return line.slice(0, length);
  };

  const LINES: ReadonlyArray<[string, string]> = [
    ["'[`'", repeatTo("[`", 4 * MB)],
    ["'[``'", repeatTo("[``", 4 * MB)],
    ["'` '", repeatTo("` ", 4 * MB)],
    ["runs of backticks of every length", runsOfEveryLength(4 * MB)],
    ["'[a [b '", repeatTo("[a [b ", 4 * MB)],
    ["'[a] [b '", repeatTo("[a] [b ", 4 * MB)],
    ["'[\\'", repeatTo("[\\", 4 * MB)],
    ["'][a'", repeatTo("][a", 4 * MB)],
    ["'[a]['", repeatTo("[a][", 4 * MB)],
    ["'[a `b] `'", repeatTo("[a `b] `", 4 * MB)],
    ["'![a ``b'", repeatTo("![a ``b", 4 * MB)],
    [
      "link texts across both cuts, with nested brackets, code and escapes",
      `[run [42 \`code ${repeatTo("run \\] [a] `b` ", 4 * MB)}\` x] y](/x/a) z [w`,
    ],
    [
      "labels open in the kept start, and ']' after ']' in the middle",
      `${"[a ".repeat(300)}${repeatTo("] b ", 4 * MB)}`,
    ],
    [
      "'[' after '[' the middle leaves open, closed in the kept end",
      `x ${repeatTo("[a ", 3000)}${repeatTo("b ", 4 * MB)}${"] ".repeat(300)}](/x)`,
    ],
  ];

  test.each(
    LINES.flatMap(
      ([name, line]: [string, string]): Array<
        [string, OverLongTextParser, string]
      > => {
        return PARSERS.map(
          (
            parser: OverLongTextParser,
          ): [string, OverLongTextParser, string] => {
            return [name, parser, line];
          },
        );
      },
    ),
  )(
    "a line of %s, read by %s, is held back in time in line with its length",
    (_name: string, parser: OverLongTextParser, line: string) => {
      const run: FastestRun<string> = fastestRun({
        run: (): string => {
          return holdBackOverLongLines(
            line,
            (): string => {
              return `${HELD_OPEN}0${HELD_CLOSE}`;
            },
            parser,
          );
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
      holdBack(line, parser);
    },
  );
});
