import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../Server/Enterprise/EnterpriseFeature";
import {
  EnterpriseLicenseFeatures,
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseStatus,
  SeatUsage,
} from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import logger from "../../../Server/Utils/Logger";
import FakeEnterpriseModule, {
  createAuditLogRecorderSpy,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  MockedAuditLogRecorder,
  uninstallEnterpriseModule,
} from "./FakeEnterpriseModule";
import { isTestBillingEnabled, setTestBillingEnabled } from "./TestBillingFlag";

/*
 * Billing is pinned through the mocked EnvironmentConfig below, never read from
 * the process environment: CI's config.env sets BILLING_ENABLED=true, so an
 * unpinned suite would only ever test the SaaS path there.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("./TestBillingFlag") = jest.requireActual(
    "./TestBillingFlag",
  ) as typeof import("./TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

// Imports inside Server/EnvironmentConfig.ts or BillingConfig.ts that reach Enterprise/.
const ENTERPRISE_IMPORT_PATTERN: RegExp = /from\s+["'][^"']*Enterprise\//;
const ENTERPRISE_REQUIRE_PATTERN: RegExp = /require\(\s*["'][^"']*Enterprise\//;

const ALL_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "missing",
  "valid",
  "grace",
  "expired",
  "invalid",
];

type Entitlement = "all" | "includes" | "excludes" | "empty";

const ALL_ENTITLEMENTS: ReadonlyArray<Entitlement> = [
  "all",
  "includes",
  "excludes",
  "empty",
];

type Mode = "sync" | "async";

const ALL_MODES: ReadonlyArray<Mode> = ["sync", "async"];

const featuresFor: (
  entitlement: Entitlement,
  feature: EnterpriseFeature,
) => EnterpriseLicenseFeatures = (
  entitlement: Entitlement,
  feature: EnterpriseFeature,
): EnterpriseLicenseFeatures => {
  switch (entitlement) {
    case "all":
      return "all";
    case "includes":
      return [feature, EnterpriseFeature.InstanceHealth].filter(
        (
          value: EnterpriseFeature,
          index: number,
          all: Array<EnterpriseFeature>,
        ): boolean => {
          return all.indexOf(value) === index;
        },
      );
    case "excludes":
      return ALL_ENTERPRISE_FEATURES.filter(
        (value: EnterpriseFeature): boolean => {
          return value !== feature;
        },
      );
    case "empty":
    default:
      return [];
  }
};

const checkAvailability: (
  mode: Mode,
  feature: EnterpriseFeature,
) => Promise<boolean> = async (
  mode: Mode,
  feature: EnterpriseFeature,
): Promise<boolean> => {
  if (mode === "sync") {
    return EnterpriseEdition.isFeatureAvailableSync(feature);
  }

  return await EnterpriseEdition.isFeatureAvailable(feature);
};

const assertAvailability: (
  mode: Mode,
  feature: EnterpriseFeature,
) => Promise<void> = async (
  mode: Mode,
  feature: EnterpriseFeature,
): Promise<void> => {
  if (mode === "sync") {
    EnterpriseEdition.assertFeatureAvailableSync(feature);
    return;
  }

  await EnterpriseEdition.assertFeatureAvailable(feature);
};

const captureError: (fn: () => Promise<void>) => Promise<unknown> = async (
  fn: () => Promise<void>,
): Promise<unknown> => {
  try {
    await fn();
  } catch (err) {
    return err;
  }

  return undefined;
};

beforeAll(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterAll(() => {
  jest.restoreAllMocks();
  uninstallEnterpriseModule();
});

beforeEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

describe("EnterpriseEdition registration", () => {
  test("starts on the Community Edition with nothing registered", () => {
    expect(EnterpriseEdition.isLoaded()).toBe(false);
    expect(EnterpriseEdition.getModule()).toBeNull();
  });

  test("register makes the module the loaded one", () => {
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();

    EnterpriseEdition.register(fake);

    expect(EnterpriseEdition.isLoaded()).toBe(true);
    expect(EnterpriseEdition.getModule()).toBe(fake);
  });

  test("a second registration throws and keeps the first module", () => {
    const first: FakeEnterpriseModule = new FakeEnterpriseModule();
    const second: FakeEnterpriseModule = new FakeEnterpriseModule();

    EnterpriseEdition.register(first);

    expect(() => {
      EnterpriseEdition.register(second);
    }).toThrow("already registered");
    expect(EnterpriseEdition.getModule()).toBe(first);
  });

  test("registering the same module twice also throws", () => {
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();

    EnterpriseEdition.register(fake);

    expect(() => {
      EnterpriseEdition.register(fake);
    }).toThrow("already registered");
  });

  test("registering nothing throws and leaves the edition unloaded", () => {
    expect(() => {
      EnterpriseEdition.register(
        null as unknown as Parameters<typeof EnterpriseEdition.register>[0],
      );
    }).toThrow("needs a module");
    expect(EnterpriseEdition.isLoaded()).toBe(false);
  });

  test("resetForTests forgets the module so a new one can be registered", () => {
    const first: FakeEnterpriseModule = new FakeEnterpriseModule();
    const second: FakeEnterpriseModule = new FakeEnterpriseModule();

    EnterpriseEdition.register(first);
    EnterpriseEdition.resetForTests();

    expect(EnterpriseEdition.isLoaded()).toBe(false);
    expect(EnterpriseEdition.getModule()).toBeNull();

    EnterpriseEdition.register(second);
    expect(EnterpriseEdition.getModule()).toBe(second);
  });

  test("the kit's install/uninstall helpers flip the edition", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    expect(EnterpriseEdition.getModule()).toBe(fake);

    const replacement: FakeEnterpriseModule = installFakeEnterpriseModule();
    expect(EnterpriseEdition.getModule()).toBe(replacement);

    uninstallEnterpriseModule();
    expect(EnterpriseEdition.isLoaded()).toBe(false);
  });
});

/*
 * The full availability matrix: billing x loaded x license status x feature
 * entitlement, each checked for every feature both sync and async. The
 * expectation is written as the three rules from the design, independently of
 * the implementation:
 *   - not loaded          -> never available
 *   - loaded, billing on  -> always available (plan gates apply elsewhere)
 *   - loaded, billing off -> status valid or grace AND the feature is entitled
 */
