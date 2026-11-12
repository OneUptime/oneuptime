/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import ChatActivityFeed, {
  countActivitySteps,
  describeElapsedTime,
  isFailedToolCallRetried,
  MIN_REPEATED_STEPS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import {
  ActivityFeedRun,
  canRunHaveRunningSteps,
  readActivityFeedRun,
  toActivityFeedRun,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ActivityFeedRun";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import {
  AIRunEventResultSummary,
  AIToolRefusal,
} from "../../../Types/AI/AIChatTypes";
import {
  AIRunAttemptEnd,
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../Types/AI/AIRunAttempt";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";

/*
 * A RUN'S ACTIVITY READS AS A STORY, NOT A WALL (issue #6437).
 *
 * A customer's triage "kept loading forever": every step it had started
 * spun after the run had died, and its list was hundreds of rows long.
 * Now the feed:
 *
 *   - spins a step only while its run runs: a run that is over, or waits
 *     in the queue between attempts, has no step running, and a step its
 *     attempt ended under says it did not finish;
 *   - draws no row for a model call that answered (the steps it chose
 *     follow it), and marks one that failed;
 *   - shows a run tried more than once as attempts, the earlier ones
 *     folded with how they ended ("Attempt 1 of 3 · did not finish");
 *   - shows the latest steps of an attempt, and "Show 40 earlier steps";
 *   - folds the same step done three or more times in a row into one row
 *     that opens ("Searching logs · 12 times");
 *   - says when each step happened, and when the run started, how long it
 *     took and how many steps it took.
 */

interface StepEvent {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  // An ISO time, on the run's day.
  at?: string | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
}

const DAY: string = "2026-11-09";

function at(time: string): string {
  return `${DAY}T${time}.000Z`;
}

function events(steps: Array<StepEvent>): Array<AIRunEvent> {
  return steps.map((step: StepEvent): AIRunEvent => {
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = step.eventType;

    if (step.toolName) {
      event.toolName = step.toolName;
    }

    if (step.at) {
      event.createdAt = new Date(step.at);
    }

    if (step.resultSummary) {
      event.resultSummary = step.resultSummary;
    }

    return event;
  });
}

function search(time?: string, rowCount: number = 3): Array<StepEvent> {
  return [
    {
      eventType: AIRunEventType.ToolCallStarted,
      toolName: "search_logs",
      ...(time ? { at: at(time) } : {}),
    },
    {
      eventType: AIRunEventType.ToolCallCompleted,
      toolName: "search_logs",
      resultSummary: { rowCount },
      ...(time ? { at: at(time) } : {}),
    },
  ];
}

function tool(toolName: string, time?: string): Array<StepEvent> {
  return [
    {
      eventType: AIRunEventType.ToolCallStarted,
      toolName,
      ...(time ? { at: at(time) } : {}),
    },
    {
      eventType: AIRunEventType.ToolCallCompleted,
      toolName,
      resultSummary: { rowCount: 1 },
      ...(time ? { at: at(time) } : {}),
    },
  ];
}

function attemptEnded(
  attemptEnd: AIRunAttemptEnd,
  time?: string,
  eventType: AIRunEventType = AIRunEventType.AttemptEnded,
): StepEvent {
  return {
    eventType,
    resultSummary: { attemptEnd },
    ...(time ? { at: at(time) } : {}),
  };
}

function run(
  status: AIRunStatus,
  values: Partial<ActivityFeedRun> = {},
): ActivityFeedRun {
  return { status, ...values };
}

function spinners(container: HTMLElement): number {
  return container.querySelectorAll(".animate-spin").length;
}

function stepTexts(container: HTMLElement): Array<string> {
  return Array.from(
    container.querySelectorAll("[data-testid='activity-step-text']"),
  ).map((element: Element): string => {
    return (element.textContent || "").trim();
  });
}

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test("these tests read the clock in UTC", () => {
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
});

describe("a step runs only while its run does", () => {
  const OPEN_STEPS: Array<AIRunEvent> = events([
    { eventType: AIRunEventType.RunStarted },
    { eventType: AIRunEventType.ToolCallStarted, toolName: "search_logs" },
    { eventType: AIRunEventType.LlmCallStarted },
  ]);

  test.each([
    AIRunStatus.Error,
    AIRunStatus.Stale,
    AIRunStatus.Cancelled,
    AIRunStatus.Completed,
    AIRunStatus.Queued,
  ])(
    "a step left open under a %s run spins no more, and did not finish",
    (status: AIRunStatus) => {
      const { container } = render(
        <ChatActivityFeed
          events={OPEN_STEPS}
          hideChrome={true}
          run={run(status)}
        />,
      );

      expect(spinners(container)).toBe(0);
      expect(stepTexts(container)).toEqual([
        "Starting investigation",
        "Searching logs · did not finish",
        "Thinking · did not finish",
      ]);
    },
  );

  test.each([AIRunStatus.Running, AIRunStatus.WaitingForApproval])(
    "under a %s run, its open steps still run",
    (status: AIRunStatus) => {
      const { container } = render(
        <ChatActivityFeed
          events={OPEN_STEPS}
          hideChrome={true}
          run={run(status)}
        />,
      );

      expect(spinners(container)).toBe(2);
      expect(screen.getByText("Searching logs…")).toBeVisible();
      expect(screen.getByText("Thinking…")).toBeVisible();
      expect(screen.queryByText(/did not finish/)).toBeNull();
    },
  );

  test("without its run (Ask AI's answers), the events alone say", () => {
    const { container } = render(
      <ChatActivityFeed events={OPEN_STEPS} hideChrome={true} />,
    );

    expect(spinners(container)).toBe(2);
  });

  test("a step stopped this way is drawn quieter, with a mark of its own", () => {
    const { container } = render(
      <ChatActivityFeed
        events={OPEN_STEPS}
        hideChrome={true}
        run={run(AIRunStatus.Error)}
      />,
    );

    const marks: Array<Element> = Array.from(
      container.querySelectorAll("[data-testid='activity-step-mark'] svg"),
    );
    expect(marks).toHaveLength(3);
    // Starting investigation is done; the two open steps stopped.
    expect(marks[0]!.getAttribute("class")).toContain("text-emerald-500");
    expect(marks[1]!.getAttribute("class")).toContain("text-gray-400");
    expect(marks[2]!.getAttribute("class")).toContain("text-gray-400");
    expect(screen.getByText("Thinking").className).toContain("text-gray-400");
  });

  test.each([
    [undefined, true],
    [{}, true],
    [{ status: AIRunStatus.Running }, true],
    [{ status: AIRunStatus.WaitingForApproval }, true],
    [{ status: AIRunStatus.Queued }, false],
    [{ status: AIRunStatus.Completed }, false],
    [{ status: AIRunStatus.Error }, false],
    [{ status: AIRunStatus.Stale }, false],
    [{ status: AIRunStatus.Cancelled }, false],
  ])(
    "canRunHaveRunningSteps(%j) is %s",
    (value: ActivityFeedRun | undefined, expected: boolean) => {
      expect(canRunHaveRunningSteps(value)).toBe(expected);
    },
  );

  test("every status is decided", () => {
    for (const status of Object.values(AIRunStatus)) {
      expect(typeof canRunHaveRunningSteps({ status })).toBe("boolean");
    }
  });
});

describe("a run's status and times, as the feed reads them", () => {
  test("from the run the API sends, its times as times", () => {
    const aiRun: AIRun = new AIRun();
    aiRun.status = AIRunStatus.Queued;
    aiRun.createdAt = new Date(at("14:00:00"));
    aiRun.startedAt = new Date(at("14:00:02"));
    aiRun.retryAt = new Date(at("14:05:00"));

    // As the API sends it: serialized, and through JSON.
    const read: ActivityFeedRun = readActivityFeedRun(
      JSON.parse(JSON.stringify(AIRun.toJSONArray([aiRun], AIRun)[0])),
    );

    expect(read.status).toBe(AIRunStatus.Queued);
    expect(new Date(read.createdAt!).toISOString()).toBe(at("14:00:00"));
    expect(new Date(read.startedAt!).toISOString()).toBe(at("14:00:02"));
    expect(new Date(read.retryAt!).toISOString()).toBe(at("14:05:00"));
    expect(read.completedAt).toBeUndefined();
  });

  test("from a run model, the same five values and nothing else", () => {
    const aiRun: AIRun = new AIRun();
    aiRun.status = AIRunStatus.Completed;
    aiRun.completedAt = new Date(at("14:06:00"));
    aiRun.errorMessage = "not read";

    expect(Object.keys(toActivityFeedRun(aiRun)).sort()).toEqual([
      "completedAt",
      "createdAt",
      "retryAt",
      "startedAt",
      "status",
    ]);
    expect(toActivityFeedRun(aiRun).status).toBe(AIRunStatus.Completed);
  });
});

describe("model calls", () => {
  test("one that answered draws no row: the steps it chose follow it", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          { eventType: AIRunEventType.LlmCallStarted },
          { eventType: AIRunEventType.LlmCallCompleted },
          ...search(),
          { eventType: AIRunEventType.LlmCallStarted },
          { eventType: AIRunEventType.LlmCallCompleted },
          ...tool("query_traces"),
          { eventType: AIRunEventType.LlmCallStarted },
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    // Only the call thinking now is a step.
    expect(stepTexts(container)).toEqual([
      "Starting investigation",
      "Searching logs · 3 rows",
      "Analyzing traces · 1 row",
      "Thinking…",
    ]);
  });

  test("one that failed for good says so, and stops thinking", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          { eventType: AIRunEventType.LlmCallStarted },
          {
            eventType: AIRunEventType.LlmCallFailed,
            resultSummary: { errorMessage: "provider 500" },
          },
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    expect(spinners(container)).toBe(0);
    expect(stepTexts(container)).toEqual([
      "Starting investigation",
      "Thinking · failed",
    ]);
    // The provider's own error is the failure notice's, not the step's.
    expect(container.textContent).not.toContain("provider 500");
  });

  test("a failed call is counted as a step, an answered one is not", () => {
    expect(
      countActivitySteps(
        events([
          { eventType: AIRunEventType.LlmCallStarted },
          { eventType: AIRunEventType.LlmCallCompleted },
          { eventType: AIRunEventType.LlmCallStarted },
          { eventType: AIRunEventType.LlmCallFailed },
        ]),
      ),
    ).toBe(1);
  });
});

