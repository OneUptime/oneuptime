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
import * as React from "react";
import { JSONObject } from "../../../Types/JSON";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";

/*
 * Project Settings > Slack, for a project whose Slack connection is
 * OneUptime installed for a whole Slack Enterprise organization (GitHub
 * issue #6725: one project, several workspaces of one organization).
 *
 * - The project's card names the organization, not a workspace, and so
 *   does the card that asks you to connect your own account: any of the
 *   organization's workspaces will do.
 * - A Slack workspaces card lists the workspaces OneUptime was added to,
 *   the default first, marked Default; Make default makes another one the
 *   default, and Refresh asks Slack again - adding OneUptime to a workspace
 *   happens in Slack, which tells OneUptime nothing. How to add it is said
 *   under the list, and in place of it while there are none.
 * - A project connected to one workspace of an Enterprise organization is
 *   told it can be installed for the whole organization instead, with a
 *   button that starts it. Any other project - most of them - sees no new
 *   card at all, not even a loader that then goes.
 * - User Settings shows none of it: it is the project's.
 */

interface MockState {
  miscData: JSONObject;
  // What GET /slack/workspaces answers: a body, or an error response.
  workspaces: JSONObject | HTTPErrorResponse;
  // After a refresh (?refresh=true), when it lists something else.
  workspacesAfterRefresh?: JSONObject | undefined;
  // What PUT /slack/default-workspace answers.
  makeDefault: (workspaceId: string) => JSONObject | HTTPErrorResponse;
}

const ORGANIZATION_MISC_DATA: JSONObject = {
  teamId: "E0ACME",
  teamName: "Acme Corp",
  isEnterpriseInstall: true,
  enterpriseId: "E0ACME",
  enterpriseName: "Acme Corp",
};

const WORKSPACE_MISC_DATA: JSONObject = {
  teamId: "T0EAST",
  teamName: "Acme East",
};

function organization(
  workspaces: Array<{ id: string; name: string }>,
  defaultWorkspaceId: string | null,
): JSONObject {
  return {
    isOrganization: true,
    isInOrganization: true,
    organizationName: "Acme Corp",
    workspaces: workspaces,
    defaultWorkspaceId: defaultWorkspaceId,
  };
}

const EAST: { id: string; name: string } = { id: "T0EAST", name: "Acme East" };
const WEST: { id: string; name: string } = { id: "T0WEST", name: "Acme West" };
const LABS: { id: string; name: string } = { id: "T0LABS", name: "Acme Labs" };

const mockState: MockState = {
  miscData: ORGANIZATION_MISC_DATA,
  workspaces: organization([EAST, WEST], EAST.id),
  makeDefault: () => {
    return {};
  },
};

interface RecordedRequest {
  method: "GET" | "PUT";
  url: string;
  data?: JSONObject | undefined;
}

const requests: Array<RecordedRequest> = [];
type NavigateMock = ReturnType<
  typeof jest.fn<(...args: Array<unknown>) => void>
>;

