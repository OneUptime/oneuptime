import Monitor from "Common/Models/DatabaseModels/Monitor";
import Incident from "Common/Models/DatabaseModels/Incident";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";
import MonitorAutoResolveTemplates, {
  MonitorAutoResolveTemplateIds,
} from "Common/Utils/Monitor/MonitorAutoResolveTemplates";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import type { MonitorSeedIds } from "../../../../FeatureSet/Dashboard/src/Utils/MonitorSeedIds";
import type { HostServiceKind } from "../../../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill";

/*
 * THE MONITOR "CREATE MONITOR" MAKES ON A SERVICE'S PAGE, EVALUATED (#10296).
 *
 * The monitor is the one HostServiceMonitorPrefill builds for a service on a
 * host. Each check here goes the way the monitor's checks go: the samples the
 * host's collector stores - a Windows service's state every 30 seconds
 * (windows_service's collection_interval), a systemd unit's state set
 * likewise - read by the worker's real Host read (monitorHost), folded per
 * minute as ClickHouse folds them (SqlGroupedFold), and judged by the real
 * criteria evaluator. What a matched criteria then does to the monitor is
 * read off the criteria (its status, whether it opens an incident), and
 * whether an open incident resolves is MonitorIncident's own decision.
 *
 * The three things the issue asks of it:
 *
 *   - the service stops: after a whole time range of not running, the
 *     monitor goes offline and opens an incident - and a restart that is
 *     over within the time range opens nothing;
 *   - it starts again: the monitor is online again, and the incident
 *     resolves itself;
 *   - its state stops arriving (the service was removed, or the host's
 *     collector stopped): after a whole time range of nothing, the monitor
 *     goes offline with an incident of its own, which says it stopped
 *     reporting, not that it is not running.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorIncident from "Common/Server/Utils/Monitor/MonitorIncident";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import { monitorHost } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { StoredMetricRow, foldRowsAsSqlRead } from "./SqlGroupedFold";

type PrefillModule =
  typeof import("../../../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill");

let Prefill: PrefillModule;

/*
 * The prefill is the Dashboard's: Common/UI/Config reads `window` the moment
 * it loads, and the prefill reaches it through RouteMap (for the Monitor
 * Create route), so a browser stub has to exist while it loads - as
 * App/Tests/Dashboard/AIInsightMonitorPrefill.test.ts does it. The stub goes
 * again once it has: the worker and the evaluator run as on the server.
 */
beforeAll(async () => {
  const globals: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  globals["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: { state: null, replaceState: (): void => {} },
  };

  Prefill = await import(
    "../../../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill"
  );

  delete globals["window"];
});

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;

// Windows: windows.service.status, the Service Control Manager's state.
const STOPPED: number = 1;
const START_PENDING: number = 2;
const STOP_PENDING: number = 3;
const RUNNING: number = 4;
const PAUSED: number = 7;

const HOST: string = "web-01";
const HOST_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE: string = "Spooler";
const UNIT: string = "nginx.service";

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const OPERATIONAL_ID: ObjectID = ObjectID.generate();
const OFFLINE_ID: ObjectID = ObjectID.generate();

const seeds: MonitorSeedIds = {
  operationalMonitorStatusId: OPERATIONAL_ID,
  offlineMonitorStatusId: OFFLINE_ID,
  rankedIncidentSeverityIds: [ObjectID.generate(), ObjectID.generate()],
  rankedAlertSeverityIds: [ObjectID.generate(), ObjectID.generate()],
};

// The start of every timeline: noon.
const T0: number = Date.UTC(2026, 10, 20, 12, 0, 0);

function at(minutes: number, seconds: number = 0): number {
  return T0 + minutes * MINUTE + seconds * SECOND;
}

/*
 * What a service did, as stretches from a time on: its state from then
 * until the next stretch. null: nothing was reported then (removed, or the
 * collector stopped).
 */
interface Stretch {
  fromMs: number;
  state: number | string | null;
}

/*
 * A scrape every 30 seconds, at :15 and :45, from an hour before T0 to 40
 * minutes after: the state each stretch says at that time.
 */
function scrapeTimes(): Array<number> {
  const times: Array<number> = [];

  for (let ms: number = at(-60, 15); ms <= at(40); ms += 30 * SECOND) {
    times.push(ms);
  }

  return times;
}

