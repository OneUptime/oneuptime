import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import SSOProviderSelectScreen from "./SSOProviderSelectScreen";
import type { SsoProviderKind } from "../../sso/providerUrl";
import {
  openSsoAuthSession,
  type SsoAuthSessionOutcome,
} from "../../sso/authSession";
import {
  completeSsoLoginFromUrl,
  type CompleteSsoLoginOutcome,
} from "../../sso/session";
import { getServerUrl } from "../../storage/serverUrl";
import type { SelectableSsoProvider } from "../../navigation/types";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The re-authentication sheet an already signed-in user reaches from
 * Settings -> Projects when a project refuses their token until they complete
 * SSO.
 *
 * Until recently it could only ever start a PROJECT SSO login and only ever
 * looked for a project `ssoToken` on the way back. On an instance where SSO is
 * supplied by a GLOBAL provider configured on the admin dashboard that left the
 * user with no way out at all: the row either sent them to
 * `/identity/sso/<projectId>/<globalProviderId>`, which the server answers with
 * a 400 because that provider does not belong to the project, or - once the
 * routing was half-fixed - completed the login upstream and then dropped the
 * instance-wide token on the floor, returning them to the same locked project
 * with nothing shown and nothing stored.
 *
 * So the assertions here are about the two hand-offs the screen owns:
 *
 *   - the URL it opens has to encode the provider's KIND (which of the three
 *     server routers to use) and must not smuggle a project id into a global
 *     login, and
 *   - whatever the browser hands back has to reach completeSsoLoginFromUrl,
 *     for a global login exactly as for a project one, before the sheet closes.
 *
 * `buildSsoLoginUrl` is deliberately NOT mocked - the mapping from kind to
 * route is the regression, so it is exercised for real. The auth browser, the
 * session writer and the stored server URL are mocked, since none of them can
 * run off-device.
 */

jest.mock("../../sso/authSession", () => {
  return {
    openSsoAuthSession: jest.fn(),
  };
});

jest.mock("../../sso/session", () => {
  return {
    completeSsoLoginFromUrl: jest.fn(),
  };
});

jest.mock("../../storage/serverUrl", () => {
  return {
    getServerUrl: jest.fn(),
  };
});

const mockOpenSsoAuthSession: jest.Mock =
  openSsoAuthSession as unknown as jest.Mock;
const mockCompleteSsoLoginFromUrl: jest.Mock =
  completeSsoLoginFromUrl as unknown as jest.Mock;
const mockGetServerUrl: jest.Mock = getServerUrl as unknown as jest.Mock;

// A self-hosted instance, so a hard-coded oneuptime.com would fail these.
const SERVER_URL: string = "https://oneuptime.everythingcorp.example";
const PROJECT_ID: string = "0123456789abcdef01234567";
const PROJECT_NAME: string = "Everything Corp Production";

/*
 * What the IdP redirects back to. Only its identity matters here: the screen
 * must forward THIS url - not the login url it opened - to the session module.
 */
const CALLBACK_URL: string =
  "oneuptime://sso-callback?access-token=at&refresh-token=rt&global-sso-token=gt";

const globalSamlProvider: SelectableSsoProvider = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaa1",
  name: "Okta for Everything Corp",
  description: "Company-wide single sign-on",
  kind: "global-sso",
};

const globalOidcProvider: SelectableSsoProvider = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaa2",
  name: "Microsoft Entra ID",
  kind: "global-oidc",
};

const projectSamlProvider: SelectableSsoProvider = {
  _id: "bbbbbbbbbbbbbbbbbbbbbbb1",
  name: "Production SAML",
  description: "Configured in this project's settings",
  kind: "project",
};

/*
 * The fourth kind, and the last one the app learned to discover. It is the
 * only one that is BOTH project-scoped and OIDC, so it is the one a routing
 * shortcut gets wrong: treated as project SAML it goes to `/identity/sso/...`,
 * treated as OIDC-therefore-global it loses the project id, and both land on a
 * router that has never heard of the id.
 */
const projectOidcProvider: SelectableSsoProvider = {
  _id: "bbbbbbbbbbbbbbbbbbbbbbb2",
  name: "Production Keycloak",
  description: "OIDC configured in this project's settings",
  kind: "project-oidc",
};

