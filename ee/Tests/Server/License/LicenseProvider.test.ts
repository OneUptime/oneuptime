import {
  getSnapshotReusableUntilInMs,
  LicenseProvider,
  LicenseProviderDependencies,
} from "../../../Server/License/LicenseProvider";
import { LicenseInputs } from "../../../Server/License/LicenseInputs";
import { LICENSE_SNAPSHOT_REUSE_IN_MS } from "../../../Server/License/LicenseSettings";
import LicenseToken from "../../../Server/License/LicenseToken";
import { setTrustedLicenseKeysForTests } from "../../../Server/License/TrustedLicenseKeys";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
  EnterpriseLicenseSnapshot,
  SeatUsage,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { EnterpriseLicensingProvider } from "Common/Server/Enterprise/EnterpriseServerModule";
import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";
import FakeEnterpriseModule from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import {
  DAY_IN_MS,
  generateEd25519,
  KeyPair,
  legacyToken,
  signLicense,
  trustedEntryFor,
} from "./Helpers/LicenseTestKit";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The licensing provider: what core's EnterpriseEdition facade asks on every
 * enterprise configuration write, every dashboard request and every new user.
 *
 * What these pin:
 *   - it caches the INPUTS for a TTL and classifies them against the current
 *     time on every read, so the moment a license expires (and the moment
 *     its grace ends) is exact however long the inputs were cached;
 *   - a failed read keeps the last good inputs: a database hiccup never
 *     unlicenses an installation;
 *   - before the first successful read, the synchronous answer is null and
 *     the asynchronous one is a fail-closed "missing";
 *   - the unlicensed trial (14 days) counted from the first run of the
 *     Enterprise Edition, which is how installs that ran EE on the
 *     environment variable alone keep working through the upgrade, and the
 *     30-day grace period after a license expires - two boundaries that a
 *     reused snapshot never crosses;
 *   - the seat check, with billing pinned both ways.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const SIGNING_KEY: KeyPair = generateEd25519();
const TTL_IN_MS: number = 60 * 1000;
const RETRY_IN_MS: number = 5 * 1000;
const INSTANCE_ID: string = "5f8b7c6d5e4f3a2b1c0d9e8f";
const MINUTE_IN_MS: number = 60 * 1000;

// The owner's decision, spelled out so a change to either constant fails here.
const GRACE_DAYS: number = 30;
const TRIAL_DAYS: number = 14;

interface ProviderHarness {
  provider: LicenseProvider;
  clock: { now: Date };
  loads: { count: number };
  setInputs: (inputs: LicenseInputs) => void;
  failLoadsWith: (error: Error | null) => void;
  // While held, every load waits until released.
  holdLoads: (hold: boolean) => void;
  // Releases the held loads, oldest first, or newest first with "newest-first".
  releaseHeldLoads: (order?: "oldest-first" | "newest-first") => void;
  localUserCount: { value: number; calls: number };
}

const makeInputs: (overrides?: Partial<LicenseInputs>) => LicenseInputs = (
  overrides?: Partial<LicenseInputs>,
): LicenseInputs => {
  return {
    hasConfigRow: true,
    licenseKey: "acme-license-key",
    token: null,
    storedColumns: {},
    instanceId: INSTANCE_ID,
    currentUserCount: null,
    instances: [],
    ...(overrides || {}),
  };
};

const createHarness: (
  initial: LicenseInputs,
  dependencies?: Partial<LicenseProviderDependencies>,
) => ProviderHarness = (
  initial: LicenseInputs,
  dependencies?: Partial<LicenseProviderDependencies>,
): ProviderHarness => {
  let current: LicenseInputs = initial;
  let failure: Error | null = null;
  let hold: boolean = false;
  const held: Array<() => void> = [];
  const clock: { now: Date } = { now: new Date() };
  const loads: { count: number } = { count: 0 };
  const localUserCount: { value: number; calls: number } = {
    value: 0,
    calls: 0,
  };

  const provider: LicenseProvider = new LicenseProvider({
    now: (): Date => {
      return clock.now;
    },
    loadInputs: async (): Promise<LicenseInputs> => {
      loads.count++;
      const snapshotOfInputs: LicenseInputs = current;
      const failureAtStart: Error | null = failure;

      if (hold) {
        await new Promise<void>((resolve: () => void) => {
          held.push(resolve);
        });
      }

      if (failureAtStart) {
        throw failureAtStart;
      }

      return snapshotOfInputs;
    },
    getLocalUserCount: async (): Promise<number> => {
      localUserCount.calls++;
      return localUserCount.value;
    },
    isBillingEnabled: (): boolean => {
      return (
        (globalThis as unknown as Record<string, unknown>)[
          "__oneUptimeEnterpriseTestIsBillingEnabled"
        ] === true
      );
    },
    cacheTtlInMs: TTL_IN_MS,
    retryAfterFailureInMs: RETRY_IN_MS,
    ...(dependencies || {}),
  });

  return {
    provider,
    clock,
    loads,
    setInputs: (inputs: LicenseInputs): void => {
      current = inputs;
    },
    failLoadsWith: (error: Error | null): void => {
      failure = error;
    },
    holdLoads: (value: boolean): void => {
      hold = value;
    },
    releaseHeldLoads: (
      order: "oldest-first" | "newest-first" = "oldest-first",
    ): void => {
      while (held.length > 0) {
        const release: () => void = (
          order === "oldest-first" ? held.shift() : held.pop()
        ) as () => void;
        release();
      }
    },
    localUserCount,
  };
};

