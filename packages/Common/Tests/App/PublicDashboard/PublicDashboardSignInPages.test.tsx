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
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import type { SpyInstance } from "jest-mock";
import API from "../../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import DashboardThemeUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme";
import PublicDashboardUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/PublicDashboard";
import SignInPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/SignIn/SignIn";
import ForgotPasswordPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/SignIn/ForgotPassword";
import ResetPasswordPage, {
  getResetPasswordToken,
} from "../../../../App/FeatureSet/PublicDashboard/src/Pages/SignIn/ResetPassword";
import {
  FORGOT_PASSWORD_COPY,
  FORGOT_PASSWORD_SENT_TEST_ID,
  RESET_PASSWORD_COPY,
  RESET_PASSWORD_DONE_TEST_ID,
  SIGN_IN_COPY,
  SIGN_IN_FORM_TEST_ID,
  SIGN_IN_NO_WAY_TEST_ID,
  SIGN_IN_PAGE_TEST_ID,
  SIGN_IN_PAGE_WORDS,
  SIGN_IN_PROVIDERS_TEST_ID,
} from "../../../../App/FeatureSet/PublicDashboard/src/Pages/SignIn/SignInCopy";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { RESET_LINK_MESSAGES } from "../../../Types/Accounts/SignInMessages";
import { DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE } from "../../../Types/Dashboard/DashboardPrivateUserSignIn";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { APIRequestOptions } from "../../../Utils/API";
import fs from "fs";
import path from "path";

/*
 * A dashboard's sign-in pages on its public link (#10250), as a visitor of
 * a dashboard shared as "Only people who sign in" meets them: the sign-in
 * page - the dashboard's name, what to do, an email and a password unless
 * it takes only single sign-on, and a button per provider that is on - the
 * forgotten password page, whose answer is the same for every address, and
 * the page an invitation or a reset link opens. The pages are the real
 * ones; only the network and the navigation are stubbed, and every request
 * is read as the server gets it.
 */

const DASHBOARD_ID: string = "ab000000-0000-4000-8000-0000000000d1";
const PREVIEW_PATH: string = `/public-dashboard/${DASHBOARD_ID}`;

type Posted = { url: string; data: JSONObject };

let posted: Array<Posted> = [];
let answers: Record<string, () => HTTPResponse<JSONObject> | HTTPErrorResponse>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

const ok: (data?: JSONObject) => () => HTTPResponse<JSONObject> = (
  data?: JSONObject,
): (() => HTTPResponse<JSONObject>) => {
  return (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, data || {}, {});
  };
};

const refused: (message: string) => () => HTTPErrorResponse = (
  message: string,
): (() => HTTPErrorResponse) => {
  return (): HTTPErrorResponse => {
    return new HTTPErrorResponse(400, { message }, {});
  };
};

const SIGN_IN_METHODS: (data: {
  password: boolean;
  saml?: Array<JSONObject>;
  oidc?: Array<JSONObject>;
}) => () => HTTPResponse<JSONObject> = (data: {
  password: boolean;
  saml?: Array<JSONObject>;
  oidc?: Array<JSONObject>;
}): (() => HTTPResponse<JSONObject>) => {
  return ok({
    isPasswordSignInAllowed: data.password,
    samlProviders: data.saml || [],
    oidcProviders: data.oidc || [],
  } as unknown as JSONObject);
};

const openAt: (address: string) => void = (address: string): void => {
  window.history.replaceState(null, "", address);
  (
    DashboardThemeUtil as unknown as { linkTheme: string | null | undefined }
  ).linkTheme = undefined;
};

// The route a request went to, after the dashboard's own API prefix.
const routeOf: (url: string) => string = (url: string): string => {
  const at: number = url.indexOf("/private-user/");

  return at >= 0 ? url.substring(at) : url;
};

beforeEach(() => {
  window.localStorage.clear();
  posted = [];
  answers = {};
  openAt(`${PREVIEW_PATH}/sign-in`);
  PublicDashboardUtil.setDashboardId(new ObjectID(DASHBOARD_ID));

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        request: APIRequestOptions,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = request.url.toString();
        // The sign-in pages post JSON objects only.
        posted.push({ url, data: (request.data as JSONObject) || {} });

        const route: string = routeOf(url).split(`/${DASHBOARD_ID}`)[0]!;
        const answer: () => HTTPResponse<JSONObject> | HTTPErrorResponse =
          answers[route] || ok();

        return answer();
      },
    );

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const renderSignIn: (initialError?: string) => Promise<void> = async (
  initialError?: string,
): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <SignInPage
          dashboardName="Checkout Health"
          initialError={initialError}
        />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId(SIGN_IN_PAGE_TEST_ID)).toBeInTheDocument();
  });
};

/*
 * The sign-in password field: its label carries the Forgot password? link
 * beside the word, so the label reads "Password" first.
 */
const passwordField: () => HTMLElement = (): HTMLElement => {
  return screen.getByLabelText(new RegExp(`^${SIGN_IN_COPY.passwordLabel}`));
};

