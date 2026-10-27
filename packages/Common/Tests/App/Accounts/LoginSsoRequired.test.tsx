import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  SSO_REQUIRED_SIGN_IN_MESSAGE,
  SSO_REQUIRED_SIGN_UP_MESSAGE,
} from "../../../Types/SSO/SignInMethods";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  getSignInOptionClassName,
  SIGN_IN_OPTION_PRIMARY_CLASS,
} from "../../../UI/Components/SignInOption/SignInOptionStyle";
import LoginUtil from "../../../UI/Utils/Login";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UiAnalytics from "../../../UI/Utils/Analytics";
import UserUtil from "../../../UI/Utils/User";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import LoginWithSSOPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";

/*
 * WHILE THE SERVER REQUIRES SSO, THE SIGN-IN PAGES OFFER ONLY SSO (#5193).
 *
 * "When 'Require SSO for Login' is enabled, only the configured SSO login
 * option should be displayed": the sign-in page still showed the email
 * field, its "Login with SSO" lookup, "Or continue with email" and "Sign in
 * with password" - and the lookup only finds a project's own providers, so
 * typing an address under an instance-wide one ended in "No SSO
 * configuration found".
 *
 * The sign-in page (/accounts/login), the single sign-on page
 * (/accounts/sso) and the sign-up page (/accounts/register) read how the
 * server signs people in (GET /identity/sign-in-methods) before they draw
 * anything of their own. While SSO is required they show a button per
 * instance-wide provider - the page's filled button when it is the only way
 * in - and the email lookup only when some project has a provider of its
 * own to find. No password, passkey, Microsoft, sign-up or "forgot
 * password". Master admins keep their way in, the password form at
 * /accounts/admin-login. A read that fails leaves the page as it is when SSO
 * is not required: the server refuses a password anyway, and a page told so
 * reads again.
 *
 * The pages are rendered for real, with the real Accounts translations and
 * the real read of the sign-in methods; API.get answers it.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const url: { default: { fromString: (value: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL") as {
      default: { fromString: (value: string) => unknown };
    };

  const mocked: Record<string, unknown> = {
    ...actual,
    BILLING_ENABLED: false,
    IS_ENTERPRISE_EDITION: false,
  };

  Object.defineProperty(mocked, "IDENTITY_URL", {
    get: (): unknown => {
      return url.default.fromString("https://oneuptime.example.com/identity");
    },
  });

  // Sign in with Microsoft is offered on this server, so its absence is seen.
  Object.defineProperty(mocked, "MicrosoftSignInClientId", {
    get: (): string => {
      return "microsoft-client";
    },
  });

  return mocked;
});

jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="edition-label" />;
    },
  };
});

/*
 * A self-hosted server that has accounts, and says so at once: the sign-up
 * form waits for that answer (FirstAccountStandIn). While SSO is required
 * the sign-up page offers SSO without asking.
 */
jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/FirstAccount", () => {
  return (
    jest.requireActual(
      "./FirstAccountStandIn",
    ) as typeof import("./FirstAccountStandIn")
  ).serverWithAccounts();
});

const IDENTITY_ORIGIN: string = "https://oneuptime.example.com/identity";
const OKTA_ID: string = "11111111-1111-4111-8111-111111111111";
const GOOGLE_ID: string = "22222222-2222-4222-8222-222222222222";
const WHATABURGER_ID: string = "33333333-3333-4333-8333-333333333333";

const OKTA: JSONObject = {
  type: SsoProviderType.GlobalSSO,
  id: OKTA_ID,
  name: "Okta",
  description: "Sign in with Okta",
};

const GOOGLE: JSONObject = {
  type: SsoProviderType.GlobalOIDC,
  id: GOOGLE_ID,
  name: "Google Workspace",
  description: "",
};

