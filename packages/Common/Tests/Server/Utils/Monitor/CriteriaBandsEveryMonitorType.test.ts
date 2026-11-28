/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "../../../../Models/DatabaseModels/MonitorTemplate";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorResourceUtil, {
  SeriesClaims,
} from "../../../../Server/Utils/Monitor/MonitorResource";
import { MonitorRecordKind } from "../../../../Server/Utils/Monitor/MonitorOpenRecords";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import MetricAliasData from "../../../../Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor from "../../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor from "../../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../../Types/Monitor/MonitorType";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import {
  NetworkDeviceTransceiver,
  TransceiverHealth,
  TransceiverReadingKind,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import NetworkAlertPolicyBootstrapUtil from "../../../../Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import {
  MonitorRecordTables,
  isOpenAlert,
  isOpenIncident,
  mockMonitorRecordTables,
} from "../../TestingUtils/MonitorRecordTables";
import { mockMonitorStatusTimelineRows } from "../../TestingUtils/MonitorStatusTimelineRows";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * CRITERIA THAT CHECK DIFFERENT THINGS EACH OPEN THEIR OWN, ON EVERY MONITOR
 * THAT JUDGES EACH SERIES ON ITS OWN (OneUptime issue #11349).
 *
 * A monitor grouped by an attribute, written in PromQL, or with "*" for
 * every disk, port or table row judges every criteria on every check, so
 * several can match one series - a host, a disk, a port, a row, or the whole
 * device for a criteria that names none of them. The first criteria that
 * matched a series used to claim it for itself, whatever it checked: on a
 * network device monitor made from the recommended alert pack, Interface
 * saturated and Interface errors on the same poll opened only the
 * saturation alert, and a hot CPU kept a host's full memory from alerting.
 *
 * Now only bands of one another share a series (CriteriaBands): criteria
 * that read the same measurements and differ only in their lines - warning
 * and critical of one metric. A series in two bands gets one record, from
 * the first band that matches, and the evaluation log says which band the
 * lower one left the series to. Every other criteria opens its own, and
 * each resolves on its own when its criteria stops matching.
 *
 * On every kind of monitor that claims series: a Network Device monitor
 * (the recommended pack, whole-device and per port), a Server monitor with
 * a "*" disk, every metric-backed type grouped by host, and Logs and Traces
 * monitors grouped by a service. An Incoming Request monitor acts on its
 * first match only, so no two of its criteria share a key on one request.
 * Each check goes through MonitorResourceUtil.monitorResource - the real
 * evaluator, the real creators and resolve pass - with the incidents, alerts
 * and status timeline kept in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11349aaa-0001-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11349aaa-0002-4000-8000-000000000002",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "11349aaa-0003-4000-8000-000000000003",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "11349aaa-0004-4000-8000-000000000004",
);
const STEP_ID: ObjectID = new ObjectID("11349aaa-0005-4000-8000-000000000005");

function monitorStatus(
  id: string,
  name: string,
  priority: number,
): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(id);
  status.name = name;
  status.priority = priority;
  return status;
}

const ONLINE: MonitorStatus = monitorStatus(
  "11349aaa-0006-4000-8000-000000000006",
  "Online",
  1,
);
const OFFLINE: MonitorStatus = monitorStatus(
  "11349aaa-0007-4000-8000-000000000007",
  "Offline",
  3,
);

const START: Date = new Date("2026-11-27T09:00:00.000Z");
const CHECK_EVERY_MINUTES: number = 5;

interface CriteriaSpec {
  id: string;
  name: string;
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition | undefined;
  status?: MonitorStatus | undefined;
  incident?: boolean | undefined;
  alert?: boolean | undefined;
}

function criteria(spec: CriteriaSpec): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: spec.id,
    name: spec.name,
    description: "",
    monitorStatusId: spec.status?.id || undefined,
    filterCondition: spec.filterCondition || FilterCondition.All,
    filters: spec.filters,
    incidents: spec.incident
      ? [
          {
            id: `${spec.id}-incident`,
            title: spec.name,
            description: "",
            incidentSeverityId: INCIDENT_SEVERITY_ID,
            autoResolveIncident: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    alerts:
      spec.alert === false
        ? []
        : [
            {
              id: `${spec.id}-alert`,
              title: spec.name,
              description: "",
              alertSeverityId: ALERT_SEVERITY_ID,
              autoResolveAlert: true,
              onCallPolicyIds: [],
            },
          ],
    changeMonitorStatus: Boolean(spec.status),
    createIncidents: Boolean(spec.incident),
    createAlerts: spec.alert !== false,
    isEnabled: true,
  };

  return instance;
}

let tables: MonitorRecordTables;
let monitorUnderTest: Monitor;

function stepWith(
  criteriaInstances: Array<MonitorCriteriaInstance>,
): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.id = STEP_ID;
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: criteriaInstances,
  };
  step.data!.monitorCriteria = monitorCriteria;
  return step;
}

function watchSteps(input: {
  monitorType: MonitorType;
  monitorSteps: MonitorSteps;
}): void {
  monitorUnderTest = new Monitor();
  monitorUnderTest.id = MONITOR_ID;
  monitorUnderTest.projectId = PROJECT_ID;
  monitorUnderTest.name = "Acme";
  monitorUnderTest.monitorType = input.monitorType;
  monitorUnderTest.monitorSteps = input.monitorSteps;
  monitorUnderTest.currentMonitorStatusId = ONLINE.id!;
  // Measured long ago: nothing stamps it.
  monitorUnderTest.firstMeasuredAt = new Date("2026-01-01T00:00:00.000Z");

  tables = mockMonitorRecordTables({
    getMonitor: (): Monitor => {
      return monitorUnderTest;
    },
    projectId: PROJECT_ID,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    alertSeverityId: ALERT_SEVERITY_ID,
  });

  mockMonitorStatusTimelineRows({
    getMonitor: (): Monitor => {
      return monitorUnderTest;
    },
    projectId: PROJECT_ID,
    statuses: [ONLINE, OFFLINE],
  });

  // What a grouped monitor keeps between checks (SeriesBehindStatus).
  const redis: Map<string, string> = new Map<string, string>();

  jest
    .spyOn(GlobalCache, "getStringArray")
    .mockImplementation((namespace: string, key: string) => {
      const value: string | undefined = redis.get(`${namespace}-${key}`);
      return Promise.resolve(
        value === undefined ? null : (JSON.parse(value) as Array<string>),
      );
    });
  jest
    .spyOn(GlobalCache, "setStringArray")
    .mockImplementation(
      (namespace: string, key: string, value: Array<string>) => {
        redis.set(`${namespace}-${key}`, JSON.stringify(value));
        return Promise.resolve();
      },
    );
  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation((namespace: string, key: string) => {
      redis.delete(`${namespace}-${key}`);
      return Promise.resolve();
    });
}

