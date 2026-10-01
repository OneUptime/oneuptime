/*
 * The decisions behind the run's Steps view, without rendering it: which way
 * a step went and where that led, how a recorded value is shown, which of a
 * step's arguments did not resolve, and which steps open by themselves.
 *
 * Half of what is pinned here is about traces written before a field existed.
 * The view must read them sensibly - name the port from its id, and say
 * nothing about wiring that was never recorded - rather than break, or claim
 * "nothing is connected" because a list is missing.
 */

import {
  ERROR_PORT_ID,
  INLINE_VALUE_MAX_LENGTH,
  StepOutcome,
  StepOutcomeKind,
  StepPortTone,
  StepValueRow,
  TraceAttention,
  TraceValueKind,
  formatTraceValue,
  getReceivedRows,
  getReturnedRows,
  getStepOutcome,
  getStepWarnings,
  getTraceAttention,
  getTraceResumesAt,
  getTraceSteps,
  isSingleStepRun,
  isStepFailed,
  isWholeReference,
  returnsNothingByDesign,
  shouldStepStartOpen,
} from "../../../../UI/Components/Workflow/StepTracePresentation";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
} from "../../../../Types/Workflow/StepTrace";
import { describe, expect, test } from "@jest/globals";

type StepOverrides = Partial<WorkflowStepTraceEntry>;

const aStep: (overrides?: StepOverrides) => WorkflowStepTraceEntry = (
  overrides?: StepOverrides,
): WorkflowStepTraceEntry => {
  return {
    componentId: "step-1",
    metadataId: "log",
    title: "Log",
    status: WorkflowStepStatus.Success,
    startedAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:00:00.005Z",
    durationInMs: 5,
    argumentValues: {},
    returnValues: {},
    executedPort: "out",
    ...overrides,
  };
};

const traceOf: (
  ...steps: Array<WorkflowStepTraceEntry>
) => WorkflowStepTrace = (
  ...steps: Array<WorkflowStepTraceEntry>
): WorkflowStepTrace => {
  return { steps: steps };
};

describe("getTraceSteps", () => {
  test("reads the steps of a trace", () => {
    expect(getTraceSteps(traceOf(aStep(), aStep()))).toHaveLength(2);
  });

  test("reads nothing from something that is not a trace", () => {
    expect(getTraceSteps(undefined)).toEqual([]);
    expect(getTraceSteps(null)).toEqual([]);
    expect(
      getTraceSteps({ steps: "nope" } as unknown as WorkflowStepTrace),
    ).toEqual([]);
  });

  test("skips entries that are not steps", () => {
    expect(
      getTraceSteps({
        steps: [null, aStep(), 3] as unknown as Array<WorkflowStepTraceEntry>,
      }),
    ).toHaveLength(1);
  });
});

