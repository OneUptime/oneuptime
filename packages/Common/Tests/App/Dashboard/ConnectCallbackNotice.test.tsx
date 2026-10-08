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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A Slack, Microsoft Teams or GitHub connection that comes back unmade sends
 * the browser to the page it was started from with `?error=` and a code
 * (Common/Types/Workspace/ConnectCallback). The page says, above everything
 * else and in the reader's language, that the provider was not connected and
 * why - and still loads, its Connect button right there to try again. It
 * never shows the `?error=` value itself: anything it does not know reads as
 * "could not finish", so a crafted link cannot put words on the page. The
 * code is taken off the address once read.
 *
 * Each page also tells its start route which page it is (`?from=`), so the
 * callback can send the browser back to it, and the connect-return page
 * passes a connection that came back without a trusted project on to the
 * provider's page in the open project.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

const query: Record<string, string | null> = {};
const setQueryStringMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
const apiGetMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actualConfig,
    SlackAppClientId: "slack-client-id",
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    env: (name: string): string => {
      return name === "GITHUB_APP_NAME"
        ? "oneuptime-test-app"
        : (actualConfig["env"] as (name: string) => string)(name);
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: (name: string): string | null => {
        return query[name] ?? null;
      },
      setQueryString: (...args: Array<unknown>): void => {
        setQueryStringMock(...args);
      },
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
      getLocation: () => {
        return { pathname: "/" };
      },
      getCurrentRoute: () => {
        return {
          toString: () => {
            return `/dashboard/${PROJECT_ID}/code-repository`;
          },
        };
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
            return PROJECT_ID;
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
      isMasterAdmin: (): boolean => {
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
      deleteItem: async () => {
        return undefined;
      },
      getList: async () => {
        return { data: [], count: 0, skip: 0, limit: 1 };
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIPlanGate",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import CodeRepositoryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/CodeRepository/CodeRepository";
import ConnectReturn from "../../../../App/FeatureSet/Dashboard/src/Pages/ConnectReturn/ConnectReturn";
import MicrosoftTeamsIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegration";
import SlackIntegration from "../../../../App/FeatureSet/Dashboard/src/Components/Slack/SlackIntegration";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { ConnectStartPage } from "../../../Types/Workspace/ConnectCallback";

const COULD_NOT_FINISH: string =
  "OneUptime could not finish connecting. Please try again.";

// Words someone could put in a link, or a provider could have said.
const UNKNOWN_ERRORS: Array<string> = [
  "invalid_auth: the token was revoked by Slack",
  "<img src=x onerror=alert(1)>Sign in again at evil.example",
  "AADSTS50020: User account from identity provider does not exist in tenant",
  "Bad credentials",
];

beforeEach(() => {
  for (const name of Object.keys(query)) {
    delete query[name];
  }

  setQueryStringMock.mockReset();
  navigateMock.mockReset();
  apiGetMock.mockReset();
  apiGetMock.mockImplementation(async () => {
    return { data: { authorizationUrl: "https://provider.example/authorize" } };
  });
});

afterEach(() => {
  cleanup();
});

async function renderSlack(startPage?: ConnectStartPage): Promise<void> {
  await act(async () => {
    render(
      <SlackIntegration
        onConnected={() => {}}
        onDisconnected={() => {}}
        startPage={startPage}
      />,
    );
  });
}

async function renderTeams(startPage?: ConnectStartPage): Promise<void> {
  await act(async () => {
    render(
      <MicrosoftTeamsIntegration
        onConnected={() => {}}
        onDisconnected={() => {}}
        startPage={startPage}
      />,
    );
  });
}

async function renderCodeRepositories(): Promise<void> {
  await act(async () => {
    render(
      <CodeRepositoryPage
        pageRoute={new Route(`/dashboard/${PROJECT_ID}/code-repository`)}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });
}

function notice(): HTMLElement {
  return screen.getByTestId("connect-callback-notice");
}

// The start route asked for, as a string.
function requestedUrl(route: string): string | undefined {
  for (const call of apiGetMock.mock.calls) {
    const url: string = (call[0] as { url: URL }).url.toString();

    if (url.includes(route)) {
      return url;
    }
  }

  return undefined;
}

describe("Slack page (?error=)", () => {
  test("a known code is said above the page, in the page's own words, and the page still loads", async () => {
    query["error"] = "slack-other-workspace";

    await renderSlack();

    expect(notice()).toHaveTextContent("Slack was not connected");
    expect(notice()).toHaveTextContent(
      "You signed in to a different Slack workspace from the one this project is connected to. Please sign in to that workspace and try again.",
    );
    // Not an error page in place of the page: the Connect button is right there.
    expect(
      screen.getByRole("button", { name: "Connect with Slack" }),
    ).toBeInTheDocument();
  });

  test("the code is taken off the address once read", async () => {
    query["error"] = "link-invalid";

    await renderSlack();

    expect(setQueryStringMock).toHaveBeenCalledWith({ error: null });
    expect(notice()).toHaveTextContent(
      "This connection link is invalid, has expired, or has already been used. Please start again.",
    );
  });

  test.each(UNKNOWN_ERRORS)(
    "unknown text in ?error= is never shown: %s",
    async (unknown: string) => {
      query["error"] = unknown;

      await renderSlack();

      expect(notice()).toHaveTextContent(COULD_NOT_FINISH);
      expect(document.body.textContent).not.toContain(unknown);
      expect(document.querySelector("img")).toBeNull();
    },
  );

  test("a code only another provider answers with reads as could not finish", async () => {
    query["error"] = "teams-no-teams";

    await renderSlack();

    expect(notice()).toHaveTextContent(COULD_NOT_FINISH);
    expect(notice()).not.toHaveTextContent("Microsoft 365");
  });

  test("no ?error= says nothing and leaves the address alone", async () => {
    await renderSlack();

    expect(screen.queryByTestId("connect-callback-notice")).toBeNull();
    expect(setQueryStringMock).not.toHaveBeenCalled();
  });

  test("the notice closes", async () => {
    query["error"] = "cancelled";

    await renderSlack();

    expect(notice()).toHaveTextContent(
      "The connection was cancelled, so nothing was changed.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    expect(screen.queryByTestId("connect-callback-notice")).toBeNull();
  });

  test("Project Settings tells the start route it is the project's settings", async () => {
    await renderSlack();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Connect with Slack" }),
      );
    });

    expect(requestedUrl("/slack/install-url")).toContain(
      "from=project-settings",
    );
  });

  test("User Settings tells the start route it is the person's own settings", async () => {
    await renderSlack(ConnectStartPage.UserSettings);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Connect with Slack" }),
      );
    });

    expect(requestedUrl("/slack/install-url")).toContain("from=user-settings");
  });
});

