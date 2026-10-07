import DatabaseConfig from "../../../Server/DatabaseConfig";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService, {
  MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE,
} from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A SCHEDULED MAINTENANCE EVENT'S CHANGE MONITOR STATUS TO CAN BE CHANGED
 * UNTIL THE EVENT STARTS.
 *
 * The maintainer's decision: editable until the event starts, read-only
 * once it is ongoing. The event's monitors change to the status when it
 * starts, so a change after that would leave them in a status the event no
 * longer names.
 *
 * Before this, the relation took no update at all (only master admins could
 * write it), while its ID column stayed writable over the API at any time -
 * an ongoing event's status could be changed with nothing following it.
 *
 * ScheduledMaintenanceService.onBeforeUpdate now reads the status each event
 * the update matches holds, and refuses a change once the event has started
 * (Common/Utils/ScheduledMaintenanceStart: ongoing, ended, completed, or a
 * state of the project's own after Ongoing), under either name. Sending back
 * the status an event holds is no change and always goes through.
 * onUpdateSuccess names a real change in the feed, and puts the new status
 * on the monitors of an event that started between the read and the write.
 *
 * The database is stubbed: the events before the write by findBy, after it
 * by findOneById, the project's states by getAllScheduledMaintenanceStates.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

const DASHBOARD: string = "https://oneuptime.example/dashboard";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a5a-4bbb-8ccc-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a5a-4bbb-8ccc-000000000002",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-5a5a-4bbb-8ccc-000000000003");

const EVENT_ID: string = "0193c0de-5a5a-4bbb-8ccc-0000000000e1";
const SECOND_EVENT_ID: string = "0193c0de-5a5a-4bbb-8ccc-0000000000e2";
const THIRD_EVENT_ID: string = "0193c0de-5a5a-4bbb-8ccc-0000000000e3";

const DEGRADED_STATUS_ID: string = "0193c0de-5a5a-4bbb-8ccc-0000000000f1";
const MAINTENANCE_STATUS_ID: string = "0193c0de-5a5a-4bbb-8ccc-0000000000f2";

const MONITOR_A: string = "0193c0de-5a5a-4bbb-8ccc-0000000000a1";
const MONITOR_B: string = "0193c0de-5a5a-4bbb-8ccc-0000000000a2";

const STATUS_NAMES: Dictionary<string> = {
  [DEGRADED_STATUS_ID]: "Degraded",
  [MAINTENANCE_STATUS_ID]: "Under Maintenance",
};

/*
 * The project's states, in their order. "confirmed" is a state the project
 * added before Ongoing, "verifying" one after it.
 */
type StateKind =
  | "scheduled"
  | "confirmed"
  | "ongoing"
  | "verifying"
  | "ended"
  | "completed";

const STATE_ORDER: Array<StateKind> = [
  "scheduled",
  "confirmed",
  "ongoing",
  "verifying",
  "ended",
  "completed",
];

function stateId(kind: StateKind): string {
  return `0193c0de-5a5a-4bbb-8ccc-0000000000d${STATE_ORDER.indexOf(kind) + 1}`;
}

function state(kind: StateKind): ScheduledMaintenanceState {
  const scheduledMaintenanceState: ScheduledMaintenanceState =
    new ScheduledMaintenanceState();
  scheduledMaintenanceState._id = stateId(kind);
  scheduledMaintenanceState.order = STATE_ORDER.indexOf(kind) + 1;
  scheduledMaintenanceState.isScheduledState = kind === "scheduled";
  scheduledMaintenanceState.isOngoingState = kind === "ongoing";
  scheduledMaintenanceState.isEndedState = kind === "ended";
  scheduledMaintenanceState.isResolvedState = kind === "completed";
  return scheduledMaintenanceState;
}

const PROJECT_STATES: Array<ScheduledMaintenanceState> = STATE_ORDER.map(
  (kind: StateKind): ScheduledMaintenanceState => {
    return state(kind);
  },
);

