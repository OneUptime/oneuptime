import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import logger from "../../../../Server/Utils/Logger";
import MonitorIncidentPause, {
  MonitorHeldStatus,
  MonitorIncidentPauseState,
} from "../../../../Server/Utils/Monitor/MonitorIncidentPause";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import { compareListOrderItems } from "../../../../Utils/ListOrder";
import {
  IN_MOST_SEVERE_STATUS_OF_PAUSING_INCIDENT,
  IN_STATUS_OF_PAUSING_MAINTENANCE,
  readStatusChangeNote,
} from "../../../../Utils/Monitor/StatusChangeNotes";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHICH STATUS A MONITOR SEVERAL PAUSES HOLD IS IN (OneUptime issue #11432).
 *
 * Incidents declared by hand and scheduled maintenance events can hold one
 * monitor at once, each with a Change Monitor Status to of its own. The
 * monitor is in the most severe of those statuses: the one furthest down
 * the project's list of monitor statuses (its Order - MonitorStatus
 * priority - with the older first at one number), the status that wins
 * wherever statuses meet. The status depends only on what holds the monitor
 * now, so it is the same whatever order they started in, and a pause that
 * lets go leaves the monitor in the most severe status of what still holds
 * it - never in its own, which each pause that let go used to leave behind.
 *
 * The rule is pure (pickHeldStatus); the reads and the write around it are
 * checked here with the services' reads given. What it does on real rows,
 * through every pause and release, is MonitorPauseHeldStatusPostgres's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11432000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11432000-0000-4000-8000-0000000000f1",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "11432000-0000-4000-8000-0000000000f2",
);
const OPEN_STATE_ID: ObjectID = new ObjectID(
  "11432000-0000-4000-8000-0000000000a1",
);

const DAY_MS: number = 24 * 60 * 60 * 1000;
const FIRST_DAY: number = Date.UTC(2026, 0, 1);

/*
 * The project's list, healthiest first, as the Dashboard shows it:
 * Operational, Degraded, Under Maintenance, Partial Outage and Major
 * Outage, one Order each.
 */
