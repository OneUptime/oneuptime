import AllAnalyticsModelTypes from "../../../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import Dashboard from "../../../../../Models/DatabaseModels/Dashboard";
import Project from "../../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import Team from "../../../../../Models/DatabaseModels/Team";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../../../Server/Types/Database/Permissions/BillingPermission";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import logger from "../../../../../Server/Utils/Logger";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import ColumnBillingAccessControl from "../../../../../Types/BaseDatabase/ColumnBillingAccessControl";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  EMPTY_TEXT_COLUMN_TYPES,
  isPlanGatedColumnDefault,
} from "../../../../../Types/Billing/PlanGatedColumnDefault";
import SubscriptionPlan, {
  PlanType,
} from "../../../../../Types/Billing/SubscriptionPlan";
import { getColumnBillingAccessControlForAllColumns } from "../../../../../Types/Database/AccessControl/ColumnBillingAccessControl";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
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
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * A paid feature can always be switched off, on any plan.
 *
 * Every column with @ColumnBillingAccessControl holds a feature a plan
 * sells. On OneUptime Cloud (billing on) a write to it needs that plan -
 * except a write that puts it back to its default, the feature off, which
 * every plan's records start with (Types/Billing/PlanGatedColumnDefault).
 * So a project whose trial ended, or that moved to a lower plan, can switch
 * off a status page's email reports, make a public dashboard private again,
 * empty an IP allowlist, remove custom code or a retention override - and
 * still cannot switch any of them on.
 *
 * This sweeps EVERY plan-gated column of every model, so a new one is
 * covered the day it is added:
 *   - its default is one the database agrees with (the @Column default is
 *     the @TableColumn defaultValue), or it has none and is nullable, so the
 *     value the rule lets through is one the column can hold;
 *   - its default is written on every plan, by create and by update, with
 *     billing on;
 *   - anything else needs the plan, and below it is refused with the plan's
 *     name;
 *   - with billing off (every self-hosted install), nothing is refused.
 *
 * Analytics models carry no column-level plan gates, so the rule has
 * nothing to cover there; if one is ever added, this fails and points here.
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

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PLANS: ReadonlyArray<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-000000000002");

type ModelType = { new (): BaseModel };

interface GatedColumn {
  label: string;
  modelType: ModelType;
  column: string;
  billing: ColumnBillingAccessControl;
  metadata: TableColumnMetadata;
}

const getGatedColumns: () => Array<GatedColumn> = (): Array<GatedColumn> => {
  const columns: Array<GatedColumn> = [];

  for (const modelType of AllModelTypes) {
    const model: BaseModel = new modelType();
    const billing: Dictionary<ColumnBillingAccessControl> =
      getColumnBillingAccessControlForAllColumns(model);

    for (const [column, control] of Object.entries(billing)) {
      columns.push({
        label: `${modelType.name}.${column}`,
        modelType,
        column,
        billing: control,
        metadata: model.getTableColumnMetadata(column),
      });
    }
  }

  return columns.sort((left: GatedColumn, right: GatedColumn): number => {
    return left.label.localeCompare(right.label);
  });
};

const GATED_COLUMNS: Array<GatedColumn> = getGatedColumns();

const GATED_COLUMN_CASES: Array<[string, GatedColumn]> = GATED_COLUMNS.map(
  (gated: GatedColumn): [string, GatedColumn] => {
    return [gated.label, gated];
  },
);

// Whether a plan reaches another, in the plan order the Cloud configures.
const isPlanAtLeast: (required: PlanType, current: PlanType) => boolean = (
  required: PlanType,
  current: PlanType,
): boolean => {
  return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
    required,
    current,
    PLAN_ENVIRONMENT as unknown as JSONObject,
  );
};

// The column's @Column options, as TypeORM was told them.
const getTypeOrmColumn: (gated: GatedColumn) => ColumnMetadataArgs = (
  gated: GatedColumn,
): ColumnMetadataArgs => {
  const args: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (candidate: ColumnMetadataArgs): boolean => {
        return (
          candidate.target === gated.modelType &&
          candidate.propertyName === gated.column
        );
      },
    );

  if (!args) {
    throw new Error(`${gated.label} has no TypeORM @Column metadata`);
  }

  return args;
};

// The values that put the column back to its default.
const getDefaultValues: (gated: GatedColumn) => Array<unknown> = (
  gated: GatedColumn,
): Array<unknown> => {
  const defaultValue: unknown = gated.metadata.defaultValue;

  if (defaultValue !== undefined && defaultValue !== null) {
    return [defaultValue];
  }

  return EMPTY_TEXT_COLUMN_TYPES.includes(gated.metadata.type)
    ? [null, ""]
    : [null];
};

