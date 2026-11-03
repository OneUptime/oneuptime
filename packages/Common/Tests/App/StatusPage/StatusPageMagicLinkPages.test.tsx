import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES } from "../../../Types/StatusPage/StatusPageMagicLink";
import { getSignInOptionClassName } from "../../../UI/Components/SignInOption/SignInOptionStyle";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import english from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";

/*
 * A private status page's sign-in links, as its readers meet them (#5600):
 *
 *  - "Email me a sign-in link" on the sign-in page, under "or", where the
 *    page offers links;
 *  - "Log in with a link": their address, then "Check your email" - the
 *    same answer whoever they are, so it says "if";
 *  - the page the link opens, which signs in only when they press Log in
 *    (mail filters open links to scan them), lands them where they were
 *    going, and offers a new link when the server refuses this one.
 *
 * The real pages and the real StatusPageUtil; only the network, the page's
 * form API and the status page's words are stubbed. Copy resolves against
 * the status page's real en.json - a missing key renders as the key.
 */

jest.mock("react-i18next", () => {
  const locale: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (
    key: string,
    options?: Record<string, unknown>,
  ) => string = (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = locale;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof node !== "string") {
      // A flat key, as the shared form components look their words up.
      const flat: unknown = locale[key];
      return typeof flat === "string" ? flat : key;
    }

    return node.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => {
      return String(options?.[name] ?? "");
    });
  };

  return {
    useTranslation: () => {
      return {
        t: translate,
        i18n: {
          resolvedLanguage: "en",
          language: "en",
          dir: (): string => {
            return "ltr";
          },
        },
      };
    },
  };
});

const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      getList: async (): Promise<{ data: Array<unknown>; count: number }> => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import API from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import LoginUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/Login";
import StatusPageUtil, {
  MAGIC_LINK_REDIRECT_STORAGE_KEY,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import UserUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import StatusPageInTab from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPageInTab";
import LoginPage, {
  MAGIC_LINK_SIGN_IN_OPTION_TEST_ID,
} from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/Login";
import MagicLinkPage, {
  MAGIC_LINK_FORM_TEST_ID,
  MAGIC_LINK_SEND_ANOTHER_TEST_ID,
  MAGIC_LINK_SENT_TEST_ID,
} from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/MagicLink";
import MagicLinkLoginPage, {
  MAGIC_LINK_LOGIN_BUTTON_TEST_ID,
  MAGIC_LINK_LOGIN_ERROR_TEST_ID,
  MAGIC_LINK_LOGIN_NEW_LINK_TEST_ID,
} from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/MagicLinkLogin";

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-000000000100",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-000000000101",
);
const LOGO_FILE_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-000000000200",
);
const TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";
const SENSITIVE_URL_TOKEN_KEY: string = "oneuptime-sensitive-url-token";
const INCIDENT: string = "/incidents/57000000-0000-4000-8000-000000000300";
const PAGE_NAME: string = "Customer Status";

let isPreview: boolean = false;
let currentStatusPageId: ObjectID = STATUS_PAGE_ID;

function navigatedTo(): Array<string> {
  return jest
    .mocked(Navigation.navigate)
    .mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as Route).toString();
    });
}

function magicLinkRedirectKey(statusPageId: ObjectID = STATUS_PAGE_ID): string {
  return `${MAGIC_LINK_REDIRECT_STORAGE_KEY}-${statusPageId.toString()}`;
}

