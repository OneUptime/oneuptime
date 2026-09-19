import { jest } from "@jest/globals";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseStatus,
  SeatUsage,
} from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import EnterpriseServerModule, {
  AuditLogRecorder,
  ENTERPRISE_SERVER_MODULE_NAME,
  EnterpriseLicensingProvider,
} from "../../../Server/Enterprise/EnterpriseServerModule";
import type { ExpressRouter } from "../../../Server/Utils/Express";
import { setTestBillingEnabled } from "./TestBillingFlag";

/*
 * Test kit for anything that behaves differently per edition.
 *
 * Every suite that touches gated code pins BOTH halves of the state:
 *   - billing, with TestBillingFlag (CI's config.env sets BILLING_ENABLED=true)
 *   - the edition, with installFakeEnterpriseModule(...) for "EE loaded" or
 *     uninstallEnterpriseModule() for "Community Edition"
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// A current, fully entitled, verified license. Override what the test is about.
export const createLicenseSnapshot: (
  overrides?: Partial<EnterpriseLicenseSnapshot>,
) => EnterpriseLicenseSnapshot = (
  overrides?: Partial<EnterpriseLicenseSnapshot>,
): EnterpriseLicenseSnapshot => {
  return {
    status: "valid",
    verification: "verified",
    companyName: "Acme Inc",
    expiresAt: new Date(Date.now() + 365 * DAY_IN_MS),
    userLimit: null,
    isEvaluation: false,
    features: "all",
    ...(overrides || {}),
  };
};

/*
 * A snapshot in the given status, with the fields that status normally
 * carries. "missing" is an install whose trial ended a day ago (graceEndsAt
 * in the past): a known lapse. Pass graceEndsAt: undefined for "the trial
 * start is not known", which isFeatureActive treats as an unknown state.
 */
export const createLicenseSnapshotWithStatus: (
  status: EnterpriseLicenseStatus,
  overrides?: Partial<EnterpriseLicenseSnapshot>,
) => EnterpriseLicenseSnapshot = (
  status: EnterpriseLicenseStatus,
  overrides?: Partial<EnterpriseLicenseSnapshot>,
): EnterpriseLicenseSnapshot => {
  const now: number = Date.now();

  switch (status) {
    case "missing":
      return createLicenseSnapshot({
        status,
        verification: "none",
        companyName: undefined,
        expiresAt: undefined,
        graceEndsAt: new Date(now - DAY_IN_MS),
        features: [],
        ...(overrides || {}),
      });
    case "grace":
      return createLicenseSnapshot({
        status,
        graceReason: "expired",
        expiresAt: new Date(now - 2 * DAY_IN_MS),
        graceEndsAt: new Date(now + 12 * DAY_IN_MS),
        ...(overrides || {}),
      });
    case "expired":
      return createLicenseSnapshot({
        status,
        expiresAt: new Date(now - 30 * DAY_IN_MS),
        ...(overrides || {}),
      });
    case "invalid":
      return createLicenseSnapshot({
        status,
        message: "The license token signature does not verify.",
        ...(overrides || {}),
      });
    case "valid":
    default:
      return createLicenseSnapshot({ status, ...(overrides || {}) });
  }
};

/*
 * Each method is both the recorder method and a jest spy, so a test can assert
 * on calls (toHaveBeenCalledWith) without casting.
 */
export type MockedAuditLogRecorder = {
  [K in keyof AuditLogRecorder]: AuditLogRecorder[K] & jest.Mock;
};

// An audit-log recorder whose four methods are jest spies that do nothing.
export const createAuditLogRecorderSpy: () => MockedAuditLogRecorder =
  (): MockedAuditLogRecorder => {
    return {
      recordCreate: jest.fn(async (): Promise<void> => {
        return undefined;
      }) as unknown as MockedAuditLogRecorder["recordCreate"],
      recordUpdate: jest.fn(async (): Promise<void> => {
        return undefined;
      }) as unknown as MockedAuditLogRecorder["recordUpdate"],
      recordDelete: jest.fn(async (): Promise<void> => {
        return undefined;
      }) as unknown as MockedAuditLogRecorder["recordDelete"],
      invalidateProjectSettings: jest.fn((): void => {
        return undefined;
      }) as unknown as MockedAuditLogRecorder["invalidateProjectSettings"],
    };
  };

export interface FakeEnterpriseModuleOptions {
  /*
   * What getCachedSnapshot() and getSnapshot() return. Defaults to a valid,
   * fully entitled license. Null models "the first load has not finished".
   */
  snapshot?: EnterpriseLicenseSnapshot | null | undefined;
  /*
   * What getSnapshot() returns when it should differ from the cached one (for
   * example a fresher read). Defaults to `snapshot`.
   */
  asyncSnapshot?: EnterpriseLicenseSnapshot | null | undefined;
  seatUsage?: SeatUsage | null | undefined;
  // When set, assertSeatAvailableForNewUser rejects with it.
  seatError?: Error | undefined;
  identityRouters?: Array<ExpressRouter> | undefined;
  apiRouters?: Array<ExpressRouter> | undefined;
  adminHealthRouter?: ExpressRouter | null | undefined;
  // Defaults to a fresh spy recorder; pass null for "ee without a recorder".
  auditLogRecorder?: AuditLogRecorder | null | undefined;
  version?: string | undefined;
}

