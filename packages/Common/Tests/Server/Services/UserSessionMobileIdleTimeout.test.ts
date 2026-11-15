import UserSession from "../../../Models/DatabaseModels/UserSession";
import UserSessionService, {
  Service,
  SessionRenewalDecision,
} from "../../../Server/Services/UserSessionService";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  ReportedInactivity,
  SessionEndReason,
  SessionLengths,
} from "../../../Types/UserSession/SessionLength";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * THE MOBILE APP'S RENEWALS UNDER THE IDLE TIMEOUT (issue #8187), AS THE
 * SERVER DECIDES THEM.
 *
 * Under the 15-minute idle timeout the mobile app was signed out at every
 * renewal, however much it was used. It said nothing of its person's use,
 * so each renewal was decided from the renewal before it - and the access
 * token that renewal signed runs out exactly at its idle end
 * (getAccessTokenExpiresInSeconds), so an app that renews once its token
 * has run out always came back at or past it.
 *
 * The app now says, with each renewal, what the Dashboard says
 * (MobileApp/src/auth/userActivity.ts): how long since its person last
 * touched it (inactiveForInSeconds), and the longest time they went without
 * since the last renewal (longestInactivity) - the app in the background,
 * or closed and opened again. It also renews a little before its token runs
 * out while it is in use. Nothing changed here: the server decides the
 * app's report exactly as it decides the browser's (decideSessionRenewal),
 * and an app that says nothing - one from before - is decided as it always
 * was. These tests hold the server to that for every way the app is used,
 * at the boundaries: a session renewed through the real
 * UserSessionService.decideRenewal, its row moved on as
 * renewSessionWithNewRefreshToken moves it, and its access token living as
 * the real one does.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

const T0: number = Date.parse("2026-11-15T09:00:00.000Z");

const lengthsOf: (rule: {
  length?: number;
  idle?: number;
}) => SessionLengths = (rule: {
  length?: number;
  idle?: number;
}): SessionLengths => {
  const standard: SessionLengths["standard"] = {
    lengthInMinutes: rule.length ?? null,
    idleTimeoutInMinutes: rule.idle ?? null,
  };

  return { standard, sso: { ...standard } };
};

let nowMs: number = T0;

let fake: FakeEnterpriseModule;

// What the app's renewal says (both fields absent: an app that says nothing).
interface AppReport {
  inactiveForInSeconds?: number;
  longestInactivity?: ReportedInactivity;
}

/*
 * One sign-in on the app, as the server holds it: its row, and when the
 * access token it last signed runs out.
 */
class AppSession {
  public readonly row: UserSession;

  public accessTokenExpiresAtMs: number;

  public constructor() {
    this.row = new UserSession();
    this.row.id = new ObjectID("6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a");
    this.row.userId = new ObjectID("7b7b7b7b-7b7b-47b7-87b7-7b7b7b7b7b7b");
    this.row.createdAt = new Date(nowMs);
    this.row.lastActiveAt = new Date(nowMs);
    this.row.additionalInfo = { isGlobalLogin: true };
    this.accessTokenExpiresAtMs = nowMs + this.accessTokenLifetimeMs();
  }

  // POST /identity/refresh-token from the app at `atMs`, saying `report`.
  public async renew(
    atMs: number,
    report: AppReport,
  ): Promise<SessionRenewalDecision> {
    nowMs = atMs;

    const decision: SessionRenewalDecision =
      await UserSessionService.decideRenewal({
        session: this.row,
        reportedInactivityInSeconds: report.inactiveForInSeconds ?? null,
        reportedLongestInactivity: report.longestInactivity ?? null,
      });

    if (!decision.hasEnded) {
      // As renewSessionWithNewRefreshToken: the row keeps what the renewal decided.
      this.row.lastActiveAt = decision.lastActiveAt;
      this.accessTokenExpiresAtMs = nowMs + this.accessTokenLifetimeMs();
    }

    return decision;
  }

  private accessTokenLifetimeMs(): number {
    return (
      Service.getAccessTokenExpiresInSeconds({
        facts: Service.getSessionFacts(this.row, new Date(nowMs)),
        lengths: fake.userSessionLengths,
        now: new Date(nowMs),
      }) * SECOND
    );
  }
}