/*
 * Every message this screen is capable of showing contains one of these words.
 * Used to assert the ABSENCE of an error, which a `queryByText` of one specific
 * string would not really establish.
 */
const ANY_ERROR_MESSAGE: RegExp = /failed|could not|error|denied|invalid/i;

type ScreenProps = React.ComponentProps<typeof SSOProviderSelectScreen>;

interface RenderedScreen {
  goBack: jest.Mock;
}

async function renderScreen(
  providers: Array<SelectableSsoProvider>,
  projectId: string = PROJECT_ID,
): Promise<RenderedScreen> {
  const goBack: jest.Mock = jest.fn();

  /*
   * React Navigation hands the screen far more than it reads; the cast keeps
   * the fixture to the three params this screen actually uses.
   */
  const props: ScreenProps = {
    route: {
      key: "SSOProviderSelect-test",
      name: "SSOProviderSelect",
      params: {
        projectId,
        projectName: PROJECT_NAME,
        providers,
      },
    },
    navigation: { goBack },
  } as unknown as ScreenProps;

  await render(<SSOProviderSelectScreen {...props} />);

  return { goBack };
}

// Rows expose the provider name as their accessibility label.
async function pressProvider(name: string): Promise<void> {
  await fireEvent.press(screen.getByLabelText(name));
}

/*
 * A macrotask boundary, which drains every microtask queued behind it - and
 * everything this screen awaits is mocked, so one boundary finishes the whole
 * handler.
 */
