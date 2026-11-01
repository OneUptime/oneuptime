import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
 * The User Flows page narrowed to one person, against answers this file holds
 * back and releases. The browser suite's fixture answers at once, which cannot
 * show what this page must never do: draw one person's journeys under
 * another's name. It has two ways to get there, a read that was overtaken and
 * a read still on screen when the person changes.
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
const JANE_KEY: string = "a".repeat(64);
const BOB_KEY: string = "b".repeat(64);
const JANE_SESSION: string = "c0000000000000000000000000000001";
const BOB_SESSION: string = "c0000000000000000000000000000002";

interface Held {
  data: JSONObject;
  release: (response: unknown) => void;
  fail: (error: unknown) => void;
}

let held: Array<Held> = [];

function journeys(data: {
  sessionId: string;
  page: string;
  scope: JSONObject | null;
}): HTTPResponse<JSONObject> {
  return new HTTPResponse(
    200,
    {
      pages: [`https://shop.example.com${data.page}`],
      sessions: [
        {
          sessionId: data.sessionId,
          startUnixMs: 1_800_000_000_000,
          durationMs: 60_000,
          deviceType: "desktop",
          browserName: "Chrome",
          countryCode: "DK",
          errorCount: 0,
          frustrationCount: 0,
          pages: [0],
          pageSignals: [],
          hasRecording: true,
        },
      ],
      sessionsInWindow: 1,
      isSampled: false,
      maxSessions: 5000,
      startUnixMs: 0,
      endUnixMs: 1,
      scope: data.scope,
    } as unknown as JSONObject,
    {},
  );
}

function janesAnswer(): HTTPResponse<JSONObject> {
  return journeys({
    sessionId: JANE_SESSION,
    page: "/jane",
    scope: {
      kind: "user",
      identifiedUserKey: JANE_KEY,
      visitorId: "",
      sessionId: "",
      identifiedUserLabel: "jane@example.com",
    },
  });
}

function bobsAnswer(): HTTPResponse<JSONObject> {
  return journeys({
    sessionId: BOB_SESSION,
    page: "/bob",
    scope: {
      kind: "user",
      identifiedUserKey: BOB_KEY,
      visitorId: "",
      sessionId: "",
      identifiedUserLabel: "bob@example.com",
    },
  });
}

/* Held back until the test releases it; /users answers with nobody. */
function holdReads(): void {
  postMock.mockImplementation(
    (request: { url: { toString: () => string }; data: JSONObject }) => {
      if (request.url.toString().includes("/session-replay/users")) {
        return Promise.resolve(
          new HTTPResponse(200, { users: [], nextCursor: null }, {}),
        );
      }

      return new Promise(
        (
          resolve: (value: unknown) => void,
          reject: (error: unknown) => void,
        ) => {
          held.push({ data: request.data, release: resolve, fail: reject });
        },
      );
    },
  );
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

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

async function answer(index: number, response: unknown): Promise<void> {
  await act(async (): Promise<void> => {
    (held[index] as Held).release(response);
    await Promise.resolve();
  });
}

function shownSessionIds(): Array<string | null> {
  return screen
    .queryAllByTestId("user-flow-journey")
    .map((row: HTMLElement): string | null => {
      return row.getAttribute("data-session-id");
    });
}

async function lookUp(reference: string): Promise<void> {
  const input: HTMLElement = screen.getByTestId("user-flow-scope-input");

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: reference } });
  fireEvent.keyDown(input, { key: "Enter" });

  await settle();
}

beforeEach(() => {
  held = [];
  postMock.mockReset();
  holdReads();
});

afterEach(() => {
  cleanup();
});

describe("one person's journeys are never drawn under another's name", () => {
  test("a person's read that lands after the next one was asked for is dropped", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });

    await lookUp("bob@example.com");
    await waitFor(() => {
      expect(held).toHaveLength(2);
    });

    /* Bob answers first, then Jane's slower read comes in behind him. */
    await answer(1, bobsAnswer());
    await waitFor(() => {
      expect(shownSessionIds()).toEqual([BOB_SESSION]);
    });

    await answer(0, janesAnswer());

    expect(shownSessionIds()).toEqual([BOB_SESSION]);
    expect(window.location.search).toContain(`userKey=${BOB_KEY}`);
  });

  test("the last person's journeys go the moment the person changes", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });
    await answer(0, janesAnswer());
    await waitFor(() => {
      expect(shownSessionIds()).toEqual([JANE_SESSION]);
    });

    await lookUp("bob@example.com");

    /* Bob's read has not been answered: nobody's journeys are on screen. */
    expect(shownSessionIds()).toEqual([]);
    expect(screen.queryByTestId("user-flow-tile-sessions")).toBeNull();
    expect(screen.getByTestId("user-flow-scope-name")).toHaveTextContent(
      "bob@example.com",
    );

    await answer(1, bobsAnswer());
    await waitFor(() => {
      expect(shownSessionIds()).toEqual([BOB_SESSION]);
    });
  });

  test("going back to everyone does not show the person as everyone", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });
    await answer(0, janesAnswer());
    await waitFor(() => {
      expect(shownSessionIds()).toEqual([JANE_SESSION]);
    });

    fireEvent.click(screen.getByTestId("user-flow-scope-clear"));
    await settle();

    expect(screen.queryByTestId("user-flow-tile-sessions")).toBeNull();
    await waitFor(() => {
      expect(held).toHaveLength(2);
    });
    expect((held[1] as Held).data).not.toHaveProperty("filters");
  });

  test("a read for everyone overtaken by a person's is dropped", async () => {
    renderPage();
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });

    await lookUp("jane@example.com");
    await waitFor(() => {
      expect(held).toHaveLength(2);
    });

    await answer(1, janesAnswer());
    await answer(
      0,
      journeys({ sessionId: "everyone", page: "/everyone", scope: null }),
    );

    await waitFor(() => {
      expect(shownSessionIds()).toEqual([JANE_SESSION]);
    });
    expect(
      screen.getByTestId("user-flow-tile-sessions-value"),
    ).toHaveTextContent("1");
  });

  test("an answer for somebody else, or for nobody, is not drawn at all", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });

    await answer(0, bobsAnswer());

    await waitFor(() => {
      expect(
        screen.getByText(/The server did not narrow this read/),
      ).toBeInTheDocument();
    });
    expect(shownSessionIds()).toEqual([]);
    expect(screen.queryByTestId("user-flow-tile-sessions")).toBeNull();
  });
});

