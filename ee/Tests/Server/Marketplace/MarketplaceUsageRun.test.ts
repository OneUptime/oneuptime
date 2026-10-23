import MarketplaceUsageRun, {
  MarketplaceUsageRunDependencies,
  MarketplaceUsageRunResult,
} from "../../../Server/Marketplace/MarketplaceUsageRun";
import MarketplaceBilling from "../../../Server/Marketplace/MarketplaceBilling";
import { StoredMarketplaceBilling } from "../../../Server/Marketplace/MarketplaceBillingStore";
import {
  SelfHostedMarketplaceConfigResult,
  SelfHostedMarketplaceSettings,
} from "../../../Server/Marketplace/Reporters/SelfHostedMarketplaceConfig";
import {
  SelfHostedMarketplaceReporter,
  SelfHostedUsageOutcome,
  SelfHostedUsageReport,
} from "../../../Server/Marketplace/Reporters/SelfHostedMarketplaceReporter";
import EnterpriseMarketplaceBillingUtil, {
  EnterpriseMarketplaceBillingState,
} from "Common/Types/EnterpriseLicense/EnterpriseMarketplaceBilling";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * One run of the marketplace usage job, end to end over fakes of everything
 * outside it: the settings, the marketplace, the database row, the lock.
 *
 * What these pin: OneUptime Cloud and unbilled installations are left alone;
 * every user is noted every run; an attempt is written down BEFORE the
 * marketplace is asked, and each answer straight after; the license is
 * refreshed when the marketplace confirms or refuses the subscription; and
 * usage is kept (never sent) while the settings are incomplete.
 */

const INSTANCE_ID: string = "5f8b7c6d5e4f3a2b1c0d9e8f";

const AWS_SETTINGS: SelfHostedMarketplaceSettings = {
  marketplace: CloudMarketplace.AWS,
  productCode: "6w0yyl6ppdh2o9sbu4i1zuqvk",
  region: "us-east-1",
};

type Event =
  | { kind: "save"; state: EnterpriseMarketplaceBillingState }
  | { kind: "report"; report: SelfHostedUsageReport }
  | { kind: "refresh" };

interface Harness {
  dependencies: MarketplaceUsageRunDependencies;
  events: Array<Event>;
  clock: { now: Date };
  stored: { value: StoredMarketplaceBilling | null };
  outcomes: Array<SelfHostedUsageOutcome>;
  users: { count: number };
  lock: { held: boolean };
  config: { value: SelfHostedMarketplaceConfigResult };
  billing: { enabled: boolean };
}

