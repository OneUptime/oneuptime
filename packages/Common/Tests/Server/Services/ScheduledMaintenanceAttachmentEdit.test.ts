import DatabaseConfig from "../../../Server/DatabaseConfig";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import logger, { LogAttributes } from "../../../Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A scheduled maintenance event puts its monitors into maintenance when it
 * moves to ongoing (probing stops, and the configured status is applied) and
 * restores them when it ends. Both transitions read the monitor list at that
 * moment, so editing the list while the window ran used to leave the edited
 * part behind:
 *
 *   - a monitor detached mid-window stayed disabled and in the maintenance
 *     status for good - ending or deleting the event no longer reached it,
 *     and the flag is not user-editable;
 *   - a monitor attached mid-window kept being probed and alerting, in its
 *     real status.
 *
 * The edit now does for the changed part of the list what the transitions
 * did for the rest, while the event holds its monitors - ongoing, or in a
 * state of the project's own after ongoing and before it ended - and the
 * feed records what was attached and detached. What changed is what the
 * write stored, not what the payload asked for.
 *
 * The database is stubbed: the event before the write is served by a stub of
 * findBy, after it by findOneById, and its state timeline by the timeline
 * service's findBy. Every monitor carries the maintenance flag unless a test
 * says otherwise (monitorsNotFlagged).
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a5a-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-5a5a-4aaa-8bbb-000000000002");
const EVENT_ID: string = "0193c0de-5a5a-4aaa-8bbb-0000000000e1";
const SECOND_EVENT_ID: string = "0193c0de-5a5a-4aaa-8bbb-0000000000e2";
const MAINTENANCE_STATUS_ID: ObjectID = new ObjectID(
  "0193c0de-5a5a-4aaa-8bbb-0000000000f1",
);
const ENDED_STATE_ID: string = "0193c0de-5a5a-4aaa-8bbb-0000000000d3";

const MONITOR_A: string = "0193c0de-5a5a-4aaa-8bbb-0000000000a1";
const MONITOR_B: string = "0193c0de-5a5a-4aaa-8bbb-0000000000a2";
const MONITOR_C: string = "0193c0de-5a5a-4aaa-8bbb-0000000000a3";
const MONITOR_D: string = "0193c0de-5a5a-4aaa-8bbb-0000000000a4";
// Not a monitor of PROJECT_ID, so the project-held name read never finds it.
const FOREIGN_MONITOR: string = "0193c0de-5a5a-4aaa-8bbb-0000000000a9";

const SITE_1: string = "0193c0de-5a5a-4aaa-8bbb-0000000000b1";
const SITE_2: string = "0193c0de-5a5a-4aaa-8bbb-0000000000b2";
const SITE_3: string = "0193c0de-5a5a-4aaa-8bbb-0000000000b3";

const MONITOR_NAMES: Dictionary<string> = {
  [MONITOR_A]: "checkout-web",
  [MONITOR_B]: "payments-api",
  [MONITOR_C]: "search-api",
  [MONITOR_D]: "auth-api",
};

const REMOVED_HEADER: string = "**🗑️ Monitors Removed**:\n";
const ADDED_HEADER: string = "**🌎 Monitors Added**:\n";

/*
 * "custom" is a state the project added itself, such as "Verifying" between
 * Ongoing and Ended: it is none of the four built-in kinds.
 */
type StateKind = "scheduled" | "ongoing" | "ended" | "resolved" | "custom";

const STATE_IDS: Dictionary<string> = {
  scheduled: "0193c0de-5a5a-4aaa-8bbb-0000000000d1",
  ongoing: "0193c0de-5a5a-4aaa-8bbb-0000000000d2",
  ended: ENDED_STATE_ID,
  resolved: "0193c0de-5a5a-4aaa-8bbb-0000000000d4",
  custom: "0193c0de-5a5a-4aaa-8bbb-0000000000d5",
};

// Mirrors the service's carry-forward entry.
type AttachmentsBeforeUpdate = {
  projectId: ObjectID | undefined;
  wasOngoingBeforeUpdate: boolean;
  wasHoldingMonitorsBeforeUpdate: boolean;
  monitorIdsBeforeUpdate: Array<ObjectID> | undefined;
  networkSiteIdsBeforeUpdate: Array<ObjectID> | undefined;
};

type OnBeforeUpdateFunction = (
  updateBy: UpdateBy<ScheduledMaintenance>,
) => Promise<OnUpdate<ScheduledMaintenance>>;

