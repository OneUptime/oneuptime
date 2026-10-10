import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  Location,
  MemoryRouter,
  NavigationType,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * Finding your way around AI / LLM: the product opens on its conversations,
 * the old Overview address forwards there, every tab has its page, its tab
 * and its breadcrumbs, and the command palette knows the new pages.
 *
 * The route group is mounted for real, every page in it replaced by a
 * marker that names it.
 */

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

const PAGE_MODULES: Array<string> = [
  "Conversations",
  "ConversationView",
  "Alerts",
  "Usage",
  "Calls",
  "Budgets",
  "Pricing",
  "Documentation",
];

function LocationProbe(): React.ReactElement {
  const location: Location = useLocation();
  const navigationType: NavigationType = useNavigationType();

  return (
    <div data-testid="location">
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </div>
  );
}

jest.doMock(`${DASHBOARD}/Pages/Llm/Layout`, () => {
  return {
    __esModule: true,
    getActiveLlmTab: (
      jest.requireActual(`${DASHBOARD}/Pages/Llm/Layout`) as {
        getActiveLlmTab: unknown;
      }
    ).getActiveLlmTab,
    default: (): React.ReactElement => {
      const { Outlet } = jest.requireActual("react-router-dom") as {
        Outlet: React.ComponentType;
      };
      return (
        <div data-testid="layout">
          <LocationProbe />
          <Outlet />
        </div>
      );
    },
  };
});

for (const module of PAGE_MODULES) {
  jest.doMock(`${DASHBOARD}/Pages/Llm/${module}`, () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="page">{module}</div>;
      },
    };
  });
}

// Required after the mocks above, which jest.doMock does not hoist.
const LlmRoutes: React.FunctionComponent<Record<string, unknown>> = (
  jest.requireActual(`${DASHBOARD}/Routes/LlmRoutes`) as {
    default: React.FunctionComponent<Record<string, unknown>>;
  }
).default;

const { getActiveLlmTab } = jest.requireActual(`${DASHBOARD}/Pages/Llm/Layout`) as {
  getActiveLlmTab: (path: string) => string;
};

const { default: LlmNavTabs, LLM_TAB_ORDER } = jest.requireActual(
  `${DASHBOARD}/Components/AI/LlmNavTabs`,
) as {
  default: React.FunctionComponent<{ active: string }>;
  LLM_TAB_ORDER: Array<string>;
};

const { getLlmBreadcrumbs } = jest.requireActual(
  `${DASHBOARD}/Utils/Breadcrumbs/LlmBreadcrumbs`,
) as {
  getLlmBreadcrumbs: (path: string) => Array<{ title: string; to: Route }> | undefined;
};

const { PAGE_SEARCH_AREAS } = jest.requireActual(
  `${DASHBOARD}/Components/CommandPalette/PageSearchIndex`,
) as {
  PAGE_SEARCH_AREAS: ReadonlyArray<{
    title: string;
    sections: ReadonlyArray<{ pages: ReadonlyArray<{ page: string; title: string; keywords?: Array<string> }> }>;
  }>;
};

const BASE: string = `/dashboard/${PROJECT_ID}/llm`;

