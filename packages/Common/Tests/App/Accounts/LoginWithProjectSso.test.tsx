import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";
import * as React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  PROJECT_SSO_SIGN_IN_PATH,
  getProjectSignInMethodsRoute,
  getProjectSsoSignInRoute,
} from "../../../Types/SSO/SignInMethods";
import {
  getSignInOptionClassName,
  SIGN_IN_OPTION_PRIMARY_CLASS,
} from "../../../UI/Components/SignInOption/SignInOptionStyle";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import persian from "../../../../App/FeatureSet/Accounts/src/Locales/fa.json";
import LoginWithProjectSsoPage, {
  PROJECT_SSO_NO_PROVIDER_TEST_ID,
  PROJECT_SSO_OTHER_WAY_TEST_ID,
  PROJECT_SSO_PROVIDER_TEST_ID,
  PROJECT_SSO_PROVIDERS_TEST_ID,
} from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithProjectSso";

/*
 * A PROJECT'S SSO SIGN-IN LINK (/accounts/sso/<project id>, #9918).
 *
 * "Sign in with SSO" finds a project's providers by an address's verified
 * domain alone (#9824), so it finds nothing for an address on another domain
 * (a contractor at gmail.com) or a project that has not verified its domain.
 * Their admin shares the project's SSO sign-in link instead, and this page
 * lists the providers that sign people in to that project. What is held:
 *
 *   - it asks the identity server for the project's providers by the
 *     project's id alone - one read, no address, nothing else - so it says
 *     nothing about who has an account;
 *   - each provider is a button, "Sign in with Okta" or the admin's own
 *     description, that starts the provider's sign-in for that project; one
 *     provider is the page's filled button;
 *   - a link that names no project, or a project with no provider turned
 *     on, says so and what to do, and reads nothing for a malformed id;
 *   - a read that fails says so, with Try again;
 *   - "Sign in another way" leads to the sign-in page, and a visitor who is
 *     signed in already is not sent away: an admin tries a provider here;
 *   - it reads in the visitor's language, and every Accounts locale words
 *     its sentences.
 *
 * IDENTITY_URL is pinned to a fixed origin so the URLs the page reads and
 * starts can be compared exactly.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const url: { default: { fromString: (value: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL") as {
      default: { fromString: (value: string) => unknown };
    };

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "IDENTITY_URL", {
    get: (): unknown => {
      return url.default.fromString("https://oneuptime.example.com/identity");
    },
  });

  return mocked;
});

const IDENTITY_ORIGIN: string = "https://oneuptime.example.com/identity";
const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const SAML_PROVIDER: string = "33333333-3333-4333-8333-333333333333";
const OIDC_PROVIDER: string = "44444444-4444-4444-8444-444444444444";
const GLOBAL_PROVIDER: string = "55555555-5555-4555-8555-555555555555";

const ACCOUNTS_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Accounts",
  "src",
);

const ACCOUNTS_LOCALES_DIR: string = path.join(ACCOUNTS_SRC, "Locales");

// Where a sentence ends, in the scripts the Accounts locales are written in.
const SENTENCE_END: RegExp = /[.。।]$/u;

type Answer = { status: number; data: JSONObject };

let answer: Answer;
let requestedUrls: Array<string>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

const toResponse: (
  value: Answer,
) => HTTPResponse<JSONObject> | HTTPErrorResponse = (
  value: Answer,
): HTTPResponse<JSONObject> | HTTPErrorResponse => {
  if (value.status >= 400) {
    return new HTTPErrorResponse(value.status, value.data, {});
  }

  return new HTTPResponse<JSONObject>(value.status, value.data, {});
};

const providersAnswer: (providers: Array<JSONObject>) => Answer = (
  providers: Array<JSONObject>,
): Answer => {
  return { status: 200, data: { ssoProviders: providers } };
};

const OKTA: JSONObject = {
  type: SsoProviderType.ProjectSSO,
  id: SAML_PROVIDER,
  name: "Okta",
  description: "Sign in with Okta",
};

const ENTRA: JSONObject = {
  type: SsoProviderType.ProjectOIDC,
  id: OIDC_PROVIDER,
  name: "Entra ID",
  description: "Use your Acme account",
};

const COMPANY_IDP: JSONObject = {
  type: SsoProviderType.GlobalSSO,
  id: GLOBAL_PROVIDER,
  name: "Company IdP",
  description: "",
};

const renderAt: (projectId: string) => Promise<void> = async (
  projectId: string,
): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/accounts/sso/${projectId}`]}>
        <Routes>
          <Route
            path={PROJECT_SSO_SIGN_IN_PATH}
            element={<LoginWithProjectSsoPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
  });
};

const clickButton: (name: string) => Promise<void> = async (
  name: string,
): Promise<void> => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });

  await act(async () => {
    await user.click(await screen.findByRole("button", { name: name }));
  });
};

const navigatedTo: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map(
    (call: Parameters<typeof Navigation.navigate>) => {
      return call[0].toString();
    },
  );
};

const signInWith: (name: string) => string = (name: string): string => {
  return english.sso.signInWithProvider.replace("{{name}}", name);
};

const readLocales: () => Array<{
  file: string;
  locale: JSONObject;
}> = (): Array<{ file: string; locale: JSONObject }> => {
  return fs
    .readdirSync(ACCOUNTS_LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string) => {
      return {
        file: file,
        locale: JSON.parse(
          fs.readFileSync(path.join(ACCOUNTS_LOCALES_DIR, file), "utf8"),
        ) as JSONObject,
      };
    });
};

const ssoValue: (locale: JSONObject, key: string) => string = (
  locale: JSONObject,
  key: string,
): string => {
  return String(((locale["sso"] as JSONObject) || {})[key] ?? "");
};

describe("A project's SSO sign-in link", () => {
  beforeEach(() => {
    requestedUrls = [];
    answer = providersAnswer([OKTA]);

    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    navigateSpy = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    jest
      .spyOn(API, "get")
      .mockImplementation(
        async (
          options: Parameters<typeof API.get>[0],
        ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          const url: string = options.url?.toString() || "";
          requestedUrls.push(url);

          if (url.includes("/project-sign-in-methods/")) {
            return toResponse(answer);
          }

          return toResponse({
            status: 404,
            data: { message: "Page not found" },
          });
        },
      );
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  describe("what it reads", () => {
    test("one read, of the project's providers by the project's id alone: no address, no lookup by email", async () => {
      await renderAt(PROJECT);

      await screen.findByTestId(PROJECT_SSO_PROVIDERS_TEST_ID);

      expect(requestedUrls).toEqual([
        `${IDENTITY_ORIGIN}/project-sign-in-methods/${PROJECT}`,
      ]);
      expect(screen.queryByTestId("email")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    test("a link that names no project reads nothing, and says there is no provider to sign in with", async () => {
      for (const notAProject of ["not-a-project", "1234", "%20"]) {
        requestedUrls = [];

        await renderAt(notAProject);

        expect(
          await screen.findByTestId(PROJECT_SSO_NO_PROVIDER_TEST_ID),
        ).toHaveTextContent(english.sso.projectNoProvider);
        expect(requestedUrls).toEqual([]);

        cleanup();
      }
    });

    test("the route and the read share their paths with the Dashboard's link", () => {
      expect(PROJECT_SSO_SIGN_IN_PATH).toBe("/accounts/sso/:projectId");
      expect(getProjectSsoSignInRoute(PROJECT)).toBe(`/sso/${PROJECT}`);
      expect(getProjectSignInMethodsRoute(PROJECT)).toBe(
        `/project-sign-in-methods/${PROJECT}`,
      );
      // An id is written into the path as it is, never as more of a path.
      expect(getProjectSsoSignInRoute("a/b?c")).toBe("/sso/a%2Fb%3Fc");
    });
  });

  describe("the providers", () => {
    test("one provider is the page's filled button, saying Sign in with its name", async () => {
      await renderAt(PROJECT);

      const button: HTMLElement = await screen.findByRole("button", {
        name: signInWith("Okta"),
      });

      expect(button.className).toBe(SIGN_IN_OPTION_PRIMARY_CLASS);
      expect(screen.getAllByTestId(PROJECT_SSO_PROVIDER_TEST_ID)).toHaveLength(
        1,
      );
    });

    test("several are outlined options, each in its admin's words when they wrote their own", async () => {
      answer = providersAnswer([OKTA, ENTRA, COMPANY_IDP]);

      await renderAt(PROJECT);

      const list: HTMLElement = await screen.findByTestId(
        PROJECT_SSO_PROVIDERS_TEST_ID,
      );
      const buttons: Array<HTMLElement> = within(list).getAllByRole("button");

      expect(
        buttons.map((button: HTMLElement): string => {
          return button.textContent || "";
        }),
      ).toEqual([signInWith("Okta"), "Entra ID", signInWith("Company IdP")]);

      // The admin's own words are under their button, and read out with it.
      expect(buttons[1]).toHaveAccessibleDescription("Use your Acme account");
      expect(buttons[0]).not.toHaveAccessibleDescription(signInWith("Okta"));

      for (const button of buttons) {
        expect(button.className).toBe(getSignInOptionClassName("ready"));
      }
    });

    test("picking one starts its sign-in, for this project", async () => {
      answer = providersAnswer([OKTA, ENTRA, COMPANY_IDP]);

      await renderAt(PROJECT);
      await clickButton(signInWith("Okta"));

      expect(navigatedTo()).toEqual([
        `${IDENTITY_ORIGIN}/sso/${PROJECT}/${SAML_PROVIDER}`,
      ]);
    });

    test.each([
      {
        name: "an OIDC provider",
        provider: ENTRA,
        button: "Entra ID",
        to: `${IDENTITY_ORIGIN}/oidc/${PROJECT}/${OIDC_PROVIDER}`,
      },
      {
        name: "an instance-wide provider that reaches the project",
        provider: COMPANY_IDP,
        button: signInWith("Company IdP"),
        to: `${IDENTITY_ORIGIN}/global-sso/${GLOBAL_PROVIDER}`,
      },
    ])(
      "$name starts its own sign-in",
      async (data: {
        name: string;
        provider: JSONObject;
        button: string;
        to: string;
      }) => {
        answer = providersAnswer([OKTA, data.provider]);

        await renderAt(PROJECT);

        const list: HTMLElement = await screen.findByTestId(
          PROJECT_SSO_PROVIDERS_TEST_ID,
        );
        const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
          delay: null,
        });

        await act(async () => {
          await user.click(
            within(list).getByRole("button", {
              name: new RegExp(`^${data.button}`),
            }),
          );
        });

        expect(navigatedTo()).toEqual([data.to]);
      },
    );

    test("rows that are not providers are never drawn as buttons that cannot work", async () => {
      answer = providersAnswer([
        OKTA,
        { type: "Unknown", id: OIDC_PROVIDER, name: "Mystery" },
        { type: SsoProviderType.ProjectSSO, id: "not-an-id", name: "Broken" },
        { type: SsoProviderType.ProjectSSO, id: GLOBAL_PROVIDER, name: "" },
      ]);

      await renderAt(PROJECT);

      await screen.findByTestId(PROJECT_SSO_PROVIDERS_TEST_ID);

      expect(screen.getAllByTestId(PROJECT_SSO_PROVIDER_TEST_ID)).toHaveLength(
        1,
      );
      expect(screen.queryByText(/Mystery|Broken/)).not.toBeInTheDocument();
    });
  });

  describe("when there is nothing to sign in with", () => {
    test("a project with no provider turned on says so, and what to do", async () => {
      answer = providersAnswer([]);

      await renderAt(PROJECT);

      expect(
        await screen.findByTestId(PROJECT_SSO_NO_PROVIDER_TEST_ID),
      ).toHaveTextContent(
        "This link has no single sign-on provider to sign in with. Ask your admin to turn one on, or sign in another way.",
      );
      expect(
        screen.queryByTestId(PROJECT_SSO_PROVIDERS_TEST_ID),
      ).not.toBeInTheDocument();
    });

    test("a read that fails says so, and Try again reads again", async () => {
      answer = { status: 500, data: { message: "Server Error" } };

      await renderAt(PROJECT);

      expect(
        await screen.findByRole("button", { name: /try again/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(PROJECT_SSO_NO_PROVIDER_TEST_ID),
      ).not.toBeInTheDocument();

      answer = providersAnswer([OKTA]);
      await clickButton("Try again");

      expect(
        await screen.findByRole("button", { name: signInWith("Okta") }),
      ).toBeInTheDocument();
      expect(requestedUrls).toHaveLength(2);
    });
  });

  describe("the way out", () => {
    test("Sign in another way leads to the sign-in page, whatever the page shows", async () => {
      for (const value of [providersAnswer([OKTA]), providersAnswer([])]) {
        answer = value;

        await renderAt(PROJECT);

        const link: HTMLElement = await screen.findByTestId(
          PROJECT_SSO_OTHER_WAY_TEST_ID,
        );

        expect(link).toHaveAttribute("href", "/accounts/login");
        expect(link).toHaveTextContent(english.sso.signInAnotherWay);

        cleanup();
      }
    });

    test("a visitor already signed in is not sent away: an admin tries a provider here", async () => {
      jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(true);

      await renderAt(PROJECT);

      expect(
        await screen.findByRole("button", { name: signInWith("Okta") }),
      ).toBeInTheDocument();
      expect(navigatedTo()).toEqual([]);
    });
  });

  describe("in the visitor's language", () => {
    test("German reads German", async () => {
      await i18n.changeLanguage("de");
      answer = providersAnswer([]);

      await renderAt(PROJECT);

      expect(
        await screen.findByTestId(PROJECT_SSO_NO_PROVIDER_TEST_ID),
      ).toHaveTextContent(german.sso.projectNoProvider);
      expect(screen.getByText(german.sso.title)).toBeInTheDocument();
      expect(
        screen.getByTestId(PROJECT_SSO_OTHER_WAY_TEST_ID),
      ).toHaveTextContent(german.sso.signInAnotherWay);
    });

    test("Persian reads Persian", async () => {
      await i18n.changeLanguage("fa");

      await renderAt(PROJECT);

      expect(
        await screen.findByRole("button", {
          name: persian.sso.signInWithProvider.replace("{{name}}", "Okta"),
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(PROJECT_SSO_OTHER_WAY_TEST_ID),
      ).toHaveTextContent(persian.sso.signInAnotherWay);
    });

    test("every locale words the page, each in its own words", () => {
      for (const { file, locale } of readLocales()) {
        const noProvider: string = ssoValue(locale, "projectNoProvider");
        const otherWay: string = ssoValue(locale, "signInAnotherWay");
        const sentenceEnds: number = (
          noProvider.match(/[。।]|\.(?=\s|$)/gu) || []
        ).length;

        expect({
          file,
          noProvider: Boolean(noProvider),
          noProviderSentences: sentenceEnds,
          endsASentence: SENTENCE_END.test(noProvider),
          otherWay: Boolean(otherWay),
          otherWayIsNoSentence: !SENTENCE_END.test(otherWay),
          noPlaceholders: !`${noProvider}${otherWay}`.includes("{{"),
        }).toEqual({
          file,
          noProvider: true,
          noProviderSentences: 2,
          endsASentence: true,
          otherWay: true,
          otherWayIsNoSentence: true,
          noPlaceholders: true,
        });

        if (file !== "en.json") {
          expect({ file, noProvider }).not.toEqual({
            file,
            noProvider: english.sso.projectNoProvider,
          });
          expect({ file, otherWay }).not.toEqual({
            file,
            otherWay: english.sso.signInAnotherWay,
          });
        }
      }
    });

    /*
     * "Sign in with SSO" finds nothing for an address on another domain:
     * what it says then points at this link, by the name the Dashboard's
     * card gives it.
     */
    test("Sign in with SSO, finding nothing, points at the organization's SSO sign-in link", () => {
      expect(english.sso.notSetUpForDomain).toBe(
        "Single sign-on is not set up for {{domain}}. Ask your admin for your organization’s SSO sign-in link, or sign in another way.",
      );

      for (const { file, locale } of readLocales()) {
        expect({
          file,
          namesSso: ssoValue(locale, "notSetUpForDomain").includes("SSO"),
        }).toEqual({ file, namesSso: true });
      }
    });
  });

  describe("its place in the Accounts app", () => {
    test("the route is registered, its page loaded only when opened", () => {
      const app: string = fs.readFileSync(
        path.join(ACCOUNTS_SRC, "App.tsx"),
        "utf8",
      );

      expect(app).toContain('import("./Pages/LoginWithProjectSso")');
      expect(app).toContain("path={PROJECT_SSO_SIGN_IN_PATH}");
      expect(app).toContain("element={<LoginWithProjectSso />}");
      expect(app).not.toMatch(/^import [^;]*Pages\/LoginWithProjectSso/m);
    });
  });
});
