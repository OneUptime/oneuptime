import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorLabelRuleEngineService from "../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorOwnerRuleEngineService from "../../../Server/Services/MonitorOwnerRuleEngineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import StatusPageMonitorRuleEngineService from "../../../Server/Services/StatusPageMonitorRuleEngineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import {
  ProjectScopedReferenceException,
  UnreadableParentException,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// The refusals below are deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A MONITOR'S STATUS ROWS AND WHO WRITES THEM.
 *
 * A status row is read through its monitor, so a row a person writes is held
 * to their read of the monitor (CreatePermission.checkParentPermission):
 *
 *   - the first row of a monitor just created is part of creating it, as an
 *     incident's first state is, so OneUptime writes it - for the person who
 *     created the monitor, who stays its creator. Written as them, a creator
 *     whose read reaches only what they own would not reach it yet: they are
 *     made an owner once the create returns.
 *   - a change a person makes to several monitors - an incident they declare
 *     or edit - writes each row as them. A monitor they may not read keeps
 *     its status, and the others are still changed; a caller who may write
 *     no status row at all is refused, as before.
 *
 * No database: the status rows and the hook's other steps are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-00000000a001",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-00000000a002",
);
const THIRD_MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-00000000a003",
);
const STATUS_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-00000000b001",
);
const CREATOR_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-00000000c001",
);

// Calls a protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = MonitorService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(MonitorService, args);
}

function createdMonitor(): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    name: "Checkout API",
    // Manual monitors take no probes, which keeps the inline probe step out.
    monitorType: MonitorType.Manual,
    currentMonitorStatusId: STATUS_ID,
  } as unknown as Monitor;
}

function createdBy(props: DatabaseCommonInteractionProps): OnCreate<Monitor> {
  return {
    createBy: {
      data: createdMonitor(),
      props: props,
    } as unknown as CreateBy<Monitor>,
    carryForward: null,
  };
}

// The hook runs its slow steps on a detached chain: wait for the effect.
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 200; attempt++) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new monitor's first status row", () => {
  let changeMonitorStatus: jest.Mock;

  beforeEach(() => {
    getJestSpyOn(
      MonitorLabelRuleEngineService,
      "applyRulesToMonitor",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      MonitorOwnerRuleEngineService,
      "applyRulesToMonitor",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      StatusPageMonitorRuleEngineService,
      "syncRulesForMonitor",
    ).mockResolvedValue([] as never);
    getJestSpyOn(
      ServiceLevelObjectiveMonitorRuleEngineService,
      "syncSlosForMonitor",
    ).mockResolvedValue([] as never);
    getJestSpyOn(MonitorService, "findOneById").mockResolvedValue(
      createdMonitor() as never,
    );

    const service: never = MonitorService as never;

    getJestSpyOn(
      service,
      "handleWorkspaceOperationsAsync" as never,
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      service,
      "refreshMonitorProbeStatus" as never,
    ).mockResolvedValue(undefined as never);
    changeMonitorStatus = getJestSpyOn(
      service,
      "changeMonitorStatus" as never,
    ).mockResolvedValue(undefined as never) as unknown as jest.Mock;
  });

  test.each([
    [
      "a team member",
      {
        userId: CREATOR_ID,
        userType: UserType.User,
        tenantId: PROJECT_ID,
      },
      CREATOR_ID,
    ],
    ["an API key", { userType: UserType.API, tenantId: PROJECT_ID }, undefined],
  ] as Array<[string, DatabaseCommonInteractionProps, ObjectID | undefined]>)(
    "is written by OneUptime for the monitor %s created, naming who created it",
    async (
      _creator: string,
      props: DatabaseCommonInteractionProps,
      creatorId: ObjectID | undefined,
    ) => {
      await callHook("onCreateSuccess", createdBy(props), createdMonitor());

      await waitFor(() => {
        return changeMonitorStatus.mock.calls.length > 0;
      });

      expect(changeMonitorStatus).toHaveBeenCalledTimes(1);

      const call: Array<unknown> = changeMonitorStatus.mock.calls[0]!;

      expect(call[1]).toEqual([MONITOR_ID]);
      expect(call[2]).toBe(STATUS_ID);
      expect(call[6]).toEqual({ isRoot: true, userId: creatorId });
    },
  );
});

describe("a change to several monitors writes each row as the person making it", () => {
  const member: DatabaseCommonInteractionProps = {
    userId: CREATOR_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
  };

  let createdFor: Array<string>;

  beforeEach(() => {
    createdFor = [];

    getJestSpyOn(MonitorStatusTimelineService, "findOneBy").mockResolvedValue(
      null as never,
    );
  });

  const refuseFor: (monitorId: ObjectID, refusal: Error) => void = (
    monitorId: ObjectID,
    refusal: Error,
  ): void => {
    getJestSpyOn(MonitorStatusTimelineService, "create").mockImplementation(
      (async (
        createBy: CreateBy<MonitorStatusTimeline>,
      ): Promise<MonitorStatusTimeline> => {
        expect(createBy.props).toBe(member);

        if (createBy.data.monitorId?.toString() === monitorId.toString()) {
          throw refusal;
        }

        createdFor.push(createBy.data.monitorId!.toString());

        return createBy.data;
      }) as never,
    );
  };

  test("a monitor their read of monitors does not reach keeps its status, and the others still change", async () => {
    refuseFor(
      OTHER_MONITOR_ID,
      new UnreadableParentException(
        `This monitor status timeline references records that are not in this project: Monitor "${OTHER_MONITOR_ID.toString()}". Please pick values from this project and try again.`,
      ),
    );

    await expect(
      MonitorService.changeMonitorStatus(
        PROJECT_ID,
        [MONITOR_ID, OTHER_MONITOR_ID, THIRD_MONITOR_ID],
        STATUS_ID,
        true,
        "Status was changed because an incident was updated.",
        undefined,
        member,
      ),
    ).resolves.toBeUndefined();

    expect(createdFor).toEqual([
      MONITOR_ID.toString(),
      THIRD_MONITOR_ID.toString(),
    ]);
  });

  test.each([
    [
      "a caller who may write no status row at all",
      new NotAuthorizedException(
        "You do not have permissions to create Monitor Status Timeline.",
      ),
    ],
    [
      "a status of another project",
      new ProjectScopedReferenceException(
        `This monitor status timeline references records that are not in this project: Monitor Status "${STATUS_ID.toString()}". Please pick values from this project and try again.`,
      ),
    ],
    ["any other failure", new BadDataException("Something else broke.")],
  ])(
    "%s still stops the change, as before",
    async (_why: string, refusal: Error) => {
      refuseFor(OTHER_MONITOR_ID, refusal);

      await expect(
        MonitorService.changeMonitorStatus(
          PROJECT_ID,
          [MONITOR_ID, OTHER_MONITOR_ID, THIRD_MONITOR_ID],
          STATUS_ID,
          true,
          undefined,
          undefined,
          member,
        ),
      ).rejects.toThrow(refusal.message);

      expect(createdFor).toEqual([MONITOR_ID.toString()]);
    },
  );
});
