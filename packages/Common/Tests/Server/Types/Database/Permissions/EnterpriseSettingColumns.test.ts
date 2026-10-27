import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EditionPermissions from "../../../../../Server/Types/Database/Permissions/EditionPermission";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import UpdatePermission from "../../../../../Server/Types/Database/Permissions/UpdatePermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Query from "../../../../../Server/Types/Database/Query";
import logger from "../../../../../Server/Utils/Logger";
import EnterpriseEdition, {
  IP_ALLOWLIST_TABLE_NAMES,
} from "../../../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../../../Server/Enterprise/EnterpriseFeature";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../../../Models/DatabaseModels/Dashboard";
import Form from "../../../../../Models/DatabaseModels/Form";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
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

/*
 * Enterprise configuration kept in COLUMNS of the status page, dashboard and
 * form models (the retention overrides have a suite of their own,
 * RetentionOverrideColumns.test.ts, and so do the custom channel columns of
 * on-call rules and notification settings,
 * CustomChannelEditionPermissions.test.ts):
 *
 *   ipWhitelist on StatusPage, Dashboard and Form      IP allow-lists
 *   StatusPage.hidePoweredByOneUptimeBranding          status page branding
 *   StatusPage.privateUserSessionLengthInHours,        status page access
 *     limitSubscribersToPrivateUsers,                  controls
 *     allowedSubscriberEmailDomains
 *
 * The rules under test:
 *   - self-hosted (billing off): a create or update that SETS one - anything
 *     but the column's default - needs a license that includes its feature;
 *     the Community Edition is refused with the Community message and a
 *     lapsed license with the license message, and an unknown license state
 *     fails closed. Master admins are checked too.
 *   - putting one back to its default (no allow-list, the switch off, no
 *     session limit, any domain) never needs the license, so an install that
 *     dropped to the Community Edition can remove what it configured.
 *   - every other column of the same model is untouched by this gate.
 *   - internal root writes, reads and deletes are never checked.
 *   - OneUptime Cloud (billing on): the edition gate never refuses; the plan
 *     decides, through each column's @ColumnBillingAccessControl.
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
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

type ModelType = DatabaseBaseModelType;

interface SettingColumn {
  table: string;
  modelType: ModelType;
  column: string;
  feature: EnterpriseFeature;
  // A value that turns the setting on.
  setting: unknown;
  // Values that put it back to its default, with a label for each.
  clearing: Array<[string, unknown]>;
}

const TEXT_CLEARING: Array<[string, unknown]> = [
  ["null", null],
  ["an empty string", ""],
];

const SETTING_COLUMNS: ReadonlyArray<SettingColumn> = [
  {
    table: "StatusPage",
    modelType: StatusPage,
    column: "ipWhitelist",
    feature: EnterpriseFeature.IpAllowlists,
    setting: "203.0.113.0/24\n198.51.100.7",
    clearing: TEXT_CLEARING,
  },
  {
    table: "Dashboard",
    modelType: Dashboard,
    column: "ipWhitelist",
    feature: EnterpriseFeature.IpAllowlists,
    setting: "203.0.113.0/24",
    clearing: TEXT_CLEARING,
  },
  {
    table: "Form",
    modelType: Form,
    column: "ipWhitelist",
    feature: EnterpriseFeature.IpAllowlists,
    setting: "198.51.100.7",
    clearing: TEXT_CLEARING,
  },
  {
    table: "StatusPage",
    modelType: StatusPage,
    column: "hidePoweredByOneUptimeBranding",
    feature: EnterpriseFeature.StatusPageBranding,
    setting: true,
    clearing: [["false", false]],
  },
  {
    table: "StatusPage",
    modelType: StatusPage,
    column: "privateUserSessionLengthInHours",
    feature: EnterpriseFeature.StatusPageAccessControls,
    setting: 12,
    clearing: [["null (no limit)", null]],
  },
  {
    table: "StatusPage",
    modelType: StatusPage,
    column: "limitSubscribersToPrivateUsers",
    feature: EnterpriseFeature.StatusPageAccessControls,
    setting: true,
    clearing: [["false", false]],
  },
  {
    table: "StatusPage",
    modelType: StatusPage,
    column: "allowedSubscriberEmailDomains",
    feature: EnterpriseFeature.StatusPageAccessControls,
    setting: "acme.com\nacme.de",
    clearing: TEXT_CLEARING,
  },
];

// The features these columns hold, each once.
const SETTING_FEATURES: ReadonlyArray<EnterpriseFeature> = [
  EnterpriseFeature.IpAllowlists,
  EnterpriseFeature.StatusPageBranding,
  EnterpriseFeature.StatusPageAccessControls,
];

const SETTING_ROWS: ReadonlyArray<[string, SettingColumn]> =
  SETTING_COLUMNS.map((setting: SettingColumn): [string, SettingColumn] => {
    return [`${setting.table}.${setting.column}`, setting];
  });

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const userId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const ownerProps: (
  plan?: PlanType | undefined,
) => DatabaseCommonInteractionProps = (
  plan?: PlanType | undefined,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  } as UserTenantAccessPermission;

  return {
    userId,
    tenantId: projectId,
    ...(plan ? { currentPlan: plan, isSubscriptionUnpaid: false } : {}),
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
};

const masterAdminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return { userId, isMasterAdmin: true };
  };

type Outcome = "allowed" | "community" | "license" | string;

// Runs the column gate and names how it answered.
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
  modelType: ModelType,
  operation: DatabaseRequestType,
  data: unknown,
  props?: DatabaseCommonInteractionProps,
) => Outcome = (
  modelType: ModelType,
  operation: DatabaseRequestType,
  data: unknown,
  props?: DatabaseCommonInteractionProps,
): Outcome => {
  return outcomeOf(() => {
    EditionPermissions.checkEnterpriseColumnPermissions(
      modelType,
      props || ownerProps(),
      operation,
      data,
    );
  });
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("which columns are enterprise settings", () => {
  test("a status page: its IP allow-list, its Powered by switch and its access controls", () => {
    expect(
      EnterpriseEdition.getEnterpriseColumnsForTableName("StatusPage"),
    ).toEqual({
      ipWhitelist: EnterpriseFeature.IpAllowlists,
      hidePoweredByOneUptimeBranding: EnterpriseFeature.StatusPageBranding,
      privateUserSessionLengthInHours:
        EnterpriseFeature.StatusPageAccessControls,
      limitSubscribersToPrivateUsers:
        EnterpriseFeature.StatusPageAccessControls,
      allowedSubscriberEmailDomains: EnterpriseFeature.StatusPageAccessControls,
    });
  });

  test.each([["Dashboard"], ["Form"]])(
    "%s: only its IP allow-list",
    (table: string) => {
      expect(EnterpriseEdition.getEnterpriseColumnsForTableName(table)).toEqual(
        {
          ipWhitelist: EnterpriseFeature.IpAllowlists,
        },
      );
    },
  );

  /*
   * The custom channel columns, gated by a suite of their own
   * (CustomChannelEditionPermissions.test.ts): what an on-call rule pages
   * through and whether a person's notifications go to the channels.
   */
  test.each([
    [
      "UserNotificationRule",
      {
        customNotificationChannelId:
          EnterpriseFeature.CustomNotificationChannels,
      },
    ],
    [
      "UserNotificationSetting",
      { alertByCustomChannel: EnterpriseFeature.CustomNotificationChannels },
    ],
  ] as Array<[string, Record<string, EnterpriseFeature>]>)(
    "%s: only its custom channel column",
    (table: string, columns: Record<string, EnterpriseFeature>) => {
      expect(EnterpriseEdition.getEnterpriseColumnsForTableName(table)).toEqual(
        columns,
      );
    },
  );

  test("every model with an IP allow-list is listed, so a new one cannot ship ungated", () => {
    const withAllowlist: Array<string> = (AllModelTypes as Array<ModelType>)
      .filter((modelType: ModelType): boolean => {
        return new modelType()
          .getTableColumns()
          .columns.includes("ipWhitelist");
      })
      .map((modelType: ModelType): string => {
        return new modelType().tableName as string;
      });

    expect(withAllowlist.sort()).toEqual([...IP_ALLOWLIST_TABLE_NAMES].sort());

    for (const table of IP_ALLOWLIST_TABLE_NAMES) {
      expect(
        EnterpriseEdition.getEnterpriseColumnsForTableName(table)?.[
          "ipWhitelist"
        ],
      ).toBe(EnterpriseFeature.IpAllowlists);
    }
  });

  /*
   * What stays in every edition: who can open a page, and a status page's
   * private users, subscribers and their channels, master password and SSO.
   */
  test.each([
    "isPublicStatusPage",
    "enableMasterPassword",
    "requireSsoForLogin",
    "enableEmailSubscribers",
    "enableSlackSubscribers",
    "showOverallUptimePercentOnStatusPage",
    "sendSubscriberNotifications",
  ])("StatusPage.%s is not an enterprise setting", (column: string) => {
    expect(
      EnterpriseEdition.getEnterpriseColumnsForTableName("StatusPage")?.[
        column
      ],
    ).toBeUndefined();
    expect(
      gate(StatusPage, DatabaseRequestType.Update, { [column]: true }),
    ).toBe("allowed");
  });

  test("every column's feature is a licensable enterprise feature", () => {
    for (const setting of SETTING_COLUMNS) {
      expect(ALL_ENTERPRISE_FEATURES).toContain(setting.feature);
    }
  });
});

