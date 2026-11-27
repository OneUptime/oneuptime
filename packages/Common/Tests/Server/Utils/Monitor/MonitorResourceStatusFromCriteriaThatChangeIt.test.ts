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
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorProbeLastResults, {
  MonitorProbeOfResult,
} from "../../../../Server/Utils/Monitor/MonitorProbeLastResults";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import ReceivingSilence from "../../../../Server/Utils/Monitor/ReceivingSilence";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import DomainMonitorResponse from "../../../../Types/Monitor/DomainMonitor/DomainMonitorResponse";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import { MonitorEvaluationEvent } from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SslMonitorResponse from "../../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { ProbeConnectionStatus } from "../../../../Models/DatabaseModels/Probe";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import UptimePrecision from "../../../../Types/StatusPage/UptimePrecision";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import UptimeUtil from "../../../../Utils/Uptime/UptimeUtil";
import {
  MonitorRecordTables,
  isOpenAlert,
  isOpenIncident,
  mockMonitorRecordTables,
} from "../../TestingUtils/MonitorRecordTables";
import {
  MonitorStatusTimelineRows,
  mockMonitorStatusTimelineRows,
} from "../../TestingUtils/MonitorStatusTimelineRows";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A CRITERIA THAT CHANGES NO STATUS NEVER KEEPS A STALE STATUS, on every
 * kind of monitor (OneUptime issue #11238).
 *
 * The status comes from the first criteria that matches among those that
 * change the status, in the order given; when none of them matches, the
 * monitor goes where a check that matched nothing takes it. An alert-only
 * criteria that matched first used to leave the monitor in the status an
 * earlier check had set, for as long as it kept matching.
 *
 * Each check goes through MonitorResourceUtil.monitorResource - the path
 * every probe result, agent report, telemetry check, incoming request and
 * email takes - with the real evaluator and the real status change, and the
 * incidents, alerts and status timeline kept in memory: probe-checked
 * monitors (Website, SSL Certificate, Domain, several probes agreeing), a
 * Server agent's reports, a telemetry check of a grouped Host monitor, an
 * Incoming Request and an Incoming Email monitor, and an SNMP trap.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11238bbb-0001-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11238bbb-0002-4000-8000-000000000002",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "11238bbb-0003-4000-8000-000000000003",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "11238bbb-0004-4000-8000-000000000004",
);
const STEP_ID: ObjectID = new ObjectID("11238bbb-0005-4000-8000-000000000005");

const PROBE_ONE: ObjectID = new ObjectID(
  "11238bbb-0006-4000-8000-000000000006",
);
const PROBE_TWO: ObjectID = new ObjectID(
  "11238bbb-0007-4000-8000-000000000007",
);
const PROBE_THREE: ObjectID = new ObjectID(
  "11238bbb-0008-4000-8000-000000000008",
);

function monitorStatus(name: string, priority: number): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = ObjectID.generate();
  status.name = name;
  status.priority = priority;
  return status;
}

const ONLINE: MonitorStatus = monitorStatus("Online", 1);
const DEGRADED: MonitorStatus = monitorStatus("Degraded", 2);
const OFFLINE: MonitorStatus = monitorStatus("Offline", 3);
const STATUSES: Array<MonitorStatus> = [ONLINE, DEGRADED, OFFLINE];

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
    monitorStatusId: spec.status?.id,
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
    alerts: spec.alert
      ? [
          {
            id: `${spec.id}-alert`,
            title: spec.name,
            description: "",
            alertSeverityId: ALERT_SEVERITY_ID,
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus: Boolean(spec.status),
    createIncidents: Boolean(spec.incident),
    createAlerts: Boolean(spec.alert),
    isEnabled: true,
  };

  return instance;
}

let tables: MonitorRecordTables;
let timeline: MonitorStatusTimelineRows;
let monitorUnderTest: Monitor;

// The other probes of a probe-checked monitor, and their last results.
let otherProbes: Array<{ probeId: ObjectID; result: DataToProcess }> = [];

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

function watch(input: {
  monitorType: MonitorType;
  step: MonitorStep;
  currentStatus?: MonitorStatus | undefined;
  minimumProbeAgreement?: number | undefined;
}): void {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [input.step],
    defaultMonitorStatusId: ONLINE.id!,
  };

  monitorUnderTest = new Monitor();
  monitorUnderTest.id = MONITOR_ID;
  monitorUnderTest.projectId = PROJECT_ID;
  monitorUnderTest.name = "Acme";
  monitorUnderTest.monitorType = input.monitorType;
  monitorUnderTest.monitorSteps = monitorSteps;
  monitorUnderTest.currentMonitorStatusId = (input.currentStatus || ONLINE).id!;
  // Measured long ago: nothing stamps it.
  monitorUnderTest.firstMeasuredAt = new Date("2026-01-01T00:00:00.000Z");

  if (input.minimumProbeAgreement !== undefined) {
    monitorUnderTest.minimumProbeAgreement = input.minimumProbeAgreement;
  }

  tables = mockMonitorRecordTables({
    getMonitor: (): Monitor => {
      return monitorUnderTest;
    },
    projectId: PROJECT_ID,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    alertSeverityId: ALERT_SEVERITY_ID,
  });

  timeline = mockMonitorStatusTimelineRows({
    getMonitor: (): Monitor => {
      return monitorUnderTest;
    },
    projectId: PROJECT_ID,
    statuses: STATUSES,
  });

  otherProbes = [];

  /*
   * The monitor's probes, as storing a probe's result reads them: the one
   * reporting, and the others with their last result for the step.
   */
  jest
    .spyOn(MonitorProbeLastResults, "storeResultAndReadProbes")
    .mockImplementation((async () => {
      const probes: Array<MonitorProbeOfResult> = [
        {
          monitorProbeId: ObjectID.generate(),
          probeId: PROBE_ONE,
          isEnabled: true,
          probeName: "Probe One",
          probeConnectionStatus: ProbeConnectionStatus.Connected,
          resultForJudgedStep: undefined,
        },
        ...otherProbes.map(
          (probe: {
            probeId: ObjectID;
            result: DataToProcess;
          }): MonitorProbeOfResult => {
            return {
              monitorProbeId: ObjectID.generate(),
              probeId: probe.probeId,
              isEnabled: true,
              probeName:
                probe.probeId.toString() === PROBE_TWO.toString()
                  ? "Probe Two"
                  : "Probe Three",
              probeConnectionStatus: ProbeConnectionStatus.Connected,
              resultForJudgedStep: JSON.parse(
                JSON.stringify({
                  ...(probe.result as JSONObject),
                  probeId: probe.probeId,
                  monitorStepId: STEP_ID,
                  monitoredAt: OneUptimeDate.getCurrentDate(),
                }),
              ) as ProbeMonitorResponse,
            };
          },
        ),
      ];

      return { probes: probes, isResultStored: true };
    }) as never);

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
  const current: string | undefined =
    monitorUnderTest.currentMonitorStatusId?.toString();

  return (
    STATUSES.find((candidate: MonitorStatus): boolean => {
      return candidate.id!.toString() === current;
    })?.name || ""
  );
}