/*
 * A run whose first attempt timed out at the AI provider, and whose second
 * runs now: three attempts are allowed for a provider's failure.
 */
const RETRIED_RUN: Array<AIRunEvent> = events([
  { eventType: AIRunEventType.RunStarted, at: at("14:00:00") },
  ...search("14:00:05"),
  { eventType: AIRunEventType.LlmCallStarted, at: at("14:00:06") },
  attemptEnded(
    {
      outcome: AIRunAttemptOutcome.WillRetry,
      failureKind: AIRunFailureKind.ProviderTimeout,
      attempt: 1,
      maxAttempts: 3,
      timeoutInSeconds: 120,
      nextAttemptAt: at("14:05:00"),
    },
    "14:02:06",
  ),
  { eventType: AIRunEventType.RunStarted, at: at("14:05:02") },
  ...tool("query_traces", "14:05:09"),
  { eventType: AIRunEventType.LlmCallStarted, at: at("14:05:10") },
]);

describe("a run tried more than once reads as its attempts", () => {
  test("the earlier attempt is one folded row: its number, how it ended, its steps", () => {
    render(
      <ChatActivityFeed
        events={RETRIED_RUN}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    const toggle: HTMLElement = screen.getByTestId("activity-attempt-toggle");
    expect(toggle).toHaveTextContent(
      "Attempt 1 of 3 · did not finish · 3 steps",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Its steps are not drawn until it is opened.
    expect(screen.queryByText("Searching logs")).toBeNull();
    expect(screen.queryByTestId("activity-attempt-end")).toBeNull();

    // The attempt running now is titled, and its steps show.
    expect(screen.getByTestId("activity-attempt-title")).toHaveTextContent(
      "Attempt 2 of 3",
    );
    expect(screen.getByText("Analyzing traces")).toBeVisible();
    expect(screen.getByText("Thinking…")).toBeVisible();
  });

  test("a narrow card breaks its row between how it ended and its steps, never inside either", () => {
    render(
      <ChatActivityFeed
        events={RETRIED_RUN}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    const parts: Array<Element> = Array.from(
      screen
        .getByTestId("activity-attempt-toggle")
        .querySelectorAll(".inline-block.max-w-full"),
    );
    expect(
      parts.map((part: Element): string => {
        return part.textContent || "";
      }),
    ).toEqual(["· did not finish", "· 3 steps"]);
  });

  test("opened, it shows what it did, what was left open, and how it ended", () => {
    const { container } = render(
      <ChatActivityFeed
        events={RETRIED_RUN}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    const toggle: HTMLElement = screen.getByTestId("activity-attempt-toggle");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list: HTMLElement = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    expect(list).toBeVisible();
    expect(stepTexts(list)).toEqual([
      "Starting investigation",
      "Searching logs · 3 rows",
      // Open when the attempt ended: it stopped with it, though the run runs on.
      "Thinking · did not finish",
      "Did not finish: The LLM provider did not answer within 120 seconds. Trying again at 14:05.",
    ]);
    // The one spinner is the second attempt's.
    expect(spinners(container)).toBe(1);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(list).queryByText("Searching logs")).toBeNull();
  });

  test.each([
    [AIRunAttemptOutcome.HandedBack, "paused when its server stopped"],
    [AIRunAttemptOutcome.Stalled, "stopped answering"],
    [AIRunAttemptOutcome.WillRetry, "did not finish"],
    [AIRunAttemptOutcome.GaveUp, "did not finish"],
  ])(
    "an attempt that ended %s says it %s",
    (outcome: AIRunAttemptOutcome, words: string) => {
      render(
        <ChatActivityFeed
          events={events([
            { eventType: AIRunEventType.RunStarted },
            attemptEnded({
              outcome,
              failureKind: AIRunFailureKind.ServerStopped,
              attempt: 1,
              maxAttempts: 2,
            }),
            { eventType: AIRunEventType.RunStarted },
          ])}
          hideChrome={true}
          run={run(AIRunStatus.Running)}
        />,
      );

      expect(screen.getByTestId("activity-attempt-toggle")).toHaveTextContent(
        `Attempt 1 of 2 · ${words} · 1 step`,
      );
    },
  );

  test("an older run's attempts, whose ends do not say how many it gets, have no 'of'", () => {
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          ...search(),
          { eventType: AIRunEventType.RunStarted },
          ...search(),
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    expect(screen.getByTestId("activity-attempt-toggle")).toHaveTextContent(
      /^Attempt 1 · did not finish · 2 steps$/,
    );
    expect(screen.getByTestId("activity-attempt-title")).toHaveTextContent(
      /^Attempt 2$/,
    );
  });

  test("an attempt numbered past what the run gets has no 'of' either", () => {
    // A hand-back does not count: the run can make more attempts than it gets.
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          attemptEnded({
            outcome: AIRunAttemptOutcome.HandedBack,
            failureKind: AIRunFailureKind.ServerStopped,
            maxAttempts: 1,
          }),
          { eventType: AIRunEventType.RunStarted },
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    expect(screen.getByTestId("activity-attempt-toggle")).toHaveTextContent(
      /^Attempt 1 · /,
    );
    expect(screen.getByTestId("activity-attempt-title")).toHaveTextContent(
      /^Attempt 2$/,
    );
  });

  test("a run tried once has no attempt rows at all", () => {
    render(
      <ChatActivityFeed
        events={events([{ eventType: AIRunEventType.RunStarted }, ...search()])}
        hideChrome={true}
        run={run(AIRunStatus.Completed)}
      />,
    );

    expect(screen.queryByTestId("activity-attempt")).toBeNull();
    expect(screen.queryByTestId("activity-attempt-title")).toBeNull();
  });

  test("the run's last attempt ends with a line saying it stopped, in red", () => {
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          { eventType: AIRunEventType.LlmCallStarted },
          attemptEnded(
            {
              outcome: AIRunAttemptOutcome.GaveUp,
              failureKind: AIRunFailureKind.ProviderRejected,
              attempt: 1,
              maxAttempts: 1,
            },
            undefined,
            AIRunEventType.RunFailed,
          ),
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Error)}
      />,
    );

    const end: HTMLElement = screen.getByTestId("activity-attempt-end");
    expect(end).toHaveTextContent(
      "Stopped: The LLM provider refused the request: its API key or model may be wrong, or its account may lack access or credit.",
    );
    expect(end.className).toContain("text-red-600");
    expect(screen.getByText("Thinking")).toBeVisible();
    expect(screen.getByText("· did not finish")).toBeVisible();
  });

  test("an attempt end the dashboard cannot read draws no line, and still settles the attempt", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          { eventType: AIRunEventType.LlmCallStarted },
          {
            eventType: AIRunEventType.AttemptEnded,
            resultSummary: {
              attemptEnd: { outcome: "Exploded" } as unknown as AIRunAttemptEnd,
            },
          },
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    expect(screen.queryByTestId("activity-attempt-end")).toBeNull();
    expect(spinners(container)).toBe(0);
    expect(stepTexts(container)).toEqual([
      "Starting investigation",
      "Thinking · did not finish",
    ]);
  });
});

