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
 * Every widget a tool leaves says its words (issues #7977, #7979, #8312): a
 * table, a chart, a list of incidents, alerts or exceptions, a trace
 * waterfall or stat cards built from a title of plain English reads
 * English on every page. A resource card and an action card carry words
 * of their own (ResourceCardWordsGuard).
 */
const TOOLBOX_DIR: string = path.resolve(
  __dirname,
  "../../../../../Server/Utils/AI/Toolbox",
);
const CHAT_DIR: string = path.resolve(
  __dirname,
  "../../../../../Server/Utils/AI/Chat",
);

const WORDED_WIDGET_BUILDERS: ReadonlyArray<string> = [
  "table",
  "timeSeries",
  "bars",
  "traceWaterfall",
  "incidentList",
  "alertList",
  "exceptionList",
  "stats",
];

// Each `WidgetBuilder.<builder>(` call, and the text of its arguments' first lines.
function getWidgetCalls(
  source: string,
): Array<{ builder: string; call: string }> {
  const calls: Array<{ builder: string; call: string }> = [];
  const pattern: RegExp = new RegExp(
    `WidgetBuilder\\.(${WORDED_WIDGET_BUILDERS.join("|")})\\(`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    calls.push({
      builder: match[1]!,
      call: source.slice(match.index!, match.index! + 400),
    });
  }

  return calls;
}

// Whether a call hands the widget words rather than an English title.
function isWorded(call: string): boolean {
  const titleAt: number = call.search(/\btitle\s*:/);
  // Words, or a builder of a heading with words: ...getHotspotsHeading(...).
  const wordsAt: number = call.search(/\bwords\s*:|\.\.\.get\w+Heading\(/);

  return wordsAt >= 0 && (titleAt < 0 || wordsAt < titleAt);
}

/*
 * The files that only describe a chip, rather than write one: the
 * helpers that build a label and its words at once, and the result's type.
 */
const CHIP_HELPER_FILES: ReadonlyArray<string> = [
  "ReadTableWords.ts",
  "ToolTypes.ts",
];

/*
 * Every chip a tool leaves says its words (issues #7980, #8311): a label
 * written in place - "`Logs ${...}`", "citationLabel: label" - reads
 * English under a German answer, so no tool writes citationLabel at all:
 * it spreads ReadTableWords' citationSentence or citationOf, whose English
 * is the label.
 */
function getWrittenLabels(source: string): Array<string> {
  return Array.from(source.matchAll(/\bcitationLabel\b[^\n]*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[0].replace(/,\s*$/, "");
    },
  );
}

function toolboxFiles(): Array<string> {
  return fs.readdirSync(TOOLBOX_DIR).filter((file: string): boolean => {
    return file.endsWith(".ts");
  });
}

describe("every tool's widgets and chips say their words", () => {
  const files: Array<string> = toolboxFiles();

  test("the toolbox builds widgets of every worded kind, and each says its words", () => {
    let widgets: number = 0;
    const builders: Set<string> = new Set<string>();

    for (const file of files) {
      const source: string = fs.readFileSync(
        path.join(TOOLBOX_DIR, file),
        "utf8",
      );

      for (const { builder, call } of getWidgetCalls(source)) {
        widgets++;
        builders.add(builder);
        expect({ file, builder, worded: isWorded(call) }).toEqual({
          file,
          builder,
          worded: true,
        });
      }
    }

    // About 36 tables, and the lists, the charts and the waterfall (#8312).
    expect(widgets).toBeGreaterThanOrEqual(48);
    expect(Array.from(builders).sort()).toEqual(
      [
        "alertList",
        "bars",
        "exceptionList",
        "incidentList",
        "table",
        "timeSeries",
        "traceWaterfall",
      ].sort(),
    );
  });

  test.each(
    files.filter((file: string): boolean => {
      return !CHIP_HELPER_FILES.includes(file);
    }),
  )("%s writes no chip's label in place", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(TOOLBOX_DIR, file),
      "utf8",
    );

    expect(getWrittenLabels(source)).toEqual([]);
  });

  test("the tools that leave a chip build it from words", () => {
    const buildsFromWords: RegExp = /citationSentence\(|citationOf\(/;
    const wordedTools: Array<string> = files.filter((file: string): boolean => {
      return buildsFromWords.test(
        fs.readFileSync(path.join(TOOLBOX_DIR, file), "utf8"),
      );
    });

    /*
     * Every read and write tool: the docs, code, cloud, metric, profile,
     * context, write and setup tools among them (#8311).
     */
    for (const file of [
      "DocsTools.ts",
      "CodeTools.ts",
      "CodeWriteTools.ts",
      "CloudTools.ts",
      "MetricTools.ts",
      "ProfileTools.ts",
      "ContextTools.ts",
      "DataObservabilityTools.ts",
      "ChangeTools.ts",
      "RecentChangesTools.ts",
      "TransceiverTools.ts",
      "SetupHealthTools.ts",
      "ResourceTools.ts",
      "WhoIsToldTools.ts",
      "IncidentWriteTools.ts",
      "AlertWriteTools.ts",
      "NoteWriteTools.ts",
      "AIActionTools.ts",
      "SetupTools.ts",
      "WorkflowBuilderTools.ts",
      "AIMetaTools.ts",
      "SecurityCaseTools.ts",
      "DataSecurityTools.ts",
      "OnCallTools.ts",
      "StatusPageTools.ts",
      "SloTools.ts",
      "RunbookTools.ts",
      "TeamTools.ts",
      "TimelineTools.ts",
      "WorkflowProbeTools.ts",
      "IncidentTools.ts",
    ]) {
      expect(wordedTools).toContain(file);
    }
  });

  test("a page of a long output says its words too (ToolOutputPager)", () => {
    const source: string = fs.readFileSync(
      path.join(CHAT_DIR, "ToolOutputPager.ts"),
      "utf8",
    );

    expect(source).toContain("...ToolOutputPager.getPageCitation(page)");
    expect(source).not.toMatch(/citationLabel:\s*[`"]/);
  });

  test("the readings themselves (negative controls)", () => {
    expect(
      isWorded("WidgetBuilder.table({\n  title: `Logs (${rows.length})`,"),
    ).toBe(false);
    expect(
      isWorded(
        "WidgetBuilder.incidentList({\n  title: `${stateLabel} (${total})`,",
      ),
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
      getWidgetCalls(
        "WidgetBuilder.bars({ title: 'x' }); WidgetBuilder.resourceCard({ title: 'y' });",
      ).map((call: { builder: string }): string => {
        return call.builder;
      }),
    ).toEqual(["bars"]);
    expect(
      getWrittenLabels(
        "citationLabel: `Logs ${start} (${n} shown)`,\n...citationSentence(X),\ncitationLabel,\n",
      ),
    ).toEqual(["citationLabel: `Logs ${start} (${n} shown)`", "citationLabel"]);
  });
});
