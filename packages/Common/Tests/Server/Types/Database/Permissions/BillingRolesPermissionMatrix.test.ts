import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../../../Server/Types/Database/Permissions/BillingPermission";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BillingInvoice from "../../../../../Models/DatabaseModels/BillingInvoice";
import BillingPaymentMethod from "../../../../../Models/DatabaseModels/BillingPaymentMethod";
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../../../Models/DatabaseModels/Project";
import TelemetryUsageBilling from "../../../../../Models/DatabaseModels/TelemetryUsageBilling";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../../Types/Dictionary";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../../../../Types/HeldPermissions";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL } from "../../../../../Utils/Project/NotificationChannels";
import {
  PAYMENT_METHOD_ADD_PERMISSIONS,
  PROJECT_BILLING_CONTACT_COLUMNS,
  PROJECT_BILLING_CONTACT_UPDATE_PERMISSIONS,
  PROJECT_BILLING_READ_COLUMNS,
  PROJECT_BILLING_READ_ROLES,
  PROJECT_INVOICE_DOWNLOAD_PERMISSIONS,
  PROJECT_INVOICE_PAY_PERMISSIONS,
  PROJECT_INVOICE_READ_PERMISSIONS,
  PROJECT_USAGE_READ_PERMISSIONS,
} from "../../../../../Utils/Project/ProjectBilling";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THE BILLING ROLES DO, as the server holds them - asked of the checks
 * every request goes through: the table's lists (TablePermission), each
 * written column's (ColumnPermission) and each selected column's
 * (SelectPermission).
 *
 *   Billing Viewer  reads every billing page and record, and changes nothing.
 *   Billing Member  reads them, downloads invoices, and changes the billing
 *                   contact details.
 *   Billing Admin   does what Billing Member does, and turns the paid
 *                   notification channels on and off.
 *
 * The plan, payment methods, balances and their Auto Recharge, and paying
 * invoices stay with a project owner and Manage Billing. Before this the
 * descriptions promised these reads and Billing Member's payment methods,
 * and no column or route named Billing Member or Billing Viewer at all: an
 * API key given only one could read nothing, and the billing pages the
 * dashboard shows them failed or showed nothing.
 *
 * Every caller here reads its rows without Project User (the row every
 * member holds), as an API key's requests carry them: the roles must reach
 * the billing records by name.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type ModelType = { new (): DatabaseBaseModel };

const BILLING_ROLES: Array<Permission> = [
  Permission.BillingAdmin,
  Permission.BillingMember,
  Permission.BillingViewer,
];

const CHANNEL_COLUMNS: Array<string> = Object.values(
  PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
);

function rowsFor(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): Array<UserPermission> {
  return [
    ...permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
    ...blocked.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];
}