/*
 * A read that failed says the model tries it another way ("did not
 * succeed - retrying differently"): a promise its attempt keeps by going
 * on. The customer's triage ended on such a step, and its activity went on
 * promising a retry that never came. The last step of an attempt that
 * ended - or of a run that is over - says it failed, as a model call that
 * failed does; the run's own end line says why it stopped.
 */
describe("a failed read promises another way only while its attempt can keep it", () => {
  const RETRYING: string = "did not succeed — retrying differently";

  function failedCall(
    toolName: string = "query_traces",
    resultSummary: AIRunEventResultSummary = { errorMessage: "bad window" },
  ): Array<StepEvent> {
    return [
      { eventType: AIRunEventType.ToolCallStarted, toolName },
      { eventType: AIRunEventType.ToolCallFailed, toolName, resultSummary },
    ];
  }

  function endedAttempt(attempt: number): StepEvent {
    return attemptEnded({
      outcome: AIRunAttemptOutcome.WillRetry,
      failureKind: AIRunFailureKind.ProviderTimeout,
      attempt,
      maxAttempts: 3,
      timeoutInSeconds: 120,
    });
  }

  test("while its run runs, the latest one still promises it", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          ...failedCall(),
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    expect(stepTexts(container)).toEqual([
      "Starting investigation",
      `Analyzing traces · ${RETRYING}`,
    ]);
  });

  test.each([
    AIRunStatus.Error,
    AIRunStatus.Cancelled,
    AIRunStatus.Stale,
    AIRunStatus.Completed,
  ])(
    "a %s run's last step was never followed by another way: it failed",
    (status: AIRunStatus) => {
      const { container } = render(
        <ChatActivityFeed
          events={events([
            { eventType: AIRunEventType.RunStarted },
            ...search(),
            ...failedCall(),
          ])}
          hideChrome={true}
          run={run(status)}
        />,
      );

      expect(stepTexts(container)).toEqual([
        "Starting investigation",
        "Searching logs · 3 rows",
        "Analyzing traces · failed",
      ]);
      expect(container.textContent).not.toContain(RETRYING);
    },
  );

  test("one the model went on from kept its promise, also once the run is over", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          ...failedCall(),
          ...search(),
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Error)}
      />,
    );

    expect(stepTexts(container)).toEqual([
      "Starting investigation",
      `Analyzing traces · ${RETRYING}`,
      "Searching logs · 3 rows",
    ]);
  });

  test("an executor's line after it is not the model going on", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          ...failedCall(),
          {
            eventType: AIRunEventType.ProgressLog,
            resultSummary: { message: "Uploading the report" },
          },
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Error)}
      />,
    );

    expect(stepTexts(container)).toContain("Analyzing traces · failed");
  });

  test("an attempt that ended on one failed, though the run tries again", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          ...failedCall(),
          endedAttempt(1),
          { eventType: AIRunEventType.RunStarted },
          ...failedCall("search_logs"),
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    // The attempt running now may still try another way.
    expect(stepTexts(container)).toEqual([
      "Starting investigation",
      `Searching logs · ${RETRYING}`,
    ]);

    const toggle: HTMLElement = screen.getByTestId("activity-attempt-toggle");
    fireEvent.click(toggle);

    expect(
      stepTexts(
        document.getElementById(toggle.getAttribute("aria-controls")!)!,
      ),
    ).toEqual([
      "Starting investigation",
      "Analyzing traces · failed",
      "Did not finish: The LLM provider did not answer within 120 seconds. Trying again.",
    ]);
  });

  test("an earlier attempt without an end line is over once a later one started", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          ...failedCall(),
          { eventType: AIRunEventType.RunStarted },
          ...search(),
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    fireEvent.click(screen.getByTestId("activity-attempt-toggle"));

    expect(stepTexts(container)).toContain("Analyzing traces · failed");
    expect(container.textContent).not.toContain(RETRYING);
  });

  test("a run waiting between attempts: the attempt that ended on one failed", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          ...failedCall(),
          endedAttempt(1),
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Queued, {
          retryAt: new Date(Date.now() + 60 * 1000),
        })}
      />,
    );

    expect(stepTexts(container)).toContain("Analyzing traces · failed");
  });

  test("an action, a refused call and a cluster command still say what became of them", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          ...failedCall("create_incident", {
            isAction: true,
            errorMessage: "could not save",
          }),
          ...failedCall("query_slos", { refusal: AIToolRefusal.Plan }),
          ...failedCall("run_kubectl", { errorMessage: "forbidden" }),
        ])}
        hideChrome={true}
        run={run(AIRunStatus.Error)}
      />,
    );

    const texts: Array<string> = stepTexts(container);
    expect(texts[1]).toMatch(/· not done$/);
    expect(texts[2]).not.toMatch(/· (failed|did not succeed)/);
    expect(texts[3]).toMatch(/· did not run on the cluster$/);
    expect(container.textContent).not.toContain(RETRYING);
  });

  test("which failed calls promise another way at all", () => {
    function failed(
      toolName: string,
      resultSummary: AIRunEventResultSummary = {},
    ): AIRunEvent {
      return events([
        { eventType: AIRunEventType.ToolCallFailed, toolName, resultSummary },
      ])[0]!;
    }

    expect(isFailedToolCallRetried(failed("query_traces"))).toBe(true);
    expect(
      isFailedToolCallRetried(
        failed("query_traces", { refusal: AIToolRefusal.Permission }),
      ),
    ).toBe(false);
    expect(
      isFailedToolCallRetried(failed("create_incident", { isAction: true })),
    ).toBe(false);
    expect(isFailedToolCallRetried(failed("run_kubectl"))).toBe(false);
    expect(isFailedToolCallRetried(failed("run_infrastructure_command"))).toBe(
      false,
    );
  });
});

