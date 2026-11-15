import { describe, expect, test } from "@jest/globals";
import {
  AI_ACTION_PLURAL_SENTENCES,
  AI_ACTION_SENTENCES,
  AI_ACTION_TERM_WORDS,
  AI_READ_CARD_LINES,
  AI_READ_RUM_APPLICATION_STATUSES,
  AI_READ_WORKFLOW_RUN_STATUSES,
  AIActionSentence,
  aiActionFigure,
  aiActionMoment,
  aiActionPluralSentence,
  aiActionSentence,
  aiActionTerm,
  describeAIActionSentence,
  describeAIActionTableWords,
  isKnownAIActionSentence,
  isKnownAIActionTableWords,
} from "../../../Types/AI/AIActionWords";
import {
  AI_READ_CITATION_PLURALS,
  AI_READ_CITATIONS,
  AI_READ_CONTAINER_STATUSES,
  AI_READ_PROBE_STATUSES,
  AI_READ_PROFILE_KINDS,
  AI_READ_RECORD_TABLE_CELLS,
  AI_READ_RECORD_TABLE_LINES,
  AI_READ_RECORD_TABLE_PLURAL_SENTENCES,
  AI_READ_RECORD_TABLE_TERMS,
  AI_READ_RECORD_TABLE_TITLES,
  AI_READ_TABLE_AND_CITATION_PLURAL_SENTENCES,
  AI_READ_TABLE_AND_CITATION_SENTENCES,
  AI_READ_TABLE_TERMS,
  AI_READ_TELEMETRY_TABLE_LINES,
  AI_READ_TELEMETRY_TABLE_TITLES,
  AI_READ_WEB_VITAL_RATINGS,
  AI_READ_WINDOW,
} from "../../../Types/AI/AIReadTableWords";
import {
  RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL,
  RUM_APPLICATION_RECEIVING_DATA_LABEL,
  RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
} from "../../../Types/Rum/RumApplicationStatus";
import WorkflowStatus, {
  getWorkflowStatusLabel,
} from "../../../Types/Workflow/WorkflowStatus";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  getProfileCategoryNoun,
  ProfileCategory,
} from "../../../Utils/Profiles/ProfileTypes";

/*
 * WHAT ASK AI'S TABLES AND SOURCES SAY, AS SENTENCES THE DASHBOARD TRUSTS
 * (issues #7977, #7979, #7980).
 *
 * Every read tool's table and Sources chip says its words as sentences of
 * Types/AI/AIReadTableWords, which AIActionWords lists among the sentences
 * it trusts: only then does the chat say them in the reader's language. A
 * window's ends are moments, which the server stores as the ISO text every
 * tool always wrote. The English of each sentence is what the table and
 * the chip store: a test here holds the important ones to the English the
 * tools wrote before, so an answer's history reads the same to the model.
 */

const START: Date = new Date("2026-09-14T17:49:05.000Z");
const END: Date = new Date("2026-09-14T18:49:05.000Z");

// A reader whose language words what it is handed: "[de] <English>".
function bracketed(language: string): Translator {
  return createTranslator((text: string): string => {
    return `[${language}] ${text}`;
  }, language);
}

