import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import ProjectSso from "../../../../../Models/DatabaseModels/ProjectSso";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../../../Server/Types/Database/Permissions/BillingPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  PLAN_GATED_TABLE_SWITCH_COLUMN,
  getPlanGatedTableSwitchColumn,
} from "../../../../../Types/Billing/PlanGatedTable";
import SubscriptionPlan, {
  PlanType,
} from "../../../../../Types/Billing/SubscriptionPlan";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
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

/*
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed.
 *
 * Every table with @TableBillingAccessControl holds a feature a plan sells.
 * A project that drops below the plan keeps what it set up, and much of it
 * keeps working - SSO providers sign people in, SCIM connections provision
 * them, Slack and Microsoft Teams rules post, API keys authenticate,
 * schedules page people. So on OneUptime Cloud (billing on), for the
 * records a project already has, whatever its plan (Types/Billing/
 * PlanGatedTable):
 *   - deleting them is allowed - except on a table whose records restrict
 *     something, where deleting one gives more than the plan allows (an API
 *     key's block permissions: deleteStaysGated);
 *   - an update that only switches them off (isEnabled false, nothing else)
 *     is allowed;
 *   - reading them is allowed on the tables of configuration that keeps
 *     working after a downgrade (readableBelowPlan: SSO providers, SCIM
 *     connections, API keys, schedules, Slack and Microsoft Teams rules).
 *     Every other table keeps its read plan: features read their
 *     configuration with the caller's permissions, so a read allowed below
 *     the plan would be the feature working below it;
 *   - creating, switching back on and every other update still need the
 *     plan, refused with its name.
 *
 * This sweeps EVERY plan-gated table, so a new one is covered the day it is
 * added, and pins the tables readable below the plan, the tables whose
 * deletes keep the plan and the tables that can be switched off, so adding
 * to any of them is a decision someone makes.
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
  "6d000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("6d000000-0000-4000-8000-000000000002");

/*
 * The tables of configuration that keeps working after a project drops below
 * the plan - signing people in, provisioning them, authenticating, paging,
 * posting - and that someone has to find to stop: below the read plan, the
 * records a project has stay readable. Each has a view under its page's
 * upsell (Dashboard Components/Billing). A table added here is readable
 * below its plan by every feature that reads it with the caller's
 * permissions, so each one is a decision.
 */
const READABLE_BELOW_PLAN_TABLES: ReadonlyArray<string> = [
  "ApiKey",
  "APIKeyPermission",
  "OnCallDutyPolicySchedule",
  "ProjectOIDC",
  "ProjectSCIM",
  "ProjectSSO",
  "StatusPageOIDC",
  "StatusPageSCIM",
  "StatusPageSSO",
  "WorkspaceNotificationRule",
  "WorkspaceNotificationSummary",
];

/*
 * The tables whose records restrict something, so deleting one gives more
 * than the plan allows: below the delete plan they are not deleted. An API
 * key's block permissions narrow the key; the key itself can still be
 * deleted, and its permissions go with it.
 */
const DELETE_STAYS_GATED_TABLES: ReadonlyArray<string> = ["APIKeyPermission"];

// A column that marks a record as a restriction (a block, a deny).
const RESTRICTION_COLUMN: RegExp = /^is(Block|Deny|Excluded?)/;

/*
 * The plan-gated tables whose updates need a plan above Free and that have
 * a switch (a boolean isEnabled column): below the plan their records can be
 * switched off. A table with no switch is stopped by deleting its records.
 */
const SWITCHABLE_TABLES: ReadonlyArray<string> = [
  "Form",
  "OnCallDutyPolicyScheduleCalendarFeed",
  "ProjectOIDC",
  "ProjectOnCallCalendarFeed",
  "ProjectSSO",
  "StatusPageOIDC",
  "StatusPageSSO",
  "UserOnCallCalendarFeed",
  "Workflow",
  "WorkspaceNotificationSummary",
];

/*
 * Boolean columns on update-gated plan-gated tables that look like an off
 * state but are not the table's switch, and why that is fine. A new one
 * fails the guard below until someone decides.
 */