describe("a long attempt shows its latest steps, and the rest on request", () => {
  const TOOLS: Array<string> = [
    "search_logs",
    "query_traces",
    "query_metrics",
    "list_services",
    "query_exceptions",
    "get_service_dependencies",
  ];

  function longRun(): Array<AIRunEvent> {
    return events([
      { eventType: AIRunEventType.RunStarted },
      ...TOOLS.flatMap((toolName: string): Array<StepEvent> => {
        return tool(toolName);
      }),
    ]);
  }

  test("the earlier ones fold behind one button that says how many", () => {
    const { container } = render(
      <ChatActivityFeed
        events={longRun()}
        hideChrome={true}
        maxVisibleSteps={3}
      />,
    );

    expect(stepTexts(container)).toHaveLength(3);
    const showEarlier: HTMLElement = screen.getByRole("button", {
      name: "Show 4 earlier steps",
    });
    expect(showEarlier).toHaveAttribute("data-testid", "activity-show-earlier");
    // In the steps' details' size and gray, not a smaller, paler 11px.
    expect(showEarlier).toHaveClass("text-xs", "text-gray-500");
    expect(showEarlier.className).not.toContain("text-[11px]");
    expect(screen.queryByText("Starting investigation")).toBeNull();

    fireEvent.click(showEarlier);

    expect(stepTexts(container)).toHaveLength(7);
    expect(screen.getByText("Starting investigation")).toBeVisible();
    expect(screen.queryByTestId("activity-show-earlier")).toBeNull();
  });

  test("seven steps show by default", () => {
    const { container } = render(
      <ChatActivityFeed events={longRun()} hideChrome={true} />,
    );

    expect(stepTexts(container)).toHaveLength(7);
    expect(screen.queryByTestId("activity-show-earlier")).toBeNull();
  });

  test("the count is of steps, the folded repeats' steps among them", () => {
    render(
      <ChatActivityFeed
        events={events([
          ...search(),
          ...search(),
          ...search(),
          ...search(),
          ...tool("query_traces"),
          ...tool("query_metrics"),
        ])}
        hideChrome={true}
        maxVisibleSteps={2}
      />,
    );

    // Four searches (one row) are behind the button: four steps.
    expect(
      screen.getByRole("button", { name: "Show 4 earlier steps" }),
    ).toBeVisible();
  });

  test("one earlier step is said as one", () => {
    render(
      <ChatActivityFeed
        events={events([...tool("query_traces"), ...tool("query_metrics")])}
        hideChrome={true}
        maxVisibleSteps={1}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show 1 earlier step" }),
    ).toBeVisible();
  });
});

