import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import SSOLoginScreen from "./SSOLoginScreen";
import {
  fetchAllGlobalProviders,
  fetchProjectProvidersForEmail,
  type GlobalSSOProvider,
  type SSOProvider,
  type SsoDiscoveryResult,
} from "../../api/sso";
import {
  openSsoAuthSession,
  type SsoAuthSessionOutcome,
} from "../../sso/authSession";
import { completeSsoLoginFromUrl } from "../../sso/session";

/*
 * The SSO login screen is the only door into an instance that federates its
 * identity, so the things worth testing here are the ones that lock people out
 * rather than the ones that look wrong:
 *
 *   - Global (instance-wide) SSO is configured on the ADMIN dashboard and is
 *     not bound to an email domain. It therefore has to be discovered and
 *     offered on MOUNT. The screen used to require an email first, which made
 *     an instance whose only identity provider is a global one look like it
 *     had no SSO at all - there was no email that would ever reveal it.
 *   - A login is only real once its tokens are persisted AND the app is told
 *     it is authenticated. Doing one without the other strands the user.
 *   - "We could not reach your server" and "your address does not federate"
 *     are different problems with different fixes. The screen used to say the
 *     second one for both, which sends people to an admin who cannot help.
 *
 * The API, the auth browser and the token-persisting step are all covered by
 * their own suites; here they are stand-ins so this file can assert on what
 * the screen DOES with each answer they can give.
 */

jest.mock("../../api/sso", () => {
  return {
    fetchAllGlobalProviders: jest.fn(),
    fetchProjectProvidersForEmail: jest.fn(),
  };
});

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

/*
 * Deliberately carries a trailing slash: it is what a user types into the
 * server-url screen, and the login URL still has to come out with a single
 * slash before /identity.
 */
jest.mock("../../storage/serverUrl", () => {
  return {
    getServerUrl: async (): Promise<string> => {
      return "https://oneuptime.com/";
    },
  };
});

/*
 * Read lazily inside the hook stand-ins - a jest.mock factory runs while the
 * screen module is still being required, which is before anything declared in
 * this file exists.
 */
const mockAuth: { setIsAuthenticated: jest.Mock } = {
  setIsAuthenticated: jest.fn(),
};

const mockNavigation: { navigate: jest.Mock } = {
  navigate: jest.fn(),
};

jest.mock("../../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return mockAuth;
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return mockNavigation;
    },
  };
});

function globalDiscovery(): jest.Mock {
  return fetchAllGlobalProviders as unknown as jest.Mock;
}

function projectDiscovery(): jest.Mock {
  return fetchProjectProvidersForEmail as unknown as jest.Mock;
}

function authSession(): jest.Mock {
  return openSsoAuthSession as unknown as jest.Mock;
}

function completeLogin(): jest.Mock {
  return completeSsoLoginFromUrl as unknown as jest.Mock;
}

function found<T>(providers: Array<T>): SsoDiscoveryResult<T> {
  return { providers, failed: false };
}

function unreachable<T>(): SsoDiscoveryResult<T> {
  return { providers: [], failed: true };
}

function globalProvider(
  overrides: Partial<GlobalSSOProvider> = {},
): GlobalSSOProvider {
  return {
    _id: "global-saml-1",
    name: "Acme Corporate SAML",
    description: "Sign in with your Acme account",
    type: "global-sso",
    ...overrides,
  };
}

function projectProvider(overrides: Partial<SSOProvider> = {}): SSOProvider {
  return {
    _id: "provider-1",
    name: "Acme Okta",
    projectId: "project-1",
    project: { name: "Acme Production" },
    // Project SAML by default; pass kind: "project-oidc" for the OIDC router.
    kind: "project",
    ...overrides,
  };
}

/*
 * Every string this screen is capable of putting in front of the user as an
 * error. Asserting against the whole set is what stops a "nothing was said"
 * test from passing because it guessed the wrong wording.
 */
const ANY_ERROR_MESSAGE: RegExp =
  /required|valid email|could not|no sso configuration|failed/i;

function expectNoErrorShown(): void {
  expect(screen.queryByText(ANY_ERROR_MESSAGE)).toBeNull();
}

/** Renders the screen and waits for the on-mount global discovery to settle. */
async function renderScreen(): Promise<void> {
  await render(<SSOLoginScreen />);

  await waitFor(() => {
    expect(globalDiscovery()).toHaveBeenCalled();
  });

  // The email step only appears once the global section has stopped loading.
  await screen.findByText("Email");
}

