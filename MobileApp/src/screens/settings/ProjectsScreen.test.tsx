import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { MockedFunction } from "jest-mock";
import ProjectsScreen from "./ProjectsScreen";
import { clearAllSsoDenials, markProjectSsoDenied } from "../../sso/ssoDenials";
import { makeListResponse, makeProject } from "../../__tests__/testSupport";
import type { ListResponse, ProjectItem } from "../../api/types";
import type {
  GlobalSSOProvider,
  SSOProvider,
  SsoDiscoveryResult,
} from "../../api/sso";
import type { SsoAuthSessionOutcome } from "../../sso/authSession";
import type { CompleteSsoLoginOutcome } from "../../sso/session";

/*
 * Settings -> Projects is where a responder finds out WHY a project they
 * belong to keeps answering 406, and it is the only place in the app that can
 * do anything about it.
 *
 * The affordance is the whole screen. A project that enforces SSO and has no
 * live token needs the "Authenticate with SSO" button; a project that is
 * satisfied must not have it, because a button offered next to a project that
 * is already working sends people round an identity provider for nothing. Both
 * halves of that decision have been wrong in the past and neither is visible
 * from anywhere else:
 *
 *   - a stored token is only EVIDENCE. The server has the last word, and once
 *     it has actually refused a project on SSO grounds - lapsed token, disabled
 *     provider, a provider restricted to other projects - the badge must go
 *     back to "SSO Required" and the button must come back, no matter what is
 *     in storage. The alternative is a green "Authenticated" badge over a
 *     project that fails every request.
 *   - an instance-wide Global SSO token satisfies EVERY project, including
 *     ones with no token of their own.
 *
 * The second thing the screen owns is the hand-off. With one provider it opens
 * the identity provider directly; with more than one it must pass the project,
 * its name and every provider's KIND along to the picker, because the kind is
 * what decides which of the four server routers the login goes to and nothing
 * downstream can recover it.
 *
 * `buildSsoLoginUrl` and the denial register are deliberately NOT mocked - the
 * routing and the "server has the last word" rule are the behaviour under test,
 * so they run for real. The network, the auth browser, the session writer and
 * storage are stood in for, since none of them can run off a device.
 */

type FetchProjects = () => Promise<ListResponse<ProjectItem>>;
type FetchSSOProvidersForProject = (
  projectId: string,
) => Promise<Array<SSOProvider>>;
type FetchAllGlobalProviders = () => Promise<
  SsoDiscoveryResult<GlobalSSOProvider>
>;
type GetSsoTokens = () => Promise<Record<string, string>>;
type GetGlobalSsoToken = () => Promise<string | null>;
type GetServerUrl = () => Promise<string>;
type OpenSsoAuthSession = (url: string) => Promise<SsoAuthSessionOutcome>;
type CompleteSsoLoginFromUrl = (
  url: string,
) => Promise<CompleteSsoLoginOutcome>;
type Navigate = (route: string, params: unknown) => void;
type AddListener = (event: string, callback: () => void) => () => void;

const mockFetchProjects: MockedFunction<FetchProjects> =
  jest.fn<FetchProjects>();
const mockFetchSSOProvidersForProject: MockedFunction<FetchSSOProvidersForProject> =
  jest.fn<FetchSSOProvidersForProject>();
const mockFetchAllGlobalProviders: MockedFunction<FetchAllGlobalProviders> =
  jest.fn<FetchAllGlobalProviders>();
const mockGetSsoTokens: MockedFunction<GetSsoTokens> = jest.fn<GetSsoTokens>();
const mockGetGlobalSsoToken: MockedFunction<GetGlobalSsoToken> =
  jest.fn<GetGlobalSsoToken>();
const mockGetServerUrl: MockedFunction<GetServerUrl> = jest.fn<GetServerUrl>();
const mockOpenSsoAuthSession: MockedFunction<OpenSsoAuthSession> =
  jest.fn<OpenSsoAuthSession>();