describe("the same step done again and again is one row", () => {
  test("twelve searches in a row: one row, how many times, and a toggle", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events(
          Array.from({ length: 12 }, (): Array<StepEvent> => {
            return search();
          }).flat(),
        )}
        hideChrome={true}
      />,
    );

    const repeats: Array<HTMLElement> = screen.getAllByTestId(
      "activity-step-repeat",
    );
    expect(repeats).toHaveLength(1);
    const toggle: HTMLElement = screen.getByTestId(
      "activity-step-repeat-toggle",
    );
    expect(toggle).toHaveTextContent("· 12 times");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // One row: its words without a single search's detail.
    expect(stepTexts(container)).toEqual(["Searching logs · 12 times"]);

    const list: HTMLElement = screen.getByTestId("activity-step-repeat-list");
    expect(toggle).toHaveAttribute("aria-controls", list.id);
    expect(list).not.toBeVisible();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(list).toBeVisible();
    expect(stepTexts(list)).toEqual(
      Array.from({ length: 12 }, (): string => {
        return "Searching logs · 3 rows";
      }),
    );
  });

  test(`${MIN_REPEATED_STEPS} in a row fold; fewer do not`, () => {
    expect(MIN_REPEATED_STEPS).toBe(3);

    const { container } = render(
      <ChatActivityFeed
        events={events([...search(), ...search()])}
        hideChrome={true}
      />,
    );

    expect(screen.queryByTestId("activity-step-repeat")).toBeNull();
    expect(stepTexts(container)).toHaveLength(2);
  });

  test("another step between them starts a new row", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          ...search(),
          ...search(),
          ...search(),
          ...tool("query_traces"),
          ...search(),
          ...search(),
          ...search(),
        ])}
        hideChrome={true}
      />,
    );

    expect(screen.getAllByTestId("activity-step-repeat")).toHaveLength(2);
    expect(stepTexts(container)).toEqual([
      "Searching logs · 3 times",
      "Analyzing traces · 1 row",
      "Searching logs · 3 times",
    ]);
  });

  test("a step that failed does not fold with ones that did not", () => {
    const failedSearch: Array<StepEvent> = [
      { eventType: AIRunEventType.ToolCallStarted, toolName: "search_logs" },
      { eventType: AIRunEventType.ToolCallFailed, toolName: "search_logs" },
    ];

    render(
      <ChatActivityFeed
        events={events([
          ...search(),
          ...search(),
          ...failedSearch,
          ...failedSearch,
          ...failedSearch,
        ])}
        hideChrome={true}
      />,
    );

    // The three failures fold; the two that worked stand on their own.
    expect(screen.getAllByTestId("activity-step-repeat")).toHaveLength(1);
    expect(screen.getByTestId("activity-step-repeat-toggle")).toHaveTextContent(
      "· 3 times",
    );
    expect(screen.getAllByText("· 3 rows")).toHaveLength(2);
  });

  test("steps still running, actions and logs never fold", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          ...Array.from({ length: 3 }, (): StepEvent => {
            return {
              eventType: AIRunEventType.ActionExecuted,
              resultSummary: { message: "Declared an incident" },
            };
          }),
          ...Array.from({ length: 3 }, (): StepEvent => {
            return {
              eventType: AIRunEventType.ProgressLog,
              resultSummary: { message: "Cloning repository" },
            };
          }),
          ...Array.from({ length: 3 }, (): StepEvent => {
            return {
              eventType: AIRunEventType.ToolCallStarted,
              toolName: "search_logs",
            };
          }),
        ])}
        hideChrome={true}
        maxVisibleSteps={20}
      />,
    );

    expect(screen.queryByTestId("activity-step-repeat")).toBeNull();
    expect(stepTexts(container)).toHaveLength(9);
  });
});