class FakeLicensingProvider implements EnterpriseLicensingProvider {
  public cachedSnapshot: EnterpriseLicenseSnapshot | null;
  public asyncSnapshot: EnterpriseLicenseSnapshot | null;
  public seatUsage: SeatUsage | null;
  public seatError: Error | undefined;
  public getCachedSnapshotError: Error | undefined = undefined;
  public getSnapshotError: Error | undefined = undefined;
  public refreshCount: number = 0;
  public invalidateCount: number = 0;
  public seatChecks: number = 0;

  public constructor(options: FakeEnterpriseModuleOptions) {
    this.cachedSnapshot =
      options.snapshot === undefined
        ? createLicenseSnapshot()
        : options.snapshot;
    this.asyncSnapshot =
      options.asyncSnapshot === undefined
        ? this.cachedSnapshot
        : options.asyncSnapshot;
    this.seatUsage = options.seatUsage === undefined ? null : options.seatUsage;
    this.seatError = options.seatError;
  }

  public async getSnapshot(): Promise<EnterpriseLicenseSnapshot> {
    if (this.getSnapshotError) {
      throw this.getSnapshotError;
    }

    if (!this.asyncSnapshot) {
      throw new Error("FakeLicensingProvider: no snapshot configured");
    }

    return this.asyncSnapshot;
  }

  public getCachedSnapshot(): EnterpriseLicenseSnapshot | null {
    if (this.getCachedSnapshotError) {
      throw this.getCachedSnapshotError;
    }

    return this.cachedSnapshot;
  }

  public async refresh(): Promise<void> {
    this.refreshCount++;
  }

  public invalidate(): void {
    this.invalidateCount++;
  }

  public async getSeatUsage(): Promise<SeatUsage | null> {
    return this.seatUsage;
  }

  public async assertSeatAvailableForNewUser(): Promise<void> {
    this.seatChecks++;

    if (this.seatError) {
      throw this.seatError;
    }
  }
}

export default class FakeEnterpriseModule implements EnterpriseServerModule {
  public readonly name: typeof ENTERPRISE_SERVER_MODULE_NAME =
    ENTERPRISE_SERVER_MODULE_NAME;
  public readonly version: string;
  public readonly licensing: FakeLicensingProvider;
  public identityRouters: Array<ExpressRouter>;
  public apiRouters: Array<ExpressRouter>;
  public adminHealthRouter: ExpressRouter | null;
  public auditLogRecorder: AuditLogRecorder | null;
  public initCount: number = 0;
  public registerWorkerJobsCount: number = 0;

  public constructor(options: FakeEnterpriseModuleOptions = {}) {
    this.version = options.version || "0.0.0-test";
    this.licensing = new FakeLicensingProvider(options);
    this.identityRouters = options.identityRouters || [];
    this.apiRouters = options.apiRouters || [];
    this.adminHealthRouter = options.adminHealthRouter || null;
    this.auditLogRecorder =
      options.auditLogRecorder === undefined
        ? createAuditLogRecorderSpy()
        : options.auditLogRecorder;
  }

  public async init(): Promise<void> {
    this.initCount++;
  }

  public getIdentityRouters(): Array<ExpressRouter> {
    return this.identityRouters;
  }

  public getApiRouters(): Array<ExpressRouter> {
    return this.apiRouters;
  }

  public getAdminHealthRouter(): ExpressRouter | null {
    return this.adminHealthRouter;
  }

  public async registerWorkerJobs(): Promise<void> {
    this.registerWorkerJobsCount++;
  }

  public getAuditLogRecorder(): AuditLogRecorder | null {
    return this.auditLogRecorder;
  }

  // Replaces both the cached and the async snapshot.
  public setSnapshot(snapshot: EnterpriseLicenseSnapshot | null): void {
    this.licensing.cachedSnapshot = snapshot;
    this.licensing.asyncSnapshot = snapshot;
  }
}

/*
 * "EE is loaded" with the given license state: forgets any earlier module and
 * registers a fresh fake. Returns it so the test can inspect or change it.
 */
export const installFakeEnterpriseModule: (
  options?: FakeEnterpriseModuleOptions,
) => FakeEnterpriseModule = (
  options?: FakeEnterpriseModuleOptions,
): FakeEnterpriseModule => {
  const fake: FakeEnterpriseModule = new FakeEnterpriseModule(options || {});
  EnterpriseEdition.resetForTests();
  EnterpriseEdition.register(fake);
  return fake;
};

// A fake whose license entitles exactly `features` (valid, verified).
export const installFakeEnterpriseModuleWithFeatures: (
  features: Array<EnterpriseFeature>,
) => FakeEnterpriseModule = (
  features: Array<EnterpriseFeature>,
): FakeEnterpriseModule => {
  return installFakeEnterpriseModule({
    snapshot: createLicenseSnapshot({ features }),
  });
};

