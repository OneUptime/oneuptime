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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  MemoryRouter,
  NavigateFunction,
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AIConversation from "../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import AIChatMessageRole from "../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../Types/AI/AIChatMessageStatus";
import AIChatPageContextType from "../../../Types/AI/AIChatPageContext";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
} from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";
import AskAiDialog from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiDialog";
import { openAskAi } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiEvents";
import { PAGE_START_ALIGN_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/TitleDirection";
import AskAI from "../../../../App/FeatureSet/Dashboard/src/Components/Header/AskAI";
import AICopilot from "../../../../App/FeatureSet/Dashboard/src/Pages/AICopilot/AICopilot";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * ASK AI ON THE MAIN STAGE.
 *
 * The maintainer, of Ask AI: "It is very clunky to use currently, and it
 * shows up on the side. Please let it take the main stage: open a modal
 * with a blurred background [...] The ask AI is very noisy as well."
 *
 * These tests render the REAL dialog the Dashboard mounts once at its root
 * (AskAiDialog), with the hook, the start, the composer, the conversation
 * and the history it draws, over a page in a router, and replace only the
 * network: the API, the model API, the project and the realtime socket.
 * They hold:
 *
 *   - every way in: the header's Ask AI, Ctrl/Cmd + I, the command
 *     palette's plain toggle, a page's prepared question, a conversation,
 *     a request made before the dialog listened, and the chat's own
 *     address, which opens the dialog over the page the person came from;
 *   - a real dialog: focus in, kept in, given back; Esc; the page behind
 *     inert and still; a click beside it;
 *   - what it is about: the page's context pill, cleared and brought back,
 *     and the page's own suggestions;
 *   - quiet answers: one live line that opens into its steps, sources, the
 *     time and the actions on one row, a failed answer asked again, an
 *     approval decided inside the dialog;
 *   - closing loses nothing: the history, and the way back to an answer
 *     still being written.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID: string = "55555555-5555-4555-8555-555555555555";
const OTHER_CONVERSATION_ID: string = "66666666-6666-4666-8666-666666666666";
const RUN_ID: string = "77777777-7777-4777-8777-777777777777";

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "Could not reach the server.";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteItemMock(...args);
      },
      getCommonHeaders: () => {
        return { tenantid: PROJECT_ID };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID(PROJECT_ID);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToModelEvent: () => {
        return () => {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: () => {},
    },
  };
});

// The PDF and Markdown exporter, which these tests do not use.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatDownloadMenu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIPlanGate",
  () => {
    return {
      __esModule: true,
      isAIAccessibleOnCurrentPlan: () => {
        return true;
      },
      default: () => {
        return null;
      },
    };
  },
);

// ---- what the server holds ---------------------------------------------------

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
}

interface FakeServer {
  conversations: Array<AIConversation>;
  messages: Map<string, Array<AIConversationMessage>>;
  events: Array<AIRunEvent>;
  run: AIRun | null;
  providerCount: number;
}

let server: FakeServer;
let navigate: NavigateFunction;

function conversation(id: string, title: string): AIConversation {
  const item: AIConversation = new AIConversation();
  item.id = new ObjectID(id);
  item.title = title;
  item.lastMessageAt = new Date(Date.now() - 60 * 60 * 1000);
  return item;
}

function message(data: {
  id: string;
  role: AIChatMessageRole;
  content: string;
  status?: AIChatMessageStatus | undefined;
  citations?: Array<AIChatCitation> | undefined;
  toolActions?: Array<AIChatToolAction> | undefined;
  errorMessage?: string | undefined;
  aiRunId?: string | undefined;
}): AIConversationMessage {
  const item: AIConversationMessage = new AIConversationMessage();
  item.id = new ObjectID(data.id);
  item.role = data.role;
  item.contentInMarkdown = data.content;
  item.status = data.status || AIChatMessageStatus.Completed;
  item.citations = data.citations || [];
  item.widgets = [];
  item.toolActions = data.toolActions || [];
  item.createdAt = new Date(Date.now() - 5 * 60 * 1000);

  if (data.errorMessage) {
    item.errorMessage = data.errorMessage;
  }

  if (data.aiRunId) {
    item.aiRunId = new ObjectID(data.aiRunId);
  }

  return item;
}

function runEvent(
  sequence: number,
  eventType: AIRunEventType,
  toolName?: string,
): AIRunEvent {
  const item: AIRunEvent = new AIRunEvent();
  item.id = new ObjectID(
    `88888888-8888-4888-8888-${String(sequence).padStart(12, "0")}`,
  );
  item.eventType = eventType;
  item.sequence = sequence;

  if (toolName) {
    item.toolName = toolName;
  }

  return item;
}

const CITATIONS: Array<AIChatCitation> = [
  {
    id: "C1",
    toolName: "query_metrics",
    label: "Metrics: payments-db connections",
    queryArguments: {},
    rowCount: 120,
  },
  {
    id: "C2",
    toolName: "search_logs",
    label: "Logs: checkout-api errors",
    queryArguments: {},
    rowCount: 0,
  },
];

const QUESTION: string = "Why did checkout slow down?";
const ANSWER: string =
  "payments-db ran out of connections at 14:02 [C1], and no deploy came before it [C2].";

// A conversation already answered.
function answeredConversation(): Array<AIConversationMessage> {
  return [
    message({
      id: "a1111111-1111-4111-8111-111111111111",
      role: AIChatMessageRole.User,
      content: QUESTION,
    }),
    message({
      id: "a2222222-2222-4222-8222-222222222222",
      role: AIChatMessageRole.Assistant,
      content: ANSWER,
      citations: CITATIONS,
      aiRunId: RUN_ID,
    }),
  ];
}