function openIncidents(): Array<string> {
  return tables.incidents.filter(isOpenIncident).map((incident: Incident) => {
    return incident.title || "";
  });
}

function openAlerts(): Array<string> {
  return tables.alerts
    .filter(isOpenAlert)
    .map((alert: Alert) => {
      return alert.title || "";
    })
    .sort();
}

function messagesOf(
  response: ProbeApiIngestResponse,
  type: MonitorEvaluationEvent["type"],
): Array<string> {
  return (response.evaluationSummary?.events || [])
    .filter((event: MonitorEvaluationEvent): boolean => {
      return event.type === type;
    })
    .map((event: MonitorEvaluationEvent): string => {
      return event.message || "";
    });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---- A website, checked by probes -------------------------------------------

const isDown: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};
const isUp: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.True,
  value: undefined,
};

function slowerThan(ms: number): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.GreaterThan,
    value: ms,
  };
}

function atMost(ms: number): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.LessThanOrEqualTo,
    value: ms,
  };
}

const SITE_DOWN: CriteriaSpec = {
  id: "site-down",
  name: "Site is down",
  filters: [isDown],
  status: OFFLINE,
  incident: true,
};
const SITE_SLOW: CriteriaSpec = {
  id: "site-slow",
  name: "Site is slow",
  filters: [slowerThan(2000)],
  alert: true,
};
const SERVER_ERRORS: CriteriaSpec = {
  id: "server-errors",
  name: "Server errors",
  filters: [
    {
      checkOn: CheckOn.ResponseStatusCode,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 500,
    },
  ],
  status: DEGRADED,
  incident: true,
};
const SITE_UP: CriteriaSpec = {
  id: "site-up",
  name: "Site is up",
  filters: [isUp],
  status: ONLINE,
};

function siteCheck(input: {
  isUp: boolean;
  responseTimeInMs?: number | undefined;
  statusCode?: number | undefined;
  probeId?: ObjectID | undefined;
}): DataToProcess {
  const result: ProbeMonitorResponse = {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: STEP_ID,
    probeId: input.probeId || PROBE_ONE,
    isOnline: input.isUp,
    responseTimeInMs: input.responseTimeInMs ?? 120,
    responseCode: input.isUp ? input.statusCode ?? 200 : undefined,
    responseBody: "ok",
    responseHeaders: {},
    failureCause: input.isUp ? "" : "Request timed out",
    monitoredAt: OneUptimeDate.getCurrentDate(),
  };

  return result as DataToProcess;
}

const FAST: DataToProcess = siteCheck({ isUp: true });
const SLOW: DataToProcess = siteCheck({ isUp: true, responseTimeInMs: 3500 });
const DOWN: DataToProcess = siteCheck({ isUp: false });

function watchSite(
  specs: Array<CriteriaSpec>,
  currentStatus?: MonitorStatus | undefined,
): void {
  watch({
    monitorType: MonitorType.Website,
    step: stepWith(specs.map(criteria)),
    currentStatus: currentStatus,
  });
}

describe("a website whose slow answers only alert (#11238)", () => {
  beforeEach(() => {
    watchSite([SITE_DOWN, SITE_SLOW, SITE_UP]);
  });

  it("down, then back but slow: Online, its incident resolved, the slow alert open", async () => {
    await check(FAST);
    await check(DOWN);

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Site is down"]);

    const response: ProbeApiIngestResponse = await check(SLOW);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Site is slow"]);
    expect(response.criteriaMetId).toBe("site-slow");
    expect(response.statusCriteriaId).toBe("site-up");
    expect(messagesOf(response, "monitor-status-changed")).toEqual([
      'Monitor status changed to "Online" because criteria "Site is up" was met.',
    ]);
  });

  it("stays Online, with one alert, for as long as it stays slow; fast again resolves the alert", async () => {
    await check(DOWN);

    for (let checks: number = 0; checks < 5; checks++) {
      await check(SLOW);

      expect(status()).toBe("Online");
      expect(openAlerts()).toEqual(["Site is slow"]);
    }

    expect(tables.alerts).toHaveLength(1);

    await check(FAST);

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });

  it("down while the slow alert is open: Offline, with the incident, and the alert resolves", async () => {
    await check(SLOW);
    expect(openAlerts()).toEqual(["Site is slow"]);

    await check(DOWN);

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Site is down"]);
    expect(openAlerts()).toEqual([]);
  });

  it("the status timeline holds one Offline row, as long as the site was down, and uptime counts only it", async () => {
    await check(FAST); // 09:05
    await check(DOWN); // 09:10, down until the next check
    await check(SLOW); // 09:15
    await check(SLOW); // 09:20

    expect(timeline.statusNames()).toEqual(["Online", "Offline", "Online"]);

    const offlineRow: MonitorStatusTimeline = timeline.rows[1]!;

    expect(
      OneUptimeDate.getMinutesBetweenTwoDates(
        offlineRow.startsAt!,
        offlineRow.endsAt!,
      ),
    ).toBe(CHECK_EVERY_MINUTES);

    // The status timeline's own cause names the criteria that set it.
    expect(timeline.rows[2]!.rootCause).toContain(
      "**Criteria Name**: Site is up",
    );

    expect(
      UptimeUtil.calculateUptimePercentage(
        timeline.rows,
        UptimePrecision.TWO_DECIMAL,
        [OFFLINE, DEGRADED],
        { startDate: START, endDate: OneUptimeDate.getCurrentDate() },
      ),
    ).toBe(75);
  });

  it("the status page's banner is Online again on the check the site answers, slow or not", async () => {
    const banner: () => string | null = (): string | null => {
      const resource: StatusPageResource = new StatusPageResource();
      resource._id = ObjectID.generate().toString();
      resource.monitorId = MONITOR_ID;
      resource.monitor = monitorUnderTest;

      return (
        StatusPageService.getOverallMonitorStatus({
          statusPageResources: [resource],
          monitorStatuses: STATUSES,
          monitorGroupCurrentStatuses: {},
        })?.name || null
      );
    };

    await check(DOWN);
    expect(banner()).toBe("Offline");

    await check(SLOW);
    expect(banner()).toBe("Online");
  });
});

