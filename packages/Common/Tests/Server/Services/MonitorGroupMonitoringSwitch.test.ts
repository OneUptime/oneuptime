import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorGroupResourceService from "../../../Server/Services/MonitorGroupResourceService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorService from "../../../Server/Services/MonitorService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  MonitorGroupMonitoringChange,
  MonitorGroupMonitoringSummary,
} from "../../../Utils/Monitor/MonitorGroupMonitoring";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TURNING MONITORING OFF OR ON FOR EVERY MONITOR IN A GROUP (issue #6401).
 *
 * A monitor group's Monitoring card counts the group's monitors that are
 * checked and turns monitoring off or on for all of them at once - every
 * monitor in the group, where a list's bulk Disable reaches one page of a
 * list. These tests pin how MonitorGroupService does it:
 *
 *   - the group is read as the caller: someone who may not see it gets no
 *     answer, and nothing is written;
 *   - archived monitors are left out of the counts and of the switch, as
 *     they are of the group's status;
 *   - turning it is ONE update of the monitors, as the caller - so only
 *     what they may edit changes, and MonitorService's own hooks do the rest
 *     (the pay-as-you-go gate to turn monitoring on, resolving what each
 *     monitor would have resolved itself when it is turned off) - of the
 *     monitors not already as asked;
 *   - the answer is the group's monitors as they are after the write.
 *
 * The services are stubbed: what they are asked is what is read here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-000000000001",
);
const GROUP_ID: ObjectID = new ObjectID("0193c0de-0e0e-4aaa-8bbb-0000000000b1");
const USER_ID: ObjectID = new ObjectID("0193c0de-0e0e-4aaa-8bbb-000000000002");

const ON_1: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a1";
const ON_2: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a2";
const OFF_1: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a3";
const ARCHIVED: string = "0193c0de-0e0e-4aaa-8bbb-0000000000a4";

interface StoredMember {
  monitorId: string;
  disableActiveMonitoring: boolean;
  isArchived?: boolean;
  // A row whose monitor the read did not bring back (deleted meanwhile).
  monitorGone?: boolean;
}

let members: Array<StoredMember>;
let groupFound: boolean;

let groupReads: MockFunction;
let memberReads: MockFunction;
let updates: MockFunction;

function caller(): DatabaseCommonInteractionProps {
  return { userId: USER_ID, tenantId: PROJECT_ID };
}

function memberRows(): Array<MonitorGroupResource> {
  return members.map((member: StoredMember): MonitorGroupResource => {
    const row: MonitorGroupResource = new MonitorGroupResource();
    row.monitorId = new ObjectID(member.monitorId);
    row.monitorGroupId = GROUP_ID;

    if (!member.monitorGone) {
      const monitor: Monitor = new Monitor();
      monitor._id = member.monitorId;
      monitor.isArchived = Boolean(member.isArchived);
      monitor.disableActiveMonitoring = member.disableActiveMonitoring;
      row.monitor = monitor;
    }

    return row;
  });
}

// The ids a QueryHelper.any() asks for: an IN over its Raw's parameters.
function idsAskedFor(value: unknown): Array<string> {
  const operator: { objectLiteralParameters?: Dictionary<unknown> } = (value ||
    {}) as { objectLiteralParameters?: Dictionary<unknown> };

  return (
    Object.values(operator.objectLiteralParameters || {}) as Array<
      Array<unknown>
    >
  )
    .flat()
    .map((id: unknown): string => {
      return String(id).toLowerCase();
    })
    .sort();
}