// A conversation whose answer is still being written.
function workingConversation(): Array<AIConversationMessage> {
  return [
    message({
      id: "a1111111-1111-4111-8111-111111111111",
      role: AIChatMessageRole.User,
      content: QUESTION,
    }),
    message({
      id: "a3333333-3333-4333-8333-333333333333",
      role: AIChatMessageRole.Assistant,
      content: "",
      status: AIChatMessageStatus.InProgress,
      aiRunId: RUN_ID,
    }),
  ];
}

function newest(
  list: Array<AIConversationMessage>,
): Array<AIConversationMessage> {
  // The dialog asks for the newest first.
  return [...list].reverse();
}

function sentRequests(path: string): Array<PostRequest> {
  return postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as PostRequest;
    })
    .filter((request: PostRequest) => {
      return request.url.toString().endsWith(path);
    });
}

function tableNameOf(modelType: unknown): string {
  return String(new (modelType as new () => { tableName: string })().tableName);
}

beforeEach(() => {
  server = {
    conversations: [],
    messages: new Map(),
    events: [],
    run: null,
    providerCount: 1,
  };

  postMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  deleteItemMock.mockReset();

  postMock.mockImplementation(async (request: PostRequest) => {
    const url: string = request.url.toString();

    if (url.endsWith("/ai-chat/providers")) {
      const providers: Array<JSONObject> = [];

      for (let index: number = 0; index < server.providerCount; index++) {
        providers.push({
          id: `provider-${index}`,
          name: index === 0 ? "OneUptime AI" : "Azure OpenAI",
          isDefault: index === 0,
          isGlobal: index === 0,
        });
      }

      return new HTTPResponse<JSONObject>(
        200,
        {
          isAIEnabledForProject: true,
          defaultProviderId: "provider-0",
          providers: providers,
        },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(
      200,
      { conversationId: CONVERSATION_ID },
      {},
    );
  });

  getListMock.mockImplementation(
    async (request: { modelType: unknown; query: JSONObject }) => {
      const table: string = tableNameOf(request.modelType);

      if (table === "AIConversation") {
        return {
          data: server.conversations,
          count: server.conversations.length,
          skip: 0,
          limit: 25,
        };
      }

      if (table === "AIConversationMessage") {
        const id: string = String(request.query["conversationId"]);
        const list: Array<AIConversationMessage> = newest(
          server.messages.get(id) || [],
        );
        return { data: list, count: list.length, skip: 0, limit: 50 };
      }

      if (table === "AIRunEvent") {
        return {
          data: server.events,
          count: server.events.length,
          skip: 0,
          limit: 100,
        };
      }

      return { data: [], count: 0, skip: 0, limit: 25 };
    },
  );

  getItemMock.mockImplementation(async (request: { modelType: unknown }) => {
    const table: string = tableNameOf(request.modelType);

    if (table === "Incident") {
      return { title: "Checkout latency above 2s", incidentNumber: 42 };
    }

    if (table === "AIRun") {
      return server.run;
    }

    return null;
  });

  deleteItemMock.mockImplementation(async (request: { id: ObjectID }) => {
    server.conversations = server.conversations.filter(
      (item: AIConversation): boolean => {
        return item.id?.toString() !== request.id.toString();
      },
    );
    return new HTTPResponse<JSONObject>(200, {}, {});
  });

  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: getJestMockFunction(),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: getJestMockFunction(),
  });
  // No page of the app to go back to, at no address of its own.
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ---- the page under the dialog ---------------------------------------------------

function incidentPath(): string {
  return `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`;
}

function homePath(): string {
  return `/dashboard/${PROJECT_ID}/home/`;
}

function Shell(): ReactElement {
  const location: ReturnType<typeof useLocation> = useLocation();
  Navigation.setLocation(location);
  navigate = useNavigate();
  Navigation.setNavigateHook(navigate);

  const chatPage: ReactElement = (
    <AICopilot
      pageRoute={new Route("/")}
      currentProject={null}
      hasPaymentMethod={false}
    />
  );

  return (
    <>
      <AskAiDialog />
      <main data-testid="page">
        <AskAI />
        <button type="button">Acknowledge</button>
        <input aria-label="A note" />
        {/* The page the router shows, read by the tests. */}
        <p data-testid="page-path">{location.pathname}</p>
        <Routes>
          <PageRoute path="/dashboard/:projectId/ai/chat" element={chatPage} />
          <PageRoute
            path="/dashboard/:projectId/ai/chat/:modelId"
            element={chatPage}
          />
          <PageRoute path="*" element={<p>A page of the Dashboard</p>} />
        </Routes>
      </main>
    </>
  );
}

function pagePath(): string {
  return screen.getByTestId("page-path").textContent || "";
}

async function renderAt(
  entries: Array<string> = [incidentPath()],
): Promise<void> {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Shell />
    </MemoryRouter>,
  );

  await settle();
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function toggle(detail?: JSONObject): Promise<void> {
  await act(async () => {
    GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, detail);
  });
  await settle();
}

function dialog(): HTMLElement | null {
  return document.querySelector('[data-testid="ask-ai-dialog"]');
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: /Ask anything|Ask a follow-up/,
  }) as HTMLTextAreaElement;
}

async function pressKeys(
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  target: Element | Window = window,
): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(target, { key: key, ...modifiers });
  });
  await settle();
}

async function sendQuestion(text: string): Promise<void> {
  fireEvent.change(composer(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send (Enter)" }));
  });
  await settle();
}

// ---- every way in -----------------------------------------------------------------

