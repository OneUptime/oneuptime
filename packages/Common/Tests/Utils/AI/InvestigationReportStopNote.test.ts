import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { ObservabilityAssistantResult } from "../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIInvestigationEngine from "../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import InvestigationReportSummary from "../../../Server/Utils/AI/SRE/InvestigationReportSummary";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
  AI_RUN_STOP_NOTE_OPENINGS,
  INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION,
} from "../../../Types/AI/AIAgentRunLimits";
import {
  AnswerStopNoteSplit,
  InvestigationReportSection,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
  RuledOutCause,
  isRunStopNoteLine,
  parseInvestigationReport,
  parseRuledOutCauses,
  splitAnswerStopNote,
} from "../../../Utils/AI/InvestigationReport";

/*
 * AN INVESTIGATION A LIMIT STOPPED SAYS SO APART FROM ITS ANALYSIS.
 *
 * When a limit stops an investigation (issue #6440: its time limit, a cap
 * the project set, loop detection), OneUptime writes one line under the
 * analysis: "_This investigation stopped at the incident investigation time
 * limit of 20 minutes. Change it in [Incidents → AI → ...](...)._". The
 * report parser used to read it as the end of the model's last section, so
 * the AI card drew it under Suggested next steps as if it were a step - and
 * when the last section was Ruled out, inside the last cause ruled out, as
 * part of why that cause was ruled out. The parser now hands it over on its
 * own (stopNote), outside the sections, the preamble and bodyMarkdown -
 * but only where the server writes it: the last paragraph before the
 * Evidence checked list, or before the footer.
 */

const MINUTE_MS: number = 60 * 1000;
const SETTINGS_URL: string =
  "https://oneuptime.example.com/dashboard/5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e/incidents/ai/settings#InvestigationLimits";

const NEXT_STEPS: string =
  "1. Roll checkout-api back to 2026.11.08-2.\n2. Watch the p99 latency of /pay for 15 minutes.";

const STRUCTURED_ANALYSIS: string = [
  "**Summary** — Checkout fails for about 1 in 5 payments since 14:02 [C1].",
  "**Most likely root cause** — The 14:00 deploy of checkout-api lowered its database pool to 5 connections [C1].",
  "**Ruled out**\n- **A network fault:** packet loss on the checkout hosts stayed at 0% [C1].\n- **The payments provider:** its own status page and our calls to it were healthy [C1].",
  `**Suggested next steps**\n${NEXT_STEPS}`,
].join("\n\n");

// The same analysis, with nothing after the causes it ruled out.
const ANALYSIS_ENDING_IN_RULED_OUT: string = [
  "**Summary** — Checkout fails for about 1 in 5 payments since 14:02 [C1].",
  "**Most likely root cause** — The 14:00 deploy of checkout-api lowered its database pool to 5 connections [C1].",
  "**Ruled out**\n- **A network fault:** packet loss on the checkout hosts stayed at 0% [C1].\n- **The payments provider:** its own status page and our calls to it were healthy [C1].",
].join("\n\n");

function limits(overrides: Partial<AIAgentRunLimits>): AIAgentRunLimits {
  return { ...AIAgentRunLimitsHelper.getDefault(), ...overrides };
}

const INCIDENT_TIME_LIMIT: AIAgentRunLimits = limits({
  maxWallClockMs: 20 * MINUTE_MS,
  timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
});

function stopNote(
  reason: AIRunStopReason = AIRunStopReason.TimeLimit,
  runLimits: AIAgentRunLimits = INCIDENT_TIME_LIMIT,
): string {
  return AIAgentRunLimitsHelper.getStopNote({
    reason,
    limits: runLimits,
    settingsUrl: SETTINGS_URL,
  });
}

// The report exactly as the engine posts it.
function report(data: {
  analysis: string;
  note?: string | undefined;
  cited?: boolean | undefined;
  heading?: string | undefined;
}): string {
  const result: ObservabilityAssistantResult = {
    contentInMarkdown: data.analysis,
    citations:
      data.cited === false
        ? []
        : [
            {
              id: "C1",
              toolName: "search_logs",
              label: "Error logs of checkout-api",
              queryArguments: {},
              rowCount: 42,
            },
          ],
    toolCallCount: data.cited === false ? 0 : 1,
    llmCallCount: 3,
    totalTokens: 1000,
    modelName: "gpt-test",
    ...(data.note ? { stopNoteInMarkdown: data.note } : {}),
  } as unknown as ObservabilityAssistantResult;

  return AIInvestigationEngine.buildBrandedMarkdown(
    result,
    data.analysis,
    0,
    0,
    undefined,
    data.heading,
  );
}

