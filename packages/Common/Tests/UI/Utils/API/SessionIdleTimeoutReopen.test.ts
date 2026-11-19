// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, {
  FakeReply,
  FakeTransport,
  RENEWED_SESSION,
  SentRequest,
} from "./FakeAxiosServer";
import UserSession from "../../../../Models/DatabaseModels/UserSession";
import UserSessionService, {
  Service,
  SessionRenewalDecision,
} from "../../../../Server/Services/UserSessionService";
import BaseAPI from "../../../../UI/Utils/API/API";
import { IDENTITY_URL } from "../../../../UI/Config";
import Navigation from "../../../../UI/Utils/Navigation";
import SessionEndReturn from "../../../../UI/Utils/SessionEndReturn";
import User from "../../../../UI/Utils/User";
import UserActivity, {
  LAST_ACTIVITY_STORAGE_KEY,
  PAGE_HIDE_EVENTS,
} from "../../../../UI/Utils/UserActivity";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import OneUptimeDate from "../../../../Types/Date";
import { SESSION_ENDED_MESSAGES } from "../../../../Types/Exception/SessionEndedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Sleep from "../../../../Types/Sleep";
import {
  INACTIVE_FOR_IN_SECONDS_FIELD,
  LONGEST_INACTIVITY_FIELD,
  readReportedInactivityInSeconds,
  readReportedLongestInactivity,
  SessionEndReason,
  SessionLengths,
} from "../../../../Types/UserSession/SessionLength";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../../../Server/Enterprise/FakeEnterpriseModule";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

jest.mock("../../../../Server/Utils/Logger");

/*
 * ISSUE #6789, FROM THE BROWSER TO THE SERVER'S DECISION AND BACK.
 *
 * With an idle timeout set (Admin Dashboard > Settings > Session Length),
 * someone who closed the browser - or whose computer slept, or who left
 * every tab unused - and opens the Dashboard again after the idle timeout
 * had their session continue: opening the page is activity, so the first
 * renewal said they were active a moment ago. Here the Dashboard's real
 * client (UserActivity, BaseAPI) talks to a stand-in for the identity
 * server that decides each renewal with the real UserSessionService.
 * decideRenewal, reading the body as POST /identity/refresh-token does, and
 * signs access tokens that live as the real ones do
 * (Service.getAccessTokenExpiresInSeconds). Only the transport, the
 * database row and the browser's navigation are stand-ins.
 *
 * Checked from both sides:
 *
 *   - the browser opened again after the idle timeout is signed out, and
 *     the sign-in page says why; just before it, the session goes on;
 *   - so is a tab left open on a computer that slept, and one where a
 *     long pause ended a while before the renewal;
 *   - someone working - even under the shortest idle timeout, even in
 *     another tab while this one stood hidden - is never signed out;
 *   - without an idle timeout nothing changes, and a session length beside
 *     one ends the session at whichever comes first.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

const INCIDENTS_URL: string = `${DASHBOARD_ORIGIN}/api/incident/get-list`;

const PROJECT_ID: string = "6c6c6c6c-6c6c-46c6-86c6-6c6c6c6c6c6c";
const USER_ID: string = "7d7d7d7d-7d7d-47d7-87d7-7d7d7d7d7d7d";
const SESSION_ID: string = "8e8e8e8e-8e8e-48e8-88e8-8e8e8e8e8e8e";

const INCIDENT_PAGE: string = `/dashboard/${PROJECT_ID}/incidents`;

const LOGIN_ROUTE: string = "/accounts/login";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOT_AUTHENTICATED_BODY: JSONObject = {
  message: "Authentication required. Please sign in to access this resource.",
};

const lengthsOf: (rule: {
  length?: number;
  idle?: number;
}) => SessionLengths = (rule: {
  length?: number;
  idle?: number;
}): SessionLengths => {
  const standard: {
    lengthInMinutes: number | null;
    idleTimeoutInMinutes: number | null;
  } = {
    lengthInMinutes: rule.length ?? null,
    idleTimeoutInMinutes: rule.idle ?? null,
  };

  return { standard: standard, sso: { ...standard } };
};

let nowInMs: number = 0;

let server: FakeAxiosServer;

let fake: FakeEnterpriseModule;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

let logoutSpy: jest.SpiedFunction<typeof User.logout>;

/*
 * The identity server, as far as one session goes: the session's row, the
 * access token it last signed, and what it answered.
 */
class IdentityServer {
  public readonly session: UserSession;

  public accessTokenExpiresAtMs: number;

  public endedFor: SessionEndReason | null = null;

  // When its person was last active, as the renewal that ended it said.
  public endedLastActiveAt: Date | null = null;

  public renewals: number = 0;

