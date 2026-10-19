import InvestigationReportSummary from "../../../../Server/Utils/AI/SRE/InvestigationReportSummary";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import { stripBlockMarkers } from "../../../../Server/Utils/AI/SRE/TldrBlockMarkers";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A TL;DR'S BLOCK MARKERS COME OFF IN TIME IN LINE WITH ITS LENGTH,
 * EXACTLY AS THE ROUNDS TOOK THEM OFF.
 *
 * A TL;DR, and an investigation report's section when there is none, is
 * flattened to plain text: its leading "TL;DR" / "Summary" labels, then the
 * block markers of every line ("> ## cause", "- - cause"), each taken off
 * to a fixed point. Each round of the markers took off one marker per line
 * and built the whole text again - a report of a few thousand stacked
 * markers meant a few thousand copies of it, on the list routes that show a
 * run's summary. stripBlockMarkers looks again only where something can
 * have changed, giving exactly what the rounds gave. Stacked labels, taken
 * off one per round from the start of the text, are held to the same time.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  const startedAt: number = Date.now();
  run();
  return Date.now() - startedAt;
};

// The rounds as they were: the reference the one pass must agree with.
const HEADING_BEFORE: RegExp = /^\s{0,3}#{1,6}\s*/gm;
const QUOTE_OR_BULLET_BEFORE: RegExp = /^\s{0,3}(?:[>\-+*]|\d+[.)])\s+/gm;

const roundsBefore: (text: string) => string = (text: string): string => {
  let current: string = text;
  let previous: string = "";

  while (current !== previous) {
    previous = current;
    current = current
      .replace(new RegExp(HEADING_BEFORE.source, "gm"), "")
      .replace(new RegExp(QUOTE_OR_BULLET_BEFORE.source, "gm"), "");
  }

  return current;
};

const WORST_TEXTS: Array<[string, string]> = [
  ["stacked quote markers", repeat("> ", LENGTH) + "The pool ran dry."],
  ["stacked bullets", repeat("- ", LENGTH) + "The pool ran dry."],
  ["stacked headings", repeat("# ", LENGTH) + "The pool ran dry."],
  ["stacked numbers", repeat("1. ", LENGTH) + "The pool ran dry."],
  ["a heading on every line", repeat("# x\n", LENGTH)],
  ["markers on blank lines", repeat(">\n", LENGTH)],
  ["indented markers", repeat("   > ", LENGTH) + "x"],
  ["a run of line breaks", repeat("\n", LENGTH) + "# x"],
  [
    "digits before a stack",
    repeat("1", LENGTH / 2) + "\n" + repeat("> ", LENGTH / 2),
  ],
];

const WORST_LABELS: Array<[string, string]> = [
  ["label lines", repeat("TL;DR\n", LENGTH) + "The pool ran dry."],
  ["inline labels", repeat("TLDR: ", LENGTH) + "The pool ran dry."],
  ["summary labels and headings", repeat("## Summary\n", LENGTH) + "x"],
];

describe("text built to be slow is read quickly", () => {
  test.each(WORST_TEXTS)(
    "%s, stripped of block markers",
    (_label: string, text: string) => {
      expect(
        timeOf(() => {
          stripBlockMarkers(text);
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each([...WORST_TEXTS, ...WORST_LABELS])(
    "%s, as a TL;DR and as a report's summary",
    (_label: string, text: string) => {
      expect(
        timeOf(() => {
          InvestigationTldr.sanitizeTldr(text);
          InvestigationReportSummary.fromReport(text);
        }),
      ).toBeLessThan(2000);
    },
  );

  test("what is left after a stack of markers or labels is the sentence", () => {
    expect(
      InvestigationTldr.sanitizeTldr(
        "> ".repeat(LENGTH / 2) + "The connection pool ran dry at 09:14.",
      ),
    ).toBe("The connection pool ran dry at 09:14.");
    expect(
      InvestigationTldr.sanitizeTldr(
        "TLDR: ".repeat(LENGTH / 8) + "The connection pool ran dry at 09:14.",
      ),
    ).toBe("The connection pool ran dry at 09:14.");
    expect(
      InvestigationTldr.sanitizeTldr(
        "## Summary\n".repeat(LENGTH / 16) +
          "The connection pool ran dry at 09:14.",
      ),
    ).toBe("The connection pool ran dry at 09:14.");
  });
});

describe("the markers taken off are the markers the rounds took off", () => {
  const PIECES: ReadonlyArray<string> = [
    " ",
    " ",
    "\t",
    "\n",
    "\n",
    "\r",
    "\u2028",
    "\u00a0",
    "#",
    "#",
    "##",
    "#######",
    ">",
    ">",
    "-",
    "+",
    "*",
    "1",
    "12",
    ".",
    ")",
    "x",
    "a",
    "> ",
    "- ",
    "1. ",
    "# ",
    "\n> ",
    "  ",
    "   ",
    "    ",
  ];

  test("on sixty thousand drawn texts", () => {
    const differences: Array<string> = [];
    let changed: number = 0;

    for (const text of [
      ...generatedTexts(40000, 6151, PIECES, 18),
      ...generatedTexts(20000, 1597, PIECES, 40),
    ]) {
      const expected: string = roundsBefore(text);

      if (expected !== text) {
        changed++;
      }

      if (stripBlockMarkers(text) !== expected) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    expect(changed).toBeGreaterThan(30000);
  });

  test("on twenty thousand reports with markers put in, taken out or written over", () => {
    const SEEDS: ReadonlyArray<string> = [
      "## Summary\n> The pool ran dry.\n\n- restart it\n- 1. check",
      "  \n\n#######x",
      "> > > ## cause\n- - cause\n1. 2) item",
      "#\n#\n#\nx",
      " \n> x\n   # y",
    ];
    const random: SeededRandom = seededRandom(424242);
    const differences: Array<string> = [];

    for (let index: number = 0; index < 20000; index++) {
      let text: string = SEEDS[random(SEEDS.length)]!;
      const changes: number = 1 + random(5);

      for (let change: number = 0; change < changes; change++) {
        const at: number = random(text.length + 1);
        const piece: string = PIECES[random(PIECES.length)]!;
        const kind: number = random(4);

        if (kind < 2) {
          text = text.slice(0, at) + piece + text.slice(at);
        } else if (kind === 2) {
          text = text.slice(0, at) + text.slice(at + 1);
        } else {
          text = text.slice(0, at) + piece + text.slice(at + 1);
        }
      }

      if (stripBlockMarkers(text) !== roundsBefore(text)) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
  });

  test("where the order of the rounds decides what is taken", () => {
    /*
     * The first round's heading cannot start at the first line (four
     * characters of white space come first), so it takes "\n######" from
     * the second; the next round's heading then starts at the first line and
     * reaches the "#" left on the next - white space and all.
     */
    expect(stripBlockMarkers("  \n\n#######x")).toBe("x");
    expect(roundsBefore("  \n\n#######x")).toBe("x");
    expect(stripBlockMarkers("#\n#\n#\nx")).toBe("x");
    expect(stripBlockMarkers("> > > ## cause")).toBe("cause");
    expect(stripBlockMarkers("text with no markers")).toBe(
      "text with no markers",
    );
  });
});