interface MatrixCase {
  billing: boolean;
  loaded: boolean;
  status: EnterpriseLicenseStatus;
  entitlement: Entitlement;
  expected: boolean;
}

const USABLE_STATUSES: ReadonlySet<EnterpriseLicenseStatus> =
  new Set<EnterpriseLicenseStatus>(["valid", "grace"]);

const ENTITLING: ReadonlySet<Entitlement> = new Set<Entitlement>([
  "all",
  "includes",
]);

const matrix: Array<MatrixCase> = [];

for (const billing of [false, true]) {
  for (const loaded of [false, true]) {
    for (const status of ALL_STATUSES) {
      for (const entitlement of ALL_ENTITLEMENTS) {
        let expected: boolean = false;

        if (loaded && billing) {
          expected = true;
        } else if (loaded) {
          expected = USABLE_STATUSES.has(status) && ENTITLING.has(entitlement);
        }

        matrix.push({ billing, loaded, status, entitlement, expected });
      }
    }
  }
}

describe("EnterpriseEdition feature availability matrix", () => {
  test("the matrix covers every combination", () => {
    expect(matrix.length).toBe(
      2 * 2 * ALL_STATUSES.length * ALL_ENTITLEMENTS.length,
    );
    expect(
      matrix.filter((testCase: MatrixCase) => {
        return testCase.expected;
      }).length,
    ).toBeGreaterThan(0);
    expect(
      matrix.filter((testCase: MatrixCase) => {
        return !testCase.expected;
      }).length,
    ).toBeGreaterThan(0);
  });

  test.each(matrix)(
    "billing=$billing loaded=$loaded status=$status entitlement=$entitlement -> $expected",
    async (testCase: MatrixCase) => {
      setTestBillingEnabled(testCase.billing);

      for (const feature of ALL_ENTERPRISE_FEATURES) {
        if (testCase.loaded) {
          installFakeEnterpriseModule({
            snapshot: createLicenseSnapshotWithStatus(testCase.status, {
              features: featuresFor(testCase.entitlement, feature),
            }),
          });
        } else {
          uninstallEnterpriseModule();
        }

        for (const mode of ALL_MODES) {
          const context: string = `${feature} ${mode}`;

          expect(`${context}: ${await checkAvailability(mode, feature)}`).toBe(
            `${context}: ${testCase.expected}`,
          );

          const error: unknown = await captureError(async () => {
            await assertAvailability(mode, feature);
          });

          if (testCase.expected) {
            expect(error).toBeUndefined();
            continue;
          }

          expect(error).toBeInstanceOf(PaymentRequiredException);
          expect(
            `${context}: ${(error as PaymentRequiredException).message}`,
          ).toBe(
            `${context}: ${
              testCase.loaded
                ? EnterpriseEdition.LICENSE_REQUIRED_MESSAGE
                : EnterpriseEdition.COMMUNITY_EDITION_MESSAGE
            }`,
          );
        }
      }
    },
  );
});

