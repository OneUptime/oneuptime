import MarketplaceBilling, {
  HOUR_IN_MS,
  MAX_BILLABLE_AGE_IN_MS,
  PreparedReports,
  ReportPolicy,
} from "../../../Server/Marketplace/MarketplaceBilling";
import EnterpriseMarketplaceBillingUtil, {
  EnterpriseMarketplaceBillingState,
  EnterpriseMarketplaceUsageReport,
} from "Common/Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import { describe, expect, it } from "@jest/globals";

/*
 * The bookkeeping behind billing a marketplace-bought installation by the
 * user-hour. These pin the rules that decide what a buyer pays:
 *
 *   - an hour is billed at the most users seen in it, and only an hour a run
 *     saw - an hour the installation was down is never billed;
 *   - a report too old for the marketplace rides in the next one, unless it
 *     may already have reached the marketplace (then it is never sent twice);
 *   - nothing older than 30 days is billed;
 *   - the marketplace's answer decides the rest: accepted (billed, and the
 *     subscription confirmed), not-entitled, too-old, conflict, setup, retry.
 */

const INSTANCE_ID: string = "5f8b7c6d5e4f3a2b1c0d9e8f";
const AWS_POLICY: ReportPolicy = {
  maxReportAgeInMs: 5 * HOUR_IN_MS,
  acceptsZeroQuantity: true,
};
const AZURE_POLICY: ReportPolicy = {
  maxReportAgeInMs: 23 * HOUR_IN_MS,
  acceptsZeroQuantity: false,
};

const at: (iso: string) => Date = (iso: string): Date => {
  return new Date(iso);
};

const empty: () => EnterpriseMarketplaceBillingState =
  (): EnterpriseMarketplaceBillingState => {
    return EnterpriseMarketplaceBillingUtil.createEmpty(CloudMarketplace.AWS);
  };

const observe: (
  state: EnterpriseMarketplaceBillingState,
  iso: string,
  users: number,
) => EnterpriseMarketplaceBillingState = (
  state: EnterpriseMarketplaceBillingState,
  iso: string,
  users: number,
): EnterpriseMarketplaceBillingState => {
  return MarketplaceBilling.observe({
    state,
    now: at(iso),
    users,
    instanceId: INSTANCE_ID,
  });
};

const report: (
  hourStart: string,
  quantity: number,
  attempts?: number,
) => EnterpriseMarketplaceUsageReport = (
  hourStart: string,
  quantity: number,
  attempts?: number,
): EnterpriseMarketplaceUsageReport => {
  return {
    hourStart,
    quantity,
    idempotencyKey: MarketplaceBilling.idempotencyKeyFor(
      INSTANCE_ID,
      at(hourStart),
    ),
    attempts: attempts || 0,
    firstAttemptAt: attempts ? hourStart : null,
    lastError: null,
  };
};

const withPending: (
  reports: Array<EnterpriseMarketplaceUsageReport>,
  carried?: number,
) => EnterpriseMarketplaceBillingState = (
  reports: Array<EnterpriseMarketplaceUsageReport>,
  carried?: number,
): EnterpriseMarketplaceBillingState => {
  return {
    ...empty(),
    pendingReports: reports,
    carriedUserHours: carried || 0,
  };
};

describe("MarketplaceBilling.hourStartOf", () => {
  it("is the start of the UTC hour", () => {
    expect(
      MarketplaceBilling.hourStartOf(at("2026-10-17T10:59:59.999Z")),
    ).toEqual(at("2026-10-17T10:00:00.000Z"));
    expect(
      MarketplaceBilling.hourStartOf(at("2026-10-17T10:00:00.000Z")),
    ).toEqual(at("2026-10-17T10:00:00.000Z"));
  });
});

