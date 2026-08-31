import CertificateReissueUtil from "../../Utils/CertificateReissue";
import OneUptimeDate from "../../Types/Date";
import { describe, expect, test } from "@jest/globals";

/*
 * The cooldown behind the dashboard's "Reissue SSL" button.
 *
 * Everything here is pure, and deliberately so: the API refuses a request
 * using these functions and the dashboard greys the button out using the very
 * same ones, so the two can never disagree about whether a domain is allowed
 * to order right now. What the tests pin is the property the whole feature
 * rests on - that the boundary the SERVER claims a row with
 * (getCooldownCutoff, which becomes a SQL comparison) and the boundary the
 * CLIENT renders (isInCooldown) are the same boundary.
 */

const NOW: Date = OneUptimeDate.fromString("2026-08-31T12:00:00.000Z");

type HoursAgoFunction = (hours: number) => Date;

const hoursAgo: HoursAgoFunction = (hours: number): Date => {
  return OneUptimeDate.addRemoveHours(NOW, -hours);
};

describe("CertificateReissueUtil cooldown window", () => {
  test("a domain that has never been reissued is not cooling down", () => {
    expect(CertificateReissueUtil.isInCooldown(null, NOW)).toBe(false);
    expect(CertificateReissueUtil.isInCooldown(undefined, NOW)).toBe(false);
  });

  test("a reissue requested a moment ago is cooling down", () => {
    expect(CertificateReissueUtil.isInCooldown(hoursAgo(0), NOW)).toBe(true);
  });

  test("a reissue requested just inside the window is still cooling down", () => {
    expect(
      CertificateReissueUtil.isInCooldown(
        hoursAgo(CertificateReissueUtil.COOLDOWN_IN_HOURS - 1),
        NOW,
      ),
    ).toBe(true);
  });

  test("a reissue requested exactly a cooldown ago is no longer cooling down", () => {
    expect(
      CertificateReissueUtil.isInCooldown(
        hoursAgo(CertificateReissueUtil.COOLDOWN_IN_HOURS),
        NOW,
      ),
    ).toBe(false);
  });

  test("a reissue requested long ago is not cooling down", () => {
    expect(
      CertificateReissueUtil.isInCooldown(
        hoursAgo(CertificateReissueUtil.COOLDOWN_IN_HOURS * 10),
        NOW,
      ),
    ).toBe(false);
  });

  /*
   * A stamp in the future means a clock moved backwards, not that the caller
   * has earned a free order. Treating it as "not cooling down" would turn a
   * clock skew into an unthrottled button.
   */
  test("a stamp in the future is treated as cooling down", () => {
    expect(
      CertificateReissueUtil.isInCooldown(
        OneUptimeDate.addRemoveHours(NOW, 6),
        NOW,
      ),
    ).toBe(true);
  });

  test("the cooldown is at least a day, so the button cannot be a spam vector", () => {
    expect(CertificateReissueUtil.COOLDOWN_IN_HOURS).toBeGreaterThanOrEqual(24);
  });
});

describe("CertificateReissueUtil.getCooldownCutoff", () => {
  /*
   * This is the regression that matters most. getCooldownCutoff becomes the
   * `certificateReissueRequestedAt <= :cutoff OR IS NULL` clause the server
   * claims a row with; isInCooldown is what the dashboard renders. If the two
   * ever drift apart, one of them is lying to the customer - either a button
   * that looks live and is refused, or one that looks dead and would work.
   */
  test("the cutoff agrees with isInCooldown at every hour across the window", () => {
    for (
      let hours: number = 0;
      hours <= CertificateReissueUtil.COOLDOWN_IN_HOURS * 2;
      hours++
    ) {
      const requestedAt: Date = hoursAgo(hours);

      const claimableByServer: boolean = !OneUptimeDate.isAfter(
        requestedAt,
        CertificateReissueUtil.getCooldownCutoff(NOW),
      );

      const coolingDownForClient: boolean = CertificateReissueUtil.isInCooldown(
        requestedAt,
        NOW,
      );

      expect(claimableByServer).toBe(!coolingDownForClient);
    }
  });

  test("the cutoff is exactly one cooldown behind now", () => {
    expect(
      OneUptimeDate.getHoursBetweenTwoDates(
        CertificateReissueUtil.getCooldownCutoff(NOW),
        NOW,
      ),
    ).toBe(CertificateReissueUtil.COOLDOWN_IN_HOURS);
  });
});

describe("CertificateReissueUtil.getNextReissueAllowedAt", () => {
  test("is one cooldown after the request", () => {
    const requestedAt: Date = hoursAgo(3);

    expect(
      OneUptimeDate.getHoursBetweenTwoDates(
        requestedAt,
        CertificateReissueUtil.getNextReissueAllowedAt(requestedAt),
      ),
    ).toBe(CertificateReissueUtil.COOLDOWN_IN_HOURS);
  });
});

describe("CertificateReissueUtil.getTimeRemainingText", () => {
  test("reports whole hours and minutes", () => {
    /*
     * Requested 21h30m ago, so 2h30m of a 24 hour cooldown is left.
     */
    const requestedAt: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.fromString("2026-08-30T14:30:00.000Z"),
      0,
    );

    expect(CertificateReissueUtil.getTimeRemainingText(requestedAt, NOW)).toBe(
      "2 hours 30 minutes",
    );
  });

  test("singularizes a lone hour and a lone minute", () => {
    expect(
      CertificateReissueUtil.getTimeRemainingText(
        OneUptimeDate.addRemoveHours(
          NOW,
          -(CertificateReissueUtil.COOLDOWN_IN_HOURS - 1),
        ),
        NOW,
      ),
    ).toBe("1 hour");

    expect(
      CertificateReissueUtil.getTimeRemainingText(
        OneUptimeDate.addRemoveMinutes(
          NOW,
          -(CertificateReissueUtil.COOLDOWN_IN_HOURS * 60 - 1),
        ),
        NOW,
      ),
    ).toBe("1 minute");
  });

  test("omits an hours part that is zero", () => {
    const text: string = CertificateReissueUtil.getTimeRemainingText(
      OneUptimeDate.addRemoveMinutes(
        NOW,
        -(CertificateReissueUtil.COOLDOWN_IN_HOURS * 60 - 20),
      ),
      NOW,
    );

    expect(text).toBe("20 minutes");
    expect(text).not.toContain("hour");
  });

  /*
   * Never a negative or a bare "0 minutes": once the cooldown is over the
   * message is not rendered at all, and the edge of the window must read as
   * an edge rather than as a countdown that overshot.
   */
  test("never counts below zero once the window has passed", () => {
    expect(
      CertificateReissueUtil.getTimeRemainingText(
        hoursAgo(CertificateReissueUtil.COOLDOWN_IN_HOURS * 5),
        NOW,
      ),
    ).toBe("less than a minute");
  });
});

describe("CertificateReissueUtil.getCooldownMessage", () => {
  test("tells the customer why and for how long", () => {
    const message: string = CertificateReissueUtil.getCooldownMessage(
      hoursAgo(1),
      NOW,
    );

    expect(message).toContain("Let's Encrypt");
    expect(message).toContain(
      `${CertificateReissueUtil.COOLDOWN_IN_HOURS} hours`,
    );
    expect(message).toContain(
      CertificateReissueUtil.getTimeRemainingText(hoursAgo(1), NOW),
    );
  });

  test("does not leak an internal column name or id at the customer", () => {
    const message: string = CertificateReissueUtil.getCooldownMessage(
      hoursAgo(1),
      NOW,
    );

    expect(message).not.toContain("certificateReissueRequestedAt");
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("NaN");
  });
});
