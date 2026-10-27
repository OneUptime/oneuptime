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
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { SignInMethods } from "../../../Types/SSO/SignInMethods";
import User from "../../../Models/DatabaseModels/User";
import API from "../../../UI/Utils/API/API";
import LoginUtil from "../../../UI/Utils/Login";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UiAnalytics from "../../../UI/Utils/Analytics";
import UserUtil from "../../../UI/Utils/User";
import ThemeUtil, { Theme } from "../../../UI/Utils/Theme";
import {
  classesWithoutDarkTheme,
  colourClassesIn,
} from "../../UI/Styles/DarkThemeCoverage";

/*
 * Every sign-in page, drawn dark - each page, and the states a person meets
 * on it: a wrong password, the second step of signing in and its backup
 * codes, single sign-on with providers to choose from, a new password being
 * typed, an email being verified, an MCP client asking for access, a
 * marketplace purchase, and the pages for a link that is wrong.
 *
 * The dark theme is Common/UI/Styles/Theme.css recolouring the light classes
 * a page already draws, once <html> carries .dark (the page's first script
 * puts it there: Common/Server/Views/Partials/Theme.ejs). A class it has no
 * rule for keeps its light colour, a white box or dark words on a dark page,
 * and nothing else would say so. So here each page's every colour class, as
 * React actually renders it - its own and those of the shared components it
 * is made of - must be one the dark theme draws (DarkThemeCoverage).
 *
 * The browser half is packages/E2E/AccountsTheme, which measures the same
 * pages' colours in Chromium.
 */

let mockSignInMethods: SignInMethods = {
  isSsoRequired: false,
  ssoProviders: [],
  hasProjectSsoProviders: false,
};

jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/SignInMethods", () => {
  return {
    __esModule: true,
    readSignInMethods: (): Promise<SignInMethods> => {
      return Promise.resolve(mockSignInMethods);
    },
    useSignInMethods: (
      known?: SignInMethods | undefined,
    ): {
      signInMethods: SignInMethods;
      isReading: boolean;
      readAgain: () => void;
    } => {
      return {
        signInMethods: known || mockSignInMethods,
        isReading: false,
        readAgain: (): void => {
          return undefined;
        },
      };
    },
  };
});

jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/FirstAccount", () => {
  return (
    jest.requireActual(
      "./FirstAccountStandIn",
    ) as typeof import("./FirstAccountStandIn")
  ).serverWithAccounts();
});

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Config",
    ) as typeof import("../../../UI/Config")),
    __esModule: true,
    BILLING_ENABLED: false,
    CAPTCHA_ENABLED: false,
    // Sign in with Microsoft, where the server offers it, is drawn too.
    MicrosoftSignInClientId: "accounts-dark-theme",
  };
});

// Page chrome that reads the instance's license on mount.
jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

// Registers the Accounts locale resources on the shared i18next instance.
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import Footer from "../../../../App/FeatureSet/Accounts/src/Components/Footer/Footer";
import PasswordRequirements from "../../../../App/FeatureSet/Accounts/src/Components/PasswordRequirements/PasswordRequirements";
import VerifyEmailPending from "../../../../App/FeatureSet/Accounts/src/Components/VerifyEmailPending/VerifyEmailPending";
import ForbiddenPage from "../../../../App/FeatureSet/Accounts/src/Pages/Forbidden";
import ForgotPasswordPage from "../../../../App/FeatureSet/Accounts/src/Pages/ForgotPassword";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import LoginWithSSOPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";
import MarketplacePurchasePage from "../../../../App/FeatureSet/Accounts/src/Pages/MarketplacePurchase";
import McpAuthorizePage from "../../../../App/FeatureSet/Accounts/src/Pages/McpAuthorize";
import MobilePasskeyPage from "../../../../App/FeatureSet/Accounts/src/Pages/MobilePasskey";
import NotFoundPage from "../../../../App/FeatureSet/Accounts/src/Pages/NotFound";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";
import ResetPasswordPage from "../../../../App/FeatureSet/Accounts/src/Pages/ResetPassword";
import VerifyEmailPage from "../../../../App/FeatureSet/Accounts/src/Pages/VerifyEmail";

const USER_JSON: JSONObject = {
  _id: "33333333-3333-4333-8333-333333333333",
  email: "ada@acme.example",
  name: "Ada Lovelace",
};

const TOTP: JSONObject = {
  _id: "11111111-1111-4111-8111-111111111111",
  name: "Phone",
};

const SECURITY_KEY: JSONObject = {
  _id: "22222222-2222-4222-8222-222222222222",
  name: "YubiKey",
};