describe("MarketplaceBilling.idempotencyKeyFor", () => {
  it("is the same for the same installation and hour, so a retry from any pod is the same request", () => {
    expect(
      MarketplaceBilling.idempotencyKeyFor(
        INSTANCE_ID,
        at("2026-10-17T09:00:00.000Z"),
      ),
    ).toBe(
      MarketplaceBilling.idempotencyKeyFor(
        INSTANCE_ID,
        at("2026-10-17T09:00:00.000Z"),
      ),
    );
  });

  it("differs between hours and between installations", () => {
    const keys: Set<string> = new Set<string>([
      MarketplaceBilling.idempotencyKeyFor(
        INSTANCE_ID,
        at("2026-10-17T09:00:00.000Z"),
      ),
      MarketplaceBilling.idempotencyKeyFor(
        INSTANCE_ID,
        at("2026-10-17T10:00:00.000Z"),
      ),
      MarketplaceBilling.idempotencyKeyFor(
        "another-installation",
        at("2026-10-17T09:00:00.000Z"),
      ),
    ]);

    expect(keys.size).toBe(3);
  });

  it("is a version-5 UUID, which Google wants and fits AWS's 64 characters", () => {
    const key: string = MarketplaceBilling.idempotencyKeyFor(
      INSTANCE_ID,
      at("2026-10-17T09:00:00.000Z"),
    );

    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(key.length).toBeLessThanOrEqual(64);
  });
});