function watch(input: { monitorType: MonitorType; step: MonitorStep }): void {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [input.step],
    defaultMonitorStatusId: ONLINE.id!,
  };

  watchSteps({ monitorType: input.monitorType, monitorSteps: monitorSteps });
}

async function check(
  dataToProcess: DataToProcess,
): Promise<ProbeApiIngestResponse> {
  jest.setSystemTime(
    OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      CHECK_EVERY_MINUTES,
    ),
  );

  return await MonitorResourceUtil.monitorResource(dataToProcess);
}

function status(): string {
  return monitorUnderTest.currentMonitorStatusId?.toString() ===
    OFFLINE.id!.toString()
    ? "Offline"
    : "Online";
}

function openAlerts(): Array<string> {
  return tables.alerts
    .filter(isOpenAlert)
    .map((alert: Alert) => {
      return alert.title || "";
    })
    .sort();
}

function openIncidents(): Array<string> {
  return tables.incidents
    .filter(isOpenIncident)
    .map((incident: Incident) => {
      return incident.title || "";
    })
    .sort();
}

// The open alerts, each as "criteria | series fingerprint".
function openAlertKeys(): Array<string> {
  return tables.alerts
    .filter(isOpenAlert)
    .map((alert: Alert) => {
      return `${alert.createdCriteriaId?.toString()}|${alert.seriesFingerprint || ""}`;
    })
    .sort();
}

function eventsOf(
  response: ProbeApiIngestResponse,
  type: MonitorEvaluationEvent["type"],
): Array<MonitorEvaluationEvent> {
  return (response.evaluationSummary?.events || []).filter(
    (event: MonitorEvaluationEvent): boolean => {
      return event.type === type;
    },
  );
}

function titlesOf(
  response: ProbeApiIngestResponse,
  type: MonitorEvaluationEvent["type"],
): Array<string> {
  return eventsOf(response, type)
    .map((event: MonitorEvaluationEvent): string => {
      return event.title;
    })
    .sort();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---- A network device: the recommended pack -----------------------------------

function port(input: {
  index: number;
  name: string;
  utilizationPercent?: number | undefined;
  errorsPerSecond?: number | undefined;
}): SnmpInterface {
  return {
    interfaceIndex: input.index,
    name: input.name,
    isAdministrativelyUp: true,
    isOperationallyUp: true,
    utilizationPercent: input.utilizationPercent ?? 12,
    errorsPerSecond: input.errorsPerSecond ?? 0,
  };
}

function uplinkOptic(isPastAlarm: boolean): NetworkDeviceTransceiver {
  return {
    interfaceIndex: 49,
    interfaceName: "Te1/1/1",
    isPresent: true,
    vendor: "FLEXOPTIX",
    serialNumber: "F1",
    measurements: {
      [TransceiverReadingKind.RxPower]: {
        readings: [{ value: isPastAlarm ? -21 : -4 }],
        thresholds: {
          lowAlarm: -18.4,
          lowWarning: -14.4,
          highWarning: 0.5,
          highAlarm: 2.5,
        },
      },
    },
    health: isPastAlarm ? TransceiverHealth.Alarm : TransceiverHealth.Healthy,
  };
}

/*
 * One poll of an access switch: two access ports and an uplink, with what
 * each reads, as the probe reports it.
 */
function devicePoll(
  input: {
    uplinkUtilizationPercent?: number | undefined;
    uplinkErrorsPerSecond?: number | undefined;
    accessUtilizationPercent?: number | undefined;
    accessErrorsPerSecond?: number | undefined;
    isOpticPastAlarm?: boolean | undefined;
  } = {},
): DataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    probeId: ObjectID.generate(),
    isOnline: true,
    failureCause: "",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    pingResponse: {
      packetsSent: 3,
      packetsReceived: 3,
      packetLossPercent: 0,
      avgRoundTripTimeInMs: 2,
      isReachable: true,
    },
    snmpResponse: {
      isOnline: true,
      responseTimeInMs: 12,
      failureCause: "",
      oidResponses: [],
      interfaces: [
        port({
          index: 1,
          name: "Gi1/0/1",
          utilizationPercent: input.accessUtilizationPercent,
          errorsPerSecond: input.accessErrorsPerSecond,
        }),
        port({ index: 2, name: "Gi1/0/2" }),
        port({
          index: 49,
          name: "Te1/1/1",
          utilizationPercent: input.uplinkUtilizationPercent,
          errorsPerSecond: input.uplinkErrorsPerSecond,
        }),
      ],
      transceivers: [uplinkOptic(Boolean(input.isOpticPastAlarm))],
      tables: [],
    },
  } as unknown as DataToProcess;
}

async function poll(
  dataToProcess: DataToProcess,
): Promise<ProbeApiIngestResponse> {
  return await check({
    ...dataToProcess,
    probeId: ObjectID.generate(),
    monitoredAt: OneUptimeDate.getCurrentDate(),
  } as DataToProcess);
}

// The recommended pack, as a policy's template carries it.
function recommendedPackSteps(): MonitorSteps {
  const template: MonitorTemplate =
    NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
      projectId: PROJECT_ID,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      alertSeverityId: ALERT_SEVERITY_ID,
      onlineMonitorStatusId: ONLINE.id!,
      offlineMonitorStatusId: OFFLINE.id!,
    });

  return template.monitorSteps!;
}

function packCriteria(
  monitorSteps: MonitorSteps,
): Array<MonitorCriteriaInstance> {
  return monitorSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria
    .data!.monitorCriteriaInstanceArray;
}

function portFilter(
  checkOn: CheckOn,
  above: number,
  interfaceName?: string | undefined,
): CriteriaFilter {
  return {
    checkOn: checkOn,
    filterType: FilterType.GreaterThan,
    value: above,
    ...(interfaceName ? { snmpMonitorOptions: { interfaceName } } : {}),
  };
}