const BACKUP_CODES: Array<string> = [
  "4f7k-2m9q",
  "8x3n-6c1v",
  "q2w9-r5t7",
  "z8m4-k3j6",
];

const MCP_TICKET: string = `v1.${"cGF5bG9hZA".repeat(4)}.${"s".repeat(43)}`;

// A verification link's token: a uuid, as the server sends it.
const EMAIL_TOKEN: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

// The fields of a ModelForm are laid out in an effect, after the first paint.
const formFieldsDrawn: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(document.querySelector("input")).not.toBeNull();
  });
};

const PROVIDERS: SignInMethods["ssoProviders"] = [
  {
    type: "GlobalSSO",
    id: "44444444-4444-4444-8444-444444444444",
    name: "Okta",
    description: "Everyone at Acme",
  },
  {
    type: "GlobalOIDC",
    id: "55555555-5555-4555-8555-555555555555",
    name: "Google Workspace",
    description: "",
  },
] as SignInMethods["ssoProviders"];

// What the next password sign-in (POST /identity/login) is answered.
let loginAnswer: "wrong" | JSONObject = {};
// What a second step's own calls are answered.
let secondStepAnswer: JSONObject = {};
let apiGetAnswer: (url: string) => HTTPResponse<JSONObject> | HTTPErrorResponse =
  (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, {}, {});
  };
let apiPostAnswer: (
  url: string,
) => HTTPResponse<JSONObject> | HTTPErrorResponse = (): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, {}, {});
};

const setupUser: () => UserEvent = (): UserEvent => {
  return userEvent.setup({ delay: null });
};

const draw: (page: React.ReactElement, address?: string) => void = (
  page: React.ReactElement,
  address?: string,
): void => {
  render(
    <MemoryRouter initialEntries={[address || "/accounts"]}>
      <div className="m-auto flex min-h-screen flex-col">
        <div className="flex flex-grow flex-col justify-center">{page}</div>
        <Footer />
      </div>
    </MemoryRouter>,
  );
};

const signInWithPassword: () => Promise<void> = async (): Promise<void> => {
  const user: UserEvent = setupUser();

  await user.type(await screen.findByTestId("email"), "ada@acme.example");
  await user.type(screen.getByTestId("password"), "correct-horse-battery");

  await act(async () => {
    await user.click(screen.getByTestId("Sign in"));
  });
};

// Every colour class on screen that a dark page would draw in light colours.
const lightOnlyColours: () => Array<string> = (): Array<string> => {
  return classesWithoutDarkTheme(colourClassesIn(document.body));
};

