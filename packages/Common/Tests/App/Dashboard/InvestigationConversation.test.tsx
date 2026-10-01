import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The conversation that closes the AI Investigation card, rendered for real
 * with only the network, markdown and heavy chat widgets stubbed. It drives
 * the component the way responders will: asking from a suggestion, typing,
 * seeing who asked what, watching an answer being written, approving an
 * action, stopping an answer, and choosing how much the AI may do. Its
 * composer, its sources list and its notices are the real ones.
 */

const postMock: MockFunction = getJestMockFunction();
const getFriendlyMessageMock: MockFunction = getJestMockFunction();
const activityFeedMock: MockFunction = getJestMockFunction();
const widgetRendererMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (...args: Array<unknown>) => {
        return getFriendlyMessageMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getName: () => {
        return {
          toString: () => {
            return "Sam Lee";
          },
        };
      },
      getUserId: () => {
        return {
          toString: () => {
            return "22222222-2222-4222-8222-222222222222";
          },
        };
      },
    },
  };
});

/*
 * The markdown renderer is stubbed, but it still calls the component's
 * citation renderer for every [C#] in the text — exactly the contract the
 * real inline-reference transform has — so the chips are really rendered.
 */
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      text: string;
      safeMode?: boolean;
      inlineReferences?: {
        renderCitation?: (id: string) => React.ReactElement | null;
      };
    }): React.ReactElement => {
      const chips: Array<React.ReactElement | null> = Array.from(
        props.text.matchAll(/\[(C\d+)\]/g),
      ).map((match: RegExpMatchArray, index: number) => {
        const chip: React.ReactElement | null =
          props.inlineReferences?.renderCitation?.(match[1]!) ?? null;
        return chip
          ? React.createElement(React.Fragment, { key: index }, chip)
          : null;
      });

      return React.createElement(
        "div",
        {
          "data-testid": "answer-markdown",
          "data-safe-mode": String(props.safeMode === true),
        },
        props.text,
        ...chips,
      );
    },
  };
});

const navigateToCitationTargetMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav",
  () => {
    return {
      __esModule: true,
      navigateToCitationTarget: (...args: Array<unknown>) => {
        return navigateToCitationTargetMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed",
  () => {
    return {
      __esModule: true,
      default: (props: { events: Array<unknown> }): React.ReactElement => {
        activityFeedMock(props);
        return React.createElement("div", { "data-testid": "live-steps" });
      },
      hasRenderableActivity: (events: Array<unknown>): boolean => {
        return events.length > 0;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer",
  () => {
    return {
      __esModule: true,
      default: (props: { widgets: Array<unknown> }): React.ReactElement => {
        widgetRendererMock(props);
        return React.createElement("div", { "data-testid": "answer-widgets" });
      },
    };
  },
);

import { AIInvestigationStage } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import InvestigationConversation from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/InvestigationConversation";
import {
  THREAD_FOLD_ABOVE_LENGTH,
  THREAD_PERMISSION_MODE_STORAGE_KEY,
  THREAD_POLL_BUSY_MS,
  THREAD_POLL_IDLE_MS,
  THREAD_TAIL_LENGTH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/InvestigationConversationData";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../Types/AI/AIChatPermissionMode";
import { AIChatToolActionStatus } from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const PRIYA: string = "11111111-1111-4111-8111-111111111111";
const SAM: string = "22222222-2222-4222-8222-222222222222";
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALERT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUN_ID: string = "55555555-5555-4555-8555-555555555555";
const ANSWER_ID: string = "66666666-6666-4666-8666-666666666666";

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
}

function question(data: {
  id: string;
  content: string;
  userId: string;
  name: string;
}): JSONObject {
  return {
    _id: data.id,
    role: AIChatMessageRole.User,
    contentInMarkdown: data.content,
    status: AIChatMessageStatus.Completed,
    citations: [],
    widgets: [],
    toolActions: [],
    errorMessage: null,
    aiRunId: null,
    createdAt: new Date().toISOString(),
    author: { userId: data.userId, name: data.name },
  };
}

function answer(data: {
  id?: string;
  content?: string;
  status?: AIChatMessageStatus;
  userId: string;
  name: string;
  citations?: Array<JSONObject>;
  widgets?: Array<JSONObject>;
  toolActions?: Array<JSONObject>;
  errorMessage?: string;
}): JSONObject {
  return {
    _id: data.id || ANSWER_ID,
    role: AIChatMessageRole.Assistant,
    contentInMarkdown: data.content ?? "",
    status: data.status || AIChatMessageStatus.Completed,
    citations: data.citations || [],
    widgets: data.widgets || [],
    toolActions: data.toolActions || [],
    errorMessage: data.errorMessage || null,
    aiRunId: RUN_ID,
    createdAt: new Date().toISOString(),
    author: { userId: data.userId, name: data.name },
  };
}

function threadResponse(data: {
  messages: Array<JSONObject>;
  isBusy?: boolean;
  activeRun?: JSONObject | null;
}): { data: JSONObject } {
  return {
    data: {
      conversationId:
        data.messages.length > 0
          ? "77777777-7777-4777-8777-777777777777"
          : null,
      messages: data.messages,
      activeRun: data.activeRun ?? null,
      isBusy: data.isBusy === true,
      viewerUserId: SAM,
    },
  };
}

const EMPTY: { data: JSONObject } = threadResponse({ messages: [] });

// Respond by route, so polling and actions can interleave freely.
function routeResponses(responses: {
  thread?: () => { data: JSONObject };
  send?: () => { data: JSONObject } | HTTPErrorResponse;
  approve?: () => { data: JSONObject };
  cancel?: () => { data: JSONObject };
}): void {
  postMock.mockImplementation(((request: PostRequest) => {
    const path: string = request.url.toString();

    if (path.endsWith("/ai-investigation/conversation/send-message")) {
      return Promise.resolve(
        responses.send
          ? responses.send()
          : { data: { assistantMessageId: ANSWER_ID, aiRunId: RUN_ID } },
      );
    }

    if (path.endsWith("/ai-investigation/conversation/respond-to-approval")) {
      return Promise.resolve(
        responses.approve ? responses.approve() : { data: { aiRunId: RUN_ID } },
      );
    }

    if (path.endsWith("/ai-investigation/conversation/cancel-run")) {
      return Promise.resolve(
        responses.cancel
          ? responses.cancel()
          : { data: { aiRunId: RUN_ID, cancelled: true } },
      );
    }

    return Promise.resolve(responses.thread ? responses.thread() : EMPTY);
  }) as never);
}

function requests(path: string): Array<PostRequest> {
  return postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as PostRequest;
    })
    .filter((request: PostRequest) => {
      return request.url.toString().endsWith(path);
    });
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 6; index++) {
      await Promise.resolve();
    }
  });
}

async function tick(milliseconds: number): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(milliseconds);
    for (let index: number = 0; index < 6; index++) {
      await Promise.resolve();
    }
  });
}

