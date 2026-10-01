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
  within,
} from "@testing-library/react";
import { Mock, SpyInstance } from "jest-mock";
import React from "react";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import CookieName from "../../../Types/CookieName";
import { JSONObject } from "../../../Types/JSON";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import Cookie from "../../../UI/Utils/Cookie";
import McpOAuthPendingAuthorization from "../../../UI/Utils/McpOAuthPendingAuthorization";
import Navigation from "../../../UI/Utils/Navigation";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import {
  MCP_OAUTH_CONSENT_APPROVE_API_URL,
  MCP_OAUTH_CONSENT_DENY_API_URL,
  MCP_OAUTH_CONSENT_DETAILS_API_URL,
} from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import McpAuthorizeUtil, {
  KNOWN_DISPLAY_ERROR_CODES,
} from "../../../../App/FeatureSet/Accounts/src/Utils/McpAuthorize";
import McpAuthorizePage from "../../../../App/FeatureSet/Accounts/src/Pages/McpAuthorize";

/*
 * The MCP consent screen, rendered for real with the Accounts translations.
 *
 * This is the page an MCP client sends a person to, and the only place in the
 * product where a person hands their access to something else. So what it
 * shows, what it offers and what it sends are each pinned from the outside:
 *
 *  - It says who is asking in the terms that cannot be faked - where the
 *    browser goes next, and the host a client's metadata document lives on -
 *    and says plainly when all it has is a name the client typed.
 *  - It never offers more than the client asked for, never preselects among
 *    several projects, and never lets a project the server refused be chosen.
 *  - It sends exactly the request it was opened with, the project and the
 *    access that are on screen, and then goes where the SERVER says - unless
 *    that is somewhere a browser must not be sent.
 *  - Nothing in the address bar is ever printed: an error is a code with
 *    fixed wording, and a request is an opaque ticket.
 *  - A visitor who is not signed in keeps their request across the sign-in.
 *
 * The page, the pending-request cookie and i18next are real; only the network
 * (API.post) and the final navigation (window.location.assign) are recorded
 * instead of performed. The wording is read from the locale through i18n, so
 * the suite follows the copy rather than freezing it.
 */

const TICKET: string = `v1.${"cGF5bG9hZA".repeat(4)}.${"s".repeat(43)}`;
const OTHER_TICKET: string = `v1.${"b3RoZXI".repeat(4)}.${"t".repeat(43)}`;

const PAGE_PATH: string = "/accounts/mcp-authorize";
const PAGE_URL: string = `http://localhost${PAGE_PATH}`;

// Where the dashboard is served, and so where the pending request is kept.
const DASHBOARD_PATH: string = "/dashboard";
const PENDING_REQUEST_COOKIE: string = "oneuptime-mcp-oauth-pending-request";

const PRODUCTION_ID: string = "11111111-1111-4111-8111-111111111111";
const STAGING_ID: string = "22222222-2222-4222-8222-222222222222";
const FINANCE_ID: string = "33333333-3333-4333-8333-333333333333";
const SIDE_PROJECT_ID: string = "44444444-4444-4444-8444-444444444444";

const HOSTED_REDIRECT: string =
  "https://claude.ai/api/mcp/auth_callback?code=oumcp_ac_abc&state=xyz&iss=http%3A%2F%2Flocalhost%2Fmcp";
const DENIED_REDIRECT: string =
  "https://claude.ai/api/mcp/auth_callback?error=access_denied&error_description=The+request+was+denied.&state=xyz";

const TEST_UTILS_ACT_DEPRECATION: string =
  "`ReactDOMTestUtils.act` is deprecated";

interface ProjectAnswer {
  id: string;
  name: string;
  isEligible: boolean;
  refusal: string | null;
}

const PRODUCTION: ProjectAnswer = {
  id: PRODUCTION_ID,
  name: "Acme Production",
  isEligible: true,
  refusal: null,
};
const STAGING: ProjectAnswer = {
  id: STAGING_ID,
  name: "Acme Staging",
  isEligible: true,
  refusal: null,
};
const FINANCE_NEEDS_SSO: ProjectAnswer = {
  id: FINANCE_ID,
  name: "Acme Finance",
  isEligible: false,
  refusal: "sso",
};
const SIDE_PROJECT_ON_FREE_PLAN: ProjectAnswer = {
  id: SIDE_PROJECT_ID,
  name: "Side Project",
  isEligible: false,
  refusal: "plan",
};

// A client identified by a metadata document, sending the code to its site.
const HOSTED_CLIENT: JSONObject = {
  name: "Claude",
  verifiedHost: "claude.ai",
  uri: "https://claude.ai/",
  redirectTarget: "claude.ai",
  isLoopbackRedirect: false,
};

// A client that registered itself, listening on this machine.
const LOCAL_CLIENT: JSONObject = {
  name: "Claude Code",
  verifiedHost: null,
  uri: null,
  redirectTarget: "localhost:33418",
  isLoopbackRedirect: true,
};

type DetailsFunction = (overrides?: JSONObject) => JSONObject;

const details: DetailsFunction = (overrides: JSONObject = {}): JSONObject => {
  return {
    client: HOSTED_CLIENT,
    requestedAccess: "write",
    user: { email: "ada@example.com", name: "Ada Lovelace" },
    projects: [PRODUCTION] as unknown as JSONObject,
    ...overrides,
  };
};

type Answer = () => Promise<HTTPResponse<JSONObject>>;

type OkFunction = (body: JSONObject) => Answer;

const ok: OkFunction = (body: JSONObject): Answer => {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, body, {});
  };
};

type RefusedFunction = (statusCode: number, message: string) => Answer;

// What API.post resolves with for a non-2xx answer.
const refused: RefusedFunction = (
  statusCode: number,
  message: string,
): Answer => {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPErrorResponse(statusCode, { message }, {});
  };
};

interface Deferred {
  answer: Answer;
  resolve: (response: HTTPResponse<JSONObject>) => Promise<void>;
}

type DeferredFunction = () => Deferred;

// An answer that arrives when the test says so.
const deferred: DeferredFunction = (): Deferred => {
  let release: (response: HTTPResponse<JSONObject>) => void = (): void => {};

  const promise: Promise<HTTPResponse<JSONObject>> = new Promise<
    HTTPResponse<JSONObject>
  >((resolve: (response: HTTPResponse<JSONObject>) => void) => {
    release = resolve;
  });

  return {
    answer: (): Promise<HTTPResponse<JSONObject>> => {
      return promise;
    },
    resolve: async (response: HTTPResponse<JSONObject>): Promise<void> => {
      await act(async () => {
        release(response);
        await promise;
      });
    },
  };
};

interface PostedRequest {
  url: string;
  data: unknown;
}

let posted: Array<PostedRequest> = [];
let answers: { details: Answer; approve: Answer; deny: Answer };
let assign: Mock<(url: string) => void>;
let consoleErrors: SpyInstance<typeof console.error>;

const originalLocation: Location = window.location;

type ConfigureLocationFunction = (search: string) => void;

/*
 * The page reads its query off window.location and leaves through
 * window.location.assign. jsdom's own Location cannot be spied on, so it is
 * replaced with a URL that has a recording `assign`. The document itself is
 * moved to the page's real path as well, because that is what decides which
 * cookies the page can see: the pending request is kept for the dashboard's
 * path, so the consent screen writes it without being able to read it back.
 */
const configureLocation: ConfigureLocationFunction = (search: string): void => {
  window.history.pushState({}, "", `${PAGE_PATH}${search}`);

  Object.defineProperty(window, "location", {
    configurable: true,
    value: Object.assign(new globalThis.URL(`${PAGE_URL}${search}`), {
      assign,
    }),
  });
};

type RenderPageFunction = (
  search?: string,
) => Promise<ReturnType<typeof render>>;