/** Types an email and presses Continue. */
async function submitEmail(email: string): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText("Email"), email);
  await fireEvent.press(screen.getByText("Continue"));
}

beforeEach(() => {
  globalDiscovery().mockResolvedValue(found<GlobalSSOProvider>([]));
  projectDiscovery().mockResolvedValue(found<SSOProvider>([]));
  authSession().mockResolvedValue({ status: "cancelled" });
  completeLogin().mockResolvedValue({
    status: "success",
    isGlobal: true,
    projectId: null,
  });
});

describe("Global providers are offered before anyone types an email", () => {
  test("discovery runs on mount", async () => {
    /*
     * The headline fix. A global provider belongs to the instance, not to an
     * email domain, so nothing the user could type would ever reveal it - it
     * has to be fetched unprompted or it does not exist as far as the app is
     * concerned.
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));

    await renderScreen();

    expect(globalDiscovery()).toHaveBeenCalledTimes(1);
  });

  test("the provider name is on screen before any interaction", async () => {
    globalDiscovery().mockResolvedValue(found([globalProvider()]));

    await renderScreen();

    expect(await screen.findByText("Acme Corporate SAML")).toBeTruthy();
  });

  test("no email lookup is made just to show them", async () => {
    /*
     * The old screen reached the provider list only through the email lookup.
     * If that call is still what populates this section, an instance with only
     * global SSO is still broken.
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));

    await renderScreen();

    expect(projectDiscovery()).not.toHaveBeenCalled();
  });

  test("SAML and OIDC providers are listed together", async () => {
    globalDiscovery().mockResolvedValue(
      found([
        globalProvider(),
        globalProvider({
          _id: "global-oidc-1",
          name: "Acme Entra ID",
          type: "global-oidc",
        }),
      ]),
    );

    await renderScreen();

    expect(await screen.findByText("Acme Corporate SAML")).toBeTruthy();
    expect(screen.getByText("Acme Entra ID")).toBeTruthy();
  });

  test("the section says what these providers are", async () => {
    globalDiscovery().mockResolvedValue(found([globalProvider()]));

    await renderScreen();

    expect(
      await screen.findByText("Sign in with your organization"),
    ).toBeTruthy();
  });

  test("a provider's description is shown alongside its name", async () => {
    globalDiscovery().mockResolvedValue(found([globalProvider()]));

    await renderScreen();

    expect(
      await screen.findByText("Sign in with your Acme account"),
    ).toBeTruthy();
  });

  test("the email step is still offered underneath", async () => {
    /*
     * Global SSO is offered IN ADDITION to project SSO. A user whose access
     * comes from a project provider must not lose their way in.
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));

    await renderScreen();

    expect(await screen.findByText("Or continue with email")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });
});

describe("An instance with no global providers", () => {
  test("does not render the section at all", async () => {
    globalDiscovery().mockResolvedValue(found<GlobalSSOProvider>([]));

    await renderScreen();

    expect(screen.queryByText("Sign in with your organization")).toBeNull();
    expect(screen.queryByText("Or continue with email")).toBeNull();
  });

  test("still lets the user through the email step", async () => {
    globalDiscovery().mockResolvedValue(found<GlobalSSOProvider>([]));
    projectDiscovery().mockResolvedValue(found([projectProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText("Acme Okta")).toBeTruthy();
  });

  test("a failed global discovery does not block the screen either", async () => {
    /*
     * Discovery runs unprompted, so its failure is not something the user
     * asked for and must not be shouted at them - but it also must not take
     * the email login down with it.
     */
    globalDiscovery().mockResolvedValue(unreachable<GlobalSSOProvider>());
    projectDiscovery().mockResolvedValue(found([projectProvider()]));

    await renderScreen();

    expect(screen.queryByText("Sign in with your organization")).toBeNull();
    expectNoErrorShown();

    await submitEmail("user@acme.com");

    expect(await screen.findByText("Acme Okta")).toBeTruthy();
  });
});

