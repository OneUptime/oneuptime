import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import MonitorIncidentPause, {
  MonitorIncidentPauseState,
} from "../../../../Server/Utils/Monitor/MonitorIncidentPause";
import URL from "../../../../Types/API/URL";
import MonitorPausedBy from "../../../../Types/Monitor/MonitorPausedBy";
import ObjectID from "../../../../Types/ObjectID";
import {
  BACK_IN_STATUS_OF_INCIDENT,
  BACK_IN_STATUS_OF_MAINTENANCE,
  IN_MOST_SEVERE_STATUS_OF_PAUSING_INCIDENT,
  IN_MOST_SEVERE_STATUS_OF_PAUSING_MAINTENANCE,
  IN_STATUS_OF_PAUSING_INCIDENT,
  IN_STATUS_OF_PAUSING_MAINTENANCE,
  MONITORING_PAUSED_BY_INCIDENTS,
  MONITORING_PAUSED_BY_INCIDENTS_AND_MAINTENANCE,
  MONITORING_PAUSED_FOR_MAINTENANCE,
  MONITORING_RESUMED,
  PAUSING_INCIDENTS_SET_STATUS,
  PAUSING_MAINTENANCE_SETS_STATUS,
  readStatusChangeNote,
} from "../../../../Utils/Monitor/StatusChangeNotes";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
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
 * WHAT A MONITOR'S TIME COUNTS AS WHILE SCHEDULED MAINTENANCE PAUSES IT
 * (OneUptime issue #11301), as MonitorIncidentPause works it out beside the
 * incidents declared by hand (#11141): an event in progress that puts its
 * monitors in a status of its own counts their time as it; one that puts
 * them in none leaves it out of uptime, status pages and SLOs. A monitor
 * paused by incidents and maintenance at once counts its time while any of
 * them puts it in a status. Which events hold a monitor is read against
 * Postgres in MaintenancePausedTimeUptimePostgres; here the reads are given,
 * and what is decided from them is checked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11301000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11301000-0000-4000-8000-0000000000f1",
);
const OPEN_STATE_ID: ObjectID = new ObjectID(
  "11301000-0000-4000-8000-0000000000a1",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "11301000-0000-4000-8000-0000000000b1",
);
const UNDER_MAINTENANCE_STATUS_ID: ObjectID = new ObjectID(
  "11301000-0000-4000-8000-0000000000b2",
);

function incidentWith(data: {
  id: string;
  prefixed?: string | undefined;
  changeMonitorStatusToId?: ObjectID | undefined;
}): Incident {
  const incident: Incident = new Incident(new ObjectID(data.id));
  incident.projectId = PROJECT_ID;
  incident.isCreatedAutomatically = false;
  incident.holdsMonitors = true;
  incident.pauseMonitoring = true;

  if (data.prefixed !== undefined) {
    incident.incidentNumberWithPrefix = data.prefixed;
  }

  if (data.changeMonitorStatusToId !== undefined) {
    incident.changeMonitorStatusToId = data.changeMonitorStatusToId;
  }

  return incident;
}

function eventWith(data: {
  id: string;
  prefixed?: string | undefined;
  number?: number | undefined;
  changeMonitorStatusToId?: ObjectID | undefined;
}): ScheduledMaintenance {
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance(
    new ObjectID(data.id),
  );
  scheduledMaintenance.projectId = PROJECT_ID;

  if (data.prefixed !== undefined) {
    scheduledMaintenance.scheduledMaintenanceNumberWithPrefix = data.prefixed;
  }

  if (data.number !== undefined) {
    scheduledMaintenance.scheduledMaintenanceNumber = data.number;
  }

  if (data.changeMonitorStatusToId !== undefined) {
    scheduledMaintenance.changeMonitorStatusToId = data.changeMonitorStatusToId;
  }

  return scheduledMaintenance;
}

function monitorWith(data: {
  isPausedByIncident?: boolean | undefined;
  isPausedForMaintenance?: boolean | undefined;
  isTurnedOff?: boolean | undefined;
  isArchived?: boolean | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.keepMonitoringDuringIncidents = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident =
    data.isPausedByIncident ?? false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent =
    data.isPausedForMaintenance ?? false;
  monitor.disableActiveMonitoring = data.isTurnedOff ?? false;
  monitor.isArchived = data.isArchived ?? false;
  return monitor;
}

function stateWith(data: {
  incidents?: Array<Incident> | undefined;
  events?: Array<ScheduledMaintenance> | undefined;
  isPausedForMaintenance?: boolean | undefined;
  isTurnedOff?: boolean | undefined;
}): MonitorIncidentPauseState {
  const incidents: Array<Incident> = data.incidents || [];

  return {
    monitor: monitorWith({
      isPausedByIncident: incidents.length > 0,
      isPausedForMaintenance:
        data.isPausedForMaintenance ?? (data.events || []).length > 0,
      isTurnedOff: data.isTurnedOff,
    }),
    pausingIncidents: incidents,
    isPaused: incidents.length > 0,
    holdingMaintenanceEvents: data.events || [],
  };
}

const EVENT_ONE: string = "11301000-0000-4000-8000-0000000000e1";
const EVENT_TWO: string = "11301000-0000-4000-8000-0000000000e2";
const INCIDENT_ONE: string = "11301000-0000-4000-8000-0000000000c1";
const INCIDENT_TWO: string = "11301000-0000-4000-8000-0000000000c2";

function eventLink(id: string, name: string): string {
  return `[${name}](https://oneuptime.example/scheduled-maintenance/${id})`;
}

function incidentLink(id: string, name: string): string {
  return `[${name}](https://oneuptime.example/incidents/${id})`;
}

let monitorRead: Monitor | null;
let incidentsFound: Array<Incident>;
let eventsHolding: Array<ScheduledMaintenance>;
let eventsRead: ReturnType<typeof getJestSpyOn>;
let latest: MonitorStatusTimeline | null;
let switches: ReturnType<typeof getJestSpyOn>;
let monitorReads: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  monitorRead = monitorWith({});
  incidentsFound = [];
  eventsHolding = [];

  latest = new MonitorStatusTimeline(ObjectID.generate());
  latest.isMonitoringOff = false;

  getJestSpyOn(
    IncidentStateService,
    "getUnresolvedIncidentStateIds",
  ).mockResolvedValue([OPEN_STATE_ID] as never);
  getJestSpyOn(IncidentService, "findBy").mockImplementation((async () => {
    return incidentsFound;
  }) as never);
  monitorReads = getJestSpyOn(MonitorService, "findOneById").mockImplementation(
    (async () => {
      return monitorRead;
    }) as never,
  );
  getJestSpyOn(MonitorService, "updateOneById").mockResolvedValue(
    undefined as never,
  );
  eventsRead = getJestSpyOn(
    ScheduledMaintenanceStateTimelineService,
    "findEventsHoldingMonitor",
  ).mockImplementation((async () => {
    return eventsHolding;
  }) as never);
  getJestSpyOn(MonitorStatusTimelineService, "findOneBy").mockImplementation(
    (async (): Promise<MonitorStatusTimeline | null> => {
      return latest;
    }) as never,
  );
  switches = getJestSpyOn(
    MonitorStatusTimelineService,
    "recordMonitoringSwitch",
  ).mockResolvedValue(null as never);
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isLeftOutOfUptime with scheduled maintenance (#11301)", () => {
  test("maintenance that sets no status: left out", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({ events: [eventWith({ id: EVENT_ONE })] }),
      ),
    ).toBe(true);
  });

  test("maintenance that sets a status: counted, as that status", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({
          events: [
            eventWith({
              id: EVENT_ONE,
              changeMonitorStatusToId: UNDER_MAINTENANCE_STATUS_ID,
            }),
          ],
        }),
      ),
    ).toBe(false);
  });

  test("paused for maintenance with no event found to say what it sets: nothing checks it and nothing set a status, so left out", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({ events: [], isPausedForMaintenance: true }),
      ),
    ).toBe(true);
  });

  test("two events, one of which sets a status: counted", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({
          events: [
            eventWith({ id: EVENT_ONE }),
            eventWith({
              id: EVENT_TWO,
              changeMonitorStatusToId: UNDER_MAINTENANCE_STATUS_ID,
            }),
          ],
        }),
      ),
    ).toBe(false);
  });

  test("an incident with no status and maintenance with none: left out", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({
          incidents: [incidentWith({ id: INCIDENT_ONE })],
          events: [eventWith({ id: EVENT_ONE })],
        }),
      ),
    ).toBe(true);
  });

  test("either one setting a status counts the time", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({
          incidents: [
            incidentWith({
              id: INCIDENT_ONE,
              changeMonitorStatusToId: OFFLINE_STATUS_ID,
            }),
          ],
          events: [eventWith({ id: EVENT_ONE })],
        }),
      ),
    ).toBe(false);
    expect(
      MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({
          incidents: [incidentWith({ id: INCIDENT_ONE })],
          events: [
            eventWith({
              id: EVENT_ONE,
              changeMonitorStatusToId: UNDER_MAINTENANCE_STATUS_ID,
            }),
          ],
        }),
      ),
    ).toBe(false);
  });

  test("events read for a monitor maintenance no longer pauses say nothing", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({
          events: [eventWith({ id: EVENT_ONE })],
          isPausedForMaintenance: false,
        }),
      ),
    ).toBe(false);
  });

  test("a state worked out for incidents alone reads as it always did", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime({
        isPaused: true,
        pausingIncidents: [incidentWith({ id: INCIDENT_ONE })],
      }),
    ).toBe(true);
    expect(
      MonitorIncidentPause.isLeftOutOfUptime({
        isPaused: false,
        pausingIncidents: [],
      }),
    ).toBe(false);
  });

  /*
   * The rule over every combination drawn from one seed: left out exactly
   * when something pauses the monitor and nothing that pauses it sets a
   * status.
   */
  test("left out exactly when something pauses it and nothing that does sets a status, over 500 drawn monitors", () => {
    const random: SeededRandom = seededRandom(1130101);
    let leftOut: number = 0;

    for (let index: number = 0; index < 500; index++) {
      const incidents: Array<Incident> = [];
      const events: Array<ScheduledMaintenance> = [];

      for (let count: number = random(3); count > 0; count--) {
        incidents.push(
          incidentWith({
            id: ObjectID.generate().toString(),
            changeMonitorStatusToId:
              random(3) === 0 ? OFFLINE_STATUS_ID : undefined,
          }),
        );
      }

      for (let count: number = random(3); count > 0; count--) {
        events.push(
          eventWith({
            id: ObjectID.generate().toString(),
            changeMonitorStatusToId:
              random(3) === 0 ? UNDER_MAINTENANCE_STATUS_ID : undefined,
          }),
        );
      }

      const isPausedForMaintenance: boolean =
        events.length > 0 || random(4) === 0;

      const isPausedByAnything: boolean =
        incidents.length > 0 || isPausedForMaintenance;
      const isAnyStatusSet: boolean =
        incidents.some((incident: Incident): boolean => {
          return Boolean(incident.changeMonitorStatusToId);
        }) ||
        (isPausedForMaintenance &&
          events.some((event: ScheduledMaintenance): boolean => {
            return Boolean(event.changeMonitorStatusToId);
          }));

      const isLeftOut: boolean = MonitorIncidentPause.isLeftOutOfUptime(
        stateWith({
          incidents: incidents,
          events: events,
          isPausedForMaintenance: isPausedForMaintenance,
        }),
      );

      expect({ index, isLeftOut }).toEqual({
        index,
        isLeftOut: isPausedByAnything && !isAnyStatusSet,
      });

      if (isLeftOut) {
        leftOut++;
      }
    }

    // The draws hold both answers.
    expect(leftOut).toBeGreaterThan(50);
    expect(leftOut).toBeLessThan(450);
  });
});