async function nextMacrotask(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/**
 * Runs the pressed row's async handler to completion, with the state updates
 * it makes on the way out wrapped in `act` so React applies them to the tree.
 */
async function settleAuthFlow(): Promise<void> {
  await act(async (): Promise<void> => {
    await nextMacrotask();
  });
}

function openedUrls(): Array<string> {
  return mockOpenSsoAuthSession.mock.calls.map(
    (call: Array<unknown>): string => {
      return call[0] as string;
    },
  );
}

function lastOpenedUrl(): string {
  const urls: Array<string> = openedUrls();

  return urls[urls.length - 1] as string;
}

// The element type RNTL's queries hand back; it has no exported name.
type QueriedElement = ReturnType<typeof screen.getByText>;

/**
 * Queries scoped to the section a heading introduces.
 *
 * Each heading and the card of rows it labels are the two children of one
 * wrapper View, so the heading's parent IS the section. Scoping to it is what
 * turns "the row is on the screen somewhere" into "the row is on the side of
 * the global/project line it belongs on" - and grouping is the whole point of
 * the two headings, since picking a provider from the wrong group is a
 * rejection the server explains to nobody.
 */
function withinSection(heading: string): ReturnType<typeof within> {
  const headingNode: QueriedElement = screen.getByText(heading);
  const section: QueriedElement | null = headingNode.parent;

  if (!section) {
    throw new Error(`The "${heading}" heading is not inside a section.`);
  }

  return within(section);
}

function isRowDisabled(name: string): boolean {
  const row: { props: { accessibilityState?: { disabled?: boolean } } } =
    screen.getByLabelText(name) as unknown as {
      props: { accessibilityState?: { disabled?: boolean } };
    };

  return row.props.accessibilityState?.disabled === true;
}

const callbackOutcome: SsoAuthSessionOutcome = {
  status: "callback",
  url: CALLBACK_URL,
};

beforeEach(() => {
  /*
   * `clearMocks` in jest.config.js clears CALLS but not IMPLEMENTATIONS, so a
   * one-off `mockResolvedValue` or a deliberately hanging promise from an
   * earlier test would otherwise leak into this one.
   */
  mockGetServerUrl.mockReset();
  mockOpenSsoAuthSession.mockReset();
  mockCompleteSsoLoginFromUrl.mockReset();

  mockGetServerUrl.mockResolvedValue(SERVER_URL);
  mockOpenSsoAuthSession.mockResolvedValue(callbackOutcome);
  mockCompleteSsoLoginFromUrl.mockResolvedValue({
    status: "success",
    isGlobal: false,
    projectId: PROJECT_ID,
  } as CompleteSsoLoginOutcome);
});

describe("The row sends the user to the router that owns the provider", () => {
  test("a project provider starts a project SSO login", async () => {
    await renderScreen([projectSamlProvider]);

    await pressProvider(projectSamlProvider.name);
    await settleAuthFlow();

    expect(lastOpenedUrl()).toBe(
      `${SERVER_URL}/identity/sso/${PROJECT_ID}/${projectSamlProvider._id}?mobile=true`,
    );
  });

  test("a global SAML provider starts an instance-wide login, with no project id", async () => {
    /*
     * The project id is the regression. `/identity/global-sso/...` takes no
     * project, and the previous version of this screen appended one anyway -
     * which the server rejects, so the user never even reached the IdP.
     */
    await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(lastOpenedUrl()).toBe(
      `${SERVER_URL}/identity/global-sso/${globalSamlProvider._id}?mobile=true`,
    );
    expect(lastOpenedUrl()).not.toContain(PROJECT_ID);
  });

  test("a global OIDC provider goes to the OIDC router, not the SAML one", async () => {
    /*
     * Global SAML and global OIDC are served by two different routers and
     * discovery does not label which is which, so `kind` carried through the
     * navigation params is the only thing keeping them apart.
     */
    await renderScreen([globalOidcProvider]);

    await pressProvider(globalOidcProvider.name);
    await settleAuthFlow();

    expect(lastOpenedUrl()).toBe(
      `${SERVER_URL}/identity/global-oidc/${globalOidcProvider._id}?mobile=true`,
    );
    expect(lastOpenedUrl()).not.toContain(PROJECT_ID);
  });

  test("a project OIDC provider goes to the project OIDC router, keeping the project id", async () => {
    /*
     * The other half of the same regression, from the other direction: a
     * project whose only identity provider is OIDC was invisible to the app
     * until discovery learned to ask `/identity/service-provider-login-oidc`,
     * and a row for it is only useful if it opens
     * `/identity/oidc/<projectId>/<id>`. Both neighbouring routes are wrong in
     * a way the user cannot see - `/identity/sso/...` is project SAML and
     * would 400 on an id it does not own, and `/identity/global-oidc/...` is
     * the instance-wide OIDC router, which takes no project at all.
     */
    await renderScreen([projectOidcProvider]);

    await pressProvider(projectOidcProvider.name);
    await settleAuthFlow();

    expect(lastOpenedUrl()).toBe(
      `${SERVER_URL}/identity/oidc/${PROJECT_ID}/${projectOidcProvider._id}?mobile=true`,
    );
    expect(lastOpenedUrl()).not.toContain("/identity/sso/");
    expect(lastOpenedUrl()).not.toContain("/identity/global-oidc/");
  });

  test("the two project kinds do not share a route", async () => {
    /*
     * Nothing in the discovery payload says which of the two a provider is -
     * only the endpoint that answered does - so if `kind` were dropped
     * anywhere between discovery and this row, both would open the same URL
     * and one of them would be silently broken.
     */
    await renderScreen([projectSamlProvider, projectOidcProvider]);

    await pressProvider(projectSamlProvider.name);
    await settleAuthFlow();
    await pressProvider(projectOidcProvider.name);
    await settleAuthFlow();

    const [samlUrl, oidcUrl]: Array<string> = openedUrls();

    expect(samlUrl).toContain(`/identity/sso/${PROJECT_ID}/`);
    expect(oidcUrl).toContain(`/identity/oidc/${PROJECT_ID}/`);
    expect(samlUrl).not.toBe(oidcUrl);
  });

  test("every login is flagged as a mobile login", async () => {
    /*
     * `?mobile=true` is what makes the server end the flow on
     * `oneuptime://sso-callback` instead of rendering the web dashboard. Drop
     * it and the browser sits on a dashboard page forever.
     */
    await renderScreen([globalOidcProvider, projectSamlProvider]);

    await pressProvider(globalOidcProvider.name);
    await settleAuthFlow();
    await pressProvider(projectSamlProvider.name);
    await settleAuthFlow();

    expect(openedUrls()).toHaveLength(2);

    for (const url of openedUrls()) {
      expect(url.endsWith("?mobile=true")).toBe(true);
    }
  });

  test("the login is opened against the stored server url", async () => {
    // Self-hosted instances are the norm; there is no fixed host to fall back on.
    mockGetServerUrl.mockResolvedValue("https://status.internal.example");

    await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(lastOpenedUrl()).toBe(
      `https://status.internal.example/identity/global-sso/${globalSamlProvider._id}?mobile=true`,
    );
  });
});

describe("A completed login is persisted before the sheet closes", () => {
  test("a global login is stored and the sheet closes", async () => {
    /*
     * THE regression. A global login used to complete on the server and then
     * vanish: this screen only looked for a project `ssoToken`, saw none, and
     * returned the user to the project that had just refused them - still
     * refused, with no error and nothing written.
     */
    mockCompleteSsoLoginFromUrl.mockResolvedValue({
      status: "success",
      isGlobal: true,
      projectId: null,
    } as CompleteSsoLoginOutcome);

    const rendered: RenderedScreen = await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledWith(CALLBACK_URL);
    expect(rendered.goBack).toHaveBeenCalledTimes(1);
  });

  test("a global OIDC login is stored and the sheet closes", async () => {
    mockCompleteSsoLoginFromUrl.mockResolvedValue({
      status: "success",
      isGlobal: true,
      projectId: null,
    } as CompleteSsoLoginOutcome);

    const rendered: RenderedScreen = await renderScreen([globalOidcProvider]);

    await pressProvider(globalOidcProvider.name);
    await settleAuthFlow();

    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledWith(CALLBACK_URL);
    expect(rendered.goBack).toHaveBeenCalledTimes(1);
  });

  test("a project login is stored and the sheet closes", async () => {
    const rendered: RenderedScreen = await renderScreen([projectSamlProvider]);

    await pressProvider(projectSamlProvider.name);
    await settleAuthFlow();

    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledWith(CALLBACK_URL);
    expect(rendered.goBack).toHaveBeenCalledTimes(1);
  });

  test("a project OIDC login is stored and the sheet closes", async () => {
    /*
     * A project OIDC login comes back with a project-bound token, exactly like
     * project SAML - the newest kind must not be the one that reaches the
     * hand-off differently.
     */
    const rendered: RenderedScreen = await renderScreen([projectOidcProvider]);

    await pressProvider(projectOidcProvider.name);
    await settleAuthFlow();

    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledTimes(1);
    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledWith(CALLBACK_URL);
    expect(rendered.goBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ANY_ERROR_MESSAGE)).toBeNull();
  });

  test("the url handed over is the browser's callback, not the login url", async () => {
    /*
     * The tokens are in the callback. Passing the request url back instead
     * would parse cleanly enough to look like a failure rather than a bug.
     */
    await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledTimes(1);
    expect(mockCompleteSsoLoginFromUrl.mock.calls[0]?.[0]).not.toBe(
      lastOpenedUrl(),
    );
  });

  test("no error is shown after a successful login", async () => {
    await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(screen.queryByText(ANY_ERROR_MESSAGE)).toBeNull();
  });
});