describe("EnterpriseEdition fails closed on an unknown license", () => {
  test("sync: a null cached snapshot (first load not finished) is not available", () => {
    installFakeEnterpriseModule({ snapshot: null });

    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO),
    ).toBe(false);
    expect(() => {
      EnterpriseEdition.assertFeatureAvailableSync(EnterpriseFeature.SSO);
    }).toThrow(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE);
  });

  test("sync: a throwing cached-snapshot read is not available", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    fake.licensing.getCachedSnapshotError = new Error("cache exploded");

    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.AuditLogs),
    ).toBe(false);
  });

  test("async: a failing load with no cached snapshot is not available", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: null,
    });
    fake.licensing.getSnapshotError = new Error("database unreachable");

    expect(
      await EnterpriseEdition.isFeatureAvailable(EnterpriseFeature.SCIM),
    ).toBe(false);
  });

  test("async: a failing load falls back to the last good cached snapshot", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot(),
    });
    fake.licensing.getSnapshotError = new Error("database unreachable");

    expect(
      await EnterpriseEdition.isFeatureAvailable(EnterpriseFeature.SCIM),
    ).toBe(true);
  });

  test("async: a failing load and a throwing cache is not available", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    fake.licensing.getSnapshotError = new Error("database unreachable");
    fake.licensing.getCachedSnapshotError = new Error("cache exploded");

    expect(
      await EnterpriseEdition.isFeatureAvailable(
        EnterpriseFeature.TeamCompliance,
      ),
    ).toBe(false);
    expect(await EnterpriseEdition.getLicenseSnapshot()).toBeNull();
  });

  test("async prefers the fresh snapshot over the cached one", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
      asyncSnapshot: createLicenseSnapshot(),
    });

    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO),
    ).toBe(false);
    expect(
      await EnterpriseEdition.isFeatureAvailable(EnterpriseFeature.SSO),
    ).toBe(true);
  });

  test("a snapshot with a malformed features value entitles nothing", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: "everything" as unknown as EnterpriseLicenseFeatures,
      }),
    });

    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO),
    ).toBe(false);
  });

  test("billing on does not need a license at all (SaaS: plan gates apply instead)", async () => {
    setTestBillingEnabled(true);
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: null,
    });
    fake.licensing.getSnapshotError = new Error("never asked");

    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO),
    ).toBe(true);
    expect(
      await EnterpriseEdition.isFeatureAvailable(EnterpriseFeature.SSO),
    ).toBe(true);
  });
});

