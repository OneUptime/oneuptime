// Must stay the first import: the client's URLs are built from HOST on load.
import "./DashboardHost";
import FakeAxiosServer, {
  FakeReply,
  FakeTransport,
  RENEWED_SESSION,
  SentRequest,
} from "./FakeAxiosServer";
import BaseAPI from "../../../../UI/Utils/API/API";
import { IDENTITY_URL } from "../../../../UI/Config";
import LocalStorage from "../../../../UI/Utils/LocalStorage";
import Navigation from "../../../../UI/Utils/Navigation";
import SessionEndReturn from "../../../../UI/Utils/SessionEndReturn";
import User from "../../../../UI/Utils/User";
import UserActivity, {
  ACTIVITY_REPORT_INTERVAL_IN_MS,
  ACTIVITY_WRITE_INTERVAL_IN_MS,
  LAST_ACTIVITY_STORAGE_KEY,
  MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS,
  REPORTED_ACTIVITY_STORAGE_KEY,
} from "../../../../UI/Utils/UserActivity";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import { SESSION_ENDED_MESSAGES } from "../../../../Types/Exception/SessionEndedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Sleep from "../../../../Types/Sleep";
import {
  ACTIVITY_REPORTED_WITHIN_IN_MINUTES,
  IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES,
  INACTIVE_FOR_IN_SECONDS_FIELD,
  LONGEST_INACTIVITY_FIELD,
  REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
  SessionEndReason,
} from "../../../../Types/UserSession/SessionLength";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * THE SERVER HEARS OF ACTIVITY WHILE THE PERSON USES ONEUPTIME (issue #8188).
 *
 * The server records an idle timeout within minutes of it running out once
 * no browser can still be using the session: one whose browser said it
 * renews while its person uses OneUptime, and of which nothing has been
 * heard for the idle timeout and a margin (UserSessionService.
 * endSessionsThatRanOut). That is safe only if a tab in use really is
 * heard of. A tab renewed only when it had to - a request after its access
 * token ran out, or its live updates' notice - so a page that asks nothing
 * (a long note typed, an Admin Dashboard page without live updates) went
 * unheard of for as long as it was used.
 *
 * So the Dashboard and the Admin Dashboard install UserActivity with
 * reportActivity, which asks for a renewal while their person uses the
 * page, once the activity the server last heard of is
 * ACTIVITY_REPORT_INTERVAL_IN_MS old, and every renewal says that they do.
 * Everything runs through the real client, down to where axios would open
 * a socket (FakeAxiosServer).
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

const USER_ID: string = "9e9e9e9e-9e9e-49e9-89e9-9e9e9e9e9e9e";

const PAGE: string = "/dashboard/8d8d8d8d-8d8d-48d8-88d8-8d8d8d8d8d8d/home";

const START_MS: number = 1_800_000_000_000;

const MINUTE_IN_MS: number = 60 * 1000;

let nowInMs: number = START_MS;

let server: FakeAxiosServer;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

let isLoggedIn: boolean = true;

// The reports asked for, each the renewal it started.
let reports: Array<Promise<boolean>> = [];

// A client whose session is a status page's: not a sign-in to OneUptime.
class StatusPageClient extends BaseAPI {
  protected static override getSessionName(): string {
    return "status-page:7f7f7f7f-7f7f-47f7-87f7-7f7f7f7f7f7f";
  }
}

const refreshRequests: () => Array<SentRequest> = (): Array<SentRequest> => {
  return server.requestsTo(HTTPMethod.POST, REFRESH_URL);
};

// The page installs as the Dashboard and the Admin Dashboard do (Index.tsx).
const installAsTheDashboardDoes: (client?: typeof BaseAPI) => void = (
  client: typeof BaseAPI = BaseAPI,
): void => {
  UserActivity.install({
    reportActivity: (): void => {
      reports.push(client.reportActivityWhileInUse());
    },
  });
};

// Every renewal asked for so far has been answered.
const settled: () => Promise<void> = async (): Promise<void> => {
  while (reports.length > 0) {
    const pending: Array<Promise<boolean>> = reports;
    reports = [];
    await Promise.all(pending);
  }
};

// The person presses a key `ms` from now.
const pressAKeyIn: (ms: number) => void = (ms: number): void => {
  nowInMs += ms;
  window.dispatchEvent(new Event("keydown"));
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", PAGE);
  SessionEndReturn.clear();
  UserActivity.resetForTests();
  BaseAPI.resetSessionEndForTests();
  reports = [];
  isLoggedIn = true;

  server = new FakeAxiosServer(mockedAxios);

  nowInMs = START_MS;

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowInMs;
  });
  jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
    nowInMs += ms;
  });
  jest.spyOn(Math, "random").mockReturnValue(0.5);

  jest.spyOn(User, "isLoggedIn").mockImplementation((): boolean => {
    return isLoggedIn;
  });
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  jest.spyOn(User, "logout").mockResolvedValue(undefined);
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  jest.spyOn(Navigation, "getCurrentRoute").mockReturnValue(new Route(PAGE));
});