describe("Ask AI opens from every way in", () => {
  test("the header's Ask AI opens it as a dialog in the middle of the screen", async () => {
    await renderAt();
    expect(dialog()).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Ask AI/ }));
    });
    await settle();

    const opened: HTMLElement = screen.getByRole("dialog", { name: "Ask AI" });
    expect(opened).toHaveAttribute("aria-modal", "true");
    expect(opened).toBe(dialog());
    // Over a dimmed, blurred page.
    expect(screen.getByTestId("ask-ai-backdrop").className).toContain(
      "backdrop-blur-md",
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "What would you like to know?",
    );
  });

  test("Ctrl + I and Cmd + I open it and close it again", async () => {
    await renderAt();

    await pressKeys("i", { ctrlKey: true });
    expect(dialog()).not.toBeNull();

    await pressKeys("i", { ctrlKey: true });
    expect(dialog()).toBeNull();

    await pressKeys("I", { metaKey: true });
    expect(dialog()).not.toBeNull();
  });

  test("in another text box Ctrl + I stays the italics shortcut", async () => {
    await renderAt();
    const note: HTMLElement = screen.getByRole("textbox", { name: "A note" });

    await pressKeys("i", { ctrlKey: true }, note);

    expect(dialog()).toBeNull();
  });

  test("in Ask AI's own composer, which has no italics, Ctrl + I closes it", async () => {
    await renderAt();
    await toggle();

    await pressKeys("i", { ctrlKey: true }, composer());

    expect(dialog()).toBeNull();
  });

  test("the command palette's Ask AI, a plain toggle, opens it", async () => {
    await renderAt();

    await toggle();

    expect(dialog()).not.toBeNull();
    expect(composer()).toHaveFocus();
  });

  test("a page's prepared question opens a new conversation with it in the composer, unsent", async () => {
    server.conversations = [conversation(CONVERSATION_ID, "Earlier")];
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await renderAt();
    await toggle({ conversationId: CONVERSATION_ID });
    expect(screen.getByTestId("ai-chat-thread")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    await toggle({ prompt: "Explain this error pattern." });

    expect(screen.queryByTestId("ai-chat-thread")).not.toBeInTheDocument();
    expect(composer()).toHaveValue("Explain this error pattern.");
    expect(sentRequests("/ai-chat/send-message")).toHaveLength(0);
  });

  test("a conversation's id opens that conversation", async () => {
    server.conversations = [conversation(CONVERSATION_ID, "Checkout latency")];
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await renderAt();

    await toggle({ conversationId: CONVERSATION_ID });

    expect(screen.getByRole("dialog", { name: "Checkout latency" })).toBe(
      dialog(),
    );
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    expect(screen.getByTestId("ai-chat-answer-text")).toHaveTextContent(
      "payments-db ran out of connections",
    );
  });

  test("a request made before the dialog was listening is not lost", async () => {
    server.messages.set(CONVERSATION_ID, answeredConversation());

    openAskAi({ conversationId: CONVERSATION_ID });
    await renderAt();

    expect(dialog()).not.toBeNull();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
  });
});

describe("the chat's own address opens the dialog over the page", () => {
  test("from a page of the app: back to that page, with the conversation open over it", async () => {
    server.messages.set(CONVERSATION_ID, answeredConversation());
    const chatAddress: string = `/dashboard/${PROJECT_ID}/ai/chat/${CONVERSATION_ID}`;
    // The address bar, and a page of this app before it to go back to.
    window.history.replaceState({ idx: 1 }, "", chatAddress);

    await renderAt([incidentPath(), chatAddress]);
    await settle();

    expect(pagePath()).toBe(incidentPath());
    // The page it came back to did not close the dialog it asked for.
    expect(dialog()).not.toBeNull();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
    // And the incident is what the next question is about.
    expect(screen.getByTestId("ai-chat-context")).toHaveTextContent(
      "This incident · #42 Checkout latency above 2s",
    );
  });

  test("opened on its own: Home under the dialog, in place of the address", async () => {
    const chatAddress: string = `/dashboard/${PROJECT_ID}/ai/chat`;
    window.history.replaceState(null, "", chatAddress);

    await renderAt([chatAddress]);
    await settle();

    expect(pagePath()).toBe(homePath());
    expect(dialog()).not.toBeNull();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "What would you like to know?",
    );
    expect(screen.queryByTestId("ai-chat-thread")).not.toBeInTheDocument();
  });
});

// ---- a real dialog ------------------------------------------------------------------

