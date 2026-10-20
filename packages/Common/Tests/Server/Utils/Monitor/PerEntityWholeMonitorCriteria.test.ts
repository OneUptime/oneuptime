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
import MonitorTemplate from "../../../../Models/DatabaseModels/MonitorTemplate";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import PerEntityCriteriaFanOut from "../../../../Server/Utils/Monitor/PerEntityCriteriaFanOut";
import ReceivingSilence from "../../../../Server/Utils/Monitor/ReceivingSilence";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil from "../../../../Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import NetworkAlertPolicyBootstrapUtil from "../../../../Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import {
  DEFAULT_STATUS,
  MonitorRecordTables,
  isOpenAlert,
  isOpenIncident,
  mockMonitorRecordTables,
} from "../../TestingUtils/MonitorRecordTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The same flaw as the Incoming Request grouping report, on the monitor
 * types whose criteria opt into one alert per entity with "*": a Server
 * monitor's disks, a Network Device monitor's ports and table rows.
 *
 * The "*" was read for the whole monitor. Once any criteria named it, every
 * criteria was judged per entity - and a criteria that names no disk, port
 * or row has none, so it was judged "not met: no single series satisfied
 * it". The recommended network device alert pack has three "*" transceiver
 * criteria, so on every monitor built from it a device that went down
 * matched nothing: no "Device unreachable" incident, and no offline status.
 *
 * A criteria that names no "*" now judges the whole monitor, exactly as on
 * a monitor where no criteria names "*": its own verdict stands, and it acts
 * on the whole monitor as one entity of its own, beside the per-disk or
 * per-port ones.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e7d1c2a-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "5e7d1c2a-2222-4222-8222-222222222222",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "5e7d1c2a-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "5e7d1c2a-4444-4444-8444-444444444444",
);
const DEGRADED_STATUS_ID: ObjectID = new ObjectID(
  "5e7d1c2a-5555-4555-8555-555555555555",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "5e7d1c2a-6666-4666-8666-666666666666",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "5e7d1c2a-7777-4777-8777-777777777777",
);

const OFFLINE_ID: string = "a3c1e2f4-0001-4b00-8000-000000000001";
const DISKS_ID: string = "a3c1e2f4-0002-4b00-8000-000000000002";
const CPU_ID: string = "a3c1e2f4-0003-4b00-8000-000000000003";
const ONLINE_ID: string = "a3c1e2f4-0004-4b00-8000-000000000004";

const START: Date = new Date("2026-10-20T09:00:00.000Z");

function filter(
  checkOn: CheckOn,
  filterType: FilterType,
  value?: string | undefined,
  diskPath?: string | undefined,
): CriteriaFilter {
  return {
    checkOn,
    filterType,
    value,
    ...(diskPath !== undefined ? { serverMonitorOptions: { diskPath } } : {}),
  };
}