describe("the recommended network device pack: each whole-device alert opens on its own (#11349)", () => {
  beforeEach(() => {
    watchSteps({
      monitorType: MonitorType.NetworkDevice,
      monitorSteps: recommendedPackSteps(),
    });
  });

  /*
   * THE REPORT. The uplink above 80% (Interface saturated) and logging
   * errors (Interface errors) on one poll: only the saturation alert opened,
   * and the errors alert waited until the uplink was quiet.
   */
  it("Interface saturated and Interface errors on one poll: both alerts open", async () => {
    await poll(devicePoll());

    await poll(
      devicePoll({ uplinkUtilizationPercent: 92, uplinkErrorsPerSecond: 40 }),
    );

    expect(openAlerts()).toEqual(["Interface errors", "Interface saturated"]);
    expect(openIncidents()).toEqual([]);
    expect(status()).toBe("Online");
  });

  it("they stay one alert each, poll after poll, never a new one per poll", async () => {
    for (let polls: number = 0; polls < 4; polls++) {
      await poll(
        devicePoll({ uplinkUtilizationPercent: 92, uplinkErrorsPerSecond: 40 }),
      );

      expect(openAlerts()).toEqual(["Interface errors", "Interface saturated"]);
    }

    expect(tables.alerts).toHaveLength(2);
  });

  it("each resolves on its own: the errors stop and the saturation alert stays, then the uplink is quiet", async () => {
    await poll(
      devicePoll({ uplinkUtilizationPercent: 92, uplinkErrorsPerSecond: 40 }),
    );

    await poll(devicePoll({ uplinkUtilizationPercent: 92 }));

    expect(openAlerts()).toEqual(["Interface saturated"]);

    await poll(devicePoll({ uplinkErrorsPerSecond: 40 }));

    // The errors are back as a new alert; the saturation one resolved.
    expect(openAlerts()).toEqual(["Interface errors"]);
    expect(tables.alerts).toHaveLength(3);

    await poll(devicePoll());

    expect(openAlerts()).toEqual([]);
  });

  it("the errors alert opens beside a saturation alert already open", async () => {
    await poll(devicePoll({ uplinkUtilizationPercent: 92 }));

    expect(openAlerts()).toEqual(["Interface saturated"]);

    const response: ProbeApiIngestResponse = await poll(
      devicePoll({ uplinkUtilizationPercent: 92, uplinkErrorsPerSecond: 40 }),
    );

    expect(openAlerts()).toEqual(["Interface errors", "Interface saturated"]);
    // Nothing was left to another criteria: they are no bands of each other.
    expect(
      eventsOf(response, "alert-skipped").filter(
        (event: MonitorEvaluationEvent): boolean => {
          return event.title.startsWith("Alert left to");
        },
      ),
    ).toEqual([]);
  });

  it("a whole-device alert beside the pack's per-port optic alert: both open", async () => {
    await poll(
      devicePoll({
        uplinkUtilizationPercent: 92,
        uplinkErrorsPerSecond: 40,
        isOpticPastAlarm: true,
      }),
    );

    expect(openAlerts()).toEqual([
      "Interface errors",
      "Interface saturated",
      "Transceiver past its alarm threshold - Interface: Te1/1/1",
    ]);
  });
});

describe("bands of one port's utilization on a network device: one alert, from the first (#11349)", () => {
  beforeEach(() => {
    const monitorSteps: MonitorSteps = recommendedPackSteps();
    const instances: Array<MonitorCriteriaInstance> =
      packCriteria(monitorSteps);

    // A critical band above the pack's 80%, listed first.
    const saturated: MonitorCriteriaInstance = instances.find(
      (instance: MonitorCriteriaInstance): boolean => {
        return instance.data?.name === "Interface saturated";
      },
    )!;

    instances.splice(
      instances.indexOf(saturated),
      0,
      criteria({
        id: "interface-saturated-critical",
        name: "Interface saturated (critical)",
        filters: [portFilter(CheckOn.SnmpInterfaceUtilizationPercent, 95)],
      }),
    );

    watchSteps({
      monitorType: MonitorType.NetworkDevice,
      monitorSteps: monitorSteps,
    });
  });

  it("the uplink at 97%: the critical band's alert only, and the log says the warning left it there", async () => {
    const response: ProbeApiIngestResponse = await poll(
      devicePoll({ uplinkUtilizationPercent: 97 }),
    );

    expect(openAlerts()).toEqual(["Interface saturated (critical)"]);

    const leftToCritical: Array<MonitorEvaluationEvent> = eventsOf(
      response,
      "alert-skipped",
    ).filter((event: MonitorEvaluationEvent): boolean => {
      return event.title === 'Alert left to "Interface saturated (critical)"';
    });

    expect(leftToCritical).toHaveLength(1);
    // The whole device is no series of its own: the event names none.
    expect(leftToCritical[0]!.seriesFingerprint).toBeUndefined();
    expect(leftToCritical[0]!.message).toBe(
      'Skipped creating an alert because "Interface saturated (critical)", listed before this criteria, checks the same thing and matched too. Two bands of one check open one alert, from the first.',
    );
    expect(leftToCritical[0]!.messageSentence?.template).toBe(
      'Skipped creating an alert because "{{criteria}}", listed before this criteria, checks the same thing and matched too. Two bands of one check open one alert, from the first.',
    );
  });

  it("at 85%: the pack's band alerts; errors beside it alert too", async () => {
    await poll(
      devicePoll({ uplinkUtilizationPercent: 85, uplinkErrorsPerSecond: 40 }),
    );

    expect(openAlerts()).toEqual(["Interface errors", "Interface saturated"]);
  });

  it("at 97% with errors: the critical band and the errors, one alert each", async () => {
    await poll(
      devicePoll({ uplinkUtilizationPercent: 97, uplinkErrorsPerSecond: 40 }),
    );

    expect(openAlerts()).toEqual([
      "Interface errors",
      "Interface saturated (critical)",
    ]);
  });
});

