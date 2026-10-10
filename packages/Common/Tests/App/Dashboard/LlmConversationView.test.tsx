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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The Markdown viewer as plain text: the conversation's own rules are what
 * these tests are about, not a lazily loaded renderer.
 */
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  const mockReact: { createElement: typeof React.createElement } =
    jest.requireActual("react");

  return {
    __esModule: true,
    default: (props: { text: string }) => {
      return mockReact.createElement(
        "div",
        { "data-testid": "llm-markdown" },
        props.text,
      );
    },
  };
});

import LlmConversationView, {
  getLlmConversationTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationView";
import LlmConversationTranscriptUtil, {
  LlmTranscript,
} from "../../../Utils/Telemetry/LlmConversationTranscript";
import {
  LlmConversationKeyKind,
  LLM_CONVERSATION_ROUTE,
} from "../../../Types/Telemetry/LlmConversationApi";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Service from "../../../Models/DatabaseModels/Service";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  PROJECT_ID,
  T0,
  TRACE_ID,
  call,
  content,
  conversationResponse,
  goTo,
  msg,
  text,
  travelTranscript,
} from "./LlmConversationFixtures";

/*
 * ONE CONVERSATION, TO READ OR TO REPLAY.
 *
 * Opened from the list, a conversation shows everything at once - who it
 * was with, in which app, what it cost and what went wrong - and the whole
 * transcript. The replay then plays it back the way the person lived it.
 * The page reads its conversation from the URL, so every way that URL can
 * be wrong, and every way the server can answer, is covered here.
 */

const APP_ID: string = "6f1e2d3c-4b5a-4968-8776-655443322110";
const BASE: string = `/dashboard/${PROJECT_ID}/llm/conversations`;

let postSpy: ReturnType<typeof jest.spyOn>;
let frames: Array<FrameRequestCallback> = [];

function runFrame(now: number): void {
  const pending: Array<FrameRequestCallback> = frames;
  frames = [];

  act(() => {
    for (const callback of pending) {
      callback(now);
    }
  });
}

function respondWith(body: JSONObject): void {
  postSpy.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, body, {});
  });
}

function postedBody(): JSONObject {
  const calls: Array<Array<unknown>> = postSpy.mock.calls as Array<
    Array<unknown>
  >;

  return (calls[calls.length - 1]![0] as { data: JSONObject }).data;
}

async function openConversation(
  path: string = `${BASE}/c%3Achat-1?from=2026-10-10T09%3A00%3A00.000Z&to=2026-10-10T09%3A01%3A03.000Z`,
): Promise<void> {
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <LlmConversationView />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(
      screen.queryByTestId("llm-conversation-loading"),
    ).not.toBeInTheDocument();
  });
}

function stepTypes(): Array<string | null> {
  return screen
    .getAllByTestId("llm-step")
    .map((step: HTMLElement): string | null => {
      return step.getAttribute("data-step-type");
    });
}

function fact(key: string): string | null {
  return (
    screen
      .getByTestId("llm-conversation-header")
      .querySelector(`[data-fact="${key}"]`)?.textContent || null
  );
}

beforeEach(() => {
  frames = [];
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    },
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: (): void => {
      frames = [];
    },
  });

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<never> => {
      const service: Service = new Service();
      service._id = APP_ID;
      service.name = "Support bot";

      return { data: [service], count: 1, skip: 0, limit: 1 } as never;
    });
  postSpy = jest.spyOn(API, "post");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("reading a conversation", () => {
  test("asks for the conversation the URL names, with the list's hint", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    const calls: Array<Array<unknown>> = postSpy.mock.calls as Array<
      Array<unknown>
    >;

    expect(
      (calls[0]![0] as { url: { toString: () => string } }).url.toString(),
    ).toContain(LLM_CONVERSATION_ROUTE);
    expect(postedBody()).toEqual({
      key: "c:chat-1",
      startTime: "2026-10-10T09:00:00.000Z",
      endTime: "2026-10-10T09:01:03.000Z",
    });
  });

  test("leads with what the person asked, and says who, what, when and how much", async () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "c1",
        serviceId: APP_ID,
        content: content({
          input: [msg("user", text("Where should I go in May?"))],
          output: [msg("assistant", text("Lisbon."))],
        }),
      }),
    ]);

    respondWith(conversationResponse(transcript));

    await openConversation();

    expect(screen.getByTestId("llm-conversation-title")).toHaveTextContent(
      "Where should I go in May?",
    );
    expect(fact("person")).toBe("ada@example.com");
    expect(fact("app")).toBe("Support bot");
    expect(fact("models")).toBe("gpt-4o");
    expect(fact("duration")).toBe("1.0 s");
    expect(fact("answers")).toBe("1 answer");
    expect(fact("cost")).toBe("$0.0010");
    expect(fact("tokens")).toBe("15 tokens");
    expect(fact("started")).toBeTruthy();
  });

  test("the whole transcript, in order, with what went wrong marked", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    expect(stepTypes()).toEqual(["user", "assistant", "user", "assistant"]);
    expect(
      within(screen.getByTestId("llm-conversation-issues")).getByTestId(
        "llm-issue-badge-refused",
      ),
    ).toHaveTextContent("1 refusal");
    // Fully drawn: nothing is waiting in a replay.
    expect(
      screen.queryByTestId("llm-replay-hidden-note"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-replay-play")).toHaveTextContent("Replay");
  });

  test("the instructions the AI was given are folded above the transcript", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    const instructions: HTMLElement = screen.getByTestId(
      "llm-conversation-instructions",
    );

    expect(instructions.tagName).toBe("DETAILS");
    expect(instructions).toHaveTextContent("Instructions the AI was given");
    expect(instructions).toHaveTextContent("You are a travel bot.");
  });

  test("opens the whole trace in Traces", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    expect(screen.getByText("Open in Traces").closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/traces/view/${TRACE_ID}`,
    );
  });

  test("a way back to every conversation", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    expect(screen.getByText("All conversations").closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/llm/conversations`,
    );
  });

  test("a normal conversation carries none of the notes", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    expect(
      screen.queryByTestId("llm-conversation-request-note"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("llm-conversation-no-content-note"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("llm-conversation-truncated-note"),
    ).not.toBeInTheDocument();
  });
});