// The customer's provider in #5193: a name and a description of its own.
const WHATABURGER: JSONObject = {
  type: SsoProviderType.GlobalSSO,
  id: WHATABURGER_ID,
  name: "Login with Whataburger SSO",
  description: "Use your WBHQ Email Address",
};

type Answer = { status: number; data: JSONObject | Array<JSONObject> | string };

const required: (
  providers: Array<JSONObject>,
  hasProjectSsoProviders?: boolean,
) => Answer = (
  providers: Array<JSONObject>,
  hasProjectSsoProviders?: boolean,
): Answer => {
  return {
    status: 200,
    data: {
      isSsoRequired: true,
      ssoProviders: providers,
      hasProjectSsoProviders: Boolean(hasProjectSsoProviders),
    },
  };
};

const NOT_REQUIRED: Answer = {
  status: 200,
  data: {
    isSsoRequired: false,
    ssoProviders: [],
    hasProjectSsoProviders: false,
  },
};

let signInMethodsAnswer: Answer;
// What the email lookup of a project's SAML providers finds.
let projectProvidersAnswer: Answer;
// Held until the test lets it answer, when it says so.
let holdSignInMethods: Promise<void> | null;
let requestedUrls: Array<string>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

const toResponse: (
  answer: Answer,
) => HTTPResponse<JSONObject> | HTTPErrorResponse = (
  answer: Answer,
): HTTPResponse<JSONObject> | HTTPErrorResponse => {
  if (answer.status >= 400) {
    return new HTTPErrorResponse(answer.status, answer.data as JSONObject, {});
  }

  return new HTTPResponse<JSONObject>(
    answer.status,
    answer.data as JSONObject,
    {},
  );
};

const renderPage: (page: React.ReactElement) => Promise<void> = async (
  page: React.ReactElement,
): Promise<void> => {
  await act(async () => {
    render(<MemoryRouter>{page}</MemoryRouter>);
  });
};

const providerButtons: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("sso-provider");
};

const signInWith: (name: string, locale?: JSONObject) => string = (
  name: string,
  locale?: JSONObject,
): string => {
  return (
    ((locale || english) as typeof english).sso.signInWithProvider as string
  ).replace("{{name}}", name);
};

// Everything the page shows when SSO is not required, and must not now.
const expectNothingButSso: () => void = (): void => {
  expect(screen.queryByTestId("password")).not.toBeInTheDocument();
  expect(screen.queryByTestId("passkey-login")).not.toBeInTheDocument();
  expect(screen.queryByTestId("sso-login")).not.toBeInTheDocument();
  expect(screen.queryByTestId("microsoft-sign-in")).not.toBeInTheDocument();
  expect(screen.queryByTestId("password-login")).not.toBeInTheDocument();
  expect(
    screen.queryByText(english.login.forgotPassword),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: english.sso.registerLink }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(english.sso.signInWithPassword),
  ).not.toBeInTheDocument();
};

const navigatedTo: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map(
    (call: Parameters<typeof Navigation.navigate>) => {
      return call[0].toString();
    },
  );
};

beforeEach(() => {
  signInMethodsAnswer = NOT_REQUIRED;
  projectProvidersAnswer = {
    status: 400,
    data: { message: "No SSO config found for this user" },
  };
  holdSignInMethods = null;
  requestedUrls = [];

  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue("");
  jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
  jest.spyOn(LoginUtil, "login").mockImplementation(() => {});

  jest
    .spyOn(API, "get")
    .mockImplementation(
      async (
        options: Parameters<typeof API.get>[0],
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url?.toString() || "";
        requestedUrls.push(url);

        if (url.endsWith("/sign-in-methods")) {
          if (holdSignInMethods) {
            await holdSignInMethods;
          }

          return toResponse(signInMethodsAnswer);
        }

        if (url.includes("/service-provider-login?")) {
          return toResponse(projectProvidersAnswer);
        }

        // Every other read - an email's OIDC providers - finds nothing.
        return toResponse({
          status: 400,
          data: { message: "No SSO config found for this user" },
        });
      },
    );
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18n.changeLanguage("en");
});