const renderPage: RenderPageFunction = async (
  search: string = `?request=${TICKET}`,
): Promise<ReturnType<typeof render>> => {
  configureLocation(search);

  let result: ReturnType<typeof render> | undefined;

  await act(async () => {
    result = render(<McpAuthorizePage />);
  });

  return result as ReturnType<typeof render>;
};

type SayFunction = (key: string, values?: Record<string, string>) => string;

// The wording the page should show, straight from the locale.
const say: SayFunction = (
  key: string,
  values?: Record<string, string>,
): string => {
  return i18n.t(`mcpAuthorize.${key}`, values || {});
};

type RequestsToFunction = (url: { toString: () => string }) => Array<unknown>;

const requestsTo: RequestsToFunction = (url: {
  toString: () => string;
}): Array<unknown> => {
  return posted
    .filter((request: PostedRequest): boolean => {
      return request.url === url.toString();
    })
    .map((request: PostedRequest): unknown => {
      return request.data;
    });
};

type ElementFunction = () => HTMLElement;

const approveButton: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("mcp-authorize-approve");
};

const denyButton: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("mcp-authorize-deny");
};

type SelectFunction = () => HTMLSelectElement;

const projectSelect: SelectFunction = (): HTMLSelectElement => {
  return screen.getByTestId("mcp-authorize-project") as HTMLSelectElement;
};

type OptionsFunction = () => Array<HTMLOptionElement>;

const projectOptions: OptionsFunction = (): Array<HTMLOptionElement> => {
  return Array.from(projectSelect().options);
};

type RadioFunction = (level: "read" | "write") => HTMLInputElement | null;

const accessRadio: RadioFunction = (
  level: "read" | "write",
): HTMLInputElement | null => {
  return screen.queryByTestId(
    `mcp-authorize-access-${level}`,
  ) as HTMLInputElement | null;
};

type ClickFunction = (element: HTMLElement) => Promise<void>;

const click: ClickFunction = async (element: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(element);
  });
};

type ChooseProjectFunction = (projectId: string) => Promise<void>;

const chooseProject: ChooseProjectFunction = async (
  projectId: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.change(projectSelect(), { target: { value: projectId } });
  });
};

type AsTheDashboardFunction = <T>(read: () => T) => T;

/*
 * Runs `read` with the document where the dashboard is served - the only
 * place the pending request's cookie is visible - and puts the document back
 * on the consent screen afterwards.
 */
const asTheDashboard: AsTheDashboardFunction = <T,>(read: () => T): T => {
  const pagePath: string = `${window.location.pathname}${window.location.search}`;

  window.history.pushState({}, "", DASHBOARD_PATH);

  try {
    return read();
  } finally {
    window.history.pushState({}, "", pagePath);
  }
};

type IsRememberedFunction = () => boolean;

// Whether a request is waiting for the dashboard. Looks; does not take.
const isRequestRemembered: IsRememberedFunction = (): boolean => {
  return asTheDashboard((): boolean => {
    return document.cookie.includes(`${PENDING_REQUEST_COOKIE}=`);
  });
};

type RememberedFunction = () => string | null;

/*
 * The request the dashboard would be sent back with after a sign-in, read the
 * way the dashboard reads it. Reading it forgets it, as it does there.
 */
const rememberedRoute: RememberedFunction = (): string | null => {
  return asTheDashboard((): string | null => {
    return McpOAuthPendingAuthorization.consumeRoute()?.toString() || null;
  });
};

type TextsFunction = (root: Node) => Array<string>;

// Every piece of text a person can read under `root`.
const visibleTexts: TextsFunction = (root: Node): Array<string> => {
  const texts: Array<string> = [];

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text: string = (child.textContent || "").trim();

      if (text) {
        texts.push(text);
      }

      continue;
    }

    texts.push(...visibleTexts(child));
  }

  return texts;
};

beforeEach(() => {
  posted = [];
  assign = jest.fn<(url: string) => void>();
  answers = {
    details: ok(details()),
    approve: ok({ redirectUrl: HOSTED_REDIRECT }),
    deny: ok({ redirectUrl: DENIED_REDIRECT }),
  };

  McpOAuthPendingAuthorization.clear();
  consoleErrors = jest.spyOn(console, "error");

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: Parameters<typeof API.post>[0],
      ): Promise<HTTPResponse<JSONObject>> => {
        const url: string = options.url.toString();

        posted.push({ url, data: options.data });

        if (url === MCP_OAUTH_CONSENT_DETAILS_API_URL.toString()) {
          return answers.details();
        }

        if (url === MCP_OAUTH_CONSENT_APPROVE_API_URL.toString()) {
          return answers.approve();
        }

        if (url === MCP_OAUTH_CONSENT_DENY_API_URL.toString()) {
          return answers.deny();
        }

        // What signing a visitor out posts to; only one test gets that far.
        if (url.endsWith("/logout")) {
          return new HTTPResponse<JSONObject>(200, {}, {});
        }

        throw new Error(`Unexpected request to ${url}`);
      },
    );
});

afterEach(async () => {
  cleanup();

  const reportedErrors: Array<string> = consoleErrors.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .filter((message: string): boolean => {
      return !message.includes(TEST_UTILS_ACT_DEPRECATION);
    });

  jest.restoreAllMocks();
  McpOAuthPendingAuthorization.clear();

  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  window.history.pushState({}, "", "/");

  if (i18n.language !== "en") {
    await i18n.changeLanguage("en");
  }

  // React warnings (bad keys, uncontrolled inputs) are failures here.
  expect(reportedErrors).toEqual([]);
});

describe("the consent screen's API addresses", () => {
  test("are on the app's own origin, under /mcp/oauth/consent and not under /api", () => {
    const apiUrl: globalThis.URL = new globalThis.URL(APP_API_URL.toString());

    // The API itself lives under /api; these three deliberately do not.
    expect(apiUrl.pathname).toBe("/api");

    const expected: Array<[{ toString: () => string }, string]> = [
      [MCP_OAUTH_CONSENT_DETAILS_API_URL, "/mcp/oauth/consent/details"],
      [MCP_OAUTH_CONSENT_APPROVE_API_URL, "/mcp/oauth/consent/approve"],
      [MCP_OAUTH_CONSENT_DENY_API_URL, "/mcp/oauth/consent/deny"],
    ];

    for (const [url, path] of expected) {
      const parsed: globalThis.URL = new globalThis.URL(url.toString());

      expect(parsed.origin).toBe(apiUrl.origin);
      expect(parsed.pathname).toBe(path);
      expect(parsed.search).toBe("");
      expect(parsed.hash).toBe("");
    }
  });

  test("the wording really is loaded: a key resolves to a sentence, not to itself", () => {
    // Every expectation below compares against say(); this keeps it honest.
    expect(say("title")).not.toBe("mcpAuthorize.title");
    expect(say("title").length).toBeGreaterThan(0);
    expect(say("wantsAccess", { clientName: "Claude" })).toContain("Claude");
    expect(say("errors.server_error")).not.toContain("mcpAuthorize");
  });
});