  public constructor() {
    const signedInAt: Date = new Date(nowInMs);

    this.session = new UserSession();
    this.session.id = new ObjectID(SESSION_ID);
    this.session.userId = new ObjectID(USER_ID);
    this.session.createdAt = signedInAt;
    this.session.lastActiveAt = signedInAt;
    this.session.additionalInfo = { isGlobalLogin: true };

    this.accessTokenExpiresAtMs =
      nowInMs + this.accessTokenLifetimeMs(fake.userSessionLengths);
  }

  // A request of the Dashboard's: answered while its access token lives.
  public answerRequest(): FakeReply {
    if (this.endedFor === null && nowInMs < this.accessTokenExpiresAtMs) {
      return { status: 200, data: { count: 1 } };
    }

    return { status: 401, data: NOT_AUTHENTICATED_BODY };
  }

  // POST /identity/refresh-token, as Authentication.ts reads and decides it.
  public async answerRenewal(body: unknown): Promise<FakeReply> {
    if (this.endedFor !== null) {
      return {
        status: 401,
        data: { message: SESSION_ENDED_MESSAGES[this.endedFor] },
      };
    }

    const json: JSONObject = (body || {}) as JSONObject;

    const decision: SessionRenewalDecision =
      await UserSessionService.decideRenewal({
        session: this.session,
        reportedInactivityInSeconds: readReportedInactivityInSeconds(
          json[INACTIVE_FOR_IN_SECONDS_FIELD],
        ),
        reportedLongestInactivity: readReportedLongestInactivity(
          json[LONGEST_INACTIVITY_FIELD],
        ),
      });

    if (decision.hasEnded) {
      this.endedFor = decision.reason;
      this.endedLastActiveAt = decision.lastActiveAt;

      return {
        status: 401,
        data: { message: SESSION_ENDED_MESSAGES[decision.reason] },
      };
    }

    this.renewals++;
    this.session.lastActiveAt = decision.lastActiveAt;
    this.accessTokenExpiresAtMs =
      nowInMs + this.accessTokenLifetimeMs(decision.lengths);

    // The session's new tokens, as the server answers a renewal it made.
    return RENEWED_SESSION;
  }

  private accessTokenLifetimeMs(lengths: SessionLengths | null): number {
    return (
      Service.getAccessTokenExpiresInSeconds({
        facts: Service.getSessionFacts(this.session, new Date(nowInMs)),
        lengths: lengths,
        now: new Date(nowInMs),
      }) * SECOND
    );
  }
}

let identity: IdentityServer;

// Every request is answered as it arrives, by the identity server's state then.
const answerEveryRequest: () => void = (): void => {
  server.onRequest = (request: SentRequest): void => {
    if (request.url === INCIDENTS_URL) {
      server.on(HTTPMethod.POST, INCIDENTS_URL, [identity.answerRequest()]);
      return;
    }

    if (request.url === REFRESH_URL) {
      const reply: FakeReply = {};

      reply.gate = identity
        .answerRenewal(request.data)
        .then((answer: FakeReply): void => {
          reply.status = answer.status;
          reply.data = answer.data;
        });

      server.on(HTTPMethod.POST, REFRESH_URL, [reply]);
    }
  };
};

// The person signs in, and the Dashboard opens.
const signIn: (lengths: SessionLengths | null) => void = (
  lengths: SessionLengths | null,
): void => {
  fake.userSessionLengths = lengths;
  identity = new IdentityServer();
  openDashboard();
};

// A page of the Dashboard opens: a new page, which reads what the browser kept.
const openDashboard: () => void = (): void => {
  UserActivity.resetForTests();
  UserActivity.install();
};

// The browser is closed: the page goes, and what it wrote down stays.
const closeBrowser: () => void = (): void => {
  for (const eventName of PAGE_HIDE_EVENTS) {
    window.dispatchEvent(new Event(eventName));
  }

  UserActivity.resetForTests();
};

const wait: (ms: number) => void = (ms: number): void => {
  nowInMs += ms;
};

// The person moves the pointer on the page.
const use: () => void = (): void => {
  window.dispatchEvent(new Event("pointermove"));
};

// The page asks for its incidents: what it gets, after any renewal it needed.
const loadIncidents: () => Promise<number> = async (): Promise<number> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await BaseAPI.post<JSONObject>({ url: URL.fromString(INCIDENTS_URL) });

  return response.statusCode;
};

const renewalBodies: () => Array<JSONObject> = (): Array<JSONObject> => {
  return server
    .requestsTo(HTTPMethod.POST, REFRESH_URL)
    .map((request: SentRequest): JSONObject => {
      return (request.data || {}) as JSONObject;
    });
};

