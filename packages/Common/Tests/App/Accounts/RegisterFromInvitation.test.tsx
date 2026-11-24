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
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import * as UIConfig from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import LoginUtil from "../../../UI/Utils/Login";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";
import {
  SIGN_UP_INVITATION_ANSWER_TIMEOUT_IN_MS,
  SIGN_UP_INVITATION_SSO_TIMEOUT_IN_MS,
  confirmSignUpInvitationSsoSignIn,
  fetchSignUpInvitation,
} from "../../../../App/FeatureSet/Accounts/src/Utils/SignUpInvitation";
import {
  SIGN_UP_INVITATION_API_URL,
  SIGN_UP_INVITATION_SSO_API_URL,
} from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import InvitedSsoSignIn from "../../../../App/FeatureSet/Accounts/src/Components/InvitedSsoSignIn/InvitedSsoSignIn";
import en from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import fa from "../../../../App/FeatureSet/Accounts/src/Locales/fa.json";
import {
  SIGN_UP_INVITATION_PROJECT_KEY,
  SIGN_UP_INVITATION_ROUTE,
  SIGN_UP_INVITATION_SSO_ROUTE,
  SignUpInvitation,
} from "../../../Types/Accounts/SignUpInvitation";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";

/*
 * THE SIGN-UP PAGE AN INVITATION OPENS (#7471).
 *
 * It was the plain sign-up page: "Create your OneUptime account", the
 * address filled in and nothing else - am I joining Walk Co, or making an
 * account somewhere else? - and after Sign Up, a second screen asked to
 * accept the invitation the link had carried. Now, opened from an
 * invitation (?email= and ?token=), it asks the server what the invitation
 * knows (POST /identity/sign-up-invitation) and says it: "Join Walk Co",
 * who invited them, the name the inviter typed filled in. Its button says
 * that signing up joins, and the sign-up names the project, which the
 * server accepts once the token has claimed the account. Without an
 * answer, it is the plain page it always was.
 */

jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/SignInMethods", () => {
  return (
    jest.requireActual(
      "./SignInMethodsStandIn",
    ) as typeof import("./SignInMethodsStandIn")
  ).signInMethodsNotRequired();
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
  };
});

const EMAIL: string = "grace@walk.example";
const TOKEN: string = "74100000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "74200000-0000-4000-8000-000000000001";
const PASSWORD: string = "lantern river meadow";

const english: typeof en = en;

type InvitationAnswer =
  | "pending"
  | "accepted"
  | "no-inviter"
  | "none"
  | "error"
  | "throws"
  | "held"
  // #9819: every project they would be in manages sign-in with SSO.
  | "sso"
  | "sso-accepted"
  | "sso-two-providers"
  | "sso-no-provider";

const OKTA_ID: string = "74300000-0000-4000-8000-000000000001";
const ENTRA_ID: string = "74300000-0000-4000-8000-000000000002";

let answer: InvitationAnswer = "pending";
let asked: Array<{ url: string; data: unknown }> = [];
let link: { email: string; token: string } = { email: EMAIL, token: TOKEN };

/*
 * #9898: what the server does with the link a picked provider is told
 * (POST /identity/sign-up-invitation/sso): answer as it always does, fail,
 * throw, or never answer. Every request and page move, in order.
 */
let ssoAnswer: "ok" | "error" | "throws" | "held" = "ok";
let told: Array<{ url: string; data: unknown }> = [];
let events: Array<string> = [];

