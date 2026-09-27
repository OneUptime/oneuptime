import VerificationEmailResendPolicy, {
  VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
  VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE,
  VERIFICATION_EMAIL_RESEND_MAX_LINK_AGE_IN_DAYS,
  VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS,
  VERIFICATION_EMAIL_RESENDS_PER_CREDENTIAL_LIMIT,
  VERIFICATION_EMAILS_PER_WINDOW_LIMIT,
  VerificationEmailResendDecision,
  VerificationEmailResendDecisionType,
} from "../../../FeatureSet/Identity/Utils/VerificationEmailResendPolicy";
import { describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * HOW MUCH MAIL ONE UNVERIFIED ACCOUNT CAN BE MADE TO RECEIVE.
 *
 * POST /resend-verification-email is anonymous and every request that gets
 * past its checks sends an email. The mail only ever goes to the address
 * stored on the account, so nobody can aim it at a stranger -- but a caller
 * can aim it at the account's own inbox as often as the server lets them, and
 * this policy is the whole of "as often as the server lets them". It is pure
 * (no clock, no database), so every boundary below is pinned to the
 * millisecond rather than approximated.
 *
 * The three limits each close a hole the others leave open:
 *
 *   - the COOLDOWN turns a double click or a reload loop into one mail;
 *   - the WINDOW cap stops somebody who waits out every cooldown from turning
 *     the route into a steady mail-a-minute drip;
 *   - the PER-CREDENTIAL cap is what bounds one solved signup captcha to a
 *     fixed amount of mail over the credential's whole life. It counts sends
 *     STRICTLY after the credential was issued, so the mail the credential
 *     arrived with (the welcome mail, or the mail carrying the link) is not
 *     one of the resends it buys -- and a spent credential is refused outright
 *     rather than told to wait, because waiting would not help it.
 *
 * Also pinned, because each is a way the arithmetic could quietly go wrong:
 * fractional seconds round UP (a "wait 0 seconds" answer invites an immediate
 * retry that is refused again), a send stamped in the future by a skewed
 * database clock counts as "now" rather than stretching the wait, invalid
 * dates are ignored, input order does not matter, and sends older than the
 * window do not count toward it.
 * ---------------------------------------------------------------------------
 */

const NOW: Date = new Date("2026-09-27T12:00:00.000Z");

const MS_IN_SECOND: number = 1000;
const MS_IN_MINUTE: number = 60 * MS_IN_SECOND;
const MS_IN_HOUR: number = 60 * MS_IN_MINUTE;

type AgoFunction = (amount: number) => Date;

const secondsAgo: AgoFunction = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * MS_IN_SECOND);
};

const minutesAgo: AgoFunction = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * MS_IN_MINUTE);
};

const hoursAgo: AgoFunction = (hours: number): Date => {
  return new Date(NOW.getTime() - hours * MS_IN_HOUR);
};

type EvaluateOptions = {
  credentialIssuedAt?: Date;
  now?: Date;
  cooldownInSeconds?: number;
  perWindowLimit?: number;
  windowInSeconds?: number;
  perCredentialLimit?: number;
};

type EvaluateFunction = (
  sendTimes: Array<Date>,
  options?: EvaluateOptions,
) => VerificationEmailResendDecision;

/*
 * The credential defaults to one issued at NOW, so no send can be strictly
 * after it and the per-credential cap stays out of the way of the cooldown
 * and window tests. The per-credential tests pass their own issuance time.
 */
const evaluate: EvaluateFunction = (
  sendTimes: Array<Date>,
  options: EvaluateOptions = {},
): VerificationEmailResendDecision => {
  return VerificationEmailResendPolicy.evaluate({
    sendTimes: sendTimes,
    credentialIssuedAt: options.credentialIssuedAt || NOW,
    now: options.now || NOW,
    cooldownInSeconds: options.cooldownInSeconds,
    perWindowLimit: options.perWindowLimit,
    windowInSeconds: options.windowInSeconds,
    perCredentialLimit: options.perCredentialLimit,
  });
};