describe("the sign-in page", () => {
  test("titles itself with the dashboard, says what to do, and offers an email and a password", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: true,
    });

    await renderSignIn();

    const page: HTMLElement = screen.getByTestId(SIGN_IN_PAGE_TEST_ID);

    expect(page).toHaveTextContent("Checkout Health");
    expect(page).toHaveTextContent(SIGN_IN_COPY.prompt);
    expect(screen.getByLabelText(SIGN_IN_COPY.emailLabel)).toHaveAttribute(
      "type",
      "email",
    );

    const password: HTMLElement = passwordField();

    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(
      screen.getByRole("button", { name: SIGN_IN_COPY.submit }),
    ).toBeInTheDocument();

    // No provider is on: no "or", and no buttons for one.
    expect(
      screen.queryByTestId(SIGN_IN_PROVIDERS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("asks the dashboard's own sign-in routes, under its public link's API", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: true,
    });

    await renderSignIn();

    expect(posted[0]!.url).toContain(
      `/private-user/sign-in-methods/${DASHBOARD_ID}`,
    );
  });

  test("links Forgot password? to the dashboard's own forgotten password page", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: true,
    });

    await renderSignIn();

    const link: HTMLElement = screen.getByText(SIGN_IN_COPY.forgotPassword);

    expect(link.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(`${PREVIEW_PATH}/forgot-password`),
    );
  });

  test("offers a button per single sign-on provider that is on, under or, each starting at OneUptime's own address", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: true,
      saml: [
        { _id: "aaab0000-0000-4000-8000-000000000001", name: "Acme Okta" },
      ],
      oidc: [
        { _id: "aaab0000-0000-4000-8000-000000000002", name: "Acme Google" },
      ],
    });

    await renderSignIn();

    const providers: HTMLElement = screen.getByTestId(
      SIGN_IN_PROVIDERS_TEST_ID,
    );

    expect(providers).toHaveTextContent(SIGN_IN_COPY.or);

    const saml: HTMLElement = within(providers).getByText(
      "Sign in with Acme Okta",
    );
    const oidc: HTMLElement = within(providers).getByText(
      "Sign in with Acme Google",
    );

    expect(saml.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(
        `/dashboard-sso/${DASHBOARD_ID}/aaab0000-0000-4000-8000-000000000001`,
      ),
    );
    expect(oidc.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(
        `/dashboard-oidc/${DASHBOARD_ID}/aaab0000-0000-4000-8000-000000000002`,
      ),
    );
  });

  test("a dashboard that takes only single sign-on offers no password, and says to use it", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: false,
      saml: [
        { _id: "aaab0000-0000-4000-8000-000000000001", name: "Acme Okta" },
      ],
    });

    await renderSignIn();

    expect(screen.queryByTestId(SIGN_IN_FORM_TEST_ID)).not.toBeInTheDocument();
    expect(screen.getByTestId(SIGN_IN_PAGE_TEST_ID)).toHaveTextContent(
      SIGN_IN_COPY.ssoOnlyPrompt,
    );
    // No "or" without a form above it.
    expect(screen.getByTestId(SIGN_IN_PROVIDERS_TEST_ID)).not.toHaveTextContent(
      new RegExp(`^${SIGN_IN_COPY.or}`),
    );
  });

  test("a dashboard with no way in yet says so, and who to ask", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: false,
    });

    await renderSignIn();

    expect(screen.getByTestId(SIGN_IN_NO_WAY_TEST_ID)).toHaveTextContent(
      SIGN_IN_COPY.noWayToSignIn,
    );
  });

  test("signs in with what was typed, then goes on to the dashboard", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: true,
    });
    answers["/private-user/login"] = ok({ email: "reader@example.com" });

    await renderSignIn();

    fireEvent.change(screen.getByLabelText(SIGN_IN_COPY.emailLabel), {
      target: { value: "  reader@example.com " },
    });
    fireEvent.change(passwordField(), {
      target: { value: "correct horse battery staple 9" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: SIGN_IN_COPY.submit }),
      );
    });

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });

    const login: Posted | undefined = posted.find((request: Posted) => {
      return request.url.includes(`/private-user/login/${DASHBOARD_ID}`);
    });

    expect(login?.data).toEqual({
      data: {
        email: "reader@example.com",
        password: "correct horse battery staple 9",
      },
    });
  });

  test("says the server's one answer to an address and password that do not sign in, and stays", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: true,
    });
    answers["/private-user/login"] = refused(
      DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE,
    );

    await renderSignIn();

    fireEvent.change(screen.getByLabelText(SIGN_IN_COPY.emailLabel), {
      target: { value: "stranger@example.com" },
    });
    fireEvent.change(passwordField(), {
      target: { value: "not it" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: SIGN_IN_COPY.submit }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText(DASHBOARD_PRIVATE_USER_CREDENTIALS_MESSAGE),
      ).toBeInTheDocument();
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("shows what went wrong with a single sign-on code above the ways in", async () => {
    answers["/private-user/sign-in-methods"] = SIGN_IN_METHODS({
      password: true,
    });

    await renderSignIn("That sign-in link has expired. Sign in again.");

    expect(
      screen.getByText("That sign-in link has expired. Sign in again."),
    ).toBeInTheDocument();
  });
});