beforeEach(() => {
  isPreview = false;
  currentStatusPageId = STATUS_PAGE_ID;
  window.sessionStorage.clear();
  window.localStorage.clear();
  createOrUpdateMock.mockReset();

  getJestSpyOn(StatusPageUtil, "getStatusPageId").mockImplementation(
    (): ObjectID => {
      return currentStatusPageId;
    },
  );
  getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(true);
  getJestSpyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(false);
  getJestSpyOn(StatusPageUtil, "isMasterPasswordValidated").mockReturnValue(
    true,
  );
  getJestSpyOn(StatusPageUtil, "getSafeRedirectUrl").mockReturnValue(null);
  getJestSpyOn(StatusPageUtil, "isPreviewPage").mockImplementation(
    (): boolean => {
      return isPreview;
    },
  );
  getJestSpyOn(
    StatusPageUtil,
    "navigateToMasterPasswordPage",
  ).mockImplementation(() => {});
  getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the sign-in page: 'Email me a sign-in link' under 'or'", () => {
  const renderLogin: (options: {
    enableMagicLinkLogin: boolean;
    hasEnabledSSOConfig?: boolean;
  }) => Promise<void> = async (options: {
    enableMagicLinkLogin: boolean;
    hasEnabledSSOConfig?: boolean;
  }): Promise<void> => {
    await act(async () => {
      render(
        <LoginPage
          statusPageName={PAGE_NAME}
          logoFileId={LOGO_FILE_ID}
          forceSSO={false}
          hasEnabledSSOConfig={Boolean(options.hasEnabledSSOConfig)}
          enableMagicLinkLogin={options.enableMagicLinkLogin}
        />,
      );
    });
  };

  test("where the page offers links: an outlined button, named for what it does, to the page that asks for one", async () => {
    await renderLogin({ enableMagicLinkLogin: true });

    const option: HTMLElement = screen.getByTestId(
      MAGIC_LINK_SIGN_IN_OPTION_TEST_ID,
    );

    expect(screen.getByTestId("sign-in-options-divider")).toHaveTextContent(
      /^or$/,
    );
    expect(option.tagName).toBe("A");
    expect(option).toHaveAttribute("href", "/magic-link");
    expect(option).toHaveAccessibleName(english.accounts.login.emailSignInLink);

    for (const name of getSignInOptionClassName("ready").split(" ")) {
      expect(option).toHaveClass(name);
    }

    expect(option.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  test("the password form stays as it is, with Login above the other ways in", async () => {
    await renderLogin({ enableMagicLinkLogin: true });

    const login: HTMLElement = screen.getByTestId(
      english.accounts.login.submit,
    );

    expect(screen.getByLabelText(english.accounts.shared.email)).toBeVisible();
    expect(
      document.querySelector('input[type="password"]'),
    ).toBeInTheDocument();
    expect(
      login.compareDocumentPosition(
        screen.getByTestId(MAGIC_LINK_SIGN_IN_OPTION_TEST_ID),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("beside single sign-on: one 'or', SSO first, then the link", async () => {
    await renderLogin({
      enableMagicLinkLogin: true,
      hasEnabledSSOConfig: true,
    });

    const sso: HTMLElement = screen.getByTestId("sso-login");
    const link: HTMLElement = screen.getByTestId(
      MAGIC_LINK_SIGN_IN_OPTION_TEST_ID,
    );

    expect(screen.getAllByTestId("sign-in-options-divider")).toHaveLength(1);
    expect(
      sso.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("where the page offers none: no button, and no 'or' without SSO", async () => {
    await renderLogin({ enableMagicLinkLogin: false });

    expect(
      screen.queryByTestId(MAGIC_LINK_SIGN_IN_OPTION_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("sign-in-options-divider"),
    ).not.toBeInTheDocument();
  });

  test("where the page offers none but has SSO: only SSO", async () => {
    await renderLogin({
      enableMagicLinkLogin: false,
      hasEnabledSSOConfig: true,
    });

    expect(screen.getByTestId("sso-login")).toBeInTheDocument();
    expect(
      screen.queryByTestId(MAGIC_LINK_SIGN_IN_OPTION_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("keeps where the reader was going", async () => {
    getJestSpyOn(StatusPageUtil, "getSafeRedirectUrl").mockReturnValue(
      INCIDENT,
    );

    await renderLogin({ enableMagicLinkLogin: true });

    expect(
      screen.getByTestId(MAGIC_LINK_SIGN_IN_OPTION_TEST_ID),
    ).toHaveAttribute(
      "href",
      `/magic-link?redirectUrl=${encodeURIComponent(INCIDENT)}`,
    );
  });

  test("in the Dashboard's preview, it opens the preview's page", async () => {
    isPreview = true;

    await renderLogin({ enableMagicLinkLogin: true });

    expect(
      screen.getByTestId(MAGIC_LINK_SIGN_IN_OPTION_TEST_ID),
    ).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/magic-link`,
    );
  });
});

describe("'Log in with a link': the address, then 'Check your email'", () => {
  const renderMagicLink: (
    options?: Partial<{ enableMagicLinkLogin: boolean; forceSSO: boolean }>,
  ) => Promise<void> = async (
    options: Partial<{ enableMagicLinkLogin: boolean; forceSSO: boolean }> = {},
  ): Promise<void> => {
    await act(async () => {
      render(
        <MagicLinkPage
          statusPageName={PAGE_NAME}
          logoFileId={LOGO_FILE_ID}
          forceSSO={Boolean(options.forceSSO)}
          enableMagicLinkLogin={options.enableMagicLinkLogin !== false}
        />,
      );
    });
  };

  const askFor: (email: string) => Promise<void> = async (
    email: string,
  ): Promise<void> => {
    createOrUpdateMock.mockResolvedValue({ data: {} });

    await act(async () => {
      fireEvent.change(screen.getByLabelText(english.accounts.shared.email), {
        target: { value: email },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId(english.accounts.magicLink.submit));
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
  };

  test("says what it does, for this page, and asks for one thing: the address", async () => {
    await renderMagicLink();

    expect(
      screen.getByRole("heading", { name: english.accounts.magicLink.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        english.accounts.magicLink.description.replace(
          "{{statusPageName}}",
          PAGE_NAME,
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(english.accounts.shared.email)).toBeVisible();
    expect(
      screen.queryByLabelText(english.accounts.shared.password),
    ).not.toBeInTheDocument();
  });

  test("asks the page's identity API for a link to that address, on this page", async () => {
    await renderMagicLink();
    await askFor("reader@example.com");

    const call: {
      model: { email?: { toString: () => string }; statusPageId?: ObjectID };
      requestOptions?: { overrideRequestUrl?: URL };
    } = (
      createOrUpdateMock.mock.calls[0] as Array<{
        model: {
          email?: { toString: () => string };
          statusPageId?: ObjectID;
        };
        requestOptions?: { overrideRequestUrl?: URL };
      }>
    )[0]!;

    expect(call.model.email?.toString()).toBe("reader@example.com");
    expect(call.model.statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(
      new globalThis.URL(call.requestOptions!.overrideRequestUrl!.toString())
        .pathname,
    ).toMatch(/\/send-magic-link$/);
  });

  test("then says to check that inbox - 'if' the address can log in - and for how long the link works", async () => {
    await renderMagicLink();
    await askFor("reader@example.com");

    const sent: HTMLElement = await screen.findByTestId(
      MAGIC_LINK_SENT_TEST_ID,
    );

    expect(
      screen.getByRole("heading", {
        name: english.accounts.magicLink.sentTitle,
      }),
    ).toBeInTheDocument();
    expect(sent).toHaveTextContent(
      `If reader@example.com can log in to ${PAGE_NAME}, a sign-in link is on its way. It works once and expires in ${STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES} minutes.`,
    );
    expect(sent).toHaveTextContent(english.accounts.magicLink.notReceived);
    expect(sent).toHaveAttribute("role", "status");
    expect(
      screen.queryByTestId(MAGIC_LINK_FORM_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("'Send another link' brings back an empty form", async () => {
    await renderMagicLink();
    await askFor("reader@example.com");

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId(MAGIC_LINK_SEND_ANOTHER_TEST_ID),
      );
    });

    expect(screen.getByTestId(MAGIC_LINK_FORM_TEST_ID)).toBeInTheDocument();
    expect(screen.getByLabelText(english.accounts.shared.email)).toHaveValue(
      "",
    );
  });

  test("keeps where the reader was going for the tab the link opens in", async () => {
    getJestSpyOn(StatusPageUtil, "getSafeRedirectUrl").mockReturnValue(
      INCIDENT,
    );

    await renderMagicLink();
    await askFor("reader@example.com");

    await screen.findByTestId(MAGIC_LINK_SENT_TEST_ID);

    expect(
      JSON.parse(window.localStorage.getItem(magicLinkRedirectKey())!),
    ).toMatchObject({ path: INCIDENT });
  });

  test("a refused request keeps the form, with the server's reason", async () => {
    await renderMagicLink();

    createOrUpdateMock.mockRejectedValue(
      new HTTPErrorResponse(
        429,
        {
          message:
            "Too many sign-in links asked for this email address in the last hour. Please use the link in the latest email, or try again later.",
        },
        {},
      ),
    );

    await act(async () => {
      fireEvent.change(screen.getByLabelText(english.accounts.shared.email), {
        target: { value: "reader@example.com" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId(english.accounts.magicLink.submit));
    });

    expect(
      await screen.findByText(/Too many sign-in links asked for/),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(MAGIC_LINK_SENT_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("'Know your password?' goes back to the password form, still going where the reader was", async () => {
    getJestSpyOn(StatusPageUtil, "getSafeRedirectUrl").mockReturnValue(
      INCIDENT,
    );

    await renderMagicLink();

    expect(
      screen.getByRole("link", { name: `${english.accounts.shared.login}.` }),
    ).toHaveAttribute(
      "href",
      `/login?redirectUrl=${encodeURIComponent(INCIDENT)}`,
    );
  });

  test("a page that offers no links sends the reader to its password form", async () => {
    await renderMagicLink({ enableMagicLinkLogin: false });

    expect(navigatedTo()).toEqual(["/login"]);
    expect(
      screen.queryByTestId(MAGIC_LINK_FORM_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a page that requires SSO sends the reader to its SSO page, drawing no form on the way", async () => {
    await renderMagicLink({ enableMagicLinkLogin: false, forceSSO: true });

    expect(navigatedTo()).toEqual(["/sso"]);
    expect(
      screen.queryByTestId(MAGIC_LINK_FORM_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a page behind its master password asks for that first", async () => {
    getJestSpyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(
      true,
    );
    getJestSpyOn(StatusPageUtil, "isMasterPasswordValidated").mockReturnValue(
      false,
    );

    await renderMagicLink();

    expect(StatusPageUtil.navigateToMasterPasswordPage).toHaveBeenCalled();
    expect(
      screen.queryByTestId(MAGIC_LINK_FORM_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a reader already signed in goes on to the page", async () => {
    getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(true);

    await renderMagicLink();

    expect(navigatedTo()).toEqual(["/"]);
  });

  test("in the Dashboard's preview, the way back is the preview's", async () => {
    isPreview = true;

    await renderMagicLink();

    expect(
      screen.getByRole("link", { name: `${english.accounts.shared.login}.` }),
    ).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/login`,
    );
  });
});

describe("the page a sign-in link opens", () => {
  let posts: Array<{ url: string; data: unknown }>;

  const respondWith: (
    answer: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>,
  ) => void = (
    answer: () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>,
  ): void => {
    getJestSpyOn(API, "post").mockImplementation(
      async (options: {
        url: { toString: () => string };
        data?: unknown;
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        posts.push({ url: options.url.toString(), data: options.data });
        return await answer();
      },
    );
  };

  const signedIn: () => Promise<HTTPResponse<JSONObject>> = async (): Promise<
    HTTPResponse<JSONObject>
  > => {
    return new HTTPResponse<JSONObject>(
      200,
      {
        _id: "57000000-0000-4000-8000-0000000000aa",
        email: "reader@example.com",
        statusPageId: STATUS_PAGE_ID.toString(),
      },
      {},
    );
  };

  const renderLanding: (
    options?: Partial<{ enableMagicLinkLogin: boolean; forceSSO: boolean }>,
  ) => Promise<void> = async (
    options: Partial<{ enableMagicLinkLogin: boolean; forceSSO: boolean }> = {},
  ): Promise<void> => {
    await act(async () => {
      render(
        <MagicLinkLoginPage
          statusPageName={PAGE_NAME}
          logoFileId={LOGO_FILE_ID}
          forceSSO={Boolean(options.forceSSO)}
          enableMagicLinkLogin={options.enableMagicLinkLogin !== false}
        />,
      );
    });
  };

  const pressLogIn: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByTestId(MAGIC_LINK_LOGIN_BUTTON_TEST_ID));
    });
  };

  beforeEach(() => {
    posts = [];
    // Where the head bootstrap left the link's token (SensitiveUrlToken).
    window.sessionStorage.setItem(SENSITIVE_URL_TOKEN_KEY, TOKEN);
    respondWith(signedIn);
    getJestSpyOn(LoginUtil, "login").mockImplementation(() => {});
  });

  test("asks for one press of Log in, and signs nothing in until then", async () => {
    await renderLanding();

    expect(
      screen.getByRole("heading", { name: `Log in to ${PAGE_NAME}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(english.accounts.magicLinkLogin.description),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(MAGIC_LINK_LOGIN_BUTTON_TEST_ID),
    ).toHaveAccessibleName(english.accounts.magicLinkLogin.submit);

    // A mail filter that opens the page, and runs its script, spends nothing.
    expect(posts).toEqual([]);
    expect(window.sessionStorage.getItem(SENSITIVE_URL_TOKEN_KEY)).toBe(TOKEN);
  });

  test("Log in sends the link to this page's sign-in, and nothing else", async () => {
    await renderLanding();
    await pressLogIn();

    expect(posts).toHaveLength(1);
    expect(new globalThis.URL(posts[0]!.url).pathname).toMatch(
      new RegExp(`/login-with-magic-link/${STATUS_PAGE_ID.toString()}$`),
    );
    expect(posts[0]!.data).toEqual({ token: TOKEN });
  });

  test("signed in: the link leaves the tab, the reader is remembered, and the page opens", async () => {
    await renderLanding();
    await pressLogIn();

    expect(window.sessionStorage.getItem(SENSITIVE_URL_TOKEN_KEY)).toBeNull();
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);

    const loggedIn: { user: { email?: { toString: () => string } } } =
      jest.mocked(LoginUtil.login).mock.calls[0]![0] as {
        user: { email?: { toString: () => string } };
      };

    expect(loggedIn.user.email?.toString()).toBe("reader@example.com");
    expect(navigatedTo()).toEqual(["/"]);
    expect(jest.mocked(Navigation.navigate).mock.calls[0]![1]).toEqual({
      forceNavigate: true,
    });
  });

  test("lands the reader where they were going when they asked for the link", async () => {
    StatusPageUtil.rememberMagicLinkRedirect(INCIDENT);

    await renderLanding();
    await pressLogIn();

    expect(navigatedTo()).toEqual([INCIDENT]);
    // Taken once.
    expect(window.localStorage.getItem(magicLinkRedirectKey())).toBeNull();
  });

  test("a link the server refuses: its reason, the link dropped, and a new one offered", async () => {
    respondWith(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(
        400,
        {
          message:
            "This sign-in link has expired or has already been used. Please ask for a new one.",
        },
        {},
      );
    });

    await renderLanding();
    await pressLogIn();

    expect(
      screen.getByTestId(MAGIC_LINK_LOGIN_ERROR_TEST_ID),
    ).toHaveTextContent(
      "This sign-in link has expired or has already been used. Please ask for a new one.",
    );
    expect(window.sessionStorage.getItem(SENSITIVE_URL_TOKEN_KEY)).toBeNull();
    expect(
      screen.queryByTestId(MAGIC_LINK_LOGIN_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(MAGIC_LINK_LOGIN_NEW_LINK_TEST_ID),
    ).toHaveAttribute("href", "/magic-link");
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(Navigation.navigate).not.toHaveBeenCalled();
  });

  test("a server that could not be reached: the link is kept, so Log in can be pressed again", async () => {
    respondWith(async (): Promise<never> => {
      throw new Error("Network error");
    });

    await renderLanding();
    await pressLogIn();

    expect(screen.getByTestId(MAGIC_LINK_LOGIN_ERROR_TEST_ID)).toBeVisible();
    expect(window.sessionStorage.getItem(SENSITIVE_URL_TOKEN_KEY)).toBe(TOKEN);
    expect(screen.getByTestId(MAGIC_LINK_LOGIN_BUTTON_TEST_ID)).toBeVisible();

    respondWith(signedIn);
    await pressLogIn();

    expect(navigatedTo()).toEqual(["/"]);
  });

  test("a server error is not the link's fault: it is kept too", async () => {
    respondWith(async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, { message: "Server error" }, {});
    });

    await renderLanding();
    await pressLogIn();

    expect(window.sessionStorage.getItem(SENSITIVE_URL_TOKEN_KEY)).toBe(TOKEN);
    expect(screen.getByTestId(MAGIC_LINK_LOGIN_BUTTON_TEST_ID)).toBeVisible();
  });

  test("opened without a link: says so, and offers a new one", async () => {
    window.sessionStorage.clear();

    await renderLanding();

    expect(
      screen.getByTestId(MAGIC_LINK_LOGIN_ERROR_TEST_ID),
    ).toHaveTextContent(english.accounts.magicLinkLogin.noLink);
    expect(
      screen.queryByTestId(MAGIC_LINK_LOGIN_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(MAGIC_LINK_LOGIN_NEW_LINK_TEST_ID),
    ).toHaveAttribute("href", "/magic-link");
  });

  test("on a page that has turned links off: says so, and offers only the way back", async () => {
    await renderLanding({ enableMagicLinkLogin: false });

    expect(
      screen.getByTestId(MAGIC_LINK_LOGIN_ERROR_TEST_ID),
    ).toHaveTextContent(english.accounts.magicLinkLogin.turnedOff);
    expect(
      screen.queryByTestId(MAGIC_LINK_LOGIN_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(MAGIC_LINK_LOGIN_NEW_LINK_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: english.accounts.sso.backToLogin }),
    ).toHaveAttribute("href", "/login");
    expect(posts).toEqual([]);
  });

  test("on a page that requires SSO: the link is dropped and the reader sent to SSO, with nothing drawn on the way", async () => {
    await renderLanding({ enableMagicLinkLogin: false, forceSSO: true });

    expect(navigatedTo()).toEqual(["/sso"]);
    expect(window.sessionStorage.getItem(SENSITIVE_URL_TOKEN_KEY)).toBeNull();
    expect(
      screen.queryByTestId(MAGIC_LINK_LOGIN_ERROR_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(MAGIC_LINK_LOGIN_BUTTON_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a reader already signed in: the link is dropped and the page opens", async () => {
    getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(true);

    await renderLanding();

    expect(navigatedTo()).toEqual(["/"]);
    expect(window.sessionStorage.getItem(SENSITIVE_URL_TOKEN_KEY)).toBeNull();
    expect(posts).toEqual([]);
  });

  test("on a page anyone may see: the link is dropped and the page opens", async () => {
    getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(false);

    await renderLanding();

    expect(navigatedTo()).toEqual(["/"]);
    expect(window.sessionStorage.getItem(SENSITIVE_URL_TOKEN_KEY)).toBeNull();
  });

  test("a page behind its master password asks for that first", async () => {
    getJestSpyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(
      true,
    );
    getJestSpyOn(StatusPageUtil, "isMasterPasswordValidated").mockReturnValue(
      false,
    );

    await renderLanding();

    expect(StatusPageUtil.navigateToMasterPasswordPage).toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  test("in the Dashboard's preview: the preview's sign-in, and a new link from the preview", async () => {
    isPreview = true;
    window.sessionStorage.clear();

    await renderLanding();

    expect(
      screen.getByTestId(MAGIC_LINK_LOGIN_NEW_LINK_TEST_ID),
    ).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/magic-link`,
    );
    expect(
      screen.getByRole("link", { name: english.accounts.sso.backToLogin }),
    ).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/login`,
    );
  });
});

describe("where a sign-in link lands (StatusPageUtil.rememberMagicLinkRedirect)", () => {
  test("is kept for this page, and taken once", () => {
    StatusPageUtil.rememberMagicLinkRedirect(INCIDENT);

    expect(StatusPageUtil.takeMagicLinkRedirect()).toBe(INCIDENT);
    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();
  });

  test("is this page's alone", () => {
    StatusPageUtil.rememberMagicLinkRedirect(INCIDENT);

    currentStatusPageId = OTHER_STATUS_PAGE_ID;
    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();

    currentStatusPageId = STATUS_PAGE_ID;
    expect(StatusPageUtil.takeMagicLinkRedirect()).toBe(INCIDENT);
  });

  test("lasts only as long as the link works", () => {
    const now: number = Date.now();
    getJestSpyOn(Date, "now").mockReturnValue(now);

    StatusPageUtil.rememberMagicLinkRedirect(INCIDENT);

    jest
      .mocked(Date.now)
      .mockReturnValue(
        now + STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000 + 1,
      );

    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();
  });

  test.each([
    ["another site", "https://evil.example.com/phish"],
    ["a protocol-relative address", "//evil.example.com"],
    ["a sign-in page", "/login"],
    ["the link page itself", "/magic-link-login"],
    ["the page that asks for one", "/magic-link"],
    [
      "another status page's address",
      `/status-page/${OTHER_STATUS_PAGE_ID.toString()}/incidents`,
    ],
  ])("never keeps %s", (_name: string, path: string) => {
    // The page this tab shows, as the master page leaves it.
    getJestSpyOn(StatusPageInTab, "get").mockReturnValue(STATUS_PAGE_ID);

    StatusPageUtil.rememberMagicLinkRedirect(path);

    expect(window.localStorage.getItem(magicLinkRedirectKey())).toBeNull();
    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();
  });

  test("asking again with nowhere to go forgets the last place", () => {
    StatusPageUtil.rememberMagicLinkRedirect(INCIDENT);
    StatusPageUtil.rememberMagicLinkRedirect(null);

    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();
  });

  test("what is kept is checked again as it is taken", () => {
    window.localStorage.setItem(
      magicLinkRedirectKey(),
      JSON.stringify({
        path: "https://evil.example.com",
        expiresAt: Date.now() + 60000,
      }),
    );
    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();

    window.localStorage.setItem(magicLinkRedirectKey(), "not json");
    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();

    window.localStorage.setItem(
      magicLinkRedirectKey(),
      JSON.stringify({ path: INCIDENT }),
    );
    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();
  });

  test("blocked storage keeps nothing and breaks nothing", () => {
    getJestSpyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    getJestSpyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => {
      StatusPageUtil.rememberMagicLinkRedirect(INCIDENT);
    }).not.toThrow();
    expect(StatusPageUtil.takeMagicLinkRedirect()).toBeNull();
  });
});
