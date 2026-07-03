import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorHysteresis, {
  BreachCounterTtlInSeconds,
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
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";

/*
 * Alert hysteresis — consecutive-breach threshold (minimumBreachedEvaluations)
 * gating of incident/alert CREATION.
 *
 * The gate is computed once per evaluation tick (as MonitorResource does)
 * and passed into the incident/alert create paths. These tests simulate
 * ticks by re-running exactly that sequence against a mocked GlobalCache
 * (in-memory map).
 *
 * Covered here:
 *  - threshold 3: ticks 1-2 create nothing, tick 3 creates (incident +
 *    alert paths, sharing ONE gate per tick like production).
 *  - a healthy (non-matching) tick resets the counter.
 *  - per-series counters are independent per fingerprint, and a series
 *    absent from a tick's matches has its counter reset.
 *  - null/undefined/1 settings are byte-identical to current behavior
 *    (create on first tick, ZERO cache calls).
 *  - cache failures fail open to current behavior.
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

// In-memory stand-in for Redis. Key format mirrors GlobalCache: `${namespace}-${key}`.
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

function buildCriteria(input: {
  minimumBreachedEvaluations?: number | undefined;
  reopenCooldownSeconds?: number | undefined;
  id?: string | undefined;
  filters?: Array<CriteriaFilter> | undefined;
}): MonitorCriteriaInstance {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  criteria.data = {
    id: input.id || CRITERIA_ID,
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: input.filters || [],
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
    minimumBreachedEvaluations: input.minimumBreachedEvaluations,
    reopenCooldownSeconds: input.reopenCooldownSeconds,
  };
  return criteria;
}

function match(fingerprint: string): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: CRITERIA_ID,
    fingerprint,
    labels: {},
    rootCause: `Series ${fingerprint} is breaching.`,
  };
}

/**
 * One evaluation tick, wired the way MonitorResource wires it: the gate
 * is computed ONCE and shared by the incident and alert create paths.
 */
async function runTick(input: {
  monitor: Monitor;
  criteria: MonitorCriteriaInstance;
  matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
  openIncidents?: Array<Incident> | undefined;
  openAlerts?: Array<Alert> | undefined;
  isEventDriven?: boolean | undefined;
  evaluationCadenceSeconds?: number | undefined;
}): Promise<HysteresisCreationGate> {
  incidentFindByMock.mockResolvedValue(input.openIncidents || []);
  alertFindByMock.mockResolvedValue(input.openAlerts || []);

  const gate: HysteresisCreationGate =
    await MonitorHysteresis.evaluateCreationGateForMatchedCriteria({
      monitorId: input.monitor.id!,
      criteriaInstance: input.criteria,
      matchedFingerprints: input.matchesPerSeries?.map(
        (seriesMatch: PerSeriesCriteriaMatch) => {
          return seriesMatch.fingerprint;
        },
      ),
      isEventDriven: input.isEventDriven,
      evaluationCadenceSeconds: input.evaluationCadenceSeconds,
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

  return gate;
}

/** A healthy tick: the criteria did not match, so its counter resets. */
async function runHealthyTick(input: {
  monitor: Monitor;
  criteria: MonitorCriteriaInstance;
}): Promise<void> {
  await MonitorHysteresis.resetBreachCountersForUnmatchedCriteria({
    monitorId: input.monitor.id!,
    criteriaInstances: [input.criteria],
    matchedCriteriaId: undefined,
  });
}

function createdIncidentFingerprints(): Array<string | undefined> {
  return incidentCreateMock.mock.calls.map(
    (call: Array<{ data: Incident }>) => {
      return call[0]!.data.seriesFingerprint || undefined;
    },
  );
}

function createdAlertFingerprints(): Array<string | undefined> {
  return alertCreateMock.mock.calls.map((call: Array<{ data: Alert }>) => {
    return call[0]!.data.seriesFingerprint || undefined;
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

describe("Hysteresis threshold — legacy (non-series) path", () => {
  it("threshold 3: ticks 1 and 2 create no incident/alert, tick 3 creates both", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 3,
    });

    await runTick({ monitor, criteria }); // tick 1
    expect(incidentCreateMock).not.toHaveBeenCalled();
    expect(alertCreateMock).not.toHaveBeenCalled();

    await runTick({ monitor, criteria }); // tick 2
    expect(incidentCreateMock).not.toHaveBeenCalled();
    expect(alertCreateMock).not.toHaveBeenCalled();

    await runTick({ monitor, criteria }); // tick 3 — threshold reached
    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    expect(alertCreateMock).toHaveBeenCalledTimes(1);
  });

  it("counter increments once per tick even though incident AND alert paths share the gate", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });

    await runTick({ monitor, criteria }); // tick 1: count 1 — suppressed
    expect(incidentCreateMock).not.toHaveBeenCalled();
    expect(alertCreateMock).not.toHaveBeenCalled();

    // The stored counter must be exactly 1 (not 2 — one increment per tick).
    const counterEntry: CacheEntry | undefined = cacheStore.get(
      `monitor-hysteresis-${monitor.id!.toString()}:${CRITERIA_ID}`,
    );
    expect((counterEntry?.value as JSONObject)?.["_"]).toBe(1);
  });

  it("a healthy (non-matching) tick resets the counter", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 3,
    });

    await runTick({ monitor, criteria }); // breach tick 1 (count 1)
    await runTick({ monitor, criteria }); // breach tick 2 (count 2)
    await runHealthyTick({ monitor, criteria }); // healthy — reset

    await runTick({ monitor, criteria }); // breach again (count 1)
    await runTick({ monitor, criteria }); // count 2
    expect(incidentCreateMock).not.toHaveBeenCalled();
    expect(alertCreateMock).not.toHaveBeenCalled();

    await runTick({ monitor, criteria }); // count 3 — creates now
    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    expect(alertCreateMock).toHaveBeenCalledTimes(1);
  });

  it("counter TTL is set comfortably above evaluation cadence (15 minutes)", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });

    await runTick({ monitor, criteria });

    const counterEntry: CacheEntry | undefined = cacheStore.get(
      `monitor-hysteresis-${monitor.id!.toString()}:${CRITERIA_ID}`,
    );
    expect(counterEntry?.expiresInSeconds).toBe(15 * 60);
  });
});