const mockCompleteSsoLoginFromUrl: MockedFunction<CompleteSsoLoginFromUrl> =
  jest.fn<CompleteSsoLoginFromUrl>();
const mockNavigate: MockedFunction<Navigate> = jest.fn<Navigate>();
const mockAddListener: MockedFunction<AddListener> = jest.fn<AddListener>();
const mockRemoveFocusListener: MockedFunction<() => void> =
  jest.fn<() => void>();

jest.mock("../../api/projects", () => {
  return {
    fetchProjects: () => {
      return mockFetchProjects();
    },
  };
});

jest.mock("../../api/sso", () => {
  return {
    fetchSSOProvidersForProject: (projectId: string) => {
      return mockFetchSSOProvidersForProject(projectId);
    },
    fetchAllGlobalProviders: () => {
      return mockFetchAllGlobalProviders();
    },
  };
});

jest.mock("../../storage/ssoTokens", () => {
  return {
    getSsoTokens: () => {
      return mockGetSsoTokens();
    },
    getGlobalSsoToken: () => {
      return mockGetGlobalSsoToken();
    },
  };
});

jest.mock("../../storage/serverUrl", () => {
  return {
    getServerUrl: () => {
      return mockGetServerUrl();
    },
  };
});

jest.mock("../../sso/authSession", () => {
  return {
    openSsoAuthSession: (url: string) => {
      return mockOpenSsoAuthSession(url);
    },
  };
});

jest.mock("../../sso/session", () => {
  return {
    completeSsoLoginFromUrl: (url: string) => {
      return mockCompleteSsoLoginFromUrl(url);
    },
  };
});

/* A self-hosted instance, so a hard-coded oneuptime.com would fail these. */
const SERVER_URL: string = "https://oneuptime.everythingcorp.example";

/* What the identity provider redirects back to once the login is finished. */
const CALLBACK_URL: string =
  "oneuptime://sso-callback?access-token=at&refresh-token=rt&sso-token=st";

const OPEN_PROJECT: ProjectItem = makeProject({
  _id: "0123456789abcdef0123aaa1",
  name: "Acme Production",
  slug: "acme-production",
});

const SSO_PROJECT: ProjectItem = makeProject({
  _id: "0123456789abcdef0123bbb1",
  name: "Everything Corp Production",
  slug: "everything-corp-production",
  requireSsoForLogin: true,
});

const SECOND_SSO_PROJECT: ProjectItem = makeProject({
  _id: "0123456789abcdef0123bbb2",
  name: "Everything Corp Staging",
  slug: "everything-corp-staging",
  requireSsoForLogin: true,
});

const GLOBAL_PROVIDER: GlobalSSOProvider = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaa1",
  name: "Okta for Everything Corp",
  description: "Company-wide single sign-on",
  type: "global-sso",
};

const PROJECT_PROVIDER: SSOProvider = {
  _id: "bbbbbbbbbbbbbbbbbbbbbbb1",
  name: "Production SAML",
  description: "Configured in this project's settings",
  projectId: SSO_PROJECT._id,
  kind: "project",
};

/* The label the button carries for a screen reader, and the handle for a test. */
function ssoButtonLabel(project: ProjectItem): string {
  return `Authenticate with SSO for ${project.name}`;
}

function querySsoButton(
  project: ProjectItem,
): ReturnType<typeof screen.queryByLabelText> {
  return screen.queryByLabelText(ssoButtonLabel(project));
}

type ScreenProps = React.ComponentProps<typeof ProjectsScreen>;

/*
 * The focus listeners the screen registered. The screen re-reads the stored
 * SSO tokens whenever it is focused, which is how it notices the token the
 * provider-select sheet just wrote on its way back.
 */
let focusListeners: Array<() => void> = [];

function screenProps(): ScreenProps {
  /*
   * React Navigation hands a screen far more than it reads; the cast keeps the
   * fixture to the two things this one actually uses.
   */
  return {
    navigation: {
      navigate: mockNavigate,
      addListener: mockAddListener,
    },
    route: {
      key: "ProjectsList-test",
      name: "ProjectsList",
      params: undefined,
    },
  } as unknown as ScreenProps;
}

