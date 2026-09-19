import LicenseArea, {
  getLastBootRefresh,
  licensing,
} from "../../../Server/License/Index";
import LicenseStore from "../../../Server/License/LicenseStore";
import { describeIgnoredLicenseServerUrl } from "../../../Server/License/LicenseServerUrl";
import licenseProvider from "../../../Server/License/LicenseProvider";
import { setTrustedLicenseKeysForTests } from "../../../Server/License/TrustedLicenseKeys";
import {
  EnterpriseLicensingProvider,
  EnterpriseServerModuleShape,
} from "Common/Server/Enterprise/EnterpriseServerModule";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import logger from "Common/Server/Utils/Logger";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
import FakeEnterpriseModule from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import {
  DAY_IN_MS,
  FakeGlobalConfigRow,
  generateEd25519,
  KeyPair,
  legacyToken,
  listRoutes,
  RecordedWrite,
  signLicense,
  trustedEntryFor,
} from "./Helpers/LicenseTestKit";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The License area of the Enterprise module, as the loader drives it:
 *
 *   init()               records the first run of the Enterprise Edition (the
 *                        unlicensed grace counts from it), loads the license
 *                        before any router is mounted, and refreshes an
 *                        unverified legacy license from oneuptime.com in the
 *                        background - never blocking the boot, never throwing;
 *   getApiRouters()      the activation and refresh routes;
 *   registerWorkerJobs() the daily usage report.
 */

const mockRegisteredJobs: Array<string> = [];

jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn((jobName: string): void => {
      mockRegisteredJobs.push(jobName);
    }),
  };
});

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

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
      create: jest.fn(),
    },
  };
});

const SIGNING_KEY: KeyPair = generateEd25519();
const INSTANCE_ID: ObjectID = ObjectID.generate();

let store: FakeGlobalConfigRow;

const firstSeenWrites: () => Array<RecordedWrite> = (): Array<RecordedWrite> => {
  return store.writes.filter((write: RecordedWrite): boolean => {
    return Object.prototype.hasOwnProperty.call(
      write.data,
      "enterpriseEditionFirstSeenAt",
    );
  });
};

const respondWithLicense: (token: string) => void = (token: string): void => {
  (API.post as unknown as jest.Mock).mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        companyName: "Acme Inc",
        expiresAt: new Date(Date.now() + 365 * DAY_IN_MS).toISOString(),
        token,
        userLimit: 20,
        currentUserCount: 3,
        instances: [],
      },
      {},
    ),
  );
};

beforeEach(async () => {
  jest.clearAllMocks();
  setTestBillingEnabled(false);
  setTrustedLicenseKeysForTests([trustedEntryFor(SIGNING_KEY)]);
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });

  store = new FakeGlobalConfigRow({ instanceId: INSTANCE_ID });
  store.install(GlobalConfigService);
  respondWithLicense(signLicense(SIGNING_KEY));
});

afterEach(() => {
  setTrustedLicenseKeysForTests(null);
  setTestBillingEnabled(false);
  EnterpriseEdition.resetForTests();
  jest.restoreAllMocks();
});