// "Community Edition": no enterprise module in the process.
export const uninstallEnterpriseModule: () => void = (): void => {
  EnterpriseEdition.resetForTests();
};

/*
 * ---------------------------------------------------------------------------
 * License states for the RUNTIME features (SSO, SCIM, audit logging), which
 * follow EnterpriseEdition.isFeatureActive: with billing off they run while
 * the license covers them and stop when it lapses; an UNKNOWN license state
 * (not read yet, or unreadable) counts as active.
 * ---------------------------------------------------------------------------
 */
export interface LicenseStateCase {
  label: string;
  // Registers a fresh fake enterprise module in this license state.
  install: () => FakeEnterpriseModule;
  // Whether SSO, SCIM and audit logging run in this state with billing off.
  isActiveWithoutBilling: boolean;
  /*
   * The unknown states: active for runtime checks, but unavailable for
   * configuration checks (isFeatureAvailableSync fails closed).
   */
  isUnknown: boolean;
}

// A license that entitles everything except the three runtime features.
export const FEATURES_WITHOUT_RUNTIME_FEATURES: Array<EnterpriseFeature> = [
  EnterpriseFeature.TeamCompliance,
  EnterpriseFeature.InstanceHealth,
];

export const LICENSE_STATE_CASES: ReadonlyArray<LicenseStateCase> = [
  {
    label: "valid license",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid"),
      });
    },
    isActiveWithoutBilling: true,
    isUnknown: false,
  },
  {
    label: "license expired less than 14 days ago (grace)",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("grace"),
      });
    },
    isActiveWithoutBilling: true,
    isUnknown: false,
  },
  {
    label: "no license, inside the 14-day trial",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("grace", {
          graceReason: "unlicensed",
          verification: "none",
          companyName: undefined,
          expiresAt: undefined,
          graceEndsAt: new Date(Date.now() + 5 * DAY_IN_MS),
          features: "all",
        }),
      });
    },
    isActiveWithoutBilling: true,
    isUnknown: false,
  },
  {
    label: "unverified legacy license, accepted",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid", {
          verification: "unverified",
        }),
      });
    },
    isActiveWithoutBilling: true,
    isUnknown: false,
  },
  {
    label: "license expired more than 14 days ago",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
    },
    isActiveWithoutBilling: false,
    isUnknown: false,
  },
  {
    label: "no license after the trial",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("missing", {
          graceEndsAt: new Date(Date.now() - DAY_IN_MS),
        }),
      });
    },
    isActiveWithoutBilling: false,
    isUnknown: false,
  },
  {
    label: "invalid license",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("invalid"),
      });
    },
    isActiveWithoutBilling: false,
    isUnknown: false,
  },
  {
    label: "valid license without SSO, SCIM or audit logs",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid", {
          features: [...FEATURES_WITHOUT_RUNTIME_FEATURES],
        }),
      });
    },
    isActiveWithoutBilling: false,
    isUnknown: false,
  },
  {
    label: "license not read yet (unknown)",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({ snapshot: null });
    },
    isActiveWithoutBilling: true,
    isUnknown: true,
  },
  {
    label: "no license, trial start not recorded yet (unknown)",
    install: (): FakeEnterpriseModule => {
      return installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("missing", {
          graceEndsAt: undefined,
        }),
      });
    },
    isActiveWithoutBilling: true,
    isUnknown: true,
  },
  {
    label: "license snapshot unreadable (unknown)",
    install: (): FakeEnterpriseModule => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
      fake.licensing.getCachedSnapshotError = new Error(
        "the cached snapshot cannot be read",
      );
      return fake;
    },
    isActiveWithoutBilling: true,
    isUnknown: true,
  },
];

/*
 * One deployment state: billing, edition and license together, with whether
 * the runtime features run in it. apply() pins BOTH billing and the edition,
 * so a suite that loops over these needs nothing else (it must still mock
 * EnvironmentConfig with TestBillingFlag.withLiveBillingFlag).
 */
export interface EditionStateCase {
  label: string;
  billing: boolean;
  isLoaded: boolean;
  // Whether SSO, SCIM and audit logging run in this state.
  isActive: boolean;
  apply: () => FakeEnterpriseModule | null;
}

export const createEditionStateCases: () => Array<EditionStateCase> =
  (): Array<EditionStateCase> => {
    const cases: Array<EditionStateCase> = [];

    for (const billing of [false, true]) {
      cases.push({
        label: `billing=${billing}, Community Edition`,
        billing,
        isLoaded: false,
        isActive: false,
        apply: (): null => {
          setTestBillingEnabled(billing);
          uninstallEnterpriseModule();
          return null;
        },
      });

      for (const licenseState of LICENSE_STATE_CASES) {
        cases.push({
          label: `billing=${billing}, Enterprise Edition, ${licenseState.label}`,
          billing,
          isLoaded: true,
          isActive: billing || licenseState.isActiveWithoutBilling,
          apply: (): FakeEnterpriseModule => {
            setTestBillingEnabled(billing);
            return licenseState.install();
          },
        });
      }
    }

    return cases;
  };