function stateAt(
  stretches: Array<Stretch>,
  ms: number,
): number | string | null {
  let state: number | string | null = null;

  for (const stretch of stretches) {
    if (stretch.fromMs <= ms) {
      state = stretch.state;
    }
  }

  return state;
}

// windows_service: one gauge per service, its name and startup mode on it.
function windowsRows(
  serviceName: string,
  stretches: Array<Stretch>,
): Array<StoredMetricRow> {
  const rows: Array<StoredMetricRow> = [];

  for (const ms of scrapeTimes()) {
    const state: number | string | null = stateAt(stretches, ms);

    if (state === null) {
      continue;
    }

    rows.push({
      time: new Date(ms),
      value: state as number,
      attributes: {
        "resource.host.name": HOST,
        name: serviceName,
        startup_mode: "auto_start",
      },
    });
  }

  return rows;
}

const SYSTEMD_STATES: Array<string> = [
  "active",
  "reloading",
  "inactive",
  "failed",
  "activating",
  "deactivating",
  "maintenance",
  "refreshing",
];

// systemd: a state set, 1 on the unit's state and 0 on every other one.
function systemdRows(
  unitName: string,
  stretches: Array<Stretch>,
): Array<StoredMetricRow> {
  const rows: Array<StoredMetricRow> = [];

  for (const ms of scrapeTimes()) {
    const state: number | string | null = stateAt(stretches, ms);

    if (state === null) {
      continue;
    }

    for (const activeState of SYSTEMD_STATES) {
      rows.push({
        time: new Date(ms),
        value: activeState === state ? 1 : 0,
        attributes: {
          "resource.host.name": HOST,
          "resource.systemd.unit.name": unitName,
          "systemd.unit.active_state": activeState,
        },
      });
    }
  }

  return rows;
}

interface AggregateArgs {
  query: { name: string; attributes?: Dictionary<unknown> };
  aggregationType: MetricsAggregationType;
  startTimestamp: Date;
  endTimestamp: Date;
}

let reads: Array<AggregateArgs> = [];

// What the store holds: every read selects from it, folded per minute.
function givenStored(
  rowsByMetricName: Dictionary<Array<StoredMetricRow>>,
): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const read: AggregateArgs = args as AggregateArgs;
    reads.push(read);

    const selected: Array<StoredMetricRow> = (
      rowsByMetricName[read.query.name] || []
    ).filter((row: StoredMetricRow): boolean => {
      return (
        row.time.getTime() >= read.startTimestamp.getTime() &&
        row.time.getTime() <= read.endTimestamp.getTime() &&
        Object.entries(read.query.attributes || {}).every(
          ([key, value]: [string, unknown]): boolean => {
            return row.attributes[key] === value;
          },
        )
      );
    });

    return foldRowsAsSqlRead(selected, read);
  });
}

// The monitor Create Monitor opens on, as the form would save it.
function createdStep(kind: HostServiceKind, serviceName: string): MonitorStep {
  const prefill: JSONObject | null = Prefill.buildHostServiceMonitorPrefill({
    link: { hostId: HOST_ID, kind: kind, serviceName: serviceName },
    host: { id: HOST_ID, hostIdentifier: HOST, name: HOST },
    seeds: seeds,
  });

  expect(prefill).not.toBeNull();
  expect(prefill!["monitorType"]).toBe(MonitorType.Host);

  return MonitorSteps.fromJSON(prefill!["monitorSteps"] as JSONObject).data!
    .monitorStepsInstanceArray[0]!;
}

function criteriaOf(step: MonitorStep): {
  running: MonitorCriteriaInstance;
  notRunning: MonitorCriteriaInstance;
  notReporting: MonitorCriteriaInstance;
  all: Array<MonitorCriteriaInstance>;
} {
  const all: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

  return {
    running: all[0]!,
    notRunning: all[1]!,
    notReporting: all[2]!,
    all: all,
  };
}

type Verdict = "running" | "not running" | "stopped reporting" | "none";

interface Check {
  verdict: Verdict;
  matched: MonitorCriteriaInstance | null;
  response: MetricMonitorResponse;
  rootCause: string | null;
  isSilent: boolean;
}

