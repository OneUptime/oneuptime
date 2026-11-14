/*
 * When a monitor result reads the monitor's open incidents and alerts, and
 * when it leaves the read out (MonitorResourceUtil.monitorResource with
 * MonitorOpenRecords).
 *
 * The read is made for two things: to auto-resolve what the monitor's
 * criteria raised, and - for a criteria that opens records - to open none
 * beside one already open. A result whose criteria opens nothing skips it
 * when the monitor is known to have no open record its criteria raised;
 * every way such a record becomes open for the monitor makes that unknown
 * again. The cases here are the ones that could leave a record unresolved:
 *
 *   - a record a criteria raises, then the healthy result that resolves it;
 *   - a record reopened, or linked to the monitor, between results - and
 *     between the read a result makes and what it records of it;
 *   - the project's states changing;
 *   - a record that stays open, and one no criteria raised;
 *   - a Redis that cannot be reached.
 *
 * MonitorOpenRecords runs for real over an in-memory Redis; the reads of
 * open records (MonitorIncident / MonitorAlert.checkOpen...AndCloseIfResolved)
 * answer from in-memory lists, and the creators record what they create.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorProbeLastResults", () => {
  return {
    __esModule: true,
    default: {
      storeResultAndReadProbes: jest.fn(),
      readProbes: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorOpenRecords, {
  MonitorRecordKind,
} from "../../../../Server/Utils/Monitor/MonitorOpenRecords";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import MonitorService from "../../../../Server/Services/MonitorService";
import ProjectService from "../../../../Server/Services/ProjectService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Probe, {
  ProbeConnectionStatus,
} from "../../../../Models/DatabaseModels/Probe";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import MonitorProbeRowsInMemory from "../../TestingUtils/MonitorProbeRowsInMemory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const processMonitorStepMock: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

const ONLINE_STATUS: ObjectID = ObjectID.generate();
const OFFLINE_STATUS: ObjectID = ObjectID.generate();
const DEGRADED_STATUS: ObjectID = ObjectID.generate();

enum Verdict {
  Online = "Online",
  Degraded = "Degraded",
  Offline = "Offline",
  // Meets no criteria: the monitor goes back to its default status.
  Nothing = "Nothing",
}

// Redis, in memory: what MonitorOpenRecords keeps.
let redis: Map<string, string>;
let redisFails: boolean;

// The monitor's open records, as the reads of them answer.
let openIncidents: Array<Incident>;
let openAlerts: Array<Alert>;

let incidentReads: number;
let alertReads: number;

function criteria(data: {
  verdict: Verdict;
  statusId: ObjectID;
  opensIncidents?: boolean;
  opensAlerts?: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = `${data.verdict}-criteria`;
  instance.data!.name = data.verdict;
  instance.data!.changeMonitorStatus = true;
  instance.data!.monitorStatusId = data.statusId;
  instance.data!.createIncidents = data.opensIncidents === true;
  instance.data!.createAlerts = data.opensAlerts === true;
  instance.data!.incidents = data.opensIncidents
    ? [
        {
          id: `${data.verdict}-incident-template`,
          title: "Down",
          description: "Down",
          autoResolveIncident: true,
        },
      ]
    : [];
  instance.data!.alerts = data.opensAlerts
    ? [
        {
          id: `${data.verdict}-alert-template`,
          title: "Down",
          description: "Down",
          autoResolveAlert: true,
        },
      ]
    : [];
  return instance;
}

function makeMonitor(): { monitor: Monitor; step: MonitorStep } {
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      criteria({
        verdict: Verdict.Offline,
        statusId: OFFLINE_STATUS,
        opensIncidents: true,
        opensAlerts: true,
      }),
      criteria({
        verdict: Verdict.Degraded,
        statusId: DEGRADED_STATUS,
        // Opens an alert, never an incident.
        opensAlerts: true,
      }),
      criteria({ verdict: Verdict.Online, statusId: ONLINE_STATUS }),
    ],
  };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Website;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ONLINE_STATUS;

  return { monitor, step };
}

function autoCreatedIncident(criteriaId: string): Incident {
  const incident: Incident = new Incident();
  incident.id = ObjectID.generate();
  incident.title = "Down";
  incident.createdCriteriaId = criteriaId;
  return incident;
}

function autoCreatedAlert(criteriaId: string): Alert {
  const alert: Alert = new Alert();
  alert.id = ObjectID.generate();
  alert.title = "Down";
  alert.createdCriteriaId = criteriaId;
  return alert;
}

describe("MonitorResourceUtil.monitorResource and the monitor's open records", () => {
  let monitor: Monitor;
  let step: MonitorStep;
  let probeRows: MonitorProbeRowsInMemory;
  let probeId: ObjectID;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = new Map<string, string>();
    redisFails = false;
    openIncidents = [];
    openAlerts = [];
    incidentReads = 0;
    alertReads = 0;

    jest
      .spyOn(GlobalCache, "getStrings")
      .mockImplementation(async (namespace: string, keys: Array<string>) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        return keys.map((name: string) => {
          return redis.get(`${namespace}-${name}`) ?? null;
        });
      });

    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          if (redisFails) {
            throw new Error("Redis is down");
          }

          redis.set(`${namespace}-${key}`, value);
        },
      );

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          if (redisFails) {
            throw new Error("Redis is down");
          }

          if (redis.has(`${namespace}-${key}`)) {
            return false;
          }

          redis.set(`${namespace}-${key}`, value);
          return true;
        },
      );

    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);
    (Semaphore.lock as jest.Mock).mockResolvedValue({} as never);

    ({ monitor, step } = makeMonitor());
    (MonitorService.findOneById as jest.Mock).mockImplementation((async () => {
      return monitor;
    }) as never);

    jest
      .spyOn(MonitorResourceUtil, "refreshCurrentMonitorStatus")
      .mockResolvedValue(undefined);

    const probe: Probe = new Probe();
    probe.name = "Frankfurt";
    probe.connectionStatus = ProbeConnectionStatus.Connected;

    const row: MonitorProbe = new MonitorProbe();
    row.id = ObjectID.generate();
    row.probeId = ObjectID.generate();
    row.isEnabled = true;
    row.probe = probe;
    probeId = row.probeId;

    probeRows = new MonitorProbeRowsInMemory();
    probeRows.install();
    probeRows.set([row]);

    processMonitorStepMock.mockImplementation((async (input: {
      dataToProcess: JSONObject;
      probeApiIngestResponse: ProbeApiIngestResponse;
    }): Promise<ProbeApiIngestResponse> => {
      const verdict: string = String(input.dataToProcess["verdict"]);

      if (verdict === Verdict.Nothing) {
        return input.probeApiIngestResponse;
      }

      return {
        ...input.probeApiIngestResponse,
        criteriaMetId: `${verdict}-criteria`,
        rootCause: `It is ${verdict}.`,
      };
    }) as never);

    // The status follows the criteria met, as the timeline would move it.
    jest
      .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
      .mockImplementation((async (input: {
        criteriaInstance: MonitorCriteriaInstance;
      }): Promise<null> => {
        monitor.currentMonitorStatusId =
          input.criteriaInstance.data!.monitorStatusId!;
        return null;
      }) as never);

    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockImplementation((async (input: {
        data: MonitorStatusTimeline;
      }): Promise<MonitorStatusTimeline> => {
        monitor.currentMonitorStatusId = input.data.monitorStatusId!;
        return input.data;
      }) as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true as never);
    jest.spyOn(MonitorStatusService, "findOneBy").mockResolvedValue(null);

    jest
      .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
      .mockResolvedValue({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
      } as never);
    jest
      .spyOn(MonitorDependencySuppression, "getDependencySuppression")
      .mockResolvedValue({ isSuppressed: false } as never);
    jest
      .spyOn(MonitorSummaryCapture, "capture")
      .mockResolvedValue(null as never);

    // The reads of open records: resolve those auto-resolve would.
    jest
      .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
      .mockImplementation((async (input: {
        criteriaInstance: MonitorCriteriaInstance | null;
      }): Promise<Array<Incident>> => {
        incidentReads++;
        openIncidents = openIncidents.filter((incident: Incident) => {
          return (
            !incident.createdCriteriaId ||
            incident.createdCriteriaId === input.criteriaInstance?.data?.id ||
            incident.title === "Stays open"
          );
        });
        return [...openIncidents];
      }) as never);

    jest
      .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
      .mockImplementation((async (input: {
        criteriaInstance: MonitorCriteriaInstance | null;
      }): Promise<Array<Alert>> => {
        alertReads++;
        openAlerts = openAlerts.filter((alert: Alert) => {
          return (
            !alert.createdCriteriaId ||
            alert.createdCriteriaId === input.criteriaInstance?.data?.id
          );
        });
        return [...openAlerts];
      }) as never);

    // The creators: what a criteria that opens records opens, deduped.
    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockImplementation((async (input: {
        criteriaInstance: MonitorCriteriaInstance;
        openIncidents: Array<Incident>;
      }): Promise<void> => {
        if (
          input.criteriaInstance.data?.createIncidents &&
          input.openIncidents.length === 0
        ) {
          openIncidents.push(
            autoCreatedIncident(input.criteriaInstance.data.id),
          );
          await MonitorOpenRecords.forgetMonitors([monitor.id]);
        }
      }) as never);

    jest
      .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
      .mockImplementation((async (input: {
        criteriaInstance: MonitorCriteriaInstance;
        openAlerts: Array<Alert>;
      }): Promise<void> => {
        if (
          input.criteriaInstance.data?.createAlerts &&
          input.openAlerts.length === 0
        ) {
          openAlerts.push(autoCreatedAlert(input.criteriaInstance.data.id));
          await MonitorOpenRecords.forgetMonitors([monitor.id]);
        }
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function result(verdict: Verdict): Promise<void> {
    incidentReads = 0;
    alertReads = 0;

    await MonitorResourceUtil.monitorResource(
      {
        projectId: monitor.projectId!,
        monitorId: monitor.id!,
        probeId: probeId,
        monitorStepId: step.id,
        isOnline: verdict !== Verdict.Offline,
        failureCause: "",
        monitoredAt: OneUptimeDate.getCurrentDate(),
        verdict: verdict,
      } as unknown as ProbeMonitorResponse,
      { reportingProbeId: probeId },
    );
  }

  test("a healthy monitor reads its records once, then leaves the read out", async () => {
    await result(Verdict.Online);
    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 1,
      alertReads: 1,
    });

    await result(Verdict.Online);
    await result(Verdict.Online);
    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 0,
      alertReads: 0,
    });
  });

  test("a criteria that opens records always reads them, to open none twice", async () => {
    await result(Verdict.Online);
    await result(Verdict.Offline);

    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 1,
      alertReads: 1,
    });
    expect(openIncidents).toHaveLength(1);
    expect(openAlerts).toHaveLength(1);

    // Still down: read again, and nothing opened beside them.
    await result(Verdict.Offline);
    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 1,
      alertReads: 1,
    });
    expect(openIncidents).toHaveLength(1);
    expect(openAlerts).toHaveLength(1);
  });

  test("a criteria that opens only alerts reads the alerts, and leaves the incidents' read out", async () => {
    await result(Verdict.Online);
    await result(Verdict.Degraded);

    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 0,
      alertReads: 1,
    });
    expect(openAlerts).toHaveLength(1);
  });

  test("the healthy result after records were raised reads them, and resolves them", async () => {
    await result(Verdict.Online);
    await result(Verdict.Offline);

    await result(Verdict.Online);

    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 1,
      alertReads: 1,
    });
    expect(openIncidents).toHaveLength(0);
    expect(openAlerts).toHaveLength(0);

    // Resolved: the next healthy result leaves the read out again.
    await result(Verdict.Online);
    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 0,
      alertReads: 0,
    });
  });

  test("going back to the default status with no criteria met reads them once, and resolves them", async () => {
    await result(Verdict.Online);
    await result(Verdict.Offline);

    await result(Verdict.Nothing);

    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 1,
      alertReads: 1,
    });
    expect(openIncidents).toHaveLength(0);
    expect(monitor.currentMonitorStatusId?.toString()).toBe(
      ONLINE_STATUS.toString(),
    );
  });

  test("a record reopened between results is read and resolved by the next healthy result", async () => {
    await result(Verdict.Online);
    await result(Verdict.Offline);
    await result(Verdict.Online);

    // Someone reopens the incident: IncidentService forgets its monitors.
    const reopened: Incident = autoCreatedIncident(
      `${Verdict.Offline}-criteria`,
    );
    openIncidents.push(reopened);
    await MonitorOpenRecords.forgetMonitors([monitor.id]);

    await result(Verdict.Online);

    expect(incidentReads).toBe(1);
    expect(openIncidents).toHaveLength(0);
  });

  test("a record reopened while a result reads the records is read by the next result", async () => {
    await result(Verdict.Online);

    // The read finds none open; the reopen lands right after it.
    (
      MonitorIncident.checkOpenIncidentsAndCloseIfResolved as unknown as jest.Mock
    ).mockImplementationOnce((async (): Promise<Array<Incident>> => {
      incidentReads++;
      const answer: Array<Incident> = [...openIncidents];
      openIncidents.push(autoCreatedIncident(`${Verdict.Offline}-criteria`));
      await MonitorOpenRecords.forgetMonitors([monitor.id]);
      return answer;
    }) as never);

    // Nothing is known yet after the warm-up's read? Make it unknown.
    await MonitorOpenRecords.forgetMonitors([monitor.id]);
    await result(Verdict.Online);
    expect(incidentReads).toBe(1);

    // What that result recorded ("none open") was stamped before the reopen.
    await result(Verdict.Online);
    expect(incidentReads).toBe(1);
    expect(openIncidents).toHaveLength(0);
  });

  test("a record linked to the monitor between results is read by the next result", async () => {
    await result(Verdict.Online);
    await result(Verdict.Online);
    expect(incidentReads).toBe(0);

    // An open incident a criteria raised is linked to this monitor.
    openIncidents.push(autoCreatedIncident(`${Verdict.Offline}-criteria`));
    await MonitorOpenRecords.forgetMonitors([monitor.id]);

    await result(Verdict.Online);
    expect(incidentReads).toBe(1);
    expect(openIncidents).toHaveLength(0);
  });

  test("a change to the project's states makes the next result read them", async () => {
    await result(Verdict.Online);
    await result(Verdict.Online);
    expect(incidentReads).toBe(0);

    await MonitorOpenRecords.forgetProject(monitor.projectId);

    await result(Verdict.Online);
    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 1,
      alertReads: 1,
    });
  });

  test("a record that stays open is read on every result", async () => {
    const stays: Incident = autoCreatedIncident(`${Verdict.Offline}-criteria`);
    stays.title = "Stays open";
    openIncidents.push(stays);

    await result(Verdict.Online);
    await result(Verdict.Online);
    await result(Verdict.Online);

    expect(incidentReads).toBe(1);
    expect(openIncidents).toHaveLength(1);
  });

  test("a record no criteria raised does not keep the read going: no result ever resolves it", async () => {
    const declaredByHand: Incident = new Incident();
    declaredByHand.id = ObjectID.generate();
    declaredByHand.title = "Declared by hand";
    openIncidents.push(declaredByHand);

    await result(Verdict.Online);
    await result(Verdict.Online);

    expect(incidentReads).toBe(0);
    expect(openIncidents).toEqual([declaredByHand]);
  });

  test("a Redis that cannot be reached reads the records on every result, and fails nothing", async () => {
    redisFails = true;

    await result(Verdict.Online);
    await result(Verdict.Online);

    expect({ incidentReads, alertReads }).toEqual({
      incidentReads: 1,
      alertReads: 1,
    });
  });

  test("what is known is kept apart for incidents and alerts", async () => {
    await result(Verdict.Online);

    const reading: Awaited<ReturnType<typeof MonitorOpenRecords.read>> =
      await MonitorOpenRecords.read({
        monitorId: monitor.id!,
        projectId: monitor.projectId!,
      });

    expect(reading.noneOpen[MonitorRecordKind.Incident]).toBe(true);
    expect(reading.noneOpen[MonitorRecordKind.Alert]).toBe(true);

    // An alert raised: alerts unknown again, incidents with them (one token).
    await result(Verdict.Degraded);
    await result(Verdict.Online);

    expect(alertReads).toBe(1);
  });
});