describe("a website whose criteria that change the status come in an order of their own (#11238)", () => {
  it("degraded by server errors, then answering slowly with a 200: Online, from the criteria that says so", async () => {
    watchSite([SITE_SLOW, SERVER_ERRORS, SITE_DOWN, SITE_UP]);

    await check(siteCheck({ isUp: true, statusCode: 503 }));

    expect(status()).toBe("Degraded");
    expect(openIncidents()).toEqual(["Server errors"]);

    await check(SLOW);

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Site is slow"]);
  });

  it("slow and answering 503: Degraded, from the first criteria that changes the status", async () => {
    watchSite([SITE_SLOW, SERVER_ERRORS, SITE_DOWN, SITE_UP]);

    await check(
      siteCheck({ isUp: true, responseTimeInMs: 3500, statusCode: 503 }),
    );

    expect(status()).toBe("Degraded");
  });

  it("with no criteria that says it is up, back but slow: its default status, said as such", async () => {
    watchSite([SITE_DOWN, SITE_SLOW], OFFLINE);

    const response: ProbeApiIngestResponse = await check(SLOW);

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual(["Site is slow"]);
    expect(messagesOf(response, "monitor-status-changed")).toEqual([
      'Monitor status reverted to "Online" because no criteria that changes the status was met.',
    ]);

    // Its own row, with its own cause, telling no owner.
    const row: MonitorStatusTimeline = timeline.rows[timeline.rows.length - 1]!;

    expect(row.rootCause).toBe(
      "No monitoring criteria that changes the status met. Change to default status.",
    );
    expect(row.isOwnerNotified).toBe(true);
  });

  it("a check that matches nothing still reverts in its old words", async () => {
    watchSite([SITE_DOWN, SITE_SLOW], OFFLINE);

    const response: ProbeApiIngestResponse = await check(FAST);

    expect(status()).toBe("Online");
    expect(messagesOf(response, "monitor-status-changed")).toEqual([
      'Monitor status reverted to "Online" because no monitoring criteria were met.',
    ]);
    expect(timeline.rows[timeline.rows.length - 1]!.rootCause).toBe(
      "No monitoring criteria met. Change to default status. ",
    );
  });

  it("already on its default status with only the slow alert matching: no new row", async () => {
    watchSite([SITE_DOWN, SITE_SLOW]);

    await check(SLOW);

    expect(status()).toBe("Online");
    expect(timeline.rows).toHaveLength(1);
  });
});

/*
 * Which criteria opens and resolves incidents and alerts is unchanged: on a
 * monitor that stops at its first match, that first match. A criteria below
 * it that sets the status opens nothing on that check.
 */
describe("a website whose alert-only criteria comes first: incidents and alerts as before (#11238)", () => {
  beforeEach(() => {
    watchSite([SITE_SLOW, SITE_DOWN, SITE_UP]);
  });

  it("slow and down at once: Offline, from 'Site is down', which opens nothing on that check", async () => {
    const response: ProbeApiIngestResponse = await check(
      siteCheck({ isUp: false, responseTimeInMs: 30000 }),
    );

    expect(status()).toBe("Offline");
    expect(response.criteriaMetId).toBe("site-slow");
    expect(response.statusCriteriaId).toBe("site-down");
    expect(openAlerts()).toEqual(["Site is slow"]);
    expect(openIncidents()).toEqual([]);
  });

  it("down and fast: 'Site is down' matches first and opens its incident; the slow alert resolves", async () => {
    await check(siteCheck({ isUp: false, responseTimeInMs: 30000 }));
    await check(siteCheck({ isUp: false, responseTimeInMs: 100 }));

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Site is down"]);
    expect(openAlerts()).toEqual([]);
  });

  it("slow and down again: the slow alert matches first, so the incident resolves while the status stays Offline", async () => {
    await check(siteCheck({ isUp: false, responseTimeInMs: 100 }));
    expect(openIncidents()).toEqual(["Site is down"]);

    await check(siteCheck({ isUp: false, responseTimeInMs: 30000 }));

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Site is slow"]);
  });

  it("slow and up: Online, with the slow alert", async () => {
    await check(DOWN);
    await check(SLOW);

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual(["Site is slow"]);
  });
});

describe("the recovery margin (#10743) holds while an alert-only criteria matches", () => {
  const FIRING: CriteriaSpec = {
    id: "response-firing",
    name: "Response above 3 s",
    filters: [slowerThan(3000)],
    status: DEGRADED,
    incident: true,
  };
  const WARNING: CriteriaSpec = {
    id: "response-warning",
    name: "Response above 2 s",
    filters: [slowerThan(2000)],
    alert: true,
  };
  const RECOVERED: CriteriaSpec = {
    id: "response-recovered",
    name: "Response at or below 2.7 s",
    filters: [atMost(2700)],
    status: ONLINE,
  };

  beforeEach(() => {
    watchSite([FIRING, WARNING, RECOVERED]);
  });

  it("inside the margin with the warning matching: Degraded is kept, and the log says for which criteria", async () => {
    await check(siteCheck({ isUp: true, responseTimeInMs: 3500 }));
    expect(status()).toBe("Degraded");

    const response: ProbeApiIngestResponse = await check(
      siteCheck({ isUp: true, responseTimeInMs: 2900 }),
    );

    expect(status()).toBe("Degraded");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Response above 2 s"]);
    expect(messagesOf(response, "monitor-status-kept")).toEqual([
      'The monitor keeps its status: no criteria that changes the status matched, and it comes back only when "Response at or below 2.7 s" is met.',
    ]);
  });

  it("past the margin with the warning still matching: Online, from the recovery criteria", async () => {
    await check(siteCheck({ isUp: true, responseTimeInMs: 3500 }));
    await check(siteCheck({ isUp: true, responseTimeInMs: 2900 }));
    await check(siteCheck({ isUp: true, responseTimeInMs: 2500 }));

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual(["Response above 2 s"]);

    await check(siteCheck({ isUp: true, responseTimeInMs: 900 }));

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });
});

// ---- Several probes ------------------------------------------------------