describe("syncPause reads the maintenance holding the monitor while maintenance pauses it", () => {
  test("not paused for maintenance: no event is read", async () => {
    const state: MonitorIncidentPauseState | null =
      await MonitorIncidentPause.syncPause({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      });

    expect(eventsRead).not.toHaveBeenCalled();
    expect(state?.holdingMaintenanceEvents).toEqual([]);
  });

  test("paused for maintenance: the events holding it, as read", async () => {
    monitorRead = monitorWith({ isPausedForMaintenance: true });
    eventsHolding = [eventWith({ id: EVENT_ONE })];

    const state: MonitorIncidentPauseState | null =
      await MonitorIncidentPause.syncPause({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      });

    expect(eventsRead).toHaveBeenCalledTimes(1);
    expect(String(eventsRead.mock.calls[0]![0])).toBe(MONITOR_ID.toString());
    expect(state?.holdingMaintenanceEvents).toEqual(eventsHolding);
    expect(MonitorIncidentPause.isLeftOutOfUptime(state!)).toBe(true);
  });
});

describe("markUptime for a monitor scheduled maintenance pauses", () => {
  test("an event with no status starts leaving the time out, named in the note", async () => {
    monitorRead = monitorWith({ isPausedForMaintenance: true });
    eventsHolding = [eventWith({ id: EVENT_ONE, prefixed: "SM-3" })];

    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
    });

    expect(switches).toHaveBeenCalledTimes(1);

    const marked: { isMonitoringOff: boolean; rootCause: string } = switches
      .mock.calls[0]![0] as { isMonitoringOff: boolean; rootCause: string };

    expect(marked.isMonitoringOff).toBe(true);
    expect(marked.rootCause).toBe(
      `Monitoring is paused by scheduled maintenance (${eventLink(EVENT_ONE, "SM-3")}), with no status set for this monitor. Nothing checks the monitor until the maintenance ends, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`,
    );
  });

  test("an event with a status, over time left out before: counted again, named in the note", async () => {
    monitorRead = monitorWith({ isPausedForMaintenance: true });
    eventsHolding = [
      eventWith({
        id: EVENT_ONE,
        prefixed: "SM-3",
        changeMonitorStatusToId: UNDER_MAINTENANCE_STATUS_ID,
      }),
    ];
    latest!.isMonitoringOff = true;

    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
    });

    const marked: { isMonitoringOff: boolean; rootCause: string } = switches
      .mock.calls[0]![0] as { isMonitoringOff: boolean; rootCause: string };

    expect(marked.isMonitoringOff).toBe(false);
    expect(marked.rootCause).toBe(
      `Scheduled maintenance (${eventLink(EVENT_ONE, "SM-3")}) puts this monitor in its status, so uptime, status pages and SLOs count the monitor's time again from here.`,
    );
  });

  test("nothing is written when the latest status event says so already", async () => {
    monitorRead = monitorWith({ isPausedForMaintenance: true });
    latest!.isMonitoringOff = true;
    latest!.pausedBy = MonitorPausedBy.ScheduledMaintenance;

    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
    });

    expect(switches).not.toHaveBeenCalled();
  });

  /*
   * What pauses the monitor changed while its time stays left out: marked
   * again, so the day bars say why (#11433) - an incident with no status
   * joins the event, or the event's incident is resolved while it runs.
   */
  test.each([
    [
      "an incident joins the event",
      MonitorPausedBy.ScheduledMaintenance,
      true,
      MonitorPausedBy.IncidentAndScheduledMaintenance,
    ],
    [
      "the incident is resolved while the event runs",
      MonitorPausedBy.IncidentAndScheduledMaintenance,
      false,
      MonitorPausedBy.ScheduledMaintenance,
    ],
  ] as Array<[string, MonitorPausedBy, boolean, MonitorPausedBy]>)(
    "%s: the time left out is marked again with what pauses it now",
    async (
      _label: string,
      marked: MonitorPausedBy,
      isPausedByIncident: boolean,
      expected: MonitorPausedBy,
    ) => {
      monitorRead = monitorWith({
        isPausedForMaintenance: true,
        isPausedByIncident: isPausedByIncident,
      });
      incidentsFound = isPausedByIncident
        ? [incidentWith({ id: INCIDENT_ONE, prefixed: "INC-9" })]
        : [];
      eventsHolding = [eventWith({ id: EVENT_ONE, prefixed: "SM-3" })];
      latest!.isMonitoringOff = true;
      latest!.pausedBy = marked;

      await MonitorIncidentPause.syncMonitors({
        projectId: PROJECT_ID,
        monitorIds: [MONITOR_ID],
      });

      expect(switches).toHaveBeenCalledTimes(1);
      expect(switches.mock.calls[0]![0]).toMatchObject({
        isMonitoringOff: true,
        pausedBy: expected,
      });
    },
  );

  test("an archived monitor is worked out as any other: archiving marks nothing on its timeline", async () => {
    monitorRead = monitorWith({
      isPausedForMaintenance: true,
      isArchived: true,
    });
    eventsHolding = [eventWith({ id: EVENT_ONE, prefixed: "SM-3" })];

    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
    });

    expect(switches).toHaveBeenCalledTimes(1);
    expect(
      (switches.mock.calls[0]![0] as { isMonitoringOff: boolean })
        .isMonitoringOff,
    ).toBe(true);
  });

  test("the monitor is read with every flag that stops it being checked, archiving with them", async () => {
    monitorRead = monitorWith({ isPausedForMaintenance: true });

    await MonitorIncidentPause.syncPause({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
    });

    const read: { select: Record<string, boolean> } = monitorReads.mock
      .calls[0]![0] as { select: Record<string, boolean> };

    expect(read.select).toEqual(
      expect.objectContaining({
        isArchived: true,
        disableActiveMonitoring: true,
        disableActiveMonitoringBecauseOfManualIncident: true,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      }),
    );
  });

  test("nothing is written while monitoring is turned off: the switch speaks for the time", async () => {
    monitorRead = monitorWith({
      isPausedForMaintenance: true,
      isTurnedOff: true,
    });

    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
    });

    expect(switches).not.toHaveBeenCalled();
  });
});