describe("every sentence and word of the module is one the Dashboard trusts", () => {
  test("each sentence is among AI_ACTION_SENTENCES", () => {
    expect(AI_READ_TABLE_AND_CITATION_SENTENCES.length).toBeGreaterThan(100);

    for (const template of AI_READ_TABLE_AND_CITATION_SENTENCES) {
      expect({
        template,
        trusted: AI_ACTION_SENTENCES.includes(template),
      }).toEqual({ template, trusted: true });
    }

    for (const template of [
      ...Object.values(AI_READ_RECORD_TABLE_TITLES),
      ...Object.values(AI_READ_RECORD_TABLE_LINES),
      ...Object.values(AI_READ_RECORD_TABLE_CELLS),
      ...Object.values(AI_READ_TELEMETRY_TABLE_TITLES),
      ...Object.values(AI_READ_TELEMETRY_TABLE_LINES),
      ...Object.values(AI_READ_CITATIONS),
      AI_READ_WINDOW,
    ]) {
      expect(AI_READ_TABLE_AND_CITATION_SENTENCES).toContain(template);
    }
  });

  test("each plural is among AI_ACTION_PLURAL_SENTENCES, and counts", () => {
    for (const plural of [
      ...Object.values(AI_READ_RECORD_TABLE_PLURAL_SENTENCES),
      ...Object.values(AI_READ_CITATION_PLURALS),
    ]) {
      expect(AI_READ_TABLE_AND_CITATION_PLURAL_SENTENCES).toContain(plural);
      expect(AI_ACTION_PLURAL_SENTENCES).toContain(plural);
      expect(isKnownAIActionSentence(aiActionPluralSentence(plural, 3))).toBe(
        true,
      );
      // A plural with no count is no sentence of the module.
      expect(isKnownAIActionSentence({ template: plural.other })).toBe(false);
    }
  });

  test("each cell's word is a term the Dashboard trusts", () => {
    for (const term of [
      ...Object.values(AI_READ_RECORD_TABLE_TERMS),
      ...AI_READ_PROFILE_KINDS,
      ...Object.values(AI_READ_CONTAINER_STATUSES),
      ...Object.values(AI_READ_PROBE_STATUSES),
      ...Object.values(AI_READ_WEB_VITAL_RATINGS),
      ...AI_READ_RUM_APPLICATION_STATUSES,
      ...AI_READ_WORKFLOW_RUN_STATUSES,
    ]) {
      expect(AI_ACTION_TERM_WORDS).toContain(term);
    }

    expect(AI_READ_TABLE_TERMS).toEqual(
      expect.arrayContaining(Object.values(AI_READ_RECORD_TABLE_TERMS)),
    );
  });

  test("a RUM application's and a workflow run's statuses are their pages' own words", () => {
    expect(AI_READ_RUM_APPLICATION_STATUSES).toEqual([
      RUM_APPLICATION_RECEIVING_DATA_LABEL,
      RUM_APPLICATION_NO_RECENT_TRAFFIC_LABEL,
      RUM_APPLICATION_WAITING_FOR_DATA_LABEL,
    ]);

    for (const status of Object.values(WorkflowStatus)) {
      expect(AI_READ_WORKFLOW_RUN_STATUSES).toContain(
        getWorkflowStatusLabel(status),
      );
    }
    // A run that worked reads as the runs list says it.
    expect(AI_READ_WORKFLOW_RUN_STATUSES).toContain("Executed");
  });

  test("a profile's kinds are the words the profile tools name them by", () => {
    for (const category of Object.values(ProfileCategory)) {
      expect(AI_READ_PROFILE_KINDS).toContain(
        getProfileCategoryNoun(category as ProfileCategory),
      );
    }
  });

  test("no two sentences are the same, so each is worded once", () => {
    const counted: Map<string, number> = new Map<string, number>();

    for (const template of AI_READ_TABLE_AND_CITATION_SENTENCES) {
      counted.set(template, (counted.get(template) || 0) + 1);
    }

    const repeated: Array<string> = Array.from(counted.entries())
      .filter(([, count]: [string, number]): boolean => {
        return count > 1;
      })
      .map(([template]: [string, number]): string => {
        return template;
      });

    /*
     * A table's title and its chip may share a sentence on purpose: one
     * maintenance event reads "Maintenance event #7" on both.
     */
    expect(repeated).toEqual(["Maintenance event {{number}}"]);
  });
});

describe("a window's ends are moments the module trusts", () => {
  const window: AIActionSentence = aiActionSentence(AI_READ_WINDOW, {
    start: aiActionMoment(START),
    end: aiActionMoment(END),
  });

  test("a sentence with moments is trusted, and says their ISO text in English", () => {
    expect(isKnownAIActionSentence(window)).toBe(true);
    expect(describeAIActionSentence(window)).toBe(
      "2026-09-14T17:49:05.000Z – 2026-09-14T18:49:05.000Z",
    );
  });

  test.each([
    ["not a date", { moment: "yesterday" }],
    ["empty", { moment: "" }],
    [
      "too long to be a moment",
      { moment: `${START.toISOString()}${"0".repeat(40)}` },
    ],
    ["not text", { moment: 1757872145000 }],
  ])("a moment that is %s is not", (_name: string, moment: unknown) => {
    expect(
      isKnownAIActionSentence({
        template: AI_READ_WINDOW,
        values: { start: moment, end: aiActionMoment(END) },
      }),
    ).toBe(false);
  });

  test("a table whose line is a window is trusted whole", () => {
    expect(
      isKnownAIActionTableWords({
        title: aiActionSentence(AI_READ_TELEMETRY_TABLE_TITLES.logs, {
          count: aiActionFigure(25),
        }),
        description: window,
      }),
    ).toBe(true);
  });

  test("the reader's language words the sentence around the moments", () => {
    expect(
      describeAIActionSentence(
        aiActionSentence(AI_READ_TELEMETRY_TABLE_LINES.rankedBy, {
          metric: "p95",
          start: aiActionMoment(START),
          end: aiActionMoment(END),
        }),
        bracketed("de"),
      ),
    ).toBe(
      "[de] Ranked by p95 · 2026-09-14T17:49:05.000Z – 2026-09-14T18:49:05.000Z",
    );
  });
});

/*
 * What a table and a chip store is their words in English: the exports
 * print it, the model reads it in a turn's history, and a Dashboard that
 * cannot read the words draws it. These are the English the tools wrote
 * before their words, said by the words now.
 */