describe("a website checked by two probes that must agree (#11238)", () => {
  beforeEach(() => {
    watchSite([SITE_DOWN, SITE_SLOW, SITE_UP], OFFLINE);
  });

  it("both answer slowly: Online, with one slow alert", async () => {
    otherProbes = [
      {
        probeId: PROBE_TWO,
        result: siteCheck({
          isUp: true,
          responseTimeInMs: 3200,
          probeId: PROBE_TWO,
        }),
      },
    ];

    await check(SLOW);

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual(["Site is slow"]);
  });

  it("one answers slowly, one fast: nothing opens, and the status they agree on is set", async () => {
    otherProbes = [
      {
        probeId: PROBE_TWO,
        result: siteCheck({ isUp: true, probeId: PROBE_TWO }),
      },
    ];

    const response: ProbeApiIngestResponse = await check(SLOW);

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual([]);
    expect(messagesOf(response, "probe-agreement")).toEqual([
      "Probe agreement not reached: 1/2 probes agree (2 active probes total). Nothing opens or resolves.",
      "Probe agreement on the monitor's status reached: 2/2 probes agree (2 active probes total).",
    ]);
    // The status change says which probes agree.
    expect(timeline.rows[timeline.rows.length - 1]!.rootCause).toContain(
      "**Probes in Agreement**",
    );
  });

  it("both slow, one answering 503: the slow alert opens, and the status they do not agree on is kept", async () => {
    watchSite([SITE_DOWN, SITE_SLOW, SERVER_ERRORS, SITE_UP], OFFLINE);
    otherProbes = [
      {
        probeId: PROBE_TWO,
        result: siteCheck({
          isUp: true,
          responseTimeInMs: 3200,
          statusCode: 503,
          probeId: PROBE_TWO,
        }),
      },
    ];

    const response: ProbeApiIngestResponse = await check(SLOW);

    expect(status()).toBe("Offline");
    expect(openAlerts()).toEqual(["Site is slow"]);
    expect(messagesOf(response, "probe-agreement")).toEqual([
      "Probe agreement reached: 2/2 probes agree (2 active probes total).",
      "Probe agreement on the monitor's status not reached: 1/2 probes agree (2 active probes total). Keeping its status.",
    ]);
  });

  it("without a criteria that changes no status, the probes agree as they always did", async () => {
    watchSite([SITE_DOWN, SITE_UP], OFFLINE);
    otherProbes = [
      {
        probeId: PROBE_TWO,
        result: siteCheck({ isUp: false, probeId: PROBE_TWO }),
      },
    ];

    const response: ProbeApiIngestResponse = await check(FAST);

    expect(status()).toBe("Offline");
    expect(messagesOf(response, "probe-agreement")).toEqual([
      "Probe agreement not reached: 1/2 probes agree (2 active probes total). Skipping status change.",
    ]);
    expect(timeline.rows).toHaveLength(1);
  });

  it("without a criteria that changes no status, an agreement sets the agreed criteria's status, as before", async () => {
    watchSite([SITE_DOWN, SITE_UP], OFFLINE);
    otherProbes = [
      {
        probeId: PROBE_TWO,
        result: siteCheck({ isUp: true, probeId: PROBE_TWO }),
      },
    ];

    const response: ProbeApiIngestResponse = await check(FAST);

    expect(status()).toBe("Online");
    expect(messagesOf(response, "probe-agreement")).toEqual([
      "Probe agreement reached: 2/2 probes agree (2 active probes total).",
    ]);
  });
});

describe("three probes, two of which must agree, keep the recovery margin when they agree nothing matched", () => {
  const FIRING: CriteriaSpec = {
    id: "response-firing",
    name: "Response above 3 s",
    filters: [slowerThan(3000)],
    status: DEGRADED,
    incident: true,
  };
  const RECOVERED: CriteriaSpec = {
    id: "response-recovered",
    name: "Response at or below 2.7 s",
    filters: [atMost(2700)],
    status: ONLINE,
  };

  it("this probe still sees the problem, the other two sit inside the margin: Degraded is kept", async () => {
    watch({
      monitorType: MonitorType.Website,
      step: stepWith([criteria(FIRING), criteria(RECOVERED)]),
      currentStatus: DEGRADED,
      minimumProbeAgreement: 2,
    });

    otherProbes = [
      {
        probeId: PROBE_TWO,
        result: siteCheck({
          isUp: true,
          responseTimeInMs: 2900,
          probeId: PROBE_TWO,
        }),
      },
      {
        probeId: PROBE_THREE,
        result: siteCheck({
          isUp: true,
          responseTimeInMs: 2950,
          probeId: PROBE_THREE,
        }),
      },
    ];

    const response: ProbeApiIngestResponse = await check(
      siteCheck({ isUp: true, responseTimeInMs: 3500 }),
    );

    expect(status()).toBe("Degraded");
    expect(messagesOf(response, "monitor-status-kept")).toEqual([
      'The monitor keeps its status: no criteria matched, and it comes back only when "Response at or below 2.7 s" is met.',
    ]);
  });
});

// ---- SSL Certificate and Domain monitors' own criteria -----------------------

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

function sslCheck(ssl: SslMonitorResponse | undefined): DataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: STEP_ID,
    probeId: PROBE_ONE,
    isOnline: true,
    responseTimeInMs: 80,
    failureCause: "",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    sslResponse: ssl,
  } as unknown as DataToProcess;
}

function certificateExpiringIn(ms: number): SslMonitorResponse {
  return {
    isValidCertificate: true,
    isSelfSigned: false,
    commonName: "acme.example.com",
    createdAt: new Date(Date.now() - 10 * DAY_IN_MS),
    expiresAt: new Date(Date.now() + ms),
  };
}

function defaultStepOf(monitorType: MonitorType): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Acme",
    monitorType: monitorType,
    onlineMonitorStatusId: ONLINE.id!,
    offlineMonitorStatusId: OFFLINE.id!,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
    warningAlertSeverityId: ALERT_SEVERITY_ID,
  });
  step.id = STEP_ID;
  return step;
}