const OTHER_SWITCH_LIKE_COLUMNS: Record<string, string> = {
  /*
   * A compliance rule's own switch. The table is read and deleted on every
   * plan already (read: Free, delete: Free), so a rule a Scale trial left
   * can be seen and removed below Scale.
   */
  "TeamComplianceSetting.enabled": "deleted on every plan",
  /*
   * A status page viewer's sign-in session. Nobody writes sessions through
   * the API (no create, read, update or delete permission), so there is no
   * switch to offer.
   */
  "StatusPagePrivateUserSession.isRevoked": "no API access at all",
};

const SWITCH_LIKE_COLUMN: RegExp =
  /^(is)?(enabled|active|disabled|paused|revoked|on|off)$/i;

type ModelType = { new (): BaseModel };

interface GatedTable {
  name: string;
  modelType: ModelType;
  plans: Record<DatabaseRequestType, PlanType | null>;
}

const OPERATIONS: ReadonlyArray<DatabaseRequestType> = [
  DatabaseRequestType.Create,
  DatabaseRequestType.Read,
  DatabaseRequestType.Update,
  DatabaseRequestType.Delete,
];

const getGatedTables: () => Array<GatedTable> = (): Array<GatedTable> => {
  const tables: Array<GatedTable> = [];

  for (const modelType of AllModelTypes) {
    const model: BaseModel = new modelType();
    const plans: Record<DatabaseRequestType, PlanType | null> = {
      [DatabaseRequestType.Create]: model.getCreateBillingPlan() || null,
      [DatabaseRequestType.Read]: model.getReadBillingPlan() || null,
      [DatabaseRequestType.Update]: model.getUpdateBillingPlan() || null,
      [DatabaseRequestType.Delete]: model.getDeleteBillingPlan() || null,
    };

    if (
      OPERATIONS.some((operation: DatabaseRequestType): boolean => {
        return Boolean(plans[operation]);
      })
    ) {
      tables.push({ name: modelType.name, modelType, plans });
    }
  }

  return tables.sort((left: GatedTable, right: GatedTable): number => {
    return left.name.localeCompare(right.name);
  });
};

const GATED_TABLES: Array<GatedTable> = getGatedTables();

const GATED_TABLE_CASES: Array<[string, GatedTable]> = GATED_TABLES.map(
  (table: GatedTable): [string, GatedTable] => {
    return [table.name, table];
  },
);

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

const refusalFor: (plan: PlanType) => string = (plan: PlanType): string => {
  return `Please upgrade your plan to ${plan} to access this feature`;
};

const propsOnPlan: (
  plan: PlanType,
  extra?: Partial<DatabaseCommonInteractionProps>,
) => DatabaseCommonInteractionProps = (
  plan: PlanType,
  extra?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps => {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    currentPlan: plan,
    isSubscriptionUnpaid: false,
    ...extra,
  };
};