describe("EnterpriseEdition reads billing at call time", () => {
  test("flipping the billing flag changes the answer without a reload", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    setTestBillingEnabled(false);
    expect(isTestBillingEnabled()).toBe(false);
    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO),
    ).toBe(false);

    setTestBillingEnabled(true);
    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO),
    ).toBe(true);

    setTestBillingEnabled(false);
    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO),
    ).toBe(false);
  });

  test("EnvironmentConfig never imports the enterprise facade (no import cycle)", () => {
    const serverDirectory: string = path.join(__dirname, "../../../Server");

    for (const fileName of ["EnvironmentConfig.ts", "BillingConfig.ts"]) {
      const source: string = fs.readFileSync(
        path.join(serverDirectory, fileName),
        "utf8",
      );

      expect(source).not.toMatch(ENTERPRISE_IMPORT_PATTERN);
      expect(source).not.toMatch(ENTERPRISE_REQUIRE_PATTERN);
    }
  });
});

describe("EnterpriseEdition unavailable messages", () => {
  test("the Community Edition and the unlicensed Enterprise Edition say different things", () => {
    expect(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE).not.toBe(
      EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
    );
    expect(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE).toContain(
      "Community Edition",
    );
    expect(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE).toContain(
      "Enterprise Edition image",
    );
    expect(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE).toContain("license");
    expect(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE).not.toContain(
      "Community Edition",
    );
  });

  test("the license message points at the edition label, the only place a license is activated", () => {
    /*
     * The Admin Dashboard has no "Settings > License" page. Licenses are
     * activated from the edition label in its header (the dialog the
     * GlobalConfig license-column guard also names).
     */
    expect(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE).toContain(
      "edition label in the Admin Dashboard header",
    );
    expect(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE).not.toMatch(
      /Settings\s*(?:>|→|->)\s*License/i,
    );
  });

  test("the Community Edition message is used on CE even with billing on", async () => {
    setTestBillingEnabled(true);

    await expect(
      EnterpriseEdition.assertFeatureAvailable(EnterpriseFeature.AuditLogs),
    ).rejects.toThrow(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE);
    expect(() => {
      EnterpriseEdition.assertFeatureAvailableSync(EnterpriseFeature.AuditLogs);
    }).toThrow(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE);
  });

  test.each([
    "missing",
    "expired",
    "invalid",
  ] as Array<EnterpriseLicenseStatus>)(
    "an Enterprise install whose license is %s gets the license message",
    async (status: EnterpriseLicenseStatus) => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus(status),
      });

      await expect(
        EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        ),
      ).rejects.toThrow(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE);
    },
  );

  test("a valid license that does not include the feature gets the license message", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: [EnterpriseFeature.SSO] }),
    });

    expect(() => {
      EnterpriseEdition.assertFeatureAvailableSync(EnterpriseFeature.SCIM);
    }).toThrow(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE);
    expect(() => {
      EnterpriseEdition.assertFeatureAvailableSync(EnterpriseFeature.SSO);
    }).not.toThrow();
  });

  test("the thrown exception is a PaymentRequiredException (HTTP 402)", () => {
    let caught: unknown = undefined;

    try {
      EnterpriseEdition.assertFeatureAvailableSync(EnterpriseFeature.SSO);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PaymentRequiredException);
  });
});

