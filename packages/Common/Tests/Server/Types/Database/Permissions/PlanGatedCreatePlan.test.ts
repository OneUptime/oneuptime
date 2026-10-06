import AllAnalyticsModelTypes from "../../../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import Dashboard from "../../../../../Models/DatabaseModels/Dashboard";
import Form from "../../../../../Models/DatabaseModels/Form";
import Project from "../../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
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
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import StatusPageReportPeriodType from "../../../../../Types/StatusPage/StatusPageReportPeriodType";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../../../Spy";
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

/*
 * A setting a plan sells needs that plan when a record is created with it,
 * as it does when the record is changed later.
 *
 * Every column marked @ColumnBillingAccessControl names a plan for a create
 * and a plan for an update, and the server's column check (ColumnPermission)
 * asks the one for the write it is checking. A create plan lower than the
 * update plan let a record start with a feature switched on that the
 * project could not switch on a moment later - a status page created with
 * custom code or private on Free, a dashboard created public. Writing the
 * column's default (the feature off) needs no plan either way
 * (Types/Billing/PlanGatedColumnDefault), so a create that leaves these
 * settings alone - every create the dashboard makes, and every Terraform
 * create that leaves them at their defaults - works on every plan.
 *
 * Pinned here:
 *   - the guard: no column, and no table, of any model names a lower plan
 *     for a create than for an update. Exceptions would be listed below,
 *     each with its reason; the lists may only shrink, and are empty;
 *   - the 39 columns that asked for their plan only on an update until
 *     now, each with the plan a create now needs, at the column check: on
 *     below it refused with the plan's name, at it allowed, the default
 *     allowed on every plan, nothing asked with billing off;
 *   - whole records at the create check (ModelPermission): the way the
 *     dashboard creates them, with every setting at its default, and with
 *     one paid setting switched on.
 *
 * A new project's own settings are checked against the plan it is created
 * on: see ProjectCreatePlan.test.ts. The service create paths end to end:
 * PlanGatedCreatesThroughServices.test.ts.
 *
 * The plans are read from SUBSCRIPTION_PLAN_* in the environment, which
 * this suite sets itself (and restores). Billing is pinned per test: CI's
 * config.env turns it on.
 */

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
  "5c000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5c000000-0000-4000-8000-000000000002");

type ModelType = { new (): BaseModel };

const refusalFor: (plan: PlanType) => string = (plan: PlanType): string => {
  return `Please upgrade your plan to ${plan} to access this feature`;
};

// Whether a project on `current` has what `required` sells.
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

/*
 * ---------------------------------------------------------------------------
 * The exceptions. A column or a table that keeps a lower plan for a create
 * than for an update is listed here with the reason. Both lists may only
 * shrink: an entry that no longer names a lower create plan fails below, so
 * it is removed with its reason, and the caps keep a new entry from being
 * added without changing them here, in review. Both are empty: every
 * plan-gated setting needs its plan on a create.
 * ---------------------------------------------------------------------------
 */
interface CreatePlanException {
  // "Model.column" for a column, the model's class name for a table.
  name: string;
  reason: string;
}

const COLUMN_CREATE_PLAN_EXCEPTIONS: ReadonlyArray<CreatePlanException> = [];
const TABLE_CREATE_PLAN_EXCEPTIONS: ReadonlyArray<CreatePlanException> = [];

// Lower these when an entry goes. Never raise them.
const MAX_COLUMN_CREATE_PLAN_EXCEPTIONS: number = 0;
const MAX_TABLE_CREATE_PLAN_EXCEPTIONS: number = 0;

interface GatedColumn {
  label: string;
  modelType: ModelType;
  column: string;
  billing: ColumnBillingAccessControl;
  metadata: TableColumnMetadata;
}

const GATED_COLUMNS: Array<GatedColumn> = ((): Array<GatedColumn> => {
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
})();

interface GatedTable {
  label: string;
  create: PlanType;
  update: PlanType;
}

