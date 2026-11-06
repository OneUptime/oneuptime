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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Mattermost settings pages, card by card. Connecting the project to a
 * Mattermost server - a bot account's token, and the team it posts in - and
 * disconnecting it are the project's: on Project Settings, in the project's
 * own card. Connecting your own Mattermost account is yours: the bot sends
 * your account a link, to the account with your email address when
 * OneUptime can find it, or to the username you type.
 */

interface MockState {
  isProjectConnected: boolean;
  isUserConnected: boolean;
  // The account the server suggests the link goes to.
  suggestedUsername: string | null;
  // The teams the bot is in, as the server lists them.
  teams: Array<{ id: string; name: string; displayName: string }>;
  // What the server answers a route with instead of success.
  refusals: Record<string, string>;
}

const mockState: MockState = {
  isProjectConnected: false,
  isUserConnected: false,
  suggestedUsername: null,
  teams: [],
  refusals: {},
};

const mockPosts: Array<{ route: string; data: unknown; query: string }> = [];

const deleteItemMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

let mockQueryParams: Record<string, string> = {};

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: (name: string) => {
        return mockQueryParams[name] || null;
      },
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
      getLocation: () => {
        return { pathname: "/" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: () => {
            return "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
          },
        };
      },
      getCurrentProject: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return {
          toString: () => {
            return "user-id";
          },
        };
      },
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  const HTTPResponse: any = (
    jest.requireActual("../../../Types/API/HTTPResponse") as any
  ).default;
  const HTTPErrorResponse: any = (
    jest.requireActual("../../../Types/API/HTTPErrorResponse") as any
  ).default;

  const routeOf: (url: { toString: () => string }) => {
    route: string;
    query: string;
  } = (url: { toString: () => string }) => {
    const text: string = url.toString();
    const at: number = text.indexOf("/mattermost/");
    const pathAndQuery: string = text.substring(at);
    const [route, query] = pathAndQuery.split("?");

    return { route: route || "", query: query || "" };
  };

  return {
    __esModule: true,
    default: {
      get: async (data: { url: { toString: () => string } }) => {
        const { route } = routeOf(data.url);

        if (route === "/mattermost/account-suggestion") {
          return new HTTPResponse(
            200,
            { username: mockState.suggestedUsername },
            {},
          );
        }

        return new HTTPErrorResponse(404, { message: "Not found" }, {});
      },
      post: async (data: {
        url: { toString: () => string };
        data: unknown;
      }) => {
        const { route, query } = routeOf(data.url);

        mockPosts.push({ route: route, data: data.data, query: query });

        if (mockState.refusals[route]) {
          return new HTTPErrorResponse(
            400,
            { message: mockState.refusals[route] },
            {},
          );
        }

        if (route === "/mattermost/teams") {
          return new HTTPResponse(
            200,
            { bot: { username: "oneuptime" }, teams: mockState.teams },
            {},
          );
        }

        if (route === "/mattermost/connect") {
          mockState.isProjectConnected = true;
          return new HTTPResponse(
            200,
            { teamDisplayName: "Engineering", botUsername: "oneuptime" },
            {},
          );
        }

        if (route === "/mattermost/sign-in-link") {
          const username: string =
            ((data.data as Record<string, string>) || {})["username"] ||
            mockState.suggestedUsername ||
            "";

          return new HTTPResponse(200, { username: username }, {});
        }

        return new HTTPErrorResponse(404, { message: "Not found" }, {});
      },
      getFriendlyMessage: (error: unknown) => {
        return String((error as { message?: string })?.message || error);
      },
      getFriendlyErrorMessage: (error: unknown) => {
        return String((error as { message?: string })?.message || error);
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
      deleteItem: (...args: Array<unknown>) => {
        return deleteItemMock(...args);
      },
      getList: async (data: { modelType: { name?: string } }) => {
        const modelName: string = data.modelType?.name || "";

        if (modelName.includes("Project")) {
          return mockState.isProjectConnected
            ? {
                data: [
                  {
                    id: {
                      toString: () => {
                        return "project-auth-token-id";
                      },
                    },
                    miscData: {
                      serverUrl: "https://chat.example.com",
                      teamId: "t".repeat(26),
                      teamName: "engineering",
                      teamDisplayName: "Engineering",
                      botUserId: "b".repeat(26),
                      botUsername: "oneuptime",
                    },
                  },
                ],
                count: 1,
                skip: 0,
                limit: 1,
              }
            : { data: [], count: 0, skip: 0, limit: 1 };
        }

        return mockState.isUserConnected
          ? {
              data: [
                {
                  id: {
                    toString: () => {
                      return "user-auth-token-id";
                    },
                  },
                },
              ],
              count: 1,
              skip: 0,
              limit: 1,
            }
          : { data: [], count: 0, skip: 0, limit: 1 };
      },
    },
  };
});

