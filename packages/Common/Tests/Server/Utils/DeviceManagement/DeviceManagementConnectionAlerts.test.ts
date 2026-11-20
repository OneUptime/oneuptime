import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { MonitorFeedEventType } from "../../../../Models/DatabaseModels/MonitorFeed";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MonitorFeedService from "../../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../../Server/Services/MonitorService";
import UserService from "../../../../Server/Services/UserService";
import DeviceManagementConnectionAlerts, {
  DeviceManagementConnectionAlertsOutcome,
  DeviceManagementConnectionGone,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectionAlerts";
import {
  DeviceManagementConnectionReadRecord,
  buildDeviceManagementConnectionReadRecordRow,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectionReadMetrics";
import logger from "../../../../Server/Utils/Logger";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  DeviceManagementConnectionReadOutcome,
  DeviceManagementConnectionReadingAttribute,
  MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "../../../../Types/JSON";
import {
  ManagedDeviceAlertTemplateArgs,
  getManagedDeviceAlertTemplateById,
} from "../../../../Types/Monitor/ManagedDeviceAlertTemplates";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { readStatusChangeNote } from "../../../../Utils/Monitor/StatusChangeNotes";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DEVICE MANAGEMENT CONNECTION TURNED OFF OR DELETED (#10286).
 *
 * Turned off, it writes one last reading - 0 minutes, outcome "off" - and
 * what its Connection Stopped Reading monitors opened about it is resolved,
 * saying who turned it off. Its devices' alerts stay as they are. Deleted,
 * every monitor that read it alone - its own reading or its devices' - has
 * what it had open resolved, its monitoring turned off and its feed told
 * why. A monitor that also reads something else is left alone, and so is
 * what a person set to stay open.
 *
 * The services are stood in for: what they are asked, and what is written,
 * is what these read. The monitors are the templates' own steps.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-000000000001",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000c1",
);
const OTHER_CONNECTION_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000c2",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-0e0e-4aaa-8bbb-000000000002");
const RESOLVED_ALERT_STATE_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000d2",
);
const RESOLVED_INCIDENT_STATE_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000d1",
);
const OPEN_ALERT_STATE_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000f1",
);
const OPEN_INCIDENT_STATE_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000e1",
);
const NOW: Date = new Date("2026-11-20T15:05:00.000Z");
const USER_LINK: string =
  mdText`[${"Jane Doe"}](${"https://oneuptime.example/dashboard/p/users/u"})`.toString();

const CONNECTION: DeviceManagementConnectionGone = {
  connectionId: CONNECTION_ID,
  projectId: PROJECT_ID,
  name: "Esper acme",
  provider: DeviceManagementProvider.Esper,
  readIntervalInMinutes: 15,
  lastSuccessfulPullAt: new Date("2026-11-20T13:30:00.000Z"),
  createdAt: new Date("2026-10-01T09:00:00.000Z"),
};

let monitorNumber: number = 0;

function templateArgs(connectionId: ObjectID): ManagedDeviceAlertTemplateArgs {
  return {
    deviceManagementConnectionId: connectionId.toString(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme",
  };
}

// A monitor made from one or more templates' steps, as Postgres hands it back.
function monitorOf(data: {
  name: string;
  templateIds: Array<string>;
  connectionId?: ObjectID | undefined;
  isOff?: boolean | undefined;
  steps?: Array<MonitorStep> | undefined;
}): Monitor {
  monitorNumber += 1;
  const monitor: Monitor = new Monitor();
  monitor._id = `0193c0de-0e0e-4aaa-8bbb-${String(monitorNumber).padStart(12, "0")}`;
  monitor.projectId = PROJECT_ID;
  monitor.name = data.name;
  monitor.monitorType = MonitorType.Metrics;
  monitor.disableActiveMonitoring = data.isOff === true;

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray:
      data.steps ||
      data.templateIds.map((templateId: string): MonitorStep => {
        return getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep(
          templateArgs(data.connectionId || CONNECTION_ID),
        );
      }),
    defaultMonitorStatusId: ObjectID.generate(),
  };
  monitor.monitorSteps = MonitorSteps.fromJSON(
    JSON.parse(JSON.stringify(MonitorSteps.toDatabaseJSON(steps.toJSON()))),
  );

  return monitor;
}