async function renderProjectsScreen(): Promise<void> {
  await render(<ProjectsScreen {...screenProps()} />);
}

/** Renders and waits for the first load to finish. */
async function renderLoadedProjectsScreen(): Promise<void> {
  await renderProjectsScreen();

  await waitFor(() => {
    expect(screen.getByText("Your Projects")).toBeTruthy();
  });
}

/*
 * `fireEvent` resolves with the pressed handler's own promise, so awaiting it
 * runs the whole SSO flow. The "browser still open" tests below must not await
 * it, for that exact reason.
 */
async function pressAuthenticate(project: ProjectItem): Promise<void> {
  await fireEvent.press(screen.getByLabelText(ssoButtonLabel(project)));
}

/* Picks up whatever React queued on the way out of the handler. */
async function settleSso(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

/** Drives the screen's "focus" listener, the way returning to it would. */
async function returnToScreen(): Promise<void> {
  await act(async (): Promise<void> => {
    for (const listener of focusListeners) {
      listener();
    }

    await Promise.resolve();
  });
}

function lastOpenedUrl(): string {
  const calls: Array<[string]> = mockOpenSsoAuthSession.mock.calls;

  return calls[calls.length - 1]![0];
}

beforeEach(() => {
  /*
   * `clearMocks` in jest.config.js clears CALLS but not IMPLEMENTATIONS, so a
   * rejection, or a deliberately hanging request, would otherwise leak from
   * one test into the next.
   */
  mockFetchProjects.mockReset();
  mockFetchSSOProvidersForProject.mockReset();
  mockFetchAllGlobalProviders.mockReset();
  mockGetSsoTokens.mockReset();
  mockGetGlobalSsoToken.mockReset();
  mockGetServerUrl.mockReset();
  mockOpenSsoAuthSession.mockReset();
  mockCompleteSsoLoginFromUrl.mockReset();
  mockNavigate.mockReset();
  mockAddListener.mockReset();

  mockFetchProjects.mockResolvedValue(makeListResponse<ProjectItem>([]));
  mockFetchSSOProvidersForProject.mockResolvedValue([]);
  mockFetchAllGlobalProviders.mockResolvedValue({
    providers: [],
    failed: false,
  });
  mockGetSsoTokens.mockResolvedValue({});
  mockGetGlobalSsoToken.mockResolvedValue(null);
  mockGetServerUrl.mockResolvedValue(SERVER_URL);
  mockOpenSsoAuthSession.mockResolvedValue({
    status: "callback",
    url: CALLBACK_URL,
  });
  mockCompleteSsoLoginFromUrl.mockResolvedValue({
    status: "success",
    isGlobal: false,
    projectId: SSO_PROJECT._id,
  });

  focusListeners = [];
  mockAddListener.mockImplementation(
    (event: string, callback: () => void): (() => void) => {
      if (event === "focus") {
        focusListeners.push(callback);
      }

      return mockRemoveFocusListener;
    },
  );

  /*
   * The denial register is a real in-memory module shared by every test in
   * this file, so a denial recorded by one would still be there for the next.
   */
  clearAllSsoDenials();
});

describe("While the projects are still being fetched", () => {
  let releaseProjects: (
    response: ListResponse<ProjectItem>,
  ) => void = (): void => {
    return undefined;
  };

  beforeEach(() => {
    mockFetchProjects.mockImplementation(
      (): Promise<ListResponse<ProjectItem>> => {
        return new Promise<ListResponse<ProjectItem>>(
          (resolve: (response: ListResponse<ProjectItem>) => void): void => {
            releaseProjects = resolve;
          },
        );
      },
    );
  });

  test("no claim is made about the account before the list has arrived", async () => {
    /*
     * The empty-state card says "No projects found." That is a statement about
     * the account, and making it while the request is still in flight tells a
     * responder they have been removed from every project they work on.
     */
    await renderProjectsScreen();

    expect(screen.queryByText("No projects found.")).toBeNull();
    expect(screen.queryByText("Your Projects")).toBeNull();

    releaseProjects(makeListResponse<ProjectItem>([OPEN_PROJECT]));

    await waitFor(() => {
      expect(screen.getByText(OPEN_PROJECT.name)).toBeTruthy();
    });
  });

  test("the list replaces the wait once it arrives", async () => {
    await renderProjectsScreen();

    releaseProjects(makeListResponse<ProjectItem>([OPEN_PROJECT, SSO_PROJECT]));

    await waitFor(() => {
      expect(screen.getByText("Your Projects")).toBeTruthy();
    });

    expect(screen.getByText(OPEN_PROJECT.name)).toBeTruthy();
    expect(screen.getByText(SSO_PROJECT.name)).toBeTruthy();
    expect(screen.queryByText("No projects found.")).toBeNull();
  });
});

describe("The list of projects", () => {
  test("every project the responder belongs to is named", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([
        OPEN_PROJECT,
        SSO_PROJECT,
        SECOND_SSO_PROJECT,
      ]),
    );

    await renderLoadedProjectsScreen();

    expect(screen.getByText(OPEN_PROJECT.name)).toBeTruthy();
    expect(screen.getByText(SSO_PROJECT.name)).toBeTruthy();
    expect(screen.getByText(SECOND_SSO_PROJECT.name)).toBeTruthy();
  });

  test("an account with no projects is told so plainly", async () => {
    await renderLoadedProjectsScreen();

    expect(screen.getByText("No projects found.")).toBeTruthy();
  });

  test("the screen explains why some projects need a second sign-in", async () => {
    /*
     * Without this line the button reads as an optional extra rather than the
     * thing standing between the responder and the project's alerts.
     */
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );

    await renderLoadedProjectsScreen();

    expect(
      screen.getByText(/Projects requiring SSO need separate authentication/i),
    ).toBeTruthy();
  });
});