describe("Starting a global login", () => {
  test("a SAML row opens the instance-wide SAML route, flagged as mobile", async () => {
    /*
     * ?mobile=true is the only thing telling the server to end the flow on the
     * app's deep link instead of rendering the web dashboard; without it the
     * user completes a login the app never hears about. The two global kinds
     * are served by different routers, so the path has to match the kind.
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Corporate SAML"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledWith(
        "https://oneuptime.com/identity/global-sso/global-saml-1?mobile=true",
      );
    });
  });

  test("an OIDC row opens the OIDC route instead", async () => {
    globalDiscovery().mockResolvedValue(
      found([
        globalProvider({
          _id: "global-oidc-1",
          name: "Acme Entra ID",
          type: "global-oidc",
        }),
      ]),
    );

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Entra ID"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledWith(
        "https://oneuptime.com/identity/global-oidc/global-oidc-1?mobile=true",
      );
    });
  });

  test("the callback is handed to the one place that persists a session", async () => {
    globalDiscovery().mockResolvedValue(found([globalProvider()]));
    authSession().mockResolvedValue({
      status: "callback",
      url: "oneuptime://sso-callback?global-sso-token=abc",
    });

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Corporate SAML"));

    await waitFor(() => {
      expect(completeLogin()).toHaveBeenCalledWith(
        "oneuptime://sso-callback?global-sso-token=abc",
      );
    });
  });

  test("and only then is the user marked authenticated", async () => {
    /*
     * Order matters: flipping the app to "signed in" before the tokens are
     * stored lands the user on a dashboard whose every request is unauthorised.
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));
    authSession().mockResolvedValue({
      status: "callback",
      url: "oneuptime://sso-callback?global-sso-token=abc",
    });

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Corporate SAML"));

    await waitFor(() => {
      expect(mockAuth.setIsAuthenticated).toHaveBeenCalledWith(true);
    });

    expect(completeLogin()).toHaveBeenCalled();
  });

  test("a cancelled login signs nobody in", async () => {
    globalDiscovery().mockResolvedValue(found([globalProvider()]));
    authSession().mockResolvedValue({ status: "cancelled" });

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Corporate SAML"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalled();
    });

    expect(completeLogin()).not.toHaveBeenCalled();
    expect(mockAuth.setIsAuthenticated).not.toHaveBeenCalled();
  });

  test("and says nothing, because backing out is not a failure", async () => {
    /*
     * A user who changed their mind, or who is bounced back by an IdP that
     * wanted a second factor on another device, has done nothing wrong. An
     * error here reads as "SSO is broken on this instance".
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));
    authSession().mockResolvedValue({ status: "cancelled" });

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Corporate SAML"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalled();
    });

    await screen.findByText("Acme Corporate SAML");
    expectNoErrorShown();
  });

  test("a browser that will not open reports why", async () => {
    globalDiscovery().mockResolvedValue(found([globalProvider()]));
    authSession().mockResolvedValue({
      status: "error",
      message: "Could not open the sign-in page. Please try again.",
    });

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Corporate SAML"));

    expect(
      await screen.findByText(
        "Could not open the sign-in page. Please try again.",
      ),
    ).toBeTruthy();
    expect(mockAuth.setIsAuthenticated).not.toHaveBeenCalled();
  });

  test("a callback that carries an IdP error is shown, not treated as a login", async () => {
    /*
     * The IdP redirects back to the same deep link whether it authenticated
     * the user or refused them. Treating the redirect itself as success is how
     * a rejected user ends up "signed in" with no tokens.
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));
    authSession().mockResolvedValue({
      status: "callback",
      url: "oneuptime://sso-callback?error=access_denied",
    });
    completeLogin().mockResolvedValue({
      status: "error",
      message: "SSO login failed: access_denied",
    });

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Corporate SAML"));

    expect(
      await screen.findByText("SSO login failed: access_denied"),
    ).toBeTruthy();
    expect(mockAuth.setIsAuthenticated).not.toHaveBeenCalled();
  });

  test("a retry clears the message left by the previous attempt", async () => {
    /*
     * A stale error sitting above a login that is currently succeeding is how
     * a user gives up on a flow that actually worked.
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));
    authSession().mockResolvedValue({
      status: "error",
      message: "Could not open the sign-in page. Please try again.",
    });

    await renderScreen();

    await fireEvent.press(await screen.findByLabelText("Acme Corporate SAML"));

    await screen.findByText(
      "Could not open the sign-in page. Please try again.",
    );

    authSession().mockResolvedValue({ status: "cancelled" });

    await fireEvent.press(screen.getByLabelText("Acme Corporate SAML"));

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Could not open the sign-in page. Please try again.",
        ),
      ).toBeNull();
    });
  });

  test("the email form is replaced by a progress message while the browser is open", async () => {
    /*
     * The auth browser is a separate screen the user is looking at. Leaving a
     * live Continue button behind it invites a second, competing login - which
     * on Android throws, because a session is already open.
     */
    globalDiscovery().mockResolvedValue(found([globalProvider()]));

    let finishSession: (outcome: SsoAuthSessionOutcome) => void = (): void => {
      return undefined;
    };

    authSession().mockImplementation((): Promise<SsoAuthSessionOutcome> => {
      return new Promise(
        (resolve: (outcome: SsoAuthSessionOutcome) => void): void => {
          finishSession = resolve;
        },
      );
    });

    await renderScreen();

    /*
     * Held rather than awaited: the press does not settle until the auth
     * browser does, and the whole point of this test is to look at the screen
     * while it has not.
     */
    const pressed: Promise<void> = fireEvent.press(
      await screen.findByLabelText("Acme Corporate SAML"),
    );

    expect(await screen.findByText("Authenticating...")).toBeTruthy();
    expect(screen.queryByText("Continue")).toBeNull();
    expect(screen.queryByLabelText("Email")).toBeNull();

    finishSession({ status: "cancelled" });
    await pressed;

    expect(await screen.findByText("Continue")).toBeTruthy();
  });
});

