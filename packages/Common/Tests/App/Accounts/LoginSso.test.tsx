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
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import LoginUtil from "../../../UI/Utils/Login";
import Navigation from "../../../UI/Utils/Navigation";
import UiAnalytics from "../../../UI/Utils/Analytics";
import UserUtil from "../../../UI/Utils/User";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import LoginWithSSOPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";

/*
 * Single sign-on on the Accounts pages, in every edition.
 *
 * SAML and OIDC sign-in are part of every edition, so:
 *   - the password page always offers "Use single sign-on (SSO) instead";
 *   - the SSO page always shows the email form, with the instance-wide
 *     providers it discovers above it. A provider lookup that fails - a 404
 *     from a proxy that does not route /identity, a 402, a 500 - is treated
 *     like one that found nothing: global providers are optional, and an
 *     email with no provider gets the normal "No SSO configuration found"
 *     message. Neither page says anything about an edition or a license.
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true. IDENTITY_URL is pinned to a fixed origin so the
 * sign-in URLs the page starts can be compared exactly.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const url: { default: { fromString: (value: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL") as {
      default: { fromString: (value: string) => unknown };
    };

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  Object.defineProperty(mocked, "IS_ENTERPRISE_EDITION", {
    get: (): boolean => {
      return enterpriseEditionForTest;
    },
  });

  Object.defineProperty(mocked, "IDENTITY_URL", {
    get: (): unknown => {
      return url.default.fromString("https://oneuptime.example.com/identity");
    },
  });

  return mocked;
});

jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

const IDENTITY_ORIGIN: string = "https://oneuptime.example.com/identity";
const USE_SSO_LINK: string = english.login.useSso;
const USE_PASSWORD_LINK: string = english.sso.useUsernameInstead;
const PROJECT_A: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_B: string = "22222222-2222-4222-8222-222222222222";
const PROVIDER_1: string = "33333333-3333-4333-8333-333333333333";
const PROVIDER_2: string = "44444444-4444-4444-8444-444444444444";

// What neither page may say about single sign-on any more.
const EDITION_OR_LICENSE_WORDING: RegExp =
  /Enterprise|Community Edition|licen[cs]e|not available on this server/i;

// The notice the SSO page showed when every lookup answered 404 or 402, retired.
const RETIRED_NOTICE_TEXT: string =
  "Single sign-on (SSO) is not available on this server: it needs the OneUptime Enterprise Edition with an active license. Sign in with your email and password instead.";

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

const readAccountsSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(ACCOUNTS_SRC, relativePath), "utf8");
};

/*
 * The edition plumbing the sign-in pages had: whichever of these a page's
 * source contains.
 */
const RETIRED_EDITION_LOGIC: Array<string> = [
  "IS_ENTERPRISE_EDITION",
  "BILLING_ENABLED",
  "SsoAvailability",
  "isSsoLoginOffered",
  "isSsoUnavailableStatusCode",
  "areAllLookupsUnavailable",
  "isSsoUnavailable",
  "sso.enterpriseEditionRequired",
  "sso-enterprise-edition-required",
  "Enterprise Edition",
];

const retiredEditionLogicIn: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  return RETIRED_EDITION_LOGIC.filter((token: string) => {
    return source.includes(token);
  });
};

// Every key the two pages read for single sign-on.
const SSO_LOCALE_KEYS: Array<string> = [
  "login.useSso",
  "sso.title",
  "sso.subtitle",
  "sso.submitButton",
  "sso.useUsernameInstead",
  "sso.noAccountPrompt",
  "sso.registerLink",
  "sso.selectProjectTitle",
  "sso.selectProjectSubtitle",
  "sso.noConfigForEmail",
  "sso.emailRequired",
  "sso.defaultProjectName",
  "sso.globalProvidersTitle",
  "sso.globalProvidersDivider",
];