beforeEach(() => {
  groupFound = true;
  members = [
    { monitorId: ON_1, disableActiveMonitoring: false },
    { monitorId: ON_2, disableActiveMonitoring: false },
    { monitorId: OFF_1, disableActiveMonitoring: true },
    { monitorId: ARCHIVED, disableActiveMonitoring: false, isArchived: true },
  ];

  groupReads = getJestMockFunction();
  groupReads.mockImplementation(async (): Promise<MonitorGroup | null> => {
    if (!groupFound) {
      return null;
    }

    const group: MonitorGroup = new MonitorGroup();
    group._id = GROUP_ID.toString();
    group.projectId = PROJECT_ID;
    return group;
  });
  jest
    .spyOn(MonitorGroupService, "findOneById")
    .mockImplementation(groupReads as never);

  memberReads = getJestMockFunction();
  memberReads.mockImplementation(
    async (): Promise<Array<MonitorGroupResource>> => {
      return memberRows();
    },
  );
  jest
    .spyOn(MonitorGroupResourceService, "findBy")
    .mockImplementation(memberReads as never);

  // The write: turns the switch of every member it names, as asked.
  updates = getJestMockFunction();
  updates.mockImplementation((async (updateBy: {
    query: Dictionary<unknown>;
    data: { disableActiveMonitoring: boolean };
  }): Promise<number> => {
    const ids: Array<string> = idsAskedFor(updateBy.query["_id"]);
    let count: number = 0;

    for (const member of members) {
      if (ids.includes(member.monitorId)) {
        member.disableActiveMonitoring = updateBy.data.disableActiveMonitoring;
        count += 1;
      }
    }

    return count;
  }) as never);
  jest.spyOn(MonitorService, "updateBy").mockImplementation(updates as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how many of the group's monitors are checked", () => {
  test("counts the monitors that are not archived, and those with monitoring off", async () => {
    const summary: MonitorGroupMonitoringSummary =
      await MonitorGroupService.getMonitoringSummary(GROUP_ID, caller());

    expect(summary).toEqual({ monitorCount: 3, monitoringOffCount: 1 });
  });

  test("the group is read as the caller; its monitors as OneUptime, as for its status", async () => {
    await MonitorGroupService.getMonitoringSummary(GROUP_ID, caller());

    expect(groupReads).toHaveBeenCalledWith({
      id: GROUP_ID,
      select: { _id: true, projectId: true },
      props: caller(),
    });

    const findBy: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      limit: number;
      props: Dictionary<unknown>;
    } = memberReads.mock.calls[0]![0] as {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      limit: number;
      props: Dictionary<unknown>;
    };

    expect(findBy.query).toEqual({
      monitorGroupId: GROUP_ID,
      projectId: PROJECT_ID,
    });
    expect(findBy.select).toEqual({
      monitorId: true,
      monitor: { _id: true, isArchived: true, disableActiveMonitoring: true },
    });
    expect(findBy.limit).toBe(LIMIT_PER_PROJECT);
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("a group the caller may not see - or that is gone - is not found, and nothing else is read", async () => {
    groupFound = false;

    await expect(
      MonitorGroupService.getMonitoringSummary(GROUP_ID, caller()),
    ).rejects.toThrow(new BadDataException("Monitor group not found."));
    expect(memberReads).not.toHaveBeenCalled();
  });

  test("a monitor listed twice counts once, and a row whose monitor is gone not at all", async () => {
    members = [
      { monitorId: ON_1, disableActiveMonitoring: false },
      { monitorId: ON_1, disableActiveMonitoring: false },
      { monitorId: OFF_1, disableActiveMonitoring: true, monitorGone: true },
    ];

    expect(
      await MonitorGroupService.getMonitoringSummary(GROUP_ID, caller()),
    ).toEqual({ monitorCount: 1, monitoringOffCount: 0 });
  });

  test("a group with archived monitors only has none to check", async () => {
    members = [
      { monitorId: ARCHIVED, disableActiveMonitoring: true, isArchived: true },
    ];

    expect(
      await MonitorGroupService.getMonitoringSummary(GROUP_ID, caller()),
    ).toEqual({ monitorCount: 0, monitoringOffCount: 0 });
  });
});

describe("Turn off monitoring", () => {
  test("is one update, as the caller, of the group's monitors that are checked", async () => {
    await MonitorGroupService.setMonitoringForMonitorsInGroup({
      monitorGroupId: GROUP_ID,
      isMonitoringOn: false,
      props: caller(),
    });

    expect(updates).toHaveBeenCalledTimes(1);
    const updateBy: {
      query: Dictionary<unknown>;
      data: Dictionary<unknown>;
      limit: number;
      skip: number;
      props: DatabaseCommonInteractionProps;
    } = updates.mock.calls[0]![0] as {
      query: Dictionary<unknown>;
      data: Dictionary<unknown>;
      limit: number;
      skip: number;
      props: DatabaseCommonInteractionProps;
    };

    // Not the one off already, not the archived one.
    expect(idsAskedFor(updateBy.query["_id"])).toEqual([ON_1, ON_2].sort());
    expect({ ...updateBy.query, _id: undefined }).toEqual({
      _id: undefined,
      projectId: PROJECT_ID,
      isArchived: false,
      disableActiveMonitoring: false,
    });
    expect(updateBy.data).toEqual({ disableActiveMonitoring: true });
    expect(updateBy.props).toEqual(caller());
    expect(updateBy.limit).toBe(LIMIT_PER_PROJECT);
    expect(updateBy.skip).toBe(0);
  });

  test("answers how many it turned off, and the group's monitors as they are now", async () => {
    const change: MonitorGroupMonitoringChange =
      await MonitorGroupService.setMonitoringForMonitorsInGroup({
        monitorGroupId: GROUP_ID,
        isMonitoringOn: false,
        props: caller(),
      });

    expect(change).toEqual({
      monitorCount: 3,
      monitoringOffCount: 3,
      changedCount: 2,
    });
  });

  test("a monitor the caller may not edit stays as it was, and the answer says so", async () => {
    // The update path narrows the write to what the caller may edit.
    updates.mockImplementation((async (updateBy: {
      data: { disableActiveMonitoring: boolean };
    }): Promise<number> => {
      members[0]!.disableActiveMonitoring =
        updateBy.data.disableActiveMonitoring;
      return 1;
    }) as never);

    expect(
      await MonitorGroupService.setMonitoringForMonitorsInGroup({
        monitorGroupId: GROUP_ID,
        isMonitoringOn: false,
        props: caller(),
      }),
    ).toEqual({ monitorCount: 3, monitoringOffCount: 2, changedCount: 1 });
  });

  test("with every monitor off already, nothing is written", async () => {
    members = [
      { monitorId: OFF_1, disableActiveMonitoring: true },
      { monitorId: ARCHIVED, disableActiveMonitoring: false, isArchived: true },
    ];

    expect(
      await MonitorGroupService.setMonitoringForMonitorsInGroup({
        monitorGroupId: GROUP_ID,
        isMonitoringOn: false,
        props: caller(),
      }),
    ).toEqual({ monitorCount: 1, monitoringOffCount: 1, changedCount: 0 });
    expect(updates).not.toHaveBeenCalled();
  });

  test("a group the caller may not see is not found, and nothing is written", async () => {
    groupFound = false;

    await expect(
      MonitorGroupService.setMonitoringForMonitorsInGroup({
        monitorGroupId: GROUP_ID,
        isMonitoringOn: false,
        props: caller(),
      }),
    ).rejects.toThrow("Monitor group not found.");
    expect(updates).not.toHaveBeenCalled();
  });

  test("what the update refuses - no permission to edit monitors - reaches the caller", async () => {
    updates.mockRejectedValue(
      new BadDataException(
        "You do not have permission to edit Monitor.",
      ) as never,
    );

    await expect(
      MonitorGroupService.setMonitoringForMonitorsInGroup({
        monitorGroupId: GROUP_ID,
        isMonitoringOn: false,
        props: caller(),
      }),
    ).rejects.toThrow("You do not have permission to edit Monitor.");
  });
});

describe("Turn monitoring on", () => {
  test("writes it on for the monitors that are off, and only those", async () => {
    const change: MonitorGroupMonitoringChange =
      await MonitorGroupService.setMonitoringForMonitorsInGroup({
        monitorGroupId: GROUP_ID,
        isMonitoringOn: true,
        props: caller(),
      });

    const updateBy: {
      query: Dictionary<unknown>;
      data: Dictionary<unknown>;
    } = updates.mock.calls[0]![0] as {
      query: Dictionary<unknown>;
      data: Dictionary<unknown>;
    };

    expect(idsAskedFor(updateBy.query["_id"])).toEqual([OFF_1]);
    expect(updateBy.query["disableActiveMonitoring"]).toBe(true);
    expect(updateBy.query["isArchived"]).toBe(false);
    expect(updateBy.data).toEqual({ disableActiveMonitoring: false });

    expect(change).toEqual({
      monitorCount: 3,
      monitoringOffCount: 0,
      changedCount: 1,
    });
  });

  test("an archived monitor with monitoring off is left as it is: unarchiving is another matter", async () => {
    members = [
      { monitorId: ON_1, disableActiveMonitoring: false },
      { monitorId: ARCHIVED, disableActiveMonitoring: true, isArchived: true },
    ];

    await MonitorGroupService.setMonitoringForMonitorsInGroup({
      monitorGroupId: GROUP_ID,
      isMonitoringOn: true,
      props: caller(),
    });

    expect(updates).not.toHaveBeenCalled();
  });

  test("what the pay-as-you-go gate refuses reaches the caller", async () => {
    updates.mockRejectedValue(
      new BadDataException(
        "Please add a payment method to enable monitoring.",
      ) as never,
    );

    await expect(
      MonitorGroupService.setMonitoringForMonitorsInGroup({
        monitorGroupId: GROUP_ID,
        isMonitoringOn: true,
        props: caller(),
      }),
    ).rejects.toThrow("Please add a payment method to enable monitoring.");
  });
});