describe("a real dialog", () => {
  test("the focus moves into the composer", async () => {
    await renderAt();

    await toggle();

    expect(composer()).toHaveFocus();
  });

  test("Tab goes round inside it, both ways", async () => {
    await renderAt();
    await toggle();
    const panel: HTMLElement = dialog()!;
    const focusable: Array<HTMLElement> = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element: HTMLElement): boolean => {
      return (
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true"
      );
    });
    // The dialog's own buttons and its composer: there is a round to go.
    expect(focusable.length).toBeGreaterThan(3);
    const first: HTMLElement = focusable[0]!;
    const last: HTMLElement = focusable[focusable.length - 1]!;

    last.focus();
    await pressKeys("Tab", {});
    expect(first).toHaveFocus();

    await pressKeys("Tab", { shiftKey: true });
    expect(last).toHaveFocus();
  });

  test("Esc closes it and gives the focus back to what opened it", async () => {
    await renderAt();
    const opener: HTMLElement = screen.getByRole("button", {
      name: "Acknowledge",
    });
    opener.focus();

    await toggle();
    expect(composer()).toHaveFocus();

    await pressKeys("Escape", {});

    expect(dialog()).toBeNull();
    expect(opener).toHaveFocus();
  });

  test("Esc in its menu closes the menu only", async () => {
    await renderAt();
    await toggle();
    const modeButton: HTMLElement = screen.getByTitle(
      "Choose what the AI is allowed to do",
    );

    await act(async () => {
      fireEvent.click(modeButton);
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await pressKeys("Escape", {}, screen.getByRole("menu"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(dialog()).not.toBeNull();
  });

  test("the page behind it is inert and still while it is open, and wakes when it closes", async () => {
    await renderAt();
    const page: HTMLElement = screen.getByTestId("page");
    const pageRoot: HTMLElement = page.closest("body > div") as HTMLElement;

    await toggle();

    expect(pageRoot).toHaveAttribute("inert");
    expect(dialog()!.closest("[inert]")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    expect(pageRoot).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
  });

  test("a click beside it closes it; a press that started inside it does not", async () => {
    await renderAt();
    await toggle();
    const backdrop: HTMLElement = dialog()!.parentElement as HTMLElement;

    // Selecting text in the composer and letting go beside the dialog.
    await act(async () => {
      fireEvent.mouseDown(composer());
      fireEvent.click(backdrop);
    });
    expect(dialog()).not.toBeNull();

    await act(async () => {
      fireEvent.mouseDown(backdrop);
      fireEvent.click(backdrop);
    });
    expect(dialog()).toBeNull();
  });

  test("opening something from inside it steps it aside, and the conversation waits", async () => {
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await renderAt();
    await toggle({ conversationId: CONVERSATION_ID });

    // A source opened from the answer moves the page under the dialog.
    await act(async () => {
      navigate(`/dashboard/${PROJECT_ID}/logs`);
    });
    await settle();
    expect(dialog()).toBeNull();

    await toggle();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
  });
});

// ---- what it is about ---------------------------------------------------------------

describe("what the question is about", () => {
  test("on an incident: the pill names it once, under one question, with the incident's own suggestions", async () => {
    await renderAt();

    await toggle();

    expect(screen.getByTestId("ai-chat-context")).toHaveTextContent(
      "This incident · #42 Checkout latency above 2s",
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "What would you like to know?",
    );
    // No second line saying what the pill already says.
    expect(
      screen.queryByText(/It answers from your project's live data/),
    ).not.toBeInTheDocument();
    const suggestions: HTMLElement = screen.getByTestId("ai-chat-suggestions");
    expect(within(suggestions).getAllByRole("button")).toHaveLength(4);
    expect(
      within(suggestions).getByRole("button", { name: "Summarize" }),
    ).toBeInTheDocument();
    expect(
      within(suggestions).queryByRole("button", { name: "Latency chart" }),
    ).not.toBeInTheDocument();
  });

  test("a suggestion says its whole question on hover and asks it about the incident", async () => {
    await renderAt();
    await toggle();
    const summarize: HTMLElement = screen.getByRole("button", {
      name: "Summarize",
    });

    expect(summarize).toHaveAttribute(
      "title",
      "Summarize this incident: what happened, its current state, and the impact.",
    );

    await act(async () => {
      fireEvent.click(summarize);
    });
    await settle();

    expect(sentRequests("/ai-chat/send-message")[0]!.data).toEqual(
      expect.objectContaining({
        content:
          "Summarize this incident: what happened, its current state, and the impact.",
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: INCIDENT_ID,
          entityTitle: "#42 Checkout latency above 2s",
        },
      }),
    );
  });

  test("cleared, it asks about the whole project, and the way back names the page", async () => {
    await renderAt();
    await toggle();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove page context" }),
      );
    });

    expect(
      screen.getByText(
        "It answers from your project's live data, and can create incidents and alerts with your approval.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Latency chart" }),
    ).toBeInTheDocument();
    const attach: HTMLElement = screen.getByTitle(
      "Attach this page as context for your questions",
    );
    expect(attach).toHaveTextContent("This incident");

    await sendQuestion("What is on fire?");
    expect(sentRequests("/ai-chat/send-message")[0]!.data["pageContext"]).toBe(
      null,
    );
  });

  test("with no page behind it, the start says where answers come from, once", async () => {
    await renderAt([homePath()]);

    await toggle();

    expect(screen.queryByTestId("ai-chat-context")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "It answers from your project's live data, and can create incidents and alerts with your approval.",
      ),
    ).toBeInTheDocument();
    expect(composer()).toHaveAttribute("placeholder", "Ask anything…");
  });
});

// ---- history ------------------------------------------------------------------------

