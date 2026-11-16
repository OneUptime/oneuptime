import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import logger from "../../../../Server/Utils/Logger";
import { OnCallShiftChangeReason } from "../../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import ScheduleLayerChanges from "../../../../Server/Utils/OnCall/ScheduleLayerChanges";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CHANGE TO A SCHEDULE'S LAYERS MADE THROUGH THE API IS TOLD ONCE (#7813)
 * - what is held, what is told, and when.
 *
 * A write of a layer or of a person in one, made through the API (an API
 * key, an AI client over MCP, a workflow), holds its schedule's change for
 * QUIET_PERIOD_IN_SECONDS, and every further write pushes it on; the
 * Workers then tell the whole change once - who is on call worked out, the
 * feeds and reminders told - and let the hold go unless a write came
 * meanwhile. A person's write in the Dashboard, and OneUptime's own, is
 * told at once, as it always was. The services are stubbed here; the
 * burst of real hook writes is ScheduleLayerChangesBurst.test.ts.
 */

const NOW: Date = new Date("2026-03-03T12:00:00.000Z");
const SCHEDULE: ObjectID = new ObjectID("0d781300-0000-4000-8000-000000000001");
const OTHER_SCHEDULE: ObjectID = new ObjectID(
  "0d781300-0000-4000-8000-000000000002",
);
const PROJECT: ObjectID = new ObjectID("0d781300-0000-4000-8000-0000000000aa");
const USER: ObjectID = new ObjectID("0d781300-0000-4000-8000-0000000000bb");

const DASHBOARD: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: USER,
  userType: UserType.User,
};

const API_KEY: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userType: UserType.API,
  apiKeyId: new ObjectID("0d781300-0000-4000-8000-0000000000cc"),
};

let holds: jest.SpiedFunction<
  typeof OnCallDutyPolicyScheduleService.updateColumnsByIdWithoutHooks
>;
let letGo: jest.SpiedFunction<
  typeof OnCallDutyPolicyScheduleService.compareAndSetColumnsByIdWithoutHooks
>;
let dueRead: jest.SpiedFunction<typeof OnCallDutyPolicyScheduleService.findBy>;
let refresh: jest.SpiedFunction<
  typeof OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule
>;
let propagate: jest.SpiedFunction<
  typeof OnCallDutyPolicyScheduleService.propagateShiftConfigChange
>;
let errors: Array<string>;
let order: Array<string>;

function dueSchedule(
  id: ObjectID,
  dueAt: Date,
  projectId: ObjectID = PROJECT,
): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = id;
  schedule.projectId = projectId;
  schedule.rosterRefreshDueAt = dueAt;
  return schedule;
}

beforeEach(() => {
  errors = [];
  order = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(message instanceof Error ? message.message : String(message));
  }) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);

  holds = jest
    .spyOn(OnCallDutyPolicyScheduleService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);
  letGo = jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "compareAndSetColumnsByIdWithoutHooks",
    )
    .mockImplementation(async (): Promise<boolean> => {
      order.push("let go");
      return true;
    });
  dueRead = jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockResolvedValue([]);
  refresh = jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    )
    .mockImplementation((async (scheduleId: ObjectID) => {
      order.push(`refresh ${scheduleId.toString()}`);
      return {
        currentUserId: null,
        handOffTimeAt: null,
        nextUserId: null,
        nextHandOffTimeAt: null,
        rosterStartAt: null,
        nextRosterStartAt: null,
      };
    }) as never);
  propagate = jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockImplementation(async (): Promise<void> => {
      order.push("propagate");
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which writes wait for their change to be quiet", () => {
  test.each([
    ["an API key (Terraform, the CLI, a script)", API_KEY],
    [
      "a key named on the request whatever its user type",
      { tenantId: PROJECT, apiKeyId: ObjectID.generate() },
    ],
    [
      "an AI client connected over MCP, for its member",
      {
        tenantId: PROJECT,
        userId: USER,
        userType: UserType.User,
        mcpOAuthGrantId: ObjectID.generate(),
      },
    ],
    ["a workflow", { tenantId: PROJECT, userType: UserType.Workflow }],
  ])("%s: yes", (_name: string, props: DatabaseCommonInteractionProps) => {
    expect(ScheduleLayerChanges.isToldOnceQuiet(props)).toBe(true);
  });

  test.each([
    ["a person in the Dashboard", DASHBOARD],
    ["a master admin in the Dashboard", { userType: UserType.MasterAdmin }],
    ["OneUptime itself (root)", { isRoot: true }],
    [
      "OneUptime itself, even on a key's behalf",
      { isRoot: true, userType: UserType.API, apiKeyId: ObjectID.generate() },
    ],
    ["props that say nothing", {}],
  ])("%s: no", (_name: string, props: DatabaseCommonInteractionProps) => {
    expect(ScheduleLayerChanges.isToldOnceQuiet(props)).toBe(false);
  });

  test("no props at all: no", () => {
    expect(ScheduleLayerChanges.isToldOnceQuiet(undefined)).toBe(false);
    expect(ScheduleLayerChanges.isToldOnceQuiet(null)).toBe(false);
  });
});