describe("EnterpriseEdition license snapshot and seats", () => {
  test("the Community Edition has no license snapshot", async () => {
    expect(await EnterpriseEdition.getLicenseSnapshot()).toBeNull();
  });

  test("the Enterprise Edition returns the provider's snapshot", async () => {
    const snapshot: EnterpriseLicenseSnapshot =
      createLicenseSnapshotWithStatus("grace");
    installFakeEnterpriseModule({ snapshot });

    expect(await EnterpriseEdition.getLicenseSnapshot()).toBe(snapshot);
  });

  test("the Community Edition has no seat usage", async () => {
    expect(await EnterpriseEdition.getSeatUsage()).toBeNull();
  });

  test("the Enterprise Edition returns the provider's seat usage", async () => {
    const seatUsage: SeatUsage = {
      isEnforced: true,
      userLimit: 10,
      seatsInUse: 4,
      seatsRemaining: 6,
      hasSeatForNewUser: true,
      seatsUsedByOtherInstances: 0,
    };
    installFakeEnterpriseModule({ seatUsage });

    expect(await EnterpriseEdition.getSeatUsage()).toEqual(seatUsage);
  });

  test("a failing seat-usage read returns null instead of throwing", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    fake.licensing.getSeatUsage = async (): Promise<SeatUsage | null> => {
      throw new Error("count failed");
    };

    expect(await EnterpriseEdition.getSeatUsage()).toBeNull();
  });

  test("the Community Edition never refuses a new user for seats", async () => {
    await expect(
      EnterpriseEdition.assertSeatAvailableForNewUser(),
    ).resolves.toBeUndefined();
  });

  test("the Enterprise Edition asks the provider, and its refusal propagates", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      seatError: new PaymentRequiredException("No seats left."),
    });

    await expect(
      EnterpriseEdition.assertSeatAvailableForNewUser(),
    ).rejects.toThrow("No seats left.");
    expect(fake.licensing.seatChecks).toBe(1);
  });

  test("the Enterprise Edition allows the new user when the provider does", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    await expect(
      EnterpriseEdition.assertSeatAvailableForNewUser(),
    ).resolves.toBeUndefined();
    expect(fake.licensing.seatChecks).toBe(1);
  });
});

describe("EnterpriseEdition audit log recorder", () => {
  test("the Community Edition records nothing", () => {
    expect(EnterpriseEdition.getAuditLogRecorder()).toBeNull();
  });

  test("the Enterprise Edition hands out the module's recorder", () => {
    const recorder: MockedAuditLogRecorder = createAuditLogRecorderSpy();
    installFakeEnterpriseModule({ auditLogRecorder: recorder });

    expect(EnterpriseEdition.getAuditLogRecorder()).toBe(recorder);
  });

  test("the recorder is handed out whatever the license says (it decides per entry whether to record)", () => {
    const recorder: MockedAuditLogRecorder = createAuditLogRecorderSpy();
    installFakeEnterpriseModule({
      auditLogRecorder: recorder,
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    /*
     * Handing it out keeps invalidateProjectSettings working while the license
     * is lapsed. Whether an entry is recorded is the recorder's own
     * isFeatureActive(AuditLogs) check (ee/Tests/Server/AuditLog/
     * AuditLogRecorder.test.ts pins that it records nothing while lapsed).
     */
    expect(EnterpriseEdition.getAuditLogRecorder()).toBe(recorder);
  });

  test("a module without a recorder yields null", () => {
    installFakeEnterpriseModule({ auditLogRecorder: null });

    expect(EnterpriseEdition.getAuditLogRecorder()).toBeNull();
  });

  test("a module whose recorder getter throws yields null", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    fake.getAuditLogRecorder = (): never => {
      throw new Error("recorder failed");
    };

    expect(EnterpriseEdition.getAuditLogRecorder()).toBeNull();
  });
});

describe("EnterpriseEdition runtime state (isFeatureActive)", () => {
  /*
   * The full matrix, the unknown-state rule and the lapse log live in
   * EnterpriseFeatureActive.test.ts. The old shouldEnforceSso() ("enforce SSO
   * whenever ee is loaded, whatever the license says") is gone on purpose:
   * SSO enforcement now follows isFeatureActive(SSO), so it relaxes when the
   * license lapses.
   */
  test("shouldEnforceSso no longer exists", () => {
    expect(
      (EnterpriseEdition as unknown as Record<string, unknown>)[
        "shouldEnforceSso"
      ],
    ).toBeUndefined();
  });

  test.each(ALL_STATUSES)(
    "billing off, %s license: SSO is active exactly when the license entitles it",
    (status: EnterpriseLicenseStatus) => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus(status),
      });

      expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(
        status === "valid" || status === "grace",
      );
    },
  );
});