describe("what counts as setting one", () => {
  test.each(SETTING_ROWS)(
    "%s: its setting value sets it, and its default clears it",
    (_label: string, setting: SettingColumn) => {
      const model: BaseModel = new setting.modelType();

      expect(
        EditionPermissions.isEnterpriseColumnWriteSetting(
          model,
          setting.column,
          setting.feature,
          setting.setting,
        ),
      ).toBe(true);

      for (const [, value] of setting.clearing) {
        expect(
          EditionPermissions.isEnterpriseColumnWriteSetting(
            model,
            setting.column,
            setting.feature,
            value,
          ),
        ).toBe(false);
      }

      // Not written at all is not a write.
      expect(
        EditionPermissions.isEnterpriseColumnWriteSetting(
          model,
          setting.column,
          setting.feature,
          undefined,
        ),
      ).toBe(false);
    },
  );

  test.each([
    ["a blank line", "   "],
    ["one address", "10.0.0.1"],
    ["a line of text", "anything"],
  ])(
    "an IP allow-list of %s sets it: only nothing is no allow-list",
    (_label: string, value: string) => {
      expect(
        EditionPermissions.isEnterpriseColumnWriteSetting(
          new StatusPage(),
          "ipWhitelist",
          EnterpriseFeature.IpAllowlists,
          value,
        ),
      ).toBe(true);
    },
  );

  test("a switch with a declared default is cleared by false only: an unclear value never gets the feature for free", () => {
    for (const value of [null, "false", 0]) {
      expect(
        EditionPermissions.isEnterpriseColumnWriteSetting(
          new StatusPage(),
          "hidePoweredByOneUptimeBranding",
          EnterpriseFeature.StatusPageBranding,
          value,
        ),
      ).toBe(true);
    }
  });

  test("a column with no metadata has no default, so any value sets it (fail closed)", () => {
    expect(
      EditionPermissions.isEnterpriseColumnWriteSetting(
        new StatusPage(),
        "notAColumn",
        EnterpriseFeature.IpAllowlists,
        null,
      ),
    ).toBe(true);
  });

  test("the features a write sets are named once each, and only for the columns it sets", () => {
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten(StatusPage, {
        ipWhitelist: "10.0.0.1",
        hidePoweredByOneUptimeBranding: true,
        limitSubscribersToPrivateUsers: true,
        allowedSubscriberEmailDomains: "acme.com",
        pageTitle: "Acme status",
      }),
    ).toEqual([
      EnterpriseFeature.IpAllowlists,
      EnterpriseFeature.StatusPageBranding,
      EnterpriseFeature.StatusPageAccessControls,
    ]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten(StatusPage, {
        ipWhitelist: "",
        hidePoweredByOneUptimeBranding: false,
        privateUserSessionLengthInHours: null,
        limitSubscribersToPrivateUsers: false,
        allowedSubscriberEmailDomains: null,
        pageTitle: "Acme status",
      }),
    ).toEqual([]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten(Dashboard, {
        name: "Checkout",
      }),
    ).toEqual([]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten(Form, ["10.0.0.1"]),
    ).toEqual([]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten(StatusPage, null),
    ).toEqual([]);
  });
});

