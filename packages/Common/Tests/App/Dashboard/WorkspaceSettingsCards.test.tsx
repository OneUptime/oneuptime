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
 */

interface MockAuthState {
  isProjectConnected: boolean;
  isUserConnected: boolean;
}

const mockAuthState: MockAuthState = {
  isProjectConnected: true,
  isUserConnected: false,
};

const deleteItemMock: MockFunction = getJestMockFunction();

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
      navigate: () => {},
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
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: async () => {
        return { data: {} };
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
                    miscData: {
                      teamName: "Acme",
                      adminConsentGranted: true,
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

// What one card draws: its title, its description and its buttons, in order.
interface DrawnCard {
  title: string;
  description: string;
  buttons: Array<string>;
}

function drawnCard(card: HTMLElement): DrawnCard {
  return {
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
  deleteItemMock.mockReset();
  deleteItemMock.mockResolvedValue(undefined as never);
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
  buttons: ["View Channels", "Uninstall OneUptime from Slack"],
};

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

    await click("Uninstall OneUptime from Slack");

    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceProjectAuthToken);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Back to the start: nothing installed, nobody connected.
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
        "A project admin connects it under Project Settings → Workspace → Slack. Then you can connect your own Slack account here.",
      buttons: [],
    });
    expect(allButtons()).toEqual([]);
  });
});

const TEAMS_PROJECT_CARD: DrawnCard = {
  title: "Admin Consent Completed",
  description:
    "Admin consent is granted for your Microsoft 365 organization. OneUptime posts what your notification rules send to your teams' channels. Each member connects their own Microsoft Teams account to act as themselves.",
  buttons: [
    "View Teams",
    "Reset Admin Consent",
    "Uninstall OneUptime from Microsoft Teams",
  ],
};

const TEAMS_CONNECT_CARD: DrawnCard = {
  title: "Connect your Microsoft Teams account",
  description:
    "Acknowledge incidents and get messages from OneUptime as yourself, in Microsoft Teams.",
  buttons: ["Connect my account with Microsoft Teams"],
};

const TEAMS_CONNECTED_CARD: DrawnCard = {
  title: "Your Microsoft Teams account is connected",
  description:
    "Buttons and commands in Microsoft Teams act as you, with your permissions in this project. Open the OneUptime app in Microsoft Teams and type home to see your on-call shifts and the open incidents.",
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

  test("uninstalling while connected yourself: back to Grant Admin Consent, and nobody connected", async () => {
    mockAuthState.isUserConnected = true;
    await renderTeams("project");

    await click("Uninstall OneUptime from Microsoft Teams");

    expect(
      (deleteItemMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(WorkspaceProjectAuthToken);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(cardIn("microsoft-teams-project-connection")).toEqual({
      title: "Grant Admin Consent",
      description:
        "Grant tenant-wide admin consent for the OneUptime Microsoft Teams app. This step is required to enable application permissions (e.g., posting to channels) without per-user consent. You must be a Microsoft 365 admin.",
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
        "A project admin connects it under Project Settings → Workspace → Microsoft Teams. Then you can connect your own Microsoft Teams account here.",
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
});
