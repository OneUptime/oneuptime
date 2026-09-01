import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import EnterpriseLicenseSeatsUtil, {
  SeatUsage,
  SeatUsageInput,
} from "../../Utils/EnterpriseLicense/EnterpriseLicenseSeats";
import { describe, expect, it } from "@jest/globals";

/*
 * The arithmetic behind "you cannot add another user".
 *
 * An enterprise license is bought for a number of users and shared by every
 * instance the customer runs on that key. Until now nothing on the customer's
 * side acted on that number — the limit was mirrored into GlobalConfig, drawn
 * on a progress bar, and otherwise ignored, so a 50-seat license and a 5000-
 * seat license behaved identically.
 *
 * Deciding whether one more user fits is not a comparison, because neither
 * number this installation holds is the answer:
 *
 *   localUserCount      live, and blind to the customer's other instances.
 *   aggregatedUserCount deduplicated across every instance, and up to a day
 *                       old — so it does not know about the person being
 *                       invited right now, which is the only person the check
 *                       is about.
 *
 * These tests pin how those are combined, and — at least as importantly — pin
 * which way every "cannot tell" case is allowed to fall. Under-enforcing is
 * corrected by the next daily report. Over-enforcing locks a paying customer
 * out of their own installation, so no missing, malformed or contradictory
 * field is allowed to invent seats that are not there.
 */

type MakeInstanceFunction = (
  overrides?: Partial<EnterpriseLicenseInstanceSummary>,
) => EnterpriseLicenseInstanceSummary;

const makeInstance: MakeInstanceFunction = (
  overrides?: Partial<EnterpriseLicenseInstanceSummary>,
): EnterpriseLicenseInstanceSummary => {
  return {
    instanceId: "instance-1",
    host: "oneuptime.acme.internal",
    userCount: 10,
    lastReportedAt: "2026-01-01T00:00:00.000Z",
    version: "12.0.30",
    ...overrides,
  };
};

type SeatsFunction = (input: Partial<SeatUsageInput>) => SeatUsage;

const seats: SeatsFunction = (input: Partial<SeatUsageInput>): SeatUsage => {
  return EnterpriseLicenseSeatsUtil.getSeatUsage({
    localUserCount: 0,
    ...input,
  } as SeatUsageInput);
};