function criteria(input: {
  id: string;
  name: string;
  statusId: ObjectID;
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition | undefined;
  incident?: string | undefined;
  alert?: string | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: input.id,
    name: input.name,
    description: "",
    monitorStatusId: input.statusId,
    filterCondition: input.filterCondition || FilterCondition.All,
    filters: input.filters,
    incidents: input.incident
      ? [
          {
            id: `${input.id.slice(0, -4)}1111`,
            title: input.incident,
            description: "",
            incidentSeverityId: INCIDENT_SEVERITY_ID,
            autoResolveIncident: true,
          },
        ]
      : [],
    alerts: input.alert
      ? [
          {
            id: `${input.id.slice(0, -4)}2222`,
            title: input.alert,
            description: "",
            alertSeverityId: ALERT_SEVERITY_ID,
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus: true,
    createIncidents: Boolean(input.incident),
    createAlerts: Boolean(input.alert),
    isEnabled: true,
  };

  return instance;
}

// A server: offline, any full disk ("*"), high CPU, and back online.
function serverCriteria(): Array<MonitorCriteriaInstance> {
  return [
    criteria({
      id: OFFLINE_ID,
      name: "Server offline",
      statusId: OFFLINE_STATUS_ID,
      filters: [filter(CheckOn.IsOnline, FilterType.False)],
      incident: "Server offline",
    }),
    criteria({
      id: DISKS_ID,
      name: "Disk full",
      statusId: DEGRADED_STATUS_ID,
      filters: [
        filter(CheckOn.DiskUsagePercent, FilterType.GreaterThan, "90", "*"),
      ],
      alert: "Disk full",
    }),
    criteria({
      id: CPU_ID,
      name: "CPU high",
      statusId: DEGRADED_STATUS_ID,
      filters: [filter(CheckOn.CPUUsagePercent, FilterType.GreaterThan, "90")],
      alert: "CPU high",
    }),
    criteria({
      id: ONLINE_ID,
      name: "Server online",
      statusId: ONLINE_STATUS_ID,
      filters: [filter(CheckOn.IsOnline, FilterType.True)],
    }),
  ];
}

function monitorWith(
  monitorType: MonitorType,
  criteriaInstances: Array<MonitorCriteriaInstance>,
): Monitor {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: criteriaInstances,
  };
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS_ID,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "prod-db-01";
  monitor.monitorType = monitorType;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ONLINE_STATUS_ID;
  return monitor;
}

// What the agent reports: CPU and each disk's use, in percent.
function agentReport(input: {
  cpu: number;
  disks: Record<string, number>;
}): DataToProcess {
  const now: Date = OneUptimeDate.getCurrentDate();

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    hostname: "prod-db-01",
    requestReceivedAt: now,
    timeNow: now,
    onlyCheckRequestReceivedAt: false,
    basicInfrastructureMetrics: {
      cpuMetrics: { percentUsed: input.cpu, cores: 4 },
      memoryMetrics: {
        total: 100,
        free: 90,
        used: 10,
        percentFree: 90,
        percentUsed: 10,
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
  } as unknown as DataToProcess;
}

// A network device's poll, as the walk hands it to the monitor.
function devicePoll(isOnline: boolean): DataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    probeId: ObjectID.generate(),
    isOnline: isOnline,
    failureCause: isOnline ? "" : "Request timed out",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    snmpResponse: {
      isOnline: isOnline,
      responseTimeInMs: isOnline ? 12 : 0,
      failureCause: isOnline ? "" : "Request timed out",
      oidResponses: [],
      interfaces: [],
      transceivers: [],
    },
  } as unknown as DataToProcess;
}

async function evaluate(input: {
  monitor: Monitor;
  dataToProcess: DataToProcess;
}): Promise<{
  response: ProbeApiIngestResponse;
  summary: MonitorEvaluationSummary;
}> {
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: OneUptimeDate.getCurrentDate(),
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: input.dataToProcess,
      monitorStep:
        input.monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
      monitor: input.monitor,
      probeApiIngestResponse: {
        monitorId: input.monitor.id!,
        criteriaMetId: undefined,
        rootCause: null,
      },
      evaluationSummary: summary,
    });

  return { response, summary };
}

function resultOf(
  summary: MonitorEvaluationSummary,
  name: string,
): MonitorEvaluationCriteriaResult | undefined {
  return summary.criteriaResults.find(
    (result: MonitorEvaluationCriteriaResult): boolean => {
      return result.criteriaName === name;
    },
  );
}