describe("changing who the page shows", () => {
  test("picking the person already on screen changes nothing", async () => {
    postMock.mockImplementation(
      (request: { url: { toString: () => string }; data: JSONObject }) => {
        if (request.url.toString().includes("/session-replay/users")) {
          return Promise.resolve(
            new HTTPResponse(
              200,
              {
                users: [
                  {
                    groupKey: `u:${JANE_KEY}`,
                    kind: "identified",
                    identifiedUserKey: JANE_KEY,
                    identifiedUserLabel: "jane@example.com",
                    sessionCount: 1,
                  },
                ],
                nextCursor: null,
              },
              {},
            ),
          );
        }

        return new Promise(
          (
            resolve: (value: unknown) => void,
            reject: (error: unknown) => void,
          ) => {
            held.push({ data: request.data, release: resolve, fail: reject });
          },
        );
      },
    );

    renderPage(`?userKey=${JANE_KEY}`);
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });
    await answer(0, janesAnswer());
    await waitFor(() => {
      expect(shownSessionIds()).toEqual([JANE_SESSION]);
    });

    fireEvent.focus(screen.getByTestId("user-flow-scope-input"));
    await waitFor(() => {
      expect(screen.getAllByTestId("user-flow-scope-option").length).toBe(1);
    });
    fireEvent.click(screen.getByTestId("user-flow-scope-option"));
    await settle();

    /* Still on screen: not cleared and waiting for a read nothing would ask. */
    expect(shownSessionIds()).toEqual([JANE_SESSION]);
    expect(screen.getByTestId("user-flow-tile-sessions")).toBeInTheDocument();
    expect(held).toHaveLength(1);
  });

  test("a map anchored on a page starts over for a person", async () => {
    renderPage("?page=%2Fproducts%2F%3Aid&dir=backward");
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });

    await lookUp("jane@example.com");
    await waitFor(() => {
      expect(held).toHaveLength(2);
    });
    await answer(1, janesAnswer());
    await waitFor(() => {
      expect(shownSessionIds()).toEqual([JANE_SESSION]);
    });

    expect(window.location.search).not.toContain("page=");
    expect(window.location.search).not.toContain("dir=");
    /* The map is drawn, not "No session visited /products/:id". */
    expect(screen.queryByTestId("user-flow-anchor-missing")).toBeNull();
    expect(screen.getByTestId("user-flow-mode-start")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a map anchored on one of a person's pages starts over for everyone", async () => {
    renderPage(`?userKey=${JANE_KEY}&page=%2Fproducts%2F1001`);
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });
    await answer(0, janesAnswer());
    await waitFor(() => {
      expect(shownSessionIds()).toEqual([JANE_SESSION]);
    });

    fireEvent.click(screen.getByTestId("user-flow-scope-clear"));
    await settle();

    expect(window.location.search).not.toContain("page=");
  });
});

describe("what the page sends", () => {
  test("a person's key goes as the filter, and everyone sends none", async () => {
    renderPage(`?userKey=${JANE_KEY}`);
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });

    expect((held[0] as Held).data["filters"]).toEqual({
      identifiedUserKey: JANE_KEY,
    });

    cleanup();
    held = [];

    renderPage();
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });

    expect((held[0] as Held).data).not.toHaveProperty("filters");
  });

  test("the refusal for a role without identity reads as itself, and can be left", async () => {
    renderPage();
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });
    await answer(
      0,
      journeys({ sessionId: "everyone", page: "/everyone", scope: null }),
    );

    await lookUp("jane@example.com");
    await waitFor(() => {
      expect(held).toHaveLength(2);
    });

    await act(async (): Promise<void> => {
      (held[1] as Held).fail(
        new HTTPErrorResponse(
          400,
          { message: "Your role cannot read end-user identity." },
          {},
        ),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Your role cannot read end-user identity/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("user-flow-tile-sessions")).toBeNull();

    fireEvent.click(screen.getByTestId("user-flow-scope-clear"));

    await waitFor(() => {
      expect(held).toHaveLength(3);
    });
  });

  test("learning the key of a typed reference asks nothing again", async () => {
    renderPage();
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });

    await lookUp("jane@example.com");
    await waitFor(() => {
      expect(held).toHaveLength(2);
    });

    expect((held[1] as Held).data["filters"]).toEqual({
      identifiedUserRef: "jane@example.com",
    });

    await answer(1, janesAnswer());

    await waitFor(() => {
      expect(window.location.search).toContain(`userKey=${JANE_KEY}`);
    });
    await settle();

    expect(held).toHaveLength(2);
    expect(decodeURIComponent(window.location.href)).not.toContain("jane@");
  });
});
