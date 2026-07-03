import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorHysteresis, {
  HysteresisCreationGate,
} from "../../../../Server/Utils/Monitor/MonitorHysteresis";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";

/*
 * Alert hysteresis — reopen cooldown (reopenCooldownSeconds).
 *
 * On auto-resolve, when the CREATING criteria opted into a reopen
 * cooldown, a cooldown key is written with TTL = reopenCooldownSeconds;
 * the creation gate then suppresses re-creation while the key lives.
 * TTL expiry is Redis's job — tests simulate it by deleting the key
 * from the in-memory store.
 *
 * Covered here (both incident and alert paths):
 *  - auto-resolve writes the cooldown key with the configured TTL.
 *  - re-creation is blocked inside the window and allowed after expiry.
 *  - per-series cooldowns are per fingerprint.
 *  - resolution itself is NEVER delayed by hysteresis.
 *  - cooldown read failure fails open (creation proceeds).
 */

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getJSONObject: jest.fn(),
      setJSON: jest.fn(),
      getString: jest.fn(),
      getStrings: jest.fn(),
      setString: jest.fn(),
      deleteKey: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      create: jest.fn(),
      addOwners: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/IncidentStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      getResolvedStateIdForProject: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      create: jest.fn(),
      addOwners: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/AlertStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      getResolvedStateIdForProject: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorClusterContext", () => {
  return {
    __esModule: true,
    default: {
      resolveClusterContextForMonitor: jest.fn(() => {
        return Promise.resolve({
          proxmoxClusterIds: [],
          cephClusterIds: [],
          dockerSwarmClusterIds: [],
          iotFleetIds: [],
        });
      }),
    },
  };
});

const cacheGetJSONObjectMock: jest.Mock =
  GlobalCache.getJSONObject as jest.Mock;
const cacheSetJSONMock: jest.Mock = GlobalCache.setJSON as jest.Mock;
const cacheGetStringMock: jest.Mock = GlobalCache.getString as jest.Mock;
const cacheGetStringsMock: jest.Mock = GlobalCache.getStrings as jest.Mock;
const cacheSetStringMock: jest.Mock = GlobalCache.setString as jest.Mock;
const cacheDeleteKeyMock: jest.Mock = GlobalCache.deleteKey as jest.Mock;

const incidentFindByMock: jest.Mock = IncidentService.findBy as jest.Mock;
const incidentCreateMock: jest.Mock = IncidentService.create as jest.Mock;
const incidentResolvedStateMock: jest.Mock =
  IncidentStateTimelineService.getResolvedStateIdForProject as jest.Mock;
const incidentTimelineCreateMock: jest.Mock =
  IncidentStateTimelineService.create as jest.Mock;

const alertFindByMock: jest.Mock = AlertService.findBy as jest.Mock;
const alertCreateMock: jest.Mock = AlertService.create as jest.Mock;
const alertResolvedStateMock: jest.Mock =
  AlertStateTimelineService.getResolvedStateIdForProject as jest.Mock;
const alertTimelineCreateMock: jest.Mock =
  AlertStateTimelineService.create as jest.Mock;

interface CacheEntry {
  value: string | JSONObject;
  expiresInSeconds?: number | undefined;
}

const cacheStore: Map<string, CacheEntry> = new Map<string, CacheEntry>();