function renderConversation(data?: {
  subjectType?: "incident" | "alert";
  subjectId?: ObjectID;
  stage?: AIInvestigationStage;
}): ReturnType<typeof render> {
  return render(
    <InvestigationConversation
      subjectType={data?.subjectType || "incident"}
      subjectId={data?.subjectId || INCIDENT_ID}
      investigationStage={data?.stage}
    />,
  );
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

function sendButton(): HTMLElement {
  return screen.getByTitle("Send (Enter)");
}

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  getFriendlyMessageMock.mockImplementation((error: unknown): string => {
    return error instanceof HTTPErrorResponse
      ? error.message || "Request failed"
      : "Request failed";
  });
  Object.assign(navigator, {
    clipboard: {
      writeText: jest.fn(() => {
        return Promise.resolve();
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  postMock.mockReset();
  getFriendlyMessageMock.mockReset();
  activityFeedMock.mockReset();
  widgetRendererMock.mockReset();
  navigateToCitationTargetMock.mockReset();
});

describe("InvestigationConversation — an empty thread", () => {
  test("loads the incident's thread and invites the first question", async () => {
    routeResponses({});

    renderConversation();
    expect(screen.getByText("Loading the conversation…")).toBeVisible();
    await flush();

    const load: PostRequest = requests("/ai-investigation/conversation")[0]!;
    expect(load.data).toEqual({
      subjectType: "incident",
      subjectId: INCIDENT_ID.toString(),
    });

    expect(screen.getByText("Ask OneUptime AI")).toBeVisible();
    expect(
      screen.getByTestId("investigation-conversation-empty"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "What should I do right now?" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Everyone on this incident sees this conversation/),
    ).toBeVisible();
  });

  test("the composer never steals focus from the page", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    expect(document.activeElement).not.toBe(composer());
  });

  test("a question suggestion is asked in one click, in auto-run by default", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "What changed just before this?" }),
    );
    await flush();

    const send: PostRequest = requests(
      "/ai-investigation/conversation/send-message",
    )[0]!;
    expect(send.data["subjectType"]).toBe("incident");
    expect(send.data["subjectId"]).toBe(INCIDENT_ID.toString());
    expect(send.data["content"]).toContain(
      "What changed right before this incident started",
    );
    expect(send.data["permissionMode"]).toBe(AIChatPermissionMode.AutoRun);
  });

  test("an action suggestion is placed in the composer, never sent on click", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "Acknowledge this incident" }),
    );
    await flush();

    expect(composer().value).toBe("Acknowledge this incident.");
    expect(
      requests("/ai-investigation/conversation/send-message"),
    ).toHaveLength(0);
  });

  test("an alert's thread talks about the alert", async () => {
    routeResponses({});

    renderConversation({ subjectType: "alert", subjectId: ALERT_ID });
    await flush();

    expect(requests("/ai-investigation/conversation")[0]!.data).toEqual({
      subjectType: "alert",
      subjectId: ALERT_ID.toString(),
    });
    expect(
      screen.getByRole("button", { name: "Acknowledge this alert" }),
    ).toBeVisible();
  });

  test("is a section of the card and never a card of its own", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    expect(screen.queryByTestId("card")).toBeNull();
    expect(screen.getAllByText("Ask OneUptime AI")).toHaveLength(1);
    expect(screen.getByTestId("investigation-conversation").tagName).toBe(
      "SECTION",
    );
  });
});

describe("InvestigationConversation — asking", () => {
  test("typing and pressing Enter sends the question and shows it at once", async () => {
    let asked: boolean = false;
    routeResponses({
      thread: () => {
        return asked
          ? threadResponse({
              isBusy: true,
              messages: [
                question({
                  id: "q1",
                  content: "Which pods use the most memory?",
                  userId: SAM,
                  name: "Sam Lee",
                }),
                answer({
                  status: AIChatMessageStatus.InProgress,
                  userId: SAM,
                  name: "Sam Lee",
                }),
              ],
            })
          : EMPTY;
      },
      send: () => {
        asked = true;
        return { data: { assistantMessageId: ANSWER_ID, aiRunId: RUN_ID } };
      },
    });

    renderConversation();
    await flush();

    fireEvent.change(composer(), {
      target: { value: "Which pods use the most memory?" },
    });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await flush();

    expect(
      requests("/ai-investigation/conversation/send-message")[0]!.data[
        "content"
      ],
    ).toBe("Which pods use the most memory?");
    expect(composer().value).toBe("");
    expect(screen.getByText("Which pods use the most memory?")).toBeVisible();
    expect(screen.getByText("You")).toBeVisible();
    expect(
      screen.getByText("OneUptime AI is working on your question…"),
    ).toBeVisible();
  });

  test("Shift+Enter does not send", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    fireEvent.change(composer(), { target: { value: "line one" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    await flush();

    expect(
      requests("/ai-investigation/conversation/send-message"),
    ).toHaveLength(0);
  });

  test("a refused question is given back with the reason", async () => {
    routeResponses({
      send: () => {
        return new HTTPErrorResponse(
          400,
          {
            message:
              "OneUptime AI is still answering a question in this thread.",
          },
          {},
        );
      },
    });
    getFriendlyMessageMock.mockReturnValue(
      "OneUptime AI is still answering a question in this thread.",
    );

    renderConversation();
    await flush();

    fireEvent.change(composer(), { target: { value: "And the node?" } });
    fireEvent.click(sendButton());
    await flush();

    expect(
      screen.getByText(
        "OneUptime AI is still answering a question in this thread.",
      ),
    ).toBeVisible();
    expect(composer().value).toBe("And the node?");
    expect(screen.queryByText("Sending…")).toBeNull();
  });

  test("the chosen permission mode is used and remembered", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    fireEvent.click(screen.getByTitle("Choose what the AI is allowed to do"));
    fireEvent.click(screen.getByText("Read-only"));
    await flush();

    expect(
      screen.getByTestId("investigation-conversation-mode"),
    ).toHaveTextContent("Only reads and answers. It never changes anything.");
    expect(
      window.localStorage.getItem(THREAD_PERMISSION_MODE_STORAGE_KEY),
    ).toBe(AIChatPermissionMode.ReadOnly);

    fireEvent.change(composer(), { target: { value: "What happened?" } });
    fireEvent.click(sendButton());
    await flush();

    expect(
      requests("/ai-investigation/conversation/send-message")[0]!.data[
        "permissionMode"
      ],
    ).toBe(AIChatPermissionMode.ReadOnly);
  });

  test("a remembered mode is restored on the next visit", async () => {
    window.localStorage.setItem(
      THREAD_PERMISSION_MODE_STORAGE_KEY,
      AIChatPermissionMode.AskForApproval,
    );
    routeResponses({});

    renderConversation();
    await flush();

    expect(
      screen.getByTestId("investigation-conversation-mode"),
    ).toHaveTextContent("Asks for approval before it changes anything.");
  });
});

describe("InvestigationConversation — a shared thread", () => {
  test("shows who asked what, and whom each answer was for", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: [
            question({
              id: "q1",
              content: "Which pods use the most memory?",
              userId: PRIYA,
              name: "Priya Shah",
            }),
            answer({
              content: "ClickHouse uses 120Gi [C1].",
              userId: PRIYA,
              name: "Priya Shah",
              citations: [
                {
                  id: "C1",
                  toolName: "run_kubectl",
                  label: 'kubectl top pods -A on cluster "prod"',
                  queryArguments: {},
                  rowCount: 1,
                },
              ],
            }),
            question({
              id: "q2",
              content: "And pgbouncer?",
              userId: SAM,
              name: "Sam Lee",
            }),
          ],
        });
      },
    });

    renderConversation();
    await flush();

    const questions: Array<HTMLElement> = screen.getAllByTestId(
      "investigation-conversation-question",
    );
    expect(within(questions[0]!).getByText("Priya Shah")).toBeVisible();
    expect(within(questions[1]!).getByText("You")).toBeVisible();

    const reply: HTMLElement = screen.getByTestId(
      "investigation-conversation-answer",
    );
    expect(within(reply).getByText("OneUptime AI")).toBeVisible();
    expect(within(reply).getByText("to Priya Shah")).toBeVisible();
    expect(within(reply).getByTestId("answer-markdown")).toHaveTextContent(
      "ClickHouse uses 120Gi [C1].",
    );
    // Answers render through the safe markdown path.
    expect(within(reply).getByTestId("answer-markdown")).toHaveAttribute(
      "data-safe-mode",
      "true",
    );
    expect(
      within(reply).getByTestId("investigation-conversation-sources"),
    ).toHaveTextContent('kubectl top pods -A on cluster "prod"');

    // Everyone who asked, in the header.
    expect(
      screen.getByLabelText("2 people have asked in this conversation"),
    ).toBeInTheDocument();
  });

  test("turns each [C#] into a chip naming its evidence, and opens linked evidence", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: [
            answer({
              content:
                "Errors spiked [C1] while ClickHouse used 118Gi [C2]. [C9]",
              userId: SAM,
              name: "Sam Lee",
              citations: [
                {
                  id: "C1",
                  toolName: "search_logs",
                  label: "Error logs, last 1h",
                  queryArguments: {},
                  rowCount: 40,
                  target: { type: "Logs", params: {} },
                },
                {
                  id: "C2",
                  toolName: "run_kubectl",
                  label: 'kubectl top pods -A on cluster "prod"',
                  queryArguments: {},
                  rowCount: 1,
                },
              ],
            }),
          ],
        });
      },
    });

    renderConversation();
    await flush();

    const linked: HTMLElement = screen.getByRole("button", {
      name: "Citation C1: Error logs, last 1h",
    });
    expect(linked).toHaveAttribute("title", "Error logs, last 1h");

    fireEvent.click(linked);
    expect(navigateToCitationTargetMock).toHaveBeenCalledWith({
      type: "Logs",
      params: {},
    });

    // Evidence with no page of its own is a chip, never a dead button.
    const unlinked: HTMLElement = screen.getByLabelText(
      'Citation C2: kubectl top pods -A on cluster "prod"',
    );
    expect(unlinked.tagName).toBe("SPAN");

    // A marker with no citation behind it stays plain text.
    expect(document.querySelector('[data-citation-id="C9"]')).toBeNull();
  });

  test("another asker's charts and tables are not shown to the viewer", async () => {
    const widget: JSONObject = {
      id: "W1",
      type: "Table",
      title: "Top pods",
      data: {},
    };
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: [
            answer({
              id: "a1",
              content: "For Priya",
              userId: PRIYA,
              name: "Priya Shah",
              widgets: [widget],
            }),
            answer({
              id: "a2",
              content: "For me",
              userId: SAM,
              name: "Sam Lee",
              widgets: [widget],
            }),
          ],
        });
      },
    });

    renderConversation();
    await flush();

    expect(screen.getAllByTestId("answer-widgets")).toHaveLength(1);
    const answers: Array<HTMLElement> = screen.getAllByTestId(
      "investigation-conversation-answer",
    );
    expect(within(answers[0]!).queryByTestId("answer-widgets")).toBeNull();
    expect(within(answers[1]!).getByTestId("answer-widgets")).toBeVisible();
  });

  test("an error and a stopped answer read plainly", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: [
            answer({
              id: "a1",
              status: AIChatMessageStatus.Error,
              errorMessage: "The AI provider is unavailable.",
              userId: SAM,
              name: "Sam Lee",
            }),
            answer({
              id: "a2",
              status: AIChatMessageStatus.Cancelled,
              content: "Stopped by user.",
              userId: SAM,
              name: "Sam Lee",
            }),
          ],
        });
      },
    });

    renderConversation();
    await flush();

    expect(screen.getByText("The AI provider is unavailable.")).toBeVisible();
    expect(screen.getByText("Ask again to retry.")).toBeVisible();
    expect(screen.getByText("Stopped by user.")).toBeVisible();
  });

  test("copies an answer", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: [
            answer({ content: "ClickHouse.", userId: SAM, name: "Sam Lee" }),
          ],
        });
      },
    });

    renderConversation();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await flush();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ClickHouse.");
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  });
});

