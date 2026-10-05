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
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * NUMBERED LISTS STAY 1..N, AND CHANGE ONLY WHEN THE WRITE SUCCEEDED.
 *
 * The escalation rules of an on-call policy, the layers of a schedule, the
 * users of a layer, the groups of a status page and the resources of a status
 * page are numbered 1..n, and their services keep the numbers contiguous:
 * adding a row at a place moves the rows from there down, moving a row moves
 * the rows it passes, deleting one closes its gap. The rows used to step
 * aside in onBeforeCreate / onBeforeUpdate, before the permission check and
 * before the write itself could fail.
 *
 * They now step aside in the success hooks, once the row was created, moved
 * or deleted, within its own list and project (ContiguousOrder). These drive
 * the real create, updateOneById and deleteOneById of each service, hooks
 * and permission checks included, over an in-memory table with a list of
 * three in this project and a list of two in another project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("1c000000-0000-4000-8000-000000000003");

const LIST_ID: string = "1c000000-0000-4000-8000-0000000000c1";
const OTHER_LIST_ID: string = "1c000000-0000-4000-8000-0000000000c2";
const SCHEDULE_ID: string = "1c000000-0000-4000-8000-0000000000c3";

const ROW_A: string = "1c000000-0000-4000-8000-0000000000a1";
const ROW_B: string = "1c000000-0000-4000-8000-0000000000a2";
const ROW_C: string = "1c000000-0000-4000-8000-0000000000a3";
const ROW_X: string = "1c000000-0000-4000-8000-0000000000b1";
const ROW_Y: string = "1c000000-0000-4000-8000-0000000000b2";

interface OrderCase {
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
  /*
   * Whether a row given another place moves the rows it passes. A schedule's
   * layers never did: the dashboard moves them one at a time.
   */
  movesPassedRows: boolean;
}

// A member of `memberOf`, asking in `tenant`, with these permissions.
function memberProps(
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

const adminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectAdmin]);
  };

const viewerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.Viewer]);
  };

// An owner of another project, asking in their own.
const strangerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectOwner], OTHER_PROJECT_ID);
  };

function stubScheduleRoster(): void {
  getJestSpyOn(
    OnCallDutyPolicyScheduleService,
    "refreshCurrentUserIdAndHandoffTimeInSchedule",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    OnCallDutyPolicyScheduleService,
    "propagateShiftConfigChange",
  ).mockResolvedValue(undefined);
}

const ORDER_CASES: Array<OrderCase> = [
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
    movesPassedRows: true,
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
    movesPassedRows: false,
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
    movesPassedRows: true,
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
    movesPassedRows: true,
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
    movesPassedRows: true,
  },
];

function startingRows(orderCase: OrderCase): Array<StoredRow> {
  const inList: (
    id: string,
    order: number,
    listId: string,
    projectId: ObjectID,
  ) => StoredRow = (
    id: string,
    order: number,
    listId: string,
    projectId: ObjectID,
  ): StoredRow => {
    return {
      _id: id,
      projectId: projectId.toString(),
      [orderCase.listColumn]: listId,
      ...orderCase.listExtras,
      name: `Row ${id.slice(-2)}`,
      displayName: `Row ${id.slice(-2)}`,
      order: order,
    };
  };

  return [
    inList(ROW_A, 1, LIST_ID, PROJECT_ID),
    inList(ROW_B, 2, LIST_ID, PROJECT_ID),
    inList(ROW_C, 3, LIST_ID, PROJECT_ID),
    inList(ROW_X, 1, OTHER_LIST_ID, OTHER_PROJECT_ID),
    inList(ROW_Y, 2, OTHER_LIST_ID, OTHER_PROJECT_ID),
  ];
}

// The list's rows, by id, in their order.
function orderOf(
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
      return a[1] - b[1];
    });
}