function maintenanceEvent(data: {
  id?: string;
  projectId?: ObjectID;
  state: StateKind;
  monitorStatusId?: string;
  monitors?: Array<string>;
}): ScheduledMaintenance {
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance();
  scheduledMaintenance._id = data.id || EVENT_ID;
  scheduledMaintenance.projectId = data.projectId || PROJECT_ID;
  scheduledMaintenance.currentScheduledMaintenanceState = state(data.state);

  if (data.monitorStatusId) {
    scheduledMaintenance.changeMonitorStatusToId = new ObjectID(
      data.monitorStatusId,
    );
  }

  scheduledMaintenance.monitors = (data.monitors || []).map(
    (id: string): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor._id = id;
      return monitor;
    },
  );

  return scheduledMaintenance;
}

function timelineOf(
  kinds: Array<StateKind>,
): Array<ScheduledMaintenanceStateTimeline> {
  return kinds.map((kind: StateKind): ScheduledMaintenanceStateTimeline => {
    const item: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    item.scheduledMaintenanceId = new ObjectID(EVENT_ID);
    item.scheduledMaintenanceState = state(kind);
    return item;
  });
}

type OnBeforeUpdateFunction = (
  updateBy: UpdateBy<ScheduledMaintenance>,
) => Promise<OnUpdate<ScheduledMaintenance>>;