describe("per port on a network device: different checks of one port each alert, bands of one share it (#11349)", () => {
  beforeEach(() => {
    watch({
      monitorType: MonitorType.NetworkDevice,
      step: stepWith(
        [
          {
            id: "port-busy-critical",
            name: "Port busy (critical)",
            filters: [
              portFilter(CheckOn.SnmpInterfaceUtilizationPercent, 95, "*"),
            ],
          },
          {
            id: "port-busy",
            name: "Port busy",
            filters: [
              portFilter(CheckOn.SnmpInterfaceUtilizationPercent, 80, "*"),
            ],
          },
          {
            id: "port-erroring",
            name: "Port erroring",
            filters: [portFilter(CheckOn.SnmpInterfaceErrorsPerSecond, 1, "*")],
          },
        ].map(criteria),
      ),
    });
  });

  it("is judged per port", async () => {
    const response: ProbeApiIngestResponse = await poll(
      devicePoll({ uplinkUtilizationPercent: 85 }),
    );

    expect(response.perSeriesMatches).toBeDefined();
  });

  it("the uplink busy and erroring: two alerts for the port", async () => {
    await poll(
      devicePoll({ uplinkUtilizationPercent: 85, uplinkErrorsPerSecond: 40 }),
    );

    expect(openAlerts()).toEqual([
      "Port busy - Interface: Te1/1/1",
      "Port erroring - Interface: Te1/1/1",
    ]);
  });

  it("the uplink in both bands, an access port in the lower one: one band each, and the errors of both", async () => {
    const response: ProbeApiIngestResponse = await poll(
      devicePoll({
        uplinkUtilizationPercent: 97,
        uplinkErrorsPerSecond: 40,
        accessUtilizationPercent: 85,
        accessErrorsPerSecond: 3,
      }),
    );

    expect(openAlerts()).toEqual([
      "Port busy (critical) - Interface: Te1/1/1",
      "Port busy - Interface: Gi1/0/1",
      "Port erroring - Interface: Gi1/0/1",
      "Port erroring - Interface: Te1/1/1",
    ]);

    // The uplink's lower band names the port it left to the critical one.
    const leftToCritical: Array<MonitorEvaluationEvent> = eventsOf(
      response,
      "alert-skipped",
    ).filter((event: MonitorEvaluationEvent): boolean => {
      return event.title === 'Alert left to "Port busy (critical)"';
    });

    expect(leftToCritical).toHaveLength(1);
    expect(leftToCritical[0]!.relatedCriteriaId).toBe("port-busy");
    expect(leftToCritical[0]!.seriesFingerprint).toBe(
      MetricSeriesFingerprint.computeFingerprint({
        interfaceName: "Te1/1/1",
      }),
    );
    expect(leftToCritical[0]!.message).toContain(
      'Skipped creating an alert for this series (Interface: Te1/1/1) because "Port busy (critical)"',
    );
  });

  it("the uplink falls from the critical band to the lower one: its lower band's alert opens, the critical one resolves", async () => {
    await poll(devicePoll({ uplinkUtilizationPercent: 97 }));

    expect(openAlerts()).toEqual(["Port busy (critical) - Interface: Te1/1/1"]);

    await poll(devicePoll({ uplinkUtilizationPercent: 85 }));

    expect(openAlerts()).toEqual(["Port busy - Interface: Te1/1/1"]);
  });
});

// ---- A server agent's reports: a "*" disk -------------------------------------

function agentReport(input: {
  cpuPercent?: number | undefined;
  memoryPercent?: number | undefined;
  disks: Record<string, number>;
  processes?: Array<string> | undefined;
}): DataToProcess {
  const now: Date = OneUptimeDate.getCurrentDate();
  const memoryPercent: number = input.memoryPercent ?? 10;

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    hostname: "db-01",
    requestReceivedAt: now,
    timeNow: now,
    onlyCheckRequestReceivedAt: false,
    basicInfrastructureMetrics: {
      cpuMetrics: { percentUsed: input.cpuPercent ?? 10, cores: 4 },
      memoryMetrics: {
        total: 100,
        free: 100 - memoryPercent,
        used: memoryPercent,
        percentFree: 100 - memoryPercent,
        percentUsed: memoryPercent,
      },
      diskMetrics: Object.entries(input.disks).map(
        ([diskPath, percentUsed]: [string, number]) => {
          return {
            total: 100,
            free: 100 - percentUsed,
            used: percentUsed,
            diskPath: diskPath,
            percentUsed: percentUsed,
            percentFree: 100 - percentUsed,
          };
        },
      ),
    },
    processes: (input.processes || ["nginx", "postgres"]).map(
      (name: string, index: number) => {
        return { pid: 100 + index, name: name, command: `/usr/sbin/${name}` };
      },
    ),
  } as unknown as DataToProcess;
}

function percentAbove(checkOn: CheckOn, above: number): CriteriaFilter {
  return {
    checkOn: checkOn,
    filterType: FilterType.GreaterThan,
    value: above,
  };
}

function diskAbove(above: number): CriteriaFilter {
  return {
    checkOn: CheckOn.DiskUsagePercent,
    filterType: FilterType.GreaterThan,
    value: above,
    serverMonitorOptions: { diskPath: "*" },
  };
}

function processNotRunning(name: string): CriteriaFilter {
  return {
    checkOn: CheckOn.ServerProcessName,
    filterType: FilterType.IsNotExecuting,
    value: name,
  };
}

describe("a Server monitor with a '*' disk: each check of the server opens its own, bands of a disk share it (#11349)", () => {
  beforeEach(() => {
    watch({
      monitorType: MonitorType.Server,
      step: stepWith(
        [
          {
            id: "cpu-hot",
            name: "CPU hot",
            filters: [percentAbove(CheckOn.CPUUsagePercent, 90)],
          },
          {
            id: "memory-full",
            name: "Memory full",
            filters: [percentAbove(CheckOn.MemoryUsagePercent, 90)],
          },
          {
            id: "nginx-down",
            name: "nginx not running",
            filters: [processNotRunning("nginx")],
          },
          {
            id: "postgres-down",
            name: "postgres not running",
            filters: [processNotRunning("postgres")],
          },
          {
            id: "disk-critical",
            name: "Disk critical",
            filters: [diskAbove(95)],
          },
          {
            id: "disk-warning",
            name: "Disk warning",
            filters: [diskAbove(80)],
          },
        ].map(criteria),
      ),
    });
  });

  it("a hot CPU and a full memory at once: two alerts for the server", async () => {
    await check(
      agentReport({ cpuPercent: 99, memoryPercent: 97, disks: { "/": 40 } }),
    );

    expect(openAlerts()).toEqual(["CPU hot", "Memory full"]);
  });

  it("two processes down at once: one alert each", async () => {
    await check(agentReport({ disks: { "/": 40 }, processes: ["sshd"] }));

    expect(openAlerts()).toEqual(["nginx not running", "postgres not running"]);

    // nginx back: its alert resolves, postgres's stays.
    await check(
      agentReport({ disks: { "/": 40 }, processes: ["sshd", "nginx"] }),
    );

    expect(openAlerts()).toEqual(["postgres not running"]);
  });

  it("a disk past both bands: one alert from the critical; another in the warning band: its warning", async () => {
    const response: ProbeApiIngestResponse = await check(
      agentReport({ disks: { "/": 97, "/data": 85, "/boot": 30 } }),
    );

    expect(openAlerts()).toEqual([
      "Disk critical - Disk: /",
      "Disk warning - Disk: /data",
    ]);
    expect(titlesOf(response, "alert-skipped")).toEqual([
      'Alert left to "Disk critical"',
    ]);
  });

  it("everything at once: the CPU, the memory, a process and each disk's own band", async () => {
    await check(
      agentReport({
        cpuPercent: 99,
        memoryPercent: 97,
        disks: { "/": 97, "/data": 85 },
        processes: ["postgres"],
      }),
    );

    expect(openAlerts()).toEqual([
      "CPU hot",
      "Disk critical - Disk: /",
      "Disk warning - Disk: /data",
      "Memory full",
      "nginx not running",
    ]);
  });

  it("each resolves on its own, check by check", async () => {
    await check(
      agentReport({ cpuPercent: 99, memoryPercent: 97, disks: { "/": 97 } }),
    );
    await check(agentReport({ memoryPercent: 97, disks: { "/": 97 } }));

    expect(openAlerts()).toEqual(["Disk critical - Disk: /", "Memory full"]);

    await check(agentReport({ disks: { "/": 85 } }));

    expect(openAlerts()).toEqual(["Disk warning - Disk: /"]);

    await check(agentReport({ disks: { "/": 40 } }));

    expect(openAlerts()).toEqual([]);
  });
});

