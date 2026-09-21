/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes,
} from "react-router-dom";

/*
 * The monitor overview page, rendered for real over a fake server, with
 * every heavy or self-fetching card stubbed. What is under test is the page
 * itself: the first load and its failures, the order of the cards, which
 * cards each monitor family gets, what each role can see, and the refresh
 * and model-change rules (a refresh never unmounts a card; nothing of the
 * monitor the reader left shows on the next one).
 *
 * The cards, the hooks and the presentation model have their own suites;
 * this one checks that the page wires them together as the spec says.
 */

const recordedProps: Record<string, Array<Record<string, unknown>>> = {};
const mountCounts: Record<string, number> = {};

/*
 * Function declarations, so they are hoisted along with the jest.mock calls
 * that use them. Everything they touch is dereferenced lazily, at render
 * time, after the module's consts are initialised.
 */
function recordProps(key: string, props: Record<string, unknown>): void {
  if (!recordedProps[key]) {
    recordedProps[key] = [];
  }

  recordedProps[key]!.push(props);
}

function StubBody(data: {
  stubKey: string;
  testId: string;
  props: Record<string, unknown>;
}): ReactElement {
  recordProps(data.stubKey, data.props);

  React.useEffect(() => {
    mountCounts[data.stubKey] = (mountCounts[data.stubKey] || 0) + 1;
  }, []);

  return React.createElement("div", { "data-testid": data.testId });
}

function stubModule(key: string): {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      return StubBody({ stubKey: key, testId: `stub-${key}`, props: props });
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/Summary",
  () => {
    return stubModule("Summary");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorFeed",
  () => {
    return stubModule("MonitorFeed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return stubModule("OverviewCustomFields");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DependencySuppressionWarning",
  () => {
    return stubModule("DependencySuppressionWarning");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return stubModule("EmbeddedMetricCard");
  },
);
jest.mock("../../../UI/Components/MonitorGraphs/Uptime", () => {
  return stubModule("MonitorUptimeGraph");
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/LogMonitor/LogMonitorPreview",
  () => {
    return stubModule("LogMonitorPreview");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MetricMonitor/MetricMonitorPreview",
  () => {
    return stubModule("MetricMonitorPreview");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SecurityEventsMonitor/SecurityEventsMonitorPreview",
  () => {
    return stubModule("SecurityEventsMonitorPreview");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceTable",
  () => {
    return stubModule("TraceTable");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/ServerMonitor/Documentation",
  () => {
    return stubModule("ServerMonitorDocumentation");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailMonitorLink",
  () => {
    // The connection card still needs the real address helper.
    return {
      ...jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingEmailMonitor/IncomingEmailMonitorLink",
      ),
      ...stubModule("IncomingEmailMonitorLink"),
    };
  },
);
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      const name: string = props["name"] as string;

      return StubBody({
        stubKey: `CardModelDetail:${name}`,
        testId: `stub-card-${name}`,
        props: props,
      });
    },
  };
});

import MonitorView from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Index";
import MonitorViewOutletContext from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/MonitorViewOutletContext";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  MONITOR_OVERVIEW_NOT_FOUND_MESSAGE,
  MONITOR_OVERVIEW_REFRESH_INTERVAL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorOverviewData";
import AlertStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/AlertState";
import IncidentStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  MonitorUptimeSummary,
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import MonitorUptimeSummaryUtil from "../../../Utils/Monitor/MonitorUptimeSummaryUtil";

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const DAY_SECONDS: number = 86400;

// Real UUIDs: ObjectID and ProjectUtil ignore values that are not.
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const MONITOR_A: string = "9a1f0c2e-5b3d-4c7a-8e1f-2d3c4b5a6978";
const MONITOR_B: string = "4e5f6071-8293-4a4b-b5c6-d7e8f90a1b2c";
const OPERATIONAL_ID: string = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
const OFFLINE_ID: string = "2c3d4e5f-6071-4829-93a4-b5c6d7e8f901";
const STATUS_ROW_ID: string = "3d4e5f60-7182-493a-a4b5-c6d7e8f90a1b";
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROBE_FRANKFURT: string = "11111111-1111-4111-8111-111111111111";
const PROBE_VIRGINIA: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const INCIDENT_ID: string = "77777777-7777-4777-8777-777777777777";
const INCIDENT_STATE_ID: string = "88888888-8888-4888-8888-888888888888";
const ALERT_STATE_ID: string = "99999999-9999-4999-8999-999999999999";
// The heartbeat secret: it must never reach the DOM of someone who cannot read it.
const HEARTBEAT_SECRET: string = "5ec2e7a1-0b1c-4d2e-9f30-4a5b6c7d8e9f";
const SERVER_SECRET: string = "6fd3f8b2-1c2d-4e3f-a041-5b6c7d8e9fa0";

const SECRET_KEY_COLUMNS: Array<string> = [
  "serverMonitorSecretKey",
  "incomingRequestSecretKey",
  "incomingEmailSecretKey",
];

const pageProps: PageComponentProps = {
  pageRoute: new Route("/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (promiseResolve: (value: T) => void): void => {
      resolve = promiseResolve;
    },
  );

  return { promise: promise, resolve: resolve };
}

/*
 * Rejections are made by an async function, so they are native promises.
 * The UI telemetry in the import graph loads zone.js, whose Promise reports
 * a rejection as unhandled when a native await subscribes to it a tick
 * later, which would fill the log with false alarms.
 */
async function rejectWith(error: unknown): Promise<never> {
  throw error;
}

// Partial<T> under exactOptionalPropertyTypes forbids an explicit undefined.
type MonitorOverrides = {
  [K in keyof Monitor]?: Monitor[K] | undefined;
};

interface MonitorSpec {
  id: string;
  type: MonitorType;
  statusId: string;
  // Omitted: one plain step. Null: no steps at all.
  stepData?: JSONObject | null;
  overrides?: MonitorOverrides;
}

interface ProbeSpec {
  probeId: string;
  name: string;
  isEnabled: boolean;
  monitoredAt?: Date;
}

interface FakeServer {
  monitors: Dictionary<MonitorSpec | null>;
  // Each Monitor read takes the next failure, if any.
  monitorFailures: Array<Error>;
  probes: Array<ProbeSpec>;
  statusRows: Array<MonitorStatusTimeline>;
  logs: Array<MonitorLog>;
  openIncidentCount: number;
}

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

interface ItemRequest {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

interface ApiGetRequest {
  url: URL;
}

let server: FakeServer;
let permissions: Array<Permission>;
let currentMonitorId: string;
// Monitor reads parked until the test releases them, by monitor id.
let heldMonitorReads: Dictionary<Deferred<void>>;
let getItemSpy: jest.SpyInstance;
let getListSpy: jest.SpyInstance;
let analyticsGetListSpy: jest.SpyInstance;
let apiGetSpy: jest.SpyInstance;
let refreshHeaderMock: jest.Mock;

function buildStatus(statusId: string): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = statusId;
  status.name = statusId === OFFLINE_ID ? "Offline" : "Operational";
  status.color = new Color(statusId === OFFLINE_ID ? "#ef4444" : "#10b981");
  status.isOperationalState = statusId !== OFFLINE_ID;
  status.isOfflineState = statusId === OFFLINE_ID;
  status.priority = statusId === OFFLINE_ID ? 2 : 1;
  return status;
}

function stepsOf(stepData: JSONObject): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: [{ data: { id: STEP_ID, ...stepData } }],
    },
  } as unknown as MonitorSteps;
}