describe("conversations within reach", () => {
  beforeEach(() => {
    server.conversations = [
      conversation(CONVERSATION_ID, "Why did checkout slow down?"),
      conversation(OTHER_CONVERSATION_ID, "Error log volume by service"),
      conversation("c3333333-3333-4333-8333-333333333333", "Top exceptions"),
      conversation("c4444444-4444-4444-8444-444444444444", "Payments API"),
    ];
    server.messages.set(CONVERSATION_ID, answeredConversation());
  });

  test("the start lists the last three; All conversations lists them all", async () => {
    await renderAt();
    await toggle();

    const recent: HTMLElement = screen.getByTestId("ai-chat-recent");
    expect(within(recent).getAllByRole("listitem")).toHaveLength(3);
    expect(within(recent).queryByText("Payments API")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(recent).getByRole("button", { name: "All conversations" }),
      );
    });

    expect(screen.getByRole("dialog", { name: "All conversations" })).toBe(
      dialog(),
    );
    expect(
      within(screen.getByTestId("ai-chat-history")).getAllByRole("listitem"),
    ).toHaveLength(4);
    // The history is a list to pick from: nothing to type into.
    expect(within(dialog()!).queryByRole("textbox")).not.toBeInTheDocument();
  });

  test("the header's history opens a conversation, and Back returns", async () => {
    await renderAt();
    await toggle();

    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-history"));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^Why did checkout slow down\?/ }),
      );
    });
    await settle();

    expect(screen.getByTestId("ai-chat-answer-text")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-history"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });

    expect(screen.getByTestId("ai-chat-answer-text")).toBeInTheDocument();
  });

  test("a conversation is deleted by name, once the row has asked", async () => {
    await renderAt();
    await toggle();
    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-history"));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Delete conversation: Error log volume by service",
        }),
      );
    });
    await settle();

    // The bin deletes nothing: the row asks, named after the conversation.
    expect(deleteItemMock).not.toHaveBeenCalled();
    const asking: HTMLElement = screen.getByRole("group", {
      name: "Delete conversation: Error log volume by service",
    });

    await act(async () => {
      fireEvent.click(within(asking).getByRole("button", { name: "Delete" }));
    });
    await settle();

    expect(deleteItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: new ObjectID(OTHER_CONVERSATION_ID) }),
    );
    expect(
      screen.queryByRole("button", {
        name: /^Error log volume by service/,
      }),
    ).not.toBeInTheDocument();
  });

  test("the history takes the focus as it opens: the first conversation, from the header or the start", async () => {
    await renderAt();
    await toggle();
    // The composer had it; it is gone with the start.
    expect(document.activeElement).toBe(composer());

    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-history"));
    });
    await settle();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Why did checkout slow down\?/ }),
    );

    // Back, and in from the start's own link.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("ai-chat-recent")).getByRole("button", {
          name: "All conversations",
        }),
      );
    });
    await settle();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Why did checkout slow down\?/ }),
    );
  });

  test("an empty history gives the focus to Back", async () => {
    server.conversations = [];
    await renderAt();
    await toggle();

    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-history"));
    });
    await settle();

    expect(screen.getByTestId("ai-chat-history-empty")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("ask-ai-back"));
  });

  test("the row's question keeps the conversation: Cancel, or Esc, which leaves the dialog open", async () => {
    await renderAt();
    await toggle();
    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-history"));
    });

    const bin: () => HTMLElement = (): HTMLElement => {
      return screen.getByRole("button", {
        name: "Delete conversation: Error log volume by service",
      });
    };

    await act(async () => {
      fireEvent.click(bin());
    });
    await settle();

    const asking: HTMLElement = screen.getByRole("group", {
      name: "Delete conversation: Error log volume by service",
    });
    // Asked, the focus is on Cancel: an Enter pressed twice keeps it.
    expect(document.activeElement).toBe(
      within(asking).getByRole("button", { name: "Cancel" }),
    );
    // Delete first, Cancel at the row's end, where the bin was.
    expect(
      within(asking)
        .getAllByRole("button")
        .map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
    ).toEqual(["Delete", "Cancel"]);

    // Esc keeps it - and only takes the question back, not the dialog.
    await pressKeys("Escape", {}, document.activeElement!);

    expect(
      screen.queryByRole("group", { name: /^Delete conversation/ }),
    ).not.toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(document.activeElement).toBe(bin());

    // Cancel keeps it too.
    await act(async () => {
      fireEvent.click(bin());
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await settle();

    expect(
      screen.queryByRole("group", { name: /^Delete conversation/ }),
    ).not.toBeInTheDocument();
    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /^Error log volume by service/ }),
    ).toBeInTheDocument();
  });

  test("after a delete the focus moves to the row that took its place, and to Back when none is left", async () => {
    await renderAt();
    await toggle();
    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-history"));
    });

    const deleteByName: (title: string) => Promise<void> = async (
      title: string,
    ): Promise<void> => {
      const label: string = "Delete conversation: " + title;

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: label }));
      });
      await act(async () => {
        fireEvent.click(
          within(screen.getByRole("group", { name: label })).getByRole(
            "button",
            { name: "Delete" },
          ),
        );
      });
      await settle();
    };

    // The second row goes: the third takes its place, and the focus.
    await deleteByName("Error log volume by service");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Top exceptions/ }),
    );

    // The last row goes: the one before it takes the focus.
    await deleteByName("Payments API");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Top exceptions/ }),
    );

    await deleteByName("Top exceptions");
    await deleteByName("Why did checkout slow down?");

    // None left: Back.
    expect(screen.getByTestId("ai-chat-history-empty")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("ask-ai-back"));
  });

  test("a title reads the way its letters do, and stands where the page reads from", async () => {
    server.conversations = [
      conversation(CONVERSATION_ID, "Why did checkout slow down?"),
      conversation(
        OTHER_CONVERSATION_ID,
        "\u0686\u0631\u0627 \u067e\u0631\u062f\u0627\u062e\u062a \u06a9\u0646\u062f \u0634\u062f\u061f",
      ),
    ];
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await renderAt();
    await toggle();

    const titleOf: (row: HTMLElement) => HTMLElement = (
      row: HTMLElement,
    ): HTMLElement => {
      return row.querySelector("span[dir]") as HTMLElement;
    };

    const recent: Array<HTMLElement> = within(
      screen.getByTestId("ai-chat-recent"),
    ).getAllByRole("listitem");
    expect(titleOf(recent[0]!)).toHaveAttribute("dir", "ltr");
    expect(titleOf(recent[1]!)).toHaveAttribute("dir", "rtl");

    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-history"));
    });

    const rows: Array<HTMLElement> = within(
      screen.getByTestId("ai-chat-history"),
    ).getAllByRole("listitem");
    expect(titleOf(rows[0]!)).toHaveAttribute("dir", "ltr");
    expect(titleOf(rows[1]!)).toHaveAttribute("dir", "rtl");

    for (const title of [
      titleOf(recent[0]!),
      titleOf(rows[0]!),
      titleOf(rows[1]!),
    ]) {
      // Aligned by the page's direction, not by the title's own.
      expect(title.className).toContain(PAGE_START_ALIGN_CLASS_NAME);
      expect(title).not.toHaveClass("text-start");
    }

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^Why did checkout slow down\?/ }),
      );
    });
    await settle();

    const heading: HTMLElement = screen.getByTestId("ask-ai-title");
    expect(heading).toHaveTextContent("Why did checkout slow down?");
    expect(heading).toHaveAttribute("dir", "ltr");
    expect(heading.className).toContain(PAGE_START_ALIGN_CLASS_NAME);
  });

  test("New chat starts over from a conversation", async () => {
    await renderAt();
    await toggle({ conversationId: CONVERSATION_ID });
    expect(screen.getByTestId("ai-chat-thread")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    });

    expect(screen.queryByTestId("ai-chat-thread")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "What would you like to know?",
    );
  });
});