function propsFor(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: rowsFor(permissions, blocked),
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function tableAllows(
  modelType: ModelType,
  permissions: Array<Permission>,
  type: DatabaseRequestType,
  blocked: Array<Permission> = [],
): boolean {
  const props: DatabaseCommonInteractionProps = propsFor(permissions, blocked);

  try {
    TablePermission.checkTableLevelPermissions(modelType, props, type);
    TablePermission.checkTableLevelBlockPermissions(modelType, props, type);

    return true;
  } catch {
    return false;
  }
}

function mayWrite(
  modelType: ModelType,
  permissions: Array<Permission>,
  type: DatabaseRequestType,
  data: Record<string, unknown>,
): boolean {
  if (!tableAllows(modelType, permissions, type)) {
    return false;
  }

  const model: DatabaseBaseModel = new modelType();

  for (const [key, value] of Object.entries(data)) {
    (model as unknown as Record<string, unknown>)[key] = value;
  }

  try {
    ColumnPermissions.checkDataColumnPermissions(
      modelType,
      model,
      propsFor(permissions),
      type,
    );

    return true;
  } catch {
    return false;
  }
}

function maySelect(
  modelType: ModelType,
  permissions: Array<Permission>,
  columns: Array<string>,
): boolean {
  if (!tableAllows(modelType, permissions, DatabaseRequestType.Read)) {
    return false;
  }

  const select: Record<string, boolean> = {};

  for (const column of columns) {
    select[column] = true;
  }

  try {
    SelectPermission.checkSelectPermission(
      modelType,
      select as never,
      propsFor(permissions),
    );

    return true;
  } catch {
    return false;
  }
}

function columnsFor(
  modelType: ModelType,
  permissions: Array<Permission>,
  type: DatabaseRequestType,
): Array<string> {
  return ColumnPermissions.getModelColumnsByPermissions(
    modelType,
    rowsFor(permissions),
    type,
  )
    .columns.filter((column: string): boolean => {
      return !ALWAYS_SELECTABLE_COLUMNS.includes(column);
    })
    .sort();
}

function sorted(list: ReadonlyArray<Permission>): Array<Permission> {
  return [...list].sort();
}

beforeEach(() => {
  // What is asked here is who, not which plan.
  jest
    .spyOn(BillingPermissions, "checkBillingPermissions")
    .mockImplementation((): void => {
      return undefined;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what each billing role may change, across every table", () => {
  /*
   * Every table's create and delete list and every column's create and
   * update list, read for each role: Billing Viewer is on none of them,
   * Billing Member and Billing Admin only on the project's update lists
   * (and only for the columns below).
   */
  function writableTables(permission: Permission): Array<string> {
    const found: Array<string> = [];

    for (const modelType of AllModelTypes) {
      const model: DatabaseBaseModel = new modelType();
      const name: string = model.tableName || modelType.name;

      if (model.getCreatePermissions().includes(permission)) {
        found.push(`${name}: create`);
      }

      if (model.getDeletePermissions().includes(permission)) {
        found.push(`${name}: delete`);
      }

      if (model.getUpdatePermissions().includes(permission)) {
        found.push(`${name}: update`);
      }

      const columns: Dictionary<ColumnAccessControl> =
        model.getColumnAccessControlForAllColumns();

      for (const column of Object.keys(columns)) {
        if ((columns[column]?.create || []).includes(permission)) {
          found.push(`${name}.${column}: create`);
        }
      }
    }

    return found.sort();
  }

  test("Billing Viewer changes nothing anywhere", () => {
    expect(writableTables(Permission.BillingViewer)).toEqual([]);
  });

  test("Billing Member updates the project and nothing else", () => {
    expect(writableTables(Permission.BillingMember)).toEqual([
      "Project: update",
    ]);
  });

  test("Billing Admin updates the project and nothing else", () => {
    expect(writableTables(Permission.BillingAdmin)).toEqual([
      "Project: update",
    ]);
  });

  test("Billing Viewer updates no column of a project", () => {
    expect(
      columnsFor(
        Project,
        [Permission.BillingViewer],
        DatabaseRequestType.Update,
      ),
    ).toEqual([]);
  });

  test("Billing Member updates exactly the billing contact details", () => {
    expect(
      columnsFor(
        Project,
        [Permission.BillingMember],
        DatabaseRequestType.Update,
      ),
    ).toEqual([...PROJECT_BILLING_CONTACT_COLUMNS].sort());
  });

  test("Billing Admin updates exactly the billing contact details and the four paid channel switches", () => {
    expect(
      columnsFor(Project, [Permission.BillingAdmin], DatabaseRequestType.Update),
    ).toEqual([...PROJECT_BILLING_CONTACT_COLUMNS, ...CHANNEL_COLUMNS].sort());
  });
});

describe("the billing contact details", () => {
  const CONTACT_SAVE: Record<string, unknown> = {
    businessDetails: "Acme Corporation\n123 Main Street",
    businessDetailsCountry: "US",
    financeAccountingEmail: "finance@acme.test",
    sendInvoicesByEmail: true,
  };

  test("each contact column's update list is the shared list", () => {
    const columns: Dictionary<ColumnAccessControl> =
      new Project().getColumnAccessControlForAllColumns();

    for (const column of PROJECT_BILLING_CONTACT_COLUMNS) {
      expect([column, sorted(columns[column]?.update || [])]).toEqual([
        column,
        sorted(PROJECT_BILLING_CONTACT_UPDATE_PERMISSIONS),
      ]);
    }
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
    Permission.BillingMember,
  ])("%s may save the Business Details card", (permission: Permission) => {
    expect(
      mayWrite(Project, [permission], DatabaseRequestType.Update, CONTACT_SAVE),
    ).toBe(true);
  });

  test.each([
    Permission.BillingViewer,
    Permission.ProjectAdmin,
    Permission.EditProject,
    Permission.ProjectMember,
    Permission.Viewer,
  ])("%s may not", (permission: Permission) => {
    expect(
      mayWrite(Project, [permission], DatabaseRequestType.Update, CONTACT_SAVE),
    ).toBe(false);
  });

  test("a save that changes the contact details and renames the project is refused whole for a Billing Member", () => {
    expect(
      mayWrite(Project, [Permission.BillingMember], DatabaseRequestType.Update, {
        financeAccountingEmail: "finance@acme.test",
        name: "Renamed",
      }),
    ).toBe(false);
  });

  test("a team's block on Billing Member, with no labels, takes it away", () => {
    expect(
      tableAllows(
        Project,
        [Permission.BillingMember],
        DatabaseRequestType.Update,
        [Permission.BillingMember],
      ),
    ).toBe(false);
  });
});

describe("what stays with a project owner and Manage Billing", () => {
  const CHARGES_THE_CARD: Array<Record<string, unknown>> = [
    { paymentProviderPlanId: "price_scale_year" },
    { enableAutoRechargeSmsOrCallBalance: true },
    { autoRechargeSmsOrCallByBalanceInUSD: 50 },
    { autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10 },
    { enableAutoRechargeAiBalance: true },
    { autoAiRechargeByBalanceInUSD: 50 },
    { autoRechargeAiWhenCurrentBalanceFallsInUSD: 10 },
    { enableAi: true },
    { aiDailySpendLimitInUSD: 100 },
    { disableOnCallNotificationFallback: true },
  ];

  for (const permission of BILLING_ROLES) {
    test(`${permission} may change none of the plan, the balances' Auto Recharge or the AI spend`, () => {
      for (const data of CHARGES_THE_CARD) {
        expect([
          data,
          mayWrite(Project, [permission], DatabaseRequestType.Update, data),
        ]).toEqual([data, false]);
      }
    });

    test(`${permission} may not add or remove a payment method, or pay an invoice`, () => {
      expect(
        tableAllows(
          BillingPaymentMethod,
          [permission],
          DatabaseRequestType.Create,
        ),
      ).toBe(false);
      expect(
        tableAllows(
          BillingPaymentMethod,
          [permission],
          DatabaseRequestType.Delete,
        ),
      ).toBe(false);
      expect(PAYMENT_METHOD_ADD_PERMISSIONS).not.toContain(permission);
      expect(PROJECT_INVOICE_PAY_PERMISSIONS).not.toContain(permission);
    });
  }

  test("a project owner and Manage Billing still may", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]) {
      for (const data of CHARGES_THE_CARD) {
        expect([
          permission,
          data,
          mayWrite(Project, [permission], DatabaseRequestType.Update, data),
        ]).toEqual([permission, data, true]);
      }
    }
  });
});