import MattermostIntegration, {
  MATTERMOST_DOCS_ROUTE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Mattermost/MattermostIntegration";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import { ConnectStartPage } from "../../../Types/Workspace/ConnectCallback";

interface DrawnCard {
  title: string;
  description: string;
  buttons: Array<string>;
}

function cardIn(testId: string): DrawnCard {
  const cards: Array<HTMLElement> = within(
    screen.getByTestId(testId),
  ).getAllByTestId("card");

  expect(cards).toHaveLength(1);

  return {
    title:
      within(cards[0]!).queryByTestId("card-details-heading")?.textContent ||
      "",
    description:
      within(cards[0]!).queryByTestId("card-description")?.textContent || "",
    buttons: within(cards[0]!)
      .queryAllByTestId("card-button")
      .map((button: HTMLElement): string => {
        return (button.textContent || "").trim();
      }),
  };
}

async function click(name: string): Promise<void> {
  const button: HTMLElement = await screen.findByRole("button", { name });

  await act(async () => {
    fireEvent.click(button);
  });
}

async function type(input: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(input, { target: { value: value } });
  });
}

type Page = "project" | "user";

async function renderPage(page: Page): Promise<void> {
  await act(async () => {
    render(
      page === "project" ? (
        <MattermostIntegration
          onConnected={() => {}}
          onDisconnected={() => {}}
        />
      ) : (
        <MattermostIntegration
          onConnected={() => {}}
          onDisconnected={() => {}}
          hideProjectCards={true}
          startPage={ConnectStartPage.UserSettings}
        />
      ),
    );
  });
}

let refresh: MockFunction;