// What the plan check answers: "allowed", or the refusal's message.
const check: (data: {
  table: GatedTable;
  operation: DatabaseRequestType;
  plan: PlanType;
  updateData?: unknown;
  props?: Partial<DatabaseCommonInteractionProps>;
}) => string = (data: {
  table: GatedTable;
  operation: DatabaseRequestType;
  plan: PlanType;
  updateData?: unknown;
  props?: Partial<DatabaseCommonInteractionProps>;
}): string => {
  try {
    BillingPermissions.checkBillingPermissions(
      data.table.modelType,
      propsOnPlan(data.plan, data.props),
      data.operation,
      data.updateData,
    );
    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
};

// The plans below the one an operation needs (none when it needs none).
const plansBelow: (required: PlanType | null) => Array<PlanType> = (
  required: PlanType | null,
): Array<PlanType> => {
  if (!required) {
    return [];
  }

  return PLANS.filter((plan: PlanType): boolean => {
    return !isPlanAtLeast(required, plan);
  });
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
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the plan-gated tables", () => {
  test("are swept: every model with a table-level plan is here", () => {
    expect(GATED_TABLES.length).toBeGreaterThan(100);
    expect(
      GATED_TABLES.map((table: GatedTable): string => {
        return table.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "ApiKey",
        "APIKeyPermission",
        "OnCallDutyPolicySchedule",
        "ProjectOIDC",
        "ProjectSCIM",
        "ProjectSSO",
        "StatusPageOIDC",
        "StatusPageSCIM",
        "StatusPageSSO",
        "WorkspaceNotificationRule",
        "WorkspaceNotificationSummary",
      ]),
    );
  });

  test("readable below the plan are exactly the configuration that keeps working, each with a read plan above Free", () => {
    const readable: Array<string> = GATED_TABLES.filter(
      (table: GatedTable): boolean => {
        return Boolean(new table.modelType().readableBelowPlan);
      },
    ).map((table: GatedTable): string => {
      return table.name;
    });

    expect(readable).toEqual([...READABLE_BELOW_PLAN_TABLES]);

    for (const table of GATED_TABLES) {
      if (!READABLE_BELOW_PLAN_TABLES.includes(table.name)) {
        continue;
      }

      const readPlan: PlanType | null = table.plans[DatabaseRequestType.Read];

      expect([
        table.name,
        Boolean(readPlan && readPlan !== PlanType.Free),
      ]).toEqual([table.name, true]);
    }
  });

  test("whose deletes keep the plan are exactly these, each with a delete plan above Free", () => {
    const deleteStaysGated: Array<string> = GATED_TABLES.filter(
      (table: GatedTable): boolean => {
        return Boolean(new table.modelType().deleteStaysGated);
      },
    ).map((table: GatedTable): string => {
      return table.name;
    });

    expect(deleteStaysGated).toEqual([...DELETE_STAYS_GATED_TABLES]);

    for (const table of GATED_TABLES) {
      if (!DELETE_STAYS_GATED_TABLES.includes(table.name)) {
        continue;
      }

      const deletePlan: PlanType | null =
        table.plans[DatabaseRequestType.Delete];

      expect([
        table.name,
        Boolean(deletePlan && deletePlan !== PlanType.Free),
      ]).toEqual([table.name, true]);
    }
  });

  /*
   * A record that restricts something - a block, a deny - widens access
   * when it is deleted. A delete-gated table with such a column has to keep
   * its delete plan, or a project below the plan could lift a restriction
   * the plan put there.
   */
  test("with a restriction column (a block permission) keep their delete plan", () => {
    const restricting: Array<string> = [];

    for (const table of GATED_TABLES) {
      const deletePlan: PlanType | null =
        table.plans[DatabaseRequestType.Delete];

      if (!deletePlan || deletePlan === PlanType.Free) {
        continue;
      }

      const model: BaseModel = new table.modelType();

      const hasRestriction: boolean = model
        .getTableColumns()
        .columns.some((column: string): boolean => {
          const metadata: TableColumnMetadata =
            model.getTableColumnMetadata(column);

          return (
            Boolean(metadata) &&
            metadata.type === TableColumnType.Boolean &&
            RESTRICTION_COLUMN.test(column)
          );
        });

      if (hasRestriction) {
        restricting.push(table.name);
      }
    }

    expect(restricting).toEqual(["APIKeyPermission"]);

    for (const name of restricting) {
      expect([name, DELETE_STAYS_GATED_TABLES.includes(name)]).toEqual([
        name,
        true,
      ]);
    }
  });

  test("that can be switched off below their update plan are exactly these (a boolean isEnabled column)", () => {
    const switchable: Array<string> = GATED_TABLES.filter(
      (table: GatedTable): boolean => {
        const updatePlan: PlanType | null =
          table.plans[DatabaseRequestType.Update];

        return (
          Boolean(updatePlan && updatePlan !== PlanType.Free) &&
          getPlanGatedTableSwitchColumn(new table.modelType()) !== null
        );
      },
    ).map((table: GatedTable): string => {
      return table.name;
    });

    expect(switchable).toEqual([...SWITCHABLE_TABLES]);
  });

  test("have no other boolean that looks like an off state without a decision about it", () => {
    const found: Array<string> = [];

    for (const table of GATED_TABLES) {
      const updatePlan: PlanType | null =
        table.plans[DatabaseRequestType.Update];

      if (!updatePlan || updatePlan === PlanType.Free) {
        continue;
      }

      const model: BaseModel = new table.modelType();

      for (const column of model.getTableColumns().columns) {
        if (column === PLAN_GATED_TABLE_SWITCH_COLUMN) {
          continue;
        }

        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        if (
          metadata &&
          metadata.type === TableColumnType.Boolean &&
          SWITCH_LIKE_COLUMN.test(column)
        ) {
          found.push(`${table.name}.${column}`);
        }
      }
    }

    expect(found.sort()).toEqual(Object.keys(OTHER_SWITCH_LIKE_COLUMNS).sort());
  });
});