describe("each step says when it happened", () => {
  test("its time of day, its full date and time on hover", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted, at: at("14:00:00") },
          ...search("14:00:05"),
        ])}
        hideChrome={true}
        showStepTimes={true}
      />,
    );

    const times: Array<HTMLTimeElement> = Array.from(
      container.querySelectorAll("[data-testid='activity-step-time']"),
    ) as Array<HTMLTimeElement>;

    expect(
      times.map((time: HTMLTimeElement): string => {
        return time.textContent || "";
      }),
    ).toEqual(["14:00:00", "14:00:05"]);
    expect(times[1]!.tagName).toBe("TIME");
    expect(times[1]!).toHaveAttribute("dateTime", at("14:00:05"));
    expect(times[1]!).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalShortDateTimeString(
        new Date(at("14:00:05")),
        { includeSeconds: true },
      ),
    );
    expect(times[1]!.getAttribute("title")).toContain("14:00:05");
  });

  test("on the reader's twelve-hour clock, when they keep one", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    render(
      <ChatActivityFeed
        events={events(search("14:00:05"))}
        hideChrome={true}
        showStepTimes={true}
      />,
    );

    expect(screen.getByTestId("activity-step-time")).toHaveTextContent(
      /^2:00:05 PM$/,
    );
  });

  test("not unless the host asks, and not for a step without a time", () => {
    const { container, rerender } = render(
      <ChatActivityFeed
        events={events(search("14:00:05"))}
        hideChrome={true}
      />,
    );

    expect(container.querySelector("time")).toBeNull();

    rerender(
      <ChatActivityFeed
        events={events(search())}
        hideChrome={true}
        showStepTimes={true}
      />,
    );

    expect(container.querySelector("time")).toBeNull();
  });

  test("an earlier attempt's row says when it started", () => {
    render(
      <ChatActivityFeed
        events={RETRIED_RUN}
        hideChrome={true}
        showStepTimes={true}
        run={run(AIRunStatus.Running)}
      />,
    );

    const toggle: HTMLElement = screen.getByTestId("activity-attempt-toggle");
    expect(within(toggle).getByText("14:00:00").tagName).toBe("TIME");
  });
});