const navigatedRoutes: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map(
    (call: Parameters<typeof Navigation.navigate>): string => {
      return call[0].toString();
    },
  );
};

const expectSignedOutFor: (reason: string) => void = (reason: string): void => {
  expect(logoutSpy).toHaveBeenCalled();
  expect(navigatedRoutes().length).toBeGreaterThan(0);

  for (const route of navigatedRoutes()) {
    expect(route).toBe(`${LOGIN_ROUTE}?sessionEnded=${reason}`);
  }
};

const expectStillSignedIn: () => void = (): void => {
  expect(identity.endedFor).toBeNull();
  expect(logoutSpy).not.toHaveBeenCalled();
  expect(navigateSpy).not.toHaveBeenCalled();
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", INCIDENT_PAGE);
  SessionEndReturn.clear();
  UserActivity.resetForTests();
  BaseAPI.resetSessionEndForTests();

  nowInMs = 1_800_000_000_000;

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowInMs;
  });
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(nowInMs);
  });
  jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
    nowInMs += ms;
  });
  jest.spyOn(Math, "random").mockReturnValue(0.5);

  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  logoutSpy = jest.spyOn(User, "logout").mockResolvedValue(null);
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route(INCIDENT_PAGE));

  fake = installFakeEnterpriseModule({ userSessionLengths: null });
  server = new FakeAxiosServer(mockedAxios);
  answerEveryRequest();
});

afterEach(() => {
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  uninstallEnterpriseModule();
  UserActivity.resetForTests();
  BaseAPI.resetSessionEndForTests();
  window.history.replaceState({}, "", INCIDENT_PAGE);
  SessionEndReturn.clear();
  localStorage.clear();
});

describe("the Dashboard opened again after the browser stood closed", () => {
  test("past the idle timeout: the first renewal ends the session, the sign-in page says why, and the end is recorded as of when they left", async () => {
    signIn(lengthsOf({ idle: 30 }));

    wait(MINUTE);
    use();
    expect(await loadIncidents()).toBe(200);
    const leftAtMs: number = nowInMs;

    wait(MINUTE);
    closeBrowser();

    wait(2 * HOUR);
    openDashboard();

    expect(await loadIncidents()).toBe(401);

    // The page said its person was here - and how long they were away.
    expect(renewalBodies()).toEqual([
      {
        [INACTIVE_FOR_IN_SECONDS_FIELD]: 0,
        [LONGEST_INACTIVITY_FIELD]: {
          forSeconds: (2 * HOUR + MINUTE) / SECOND,
          endedSecondsAgo: 0,
        },
      },
    ]);
    expect(identity.endedFor).toBe(SessionEndReason.Inactive);
    expect(identity.endedLastActiveAt).toEqual(new Date(leftAtMs));
    expectSignedOutFor("inactive");
  });

  test.each([
    ["a second short of the idle timeout: the session goes on", -SECOND, false],
    ["the idle timeout exactly: it has ended", 0, true],
    ["a second past it: it has ended", SECOND, true],
  ])(
    "closed for %s",
    async (_label: string, pastTimeoutMs: number, hasEnded: boolean) => {
      signIn(lengthsOf({ idle: 30 }));

      wait(5 * SECOND);
      use();
      closeBrowser();

      wait(30 * MINUTE + pastTimeoutMs);
      openDashboard();

      const status: number = await loadIncidents();

      if (hasEnded) {
        expect(status).toBe(401);
        expect(identity.endedFor).toBe(SessionEndReason.Inactive);
        expectSignedOutFor("inactive");
      } else {
        expect(status).toBe(200);
        expect(identity.renewals).toBe(1);
        expectStillSignedIn();
      }
    },
  );

  test("closed for less than its access token's life, it asks for nothing on opening; a pause past the idle timeout after that ends it at the next renewal", async () => {
    signIn(lengthsOf({ idle: 15 }));

    use();
    closeBrowser();

    // Closed for 10 minutes: its access token, signed for 15, still works.
    wait(10 * MINUTE);
    openDashboard();

    expect(await loadIncidents()).toBe(200);
    expect(renewalBodies()).toHaveLength(0);

    // Back and working, then away 15 minutes with the tab open.
    wait(MINUTE);
    use();
    wait(15 * MINUTE);
    use();

    expect(await loadIncidents()).toBe(401);
    expect(identity.endedFor).toBe(SessionEndReason.Inactive);
  });

  test("without an idle timeout set, the session goes on as it always has, however long it stood closed", async () => {
    signIn(lengthsOf({ length: 90 * 24 * 60 }));

    use();
    closeBrowser();

    wait(20 * DAY);
    openDashboard();

    expect(await loadIncidents()).toBe(200);
    expectStillSignedIn();
  });

  test("on the Community Edition too", async () => {
    uninstallEnterpriseModule();
    signIn(null);

    use();
    closeBrowser();

    wait(20 * DAY);
    openDashboard();

    expect(await loadIncidents()).toBe(200);
    expectStillSignedIn();
  });
});