describe("Nothing is claimed when the login did not complete", () => {
  test("a cancelled login stores nothing, closes nothing and says nothing", async () => {
    /*
     * Backing out of the IdP is a normal thing to do. Treating it as a failure
     * would put a red error under a sheet the user closed on purpose; treating
     * it as a success would close the sheet over a project they still cannot
     * open.
     */
    mockOpenSsoAuthSession.mockResolvedValue({
      status: "cancelled",
    } as SsoAuthSessionOutcome);

    const rendered: RenderedScreen = await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(mockCompleteSsoLoginFromUrl).not.toHaveBeenCalled();
    expect(rendered.goBack).not.toHaveBeenCalled();
    expect(screen.queryByText(ANY_ERROR_MESSAGE)).toBeNull();
  });

  test("a browser that could not be opened shows its message and keeps the sheet up", async () => {
    mockOpenSsoAuthSession.mockResolvedValue({
      status: "error",
      message: "Could not open the sign-in page. Please try again.",
    } as SsoAuthSessionOutcome);

    const rendered: RenderedScreen = await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);

    await waitFor((): void => {
      expect(
        screen.getByText("Could not open the sign-in page. Please try again."),
      ).toBeTruthy();
    });

    expect(mockCompleteSsoLoginFromUrl).not.toHaveBeenCalled();
    expect(rendered.goBack).not.toHaveBeenCalled();
  });

  test("a callback carrying an IdP error is reported, not treated as a login", async () => {
    /*
     * The browser DID come back - the redirect just carried an error instead of
     * tokens. Closing the sheet here is the silent failure this screen used to
     * have for every global login.
     */
    mockCompleteSsoLoginFromUrl.mockResolvedValue({
      status: "error",
      message: "SSO login was denied by your identity provider.",
    } as CompleteSsoLoginOutcome);

    const rendered: RenderedScreen = await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);

    await waitFor((): void => {
      expect(
        screen.getByText("SSO login was denied by your identity provider."),
      ).toBeTruthy();
    });

    expect(rendered.goBack).not.toHaveBeenCalled();
  });

  test("an unreadable server url fails before any browser is opened", async () => {
    mockGetServerUrl.mockRejectedValue(new Error("storage unavailable"));

    const rendered: RenderedScreen = await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);

    await waitFor((): void => {
      expect(screen.getByText(/SSO authentication failed/i)).toBeTruthy();
    });

    expect(mockOpenSsoAuthSession).not.toHaveBeenCalled();
    expect(rendered.goBack).not.toHaveBeenCalled();
  });

  test("a project row with no project id is refused instead of opening a broken url", async () => {
    /*
     * `/identity/sso/undefined/<providerId>` would open the browser on a page
     * that fails minutes later with nothing to explain it, so buildSsoLoginUrl
     * throws and the screen has to surface that rather than swallow it.
     */
    const rendered: RenderedScreen = await renderScreen(
      [projectSamlProvider],
      "",
    );

    await pressProvider(projectSamlProvider.name);

    await waitFor((): void => {
      expect(screen.getByText(/SSO authentication failed/i)).toBeTruthy();
    });

    expect(mockOpenSsoAuthSession).not.toHaveBeenCalled();
    expect(rendered.goBack).not.toHaveBeenCalled();
  });

  test("a project OIDC row with no project id is refused too", async () => {
    /*
     * `isProjectScopedKind` is what decides whether a project id is demanded.
     * If project OIDC had been left out of it, this would open
     * `/identity/global-oidc/<projectOidcId>` - a URL that is well-formed, so
     * the browser opens happily and the failure only surfaces at the IdP.
     */
    const rendered: RenderedScreen = await renderScreen(
      [projectOidcProvider],
      "",
    );

    await pressProvider(projectOidcProvider.name);

    await waitFor((): void => {
      expect(screen.getByText(/SSO authentication failed/i)).toBeTruthy();
    });

    expect(mockOpenSsoAuthSession).not.toHaveBeenCalled();
    expect(rendered.goBack).not.toHaveBeenCalled();
  });

  test("a global row still works on a sheet reached with no project id", async () => {
    /*
     * The mirror of the case above: a global login needs no project, so it must
     * not inherit the project flow's requirement for one.
     */
    const rendered: RenderedScreen = await renderScreen(
      [globalSamlProvider],
      "",
    );

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(lastOpenedUrl()).toBe(
      `${SERVER_URL}/identity/global-sso/${globalSamlProvider._id}?mobile=true`,
    );
    expect(rendered.goBack).toHaveBeenCalledTimes(1);
  });
});