// ---- Every metric-backed type, grouped by host ----------------------------------

const HOST_KEY: string = "host.name";
const CPU: string = "cpu";
const MEMORY: string = "memory";

const METRIC_BACKED_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
).filter((monitorType: MonitorType): boolean => {
  return MonitorTypeHelper.isMetricBackedMonitor(monitorType);
});

function groupedMetricsStep(
  criteriaInstances: Array<MonitorCriteriaInstance>,
): MonitorStep {
  const queryConfigs: Array<MetricQueryConfigData> = [CPU, MEMORY].map(
    (alias: string): MetricQueryConfigData => {
      const metricAliasData: MetricAliasData = {
        metricVariable: alias,
        title: alias,
        description: undefined,
        legend: undefined,
        legendUnit: "%",
      };

      const metricQueryData: MetricQueryData = {
        filterData: { metricName: `system.${alias}.utilization` },
        groupByAttributeKeys: [HOST_KEY],
      } as unknown as MetricQueryData;

      return { metricAliasData, metricQueryData };
    },
  );

  const step: MonitorStep = stepWith(criteriaInstances);
  step.data!.metricMonitor = {
    metricViewConfig: { queryConfigs, formulaConfigs: [] },
    rollingTime: RollingTime.Past5Minutes,
  };

  return step;
}

function metricAbove(alias: string, above: number): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: above,
    metricMonitorOptions: {
      metricAlias: alias,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  };
}

// One telemetry check: each host's CPU and memory, in percent.
function hostMetrics(
  hosts: Record<string, { cpu: number; memory: number }>,
  view?: MetricsViewConfig | undefined,
): DataToProcess {
  const at: Date = OneUptimeDate.addRemoveSeconds(
    OneUptimeDate.getCurrentDate(),
    -30,
  );

  function sample(value: number, host: string): AggregateModel {
    return {
      timestamp: at,
      value: value,
      attributes: { [HOST_KEY]: host },
    } as unknown as AggregateModel;
  }

  const entries: Array<[string, { cpu: number; memory: number }]> =
    Object.entries(hosts);

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    metricViewConfig: view || { queryConfigs: [], formulaConfigs: [] },
    metricResult: [CPU, MEMORY].map((alias: string): AggregatedResult => {
      return {
        data: entries.map(
          ([host, values]: [string, { cpu: number; memory: number }]) => {
            return sample(alias === CPU ? values.cpu : values.memory, host);
          },
        ),
      } as AggregatedResult;
    }),
    seriesBreakdown: entries.map(
      ([host, values]: [string, { cpu: number; memory: number }]) => {
        return {
          fingerprint: MetricSeriesFingerprint.computeFingerprint({
            [HOST_KEY]: host,
          }),
          labels: { [HOST_KEY]: host },
          aggregatedResults: [values.cpu, values.memory].map(
            (value: number): AggregatedResult => {
              return { data: [sample(value, host)] } as AggregatedResult;
            },
          ),
        };
      },
    ),
  } as unknown as MetricMonitorResponse as unknown as DataToProcess;
}

describe.each(METRIC_BACKED_TYPES)(
  "a %s monitor grouped by host: different metrics of a host each alert, bands of one share it (#11349)",
  (monitorType: MonitorType) => {
    beforeEach(() => {
      watch({
        monitorType: monitorType,
        step: groupedMetricsStep(
          [
            {
              id: "cpu-critical",
              name: "CPU critical on {{host.name}}",
              filters: [metricAbove(CPU, 95)],
            },
            {
              id: "cpu-warning",
              name: "CPU warning on {{host.name}}",
              filters: [metricAbove(CPU, 80)],
            },
            {
              id: "memory-full",
              name: "Memory full on {{host.name}}",
              filters: [metricAbove(MEMORY, 90)],
            },
          ].map(criteria),
        ),
      });
    });

    it("is judged per host", () => {
      expect(
        MonitorStep.isJudgedPerSeries(
          monitorUnderTest.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
        ),
      ).toBe(true);
    });

    it("a host's hot CPU and full memory: two alerts for the host", async () => {
      await check(hostMetrics({ "web-01": { cpu: 85, memory: 95 } }));

      expect(openAlerts()).toEqual([
        "CPU warning on web-01",
        "Memory full on web-01",
      ]);
    });

    it("a host in both CPU bands: one CPU alert, from the critical; another host in the warning band: its warning", async () => {
      const response: ProbeApiIngestResponse = await check(
        hostMetrics({
          "web-01": { cpu: 99, memory: 20 },
          "web-02": { cpu: 85, memory: 20 },
          "web-03": { cpu: 10, memory: 20 },
        }),
      );

      expect(openAlerts()).toEqual([
        "CPU critical on web-01",
        "CPU warning on web-02",
      ]);
      expect(titlesOf(response, "alert-skipped")).toEqual([
        'Alert left to "CPU critical on {{host.name}}"',
      ]);
    });

    it("each resolves on its own: the memory recovers and the CPU alert stays", async () => {
      await check(hostMetrics({ "web-01": { cpu: 99, memory: 95 } }));

      expect(openAlerts()).toEqual([
        "CPU critical on web-01",
        "Memory full on web-01",
      ]);

      await check(hostMetrics({ "web-01": { cpu: 99, memory: 40 } }));

      expect(openAlerts()).toEqual(["CPU critical on web-01"]);

      await check(hostMetrics({ "web-01": { cpu: 10, memory: 40 } }));

      expect(openAlerts()).toEqual([]);
    });
  },
);

// ---- Logs and Traces, grouped by a service ----------------------------------------

const SERVICE_KEY: string = "service.name";

function countAtLeast(checkOn: CheckOn, atLeast: number): CriteriaFilter {
  return {
    checkOn: checkOn,
    filterType: FilterType.GreaterThanOrEqualTo,
    value: atLeast,
  };
}

