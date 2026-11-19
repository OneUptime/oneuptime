import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyScheduleLayerService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnDutyPoliciesCache from "../../../Server/Utils/OnCall/OnDutyPoliciesCache";
import { MoveInListResult } from "../../../Types/Database/MoveInList";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { useInMemoryListMoves } from "../TestingUtils/ListMovesInMemory";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  ORDER_CASES,
  OrderCase,
  PROJECT_ID,
  ROW_A,
  ROW_B,
  ROW_C,
  SCHEDULE_ID,
  LIST_ID,
  adminProps,
  startingRows,
} from "./ContiguousOrderCases";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHAT A MOVE IN A NUMBERED LIST TELLS, ONCE IT IS WRITTEN (issue #9573).
 *
 * A move (moveInList) writes the list's rows in a transaction of its own,
 * round the services' update hooks, so each service does after it what its
 * hooks did after a move made as an update:
 *
 *   - an escalation rule's: the on-call policies the header shows forget
 *     the project, so the levels are read again in their new order;
 *   - a schedule layer's: who is on call is worked out again, and the
 *     schedule's feeds and listeners are told (ScheduleLayerChanges);
 *   - a layer user's: the same, naming everyone whose turn changed, so
 *     their own feeds and reminders are looked at again.
 *
 * A move to a row's own place writes nothing, and tells nothing.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function caseOf(label: string): OrderCase {
  return ORDER_CASES.find((orderCase: OrderCase): boolean => {
    return orderCase.label === label;
  })!;
}

async function moveInList(
  orderCase: OrderCase,
  rowId: string,
  placeOfId: string,
): Promise<MoveInListResult> {
  return await (
    orderCase.service as unknown as {
      moveInList: (data: {
        id: ObjectID;
        placeOfId: ObjectID;
        props: DatabaseCommonInteractionProps;
      }) => Promise<MoveInListResult>;
    }
  ).moveInList({
    id: new ObjectID(rowId),
    placeOfId: new ObjectID(placeOfId),
    props: adminProps(),
  });
}

describe("an escalation rule moved", () => {
  const orderCase: OrderCase = caseOf("OnCallDutyPolicyEscalationRuleService");
  // A static method's spy, typed as getJestSpyOn types one.
  let forget: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    const table: InMemoryTable = useInMemoryTable(
      OnCallDutyPolicyEscalationRuleService,
      startingRows(orderCase),
    );
    useInMemoryListMoves({
      service: OnCallDutyPolicyEscalationRuleService,
      table: table,
    });
    orderCase.stubCollaborators();
    forget = getJestSpyOn(
      OnDutyPoliciesCache,
      "forgetProjects",
    ).mockResolvedValue(undefined);
  });

  test("has the project's on-call policies read again, in their new order", async () => {
    await moveInList(orderCase, ROW_C, ROW_A);

    expect(forget).toHaveBeenCalledWith([PROJECT_ID]);
  });

  test("to its own place, tells nothing", async () => {
    await moveInList(orderCase, ROW_B, ROW_B);

    expect(forget).not.toHaveBeenCalled();
  });
});

describe("a schedule layer moved", () => {
  const orderCase: OrderCase = caseOf("OnCallDutyPolicyScheduleLayerService");
  let propagate: jest.SpiedFunction<
    typeof OnCallDutyPolicyScheduleService.propagateShiftConfigChange
  >;
  let refresh: jest.SpiedFunction<
    typeof OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule
  >;

  beforeEach(() => {
    const table: InMemoryTable = useInMemoryTable(
      OnCallDutyPolicyScheduleLayerService,
      startingRows(orderCase),
    );
    useInMemoryListMoves({
      service: OnCallDutyPolicyScheduleLayerService,
      table: table,
    });
    orderCase.stubCollaborators();
    refresh = getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    ).mockResolvedValue(undefined as never);
    propagate = getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "propagateShiftConfigChange",
    ).mockResolvedValue(undefined as never);
  });

  test("has who is on call worked out again, and the schedule told, at once for a person", async () => {
    await moveInList(orderCase, ROW_C, ROW_A);

    // The layers' schedule is the list the rows are numbered in.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(String(refresh.mock.calls[0]![0])).toBe(LIST_ID);
    expect(propagate).toHaveBeenCalledTimes(1);

    const told: { scheduleIds: Array<ObjectID> } = propagate.mock
      .calls[0]![0] as unknown as { scheduleIds: Array<ObjectID> };

    expect(told.scheduleIds.map(String)).toEqual([LIST_ID]);
  });

  test("to its own place, tells nothing", async () => {
    await moveInList(orderCase, ROW_A, ROW_A);

    expect(refresh).not.toHaveBeenCalled();
    expect(propagate).not.toHaveBeenCalled();
  });
});

describe("a person moved to another turn in a layer", () => {
  const orderCase: OrderCase = caseOf(
    "OnCallDutyPolicyScheduleLayerUserService",
  );
  const PERSON_A: string = "1c000000-0000-4000-8000-0000000000e1";
  const PERSON_B: string = "1c000000-0000-4000-8000-0000000000e2";
  const PERSON_C: string = "1c000000-0000-4000-8000-0000000000e3";
  let propagate: jest.SpiedFunction<
    typeof OnCallDutyPolicyScheduleService.propagateShiftConfigChange
  >;

  beforeEach(() => {
    const table: InMemoryTable = useInMemoryTable(
      OnCallDutyPolicyScheduleLayerUserService,
      startingRows(orderCase),
    );

    table.get(ROW_A)!["userId"] = PERSON_A;
    table.get(ROW_B)!["userId"] = PERSON_B;
    table.get(ROW_C)!["userId"] = PERSON_C;

    useInMemoryListMoves({
      service: OnCallDutyPolicyScheduleLayerUserService,
      table: table,
    });
    orderCase.stubCollaborators();
    getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    ).mockResolvedValue(undefined as never);
    propagate = getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "propagateShiftConfigChange",
    ).mockResolvedValue(undefined as never);
  });

  test("tells the schedule once, naming everyone whose turn changed", async () => {
    // B to C's place: B and C swap, A keeps the first turn.
    await moveInList(orderCase, ROW_B, ROW_C);

    expect(propagate).toHaveBeenCalledTimes(1);

    const told: { scheduleIds: Array<ObjectID>; userIds: Array<ObjectID> } =
      propagate.mock.calls[0]![0] as unknown as {
        scheduleIds: Array<ObjectID>;
        userIds: Array<ObjectID>;
      };

    expect(told.scheduleIds.map(String)).toEqual([SCHEDULE_ID]);
    expect(told.userIds.map(String).sort()).toEqual(
      [PERSON_B, PERSON_C].sort(),
    );
  });

  test("to their own turn, tells nothing", async () => {
    await moveInList(orderCase, ROW_A, ROW_A);

    expect(propagate).not.toHaveBeenCalled();
  });
});