// ---- quiet answers ------------------------------------------------------------------

describe("an answer, quietly", () => {
  test("while it works, one line says what it does now and opens into its steps", async () => {
    server.messages.set(CONVERSATION_ID, workingConversation());
    server.events = [
      runEvent(0, AIRunEventType.RunStarted),
      runEvent(1, AIRunEventType.LlmCallStarted),
      runEvent(2, AIRunEventType.LlmCallCompleted),
      runEvent(3, AIRunEventType.ToolCallStarted, "search_logs"),
    ];
    await renderAt();

    await toggle({ conversationId: CONVERSATION_ID });

    const live: HTMLElement = screen.getByTestId("ai-chat-live");
    expect(screen.getByTestId("ai-chat-live-step")).toHaveTextContent(
      "Searching logs…",
    );
    // A screen reader hears once that it is working, not every step.
    expect(screen.getByTestId("ai-chat-live-step")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(live).toHaveTextContent("Ask AI is working on an answer.");
    // Its steps are folded until asked for.
    expect(screen.queryByTestId("ai-chat-live-steps")).not.toBeInTheDocument();

    const toggleSteps: HTMLElement = screen.getByTestId(
      "ai-chat-live-steps-toggle",
    );
    expect(toggleSteps).toHaveTextContent("3 steps");
    expect(toggleSteps).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggleSteps);
    });

    expect(toggleSteps).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("ai-chat-live-steps")).toHaveTextContent(
      "Starting investigation",
    );
    // The composer's send turns into Stop while it works.
    expect(
      screen.getByRole("button", { name: "Stop generating" }),
    ).toBeInTheDocument();
  });

  test("the answer leads; its sources, its time and its actions sit on one row under it", async () => {
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await renderAt();

    await toggle({ conversationId: CONVERSATION_ID });

    const answer: HTMLElement = screen.getByTestId("ai-chat-answer");
    // No avatar on every message, no label over the answer.
    expect(answer.querySelector('[data-testid="ask-ai-mark"]')).toBeNull();
    expect(answer.firstElementChild).toHaveTextContent(
      "payments-db ran out of connections",
    );

    const footer: HTMLElement = within(answer).getByTestId(
      "ai-chat-answer-footer",
    );
    expect(
      within(footer).getByTestId("ai-chat-sources-toggle"),
    ).toHaveTextContent("2 sources");
    expect(within(footer).getByTestId("ai-chat-answer-time")).toBeVisible();
    expect(
      within(footer).getByRole("button", { name: "Good answer" }),
    ).toBeInTheDocument();
    expect(
      within(footer).getByRole("button", { name: "Poor answer" }),
    ).toBeInTheDocument();
    expect(
      within(footer).getByTestId("ai-chat-copy-answer"),
    ).toBeInTheDocument();
    // Its sources are folded under that one line.
    expect(screen.queryByTestId("ai-chat-sources")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(footer).getByTestId("ai-chat-sources-toggle"));
    });

    const sources: HTMLElement = screen.getByTestId("ai-chat-sources");
    expect(sources).toHaveTextContent("Metrics: payments-db connections");
    expect(sources).toHaveTextContent("Logs: checkout-api errors");
  });

  test("the newest answer's sources also say what it took: queries, tokens, cost and model", async () => {
    const run: AIRun = new AIRun();
    run.toolCallCount = 4;
    run.totalTokens = 18432;
    run.totalCostInUSDCents = 1.84;
    server.run = run;
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await renderAt();

    await toggle({ conversationId: CONVERSATION_ID });
    await act(async () => {
      fireEvent.click(screen.getByTestId("ai-chat-sources-toggle"));
    });

    expect(screen.getByTestId("ai-chat-run-stats")).toHaveTextContent(
      "4 queries · 18,432 tokens · $0.0184",
    );
  });

  test("a failed answer says so, and Try again asks the same question again", async () => {
    server.messages.set(CONVERSATION_ID, [
      message({
        id: "a1111111-1111-4111-8111-111111111111",
        role: AIChatMessageRole.User,
        content: QUESTION,
      }),
      message({
        id: "a4444444-4444-4444-8444-444444444444",
        role: AIChatMessageRole.Assistant,
        content: "",
        status: AIChatMessageStatus.Error,
        errorMessage: "The LLM provider did not answer in time.",
      }),
    ]);
    await renderAt();
    await toggle({ conversationId: CONVERSATION_ID });

    expect(screen.getByTestId("ai-chat-answer-error")).toHaveTextContent(
      "The LLM provider did not answer in time.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    await settle();

    expect(sentRequests("/ai-chat/send-message")[0]!.data).toEqual(
      expect.objectContaining({
        content: QUESTION,
        conversationId: CONVERSATION_ID,
      }),
    );
  });

  test("an action waiting for approval is decided inside the dialog", async () => {
    server.messages.set(CONVERSATION_ID, [
      message({
        id: "a1111111-1111-4111-8111-111111111111",
        role: AIChatMessageRole.User,
        content: "Raise an alert for test01's memory.",
      }),
      message({
        id: "a5555555-5555-4555-8555-555555555555",
        role: AIChatMessageRole.Assistant,
        content: "",
        status: AIChatMessageStatus.WaitingForApproval,
        toolActions: [
          {
            id: "call_1",
            toolName: "create_alert",
            title: "Create alert: High memory usage on test01",
            description: 'Severity: High. Linked to host "test01".',
            arguments: {},
            isMutation: true,
            requiresApproval: true,
            status: AIChatToolActionStatus.Pending,
          },
        ],
      }),
    ]);
    await renderAt();
    await toggle({ conversationId: CONVERSATION_ID });

    expect(
      screen.getByText("The AI wants to perform 1 action"),
    ).toBeInTheDocument();
    // Nothing else can be sent until it is decided.
    expect(screen.getByRole("button", { name: "Send (Enter)" })).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run 1 action" }));
    });
    await settle();

    expect(sentRequests("/ai-chat/respond-to-approval")[0]!.data).toEqual(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        assistantMessageId: "a5555555-5555-4555-8555-555555555555",
        decisions: [{ toolCallId: "call_1", approved: true }],
      }),
    );
  });

  test("the conversation is a log a screen reader follows, one region per conversation", async () => {
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await renderAt();

    await toggle({ conversationId: CONVERSATION_ID });

    const log: HTMLElement = screen.getByRole("log", { name: "Conversation" });
    expect(log).toHaveAttribute("aria-live", "polite");
    expect(log).toHaveAttribute("aria-relevant", "additions");
    // A question reads its own way, an English one on a Persian page too.
    expect(screen.getByText(QUESTION)).toHaveAttribute("dir", "auto");
  });
});

