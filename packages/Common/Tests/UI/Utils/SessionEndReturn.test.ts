import Route from "../../../Types/API/Route";
import { SessionEndReason } from "../../../Types/UserSession/SessionLength";
import SessionEndReturn, {
  MAX_AGE_IN_SECONDS,
  MAX_PAGE_LENGTH,
  SESSION_END_RETURN_COOKIE_NAME,
} from "../../../UI/Utils/SessionEndReturn";
import Cookie from "../../../UI/Utils/Cookie";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * BACK TO THE PAGE A PERSON WAS ON, ONCE THEIR SESSION ENDED AND THEY SIGNED
 * IN AGAIN (UI/Utils/SessionEndReturn).
 *
 * The page waits in a cookie for the Dashboard, the only reader:
 *
 *   - scoped to /dashboard, so the sign-in page, the refresh that failed and
 *     the logout call - whose answers clear every cookie they carry - never
 *     see it, and the browser-side clearing at logout (by name, at /) leaves
 *     it alone; it lasts a day, and is read once;
 *   - for one person: someone else signing in on the same browser starts on
 *     their own home page;
 *   - only ever a Dashboard or Admin Dashboard address on this server, checked
 *     when it is written and again when it is read, as the cookie is browser
 *     storage and what is in it becomes a navigation.
 *
 * jsdom applies a cookie's path as a browser does, so these read the real
 * cookie jar from documents at different paths.
 */

const USER_ID: string = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
const OTHER_USER_ID: string = "6b6b6b6b-6b6b-46b6-86b6-6b6b6b6b6b6b";
const PROJECT_ID: string = "7c7c7c7c-7c7c-47c7-87c7-7c7c7c7c7c7c";

const INCIDENT_PAGE: string = `/dashboard/${PROJECT_ID}/incidents/view/123?tab=notes#timeline`;
const DASHBOARD_HOME: string = `/dashboard/${PROJECT_ID}/home`;
const SIGN_IN_PAGE: string = "/accounts/login";

// Moves the document, as a navigation within the site would.
const goTo: (pagePath: string) => void = (pagePath: string): void => {
  window.history.replaceState({}, "", pagePath);
};

// What a document at `pagePath` sees of the cookie, raw.
const cookieSeenFrom: (pagePath: string) => string | undefined = (
  pagePath: string,
): string | undefined => {
  const before: string = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  goTo(pagePath);

  const entry: string | undefined = document.cookie
    .split(";")
    .map((part: string): string => {
      return part.trim();
    })
    .find((part: string): boolean => {
      return part.startsWith(`${SESSION_END_RETURN_COOKIE_NAME}=`);
    });

  goTo(before);

  return entry
    ? decodeURIComponent(entry.slice(SESSION_END_RETURN_COOKIE_NAME.length + 1))
    : undefined;
};

// Puts a value in the cookie as a browser would hold it, bypassing remember().
const plant: (value: string) => void = (value: string): void => {
  document.cookie = `${SESSION_END_RETURN_COOKIE_NAME}=${encodeURIComponent(value)}; path=/dashboard`;
};

const forgetEverything: () => void = (): void => {
  for (const cookiePath of ["/", "/dashboard"]) {
    document.cookie = `${SESSION_END_RETURN_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${cookiePath}`;
  }
};

beforeEach(() => {
  goTo(DASHBOARD_HOME);
  forgetEverything();
});

afterEach(() => {
  goTo(DASHBOARD_HOME);
  forgetEverything();
  jest.restoreAllMocks();
});