function matchedNames(
  monitor: Monitor,
  response: ProbeApiIngestResponse,
): Array<string> {
  const names: Record<string, string> = {};

  for (const instance of monitor.monitorSteps!.data!
    .monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray) {
    names[instance.data!.id] = instance.data!.name;
  }

  return (response.matchedCriteria || []).map(
    (matched: MatchedCriteriaResult): string => {
      return names[matched.criteriaId] || matched.criteriaId;
    },
  );
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("PerEntityCriteriaFanOut: which criteria judge the whole monitor", () => {
  it("on a Server monitor, every criteria that names no '*' disk", () => {
    const [offline, disks, cpu, online] = serverCriteria();

    for (const instance of [offline!, cpu!, online!]) {
      expect(
        PerEntityCriteriaFanOut.judgesWholeMonitor({
          monitorType: MonitorType.Server,
          criteriaInstance: instance,
        }),
      ).toBe(true);
    }

    expect(
      PerEntityCriteriaFanOut.judgesWholeMonitor({
        monitorType: MonitorType.Server,
        criteriaInstance: disks!,
      }),
    ).toBe(false);
  });

  it("a disk named outright is one disk of the whole monitor, not a fan-out", () => {
    expect(
      PerEntityCriteriaFanOut.judgesWholeMonitor({
        monitorType: MonitorType.Server,
        criteriaInstance: criteria({
          id: DISKS_ID,
          name: "Root disk full",
          statusId: DEGRADED_STATUS_ID,
          filters: [
            filter(CheckOn.DiskUsagePercent, FilterType.GreaterThan, "90", "/"),
          ],
        }),
      }),
    ).toBe(true);
  });

  it("on a Network Device monitor, every criteria with no '*' port or row", () => {
    const pack: Array<MonitorCriteriaInstance> =
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: OFFLINE_STATUS_ID,
      });

    const judged: Record<string, boolean> = {};

    for (const instance of pack) {
      judged[instance.data!.name] = PerEntityCriteriaFanOut.judgesWholeMonitor({
        monitorType: MonitorType.NetworkDevice,
        criteriaInstance: instance,
      });
    }

    expect(judged).toEqual({
      "Device unreachable": true,
      "SNMP walk failing": true,
      "Interface down": true,
      "Interface saturated": true,
      "Interface errors": true,
      "Transceiver not detected": false,
      "Transceiver past its alarm threshold": false,
      "Transceiver RX power dropping": false,
    });
  });

  it("a '*' table row fans out too", () => {
    const tableCriteria: MonitorCriteriaInstance = criteria({
      id: DISKS_ID,
      name: "Tunnel down",
      statusId: DEGRADED_STATUS_ID,
      filters: [
        {
          checkOn: CheckOn.SnmpTableRowIsUnhealthy,
          filterType: FilterType.True,
          snmpMonitorOptions: { tableKey: "ipsec_tunnels", tableRow: "*" },
        } as CriteriaFilter,
      ],
    });

    expect(
      PerEntityCriteriaFanOut.isFanOutConfigured({
        monitorType: MonitorType.NetworkDevice,
        criteriaInstance: tableCriteria,
      }),
    ).toBe(true);
    expect(
      PerEntityCriteriaFanOut.judgesWholeMonitor({
        monitorType: MonitorType.NetworkDevice,
        criteriaInstance: tableCriteria,
      }),
    ).toBe(false);
  });

  it("never on any other monitor type, whose group-by covers every criteria", () => {
    const [, , cpu] = serverCriteria();

    for (const monitorType of Object.values(MonitorType)) {
      if (
        monitorType === MonitorType.Server ||
        monitorType === MonitorType.NetworkDevice
      ) {
        continue;
      }

      expect({
        monitorType,
        judges: PerEntityCriteriaFanOut.judgesWholeMonitor({
          monitorType: monitorType,
          criteriaInstance: cpu!,
        }),
      }).toEqual({ monitorType, judges: false });
    }

    expect(
      PerEntityCriteriaFanOut.judgesWholeMonitor({
        monitorType: undefined,
        criteriaInstance: cpu!,
      }),
    ).toBe(false);
  });

  it("a whole-monitor match is the whole monitor's own entity", () => {
    expect(
      PerEntityCriteriaFanOut.wholeMonitorMatch({
        criteriaId: CPU_ID,
        rootCause: "CPU above 90%.",
      }),
    ).toEqual({
      criteriaMetId: CPU_ID,
      fingerprint: MetricSeriesFingerprint.WholeMonitorFingerprint,
      labels: {},
      rootCause: "CPU above 90%.",
      metricContext: undefined,
    });
    expect(MetricSeriesFingerprint.computeFingerprint({})).toBe(
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    );
  });
});