// A value that switches the feature on: anything but the default.
const getFeatureValue: (gated: GatedColumn) => unknown = (
  gated: GatedColumn,
): unknown => {
  const defaultValue: unknown = gated.metadata.defaultValue;

  switch (gated.metadata.type) {
    case TableColumnType.Boolean:
      return !(defaultValue === true);
    case TableColumnType.Number:
    case TableColumnType.SmallPositiveNumber:
    case TableColumnType.PositiveNumber:
    case TableColumnType.BigPositiveNumber:
    case TableColumnType.SmallNumber:
    case TableColumnType.BigNumber:
      return typeof defaultValue === "number" ? defaultValue + 1 : 30;
    case TableColumnType.Date:
      return new Date("2026-11-01T09:00:00.000Z");
    case TableColumnType.JSON:
      return { logs: { default: 30 } };
    default:
      return typeof defaultValue === "string"
        ? `${defaultValue}-changed`
        : "10.0.0.0/8";
  }
};

// Someone the column's own access control lets write it, on a plan.
const writerOnPlan: (
  gated: GatedColumn,
  requestType: DatabaseRequestType,
  plan: PlanType,
) => DatabaseCommonInteractionProps = (
  gated: GatedColumn,
  requestType: DatabaseRequestType,
  plan: PlanType,
): DatabaseCommonInteractionProps => {
  const access: ColumnAccessControl | undefined =
    new gated.modelType().getColumnAccessControlForAllColumns()[gated.column];

  const allowed: Array<Permission> =
    (requestType === DatabaseRequestType.Create
      ? access?.create
      : access?.update) || [];

  const permission: Permission = allowed.includes(Permission.ProjectOwner)
    ? Permission.ProjectOwner
    : (allowed[0] as Permission);

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    currentPlan: plan,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      } as UserTenantAccessPermission,
    },
  };
};

// Whether someone may write the column at all (columns no one may write skip).
const isWritable: (
  gated: GatedColumn,
  requestType: DatabaseRequestType,
) => boolean = (
  gated: GatedColumn,
  requestType: DatabaseRequestType,
): boolean => {
  const access: ColumnAccessControl | undefined =
    new gated.modelType().getColumnAccessControlForAllColumns()[gated.column];

  const allowed: Array<Permission> | undefined =
    requestType === DatabaseRequestType.Create
      ? access?.create
      : access?.update;

  return Boolean(allowed && allowed.length > 0);
};

const getGate: (
  gated: GatedColumn,
  requestType: DatabaseRequestType,
) => PlanType | undefined = (
  gated: GatedColumn,
  requestType: DatabaseRequestType,
): PlanType | undefined => {
  return requestType === DatabaseRequestType.Create
    ? gated.billing.create
    : gated.billing.update;
};

// What the column check says about a write: "allowed", or its refusal.
const checkWrite: (input: {
  gated: GatedColumn;
  requestType: DatabaseRequestType;
  plan: PlanType;
  value: unknown;
}) => string = (input: {
  gated: GatedColumn;
  requestType: DatabaseRequestType;
  plan: PlanType;
  value: unknown;
}): string => {
  const data: Record<string, unknown> = {
    [input.gated.column]: input.value,
  };

  try {
    ColumnPermissions.checkDataColumnPermissions(
      input.gated.modelType,
      data as unknown as BaseModel,
      writerOnPlan(input.gated, input.requestType, input.plan),
      input.requestType,
    );

    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
};

const refusalFor: (plan: PlanType) => string = (plan: PlanType): string => {
  return `Please upgrade your plan to ${plan} to access this feature`;
};

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
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the plan-gated columns", () => {
  test("the sweep finds them: the status page's, the dashboard's, the project's and every retention override", () => {
    const labels: Array<string> = GATED_COLUMNS.map(
      (gated: GatedColumn): string => {
        return gated.label;
      },
    );

    for (const expected of [
      "StatusPage.isReportEnabled",
      "StatusPage.isPublicStatusPage",
      "StatusPage.enableSmsSubscribers",
      "StatusPage.customJavaScript",
      "StatusPage.ipWhitelist",
      "Dashboard.isPublicDashboard",
      "Dashboard.ipWhitelist",
      "Project.requireSsoForLogin",
      "Project.enableAuditLogs",
      "Project.telemetryRetentionConfig",
      "Service.retainTelemetryDataForDays",
      "Form.ipWhitelist",
    ]) {
      expect(labels).toContain(expected);
    }

    expect(GATED_COLUMNS.length).toBeGreaterThanOrEqual(60);
  });

  test.each(GATED_COLUMN_CASES)(
    "%s: its default is one the database holds too",
    (_label: string, gated: GatedColumn) => {
      const typeOrm: ColumnMetadataArgs = getTypeOrmColumn(gated);
      const defaultValue: unknown = gated.metadata.defaultValue;

      if (defaultValue === undefined || defaultValue === null) {
        // No default: nothing set is null, so the column must hold null.
        expect([gated.label, typeOrm.options.nullable]).toEqual([
          gated.label,
          true,
        ]);
        expect([gated.label, typeOrm.options.default]).toEqual([
          gated.label,
          undefined,
        ]);
        return;
      }

      // A declared default: the database writes the same one.
      expect([gated.label, typeOrm.options.default]).toEqual([
        gated.label,
        defaultValue,
      ]);
    },
  );

  test.each(GATED_COLUMN_CASES)(
    "%s: a boolean switch has a boolean default to go back to",
    (_label: string, gated: GatedColumn) => {
      if (gated.metadata.type !== TableColumnType.Boolean) {
        return;
      }

      expect([gated.label, typeof gated.metadata.defaultValue]).toEqual([
        gated.label,
        "boolean",
      ]);
    },
  );
});