describe("the forgotten password page", () => {
  const renderForgot: () => Promise<void> = async (): Promise<void> => {
    openAt(`${PREVIEW_PATH}/forgot-password`);

    await act(async () => {
      render(
        <MemoryRouter>
          <ForgotPasswordPage dashboardName="Checkout Health" />
        </MemoryRouter>,
      );
    });
  };

  const ask: (email: string) => Promise<void> = async (
    email: string,
  ): Promise<void> => {
    fireEvent.change(screen.getByLabelText(SIGN_IN_COPY.emailLabel), {
      target: { value: email },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: FORGOT_PASSWORD_COPY.submit }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId(FORGOT_PASSWORD_SENT_TEST_ID),
      ).toBeInTheDocument();
    });
  };

  test("says the same thing whatever address was asked about, and sends what was typed", async () => {
    await renderForgot();

    expect(screen.getByText(FORGOT_PASSWORD_COPY.title)).toBeInTheDocument();

    await ask("stranger@example.com");

    expect(screen.getByTestId(FORGOT_PASSWORD_SENT_TEST_ID)).toHaveTextContent(
      FORGOT_PASSWORD_COPY.sent,
    );
    expect(posted[0]!.url).toContain(
      `/private-user/forgot-password/${DASHBOARD_ID}`,
    );
    expect(posted[0]!.data).toEqual({
      data: { email: "stranger@example.com" },
    });
  });
});

describe("the page an invitation or a reset link opens", () => {
  const TOKEN: string = "1dab0000-0000-4000-8000-000000000001";

  const renderReset: () => Promise<void> = async (): Promise<void> => {
    openAt(`${PREVIEW_PATH}/reset-password/${TOKEN}`);

    await act(async () => {
      render(
        <MemoryRouter>
          <ResetPasswordPage dashboardName="Checkout Health" />
        </MemoryRouter>,
      );
    });
  };

  const choose: (password: string) => Promise<void> = async (
    password: string,
  ): Promise<void> => {
    fireEvent.change(screen.getByLabelText(RESET_PASSWORD_COPY.passwordLabel), {
      target: { value: password },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: RESET_PASSWORD_COPY.submit }),
      );
    });
  };

  test("reads the link's token from the address, on the public link and on a custom domain", () => {
    expect(
      getResetPasswordToken(`${PREVIEW_PATH}/reset-password/${TOKEN}`),
    ).toBe(TOKEN);
    expect(getResetPasswordToken(`/reset-password/${TOKEN}?theme=dark`)).toBe(
      TOKEN,
    );
    expect(getResetPasswordToken("/sign-in")).toBe("");
  });

  test("saves the new password with the link's token, then says to sign in with it", async () => {
    await renderReset();

    expect(
      screen.getByLabelText(RESET_PASSWORD_COPY.passwordLabel),
    ).toHaveAttribute("autocomplete", "new-password");

    await choose("a brand new Passphrase 2026!");

    await waitFor(() => {
      expect(screen.getByTestId(RESET_PASSWORD_DONE_TEST_ID)).toHaveTextContent(
        RESET_PASSWORD_COPY.done,
      );
    });

    expect(posted[0]!.url).toContain(
      `/private-user/reset-password/${DASHBOARD_ID}`,
    );
    expect(posted[0]!.data).toEqual({
      data: {
        resetPasswordToken: TOKEN,
        password: "a brand new Passphrase 2026!",
      },
    });
  });

  test("a link that was used or ran out offers a new one", async () => {
    answers["/private-user/reset-password"] = refused(
      RESET_LINK_MESSAGES.expired,
    );

    await renderReset();
    await choose("a brand new Passphrase 2026!");

    await waitFor(() => {
      expect(screen.getByText(RESET_LINK_MESSAGES.expired)).toBeInTheDocument();
    });

    expect(
      screen.getByText(RESET_PASSWORD_COPY.requestNewLink).closest("a"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`${PREVIEW_PATH}/forgot-password`),
    );
  });
});

describe("the words of the sign-in pages", () => {
  /*
   * Every word the pages look up is an English key of the public
   * dashboard's locales, and every language it ships says it in its own.
   */
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/PublicDashboard/src/Locales",
  );

  test.each(
    fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .map((file: string): [string] => {
        return [file.replace(".json", "")];
      }),
  )("%s says every one", (language: string) => {
    const locale: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;

    for (const word of SIGN_IN_PAGE_WORDS) {
      expect([word, typeof locale[word]]).toEqual([word, "string"]);

      if (language !== "en") {
        // Translated, except the words a language writes as English does.
        const writtenAsEnglish: Record<string, Array<string>> = {
          Dashboard: ["da", "de", "it", "nl"],
          Password: ["it"],
        };

        if (!(writtenAsEnglish[word] || []).includes(language)) {
          expect([language, word, locale[word] === word]).toEqual([
            language,
            word,
            false,
          ]);
        }
      }
    }
  });
});