describe("the words say in English what the tools always wrote", () => {
  test.each<[string, AIActionSentence, string]>([
    [
      "the on-call policies table",
      aiActionSentence(AI_READ_RECORD_TABLE_TITLES.onCallPolicies, {
        count: aiActionFigure(3),
      }),
      "On-call policies (3)",
    ],
    [
      "who is on call, over every schedule",
      aiActionPluralSentence(
        AI_READ_RECORD_TABLE_PLURAL_SENTENCES.onCallNowSchedules,
        2,
      ),
      "On-call now (2 schedules)",
    ],
    [
      "who is on call, over one schedule",
      aiActionPluralSentence(
        AI_READ_RECORD_TABLE_PLURAL_SENTENCES.onCallNowSchedules,
        1,
      ),
      "On-call now (1 schedule)",
    ],
    [
      "a schedule's row",
      aiActionSentence(AI_READ_RECORD_TABLE_CELLS.schedule, {
        name: "Primary",
      }),
      "Schedule 'Primary'",
    ],
    [
      "nobody on call",
      aiActionSentence(AI_READ_CARD_LINES.noOneOnCall),
      "No one is on call",
    ],
    [
      "the on-call pages line",
      aiActionSentence(AI_READ_RECORD_TABLE_LINES.onCallPagesInHours, {
        hours: aiActionFigure(24),
      }),
      "Policy executions and direct pages in the last 24h",
    ],
    [
      "an SLO list filtered to a status",
      aiActionSentence(AI_READ_RECORD_TABLE_TITLES.slosInStatus, {
        status: aiActionTerm("At Risk"),
        count: aiActionFigure(2),
      }),
      "At Risk SLOs (2)",
    ],
    [
      "an SLO's rolling window",
      aiActionSentence(AI_READ_RECORD_TABLE_CELLS.rollingWindow, {
        days: aiActionFigure(30),
      }),
      "Rolling 30d",
    ],
    [
      "the maintenance list's line",
      aiActionSentence(AI_READ_RECORD_TABLE_LINES.maintenanceWindows, {
        past: aiActionFigure(30),
        upcoming: aiActionFigure(7),
      }),
      "Windows overlapping the last 30d and next 7d",
    ],
    [
      "a state change's entry",
      aiActionSentence(AI_READ_RECORD_TABLE_CELLS.stateChangedToWithRootCause, {
        state: "Resolved",
        rootCause: "Bad deploy",
      }),
      "State changed to Resolved. Root cause: Bad deploy",
    ],
    [
      "the logs chip",
      aiActionSentence(AI_READ_CITATIONS.logs, {
        start: aiActionMoment(START),
        end: aiActionMoment(END),
        count: aiActionFigure(25),
      }),
      "Logs 2026-09-14T17:49:05.000Z – 2026-09-14T18:49:05.000Z (25 shown)",
    ],
    [
      "the monitors chip",
      aiActionSentence(AI_READ_CITATIONS.monitorsInStatus, {
        status: "offline",
        count: aiActionFigure(1),
      }),
      'Monitors in status "offline" (1 found)',
    ],
    [
      "a team's chip",
      aiActionPluralSentence(AI_READ_CITATION_PLURALS.team, 2, {
        name: "Platform",
      }),
      'Team "Platform" (2 members)',
    ],
    [
      "who is on call's chip, with its responders",
      aiActionSentence(AI_READ_CITATIONS.onCallNow, {
        responders: {
          list: [
            aiActionPluralSentence(AI_READ_CITATION_PLURALS.responders, 1),
          ],
        },
      }),
      "On-call now (1 responder)",
    ],
    [
      "a timeline's chip, with its entries",
      aiActionSentence(AI_READ_CITATIONS.incidentTimeline, {
        incident: "#42",
        entries: {
          list: [
            aiActionPluralSentence(
              AI_READ_CITATION_PLURALS.timelineEntries,
              12,
            ),
          ],
        },
      }),
      "Incident #42 timeline (12 entries)",
    ],
    [
      "a summary that read only the newest events",
      aiActionSentence(AI_READ_TELEMETRY_TABLE_LINES.basedOnRecentEvents, {
        start: aiActionMoment(START),
        end: aiActionMoment(END),
        count: aiActionFigure(500),
      }),
      "2026-09-14T17:49:05.000Z – 2026-09-14T18:49:05.000Z (based on the most recent 500 events — counts are a floor)",
    ],
  ])("%s", (_name: string, sentence: AIActionSentence, english: string) => {
    expect(isKnownAIActionSentence(sentence)).toBe(true);
    expect(describeAIActionSentence(sentence)).toBe(english);
  });

  test("a count is a figure: the reader's digits, never the server's", () => {
    const title: AIActionSentence = aiActionSentence(
      AI_READ_RECORD_TABLE_TITLES.statusPages,
      { count: aiActionFigure(1234) },
    );

    expect(describeAIActionTableWords({ title }).title).toBe(
      "Status pages (1234)",
    );
    expect(describeAIActionTableWords({ title }, bracketed("fa")).title).toBe(
      "[fa] Status pages (۱٬۲۳۴)",
    );
  });
});