// The app was away for `ms` and came back `endedAgoMs` before the renewal.
const away: (ms: number, endedAgoMs?: number) => ReportedInactivity = (
  ms: number,
  endedAgoMs: number = 0,
): ReportedInactivity => {
  return { forSeconds: ms / SECOND, endedSecondsAgo: endedAgoMs / SECOND };
};

const ended: (lastActiveAtMs: number) => SessionRenewalDecision = (
  lastActiveAtMs: number,
): SessionRenewalDecision => {
  return {
    hasEnded: true,
    reason: SessionEndReason.Inactive,
    lastActiveAt: new Date(lastActiveAtMs),
  };
};

beforeEach(() => {
  nowMs = T0;
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(nowMs);
  });
  fake = installFakeEnterpriseModule({
    userSessionLengths: lengthsOf({ idle: 15 }),
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("the app in use, under the 15-minute idle timeout", () => {
  test("the access token a renewal signs runs out exactly at the idle end of that renewal", () => {
    const session: AppSession = new AppSession();

    expect(session.accessTokenExpiresAtMs).toBe(T0 + 15 * MINUTE);
  });

  test("#8187: a renewal ten seconds after the token ran out, saying the app was used ten seconds ago, is renewed - and its token runs to that use plus the idle timeout", async () => {
    const session: AppSession = new AppSession();
    const at: number = session.accessTokenExpiresAtMs + 10 * SECOND;

    expect(await session.renew(at, { inactiveForInSeconds: 10 })).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(at - 10 * SECOND),
      lengths: lengthsOf({ idle: 15 }),
    });
    expect(session.accessTokenExpiresAtMs).toBe(at - 10 * SECOND + 15 * MINUTE);
  });

  test("the same renewal saying nothing - the app before this change - is ended, as it always was", async () => {
    const session: AppSession = new AppSession();
    const at: number = session.accessTokenExpiresAtMs + 10 * SECOND;

    expect(await session.renew(at, {})).toEqual(ended(T0));
  });

  test("renewed each time its token runs out, for three hours: never ended", async () => {
    const session: AppSession = new AppSession();

    while (nowMs < T0 + 3 * HOUR) {
      const at: number = session.accessTokenExpiresAtMs + 10 * SECOND;
      const decision: SessionRenewalDecision = await session.renew(at, {
        inactiveForInSeconds: 3,
      });

      expect(decision.hasEnded).toBe(false);
    }
  });

  test("renewed a little before its token runs out, at each use: never ended, and the row keeps up with the person", async () => {
    const session: AppSession = new AppSession();

    while (nowMs < T0 + 3 * HOUR) {
      const at: number = session.accessTokenExpiresAtMs - MINUTE;
      const decision: SessionRenewalDecision = await session.renew(at, {
        inactiveForInSeconds: 0,
      });

      expect(decision).toEqual({
        hasEnded: false,
        lastActiveAt: new Date(at),
        lengths: lengthsOf({ idle: 15 }),
      });
      expect(session.accessTokenExpiresAtMs).toBe(at + 15 * MINUTE);
    }
  });

  test("renewed ahead with the person gone a while: the token lives only to their idle end, and the renewal after it ends the session", async () => {
    const session: AppSession = new AppSession();
    const aheadAt: number = session.accessTokenExpiresAtMs - MINUTE;

    expect(
      await session.renew(aheadAt, { inactiveForInSeconds: 14 * 60 }),
    ).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(aheadAt - 14 * MINUTE),
      lengths: lengthsOf({ idle: 15 }),
    });
    expect(session.accessTokenExpiresAtMs).toBe(aheadAt + MINUTE);

    const nextAt: number = session.accessTokenExpiresAtMs + 30 * SECOND;

    expect(
      await session.renew(nextAt, {
        inactiveForInSeconds: (nextAt - (aheadAt - 14 * MINUTE)) / SECOND,
      }),
    ).toEqual(ended(aheadAt - 14 * MINUTE));
  });
});