describe("MarketplaceBilling.observe", () => {
  it("starts watching the hour on the first run, and bills nothing yet", () => {
    const state: EnterpriseMarketplaceBillingState = observe(
      empty(),
      "2026-10-17T10:37:00.000Z",
      12,
    );

    expect(state.observedHour).toEqual({
      start: "2026-10-17T10:00:00.000Z",
      maxUsers: 12,
    });
    expect(state.pendingReports).toEqual([]);
  });

  it("keeps the most users seen in the hour", () => {
    let state: EnterpriseMarketplaceBillingState = observe(
      empty(),
      "2026-10-17T10:05:00.000Z",
      12,
    );
    state = observe(state, "2026-10-17T10:20:00.000Z", 15);
    state = observe(state, "2026-10-17T10:35:00.000Z", 13);

    expect(state.observedHour!.maxUsers).toBe(15);
  });

  it("turns the watched hour into a report when a run lands in a later hour", () => {
    let state: EnterpriseMarketplaceBillingState = observe(
      empty(),
      "2026-10-17T10:05:00.000Z",
      12,
    );
    state = observe(state, "2026-10-17T10:50:00.000Z", 14);
    state = observe(state, "2026-10-17T11:05:00.000Z", 11);

    expect(state.pendingReports).toEqual([
      report("2026-10-17T10:00:00.000Z", 14),
    ]);
    expect(state.observedHour).toEqual({
      start: "2026-10-17T11:00:00.000Z",
      maxUsers: 11,
    });
  });

  it("never bills an hour no run saw: an installation that was down is not billed for it", () => {
    let state: EnterpriseMarketplaceBillingState = observe(
      empty(),
      "2026-10-17T10:05:00.000Z",
      12,
    );
    // Down from 10:30 until 15:10.
    state = observe(state, "2026-10-17T15:10:00.000Z", 12);

    expect(
      state.pendingReports.map(
        (pending: EnterpriseMarketplaceUsageReport): string => {
          return pending.hourStart;
        },
      ),
    ).toEqual(["2026-10-17T10:00:00.000Z"]);
  });

  it("adds carried usage to the next report it makes", () => {
    let state: EnterpriseMarketplaceBillingState = {
      ...observe(empty(), "2026-10-17T10:05:00.000Z", 12),
      carriedUserHours: 30,
    };
    state = observe(state, "2026-10-17T11:05:00.000Z", 12);

    expect(state.pendingReports[0]!.quantity).toBe(42);
    expect(state.carriedUserHours).toBe(0);
  });

  it("treats a clock that went back as the same hour, and never reports an hour twice", () => {
    let state: EnterpriseMarketplaceBillingState = observe(
      empty(),
      "2026-10-17T11:05:00.000Z",
      12,
    );
    state = observe(state, "2026-10-17T10:55:00.000Z", 20);
    expect(state.observedHour).toEqual({
      start: "2026-10-17T11:00:00.000Z",
      maxUsers: 20,
    });

    const reported: EnterpriseMarketplaceBillingState = {
      ...state,
      pendingReports: [report("2026-10-17T11:00:00.000Z", 20)],
    };
    const next: EnterpriseMarketplaceBillingState = observe(
      reported,
      "2026-10-17T12:05:00.000Z",
      9,
    );

    expect(next.pendingReports).toHaveLength(1);
  });

  it("counts nonsense user counts as none", () => {
    for (const users of [Number.NaN, -3, Number.POSITIVE_INFINITY]) {
      expect(
        observe(empty(), "2026-10-17T10:05:00.000Z", users).observedHour!
          .maxUsers,
      ).toBe(0);
    }

    expect(
      observe(empty(), "2026-10-17T10:05:00.000Z", 7.9).observedHour!.maxUsers,
    ).toBe(7);
  });

  it("does not change the state it was given", () => {
    const state: EnterpriseMarketplaceBillingState = observe(
      empty(),
      "2026-10-17T10:05:00.000Z",
      12,
    );
    const before: string = JSON.stringify(state);

    observe(state, "2026-10-17T11:05:00.000Z", 12);

    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("MarketplaceBilling.prepare", () => {
  const NOW: Date = at("2026-10-17T12:05:00.000Z");

  it("sends the reports inside the marketplace's window, oldest first", () => {
    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state: withPending([
        report("2026-10-17T10:00:00.000Z", 10),
        report("2026-10-17T11:00:00.000Z", 11),
      ]),
      now: NOW,
      policy: AWS_POLICY,
    });

    expect(
      prepared.toSend.map((pending: EnterpriseMarketplaceUsageReport) => {
        return pending.hourStart;
      }),
    ).toEqual(["2026-10-17T10:00:00.000Z", "2026-10-17T11:00:00.000Z"]);
    expect(prepared.droppedUserHours).toBe(0);
  });

  it("folds a never-sent report that is too old into the newest one not sent yet, as AWS asks", () => {
    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state: withPending([
        // Six hours old: AWS would refuse it.
        report("2026-10-17T06:00:00.000Z", 6),
        report("2026-10-17T10:00:00.000Z", 10, 1),
        report("2026-10-17T11:00:00.000Z", 11),
      ]),
      now: NOW,
      policy: AWS_POLICY,
    });

    expect(
      prepared.state.pendingReports.map(
        (pending: EnterpriseMarketplaceUsageReport) => {
          return [pending.hourStart, pending.quantity];
        },
      ),
    ).toEqual([
      // Already sent once: its quantity can never change.
      ["2026-10-17T10:00:00.000Z", 10],
      ["2026-10-17T11:00:00.000Z", 17],
    ]);
    expect(prepared.droppedUserHours).toBe(0);
  });

  it("keeps a too-old never-sent report for the next report made when every report was sent already", () => {
    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state: withPending(
        [
          report("2026-10-17T06:00:00.000Z", 6),
          report("2026-10-17T11:00:00.000Z", 11, 2),
        ],
        4,
      ),
      now: NOW,
      policy: AWS_POLICY,
    });

    expect(prepared.state.carriedUserHours).toBe(10);
    expect(prepared.state.pendingReports).toHaveLength(1);
  });

  it("never sends again a report that may have reached the marketplace, and says it may be unbilled", () => {
    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state: withPending([report("2026-10-17T06:00:00.000Z", 6, 3)]),
      now: NOW,
      policy: AWS_POLICY,
    });

    expect(prepared.toSend).toEqual([]);
    expect(prepared.state.pendingReports).toEqual([]);
    expect(prepared.state.carriedUserHours).toBe(0);
    expect(prepared.droppedUserHours).toBe(6);
    expect(prepared.notes.join(" ")).toContain("may NOT have been billed");
  });

  it("lets Microsoft's 24-hour window keep what AWS's six hours would fold", () => {
    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state: withPending([report("2026-10-17T06:00:00.000Z", 6)]),
      now: NOW,
      policy: AZURE_POLICY,
    });

    expect(prepared.toSend).toHaveLength(1);
  });

  it("bills nothing older than 30 days", () => {
    const old: Date = new Date(
      NOW.getTime() - MAX_BILLABLE_AGE_IN_MS - HOUR_IN_MS,
    );
    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state: withPending([
        report(MarketplaceBilling.hourStartOf(old).toISOString(), 40),
        report("2026-10-17T11:00:00.000Z", 11),
      ]),
      now: NOW,
      policy: AWS_POLICY,
    });

    expect(prepared.droppedUserHours).toBe(40);
    expect(prepared.notes.join(" ")).toContain("more than 30 days old");
    expect(prepared.state.pendingReports[0]!.quantity).toBe(11);
  });

  it("skips an empty report on a marketplace that refuses them", () => {
    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state: withPending([report("2026-10-17T11:00:00.000Z", 0)]),
      now: NOW,
      policy: AZURE_POLICY,
    });

    expect(prepared.toSend).toEqual([]);
    expect(
      MarketplaceBilling.prepare({
        state: withPending([report("2026-10-17T11:00:00.000Z", 0)]),
        now: NOW,
        policy: AWS_POLICY,
      }).toSend,
    ).toHaveLength(1);
  });
});