describe("what the page says about the conversation it shows", () => {
  test("one request, when the app sent no conversation id", async () => {
    respondWith(
      conversationResponse(travelTranscript(), {
        kind: LlmConversationKeyKind.Request,
      }),
    );

    await openConversation(`${BASE}/t%3A${TRACE_ID}`);

    const note: HTMLElement = screen.getByTestId(
      "llm-conversation-request-note",
    );

    expect(note).toHaveTextContent(
      "Your app did not send a conversation id, so this shows one request",
    );
    expect(
      within(note).getByText("Group calls into conversations").closest("a"),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/llm/documentation`);
  });

  test("prompts and answers that were not recorded", async () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({ spanId: "c1" }),
    ]);

    respondWith(conversationResponse(transcript));

    await openConversation();

    expect(
      screen.getByTestId("llm-conversation-no-content-note"),
    ).toHaveTextContent(
      "Prompts and answers were not recorded for this conversation",
    );
    expect(stepTypes()).toEqual(["silent_answer"]);
  });

  test("a conversation too long to read whole", async () => {
    respondWith(conversationResponse(travelTranscript(), { truncated: true }));

    await openConversation();

    expect(
      screen.getByTestId("llm-conversation-truncated-note"),
    ).toHaveTextContent("it shows its first 500 AI calls");
  });
});

describe("when the conversation cannot be shown", () => {
  test("a link that names no conversation", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    await openConversation(`${BASE}/not-a-key`);

    expect(postSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("llm-conversation-invalid")).toHaveTextContent(
      "This link does not point to a conversation",
    );

    fireEvent.click(screen.getByTestId("llm-conversation-back"));

    expect(String(navigate.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/llm/conversations`,
    );
  });

  test("an error says what went wrong, and Try again tries again", async () => {
    postSpy.mockImplementationOnce(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(
        403,
        { error: "You cannot read traces." },
        {},
      );
    });

    await openConversation();

    expect(screen.getByTestId("llm-conversation-error")).toHaveTextContent(
      "Couldn't load this conversation",
    );
    expect(screen.getByTestId("llm-conversation-error")).toHaveTextContent(
      "You cannot read traces.",
    );

    respondWith(conversationResponse(travelTranscript()));
    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(
      await screen.findByTestId("llm-conversation-view"),
    ).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  test("an answer the page cannot read is an error, not a blank page", async () => {
    respondWith({ key: "c:chat-1" });

    await openConversation();

    expect(screen.getByTestId("llm-conversation-error")).toHaveTextContent(
      "The conversation could not be read.",
    );
  });

  test("a conversation with no calls left, perhaps past retention", async () => {
    respondWith(conversationResponse({ ...travelTranscript(), steps: [] }));

    await openConversation();

    expect(screen.getByTestId("llm-conversation-not-found")).toHaveTextContent(
      "No AI calls found for this conversation",
    );
  });
});

describe("replaying", () => {
  test("a link to a message opens the replay there, the rest still to come", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation(`${BASE}/c%3Achat-1?step=1`);

    expect(stepTypes()).toEqual(["user", "assistant"]);
    expect(screen.getByTestId("llm-replay-hidden-note")).toHaveTextContent(
      "2 more messages to come in the replay",
    );

    fireEvent.click(screen.getByTestId("llm-replay-show-all"));

    expect(stepTypes()).toHaveLength(4);
    expect(
      screen.queryByTestId("llm-replay-hidden-note"),
    ).not.toBeInTheDocument();
  });

  test("J and L step back and forward; the URL keeps the message", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    fireEvent.keyDown(window, { key: "j" });

    expect(stepTypes()).toHaveLength(3);
    expect(new URLSearchParams(window.location.search).get("step")).toBe("2");

    fireEvent.keyDown(window, { key: "ArrowLeft" });

    expect(stepTypes()).toHaveLength(2);
    expect(screen.getByTestId("llm-replay-hidden-note")).toHaveTextContent(
      "2 more messages to come in the replay",
    );

    fireEvent.keyDown(window, { key: "l" });

    expect(stepTypes()).toHaveLength(3);
    expect(screen.getByTestId("llm-replay-hidden-note")).toHaveTextContent(
      "1 more message to come in the replay",
    );

    fireEvent.keyDown(window, { key: "L" });

    // At the end the URL forgets the step.
    expect(stepTypes()).toHaveLength(4);
    expect(new URLSearchParams(window.location.search).has("step")).toBe(false);
  });

  test("K plays from the first message", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    fireEvent.keyDown(window, { key: "k" });

    expect(screen.getByTestId("llm-replay-play")).toHaveAttribute(
      "data-state",
      "playing",
    );
    expect(stepTypes()).toEqual(["user"]);
  });

  test("keys typed into a field, or with a modifier, are not the replay's", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    const input: HTMLInputElement = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "j" });
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });

    expect(stepTypes()).toHaveLength(4);
    input.remove();
  });

  test("while the AI was answering, the replay shows it answering, counting up", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    fireEvent.click(screen.getByTestId("llm-replay-play"));
    runFrame(0);
    runFrame(1000);

    expect(screen.getByTestId("llm-replay-pending-answer")).toHaveTextContent(
      "AI is answering… 1.0 s",
    );
    // While playing, what is still to come is not announced.
    expect(
      screen.queryByTestId("llm-replay-hidden-note"),
    ).not.toBeInTheDocument();

    runFrame(2100);

    expect(
      screen.queryByTestId("llm-replay-pending-answer"),
    ).not.toBeInTheDocument();
    expect(stepTypes()).toEqual(["user", "assistant"]);
  });

  test("a message's time replays the conversation from that message", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation();

    const times: Array<HTMLElement> = screen.getAllByTestId("llm-step-time");

    fireEvent.click(times[2]!);

    expect(screen.getByTestId("llm-replay-play")).toHaveAttribute(
      "data-state",
      "playing",
    );
    expect(stepTypes()).toEqual(["user", "assistant", "user"]);
  });

  test("the replay's current message carries the ring", async () => {
    respondWith(conversationResponse(travelTranscript()));

    await openConversation(`${BASE}/c%3Achat-1?step=1`);

    const steps: Array<HTMLElement> = screen.getAllByTestId("llm-step");

    expect(steps[1]!.innerHTML).toContain("ring-indigo-400");
    expect(steps[0]!.innerHTML).not.toContain("ring-indigo-400");
  });
});