describe("Hysteresis threshold — per-series (fingerprint-grouped) path", () => {
  it("counters are independent per fingerprint", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });

    // Tick 1: only fp-A breaches. count(fp-A)=1 — nothing created.
    await runTick({ monitor, criteria, matchesPerSeries: [match("fp-A")] });
    expect(incidentCreateMock).not.toHaveBeenCalled();

    // Tick 2: fp-A and fp-B breach. count(fp-A)=2 → create; count(fp-B)=1 → suppressed.
    await runTick({
      monitor,
      criteria,
      matchesPerSeries: [match("fp-A"), match("fp-B")],
    });
    expect(createdIncidentFingerprints()).toEqual(["fp-A"]);
    expect(createdAlertFingerprints()).toEqual(["fp-A"]);

    // Tick 3: both breach again. count(fp-B)=2 → fp-B creates now.
    await runTick({
      monitor,
      criteria,
      matchesPerSeries: [match("fp-A"), match("fp-B")],
    });
    expect(createdIncidentFingerprints()).toEqual(["fp-A", "fp-A", "fp-B"]);
    expect(createdAlertFingerprints()).toEqual(["fp-A", "fp-A", "fp-B"]);
  });

  it("a series absent from a tick's matches has its counter reset even though the criteria still matched", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });

    // Tick 1: fp-C breaches. count(fp-C)=1.
    await runTick({ monitor, criteria, matchesPerSeries: [match("fp-C")] });

    // Tick 2: fp-C recovered, fp-A breaches — fp-C's counter is dropped.
    await runTick({ monitor, criteria, matchesPerSeries: [match("fp-A")] });

    // Tick 3: fp-C breaches again — back to count 1, still suppressed.
    await runTick({ monitor, criteria, matchesPerSeries: [match("fp-C")] });
    expect(createdIncidentFingerprints()).not.toContain("fp-C");

    // Tick 4: fp-C count 2 — creates now.
    await runTick({ monitor, criteria, matchesPerSeries: [match("fp-C")] });
    expect(createdIncidentFingerprints()).toContain("fp-C");
  });
});

describe("Hysteresis disabled — byte-identical to current behavior", () => {
  it("no settings: creates on the first tick and performs ZERO cache operations", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({});

    await runTick({ monitor, criteria });

    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    expect(alertCreateMock).toHaveBeenCalledTimes(1);

    expect(cacheGetJSONObjectMock).not.toHaveBeenCalled();
    expect(cacheSetJSONMock).not.toHaveBeenCalled();
    expect(cacheGetStringMock).not.toHaveBeenCalled();
    expect(cacheGetStringsMock).not.toHaveBeenCalled();
    expect(cacheSetStringMock).not.toHaveBeenCalled();
    expect(cacheDeleteKeyMock).not.toHaveBeenCalled();
  });

  it("threshold of 1 behaves exactly like no setting (create immediately, no cache traffic)", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 1,
    });

    await runTick({ monitor, criteria });

    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    expect(alertCreateMock).toHaveBeenCalledTimes(1);
    expect(cacheGetJSONObjectMock).not.toHaveBeenCalled();
    expect(cacheSetJSONMock).not.toHaveBeenCalled();
  });

  it("healthy-tick reset performs no cache operations when the criteria has no threshold", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({});

    await runHealthyTick({ monitor, criteria });

    expect(cacheDeleteKeyMock).not.toHaveBeenCalled();
  });
});

