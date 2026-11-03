import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import { SignInMethods } from "../../../Types/SSO/SignInMethods";
import { MAGIC_LINK_EXPIRY_MINUTES } from "../../../Types/Accounts/MagicLink";
import LoginUtil from "../../../UI/Utils/Login";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import User from "../../../Models/DatabaseModels/User";
import { DASHBOARD_URL } from "../../../UI/Config";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";

/*
 * SIGNING IN WITH A LINK EMAILED TO THE ACCOUNT, ON THE ACCOUNTS PAGES
 * (Common/Types/Accounts/MagicLink).
 *
 *  - The sign-in page offers "Email me a sign-in link" - an outlined option
 *    under "or", like the other ways in - only where the server says it
 *    takes sign-in links, and not on the master admins' password page.
 *  - The page that asks for one takes an address and says "Check your
 *    email", with an "if": the server answers the same whether or not the
 *    address has an account.
 *  - The page a link opens signs in only when its reader presses Sign In -
 *    mail filters open every link in an email - posting the link's token in
 *    place of the email and password. An account with two factor
 *    authentication then gives its second factor on the same page, the
 *    steps sending the token again where a password sign-in sends the
 *    password. A link the server refuses is dropped from the tab and a new
 *    one offered; one that could not be checked is kept.
 *
 * The real pages are rendered with the real English locale; the server is
 * stood in at the API boundary, and what the server says it offers is set
 * per test.
 */

let signInMethodsForTest: SignInMethods | null = null;

jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/SignInMethods", () => {
  return {
    __esModule: true,
    readSignInMethods: (): Promise<SignInMethods | null> => {
      return Promise.resolve(signInMethodsForTest);
    },
    useSignInMethods: (): {
      signInMethods: SignInMethods | null;
      isReading: boolean;
      readAgain: () => void;
    } => {
      return {
        signInMethods: signInMethodsForTest,
        isReading: false,
        readAgain: (): void => {
          return undefined;
        },
      };
    },
  };
});

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
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import MagicLinkPage from "../../../../App/FeatureSet/Accounts/src/Pages/MagicLink";

const STORAGE_KEY: string = "oneuptime-sensitive-url-token";
const TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";
const USER_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_EMAIL: string = "ada@analytical-engine.example.com";
const TOTP_ID: string = "11111111-1111-4111-8111-111111111111";

const TAKES_LINKS: SignInMethods = {
  isSsoRequired: false,
  ssoProviders: [],
  hasProjectSsoProviders: false,
  isMagicLinkLoginEnabled: true,
};

const TAKES_NO_LINKS: SignInMethods = {
  ...TAKES_LINKS,
  isMagicLinkLoginEnabled: false,
};

const strings: typeof english.login.magicLink = english.login.magicLink;
const requestStrings: typeof english.magicLink = english.magicLink;

type PostedCall = { url: string; data: JSONObject };

let posted: Array<PostedCall> = [];

// What the stood-in server answers each URL with, set per test.
let answers: Record<
  string,
  () => HTTPResponse<JSONObject> | HTTPErrorResponse
> = {};

let loginCalls: Array<unknown> = [];
let navigatedTo: Array<string> = [];

function userJson(): JSONObject {
  return { _id: USER_ID, email: USER_EMAIL, name: "Ada Lovelace" };
}

function signedInAnswer(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    { ...userJson(), _miscData: { token: "session-token" } },
    {},
  );
}

function refusal(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: message }, {});
}

function postsTo(path: string): Array<PostedCall> {
  return posted.filter((call: PostedCall): boolean => {
    return call.url.endsWith(path);
  });
}

function storedToken(): string | null {
  return window.sessionStorage.getItem(STORAGE_KEY);
}

// No inter-keystroke delay: see the same note in LoginTwoFactorRecovery.test.tsx.
function setupUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

async function renderSignInPage(
  props: { isMasterAdminSignIn?: boolean } = {},
): Promise<void> {
  render(
    <MemoryRouter>
      <LoginPage {...props} />
    </MemoryRouter>,
  );
  await screen.findByTestId("email");
}

async function renderLinkPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <LoginPage isMagicLinkSignIn={true} />
      </MemoryRouter>,
    );
  });
}

async function renderRequestPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <MagicLinkPage />
      </MemoryRouter>,
    );
  });
}

async function pressSignIn(): Promise<void> {
  const user: UserEvent = setupUser();

  await act(async () => {
    await user.click(screen.getByTestId("magic-link-login-submit"));
  });
}