afterEach(async () => {
  await settled();
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  UserActivity.resetForTests();
  BaseAPI.resetSessionEndForTests();
  SessionEndReturn.clear();
  localStorage.clear();
});

describe("the contract with the server", () => {
  test("a tab reports within the interval the server counts on, and the server's margin outlasts it several times over", () => {
    expect(ACTIVITY_REPORT_INTERVAL_IN_MS).toBe(
      ACTIVITY_REPORTED_WITHIN_IN_MINUTES * MINUTE_IN_MS,
    );
    expect(ACTIVITY_REPORTED_WITHIN_IN_MINUTES).toBe(5);
    expect(IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES).toBe(30);

    /*
     * The margin covers the interval, a report that failed and was asked
     * for again every minute for a long while, and clocks a little apart.
     */
    expect(
      IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES * MINUTE_IN_MS,
    ).toBeGreaterThanOrEqual(
      5 * ACTIVITY_REPORT_INTERVAL_IN_MS +
        MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS,
    );
    // Activity is written for every tab far more often than it is reported.
    expect(ACTIVITY_WRITE_INTERVAL_IN_MS).toBeLessThan(
      MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS,
    );
  });
});

describe("a page installed without reportActivity", () => {
  test("asks for nothing and says nothing of renewing while in use: as it always did", async () => {
    UserActivity.install();
    pressAKeyIn(ACTIVITY_REPORT_INTERVAL_IN_MS * 2);

    expect(UserActivity.isReportingActivityWhileInUse()).toBe(false);
    expect(refreshRequests()).toHaveLength(0);

    server.on(HTTPMethod.POST, REFRESH_URL, [RENEWED_SESSION]);
    await BaseAPI.refreshSession();

    expect(refreshRequests()[0]!.data).toEqual({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 0,
    });
  });
});

