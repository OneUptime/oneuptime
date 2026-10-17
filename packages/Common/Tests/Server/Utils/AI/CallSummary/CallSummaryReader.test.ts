import CallSummaryReader, {
  CallSummaryCompletion,
  CallSummaryContent,
} from "../../../../../Server/Utils/AI/CallSummary/CallSummaryReader";
import { LLMMessage } from "../../../../../Server/Utils/LLM/LLMService";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import {
  CallSummaryBasis,
  CallSummaryRootCauseOutcome,
} from "../../../../../Types/VideoCall/CallSummary";
import { TranscriptLine } from "../../../../../Utils/VideoCall/TranscriptText";
import { describe, expect, test } from "@jest/globals";

/*
 * Reading a call with OneUptime AI, end to end through a fake model: the
 * prompt carries the cited transcript, the answer comes back as a cited
 * summary (or "not enough discussion"), a long call is read part by part
 * with its causes weighed together at the end, and a model whose answer
 * cannot be read makes the reading fail rather than invent one.
 */

interface Call {
  purpose: "part" | "combine";
  messages: Array<LLMMessage>;
}

function fakeModel(answers: Array<unknown>): {
  complete: CallSummaryCompletion;
  calls: Array<Call>;
} {
  const calls: Array<Call> = [];
  const queue: Array<unknown> = [...answers];

  return {
    calls,
    complete: async (data: {
      messages: Array<LLMMessage>;
      purpose: "part" | "combine";
    }): Promise<string> => {
      calls.push({ purpose: data.purpose, messages: data.messages });

      let next: unknown = queue.shift();

      // An answer that depends on what the model was asked.
      if (typeof next === "function") {
        next = (next as (messages: Array<LLMMessage>) => unknown)(
          data.messages,
        );
      }

      if (next instanceof Error) {
        throw next;
      }

      if (next === undefined) {
        throw new Error(
          "The fake model was asked more than it was scripted for.",
        );
      }

      return typeof next === "string" ? next : JSON.stringify(next);
    },
  };
}

// The id of the first transcript line a part's prompt gives: "L13".
const FIRST_LINE_ID: RegExp = /\nL(\d+) /;

function firstLineOf(messages: Array<LLMMessage>): string {
  const match: RegExpExecArray | null = FIRST_LINE_ID.exec(
    messages[1]!.content,
  );

  return `L${match ? match[1] : "1"}`;
}

const INCIDENT: { numberDisplay: string; title: string } = {
  numberDisplay: "INC-42",
  title: "Checkout API is down",
};

function line(index: number, speaker: string, text: string): TranscriptLine {
  return { offsetInSeconds: index * 10, speaker, text };
}

const SHORT_CALL: Array<TranscriptLine> = [
  line(0, "Priya Shah", "Checkout is timing out."),
  line(1, "Sam Lee", "The DB pool is at 100%."),
  line(
    2,
    "Priya Shah",
    "The pool maxes at 50 and the deploy went to 100 workers.",
  ),
  line(3, "Sam Lee", "Rolling back fixed it."),
];

// Long enough to need several parts at a small part size.
function longCall(count: number): Array<TranscriptLine> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return line(
      index,
      index % 2 ? "Sam Lee" : "Priya Shah",
      `remark number ${index} `.repeat(6).trim(),
    );
  });
}