describe("an SSL Certificate monitor with the criteria it starts with (#11238)", () => {
  beforeEach(() => {
    watch({
      monitorType: MonitorType.SSLCertificate,
      step: defaultStepOf(MonitorType.SSLCertificate),
    });
  });

  /*
   * A short-lived certificate is always within its expiry warning: renewed
   * after one that was not valid, its "expires soon" alert used to keep the
   * monitor Offline for as long as it was served.
   */
  it("a certificate that was not valid, replaced by one that expires in ten days: Online, with the expiry alert", async () => {
    await check(sslCheck(certificateExpiringIn(200 * DAY_IN_MS)));
    expect(status()).toBe("Online");

    await check(
      sslCheck({
        isValidCertificate: false,
        certificateValidationErrorCode: "CERT_HAS_EXPIRED",
        isSelfSigned: false,
        expiresAt: new Date(Date.now() - DAY_IN_MS),
      }),
    );

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Acme certificate is not valid"]);

    await check(sslCheck(certificateExpiringIn(10 * DAY_IN_MS)));

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Acme certificate expires soon"]);

    // Renewed for good: the alert resolves.
    await check(sslCheck(certificateExpiringIn(365 * DAY_IN_MS)));

    expect(openAlerts()).toEqual([]);
    expect(status()).toBe("Online");
  });
});

describe("a Domain monitor with the criteria it starts with (#11238)", () => {
  function domainCheck(expiresInMs: number): DataToProcess {
    const domain: DomainMonitorResponse = {
      isOnline: true,
      responseTimeInMs: 200,
      failureCause: "",
      domainName: "acme.example",
      registrar: "Example Registrar",
      expiresDate: new Date(Date.now() + expiresInMs).toISOString(),
    };

    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      monitorStepId: STEP_ID,
      probeId: PROBE_ONE,
      isOnline: true,
      responseTimeInMs: 200,
      failureCause: "",
      monitoredAt: OneUptimeDate.getCurrentDate(),
      domainResponse: domain,
    } as unknown as DataToProcess;
  }

  it("expired, then renewed with two weeks left: Online, with the expiry alert", async () => {
    watch({
      monitorType: MonitorType.Domain,
      step: defaultStepOf(MonitorType.Domain),
    });

    await check(domainCheck(-DAY_IN_MS));
    expect(status()).toBe("Offline");

    await check(domainCheck(14 * DAY_IN_MS));

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Acme domain expires soon"]);
  });
});

// ---- An incoming request and an incoming email -------------------------------

describe("an Incoming Request monitor whose warnings only alert (#11238)", () => {
  const CRITICAL: CriteriaSpec = {
    id: "request-critical",
    name: "A critical event",
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "critical",
      },
    ],
    status: OFFLINE,
    incident: true,
  };
  const WARNING: CriteriaSpec = {
    id: "request-warning",
    name: "A warning",
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "warning",
      },
    ],
    alert: true,
  };
  const ALL_WELL: CriteriaSpec = {
    id: "request-all-well",
    name: "All is well",
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.NotContains,
        value: "critical",
      },
    ],
    status: ONLINE,
  };

  function request(body: string): DataToProcess {
    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      requestBody: body,
      requestHeaders: {},
      requestMethod: "POST",
      incomingRequestReceivedAt: OneUptimeDate.getCurrentDate(),
      checkedAt: OneUptimeDate.getCurrentDate(),
    } as unknown as DataToProcess;
  }

  beforeEach(() => {
    watch({
      monitorType: MonitorType.IncomingRequest,
      step: stepWith([CRITICAL, WARNING, ALL_WELL].map(criteria)),
    });
  });

  it("a critical event, then a warning: Online, the warning's alert open, the incident resolved", async () => {
    await check(request('{"level":"critical"}'));

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["A critical event"]);

    await check(request('{"level":"warning"}'));

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["A warning"]);
  });

  it("a request that is both critical and a warning: Offline, as the first criteria says", async () => {
    await check(request('{"level":"critical","note":"warning"}'));

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["A critical event"]);
  });
});

describe("an Incoming Email monitor whose warnings only alert (#11238)", () => {
  function email(subject: string): DataToProcess {
    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      emailFrom: "alerts@acme.example",
      emailTo: "monitor@oneuptime.example",
      emailSubject: subject,
      emailBody: subject,
      emailHeaders: {},
      emailReceivedAt: OneUptimeDate.getCurrentDate(),
      checkedAt: OneUptimeDate.getCurrentDate(),
    } as unknown as DataToProcess;
  }

  function subjectContains(word: string): CriteriaFilter {
    return {
      checkOn: CheckOn.EmailSubject,
      filterType: FilterType.Contains,
      value: word,
    };
  }

  it("a DOWN email, then a WARNING email: Online, with the warning's alert", async () => {
    watch({
      monitorType: MonitorType.IncomingEmail,
      step: stepWith(
        [
          {
            id: "email-down",
            name: "Backup failed",
            filters: [subjectContains("FAILED")],
            status: OFFLINE,
            incident: true,
          },
          {
            id: "email-warning",
            name: "Backup slow",
            filters: [subjectContains("WARNING")],
            alert: true,
          },
          {
            id: "email-ok",
            name: "Backup done",
            filters: [subjectContains("Backup")],
            status: ONLINE,
          },
        ].map(criteria),
      ),
    });

    await check(email("Backup FAILED"));
    expect(status()).toBe("Offline");

    await check(email("Backup WARNING: took four hours"));

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Backup slow"]);
  });
});

// ---- A server agent's reports: a grouped monitor ----------------------------