// One check of the monitor, at a time.
async function checkAt(step: MonitorStep, ms: number): Promise<Check> {
  const response: MetricMonitorResponse = await monitorHost({
    monitorStep: step,
    monitorId: monitorId,
    projectId: projectId,
    evaluateUntil: new Date(ms),
  });

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId.toString();
  monitor.projectId = projectId;
  monitor.monitorType = MonitorType.Host;
  monitor.name = `${SERVICE} on ${HOST}`;

  const result: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: response,
      monitorStep: step,
      monitor: monitor,
      probeApiIngestResponse: { monitorId: monitorId, rootCause: null },
      evaluationSummary: {
        criteriaResults: [],
        events: [],
      } as unknown as MonitorEvaluationSummary,
    });

  const criteria: ReturnType<typeof criteriaOf> = criteriaOf(step);
  const metId: string = result.criteriaMetId?.toString() || "";

  const matched: MonitorCriteriaInstance | null =
    criteria.all.find((instance: MonitorCriteriaInstance): boolean => {
      return instance.data!.id!.toString() === metId;
    }) || null;

  const verdict: Verdict =
    matched === criteria.running
      ? "running"
      : matched === criteria.notRunning
        ? "not running"
        : matched === criteria.notReporting
          ? "stopped reporting"
          : "none";

  return {
    verdict: verdict,
    matched: matched,
    response: response,
    rootCause: result.rootCause || null,
    isSilent: MonitorResourceUtil.isSilentInfrastructureWindow({
      monitor: monitor,
      dataToProcess: response,
    }),
  };
}

// The incident a criteria opens, as MonitorIncident records where it came from.
function incidentOpenedBy(criteria: MonitorCriteriaInstance): Incident {
  const incident: Incident = new Incident();
  incident.createdCriteriaId = criteria.data!.id!.toString();
  incident.createdIncidentTemplateId = criteria.data!.incidents[0]!.id;
  return incident;
}

// Whether a check resolves an incident a criteria opened (MonitorIncident's own rule).
function resolves(data: {
  step: MonitorStep;
  openedBy: MonitorCriteriaInstance;
  check: Check;
}): boolean {
  const autoResolve: MonitorAutoResolveTemplateIds =
    MonitorAutoResolveTemplates.fromCriteriaInstances(
      criteriaOf(data.step).all,
    );

  return (
    MonitorIncident as unknown as {
      shouldCloseIncident: (input: Record<string, unknown>) => boolean;
    }
  ).shouldCloseIncident({
    openIncident: incidentOpenedBy(data.openedBy),
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: autoResolve.incidents,
    criteriaInstance: data.check.matched,
  });
}