describe("after a row of the layers is written", () => {
  test("in the Dashboard: told at once, nothing held", async () => {
    const tellNow: jest.Mock = jest.fn(async () => {
      order.push("told now");
    });

    await ScheduleLayerChanges.afterLayersWritten({
      scheduleId: SCHEDULE,
      props: DASHBOARD,
      tellNow: tellNow as unknown as () => Promise<void>,
    });

    expect(tellNow).toHaveBeenCalledTimes(1);
    expect(holds).not.toHaveBeenCalled();
  });

  test("through the API: nothing told, the change held for the quiet period from now", async () => {
    const tellNow: jest.Mock = jest.fn(async () => {
      return undefined;
    });

    await ScheduleLayerChanges.afterLayersWritten({
      scheduleId: SCHEDULE,
      props: API_KEY,
      tellNow: tellNow as unknown as () => Promise<void>,
    });

    expect(tellNow).not.toHaveBeenCalled();
    expect(holds).toHaveBeenCalledTimes(1);
    expect(holds.mock.calls[0]![0]).toEqual({
      id: SCHEDULE,
      data: {
        rosterRefreshDueAt: new Date("2026-03-03T12:00:30.000Z"),
      },
      skipUpdateDateColumn: true,
    });
  });

  test("each further write pushes the hold on: it is always the quiet period after the last", async () => {
    const times: Array<Date> = [
      new Date("2026-03-03T12:00:00.000Z"),
      new Date("2026-03-03T12:00:12.000Z"),
      new Date("2026-03-03T12:00:25.000Z"),
    ];

    for (const time of times) {
      (OneUptimeDate.getCurrentDate as unknown as jest.Mock).mockReturnValue(
        time,
      );

      await ScheduleLayerChanges.afterLayersWritten({
        scheduleId: SCHEDULE,
        props: API_KEY,
        tellNow: async (): Promise<void> => {
          return undefined;
        },
      });
    }

    expect(
      holds.mock.calls.map((call: Array<unknown>): string => {
        return (
          (call[0] as { data: { rosterRefreshDueAt: Date } }).data
            .rosterRefreshDueAt as Date
        ).toISOString();
      }),
    ).toEqual([
      "2026-03-03T12:00:30.000Z",
      "2026-03-03T12:00:42.000Z",
      "2026-03-03T12:00:55.000Z",
    ]);
  });

  test("a hold that cannot be written: told at once, as before, and logged", async () => {
    holds.mockRejectedValue(new Error("connection terminated"));

    const tellNow: jest.Mock = jest.fn(async () => {
      return undefined;
    });

    await ScheduleLayerChanges.afterLayersWritten({
      scheduleId: SCHEDULE,
      props: API_KEY,
      tellNow: tellNow as unknown as () => Promise<void>,
    });

    expect(tellNow).toHaveBeenCalledTimes(1);
    expect(errors.join("\n")).toContain("could not be held");
    expect(errors).toContain("connection terminated");
  });
});