describe("Microsoft Teams page (?error=)", () => {
  test("a known code is said in the page's own words, and the page still loads", async () => {
    query["error"] = "teams-no-teams";

    await renderTeams();

    expect(notice()).toHaveTextContent("Microsoft Teams was not connected");
    expect(notice()).toHaveTextContent(
      "Your Microsoft 365 organization has no teams yet. Please create a team in Microsoft Teams and try again.",
    );
    expect(
      screen.getByRole("button", { name: "Grant Admin Consent" }),
    ).toBeInTheDocument();
  });

  test.each(UNKNOWN_ERRORS)(
    "unknown text in ?error= is never shown: %s",
    async (unknown: string) => {
      query["error"] = unknown;

      await renderTeams();

      expect(notice()).toHaveTextContent(COULD_NOT_FINISH);
      expect(document.body.textContent).not.toContain(unknown);
      // The old "Error: {{error}}" line is gone.
      expect(document.body.textContent).not.toContain("Error: ");
    },
  );

  test("no permission is the start's own refusal", async () => {
    query["error"] = "no-permission";

    await renderTeams();

    expect(notice()).toHaveTextContent(
      "You do not have permission to connect this project to Microsoft Teams.",
    );
  });

  test("User Settings tells the start route it is the person's own settings", async () => {
    await renderTeams(ConnectStartPage.UserSettings);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Grant Admin Consent" }),
      );
    });

    expect(requestedUrl("/microsoft-teams/admin-consent")).toContain(
      "from=user-settings",
    );
  });

  test("Project Settings tells the start route it is the project's settings", async () => {
    await renderTeams();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Grant Admin Consent" }),
      );
    });

    expect(requestedUrl("/microsoft-teams/admin-consent")).toContain(
      "from=project-settings",
    );
  });
});