describe("the sign-in page while the server requires SSO", () => {
  test("one instance-wide provider: its button is the page's filled button, and nothing else is offered", async () => {
    signInMethodsAnswer = required([OKTA]);

    await renderPage(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: english.login.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(english.sso.requiredSubtitle)).toBeInTheDocument();

    const buttons: Array<HTMLElement> = providerButtons();

    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(signInWith("Okta"));
    expect(buttons[0]!.className).toBe(SIGN_IN_OPTION_PRIMARY_CLASS);

    // No email to type either: nothing to look up.
    expect(screen.queryByTestId("email")).not.toBeInTheDocument();
    expect(
      screen.queryByText(english.sso.globalProvidersDivider),
    ).not.toBeInTheDocument();
    expectNothingButSso();
    // The page still says which edition it is, as the sign-in page does.
    expect(screen.getByTestId("edition-label")).toBeInTheDocument();
    // One read, of how the server signs people in.
    expect(requestedUrls).toEqual([`${IDENTITY_ORIGIN}/sign-in-methods`]);
  });

  test("the provider's button starts its sign-in on the identity server", async () => {
    signInMethodsAnswer = required([OKTA]);

    await renderPage(<LoginPage />);
    await act(async () => {
      await userEvent.click(providerButtons()[0]!);
    });

    expect(navigatedTo()).toEqual([`${IDENTITY_ORIGIN}/global-sso/${OKTA_ID}`]);
  });

  test("several providers: one outlined button each, in the server's order, each starting its own sign-in", async () => {
    signInMethodsAnswer = required([GOOGLE, OKTA]);

    await renderPage(<LoginPage />);

    const buttons: Array<HTMLElement> = providerButtons();

    expect(
      buttons.map((button: HTMLElement): string | null => {
        return button.textContent;
      }),
    ).toEqual([signInWith("Google Workspace"), signInWith("Okta")]);

    for (const button of buttons) {
      expect(button.className).toBe(getSignInOptionClassName("ready"));
    }

    await act(async () => {
      await userEvent.click(buttons[0]!);
    });

    expect(navigatedTo()).toEqual([
      `${IDENTITY_ORIGIN}/global-oidc/${GOOGLE_ID}`,
    ]);
    expectNothingButSso();
  });

  test("a provider described in its admin's words: its name on the button, the words under it", async () => {
    signInMethodsAnswer = required([WHATABURGER]);

    await renderPage(<LoginPage />);

    const button: HTMLElement = providerButtons()[0]!;
    const description: HTMLElement = screen.getByText(
      "Use your WBHQ Email Address",
    );

    expect(button).toHaveTextContent("Login with Whataburger SSO");
    expect(button).not.toHaveTextContent(signInWith("Login"));
    // Read out with its button.
    expect(button.getAttribute("aria-describedby")).toBe(description.id);
    expect(description).toHaveAttribute("dir", "auto");
  });

  test("a project with a provider of its own: the email lookup stays, under the instance-wide providers", async () => {
    signInMethodsAnswer = required([OKTA], true);

    await renderPage(<LoginPage />);

    expect(screen.getByTestId("email")).toBeInTheDocument();
    expect(
      screen.getByText(english.sso.globalProvidersTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(english.sso.globalProvidersDivider),
    ).toBeInTheDocument();
    // The lookup's button is the filled one; the provider is outlined beside it.
    expect(providerButtons()[0]!.className).toBe(
      getSignInOptionClassName("ready"),
    );
    expectNothingButSso();
  });

  test("only projects' own providers: the email lookup alone", async () => {
    signInMethodsAnswer = required([], true);

    await renderPage(<LoginPage />);

    expect(screen.getByTestId("email")).toBeInTheDocument();
    expect(providerButtons()).toHaveLength(0);
    expect(
      screen.queryByText(english.sso.globalProvidersDivider),
    ).not.toBeInTheDocument();
    expectNothingButSso();
  });

  test("nothing to sign in with yet: it says so, and asks for nothing", async () => {
    signInMethodsAnswer = required([]);

    await renderPage(<LoginPage />);

    expect(screen.getByTestId("sso-not-set-up")).toHaveTextContent(
      english.sso.requiredNotSetUp,
    );
    expect(screen.queryByTestId("email")).not.toBeInTheDocument();
    expect(providerButtons()).toHaveLength(0);
    expectNothingButSso();
  });

  test("draws nothing of its own until it knows: never a password form it then takes away", async () => {
    signInMethodsAnswer = required([OKTA]);
    let answer: () => void = (): void => {
      return undefined;
    };
    holdSignInMethods = new Promise<void>((resolve: () => void) => {
      answer = resolve;
    });

    await renderPage(<LoginPage />);

    expect(screen.queryByTestId("email")).not.toBeInTheDocument();
    expect(screen.queryByTestId("password")).not.toBeInTheDocument();
    expect(providerButtons()).toHaveLength(0);

    await act(async () => {
      answer();
    });

    expect(providerButtons()).toHaveLength(1);
    expect(screen.queryByTestId("password")).not.toBeInTheDocument();
  });

  test("in German: the words of the page and of the button", async () => {
    await i18n.changeLanguage("de");
    signInMethodsAnswer = required([OKTA]);

    await renderPage(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: german.login.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(german.sso.requiredSubtitle)).toBeInTheDocument();
    expect(providerButtons()[0]).toHaveTextContent(signInWith("Okta", german));
    expect(german.sso.requiredSubtitle).not.toBe(english.sso.requiredSubtitle);
  });

  test("a signed-in visitor is sent on once, by the sign-in page alone", async () => {
    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(true);
    signInMethodsAnswer = required([OKTA]);

    await renderPage(<LoginPage />);

    expect(navigatedTo()).toHaveLength(1);
  });
});

describe("the sign-in page while the server does not require SSO", () => {
  test("the password form and every other way in, as always", async () => {
    await renderPage(<LoginPage />);

    expect(screen.getByTestId("email")).toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(screen.getByTestId("sso-login")).toBeInTheDocument();
    expect(screen.getByTestId("passkey-login")).toBeInTheDocument();
    expect(screen.getByTestId("microsoft-sign-in")).toBeInTheDocument();
    expect(providerButtons()).toHaveLength(0);
  });

  test.each([
    ["a 404 from a proxy", { status: 404, data: { message: "Not found" } }],
    ["a server error", { status: 500, data: { message: "boom" } }],
    ["a page that is not an answer", { status: 200, data: "<html></html>" }],
    ["an answer of some other shape", { status: 200, data: [] }],
  ])(
    "a read that fails (%s) leaves the page as it is without SSO",
    async (_name: string, answer: Answer) => {
      signInMethodsAnswer = answer;

      await renderPage(<LoginPage />);

      expect(screen.getByTestId("email")).toBeInTheDocument();
      expect(screen.getByTestId("password")).toBeInTheDocument();
    },
  );

  test("told by the server that SSO is required now, the page reads again and offers only SSO", async () => {
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<never> => {
        throw new Error(SSO_REQUIRED_SIGN_IN_MESSAGE);
      });

    await renderPage(<LoginPage />);

    // Turned on while the page was open.
    signInMethodsAnswer = required([OKTA]);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.type(screen.getByTestId("email"), "ada@example.com");
    await user.type(screen.getByTestId("password"), "correct horse battery");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });

    expect(await screen.findByTestId("sso-provider")).toHaveTextContent(
      signInWith("Okta"),
    );
    expect(screen.queryByTestId("password")).not.toBeInTheDocument();
    expect(
      requestedUrls.filter((url: string): boolean => {
        return url.endsWith("/sign-in-methods");
      }),
    ).toHaveLength(2);
  });

  test("any other refusal reads nothing again", async () => {
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<never> => {
        throw new Error("Invalid login: Email or password does not match.");
      });

    await renderPage(<LoginPage />);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.type(screen.getByTestId("email"), "ada@example.com");
    await user.type(screen.getByTestId("password"), "a wrong password");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });

    expect(
      await screen.findByText(
        "Invalid login: Email or password does not match.",
      ),
    ).toBeInTheDocument();
    expect(requestedUrls).toEqual([`${IDENTITY_ORIGIN}/sign-in-methods`]);
  });
});

