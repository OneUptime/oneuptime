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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Slack and Microsoft Teams settings pages, card by card. Installing,
 * consenting and uninstalling are the project's: they are on Project
 * Settings, in the project's own card. Connecting your account is yours:
 * on Project Settings it is the card under the project's, and on User
 * Settings it is the only one - with no install, consent or uninstall
 * buttons, which a personal page is not for. Uninstalling is there whether
 * or not your own account is connected: the page used to offer it only to
 * somebody who had disconnected themselves first.
 *
 * The project's card asks nothing of anybody: what it offers - the
 * channel list, the teams, granting consent again, uninstalling - is in
 * its ⋯, not a row of buttons that pressed its title into a column a word
 * wide (in German, a letter). Uninstalling, which disconnects every
 * member, asks first.
 */

interface MockAuthState {
  isProjectConnected: boolean;
  isUserConnected: boolean;
  /*
   * What the project's Microsoft Teams connection says of its organization
   * (MicrosoftTeamsOrganization): its tenant, and the name and domain
   * admin consent kept. Nothing, as a connection read before they were.
   */
  teamsOrganization: {
    tenantId?: string;
    name?: string;
    domain?: string;
  } | null;
}

const mockAuthState: MockAuthState = {
  isProjectConnected: true,
  isUserConnected: false,
  teamsOrganization: null,
};

const deleteItemMock: MockFunction = getJestMockFunction();

// The Dashboard's API.get: what the server answers each route with.
const apiGetMock: MockFunction = getJestMockFunction();

// Where the page sends the browser (Navigation.navigate).
const navigateMock: MockFunction = getJestMockFunction();

const TEAMS_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actualConfig,
    SlackAppClientId: "slack-client-id",
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    // A self-hosted server: the install card and the setup guide are drawn.
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
      /*
       * Not a master admin, and no permission snapshot: the card that asks
       * everybody to connect is for owners and admins (AskToConnectCard has
       * its own suite), so these pages draw without it.
       */
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
      get: (...args: Array<unknown>) => {
        return apiGetMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return String(error);
      },
      getFriendlyErrorMessage: (error: unknown) => {
        return String(error);
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
          return mockAuthState.isProjectConnected
            ? {
                data: [
                  {
                    id: {
                      toString: () => {
                        return "project-auth-token-id";
                      },
                    },
                    workspaceProjectId:
                      mockAuthState.teamsOrganization?.tenantId,
                    miscData: {
                      teamName: "Acme",
                      adminConsentGranted: true,
                      ...(mockAuthState.teamsOrganization
                        ? {
                            tenantId: mockAuthState.teamsOrganization.tenantId,
                            organizationName:
                              mockAuthState.teamsOrganization.name,
                            organizationDomain:
                              mockAuthState.teamsOrganization.domain,
                          }
                        : {}),
                    },
                  },
                ],
                count: 1,
                skip: 0,
                limit: 1,
              }
            : { data: [], count: 0, skip: 0, limit: 1 };
        }

        return mockAuthState.isUserConnected
          ? {
              data: [
                {
                  id: {
                    toString: () => {
                      return "user-auth-token-id";
                    },
                  },
                  miscData: {},
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChannelsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="teams-channels-card" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChatsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="teams-chats-card" />;
      },
    };
  },
);

