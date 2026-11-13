import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_SENTENCES,
  AI_ACTION_TITLES,
  AI_READ_CARD_SENTENCES,
  AI_READ_CARD_VALUES,
  AI_READ_TABLE_LINES,
  AI_READ_TABLE_TITLES,
  AIActionTableWords,
  aiActionFigure,
  aiActionSentence,
  aiActionTerm,
  describeAIActionTableCell,
  describeAIActionTableWords,
  isKnownAIActionSentence,
  isKnownAIActionTableWords,
} from "../../../Types/AI/AIActionWords";
import { createTranslator, Translator } from "../../../Types/Translator";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A TABLE'S WORDS, AS THE DASHBOARD TRUSTS AND SAYS THEM (issue #7394).
 *
 * A read's table - query_monitors' monitors under their cards - stores its
 * title, the line under it and the cells that are OneUptime's words as
 * words of Types/AI/AIActionWords, beside the same words in English. The
 * Dashboard reads them from a conversation's saved JSON, so it says them
 * in the reader's language only when they are the module's: a title and a
 * line that are its sentences, cells that are its terms (a monitor type's
 * name among them) or sentences. Anything else reads as the English the
 * table stores.
 */

// A reader whose language words what it is handed: "[de] <English>".
function bracketed(language: string): Translator {
  return createTranslator((text: string): string => {
    return `[${language}] ${text}`;
  }, language);
}

function monitorsTable(): AIActionTableWords {
  return {
    title: aiActionSentence(AI_READ_TABLE_TITLES.monitors, {
      count: aiActionFigure(4),
    }),
    description: aiActionSentence(
      AI_READ_TABLE_LINES.notOperationalFirstDisabledLast,
    ),
    cells: [
      { type: aiActionTerm("Website") },
      {},
      {
        type: aiActionTerm("Incoming Request"),
        currentStatus: aiActionTerm(AI_READ_CARD_VALUES.disabled),
      },
    ],
  };
}

describe("the table's sentences are the module's", () => {
  test("every title and line is a sentence the Dashboard trusts", () => {
    for (const template of [
      ...Object.values(AI_READ_TABLE_TITLES),
      ...Object.values(AI_READ_TABLE_LINES),
    ]) {
      expect(AI_ACTION_SENTENCES).toContain(template);
    }

    expect(
      isKnownAIActionSentence(
        aiActionSentence(AI_READ_TABLE_TITLES.monitorsInStatus, {
          status: "Offline",
          count: aiActionFigure(2),
        }),
      ),
    ).toBe(true);
  });

  test("the English templates, as the table stores them", () => {
    expect(AI_READ_TABLE_TITLES).toEqual({
      monitors: "Monitors ({{count}})",
      monitorsWithProblems: "Monitors with problems ({{count}})",
      monitorsInStatus: 'Monitors in status "{{status}}" ({{count}})',
    });
    expect(AI_READ_TABLE_LINES).toEqual({
      notOperationalOnly: "Non-operational monitors only",
      notOperationalFirst: "Non-operational monitors first",
      notOperationalFirstDisabledLast: "Non-operational first, Disabled last",
    });
  });
});

