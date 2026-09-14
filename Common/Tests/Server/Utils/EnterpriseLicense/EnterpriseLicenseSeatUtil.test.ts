import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import EnterpriseLicenseSeatUtil from "../../../../Server/Utils/EnterpriseLicense/EnterpriseLicenseSeatUtil";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { SeatUsage } from "../../../../Utils/EnterpriseLicense/EnterpriseLicenseSeats";
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The half of seat enforcement that decides whether this installation
 * enforces at all, and reads the license state it enforces against.
 *
 * Three things have to hold, and each of them is a way the feature could be
 * quietly wrong rather than loudly broken:
 *
 *   1. It runs on self-hosted Enterprise and nowhere else. oneuptime.com bounds
 *      seats through subscriptions, and Community Edition has no license — a
 *      second, different answer on either of those would be a regression that
 *      nobody notices until a customer cannot sign up.
 *   2. It never counts the User table when there is no limit to compare it
 *      against. That query runs on the create path of every user on the
 *      installation.
 *   3. It does not exempt root. Team invitations create the invited user with
 *      isRoot: true, so an isRoot exemption would exempt invitations — the one
 *      path this was asked for.
 */

let mockBillingEnabled: boolean = false;
let mockEnterpriseEdition: boolean = true;

/*
 * Live accessors rather than plain values: the util reads these when it runs,
 * and object spread would flatten them to whatever they were at import time.
 */
jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  Object.defineProperty(mocked, "IsEnterpriseEdition", {
    get: (): boolean => {
      return mockEnterpriseEdition;
    },
  });

  return mocked;
});

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

/*
 * Both @types/jest and @jest/globals are installed, and their Mock types are
 * not assignable to each other. Taking the type from jest.fn keeps fresh mocks
 * on whichever one is actually in scope.
 */
type MockFunction = ReturnType<typeof jest.fn>;

const INSTANCE_ID: ObjectID = ObjectID.generate();

type MakeConfigFunction = (overrides?: Record<string, unknown>) => GlobalConfig;

const makeConfig: MakeConfigFunction = (
  overrides?: Record<string, unknown>,
): GlobalConfig => {
  const config: GlobalConfig = new GlobalConfig();
  config.instanceId = INSTANCE_ID;
  config.enterpriseLicenseUserLimit = 10;
  config.enterpriseLicenseCurrentUserCount = 4;
  config.enterpriseLicenseInstances = [];

  return Object.assign(config, overrides || {});
};

type SetStoredConfigFunction = (config: GlobalConfig | null) => void;

const setStoredConfig: SetStoredConfigFunction = (
  config: GlobalConfig | null,
): void => {
  (GlobalConfigService.findOneById as unknown as jest.Mock).mockResolvedValue(
    config as never,
  );
};

describe("EnterpriseLicenseSeatUtil - which installations enforce", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBillingEnabled = false;
    mockEnterpriseEdition = true;
    setStoredConfig(makeConfig());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("enforces on a self-hosted enterprise installation", () => {
    expect(EnterpriseLicenseSeatUtil.isSeatLimitEnforceable()).toBe(true);
  });

  it("does not enforce on Community Edition", () => {
    mockEnterpriseEdition = false;

    expect(EnterpriseLicenseSeatUtil.isSeatLimitEnforceable()).toBe(false);
  });

  /*
   * oneuptime.com runs with billing on and bounds seats per project through
   * subscriptions (TeamMemberService.onBeforeCreate). Enforcing an enterprise
   * license limit there as well would be a second answer to the same question.
   */
  it("does not enforce where billing is doing the bounding", () => {
    mockBillingEnabled = true;

    expect(EnterpriseLicenseSeatUtil.isSeatLimitEnforceable()).toBe(false);
  });

  it.each([
    ["Community Edition", false, false],
    ["billing enabled", true, true],
  ])(
    "returns no seat usage at all on %s, and never reads the config",
    async (
      _label: string,
      billingEnabled: boolean,
      enterpriseEdition: boolean,
    ) => {
      mockBillingEnabled = billingEnabled;
      mockEnterpriseEdition = enterpriseEdition;

      const getLocalUserCount: MockFunction = jest.fn();

      const usage: SeatUsage | null =
        await EnterpriseLicenseSeatUtil.getSeatUsage({
          getLocalUserCount:
            getLocalUserCount as unknown as () => Promise<number>,
        });

      expect(usage).toBeNull();
      expect(GlobalConfigService.findOneById).not.toHaveBeenCalled();
      expect(getLocalUserCount).not.toHaveBeenCalled();
    },
  );
});

