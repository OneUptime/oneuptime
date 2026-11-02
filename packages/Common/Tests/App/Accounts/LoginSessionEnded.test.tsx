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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  SESSION_ENDED_QUERY_PARAM,
  SessionEndReason,
} from "../../../Types/UserSession/SessionLength";
import LoginUtil from "../../../UI/Utils/Login";
import Navigation from "../../../UI/Utils/Navigation";
import UiAnalytics from "../../../UI/Utils/Analytics";
import UserUtil from "../../../UI/Utils/User";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import SessionEndedNotice, {
  SESSION_ENDED_NOTICE_KEYS,
  SESSION_ENDED_NOTICE_TEST_ID,
} from "../../../../App/FeatureSet/Accounts/src/Components/SessionEndedNotice/SessionEndedNotice";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import LoginWithSSOPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";

/*
 * THE SIGN-IN PAGE SAYS WHY THE PERSON WAS SIGNED OUT.
 *
 * A master admin can end sign-ins after a length of time or a while
 * without use (Admin Dashboard > Settings > Session Length). When the
 * server ends a session for one of them, the Dashboard sends the browser
 * to /accounts/login?sessionEnded=<reason> and keeps the page the person
 * was on. The sign-in page says, above its form, why they were signed out
 * and that signing in again brings them back - and says nothing for any
 * other way of arriving, or a reason it does not know. The single sign-on
 * page, which stands in for the sign-in page while SSO is required, says
 * the same.
 *
 * The pages are rendered for real, with the real Accounts translations;
 * API.get answers how the server signs people in.
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
    IS_ENTERPRISE_EDITION: true,
  };

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
    default: (): React.ReactElement => {
      return <div data-testid="edition-label" />;
    },
  };
});

type Answer = { status: number; data: JSONObject };

const NOT_REQUIRED: Answer = {
  status: 200,
  data: {
    isSsoRequired: false,
    ssoProviders: [],
    hasProjectSsoProviders: false,
  },
};

const SSO_REQUIRED: Answer = {
  status: 200,
  data: {
    isSsoRequired: true,
    ssoProviders: [
      {
        type: SsoProviderType.GlobalSSO,
        id: "44444444-4444-4444-8444-444444444444",
        name: "Okta",
        description: "",
      },
    ],
    hasProjectSsoProviders: false,
  },
};

let signInMethodsAnswer: Answer;

// What the address says, as Navigation.getQueryStringByName reads it.
let query: Record<string, string>;

const renderPage: (page: React.ReactElement) => Promise<void> = async (
  page: React.ReactElement,
): Promise<void> => {
  await act(async () => {
    render(<MemoryRouter>{page}</MemoryRouter>);
  });
};

const notice: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId(SESSION_ENDED_NOTICE_TEST_ID);
};

beforeEach(() => {
  signInMethodsAnswer = NOT_REQUIRED;
  query = {};

  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string => {
      return query[name] || "";
    });
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

        if (url.endsWith("/sign-in-methods")) {
          return new HTTPResponse<JSONObject>(
            signInMethodsAnswer.status,
            signInMethodsAnswer.data,
            {},
          );
        }

        return new HTTPErrorResponse(
          400,
          { message: "No SSO config found for this user" },
          {},
        );
      },
    );
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18n.changeLanguage("en");
});

describe("SessionEndedNotice", () => {
  test.each([
    [SessionEndReason.LengthReached, english.login.sessionEnded.lengthReached],
    [SessionEndReason.Inactive, english.login.sessionEnded.inactive],
  ])(
    "?sessionEnded=%s says why, and that signing in brings them back",
    async (reason: SessionEndReason, copy: string) => {
      query[SESSION_ENDED_QUERY_PARAM] = reason;

      await renderPage(<SessionEndedNotice />);

      expect(notice()).toBeInTheDocument();
      expect(notice()).toHaveTextContent(copy);
    },
  );

  test.each([[""], ["forever"], ["LENGTH-REACHED"], ["inactive "]])(
    "%p says nothing: no reason this page knows",
    async (value: string) => {
      query[SESSION_ENDED_QUERY_PARAM] = value;

      await renderPage(<SessionEndedNotice />);

      expect(notice()).not.toBeInTheDocument();
    },
  );

  test("it is said in the page's language", async () => {
    await i18n.changeLanguage("de");
    query[SESSION_ENDED_QUERY_PARAM] = SessionEndReason.Inactive;

    await renderPage(<SessionEndedNotice />);

    expect(notice()).toHaveTextContent(german.login.sessionEnded.inactive);
  });

  test("each reason has its own key in the Accounts locales", () => {
    expect(SESSION_ENDED_NOTICE_KEYS).toEqual({
      [SessionEndReason.LengthReached]: "login.sessionEnded.lengthReached",
      [SessionEndReason.Inactive]: "login.sessionEnded.inactive",
    });
  });
});

describe("the sign-in page", () => {
  test("says why above the form when the Dashboard sent the person here for it", async () => {
    query[SESSION_ENDED_QUERY_PARAM] = SessionEndReason.LengthReached;

    await renderPage(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: english.login.title }),
    ).toBeInTheDocument();
    expect(notice()).toHaveTextContent(
      english.login.sessionEnded.lengthReached,
    );

    // Above the form: it is the first thing read after the title.
    const password: HTMLElement = screen.getByTestId("password");

    expect(
      notice()!.compareDocumentPosition(password) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("says nothing of it for every other way of arriving", async () => {
    await renderPage(<LoginPage />);

    expect(
      screen.getByRole("heading", { name: english.login.title }),
    ).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
  });
});

describe("the single sign-on page, while SSO is required", () => {
  test("says why too: it stands in for the sign-in page", async () => {
    signInMethodsAnswer = SSO_REQUIRED;
    query[SESSION_ENDED_QUERY_PARAM] = SessionEndReason.Inactive;

    await renderPage(<LoginWithSSOPage />);

    expect(notice()).toHaveTextContent(english.login.sessionEnded.inactive);
  });

  test("and nothing without a reason", async () => {
    signInMethodsAnswer = SSO_REQUIRED;

    await renderPage(<LoginWithSSOPage />);

    expect(notice()).not.toBeInTheDocument();
  });
});