// The steps each monitor carries; the same object on every read.
const stepsByMonitor: Dictionary<MonitorSteps> = {};

function getSteps(spec: MonitorSpec): MonitorSteps | undefined {
  if (spec.stepData === null) {
    return undefined;
  }

  const key: string = `${spec.id}:${JSON.stringify(spec.stepData || {})}`;

  if (!stepsByMonitor[key]) {
    stepsByMonitor[key] = stepsOf(spec.stepData || {});
  }

  return stepsByMonitor[key];
}

/*
 * The row as the server would send it: the secret-key columns only when the
 * select asked for them, which the page only does for someone who may read
 * them.
 */
function buildMonitorRow(
  spec: MonitorSpec,
  select: Record<string, unknown>,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = spec.id;
  monitor.monitorType = spec.type;

  const steps: MonitorSteps | undefined = getSteps(spec);

  if (steps) {
    monitor.monitorSteps = steps;
  }

  monitor.monitoringInterval = "* * * * *";
  monitor.createdAt = new Date("2026-01-01T00:00:00.000Z");
  monitor.currentMonitorStatusId = new ObjectID(spec.statusId);
  monitor.currentMonitorStatus = buildStatus(spec.statusId);
  Object.assign(monitor, spec.overrides || {});

  if (select["incomingRequestSecretKey"]) {
    monitor.incomingRequestSecretKey = new ObjectID(HEARTBEAT_SECRET);
  }

  if (select["serverMonitorSecretKey"]) {
    monitor.serverMonitorSecretKey = new ObjectID(SERVER_SECRET);
  }

  return monitor;
}

function buildProbeRow(spec: ProbeSpec, isFull: boolean): MonitorProbe {
  const row: MonitorProbe = new MonitorProbe();
  row.createdAt = NOW;
  row.probeId = new ObjectID(spec.probeId);
  row.isEnabled = spec.isEnabled;
  row.lastPingAt = secondsAgo(40);
  row.nextPingAt = secondsAgo(-20);

  const probe: Probe = new Probe();
  probe._id = spec.probeId;
  probe.name = spec.name;
  probe.connectionStatus = ProbeConnectionStatus.Connected;
  row.probe = probe;

  if (isFull && spec.monitoredAt) {
    row.lastMonitoringLog = {
      [STEP_ID]: {
        probeId: spec.probeId,
        monitorStepId: STEP_ID,
        monitoredAt: spec.monitoredAt.toISOString(),
        isOnline: true,
        responseTimeInMs: 120,
        responseCode: 200,
      },
    } as unknown as MonitorStepProbeResponse;
  }

  return row;
}

function buildEvaluation(label: string): MonitorEvaluationSummary {
  return {
    evaluatedAt: secondsAgo(30),
    criteriaResults: [
      {
        criteriaId: label,
        criteriaName: label,
        met: true,
        message: label,
        filters: [],
      },
    ],
    events: [],
  } as unknown as MonitorEvaluationSummary;
}

function buildLog(data: {
  probeId: string;
  time: Date;
  summary: MonitorEvaluationSummary;
}): MonitorLog {
  const log: MonitorLog = new MonitorLog();
  log.time = data.time;
  log.logBody = {
    probeId: data.probeId,
    evaluationSummary: data.summary,
  } as unknown as JSONObject;
  return log;
}

function buildOpenStatusRow(statusId: string): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row._id = STATUS_ROW_ID;
  row.monitorStatusId = new ObjectID(statusId);
  row.monitorStatus = buildStatus(statusId);
  row.startsAt = secondsAgo(3 * DAY_SECONDS);
  return row;
}

function buildWindow(
  key: MonitorUptimeWindowKey,
  seconds: number,
): MonitorUptimeWindowTotal {
  return {
    key: key,
    startDate: secondsAgo(seconds),
    endDate: NOW,
    windowSeconds: seconds,
    coveredSeconds: seconds,
    statusDurations: [
      { monitorStatusId: new ObjectID(OPERATIONAL_ID), seconds: seconds },
    ],
  };
}

// A fully covered, all-operational history: every window reads "100%".
function buildUptimeSummary(monitorId: string): MonitorUptimeSummary {
  return {
    monitorId: new ObjectID(monitorId),
    timezone: "UTC",
    generatedAt: NOW,
    startDate: secondsAgo(89 * DAY_SECONDS + 12 * 3600),
    endDate: NOW,
    buckets: [],
    windows: [
      buildWindow(MonitorUptimeWindowKey.Last24Hours, DAY_SECONDS),
      buildWindow(MonitorUptimeWindowKey.Last7Days, 7 * DAY_SECONDS),
      buildWindow(MonitorUptimeWindowKey.Last30Days, 30 * DAY_SECONDS),
      buildWindow(MonitorUptimeWindowKey.Last90Days, 90 * DAY_SECONDS),
    ],
    isComplete: true,
    completeFrom: null,
    statuses: [
      {
        id: new ObjectID(OPERATIONAL_ID),
        name: "Operational",
        color: "#10b981",
        isOperationalState: true,
        isOfflineState: false,
        priority: 1,
      },
      {
        id: new ObjectID(OFFLINE_ID),
        name: "Offline",
        color: "#ef4444",
        isOperationalState: false,
        isOfflineState: true,
        priority: 2,
      },
    ],
  };
}

