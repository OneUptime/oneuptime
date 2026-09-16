import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ChatActivityFeed, {
  countActivitySteps,
  hasRenderableActivity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import ObjectID from "../../../Types/ObjectID";

/*
 * ChatActivityFeed is shared: the AI chat panel and copilot render it with its
 * own assistant bubble, while the investigation panel frames it itself and
 * asks for the steps alone (hideChrome). Both shapes need pinning here —
 * without the default-props test, inverting the hideChrome guard would strip
 * the chat panel's chrome with every other suite still green.
 */

interface StepEvent {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  resultSummary?:
    | {
        rowCount?: number | undefined;
        durationInMs?: number | undefined;
        message?: string | undefined;
      }
    | undefined;
}

function events(steps: Array<StepEvent>): Array<AIRunEvent> {
  return steps.map((step: StepEvent): AIRunEvent => {
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = step.eventType;

    if (step.toolName) {
      event.toolName = step.toolName;
    }

    if (step.resultSummary) {
      event.resultSummary = step.resultSummary;
    }

    return event;
  });
}

const SEARCH_LOGS_RUN: Array<AIRunEvent> = events([
  { eventType: AIRunEventType.RunStarted },
  { eventType: AIRunEventType.ToolCallStarted, toolName: "search_logs" },
  {
    eventType: AIRunEventType.ToolCallCompleted,
    toolName: "search_logs",
    resultSummary: { rowCount: 3, durationInMs: 1500 },
  },
]);

/*
 * Twelve events that draw six steps: the completion halves close steps an
 * earlier event opened, a progress log without a message and an approval
 * request draw nothing, and RunCompleted only ends the run.
 */
const MIXED_RUN: Array<AIRunEvent> = events([
  { eventType: AIRunEventType.RunStarted },
  { eventType: AIRunEventType.LlmCallStarted },
  { eventType: AIRunEventType.LlmCallCompleted },
  { eventType: AIRunEventType.ToolCallStarted, toolName: "query_traces" },
  { eventType: AIRunEventType.ToolCallFailed, toolName: "query_traces" },
  { eventType: AIRunEventType.ToolCallStarted, toolName: "search_logs" },
  {
    eventType: AIRunEventType.ToolCallCompleted,
    toolName: "search_logs",
    resultSummary: { rowCount: 3 },
  },
  {
    eventType: AIRunEventType.ProgressLog,
    resultSummary: { message: "Cloning repository" },
  },
  { eventType: AIRunEventType.ProgressLog },
  { eventType: AIRunEventType.ApprovalRequested },
  {
    eventType: AIRunEventType.ActionExecuted,
    resultSummary: { message: "Opened pull request" },
  },
  { eventType: AIRunEventType.RunCompleted },
]);

const MIXED_RUN_STEP_TEXTS: Array<string> = [
  "Starting investigation",
  "Thinking",
  "Analyzing traces",
  "Searching logs",
  "Cloning repository",
  "Opened pull request",
];

// Every event type whose only job is to close a step an earlier event opened.
const CLOSING_ONLY_EVENT_TYPES: Array<AIRunEventType> = [
  AIRunEventType.LlmCallCompleted,
  AIRunEventType.ToolCallCompleted,
  AIRunEventType.ToolCallFailed,
  AIRunEventType.RunCompleted,
  AIRunEventType.RunFailed,
];

function bubble(container: HTMLElement): Element | null {
  return container.querySelector(".rounded-xl.border.border-gray-200");
}

afterEach(() => {
  cleanup();
});

describe("hasRenderableActivity", () => {
  test("no events draw nothing", () => {
    expect(hasRenderableActivity([])).toBe(false);
  });

  /*
   * The case the investigation panel used to get wrong: emitEvent swallows
   * its own persistence failures, so a run can lose RunStarted and still
   * record a terminal RunFailed — one event, zero steps.
   */
  test("a terminal-only trail draws nothing despite carrying events", () => {
    expect(
      hasRenderableActivity(events([{ eventType: AIRunEventType.RunFailed }])),
    ).toBe(false);
    expect(
      hasRenderableActivity(
        events([{ eventType: AIRunEventType.RunCompleted }]),
      ),
    ).toBe(false);
  });

  test("a completion without its opening event still draws nothing", () => {
    expect(
      hasRenderableActivity(
        events([
          {
            eventType: AIRunEventType.ToolCallCompleted,
            toolName: "search_logs",
          },
        ]),
      ),
    ).toBe(false);
  });

  test("a real trail draws steps", () => {
    expect(hasRenderableActivity(SEARCH_LOGS_RUN)).toBe(true);
  });
});

/*
 * The investigation panel labels its Activity tab with countActivitySteps and
 * sizes the feed with it so every step shows. It has to count what the feed
 * draws: the raw event list also holds the halves that only close a step, so
 * counting events would inflate the tab count and, if it ever undercounted,
 * the sized feed would hide steps behind a "+ N earlier steps" line.
 */
describe("countActivitySteps", () => {
  test("no events count zero steps", () => {
    expect(countActivitySteps([])).toBe(0);
  });

  test.each(CLOSING_ONLY_EVENT_TYPES)(
    "a lone %s closes nothing and counts zero steps",
    (eventType: AIRunEventType) => {
      expect(
        countActivitySteps(events([{ eventType, toolName: "search_logs" }])),
      ).toBe(0);
    },
  );

  test("a trail made only of closing events counts zero steps", () => {
    const closingOnly: Array<AIRunEvent> = events(
      CLOSING_ONLY_EVENT_TYPES.map((eventType: AIRunEventType): StepEvent => {
        return { eventType, toolName: "search_logs" };
      }),
    );

    expect(closingOnly).toHaveLength(5);
    expect(countActivitySteps(closingOnly)).toBe(0);
  });

  test("counts the steps drawn, not the raw events", () => {
    expect(SEARCH_LOGS_RUN).toHaveLength(3);
    expect(countActivitySteps(SEARCH_LOGS_RUN)).toBe(2);

    expect(MIXED_RUN).toHaveLength(12);
    expect(countActivitySteps(MIXED_RUN)).toBe(MIXED_RUN_STEP_TEXTS.length);
  });

  test("a progress log only counts when it carries a message", () => {
    expect(
      countActivitySteps(events([{ eventType: AIRunEventType.ProgressLog }])),
    ).toBe(0);
    expect(
      countActivitySteps(
        events([
          {
            eventType: AIRunEventType.ProgressLog,
            resultSummary: { message: "Cloning repository" },
          },
        ]),
      ),
    ).toBe(1);
  });

  /*
   * Both predicates are read by the same host: one decides whether the
   * activity panel exists, the other labels it. If they disagreed the panel
   * could render with a "0" count, or be dropped while still having steps.
   */
  const agreementTrails: Array<[string, Array<AIRunEvent>]> = [
    ["no events", []],
    [
      "a terminal-only trail",
      events([{ eventType: AIRunEventType.RunFailed }]),
    ],
    [
      "a message-less progress log",
      events([{ eventType: AIRunEventType.ProgressLog }]),
    ],
    ["a search-logs run", SEARCH_LOGS_RUN],
    ["a mixed run", MIXED_RUN],
  ];

  test.each(agreementTrails)(
    "agrees with hasRenderableActivity for %s",
    (_name: string, trail: Array<AIRunEvent>) => {
      expect(hasRenderableActivity(trail)).toBe(countActivitySteps(trail) > 0);
    },
  );

  test("a feed sized to the count lists every step and hides none", () => {
    render(
      <ChatActivityFeed
        events={MIXED_RUN}
        hideChrome={true}
        maxVisibleSteps={countActivitySteps(MIXED_RUN)}
      />,
    );

    for (const text of MIXED_RUN_STEP_TEXTS) {
      expect(screen.getByText(text)).toBeVisible();
    }

    expect(screen.queryByText(/earlier step/)).toBeNull();
  });

  // The other direction: the count is exact, not merely large enough.
  test("a feed sized one below the count hides exactly one step", () => {
    render(
      <ChatActivityFeed
        events={MIXED_RUN}
        hideChrome={true}
        maxVisibleSteps={countActivitySteps(MIXED_RUN) - 1}
      />,
    );

    expect(screen.getByText("+ 1 earlier step")).toBeVisible();
    expect(screen.queryByText("Starting investigation")).toBeNull();
    expect(screen.getByText("Opened pull request")).toBeVisible();
  });
});

describe("ChatActivityFeed default chrome (chat panel and copilot)", () => {
  test("keeps its avatar, bubble, title and live indicator", () => {
    const { container } = render(<ChatActivityFeed events={SEARCH_LOGS_RUN} />);

    expect(screen.getByText("Investigating…")).toBeVisible();
    expect(bubble(container)).not.toBeNull();
    // The assistant avatar is the dark rounded square holding the icon.
    expect(container.querySelector(".bg-gray-900")).not.toBeNull();
    expect(container.querySelector('[class~="animate-ping"]')).not.toBeNull();
  });

  test("an explicit title replaces the live wording and the dot can be hidden", () => {
    const { container } = render(
      <ChatActivityFeed
        events={SEARCH_LOGS_RUN}
        title="Completed activity"
        showLiveIndicator={false}
      />,
    );

    expect(screen.getByText("Completed activity")).toBeVisible();
    expect(screen.queryByText("Investigating…")).toBeNull();
    expect(container.querySelector('[class~="animate-ping"]')).toBeNull();
  });
});

describe("ChatActivityFeed hideChrome (investigation panel)", () => {
  test("renders the steps and none of the bubble chrome", () => {
    const { container } = render(
      <ChatActivityFeed events={SEARCH_LOGS_RUN} hideChrome={true} />,
    );

    expect(screen.getByText("Searching logs")).toBeVisible();
    expect(screen.getByText("· 3 rows · 1.5s")).toBeVisible();

    expect(screen.queryByText("Investigating…")).toBeNull();
    expect(bubble(container)).toBeNull();
    expect(container.querySelector(".bg-gray-900")).toBeNull();
    expect(container.querySelector('[class~="animate-ping"]')).toBeNull();
  });

  test("a trail that yields no steps renders nothing at all", () => {
    const { container } = render(
      <ChatActivityFeed
        events={events([{ eventType: AIRunEventType.RunFailed }])}
        hideChrome={true}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("marks a failed tool call rather than reporting it as done", () => {
    render(
      <ChatActivityFeed
        events={events([
          { eventType: AIRunEventType.RunStarted },
          {
            eventType: AIRunEventType.ToolCallStarted,
            toolName: "query_traces",
          },
          {
            eventType: AIRunEventType.ToolCallFailed,
            toolName: "query_traces",
          },
        ])}
        hideChrome={true}
      />,
    );

    expect(screen.getByText("Analyzing traces")).toBeVisible();
    expect(
      screen.getByText("· did not succeed — retrying differently"),
    ).toBeVisible();
  });

  test("caps the visible steps and says how many were hidden", () => {
    const manySteps: Array<AIRunEvent> = events(
      Array.from({ length: 12 }, () => {
        return {
          eventType: AIRunEventType.ToolCallStarted,
          toolName: "search_logs",
        };
      }),
    );

    render(
      <ChatActivityFeed
        events={manySteps}
        hideChrome={true}
        maxVisibleSteps={4}
      />,
    );

    expect(screen.getByText("+ 8 earlier steps")).toBeVisible();
    expect(screen.getAllByText("Searching logs…")).toHaveLength(4);
  });
});