const localeValue: (locale: JSONObject, key: string) => unknown = (
  locale: JSONObject,
  key: string,
): unknown => {
  return key.split(".").reduce((value: unknown, part: string): unknown => {
    return value && typeof value === "object"
      ? (value as JSONObject)[part]
      : undefined;
  }, locale as unknown);
};

const readLocales: () => Array<{
  file: string;
  locale: JSONObject;
}> = (): Array<{ file: string; locale: JSONObject }> => {
  return fs
    .readdirSync(ACCOUNTS_LOCALES_DIR)
    .filter((file: string) => {
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

type LookupAnswer = { status: number; data: Array<JSONObject> | JSONObject };

let globalSamlAnswer: LookupAnswer;
let globalOidcAnswer: LookupAnswer;
let emailSamlAnswer: LookupAnswer;
let emailOidcAnswer: LookupAnswer;
let requestedUrls: Array<string>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

const toResponse: (
  answer: LookupAnswer,
) => HTTPResponse<JSONObject> | HTTPErrorResponse = (
  answer: LookupAnswer,
): HTTPResponse<JSONObject> | HTTPErrorResponse => {
  if (answer.status >= 400) {
    return new HTTPErrorResponse(answer.status, answer.data, {});
  }

  return new HTTPResponse<JSONObject>(answer.status, answer.data, {});
};

const NOT_ROUTED: LookupAnswer = {
  status: 404,
  data: { message: "Page not found - /identity/..." },
};
const PAYMENT_REQUIRED: LookupAnswer = {
  status: 402,
  data: { message: "Payment required" },
};
const SERVER_ERROR: LookupAnswer = { status: 500, data: { message: "boom" } };
const NO_PROVIDERS: LookupAnswer = { status: 200, data: [] };
const NO_CONFIG_FOR_EMAIL: LookupAnswer = {
  status: 400,
  data: { message: "No SSO config found for this user" },
};

const FAILED_LOOKUPS: Array<{ name: string; answer: LookupAnswer }> = [
  { name: "404 (not routed)", answer: NOT_ROUTED },
  { name: "402", answer: PAYMENT_REQUIRED },
  { name: "400", answer: NO_CONFIG_FOR_EMAIL },
  { name: "500", answer: SERVER_ERROR },
];

interface EditionCase {
  name: string;
  enterprise: boolean;
  billing: boolean;
}

const EDITIONS: Array<EditionCase> = [
  { name: "the Community Edition", enterprise: false, billing: false },
  {
    name: "the Community Edition image with billing on",
    enterprise: false,
    billing: true,
  },
  { name: "the Enterprise Edition", enterprise: true, billing: false },
  {
    name: "OneUptime Cloud (Enterprise Edition, billing on)",
    enterprise: true,
    billing: true,
  },
];

const renderLogin: () => void = (): void => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
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

const submitEmail: (email: string) => Promise<void> = async (
  email: string,
): Promise<void> => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });

  await user.type(await screen.findByTestId("email"), email);

  await act(async () => {
    await user.click(screen.getByTestId("Login with SSO"));
  });
};

const clickProvider: (name: string) => Promise<void> = async (
  name: string,
): Promise<void> => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });

  await act(async () => {
    await user.click(await screen.findByText(name));
  });
};

// Where the page sent the browser, as the URL it built.
const navigatedTo: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map(
    (call: Parameters<typeof Navigation.navigate>) => {
      return call[0].toString();
    },
  );
};

// The SSO page as it is when nothing has been found yet: the email form.
const expectEmailForm: () => void = (): void => {
  expect(screen.getByTestId("email")).toBeInTheDocument();
  expect(screen.getByText(english.sso.subtitle)).toBeInTheDocument();
  expect(screen.getByText(USE_PASSWORD_LINK).closest("a")).toHaveAttribute(
    "href",
    "/accounts/login",
  );
  expect(
    screen.queryByTestId("sso-enterprise-edition-required"),
  ).not.toBeInTheDocument();
  expect(document.body.textContent || "").not.toMatch(
    EDITION_OR_LICENSE_WORDING,
  );
};

