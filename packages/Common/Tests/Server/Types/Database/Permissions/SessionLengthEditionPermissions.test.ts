import EditionPermissions from "../../../../../Server/Types/Database/Permissions/EditionPermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Query from "../../../../../Server/Types/Database/Query";
import EnterpriseEdition from "../../../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../../../Server/Enterprise/EnterpriseFeature";
import logger from "../../../../../Server/Utils/Logger";
import GlobalConfig from "../../../../../Models/DatabaseModels/GlobalConfig";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import { SESSION_LENGTH_SETTING_COLUMNS } from "../../../../../Types/UserSession/SessionLength";
import {
  createEditionStateCases,
  createLicenseSnapshot,
  EditionStateCase,
  installFakeEnterpriseModule,
  LICENSE_STATE_CASES,
  LicenseStateCase,
  uninstallEnterpriseModule,
} from "../../../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * SETTING A SESSION LENGTH NEEDS THE LICENSE; REMOVING ONE NEVER DOES
 * (EditionPermissions, EnterpriseFeature.SessionLength).
 *
 * How long a sign-in lasts is an Enterprise Edition setting, kept in five
 * GlobalConfig columns (Types/UserSession/SessionLength.ts). Self-hosted
 * (billing off):
 *
 *   - a write that sets one - a length, an idle timeout, SSO sign-ins'
 *     own - is refused while the feature is not available: on the
 *     Community Edition in its words, after a lapse in the license's;
 *   - putting one back to its default (no limit, 30 days, the switch off)
 *     never is: an install that dropped to the Community Edition, or whose
 *     license lapsed, can always remove what it set;
 *   - every other GlobalConfig column of the same write is left to the
 *     usual checks;
 *   - master admins - the only people who write GlobalConfig - are
 *     checked; internal root writes never are;
 *   - an unknown license state fails closed: availability, not activity.
 *
 * OneUptime Cloud (billing on) is never refused here. Billing and the
 * edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const FEATURE: EnterpriseFeature = EnterpriseFeature.SessionLength;

const ALL_BUT_SESSION_LENGTH: Array<EnterpriseFeature> =
  ALL_ENTERPRISE_FEATURES.filter((feature: EnterpriseFeature): boolean => {
    return feature !== FEATURE;
  });

const userId: ObjectID = new ObjectID("5e551000-0000-4000-8000-000000000001");

const masterAdminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return { userId, isMasterAdmin: true };
  };

const rootProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return { isRoot: true };
  };

type Outcome = "allowed" | "community" | "license" | string;

const outcomeOf: (check: () => void) => Outcome = (
  check: () => void,
): Outcome => {
  try {
    check();
    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      if (err.message === EnterpriseEdition.COMMUNITY_EDITION_MESSAGE) {
        return "community";
      }

      if (err.message === EnterpriseEdition.LICENSE_REQUIRED_MESSAGE) {
        return "license";
      }

      return err.message;
    }

    throw err;
  }
};

const gate: (
  data: unknown,
  props?: DatabaseCommonInteractionProps,
  operation?: DatabaseRequestType,
) => Outcome = (
  data: unknown,
  props?: DatabaseCommonInteractionProps,
  operation?: DatabaseRequestType,
): Outcome => {
  return outcomeOf(() => {
    EditionPermissions.checkEnterpriseColumnPermissions(
      GlobalConfig,
      props || masterAdminProps(),
      operation || DatabaseRequestType.Update,
      data,
    );
  });
};

interface ColumnCase {
  column: string;
  setting: Array<[string, unknown]>;
  clearing: Array<[string, unknown]>;
}

const COLUMN_CASES: Array<ColumnCase> = [
  {
    column: "sessionLengthInMinutes",
    setting: [
      ["8 hours", 480],
      ["a value written as text", "480"],
    ],
    clearing: [["null (no limit)", null]],
  },
  {
    column: "sessionIdleTimeoutInMinutes",
    setting: [["15 minutes", 15]],
    clearing: [["null (30 days)", null]],
  },
  {
    column: "useSeparateSsoSessionLengths",
    setting: [["true", true]],
    // As every switch's default: exactly false (Types/Billing/PlanGatedColumnDefault).
    clearing: [["false (the switch off)", false]],
  },
  {
    column: "ssoSessionLengthInMinutes",
    setting: [["12 hours", 720]],
    clearing: [["null (no limit)", null]],
  },
  {
    column: "ssoSessionIdleTimeoutInMinutes",
    setting: [["1 hour", 60]],
    clearing: [["null (30 days)", null]],
  },
];