describe("the run's summary: when it started, how long it took, how many steps", () => {
  const NOW: Date = new Date(at("14:09:00"));

  beforeEach(() => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  });

  function summary(): HTMLElement {
    return screen.getByTestId("activity-run-summary");
  }

  test("a finished run: started, took, steps", () => {
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted, at: at("14:00:00") },
          ...search("14:00:05"),
          { eventType: AIRunEventType.RunCompleted, at: at("14:06:00") },
        ])}
        hideChrome={true}
        showStepTimes={true}
        run={run(AIRunStatus.Completed, {
          startedAt: new Date(at("14:00:00")),
          completedAt: new Date(at("14:06:00")),
        })}
      />,
    );

    expect(summary()).toHaveTextContent(
      /^Started 14:00 · took 6 minutes · 2 steps$/,
    );
    expect(summary().querySelector("time")).toHaveAttribute(
      "dateTime",
      at("14:00:00"),
    );
  });

  /*
   * It was 11px and gray-400 - smaller and paler than the steps it heads,
   * under 4.5:1 - and a narrow card broke it inside "took 6 minutes".
   */
  test("in the steps' own size, each part's words kept together", () => {
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted, at: at("14:00:00") },
          ...search("14:00:05"),
          { eventType: AIRunEventType.RunCompleted, at: at("14:06:00") },
        ])}
        hideChrome={true}
        showStepTimes={true}
        run={run(AIRunStatus.Completed, {
          startedAt: new Date(at("14:00:00")),
          completedAt: new Date(at("14:06:00")),
        })}
      />,
    );

    expect(summary()).toHaveClass("text-xs", "text-gray-500");
    expect(summary().className).not.toMatch(/text-\[11px\]|text-gray-400/);

    const parts: Array<Element> = Array.from(summary().children);
    expect(
      parts.map((part: Element): string => {
        return part.textContent || "";
      }),
    ).toEqual(["Started 14:00", "· took 6 minutes", "· 2 steps"]);
    for (const part of parts) {
      // Whole on a line, and still wrapping inside itself when wider.
      expect(part).toHaveClass("inline-block", "max-w-full");
    }
    // The parts are apart by spaces the line can break at.
    expect(summary().textContent).toBe(
      "Started 14:00 · took 6 minutes · 2 steps",
    );
  });

  test("a run running now: for how long so far", () => {
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted, at: at("14:06:00") },
          ...search("14:06:05"),
        ])}
        hideChrome={true}
        showStepTimes={true}
        run={run(AIRunStatus.Running, {
          startedAt: new Date(at("14:06:00")),
        })}
      />,
    );

    expect(summary()).toHaveTextContent(
      /^Started 14:06 · running for 3 minutes · 2 steps$/,
    );
  });

  test("a run waiting between attempts: when it started, and its steps", () => {
    render(
      <ChatActivityFeed
        events={RETRIED_RUN.slice(0, 5)}
        hideChrome={true}
        showStepTimes={true}
        run={run(AIRunStatus.Queued, {
          startedAt: new Date(at("14:00:00")),
          retryAt: new Date(at("14:05:00")),
        })}
      />,
    );

    // Three steps: the line saying how the attempt ended is not one.
    expect(summary()).toHaveTextContent(/^Started 14:00 · 3 steps$/);
  });

  test("a run of another day says its date", () => {
    const startedAt: Date = new Date("2026-11-02T09:30:00.000Z");

    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted, at: startedAt.toISOString() },
        ])}
        hideChrome={true}
        showStepTimes={true}
        run={run(AIRunStatus.Completed, {
          startedAt,
          completedAt: new Date("2026-11-02T09:31:00.000Z"),
        })}
      />,
    );

    expect(summary()).toHaveTextContent(
      `Started ${OneUptimeDate.getDateAsLocalShortDateTimeString(startedAt)} · took 1 minute · 1 step`,
    );
  });

  test("without a start, its first step's time, else when it was queued", () => {
    const { rerender } = render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted, at: at("14:01:00") },
        ])}
        hideChrome={true}
        showStepTimes={true}
        run={run(AIRunStatus.Completed, {
          createdAt: new Date(at("14:00:00")),
        })}
      />,
    );

    expect(summary()).toHaveTextContent(/^Started 14:01 · 1 step$/);

    rerender(
      <ChatActivityFeed
        events={events([{ eventType: AIRunEventType.RunStarted }])}
        hideChrome={true}
        showStepTimes={true}
        run={run(AIRunStatus.Completed, {
          createdAt: new Date(at("14:00:00")),
        })}
      />,
    );

    expect(summary()).toHaveTextContent(/^Started 14:00 · 1 step$/);
  });

  test("times the server sent as text are read too", () => {
    render(
      <ChatActivityFeed
        events={events([{ eventType: AIRunEventType.RunStarted }])}
        hideChrome={true}
        showStepTimes={true}
        run={
          run(AIRunStatus.Completed, {
            startedAt: at("14:00:00") as unknown as Date,
            completedAt: at("14:00:40") as unknown as Date,
          }) as ActivityFeedRun
        }
      />,
    );

    expect(summary()).toHaveTextContent(
      /^Started 14:00 · took 40 seconds · 1 step$/,
    );
  });

  test("not without the run, nor unless times are asked for", () => {
    const trail: Array<AIRunEvent> = events([
      { eventType: AIRunEventType.RunStarted, at: at("14:00:00") },
    ]);
    const { rerender } = render(
      <ChatActivityFeed
        events={trail}
        hideChrome={true}
        showStepTimes={true}
      />,
    );

    expect(screen.queryByTestId("activity-run-summary")).toBeNull();

    rerender(
      <ChatActivityFeed
        events={trail}
        hideChrome={true}
        run={run(AIRunStatus.Completed, {
          startedAt: new Date(at("14:00:00")),
        })}
      />,
    );

    expect(screen.queryByTestId("activity-run-summary")).toBeNull();
  });
});

describe("describeElapsedTime", () => {
  test.each([
    [0, "0 seconds"],
    [-5000, "0 seconds"],
    [1000, "1 second"],
    [1400, "1 second"],
    [59_000, "59 seconds"],
    [60_000, "1 minute"],
    [89_000, "1 minute"],
    [90_000, "2 minutes"],
    [6 * 60_000, "6 minutes"],
    [59 * 60_000, "59 minutes"],
    [60 * 60_000, "1 hour"],
    [150 * 60_000, "3 hours"],
  ])("%d ms is %s", (milliseconds: number, words: string) => {
    expect(describeElapsedTime(milliseconds, getGlobalTranslator())).toBe(
      words,
    );
  });
});