function everythingButTheNote(parsed: ParsedInvestigationReport): string {
  return [
    parsed.preamble,
    parsed.bodyMarkdown,
    ...parsed.sections.map((section: InvestigationReportSection): string => {
      return section.markdown;
    }),
  ].join("\n");
}

describe("the stop note the server writes is read apart", () => {
  test("under a structured analysis: not a step, and the steps are the model's own", () => {
    const note: string = stopNote();
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis: STRUCTURED_ANALYSIS, note }),
    );

    expect(parsed.stopNote).toBe(note);
    expect(parsed.nextSteps).toBe(NEXT_STEPS);
    expect(everythingButTheNote(parsed)).not.toContain("stopped");
    expect(parsed.isStructured).toBe(true);
    // What follows it is still read as before.
    expect(parsed.evidenceChecked).toEqual([
      {
        citationId: "C1",
        label: "Error logs of checkout-api",
        rowCount: 42,
      },
    ]);
    expect(parsed.footer?.queryCount).toBe(1);
  });

  test("after Ruled out: the last cause keeps its own reason, with no note inside it", () => {
    const note: string = stopNote();
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis: ANALYSIS_ENDING_IN_RULED_OUT, note }),
    );
    const causes: Array<RuledOutCause> = parseRuledOutCauses(parsed.ruledOut);

    expect(parsed.stopNote).toBe(note);
    expect(causes).toEqual([
      {
        causeMarkdown: "A network fault",
        reasonMarkdown: "packet loss on the checkout hosts stayed at 0% [C1].",
      },
      {
        causeMarkdown: "The payments provider",
        reasonMarkdown:
          "its own status page and our calls to it were healthy [C1].",
      },
    ]);
  });

  test("before the footer, when the run cited nothing", () => {
    const note: string = stopNote(AIRunStopReason.Loop);
    const markdown: string = report({
      analysis: STRUCTURED_ANALYSIS,
      note,
      cited: false,
    });

    expect(markdown).not.toContain("Evidence checked");

    const parsed: ParsedInvestigationReport =
      parseInvestigationReport(markdown);

    expect(parsed.stopNote).toBe(
      "_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
    expect(parsed.nextSteps).toBe(NEXT_STEPS);
    expect(parsed.footer).toBeDefined();
    expect(everythingButTheNote(parsed)).not.toContain("stopped");
  });

  test("under prose that names no section: the body is the prose alone", () => {
    const prose: string =
      "Checkout fails since the 14:00 deploy of checkout-api; its database pool is at 5 connections [C1].";
    const note: string = stopNote(
      AIRunStopReason.ToolCalls,
      limits({ maxToolCalls: 40 }),
    );
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis: prose, note }),
    );

    expect(parsed.isStructured).toBe(false);
    expect(parsed.stopNote).toBe(note);
    expect(parsed.bodyMarkdown).toBe(prose);
  });

  test("a run that wrote nothing: the note alone, and an empty body", () => {
    const note: string = stopNote();
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis: "", note }),
    );

    expect(parsed.stopNote).toBe(note);
    expect(parsed.bodyMarkdown).toBe("");
    expect(parsed.sections).toEqual([]);
  });

  test("a security case's triage report reads the same", () => {
    const note: string = stopNote(
      AIRunStopReason.ModelCalls,
      limits({ maxLlmCalls: 30 }),
    );
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({
        analysis: STRUCTURED_ANALYSIS,
        note,
        heading: "Security Case Triage",
      }),
    );

    expect(parsed.stopNote).toBe(note);
    expect(parsed.nextSteps).toBe(NEXT_STEPS);
  });

  test("its link stays as written, for the card to draw", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis: STRUCTURED_ANALYSIS, note: stopNote() }),
    );

    expect(parsed.stopNote).toBe(
      `_This investigation stopped at the incident investigation time limit of 20 minutes. Change it in [${INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION}](${SETTINGS_URL})._`,
    );
  });

  test.each([
    ["model calls", AIRunStopReason.ModelCalls, limits({ maxLlmCalls: 7 })],
    ["tool calls", AIRunStopReason.ToolCalls, limits({ maxToolCalls: 7 })],
    ["tokens", AIRunStopReason.Tokens, limits({ maxTokens: 7_000_000 })],
    ["a loop", AIRunStopReason.Loop, limits({})],
    [
      "the default time limit",
      AIRunStopReason.TimeLimit,
      limits({ timeLimitSource: AIRunTimeLimitSource.Default }),
    ],
    [
      "the project's time limit",
      AIRunStopReason.TimeLimit,
      limits({
        maxWallClockMs: 45 * MINUTE_MS,
        timeLimitSource: AIRunTimeLimitSource.Project,
      }),
    ],
    [
      "an incident's time limit",
      AIRunStopReason.TimeLimit,
      INCIDENT_TIME_LIMIT,
    ],
    [
      "an alert's time limit",
      AIRunStopReason.TimeLimit,
      limits({
        maxWallClockMs: 20 * MINUTE_MS,
        timeLimitSource: AIRunTimeLimitSource.AlertInvestigation,
      }),
    ],
  ])(
    "every note: stopped by %s",
    (_name: string, reason: AIRunStopReason, runLimits: AIAgentRunLimits) => {
      for (const settingsUrl of [SETTINGS_URL, null]) {
        const note: string = AIAgentRunLimitsHelper.getStopNote({
          reason,
          limits: runLimits,
          settingsUrl,
        });
        const parsed: ParsedInvestigationReport = parseInvestigationReport(
          report({ analysis: STRUCTURED_ANALYSIS, note }),
        );

        expect(isRunStopNoteLine(note)).toBe(true);
        expect(parsed.stopNote).toBe(note);
        expect(parsed.nextSteps).toBe(NEXT_STEPS);
      }
    },
  );
});