describe("the master admins' sign-in (/accounts/admin-login)", () => {
  test("while SSO is required: the password form alone, said to be theirs", async () => {
    signInMethodsAnswer = required([OKTA]);

    await renderPage(<LoginPage isMasterAdminSignIn={true} />);

    expect(
      screen.getByRole("heading", { name: english.adminLogin.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(english.adminLogin.subtitle)).toBeInTheDocument();
    expect(screen.getByTestId("email")).toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(screen.getByText(english.login.forgotPassword)).toBeInTheDocument();

    // SSO stays one click away; nothing the server would refuse is offered.
    expect(screen.getByTestId("sso-login")).toHaveAttribute(
      "href",
      "/accounts/sso",
    );
    expect(screen.queryByTestId("passkey-login")).not.toBeInTheDocument();
    expect(screen.queryByTestId("microsoft-sign-in")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: english.login.registerLink }),
    ).not.toBeInTheDocument();
    expect(providerButtons()).toHaveLength(0);
  });

  test("a refusal there reads nothing again: the page stays the master admins'", async () => {
    signInMethodsAnswer = required([OKTA]);
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<never> => {
        throw new Error(SSO_REQUIRED_SIGN_IN_MESSAGE);
      });

    await renderPage(<LoginPage isMasterAdminSignIn={true} />);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.type(screen.getByTestId("email"), "ada@example.com");
    await user.type(screen.getByTestId("password"), "not a master admin");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });

    expect(
      await screen.findByText(SSO_REQUIRED_SIGN_IN_MESSAGE),
    ).toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(requestedUrls).toEqual([`${IDENTITY_ORIGIN}/sign-in-methods`]);
  });

  test("while SSO is not required: the sign-in page as everyone sees it", async () => {
    await renderPage(<LoginPage isMasterAdminSignIn={true} />);

    expect(
      screen.getByRole("heading", { name: english.login.title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("passkey-login")).toBeInTheDocument();
    expect(screen.getByTestId("microsoft-sign-in")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: english.login.registerLink }),
    ).toBeInTheDocument();
  });
});