describe("EnterpriseLicenseSeatsUtil - is there a limit at all", () => {
  it("does not enforce when the license carries no seat limit", () => {
    const usage: SeatUsage = seats({ userLimit: null, localUserCount: 9999 });

    expect(usage.isEnforced).toBe(false);
    expect(usage.userLimit).toBeNull();
    expect(usage.seatsRemaining).toBeNull();
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  it("does not enforce when the seat limit was never set", () => {
    expect(seats({ localUserCount: 9999 }).isEnforced).toBe(false);
    expect(
      seats({ userLimit: undefined, localUserCount: 9999 }).isEnforced,
    ).toBe(false);
  });

  /*
   * Zero is read as "no limit", matching the license modal and the breach
   * notification job, both of which treat userLimit <= 0 as nothing to measure
   * against. Reading it as "nobody may have an account" would leave a stray
   * zero — a bad import, a half-filled form on oneuptime.com — unable to create
   * even the first user of an installation.
   */
  it("treats a zero seat limit as no limit rather than no seats", () => {
    const usage: SeatUsage = seats({ userLimit: 0, localUserCount: 0 });

    expect(usage.isEnforced).toBe(false);
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  it("ignores a negative seat limit", () => {
    expect(seats({ userLimit: -10, localUserCount: 5 }).isEnforced).toBe(false);
  });

  it.each([
    ["a fractional limit", 10.5],
    ["infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("ignores %s as a seat limit", (_label: string, userLimit: number) => {
    expect(seats({ userLimit: userLimit, localUserCount: 5 }).isEnforced).toBe(
      false,
    );
  });

  it("ignores a seat limit that is not a number at all", () => {
    expect(
      seats({
        userLimit: "150" as unknown as number,
        localUserCount: 5,
      }).isEnforced,
    ).toBe(false);
  });

  it("enforces the smallest real limit there is", () => {
    expect(seats({ userLimit: 1, localUserCount: 0 }).hasSeatForNewUser).toBe(
      true,
    );
    expect(seats({ userLimit: 1, localUserCount: 1 }).hasSeatForNewUser).toBe(
      false,
    );
  });
});

describe("EnterpriseLicenseSeatsUtil - a single instance", () => {
  it("has room while users are below the limit", () => {
    const usage: SeatUsage = seats({ userLimit: 10, localUserCount: 7 });

    expect(usage.isEnforced).toBe(true);
    expect(usage.seatsInUse).toBe(7);
    expect(usage.seatsRemaining).toBe(3);
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  /*
   * The boundary the whole feature turns on. A license bought for 10 users
   * covers the 10th; it is the 11th that has to be refused.
   */
  it("refuses the user that would step past the limit", () => {
    expect(seats({ userLimit: 10, localUserCount: 9 }).hasSeatForNewUser).toBe(
      true,
    );
    expect(seats({ userLimit: 10, localUserCount: 10 }).hasSeatForNewUser).toBe(
      false,
    );
  });

  it("reports no seats remaining rather than a negative number when over the limit", () => {
    const usage: SeatUsage = seats({ userLimit: 10, localUserCount: 25 });

    expect(usage.seatsInUse).toBe(25);
    expect(usage.seatsRemaining).toBe(0);
    expect(usage.hasSeatForNewUser).toBe(false);
  });

  it("still reports usage on an unlimited license, it just never blocks", () => {
    const usage: SeatUsage = seats({ userLimit: null, localUserCount: 25 });

    expect(usage.seatsInUse).toBe(25);
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  it.each([
    ["a negative count", -5],
    ["a fractional count", 4.5],
    ["NaN", Number.NaN],
  ])(
    "falls back to zero local users for %s",
    (_label: string, localUserCount: number) => {
      expect(
        seats({ userLimit: 10, localUserCount: localUserCount }).seatsInUse,
      ).toBe(0);
    },
  );
});

describe("EnterpriseLicenseSeatsUtil - the licence-wide count", () => {
  /*
   * The aggregate is the only number that knows about the customer's other
   * instances, so it has to be able to exhaust the limit on its own — even
   * though this installation has barely any users of its own.
   */
  it("blocks on the licence-wide count even when this instance is nearly empty", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 3,
      aggregatedUserCount: 100,
    });

    expect(usage.seatsInUse).toBe(100);
    expect(usage.hasSeatForNewUser).toBe(false);
  });

  /*
   * And the live local count has to be able to exhaust it on its own too: the
   * aggregate is up to a day old, so it is systematically behind on exactly
   * the users this check exists to catch.
   */
  it("blocks on the live local count even when the last report was lower", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 100,
      aggregatedUserCount: 12,
    });

    expect(usage.seatsInUse).toBe(100);
    expect(usage.hasSeatForNewUser).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a negative number", -1],
    ["a fraction", 12.5],
    ["a string", "12" as unknown as number],
  ])(
    "ignores a licence-wide count of %s and falls back to the local one",
    (_label: string, aggregatedUserCount: number | null | undefined) => {
      const usage: SeatUsage = seats({
        userLimit: 100,
        localUserCount: 40,
        aggregatedUserCount: aggregatedUserCount,
      });

      expect(usage.seatsInUse).toBe(40);
      expect(usage.hasSeatForNewUser).toBe(true);
    },
  );
});

describe("EnterpriseLicenseSeatsUtil - several instances on one licence", () => {
  /*
   * The case the whole instance breakdown exists for. Two instances share a
   * 100-seat license: this one has 60 users, the other 30, and 10 people have
   * accounts on both. oneuptime.com deduplicates that to 80.
   *
   * Neither number alone is right here — 60 lets the customer overshoot, 80 is
   * a day stale. Subtracting this instance's last reported count from the
   * aggregate leaves the 20 seats that are somebody else's, and adding the
   * live local count back gives a figure that is current here and complete
   * everywhere else.
   */
  it("adds this instance's live users to the seats other instances hold", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 60,
      aggregatedUserCount: 80,
      thisInstanceId: "instance-1",
      instances: [
        makeInstance({ instanceId: "instance-1", userCount: 60 }),
        makeInstance({ instanceId: "instance-2", userCount: 30 }),
      ],
    });

    expect(usage.seatsUsedByOtherInstances).toBe(20);
    expect(usage.seatsInUse).toBe(80);
    expect(usage.seatsRemaining).toBe(20);
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  it("sees users added here since the last report, which the aggregate cannot", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      // 25 people signed up since the report that said 60.
      localUserCount: 85,
      aggregatedUserCount: 80,
      thisInstanceId: "instance-1",
      instances: [
        makeInstance({ instanceId: "instance-1", userCount: 60 }),
        makeInstance({ instanceId: "instance-2", userCount: 30 }),
      ],
    });

    expect(usage.seatsInUse).toBe(105);
    expect(usage.seatsRemaining).toBe(0);
    expect(usage.hasSeatForNewUser).toBe(false);
  });

  it("counts users deleted here since the last report back off the total", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 40,
      aggregatedUserCount: 80,
      thisInstanceId: "instance-1",
      instances: [
        makeInstance({ instanceId: "instance-1", userCount: 60 }),
        makeInstance({ instanceId: "instance-2", userCount: 30 }),
      ],
    });

    // 20 seats elsewhere + 40 live here. The stale 80 no longer decides it.
    expect(usage.seatsInUse).toBe(60);
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  /*
   * Complete overlap: the same 60 people on both instances is 60 seats, not
   * 120. Subtracting our own reported count is what stops this instance being
   * charged twice for its own users.
   */
  it("does not double-count users who exist on more than one instance", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 60,
      aggregatedUserCount: 60,
      thisInstanceId: "instance-1",
      instances: [
        makeInstance({ instanceId: "instance-1", userCount: 60 }),
        makeInstance({ instanceId: "instance-2", userCount: 60 }),
      ],
    });

    expect(usage.seatsUsedByOtherInstances).toBe(0);
    expect(usage.seatsInUse).toBe(60);
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  /*
   * The stale licence-wide figure is deliberately NOT allowed to outvote the
   * live local count once the breakdown makes it decomposable. Freeing seats by
   * deleting users has to free them now, not at the next daily report - which
   * is the difference between a limit and a lockout.
   */
  it("does not let the stale licence-wide figure hold seats that were just freed", () => {
    const usage: SeatUsage = seats({
      userLimit: 80,
      localUserCount: 40,
      aggregatedUserCount: 80,
      thisInstanceId: "instance-1",
      instances: [
        makeInstance({ instanceId: "instance-1", userCount: 60 }),
        makeInstance({ instanceId: "instance-2", userCount: 30 }),
      ],
    });

    expect(usage.seatsInUse).toBe(60);
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  it("never lets other instances hold a negative number of seats", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 70,
      // Our own last report is somehow larger than the licence-wide total.
      aggregatedUserCount: 40,
      thisInstanceId: "instance-1",
      instances: [makeInstance({ instanceId: "instance-1", userCount: 70 })],
    });

    expect(usage.seatsUsedByOtherInstances).toBe(0);
    expect(usage.seatsInUse).toBe(70);
  });
});

