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
 * The conversation inside the AI investigation box, rendered for real with
 * only the network, markdown and heavy chat widgets stubbed. It drives the
 * component the way responders will: asking from a suggestion, typing,
 * seeing who asked what, watching an answer being written, approving an
 * action, stopping an answer, and choosing how much the AI may do.
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationChips",
  () => {
    return {
      __esModule: true,
      default: (props: {
        citations: Array<{ id: string; label: string }>;
      }): React.ReactElement => {
        return React.createElement(
          "ul",
          { "data-testid": "answer-sources" },
          props.citations.map((citation: { id: string; label: string }) => {
            return React.createElement(
              "li",
              { key: citation.id },
              citation.label,
            );
          }),
        );
      },
    };
  },
);

import InvestigationConversation from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationConversation/InvestigationConversation";
import {
  THREAD_PERMISSION_MODE_STORAGE_KEY,
  THREAD_POLL_BUSY_MS,
  THREAD_POLL_IDLE_MS,
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
  variant?: "embedded" | "card";
}): ReturnType<typeof render> {
  return render(
    <InvestigationConversation
      subjectType={data?.subjectType || "incident"}
      subjectId={data?.subjectId || INCIDENT_ID}
      variant={data?.variant}
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

  test("stands as its own card when asked to", async () => {
    routeResponses({});

    renderConversation({ variant: "card" });
    await flush();

    expect(screen.getByTestId("card")).toBeInTheDocument();
    expect(screen.getAllByText("Ask OneUptime AI").length).toBeGreaterThan(0);
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
      screen.getByText(
        "OneUptime AI only reads and answers — it never changes anything.",
      ),
    ).toBeVisible();
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
      screen.getByText("OneUptime AI asks before it changes anything."),
    ).toBeVisible();
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
    expect(within(reply).getByTestId("answer-sources")).toHaveTextContent(
      'kubectl top pods -A on cluster "prod"',
    );

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