describe("Code Repositories page (?error=)", () => {
  test("an installation that could not be verified says so, without GitHub's words", async () => {
    query["error"] = "github-not-verified";

    await renderCodeRepositories();

    expect(notice()).toHaveTextContent("GitHub was not connected");
    expect(notice()).toHaveTextContent(
      "OneUptime could not confirm that your GitHub account can manage this installation. Please install the app with a GitHub account that can.",
    );
    expect(setQueryStringMock).toHaveBeenCalledWith({ error: null });
    // The page itself is there, Connect button and all.
    expect(
      screen.getByRole("button", { name: "Connect with GitHub App" }),
    ).toBeInTheDocument();
  });

  test("a plan refusal names the plan, as the locked card does", async () => {
    query["error"] = "plan-required";

    await renderCodeRepositories();

    expect(notice()).toHaveTextContent(
      "Connecting GitHub needs the Growth plan.",
    );
  });

  test("no permission is the start's own refusal", async () => {
    query["error"] = "no-permission";

    await renderCodeRepositories();

    expect(notice()).toHaveTextContent(
      "You do not have permission to add code repositories to this project.",
    );
  });

  test.each(UNKNOWN_ERRORS)(
    "unknown text in ?error= is never shown: %s",
    async (unknown: string) => {
      query["error"] = unknown;

      await renderCodeRepositories();

      expect(notice()).toHaveTextContent(COULD_NOT_FINISH);
      expect(document.body.textContent).not.toContain(unknown);
    },
  );
});

describe("the connect-return page", () => {
  function project(): Project {
    const value: Project = new Project();
    value._id = PROJECT_ID;
    return value;
  }

  async function renderConnectReturn(data: {
    currentProject: Project | null;
    projects: Array<Project>;
    isLoading: boolean;
  }): Promise<void> {
    await act(async () => {
      render(
        <ConnectReturn
          pageRoute={new Route("/dashboard/connect-return")}
          currentProject={data.currentProject}
          hasPaymentMethod={true}
          projects={data.projects}
          isLoading={data.isLoading}
        />,
      );
    });
  }

  function navigatedTo(): Array<{ path: string; options: unknown }> {
    return navigateMock.mock.calls.map((call: Array<unknown>) => {
      return {
        path: (call[0] as Route).toString(),
        options: call[1],
      };
    });
  }

  test("passes a refused connection on to the provider's page in the open project, in place of itself", async () => {
    query["provider"] = "slack";
    query["error"] = "link-invalid";

    await renderConnectReturn({
      currentProject: project(),
      projects: [project()],
      isLoading: false,
    });

    expect(navigatedTo()).toEqual([
      {
        path: `/dashboard/${PROJECT_ID}/settings/slack-integration?error=link-invalid`,
        options: { replace: true },
      },
    ]);
  });

  test("GitHub's own redirect goes to Code Repositories with nothing to say", async () => {
    query["provider"] = "github";

    await renderConnectReturn({
      currentProject: project(),
      projects: [project()],
      isLoading: false,
    });

    expect(navigatedTo()).toEqual([
      {
        path: `/dashboard/${PROJECT_ID}/code-repository`,
        options: { replace: true },
      },
    ]);
  });

  test("unknown text in ?error= is passed on as could-not-finish, never as itself", async () => {
    query["provider"] = "microsoft-teams";
    query["error"] = UNKNOWN_ERRORS[1]!;

    await renderConnectReturn({
      currentProject: project(),
      projects: [project()],
      isLoading: false,
    });

    expect(navigatedTo()).toEqual([
      {
        path: `/dashboard/${PROJECT_ID}/settings/microsoft-teams-integration?error=could-not-finish`,
        options: { replace: true },
      },
    ]);
  });

  test("waits for a project to be selected", async () => {
    query["provider"] = "slack";
    query["error"] = "link-invalid";

    await renderConnectReturn({
      currentProject: null,
      projects: [],
      isLoading: true,
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("someone with no project is sent to create one", async () => {
    query["provider"] = "slack";

    await renderConnectReturn({
      currentProject: null,
      projects: [],
      isLoading: false,
    });

    expect(navigatedTo()).toEqual([
      { path: "/dashboard/welcome", options: { replace: true } },
    ]);
  });
});