// ---- the composer's controls ----------------------------------------------------------

describe("the composer asks only what there is to choose", () => {
  test("one LLM provider: no provider picker", async () => {
    await renderAt();

    await toggle();

    expect(screen.queryByTitle("Choose AI provider")).not.toBeInTheDocument();
    expect(
      screen.getByTitle("Choose what the AI is allowed to do"),
    ).toBeInTheDocument();
  });

  test("two: the picker lists them, and its Esc closes only its menu", async () => {
    server.providerCount = 2;
    await renderAt();
    await toggle();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Choose AI provider"));
    });
    const menu: HTMLElement = screen.getByRole("menu", { name: "AI provider" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2);

    await pressKeys("Escape", {}, menu);

    expect(
      screen.queryByRole("menu", { name: "AI provider" }),
    ).not.toBeInTheDocument();
    expect(dialog()).not.toBeNull();
  });
});

// ---- closing loses nothing --------------------------------------------------------------

describe("closing Ask AI loses nothing", () => {
  test("closed while it answers, a way back says when the answer is ready", async () => {
    jest.useFakeTimers();
    server.messages.set(CONVERSATION_ID, workingConversation());
    await renderAt();
    await toggle({ conversationId: CONVERSATION_ID });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    const resume: HTMLElement = screen.getByTestId("ask-ai-resume");
    expect(resume).toHaveTextContent("Ask AI is answering…");

    // The answer comes in while the dialog is closed.
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await settle();

    expect(screen.getByTestId("ask-ai-resume")).toHaveTextContent(
      "Ask AI has answered",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("ask-ai-resume-open"));
    });
    await settle();

    expect(dialog()).not.toBeNull();
    expect(screen.getByTestId("ai-chat-answer-text")).toBeInTheDocument();
    expect(screen.queryByTestId("ask-ai-resume")).not.toBeInTheDocument();
  });

  test("the way back can be dismissed", async () => {
    server.messages.set(CONVERSATION_ID, workingConversation());
    await renderAt();
    await toggle({ conversationId: CONVERSATION_ID });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("ask-ai-resume")).getByRole("button", {
          name: "Dismiss",
        }),
      );
    });

    expect(screen.queryByTestId("ask-ai-resume")).not.toBeInTheDocument();
  });

  test("nothing floats over the page once the answer has been read", async () => {
    server.messages.set(CONVERSATION_ID, answeredConversation());
    await renderAt();
    await toggle({ conversationId: CONVERSATION_ID });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    expect(screen.queryByTestId("ask-ai-resume")).not.toBeInTheDocument();

    // And it opens again on the same conversation.
    await toggle();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
  });
});

// ---- the questions follow the record ---------------------------------------------

/*
 * Ask AI's questions follow the record on screen (the follow-up #5273
 * listed): the read that fetches the incident's title for the pill also
 * reads where it stands, each time Ask AI opens, and a resolved incident is
 * asked how the response went and what would stop it coming back.
 */