describe("The email a user types is checked before the server is bothered", () => {
  test("an empty email is named as the problem", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByText("Continue"));

    expect(await screen.findByText("Email is required.")).toBeTruthy();
  });

  test("an email of nothing but spaces counts as empty", async () => {
    await renderScreen();
    await submitEmail("   ");

    expect(await screen.findByText("Email is required.")).toBeTruthy();
    expect(projectDiscovery()).not.toHaveBeenCalled();
  });

  test("a malformed email is called out as malformed", async () => {
    /*
     * Distinct from "no providers found" on purpose: a typo reported as a
     * missing SSO configuration sends the user to their admin instead of back
     * to their own keyboard.
     */
    await renderScreen();
    await submitEmail("nope");

    expect(
      await screen.findByText("Please enter a valid email address."),
    ).toBeTruthy();
  });

  test("and is never sent to the discovery endpoint", async () => {
    await renderScreen();
    await submitEmail("nope");

    await screen.findByText("Please enter a valid email address.");

    expect(projectDiscovery()).not.toHaveBeenCalled();
  });

  test("surrounding whitespace is trimmed before the lookup", async () => {
    /*
     * Phone keyboards append a space often enough that not trimming would make
     * SSO look broken for a correctly typed address.
     */
    projectDiscovery().mockResolvedValue(found([projectProvider()]));

    await renderScreen();
    await submitEmail("  user@acme.com  ");

    await waitFor(() => {
      expect(projectDiscovery()).toHaveBeenCalledWith("user@acme.com");
    });
  });

  test("editing the email clears the message it produced", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByText("Continue"));

    await screen.findByText("Email is required.");

    await fireEvent.changeText(screen.getByLabelText("Email"), "u");

    await waitFor(() => {
      expect(screen.queryByText("Email is required.")).toBeNull();
    });
  });
});

describe("Discovery that finds nothing says which kind of nothing", () => {
  test("an unreachable server is reported as an unreachable server", async () => {
    projectDiscovery().mockResolvedValue(unreachable<SSOProvider>());

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText(/Could not reach the server/i)).toBeTruthy();
  });

  test("and not as a missing SSO configuration for the address", async () => {
    /*
     * The regression this pair exists to prevent: both cases used to produce
     * the email-shaped message, so a phone that was simply offline told the
     * user their company had not set up SSO.
     */
    projectDiscovery().mockResolvedValue(unreachable<SSOProvider>());

    await renderScreen();
    await submitEmail("user@acme.com");

    await screen.findByText(/Could not reach the server/i);

    expect(screen.queryByText(/No SSO configuration found/i)).toBeNull();
    expect(screen.queryByText(/user@acme\.com/)).toBeNull();
  });

  test("an empty answer names the email that was looked up", async () => {
    projectDiscovery().mockResolvedValue(found<SSOProvider>([]));

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(
      await screen.findByText(
        "No SSO configuration found for the email: user@acme.com",
      ),
    ).toBeTruthy();
  });

  test("and does not blame the connection", async () => {
    projectDiscovery().mockResolvedValue(found<SSOProvider>([]));

    await renderScreen();
    await submitEmail("user@acme.com");

    await screen.findByText(/No SSO configuration found/i);

    expect(screen.queryByText(/Could not reach the server/i)).toBeNull();
  });

  test("neither answer moves the user on to a provider list", async () => {
    projectDiscovery().mockResolvedValue(found<SSOProvider>([]));

    await renderScreen();
    await submitEmail("user@acme.com");

    await screen.findByText(/No SSO configuration found/i);

    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.queryByText("Select your SSO provider")).toBeNull();
  });
});