describe("the app in the background, then back on the screen", () => {
  test.each([
    [
      "a second short of the idle timeout (too short for the app to keep): renewed",
      15 * MINUTE - SECOND,
      { inactiveForInSeconds: 0 },
      false,
    ],
    [
      "a second short of the idle timeout, said as a time away: renewed",
      15 * MINUTE - SECOND,
      {
        inactiveForInSeconds: 0,
        longestInactivity: away(15 * MINUTE - SECOND),
      },
      false,
    ],
    [
      "the idle timeout exactly: ended",
      15 * MINUTE,
      { inactiveForInSeconds: 0, longestInactivity: away(15 * MINUTE) },
      true,
    ],
    [
      "a second past it: ended",
      15 * MINUTE + SECOND,
      {
        inactiveForInSeconds: 0,
        longestInactivity: away(15 * MINUTE + SECOND),
      },
      true,
    ],
  ])(
    "%s",
    async (
      _label: string,
      awayMs: number,
      report: AppReport,
      hasEnded: boolean,
    ) => {
      const session: AppSession = new AppSession();
      // Used for two minutes, then put away.
      const leftAt: number = T0 + 2 * MINUTE;
      const backAt: number = leftAt + awayMs;

      const decision: SessionRenewalDecision = await session.renew(
        backAt,
        report,
      );

      if (hasEnded) {
        // Recorded as last active when the app was put away.
        expect(decision).toEqual(ended(leftAt));
      } else {
        expect(decision.hasEnded).toBe(false);
        expect(decision.lastActiveAt).toEqual(new Date(backAt));
      }
    },
  );

  test("renewed ahead, used a minute more, then away fourteen minutes: renewed - fifteen minutes since that renewal, but fourteen since the last use", async () => {
    const session: AppSession = new AppSession();
    // Renewed ahead at minute 13, used until minute 14, put away until minute 28.
    await session.renew(T0 + 13 * MINUTE, { inactiveForInSeconds: 0 });

    expect(
      await session.renew(T0 + 28 * MINUTE, {
        inactiveForInSeconds: 0,
        longestInactivity: away(14 * MINUTE),
      }),
    ).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(T0 + 28 * MINUTE),
      lengths: lengthsOf({ idle: 15 }),
    });
  });

  test("a time away that ended before the last renewal - one the app already reported - ends nothing", async () => {
    const session: AppSession = new AppSession();
    await session.renew(T0 + 50 * MINUTE, {
      inactiveForInSeconds: 0,
      longestInactivity: away(10 * MINUTE),
    });

    expect(
      (
        await session.renew(T0 + 55 * MINUTE, {
          inactiveForInSeconds: 0,
          longestInactivity: away(HOUR, 10 * MINUTE),
        })
      ).hasEnded,
    ).toBe(false);
  });
});

describe("the app ended by the system and opened again", () => {
  test.each([
    [
      "a second short of the idle timeout: renewed",
      15 * MINUTE - SECOND,
      false,
    ],
    ["the idle timeout exactly: ended", 15 * MINUTE, true],
    ["an hour later: ended", HOUR, true],
  ])(
    "opened again %s",
    async (_label: string, awayMs: number, hasEnded: boolean) => {
      const session: AppSession = new AppSession();
      const leftAt: number = T0 + 5 * MINUTE;
      const openedAt: number = leftAt + awayMs;
      // Its first request, five seconds after it opened, renews the session.
      const renewedAt: number = openedAt + 5 * SECOND;

      const report: AppReport =
        awayMs >= 15 * MINUTE
          ? {
              inactiveForInSeconds: 5,
              longestInactivity: away(awayMs, 5 * SECOND),
            }
          : { inactiveForInSeconds: 5 };

      const decision: SessionRenewalDecision = await session.renew(
        renewedAt,
        report,
      );

      if (hasEnded) {
        expect(decision).toEqual(ended(leftAt));
      } else {
        expect(decision.hasEnded).toBe(false);
        expect(decision.lastActiveAt).toEqual(new Date(openedAt));
      }
    },
  );

  test("opened again past the idle timeout and used a while before the renewal: ended all the same", async () => {
    const session: AppSession = new AppSession();
    const leftAt: number = T0 + 5 * MINUTE;

    expect(
      await session.renew(leftAt + 40 * MINUTE, {
        inactiveForInSeconds: 0,
        longestInactivity: away(30 * MINUTE, 10 * MINUTE),
      }),
    ).toEqual(ended(leftAt));
  });

  test.each([
    ["ten minutes after: renewed", 10 * MINUTE, { inactiveForInSeconds: 0 }],
    [
      "twenty minutes after: ended",
      20 * MINUTE,
      { inactiveForInSeconds: 0, longestInactivity: away(20 * MINUTE) },
    ],
  ])(
    "the first launch of an app updated to this one counts from the session's last renewal, as its access token says it - %s",
    async (_label: string, afterMs: number, report: AppReport) => {
      // Renewed at T0 by the earlier app, which said nothing.
      const session: AppSession = new AppSession();

      const decision: SessionRenewalDecision = await session.renew(
        T0 + afterMs,
        report,
      );

      if (afterMs >= 15 * MINUTE) {
        expect(decision).toEqual(ended(T0));
      } else {
        expect(decision.hasEnded).toBe(false);
      }
    },
  );
});