const GATED_TABLES: Array<GatedTable> = ((): Array<GatedTable> => {
  const tables: Array<GatedTable> = [];

  for (const modelType of AllModelTypes) {
    const model: BaseModel = new modelType();
    const create: PlanType | null = model.getCreateBillingPlan();
    const update: PlanType | null = model.getUpdateBillingPlan();

    if (create || update) {
      tables.push({
        label: modelType.name,
        create: create || PlanType.Free,
        update: update || PlanType.Free,
      });
    }
  }

  for (const modelType of AllAnalyticsModelTypes) {
    const model: AnalyticsBaseModel = new modelType();
    const create: PlanType | null = model.getCreateBillingPlan();
    const update: PlanType | null = model.getUpdateBillingPlan();

    if (create || update) {
      tables.push({
        label: modelType.name,
        create: create || PlanType.Free,
        update: update || PlanType.Free,
      });
    }
  }

  return tables.sort((left: GatedTable, right: GatedTable): number => {
    return left.label.localeCompare(right.label);
  });
})();

const isColumnException: (label: string) => boolean = (
  label: string,
): boolean => {
  return COLUMN_CREATE_PLAN_EXCEPTIONS.some(
    (entry: CreatePlanException): boolean => {
      return entry.name === label;
    },
  );
};

const isTableException: (label: string) => boolean = (
  label: string,
): boolean => {
  return TABLE_CREATE_PLAN_EXCEPTIONS.some(
    (entry: CreatePlanException): boolean => {
      return entry.name === label;
    },
  );
};

/*
 * ---------------------------------------------------------------------------
 * The 39 columns whose create plan was lower than their update plan, with
 * the plan a create now needs and a value that switches the feature on.
 * Written out, rather than read from the decorators, so that putting one
 * back to a lower create plan fails here by name.
 * ---------------------------------------------------------------------------
 */
interface AlignedColumn {
  modelType: ModelType;
  column: string;
  plan: PlanType;
  // A value a create could send that switches the feature on.
  featureValue: unknown;
}

const RECURRING_MONTHLY: JSONObject = {
  _type: "Recurring",
  value: { intervalType: "Month", intervalCount: 1 },
};