function listOf<T>(
  data: Array<T>,
  count?: number,
): {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} {
  return {
    data: data,
    count: count ?? data.length,
    skip: 0,
    limit: data.length,
  };
}

const API_MONITOR: MonitorSpec = {
  id: MONITOR_A,
  type: MonitorType.API,
  statusId: OPERATIONAL_ID,
};

function setUpServer(monitor: MonitorSpec): void {
  server.monitors[monitor.id] = monitor;
}

function listRequests(modelType: unknown): Array<ListRequest> {
  return getListSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest) => {
      return request.modelType === modelType;
    });
}

function itemRequests(): Array<ItemRequest> {
  return getItemSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ItemRequest;
  });
}

function apiGetUrls(route: string): Array<string> {
  return apiGetSpy.mock.calls
    .map((call: Array<unknown>) => {
      return (call[0] as ApiGetRequest).url.toString();
    })
    .filter((url: string) => {
      return url.includes(route);
    });
}

// Open-work reads, told apart from the uptime overlay by their state filter.
function openIncidentRequests(): Array<ListRequest> {
  return listRequests(Incident).filter((request: ListRequest) => {
    return Boolean(request.query["currentIncidentStateId"]);
  });
}

function propsHistory<T>(key: string): Array<T> {
  return (recordedProps[key] || []) as unknown as Array<T>;
}

function latestProps<T>(key: string): T {
  const history: Array<T> = propsHistory<T>(key);

  if (history.length === 0) {
    throw new Error(`${key} was never rendered`);
  }

  return history[history.length - 1]!;
}

// Lets every settled promise run its continuations, inside act.
async function flush(): Promise<void> {
  for (let round: number = 0; round < 3; round++) {
    await act(async () => {
      for (let i: number = 0; i < 50; i++) {
        await Promise.resolve();
      }
    });
  }
}

function holdMonitorRead(monitorId: string): Deferred<void> {
  const deferred: Deferred<void> = createDeferred<void>();
  heldMonitorReads[monitorId] = deferred;
  return deferred;
}

async function releaseMonitorRead(monitorId: string): Promise<void> {
  const deferred: Deferred<void> | undefined = heldMonitorReads[monitorId];
  delete heldMonitorReads[monitorId];

  await act(async () => {
    deferred?.resolve();
  });
  await flush();
}

const outletContext: MonitorViewOutletContext = {
  refreshHeader: (): void => {
    refreshHeaderMock();
  },
};

// The layout's outlet, which hands the page its context.
function OutletHost(): ReactElement {
  return <Outlet context={outletContext} />;
}

function pageTree(): ReactElement {
  return (
    <MemoryRouter initialEntries={["/dashboard/monitors/view"]}>
      <Routes>
        <RouterRoute element={<OutletHost />}>
          <RouterRoute path="*" element={<MonitorView {...pageProps} />} />
        </RouterRoute>
      </Routes>
    </MemoryRouter>
  );
}

async function renderPage(): Promise<RenderResult> {
  const rendered: RenderResult = render(pageTree());
  await flush();
  return rendered;
}

// Moves the reader to another monitor on the same, still-mounted route.
async function navigateTo(
  rendered: RenderResult,
  monitorId: string,
): Promise<void> {
  currentMonitorId = monitorId;

  await act(async () => {
    rendered.rerender(pageTree());
  });
}

function getFactKeys(): Array<string> {
  return Array.from(
    within(screen.getByTestId("monitor-overview-facts")).queryAllByTestId(
      /^monitor-overview-fact-/,
    ),
  ).map((element: HTMLElement) => {
    return element
      .getAttribute("data-testid")!
      .replace("monitor-overview-fact-", "");
  });
}

function tile(id: string): HTMLElement {
  const element: HTMLElement | null = document.getElementById(id);

  if (!element) {
    throw new Error(`No stat tile ${id}`);
  }

  return element;
}

function isInMainColumn(element: HTMLElement): boolean {
  return Boolean(element.closest('[class~="xl:col-span-2"]'));
}

// Asserts the elements are in the DOM in this order.
function expectDocumentOrder(elements: Array<HTMLElement>): void {
  for (let index: number = 1; index < elements.length; index++) {
    const previous: HTMLElement = elements[index - 1]!;
    const current: HTMLElement = elements[index]!;

    expect(
      Boolean(
        previous.compareDocumentPosition(current) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  }
}

function heading(name: string): HTMLElement {
  return screen.getByRole("heading", { name: name });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(NOW);

  currentMonitorId = MONITOR_A;
  heldMonitorReads = {};
  permissions = [Permission.ProjectOwner];
  refreshHeaderMock = jest.fn();

  server = {
    monitors: { [MONITOR_A]: API_MONITOR },
    monitorFailures: [],
    probes: [
      {
        probeId: PROBE_FRANKFURT,
        name: "Frankfurt",
        isEnabled: true,
        monitoredAt: secondsAgo(30),
      },
      { probeId: PROBE_VIRGINIA, name: "Virginia", isEnabled: false },
    ],
    statusRows: [buildOpenStatusRow(OPERATIONAL_ID)],
    logs: [
      buildLog({
        probeId: PROBE_FRANKFURT,
        time: secondsAgo(30),
        summary: buildEvaluation("Frankfurt verdict"),
      }),
    ],
    openIncidentCount: 0,
  };

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(currentMonitorId);
    });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });

  const incidentState: IncidentState = new IncidentState();
  incidentState._id = INCIDENT_STATE_ID;
  jest
    .spyOn(IncidentStateUtil, "getUnresolvedIncidentStates")
    .mockResolvedValue([incidentState]);

  const alertState: AlertState = new AlertState();
  alertState._id = ALERT_STATE_ID;
  jest
    .spyOn(AlertStateUtil, "getUnresolvedAlertStates")
    .mockResolvedValue([alertState]);

  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  getItemSpy.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: ItemRequest = args[0] as ItemRequest;
    const monitorId: string = request.id.toString();

    const respond: () => Promise<unknown> = (): Promise<unknown> => {
      const failure: Error | undefined = server.monitorFailures.shift();

      if (failure) {
        return rejectWith(failure);
      }

      const spec: MonitorSpec | null | undefined = server.monitors[monitorId];

      return Promise.resolve(
        spec ? buildMonitorRow(spec, request.select) : null,
      );
    };

    const held: Deferred<void> | undefined = heldMonitorReads[monitorId];

    if (held) {
      return held.promise.then(respond);
    }

    return respond();
  });

  getListSpy = jest.spyOn(ModelAPI, "getList");
  getListSpy.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: ListRequest = args[0] as ListRequest;

    if (request.modelType === MonitorProbe) {
      const isFull: boolean = Boolean(request.select["lastMonitoringLog"]);

      return Promise.resolve(
        listOf(
          server.probes.map((spec: ProbeSpec) => {
            return buildProbeRow(spec, isFull);
          }),
        ),
      );
    }

    if (request.modelType === MonitorStatusTimeline) {
      return Promise.resolve(listOf(server.statusRows));
    }

    if (
      request.modelType === Incident &&
      request.query["currentIncidentStateId"]
    ) {
      const incidents: Array<Incident> = [];

      if (server.openIncidentCount > 0) {
        const incident: Incident = new Incident();
        incident._id = INCIDENT_ID;
        incident.title = "Checkout is slow";
        incident.declaredAt = secondsAgo(600);
        incidents.push(incident);
      }

      return Promise.resolve(listOf(incidents, server.openIncidentCount));
    }

    if (
      request.modelType === Alert ||
      request.modelType === Incident ||
      request.modelType === MonitorOwnerUser ||
      request.modelType === MonitorOwnerTeam
    ) {
      return Promise.resolve(listOf([]));
    }

    return rejectWith(new Error("Unexpected list request"));
  });

  analyticsGetListSpy = jest.spyOn(AnalyticsModelAPI, "getList");
  analyticsGetListSpy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(listOf(server.logs));
  });

  apiGetSpy = jest.spyOn(API, "get");
  apiGetSpy.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const url: string = (args[0] as ApiGetRequest).url.toString();

    if (url.includes("/monitor/uptime-summary/")) {
      const monitorId: string = url
        .split("/monitor/uptime-summary/")[1]!
        .split("?")[0]!;

      return Promise.resolve(
        new HTTPResponse<JSONObject>(
          200,
          MonitorUptimeSummaryUtil.toJSON(buildUptimeSummary(monitorId)),
          {},
        ),
      );
    }

    return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();

  for (const key of Object.keys(recordedProps)) {
    delete recordedProps[key];
  }

  for (const key of Object.keys(mountCounts)) {
    delete mountCounts[key];
  }
});