describe("the app left on the screen, untouched", () => {
  test("a second short of the idle timeout since the last touch: renewed, and its token lives only to the idle end", async () => {
    const session: AppSession = new AppSession();
    const at: number = T0 + 15 * MINUTE - SECOND;

    expect(
      await session.renew(at, { inactiveForInSeconds: 15 * 60 - 1 }),
    ).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(T0),
      lengths: lengthsOf({ idle: 15 }),
    });
    expect(session.accessTokenExpiresAtMs).toBe(T0 + 15 * MINUTE);
  });

  test("its lists reloading after the token ran out, nobody touching it: ended, as last active at its last touch", async () => {
    const session: AppSession = new AppSession();
    const at: number = session.accessTokenExpiresAtMs + 30 * SECOND;

    expect(
      await session.renew(at, { inactiveForInSeconds: (at - T0) / SECOND }),
    ).toEqual(ended(T0));
  });

  test("an app that knows of no activity at all says all there is: counted from what the session knew, its last activity not moved", async () => {
    const session: AppSession = new AppSession();

    expect(
      await session.renew(T0 + 10 * MINUTE, {
        inactiveForInSeconds: 30 * 24 * 60 * 60 * 2,
      }),
    ).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(T0),
      lengths: lengthsOf({ idle: 15 }),
    });
  });
});

describe("other lengths, as they were", () => {
  test("a 30-minute idle timeout: twenty minutes in the background is fine, thirty-one is not", async () => {
    fake.userSessionLengths = lengthsOf({ idle: 30 });
    const session: AppSession = new AppSession();

    expect(
      (
        await session.renew(T0 + 20 * MINUTE, {
          inactiveForInSeconds: 0,
          longestInactivity: away(20 * MINUTE),
        })
      ).hasEnded,
    ).toBe(false);

    expect(
      await session.renew(T0 + 51 * MINUTE, {
        inactiveForInSeconds: 0,
        longestInactivity: away(31 * MINUTE),
      }),
    ).toEqual(ended(T0 + 20 * MINUTE));
  });

  test("a 30-minute idle timeout: an app in use renews before the idle end even saying nothing - its token runs out first", async () => {
    fake.userSessionLengths = lengthsOf({ idle: 30 });
    const session: AppSession = new AppSession();

    expect(session.accessTokenExpiresAtMs).toBe(T0 + 15 * MINUTE);
    expect(
      (await session.renew(session.accessTokenExpiresAtMs + 10 * SECOND, {}))
        .hasEnded,
    ).toBe(false);
  });

  test("no idle timeout set: what the app says is not asked, and hours away end nothing", async () => {
    fake.userSessionLengths = lengthsOf({ length: 24 * 60 });
    const session: AppSession = new AppSession();

    expect(
      await session.renew(T0 + 9 * HOUR, {
        inactiveForInSeconds: 0,
        longestInactivity: away(9 * HOUR),
      }),
    ).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(T0 + 9 * HOUR),
      lengths: lengthsOf({ length: 24 * 60 }),
    });
  });

  test("a session length beside the idle timeout: the app in use is ended at the length, however recently it was used", async () => {
    fake.userSessionLengths = lengthsOf({ length: 60, idle: 15 });
    const session: AppSession = new AppSession();

    await session.renew(T0 + 50 * MINUTE, { inactiveForInSeconds: 0 });

    // The token runs to the length, not past it.
    expect(session.accessTokenExpiresAtMs).toBe(T0 + 60 * MINUTE);

    expect(
      await session.renew(T0 + 60 * MINUTE, { inactiveForInSeconds: 0 }),
    ).toEqual({
      hasEnded: true,
      reason: SessionEndReason.LengthReached,
      lastActiveAt: new Date(T0 + 60 * MINUTE),
    });
  });
});