const COLUMN_ROWS: Array<[string, ColumnCase]> = COLUMN_CASES.map(
  (columnCase: ColumnCase): [string, ColumnCase] => {
    return [columnCase.column, columnCase];
  },
);

// As every Enterprise configuration write is decided in each license state.
const WRITE_BY_LICENSE_STATE: Record<string, Outcome> = {
  "valid license": "allowed",
  "license expired less than 30 days ago (grace)": "allowed",
  "no license, inside the 14-day trial": "allowed",
  "unverified legacy license, accepted": "allowed",
  "license expired more than 30 days ago": "license",
  "no license after the trial": "license",
  "invalid license": "license",
  "valid license without SCIM or audit logs": "license",
  "license not read yet (unknown)": "license",
  "no license, trial start not recorded yet (unknown)": "license",
  "license snapshot unreadable (unknown)": "license",
};

const LICENSE_ROWS: Array<[string, LicenseStateCase]> = LICENSE_STATE_CASES.map(
  (state: LicenseStateCase): [string, LicenseStateCase] => {
    return [state.label, state];
  },
);

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("what is gated", () => {
  test("GlobalConfig's enterprise columns are exactly the five that hold the session lengths", () => {
    const columns: Readonly<Record<string, EnterpriseFeature>> | null =
      EnterpriseEdition.getEnterpriseColumnsForTableName("GlobalConfig");

    expect(Object.keys(columns || {}).sort()).toEqual(
      [...SESSION_LENGTH_SETTING_COLUMNS].sort(),
    );

    for (const column of SESSION_LENGTH_SETTING_COLUMNS) {
      expect(columns![column]).toBe(FEATURE);
    }
  });

  test("its feature has a name for the license's messages, and is not one whose running stops with the license", () => {
    expect(FEATURE).toBe("session-length");
    expect(ALL_ENTERPRISE_FEATURES).toContain(FEATURE);
  });

  test("GlobalConfig is not enterprise configuration as a whole: only these columns are", () => {
    expect(new GlobalConfig().requiresEnterprise).toBeFalsy();
    expect(EnterpriseEdition.getModelFeature(GlobalConfig)).toBeNull();
  });

  test.each(COLUMN_ROWS)(
    "%s: what sets it names the feature once; what clears it, or another column, names none",
    (_label: string, columnCase: ColumnCase) => {
      for (const [, value] of columnCase.setting) {
        expect(
          EditionPermissions.getEnterpriseFeaturesWritten(GlobalConfig, {
            disableSignup: true,
            [columnCase.column]: value,
          }),
        ).toEqual([FEATURE]);
      }

      for (const [, value] of columnCase.clearing) {
        expect(
          EditionPermissions.getEnterpriseFeaturesWritten(GlobalConfig, {
            disableSignup: true,
            [columnCase.column]: value,
          }),
        ).toEqual([]);
      }

      expect(
        EditionPermissions.getEnterpriseFeaturesWritten(GlobalConfig, {
          disableSignup: true,
        }),
      ).toEqual([]);
    },
  );

  test("a write setting several of them names the feature once", () => {
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten(GlobalConfig, {
        sessionLengthInMinutes: 480,
        sessionIdleTimeoutInMinutes: 30,
        useSeparateSsoSessionLengths: true,
        ssoSessionLengthInMinutes: 720,
      }),
    ).toEqual([FEATURE]);
  });
});

