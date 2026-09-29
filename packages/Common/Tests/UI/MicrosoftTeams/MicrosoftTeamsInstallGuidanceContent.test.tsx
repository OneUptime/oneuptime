import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import fs from "fs";
import path from "path";

/*
 * The self-hosted Microsoft Teams failure this suite guards is a content bug,
 * not a logic bug: the product told admins, in prose, that they could skip the
 * one step that makes notifications work ("if someone already installed the
 * OneUptime app ... you can skip the installation steps"), and it hid the
 * install card from projects whose connection was project-level rather than
 * per-user. Both the gating and the words are asserted here.
 */

const MOCK_TEAMS_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const INTEGRATION_COMPONENT_PATH: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx",
);

const DOCS_MARKDOWN_PATH: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en/self-hosted/microsoft-teams-integration.md",
);

interface MockConfigState {
  billingEnabled: boolean;
}

/*
 * BILLING_ENABLED separates SaaS from self-hosted and has to differ per test,
 * so it is exposed as a getter over mutable state rather than a frozen value.
 */
const mockConfigState: MockConfigState = {
  billingEnabled: false,
};

interface MockAuthState {
  isProjectConnected: boolean;
  isUserConnected: boolean;
  isAdminConsentGranted: boolean;
}

const mockAuthState: MockAuthState = {
  isProjectConnected: false,
  isUserConnected: false,
  isAdminConsentGranted: false,
};

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = {
    ...actualConfig,
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
  };

  /*
   * defineProperty rather than a `get` in the object literal: TypeScript
   * downlevels a spread-plus-getter literal into Object.assign, which reads the
   * getter once and freezes its value — the accessor has to be attached after
   * the spread to stay live.
   */
  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockConfigState.billingEnabled;
    },
  });

  return mockedConfig;
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return {
          toString: () => {
            return "project-id";
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
        const state: MockAuthState = mockAuthState as MockAuthState;

        if (modelName.includes("Project")) {
          if (!state.isProjectConnected) {
            return { data: [], count: 0, skip: 0, limit: 1 };
          }

          return {
            data: [
              {
                id: {
                  toString: () => {
                    return "project-auth-token-id";
                  },
                },
                miscData: {
                  adminConsentGranted: state.isAdminConsentGranted,
                },
              },
            ],
            count: 1,
            skip: 0,
            limit: 1,
          };
        }

        if (!state.isUserConnected) {
          return { data: [], count: 0, skip: 0, limit: 1 };
        }

        return {
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
        };
      },
    },
  };
});

/*
 * The sibling cards each fetch on mount and are irrelevant to the install
 * guidance; stubbing them keeps the render deterministic without weakening any
 * assertion below.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChannelsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="channels-card" />;
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
        return <div data-testid="chats-card" />;
      },
    };
  },
);

import MicrosoftTeamsIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import MicrosoftTeamsIntegrationDocumentation from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation";

type ReadFileFunction = (filePath: string) => string;

const readSource: ReadFileFunction = (filePath: string): string => {
  return fs.readFileSync(filePath, "utf8");
};

type RenderDocumentationFunction = () => Promise<string>;

/*
 * MarkdownViewer is lazy-loaded and react-markdown is mocked to a div holding
 * its children, so the resolved markdown source is what lands in the DOM.
 * Returning the text makes substring assertions readable.
 */
const renderDocumentationText: RenderDocumentationFunction =
  async (): Promise<string> => {
    render(<MicrosoftTeamsIntegrationDocumentation />);

    const markdown: HTMLElement = await screen.findByTestId("react-markdown");

    return markdown.textContent || "";
  };

interface RenderIntegrationOptions {
  billingEnabled: boolean;
  isProjectConnected: boolean;
  isUserConnected: boolean;
  isAdminConsentGranted: boolean;
}

type RenderIntegrationFunction = (
  options: RenderIntegrationOptions,
) => Promise<void>;