describe("Recovering from a failed attempt", () => {
  test("a second attempt is possible after an error, and clears the first one", async () => {
    /*
     * The row has to become pressable again - if the in-flight flag were left
     * set, one failure would freeze the only way back into the project.
     */
    mockOpenSsoAuthSession.mockResolvedValueOnce({
      status: "error",
      message: "Could not open the sign-in page. Please try again.",
    } as SsoAuthSessionOutcome);
    mockOpenSsoAuthSession.mockResolvedValue(callbackOutcome);

    const rendered: RenderedScreen = await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);

    await waitFor((): void => {
      expect(
        screen.getByText("Could not open the sign-in page. Please try again."),
      ).toBeTruthy();
    });

    expect(isRowDisabled(globalSamlProvider.name)).toBe(false);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(mockOpenSsoAuthSession).toHaveBeenCalledTimes(2);
    expect(rendered.goBack).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("Could not open the sign-in page. Please try again."),
    ).toBeNull();
  });

  test("a cancelled login leaves the row usable", async () => {
    mockOpenSsoAuthSession.mockResolvedValueOnce({
      status: "cancelled",
    } as SsoAuthSessionOutcome);
    mockOpenSsoAuthSession.mockResolvedValue(callbackOutcome);

    const rendered: RenderedScreen = await renderScreen([globalSamlProvider]);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(isRowDisabled(globalSamlProvider.name)).toBe(false);

    await pressProvider(globalSamlProvider.name);
    await settleAuthFlow();

    expect(mockOpenSsoAuthSession).toHaveBeenCalledTimes(2);
    expect(rendered.goBack).toHaveBeenCalledTimes(1);
  });
});

