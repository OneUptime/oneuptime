import "@testing-library/jest-dom";
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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The User Flows page's layout, rendered: what comes first, for everyone and
 * for one person (issue #6192 - narrowed to one user, the page listed their
 * journeys first and drew the map under them), and what the page says when
 * there is nothing to draw. The decisions are pinned one by one in
 * App/Tests/Dashboard/UserFlowPageSections.test.ts; this is the page that
 * draws them. Who is on screen while reads overtake one another is
 * UserFlowsPageScope.test.tsx.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import RumApplicationUserFlows from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/UserFlows";

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/user-flows`;
const ORIGIN: string = "https://shop.example.com";
const JANE_KEY: string = "a".repeat(64);
const VISITOR_ID: string = "0123456789abcdef0123456789abcdef";
const JANE_SESSION: string = "c0000000000000000000000000000001";

interface SessionSpec {
  id: string;
  pages: Array<string>;
  deviceType?: string;
  errorCount?: number;
}

function answer(
  specs: Array<SessionSpec>,
  scope: JSONObject | null,
): HTTPResponse<JSONObject> {
  const pages: Array<string> = [];
  const indexOf: (path: string) => number = (path: string): number => {
    const url: string = `${ORIGIN}${path}`;

    if (!pages.includes(url)) {
      pages.push(url);
    }

    return pages.indexOf(url);
  };

  return new HTTPResponse(
    200,
    {
      sessions: specs.map((spec: SessionSpec, position: number): JSONObject => {
        return {
          sessionId: spec.id,
          startUnixMs: 1_800_000_000_000 - position * 60_000,
          durationMs: 60_000,
          deviceType: spec.deviceType ?? "desktop",
          browserName: "Chrome",
          countryCode: "DK",
          errorCount: spec.errorCount ?? 0,
          frustrationCount: 0,
          pages: spec.pages.map(indexOf),
          pageSignals: [],
          hasRecording: scope !== null,
        };
      }),
      pages: pages,
      sessionsInWindow: specs.length,
      isSampled: false,
      maxSessions: 5000,
      startUnixMs: 0,
      endUnixMs: 1,
      scope: scope,
    } as unknown as JSONObject,
    {},
  );
}

const JANE_SCOPE: JSONObject = {
  kind: "user",
  identifiedUserKey: JANE_KEY,
  visitorId: "",
  sessionId: "",
  identifiedUserLabel: "jane@example.com",
};

/* Everyone: five sessions, enough for the findings. */
const EVERYONE: Array<SessionSpec> = [
  { id: "e1", pages: ["/", "/cart", "/checkout"] },
  { id: "e2", pages: ["/", "/cart"] },
  { id: "e3", pages: ["/"] },
  { id: "e4", pages: ["/", "/help"] },
  { id: "e5", pages: ["/products/1", "/cart"], deviceType: "mobile" },
];

/* Jane: three sessions, on two devices, one with errors. */
const JANE: Array<SessionSpec> = [
  { id: JANE_SESSION, pages: ["/", "/cart", "/checkout"], errorCount: 2 },
  { id: "c0000000000000000000000000000002", pages: ["/login", "/account"] },
  {
    id: "c0000000000000000000000000000003",
    pages: ["/"],
    deviceType: "mobile",
  },
];

type Answerer = (filters: JSONObject | undefined) => Promise<unknown>;

let answerer: Answerer;
let flowReads: Array<JSONObject | undefined> = [];

/* What the server says for a read with these filters, by default. */
function answerFor(filters: JSONObject | undefined): HTTPResponse<JSONObject> {
  if (filters?.["identifiedUserKey"] === JANE_KEY) {
    return answer(JANE, JANE_SCOPE);
  }

  if (filters?.["identifiedUserRef"] === "jane@example.com") {
    return answer(JANE, JANE_SCOPE);
  }

  if (filters?.["visitorId"] === VISITOR_ID) {
    return answer([{ id: "v1", pages: ["/", "/help"] }], {
      kind: "visitor",
      identifiedUserKey: "",
      visitorId: VISITOR_ID,
      sessionId: "",
    });
  }

  if (filters?.["sessionId"] === JANE_SESSION) {
    return answer([JANE[0] as SessionSpec], {
      ...JANE_SCOPE,
      kind: "session",
      visitorId: VISITOR_ID,
      sessionId: JANE_SESSION,
    });
  }

  return answer(EVERYONE, null);
}

function renderPage(search: string = ""): void {
  window.history.replaceState(null, "", `${PAGE_PATH}${search}`);

  render(
    <MemoryRouter>
      <RumApplicationUserFlows
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

/* The sections the body draws, top to bottom. */
function sections(): Array<string | null> {
  return Array.from(screen.getByTestId("user-flow-sections").children).map(
    (child: Element): string | null => {
      return child.getAttribute("data-section");
    },
  );
}

function section(name: string): HTMLElement {
  return screen
    .getByTestId("user-flow-sections")
    .querySelector(`[data-section="${name}"]`) as HTMLElement;
}

async function waitForSections(expected: Array<string>): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByTestId("user-flow-sections")).not.toBeNull();
    expect(sections()).toEqual(expected);
  });
}

/* Every element given is drawn above the next one. */
function expectTopToBottom(elements: Array<HTMLElement>): void {
  for (let index: number = 1; index < elements.length; index++) {
    const above: HTMLElement = elements[index - 1] as HTMLElement;
    const below: HTMLElement = elements[index] as HTMLElement;

    expect(
      above.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
}

function sessionsHint(): string {
  return (
    within(screen.getByTestId("user-flow-tile-sessions")).getByTestId(
      "user-flow-tile-sessions-value",
    ).nextElementSibling?.textContent || ""
  );
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  flowReads = [];
  answerer = (filters: JSONObject | undefined): Promise<unknown> => {
    return Promise.resolve(answerFor(filters));
  };
  postMock.mockReset();
  postMock.mockImplementation(
    (request: { url: { toString: () => string }; data: JSONObject }) => {
      if (request.url.toString().includes("/session-replay/users")) {
        return Promise.resolve(
          new HTTPResponse(200, { users: [], nextCursor: null }, {}),
        );
      }

      const filters: JSONObject | undefined = request.data["filters"] as
        | JSONObject
        | undefined;

      flowReads.push(filters);

      return answerer(filters);
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("the map and its numbers come first, for everyone and for one person", () => {
  test("everyone: the numbers and findings, then the map, then the tables", async () => {
    renderPage();
    await waitForSections(["overview", "map", "tables"]);

    expect(screen.queryByTestId("user-flow-scope")).toBeNull();
    expect(screen.queryByTestId("user-flow-journeys")).toBeNull();
    expectTopToBottom([
      screen.getByTestId("user-flow-toolbar"),
      screen.getByTestId("user-flow-tile-sessions"),
      screen.getByTestId("user-flow-insights"),
      screen.getByTestId("user-flow-map"),
      screen.getByTestId("user-flow-tables"),
    ]);
  });

  test("one user: who it is, then their numbers and map, then their journeys, then the tables", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitForSections(["overview", "map", "journeys", "tables"]);

    expectTopToBottom([
      screen.getByTestId("user-flow-scope"),
      screen.getByTestId("user-flow-toolbar"),
      screen.getByTestId("user-flow-tile-sessions"),
      screen.getByTestId("user-flow-map"),
      screen.getByTestId("user-flow-journeys"),
      screen.getByTestId("user-flow-tables"),
    ]);
    expect(
      within(section("overview")).getByTestId("user-flow-tile-sessions"),
    ).toBeInTheDocument();
    expect(
      within(section("map")).getByTestId("user-flow-map"),
    ).toBeInTheDocument();
    expect(
      within(section("journeys")).getAllByTestId("user-flow-journey"),
    ).toHaveLength(3);
    expect(
      within(section("tables")).getByTestId("user-flow-tables"),
    ).toBeInTheDocument();
  });

  test.each([
    ["an anonymous visitor", `?visitor=${VISITOR_ID}`, 1],
    ["one session", `?sessionId=${JANE_SESSION}`, 1],
  ])(
    "%s reads the same way",
    async (_name: string, search: string, journeys: number) => {
      renderPage(search);
      await waitForSections(["overview", "map", "journeys", "tables"]);

      expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(journeys);
      expectTopToBottom([
        screen.getByTestId("user-flow-scope"),
        screen.getByTestId("user-flow-tile-sessions"),
        screen.getByTestId("user-flow-map"),
        screen.getByTestId("user-flow-journeys"),
        screen.getByTestId("user-flow-tables"),
      ]);
    },
  );

  test("picking a person adds their journeys under the map and moves nothing else", async () => {
    renderPage();
    await waitForSections(["overview", "map", "tables"]);

    const input: HTMLElement = screen.getByTestId("user-flow-scope-input");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "jane@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitForSections(["overview", "map", "journeys", "tables"]);
    expect(screen.getByTestId("user-flow-scope-name")).toHaveTextContent(
      "jane@example.com",
    );
  });

  test("Show all users takes the journeys away and leaves the rest where it was", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitForSections(["overview", "map", "journeys", "tables"]);

    fireEvent.click(screen.getByTestId("user-flow-scope-clear"));

    await waitForSections(["overview", "map", "tables"]);
    expect(screen.queryByTestId("user-flow-scope")).toBeNull();
  });

  test("a page clicked on a person's map opens its panel under the map, above their journeys", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitForSections(["overview", "map", "journeys", "tables"]);

    fireEvent.click(
      screen
        .getAllByTestId("user-flow-node")
        .find((node: HTMLElement): boolean => {
          return (
            node.getAttribute("data-page") === "/" &&
            node.getAttribute("data-step") === "0"
          );
        }) as HTMLElement,
    );

    const detail: HTMLElement = await screen.findByTestId("user-flow-detail");

    expect(section("map")).toContainElement(detail);
    expectTopToBottom([
      screen.getByTestId("user-flow-map"),
      detail,
      screen.getByTestId("user-flow-journeys"),
    ]);
  });
});

describe("the numbers say whose they are", () => {
  test.each([
    ["everyone", "", "recorded sessions in range"],
    ["one user", `?userKey=${JANE_KEY}`, "this user's sessions in range"],
    [
      "an anonymous visitor",
      `?visitor=${VISITOR_ID}`,
      "this visitor's sessions in range",
    ],
    ["one session", `?sessionId=${JANE_SESSION}`, "this session only"],
  ])(
    "Sessions analysed, for %s",
    async (_name: string, search: string, hint: string) => {
      renderPage(search);
      await waitFor(() => {
        expect(screen.queryByTestId("user-flow-tile-sessions")).not.toBeNull();
      });

      expect(sessionsHint()).toBe(hint);
    },
  );
});

describe("one person with very little to show", () => {
  test("one session that saw one page still draws the whole page, and says they left without navigating", async () => {
    answerer = (): Promise<unknown> => {
      return Promise.resolve(
        answer([{ id: JANE_SESSION, pages: ["/pricing"] }], JANE_SCOPE),
      );
    };

    renderPage(`?userKey=${JANE_KEY}`);
    await waitForSections(["overview", "map", "journeys", "tables"]);

    expect(
      screen.getByTestId("user-flow-tile-sessions-value"),
    ).toHaveTextContent("1");
    expect(screen.getByTestId("user-flow-tile-bounce-value")).toHaveTextContent(
      "100%",
    );
    /* One session leads nothing: its landing page is the tile's to name. */
    expect(screen.queryByTestId("user-flow-insights")).toBeNull();
    expect(screen.getByTestId("user-flow-tile-entry-value")).toHaveAttribute(
      "data-value",
      "/pricing",
    );
    expect(screen.getAllByTestId("user-flow-node")).toHaveLength(1);
    expect(screen.getByTestId("user-flow-journey-summary")).toHaveTextContent(
      "Left without navigating",
    );
    expect(screen.getByTestId("user-flow-scope-detail")).toHaveTextContent(
      "Identified user · 1 session in this range",
    );
  });
});

describe("filters that leave nothing", () => {
  test("for one person: one line where the map would be, under who it is and the filters", async () => {
    renderPage(`?userKey=${JANE_KEY}&device=tablet`);

    await waitFor(() => {
      expect(
        screen.getByText("No session matches these filters"),
      ).toBeVisible();
    });
    expect(screen.queryByTestId("user-flow-sections")).toBeNull();
    expect(screen.queryByTestId("user-flow-tile-sessions")).toBeNull();
    expect(screen.queryByTestId("user-flow-map")).toBeNull();
    /* Said once, not again in an empty list of journeys. */
    expect(screen.queryByTestId("user-flow-journeys-empty")).toBeNull();
    expect(screen.getByTestId("user-flow-scope-name")).toHaveTextContent(
      "jane@example.com",
    );
    expect(screen.getByTestId("user-flow-device-filter")).toHaveValue("tablet");
    expectTopToBottom([
      screen.getByTestId("user-flow-scope"),
      screen.getByTestId("user-flow-toolbar"),
      screen.getByTestId("user-flow-filtered-empty-clear"),
    ]);
  });

  test("Clear filters brings every session back without asking the server again", async () => {
    renderPage(`?userKey=${JANE_KEY}&device=tablet&sessions=errors&hide=%2F`);
    await waitFor(() => {
      expect(
        screen.getByTestId("user-flow-filtered-empty-clear"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("user-flow-filtered-empty-clear"));

    await waitForSections(["overview", "map", "journeys", "tables"]);
    expect(screen.getAllByTestId("user-flow-journey")).toHaveLength(3);
    expect(screen.getByTestId("user-flow-device-filter")).toHaveValue("");
    expect(screen.getByTestId("user-flow-session-filter")).toHaveValue("all");
    expect(screen.queryByTestId("user-flow-hidden-pages")).toBeNull();
    expect(window.location.search).not.toMatch(/device=|sessions=|hide=/);
    expect(window.location.search).toContain(`userKey=${JANE_KEY}`);
    expect(flowReads).toHaveLength(1);
  });

  test("Clear filters keeps where the map starts", async () => {
    renderPage(`?userKey=${JANE_KEY}&device=tablet&page=%2Fcart&steps=3`);
    await waitFor(() => {
      expect(
        screen.getByTestId("user-flow-filtered-empty-clear"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("user-flow-filtered-empty-clear"));

    await waitForSections(["overview", "map", "journeys", "tables"]);
    expect(screen.getByTestId("user-flow-anchor-select")).toHaveValue("/cart");
    expect(screen.getByTestId("user-flow-steps-select")).toHaveValue("3");
  });

  test("for everyone too, and not taken for a missing install", async () => {
    renderPage("?sessions=errors");

    await waitFor(() => {
      expect(
        screen.getByText("No session matches these filters"),
      ).toBeVisible();
    });
    expect(screen.queryByText("How to install Session Replay")).toBeNull();
    expect(screen.queryByTestId("user-flow-scope")).toBeNull();

    fireEvent.click(screen.getByTestId("user-flow-filtered-empty-clear"));

    await waitForSections(["overview", "map", "tables"]);
    expect(
      screen.getByTestId("user-flow-tile-sessions-value"),
    ).toHaveTextContent("5");
  });

  test("hiding every page a person saw is a filter too", async () => {
    answerer = (): Promise<unknown> => {
      return Promise.resolve(
        answer([{ id: JANE_SESSION, pages: ["/pricing"] }], JANE_SCOPE),
      );
    };

    renderPage(`?userKey=${JANE_KEY}&hide=%2Fpricing`);

    await waitFor(() => {
      expect(
        screen.getByText("No session matches these filters"),
      ).toBeVisible();
    });
    expect(screen.getByTestId("user-flow-hidden-pages")).toHaveTextContent(
      "/pricing",
    );
  });

  test("a person nobody recorded is still said as such, not as a filter", async () => {
    answerer = (): Promise<unknown> => {
      return Promise.resolve(answer([], JANE_SCOPE));
    };

    renderPage(`?userKey=${JANE_KEY}&device=tablet`);

    await waitFor(() => {
      expect(
        screen.getByText("No recorded sessions for this user in this range"),
      ).toBeVisible();
    });
    expect(screen.queryByText("No session matches these filters")).toBeNull();
  });
});

describe("loading and failed reads", () => {
  test("while a person's first read runs, the banner names them and nothing else is drawn", async () => {
    let release: (value: unknown) => void = (): void => {
      /* replaced below */
    };

    answerer = (): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void) => {
        release = resolve;
      });
    };

    renderPage(`?userKey=${JANE_KEY}`);
    await waitFor(() => {
      expect(flowReads).toHaveLength(1);
    });

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.getByTestId("user-flow-scope")).toBeInTheDocument();
    expect(screen.queryByTestId("user-flow-sections")).toBeNull();

    await act(async (): Promise<void> => {
      release(answerFor({ identifiedUserKey: JANE_KEY }));
      await Promise.resolve();
    });

    await waitForSections(["overview", "map", "journeys", "tables"]);
    expect(screen.queryByTestId("component-loader")).toBeNull();
  });

  test("a refresh keeps the page on screen and says Updating on the map", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitForSections(["overview", "map", "journeys", "tables"]);

    answerer = (): Promise<unknown> => {
      return new Promise(() => {
        /* never answers */
      });
    };

    fireEvent.click(screen.getByTestId("user-flow-more"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Refresh",
      }),
    );

    await waitFor(() => {
      expect(within(section("map")).getByText("Updating…")).toBeVisible();
    });
    expect(sections()).toEqual(["overview", "map", "journeys", "tables"]);
  });

  test("a refresh that fails says so, rather than leaving the last answer up as if it were current", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitForSections(["overview", "map", "journeys", "tables"]);

    answerer = (): Promise<unknown> => {
      return Promise.reject(
        new HTTPErrorResponse(
          500,
          { message: "ClickHouse is not reachable" },
          {},
        ),
      );
    };

    fireEvent.click(screen.getByTestId("user-flow-more"));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Refresh",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/ClickHouse is not reachable/)).toBeVisible();
    });
    expect(screen.queryByTestId("user-flow-sections")).toBeNull();
    /* The banner still says who the page is about. */
    expect(screen.getByTestId("user-flow-scope-name")).toHaveTextContent(
      "jane@example.com",
    );

    answerer = (filters: JSONObject | undefined): Promise<unknown> => {
      return Promise.resolve(answerFor(filters));
    };

    fireEvent.click(screen.getByTestId("refresh-button"));
    await settle();

    await waitForSections(["overview", "map", "journeys", "tables"]);
    expect(flowReads).toHaveLength(3);
  });
});