describe("InvestigationConversation — while OneUptime AI works", () => {
  function busyThread(): { data: JSONObject } {
    return threadResponse({
      isBusy: true,
      messages: [
        question({
          id: "q1",
          content: "Which pods use the most memory?",
          userId: PRIYA,
          name: "Priya Shah",
        }),
        answer({
          status: AIChatMessageStatus.InProgress,
          userId: PRIYA,
          name: "Priya Shah",
        }),
      ],
      activeRun: {
        aiRunId: RUN_ID,
        assistantMessageId: ANSWER_ID,
        status: AIRunStatus.Running,
        events: [
          {
            _id: "88888888-8888-4888-8888-888888888888",
            sequence: 1,
            eventType: AIRunEventType.ToolCallStarted,
            toolName: "run_kubectl",
          },
        ],
      },
    });
  }

  test("narrates whose question it is on and shows the live steps", async () => {
    routeResponses({ thread: busyThread });

    renderConversation();
    await flush();

    expect(
      screen.getAllByText("OneUptime AI is working on Priya Shah's question…")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("live-steps")).toBeVisible();
    expect(
      (activityFeedMock.mock.calls[0]![0] as { events: Array<unknown> }).events,
    ).toHaveLength(1);
  });

  test("a new question waits: typing works, sending does not", async () => {
    routeResponses({ thread: busyThread });

    renderConversation();
    await flush();

    fireEvent.change(composer(), { target: { value: "And the node?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await flush();

    expect(composer().value).toBe("And the node?");
    expect(
      requests("/ai-investigation/conversation/send-message"),
    ).toHaveLength(0);
    expect(composer().placeholder).toBe(
      "Type your next question — send it when this answer finishes…",
    );
  });

  test("anyone on the incident can stop the answer", async () => {
    routeResponses({ thread: busyThread });

    renderConversation();
    await flush();

    fireEvent.click(screen.getByTitle("Stop generating"));
    await flush();

    expect(requests("/ai-investigation/conversation/cancel-run")).toHaveLength(
      1,
    );
    expect(
      requests("/ai-investigation/conversation/cancel-run")[0]!.data,
    ).toEqual({ subjectType: "incident", subjectId: INCIDENT_ID.toString() });
  });

  test("polls quickly while an answer is being written, slowly when idle", async () => {
    let busy: boolean = true;
    routeResponses({
      thread: () => {
        return busy ? busyThread() : EMPTY;
      },
    });

    renderConversation();
    await flush();

    const loadsAfterMount: number = requests(
      "/ai-investigation/conversation",
    ).length;

    await tick(THREAD_POLL_BUSY_MS);
    expect(requests("/ai-investigation/conversation").length).toBe(
      loadsAfterMount + 1,
    );

    busy = false;
    await tick(THREAD_POLL_BUSY_MS);
    const loadsWhenIdle: number = requests(
      "/ai-investigation/conversation",
    ).length;

    await tick(THREAD_POLL_BUSY_MS);
    expect(requests("/ai-investigation/conversation").length).toBe(
      loadsWhenIdle,
    );

    await tick(THREAD_POLL_IDLE_MS);
    expect(requests("/ai-investigation/conversation").length).toBe(
      loadsWhenIdle + 1,
    );
  });
});

describe("InvestigationConversation — approvals", () => {
  test("anyone can approve a paused action, and the decision is sent", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          isBusy: true,
          messages: [
            answer({
              status: AIChatMessageStatus.WaitingForApproval,
              userId: PRIYA,
              name: "Priya Shah",
              toolActions: [
                {
                  id: "call-1",
                  toolName: "acknowledge_incident",
                  title: "Acknowledge incident #42",
                  arguments: {},
                  isMutation: true,
                  requiresApproval: true,
                  status: AIChatToolActionStatus.Pending,
                },
              ],
            }),
          ],
        });
      },
    });

    renderConversation();
    await flush();

    expect(
      screen.getByText(
        "I'd like to take this action. Review it and approve to continue.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Acknowledge incident #42")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Run 1 action/ }));
    await flush();

    const decision: PostRequest = requests(
      "/ai-investigation/conversation/respond-to-approval",
    )[0]!;
    expect(decision.data["assistantMessageId"]).toBe(ANSWER_ID);
    expect(decision.data["decisions"]).toEqual([
      { toolCallId: "call-1", approved: true },
    ]);
  });
});