function invitationAnswer(): JSONObject {
  if (answer === "none") {
    return { invitation: null };
  }

  const ssoProviders: Array<JSONObject> | null =
    answer === "sso" || answer === "sso-accepted"
      ? [{ type: "ProjectSSO", id: OKTA_ID, name: "Okta", description: "" }]
      : answer === "sso-two-providers"
        ? [
            { type: "ProjectSSO", id: OKTA_ID, name: "Okta", description: "" },
            {
              type: "ProjectOIDC",
              id: ENTRA_ID,
              name: "Entra ID",
              description: "Use your Walk Co account",
            },
          ]
        : answer === "sso-no-provider"
          ? []
          : null;

  return {
    invitation: {
      projectId: PROJECT_ID,
      projectName: "Walk Co",
      inviterName: answer === "no-inviter" ? null : "Ada Walker",
      name: "Grace Member",
      isAccepted: answer === "accepted" || answer === "sso-accepted",
      ssoSignIn: ssoProviders ? { providers: ssoProviders } : null,
    },
  };
}

beforeEach(() => {
  answer = "pending";
  asked = [];
  link = { email: EMAIL, token: TOKEN };
  ssoAnswer = "ok";
  told = [];
  events = [];
  Object.defineProperty(UIConfig, "BILLING_ENABLED", { value: false });

  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest.spyOn(UserUtil, "getUtmParams").mockReturnValue({});
  jest.spyOn(UserUtil, "getAttributionClickIds").mockReturnValue(null);
  jest.spyOn(UserUtil, "getFirstTouchAttribution").mockReturnValue(null);
  jest.spyOn(Navigation, "navigate").mockImplementation((to: unknown) => {
    events.push(`navigated to ${String(to)}`);
  });
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((key: string): string | null => {
      if (key === "email") {
        return link.email || null;
      }

      if (key === "token") {
        return link.token || null;
      }

      return null;
    });
  jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(() => {});
  jest.spyOn(LoginUtil, "login").mockImplementation(() => {});
  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
      const response: ModelAPIHttpResponse<User> =
        new ModelAPIHttpResponse<User>(200, {}, {});
      response.miscData = { token: "session" };
      return response;
    });
  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: Parameters<typeof API.post>[0],
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url.toString();

        if (url.endsWith(SIGN_UP_INVITATION_SSO_ROUTE)) {
          told.push({ url: url, data: options.data });
          events.push("told the server the link");

          if (ssoAnswer === "throws") {
            throw new Error("network down");
          }

          if (ssoAnswer === "error") {
            return new HTTPErrorResponse(500, { message: "Server Error" }, {});
          }

          if (ssoAnswer === "held") {
            return new Promise<HTTPResponse<JSONObject>>(() => {});
          }

          return new HTTPResponse<JSONObject>(200, {}, {});
        }

        if (!url.endsWith(SIGN_UP_INVITATION_ROUTE)) {
          throw new Error(`Unexpected request to ${url}`);
        }

        asked.push({ url: url, data: options.data });

        if (answer === "throws") {
          throw new Error("network down");
        }

        if (answer === "error") {
          return new HTTPErrorResponse(404, { message: "Not found" }, {});
        }

        if (answer === "held") {
          return new Promise<HTTPResponse<JSONObject>>(() => {});
        }

        return new HTTPResponse<JSONObject>(200, invitationAnswer(), {});
      },
    );
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  await i18n.changeLanguage("en");
});

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
  await screen.findByTestId("password");
}

async function setField(name: string, value: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });
  const input: HTMLElement = screen.getByTestId(name);
  await user.clear(input);
  if (value) {
    await user.paste(value);
  }
}

// What the sign-up sent, beside the account.
async function signUp(buttonName: string): Promise<JSONObject> {
  await setField("password", PASSWORD);
  await setField("confirmPassword", PASSWORD);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
  });

  await waitFor(() => {
    expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
  });

  const call: Parameters<typeof ModelAPI.createOrUpdate> = jest.mocked(
    ModelAPI.createOrUpdate,
  ).mock.calls[0]!;

  return (call[0].miscDataProps || {}) as JSONObject;
}