function newRow(orderCase: OrderCase, order: number): BaseModel {
  const model: BaseModel = new orderCase.service.modelType();
  const record: StoredRow = model as unknown as StoredRow;

  for (const [column, value] of Object.entries(orderCase.newRowData())) {
    record[column] = value;
  }

  record[orderCase.listColumn] = new ObjectID(LIST_ID);
  record["order"] = order;

  return model;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ORDER_CASES)("$label", (orderCase: OrderCase) => {
  let table: InMemoryTable;
  const untouchedOtherList: Array<[string, number]> = [
    [ROW_X, 1],
    [ROW_Y, 2],
  ];

  beforeEach(() => {
    table = useInMemoryTable(orderCase.service, startingRows(orderCase));
    orderCase.stubCollaborators();
  });

  describe("create", () => {
    test("a row added at a place moves the rows from there on one place down", async () => {
      const props: DatabaseCommonInteractionProps = orderCase.creatorProps();
      const row: BaseModel = newRow(orderCase, 2);

      if (props.isRoot) {
        (row as unknown as StoredRow)["projectId"] = PROJECT_ID;
      }

      const created: BaseModel = await orderCase.service.create({
        data: row,
        props: props,
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [created.id!.toString(), 2],
        [ROW_B, 3],
        [ROW_C, 4],
      ]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("a member who may only look is refused, and no row moves", async () => {
      const error: unknown = await rejectionOf(
        orderCase.service.create({
          data: newRow(orderCase, 2),
          props: viewerProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(table.inserts).toEqual([]);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_B, 2],
        [ROW_C, 3],
      ]);
    });

    test("a create whose save fails moves no row", async () => {
      table.repository.save.mockImplementationOnce(async () => {
        throw new Error("the save failed");
      });

      const props: DatabaseCommonInteractionProps = orderCase.creatorProps();
      const row: BaseModel = newRow(orderCase, 2);

      if (props.isRoot) {
        (row as unknown as StoredRow)["projectId"] = PROJECT_ID;
      }

      await expect(
        orderCase.service.create({ data: row, props: props }),
      ).rejects.toThrow("the save failed");

      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_B, 2],
        [ROW_C, 3],
      ]);
    });
  });

  describe("move", () => {
    if (!orderCase.movesPassedRows) {
      test("giving a row another place writes that row alone, as it always has", async () => {
        await orderCase.service.updateOneById({
          id: new ObjectID(ROW_C),
          data: { order: 1 } as never,
          props: adminProps(),
        });

        expect(
          table.updates.map((update: { id: string }): string => {
            return update.id;
          }),
        ).toEqual([ROW_C]);
      });

      return;
    }

    test("moving the last row to the top moves the rows it passes down", async () => {
      await orderCase.service.updateOneById({
        id: new ObjectID(ROW_C),
        data: { order: 1 } as never,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_C, 1],
        [ROW_A, 2],
        [ROW_B, 3],
      ]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("moving the top row to the bottom moves only the rows it passes up", async () => {
      await orderCase.service.updateOneById({
        id: new ObjectID(ROW_A),
        data: { order: 3 } as never,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_B, 1],
        [ROW_C, 2],
        [ROW_A, 3],
      ]);
    });

    test("moving the middle row down one place swaps it with the next, and the top row stays", async () => {
      await orderCase.service.updateOneById({
        id: new ObjectID(ROW_B),
        data: { order: 3 } as never,
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_C, 2],
        [ROW_B, 3],
      ]);
    });

    test("an owner of another project naming this project's row moves nothing in either project", async () => {
      const updated: number = await orderCase.service.updateOneById({
        id: new ObjectID(ROW_B),
        data: { order: 1 } as never,
        props: strangerProps(),
      });

      expect(updated).toBe(0);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_B, 2],
        [ROW_C, 3],
      ]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("a member who may only look is refused, and no row moves", async () => {
      const error: unknown = await rejectionOf(
        orderCase.service.updateOneById({
          id: new ObjectID(ROW_C),
          data: { order: 1 } as never,
          props: viewerProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(table.updates).toEqual([]);
    });

    test("a move whose write fails moves no other row", async () => {
      table.repository.update.mockImplementationOnce(async () => {
        throw new Error("the write failed");
      });

      await expect(
        orderCase.service.updateOneById({
          id: new ObjectID(ROW_C),
          data: { order: 1 } as never,
          props: adminProps(),
        }),
      ).rejects.toThrow("the write failed");

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_B, 2],
        [ROW_C, 3],
      ]);
    });
  });

  describe("delete", () => {
    test("deleting a row closes its gap", async () => {
      await orderCase.service.deleteOneById({
        id: new ObjectID(ROW_B),
        props: adminProps(),
      });

      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_C, 2],
      ]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });

    test("an owner of another project naming this project's row deletes and moves nothing", async () => {
      await orderCase.service.deleteOneById({
        id: new ObjectID(ROW_B),
        props: strangerProps(),
      });

      expect(table.deletes).toEqual([]);
      expect(table.updates).toEqual([]);
      expect(orderOf(table, orderCase, LIST_ID)).toEqual([
        [ROW_A, 1],
        [ROW_B, 2],
        [ROW_C, 3],
      ]);
      expect(orderOf(table, orderCase, OTHER_LIST_ID)).toEqual(
        untouchedOtherList,
      );
    });
  });
});