describe("Monitor overview page: the first load", () => {
  test('shows the skeleton "Loading monitor" until the Monitor read resolves, reading the rest in parallel', async () => {
    holdMonitorRead(MONITOR_A);

    await renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading monitor");
    expect(screen.queryByTestId("monitor-overview-hero")).toBeNull();
    // No card is mounted over the skeleton, so none fetches for nothing.
    expect(Object.keys(mountCounts)).toEqual([]);

    // The supplementary reads went out without waiting for the row.
    expect(itemRequests()).toHaveLength(1);
    expect(listRequests(MonitorProbe)).toHaveLength(1);
    expect(listRequests(MonitorStatusTimeline)).toHaveLength(1);
    expect(apiGetUrls("/monitor/uptime-summary/")).toHaveLength(1);

    await releaseMonitorRead(MONITOR_A);

    expect(screen.queryByText("Loading monitor")).toBeNull();
    expect(screen.getByTestId("monitor-overview-hero")).toBeInTheDocument();

    // Every card mounted exactly once: nothing rendered and then replaced.
    for (const key of [
      "Summary",
      "MonitorFeed",
      "OverviewCustomFields",
      "DependencySuppressionWarning",
      "EmbeddedMetricCard",
      "MonitorUptimeGraph",
      "CardModelDetail:Monitor Details",
    ]) {
      expect({ key, mounts: mountCounts[key] }).toEqual({ key, mounts: 1 });
    }
  });

  test("a failed first load shows the error with a retry that recovers", async () => {
    server.monitorFailures = [new Error("The database is asleep")];

    await renderPage();

    expect(screen.getByText("The database is asleep")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-overview-hero")).toBeNull();
    expect(screen.queryByTestId("stub-Summary")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });
    await flush();

    expect(screen.queryByText("The database is asleep")).toBeNull();
    expect(screen.getByTestId("monitor-overview-hero")).toBeInTheDocument();
    expect(itemRequests()).toHaveLength(2);
  });

  test("a monitor that is gone says so, with a retry", async () => {
    server.monitors[MONITOR_A] = null;

    await renderPage();

    expect(
      screen.getByText(
        "This monitor could not be found. It may have been deleted, or you may not have permission to view it.",
      ),
    ).toBeInTheDocument();
    expect(MONITOR_OVERVIEW_NOT_FOUND_MESSAGE).toBe(
      "This monitor could not be found. It may have been deleted, or you may not have permission to view it.",
    );
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-overview-hero")).toBeNull();
  });

  test("reads the uptime history and what is open once per visit, not again when the row lands", async () => {
    await renderPage();

    expect(screen.getByTestId("monitor-overview-hero")).toBeInTheDocument();
    expect(apiGetUrls("/monitor/uptime-summary/")).toHaveLength(1);
    expect(openIncidentRequests()).toHaveLength(1);
    expect(listRequests(Alert)).toHaveLength(1);
    expect(listRequests(MonitorOwnerUser)).toHaveLength(1);
    expect(apiGetUrls("/monitor/refresh-status/")).toHaveLength(1);
  });
});

