import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import AIChatPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AIChatPanel";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";

/*
 * Issue: "when AI features are disabled for the app, Ask AI is not".
 *
 * A project can switch AI off (Project.enableAi, on Settings > AI Credits), or
 * simply never configure an LLM provider (Settings > AI > LLM Providers), or
 * sit on a plan that does not include AI at all. In every one of those states
 * the server refuses a chat turn — and Ask AI still looked completely ready:
 * the header button opened a composer, the suggested prompts were clickable,
 * and the only mention of the switch was a red banner AFTER the user had
 * written a question and pressed send. The person hitting it is usually not
 * the person who flipped the switch, so "it just says no" is a support ticket.
 *
 * These tests render the REAL Ask AI panel the dashboard mounts, drive it the
 * way the header does (the AI_CHAT_TOGGLE global event), and assert the two
 * halves of the fix that a refactor could quietly undo:
 *
 *   1. the composer is GONE, not merely decorated with a warning; and
 *   2. what replaces it says AI is off and names the settings page that turns
 *      it back on — the reason it is off decides which page.
 *
 * The panel's fail-open posture is pinned too. The verdict arrives on the same
 * request as the provider list, and that request can be slow, can fail, or can
 * be refused for a member without provider-read permission. Guessing
 * "disabled" there would lock a perfectly healthy assistant behind a setup
 * notice, which is a worse bug than the one being fixed.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const isAccessibleOnPlanMock: MockFunction = getJestMockFunction();

const PROJECT_ID: string = "11111111-1111-1111-1111-111111111111";

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
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

/*
 * Page context detection reads the browser route through Navigation, which is
 * not wired up under MemoryRouter. Ask AI's context chip is not what is under
 * test here, so it is switched off rather than simulated.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext",
  () => {
    return {
      __esModule: true,
      default: {
        detectPageContext: () => {
          return null;
        },
        resolveEntityTitle: async () => {
          return null;
        },
        getSuggestions: () => {
          return [];
        },
        toRequestPayload: () => {
          return {};
        },
      },
    };
  },
);

/*
 * The download menu pulls the markdown/PDF export stack, which is ESM the
 * browser suite's transform does not take. Nothing under test here opens it.
 */
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