describe("the evaluator, on a Server monitor with a '*' disk criteria", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(START);
    jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
      wallMinutes: 0,
      receivingMinutes: 0,
      notReceivingMinutes: 0,
    });
  });

  it("a CPU criteria at 99% is met, for the whole monitor", async () => {
    const monitor: Monitor = monitorWith(MonitorType.Server, serverCriteria());
    const { response, summary } = await evaluate({
      monitor,
      dataToProcess: agentReport({ cpu: 99, disks: { "/": 40 } }),
    });

    expect(resultOf(summary, "CPU high")?.met).toBe(true);
    expect(resultOf(summary, "Disk full")?.met).toBe(false);
    expect(matchedNames(monitor, response)).toEqual([
      "CPU high",
      "Server online",
    ]);
    expect(response.criteriaMetId).toBe(CPU_ID);

    const cpu: MatchedCriteriaResult = response.matchedCriteria![0]!;

    expect(cpu.perSeriesMatches).toHaveLength(1);
    expect(cpu.perSeriesMatches[0]!.fingerprint).toBe(
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    );
    expect(cpu.perSeriesMatches[0]!.labels).toEqual({});
    // Its record carries the criteria's own root cause.
    expect(cpu.perSeriesMatches[0]!.rootCause).toBe(cpu.rootCause);
    expect(cpu.rootCause).toContain("**Criteria Name**: CPU high");
    expect(response.perSeriesMatches).toEqual(cpu.perSeriesMatches);
  });

  it("a full disk and a hot CPU: the disk per disk, the CPU for the whole monitor", async () => {
    const monitor: Monitor = monitorWith(MonitorType.Server, serverCriteria());
    const { response } = await evaluate({
      monitor,
      dataToProcess: agentReport({ cpu: 99, disks: { "/": 95, "/data": 40 } }),
    });

    expect(matchedNames(monitor, response)).toEqual([
      "Disk full",
      "CPU high",
      "Server online",
    ]);

    const [disks, cpu] = response.matchedCriteria!;

    expect(
      disks!.perSeriesMatches.map((match: PerSeriesCriteriaMatch) => {
        return match.labels;
      }),
    ).toEqual([{ diskPath: "/" }]);
    expect(cpu!.perSeriesMatches[0]!.fingerprint).toBe(
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    );
    // The first match still owns the monitor's status.
    expect(response.criteriaMetId).toBe(DISKS_ID);
  });

  it("a '*' criteria with no full disk is still not met", async () => {
    const monitor: Monitor = monitorWith(MonitorType.Server, serverCriteria());
    const { summary } = await evaluate({
      monitor,
      dataToProcess: agentReport({ cpu: 10, disks: { "/": 40 } }),
    });

    expect(resultOf(summary, "Disk full")?.met).toBe(false);
    expect(resultOf(summary, "CPU high")?.met).toBe(false);
    expect(resultOf(summary, "Server online")?.met).toBe(true);
  });

  it("a whole-monitor criteria is still judged on all its filters", async () => {
    const both: MonitorCriteriaInstance = criteria({
      id: CPU_ID,
      name: "CPU and memory high",
      statusId: DEGRADED_STATUS_ID,
      filterCondition: FilterCondition.All,
      filters: [
        filter(CheckOn.CPUUsagePercent, FilterType.GreaterThan, "90"),
        filter(CheckOn.MemoryUsagePercent, FilterType.GreaterThan, "90"),
      ],
      alert: "CPU and memory high",
    });
    const [, disks] = serverCriteria();
    const monitor: Monitor = monitorWith(MonitorType.Server, [disks!, both]);

    const { summary, response } = await evaluate({
      monitor,
      dataToProcess: agentReport({ cpu: 99, disks: { "/": 40 } }),
    });

    // Memory is at 10%: All is not met.
    expect(resultOf(summary, "CPU and memory high")?.met).toBe(false);
    expect(response.criteriaMetId).toBeUndefined();
  });

  it("a monitor with no '*' criteria keeps first-match-wins and no per-entity list", async () => {
    const monitor: Monitor = monitorWith(
      MonitorType.Server,
      serverCriteria().filter((instance: MonitorCriteriaInstance) => {
        return instance.data!.id !== DISKS_ID;
      }),
    );
    const { response, summary } = await evaluate({
      monitor,
      dataToProcess: agentReport({ cpu: 99, disks: { "/": 95 } }),
    });

    expect(response.criteriaMetId).toBe(CPU_ID);
    expect(response.perSeriesMatches).toBeUndefined();
    expect(response.matchedCriteria).toBeUndefined();
    expect(resultOf(summary, "Server online")?.skipped).toBe(true);
  });
});