describe("EnterpriseLicenseSeatUtil - reading the licence", () => {
  let getLocalUserCount: MockFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBillingEnabled = false;
    mockEnterpriseEdition = true;
    getLocalUserCount = jest.fn(async (): Promise<number> => {
      return 4;
    }) as unknown as MockFunction;
    setStoredConfig(makeConfig());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type UsageFunction = () => Promise<SeatUsage | null>;

  const usage: UsageFunction = (): Promise<SeatUsage | null> => {
    return EnterpriseLicenseSeatUtil.getSeatUsage({
      getLocalUserCount: getLocalUserCount as unknown as () => Promise<number>,
    });
  };

  it("reads the licence columns it needs off the singleton config row", async () => {
    await usage();

    const call: Record<string, unknown> = (
      GlobalConfigService.findOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect((call["id"] as ObjectID).toString()).toBe(
      ObjectID.getZeroObjectID().toString(),
    );
    expect(
      Object.keys(call["select"] as Record<string, unknown>).sort(),
    ).toEqual([
      "enterpriseLicenseCurrentUserCount",
      "enterpriseLicenseInstances",
      "enterpriseLicenseUserLimit",
      "instanceId",
    ]);
    expect((call["props"] as Record<string, unknown>)["isRoot"]).toBe(true);
  });

  it("combines the stored licence with the live user count", async () => {
    getLocalUserCount = jest.fn(async (): Promise<number> => {
      return 9;
    }) as unknown as MockFunction;

    const seatUsage: SeatUsage | null = await usage();

    expect(seatUsage?.isEnforced).toBe(true);
    expect(seatUsage?.userLimit).toBe(10);
    expect(seatUsage?.seatsInUse).toBe(9);
    expect(seatUsage?.hasSeatForNewUser).toBe(true);
  });

  /*
   * Counting the User table on a licence that has no limit would be a query
   * per user creation bought for nothing — and an unlimited licence is exactly
   * the kind a large installation holds.
   */
  it("does not count users when the licence has no seat limit", async () => {
    setStoredConfig(
      makeConfig({ enterpriseLicenseUserLimit: undefined } as Record<
        string,
        unknown
      >),
    );

    const seatUsage: SeatUsage | null = await usage();

    expect(seatUsage?.isEnforced).toBe(false);
    expect(seatUsage?.hasSeatForNewUser).toBe(true);
    expect(getLocalUserCount).not.toHaveBeenCalled();
  });

  it("counts users exactly once when the licence does have a limit", async () => {
    await usage();

    expect(getLocalUserCount).toHaveBeenCalledTimes(1);
  });

  /*
   * A fresh installation whose GlobalConfig row has not been seeded yet. There
   * is no licence, so there is no limit — and certainly no reason to refuse the
   * very first user.
   */
  it("enforces nothing when there is no config row at all", async () => {
    setStoredConfig(null);

    const seatUsage: SeatUsage | null = await usage();

    expect(seatUsage?.isEnforced).toBe(false);
    expect(seatUsage?.hasSeatForNewUser).toBe(true);
    expect(getLocalUserCount).not.toHaveBeenCalled();
  });

  it("attributes the licence-wide overflow to the customer's other instances", async () => {
    setStoredConfig(
      makeConfig({
        enterpriseLicenseUserLimit: 100,
        enterpriseLicenseCurrentUserCount: 80,
        enterpriseLicenseInstances: [
          {
            instanceId: INSTANCE_ID.toString(),
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
    );

    getLocalUserCount = jest.fn(async (): Promise<number> => {
      return 60;
    }) as unknown as MockFunction;

    const seatUsage: SeatUsage | null = await usage();

    expect(seatUsage?.seatsUsedByOtherInstances).toBe(20);
    expect(seatUsage?.seatsInUse).toBe(80);
  });

  it("survives an instance list stored as something other than an array", async () => {
    setStoredConfig(
      makeConfig({
        enterpriseLicenseInstances: "not-an-array",
      } as unknown as Record<string, unknown>),
    );

    const seatUsage: SeatUsage | null = await usage();

    expect(seatUsage?.seatsUsedByOtherInstances).toBe(0);
    expect(seatUsage?.isEnforced).toBe(true);
  });
});

describe("EnterpriseLicenseSeatUtil - refusing a new user", () => {
  let localUserCount: number;

  type AssertFunction = () => Promise<void>;

  const assertSeat: AssertFunction = (): Promise<void> => {
    return EnterpriseLicenseSeatUtil.assertSeatAvailableForNewUser({
      getLocalUserCount: async (): Promise<number> => {
        return localUserCount;
      },
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBillingEnabled = false;
    mockEnterpriseEdition = true;
    localUserCount = 4;
    setStoredConfig(makeConfig());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows a user while seats are free", async () => {
    localUserCount = 9;

    await expect(assertSeat()).resolves.toBeUndefined();
  });

  it("refuses the user that would step past the limit", async () => {
    localUserCount = 10;

    await expect(assertSeat()).rejects.toBeInstanceOf(BadDataException);
  });

  it("explains the refusal in terms the administrator can act on", async () => {
    localUserCount = 10;

    let message: string = "";

    try {
      await assertSeat();
    } catch (err) {
      message = (err as BadDataException).message;
    }

    expect(message).toContain("10");
    expect(message).toContain("enterprise license");
    expect(message).toContain("sales@oneuptime.com");
  });

  it("keeps refusing once the installation is already over the limit", async () => {
    localUserCount = 40;

    await expect(assertSeat()).rejects.toBeInstanceOf(BadDataException);
  });

  it("allows everything on a licence with no seat limit", async () => {
    setStoredConfig(
      makeConfig({ enterpriseLicenseUserLimit: undefined } as Record<
        string,
        unknown
      >),
    );
    localUserCount = 100_000;

    await expect(assertSeat()).resolves.toBeUndefined();
  });

  it("allows everything on Community Edition", async () => {
    mockEnterpriseEdition = false;
    localUserCount = 100_000;

    await expect(assertSeat()).resolves.toBeUndefined();
  });

  it("allows everything where billing does the bounding", async () => {
    mockBillingEnabled = true;
    localUserCount = 100_000;

    await expect(assertSeat()).resolves.toBeUndefined();
  });

  /*
   * The seats already spoken for on the customer's other instances count
   * against this one. Otherwise two instances on a 10-seat licence would each
   * happily fill up to 10.
   */
  it("refuses when the licence is full because of another instance", async () => {
    setStoredConfig(
      makeConfig({
        enterpriseLicenseUserLimit: 10,
        enterpriseLicenseCurrentUserCount: 10,
        enterpriseLicenseInstances: [
          {
            instanceId: INSTANCE_ID.toString(),
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
    );

    localUserCount = 2;

    await expect(assertSeat()).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("EnterpriseLicenseSeatUtil - usage from an already-loaded config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBillingEnabled = false;
    mockEnterpriseEdition = true;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The license endpoint has just read GlobalConfig to build its response.
   * Reading it a second time to answer the same question would be silly, so
   * there is an entry point that takes the row — and it has to agree exactly
   * with the one that loads it.
   */
  it("does not go back to the database for a config it was handed", async () => {
    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLoadedGlobalConfig({
        config: makeConfig({ enterpriseLicenseUserLimit: 10 }),
        getLocalUserCount: async (): Promise<number> => {
          return 10;
        },
      });

    expect(GlobalConfigService.findOneById).not.toHaveBeenCalled();
    expect(seatUsage?.hasSeatForNewUser).toBe(false);
    expect(seatUsage?.seatsRemaining).toBe(0);
  });

  it("returns null on an installation that does not enforce", async () => {
    mockEnterpriseEdition = false;

    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLoadedGlobalConfig({
        config: makeConfig(),
        getLocalUserCount: async (): Promise<number> => {
          return 10;
        },
      });

    expect(seatUsage).toBeNull();
  });

  it("handles a null config the same way as a licence with no limit", async () => {
    const seatUsage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLoadedGlobalConfig({
        config: null,
        getLocalUserCount: async (): Promise<number> => {
          return 10;
        },
      });

    expect(seatUsage?.isEnforced).toBe(false);
    expect(seatUsage?.hasSeatForNewUser).toBe(true);
  });
});