describe.each(SETTING_ROWS)(
  "%s, self-hosted",
  (_label: string, setting: SettingColumn) => {
    const write: Record<string, unknown> = {
      [setting.column]: setting.setting,
    };

    test.each([DatabaseRequestType.Create, DatabaseRequestType.Update])(
      "the Community Edition refuses to %s it, for owners and master admins",
      (operation: DatabaseRequestType) => {
        expect(gate(setting.modelType, operation, write)).toBe("community");
        expect(
          gate(setting.modelType, operation, write, masterAdminProps()),
        ).toBe("community");
      },
    );

    test.each(setting.clearing)(
      "the Community Edition lets anyone put it back to its default (%s)",
      (_valueLabel: string, value: unknown) => {
        expect(
          gate(setting.modelType, DatabaseRequestType.Update, {
            [setting.column]: value,
          }),
        ).toBe("allowed");
        expect(
          gate(
            setting.modelType,
            DatabaseRequestType.Create,
            { [setting.column]: value },
            masterAdminProps(),
          ),
        ).toBe("allowed");
      },
    );

    test("internal root writes, reads and deletes are never checked", () => {
      expect(
        gate(setting.modelType, DatabaseRequestType.Update, write, {
          isRoot: true,
        }),
      ).toBe("allowed");
      expect(gate(setting.modelType, DatabaseRequestType.Read, write)).toBe(
        "allowed",
      );
      expect(gate(setting.modelType, DatabaseRequestType.Delete, write)).toBe(
        "allowed",
      );
    });
  },
);