describe("Monitor overview page: layout", () => {
  test("lays the main and side column cards out in the spec's order", async () => {
    await renderPage();

    const main: Array<HTMLElement> = [
      heading("Uptime history"),
      screen.getByTestId("stub-EmbeddedMetricCard"),
      screen.getByTestId("stub-Summary"),
      screen.getByTestId("stub-MonitorFeed"),
    ];
    const side: Array<HTMLElement> = [
      heading("Open incidents & alerts"),
      heading("Recent status changes"),
      heading("Probes"),
      screen.getByTestId("stub-card-Monitor Details"),
      screen.getByTestId("stub-OverviewCustomFields"),
    ];

    for (const element of main) {
      expect(isInMainColumn(element)).toBe(true);
    }

    for (const element of side) {
      expect(isInMainColumn(element)).toBe(false);
    }

    expectDocumentOrder([...main, ...side]);

    // The custom fields card is stacked like every other side card.
    expect(
      latestProps<{ headerLayout?: string }>("OverviewCustomFields"),
    ).toMatchObject({ headerLayout: "stacked" });
  });

  test("puts the telemetry preview after the summary and before the activity", async () => {
    setUpServer({
      id: MONITOR_A,
      type: MonitorType.Logs,
      statusId: OPERATIONAL_ID,
      stepData: { logMonitor: { body: "OutOfMemory" } },
      overrides: {
        telemetryMonitorLastMonitorAt: secondsAgo(30),
        telemetryMonitorNextMonitorAt: secondsAgo(-30),
      },
    });
    server.probes = [];

    await renderPage();

    expectDocumentOrder([
      heading("Uptime history"),
      screen.getByTestId("stub-Summary"),
      heading("Logs preview"),
      screen.getByTestId("stub-LogMonitorPreview"),
      screen.getByTestId("stub-MonitorFeed"),
    ]);
    expect(isInMainColumn(screen.getByTestId("stub-LogMonitorPreview"))).toBe(
      true,
    );
  });

  test("the stat bar sits between the hero and the grid", async () => {
    await renderPage();

    const hero: HTMLElement = screen.getByTestId("monitor-overview-hero");
    const statBar: HTMLElement = screen.getByRole("group", {
      name: "Uptime and open work",
    });
    const mainColumn: HTMLElement = screen
      .getByTestId("stub-Summary")
      .closest('[class~="xl:col-span-2"]') as HTMLElement;
    const notice: HTMLElement = screen.getByTestId(
      "stub-DependencySuppressionWarning",
    );

    expectDocumentOrder([notice, hero, statBar, mainColumn]);
    expect(hero.contains(statBar)).toBe(false);
    expect(mainColumn.contains(statBar)).toBe(false);
  });
});

describe("Monitor overview page: refresh", () => {
  test("a manual Refresh re-reads in place and keeps every card mounted", async () => {
    await renderPage();

    const feedTokenBefore: number = latestProps<{ refreshToken: number }>(
      "MonitorFeed",
    ).refreshToken;
    const mountsBefore: Record<string, number> = { ...mountCounts };

    expect(Object.keys(mountsBefore).length).toBeGreaterThanOrEqual(7);

    await act(async () => {
      fireEvent.click(screen.getByTestId("monitor-overview-refresh"));
    });
    await flush();

    expect(itemRequests()).toHaveLength(2);
    expect(mountCounts).toEqual(mountsBefore);
    expect(screen.queryByText("Loading monitor")).toBeNull();

    // Everything the Refresh button promises is read again...
    expect(apiGetUrls("/monitor/uptime-summary/")).toHaveLength(2);
    expect(listRequests(MonitorOwnerUser)).toHaveLength(2);
    expect(openIncidentRequests()).toHaveLength(2);
    expect(
      latestProps<{ refreshToken: number }>("MonitorFeed").refreshToken,
    ).toBe(feedTokenBefore + 1);
    expect(
      latestProps<{ refresher: boolean }>("CardModelDetail:Monitor Details")
        .refresher,
    ).toBe(true);
    expect(
      latestProps<{ refreshToggle: string }>("DependencySuppressionWarning")
        .refreshToggle,
    ).toBe("0|1");

    // ...but the status repair is never sent twice for one visit.
    expect(apiGetUrls("/monitor/refresh-status/")).toHaveLength(1);
  });

  test("a failed refresh keeps the page and says so in the hero", async () => {
    await renderPage();

    const mountsBefore: Record<string, number> = { ...mountCounts };
    server.monitorFailures = [new Error("Gateway timed out")];

    await act(async () => {
      fireEvent.click(screen.getByTestId("monitor-overview-refresh"));
    });
    await flush();

    const alert: HTMLElement = screen.getByTestId(
      "monitor-overview-refresh-error",
    );

    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("Gateway timed out");
    expect(screen.getByTestId("monitor-overview-hero")).toBeInTheDocument();
    expect(screen.getByTestId("stub-Summary")).toBeInTheDocument();
    expect(mountCounts).toEqual(mountsBefore);
  });

  test("open work follows every poll; the uptime history every fifth", async () => {
    await renderPage();

    expect(openIncidentRequests()).toHaveLength(1);
    expect(apiGetUrls("/monitor/uptime-summary/")).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(MONITOR_OVERVIEW_REFRESH_INTERVAL_MS);
    });
    await flush();

    expect(itemRequests()).toHaveLength(2);
    expect(openIncidentRequests()).toHaveLength(2);
    expect(apiGetUrls("/monitor/uptime-summary/")).toHaveLength(1);
    // Owners are not part of "is it healthy"; the poll leaves them alone.
    expect(listRequests(MonitorOwnerUser)).toHaveLength(1);

    for (let tick: number = 0; tick < 4; tick++) {
      await act(async () => {
        jest.advanceTimersByTime(MONITOR_OVERVIEW_REFRESH_INTERVAL_MS);
      });
      await flush();
    }

    // The first load, then one per poll; the fifth poll reloads the history.
    expect(openIncidentRequests()).toHaveLength(6);
    expect(apiGetUrls("/monitor/uptime-summary/")).toHaveLength(2);
    expect(listRequests(MonitorOwnerUser)).toHaveLength(1);
  });

  test("a status change reloads the uptime history and the feed at once", async () => {
    await renderPage();

    const feedTokenBefore: number = latestProps<{ refreshToken: number }>(
      "MonitorFeed",
    ).refreshToken;

    setUpServer({ ...API_MONITOR, statusId: OFFLINE_ID });
    server.statusRows = [buildOpenStatusRow(OFFLINE_ID)];

    await act(async () => {
      jest.advanceTimersByTime(MONITOR_OVERVIEW_REFRESH_INTERVAL_MS);
    });
    await flush();

    expect(
      within(screen.getByTestId("monitor-overview-badge")).getByText("Offline"),
    ).toBeInTheDocument();
    expect(apiGetUrls("/monitor/uptime-summary/")).toHaveLength(2);
    expect(
      latestProps<{ refreshToken: number }>("MonitorFeed").refreshToken,
    ).toBe(feedTokenBefore + 1);
    expect(
      latestProps<{ refreshToggle: string }>("DependencySuppressionWarning")
        .refreshToggle,
    ).toBe("1|0");
  });
});

interface FamilyCase {
  name: string;
  monitor: MonitorSpec;
  probes?: Array<ProbeSpec>;
  facts: Array<string>;
  hasStatBar: boolean;
  hasUptimeHistory: boolean;
  hasSummary: boolean;
  hasResponseTime: boolean;
  // The side card's heading, or null for none.
  sideCard: string | null;
  // The setup card's heading, or null for none.
  setup: string | null;
  // A stub the main column shows, beyond the ones every family gets.
  extraStub: string | null;
}