const advance: (harness: ProviderHarness, ms: number) => void = (
  harness: ProviderHarness,
  ms: number,
): void => {
  harness.clock.now = new Date(harness.clock.now.getTime() + ms);
};

// Lets every pending promise callback run.
const flush: () => Promise<void> = async (): Promise<void> => {
  for (let index: number = 0; index < 3; index++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
};

const unverifiedInputs: (expiresInDays: number) => LicenseInputs = (
  expiresInDays: number,
): LicenseInputs => {
  return makeInputs({
    token: legacyToken(),
    storedColumns: {
      expiresAt: new Date(Date.now() + expiresInDays * DAY_IN_MS),
      companyName: "Acme Inc",
      userLimit: 10,
    },
  });
};

beforeEach(() => {
  setTestBillingEnabled(false);
  setTrustedLicenseKeysForTests([trustedEntryFor(SIGNING_KEY)]);
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  setTrustedLicenseKeysForTests(null);
  setTestBillingEnabled(false);
  EnterpriseEdition.resetForTests();
  jest.restoreAllMocks();
});

describe("LicenseProvider - before the first read", () => {
  it("has no cached snapshot, so synchronous checks fail closed", () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));

    expect(harness.provider.getCachedSnapshot()).toBeNull();
  });

  it("starts a read in the background when asked synchronously", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));

    harness.provider.getCachedSnapshot();
    await flush();

    expect(harness.loads.count).toBe(1);
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");
  });

  it("answers the async read with a fail-closed 'missing' that says why when nothing could be read", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));
    harness.failLoadsWith(new Error("Database is not connected"));

    const snapshot: EnterpriseLicenseSnapshot =
      await harness.provider.getSnapshot();

    expect(snapshot.status).toBe("missing");
    expect(snapshot.features).toEqual([]);
    expect(snapshot.message).toContain("could not be read");
    expect(snapshot.message).toContain("Database is not connected");
    expect(harness.provider.getCachedSnapshot()).toBeNull();
  });

  it("recovers once the database is back", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));
    harness.failLoadsWith(new Error("down"));

    await harness.provider.refresh();
    harness.failLoadsWith(null);
    advance(harness, RETRY_IN_MS + 1);

    expect((await harness.provider.getSnapshot()).status).toBe("valid");
  });
});