const createHarness: (
  overrides?: Partial<{
    state: EnterpriseMarketplaceBillingState | null;
    now: string;
    users: number;
    outcomes: Array<SelfHostedUsageOutcome>;
  }>,
) => Harness = (
  overrides?: Partial<{
    state: EnterpriseMarketplaceBillingState | null;
    now: string;
    users: number;
    outcomes: Array<SelfHostedUsageOutcome>;
  }>,
): Harness => {
  const events: Array<Event> = [];
  const clock: { now: Date } = {
    now: new Date(overrides?.now || "2026-10-17T11:05:00.000Z"),
  };
  const stored: { value: StoredMarketplaceBilling | null } = {
    value: {
      state: overrides?.state === undefined ? null : overrides.state,
      instanceId: INSTANCE_ID,
    },
  };
  const outcomes: Array<SelfHostedUsageOutcome> = [
    ...(overrides?.outcomes || []),
  ];
  const users: { count: number } = { count: overrides?.users ?? 12 };
  const lock: { held: boolean } = { held: false };
  const config: { value: SelfHostedMarketplaceConfigResult } = {
    value: { kind: "configured", settings: AWS_SETTINGS },
  };
  const billing: { enabled: boolean } = { enabled: false };

  const reporter: SelfHostedMarketplaceReporter = {
    marketplace: CloudMarketplace.AWS,
    maxReportAgeInMs: 5 * 60 * 60 * 1000,
    acceptsZeroQuantity: true,
    report: async (
      report: SelfHostedUsageReport,
    ): Promise<SelfHostedUsageOutcome> => {
      events.push({ kind: "report", report });
      return outcomes.shift() || { kind: "accepted", reportId: "record" };
    },
  };

  const dependencies: MarketplaceUsageRunDependencies = {
    isBillingEnabled: (): boolean => {
      return billing.enabled;
    },
    readConfig: (): SelfHostedMarketplaceConfigResult => {
      return config.value;
    },
    getReporter: (): SelfHostedMarketplaceReporter => {
      return reporter;
    },
    countUsers: async (): Promise<number> => {
      return users.count;
    },
    load: async (): Promise<StoredMarketplaceBilling | null> => {
      return stored.value
        ? {
            ...stored.value,
            state: stored.value.state
              ? EnterpriseMarketplaceBillingUtil.fromJSON(
                  EnterpriseMarketplaceBillingUtil.toJSON(stored.value.state),
                )
              : null,
          }
        : null;
    },
    save: async (state: EnterpriseMarketplaceBillingState): Promise<void> => {
      const copy: EnterpriseMarketplaceBillingState =
        EnterpriseMarketplaceBillingUtil.fromJSON(
          EnterpriseMarketplaceBillingUtil.toJSON(state),
        )!;
      events.push({ kind: "save", state: copy });
      if (stored.value) {
        stored.value = { ...stored.value, state: copy };
      }
    },
    withLock: async (work: () => Promise<void>): Promise<boolean> => {
      if (lock.held) {
        return false;
      }

      lock.held = true;

      try {
        await work();
      } finally {
        lock.held = false;
      }

      return true;
    },
    refreshLicense: async (): Promise<void> => {
      events.push({ kind: "refresh" });
    },
    now: (): Date => {
      return clock.now;
    },
  };

  return {
    dependencies,
    events,
    clock,
    stored,
    outcomes,
    users,
    lock,
    config,
    billing,
  };
};

// A state watching 10:00 with `users`, as a run at 10:05 would leave it.
const watching: (
  hourStart: string,
  users: number,
) => EnterpriseMarketplaceBillingState = (
  hourStart: string,
  users: number,
): EnterpriseMarketplaceBillingState => {
  return {
    ...EnterpriseMarketplaceBillingUtil.createEmpty(CloudMarketplace.AWS),
    observedHour: { start: hourStart, maxUsers: users },
  };
};

const kinds: (events: Array<Event>) => Array<string> = (
  events: Array<Event>,
): Array<string> => {
  return events.map((event: Event): string => {
    return event.kind;
  });
};

beforeEach(() => {
  jest.spyOn(logger, "info").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MarketplaceUsageRun.run - when it does nothing", () => {
  it("leaves OneUptime Cloud alone", async () => {
    const harness: Harness = createHarness();
    harness.billing.enabled = true;

    const result: MarketplaceUsageRunResult = await MarketplaceUsageRun.run(
      harness.dependencies,
    );

    expect(result.kind).toBe("skipped");
    expect(harness.events).toEqual([]);
  });

  it("leaves an installation that names no marketplace alone", async () => {
    const harness: Harness = createHarness();
    harness.config.value = { kind: "none" };

    expect((await MarketplaceUsageRun.run(harness.dependencies)).kind).toBe(
      "skipped",
    );
    expect(harness.events).toEqual([]);
  });

  it("only logs a marketplace it does not know", async () => {
    const harness: Harness = createHarness();
    harness.config.value = {
      kind: "incomplete",
      marketplace: null,
      problems: ['ENTERPRISE_MARKETPLACE is "oracle".'],
    };

    const result: MarketplaceUsageRunResult = await MarketplaceUsageRun.run(
      harness.dependencies,
    );

    expect(result).toEqual({
      kind: "skipped",
      reason: 'ENTERPRISE_MARKETPLACE is "oracle".',
    });
    expect(harness.events).toEqual([]);
  });

  it("does nothing while another run holds the lock", async () => {
    const harness: Harness = createHarness();
    harness.lock.held = true;

    const result: MarketplaceUsageRunResult = await MarketplaceUsageRun.run(
      harness.dependencies,
    );

    expect(result.kind).toBe("skipped");
    expect(harness.events).toEqual([]);
  });

  it("waits for the GlobalConfig row on a brand-new installation", async () => {
    const harness: Harness = createHarness();
    harness.stored.value = null;

    expect((await MarketplaceUsageRun.run(harness.dependencies)).kind).toBe(
      "skipped",
    );
    expect(harness.events).toEqual([]);
  });
});