describe("License area - init(): the first run of the Enterprise Edition", () => {
  it("records the first run, as root with hooks off", async () => {
    const before: number = Date.now();

    await LicenseArea.init!();

    const writes: Array<RecordedWrite> = firstSeenWrites();

    expect(writes).toHaveLength(1);
    expect(writes[0]!.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(
      (writes[0]!.data["enterpriseEditionFirstSeenAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
  });

  /*
   * The stamp is permanent. Rebooting (or switching to the Community image
   * and back) must never restart the unlicensed grace period.
   */
  it("never overwrites an earlier first run", async () => {
    const firstSeenAt: Date = new Date(Date.now() - 200 * DAY_IN_MS);
    store.row!["enterpriseEditionFirstSeenAt"] = firstSeenAt;

    await LicenseArea.init!();
    await LicenseArea.init!();

    expect(firstSeenWrites()).toHaveLength(0);
    expect(store.row!["enterpriseEditionFirstSeenAt"]).toBe(firstSeenAt);
  });

  it("starts the unlicensed grace period at the first run", async () => {
    await LicenseArea.init!();

    const snapshot: ReturnType<typeof licensing.getCachedSnapshot> =
      licensing.getCachedSnapshot();

    expect(snapshot?.status).toBe("grace");
    expect(snapshot?.graceReason).toBe("unlicensed");
    expect(snapshot?.graceEndsAt?.getTime()).toBeGreaterThan(
      Date.now() + 13 * DAY_IN_MS,
    );
  });

  /*
   * The default config row is created by the AddDefaultGlobalConfig data
   * migration, which would fail on a row that already exists. So on a brand
   * new installation the stamp waits for the row instead of creating it.
   */
  it("does not create the config row on a brand-new installation", async () => {
    store.row = null;

    await LicenseArea.init!();

    expect(store.writes).toHaveLength(0);
    expect(GlobalConfigService.create).not.toHaveBeenCalled();
  });

  it("stamps the first run on a later read once the row exists", async () => {
    store.row = null;
    await LicenseArea.init!();

    store.row = { instanceId: INSTANCE_ID };
    await licenseProvider.refresh();

    expect(firstSeenWrites()).toHaveLength(1);
  });

  it("still loads the license when the stamp cannot be written", async () => {
    (GlobalConfigService as unknown as Record<string, unknown>)[
      "updateOneById"
    ] = jest.fn().mockRejectedValue(new Error("read-only replica") as never);
    store.row!["enterpriseLicenseToken"] = signLicense(SIGNING_KEY);

    await LicenseArea.init!();

    expect(licensing.getCachedSnapshot()?.status).toBe("valid");
  });
});

describe("License area - init(): loading the license before routers mount", () => {
  it("loads the license, so synchronous permission checks work at once", async () => {
    store.row!["enterpriseLicenseToken"] = signLicense(SIGNING_KEY);

    await LicenseArea.init!();

    expect(licensing.getCachedSnapshot()?.status).toBe("valid");
    expect(licensing.getCachedSnapshot()?.verification).toBe("verified");
  });

  /*
   * A database blip at boot must not stop the boot: core monitoring is never
   * locked by licensing. Enterprise configuration stays read-only until the
   * license can be read.
   */
  it("does not throw when the database cannot be read", async () => {
    store.failReads = new Error("Database is not connected");

    await expect(LicenseArea.init!()).resolves.toBeUndefined();
    expect(store.writes).toHaveLength(0);
  });

  it("serves the facade once registered", async () => {
    store.row!["enterpriseLicenseToken"] = signLicense(SIGNING_KEY, {
      features: ["sso"],
    });
    const fake: FakeEnterpriseModule = new FakeEnterpriseModule();
    (fake as unknown as { licensing: EnterpriseLicensingProvider }).licensing =
      licensing;
    EnterpriseEdition.register(fake);

    await LicenseArea.init!();

    expect(EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.SSO)).toBe(
      true,
    );
    expect(
      EnterpriseEdition.isFeatureAvailableSync(EnterpriseFeature.AuditLogs),
    ).toBe(false);
  });
});

describe("License area - init(): refreshing an unverified license at boot", () => {
  const installLegacyLicense: () => void = (): void => {
    store.row!["enterpriseLicenseKey"] = "acme-license-key";
    store.row!["enterpriseLicenseToken"] = legacyToken("stored");
    store.row!["enterpriseLicenseExpiresAt"] = new Date(
      Date.now() + 30 * DAY_IN_MS,
    );
  };

  it("asks oneuptime.com for a fresh license when the stored one cannot be verified", async () => {
    installLegacyLicense();
    const signed: string = signLicense(SIGNING_KEY);
    respondWithLicense(signed);

    await LicenseArea.init!();
    await getLastBootRefresh();

    expect(API.post).toHaveBeenCalledTimes(1);
    expect(store.row!["enterpriseLicenseToken"]).toBe(signed);
    expect(licensing.getCachedSnapshot()?.verification).toBe("verified");
  });

  /*
   * init() is bounded by the loader; a slow license server must never be
   * what it waits on.
   */
  it("does not make the boot wait for the license server", async () => {
    installLegacyLicense();
    let answer: (value: unknown) => void = (): void => {
      return undefined;
    };
    (API.post as unknown as jest.Mock).mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        answer = resolve;
      }) as never,
    );

    await expect(LicenseArea.init!()).resolves.toBeUndefined();

    expect(getLastBootRefresh()).not.toBeNull();
    answer(new HTTPResponse<JSONObject>(500, {}, {}));
    await getLastBootRefresh();
  });

  it("keeps the stored license, and does not throw, when the refresh fails", async () => {
    installLegacyLicense();
    (API.post as unknown as jest.Mock).mockRejectedValue(
      new Error("ENOTFOUND oneuptime.com") as never,
    );

    await LicenseArea.init!();
    await expect(getLastBootRefresh()).resolves.toBeUndefined();

    expect(store.row!["enterpriseLicenseToken"]).toBe(legacyToken("stored"));
    expect(licensing.getCachedSnapshot()?.status).toBe("valid");
  });

  /*
   * Before the key ceremony the build trusts no signing key, so a fresh
   * license could not be verified either - every pod of every installation
   * would call home on every boot for nothing.
   */
  it("does not call home while this build trusts no signing key", async () => {
    installLegacyLicense();
    setTrustedLicenseKeysForTests([]);

    await LicenseArea.init!();

    expect(getLastBootRefresh()).toBeNull();
    expect(API.post).not.toHaveBeenCalled();
    expect(licensing.getCachedSnapshot()?.status).toBe("valid");
    expect(licensing.getCachedSnapshot()?.verification).toBe("unverified");
  });

  it("does not call home for a verified license", async () => {
    store.row!["enterpriseLicenseKey"] = "acme-license-key";
    store.row!["enterpriseLicenseToken"] = signLicense(SIGNING_KEY);

    await LicenseArea.init!();

    expect(getLastBootRefresh()).toBeNull();
    expect(API.post).not.toHaveBeenCalled();
  });

  it("does not call home from an installation activated offline", async () => {
    store.row!["enterpriseLicenseToken"] = legacyToken("stored");
    store.row!["enterpriseLicenseExpiresAt"] = new Date(
      Date.now() + 30 * DAY_IN_MS,
    );

    await LicenseArea.init!();

    expect(getLastBootRefresh()).toBeNull();
    expect(API.post).not.toHaveBeenCalled();
  });

  it("does not call home when there is no license at all", async () => {
    await LicenseArea.init!();

    expect(getLastBootRefresh()).toBeNull();
    expect(API.post).not.toHaveBeenCalled();
  });

  it("does not call home on oneuptime.com itself (billing enabled)", async () => {
    installLegacyLicense();
    setTestBillingEnabled(true);

    await LicenseArea.init!();

    expect(getLastBootRefresh()).toBeNull();
    expect(API.post).not.toHaveBeenCalled();
  });
});