const ALIGNED_COLUMNS: ReadonlyArray<AlignedColumn> = [
  // A status page's custom code: Growth.
  {
    modelType: StatusPage,
    column: "headerHTML",
    plan: PlanType.Growth,
    featureValue: "<div>Acme status</div>",
  },
  {
    modelType: StatusPage,
    column: "footerHTML",
    plan: PlanType.Growth,
    featureValue: "<footer>Acme</footer>",
  },
  {
    modelType: StatusPage,
    column: "customCSS",
    plan: PlanType.Growth,
    featureValue: "body { color: #111827; }",
  },
  {
    modelType: StatusPage,
    column: "customJavaScript",
    plan: PlanType.Growth,
    featureValue: "console.log('acme');",
  },
  // A private status page: Growth.
  {
    modelType: StatusPage,
    column: "isPublicStatusPage",
    plan: PlanType.Growth,
    featureValue: false,
  },
  // Labels on the page: Growth.
  {
    modelType: StatusPage,
    column: "showIncidentLabelsOnStatusPage",
    plan: PlanType.Growth,
    featureValue: true,
  },
  {
    modelType: StatusPage,
    column: "showScheduledEventLabelsOnStatusPage",
    plan: PlanType.Growth,
    featureValue: true,
  },
  {
    modelType: StatusPage,
    column: "showEpisodeLabelsOnStatusPage",
    plan: PlanType.Growth,
    featureValue: true,
  },
  // What subscribers may choose: Scale.
  {
    modelType: StatusPage,
    column: "allowSubscribersToChooseResources",
    plan: PlanType.Scale,
    featureValue: true,
  },
  {
    modelType: StatusPage,
    column: "allowSubscribersToChooseEventTypes",
    plan: PlanType.Scale,
    featureValue: true,
  },
  // Subscriber channels: SMS on Growth, the others on Scale.
  {
    modelType: StatusPage,
    column: "enableSmsSubscribers",
    plan: PlanType.Growth,
    featureValue: true,
  },
  {
    modelType: StatusPage,
    column: "enableSlackSubscribers",
    plan: PlanType.Scale,
    featureValue: true,
  },
  {
    modelType: StatusPage,
    column: "enableMicrosoftTeamsSubscribers",
    plan: PlanType.Scale,
    featureValue: true,
  },
  {
    modelType: StatusPage,
    column: "enableWebhookSubscribers",
    plan: PlanType.Scale,
    featureValue: true,
  },
  // Branding: Scale.
  {
    modelType: StatusPage,
    column: "hidePoweredByOneUptimeBranding",
    plan: PlanType.Scale,
    featureValue: true,
  },
  // Email reports and their schedule: Growth.
  {
    modelType: StatusPage,
    column: "isReportEnabled",
    plan: PlanType.Growth,
    featureValue: true,
  },
  {
    modelType: StatusPage,
    column: "reportStartDateTime",
    plan: PlanType.Growth,
    featureValue: new Date("2026-11-01T09:00:00.000Z"),
  },
  {
    modelType: StatusPage,
    column: "reportRecurringInterval",
    plan: PlanType.Growth,
    featureValue: RECURRING_MONTHLY,
  },
  {
    modelType: StatusPage,
    column: "sendNextReportBy",
    plan: PlanType.Growth,
    featureValue: new Date("2026-11-01T09:00:00.000Z"),
  },
  {
    modelType: StatusPage,
    column: "reportDataInDays",
    plan: PlanType.Growth,
    featureValue: 90,
  },
  {
    modelType: StatusPage,
    column: "reportPeriodType",
    plan: PlanType.Growth,
    featureValue: StatusPageReportPeriodType.PreviousCalendarPeriod,
  },
  {
    modelType: StatusPage,
    column: "reportTimezone",
    plan: PlanType.Growth,
    featureValue: "America/New_York",
  },
  // The overall uptime percent: Scale.
  {
    modelType: StatusPage,
    column: "showOverallUptimePercentOnStatusPage",
    plan: PlanType.Scale,
    featureValue: true,
  },
  // Hiding a list from the page, and the episodes' history: Growth.
  {
    modelType: StatusPage,
    column: "showIncidentsOnStatusPage",
    plan: PlanType.Growth,
    featureValue: false,
  },
  {
    modelType: StatusPage,
    column: "showAnnouncementsOnStatusPage",
    plan: PlanType.Growth,
    featureValue: false,
  },
  {
    modelType: StatusPage,
    column: "showEpisodesOnStatusPage",
    plan: PlanType.Growth,
    featureValue: false,
  },
  {
    modelType: StatusPage,
    column: "showEpisodeHistoryInDays",
    plan: PlanType.Growth,
    featureValue: 30,
  },
  {
    modelType: StatusPage,
    column: "showScheduledMaintenanceEventsOnStatusPage",
    plan: PlanType.Growth,
    featureValue: false,
  },
  {
    modelType: StatusPage,
    column: "showSubscriberPageOnStatusPage",
    plan: PlanType.Growth,
    featureValue: false,
  },
  // The IP allowlist: Scale.
  {
    modelType: StatusPage,
    column: "ipWhitelist",
    plan: PlanType.Scale,
    featureValue: "10.0.0.0/8",
  },
  // The embedded status badge: Growth.
  {
    modelType: StatusPage,
    column: "enableEmbeddedOverallStatus",
    plan: PlanType.Growth,
    featureValue: true,
  },
  {
    modelType: StatusPage,
    column: "embeddedOverallStatusToken",
    plan: PlanType.Growth,
    featureValue: "acme-badge-token",
  },
  // A public dashboard: Growth. Its IP allowlist: Scale.
  {
    modelType: Dashboard,
    column: "isPublicDashboard",
    plan: PlanType.Growth,
    featureValue: true,
  },
  {
    modelType: Dashboard,
    column: "ipWhitelist",
    plan: PlanType.Scale,
    featureValue: "203.0.113.7",
  },
  // A form's IP allowlist: Scale.
  {
    modelType: Form,
    column: "ipWhitelist",
    plan: PlanType.Scale,
    featureValue: "203.0.113.0/24",
  },
  // A project's Require SSO: Scale. Its audit logs: Enterprise.
  {
    modelType: Project,
    column: "requireSsoForLogin",
    plan: PlanType.Scale,
    featureValue: true,
  },
  {
    modelType: Project,
    column: "enableAuditLogs",
    plan: PlanType.Enterprise,
    featureValue: true,
  },
  {
    modelType: Project,
    column: "auditLogsRetentionInDays",
    plan: PlanType.Enterprise,
    featureValue: 90,
  },
  {
    modelType: Project,
    column: "storeSystemEventsInAuditLogs",
    plan: PlanType.Enterprise,
    featureValue: true,
  },
];

const labelOf: (aligned: AlignedColumn) => string = (
  aligned: AlignedColumn,
): string => {
  return `${aligned.modelType.name}.${aligned.column}`;
};