beforeEach(() => {
  mockState.isProjectConnected = false;
  mockState.isUserConnected = false;
  mockState.suggestedUsername = null;
  mockState.teams = [
    { id: "t".repeat(26), name: "engineering", displayName: "Engineering" },
  ];
  mockState.refusals = {};
  mockPosts.length = 0;
  mockQueryParams = {};
  deleteItemMock.mockReset();
  deleteItemMock.mockResolvedValue(undefined as never);
  navigateMock.mockReset();
  refresh = jest
    .spyOn(ConnectedWorkspaces, "refresh")
    .mockResolvedValue(undefined) as unknown as MockFunction;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Project Settings > Mattermost, not connected yet", () => {
  test("offers to connect, with the set-up guide beside it", async () => {
    await renderPage("project");

    expect(cardIn("mattermost-your-account")).toEqual({
      title: "Connect with Mattermost",
      description:
        "Post incidents, alerts and scheduled maintenance to your Mattermost channels, give each incident a channel of its own, and let your team acknowledge and resolve from Mattermost.",
      buttons: ["Connect with Mattermost", "Set-up guide"],
    });
    expect(screen.queryByTestId("mattermost-project-connection")).toBeNull();
  });

  test("the set-up guide opens the Mattermost docs in a new tab", async () => {
    await renderPage("project");

    await click("Set-up guide");

    expect(navigateMock).toHaveBeenCalledWith(MATTERMOST_DOCS_ROUTE, {
      openInNewTab: true,
    });
  });

  test("Connect asks for the server's address and the bot's access token", async () => {
    await renderPage("project");

    await click("Connect with Mattermost");

    expect(await screen.findByText("Server address")).toBeInTheDocument();
    expect(screen.getByText("Bot access token")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("https://chat.example.com"),
    ).toBeInTheDocument();
  });

  test("a bot in one team is connected to it at once, and the menus are asked again", async () => {
    await renderPage("project");
    await click("Connect with Mattermost");

    await type(
      screen.getByPlaceholderText("https://chat.example.com"),
      "chat.example.com",
    );
    await type(
      document.querySelector("input[type='password']") as HTMLElement,
      "abcdefghijklmnopqrstuvwxyz",
    );

    await click("Connect");

    await waitFor(() => {
      expect(
        mockPosts.map((post: { route: string }) => {
          return post.route;
        }),
      ).toEqual(["/mattermost/teams", "/mattermost/connect"]);
    });

    expect(mockPosts[1]!.data).toEqual({
      serverUrl: "chat.example.com",
      accessToken: "abcdefghijklmnopqrstuvwxyz",
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("mattermost-project-connection"),
      ).toBeInTheDocument();
    });
    expect(refresh).toHaveBeenCalled();
  });

  test("a bot in several teams asks which one, and connects to the one picked", async () => {
    mockState.teams = [
      { id: "t".repeat(26), name: "engineering", displayName: "Engineering" },
      { id: "o".repeat(26), name: "support", displayName: "Support" },
    ];

    await renderPage("project");
    await click("Connect with Mattermost");

    await type(
      screen.getByPlaceholderText("https://chat.example.com"),
      "https://chat.example.com",
    );
    await type(
      document.querySelector("input[type='password']") as HTMLElement,
      "abcdefghijklmnopqrstuvwxyz",
    );

    await click("Connect");

    expect(await screen.findByText("Choose a team")).toBeInTheDocument();
    // Nothing is connected until a team is picked.
    expect(
      mockPosts.map((post: { route: string }) => {
        return post.route;
      }),
    ).toEqual(["/mattermost/teams"]);

    const teamPicker: HTMLElement = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.keyDown(teamPicker, { key: "ArrowDown" });
    });

    expect(screen.getByText("Engineering")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Support"));
    });

    await click("Connect");

    await waitFor(() => {
      expect(
        mockPosts.map((post: { route: string }) => {
          return post.route;
        }),
      ).toEqual(["/mattermost/teams", "/mattermost/connect"]);
    });

    expect(mockPosts[1]!.data).toEqual({
      serverUrl: "https://chat.example.com",
      accessToken: "abcdefghijklmnopqrstuvwxyz",
      teamId: "o".repeat(26),
    });
  });

  test("what the server refuses is said in the form, which stays open", async () => {
    mockState.refusals["/mattermost/teams"] =
      "Mattermost did not accept the access token.";

    await renderPage("project");
    await click("Connect with Mattermost");

    await type(
      screen.getByPlaceholderText("https://chat.example.com"),
      "https://chat.example.com",
    );
    await type(
      document.querySelector("input[type='password']") as HTMLElement,
      "abcdefghijklmnopqrstuvwxyz",
    );

    await click("Connect");

    expect(
      await screen.findByText("Mattermost did not accept the access token."),
    ).toBeInTheDocument();
    expect(screen.getByText("Server address")).toBeInTheDocument();
  });
});

describe("User Settings > Mattermost, project not connected", () => {
  test("says who connects the project, with nothing to press", async () => {
    await renderPage("user");

    expect(cardIn("mattermost-your-account")).toEqual({
      title: "Mattermost is not connected to this project yet",
      description:
        "A project admin connects it under Project Settings → Workspace → Mattermost. Then you can connect your own Mattermost account here.",
      buttons: [],
    });
  });
});