describe("When the projects could not be fetched", () => {
  beforeEach(() => {
    mockFetchProjects.mockRejectedValue(new Error("network is down"));
  });

  test("the failure is stated rather than left as a blank screen", async () => {
    await renderLoadedProjectsScreen();

    expect(screen.getByText("Failed to load projects.")).toBeTruthy();
  });

  test("no project row is invented for a request that never landed", async () => {
    await renderLoadedProjectsScreen();

    expect(screen.queryByText(SSO_PROJECT.name)).toBeNull();
    expect(querySsoButton(SSO_PROJECT)).toBeNull();
  });

  test("a failure while reading the stored tokens is reported too", async () => {
    /*
     * The three reads are one `Promise.all`, so a storage fault is as fatal to
     * the load as a network one - and it must not be reported as an empty
     * account either.
     */
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
    mockGetSsoTokens.mockRejectedValue(new Error("storage is unreadable"));

    await renderLoadedProjectsScreen();

    expect(screen.getByText("Failed to load projects.")).toBeTruthy();
  });
});

describe("The SSO affordance is offered only where it is needed", () => {
  test("a project that does not enforce SSO gets no button and no badge", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([OPEN_PROJECT]),
    );

    await renderLoadedProjectsScreen();

    expect(screen.getByText(OPEN_PROJECT.name)).toBeTruthy();
    expect(querySsoButton(OPEN_PROJECT)).toBeNull();
    expect(screen.queryByText("SSO Required")).toBeNull();
    expect(screen.queryByText("Authenticated")).toBeNull();
  });

  test("a project that enforces SSO with no token is offered the button", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );

    await renderLoadedProjectsScreen();

    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
    expect(screen.getByText("SSO Required")).toBeTruthy();
  });

  test("a project with a token of its own is badged authenticated instead", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
    mockGetSsoTokens.mockResolvedValue({ [SSO_PROJECT._id]: "project-token" });

    await renderLoadedProjectsScreen();

    expect(screen.getByText("Authenticated")).toBeTruthy();
    expect(querySsoButton(SSO_PROJECT)).toBeNull();
  });

  test("an instance-wide token satisfies a project that has none of its own", async () => {
    /*
     * A Global SSO/OIDC token is not bound to a project, so one login covers
     * every project the user belongs to - including ones created afterwards.
     * Demanding a per-project login anyway is a dead end on an instance whose
     * identity provider is global.
     */
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
    mockGetGlobalSsoToken.mockResolvedValue("global-token");

    await renderLoadedProjectsScreen();

    expect(screen.getByText("Authenticated")).toBeTruthy();
    expect(querySsoButton(SSO_PROJECT)).toBeNull();
  });

  test("a project the server has refused is offered the button despite a stored token", async () => {
    /*
     * THE rule. A token in storage is evidence, not proof: it can be expired,
     * its provider can have been disabled, or the provider can be restricted
     * to other projects. Once the server has actually refused this project,
     * the badge must stop claiming otherwise - a green "Authenticated" over a
     * project that 406s on every request is worse than no badge, because it
     * tells the responder the problem is somewhere else.
     */
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
    mockGetGlobalSsoToken.mockResolvedValue("global-token");
    mockGetSsoTokens.mockResolvedValue({ [SSO_PROJECT._id]: "project-token" });
    markProjectSsoDenied(SSO_PROJECT._id);

    await renderLoadedProjectsScreen();

    expect(screen.getByText("SSO Required")).toBeTruthy();
    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
    expect(screen.queryByText("Authenticated")).toBeNull();
  });

  test("a refusal that arrives while the screen is open turns the badge back into a button", async () => {
    /*
     * The denial register is written by the API client as requests fail, which
     * on this screen happens while the responder is looking at it. Without the
     * subscription the badge would stay green until the screen was left and
     * re-entered.
     */
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
    mockGetGlobalSsoToken.mockResolvedValue("global-token");

    await renderLoadedProjectsScreen();

    expect(screen.getByText("Authenticated")).toBeTruthy();

    await act(async (): Promise<void> => {
      markProjectSsoDenied(SSO_PROJECT._id);
      await Promise.resolve();
    });

    expect(screen.getByText("SSO Required")).toBeTruthy();
    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
  });

  test("a refusal of one project does not take the others down with it", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT, SECOND_SSO_PROJECT]),
    );
    mockGetGlobalSsoToken.mockResolvedValue("global-token");
    markProjectSsoDenied(SSO_PROJECT._id);

    await renderLoadedProjectsScreen();

    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
    expect(querySsoButton(SECOND_SSO_PROJECT)).toBeNull();
  });

  test("in a mixed list only the project that enforces SSO gets a button", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([OPEN_PROJECT, SSO_PROJECT]),
    );

    await renderLoadedProjectsScreen();

    expect(querySsoButton(OPEN_PROJECT)).toBeNull();
    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
  });
});