const ALIGNED_COLUMN_CASES: Array<[string, AlignedColumn]> =
  ALIGNED_COLUMNS.map((aligned: AlignedColumn): [string, AlignedColumn] => {
    return [labelOf(aligned), aligned];
  });

const metadataOf: (aligned: AlignedColumn) => TableColumnMetadata = (
  aligned: AlignedColumn,
): TableColumnMetadata => {
  return new aligned.modelType().getTableColumnMetadata(aligned.column);
};

// The values that leave the column at its default: the feature off.
const defaultValuesOf: (metadata: TableColumnMetadata) => Array<unknown> = (
  metadata: TableColumnMetadata,
): Array<unknown> => {
  const defaultValue: unknown = metadata.defaultValue;

  if (defaultValue !== undefined && defaultValue !== null) {
    return [defaultValue];
  }

  return EMPTY_TEXT_COLUMN_TYPES.includes(metadata.type) ? [null, ""] : [null];
};

// The permissions that may write a column on a create, by its access control.
const createPermissionsOf: (
  modelType: ModelType,
  column: string,
) => Array<Permission> = (
  modelType: ModelType,
  column: string,
): Array<Permission> => {
  const access: ColumnAccessControl | undefined =
    new modelType().getColumnAccessControlForAllColumns()[column];

  return access?.create || [];
};

/*
 * Someone a model's own create lists let create it, on a plan: a project
 * owner, or - for a project, which is created before anyone is its owner -
 * a signed-in user, who is who creates a project.
 */
const creatorOnPlan: (
  modelType: ModelType,
  plan: PlanType,
) => DatabaseCommonInteractionProps = (
  modelType: ModelType,
  plan: PlanType,
): DatabaseCommonInteractionProps => {
  if (modelType === Project) {
    return {
      userId: USER_ID,
      currentPlan: plan,
      isSubscriptionUnpaid: false,
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public, Permission.User],
        projectIds: [],
        _type: "UserGlobalAccessPermission",
      },
    } as DatabaseCommonInteractionProps;
  }

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
            permission: Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      } as UserTenantAccessPermission,
    },
  };
};