describe("Hysteresis — event-driven (grouped webhook) monitors", () => {
  it("a webhook tick for one key does NOT wipe other keys' counters (partial-key persistence)", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });

    // Webhook 1: key-A fires. count(key-A)=1 — suppressed.
    await runTick({
      monitor,
      criteria,
      matchesPerSeries: [match("key-A")],
      isEventDriven: true,
    });
    expect(incidentCreateMock).not.toHaveBeenCalled();

    // Webhook 2: a DIFFERENT key fires. key-A's counter must survive.
    await runTick({
      monitor,
      criteria,
      matchesPerSeries: [match("key-B")],
      isEventDriven: true,
    });

    const counterEntry: CacheEntry | undefined = cacheStore.get(
      `monitor-hysteresis-${monitor.id!.toString()}:${CRITERIA_ID}`,
    );
    expect((counterEntry?.value as JSONObject)?.["key-A"]).toBe(1);
    expect((counterEntry?.value as JSONObject)?.["key-B"]).toBe(1);

    // Webhook 3: key-A fires again — count 2, threshold reached.
    await runTick({
      monitor,
      criteria,
      matchesPerSeries: [match("key-A")],
      isEventDriven: true,
    });
    expect(createdIncidentFingerprints()).toContain("key-A");
    expect(createdAlertFingerprints()).toContain("key-A");
  });

  it("snapshot (non-event-driven) monitors keep the reset-by-absence rule", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });

    await runTick({ monitor, criteria, matchesPerSeries: [match("fp-A")] });
    await runTick({ monitor, criteria, matchesPerSeries: [match("fp-B")] });

    const counterEntry: CacheEntry | undefined = cacheStore.get(
      `monitor-hysteresis-${monitor.id!.toString()}:${CRITERIA_ID}`,
    );
    // fp-A was absent from tick 2 → dropped; fp-B is the only counter.
    expect((counterEntry?.value as JSONObject)?.["fp-A"]).toBeUndefined();
    expect((counterEntry?.value as JSONObject)?.["fp-B"]).toBe(1);
  });
});

describe("Hysteresis — counter TTL scales with the monitor's cadence", () => {
  it("30-minute probe cadence: TTL = 2 * cadence + 300 (not the 15-minute floor)", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });

    await runTick({ monitor, criteria, evaluationCadenceSeconds: 30 * 60 });

    const counterEntry: CacheEntry | undefined = cacheStore.get(
      `monitor-hysteresis-${monitor.id!.toString()}:${CRITERIA_ID}`,
    );
    expect(counterEntry?.expiresInSeconds).toBe(2 * 30 * 60 + 300);
  });

  it("fast cadence (1 minute) keeps the 15-minute floor", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });

    await runTick({ monitor, criteria, evaluationCadenceSeconds: 60 });

    const counterEntry: CacheEntry | undefined = cacheStore.get(
      `monitor-hysteresis-${monitor.id!.toString()}:${CRITERIA_ID}`,
    );
    expect(counterEntry?.expiresInSeconds).toBe(BreachCounterTtlInSeconds);
  });

  it("maps the dashboard monitoringInterval cron strings to seconds (unknown → undefined → floor)", () => {
    expect(
      MonitorHysteresis.getEvaluationCadenceSecondsFromMonitoringInterval(
        "* * * * *",
      ),
    ).toBe(60);
    expect(
      MonitorHysteresis.getEvaluationCadenceSecondsFromMonitoringInterval(
        "*/30 * * * *",
      ),
    ).toBe(30 * 60);
    expect(
      MonitorHysteresis.getEvaluationCadenceSecondsFromMonitoringInterval(
        "0 * * * *",
      ),
    ).toBe(60 * 60);
    expect(
      MonitorHysteresis.getEvaluationCadenceSecondsFromMonitoringInterval(
        "0 0 * * *",
      ),
    ).toBe(24 * 60 * 60);
    expect(
      MonitorHysteresis.getEvaluationCadenceSecondsFromMonitoringInterval(
        "0 0 * * 0",
      ),
    ).toBe(7 * 24 * 60 * 60);
    expect(
      MonitorHysteresis.getEvaluationCadenceSecondsFromMonitoringInterval(
        undefined,
      ),
    ).toBeUndefined();
    expect(
      MonitorHysteresis.getEvaluationCadenceSecondsFromMonitoringInterval(
        "not-a-known-interval",
      ),
    ).toBeUndefined();

    expect(MonitorHysteresis.getBreachCounterTtlInSeconds(undefined)).toBe(
      BreachCounterTtlInSeconds,
    );
    expect(
      MonitorHysteresis.getBreachCounterTtlInSeconds(7 * 24 * 60 * 60),
    ).toBe(2 * 7 * 24 * 60 * 60 + 300);
  });

  it("weekly cadence: threshold 2 is reachable because the counter survives between ticks", async () => {
    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 2,
    });
    const weeklyCadence: number = 7 * 24 * 60 * 60;

    await runTick({
      monitor,
      criteria,
      evaluationCadenceSeconds: weeklyCadence,
    });
    expect(incidentCreateMock).not.toHaveBeenCalled();

    // The stored TTL must outlive the cadence (this is what finding 2 broke).
    const counterEntry: CacheEntry | undefined = cacheStore.get(
      `monitor-hysteresis-${monitor.id!.toString()}:${CRITERIA_ID}`,
    );
    expect(counterEntry!.expiresInSeconds!).toBeGreaterThan(weeklyCadence);

    await runTick({
      monitor,
      criteria,
      evaluationCadenceSeconds: weeklyCadence,
    });
    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
  });
});