describe("Starting an SSO login", () => {
  beforeEach(() => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
  });

  test("a single provider is opened directly rather than shown as a list of one", async () => {
    /*
     * A picker containing one row is ceremony, and ceremony between a
     * responder and the project holding their incident is what gets abandoned.
     */
    mockFetchSSOProvidersForProject.mockResolvedValue([PROJECT_PROVIDER]);

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(lastOpenedUrl()).toBe(
      `${SERVER_URL}/identity/sso/${SSO_PROJECT._id}/${PROJECT_PROVIDER._id}?mobile=true`,
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("the login is opened against the stored server url", async () => {
    /* Self-hosted instances are the norm; there is no fixed host to assume. */
    mockGetServerUrl.mockResolvedValue("https://status.internal.example");
    mockFetchSSOProvidersForProject.mockResolvedValue([PROJECT_PROVIDER]);

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(lastOpenedUrl()).toBe(
      `https://status.internal.example/identity/sso/${SSO_PROJECT._id}/${PROJECT_PROVIDER._id}?mobile=true`,
    );
  });

  test("a single global provider is opened without a project id in the url", async () => {
    /*
     * `/identity/global-sso/...` takes no project. Appending one is rejected
     * by the server, and the responder never reaches the identity provider at
     * all.
     */
    mockFetchAllGlobalProviders.mockResolvedValue({
      providers: [GLOBAL_PROVIDER],
      failed: false,
    });

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(lastOpenedUrl()).toBe(
      `${SERVER_URL}/identity/global-sso/${GLOBAL_PROVIDER._id}?mobile=true`,
    );
    expect(lastOpenedUrl()).not.toContain(SSO_PROJECT._id);
  });

  test("two providers hand off to the picker with the project, its name and both kinds", async () => {
    /*
     * `kind` is the load-bearing field. Nothing downstream can work out
     * whether a provider belongs to the project's SAML router, the project's
     * OIDC router or one of the two instance-wide ones - only the endpoint
     * that answered knew, and this is where that knowledge is passed on.
     */
    mockFetchSSOProvidersForProject.mockResolvedValue([PROJECT_PROVIDER]);
    mockFetchAllGlobalProviders.mockResolvedValue({
      providers: [GLOBAL_PROVIDER],
      failed: false,
    });

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(mockNavigate).toHaveBeenCalledWith("SSOProviderSelect", {
      projectId: SSO_PROJECT._id,
      projectName: SSO_PROJECT.name,
      providers: [
        {
          _id: GLOBAL_PROVIDER._id,
          name: GLOBAL_PROVIDER.name,
          description: GLOBAL_PROVIDER.description,
          kind: "global-sso",
        },
        {
          _id: PROJECT_PROVIDER._id,
          name: PROJECT_PROVIDER.name,
          description: PROJECT_PROVIDER.description,
          kind: "project",
        },
      ],
    });
  });

  test("handing off to the picker does not also open a browser", async () => {
    mockFetchSSOProvidersForProject.mockResolvedValue([PROJECT_PROVIDER]);
    mockFetchAllGlobalProviders.mockResolvedValue({
      providers: [GLOBAL_PROVIDER],
      failed: false,
    });

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(mockOpenSsoAuthSession).not.toHaveBeenCalled();
  });

  test("discovery is asked about the project that was tapped", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT, SECOND_SSO_PROJECT]),
    );
    mockFetchSSOProvidersForProject.mockResolvedValue([PROJECT_PROVIDER]);

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SECOND_SSO_PROJECT);
    await settleSso();

    expect(mockFetchSSOProvidersForProject).toHaveBeenCalledWith(
      SECOND_SSO_PROJECT._id,
    );
  });

  test("project discovery failing still leaves the global providers usable", async () => {
    /*
     * The project endpoint answers an ordinary "this project has no SSO
     * config" with a 4xx, so a rejection here is not evidence of an outage -
     * and on an instance whose identity provider is global it is the expected
     * answer. Letting it end the flow would strand exactly those users.
     */
    mockFetchSSOProvidersForProject.mockRejectedValue(
      new Error("No SSO config found for this user"),
    );
    mockFetchAllGlobalProviders.mockResolvedValue({
      providers: [GLOBAL_PROVIDER],
      failed: false,
    });

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(lastOpenedUrl()).toBe(
      `${SERVER_URL}/identity/global-sso/${GLOBAL_PROVIDER._id}?mobile=true`,
    );
    expect(screen.queryByText(/SSO authentication failed/i)).toBeNull();
  });

  test("a project with no providers at all is sent to its admin, not to a browser", async () => {
    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(
      screen.getByText(
        "No SSO providers are configured or enabled for this project. Please contact your admin.",
      ),
    ).toBeTruthy();
    expect(mockOpenSsoAuthSession).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test("discovery failing outright is reported rather than swallowed", async () => {
    mockFetchAllGlobalProviders.mockRejectedValue(new Error("network is down"));

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(
      screen.getByText("SSO authentication failed. Please try again."),
    ).toBeTruthy();
    expect(mockOpenSsoAuthSession).not.toHaveBeenCalled();
  });

  test("the button comes back after a failed attempt, so it can be retried", async () => {
    mockFetchAllGlobalProviders.mockRejectedValue(new Error("network is down"));

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(screen.getByText("Authenticate with SSO")).toBeTruthy();
  });
});