/*
 * The plan verdict is read straight off local storage and the build's billing
 * flag, neither of which exists here. Mocking the predicate keeps the plan
 * reason drivable without pretending to be a Stripe subscription.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIPlanGate",
  () => {
    return {
      __esModule: true,
      isAIAccessibleOnCurrentPlan: () => {
        return isAccessibleOnPlanMock();
      },
      default: () => {
        return null;
      },
    };
  },
);

interface ProvidersResponse {
  isAIEnabledForProject?: boolean | undefined;
  providerCount?: number | undefined;
}

function providersPayload(data: ProvidersResponse): JSONObject {
  const providers: Array<JSONObject> = [];

  for (let index: number = 0; index < (data.providerCount ?? 1); index++) {
    providers.push({
      id: `provider-${index}`,
      name: `Provider ${index}`,
      description: null,
      llmType: "OpenAI",
      modelName: "gpt-4o",
      isDefault: index === 0,
      isGlobal: false,
    });
  }

  return {
    isAIEnabledForProject: data.isAIEnabledForProject ?? true,
    defaultProviderId: providers[0]?.["id"] ?? null,
    providers: providers,
  };
}

function respondWithProviders(data: ProvidersResponse): void {
  postMock.mockImplementation(async () => {
    return new HTTPResponse<JSONObject>(200, providersPayload(data), {});
  });
}

async function openAskAi(): Promise<void> {
  render(
    <MemoryRouter>
      <AIChatPanel />
    </MemoryRouter>,
  );

  // Exactly what the header's Ask AI button does.
  await act(async () => {
    GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE);
  });

  // Let the providers request settle.
  await act(async () => {
    await Promise.resolve();
  });
}

function composer(): HTMLElement | null {
  return document.querySelector("textarea");
}

function settingsLinkHref(): string | null {
  const links: Array<HTMLAnchorElement> = Array.from(
    document.querySelectorAll("a[href]"),
  );

  return links.length > 0
    ? links[links.length - 1]!.getAttribute("href")
    : null;
}

beforeEach(() => {
  postMock.mockReset();
  getListMock.mockReset();
  isAccessibleOnPlanMock.mockReset();

  isAccessibleOnPlanMock.mockImplementation(() => {
    return true;
  });
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 25 };
  });
  respondWithProviders({});
});

afterEach(() => {
  cleanup();
});

describe("Ask AI on a project whose AI is switched off", () => {
  test("says AI is disabled for the project instead of inviting a question", async () => {
    respondWithProviders({ isAIEnabledForProject: false });

    await openAskAi();

    expect(
      screen.getByText("AI features are disabled for this project"),
    ).toBeInTheDocument();
  });

  test("names the settings page that owns the switch", async () => {
    respondWithProviders({ isAIEnabledForProject: false });

    await openAskAi();

    expect(
      screen.getByText("Go to Project Settings > AI Credits"),
    ).toBeInTheDocument();
    expect(settingsLinkHref()).toContain("/settings/ai-credits");
  });

  test("the link is scoped to the project the user is in", async () => {
    respondWithProviders({ isAIEnabledForProject: false });

    await openAskAi();

    expect(settingsLinkHref()).toContain(PROJECT_ID);
  });

  test("the composer is withheld — there is nothing to type a question into", async () => {
    respondWithProviders({ isAIEnabledForProject: false });

    await openAskAi();

    expect(composer()).toBeNull();
  });

  test("the suggested prompts are gone too, so no click can start a doomed turn", async () => {
    respondWithProviders({ isAIEnabledForProject: false });

    await openAskAi();

    expect(screen.queryByText("Top exceptions")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Ask AI about your data — or tell it to act"),
    ).not.toBeInTheDocument();
  });

  test("no message is ever sent from this state", async () => {
    respondWithProviders({ isAIEnabledForProject: false });

    await openAskAi();

    for (const call of postMock.mock.calls) {
      const url: string = String(
        (call[0] as { url?: unknown })?.url ?? call[0],
      );
      expect(url).not.toContain("send-message");
    }
  });
});

describe("Ask AI on a project with no LLM provider", () => {
  test("says so, and points at the provider page rather than the AI toggle", async () => {
    respondWithProviders({ providerCount: 0 });

    await openAskAi();

    expect(
      screen.getByText("No LLM provider is configured for this project"),
    ).toBeInTheDocument();
    expect(settingsLinkHref()).toContain("/settings/llm-providers");
  });

  test("the composer is withheld here too — a message would have nowhere to go", async () => {
    respondWithProviders({ providerCount: 0 });

    await openAskAi();

    expect(composer()).toBeNull();
  });

  test("the project's own kill switch wins when both are off — enabling a provider first would not help", async () => {
    respondWithProviders({ isAIEnabledForProject: false, providerCount: 0 });

    await openAskAi();

    expect(
      screen.getByText("AI features are disabled for this project"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No LLM provider is configured for this project"),
    ).not.toBeInTheDocument();
  });
});

describe("Ask AI on a plan that does not include AI", () => {
  test("sends the user to billing, not to a toggle they cannot use yet", async () => {
    isAccessibleOnPlanMock.mockImplementation(() => {
      return false;
    });

    await openAskAi();

    expect(
      screen.getByText("AI is not included in this project's plan"),
    ).toBeInTheDocument();
    expect(settingsLinkHref()).toContain("/settings/billing");
    expect(composer()).toBeNull();
  });

  test("the plan wins over the project toggle — the toggle is unreachable without the plan", async () => {
    isAccessibleOnPlanMock.mockImplementation(() => {
      return false;
    });
    respondWithProviders({ isAIEnabledForProject: false });

    await openAskAi();

    expect(
      screen.getByText("AI is not included in this project's plan"),
    ).toBeInTheDocument();
  });
});

describe("Ask AI stays open for business unless it actually hears otherwise", () => {
  test("a healthy project gets the composer and the prompts, with no notice", async () => {
    await openAskAi();

    expect(composer()).not.toBeNull();
    expect(
      screen.getByText("Ask AI about your data — or tell it to act"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("AI features are disabled for this project"),
    ).not.toBeInTheDocument();
  });

  test("a providers request that fails does not accuse the project of having AI off", async () => {
    postMock.mockImplementation(async () => {
      throw new Error("network");
    });

    await openAskAi();

    expect(composer()).not.toBeNull();
    expect(
      screen.queryByText("AI features are disabled for this project"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No LLM provider is configured for this project"),
    ).not.toBeInTheDocument();
  });

  test("an older server that does not report the switch is treated as enabled", async () => {
    postMock.mockImplementation(async () => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          defaultProviderId: "provider-0",
          providers: [
            {
              id: "provider-0",
              name: "Provider 0",
              isDefault: true,
              isGlobal: false,
            },
          ],
        },
        {},
      );
    });

    await openAskAi();

    expect(composer()).not.toBeNull();
    expect(
      screen.queryByText("AI features are disabled for this project"),
    ).not.toBeInTheDocument();
  });
});