function visit(url: string): void {
  goTo(url.split("?")[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteMap[PageMap.LLM_ROOT]!.toString()}
          element={
            <LlmRoutes
              pageRoute={new Route(BASE)}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function landedOn(): string {
  return (
    (screen.getByTestId("pathname").textContent ?? "") +
    (screen.getByTestId("search").textContent ?? "")
  );
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the AI / LLM pages", () => {
  test("the product opens on its conversations", () => {
    expect(RouteMap[PageMap.LLM]!.toString()).toBe(
      "/dashboard/:projectId/llm/conversations",
    );
  });

  test.each([
    ["conversations", "Conversations"],
    ["conversations/c%3Achat-1", "ConversationView"],
    ["alerts", "Alerts"],
    ["calls", "Calls"],
    ["usage", "Usage"],
    ["budgets", "Budgets"],
    ["pricing", "Pricing"],
    ["documentation", "Documentation"],
  ])("…/llm/%s is the %s page", (path: string, page: string) => {
    visit(`${BASE}/${path}`);

    expect(screen.getByTestId("page")).toHaveTextContent(page);
    expect(landedOn()).toBe(`${BASE}/${path}`);
  });

  test("the conversation page's route is a conversation inside conversations", () => {
    expect(RouteMap[PageMap.LLM_CONVERSATION_VIEW]!.toString()).toBe(
      "/dashboard/:projectId/llm/conversations/:id",
    );
  });
});

describe("the old Overview address", () => {
  test("forwards to the conversations, replacing itself in the history", () => {
    visit(`${BASE}/overview`);

    expect(landedOn()).toBe(`${BASE}/conversations`);
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
    expect(screen.getByTestId("page")).toHaveTextContent("Conversations");
  });

  test("keeps the query a bookmark carried", () => {
    visit(`${BASE}/overview?range=PAST_ONE_DAY`);

    expect(landedOn()).toBe(`${BASE}/conversations?range=PAST_ONE_DAY`);
  });

  test("no page is at the old address any more", () => {
    expect(RouteMap[PageMap.LLM]!.toString()).not.toContain("overview");

    const pagesAtOverview: Array<string> = Object.entries(RouteMap)
      .filter(([key, route]: [string, Route]): boolean => {
        return (
          key !== PageMap.LLM_OVERVIEW &&
          route.toString() === "/dashboard/:projectId/llm/overview"
        );
      })
      .map(([key]: [string, Route]): string => {
        return key;
      });

    expect(pagesAtOverview).toEqual([]);
  });
});

describe("the tabs", () => {
  test.each([
    [`${BASE}/conversations`, "conversations"],
    [`${BASE}/conversations/c%3Achat-1`, "conversations"],
    [`${BASE}/calls`, "calls"],
    [`${BASE}/usage`, "usage"],
    [`${BASE}/alerts`, "alerts"],
    [`${BASE}/budgets`, "budgets"],
    [`${BASE}/pricing`, "pricing"],
    [`${BASE}/documentation`, "setup"],
    [`${BASE}/something-new`, "conversations"],
  ])("%s is under the %s tab", (path: string, tab: string) => {
    expect(getActiveLlmTab(path)).toBe(tab);
  });

  test("in the order a person uses them, Setup last", () => {
    expect(LLM_TAB_ORDER).toEqual([
      "conversations",
      "calls",
      "usage",
      "alerts",
      "budgets",
      "pricing",
      "setup",
    ]);
  });

  test("each tab links to its page", () => {
    render(
      <MemoryRouter>
        <LlmNavTabs active="alerts" />
      </MemoryRouter>,
    );

    const hrefs: Array<string | null> = Array.from(
      document.querySelectorAll("a"),
    ).map((link: HTMLAnchorElement): string | null => {
      return link.getAttribute("href");
    });

    expect(hrefs).toEqual([
      `${BASE}/conversations`,
      `${BASE}/calls`,
      `${BASE}/usage`,
      `${BASE}/alerts`,
      `${BASE}/budgets`,
      `${BASE}/pricing`,
      `${BASE}/documentation`,
    ]);
  });
});

describe("the breadcrumbs", () => {
  function titles(page: PageMap): Array<string> | undefined {
    return getLlmBreadcrumbs(RouteMap[page]!.toString())?.map(
      (link: { title: string }): string => {
        return link.title;
      },
    );
  }

  test("every page has its trail", () => {
    expect(titles(PageMap.LLM_CONVERSATIONS)).toEqual(["Project", "AI / LLM", "Conversations"]);
    expect(titles(PageMap.LLM_CONVERSATION_VIEW)).toEqual([
      "Project",
      "AI / LLM",
      "Conversations",
      "Conversation",
    ]);
    expect(titles(PageMap.LLM_ALERTS)).toEqual(["Project", "AI / LLM", "Alerts"]);
    expect(titles(PageMap.LLM_CALLS)).toEqual(["Project", "AI / LLM", "Calls"]);
    expect(titles(PageMap.LLM_USAGE)).toEqual(["Project", "AI / LLM", "Usage"]);
    expect(titles(PageMap.LLM_BUDGETS)).toEqual(["Project", "AI / LLM", "Budgets"]);
    expect(titles(PageMap.LLM_PRICING)).toEqual(["Project", "AI / LLM", "Pricing"]);
  });

  test("a conversation's trail leads back to the conversations", () => {
    // The trail's links are resolved against the address the reader is on.
    goTo(`${BASE}/conversations/c%3Achat-1`);

    const trail: Array<{ title: string; to: Route }> | undefined = getLlmBreadcrumbs(
      RouteMap[PageMap.LLM_CONVERSATION_VIEW]!.toString(),
    );

    expect(trail?.[2]?.to.toString()).toBe(`${BASE}/conversations`);
  });
});

describe("the command palette", () => {
  function llmPages(): Array<{ page: string; title: string; keywords?: Array<string> }> {
    const pages: Array<{ page: string; title: string; keywords?: Array<string> }> = [];

    for (const area of PAGE_SEARCH_AREAS) {
      for (const section of area.sections) {
        for (const page of section.pages) {
          if (String(page.page).startsWith("LLM_")) {
            pages.push(page);
          }
        }
      }
    }

    return pages;
  }

  test("finds the conversations, the calls and the alerts, and no Overview", () => {
    const pages: Array<string> = llmPages().map((page: { page: string }): string => {
      return page.page;
    });

    expect(pages).toEqual(
      expect.arrayContaining([PageMap.LLM_CONVERSATIONS, PageMap.LLM_CALLS, PageMap.LLM_ALERTS]),
    );
    expect(pages).not.toContain(PageMap.LLM_OVERVIEW);
  });

  test("by the words people search with", () => {
    const keywordsOf: (page: PageMap) => Array<string> = (page: PageMap): Array<string> => {
      return (
        llmPages().find((entry: { page: string }): boolean => {
          return entry.page === page;
        })?.keywords || []
      );
    };

    expect(keywordsOf(PageMap.LLM_CONVERSATIONS)).toEqual(
      expect.arrayContaining(["replay", "chats", "prompts"]),
    );
    expect(keywordsOf(PageMap.LLM_ALERTS)).toEqual(
      expect.arrayContaining(["bad answers", "refusals", "ai monitor"]),
    );
  });
});