describe.each(GATED_TABLE_CASES)("%s", (_name: string, table: GatedTable) => {
  const switchColumn: string | null = getPlanGatedTableSwitchColumn(
    new table.modelType(),
  );
  const readableBelowPlan: boolean = READABLE_BELOW_PLAN_TABLES.includes(
    table.name,
  );
  const deleteStaysGated: boolean = DELETE_STAYS_GATED_TABLES.includes(
    table.name,
  );

  test("below the create plan, creating is refused with the plan's name", () => {
    const createPlan: PlanType | null = table.plans[DatabaseRequestType.Create];

    for (const plan of plansBelow(createPlan)) {
      expect([
        plan,
        check({ table, operation: DatabaseRequestType.Create, plan }),
      ]).toEqual([plan, refusalFor(createPlan as PlanType)]);

      // What a create writes never makes it a switch-off.
      expect([
        plan,
        check({
          table,
          operation: DatabaseRequestType.Create,
          plan,
          updateData: { isEnabled: false },
        }),
      ]).toEqual([plan, refusalFor(createPlan as PlanType)]);
    }
  });

  test(
    readableBelowPlan
      ? "below the read plan, the records it has can still be read"
      : "below the read plan, reading stays refused with the plan's name",
    () => {
      const readPlan: PlanType | null = table.plans[DatabaseRequestType.Read];

      for (const plan of plansBelow(readPlan)) {
        expect([
          plan,
          check({ table, operation: DatabaseRequestType.Read, plan }),
        ]).toEqual([
          plan,
          readableBelowPlan ? "allowed" : refusalFor(readPlan as PlanType),
        ]);
      }
    },
  );

  test(
    deleteStaysGated
      ? "below the delete plan, deleting stays refused: a deleted record would give more than the plan allows"
      : "below the delete plan, the records it has can still be deleted",
    () => {
      const deletePlan: PlanType | null =
        table.plans[DatabaseRequestType.Delete];

      for (const plan of plansBelow(deletePlan)) {
        expect([
          plan,
          check({ table, operation: DatabaseRequestType.Delete, plan }),
        ]).toEqual([
          plan,
          deleteStaysGated ? refusalFor(deletePlan as PlanType) : "allowed",
        ]);
      }
    },
  );

  // A route that uses the feature asks the plan without the leftovers rule.
  test("the feature's own plan check refuses every operation below its plan", () => {
    for (const operation of OPERATIONS) {
      const required: PlanType | null = table.plans[operation];

      for (const plan of plansBelow(required)) {
        let answer: string = "allowed";

        try {
          BillingPermissions.checkFeatureIsOnPlan(
            table.modelType,
            propsOnPlan(plan),
            operation,
          );
        } catch (err) {
          answer = (err as Error).message;
        }

        expect([operation, plan, answer]).toEqual([
          operation,
          plan,
          refusalFor(required as PlanType),
        ]);
      }
    }
  });

  test(
    switchColumn
      ? "below the update plan, switching a record off is allowed; switching on and every other change are refused"
      : "below the update plan, every update is refused: the table has no off state, its records are deleted instead",
    () => {
      const updatePlan: PlanType | null =
        table.plans[DatabaseRequestType.Update];

      for (const plan of plansBelow(updatePlan)) {
        const refused: string = refusalFor(updatePlan as PlanType);

        const answer: (updateData?: unknown) => string = (
          updateData?: unknown,
        ): string => {
          return check({
            table,
            operation: DatabaseRequestType.Update,
            plan,
            updateData,
          });
        };

        expect([plan, answer({ isEnabled: false })]).toEqual([
          plan,
          switchColumn ? "allowed" : refused,
        ]);

        // Without the data, the switch-off cannot be recognised (fail closed).
        expect([plan, answer()]).toEqual([plan, refused]);
        expect([plan, answer({ isEnabled: true })]).toEqual([plan, refused]);
        expect([plan, answer({ isEnabled: "false" })]).toEqual([plan, refused]);
        expect([plan, answer({ isEnabled: false, name: "Renamed" })]).toEqual([
          plan,
          refused,
        ]);
        expect([plan, answer({ name: "Renamed" })]).toEqual([plan, refused]);
        expect([plan, answer({})]).toEqual([plan, refused]);
      }
    },
  );

  test("on the plan each operation needs, nothing is refused", () => {
    for (const operation of OPERATIONS) {
      const required: PlanType | null = table.plans[operation];

      for (const plan of PLANS) {
        if (required && !isPlanAtLeast(required, plan)) {
          continue;
        }

        expect([
          operation,
          plan,
          check({ table, operation, plan, updateData: { name: "Renamed" } }),
        ]).toEqual([operation, plan, "allowed"]);
      }
    }
  });

  test("with billing off (every self-hosted install), no plan is asked", () => {
    setTestBillingEnabled(false);

    for (const operation of OPERATIONS) {
      expect([
        operation,
        check({ table, operation, plan: PlanType.Free }),
      ]).toEqual([operation, "allowed"]);
    }
  });

  test("an unpaid subscription is still refused, switch-offs, reads and deletes included", () => {
    if (new table.modelType().allowAccessIfSubscriptionIsUnpaid) {
      return;
    }

    for (const operation of OPERATIONS) {
      expect([
        operation,
        check({
          table,
          operation,
          plan: PlanType.Enterprise,
          updateData: { isEnabled: false },
          props: { isSubscriptionUnpaid: true },
        }),
      ]).toEqual([
        operation,
        expect.stringContaining("unpaid state") as unknown as string,
      ]);
    }
  });
});