describe("While one browser session is open", () => {
  let releaseSession: (outcome: SsoAuthSessionOutcome) => void = (): void => {
    return undefined;
  };

  beforeEach(() => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT, SECOND_SSO_PROJECT]),
    );
    mockFetchSSOProvidersForProject.mockResolvedValue([PROJECT_PROVIDER]);
    mockOpenSsoAuthSession.mockImplementation(
      (): Promise<SsoAuthSessionOutcome> => {
        return new Promise<SsoAuthSessionOutcome>(
          (resolve: (outcome: SsoAuthSessionOutcome) => void): void => {
            releaseSession = resolve;
          },
        );
      },
    );
  });

  /*
   * Not awaited: the browser has not closed, and `fireEvent` resolves with the
   * handler's own promise. The `act` inside fireEvent is subscribed as soon as
   * the press is fired, so yielding a macrotask here - outside any act of our
   * own - is what makes the busy window observable.
   */
  async function pressAuthenticateWithoutWaiting(
    project: ProjectItem,
  ): Promise<void> {
    fireEvent.press(screen.getByLabelText(ssoButtonLabel(project)));

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }

  async function finishSession(): Promise<void> {
    releaseSession({ status: "cancelled" });

    await waitFor(() => {
      expect(screen.getAllByText("Authenticate with SSO")).toHaveLength(2);
    });
  }

  test("the row that is authenticating shows itself busy", async () => {
    await renderLoadedProjectsScreen();

    await pressAuthenticateWithoutWaiting(SSO_PROJECT);

    /* Only the other row still has a label; this one has a spinner. */
    expect(screen.getAllByText("Authenticate with SSO")).toHaveLength(1);

    await finishSession();
  });

  test("no other project can start a second browser session", async () => {
    /*
     * expo-web-browser allows a single auth session at a time and throws
     * "WebBrowser is already open" on a second one - which is why EVERY row is
     * disabled while any row is authenticating, not just the busy one.
     */
    await renderLoadedProjectsScreen();

    await pressAuthenticateWithoutWaiting(SSO_PROJECT);
    await pressAuthenticateWithoutWaiting(SECOND_SSO_PROJECT);

    expect(mockOpenSsoAuthSession).toHaveBeenCalledTimes(1);
    expect(lastOpenedUrl()).toContain(SSO_PROJECT._id);

    await finishSession();
  });

  test("the rows are usable again once the browser closes", async () => {
    await renderLoadedProjectsScreen();

    await pressAuthenticateWithoutWaiting(SSO_PROJECT);
    await finishSession();

    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
    expect(querySsoButton(SECOND_SSO_PROJECT)).toBeTruthy();
  });
});