// What the column check says about a create: "allowed", or its refusal.
const checkCreate: (input: {
  modelType: ModelType;
  plan: PlanType;
  data: Record<string, unknown>;
}) => string = (input: {
  modelType: ModelType;
  plan: PlanType;
  data: Record<string, unknown>;
}): string => {
  try {
    ColumnPermissions.checkDataColumnPermissions(
      input.modelType,
      input.data as unknown as BaseModel,
      creatorOnPlan(input.modelType, input.plan),
      DatabaseRequestType.Create,
    );

    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
};

// What the whole create check says about a record: "allowed", or its refusal.
const checkRecordCreate: (input: {
  modelType: ModelType;
  plan: PlanType;
  record: BaseModel;
}) => string = (input: {
  modelType: ModelType;
  plan: PlanType;
  record: BaseModel;
}): string => {
  try {
    ModelPermission.checkCreatePermissions(
      input.modelType,
      input.record,
      creatorOnPlan(input.modelType, input.plan),
    );

    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
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
  getJestSpyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the guard: a create never needs less than an update", () => {
  test("the sweep finds the plan-gated columns and tables of every model", () => {
    const columnLabels: Array<string> = GATED_COLUMNS.map(
      (gated: GatedColumn): string => {
        return gated.label;
      },
    );

    for (const aligned of ALIGNED_COLUMNS) {
      expect(columnLabels).toContain(labelOf(aligned));
    }

    expect(columnLabels).toContain("StatusPage.requireSsoForLogin");
    expect(columnLabels).toContain("Service.retainTelemetryDataForDays");
    expect(GATED_COLUMNS.length).toBeGreaterThanOrEqual(70);

    const tableLabels: Array<string> = GATED_TABLES.map(
      (table: GatedTable): string => {
        return table.label;
      },
    );

    for (const expected of [
      "Form",
      "ApiKey",
      "ProjectSSO",
      "StatusPageAnnouncement",
      "Team",
      "AuditLog",
      "RumSession",
    ]) {
      expect(tableLabels).toContain(expected);
    }

    expect(GATED_TABLES.length).toBeGreaterThanOrEqual(100);
  });

  test.each(
    GATED_COLUMNS.map((gated: GatedColumn): [string, GatedColumn] => {
      return [gated.label, gated];
    }),
  )(
    "%s: a create needs at least the plan an update needs",
    (label: string, gated: GatedColumn) => {
      if (isColumnException(label)) {
        return;
      }

      expect([
        label,
        gated.billing.create,
        isPlanAtLeast(gated.billing.update, gated.billing.create),
      ]).toEqual([label, gated.billing.create, true]);
    },
  );

  test.each(
    GATED_TABLES.map((table: GatedTable): [string, GatedTable] => {
      return [table.label, table];
    }),
  )(
    "the %s table: a create needs at least the plan an update needs",
    (label: string, table: GatedTable) => {
      if (isTableException(label)) {
        return;
      }

      expect([
        label,
        table.create,
        isPlanAtLeast(table.update, table.create),
      ]).toEqual([label, table.create, true]);
    },
  );

  test("the exceptions only shrink: within their caps, each with a reason, each still an exception", () => {
    expect(COLUMN_CREATE_PLAN_EXCEPTIONS.length).toBeLessThanOrEqual(
      MAX_COLUMN_CREATE_PLAN_EXCEPTIONS,
    );
    expect(TABLE_CREATE_PLAN_EXCEPTIONS.length).toBeLessThanOrEqual(
      MAX_TABLE_CREATE_PLAN_EXCEPTIONS,
    );

    for (const entry of COLUMN_CREATE_PLAN_EXCEPTIONS) {
      expect([entry.name, entry.reason.trim().length > 20]).toEqual([
        entry.name,
        true,
      ]);

      const gated: GatedColumn | undefined = GATED_COLUMNS.find(
        (candidate: GatedColumn): boolean => {
          return candidate.label === entry.name;
        },
      );

      // Gone, or its create plan reaches its update plan now: remove it.
      expect([
        entry.name,
        Boolean(gated) &&
          !isPlanAtLeast(
            (gated as GatedColumn).billing.update,
            (gated as GatedColumn).billing.create,
          ),
      ]).toEqual([entry.name, true]);
    }

    for (const entry of TABLE_CREATE_PLAN_EXCEPTIONS) {
      expect([entry.name, entry.reason.trim().length > 20]).toEqual([
        entry.name,
        true,
      ]);

      const table: GatedTable | undefined = GATED_TABLES.find(
        (candidate: GatedTable): boolean => {
          return candidate.label === entry.name;
        },
      );

      expect([
        entry.name,
        Boolean(table) &&
          !isPlanAtLeast(
            (table as GatedTable).update,
            (table as GatedTable).create,
          ),
      ]).toEqual([entry.name, true]);
    }
  });

  test("negative control: the comparison the guard makes refuses a create plan below the update plan", () => {
    expect(isPlanAtLeast(PlanType.Growth, PlanType.Free)).toBe(false);
    expect(isPlanAtLeast(PlanType.Scale, PlanType.Growth)).toBe(false);
    expect(isPlanAtLeast(PlanType.Enterprise, PlanType.Scale)).toBe(false);
    expect(isPlanAtLeast(PlanType.Growth, PlanType.Growth)).toBe(true);
    expect(isPlanAtLeast(PlanType.Growth, PlanType.Scale)).toBe(true);
  });
});

describe("the 39 settings that asked for their plan only when changed", () => {
  test("are 39, and no column is listed twice", () => {
    const labels: Array<string> = ALIGNED_COLUMNS.map(labelOf);

    expect(labels).toHaveLength(39);
    expect(new Set(labels).size).toBe(39);
  });

  test.each(ALIGNED_COLUMN_CASES)(
    "%s: a create and an update need the same plan",
    (_label: string, aligned: AlignedColumn) => {
      const billing: ColumnBillingAccessControl =
        new aligned.modelType().getColumnBillingAccessControl(aligned.column);

      expect(billing).toEqual({
        read: PlanType.Free,
        create: aligned.plan,
        update: aligned.plan,
      });
    },
  );

  test.each(ALIGNED_COLUMN_CASES)(
    "%s: the value used to switch it on is not its default",
    (_label: string, aligned: AlignedColumn) => {
      expect(
        isPlanGatedColumnDefault(metadataOf(aligned), aligned.featureValue),
      ).toBe(false);
    },
  );
});

describe("on OneUptime Cloud (billing on), at the create's column check", () => {
  test.each(ALIGNED_COLUMN_CASES)(
    "%s: created switched on, it is refused below its plan with the plan's name, and allowed from it",
    (label: string, aligned: AlignedColumn) => {
      if (createPermissionsOf(aligned.modelType, aligned.column).length === 0) {
        // Nobody may write it on a create; see the test below.
        return;
      }

      for (const plan of PLANS) {
        expect([
          label,
          plan,
          checkCreate({
            modelType: aligned.modelType,
            plan,
            data: { [aligned.column]: aligned.featureValue },
          }),
        ]).toEqual([
          label,
          plan,
          isPlanAtLeast(aligned.plan, plan)
            ? "allowed"
            : refusalFor(aligned.plan),
        ]);
      }
    },
  );

  test.each(ALIGNED_COLUMN_CASES)(
    "%s: created at its default - the feature off - it is allowed on every plan",
    (label: string, aligned: AlignedColumn) => {
      if (createPermissionsOf(aligned.modelType, aligned.column).length === 0) {
        return;
      }

      for (const value of defaultValuesOf(metadataOf(aligned))) {
        for (const plan of PLANS) {
          expect([
            label,
            plan,
            value,
            checkCreate({
              modelType: aligned.modelType,
              plan,
              data: { [aligned.column]: value },
            }),
          ]).toEqual([label, plan, value, "allowed"]);
        }
      }
    },
  );

  test("a project's Require SSO is not written on a create by anyone, whatever the plan: the column's own access refuses it first", () => {
    expect(createPermissionsOf(Project, "requireSsoForLogin")).toEqual([]);

    for (const plan of PLANS) {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          Project,
          { requireSsoForLogin: true } as unknown as Project,
          creatorOnPlan(Project, plan),
          DatabaseRequestType.Create,
        );
      }).toThrow(BadDataException);
    }
  });

  test("a create that switches one setting off and another on is refused: the default is allowed per column, not per write", () => {
    expect(
      checkCreate({
        modelType: StatusPage,
        plan: PlanType.Free,
        data: { isReportEnabled: false, customCSS: "body { margin: 0; }" },
      }),
    ).toBe(refusalFor(PlanType.Growth));
  });

  test("an unclear value is not the default: text for a switch, or a number as text, still needs the plan", () => {
    for (const data of [
      { isPublicStatusPage: "false" },
      { enableSmsSubscribers: "true" },
      { showEpisodeHistoryInDays: "14" },
      { reportDataInDays: "30" },
    ]) {
      expect([
        data,
        checkCreate({ modelType: StatusPage, plan: PlanType.Free, data }),
      ]).toEqual([data, refusalFor(PlanType.Growth)]);
    }
  });

  test("the plan a refusal names is the setting's own: a Scale setting on Growth names Scale", () => {
    expect(
      checkCreate({
        modelType: StatusPage,
        plan: PlanType.Growth,
        data: { enableSlackSubscribers: true },
      }),
    ).toBe(refusalFor(PlanType.Scale));
    expect(
      checkCreate({
        modelType: Project,
        plan: PlanType.Scale,
        data: { enableAuditLogs: true },
      }),
    ).toBe(refusalFor(PlanType.Enterprise));
  });
});

