import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseEdition, {
  EnterpriseFeatureStateChange,
  RUNTIME_ENTERPRISE_FEATURES,
} from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../Server/Enterprise/EnterpriseFeature";
import { EnterpriseLicenseSnapshot } from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import logger from "../../../Server/Utils/Logger";
import FakeEnterpriseModule, {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  createEditionStateCases,
  EditionStateCase,
  installFakeEnterpriseModule,
  LICENSE_STATE_CASES,
  LicenseStateCase,
  uninstallEnterpriseModule,
} from "./FakeEnterpriseModule";
import { setTestBillingEnabled } from "./TestBillingFlag";
import { getJestSpyOn } from "../../Spy";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

/*
 * EnterpriseEdition.isFeatureActive: whether a feature's RUNTIME behaviour
 * (SSO sign-in and "Require SSO" enforcement, SCIM provisioning and its team
 * locks, audit-log recording) runs right now.
 *
 *   - Community Edition: never;
 *   - billing on (OneUptime Cloud): always, plan tiers gate instead;
 *   - self-hosted: while the license covers the feature (valid, grace, trial,
 *     accepted unverified legacy), and NOT once it lapsed (expired past grace,
 *     missing past the trial, invalid, feature not in the license);
 *   - unknown license state (not read yet, unreadable): active, with one
 *     warning per process - an unknown state must never lock anyone out or
 *     relax SSO.
 *
 * A change of answer is logged once per change and reported to listeners.
 * Billing is pinned through the mocked EnvironmentConfig (CI's config.env sets
 * BILLING_ENABLED=true). This suite must pass with ee/ deleted.
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

let warn: SpyInstance;
let info: SpyInstance;
let error: SpyInstance;

const warnings: () => Array<string> = (): Array<string> => {
  return warn.mock.calls
    .map((call: Array<unknown>): unknown => {
      return call[0];
    })
    .filter((value: unknown): value is string => {
      return typeof value === "string";
    });
};

const infos: () => Array<string> = (): Array<string> => {
  return info.mock.calls
    .map((call: Array<unknown>): unknown => {
      return call[0];
    })
    .filter((value: unknown): value is string => {
      return typeof value === "string";
    });
};

const lapseWarnings: () => Array<string> = (): Array<string> => {
  return warnings().filter((message: string): boolean => {
    return message.startsWith("The OneUptime Enterprise license");
  });
};

beforeEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  warn = getJestSpyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  info = getJestSpyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  error = getJestSpyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

afterAll(() => {
  uninstallEnterpriseModule();
});

describe("isFeatureActive matrix", () => {
  const cases: Array<EditionStateCase> = createEditionStateCases();

  test("the matrix covers both editions, both billing values and every license state", () => {
    expect(cases).toHaveLength(2 * (1 + LICENSE_STATE_CASES.length));
    expect(
      cases.filter((editionCase: EditionStateCase): boolean => {
        return editionCase.isActive;
      }).length,
    ).toBeGreaterThan(0);
    expect(
      cases.filter((editionCase: EditionStateCase): boolean => {
        return !editionCase.isActive && editionCase.isLoaded;
      }).length,
    ).toBeGreaterThan(0);
  });

  test.each(
    cases.map((editionCase: EditionStateCase): [string, EditionStateCase] => {
      return [editionCase.label, editionCase];
    }),
  )("%s", (_label: string, editionCase: EditionStateCase) => {
    editionCase.apply();

    for (const feature of RUNTIME_ENTERPRISE_FEATURES) {
      expect(`${feature}: ${EnterpriseEdition.isFeatureActive(feature)}`).toBe(
        `${feature}: ${editionCase.isActive}`,
      );
    }

    expect(EnterpriseEdition.isLoaded()).toBe(editionCase.isLoaded);
  });

  test.each(
    LICENSE_STATE_CASES.map(
      (licenseState: LicenseStateCase): [string, LicenseStateCase] => {
        return [licenseState.label, licenseState];
      },
    ),
  )(
    "billing off, %s: differs from isFeatureAvailableSync only in the unknown states",
    (_label: string, licenseState: LicenseStateCase) => {
      licenseState.install();

      for (const feature of ALL_ENTERPRISE_FEATURES) {
        const isActive: boolean = EnterpriseEdition.isFeatureActive(feature);
        const isAvailable: boolean =
          EnterpriseEdition.isFeatureAvailableSync(feature);

        if (licenseState.isUnknown) {
          expect({ feature, isActive, isAvailable }).toEqual({
            feature,
            isActive: true,
            isAvailable: false,
          });
        } else {
          expect({ feature, isActive }).toEqual({
            feature,
            isActive: isAvailable,
          });
        }
      }
    },
  );

  test("the Community Edition never reads anything and is never active", () => {
    for (const billing of [false, true]) {
      setTestBillingEnabled(billing);

      for (const feature of ALL_ENTERPRISE_FEATURES) {
        expect(EnterpriseEdition.isFeatureActive(feature)).toBe(false);
      }
    }

    expect(warn).not.toHaveBeenCalled();
  });

  test("billing on never reads the license (the Cloud gates by plan)", () => {
    setTestBillingEnabled(true);
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });
    fake.licensing.getCachedSnapshotError = new Error("must not be read");

    for (const feature of ALL_ENTERPRISE_FEATURES) {
      expect(EnterpriseEdition.isFeatureActive(feature)).toBe(true);
    }

    expect(warn).not.toHaveBeenCalled();
  });

  test("a license that leaves out one feature stops only that feature", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: ALL_ENTERPRISE_FEATURES.filter(
          (feature: EnterpriseFeature): boolean => {
            return feature !== EnterpriseFeature.SCIM;
          },
        ),
      }),
    });

    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(true);
    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM)).toBe(
      false,
    );
    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs)).toBe(
      true,
    );
  });

  test("the answer follows the license at call time (renewal and lapse without a restart)", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(
      false,
    );

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(true);

    fake.setSnapshot(createLicenseSnapshotWithStatus("invalid"));
    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(
      false,
    );
  });
});

describe("an unknown license state counts as active, and is warned about once", () => {
  test("not read yet: active, one warning however many calls", () => {
    installFakeEnterpriseModule({ snapshot: null });

    for (let call: number = 0; call < 25; call++) {
      for (const feature of RUNTIME_ENTERPRISE_FEATURES) {
        expect(EnterpriseEdition.isFeatureActive(feature)).toBe(true);
      }
    }

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("has not been read yet");
    expect(warnings()[0]).toContain("once per process");
    expect(lapseWarnings()).toEqual([]);
  });

  test("unreadable: active, one warning (plus the error) however many calls", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    const readError: Error = new Error("snapshot exploded");
    fake.licensing.getCachedSnapshotError = readError;

    for (let call: number = 0; call < 25; call++) {
      expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(
        true,
      );
    }

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warnings()[0]).toContain("could not read the cached license");
    expect(warn).toHaveBeenCalledWith(readError);
  });

  test("an unknown state never counts as a lapse, and does not hide a later one", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("valid"),
    });

    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(true);

    fake.setSnapshot(null);
    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(true);
    expect(lapseWarnings()).toEqual([]);

    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(
      false,
    );
    expect(lapseWarnings()).toHaveLength(1);
  });

  test("resetForTests forgets the one-time warning (a fresh process warns again)", () => {
    installFakeEnterpriseModule({ snapshot: null });
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);

    installFakeEnterpriseModule({ snapshot: null });
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);

    expect(warnings()).toHaveLength(2);
  });
});

describe("state changes are logged once per change", () => {
  test("a license that has already lapsed at boot is reported once, naming everything that stopped", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired", {
        message: "The license expired on 2026-01-01.",
      }),
    });

    for (let call: number = 0; call < 10; call++) {
      for (const feature of RUNTIME_ENTERPRISE_FEATURES) {
        expect(EnterpriseEdition.isFeatureActive(feature)).toBe(false);
      }
    }

    expect(lapseWarnings()).toHaveLength(1);

    const message: string = lapseWarnings()[0]!;

    expect(message).toContain(
      "The OneUptime Enterprise license has lapsed (status: expired)",
    );
    expect(message).toContain(
      "single sign-on (SSO), SCIM provisioning and audit logging have stopped until a license is activated",
    );
    expect(message).toContain('"Require SSO for login" is not enforced');
    expect(message).toContain("reset their password");
    expect(message).toContain(
      "License status: The license expired on 2026-01-01.",
    );
    expect(info).not.toHaveBeenCalled();
  });

  test("a valid license at boot logs nothing", () => {
    installFakeEnterpriseModule();

    for (const feature of ALL_ENTERPRISE_FEATURES) {
      EnterpriseEdition.isFeatureActive(feature);
    }

    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  test("lapse, renewal and lapse again: one warning, one info line, one warning", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    expect(lapseWarnings()).toHaveLength(0);

    fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
    expect(lapseWarnings()).toHaveLength(1);
    expect(lapseWarnings()[0]).toContain("has lapsed (status: missing)");

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    expect(infos()).toEqual([
      "The OneUptime Enterprise license covers single sign-on (SSO), SCIM provisioning and audit logging again: they have resumed.",
    ]);

    fake.setSnapshot(createLicenseSnapshotWithStatus("invalid"));
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    expect(lapseWarnings()).toHaveLength(2);
    expect(lapseWarnings()[1]).toContain("has lapsed (status: invalid)");
    expect(infos()).toHaveLength(1);
  });

  test("a license without one feature names only that feature, as not included", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [
          EnterpriseFeature.SSO,
          EnterpriseFeature.AuditLogs,
          EnterpriseFeature.TeamCompliance,
        ],
      }),
    });

    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    expect(lapseWarnings()).toHaveLength(0);

    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);

    expect(lapseWarnings()).toEqual([
      "The OneUptime Enterprise license does not include SCIM provisioning: it has stopped until a license that includes it is activated. A master admin can activate or renew the license from the edition label in the Admin Dashboard header.",
    ]);
  });

  test("billing on never logs a change, whatever the license", () => {
    setTestBillingEnabled(true);
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);

    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  test("a logger that throws never changes the answer", () => {
    warn.mockImplementation((): void => {
      throw new Error("log sink down");
    });
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(
      false,
    );
    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(
      false,
    );
  });
});

describe("onFeatureStateChange", () => {
  test("listeners hear each change once, with what stopped and what resumed", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    const changes: Array<EnterpriseFeatureStateChange> = [];

    EnterpriseEdition.onFeatureStateChange(
      (change: EnterpriseFeatureStateChange): void => {
        changes.push(change);
      },
    );

    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);
    expect(changes).toHaveLength(0);

    const lapsed: EnterpriseLicenseSnapshot =
      createLicenseSnapshotWithStatus("expired");
    fake.setSnapshot(lapsed);

    for (const feature of RUNTIME_ENTERPRISE_FEATURES) {
      EnterpriseEdition.isFeatureActive(feature);
      EnterpriseEdition.isFeatureActive(feature);
    }

    expect(changes).toEqual([
      {
        stopped: [
          EnterpriseFeature.SSO,
          EnterpriseFeature.SCIM,
          EnterpriseFeature.AuditLogs,
        ],
        resumed: [],
        snapshot: lapsed,
      },
    ]);

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM);

    expect(changes).toHaveLength(2);
    expect(changes[1]!.stopped).toEqual([]);
    expect(changes[1]!.resumed).toEqual([
      EnterpriseFeature.SSO,
      EnterpriseFeature.SCIM,
      EnterpriseFeature.AuditLogs,
    ]);
  });

  test("a listener that throws is logged and never breaks the check or the other listeners", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });
    const heard: Array<string> = [];

    EnterpriseEdition.onFeatureStateChange((): void => {
      throw new Error("listener exploded");
    });
    EnterpriseEdition.onFeatureStateChange((): void => {
      heard.push("second");
    });

    expect(EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO)).toBe(
      false,
    );
    expect(heard).toEqual(["second"]);
    expect(error).toHaveBeenCalled();
  });

  test("the returned function removes the listener", () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();
    const heard: Array<EnterpriseFeatureStateChange> = [];

    const stop: () => void = EnterpriseEdition.onFeatureStateChange(
      (change: EnterpriseFeatureStateChange): void => {
        heard.push(change);
      },
    );
    stop();

    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
    EnterpriseEdition.isFeatureActive(EnterpriseFeature.SSO);

    expect(heard).toEqual([]);
  });
});

describe("describeStoppedFeatures / describeResumedFeatures", () => {
  test("nothing stopped or resumed is no line at all", () => {
    expect(
      EnterpriseEdition.describeStoppedFeatures(
        [],
        createLicenseSnapshotWithStatus("expired"),
      ),
    ).toBeNull();
    expect(EnterpriseEdition.describeResumedFeatures([])).toBeNull();
  });

  test("audit logging alone does not mention SSO enforcement", () => {
    const message: string | null = EnterpriseEdition.describeStoppedFeatures(
      [EnterpriseFeature.AuditLogs],
      createLicenseSnapshotWithStatus("expired"),
    );

    expect(message).toContain("audit logging has stopped");
    expect(message).not.toContain("Require SSO");
  });

  test("one resumed feature reads in the singular", () => {
    expect(
      EnterpriseEdition.describeResumedFeatures([EnterpriseFeature.SSO]),
    ).toBe(
      "The OneUptime Enterprise license covers single sign-on (SSO) again: it has resumed.",
    );
  });
});