describe("self-hosted Enterprise Edition, by license state", () => {
  /*
   * Whether configuration may be written in each license state: a usable
   * license (valid, grace, trial, an accepted legacy one) that includes the
   * feature. A lapse refuses; an unknown state fails closed - the opposite
   * of the runtime, which keeps running while it cannot read the license.
   * The license without the runtime features still includes the IP
   * allow-lists and the access controls, but not the branding feature,
   * which is a runtime one.
   */
  const mayConfigure: (
    state: LicenseStateCase,
    feature: EnterpriseFeature,
  ) => boolean = (
    state: LicenseStateCase,
    feature: EnterpriseFeature,
  ): boolean => {
    if (state.isUnknown) {
      return false;
    }

    if (state.label === "valid license without SCIM or audit logs") {
      return feature !== EnterpriseFeature.StatusPageBranding;
    }

    return state.isActiveWithoutBilling;
  };

  test.each(
    LICENSE_STATE_CASES.map((state: LicenseStateCase) => {
      return [state.label, state] as [string, LicenseStateCase];
    }),
  )("%s", (_label: string, state: LicenseStateCase) => {
    state.install();

    for (const setting of SETTING_COLUMNS) {
      const outcome: Outcome = gate(
        setting.modelType,
        DatabaseRequestType.Update,
        { [setting.column]: setting.setting },
      );

      expect({
        table: setting.table,
        column: setting.column,
        outcome,
      }).toEqual({
        table: setting.table,
        column: setting.column,
        outcome: mayConfigure(state, setting.feature) ? "allowed" : "license",
      });

      // Putting it back to its default always works.
      expect(
        gate(setting.modelType, DatabaseRequestType.Update, {
          [setting.column]: setting.clearing[0]![1],
        }),
      ).toBe("allowed");
    }
  });

  test.each(SETTING_FEATURES)(
    "a license that leaves %s out cannot set its columns, but can clear them",
    (feature: EnterpriseFeature) => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: ALL_ENTERPRISE_FEATURES.filter(
            (other: EnterpriseFeature): boolean => {
              return other !== feature;
            },
          ),
        }),
      });

      for (const setting of SETTING_COLUMNS) {
        expect({
          column: `${setting.table}.${setting.column}`,
          outcome: gate(setting.modelType, DatabaseRequestType.Update, {
            [setting.column]: setting.setting,
          }),
        }).toEqual({
          column: `${setting.table}.${setting.column}`,
          outcome: setting.feature === feature ? "license" : "allowed",
        });
        expect(
          gate(setting.modelType, DatabaseRequestType.Update, {
            [setting.column]: setting.clearing[0]![1],
          }),
        ).toBe("allowed");
      }
    },
  );

  test.each(SETTING_FEATURES)(
    "a license that names only %s may set its columns and no others",
    (feature: EnterpriseFeature) => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({ features: [feature] }),
      });

      for (const setting of SETTING_COLUMNS) {
        expect(
          gate(setting.modelType, DatabaseRequestType.Create, {
            [setting.column]: setting.setting,
          }),
        ).toBe(setting.feature === feature ? "allowed" : "license");
      }
    },
  );

  test("one write that sets two features needs both", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [EnterpriseFeature.IpAllowlists],
      }),
    });

    expect(
      gate(StatusPage, DatabaseRequestType.Update, {
        ipWhitelist: "10.0.0.1",
        hidePoweredByOneUptimeBranding: true,
      }),
    ).toBe("license");
    expect(
      gate(StatusPage, DatabaseRequestType.Update, {
        ipWhitelist: "10.0.0.1",
        hidePoweredByOneUptimeBranding: false,
      }),
    ).toBe("allowed");
  });
});

