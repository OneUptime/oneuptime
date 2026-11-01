import {
  getLicenseSeatUsage,
  LicenseSeatFigures,
  LicenseSeatUsage,
  SeatTone,
} from "../../../UI/Components/EditionLabel/LicenseSeatUsage";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, it } from "@jest/globals";

/*
 * The seat figures the edition pill, the edition dialog and the Admin
 * Dashboard's license page all read. One calculation, so the page never says
 * one thing and the pill beside it another: EditionLabel and the page both
 * call this, and these are the numbers they show.
 */

type FiguresFunction = (
  overrides?: Partial<LicenseSeatFigures>,
) => LicenseSeatFigures;

const figures: FiguresFunction = (
  overrides?: Partial<LicenseSeatFigures>,
): LicenseSeatFigures => {
  return {
    licenseValid: true,
    userLimit: 100,
    currentUserCount: 10,
    isSeatLimitEnforced: false,
    enforcedSeatsInUse: null,
    canAddMoreUsers: true,
    ...(overrides || {}),
  };
};

describe("which seat figure counts", () => {
  it("is what oneuptime.com last counted, while the limit is not enforced", () => {
    expect(
      getLicenseSeatUsage(
        figures({ currentUserCount: 40, enforcedSeatsInUse: 90 }),
      ).effectiveUserCount,
    ).toBe(40);
  });

  it("is the live count while the limit is enforced", () => {
    expect(
      getLicenseSeatUsage(
        figures({
          currentUserCount: 40,
          isSeatLimitEnforced: true,
          enforcedSeatsInUse: 90,
        }),
      ).effectiveUserCount,
    ).toBe(90);
  });

  it("falls back to the reported count when an enforced limit has no live figure", () => {
    expect(
      getLicenseSeatUsage(
        figures({
          currentUserCount: 40,
          isSeatLimitEnforced: true,
          enforcedSeatsInUse: null,
        }),
      ).effectiveUserCount,
    ).toBe(40);
  });

  it("is a live zero, not the reported count", () => {
    expect(
      getLicenseSeatUsage(
        figures({
          currentUserCount: 40,
          isSeatLimitEnforced: true,
          enforcedSeatsInUse: 0,
        }),
      ).effectiveUserCount,
    ).toBe(0);
  });

  it("is nothing when nobody has reported", () => {
    expect(
      getLicenseSeatUsage(figures({ currentUserCount: null }))
        .effectiveUserCount,
    ).toBeNull();
  });
});

describe("the percent an admin reads", () => {
  it.each([
    [10, 100, 10],
    [1, 3, 33],
    [2, 3, 67],
    [100, 100, 100],
    [120, 100, 120],
    [240, 120, 200],
    [0, 100, 0],
  ])(
    "%i of %i seats reads %i%%",
    (used: number, limit: number, percent: number) => {
      expect(
        getLicenseSeatUsage(
          figures({ currentUserCount: used, userLimit: limit }),
        ).seatUsageDisplayPercent,
      ).toBe(percent);
    },
  );

  it("never rounds a free seat up to 100%", () => {
    expect(
      getLicenseSeatUsage(figures({ currentUserCount: 599, userLimit: 600 }))
        .seatUsageDisplayPercent,
    ).toBe(99);
  });

  it.each([
    ["no limit", { userLimit: null }],
    ["an unlimited license", { userLimit: 0 }],
    ["no reported usage", { currentUserCount: null }],
  ])(
    "is nothing with %s: there is nothing to measure against",
    (_name: string, overrides: Partial<LicenseSeatFigures>) => {
      expect(
        getLicenseSeatUsage(figures(overrides)).seatUsageDisplayPercent,
      ).toBeNull();
    },
  );

  it("never goes below zero, whatever a report says", () => {
    expect(
      getLicenseSeatUsage(figures({ currentUserCount: -5 }))
        .seatUsageDisplayPercent,
    ).toBe(0);
  });
});