function wireCacheMocksToStore(): void {
  cacheGetJSONObjectMock.mockImplementation(
    (namespace: string, key: string): Promise<JSONObject | null> => {
      const entry: CacheEntry | undefined = cacheStore.get(
        `${namespace}-${key}`,
      );
      return Promise.resolve(entry ? (entry.value as JSONObject) : null);
    },
  );

  cacheSetJSONMock.mockImplementation(
    (
      namespace: string,
      key: string,
      value: JSONObject,
      options?: { expiresInSeconds: number },
    ): Promise<void> => {
      cacheStore.set(`${namespace}-${key}`, {
        value,
        expiresInSeconds: options?.expiresInSeconds,
      });
      return Promise.resolve();
    },
  );

  cacheGetStringMock.mockImplementation(
    (namespace: string, key: string): Promise<string | null> => {
      const entry: CacheEntry | undefined = cacheStore.get(
        `${namespace}-${key}`,
      );
      return Promise.resolve(entry ? (entry.value as string) : null);
    },
  );

  cacheGetStringsMock.mockImplementation(
    (namespace: string, keys: Array<string>): Promise<Array<string | null>> => {
      return Promise.resolve(
        keys.map((key: string) => {
          const entry: CacheEntry | undefined = cacheStore.get(
            `${namespace}-${key}`,
          );
          return entry ? (entry.value as string) : null;
        }),
      );
    },
  );

  cacheSetStringMock.mockImplementation(
    (
      namespace: string,
      key: string,
      value: string,
      options?: { expiresInSeconds: number },
    ): Promise<void> => {
      cacheStore.set(`${namespace}-${key}`, {
        value,
        expiresInSeconds: options?.expiresInSeconds,
      });
      return Promise.resolve();
    },
  );

  cacheDeleteKeyMock.mockImplementation(
    (namespace: string, key: string): Promise<void> => {
      cacheStore.delete(`${namespace}-${key}`);
      return Promise.resolve();
    },
  );
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const CRITERIA_ID: string = "down-criteria";
const INCIDENT_TEMPLATE_ID: string = "incident-template-1";
const ALERT_TEMPLATE_ID: string = "alert-template-1";
const COOLDOWN_SECONDS: number = 120;

const dataToProcess: DataToProcess = {
  monitorId: ObjectID.generate(),
} as unknown as DataToProcess;

function buildMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.IoTDevice;
  return monitor;
}

function cooldownStoreKey(monitor: Monitor, fingerprintKey: string): string {
  return `monitor-hysteresis-cooldown:${monitor.id!.toString()}:${CRITERIA_ID}:${fingerprintKey}`;
}

function buildCriteria(input: {
  reopenCooldownSeconds?: number | undefined;
}): MonitorCriteriaInstance {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  criteria.data = {
    id: CRITERIA_ID,
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [],
    incidents: [
      {
        id: INCIDENT_TEMPLATE_ID,
        title: "Down",
        description: "It is down.",
        incidentSeverityId: ObjectID.generate(),
        autoResolveIncident: true,
      },
    ],
    alerts: [
      {
        id: ALERT_TEMPLATE_ID,
        title: "Down",
        description: "It is down.",
        alertSeverityId: ObjectID.generate(),
        autoResolveAlert: true,
      },
    ],
    name: "Down",
    description: "Fires when down.",
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    isEnabled: true,
    reopenCooldownSeconds: input.reopenCooldownSeconds,
  };
  return criteria;
}

function buildOpenIncident(fingerprint: string | undefined): Incident {
  const incident: Incident = new Incident();
  incident._id = ObjectID.generate().toString();
  incident.projectId = PROJECT_ID;
  incident.title = "Down";
  incident.createdCriteriaId = CRITERIA_ID;
  incident.createdIncidentTemplateId = INCIDENT_TEMPLATE_ID;
  if (fingerprint) {
    incident.seriesFingerprint = fingerprint;
  }
  return incident;
}

function buildOpenAlert(fingerprint: string | undefined): Alert {
  const alert: Alert = new Alert();
  alert._id = ObjectID.generate().toString();
  alert.projectId = PROJECT_ID;
  alert.title = "Down";
  alert.createdCriteriaId = CRITERIA_ID;
  if (fingerprint) {
    alert.seriesFingerprint = fingerprint;
  }
  return alert;
}

function match(fingerprint: string): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: CRITERIA_ID,
    fingerprint,
    labels: {},
    rootCause: `Series ${fingerprint} is breaching.`,
  };
}