const FAMILY_CASES: Array<FamilyCase> = [
  {
    name: "a probe check",
    monitor: API_MONITOR,
    facts: ["latest-result", "probes", "owners"],
    hasStatBar: true,
    hasUptimeHistory: true,
    hasSummary: true,
    hasResponseTime: true,
    sideCard: "Probes",
    setup: null,
    extraStub: null,
  },
  {
    name: "a heartbeat waiting for its first request",
    monitor: {
      id: MONITOR_A,
      type: MonitorType.IncomingRequest,
      statusId: OPERATIONAL_ID,
    },
    probes: [],
    facts: ["missing-window", "heartbeat-check", "owners"],
    hasStatBar: false,
    hasUptimeHistory: false,
    hasSummary: false,
    hasResponseTime: false,
    sideCard: null,
    setup: "Send the first heartbeat",
    extraStub: null,
  },
  {
    name: "a heartbeat that has reported",
    monitor: {
      id: MONITOR_A,
      type: MonitorType.IncomingRequest,
      statusId: OPERATIONAL_ID,
      overrides: {
        incomingMonitorRequest: {
          incomingRequestReceivedAt: secondsAgo(120),
          requestMethod: "POST",
        } as unknown as Monitor["incomingMonitorRequest"],
        incomingRequestMonitorHeartbeatCheckedAt: secondsAgo(60),
      },
    },
    probes: [],
    facts: ["missing-window", "heartbeat-check", "owners"],
    hasStatBar: true,
    hasUptimeHistory: true,
    hasSummary: true,
    hasResponseTime: false,
    sideCard: "Heartbeat URL",
    setup: null,
    extraStub: null,
  },
  {
    name: "a server agent waiting for its first report",
    monitor: {
      id: MONITOR_A,
      type: MonitorType.Server,
      statusId: OPERATIONAL_ID,
    },
    probes: [],
    facts: ["host", "cpu", "memory", "owners"],
    hasStatBar: false,
    hasUptimeHistory: false,
    hasSummary: false,
    hasResponseTime: false,
    sideCard: null,
    setup: null,
    extraStub: "ServerMonitorDocumentation",
  },
  {
    name: "a server agent that has reported",
    monitor: {
      id: MONITOR_A,
      type: MonitorType.Server,
      statusId: OPERATIONAL_ID,
      overrides: {
        serverMonitorRequestReceivedAt: secondsAgo(60),
        serverMonitorResponse: {
          hostname: "web-01",
          basicInfrastructureMetrics: {
            cpuMetrics: { percentUsed: 12 },
            memoryMetrics: { percentUsed: 48 },
          },
        } as unknown as Monitor["serverMonitorResponse"],
      },
    },
    probes: [],
    facts: ["host", "cpu", "memory", "owners"],
    hasStatBar: true,
    hasUptimeHistory: true,
    hasSummary: true,
    hasResponseTime: false,
    sideCard: "Server agent",
    setup: null,
    extraStub: null,
  },
  {
    name: "a telemetry monitor",
    monitor: {
      id: MONITOR_A,
      type: MonitorType.Logs,
      statusId: OPERATIONAL_ID,
      stepData: { logMonitor: { body: "OutOfMemory" } },
      overrides: {
        telemetryMonitorLastMonitorAt: secondsAgo(30),
        telemetryMonitorNextMonitorAt: secondsAgo(-30),
      },
    },
    probes: [],
    facts: ["evaluates", "criteria", "owners"],
    hasStatBar: true,
    hasUptimeHistory: true,
    hasSummary: true,
    hasResponseTime: false,
    sideCard: null,
    setup: null,
    extraStub: "LogMonitorPreview",
  },
  {
    name: "an infrastructure monitor",
    monitor: {
      id: MONITOR_A,
      type: MonitorType.Kubernetes,
      statusId: OPERATIONAL_ID,
      overrides: {
        telemetryMonitorLastMonitorAt: secondsAgo(30),
        telemetryMonitorNextMonitorAt: secondsAgo(-30),
      },
    },
    probes: [],
    facts: ["evaluates", "criteria", "owners"],
    hasStatBar: true,
    hasUptimeHistory: true,
    hasSummary: true,
    hasResponseTime: false,
    sideCard: null,
    setup: null,
    extraStub: null,
  },
  {
    name: "a network device monitor",
    monitor: {
      id: MONITOR_A,
      type: MonitorType.NetworkDevice,
      statusId: OPERATIONAL_ID,
      stepData: { networkDeviceMonitor: { networkDeviceId: DEVICE_ID } },
    },
    probes: [],
    facts: ["device", "evaluated", "owners"],
    hasStatBar: true,
    hasUptimeHistory: true,
    hasSummary: true,
    hasResponseTime: false,
    sideCard: null,
    setup: null,
    extraStub: null,
  },
  {
    name: "a manual monitor",
    monitor: {
      id: MONITOR_A,
      type: MonitorType.Manual,
      statusId: OPERATIONAL_ID,
      stepData: null,
    },
    probes: [],
    facts: ["checks", "owners"],
    hasStatBar: true,
    hasUptimeHistory: true,
    hasSummary: false,
    hasResponseTime: false,
    sideCard: "Manual monitor",
    setup: null,
    extraStub: null,
  },
];

const SIDE_CARD_HEADINGS: Array<string> = [
  "Probes",
  "Heartbeat URL",
  "Server agent",
  "Manual monitor",
];