describe("Accounts single sign-on, in every edition", () => {
  beforeEach(() => {
    billingEnabledForTest = false;
    enterpriseEditionForTest = false;
    requestedUrls = [];
    globalSamlAnswer = NO_PROVIDERS;
    globalOidcAnswer = NO_PROVIDERS;
    emailSamlAnswer = NO_CONFIG_FOR_EMAIL;
    emailOidcAnswer = NO_CONFIG_FOR_EMAIL;

    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    navigateSpy = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});
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

          if (url.includes("/global-sso/service-provider-login")) {
            return toResponse(globalSamlAnswer);
          }

          if (url.includes("/global-oidc/service-provider-login")) {
            return toResponse(globalOidcAnswer);
          }

          if (url.includes("/service-provider-login-oidc")) {
            return toResponse(emailOidcAnswer);
          }

          if (url.includes("/service-provider-login")) {
            return toResponse(emailSamlAnswer);
          }

          return toResponse(NOT_ROUTED);
        },
      );
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();
    billingEnabledForTest = false;
    enterpriseEditionForTest = false;
    await i18n.changeLanguage("en");
  });

  describe("password sign-in page", () => {
    test.each(EDITIONS)(
      "$name offers single sign-on",
      async (edition: EditionCase) => {
        enterpriseEditionForTest = edition.enterprise;
        billingEnabledForTest = edition.billing;

        renderLogin();

        expect(await screen.findByTestId("email")).toBeInTheDocument();
        expect(screen.getByTestId("password")).toBeInTheDocument();
        expect(screen.getByText(USE_SSO_LINK).closest("a")).toHaveAttribute(
          "href",
          "/accounts/sso",
        );
      },
    );

    test("the link is translated: German gets the German text", async () => {
      await i18n.changeLanguage("de");

      renderLogin();

      expect(await screen.findByText(german.login.useSso)).toBeInTheDocument();
      expect(german.login.useSso).not.toBe(USE_SSO_LINK);
    });
  });

  describe("SSO sign-in page", () => {
    test.each(EDITIONS)(
      "$name shows the email form, and nothing about an edition or a license",
      async (edition: EditionCase) => {
        enterpriseEditionForTest = edition.enterprise;
        billingEnabledForTest = edition.billing;

        await renderSso();

        expectEmailForm();
        // Instance-wide providers are looked up as the page opens.
        expect(
          requestedUrls.filter((url: string) => {
            return (
              url === `${IDENTITY_ORIGIN}/global-sso/service-provider-login` ||
              url === `${IDENTITY_ORIGIN}/global-oidc/service-provider-login`
            );
          }),
        ).toHaveLength(2);
      },
    );

    test.each(FAILED_LOOKUPS)(
      "provider discovery answering $name: the email form, and no notice",
      async (failure: { name: string; answer: LookupAnswer }) => {
        globalSamlAnswer = failure.answer;
        globalOidcAnswer = failure.answer;

        await renderSso();

        expectEmailForm();
        expect(
          screen.queryByText(english.sso.globalProvidersTitle),
        ).not.toBeInTheDocument();
      },
    );

    test.each([
      ["404 (not routed)", NOT_ROUTED],
      ["402", PAYMENT_REQUIRED],
      ["400 (no provider for the email)", NO_CONFIG_FOR_EMAIL],
    ])(
      "an email both lookups answer with %s: the normal 'no SSO configuration' message",
      async (_name: string, answer: LookupAnswer) => {
        globalSamlAnswer = answer;
        globalOidcAnswer = answer;
        emailSamlAnswer = answer;
        emailOidcAnswer = answer;

        await renderSso();
        await submitEmail("ada@example.com");

        expect(
          await screen.findByText(
            "No SSO configuration found for the email: ada@example.com",
          ),
        ).toBeInTheDocument();
        expectEmailForm();
        // Both email lookups were made, at their unchanged paths.
        expect(requestedUrls).toEqual(
          expect.arrayContaining([
            `${IDENTITY_ORIGIN}/service-provider-login?email=ada@example.com`,
            `${IDENTITY_ORIGIN}/service-provider-login-oidc?email=ada@example.com`,
          ]),
        );
      },
    );

    test("lists the instance-wide SAML and OIDC providers as it opens", async () => {
      globalSamlAnswer = {
        status: 200,
        data: [{ _id: PROVIDER_1, name: "Okta (company-wide)" }],
      };
      globalOidcAnswer = {
        status: 200,
        data: [{ _id: PROVIDER_2, name: "Google Workspace" }],
      };

      await renderSso();

      expect(
        await screen.findByText(english.sso.globalProvidersTitle),
      ).toBeInTheDocument();
      expect(screen.getByText("Okta (company-wide)")).toBeInTheDocument();
      expect(screen.getByText("Google Workspace")).toBeInTheDocument();
      expect(
        screen.getByText(english.sso.globalProvidersDivider),
      ).toBeInTheDocument();
      // The email form stays below them.
      expectEmailForm();
    });

    test("an instance-wide SAML provider starts its sign-in at /identity/global-sso", async () => {
      globalSamlAnswer = {
        status: 200,
        data: [{ _id: PROVIDER_1, name: "Okta (company-wide)" }],
      };

      await renderSso();
      await clickProvider("Okta (company-wide)");

      expect(navigatedTo()).toEqual([
        `${IDENTITY_ORIGIN}/global-sso/${PROVIDER_1}`,
      ]);
    });

    test("an instance-wide OIDC provider starts its sign-in at /identity/global-oidc", async () => {
      globalOidcAnswer = {
        status: 200,
        data: [{ _id: PROVIDER_2, name: "Google Workspace" }],
      };

      await renderSso();
      await clickProvider("Google Workspace");

      expect(navigatedTo()).toEqual([
        `${IDENTITY_ORIGIN}/global-oidc/${PROVIDER_2}`,
      ]);
    });

    test("an email's providers are grouped by project", async () => {
      emailSamlAnswer = {
        status: 200,
        data: [
          {
            _id: PROVIDER_1,
            name: "Okta",
            projectId: PROJECT_A,
            project: { _id: PROJECT_A, name: "Acme" },
          },
        ],
      };
      emailOidcAnswer = {
        status: 200,
        data: [
          {
            _id: PROVIDER_2,
            name: "Entra ID",
            projectId: PROJECT_B,
            project: { _id: PROJECT_B, name: "Globex" },
          },
        ],
      };

      await renderSso();
      await submitEmail("ada@example.com");

      expect(
        await screen.findByText(english.sso.selectProjectTitle),
      ).toBeInTheDocument();
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.getByText("Globex")).toBeInTheDocument();
      expect(screen.getByText("Okta")).toBeInTheDocument();
      expect(screen.getByText("Entra ID")).toBeInTheDocument();
      expect(document.body.textContent || "").not.toMatch(
        EDITION_OR_LICENSE_WORDING,
      );
    });

    test("a project's SAML provider starts its sign-in at /identity/sso/<project>/<provider>", async () => {
      emailSamlAnswer = {
        status: 200,
        data: [{ _id: PROVIDER_1, name: "Okta", projectId: PROJECT_A }],
      };

      await renderSso();
      await submitEmail("ada@example.com");
      await clickProvider("Okta");

      expect(navigatedTo()).toEqual([
        `${IDENTITY_ORIGIN}/sso/${PROJECT_A}/${PROVIDER_1}`,
      ]);
    });

    test("a project's OIDC provider starts its sign-in at /identity/oidc/<project>/<provider>", async () => {
      emailOidcAnswer = {
        status: 200,
        data: [{ _id: PROVIDER_2, name: "Entra ID", projectId: PROJECT_B }],
      };

      await renderSso();
      await submitEmail("ada@example.com");
      await clickProvider("Entra ID");

      expect(navigatedTo()).toEqual([
        `${IDENTITY_ORIGIN}/oidc/${PROJECT_B}/${PROVIDER_2}`,
      ]);
    });

    test("one lookup answering 404 does not hide the other's providers", async () => {
      emailSamlAnswer = NOT_ROUTED;
      emailOidcAnswer = {
        status: 200,
        data: [{ _id: PROVIDER_2, name: "Entra ID", projectId: PROJECT_B }],
      };

      await renderSso();
      await submitEmail("ada@example.com");

      expect(await screen.findByText("Entra ID")).toBeInTheDocument();
      expect(
        screen.queryByText(/No SSO configuration found/),
      ).not.toBeInTheDocument();
    });

    test("an email is required", async () => {
      await renderSso();

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });

      await act(async () => {
        await user.click(screen.getByTestId("Login with SSO"));
      });

      expect(
        requestedUrls.some((url: string) => {
          return url.includes("email=");
        }),
      ).toBe(false);
    });
  });

  describe("no edition logic is left in the sign-in pages", () => {
    test("Login and LoginWithSSO read no edition, billing flag or license state", () => {
      for (const page of ["Pages/Login.tsx", "Pages/LoginWithSSO.tsx"]) {
        expect({
          page,
          retired: retiredEditionLogicIn(readAccountsSource(page)),
        }).toEqual({ page, retired: [] });
      }

      expect(
        fs.existsSync(path.join(ACCOUNTS_SRC, "Utils/SsoAvailability.ts")),
      ).toBe(false);
    });

    test("the password page links to the SSO page unconditionally", () => {
      const source: string = readAccountsSource("Pages/Login.tsx");

      expect(source).toContain('<Link to={new Route("/accounts/sso")}>');
      expect(source).toContain('{t("login.useSso")}');
    });

    test("the check catches the retired edition gate and notice (negative control)", () => {
      const retiredLogin: string = `import { isSsoLoginOffered } from "../Utils/SsoAvailability";
        footer={isSsoLoginOffered() ? <Link to={new Route("/accounts/sso")} /> : undefined}`;
      const retiredSsoPage: string = `const [isSsoUnavailable, setIsSsoUnavailable] = useState<boolean>(false);
        <div data-testid="sso-enterprise-edition-required">{t("sso.enterpriseEditionRequired")}</div>`;

      expect(retiredEditionLogicIn(retiredLogin)).toEqual([
        "SsoAvailability",
        "isSsoLoginOffered",
      ]);
      expect(retiredEditionLogicIn(retiredSsoPage)).toEqual([
        "isSsoUnavailable",
        "sso.enterpriseEditionRequired",
        "sso-enterprise-edition-required",
      ]);
      expect(EDITION_OR_LICENSE_WORDING.test(RETIRED_NOTICE_TEXT)).toBe(true);
    });
  });

  describe("the Accounts locales", () => {
    test("every locale has the strings the two pages use for single sign-on", () => {
      const locales: Array<{ file: string; locale: JSONObject }> =
        readLocales();

      expect(locales).toHaveLength(17);

      for (const { file, locale } of locales) {
        for (const key of SSO_LOCALE_KEYS) {
          const value: unknown = localeValue(locale, key);

          expect({ file, key, type: typeof value }).toEqual({
            file,
            key,
            type: "string",
          });
          expect({ file, key, empty: (value as string).trim() === "" }).toEqual(
            { file, key, empty: false },
          );
        }

        expect({
          file,
          placeholder: String(localeValue(locale, "sso.noConfigForEmail")),
        }).toEqual({ file, placeholder: expect.stringContaining("{{email}}") });
      }
    });

    /*
     * The explanation that SSO needs the Enterprise Edition with an active
     * license is no longer true anywhere, and no page renders it.
     */
    test("no locale keeps the retired 'SSO needs the Enterprise Edition' explanation", () => {
      for (const { file, locale } of readLocales()) {
        expect({
          file,
          value: localeValue(locale, "sso.enterpriseEditionRequired"),
        }).toEqual({ file, value: undefined });
      }
    });
  });
});