describe("a report no limit stopped reads as it always has", () => {
  test("no note, and the last section ends where the model ended it", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis: STRUCTURED_ANALYSIS }),
    );

    expect(parsed.stopNote).toBeUndefined();
    expect(parsed.nextSteps).toBe(NEXT_STEPS);
    expect(
      parsed.sections.map((section: InvestigationReportSection): string => {
        return section.kind;
      }),
    ).toEqual([
      InvestigationReportSectionKind.Summary,
      InvestigationReportSectionKind.RootCause,
      InvestigationReportSectionKind.RuledOut,
      InvestigationReportSectionKind.NextSteps,
    ]);
  });

  test("the same report with and without a note differs only by the note", () => {
    const without: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis: STRUCTURED_ANALYSIS }),
    );
    const withNote: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis: STRUCTURED_ANALYSIS, note: stopNote() }),
    );

    expect({ ...withNote, stopNote: undefined }).toEqual({
      ...without,
      stopNote: undefined,
    });
  });
});

describe("only the server's note, where the server writes it, is lifted", () => {
  test("a note the model wrote in the middle of its analysis stays its text", () => {
    const analysis: string = [
      "**Summary** — Checkout fails since 14:02 [C1].",
      "_This run stopped at this project's limit of 10 model calls per run._",
      `**Suggested next steps**\n${NEXT_STEPS}`,
    ].join("\n\n");
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis }),
    );

    expect(parsed.stopNote).toBeUndefined();
    expect(parsed.summary).toContain("_This run stopped at this project's");
  });

  test("a look-alike line that ends the model's last paragraph, with no blank line above it, stays", () => {
    const analysis: string = `**Summary** — Checkout fails since 14:02 [C1].\n_This run stopped at the default time limit of 120 minutes per run._`;
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis }),
    );

    expect(parsed.stopNote).toBeUndefined();
    expect(parsed.summary).toContain("_This run stopped at the default");
  });

  test("a look-alike line inside a code block stays in it", () => {
    const analysis: string = [
      "**Summary** — Checkout fails since 14:02 [C1].",
      "```\n_This run stopped early: it kept repeating calls that showed it nothing new._\n```",
    ].join("\n\n");
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis }),
    );

    expect(parsed.stopNote).toBeUndefined();
    expect(parsed.summary).toContain("```");
  });

  test("when both are there, the server's note is the one lifted", () => {
    const analysis: string = [
      "**Summary** — Checkout fails since 14:02 [C1].",
      "_This run stopped at this project's limit of 10 model calls per run._",
      `**Suggested next steps**\n${NEXT_STEPS}`,
    ].join("\n\n");
    const note: string = stopNote();
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis, note }),
    );

    expect(parsed.stopNote).toBe(note);
    expect(parsed.summary).toContain("limit of 10 model calls");
    expect(parsed.nextSteps).toBe(NEXT_STEPS);
  });

  test("an Evidence checked list the model wrote is not the server's: the note before the server's is found", () => {
    const analysis: string = [
      "**Summary** — Checkout fails since 14:02 [C1].",
      "**Evidence checked**\n- **[C1]** Error logs of checkout-api — 42 row(s)",
      `**Suggested next steps**\n${NEXT_STEPS}`,
    ].join("\n\n");
    const note: string = stopNote();
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      report({ analysis, note }),
    );

    expect(parsed.stopNote).toBe(note);
    expect(parsed.nextSteps).toBe(NEXT_STEPS);
    // The server's list, the last one, is the list read.
    expect(parsed.evidenceChecked).toHaveLength(1);
    expect(everythingButTheNote(parsed)).not.toContain("stopped");
  });
});