describe("getStepOutcome", () => {
  describe("the port", () => {
    test("is named as the canvas names it", () => {
      const outcome: StepOutcome = getStepOutcome(
        traceOf(
          aStep({
            executedPort: "no",
            executedPortTitle: "No",
            executedPortDescription: "Runs when it does not hold.",
            nextSteps: [],
          }),
        ),
        0,
      );

      expect(outcome.portTitle).toBe("No");
      expect(outcome.portDescription).toBe("Runs when it does not hold.");
    });

    test("is named from its id in a trace that predates port names", () => {
      expect(
        getStepOutcome(traceOf(aStep({ executedPort: "yes" })), 0).portTitle,
      ).toBe("Yes");
    });

    test("has no description when none was recorded", () => {
      expect(
        getStepOutcome(traceOf(aStep({ executedPort: "yes" })), 0)
          .portDescription,
      ).toBeNull();
    });

    /*
     * Only Error means the step failed. Yes and No are both just the way the
     * run went, so neither is drawn as a failure.
     */
    test("reads as a failure only when it is the Error port", () => {
      expect(ERROR_PORT_ID).toBe("error");

      for (const port of ["yes", "no", "out", "success", "execute"]) {
        expect(
          getStepOutcome(traceOf(aStep({ executedPort: port })), 0).portTone,
        ).toBe(StepPortTone.Normal);
      }

      expect(
        getStepOutcome(traceOf(aStep({ executedPort: "error" })), 0).portTone,
      ).toBe(StepPortTone.Error);
    });
  });

  describe("where it led", () => {
    test("names each step the port is wired to, with its number when it ran", () => {
      const outcome: StepOutcome = getStepOutcome(
        traceOf(
          aStep({
            componentId: "if-else-1",
            executedPort: "yes",
            nextSteps: [
              { componentId: "slack-1", title: "Send to Slack" },
              { componentId: "email-1", title: "Send Email" },
            ],
          }),
          aStep({ componentId: "slack-1" }),
          aStep({ componentId: "other-1" }),
          aStep({ componentId: "email-1" }),
        ),
        0,
      );

      expect(outcome.kind).toBe(StepOutcomeKind.LedTo);
      expect(outcome.nextSteps).toEqual([
        { componentId: "slack-1", title: "Send to Slack", stepNumber: 2 },
        { componentId: "email-1", title: "Send Email", stepNumber: 4 },
      ]);
    });

    test("has no number for a step that did not run", () => {
      const outcome: StepOutcome = getStepOutcome(
        traceOf(
          aStep({
            executedPort: "out",
            nextSteps: [{ componentId: "slack-1", title: "Send to Slack" }],
          }),
        ),
        0,
      );

      expect(outcome.nextSteps[0]!.stepNumber).toBeNull();
    });

    /*
     * Each step runs at most once in a run, so a match before this step is a
     * different occasion and cannot be what this port started.
     */
    test("only counts a step that ran after this one", () => {
      const outcome: StepOutcome = getStepOutcome(
        traceOf(
          aStep({ componentId: "log-1" }),
          aStep({
            componentId: "if-else-1",
            executedPort: "no",
            nextSteps: [{ componentId: "log-1", title: "Log" }],
          }),
        ),
        1,
      );

      expect(outcome.nextSteps[0]!.stepNumber).toBeNull();
    });

    test("says nothing is connected when the recorded list is empty", () => {
      const outcome: StepOutcome = getStepOutcome(
        traceOf(aStep({ executedPort: "no", nextSteps: [] })),
        0,
      );

      expect(outcome.kind).toBe(StepOutcomeKind.NothingConnected);
      expect(outcome.nextSteps).toEqual([]);
    });

    /*
     * A trace from before the wiring was recorded has no list at all. That is
     * "not known", which must not read as "nothing is connected".
     */
    test("claims nothing about wiring that was never recorded", () => {
      const outcome: StepOutcome = getStepOutcome(
        traceOf(aStep({ executedPort: "no" })),
        0,
      );

      expect(outcome.kind).toBe(StepOutcomeKind.PortOnly);
      expect(outcome.portTitle).toBe("No");
    });

    test("calls a next step with no title by its id", () => {
      const outcome: StepOutcome = getStepOutcome(
        traceOf(
          aStep({
            executedPort: "out",
            nextSteps: [{ componentId: "log-1", title: "" }],
          }),
        ),
        0,
      );

      expect(outcome.nextSteps[0]!.title).toBe("log-1");
    });

    test("drops next steps that have no id", () => {
      const outcome: StepOutcome = getStepOutcome(
        traceOf(
          aStep({
            executedPort: "out",
            nextSteps: [
              null as never,
              { componentId: "", title: "Nothing" },
              { componentId: "log-1", title: "Log" },
            ],
          }),
        ),
        0,
      );

      expect(
        outcome.nextSteps.map((next: { componentId: string }) => {
          return next.componentId;
        }),
      ).toEqual(["log-1"]);
    });
  });

  describe("a step that took no port", () => {
    test("says so, whatever else was recorded", () => {
      for (const executedPort of [null, "", "   "]) {
        const outcome: StepOutcome = getStepOutcome(
          traceOf(aStep({ executedPort: executedPort, nextSteps: [] })),
          0,
        );

        expect(outcome.kind).toBe(StepOutcomeKind.NoPort);
        expect(outcome.portTitle).toBeNull();
      }
    });

    test("including a step with no port field at all", () => {
      const step: WorkflowStepTraceEntry = aStep();
      delete (step as Partial<WorkflowStepTraceEntry>).executedPort;

      expect(getStepOutcome(traceOf(step), 0).kind).toBe(
        StepOutcomeKind.NoPort,
      );
    });

    test("and for an index past the end", () => {
      expect(getStepOutcome(traceOf(aStep()), 5).kind).toBe(
        StepOutcomeKind.NoPort,
      );
    });
  });
});

