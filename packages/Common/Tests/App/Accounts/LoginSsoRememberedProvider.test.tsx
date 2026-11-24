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
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../../UI/Utils/GlobalConfig";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { PROJECT_SSO_SIGN_IN_PATH } from "../../../Types/SSO/SignInMethods";
import { REMEMBERED_SSO_PROVIDER_KEY } from "../../../Types/Accounts/RememberedSsoProvider";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import persian from "../../../../App/FeatureSet/Accounts/src/Locales/fa.json";
import LoginWithSSOPage, {
  FORGET_LAST_USED_TEST_ID,
  LAST_USED_PROVIDER_OPTION_TEST_ID,
  LAST_USED_PROVIDER_TEST_ID,
} from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";
import LoginWithProjectSsoPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithProjectSso";

/*
 * "SIGN IN WITH SSO" OFFERS THE PROVIDER THIS DEVICE LAST SIGNED IN WITH
 * (#9986).
 *
 * Someone on another domain than their organization's - a contractor at
 * gmail.com in Acme's project - finds nothing by their address and comes in
 * through the project's SSO sign-in link. Picking a project's provider, on
 * "Sign in with SSO" or on the link's page, now remembers it in this
 * browser, and "Sign in with SSO" offers it first. What is held:
 *
 *   - set: only the provider's kind, its id and its project's id are kept -
 *     never the address typed, never a name - and only for a project's own
 *     provider;
 *   - offered: the next visit asks the server about that project by its id
 *     alone, and offers the provider under the name the server gives it
 *     now, one click to its sign-in;
 *   - cleared: Forget this provider removes it from the browser and the page;
 *   - removed or turned off: a provider the server no longer lists for the
 *     project is not offered, and is forgotten; a server that could not be
 *     asked offers nothing this time and forgets nothing;
 *   - no request ever carries an address;
 *   - every Accounts locale words the new sentences.
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
const ACME: string = "11111111-1111-4111-8111-111111111111";
const OKTA: string = "33333333-3333-4333-8333-333333333333";
const ENTRA: string = "44444444-4444-4444-8444-444444444444";
const COMPANY_IDP: string = "55555555-5555-4555-8555-555555555555";
const ADDRESS: string = "contractor@gmail.example";

const ACCOUNTS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Accounts",
  "src",
  "Locales",
);

type Answer = { status: number; data: JSONObject | Array<JSONObject> };

let projectAnswer: Answer;
let emailLookupAnswer: Array<JSONObject>;
let requestedUrls: Array<string>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

const toResponse: (
  value: Answer,
) => HTTPResponse<JSONObject> | HTTPErrorResponse = (
  value: Answer,
): HTTPResponse<JSONObject> | HTTPErrorResponse => {
  if (value.status >= 400) {
    return new HTTPErrorResponse(value.status, value.data as JSONObject, {});
  }

  return new HTTPResponse<JSONObject>(
    value.status,
    value.data as JSONObject,
    {},
  );
};

const providers: (rows: Array<JSONObject>) => Answer = (
  rows: Array<JSONObject>,
): Answer => {
  return { status: 200, data: { ssoProviders: rows } };
};

const OKTA_ROW: JSONObject = {
  type: SsoProviderType.ProjectSSO,
  id: OKTA,
  name: "Okta",
  description: "",
};

const ENTRA_ROW: JSONObject = {
  type: SsoProviderType.ProjectOIDC,
  id: ENTRA,
  name: "Entra ID",
  description: "",
};

const COMPANY_IDP_ROW: JSONObject = {
  type: SsoProviderType.GlobalSSO,
  id: COMPANY_IDP,
  name: "Company IdP",
  description: "",
};

const signInWith: (name: string) => string = (name: string): string => {
  return english.sso.signInWithProvider.replace("{{name}}", name);
};

const stored: () => JSONObject | null = (): JSONObject | null => {
  const value: string | null = window.localStorage.getItem(
    REMEMBERED_SSO_PROVIDER_KEY,
  );

  return value ? (JSON.parse(value) as JSONObject) : null;
};

const remember: (type: SsoProviderType, providerId: string) => void = (
  type: SsoProviderType,
  providerId: string,
): void => {
  window.localStorage.setItem(
    REMEMBERED_SSO_PROVIDER_KEY,
    JSON.stringify({ v: 1, type, providerId, projectId: ACME }),
  );
};

const renderSso: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <LoginWithSSOPage />
      </MemoryRouter>,
    );
  });
};

const renderProjectLink: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/accounts/sso/${ACME}`]}>
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

const click: (element: HTMLElement) => Promise<void> = async (
  element: HTMLElement,
): Promise<void> => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });

  await act(async () => {
    await user.click(element);
  });
};

const navigatedTo: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map(
    (call: Parameters<typeof Navigation.navigate>) => {
      return call[0].toString();
    },
  );
};

const readLocales: () => Array<{ file: string; sso: JSONObject }> = (): Array<{
  file: string;
  sso: JSONObject;
}> => {
  return fs
    .readdirSync(ACCOUNTS_LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string) => {
      return {
        file: file,
        sso: (
          JSON.parse(
            fs.readFileSync(path.join(ACCOUNTS_LOCALES_DIR, file), "utf8"),
          ) as JSONObject
        )["sso"] as JSONObject,
      };
    });
};

describe("Sign in with SSO offers the provider this device last signed in with", () => {
  beforeEach(() => {
    window.localStorage.clear();
    requestedUrls = [];
    projectAnswer = providers([OKTA_ROW, ENTRA_ROW, COMPANY_IDP_ROW]);
    emailLookupAnswer = [];

    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    jest
      .spyOn(GlobalConfigUtil, "fetchVars")
      .mockImplementation(async (): Promise<GlobalConfigVars> => {
        return {
          disableUserProjectCreation: false,
          disablePushNotifications: false,
          canSendEmail: true,
        };
      });
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
            return toResponse(projectAnswer);
          }

          if (url.endsWith("/sign-in-methods")) {
            return toResponse({
              status: 200,
              data: {
                isSsoRequired: false,
                ssoProviders: [],
                hasProjectSsoProviders: false,
              },
            });
          }

          if (url.includes("/service-provider-login-oidc")) {
            return toResponse({ status: 200, data: [] });
          }

          if (url.includes("/service-provider-login")) {
            return toResponse({ status: 200, data: emailLookupAnswer });
          }

          return toResponse({ status: 404, data: { message: "Not found" } });
        },
      );
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
    await i18n.changeLanguage("en");
  });

  describe("set", () => {
    test("a provider picked on the project's SSO sign-in link is remembered by its kind and ids, and nothing else", async () => {
      await renderProjectLink();
      await click(
        await screen.findByRole("button", { name: signInWith("Okta") }),
      );

      expect(stored()).toEqual({
        v: 1,
        type: SsoProviderType.ProjectSSO,
        providerId: OKTA,
        projectId: ACME,
      });
      expect(navigatedTo()).toEqual([`${IDENTITY_ORIGIN}/sso/${ACME}/${OKTA}`]);
    });

    test("a provider picked from an address's lookup is remembered, and the address never is", async () => {
      emailLookupAnswer = [
        {
          _id: ENTRA,
          name: "Entra ID",
          description: "",
          projectId: ACME,
          project: { _id: ACME, name: "Acme" },
        },
      ];

      // The SAML lookup finds it, the OIDC one nothing.
      await renderSso();

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });
      await user.type(await screen.findByTestId("email"), ADDRESS);
      await act(async () => {
        await user.click(screen.getByTestId("Sign in with SSO"));
      });
      await click(
        await screen.findByRole("button", { name: signInWith("Entra ID") }),
      );

      const value: string = window.localStorage.getItem(
        REMEMBERED_SSO_PROVIDER_KEY,
      )!;

      expect(JSON.parse(value)).toEqual({
        v: 1,
        type: SsoProviderType.ProjectSSO,
        providerId: ENTRA,
        projectId: ACME,
      });
      // Nothing of the address anywhere the browser keeps.
      for (let index: number = 0; index < localStorage.length; index++) {
        const key: string = localStorage.key(index)!;
        expect(localStorage.getItem(key)).not.toContain("gmail");
      }
    });

    test("an instance-wide provider is never remembered: the page lists those anyway", async () => {
      await renderProjectLink();
      await click(
        await screen.findByRole("button", { name: signInWith("Company IdP") }),
      );

      expect(stored()).toBeNull();
      expect(navigatedTo()).toEqual([
        `${IDENTITY_ORIGIN}/global-sso/${COMPANY_IDP}`,
      ]);
    });
  });

  describe("offered", () => {
    test("the next visit offers it first, under the name the server gives it now, one click to its sign-in", async () => {
      remember(SsoProviderType.ProjectOIDC, ENTRA);
      projectAnswer = providers([
        OKTA_ROW,
        { ...ENTRA_ROW, name: "Acme Entra ID" },
      ]);

      await renderSso();

      const lastUsed: HTMLElement = await screen.findByTestId(
        LAST_USED_PROVIDER_TEST_ID,
      );

      expect(lastUsed).toHaveTextContent(english.sso.lastUsedTitle);

      const option: HTMLElement = within(lastUsed).getByTestId(
        LAST_USED_PROVIDER_OPTION_TEST_ID,
      );

      expect(option).toHaveTextContent(signInWith("Acme Entra ID"));

      await click(option);

      expect(navigatedTo()).toEqual([
        `${IDENTITY_ORIGIN}/oidc/${ACME}/${ENTRA}`,
      ]);
    });

    test("the server is asked about the project by its id alone: no address in any request", async () => {
      remember(SsoProviderType.ProjectSSO, OKTA);

      await renderSso();
      await screen.findByTestId(LAST_USED_PROVIDER_TEST_ID);

      expect(requestedUrls).toContain(
        `${IDENTITY_ORIGIN}/project-sign-in-methods/${ACME}`,
      );

      for (const url of requestedUrls) {
        expect(url).not.toMatch(/email|@/);
      }
    });

    test("with nothing remembered, nothing is asked and nothing offered", async () => {
      await renderSso();
      await screen.findByTestId("email");

      expect(
        requestedUrls.filter((url: string): boolean => {
          return url.includes("/project-sign-in-methods/");
        }),
      ).toEqual([]);
      expect(
        screen.queryByTestId(LAST_USED_PROVIDER_TEST_ID),
      ).not.toBeInTheDocument();
    });

    test("a value in the browser that is not one of ours is never asked about", async () => {
      window.localStorage.setItem(
        REMEMBERED_SSO_PROVIDER_KEY,
        JSON.stringify({
          v: 1,
          type: SsoProviderType.ProjectSSO,
          providerId: OKTA,
          projectId: ACME,
          email: ADDRESS,
        }),
      );

      await renderSso();
      await screen.findByTestId("email");

      expect(
        requestedUrls.filter((url: string): boolean => {
          return url.includes("/project-sign-in-methods/");
        }),
      ).toEqual([]);
      expect(
        screen.queryByTestId(LAST_USED_PROVIDER_TEST_ID),
      ).not.toBeInTheDocument();
    });
  });

  describe("cleared", () => {
    test("Forget this provider removes it from the browser and the page, and the focus goes to the page's heading", async () => {
      remember(SsoProviderType.ProjectSSO, OKTA);

      await renderSso();
      await click(await screen.findByTestId(FORGET_LAST_USED_TEST_ID));

      expect(stored()).toBeNull();
      expect(
        screen.queryByTestId(LAST_USED_PROVIDER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 2 }),
      );
      // The rest of the page is as it always was.
      expect(screen.getByTestId("email")).toBeInTheDocument();
    });

    test("the button says what it forgets", async () => {
      remember(SsoProviderType.ProjectSSO, OKTA);

      await renderSso();

      expect(
        await screen.findByTestId(FORGET_LAST_USED_TEST_ID),
      ).toHaveTextContent(english.sso.forgetLastUsed);
    });
  });

  describe("removed or turned off", () => {
    test("a provider the project no longer lists is not offered, and is forgotten", async () => {
      remember(SsoProviderType.ProjectSSO, OKTA);
      projectAnswer = providers([ENTRA_ROW]);

      await renderSso();
      await screen.findByTestId("email");

      expect(
        screen.queryByTestId(LAST_USED_PROVIDER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(stored()).toBeNull();
    });

    test("a project with no provider turned on, or no such project: forgotten", async () => {
      for (const answer of [
        providers([]),
        { status: 400, data: { message: "Invalid project id." } },
      ]) {
        remember(SsoProviderType.ProjectSSO, OKTA);
        projectAnswer = answer;

        await renderSso();
        await screen.findByTestId("email");

        expect(
          screen.queryByTestId(LAST_USED_PROVIDER_TEST_ID),
        ).not.toBeInTheDocument();
        expect(stored()).toBeNull();

        cleanup();
      }
    });

    test("the same id under another kind is not the provider that was picked", async () => {
      remember(SsoProviderType.ProjectOIDC, OKTA);

      await renderSso();
      await screen.findByTestId("email");

      expect(
        screen.queryByTestId(LAST_USED_PROVIDER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(stored()).toBeNull();
    });

    test("a server that could not be asked offers nothing this time, and forgets nothing", async () => {
      for (const status of [500, 502, 429]) {
        remember(SsoProviderType.ProjectSSO, OKTA);
        projectAnswer = { status: status, data: { message: "Unavailable" } };

        await renderSso();
        await screen.findByTestId("email");

        expect(
          screen.queryByTestId(LAST_USED_PROVIDER_TEST_ID),
        ).not.toBeInTheDocument();
        expect(stored()).toEqual({
          v: 1,
          type: SsoProviderType.ProjectSSO,
          providerId: OKTA,
          projectId: ACME,
        });

        cleanup();
      }
    });
  });

  describe("in the visitor's language", () => {
    test("German reads German", async () => {
      await i18n.changeLanguage("de");
      remember(SsoProviderType.ProjectSSO, OKTA);

      await renderSso();

      expect(
        await screen.findByTestId(LAST_USED_PROVIDER_TEST_ID),
      ).toHaveTextContent(german.sso.lastUsedTitle);
      expect(screen.getByTestId(FORGET_LAST_USED_TEST_ID)).toHaveTextContent(
        german.sso.forgetLastUsed,
      );
    });

    test("Persian reads Persian", async () => {
      await i18n.changeLanguage("fa");
      remember(SsoProviderType.ProjectSSO, OKTA);

      await renderSso();

      expect(
        await screen.findByTestId(LAST_USED_PROVIDER_TEST_ID),
      ).toHaveTextContent(persian.sso.lastUsedTitle);
    });

    test("every Accounts locale words the new sentences, each in its own words", () => {
      for (const { file, sso } of readLocales()) {
        for (const key of ["lastUsedTitle", "forgetLastUsed"]) {
          const value: string = String(sso[key] || "");

          expect({ file, key, isWorded: value.length > 0 }).toEqual({
            file,
            key,
            isWorded: true,
          });

          if (file !== "en.json") {
            expect({ file, key, value }).not.toEqual({
              file,
              key,
              value: (english.sso as Record<string, string>)[key],
            });
          }
        }
      }
    });
  });
});