const COUNT_BANDS: (checkOn: CheckOn) => Array<MonitorCriteriaInstance> = (
  checkOn: CheckOn,
): Array<MonitorCriteriaInstance> => {
  return [
    {
      id: "count-critical",
      name: "Too many (critical)",
      filters: [countAtLeast(checkOn, 100)],
    },
    {
      id: "count-warning",
      name: "Too many (warning)",
      filters: [countAtLeast(checkOn, 10)],
    },
  ].map(criteria);
};

function groupLabels(service: string): JSONObject {
  return { [SERVICE_KEY]: service };
}

function errorLogsByService(counts: Record<string, number>): DataToProcess {
  const response: LogMonitorResponse = {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    logCount: Object.values(counts).reduce((sum: number, count: number) => {
      return sum + count;
    }, 0),
    logQuery: {},
    groupByAttributes: [SERVICE_KEY],
    groupBreakdown: Object.entries(counts).map(
      ([service, count]: [string, number]) => {
        return {
          fingerprint: MetricSeriesFingerprint.computeFingerprint(
            groupLabels(service),
          ),
          labels: groupLabels(service),
          logCount: count,
        };
      },
    ),
  };

  return response as unknown as DataToProcess;
}

function errorSpansByService(counts: Record<string, number>): DataToProcess {
  const response: TraceMonitorResponse = {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    spanCount: Object.values(counts).reduce((sum: number, count: number) => {
      return sum + count;
    }, 0),
    spanQuery: {},
    groupByAttributes: [SERVICE_KEY],
    groupBreakdown: Object.entries(counts).map(
      ([service, count]: [string, number]) => {
        return {
          fingerprint: MetricSeriesFingerprint.computeFingerprint(
            groupLabels(service),
          ),
          labels: groupLabels(service),
          spanCount: count,
        };
      },
    ),
  };

  return response as unknown as DataToProcess;
}

describe("a Logs monitor grouped by service: its count's bands share a service (#11349)", () => {
  beforeEach(() => {
    const step: MonitorStep = stepWith(COUNT_BANDS(CheckOn.LogCount));
    step.data!.logMonitor = {
      groupByAttributes: [SERVICE_KEY],
    } as unknown as MonitorStepLogMonitor;

    watch({ monitorType: MonitorType.Logs, step: step });
  });

  it("a service past both bands: one alert, from the critical; a service past the warning only: its warning", async () => {
    const response: ProbeApiIngestResponse = await check(
      errorLogsByService({ checkout: 150, search: 20, cart: 2 }),
    );

    expect(openAlerts()).toEqual([
      "Too many (critical) - Service: checkout",
      "Too many (warning) - Service: search",
    ]);
    expect(titlesOf(response, "alert-skipped")).toEqual([
      'Alert left to "Too many (critical)"',
    ]);
  });

  it("the service falls to the warning band: the warning opens, the critical resolves", async () => {
    await check(errorLogsByService({ checkout: 150 }));
    await check(errorLogsByService({ checkout: 20 }));

    expect(openAlerts()).toEqual(["Too many (warning) - Service: checkout"]);
  });
});

describe("a Traces monitor grouped by service: its count's bands share a service (#11349)", () => {
  beforeEach(() => {
    const step: MonitorStep = stepWith(COUNT_BANDS(CheckOn.SpanCount));
    step.data!.traceMonitor = {
      groupByAttributes: [SERVICE_KEY],
    } as unknown as MonitorStepTraceMonitor;

    watch({ monitorType: MonitorType.Traces, step: step });
  });

  it("a service past both bands: one alert, from the critical; a service past the warning only: its warning", async () => {
    const response: ProbeApiIngestResponse = await check(
      errorSpansByService({ checkout: 150, search: 20, cart: 2 }),
    );

    expect(openAlerts()).toEqual([
      "Too many (critical) - Service: checkout",
      "Too many (warning) - Service: search",
    ]);
    expect(titlesOf(response, "alert-skipped")).toEqual([
      'Alert left to "Too many (critical)"',
    ]);
  });
});

// ---- Incidents and alerts are claimed apart -----------------------------------------

describe("incidents are claimed as alerts are, and apart from them (#11349)", () => {
  beforeEach(() => {
    watch({
      monitorType: MonitorType.Metrics,
      step: groupedMetricsStep(
        [
          {
            id: "cpu-down",
            name: "CPU saturated on {{host.name}}",
            filters: [metricAbove(CPU, 95)],
            status: OFFLINE,
            incident: true,
            alert: false,
          },
          {
            id: "cpu-high",
            name: "CPU high on {{host.name}}",
            filters: [metricAbove(CPU, 80)],
            incident: true,
          },
          {
            id: "memory-full",
            name: "Memory full on {{host.name}}",
            filters: [metricAbove(MEMORY, 90)],
            incident: true,
          },
        ].map(criteria),
      ),
    });
  });

  it("a host past both CPU bands and its memory: the critical incident and the memory's, and the lower band's alert", async () => {
    const response: ProbeApiIngestResponse = await check(
      hostMetrics({ "web-01": { cpu: 99, memory: 95 } }),
    );

    expect(openIncidents()).toEqual([
      "CPU saturated on web-01",
      "Memory full on web-01",
    ]);
    // The critical band opens no alert, so the lower band's alert is its own.
    expect(openAlerts()).toEqual([
      "CPU high on web-01",
      "Memory full on web-01",
    ]);
    expect(titlesOf(response, "incident-skipped")).toEqual([
      'Incident left to "CPU saturated on {{host.name}}"',
    ]);
    expect(status()).toBe("Offline");
  });
});

// ---- The claim itself -----------------------------------------------------------