describe("Coming back from the identity provider", () => {
  beforeEach(() => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
    mockFetchSSOProvidersForProject.mockResolvedValue([PROJECT_PROVIDER]);
  });

  test("the callback url is what gets persisted, not the login url", async () => {
    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledWith(CALLBACK_URL);
  });

  test("a completed login turns the project authenticated without leaving the screen", async () => {
    /*
     * The badge is read straight back out of storage rather than assumed, so
     * this also covers the re-read that follows a successful login.
     */
    mockGetSsoTokens
      .mockResolvedValueOnce({})
      .mockResolvedValue({ [SSO_PROJECT._id]: "fresh-project-token" });

    await renderLoadedProjectsScreen();

    expect(screen.getByText("SSO Required")).toBeTruthy();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    await waitFor(() => {
      expect(screen.getByText("Authenticated")).toBeTruthy();
    });

    expect(querySsoButton(SSO_PROJECT)).toBeNull();
  });

  test("a cancelled login says nothing and leaves the button where it was", async () => {
    /*
     * Backing out of an identity provider is a decision, not a fault. An error
     * banner for it would train responders to ignore the banner.
     */
    mockOpenSsoAuthSession.mockResolvedValue({ status: "cancelled" });

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(screen.queryByText(/failed|could not|error/i)).toBeNull();
    expect(mockCompleteSsoLoginFromUrl).not.toHaveBeenCalled();
    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
  });

  test("a browser that would not open reports its own message", async () => {
    mockOpenSsoAuthSession.mockResolvedValue({
      status: "error",
      message: "Could not open the sign-in browser.",
    });

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(
      screen.getByText("Could not open the sign-in browser."),
    ).toBeTruthy();
    expect(mockCompleteSsoLoginFromUrl).not.toHaveBeenCalled();
  });

  test("a callback that could not be turned into a session reports why", async () => {
    /*
     * The identity provider can redirect back carrying an error rather than
     * tokens. Reporting it here is the only place the responder finds out;
     * silence would look exactly like a login that worked.
     */
    mockCompleteSsoLoginFromUrl.mockResolvedValue({
      status: "error",
      message: "The sign-in response was missing its tokens.",
    });

    await renderLoadedProjectsScreen();

    await pressAuthenticate(SSO_PROJECT);
    await settleSso();

    expect(
      screen.getByText("The sign-in response was missing its tokens."),
    ).toBeTruthy();
    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
  });
});