describe("opened without a usable request", () => {
  test("no request at all shows the fixed missing-request wording and asks the server nothing", async () => {
    await renderPage("");

    const problem: HTMLElement = screen.getByTestId("mcp-authorize-problem");

    expect(problem).toHaveTextContent(say("errorTitle"));
    expect(problem).toHaveTextContent(say("errors.missing_request"));
    expect(problem).toHaveTextContent(say("errorHelp"));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      say("title"),
    );

    expect(posted).toEqual([]);
    expect(assign).not.toHaveBeenCalled();
    expect(rememberedRoute()).toBeNull();

    // Nothing to decide, so nothing to press.
    expect(screen.queryByTestId("mcp-authorize-approve")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-deny")).toBeNull();
  });

  test.each([
    ["words", "request=please+let+me+in"],
    ["markup", "request=%3Cscript%3Ealert(1)%3C%2Fscript%3E"],
    ["a ticket with a part missing", `request=v1.${"s".repeat(43)}`],
    ["a ticket with a short signature", `request=v1.abc.${"s".repeat(42)}`],
    ["a ticket of another version", `request=v2.abc.${"s".repeat(43)}`],
    ["a JSON web token", "request=eyJhbGciOiJIUzI1NiJ9.eyJ1IjoxfQ.c2ln"],
    ["an empty value", "request="],
  ])(
    "%s in place of a ticket is treated as no request, and is never sent or shown",
    async (_label: string, query: string) => {
      const { container } = await renderPage(`?${query}`);

      expect(screen.getByTestId("mcp-authorize-problem")).toHaveTextContent(
        say("errors.missing_request"),
      );
      expect(posted).toEqual([]);
      expect(rememberedRoute()).toBeNull();

      const value: string = decodeURIComponent(
        query.slice("request=".length).replace(/\+/g, " "),
      );

      if (value) {
        expect(container.textContent).not.toContain(value);
      }

      expect(container.querySelector("script")).toBeNull();
    },
  );
});

describe("opened with an error from the authorization endpoint", () => {
  test.each(KNOWN_DISPLAY_ERROR_CODES)(
    "%s shows that code's own fixed wording",
    async (code: string) => {
      await renderPage(`?error=${code}`);

      const problem: HTMLElement = screen.getByTestId("mcp-authorize-problem");

      expect(problem).toHaveTextContent(say(`errors.${code}`));
      expect(problem).toHaveTextContent(say("errorTitle"));
      expect(problem).toHaveTextContent(say("errorHelp"));

      // A code is never echoed; it selects a sentence.
      expect(say(`errors.${code}`)).not.toContain("mcpAuthorize.errors");
      expect(problem.textContent).not.toContain(code);
      expect(posted).toEqual([]);
    },
  );

  test("each code has wording of its own, apart from the generic one it falls back to", () => {
    const sentences: Set<string> = new Set<string>(
      KNOWN_DISPLAY_ERROR_CODES.map((code: string): string => {
        return say(`errors.${code}`);
      }),
    );

    expect(sentences.size).toBe(KNOWN_DISPLAY_ERROR_CODES.length);
  });

  test.each([
    ["markup", "<img src=x onerror=alert(1)>", "onerror"],
    ["a script tag", "<script>alert(document.cookie)</script>", "alert("],
    [
      "a sentence somebody wants OneUptime to say",
      "Your account is locked. Call +1 555 0100 to unlock it.",
      "555 0100",
    ],
    ["a code the page does not know", "totally_made_up", "totally_made_up"],
    ["the page's own missing-request code", "missing_request", ""],
    ["a path into another part of the locale", "../login.title", "login.title"],
    ["an OAuth error code", "access_denied", "access_denied"],
  ])(
    "%s in ?error= shows the generic wording, and none of the address bar's text",
    async (_label: string, value: string, fragment: string) => {
      const { container } = await renderPage(
        `?error=${encodeURIComponent(value)}`,
      );

      const problem: HTMLElement = screen.getByTestId("mcp-authorize-problem");

      expect(problem).toHaveTextContent(say("errors.server_error"));
      expect(problem).not.toHaveTextContent(say("errors.missing_request"));

      if (fragment) {
        expect(container.textContent).not.toContain(fragment);
        expect(container.innerHTML).not.toContain(fragment);
      }

      // The logo is the page's only image, and nothing became a script.
      expect(container.querySelectorAll("img")).toHaveLength(1);
      expect(container.querySelector("script")).toBeNull();
      expect(posted).toEqual([]);
    },
  );

  test("an error wins over a request in the same address: nothing is loaded or remembered", async () => {
    await renderPage(`?error=unknown_client&request=${TICKET}`);

    expect(screen.getByTestId("mcp-authorize-problem")).toHaveTextContent(
      say("errors.unknown_client"),
    );
    expect(posted).toEqual([]);
    expect(rememberedRoute()).toBeNull();
  });

  test("an empty ?error= is no error: the request is loaded", async () => {
    await renderPage(`?error=&request=${TICKET}`);

    expect(screen.queryByTestId("mcp-authorize-problem")).toBeNull();
    expect(requestsTo(MCP_OAUTH_CONSENT_DETAILS_API_URL)).toEqual([
      { request: TICKET },
    ]);
  });
});

