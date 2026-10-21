import McpOAuthConfig from "../../../Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthSignedToken from "../../../Server/Utils/Mcp/McpOAuthSignedToken";
import { AccountsRoute, DashboardRoute } from "../../../ServiceRoute";
import Route from "../../../Types/API/Route";
import CookieName from "../../../Types/CookieName";
import Cookie from "../../../UI/Utils/Cookie";
import McpOAuthPendingAuthorization, {
  MCP_AUTHORIZE_ROUTE,
} from "../../../UI/Utils/McpOAuthPendingAuthorization";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The cookie that carries an MCP authorization request across a sign-in.
 *
 * Somebody connecting a client lands on the consent screen with a signed
 * ticket in the URL. If they have to sign in first, every sign-in method ends
 * on the dashboard - so the ticket waits in this cookie, and the dashboard
 * sends the browser back. The sections below are the things that have to
 * hold for that to work, and to be safe:
 *
 *   - what is written is a ticket and nothing else, with a lifetime and
 *     attributes that match what it is;
 *   - it is scoped to the DASHBOARD's path. Being sent to the sign-in page
 *     involves a failed session refresh and a logout call, and the server
 *     answers both by clearing every cookie the request carried. A cookie
 *     for /dashboard is never sent to those endpoints, so it cannot be
 *     cleared by them - and the dashboard, the only reader, is exactly where
 *     it is visible. The consent screen, which is NOT under that path, still
 *     has to be able to write it and to remove it;
 *   - what is READ is checked again before it goes anywhere near a URL: the
 *     cookie is browser storage, and whatever is in it becomes a navigation;
 *   - it also survives the browser-side clearing that logout does, which
 *     goes by name.
 *
 * universal-cookie writes straight through to `document.cookie` in jsdom, and
 * jsdom applies a cookie's path the way a browser does, so these observe the
 * real cookie jar from documents at different paths, and record each raw
 * write to check the attributes.
 */

const COOKIE_NAME: string = "oneuptime-mcp-oauth-pending-request";

// Where the three parties to the flow are.
const CONSENT_PAGE: string = "/accounts/mcp-authorize";
const SIGN_IN_PAGE: string = "/accounts/login";
const DASHBOARD_PAGE: string =
  "/dashboard/5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e/home";

const TICKET_PATTERN: RegExp = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

const CONSENT_ROUTE_PATTERN: RegExp =
  /^\/accounts\/mcp-authorize\?request=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

const SAME_SITE_LAX_PATTERN: RegExp = /;\s*SameSite=Lax/i;
const SECURE_ATTRIBUTE_PATTERN: RegExp = /;\s*Secure/i;
const HTTP_ONLY_ATTRIBUTE_PATTERN: RegExp = /;\s*HttpOnly/i;
const DOMAIN_ATTRIBUTE_PATTERN: RegExp = /;\s*Domain=/i;
const MAX_AGE_PATTERN: RegExp = /;\s*Max-Age=(\d+)/i;
const PATH_PATTERN: RegExp = /;\s*Path=([^;]*)/i;

const COOKIE_NAME_DECLARATION_PATTERN: RegExp =
  /const COOKIE_NAME: string = "([^"]+)";/;
const ROOT_PATH_LITERAL_PATTERN: RegExp = /path:\s*["'`]\/["'`]/;

const MAX_TICKET_LENGTH: number = 3500;

// A ticket exactly as the authorization endpoint mints one.
function mintTicket(state: string = "client-state-123"): string {
  const ticket: string | null = McpOAuthSignedToken.sign({
    purpose: {
      keyDerivationLabel: "oneuptime:mcp:oauth:authorization-request:v1",
      maxLength: 6000,
    },
    claims: {
      ci: "https://claude.ai/oauth/claude-code-client-metadata",
      ck: "metadata-document",
      cn: "Claude Code",
      ru: "http://localhost:53124/callback",
      cc: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      st: state,
      sc: "mcp:read mcp:write",
      rs: "https://oneuptime.example.com/mcp",
    },
    expiresInSeconds: 600,
  });

  if (!ticket) {
    throw new Error("expected a ticket to be minted");
  }

  return ticket;
}

// Something shaped like a ticket, of an exact total length.
function ticketOfLength(length: number): string {
  const payloadLength: number = length - "v1.".length - ".".length - 43;

  return `v1.${"A".repeat(payloadLength)}.${"B".repeat(43)}`;
}

// Moves the document, as a navigation within the site would.
function goTo(pagePath: string): void {
  window.history.replaceState({}, "", pagePath);
}

const cookieDescriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "cookie",
) as PropertyDescriptor;