describe("on OneUptime Cloud (billing on), whole records at the create check", () => {
  // A status page as the dashboard's Create form makes it.
  const dashboardStatusPage: () => StatusPage = (): StatusPage => {
    const page: StatusPage = new StatusPage();
    page.name = "Customer status";
    page.description = "What our customers see";
    page.projectId = PROJECT_ID;
    return page;
  };

  /*
   * Every plan-gated setting of the model at its default: what an API or
   * Terraform create sends for the settings it leaves alone (the provider
   * plans each attribute's default, which is the column's default).
   */
  const withEveryGatedSettingAtItsDefault: <T extends BaseModel>(
    record: T,
  ) => T = <T extends BaseModel>(record: T): T => {
    for (const gated of GATED_COLUMNS) {
      if (gated.modelType !== record.constructor) {
        continue;
      }

      // A column nobody may write on a create is left out, as a client does.
      if (createPermissionsOf(gated.modelType, gated.column).length === 0) {
        continue;
      }

      record.setColumnValue(gated.column, defaultValuesOf(gated.metadata)[0]);
    }

    return record;
  };

  test.each(PLANS)(
    "a status page created the way the dashboard creates one is allowed on %s",
    (plan: PlanType) => {
      expect(
        checkRecordCreate({
          modelType: StatusPage,
          plan,
          record: dashboardStatusPage(),
        }),
      ).toBe("allowed");
    },
  );

  test.each(PLANS)(
    "a status page created with every paid setting at its default, as Terraform sends them, is allowed on %s",
    (plan: PlanType) => {
      const record: StatusPage = withEveryGatedSettingAtItsDefault(
        dashboardStatusPage(),
      );

      expect(record.isPublicStatusPage).toBe(true);
      expect(record.showIncidentsOnStatusPage).toBe(true);
      expect(record.reportDataInDays).toBe(30);

      expect(
        checkRecordCreate({ modelType: StatusPage, plan, record }),
      ).toBe("allowed");
    },
  );

  test("a status page created private, or with custom code, is refused on Free naming Growth, and created on Growth", () => {
    const privatePage: StatusPage = dashboardStatusPage();
    privatePage.isPublicStatusPage = false;

    const customCodePage: StatusPage = dashboardStatusPage();
    customCodePage.customCSS = "body { color: #111827; }";
    customCodePage.headerHTML = "<div>Acme</div>";

    for (const record of [privatePage, customCodePage]) {
      expect(
        checkRecordCreate({
          modelType: StatusPage,
          plan: PlanType.Free,
          record,
        }),
      ).toBe(refusalFor(PlanType.Growth));
      expect(
        checkRecordCreate({
          modelType: StatusPage,
          plan: PlanType.Growth,
          record,
        }),
      ).toBe("allowed");
    }
  });

  test("a status page created with email reports on is refused on Free, and created on Growth with its schedule", () => {
    const record: StatusPage = dashboardStatusPage();
    record.isReportEnabled = true;
    record.reportRecurringInterval = RECURRING_MONTHLY as never;
    record.reportStartDateTime = new Date("2026-11-01T09:00:00.000Z");
    record.reportTimezone = "Europe/London" as never;

    expect(
      checkRecordCreate({
        modelType: StatusPage,
        plan: PlanType.Free,
        record,
      }),
    ).toBe(refusalFor(PlanType.Growth));
    expect(
      checkRecordCreate({
        modelType: StatusPage,
        plan: PlanType.Growth,
        record,
      }),
    ).toBe("allowed");
  });

  test("one paid setting switched on refuses the create, even with every other one left at its default", () => {
    const record: StatusPage = withEveryGatedSettingAtItsDefault(
      dashboardStatusPage(),
    );
    record.enableWebhookSubscribers = true;

    expect(
      checkRecordCreate({
        modelType: StatusPage,
        plan: PlanType.Growth,
        record,
      }),
    ).toBe(refusalFor(PlanType.Scale));
    expect(
      checkRecordCreate({
        modelType: StatusPage,
        plan: PlanType.Scale,
        record,
      }),
    ).toBe("allowed");
  });

  test("a dashboard created public is refused on Free naming Growth; with an IP allowlist, refused on Growth naming Scale", () => {
    const publicDashboard: Dashboard = new Dashboard();
    publicDashboard.name = "Service health";
    publicDashboard.projectId = PROJECT_ID;
    publicDashboard.isPublicDashboard = true;

    expect(
      checkRecordCreate({
        modelType: Dashboard,
        plan: PlanType.Free,
        record: publicDashboard,
      }),
    ).toBe(refusalFor(PlanType.Growth));
    expect(
      checkRecordCreate({
        modelType: Dashboard,
        plan: PlanType.Growth,
        record: publicDashboard,
      }),
    ).toBe("allowed");

    publicDashboard.ipWhitelist = "203.0.113.7";

    expect(
      checkRecordCreate({
        modelType: Dashboard,
        plan: PlanType.Growth,
        record: publicDashboard,
      }),
    ).toBe(refusalFor(PlanType.Scale));
    expect(
      checkRecordCreate({
        modelType: Dashboard,
        plan: PlanType.Scale,
        record: publicDashboard,
      }),
    ).toBe("allowed");

    const privateDashboard: Dashboard = new Dashboard();
    privateDashboard.name = "Team only";
    privateDashboard.projectId = PROJECT_ID;
    privateDashboard.isPublicDashboard = false;
    privateDashboard.ipWhitelist = "";

    expect(
      checkRecordCreate({
        modelType: Dashboard,
        plan: PlanType.Free,
        record: privateDashboard,
      }),
    ).toBe("allowed");
  });

  test("a form (a Growth table) created with an IP allowlist is refused on Growth naming Scale, and created on Scale; without one it is created on Growth", () => {
    const formWithAllowlist: Form = new Form();
    formWithAllowlist.name = "Bug report";
    formWithAllowlist.projectId = PROJECT_ID;
    formWithAllowlist.ipWhitelist = "203.0.113.0/24";

    expect(
      checkRecordCreate({
        modelType: Form,
        plan: PlanType.Growth,
        record: formWithAllowlist,
      }),
    ).toBe(refusalFor(PlanType.Scale));
    expect(
      checkRecordCreate({
        modelType: Form,
        plan: PlanType.Scale,
        record: formWithAllowlist,
      }),
    ).toBe("allowed");

    const plainForm: Form = new Form();
    plainForm.name = "Feedback";
    plainForm.projectId = PROJECT_ID;
    plainForm.ipWhitelist = null as unknown as string;

    expect(
      checkRecordCreate({
        modelType: Form,
        plan: PlanType.Growth,
        record: plainForm,
      }),
    ).toBe("allowed");

    // Below the table's own plan the table refuses first, naming Growth.
    expect(
      checkRecordCreate({
        modelType: Form,
        plan: PlanType.Free,
        record: formWithAllowlist,
      }),
    ).toBe(refusalFor(PlanType.Growth));
  });

  test("a project created with audit logs on, or kept longer, needs Enterprise; with the defaults it is created on Free", () => {
    const withAuditLogs: Project = new Project();
    withAuditLogs.name = "Acme";
    withAuditLogs.enableAuditLogs = true;
    withAuditLogs.storeSystemEventsInAuditLogs = true;

    const longerRetention: Project = new Project();
    longerRetention.name = "Acme";
    longerRetention.auditLogsRetentionInDays = 90;

    for (const record of [withAuditLogs, longerRetention]) {
      for (const plan of [PlanType.Free, PlanType.Growth, PlanType.Scale]) {
        expect([
          plan,
          checkRecordCreate({ modelType: Project, plan, record }),
        ]).toEqual([plan, refusalFor(PlanType.Enterprise)]);
      }

      expect(
        checkRecordCreate({
          modelType: Project,
          plan: PlanType.Enterprise,
          record,
        }),
      ).toBe("allowed");
    }

    const withDefaults: Project = new Project();
    withDefaults.name = "Acme";
    withDefaults.enableAuditLogs = false;
    withDefaults.storeSystemEventsInAuditLogs = false;
    withDefaults.auditLogsRetentionInDays = 7;

    expect(
      checkRecordCreate({
        modelType: Project,
        plan: PlanType.Free,
        record: withDefaults,
      }),
    ).toBe("allowed");
  });
});

