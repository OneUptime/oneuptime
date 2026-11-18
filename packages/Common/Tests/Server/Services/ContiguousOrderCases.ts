import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleLayerService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { InMemoryTable, StoredRow } from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";

/*
 * THE FIVE LISTS NUMBERED BY AN `order` COLUMN (ContiguousOrder), FOR THE
 * SUITES THAT DRIVE THEIR SERVICES OVER AN IN-MEMORY TABLE.
 *
 * The escalation rules of an on-call policy, the layers of a schedule, the
 * users of a layer, the groups of a status page and the resources of a
 * status page: what a row of each needs, which column names its list, who
 * may write it, and the collaborators each service calls that a suite does
 * not test. ContiguousOrderWrites and ContiguousOrderConverges drive them.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000001",
);
export const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000002",
);
export const USER_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000003",
);

export const LIST_ID: string = "1c000000-0000-4000-8000-0000000000c1";
export const OTHER_LIST_ID: string = "1c000000-0000-4000-8000-0000000000c2";
export const SCHEDULE_ID: string = "1c000000-0000-4000-8000-0000000000c3";
// A list of this project's with no rows yet.
export const EMPTY_LIST_ID: string = "1c000000-0000-4000-8000-0000000000c4";

export const ROW_A: string = "1c000000-0000-4000-8000-0000000000a1";
export const ROW_B: string = "1c000000-0000-4000-8000-0000000000a2";
export const ROW_C: string = "1c000000-0000-4000-8000-0000000000a3";
export const ROW_X: string = "1c000000-0000-4000-8000-0000000000b1";
export const ROW_Y: string = "1c000000-0000-4000-8000-0000000000b2";

export interface OrderCase {
  label: string;
  service: DatabaseService<BaseModel>;
  // The column naming the list a row is numbered in.
  listColumn: string;
  // Columns every row of the list carries besides it.
  listExtras: StoredRow;
  // The columns a create needs besides the list, the project and the order.
  newRowData: () => StoredRow;
  /*
   * Who creates in the permitted case. An escalation rule created by a
   * member first has its policy looked up by OnCallDutyPolicyChildService,
   * which this in-memory table does not hold, so root creates it there.
   */
  creatorProps: () => DatabaseCommonInteractionProps;
  // The collaborators the service calls that are not under test.
  stubCollaborators: () => void;
}

// A member of `memberOf`, asking in `tenant`, with these permissions.
export function memberProps(
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
  tenant: ObjectID = memberOf,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: memberOf,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: tenant,
    userTenantAccessPermission: {
      [memberOf.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

export const adminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectAdmin]);
  };

export const viewerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.Viewer]);
  };

// An owner of another project, asking in their own.
export const strangerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectOwner], OTHER_PROJECT_ID);
  };

export function stubScheduleRoster(): void {
  getJestSpyOn(
    OnCallDutyPolicyScheduleService,
    "refreshCurrentUserIdAndHandoffTimeInSchedule",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    OnCallDutyPolicyScheduleService,
    "propagateShiftConfigChange",
  ).mockResolvedValue(undefined);
}

export const ORDER_CASES: Array<OrderCase> = [
  {
    label: "OnCallDutyPolicyEscalationRuleService",
    service:
      OnCallDutyPolicyEscalationRuleService as unknown as DatabaseService<BaseModel>,
    listColumn: "onCallDutyPolicyId",
    listExtras: {},
    newRowData: (): StoredRow => {
      return { name: "Page the lead", escalateAfterInMinutes: 30 };
    },
    creatorProps: (): DatabaseCommonInteractionProps => {
      return { isRoot: true };
    },
    stubCollaborators: (): void => {
      // A rule's people go with it; their own tables are not under test.
      for (const childService of [
        OnCallDutyPolicyEscalationRuleScheduleService,
        OnCallDutyPolicyEscalationRuleUserService,
        OnCallDutyPolicyEscalationRuleTeamService,
      ]) {
        getJestSpyOn(childService, "deleteBy").mockResolvedValue(0);
      }
    },
  },
  {
    label: "OnCallDutyPolicyScheduleLayerService",
    service:
      OnCallDutyPolicyScheduleLayerService as unknown as DatabaseService<BaseModel>,
    listColumn: "onCallDutyPolicyScheduleId",
    listExtras: {},
    newRowData: (): StoredRow => {
      return {
        name: "Weekend layer",
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        handOffTime: new Date("2026-10-01T09:00:00.000Z"),
        rotation: Recurring.getDefault(),
        restrictionTimes: RestrictionTimes.getDefault(),
      };
    },
    creatorProps: adminProps,
    stubCollaborators: stubScheduleRoster,
  },
  {
    label: "OnCallDutyPolicyScheduleLayerUserService",
    service:
      OnCallDutyPolicyScheduleLayerUserService as unknown as DatabaseService<BaseModel>,
    listColumn: "onCallDutyPolicyScheduleLayerId",
    listExtras: { onCallDutyPolicyScheduleId: SCHEDULE_ID },
    newRowData: (): StoredRow => {
      return {
        userId: USER_ID,
        onCallDutyPolicyScheduleId: new ObjectID(SCHEDULE_ID),
      };
    },
    creatorProps: adminProps,
    stubCollaborators: stubScheduleRoster,
  },
  {
    label: "StatusPageGroupService",
    service: StatusPageGroupService as unknown as DatabaseService<BaseModel>,
    listColumn: "statusPageId",
    listExtras: {},
    newRowData: (): StoredRow => {
      return { name: "APIs" };
    },
    creatorProps: adminProps,
    stubCollaborators: (): void => {},
  },
  {
    label: "StatusPageResourceService",
    service: StatusPageResourceService as unknown as DatabaseService<BaseModel>,
    listColumn: "statusPageId",
    listExtras: { statusPageGroupId: null },
    newRowData: (): StoredRow => {
      return { displayName: "Checkout" };
    },
    creatorProps: adminProps,
    stubCollaborators: (): void => {},
  },
];