describe("opened from an invitation the server can read", () => {
  test("asks the server, once, with the link's address and token", async () => {
    await renderPage();

    expect(asked).toEqual([
      {
        url: SIGN_UP_INVITATION_API_URL.toString(),
        data: { email: EMAIL, token: TOKEN },
      },
    ]);
  });

  test("says which project invited them, and who", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Join Walk Co" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("register-invitation")).toHaveTextContent(
      "Ada Walker invited you to join this project on OneUptime. Create your account to join.",
    );
    // The plain sign-up's title is not there.
    expect(
      screen.queryByRole("heading", { name: english.register.title }),
    ).toBeNull();
  });

  test("fills in the name the inviter typed, for them to change, beside their locked address", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("name")).toHaveValue("Grace Member");
    });
    expect(screen.getByTestId("email")).toHaveValue(EMAIL);
    // The address is the invitation's: locked.
    expect(screen.getByTestId("email")).toHaveAttribute("readonly");
    expect(screen.getByTestId("name")).not.toHaveAttribute("readonly");
    expect(screen.getByTestId("name")).not.toBeDisabled();
  });

  test("says signing up joins, and the sign-up names the project, with the token", async () => {
    await renderPage();

    const sent: JSONObject = await signUp(english.register.joinButton);

    expect(english.register.joinButton).toBe("Sign Up and Join");
    expect(sent["registrationToken"]).toBe(TOKEN);
    expect(sent[SIGN_UP_INVITATION_PROJECT_KEY]).toBe(PROJECT_ID);
  });

  test("a name they changed is the one signed up with", async () => {
    await renderPage();

    await setField("name", "Grace Hopper");
    await signUp(english.register.joinButton);

    const call: Parameters<typeof ModelAPI.createOrUpdate> = jest.mocked(
      ModelAPI.createOrUpdate,
    ).mock.calls[0]!;

    expect((call[0].model as User).name?.toString()).toBe("Grace Hopper");
  });

  test("an invitation that names nobody says so without a name", async () => {
    answer = "no-inviter";

    await renderPage();

    expect(screen.getByTestId("register-invitation")).toHaveTextContent(
      english.register.invited,
    );
  });

  test("someone added already is told so, signs up plainly, and names no project to accept", async () => {
    answer = "accepted";

    await renderPage();

    expect(screen.getByTestId("register-invitation")).toHaveTextContent(
      "Ada Walker added you to this project on OneUptime. Create your account to get started.",
    );

    const sent: JSONObject = await signUp(english.register.submitButton);

    expect(sent[SIGN_UP_INVITATION_PROJECT_KEY]).toBeUndefined();
    expect(sent["registrationToken"]).toBe(TOKEN);
  });

  test("draws nothing of its own until the server answers: never a title it then swaps", async () => {
    answer = "held";

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByTestId("password")).toBeNull();
  });

  test("in Persian, sets the names apart so they read the right way", async () => {
    await i18n.changeLanguage("fa");
    await renderPage();

    const subtitle: HTMLElement = screen.getByTestId("register-invitation");
    const isolated: Array<string> = Array.from(
      document.querySelectorAll("bdi"),
    ).map((element: Element): string => {
      return element.textContent || "";
    });

    expect(isolated).toEqual(["Walk Co", "Ada Walker"]);
    expect(subtitle.textContent).toBe(
      fa.register.invitedBy.replace("{{inviter}}", "Ada Walker"),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      fa.register.invitedTitle.replace("{{project}}", "Walk Co"),
    );
  });
});