beforeEach(() => {
  reads = [];
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  // The units the receivers declare.
  metricTypeFindBy.mockReset().mockResolvedValue([
    { name: "windows.service.status", unit: "{status}" },
    { name: "systemd.unit.state", unit: "1" },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A Windows service's monitor, made by Create Monitor on its page", () => {
  // Another service on the same host, running throughout.
  const otherService: Array<StoredMetricRow> = windowsRows("W3SVC", [
    { fromMs: at(-60), state: RUNNING },
  ]);

  function given(stretches: Array<Stretch>): void {
    givenStored({
      "windows.service.status": [
        ...windowsRows(SERVICE, stretches),
        ...otherService,
      ],
    });
  }

  test("reads this service's state on this host, each minute's highest value, over five minutes", async () => {
    given([{ fromMs: at(-60), state: RUNNING }]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.WindowsService,
      SERVICE,
    );

    await checkAt(step, at(0));

    expect(reads).toHaveLength(1);
    expect(reads[0]!.query.name).toBe("windows.service.status");
    // The worker narrows to the host; the step names the service.
    expect(reads[0]!.query.attributes).toEqual({
      name: SERVICE,
      "resource.host.name": HOST,
    });
    expect(reads[0]!.aggregationType).toBe(MetricsAggregationType.Max);
    expect(
      reads[0]!.endTimestamp.getTime() - reads[0]!.startTimestamp.getTime(),
    ).toBe(5 * MINUTE);
    expect(Prefill.HOST_SERVICE_MONITOR_ROLLING_TIME).toBe("Past 5 Minutes");
  });

  test("a running service keeps the monitor online", async () => {
    given([{ fromMs: at(-60), state: RUNNING }]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.WindowsService,
      SERVICE,
    );

    const check: Check = await checkAt(step, at(0));

    expect(check.verdict).toBe("running");
    expect(check.matched!.data!.monitorStatusId!.toString()).toBe(
      OPERATIONAL_ID.toString(),
    );
    expect(check.matched!.data!.createIncidents).toBe(false);
  });

  describe("the service stops, and starts again", () => {
    /*
     * Running, stopping at 12:00:30 and stopped from 12:00:40, started again
     * at 12:12:30. Its last Running sample is 12:00:15: the minute of 12:00
     * held one, so it reads Running.
     */
    const stopsAndStarts: Array<Stretch> = [
      { fromMs: at(-60), state: RUNNING },
      { fromMs: at(0, 30), state: STOP_PENDING },
      { fromMs: at(0, 40), state: STOPPED },
      { fromMs: at(12, 30), state: START_PENDING },
      { fromMs: at(12, 50), state: RUNNING },
    ];

    test("for less than the time range: still online, nothing opens", async () => {
      given(stopsAndStarts);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        SERVICE,
      );

      // Each of these time ranges still holds the minute of 12:00.
      for (const minute of [1, 2, 3, 4]) {
        const check: Check = await checkAt(step, at(minute, 50));

        expect({ minute: minute, verdict: check.verdict }).toEqual({
          minute: minute,
          verdict: "running",
        });
      }
    });

    test("for the whole time range: the monitor goes offline and opens an incident that names the service and the host", async () => {
      given(stopsAndStarts);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        SERVICE,
      );

      // 12:00:50 to 12:05:50: the first time range with no Running minute.
      const check: Check = await checkAt(step, at(5, 50));

      expect(check.verdict).toBe("not running");
      expect(check.matched!.data!.changeMonitorStatus).toBe(true);
      expect(check.matched!.data!.monitorStatusId!.toString()).toBe(
        OFFLINE_ID.toString(),
      );
      expect(check.matched!.data!.createIncidents).toBe(true);
      expect(check.matched!.data!.incidents[0]!.title).toBe(
        "Spooler is not running on web-01",
      );
      expect(check.matched!.data!.incidents[0]!.incidentSeverityId).toEqual(
        seeds.rankedIncidentSeverityIds[0],
      );
      /*
       * Why, in the incident's root cause: the criteria, the state it
       * reported instead of Running in every minute, and which service on
       * which host.
       */
      expect(check.rootCause).toContain(
        "**Criteria Name**: Spooler is not running on web-01",
      );
      expect(check.rootCause).toContain("service_status was 1 in all 5");
      expect(check.rootCause).toContain("`name` = `Spooler`");
      expect(check.rootCause).toContain("Host: web-01");
      expect(check.isSilent).toBe(false);
    });

    test("while it stays stopped, the incident stays open", async () => {
      given(stopsAndStarts);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        SERVICE,
      );
      const notRunning: MonitorCriteriaInstance = criteriaOf(step).notRunning;

      for (const minute of [7, 9, 11, 12]) {
        const check: Check = await checkAt(step, at(minute, 50));

        expect({ minute: minute, verdict: check.verdict }).toEqual({
          minute: minute,
          verdict: "not running",
        });
        expect(
          resolves({ step: step, openedBy: notRunning, check: check }),
        ).toBe(false);
      }
    });

    test("once it runs again: the monitor is online in that minute, and the incident resolves itself", async () => {
      given(stopsAndStarts);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        SERVICE,
      );

      const check: Check = await checkAt(step, at(13, 20));

      expect(check.verdict).toBe("running");
      expect(check.matched!.data!.monitorStatusId!.toString()).toBe(
        OPERATIONAL_ID.toString(),
      );
      expect(
        resolves({
          step: step,
          openedBy: criteriaOf(step).notRunning,
          check: check,
        }),
      ).toBe(true);
    });
  });

  test("a restart that is over within the time range opens nothing", async () => {
    given([
      { fromMs: at(-60), state: RUNNING },
      { fromMs: at(0, 20), state: STOP_PENDING },
      { fromMs: at(0, 30), state: STOPPED },
      { fromMs: at(1, 0), state: START_PENDING },
      { fromMs: at(1, 30), state: RUNNING },
    ]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.WindowsService,
      SERVICE,
    );

    for (let minute: number = 0; minute <= 10; minute++) {
      const check: Check = await checkAt(step, at(minute, 50));

      expect({ minute: minute, verdict: check.verdict }).toEqual({
        minute: minute,
        verdict: "running",
      });
    }
  });

  test("every state but Running is not running: a paused service, and one stuck starting, open the incident too", async () => {
    for (const state of [PAUSED, START_PENDING, STOP_PENDING, 5, 6]) {
      given([
        { fromMs: at(-60), state: RUNNING },
        { fromMs: at(0), state: state },
      ]);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        SERVICE,
      );

      const check: Check = await checkAt(step, at(6, 50));

      expect({ state: state, verdict: check.verdict }).toEqual({
        state: state,
        verdict: "not running",
      });
    }
  });

  test("a service that goes from paused to stopped stays offline: no minute of Running in between, so no false recovery", async () => {
    given([
      { fromMs: at(-60), state: RUNNING },
      { fromMs: at(0), state: PAUSED },
      { fromMs: at(8, 10), state: STOP_PENDING },
      { fromMs: at(8, 20), state: STOPPED },
    ]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.WindowsService,
      SERVICE,
    );

    for (let minute: number = 6; minute <= 16; minute++) {
      const check: Check = await checkAt(step, at(minute, 50));

      expect({ minute: minute, verdict: check.verdict }).toEqual({
        minute: minute,
        verdict: "not running",
      });
    }
  });

  describe("its state stops arriving", () => {
    test("the service was removed while the host keeps reporting: after the time range, offline, with an incident that says it stopped reporting", async () => {
      // Running, then uninstalled at 12:00:30; W3SVC goes on reporting.
      given([
        { fromMs: at(-60), state: RUNNING },
        { fromMs: at(0, 30), state: null },
      ]);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        SERVICE,
      );

      // The time range still holds its last minutes of Running.
      expect((await checkAt(step, at(3, 50))).verdict).toBe("running");

      const check: Check = await checkAt(step, at(6, 50));

      expect(check.verdict).toBe("stopped reporting");
      expect(check.matched!.data!.monitorStatusId!.toString()).toBe(
        OFFLINE_ID.toString(),
      );
      expect(check.matched!.data!.createIncidents).toBe(true);
      expect(check.matched!.data!.incidents[0]!.title).toBe(
        "Spooler stopped reporting on web-01",
      );
      expect(check.matched!.data!.incidents[0]!.description).not.toContain(
        "not been running",
      );
    });

    test("the host's collector stopped: the whole time range is silent, and the monitor still goes offline rather than staying green", async () => {
      givenStored({
        "windows.service.status": [
          ...windowsRows(SERVICE, [
            { fromMs: at(-60), state: RUNNING },
            { fromMs: at(0, 30), state: null },
          ]),
          // Nothing else from the host either.
          ...windowsRows("W3SVC", [
            { fromMs: at(-60), state: RUNNING },
            { fromMs: at(0, 30), state: null },
          ]),
        ],
      });
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        SERVICE,
      );

      const check: Check = await checkAt(step, at(6, 50));

      /*
       * Silence: an infrastructure monitor with no criteria for it keeps its
       * status (MonitorResource). This monitor's Has No Data criteria asks
       * for silence, so it acts.
       */
      expect(check.isSilent).toBe(true);
      expect(check.verdict).toBe("stopped reporting");
      expect(check.matched!.data!.createIncidents).toBe(true);
    });

    test("a stopped service's incident gives way to the stopped-reporting one, which resolves once its state arrives again", async () => {
      given([
        { fromMs: at(-60), state: STOPPED },
        { fromMs: at(0, 30), state: null },
        { fromMs: at(10, 10), state: RUNNING },
      ]);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        SERVICE,
      );
      const criteria: ReturnType<typeof criteriaOf> = criteriaOf(step);

      const stopped: Check = await checkAt(step, at(0));
      expect(stopped.verdict).toBe("not running");

      const silent: Check = await checkAt(step, at(6, 50));
      expect(silent.verdict).toBe("stopped reporting");
      // "Not running" is no longer what the monitor knows: its incident resolves.
      expect(
        resolves({ step: step, openedBy: criteria.notRunning, check: silent }),
      ).toBe(true);

      const back: Check = await checkAt(step, at(10, 50));
      expect(back.verdict).toBe("running");
      expect(
        resolves({ step: step, openedBy: criteria.notReporting, check: back }),
      ).toBe(true);
    });

    test("a name the host never reported (a typo) is said at once, not watched in silence", async () => {
      given([{ fromMs: at(-60), state: RUNNING }]);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.WindowsService,
        "Spoolr",
      );

      expect((await checkAt(step, at(0))).verdict).toBe("stopped reporting");
    });
  });

  test("with data, one of its criteria always matches: the monitor never falls to 'no criteria met'", async () => {
    given([
      { fromMs: at(-60), state: RUNNING },
      { fromMs: at(0, 30), state: STOPPED },
      { fromMs: at(3, 15), state: PAUSED },
      { fromMs: at(5, 15), state: START_PENDING },
      { fromMs: at(5, 45), state: RUNNING },
      { fromMs: at(9, 15), state: null },
    ]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.WindowsService,
      SERVICE,
    );

    for (let second: number = 0; second <= 20 * 60; second += 20) {
      const check: Check = await checkAt(step, T0 + second * SECOND);

      expect(check.verdict).not.toBe("none");
    }
  });
});