const renderIntegration: RenderIntegrationFunction = async (
  options: RenderIntegrationOptions,
): Promise<void> => {
  mockConfigState.billingEnabled = options.billingEnabled;
  mockAuthState.isProjectConnected = options.isProjectConnected;
  mockAuthState.isUserConnected = options.isUserConnected;
  mockAuthState.isAdminConsentGranted = options.isAdminConsentGranted;

  render(
    <MicrosoftTeamsIntegration
      onConnected={() => {}}
      onDisconnected={() => {}}
    />,
  );

  /*
   * The component mounts behind a PageLoader while it fetches auth state; the
   * always-present admin-consent Card is the first thing painted once that
   * settles.
   */
  await waitFor(() => {
    expect(screen.queryAllByTestId("card").length).toBeGreaterThan(0);
  });
};

beforeEach(() => {
  mockConfigState.billingEnabled = false;
  mockAuthState.isProjectConnected = false;
  mockAuthState.isUserConnected = false;
  mockAuthState.isAdminConsentGranted = false;
});

const INSTALL_CARD_TITLE: string =
  "Action Required: Install This Deployment's App on Microsoft Teams";

const SETUP_GUIDE_TITLE: string = "Full Microsoft Teams setup guide";

describe("MicrosoftTeamsIntegration install card gating", () => {
  test("shows the install card for a project-level connection with no per-user connection", async () => {
    await renderIntegration({
      billingEnabled: false,
      isProjectConnected: true,
      isUserConnected: false,
      isAdminConsentGranted: true,
    });

    expect(await screen.findByText(INSTALL_CARD_TITLE)).toBeInTheDocument();
  });

  test("still shows the install card once the user is connected as well", async () => {
    await renderIntegration({
      billingEnabled: false,
      isProjectConnected: true,
      isUserConnected: true,
      isAdminConsentGranted: true,
    });

    expect(await screen.findByText(INSTALL_CARD_TITLE)).toBeInTheDocument();
  });

  /*
   * Admin consent is stored on the project auth token, so a user-only
   * connection can never reach the consent-completed state — the card stays
   * hidden for a reason that has nothing to do with the gate above.
   */
  test("hides the install card when only the user is connected", async () => {
    await renderIntegration({
      billingEnabled: false,
      isProjectConnected: false,
      isUserConnected: true,
      isAdminConsentGranted: true,
    });

    expect(screen.queryByText(INSTALL_CARD_TITLE)).not.toBeInTheDocument();
  });

  test("hides the install card when admin consent has not been granted", async () => {
    await renderIntegration({
      billingEnabled: false,
      isProjectConnected: true,
      isUserConnected: true,
      isAdminConsentGranted: false,
    });

    expect(screen.queryByText(INSTALL_CARD_TITLE)).not.toBeInTheDocument();
  });

  test("hides the install card on the billing-enabled (SaaS) deployment", async () => {
    await renderIntegration({
      billingEnabled: true,
      isProjectConnected: true,
      isUserConnected: true,
      isAdminConsentGranted: true,
    });

    expect(screen.queryByText(INSTALL_CARD_TITLE)).not.toBeInTheDocument();
  });
});