// The firing criteria of a monitor's first step: what its records were opened by.
function firingCriteriaOf(monitor: Monitor): MonitorCriteriaInstance {
  return monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
    .monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
}

let alertNumber: number = 0;

function openAlertOf(
  monitor: Monitor,
  overrides: { createdCriteriaId?: string } = {},
): Alert {
  alertNumber += 1;
  const alert: Alert = new Alert();
  alert._id = `0193c0de-0e0e-4aaa-8bbb-a${String(alertNumber).padStart(11, "0")}`;
  alert.projectId = PROJECT_ID;
  alert.monitorId = monitor.id!;
  alert.createdCriteriaId =
    overrides.createdCriteriaId || firingCriteriaOf(monitor).data!.id;

  return alert;
}

function openIncidentOf(monitor: Monitor): Incident {
  alertNumber += 1;
  const incident: Incident = new Incident();
  incident._id = `0193c0de-0e0e-4aaa-8bbb-b${String(alertNumber).padStart(11, "0")}`;
  incident.projectId = PROJECT_ID;
  incident.createdCriteriaId = firingCriteriaOf(monitor).data!.id;
  incident.createdIncidentTemplateId =
    firingCriteriaOf(monitor).data!.incidents[0]!.id;

  return incident;
}

let monitors: Array<Monitor>;
let openAlertsByMonitor: Map<string, Array<Alert>>;
let openIncidentsByMonitor: Map<string, Array<Incident>>;
let monitorQueries: Array<Dictionary<unknown>>;
let alertTimelines: Array<AlertStateTimeline>;
let incidentTimelines: Array<IncidentStateTimeline>;
let monitorUpdates: Array<{ id: string; data: JSONObject; props: JSONObject }>;
let feedItems: Array<JSONObject>;
let readings: Array<DeviceManagementConnectionReadRecord>;