describe.each(FAMILY_CASES)(
  "Monitor overview page for $name",
  (familyCase: FamilyCase) => {
    test("shows the family's facts and exactly its cards", async () => {
      setUpServer(familyCase.monitor);

      if (familyCase.probes) {
        server.probes = familyCase.probes;
      }

      await renderPage();

      expect(getFactKeys()).toEqual(familyCase.facts);

      expect(
        screen.queryByRole("group", { name: "Uptime and open work" }) !== null,
      ).toBe(familyCase.hasStatBar);
      expect(
        screen.queryByRole("heading", { name: "Uptime history" }) !== null,
      ).toBe(familyCase.hasUptimeHistory);
      expect(screen.queryByTestId("stub-Summary") !== null).toBe(
        familyCase.hasSummary,
      );
      expect(screen.queryByTestId("stub-EmbeddedMetricCard") !== null).toBe(
        familyCase.hasResponseTime,
      );

      for (const sideHeading of SIDE_CARD_HEADINGS) {
        expect({
          sideHeading,
          shown: screen.queryByRole("heading", { name: sideHeading }) !== null,
        }).toEqual({
          sideHeading,
          shown: sideHeading === familyCase.sideCard,
        });
      }

      if (familyCase.sideCard) {
        expect(isInMainColumn(heading(familyCase.sideCard))).toBe(false);
      }

      if (familyCase.setup) {
        expect(isInMainColumn(heading(familyCase.setup))).toBe(true);
      } else {
        expect(
          screen.queryByRole("heading", { name: "Send the first heartbeat" }),
        ).toBeNull();
      }

      if (familyCase.extraStub) {
        expect(
          isInMainColumn(screen.getByTestId(`stub-${familyCase.extraStub}`)),
        ).toBe(true);
      }

      // Every family gets the feed, open work, recent changes and details.
      expect(screen.getByTestId("stub-MonitorFeed")).toBeInTheDocument();
      expect(heading("Open incidents & alerts")).toBeInTheDocument();
      expect(heading("Recent status changes")).toBeInTheDocument();
      expect(
        screen.getByTestId("stub-card-Monitor Details"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("stub-OverviewCustomFields"),
      ).toBeInTheDocument();
    });
  },
);

describe("Monitor overview page: roles", () => {
  const HEARTBEAT_AWAITING: MonitorSpec = {
    id: MONITOR_A,
    type: MonitorType.IncomingRequest,
    statusId: OPERATIONAL_ID,
  };

  test("an owner sees everything, including the heartbeat URL with its secret", async () => {
    await renderPage();

    for (const id of [
      "monitor-uptime-24h",
      "monitor-uptime-7d",
      "monitor-uptime-30d",
    ]) {
      expect(within(tile(id)).getByText("100%")).toBeInTheDocument();
    }

    expect(
      within(tile("monitor-open-now")).getByText("Nothing open"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("stub-EmbeddedMetricCard")).toBeInTheDocument();
    expect(screen.getByTestId("stub-MonitorFeed")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("monitor-overview-fact-owners")).getByText(
        "No owners",
      ),
    ).toBeInTheDocument();
    // Probes read in full on the first load, with their results.
    expect(
      latestProps<{ probeLoadError?: string }>("Summary").probeLoadError,
    ).toBeUndefined();

    cleanup();
    setUpServer(HEARTBEAT_AWAITING);
    server.probes = [];

    const rendered: RenderResult = await renderPage();

    expect(itemRequests().pop()!.select).toMatchObject({
      incomingRequestSecretKey: true,
    });
    expect(rendered.container.innerHTML).toContain(HEARTBEAT_SECRET);
    expect(screen.queryByText("Setup details are hidden")).toBeNull();
  });

  test("a Viewer never gets the secret: not in the select, not in the DOM", async () => {
    permissions = [Permission.Viewer];
    setUpServer(HEARTBEAT_AWAITING);
    server.probes = [];

    const rendered: RenderResult = await renderPage();

    for (const column of SECRET_KEY_COLUMNS) {
      expect({
        column,
        selected: Boolean(itemRequests()[0]!.select[column]),
      }).toEqual({ column, selected: false });
    }

    expect(screen.getByText("Setup details are hidden")).toBeInTheDocument();
    expect(rendered.container.innerHTML).not.toContain(HEARTBEAT_SECRET);
  });

  test("a MonitorViewer gets the page without incidents, alerts or metrics, and never a false zero", async () => {
    permissions = [Permission.MonitorViewer];

    await renderPage();

    expect(screen.getByTestId("monitor-overview-hero")).toBeInTheDocument();
    expect(screen.getByTestId("stub-Summary")).toBeInTheDocument();

    // Neither list is asked for; the gate already knows the answer.
    expect(listRequests(Incident)).toHaveLength(0);
    expect(listRequests(Alert)).toHaveLength(0);

    const openNow: HTMLElement = tile("monitor-open-now");

    expect(within(openNow).getAllByText("—").length).toBeGreaterThan(0);
    expect(openNow).toHaveTextContent("Incidents and alerts hidden: no access");
    expect(openNow).not.toHaveTextContent("0 incidents");
    expect(openNow).not.toHaveTextContent("Nothing open");

    // The response-time chart needs telemetry access; the card says so.
    expect(screen.queryByTestId("stub-EmbeddedMetricCard")).toBeNull();
    expect(
      screen.getByText(
        "Response-time history needs permission to read telemetry.",
      ),
    ).toBeInTheDocument();
  });

  test("ReadProjectMonitor gets the row alone: no probe, timeline, uptime or feed reads", async () => {
    permissions = [Permission.ReadProjectMonitor];

    await renderPage();

    expect(screen.getByTestId("monitor-overview-hero")).toBeInTheDocument();

    expect(listRequests(MonitorProbe)).toHaveLength(0);
    expect(listRequests(MonitorStatusTimeline)).toHaveLength(0);
    expect(apiGetUrls("/monitor/uptime-summary/")).toHaveLength(0);
    expect(screen.queryByTestId("stub-MonitorFeed")).toBeNull();
    expect(screen.getByText("Activity is hidden")).toBeInTheDocument();

    // The status is shown, but no duration it cannot vouch for.
    expect(screen.getByTestId("monitor-overview-headline")).toHaveTextContent(
      /^Operational$/,
    );

    for (const id of [
      "monitor-uptime-24h",
      "monitor-uptime-7d",
      "monitor-uptime-30d",
    ]) {
      expect(within(tile(id)).getByText("—")).toBeInTheDocument();
      expect(tile(id)).toHaveTextContent("No access to status history");
      expect(tile(id)).not.toHaveTextContent("100%");
    }

    // Unreadable probes are not "no probes".
    expect(
      latestProps<{ probeLoadError?: string }>("Summary").probeLoadError,
    ).toBe("You need permission to read this monitor's probes.");
    expect(
      within(screen.getByTestId("monitor-overview-fact-owners")).getByText(
        "Unavailable",
      ),
    ).toBeInTheDocument();
  });
});

describe("Monitor overview page: moving between monitors", () => {
  test("shows the skeleton at once and never shows monitor A's data on B", async () => {
    setUpServer({ id: MONITOR_B, type: MonitorType.API, statusId: OFFLINE_ID });

    const rendered: RenderResult = await renderPage();

    expect(
      within(screen.getByTestId("monitor-overview-badge")).getByText(
        "Operational",
      ),
    ).toBeInTheDocument();

    const summaryRendersForA: number = propsHistory("Summary").length;
    holdMonitorRead(MONITOR_B);

    await navigateTo(rendered, MONITOR_B);

    // The first render for B is the skeleton, not A's page.
    expect(screen.getByRole("status")).toHaveTextContent("Loading monitor");
    expect(screen.queryByTestId("monitor-overview-hero")).toBeNull();
    expect(screen.queryByText("Operational")).toBeNull();
    expect(propsHistory("Summary")).toHaveLength(summaryRendersForA);

    await flush();

    expect(screen.queryByTestId("monitor-overview-hero")).toBeNull();

    await releaseMonitorRead(MONITOR_B);

    expect(
      within(screen.getByTestId("monitor-overview-badge")).getByText("Offline"),
    ).toBeInTheDocument();

    // Everything rendered since the switch was for B.
    for (const props of propsHistory<{ monitorId?: ObjectID }>("Summary").slice(
      summaryRendersForA,
    )) {
      expect(props.monitorId?.toString()).toBe(MONITOR_B);
    }

    expect(
      latestProps<{ monitorId: ObjectID }>("MonitorFeed").monitorId.toString(),
    ).toBe(MONITOR_B);
    expect(apiGetUrls(`/monitor/uptime-summary/${MONITOR_B}`)).toHaveLength(1);
    expect(apiGetUrls(`/monitor/refresh-status/${MONITOR_B}`)).toHaveLength(1);
  });

  test("a late save from the previous monitor's details card is ignored", async () => {
    setUpServer({ id: MONITOR_B, type: MonitorType.API, statusId: OFFLINE_ID });

    const rendered: RenderResult = await renderPage();

    const saveForA: () => void = latestProps<{ onSaveSuccess: () => void }>(
      "CardModelDetail:Monitor Details",
    ).onSaveSuccess;

    holdMonitorRead(MONITOR_B);
    await navigateTo(rendered, MONITOR_B);
    await flush();

    const readsBefore: number = itemRequests().length;

    await act(async () => {
      saveForA();
    });
    await flush();

    // No header refresh and no re-read of A, which would cancel B's load.
    expect(refreshHeaderMock).not.toHaveBeenCalled();
    expect(itemRequests()).toHaveLength(readsBefore);

    await releaseMonitorRead(MONITOR_B);

    expect(
      within(screen.getByTestId("monitor-overview-badge")).getByText("Offline"),
    ).toBeInTheDocument();
  });
});

describe("Monitor overview page: wiring", () => {
  test("saving details refreshes the header, re-reads the row and bumps the feed token", async () => {
    await renderPage();

    const details: { onSaveSuccess: () => void; refresher: boolean } =
      latestProps<{ onSaveSuccess: () => void; refresher: boolean }>(
        "CardModelDetail:Monitor Details",
      );
    const feedTokenBefore: number = latestProps<{ refreshToken: number }>(
      "MonitorFeed",
    ).refreshToken;
    const readsBefore: number = itemRequests().length;

    await act(async () => {
      details.onSaveSuccess();
    });
    await flush();

    expect(refreshHeaderMock).toHaveBeenCalledTimes(1);
    expect(itemRequests()).toHaveLength(readsBefore + 1);
    expect(
      latestProps<{ refreshToken: number }>("MonitorFeed").refreshToken,
    ).toBe(feedTokenBefore + 1);

    // Not a manual refresh: the details card is not told to re-read itself.
    expect(
      latestProps<{ refresher: boolean }>("CardModelDetail:Monitor Details")
        .refresher,
    ).toBe(details.refresher);
    expect(listRequests(MonitorOwnerUser)).toHaveLength(1);
  });

  test("the Summary gets the monitor's own probes, the switched-off ones, its steps and each probe's verdict", async () => {
    server.logs = [
      buildLog({
        probeId: PROBE_FRANKFURT,
        time: secondsAgo(30),
        summary: buildEvaluation("Frankfurt verdict"),
      }),
    ];

    await renderPage();

    interface SummaryProps {
      monitorType: MonitorType;
      probes: Array<Probe>;
      disabledProbeIds: Array<string>;
      monitorSteps: MonitorSteps | undefined;
      monitorId: ObjectID;
      description: string;
      probeLoadError?: string;
      probeMonitorResponses?: Array<MonitorStepProbeResponse>;
      evaluationSummariesByProbeId?: Dictionary<MonitorEvaluationSummary>;
      evaluationSummary?: MonitorEvaluationSummary;
    }

    const props: SummaryProps = latestProps<SummaryProps>("Summary");

    expect(props.monitorType).toBe(MonitorType.API);
    expect(
      props.probes.map((probe: Probe) => {
        return [probe._id?.toString(), probe.name];
      }),
    ).toEqual([
      [PROBE_FRANKFURT, "Frankfurt"],
      [PROBE_VIRGINIA, "Virginia"],
    ]);
    expect(props.disabledProbeIds).toEqual([PROBE_VIRGINIA]);
    expect(props.monitorSteps).toBe(getSteps(API_MONITOR));
    expect(props.monitorId.toString()).toBe(MONITOR_A);
    expect(props.description).toBe(
      "What each probe saw on its most recent check.",
    );
    expect(props.probeLoadError).toBeUndefined();
    expect(props.probeMonitorResponses).toHaveLength(1);
    expect(Object.keys(props.evaluationSummariesByProbeId || {})).toEqual([
      PROBE_FRANKFURT,
    ]);
    expect(
      props.evaluationSummariesByProbeId?.[PROBE_FRANKFURT]?.criteriaResults[0]
        ?.criteriaName,
    ).toBe("Frankfurt verdict");
    // The newest verdict is that same probe's.
    expect(props.evaluationSummary).toEqual(
      props.evaluationSummariesByProbeId?.[PROBE_FRANKFURT],
    );
    expect(props.evaluationSummary).toBeDefined();
  });

  test("the hero and the probes card agree on the probe count", async () => {
    await renderPage();

    // One of the two attached probes is switched off.
    expect(
      screen.getByTestId("monitor-overview-fact-probes"),
    ).toHaveTextContent(/1 of 1/);
    const probesCard: HTMLElement = heading("Probes").closest(
      '[data-testid="card"]',
    ) as HTMLElement;

    expect(within(probesCard).getByText("Frankfurt")).toBeInTheDocument();
    expect(within(probesCard).getByText("Virginia")).toBeInTheDocument();
    expect(
      within(probesCard).getByText("Turned off for this monitor"),
    ).toBeInTheDocument();
  });
});