describe("formatTraceValue", () => {
  test("shows text as written", () => {
    expect(formatTraceValue("production")).toEqual({
      kind: TraceValueKind.Text,
      text: "production",
      isBlock: false,
    });
  });

  test("says when the text is empty", () => {
    expect(formatTraceValue("").kind).toBe(TraceValueKind.EmptyText);
  });

  test("puts text with line breaks in a block", () => {
    expect(formatTraceValue("one\ntwo").isBlock).toBe(true);
  });

  test("puts long text in a block, and short text inline", () => {
    expect(formatTraceValue("x".repeat(INLINE_VALUE_MAX_LENGTH)).isBlock).toBe(
      false,
    );
    expect(
      formatTraceValue("x".repeat(INLINE_VALUE_MAX_LENGTH + 1)).isBlock,
    ).toBe(true);
  });

  test("shows numbers and booleans as they are", () => {
    expect(formatTraceValue(503)).toEqual({
      kind: TraceValueKind.Number,
      text: "503",
      isBlock: false,
    });
    expect(formatTraceValue(0).text).toBe("0");
    expect(formatTraceValue(true).text).toBe("true");
    expect(formatTraceValue(false)).toEqual({
      kind: TraceValueKind.Boolean,
      text: "false",
      isBlock: false,
    });
  });

  test("shows null for null and for a missing value", () => {
    expect(formatTraceValue(null).kind).toBe(TraceValueKind.Null);
    expect(formatTraceValue(undefined).kind).toBe(TraceValueKind.Null);
  });

  test("indents anything structured, in a block", () => {
    expect(formatTraceValue({ a: 1, b: [true] })).toEqual({
      kind: TraceValueKind.Structured,
      text: JSON.stringify({ a: 1, b: [true] }, null, 2),
      isBlock: true,
    });
    expect(formatTraceValue([1, 2]).kind).toBe(TraceValueKind.Structured);
  });
});

describe("getReceivedRows", () => {
  const ifElse: WorkflowStepTraceEntry = aStep({
    componentId: "if-else-1",
    argumentValues: {
      // JSONB's order: shortest key first.
      "input-1": "{{local.components.webhook-1.returnValues.body}}",
      "input-2": "production",
      operator: "==",
      "input-1-type": "text",
    },
    argumentNames: [
      { id: "input-1-type", name: "Input 1 Type" },
      { id: "input-1", name: "Input 1" },
      { id: "operator", name: "Operator" },
      { id: "input-2-type", name: "Input 2 Type" },
      { id: "input-2", name: "Input 2" },
    ],
    argumentTemplates: {
      "input-1": "{{local.components.webhook-1.returnValues.body}}",
    },
    warnings: [
      {
        message: "it did not resolve",
        argumentId: "input-1",
        unresolvedReferences: [
          "{{local.components.webhook-1.returnValues.body}}",
        ],
      },
    ],
  });

  test("lists what was received in the settings' order, by name", () => {
    expect(
      getReceivedRows(ifElse).map((row: StepValueRow) => {
        return [row.id, row.name];
      }),
    ).toEqual([
      ["input-1-type", "Input 1 Type"],
      ["input-1", "Input 1"],
      ["operator", "Operator"],
      ["input-2", "Input 2"],
    ]);
  });

  test("leaves out arguments the step was not given", () => {
    expect(
      getReceivedRows(ifElse).find((row: StepValueRow) => {
        return row.id === "input-2-type";
      }),
    ).toBeUndefined();
  });

  test("marks the references that did not resolve on their argument", () => {
    const rows: Array<StepValueRow> = getReceivedRows(ifElse);

    expect(rows[1]!.unresolvedReferences).toEqual([
      "{{local.components.webhook-1.returnValues.body}}",
    ]);
    expect(rows[2]!.unresolvedReferences).toEqual([]);
  });

  /*
   * A reference that resolved to nothing is passed on as written, so the
   * value and the template are the same text. Saying it twice adds nothing.
   */
  test("does not repeat a template that is the value itself", () => {
    expect(getReceivedRows(ifElse)[1]!.template).toBeNull();
  });

  test("shows the template beside a value it resolved to", () => {
    const rows: Array<StepValueRow> = getReceivedRows(
      aStep({
        argumentValues: { message: "Deploy to production" },
        argumentTemplates: { message: "Deploy to {{local.variables.env}}" },
      }),
    );

    expect(rows[0]!.template).toBe("Deploy to {{local.variables.env}}");
    expect(rows[0]!.value.text).toBe("Deploy to production");
  });

  test("shows a structured template indented", () => {
    const rows: Array<StepValueRow> = getReceivedRows(
      aStep({
        argumentValues: { headers: { "X-Env": "production" } },
        argumentTemplates: { headers: { "X-Env": "{{local.variables.env}}" } },
      }),
    );

    expect(rows[0]!.template).toBe(
      JSON.stringify({ "X-Env": "{{local.variables.env}}" }, null, 2),
    );
  });

  test("lists arguments the settings do not name after the ones they do", () => {
    const rows: Array<StepValueRow> = getReceivedRows(
      aStep({
        argumentValues: { "request-body": "{}", url: "https://example.com" },
        argumentNames: [{ id: "url", name: "URL" }],
      }),
    );

    expect(
      rows.map((row: StepValueRow) => {
        return row.name;
      }),
    ).toEqual(["URL", "request-body"]);
  });

  test("uses the ids, in the trace's order, for a trace without names", () => {
    expect(
      getReceivedRows(aStep({ argumentValues: { b: 1, a: 2 } })).map(
        (row: StepValueRow) => {
          return row.name;
        },
      ),
    ).toEqual(["b", "a"]);
  });

  test("reads a step with no recorded arguments as having received nothing", () => {
    const step: WorkflowStepTraceEntry = aStep();
    delete (step as Partial<WorkflowStepTraceEntry>).argumentValues;

    expect(getReceivedRows(step)).toEqual([]);
  });

  test("does not double up a reference named in two warnings", () => {
    const rows: Array<StepValueRow> = getReceivedRows(
      aStep({
        argumentValues: { value: "{{a}}" },
        warnings: [
          {
            message: "one",
            argumentId: "value",
            unresolvedReferences: ["{{a}}"],
          },
          {
            message: "two",
            argumentId: "value",
            unresolvedReferences: ["{{a}}"],
          },
        ],
      }),
    );

    expect(rows[0]!.unresolvedReferences).toEqual(["{{a}}"]);
  });
});