describe("Choosing a project provider", () => {
  test("a successful lookup moves on to the provider list", async () => {
    projectDiscovery().mockResolvedValue(found([projectProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText("Select your SSO provider")).toBeTruthy();
    expect(screen.getByText("Acme Okta")).toBeTruthy();
  });

  test("providers are grouped under the project they belong to", async () => {
    /*
     * One address can federate into several projects with the same-looking
     * provider name. Without the project heading the user is picking blind,
     * and the wrong pick issues a token for the wrong project.
     */
    projectDiscovery().mockResolvedValue(
      found([
        projectProvider(),
        projectProvider({
          _id: "provider-2",
          name: "Acme Azure",
          projectId: "project-2",
          project: { name: "Acme Staging" },
        }),
      ]),
    );

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText("Acme Production")).toBeTruthy();
    expect(screen.getByText("Acme Staging")).toBeTruthy();
    expect(screen.getByText("Acme Okta")).toBeTruthy();
    expect(screen.getByText("Acme Azure")).toBeTruthy();
  });

  test("a provider whose project the API did not name still gets a heading", async () => {
    projectDiscovery().mockResolvedValue(
      found([projectProvider({ project: undefined })]),
    );

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText("Unknown Project")).toBeTruthy();
  });

  test("tapping one opens the project SSO route for that project", async () => {
    /*
     * A project login needs BOTH ids in the path. A global-shaped URL here
     * would be answered by the wrong router.
     */
    projectDiscovery().mockResolvedValue(found([projectProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Okta"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledWith(
        "https://oneuptime.com/identity/sso/project-1/provider-1?mobile=true",
      );
    });
  });

  test("a completed project login signs the user in as well", async () => {
    projectDiscovery().mockResolvedValue(found([projectProvider()]));
    authSession().mockResolvedValue({
      status: "callback",
      url: "oneuptime://sso-callback?sso-token=abc&project-id=project-1",
    });

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Okta"));

    await waitFor(() => {
      expect(mockAuth.setIsAuthenticated).toHaveBeenCalledWith(true);
    });
  });
});

/*
 * Project OIDC is served by a SECOND discovery endpoint
 * (/identity/service-provider-login-oidc) that this screen never asked. It
 * knew about project SAML and the two global kinds only, so a project whose
 * only identity provider was OIDC did not appear here at all - and because
 * project discovery is email-scoped, there was no address a user could type
 * that would ever reveal it. They were told their email had no SSO config.
 *
 * Neither project payload carries a type field, so the `kind` stamped on by
 * whichever endpoint answered is the only thing separating the two - and it
 * picks the router: project SAML is /identity/sso/:projectId/:providerId,
 * project OIDC is /identity/oidc/:projectId/:providerId. Each router 400s on
 * the other's ids, so a mis-routed row is a login that cannot complete.
 */
function projectOidcProvider(
  overrides: Partial<SSOProvider> = {},
): SSOProvider {
  return projectProvider({
    _id: "provider-oidc-1",
    name: "Acme Entra ID",
    kind: "project-oidc",
    ...overrides,
  });
}

