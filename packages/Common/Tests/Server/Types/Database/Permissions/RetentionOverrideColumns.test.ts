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
  TELEMETRY_RETENTION_RESOURCE_TABLE_NAMES,
} from "../../../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../../../Server/Enterprise/EnterpriseFeature";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../../../Models/DatabaseModels/PodmanHost";
import Project from "../../../../../Models/DatabaseModels/Project";
import ProxmoxCluster from "../../../../../Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "../../../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../../../Models/DatabaseModels/Service";
import TelemetryUsageBilling from "../../../../../Models/DatabaseModels/TelemetryUsageBilling";
import VMwareVCenter from "../../../../../Models/DatabaseModels/VMwareVCenter";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import LogSeverity from "../../../../../Types/Log/LogSeverity";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import TelemetryRetentionConfig from "../../../../../Types/Telemetry/TelemetryRetentionConfig";
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
 * Retention overrides are Enterprise configuration kept in COLUMNS of core
 * models: Project.telemetryRetentionConfig (retention by telemetry type,
 * project-wide), and retainTelemetryDataForDays + telemetryRetentionConfig on
 * Service and every telemetry resource. The project's default retention
 * (Project.defaultTelemetryRetentionInDays) is not one of them.
 *
 * The rules under test:
 *   - self-hosted (billing off): a create or update that SETS an override
 *     needs a license that includes retention overrides, like any write to
 *     enterprise configuration; the Community Edition is refused with the
 *     Community message and a lapsed license with the license message, and
 *     an unknown license state fails closed. Master admins are checked too.
 *   - CLEARING an override (null, "", 0, {}, a config with no retention in
 *     it) never needs the license, so a downgraded install can undo what it
 *     configured.
 *   - every other column of the same model is untouched by this gate.
 *   - internal root writes (ingest creating a Service) are never checked.
 *   - OneUptime Cloud (billing on): the plan decides, through each column's
 *     @ColumnBillingAccessControl - Scale and above may set an override,
 *     Free and Growth may not; the edition gate never refuses.
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

const RESOURCE_MODELS: ReadonlyArray<[string, ModelType]> = [
  ["Service", Service],
  ["Host", Host],
  ["DockerHost", DockerHost],
  ["PodmanHost", PodmanHost],
  ["DockerSwarmCluster", DockerSwarmCluster],
  ["KubernetesCluster", KubernetesCluster],
  ["ProxmoxCluster", ProxmoxCluster],
  ["CephCluster", CephCluster],
  ["VMwareVCenter", VMwareVCenter],
  ["IoTFleet", IoTFleet],
  ["CloudResource", CloudResource],
  ["ServerlessFunction", ServerlessFunction],
  ["DatabaseServer", DatabaseServer],
  ["RumApplication", RumApplication],
];

// Every (model, override column) pair.
const OVERRIDE_COLUMNS: ReadonlyArray<[string, ModelType, string]> = [
  ["Project", Project, "telemetryRetentionConfig"],
  ...RESOURCE_MODELS.flatMap(
    ([name, modelType]: [string, ModelType]): Array<
      [string, ModelType, string]
    > => {
      return [
        [name, modelType, "retainTelemetryDataForDays"],
        [name, modelType, "telemetryRetentionConfig"],
      ];
    },
  ),
];

const A_CONFIG: TelemetryRetentionConfig = {
  logs: { default: 30, bySeverity: { [LogSeverity.Error]: 90 } },
};

// A value that sets the override, for each column.
const settingValueFor: (column: string) => unknown = (
  column: string,
): unknown => {
  return column === "retainTelemetryDataForDays" ? 30 : A_CONFIG;
};

const CLEARING_VALUES: ReadonlyArray<[string, unknown]> = [
  ["null", null],
  ["an empty string", ""],
  ["zero", 0],
  ["an empty config", {}],
  [
    "a config whose every entry is blank",
    {
      logs: { default: null, bySeverity: { [LogSeverity.Error]: null } },
      traces: { byStatus: {} },
      metrics: {},
    },
  ],
];

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