beforeEach(() => {
  signInMethodsForTest = TAKES_LINKS;
  posted = [];
  answers = {};
  loginCalls = [];
  navigatedTo = [];

  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    /* Nothing to clear is not a failure. */
  }

  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((to: Route | { toString: () => string }): void => {
      navigatedTo.push(to.toString());
    });
  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue("");
  jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
  jest.spyOn(LoginUtil, "login").mockImplementation((value: unknown) => {
    loginCalls.push(value);
  });

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (options: {
        url?: { toString: () => string } | undefined;
        data?: JSONObject | undefined;
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url?.toString() || "";
        const data: JSONObject = (options.data?.["data"] as JSONObject) || {};

        posted.push({ url: url, data: data });

        const path: string | undefined = Object.keys(answers).find(
          (candidate: string): boolean => {
            return url.endsWith(candidate);
          },
        );

        return path ? answers[path]!() : signedInAnswer();
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the sign-in page", () => {
  test("offers a sign-in link, under 'or', after single sign-on and before the passkey", async () => {
    await renderSignInPage();

    const option: HTMLElement = screen.getByTestId("magic-link-login");

    expect(option).toHaveAccessibleName(english.login.emailSignInLink);
    expect(option).toHaveAttribute("href", "/accounts/magic-link");
    expect(screen.getByTestId("sign-in-options")).toContainElement(option);

    const sso: HTMLElement = screen.getByTestId("sso-login");
    const passkey: HTMLElement = screen.getByTestId("passkey-login");

    expect(
      sso.compareDocumentPosition(option) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      option.compareDocumentPosition(passkey) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("is drawn as the other ways in are, not as the page's one filled button", async () => {
    await renderSignInPage();

    expect(screen.getByTestId("magic-link-login").className).toBe(
      screen.getByTestId("sso-login").className,
    );
  });

  test("offers no sign-in link where the server takes none", async () => {
    signInMethodsForTest = TAKES_NO_LINKS;

    await renderSignInPage();

    expect(screen.queryByTestId("magic-link-login")).toBeNull();
    expect(screen.getByTestId("sso-login")).toBeInTheDocument();
  });

  test("offers no sign-in link when what the server offers could not be read", async () => {
    signInMethodsForTest = null;

    await renderSignInPage();

    expect(screen.queryByTestId("magic-link-login")).toBeNull();
  });

  test("keeps the password form, and its button, as the way most people sign in", async () => {
    await renderSignInPage();

    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(screen.getByTestId("Sign in")).toBeInTheDocument();
  });
});

describe("the page a sign-in link opens", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(STORAGE_KEY, TOKEN);
  });

  test("asks for one click, and draws no password form", async () => {
    await renderLinkPage();

    expect(screen.getByText(strings.title)).toBeInTheDocument();
    expect(screen.getByText(strings.subtitle)).toBeInTheDocument();
    expect(screen.getByTestId("magic-link-login-submit")).toHaveTextContent(
      strings.submit,
    );
    expect(screen.queryByTestId("password")).toBeNull();
    expect(screen.queryByTestId("email")).toBeNull();
  });

  test("opening it signs nobody in: nothing is posted until Sign In is pressed", async () => {
    await renderLinkPage();

    expect(posted).toEqual([]);
    expect(loginCalls).toEqual([]);
  });

  test("Sign In posts the link's token alone, signs in, and keeps no copy of it in the tab", async () => {
    await renderLinkPage();
    await pressSignIn();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    expect(postsTo("/login-with-magic-link")).toEqual([
      {
        url: expect.stringContaining("/login-with-magic-link") as never,
        data: { magicLinkToken: TOKEN },
      },
    ]);
    expect(storedToken()).toBeNull();
  });

  test("a link the server refuses is dropped from the tab: its words are shown, and a new link offered", async () => {
    answers["/login-with-magic-link"] = (): HTTPErrorResponse => {
      return refusal(
        400,
        "This sign-in link has expired or has already been used. Please ask for a new one.",
      );
    };

    await renderLinkPage();
    await pressSignIn();

    expect(
      await screen.findByTestId("magic-link-login-error"),
    ).toHaveTextContent(
      "This sign-in link has expired or has already been used.",
    );
    expect(screen.queryByTestId("magic-link-login-submit")).toBeNull();
    expect(screen.getByTestId("magic-link-login-new-link")).toHaveAttribute(
      "href",
      "/accounts/magic-link",
    );
    expect(storedToken()).toBeNull();
    expect(loginCalls).toEqual([]);
  });

  test("a link that could not be checked is kept, so Sign In works again", async () => {
    let attempts: number = 0;

    answers["/login-with-magic-link"] = ():
      | HTTPErrorResponse
      | HTTPResponse<JSONObject> => {
      attempts++;
      return attempts === 1
        ? refusal(503, "Unable to sign you in right now.")
        : signedInAnswer();
    };

    await renderLinkPage();
    await pressSignIn();

    expect(
      await screen.findByTestId("magic-link-login-error"),
    ).toBeInTheDocument();
    expect(storedToken()).toBe(TOKEN);
    expect(screen.getByTestId("magic-link-login-submit")).toBeInTheDocument();

    await pressSignIn();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });
    expect(postsTo("/login-with-magic-link")).toHaveLength(2);
  });

  test("a tab with no link says so, and offers a new one", async () => {
    window.sessionStorage.clear();

    await renderLinkPage();

    expect(screen.getByTestId("magic-link-login-error")).toHaveTextContent(
      strings.noLink,
    );
    expect(screen.queryByTestId("magic-link-login-submit")).toBeNull();
    expect(screen.getByTestId("magic-link-login-new-link")).toBeInTheDocument();
  });

  test("a server that takes no sign-in links says so, and offers neither a button nor a new link", async () => {
    signInMethodsForTest = TAKES_NO_LINKS;

    await renderLinkPage();

    expect(screen.getByTestId("magic-link-login-error")).toHaveTextContent(
      strings.turnedOff,
    );
    expect(screen.queryByTestId("magic-link-login-submit")).toBeNull();
    expect(screen.queryByTestId("magic-link-login-new-link")).toBeNull();
  });

  test("has a way back to every other way of signing in, and no register prompt", async () => {
    await renderLinkPage();

    expect(screen.getByText(strings.backToSignIn).closest("a")).toHaveAttribute(
      "href",
      "/accounts/login",
    );
    expect(screen.queryByText(english.login.registerLink)).toBeNull();
  });

  test("somebody already signed in is sent to the dashboard, and the link dropped", async () => {
    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(true);

    await renderLinkPage();

    expect(navigatedTo).toContain(DASHBOARD_URL.toString());
    expect(storedToken()).toBeNull();
  });

  describe("for an account with two factor authentication", () => {
    beforeEach(() => {
      answers["/login-with-magic-link"] = (): HTTPResponse<JSONObject> => {
        return new HTTPResponse<JSONObject>(
          200,
          {
            ...userJson(),
            _miscData: {
              totpAuthList: [{ _id: TOTP_ID, name: "Ada's phone" }],
              webAuthnList: [],
              backupCodeCount: 4,
            },
          },
          {},
        );
      };
    });

    test("goes on to the second step on the same page, signed in to nothing yet", async () => {
      await renderLinkPage();
      await pressSignIn();

      expect(
        await screen.findByText(english.login.twoFactor.title),
      ).toBeInTheDocument();
      expect(loginCalls).toEqual([]);
    });

    test("the authenticator code is sent with the link's token in place of the password, and the address", async () => {
      await renderLinkPage();
      await pressSignIn();
      await screen.findByText(english.login.twoFactor.title);

      const user: UserEvent = setupUser();

      await user.click(
        screen.getByText(english.login.twoFactor.authenticatorApp),
      );
      await user.type(await screen.findByTestId("code"), "123456");

      await act(async () => {
        await user.click(screen.getByTestId("Sign in"));
      });

      await waitFor(() => {
        expect(loginCalls).toHaveLength(1);
      });

      const step: Array<PostedCall> = postsTo("/verify-totp-auth");

      expect(step).toHaveLength(1);
      expect(step[0]!.data).toEqual({
        email: USER_EMAIL,
        magicLinkToken: TOKEN,
        code: "123456",
        twoFactorAuthId: TOTP_ID,
      });
      expect(step[0]!.data).not.toHaveProperty("password");
    });

    test("a backup code is sent with the link's token too", async () => {
      await renderLinkPage();
      await pressSignIn();
      await screen.findByText(english.login.twoFactor.title);

      const user: UserEvent = setupUser();

      await user.click(screen.getByText(english.login.twoFactor.lostAccess));
      await user.type(await screen.findByTestId("backup-code"), "abcde-fghij");

      await act(async () => {
        await user.click(screen.getByTestId("Sign in"));
      });

      await waitFor(() => {
        expect(postsTo("/verify-backup-code")).toHaveLength(1);
      });

      expect(postsTo("/verify-backup-code")[0]!.data).toEqual({
        email: USER_EMAIL,
        magicLinkToken: TOKEN,
        backupCode: "abcde-fghij",
      });
    });
  });

  test("an account an admin requires two factor authentication of enrols on the same page, sending the link's token", async () => {
    answers["/login-with-magic-link"] = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          ...userJson(),
          _miscData: {
            twoFactorEnrolmentRequired: true,
            twoFactorAuthId: TOTP_ID,
            twoFactorOtpUrl: "otpauth://totp/OneUptime:ada?secret=ABCDEFGH",
          },
        },
        {},
      );
    };

    await renderLinkPage();
    await pressSignIn();

    expect(
      await screen.findByText(english.login.twoFactorEnrolment.title),
    ).toBeInTheDocument();

    const user: UserEvent = setupUser();

    await user.type(await screen.findByTestId("enrolment-code"), "654321");

    await act(async () => {
      await user.click(
        screen.getByTestId(english.login.twoFactorEnrolment.submitButton),
      );
    });

    await waitFor(() => {
      expect(postsTo("/verify-totp-enrolment")).toHaveLength(1);
    });

    expect(postsTo("/verify-totp-enrolment")[0]!.data).toEqual({
      email: USER_EMAIL,
      magicLinkToken: TOKEN,
      code: "654321",
      twoFactorAuthId: TOTP_ID,
    });
  });
});