describe("loading the request", () => {
  test("asks the server about exactly the ticket in the address", async () => {
    const { container } = await renderPage(`?request=${OTHER_TICKET}`);

    expect(posted).toEqual([
      {
        url: MCP_OAUTH_CONSENT_DETAILS_API_URL.toString(),
        data: { request: OTHER_TICKET },
      },
    ]);

    // The ticket is machinery: it is sent, never shown.
    expect(screen.getByTestId("mcp-authorize-client")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(OTHER_TICKET);
  });

  test("shows a loader, and nothing to decide on, until the server answers", async () => {
    const pending: Deferred = deferred();
    answers.details = pending.answer;

    await renderPage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-authorize-client")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-approve")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-deny")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-problem")).toBeNull();

    await pending.resolve(new HTTPResponse<JSONObject>(200, details(), {}));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("mcp-authorize-client")).toBeInTheDocument();
    expect(approveButton()).toBeInTheDocument();
  });

  test("a refusal from the server is shown in the server's words", async () => {
    answers.details = refused(
      400,
      "This authorization request has expired. Go back to your MCP client and start connecting again.",
    );

    await renderPage();

    const problem: HTMLElement = screen.getByTestId("mcp-authorize-problem");

    expect(problem).toHaveTextContent(say("errorTitle"));
    expect(problem).toHaveTextContent(
      "This authorization request has expired. Go back to your MCP client and start connecting again.",
    );
    expect(problem).toHaveTextContent(say("errorHelp"));
    expect(screen.queryByTestId("mcp-authorize-approve")).toBeNull();
  });

  test("a refusal that contains markup is shown as text", async () => {
    answers.details = refused(403, "<img src=x onerror=alert(1)> Forbidden");

    const { container } = await renderPage();

    expect(screen.getByTestId("mcp-authorize-problem")).toHaveTextContent(
      "<img src=x onerror=alert(1)> Forbidden",
    );
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  test("a request that fails outright is reported, not left spinning", async () => {
    answers.details = async (): Promise<HTTPResponse<JSONObject>> => {
      throw new Error("Network Error");
    };

    await renderPage();

    expect(screen.getByTestId("mcp-authorize-problem")).toHaveTextContent(
      "Network Error",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  test.each([
    ["an empty answer", {}],
    ["an answer with no projects list", { ...details(), projects: null }],
    ["an answer with no client", { ...details(), client: null }],
    ["an answer with no user", { ...details(), user: "ada@example.com" }],
  ] as Array<[string, JSONObject]>)(
    "%s shows the generic error rather than a half-drawn screen",
    async (_label: string, body: JSONObject) => {
      answers.details = ok(body);

      await renderPage();

      expect(screen.getByTestId("mcp-authorize-problem")).toHaveTextContent(
        say("errors.server_error"),
      );
      expect(screen.queryByTestId("mcp-authorize-approve")).toBeNull();
      expect(screen.queryByTestId("mcp-authorize-client")).toBeNull();
    },
  );
});

describe("who is asking", () => {
  test("the client's name is in the sentence under the title", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      say("title"),
    );
    expect(screen.getByTestId("mcp-authorize-subtitle")).toHaveTextContent(
      say("wantsAccess", { clientName: "Claude" }),
    );
  });

  test("a client identified by a metadata document shows the host it is published at", async () => {
    await renderPage();

    const who: HTMLElement = screen.getByTestId("mcp-authorize-client");

    expect(within(who).getByText(say("verifiedHostLabel"))).toBeInTheDocument();
    expect(screen.getByTestId("mcp-authorize-verified-host")).toHaveTextContent(
      "claude.ai",
    );
    expect(screen.getByTestId("mcp-authorize-verified-host").textContent).toBe(
      "claude.ai",
    );
    expect(within(who).getByText(say("verifiedHostHelp"))).toBeInTheDocument();

    // The host is the verified part, so nothing says "unverified" beside it.
    expect(screen.queryByTestId("mcp-authorize-unverified-name")).toBeNull();
    expect(screen.queryByText(say("unverifiedNameHelp"))).toBeNull();
  });

  test("a client that only has a name it chose is said to be unverified, and shows no host", async () => {
    answers.details = ok(details({ client: LOCAL_CLIENT }));

    await renderPage();

    expect(
      screen.getByTestId("mcp-authorize-unverified-name"),
    ).toHaveTextContent(say("unverifiedNameHelp"));

    expect(screen.queryByTestId("mcp-authorize-verified-host")).toBeNull();
    expect(screen.queryByText(say("verifiedHostLabel"))).toBeNull();
    expect(screen.queryByText(say("verifiedHostHelp"))).toBeNull();
  });

  test("an empty verified host counts as none", async () => {
    answers.details = ok(
      details({ client: { ...HOSTED_CLIENT, verifiedHost: "" } }),
    );

    await renderPage();

    expect(screen.queryByTestId("mcp-authorize-verified-host")).toBeNull();
    expect(
      screen.getByTestId("mcp-authorize-unverified-name"),
    ).toBeInTheDocument();
  });

  test("a name is shown exactly as the client typed it, never interpreted", async () => {
    const name: string =
      "Tom & Jerry's <b>MCP</b> <img src=x onerror=alert(1)>";

    answers.details = ok(details({ client: { ...LOCAL_CLIENT, name } }));

    const { container } = await renderPage();

    expect(screen.getByTestId("mcp-authorize-subtitle").textContent).toBe(
      say("wantsAccess", { clientName: name }),
    );
    expect(screen.getByTestId("mcp-authorize-subtitle").textContent).toContain(
      name,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  test("the member sees which account is about to be used", async () => {
    await renderPage();

    expect(screen.getByTestId("mcp-authorize-signed-in-as")).toHaveTextContent(
      say("signedInAs", { email: "ada@example.com" }),
    );
  });
});

describe("where the browser goes next", () => {
  test("a hosted client: the host, in the sent-to wording, with no device warning", async () => {
    await renderPage();

    const who: HTMLElement = screen.getByTestId("mcp-authorize-client");

    expect(within(who).getByText(say("redirectLabel"))).toBeInTheDocument();
    expect(
      screen.getByTestId("mcp-authorize-redirect-target").textContent,
    ).toBe(say("redirectToHost", { target: "claude.ai" }));
    expect(screen.queryByTestId("mcp-authorize-loopback-warning")).toBeNull();
    expect(screen.queryByText(say("loopbackWarning"))).toBeNull();
  });

  test("a client on this machine: the this-device wording, and the warning that any local app could be listening", async () => {
    answers.details = ok(details({ client: LOCAL_CLIENT }));

    await renderPage();

    expect(
      screen.getByTestId("mcp-authorize-redirect-target").textContent,
    ).toBe(say("redirectToThisDevice", { target: "localhost:33418" }));

    const warning: HTMLElement = screen.getByTestId(
      "mcp-authorize-loopback-warning",
    );

    expect(warning).toHaveTextContent(say("loopbackWarning"));
    expect(warning).toHaveAttribute("role", "alert");
  });

  test("the two wordings are different sentences", () => {
    expect(say("redirectToHost", { target: "x" })).not.toBe(
      say("redirectToThisDevice", { target: "x" }),
    );
  });

  test("a hosted client with a verified host can still be going to this device, and is warned about", async () => {
    answers.details = ok(
      details({
        client: {
          ...HOSTED_CLIENT,
          redirectTarget: "127.0.0.1:8976",
          isLoopbackRedirect: true,
        },
      }),
    );

    await renderPage();

    expect(screen.getByTestId("mcp-authorize-verified-host")).toHaveTextContent(
      "claude.ai",
    );
    expect(
      screen.getByTestId("mcp-authorize-loopback-warning"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mcp-authorize-redirect-target").textContent,
    ).toBe(say("redirectToThisDevice", { target: "127.0.0.1:8976" }));
  });
});

describe("choosing the project", () => {
  test("the list is labelled, starts with a placeholder, and names every project in the server's order", async () => {
    answers.details = ok(
      details({
        projects: [
          FINANCE_NEEDS_SSO,
          PRODUCTION,
          SIDE_PROJECT_ON_FREE_PLAN,
          STAGING,
        ] as unknown as JSONObject,
      }),
    );

    await renderPage();

    expect(screen.getByLabelText(say("projectLabel"))).toBe(projectSelect());
    expect(screen.getByText(say("projectHelp"))).toBeInTheDocument();

    expect(
      projectOptions().map((option: HTMLOptionElement): string => {
        return option.value;
      }),
    ).toEqual(["", FINANCE_ID, PRODUCTION_ID, SIDE_PROJECT_ID, STAGING_ID]);
    expect(projectOptions()[0]!.textContent).toBe(say("projectPlaceholder"));
  });

  test("a project the server refused cannot be picked, and says why", async () => {
    answers.details = ok(
      details({
        projects: [
          PRODUCTION,
          FINANCE_NEEDS_SSO,
          SIDE_PROJECT_ON_FREE_PLAN,
          {
            id: "55555555-5555-4555-8555-555555555555",
            name: "Locked Down",
            isEligible: false,
            refusal: "blocked",
          },
          {
            id: "66666666-6666-4666-8666-666666666666",
            name: "Left Behind",
            isEligible: false,
            refusal: "not-a-member",
          },
        ] as unknown as JSONObject,
      }),
    );

    await renderPage();

    const options: Array<HTMLOptionElement> = projectOptions();

    expect(options[1]!.textContent).toBe("Acme Production");
    expect(options[1]!.disabled).toBe(false);

    expect(options[2]!.textContent).toBe(
      say("projectRefusal.sso", { name: "Acme Finance" }),
    );
    expect(options[3]!.textContent).toBe(
      say("projectRefusal.plan", { name: "Side Project" }),
    );
    expect(options[4]!.textContent).toBe(
      say("projectRefusal.blocked", { name: "Locked Down" }),
    );
    expect(options[5]!.textContent).toBe(
      say("projectRefusal.not-a-member", { name: "Left Behind" }),
    );

    for (const option of options.slice(2)) {
      expect(option.disabled).toBe(true);
      // The reason is in the option itself, beside the project's name.
      expect(option.textContent).not.toContain("mcpAuthorize");
    }

    // Four reasons, four different sentences, even for the same project.
    expect(
      new Set<string>(
        ["sso", "plan", "blocked", "not-a-member"].map(
          (reason: string): string => {
            return say(`projectRefusal.${reason}`, { name: "Acme" });
          },
        ),
      ).size,
    ).toBe(4);
  });

  test("a reason the page does not know reads as the plainest one, never as a raw key", async () => {
    answers.details = ok(
      details({
        projects: [
          PRODUCTION,
          { ...FINANCE_NEEDS_SSO, refusal: "quota_exceeded" },
          { ...SIDE_PROJECT_ON_FREE_PLAN, refusal: null },
        ] as unknown as JSONObject,
      }),
    );

    await renderPage();

    expect(projectOptions()[2]!.textContent).toBe(
      say("projectRefusal.not-a-member", { name: "Acme Finance" }),
    );
    expect(projectOptions()[3]!.textContent).toBe(
      say("projectRefusal.not-a-member", { name: "Side Project" }),
    );
    expect(projectSelect().textContent).not.toContain("quota_exceeded");
    expect(projectSelect().textContent).not.toContain("projectRefusal");
  });

  test("the only project a client can be connected to is preselected, and Authorize is ready", async () => {
    answers.details = ok(
      details({
        projects: [
          FINANCE_NEEDS_SSO,
          PRODUCTION,
          SIDE_PROJECT_ON_FREE_PLAN,
        ] as unknown as JSONObject,
      }),
    );

    await renderPage();

    expect(projectSelect().value).toBe(PRODUCTION_ID);
    expect(approveButton()).toBeEnabled();
  });

  test("with several, none is preselected and Authorize waits for a choice", async () => {
    answers.details = ok(
      details({ projects: [PRODUCTION, STAGING] as unknown as JSONObject }),
    );

    await renderPage();

    expect(projectSelect().value).toBe("");
    expect(approveButton()).toBeDisabled();

    // Pressing it anyway sends nothing.
    await click(approveButton());
    expect(requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL)).toEqual([]);

    await chooseProject(STAGING_ID);

    expect(projectSelect().value).toBe(STAGING_ID);
    expect(approveButton()).toBeEnabled();

    // Going back to the placeholder takes the choice away again.
    await chooseProject("");

    expect(approveButton()).toBeDisabled();
  });

  test("with none the client can be connected to: a notice, every project greyed out, and only Cancel to press", async () => {
    answers.details = ok(
      details({
        projects: [
          FINANCE_NEEDS_SSO,
          SIDE_PROJECT_ON_FREE_PLAN,
        ] as unknown as JSONObject,
      }),
    );

    await renderPage();

    expect(
      screen.getByTestId("mcp-authorize-no-eligible-projects"),
    ).toHaveTextContent(say("noEligibleProjects"));
    expect(screen.queryByTestId("mcp-authorize-no-projects")).toBeNull();

    expect(projectSelect().value).toBe("");
    expect(
      projectOptions()
        .slice(1)
        .every((option: HTMLOptionElement): boolean => {
          return option.disabled;
        }),
    ).toBe(true);

    // There is nothing to grant access to, so the access choice is not asked.
    expect(screen.queryByTestId("mcp-authorize-access")).toBeNull();
    expect(approveButton()).toBeDisabled();
    expect(denyButton()).toBeEnabled();
  });

  test("with no projects at all: a notice instead of an empty list", async () => {
    answers.details = ok(details({ projects: [] as unknown as JSONObject }));

    await renderPage();

    expect(screen.getByTestId("mcp-authorize-no-projects")).toHaveTextContent(
      say("noProjects"),
    );
    expect(
      screen.queryByTestId("mcp-authorize-no-eligible-projects"),
    ).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-project")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-access")).toBeNull();
    expect(approveButton()).toBeDisabled();
    expect(denyButton()).toBeEnabled();
  });

  test("neither notice is shown when there is a project to choose", async () => {
    await renderPage();

    expect(screen.queryByTestId("mcp-authorize-no-projects")).toBeNull();
    expect(
      screen.queryByTestId("mcp-authorize-no-eligible-projects"),
    ).toBeNull();
  });

  test("a project's name is shown as text", async () => {
    answers.details = ok(
      details({
        projects: [
          { ...PRODUCTION, name: "<b>Acme</b> & Sons" },
        ] as unknown as JSONObject,
      }),
    );

    const { container } = await renderPage();

    expect(projectOptions()[1]!.textContent).toBe("<b>Acme</b> & Sons");
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("choosing what the client may do", () => {
  test("a client that asked for write is offered both, with write chosen", async () => {
    await renderPage();

    const choice: HTMLElement = screen.getByTestId("mcp-authorize-access");

    expect(within(choice).getByText(say("accessLabel"))).toBeInTheDocument();
    expect(within(choice).getAllByRole("radio")).toHaveLength(2);

    expect(accessRadio("write")).not.toBeNull();
    expect(accessRadio("write")!.checked).toBe(true);
    expect(accessRadio("read")!.checked).toBe(false);

    expect(
      screen.getByRole("radio", {
        name: `${say("accessWriteTitle")} ${say("accessWriteDescription")}`,
      }),
    ).toBe(accessRadio("write"));
    expect(
      screen.getByRole("radio", {
        name: `${say("accessReadTitle")} ${say("accessReadDescription")}`,
      }),
    ).toBe(accessRadio("read"));
  });

  test("the member can give that client less than it asked for", async () => {
    await renderPage();

    await click(accessRadio("read")!);

    expect(accessRadio("read")!.checked).toBe(true);
    expect(accessRadio("write")!.checked).toBe(false);

    await click(approveButton());

    expect(requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL)).toEqual([
      { request: TICKET, projectId: PRODUCTION_ID, access: "read" },
    ]);
  });

  test("and can change their mind back before authorizing", async () => {
    await renderPage();

    await click(accessRadio("read")!);
    await click(accessRadio("write")!);
    await click(approveButton());

    expect(requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL)).toEqual([
      { request: TICKET, projectId: PRODUCTION_ID, access: "write" },
    ]);
  });

  test("a client that asked only to read is never offered write", async () => {
    answers.details = ok(details({ requestedAccess: "read" }));

    await renderPage();

    expect(accessRadio("write")).toBeNull();
    expect(screen.queryByText(say("accessWriteTitle"))).toBeNull();
    expect(screen.queryByText(say("accessWriteDescription"))).toBeNull();

    expect(
      within(screen.getByTestId("mcp-authorize-access")).getAllByRole("radio"),
    ).toHaveLength(1);
    expect(accessRadio("read")!.checked).toBe(true);

    await click(approveButton());

    expect(requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL)).toEqual([
      { request: TICKET, projectId: PRODUCTION_ID, access: "read" },
    ]);
  });

  test.each([
    ["nothing", undefined],
    ["a word the page does not know", "admin"],
    ["write in capitals", "WRITE"],
    ["a scope name", "mcp:write"],
  ] as Array<[string, string | undefined]>)(
    "an answer that says %s about access is treated as read",
    async (_label: string, requestedAccess: string | undefined) => {
      const body: JSONObject = details();

      if (requestedAccess === undefined) {
        delete body["requestedAccess"];
      } else {
        body["requestedAccess"] = requestedAccess;
      }

      answers.details = ok(body);

      await renderPage();

      expect(accessRadio("write")).toBeNull();
      expect(accessRadio("read")!.checked).toBe(true);
    },
  );

  test("the member is told the client is bound by their own permissions, and where to disconnect it", async () => {
    await renderPage();

    expect(screen.getByText(say("permissionsNote"))).toBeInTheDocument();
  });
});

describe("authorizing", () => {
  test("sends the request, the chosen project and the chosen access, then goes where the server says", async () => {
    answers.details = ok(
      details({ projects: [PRODUCTION, STAGING] as unknown as JSONObject }),
    );

    await renderPage();
    await chooseProject(STAGING_ID);
    await click(approveButton());

    expect(posted.slice(1)).toEqual([
      {
        url: MCP_OAUTH_CONSENT_APPROVE_API_URL.toString(),
        data: { request: TICKET, projectId: STAGING_ID, access: "write" },
      },
    ]);

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(HOSTED_REDIRECT);
    expect(requestsTo(MCP_OAUTH_CONSENT_DENY_API_URL)).toEqual([]);
  });

  test("tells the member they are being sent back, and takes the form away", async () => {
    await renderPage();
    await click(approveButton());

    expect(screen.getByTestId("mcp-authorize-subtitle")).toHaveTextContent(
      say("redirecting", { clientName: "Claude" }),
    );
    expect(screen.getByTestId("mcp-authorize-redirecting")).toHaveTextContent(
      say("redirectingHelp"),
    );

    expect(screen.queryByTestId("mcp-authorize-approve")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-deny")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-project")).toBeNull();
  });

  test.each([
    ["a loopback address", "http://localhost:33418/callback?code=oumcp_ac_abc"],
    [
      "an editor's own scheme",
      "cursor://anysphere.cursor-retrieval/oauth/user-mcp/callback?code=oumcp_ac_abc",
    ],
  ])(
    "follows %s exactly as the server wrote it",
    async (_label: string, redirectUrl: string) => {
      answers.approve = ok({ redirectUrl });

      await renderPage();
      await click(approveButton());

      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith(redirectUrl);
    },
  );

  test.each([
    ["a script address", "javascript:alert(document.cookie)"],
    ["a script address in capitals", "JAVASCRIPT:alert(1)"],
    ["a script address behind whitespace", "  javascript:alert(1)"],
    ["a data address", "data:text/html,<script>alert(1)</script>"],
    ["a vbscript address", "vbscript:msgbox(1)"],
    ["a blob address", "blob:http://localhost/0b2f8c0e"],
    ["a file address", "file:///etc/passwd"],
    ["about:blank", "about:blank"],
    ["a path", "/dashboard"],
    ["no address", ""],
    ["a number", 42],
    ["nothing", undefined],
    ["an object", { href: HOSTED_REDIRECT }],
  ] as Array<[string, unknown]>)(
    "does not follow %s, and shows the generic error instead",
    async (_label: string, redirectUrl: unknown) => {
      answers.approve = ok(
        redirectUrl === undefined
          ? {}
          : ({ redirectUrl } as unknown as JSONObject),
      );

      await renderPage();
      await click(approveButton());

      expect(assign).not.toHaveBeenCalled();
      expect(screen.getByTestId("mcp-authorize-problem")).toHaveTextContent(
        say("errors.server_error"),
      );
      expect(screen.queryByTestId("mcp-authorize-redirecting")).toBeNull();
    },
  );

  test("a refusal is shown in the server's words, and the member can try again", async () => {
    answers.approve = refused(
      422,
      "This project requires single sign-on. Sign in to it with SSO in this browser, then connect your MCP client again.",
    );

    await renderPage();
    await click(approveButton());

    const error: HTMLElement = screen.getByTestId("mcp-authorize-submit-error");

    expect(error).toHaveTextContent(
      "This project requires single sign-on. Sign in to it with SSO in this browser, then connect your MCP client again.",
    );
    expect(error).toHaveAttribute("role", "alert");
    expect(assign).not.toHaveBeenCalled();

    // Still on the form, with everything usable again.
    expect(approveButton()).toBeEnabled();
    expect(denyButton()).toBeEnabled();
    expect(projectSelect()).toBeEnabled();
    expect(accessRadio("read")).toBeEnabled();
    expect(accessRadio("write")).toBeEnabled();

    answers.approve = ok({ redirectUrl: HOSTED_REDIRECT });
    await click(approveButton());

    expect(requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL)).toHaveLength(2);
    expect(assign).toHaveBeenCalledWith(HOSTED_REDIRECT);
  });

  test("an old refusal is cleared as soon as the member tries again", async () => {
    answers.approve = refused(402, "This project's plan does not include it.");

    await renderPage();
    await click(approveButton());

    expect(
      screen.getByTestId("mcp-authorize-submit-error"),
    ).toBeInTheDocument();

    const second: Deferred = deferred();
    answers.approve = second.answer;

    await click(approveButton());

    expect(screen.queryByTestId("mcp-authorize-submit-error")).toBeNull();

    await second.resolve(
      new HTTPResponse<JSONObject>(200, { redirectUrl: HOSTED_REDIRECT }, {}),
    );
  });

  test("a request that fails outright is reported the same way", async () => {
    answers.approve = async (): Promise<HTTPResponse<JSONObject>> => {
      throw new Error("Network Error");
    };

    await renderPage();
    await click(approveButton());

    expect(screen.getByTestId("mcp-authorize-submit-error")).toHaveTextContent(
      "Network Error",
    );
    expect(approveButton()).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });

  test("while the answer is on its way nothing can be pressed twice, or changed", async () => {
    const pending: Deferred = deferred();
    answers.approve = pending.answer;

    await renderPage();
    await click(approveButton());

    expect(approveButton()).toBeDisabled();
    expect(denyButton()).toBeDisabled();
    expect(projectSelect()).toBeDisabled();
    expect(accessRadio("read")).toBeDisabled();
    expect(accessRadio("write")).toBeDisabled();

    await click(approveButton());
    await click(denyButton());

    expect(requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL)).toHaveLength(1);
    expect(requestsTo(MCP_OAUTH_CONSENT_DENY_API_URL)).toHaveLength(0);

    await pending.resolve(
      new HTTPResponse<JSONObject>(200, { redirectUrl: HOSTED_REDIRECT }, {}),
    );

    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe("cancelling", () => {
  test("sends only the request, and goes where the server says", async () => {
    await renderPage();
    await click(denyButton());

    expect(posted.slice(1)).toEqual([
      {
        url: MCP_OAUTH_CONSENT_DENY_API_URL.toString(),
        data: { request: TICKET },
      },
    ]);
    expect(requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL)).toEqual([]);

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(DENIED_REDIRECT);
  });

  test("works before any project is chosen", async () => {
    answers.details = ok(
      details({ projects: [PRODUCTION, STAGING] as unknown as JSONObject }),
    );

    await renderPage();

    expect(approveButton()).toBeDisabled();

    await click(denyButton());

    expect(assign).toHaveBeenCalledWith(DENIED_REDIRECT);
  });

  test("does not follow an address a browser must not be sent to", async () => {
    answers.deny = ok({ redirectUrl: "javascript:alert(1)" });

    await renderPage();
    await click(denyButton());

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId("mcp-authorize-problem")).toHaveTextContent(
      say("errors.server_error"),
    );
  });

  test("while the answer is on its way Authorize cannot be pressed", async () => {
    const pending: Deferred = deferred();
    answers.deny = pending.answer;

    await renderPage();
    await click(denyButton());

    expect(approveButton()).toBeDisabled();
    expect(denyButton()).toBeDisabled();

    await click(approveButton());
    await click(denyButton());

    expect(requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL)).toHaveLength(0);
    expect(requestsTo(MCP_OAUTH_CONSENT_DENY_API_URL)).toHaveLength(1);

    await pending.resolve(
      new HTTPResponse<JSONObject>(200, { redirectUrl: DENIED_REDIRECT }, {}),
    );

    expect(assign).toHaveBeenCalledWith(DENIED_REDIRECT);
  });

  test("the two buttons carry the locale's own labels", async () => {
    await renderPage();

    expect(approveButton()).toHaveTextContent(say("authorizeButton"));
    expect(denyButton()).toHaveTextContent(say("denyButton"));
    expect(say("authorizeButton")).not.toBe(say("denyButton"));
  });
});

describe("a visitor who is not signed in", () => {
  /*
   * The server answers 401, and the API client (not this page) sends the
   * browser to the sign-in page. What the page owes that visitor is the
   * request, still waiting in its cookie when they come back.
   */
  test("the request is remembered before the server is asked anything", async () => {
    const pending: Deferred = deferred();
    answers.details = pending.answer;

    await renderPage();

    expect(posted).toHaveLength(1);
    expect(rememberedRoute()).toBe(`/accounts/mcp-authorize?request=${TICKET}`);

    await pending.resolve(new HTTPResponse<JSONObject>(200, details(), {}));
  });

  test("the page writes the request where only the dashboard can read it", async () => {
    /*
     * The cookie belongs to the dashboard's path: it is not sent to the
     * identity endpoints (which clear every cookie they are sent), and the
     * dashboard is where a sign-in ends. So from the consent screen's own
     * address it is invisible, and from the dashboard's it is there.
     */
    answers.details = refused(401, "Sign in to OneUptime to continue.");

    await renderPage();

    expect(window.location.pathname).toBe(PAGE_PATH);
    expect(document.cookie).not.toContain(PENDING_REQUEST_COOKIE);
    expect(document.cookie).not.toContain(TICKET);

    expect(isRequestRemembered()).toBe(true);
    expect(
      asTheDashboard((): string => {
        return document.cookie;
      }),
    ).toContain(`${PENDING_REQUEST_COOKIE}=${TICKET}`);
  });

  test("a 401 leaves the request remembered and shows nothing alarming", async () => {
    answers.details = refused(401, "Sign in to OneUptime to continue.");

    const { container } = await renderPage();

    expect(screen.queryByTestId("mcp-authorize-problem")).toBeNull();
    expect(container.textContent).not.toContain(
      "Sign in to OneUptime to continue.",
    );
    expect(screen.queryByText(say("errorTitle"))).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-approve")).toBeNull();

    // The page keeps waiting while the browser is on its way to sign in.
    expect(screen.getByRole("status")).toBeInTheDocument();

    expect(rememberedRoute()).toBe(`/accounts/mcp-authorize?request=${TICKET}`);
  });

  test("the remembered request is the one this visit was opened with", async () => {
    answers.details = refused(401, "Sign in.");

    await renderPage(`?request=${OTHER_TICKET}`);

    expect(rememberedRoute()).toBe(
      `/accounts/mcp-authorize?request=${OTHER_TICKET}`,
    );
  });

  test("once the screen has loaded the request is forgotten, so the dashboard does not bounce back here later", async () => {
    await renderPage();

    expect(screen.getByTestId("mcp-authorize-client")).toBeInTheDocument();
    expect(rememberedRoute()).toBeNull();
  });

  test.each([
    ["expired", 400],
    ["forbidden", 403],
    ["refused by the rate limit", 429],
    ["met by a server fault", 500],
  ])(
    "a request that is %s is forgotten too: coming back to it would only fail again",
    async (_label: string, statusCode: number) => {
      answers.details = refused(statusCode, "No.");

      await renderPage();

      expect(screen.getByTestId("mcp-authorize-problem")).toBeInTheDocument();
      expect(rememberedRoute()).toBeNull();
    },
  );

  test("a session that ends while the screen is open: the request is remembered again on Authorize", async () => {
    await renderPage();

    // Forgotten when the screen loaded.
    expect(isRequestRemembered()).toBe(false);

    answers.approve = refused(401, "Your session has expired.");
    await click(approveButton());

    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mcp-authorize-submit-error")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-problem")).toBeNull();

    // Nothing can be pressed while the browser leaves for the sign-in page.
    expect(approveButton()).toBeDisabled();
    expect(denyButton()).toBeDisabled();

    expect(rememberedRoute()).toBe(`/accounts/mcp-authorize?request=${TICKET}`);
  });

  test("and on Cancel", async () => {
    await renderPage();

    expect(isRequestRemembered()).toBe(false);

    answers.deny = refused(401, "Your session has expired.");
    await click(denyButton());

    expect(assign).not.toHaveBeenCalled();
    expect(rememberedRoute()).toBe(`/accounts/mcp-authorize?request=${TICKET}`);
  });

  test("what the API client does with a 401 - sign the visitor out, go to the sign-in page - leaves the request behind for the way back", async () => {
    /*
     * The stand-in for API.post above only hands the page a 401. The real
     * client also acts on it (BaseAPI.handleError), and the first thing it
     * does is sign the visitor out, which removes the session cookies. This
     * runs that for real: the request has to still be there afterwards, or
     * nobody who signs in on the way to connecting a client ever gets back.
     */
    answers.details = refused(401, "Sign in to OneUptime to continue.");

    await renderPage();

    Cookie.setItem(CookieName.Email, "ada@example.com");
    expect(document.cookie).toContain(CookieName.Email);

    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    await act(async () => {
      API.handleError(
        new HTTPErrorResponse(
          401,
          { message: "Sign in to OneUptime to continue." },
          {},
        ),
      );
    });

    // Signed out...
    expect(document.cookie).not.toContain(CookieName.Email);

    // ...sent to sign in, as a full page navigation...
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe("/accounts/login");
    expect(navigate.mock.calls[0]![1]).toEqual({ forceNavigate: true });

    // ...and the request is still waiting.
    expect(rememberedRoute()).toBe(`/accounts/mcp-authorize?request=${TICKET}`);
  });
});