describe("InvestigationConversation — resilience", () => {
  test("a thread that cannot be loaded says so and can be retried", async () => {
    let fail: boolean = true;
    postMock.mockImplementation((() => {
      return fail
        ? Promise.resolve(
            new HTTPErrorResponse(500, { message: "Server error" }, {}),
          )
        : Promise.resolve(EMPTY);
    }) as never);
    getFriendlyMessageMock.mockReturnValue("Server error");

    renderConversation();
    await flush();

    expect(
      screen.getByText("Could not load the conversation: Server error"),
    ).toBeVisible();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();

    expect(
      screen.getByTestId("investigation-conversation-empty"),
    ).toBeVisible();
  });

  test("moving to another incident never shows the previous thread", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: [
            question({
              id: "q1",
              content: "Old incident question",
              userId: PRIYA,
              name: "Priya Shah",
            }),
          ],
        });
      },
    });

    const view: ReturnType<typeof render> = renderConversation();
    await flush();
    expect(screen.getByText("Old incident question")).toBeVisible();

    routeResponses({});
    const OTHER_INCIDENT: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );

    view.rerender(
      <InvestigationConversation
        subjectType="incident"
        subjectId={OTHER_INCIDENT}
      />,
    );
    await flush();

    expect(screen.queryByText("Old incident question")).toBeNull();
    const loads: Array<PostRequest> = requests(
      "/ai-investigation/conversation",
    );
    expect(loads[loads.length - 1]!.data["subjectId"]).toBe(
      OTHER_INCIDENT.toString(),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * One section of the AI Investigation card
 * ---------------------------------------------------------------------------
 * The conversation used to open with an icon tile and a header of its own
 * (and, with no run, sat in a second card). It is the card's last section
 * now and is drawn like the card's other rows.
 */

// Classes that would make something inside the section a panel of its own.
const BOX_CLASS: RegExp =
  /(^|\s)(bg-(gray|indigo|amber|emerald|red|green|rose|violet|sky)-(50|100)(\/\d+)?|border-(rose|red|amber|emerald|green)-\d{3}|rounded-xl|rounded-2xl|shadow(-sm|-md|-lg)?)(\s|$)/;

function boxesInside(element: Element, except?: Element): Array<string> {
  return [element, ...Array.from(element.querySelectorAll("*"))]
    .filter((node: Element): boolean => {
      return (
        !except?.contains(node) &&
        BOX_CLASS.test(node.getAttribute("class") || "")
      );
    })
    .map((node: Element): string => {
      return `<${node.tagName.toLowerCase()} class="${node.getAttribute("class")}">`;
    });
}

function section(): HTMLElement {
  return screen.getByTestId("investigation-conversation");
}

function chipLabels(): Array<string> {
  return within(screen.getByTestId("investigation-conversation-empty"))
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
}

describe("InvestigationConversation — a section of the card", () => {
  test("opens with the card's own heading and description styles, and no icon tile", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    expect(section()).toHaveAttribute(
      "aria-label",
      "Conversation with OneUptime AI",
    );
    // A hairline above it, like every other section of the card.
    expect(section()).toHaveClass("border-t", "border-gray-200", "pt-5");

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "Ask OneUptime AI",
    });
    // Exactly the heading the card's other rows use.
    expect(heading.className).toBe("text-sm font-semibold text-gray-900");
    expect(heading.nextElementSibling).toHaveClass(
      "mt-1",
      "text-xs",
      "leading-5",
      "text-gray-500",
    );

    // The old header: an indigo tile with a chat icon in front of the title.
    expect(heading.parentElement!.querySelector("svg")).toBeNull();
    expect(section().querySelector(".bg-indigo-50")).toBeNull();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  test("an empty thread draws no panel: chips and the composer only", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    // The composer is a control: its frame is what shows the text box.
    expect(
      boxesInside(
        section(),
        screen.getByTestId("investigation-conversation-composer"),
      ),
    ).toEqual([]);
    // The sentence that only said the thread was empty is gone.
    expect(screen.queryByText(/Nobody has asked anything yet/)).toBeNull();
  });

  test.each([
    [
      "reported",
      "incident",
      "Ask a follow-up question, or ask it to act. Everyone on this incident sees this conversation.",
    ],
    [
      "none",
      "incident",
      "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
    ],
    [
      "underway",
      "alert",
      "Ask a question about this alert, or ask it to act. Everyone on this alert sees this conversation.",
    ],
    [
      "checking",
      "alert",
      "Ask a question about this alert, or ask it to act. Everyone on this alert sees this conversation.",
    ],
    [
      undefined,
      "incident",
      "Ask a question about this incident, or ask it to act. Everyone on this incident sees this conversation.",
    ],
  ] as Array<[AIInvestigationStage | undefined, "incident" | "alert", string]>)(
    "with the investigation %s on an %s it says what it is for",
    async (
      stage: AIInvestigationStage | undefined,
      subjectType: "incident" | "alert",
      description: string,
    ) => {
      routeResponses({});

      renderConversation({
        subjectType,
        subjectId: subjectType === "alert" ? ALERT_ID : INCIDENT_ID,
        ...(stage ? { stage } : {}),
      });
      await flush();

      expect(
        screen.getByRole("heading", { level: 3 }).nextElementSibling,
      ).toHaveTextContent(description);
    },
  );
});