describe("OneUptime Cloud: the edition gate never refuses", () => {
  test.each(
    createEditionStateCases()
      .filter((state: EditionStateCase): boolean => {
        return state.billing;
      })
      .map((state: EditionStateCase) => {
        return [state.label, state] as [string, EditionStateCase];
      }),
  )("%s", (_label: string, state: EditionStateCase) => {
    state.apply();

    for (const setting of SETTING_COLUMNS) {
      expect(
        gate(setting.modelType, DatabaseRequestType.Update, {
          [setting.column]: setting.setting,
        }),
      ).toBe("allowed");
    }
  });
});

describe("through the real permission entry points", () => {
  const query: Query<StatusPage> = {
    _id: ObjectID.generate().toString(),
  } as Query<StatusPage>;

  beforeEach(() => {
    // What follows the edition checks needs a database; it is not under test.
    jest.spyOn(BasePermission, "checkPermissions").mockImplementation((async (
      _modelType: unknown,
      checkedQuery: Query<StatusPage>,
    ) => {
      return { query: checkedQuery };
    }) as never);
  });

  test("Community Edition: a project owner's update that sets a status page's IP allow-list is refused", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        StatusPage,
        query,
        { ipWhitelist: "10.0.0.1" },
        ownerProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
  });

  test("Community Edition: the same owner may still change who can open the page, and its title", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        StatusPage,
        query,
        { isPublicStatusPage: false, pageTitle: "Acme status" },
        ownerProps(),
      ),
    ).resolves.toBeDefined();
  });

  test("Community Edition: removing the allow-list and the access controls is allowed", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        StatusPage,
        query,
        {
          ipWhitelist: "",
          privateUserSessionLengthInHours: null,
          limitSubscribersToPrivateUsers: false,
          allowedSubscriberEmailDomains: null,
          hidePoweredByOneUptimeBranding: false,
        },
        ownerProps(),
      ),
    ).resolves.toBeDefined();
  });

  test("Community Edition: a master admin's update that hides Powered by OneUptime is refused too", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        StatusPage,
        query,
        { hidePoweredByOneUptimeBranding: true },
        masterAdminProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
  });

  test("Community Edition: creating a dashboard with an IP allow-list is refused, without one it is not", () => {
    const withAllowlist: Dashboard = new Dashboard();
    withAllowlist.name = "Checkout";
    withAllowlist.ipWhitelist = "10.0.0.1";

    expect(() => {
      CreatePermission.checkCreatePermissions(
        Dashboard,
        withAllowlist,
        ownerProps(),
      );
    }).toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );

    const withoutAllowlist: Dashboard = new Dashboard();
    withoutAllowlist.name = "Checkout";
    withoutAllowlist.projectId = projectId;

    expect(() => {
      CreatePermission.checkCreatePermissions(
        Dashboard,
        withoutAllowlist,
        ownerProps(),
      );
    }).not.toThrow();
  });

  test("Community Edition: a master admin's form create with an allow-list is refused, and a root one is not", () => {
    const form: Form = new Form();
    form.name = "Report an outage";
    form.ipWhitelist = "10.0.0.1";

    expect(() => {
      CreatePermission.checkCreatePermissions(Form, form, masterAdminProps());
    }).toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
    expect(() => {
      CreatePermission.checkCreatePermissions(Form, form, { isRoot: true });
    }).not.toThrow();
  });

  test("Enterprise Edition with a lapsed license: the update is refused with the license message", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ features: [] }),
    });

    await expect(
      UpdatePermission.checkUpdatePermissions(
        StatusPage,
        query,
        { allowedSubscriberEmailDomains: "acme.com" },
        ownerProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.LICENSE_REQUIRED_MESSAGE),
    );
  });

  test("Enterprise Edition with a valid license: the owner's update goes through", async () => {
    installFakeEnterpriseModule();

    await expect(
      UpdatePermission.checkUpdatePermissions(
        StatusPage,
        query,
        {
          ipWhitelist: "10.0.0.1",
          hidePoweredByOneUptimeBranding: true,
          privateUserSessionLengthInHours: 12,
          limitSubscribersToPrivateUsers: true,
          allowedSubscriberEmailDomains: "acme.com",
        },
        ownerProps(),
      ),
    ).resolves.toBeDefined();
  });
});