import MicrosoftTeamsIntegration, {
  MICROSOFT_TEAMS_SETUP_GUIDE_TEST_ID,
  getMicrosoftTeamsAppLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import SlackIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackIntegration";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { ConnectStartPage } from "../../../Types/Workspace/ConnectCallback";

/*
 * What one card draws: its title, its description, its buttons in order,
 * and the name of its ⋯ when it has one.
 */
interface DrawnCard {
  title: string;
  description: string;
  buttons: Array<string>;
  moreMenu?: string | undefined;
}

function drawnCard(card: HTMLElement): DrawnCard {
  const drawn: DrawnCard = {
    title:
      within(card).queryByTestId("card-details-heading")?.textContent || "",
    description:
      within(card).queryByTestId("card-description")?.textContent || "",
    buttons: within(card)
      .queryAllByTestId("card-button")
      .map((button: HTMLElement): string => {
        return (button.textContent || "").trim();
      }),
  };

  const moreMenu: HTMLElement | undefined = within(card)
    .queryAllByRole("button")
    .find((button: HTMLElement): boolean => {
      return (button.getAttribute("aria-label") || "").startsWith("Manage ");
    });

  if (moreMenu) {
    drawn.moreMenu = moreMenu.getAttribute("aria-label") || "";
  }

  return drawn;
}

// The items of a card's ⋯, opened: their names, in order.
async function openMoreMenu(name: string): Promise<Array<string>> {
  await click(name);

  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

async function pickMenuItem(name: string): Promise<void> {
  const item: HTMLElement = await screen.findByRole("menuitem", { name });

  await act(async () => {
    fireEvent.click(item);
  });
}

// The one card inside a wrapper the page marks.
function cardIn(testId: string): DrawnCard {
  const cards: Array<HTMLElement> = within(
    screen.getByTestId(testId),
  ).getAllByTestId("card");

  expect(cards).toHaveLength(1);

  return drawnCard(cards[0]!);
}

// Every button the page draws, by name.
function allButtons(): Array<string> {
  return screen.queryAllByRole("button").map((button: HTMLElement): string => {
    return (button.textContent || "").trim();
  });
}

// Every card title the page draws.
function allCardTitles(): Array<string> {
  return screen
    .queryAllByTestId("card-details-heading")
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
}

let refresh: MockFunction;

beforeEach(() => {
  mockAuthState.isProjectConnected = true;
  mockAuthState.isUserConnected = false;
  mockAuthState.teamsOrganization = null;
  deleteItemMock.mockReset();
  deleteItemMock.mockResolvedValue(undefined as never);
  apiGetMock.mockReset();
  apiGetMock.mockResolvedValue({ data: {} } as never);
  navigateMock.mockReset();
  refresh = jest
    .spyOn(ConnectedWorkspaces, "refresh")
    .mockResolvedValue(undefined) as unknown as MockFunction;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function click(name: string): Promise<void> {
  const button: HTMLElement = await screen.findByRole("button", { name });

  await act(async () => {
    fireEvent.click(button);
  });
}

type Page = "project" | "user";

async function renderSlack(page: Page): Promise<void> {
  await act(async () => {
    render(
      page === "project" ? (
        <SlackIntegration onConnected={() => {}} onDisconnected={() => {}} />
      ) : (
        <SlackIntegration
          onConnected={() => {}}
          onDisconnected={() => {}}
          hideProjectCards={true}
          startPage={ConnectStartPage.UserSettings}
        />
      ),
    );
  });
}

async function renderTeams(page: Page): Promise<void> {
  await act(async () => {
    render(
      page === "project" ? (
        <MicrosoftTeamsIntegration
          onConnected={() => {}}
          onDisconnected={() => {}}
        />
      ) : (
        <MicrosoftTeamsIntegration
          onConnected={() => {}}
          onDisconnected={() => {}}
          hideProjectCards={true}
          startPage={ConnectStartPage.UserSettings}
        />
      ),
    );
  });
}

const SLACK_PROJECT_CARD: DrawnCard = {
  title: "OneUptime is installed in the Acme Slack workspace",
  description:
    "It posts what your notification rules send, creates a channel for each incident and invites its people. Each member connects their own Slack account to act as themselves.",
  buttons: [],
  moreMenu: "Manage the Slack connection",
};

const SLACK_PROJECT_MENU: Array<string> = [
  "View Channels",
  "Uninstall OneUptime from Slack",
];

const SLACK_CONNECT_CARD: DrawnCard = {
  title: "Connect your Slack account",
  description:
    "OneUptime is installed in the Acme Slack workspace. Connect your account there to acknowledge incidents and get messages as yourself, in Slack.",
  buttons: ["Connect my account with Slack"],
};

const SLACK_CONNECTED_CARD: DrawnCard = {
  title: "Your Slack account is connected",
  description:
    "Buttons, commands and reactions in Slack act as you, with your permissions in this project, and the OneUptime app's Home in Slack shows your on-call shifts.",
  buttons: ["Disconnect"],
};

describe("Project Settings > Slack", () => {
  test("the project's card comes first, then yours to connect, then the channels", async () => {
    await renderSlack("project");

    expect(cardIn("slack-project-connection")).toEqual(SLACK_PROJECT_CARD);
    expect(cardIn("slack-your-account")).toEqual(SLACK_CONNECT_CARD);
    expect(allCardTitles()).toEqual([
      SLACK_PROJECT_CARD.title,
      SLACK_CONNECT_CARD.title,
    ]);
    expect(screen.getByTestId("slack-channels-card")).toBeInTheDocument();

    // In the page's order: the project's card above yours.
    expect(
      screen
        .getByTestId("slack-project-connection")
        .compareDocumentPosition(screen.getByTestId("slack-your-account")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The project's card asks nothing: its channels and Uninstall are in its ⋯.
    expect(await openMoreMenu("Manage the Slack connection")).toEqual(
      SLACK_PROJECT_MENU,
    );
    // Yours keeps the page's one main action.
    expect(allButtons()).toContain("Connect my account with Slack");
  });

  test("Uninstall asks first: what goes with it, and Cancel leaves everything as it was", async () => {
    await renderSlack("project");

    await openMoreMenu("Manage the Slack connection");
    await pickMenuItem("Uninstall OneUptime from Slack");

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Uninstall OneUptime from Slack?"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "OneUptime stops posting to Slack and every member's account is disconnected. Rules and summaries are kept for when you reconnect.",
      ),
    ).toBeInTheDocument();
    expect(deleteItemMock).not.toHaveBeenCalled();

    await click("Cancel");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(cardIn("slack-project-connection")).toEqual(SLACK_PROJECT_CARD);
  });

  test("connected yourself: your card says so, and Uninstall is still on the project's card", async () => {
    mockAuthState.isUserConnected = true;
    await renderSlack("project");

    expect(cardIn("slack-project-connection")).toEqual(SLACK_PROJECT_CARD);
    expect(cardIn("slack-your-account")).toEqual(SLACK_CONNECTED_CARD);
    // The old title read "You are connected with Acme team on Slack".
    expect(allCardTitles()).not.toContain(
      "You are connected with Acme team on Slack",
    );
  });

  test("uninstalling while connected yourself: the project and your account are both gone from the page", async () => {
    mockAuthState.isUserConnected = true;
    await renderSlack("project");

    await openMoreMenu("Manage the Slack connection");
    await pickMenuItem("Uninstall OneUptime from Slack");
    await click("Uninstall");

    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceProjectAuthToken);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Back to the start: nothing installed, nobody connected.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("slack-project-connection")).toBeNull();
    expect(cardIn("slack-your-account").title).toBe("Connect with Slack");
    expect(allButtons()).not.toContain("Disconnect");
    expect(screen.queryByTestId("slack-channels-card")).toBeNull();
  });

  test("nothing connected: one card, what Slack gives, and Connect with Slack", async () => {
    mockAuthState.isProjectConnected = false;
    await renderSlack("project");

    expect(screen.queryByTestId("slack-project-connection")).toBeNull();
    expect(cardIn("slack-your-account")).toEqual({
      title: "Connect with Slack",
      description:
        "Post incidents, alerts and scheduled maintenance to your Slack channels, give each incident a channel of its own, and let your team acknowledge, resolve and page from Slack.",
      buttons: ["Connect with Slack"],
    });
    expect(screen.queryByTestId("slack-channels-card")).toBeNull();
  });
});

describe("User Settings > Slack", () => {
  test("not connected yourself: only your card, with no project buttons", async () => {
    await renderSlack("user");

    expect(screen.queryByTestId("slack-project-connection")).toBeNull();
    expect(cardIn("slack-your-account")).toEqual(SLACK_CONNECT_CARD);
    expect(allCardTitles()).toEqual([SLACK_CONNECT_CARD.title]);
    expect(allButtons()).toEqual(["Connect my account with Slack"]);
    expect(screen.queryByTestId("slack-channels-card")).toBeNull();
  });

  test("connected: what it lets you do, and Disconnect - nothing else", async () => {
    mockAuthState.isUserConnected = true;
    await renderSlack("user");

    expect(cardIn("slack-your-account")).toEqual(SLACK_CONNECTED_CARD);
    expect(allButtons()).toEqual(["Disconnect"]);
  });

  test("the project not connected: who connects it, and no install button on a personal page", async () => {
    mockAuthState.isProjectConnected = false;
    await renderSlack("user");

    expect(cardIn("slack-your-account")).toEqual({
      title: "Slack is not connected to this project yet",
      description:
        "A Project Admin connects it under Project Settings → Workspace → Slack. Then you can connect your own Slack account here.",
      buttons: [],
    });
    expect(allButtons()).toEqual([]);
  });
});

const TEAMS_PROJECT_CARD: DrawnCard = {
  title: "Admin Consent Completed",
  description:
    "Consent is granted for your Microsoft 365 organization, so OneUptime can post to your teams' channels.",
  buttons: [],
  moreMenu: "Manage the Microsoft Teams connection",
};

const TEAMS_PROJECT_MENU: Array<string> = [
  "View Teams",
  "Reset Admin Consent",
  "Connect a Different Organization",
  "Uninstall OneUptime from Microsoft Teams",
];

const TEAMS_CONNECT_CARD: DrawnCard = {
  title: "Connect your Microsoft Teams account",
  description:
    "Acknowledge incidents and get messages from OneUptime as yourself, in Microsoft Teams.",
  buttons: ["Connect my account with Microsoft Teams"],
};

const TEAMS_CONNECTED_CARD: DrawnCard = {
  title: "Your Microsoft Teams account is connected",
  description:
    "Buttons and commands in Microsoft Teams act as you, with your permissions in this project. Open the OneUptime app in Microsoft Teams and type “home” to see your on-call shifts and the open incidents.",
  buttons: ["Open OneUptime in Microsoft Teams", "Disconnect"],
};

const INSTALL_CARD_TITLE: string =
  "Action Required: Install This Deployment's App on Microsoft Teams";

describe("Project Settings > Microsoft Teams", () => {
  test("the project's card - its teams, consent and Uninstall - then yours to connect", async () => {
    await renderTeams("project");

    expect(cardIn("microsoft-teams-project-connection")).toEqual(
      TEAMS_PROJECT_CARD,
    );
    expect(cardIn("microsoft-teams-your-account")).toEqual(TEAMS_CONNECT_CARD);
    expect(screen.getByTestId("teams-channels-card")).toBeInTheDocument();
    expect(screen.getByTestId("teams-chats-card")).toBeInTheDocument();
    expect(screen.getByText(INSTALL_CARD_TITLE)).toBeInTheDocument();
    expect(
      screen.getByTestId(MICROSOFT_TEAMS_SETUP_GUIDE_TEST_ID),
    ).toBeInTheDocument();

    // Its teams, consent and Uninstall are in its ⋯.
    expect(await openMoreMenu("Manage the Microsoft Teams connection")).toEqual(
      TEAMS_PROJECT_MENU,
    );
  });

  test("Reset Admin Consent, from the ⋯: the card asks for consent again, and its ⋯ can still move or uninstall the project", async () => {
    await renderTeams("project");

    await openMoreMenu("Manage the Microsoft Teams connection");
    await pickMenuItem("Reset Admin Consent");

    expect(cardIn("microsoft-teams-project-connection")).toEqual({
      title: "Grant Admin Consent",
      description:
        "A Microsoft 365 admin grants the OneUptime app consent for your whole organization, so it can post to channels.",
      buttons: ["Grant Admin Consent"],
      moreMenu: "Manage the Microsoft Teams connection",
    });
    expect(await openMoreMenu("Manage the Microsoft Teams connection")).toEqual(
      [
        "View Teams",
        "Connect a Different Organization",
        "Uninstall OneUptime from Microsoft Teams",
      ],
    );
    expect(deleteItemMock).not.toHaveBeenCalled();
  });

  test("connected yourself: your card says so and opens the app, and Uninstall is still on the project's card", async () => {
    mockAuthState.isUserConnected = true;
    await renderTeams("project");

    expect(cardIn("microsoft-teams-project-connection")).toEqual(
      TEAMS_PROJECT_CARD,
    );
    expect(cardIn("microsoft-teams-your-account")).toEqual(
      TEAMS_CONNECTED_CARD,
    );
  });

  test("uninstalling while connected yourself: asked first, then back to Grant Admin Consent, and nobody connected", async () => {
    mockAuthState.isUserConnected = true;
    await renderTeams("project");

    await openMoreMenu("Manage the Microsoft Teams connection");
    await pickMenuItem("Uninstall OneUptime from Microsoft Teams");

    expect(
      within(screen.getByRole("dialog")).getByText(
        "Uninstall OneUptime from Microsoft Teams?",
      ),
    ).toBeInTheDocument();
    expect(deleteItemMock).not.toHaveBeenCalled();

    await click("Uninstall");

    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceProjectAuthToken);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(cardIn("microsoft-teams-project-connection")).toEqual({
      title: "Grant Admin Consent",
      description:
        "A Microsoft 365 admin grants the OneUptime app consent for your whole organization, so it can post to channels.",
      buttons: ["Grant Admin Consent"],
    });
    expect(screen.queryByTestId("microsoft-teams-your-account")).toBeNull();
    expect(allButtons()).not.toContain("Disconnect");
  });

  test("nothing connected: Grant Admin Consent is the only card to act on", async () => {
    mockAuthState.isProjectConnected = false;
    await renderTeams("project");

    expect(cardIn("microsoft-teams-project-connection").buttons).toEqual([
      "Grant Admin Consent",
    ]);
    expect(screen.queryByTestId("microsoft-teams-your-account")).toBeNull();
    expect(screen.queryByText(INSTALL_CARD_TITLE)).toBeNull();
  });
});

/*
 * THE ORGANIZATION THE PROJECT IS CONNECTED TO (Teams store certification,
 * ticket 5877223).
 *
 * Every Microsoft sign-in for a connected project goes to its Microsoft
 * 365 organization, and Microsoft stops anybody from another one on its
 * own page - "Selected user account does not exist in tenant 'Contoso'" -
 * without sending them back. A store reviewer who opened a test project
 * connected to another reviewer's test tenant read "Consent is granted for
 * your Microsoft 365 organization", signed in with their own, and was
 * stopped. The cards now name the organization - every Microsoft 365
 * developer tenant is called Contoso, so by its domain too - and a project
 * can be moved to a different organization from the project card's ⋯.
 */
const CONTOSO: { tenantId: string; name: string; domain: string } = {
  tenantId: "1c0f7a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
  name: "Contoso",
  domain: "m365x11111111.onmicrosoft.com",
};

const CONSENT_AT_ANY_ORGANIZATION: string =
  "https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=11111111-2222-3333-4444-555555555555";

// The route a call to the Dashboard's API.get asked for.
function routeOf(call: Array<unknown>): string {
  return String((call[0] as { url?: unknown } | undefined)?.url || "");
}

describe("Microsoft Teams: the organization the project is connected to", () => {
  test("its name and domain, on the project's card and on yours as the organization to sign in to", async () => {
    mockAuthState.teamsOrganization = CONTOSO;
    await renderTeams("project");

    expect(cardIn("microsoft-teams-project-connection")).toEqual({
      ...TEAMS_PROJECT_CARD,
      description:
        "Consent is granted for the Microsoft 365 organization Contoso (m365x11111111.onmicrosoft.com), so OneUptime can post to its teams' channels.",
    });
    expect(cardIn("microsoft-teams-your-account")).toEqual({
      ...TEAMS_CONNECT_CARD,
      description:
        "This project is connected to the Microsoft 365 organization Contoso (m365x11111111.onmicrosoft.com). Sign in with your account there to acknowledge incidents and get messages from OneUptime as yourself, in Microsoft Teams.",
    });
  });

  test("on User Settings, where each member connects, the same organization", async () => {
    mockAuthState.teamsOrganization = CONTOSO;
    await renderTeams("user");

    expect(cardIn("microsoft-teams-your-account").description).toBe(
      "This project is connected to the Microsoft 365 organization Contoso (m365x11111111.onmicrosoft.com). Sign in with your account there to acknowledge incidents and get messages from OneUptime as yourself, in Microsoft Teams.",
    );
    expect(allButtons()).toEqual(["Connect my account with Microsoft Teams"]);
  });

  test("a connection made before organizations were named: by its tenant ID", async () => {
    mockAuthState.teamsOrganization = { tenantId: CONTOSO.tenantId };
    await renderTeams("project");

    expect(cardIn("microsoft-teams-project-connection").description).toBe(
      "Consent is granted for the Microsoft 365 organization with tenant ID 1c0f7a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b, so OneUptime can post to its teams' channels.",
    );
    expect(cardIn("microsoft-teams-your-account").description).toBe(
      "This project is connected to the Microsoft 365 organization with tenant ID 1c0f7a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b. Sign in with your account there to acknowledge incidents and get messages from OneUptime as yourself, in Microsoft Teams.",
    );
  });

  test("a name without a domain, or a domain without a name: whichever is known", async () => {
    mockAuthState.teamsOrganization = {
      tenantId: CONTOSO.tenantId,
      domain: CONTOSO.domain,
    };
    await renderTeams("project");

    expect(cardIn("microsoft-teams-project-connection").description).toBe(
      "Consent is granted for the Microsoft 365 organization m365x11111111.onmicrosoft.com, so OneUptime can post to its teams' channels.",
    );

    cleanup();
    mockAuthState.teamsOrganization = {
      tenantId: CONTOSO.tenantId,
      name: CONTOSO.name,
    };
    await renderTeams("project");

    expect(cardIn("microsoft-teams-project-connection").description).toBe(
      "Consent is granted for the Microsoft 365 organization Contoso, so OneUptime can post to its teams' channels.",
    );
  });

  test("Reset Admin Consent: consent is asked of an admin of that organization, the only one Microsoft takes", async () => {
    mockAuthState.teamsOrganization = CONTOSO;
    await renderTeams("project");

    await openMoreMenu("Manage the Microsoft Teams connection");
    await pickMenuItem("Reset Admin Consent");

    expect(cardIn("microsoft-teams-project-connection").description).toBe(
      "A Microsoft 365 admin of the organization Contoso (m365x11111111.onmicrosoft.com) grants the OneUptime app consent again, so it can post to its teams' channels.",
    );

    cleanup();
    mockAuthState.teamsOrganization = { tenantId: CONTOSO.tenantId };
    await renderTeams("project");

    await openMoreMenu("Manage the Microsoft Teams connection");
    await pickMenuItem("Reset Admin Consent");

    expect(cardIn("microsoft-teams-project-connection").description).toBe(
      "A Microsoft 365 admin of the organization with tenant ID 1c0f7a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b grants the OneUptime app consent again, so it can post to its teams' channels.",
    );
  });

  test("Connect a Different Organization, from the ⋯: asked first - what goes with it - and Cancel leaves everything as it was", async () => {
    mockAuthState.teamsOrganization = CONTOSO;
    await renderTeams("project");

    await openMoreMenu("Manage the Microsoft Teams connection");
    await pickMenuItem("Connect a Different Organization");

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(
      within(dialog).getByText(
        "Connect a different Microsoft 365 organization?",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("confirm-modal-description").textContent,
    ).toBe(
      "OneUptime first disconnects this project's Microsoft 365 organization and every member's Microsoft Teams account. Rules and summaries are kept.",
    );

    await click("Cancel");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(cardIn("microsoft-teams-project-connection").title).toBe(
      "Admin Consent Completed",
    );
  });

  test("Connect a Different Organization, confirmed: the connection goes first, then consent starts again, for any organization", async () => {
    mockAuthState.teamsOrganization = CONTOSO;
    mockAuthState.isUserConnected = true;
    apiGetMock.mockImplementation((async (...args: Array<unknown>) => {
      return routeOf(args).includes("/microsoft-teams/admin-consent")
        ? { data: { authorizationUrl: CONSENT_AT_ANY_ORGANIZATION } }
        : { data: {} };
    }) as never);
    await renderTeams("project");

    await openMoreMenu("Manage the Microsoft Teams connection");
    await pickMenuItem("Connect a Different Organization");
    await click("Disconnect and Continue");

    // The project's connection, deleted as Uninstall deletes it.
    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceProjectAuthToken);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Then consent, which the server sends to any organization now.
    const consentCalls: Array<number> = apiGetMock.mock.calls
      .map((call: Array<unknown>, index: number): number => {
        return routeOf(call).includes("/microsoft-teams/admin-consent")
          ? index
          : -1;
      })
      .filter((index: number): boolean => {
        return index >= 0;
      });

    expect(consentCalls).toHaveLength(1);
    expect(deleteItemMock.mock.invocationCallOrder[0]!).toBeLessThan(
      apiGetMock.mock.invocationCallOrder[consentCalls[0]!]!,
    );
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toContain(
      "/organizations/v2.0/adminconsent",
    );

    // Until Microsoft sends the browser back, the page is a project not connected.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cardIn("microsoft-teams-project-connection")).toEqual({
      title: "Grant Admin Consent",
      description:
        "A Microsoft 365 admin grants the OneUptime app consent for your whole organization, so it can post to channels.",
      buttons: ["Grant Admin Consent"],
    });
    expect(allButtons()).not.toContain("Disconnect");
  });

  test("a disconnect that fails is said in the dialog, which stays open, and consent does not start", async () => {
    mockAuthState.teamsOrganization = CONTOSO;
    deleteItemMock.mockRejectedValue(
      new Error("You do not have permission to delete this.") as never,
    );
    await renderTeams("project");

    await openMoreMenu("Manage the Microsoft Teams connection");
    await pickMenuItem("Connect a Different Organization");
    await click("Disconnect and Continue");

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(
      within(dialog).getByText(
        "Error: You do not have permission to delete this.",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(cardIn("microsoft-teams-project-connection").title).toBe(
      "Admin Consent Completed",
    );
  });
});

describe("User Settings > Microsoft Teams", () => {
  test("not connected yourself: only your card - no consent, install, setup guide, teams or chats", async () => {
    await renderTeams("user");

    expect(
      screen.queryByTestId("microsoft-teams-project-connection"),
    ).toBeNull();
    expect(cardIn("microsoft-teams-your-account")).toEqual(TEAMS_CONNECT_CARD);
    expect(allButtons()).toEqual(["Connect my account with Microsoft Teams"]);
    expect(allCardTitles()).toEqual([TEAMS_CONNECT_CARD.title]);
    expect(screen.queryByText(INSTALL_CARD_TITLE)).toBeNull();
    expect(
      screen.queryByTestId(MICROSOFT_TEAMS_SETUP_GUIDE_TEST_ID),
    ).toBeNull();
    expect(screen.queryByTestId("teams-channels-card")).toBeNull();
    expect(screen.queryByTestId("teams-chats-card")).toBeNull();
  });

  test("connected: Open OneUptime in Microsoft Teams opens the app's own page in Teams", async () => {
    mockAuthState.isUserConnected = true;
    const open: ReturnType<typeof jest.spyOn> = jest
      .spyOn(window, "open")
      .mockImplementation(() => {
        return null;
      });
    await renderTeams("user");

    expect(cardIn("microsoft-teams-your-account")).toEqual(
      TEAMS_CONNECTED_CARD,
    );
    expect(allButtons()).toEqual([
      "Open OneUptime in Microsoft Teams",
      "Disconnect",
    ]);

    await click("Open OneUptime in Microsoft Teams");

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]).toEqual([
      `https://teams.microsoft.com/l/app/${TEAMS_CLIENT_ID}`,
      "_blank",
    ]);
    expect(deleteItemMock).not.toHaveBeenCalled();
  });

  test("the project not connected: who connects it, and no consent button on a personal page", async () => {
    mockAuthState.isProjectConnected = false;
    await renderTeams("user");

    expect(cardIn("microsoft-teams-your-account")).toEqual({
      title: "Microsoft Teams is not connected to this project yet",
      description:
        "A Project Admin connects it under Project Settings → Workspace → Microsoft Teams. Then you can connect your own Microsoft Teams account here.",
      buttons: [],
    });
    expect(allButtons()).toEqual([]);
    expect(allCardTitles()).toEqual([
      "Microsoft Teams is not connected to this project yet",
    ]);
  });
});