describe("Mattermost connected, your account not yet", () => {
  beforeEach(() => {
    mockState.isProjectConnected = true;
  });

  test("the project's card names the team, the bot and the server", async () => {
    await renderPage("project");

    expect(cardIn("mattermost-project-connection")).toEqual({
      title: "OneUptime is connected to the Engineering team in Mattermost",
      description:
        "It posts as @oneuptime on https://chat.example.com: what your notification rules send, a channel for each incident with its people added. Each member connects their own Mattermost account to act as themselves.",
      buttons: [],
    });
  });

  test("the account OneUptime found by your email address gets the link in one press", async () => {
    mockState.suggestedUsername = "alice";

    await renderPage("project");

    expect(cardIn("mattermost-your-account").buttons).toEqual([
      "Send link to @alice",
      "Use a different account",
    ]);

    await click("Send link to @alice");

    await waitFor(() => {
      expect(mockPosts).toHaveLength(1);
    });
    expect(mockPosts[0]).toEqual({
      route: "/mattermost/sign-in-link",
      data: { username: "alice" },
      query: "from=project-settings",
    });

    await waitFor(() => {
      expect(cardIn("mattermost-your-account").description).toBe(
        "OneUptime sent a link to @alice in Mattermost. Open it in this browser to finish connecting. It works once, for 15 minutes.",
      );
    });
  });

  test("with no account found, you type your username", async () => {
    await renderPage("user");

    expect(cardIn("mattermost-your-account")).toEqual({
      title: "Connect your Mattermost account",
      description:
        "OneUptime sends your Mattermost account a direct message with a link. Open it in this browser to finish connecting.",
      buttons: ["Send me a link"],
    });

    await click("Send me a link");

    expect(await screen.findByText("Mattermost username")).toBeInTheDocument();

    await type(screen.getByPlaceholderText("alice"), "bob");
    await click("Send link");

    await waitFor(() => {
      expect(mockPosts[0]).toEqual({
        route: "/mattermost/sign-in-link",
        data: { username: "bob" },
        query: "from=user-settings",
      });
    });
  });

  test("a link the server will not send says why", async () => {
    mockState.suggestedUsername = "alice";
    mockState.refusals["/mattermost/sign-in-link"] =
      "You have asked for several Mattermost links in the last few minutes.";

    await renderPage("project");

    await click("Send link to @alice");

    expect(
      await screen.findByText(
        "You have asked for several Mattermost links in the last few minutes.",
      ),
    ).toBeInTheDocument();
  });

  test("opened from a channel's Connect link, it asks at once whom to send the link to", async () => {
    mockQueryParams = { connectAccount: "true" };

    await renderPage("user");

    expect(await screen.findByText("Mattermost username")).toBeInTheDocument();
  });
});

describe("Mattermost connected, your account connected", () => {
  beforeEach(() => {
    mockState.isProjectConnected = true;
    mockState.isUserConnected = true;
  });

  test("says what that lets you do, and how to undo it", async () => {
    await renderPage("user");

    expect(cardIn("mattermost-your-account")).toEqual({
      title: "Your Mattermost account is connected",
      description:
        "Buttons on OneUptime's messages in Mattermost act as you, with your permissions in this project.",
      buttons: ["Disconnect"],
    });
  });

  test("Disconnect removes your account's connection only", async () => {
    await renderPage("user");

    await click("Disconnect");

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceUserAuthToken);
  });

  test("disconnecting the project is in its ⋯, and asks first", async () => {
    await renderPage("project");

    await click("Manage the Mattermost connection");

    const items: Array<string> = within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });

    expect(items).toEqual(["Set-up guide", "Disconnect Mattermost"]);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Disconnect Mattermost" }),
      );
    });

    expect(
      await screen.findByText("Uninstall OneUptime from Mattermost?"),
    ).toBeInTheDocument();
    expect(deleteItemMock).not.toHaveBeenCalled();

    await click("Uninstall");

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceProjectAuthToken);
    expect(refresh).toHaveBeenCalled();
  });

  test("User Settings shows no project card", async () => {
    await renderPage("user");

    expect(screen.queryByTestId("mattermost-project-connection")).toBeNull();
  });
});