describe.each(COLUMN_ROWS)("%s", (_label: string, columnCase: ColumnCase) => {
  test("the Community Edition refuses a write that sets it, master admins included", () => {
    for (const [valueLabel, value] of columnCase.setting) {
      expect({
        valueLabel,
        outcome: gate({ [columnCase.column]: value }),
      }).toEqual({ valueLabel, outcome: "community" });
    }
  });

  test("the Community Edition lets a master admin clear it, or leave it out", () => {
    for (const [, value] of columnCase.clearing) {
      expect(gate({ [columnCase.column]: value })).toBe("allowed");
    }

    expect(gate({ disableSignup: false })).toBe("allowed");
  });

  test("internal root writes, reads and deletes are never checked", () => {
    const write: Record<string, unknown> = {
      [columnCase.column]: columnCase.setting[0]![1],
    };

    expect(gate(write, rootProps())).toBe("allowed");
    expect(gate(write, masterAdminProps(), DatabaseRequestType.Read)).toBe(
      "allowed",
    );
    expect(gate(write, masterAdminProps(), DatabaseRequestType.Delete)).toBe(
      "allowed",
    );
  });

  test.each(LICENSE_ROWS)(
    "the Enterprise Edition, %s",
    (label: string, state: LicenseStateCase) => {
      state.install();

      expect(gate({ [columnCase.column]: columnCase.setting[0]![1] })).toBe(
        WRITE_BY_LICENSE_STATE[label],
      );
      // Clearing it always works.
      expect(gate({ [columnCase.column]: columnCase.clearing[0]![1] })).toBe(
        "allowed",
      );
    },
  );

  test("a license that leaves session lengths out cannot set it, and can clear it", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: ALL_BUT_SESSION_LENGTH }),
    });

    expect(gate({ [columnCase.column]: columnCase.setting[0]![1] })).toBe(
      "license",
    );
    expect(gate({ [columnCase.column]: columnCase.clearing[0]![1] })).toBe(
      "allowed",
    );
  });
});

describe("OneUptime Cloud: the edition gate never refuses", () => {
  test.each(
    createEditionStateCases()
      .filter((state: EditionStateCase): boolean => {
        return state.billing;
      })
      .map((state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      }),
  )("%s", (_label: string, state: EditionStateCase) => {
    state.apply();

    for (const columnCase of COLUMN_CASES) {
      expect(gate({ [columnCase.column]: columnCase.setting[0]![1] })).toBe(
        "allowed",
      );
    }
  });
});

describe("through the real update permission, as a master admin", () => {
  const configQuery: Query<GlobalConfig> = {
    _id: ObjectID.getZeroObjectID().toString(),
  } as Query<GlobalConfig>;

  test("Community Edition: setting a session length is refused, and removing it is allowed", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        GlobalConfig,
        configQuery,
        { sessionLengthInMinutes: 480 },
        masterAdminProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
    await expect(
      UpdatePermission.checkUpdatePermissions(
        GlobalConfig,
        configQuery,
        { sessionLengthInMinutes: null },
        masterAdminProps(),
      ),
    ).resolves.toEqual(configQuery);
  });

  test("Enterprise Edition with a license that includes it: setting every length goes through", async () => {
    installFakeEnterpriseModule();

    await expect(
      UpdatePermission.checkUpdatePermissions(
        GlobalConfig,
        configQuery,
        {
          sessionLengthInMinutes: 480,
          sessionIdleTimeoutInMinutes: 30,
          useSeparateSsoSessionLengths: true,
          ssoSessionLengthInMinutes: 720,
          ssoSessionIdleTimeoutInMinutes: 60,
        },
        masterAdminProps(),
      ),
    ).resolves.toEqual(configQuery);
  });

  test("Enterprise Edition after a lapse: refused in the license's words, and removing still works", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: ALL_BUT_SESSION_LENGTH }),
    });

    await expect(
      UpdatePermission.checkUpdatePermissions(
        GlobalConfig,
        configQuery,
        { ssoSessionIdleTimeoutInMinutes: 60 },
        masterAdminProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE),
    );
    await expect(
      UpdatePermission.checkUpdatePermissions(
        GlobalConfig,
        configQuery,
        {
          ssoSessionIdleTimeoutInMinutes: null,
          useSeparateSsoSessionLengths: false,
        },
        masterAdminProps(),
      ),
    ).resolves.toEqual(configQuery);
  });
});