describe("isRunStopNoteLine", () => {
  test.each(
    AI_RUN_STOP_NOTE_OPENINGS.map((opening: string) => {
      return [opening];
    }),
  )("a note opening %p, in italics", (opening: string) => {
    expect(isRunStopNoteLine(`_${opening}at a limit._`)).toBe(true);
    expect(isRunStopNoteLine(`  _${opening}at a limit._  `)).toBe(true);
  });

  test.each([
    ["not in italics", "This run stopped at a limit."],
    ["in italics that stop early", "_This run stopped_ at a limit."],
    ["in bold", "__This run stopped at a limit.__"],
    ["with another opening", "_This runner stopped at a limit._"],
    ["in other words", "_The run was stopped at a limit._"],
    ["of an underscore alone", "_"],
    ["with nothing in it", ""],
  ])("a line %s is no note", (_name: string, line: string) => {
    expect(isRunStopNoteLine(line)).toBe(false);
  });

  test("a line of 400,000 characters is read at once", () => {
    const line: string = `_This run stopped ${"x".repeat(400_000)}`;
    const read: FastestRun<[boolean, boolean]> = fastestRun({
      run: (): [boolean, boolean] => {
        return [isRunStopNoteLine(line), isRunStopNoteLine(`${line}_`)];
      },
      limitInMs: 1000,
    });

    expect(read.result).toEqual([false, true]);
    expect(read.inMs).toBeLessThan(1000);
  });
});

/*
 * The TL;DR the server takes from a report that names no section is its
 * body: it is the analysis, never the line that the run stopped.
 */
describe("the report's TL;DR", () => {
  test("of prose under a note is the prose", () => {
    const prose: string =
      "Checkout fails since the 14:00 deploy of checkout-api; its database pool is at 5 connections.";
    const tldr: string | null = InvestigationReportSummary.fromReport(
      report({ analysis: prose, note: stopNote() }),
    );

    expect(tldr).toBe(prose);
  });

  test("of a run that wrote nothing but the note is nothing", () => {
    expect(
      InvestigationReportSummary.fromReport(
        report({ analysis: "", note: stopNote() }),
      ),
    ).toBeNull();
  });
});

/*
 * A CHAT ANSWER A LIMIT STOPPED: the chat agent (ChatAgentRunner) puts the
 * note under the answer - `${answer}\n\n${note}`, or the note alone when
 * the run wrote nothing - for Ask AI and an investigation's follow-up
 * answers. splitAnswerStopNote hands it over apart, for the chat to draw as
 * the AI card does, by the same rule as a report's note.
 */
