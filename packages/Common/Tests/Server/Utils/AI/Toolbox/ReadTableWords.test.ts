import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  citationOf,
  citationSentence,
  countFigure,
  respondersValue,
  timelineEntriesValue,
  windowSentence,
  windowValues,
  yesOrNo,
} from "../../../../../Server/Utils/AI/Toolbox/ReadTableWords";
import WidgetBuilder from "../../../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import {
  AI_READ_CARD_VALUES,
  AIActionSentence,
  aiActionSentence,
  describeAIActionSentence,
  isKnownAIActionSentence,
  isKnownAIActionTableWords,
} from "../../../../../Types/AI/AIActionWords";
import {
  AI_READ_CITATIONS,
  AI_READ_RECORD_TABLE_TITLES,
  AI_READ_TELEMETRY_TABLE_TITLES,
  AI_READ_WINDOW,
} from "../../../../../Types/AI/AIReadTableWords";
import { AIChatWidget } from "../../../../../Types/AI/AIChatTypes";

/*
 * THE PIECES A READ TOOL'S TABLE AND SOURCE CHIP ARE WORDED FROM
 * (issues #7977, #7979, #7980), AND THAT EVERY TOOL WORDS THEM.
 *
 * A chip's label and its words come from one sentence, so the label the
 * model reads and the words the reader sees never say different things; a
 * window's ends are moments, a count a figure, a flag Yes or No. A table
 * with words may still carry a line that is data - a runbook's own
 * description - drawn as written. And every table a tool builds says its
 * words: a source guard reads the toolbox.
 */

const START: Date = new Date("2026-09-14T17:49:05.000Z");
const END: Date = new Date("2026-09-14T18:49:05.000Z");

describe("a chip's label and its words, from one sentence", () => {
  test("the label is the words in English, and the words are the module's", () => {
    const sentence: AIActionSentence = aiActionSentence(
      AI_READ_CITATIONS.monitors,
      { count: countFigure(4) },
    );
    const citation: { citationLabel: string; citationWords: AIActionSentence } =
      citationOf(sentence);

    expect(citation.citationLabel).toBe("Monitors (4 found)");
    expect(citation.citationWords).toBe(sentence);
    expect(isKnownAIActionSentence(citation.citationWords)).toBe(true);
  });

  test("citationSentence builds the same from a template and its values", () => {
    expect(
      citationSentence(AI_READ_CITATIONS.teamsPaged, {
        count: countFigure(2),
        total: countFigure(7),
      }),
    ).toEqual({
      citationLabel: "Teams (2 of 7)",
      citationWords: {
        template: AI_READ_CITATIONS.teamsPaged,
        values: { count: { figure: 2 }, total: { figure: 7 } },
      },
    });
    expect(citationSentence(AI_READ_CITATIONS.probesNone)).toEqual({
      citationLabel: "Probes (0 found)",
      citationWords: { template: AI_READ_CITATIONS.probesNone },
    });
  });

  test.each<[number, string, string]>([
    [0, "On-call now (0 responders)", "Incident #4 timeline (0 entries)"],
    [1, "On-call now (1 responder)", "Incident #4 timeline (1 entry)"],
    [12, "On-call now (12 responders)", "Incident #4 timeline (12 entries)"],
  ])(
    "%s: a count with words of its own is its plural, said in the label",
    (count: number, responders: string, entries: string) => {
      const onCall: { citationLabel: string; citationWords: AIActionSentence } =
        citationSentence(AI_READ_CITATIONS.onCallNow, {
          responders: respondersValue(count),
        });
      const timeline: {
        citationLabel: string;
        citationWords: AIActionSentence;
      } = citationSentence(AI_READ_CITATIONS.incidentTimeline, {
        incident: "#4",
        entries: timelineEntriesValue(count),
      });

      expect(onCall.citationLabel).toBe(responders);
      expect(timeline.citationLabel).toBe(entries);
      expect(isKnownAIActionSentence(onCall.citationWords)).toBe(true);
      expect(isKnownAIActionSentence(timeline.citationWords)).toBe(true);
    },
  );
});