describe("InvestigationConversation — what it suggests", () => {
  test("leads with the root-cause question when the card has no report", async () => {
    routeResponses({});

    renderConversation({ stage: "none" });
    await flush();

    expect(chipLabels()).toEqual([
      "What is the root cause?",
      "What should I do right now?",
      "What changed just before this?",
      "Is anything else affected?",
      "Draft a status update",
      "Acknowledge this incident",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "What is the root cause?" }),
    );
    await flush();

    // A question: asked on the click, never parked in the composer.
    expect(
      requests("/ai-investigation/conversation/send-message")[0]!.data[
        "content"
      ],
    ).toBe(
      "What is the most likely root cause of this incident? Investigate it and cite the evidence.",
    );
  });

  test.each([["reported"], ["underway"], [undefined]] as Array<
    [AIInvestigationStage | undefined]
  >)(
    "does not offer it while the investigation is %s",
    async (stage: AIInvestigationStage | undefined) => {
      routeResponses({});

      renderConversation(stage ? { stage } : {});
      await flush();

      expect(chipLabels()).toEqual([
        "What should I do right now?",
        "What changed just before this?",
        "Is anything else affected?",
        "Draft a status update",
        "Acknowledge this incident",
      ]);
    },
  );

  test("waits for the card to know before it suggests anything", async () => {
    routeResponses({});

    const view: ReturnType<typeof render> = renderConversation({
      stage: "checking",
    });
    await flush();

    // The thread has loaded (and is empty), but the card is still asking.
    expect(requests("/ai-investigation/conversation")).toHaveLength(1);
    expect(screen.getByText("Loading the conversation…")).toBeVisible();
    expect(screen.queryByTestId("investigation-conversation-empty")).toBeNull();
    // The composer is there throughout: asking never waits.
    expect(composer()).toBeVisible();

    view.rerender(
      <InvestigationConversation
        subjectType="incident"
        subjectId={INCIDENT_ID}
        investigationStage="none"
      />,
    );
    await flush();

    expect(screen.queryByText("Loading the conversation…")).toBeNull();
    // All six arrive together: nothing is squeezed in front of the others.
    expect(chipLabels()[0]).toBe("What is the root cause?");
    expect(chipLabels()).toHaveLength(6);
  });

  test("a thread with messages does not wait for the card", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: [
            question({
              id: "q1",
              content: "Is the pool exhausted?",
              userId: PRIYA,
              name: "Priya Shah",
            }),
          ],
        });
      },
    });

    renderConversation({ stage: "checking" });
    await flush();

    expect(screen.getByText("Is the pool exhausted?")).toBeVisible();
    expect(screen.queryByText("Loading the conversation…")).toBeNull();
  });

  test("questions are plain chips; only a request to act carries a mark", async () => {
    routeResponses({});

    renderConversation({ stage: "none" });
    await flush();

    const group: HTMLElement = screen.getByRole("group", {
      name: "Suggested questions",
    });
    expect(group).toBe(screen.getByTestId("investigation-conversation-empty"));

    const chips: Array<HTMLElement> = within(group).getAllByRole("button");
    const marked: Array<string> = chips
      .filter((chip: HTMLElement): boolean => {
        return chip.querySelector("svg") !== null;
      })
      .map((chip: HTMLElement): string => {
        return chip.textContent || "";
      });

    expect(marked).toEqual(["Acknowledge this incident"]);
    expect(
      chips.map((chip: HTMLElement): string | null => {
        return chip.getAttribute("data-suggestion-kind");
      }),
    ).toEqual([
      "question",
      "question",
      "question",
      "question",
      "question",
      "action",
    ]);
  });

  test("the suggestions leave once someone has asked", async () => {
    let asked: boolean = false;
    routeResponses({
      thread: () => {
        return asked
          ? threadResponse({
              messages: [
                question({
                  id: "q1",
                  content: "What changed?",
                  userId: SAM,
                  name: "Sam Lee",
                }),
              ],
            })
          : EMPTY;
      },
      send: () => {
        asked = true;
        return { data: { assistantMessageId: ANSWER_ID, aiRunId: RUN_ID } };
      },
    });

    renderConversation({ stage: "none" });
    await flush();
    fireEvent.click(
      screen.getByRole("button", { name: "What changed just before this?" }),
    );
    await flush();

    expect(screen.queryByTestId("investigation-conversation-empty")).toBeNull();
    expect(screen.getByRole("log")).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * A long thread
 * ---------------------------------------------------------------------------
 * The thread used to sit in a 40rem box that scrolled inside the card, cut
 * mid-line at both ends. It is part of the page now, like the report, so a
 * long one opens on its newest messages instead.
 */
function exchanges(
  count: number,
  askers: Array<[string, string]> = [[PRIYA, "Priya Shah"]],
): Array<JSONObject> {
  const messages: Array<JSONObject> = [];

  for (let index: number = 1; index <= count; index++) {
    const [userId, name] = askers[(index - 1) % askers.length]!;
    messages.push(
      question({
        id: `q${index}`,
        content: `Question ${index}`,
        userId,
        name,
      }),
      answer({
        id: `a${index}`,
        content: `Answer ${index}`,
        userId,
        name,
      }),
    );
  }

  return messages;
}

function shownMessages(): Array<string> {
  return within(screen.getByRole("log"))
    .getAllByText(/^(Question|Answer) \d+$/)
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

function showEarlier(): HTMLElement | null {
  return screen.queryByTestId("investigation-conversation-show-earlier");
}

describe("InvestigationConversation — a long thread", () => {
  test("the fold keeps the last three exchanges of a thread longer than four", () => {
    expect(THREAD_TAIL_LENGTH).toBe(6);
    expect(THREAD_FOLD_ABOVE_LENGTH).toBe(8);
  });

  test("opens on its newest messages, with the earlier ones one click away", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({ messages: exchanges(6) });
      },
    });

    renderConversation();
    await flush();

    expect(shownMessages()).toEqual([
      "Question 4",
      "Answer 4",
      "Question 5",
      "Answer 5",
      "Question 6",
      "Answer 6",
    ]);
    expect(showEarlier()).toHaveTextContent("Show 6 earlier messages");
    // Above the thread it unfolds.
    expect(
      showEarlier()!.compareDocumentPosition(screen.getByRole("log")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("showing the earlier messages reveals them all and hands focus to the thread", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({ messages: exchanges(6) });
      },
    });

    renderConversation();
    await flush();

    showEarlier()!.focus();
    fireEvent.click(showEarlier()!);
    await flush();

    expect(shownMessages()).toHaveLength(12);
    expect(shownMessages()[0]).toBe("Question 1");
    expect(showEarlier()).toBeNull();
    // The button that had focus is gone: the thread it revealed takes it.
    expect(document.activeElement).toBe(screen.getByRole("log"));
  });

  test("never opens on an answer whose question is folded away", async () => {
    // Nine messages: the cut would start on Answer 2.
    const messages: Array<JSONObject> = [
      ...exchanges(4),
      question({
        id: "q5",
        content: "Question 5",
        userId: SAM,
        name: "Sam Lee",
      }),
    ];
    routeResponses({
      thread: () => {
        return threadResponse({ messages });
      },
    });

    renderConversation();
    await flush();

    expect(shownMessages()[0]).toBe("Question 2");
    expect(shownMessages()).toHaveLength(7);
    expect(showEarlier()).toHaveTextContent("Show 2 earlier messages");
  });

  test.each([[1], [2], [4]])(
    "a thread of %i exchanges is shown whole",
    async (count: number) => {
      routeResponses({
        thread: () => {
          return threadResponse({ messages: exchanges(count) });
        },
      });

      renderConversation();
      await flush();

      expect(shownMessages()).toHaveLength(count * 2);
      expect(showEarlier()).toBeNull();
    },
  );

  test("a thread that stays unfolded keeps showing new messages", async () => {
    let count: number = 6;
    routeResponses({
      thread: () => {
        return threadResponse({ messages: exchanges(count) });
      },
    });

    renderConversation();
    await flush();
    fireEvent.click(showEarlier()!);
    await flush();

    count = 7;
    await tick(THREAD_POLL_IDLE_MS);

    expect(shownMessages()).toHaveLength(14);
    expect(showEarlier()).toBeNull();
  });

  test("the next incident's thread opens folded again", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({ messages: exchanges(6) });
      },
    });

    const view: ReturnType<typeof render> = renderConversation();
    await flush();
    fireEvent.click(showEarlier()!);
    await flush();
    expect(showEarlier()).toBeNull();

    view.rerender(
      <InvestigationConversation
        subjectType="incident"
        subjectId={new ObjectID("99999999-9999-4999-8999-999999999999")}
      />,
    );
    await flush();

    expect(showEarlier()).toHaveTextContent("Show 6 earlier messages");
    expect(shownMessages()).toHaveLength(6);
  });

  test("the thread is part of the page, not a scrolling box inside the card", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({ messages: exchanges(6) });
      },
    });

    renderConversation();
    await flush();

    const SCROLLER_CLASS: RegExp =
      /(^|\s)(overflow-(y-)?(auto|scroll)|overscroll-\S+|max-h-\S+)(\s|$)/;
    const scrollers: Array<Element> = Array.from(
      section().querySelectorAll("*"),
    ).filter((element: Element): boolean => {
      return (
        element.tagName !== "TEXTAREA" &&
        SCROLLER_CLASS.test(element.getAttribute("class") || "")
      );
    });

    expect(scrollers).toEqual([]);
  });

  test("names everyone who asked, four marks and how many more", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: exchanges(6, [
            [PRIYA, "Priya Shah"],
            [SAM, "Sam Lee"],
            ["aaaaaaaa-0000-4000-8000-000000000003", "Jordan Patel"],
            ["aaaaaaaa-0000-4000-8000-000000000004", "Alex Kim"],
            ["aaaaaaaa-0000-4000-8000-000000000005", "Diego Santos"],
            ["aaaaaaaa-0000-4000-8000-000000000006", "Mei Tan"],
          ]),
        });
      },
    });

    renderConversation();
    await flush();

    // Counted over the whole thread, folded messages included.
    const participants: HTMLElement = screen.getByLabelText(
      "6 people have asked in this conversation",
    );
    expect(participants).toHaveAttribute(
      "title",
      "Priya Shah, You, Jordan Patel, Alex Kim, Diego Santos, Mei Tan",
    );
    expect(participants).toHaveTextContent("PSSLJPAK+2");
    // Initials overlap by 4px at most, so none hides the next one's letters.
    expect(participants.firstElementChild).toHaveClass("-space-x-1");
  });
});