describe("MicrosoftTeamsIntegration setup guide availability", () => {
  test("renders the collapsible full setup guide for self-hosted", async () => {
    await renderIntegration({
      billingEnabled: false,
      isProjectConnected: true,
      isUserConnected: true,
      isAdminConsentGranted: true,
    });

    expect(await screen.findByText(SETUP_GUIDE_TITLE)).toBeInTheDocument();
  });

  test("the setup guide starts collapsed, not dumped onto a working page", async () => {
    /*
     * The guide is ~150 lines of Azure setup. Making it reachable was the fix;
     * making it unavoidable would be a new problem for every deployment whose
     * integration already works.
     *
     * CollapsibleSection keeps its children mounted and hides them with CSS, so
     * the honest assertion is the accessible expanded state rather than the
     * absence of the content from the DOM.
     */
    await renderIntegration({
      billingEnabled: false,
      isProjectConnected: true,
      isUserConnected: true,
      isAdminConsentGranted: true,
    });

    const title: HTMLElement = await screen.findByText(SETUP_GUIDE_TITLE);
    const toggle: HTMLElement | null = title.closest("[aria-expanded]");

    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("renders the setup guide even before anything is connected", async () => {
    await renderIntegration({
      billingEnabled: false,
      isProjectConnected: false,
      isUserConnected: false,
      isAdminConsentGranted: false,
    });

    expect(await screen.findByText(SETUP_GUIDE_TITLE)).toBeInTheDocument();
  });

  test("does not render the setup guide on the billing-enabled (SaaS) deployment", async () => {
    await renderIntegration({
      billingEnabled: true,
      isProjectConnected: true,
      isUserConnected: true,
      isAdminConsentGranted: true,
    });

    expect(screen.queryByText(SETUP_GUIDE_TITLE)).not.toBeInTheDocument();
  });
});

describe("Install card markdown", () => {
  /*
   * Read from source rather than the DOM: this markdown template literal is
   * built from a template string the component only evaluates behind several
   * pieces of state, and the regression is a literal sentence of prose. A
   * source-text assertion pins the sentence itself.
   */
  const integrationSource: string = readSource(INTEGRATION_COMPONENT_PATH);

  test("no longer tells admins they can skip the installation steps", () => {
    expect(integrationSource).not.toContain("you can skip the installation");
    expect(integrationSource).not.toContain(
      "you do not need to do anything here",
    );
  });

  test("warns against assuming an existing OneUptime app is the right one", () => {
    expect(integrationSource).toContain(
      'Do not skip this because a "OneUptime" app is already in your tenant.',
    );
    expect(integrationSource).toContain("Microsoft Teams store");
    expect(integrationSource).toContain(
      "The bot is not part of the conversation roster.",
    );
  });

  /*
   * Removed: a source-text grep for the literal "${MicrosoftTeamsAppClientId}".
   * It wrote the implementation out a second time and proved nothing the next
   * test does not prove properly — that the id reaches the rendered DOM.
   */

  test("renders the interpolated client id in the install card for self-hosted", async () => {
    await renderIntegration({
      billingEnabled: false,
      isProjectConnected: true,
      isUserConnected: false,
      isAdminConsentGranted: true,
    });

    await screen.findByText(INSTALL_CARD_TITLE);

    await waitFor(() => {
      const markdownBlocks: Array<HTMLElement> =
        screen.getAllByTestId("react-markdown");

      const combinedText: string = markdownBlocks
        .map((element: HTMLElement) => {
          return element.textContent || "";
        })
        .join("\n");

      expect(combinedText).toContain(MOCK_TEAMS_CLIENT_ID);
      expect(combinedText).not.toContain("you can skip the installation");
      expect(combinedText).toContain(
        'Do not skip this because a "OneUptime" app is already in your tenant.',
      );
    });
  });
});

describe("MicrosoftTeamsIntegrationDocumentation", () => {
  test("lists TeamsAppInstallation.ReadForTeam.All as a required application permission", async () => {
    const text: string = await renderDocumentationText();

    expect(text).toContain("**Add Application Permissions**");
    expect(text).toContain("**TeamsAppInstallation.ReadForTeam.All**");

    const permissionLine: string =
      text
        .split("\n")
        .find((line: string) => {
          return line.includes("TeamsAppInstallation.ReadForTeam.All");
        })
        ?.trim() || "";

    expect(permissionLine).toContain("Required");
    expect(permissionLine.toLowerCase()).not.toContain("optional");
  });

  test("Step 8 warns against installing from the Microsoft Teams store", async () => {
    const text: string = await renderDocumentationText();

    const stepEightSection: string = text
      .split("##### Step 8")[1]!
      .split("##### Step 9")[0]!;

    expect(stepEightSection).toContain(
      'Do not install "OneUptime" from the Microsoft Teams store for a self-hosted deployment.',
    );
    expect(stepEightSection).toContain("OneUptime Cloud");
    expect(stepEightSection).toContain("MICROSOFT_TEAMS_APP_CLIENT_ID");
  });

  test("Step 9 tells the admin to add the app to every team", async () => {
    const text: string = await renderDocumentationText();

    expect(text).toContain(
      "##### Step 9: Add the App to Every Team You Want Notifications In",
    );

    const stepNineSection: string = text
      .split("##### Step 9")[1]!
      .split("##### Troubleshooting")[0]!;

    expect(stepNineSection).toContain("installation is per team");
    expect(stepNineSection).toContain("Manage team");
  });

  test("Step 9 covers private channels needing their own install and shared channels being unsupported", async () => {
    const text: string = await renderDocumentationText();

    const stepNineSection: string = text
      .split("##### Step 9")[1]!
      .split("##### Troubleshooting")[0]!;

    expect(stepNineSection).toContain("**private** channel");
    expect(stepNineSection).toContain("Manage channel");
    expect(stepNineSection).toContain(
      "A team-level install does not cover private channels",
    );
    expect(stepNineSection).toContain(
      "Microsoft Teams does not allow bots in **shared** channels",
    );
  });

  test("Troubleshooting covers the roster error and names the diagnostic permission", async () => {
    const text: string = await renderDocumentationText();

    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    expect(troubleshooting).toContain(
      "The bot is not part of the conversation roster",
    );
    expect(troubleshooting).toContain(
      "The installed app is a different package",
    );
    expect(troubleshooting).toContain(
      "The Azure Bot has no Microsoft Teams channel",
    );
    expect(troubleshooting).toContain("TeamsAppInstallation.ReadForTeam.All");
  });

  test("Troubleshooting covers the empty-chats symptom", async () => {
    const text: string = await renderDocumentationText();

    const troubleshooting: string = text.split("##### Troubleshooting")[1]!;

    expect(troubleshooting).toContain(
      "No chats appear under Microsoft Teams Chats",
    );
    expect(troubleshooting).toContain("Refresh Chats");
  });
});

describe("Self-hosted docs markdown", () => {
  const docsMarkdown: string = readSource(DOCS_MARKDOWN_PATH);

  test("does not describe TeamsAppInstallation.ReadForTeam.All as optional", () => {
    const permissionLine: string =
      docsMarkdown
        .split("\n")
        .find((line: string) => {
          return line.includes("TeamsAppInstallation.ReadForTeam.All");
        })
        ?.trim() || "";

    expect(permissionLine).not.toBe("");
    expect(permissionLine.toLowerCase()).not.toContain("optional");
    expect(permissionLine).toContain("Required");
  });
});

describe("Settings navigation path is stated consistently", () => {
  /*
   * Every one of these files tells an admin where to find the app manifest, and
   * they must all name the same place. One of them used to say
   * "Settings -> Integrations -> Microsoft Teams", which does not exist — the
   * settings side menu section is "Workspace" — and it sat three lines below a
   * blockquote insisting the manifest from that page is the only one that
   * works. Prose assertions on individual sentences did not catch it, because
   * each file was checked against itself rather than against the menu.
   */
  const NAVIGATION_SOURCES: Array<string> = [
    INTEGRATION_COMPONENT_PATH,
    DOCS_MARKDOWN_PATH,
    path.join(
      REPO_ROOT,
      "App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation.tsx",
    ),
    path.join(
      REPO_ROOT,
      "App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsChatsCard.tsx",
    ),
    path.join(
      REPO_ROOT,
      "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
    ),
    path.join(REPO_ROOT, "Common/Server/API/MicrosoftTeamsAPI.ts"),
  ];

  test("the settings side menu really does call the section 'Workspace'", () => {
    const sideMenu: string = readSource(
      path.join(
        REPO_ROOT,
        "App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu.tsx",
      ),
    );

    expect(sideMenu).toContain('title: "Workspace"');
  });

  test.each(NAVIGATION_SOURCES)(
    "%s never routes admins through a non-existent Integrations section",
    (sourcePath: string) => {
      const source: string = readSource(sourcePath);

      for (const wrongPath of [
        "Settings -> Integrations",
        "Settings > Integrations",
        "Settings &gt; Integrations",
        "Integrations -> Microsoft Teams",
        "Integrations > Microsoft Teams",
      ]) {
        expect(source).not.toContain(wrongPath);
      }
    },
  );
});