describe("getLlmConversationTitle", () => {
  const translator: ReturnType<typeof createTranslator> = createTranslator(
    undefined,
    "en",
  );

  test("the first thing the person asked, cut to two hundred characters", () => {
    expect(
      Array.from(
        getLlmConversationTitle({
          transcript: { ...travelTranscript(), title: "y".repeat(500) },
          kind: LlmConversationKeyKind.Conversation,
          conversationId: "chat-1",
          translator: translator,
        }),
      ).length,
    ).toBeLessThanOrEqual(200);
  });

  test("without a question: the request's trace, or the conversation id", () => {
    const untitled: LlmTranscript = { ...travelTranscript(), title: "" };

    expect(
      getLlmConversationTitle({
        transcript: untitled,
        kind: LlmConversationKeyKind.Request,
        conversationId: "",
        translator: translator,
      }),
    ).toBe(`Request ${TRACE_ID.slice(0, 8)}`);
    expect(
      getLlmConversationTitle({
        transcript: untitled,
        kind: LlmConversationKeyKind.Conversation,
        conversationId: "chat-1",
        translator: translator,
      }),
    ).toBe("Conversation chat-1");
  });

  test("a request with no steps has no trace to name", () => {
    expect(
      getLlmConversationTitle({
        transcript: { ...travelTranscript(), title: "", steps: [] },
        kind: LlmConversationKeyKind.Request,
        conversationId: "",
        translator: translator,
      }),
    ).toBe("Request ");
  });

  test("an answer's issue count is read from the transcript", () => {
    expect(travelTranscript().issueCounts[LlmAnswerIssue.Refused]).toBe(1);
    expect(T0).toBeGreaterThan(0);
  });
});
