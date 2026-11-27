import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import MonitorIncidentPause, {
  MonitorIncidentPauseState,
} from "../../../../Server/Utils/Monitor/MonitorIncidentPause";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
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
 * WHEN AN INCIDENT DECLARED BY HAND PAUSES A MONITOR (issue #11141), as
 * MonitorIncidentPause works it out: which incidents pause a monitor, the
 * flag it writes, and what it marks of the monitor's time on its status
 * timeline. Which incidents a query finds is read against Postgres in
 * MonitorIncidentPausePostgres; here the reads are given, and what is
 * decided from them is checked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11141000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11141000-0000-4000-8000-0000000000f1",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "11141000-0000-4000-8000-0000000000f2",
);
const OPEN_STATE_ID: ObjectID = new ObjectID(
  "11141000-0000-4000-8000-0000000000a1",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "11141000-0000-4000-8000-0000000000b1",
);

function incidentWith(data: {
  id: string;
  number?: number | undefined;
  prefixed?: string | undefined;
  changeMonitorStatusToId?: ObjectID | undefined;
  isCreatedAutomatically?: boolean | undefined;
  holdsMonitors?: boolean | null | undefined;
  pauseMonitoring?: boolean | undefined;
}): Incident {
  const incident: Incident = new Incident(new ObjectID(data.id));
  incident.projectId = PROJECT_ID;

  // Left unset when not given, as a read that does not find them leaves them.
  if (data.number !== undefined) {
    incident.incidentNumber = data.number;
  }

  if (data.prefixed !== undefined) {
    incident.incidentNumberWithPrefix = data.prefixed;
  }

  if (data.changeMonitorStatusToId !== undefined) {
    incident.changeMonitorStatusToId = data.changeMonitorStatusToId;
  }

  incident.isCreatedAutomatically = data.isCreatedAutomatically ?? false;
  incident.holdsMonitors =
    data.holdsMonitors === undefined ? true : (data.holdsMonitors as boolean);
  incident.pauseMonitoring = data.pauseMonitoring ?? true;
  return incident;
}

function monitorWith(data: {
  id?: ObjectID | undefined;
  keepMonitoringDuringIncidents?: boolean | undefined;
  isPaused?: boolean | undefined;
  isTurnedOff?: boolean | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor(data.id || MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.keepMonitoringDuringIncidents =
    data.keepMonitoringDuringIncidents ?? false;
  monitor.disableActiveMonitoringBecauseOfManualIncident =
    data.isPaused ?? false;
  monitor.disableActiveMonitoring = data.isTurnedOff ?? false;
  return monitor;
}

function latestRow(isMonitoringOff: boolean): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline(
    ObjectID.generate(),
  );
  row.isMonitoringOff = isMonitoringOff;
  return row;
}

let incidentsFound: Array<Incident>;
let monitorsById: Map<string, Monitor | null>;
let findBy: ReturnType<typeof getJestSpyOn>;
let monitorUpdates: ReturnType<typeof getJestSpyOn>;
let latest: MonitorStatusTimeline | null;
let switches: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  incidentsFound = [];
  monitorsById = new Map<string, Monitor | null>([
    [MONITOR_ID.toString(), monitorWith({})],
  ]);
  latest = latestRow(false);

  getJestSpyOn(
    IncidentStateService,
    "getUnresolvedIncidentStateIds",
  ).mockResolvedValue([OPEN_STATE_ID] as never);

  findBy = getJestSpyOn(IncidentService, "findBy").mockImplementation(
    (async (): Promise<Array<Incident>> => {
      return incidentsFound;
    }) as never,
  );

  getJestSpyOn(MonitorService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Monitor | null> => {
    return monitorsById.get(data.id.toString()) ?? null;
  }) as never);

  monitorUpdates = getJestSpyOn(
    MonitorService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The flag each write set, in order.
function flagsWritten(): Array<boolean> {
  return monitorUpdates.mock.calls.map((call: Array<unknown>): boolean => {
    return (
      call[0] as {
        data: { disableActiveMonitoringBecauseOfManualIncident: boolean };
      }
    ).data.disableActiveMonitoringBecauseOfManualIncident;
  });
}

async function syncState(): Promise<MonitorIncidentPauseState> {
  const state: MonitorIncidentPauseState | null =
    await MonitorIncidentPause.syncPause({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
    });

  expect(state).not.toBeNull();
  return state!;
}

describe("pausesItsMonitors: an incident pauses its monitors by what it is", () => {
  test.each([
    ["declared by hand, holding its monitors, pausing monitoring", {}, true],
    ["from before Holds Monitors was recorded", { holdsMonitors: null }, true],
    ["declared by OneUptime", { isCreatedAutomatically: true }, false],
    [
      "holding nothing: declared resolved, or resolved and reopened",
      { holdsMonitors: false },
      false,
    ],
    ["declared with Pause Monitoring off", { pauseMonitoring: false }, false],
  ] as Array<[string, Partial<Parameters<typeof incidentWith>[0]>, boolean]>)(
    "%s",
    (
      _label: string,
      overrides: Partial<Parameters<typeof incidentWith>[0]>,
      expected: boolean,
    ) => {
      expect(
        MonitorIncidentPause.pausesItsMonitors(
          incidentWith({ id: ObjectID.generate().toString(), ...overrides }),
        ),
      ).toBe(expected);
    },
  );

  test("a column read as undefined counts as its default", () => {
    expect(MonitorIncidentPause.pausesItsMonitors({})).toBe(true);
  });
});

describe("isLeftOutOfUptime: paused time with no status of its own", () => {
  test("left out while every pausing incident puts the monitor in no status", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime({
        isPaused: true,
        pausingIncidents: [
          incidentWith({ id: ObjectID.generate().toString() }),
          incidentWith({ id: ObjectID.generate().toString() }),
        ],
      }),
    ).toBe(true);
  });

  test("counted once one of them puts it in a status", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime({
        isPaused: true,
        pausingIncidents: [
          incidentWith({ id: ObjectID.generate().toString() }),
          incidentWith({
            id: ObjectID.generate().toString(),
            changeMonitorStatusToId: OFFLINE_STATUS_ID,
          }),
        ],
      }),
    ).toBe(false);
  });

  test("a monitor that is not paused is counted", () => {
    expect(
      MonitorIncidentPause.isLeftOutOfUptime({
        isPaused: false,
        pausingIncidents: [],
      }),
    ).toBe(false);
  });
});