describe("Returning to the screen", () => {
  test("a focus listener is registered so the screen can be told", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );

    await renderLoadedProjectsScreen();

    expect(mockAddListener).toHaveBeenCalledWith("focus", expect.any(Function));
  });

  test("the stored tokens are re-read, so a login finished elsewhere shows up", async () => {
    /*
     * The provider-select sheet completes the login and pops back to here. The
     * token it wrote is only visible to this screen if the screen goes and
     * looks again - otherwise the responder returns to the same "SSO Required"
     * badge they just spent a browser round trip getting rid of.
     */
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
    mockGetSsoTokens.mockResolvedValue({});

    await renderLoadedProjectsScreen();

    expect(screen.getByText("SSO Required")).toBeTruthy();

    mockGetSsoTokens.mockResolvedValue({
      [SSO_PROJECT._id]: "token-written-by-the-picker",
    });

    await returnToScreen();

    await waitFor(() => {
      expect(screen.getByText("Authenticated")).toBeTruthy();
    });
  });

  test("a token that has since lapsed turns the badge back into a button", async () => {
    /*
     * The stored-token reads drop anything expired, so this re-read doubles as
     * the eviction pass. A project whose token lapsed while the app was open
     * has to stop claiming to be authenticated, or every request it makes
     * fails with nothing on screen to explain it.
     */
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );
    mockGetSsoTokens.mockResolvedValue({
      [SSO_PROJECT._id]: "token-about-to-expire",
    });

    await renderLoadedProjectsScreen();

    expect(screen.getByText("Authenticated")).toBeTruthy();

    mockGetSsoTokens.mockResolvedValue({});

    await returnToScreen();

    await waitFor(() => {
      expect(screen.getByText("SSO Required")).toBeTruthy();
    });

    expect(querySsoButton(SSO_PROJECT)).toBeTruthy();
  });

  test("the project list itself is not re-fetched on every focus", async () => {
    /*
     * Focus fires on every return to this tab. Re-loading the whole list would
     * blank it behind a spinner each time; only the SSO state is cheap enough
     * to re-read.
     */
    mockFetchProjects.mockResolvedValue(
      makeListResponse<ProjectItem>([SSO_PROJECT]),
    );

    await renderLoadedProjectsScreen();

    expect(mockFetchProjects).toHaveBeenCalledTimes(1);

    await returnToScreen();

    expect(mockFetchProjects).toHaveBeenCalledTimes(1);
  });
});