describe("the questions follow the incident on screen", () => {
  const OWN_QUESTIONS: Array<string> = [
    "Summarize",
    "Find root cause",
    "What changed?",
    "Draft status update",
  ];
  const RESOLVED_QUESTIONS: Array<string> = [
    "Summarize",
    "Find root cause",
    "Response timeline",
    "Prevent a repeat",
  ];

  function incidentRead(isResolvedState?: boolean): JSONObject {
    return {
      title: "Checkout latency above 2s",
      incidentNumber: 42,
      ...(isResolvedState === undefined
        ? {}
        : { currentIncidentState: { isResolvedState: isResolvedState } }),
    };
  }

  function answerIncidentWith(
    read: (select: JSONObject) => Promise<unknown>,
  ): void {
    getItemMock.mockImplementation(
      async (request: { modelType: unknown; select: JSONObject }) => {
        const table: string = tableNameOf(request.modelType);

        if (table === "Incident") {
          return read(request.select);
        }

        if (table === "AIRun") {
          return server.run;
        }

        return null;
      },
    );
  }

  function incidentReads(): Array<JSONObject> {
    return getItemMock.mock.calls
      .map(
        (call: Array<unknown>): { modelType: unknown; select: JSONObject } => {
          return call[0] as { modelType: unknown; select: JSONObject };
        },
      )
      .filter((request: { modelType: unknown }): boolean => {
        return tableNameOf(request.modelType) === "Incident";
      })
      .map((request: { select: JSONObject }): JSONObject => {
        return request.select;
      });
  }

  function suggestionTitles(): Array<string> {
    return within(screen.getByTestId("ai-chat-suggestions"))
      .getAllByRole("button")
      .map((button: HTMLElement): string => {
        return button.textContent || "";
      });
  }

  async function settleRead(): Promise<void> {
    for (let tick: number = 0; tick < 4; tick++) {
      await settle();
    }
  }

  test("a resolved incident is asked how the response went and what would stop it coming back", async () => {
    answerIncidentWith(async () => {
      return incidentRead(true);
    });
    await renderAt();
    await toggle();
    await settleRead();

    expect(suggestionTitles()).toEqual(RESOLVED_QUESTIONS);
    expect(screen.getByRole("button", { name: "Summarize" })).toHaveAttribute(
      "title",
      "Summarize this incident: what happened, how long it lasted, and how it was resolved.",
    );
    // One read, the incident's state with its title.
    expect(incidentReads()).toEqual([
      {
        title: true,
        incidentNumber: true,
        currentIncidentState: { isResolvedState: true },
      },
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Prevent a repeat" }));
    });
    await settle();

    expect(sentRequests("/ai-chat/send-message")[0]!.data).toEqual(
      expect.objectContaining({
        content:
          "What would stop this incident from happening again? Base it on its root cause and on similar past incidents.",
        // Where it stands stays in the browser: the server reads the incident.
        pageContext: {
          type: AIChatPageContextType.Incident,
          entityId: INCIDENT_ID,
          entityTitle: "#42 Checkout latency above 2s",
        },
      }),
    );
  });

  test("an open incident keeps the incident's own questions", async () => {
    answerIncidentWith(async () => {
      return incidentRead(false);
    });
    await renderAt();
    await toggle();
    await settleRead();

    expect(suggestionTitles()).toEqual(OWN_QUESTIONS);
    expect(screen.getByTestId("ai-chat-context")).toHaveTextContent(
      "This incident · #42 Checkout latency above 2s",
    );
  });

  test("read again each time Ask AI opens: what it knew stays while it reads, then the questions follow the incident", async () => {
    answerIncidentWith(async () => {
      return incidentRead(true);
    });
    await renderAt();
    await toggle();
    await settleRead();
    expect(suggestionTitles()).toEqual(RESOLVED_QUESTIONS);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });
    expect(dialog()).toBeNull();

    // Reopened meanwhile, and read slowly this time.
    let answer: (value: unknown) => void = (): void => {
      return undefined;
    };
    answerIncidentWith((): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void): void => {
        answer = resolve;
      });
    });

    await toggle();
    await settleRead();

    // Read again, and until it answers, what the last read said stays.
    expect(incidentReads()).toHaveLength(2);
    expect(suggestionTitles()).toEqual(RESOLVED_QUESTIONS);
    expect(screen.getByTestId("ai-chat-context")).toHaveTextContent(
      "This incident · #42 Checkout latency above 2s",
    );

    await act(async () => {
      answer(incidentRead(false));
    });
    await settleRead();

    expect(suggestionTitles()).toEqual(OWN_QUESTIONS);
    expect(screen.getByTestId("ai-chat-context")).toHaveTextContent(
      "This incident · #42 Checkout latency above 2s",
    );
  });

  test("an incident whose state the person may not read keeps its title and its own questions", async () => {
    answerIncidentWith(async (select: JSONObject) => {
      if (select["currentIncidentState"]) {
        throw new Error("You do not have permission to read Incident State");
      }

      return incidentRead();
    });
    await renderAt();
    await toggle();
    await settleRead();

    expect(screen.getByTestId("ai-chat-context")).toHaveTextContent(
      "This incident · #42 Checkout latency above 2s",
    );
    expect(suggestionTitles()).toEqual(OWN_QUESTIONS);
    // Read again without the state, as before the state was read.
    expect(incidentReads()).toEqual([
      {
        title: true,
        incidentNumber: true,
        currentIncidentState: { isResolvedState: true },
      },
      { title: true, incidentNumber: true },
    ]);
  });

  test("on another page, nothing read about the incident is carried over", async () => {
    answerIncidentWith(async () => {
      return incidentRead(true);
    });
    await renderAt();
    await toggle();
    await settleRead();
    expect(suggestionTitles()).toEqual(RESOLVED_QUESTIONS);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });
    await act(async () => {
      navigate(homePath());
    });
    await settle();
    await toggle();
    await settleRead();

    expect(screen.queryByTestId("ai-chat-context")).not.toBeInTheDocument();
    expect(suggestionTitles()).not.toContain("Prevent a repeat");
  });
});