describe("A project whose identity provider is OIDC", () => {
  test("is offered on the provider list like any other", async () => {
    projectDiscovery().mockResolvedValue(found([projectOidcProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText("Select your SSO provider")).toBeTruthy();
    expect(screen.getByText("Acme Entra ID")).toBeTruthy();
    expect(screen.getByText("Acme Production")).toBeTruthy();
  });

  test("tapping it opens the project OIDC route for that project", async () => {
    projectDiscovery().mockResolvedValue(found([projectOidcProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Entra ID"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledWith(
        "https://oneuptime.com/identity/oidc/project-1/provider-oidc-1?mobile=true",
      );
    });
  });

  test("and never the SAML route, which has never heard of its id", async () => {
    /*
     * The kind is the only thing standing between an OIDC provider and
     * /identity/sso/..., where the id belongs to no SAML config and the login
     * dies on a 400 inside the auth browser - after the user has already been
     * sent away from the app.
     */
    projectDiscovery().mockResolvedValue(found([projectOidcProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Entra ID"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledTimes(1);
    });

    const requestedUrl: string = authSession().mock.calls[0][0] as string;

    expect(requestedUrl).toContain("/identity/oidc/");
    expect(requestedUrl).not.toContain("/identity/sso/");
  });

  test("a completed OIDC login signs the user in", async () => {
    projectDiscovery().mockResolvedValue(found([projectOidcProvider()]));
    authSession().mockResolvedValue({
      status: "callback",
      url: "oneuptime://sso-callback?sso-token=abc&project-id=project-1",
    });

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Entra ID"));

    await waitFor(() => {
      expect(completeLogin()).toHaveBeenCalledWith(
        "oneuptime://sso-callback?sso-token=abc&project-id=project-1",
      );
    });

    expect(mockAuth.setIsAuthenticated).toHaveBeenCalledWith(true);
  });

  test("one with no project id is reported as misconfigured, not routed", async () => {
    /*
     * The project-scoped guard has to cover BOTH project kinds. If it only
     * knew about SAML, an OIDC row from a sparse payload would build
     * /identity/oidc//provider-oidc-1 and fail somewhere the user cannot see.
     */
    projectDiscovery().mockResolvedValue(
      found([projectOidcProvider({ projectId: "" })]),
    );

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Entra ID"));

    expect(
      await screen.findByText(
        "This SSO provider is misconfigured and cannot be used. Please contact your admin.",
      ),
    ).toBeTruthy();
    expect(authSession()).not.toHaveBeenCalled();
    expect(mockAuth.setIsAuthenticated).not.toHaveBeenCalled();
  });
});

describe("A project that has both a SAML and an OIDC provider", () => {
  function bothKinds(): Array<SSOProvider> {
    return [projectProvider(), projectOidcProvider()];
  }

  test("offers both of them, under the one project heading", async () => {
    /*
     * They belong to the same project, so grouping by project id has to put
     * them together - a second "Acme Production" heading would read as a
     * second project the user has to choose between.
     */
    projectDiscovery().mockResolvedValue(found(bothKinds()));

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText("Acme Okta")).toBeTruthy();
    expect(screen.getByText("Acme Entra ID")).toBeTruthy();
    expect(screen.getAllByText("Acme Production")).toHaveLength(1);
  });

  test("and each row starts its own router", async () => {
    projectDiscovery().mockResolvedValue(found(bothKinds()));
    authSession().mockResolvedValue({ status: "cancelled" });

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Okta"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledWith(
        "https://oneuptime.com/identity/sso/project-1/provider-1?mobile=true",
      );
    });

    await fireEvent.press(await screen.findByLabelText("Acme Entra ID"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledWith(
        "https://oneuptime.com/identity/oidc/project-1/provider-oidc-1?mobile=true",
      );
    });

    expect(authSession()).toHaveBeenCalledTimes(2);
  });
});

describe("Two projects that federate the same address differently", () => {
  function oneOfEach(): Array<SSOProvider> {
    return [
      projectProvider(),
      projectOidcProvider({
        projectId: "project-2",
        project: { name: "Acme Staging" },
      }),
    ];
  }

  test("are listed under their own project names", async () => {
    projectDiscovery().mockResolvedValue(found(oneOfEach()));

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText("Acme Production")).toBeTruthy();
    expect(screen.getByText("Acme Staging")).toBeTruthy();
    expect(screen.getByText("Acme Okta")).toBeTruthy();
    expect(screen.getByText("Acme Entra ID")).toBeTruthy();
  });

  test("and the OIDC one carries its own project into the URL", async () => {
    /*
     * Both ids come out of the path, so an OIDC row that borrowed the SAML
     * project's id would start a login for the wrong project.
     */
    projectDiscovery().mockResolvedValue(found(oneOfEach()));

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Entra ID"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledWith(
        "https://oneuptime.com/identity/oidc/project-2/provider-oidc-1?mobile=true",
      );
    });
  });
});