describe("Only one auth session may run at a time", () => {
  test("the other rows are refused while one login is in the browser", async () => {
    /*
     * expo-web-browser allows a single auth session per process: a second
     * openAuthSessionAsync throws on iOS, and on Android its Linking listener
     * would race the first login for the same callback. So the rows have to be
     * shut off for the duration, not merely dimmed.
     */
    let releaseAuthSession: (
      outcome: SsoAuthSessionOutcome,
    ) => void = (): void => {
      return undefined;
    };

    mockOpenSsoAuthSession.mockImplementation(
      (): Promise<SsoAuthSessionOutcome> => {
        return new Promise<SsoAuthSessionOutcome>(
          (resolve: (outcome: SsoAuthSessionOutcome) => void): void => {
            releaseAuthSession = resolve;
          },
        );
      },
    );

    const rendered: RenderedScreen = await renderScreen([
      globalSamlProvider,
      projectSamlProvider,
    ]);

    /*
     * Not awaited yet, on purpose: fireEvent resolves with whatever onPress
     * returned, and here that is a handler still sitting in the browser, so
     * awaiting it now would deadlock. The press itself is dispatched
     * synchronously; the plain (un-`act`-wrapped) boundary below just lets
     * fireEvent's own act scope close before anything else opens one.
     */
    const pressInFlight: Promise<void> = pressProvider(globalSamlProvider.name);

    await nextMacrotask();

    expect(mockOpenSsoAuthSession).toHaveBeenCalledTimes(1);
    expect(isRowDisabled(globalSamlProvider.name)).toBe(true);
    expect(isRowDisabled(projectSamlProvider.name)).toBe(true);

    // Pressing the other row must not start a competing session.
    await pressProvider(projectSamlProvider.name);

    expect(mockOpenSsoAuthSession).toHaveBeenCalledTimes(1);

    await act(async (): Promise<void> => {
      releaseAuthSession(callbackOutcome);
      await nextMacrotask();
    });

    await pressInFlight;

    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledWith(CALLBACK_URL);
    expect(rendered.goBack).toHaveBeenCalledTimes(1);
  });
});