describe("the single sign-on page (/accounts/sso) while the server requires SSO", () => {
  test("offers the same, read once, with no way back to a password and no sign-up", async () => {
    signInMethodsAnswer = required([OKTA]);

    await renderPage(<LoginWithSSOPage />);

    expect(
      screen.getByRole("heading", { name: english.login.title }),
    ).toBeInTheDocument();
    expect(providerButtons()).toHaveLength(1);
    expect(providerButtons()[0]!.className).toBe(SIGN_IN_OPTION_PRIMARY_CLASS);
    expectNothingButSso();
    expect(requestedUrls).toEqual([`${IDENTITY_ORIGIN}/sign-in-methods`]);
  });

  test("its email lookup, kept for projects' own providers, has no way back to a password under it", async () => {
    signInMethodsAnswer = required([OKTA], true);

    await renderPage(<LoginWithSSOPage />);

    expect(screen.getByTestId("email")).toBeInTheDocument();
    expect(screen.getByTestId("Sign in with SSO")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-in-options")).not.toBeInTheDocument();
    expect(screen.queryByTestId("password-login")).not.toBeInTheDocument();
  });

  test("its email lookup finds a project's providers, and starts one's sign-in", async () => {
    signInMethodsAnswer = required([OKTA], true);
    projectProvidersAnswer = {
      status: 200,
      data: [
        {
          _id: WHATABURGER_ID,
          name: "Acme SAML",
          projectId: OKTA_ID,
          project: { _id: OKTA_ID, name: "Acme" },
        },
      ],
    };

    await renderPage(<LoginWithSSOPage />);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.type(screen.getByTestId("email"), "ada@example.com");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in with SSO"));
    });

    /*
     * Its one provider, under the project's name, drawn as the page's
     * filled button - the look of the instance-wide providers' buttons.
     */
    const button: HTMLElement = await screen.findByRole("button", {
      name: signInWith("Acme SAML"),
    });

    expect(screen.getByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(button.className).toBe(SIGN_IN_OPTION_PRIMARY_CLASS);

    await act(async () => {
      await user.click(button);
    });

    expect(navigatedTo()).toEqual([
      `${IDENTITY_ORIGIN}/sso/${OKTA_ID}/${WHATABURGER_ID}`,
    ]);
  });

  /*
   * The screenshot in #5193: "No SSO configuration found for the email:
   * <address>" above an empty field saying "Email is required." The page
   * gave way to a loader while it looked the address up, and the form came
   * back without it.
   */
  test("an address that finds no project's provider stays in the field, under the message that names it", async () => {
    signInMethodsAnswer = required([WHATABURGER], true);

    await renderPage(<LoginWithSSOPage />);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.type(screen.getByTestId("email"), "bgssteeph@wbhq.com");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in with SSO"));
    });

    expect(
      await screen.findByText(
        english.sso.noConfigForEmail.replace("{{email}}", "bgssteeph@wbhq.com"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("email")).toHaveValue("bgssteeph@wbhq.com");
    // The instance-wide provider is still offered above it.
    expect(
      screen.getByRole("button", { name: "Login with Whataburger SSO" }),
    ).toBeInTheDocument();
  });

  test("while SSO is not required: the email form, the way back to a password, and sign-up", async () => {
    await renderPage(<LoginWithSSOPage />);

    expect(
      screen.getByRole("heading", { name: english.sso.title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("email")).toBeInTheDocument();
    expect(screen.getByTestId("password-login")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: english.sso.registerLink }),
    ).toBeInTheDocument();
  });
});