describe("MonitorResourceUtil.claimUnclaimedSeries", () => {
  function match(criteriaId: string, host: string): PerSeriesCriteriaMatch {
    const labels: JSONObject = { [HOST_KEY]: host };

    return {
      criteriaMetId: criteriaId,
      fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
      labels: labels,
      rootCause: `${criteriaId} on ${host}`,
    };
  }

  function wholeMonitor(criteriaId: string): PerSeriesCriteriaMatch {
    return {
      criteriaMetId: criteriaId,
      fingerprint: MetricSeriesFingerprint.WholeMonitorFingerprint,
      labels: {},
      rootCause: criteriaId,
    };
  }

  function claim(input: {
    claimed: SeriesClaims;
    criteriaInstance: MonitorCriteriaInstance;
    matches: Array<PerSeriesCriteriaMatch>;
    kind?: MonitorRecordKind | undefined;
    isClaiming?: boolean | undefined;
    summary: MonitorEvaluationSummary;
  }): Array<string> {
    return MonitorResourceUtil.claimUnclaimedSeries({
      matches: input.matches,
      claimed: input.claimed,
      criteriaInstance: input.criteriaInstance,
      kind: input.kind || MonitorRecordKind.Alert,
      isClaiming: input.isClaiming !== false,
      evaluationSummary: input.summary,
    }).map((claimed: PerSeriesCriteriaMatch): string => {
      return `${claimed.criteriaMetId}@${String(claimed.labels[HOST_KEY] ?? "monitor")}`;
    });
  }

  function emptySummary(): MonitorEvaluationSummary {
    return {
      evaluatedAt: OneUptimeDate.getCurrentDate(),
      criteriaResults: [],
      events: [],
    } as unknown as MonitorEvaluationSummary;
  }

  const CRITICAL: MonitorCriteriaInstance = criteria({
    id: "critical",
    name: "CPU critical",
    filters: [metricAbove(CPU, 95)],
  });
  const WARNING: MonitorCriteriaInstance = criteria({
    id: "warning",
    name: "CPU warning",
    filters: [metricAbove(CPU, 80)],
  });
  const MEMORY_FULL: MonitorCriteriaInstance = criteria({
    id: "memory",
    name: "Memory full",
    filters: [metricAbove(MEMORY, 90)],
  });

  it("a band takes only the series no earlier band of it took, and says which band has them", () => {
    const claimed: SeriesClaims = new Map();
    const summary: MonitorEvaluationSummary = emptySummary();

    expect(
      claim({
        claimed,
        criteriaInstance: CRITICAL,
        matches: [match("critical", "a")],
        summary,
      }),
    ).toEqual(["critical@a"]);

    expect(
      claim({
        claimed,
        criteriaInstance: WARNING,
        matches: [match("warning", "a"), match("warning", "b")],
        summary,
      }),
    ).toEqual(["warning@b"]);

    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]!.type).toBe("alert-skipped");
    expect(summary.events[0]!.title).toBe('Alert left to "CPU critical"');
    expect(summary.events[0]!.relatedCriteriaId).toBe("warning");
    expect(summary.events[0]!.seriesFingerprint).toBe(
      match("warning", "a").fingerprint,
    );
    expect(summary.events[0]!.message).toBe(
      `Skipped creating an alert for this series (Host: a) because "CPU critical", listed before this criteria, checks the same thing and matched it too. A series in two bands of one check gets one alert, from the first.`,
    );
  });

  it("a criteria that checks something else takes every series it matched, those a band took included", () => {
    const claimed: SeriesClaims = new Map();
    const summary: MonitorEvaluationSummary = emptySummary();

    claim({
      claimed,
      criteriaInstance: CRITICAL,
      matches: [match("critical", "a")],
      summary,
    });

    expect(
      claim({
        claimed,
        criteriaInstance: MEMORY_FULL,
        matches: [match("memory", "a"), match("memory", "b")],
        summary,
      }),
    ).toEqual(["memory@a", "memory@b"]);
    expect(summary.events).toEqual([]);
  });

  it("the whole monitor is one series: two bands of it share it, two other checks do not", () => {
    const claimed: SeriesClaims = new Map();
    const summary: MonitorEvaluationSummary = emptySummary();

    expect(
      claim({
        claimed,
        criteriaInstance: CRITICAL,
        matches: [wholeMonitor("critical")],
        summary,
      }),
    ).toEqual(["critical@monitor"]);
    expect(
      claim({
        claimed,
        criteriaInstance: MEMORY_FULL,
        matches: [wholeMonitor("memory")],
        summary,
      }),
    ).toEqual(["memory@monitor"]);
    expect(
      claim({
        claimed,
        criteriaInstance: WARNING,
        matches: [wholeMonitor("warning")],
        summary,
      }),
    ).toEqual([]);

    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]!.seriesFingerprint).toBeUndefined();
    expect(summary.events[0]!.message).toBe(
      'Skipped creating an alert because "CPU critical", listed before this criteria, checks the same thing and matched too. Two bands of one check open one alert, from the first.',
    );
  });

  it("an incident's claim is worded as an incident's", () => {
    const claimed: SeriesClaims = new Map();
    const summary: MonitorEvaluationSummary = emptySummary();

    claim({
      claimed,
      criteriaInstance: CRITICAL,
      matches: [match("critical", "a"), wholeMonitor("critical")],
      kind: MonitorRecordKind.Incident,
      summary,
    });
    claim({
      claimed,
      criteriaInstance: WARNING,
      matches: [match("warning", "a"), wholeMonitor("warning")],
      kind: MonitorRecordKind.Incident,
      summary,
    });

    expect(
      summary.events.map((event: MonitorEvaluationEvent): string => {
        return `${event.type}: ${event.title}: ${event.message}`;
      }),
    ).toEqual([
      `incident-skipped: Incident left to "CPU critical": Skipped creating an incident for this series (Host: a) because "CPU critical", listed before this criteria, checks the same thing and matched it too. A series in two bands of one check gets one incident, from the first.`,
      `incident-skipped: Incident left to "CPU critical": Skipped creating an incident because "CPU critical", listed before this criteria, checks the same thing and matched too. Two bands of one check open one incident, from the first.`,
    ]);
  });

  it("a criteria that opens nothing claims nothing, and takes every series it matched", () => {
    const claimed: SeriesClaims = new Map();
    const summary: MonitorEvaluationSummary = emptySummary();

    expect(
      claim({
        claimed,
        criteriaInstance: CRITICAL,
        matches: [match("critical", "a")],
        isClaiming: false,
        summary,
      }),
    ).toEqual(["critical@a"]);

    // Nothing was claimed, so the band below opens for the host.
    expect(
      claim({
        claimed,
        criteriaInstance: WARNING,
        matches: [match("warning", "a")],
        summary,
      }),
    ).toEqual(["warning@a"]);
    expect(summary.events).toEqual([]);
  });

  it("an unnamed criteria that took a series is named so", () => {
    const claimed: SeriesClaims = new Map();
    const summary: MonitorEvaluationSummary = emptySummary();
    const unnamed: MonitorCriteriaInstance = criteria({
      id: "unnamed",
      name: "",
      filters: [metricAbove(CPU, 99)],
    });

    claim({
      claimed,
      criteriaInstance: unnamed,
      matches: [match("unnamed", "a")],
      summary,
    });
    claim({
      claimed,
      criteriaInstance: WARNING,
      matches: [match("warning", "a")],
      summary,
    });

    expect(summary.events[0]!.title).toBe('Alert left to "Unnamed criteria"');
  });
});

// ---- Drawn grouped monitors, checked again and again -------------------------------