describe("Grouping the providers a user can choose from", () => {
  test("global and project providers sit under separate headings", async () => {
    /*
     * The two are not interchangeable - one signs the user into the whole
     * instance, the other into this project only - and a user who picks the
     * wrong one gets an unexplained rejection from the server.
     */
    await renderScreen([globalSamlProvider, projectSamlProvider]);

    expect(screen.getByText("Your organization")).toBeTruthy();
    expect(screen.getByText("This project")).toBeTruthy();
    expect(screen.getByLabelText(globalSamlProvider.name)).toBeTruthy();
    expect(screen.getByLabelText(projectSamlProvider.name)).toBeTruthy();
  });

  test("both global kinds are grouped together as the organization's", async () => {
    await renderScreen([globalSamlProvider, globalOidcProvider]);

    expect(screen.getByText("Your organization")).toBeTruthy();
    expect(screen.getByLabelText(globalSamlProvider.name)).toBeTruthy();
    expect(screen.getByLabelText(globalOidcProvider.name)).toBeTruthy();
    expect(screen.queryByText("This project")).toBeNull();
    expect(screen.queryByText("Available providers")).toBeNull();
  });

  test("a project OIDC provider is listed under the project heading, not the organization one", async () => {
    /*
     * "OIDC" is not a synonym for "global": project OIDC belongs to this one
     * project, and filing it with the organization's providers would both
     * mislabel it and - since the grouping and the routing are the same
     * `isProjectScopedKind` call - mean its login url had lost the project id.
     */
    await renderScreen([globalOidcProvider, projectOidcProvider]);

    expect(
      withinSection("This project").getByLabelText(projectOidcProvider.name),
    ).toBeTruthy();
    expect(
      withinSection("Your organization").queryByLabelText(
        projectOidcProvider.name,
      ),
    ).toBeNull();
    expect(
      withinSection("Your organization").getByLabelText(
        globalOidcProvider.name,
      ),
    ).toBeTruthy();
  });

  test("both project kinds share the one project heading", async () => {
    await renderScreen([
      globalSamlProvider,
      projectSamlProvider,
      projectOidcProvider,
    ]);

    const projectSection: ReturnType<typeof within> =
      withinSection("This project");

    expect(
      projectSection.getByLabelText(projectSamlProvider.name),
    ).toBeTruthy();
    expect(
      projectSection.getByLabelText(projectOidcProvider.name),
    ).toBeTruthy();
    expect(projectSection.queryByLabelText(globalSamlProvider.name)).toBeNull();

    // One project card, not one per kind.
    expect(screen.queryAllByText("This project")).toHaveLength(1);
    expect(screen.queryByText("Available providers")).toBeNull();
  });

  test("a sheet of only project OIDC providers gets the project-only heading", async () => {
    /*
     * The case that motivated the discovery fix: a project whose sole identity
     * provider is OIDC. There is no organization group to contrast with, so
     * the heading is the neutral one - and "Your organization" appearing here
     * would tell the user this signs them into the whole instance.
     */
    await renderScreen([projectOidcProvider]);

    expect(screen.getByText("Available providers")).toBeTruthy();
    expect(screen.getByLabelText(projectOidcProvider.name)).toBeTruthy();
    expect(screen.queryByText("Your organization")).toBeNull();
    expect(screen.queryByText("This project")).toBeNull();
  });

  test("project-only instances get no organization heading", async () => {
    // Nothing to contrast with, so the heading would be noise.
    await renderScreen([projectSamlProvider]);

    expect(screen.getByText("Available providers")).toBeTruthy();
    expect(screen.queryByText("Your organization")).toBeNull();
    expect(screen.queryByText("This project")).toBeNull();
  });

  test("the sheet names the project the user is signing in to", async () => {
    await renderScreen([globalSamlProvider]);

    expect(screen.getByText(PROJECT_NAME)).toBeTruthy();
  });

  test("a provider's description is shown when it has one", async () => {
    await renderScreen([globalSamlProvider, globalOidcProvider]);

    expect(
      screen.getByText(globalSamlProvider.description as string),
    ).toBeTruthy();
  });
});

/*
 * What every kind of provider is supposed to do, keyed by the kind itself.
 *
 * `Record<SsoProviderKind, ...>` is the point: a fifth kind added to the union
 * does not compile until it has a row here, and every test below is driven off
 * `Object.keys`, so a new kind arrives with its route, its project binding and
 * its grouping already asserted instead of quietly untested. Project OIDC is
 * exactly the kind that was missing for a while, on the screen before this one.
 */
interface KindExpectation {
  provider: SelectableSsoProvider;
  expectedUrl: string;
  isProjectScoped: boolean;
  heading: string;
}

const expectationByKind: Record<SsoProviderKind, KindExpectation> = {
  "global-sso": {
    provider: globalSamlProvider,
    expectedUrl: `${SERVER_URL}/identity/global-sso/${globalSamlProvider._id}?mobile=true`,
    isProjectScoped: false,
    heading: "Your organization",
  },
  "global-oidc": {
    provider: globalOidcProvider,
    expectedUrl: `${SERVER_URL}/identity/global-oidc/${globalOidcProvider._id}?mobile=true`,
    isProjectScoped: false,
    heading: "Your organization",
  },
  project: {
    provider: projectSamlProvider,
    expectedUrl: `${SERVER_URL}/identity/sso/${PROJECT_ID}/${projectSamlProvider._id}?mobile=true`,
    isProjectScoped: true,
    heading: "This project",
  },
  "project-oidc": {
    provider: projectOidcProvider,
    expectedUrl: `${SERVER_URL}/identity/oidc/${PROJECT_ID}/${projectOidcProvider._id}?mobile=true`,
    isProjectScoped: true,
    heading: "This project",
  },
};