const ALLOWED: VerificationEmailResendDecision = {
  type: VerificationEmailResendDecisionType.Allowed,
  retryAfterSeconds: 0,
};

const EXHAUSTED: VerificationEmailResendDecision = {
  type: VerificationEmailResendDecisionType.CredentialExhausted,
  retryAfterSeconds: 0,
};

type CoolingDownFunction = (
  retryAfterSeconds: number,
) => VerificationEmailResendDecision;

const coolingDown: CoolingDownFunction = (
  retryAfterSeconds: number,
): VerificationEmailResendDecision => {
  return {
    type: VerificationEmailResendDecisionType.CoolingDown,
    retryAfterSeconds: retryAfterSeconds,
  };
};

type ShuffleFunction = (dates: Array<Date>) => Array<Date>;

// A fixed, obviously-not-sorted permutation: deterministic, no Math.random.
const shuffle: ShuffleFunction = (dates: Array<Date>): Array<Date> => {
  const odd: Array<Date> = dates.filter((_date: Date, index: number) => {
    return index % 2 === 1;
  });
  const even: Array<Date> = dates.filter((_date: Date, index: number) => {
    return index % 2 === 0;
  });

  return [...odd.reverse(), ...even];
};

describe("the shipped numbers", () => {
  /*
   * Restated so that loosening any of them is a decision somebody makes in a
   * diff, not a drift nobody notices. Together they bound one solved signup
   * captcha to the welcome mail plus three resends, a minute apart at best,
   * never more than five an hour.
   */
  it("waits a minute between sends", () => {
    expect(VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS).toBe(60);
  });

  it("allows at most five verification mails an hour", () => {
    expect(VERIFICATION_EMAILS_PER_WINDOW_LIMIT).toBe(5);
    expect(VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS).toBe(60 * 60);
  });

  it("lets one credential buy three resends", () => {
    expect(VERIFICATION_EMAIL_RESENDS_PER_CREDENTIAL_LIMIT).toBe(3);
  });

  it("stops honouring emailed links after two weeks", () => {
    expect(VERIFICATION_EMAIL_RESEND_MAX_LINK_AGE_IN_DAYS).toBe(14);
  });

  it("refuses with one message that points at signing in", () => {
    expect(VERIFICATION_EMAIL_RESEND_INVALID_MESSAGE).toBe(
      "This verification request is no longer valid. Sign in with your email and password and we will send you a new verification link.",
    );
  });

  it("names its decisions with stable wire values", () => {
    expect(VerificationEmailResendDecisionType.Allowed).toBe("allowed");
    expect(VerificationEmailResendDecisionType.CoolingDown).toBe(
      "cooling-down",
    );
    expect(VerificationEmailResendDecisionType.CredentialExhausted).toBe(
      "credential-exhausted",
    );
  });
});

describe("an account nobody has mailed yet", () => {
  it("is allowed a send", () => {
    expect(evaluate([])).toEqual(ALLOWED);
  });

  it("is allowed a send under any custom limits too", () => {
    expect(
      evaluate([], {
        cooldownInSeconds: 3600,
        perWindowLimit: 1,
        windowInSeconds: 86400,
        perCredentialLimit: 1,
      }),
    ).toEqual(ALLOWED);
  });

  it("treats a send history that is not an array as empty rather than throwing", () => {
    expect(evaluate(undefined as unknown as Array<Date>)).toEqual(ALLOWED);
    expect(evaluate(null as unknown as Array<Date>)).toEqual(ALLOWED);
  });
});