describe("the table-level permission check hands the update's data to the plan check", () => {
  // A project owner of the project, on Free, below Scale.
  const ownerOnFree: DatabaseCommonInteractionProps = {
    ...propsOnPlan(PlanType.Free),
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
      },
    },
  };

  const tableCheck: (
    type: DatabaseRequestType,
    updateData?: unknown,
  ) => string = (type: DatabaseRequestType, updateData?: unknown): string => {
    try {
      TablePermission.checkTableLevelPermissions(
        ProjectSso,
        ownerOnFree,
        type,
        updateData,
      );
      return "allowed";
    } catch (err) {
      return (err as Error).message;
    }
  };

  test("an SSO provider (Scale) on Free: read, delete and switching off pass; switching on, editing and creating are refused", () => {
    expect(tableCheck(DatabaseRequestType.Read)).toBe("allowed");
    expect(tableCheck(DatabaseRequestType.Delete)).toBe("allowed");
    expect(tableCheck(DatabaseRequestType.Update, { isEnabled: false })).toBe(
      "allowed",
    );

    expect(tableCheck(DatabaseRequestType.Update, { isEnabled: true })).toBe(
      refusalFor(PlanType.Scale),
    );
    expect(tableCheck(DatabaseRequestType.Update, { name: "Renamed" })).toBe(
      refusalFor(PlanType.Scale),
    );
    expect(tableCheck(DatabaseRequestType.Update)).toBe(
      refusalFor(PlanType.Scale),
    );
    expect(tableCheck(DatabaseRequestType.Create, { isEnabled: false })).toBe(
      refusalFor(PlanType.Scale),
    );
  });

  test("the data is only read for updates: a delete or read with data is judged as always", () => {
    expect(tableCheck(DatabaseRequestType.Delete, { isEnabled: true })).toBe(
      "allowed",
    );
    expect(tableCheck(DatabaseRequestType.Read, { name: "Renamed" })).toBe(
      "allowed",
    );
  });

  test("who may do it is still the table's own permissions: a caller with none is refused, whatever the plan allows", () => {
    const strangerOnFree: DatabaseCommonInteractionProps = {
      ...propsOnPlan(PlanType.Free),
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [],
        },
      },
    };

    for (const [type, data] of [
      [DatabaseRequestType.Read, undefined],
      [DatabaseRequestType.Delete, undefined],
      [DatabaseRequestType.Update, { isEnabled: false }],
    ] as Array<[DatabaseRequestType, unknown]>) {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          ProjectSso,
          strangerOnFree,
          type,
          data,
        );
      }).toThrow("You do not have permissions");
    }
  });
});