describe("getReturnedRows", () => {
  test("lists what was returned in the settings' order, by name", () => {
    const rows: Array<StepValueRow> = getReturnedRows(
      aStep({
        returnValues: { "response-body": "ok", "response-status": 200 },
        returnValueNames: [
          { id: "response-status", name: "Response Status" },
          { id: "response-body", name: "Response Body" },
        ],
      }),
    );

    expect(
      rows.map((row: StepValueRow) => {
        return [row.name, row.value.text];
      }),
    ).toEqual([
      ["Response Status", "200"],
      ["Response Body", "ok"],
    ]);
  });

  test("never shows a template or a warning on a returned value", () => {
    const rows: Array<StepValueRow> = getReturnedRows(
      aStep({ returnValues: { body: "{{x}}" } }),
    );

    expect(rows[0]!.template).toBeNull();
    expect(rows[0]!.unresolvedReferences).toEqual([]);
  });
});

describe("returnsNothingByDesign", () => {
  test("is true for a component that declares no return values", () => {
    expect(returnsNothingByDesign(aStep({ returnValueNames: [] }))).toBe(true);
  });

  test("is false for one that declares some", () => {
    expect(
      returnsNothingByDesign(
        aStep({ returnValueNames: [{ id: "body", name: "Body" }] }),
      ),
    ).toBe(false);
  });

  test("is false when the trace does not say", () => {
    expect(returnsNothingByDesign(aStep())).toBe(false);
  });
});

describe("getStepWarnings", () => {
  test("keeps warnings that say something", () => {
    expect(
      getStepWarnings(
        aStep({
          warnings: [
            { message: "real" },
            { message: "" },
            null as never,
            { argumentId: "x" } as never,
          ],
        }),
      ),
    ).toEqual([{ message: "real" }]);
  });

  test("reads a missing or odd list as none", () => {
    expect(getStepWarnings(aStep())).toEqual([]);
    expect(getStepWarnings(aStep({ warnings: "nope" as never }))).toEqual([]);
  });
});