describe("CallSummaryReader - one part", () => {
  test("the prompt carries the cited transcript; the answer becomes a cited, suggested cause", async () => {
    const model: ReturnType<typeof fakeModel> = fakeModel([
      {
        rootCause: {
          outcome: "suggested",
          summary: "The deploy doubled the workers and exhausted the DB pool.",
          basis: "stated_on_call",
          lines: ["L3"],
        },
        findings: [
          { text: "The pool was at 100%.", kind: "confirmed", lines: ["L2"] },
        ],
        decisions: [{ text: "Roll back.", lines: ["L4"] }],
      },
    ]);

    const content: CallSummaryContent = await CallSummaryReader.read({
      lines: SHORT_CALL,
      incident: INCIDENT,
      callLabel: "Zoom meeting",
      complete: model.complete,
    });

    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.purpose).toBe("part");
    expect(model.calls[0]!.messages[1]!.content).toContain(
      "L3 [00:00:20] Priya Shah: The pool maxes at 50 and the deploy went to 100 workers.",
    );

    expect(content.rootCause).toEqual({
      outcome: CallSummaryRootCauseOutcome.Suggested,
      summary: "The deploy doubled the workers and exhausted the DB pool.",
      basis: CallSummaryBasis.StatedOnCall,
      citations: [
        {
          line: 3,
          time: "00:00:20",
          speaker: "Priya Shah",
          text: "The pool maxes at 50 and the deploy went to 100 workers.",
        },
      ],
    });
    expect(content.findings[0]!.citations[0]!.line).toBe(2);
    expect(content.decisions[0]!.citations[0]!.text).toBe(
      "Rolling back fixed it.",
    );
    expect(content.linesRead).toBe(4);
    expect(content.partsRead).toBe(1);
  });

  test("a call that did not discuss the cause says so, and still keeps what it did discuss", async () => {
    const model: ReturnType<typeof fakeModel> = fakeModel([
      {
        rootCause: { outcome: "not_enough_discussion", summary: "", lines: [] },
        stepsTried: [{ text: "Restarted the pods.", lines: ["L4"] }],
      },
    ]);

    const content: CallSummaryContent = await CallSummaryReader.read({
      lines: SHORT_CALL,
      incident: INCIDENT,
      callLabel: "Zoom meeting",
      complete: model.complete,
    });

    expect(content.rootCause).toEqual({
      outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
      citations: [],
    });
    expect(content.stepsTried).toHaveLength(1);
  });

  test("an answer that cannot be read fails the reading: no summary is invented", async () => {
    const model: ReturnType<typeof fakeModel> = fakeModel([
      "I could not find JSON.",
    ]);
    let thrown: unknown = null;

    try {
      await CallSummaryReader.read({
        lines: SHORT_CALL,
        incident: INCIDENT,
        callLabel: "Zoom meeting",
        complete: model.complete,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
  });

  test("a transcript with no lines is nothing to read", async () => {
    const model: ReturnType<typeof fakeModel> = fakeModel([]);
    let thrown: unknown = null;

    try {
      await CallSummaryReader.read({
        lines: [],
        incident: INCIDENT,
        callLabel: "Zoom meeting",
        complete: model.complete,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(model.calls).toHaveLength(0);
  });
});

describe("CallSummaryReader - a long call, read in parts", () => {
  const LINES: Array<TranscriptLine> = longCall(60);
  const PART_CHARACTERS: number = 2_000;

  test("each part is read on its own, citing only its own lines; points are put together in order", async () => {
    const model: ReturnType<typeof fakeModel> = fakeModel(
      Array.from({ length: 10 }, (_: unknown, index: number) => {
        return {
          rootCause: { outcome: "not_enough_discussion" },
          stepsTried: [
            // Each part tries to cite line 1 and one of its own.
            {
              text: `Step from part ${index + 1}`,
              lines: ["L1", `L${index * 6 + 2}`],
            },
            { text: "Checked the pool.", lines: [] },
          ],
        };
      }),
    );

    const content: CallSummaryContent = await CallSummaryReader.read({
      lines: LINES,
      incident: INCIDENT,
      callLabel: "Zoom meeting",
      complete: model.complete,
      partCharacters: PART_CHARACTERS,
    });

    const partCalls: Array<Call> = model.calls.filter((call: Call) => {
      return call.purpose === "part";
    });

    expect(partCalls.length).toBeGreaterThan(1);
    expect(content.partsRead).toBe(partCalls.length);
    expect(content.linesRead).toBe(60);
    // No cause in any part: nothing to weigh.
    expect(
      model.calls.some((call: Call) => {
        return call.purpose === "combine";
      }),
    ).toBe(false);
    expect(content.rootCause.outcome).toBe(
      CallSummaryRootCauseOutcome.NotEnoughDiscussion,
    );

    // "Checked the pool." once, the parts' own steps in order.
    expect(
      content.stepsTried.filter((point: { text: string }) => {
        return point.text === "Checked the pool.";
      }),
    ).toHaveLength(1);
    expect(content.stepsTried[0]!.text).toBe("Step from part 1");

    // The first part may cite L1; no other part may.
    expect(
      content.stepsTried[0]!.citations.map((citation: { line: number }) => {
        return citation.line;
      }),
    ).toContain(1);

    for (const point of content.stepsTried.slice(1)) {
      for (const citation of point.citations) {
        expect(citation.line).not.toBe(1);
      }
    }
  });

  test("one part names a cause: it is the call's cause, with no extra request", async () => {
    const model: ReturnType<typeof fakeModel> = fakeModel(
      Array.from({ length: 10 }, (_: unknown, index: number) => {
        return index === 1
          ? (messages: Array<LLMMessage>): unknown => {
              return {
                rootCause: {
                  outcome: "suggested",
                  summary: "The pool.",
                  basis: "inferred",
                  // A line of the part it was given.
                  lines: [firstLineOf(messages)],
                },
              };
            }
          : { rootCause: { outcome: "not_enough_discussion" } };
      }),
    );

    const content: CallSummaryContent = await CallSummaryReader.read({
      lines: LINES,
      incident: INCIDENT,
      callLabel: "Zoom meeting",
      complete: model.complete,
      partCharacters: PART_CHARACTERS,
    });

    expect(content.rootCause.outcome).toBe(
      CallSummaryRootCauseOutcome.Suggested,
    );
    expect(
      model.calls.every((call: Call) => {
        return call.purpose === "part";
      }),
    ).toBe(true);
  });

  /*
   * Several parts pointing at causes: one more request weighs them, given
   * only the candidates and their cited lines.
   */
  test("several parts name causes: the model weighs them, given the candidates and their lines", async () => {
    const partCount: number = 3;
    const lines: Array<TranscriptLine> = longCall(30);
    const firstPartCause: Record<string, unknown> = {
      rootCause: {
        outcome: "suggested",
        summary: "Maybe DNS.",
        basis: "inferred",
        lines: ["L2"],
      },
    };

    // Find how the call splits, then script one answer per part.
    const probe: ReturnType<typeof fakeModel> = fakeModel(
      Array.from({ length: 20 }, () => {
        return { rootCause: { outcome: "not_enough_discussion" } };
      }),
    );
    await CallSummaryReader.read({
      lines,
      incident: INCIDENT,
      callLabel: "Zoom meeting",
      complete: probe.complete,
      partCharacters: 1_500,
    });
    const parts: number = probe.calls.length;
    expect(parts).toBeGreaterThanOrEqual(partCount);

    const lastLine: number = lines.length;
    const answers: Array<unknown> = Array.from(
      { length: parts },
      (_: unknown, index: number) => {
        if (index === 0) {
          return firstPartCause;
        }

        if (index === parts - 1) {
          return {
            rootCause: {
              outcome: "suggested",
              summary: "The deploy exhausted the pool.",
              basis: "stated_on_call",
              lines: [`L${lastLine}`],
            },
          };
        }

        return { rootCause: { outcome: "not_enough_discussion" } };
      },
    );

    answers.push({
      rootCause: {
        outcome: "suggested",
        summary: "The deploy exhausted the pool; DNS was ruled out.",
        basis: "stated_on_call",
        lines: [`L${lastLine}`, "L2", "L5"],
      },
    });

    const model: ReturnType<typeof fakeModel> = fakeModel(answers);
    const content: CallSummaryContent = await CallSummaryReader.read({
      lines,
      incident: INCIDENT,
      callLabel: "Zoom meeting",
      complete: model.complete,
      partCharacters: 1_500,
    });

    const combine: Call | undefined = model.calls.find((call: Call) => {
      return call.purpose === "combine";
    });

    expect(combine).toBeDefined();
    expect(combine!.messages[1]!.content).toContain(
      "Part 1 pointed at (inferred): Maybe DNS.",
    );
    expect(combine!.messages[1]!.content).toContain(
      `Part ${parts} pointed at (stated on the call): The deploy exhausted the pool.`,
    );
    expect(combine!.messages[1]!.content).toContain(`L${lastLine} `);

    expect(content.rootCause.summary).toBe(
      "The deploy exhausted the pool; DNS was ruled out.",
    );
    // L5 was not among the candidates' lines: dropped.
    expect(
      content.rootCause.citations.map((citation: { line: number }) => {
        return citation.line;
      }),
    ).toEqual([lastLine, 2]);
  });

  test("a weighing that cannot be read keeps the latest part's cause", async () => {
    const lines: Array<TranscriptLine> = longCall(30);
    const probe: ReturnType<typeof fakeModel> = fakeModel(
      Array.from({ length: 20 }, () => {
        return { rootCause: { outcome: "not_enough_discussion" } };
      }),
    );
    await CallSummaryReader.read({
      lines,
      incident: INCIDENT,
      callLabel: "Zoom meeting",
      complete: probe.complete,
      partCharacters: 1_500,
    });
    const parts: number = probe.calls.length;

    const answers: Array<unknown> = Array.from(
      { length: parts },
      (_: unknown, index: number) => {
        return {
          rootCause: {
            outcome: "suggested",
            summary: `Cause from part ${index + 1}.`,
            basis: "inferred",
            lines: [`L${lines.length - (parts - 1 - index)}`],
          },
        };
      },
    );
    answers.push("not json");

    const model: ReturnType<typeof fakeModel> = fakeModel(answers);
    const content: CallSummaryContent = await CallSummaryReader.read({
      lines,
      incident: INCIDENT,
      callLabel: "Zoom meeting",
      complete: model.complete,
      partCharacters: 1_500,
    });

    expect(content.rootCause.summary).toBe(`Cause from part ${parts}.`);
  });

  test("a model that fails outright fails the reading", async () => {
    const model: ReturnType<typeof fakeModel> = fakeModel([
      new BadDataException("This project reached its daily AI token limit."),
    ]);
    let thrown: unknown = null;

    try {
      await CallSummaryReader.read({
        lines: SHORT_CALL,
        incident: INCIDENT,
        callLabel: "Zoom meeting",
        complete: model.complete,
      });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).toMatch(/daily AI token limit/);
  });
});

describe("CallSummaryReader.joinPoints", () => {
  test("in order, each text once whatever its case, at most twelve", () => {
    const joined: Array<{ text: string; citations: Array<never> }> =
      CallSummaryReader.joinPoints([
        [
          { text: "A", citations: [] },
          { text: "b", citations: [] },
        ],
        [
          { text: "a", citations: [] },
          { text: "C", citations: [] },
        ],
      ]);

    expect(
      joined.map((point: { text: string }) => {
        return point.text;
      }),
    ).toEqual(["A", "b", "C"]);

    expect(
      CallSummaryReader.joinPoints([
        Array.from({ length: 20 }, (_: unknown, index: number) => {
          return { text: `p${index}`, citations: [] };
        }),
      ]),
    ).toHaveLength(12);
  });
});