describe("MarketplaceBilling.claim", () => {
  it("counts the attempt and keeps the time of the first one", () => {
    const key: string = report("2026-10-17T11:00:00.000Z", 11).idempotencyKey;
    let state: EnterpriseMarketplaceBillingState = withPending([
      report("2026-10-17T11:00:00.000Z", 11),
    ]);

    state = MarketplaceBilling.claim({
      state,
      idempotencyKey: key,
      now: at("2026-10-17T12:05:00.000Z"),
    });
    state = MarketplaceBilling.claim({
      state,
      idempotencyKey: key,
      now: at("2026-10-17T12:20:00.000Z"),
    });

    expect(state.pendingReports[0]!.attempts).toBe(2);
    expect(state.pendingReports[0]!.firstAttemptAt).toBe(
      "2026-10-17T12:05:00.000Z",
    );
  });

  it("protects a claimed report from being folded into", () => {
    const key: string = report("2026-10-17T11:00:00.000Z", 11).idempotencyKey;
    const claimed: EnterpriseMarketplaceBillingState = MarketplaceBilling.claim(
      {
        state: withPending([
          report("2026-10-17T06:00:00.000Z", 6),
          report("2026-10-17T11:00:00.000Z", 11),
        ]),
        idempotencyKey: key,
        now: at("2026-10-17T12:05:00.000Z"),
      },
    );

    const prepared: PreparedReports = MarketplaceBilling.prepare({
      state: claimed,
      now: at("2026-10-17T12:06:00.000Z"),
      policy: AWS_POLICY,
    });

    expect(prepared.state.pendingReports[0]!.quantity).toBe(11);
    expect(prepared.state.carriedUserHours).toBe(6);
  });
});

