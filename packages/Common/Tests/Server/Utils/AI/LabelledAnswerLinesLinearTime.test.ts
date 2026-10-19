import { findLabelledValues } from "../../../../Server/Utils/AI/LabelledAnswerLines";
import RemediationPlanRunner from "../../../../Server/Utils/AI/Remediation/RemediationPlanRunner";
import InsightTriageRunner from "../../../../Server/Utils/AI/SRE/Insights/InsightTriageRunner";
import { sanitizeGeneratedTitle } from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ExceptionAIClassification from "../../../../Types/AI/ExceptionAIClassification";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { namedPattern } from "../../../Helpers/SourcePatterns";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT A MODEL ANSWERED IS READ IN TIME IN LINE WITH ITS LENGTH, AND SAYS
 * WHAT IT SAID BEFORE.
 *
 * An AI run ends its answer with a line the server acts on - which runbook
 * a remediation plan picked, how an exception was classified - and a chat's
 * first answer is cut down to its title. A model's answer can be steered by
 * what it read, so each is read in time in line with its length:
 *
 *  - the "Label: value" lines (findLabelledValues), where the pattern's
 *    white space ran across line breaks on both sides of a "**" and split a
 *    run of blank lines every way at every line start - the cube of its
 *    length;
 *  - a title's trailing quotes and punctuation, read once from its end.
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

// The patterns as they were: the references the reader must agree with.
const SELECTED_RUNBOOK_BEFORE: RegExp =
  /^\s*\**\s*selectedrunbook\s*\**\s*[:=]\s*\**\s*([a-z0-9-]{8,64}|none)\b/gim;
const CLASSIFICATION_BEFORE: RegExp =
  /^\s*\**\s*classification\s*\**\s*[:=]\s*\**\s*(code-fault|user-error|expected-denial|infrastructure|unknown)\b/gim;

const REMEDIATION_FILE: string =
  "packages/Common/Server/Utils/AI/Remediation/RemediationPlanRunner.ts";
const TRIAGE_FILE: string =
  "packages/Common/Server/Utils/AI/SRE/Insights/InsightTriageRunner.ts";

interface Labelled {
  label: string;
  value: RegExp;
  before: RegExp;
}

const LABELLED: ReadonlyArray<Labelled> = [
  {
    label: "selectedrunbook",
    value: namedPattern(REMEDIATION_FILE, "SELECTED_RUNBOOK_VALUE"),
    before: SELECTED_RUNBOOK_BEFORE,
  },
  {
    label: "classification",
    value: namedPattern(TRIAGE_FILE, "CLASSIFICATION_VALUE"),
    before: CLASSIFICATION_BEFORE,
  },
];