describe("LicenseProvider - caching the inputs", () => {
  it("reads the inputs once per TTL, however many checks are made", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));

    await harness.provider.getSnapshot();

    for (let index: number = 0; index < 20; index++) {
      await harness.provider.getSnapshot();
      harness.provider.getCachedSnapshot();
    }

    expect(harness.loads.count).toBe(1);
  });

  it("re-reads after the TTL", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));

    await harness.provider.getSnapshot();
    advance(harness, TTL_IN_MS + 1);
    await harness.provider.getSnapshot();

    expect(harness.loads.count).toBe(2);
  });

  /*
   * A license written by another process - the worker's daily report, an
   * activation served by another replica - is seen here within one TTL.
   */
  it("sees a license another process wrote once the TTL has passed", async () => {
    const harness: ProviderHarness = createHarness(makeInputs());

    expect((await harness.provider.getSnapshot()).status).toBe("missing");

    harness.setInputs(unverifiedInputs(30));

    expect((await harness.provider.getSnapshot()).status).toBe("missing");

    advance(harness, TTL_IN_MS + 1);

    expect((await harness.provider.getSnapshot()).status).toBe("valid");
  });

  it("refreshes a stale cache in the background for the synchronous path", async () => {
    const harness: ProviderHarness = createHarness(makeInputs());

    await harness.provider.getSnapshot();
    harness.setInputs(unverifiedInputs(30));
    advance(harness, TTL_IN_MS + 1);

    // The stale answer first - never null once something was read.
    expect(harness.provider.getCachedSnapshot()?.status).toBe("missing");
    await flush();
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");
  });

  it("collapses concurrent reads into one", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));
    harness.holdLoads(true);

    const reads: Array<Promise<EnterpriseLicenseSnapshot>> = [
      harness.provider.getSnapshot(),
      harness.provider.getSnapshot(),
      harness.provider.getSnapshot(),
    ];
    harness.provider.getCachedSnapshot();

    await flush();
    harness.releaseHeldLoads();

    const snapshots: Array<EnterpriseLicenseSnapshot> =
      await Promise.all(reads);

    expect(harness.loads.count).toBe(1);
    for (const snapshot of snapshots) {
      expect(snapshot.status).toBe("valid");
    }
  });

  it("refresh() re-reads at once, whatever the TTL", async () => {
    const harness: ProviderHarness = createHarness(makeInputs());

    await harness.provider.getSnapshot();
    harness.setInputs(unverifiedInputs(30));
    await harness.provider.refresh();

    expect(harness.loads.count).toBe(2);
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");
  });

  /*
   * invalidate() after a write: the next read reloads, and in the meantime the
   * last good license keeps answering - a permission check a millisecond after
   * an activation must not see "no license at all".
   */
  it("invalidate() reloads in the background and keeps answering from the last good inputs", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));

    await harness.provider.getSnapshot();
    harness.setInputs(unverifiedInputs(300));
    harness.holdLoads(true);

    harness.provider.invalidate();

    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");

    await flush();
    harness.releaseHeldLoads();
    await flush();

    expect(harness.loads.count).toBe(2);
    expect(
      harness.provider.getCachedSnapshot()?.expiresAt?.getTime(),
    ).toBeGreaterThan(Date.now() + 200 * DAY_IN_MS);
  });

  /*
   * A read that began before a write must not be what the cache ends up
   * holding after a refresh that began after it.
   */
  it("never lets an older read overwrite a newer one", async () => {
    const harness: ProviderHarness = createHarness(makeInputs());
    harness.holdLoads(true);

    const olderRead: Promise<EnterpriseLicenseSnapshot> =
      harness.provider.getSnapshot();
    await flush();

    harness.setInputs(unverifiedInputs(30));
    const newerRefresh: Promise<void> = harness.provider.refresh();
    await flush();

    /*
     * The newer read lands first; the older one (holding the pre-write,
     * unlicensed inputs) lands after it and must be ignored.
     */
    harness.releaseHeldLoads("newest-first");
    await Promise.all([olderRead, newerRefresh]);

    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");
  });
});

describe("LicenseProvider - classifying against the current time", () => {
  /*
   * The inputs are cached; the verdict is not. A license that expires while
   * its inputs sit in the cache moves to grace at the exact moment.
   */
  it("moves an expiring license to grace without re-reading", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({
        token: signLicense(SIGNING_KEY, { instanceId: INSTANCE_ID }),
      }),
    );
    const expiresAt: Date = (await harness.provider.getSnapshot())
      .expiresAt as Date;

    harness.clock.now = new Date(expiresAt.getTime() - 1);
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");

    harness.clock.now = new Date(expiresAt.getTime());
    expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");
    expect(harness.provider.getCachedSnapshot()?.graceReason).toBe("expired");
  });

  it("moves a license out of grace exactly when the grace period ends", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({ token: signLicense(SIGNING_KEY) }),
    );
    const snapshot: EnterpriseLicenseSnapshot =
      await harness.provider.getSnapshot();
    const graceEndsAt: number =
      (snapshot.expiresAt as Date).getTime() + GRACE_DAYS * DAY_IN_MS;

    harness.clock.now = new Date(graceEndsAt);
    expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");

    harness.clock.now = new Date(graceEndsAt + 1);
    const after: EnterpriseLicenseSnapshot | null =
      harness.provider.getCachedSnapshot();

    expect(after?.status).toBe("expired");
    expect(after?.graceEndsAt?.getTime()).toBe(graceEndsAt);
  });

  it("gives the facade the right verdict as the clock moves", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({ token: signLicense(SIGNING_KEY, { daysFromNow: 1 }) }),
    );
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();
    (fake as unknown as { licensing: EnterpriseLicensingProvider }).licensing =
      harness.provider;

    EnterpriseEdition.register(fake);

    // Before the first read: fail closed.
    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      false,
    );

    await harness.provider.refresh();

    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      true,
    );

    advance(harness, 2 * DAY_IN_MS);
    // Grace: still available (and the cache is re-read in the background).
    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      true,
    );

    // 21 days after the expiry: past a 14-day mark, still inside the grace.
    advance(harness, 20 * DAY_IN_MS);
    await harness.provider.refresh();
    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      true,
    );

    // 31 days after the expiry: the grace period is over.
    advance(harness, 10 * DAY_IN_MS);
    await harness.provider.refresh();
    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      false,
    );
    expect(
      await EnterpriseEdition.isFeatureAvailable(EnterpriseFeature.SSO),
    ).toBe(false);
  });
});