describe("Hysteresis — ServerMonitor heartbeat-only cron ticks", () => {
  it("filterCriteriaResettableOnServerHeartbeatOnlyTick keeps IsOnline criteria and drops resource-only criteria", () => {
    const onlineCriteria: MonitorCriteriaInstance = buildCriteria({
      id: "online-criteria",
      minimumBreachedEvaluations: 2,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ],
    });

    const cpuCriteria: MonitorCriteriaInstance = buildCriteria({
      id: "cpu-criteria",
      minimumBreachedEvaluations: 2,
      filters: [
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
        },
      ],
    });

    const filtered: Array<MonitorCriteriaInstance> =
      MonitorHysteresis.filterCriteriaResettableOnServerHeartbeatOnlyTick([
        onlineCriteria,
        cpuCriteria,
      ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.data?.id).toBe("online-criteria");
  });

  it("heartbeat-only reset wipes only IsOnline criteria counters; resource criteria counters survive", async () => {
    const monitor: Monitor = buildMonitor();

    const onlineCriteria: MonitorCriteriaInstance = buildCriteria({
      id: "online-criteria",
      minimumBreachedEvaluations: 2,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ],
    });

    const cpuCriteria: MonitorCriteriaInstance = buildCriteria({
      id: "cpu-criteria",
      minimumBreachedEvaluations: 2,
      filters: [
        {
          checkOn: CheckOn.CPUUsagePercent,
          filterType: FilterType.GreaterThan,
          value: 90,
        },
      ],
    });

    // Both criteria have an in-flight consecutive count of 1.
    cacheStore.set(
      `monitor-hysteresis-${monitor.id!.toString()}:online-criteria`,
      { value: { _: 1 } },
    );
    cacheStore.set(
      `monitor-hysteresis-${monitor.id!.toString()}:cpu-criteria`,
      { value: { _: 1 } },
    );

    /*
     * Heartbeat-only cron tick: only IsOnline criteria are resettable
     * (this mirrors what MonitorResource passes on such ticks).
     */
    await MonitorHysteresis.resetBreachCountersForUnmatchedCriteria({
      monitorId: monitor.id!,
      criteriaInstances:
        MonitorHysteresis.filterCriteriaResettableOnServerHeartbeatOnlyTick([
          onlineCriteria,
          cpuCriteria,
        ]),
      matchedCriteriaId: undefined,
    });

    expect(
      cacheStore.has(
        `monitor-hysteresis-${monitor.id!.toString()}:online-criteria`,
      ),
    ).toBe(false);
    expect(
      cacheStore.has(
        `monitor-hysteresis-${monitor.id!.toString()}:cpu-criteria`,
      ),
    ).toBe(true);
  });
});

describe("Hysteresis cache failures — fail open to current behavior", () => {
  it("counter READ failure: incident and alert are created on the first tick despite threshold 3", async () => {
    cacheGetJSONObjectMock.mockRejectedValue(new Error("redis down"));

    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 3,
    });

    await runTick({ monitor, criteria });

    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    expect(alertCreateMock).toHaveBeenCalledTimes(1);
  });

  it("counter WRITE failure: fails open (creates immediately) instead of suppressing on unpersisted state", async () => {
    cacheSetJSONMock.mockRejectedValue(new Error("redis down"));

    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 3,
    });

    await runTick({ monitor, criteria });

    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    expect(alertCreateMock).toHaveBeenCalledTimes(1);
  });

  it("reset failure never throws out of the evaluation path", async () => {
    cacheDeleteKeyMock.mockRejectedValue(new Error("redis down"));

    const monitor: Monitor = buildMonitor();
    const criteria: MonitorCriteriaInstance = buildCriteria({
      minimumBreachedEvaluations: 3,
    });

    await expect(runHealthyTick({ monitor, criteria })).resolves.not.toThrow();
  });
});
