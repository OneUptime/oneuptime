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
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import LoginWithSSOPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";
import {
  isSsoLoginOffered,
  isSsoUnavailableStatusCode,
} from "../../../../App/FeatureSet/Accounts/src/Utils/SsoAvailability";

/*
 * Sign-in surfaces on the Community Edition (design v2 section 0/5).
 *
 * SSO login is part of the Enterprise Edition, which the cloud also runs. So:
 *   - the password page offers "Use single sign-on (SSO) instead" only when
 *     the EFFECTIVE edition (env.js IS_ENTERPRISE_EDITION, true only when the
 *     enterprise code is loaded) is Enterprise, or billing is on;
 *   - the SSO page, reached directly on a Community Edition server, gets 404
 *     (or 402) from every provider lookup and explains that SSO is part of
 *     the Enterprise Edition, instead of "no SSO configuration found".
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;
let enterpriseEditionForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

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

const USE_SSO_LINK: string = "Use single sign-on (SSO) instead";
const ENTERPRISE_NOTICE: RegExp =
  /Single sign-on \(SSO\) is part of the OneUptime Enterprise Edition/;
const USE_PASSWORD_LINK: string = "Use username and password instead.";

type LookupAnswer = { status: number; data: Array<JSONObject> | JSONObject };

let globalSamlAnswer: LookupAnswer;
let globalOidcAnswer: LookupAnswer;
let emailSamlAnswer: LookupAnswer;
let emailOidcAnswer: LookupAnswer;
let requestedUrls: Array<string>;

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

const NOT_SERVED: LookupAnswer = {
  status: 404,
  data: { message: "Page not found - /identity/..." },
};
const NO_PROVIDERS: LookupAnswer = { status: 200, data: [] };
const NO_CONFIG_FOR_EMAIL: LookupAnswer = {
  status: 400,
  data: { message: "No SSO config found for this user" },
};

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

describe("Accounts sign-in on the Community and Enterprise Editions", () => {
  beforeEach(() => {
    billingEnabledForTest = false;
    enterpriseEditionForTest = false;
    requestedUrls = [];
    globalSamlAnswer = NO_PROVIDERS;
    globalOidcAnswer = NO_PROVIDERS;
    emailSamlAnswer = NO_CONFIG_FOR_EMAIL;
    emailOidcAnswer = NO_CONFIG_FOR_EMAIL;

    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
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

          return toResponse(NOT_SERVED);
        },
      );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    billingEnabledForTest = false;
    enterpriseEditionForTest = false;
  });

  describe("SsoAvailability", () => {
    test.each([
      [false, false, false],
      [true, false, true],
      [false, true, true],
      [true, true, true],
    ])(
      "IS_ENTERPRISE_EDITION=%p, BILLING_ENABLED=%p -> SSO offered: %p",
      (enterprise: boolean, billing: boolean, offered: boolean) => {
        enterpriseEditionForTest = enterprise;
        billingEnabledForTest = billing;

        expect(isSsoLoginOffered()).toBe(offered);
      },
    );

    test.each([
      [404, true],
      [402, true],
      [400, false],
      [401, false],
      [403, false],
      [500, false],
      [200, false],
    ])(
      "status %p means 'this server has no SSO login': %p",
      (statusCode: number, unavailable: boolean) => {
        expect(isSsoUnavailableStatusCode(statusCode)).toBe(unavailable);
      },
    );
  });

  describe("password sign-in page", () => {
    test("the Community Edition does not offer SSO", async () => {
      renderLogin();

      expect(await screen.findByTestId("email")).toBeInTheDocument();
      expect(screen.getByTestId("password")).toBeInTheDocument();
      expect(screen.queryByText(USE_SSO_LINK)).not.toBeInTheDocument();
    });

    test("the Enterprise Edition offers SSO", async () => {
      enterpriseEditionForTest = true;
      renderLogin();

      expect(await screen.findByTestId("email")).toBeInTheDocument();
      expect(screen.getByText(USE_SSO_LINK)).toBeInTheDocument();
      expect(screen.getByText(USE_SSO_LINK).closest("a")).toHaveAttribute(
        "href",
        "/accounts/sso",
      );
    });

    test("the cloud (billing on) offers SSO", async () => {
      billingEnabledForTest = true;
      renderLogin();

      expect(await screen.findByTestId("email")).toBeInTheDocument();
      expect(screen.getByText(USE_SSO_LINK)).toBeInTheDocument();
    });
  });

  describe("SSO sign-in page", () => {
    test("on the Community Edition (the provider routes answer 404) it explains SSO is an Enterprise Edition feature", async () => {
      globalSamlAnswer = NOT_SERVED;
      globalOidcAnswer = NOT_SERVED;

      await renderSso();

      expect(
        await screen.findByTestId("sso-enterprise-edition-required"),
      ).toBeInTheDocument();
      expect(screen.getByText(ENTERPRISE_NOTICE)).toBeInTheDocument();
      expect(screen.getByText(USE_PASSWORD_LINK).closest("a")).toHaveAttribute(
        "href",
        "/accounts/login",
      );
      // No email form to fill in for a lookup that cannot succeed.
      expect(screen.queryByTestId("email")).not.toBeInTheDocument();
    });

    test("a 402 from the provider routes is explained the same way", async () => {
      globalSamlAnswer = { status: 402, data: { message: "Payment required" } };
      globalOidcAnswer = { status: 402, data: { message: "Payment required" } };

      await renderSso();

      expect(
        await screen.findByTestId("sso-enterprise-edition-required"),
      ).toBeInTheDocument();
    });

    test("when only the email lookups answer 404, submitting the email shows the explanation", async () => {
      emailSamlAnswer = NOT_SERVED;
      emailOidcAnswer = NOT_SERVED;

      await renderSso();
      await submitEmail("ada@example.com");

      expect(
        await screen.findByTestId("sso-enterprise-edition-required"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/No SSO configuration found/),
      ).not.toBeInTheDocument();
    });

    test("on the Enterprise Edition the email form is shown, and an unknown email gets the normal message", async () => {
      await renderSso();

      expect(
        screen.queryByTestId("sso-enterprise-edition-required"),
      ).not.toBeInTheDocument();

      await submitEmail("ada@example.com");

      expect(
        await screen.findByText(
          "No SSO configuration found for the email: ada@example.com",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("sso-enterprise-edition-required"),
      ).not.toBeInTheDocument();
      expect(
        requestedUrls.some((url: string) => {
          return url.includes("/service-provider-login?email=");
        }),
      ).toBe(true);
    });

    test("one lookup answering 404 is not enough: the other may still have providers", async () => {
      emailSamlAnswer = NOT_SERVED;
      emailOidcAnswer = {
        status: 200,
        data: [
          {
            _id: "99999999-9999-4999-8999-999999999999",
            name: "Entra ID",
            projectId: "11111111-1111-4111-8111-111111111111",
          },
        ],
      };

      await renderSso();
      await submitEmail("ada@example.com");

      expect(await screen.findByText("Entra ID")).toBeInTheDocument();
      expect(
        screen.queryByTestId("sso-enterprise-edition-required"),
      ).not.toBeInTheDocument();
    });

    test("a server error is not mistaken for the Community Edition", async () => {
      globalSamlAnswer = { status: 500, data: { message: "boom" } };
      globalOidcAnswer = { status: 500, data: { message: "boom" } };

      await renderSso();

      expect(await screen.findByTestId("email")).toBeInTheDocument();
      expect(
        screen.queryByTestId("sso-enterprise-edition-required"),
      ).not.toBeInTheDocument();
    });
  });
});
