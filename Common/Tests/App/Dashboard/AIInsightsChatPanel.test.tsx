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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  MemoryRouter,
  NavigateFunction,
  useLocation,
  useNavigate,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AIChatPageContextType from "../../../Types/AI/AIChatPageContext";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import Navigation from "../../../UI/Utils/Navigation";
import AIChatPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AIChatPanel";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * Issue #3844: insights have to follow the module the user is investigating.
 * Exercise the actual panel, hook, route detection, suggestions, and request
 * serialization together. Only network, project storage, and the unused PDF
 * exporter are replaced. Navigation is wired to MemoryRouter in the same way
 * the dashboard wires it to its browser router, so these tests also catch a
 * valid route being classified as the wrong module.
 */
const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const ENTITY_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_ENTITY_ID: string = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID: string = "55555555-5555-4555-8555-555555555555";

let currentProjectId: string = PROJECT_ID;
let navigate: NavigateFunction;

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "Could not load data";
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
      getCommonHeaders: () => {
        return { tenantid: currentProjectId };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID(currentProjectId);
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

interface PostRequest {
  url: { toString: () => string };
  data: JSONObject;
  headers: JSONObject;
}

interface PendingTitle {
  promise: Promise<{ name: string }>;
  resolve: (item: { name: string }) => void;
}

function pendingTitle(): PendingTitle {
  let resolve: PendingTitle["resolve"] = () => {};
  const promise: Promise<{ name: string }> = new Promise(
    (resolvePromise: PendingTitle["resolve"]) => {
      resolve = resolvePromise;
    },
  );
  return { promise, resolve };
}

function route(modulePath: string, projectId: string = PROJECT_ID): string {
  return `/dashboard/${projectId}/${modulePath}`;
}

function PanelWithNavigation(): ReactElement {
  Navigation.setLocation(useLocation());
  navigate = useNavigate();
  Navigation.setNavigateHook(navigate);
  return <AIChatPanel />;
}

async function openAskAi(modulePath: string): Promise<void> {
  render(
    <MemoryRouter initialEntries={[route(modulePath)]}>
      <PanelWithNavigation />
    </MemoryRouter>,
  );
  await act(async () => {
    GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE);
  });
}

async function goTo(
  modulePath: string,
  projectId: string = PROJECT_ID,
): Promise<void> {
  await act(async () => {
    currentProjectId = projectId;
    await navigate(route(modulePath, projectId));
  });
}

function sentRequests(): Array<PostRequest> {
  return postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as PostRequest;
    })
    .filter((request: PostRequest) => {
      return request.url.toString().endsWith("/ai-chat/send-message");
    });
}

async function sendQuestion(
  question: string = "What needs attention?",
): Promise<PostRequest> {
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: question },
  });
  await act(async () => {
    fireEvent.click(screen.getByTitle("Send (Enter)"));
  });
  const requests: Array<PostRequest> = sentRequests();
  expect(requests.length).toBeGreaterThan(0);
  return requests[requests.length - 1]!;
}