describe("getUptimeRootCause: what pauses the monitor, as links", () => {
  test("two events with no status are listed with and", async () => {
    expect(
      await MonitorIncidentPause.getUptimeRootCause(
        stateWith({
          events: [
            eventWith({ id: EVENT_ONE, prefixed: "SM-3" }),
            eventWith({ id: EVENT_TWO, prefixed: "SM-4" }),
          ],
        }),
      ),
    ).toContain(
      `paused by scheduled maintenance (${eventLink(EVENT_ONE, "SM-3")} and ${eventLink(EVENT_TWO, "SM-4")})`,
    );
  });

  test("an incident and an event, neither with a status, both named", async () => {
    expect(
      await MonitorIncidentPause.getUptimeRootCause(
        stateWith({
          incidents: [incidentWith({ id: INCIDENT_ONE, prefixed: "INC-9" })],
          events: [eventWith({ id: EVENT_ONE, prefixed: "SM-3" })],
        }),
      ),
    ).toBe(
      `Monitoring is paused by ${incidentLink(INCIDENT_ONE, "INC-9")}, declared by hand, and by scheduled maintenance (${eventLink(EVENT_ONE, "SM-3")}), with no status set for this monitor. Nothing checks the monitor until both are over, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`,
    );
  });

  test("an incident that sets a status is the one named, beside maintenance with one or none", async () => {
    for (const eventStatusId of [UNDER_MAINTENANCE_STATUS_ID, undefined]) {
      expect(
        await MonitorIncidentPause.getUptimeRootCause(
          stateWith({
            incidents: [
              incidentWith({
                id: INCIDENT_ONE,
                prefixed: "INC-9",
                changeMonitorStatusToId: OFFLINE_STATUS_ID,
              }),
            ],
            events: [
              eventWith({
                id: EVENT_ONE,
                prefixed: "SM-3",
                changeMonitorStatusToId: eventStatusId,
              }),
            ],
          }),
        ),
      ).toBe(
        `${incidentLink(INCIDENT_ONE, "INC-9")} puts this monitor in its status, so uptime, status pages and SLOs count the monitor's time again from here.`,
      );
    }
  });

  test("only the events that set a status are named for counting it", async () => {
    expect(
      await MonitorIncidentPause.getUptimeRootCause(
        stateWith({
          incidents: [incidentWith({ id: INCIDENT_ONE, prefixed: "INC-9" })],
          events: [
            eventWith({ id: EVENT_ONE, prefixed: "SM-3" }),
            eventWith({
              id: EVENT_TWO,
              prefixed: "SM-4",
              changeMonitorStatusToId: UNDER_MAINTENANCE_STATUS_ID,
            }),
          ],
        }),
      ),
    ).toBe(
      `Scheduled maintenance (${eventLink(EVENT_TWO, "SM-4")}) puts this monitor in its status, so uptime, status pages and SLOs count the monitor's time again from here.`,
    );
  });

  test("an event with no prefix is named by its number, and none found as an event", async () => {
    expect(
      await MonitorIncidentPause.getUptimeRootCause(
        stateWith({ events: [eventWith({ id: EVENT_ONE, number: 7 })] }),
      ),
    ).toContain(`(${eventLink(EVENT_ONE, "#7")})`);
    expect(
      await MonitorIncidentPause.getUptimeRootCause(
        stateWith({ events: [], isPausedForMaintenance: true }),
      ),
    ).toContain("paused by scheduled maintenance (an event), with no status");
  });

  test("a number in Markdown never becomes a link of its own", async () => {
    const rootCause: string = await MonitorIncidentPause.getUptimeRootCause(
      stateWith({
        events: [
          eventWith({
            id: EVENT_ONE,
            prefixed: "SM-[3](https://evil.example)",
          }),
        ],
      }),
    );

    expect(rootCause).not.toContain("](https://evil.example)");
  });

  test("each note is read back by the Dashboard as its own, with the links as its values", async () => {
    const cases: Array<
      [MonitorIncidentPauseState, string, Record<string, string>]
    > = [
      [
        stateWith({
          incidents: [incidentWith({ id: INCIDENT_ONE, prefixed: "INC-9" })],
        }),
        MONITORING_PAUSED_BY_INCIDENTS,
        { incidents: incidentLink(INCIDENT_ONE, "INC-9") },
      ],
      [
        stateWith({ events: [eventWith({ id: EVENT_ONE, prefixed: "SM-3" })] }),
        MONITORING_PAUSED_FOR_MAINTENANCE,
        { events: eventLink(EVENT_ONE, "SM-3") },
      ],
      [
        stateWith({
          incidents: [incidentWith({ id: INCIDENT_ONE, prefixed: "INC-9" })],
          events: [eventWith({ id: EVENT_ONE, prefixed: "SM-3" })],
        }),
        MONITORING_PAUSED_BY_INCIDENTS_AND_MAINTENANCE,
        {
          incidents: incidentLink(INCIDENT_ONE, "INC-9"),
          events: eventLink(EVENT_ONE, "SM-3"),
        },
      ],
      [
        stateWith({
          incidents: [
            incidentWith({
              id: INCIDENT_ONE,
              prefixed: "INC-9",
              changeMonitorStatusToId: OFFLINE_STATUS_ID,
            }),
          ],
        }),
        PAUSING_INCIDENTS_SET_STATUS,
        { incidents: incidentLink(INCIDENT_ONE, "INC-9") },
      ],
      [
        stateWith({
          events: [
            eventWith({
              id: EVENT_ONE,
              prefixed: "SM-3",
              changeMonitorStatusToId: UNDER_MAINTENANCE_STATUS_ID,
            }),
          ],
        }),
        PAUSING_MAINTENANCE_SETS_STATUS,
        { events: eventLink(EVENT_ONE, "SM-3") },
      ],
      [stateWith({}), MONITORING_RESUMED, {}],
    ];

    for (const [state, note, values] of cases) {
      const read: ReturnType<typeof readStatusChangeNote> =
        readStatusChangeNote(
          await MonitorIncidentPause.getUptimeRootCause(state),
        );

      expect({ note: read?.note.written, values: read?.values }).toEqual({
        note: note,
        values: values,
      });
    }
  });
});

