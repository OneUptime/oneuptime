import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
/*
 * The Markdown viewer, as a stand-in that shows what it was handed: the
 * test suite's react-markdown mock renders raw text, so "safe mode" can only
 * be seen in the props the step view passes.
 */
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  const mockReact: { createElement: typeof React.createElement } =
    jest.requireActual("react");

  return {
    __esModule: true,
    default: (props: { text: string; safeMode?: boolean }) => {
      return mockReact.createElement(
        "div",
        {
          "data-testid": "llm-markdown",
          "data-safe-mode": String(props.safeMode === true),
        },
        props.text,
      );
    },
  };
});

import LlmTranscriptStepView, {
  LLM_STEP_FOLD_LENGTH,
  LlmStepTime,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmTranscriptStepView";
import { LlmTranscriptStep, LlmTranscriptStepType } from "../../../Utils/Telemetry/LlmConversationTranscript";
import { LlmMessagePartType } from "../../../Utils/Telemetry/LlmMessageParser";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import { PROJECT_ID, T0, TRACE_ID, makeStep } from "./LlmConversationFixtures";

/*
 * One moment of a conversation, drawn the way a chat reads: the person on
 * the right, the AI on the left with its model, time, tokens and cost, tool
 * calls as cards, failures in red. The rules that matter to a reader - what
 * is shown, what is folded, what a click opens - and the rule that matters
 * to everyone: no control inside another control.
 */

const TRACE_ROUTE: Route = new Route(
  `/dashboard/${PROJECT_ID}/traces/view/${TRACE_ID}?spanId=abc`,
);
const SETUP_ROUTE: Route = new Route(`/dashboard/${PROJECT_ID}/llm/documentation`);

function renderStep(
  step: LlmTranscriptStep,
  props: {
    isCurrent?: boolean;
    personLabel?: string;
    onReplayFromHere?: (() => void) | undefined;
  } = {},
): HTMLElement {
  render(
    <MemoryRouter>
      <LlmTranscriptStepView
        step={step}
        isCurrent={props.isCurrent ?? false}
        personLabel={props.personLabel ?? "ada@example.com"}
        traceRoute={TRACE_ROUTE}
        setupRoute={SETUP_ROUTE}
        onReplayFromHere={props.onReplayFromHere}
      />
    </MemoryRouter>,
  );

  return screen.getByTestId("llm-step");
}

function expectNoNestedControls(root: HTMLElement): void {
  for (const control of Array.from(root.querySelectorAll("button, a, summary"))) {
    expect(control.parentElement?.closest("button, a")).toBeNull();
  }
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the person said", () => {
  test("their words, as typed, under their name", () => {
    const element: HTMLElement = renderStep(
      makeStep(LlmTranscriptStepType.UserMessage, { text: "**not** markdown\nsecond line" }),
    );

    expect(element).toHaveAttribute("data-step-type", "user");
    expect(element).toHaveTextContent("ada@example.com");
    // A person's message is plain text: no markdown is rendered from it.
    expect(screen.getByTestId("llm-step-text")).toHaveTextContent("**not** markdown second line");
    expect(element.querySelector("strong")).toBeNull();
  });

  test("an unknown person is 'User'", () => {
    expect(
      renderStep(makeStep(LlmTranscriptStepType.UserMessage, { text: "Hi" }), { personLabel: "" }),
    ).toHaveTextContent("User");
  });

  test("an attachment is named, never loaded", () => {
    renderStep(
      makeStep(LlmTranscriptStepType.UserMessage, {
        text: "What is in this picture?",
        media: [
          { type: LlmMessagePartType.Media, text: "", modality: "image", uri: "" },
          {
            type: LlmMessagePartType.Media,
            text: "",
            modality: "file",
            uri: "https://files.example.com/report-with-a-very-long-name-that-goes-on-and-on.pdf",
          },
        ],
      }),
    );

    const media: Array<HTMLElement> = screen.getAllByTestId("llm-step-media");

    expect(media[0]).toHaveTextContent("Attached image");
    expect(Array.from(media[1]?.textContent || "").length).toBeLessThanOrEqual(60);
    expect(document.querySelector("img")).toBeNull();
  });

  test("a very long message is folded behind Show more", () => {
    const long: string = `${"word ".repeat(400)}END`;

    renderStep(makeStep(LlmTranscriptStepType.UserMessage, { text: long }));

    const textElement: HTMLElement = screen.getByTestId("llm-step-text");
    const toggle: HTMLElement = screen.getByTestId("llm-step-text-toggle");

    expect(long.length).toBeGreaterThan(LLM_STEP_FOLD_LENGTH);
    expect(textElement).not.toHaveTextContent("END");
    expect(toggle).toHaveTextContent("Show more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(screen.getByTestId("llm-step-text")).toHaveTextContent("END");
    expect(toggle).toHaveTextContent("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("a short message has nothing to fold", () => {
    renderStep(makeStep(LlmTranscriptStepType.UserMessage, { text: "Hi" }));

    expect(screen.queryByTestId("llm-step-text-toggle")).not.toBeInTheDocument();
  });
});

describe("what the AI answered", () => {
  test("the answer, with the model, how long it took, its tokens and cost", async () => {
    const element: HTMLElement = renderStep(
      makeStep(LlmTranscriptStepType.AssistantMessage, {
        text: "Lisbon is lovely in May.",
        model: "gpt-4o",
        durationMs: 2300,
        inputTokens: 1000,
        outputTokens: 234,
        costUsd: 0.0021,
      }),
    );

    expect(element).toHaveAttribute("data-step-type", "assistant");
    expect(await screen.findByText("Lisbon is lovely in May.")).toBeInTheDocument();

    const meta: HTMLElement = screen.getByTestId("llm-step-meta");

    expect(meta).toHaveTextContent("gpt-4o");
    expect(meta).toHaveTextContent("2.3 s");
    expect(meta).toHaveTextContent("1.2k tokens");
    expect(meta).toHaveTextContent("$0.0021");
  });

  test("no tokens and no cost reported: neither is shown as zero", () => {
    renderStep(
      makeStep(LlmTranscriptStepType.AssistantMessage, {
        text: "Hi",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }),
    );

    const meta: HTMLElement = screen.getByTestId("llm-step-meta");

    expect(meta).not.toHaveTextContent("tokens");
    expect(meta).not.toHaveTextContent("$");
  });

  test("its problems are badges, and Details explains them and the call", () => {
    renderStep(
      makeStep(LlmTranscriptStepType.AssistantMessage, {
        text: "I can't help with that.",
        issues: [LlmAnswerIssue.Refused],
        finishReasons: ["content_filter"],
        provider: "openai",
        agentName: "booking-agent",
        evaluations: [
          { name: "toxicity", label: "fail", score: 0.92, explanation: "Unsafe tone" },
          { name: "", label: "", score: 0.4, explanation: "" },
        ],
      }),
    );

    expect(screen.getByTestId("llm-issue-badge-refused")).toHaveTextContent("Refused");
    expect(screen.queryByTestId("llm-step-details")).not.toBeInTheDocument();

    const toggle: HTMLElement = screen.getByTestId("llm-step-details-toggle");

    expect(toggle).toHaveTextContent("Details");
    fireEvent.click(toggle);

    const details: HTMLElement = screen.getByTestId("llm-step-details");

    expect(toggle).toHaveTextContent("Hide details");
    expect(details).toHaveTextContent("openai");
    expect(details).toHaveTextContent("1,200 / 300");
    expect(details).toHaveTextContent("content_filter");
    expect(details).toHaveTextContent("booking-agent");
    expect(within(details).getByTestId("llm-step-issue-explanations")).toHaveTextContent(
      "The AI declined to answer, or a safety filter blocked its answer.",
    );

    const evaluations: HTMLElement = within(details).getByTestId("llm-step-evaluations");

    expect(evaluations).toHaveTextContent("toxicity");
    expect(evaluations).toHaveTextContent("fail");
    expect(evaluations).toHaveTextContent("— Unsafe tone");
    // An evaluation with no name or label still says something.
    expect(evaluations).toHaveTextContent("Evaluation");
    expect(evaluations).toHaveTextContent("0.4");
    expect(within(details).getByText("Open this call in Traces").closest("a")).toHaveAttribute(
      "href",
      TRACE_ROUTE.toString(),
    );
  });

  test("the model's thinking is folded away", () => {
    renderStep(
      makeStep(LlmTranscriptStepType.AssistantMessage, {
        text: "42",
        reasoning: "The user wants the answer to everything.",
      }),
    );

    const reasoning: HTMLElement = screen.getByTestId("llm-step-reasoning");

    expect(reasoning.tagName).toBe("DETAILS");
    expect(reasoning).not.toHaveAttribute("open");
    expect(reasoning).toHaveTextContent("Thinking");
  });

  test("an answer with no text says so", () => {
    renderStep(makeStep(LlmTranscriptStepType.AssistantMessage, { text: "" }));

    expect(screen.getByTestId("llm-step-empty-answer")).toHaveTextContent(
      "The AI returned an empty answer.",
    );
  });

  test("an answer known only from history says where it came from, and has no call of its own", async () => {
    renderStep(
      makeStep(LlmTranscriptStepType.AssistantMessage, {
        text: "Lisbon is lovely in May.",
        fromHistory: true,
      }),
    );

    expect(screen.getByTestId("llm-step-from-history")).toHaveTextContent(
      "From the chat history",
    );
    expect(screen.queryByTestId("llm-step-meta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("llm-step-time")).not.toBeInTheDocument();
    expect(await screen.findByText("Lisbon is lovely in May.")).toBeInTheDocument();
  });

  test("an answer is Markdown in safe mode, so its links are not clickable and its images never load", () => {
    renderStep(
      makeStep(LlmTranscriptStepType.AssistantMessage, {
        text: "See [the docs](https://evil.example.com) for **more**.",
      }),
    );

    const markdown: HTMLElement = screen.getByTestId("llm-markdown");

    expect(markdown).toHaveAttribute("data-safe-mode", "true");
    expect(markdown).toHaveTextContent(
      "See [the docs](https://evil.example.com) for **more**.",
    );
  });

  test("a person's message is never rendered as Markdown", () => {
    renderStep(makeStep(LlmTranscriptStepType.UserMessage, { text: "**hi**" }));

    expect(screen.queryByTestId("llm-markdown")).not.toBeInTheDocument();
  });
});

describe("tools", () => {
  test("a tool request: the tool and its arguments on one line, the JSON a click away", () => {
    const element: HTMLElement = renderStep(
      makeStep(LlmTranscriptStepType.ToolCall, {
        toolName: "search_flights",
        toolArguments: '{ "from": "LHR",\n "to": "LIS" }',
      }),
    );

    expect(element).toHaveAttribute("data-step-type", "tool_call");
    expect(screen.getByTestId("llm-tool-heading")).toHaveTextContent("Called search_flights");
    expect(screen.getByTestId("llm-tool-one-line")).toHaveTextContent('{"from":"LHR","to":"LIS"}');

    fireEvent.click(screen.getByTestId("llm-tool-toggle"));

    expect(screen.queryByTestId("llm-tool-one-line")).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-tool-value").textContent).toBe(
      '{\n  "from": "LHR",\n  "to": "LIS"\n}',
    );
    expect(screen.getByTestId("llm-tool-toggle")).toHaveTextContent("Hide");
  });

  test("a tool's result, whitespace collapsed on its one line", () => {
    renderStep(
      makeStep(LlmTranscriptStepType.ToolResult, {
        toolName: "search_flights",
        text: "3 flights\n\n  found",
      }),
    );

    expect(screen.getByTestId("llm-tool-heading")).toHaveTextContent("search_flights returned");
    expect(screen.getByTestId("llm-tool-one-line")).toHaveTextContent("3 flights found");
  });

  test("a result that was not recorded says so, with nothing to open", () => {
    renderStep(makeStep(LlmTranscriptStepType.ToolResult, { toolName: "lookup", text: "" }));

    expect(screen.getByText("The result was not recorded.")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-tool-toggle")).not.toBeInTheDocument();
  });

  test("an unnamed tool is named by its call", () => {
    renderStep(makeStep(LlmTranscriptStepType.ToolCall, { toolName: "", toolArguments: "{}" }));

    expect(screen.getByTestId("llm-tool-heading")).toHaveTextContent("Called chat gpt-4o");
  });
});

describe("failures, unrecorded answers, activity and instructions", () => {
  test("a failed AI call is red, with its error", () => {
    const element: HTMLElement = renderStep(
      makeStep(LlmTranscriptStepType.Failure, {
        text: "429 Too Many Requests: rate limit reached",
        issues: [LlmAnswerIssue.Failed],
      }),
    );

    expect(element).toHaveAttribute("data-step-type", "failure");
    expect(element).toHaveTextContent("The AI call failed");
    expect(screen.getByTestId("llm-step-error")).toHaveTextContent("429 Too Many Requests");
    expect(screen.getByTestId("llm-issue-badge-failed")).toBeInTheDocument();
  });

  test("a failed tool names the tool", () => {
    renderStep(
      makeStep(LlmTranscriptStepType.Failure, {
        kind: LlmCallKind.Tool,
        toolName: "charge_card",
        text: "",
      }),
    );

    expect(screen.getByText("The tool charge_card failed")).toBeInTheDocument();
    expect(screen.getByText("No error message was reported.")).toBeInTheDocument();
  });

  test("an answer whose content was not recorded links to how to record it", () => {
    renderStep(makeStep(LlmTranscriptStepType.SilentAnswer, {}));

    expect(
      screen.getByText("The AI answered. What it said was not recorded."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("How to record prompts and answers").closest("a"),
    ).toHaveAttribute("href", SETUP_ROUTE.toString());
    expect(screen.getByTestId("llm-step-meta")).toBeInTheDocument();
  });

  test("a search is one quiet line with its model and time", () => {
    const element: HTMLElement = renderStep(
      makeStep(LlmTranscriptStepType.Activity, {
        kind: LlmCallKind.Retrieval,
        model: "text-embedding-3-small",
        durationMs: 120,
      }),
    );

    expect(element).toHaveTextContent("Searched for context · text-embedding-3-small · 120 ms");
  });

  test("every kind of activity has its words", () => {
    for (const [kind, words] of [
      [LlmCallKind.Embedding, "Created embeddings"],
      [LlmCallKind.Agent, "Ran an agent"],
      [LlmCallKind.Tool, "Ran a tool"],
      [LlmCallKind.Answer, "Called the model"],
      [LlmCallKind.Other, "Did some work"],
    ] as Array<[LlmCallKind, string]>) {
      renderStep(makeStep(LlmTranscriptStepType.Activity, { kind: kind, model: "" }));

      expect(screen.getByTestId("llm-step")).toHaveTextContent(words);
      cleanup();
    }
  });

  test("changed instructions are folded between the messages", () => {
    const element: HTMLElement = renderStep(
      makeStep(LlmTranscriptStepType.Instructions, { text: "You are now a pirate." }),
    );

    expect(element).toHaveTextContent("The AI's instructions changed");
    expect(element.querySelector("details")).not.toHaveAttribute("open");
  });
});

describe("the time a message arrived", () => {
  test("is a button that replays the conversation from that message", () => {
    const onReplayFromHere: jest.Mock<() => void> = jest.fn<() => void>();

    renderStep(makeStep(LlmTranscriptStepType.UserMessage, { text: "Hi" }), {
      onReplayFromHere: onReplayFromHere,
    });

    const time: HTMLElement = screen.getByTestId("llm-step-time");

    expect(time.tagName).toBe("BUTTON");
    expect(time.getAttribute("aria-label")).toMatch(/^Replay the conversation from /);
    expect(time.getAttribute("title")).toMatch(/^Replay from here \(/);

    fireEvent.click(time);

    expect(onReplayFromHere).toHaveBeenCalledTimes(1);
  });

  test("without a replay it is plain text", () => {
    render(<LlmStepTime atMs={T0} />);

    expect(screen.getByTestId("llm-step-time").tagName).toBe("SPAN");
  });

  test("no time, or an impossible one, shows nothing", () => {
    const { container } = render(<LlmStepTime atMs={0} onReplayFromHere={jest.fn()} />);

    expect(container).toBeEmptyDOMElement();

    cleanup();

    const second: ReturnType<typeof render> = render(<LlmStepTime atMs={Number.NaN} />);

    expect(second.container).toBeEmptyDOMElement();
  });
});

describe("the replay's current message", () => {
  test("is drawn with a ring; the others are not", () => {
    renderStep(makeStep(LlmTranscriptStepType.UserMessage, { text: "Hi" }), { isCurrent: true });

    expect(screen.getByTestId("llm-step").innerHTML).toContain("ring-indigo-400");

    cleanup();

    renderStep(makeStep(LlmTranscriptStepType.UserMessage, { text: "Hi" }), { isCurrent: false });

    expect(screen.getByTestId("llm-step").innerHTML).not.toContain("ring-indigo-400");
  });
});

describe("no control inside another", () => {
  test.each([
    LlmTranscriptStepType.UserMessage,
    LlmTranscriptStepType.AssistantMessage,
    LlmTranscriptStepType.ToolCall,
    LlmTranscriptStepType.ToolResult,
    LlmTranscriptStepType.Failure,
    LlmTranscriptStepType.SilentAnswer,
    LlmTranscriptStepType.Activity,
    LlmTranscriptStepType.Instructions,
  ])("%s", (type: LlmTranscriptStepType) => {
    const element: HTMLElement = renderStep(
      makeStep(type, {
        text: "x".repeat(LLM_STEP_FOLD_LENGTH + 10),
        toolName: "tool",
        toolArguments: "{}",
        reasoning: "thinking",
        issues: [LlmAnswerIssue.Flagged],
      }),
      { onReplayFromHere: jest.fn() },
    );

    // Open everything that opens, then look again.
    for (const toggle of Array.from(element.querySelectorAll("button[aria-expanded]"))) {
      fireEvent.click(toggle);
    }

    expectNoNestedControls(element);
  });
});