describe("with nothing the server could say", () => {
  test.each([
    ["answers none", "none"],
    ["answers with an error", "error"],
    ["cannot be reached", "throws"],
  ] as Array<[string, InvitationAnswer]>)(
    "when the server %s, it is the plain sign-up page, and names no project",
    async (_case: string, given: InvitationAnswer) => {
      answer = given;

      await renderPage();

      expect(
        screen.getByRole("heading", { level: 1, name: english.register.title }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("register-invitation")).toBeNull();
      expect(screen.getByTestId("name")).toHaveValue("");

      await setField("name", "Grace Member");
      const sent: JSONObject = await signUp(english.register.submitButton);

      expect(sent[SIGN_UP_INVITATION_PROJECT_KEY]).toBeUndefined();
      // The token still claims the account.
      expect(sent["registrationToken"]).toBe(TOKEN);
    },
  );

  test("a link with no token is no invitation: the server is never asked", async () => {
    link = { email: EMAIL, token: "" };

    await renderPage();

    expect(asked).toEqual([]);
    expect(
      screen.getByRole("heading", { level: 1, name: english.register.title }),
    ).toBeInTheDocument();
  });

  test("nor is a plain sign-up", async () => {
    link = { email: "", token: "" };

    await renderPage();

    expect(asked).toEqual([]);
  });
});

describe("the ask itself", () => {
  test("answers none when the server does not answer in time, so the page always draws", async () => {
    answer = "held";
    jest.useFakeTimers();

    const pending: Promise<unknown> = fetchSignUpInvitation({
      email: EMAIL,
      token: TOKEN,
    });

    jest.advanceTimersByTime(SIGN_UP_INVITATION_ANSWER_TIMEOUT_IN_MS);

    await expect(pending).resolves.toBeNull();
    expect(SIGN_UP_INVITATION_ANSWER_TIMEOUT_IN_MS).toBe(3000);
  });

  test("reads the invitation the server sent", async () => {
    await expect(
      fetchSignUpInvitation({ email: EMAIL, token: TOKEN }),
    ).resolves.toEqual({
      projectId: PROJECT_ID,
      projectName: "Walk Co",
      inviterName: "Ada Walker",
      name: "Grace Member",
      isAccepted: false,
      ssoSignIn: null,
    });
  });
});

describe("the words, in every language", () => {
  const LOCALES: Record<string, Record<string, Record<string, string>>> = {};

  beforeEach(() => {
    const fs: typeof import("fs") = jest.requireActual(
      "fs",
    ) as typeof import("fs");
    const path: typeof import("path") = jest.requireActual(
      "path",
    ) as typeof import("path");
    const dir: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Accounts/src/Locales",
    );

    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".json")) {
        LOCALES[file.slice(0, -5)] = JSON.parse(
          fs.readFileSync(path.join(dir, file), "utf8"),
        );
      }
    }
  });

  test("every language words them, with the one placeholder each takes", () => {
    const placeholders: Record<string, Array<string>> = {
      invitedTitle: ["{{project}}"],
      invitedBy: ["{{inviter}}"],
      invited: [],
      addedBy: ["{{inviter}}"],
      added: [],
      joinButton: [],
    };

    expect(Object.keys(LOCALES)).toHaveLength(18);

    for (const [code, locale] of Object.entries(LOCALES)) {
      for (const [key, expected] of Object.entries(placeholders)) {
        const text: string | undefined = locale["register"]?.[key];

        expect({
          code,
          key,
          worded: typeof text === "string" && text.length > 0,
        }).toEqual({
          code,
          key,
          worded: true,
        });
        expect({
          code,
          key,
          placeholders: text!.match(/\{\{\w+\}\}/g) || [],
        }).toEqual({
          code,
          key,
          placeholders: expected,
        });

        if (code !== "en") {
          expect({
            code,
            key,
            isEnglish: text === en.register[key as keyof typeof en.register],
          }).toEqual({
            code,
            key,
            isEnglish: false,
          });
        }
      }
    }
  });
});

/*
 * AN INVITATION WHOSE SIGN-IN IS SINGLE SIGN-ON (#9819).
 *
 * When every project the person would be in manages sign-in with SSO, a
 * password is nothing they can set: claiming the account with one is
 * refused. The page their invitation opens offered a password field all
 * the same, so they typed one and only then learned to sign in with SSO.
 * It now offers the project's providers under the same header, says why
 * there is no password, and starts the provider's sign-in.
 */