const allKinds: Array<SsoProviderKind> = Object.keys(
  expectationByKind,
) as Array<SsoProviderKind>;

const allExpectations: Array<KindExpectation> = allKinds.map(
  (kind: SsoProviderKind): KindExpectation => {
    return expectationByKind[kind];
  },
);

const everyKindOfProvider: Array<SelectableSsoProvider> = allExpectations.map(
  (expectation: KindExpectation): SelectableSsoProvider => {
    return expectation.provider;
  },
);

describe("A sheet carrying every kind at once", () => {
  test("the table covers each kind exactly once", async () => {
    /*
     * Guards the tests below rather than the screen: a table with a duplicated
     * or mismatched provider would make them pass while covering three kinds.
     */
    for (const kind of allKinds) {
      expect(expectationByKind[kind].provider.kind).toBe(kind);
    }

    const ids: Array<string> = everyKindOfProvider.map(
      (provider: SelectableSsoProvider): string => {
        return provider._id;
      },
    );

    expect(new Set<string>(ids).size).toBe(allKinds.length);
  });

  test("a row is rendered for every kind", async () => {
    /*
     * A mixed instance - global SSO on the admin dashboard plus a project that
     * configured its own - is the normal case, not a contrived one, and a kind
     * the screen cannot render is a kind the user cannot sign in with.
     */
    await renderScreen(everyKindOfProvider);

    for (const expectation of allExpectations) {
      expect(screen.getByLabelText(expectation.provider.name)).toBeTruthy();
    }
  });

  test("each row opens the route its own kind is served by", async () => {
    await renderScreen(everyKindOfProvider);

    for (const expectation of allExpectations) {
      await pressProvider(expectation.provider.name);
      await settleAuthFlow();

      expect(lastOpenedUrl()).toBe(expectation.expectedUrl);
    }

    // Nothing was skipped, and no row started two sessions.
    expect(openedUrls()).toHaveLength(allExpectations.length);
    expect(new Set<string>(openedUrls()).size).toBe(allExpectations.length);
  });

  test("only the project-scoped kinds carry the project id", async () => {
    /*
     * Both mistakes are invisible on the device and fatal on the server: a
     * project id in a global login is a 400, and a missing one in a project
     * login is `/identity/oidc/undefined/<id>`.
     */
    await renderScreen(everyKindOfProvider);

    for (const expectation of allExpectations) {
      await pressProvider(expectation.provider.name);
      await settleAuthFlow();

      if (expectation.isProjectScoped) {
        expect(lastOpenedUrl()).toContain(`/${PROJECT_ID}/`);
      } else {
        expect(lastOpenedUrl()).not.toContain(PROJECT_ID);
      }
    }
  });

  test("each row is filed under the heading its kind belongs to", async () => {
    await renderScreen(everyKindOfProvider);

    for (const expectation of allExpectations) {
      expect(
        withinSection(expectation.heading).getByLabelText(
          expectation.provider.name,
        ),
      ).toBeTruthy();
    }
  });

  test("a completed login is handed over and closes the sheet for every kind", async () => {
    const rendered: RenderedScreen = await renderScreen(everyKindOfProvider);

    for (const expectation of allExpectations) {
      await pressProvider(expectation.provider.name);
      await settleAuthFlow();
    }

    expect(mockCompleteSsoLoginFromUrl).toHaveBeenCalledTimes(
      allExpectations.length,
    );

    for (const call of mockCompleteSsoLoginFromUrl.mock.calls) {
      expect(call[0]).toBe(CALLBACK_URL);
    }

    expect(rendered.goBack).toHaveBeenCalledTimes(allExpectations.length);
    expect(screen.queryByText(ANY_ERROR_MESSAGE)).toBeNull();
  });
});
