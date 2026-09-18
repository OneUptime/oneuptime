import EnterpriseLicenseSeatUtil from "../../../Server/License/EnterpriseLicenseSeatUtil";
import { LicenseInputs } from "../../../Server/License/LicenseInputs";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseStatus,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import { SeatUsage } from "Common/Utils/EnterpriseLicense/EnterpriseLicenseSeats";
import {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The half of seat enforcement that decides whether this installation
 * enforces at all, and reads the license state it enforces against.
 *
 * Four things have to hold, and each of them is a way the feature could be
 * quietly wrong rather than loudly broken:
 *
 *   1. It runs on a self-hosted Enterprise installation whose license is valid
 *      or in grace, and nowhere else. oneuptime.com bounds seats through
 *      subscriptions, and an expired or missing license stops limiting seats
 *      rather than locking a customer out of adding people.
 *   2. The limit is the license's: snapshot.userLimit (the signed claim for a
 *      verified license), never a column a master admin could once overwrite.
 *   3. It never counts the User table when there is no limit to compare it
 *      against. That query runs on the create path of every user.
 *   4. It does not exempt root. Team invitations create the invited user with
 *      isRoot: true, so an isRoot exemption would exempt invitations — the one
 *      path this was asked for. (There is no props argument at all.)
 */

// CI's config.env sets BILLING_ENABLED=true; this suite pins it per test.
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

const INSTANCE_ID: string = ObjectID.generate().toString();

type MakeInputsFunction = (overrides?: Partial<LicenseInputs>) => LicenseInputs;

const makeInputs: MakeInputsFunction = (
  overrides?: Partial<LicenseInputs>,
): LicenseInputs => {
  return {
    hasConfigRow: true,
    licenseKey: "acme-license-key",
    token: "stored.license.token",
    storedColumns: {},
    instanceId: INSTANCE_ID,
    currentUserCount: 4,
    instances: [],
    ...(overrides || {}),
  };
};

const withLimit: (userLimit: number | null) => EnterpriseLicenseSnapshot = (
  userLimit: number | null,
): EnterpriseLicenseSnapshot => {
  return createLicenseSnapshot({ userLimit });
};

type LocalCount = { calls: number; fn: () => Promise<number> };

const localCount: (value: number) => LocalCount = (
  value: number,
): LocalCount => {
  const counter: LocalCount = {
    calls: 0,
    fn: async (): Promise<number> => {
      counter.calls++;
      return value;
    },
  };

  return counter;
};

beforeEach(() => {
  setTestBillingEnabled(false);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("EnterpriseLicenseSeatUtil - which installations enforce", () => {
  it("enforces on a self-hosted installation with a valid license", () => {
    expect(
      EnterpriseLicenseSeatUtil.isSeatLimitEnforceable(withLimit(10)),
    ).toBe(true);
  });

  /*
   * oneuptime.com runs with billing on and bounds seats per project through
   * subscriptions (TeamMemberService.onBeforeCreate). Enforcing an enterprise
   * license limit there as well would be a second answer to the same question.
   */
  it("does not enforce where billing is doing the bounding", () => {
    setTestBillingEnabled(true);

    expect(
      EnterpriseLicenseSeatUtil.isSeatLimitEnforceable(withLimit(10)),
    ).toBe(false);
  });

  it("does not enforce before the license could be read at all", () => {
    expect(EnterpriseLicenseSeatUtil.isSeatLimitEnforceable(null)).toBe(false);
  });

  /*
   * The design's seat rows: billing on/off × license status. Only valid and
   * grace limit seats, and only with billing off.
   */
  const MATRIX: Array<[boolean, EnterpriseLicenseStatus, boolean]> = [
    [false, "valid", true],
    [false, "grace", true],
    [false, "expired", false],
    [false, "missing", false],
    [false, "invalid", false],
    [true, "valid", false],
    [true, "grace", false],
    [true, "expired", false],
    [true, "missing", false],
    [true, "invalid", false],
  ];

  it.each(MATRIX)(
    "billing=%s, license %s: enforces=%s",
    async (
      billing: boolean,
      status: EnterpriseLicenseStatus,
      enforces: boolean,
    ) => {
      setTestBillingEnabled(billing);

      const snapshot: EnterpriseLicenseSnapshot =
        createLicenseSnapshotWithStatus(status, { userLimit: 10 });
      const counter: LocalCount = localCount(10);

      expect(EnterpriseLicenseSeatUtil.isSeatLimitEnforceable(snapshot)).toBe(
        enforces,
      );

      const assertion: Promise<void> =
        EnterpriseLicenseSeatUtil.assertSeatAvailableForNewUser({
          inputs: makeInputs(),
          snapshot,
          getLocalUserCount: counter.fn,
        });

      if (enforces) {
        await expect(assertion).rejects.toBeInstanceOf(BadDataException);
      } else {
        await expect(assertion).resolves.toBeUndefined();
        // An installation that does not enforce never counts its users.
        expect(counter.calls).toBe(0);
      }
    },
  );

  it.each([
    ["billing enabled", true, "valid"],
    ["an expired license", false, "expired"],
    ["no license", false, "missing"],
  ] as Array<[string, boolean, EnterpriseLicenseStatus]>)(
    "returns no seat usage at all with %s, and never counts users",
    async (
      _label: string,
      billing: boolean,
      status: EnterpriseLicenseStatus,
    ) => {
      setTestBillingEnabled(billing);
      const counter: LocalCount = localCount(10);

      const usage: SeatUsage | null =
        await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
          inputs: makeInputs(),
          snapshot: createLicenseSnapshotWithStatus(status, { userLimit: 10 }),
          getLocalUserCount: counter.fn,
        });

      expect(usage).toBeNull();
      expect(counter.calls).toBe(0);
    },
  );
});