describe("a window, a count and a flag", () => {
  test("a window's ends are moments, said as the ISO text the tools wrote", () => {
    expect(windowValues(START, END)).toEqual({
      start: { moment: "2026-09-14T17:49:05.000Z" },
      end: { moment: "2026-09-14T18:49:05.000Z" },
    });

    const window: AIActionSentence = windowSentence(START, END);

    expect(window.template).toBe(AI_READ_WINDOW);
    expect(describeAIActionSentence(window)).toBe(
      `${START.toISOString()} – ${END.toISOString()}`,
    );
  });

  test("a count is a figure", () => {
    expect(countFigure(1234)).toEqual({ figure: 1234 });
  });

  test("a flag is Yes or No, as a read's card says one", () => {
    expect(yesOrNo(true)).toEqual({ term: AI_READ_CARD_VALUES.yes });
    expect(yesOrNo(false)).toEqual({ term: AI_READ_CARD_VALUES.no });
  });
});

describe("a table with words, and a line that is data", () => {
  test("words with no line of their own keep the data line, as written", () => {
    const widget: AIChatWidget = WidgetBuilder.table({
      words: {
        title: aiActionSentence(AI_READ_RECORD_TABLE_TITLES.runbook, {
          name: "Restart checkout",
        }),
      },
      description: "Rolls the checkout pods one by one.",
      columns: [{ key: "title", title: "Step", type: "text" }],
      rows: [{ title: "Drain" }],
    });

    expect(widget.title).toBe("Runbook: Restart checkout");
    expect(widget.description).toBe("Rolls the checkout pods one by one.");
    expect(isKnownAIActionTableWords(widget.data.tableWords)).toBe(true);
    expect(widget.data.tableWords?.description).toBeUndefined();
  });

  test("a line of words is the words' English, never the data handed beside it", () => {
    const widget: AIChatWidget = WidgetBuilder.table({
      words: {
        title: aiActionSentence(AI_READ_TELEMETRY_TABLE_TITLES.logs, {
          count: countFigure(2),
        }),
        description: windowSentence(START, END),
      },
      description: "ignored",
      columns: [{ key: "body", title: "Message", type: "text" }],
      rows: [{ body: "a" }, { body: "b" }],
    });

    expect(widget.title).toBe("Logs (2)");
    expect(widget.description).toBe(
      `${START.toISOString()} – ${END.toISOString()}`,
    );
  });

  test("no line at all is none", () => {
    expect(
      WidgetBuilder.table({
        words: {
          title: aiActionSentence(AI_READ_TELEMETRY_TABLE_TITLES.whatGotSlower),
        },
        columns: [],
        rows: [],
      }).description,
    ).toBeUndefined();
  });
});

/*
 * Every table a read tool leaves says its words (issues #7977, #7979): a
 * table built from a title of plain English reads English on every page.
 */
const TOOLBOX_DIR: string = path.resolve(
  __dirname,
  "../../../../../Server/Utils/AI/Toolbox",
);

// Each `WidgetBuilder.table({` call, and the text of its arguments' first lines.
function getTableCalls(source: string): Array<string> {
  const calls: Array<string> = [];
  let index: number = source.indexOf("WidgetBuilder.table(");

  while (index >= 0) {
    calls.push(source.slice(index, index + 400));
    index = source.indexOf("WidgetBuilder.table(", index + 1);
  }

  return calls;
}