describe("a Server monitor whose full disks only alert, one per disk (#11238)", () => {
  function agentReport(disks: Record<string, number>): DataToProcess {
    const now: Date = OneUptimeDate.getCurrentDate();

    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      hostname: "db-01",
      requestReceivedAt: now,
      timeNow: now,
      onlyCheckRequestReceivedAt: false,
      basicInfrastructureMetrics: {
        cpuMetrics: { percentUsed: 10, cores: 4 },
        memoryMetrics: {
          total: 100,
          free: 90,
          used: 10,
          percentFree: 90,
          percentUsed: 10,
        },
        diskMetrics: Object.entries(disks).map(
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

  beforeEach(() => {
    watch({
      monitorType: MonitorType.Server,
      step: stepWith(
        [
          {
            id: "server-offline",
            name: "Server offline",
            filters: [
              {
                checkOn: CheckOn.IsOnline,
                filterType: FilterType.False,
                value: undefined,
              },
            ],
            status: OFFLINE,
            incident: true,
          },
          {
            id: "disk-full",
            name: "Disk full",
            filters: [
              {
                checkOn: CheckOn.DiskUsagePercent,
                filterType: FilterType.GreaterThan,
                value: "90",
                serverMonitorOptions: { diskPath: "*" },
              },
            ],
            alert: true,
          },
          {
            id: "server-online",
            name: "Server online",
            filters: [
              {
                checkOn: CheckOn.IsOnline,
                filterType: FilterType.True,
                value: undefined,
              },
            ],
            status: ONLINE,
          },
        ].map(criteria),
      ),
    });
  });

  it("silent, then reporting again with a full disk: Online, with the disk's alert", async () => {
    await check(agentReport({ "/": 40 }));
    expect(status()).toBe("Online");

    // No report for ten minutes: the online check says the server is offline.
    jest.setSystemTime(
      OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 10),
    );
    jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
      wallMinutes: 10,
      receivingMinutes: 10,
      notReceivingMinutes: 0,
    });

    const lastReport: DataToProcess = agentReport({ "/": 40 });

    await MonitorResourceUtil.monitorResource({
      ...(lastReport as unknown as JSONObject),
      requestReceivedAt: OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        -10,
      ),
      onlyCheckRequestReceivedAt: true,
      timeNow: OneUptimeDate.getCurrentDate(),
    } as unknown as DataToProcess);

    jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
      wallMinutes: 0,
      receivingMinutes: 0,
      notReceivingMinutes: 0,
    });

    expect(status()).toBe("Offline");
    expect(openIncidents()).toEqual(["Server offline"]);

    await check(agentReport({ "/": 40, "/data": 97 }));

    expect(status()).toBe("Online");
    expect(openIncidents()).toEqual([]);
    expect(openAlerts()).toEqual(["Disk full - Disk: /data"]);
  });
});

// ---- A telemetry check: a grouped Host monitor with a recovery margin ---------

describe("a grouped Host monitor with a per-disk warning that only alerts (#11238)", () => {
  const DISK_START: number = Date.UTC(2026, 10, 27, 9, 0, 0);
  const DATA_DISK: { mountpoint: string; device: string } = {
    mountpoint: "/data",
    device: "/dev/sdb1",
  };
  const ROOT_DISK: { mountpoint: string; device: string } = {
    mountpoint: "/",
    device: "/dev/sda1",
  };

  let hostStep: MonitorStep;

  // The template fires above 90% and recovers at or below 81%.
  function filesystemStepWithWarning(): MonitorStep {
    const step: MonitorStep = getHostAlertTemplateById(
      "host-high-filesystem",
    )!.getMonitorStep({
      hostIdentifier: "web-01",
      onlineMonitorStatusId: ONLINE.id!,
      offlineMonitorStatusId: OFFLINE.id!,
      defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
      defaultAlertSeverityId: ALERT_SEVERITY_ID,
      monitorName: "web-01",
    });
    step.id = STEP_ID;

    const instances: Array<MonitorCriteriaInstance> =
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

    const firing: MonitorCriteriaInstance = instances.find(
      (instance: MonitorCriteriaInstance): boolean => {
        return (
          instance.data!.monitorStatusId?.toString() === OFFLINE.id!.toString()
        );
      },
    )!;

    // A warning above 75%, for each disk: an alert, and no status.
    const warning: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    warning.data = {
      ...firing.data!,
      id: "disk-warning",
      name: "Disk above 75%",
      filters: firing.data!.filters.map((filter: CriteriaFilter) => {
        // The template compares in percent: 90 is 90%.
        return { ...filter, value: 75 };
      }),
      incidents: [],
      alerts: [
        {
          id: "disk-warning-alert",
          title: "Disk above 75%",
          description: "",
          alertSeverityId: ALERT_SEVERITY_ID,
          autoResolveAlert: true,
          onCallPolicyIds: [],
        },
      ],
      createIncidents: false,
      createAlerts: true,
      changeMonitorStatus: false,
      monitorStatusId: undefined,
      recoveryFilters: undefined,
    };

    instances.splice(instances.indexOf(firing) + 1, 0, warning);

    return step;
  }

  function diskResults(percent: number): Array<AggregatedResult> {
    const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(hostStep)!;

    const queryResults: Array<AggregatedResult> = view.queryConfigs.map(
      (): AggregatedResult => {
        return {
          data: [0, 1, 2, 3, 4].map((minute: number): AggregateModel => {
            return {
              timestamp: new Date(DISK_START + minute * 60_000),
              value: percent / 100,
            } as AggregateModel;
          }),
        };
      },
    );

    return [
      ...queryResults,
      ...view.formulaConfigs.map(
        (formula: MetricFormulaConfigData): AggregatedResult => {
          return MetricFormulaEvaluator.evaluateFormula({
            formula: formula.metricFormulaData.metricFormula,
            queryConfigs: view.queryConfigs,
            formulaConfigs: [],
            results: queryResults,
          });
        },
      ),
    ];
  }

  function telemetryCheck(
    disks: Array<[{ mountpoint: string; device: string }, number]>,
  ): DataToProcess {
    const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(hostStep)!;

    const seriesBreakdown: Array<MetricSeriesResult> = disks.map(
      ([disk, percent]: [
        { mountpoint: string; device: string },
        number,
      ]): MetricSeriesResult => {
        return {
          fingerprint: MetricSeriesFingerprint.computeFingerprint(disk),
          labels: { ...disk },
          aggregatedResults: diskResults(percent),
        };
      },
    );

    const response: MetricMonitorResponse = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      metricViewConfig: view,
      metricResult: seriesBreakdown.flatMap((series: MetricSeriesResult) => {
        return series.aggregatedResults;
      }),
      seriesBreakdown: seriesBreakdown,
    };

    return response as unknown as DataToProcess;
  }

  beforeEach(() => {
    jest.setSystemTime(new Date(DISK_START + 5 * 60_000));
    hostStep = filesystemStepWithWarning();

    watch({ monitorType: MonitorType.Host, step: hostStep });
  });

  it("is judged per disk", () => {
    expect(MonitorStep.isJudgedPerSeries(hostStep)).toBe(true);
  });

  it("a disk at 96% takes it Offline; at 89% the margin keeps it Offline while the warning alerts", async () => {
    await check(
      telemetryCheck([
        [ROOT_DISK, 40],
        [DATA_DISK, 96],
      ]),
    );

    expect(status()).toBe("Offline");

    const response: ProbeApiIngestResponse = await check(
      telemetryCheck([
        [ROOT_DISK, 40],
        [DATA_DISK, 89],
      ]),
    );

    expect(status()).toBe("Offline");
    expect(response.statusCriteriaId).toBeUndefined();
    expect(messagesOf(response, "monitor-status-kept")).toHaveLength(1);
  });

  /*
   * The case the grouped recovery rule could not reach: the disk back under
   * 81% but still above the warning's 75%. The recovery criteria stands, but
   * the warning came first and changes no status, so the monitor stayed
   * Offline for as long as the disk sat between 75% and 81%.
   */
  it("the disk back at 80%: Online from the recovery criteria, with the warning's alert", async () => {
    await check(
      telemetryCheck([
        [ROOT_DISK, 40],
        [DATA_DISK, 96],
      ]),
    );
    await check(
      telemetryCheck([
        [ROOT_DISK, 40],
        [DATA_DISK, 80],
      ]),
    );

    expect(status()).toBe("Online");
    expect(openAlerts()).toEqual([
      "Disk above 75% - Mount: /data | Device: /dev/sdb1",
    ]);
  });
});