/*
 * What still holds the monitor in a status of its own once the rest lets go
 * (#11432): the most severe status of what pauses it (pickHeldStatus, in
 * MonitorHeldStatus.test.ts), and the note that says why on the Status
 * Timeline - the one incident or event that sets it, or, when several set a
 * status, the one whose status is the most severe. The notes the moves back
 * wrote before (#11301) are still read for the rows that hold them.
 */
describe("the note of the status what still holds the monitor puts it in", () => {
  test("an incident still pausing it, alone in setting a status: it is still open", async () => {
    const rootCause: string = await MonitorIncidentPause.getHeldStatusRootCause(
      {
        monitorStatusId: OFFLINE_STATUS_ID,
        incident: incidentWith({
          id: INCIDENT_TWO,
          prefixed: "INC-10",
          changeMonitorStatusToId: OFFLINE_STATUS_ID,
        }),
        isMostSevereOfSeveral: false,
      },
    );

    expect(rootCause).toBe(
      `${incidentLink(INCIDENT_TWO, "INC-10")} is still open, so the monitor is in the status it puts it in.`,
    );
    expect(readStatusChangeNote(rootCause)?.note.written).toBe(
      IN_STATUS_OF_PAUSING_INCIDENT,
    );
    expect(readStatusChangeNote(rootCause)?.values).toEqual({
      incident: incidentLink(INCIDENT_TWO, "INC-10"),
    });
  });

  test("an incident whose status is the most severe of several: says so", async () => {
    const rootCause: string = await MonitorIncidentPause.getHeldStatusRootCause(
      {
        monitorStatusId: OFFLINE_STATUS_ID,
        incident: incidentWith({
          id: INCIDENT_ONE,
          prefixed: "INC-9",
          changeMonitorStatusToId: OFFLINE_STATUS_ID,
        }),
        isMostSevereOfSeveral: true,
      },
    );

    expect(rootCause).toBe(
      `Of what still pauses this monitor, ${incidentLink(INCIDENT_ONE, "INC-9")} puts it in the most severe status, so the monitor is in that status.`,
    );
    expect(readStatusChangeNote(rootCause)?.note.written).toBe(
      IN_MOST_SEVERE_STATUS_OF_PAUSING_INCIDENT,
    );
  });

  test("maintenance still holding it, alone in setting a status: still in progress", async () => {
    const rootCause: string = await MonitorIncidentPause.getHeldStatusRootCause(
      {
        monitorStatusId: UNDER_MAINTENANCE_STATUS_ID,
        scheduledMaintenance: eventWith({
          id: EVENT_TWO,
          prefixed: "SM-4",
          changeMonitorStatusToId: UNDER_MAINTENANCE_STATUS_ID,
        }),
        isMostSevereOfSeveral: false,
      },
    );

    expect(rootCause).toBe(
      `Scheduled maintenance (${eventLink(EVENT_TWO, "SM-4")}) is still in progress, so the monitor is in the status it puts it in.`,
    );
    expect(readStatusChangeNote(rootCause)?.note.written).toBe(
      IN_STATUS_OF_PAUSING_MAINTENANCE,
    );
    expect(readStatusChangeNote(rootCause)?.values).toEqual({
      event: eventLink(EVENT_TWO, "SM-4"),
    });
  });

  test("maintenance whose status is the most severe of several: read as the maintenance one, never as an incident's", async () => {
    const rootCause: string = await MonitorIncidentPause.getHeldStatusRootCause(
      {
        monitorStatusId: UNDER_MAINTENANCE_STATUS_ID,
        scheduledMaintenance: eventWith({
          id: EVENT_ONE,
          number: 3,
          changeMonitorStatusToId: UNDER_MAINTENANCE_STATUS_ID,
        }),
        isMostSevereOfSeveral: true,
      },
    );

    expect(rootCause).toBe(
      `Of what still pauses this monitor, scheduled maintenance (${eventLink(EVENT_ONE, "#3")}) puts it in the most severe status, so the monitor is in that status.`,
    );
    expect(readStatusChangeNote(rootCause)?.note.written).toBe(
      IN_MOST_SEVERE_STATUS_OF_PAUSING_MAINTENANCE,
    );
    expect(readStatusChangeNote(rootCause)?.values).toEqual({
      event: eventLink(EVENT_ONE, "#3"),
    });
  });

  test("the notes the moves back wrote before #11432 still read, for the rows that hold them", () => {
    const incident: string = incidentLink(INCIDENT_TWO, "INC-10");
    const event: string = eventLink(EVENT_TWO, "SM-4");

    expect(
      readStatusChangeNote(
        `Scheduled maintenance is over, and ${incident} is still open, so the monitor is back in the status the incident puts it in.`,
      )?.note.written,
    ).toBe(BACK_IN_STATUS_OF_INCIDENT);
    expect(
      readStatusChangeNote(
        `Scheduled maintenance (${event}) is still in progress, so the monitor is back in the status it puts it in.`,
      )?.note.written,
    ).toBe(BACK_IN_STATUS_OF_MAINTENANCE);
  });
});