function statusWith(data: {
  id: string;
  priority?: number | null | undefined;
  createdDay?: number | undefined;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus(new ObjectID(data.id));
  status.projectId = PROJECT_ID;

  if (data.priority !== undefined) {
    status.priority = data.priority as number;
  }

  status.createdAt = new Date(FIRST_DAY + (data.createdDay ?? 0) * DAY_MS);
  return status;
}

const OPERATIONAL: MonitorStatus = statusWith({
  id: "11432000-0000-4000-8000-0000000000b0",
  priority: 1,
});
const DEGRADED: MonitorStatus = statusWith({
  id: "11432000-0000-4000-8000-0000000000b1",
  priority: 2,
});
const UNDER_MAINTENANCE: MonitorStatus = statusWith({
  id: "11432000-0000-4000-8000-0000000000b2",
  priority: 3,
});
const PARTIAL_OUTAGE: MonitorStatus = statusWith({
  id: "11432000-0000-4000-8000-0000000000b3",
  priority: 4,
});
const MAJOR_OUTAGE: MonitorStatus = statusWith({
  id: "11432000-0000-4000-8000-0000000000b4",
  priority: 5,
});

const LIST: Array<MonitorStatus> = [
  OPERATIONAL,
  DEGRADED,
  UNDER_MAINTENANCE,
  PARTIAL_OUTAGE,
  MAJOR_OUTAGE,
];

let nextRecord: number = 1;

function incidentWith(status?: MonitorStatus | undefined): Incident {
  const number: number = nextRecord++;
  const incident: Incident = new Incident(
    new ObjectID(
      `11432000-0000-4000-8000-0000000c${number.toString().padStart(4, "0")}`,
    ),
  );
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = number;
  incident.incidentNumberWithPrefix = `INC-${number}`;
  incident.isCreatedAutomatically = false;
  incident.holdsMonitors = true;
  incident.pauseMonitoring = true;

  if (status) {
    incident.changeMonitorStatusToId = new ObjectID(status.id!.toString());
  }

  return incident;
}

function eventWith(status?: MonitorStatus | undefined): ScheduledMaintenance {
  const number: number = nextRecord++;
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance(
    new ObjectID(
      `11432000-0000-4000-8000-0000000e${number.toString().padStart(4, "0")}`,
    ),
  );
  scheduledMaintenance.projectId = PROJECT_ID;
  scheduledMaintenance.scheduledMaintenanceNumber = number;
  scheduledMaintenance.scheduledMaintenanceNumberWithPrefix = `SM-${number}`;

  if (status) {
    scheduledMaintenance.changeMonitorStatusToId = new ObjectID(
      status.id!.toString(),
    );
  }

  return scheduledMaintenance;
}

// How a monitor stands: the incidents pausing it and the events holding it, oldest first.
function stateWith(data: {
  incidents?: Array<Incident> | undefined;
  events?: Array<ScheduledMaintenance> | undefined;
  currentStatus?: MonitorStatus | undefined;
  monitorId?: ObjectID | undefined;
  isPausedForMaintenance?: boolean | undefined;
}): MonitorIncidentPauseState {
  const incidents: Array<Incident> = data.incidents || [];
  const events: Array<ScheduledMaintenance> = data.events || [];

  const monitor: Monitor = new Monitor(data.monitorId || MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.keepMonitoringDuringIncidents = false;
  monitor.disableActiveMonitoring = false;
  monitor.isArchived = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = incidents.length > 0;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent =
    data.isPausedForMaintenance ?? events.length > 0;

  if (data.currentStatus) {
    monitor.currentMonitorStatusId = new ObjectID(
      data.currentStatus.id!.toString(),
    );
  }

  return {
    monitor: monitor,
    pausingIncidents: incidents,
    isPaused: incidents.length > 0,
    holdingMaintenanceEvents: events,
  };
}

function heldOf(
  state: MonitorIncidentPauseState,
  statuses: ReadonlyArray<MonitorStatus> = LIST,
): MonitorHeldStatus | null {
  return MonitorIncidentPause.pickHeldStatus({
    state: state,
    statuses: statuses,
  });
}

function heldStatusName(held: MonitorHeldStatus | null): string | null {
  if (!held) {
    return null;
  }

  const index: number = LIST.findIndex((status: MonitorStatus): boolean => {
    return status.id!.toString() === held.monitorStatusId.toString();
  });

  return [
    "Operational",
    "Degraded",
    "Under Maintenance",
    "Partial Outage",
    "Major Outage",
  ][index]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the most severe of the statuses what pauses a monitor sets (pickHeldStatus)", () => {
  test("one incident declared by hand that sets a status: that status, named, and not chosen from several", () => {
    const incident: Incident = incidentWith(DEGRADED);
    const held: MonitorHeldStatus | null = heldOf(
      stateWith({ incidents: [incident] }),
    );

    expect(heldStatusName(held)).toBe("Degraded");
    expect(held?.incident).toBe(incident);
    expect(held?.scheduledMaintenance).toBeUndefined();
    expect(held?.isMostSevereOfSeveral).toBe(false);
  });

  // The issue's example: INC-1 in Major Outage, INC-2 (declared later) in Degraded.
  test("two incidents: the more severe wins whichever was declared first", () => {
    const majorFirst: Incident = incidentWith(MAJOR_OUTAGE);
    const degradedSecond: Incident = incidentWith(DEGRADED);

    const declaredMajorFirst: MonitorHeldStatus | null = heldOf(
      stateWith({ incidents: [majorFirst, degradedSecond] }),
    );
    const declaredDegradedFirst: MonitorHeldStatus | null = heldOf(
      stateWith({ incidents: [degradedSecond, majorFirst] }),
    );

    for (const held of [declaredMajorFirst, declaredDegradedFirst]) {
      expect(heldStatusName(held)).toBe("Major Outage");
      expect(held?.incident).toBe(majorFirst);
      expect(held?.isMostSevereOfSeveral).toBe(true);
    }
  });

  test("two maintenance events: the more severe wins, named the event", () => {
    const underMaintenance: ScheduledMaintenance = eventWith(UNDER_MAINTENANCE);
    const partialOutage: ScheduledMaintenance = eventWith(PARTIAL_OUTAGE);

    const held: MonitorHeldStatus | null = heldOf(
      stateWith({ events: [partialOutage, underMaintenance] }),
    );

    expect(heldStatusName(held)).toBe("Partial Outage");
    expect(held?.scheduledMaintenance).toBe(partialOutage);
    expect(held?.incident).toBeUndefined();
    expect(held?.isMostSevereOfSeveral).toBe(true);
  });

  test("an incident and maintenance: whichever's status is more severe, of either kind", () => {
    const incident: Incident = incidentWith(DEGRADED);
    const event: ScheduledMaintenance = eventWith(MAJOR_OUTAGE);

    const maintenanceWins: MonitorHeldStatus | null = heldOf(
      stateWith({ incidents: [incident], events: [event] }),
    );
    expect(heldStatusName(maintenanceWins)).toBe("Major Outage");
    expect(maintenanceWins?.scheduledMaintenance).toBe(event);

    const severeIncident: Incident = incidentWith(MAJOR_OUTAGE);
    const lesserEvent: ScheduledMaintenance = eventWith(UNDER_MAINTENANCE);

    const incidentWins: MonitorHeldStatus | null = heldOf(
      stateWith({ incidents: [severeIncident], events: [lesserEvent] }),
    );
    expect(heldStatusName(incidentWins)).toBe("Major Outage");
    expect(incidentWins?.incident).toBe(severeIncident);
    expect(incidentWins?.scheduledMaintenance).toBeUndefined();
  });

  test("set by an incident and an event alike: the incident is named, the newest of those that set it", () => {
    const older: Incident = incidentWith(PARTIAL_OUTAGE);
    const newer: Incident = incidentWith(PARTIAL_OUTAGE);
    const event: ScheduledMaintenance = eventWith(PARTIAL_OUTAGE);

    const held: MonitorHeldStatus | null = heldOf(
      stateWith({ incidents: [older, newer], events: [event] }),
    );

    expect(heldStatusName(held)).toBe("Partial Outage");
    expect(held?.incident).toBe(newer);
    expect(held?.scheduledMaintenance).toBeUndefined();
    // One status, set three times: nothing was chosen between.
    expect(held?.isMostSevereOfSeveral).toBe(false);
  });

  test("the newest of the events that set it is named", () => {
    const older: ScheduledMaintenance = eventWith(UNDER_MAINTENANCE);
    const newer: ScheduledMaintenance = eventWith(UNDER_MAINTENANCE);

    expect(
      heldOf(stateWith({ events: [older, newer] }))?.scheduledMaintenance,
    ).toBe(newer);
  });

  test("what sets no status sets none: incidents and events with none hold the monitor in no status", () => {
    expect(heldOf(stateWith({}))).toBeNull();
    expect(
      heldOf(stateWith({ incidents: [incidentWith()], events: [eventWith()] })),
    ).toBeNull();

    // One that sets none beside one that does: the other's.
    const event: ScheduledMaintenance = eventWith(UNDER_MAINTENANCE);
    const held: MonitorHeldStatus | null = heldOf(
      stateWith({ incidents: [incidentWith()], events: [event] }),
    );
    expect(heldStatusName(held)).toBe("Under Maintenance");
    expect(held?.isMostSevereOfSeveral).toBe(false);
  });

  test("events count only while maintenance pauses the monitor, incidents only while they pause it", () => {
    const event: ScheduledMaintenance = eventWith(MAJOR_OUTAGE);

    expect(
      heldOf(stateWith({ events: [event], isPausedForMaintenance: false })),
    ).toBeNull();

    const state: MonitorIncidentPauseState = stateWith({
      incidents: [incidentWith(MAJOR_OUTAGE)],
    });
    state.isPaused = false;

    expect(heldOf(state)).toBeNull();
  });

  test("a status that is not the project's, or is gone, is no status the monitor can be in: passed over", () => {
    const gone: MonitorStatus = statusWith({
      id: "11432000-0000-4000-8000-0000000000bf",
      priority: 99,
    });
    const event: ScheduledMaintenance = eventWith(DEGRADED);

    const held: MonitorHeldStatus | null = heldOf(
      stateWith({ incidents: [incidentWith(gone)], events: [event] }),
    );

    expect(heldStatusName(held)).toBe("Degraded");
    expect(held?.scheduledMaintenance).toBe(event);
    expect(held?.isMostSevereOfSeveral).toBe(false);

    expect(heldOf(stateWith({ incidents: [incidentWith(gone)] }))).toBeNull();
  });

  test("two statuses at one Order: the newer is further down the list, so it wins, as the list shows them", () => {
    const olderAtFour: MonitorStatus = statusWith({
      id: "11432000-0000-4000-8000-0000000000c4",
      priority: 4,
      createdDay: 1,
    });
    const newerAtFour: MonitorStatus = statusWith({
      id: "11432000-0000-4000-8000-0000000000c5",
      priority: 4,
      createdDay: 9,
    });

    for (const order of [
      [olderAtFour, newerAtFour],
      [newerAtFour, olderAtFour],
    ]) {
      const held: MonitorHeldStatus | null = heldOf(
        stateWith({
          incidents: order.map((status: MonitorStatus): Incident => {
            return incidentWith(status);
          }),
        }),
        [olderAtFour, newerAtFour],
      );

      expect(held?.monitorStatusId.toString()).toBe(newerAtFour.id!.toString());
      expect(held?.isMostSevereOfSeveral).toBe(true);
    }
  });

  test("a status with no Order sits at the bottom of the list, as the list puts it", () => {
    const unnumbered: MonitorStatus = statusWith({
      id: "11432000-0000-4000-8000-0000000000c6",
      priority: null,
    });

    const held: MonitorHeldStatus | null = heldOf(
      stateWith({
        incidents: [incidentWith(MAJOR_OUTAGE), incidentWith(unnumbered)],
      }),
      [...LIST, unnumbered],
    );

    expect(held?.monitorStatusId.toString()).toBe(unnumbered.id!.toString());
  });

  test("ids are compared as text, whatever their case", () => {
    const incident: Incident = incidentWith();
    incident.changeMonitorStatusToId = new ObjectID(
      MAJOR_OUTAGE.id!.toString().toUpperCase(),
    );

    expect(
      heldStatusName(
        heldOf(stateWith({ incidents: [incident, incidentWith(DEGRADED)] })),
      ),
    ).toBe("Major Outage");
  });
});

describe("getMostSevereStatus and getStatusIdsSet", () => {
  test("the most severe of a list is its last as the project's list orders it, wherever it is given", () => {
    const random: SeededRandom = seededRandom(1143201);

    for (let draw: number = 0; draw < 50; draw++) {
      expect(
        MonitorIncidentPause.getMostSevereStatus(shuffled(LIST, random)),
      ).toBe(MAJOR_OUTAGE);
    }

    expect(MonitorIncidentPause.getMostSevereStatus([DEGRADED])).toBe(DEGRADED);
  });

  test("each status set is listed once, the incidents' first, in the order they hold the monitor", () => {
    const ids: Array<string> = MonitorIncidentPause.getStatusIdsSet(
      stateWith({
        incidents: [
          incidentWith(MAJOR_OUTAGE),
          incidentWith(),
          incidentWith(DEGRADED),
          incidentWith(MAJOR_OUTAGE),
        ],
        events: [eventWith(UNDER_MAINTENANCE), eventWith(DEGRADED)],
      }),
    ).map((id: ObjectID): string => {
      return id.toString();
    });

    expect(ids).toEqual([
      MAJOR_OUTAGE.id!.toString(),
      DEGRADED.id!.toString(),
      UNDER_MAINTENANCE.id!.toString(),
    ]);
  });
});

/*
 * A property of the rule over drawn monitors: whatever pauses hold a
 * monitor, in whatever order they came, its status is the same, it is one
 * of theirs, and none of theirs is more severe.
 */
describe("the rule over drawn monitors", () => {
  const POOL: Array<MonitorStatus> = [
    ...LIST,
    // Two more at an Order already taken, made later: ties the list breaks.
    statusWith({
      id: "11432000-0000-4000-8000-0000000000d1",
      priority: 3,
      createdDay: 5,
    }),
    statusWith({
      id: "11432000-0000-4000-8000-0000000000d2",
      priority: 5,
      createdDay: 7,
    }),
  ];

  test("the held status depends only on what holds the monitor, never on the order it came in", () => {
    const random: SeededRandom = seededRandom(11432);

    for (let draw: number = 0; draw < 400; draw++) {
      const statusOrNone: () => MonitorStatus | undefined = ():
        | MonitorStatus
        | undefined => {
        return random(4) === 0 ? undefined : POOL[random(POOL.length)];
      };

      const incidents: Array<Incident> = [];
      const events: Array<ScheduledMaintenance> = [];

      for (let index: number = random(4); index > 0; index--) {
        incidents.push(incidentWith(statusOrNone()));
      }

      for (let index: number = random(4); index > 0; index--) {
        events.push(eventWith(statusOrNone()));
      }

      const held: MonitorHeldStatus | null = heldOf(
        stateWith({ incidents: incidents, events: events }),
        POOL,
      );

      const setStatuses: Array<MonitorStatus> = POOL.filter(
        (status: MonitorStatus): boolean => {
          return [...incidents, ...events].some(
            (holder: Incident | ScheduledMaintenance): boolean => {
              return (
                holder.changeMonitorStatusToId?.toString() ===
                status.id!.toString()
              );
            },
          );
        },
      );

      if (setStatuses.length === 0) {
        expect(held).toBeNull();
        continue;
      }

      // One of theirs, and none of theirs further down the list.
      const heldStatus: MonitorStatus = POOL.find(
        (status: MonitorStatus): boolean => {
          return status.id!.toString() === held!.monitorStatusId.toString();
        },
      )!;
      expect(setStatuses).toContain(heldStatus);

      for (const status of setStatuses) {
        expect(
          compareListOrderItems(
            {
              id: status.id!.toString(),
              value: status.priority,
              createdAt: status.createdAt,
            },
            {
              id: heldStatus.id!.toString(),
              value: heldStatus.priority,
              createdAt: heldStatus.createdAt,
            },
            SortOrder.Ascending,
          ),
        ).toBeLessThanOrEqual(0);
      }

      expect(held!.isMostSevereOfSeveral).toBe(setStatuses.length > 1);

      // What it names sets it.
      const named: Incident | ScheduledMaintenance | undefined =
        held!.incident || held!.scheduledMaintenance;
      expect(named?.changeMonitorStatusToId?.toString()).toBe(
        heldStatus.id!.toString(),
      );

      // The same, in any order they came: the order holds nothing.
      for (let reorder: number = 0; reorder < 3; reorder++) {
        expect(
          heldOf(
            stateWith({
              incidents: shuffled(incidents, random),
              events: shuffled(events, random),
            }),
            shuffled(POOL, random),
          )?.monitorStatusId.toString(),
        ).toBe(held!.monitorStatusId.toString());
      }
    }
  });
});

/*
 * The reads around the rule, as the services give them: the monitor, the
 * open incidents declared by hand on it, the events holding it, and the
 * project's statuses.
 */
describe("the reads and the write around the rule", () => {
  let monitorsById: Map<string, MonitorIncidentPauseState>;
  let statusReads: ReturnType<typeof getJestSpyOn>;
  let flagWrites: ReturnType<typeof getJestSpyOn>;
  let statusChanges: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    monitorsById = new Map<string, MonitorIncidentPauseState>();

    getJestSpyOn(MonitorService, "findOneById").mockImplementation(
      (async (findOneById: { id: ObjectID }): Promise<Monitor | null> => {
        return monitorsById.get(findOneById.id.toString())?.monitor || null;
      }) as never,
    );
    getJestSpyOn(
      IncidentStateService,
      "getUnresolvedIncidentStateIds",
    ).mockResolvedValue([OPEN_STATE_ID] as never);
    getJestSpyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
      query: { monitors: unknown };
    }): Promise<Array<Incident>> => {
      for (const state of monitorsById.values()) {
        if (
          JSON.stringify(findBy.query.monitors).includes(
            state.monitor.id!.toString(),
          )
        ) {
          return state.pausingIncidents;
        }
      }

      return [];
    }) as never);
    getJestSpyOn(
      ScheduledMaintenanceStateTimelineService,
      "findEventsHoldingMonitor",
    ).mockImplementation((async (
      monitorId: ObjectID,
    ): Promise<Array<ScheduledMaintenance>> => {
      return (
        monitorsById.get(monitorId.toString())?.holdingMaintenanceEvents || []
      );
    }) as never);
    statusReads = getJestSpyOn(
      MonitorStatusService,
      "findBy",
    ).mockResolvedValue(LIST as never);
    flagWrites = getJestSpyOn(
      MonitorService,
      "updateOneById",
    ).mockResolvedValue(undefined as never);
    statusChanges = getJestSpyOn(
      MonitorService,
      "changeMonitorStatus",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      IncidentService,
      "getIncidentLinkInDashboard",
    ).mockImplementation((async (
      _projectId: ObjectID,
      incidentId: ObjectID,
    ): Promise<URL> => {
      return URL.fromString(
        `https://oneuptime.example/incidents/${incidentId.toString()}`,
      );
    }) as never);
    getJestSpyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceLinkInDashboard",
    ).mockImplementation((async (
      _projectId: ObjectID,
      scheduledMaintenanceId: ObjectID,
    ): Promise<URL> => {
      return URL.fromString(
        `https://oneuptime.example/scheduled-maintenance/${scheduledMaintenanceId.toString()}`,
      );
    }) as never);
  });

  function hold(state: MonitorIncidentPauseState): void {
    monitorsById.set(state.monitor.id!.toString(), state);
  }

  async function taking(monitorStatus: MonitorStatus): Promise<Array<string>> {
    return (
      await MonitorIncidentPause.getMonitorsTakingStatus({
        projectId: PROJECT_ID,
        monitorIds: [MONITOR_ID, OTHER_MONITOR_ID],
        monitorStatusId: new ObjectID(monitorStatus.id!.toString()),
      })
    ).map((id: ObjectID): string => {
      return id.toString();
    });
  }

  test("a status is put on a monitor nothing holds in a more severe one, and on no other", async () => {
    // Held in Major Outage by an incident; the other monitor by nothing.
    hold(stateWith({ incidents: [incidentWith(MAJOR_OUTAGE)] }));
    hold(stateWith({ monitorId: OTHER_MONITOR_ID }));

    expect(await taking(DEGRADED)).toEqual([OTHER_MONITOR_ID.toString()]);
    expect(await taking(MAJOR_OUTAGE)).toEqual([
      MONITOR_ID.toString(),
      OTHER_MONITOR_ID.toString(),
    ]);
  });

  test("a status as severe as the held one, or more, is put on it: a more severe declaration shows at once", async () => {
    hold(stateWith({ events: [eventWith(UNDER_MAINTENANCE)] }));

    expect(await taking(UNDER_MAINTENANCE)).toContain(MONITOR_ID.toString());
    expect(await taking(PARTIAL_OUTAGE)).toContain(MONITOR_ID.toString());
    expect(await taking(DEGRADED)).not.toContain(MONITOR_ID.toString());
  });

  test("the pause that writes is counted among those holding the monitor: its own status, the most severe, is put on it", async () => {
    // An incident just declared in Partial Outage, beside one in Degraded.
    hold(
      stateWith({
        incidents: [incidentWith(DEGRADED), incidentWith(PARTIAL_OUTAGE)],
      }),
    );

    expect(await taking(PARTIAL_OUTAGE)).toContain(MONITOR_ID.toString());
    expect(await taking(DEGRADED)).not.toContain(MONITOR_ID.toString());
  });

  test("a writer that does not hold the monitor puts its status on it only while what holds it sets none", async () => {
    const pausing: Incident = incidentWith(DEGRADED);
    const event: ScheduledMaintenance = eventWith(UNDER_MAINTENANCE);
    hold(stateWith({ incidents: [pausing], events: [event] }));

    const takingFor: (
      writer: {
        incidentId?: ObjectID;
        scheduledMaintenanceId?: ObjectID;
      },
      status: MonitorStatus,
    ) => Promise<boolean> = async (
      writer: { incidentId?: ObjectID; scheduledMaintenanceId?: ObjectID },
      status: MonitorStatus,
    ): Promise<boolean> => {
      return (
        (
          await MonitorIncidentPause.getMonitorsTakingStatus({
            projectId: PROJECT_ID,
            monitorIds: [MONITOR_ID],
            monitorStatusId: new ObjectID(status.id!.toString()),
            writer: writer,
          })
        ).length === 1
      );
    };

    // An incident with Pause Monitoring off is none of what holds it: even a more severe status stays off.
    const notPausing: Incident = incidentWith(MAJOR_OUTAGE);
    expect(await takingFor({ incidentId: notPausing.id! }, MAJOR_OUTAGE)).toBe(
      false,
    );
    // Nor is an event that does not hold it.
    expect(
      await takingFor(
        { scheduledMaintenanceId: eventWith(MAJOR_OUTAGE).id! },
        MAJOR_OUTAGE,
      ),
    ).toBe(false);

    // The pausing incident and the holding event, weighed as any write is.
    expect(await takingFor({ incidentId: pausing.id! }, MAJOR_OUTAGE)).toBe(
      true,
    );
    expect(await takingFor({ incidentId: pausing.id! }, DEGRADED)).toBe(false);
    expect(
      await takingFor({ scheduledMaintenanceId: event.id! }, PARTIAL_OUTAGE),
    ).toBe(true);
    expect(
      await takingFor({ scheduledMaintenanceId: event.id! }, DEGRADED),
    ).toBe(false);

    // What holds it sets no status: any writer's status goes on it.
    hold(stateWith({ incidents: [incidentWith()], events: [eventWith()] }));
    expect(await takingFor({ incidentId: notPausing.id! }, DEGRADED)).toBe(
      true,
    );
  });

  test("what holds the monitor in no status keeps no status off it", async () => {
    hold(stateWith({ incidents: [incidentWith()], events: [eventWith()] }));

    expect(await taking(DEGRADED)).toContain(MONITOR_ID.toString());
    // Nothing to weigh, so no statuses are read.
    expect(statusReads).not.toHaveBeenCalled();
  });

  test("working it out writes nothing: no pause flag, no status", async () => {
    hold(stateWith({ incidents: [incidentWith(MAJOR_OUTAGE)] }));

    await taking(DEGRADED);

    expect(flagWrites).not.toHaveBeenCalled();
    expect(statusChanges).not.toHaveBeenCalled();
  });

  test("a monitor that cannot be read, a status that cannot be weighed, or a read that fails: the status is put on it, as before", async () => {
    // Not found.
    expect(await taking(DEGRADED)).toEqual([
      MONITOR_ID.toString(),
      OTHER_MONITOR_ID.toString(),
    ]);

    // Held in a status, but the status written is not among those read.
    hold(stateWith({ incidents: [incidentWith(MAJOR_OUTAGE)] }));
    statusReads.mockResolvedValue([MAJOR_OUTAGE] as never);
    expect(await taking(DEGRADED)).toContain(MONITOR_ID.toString());

    // The read fails: logged, and the write goes on.
    statusReads.mockRejectedValue(new Error("connection reset") as never);
    expect(await taking(DEGRADED)).toContain(MONITOR_ID.toString());
    expect(logger.error).toHaveBeenCalled();
  });

  test("the statuses are read as root, the project's only", async () => {
    hold(stateWith({ incidents: [incidentWith(MAJOR_OUTAGE)] }));

    await MonitorIncidentPause.findHeldStatus(
      monitorsById.get(MONITOR_ID.toString())!,
    );

    const findBy: {
      query: { projectId: ObjectID };
      props: { isRoot: boolean };
    } = statusReads.mock.calls[0]![0] as never;
    expect(findBy.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(findBy.props.isRoot).toBe(true);
  });

  test("putInHeldStatus moves the monitor to the most severe status of what holds it, as root, owners told, with the note", async () => {
    const event: ScheduledMaintenance = eventWith(UNDER_MAINTENANCE);
    const state: MonitorIncidentPauseState = stateWith({
      incidents: [incidentWith()],
      events: [event],
      currentStatus: MAJOR_OUTAGE,
    });
    const startsAt: Date = new Date(FIRST_DAY + 3 * DAY_MS);

    const held: MonitorHeldStatus | null =
      await MonitorIncidentPause.putInHeldStatus({
        state: state,
        startsAt: startsAt,
      });

    expect(heldStatusName(held)).toBe("Under Maintenance");
    expect(statusChanges).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = statusChanges.mock.calls[0]!;
    expect((call[0] as ObjectID).toString()).toBe(PROJECT_ID.toString());
    expect(
      (call[1] as Array<ObjectID>).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([MONITOR_ID.toString()]);
    expect((call[2] as ObjectID).toString()).toBe(
      UNDER_MAINTENANCE.id!.toString(),
    );
    expect(call[3]).toBe(true);
    expect(call[4]).toBe(
      `Scheduled maintenance ([SM-${event.scheduledMaintenanceNumber}](https://oneuptime.example/scheduled-maintenance/${event.id!.toString()})) is still in progress, so the monitor is in the status it puts it in.`,
    );
    expect(readStatusChangeNote(call[4] as string)?.note.written).toBe(
      IN_STATUS_OF_PAUSING_MAINTENANCE,
    );
    expect(call[6]).toEqual({ isRoot: true });
    expect(call[7]).toBe(startsAt);
    // The state read after it says where the monitor is now.
    expect(state.monitor.currentMonitorStatusId?.toString()).toBe(
      UNDER_MAINTENANCE.id!.toString(),
    );
  });

  test("of several: the note says why this one, the most severe", async () => {
    const severe: Incident = incidentWith(MAJOR_OUTAGE);

    await MonitorIncidentPause.putInHeldStatus({
      state: stateWith({
        incidents: [incidentWith(DEGRADED), severe],
        events: [eventWith(UNDER_MAINTENANCE)],
        currentStatus: DEGRADED,
      }),
    });

    const note: string = statusChanges.mock.calls[0]![4] as string;
    expect(note).toBe(
      `Of what still pauses this monitor, [${severe.incidentNumberWithPrefix}](https://oneuptime.example/incidents/${severe.id!.toString()}) puts it in the most severe status, so the monitor is in that status.`,
    );
    expect(readStatusChangeNote(note)?.note.written).toBe(
      IN_MOST_SEVERE_STATUS_OF_PAUSING_INCIDENT,
    );
  });

  test("a monitor in the held status already, or held in none, is left as it is", async () => {
    expect(
      heldStatusName(
        await MonitorIncidentPause.putInHeldStatus({
          state: stateWith({
            incidents: [incidentWith(MAJOR_OUTAGE)],
            currentStatus: MAJOR_OUTAGE,
          }),
        }),
      ),
    ).toBe("Major Outage");

    expect(
      await MonitorIncidentPause.putInHeldStatus({
        state: stateWith({
          incidents: [incidentWith()],
          currentStatus: MAJOR_OUTAGE,
        }),
      }),
    ).toBeNull();

    expect(statusChanges).not.toHaveBeenCalled();
  });

  test("syncMonitors puts each monitor in its held status, before what its time counts as, only when asked", async () => {
    const order: Array<string> = [];

    hold(
      stateWith({
        incidents: [incidentWith(PARTIAL_OUTAGE)],
        currentStatus: DEGRADED,
      }),
    );
    statusChanges.mockImplementation((async () => {
      order.push("status");
    }) as never);
    getJestSpyOn(MonitorStatusTimelineService, "findOneBy").mockImplementation(
      (async (): Promise<MonitorStatusTimeline> => {
        order.push("uptime");
        const latest: MonitorStatusTimeline = new MonitorStatusTimeline(
          ObjectID.generate(),
        );
        latest.isMonitoringOff = false;
        return latest;
      }) as never,
    );

    // A data migration works the pauses out without changing a status.
    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
    });
    expect(order).toEqual(["uptime"]);

    order.length = 0;

    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
      putInHeldStatus: true,
    });
    expect(order).toEqual(["status", "uptime"]);
  });
});