describe("License area - routers and jobs", () => {
  it("contributes the license client router, routes only", () => {
    const routers: Array<ExpressRouter> = LicenseArea.getApiRouters!();

    expect(routers).toHaveLength(1);
    expect(listRoutes(routers[0]!)).toEqual([
      "POST /global-config/license",
      "POST /global-config/license/refresh",
    ]);
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(routers[0]!),
    ).toEqual([]);
  });

  it("contributes no identity routers", () => {
    expect(LicenseArea.getIdentityRouters).toBeUndefined();
  });

  it("registers the daily usage report", async () => {
    await LicenseArea.registerWorkerJobs!();

    expect(mockRegisteredJobs).toContain("EnterpriseLicense:ReportUserCount");
  });
});

describe("LicenseStore - the first-run stamp on its own", () => {
  it("returns the stamp in effect without writing when there is one", async () => {
    const config: GlobalConfig = new GlobalConfig();
    config.enterpriseEditionFirstSeenAt = new Date(0);

    const stamp: Date | null = await LicenseStore.stampFirstSeenIfMissing(
      config,
      new Date(),
    );

    expect(stamp?.getTime()).toBe(0);
    expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
  });

  it("does nothing without a row", async () => {
    expect(
      await LicenseStore.stampFirstSeenIfMissing(null, new Date()),
    ).toBeNull();
    expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
  });
});

describe("License area - an ignored ENTERPRISE_LICENSE_SERVER_URL", () => {
  const VARIABLE: string = "ENTERPRISE_LICENSE_SERVER_URL";

  afterEach(() => {
    delete process.env[VARIABLE];
  });

  /*
   * EnvironmentConfig cannot log, so an unusable value silently falls back to
   * oneuptime.com. An operator who pointed it at a staging license server has
   * to be told at boot.
   */
  it("warns at boot when the variable was ignored", async () => {
    process.env[VARIABLE] = "ftp://licenses.example.com";

    await LicenseArea.init!();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'ENTERPRISE_LICENSE_SERVER_URL "ftp://licenses.example.com" was ignored',
      ),
    );
  });

  it("says nothing when the variable is not set", async () => {
    await LicenseArea.init!();

    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("ENTERPRISE_LICENSE_SERVER_URL"),
    );
  });

  it.each([
    ["an https URL", "https://licenses.example.com", false, null],
    ["an https URL with a trailing slash", "https://licenses.example.com/", false, null],
    ["plain http in development or test", "http://localhost:3002", true, null],
    ["the default itself", "https://oneuptime.com", false, null],
    ["unset", undefined, false, null],
    ["blank", "   ", false, null],
  ] as Array<[string, string | undefined, boolean, null]>)(
    "does not warn for %s",
    (
      _label: string,
      rawValue: string | undefined,
      allowInsecure: boolean,
      expected: null,
    ) => {
      expect(describeIgnoredLicenseServerUrl({ rawValue, allowInsecure })).toBe(
        expected,
      );
    },
  );

  it.each([
    ["plain http in production", "http://licenses.example.com", false],
    ["another scheme", "ftp://licenses.example.com", true],
    ["something that is not a URL", "licenses", false],
  ] as Array<[string, string, boolean]>)(
    "warns for %s, naming the value and where licenses go instead",
    (_label: string, rawValue: string, allowInsecure: boolean) => {
      const warning: string | null = describeIgnoredLicenseServerUrl({
        rawValue,
        allowInsecure,
      });

      expect(warning).toContain(`"${rawValue}" was ignored`);
      expect(warning).toContain("https://oneuptime.com");
    },
  );
});