describe("every sentence on the screen comes from the locale", () => {
  const MARK: string = "[[marked]] ";
  const LANGUAGE: string = "ko";

  let originalBundle: JSONObject = {};

  type MarkedFunction = (node: unknown) => unknown;

  // The same section, every string wearing a prefix no real copy has.
  const marked: MarkedFunction = (node: unknown): unknown => {
    if (typeof node === "string") {
      return `${MARK}${node}`;
    }

    if (node && typeof node === "object") {
      const copy: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      )) {
        copy[key] = marked(value);
      }

      return copy;
    }

    return node;
  };

  type UnmarkedFunction = (root: Node, allowed: Array<string>) => Array<string>;

  // Text on the screen that neither came from the locale nor is plain data.
  const unmarkedTexts: UnmarkedFunction = (
    root: Node,
    allowed: Array<string>,
  ): Array<string> => {
    return visibleTexts(root).filter((text: string): boolean => {
      return !text.startsWith(MARK.trim()) && !allowed.includes(text);
    });
  };

  beforeEach(async () => {
    originalBundle = JSON.parse(
      JSON.stringify(i18n.getResourceBundle(LANGUAGE, "translation")),
    ) as JSONObject;

    i18n.addResourceBundle(
      LANGUAGE,
      "translation",
      {
        mcpAuthorize: marked(
          (i18n.getResourceBundle("en", "translation") as JSONObject)[
            "mcpAuthorize"
          ],
        ),
      },
      true,
      true,
    );

    await act(async () => {
      await i18n.changeLanguage(LANGUAGE);
    });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });

    i18n.addResourceBundle(LANGUAGE, "translation", originalBundle, true, true);
  });

  test("the consent form, for a hosted client", async () => {
    answers.details = ok(
      details({
        projects: [
          PRODUCTION,
          STAGING,
          FINANCE_NEEDS_SSO,
        ] as unknown as JSONObject,
      }),
    );

    const { container } = await renderPage();

    expect(say("title").startsWith(MARK)).toBe(true);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      say("title"),
    );

    // Not vacuous: the walk really does see the screen's sentences.
    expect(visibleTexts(container).length).toBeGreaterThanOrEqual(20);
    expect(visibleTexts(container)).toContain(say("permissionsNote"));
    expect(visibleTexts(container)).toContain(say("authorizeButton"));

    // The verified host and the names of selectable projects are data.
    expect(
      unmarkedTexts(container, [
        "claude.ai",
        "Acme Production",
        "Acme Staging",
      ]),
    ).toEqual([]);

    // And without those allowances the same check does notice plain text.
    expect(unmarkedTexts(container, [])).toEqual([
      "claude.ai",
      "Acme Production",
      "Acme Staging",
    ]);
  });

  test("the consent form, for a client on this machine with nothing to connect to", async () => {
    answers.details = ok(
      details({
        client: LOCAL_CLIENT,
        requestedAccess: "read",
        projects: [FINANCE_NEEDS_SSO] as unknown as JSONObject,
      }),
    );

    const { container } = await renderPage();

    expect(unmarkedTexts(container, [])).toEqual([]);
  });

  test("the consent form, for a member with no projects", async () => {
    answers.details = ok(details({ projects: [] as unknown as JSONObject }));

    const { container } = await renderPage();

    expect(unmarkedTexts(container, ["claude.ai"])).toEqual([]);
  });

  test("the error screen", async () => {
    const { container } = await renderPage("?error=redirect_uri_mismatch");

    expect(unmarkedTexts(container, [])).toEqual([]);
  });

  test("the missing-request screen", async () => {
    const { container } = await renderPage("");

    expect(unmarkedTexts(container, [])).toEqual([]);
  });

  test("the sending-you-back screen", async () => {
    const { container } = await renderPage();

    await click(approveButton());

    expect(screen.getByTestId("mcp-authorize-redirecting")).toBeInTheDocument();
    expect(unmarkedTexts(container, [])).toEqual([]);
  });
});