// Whether a call hands the table words rather than an English title.
function isWorded(call: string): boolean {
  const titleAt: number = call.search(/\btitle\s*:/);
  // Words, or a builder of a heading with words: ...getHotspotsHeading(...).
  const wordsAt: number = call.search(/\bwords\s*:|\.\.\.get\w+Heading\(/);

  return wordsAt >= 0 && (titleAt < 0 || wordsAt < titleAt);
}

/*
 * The labels of the tools whose chips carry words (issue #7980): a label
 * written as English in place - "`Logs ${...}`" - reads English under a
 * German answer.
 */
const WORDED_CHIP_TOOLS: ReadonlyArray<string> = [
  "OnCallTools.ts",
  "StatusPageTools.ts",
  "ScheduledMaintenanceTools.ts",
  "SloTools.ts",
  "TeamTools.ts",
  "TimelineTools.ts",
  "WorkflowProbeTools.ts",
  "LogTools.ts",
  "TraceTools.ts",
  "RumTools.ts",
  "ContainerTools.ts",
  "SecurityEventTools.ts",
  "MonitorTools.ts",
  "IncidentTools.ts",
  "AlertTools.ts",
  "ExceptionTools.ts",
];

/*
 * The labels these tools still write in English, each a refusal or a
 * not-found answer the model reads more than a person does (a follow-up of
 * #7980 words them).
 */
const ENGLISH_LABELS_LEFT: ReadonlyArray<string> = [
  'citationLabel: "On-call now (policy not found)"',
  "citationLabel: `Status page ${statusPageId.toString()}`",
  'citationLabel: "SLOs (invalid status filter)"',
  "citationLabel: `Runbook ${runbookId.toString()}`",
  "citationLabel: `Team ${teamId.toString()}`",
  'citationLabel: "Incident timeline (no incident id)"',
  'citationLabel: "Incident timeline (not found)"',
  'citationLabel: "Alert timeline (no alert id)"',
  'citationLabel: "Alert timeline (not found)"',
  "citationLabel: `Workflow ${workflowId.toString()}`",
  'citationLabel: "Incident search (no query)"',
];

// Every `citationLabel:` a source writes in place.
function getWrittenLabels(source: string): Array<string> {
  return Array.from(source.matchAll(/citationLabel:\s*[`"][^\n]*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[0].replace(/,\s*$/, "");
    },
  );
}

describe("every read tool's table and chip says its words", () => {
  const files: Array<string> = fs
    .readdirSync(TOOLBOX_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    });

  test("the toolbox builds tables, and each says its words", () => {
    let tables: number = 0;

    for (const file of files) {
      const source: string = fs.readFileSync(
        path.join(TOOLBOX_DIR, file),
        "utf8",
      );

      for (const call of getTableCalls(source)) {
        tables++;
        expect({ file, worded: isWorded(call) }).toEqual({
          file,
          worded: true,
        });
      }
    }

    // On-call, status pages, SLOs, logs, traces and the rest: about 36.
    expect(tables).toBeGreaterThanOrEqual(35);
  });

  test.each(WORDED_CHIP_TOOLS)(
    "%s writes no label in English but the ones listed",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(TOOLBOX_DIR, file),
        "utf8",
      );

      expect(source).toMatch(/citationSentence\(|citationOf\(/);
      expect(
        getWrittenLabels(source).filter((label: string): boolean => {
          return !ENGLISH_LABELS_LEFT.includes(label);
        }),
      ).toEqual([]);
    },
  );

  test("the readings themselves (negative controls)", () => {
    expect(
      isWorded("WidgetBuilder.table({\n  title: `Logs (${rows.length})`,"),
    ).toBe(false);
    expect(
      isWorded(
        "WidgetBuilder.table({\n  words: {\n    title: aiActionSentence(X),",
      ),
    ).toBe(true);
    expect(
      isWorded("WidgetBuilder.table({\n  ...getHotspotsHeading(kind, window),"),
    ).toBe(true);
    expect(
      getWrittenLabels(
        "citationLabel: `Logs ${start} (${n} shown)`,\n...citationSentence(X),",
      ),
    ).toEqual(["citationLabel: `Logs ${start} (${n} shown)`"]);
  });
});
