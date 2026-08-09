import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ChatActivityFeed, {
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
    | { rowCount?: number | undefined; durationInMs?: number | undefined }
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