describe("MarketplaceUsageRun.run - billing", () => {
  it("only starts watching the hour on the first run", async () => {
    const harness: Harness = createHarness({ now: "2026-10-17T10:37:00.000Z" });

    const result: MarketplaceUsageRunResult = await MarketplaceUsageRun.run(
      harness.dependencies,
    );

    expect(result).toEqual({
      kind: "ran",
      marketplace: CloudMarketplace.AWS,
      users: 12,
      reports: [],
      problems: [],
    });
    expect(kinds(harness.events)).toEqual(["save"]);
    expect(harness.stored.value!.state!.observedHour).toEqual({
      start: "2026-10-17T10:00:00.000Z",
      maxUsers: 12,
    });
  });

  it("reports the hour it watched once the next hour starts, writing the attempt down before it asks", async () => {
    const harness: Harness = createHarness({
      state: watching("2026-10-17T10:00:00.000Z", 14),
      now: "2026-10-17T11:05:00.000Z",
      outcomes: [{ kind: "accepted", reportId: "record-42" }],
    });

    const result: MarketplaceUsageRunResult = await MarketplaceUsageRun.run(
      harness.dependencies,
    );

    expect(kinds(harness.events)).toEqual([
      "save",
      "save",
      "report",
      "save",
      "refresh",
    ]);

    // The claim is on disk before the marketplace is asked.
    const claimSave: Event = harness.events[1]!;
    expect(
      claimSave.kind === "save"
        ? claimSave.state.pendingReports[0]!.attempts
        : -1,
    ).toBe(1);

    const sent: Event = harness.events[2]!;
    expect(sent.kind === "report" ? sent.report : null).toEqual({
      hourStart: new Date("2026-10-17T10:00:00.000Z"),
      quantity: 14,
      idempotencyKey: MarketplaceBilling.idempotencyKeyFor(
        INSTANCE_ID,
        new Date("2026-10-17T10:00:00.000Z"),
      ),
    });

    const state: EnterpriseMarketplaceBillingState =
      harness.stored.value!.state!;
    expect(state.pendingReports).toEqual([]);
    expect(state.verifiedAt).toBe("2026-10-17T11:05:00.000Z");
    expect(state.lastAcceptedReport!.reportId).toBe("record-42");
    expect(state.observedHour).toEqual({
      start: "2026-10-17T11:00:00.000Z",
      maxUsers: 12,
    });

    expect(result.kind === "ran" ? result.reports : null).toEqual([
      {
        hourStart: "2026-10-17T10:00:00.000Z",
        quantity: 14,
        outcome: "accepted",
      },
    ]);
  });

  it("refreshes the license when the marketplace refuses the subscription", async () => {
    const harness: Harness = createHarness({
      state: watching("2026-10-17T10:00:00.000Z", 14),
      outcomes: [
        { kind: "not-entitled", detail: "CustomerNotEntitledException" },
      ],
    });

    await MarketplaceUsageRun.run(harness.dependencies);

    expect(kinds(harness.events)).toContain("refresh");
    expect(harness.stored.value!.state!.refusedAt).toBe(
      "2026-10-17T11:05:00.000Z",
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it("keeps a report the marketplace could not take, for the next run, and does not refresh the license", async () => {
    const harness: Harness = createHarness({
      state: watching("2026-10-17T10:00:00.000Z", 14),
      outcomes: [{ kind: "retry", detail: "ThrottlingException" }],
    });

    await MarketplaceUsageRun.run(harness.dependencies);

    const state: EnterpriseMarketplaceBillingState =
      harness.stored.value!.state!;
    expect(state.pendingReports).toHaveLength(1);
    expect(state.pendingReports[0]!.attempts).toBe(1);
    expect(state.lastProblem).toBe("ThrottlingException");
    expect(kinds(harness.events)).not.toContain("refresh");
  });

  it("sends a kept report again on the next run, as the very same report", async () => {
    const harness: Harness = createHarness({
      state: watching("2026-10-17T10:00:00.000Z", 14),
      outcomes: [
        { kind: "retry", detail: "ThrottlingException" },
        { kind: "accepted", reportId: "record-43" },
      ],
    });

    await MarketplaceUsageRun.run(harness.dependencies);
    harness.clock.now = new Date("2026-10-17T11:20:00.000Z");
    await MarketplaceUsageRun.run(harness.dependencies);

    const reports: Array<SelfHostedUsageReport> = harness.events
      .filter((event: Event): boolean => {
        return event.kind === "report";
      })
      .map((event: Event): SelfHostedUsageReport => {
        return (event as { kind: "report"; report: SelfHostedUsageReport })
          .report;
      });

    expect(reports).toHaveLength(2);
    expect(reports[1]).toEqual(reports[0]);
    expect(harness.stored.value!.state!.pendingReports).toEqual([]);
  });

  it("stops sending for the run after an outage, a setup problem or a refusal", async () => {
    for (const outcome of [
      { kind: "retry", detail: "down" },
      { kind: "setup", detail: "wrong Region" },
      { kind: "not-entitled", detail: "no" },
    ] as Array<SelfHostedUsageOutcome>) {
      const harness: Harness = createHarness({
        state: {
          ...watching("2026-10-17T10:00:00.000Z", 14),
          pendingReports: [
            {
              hourStart: "2026-10-17T09:00:00.000Z",
              quantity: 13,
              idempotencyKey: "older",
              attempts: 0,
              firstAttemptAt: null,
              lastError: null,
            },
          ],
        },
        outcomes: [outcome],
      });

      await MarketplaceUsageRun.run(harness.dependencies);

      expect(
        harness.events.filter((event: Event): boolean => {
          return event.kind === "report";
        }),
      ).toHaveLength(1);
    }
  });

  it("sends every report that is due, oldest first, when the marketplace takes them", async () => {
    const harness: Harness = createHarness({
      state: {
        ...watching("2026-10-17T10:00:00.000Z", 14),
        pendingReports: [
          {
            hourStart: "2026-10-17T09:00:00.000Z",
            quantity: 13,
            idempotencyKey: "older",
            attempts: 1,
            firstAttemptAt: "2026-10-17T10:05:00.000Z",
            lastError: "ThrottlingException",
          },
        ],
      },
    });

    await MarketplaceUsageRun.run(harness.dependencies);

    const hours: Array<string> = harness.events
      .filter((event: Event): boolean => {
        return event.kind === "report";
      })
      .map((event: Event): string => {
        return (
          event as { kind: "report"; report: SelfHostedUsageReport }
        ).report.hourStart.toISOString();
      });

    expect(hours).toEqual([
      "2026-10-17T09:00:00.000Z",
      "2026-10-17T10:00:00.000Z",
    ]);
  });

  it("folds usage the marketplace calls too old into a later report sent in the same run", async () => {
    const harness: Harness = createHarness({
      state: {
        ...watching("2026-10-17T10:00:00.000Z", 14),
        pendingReports: [
          {
            hourStart: "2026-10-17T09:00:00.000Z",
            quantity: 13,
            idempotencyKey: "older",
            attempts: 0,
            firstAttemptAt: null,
            lastError: null,
          },
        ],
      },
      outcomes: [
        { kind: "too-old", detail: "TimestampOutOfBoundsException" },
        { kind: "accepted", reportId: "record-44" },
      ],
    });

    await MarketplaceUsageRun.run(harness.dependencies);

    const reports: Array<SelfHostedUsageReport> = harness.events
      .filter((event: Event): boolean => {
        return event.kind === "report";
      })
      .map((event: Event): SelfHostedUsageReport => {
        return (event as { kind: "report"; report: SelfHostedUsageReport })
          .report;
      });

    expect(
      reports.map((report: SelfHostedUsageReport) => {
        return report.quantity;
      }),
    ).toEqual([13, 27]);
    expect(harness.stored.value!.state!.lastAcceptedReport!.quantity).toBe(27);
  });

  it("keeps usage while the settings are incomplete, and shows the problem", async () => {
    const harness: Harness = createHarness({
      state: watching("2026-10-17T10:00:00.000Z", 14),
    });
    harness.config.value = {
      kind: "incomplete",
      marketplace: CloudMarketplace.AWS,
      problems: ["OneUptime's Kubernetes service account has no IAM role."],
    };

    const result: MarketplaceUsageRunResult = await MarketplaceUsageRun.run(
      harness.dependencies,
    );

    expect(kinds(harness.events)).toEqual(["save"]);
    const state: EnterpriseMarketplaceBillingState =
      harness.stored.value!.state!;
    expect(state.pendingReports).toHaveLength(1);
    expect(state.pendingReports[0]!.attempts).toBe(0);
    expect(state.lastProblem).toContain("no IAM role");
    expect(result.kind === "ran" ? result.problems : null).toEqual([
      "OneUptime's Kubernetes service account has no IAM role.",
    ]);
  });

  it("starts afresh, and says what was lost, when the installation moves to another marketplace", async () => {
    const harness: Harness = createHarness({
      state: {
        ...EnterpriseMarketplaceBillingUtil.createEmpty(CloudMarketplace.Azure),
        observedHour: { start: "2026-10-17T10:00:00.000Z", maxUsers: 14 },
        pendingReports: [
          {
            hourStart: "2026-10-17T09:00:00.000Z",
            quantity: 13,
            idempotencyKey: "azure",
            attempts: 0,
            firstAttemptAt: null,
            lastError: null,
          },
        ],
        verifiedAt: "2026-10-17T09:05:00.000Z",
      },
    });

    await MarketplaceUsageRun.run(harness.dependencies);

    const state: EnterpriseMarketplaceBillingState =
      harness.stored.value!.state!;
    expect(state.marketplace).toBe(CloudMarketplace.AWS);
    expect(state.verifiedAt).toBeNull();
    expect(state.pendingReports).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("NOT billed"),
    );
  });

  it("uses a stand-in installation id before the installation has one", async () => {
    const harness: Harness = createHarness({
      state: watching("2026-10-17T10:00:00.000Z", 14),
    });
    harness.stored.value = { ...harness.stored.value!, instanceId: null };

    await MarketplaceUsageRun.run(harness.dependencies);

    const sent: Event | undefined = harness.events.find((event: Event) => {
      return event.kind === "report";
    });
    expect(
      sent && sent.kind === "report" ? sent.report.idempotencyKey : "",
    ).toBe(
      MarketplaceBilling.idempotencyKeyFor(
        "oneuptime",
        new Date("2026-10-17T10:00:00.000Z"),
      ),
    );
  });

  it("keeps the run going when refreshing the license fails", async () => {
    const harness: Harness = createHarness({
      state: watching("2026-10-17T10:00:00.000Z", 14),
    });
    harness.dependencies.refreshLicense = async (): Promise<void> => {
      throw new Error("database blip");
    };

    const result: MarketplaceUsageRunResult = await MarketplaceUsageRun.run(
      harness.dependencies,
    );

    expect(result.kind).toBe("ran");
    expect(harness.stored.value!.state!.verifiedAt).not.toBeNull();
  });
});