describe("the evaluator, on a Network Device monitor built from the recommended alert pack", () => {
  function packMonitor(): Monitor {
    return monitorWith(
      MonitorType.NetworkDevice,
      NetworkDeviceAlertPackUtil.buildCriteriaInstances({
        downMonitorStatusId: OFFLINE_STATUS_ID,
      }),
    );
  }

  it("a device that stops answering matches Device unreachable, which owns the status", async () => {
    const monitor: Monitor = packMonitor();
    const { response, summary } = await evaluate({
      monitor,
      dataToProcess: devicePoll(false),
    });

    expect(resultOf(summary, "Device unreachable")?.met).toBe(true);
    expect(resultOf(summary, "Device unreachable")?.message).not.toContain(
      "no single series satisfied it",
    );
    expect(matchedNames(monitor, response)[0]).toBe("Device unreachable");
    expect(
      response.matchedCriteria![0]!.perSeriesMatches.map(
        (match: PerSeriesCriteriaMatch) => {
          return match.fingerprint;
        },
      ),
    ).toEqual([MetricSeriesFingerprint.WholeMonitorFingerprint]);
    expect(
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.find(
        (instance: MonitorCriteriaInstance) => {
          return instance.data!.id === response.criteriaMetId;
        },
      )?.data?.name,
    ).toBe("Device unreachable");
  });

  it("a healthy device matches nothing", async () => {
    const { response } = await evaluate({
      monitor: packMonitor(),
      dataToProcess: devicePoll(true),
    });

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.matchedCriteria).toEqual([]);
  });
});

describe("end to end: a Server monitor with a '*' disk criteria", () => {
  let tables: MonitorRecordTables;
  let monitorUnderTest: Monitor;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(START);

    monitorUnderTest = monitorWith(MonitorType.Server, serverCriteria());
    tables = mockMonitorRecordTables({
      getMonitor: (): Monitor => {
        return monitorUnderTest;
      },
      projectId: PROJECT_ID,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      alertSeverityId: ALERT_SEVERITY_ID,
    });
  });

  async function report(input: {
    cpu: number;
    disks: Record<string, number>;
  }): Promise<MonitorEvaluationSummary> {
    jest.setSystemTime(
      OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 1),
    );

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(agentReport(input));

    return response.evaluationSummary!;
  }

  // The online check: no report for ten minutes.
  async function silentForTenMinutes(): Promise<MonitorEvaluationSummary> {
    const lastReport: DataToProcess = agentReport({ cpu: 10, disks: {} });

    jest.setSystemTime(
      OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 10),
    );
    jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
      wallMinutes: 10,
      receivingMinutes: 10,
      notReceivingMinutes: 0,
    });

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource({
        ...(lastReport as unknown as JSONObject),
        onlyCheckRequestReceivedAt: true,
        timeNow: OneUptimeDate.getCurrentDate(),
      } as unknown as DataToProcess);

    jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
      wallMinutes: 0,
      receivingMinutes: 0,
      notReceivingMinutes: 0,
    });

    return response.evaluationSummary!;
  }

  // A disk's alert by its disk ("disk /data"), the others by their title.
  function openAlerts(): Array<string> {
    return tables.alerts.filter(isOpenAlert).map((alert: Alert): string => {
      if (alert.createdCriteriaId === DISKS_ID) {
        return `disk ${String((alert.seriesLabels as JSONObject)["diskPath"])}`;
      }

      // Every other criteria judges the whole monitor: no series labels.
      expect(alert.seriesLabels).toBeUndefined();
      expect(alert.seriesFingerprint).toBe(
        MetricSeriesFingerprint.WholeMonitorFingerprint,
      );

      return alert.title || "";
    });
  }

  function openIncidents(): Array<string> {
    return tables.incidents
      .filter(isOpenIncident)
      .map((incident: Incident): string => {
        return incident.title || "";
      });
  }

  it("a hot CPU opens its alert beside a full disk's, each resolving on its own", async () => {
    await report({ cpu: 99, disks: { "/": 95, "/data": 40 } });

    expect(openAlerts()).toEqual(["disk /", "CPU high"]);
    expect(tables.statusSetBy).toEqual(["Disk full"]);

    // Still both: nothing new opens.
    await report({ cpu: 99, disks: { "/": 95, "/data": 40 } });
    expect(tables.alerts).toHaveLength(2);

    // The CPU cools down: its alert resolves, the disk's stays.
    await report({ cpu: 20, disks: { "/": 95, "/data": 40 } });
    expect(openAlerts()).toEqual(["disk /"]);

    // A second disk fills up: an alert of its own.
    await report({ cpu: 20, disks: { "/": 95, "/data": 97 } });
    expect(openAlerts()).toEqual(["disk /", "disk /data"]);

    // The CPU heats up again: a new alert, for the whole monitor once more.
    await report({ cpu: 95, disks: { "/": 95, "/data": 97 } });
    expect(openAlerts()).toEqual(["disk /", "disk /data", "CPU high"]);
    expect(
      tables.alerts.filter((alert: Alert): boolean => {
        return alert.createdCriteriaId === CPU_ID;
      }),
    ).toHaveLength(2);
  });

  it("a server that goes silent opens Server offline, and the monitor goes offline", async () => {
    await report({ cpu: 10, disks: { "/": 40 } });
    expect(openIncidents()).toEqual([]);

    const silent: MonitorEvaluationSummary = await silentForTenMinutes();

    expect(resultOf(silent, "Server offline")?.met).toBe(true);
    expect(openIncidents()).toEqual(["Server offline"]);
    expect(tables.statusSetBy).toEqual(["Server online", "Server offline"]);
    expect(monitorUnderTest.currentMonitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );

    // Still silent: the same incident, not a second one.
    await silentForTenMinutes();
    expect(tables.incidents).toHaveLength(1);

    // Back: the incident resolves.
    await report({ cpu: 10, disks: { "/": 40 } });
    expect(openIncidents()).toEqual([]);
    expect(tables.statusSetBy[tables.statusSetBy.length - 1]).toBe(
      "Server online",
    );
  });
});