describe("the cooldown between consecutive sends", () => {
  it("makes a caller wait out the rest of the minute after a send", () => {
    expect(evaluate([secondsAgo(30)])).toEqual(coolingDown(30));
  });

  it("asks for the full minute when the last send was this instant", () => {
    expect(evaluate([NOW])).toEqual(coolingDown(60));
  });

  /* The boundary, a second either side of it. */
  it("still refuses 59 seconds after a send, for one more second", () => {
    expect(evaluate([secondsAgo(59)])).toEqual(coolingDown(1));
  });

  it("allows a send exactly 60 seconds after the last one", () => {
    expect(evaluate([secondsAgo(60)])).toEqual(ALLOWED);
  });

  it("allows a send 61 seconds after the last one", () => {
    expect(evaluate([secondsAgo(61)])).toEqual(ALLOWED);
  });

  /*
   * Rounding down would tell a caller 59.5 seconds from the end to wait 59,
   * and a retry at 59 would be refused again. Always round UP.
   */
  it.each([
    [10.2, 50],
    [30.5, 30],
    [0.5, 60],
    [0.001, 60],
    [59.001, 1],
    [59.999, 1],
  ])(
    "rounds a fractional wait up (last send %p s ago -> %p s)",
    (elapsedSeconds: number, expectedRetry: number) => {
      expect(evaluate([secondsAgo(elapsedSeconds)])).toEqual(
        coolingDown(expectedRetry),
      );
    },
  );

  it("never says to wait zero seconds while it is still refusing", () => {
    // One millisecond short of the cooldown: the smallest wait a Date can hold.
    const decision: VerificationEmailResendDecision = evaluate([
      new Date(NOW.getTime() - (60 * MS_IN_SECOND - 1)),
    ]);

    expect(decision.type).toBe(VerificationEmailResendDecisionType.CoolingDown);
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("measures from the most recent send, whatever order the history is in", () => {
    expect(
      evaluate([secondsAgo(300), secondsAgo(20), secondsAgo(100)]),
    ).toEqual(coolingDown(40));
  });

  it("honours a custom cooldown", () => {
    expect(evaluate([secondsAgo(30)], { cooldownInSeconds: 120 })).toEqual(
      coolingDown(90),
    );
    expect(evaluate([secondsAgo(120)], { cooldownInSeconds: 120 })).toEqual(
      ALLOWED,
    );
  });

  it("imposes no cooldown when it is configured to zero", () => {
    expect(evaluate([NOW], { cooldownInSeconds: 0 })).toEqual(ALLOWED);
  });
});

describe("send times stamped in the future", () => {
  /*
   * createdAt is stamped by Postgres and `now` by this process. A row that
   * looks like it was written in the future is the two clocks disagreeing,
   * not a send that has not happened yet -- so it counts as "just now". Taken
   * literally it would stretch the cooldown past its own length.
   */
  it("treats a future send as happening now, so the wait never exceeds the cooldown", () => {
    expect(evaluate([new Date(NOW.getTime() + 30 * MS_IN_MINUTE)])).toEqual(
      coolingDown(60),
    );
  });

  it("does not hold a future send in the window for longer than the window", () => {
    const future: Array<Date> = [1, 2, 3, 4, 5].map((hours: number) => {
      return new Date(NOW.getTime() + hours * MS_IN_HOUR);
    });

    /*
     * Five sends "now" fill the window, and the window frees up one full
     * window from now -- not five hours plus a window from now.
     */
    expect(evaluate(future)).toEqual(
      coolingDown(VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS),
    );
  });

  it("counts a future send against a credential issued in the past", () => {
    const future: Date = new Date(NOW.getTime() + MS_IN_HOUR);

    expect(
      evaluate([future, future, future], {
        credentialIssuedAt: minutesAgo(10),
      }),
    ).toEqual(EXHAUSTED);
  });
});

describe("invalid dates", () => {
  it("ignores an invalid send time and decides on the rest", () => {
    expect(evaluate([new Date("not a date"), secondsAgo(30)])).toEqual(
      coolingDown(30),
    );
  });

  it("ignores a history made only of invalid send times", () => {
    expect(
      evaluate([new Date(Number.NaN), new Date("garbage"), new Date("")]),
    ).toEqual(ALLOWED);
  });

  it("ignores entries that are not Dates at all", () => {
    expect(
      evaluate([
        NOW.toISOString() as unknown as Date,
        NOW.getTime() as unknown as Date,
        null as unknown as Date,
        undefined as unknown as Date,
        {} as unknown as Date,
      ]),
    ).toEqual(ALLOWED);
  });

  it("does not let invalid send times count toward the window cap", () => {
    const invalid: Array<Date> = Array.from({ length: 10 }, () => {
      return new Date("not a date");
    });

    expect(evaluate([...invalid, minutesAgo(30)])).toEqual(ALLOWED);
  });

  it("does not let invalid send times count toward the credential cap", () => {
    const invalid: Array<Date> = Array.from({ length: 10 }, () => {
      return new Date("not a date");
    });

    expect(evaluate(invalid, { credentialIssuedAt: hoursAgo(5) })).toEqual(
      ALLOWED,
    );
  });

  /*
   * Neither of these can come from the route, which builds both from values
   * it has already validated, and both fail CLOSED: without a clock nothing
   * can be measured, and a credential whose sends cannot be counted is a
   * credential with no cap.
   */
  it("says to wait when the clock itself is invalid", () => {
    expect(evaluate([], { now: new Date("not a date") })).toEqual(
      coolingDown(60),
    );
  });

  it("treats a credential with an invalid issuance time as spent", () => {
    expect(
      evaluate([], { credentialIssuedAt: new Date("not a date") }),
    ).toEqual(EXHAUSTED);
  });
});

describe("the per-window cap", () => {
  /*
   * Sends spaced well past the cooldown, so the window cap is the only thing
   * that can refuse.
   */
  it("allows a send with one fewer than the limit in the window", () => {
    expect(
      evaluate([
        minutesAgo(50),
        minutesAgo(40),
        minutesAgo(30),
        minutesAgo(20),
      ]),
    ).toEqual(ALLOWED);
  });

  it("refuses once the window holds the limit, until the oldest ages out", () => {
    /*
     * Five sends, the oldest 50 minutes ago. The next becomes possible when
     * that one leaves the hour: in 10 minutes.
     */
    expect(
      evaluate([
        minutesAgo(50),
        minutesAgo(40),
        minutesAgo(30),
        minutesAgo(20),
        minutesAgo(10),
      ]),
    ).toEqual(coolingDown(600));
  });

  it("with three over the limit, waits for the send `limit` places from the newest", () => {
    /*
     * Eight sends. Room for one more appears only when four of them have
     * left the window -- which is when the fourth oldest (40 minutes ago,
     * index 8 - 5 = 3 in ascending order) turns an hour old: in 20 minutes.
     * Waiting for the oldest alone (5 minutes) would still leave seven.
     */
    const sends: Array<Date> = [55, 50, 45, 40, 35, 30, 25, 20].map(
      (minutes: number) => {
        return minutesAgo(minutes);
      },
    );

    expect(evaluate(sends)).toEqual(coolingDown(20 * 60));
  });

  it("is actually allowed once the reported wait has passed, and not a second earlier", () => {
    const sends: Array<Date> = [55, 50, 45, 40, 35, 30, 25, 20].map(
      (minutes: number) => {
        return minutesAgo(minutes);
      },
    );

    const decision: VerificationEmailResendDecision = evaluate(sends);

    const retryAt: Date = new Date(
      NOW.getTime() + decision.retryAfterSeconds * MS_IN_SECOND,
    );
    const oneSecondEarlier: Date = new Date(retryAt.getTime() - MS_IN_SECOND);

    expect(evaluate(sends, { now: retryAt })).toEqual(ALLOWED);
    expect(evaluate(sends, { now: oneSecondEarlier })).toEqual(coolingDown(1));
  });

  it("rounds the window wait up to a whole second", () => {
    const sends: Array<Date> = [
      secondsAgo(3000.5),
      minutesAgo(40),
      minutesAgo(30),
      minutesAgo(20),
      minutesAgo(10),
    ];

    // 3600 - 3000.5 = 599.5 seconds, which must be reported as 600.
    expect(evaluate(sends)).toEqual(coolingDown(600));
  });

  it("does not count sends older than the window", () => {
    const sends: Array<Date> = [65, 64, 63, 62, 61].map((minutes: number) => {
      return minutesAgo(minutes);
    });

    expect(evaluate(sends)).toEqual(ALLOWED);
  });

  it("treats a send exactly one window old as already outside it", () => {
    expect(
      evaluate([
        secondsAgo(VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS),
        minutesAgo(40),
        minutesAgo(30),
        minutesAgo(20),
        minutesAgo(10),
      ]),
    ).toEqual(ALLOWED);
  });

  it("still counts a send one second short of a window old", () => {
    expect(
      evaluate([
        secondsAgo(VERIFICATION_EMAIL_RESEND_WINDOW_IN_SECONDS - 1),
        minutesAgo(40),
        minutesAgo(30),
        minutesAgo(20),
        minutesAgo(10),
      ]),
    ).toEqual(coolingDown(1));
  });

  it("does not depend on the order the history arrives in", () => {
    const sends: Array<Date> = [55, 50, 45, 40, 35, 30, 25, 20].map(
      (minutes: number) => {
        return minutesAgo(minutes);
      },
    );

    expect(evaluate(shuffle(sends))).toEqual(evaluate(sends));
    expect(evaluate([...sends].reverse())).toEqual(coolingDown(20 * 60));
  });

  it("does not reorder or change the caller's array", () => {
    const sends: Array<Date> = [minutesAgo(10), minutesAgo(50), minutesAgo(30)];
    const before: Array<number> = sends.map((date: Date) => {
      return date.getTime();
    });

    evaluate(sends);

    expect(
      sends.map((date: Date) => {
        return date.getTime();
      }),
    ).toEqual(before);
  });

  it("honours a custom limit and window", () => {
    expect(
      evaluate([secondsAgo(500), secondsAgo(400)], {
        perWindowLimit: 2,
        windowInSeconds: 600,
      }),
    ).toEqual(coolingDown(100));

    expect(
      evaluate([secondsAgo(500)], {
        perWindowLimit: 2,
        windowInSeconds: 600,
      }),
    ).toEqual(ALLOWED);
  });
});

describe("when the cooldown and the window cap both apply", () => {
  it("reports the cooldown when it is the later of the two", () => {
    /*
     * Window: the oldest of five turns an hour old in 10 s. Cooldown: the
     * newest was 10 s ago, so 50 s remain. The caller cannot send until both
     * have passed.
     */
    expect(
      evaluate([
        secondsAgo(3590),
        secondsAgo(3000),
        secondsAgo(2000),
        secondsAgo(1000),
        secondsAgo(10),
      ]),
    ).toEqual(coolingDown(50));
  });

  it("reports the window when it is the later of the two", () => {
    expect(
      evaluate([
        secondsAgo(3000),
        secondsAgo(2500),
        secondsAgo(2000),
        secondsAgo(1500),
        secondsAgo(30),
      ]),
    ).toEqual(coolingDown(600));
  });
});

describe("the per-credential cap", () => {
  const ISSUED_AT: Date = minutesAgo(30);

  it("allows sends while fewer than the limit happened after issuance", () => {
    expect(
      evaluate([minutesAgo(20), minutesAgo(10)], {
        credentialIssuedAt: ISSUED_AT,
      }),
    ).toEqual(ALLOWED);
  });

  it("stops the credential once the limit has been sent since it was issued", () => {
    expect(
      evaluate([minutesAgo(25), minutesAgo(15), minutesAgo(5)], {
        credentialIssuedAt: ISSUED_AT,
      }),
    ).toEqual(EXHAUSTED);
  });

  it("stays exhausted however many more sends there have been", () => {
    const sends: Array<Date> = [29, 25, 20, 15, 10, 5].map(
      (minutes: number) => {
        return minutesAgo(minutes);
      },
    );

    expect(evaluate(sends, { credentialIssuedAt: ISSUED_AT })).toEqual(
      EXHAUSTED,
    );
  });

  /*
   * STRICTLY after. The welcome mail is written in the same request that
   * mints the signup credential; if it counted, the credential would arrive
   * already one resend down. A send stamped at exactly the issuance
   * millisecond is that mail.
   */
  it("does not count a send at exactly the moment of issuance", () => {
    expect(
      evaluate([ISSUED_AT, minutesAgo(20), minutesAgo(10)], {
        credentialIssuedAt: ISSUED_AT,
      }),
    ).toEqual(ALLOWED);
  });

  it("counts a send one millisecond after issuance", () => {
    expect(
      evaluate(
        [new Date(ISSUED_AT.getTime() + 1), minutesAgo(20), minutesAgo(10)],
        { credentialIssuedAt: ISSUED_AT },
      ),
    ).toEqual(EXHAUSTED);
  });

  it("does not count sends from before the credential existed", () => {
    expect(
      evaluate([hoursAgo(5), hoursAgo(4), hoursAgo(3), minutesAgo(10)], {
        credentialIssuedAt: ISSUED_AT,
      }),
    ).toEqual(ALLOWED);
  });

  it("counts sends after issuance even once they have left the window", () => {
    /*
     * The window forgets; the credential must not. A day-old credential that
     * has bought its three resends, slowly, has still bought them.
     */
    expect(
      evaluate([hoursAgo(19), hoursAgo(18), hoursAgo(17)], {
        credentialIssuedAt: hoursAgo(20),
      }),
    ).toEqual(EXHAUSTED);
  });

  it("refuses a spent credential outright rather than telling it to wait", () => {
    /*
     * The last send was five seconds ago, so the cooldown would say "55 s".
     * But no amount of waiting makes this credential good again, and a
     * countdown would invite the caller to keep pressing.
     */
    expect(
      evaluate([minutesAgo(20), minutesAgo(10), secondsAgo(5)], {
        credentialIssuedAt: ISSUED_AT,
      }),
    ).toEqual(EXHAUSTED);
  });

  it("refuses a spent credential outright even when the window is full too", () => {
    const sends: Array<Date> = [50, 40, 30, 20, 10].map((minutes: number) => {
      return minutesAgo(minutes);
    });

    expect(evaluate(sends, { credentialIssuedAt: minutesAgo(35) })).toEqual(
      EXHAUSTED,
    );
  });

  it("honours a custom per-credential limit", () => {
    expect(
      evaluate([minutesAgo(10)], {
        credentialIssuedAt: ISSUED_AT,
        perCredentialLimit: 1,
      }),
    ).toEqual(EXHAUSTED);

    expect(
      evaluate([minutesAgo(25), minutesAgo(15), minutesAgo(5)], {
        credentialIssuedAt: ISSUED_AT,
        perCredentialLimit: 4,
      }),
    ).toEqual(ALLOWED);
  });

  it("does not depend on the order the history arrives in", () => {
    const sends: Array<Date> = [hoursAgo(2), minutesAgo(25), hoursAgo(1)];

    expect(
      evaluate(shuffle([...sends, minutesAgo(15), minutesAgo(5)]), {
        credentialIssuedAt: ISSUED_AT,
      }),
    ).toEqual(EXHAUSTED);
  });

  it("counts nothing against a credential issued a little in the future", () => {
    /*
     * The resend token tolerates a few minutes of clock skew between pods at
     * issuance. Everything already sent is then before it.
     */
    expect(
      evaluate([minutesAgo(20), minutesAgo(10), minutesAgo(5)], {
        credentialIssuedAt: new Date(NOW.getTime() + 2 * MS_IN_MINUTE),
      }),
    ).toEqual(ALLOWED);
  });
});

describe("determinism", () => {
  it("gives the same answer for the same input every time", () => {
    const sends: Array<Date> = [55, 50, 45, 40, 35, 30, 25, 20].map(
      (minutes: number) => {
        return minutesAgo(minutes);
      },
    );

    const first: VerificationEmailResendDecision = evaluate(sends);

    for (let i: number = 0; i < 5; i++) {
      expect(evaluate(sends)).toEqual(first);
    }
  });

  it("handles a long history without an argument-count limit", () => {
    /*
     * Math.max(...spread) throws a RangeError past a few hundred thousand
     * arguments. The route caps the history it loads, but the policy should
     * not depend on that.
     */
    const sends: Array<Date> = Array.from(
      { length: 200_000 },
      (_value: unknown, index: number) => {
        return hoursAgo(2 + index / 1000);
      },
    );

    expect(evaluate([...sends, secondsAgo(15)])).toEqual(coolingDown(45));
  });
});