describe("on a self-hosted install (billing off)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test.each(ALIGNED_COLUMN_CASES)(
    "%s: created switched on, no plan is asked, whatever plan the props carry",
    (label: string, aligned: AlignedColumn) => {
      if (createPermissionsOf(aligned.modelType, aligned.column).length === 0) {
        return;
      }

      for (const plan of PLANS) {
        expect([
          label,
          plan,
          checkCreate({
            modelType: aligned.modelType,
            plan,
            data: { [aligned.column]: aligned.featureValue },
          }),
        ]).toEqual([label, plan, "allowed"]);
      }
    },
  );

  test("whole records with paid settings on are created on Free", () => {
    const page: StatusPage = new StatusPage();
    page.name = "Customer status";
    page.projectId = PROJECT_ID;
    page.isPublicStatusPage = false;
    page.customCSS = "body { margin: 0; }";
    page.enableSlackSubscribers = true;

    const dashboard: Dashboard = new Dashboard();
    dashboard.name = "Service health";
    dashboard.projectId = PROJECT_ID;
    dashboard.isPublicDashboard = true;

    expect(
      checkRecordCreate({
        modelType: StatusPage,
        plan: PlanType.Free,
        record: page,
      }),
    ).toBe("allowed");
    expect(
      checkRecordCreate({
        modelType: Dashboard,
        plan: PlanType.Free,
        record: dashboard,
      }),
    ).toBe("allowed");
  });
});