/*
 * isFeatureActive asks for the snapshot on every tenant request, every audit
 * entry and every identity route, and classifying a signed license verifies
 * its signature (about 0.2 ms of CPU each time). So the provider reuses a
 * snapshot for the same inputs until the next moment its verdict can change,
 * and for LICENSE_SNAPSHOT_REUSE_IN_MS at most - without giving up the exact
 * expiry and grace boundaries pinned above.
 */
describe("LicenseProvider - reusing a computed snapshot", () => {
  const signedInputs: () => LicenseInputs = (): LicenseInputs => {
    return makeInputs({
      token: signLicense(SIGNING_KEY, { instanceId: INSTANCE_ID }),
    });
  };

  it("reuses at most for a second by default", () => {
    expect(LICENSE_SNAPSHOT_REUSE_IN_MS).toBe(1000);
  });

  it("verifies a signed license once for many reads, not once per read", async () => {
    const harness: ProviderHarness = createHarness(signedInputs());
    await harness.provider.refresh();
    const verify: jest.SpyInstance = jest.spyOn(LicenseToken, "verifySignature");

    for (let index: number = 0; index < 50; index++) {
      expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");
    }

    expect(verify).toHaveBeenCalledTimes(1);
    expect(harness.provider.getClassificationCount()).toBe(1);
  });

  it("negative control: with no reuse, every read verifies the signature again", async () => {
    const harness: ProviderHarness = createHarness(signedInputs(), {
      snapshotReuseInMs: 0,
    });
    await harness.provider.refresh();
    const verify: jest.SpyInstance = jest.spyOn(LicenseToken, "verifySignature");

    for (let index: number = 0; index < 50; index++) {
      harness.provider.getCachedSnapshot();
    }

    expect(verify).toHaveBeenCalledTimes(50);
    expect(harness.provider.getClassificationCount()).toBe(50);
  });

  it("classifies again once the reuse window has passed", async () => {
    const harness: ProviderHarness = createHarness(signedInputs());
    await harness.provider.refresh();
    harness.provider.getCachedSnapshot();

    advance(harness, LICENSE_SNAPSHOT_REUSE_IN_MS - 1);
    harness.provider.getCachedSnapshot();
    expect(harness.provider.getClassificationCount()).toBe(1);

    advance(harness, 1);
    harness.provider.getCachedSnapshot();
    expect(harness.provider.getClassificationCount()).toBe(2);
  });

  it("still moves to grace at the exact millisecond the license expires, inside the window", async () => {
    const harness: ProviderHarness = createHarness(signedInputs());
    const expiresAt: Date = (await harness.provider.getSnapshot())
      .expiresAt as Date;

    harness.clock.now = new Date(expiresAt.getTime() - 1);
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");

    // 1 ms later: well inside the reuse window, but past the boundary.
    harness.clock.now = new Date(expiresAt.getTime());
    expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");
  });

  it("still leaves the unlicensed trial at the exact millisecond it ends, inside the window", async () => {
    const firstSeenAt: Date = new Date();
    const harness: ProviderHarness = createHarness(
      makeInputs({
        licenseKey: null,
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeenAt },
      }),
    );
    const trialEndsAt: number = firstSeenAt.getTime() + 14 * DAY_IN_MS;
    harness.clock.now = new Date(trialEndsAt);
    await harness.provider.getSnapshot();

    expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");

    harness.clock.now = new Date(trialEndsAt + 1);
    expect(harness.provider.getCachedSnapshot()?.status).toBe("missing");
  });

  it("classifies afresh when new inputs are read", async () => {
    const harness: ProviderHarness = createHarness(signedInputs());
    await harness.provider.refresh();
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");

    harness.setInputs(
      makeInputs({ token: signLicense(SIGNING_KEY, { daysFromNow: -45 }) }),
    );
    await harness.provider.refresh();

    expect(harness.provider.getCachedSnapshot()?.status).toBe("expired");
  });

  it("classifies afresh when the trusted keys change", async () => {
    const harness: ProviderHarness = createHarness(signedInputs());
    await harness.provider.refresh();
    expect(harness.provider.getCachedSnapshot()?.verification).toBe(
      "verified",
    );

    setTrustedLicenseKeysForTests([]);

    expect(harness.provider.getCachedSnapshot()?.verification).toBe(
      "unverified",
    );
  });

  it("classifies afresh when the clock goes backwards", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({ token: signLicense(SIGNING_KEY, { daysFromNow: 1 }) }),
    );
    await harness.provider.refresh();
    const startedAt: Date = harness.clock.now;

    advance(harness, 45 * DAY_IN_MS);
    expect(harness.provider.getCachedSnapshot()?.status).toBe("expired");

    // An NTP correction back to before the expiry, within a millisecond.
    harness.clock.now = startedAt;
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");
  });

  it("hands every caller its own copy", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({
        token: signLicense(SIGNING_KEY, {
          instanceId: INSTANCE_ID,
          features: ["sso", "scim"],
        }),
      }),
    );
    await harness.provider.refresh();

    // Computed here; the reads below reuse it.
    const computed: EnterpriseLicenseSnapshot =
      harness.provider.getCachedSnapshot()!;
    computed.status = "expired";

    const first: EnterpriseLicenseSnapshot =
      harness.provider.getCachedSnapshot()!;
    expect(first.status).toBe("valid");
    first.status = "invalid";
    (first.features as Array<EnterpriseFeature>).push(
      EnterpriseFeature.AuditLogs,
    );
    first.expiresAt!.setTime(0);

    const second: EnterpriseLicenseSnapshot =
      harness.provider.getCachedSnapshot()!;

    expect(second).not.toBe(first);
    expect(second.status).toBe("valid");
    expect(second.features).toEqual([
      EnterpriseFeature.SSO,
      EnterpriseFeature.SCIM,
    ]);
    expect(second.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(harness.provider.getClassificationCount()).toBe(1);
  });

  /*
   * A reused snapshot is only reused until the next moment its verdict can
   * change. With a reuse cap far longer than either period, the only thing
   * that can end reuse is that boundary - so these pin that the boundary is
   * the 30-day grace and the 14-day trial, to the millisecond, and not the
   * other period's length.
   */
  describe("never reuses a snapshot across the 30-day grace or the 14-day trial boundary", () => {
    const LONG_REUSE_IN_MS: number = 365 * DAY_IN_MS;

    it("uses the two constants the owner decided on", () => {
      expect(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS).toBe(GRACE_DAYS);
      expect(ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS).toBe(TRIAL_DAYS);
    });

    it("an expired license: reused through expiry + 29 days 23 hours 59 minutes, classified afresh just after expiry + 30 days", async () => {
      const harness: ProviderHarness = createHarness(signedInputs(), {
        snapshotReuseInMs: LONG_REUSE_IN_MS,
      });
      const expiresAt: number = (
        (await harness.provider.getSnapshot()).expiresAt as Date
      ).getTime();

      harness.clock.now = new Date(expiresAt + 1);
      expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");
      const classifiedInGrace: number =
        harness.provider.getClassificationCount();

      // Past where a 14-day grace would have ended: the same snapshot, still grace.
      harness.clock.now = new Date(expiresAt + 14 * DAY_IN_MS + 1);
      expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");

      harness.clock.now = new Date(
        expiresAt + GRACE_DAYS * DAY_IN_MS - MINUTE_IN_MS,
      );
      expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");

      // The last millisecond of grace (inclusive).
      harness.clock.now = new Date(expiresAt + GRACE_DAYS * DAY_IN_MS);
      expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");
      expect(harness.provider.getClassificationCount()).toBe(classifiedInGrace);

      harness.clock.now = new Date(expiresAt + GRACE_DAYS * DAY_IN_MS + 1);
      const after: EnterpriseLicenseSnapshot | null =
        harness.provider.getCachedSnapshot();
      expect(after?.status).toBe("expired");
      expect(after?.graceEndsAt?.getTime()).toBe(
        expiresAt + GRACE_DAYS * DAY_IN_MS,
      );
      expect(harness.provider.getClassificationCount()).toBe(
        classifiedInGrace + 1,
      );
    });

    it("an unverified legacy license gets the same 30-day boundary", async () => {
      const expiresAt: Date = new Date(Date.UTC(2026, 0, 1));
      const harness: ProviderHarness = createHarness(
        makeInputs({
          token: legacyToken(),
          storedColumns: { expiresAt, userLimit: 10 },
        }),
        { snapshotReuseInMs: LONG_REUSE_IN_MS },
      );
      harness.clock.now = new Date(expiresAt.getTime() + DAY_IN_MS);
      expect((await harness.provider.getSnapshot()).status).toBe("grace");

      harness.clock.now = new Date(
        expiresAt.getTime() + GRACE_DAYS * DAY_IN_MS - MINUTE_IN_MS,
      );
      expect(harness.provider.getCachedSnapshot()).toMatchObject({
        status: "grace",
        verification: "unverified",
      });

      harness.clock.now = new Date(
        expiresAt.getTime() + GRACE_DAYS * DAY_IN_MS + 1,
      );
      expect(harness.provider.getCachedSnapshot()?.status).toBe("expired");
    });

    it("an unlicensed install: reused through first seen + 13 days 23 hours 59 minutes, classified afresh just after first seen + 14 days", async () => {
      const firstSeenAt: Date = new Date(Date.UTC(2026, 0, 1));
      const harness: ProviderHarness = createHarness(
        makeInputs({
          licenseKey: null,
          storedColumns: { enterpriseEditionFirstSeenAt: firstSeenAt },
        }),
        { snapshotReuseInMs: LONG_REUSE_IN_MS },
      );
      harness.clock.now = new Date(firstSeenAt.getTime() + DAY_IN_MS);
      expect((await harness.provider.getSnapshot()).status).toBe("grace");
      const classifiedInTrial: number =
        harness.provider.getClassificationCount();

      harness.clock.now = new Date(
        firstSeenAt.getTime() + TRIAL_DAYS * DAY_IN_MS - MINUTE_IN_MS,
      );
      expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");
      expect(harness.provider.getClassificationCount()).toBe(classifiedInTrial);

      harness.clock.now = new Date(
        firstSeenAt.getTime() + TRIAL_DAYS * DAY_IN_MS + 1,
      );
      const after: EnterpriseLicenseSnapshot | null =
        harness.provider.getCachedSnapshot();
      expect(after?.status).toBe("missing");
      expect(after?.graceEndsAt?.getTime()).toBe(
        firstSeenAt.getTime() + TRIAL_DAYS * DAY_IN_MS,
      );
      expect(harness.provider.getClassificationCount()).toBe(
        classifiedInTrial + 1,
      );

      // Not the 30 days an expired license gets: still lapsed at day 29.
      harness.clock.now = new Date(firstSeenAt.getTime() + 29 * DAY_IN_MS);
      expect(harness.provider.getCachedSnapshot()?.status).toBe("missing");
    });

    it("a real snapshot is reusable up to and including its last moment of grace or trial, never past it", () => {
      const nowInMs: number = Date.UTC(2026, 0, 10);
      const expiredAt: Date = new Date(nowInMs - DAY_IN_MS);
      const grace: EnterpriseLicenseSnapshot = {
        status: "grace",
        verification: "unverified",
        graceReason: "expired",
        expiresAt: expiredAt,
        graceEndsAt: new Date(expiredAt.getTime() + GRACE_DAYS * DAY_IN_MS),
        userLimit: null,
        isEvaluation: false,
        features: "all",
      };
      const firstSeenAt: Date = new Date(nowInMs - DAY_IN_MS);
      const trial: EnterpriseLicenseSnapshot = {
        status: "grace",
        verification: "none",
        graceReason: "unlicensed",
        graceEndsAt: new Date(firstSeenAt.getTime() + TRIAL_DAYS * DAY_IN_MS),
        userLimit: null,
        isEvaluation: false,
        features: "all",
      };

      expect(
        getSnapshotReusableUntilInMs(grace, nowInMs, LONG_REUSE_IN_MS),
      ).toBe(expiredAt.getTime() + GRACE_DAYS * DAY_IN_MS + 1);
      expect(
        getSnapshotReusableUntilInMs(trial, nowInMs, LONG_REUSE_IN_MS),
      ).toBe(firstSeenAt.getTime() + TRIAL_DAYS * DAY_IN_MS + 1);
    });
  });

  describe("getSnapshotReusableUntilInMs", () => {
    const NOW: number = Date.UTC(2026, 8, 1);

    it("is the cap when no boundary is near", () => {
      expect(
        getSnapshotReusableUntilInMs(
          {
            status: "valid",
            verification: "verified",
            expiresAt: new Date(NOW + DAY_IN_MS),
            userLimit: null,
            isEvaluation: false,
            features: "all",
          },
          NOW,
          1000,
        ),
      ).toBe(NOW + 1000);
    });

    it("stops at the expiry of a valid license", () => {
      expect(
        getSnapshotReusableUntilInMs(
          {
            status: "valid",
            verification: "verified",
            expiresAt: new Date(NOW + 10),
            userLimit: null,
            isEvaluation: false,
            features: "all",
          },
          NOW,
          1000,
        ),
      ).toBe(NOW + 10);
    });

    it("stops just after the last millisecond of grace (grace includes graceEndsAt)", () => {
      expect(
        getSnapshotReusableUntilInMs(
          {
            status: "grace",
            verification: "verified",
            expiresAt: new Date(NOW - DAY_IN_MS),
            graceEndsAt: new Date(NOW + 10),
            userLimit: null,
            isEvaluation: false,
            features: "all",
          },
          NOW,
          1000,
        ),
      ).toBe(NOW + 11);
    });

    it("ignores boundaries already passed and dates that are not dates", () => {
      expect(
        getSnapshotReusableUntilInMs(
          {
            status: "expired",
            verification: "verified",
            expiresAt: new Date(NOW - 30 * DAY_IN_MS),
            graceEndsAt: new Date(Number.NaN),
            userLimit: null,
            isEvaluation: false,
            features: "all",
          },
          NOW,
          1000,
        ),
      ).toBe(NOW + 1000);
    });

    it("never reuses with a cap of zero or less", () => {
      const snapshot: EnterpriseLicenseSnapshot = {
        status: "missing",
        verification: "none",
        userLimit: null,
        isEvaluation: false,
        features: [],
      };

      expect(getSnapshotReusableUntilInMs(snapshot, NOW, 0)).toBe(NOW);
      expect(getSnapshotReusableUntilInMs(snapshot, NOW, -5)).toBe(NOW);
    });
  });
});