beforeEach(() => {
  jest.useFakeTimers();
  currentProjectId = PROJECT_ID;
  postMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 25 });
  getItemMock.mockResolvedValue({ name: "Storefront" });
  postMock.mockImplementation(async (request: PostRequest) => {
    return new HTTPResponse<JSONObject>(
      200,
      request.url.toString().endsWith("/ai-chat/providers")
        ? {
            isAIEnabledForProject: true,
            defaultProviderId: "provider-1",
            providers: [
              {
                id: "provider-1",
                name: "Project provider",
                llmType: "OpenAI",
                isDefault: true,
              },
            ],
          }
        : { conversationId: CONVERSATION_ID },
      {},
    );
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: getJestMockFunction(),
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("module insights in Ask AI", () => {
  test.each(["", "/metrics", "/logs", "/traces", "/session-replay"])(
    "RUM application%s opens with application context and its display name",
    async (subpage: string) => {
      await openAskAi(`rum/${ENTITY_ID}${subpage}`);

      expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
        "this RUM application",
      );
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "placeholder",
        "Ask about this RUM application…",
      );
      expect(
        screen.getByText("This RUM application · Storefront"),
      ).toBeInTheDocument();
      expect(screen.getByText("Or explore everything")).toBeInTheDocument();
      expect(getItemMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: RumApplication,
          id: new ObjectID(ENTITY_ID),
          select: { name: true },
        }),
      );
      expect(sentRequests()).toHaveLength(0);
    },
  );

  test("a RUM question sends the application identity and resolved title", async () => {
    await openAskAi(`rum/${ENTITY_ID}/metrics`);

    const request: PostRequest = await sendQuestion(
      "Why is this application slow?",
    );

    expect(request.data).toEqual(
      expect.objectContaining({
        content: "Why is this application slow?",
        pageContext: {
          type: AIChatPageContextType.RumApplication,
          entityId: ENTITY_ID,
          entityTitle: "Storefront",
        },
      }),
    );
    expect(request.headers["tenantid"]).toBe(PROJECT_ID);
  });

  test("RUM insight suggestions cover web vitals, regressions, requests, and connection health", async () => {
    await openAskAi(`rum/${ENTITY_ID}`);

    for (const title of [
      "Web vitals trends",
      "Performance regressions",
      "Slow or failing requests",
      "Connection health",
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(title) }),
      ).toBeEnabled();
    }

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Web vitals trends/ }),
      );
    });

    expect(sentRequests()).toHaveLength(1);
    expect(sentRequests()[0]!.data).toEqual(
      expect.objectContaining({
        content:
          "Chart this RUM application's LCP, INP and CLS over the last 24 hours. Which web vitals need attention?",
        pageContext: {
          type: AIChatPageContextType.RumApplication,
          entityId: ENTITY_ID,
          entityTitle: "Storefront",
        },
      }),
    );
  });

  test.each(["rum", "rum/archived"])(
    "%s offers application-wide insights without inventing an entity",
    async (modulePath: string) => {
      await openAskAi(modulePath);

      expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
        "your RUM applications",
      );
      expect(screen.getByRole("textbox")).toHaveAttribute(
        "placeholder",
        "Ask about your RUM applications…",
      );
      expect(screen.getByText("Or explore everything")).toBeInTheDocument();
      expect(getItemMock).not.toHaveBeenCalled();

      const request: PostRequest = await sendQuestion();
      expect(request.data["pageContext"]).toEqual({
        type: AIChatPageContextType.RumApplications,
      });
    },
  );

  test("the services list offers insights scoped to services", async () => {
    await openAskAi("service");

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "your services",
    );
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "Ask about your services…",
    );
    expect(screen.getByText("Or explore everything")).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();

    const request: PostRequest = await sendQuestion();
    expect(request.data["pageContext"]).toEqual({
      type: AIChatPageContextType.TelemetryServicesList,
    });
  });

  test("a contextual service suggestion sends its question with the current service", async () => {
    getItemMock.mockResolvedValue({ name: "Checkout API" });
    await openAskAi(`service/${ENTITY_ID}/traces`);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Health overview/ }));
    });

    expect(sentRequests()).toHaveLength(1);
    expect(sentRequests()[0]!.data).toEqual(
      expect.objectContaining({
        content:
          "Give me a health overview of this service — errors, latency and log volume over the last 24 hours.",
        pageContext: {
          type: AIChatPageContextType.TelemetryService,
          entityId: ENTITY_ID,
          entityTitle: "Checkout API",
        },
      }),
    );
  });

  test("removing context restores general suggestions and explicitly clears the conversation context", async () => {
    await openAskAi(`rum/${ENTITY_ID}`);
    fireEvent.click(screen.getByTitle("Remove page context"));

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Ask AI about your data — or tell it to act",
    );
    expect(screen.queryByText("Or explore everything")).not.toBeInTheDocument();
    expect(
      screen.getByTitle("Attach this page as context for your questions"),
    ).toBeInTheDocument();

    const request: PostRequest = await sendQuestion();
    expect(request.data["pageContext"]).toBeNull();
  });

  test("reattaching restores the application context for subsequent questions", async () => {
    await openAskAi(`rum/${ENTITY_ID}`);
    fireEvent.click(screen.getByTitle("Remove page context"));
    fireEvent.click(
      screen.getByTitle("Attach this page as context for your questions"),
    );

    const request: PostRequest = await sendQuestion();
    expect(request.data["pageContext"]).toEqual({
      type: AIChatPageContextType.RumApplication,
      entityId: ENTITY_ID,
      entityTitle: "Storefront",
    });
  });

  test("detach and reattach apply to follow-up messages in an existing conversation", async () => {
    await openAskAi(`rum/${ENTITY_ID}`);
    await sendQuestion("Summarize this application's performance.");

    fireEvent.click(screen.getByTitle("Remove page context"));
    const detached: PostRequest = await sendQuestion(
      "Now summarize all services.",
    );
    expect(detached.data).toEqual(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        pageContext: null,
      }),
    );

    fireEvent.click(
      screen.getByTitle("Attach this page as context for your questions"),
    );
    const reattached: PostRequest = await sendQuestion(
      "Back to this application: what changed?",
    );
    expect(reattached.data).toEqual(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        pageContext: {
          type: AIChatPageContextType.RumApplication,
          entityId: ENTITY_ID,
          entityTitle: "Storefront",
        },
      }),
    );
    expect(sentRequests()).toHaveLength(3);
  });

  test("detached context stays detached when navigating within the same application", async () => {
    await openAskAi(`rum/${ENTITY_ID}/metrics`);
    fireEvent.click(screen.getByTitle("Remove page context"));

    await goTo(`rum/${ENTITY_ID}/traces`);

    expect(screen.queryByTitle("Remove page context")).not.toBeInTheDocument();
    expect(
      screen.getByTitle("Attach this page as context for your questions"),
    ).toBeInTheDocument();
    const request: PostRequest = await sendQuestion();
    expect(request.data["pageContext"]).toBeNull();
  });

  test("navigating to another application attaches its context and sends its identity", async () => {
    await openAskAi(`rum/${ENTITY_ID}`);
    fireEvent.click(screen.getByTitle("Remove page context"));
    getItemMock.mockResolvedValue({ name: "Admin console" });

    await goTo(`rum/${OTHER_ENTITY_ID}`);

    expect(
      screen.getByText("This RUM application · Admin console"),
    ).toBeInTheDocument();
    const request: PostRequest = await sendQuestion();
    expect(request.data["pageContext"]).toEqual({
      type: AIChatPageContextType.RumApplication,
      entityId: OTHER_ENTITY_ID,
      entityTitle: "Admin console",
    });
  });

  test("ordinary navigation away from a supported module omits context for the existing conversation", async () => {
    await openAskAi(`rum/${ENTITY_ID}`);
    await sendQuestion("Summarize this application's performance.");
    await goTo("settings/general");

    expect(screen.queryByTitle("Remove page context")).not.toBeInTheDocument();
    expect(
      screen.queryByTitle("Attach this page as context for your questions"),
    ).not.toBeInTheDocument();
    const request: PostRequest = await sendQuestion();
    expect(request.data["conversationId"]).toBe(CONVERSATION_ID);
    expect(request.data).not.toHaveProperty("pageContext");
  });

  test("detaching before navigating to an unsupported page still clears the conversation context", async () => {
    await openAskAi(`rum/${ENTITY_ID}`);
    await sendQuestion("Summarize this application's performance.");
    fireEvent.click(screen.getByTitle("Remove page context"));

    await goTo("settings/general");

    expect(screen.queryByTitle("Remove page context")).not.toBeInTheDocument();
    expect(
      screen.queryByTitle("Attach this page as context for your questions"),
    ).not.toBeInTheDocument();
    const request: PostRequest = await sendQuestion(
      "Now summarize all services.",
    );
    expect(request.data).toEqual(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        pageContext: null,
      }),
    );
  });

  test("switching projects on an unsupported page clears the previous project's detach intent", async () => {
    await openAskAi(`rum/${ENTITY_ID}`);
    await sendQuestion("Summarize this application's performance.");
    fireEvent.click(screen.getByTitle("Remove page context"));
    await goTo("settings/general");

    await goTo("settings/general", OTHER_PROJECT_ID);

    const request: PostRequest = await sendQuestion();
    expect(request.headers["tenantid"]).toBe(OTHER_PROJECT_ID);
    expect(request.data).not.toHaveProperty("conversationId");
    expect(request.data).not.toHaveProperty("pageContext");
  });

  test.each(["reattach", "new supported page"])(
    "%s clears remembered detachment before later unsupported navigation",
    async (action: string) => {
      await openAskAi(`rum/${ENTITY_ID}`);
      await sendQuestion("Summarize this application's performance.");
      fireEvent.click(screen.getByTitle("Remove page context"));

      if (action === "reattach") {
        fireEvent.click(
          screen.getByTitle("Attach this page as context for your questions"),
        );
      } else {
        await goTo(`rum/${OTHER_ENTITY_ID}`);
      }
      await sendQuestion("Summarize the attached application.");
      await goTo("settings/general");

      const request: PostRequest = await sendQuestion();
      expect(request.data["conversationId"]).toBe(CONVERSATION_ID);
      expect(request.data).not.toHaveProperty("pageContext");
    },
  );

  test.each([
    ["logs", AIChatPageContextType.LogsExplorer],
    ["traces", AIChatPageContextType.TracesExplorer],
    ["metrics", AIChatPageContextType.MetricsExplorer],
  ] as Array<[string, AIChatPageContextType]>)(
    "navigating to %s replaces the application context with the explorer",
    async (modulePath: string, type: AIChatPageContextType) => {
      await openAskAi(`rum/${ENTITY_ID}`);
      await goTo(modulePath);

      expect(screen.getByRole("textbox")).toHaveAttribute(
        "placeholder",
        `Ask about your ${modulePath}…`,
      );
      expect(screen.queryByText(/Storefront/)).not.toBeInTheDocument();
      const request: PostRequest = await sendQuestion();
      expect(request.data["pageContext"]).toEqual({ type });
    },
  );

  test("an unreadable application still allows insights with its ID and a generic chip", async () => {
    getItemMock.mockRejectedValue(new Error("Access denied"));
    await openAskAi(`rum/${ENTITY_ID}`);

    expect(screen.getByText("This RUM application")).toBeInTheDocument();
    const request: PostRequest = await sendQuestion();
    expect(request.data["pageContext"]).toEqual({
      type: AIChatPageContextType.RumApplication,
      entityId: ENTITY_ID,
    });
  });
});