/*
 * THE RULE, OVER DRAWN MONITORS AND CHECKS (#11349). Metrics monitors grouped
 * by host, with two to six criteria drawn from one seed: each alerts, on one
 * or two of three metrics, past a threshold of its own. Three hosts report
 * values of every kind, twelve checks in a row. After every check the open
 * alerts are exactly what the rule gives:
 *
 *   - a criteria's alert for a host is open while the criteria matches the
 *     host, from the check where it was the first of its band to match it;
 *   - criteria of one band are those that read the same metrics.
 *
 * The old claim - the first criteria that matched a host took it, whatever
 * it read - fails it whenever two criteria of different metrics match one
 * host.
 */
describe("drawn grouped monitors, checked again and again (#11349)", () => {
  const METRICS: Array<string> = [CPU, MEMORY, "disk"];
  const HOSTS: Array<string> = ["web-01", "web-02", "web-03"];
  const THRESHOLDS: Array<number> = [20, 50, 80];
  const VALUES: Array<number> = [10, 30, 60, 90];

  interface DrawnCriteria {
    id: string;
    metrics: Array<string>;
    thresholds: Array<number>;
  }

  function threeMetricStep(
    criteriaInstances: Array<MonitorCriteriaInstance>,
  ): MonitorStep {
    const queryConfigs: Array<MetricQueryConfigData> = METRICS.map(
      (alias: string): MetricQueryConfigData => {
        return {
          metricAliasData: {
            metricVariable: alias,
            title: alias,
            description: undefined,
            legend: undefined,
            legendUnit: "%",
          },
          metricQueryData: {
            filterData: { metricName: `system.${alias}.utilization` },
            groupByAttributeKeys: [HOST_KEY],
          } as unknown as MetricQueryData,
        };
      },
    );

    const step: MonitorStep = stepWith(criteriaInstances);
    step.data!.metricMonitor = {
      metricViewConfig: { queryConfigs, formulaConfigs: [] },
      rollingTime: RollingTime.Past5Minutes,
    };

    return step;
  }

  function reading(values: Record<string, Array<number>>): DataToProcess {
    const at: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      -30,
    );

    function sample(value: number, host: string): AggregateModel {
      return {
        timestamp: at,
        value: value,
        attributes: { [HOST_KEY]: host },
      } as unknown as AggregateModel;
    }

    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
      metricResult: METRICS.map(
        (_alias: string, index: number): AggregatedResult => {
          return {
            data: HOSTS.map((host: string) => {
              return sample(values[host]![index]!, host);
            }),
          } as AggregatedResult;
        },
      ),
      seriesBreakdown: HOSTS.map((host: string) => {
        return {
          fingerprint: MetricSeriesFingerprint.computeFingerprint({
            [HOST_KEY]: host,
          }),
          labels: { [HOST_KEY]: host },
          aggregatedResults: values[host]!.map(
            (value: number): AggregatedResult => {
              return { data: [sample(value, host)] } as AggregatedResult;
            },
          ),
        };
      }),
    } as unknown as DataToProcess;
  }

  function drawMonitor(random: SeededRandom): Array<DrawnCriteria> {
    const count: number = 2 + random(5);
    const drawn: Array<DrawnCriteria> = [];

    for (let index: number = 0; index < count; index++) {
      const first: string = METRICS[random(METRICS.length)]!;
      const metrics: Array<string> = [first];

      if (random(3) === 0) {
        const second: string = METRICS[random(METRICS.length)]!;

        if (second !== first) {
          metrics.push(second);
        }
      }

      drawn.push({
        id: `drawn-${index}`,
        metrics: metrics,
        thresholds: metrics.map((): number => {
          return THRESHOLDS[random(THRESHOLDS.length)]!;
        }),
      });
    }

    return drawn;
  }

  function matches(
    drawnCriteria: DrawnCriteria,
    values: Array<number>,
  ): boolean {
    return drawnCriteria.metrics.every(
      (metricName: string, index: number): boolean => {
        return (
          values[METRICS.indexOf(metricName)]! >
          drawnCriteria.thresholds[index]!
        );
      },
    );
  }

  function bandOf(drawnCriteria: DrawnCriteria): string {
    return [...new Set<string>(drawnCriteria.metrics)].sort().join("+");
  }

  it("the open alerts after every check are those the rule gives", async () => {
    const random: SeededRandom = seededRandom(1134911349);
    let checksWithTwoBandsOnOneHost: number = 0;

    for (let monitorIndex: number = 0; monitorIndex < 30; monitorIndex++) {
      const drawn: Array<DrawnCriteria> = drawMonitor(random);

      watch({
        monitorType: MonitorType.Metrics,
        step: threeMetricStep(
          drawn.map((drawnCriteria: DrawnCriteria): MonitorCriteriaInstance => {
            return criteria({
              id: drawnCriteria.id,
              name: drawnCriteria.id,
              filters: drawnCriteria.metrics.map(
                (metricName: string, index: number): CriteriaFilter => {
                  return metricAbove(
                    metricName,
                    drawnCriteria.thresholds[index]!,
                  );
                },
              ),
            });
          }),
        ),
      });

      let expectedOpen: Set<string> = new Set<string>();

      for (let checkIndex: number = 0; checkIndex < 12; checkIndex++) {
        const values: Record<string, Array<number>> = {};

        for (const host of HOSTS) {
          values[host] = METRICS.map((): number => {
            return VALUES[random(VALUES.length)]!;
          });
        }

        await check(reading(values));

        const nowOpen: Set<string> = new Set<string>();

        for (const host of HOSTS) {
          const fingerprint: string =
            MetricSeriesFingerprint.computeFingerprint({ [HOST_KEY]: host });
          const bandsMatched: Set<string> = new Set<string>();

          for (const drawnCriteria of drawn) {
            if (!matches(drawnCriteria, values[host]!)) {
              continue;
            }

            const key: string = `${drawnCriteria.id}|${fingerprint}`;
            const band: string = bandOf(drawnCriteria);
            const isFirstOfBand: boolean = !bandsMatched.has(band);

            bandsMatched.add(band);

            if (isFirstOfBand || expectedOpen.has(key)) {
              nowOpen.add(key);
            }
          }

          if (bandsMatched.size > 1) {
            checksWithTwoBandsOnOneHost++;
          }
        }

        expectedOpen = nowOpen;

        expect({
          monitor: monitorIndex,
          check: checkIndex,
          open: openAlertKeys(),
        }).toEqual({
          monitor: monitorIndex,
          check: checkIndex,
          open: [...expectedOpen].sort(),
        });
      }

      jest.restoreAllMocks();
    }

    // The draws hold hosts in more than one band at once: what #11349 is about.
    expect(checksWithTwoBandsOnOneHost).toBeGreaterThan(50);
  });
});