describe("the Workers tell what is due", () => {
  test("they read the schedules whose quiet period is over, oldest first, a run's worth, as OneUptime", async () => {
    const now: Date = new Date("2026-03-03T12:01:00.000Z");

    await ScheduleLayerChanges.tellDueChanges(now);

    expect(dueRead).toHaveBeenCalledTimes(1);

    const read: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
      props: DatabaseCommonInteractionProps;
    } = dueRead.mock.calls[0]![0] as never;

    expect(Object.keys(read.query)).toEqual(["rosterRefreshDueAt"]);
    expect(JSON.stringify(read.query["rosterRefreshDueAt"])).toContain(
      now.toISOString(),
    );
    expect(read.select).toEqual({
      _id: true,
      projectId: true,
      rosterRefreshDueAt: true,
    });
    expect(read.sort).toEqual({ rosterRefreshDueAt: SortOrder.Ascending });
    expect(read.limit).toBe(ScheduleLayerChanges.MAX_CHANGES_PER_RUN);
    expect(read.props).toEqual({ isRoot: true });
  });

  test("each change: who is on call worked out, the feeds and reminders told, then its hold let go - in that order", async () => {
    const dueAt: Date = new Date("2026-03-03T12:00:30.000Z");
    dueRead.mockResolvedValue([dueSchedule(SCHEDULE, dueAt)]);

    expect(await ScheduleLayerChanges.tellDueChanges()).toBe(1);

    expect(order).toEqual([
      `refresh ${SCHEDULE.toString()}`,
      "propagate",
      "let go",
    ]);
    expect(propagate.mock.calls[0]![0]).toEqual({
      scheduleIds: [SCHEDULE],
      projectId: PROJECT,
      reason: OnCallShiftChangeReason.LayerChanged,
    });
    // Let go only as it was read: a write since has held it again.
    expect(letGo.mock.calls[0]![0]).toEqual({
      id: SCHEDULE,
      data: { rosterRefreshDueAt: null },
      expectedData: { rosterRefreshDueAt: dueAt },
      skipUpdateDateColumn: true,
    });
  });

  test("two schedules' changes are told apart, each once", async () => {
    dueRead.mockResolvedValue([
      dueSchedule(SCHEDULE, new Date("2026-03-03T11:59:40.000Z")),
      dueSchedule(OTHER_SCHEDULE, new Date("2026-03-03T11:59:50.000Z")),
    ]);

    expect(await ScheduleLayerChanges.tellDueChanges()).toBe(2);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(propagate).toHaveBeenCalledTimes(2);
    expect(letGo).toHaveBeenCalledTimes(2);
    expect(
      propagate.mock.calls.map((call: Array<unknown>): string => {
        return (
          call[0] as { scheduleIds: Array<ObjectID> }
        ).scheduleIds[0]!.toString();
      }),
    ).toEqual([SCHEDULE.toString(), OTHER_SCHEDULE.toString()]);
  });

  test("working out who is on call fails: the feeds and reminders still hear of it, and the hold is let go, as the hooks do", async () => {
    dueRead.mockResolvedValue([
      dueSchedule(SCHEDULE, new Date("2026-03-03T12:00:30.000Z")),
    ]);
    refresh.mockRejectedValue(
      new Error("This on-call schedule no longer exists."),
    );

    expect(await ScheduleLayerChanges.tellDueChanges()).toBe(1);

    expect(propagate).toHaveBeenCalledTimes(1);
    expect(letGo).toHaveBeenCalledTimes(1);
    expect(errors).toContain("This on-call schedule no longer exists.");
  });

  test("one schedule that cannot be let go is logged, and kept for the next run; the others are told", async () => {
    dueRead.mockResolvedValue([
      dueSchedule(SCHEDULE, new Date("2026-03-03T11:59:40.000Z")),
      dueSchedule(OTHER_SCHEDULE, new Date("2026-03-03T11:59:50.000Z")),
    ]);
    letGo.mockRejectedValueOnce(new Error("deadlock detected"));

    expect(await ScheduleLayerChanges.tellDueChanges()).toBe(1);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(errors.join("\n")).toContain("the next run tells it");
    expect(errors).toContain("deadlock detected");
  });

  test("a write came while it was told: the hold is not let go, and the change is told again once that is quiet", async () => {
    dueRead.mockResolvedValue([
      dueSchedule(SCHEDULE, new Date("2026-03-03T12:00:30.000Z")),
    ]);
    // The compare-and-set finds another moment there: nothing let go.
    letGo.mockResolvedValue(false);

    expect(await ScheduleLayerChanges.tellDueChanges()).toBe(1);

    expect(letGo).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  test("nothing due: nothing told", async () => {
    expect(await ScheduleLayerChanges.tellDueChanges()).toBe(0);

    expect(refresh).not.toHaveBeenCalled();
    expect(propagate).not.toHaveBeenCalled();
    expect(letGo).not.toHaveBeenCalled();
  });
});