describe("opened from an invitation whose sign-in is single sign-on", () => {
  async function renderSsoPage(): Promise<void> {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { level: 1, name: "Join Walk Co" });
  }

  test("offers the project's provider, says why there is no password, and asks for none", async () => {
    answer = "sso";

    await renderSsoPage();

    expect(screen.getByTestId("register-invitation")).toHaveTextContent(
      "Ada Walker invited you to join this project on OneUptime. It signs you in with your organization's single sign-on (SSO), so there is no password to create.",
    );
    expect(
      screen.getByRole("button", { name: "Sign in with Okta" }),
    ).toBeInTheDocument();
    // No sign-up form: no password, no name, no Sign Up.
    expect(screen.queryByTestId("password")).toBeNull();
    expect(screen.queryByTestId("confirmPassword")).toBeNull();
    expect(screen.queryByTestId("name")).toBeNull();
    expect(
      screen.queryByRole("button", { name: english.register.joinButton }),
    ).toBeNull();
  });

  test("picking the provider starts its sign-in for this project", async () => {
    answer = "sso";

    await renderSsoPage();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Sign in with Okta" }),
      );
    });

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });
    expect(
      String(jest.mocked(Navigation.navigate).mock.calls[0]![0]),
    ).toContain(`/sso/${PROJECT_ID}/${OKTA_ID}`);
    // Nothing was signed up.
    expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
  });

  test("two providers are both offered, each as the sign-in pages draw one", async () => {
    answer = "sso-two-providers";

    await renderSsoPage();

    expect(
      screen.getByRole("button", { name: /Sign in with Okta/ }),
    ).toBeInTheDocument();
    // A provider its admin described is named, the description under it.
    expect(
      screen.getByRole("button", { name: /Entra ID/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Use your Walk Co account")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Entra ID/ }));
    });

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });
    expect(
      String(jest.mocked(Navigation.navigate).mock.calls[0]![0]),
    ).toContain(`/oidc/${PROJECT_ID}/${ENTRA_ID}`);
  });

  test("someone added already is told so, in the same words about SSO", async () => {
    answer = "sso-accepted";

    await renderSsoPage();

    expect(screen.getByTestId("register-invitation")).toHaveTextContent(
      "Ada Walker added you to this project on OneUptime. It signs you in with your organization's single sign-on (SSO), so there is no password to create.",
    );
  });

  test("a project with no provider turned on says whom to ask, and still offers no password", async () => {
    answer = "sso-no-provider";

    await renderSsoPage();

    expect(screen.getByTestId("register-sso-no-provider")).toHaveTextContent(
      english.register.ssoNoProvider,
    );
    expect(screen.queryByTestId("password")).toBeNull();
  });

  test("reads in the reader's language, the names set apart", async () => {
    answer = "sso";
    await i18n.changeLanguage("fa");

    await renderSsoPage().catch(() => {
      // The title is Persian too: found below by its test id instead.
    });

    await waitFor(() => {
      expect(screen.getByTestId("register-invitation")).toHaveTextContent(
        fa.register.ssoInvitedBy.replace("{{inviter}}", "Ada Walker"),
      );
    });
    expect(
      screen.getByTestId("register-invitation").querySelector("bdi"),
    ).toHaveTextContent("Ada Walker");
  });

  test("an ordinary invitation is the sign-up page it always was", async () => {
    answer = "pending";

    await renderPage();

    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(screen.queryByTestId("register-sso-providers")).toBeNull();
  });
});

/*
 * ONE TRIP THROUGH THE PROVIDER ON ONEUPTIME CLOUD (#9898).
 *
 * There a project's provider signs someone in only once they have
 * confirmed it from their mailbox: picking it here went through it, said
 * "Check your email", and took a second email and a second trip. The link
 * this page was opened with proves the mailbox already, so picking a
 * provider first tells the server so - the link's address and token, and
 * the project the page showed - and only then starts its sign-in. Whatever
 * the server says, or if it says nothing in time, the sign-in starts.
 */