describe("Billing Viewer, Member and Admin read every billing record", () => {
  test("the project's billing record: every listed column, by name - as an API key holding only the role reads it", () => {
    for (const permission of BILLING_ROLES) {
      expect([
        permission,
        maySelect(Project, [permission], [...PROJECT_BILLING_READ_COLUMNS]),
      ]).toEqual([permission, true]);
    }
  });

  test("every listed column is a column of the project, and names each billing role in its read list", () => {
    const columns: Dictionary<ColumnAccessControl> =
      new Project().getColumnAccessControlForAllColumns();

    for (const column of PROJECT_BILLING_READ_COLUMNS) {
      expect([column, Boolean(columns[column])]).toEqual([column, true]);

      for (const permission of PROJECT_BILLING_READ_ROLES) {
        expect([
          column,
          permission,
          (columns[column]?.read || []).includes(permission),
        ]).toEqual([column, permission, true]);
      }
    }
  });

  test("and every project column whose changes take Project Owner or Manage Billing alone is listed - what billing decides, billing reads", () => {
    const columns: Dictionary<ColumnAccessControl> =
      new Project().getColumnAccessControlForAllColumns();

    for (const column of Object.keys(columns)) {
      const update: Array<Permission> = columns[column]?.update || [];

      const isBillingOnly: boolean =
        update.includes(Permission.ManageProjectBilling) &&
        update.every((permission: Permission): boolean => {
          return [
            Permission.ProjectOwner,
            Permission.ManageProjectBilling,
            ...PROJECT_BILLING_READ_ROLES,
          ].includes(permission);
        });

      if (isBillingOnly) {
        expect([column, PROJECT_BILLING_READ_COLUMNS.includes(column)]).toEqual(
          [column, true],
        );
      }
    }
  });

  /*
   * The Billing page asks for the plan and the reseller it was bought from
   * in one read. The reseller was the project owners' alone, so for anyone
   * else - a billing role, a project admin - the whole page failed. It is
   * read with the plan now, by whoever reads the plan.
   */
  test("the reseller a plan was bought from is read with the plan: the Billing page's read works for everyone who reads the plan", () => {
    const columns: Dictionary<ColumnAccessControl> =
      new Project().getColumnAccessControlForAllColumns();

    for (const column of ["reseller", "resellerId", "resellerPlan", "resellerPlanId"]) {
      expect([column, sorted(columns[column]?.read || [])]).toEqual([
        column,
        sorted(columns["paymentProviderPlanId"]?.read || []),
      ]);
    }

    for (const permission of [
      ...BILLING_ROLES,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      expect([
        permission,
        maySelect(Project, [permission], [
          "paymentProviderPlanId",
          "reseller",
          "resellerPlan",
        ]),
      ]).toEqual([permission, true]);
    }
  });

  test("but no other column of the project: the billing roles do not read its settings", () => {
    for (const permission of BILLING_ROLES) {
      const readable: Array<string> = columnsFor(
        Project,
        [permission],
        DatabaseRequestType.Read,
      );

      expect(readable).toEqual([...PROJECT_BILLING_READ_COLUMNS].sort());
      expect(readable).not.toContain("requireSsoForLogin");
      expect(readable).not.toContain("incidentNumberPrefix");
    }
  });

  test("invoices: the list for all three, the download link for Billing Member and Billing Admin", () => {
    const columns: Dictionary<ColumnAccessControl> =
      new BillingInvoice().getColumnAccessControlForAllColumns();
    const readableByOwner: Array<string> = columnsFor(
      BillingInvoice,
      [Permission.ProjectOwner],
      DatabaseRequestType.Read,
    );

    expect(Boolean(columns["downloadableLink"])).toBe(true);

    for (const permission of BILLING_ROLES) {
      expect(
        tableAllows(BillingInvoice, [permission], DatabaseRequestType.Read),
      ).toBe(true);
      expect(
        maySelect(BillingInvoice, [permission], [
          "invoiceNumber",
          "invoiceDate",
          "amount",
          "currencyCode",
          "status",
        ]),
      ).toBe(true);
    }

    expect(
      columnsFor(
        BillingInvoice,
        [Permission.BillingViewer],
        DatabaseRequestType.Read,
      ),
    ).toEqual(
      readableByOwner.filter((column: string): boolean => {
        return column !== "downloadableLink";
      }),
    );

    for (const permission of [
      Permission.BillingMember,
      Permission.BillingAdmin,
    ]) {
      expect(
        columnsFor(BillingInvoice, [permission], DatabaseRequestType.Read),
      ).toEqual(readableByOwner);
    }

    expect(
      maySelect(BillingInvoice, [Permission.BillingViewer], [
        "downloadableLink",
      ]),
    ).toBe(false);
  });

  test("invoices: the table's read list and the download link's are the shared lists", () => {
    const columns: Dictionary<ColumnAccessControl> =
      new BillingInvoice().getColumnAccessControlForAllColumns();

    expect(sorted(new BillingInvoice().getReadPermissions())).toEqual(
      sorted(PROJECT_INVOICE_READ_PERMISSIONS),
    );
    expect(sorted(columns["downloadableLink"]?.read || [])).toEqual(
      sorted(PROJECT_INVOICE_DOWNLOAD_PERMISSIONS),
    );
  });

  test("usage history: every billing role reads it, and the table's read list is the shared list", () => {
    expect(sorted(new TelemetryUsageBilling().getReadPermissions())).toEqual(
      sorted(PROJECT_USAGE_READ_PERMISSIONS),
    );

    const readableByOwner: Array<string> = columnsFor(
      TelemetryUsageBilling,
      [Permission.ProjectOwner],
      DatabaseRequestType.Read,
    );

    for (const permission of BILLING_ROLES) {
      expect(
        columnsFor(TelemetryUsageBilling, [permission], DatabaseRequestType.Read),
      ).toEqual(readableByOwner);
    }
  });

  test("payment methods: read, as before", () => {
    for (const permission of BILLING_ROLES) {
      expect(
        tableAllows(BillingPaymentMethod, [permission], DatabaseRequestType.Read),
      ).toBe(true);
      expect(
        maySelect(BillingPaymentMethod, [permission], [
          "paymentMethodType",
          "last4Digits",
          "isDefault",
        ]),
      ).toBe(true);
    }
  });

  test("a team's block on Billing Viewer, with no labels, takes the reads away", () => {
    for (const modelType of [
      Project,
      BillingInvoice,
      TelemetryUsageBilling,
      BillingPaymentMethod,
    ] as Array<ModelType>) {
      expect([
        new modelType().tableName,
        tableAllows(
          modelType,
          [Permission.BillingViewer],
          DatabaseRequestType.Read,
          [Permission.BillingViewer],
        ),
      ]).toEqual([new modelType().tableName, false]);
    }
  });

  test("Manage Billing reads the invoices it may pay", () => {
    expect(
      tableAllows(
        BillingInvoice,
        [Permission.ManageProjectBilling],
        DatabaseRequestType.Read,
      ),
    ).toBe(true);
    expect(
      maySelect(BillingInvoice, [Permission.ManageProjectBilling], [
        "downloadableLink",
        "paymentProviderInvoiceId",
        "paymentProviderCustomerId",
      ]),
    ).toBe(true);
  });
});