describe("on OneUptime Cloud (billing on)", () => {
  describe.each([
    ["an update", DatabaseRequestType.Update],
    ["a create", DatabaseRequestType.Create],
  ])("%s", (_name: string, requestType: DatabaseRequestType) => {
    test.each(GATED_COLUMN_CASES)(
      "%s: back to its default on every plan",
      (_label: string, gated: GatedColumn) => {
        if (!isWritable(gated, requestType)) {
          return;
        }

        for (const value of getDefaultValues(gated)) {
          for (const plan of PLANS) {
            expect([
              gated.label,
              plan,
              value,
              checkWrite({ gated, requestType, plan, value }),
            ]).toEqual([gated.label, plan, value, "allowed"]);
          }
        }
      },
    );

    test.each(GATED_COLUMN_CASES)(
      "%s: switched on needs its plan, and below it is refused with the plan's name",
      (_label: string, gated: GatedColumn) => {
        if (!isWritable(gated, requestType)) {
          return;
        }

        const gate: PlanType | undefined = getGate(gated, requestType);
        const value: unknown = getFeatureValue(gated);

        expect(isPlanGatedColumnDefault(gated.metadata, value)).toBe(false);

        for (const plan of PLANS) {
          const isIncluded: boolean = !gate || isPlanAtLeast(gate, plan);

          expect([
            gated.label,
            plan,
            checkWrite({ gated, requestType, plan, value }),
          ]).toEqual([
            gated.label,
            plan,
            isIncluded ? "allowed" : refusalFor(gate as PlanType),
          ]);
        }
      },
    );
  });

  test("a write that turns one feature off and another on is refused: the exception is per column, not per write", () => {
    const data: StatusPage = new StatusPage();
    data.isReportEnabled = false;
    data.enableSmsSubscribers = true;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        StatusPage,
        data,
        writerOnPlan(
          GATED_COLUMNS.find((gated: GatedColumn): boolean => {
            return gated.label === "StatusPage.isReportEnabled";
          }) as GatedColumn,
          DatabaseRequestType.Update,
          PlanType.Free,
        ),
        DatabaseRequestType.Update,
      );
    }).toThrow(new PaymentRequiredException(refusalFor(PlanType.Growth)));
  });

  test("turning several features off in one write is allowed on Free: reports, SMS subscribers, labels and custom code", () => {
    const data: StatusPage = new StatusPage();
    data.isReportEnabled = false;
    data.enableSmsSubscribers = false;
    data.showIncidentLabelsOnStatusPage = false;
    data.customJavaScript = "";
    data.headerHTML = null as unknown as string;
    data.isPublicStatusPage = true;
    data.hidePoweredByOneUptimeBranding = false;

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        StatusPage,
        data,
        writerOnPlan(
          GATED_COLUMNS.find((gated: GatedColumn): boolean => {
            return gated.label === "StatusPage.isReportEnabled";
          }) as GatedColumn,
          DatabaseRequestType.Update,
          PlanType.Free,
        ),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });

  test("the two cases the report named: email reports off, and a public dashboard private again, on Free", () => {
    const reportsOff: GatedColumn = GATED_COLUMNS.find(
      (gated: GatedColumn): boolean => {
        return gated.label === "StatusPage.isReportEnabled";
      },
    ) as GatedColumn;
    const dashboardPrivate: GatedColumn = GATED_COLUMNS.find(
      (gated: GatedColumn): boolean => {
        return gated.label === "Dashboard.isPublicDashboard";
      },
    ) as GatedColumn;

    for (const gated of [reportsOff, dashboardPrivate]) {
      expect(
        checkWrite({
          gated,
          requestType: DatabaseRequestType.Update,
          plan: PlanType.Free,
          value: false,
        }),
      ).toBe("allowed");
      expect(
        checkWrite({
          gated,
          requestType: DatabaseRequestType.Update,
          plan: PlanType.Free,
          value: true,
        }),
      ).toBe(refusalFor(PlanType.Growth));
    }

    expect(new Dashboard().getTableColumnMetadata("isPublicDashboard")).toEqual(
      expect.objectContaining({ defaultValue: false }),
    );
    expect(new Project().getTableColumnMetadata("requireSsoForLogin")).toEqual(
      expect.objectContaining({ defaultValue: false }),
    );
  });
});