/** One breaching evaluation tick against the incident + alert paths. */
async function runCreateTick(input: {
  monitor: Monitor;
  criteria: MonitorCriteriaInstance;
  matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
}): Promise<void> {
  incidentFindByMock.mockResolvedValue([]);
  alertFindByMock.mockResolvedValue([]);

  const gate: HysteresisCreationGate =
    await MonitorHysteresis.evaluateCreationGateForMatchedCriteria({
      monitorId: input.monitor.id!,
      criteriaInstance: input.criteria,
      matchedFingerprints: input.matchesPerSeries?.map(
        (seriesMatch: PerSeriesCriteriaMatch) => {
          return seriesMatch.fingerprint;
        },
      ),
    });

  await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
    criteriaInstance: input.criteria,
    monitor: input.monitor,
    dataToProcess,
    rootCause: "Breaching.",
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
    props: {},
    matchesPerSeries: input.matchesPerSeries,
    hysteresisCreationGate: gate,
  });

  await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
    criteriaInstance: input.criteria,
    monitor: input.monitor,
    dataToProcess,
    rootCause: "Breaching.",
    autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
    props: {},
    matchesPerSeries: input.matchesPerSeries,
    hysteresisCreationGate: gate,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheStore.clear();
  wireCacheMocksToStore();

  incidentResolvedStateMock.mockResolvedValue(ObjectID.generate());
  incidentTimelineCreateMock.mockResolvedValue(undefined);
  incidentCreateMock.mockImplementation(
    (args: { data: Incident }): Promise<Incident> => {
      return Promise.resolve(args.data);
    },
  );

  alertResolvedStateMock.mockResolvedValue(ObjectID.generate());
  alertTimelineCreateMock.mockResolvedValue(undefined);
  alertCreateMock.mockImplementation(
    (args: { data: Alert }): Promise<Alert> => {
      return Promise.resolve(args.data);
    },
  );
});

describe("Reopen cooldown — armed on auto-resolve", () => {
  it("incident auto-resolve writes the cooldown key with TTL = reopenCooldownSeconds, and resolution is not delayed", async () => {
    const monitor: Monitor = buildMonitor();
    const openIncident: Incident = buildOpenIncident(undefined);
    incidentFindByMock.mockResolvedValue([openIncident]);

    await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
      monitorId: monitor.id!,
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
        [CRITERIA_ID]: [INCIDENT_TEMPLATE_ID],
      },
      rootCause: "Recovered.",
      criteriaInstance: null, // no criteria met — the healthy tick
      dataToProcess,
      reopenCooldownSecondsByCriteriaId: {
        [CRITERIA_ID]: COOLDOWN_SECONDS,
      },
    });

    // Resolution happened immediately — never delayed by hysteresis.
    expect(incidentTimelineCreateMock).toHaveBeenCalledTimes(1);

    const entry: CacheEntry | undefined = cacheStore.get(
      cooldownStoreKey(monitor, "_"),
    );
    expect(entry).toBeDefined();
    expect(entry?.expiresInSeconds).toBe(COOLDOWN_SECONDS);
  });

  it("alert auto-resolve writes the cooldown key with TTL = reopenCooldownSeconds", async () => {
    const monitor: Monitor = buildMonitor();
    const openAlert: Alert = buildOpenAlert(undefined);
    alertFindByMock.mockResolvedValue([openAlert]);

    await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
      monitorId: monitor.id!,
      autoResolveCriteriaInstanceIdAlertIdsDictionary: {
        [CRITERIA_ID]: [ALERT_TEMPLATE_ID],
      },
      rootCause: "Recovered.",
      criteriaInstance: null,
      dataToProcess,
      reopenCooldownSecondsByCriteriaId: {
        [CRITERIA_ID]: COOLDOWN_SECONDS,
      },
    });

    expect(alertTimelineCreateMock).toHaveBeenCalledTimes(1);

    const entry: CacheEntry | undefined = cacheStore.get(
      cooldownStoreKey(monitor, "_"),
    );
    expect(entry).toBeDefined();
    expect(entry?.expiresInSeconds).toBe(COOLDOWN_SECONDS);
  });

  it("per-series auto-resolve arms the cooldown for the resolved fingerprint", async () => {
    const monitor: Monitor = buildMonitor();
    const openIncident: Incident = buildOpenIncident("fp-A");
    incidentFindByMock.mockResolvedValue([openIncident]);

    await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
      monitorId: monitor.id!,
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
        [CRITERIA_ID]: [INCIDENT_TEMPLATE_ID],
      },
      rootCause: "Series recovered.",
      criteriaInstance: buildCriteria({
        reopenCooldownSeconds: COOLDOWN_SECONDS,
      }),
      dataToProcess,
      // fp-A is no longer breaching on this tick.
      breachingSeriesFingerprints: new Set<string>(),
      reopenCooldownSecondsByCriteriaId: {
        [CRITERIA_ID]: COOLDOWN_SECONDS,
      },
    });

    expect(incidentTimelineCreateMock).toHaveBeenCalledTimes(1);
    expect(cacheStore.has(cooldownStoreKey(monitor, "fp-A"))).toBe(true);
  });

  it("no cooldown configured: auto-resolve writes nothing to the cache", async () => {
    const monitor: Monitor = buildMonitor();
    const openIncident: Incident = buildOpenIncident(undefined);
    incidentFindByMock.mockResolvedValue([openIncident]);

    await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
      monitorId: monitor.id!,
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
        [CRITERIA_ID]: [INCIDENT_TEMPLATE_ID],
      },
      rootCause: "Recovered.",
      criteriaInstance: null,
      dataToProcess,
      reopenCooldownSecondsByCriteriaId: {},
    });

    expect(incidentTimelineCreateMock).toHaveBeenCalledTimes(1);
    expect(cacheSetStringMock).not.toHaveBeenCalled();
  });
});