describe("A systemd unit's monitor, made by Create Monitor on its page", () => {
  function given(stretches: Array<Stretch>): void {
    givenStored({
      "systemd.unit.state": [
        ...systemdRows(UNIT, stretches),
        ...systemdRows("sshd.service", [{ fromMs: at(-60), state: "active" }]),
      ],
    });
  }

  test("reads whether this unit is active on this host: its active state's point, each minute's highest", async () => {
    given([{ fromMs: at(-60), state: "active" }]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.SystemdUnit,
      UNIT,
    );

    const check: Check = await checkAt(step, at(0));

    expect(check.verdict).toBe("running");
    expect(reads[0]!.query.name).toBe("systemd.unit.state");
    expect(reads[0]!.query.attributes).toEqual({
      "resource.systemd.unit.name": UNIT,
      "systemd.unit.active_state": "active",
      "resource.host.name": HOST,
    });
    expect(reads[0]!.aggregationType).toBe(MetricsAggregationType.Max);
  });

  test("failed for the whole time range: offline with an incident; active again: online, and it resolves", async () => {
    given([
      { fromMs: at(-60), state: "active" },
      { fromMs: at(0, 30), state: "failed" },
      { fromMs: at(10, 10), state: "activating" },
      { fromMs: at(10, 40), state: "active" },
    ]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.SystemdUnit,
      UNIT,
    );
    const criteria: ReturnType<typeof criteriaOf> = criteriaOf(step);

    expect((await checkAt(step, at(3, 50))).verdict).toBe("running");

    const failed: Check = await checkAt(step, at(6, 50));
    expect(failed.verdict).toBe("not running");
    expect(failed.matched!.data!.incidents[0]!.title).toBe(
      "nginx.service is not active on web-01",
    );
    expect(failed.matched!.data!.monitorStatusId!.toString()).toBe(
      OFFLINE_ID.toString(),
    );

    const back: Check = await checkAt(step, at(10, 50));
    expect(back.verdict).toBe("running");
    expect(
      resolves({ step: step, openedBy: criteria.notRunning, check: back }),
    ).toBe(true);
  });

  test("every state but active is not active: inactive, activating and deactivating for the whole time range open the incident", async () => {
    for (const state of ["inactive", "activating", "deactivating"]) {
      given([
        { fromMs: at(-60), state: "active" },
        { fromMs: at(0), state: state },
      ]);
      const step: MonitorStep = createdStep(
        Prefill.HostServiceKind.SystemdUnit,
        UNIT,
      );

      const check: Check = await checkAt(step, at(6, 50));

      expect({ state: state, verdict: check.verdict }).toEqual({
        state: state,
        verdict: "not running",
      });
    }
  });

  test("a restart within the time range opens nothing", async () => {
    given([
      { fromMs: at(-60), state: "active" },
      { fromMs: at(0, 20), state: "deactivating" },
      { fromMs: at(0, 40), state: "activating" },
      { fromMs: at(1, 10), state: "active" },
    ]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.SystemdUnit,
      UNIT,
    );

    for (let minute: number = 0; minute <= 8; minute++) {
      expect((await checkAt(step, at(minute, 50))).verdict).toBe("running");
    }
  });

  test("its state stops arriving: offline, with the stopped-reporting incident", async () => {
    given([
      { fromMs: at(-60), state: "active" },
      { fromMs: at(0, 30), state: null },
    ]);
    const step: MonitorStep = createdStep(
      Prefill.HostServiceKind.SystemdUnit,
      UNIT,
    );

    const check: Check = await checkAt(step, at(6, 50));

    expect(check.verdict).toBe("stopped reporting");
    expect(check.matched!.data!.incidents[0]!.title).toBe(
      "nginx.service stopped reporting on web-01",
    );
  });
});