describe("which columns are retention overrides", () => {
  test("Project: only retention by telemetry type, never the default retention", () => {
    expect(
      EnterpriseEdition.getEnterpriseColumnsForTableName("Project"),
    ).toEqual({
      telemetryRetentionConfig: EnterpriseFeature.TelemetryRetention,
    });
  });

  test.each(RESOURCE_MODELS)(
    "%s: its own retention and its retention by telemetry type",
    (name: string) => {
      expect(EnterpriseEdition.getEnterpriseColumnsForTableName(name)).toEqual({
        retainTelemetryDataForDays: EnterpriseFeature.TelemetryRetention,
        telemetryRetentionConfig: EnterpriseFeature.TelemetryRetention,
      });
    },
  );

  test("every model with both override columns is listed, so a new resource cannot ship ungated", () => {
    const withBothColumns: Array<string> = (AllModelTypes as Array<ModelType>)
      .filter((modelType: ModelType): boolean => {
        const columns: Array<string> = new modelType().getTableColumns()
          .columns;

        return (
          columns.includes("retainTelemetryDataForDays") &&
          columns.includes("telemetryRetentionConfig")
        );
      })
      .map((modelType: ModelType): string => {
        return new modelType().tableName as string;
      });

    expect(withBothColumns.sort()).toEqual(
      [...TELEMETRY_RETENTION_RESOURCE_TABLE_NAMES].sort(),
    );
    expect(
      EnterpriseEdition.getTableNamesWithEnterpriseColumns().sort(),
    ).toEqual(["Project", ...TELEMETRY_RETENTION_RESOURCE_TABLE_NAMES].sort());
  });

  test("usage billing records are not settings: TelemetryUsageBilling is not gated", () => {
    expect(
      EnterpriseEdition.getEnterpriseColumnsForTableName(
        new TelemetryUsageBilling().tableName,
      ),
    ).toBeNull();
    expect(
      gate(TelemetryUsageBilling, DatabaseRequestType.Update, {
        retainTelemetryDataForDays: 30,
      }),
    ).toBe("allowed");
  });

  test("a table with no enterprise columns, or no table name, has none", () => {
    expect(EnterpriseEdition.getEnterpriseColumnsForTableName("Monitor")).toBe(
      null,
    );
    expect(EnterpriseEdition.getEnterpriseColumnsForTableName(null)).toBe(null);
    expect(EnterpriseEdition.getEnterpriseColumnsForTableName(undefined)).toBe(
      null,
    );
  });
});

describe("what counts as setting an override", () => {
  test.each([
    ["a positive number", 7, true],
    ["a fractional positive number", 0.5, true],
    ["a numeric string", "30", true],
    ["a padded numeric string", " 30 ", true],
    ["a config with one pillar default", { metrics: { default: 15 } }, true],
    [
      "a config with only one severity rule",
      { logs: { bySeverity: { [LogSeverity.Fatal]: 365 } } },
      true,
    ],
    ["a config with a numeric-string rule", { traces: { default: "9" } }, true],
    ["null", null, false],
    ["undefined", undefined, false],
    ["zero", 0, false],
    ["a negative number", -5, false],
    ["NaN", Number.NaN, false],
    ["Infinity", Number.POSITIVE_INFINITY, false],
    ["an empty string", "", false],
    ["a blank string", "   ", false],
    ["a non-numeric string", "forever", false],
    ["a boolean", true, false],
    ["an empty object", {}, false],
    ["an empty array", [], false],
    ["a config of nulls", { logs: { default: null }, metrics: {} }, false],
    [
      "a config of zeros",
      { logs: { default: 0 }, traces: { default: -1 } },
      false,
    ],
  ])("%s: %p -> %p", (_label: string, value: unknown, expected: boolean) => {
    expect(EditionPermissions.isEnterpriseColumnValueSet(value)).toBe(expected);
  });

  test("the features a write sets are named once, and only for columns it sets", () => {
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten("Service", {
        retainTelemetryDataForDays: 30,
        telemetryRetentionConfig: A_CONFIG,
        name: "checkout",
      }),
    ).toEqual([EnterpriseFeature.TelemetryRetention]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten("Service", {
        retainTelemetryDataForDays: null,
        name: "checkout",
      }),
    ).toEqual([]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten("Project", {
        defaultTelemetryRetentionInDays: 90,
      }),
    ).toEqual([]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten("Service", [30]),
    ).toEqual([]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten("Service", null),
    ).toEqual([]);
    expect(
      EditionPermissions.getEnterpriseFeaturesWritten("Monitor", {
        retainTelemetryDataForDays: 30,
      }),
    ).toEqual([]);
  });
});