describe("a stored table's words are trusted only when they are the module's", () => {
  test("a table's words as a tool builds them", () => {
    expect(isKnownAIActionTableWords(monitorsTable())).toBe(true);
  });

  test("a title alone is enough: the line and the cells may be left out", () => {
    expect(isKnownAIActionTableWords({ title: monitorsTable().title })).toBe(
      true,
    );
  });

  test("a cell may be a sentence of the module", () => {
    expect(
      isKnownAIActionTableWords({
        title: monitorsTable().title,
        cells: [
          {
            rule: aiActionSentence(AI_READ_CARD_SENTENCES.rule, { order: 2 }),
          },
        ],
      }),
    ).toBe(true);
  });

  test.each([
    ["nothing", undefined],
    ["a string", "Monitors (4)"],
    ["an array", [monitorsTable()]],
    ["no title", { description: monitorsTable().description }],
    [
      "a title that is no sentence of the module",
      { title: { template: "Hello {{count}}" } },
    ],
    ["a title in plain text", { title: "Monitors (4)" }],
    [
      "a line that is no sentence of the module",
      { title: monitorsTable().title, description: { template: "Sorted" } },
    ],
    [
      "a cell term that is no word of the module",
      {
        title: monitorsTable().title,
        cells: [{ type: aiActionTerm("Teapot") }],
      },
    ],
    [
      "a cell that is plain text",
      { title: monitorsTable().title, cells: [{ type: "Website" }] },
    ],
    [
      "a cell that is a number",
      { title: monitorsTable().title, cells: [{ type: 4 }] },
    ],
    [
      "cells that are not a list",
      {
        title: monitorsTable().title,
        cells: { type: aiActionTerm("Website") },
      },
    ],
    [
      "a row of cells that is a list",
      { title: monitorsTable().title, cells: [[aiActionTerm("Website")]] },
    ],
    [
      "a term whose inSentence is not a flag",
      {
        title: monitorsTable().title,
        cells: [{ type: { term: "Website", inSentence: "yes" } }],
      },
    ],
    [
      "a title that counts with no figure it can write",
      {
        title: aiActionSentence(AI_READ_TABLE_TITLES.monitors, {
          count: { figure: "4" } as never,
        }),
      },
    ],
  ])("not %s", (_name: string, value: unknown) => {
    expect(isKnownAIActionTableWords(value)).toBe(false);
  });

  test("not more rows of cells than a tool lists, nor more cells a row", () => {
    const title: AIActionTableWords["title"] = monitorsTable().title;

    const rows: Array<Record<string, ReturnType<typeof aiActionTerm>>> = [];
    for (let index: number = 0; index < 500; index++) {
      rows.push({ type: aiActionTerm("Website") });
    }
    expect(isKnownAIActionTableWords({ title, cells: rows })).toBe(true);
    expect(
      isKnownAIActionTableWords({
        title,
        cells: [...rows, { type: aiActionTerm("Website") }],
      }),
    ).toBe(false);

    const wide: Record<string, ReturnType<typeof aiActionTerm>> = {};
    for (let index: number = 0; index < 21; index++) {
      wide[`c${index}`] = aiActionTerm("Website");
    }
    expect(isKnownAIActionTableWords({ title, cells: [wide] })).toBe(false);
  });

  test("a sentence of a write's card is no reason to trust a title of another shape", () => {
    expect(
      isKnownAIActionTableWords({
        title: aiActionSentence(AI_ACTION_TITLES.createIncident, {
          title: "x",
        }),
        cells: [{ type: { template: "Not ours" } }],
      }),
    ).toBe(false);
  });
});

describe("the words in English, as the table stores them, and in the reader's", () => {
  test("English by default: the title with its count, the line, each cell", () => {
    const words: AIActionTableWords = monitorsTable();

    expect(describeAIActionTableWords(words)).toEqual({
      title: "Monitors (4)",
      description: "Non-operational first, Disabled last",
    });
    expect(describeAIActionTableCell(words.cells![2]!["type"]!)).toBe(
      "Incoming Request",
    );
    expect(describeAIActionTableCell(words.cells![2]!["currentStatus"]!)).toBe(
      "Disabled",
    );
  });

  test("no line, none said", () => {
    expect(
      describeAIActionTableWords({ title: monitorsTable().title }),
    ).toEqual({ title: "Monitors (4)" });
  });

  test("a count is written as the server always wrote it in English, with no separator", () => {
    expect(
      describeAIActionTableWords({
        title: aiActionSentence(AI_READ_TABLE_TITLES.monitors, {
          count: aiActionFigure(1234),
        }),
      }).title,
    ).toBe("Monitors (1234)");
  });

  test("the reader's words: every template and term looked up, the status as data", () => {
    const words: AIActionTableWords = {
      title: aiActionSentence(AI_READ_TABLE_TITLES.monitorsInStatus, {
        status: "Offline",
        count: aiActionFigure(2),
      }),
      cells: [{ currentStatus: aiActionTerm(AI_READ_CARD_VALUES.disabled) }],
    };
    const de: Translator = bracketed("de");

    expect(describeAIActionTableWords(words, de).title).toBe(
      '[de] Monitors in status "Offline" (2)',
    );
    expect(
      describeAIActionTableCell(words.cells![0]!["currentStatus"]!, de),
    ).toBe("[de] Disabled");
  });

  test("asked to, a value is set apart in its sentence", () => {
    const words: AIActionTableWords = {
      title: aiActionSentence(AI_READ_TABLE_TITLES.monitorsInStatus, {
        status: "Offline",
        count: aiActionFigure(2),
      }),
    };
    const fa: Translator = bracketed("fa");
    const title: string = describeAIActionTableWords(words, fa, {
      setsValuesApart: true,
    }).title;

    expect(title).toContain(isolated("Offline"));
    expect(withoutIsolateMarks(title)).toBe(
      '[fa] Monitors in status "Offline" (۲)',
    );
  });
});