describe("isReturnablePage: only the Dashboard's and the Admin Dashboard's own pages", () => {
  test.each([
    ["/dashboard"],
    [INCIDENT_PAGE],
    [`/dashboard/${PROJECT_ID}/monitors?filter=down`],
    ["/admin"],
    ["/admin/settings/session-length"],
    ["/admin#users"],
  ])("%s is one", (page: string) => {
    expect(SessionEndReturn.isReturnablePage(page)).toBe(true);
  });

  test.each([
    [""],
    ["/"],
    [SIGN_IN_PAGE],
    ["/status-page/abc"],
    ["/dashboardish/abc"],
    ["/administrator"],
    ["//evil.example.com/dashboard"],
    ["https://evil.example.com/dashboard"],
    ["dashboard/abc"],
    ["/dashboard\\..\\accounts"],
    ["javascript:alert(1)//dashboard"],
  ])("%p is not", (page: string) => {
    expect(SessionEndReturn.isReturnablePage(page)).toBe(false);
  });

  test("nor is anything that is no string", () => {
    for (const value of [null, undefined, 42, { page: "/dashboard" }, []]) {
      expect(SessionEndReturn.isReturnablePage(value)).toBe(false);
    }
  });

  test(`a page up to ${MAX_PAGE_LENGTH} characters is kept, and not one more`, () => {
    const prefix: string = "/dashboard/";

    expect(
      SessionEndReturn.isReturnablePage(
        prefix + "a".repeat(MAX_PAGE_LENGTH - prefix.length),
      ),
    ).toBe(true);
    expect(
      SessionEndReturn.isReturnablePage(
        prefix + "a".repeat(MAX_PAGE_LENGTH - prefix.length + 1),
      ),
    ).toBe(false);
  });
});

describe("remembering the page, and bringing its person back to it", () => {
  test("the page the browser is on, with its query and fragment, comes back once for the same person", () => {
    goTo(INCIDENT_PAGE);

    expect(SessionEndReturn.rememberCurrentPage(USER_ID)).toBe(true);

    const route: Route | null = SessionEndReturn.consumeRoute(USER_ID);

    expect(route?.toString()).toBe(INCIDENT_PAGE);

    // Used once: reading it removed it.
    expect(SessionEndReturn.consumeRoute(USER_ID)).toBeNull();
    expect(cookieSeenFrom(DASHBOARD_HOME)).toBeUndefined();
  });

  test("the person is matched whatever the case of their id", () => {
    SessionEndReturn.remember({
      userId: USER_ID.toUpperCase(),
      page: INCIDENT_PAGE,
    });

    expect(SessionEndReturn.consumeRoute(` ${USER_ID} `)?.toString()).toBe(
      INCIDENT_PAGE,
    );
  });

  test("someone else signing in on the same browser starts on their own home page, and the page is forgotten", () => {
    SessionEndReturn.remember({ userId: USER_ID, page: INCIDENT_PAGE });

    expect(SessionEndReturn.consumeRoute(OTHER_USER_ID)).toBeNull();
    expect(SessionEndReturn.consumeRoute(USER_ID)).toBeNull();
  });

  test("no one signed in: nothing comes back, and nothing is left behind", () => {
    SessionEndReturn.remember({ userId: USER_ID, page: INCIDENT_PAGE });

    expect(SessionEndReturn.consumeRoute(null)).toBeNull();
    expect(cookieSeenFrom(DASHBOARD_HOME)).toBeUndefined();
  });

  test("without a person, or on a page that is not one to return to, nothing is remembered", () => {
    expect(SessionEndReturn.remember({ userId: "", page: INCIDENT_PAGE })).toBe(
      false,
    );
    expect(
      SessionEndReturn.remember({ userId: undefined, page: INCIDENT_PAGE }),
    ).toBe(false);
    expect(
      SessionEndReturn.remember({ userId: USER_ID, page: SIGN_IN_PAGE }),
    ).toBe(false);

    goTo(SIGN_IN_PAGE);
    expect(SessionEndReturn.rememberCurrentPage(USER_ID)).toBe(false);

    expect(cookieSeenFrom(DASHBOARD_HOME)).toBeUndefined();
  });

  test("the cookie holds who and where, and nothing else", () => {
    SessionEndReturn.remember({ userId: USER_ID, page: INCIDENT_PAGE });

    expect(JSON.parse(cookieSeenFrom(DASHBOARD_HOME) || "null")).toEqual({
      userId: USER_ID,
      page: INCIDENT_PAGE,
    });
  });
});