// ---- An SNMP trap: never the monitor's status ---------------------------------

describe("an SNMP trap that only alerts (#11238)", () => {
  const LINK_DOWN_TRAP: string = "1.3.6.1.6.3.1.1.5.3";

  function trap(): DataToProcess {
    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      monitorStepId: STEP_ID,
      probeId: PROBE_ONE,
      failureCause: "",
      monitoredAt: OneUptimeDate.getCurrentDate(),
      snmpTrapResponse: {
        sourceIpAddress: "10.20.0.5",
        snmpVersion: "v2c",
        receivedAt: OneUptimeDate.getCurrentDate(),
        trapOid: LINK_DOWN_TRAP,
        varbinds: [],
      },
    } as unknown as DataToProcess;
  }

  it("leaves the status as the polls set it, whatever it is, and opens its alert", async () => {
    watch({
      monitorType: MonitorType.NetworkDevice,
      step: stepWith(
        [
          {
            id: "device-unreachable",
            name: "Device unreachable",
            filters: [
              {
                checkOn: CheckOn.SnmpIsOnline,
                filterType: FilterType.False,
                value: undefined,
              },
            ],
            status: OFFLINE,
            incident: true,
          },
          {
            id: "link-down-trap",
            name: "Link down (trap)",
            filters: [
              {
                checkOn: CheckOn.SnmpTrapReceived,
                filterType: FilterType.EqualTo,
                value: LINK_DOWN_TRAP,
              },
            ],
            alert: true,
          },
        ].map(criteria),
      ),
      currentStatus: DEGRADED,
    });

    const response: ProbeApiIngestResponse = await check(trap());

    expect(response.criteriaMetId).toBe("link-down-trap");
    expect(response.statusCriteriaId).toBeUndefined();
    expect(status()).toBe("Degraded");
    expect(openAlerts()).toEqual(["Link down (trap)"]);
    expect(timeline.rows).toHaveLength(1);
  });
});

// ---- Drawn websites, checked again and again -------------------------------

/*
 * THE RULE, OVER DRAWN MONITORS AND CHECKS (#11238). Websites of two to five
 * criteria, drawn from one seed out of seven - down (Offline, an incident),
 * server errors (Degraded, an incident), very slow (Degraded), and four that
 * only alert: slow, very slow, an error code, a slow error - each in an
 * order of its own, are checked twelve times by answers of every kind.
 *
 * After each check, through the whole pipeline: the first criteria that
 * matches acts - the incident and the alert open are its own, and every
 * other criteria's resolve, as they always did - and the status is the one
 * the first match among the criteria that change the status sets, or the
 * default status when none of them matches. None of these criteria only
 * brings the monitor back to its default status, so no recovery margin
 * keeps a status: a stale status could only come from the old rule.
 */

interface DrawnAnswer {
  name: string;
  isUp: boolean;
  responseTimeInMs: number;
  statusCode: number;
}

interface DrawnCriteria {
  spec: CriteriaSpec;
  // Whether this criteria matches an answer, judged alone.
  matches: (answer: DrawnAnswer) => boolean;
}

const DRAWN_ANSWERS: Array<DrawnAnswer> = [
  { name: "down", isUp: false, responseTimeInMs: 120, statusCode: 0 },
  {
    name: "down and slow",
    isUp: false,
    responseTimeInMs: 3500,
    statusCode: 0,
  },
  { name: "fast", isUp: true, responseTimeInMs: 120, statusCode: 200 },
  { name: "slow", isUp: true, responseTimeInMs: 3500, statusCode: 200 },
  { name: "very slow", isUp: true, responseTimeInMs: 6000, statusCode: 200 },
  { name: "fast 503", isUp: true, responseTimeInMs: 120, statusCode: 503 },
  { name: "slow 503", isUp: true, responseTimeInMs: 3500, statusCode: 503 },
  { name: "fast 404", isUp: true, responseTimeInMs: 120, statusCode: 404 },
  { name: "slow 404", isUp: true, responseTimeInMs: 3500, statusCode: 404 },
];

function codeAtLeast(code: number): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseStatusCode,
    filterType: FilterType.GreaterThanOrEqualTo,
    value: code,
  };
}

const DRAWN_CRITERIA: Array<DrawnCriteria> = [
  {
    spec: SITE_DOWN,
    matches: (answer: DrawnAnswer): boolean => {
      return !answer.isUp;
    },
  },
  {
    spec: SERVER_ERRORS,
    matches: (answer: DrawnAnswer): boolean => {
      return answer.isUp && answer.statusCode >= 500;
    },
  },
  {
    spec: {
      id: "very-slow-degraded",
      name: "Very slow is degraded",
      filters: [slowerThan(5000)],
      status: DEGRADED,
    },
    matches: (answer: DrawnAnswer): boolean => {
      return answer.responseTimeInMs > 5000;
    },
  },
  {
    spec: SITE_SLOW,
    matches: (answer: DrawnAnswer): boolean => {
      return answer.responseTimeInMs > 2000;
    },
  },
  {
    spec: {
      id: "very-slow-alert",
      name: "Site is very slow",
      filters: [slowerThan(5000)],
      alert: true,
    },
    matches: (answer: DrawnAnswer): boolean => {
      return answer.responseTimeInMs > 5000;
    },
  },
  {
    spec: {
      id: "error-code",
      name: "Site answers an error",
      filters: [codeAtLeast(400)],
      alert: true,
    },
    matches: (answer: DrawnAnswer): boolean => {
      return answer.isUp && answer.statusCode >= 400;
    },
  },
  {
    spec: {
      id: "slow-error",
      name: "Slow error",
      filters: [slowerThan(2000), codeAtLeast(400)],
      alert: true,
    },
    matches: (answer: DrawnAnswer): boolean => {
      return (
        answer.isUp &&
        answer.responseTimeInMs > 2000 &&
        answer.statusCode >= 400
      );
    },
  },
];