beforeEach(() => {
  mockSignInMethods = {
    isSsoRequired: false,
    ssoProviders: [],
    hasProjectSsoProviders: false,
  };
  loginAnswer = {};
  secondStepAnswer = { token: "session-token" };
  apiGetAnswer = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, [] as unknown as JSONObject, {});
  };
  apiPostAnswer = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(
      200,
      { ...USER_JSON, _miscData: secondStepAnswer },
      {},
    );
  };

  window.localStorage.clear();
  window.localStorage.setItem("oneuptime-dashboard-theme", "dark");
  ThemeUtil.initialize();

  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
  jest.spyOn(LoginUtil, "login").mockImplementation(() => {});

  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
      if (loginAnswer === "wrong") {
        throw new HTTPErrorResponse(
          400,
          { message: "Invalid email or password." },
          {},
        );
      }

      const response: ModelAPIHttpResponse<User> =
        new ModelAPIHttpResponse<User>(200, USER_JSON, {});

      response.miscData = loginAnswer;

      return response;
    });

  jest.spyOn(API, "get").mockImplementation(
    async (options: {
      url?: { toString: () => string } | undefined;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      return apiGetAnswer(options.url?.toString() || "");
    },
  );

  jest.spyOn(API, "post").mockImplementation(
    async (options: {
      url?: { toString: () => string } | undefined;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      return apiPostAnswer(options.url?.toString() || "");
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute("class");
  window.history.replaceState({}, "", "/");
});

describe("the page these suites draw", () => {
  test("is dark: the person picked Dark", () => {
    expect(ThemeUtil.getAppliedTheme()).toBe(Theme.Dark);
  });
});

describe("signing in", () => {
  test("the sign-in page: its form, the other ways in (single sign-on, Microsoft, a passkey) and the footer", async () => {
    draw(<LoginPage />, "/accounts/login");

    expect(await screen.findByTestId("email")).toBeInTheDocument();
    expect(screen.getByTestId("microsoft-sign-in")).toBeInTheDocument();
    expect(screen.getByTestId("passkey-login")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("a wrong password: the alert at the top of the form", async () => {
    loginAnswer = "wrong";
    draw(<LoginPage />, "/accounts/login");

    await signInWithPassword();

    expect(
      await screen.findByText("Invalid email or password."),
    ).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("the second step: the methods to pick from", async () => {
    loginAnswer = {
      totpAuthList: [TOTP],
      webAuthnList: [SECURITY_KEY],
      backupCodeCount: 8,
    };
    draw(<LoginPage />, "/accounts/login");

    await signInWithPassword();

    expect(await screen.findByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("YubiKey")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("the second step: a code from the authenticator app, and the ways out", async () => {
    loginAnswer = { totpAuthList: [TOTP], webAuthnList: [], backupCodeCount: 8 };
    draw(<LoginPage />, "/accounts/login");

    await signInWithPassword();

    const user: UserEvent = setupUser();

    await user.click(await screen.findByText("Phone"));

    expect(await screen.findByTestId("code")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);

    await user.click(screen.getByText("Lost access to your authenticator?"));

    expect(await screen.findByTestId("backup-code")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("an account with no backup codes, locked out of its second step", async () => {
    loginAnswer = { totpAuthList: [TOTP], webAuthnList: [], backupCodeCount: 0 };
    draw(<LoginPage />, "/accounts/login");

    await signInWithPassword();

    const user: UserEvent = setupUser();

    await user.click(
      await screen.findByText("Lost access to your authenticator?"),
    );

    expect(await screen.findByTestId("no-backup-codes")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("a second step the administrator requires: the QR code to scan", async () => {
    loginAnswer = {
      twoFactorEnrolmentRequired: true,
      twoFactorAuthId: TOTP["_id"] as string,
      twoFactorOtpUrl: "otpauth://totp/OneUptime:ada?secret=ABCDEFGH",
    };
    draw(<LoginPage />, "/accounts/login");

    await signInWithPassword();

    expect(await screen.findByTestId("enrolment-code")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("the backup codes an enrolment minted, shown once", async () => {
    loginAnswer = { totpAuthList: [TOTP], webAuthnList: [], backupCodeCount: 0 };
    secondStepAnswer = { token: "session-token", backupCodes: BACKUP_CODES };
    draw(<LoginPage />, "/accounts/login");

    await signInWithPassword();

    const user: UserEvent = setupUser();

    await user.click(await screen.findByText("Phone"));
    await user.type(await screen.findByTestId("code"), "123456");

    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });

    expect(await screen.findByTestId("backup-codes-list")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("the offer of backup codes to an account that has none", async () => {
    loginAnswer = { totpAuthList: [TOTP], webAuthnList: [], backupCodeCount: 0 };
    draw(<LoginPage />, "/accounts/login");

    await signInWithPassword();

    const user: UserEvent = setupUser();

    await user.click(await screen.findByText("Phone"));
    await user.type(await screen.findByTestId("code"), "123456");

    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });

    expect(
      await screen.findByTestId("generate-backup-codes"),
    ).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });
});

describe("single sign-on", () => {
  test("the email lookup", async () => {
    draw(<LoginWithSSOPage />, "/accounts/sso");

    expect(await screen.findByTestId("email")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("the whole server requiring SSO: its providers, then the lookup", async () => {
    mockSignInMethods = {
      isSsoRequired: true,
      ssoProviders: PROVIDERS,
      hasProjectSsoProviders: true,
    };
    draw(<LoginPage />, "/accounts/login");

    expect(await screen.findByText("Okta")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("one provider, the page's one filled button", async () => {
    mockSignInMethods = {
      isSsoRequired: true,
      ssoProviders: [PROVIDERS[0]!],
      hasProjectSsoProviders: false,
    };
    draw(<LoginPage />, "/accounts/login");

    expect(await screen.findByText("Okta")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });
});

describe("signing up", () => {
  test("the sign-up form, with the password guidance", async () => {
    draw(<RegisterPage />, "/accounts/register");

    expect(await screen.findByTestId("email")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test.each([
    ["no password yet", ""],
    ["too short", "short"],
    ["predictable", "aaaaaaaaaaaaaaaa"],
    ["good", "violet otter tango 42!"],
  ])("the password guidance: %s", (_state: string, password: string) => {
    render(<PasswordRequirements id="password-guidance" password={password} />);

    expect(lightOnlyColours()).toEqual([]);
  });

  test("the guidance with an error from the server", () => {
    render(
      <PasswordRequirements
        id="password-guidance"
        password="violet otter tango 42!"
        error="This password has appeared in a data breach."
      />,
    );

    expect(lightOnlyColours()).toEqual([]);
  });

  test("waiting for the email to be verified", () => {
    draw(
      <VerifyEmailPending
        email="ada@acme.example"
        resendToken="resend-token"
        resendAvailableInSeconds={30}
        onUseDifferentEmail={(): void => {}}
      />,
    );

    expect(lightOnlyColours()).toEqual([]);
  });
});

describe("passwords and email links", () => {
  test("forgot password", async () => {
    draw(<ForgotPasswordPage />, "/accounts/forgot-password");

    expect(await screen.findByText("Forgot your password")).toBeInTheDocument();
    await formFieldsDrawn();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("reset password", async () => {
    draw(<ResetPasswordPage />, "/accounts/reset-password");

    expect(await screen.findByText("Reset your password")).toBeInTheDocument();
    await formFieldsDrawn();
    expect(lightOnlyColours()).toEqual([]);
  });

  test.each([
    ["verified", true],
    ["a link that no longer works", false],
  ])("verify email: %s", async (_state: string, verified: boolean) => {
    window.history.replaceState(
      {},
      "",
      `/accounts/verify-email/${EMAIL_TOKEN}`,
    );
    jest.spyOn(ModelAPI, "createOrUpdate").mockImplementation(async () => {
      if (!verified) {
        throw new HTTPErrorResponse(
          400,
          { message: "This link has expired." },
          {},
        );
      }

      return new ModelAPIHttpResponse<User>(200, {}, {});
    });

    draw(<VerifyEmailPage />, `/accounts/verify-email/${EMAIL_TOKEN}`);

    expect(
      await screen.findByText(
        verified
          ? "Your email is verified."
          : "This verification link is no longer valid",
      ),
    ).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });
});

describe("pages other apps send a person to", () => {
  test.each([
    ["write access asked for", "write", false],
    ["a client on this device", "read", true],
  ])(
    "an MCP client asking for access: %s",
    async (_state: string, access: string, isLoopback: boolean) => {
      window.history.replaceState(
        {},
        "",
        `/accounts/mcp-authorize?request=${MCP_TICKET}`,
      );
      jest
        .spyOn(Navigation, "getQueryStringByName")
        .mockImplementation((name: string): string | null => {
          return name === "request" ? MCP_TICKET : null;
        });
      apiPostAnswer = (): HTTPResponse<JSONObject> => {
        return new HTTPResponse<JSONObject>(
          200,
          {
            client: {
              name: "Claude Desktop",
              verifiedHost: isLoopback ? null : "claude.ai",
              uri: null,
              redirectTarget: isLoopback ? "127.0.0.1:53682" : "claude.ai",
              isLoopbackRedirect: isLoopback,
            },
            requestedAccess: access,
            user: { email: "ada@acme.example", name: "Ada" },
            projects: [
              {
                id: "66666666-6666-4666-8666-666666666666",
                name: "Acme Production",
                isEligible: true,
                refusal: null,
              },
            ],
          },
          {},
        );
      };

      draw(<McpAuthorizePage />, "/accounts/mcp-authorize");

      expect(await screen.findByTestId("mcp-authorize-client")).toBeInTheDocument();
      expect(lightOnlyColours()).toEqual([]);
    },
  );

  test("an MCP link that is wrong", async () => {
    jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue(null);

    draw(<McpAuthorizePage />, "/accounts/mcp-authorize");

    expect(
      await screen.findByTestId("mcp-authorize-problem"),
    ).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("a marketplace purchase choosing its project", async () => {
    apiPostAnswer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          marketplace: "AWS",
          marketplaceName: "AWS Marketplace",
          status: "Pending",
          buyerEmail: "ada@acme.example",
          marketplacePlan: "OneUptime Growth",
          signedInEmail: "ada@acme.example",
          projects: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              name: "Acme Production",
              isEligible: true,
            },
          ],
          plans: [
            {
              planId: "growth",
              name: "Growth",
              monthlyPricePerUserInUSD: 22,
              isCustomPricing: false,
            },
          ],
          canCreateProject: true,
        },
        {},
      );
    };

    draw(<MarketplacePurchasePage />, "/accounts/marketplace");

    expect(await screen.findByText("AWS Marketplace")).toBeInTheDocument();
    expect(lightOnlyColours()).toEqual([]);
  });

  test("signing in to the mobile app with a passkey, from a link that is wrong", () => {
    draw(<MobilePasskeyPage />, "/accounts/mobile-passkey");

    expect(lightOnlyColours()).toEqual([]);
  });

  test.each([
    ["not found", <NotFoundPage key="not-found" />],
    ["forbidden", <ForbiddenPage key="forbidden" />],
  ])("the %s page", (_name: string, page: React.ReactElement) => {
    draw(page, "/accounts/nothing-here");

    expect(lightOnlyColours()).toEqual([]);
  });
});