describe("findIncidentsPausing", () => {
  test("asks for the project's open incidents declared by hand that list the monitor and pause monitoring", async () => {
    await MonitorIncidentPause.findIncidentsPausing({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
    });

    expect(findBy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["isCreatedAutomatically"]).toBe(false);
    expect(query["pauseMonitoring"]).toBe(true);
    expect(query["monitors"]).toEqual([MONITOR_ID]);
    expect(query["currentIncidentStateId"]).toBeDefined();
    // Not filtered by Holds Monitors in the query: NULL must stay in.
    expect(query["holdsMonitors"]).toBeUndefined();
  });

  test("keeps the ones from before Holds Monitors was recorded, and drops the ones that hold nothing", async () => {
    incidentsFound = [
      incidentWith({ id: "11141000-0000-4000-8000-0000000000c1" }),
      incidentWith({
        id: "11141000-0000-4000-8000-0000000000c2",
        holdsMonitors: null,
      }),
      incidentWith({
        id: "11141000-0000-4000-8000-0000000000c3",
        holdsMonitors: false,
      }),
    ];

    const found: Array<Incident> =
      await MonitorIncidentPause.findIncidentsPausing({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      });

    expect(
      found.map((incident: Incident): string => {
        return incident.id!.toString();
      }),
    ).toEqual([
      "11141000-0000-4000-8000-0000000000c1",
      "11141000-0000-4000-8000-0000000000c2",
    ]);
  });

  test("a project with no open state has no open incident to read", async () => {
    getJestSpyOn(
      IncidentStateService,
      "getUnresolvedIncidentStateIds",
    ).mockResolvedValue([] as never);

    expect(
      await MonitorIncidentPause.findIncidentsPausing({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("syncPause: the flag is what the incidents say", () => {
  test("pauses a monitor an open incident declared by hand pauses", async () => {
    incidentsFound = [incidentWith({ id: ObjectID.generate().toString() })];

    const state: MonitorIncidentPauseState = await syncState();

    expect(state.isPaused).toBe(true);
    expect(state.pausingIncidents).toHaveLength(1);
    expect(flagsWritten()).toEqual([true]);
    expect(
      (monitorUpdates.mock.calls[0]![0] as { props: { isRoot: boolean } }).props
        .isRoot,
    ).toBe(true);
  });

  test("resumes a paused monitor no incident pauses any more", async () => {
    monitorsById.set(MONITOR_ID.toString(), monitorWith({ isPaused: true }));

    const state: MonitorIncidentPauseState = await syncState();

    expect(state.isPaused).toBe(false);
    expect(flagsWritten()).toEqual([false]);
  });

  test("writes nothing when the flag already says it", async () => {
    incidentsFound = [incidentWith({ id: ObjectID.generate().toString() })];
    monitorsById.set(MONITOR_ID.toString(), monitorWith({ isPaused: true }));

    await syncState();

    expect(monitorUpdates).not.toHaveBeenCalled();
  });

  test("a monitor set to keep monitoring during incidents is never paused, and its incidents are not read", async () => {
    monitorsById.set(
      MONITOR_ID.toString(),
      monitorWith({ keepMonitoringDuringIncidents: true, isPaused: true }),
    );
    incidentsFound = [incidentWith({ id: ObjectID.generate().toString() })];

    const state: MonitorIncidentPauseState = await syncState();

    expect(state.isPaused).toBe(false);
    expect(state.pausingIncidents).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
    expect(flagsWritten()).toEqual([false]);
  });

  test("a monitor that is gone is nothing to work out", async () => {
    monitorsById.set(MONITOR_ID.toString(), null);

    expect(
      await MonitorIncidentPause.syncPause({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      }),
    ).toBeNull();
    expect(monitorUpdates).not.toHaveBeenCalled();
  });
});

describe("markUptime: what the monitor's time counts as from here", () => {
  test("paused by incidents that set no status, and counted until now: marked left out, naming them", async () => {
    incidentsFound = [
      incidentWith({
        id: "11141000-0000-4000-8000-0000000000d1",
        number: 12,
        prefixed: "INC-12",
      }),
    ];

    await MonitorIncidentPause.markUptime(await syncState());

    expect(switches).toHaveBeenCalledTimes(1);

    const call: {
      monitorId: ObjectID;
      isMonitoringOff: boolean;
      rootCause: string;
    } = switches.mock.calls[0]![0] as never;

    expect(call.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(call.isMonitoringOff).toBe(true);
    expect(call.rootCause).toBe(
      "Monitoring is paused by [INC-12](https://oneuptime.example/incidents/11141000-0000-4000-8000-0000000000d1), declared by hand without a status for this monitor. Nothing checks the monitor until the incident is resolved, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
    );
  });

  test("already marked left out: nothing written again", async () => {
    incidentsFound = [incidentWith({ id: ObjectID.generate().toString() })];
    latest = latestRow(true);

    await MonitorIncidentPause.markUptime(await syncState());

    expect(switches).not.toHaveBeenCalled();
  });

  test("paused by an incident that puts it in a status: counted, nothing to mark", async () => {
    incidentsFound = [
      incidentWith({
        id: ObjectID.generate().toString(),
        changeMonitorStatusToId: OFFLINE_STATUS_ID,
      }),
    ];

    await MonitorIncidentPause.markUptime(await syncState());

    expect(switches).not.toHaveBeenCalled();
  });

  test("left out until a pausing incident puts it in a status: counted again from there, naming that incident", async () => {
    incidentsFound = [
      incidentWith({ id: ObjectID.generate().toString(), number: 12 }),
      incidentWith({
        id: "11141000-0000-4000-8000-0000000000d2",
        number: 13,
        changeMonitorStatusToId: OFFLINE_STATUS_ID,
      }),
    ];
    latest = latestRow(true);

    await MonitorIncidentPause.markUptime(await syncState());

    const call: { isMonitoringOff: boolean; rootCause: string } = switches.mock
      .calls[0]![0] as never;

    expect(call.isMonitoringOff).toBe(false);
    expect(call.rootCause).toBe(
      "[#13](https://oneuptime.example/incidents/11141000-0000-4000-8000-0000000000d2) puts this monitor in its status, so uptime, status pages and SLOs count the monitor's time again from here.",
    );
  });

  test("resumed after time left out: counted again from here", async () => {
    monitorsById.set(MONITOR_ID.toString(), monitorWith({ isPaused: true }));
    latest = latestRow(true);

    await MonitorIncidentPause.markUptime(await syncState());

    const call: { isMonitoringOff: boolean; rootCause: string } = switches.mock
      .calls[0]![0] as never;

    expect(call.isMonitoringOff).toBe(false);
    expect(call.rootCause).toBe(
      "Monitoring resumed. Uptime, status pages and SLOs count the monitor's time again from here.",
    );
  });

  test("never while monitoring is turned off: the monitor's own switch speaks for that time", async () => {
    monitorsById.set(MONITOR_ID.toString(), monitorWith({ isTurnedOff: true }));
    incidentsFound = [incidentWith({ id: ObjectID.generate().toString() })];

    await MonitorIncidentPause.markUptime(await syncState());

    expect(switches).not.toHaveBeenCalled();
  });

  test("a monitor with no status yet has nothing to mark", async () => {
    incidentsFound = [incidentWith({ id: ObjectID.generate().toString() })];
    latest = null;

    await MonitorIncidentPause.markUptime(await syncState());

    expect(switches).not.toHaveBeenCalled();
  });
});

describe("getUptimeRootCause: the incidents named as links", () => {
  test("two incidents are joined with and", async () => {
    const rootCause: string = await MonitorIncidentPause.getUptimeRootCause({
      monitor: monitorWith({}),
      isPaused: true,
      pausingIncidents: [
        incidentWith({
          id: "11141000-0000-4000-8000-0000000000e1",
          prefixed: "INC-1",
        }),
        incidentWith({
          id: "11141000-0000-4000-8000-0000000000e2",
          prefixed: "INC-2",
        }),
      ],
    });

    expect(rootCause).toContain(
      "Monitoring is paused by [INC-1](https://oneuptime.example/incidents/11141000-0000-4000-8000-0000000000e1) and [INC-2](https://oneuptime.example/incidents/11141000-0000-4000-8000-0000000000e2), declared by hand",
    );
  });

  test("three are listed with commas, the last after and", async () => {
    const rootCause: string = await MonitorIncidentPause.getUptimeRootCause({
      monitor: monitorWith({}),
      isPaused: true,
      pausingIncidents: ["e3", "e4", "e5"].map((suffix: string): Incident => {
        return incidentWith({
          id: `11141000-0000-4000-8000-0000000000${suffix}`,
          prefixed: `INC-${suffix}`,
        });
      }),
    });

    expect(rootCause).toContain(
      "[INC-e3](https://oneuptime.example/incidents/11141000-0000-4000-8000-0000000000e3), [INC-e4](https://oneuptime.example/incidents/11141000-0000-4000-8000-0000000000e4) and [INC-e5](",
    );
  });

  test("an incident with no number is named as one", async () => {
    const rootCause: string = await MonitorIncidentPause.getUptimeRootCause({
      monitor: monitorWith({}),
      isPaused: true,
      pausingIncidents: [
        incidentWith({ id: "11141000-0000-4000-8000-0000000000e6" }),
      ],
    });

    expect(rootCause).toContain(
      "Monitoring is paused by [an incident](https://oneuptime.example/incidents/11141000-0000-4000-8000-0000000000e6)",
    );
  });

  test("a title in Markdown never becomes a link of its own: the number is the incident's text", async () => {
    const rootCause: string = await MonitorIncidentPause.getUptimeRootCause({
      monitor: monitorWith({}),
      isPaused: true,
      pausingIncidents: [
        incidentWith({
          id: "11141000-0000-4000-8000-0000000000e7",
          prefixed: "INC-[7](https://evil.example)",
        }),
      ],
    });

    expect(rootCause).not.toContain("](https://evil.example)");
  });
});

describe("syncMonitors: each monitor on its own", () => {
  test("works out each monitor and marks its time", async () => {
    monitorsById.set(
      OTHER_MONITOR_ID.toString(),
      monitorWith({ id: OTHER_MONITOR_ID }),
    );
    incidentsFound = [incidentWith({ id: ObjectID.generate().toString() })];

    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID, OTHER_MONITOR_ID],
    });

    expect(flagsWritten()).toEqual([true, true]);
    expect(switches).toHaveBeenCalledTimes(2);
  });

  test("one monitor failing does not leave the rest as they were", async () => {
    monitorsById.set(
      OTHER_MONITOR_ID.toString(),
      monitorWith({ id: OTHER_MONITOR_ID }),
    );
    incidentsFound = [incidentWith({ id: ObjectID.generate().toString() })];

    monitorUpdates.mockImplementationOnce((async (): Promise<void> => {
      throw new Error("The monitor's row is locked");
    }) as never);

    await expect(
      MonitorIncidentPause.syncMonitors({
        projectId: PROJECT_ID,
        monitorIds: [MONITOR_ID, OTHER_MONITOR_ID],
      }),
    ).resolves.toBeUndefined();

    expect(monitorUpdates).toHaveBeenCalledTimes(2);
    expect(
      String((monitorUpdates.mock.calls[1]![0] as { id: ObjectID }).id),
    ).toBe(OTHER_MONITOR_ID.toString());
  });

  test("a monitor that is gone is skipped", async () => {
    monitorsById.set(MONITOR_ID.toString(), null);

    await MonitorIncidentPause.syncMonitors({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
    });

    expect(monitorUpdates).not.toHaveBeenCalled();
    expect(switches).not.toHaveBeenCalled();
  });
});