describe("the Dashboard and the Admin Dashboard", () => {
  test("say with every renewal that they renew while in use", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [RENEWED_SESSION]);

    installAsTheDashboardDoes();
    await settled();

    expect(UserActivity.isReportingActivityWhileInUse()).toBe(true);
    expect(refreshRequests()).toHaveLength(1);
    expect(refreshRequests()[0]!.data).toEqual({
      [INACTIVE_FOR_IN_SECONDS_FIELD]: 0,
      [REPORTS_ACTIVITY_WHILE_IN_USE_FIELD]: true,
    });
  });

  test("a new sign-in says so from its first page: nothing was reported from this browser yet", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [RENEWED_SESSION]);

    expect(UserActivity.getReportedActivityAtMs()).toBeNull();

    installAsTheDashboardDoes();
    await settled();

    expect(refreshRequests()).toHaveLength(1);
    // The activity it told the server of, kept for every tab.
    expect(localStorage.getItem(REPORTED_ACTIVITY_STORAGE_KEY)).toBe(
      String(START_MS),
    );
  });

  test("a page opened while another tab reported a moment ago asks for nothing", async () => {
    localStorage.setItem(
      REPORTED_ACTIVITY_STORAGE_KEY,
      String(START_MS - MINUTE_IN_MS),
    );

    installAsTheDashboardDoes();
    await settled();

    expect(refreshRequests()).toHaveLength(0);
  });

  test("someone typing a long note on a page that asks the server nothing is heard of every few minutes, never more than the interval apart", async () => {
    server.on(
      HTTPMethod.POST,
      REFRESH_URL,
      Array.from({ length: 20 }, () => {
        return RENEWED_SESSION;
      }),
    );

    installAsTheDashboardDoes();
    await settled();

    // An hour of typing: a key every ten seconds.
    let longestUnheardMs: number = 0;

    for (let second: number = 10; second <= 60 * 60; second += 10) {
      pressAKeyIn(10 * 1000);
      await settled();

      const reportedAtMs: number = UserActivity.getReportedActivityAtMs()!;
      longestUnheardMs = Math.max(longestUnheardMs, nowInMs - reportedAtMs);
    }

    // The server always knew of activity less than the interval and one write old.
    expect(longestUnheardMs).toBeLessThan(
      ACTIVITY_REPORT_INTERVAL_IN_MS + ACTIVITY_WRITE_INTERVAL_IN_MS,
    );
    // About one renewal every five minutes: twelve in the hour, and the first.
    expect(refreshRequests().length).toBeGreaterThanOrEqual(12);
    expect(refreshRequests().length).toBeLessThanOrEqual(14);

    for (const request of refreshRequests()) {
      expect(
        (request.data as JSONObject)[REPORTS_ACTIVITY_WHILE_IN_USE_FIELD],
      ).toBe(true);
      // Each says the person was here a moment ago.
      expect(
        (request.data as JSONObject)[INACTIVE_FOR_IN_SECONDS_FIELD],
      ).toBeLessThanOrEqual(ACTIVITY_WRITE_INTERVAL_IN_MS / 1000);
    }
  });

  test("just before the interval nothing is asked; at it, a renewal", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [RENEWED_SESSION]);
    UserActivity.noteActivityReported(START_MS);

    installAsTheDashboardDoes();
    await settled();
    expect(refreshRequests()).toHaveLength(0);

    pressAKeyIn(ACTIVITY_REPORT_INTERVAL_IN_MS - 1);
    await settled();
    expect(refreshRequests()).toHaveLength(0);

    pressAKeyIn(ACTIVITY_WRITE_INTERVAL_IN_MS);
    await settled();
    expect(refreshRequests()).toHaveLength(1);
  });

  test("a tab nobody uses asks for nothing, however long it stays open", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [RENEWED_SESSION]);

    installAsTheDashboardDoes();
    await settled();
    expect(refreshRequests()).toHaveLength(1);

    nowInMs += 8 * 60 * MINUTE_IN_MS;
    await settled();

    expect(refreshRequests()).toHaveLength(1);
  });

  test("recent activity in another tab: this tab's renewal tells the server of it, and its report counts for every tab", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [RENEWED_SESSION, RENEWED_SESSION]);

    installAsTheDashboardDoes();
    await settled();

    // Ten minutes on, the person types in another tab, which reports it.
    nowInMs += 10 * MINUTE_IN_MS;
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(nowInMs));
    localStorage.setItem(REPORTED_ACTIVITY_STORAGE_KEY, String(nowInMs));

    // Back here a minute later: the other tab's report is a minute old.
    pressAKeyIn(MINUTE_IN_MS);
    await settled();
    expect(refreshRequests()).toHaveLength(1);

    // Another tab's activity, unreported, is what this tab's next renewal says.
    nowInMs += ACTIVITY_REPORT_INTERVAL_IN_MS;
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(nowInMs - 2000));
    pressAKeyIn(1000);
    await settled();

    expect(refreshRequests()).toHaveLength(2);
    expect(
      (refreshRequests()[1]!.data as JSONObject)[INACTIVE_FOR_IN_SECONDS_FIELD],
    ).toBe(0);
  });

  test("a renewal that got no answer is asked for again a minute later, not at every key press", async () => {
    server.on(HTTPMethod.POST, REFRESH_URL, [
      { networkErrorCode: "ECONNREFUSED" },
      { networkErrorCode: "ECONNREFUSED" },
      { networkErrorCode: "ECONNREFUSED" },
      RENEWED_SESSION,
    ]);

    installAsTheDashboardDoes();
    await settled();

    // One renewal, retried twice by the client itself.
    expect(refreshRequests()).toHaveLength(3);
    expect(UserActivity.getReportedActivityAtMs()).toBeNull();

    for (let press: number = 0; press < 3; press++) {
      pressAKeyIn(ACTIVITY_WRITE_INTERVAL_IN_MS);
      await settled();
    }

    // Under a minute since it asked: nothing more.
    expect(refreshRequests()).toHaveLength(3);

    pressAKeyIn(MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS);
    await settled();

    expect(refreshRequests()).toHaveLength(4);
    expect(UserActivity.getReportedActivityAtMs()).not.toBeNull();
  });

  /*
   * A 200 that is not the server's answer to a renewal - a proxy, a captive
   * portal, an error page (issue #8838) - reported nothing: the server
   * never heard of the person. It is asked again a minute later, as one
   * that got no answer, and nothing is noted as reported meanwhile.
   */
  test.each<[string, FakeReply]>([
    ["no body", { status: 200 }],
    ["an empty object", { status: 200, data: {} }],
    ["{ data: [] }", { status: 200, data: { data: [] } }],
    [
      "no refresh token",
      { status: 200, data: { accessToken: "renewed-access-token" } },
    ],
  ])(
    "a renewal answered 200 with %s reported nothing: asked again a minute later, noted only once one goes through",
    async (_label: string, answer: FakeReply) => {
      server.on(HTTPMethod.POST, REFRESH_URL, [answer, RENEWED_SESSION]);

      installAsTheDashboardDoes();
      await settled();

      // One renewal, not retried by the client: a 200 is no error to retry.
      expect(refreshRequests()).toHaveLength(1);
      expect(UserActivity.getReportedActivityAtMs()).toBeNull();
      expect(localStorage.getItem("session-refreshed-at:dashboard")).toBeNull();

      pressAKeyIn(ACTIVITY_WRITE_INTERVAL_IN_MS);
      await settled();

      expect(refreshRequests()).toHaveLength(1);

      pressAKeyIn(MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS);
      await settled();

      expect(refreshRequests()).toHaveLength(2);
      expect(UserActivity.getReportedActivityAtMs()).not.toBeNull();
    },
  );

  test("a renewal the server refuses - the idle timeout ran out while the computer slept - sends the person to sign in, saying why", async () => {
    // The last activity before the computer slept, two hours ago.
    localStorage.setItem(
      LAST_ACTIVITY_STORAGE_KEY,
      String(START_MS - 2 * 60 * MINUTE_IN_MS),
    );
    server.on(HTTPMethod.POST, REFRESH_URL, [
      {
        status: 401,
        data: { message: SESSION_ENDED_MESSAGES[SessionEndReason.Inactive] },
      },
    ]);

    installAsTheDashboardDoes();
    await settled();

    expect(refreshRequests()).toHaveLength(1);
    expect(
      (refreshRequests()[0]!.data as JSONObject)[LONGEST_INACTIVITY_FIELD],
    ).toEqual({ forSeconds: 2 * 60 * 60, endedSecondsAgo: 0 });

    const routes: Array<string> = navigateSpy.mock.calls.map(
      (call: Parameters<typeof Navigation.navigate>): string => {
        return call[0].toString();
      },
    );

    expect(routes).toEqual(["/accounts/login?sessionEnded=inactive"]);
  });

  test("asks nothing while nobody is signed in", async () => {
    isLoggedIn = false;

    installAsTheDashboardDoes();
    pressAKeyIn(ACTIVITY_REPORT_INTERVAL_IN_MS * 2);
    await settled();

    expect(refreshRequests()).toHaveLength(0);
  });

  test("a status page's session is no sign-in to OneUptime: it asks nothing", async () => {
    installAsTheDashboardDoes(StatusPageClient);
    await settled();

    expect(refreshRequests()).toHaveLength(0);
  });
});