describe("Reopen cooldown — creation gating", () => {
  it("blocks incident/alert re-creation inside the window and allows it after expiry", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      reopenCooldownSeconds: COOLDOWN_SECONDS,
    });

    // Cooldown is active (as if an auto-resolve just happened).
    cacheStore.set(cooldownStoreKey(monitor, "_"), {
      value: "1",
      expiresInSeconds: COOLDOWN_SECONDS,
    });

    await runCreateTick({ monitor, criteria });
    expect(incidentCreateMock).not.toHaveBeenCalled();
    expect(alertCreateMock).not.toHaveBeenCalled();

    // TTL expiry — Redis would drop the key.
    cacheStore.delete(cooldownStoreKey(monitor, "_"));

    await runCreateTick({ monitor, criteria });
    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    expect(alertCreateMock).toHaveBeenCalledTimes(1);
  });

  it("per-series: cooldown for one fingerprint does not block other fingerprints", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      reopenCooldownSeconds: COOLDOWN_SECONDS,
    });

    cacheStore.set(cooldownStoreKey(monitor, "fp-A"), {
      value: "1",
      expiresInSeconds: COOLDOWN_SECONDS,
    });

    await runCreateTick({
      monitor,
      criteria,
      matchesPerSeries: [match("fp-A"), match("fp-B")],
    });

    const createdFingerprints: Array<string | undefined> =
      incidentCreateMock.mock.calls.map((call: Array<{ data: Incident }>) => {
        return call[0]!.data.seriesFingerprint || undefined;
      });

    expect(createdFingerprints).toEqual(["fp-B"]);
  });

  it("cooldown read failure fails open for the whole batch: creation proceeds", async () => {
    cacheGetStringsMock.mockRejectedValue(new Error("redis down"));

    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      reopenCooldownSeconds: COOLDOWN_SECONDS,
    });

    await runCreateTick({ monitor, criteria });

    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    expect(alertCreateMock).toHaveBeenCalledTimes(1);
  });

  it("cooldown write failure on auto-resolve never fails the resolve", async () => {
    cacheSetStringMock.mockRejectedValue(new Error("redis down"));

    const monitor: Monitor = buildMonitor();
    const openIncident: Incident = buildOpenIncident(undefined);
    incidentFindByMock.mockResolvedValue([openIncident]);

    await expect(
      MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
        monitorId: monitor.id!,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
          [CRITERIA_ID]: [INCIDENT_TEMPLATE_ID],
        },
        rootCause: "Recovered.",
        criteriaInstance: null,
        dataToProcess,
        reopenCooldownSecondsByCriteriaId: {
          [CRITERIA_ID]: COOLDOWN_SECONDS,
        },
      }),
    ).resolves.toBeDefined();

    expect(incidentTimelineCreateMock).toHaveBeenCalledTimes(1);
  });

  it("webhook per-key resolution (resolveSeriesIncidentsByFingerprint) also arms the cooldown", async () => {
    const monitor: Monitor = buildMonitor();
    const openIncident: Incident = buildOpenIncident("fp-A");
    incidentFindByMock.mockResolvedValue([openIncident]);

    await MonitorIncident.resolveSeriesIncidentsByFingerprint({
      monitor,
      fingerprints: ["fp-A"],
      rootCause: "Payload reported resolved.",
      dataToProcess,
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
        [CRITERIA_ID]: [INCIDENT_TEMPLATE_ID],
      },
      reopenCooldownSecondsByCriteriaId: {
        [CRITERIA_ID]: COOLDOWN_SECONDS,
      },
    });

    expect(incidentTimelineCreateMock).toHaveBeenCalledTimes(1);
    expect(cacheStore.has(cooldownStoreKey(monitor, "fp-A"))).toBe(true);
  });
});