describe("An instance whose only SSO is project OIDC", () => {
  test("has a working login screen rather than nothing at all", async () => {
    /*
     * The regression in one test: no global providers, no project SAML, one
     * project OIDC provider. This used to land on "No SSO configuration found
     * for the email", because the only endpoint the app asked was the SAML
     * one and it correctly answered that there was no SAML.
     */
    globalDiscovery().mockResolvedValue(found<GlobalSSOProvider>([]));
    projectDiscovery().mockResolvedValue(found([projectOidcProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    expect(await screen.findByText("Acme Entra ID")).toBeTruthy();
    expect(screen.queryByText(/No SSO configuration found/i)).toBeNull();
    expectNoErrorShown();
  });

  test("and the login it starts is one that can complete", async () => {
    globalDiscovery().mockResolvedValue(found<GlobalSSOProvider>([]));
    projectDiscovery().mockResolvedValue(found([projectOidcProvider()]));
    authSession().mockResolvedValue({
      status: "callback",
      url: "oneuptime://sso-callback?sso-token=abc&project-id=project-1",
    });

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Entra ID"));

    await waitFor(() => {
      expect(authSession()).toHaveBeenCalledWith(
        "https://oneuptime.com/identity/oidc/project-1/provider-oidc-1?mobile=true",
      );
    });

    expect(mockAuth.setIsAuthenticated).toHaveBeenCalledWith(true);
  });
});

/*
 * buildSsoLoginUrl refuses a project target with no project id, and that is
 * reachable: api/sso.ts maps a missing or unparseable `projectId` to "" rather
 * than dropping the provider, so a sparse discovery payload yields a tappable
 * row. Before the URL construction was wrapped, the throw escaped the async
 * onPress as an unhandled rejection: no spinner, no message, no login - the
 * row simply did nothing, forever, with nothing on screen to explain it.
 */
describe("A provider the app cannot build a URL for says so", () => {
  test("a project provider with no project id reports an error instead of doing nothing", async () => {
    projectDiscovery().mockResolvedValue(
      found([projectProvider({ projectId: "" })]),
    );

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Okta"));

    expect(
      await screen.findByText(
        "This SSO provider is misconfigured and cannot be used. Please contact your admin.",
      ),
    ).toBeTruthy();
  });

  test("it does not open an auth session with a malformed URL", async () => {
    projectDiscovery().mockResolvedValue(
      found([projectProvider({ projectId: "" })]),
    );

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Okta"));

    await waitFor(() => {
      expect(
        screen.queryByText(
          "This SSO provider is misconfigured and cannot be used. Please contact your admin.",
        ),
      ).toBeTruthy();
    });

    expect(authSession()).not.toHaveBeenCalled();
  });

  test("the user stays unauthenticated", async () => {
    projectDiscovery().mockResolvedValue(
      found([projectProvider({ projectId: "" })]),
    );

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Okta"));

    await waitFor(() => {
      expect(
        screen.queryByText(
          "This SSO provider is misconfigured and cannot be used. Please contact your admin.",
        ),
      ).toBeTruthy();
    });

    expect(mockAuth.setIsAuthenticated).not.toHaveBeenCalled();
  });
});

describe("Getting back out", () => {
  test("the provider list hands the user back to the email step", async () => {
    projectDiscovery().mockResolvedValue(found([projectProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByText("Use a different email"));

    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(screen.queryByText("Acme Okta")).toBeNull();
  });

  test("and does not leave the auth stack while doing it", async () => {
    /*
     * Backing out of a list the user reached from this screen should undo one
     * step, not throw them all the way to the password login.
     */
    projectDiscovery().mockResolvedValue(found([projectProvider()]));

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByText("Use a different email"));

    await screen.findByLabelText("Email");

    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  test("an error from the provider list does not follow the user back", async () => {
    projectDiscovery().mockResolvedValue(found([projectProvider()]));
    authSession().mockResolvedValue({
      status: "error",
      message: "Could not open the sign-in page. Please try again.",
    });

    await renderScreen();
    await submitEmail("user@acme.com");

    await fireEvent.press(await screen.findByLabelText("Acme Okta"));

    await screen.findByText(
      "Could not open the sign-in page. Please try again.",
    );

    await fireEvent.press(screen.getByText("Use a different email"));

    await screen.findByLabelText("Email");
    expectNoErrorShown();
  });

  test("the email step goes back to the password login", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByText("Back to Login"));

    await waitFor(() => {
      expect(mockNavigation.navigate).toHaveBeenCalledWith("Login");
    });
  });
});