describe("LicenseProvider - a failed read keeps the last good license", () => {
  it("keeps answering from the last good inputs when a re-read fails", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));

    expect((await harness.provider.getSnapshot()).status).toBe("valid");

    harness.failLoadsWith(new Error("connection reset"));
    advance(harness, TTL_IN_MS + 1);

    expect((await harness.provider.getSnapshot()).status).toBe("valid");
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");
    expect(harness.provider.getLastLoadError()).toBe("connection reset");
  });

  it("does not throw from refresh() when the read fails", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));
    await harness.provider.getSnapshot();
    harness.failLoadsWith(new Error("connection reset"));

    await expect(harness.provider.refresh()).resolves.toBeUndefined();
    expect(harness.provider.getCachedSnapshot()?.status).toBe("valid");
  });

  it("backs off after a failure instead of hitting the database on every check", async () => {
    const harness: ProviderHarness = createHarness(unverifiedInputs(30));
    await harness.provider.getSnapshot();
    harness.failLoadsWith(new Error("connection reset"));
    advance(harness, TTL_IN_MS + 1);

    await harness.provider.getSnapshot();
    const loadsAfterFailure: number = harness.loads.count;

    for (let index: number = 0; index < 10; index++) {
      await harness.provider.getSnapshot();
      harness.provider.getCachedSnapshot();
    }

    expect(harness.loads.count).toBe(loadsAfterFailure);

    advance(harness, RETRY_IN_MS + 1);
    await harness.provider.getSnapshot();

    expect(harness.loads.count).toBe(loadsAfterFailure + 1);
  });

  it("still classifies the last good inputs against the current time", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({ token: signLicense(SIGNING_KEY, { daysFromNow: 1 }) }),
    );
    await harness.provider.getSnapshot();
    harness.failLoadsWith(new Error("connection reset"));

    advance(harness, 45 * DAY_IN_MS);

    expect((await harness.provider.getSnapshot()).status).toBe("expired");
  });
});