/*
 * ---------------------------------------------------------------------------
 * An answer's parts
 * ---------------------------------------------------------------------------
 * The parts of an answer used to arrive as boxes: gray steps, a red error,
 * bordered action rows and bordered source pills. They are lines of the
 * answer now. Two things keep a frame on purpose: a chart or table, and an
 * action waiting for someone to approve it.
 */
describe("InvestigationConversation — an answer's parts", () => {
  const citations: Array<JSONObject> = [
    {
      id: "C1",
      toolName: "query_metrics",
      label: "db.client.connections.usage for orders-db",
      queryArguments: {},
      rowCount: 45,
      target: { type: "Metrics" },
    },
    {
      id: "C2",
      toolName: "search_logs",
      label: 'Logs matching "pool timeout" in cart-api',
      queryArguments: {},
      rowCount: 0,
      target: { type: "Logs" },
    },
    {
      id: "C3",
      toolName: "run_kubectl",
      label: 'kubectl top pods -A on cluster "prod"',
      queryArguments: {},
      rowCount: 1,
    },
  ];

  function renderAnswer(data: Parameters<typeof answer>[0]): void {
    routeResponses({
      thread: () => {
        return threadResponse({ messages: [answer(data)] });
      },
    });
    renderConversation();
  }

  test("lists its sources: the mark its text carries, what was read and how much came back", async () => {
    renderAnswer({
      content: "The pool is exhausted [C1], cart-api is fine [C2] [C3].",
      userId: SAM,
      name: "Sam Lee",
      citations,
    });
    await flush();

    const sources: HTMLElement = screen.getByTestId(
      "investigation-conversation-sources",
    );
    expect(
      within(sources).getByRole("heading", { level: 4, name: "Sources" }),
    ).toBeVisible();
    expect(
      within(sources)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual([
      "C1db.client.connections.usage for orders-db · 45 rows",
      'C2Logs matching "pool timeout" in cart-api · no rows',
      'C3kubectl top pods -A on cluster "prod" · 1 row',
    ]);
    /*
     * A quiet list. The Ask AI panel draws each source as a bordered,
     * rounded-full pill; the only shape here is the small C# mark.
     */
    const PILL_CLASS: RegExp = /(^|\s)(border|rounded-full|shadow\S*)(\s|$)/;
    expect(
      Array.from(sources.querySelectorAll("*")).filter(
        (element: Element): boolean => {
          return PILL_CLASS.test(element.getAttribute("class") || "");
        },
      ),
    ).toEqual([]);
    expect(
      Array.from(sources.querySelectorAll(".bg-gray-100")).map(
        (mark: Element): string => {
          return mark.textContent || "";
        },
      ),
    ).toEqual(["C1", "C2", "C3"]);
  });

  test("a source with a page of its own opens it; one without is not a button", async () => {
    renderAnswer({
      content: "The pool is exhausted [C1].",
      userId: SAM,
      name: "Sam Lee",
      citations,
    });
    await flush();

    const sources: HTMLElement = screen.getByTestId(
      "investigation-conversation-sources",
    );
    const buttons: Array<HTMLElement> = within(sources).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute(
      "title",
      "db.client.connections.usage for orders-db",
    );
    // Zero rows is a finding: the query ran and found nothing.
    expect(buttons[1]).toHaveAttribute(
      "title",
      'Logs matching "pool timeout" in cart-api — checked, found nothing',
    );

    fireEvent.click(buttons[1]!);
    expect(navigateToCitationTargetMock).toHaveBeenCalledWith({
      type: "Logs",
    });

    const kubectl: HTMLElement = sources.querySelector(
      '[data-citation-id="C3"]',
    ) as HTMLElement;
    expect(within(kubectl).queryByRole("button")).toBeNull();
    expect(kubectl.firstElementChild).toHaveAttribute(
      "title",
      'kubectl top pods -A on cluster "prod"',
    );
  });

  test("an answer without citations has no sources list", async () => {
    renderAnswer({ content: "Nothing to cite.", userId: SAM, name: "Sam Lee" });
    await flush();

    expect(
      screen.queryByTestId("investigation-conversation-sources"),
    ).toBeNull();
  });

  test.each([
    [AIChatToolActionStatus.Executed, "Done", "text-emerald-600"],
    [AIChatToolActionStatus.Approved, "Approved", "text-emerald-600"],
    [AIChatToolActionStatus.Failed, "Failed", "text-red-600"],
    [AIChatToolActionStatus.Denied, "Denied", "text-gray-400"],
    [AIChatToolActionStatus.Skipped, "Skipped", "text-gray-400"],
  ])(
    "an action that is %s is a line: a mark, what it was and %s",
    async (
      status: AIChatToolActionStatus,
      label: string,
      markClassName: string,
    ) => {
      renderAnswer({
        content: "Here is what I did.",
        userId: SAM,
        name: "Sam Lee",
        toolActions: [
          {
            id: "call-1",
            toolName: "acknowledge_incident",
            title: "Acknowledge incident #42",
            arguments: { incidentNumber: 42 },
            isMutation: true,
            requiresApproval: false,
            status,
          },
        ],
      });
      await flush();

      const actions: HTMLElement = screen.getByRole("list", {
        name: "Actions",
      });
      const line: HTMLElement = within(actions).getByRole("listitem");
      expect(line).toHaveTextContent(`Acknowledge incident #42 · ${label}`);
      expect(line).toHaveAttribute("data-status", status);
      expect(line.querySelector("svg")).toHaveClass(markClassName);
      // No bordered row, no coloured chip, and nothing to press.
      expect(boxesInside(actions)).toEqual([]);
      expect(within(actions).queryByRole("button")).toBeNull();
      expect(
        screen.queryByRole("group", { name: "Actions waiting for approval" }),
      ).toBeNull();
    },
  );

  test("only an action someone has to decide on gets the approval prompt", async () => {
    renderAnswer({
      status: AIChatMessageStatus.WaitingForApproval,
      userId: PRIYA,
      name: "Priya Shah",
      toolActions: [
        {
          id: "call-1",
          toolName: "add_note",
          title: "Add a private note",
          arguments: {},
          isMutation: true,
          requiresApproval: false,
          status: AIChatToolActionStatus.Executed,
        },
        {
          id: "call-2",
          toolName: "acknowledge_incident",
          title: "Acknowledge incident #42",
          arguments: {},
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Pending,
        },
      ],
    });
    await flush();

    // One action is waiting, so the sentence is about one.
    expect(
      screen.getByText(
        "I'd like to take this action. Review it and approve to continue.",
      ),
    ).toBeVisible();

    expect(screen.getByRole("list", { name: "Actions" })).toHaveTextContent(
      "Add a private note · Done",
    );
    expect(screen.getByRole("list", { name: "Actions" })).not.toHaveTextContent(
      "Acknowledge incident #42",
    );

    const prompt: HTMLElement = screen.getByRole("group", {
      name: "Actions waiting for approval",
    });
    expect(prompt).toHaveTextContent("Acknowledge incident #42");
    expect(prompt).not.toHaveTextContent("Add a private note");

    fireEvent.click(
      within(prompt).getByRole("button", { name: /Run 1 action/ }),
    );
    await flush();

    expect(
      requests("/ai-investigation/conversation/respond-to-approval")[0]!.data[
        "decisions"
      ],
    ).toEqual([{ toolCallId: "call-2", approved: true }]);
  });

  test("two actions waiting are asked about together", async () => {
    renderAnswer({
      status: AIChatMessageStatus.WaitingForApproval,
      userId: PRIYA,
      name: "Priya Shah",
      toolActions: ["call-1", "call-2"].map((id: string): JSONObject => {
        return {
          id,
          toolName: "acknowledge_incident",
          title: `Action ${id}`,
          arguments: {},
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Pending,
        };
      }),
    });
    await flush();

    expect(
      screen.getByText(
        "I'd like to take these actions. Review them and approve to continue.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list", { name: "Actions" })).toBeNull();
  });

  test("a failed answer is a line with a red mark, not a red box", async () => {
    renderAnswer({
      status: AIChatMessageStatus.Error,
      errorMessage: "The AI provider is unavailable.",
      userId: SAM,
      name: "Sam Lee",
    });
    await flush();

    const failure: HTMLElement = screen.getByTestId(
      "investigation-conversation-answer-error",
    );
    expect(failure).toHaveTextContent(
      "The AI provider is unavailable.Ask again to retry.",
    );
    expect(failure.querySelector("svg")).toHaveClass("text-red-600");
    expect(boxesInside(failure)).toEqual([]);
    expect(failure.className).not.toMatch(/border|rounded|bg-/);
  });

  test("a failed answer without a reason still says something", async () => {
    renderAnswer({
      status: AIChatMessageStatus.Error,
      userId: SAM,
      name: "Sam Lee",
    });
    await flush();

    expect(
      screen.getByText("Something went wrong while answering."),
    ).toBeVisible();
  });

  test("a stopped answer says so, and falls back to 'Stopped.'", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          messages: [
            answer({
              id: "a1",
              status: AIChatMessageStatus.Cancelled,
              userId: SAM,
              name: "Sam Lee",
            }),
          ],
        });
      },
    });
    renderConversation();
    await flush();

    const stopped: HTMLElement = screen.getByText("Stopped.");
    expect(stopped.tagName).toBe("P");
    // The mark sits beside the sentence, never inside the paragraph.
    expect(stopped.querySelector("div")).toBeNull();
    expect(stopped.parentElement!.querySelector("svg")).not.toBeNull();
  });

  test("the steps of an answer being written hang from a rule, with no box", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          isBusy: true,
          messages: [
            answer({
              status: AIChatMessageStatus.InProgress,
              userId: PRIYA,
              name: "Priya Shah",
            }),
          ],
          activeRun: {
            aiRunId: RUN_ID,
            assistantMessageId: ANSWER_ID,
            status: AIRunStatus.Running,
            events: [
              {
                _id: "88888888-8888-4888-8888-888888888888",
                sequence: 1,
                eventType: AIRunEventType.ToolCallStarted,
                toolName: "search_logs",
              },
            ],
          },
        });
      },
    });
    renderConversation();
    await flush();

    const steps: HTMLElement = screen.getByTestId(
      "investigation-conversation-live-steps",
    );
    expect(steps.className).toBe("border-l-2 border-gray-200 pl-3");
    expect(steps).toContainElement(screen.getByTestId("live-steps"));
    // The feed draws the steps only: the card frames nothing around them.
    expect(activityFeedMock.mock.calls[0]![0]).toMatchObject({
      hideChrome: true,
      showLiveIndicator: false,
      maxVisibleSteps: 8,
    });
  });

  test("the steps belong to the answer being written, not to an earlier one", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          isBusy: true,
          messages: [
            answer({
              id: "a-old",
              content: "An earlier answer.",
              userId: PRIYA,
              name: "Priya Shah",
            }),
            answer({
              id: "a-new",
              status: AIChatMessageStatus.InProgress,
              userId: SAM,
              name: "Sam Lee",
            }),
          ],
          activeRun: {
            aiRunId: RUN_ID,
            assistantMessageId: "a-new",
            status: AIRunStatus.Running,
            events: [
              {
                _id: "88888888-8888-4888-8888-888888888888",
                sequence: 1,
                eventType: AIRunEventType.ToolCallStarted,
                toolName: "search_logs",
              },
            ],
          },
        });
      },
    });
    renderConversation();
    await flush();

    const answers: Array<HTMLElement> = screen.getAllByTestId(
      "investigation-conversation-answer",
    );
    expect(within(answers[0]!).queryByTestId("live-steps")).toBeNull();
    expect(within(answers[1]!).getByTestId("live-steps")).toBeVisible();
    expect(answers[1]).toHaveAttribute("data-status", "InProgress");
  });

  test("charts and tables are a named group of the answer", async () => {
    renderAnswer({
      content: "For me.",
      userId: SAM,
      name: "Sam Lee",
      widgets: [{ id: "W1", type: "Table", title: "Top pods", data: {} }],
    });
    await flush();

    expect(
      screen.getByRole("group", { name: "Data from this answer" }),
    ).toContainElement(screen.getByTestId("answer-widgets"));
  });

  test("the parts follow one order: text, data, actions, sources, copy", async () => {
    renderAnswer({
      content: "Done [C1].",
      userId: SAM,
      name: "Sam Lee",
      citations,
      widgets: [{ id: "W1", type: "Table", title: "Top pods", data: {} }],
      toolActions: [
        {
          id: "call-1",
          toolName: "acknowledge_incident",
          title: "Acknowledge incident #42",
          arguments: {},
          isMutation: true,
          requiresApproval: false,
          status: AIChatToolActionStatus.Executed,
        },
      ],
    });
    await flush();

    const parts: Array<HTMLElement> = [
      screen.getByTestId("answer-markdown"),
      screen.getByTestId("answer-widgets"),
      screen.getByRole("list", { name: "Actions" }),
      screen.getByTestId("investigation-conversation-sources"),
      screen.getByRole("button", { name: "Copy" }),
    ];

    for (let index: number = 1; index < parts.length; index++) {
      expect(
        parts[index - 1]!.compareDocumentPosition(parts[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test("OneUptime AI's mark is the page's solid indigo sparkle", async () => {
    renderAnswer({ content: "Hello.", userId: SAM, name: "Sam Lee" });
    await flush();

    const mark: Element = screen
      .getByTestId("investigation-conversation-answer")
      .querySelector('[aria-hidden="true"]')!;

    expect(mark).toHaveClass("rounded-full", "bg-indigo-600", "text-white");
    expect(mark.className).not.toMatch(/gradient|violet/);
  });

  test("nothing in a full thread nests a block inside a paragraph", async () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      routeResponses({
        thread: () => {
          return threadResponse({
            messages: [
              question({
                id: "q1",
                content: "What happened?",
                userId: PRIYA,
                name: "Priya Shah",
              }),
              answer({
                id: "a1",
                content: "The pool ran dry [C1].",
                userId: PRIYA,
                name: "Priya Shah",
                citations,
                toolActions: [
                  {
                    id: "call-1",
                    toolName: "acknowledge_incident",
                    title: "Acknowledge incident #42",
                    arguments: {},
                    isMutation: true,
                    requiresApproval: false,
                    status: AIChatToolActionStatus.Failed,
                  },
                ],
              }),
              answer({
                id: "a2",
                status: AIChatMessageStatus.Error,
                errorMessage: "The AI provider is unavailable.",
                userId: SAM,
                name: "Sam Lee",
              }),
              answer({
                id: "a3",
                status: AIChatMessageStatus.Cancelled,
                content: "Stopped by Sam.",
                userId: SAM,
                name: "Sam Lee",
              }),
            ],
          });
        },
      });
      renderConversation();
      await flush();

      expect(section().querySelectorAll("p div")).toHaveLength(0);
      expect(
        consoleError.mock.calls.some((args: Array<unknown>): boolean => {
          return args.some((value: unknown): boolean => {
            return (
              typeof value === "string" && value.includes("validateDOMNesting")
            );
          });
        }),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("InvestigationConversation — when something does not go through", () => {
  function refuse(message: string): void {
    routeResponses({
      send: () => {
        return new HTTPErrorResponse(400, { message }, {});
      },
    });
    getFriendlyMessageMock.mockReturnValue(message);
  }

  test("a refused question is said in the card's notice, which can be put away", async () => {
    refuse("AI is turned off for this project.");

    renderConversation();
    await flush();
    fireEvent.change(composer(), { target: { value: "What happened?" } });
    fireEvent.click(sendButton());
    await flush();

    const notice: HTMLElement = screen.getByTestId(
      "investigation-conversation-error",
    );
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent("AI is turned off for this project.");
    expect(notice.querySelector("svg")).toHaveClass("text-red-600");
    // A line with a mark: it was a red box between the thread and the box.
    expect(boxesInside(notice)).toEqual([]);
    // Straight above the composer it is about.
    expect(notice.nextElementSibling).toBe(
      screen.getByTestId("investigation-conversation-composer"),
    );

    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByTestId("investigation-conversation-error")).toBeNull();
    // Nothing typed is lost by any of it.
    expect(composer().value).toBe("What happened?");
  });

  test("asking again clears the last refusal", async () => {
    let refused: boolean = true;
    routeResponses({
      send: () => {
        return refused
          ? new HTTPErrorResponse(400, { message: "Busy." }, {})
          : { data: { assistantMessageId: ANSWER_ID, aiRunId: RUN_ID } };
      },
    });
    getFriendlyMessageMock.mockReturnValue("Busy.");

    renderConversation();
    await flush();
    fireEvent.change(composer(), { target: { value: "What happened?" } });
    fireEvent.click(sendButton());
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Busy.");

    refused = false;
    fireEvent.click(sendButton());
    await flush();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a thread that cannot be loaded keeps the composer usable", async () => {
    postMock.mockImplementation((() => {
      return Promise.resolve(
        new HTTPErrorResponse(500, { message: "Server error" }, {}),
      );
    }) as never);
    getFriendlyMessageMock.mockReturnValue("Server error");

    renderConversation();
    await flush();

    expect(
      screen.getByText("Could not load the conversation: Server error"),
    ).toBeVisible();
    expect(screen.queryByTestId("investigation-conversation-empty")).toBeNull();
    expect(composer()).toBeEnabled();
    expect(
      screen.getByRole("heading", { level: 3, name: "Ask OneUptime AI" }),
    ).toBeVisible();
  });
});

describe("InvestigationConversation — the composer in the card", () => {
  test("is one control: the text, the mode with what it means, and Send", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    const frame: HTMLElement = screen.getByTestId(
      "investigation-conversation-composer",
    );
    expect(within(frame).getByRole("textbox")).toHaveAccessibleName(
      "Ask OneUptime AI",
    );
    expect(composer()).toHaveAttribute(
      "placeholder",
      "Ask about this incident, or ask OneUptime AI to act…",
    );
    expect(
      within(frame).getByTitle("Choose what the AI is allowed to do"),
    ).toHaveTextContent("Auto-run");
    expect(
      within(frame).getByTestId("investigation-conversation-mode"),
    ).toHaveTextContent(
      "Acts on clear requests right away, within your permissions.",
    );
    expect(within(frame).getByTitle("Send (Enter)")).toBeDisabled();
    // It is the last thing in the section, and so in the card.
    expect(section().lastElementChild).toBe(frame);
  });

  test("the mode's menu opens from the picker's own left edge", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    const picker: HTMLElement = screen.getByTitle(
      "Choose what the AI is allowed to do",
    );
    expect(picker).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(picker);

    const menu: HTMLElement = screen.getByRole("menu", {
      name: "AI permissions",
    });
    /*
     * The picker is at the composer's left end: lined up on its right edge
     * the menu (wider than the button) would open out of the card.
     */
    expect(menu).toHaveClass("left-0");
    expect(menu).not.toHaveClass("right-0");
    expect(picker).toHaveAttribute("aria-expanded", "true");
  });

  test("Send lights up with something to send and goes back when it is sent", async () => {
    routeResponses({});

    renderConversation();
    await flush();

    expect(sendButton()).toHaveClass("bg-gray-100", "text-gray-400");

    fireEvent.change(composer(), { target: { value: "  " } });
    expect(sendButton()).toBeDisabled();

    fireEvent.change(composer(), { target: { value: "What happened?" } });
    expect(sendButton()).toBeEnabled();
    // The page's own primary colour, not the Ask AI panel's black.
    expect(sendButton()).toHaveClass("bg-indigo-600", "text-white");

    fireEvent.click(sendButton());
    await flush();

    expect(composer().value).toBe("");
    expect(sendButton()).toBeDisabled();
  });

  test("while an answer is written, Send becomes Stop and typing still works", async () => {
    routeResponses({
      thread: () => {
        return threadResponse({
          isBusy: true,
          messages: [
            answer({
              status: AIChatMessageStatus.InProgress,
              userId: PRIYA,
              name: "Priya Shah",
            }),
          ],
        });
      },
    });

    renderConversation();
    await flush();

    expect(screen.queryByTitle("Send (Enter)")).toBeNull();
    expect(screen.getByTitle("Stop generating")).toBeEnabled();

    fireEvent.change(composer(), { target: { value: "And the node?" } });
    expect(composer().value).toBe("And the node?");
  });
});