const DRAWN_MONITORS: number = 60;
const CHECKS_PER_DRAWN_MONITOR: number = 12;

interface Expected {
  status: string;
  incidents: Array<string>;
  alerts: Array<string>;
}

// What the rule says follows an answer, from each criteria judged alone.
function expectedAfter(
  monitorCriteria: Array<DrawnCriteria>,
  answer: DrawnAnswer,
): Expected {
  const firstIndex: number = monitorCriteria.findIndex(
    (drawn: DrawnCriteria): boolean => {
      return drawn.matches(answer);
    },
  );
  const first: DrawnCriteria | undefined = monitorCriteria[firstIndex];

  const setsStatus: DrawnCriteria | undefined = !first
    ? undefined
    : first.spec.status
      ? first
      : monitorCriteria
          .slice(firstIndex + 1)
          .find((drawn: DrawnCriteria): boolean => {
            return Boolean(drawn.spec.status) && drawn.matches(answer);
          });

  return {
    status: setsStatus?.spec.status?.name || "Online",
    incidents: first?.spec.incident ? [first.spec.name] : [],
    alerts: first?.spec.alert ? [first.spec.name] : [],
  };
}

function drawMonitor(random: SeededRandom): Array<DrawnCriteria> {
  const monitorCriteria: Array<DrawnCriteria> = shuffled(
    DRAWN_CRITERIA,
    random,
  ).slice(0, 2 + random(4));

  jest.restoreAllMocks();
  jest.setSystemTime(START);
  watchSite(
    monitorCriteria.map((drawn: DrawnCriteria): CriteriaSpec => {
      return drawn.spec;
    }),
  );

  return monitorCriteria;
}

async function answerWith(answer: DrawnAnswer): Promise<void> {
  await check(
    siteCheck({
      isUp: answer.isUp,
      responseTimeInMs: answer.responseTimeInMs,
      ...(answer.isUp ? { statusCode: answer.statusCode } : {}),
    }),
  );
}

function idsOf(monitorCriteria: Array<DrawnCriteria>): Array<string> {
  return monitorCriteria.map((drawn: DrawnCriteria): string => {
    return drawn.spec.id;
  });
}

describe("drawn websites, checked again and again (#11238)", () => {
  it("the first match acts, and the first match that changes the status sets it, on every check", async () => {
    const random: SeededRandom = seededRandom(11238);
    let firstMatchesChangingNoStatus: number = 0;
    let firstMatchesChangingTheStatus: number = 0;

    for (
      let monitorIndex: number = 0;
      monitorIndex < DRAWN_MONITORS;
      monitorIndex++
    ) {
      const monitorCriteria: Array<DrawnCriteria> = drawMonitor(random);

      for (
        let checkIndex: number = 0;
        checkIndex < CHECKS_PER_DRAWN_MONITOR;
        checkIndex++
      ) {
        const answer: DrawnAnswer =
          DRAWN_ANSWERS[random(DRAWN_ANSWERS.length)]!;

        await answerWith(answer);

        const first: DrawnCriteria | undefined = monitorCriteria.find(
          (drawn: DrawnCriteria): boolean => {
            return drawn.matches(answer);
          },
        );

        if (first && !first.spec.status) {
          firstMatchesChangingNoStatus++;
        } else if (first) {
          firstMatchesChangingTheStatus++;
        }

        expect({
          criteria: idsOf(monitorCriteria),
          check: checkIndex,
          answer: answer.name,
          status: status(),
          incidents: openIncidents(),
          alerts: openAlerts(),
        }).toEqual({
          criteria: idsOf(monitorCriteria),
          check: checkIndex,
          answer: answer.name,
          ...expectedAfter(monitorCriteria, answer),
        });
      }
    }

    // The draws reach both kinds of first match, many times each.
    expect(firstMatchesChangingNoStatus).toBeGreaterThan(100);
    expect(firstMatchesChangingTheStatus).toBeGreaterThan(100);
  }, 180000);

  it("the status timeline holds a row for each change of status, with no gap, and uptime counts the rule's statuses", async () => {
    const random: SeededRandom = seededRandom(1123800);

    for (let monitorIndex: number = 0; monitorIndex < 20; monitorIndex++) {
      const monitorCriteria: Array<DrawnCriteria> = drawMonitor(random);

      // The status the rule gives after each check, from Online.
      const statuses: Array<string> = ["Online"];

      for (
        let checkIndex: number = 0;
        checkIndex < CHECKS_PER_DRAWN_MONITOR;
        checkIndex++
      ) {
        const answer: DrawnAnswer =
          DRAWN_ANSWERS[random(DRAWN_ANSWERS.length)]!;

        await answerWith(answer);
        statuses.push(expectedAfter(monitorCriteria, answer).status);
      }

      // A row for the first status, then one per change - none for a check that kept it.
      const changes: Array<string> = statuses.filter(
        (name: string, index: number): boolean => {
          return index === 0 || name !== statuses[index - 1];
        },
      );

      expect({
        criteria: idsOf(monitorCriteria),
        rows: timeline.statusNames(),
      }).toEqual({ criteria: idsOf(monitorCriteria), rows: changes });

      // Each row ends where the next begins.
      const timelineRows: Array<MonitorStatusTimeline> = timeline.rows;

      for (let index: number = 0; index < timelineRows.length - 1; index++) {
        expect(timelineRows[index]!.endsAt?.getTime()).toBe(
          timelineRows[index + 1]!.startsAt?.getTime(),
        );
      }

      /*
       * Uptime over the checks: each status the rule gives holds until the
       * next check, five minutes later; Online holds until the first one.
       */
      const downMinutes: number =
        statuses.slice(1, -1).filter((name: string): boolean => {
          return name !== "Online";
        }).length * CHECK_EVERY_MINUTES;
      const totalMinutes: number =
        CHECKS_PER_DRAWN_MONITOR * CHECK_EVERY_MINUTES;

      expect(
        UptimeUtil.calculateUptimePercentage(
          timeline.rows,
          UptimePrecision.TWO_DECIMAL,
          [OFFLINE, DEGRADED],
          { startDate: START, endDate: OneUptimeDate.getCurrentDate() },
        ),
      ).toBeCloseTo(((totalMinutes - downMinutes) / totalMinutes) * 100, 1);
    }
  }, 180000);
});