describe("EnterpriseLicenseSeatUtil - reading the licence", () => {
  it("combines the license's limit with the live user count", async () => {
    const counter: LocalCount = localCount(9);

    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs: makeInputs(),
        snapshot: withLimit(10),
        getLocalUserCount: counter.fn,
      });

    expect(seatUsage?.isEnforced).toBe(true);
    expect(seatUsage?.userLimit).toBe(10);
    expect(seatUsage?.seatsInUse).toBe(9);
    expect(seatUsage?.hasSeatForNewUser).toBe(true);
  });

  /*
   * A verified license's limit is its signed claim. The stored column is a
   * mirror; here it says 999 and must not win.
   */
  it("takes the limit from the license snapshot, not the stored column", async () => {
    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs: makeInputs({ storedColumns: { userLimit: 999 } }),
        snapshot: withLimit(10),
        getLocalUserCount: localCount(10).fn,
      });

    expect(seatUsage?.userLimit).toBe(10);
    expect(seatUsage?.hasSeatForNewUser).toBe(false);
  });

  /*
   * Counting the User table on a licence that has no limit would be a query
   * per user creation bought for nothing — and an unlimited licence is exactly
   * the kind a large installation holds.
   */
  it("does not count users when the licence has no seat limit", async () => {
    const counter: LocalCount = localCount(4);

    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs: makeInputs(),
        snapshot: withLimit(null),
        getLocalUserCount: counter.fn,
      });

    expect(seatUsage?.isEnforced).toBe(false);
    expect(seatUsage?.hasSeatForNewUser).toBe(true);
    expect(counter.calls).toBe(0);
  });

  it("counts users exactly once when the licence does have a limit", async () => {
    const counter: LocalCount = localCount(4);

    await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
      inputs: makeInputs(),
      snapshot: withLimit(10),
      getLocalUserCount: counter.fn,
    });

    expect(counter.calls).toBe(1);
  });

  /*
   * An unlicensed installation inside its first-seen grace has no seat limit
   * (there is no license to carry one), so nothing is refused.
   */
  it("enforces nothing during the unlicensed grace period", async () => {
    const counter: LocalCount = localCount(10_000);

    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs: makeInputs({ token: null, licenseKey: null }),
        snapshot: {
          status: "grace",
          verification: "none",
          graceReason: "unlicensed",
          userLimit: null,
          isEvaluation: false,
          features: "all",
        },
        getLocalUserCount: counter.fn,
      });

    expect(seatUsage?.isEnforced).toBe(false);
    expect(counter.calls).toBe(0);
  });

  it("attributes the licence-wide overflow to the customer's other instances", async () => {
    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs: makeInputs({
          currentUserCount: 80,
          instances: [
            {
              instanceId: INSTANCE_ID,
              host: "prod.acme.internal",
              userCount: 60,
              lastReportedAt: "2026-01-01T00:00:00.000Z",
              version: "12.0.30",
            },
            {
              instanceId: "another-instance",
              host: "staging.acme.internal",
              userCount: 30,
              lastReportedAt: "2026-01-01T00:00:00.000Z",
              version: "12.0.30",
            },
          ],
        }),
        snapshot: withLimit(100),
        getLocalUserCount: localCount(60).fn,
      });

    expect(seatUsage?.seatsUsedByOtherInstances).toBe(20);
    expect(seatUsage?.seatsInUse).toBe(80);
  });

  it("survives an instance list stored as something other than an array", async () => {
    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs: makeInputs({
          instances: "not-an-array" as unknown as LicenseInputs["instances"],
        }),
        snapshot: withLimit(10),
        getLocalUserCount: localCount(4).fn,
      });

    expect(seatUsage?.seatsUsedByOtherInstances).toBe(0);
    expect(seatUsage?.isEnforced).toBe(true);
  });

  it("treats a zero limit as no limit, as every other seat reader does", async () => {
    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs: makeInputs(),
        snapshot: withLimit(0),
        getLocalUserCount: localCount(4).fn,
      });

    expect(seatUsage?.isEnforced).toBe(false);
  });
});