describe("LicenseProvider - the unlicensed trial (first seen)", () => {
  it("gives an unlicensed installation a 14-day trial from the first run", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({
        licenseKey: null,
        storedColumns: {
          enterpriseEditionFirstSeenAt: new Date(Date.now() - 3 * DAY_IN_MS),
        },
      }),
    );

    const snapshot: EnterpriseLicenseSnapshot =
      await harness.provider.getSnapshot();

    expect(snapshot.status).toBe("grace");
    expect(snapshot.graceReason).toBe("unlicensed");
    expect(snapshot.verification).toBe("none");
    expect(snapshot.features).toBe("all");
    expect(snapshot.userLimit).toBeNull();
    expect(snapshot.graceEndsAt?.getTime()).toBeGreaterThan(
      Date.now() + 10 * DAY_IN_MS,
    );
    // The trial, not the longer grace period an expired license gets.
    expect(snapshot.graceEndsAt?.getTime()).toBeLessThan(
      Date.now() + 12 * DAY_IN_MS,
    );
  });

  it("ends the unlicensed trial exactly 14 days after the first run", async () => {
    const firstSeenAt: Date = new Date();
    const harness: ProviderHarness = createHarness(
      makeInputs({
        licenseKey: null,
        storedColumns: { enterpriseEditionFirstSeenAt: firstSeenAt },
      }),
    );
    harness.clock.now = firstSeenAt;
    await harness.provider.getSnapshot();

    harness.clock.now = new Date(
      firstSeenAt.getTime() + TRIAL_DAYS * DAY_IN_MS,
    );
    expect(harness.provider.getCachedSnapshot()?.status).toBe("grace");

    harness.clock.now = new Date(
      firstSeenAt.getTime() + TRIAL_DAYS * DAY_IN_MS + 1,
    );
    const after: EnterpriseLicenseSnapshot | null =
      harness.provider.getCachedSnapshot();
    expect(after?.status).toBe("missing");
    expect(after?.features).toEqual([]);
  });

  it("is plain 'missing' when the first run was never recorded", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({ licenseKey: null }),
    );

    expect((await harness.provider.getSnapshot()).status).toBe("missing");
  });

  it("stops applying once a license is installed", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({
        token: signLicense(SIGNING_KEY, { daysFromNow: -45 }),
        storedColumns: {
          enterpriseEditionFirstSeenAt: new Date(Date.now() - DAY_IN_MS),
        },
      }),
    );

    // An expired license is expired, not a fresh trial.
    expect((await harness.provider.getSnapshot()).status).toBe("expired");
  });
});