describe("Reopen cooldown — batched reads (one MGET round trip per tick)", () => {
  it("N matched fingerprints are checked with ONE getStrings call (no per-fingerprint getString)", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      reopenCooldownSeconds: COOLDOWN_SECONDS,
    });

    // fp-B is in cooldown; fp-A and fp-C are not.
    cacheStore.set(cooldownStoreKey(monitor, "fp-B"), {
      value: "1",
      expiresInSeconds: COOLDOWN_SECONDS,
    });

    await runCreateTick({
      monitor,
      criteria,
      matchesPerSeries: [match("fp-A"), match("fp-B"), match("fp-C")],
    });

    // ONE batch call carrying all three cooldown keys, in order.
    expect(cacheGetStringsMock).toHaveBeenCalledTimes(1);
    expect(cacheGetStringMock).not.toHaveBeenCalled();

    const batchedKeys: Array<string> = cacheGetStringsMock.mock
      .calls[0]![1] as Array<string>;
    expect(batchedKeys).toHaveLength(3);
    expect(batchedKeys[0]).toContain(":fp-A");
    expect(batchedKeys[1]).toContain(":fp-B");
    expect(batchedKeys[2]).toContain(":fp-C");

    // Suppression is applied per index: only fp-B is blocked.
    const createdFingerprints: Array<string | undefined> =
      incidentCreateMock.mock.calls.map((call: Array<{ data: Incident }>) => {
        return call[0]!.data.seriesFingerprint || undefined;
      });
    expect(createdFingerprints).toEqual(["fp-A", "fp-C"]);
  });

  it("batch failure fails open for EVERY fingerprint in the batch", async () => {
    cacheGetStringsMock.mockRejectedValue(new Error("redis down"));

    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      reopenCooldownSeconds: COOLDOWN_SECONDS,
    });

    await runCreateTick({
      monitor,
      criteria,
      matchesPerSeries: [match("fp-A"), match("fp-B"), match("fp-C")],
    });

    const createdFingerprints: Array<string | undefined> =
      incidentCreateMock.mock.calls.map((call: Array<{ data: Incident }>) => {
        return call[0]!.data.seriesFingerprint || undefined;
      });
    expect(createdFingerprints).toEqual(["fp-A", "fp-B", "fp-C"]);
  });

  it("no cooldown configured: getStrings is never called", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({});

    await runCreateTick({
      monitor,
      criteria,
      matchesPerSeries: [match("fp-A"), match("fp-B")],
    });

    expect(cacheGetStringsMock).not.toHaveBeenCalled();
    expect(cacheGetStringMock).not.toHaveBeenCalled();
  });
});