describe("a tab left open", () => {
  test("on a computer that slept past the idle timeout: the first move on waking, and the renewal after it, end the session", async () => {
    signIn(lengthsOf({ idle: 60 }));

    wait(MINUTE);
    use();

    // Asleep for three hours: no events, no timers - the clock moves on.
    wait(3 * HOUR);
    use();

    expect(await loadIncidents()).toBe(401);
    expect(identity.endedFor).toBe(SessionEndReason.Inactive);
    expectSignedOutFor("inactive");
  });

  test("a long pause that ended a while before the renewal still ended the session", async () => {
    signIn(lengthsOf({ idle: 30 }));

    use();
    const leftAtMs: number = nowInMs;

    // Away 40 minutes, then back, reading the page for 5 minutes without a request.
    wait(40 * MINUTE);
    use();
    wait(5 * MINUTE);
    use();

    expect(await loadIncidents()).toBe(401);
    expect(renewalBodies()[0]).toEqual({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 0,
      [LONGEST_INACTIVITY_FIELD]: {
        forSeconds: 40 * 60,
        endedSecondsAgo: 5 * 60,
      },
    });
    expect(identity.endedLastActiveAt).toEqual(new Date(leftAtMs));
  });

  test("brought back after two hours hidden while its person worked in another tab: still signed in", async () => {
    signIn(lengthsOf({ idle: 30 }));

    use();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return "hidden";
      },
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // The other tab writes its person's activity down as they work, every 15 seconds.
    for (let atMs: number = 0; atMs <= 2 * HOUR; atMs += 15 * SECOND) {
      localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(nowInMs + atMs));
    }

    wait(2 * HOUR + 5 * SECOND);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): string => {
        return "visible";
      },
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await loadIncidents()).toBe(200);
    expect(renewalBodies()).toEqual([{ [INACTIVE_FOR_IN_SECONDS_FIELD]: 0 }]);
    expectStillSignedIn();
  });

  test("someone working steadily is never signed out, even under the shortest idle timeout", async () => {
    signIn(lengthsOf({ idle: 15 }));

    // Three hours of work: a move every minute, the page's lists read every five.
    for (let minute: number = 1; minute <= 3 * 60; minute++) {
      wait(MINUTE);
      use();

      if (minute % 5 === 0) {
        expect(await loadIncidents()).toBe(200);
      }
    }

    // Its access token ran out a dozen times, and every renewal went through.
    expect(identity.renewals).toBeGreaterThanOrEqual(12);
    expectStillSignedIn();
  });

  test("pauses each shorter than the idle timeout, one renewal apart, never add up", async () => {
    signIn(lengthsOf({ idle: 30 }));

    for (let pause: number = 0; pause < 4; pause++) {
      wait(25 * MINUTE);
      use();
      expect(await loadIncidents()).toBe(200);
    }

    expect(identity.renewals).toBe(4);
    expectStillSignedIn();
  });
});

describe("a session length beside the idle timeout", () => {
  test("the length ran out before the idle timeout did: ended for the length", async () => {
    signIn(lengthsOf({ length: 8 * 60, idle: 60 }));

    // Working the whole day, a move every minute and a list every ten.
    for (let minute: number = 1; minute <= 7 * 60 + 30; minute++) {
      wait(MINUTE);
      use();

      if (minute % 10 === 0) {
        expect(await loadIncidents()).toBe(200);
      }
    }

    closeBrowser();
    wait(3 * HOUR);
    openDashboard();

    expect(await loadIncidents()).toBe(401);
    expect(identity.endedFor).toBe(SessionEndReason.LengthReached);
    expectSignedOutFor("length-reached");
  });

  test("the idle timeout ran out first: ended for the inactivity", async () => {
    signIn(lengthsOf({ length: 8 * 60, idle: 60 }));

    // Two hours of work, then the browser closed for three.
    for (let minute: number = 1; minute <= 2 * 60; minute++) {
      wait(MINUTE);
      use();

      if (minute % 10 === 0) {
        expect(await loadIncidents()).toBe(200);
      }
    }

    const leftAtMs: number = nowInMs;
    closeBrowser();

    wait(3 * HOUR);
    openDashboard();

    expect(await loadIncidents()).toBe(401);
    expect(identity.endedFor).toBe(SessionEndReason.Inactive);
    expect(identity.endedLastActiveAt).toEqual(new Date(leftAtMs));
    expectSignedOutFor("inactive");
  });
});