describe("LicenseProvider - what the snapshot exposes", () => {
  it("returns a plain snapshot without the classifier's bookkeeping", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({ token: signLicense(SIGNING_KEY) }),
    );

    const snapshot: EnterpriseLicenseSnapshot =
      await harness.provider.getSnapshot();

    expect(snapshot.verification).toBe("verified");
    expect(snapshot.companyName).toBe("Acme Inc");
    expect(snapshot.userLimit).toBe(50);
    expect(snapshot).not.toHaveProperty("reason");
    expect(snapshot).not.toHaveProperty("kid");
    expect(snapshot).not.toHaveProperty("licenseId");
  });

  it("exposes the full classification to ee's own callers", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({ token: signLicense(SIGNING_KEY) }),
    );

    expect((await harness.provider.getClassification())?.reason).toBe(
      "verified",
    );
  });

  it("reports an instance-bound license read on another instance as invalid", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({
        token: signLicense(SIGNING_KEY, { instanceId: "some-other-instance" }),
      }),
    );

    const snapshot: EnterpriseLicenseSnapshot =
      await harness.provider.getSnapshot();

    expect(snapshot.status).toBe("invalid");
    expect(snapshot.message).toContain("different OneUptime instance");
  });
});

describe("LicenseProvider - seats", () => {
  const seatInputs: LicenseInputs = makeInputs({
    token: legacyToken(),
    storedColumns: {
      expiresAt: new Date(Date.now() + 30 * DAY_IN_MS),
      userLimit: 10,
    },
  });

  it("refuses the user past the limit of a valid license", async () => {
    const harness: ProviderHarness = createHarness(seatInputs);
    harness.localUserCount.value = 10;

    await expect(
      harness.provider.assertSeatAvailableForNewUser(),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  it("allows a user while a seat is free", async () => {
    const harness: ProviderHarness = createHarness(seatInputs);
    harness.localUserCount.value = 9;

    await expect(
      harness.provider.assertSeatAvailableForNewUser(),
    ).resolves.toBeUndefined();
  });

  it("does nothing, and counts nobody, with billing enabled", async () => {
    setTestBillingEnabled(true);
    const harness: ProviderHarness = createHarness(seatInputs);
    harness.localUserCount.value = 10_000;

    await expect(
      harness.provider.assertSeatAvailableForNewUser(),
    ).resolves.toBeUndefined();
    expect(await harness.provider.getSeatUsage()).toBeNull();
    expect(harness.localUserCount.calls).toBe(0);
    expect(harness.loads.count).toBe(0);
  });

  it("does not limit seats once the license expired past its grace", async () => {
    const harness: ProviderHarness = createHarness(
      makeInputs({
        token: legacyToken(),
        storedColumns: {
          expiresAt: new Date(Date.now() - 45 * DAY_IN_MS),
          userLimit: 10,
        },
      }),
    );
    harness.localUserCount.value = 10_000;

    await expect(
      harness.provider.assertSeatAvailableForNewUser(),
    ).resolves.toBeUndefined();
    expect(harness.localUserCount.calls).toBe(0);
  });

  it("does not limit seats before the license could ever be read", async () => {
    const harness: ProviderHarness = createHarness(seatInputs);
    harness.failLoadsWith(new Error("down"));
    harness.localUserCount.value = 10_000;

    await expect(
      harness.provider.assertSeatAvailableForNewUser(),
    ).resolves.toBeUndefined();
    expect(await harness.provider.getSeatUsage()).toBeNull();
  });

  it("reports seat usage computed from the live count", async () => {
    const harness: ProviderHarness = createHarness(seatInputs);
    harness.localUserCount.value = 7;

    const usage: SeatUsage | null = await harness.provider.getSeatUsage();

    expect(usage?.isEnforced).toBe(true);
    expect(usage?.seatsInUse).toBe(7);
    expect(usage?.seatsRemaining).toBe(3);
  });

  it("counts the live users afresh for every new user", async () => {
    const harness: ProviderHarness = createHarness(seatInputs);
    harness.localUserCount.value = 1;

    await harness.provider.assertSeatAvailableForNewUser();
    await harness.provider.assertSeatAvailableForNewUser();

    expect(harness.localUserCount.calls).toBe(2);
    expect(harness.loads.count).toBe(1);
  });
});