describe("on a self-hosted install (billing off)", () => {
  test.each(GATED_COLUMN_CASES)(
    "%s: no plan is asked, either way",
    (_label: string, gated: GatedColumn) => {
      setTestBillingEnabled(false);

      if (!isWritable(gated, DatabaseRequestType.Update)) {
        return;
      }

      for (const value of [
        ...getDefaultValues(gated),
        getFeatureValue(gated),
      ]) {
        expect([
          gated.label,
          value,
          checkWrite({
            gated,
            requestType: DatabaseRequestType.Update,
            plan: PlanType.Free,
            value,
          }),
        ]).toEqual([gated.label, value, "allowed"]);
      }
    },
  );
});

describe("analytics models", () => {
  test("carry no column-level plan gates, so the turn-off rule has nothing to cover there", () => {
    const gated: Array<string> = [];

    for (const modelType of AllAnalyticsModelTypes) {
      const model: AnalyticsBaseModel = new modelType();

      for (const column of model.getTableColumns()) {
        if (column.billingAccessControl) {
          gated.push(`${modelType.name}.${column.key}`);
        }
      }
    }

    /*
     * If this fails, the analytics ModelPermission's column check needs the
     * same exception as ColumnPermission (PlanGatedColumnDefault).
     */
    expect(gated).toEqual([]);
  });
});

describe("table-level plan gates name the plan the operation needs", () => {
  test("a team (created on Scale, edited on Growth): editing it on Free asks for Growth, not Scale", () => {
    const team: Team = new Team();

    expect(team.createBillingPlan).toBe(PlanType.Scale);
    expect(team.updateBillingPlan).toBe(PlanType.Growth);

    const props: DatabaseCommonInteractionProps = {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      currentPlan: PlanType.Free,
      isSubscriptionUnpaid: false,
    };

    expect(() => {
      BillingPermissions.checkBillingPermissions(
        Team,
        props,
        DatabaseRequestType.Update,
      );
    }).toThrow(new PaymentRequiredException(refusalFor(PlanType.Growth)));

    expect(() => {
      BillingPermissions.checkBillingPermissions(
        Team,
        props,
        DatabaseRequestType.Create,
      );
    }).toThrow(new PaymentRequiredException(refusalFor(PlanType.Scale)));
  });

  test("every gated operation of every model is refused below its own plan, naming it", () => {
    const operations: Array<
      [DatabaseRequestType, (model: BaseModel) => PlanType | null]
    > = [
      [
        DatabaseRequestType.Create,
        (model: BaseModel): PlanType | null => {
          return model.getCreateBillingPlan();
        },
      ],
      [
        DatabaseRequestType.Read,
        (model: BaseModel): PlanType | null => {
          return model.getReadBillingPlan();
        },
      ],
      [
        DatabaseRequestType.Update,
        (model: BaseModel): PlanType | null => {
          return model.getUpdateBillingPlan();
        },
      ],
      [
        DatabaseRequestType.Delete,
        (model: BaseModel): PlanType | null => {
          return model.getDeleteBillingPlan();
        },
      ],
    ];

    let checked: number = 0;

    for (const modelType of AllModelTypes) {
      const model: BaseModel = new modelType();

      for (const [operation, getPlan] of operations) {
        const plan: PlanType | null = getPlan(model);

        if (!plan || plan === PlanType.Free) {
          continue;
        }

        const props: DatabaseCommonInteractionProps = {
          userId: USER_ID,
          tenantId: PROJECT_ID,
          currentPlan: PlanType.Free,
          isSubscriptionUnpaid: false,
        };

        let message: string = "allowed";

        try {
          BillingPermissions.checkBillingPermissions(
            modelType,
            props,
            operation,
          );
        } catch (err) {
          message = (err as Error).message;
        }

        expect([modelType.name, operation, message]).toEqual([
          modelType.name,
          operation,
          refusalFor(plan),
        ]);

        checked++;
      }
    }

    expect(checked).toBeGreaterThan(100);
  });
});