type OnUpdateSuccessFunction = (
  onUpdate: OnUpdate<ScheduledMaintenance>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<ScheduledMaintenance>>;

function state(kind: StateKind): ScheduledMaintenanceState {
  const scheduledMaintenanceState: ScheduledMaintenanceState =
    new ScheduledMaintenanceState();
  scheduledMaintenanceState._id = STATE_IDS[kind]!;
  scheduledMaintenanceState.isScheduledState = kind === "scheduled";
  scheduledMaintenanceState.isOngoingState = kind === "ongoing";
  scheduledMaintenanceState.isEndedState = kind === "ended";
  scheduledMaintenanceState.isResolvedState = kind === "resolved";
  return scheduledMaintenanceState;
}

function monitor(id: string): Monitor {
  const item: Monitor = new Monitor();
  item._id = id;
  return item;
}

function site(id: string): NetworkSite {
  const item: NetworkSite = new NetworkSite();
  item._id = id;
  return item;
}

function maintenanceEvent(data: {
  id?: string;
  state: StateKind;
  monitors?: Array<string>;
  networkSites?: Array<string>;
  changeMonitorStatusToId?: ObjectID;
}): ScheduledMaintenance {
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance();
  scheduledMaintenance._id = data.id || EVENT_ID;
  scheduledMaintenance.projectId = PROJECT_ID;
  scheduledMaintenance.currentScheduledMaintenanceState = state(data.state);
  scheduledMaintenance.monitors = (data.monitors || []).map(
    (id: string): Monitor => {
      return monitor(id);
    },
  );
  scheduledMaintenance.networkSites = (data.networkSites || []).map(
    (id: string): NetworkSite => {
      return site(id);
    },
  );

  if (data.changeMonitorStatusToId) {
    scheduledMaintenance.changeMonitorStatusToId = data.changeMonitorStatusToId;
  }

  return scheduledMaintenance;
}

// The event's state timeline, oldest first, as the timeline read returns it.
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

// Sorted and lower-cased, so assertions do not depend on read order.
function idsOf(
  items: Array<ObjectID | Monitor | NetworkSite | string> | undefined,
): Array<string> {
  return (items || [])
    .map((item: ObjectID | Monitor | NetworkSite | string): string => {
      if (item instanceof ObjectID || typeof item === "string") {
        return item.toString().toLowerCase();
      }

      return (item._id || "").toString().toLowerCase();
    })
    .sort();
}

// The ids a QueryHelper.any operator (a Raw IN) was built from.
function idsInOperator(operator: unknown): Array<string> {
  const parameters: Dictionary<unknown> =
    (operator as { objectLiteralParameters?: Dictionary<unknown> })
      .objectLiteralParameters || {};

  return (Object.values(parameters) as Array<Array<string>>)
    .flat()
    .map((id: string): string => {
      return id.toLowerCase();
    });
}

function link(monitorId: string): string {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/monitors/${monitorId}`;
}

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
  updatedItemIds: Array<string>,
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

function carriedOf(
  onUpdate: OnUpdate<ScheduledMaintenance>,
): Dictionary<AttachmentsBeforeUpdate> | null {
  return onUpdate.carryForward as Dictionary<AttachmentsBeforeUpdate> | null;
}

// What the database holds before the write, and after it.
let eventsBeforeWrite: Array<ScheduledMaintenance> = [];
let eventsAfterWrite: Dictionary<ScheduledMaintenance> = {};
let stateTimeline: Array<ScheduledMaintenanceStateTimeline> = [];
/*
 * Monitors without disableActiveMonitoringBecauseOfScheduledMaintenanceEvent:
 * no event put them into maintenance, or one has released them already.
 */
let monitorsNotFlagged: Set<string> = new Set<string>();

type MonitorFindBy = {
  query: {
    _id: unknown;
    projectId: ObjectID;
    disableActiveMonitoringBecauseOfScheduledMaintenanceEvent?: boolean;
  };
  select: JSONObject;
  props: JSONObject;
};

let eventFindBy: jest.SpyInstance;
let eventFindOneById: jest.SpyInstance;
let timelineFindBy: jest.SpyInstance;
let enableActiveMonitoring: jest.SpyInstance;
let recomputeSiteRollups: jest.SpyInstance;
let monitorUpdateOneById: jest.SpyInstance;
let changeMonitorStatus: jest.SpyInstance;
let monitorFindBy: jest.SpyInstance;
let feedItem: jest.SpyInstance;

/*
 * The whole update as DatabaseService runs it: the before hook reads the
 * stored event, the write happens, and the success hook gets the carry
 * forward and the ids of the rows written.
 */
async function edit(
  data: Record<string, unknown>,
  options: {
    query?: Record<string, unknown>;
    props?: DatabaseCommonInteractionProps;
    updatedItemIds?: Array<string>;
  } = {},
): Promise<OnUpdate<ScheduledMaintenance>> {
  const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
    updateByFor(data, options),
  );

  await runUpdateSuccess(onUpdate, options.updatedItemIds || [EVENT_ID]);

  return onUpdate;
}

// The event as it reads after the write.
function afterWrite(scheduledMaintenance: ScheduledMaintenance): void {
  eventsAfterWrite[scheduledMaintenance._id!.toString()] = scheduledMaintenance;
}

function feedMarkdown(call: number = 0): string {
  return (feedItem.mock.calls[call]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

// The bullets under `header`, or null when there is no such section.
function sectionLines(markdown: string, header: string): Array<string> | null {
  const start: number = markdown.indexOf(header);

  if (start === -1) {
    return null;
  }

  const lines: Array<string> = markdown
    .slice(start + header.length)
    .split("\n");
  const end: number = lines.indexOf("");

  return end === -1 ? lines : lines.slice(0, end);
}

// The reads that name monitors for the feed, apart from the flag reads.
function nameReads(): Array<MonitorFindBy> {
  return monitorFindBy.mock.calls
    .map((call: Array<unknown>): MonitorFindBy => {
      return call[0] as MonitorFindBy;
    })
    .filter((findBy: MonitorFindBy): boolean => {
      return Boolean(findBy.select["name"]);
    });
}

// The reads of which detached monitors carry the maintenance flag.
function flagReads(): Array<MonitorFindBy> {
  return monitorFindBy.mock.calls
    .map((call: Array<unknown>): MonitorFindBy => {
      return call[0] as MonitorFindBy;
    })
    .filter((findBy: MonitorFindBy): boolean => {
      return (
        findBy.query
          .disableActiveMonitoringBecauseOfScheduledMaintenanceEvent === true
      );
    });
}

function restoredMonitorIds(call: number = 0): Array<string> {
  return idsOf(
    (enableActiveMonitoring.mock.calls[call]![0] as ScheduledMaintenance)
      .monitors,
  );
}

function flaggedMonitorIds(): Array<string> {
  return idsOf(
    monitorUpdateOneById.mock.calls.map((call: Array<unknown>): ObjectID => {
      return (call[0] as { id: ObjectID }).id;
    }),
  );
}

function expectNoMonitorSideEffects(): void {
  expect(enableActiveMonitoring).not.toHaveBeenCalled();
  expect(monitorUpdateOneById).not.toHaveBeenCalled();
  expect(changeMonitorStatus).not.toHaveBeenCalled();
  expect(recomputeSiteRollups).not.toHaveBeenCalled();
}

beforeEach(() => {
  eventsBeforeWrite = [];
  eventsAfterWrite = {};
  stateTimeline = [];
  monitorsNotFlagged = new Set<string>();

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

  timelineFindBy = jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
    .mockImplementation((async (): Promise<
      Array<ScheduledMaintenanceStateTimeline>
    > => {
      return stateTimeline;
    }) as never);

  // The "Resources Affected" read; nothing to list unless a test says so.
  jest
    .spyOn(ScheduledMaintenanceService, "findAllBy")
    .mockResolvedValue([] as never);

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

  enableActiveMonitoring = jest
    .spyOn(
      ScheduledMaintenanceStateTimelineService,
      "enableActiveMonitoringForMonitors",
    )
    .mockResolvedValue(undefined as never);

  recomputeSiteRollups = jest
    .spyOn(
      ScheduledMaintenanceStateTimelineService,
      "recomputeNetworkSiteRollups",
    )
    .mockResolvedValue(undefined as never);

  monitorUpdateOneById = jest
    .spyOn(MonitorService, "updateOneById")
    .mockResolvedValue(undefined as never);

  changeMonitorStatus = jest
    .spyOn(MonitorService, "changeMonitorStatus")
    .mockResolvedValue(undefined as never);

  /*
   * Names only the project's own monitors, as the project-held read would,
   * and answers the flag read with the flagged ones.
   */
  monitorFindBy = jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation((async (
      findBy: MonitorFindBy,
    ): Promise<Array<Monitor>> => {
      if (findBy.query.projectId?.toString() !== PROJECT_ID.toString()) {
        return [];
      }

      if (
        findBy.query.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
      ) {
        return idsInOperator(findBy.query._id)
          .filter((id: string): boolean => {
            return !monitorsNotFlagged.has(id);
          })
          .map((id: string): Monitor => {
            return monitor(id);
          });
      }

      return idsInOperator(findBy.query._id)
        .filter((id: string): boolean => {
          return Boolean(MONITOR_NAMES[id]);
        })
        .map((id: string): Monitor => {
          const item: Monitor = monitor(id);
          item.name = MONITOR_NAMES[id]!;
          return item;
        });
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

describe("ScheduledMaintenanceService.onBeforeUpdate: what each event holds before the write", () => {
  test("an update that writes neither list reads nothing and carries nothing", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];

    const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
      updateByFor({ title: "Database upgrade" }),
    );

    expect(eventFindBy).not.toHaveBeenCalled();
    expect(timelineFindBy).not.toHaveBeenCalled();
    expect(carriedOf(onUpdate)).toBeNull();
  });

  test("each list is read on its own, as root, held to the tenant's project", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A],
        networkSites: [SITE_1],
      }),
    ];

    await runBeforeUpdate(
      updateByFor({
        monitors: [{ _id: MONITOR_A }],
        networkSites: [{ _id: SITE_1 }],
      }),
    );

    expect(eventFindBy).toHaveBeenCalledTimes(2);

    const selectedRelations: Array<Array<string>> = [];

    for (const call of eventFindBy.mock.calls) {
      const findBy: {
        query: JSONObject;
        select: JSONObject;
        props: JSONObject;
      } = call[0] as {
        query: JSONObject;
        select: JSONObject;
        props: JSONObject;
      };

      expect(findBy.query["_id"]).toBe(EVENT_ID);
      expect(findBy.query["projectId"]).toBe(PROJECT_ID);
      expect(findBy.props).toEqual({ isRoot: true });
      // Every kind, because a state of the project's own is none of them.
      expect(findBy.select["currentScheduledMaintenanceState"]).toEqual({
        _id: true,
        isScheduledState: true,
        isOngoingState: true,
        isEndedState: true,
        isResolvedState: true,
      });

      selectedRelations.push(
        ["monitors", "networkSites"].filter((column: string): boolean => {
          return Boolean(findBy.select[column]);
        }),
      );
    }

    // Never both in one read: that would join one row per combination.
    expect(selectedRelations).toEqual([["monitors"], ["networkSites"]]);
  });

  test("without a tenant the query is used as the caller wrote it", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];

    await runBeforeUpdate(
      updateByFor(
        { monitors: [] },
        { query: { _id: EVENT_ID }, props: { isRoot: true } },
      ),
    );

    expect(
      (eventFindBy.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({ _id: EVENT_ID });
  });

  test("remembers the list the event held, not the ids the payload asks for", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_B, MONITOR_A.toUpperCase()],
        networkSites: [SITE_1],
      }),
    ];

    const carried: Dictionary<AttachmentsBeforeUpdate> | null = carriedOf(
      await runBeforeUpdate(
        updateByFor({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] }),
      ),
    );

    const attachments: AttachmentsBeforeUpdate = carried![EVENT_ID]!;

    // Each once, whatever case it was read back in.
    expect(idsOf(attachments.monitorIdsBeforeUpdate)).toEqual([
      MONITOR_A,
      MONITOR_B,
    ]);
    expect(attachments.wasOngoingBeforeUpdate).toBe(true);
    expect(attachments.wasHoldingMonitorsBeforeUpdate).toBe(true);
    expect(attachments.projectId?.toString()).toBe(PROJECT_ID.toString());
    // The network sites were not written, so they are not remembered.
    expect(attachments.networkSiteIdsBeforeUpdate).toBeUndefined();
  });

  test.each([
    ["an empty list", []],
    ["null", null],
  ])(
    "%s is a written list, so what the event held is remembered",
    async (_label: string, monitors: Array<unknown> | null) => {
      eventsBeforeWrite = [
        maintenanceEvent({
          state: "ongoing",
          monitors: [MONITOR_A, MONITOR_B],
        }),
      ];

      const carried: Dictionary<AttachmentsBeforeUpdate> | null = carriedOf(
        await runBeforeUpdate(updateByFor({ monitors: monitors })),
      );

      expect(idsOf(carried![EVENT_ID]!.monitorIdsBeforeUpdate)).toEqual([
        MONITOR_A,
        MONITOR_B,
      ]);
    },
  );

  test("a bulk update remembers every event it matches by its own list and state", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        id: EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_A],
      }),
      maintenanceEvent({
        id: SECOND_EVENT_ID,
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_B],
      }),
    ];

    const carried: Dictionary<AttachmentsBeforeUpdate> | null = carriedOf(
      await runBeforeUpdate(
        updateByFor(
          { monitors: [{ _id: MONITOR_C }] },
          { query: { projectId: PROJECT_ID } },
        ),
      ),
    );

    expect(idsOf(carried![EVENT_ID]!.monitorIdsBeforeUpdate)).toEqual([
      MONITOR_A,
    ]);
    expect(carried![EVENT_ID]!.wasHoldingMonitorsBeforeUpdate).toBe(true);

    expect(idsOf(carried![SECOND_EVENT_ID]!.monitorIdsBeforeUpdate)).toEqual([
      MONITOR_A,
      MONITOR_B,
    ]);
    expect(carried![SECOND_EVENT_ID]!.wasHoldingMonitorsBeforeUpdate).toBe(
      false,
    );
  });

  test("a network site list is remembered on its own, and says nothing about monitors", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "custom", networkSites: [SITE_1, SITE_2] }),
    ];
    stateTimeline = timelineOf(["scheduled", "ongoing", "custom"]);

    const carried: Dictionary<AttachmentsBeforeUpdate> | null = carriedOf(
      await runBeforeUpdate(
        updateByFor({ networkSites: [{ _id: SITE_2 }, { _id: SITE_3 }] }),
      ),
    );

    expect(idsOf(carried![EVENT_ID]!.networkSiteIdsBeforeUpdate)).toEqual([
      SITE_1,
      SITE_2,
    ]);
    expect(carried![EVENT_ID]!.monitorIdsBeforeUpdate).toBeUndefined();
    expect(carried![EVENT_ID]!.wasOngoingBeforeUpdate).toBe(false);
    // Whether monitors are held only matters when they are written.
    expect(carried![EVENT_ID]!.wasHoldingMonitorsBeforeUpdate).toBe(false);
    expect(timelineFindBy).not.toHaveBeenCalled();
  });
});

describe("ScheduledMaintenanceService.onBeforeUpdate: whether the event holds its monitors", () => {
  test.each([
    ["ongoing", true],
    ["scheduled", false],
    ["ended", false],
    ["resolved", false],
  ] as Array<[StateKind, boolean]>)(
    "a built-in %s state answers for itself (%s), with no timeline read",
    async (kind: StateKind, isHolding: boolean) => {
      eventsBeforeWrite = [
        maintenanceEvent({ state: kind, monitors: [MONITOR_A] }),
      ];

      const carried: Dictionary<AttachmentsBeforeUpdate> | null = carriedOf(
        await runBeforeUpdate(updateByFor({ monitors: [] })),
      );

      expect(carried![EVENT_ID]!.wasHoldingMonitorsBeforeUpdate).toBe(
        isHolding,
      );
      expect(carried![EVENT_ID]!.wasOngoingBeforeUpdate).toBe(
        kind === "ongoing",
      );
      expect(timelineFindBy).not.toHaveBeenCalled();
    },
  );

  test.each([
    [
      "past ongoing and not yet ended",
      true,
      ["scheduled", "ongoing", "custom"],
    ],
    [
      "past ongoing through more than one state of its own",
      true,
      ["scheduled", "ongoing", "custom", "custom"],
    ],
    ["not yet ongoing", false, ["scheduled", "custom"]],
    ["past ended", false, ["scheduled", "ongoing", "ended", "custom"]],
    ["past resolved", false, ["scheduled", "ongoing", "resolved", "custom"]],
    ["with no timeline", false, []],
  ] as Array<[string, boolean, Array<StateKind>]>)(
    "a state of the project's own %s: holding is %s",
    async (_label: string, isHolding: boolean, kinds: Array<StateKind>) => {
      eventsBeforeWrite = [
        maintenanceEvent({ state: "custom", monitors: [MONITOR_A] }),
      ];
      stateTimeline = timelineOf(kinds);

      const carried: Dictionary<AttachmentsBeforeUpdate> | null = carriedOf(
        await runBeforeUpdate(updateByFor({ monitors: [] })),
      );

      expect(carried![EVENT_ID]!.wasHoldingMonitorsBeforeUpdate).toBe(
        isHolding,
      );
      // Sites follow only the live state.
      expect(carried![EVENT_ID]!.wasOngoingBeforeUpdate).toBe(false);
      expect(timelineFindBy).toHaveBeenCalledTimes(1);
    },
  );

  test("the timeline is read as root, held to the event and its project, oldest first", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "custom", monitors: [MONITOR_A] }),
    ];
    stateTimeline = timelineOf(["scheduled", "ongoing", "custom"]);

    await runBeforeUpdate(updateByFor({ monitors: [] }));

    const findBy: {
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    } = timelineFindBy.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    };

    expect(
      (findBy.query["scheduledMaintenanceId"] as ObjectID).toString(),
    ).toBe(EVENT_ID);
    expect((findBy.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(findBy.select["scheduledMaintenanceState"]).toEqual({
      _id: true,
      isScheduledState: true,
      isOngoingState: true,
      isEndedState: true,
      isResolvedState: true,
    });
    expect(findBy.sort).toEqual({ startsAt: SortOrder.Ascending });
    expect(findBy.props).toEqual({ isRoot: true });
  });
});

describe("ScheduledMaintenanceService.onUpdateSuccess: editing the monitors of an ongoing event", () => {
  test("a detached monitor is restored, and only that one", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }));

    await edit({ monitors: [{ _id: MONITOR_A }] });

    expect(enableActiveMonitoring).toHaveBeenCalledTimes(1);

    const restored: ScheduledMaintenance = enableActiveMonitoring.mock
      .calls[0]![0] as ScheduledMaintenance;

    expect(idsOf(restored.monitors)).toEqual([MONITOR_B]);
    expect(restored.projectId?.toString()).toBe(PROJECT_ID.toString());

    expect(monitorUpdateOneById).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("an attached monitor is put into maintenance with the event's status; the others are left alone", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    // The flag the ongoing transition writes, on the attached monitor only.
    expect(monitorUpdateOneById).toHaveBeenCalledTimes(1);
    const flagWrite: {
      id: ObjectID;
      data: JSONObject;
      props: JSONObject;
    } = monitorUpdateOneById.mock.calls[0]![0] as {
      id: ObjectID;
      data: JSONObject;
      props: JSONObject;
    };
    expect(flagWrite.id.toString()).toBe(MONITOR_C);
    expect(flagWrite.data).toEqual({
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
    });
    expect(flagWrite.props).toEqual({ isRoot: true });

    // The status the event applies, with the transition's root cause.
    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
    const statusCall: Array<unknown> = changeMonitorStatus.mock.calls[0]!;
    expect((statusCall[0] as ObjectID).toString()).toBe(PROJECT_ID.toString());
    expect(idsOf(statusCall[1] as Array<ObjectID>)).toEqual([MONITOR_C]);
    expect((statusCall[2] as ObjectID).toString()).toBe(
      MAINTENANCE_STATUS_ID.toString(),
    );
    expect(statusCall[3]).toBe(true);
    expect(statusCall[4]).toBe(
      "Changed because of scheduled maintenance event: " + EVENT_ID,
    );
    expect(statusCall[6]).toEqual({ isRoot: true });

    expect(enableActiveMonitoring).not.toHaveBeenCalled();
    // An ongoing event needs no timeline to say it holds its monitors.
    expect(timelineFindBy).not.toHaveBeenCalled();
  });

  test("an attached monitor on an event that changes no status only has probing stopped", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];
    afterWrite(
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_C] }),
    );

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("swapping one monitor for another restores the old and holds the new", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(restoredMonitorIds()).toEqual([MONITOR_B]);
    expect(
      idsOf(changeMonitorStatus.mock.calls[0]![1] as Array<ObjectID>),
    ).toEqual([MONITOR_C]);
  });

  test("detaching every monitor restores them all", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing" }));

    await edit({ monitors: [] });

    expect(restoredMonitorIds()).toEqual([MONITOR_A, MONITOR_B]);
  });

  test("saving the list unchanged touches no monitor and writes no feed item", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    );

    await edit({ monitors: [{ _id: MONITOR_B }, { _id: MONITOR_A }] });

    expectNoMonitorSideEffects();
    // Read back once to learn that nothing changed.
    expect(eventFindOneById).toHaveBeenCalledTimes(1);
    expect(monitorFindBy).not.toHaveBeenCalled();
    expect(feedItem).not.toHaveBeenCalled();
  });

  test("the event is read back as root, with its monitors, state and status", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }));

    await edit({ monitors: [{ _id: MONITOR_A }] });

    const findOneById: {
      id: ObjectID;
      select: JSONObject;
      props: JSONObject;
    } = eventFindOneById.mock.calls[0]![0] as {
      id: ObjectID;
      select: JSONObject;
      props: JSONObject;
    };

    expect(findOneById.id.toString()).toBe(EVENT_ID);
    expect(findOneById.select).toEqual({
      _id: true,
      changeMonitorStatusToId: true,
      currentScheduledMaintenanceState: {
        _id: true,
        isScheduledState: true,
        isOngoingState: true,
        isEndedState: true,
        isResolvedState: true,
      },
      monitors: {
        _id: true,
      },
    });
    expect(findOneById.props).toEqual({ isRoot: true });
  });

  test("attached and detached network sites are re-rolled now, and only those", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", networkSites: [SITE_1, SITE_2] }),
    ];
    afterWrite(
      maintenanceEvent({ state: "ongoing", networkSites: [SITE_2, SITE_3] }),
    );

    await edit({ networkSites: [{ _id: SITE_2 }, { _id: SITE_3 }] });

    expect(recomputeSiteRollups).toHaveBeenCalledTimes(1);

    const rerolled: ScheduledMaintenance = recomputeSiteRollups.mock
      .calls[0]![0] as ScheduledMaintenance;

    expect(idsOf(rerolled.networkSites)).toEqual([SITE_1, SITE_3]);
    expect(rerolled.projectId?.toString()).toBe(PROJECT_ID.toString());

    // The sites are read back on their own, never joined with the monitors.
    expect(eventFindOneById).toHaveBeenCalledTimes(1);
    const select: JSONObject = (
      eventFindOneById.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    expect(select).toEqual({ _id: true, networkSites: { _id: true } });

    // Sites are not monitors.
    expect(enableActiveMonitoring).not.toHaveBeenCalled();
    expect(monitorUpdateOneById).not.toHaveBeenCalled();
  });

  test("an unchanged network site list re-rolls nothing", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", networkSites: [SITE_1] }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing", networkSites: [SITE_1] }));

    await edit({ networkSites: [{ _id: SITE_1 }] });

    expect(recomputeSiteRollups).not.toHaveBeenCalled();
  });

  test("an update the same request ends still restores what it detached, and holds nothing new", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "ended",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );

    // The transition itself restores the list attached at that moment.
    const changeState: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "changeScheduledMaintenanceState")
      .mockResolvedValue(undefined as never);

    await edit({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }],
      currentScheduledMaintenanceStateId: new ObjectID(ENDED_STATE_ID),
    });

    expect(changeState).toHaveBeenCalledTimes(1);

    // B left the event while it was held; nothing else would reach it.
    expect(restoredMonitorIds()).toEqual([MONITOR_B]);
    // C would be held after the window closed, for good.
    expect(monitorUpdateOneById).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("an update the same request starts restores nothing it never held", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_B],
      }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );
    // The transition ran after the write, so it never reached B.
    monitorsNotFlagged.add(MONITOR_B);

    // The transition itself holds the list attached at that moment.
    jest
      .spyOn(ScheduledMaintenanceService, "changeScheduledMaintenanceState")
      .mockResolvedValue(undefined as never);

    await edit({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }],
      currentScheduledMaintenanceStateId: new ObjectID(STATE_IDS["ongoing"]!),
    });

    // B was asked about, and is not forced into the operational status.
    expect(flagReads()).toHaveLength(1);
    expect(enableActiveMonitoring).not.toHaveBeenCalled();

    // C is held again, which changes nothing the transition did.
    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
    expect(
      idsOf(changeMonitorStatus.mock.calls[0]![1] as Array<ObjectID>),
    ).toEqual([MONITOR_C]);
  });

  test("an event whose row the write skipped is left alone", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        id: EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_A],
      }),
      maintenanceEvent({
        id: SECOND_EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_B],
      }),
    ];
    afterWrite(maintenanceEvent({ id: EVENT_ID, state: "ongoing" }));
    afterWrite(maintenanceEvent({ id: SECOND_EVENT_ID, state: "ongoing" }));

    await edit(
      { monitors: [] },
      { query: { projectId: PROJECT_ID }, updatedItemIds: [EVENT_ID] },
    );

    expect(enableActiveMonitoring).toHaveBeenCalledTimes(1);
    expect(restoredMonitorIds()).toEqual([MONITOR_A]);
    expect(eventFindOneById).toHaveBeenCalledTimes(1);
    expect(feedItem).toHaveBeenCalledTimes(1);
  });

  test("a bulk update acts on each event by its own state and list", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        id: EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_A],
      }),
      maintenanceEvent({
        id: SECOND_EVENT_ID,
        state: "scheduled",
        monitors: [MONITOR_B],
      }),
    ];
    afterWrite(
      maintenanceEvent({
        id: EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );
    afterWrite(
      maintenanceEvent({
        id: SECOND_EVENT_ID,
        state: "scheduled",
        monitors: [MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );

    await edit(
      { monitors: [{ _id: MONITOR_C }] },
      {
        query: { projectId: PROJECT_ID },
        updatedItemIds: [EVENT_ID, SECOND_EVENT_ID],
      },
    );

    // Only the ongoing event was holding anything.
    expect(enableActiveMonitoring).toHaveBeenCalledTimes(1);
    const restored: ScheduledMaintenance = enableActiveMonitoring.mock
      .calls[0]![0] as ScheduledMaintenance;
    expect(restored.id?.toString()).toBe(EVENT_ID);
    expect(idsOf(restored.monitors)).toEqual([MONITOR_A]);

    expect(monitorUpdateOneById).toHaveBeenCalledTimes(1);
    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
    expect(changeMonitorStatus.mock.calls[0]![4]).toBe(
      "Changed because of scheduled maintenance event: " + EVENT_ID,
    );

    // Each event records its own edit.
    expect(feedItem).toHaveBeenCalledTimes(2);
    expect(sectionLines(feedMarkdown(0), REMOVED_HEADER)).toEqual([
      `- [checkout-web](${link(MONITOR_A)})`,
    ]);
    expect(sectionLines(feedMarkdown(1), REMOVED_HEADER)).toEqual([
      `- [payments-api](${link(MONITOR_B)})`,
    ]);
  });
});

describe("ScheduledMaintenanceService.onUpdateSuccess: what the write stored, not what the payload asked for", () => {
  /*
   * The write keeps a list entry only if it can read an id from it as a
   * string (DatabaseService.sanitizeCreateOrUpdate); `{ _id: ObjectID }` -
   * what an API body's serialized ObjectID becomes - is silently dropped,
   * while the reference checks read it as an id. Stubbed here as the event
   * the write leaves behind.
   */
  test("an entry the write drops is never put into maintenance or named as added", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );

    await edit({
      monitors: [{ _id: MONITOR_A }, { _id: new ObjectID(MONITOR_C) }],
    });

    // C was never attached: nothing would ever restore it.
    expectNoMonitorSideEffects();
    expect(feedItem).not.toHaveBeenCalled();
  });

  test("a held monitor the write detaches is restored though the payload seemed to keep it", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing", monitors: [MONITOR_B] }));

    await edit({
      monitors: [{ _id: new ObjectID(MONITOR_A) }, { _id: MONITOR_B }],
    });

    expect(restoredMonitorIds()).toEqual([MONITOR_A]);
    expect(sectionLines(feedMarkdown(), REMOVED_HEADER)).toEqual([
      `- [checkout-web](${link(MONITOR_A)})`,
    ]);
    expect(feedMarkdown()).not.toContain(ADDED_HEADER);
  });

  test("a payload that leaves the list in place restores nothing", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }));

    await edit({ monitors: null });

    expectNoMonitorSideEffects();
    expect(feedItem).not.toHaveBeenCalled();
  });

  test("an event that is gone before it can be read back is left to its delete hook", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];

    await edit({ monitors: [{ _id: MONITOR_C }] });

    expectNoMonitorSideEffects();
    expect(monitorFindBy).not.toHaveBeenCalled();
    expect(feedItem).not.toHaveBeenCalled();
  });
});

describe("ScheduledMaintenanceService.onUpdateSuccess: an event in a state of the project's own", () => {
  test("past ongoing, a detached monitor is restored", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "custom", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(maintenanceEvent({ state: "custom", monitors: [MONITOR_A] }));
    stateTimeline = timelineOf(["scheduled", "ongoing", "custom"]);

    await edit({ monitors: [{ _id: MONITOR_A }] });

    // Ending the event later only reaches A; B has to be restored now.
    expect(enableActiveMonitoring).toHaveBeenCalledTimes(1);
    expect(restoredMonitorIds()).toEqual([MONITOR_B]);
    expect(monitorUpdateOneById).not.toHaveBeenCalled();
  });

  test("past ongoing, an attached monitor is held with the event's status", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "custom", monitors: [MONITOR_A] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "custom",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );
    stateTimeline = timelineOf(["scheduled", "ongoing", "custom"]);

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
    expect(
      idsOf(changeMonitorStatus.mock.calls[0]![1] as Array<ObjectID>),
    ).toEqual([MONITOR_C]);
    // Asked before the write, and again after it.
    expect(timelineFindBy).toHaveBeenCalledTimes(2);
  });

  test("moving from ongoing to a state of its own in the same update keeps holding what it attaches", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "custom",
        monitors: [MONITOR_A, MONITOR_C],
      }),
    );
    // As the timeline reads once the same update has added the new state.
    stateTimeline = timelineOf(["scheduled", "ongoing", "custom"]);

    jest
      .spyOn(ScheduledMaintenanceService, "changeScheduledMaintenanceState")
      .mockResolvedValue(undefined as never);

    await edit({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }],
      currentScheduledMaintenanceStateId: new ObjectID(STATE_IDS["custom"]!),
    });

    // Entering that state releases nothing, so C joins what is held.
    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
  });

  test.each([
    ["not yet ongoing", ["scheduled", "custom"]],
    ["past ended", ["scheduled", "ongoing", "ended", "custom"]],
  ] as Array<[string, Array<StateKind>]>)(
    "%s, it touches no monitor",
    async (_label: string, kinds: Array<StateKind>) => {
      eventsBeforeWrite = [
        maintenanceEvent({
          state: "custom",
          monitors: [MONITOR_A, MONITOR_B],
        }),
      ];
      afterWrite(
        maintenanceEvent({
          state: "custom",
          monitors: [MONITOR_A, MONITOR_C],
          changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
        }),
      );
      stateTimeline = timelineOf(kinds);

      await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

      expectNoMonitorSideEffects();
      // The edit is still recorded.
      expect(sectionLines(feedMarkdown(), REMOVED_HEADER)).toEqual([
        `- [payments-api](${link(MONITOR_B)})`,
      ]);
    },
  );

  test("past ongoing, its network sites are not re-rolled: only a live ongoing event suppresses them", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "custom", networkSites: [SITE_1] }),
    ];
    afterWrite(maintenanceEvent({ state: "custom", networkSites: [SITE_2] }));
    stateTimeline = timelineOf(["scheduled", "ongoing", "custom"]);

    await edit({ networkSites: [{ _id: SITE_2 }] });

    expectNoMonitorSideEffects();
    // Nothing reads the sites' change, so they are not read back.
    expect(eventFindOneById).not.toHaveBeenCalled();
  });
});

describe("ScheduledMaintenanceService.onUpdateSuccess: events that are not holding their monitors", () => {
  test.each(["scheduled", "ended", "resolved"] as Array<StateKind>)(
    "an event in the %s state touches no monitor or site when its lists are edited",
    async (kind: StateKind) => {
      eventsBeforeWrite = [
        maintenanceEvent({
          state: kind,
          monitors: [MONITOR_A, MONITOR_B],
          networkSites: [SITE_1],
        }),
      ];
      afterWrite(
        maintenanceEvent({
          state: kind,
          monitors: [MONITOR_A, MONITOR_C],
          networkSites: [SITE_2],
          changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
        }),
      );

      await edit({
        monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }],
        networkSites: [{ _id: SITE_2 }],
      });

      expectNoMonitorSideEffects();
      // Only the monitors are read back, for the feed; the sites need nothing.
      expect(eventFindOneById).toHaveBeenCalledTimes(1);
      expect(timelineFindBy).not.toHaveBeenCalled();

      // The edit is still recorded.
      expect(sectionLines(feedMarkdown(), REMOVED_HEADER)).toEqual([
        `- [payments-api](${link(MONITOR_B)})`,
      ]);
      expect(sectionLines(feedMarkdown(), ADDED_HEADER)).toEqual([
        `- [search-api](${link(MONITOR_C)})`,
      ]);
    },
  );

  test("an update written without the before hook changes nothing about monitors", async () => {
    afterWrite(maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }));

    await runUpdateSuccess(
      {
        updateBy: updateByFor({ monitors: [{ _id: MONITOR_A }] }),
        carryForward: null,
      },
      [EVENT_ID],
    );

    expectNoMonitorSideEffects();
    expect(eventFindOneById).not.toHaveBeenCalled();
    expect(monitorFindBy).not.toHaveBeenCalled();
  });
});

describe("ScheduledMaintenanceService.onUpdateSuccess: the updated feed item", () => {
  test("names the detached and attached monitors with dashboard links", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_C] }),
    );

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(feedItem).toHaveBeenCalledTimes(1);

    const markdown: string = feedMarkdown();

    expect(markdown).toContain(
      `\n\n${REMOVED_HEADER}- [payments-api](${link(MONITOR_B)})\n`,
    );
    expect(markdown).toContain(
      `\n\n${ADDED_HEADER}- [search-api](${link(MONITOR_C)})\n`,
    );
    // Removed first, as the incident feed has it.
    expect(markdown.indexOf(REMOVED_HEADER)).toBeLessThan(
      markdown.indexOf(ADDED_HEADER),
    );
    // A monitor that stayed is not a change.
    expect(markdown).not.toContain("checkout-web");

    const item: JSONObject = feedItem.mock.calls[0]![0] as JSONObject;
    expect((item["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect((item["scheduledMaintenanceId"] as ObjectID).toString()).toBe(
      EVENT_ID,
    );
    expect((item["userId"] as ObjectID).toString()).toBe(USER_ID.toString());
  });

  test("removing every monitor still records the edit", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_B],
      }),
    ];
    afterWrite(maintenanceEvent({ state: "scheduled" }));

    // The dashboard sends every list back, each of them empty here.
    await edit({ monitors: [], networkSites: [], hosts: [] });

    expect(feedItem).toHaveBeenCalledTimes(1);
    expect(sectionLines(feedMarkdown(), REMOVED_HEADER)).toEqual([
      `- [checkout-web](${link(MONITOR_A)})`,
      `- [payments-api](${link(MONITOR_B)})`,
    ]);
    expect(feedMarkdown()).not.toContain(ADDED_HEADER);
    expect(feedMarkdown()).not.toContain("**Resources Affected**");
  });

  test("the names are read as root, held to the project", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "scheduled", monitors: [MONITOR_A] }),
    ];
    afterWrite(maintenanceEvent({ state: "scheduled" }));

    await edit({ monitors: [] });

    expect(monitorFindBy).toHaveBeenCalledTimes(1);

    const findBy: { query: JSONObject; props: JSONObject } = monitorFindBy.mock
      .calls[0]![0] as { query: JSONObject; props: JSONObject };

    expect(findBy.query["projectId"]).toBe(PROJECT_ID);
    expect(idsInOperator(findBy.query["_id"])).toEqual([MONITOR_A]);
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("a monitor the project does not own is never named", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "scheduled", monitors: [FOREIGN_MONITOR] }),
    ];
    afterWrite(maintenanceEvent({ state: "scheduled" }));

    await edit({ monitors: [] });

    // Nothing nameable changed, and nothing else was edited.
    expect(feedItem).not.toHaveBeenCalled();
  });

  test("the list of what the event now affects is kept beside the change", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "scheduled", monitors: [MONITOR_A] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_C],
      }),
    );

    // One read per relation, each answered with only the relation selected.
    jest
      .spyOn(ScheduledMaintenanceService, "findAllBy")
      .mockImplementation((async (findAllBy: {
        select: JSONObject;
      }): Promise<Array<JSONObject>> => {
        const row: JSONObject = {
          _id: EVENT_ID,
          projectId: PROJECT_ID as unknown as JSONObject,
        };

        for (const column of Object.keys(findAllBy.select)) {
          if (column !== "_id" && column !== "projectId") {
            row[column] = null;
          }
        }

        if (findAllBy.select["monitors"]) {
          row["monitors"] = [MONITOR_A, MONITOR_C].map(
            (id: string): JSONObject => {
              return {
                _id: id,
                name: MONITOR_NAMES[id]!,
                projectId: PROJECT_ID as unknown as JSONObject,
              };
            },
          );
        }

        return [row];
      }) as never);

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    const markdown: string = feedMarkdown();

    expect(sectionLines(markdown, "**Resources Affected**:\n\n")).toEqual([
      `- [checkout-web](${link(MONITOR_A)})`,
      `- [search-api](${link(MONITOR_C)})`,
    ]);
    expect(sectionLines(markdown, ADDED_HEADER)).toEqual([
      `- [search-api](${link(MONITOR_C)})`,
    ]);
  });

  test("a root update without a tenant still acts on monitors but writes no monitor lines", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }));

    await edit({ monitors: [{ _id: MONITOR_A }] }, { props: { isRoot: true } });

    // The project comes from the event itself.
    const restored: ScheduledMaintenance = enableActiveMonitoring.mock
      .calls[0]![0] as ScheduledMaintenance;
    expect(idsOf(restored.monitors)).toEqual([MONITOR_B]);
    expect(restored.projectId?.toString()).toBe(PROJECT_ID.toString());

    // The flag is read held to the event's project; no name is read.
    expect(flagReads()[0]!.query.projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(nameReads()).toHaveLength(0);
  });
});

describe("ScheduledMaintenanceService.onUpdateSuccess: which detached monitors are released", () => {
  test("only a detached monitor still in maintenance is released", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_B, MONITOR_C],
      }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }));
    // Released already, by another event ending or a restore of its own.
    monitorsNotFlagged.add(MONITOR_C);

    await edit({ monitors: [{ _id: MONITOR_A }] });

    expect(enableActiveMonitoring).toHaveBeenCalledTimes(1);
    expect(restoredMonitorIds()).toEqual([MONITOR_B]);

    // Both are still named in the feed: the edit detached both.
    expect(sectionLines(feedMarkdown(), REMOVED_HEADER)).toEqual([
      `- [payments-api](${link(MONITOR_B)})`,
      `- [search-api](${link(MONITOR_C)})`,
    ]);
  });

  test("the flag is read as root, held to the project, for the detached monitors only", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_C] }),
    );

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(flagReads()).toHaveLength(1);

    const flagRead: MonitorFindBy = flagReads()[0]!;

    expect(idsInOperator(flagRead.query._id)).toEqual([MONITOR_B]);
    expect(flagRead.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(flagRead.props).toEqual({ isRoot: true });
  });

  test("with no detached monitor in maintenance, nothing is released", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }));
    monitorsNotFlagged.add(MONITOR_B);

    await edit({ monitors: [{ _id: MONITOR_A }] });

    expect(enableActiveMonitoring).not.toHaveBeenCalled();
    expect(feedItem).toHaveBeenCalledTimes(1);
  });
});

/*
 * The ChangeStateToOngoing job, or another request, can move the event
 * between onBeforeUpdate's read and the write, or just after the write. The
 * state before the write is then not the one the transition acted on, so
 * neither list can be decided by it alone.
 */
describe("ScheduledMaintenanceService.onUpdateSuccess: a state change racing the edit", () => {
  test("started between the read and the write: the detached monitor the start flagged is restored, the attached one held", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_B],
      }),
    ];
    // The start read [A, B], so B is flagged and C is not.
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    // B would otherwise stay disabled for good.
    expect(restoredMonitorIds()).toEqual([MONITOR_B]);
    // C would otherwise be probed and alerting through the window.
    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
    expect(
      idsOf(changeMonitorStatus.mock.calls[0]![1] as Array<ObjectID>),
    ).toEqual([MONITOR_C]);
    expect((changeMonitorStatus.mock.calls[0]![2] as ObjectID).toString()).toBe(
      MAINTENANCE_STATUS_ID.toString(),
    );
  });

  test("started just after the write: the detached monitor it never reached is left alone, the attached one held again", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_B],
      }),
    ];
    // The start read [A, C]: B was never flagged, C already is.
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );
    monitorsNotFlagged.add(MONITOR_B);

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    // B is not forced into the operational status over its real one.
    expect(enableActiveMonitoring).not.toHaveBeenCalled();
    // Idempotent with what the start did.
    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
  });

  test("started and moved to a state of the project's own before the write: still held", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_B],
      }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "custom",
        monitors: [MONITOR_A, MONITOR_C],
      }),
    );
    stateTimeline = timelineOf(["scheduled", "ongoing", "custom"]);

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(restoredMonitorIds()).toEqual([MONITOR_B]);
    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
    // Asked once, after the write; the scheduled state answered before it.
    expect(timelineFindBy).toHaveBeenCalledTimes(1);
  });

  test("ended by another request just before the write: nothing is released twice, nothing new held", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    // The end read [A, B] and released both.
    afterWrite(
      maintenanceEvent({
        state: "ended",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );
    monitorsNotFlagged.add(MONITOR_A);
    monitorsNotFlagged.add(MONITOR_B);

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(flagReads()).toHaveLength(1);
    expect(enableActiveMonitoring).not.toHaveBeenCalled();
    expect(monitorUpdateOneById).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("ended by another request just after the write: the detached monitor it no longer reached is released", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    // The end read [A, C]; B is still flagged.
    afterWrite(
      maintenanceEvent({
        state: "ended",
        monitors: [MONITOR_A, MONITOR_C],
      }),
    );

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(restoredMonitorIds()).toEqual([MONITOR_B]);
    expect(monitorUpdateOneById).not.toHaveBeenCalled();
  });

  test("an event holding nothing on either side of the write reads no flag and touches nothing", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_B],
      }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "scheduled",
        monitors: [MONITOR_A, MONITOR_C],
      }),
    );

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(flagReads()).toHaveLength(0);
    expectNoMonitorSideEffects();
  });
});

/*
 * The write has committed by the time these run. A failure used to escape
 * onUpdateSuccess: it stranded the monitors after the one that failed, and
 * skipped the rest of the edit's effects, the feed item and every later
 * event of a bulk update - and the saved update came back as an error.
 */
describe("ScheduledMaintenanceService.onUpdateSuccess: a failure after the write", () => {
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  // Every error was logged against the event and its project.
  function expectLoggedFor(scheduledMaintenanceId: string): void {
    const attributes: Array<LogAttributes> = loggerError.mock.calls
      .map((call: Array<unknown>): LogAttributes => {
        return (call[1] || {}) as LogAttributes;
      })
      .filter((logAttributes: LogAttributes): boolean => {
        return (
          logAttributes["scheduledMaintenanceId"] === scheduledMaintenanceId
        );
      });

    expect(attributes.length).toBeGreaterThan(0);

    for (const logAttributes of attributes) {
      expect(logAttributes.projectId).toBe(PROJECT_ID.toString());
    }
  }

  test("restoring the detached monitors fails: the attached ones are still held, the sites re-rolled and the feed written", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_B],
        networkSites: [SITE_1],
      }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_C],
        networkSites: [SITE_2],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );
    enableActiveMonitoring.mockRejectedValue(
      new Error("Could not acquire the status timeline lock") as never,
    );

    await expect(
      edit({
        monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }],
        networkSites: [{ _id: SITE_2 }],
      }),
    ).resolves.toBeDefined();

    expect(enableActiveMonitoring).toHaveBeenCalledTimes(1);
    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
    expect(
      idsOf(
        (recomputeSiteRollups.mock.calls[0]![0] as ScheduledMaintenance)
          .networkSites,
      ),
    ).toEqual([SITE_1, SITE_2]);

    expect(feedItem).toHaveBeenCalledTimes(1);
    expect(sectionLines(feedMarkdown(), REMOVED_HEADER)).toEqual([
      `- [payments-api](${link(MONITOR_B)})`,
    ]);
    expect(sectionLines(feedMarkdown(), ADDED_HEADER)).toEqual([
      `- [search-api](${link(MONITOR_C)})`,
    ]);

    expectLoggedFor(EVENT_ID);
  });

  test("reading which detached monitors are in maintenance fails: the attached ones are still held and the feed written", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_C] }),
    );

    const namesOnly: (findBy: MonitorFindBy) => Promise<Array<Monitor>> =
      monitorFindBy.getMockImplementation() as (
        findBy: MonitorFindBy,
      ) => Promise<Array<Monitor>>;

    monitorFindBy.mockImplementation((async (
      findBy: MonitorFindBy,
    ): Promise<Array<Monitor>> => {
      if (
        findBy.query.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent
      ) {
        throw new Error("connection reset");
      }

      return await namesOnly(findBy);
    }) as never);

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(enableActiveMonitoring).not.toHaveBeenCalled();
    expect(flaggedMonitorIds()).toEqual([MONITOR_C]);
    expect(feedItem).toHaveBeenCalledTimes(1);
    expectLoggedFor(EVENT_ID);
  });

  test("putting one attached monitor into maintenance fails: the others are still held, and the feed written", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_C, MONITOR_D],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );

    monitorUpdateOneById.mockImplementation((async (updateOneById: {
      id: ObjectID;
    }): Promise<void> => {
      if (updateOneById.id.toString() === MONITOR_C) {
        throw new Error("connection reset");
      }
    }) as never);

    await edit({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }, { _id: MONITOR_D }],
    });

    // Both were tried; D went all the way.
    expect(flaggedMonitorIds()).toEqual([MONITOR_C, MONITOR_D]);
    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
    expect(
      idsOf(changeMonitorStatus.mock.calls[0]![1] as Array<ObjectID>),
    ).toEqual([MONITOR_D]);

    expect(sectionLines(feedMarkdown(), ADDED_HEADER)).toEqual([
      `- [search-api](${link(MONITOR_C)})`,
      `- [auth-api](${link(MONITOR_D)})`,
    ]);

    const monitorAttributes: Array<LogAttributes> = loggerError.mock.calls
      .map((call: Array<unknown>): LogAttributes => {
        return (call[1] || {}) as LogAttributes;
      })
      .filter((logAttributes: LogAttributes): boolean => {
        return Boolean(logAttributes["monitorId"]);
      });
    expect(monitorAttributes.length).toBeGreaterThan(0);
    expect(monitorAttributes[0]!["monitorId"]).toBe(MONITOR_C);
    expectLoggedFor(EVENT_ID);
  });

  test("the status change of one attached monitor fails: the others still get it", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "ongoing",
        monitors: [MONITOR_A, MONITOR_C, MONITOR_D],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );
    changeMonitorStatus.mockRejectedValueOnce(
      new Error("Could not acquire the status timeline lock") as never,
    );

    await edit({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }, { _id: MONITOR_D }],
    });

    expect(flaggedMonitorIds()).toEqual([MONITOR_C, MONITOR_D]);
    expect(changeMonitorStatus).toHaveBeenCalledTimes(2);
    expect(
      changeMonitorStatus.mock.calls
        .map((call: Array<unknown>): Array<string> => {
          return idsOf(call[1] as Array<ObjectID>);
        })
        .flat()
        .sort(),
    ).toEqual([MONITOR_C, MONITOR_D]);
    expect(feedItem).toHaveBeenCalledTimes(1);
  });

  test("one event of a bulk update failing leaves the next one to its edit and its feed item", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({
        id: EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_A],
      }),
      maintenanceEvent({
        id: SECOND_EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_B],
      }),
    ];
    afterWrite(
      maintenanceEvent({ id: EVENT_ID, state: "ongoing", monitors: [] }),
    );
    afterWrite(
      maintenanceEvent({
        id: SECOND_EVENT_ID,
        state: "ongoing",
        monitors: [],
      }),
    );

    enableActiveMonitoring.mockImplementation((async (
      scheduledMaintenance: ScheduledMaintenance,
    ): Promise<void> => {
      if (scheduledMaintenance.id?.toString() === EVENT_ID) {
        throw new Error("connection reset");
      }
    }) as never);

    await edit(
      { monitors: [] },
      {
        query: { projectId: PROJECT_ID },
        updatedItemIds: [EVENT_ID, SECOND_EVENT_ID],
      },
    );

    expect(enableActiveMonitoring).toHaveBeenCalledTimes(2);
    expect(restoredMonitorIds(1)).toEqual([MONITOR_B]);
    expect(
      (
        enableActiveMonitoring.mock.calls[1]![0] as ScheduledMaintenance
      ).id?.toString(),
    ).toBe(SECOND_EVENT_ID);

    // Each event still records its own edit.
    expect(feedItem).toHaveBeenCalledTimes(2);
    expect(sectionLines(feedMarkdown(0), REMOVED_HEADER)).toEqual([
      `- [checkout-web](${link(MONITOR_A)})`,
    ]);
    expect(sectionLines(feedMarkdown(1), REMOVED_HEADER)).toEqual([
      `- [payments-api](${link(MONITOR_B)})`,
    ]);

    expectLoggedFor(EVENT_ID);
  });

  test("the event cannot be read back: nothing is acted on, and the rest of the edit is still recorded", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "ongoing", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    eventFindOneById.mockRejectedValue(new Error("connection reset") as never);

    await edit({
      title: "Database upgrade",
      monitors: [{ _id: MONITOR_A }],
    });

    expectNoMonitorSideEffects();
    expect(feedItem).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain("Database upgrade");
    expect(feedMarkdown()).not.toContain(REMOVED_HEADER);
    expectLoggedFor(EVENT_ID);
  });

  test("whether the event holds its monitors after the write cannot be read: nothing new is held, the detached ones are still restored", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "custom", monitors: [MONITOR_A, MONITOR_B] }),
    ];
    afterWrite(
      maintenanceEvent({
        state: "custom",
        monitors: [MONITOR_A, MONITOR_C],
        changeMonitorStatusToId: MAINTENANCE_STATUS_ID,
      }),
    );

    // Read before the write; the read after it fails.
    timelineFindBy
      .mockResolvedValueOnce(
        timelineOf(["scheduled", "ongoing", "custom"]) as never,
      )
      .mockRejectedValueOnce(new Error("connection reset") as never);

    await edit({ monitors: [{ _id: MONITOR_A }, { _id: MONITOR_C }] });

    expect(timelineFindBy).toHaveBeenCalledTimes(2);
    expect(restoredMonitorIds()).toEqual([MONITOR_B]);
    // Left probed rather than disabled with nothing to restore it.
    expect(monitorUpdateOneById).not.toHaveBeenCalled();
    expect(changeMonitorStatus).not.toHaveBeenCalled();
    expect(feedItem).toHaveBeenCalledTimes(1);
    expectLoggedFor(EVENT_ID);
  });

  test("naming the changed monitors fails: the feed item is still written for the rest", async () => {
    eventsBeforeWrite = [
      maintenanceEvent({ state: "scheduled", monitors: [MONITOR_A] }),
    ];
    afterWrite(maintenanceEvent({ state: "scheduled" }));
    monitorFindBy.mockRejectedValue(new Error("connection reset") as never);

    await edit({ title: "Database upgrade", monitors: [] });

    expect(feedItem).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()).toContain("Database upgrade");
    expect(feedMarkdown()).not.toContain(REMOVED_HEADER);
    expectLoggedFor(EVENT_ID);
  });
});