const navigateMock: NavigateMock = jest.fn<(...args: Array<unknown>) => void>();

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actualConfig,
    SlackAppClientId: "slack-client-id",
    BILLING_ENABLED: false,
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: () => {
        return null;
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
  return {
    __esModule: true,
    default: {
      get: async (options: { url: { toString: () => string } }) => {
        const url: string = options.url.toString();
        requests.push({ method: "GET", url: url });

        if (url.includes("/slack/workspaces")) {
          if (
            url.includes("refresh=true") &&
            mockState.workspacesAfterRefresh
          ) {
            return { data: mockState.workspacesAfterRefresh };
          }

          return mockState.workspaces instanceof HTTPErrorResponse
            ? mockState.workspaces
            : { data: mockState.workspaces };
        }

        if (url.includes("/slack/install-url")) {
          return {
            data: {
              authorizationUrl:
                "https://slack.com/oauth/v2/authorize?client_id=slack-client-id",
            },
          };
        }

        return { data: {} };
      },
      put: async (options: {
        url: { toString: () => string };
        data?: JSONObject;
      }) => {
        const url: string = options.url.toString();
        requests.push({ method: "PUT", url: url, data: options.data });

        const answer: JSONObject | HTTPErrorResponse = mockState.makeDefault(
          (options.data?.["workspaceId"] as string) || "",
        );

        return answer instanceof HTTPErrorResponse ? answer : { data: answer };
      },
      getFriendlyErrorMessage: (error: unknown) => {
        const message: unknown = (error as { message?: unknown })?.message;
        return typeof message === "string" && message
          ? message
          : "Something went wrong.";
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
      deleteItem: async () => {
        return undefined;
      },
      getList: async (data: { modelType: { name?: string } }) => {
        const modelName: string = data.modelType?.name || "";

        if (modelName.includes("Project")) {
          return {
            data: [
              {
                id: {
                  toString: () => {
                    return "project-auth-token-id";
                  },
                },
                miscData: mockState.miscData,
              },
            ],
            count: 1,
            skip: 0,
            limit: 1,
          };
        }

        return { data: [], count: 0, skip: 0, limit: 1 };
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackChannelsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="slack-channels-card" />;
      },
    };
  },
);

import SlackIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackIntegration";
import { readSlackConnectionDescription } from "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackOrganizationCard";
import { ConnectStartPage } from "../../../Types/Workspace/ConnectCallback";

beforeEach(() => {
  mockState.miscData = ORGANIZATION_MISC_DATA;
  mockState.workspaces = organization([EAST, WEST], EAST.id);
  mockState.workspacesAfterRefresh = undefined;
  mockState.makeDefault = (workspaceId: string): JSONObject => {
    return organization(
      workspaceId === WEST.id ? [WEST, EAST] : [EAST, WEST],
      workspaceId,
    );
  };
  requests.length = 0;
  navigateMock.mockReset();
});

afterEach(() => {
  cleanup();
});

async function renderProjectSettings(): Promise<void> {
  await act(async () => {
    render(
      <SlackIntegration onConnected={() => {}} onDisconnected={() => {}} />,
    );
  });
}

async function renderUserSettings(): Promise<void> {
  await act(async () => {
    render(
      <SlackIntegration
        onConnected={() => {}}
        onDisconnected={() => {}}
        hideProjectCards={true}
        startPage={ConnectStartPage.UserSettings}
      />,
    );
  });
}

function cardTitles(): Array<string> {
  return screen
    .queryAllByTestId("card-details-heading")
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
}

function cardDescriptionIn(testId: string): string {
  return (
    within(screen.getByTestId(testId)).queryByTestId("card-description")
      ?.textContent || ""
  );
}

// The workspaces listed, in order, with Default after the default one.
function listedWorkspaces(): Array<string> {
  return within(screen.getByTestId("slack-workspaces-list"))
    .getAllByRole("listitem")
    .map((row: HTMLElement): string => {
      const name: string =
        row.querySelector(".font-medium")?.textContent?.trim() || "";

      return within(row).queryByTestId("slack-workspace-default")
        ? `${name} (Default)`
        : name;
    });
}

// The Slack workspaces card's Refresh.
function refreshButton(): HTMLElement {
  return within(screen.getByTestId("slack-organization-workspaces")).getByRole(
    "button",
    { name: "Refresh" },
  );
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("Project Settings > Slack, installed for a whole organization", () => {
  test("the project's card names the organization, and so does yours to connect", async () => {
    await renderProjectSettings();

    expect(
      within(screen.getByTestId("slack-project-connection")).getByTestId(
        "card-details-heading",
      ),
    ).toHaveTextContent(
      "OneUptime is installed in the Acme Corp Slack organization",
    );
    expect(cardDescriptionIn("slack-your-account")).toBe(
      "OneUptime is installed in the Acme Corp Slack organization. Connect your account from any of its workspaces to acknowledge incidents and get messages as yourself, in Slack.",
    );
    // Never called a workspace.
    expect(screen.queryByText(/Acme Corp Slack workspace/)).toBeNull();
  });

  test("Slack workspaces: the default first, marked Default, the others to make default", async () => {
    await renderProjectSettings();

    const card: HTMLElement = await screen.findByTestId(
      "slack-organization-workspaces",
    );

    expect(within(card).getByTestId("card-details-heading")).toHaveTextContent(
      "Slack workspaces",
    );
    expect(within(card).getByTestId("card-description")).toHaveTextContent(
      "OneUptime is installed for the whole Acme Corp organization and works in each workspace it was added to. A notification rule that names no workspace creates its channels in the default one.",
    );
    expect(listedWorkspaces()).toEqual(["Acme East (Default)", "Acme West"]);

    // The default has no button; each other workspace has one, named for it.
    expect(
      within(screen.getByTestId(`slack-workspace-${EAST.id}`)).queryAllByRole(
        "button",
      ),
    ).toHaveLength(0);
    expect(
      within(screen.getByTestId(`slack-workspace-${WEST.id}`)).getByRole(
        "button",
        { name: "Make Acme West the default workspace" },
      ),
    ).toHaveTextContent("Make default");

    // How to add OneUptime to more workspaces, under the list.
    expect(screen.getByTestId("slack-workspaces-hint")).toHaveTextContent(
      "To use OneUptime in another workspace, an organization admin adds it in Slack: Organization settings → Integrations → Installed apps → OneUptime → Add to more workspaces. Then click Refresh.",
    );

    // Between your account's card and the channels.
    const order: Array<HTMLElement> = [
      screen.getByTestId("slack-your-account"),
      card,
      screen.getByTestId("slack-channels-card"),
    ];

    for (let index: number = 1; index < order.length; index++) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test("Make default asks the server to make that workspace the default, and shows what it answers", async () => {
    await renderProjectSettings();
    await screen.findByTestId("slack-organization-workspaces");

    await click(
      screen.getByRole("button", {
        name: "Make Acme West the default workspace",
      }),
    );

    expect(
      requests.filter((request: RecordedRequest) => {
        return request.method === "PUT";
      }),
    ).toEqual([
      {
        method: "PUT",
        url: expect.stringContaining("/slack/default-workspace") as never,
        data: { workspaceId: WEST.id },
      },
    ]);
    expect(listedWorkspaces()).toEqual(["Acme West (Default)", "Acme East"]);
    expect(
      screen.getByRole("button", {
        name: "Make Acme East the default workspace",
      }),
    ).toBeEnabled();
  });

  test("a refusal is said on the card, and the list stays as it was", async () => {
    mockState.makeDefault = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        403,
        {
          message:
            "You do not have permission to change this project's Slack settings.",
        },
        {},
      );
    };

    await renderProjectSettings();
    await screen.findByTestId("slack-organization-workspaces");

    await click(
      screen.getByRole("button", {
        name: "Make Acme West the default workspace",
      }),
    );

    expect(
      within(screen.getByTestId("slack-organization-workspaces")).getByText(
        "You do not have permission to change this project's Slack settings.",
      ),
    ).toBeVisible();
    expect(listedWorkspaces()).toEqual(["Acme East (Default)", "Acme West"]);
  });

  test("Refresh asks Slack again, and a workspace OneUptime was just added to appears", async () => {
    mockState.workspacesAfterRefresh = organization(
      [EAST, LABS, WEST],
      EAST.id,
    );

    await renderProjectSettings();
    await screen.findByTestId("slack-organization-workspaces");

    expect(listedWorkspaces()).toEqual(["Acme East (Default)", "Acme West"]);

    await click(refreshButton());

    const refreshes: Array<RecordedRequest> = requests.filter(
      (request: RecordedRequest) => {
        return request.url.includes("/slack/workspaces?refresh=true");
      },
    );

    expect(refreshes).toHaveLength(1);
    expect(listedWorkspaces()).toEqual([
      "Acme East (Default)",
      "Acme Labs",
      "Acme West",
    ]);
  });

  test("added to no workspace yet: what to do, in place of the list", async () => {
    mockState.workspaces = organization([], null);

    await renderProjectSettings();

    const empty: HTMLElement = await screen.findByTestId(
      "slack-workspaces-empty",
    );

    expect(empty).toHaveTextContent(
      "OneUptime is not added to any workspace yet",
    );
    expect(empty).toHaveTextContent(
      "an organization admin adds it in Slack: Organization settings → Integrations → Installed apps → OneUptime → Add to more workspaces. Then click Refresh.",
    );
    expect(screen.queryByTestId("slack-workspaces-list")).toBeNull();
    expect(screen.queryByTestId("slack-workspaces-hint")).toBeNull();
    // Refresh is still there to look again.
    expect(refreshButton()).toBeEnabled();
  });

  test("Slack could not be asked: no card, and the rest of the page as usual", async () => {
    mockState.workspaces = new HTTPErrorResponse(
      500,
      { message: "Slack is down." },
      {},
    );

    await renderProjectSettings();

    expect(screen.queryByTestId("slack-organization-workspaces")).toBeNull();
    expect(screen.queryByText("Slack is down.")).toBeNull();
    expect(screen.getByTestId("slack-project-connection")).toBeVisible();
    expect(screen.getByTestId("slack-channels-card")).toBeInTheDocument();
  });
});

describe("Project Settings > Slack, connected to one workspace", () => {
  test("of an Enterprise organization: a card offers to install OneUptime for the whole organization", async () => {
    mockState.miscData = WORKSPACE_MISC_DATA;
    mockState.workspaces = {
      isOrganization: false,
      isInOrganization: true,
      organizationName: "",
      workspaces: [],
      defaultWorkspaceId: null,
    };

    await renderProjectSettings();

    // The project's own card names its workspace, as before.
    expect(
      within(screen.getByTestId("slack-project-connection")).getByTestId(
        "card-details-heading",
      ),
    ).toHaveTextContent(
      "OneUptime is installed in the Acme East Slack workspace",
    );

    const card: HTMLElement = await screen.findByTestId(
      "slack-install-for-organization",
    );

    expect(within(card).getByTestId("card-details-heading")).toHaveTextContent(
      "Use OneUptime in every workspace of your Slack organization",
    );
    expect(within(card).getByTestId("card-description")).toHaveTextContent(
      "Acme East is part of a Slack Enterprise organization. An organization admin can install OneUptime for the whole organization, so this project works in each workspace they add it to. Notification rules, channels and connected accounts stay as they are, and new channels are still created in Acme East unless a rule names another workspace.",
    );
    expect(screen.queryByTestId("slack-organization-workspaces")).toBeNull();

    // The button starts the install, as Connect with Slack does.
    await click(
      within(card).getByRole("button", {
        name: "Install for the organization",
      }),
    );

    expect(
      requests.some((request: RecordedRequest) => {
        return request.url.includes("/slack/install-url");
      }),
    ).toBe(true);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toContain(
      "https://slack.com/oauth/v2/authorize",
    );
  });

  test("of no organization - most workspaces: no new card at all", async () => {
    mockState.miscData = WORKSPACE_MISC_DATA;
    mockState.workspaces = {
      isOrganization: false,
      isInOrganization: false,
      organizationName: "",
      workspaces: [],
      defaultWorkspaceId: null,
    };

    await renderProjectSettings();

    expect(screen.queryByTestId("slack-organization-workspaces")).toBeNull();
    expect(screen.queryByTestId("slack-install-for-organization")).toBeNull();
    expect(cardTitles()).toEqual([
      "OneUptime is installed in the Acme East Slack workspace",
      "Connect your Slack account",
    ]);
  });
});

describe("User Settings > Slack", () => {
  test("the organization's name on your card, and none of the project's cards", async () => {
    await renderUserSettings();

    expect(cardTitles()).toEqual(["Connect your Slack account"]);
    expect(cardDescriptionIn("slack-your-account")).toContain(
      "OneUptime is installed in the Acme Corp Slack organization.",
    );
    expect(screen.queryByTestId("slack-organization-workspaces")).toBeNull();
    // It does not even ask: the workspaces are the project's.
    expect(
      requests.some((request: RecordedRequest) => {
        return request.url.includes("/slack/workspaces");
      }),
    ).toBe(false);
  });
});

describe("what GET /slack/workspaces answers, as the page reads it", () => {
  test("an organization's", () => {
    expect(
      readSlackConnectionDescription(organization([EAST, WEST], WEST.id)),
    ).toEqual({
      isOrganization: true,
      isInOrganization: true,
      organizationName: "Acme Corp",
      workspaces: [EAST, WEST],
      defaultWorkspaceId: WEST.id,
    });
  });

  test("anything else is read as a connection to one workspace, with nothing listed", () => {
    expect(readSlackConnectionDescription(undefined)).toEqual({
      isOrganization: false,
      isInOrganization: false,
      organizationName: "",
      workspaces: [],
      defaultWorkspaceId: null,
    });

    expect(
      readSlackConnectionDescription({
        isOrganization: "yes",
        workspaces: [{ id: "" }, { name: "No id" }, { id: "T1", name: 7 }, 5],
        defaultWorkspaceId: 3,
      } as unknown as JSONObject),
    ).toEqual({
      isOrganization: false,
      isInOrganization: false,
      organizationName: "",
      workspaces: [{ id: "T1", name: "" }],
      defaultWorkspaceId: null,
    });
  });
});