describe("isStepFailed", () => {
  test("follows the step's status", () => {
    expect(isStepFailed(aStep())).toBe(false);
    expect(isStepFailed(aStep({ status: WorkflowStepStatus.Error }))).toBe(
      true,
    );
  });
});

describe("getTraceAttention", () => {
  test("is an error when a step failed", () => {
    expect(
      getTraceAttention(
        traceOf(aStep(), aStep({ status: WorkflowStepStatus.Error })),
      ),
    ).toBe(TraceAttention.Error);
  });

  test("is an error when the run stopped for a reason of its own", () => {
    expect(
      getTraceAttention({ steps: [aStep()], runErrorMessage: "timed out" }),
    ).toBe(TraceAttention.Error);
  });

  test("is a warning when nothing failed but a step has a warning", () => {
    expect(
      getTraceAttention(traceOf(aStep({ warnings: [{ message: "hmm" }] }))),
    ).toBe(TraceAttention.Warning);
  });

  test("an error outranks a warning", () => {
    expect(
      getTraceAttention(
        traceOf(
          aStep({ warnings: [{ message: "hmm" }] }),
          aStep({ status: WorkflowStepStatus.Error }),
        ),
      ),
    ).toBe(TraceAttention.Error);
  });

  test("is nothing for a clean run, or no run", () => {
    expect(getTraceAttention(traceOf(aStep()))).toBe(TraceAttention.None);
    expect(getTraceAttention(undefined)).toBe(TraceAttention.None);
  });
});

describe("shouldStepStartOpen", () => {
  test("opens the only step of a run", () => {
    expect(shouldStepStartOpen(traceOf(aStep()), 0)).toBe(true);
  });

  test("keeps a step that worked shut when there are others", () => {
    expect(shouldStepStartOpen(traceOf(aStep(), aStep()), 0)).toBe(false);
  });

  test("opens a failed step", () => {
    expect(
      shouldStepStartOpen(
        traceOf(aStep(), aStep({ status: WorkflowStepStatus.Error })),
        1,
      ),
    ).toBe(true);
  });

  test("opens a step with a warning", () => {
    expect(
      shouldStepStartOpen(
        traceOf(aStep(), aStep({ warnings: [{ message: "hmm" }] })),
        1,
      ),
    ).toBe(true);
  });

  test("does not open a step that is not there", () => {
    expect(shouldStepStartOpen(traceOf(aStep()), 3)).toBe(false);
  });
});

describe("isSingleStepRun", () => {
  test("is true for a test of one step", () => {
    expect(
      isSingleStepRun({ steps: [], singleStepComponentId: "if-else-1" }),
    ).toBe(true);
  });

  test("is false otherwise", () => {
    expect(isSingleStepRun({ steps: [] })).toBe(false);
    expect(isSingleStepRun({ steps: [], singleStepComponentId: "" })).toBe(
      false,
    );
    expect(isSingleStepRun(undefined)).toBe(false);
  });
});

describe("getTraceResumesAt", () => {
  test("is when a sleeping run carries on", () => {
    expect(
      getTraceResumesAt({
        steps: [],
        resumesAt: "2026-10-01T10:45:00.000Z",
      })?.toISOString(),
    ).toBe("2026-10-01T10:45:00.000Z");
  });

  test("is null for a run that is not sleeping", () => {
    expect(getTraceResumesAt({ steps: [] })).toBeNull();
    expect(getTraceResumesAt(undefined)).toBeNull();
  });

  test("is null for a time that is not one", () => {
    expect(
      getTraceResumesAt({ steps: [], resumesAt: "not a date" }),
    ).toBeNull();
    expect(getTraceResumesAt({ steps: [], resumesAt: "" })).toBeNull();
  });
});

describe("isWholeReference", () => {
  test("is true for one reference and nothing else", () => {
    expect(
      isWholeReference(
        "{{local.components.webhook-1.returnValues.request-body.environment}}",
      ),
    ).toBe(true);
    expect(isWholeReference("  {{local.variables.token}}  ")).toBe(true);
  });

  test("is false for text around a reference, or two of them", () => {
    expect(isWholeReference("Bearer {{local.variables.token}}")).toBe(false);
    expect(isWholeReference("{{a}}{{b}}")).toBe(false);
    expect(isWholeReference("{{ spaced }}")).toBe(false);
    expect(isWholeReference("plain")).toBe(false);
  });
});