describe("the sign-up page (/accounts/register) while the server requires SSO", () => {
  test("offers SSO instead of a form that would only be refused", async () => {
    signInMethodsAnswer = required([OKTA]);

    await renderPage(<RegisterPage />);

    expect(providerButtons()).toHaveLength(1);
    expect(screen.queryByTestId("name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("email")).not.toBeInTheDocument();
    expectNothingButSso();
  });

  test("the sign-up form as before while SSO is not required", async () => {
    await renderPage(<RegisterPage />);

    expect(screen.getByTestId("email")).toBeInTheDocument();
    expect(screen.getByTestId("name")).toBeInTheDocument();
    expect(providerButtons()).toHaveLength(0);
  });

  test("told by the server that SSO is required now, it reads again and offers SSO", async () => {
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<never> => {
        throw new Error(SSO_REQUIRED_SIGN_UP_MESSAGE);
      });

    await renderPage(<RegisterPage />);

    signInMethodsAnswer = required([OKTA]);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.type(screen.getByTestId("email"), "newcomer@example.com");
    await user.type(screen.getByTestId("name"), "Newcomer");
    await user.type(
      screen.getByTestId("password"),
      "a long enough passphrase here",
    );
    await user.type(
      screen.getByTestId("confirmPassword"),
      "a long enough passphrase here",
    );
    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: english.register.submitButton }),
      );
    });

    expect(await screen.findByTestId("sso-provider")).toBeInTheDocument();
  });
});