describe("EnterpriseEdition model to feature map", () => {
  test.each([
    ["GlobalSSO", EnterpriseFeature.SSO],
    ["GlobalOIDC", EnterpriseFeature.SSO],
    ["GlobalSSOProject", EnterpriseFeature.SSO],
    ["GlobalOIDCProject", EnterpriseFeature.SSO],
    ["ProjectSSO", EnterpriseFeature.SSO],
    ["ProjectOIDC", EnterpriseFeature.SSO],
    ["StatusPageSSO", EnterpriseFeature.SSO],
    ["StatusPageOIDC", EnterpriseFeature.SSO],
    ["ProjectSCIM", EnterpriseFeature.SCIM],
    ["StatusPageSCIM", EnterpriseFeature.SCIM],
    ["TeamComplianceSetting", EnterpriseFeature.TeamCompliance],
  ] as Array<[string, EnterpriseFeature]>)(
    "table %s is gated by %s",
    (tableName: string, feature: EnterpriseFeature) => {
      expect(EnterpriseEdition.getFeatureForTableName(tableName)).toBe(feature);
    },
  );

  test("maps exactly the eleven enterprise configuration tables", () => {
    expect(EnterpriseEdition.getMappedTableNames().sort()).toEqual(
      [
        "GlobalOIDC",
        "GlobalOIDCProject",
        "GlobalSSO",
        "GlobalSSOProject",
        "ProjectOIDC",
        "ProjectSCIM",
        "ProjectSSO",
        "StatusPageOIDC",
        "StatusPageSCIM",
        "StatusPageSSO",
        "TeamComplianceSetting",
      ].sort(),
    );
  });

  test("unknown, empty and missing table names map to nothing", () => {
    expect(EnterpriseEdition.getFeatureForTableName("Monitor")).toBeNull();
    expect(EnterpriseEdition.getFeatureForTableName("")).toBeNull();
    expect(EnterpriseEdition.getFeatureForTableName(null)).toBeNull();
    expect(EnterpriseEdition.getFeatureForTableName(undefined)).toBeNull();
    expect(EnterpriseEdition.getFeatureForTableName("globalsso")).toBeNull();
  });

  test("getModelFeature reads the table name off a model instance", () => {
    class FakeSsoModel {
      public tableName: string | null = "ProjectSSO";
    }
    class FakePlainModel {
      public tableName: string | null = "Incident";
    }
    class FakeUnnamedModel {
      public tableName: string | null = null;
    }

    type ModelTypeArgument = Parameters<
      typeof EnterpriseEdition.getModelFeature
    >[0];

    expect(
      EnterpriseEdition.getModelFeature(
        FakeSsoModel as unknown as ModelTypeArgument,
      ),
    ).toBe(EnterpriseFeature.SSO);
    expect(
      EnterpriseEdition.getModelFeature(
        FakePlainModel as unknown as ModelTypeArgument,
      ),
    ).toBeNull();
    expect(
      EnterpriseEdition.getModelFeature(
        FakeUnnamedModel as unknown as ModelTypeArgument,
      ),
    ).toBeNull();
  });

  test("getModelFeature returns null when the model cannot be constructed", () => {
    class ExplodingModel {
      public constructor() {
        throw new Error("boom");
      }
    }

    expect(
      EnterpriseEdition.getModelFeature(
        ExplodingModel as unknown as Parameters<
          typeof EnterpriseEdition.getModelFeature
        >[0],
      ),
    ).toBeNull();
  });
});