describe("splitAnswerStopNote", () => {
  const ANSWER: string =
    "checkout-api's pool sat at its ceiling of 5 from 14:02 [C1].\n\n- Roll back the 14:00 deploy.\n- Watch /pay for 15 minutes.";
  const PROJECT_URL: string =
    "https://oneuptime.example.com/dashboard/5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e/settings/ai-features#LimitsPerRun";

  // The answer exactly as the chat agent finishes it.
  function stoppedAnswer(answer: string, note: string): string {
    return answer.trim() ? `${answer}\n\n${note}` : note;
  }

  test.each([
    ["model calls", AIRunStopReason.ModelCalls, limits({ maxLlmCalls: 40 })],
    ["tool calls", AIRunStopReason.ToolCalls, limits({ maxToolCalls: 300 })],
    ["tokens", AIRunStopReason.Tokens, limits({ maxTokens: 2_000_000 })],
    ["a loop", AIRunStopReason.Loop, limits({})],
    [
      "the default time limit",
      AIRunStopReason.TimeLimit,
      limits({ timeLimitSource: AIRunTimeLimitSource.Default }),
    ],
    [
      "the project's time limit",
      AIRunStopReason.TimeLimit,
      limits({
        maxWallClockMs: 45 * MINUTE_MS,
        timeLimitSource: AIRunTimeLimitSource.Project,
      }),
    ],
    [
      "a chat app's time limit",
      AIRunStopReason.TimeLimit,
      limits({
        maxWallClockMs: 25 * MINUTE_MS,
        timeLimitSource: AIRunTimeLimitSource.ChatApp,
      }),
    ],
  ])(
    "every note the chat agent writes comes apart from its answer: stopped by %s",
    (_name: string, reason: AIRunStopReason, runLimits: AIAgentRunLimits) => {
      for (const settingsUrl of [PROJECT_URL, null]) {
        const note: string = AIAgentRunLimitsHelper.getStopNote({
          reason,
          limits: runLimits,
          settingsUrl,
        });
        const split: AnswerStopNoteSplit = splitAnswerStopNote(
          stoppedAnswer(ANSWER, note),
        );

        expect(split).toEqual({ answerMarkdown: ANSWER, stopNote: note });
      }
    },
  );

  test("a run that wrote nothing is the note alone, with no answer", () => {
    const note: string = stopNote(AIRunStopReason.Loop);

    expect(splitAnswerStopNote(stoppedAnswer("", note))).toEqual({
      answerMarkdown: "",
      stopNote: note,
    });
  });

  test("an answer no limit stopped comes back exactly as it came", () => {
    for (const answer of [
      ANSWER,
      `${ANSWER}\n\n`,
      "",
      "_An answer in italics from end to end._",
    ]) {
      expect(splitAnswerStopNote(answer)).toEqual({
        answerMarkdown: answer,
        stopNote: undefined,
      });
    }
  });

  test("blank lines and Windows line endings around the note do not hide it", () => {
    const note: string = stopNote();
    const split: AnswerStopNoteSplit = splitAnswerStopNote(
      `${ANSWER.replace(/\n/g, "\r\n")}\r\n\r\n  ${note}  \r\n\r\n`,
    );

    expect(split.stopNote).toBe(note);
    expect(split.answerMarkdown).toBe(ANSWER);
  });

  test("a look-alike the model ended its own paragraph with stays its text", () => {
    const answer: string = `${ANSWER}\n${stopNote()}`;

    expect(splitAnswerStopNote(answer)).toEqual({
      answerMarkdown: answer,
      stopNote: undefined,
    });
  });

  test("a look-alike inside a code block the answer left open stays in it", () => {
    const answer: string = `Run this:\n\n\`\`\`\nkubectl get pods\n\n${stopNote()}`;

    expect(splitAnswerStopNote(answer).stopNote).toBeUndefined();
  });

  test("only the last paragraph is read: a note with text after it stays", () => {
    const answer: string = `${stopNote()}\n\n${ANSWER}`;

    expect(splitAnswerStopNote(answer)).toEqual({
      answerMarkdown: answer,
      stopNote: undefined,
    });
  });

  test("the truncation line the chat agent puts before the note stays with the answer", () => {
    const truncated: string = `${ANSWER}\n\n_[Answer truncated by the output token limit.]_`;
    const note: string = stopNote(
      AIRunStopReason.Tokens,
      limits({ maxTokens: 9 }),
    );
    const split: AnswerStopNoteSplit = splitAnswerStopNote(
      stoppedAnswer(truncated, note),
    );

    expect(split).toEqual({ answerMarkdown: truncated, stopNote: note });
  });

  test("whatever it is handed, it answers", () => {
    for (const value of [undefined, null, 42, {}] as Array<unknown>) {
      expect(splitAnswerStopNote(value as string)).toEqual({
        answerMarkdown: "",
        stopNote: undefined,
      });
    }
  });

  test("an answer of 200,000 lines is read at once", () => {
    const answer: string = Array.from(
      { length: 200_000 },
      (_v: unknown, index: number): string => {
        return index % 2 === 0 ? `- item ${index}` : "```";
      },
    ).join("\n");
    const text: string = `${answer}\n\n${stopNote()}`;
    const split: FastestRun<AnswerStopNoteSplit> = fastestRun({
      run: (): AnswerStopNoteSplit => {
        return splitAnswerStopNote(text);
      },
      limitInMs: 2000,
    });

    expect(split.inMs).toBeLessThan(2000);
    // The fences pair up, so the note is outside them: it comes apart.
    expect(split.result.stopNote).toBe(stopNote());
    expect(split.result.answerMarkdown).toBe(answer);
  });
});