let cookieWrites: Array<string> = [];

function installCookieWriteRecorder(): void {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: (): string => {
      return cookieDescriptor.get!.call(document) as string;
    },
    set: (value: string): void => {
      cookieWrites.push(value);
      cookieDescriptor.set!.call(document, value);
    },
  });
}

function uninstallCookieWriteRecorder(): void {
  // Remove the own-property override so the prototype accessor is used again.
  delete (document as unknown as { cookie?: string }).cookie;
}

// The cookies the document at the CURRENT path can see.
function readJar(): Record<string, string> {
  const jar: Record<string, string> = {};
  const raw: string = document.cookie;

  if (!raw) {
    return jar;
  }

  for (const part of raw.split(";")) {
    const index: number = part.indexOf("=");

    jar[part.slice(0, index).trim()] = decodeURIComponent(
      part.slice(index + 1).trim(),
    );
  }

  return jar;
}

// What a document at `pagePath` sees of the pending-request cookie.
function pendingCookieSeenFrom(pagePath: string): string | undefined {
  const before: string = window.location.pathname;

  goTo(pagePath);

  const value: string | undefined = readJar()[COOKIE_NAME];

  goTo(before);

  return value;
}

function expireEverything(): void {
  for (const pagePath of ["/", DASHBOARD_PAGE]) {
    goTo(pagePath);

    for (const name of Object.keys(readJar())) {
      for (const cookiePath of ["/", "/dashboard"]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${cookiePath}`;
      }
    }
  }

  goTo("/");
}

// Puts a value in the cookie the way a browser would hold it, bypassing remember().
function plantCookie(value: string): void {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; path=/dashboard`;
}

function writesFor(name: string): Array<string> {
  return cookieWrites.filter((write: string): boolean => {
    return write.startsWith(`${name}=`);
  });
}

function lastWrite(): string {
  const writes: Array<string> = writesFor(COOKIE_NAME);

  expect(writes.length).toBeGreaterThan(0);

  return writes[writes.length - 1] as string;
}

function pathOf(write: string): string | undefined {
  return write.match(PATH_PATTERN)?.[1]?.trim();
}

beforeEach((): void => {
  expireEverything();
  // Where a request is remembered in real life.
  goTo(CONSENT_PAGE);
  cookieWrites = [];
  installCookieWriteRecorder();
});

afterEach((): void => {
  uninstallCookieWriteRecorder();
  expireEverything();
});

describe("McpOAuthPendingAuthorization: the consent route", () => {
  test("is /accounts/mcp-authorize, under the accounts app", () => {
    expect(MCP_AUTHORIZE_ROUTE).toBe("/accounts/mcp-authorize");
    expect(MCP_AUTHORIZE_ROUTE).toBe(
      `${AccountsRoute.toString()}/mcp-authorize`,
    );
  });

  test("getConsentRoute puts the ticket in the request parameter", () => {
    const ticket: string = mintTicket();
    const route: Route = McpOAuthPendingAuthorization.getConsentRoute(ticket);

    expect(route).toBeInstanceOf(Route);
    expect(route.toString()).toBe(`/accounts/mcp-authorize?request=${ticket}`);
  });

  test("the route is the path of the consent page the server redirects to", () => {
    expect(new URL(McpOAuthConfig.getConsentPageUrl()).pathname).toBe(
      MCP_AUTHORIZE_ROUTE,
    );
  });
});

describe("McpOAuthPendingAuthorization.isTicket", () => {
  test("accepts a ticket the authorization endpoint minted", () => {
    const ticket: string = mintTicket();

    expect(ticket).toMatch(TICKET_PATTERN);
    expect(McpOAuthPendingAuthorization.isTicket(ticket)).toBe(true);
  });

  test("accepts a ticket carrying the longest state a client may send", () => {
    const ticket: string = mintTicket("s".repeat(1024));

    expect(ticket.length).toBeLessThanOrEqual(MAX_TICKET_LENGTH);
    expect(McpOAuthPendingAuthorization.isTicket(ticket)).toBe(true);
  });

  test("accepts up to 3500 characters and not one more (a cookie holds about 4 KB)", () => {
    expect(
      McpOAuthPendingAuthorization.isTicket(ticketOfLength(MAX_TICKET_LENGTH)),
    ).toBe(true);
    expect(
      McpOAuthPendingAuthorization.isTicket(
        ticketOfLength(MAX_TICKET_LENGTH + 1),
      ),
    ).toBe(false);
    expect(McpOAuthPendingAuthorization.isTicket(ticketOfLength(6000))).toBe(
      false,
    );
  });

  const NOT_TICKETS: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a number", 42],
    ["a boolean", true],
    ["an object", { request: "v1.a.b" }],
    ["an array holding a ticket-shaped string", [`v1.abc.${"A".repeat(43)}`]],
    ["free text", "hello"],
    ["only a version", "v1"],
    ["two segments", "v1.abc"],
    ["an empty payload", `v1..${"A".repeat(43)}`],
    ["a 42-character signature", `v1.abc.${"A".repeat(42)}`],
    ["a 44-character signature", `v1.abc.${"A".repeat(44)}`],
    ["another version", `v2.abc.${"A".repeat(43)}`],
    ["an upper-case version", `V1.abc.${"A".repeat(43)}`],
    ["four segments", `v1.abc.def.${"A".repeat(43)}`],
    ["standard base64 characters", `v1.a+b/c=.${"A".repeat(43)}`],
    ["a leading space", ` v1.abc.${"A".repeat(43)}`],
    ["a trailing newline", `v1.abc.${"A".repeat(43)}\n`],
    ["an ampersand and another parameter", `v1.abc.${"A".repeat(43)}&x=1`],
    ["a fragment", `v1.abc.${"A".repeat(43)}#top`],
    ["a path", `v1.abc.${"A".repeat(43)}/../../dashboard`],
    ["a percent-encoded character", `v1.a%2Fb.${"A".repeat(43)}`],
    ["an absolute URL", "https://evil.example/accounts/mcp-authorize"],
    ["a javascript URL", "javascript:alert(1)"],
    ["markup", "<script>alert(1)</script>"],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.c2lnbmF0dXJl"],
  ];

  test.each(NOT_TICKETS)("refuses %s", (_label: string, value: unknown) => {
    expect(McpOAuthPendingAuthorization.isTicket(value)).toBe(false);
  });
});

describe("McpOAuthPendingAuthorization.remember (called by the consent screen)", () => {
  test("stores the ticket, unchanged, under its own cookie name", () => {
    const ticket: string = mintTicket();

    expect(McpOAuthPendingAuthorization.remember(ticket)).toBe(true);
    expect(pendingCookieSeenFrom(DASHBOARD_PAGE)).toBe(ticket);
  });

  test("writes the ticket and nothing else", () => {
    const ticket: string = mintTicket();

    McpOAuthPendingAuthorization.remember(ticket);

    // One write, and its name=value pair is exactly the ticket.
    expect(writesFor(COOKIE_NAME)).toHaveLength(1);
    expect(cookieWrites).toHaveLength(1);
    expect(lastWrite().split(";")[0]).toBe(`${COOKIE_NAME}=${ticket}`);
  });

  test("scopes the cookie to the dashboard's path, and NOT to the whole site", () => {
    McpOAuthPendingAuthorization.remember(mintTicket());

    expect(pathOf(lastWrite())).toBe("/dashboard");
    expect(pathOf(lastWrite())).toBe(DashboardRoute.toString());
    expect(pathOf(lastWrite())).not.toBe("/");
    expect(lastWrite()).not.toMatch(DOMAIN_ATTRIBUTE_PATTERN);
  });

  test("lives ten minutes, the lifetime of the ticket itself", () => {
    McpOAuthPendingAuthorization.remember(mintTicket());

    const match: RegExpMatchArray | null = lastWrite().match(MAX_AGE_PATTERN);

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(600);
    expect(Number(match![1])).toBe(
      McpOAuthConfig.AUTHORIZATION_REQUEST_TTL_SECONDS,
    );
  });

  test("is SameSite=Lax, so it comes back with the redirect from an identity provider", () => {
    McpOAuthPendingAuthorization.remember(mintTicket());

    expect(lastWrite()).toMatch(SAME_SITE_LAX_PATTERN);
  });

  test("is not marked Secure on a plain-http instance (the browser would drop it)", () => {
    expect(window.location.protocol).toBe("http:");

    McpOAuthPendingAuthorization.remember(mintTicket());

    expect(lastWrite()).not.toMatch(SECURE_ATTRIBUTE_PATTERN);
  });

  test("is readable by the dashboard's script, which is what reads it back", () => {
    McpOAuthPendingAuthorization.remember(mintTicket());

    expect(lastWrite()).not.toMatch(HTTP_ONLY_ATTRIBUTE_PATTERN);
  });

  test("a later request replaces an earlier one", () => {
    const first: string = mintTicket("first");
    const second: string = mintTicket("second");

    McpOAuthPendingAuthorization.remember(first);
    McpOAuthPendingAuthorization.remember(second);

    goTo(DASHBOARD_PAGE);

    expect(readJar()[COOKIE_NAME]).toBe(second);
    expect(McpOAuthPendingAuthorization.consumeRoute()?.toString()).toBe(
      `/accounts/mcp-authorize?request=${second}`,
    );
  });

  const NOT_REMEMBERED: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null (no request parameter)", null],
    ["an empty string", ""],
    ["free text", "hello"],
    ["an absolute URL", "https://evil.example/"],
    ["a ticket with a second parameter", `v1.abc.${"A".repeat(43)}&next=/x`],
    ["a ticket too large for a cookie", ticketOfLength(3501)],
    ["an array holding a ticket", [`v1.abc.${"A".repeat(43)}`]],
  ];

  test.each(NOT_REMEMBERED)(
    "refuses %s, and writes nothing",
    (_label: string, value: unknown) => {
      expect(McpOAuthPendingAuthorization.remember(value)).toBe(false);
      expect(cookieWrites).toEqual([]);
      expect(pendingCookieSeenFrom(DASHBOARD_PAGE)).toBeUndefined();
    },
  );

  test("a refused value does not disturb a request already remembered", () => {
    const ticket: string = mintTicket();

    McpOAuthPendingAuthorization.remember(ticket);

    expect(McpOAuthPendingAuthorization.remember("not a ticket")).toBe(false);
    expect(pendingCookieSeenFrom(DASHBOARD_PAGE)).toBe(ticket);
  });
});

describe("McpOAuthPendingAuthorization: who the cookie is visible to", () => {
  /*
   * A browser sends a cookie only with requests under its path, and shows it
   * only to documents under its path - one rule, which is what these read.
   * "Not visible from /identity/logout" is "never sent to the endpoint that
   * clears every cookie it is sent".
   */

  test("the consent screen writes a cookie it cannot itself see", () => {
    const ticket: string = mintTicket();

    expect(window.location.pathname).toBe(CONSENT_PAGE);

    McpOAuthPendingAuthorization.remember(ticket);

    expect(readJar()[COOKIE_NAME]).toBeUndefined();
    expect(document.cookie).not.toContain(COOKIE_NAME);
  });

  test("written from the consent screen, it is read by the dashboard", () => {
    const ticket: string = mintTicket();

    goTo(CONSENT_PAGE);
    McpOAuthPendingAuthorization.remember(ticket);

    goTo(DASHBOARD_PAGE);

    expect(readJar()[COOKIE_NAME]).toBe(ticket);
    expect(McpOAuthPendingAuthorization.consumeRoute()?.toString()).toBe(
      `/accounts/mcp-authorize?request=${ticket}`,
    );
  });

  const VISIBLE_FROM: Array<[string, string]> = [
    ["the dashboard root", "/dashboard"],
    ["the dashboard root with a slash", "/dashboard/"],
    ["a project's home page", DASHBOARD_PAGE],
    ["a deep dashboard page", "/dashboard/abc/settings/mcp-server"],
  ];

  test.each(VISIBLE_FROM)(
    "is visible from %s",
    (_label: string, pagePath: string) => {
      const ticket: string = mintTicket();

      McpOAuthPendingAuthorization.remember(ticket);

      expect(pendingCookieSeenFrom(pagePath)).toBe(ticket);
    },
  );

  const NOT_VISIBLE_FROM: Array<[string, string]> = [
    ["the site root", "/"],
    ["the consent screen", CONSENT_PAGE],
    ["the sign-in page", SIGN_IN_PAGE],
    ["the session refresh endpoint", "/identity/refresh-token"],
    ["the logout endpoint", "/identity/logout"],
    ["the same endpoints behind /api", "/api/identity/logout"],
    ["the API", "/api/project/get-list"],
    ["the consent endpoints", "/mcp/oauth/consent/details"],
    ["the MCP endpoint", "/mcp"],
    ["the admin dashboard", "/admin/users"],
    ["the public dashboard", "/public-dashboard/abc"],
    ["a status page", "/status-page/abc"],
    ["a path that merely starts with the same letters", "/dashboardx"],
    ["a path that merely starts with the same word", "/dashboard-old/x"],
  ];

  test.each(NOT_VISIBLE_FROM)(
    "is NOT visible from %s",
    (_label: string, pagePath: string) => {
      McpOAuthPendingAuthorization.remember(mintTicket());

      // The control: it is there, for the dashboard.
      expect(pendingCookieSeenFrom(DASHBOARD_PAGE)).toBeDefined();

      expect(pendingCookieSeenFrom(pagePath)).toBeUndefined();
    },
  );
});

describe("McpOAuthPendingAuthorization.consumeRoute (called by the dashboard)", () => {
  test("is null when nothing is remembered, and writes nothing", () => {
    goTo(DASHBOARD_PAGE);

    expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();
    expect(cookieWrites).toEqual([]);
  });

  test("returns the consent route for the remembered request", () => {
    const ticket: string = mintTicket();

    McpOAuthPendingAuthorization.remember(ticket);
    goTo(DASHBOARD_PAGE);

    const route: Route | null = McpOAuthPendingAuthorization.consumeRoute();

    expect(route).toBeInstanceOf(Route);
    expect(route!.toString()).toBe(`/accounts/mcp-authorize?request=${ticket}`);
    expect(route!.toString()).toMatch(CONSENT_ROUTE_PATTERN);
  });

  test("resumes a request exactly once: reading it forgets it", () => {
    McpOAuthPendingAuthorization.remember(mintTicket());
    goTo(DASHBOARD_PAGE);

    expect(McpOAuthPendingAuthorization.consumeRoute()).not.toBeNull();
    expect(readJar()[COOKIE_NAME]).toBeUndefined();
    expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();
    expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();
  });

  test("forgets it with a removal at the SAME path it was written to", () => {
    McpOAuthPendingAuthorization.remember(mintTicket());

    const writtenPath: string | undefined = pathOf(lastWrite());

    goTo(DASHBOARD_PAGE);
    cookieWrites = [];

    McpOAuthPendingAuthorization.consumeRoute();

    expect(writesFor(COOKIE_NAME)).toHaveLength(1);
    expect(pathOf(lastWrite())).toBe("/dashboard");
    expect(pathOf(lastWrite())).toBe(writtenPath);
    expect(Number(lastWrite().match(MAX_AGE_PATTERN)![1])).toBe(0);
  });

  test("finds nothing from the consent screen, and leaves the request for the dashboard", () => {
    const ticket: string = mintTicket();

    McpOAuthPendingAuthorization.remember(ticket);
    cookieWrites = [];

    for (const pagePath of [CONSENT_PAGE, SIGN_IN_PAGE, "/"]) {
      goTo(pagePath);

      expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();
    }

    // Nothing was read, so nothing was removed.
    expect(cookieWrites).toEqual([]);

    goTo(DASHBOARD_PAGE);

    expect(McpOAuthPendingAuthorization.consumeRoute()?.toString()).toBe(
      `/accounts/mcp-authorize?request=${ticket}`,
    );
  });

  test("the route is a relative path on this site, whatever was remembered", () => {
    McpOAuthPendingAuthorization.remember(mintTicket("s".repeat(1024)));
    goTo(DASHBOARD_PAGE);

    const route: string =
      McpOAuthPendingAuthorization.consumeRoute()!.toString();

    expect(route.startsWith("/accounts/mcp-authorize?request=")).toBe(true);
    expect(route.startsWith("//")).toBe(false);
    expect(route).not.toContain("://");
    expect(route.split("?")).toHaveLength(2);
    expect(route).not.toContain("&");
    expect(route).not.toContain("#");
  });

  const PLANTED_GARBAGE: Array<[string, string]> = [
    ["free text", "hello"],
    ["an absolute URL", "https://evil.example/accounts/mcp-authorize"],
    ["a protocol-relative URL", "//evil.example/x"],
    ["a javascript URL", "javascript:alert(1)"],
    [
      "a ticket followed by another parameter",
      `v1.abc.${"A".repeat(43)}&redirect=https://evil.example`,
    ],
    ["a ticket followed by a fragment", `v1.abc.${"A".repeat(43)}#x`],
    ["a ticket followed by a path", `v1.abc.${"A".repeat(43)}/../../x`],
    ["a ticket with spaces in it", `v1. abc .${"A".repeat(43)}`],
    ["a ticket with a trailing newline", `v1.abc.${"A".repeat(43)}\n`],
    ["markup", "<script>alert(1)</script>"],
    ["a JSON object", '{"request":"v1.a.b"}'],
    ["a JSON string holding a ticket", `"v1.abc.${"A".repeat(43)}"`],
    ["a JSON array", "[1,2,3]"],
    ["the word true", "true"],
    ["a number", "12345"],
    ["a ticket that is too long", ticketOfLength(3501)],
  ];

  test.each(PLANTED_GARBAGE)(
    "a cookie holding %s yields no route, and is cleared",
    (_label: string, value: string) => {
      goTo(DASHBOARD_PAGE);

      plantCookie(value);
      expect(readJar()[COOKIE_NAME]).toBe(value);

      expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();

      // It is not left behind to be tried again on the next page load.
      expect(readJar()[COOKIE_NAME]).toBeUndefined();
      expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();
    },
  );

  test("reads the cookie as text: a ticket is never parsed as JSON on the way out", () => {
    /*
     * universal-cookie parses anything that looks like JSON unless told not
     * to. A real ticket never does, so this plants the nearest thing - a
     * ticket-shaped value - and checks it comes back as the same string.
     */
    const ticket: string = ticketOfLength(200);

    goTo(DASHBOARD_PAGE);
    plantCookie(ticket);

    expect(McpOAuthPendingAuthorization.consumeRoute()?.toString()).toBe(
      `/accounts/mcp-authorize?request=${ticket}`,
    );
  });

  test("leaves every other cookie alone", () => {
    document.cookie = "user-token=abc; path=/";
    document.cookie = "some-other-cookie=xyz; path=/";
    document.cookie = "dashboard-preference=dark; path=/dashboard";

    McpOAuthPendingAuthorization.remember(mintTicket());

    goTo(DASHBOARD_PAGE);

    McpOAuthPendingAuthorization.consumeRoute();
    McpOAuthPendingAuthorization.clear();

    expect(readJar()).toEqual({
      "user-token": "abc",
      "some-other-cookie": "xyz",
      "dashboard-preference": "dark",
    });
  });
});

describe("McpOAuthPendingAuthorization.clear", () => {
  test("from the consent screen, removes the cookie it cannot see", () => {
    /*
     * The consent screen clears the request once it has loaded for a
     * signed-in person, so a later visit to the dashboard does not bounce
     * them back. It is not under the cookie's path, so the removal has to
     * name the path.
     */
    McpOAuthPendingAuthorization.remember(mintTicket());
    expect(pendingCookieSeenFrom(DASHBOARD_PAGE)).toBeDefined();

    expect(window.location.pathname).toBe(CONSENT_PAGE);
    McpOAuthPendingAuthorization.clear();

    expect(pendingCookieSeenFrom(DASHBOARD_PAGE)).toBeUndefined();

    goTo(DASHBOARD_PAGE);
    expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();
  });

  test("from the dashboard, removes it too", () => {
    McpOAuthPendingAuthorization.remember(mintTicket());
    goTo(DASHBOARD_PAGE);

    McpOAuthPendingAuthorization.clear();

    expect(readJar()[COOKIE_NAME]).toBeUndefined();
    expect(McpOAuthPendingAuthorization.consumeRoute()).toBeNull();
  });

  test("removes at the dashboard's path, the one the cookie was written to", () => {
    McpOAuthPendingAuthorization.remember(mintTicket());
    cookieWrites = [];

    McpOAuthPendingAuthorization.clear();

    expect(writesFor(COOKIE_NAME)).toHaveLength(1);
    expect(pathOf(lastWrite())).toBe("/dashboard");
    expect(Number(lastWrite().match(MAX_AGE_PATTERN)![1])).toBe(0);
  });

  test("is harmless when there is nothing to forget", () => {
    expect(() => {
      McpOAuthPendingAuthorization.clear();
      McpOAuthPendingAuthorization.clear();
    }).not.toThrow();

    expect(pendingCookieSeenFrom(DASHBOARD_PAGE)).toBeUndefined();
  });
});

describe("McpOAuthPendingAuthorization survives being sent to the sign-in page", () => {
  test("its cookie name is NOT in the CookieName enum", () => {
    /*
     * UserUtil.logout() removes exactly the cookies named in that enum. If
     * this name were added to it, a visit that turned into a sign-in would
     * lose the request it came for.
     */
    McpOAuthPendingAuthorization.remember(mintTicket());

    const writtenName: string = lastWrite().split("=")[0] as string;

    expect(writtenName).toBe(COOKIE_NAME);
    expect(Object.values(CookieName) as Array<string>).not.toContain(
      writtenName,
    );
  });

  test("the browser-side clearing that logout does leaves the remembered request in place", () => {
    const ticket: string = mintTicket();

    McpOAuthPendingAuthorization.remember(ticket);

    // A session cookie, so there is something for logout to clear.
    Cookie.setItem(CookieName.UserID, "user-123");
    expect(readJar()[CookieName.UserID]).toBe("user-123");

    // What UserUtil.logout() does to cookies, from the page it runs on.
    Cookie.clearAllCookies();

    expect(readJar()[CookieName.UserID]).toBeUndefined();

    goTo(DASHBOARD_PAGE);

    expect(readJar()[COOKIE_NAME]).toBe(ticket);
    expect(McpOAuthPendingAuthorization.consumeRoute()?.toString()).toBe(
      `/accounts/mcp-authorize?request=${ticket}`,
    );
  });

  test("the same clearing run from the dashboard leaves it in place as well", () => {
    const ticket: string = mintTicket();

    McpOAuthPendingAuthorization.remember(ticket);
    goTo(DASHBOARD_PAGE);

    Cookie.clearAllCookies();

    expect(readJar()[COOKIE_NAME]).toBe(ticket);
  });

  test("a server-side clear of every cookie a request carried cannot reach it", () => {
    /*
     * The failed session refresh and the logout call each answer by expiring
     * every cookie they were SENT, at the root path. This cookie is not sent
     * to them - and even an expiry of its name at the root path is a
     * different cookie from the one at /dashboard.
     */
    const ticket: string = mintTicket();

    McpOAuthPendingAuthorization.remember(ticket);

    // The session cookies the identity endpoints do see, and do clear.
    document.cookie = "user-token=abc; path=/";

    goTo("/identity/logout");

    const sentToTheEndpoint: Array<string> = Object.keys(readJar());

    expect(sentToTheEndpoint).toContain("user-token");
    expect(sentToTheEndpoint).not.toContain(COOKIE_NAME);

    for (const name of [...sentToTheEndpoint, COOKIE_NAME]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }

    expect(readJar()["user-token"]).toBeUndefined();

    goTo(DASHBOARD_PAGE);

    expect(McpOAuthPendingAuthorization.consumeRoute()?.toString()).toBe(
      `/accounts/mcp-authorize?request=${ticket}`,
    );
  });
});

describe("McpOAuthPendingAuthorization: the source says the same", () => {
  /*
   * The two facts above that are constants in the module, read from the
   * module itself, so that changing either is a decision made here too.
   */
  const source: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../UI/Utils/McpOAuthPendingAuthorization.ts",
    ),
    "utf8",
  );

  test("the cookie's path is the dashboard route, taken from ServiceRoute", () => {
    expect(source).toContain(
      "const COOKIE_PATH: string = DashboardRoute.toString();",
    );
    expect(DashboardRoute.toString()).toBe("/dashboard");
  });

  test("it is written and removed with that one path, and never with a literal root path", () => {
    expect(source).toContain("path: COOKIE_PATH,");
    expect(source).toContain("remove(COOKIE_NAME, { path: COOKIE_PATH })");
    expect(source).not.toMatch(ROOT_PATH_LITERAL_PATTERN);
  });

  test("the cookie's name is the one these tests use, and is absent from CookieName", () => {
    const declared: string | undefined = source.match(
      COOKIE_NAME_DECLARATION_PATTERN,
    )?.[1];

    expect(declared).toBe(COOKIE_NAME);
    expect(Object.values(CookieName) as Array<string>).not.toContain(declared);
    expect(Object.keys(CookieName)).toHaveLength(
      Object.values(CookieName).length,
    );
  });

  test("the consent route is built from the accounts route", () => {
    expect(source).toContain("AccountsRoute.toString()");
    expect(AccountsRoute.toString()).toBe("/accounts");
  });
});