describe("where the cookie lives, and for how long", () => {
  test("only pages under /dashboard see it: the sign-in page, the identity service and the status pages never do", () => {
    goTo(INCIDENT_PAGE);
    SessionEndReturn.rememberCurrentPage(USER_ID);

    expect(cookieSeenFrom(DASHBOARD_HOME)).toBeDefined();
    expect(cookieSeenFrom(SIGN_IN_PAGE)).toBeUndefined();
    expect(cookieSeenFrom("/identity/refresh-token")).toBeUndefined();
    expect(cookieSeenFrom("/status-page/abc")).toBeUndefined();

    // Read from anywhere else, it is not there: null, and it stays for the Dashboard.
    goTo(SIGN_IN_PAGE);
    expect(SessionEndReturn.consumeRoute(USER_ID)).toBeNull();
    expect(cookieSeenFrom(DASHBOARD_HOME)).toBeDefined();
  });

  test("the browser-side clearing at logout, which goes by name at /, leaves it", () => {
    SessionEndReturn.remember({ userId: USER_ID, page: INCIDENT_PAGE });

    Cookie.clearAllCookies();

    expect(SessionEndReturn.consumeRoute(USER_ID)?.toString()).toBe(
      INCIDENT_PAGE,
    );
  });

  test("it is written for a day, SameSite=Lax, at /dashboard", () => {
    const writes: Array<string> = [];
    const descriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "cookie",
    ) as PropertyDescriptor;

    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: (): string => {
        return descriptor.get!.call(document) as string;
      },
      set: (value: string): void => {
        writes.push(value);
        descriptor.set!.call(document, value);
      },
    });

    try {
      SessionEndReturn.remember({ userId: USER_ID, page: INCIDENT_PAGE });
    } finally {
      delete (document as unknown as { cookie?: string }).cookie;
    }

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(
      new RegExp(`;\\s*Max-Age=${MAX_AGE_IN_SECONDS}`, "i"),
    );
    expect(writes[0]).toMatch(/;\s*Path=\/dashboard(;|$)/i);
    expect(writes[0]).toMatch(/;\s*SameSite=Lax/i);
    // This page is on plain HTTP, which cannot keep a Secure cookie.
    expect(writes[0]).not.toMatch(/;\s*Secure/i);
    expect(writes[0]).not.toMatch(/;\s*Domain=/i);
  });

  test("clear forgets it", () => {
    SessionEndReturn.remember({ userId: USER_ID, page: INCIDENT_PAGE });

    SessionEndReturn.clear();

    expect(SessionEndReturn.consumeRoute(USER_ID)).toBeNull();
  });
});

describe("what is read is checked again before it becomes a navigation", () => {
  test.each([
    ["not JSON", "dashboard please"],
    ["JSON that is no object", '"/dashboard"'],
    ["no person", JSON.stringify({ page: INCIDENT_PAGE })],
    [
      "a person that is no string",
      JSON.stringify({ userId: 7, page: INCIDENT_PAGE }),
    ],
    [
      "another site",
      JSON.stringify({ userId: USER_ID, page: "//evil.example.com/dashboard" }),
    ],
    [
      "a page that is no page of ours",
      JSON.stringify({ userId: USER_ID, page: "/accounts/forgot-password" }),
    ],
    [
      "a page that is no string",
      JSON.stringify({ userId: USER_ID, page: ["/dashboard"] }),
    ],
  ])(
    "%s: nothing comes back, and the cookie is removed",
    (_label: string, value: string) => {
      plant(value);

      expect(SessionEndReturn.consumeRoute(USER_ID)).toBeNull();
      expect(cookieSeenFrom(DASHBOARD_HOME)).toBeUndefined();
    },
  );
});

describe("getSignInRoute: the sign-in page says why, when the server said why", () => {
  test.each([
    [
      SessionEndReason.LengthReached,
      "/accounts/login?sessionEnded=length-reached",
    ],
    [SessionEndReason.Inactive, "/accounts/login?sessionEnded=inactive"],
  ])("%s", (reason: SessionEndReason, expected: string) => {
    const loginRoute: Route = new Route(SIGN_IN_PAGE);

    expect(SessionEndReturn.getSignInRoute(loginRoute, reason).toString()).toBe(
      expected,
    );
    // The login route it was handed is left as it was.
    expect(loginRoute.toString()).toBe(SIGN_IN_PAGE);
  });

  test("no reason: the sign-in page as it is", () => {
    expect(
      SessionEndReturn.getSignInRoute(new Route(SIGN_IN_PAGE), null).toString(),
    ).toBe(SIGN_IN_PAGE);
  });
});