describe("asynchronous module context changes", () => {
  test("a delayed application title cannot overwrite a service with the same ID", async () => {
    const oldTitle: PendingTitle = pendingTitle();
    getItemMock.mockImplementation((request: { modelType: unknown }) => {
      return request.modelType === RumApplication
        ? oldTitle.promise
        : Promise.resolve({ name: "Checkout API" });
    });
    await openAskAi(`rum/${ENTITY_ID}`);
    await goTo(`service/${ENTITY_ID}`);
    expect(screen.getByText("This service · Checkout API")).toBeInTheDocument();

    await act(async () => {
      oldTitle.resolve({ name: "Stale application title" });
    });

    expect(screen.getByText("This service · Checkout API")).toBeInTheDocument();
    expect(
      screen.queryByText(/Stale application title/),
    ).not.toBeInTheDocument();
    const request: PostRequest = await sendQuestion();
    expect(request.data["pageContext"]).toEqual({
      type: AIChatPageContextType.TelemetryService,
      entityId: ENTITY_ID,
      entityTitle: "Checkout API",
    });
    expect(getItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelType: Service }),
    );
  });

  test("a delayed title from the previous project cannot overwrite the current project", async () => {
    const oldTitle: PendingTitle = pendingTitle();
    getItemMock.mockImplementation(() => {
      return currentProjectId === PROJECT_ID
        ? oldTitle.promise
        : Promise.resolve({ name: "Other project application" });
    });
    await openAskAi(`rum/${ENTITY_ID}`);
    fireEvent.click(screen.getByTitle("Remove page context"));
    await goTo(`rum/${ENTITY_ID}`, OTHER_PROJECT_ID);

    expect(
      screen.getByText("This RUM application · Other project application"),
    ).toBeInTheDocument();
    await act(async () => {
      oldTitle.resolve({ name: "Old project application" });
    });

    expect(
      screen.queryByText(/Old project application/),
    ).not.toBeInTheDocument();
    const request: PostRequest = await sendQuestion();
    expect(request.headers["tenantid"]).toBe(OTHER_PROJECT_ID);
    expect(request.data["pageContext"]).toEqual({
      type: AIChatPageContextType.RumApplication,
      entityId: ENTITY_ID,
      entityTitle: "Other project application",
    });
  });

  test("closing and reopening invalidates a title request from the previous opening", async () => {
    const oldTitle: PendingTitle = pendingTitle();
    getItemMock.mockReturnValueOnce(oldTitle.promise);
    getItemMock.mockResolvedValue({ name: "Renamed application" });
    await openAskAi(`rum/${ENTITY_ID}`);
    fireEvent.click(screen.getByTitle("Close (Esc)"));

    await act(async () => {
      GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE);
    });
    expect(
      screen.getByText("This RUM application · Renamed application"),
    ).toBeInTheDocument();
    await act(async () => {
      oldTitle.resolve({ name: "Previous application name" });
    });

    expect(
      screen.queryByText(/Previous application name/),
    ).not.toBeInTheDocument();
    const request: PostRequest = await sendQuestion();
    expect(request.data["pageContext"]).toEqual({
      type: AIChatPageContextType.RumApplication,
      entityId: ENTITY_ID,
      entityTitle: "Renamed application",
    });
  });
});