describe.each(OVERRIDE_COLUMNS)(
  "%s.%s, self-hosted",
  (_name: string, modelType: ModelType, column: string) => {
    const setting: Record<string, unknown> = {
      [column]: settingValueFor(column),
    };

    test.each([DatabaseRequestType.Create, DatabaseRequestType.Update])(
      "the Community Edition refuses to %s an override, for owners and master admins",
      (operation: DatabaseRequestType) => {
        expect(gate(modelType, operation, setting)).toBe("community");
        expect(gate(modelType, operation, setting, masterAdminProps())).toBe(
          "community",
        );
      },
    );

    test.each(CLEARING_VALUES)(
      "the Community Edition lets anyone clear it (%s)",
      (_label: string, value: unknown) => {
        expect(
          gate(modelType, DatabaseRequestType.Update, { [column]: value }),
        ).toBe("allowed");
      },
    );

    test("internal root writes, reads and deletes are never checked", () => {
      expect(
        gate(modelType, DatabaseRequestType.Update, setting, { isRoot: true }),
      ).toBe("allowed");
      expect(gate(modelType, DatabaseRequestType.Read, setting)).toBe(
        "allowed",
      );
      expect(gate(modelType, DatabaseRequestType.Delete, setting)).toBe(
        "allowed",
      );
    });
  },
);

describe("self-hosted Enterprise Edition, by license state", () => {
  test.each(
    LICENSE_STATE_CASES.map((state: LicenseStateCase) => {
      return [state.label, state] as [string, LicenseStateCase];
    }),
  )("%s", (_label: string, state: LicenseStateCase) => {
    state.install();

    // Unknown states fail closed for configuration, unlike the runtime.
    const mayConfigure: boolean =
      state.isActiveWithoutBilling && !state.isUnknown;

    for (const [, modelType, column] of OVERRIDE_COLUMNS) {
      const outcome: Outcome = gate(modelType, DatabaseRequestType.Update, {
        [column]: settingValueFor(column),
      });

      expect({ table: new modelType().tableName, column, outcome }).toEqual({
        table: new modelType().tableName,
        column,
        outcome: mayConfigure ? "allowed" : "license",
      });

      // Clearing always works.
      expect(
        gate(modelType, DatabaseRequestType.Update, { [column]: null }),
      ).toBe("allowed");
    }
  });

  test("a license that leaves retention overrides out cannot set one, but can clear it", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [
          EnterpriseFeature.SCIM,
          EnterpriseFeature.AuditLogs,
          EnterpriseFeature.TeamCompliance,
          EnterpriseFeature.InstanceHealth,
        ],
      }),
    });

    expect(
      gate(Service, DatabaseRequestType.Update, {
        retainTelemetryDataForDays: 30,
      }),
    ).toBe("license");
    expect(
      gate(Service, DatabaseRequestType.Update, {
        retainTelemetryDataForDays: null,
      }),
    ).toBe("allowed");
  });

  test("a license that names only retention overrides may set them", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [EnterpriseFeature.TelemetryRetention],
      }),
    });

    expect(
      gate(Host, DatabaseRequestType.Create, {
        telemetryRetentionConfig: A_CONFIG,
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

    for (const [, modelType, column] of OVERRIDE_COLUMNS) {
      expect(
        gate(modelType, DatabaseRequestType.Update, {
          [column]: settingValueFor(column),
        }),
      ).toBe("allowed");
    }
  });
});