const valuesBefore: (labelled: Labelled, text: string) => Array<string> = (
  labelled: Labelled,
  text: string,
): Array<string> => {
  return Array.from(
    text.matchAll(new RegExp(labelled.before.source, labelled.before.flags)),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
};

const WORST_ANSWERS: Array<[string, string]> = [
  ["a run of blank lines before a star", repeat("\n", LENGTH) + "*"],
  [
    "a label, then blank lines and tabs",
    "SELECTEDRUNBOOK\n" + repeat("\t\n", LENGTH) + "N",
  ],
  ["labels with no value, line after line", repeat("Classification:\n", LENGTH)],
  ["stars and white space", repeat(" * \n", LENGTH) + "x"],
  ["a label on every line", repeat("classification: x\n", LENGTH)],
];

describe("an answer built to be slow is read quickly", () => {
  test.each(WORST_ANSWERS)("%s", (_label: string, answer: string) => {
    expect(
      timeOf(() => {
        RemediationPlanRunner.parseSelectedRunbook(answer, new Set<string>());
        InsightTriageRunner.parseClassification(answer);
      }),
    ).toBeLessThan(2000);
  });

  test("the verdict on the last line is still found after them", () => {
    const answer: string =
      repeat("\n", LENGTH) + "**Classification:** code-fault\n";

    expect(InsightTriageRunner.parseClassification(answer)).toBe(
      ExceptionAIClassification.CodeFault,
    );
  });

  test.each([
    ["a run of quotes inside a title", "Disk" + repeat('"', LENGTH) + "x"],
    ["a run of full stops inside a title", "Disk" + repeat(". ", LENGTH) + "x"],
    ["tabs and quotes", repeat("\t'", LENGTH) + "x"],
  ])("a chat title with %s", (_label: string, raw: string) => {
    expect(
      timeOf(() => {
        sanitizeGeneratedTitle(raw);
      }),
    ).toBeLessThan(2000);
  });
});

describe("the values found are the values the pattern found", () => {
  const PIECES: ReadonlyArray<string> = [
    "selectedrunbook",
    "SelectedRunbook",
    "classification",
    "Classification",
    ":",
    "=",
    " ",
    "\t",
    "\n",
    "\r",
    "\u2028",
    "*",
    "**",
    "none",
    "NONE",
    "code-fault",
    "user-error",
    "expected-denial",
    "infrastructure",
    "unknown",
    "0123456789abcdef",
    "abcdefgh-1234",
    "x",
    "-",
    "_",
    "\u212a",
  ];

  const SEEDS: ReadonlyArray<string> = [
    "Analysis...\n\n**SelectedRunbook:** 0123456789abcdef\n",
    "Classification: code-fault\nClassification = user-error",
    "  ** classification ** : ** unknown",
    "selectedrunbook\n:\nnone",
  ];

  const drawnAnswers: () => Array<string> = (): Array<string> => {
    const random: SeededRandom = seededRandom(31337);
    const texts: Array<string> = generatedTexts(20000, 4242, PIECES, 14);

    for (let index: number = 0; index < 20000; index++) {
      let text: string = SEEDS[random(SEEDS.length)]!;
      const changes: number = random(5);

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

      texts.push(text);
    }

    return texts;
  };

  const ANSWERS: Array<string> = drawnAnswers();

  test.each(LABELLED)(
    "every $label value, in order, on forty thousand drawn answers",
    (labelled: Labelled) => {
      const differences: Array<string> = [];
      let found: number = 0;

      for (const answer of ANSWERS) {
        const expected: Array<string> = valuesBefore(labelled, answer);

        found += expected.length;

        if (
          JSON.stringify(
            findLabelledValues({
              text: answer,
              label: labelled.label,
              value: labelled.value,
            }),
          ) !== JSON.stringify(expected)
        ) {
          differences.push(JSON.stringify(answer));
        }
      }

      expect(differences).toEqual([]);
      expect(found).toBeGreaterThan(2000);
    },
  );

  test("the runs act on the last value, as before", () => {
    const candidates: Set<string> = new Set(["0123456789abcdef"]);

    expect(
      RemediationPlanRunner.parseSelectedRunbook(
        "SelectedRunbook: none\n**SelectedRunbook:** 0123456789ABCDEF",
        candidates,
      ),
    ).toBe("0123456789abcdef");
    expect(
      RemediationPlanRunner.parseSelectedRunbook(
        "SelectedRunbook: 0123456789abcdef\nSelectedRunbook: none",
        candidates,
      ),
    ).toBeNull();
    expect(
      InsightTriageRunner.parseClassification(
        "classification: unknown\n  * Classification = Infrastructure",
      ),
    ).toBe(ExceptionAIClassification.Infrastructure);
    expect(InsightTriageRunner.parseClassification("no verdict")).toBe(
      ExceptionAIClassification.Unknown,
    );
  });

  test("a chat title, as the patterns trimmed it, on forty thousand drawn titles", () => {
    // The chain as it was: the reference the product must agree with.
    const titleBefore: (raw: string) => string = (raw: string): string => {
      const firstLine: string | undefined = raw
        .split("\n")
        .map((line: string) => {
          return line.trim();
        })
        .find((line: string) => {
          return line.length > 0;
        });

      let title: string = (firstLine || "")
        .replace(/^#+\s*/, "")
        .replace(/^Title:\s*/i, "")
        .replace(/^["'`“”‘’\s]+/, "")
        .replace(/["'`“”‘’\s]+$/, "")
        .replace(/[.,;:!?…\s]+$/, "")
        .replace(/\s+/g, " ")
        .trim();

      if (title.length > 90) {
        title = title.substring(0, 90).trim();
      }

      return title;
    };

    const differences: Array<string> = [];

    for (const raw of generatedTexts(
      40000,
      2718,
      ['"', "'", "`", "“", "”", "‘", "’", " ", "\t", "\n", ".", ",", ";", ":", "!", "?", "…", "#", "Title:", "x", "Disk full", "\u00a0"],
      14,
    )) {
      if (sanitizeGeneratedTitle(raw) !== titleBefore(raw)) {
        differences.push(JSON.stringify(raw));
      }
    }

    expect(differences).toEqual([]);
  });
});