type OnUpdateSuccessFunction = (
  onUpdate: OnUpdate<ScheduledMaintenance>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<ScheduledMaintenance>>;

function updateByFor(
  data: Record<string, unknown>,
  options: {
    query?: Record<string, unknown>;
    props?: DatabaseCommonInteractionProps;
  } = {},
): UpdateBy<ScheduledMaintenance> {
  return {
    query: (options.query || {
      _id: EVENT_ID,
    }) as UpdateBy<ScheduledMaintenance>["query"],
    data: data as UpdateBy<ScheduledMaintenance>["data"],
    props: options.props || { tenantId: PROJECT_ID, userId: USER_ID },
    limit: 1,
    skip: 0,
  };
}

async function runBeforeUpdate(
  updateBy: UpdateBy<ScheduledMaintenance>,
): Promise<OnUpdate<ScheduledMaintenance>> {
  return await (
    ScheduledMaintenanceService as unknown as {
      onBeforeUpdate: OnBeforeUpdateFunction;
    }
  ).onBeforeUpdate(updateBy);
}

async function runUpdateSuccess(
  onUpdate: OnUpdate<ScheduledMaintenance>,
  updatedItemIds: Array<string> = [EVENT_ID],
): Promise<void> {
  await (
    ScheduledMaintenanceService as unknown as {
      onUpdateSuccess: OnUpdateSuccessFunction;
    }
  ).onUpdateSuccess(
    onUpdate,
    updatedItemIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

// The whole update as DatabaseService runs it, around the write.
async function edit(
  data: Record<string, unknown>,
  options: {
    query?: Record<string, unknown>;
    props?: DatabaseCommonInteractionProps;
  } = {},
): Promise<OnUpdate<ScheduledMaintenance>> {
  const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
    updateByFor(data, options),
  );

  await runUpdateSuccess(onUpdate);

  return onUpdate;
}

type MonitorStatusCarried = {
  projectId: ObjectID | undefined;
  monitorStatusId: string | null;
};

function carriedStatusOf(
  onUpdate: OnUpdate<ScheduledMaintenance>,
): Dictionary<MonitorStatusCarried> | null {
  return (
    (
      onUpdate.carryForward as {
        monitorStatus?: Dictionary<MonitorStatusCarried> | null;
      } | null
    )?.monitorStatus ?? null
  );
}

type EventFindBy = {
  query: Record<string, unknown>;
  select: JSONObject;
  props: DatabaseCommonInteractionProps;
  limit: number;
};

// What the database holds before the write, and after it.
let eventsBeforeWrite: Array<ScheduledMaintenance> = [];
let eventsAfterWrite: Dictionary<ScheduledMaintenance> = {};
let stateTimeline: Array<ScheduledMaintenanceStateTimeline> = [];

let eventFindBy: jest.SpyInstance;
let eventFindOneById: jest.SpyInstance;
let statesRead: jest.SpyInstance;
let changeMonitorStatus: jest.SpyInstance;
let monitorStatusFindOneBy: jest.SpyInstance;
let feedItem: jest.SpyInstance;

function afterWrite(scheduledMaintenance: ScheduledMaintenance): void {
  eventsAfterWrite[scheduledMaintenance._id!.toString()] = scheduledMaintenance;
}

// The reads of the status before the write (the ones that select it).
function statusReads(): Array<EventFindBy> {
  return eventFindBy.mock.calls
    .map((call: Array<unknown>): EventFindBy => {
      return call[0] as EventFindBy;
    })
    .filter((findBy: EventFindBy): boolean => {
      return Boolean(findBy.select["changeMonitorStatusToId"]);
    });
}

function feedMarkdown(call: number = 0): string {
  return (feedItem.mock.calls[call]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

beforeEach(() => {
  eventsBeforeWrite = [];
  eventsAfterWrite = {};
  stateTimeline = [];

  eventFindBy = jest
    .spyOn(ScheduledMaintenanceService, "findBy")
    .mockImplementation((async (): Promise<Array<ScheduledMaintenance>> => {
      return eventsBeforeWrite;
    }) as never);

  eventFindOneById = jest
    .spyOn(ScheduledMaintenanceService, "findOneById")
    .mockImplementation((async (findOneById: {
      id: ObjectID;
    }): Promise<ScheduledMaintenance | null> => {
      return eventsAfterWrite[findOneById.id.toString()] || null;
    }) as never);

  // The "Resources Affected" read of the feed; nothing to list here.
  jest
    .spyOn(ScheduledMaintenanceService, "findAllBy")
    .mockResolvedValue([] as never);

  statesRead = jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockImplementation((async (): Promise<
      Array<ScheduledMaintenanceState>
    > => {
      return PROJECT_STATES;
    }) as never);

  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
    .mockImplementation((async (): Promise<
      Array<ScheduledMaintenanceStateTimeline>
    > => {
      return stateTimeline;
    }) as never);

  // The reference checks have suites of their own.
  jest
    .spyOn(
      ScheduledMaintenanceService as unknown as {
        validateProjectScopedReferences: () => Promise<void>;
      },
      "validateProjectScopedReferences",
    )
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockImplementation((() => {
      return undefined;
    }) as never);

  changeMonitorStatus = jest
    .spyOn(MonitorService, "changeMonitorStatus")
    .mockResolvedValue(undefined as never);

  // Names only the project's own statuses, as the project-held read would.
  monitorStatusFindOneBy = jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: { _id: string; projectId: ObjectID };
    }): Promise<MonitorStatus | null> => {
      if (findOneBy.query.projectId?.toString() !== PROJECT_ID.toString()) {
        return null;
      }

      const name: string | undefined =
        STATUS_NAMES[String(findOneBy.query._id).toLowerCase()];

      if (!name) {
        return null;
      }

      const monitorStatus: MonitorStatus = new MonitorStatus();
      monitorStatus._id = String(findOneBy.query._id);
      monitorStatus.name = name;
      return monitorStatus;
    }) as never);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockImplementation(async (): Promise<URL> => {
      return URL.fromString(DASHBOARD);
    });

  feedItem = jest
    .spyOn(
      ScheduledMaintenanceFeedService,
      "createScheduledMaintenanceFeedItem",
    )
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ScheduledMaintenanceService.onBeforeUpdate: Change Monitor Status to, until the event starts", () => {
  test.each([
    ["the ID column", { changeMonitorStatusToId: MAINTENANCE_STATUS_ID }],
    [
      "the relation, as the Affected Resources card sends it",
      { changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } },
    ],
    [
      "an ObjectID under the ID column",
      { changeMonitorStatusToId: new ObjectID(MAINTENANCE_STATUS_ID) },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "an event waiting to start takes a new status under %s",
    async (_name: string, data: Record<string, unknown>) => {
      eventsBeforeWrite = [
        maintenanceEvent({
          state: "scheduled",
          monitorStatusId: DEGRADED_STATUS_ID,
        }),
      ];

      const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
        updateByFor(data),
      );

      expect(carriedStatusOf(onUpdate)).toEqual({
        [EVENT_ID]: {
          projectId: PROJECT_ID,
          monitorStatusId: DEGRADED_STATUS_ID,
        },
      });
      // The scheduled state answers by its flag: no list is read.
      expect(statesRead).not.toHaveBeenCalled();
    },
  );

  test("an event waiting to start can have its status cleared", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "scheduled",
        monitorStatusId: DEGRADED_STATUS_ID,
      }),
    ];

    await expect(
      runBeforeUpdate(updateByFor({ changeMonitorStatusTo: null })),
    ).resolves.toBeDefined();
    await expect(
      runBeforeUpdate(updateByFor({ changeMonitorStatusToId: null })),
    ).resolves.toBeDefined();
  });

  test("an event with no status yet can be given one before it starts", async () => {
    eventsBeforeWrite = [maintenanceEvent({ state: "scheduled" })];

    const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
      updateByFor({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID }),
    );

    expect(carriedStatusOf(onUpdate)![EVENT_ID]!.monitorStatusId).toBeNull();
  });

  test("an event in a state of the project's own before Ongoing has not started: the change goes through", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "confirmed",
        monitorStatusId: DEGRADED_STATUS_ID,
      }),
    ];

    await expect(
      runBeforeUpdate(
        updateByFor({ changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } }),
      ),
    ).resolves.toBeDefined();

    // Its place decides, so the project's list is read - as root.
    expect(statesRead).toHaveBeenCalledTimes(1);
    expect(statesRead.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      props: { isRoot: true },
    });
  });

  describe.each([
    ["ongoing", "ongoing"],
    ["in a state of the project's own after Ongoing", "verifying"],
    ["ended", "ended"],
    ["completed", "completed"],
  ] as Array<[string, StateKind]>)(
    "once the event is %s",
    (_name: string, kind: StateKind) => {
      beforeEach(() => {
        eventsBeforeWrite = [
          maintenanceEvent({
            state: kind,
            monitorStatusId: DEGRADED_STATUS_ID,
          }),
        ];
      });

      test.each([
        ["the ID column", { changeMonitorStatusToId: MAINTENANCE_STATUS_ID }],
        [
          "the relation",
          { changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } },
        ],
        ["a clear of the relation", { changeMonitorStatusTo: null }],
        ["a clear of the ID column", { changeMonitorStatusToId: null }],
        [
          "both names, agreeing",
          {
            changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
            changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID },
          },
        ],
      ] as Array<[string, Record<string, unknown>]>)(
        "a change by %s is refused, with one plain message",
        async (_change: string, data: Record<string, unknown>) => {
          await expect(runBeforeUpdate(updateByFor(data))).rejects.toThrow(
            MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE,
          );
        },
      );

      test("sending back the status it holds is no change: it goes through", async () => {
        await expect(
          runBeforeUpdate(
            updateByFor({ changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID } }),
          ),
        ).resolves.toBeDefined();
        await expect(
          runBeforeUpdate(
            updateByFor({ changeMonitorStatusToId: DEGRADED_STATUS_ID }),
          ),
        ).resolves.toBeDefined();

        // No change, so whether it started is never asked.
        expect(statesRead).not.toHaveBeenCalled();
      });

      test("the status it holds, in another case or padded, is the same status", async () => {
        await expect(
          runBeforeUpdate(
            updateByFor({
              changeMonitorStatusToId: `  ${DEGRADED_STATUS_ID.toUpperCase()} `,
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("an update that leaves the status out is not asked about it", async () => {
        const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
          updateByFor({ title: "Database upgrade, part two" }),
        );

        expect(statusReads()).toEqual([]);
        expect(onUpdate.carryForward).toBeNull();
      });
    },
  );

  test("the message says what cannot be done, and why", () => {
    expect(MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE).toBe(
      "Change Monitor Status to can no longer be changed: this event has already started.",
    );
  });

  test("an event that started with no status cannot be given one", async () => {
    eventsBeforeWrite = [maintenanceEvent({ state: "ongoing" })];

    await expect(
      runBeforeUpdate(
        updateByFor({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID }),
      ),
    ).rejects.toThrow(MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE);
  });

  test("an event that started with no status may be sent no status: no change", async () => {
    eventsBeforeWrite = [maintenanceEvent({ state: "ongoing" })];

    await expect(
      runBeforeUpdate(updateByFor({ changeMonitorStatusTo: null })),
    ).resolves.toBeDefined();
  });

  test("one started event among those an update matches refuses the whole update", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        id: EVENT_ID,
        state: "scheduled",
        monitorStatusId: DEGRADED_STATUS_ID,
      }),
      maintenanceEvent({
        id: SECOND_EVENT_ID,
        state: "ongoing",
        monitorStatusId: DEGRADED_STATUS_ID,
      }),
    ];

    await expect(
      runBeforeUpdate(
        updateByFor(
          { changeMonitorStatusToId: MAINTENANCE_STATUS_ID },
          { query: { title: "Database upgrade" } },
        ),
      ),
    ).rejects.toThrow(MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE);
  });

  test("a started event that already holds the new status does not refuse an update that changes the others", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        id: EVENT_ID,
        state: "scheduled",
        monitorStatusId: DEGRADED_STATUS_ID,
      }),
      maintenanceEvent({
        id: SECOND_EVENT_ID,
        state: "ongoing",
        monitorStatusId: MAINTENANCE_STATUS_ID,
      }),
    ];

    const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
      updateByFor(
        { changeMonitorStatusToId: MAINTENANCE_STATUS_ID },
        { query: { title: "Database upgrade" } },
      ),
    );

    expect(Object.keys(carriedStatusOf(onUpdate)!).sort()).toEqual(
      [EVENT_ID, SECOND_EVENT_ID].sort(),
    );
  });

  test("the read is held to the tenant's project, as root, with the state's place and flags", async () => {
    eventsBeforeWrite = [maintenanceEvent({ state: "scheduled" })];

    await runBeforeUpdate(
      updateByFor({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID }),
    );

    const reads: Array<EventFindBy> = statusReads();

    expect(reads).toHaveLength(1);
    expect(reads[0]!.query).toEqual({ _id: EVENT_ID, projectId: PROJECT_ID });
    expect(reads[0]!.props).toEqual({ isRoot: true });
    expect(reads[0]!.select).toEqual({
      _id: true,
      projectId: true,
      changeMonitorStatusToId: true,
      currentScheduledMaintenanceState: {
        _id: true,
        order: true,
        isScheduledState: true,
        isOngoingState: true,
        isEndedState: true,
        isResolvedState: true,
      },
    });
  });

  test("without a tenant, the update's own query is read", async () => {
    eventsBeforeWrite = [maintenanceEvent({ state: "scheduled" })];

    await runBeforeUpdate(
      updateByFor(
        { changeMonitorStatusToId: MAINTENANCE_STATUS_ID },
        { props: { isRoot: true } },
      ),
    );

    expect(statusReads()[0]!.query).toEqual({ _id: EVENT_ID });
  });

  test("each project's states are read once, however many events need them", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ id: EVENT_ID, state: "confirmed" }),
      maintenanceEvent({ id: SECOND_EVENT_ID, state: "confirmed" }),
      maintenanceEvent({
        id: THIRD_EVENT_ID,
        state: "confirmed",
        projectId: OTHER_PROJECT_ID,
      }),
    ];

    await runBeforeUpdate(
      updateByFor(
        { changeMonitorStatusToId: MAINTENANCE_STATUS_ID },
        { props: { isRoot: true }, query: { title: "Database upgrade" } },
      ),
    );

    expect(statesRead).toHaveBeenCalledTimes(2);
    expect(
      statesRead.mock.calls
        .map((call: Array<unknown>): string => {
          return (call[0] as { projectId: ObjectID }).projectId.toString();
        })
        .sort(),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort());
  });

  test("a state of the project's own placed after Ongoing in a project read once refuses", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ id: EVENT_ID, state: "confirmed" }),
      maintenanceEvent({ id: SECOND_EVENT_ID, state: "verifying" }),
    ];

    await expect(
      runBeforeUpdate(
        updateByFor(
          { changeMonitorStatusToId: MAINTENANCE_STATUS_ID },
          { query: { title: "Database upgrade" } },
        ),
      ),
    ).rejects.toThrow(MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE);

    expect(statesRead).toHaveBeenCalledTimes(1);
  });

  test("two names that disagree are refused before the events are read", async () => {
    eventsBeforeWrite = [maintenanceEvent({ state: "scheduled" })];

    await expect(
      runBeforeUpdate(
        updateByFor({
          changeMonitorStatusToId: DEGRADED_STATUS_ID,
          changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID },
        }),
      ),
    ).rejects.toThrow(
      /changeMonitorStatusToId and changeMonitorStatusTo are names for the same field/,
    );

    expect(statusReads()).toEqual([]);
  });

  test("an update matching no event refuses nothing", async () => {
    eventsBeforeWrite = [];

    const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
      updateByFor({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID }),
    );

    expect(carriedStatusOf(onUpdate)).toEqual({});
  });

  test("the status and the monitors in one update carry both parts forward", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "scheduled", monitors: [MONITOR_A] }),
    ];

    const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
      updateByFor({
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
        monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      }),
    );

    const carried: {
      attachments: Dictionary<unknown> | null;
      monitorStatus: Dictionary<unknown> | null;
    } = onUpdate.carryForward as {
      attachments: Dictionary<unknown> | null;
      monitorStatus: Dictionary<unknown> | null;
    };

    expect(Object.keys(carried.attachments || {})).toEqual([EVENT_ID]);
    expect(Object.keys(carried.monitorStatus || {})).toEqual([EVENT_ID]);
  });
});