describe("MarketplaceBilling.applyOutcome", () => {
  const NOW: Date = at("2026-10-17T12:05:30.000Z");
  const pending: EnterpriseMarketplaceUsageReport = report(
    "2026-10-17T11:00:00.000Z",
    11,
    1,
  );

  const apply: (
    outcome: Parameters<typeof MarketplaceBilling.applyOutcome>[0]["outcome"],
    state?: EnterpriseMarketplaceBillingState,
  ) => EnterpriseMarketplaceBillingState = (
    outcome: Parameters<typeof MarketplaceBilling.applyOutcome>[0]["outcome"],
    state?: EnterpriseMarketplaceBillingState,
  ): EnterpriseMarketplaceBillingState => {
    return MarketplaceBilling.applyOutcome({
      state: state || withPending([{ ...pending }]),
      idempotencyKey: pending.idempotencyKey,
      outcome,
      now: NOW,
    });
  };

  it("accepted: billed, and the marketplace's word that the buyer is subscribed", () => {
    const state: EnterpriseMarketplaceBillingState = apply(
      { kind: "accepted", reportId: "record-1" },
      {
        ...withPending([{ ...pending }]),
        lastProblem: "ThrottlingException",
        lastProblemAt: "2026-10-17T11:05:00.000Z",
      },
    );

    expect(state.pendingReports).toEqual([]);
    expect(state.lastAcceptedReport).toEqual({
      hourStart: "2026-10-17T11:00:00.000Z",
      quantity: 11,
      reportId: "record-1",
      acceptedAt: NOW.toISOString(),
    });
    expect(state.verifiedAt).toBe(NOW.toISOString());
    expect(state.lastProblem).toBeNull();
    expect(state.lastProblemAt).toBeNull();
  });

  it("not-entitled: not billed, and the refusal recorded", () => {
    const state: EnterpriseMarketplaceBillingState = apply({
      kind: "not-entitled",
      detail: "CustomerNotEntitledException",
    });

    expect(state.pendingReports).toEqual([]);
    expect(state.unbilledUserHours).toBe(11);
    expect(state.refusedAt).toBe(NOW.toISOString());
    expect(state.refusal).toBe("CustomerNotEntitledException");
  });

  it("too-old: rides in the next report", () => {
    const state: EnterpriseMarketplaceBillingState = apply({
      kind: "too-old",
      detail: "TimestampOutOfBoundsException",
    });

    expect(state.pendingReports).toEqual([]);
    expect(state.carriedUserHours).toBe(11);
    expect(state.unbilledUserHours).toBe(0);
  });

  it("too-old: rides in a newer report that was never sent, when there is one", () => {
    const newer: EnterpriseMarketplaceUsageReport = report(
      "2026-10-17T12:00:00.000Z",
      12,
    );
    const state: EnterpriseMarketplaceBillingState = apply(
      { kind: "too-old", detail: "Expired" },
      withPending([{ ...pending }, newer]),
    );

    expect(state.pendingReports).toEqual([{ ...newer, quantity: 23 }]);
  });

  it("conflict: not billed", () => {
    const state: EnterpriseMarketplaceBillingState = apply({
      kind: "conflict",
      detail: "Duplicate of another quantity",
    });

    expect(state.pendingReports).toEqual([]);
    expect(state.unbilledUserHours).toBe(11);
    expect(state.lastProblem).toBe("Duplicate of another quantity");
  });

  it("setup and retry: kept for the next run, with the problem shown", () => {
    for (const kind of ["setup", "retry"] as const) {
      const state: EnterpriseMarketplaceBillingState = apply({
        kind,
        detail: `about ${kind}`,
      });

      expect(state.pendingReports).toHaveLength(1);
      expect(state.pendingReports[0]!.lastError).toBe(`about ${kind}`);
      expect(state.lastProblem).toBe(`about ${kind}`);
      expect(state.lastProblemAt).toBe(NOW.toISOString());
      expect(state.verifiedAt).toBeNull();
    }
  });

  it("cuts a long message down before storing it", () => {
    const state: EnterpriseMarketplaceBillingState = apply({
      kind: "retry",
      detail: "x".repeat(5000),
    });

    expect(state.lastProblem!.length).toBeLessThanOrEqual(503);
  });

  it("leaves the state alone for a report it no longer holds", () => {
    const state: EnterpriseMarketplaceBillingState = withPending([]);

    expect(
      MarketplaceBilling.applyOutcome({
        state,
        idempotencyKey: "unknown",
        outcome: { kind: "accepted", reportId: "x" },
        now: NOW,
      }),
    ).toEqual(state);
  });
});

describe("MarketplaceBilling.toReport", () => {
  it("is what the marketplace is sent", () => {
    expect(
      MarketplaceBilling.toReport(report("2026-10-17T11:00:00.000Z", 11)),
    ).toEqual({
      hourStart: at("2026-10-17T11:00:00.000Z"),
      quantity: 11,
      idempotencyKey: report("2026-10-17T11:00:00.000Z", 11).idempotencyKey,
    });
  });
});