describe("the tone", () => {
  it.each<[string, Partial<LicenseSeatFigures>, SeatTone]>([
    ["plenty of seats", { currentUserCount: 10 }, "healthy"],
    ["just under the warning", { currentUserCount: 89 }, "healthy"],
    ["at the warning", { currentUserCount: 90 }, "approaching"],
    ["the last seat free", { currentUserCount: 99 }, "approaching"],
    ["exactly full, unenforced", { currentUserCount: 100 }, "approaching"],
    ["over the limit", { currentUserCount: 101 }, "breached"],
    [
      "exactly full, enforced: the door is already shut",
      {
        currentUserCount: 100,
        isSeatLimitEnforced: true,
        enforcedSeatsInUse: 100,
        canAddMoreUsers: false,
      },
      "breached",
    ],
    [
      "enforced with a seat free",
      {
        isSeatLimitEnforced: true,
        enforcedSeatsInUse: 95,
        canAddMoreUsers: true,
      },
      "approaching",
    ],
    ["an unlimited license", { userLimit: null }, "healthy"],
    ["no reported usage", { currentUserCount: null }, "healthy"],
  ])(
    "%s",
    (_name: string, overrides: Partial<LicenseSeatFigures>, tone: SeatTone) => {
      expect(getLicenseSeatUsage(figures(overrides)).seatTone).toBe(tone);
    },
  );

  /*
   * No license, nothing to breach: an expired license's seat limit is not
   * what stops anybody, and no seat warning should suggest it is.
   */
  it.each([
    ["over the limit", { currentUserCount: 500 }],
    [
      "full and enforced",
      { isSeatLimitEnforced: true, canAddMoreUsers: false },
    ],
  ])(
    "stays healthy %s while the license is not valid",
    (_name: string, overrides: Partial<LicenseSeatFigures>) => {
      expect(
        getLicenseSeatUsage(figures({ licenseValid: false, ...overrides }))
          .seatTone,
      ).toBe("healthy");
    },
  );
});

describe("whatever the figures", () => {
  /*
   * The promises the three screens rest on, over every shape of figures the
   * server can answer with.
   */
  const SAMPLES: number = 20000;
  const random: SeededRandom = seededRandom(5379);

  type MaybeNumberFunction = (limit: number) => number | null;

  const maybeNumber: MaybeNumberFunction = (limit: number): number | null => {
    return random(5) === 0 ? null : random(limit);
  };

  const samples: Array<LicenseSeatFigures> = Array.from(
    { length: SAMPLES },
    (): LicenseSeatFigures => {
      return {
        licenseValid: random(4) !== 0,
        userLimit: maybeNumber(1000),
        currentUserCount: maybeNumber(1200),
        isSeatLimitEnforced: random(2) === 0,
        enforcedSeatsInUse: maybeNumber(1200),
        canAddMoreUsers: random(2) === 0,
      };
    },
  );

  it("never reads 100% or more while a seat is free", () => {
    for (const sample of samples) {
      const usage: LicenseSeatUsage = getLicenseSeatUsage(sample);

      if (
        typeof sample.userLimit === "number" &&
        sample.userLimit > 0 &&
        typeof usage.effectiveUserCount === "number" &&
        usage.effectiveUserCount < sample.userLimit
      ) {
        expect(usage.seatUsageDisplayPercent).toBeLessThan(100);
      }
    }
  });

  it("is breached whenever more seats are used than licensed", () => {
    for (const sample of samples) {
      const usage: LicenseSeatUsage = getLicenseSeatUsage(sample);

      if (
        sample.licenseValid &&
        typeof sample.userLimit === "number" &&
        sample.userLimit > 0 &&
        typeof usage.effectiveUserCount === "number" &&
        usage.effectiveUserCount > sample.userLimit
      ) {
        expect(usage.seatTone).toBe("breached");
      }
    }
  });

  it("never warns about seats while the license is not valid", () => {
    for (const sample of samples) {
      if (!sample.licenseValid) {
        expect(getLicenseSeatUsage(sample).seatTone).toBe("healthy");
      }
    }
  });

  it("gives the same answer for the same figures", () => {
    for (const sample of samples.slice(0, 500)) {
      expect(getLicenseSeatUsage({ ...sample })).toEqual(
        getLicenseSeatUsage(sample),
      );
    }
  });
});