describe("shown inside another page's frame", () => {
  /*
   * A consent screen drawn inside somebody else's page can be dressed up as
   * anything, and its Authorize button clicked by trickery. The bundled proxy
   * forbids framing /accounts; the page holds the same line itself, for an
   * install whose own proxy does not. jsdom is never framed, so the page's
   * own question is answered for it here; the question itself
   * (McpAuthorizeUtil.isFramed) is tested in App's McpAuthorizeUtil suite.
   */
  beforeEach(() => {
    jest.spyOn(McpAuthorizeUtil, "isFramed").mockReturnValue(true);
  });

  test("it refuses to work: nothing is asked of the server and nothing can be authorized", async () => {
    await renderPage();

    expect(posted).toEqual([]);
    expect(screen.queryByTestId("mcp-authorize-approve")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-deny")).toBeNull();
    expect(screen.queryByTestId("mcp-authorize-project")).toBeNull();
    expect(screen.getByTestId("mcp-authorize-problem")).toHaveTextContent(
      say("errors.framed"),
    );
  });

  test("the request is not remembered for a later sign-in either", async () => {
    await renderPage();

    expect(isRequestRemembered()).toBe(false);
  });

  test("it says only that, whatever error the address carries", async () => {
    await renderPage("?error=unknown_client");

    const problem: HTMLElement = screen.getByTestId("mcp-authorize-problem");

    expect(problem).toHaveTextContent(say("errors.framed"));
    expect(problem).not.toHaveTextContent(say("errors.unknown_client"));
  });
});

describe("the frame verdict belongs to the page", () => {
  test("it cannot be put on the screen through the address", async () => {
    await renderPage("?error=framed");

    const problem: HTMLElement = screen.getByTestId("mcp-authorize-problem");

    expect(problem).toHaveTextContent(say("errors.server_error"));
    expect(problem).not.toHaveTextContent(say("errors.framed"));
  });

  test("a page in its own tab is not treated as framed", async () => {
    await renderPage();

    expect(McpAuthorizeUtil.isFramed()).toBe(false);
    expect(screen.getByTestId("mcp-authorize-approve")).toBeInTheDocument();
  });
});

describe("when the server cannot be reached at all", () => {
  /*
   * No answer is not a refusal: the page shows the failure and stays where
   * it is. It must not leave the request behind, or the next visit to the
   * dashboard within ten minutes would be bounced back here for no reason
   * the person can see. (A 401 is the one outcome that keeps it: that visit
   * is on its way to a sign-in.)
   */
  test("the failure is shown and no Authorize button is drawn", async () => {
    answers.details = async (): Promise<HTTPResponse<JSONObject>> => {
      throw new Error("Network Error");
    };

    await renderPage();

    expect(screen.getByTestId("mcp-authorize-problem")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-authorize-approve")).toBeNull();
  });

  test("the request is not left behind for the dashboard", async () => {
    answers.details = async (): Promise<HTTPResponse<JSONObject>> => {
      throw new Error("Network Error");
    };

    await renderPage();

    expect(isRequestRemembered()).toBe(false);
  });
});

describe("read right to left", () => {
  /*
   * Persian is laid out right to left. A page with no direction of its own
   * draws those sentences left to right, and each one that mixes in a Latin
   * name comes out with its pieces in the wrong order - "X wants to access
   * OneUptime" can end up reading the other way round. So the page takes its
   * direction from the language, and sets the values it drops into a
   * sentence apart with Unicode isolates.
   */
  const LEFT_TO_RIGHT_ISOLATE: string = String.fromCodePoint(0x2066);
  const FIRST_STRONG_ISOLATE: string = String.fromCodePoint(0x2068);
  const POP_DIRECTIONAL_ISOLATE: string = String.fromCodePoint(0x2069);

  type IsolatedFunction = (value: string) => string;

  // A name: keeps the direction of its own first letter.
  const isolated: IsolatedFunction = (value: string): string => {
    return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
  };

  // A host, address or email: stated to be left to right.
  const isolatedLeftToRight: IsolatedFunction = (value: string): string => {
    return `${LEFT_TO_RIGHT_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
  };

  type DirectionOfFunction = (container: HTMLElement) => string | null;

  // The direction of the page's outermost element.
  const directionOf: DirectionOfFunction = (
    container: HTMLElement,
  ): string | null => {
    return (container.firstElementChild as HTMLElement).getAttribute("dir");
  };

  describe("in Persian", () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage("fa");
      });
    });

    test("the consent form runs right to left", async () => {
      const { container } = await renderPage();

      expect(i18n.dir()).toBe("rtl");
      expect(directionOf(container)).toBe("rtl");
      expect(screen.getByTestId("mcp-authorize-approve")).toBeInTheDocument();
    });

    test("the error screen runs right to left", async () => {
      const { container } = await renderPage("?error=unknown_client");

      expect(directionOf(container)).toBe("rtl");
    });

    test("the handing-back screen runs right to left", async () => {
      const { container } = await renderPage();

      await click(approveButton());

      expect(
        screen.getByTestId("mcp-authorize-redirecting"),
      ).toBeInTheDocument();
      expect(directionOf(container)).toBe("rtl");
    });

    test("the client's name is set apart inside its sentence", async () => {
      await renderPage();

      expect(screen.getByTestId("mcp-authorize-subtitle").textContent).toBe(
        say("wantsAccess", { clientName: isolated("Claude") }),
      );
    });

    test("an address is stated to be left to right, so it is shown as written", async () => {
      /*
       * "[::1]:33418" has no letters, so an isolate that takes its direction
       * from the first letter inside it falls back to the page's and draws
       * the address backwards. It has to be told.
       */
      answers.details = ok(
        details({
          client: {
            ...LOCAL_CLIENT,
            redirectTarget: "[::1]:33418",
          },
        }),
      );

      await renderPage();

      expect(
        screen.getByTestId("mcp-authorize-redirect-target").textContent,
      ).toBe(
        say("redirectToThisDevice", {
          target: isolatedLeftToRight("[::1]:33418"),
        }),
      );
    });

    test("the signed-in address is left to right, and a refused project's name is set apart", async () => {
      answers.details = ok(
        details({
          projects: [PRODUCTION, FINANCE_NEEDS_SSO] as unknown as JSONObject,
        }),
      );

      await renderPage();

      expect(screen.getByTestId("mcp-authorize-signed-in-as").textContent).toBe(
        say("signedInAs", { email: isolatedLeftToRight("ada@example.com") }),
      );

      expect(
        projectOptions().map((option: HTMLOptionElement): string => {
          return option.textContent || "";
        }),
      ).toContain(
        say("projectRefusal.sso", { name: isolated(FINANCE_NEEDS_SSO.name) }),
      );
    });

    test("what is SENT is never wrapped: the request, project and access are the plain values", async () => {
      await renderPage();

      await click(approveButton());

      const sent: string = JSON.stringify(
        requestsTo(MCP_OAUTH_CONSENT_APPROVE_API_URL),
      );

      expect(sent).toContain(PRODUCTION_ID);
      expect(sent).not.toContain(LEFT_TO_RIGHT_ISOLATE);
      expect(sent).not.toContain(FIRST_STRONG_ISOLATE);
      expect(sent).not.toContain(POP_DIRECTIONAL_ISOLATE);
    });
  });

  describe("in English", () => {
    test("the page runs left to right and nothing is wrapped", async () => {
      const { container } = await renderPage();

      expect(directionOf(container)).toBe("ltr");
      expect(container.textContent).not.toContain(LEFT_TO_RIGHT_ISOLATE);
      expect(container.textContent).not.toContain(FIRST_STRONG_ISOLATE);
      expect(container.textContent).not.toContain(POP_DIRECTIONAL_ISOLATE);
      expect(screen.getByTestId("mcp-authorize-subtitle").textContent).toBe(
        say("wantsAccess", { clientName: "Claude" }),
      );
    });
  });
});