describe("EnterpriseLicenseSeatUtil - refusing a new user", () => {
  type AssertFunction = (
    localUserCount: number,
    overrides?: {
      inputs?: LicenseInputs;
      snapshot?: EnterpriseLicenseSnapshot;
    },
  ) => Promise<void>;

  const assertSeat: AssertFunction = (
    localUserCount: number,
    overrides?: {
      inputs?: LicenseInputs;
      snapshot?: EnterpriseLicenseSnapshot;
    },
  ): Promise<void> => {
    return EnterpriseLicenseSeatUtil.assertSeatAvailableForNewUser({
      inputs: overrides?.inputs || makeInputs(),
      snapshot: overrides?.snapshot || withLimit(10),
      getLocalUserCount: localCount(localUserCount).fn,
    });
  };

  it("allows a user while seats are free", async () => {
    await expect(assertSeat(9)).resolves.toBeUndefined();
  });

  it("refuses the user that would step past the limit", async () => {
    await expect(assertSeat(10)).rejects.toBeInstanceOf(BadDataException);
  });

  it("explains the refusal in terms the administrator can act on", async () => {
    let message: string = "";

    try {
      await assertSeat(10);
    } catch (err) {
      message = (err as BadDataException).message;
    }

    expect(message).toContain("10");
    expect(message).toContain("enterprise license");
    expect(message).toContain("sales@oneuptime.com");
  });

  it("keeps refusing once the installation is already over the limit", async () => {
    await expect(assertSeat(40)).rejects.toBeInstanceOf(BadDataException);
  });

  it("allows everything on a licence with no seat limit", async () => {
    await expect(
      assertSeat(100_000, { snapshot: withLimit(null) }),
    ).resolves.toBeUndefined();
  });

  it("allows everything where billing does the bounding", async () => {
    setTestBillingEnabled(true);

    await expect(assertSeat(100_000)).resolves.toBeUndefined();
  });

  /*
   * Soft enforcement: once a license has expired past its grace period, the
   * seat limit it carried stops applying. Enterprise configuration becomes
   * read-only instead; adding people is never what breaks.
   */
  it("allows everything once the license has expired past its grace period", async () => {
    await expect(
      assertSeat(100_000, {
        snapshot: createLicenseSnapshotWithStatus("expired", { userLimit: 10 }),
      }),
    ).resolves.toBeUndefined();
  });

  it("still refuses during the grace period of an expired license", async () => {
    await expect(
      assertSeat(10, {
        snapshot: createLicenseSnapshotWithStatus("grace", { userLimit: 10 }),
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  /*
   * The seats already spoken for on the customer's other instances count
   * against this one. Otherwise two instances on a 10-seat licence would each
   * happily fill up to 10.
   */
  it("refuses when the licence is full because of another instance", async () => {
    await expect(
      assertSeat(2, {
        inputs: makeInputs({
          currentUserCount: 10,
          instances: [
            {
              instanceId: INSTANCE_ID,
              host: "prod.acme.internal",
              userCount: 2,
              lastReportedAt: "2026-01-01T00:00:00.000Z",
              version: "12.0.30",
            },
            {
              instanceId: "another-instance",
              host: "staging.acme.internal",
              userCount: 8,
              lastReportedAt: "2026-01-01T00:00:00.000Z",
              version: "12.0.30",
            },
          ],
        }),
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("EnterpriseLicenseSeatUtil - usage for a known count", () => {
  it("agrees with the async entry point", async () => {
    const inputs: LicenseInputs = makeInputs();
    const snapshot: EnterpriseLicenseSnapshot = withLimit(10);

    const direct: SeatUsage = EnterpriseLicenseSeatUtil.getSeatUsageFromLicense(
      {
        inputs,
        snapshot,
        localUserCount: 10,
      },
    );
    const viaCount: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs,
        snapshot,
        getLocalUserCount: localCount(10).fn,
      });

    expect(viaCount).toEqual(direct);
    expect(direct.hasSeatForNewUser).toBe(false);
    expect(direct.seatsRemaining).toBe(0);
  });

  it("handles a null snapshot the same way as a licence with no limit", () => {
    const usage: SeatUsage = EnterpriseLicenseSeatUtil.getSeatUsageFromLicense({
      inputs: makeInputs(),
      snapshot: null,
      localUserCount: 10,
    });

    expect(usage.isEnforced).toBe(false);
    expect(usage.hasSeatForNewUser).toBe(true);
  });
});