describe("the OneUptime app's link in Microsoft Teams", () => {
  test("is the app's page, by the bot's id", () => {
    expect(getMicrosoftTeamsAppLink(TEAMS_CLIENT_ID)).toBe(
      "https://teams.microsoft.com/l/app/11111111-2222-3333-4444-555555555555",
    );
  });

  test("an id is a path segment, never more of the address", () => {
    expect(getMicrosoftTeamsAppLink("a/b?c=d#e")).toBe(
      "https://teams.microsoft.com/l/app/a%2Fb%3Fc%3Dd%23e",
    );
  });

  test("on a server in a US Government cloud (MICROSOFT_TEAMS_CLOUD), that cloud's Teams", () => {
    expect(getMicrosoftTeamsAppLink(TEAMS_CLIENT_ID, "gcc-high")).toBe(
      `https://gov.teams.microsoft.us/l/app/${TEAMS_CLIENT_ID}`,
    );
    expect(getMicrosoftTeamsAppLink(TEAMS_CLIENT_ID, "DoD")).toBe(
      `https://dod.teams.microsoft.us/l/app/${TEAMS_CLIENT_ID}`,
    );
    // GCC is Teams on the commercial cloud's web.
    expect(getMicrosoftTeamsAppLink(TEAMS_CLIENT_ID, "gcc")).toBe(
      `https://teams.microsoft.com/l/app/${TEAMS_CLIENT_ID}`,
    );
    // A setting that names no cloud costs only the link: the commercial one.
    expect(getMicrosoftTeamsAppLink(TEAMS_CLIENT_ID, "usgov")).toBe(
      `https://teams.microsoft.com/l/app/${TEAMS_CLIENT_ID}`,
    );
  });
});