describe("through the real permission entry points", () => {
  const query: Query<Service> = {
    _id: ObjectID.generate().toString(),
  } as Query<Service>;

  beforeEach(() => {
    // What follows the edition checks needs a database; it is not under test.
    jest.spyOn(BasePermission, "checkPermissions").mockImplementation((async (
      _modelType: unknown,
      checkedQuery: Query<Service>,
    ) => {
      return { query: checkedQuery };
    }) as never);
  });

  test("Community Edition: a project owner's update that sets a service's retention is refused", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        Service,
        query,
        { retainTelemetryDataForDays: 30 },
        ownerProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
  });

  test("Community Edition: the same owner may still change the service's other settings", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        Service,
        query,
        { description: "checkout API" },
        ownerProps(),
      ),
    ).resolves.toBeDefined();
  });

  test("Community Edition: clearing a service's retention is allowed", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        Service,
        query,
        { retainTelemetryDataForDays: null, telemetryRetentionConfig: null },
        ownerProps(),
      ),
    ).resolves.toBeDefined();
  });

  test("Community Edition: a master admin's update is refused too", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        Project,
        query as unknown as Query<Project>,
        { telemetryRetentionConfig: A_CONFIG },
        masterAdminProps(),
      ),
    ).rejects.toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
  });

  test("Community Edition: the project's default retention stays editable", async () => {
    await expect(
      UpdatePermission.checkUpdatePermissions(
        Project,
        query as unknown as Query<Project>,
        { defaultTelemetryRetentionInDays: 90 },
        masterAdminProps(),
      ),
    ).resolves.toBeDefined();
  });

  test("Community Edition: creating a host with a retention override is refused, without one it is not", () => {
    const withOverride: Host = new Host();
    withOverride.name = "web-1";
    withOverride.retainTelemetryDataForDays = 30;

    expect(() => {
      CreatePermission.checkCreatePermissions(Host, withOverride, ownerProps());
    }).toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );

    const withoutOverride: Host = new Host();
    withoutOverride.name = "web-1";
    withoutOverride.projectId = projectId;

    expect(() => {
      CreatePermission.checkCreatePermissions(
        Host,
        withoutOverride,
        ownerProps(),
      );
    }).not.toThrow();
  });

  test("Community Edition: a master admin's create is refused too, and a root create (ingest) is not", () => {
    const service: Service = new Service();
    service.name = "checkout";
    service.telemetryRetentionConfig = A_CONFIG;

    expect(() => {
      CreatePermission.checkCreatePermissions(
        Service,
        service,
        masterAdminProps(),
      );
    }).toThrow(
      new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE),
    );
    expect(() => {
      CreatePermission.checkCreatePermissions(Service, service, {
        isRoot: true,
      });
    }).not.toThrow();
  });

  test("Enterprise Edition with a valid license: the owner's update goes through", async () => {
    installFakeEnterpriseModule();

    await expect(
      UpdatePermission.checkUpdatePermissions(
        Service,
        query,
        { retainTelemetryDataForDays: 30, telemetryRetentionConfig: A_CONFIG },
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
    modelType: ModelType,
    column: string,
    operation: DatabaseRequestType,
    plan: PlanType,
    value?: unknown,
  ) => Outcome = (
    modelType: ModelType,
    column: string,
    operation: DatabaseRequestType,
    plan: PlanType,
    value?: unknown,
  ): Outcome => {
    const data: BaseModel = new modelType();
    (data as unknown as Record<string, unknown>)[column] =
      value === undefined ? settingValueFor(column) : value;

    return outcomeOf(() => {
      ColumnPermissions.checkDataColumnPermissions(
        modelType,
        data,
        ownerProps(plan),
        operation,
      );
    });
  };

  describe.each(OVERRIDE_COLUMNS)(
    "%s.%s",
    (_name: string, modelType: ModelType, column: string) => {
      test.each([PlanType.Free, PlanType.Growth])(
        "on %s: setting it is refused with the Scale upsell",
        (plan: PlanType) => {
          expect(
            columnOutcome(modelType, column, DatabaseRequestType.Update, plan),
          ).toBe(SCALE_REFUSAL);
        },
      );

      test.each([PlanType.Scale, PlanType.Enterprise])(
        "on %s: setting it is allowed",
        (plan: PlanType) => {
          expect(
            columnOutcome(modelType, column, DatabaseRequestType.Update, plan),
          ).toBe("allowed");
        },
      );

      test("every plan may read it", () => {
        expect(
          new modelType().getColumnBillingAccessControl(column)?.read,
        ).toBe(PlanType.Free);
      });
    },
  );

  test("the project's default retention is on every plan", () => {
    expect(
      columnOutcome(
        Project,
        "defaultTelemetryRetentionInDays",
        DatabaseRequestType.Update,
        PlanType.Free,
        90,
      ),
    ).toBe("allowed");
  });

  test("creating a service on Growth without an override is not gated", () => {
    const service: Service = new Service();
    service.name = "checkout";

    expect(
      outcomeOf(() => {
        ColumnPermissions.checkDataColumnPermissions(
          Service,
          service,
          ownerProps(PlanType.Growth),
          DatabaseRequestType.Create,
        );
      }),
    ).toBe("allowed");
  });
});