describe("OneUptime Cloud: the Scale plan", () => {
  const PLAN_ENVIRONMENT: Record<string, string> = {
    SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
    SUBSCRIPTION_PLAN_GROWTH:
      "Growth,price_growth_month,price_growth_year,22,20,2,14",
    SUBSCRIPTION_PLAN_SCALE:
      "Scale,price_scale_month,price_scale_year,99,84,3,14",
    SUBSCRIPTION_PLAN_ENTERPRISE:
      "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
  };
  const SCALE_REFUSAL: string =
    "Please upgrade your plan to Scale to access this feature";
  const savedPlanEnvironment: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SUBSCRIPTION_PLAN_")) {
        savedPlanEnvironment[key] = process.env[key];
        delete process.env[key];
      }
    }

    Object.assign(process.env, PLAN_ENVIRONMENT);
  });

  afterAll(() => {
    for (const key of Object.keys(PLAN_ENVIRONMENT)) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(savedPlanEnvironment)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  });

  beforeEach(() => {
    setTestBillingEnabled(true);
    installFakeEnterpriseModule();
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  const columnOutcome: (
    setting: SettingColumn,
    plan: PlanType,
    value: unknown,
  ) => Outcome = (
    setting: SettingColumn,
    plan: PlanType,
    value: unknown,
  ): Outcome => {
    const data: BaseModel = new setting.modelType();
    (data as unknown as Record<string, unknown>)[setting.column] = value;

    return outcomeOf(() => {
      ColumnPermissions.checkDataColumnPermissions(
        setting.modelType,
        data,
        ownerProps(plan),
        DatabaseRequestType.Update,
      );
    });
  };

  describe.each(SETTING_ROWS)(
    "%s",
    (_label: string, setting: SettingColumn) => {
      test.each([PlanType.Free, PlanType.Growth])(
        "on %s: setting it is refused with the Scale upsell, and clearing it is allowed",
        (plan: PlanType) => {
          expect(columnOutcome(setting, plan, setting.setting)).toBe(
            SCALE_REFUSAL,
          );

          for (const [, value] of setting.clearing) {
            expect(columnOutcome(setting, plan, value)).toBe("allowed");
          }
        },
      );

      test.each([PlanType.Scale, PlanType.Enterprise])(
        "on %s: setting it is allowed",
        (plan: PlanType) => {
          expect(columnOutcome(setting, plan, setting.setting)).toBe("allowed");
        },
      );
    },
  );
});