describe("EnterpriseLicenseSeatsUtil - when the topology cannot be read", () => {
  /*
   * Every branch here resolves to "assume nothing is held elsewhere". That is
   * the under-enforcing direction on purpose: the daily report corrects an
   * undercount, and nothing corrects an installation that has wrongly locked
   * its administrator out of adding users.
   */
  it.each([
    ["there is no instance list", undefined],
    ["the instance list is null", null],
    ["the instance list is empty", []],
  ])(
    "attributes nothing to other instances when %s",
    (
      _label: string,
      instances: Array<EnterpriseLicenseInstanceSummary> | null | undefined,
    ) => {
      const usage: SeatUsage = seats({
        userLimit: 100,
        localUserCount: 20,
        aggregatedUserCount: 80,
        thisInstanceId: "instance-1",
        instances: instances,
      });

      expect(usage.seatsUsedByOtherInstances).toBe(0);
      expect(usage.seatsInUse).toBe(80);
    },
  );

  it("attributes nothing to other instances when this instance has no id", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 20,
      aggregatedUserCount: 80,
      thisInstanceId: null,
      instances: [makeInstance({ instanceId: "instance-2", userCount: 80 })],
    });

    expect(usage.seatsUsedByOtherInstances).toBe(0);
    expect(usage.seatsInUse).toBe(80);
  });

  /*
   * The dangerous reading of "we are not in the list" is "then the whole
   * aggregate belongs to somebody else". It is right for an instance that has
   * genuinely never registered, and catastrophic for one whose instance id
   * changed after its users had already been counted under the old one — that
   * installation would be charged twice for every user it has and could lock
   * itself out. It is not taken.
   */
  it("does not assume the whole aggregate is somebody else's when this instance is missing from the list", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 80,
      aggregatedUserCount: 80,
      thisInstanceId: "instance-that-was-renamed",
      instances: [makeInstance({ instanceId: "instance-1", userCount: 80 })],
    });

    expect(usage.seatsUsedByOtherInstances).toBe(0);
    expect(usage.seatsInUse).toBe(80);
    expect(usage.hasSeatForNewUser).toBe(true);
  });

  it.each([
    ["null", null],
    ["a fraction", 12.5 as unknown as number],
    ["a string", "60" as unknown as number],
  ])(
    "attributes nothing to other instances when our own reported count is %s",
    (_label: string, userCount: number | null) => {
      const usage: SeatUsage = seats({
        userLimit: 100,
        localUserCount: 20,
        aggregatedUserCount: 80,
        thisInstanceId: "instance-1",
        instances: [
          makeInstance({ instanceId: "instance-1", userCount: userCount }),
        ],
      });

      expect(usage.seatsUsedByOtherInstances).toBe(0);
      expect(usage.seatsInUse).toBe(80);
    },
  );

  it("survives a malformed entry in the instance list", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 60,
      aggregatedUserCount: 80,
      thisInstanceId: "instance-1",
      instances: [
        null as unknown as EnterpriseLicenseInstanceSummary,
        makeInstance({ instanceId: "instance-1", userCount: 60 }),
      ],
    });

    expect(usage.seatsUsedByOtherInstances).toBe(20);
    expect(usage.seatsInUse).toBe(80);
  });

  it("matches this instance by its id even with surrounding whitespace", () => {
    const usage: SeatUsage = seats({
      userLimit: 100,
      localUserCount: 60,
      aggregatedUserCount: 80,
      thisInstanceId: "  instance-1  ",
      instances: [makeInstance({ instanceId: "instance-1", userCount: 60 })],
    });

    expect(usage.seatsUsedByOtherInstances).toBe(20);
  });
});

describe("EnterpriseLicenseSeatsUtil - the message an administrator reads", () => {
  it("names the limit, the usage and what to do about it", () => {
    const message: string =
      EnterpriseLicenseSeatsUtil.getSeatLimitReachedMessage({
        seatsInUse: 150,
        userLimit: 150,
      });

    expect(message).toContain("150");
    expect(message).toContain("sales@oneuptime.com");
    expect(message).toContain("Refresh license");
  });

  it("does not say 1 users", () => {
    const message: string =
      EnterpriseLicenseSeatsUtil.getSeatLimitReachedMessage({
        seatsInUse: 1,
        userLimit: 1,
      });

    expect(message).toContain("1-user limit");
    expect(message).not.toContain("1 users");
  });

  /*
   * The message is shown to a person who is being told no. It must not read
   * like a bug, so it always states both halves of the arithmetic.
   */
  it("states the usage even when it exceeds the limit", () => {
    const message: string =
      EnterpriseLicenseSeatsUtil.getSeatLimitReachedMessage({
        seatsInUse: 212,
        userLimit: 150,
      });

    expect(message).toContain("150");
    expect(message).toContain("212");
  });
});