describe("picking a provider tells the server the invitation's link first", () => {
  async function pickOkta(beforeClick?: () => void): Promise<void> {
    answer = "sso";

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { level: 1, name: "Join Walk Co" });

    beforeClick?.();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Sign in with Okta" }),
      );
    });
  }

  test("with the link's address and token and the project the page showed, then starts the sign-in", async () => {
    await pickOkta();

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });

    expect(told).toEqual([
      {
        url: SIGN_UP_INVITATION_SSO_API_URL.toString(),
        data: { email: EMAIL, token: TOKEN, projectId: PROJECT_ID },
      },
    ]);
    // Told first: the provider's answer must find what the server wrote.
    expect(events).toEqual([
      "told the server the link",
      expect.stringContaining(`/sso/${PROJECT_ID}/${OKTA_ID}`),
    ]);
  });

  test("shows the page's skeleton while it is told, and is told once", async () => {
    ssoAnswer = "held";

    await pickOkta((): void => {
      jest.useFakeTimers();
    });

    expect(
      screen.queryByRole("button", { name: "Sign in with Okta" }),
    ).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(told).toHaveLength(1);
    expect(Navigation.navigate).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(SIGN_UP_INVITATION_SSO_TIMEOUT_IN_MS);
    });

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(told).toHaveLength(1);
  });

  test.each([
    ["the server refuses", "error"],
    ["the request throws", "throws"],
  ])(
    "%s: the sign-in starts all the same",
    async (_case: string, failure: string) => {
      ssoAnswer = failure as "error" | "throws";

      await pickOkta();

      await waitFor(() => {
        expect(Navigation.navigate).toHaveBeenCalledTimes(1);
      });
      expect(
        String(jest.mocked(Navigation.navigate).mock.calls[0]![0]),
      ).toContain(`/sso/${PROJECT_ID}/${OKTA_ID}`);
    },
  );

  test("a server that never answers lets them go on after the wait", async () => {
    ssoAnswer = "held";
    jest.useFakeTimers();

    const pending: Promise<void> = confirmSignUpInvitationSsoSignIn({
      email: EMAIL,
      token: TOKEN,
      projectId: PROJECT_ID,
    });

    jest.advanceTimersByTime(SIGN_UP_INVITATION_SSO_TIMEOUT_IN_MS);

    await expect(pending).resolves.toBeUndefined();
    expect(SIGN_UP_INVITATION_SSO_TIMEOUT_IN_MS).toBe(10000);
  });

  test("never throws, whatever the server does", async () => {
    for (const failure of ["ok", "error", "throws"] as const) {
      ssoAnswer = failure;

      await expect(
        confirmSignUpInvitationSsoSignIn({
          email: EMAIL,
          token: TOKEN,
          projectId: PROJECT_ID,
        }),
      ).resolves.toBeUndefined();
    }
  });

  test("a page drawn with no link tells nothing, and starts the sign-in", async () => {
    const invitation: SignUpInvitation = {
      projectId: PROJECT_ID,
      projectName: "Walk Co",
      inviterName: "Ada Walker",
      name: "Grace Member",
      isAccepted: false,
      ssoSignIn: {
        providers: [
          {
            type: SsoProviderType.ProjectSSO,
            id: OKTA_ID,
            name: "Okta",
            description: "",
          },
        ],
      },
    };

    render(
      <MemoryRouter>
        <InvitedSsoSignIn invitation={invitation} link={null} />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Sign in with Okta" }),
      );
    });

    await waitFor(() => {
      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    });
    expect(told).toEqual([]);
  });

  test("an ordinary invitation's sign-up tells nothing of single sign-on", async () => {
    answer = "pending";

    await renderPage();

    expect(told).toEqual([]);
  });
});