// A row of `orderCase`'s list `listId`, in `projectId`, at `order`.
export function rowInList(data: {
  orderCase: OrderCase;
  id: string;
  order: number;
  listId?: string | undefined;
  projectId?: ObjectID | undefined;
}): StoredRow {
  return {
    _id: data.id,
    projectId: (data.projectId || PROJECT_ID).toString(),
    [data.orderCase.listColumn]: data.listId || LIST_ID,
    ...data.orderCase.listExtras,
    name: `Row ${data.id.slice(-4)}`,
    displayName: `Row ${data.id.slice(-4)}`,
    order: data.order,
  };
}

/*
 * A list of three in this project (A, B, C at 1, 2, 3) and a list of two in
 * another project (X, Y at 1, 2).
 */
export function startingRows(orderCase: OrderCase): Array<StoredRow> {
  return [
    rowInList({ orderCase, id: ROW_A, order: 1 }),
    rowInList({ orderCase, id: ROW_B, order: 2 }),
    rowInList({ orderCase, id: ROW_C, order: 3 }),
    rowInList({
      orderCase,
      id: ROW_X,
      order: 1,
      listId: OTHER_LIST_ID,
      projectId: OTHER_PROJECT_ID,
    }),
    rowInList({
      orderCase,
      id: ROW_Y,
      order: 2,
      listId: OTHER_LIST_ID,
      projectId: OTHER_PROJECT_ID,
    }),
  ];
}

// The list's rows, by id, in their order (twins by id, as the database reads them).
export function orderOf(
  table: InMemoryTable,
  orderCase: OrderCase,
  listId: string,
): Array<[string, number]> {
  return table.rows
    .filter((row: StoredRow): boolean => {
      return String(row[orderCase.listColumn]).toLowerCase() === listId;
    })
    .map((row: StoredRow): [string, number] => {
      return [String(row["_id"]), Number(row["order"])];
    })
    .sort((a: [string, number], b: [string, number]): number => {
      if (a[1] !== b[1]) {
        return a[1] - b[1];
      }

      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
}

// Each row of the list, by id, with its order.
export function ordersById(
  table: InMemoryTable,
  orderCase: OrderCase,
  listId: string,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [id, order] of orderOf(table, orderCase, listId)) {
    result[id] = order;
  }

  return result;
}

// A new row of `orderCase`'s list `listId`, at `order` (or none).
export function newRow(
  orderCase: OrderCase,
  order: number | undefined,
  listId: string = LIST_ID,
): BaseModel {
  const model: BaseModel = new orderCase.service.modelType();
  const record: StoredRow = model as unknown as StoredRow;

  for (const [column, value] of Object.entries(orderCase.newRowData())) {
    record[column] = value;
  }

  record[orderCase.listColumn] = new ObjectID(listId);

  if (order !== undefined) {
    record["order"] = order;
  }

  return model;
}

/*
 * Names a new row apart from the others: a status page's groups must not
 * share a name.
 */
export function nameApart(row: BaseModel, label: string): BaseModel {
  const record: StoredRow = row as unknown as StoredRow;

  for (const column of ["name", "displayName"]) {
    if (typeof record[column] === "string") {
      record[column] = `${record[column]} (${label})`;
    }
  }

  return row;
}

export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}