describe("end to end: a Network Device monitor from the recommended alert policy", () => {
  let tables: MonitorRecordTables;
  let monitorUnderTest: Monitor;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(START);

    // The template every device's monitor is cloned from, actions filled in.
    const template: MonitorTemplate =
      NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
        projectId: PROJECT_ID,
        incidentSeverityId: INCIDENT_SEVERITY_ID,
        alertSeverityId: ALERT_SEVERITY_ID,
        onlineMonitorStatusId: ONLINE_STATUS_ID,
        offlineMonitorStatusId: OFFLINE_STATUS_ID,
      });

    monitorUnderTest = new Monitor();
    monitorUnderTest.id = MONITOR_ID;
    monitorUnderTest.projectId = PROJECT_ID;
    monitorUnderTest.name = "core-sw-01";
    monitorUnderTest.monitorType = MonitorType.NetworkDevice;
    monitorUnderTest.monitorSteps = template.monitorSteps!;
    monitorUnderTest.currentMonitorStatusId = ONLINE_STATUS_ID;

    tables = mockMonitorRecordTables({
      getMonitor: (): Monitor => {
        return monitorUnderTest;
      },
      projectId: PROJECT_ID,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      alertSeverityId: ALERT_SEVERITY_ID,
    });
  });

  async function poll(isOnline: boolean): Promise<MonitorEvaluationSummary> {
    jest.setSystemTime(
      OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 1),
    );

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(devicePoll(isOnline));

    return response.evaluationSummary!;
  }

  it("a switch that goes down opens Device unreachable and goes offline; back up, it resolves", async () => {
    await poll(true);
    expect(tables.incidents).toEqual([]);

    await poll(false);

    expect(
      tables.incidents.filter(isOpenIncident).map((incident: Incident) => {
        return incident.title;
      }),
    ).toEqual(["Device unreachable"]);
    expect(tables.statusSetBy).toEqual(["Device unreachable"]);
    expect(monitorUnderTest.currentMonitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );

    // Still down: one incident.
    await poll(false);
    expect(tables.incidents).toHaveLength(1);

    // Back up: nothing matches, the monitor goes back online, and it resolves.
    await poll(true);

    expect(tables.incidents.filter(isOpenIncident)).toEqual([]);
    expect(tables.statusSetBy[tables.statusSetBy.length - 1]).toBe(
      DEFAULT_STATUS,
    );
    expect(monitorUnderTest.currentMonitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );
  });
});
