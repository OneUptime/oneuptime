import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * DELETING AN ESCALATION RULE KEEPS THE RUNS ON IT, AND THEIR PLACE
 * (issue #9036).
 *
 * The database keeps every run, line and page that named a deleted rule
 * and clears the rule from them (ON DELETE SET NULL). A run still paging on
 * the level goes on from the place it recorded - to the first level at that
 * place or after it - once its wait is over (OnCallRunLevel). These pin what
 * the service does around that:
 *
 *   - the delete writes the rule's place now on the runs still on it,
 *     before the rule is gone - in case a level before it changed while
 *     they paged - in one statement found by the rule's index, never
 *     getting in the way of the delete;
 *   - each line of a run's timeline records its level - place and name -
 *     as it is written, so it can still say which level it was.
 *
 * The rule's delete runs for real (hooks and permission checks) over an
 * in-memory table of three rules.
 */

// Its delete refusals and failures are deliberate here.
jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "90360000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "90360000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("90360000-0000-4000-8000-000000000003");
const POLICY_ID: string = "90360000-0000-4000-8000-0000000000c1";
const RUN_ID: ObjectID = new ObjectID("90360000-0000-4000-8000-0000000000d1");

const LEVEL_1: string = "90360000-0000-4000-8000-0000000000a1";
const LEVEL_2: string = "90360000-0000-4000-8000-0000000000a2";
const LEVEL_3: string = "90360000-0000-4000-8000-0000000000a3";

function memberProps(
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
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
    tenantId: memberOf,
    userTenantAccessPermission: {
      [memberOf.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

function level(id: string, order: number): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    onCallDutyPolicyId: POLICY_ID,
    name: `Level ${order}`,
    order: order,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("deleting an escalation rule", () => {
  let table: InMemoryTable;
  let recordPlace: Mock<
    typeof OnCallDutyPolicyExecutionLogService.recordPlaceOfRunsOnRule
  >;
  // Whether the rule was still in its table when its place was written.
  let wasThereAsItsPlaceWasWritten: boolean | null;

  beforeEach(() => {
    stubProjectDirectory({});
    table = useInMemoryTable(OnCallDutyPolicyEscalationRuleService, [
      level(LEVEL_1, 1),
      level(LEVEL_2, 2),
      level(LEVEL_3, 3),
    ]);

    // Its people, teams and schedules go with it; their tables are not under test.
    for (const childService of [
      OnCallDutyPolicyEscalationRuleScheduleService,
      OnCallDutyPolicyEscalationRuleUserService,
      OnCallDutyPolicyEscalationRuleTeamService,
    ]) {
      getJestSpyOn(childService, "deleteBy").mockResolvedValue(0);
    }

    wasThereAsItsPlaceWasWritten = null;

    recordPlace = jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "recordPlaceOfRunsOnRule")
      .mockImplementation(async (data: { ruleId: ObjectID }) => {
        wasThereAsItsPlaceWasWritten = Boolean(table.get(data.ruleId));
        return 2;
      }) as unknown as Mock<
      typeof OnCallDutyPolicyExecutionLogService.recordPlaceOfRunsOnRule
    >;
  });

  test("writes its place now on the runs still on it, before it is gone", async () => {
    await OnCallDutyPolicyEscalationRuleService.deleteOneById({
      id: new ObjectID(LEVEL_2),
      props: memberProps([Permission.ProjectAdmin]),
    });

    expect(recordPlace).toHaveBeenCalledTimes(1);
    expect(recordPlace.mock.calls[0]![0]).toEqual({
      ruleId: new ObjectID(LEVEL_2),
      order: 2,
    });
    expect(wasThereAsItsPlaceWasWritten).toBe(true);

    /*
     * The rule went, and the levels after it keep their numbers
     * (ContiguousOrder, #9573): the runs go on to the first level after
     * the place they recorded, gap or none (OnCallRunLevel).
     */
    expect(table.deletes).toEqual([LEVEL_2]);
    expect(table.get(LEVEL_3)?.["order"]).toBe(3);
    expect(table.updates).toEqual([]);
  });

  test("a place that cannot be written never stops the delete: the runs go on from the place they recorded", async () => {
    recordPlace.mockRejectedValue(
      new Error("Connection terminated unexpectedly"),
    );

    await OnCallDutyPolicyEscalationRuleService.deleteOneById({
      id: new ObjectID(LEVEL_2),
      props: memberProps([Permission.ProjectAdmin]),
    });

    expect(table.deletes).toEqual([LEVEL_2]);
    expect(
      jest.mocked(logger.error).mock.calls.map((call: Array<unknown>) => {
        return String(call[0]);
      }),
    ).toContain(
      `Could not write the place of escalation rule ${LEVEL_2} on the on-call runs still on it; they go on from the place they recorded.`,
    );
  });

  test("a delete the caller may not make writes no place", async () => {
    await OnCallDutyPolicyEscalationRuleService.deleteOneById({
      id: new ObjectID(LEVEL_2),
      props: memberProps([Permission.ProjectOwner], OTHER_PROJECT_ID),
    }).catch(() => {
      return undefined;
    });

    expect(recordPlace).not.toHaveBeenCalled();
    expect(table.deletes).toEqual([]);
  });
});

describe("writing the place of the runs on a rule", () => {
  test("one statement: the runs still going on the rule, found by the rule's id, given its place", async () => {
    const update: Mock<
      (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => Promise<{ affected: number }>
    > = jest.fn(async () => {
      return { affected: 3 };
    });

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "getRepository")
      .mockReturnValue({ update: update } as never);

    await expect(
      OnCallDutyPolicyExecutionLogService.recordPlaceOfRunsOnRule({
        ruleId: new ObjectID(LEVEL_2),
        order: 2,
      }),
    ).resolves.toBe(3);

    expect(update).toHaveBeenCalledTimes(1);

    const [where, values] = update.mock.calls[0]!;

    expect(Object.keys(where).sort()).toEqual([
      "lastExecutedEscalationRuleId",
      "status",
    ]);
    expect(where["lastExecutedEscalationRuleId"]).toBe(LEVEL_2);
    // Runs still going; one that is over keeps what it recorded.
    expect(
      (where["status"] as { type: string; value: Array<string> }).type,
    ).toBe("in");
    expect(
      [
        ...(where["status"] as { type: string; value: Array<string> }).value,
      ].sort(),
    ).toEqual(
      [
        OnCallDutyPolicyStatus.Executing,
        OnCallDutyPolicyStatus.Scheduled,
        OnCallDutyPolicyStatus.Started,
      ].sort(),
    );
    // Its place only: the moment the claims compare is left alone.
    expect(values).toEqual({ lastExecutedEscalationRuleOrder: 2 });
  });
});

describe("a line of a run's timeline", () => {
  let created: Array<OnCallDutyPolicyExecutionLogTimeline>;

  beforeEach(() => {
    created = [];
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "create")
      .mockImplementation(async (data: { data: unknown }) => {
        created.push(data.data as OnCallDutyPolicyExecutionLogTimeline);
        return data.data as OnCallDutyPolicyExecutionLogTimeline;
      });
  });

  const context: {
    projectId: ObjectID;
    userNotificationEventType: UserNotificationEventType;
    onCallPolicyExecutionLogId: ObjectID;
    onCallPolicyId: ObjectID;
  } = {
    projectId: PROJECT_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    onCallPolicyExecutionLogId: RUN_ID,
    onCallPolicyId: new ObjectID(POLICY_ID),
  };

  test("records the level it is about - its place and its name - with its rule", async () => {
    await OnCallDutyPolicyEscalationRuleService.recordLevelSkippedByEscalation(
      new ObjectID(LEVEL_2),
      context,
      { order: 2, name: "Database" },
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.statusMessage).toBe(
      ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
    );
    expect(created[0]!.onCallDutyPolicyEscalationRuleId?.toString()).toBe(
      LEVEL_2,
    );
    expect(created[0]!.escalationRuleOrder).toBe(2);
    expect(created[0]!.escalationRuleName).toBe("Database");
  });

  test("a name too long for its column is cut to it, and blanks are no name", async () => {
    await OnCallDutyPolicyEscalationRuleService.recordLevelSkippedByEscalation(
      new ObjectID(LEVEL_2),
      context,
      { order: 2, name: `  ${"x".repeat(150)}  ` },
    );
    await OnCallDutyPolicyEscalationRuleService.recordLevelSkippedByEscalation(
      new ObjectID(LEVEL_3),
      context,
      { order: 3, name: "   " },
    );

    expect(created[0]!.escalationRuleName).toBe("x".repeat(100));
    expect(created[1]!.escalationRuleName).toBeUndefined();
    expect(created[1]!.escalationRuleOrder).toBe(3);
  });

  test("a line with no level to record records none", async () => {
    await OnCallDutyPolicyEscalationRuleService.recordLevelSkippedByEscalation(
      new ObjectID(LEVEL_1),
      context,
    );

    expect(created[0]!.escalationRuleOrder).toBeUndefined();
    expect(created[0]!.escalationRuleName).toBeUndefined();
  });
});