describe("when a report is due", () => {
  test("none reported yet, or the newest the interval old: due; a moment less: not", () => {
    expect(UserActivity.isActivityReportDue(START_MS)).toBe(true);

    UserActivity.noteActivityReported(START_MS);

    expect(
      UserActivity.isActivityReportDue(
        START_MS + ACTIVITY_REPORT_INTERVAL_IN_MS - 1,
      ),
    ).toBe(false);
    expect(
      UserActivity.isActivityReportDue(
        START_MS + ACTIVITY_REPORT_INTERVAL_IN_MS,
      ),
    ).toBe(true);
  });

  test("a clock that moved back is due: only a new report sets it right", () => {
    UserActivity.noteActivityReported(START_MS);

    expect(UserActivity.isActivityReportDue(START_MS - MINUTE_IN_MS)).toBe(
      true,
    );

    UserActivity.noteActivityReported(START_MS - MINUTE_IN_MS);

    expect(UserActivity.isActivityReportDue(START_MS - MINUTE_IN_MS)).toBe(
      false,
    );
  });

  test("what storage holds that is no time is no report", () => {
    localStorage.setItem(REPORTED_ACTIVITY_STORAGE_KEY, "soon");

    expect(UserActivity.getReportedActivityAtMs()).toBeNull();

    UserActivity.noteActivityReported(Number.NaN);
    UserActivity.noteActivityReported(-5);

    expect(UserActivity.getReportedActivityAtMs()).toBeNull();
  });

  test("storage refused: this tab keeps what it reported itself", () => {
    jest.spyOn(LocalStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    jest.spyOn(LocalStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    UserActivity.noteActivityReported(START_MS);

    expect(UserActivity.getReportedActivityAtMs()).toBe(START_MS);
    expect(UserActivity.isActivityReportDue(START_MS + MINUTE_IN_MS)).toBe(
      false,
    );
  });

  test("a reporter that throws never fails the page's own event, and is asked again after the pause", () => {
    let asked: number = 0;

    UserActivity.install({
      reportActivity: (): void => {
        asked++;
        throw new Error("no network");
      },
    });

    expect(asked).toBe(1);

    expect(() => {
      pressAKeyIn(MIN_TIME_BETWEEN_ACTIVITY_REPORTS_IN_MS);
    }).not.toThrow();
    expect(asked).toBe(2);
  });

  test("resetForTests forgets the reporter and what was reported", () => {
    installAsTheDashboardDoes();
    UserActivity.noteActivityReported(START_MS);

    UserActivity.resetForTests();
    localStorage.clear();

    expect(UserActivity.isReportingActivityWhileInUse()).toBe(false);
    expect(UserActivity.getReportedActivityAtMs()).toBeNull();
  });
});