describe("ScheduledMaintenanceService.onUpdateSuccess: a real change to Change Monitor Status to", () => {
  beforeEach(() => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "scheduled",
        monitorStatusId: DEGRADED_STATUS_ID,
        monitors: [MONITOR_A, MONITOR_B],
      }),
    ];
  });

  test("is named in the event's updated feed item, by the status's name", async () => {
    afterWrite(
      maintenanceEvent({
        state: "scheduled",
        monitorStatusId: MAINTENANCE_STATUS_ID,
        monitors: [MONITOR_A, MONITOR_B],
      }),
    );

    await edit({ changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } });

    expect(feedItem).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain(
      "**Change Monitor Status to**: Under Maintenance",
    );
    expect(feedMarkdown()).not.toContain("Degraded");

    // The name is read held to the event's project, as root.
    expect(monitorStatusFindOneBy.mock.calls[0]![0]).toEqual({
      query: { _id: MAINTENANCE_STATUS_ID, projectId: PROJECT_ID },
      select: { name: true },
      props: { isRoot: true },
    });
  });

  test("a status cleared reads that the monitors keep theirs", async () => {
    afterWrite(
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_B],
      }),
    );

    await edit({ changeMonitorStatusToId: null });

    expect(feedMarkdown()).toContain(
      "**Change Monitor Status to**: Monitors keep their status.",
    );
    expect(monitorStatusFindOneBy).not.toHaveBeenCalled();
  });

  test("sending back the status the event holds adds no line, and no feed item of its own", async () => {
    afterWrite(eventsBeforeWrite[0]!);

    await edit({ changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID } });

    expect(feedItem).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("a status the project does not have is not named, and adds no feed item of its own", async () => {
    const unknownStatus: string = "0193c0de-5a5a-4bbb-8ccc-0000000000f9";

    afterWrite(
      maintenanceEvent({
        state: "scheduled",
        monitorStatusId: unknownStatus,
        monitors: [MONITOR_A],
      }),
    );

    await edit({ changeMonitorStatusToId: unknownStatus });

    expect(feedItem).not.toHaveBeenCalled();
  });

  test("a line the name cannot be read for is left out; the rest of the feed item stays", async () => {
    monitorStatusFindOneBy.mockRejectedValue(new Error("read failed") as never);

    afterWrite(
      maintenanceEvent({
        state: "scheduled",
        monitorStatusId: MAINTENANCE_STATUS_ID,
      }),
    );

    await edit({
      changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      title: "Database upgrade, part two",
    });

    expect(feedItem).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain("Database upgrade, part two");
    expect(feedMarkdown()).not.toContain("**Change Monitor Status to**");
  });

  test("an event still waiting to start puts nothing on its monitors: it starts with the new status", async () => {
    afterWrite(
      maintenanceEvent({
        state: "scheduled",
        monitorStatusId: MAINTENANCE_STATUS_ID,
        monitors: [MONITOR_A, MONITOR_B],
      }),
    );

    await edit({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("an event that started between the read and the write puts its monitors in the new status", async () => {
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitorStatusId: MAINTENANCE_STATUS_ID,
        monitors: [MONITOR_A, MONITOR_B],
      }),
    );

    await edit({ changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } });

    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);

    const [projectId, monitorIds, statusId, notifyOwners] = changeMonitorStatus
      .mock.calls[0]! as [ObjectID, Array<ObjectID>, ObjectID, boolean];

    expect(projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      monitorIds
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort(),
    ).toEqual([MONITOR_A, MONITOR_B].sort());
    expect(statusId.toString()).toBe(MAINTENANCE_STATUS_ID);
    expect(notifyOwners).toBe(true);
  });

  test("so does one in a state of the project's own after Ongoing, which still holds them", async () => {
    stateTimeline = timelineOf(["scheduled", "ongoing", "verifying"]);

    afterWrite(
      maintenanceEvent({
        state: "verifying",
        monitorStatusId: MAINTENANCE_STATUS_ID,
        monitors: [MONITOR_A],
      }),
    );

    await edit({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID });

    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
    expect((changeMonitorStatus.mock.calls[0]![2] as ObjectID).toString()).toBe(
      MAINTENANCE_STATUS_ID,
    );
  });

  test("an event that ended in between holds nothing: its monitors are left as they are", async () => {
    afterWrite(
      maintenanceEvent({
        state: "ended",
        monitorStatusId: MAINTENANCE_STATUS_ID,
        monitors: [MONITOR_A],
      }),
    );

    await edit({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("a status cleared puts nothing on the monitors, even of an event that started", async () => {
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A],
      }),
    );

    await edit({ changeMonitorStatusTo: null });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("an event with no monitors has nothing to put in the status", async () => {
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitorStatusId: MAINTENANCE_STATUS_ID,
      }),
    );

    await edit({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("an event deleted since the write is left alone", async () => {
    await edit({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("a failure to change the monitors is logged, never turned into an error: the update is saved", async () => {
    const loggedErrors: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    changeMonitorStatus.mockRejectedValue(new Error("lock failed") as never);

    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitorStatusId: MAINTENANCE_STATUS_ID,
        monitors: [MONITOR_A],
      }),
    );

    await expect(
      edit({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID }),
    ).resolves.toBeDefined();

    expect(
      loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes("applyMonitorStatusToStartedEvent");
      }),
    ).toBe(true);
    // The feed item still records the change.
    expect(feedMarkdown()).toContain(
      "**Change Monitor Status to**: Under Maintenance",
    );
  });

  test("an update written without the before hook changes nothing about the status", async () => {
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitorStatusId: MAINTENANCE_STATUS_ID,
        monitors: [MONITOR_A],
      }),
    );

    await runUpdateSuccess({
      updateBy: updateByFor({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID }),
      carryForward: null,
    });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(feedItem).not.toHaveBeenCalled();
    expect(eventFindOneById).not.toHaveBeenCalled();
  });
});