beforeEach(() => {
  monitorNumber = 0;
  alertNumber = 0;
  monitors = [];
  openAlertsByMonitor = new Map<string, Array<Alert>>();
  openIncidentsByMonitor = new Map<string, Array<Incident>>();
  monitorQueries = [];
  alertTimelines = [];
  incidentTimelines = [];
  monitorUpdates = [];
  feedItems = [];
  readings = [];

  jest.spyOn(MonitorService, "findBy").mockImplementation((async (data: {
    query: Dictionary<unknown>;
  }) => {
    monitorQueries.push(data.query);
    return monitors;
  }) as never);
  jest.spyOn(MonitorService, "updateOneById").mockImplementation((async (data: {
    id: ObjectID;
    data: JSONObject;
    props: JSONObject;
  }) => {
    monitorUpdates.push({
      id: data.id.toString(),
      data: data.data,
      props: data.props,
    });
  }) as never);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockImplementation((async (data: JSONObject) => {
      feedItems.push(data);
    }) as never);
  jest.spyOn(AlertService, "findBy").mockImplementation((async (data: {
    query: { monitorId: ObjectID };
  }) => {
    return openAlertsByMonitor.get(data.query.monitorId.toString()) || [];
  }) as never);
  jest.spyOn(IncidentService, "findBy").mockImplementation((async (data: {
    query: { monitors: Array<ObjectID> };
  }) => {
    return openIncidentsByMonitor.get(data.query.monitors[0]!.toString()) || [];
  }) as never);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([OPEN_ALERT_STATE_ID]);
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([OPEN_INCIDENT_STATE_ID]);
  jest
    .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(RESOLVED_ALERT_STATE_ID);
  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(RESOLVED_INCIDENT_STATE_ID);
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((async (data: { data: AlertStateTimeline }) => {
      alertTimelines.push(data.data);
      return data.data;
    }) as never);
  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation((async (data: { data: IncidentStateTimeline }) => {
      incidentTimelines.push(data.data);
      return data.data;
    }) as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(FeedMarkdown.asMarkdown(USER_LINK));
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const dependencies: {
  isTelemetryAllowed: () => Promise<boolean>;
  recordConnectionReadings: (
    records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
  ) => Promise<number>;
  now: () => Date;
} = {
  isTelemetryAllowed: async (): Promise<boolean> => {
    return true;
  },
  recordConnectionReadings: async (
    records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
  ): Promise<number> => {
    readings.push(...records);
    return records.length;
  },
  now: (): Date => {
    return NOW;
  },
};

describe("the monitors of a connection", () => {
  test("are read as the project's Metrics monitors whose steps name its id, then held to what their queries read", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    const devices: Monitor = monitorOf({
      name: "Esper acme - Esper Low Battery",
      templateIds: ["esper-low-battery"],
    });
    // Names the id in its steps, but reads no reading of a connection.
    const unrelated: Monitor = monitorOf({
      name: "CPU",
      templateIds: [],
      steps: [
        MonitorStep.getDefaultMonitorStep({
          monitorName: `CPU of ${CONNECTION_ID.toString()}`,
          monitorType: MonitorType.Metrics,
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
        }),
      ],
    });

    monitors = [own, devices, unrelated];

    const found: Array<{ id: string; reads: unknown }> = (
      await DeviceManagementConnectionAlerts.findMonitorsOfConnection({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
      })
    ).map((candidate: { monitor: Monitor; reads: unknown }) => {
      return { id: candidate.monitor.id!.toString(), reads: candidate.reads };
    });

    expect(found).toEqual([
      {
        id: own.id!.toString(),
        reads: {
          readsThisConnectionAlone: true,
          readsConnectionReading: true,
          readsDeviceReadings: false,
        },
      },
      {
        id: devices.id!.toString(),
        reads: {
          readsThisConnectionAlone: true,
          readsConnectionReading: false,
          readsDeviceReadings: true,
        },
      },
    ]);

    expect(monitorQueries).toHaveLength(1);
    expect(monitorQueries[0]!["projectId"]).toEqual(PROJECT_ID);
    expect(monitorQueries[0]!["monitorType"]).toBe(MonitorType.Metrics);
    // A text search of the steps, by the connection's id: a candidate, never a match.
    expect(monitorQueries[0]!["monitorSteps"]).toBeDefined();
    expect(JSON.stringify(monitorQueries[0]!["monitorSteps"])).toContain(
      CONNECTION_ID.toString(),
    );
    expect(MonitorService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
    );
  });
});

describe("a connection turned off", () => {
  test("writes one last reading: 0 minutes, nothing due of it, as of now", async () => {
    await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
      connections: [CONNECTION],
      turnedOffByUserId: USER_ID,
      dependencies,
    });

    expect(readings).toHaveLength(1);
    expect(readings[0]!.connectionId).toBe(CONNECTION_ID);
    expect(readings[0]!.reading).toMatchObject({
      outcome: DeviceManagementConnectionReadOutcome.Off,
      connectionName: "Esper acme",
      provider: DeviceManagementProvider.Esper,
      readIntervalInMinutes: 15,
      asOf: NOW,
    });

    // As its writer writes it: 0, no error, its last read that worked kept.
    const row: JSONObject = buildDeviceManagementConnectionReadRecordRow(
      readings[0]!,
      30,
    );
    const attributes: Dictionary<string> = row[
      "attributes"
    ] as Dictionary<string>;

    expect(row["name"]).toBe(MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME);
    expect(row["value"]).toBe(0);
    expect(
      attributes[DeviceManagementConnectionReadingAttribute.ReadOutcome],
    ).toBe("off");
    expect(
      attributes[
        DeviceManagementConnectionReadingAttribute.LastSuccessfulReadAt
      ],
    ).toBe("2026-11-20T13:30:00.000Z");
    expect(
      attributes[DeviceManagementConnectionReadingAttribute.LastError],
    ).toBeUndefined();
    expect(
      attributes[DeviceManagementConnectionReadingAttribute.FailureKind],
    ).toBeUndefined();
  });

  test("resolves its Connection Stopped Reading alert and incident, saying who turned it off", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    monitors = [own];

    const alert: Alert = openAlertOf(own);
    const incident: Incident = openIncidentOf(own);
    openAlertsByMonitor.set(own.id!.toString(), [alert]);
    openIncidentsByMonitor.set(own.id!.toString(), [incident]);

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
        connections: [CONNECTION],
        turnedOffByUserId: USER_ID,
        dependencies,
      });

    expect(outcome).toEqual({
      connectionId: CONNECTION_ID.toString(),
      wroteLastReading: true,
      resolvedIncidentIds: [incident.id!.toString()],
      resolvedAlertIds: [alert.id!.toString()],
      monitorIdsTurnedOff: [],
    });

    expect(alertTimelines).toHaveLength(1);
    expect(alertTimelines[0]!.alertStateId).toEqual(RESOLVED_ALERT_STATE_ID);
    expect(alertTimelines[0]!.rootCause).toBe(
      `${USER_LINK} turned off the device management connection **Esper acme**. Nothing reads a connection while it is off, so none of its reads is overdue, and this was resolved. If the connection is turned back on and its reads still fail, its monitor opens a new one.`,
    );
    expect(incidentTimelines[0]!.incidentStateId).toEqual(
      RESOLVED_INCIDENT_STATE_ID,
    );
    expect(incidentTimelines[0]!.rootCause).toBe(alertTimelines[0]!.rootCause);

    // A note OneUptime writes, read back in the reader's language.
    expect(readStatusChangeNote(alertTimelines[0]!.rootCause!)).toBeTruthy();

    // Its monitor stays on: the connection may be turned back on.
    expect(monitorUpdates).toEqual([]);
  });

  test("turned off with no person to name, the note says it was turned off", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    monitors = [own];
    openAlertsByMonitor.set(own.id!.toString(), [openAlertOf(own)]);

    await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
      connections: [CONNECTION],
      turnedOffByUserId: undefined,
      dependencies,
    });

    expect(UserService.getUserMarkdownString).not.toHaveBeenCalled();
    expect(alertTimelines[0]!.rootCause).toBe(
      "The device management connection **Esper acme** was turned off. Nothing reads a connection while it is off, so none of its reads is overdue, and this was resolved. If the connection is turned back on and its reads still fail, its monitor opens a new one.",
    );
    expect(readStatusChangeNote(alertTimelines[0]!.rootCause!)).toBeTruthy();
  });

  test("leaves its devices' alerts as they are: they are frozen as the last read left them", async () => {
    const devices: Monitor = monitorOf({
      name: "Esper acme - Esper Android Device Stopped Checking In",
      templateIds: ["esper-device-stopped-checking-in"],
    });
    monitors = [devices];
    openAlertsByMonitor.set(devices.id!.toString(), [openAlertOf(devices)]);

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
        connections: [CONNECTION],
        turnedOffByUserId: USER_ID,
        dependencies,
      });

    expect(outcome!.resolvedAlertIds).toEqual([]);
    expect(alertTimelines).toEqual([]);
    expect(AlertService.findBy).not.toHaveBeenCalled();
  });

  test("leaves a monitor that reads another connection, or its devices, beside it", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    const ownAndOther: Monitor = monitorOf({
      name: "Two connections",
      templateIds: [],
      steps: [
        getManagedDeviceAlertTemplateById(
          "esper-connection-stopped-reading",
        )!.getMonitorStep(templateArgs(CONNECTION_ID)),
        getManagedDeviceAlertTemplateById(
          "soti-connection-stopped-reading",
        )!.getMonitorStep(templateArgs(OTHER_CONNECTION_ID)),
      ],
    });
    const ownAndDevices: Monitor = monitorOf({
      name: "Connection and its devices",
      templateIds: [
        "esper-connection-stopped-reading",
        "esper-device-stopped-checking-in",
      ],
    });

    monitors = [own, ownAndOther, ownAndDevices];

    for (const monitor of monitors) {
      openAlertsByMonitor.set(monitor.id!.toString(), [openAlertOf(monitor)]);
    }

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
        connections: [CONNECTION],
        turnedOffByUserId: USER_ID,
        dependencies,
      });

    expect(outcome!.resolvedAlertIds).toEqual(
      openAlertsByMonitor.get(own.id!.toString())!.map((alert: Alert) => {
        return alert.id!.toString();
      }),
    );
  });

  test("leaves open what a person set to stay open until they close it", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    // Its alert template set not to resolve on its own.
    firingCriteriaOf(own).data!.alerts[0]!.autoResolveAlert = false;
    monitors = [own];
    openAlertsByMonitor.set(own.id!.toString(), [openAlertOf(own)]);

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
        connections: [CONNECTION],
        turnedOffByUserId: USER_ID,
        dependencies,
      });

    expect(outcome!.resolvedAlertIds).toEqual([]);
    expect(alertTimelines).toEqual([]);
  });

  test("a project that may not read telemetry writes no reading, and its alert is resolved all the same", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    monitors = [own];
    openAlertsByMonitor.set(own.id!.toString(), [openAlertOf(own)]);

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
        connections: [CONNECTION],
        turnedOffByUserId: USER_ID,
        dependencies: {
          ...dependencies,
          isTelemetryAllowed: async (): Promise<boolean> => {
            return false;
          },
        },
      });

    expect(readings).toEqual([]);
    expect(outcome!.wroteLastReading).toBe(false);
    expect(outcome!.resolvedAlertIds).toHaveLength(1);
  });

  test("a reading that cannot be written is logged, and its alert is resolved all the same", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    monitors = [own];
    openAlertsByMonitor.set(own.id!.toString(), [openAlertOf(own)]);

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
        connections: [CONNECTION],
        turnedOffByUserId: USER_ID,
        dependencies: {
          ...dependencies,
          recordConnectionReadings: async (): Promise<number> => {
            throw new Error("ClickHouse is down");
          },
        },
      });

    expect(outcome!.wroteLastReading).toBe(false);
    expect(outcome!.resolvedAlertIds).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("its last reading could not be recorded"),
      expect.anything(),
    );
  });

  test("a connection saved without a name is called by its service", async () => {
    const own: Monitor = monitorOf({
      name: "Intune - Intune Connection Stopped Reading",
      templateIds: ["intune-connection-stopped-reading"],
    });
    monitors = [own];
    openAlertsByMonitor.set(own.id!.toString(), [openAlertOf(own)]);

    await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
      connections: [
        {
          ...CONNECTION,
          name: "  ",
          provider: DeviceManagementProvider.Intune,
        },
      ],
      turnedOffByUserId: undefined,
      dependencies,
    });

    expect(alertTimelines[0]!.rootCause).toContain(
      "The device management connection **Microsoft Intune** was turned off.",
    );
  });

  test("an alert resolved meanwhile, by its own check, is left as it is", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    monitors = [own];
    openAlertsByMonitor.set(own.id!.toString(), [openAlertOf(own)]);

    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockRejectedValue(
        new BadDataException("Alert state cannot be same as previous state."),
      );

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
        connections: [CONNECTION],
        turnedOffByUserId: USER_ID,
        dependencies,
      });

    expect(outcome!.resolvedAlertIds).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("a connection deleted", () => {
  test("turns off every monitor that read it alone, resolving what each had open and telling its feed why", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    const checkIns: Monitor = monitorOf({
      name: "Esper acme - Esper Android Device Stopped Checking In",
      templateIds: ["esper-device-stopped-checking-in"],
    });
    const battery: Monitor = monitorOf({
      name: "Esper acme - Esper Low Battery",
      templateIds: ["esper-low-battery"],
    });
    monitors = [own, checkIns, battery];

    const alerts: Array<Alert> = [
      openAlertOf(own),
      openAlertOf(checkIns),
      openAlertOf(checkIns),
    ];
    openAlertsByMonitor.set(own.id!.toString(), [alerts[0]!]);
    openAlertsByMonitor.set(checkIns.id!.toString(), [alerts[1]!, alerts[2]!]);

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsDeleted({
        connections: [CONNECTION],
        deletedByUserId: USER_ID,
      });

    expect(outcome!.resolvedAlertIds).toEqual(
      alerts.map((alert: Alert): string => {
        return alert.id!.toString();
      }),
    );
    expect(outcome!.monitorIdsTurnedOff).toEqual([
      own.id!.toString(),
      checkIns.id!.toString(),
      battery.id!.toString(),
    ]);

    // Each turned off as OneUptime, never as the person who deleted the connection.
    for (const update of monitorUpdates) {
      expect(update.data).toEqual({ disableActiveMonitoring: true });
      expect(update.props).toEqual({ isRoot: true, tenantId: PROJECT_ID });
    }

    const rootCause: string = alertTimelines[0]!.rootCause!;
    expect(rootCause).toBe(
      `${USER_LINK} deleted the device management connection **Esper acme**, and its devices with it. Nothing is read for the monitor that opened this any more, so its monitoring was turned off, and this was resolved.`,
    );
    expect(readStatusChangeNote(rootCause)).toBeTruthy();

    expect(feedItems).toHaveLength(3);
    expect(feedItems[0]).toMatchObject({
      monitorId: own.id,
      projectId: PROJECT_ID,
      monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
    });
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
      "**Monitoring was turned off: nothing is read for this monitor any more.**",
    );
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
      `${USER_LINK} deleted the device management connection **Esper acme** this monitor reads`,
    );
  });

  test("a monitor that is off already is not turned off again, nor its feed told", async () => {
    const off: Monitor = monitorOf({
      name: "Esper acme - Esper Low Battery",
      templateIds: ["esper-low-battery"],
      isOff: true,
    });
    monitors = [off];

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsDeleted({
        connections: [CONNECTION],
        deletedByUserId: USER_ID,
      });

    expect(outcome!.monitorIdsTurnedOff).toEqual([]);
    expect(monitorUpdates).toEqual([]);
    expect(feedItems).toEqual([]);
  });

  test("a monitor that also reads another connection is left on: its device drops out as any device that left its fleet does", async () => {
    const both: Monitor = monitorOf({
      name: "Every store",
      templateIds: [],
      steps: [
        getManagedDeviceAlertTemplateById(
          "esper-device-stopped-checking-in",
        )!.getMonitorStep(templateArgs(CONNECTION_ID)),
        getManagedDeviceAlertTemplateById(
          "esper-device-stopped-checking-in",
        )!.getMonitorStep(templateArgs(OTHER_CONNECTION_ID)),
      ],
    });
    monitors = [both];
    openAlertsByMonitor.set(both.id!.toString(), [openAlertOf(both)]);

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsDeleted({
        connections: [CONNECTION],
        deletedByUserId: USER_ID,
      });

    expect(outcome).toMatchObject({
      resolvedAlertIds: [],
      monitorIdsTurnedOff: [],
    });
  });

  test("one monitor that cannot be turned off holds no other back", async () => {
    const first: Monitor = monitorOf({
      name: "Esper acme - Esper Low Battery",
      templateIds: ["esper-low-battery"],
    });
    const second: Monitor = monitorOf({
      name: "Esper acme - Esper Storage Nearly Full",
      templateIds: ["esper-storage-nearly-full"],
    });
    monitors = [first, second];

    jest
      .spyOn(MonitorService, "updateOneById")
      .mockImplementationOnce((async () => {
        throw new Error("The monitor is locked.");
      }) as never)
      .mockImplementation((async (data: {
        id: ObjectID;
        data: JSONObject;
        props: JSONObject;
      }) => {
        monitorUpdates.push({
          id: data.id.toString(),
          data: data.data,
          props: data.props,
        });
      }) as never);

    const [outcome]: Array<DeviceManagementConnectionAlertsOutcome> =
      await DeviceManagementConnectionAlerts.onConnectionsDeleted({
        connections: [CONNECTION],
        deletedByUserId: USER_ID,
      });

    expect(outcome!.monitorIdsTurnedOff).toEqual([second.id!.toString()]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not be turned off"),
      expect.anything(),
    );
  });

  test("deleted by an API key, the note names no one", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    monitors = [own];
    openAlertsByMonitor.set(own.id!.toString(), [openAlertOf(own)]);

    await DeviceManagementConnectionAlerts.onConnectionsDeleted({
      connections: [CONNECTION],
      deletedByUserId: undefined,
    });

    expect(alertTimelines[0]!.rootCause).toBe(
      "The device management connection **Esper acme** was deleted, and its devices with it. Nothing is read for the monitor that opened this any more, so its monitoring was turned off, and this was resolved.",
    );
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
      "The device management connection **Esper acme** this monitor reads was deleted, and its devices with it.",
    );
  });

  /*
   * Resolved first, saying the connection was deleted: turning monitoring
   * off resolves what is still open in plainer words of its own
   * (MonitorTurnedOff), which then finds nothing left but what a check on
   * its way may have opened meanwhile.
   */
  test("its monitors' records are resolved, saying why, before their monitoring is turned off", async () => {
    const own: Monitor = monitorOf({
      name: "Esper acme - Esper Connection Stopped Reading",
      templateIds: ["esper-connection-stopped-reading"],
    });
    monitors = [own];
    openAlertsByMonitor.set(own.id!.toString(), [openAlertOf(own)]);

    const order: Array<string> = [];

    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockImplementation((async (data: { data: AlertStateTimeline }) => {
        order.push("resolved");
        return data.data;
      }) as never);
    jest
      .spyOn(MonitorService, "updateOneById")
      .mockImplementation((async () => {
        order.push("turned off");
      }) as never);

    await DeviceManagementConnectionAlerts.onConnectionsDeleted({
      connections: [CONNECTION],
      deletedByUserId: USER_ID,
    });

    expect(order).toEqual(["resolved", "turned off"]);
  });
});