describe("the page that asks for a sign-in link", () => {
  let created: Array<{ email: string; url: string }> = [];
  let createAnswer: () => Promise<ModelAPIHttpResponse<User>> = () => {
    return Promise.resolve(new ModelAPIHttpResponse<User>(200, {}, {}));
  };

  beforeEach(() => {
    created = [];
    createAnswer = (): Promise<ModelAPIHttpResponse<User>> => {
      return Promise.resolve(new ModelAPIHttpResponse<User>(200, {}, {}));
    };

    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(
        async (data: {
          model: User;
          requestOptions?: { overrideRequestUrl?: unknown } | undefined;
        }): Promise<ModelAPIHttpResponse<User>> => {
          created.push({
            email: data.model.email?.toString() || "",
            url: String(data.requestOptions?.overrideRequestUrl || ""),
          });

          return await createAnswer();
        },
      );
  });

  async function askFor(email: string): Promise<void> {
    const user: UserEvent = setupUser();

    await user.type(await screen.findByTestId("email"), email);

    await act(async () => {
      await user.click(screen.getByTestId(requestStrings.submitButton));
    });
  }

  test("takes an address and asks the server to email it a link", async () => {
    await renderRequestPage();

    expect(screen.getByText(requestStrings.title)).toBeInTheDocument();
    expect(screen.getByText(requestStrings.subtitle)).toBeInTheDocument();

    await askFor(USER_EMAIL);

    await waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0]!.email).toBe(USER_EMAIL);
    expect(created[0]!.url).toMatch(/\/send-magic-link$/);
  });

  test("then says to check the inbox - with an 'if', the address and how long the link works", async () => {
    await renderRequestPage();
    await askFor(USER_EMAIL);

    const sent: HTMLElement = await screen.findByTestId("magic-link-sent");

    expect(screen.getByText(requestStrings.sentTitle)).toBeInTheDocument();
    expect(sent).toHaveTextContent(
      requestStrings.sent
        .replace("{{email}}", USER_EMAIL)
        .replace("{{minutes}}", String(MAGIC_LINK_EXPIRY_MINUTES)),
    );
    expect(sent).toHaveTextContent(requestStrings.notReceived);
    expect(sent).toHaveAttribute("role", "status");
  });

  test("Send another link starts again from an empty form", async () => {
    await renderRequestPage();
    await askFor(USER_EMAIL);
    await screen.findByTestId("magic-link-sent");

    const user: UserEvent = setupUser();

    await act(async () => {
      await user.click(screen.getByTestId("magic-link-send-another"));
    });

    expect(await screen.findByTestId("magic-link-form")).toBeInTheDocument();
    expect(screen.getByTestId("email")).toHaveValue("");
  });

  test("a refusal - too many links, say - is shown, and the form stays", async () => {
    createAnswer = (): Promise<ModelAPIHttpResponse<User>> => {
      return Promise.reject(
        new Error(
          "Too many sign-in links asked for this email address in the last hour. Please use the link in the latest email, or try again later.",
        ),
      );
    };

    await renderRequestPage();
    await askFor(USER_EMAIL);

    expect(
      await screen.findByText(
        /Too many sign-in links asked for this email address/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("magic-link-sent")).toBeNull();
    expect(screen.getByTestId("magic-link-form")).toBeInTheDocument();
  });

  test("has a way back to the password", async () => {
    await renderRequestPage();

    expect(
      screen.getByText(requestStrings.loginLink).closest("a"),
    ).toHaveAttribute("href", "/accounts/login");
  });

  test("where the server takes no sign-in links, sends its reader to the sign-in page", async () => {
    signInMethodsForTest = TAKES_NO_LINKS;

    await renderRequestPage();

    expect(navigatedTo).toContain("/accounts/login");
    expect(screen.queryByTestId("magic-link-form")).toBeNull();
  });

  test("somebody already signed in is sent to the dashboard", async () => {
    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(true);

    await renderRequestPage();

    expect(navigatedTo).toContain(DASHBOARD_URL.toString());
  });
});
