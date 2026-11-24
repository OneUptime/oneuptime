import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";

/*
 * THE ROOT CAUSE CARD, FOR EACH ROLE THAT READS INCIDENTS OR ALERTS,
 * ANSWERED BY THE SERVER ITSELF (#10309).
 *
 * The card charts the metrics behind an incident or an alert: the snapshot
 * of the metric check that opened it, or, for one that kept none (declared
 * or created by hand on a metrics monitor), its monitor's metrics as the
 * monitor reads them now. It read every monitor's steps - the whole of what
 * each checks - through the incident or alert, for every reader of it; no
 * relation reads them now. It reads which monitors the event is on and what
 * kind through it, and the steps of the monitors it charts from on the
 * monitors themselves, by the reader's own read:
 *
 *   - an event that kept a snapshot is charted for every reader, and no
 *     monitor is read;
 *   - one that kept none is charted from its monitor for who may read the
 *     monitor; everyone else is not sent the monitor's read and is shown no
 *     card, as the event's Overview shows nothing for such an event - and
 *     no read of theirs is refused;
 *   - the read the card sent until now is refused to every reader.
 *
 * Everything on the Dashboard's side is real but the socket and the charts:
 * its API client sends each request over HTTP to the server's own routes,
 * the permission layer and the error handler (DashboardRequestsOverHttp),
 * with tables held in memory that join the monitor as Postgres does. The
 * investigation the card mounts is stood in for by what it is handed.
 */

configure({ asyncUtilTimeout: 15000 });

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

// The incident and alert routers pull isolated-vm; nothing here runs it.
jest.mock("isolated-vm", () => {
  return {};
});

interface ChartedCard {
  metricNames: Array<string>;
  chartedFromMonitorNow: unknown;
}

const mockCharted: Array<ChartedCard> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel",
  () => {
    return {
      __esModule: true,
      default: (props: {
        telemetryQuery: {
          metricViewData?: {
            queryConfigs?: Array<{
              metricQueryData?: { filterData?: { metricName?: unknown } };
            }>;
          };
        };
        chartedFromMonitorNow?: unknown;
      }): React.ReactElement => {
        const metricNames: Array<string> = (
          props.telemetryQuery.metricViewData?.queryConfigs || []
        ).map(
          (queryConfig: {
            metricQueryData?: { filterData?: { metricName?: unknown } };
          }): string => {
            return String(queryConfig.metricQueryData?.filterData?.metricName);
          },
        );

        mockCharted.push({
          metricNames: metricNames,
          chartedFromMonitorNow: props.chartedFromMonitorNow,
        });

        return (
          <div data-testid="root-cause-card-charted">
            {metricNames.join(", ")}
          </div>
        );
      },
    };
  },
);

import AlertRootCauseMetricChart from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertRootCauseMetricChart";
import IncidentRootCauseMetricChart from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentRootCauseMetricChart";
import AlertAPI from "../../../Server/API/AlertAPI";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { customDomainCaller } from "../../Server/API/CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../../Server/TestingUtils/DashboardRequestsOverHttp";
import {
  clearPrivateRecords,
  StoredRow,
  useInMemoryTable,
} from "../../Server/TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../Server/TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../../Server/TestingUtils/ServerProductsOn";

const PROJECT_ID: ObjectID = new ObjectID(
  "10309000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: string = "10309000-0000-4000-8000-0000000000d1";
const ALERT_ID: string = "10309000-0000-4000-8000-0000000000d2";
const MONITOR_ID: string = "10309000-0000-4000-8000-0000000000d3";

const FLOW_TIMEOUT_IN_MS: number = 60000;

const STARTED_AT: Date = new Date("2026-11-20T08:00:00.000Z");
const EVALUATED_FROM: Date = new Date("2026-11-20T07:55:00.000Z");

// What the check read when it opened the event.
const SNAPSHOT_METRIC: string = "system.cpu.utilization";
// What the monitor reads now: what the card charts for an event that kept none.
const MONITOR_METRIC: string = "http.server.duration";

function queryConfig(metricName: string): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      } as never,
    },
  };
}

// The snapshot as the event's row stores it: JSON.
const STORED_SNAPSHOT: JSONObject = {
  telemetryType: "Metric",
  telemetryQuery: null,
  metricViewData: {
    startAndEndDate: JSONFunctions.anyObjectToJSONObject(
      new InBetween<Date>(EVALUATED_FROM, STARTED_AT),
    ),
    queryConfigs: [queryConfig(SNAPSHOT_METRIC) as unknown as JSONObject],
    formulaConfigs: [],
  },
};

// A metrics monitor's steps: the query it runs, which its readers read.
function metricsMonitorSteps(): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.setMetricMonitor({
    ...MonitorStepMetricMonitorUtil.getDefault(),
    metricViewConfig: {
      queryConfigs: [queryConfig(MONITOR_METRIC)],
      formulaConfigs: [],
    },
  });

  const steps: MonitorSteps = new MonitorSteps();
  steps.setMonitorStepsInstanceArray([step]);
  return steps;
}

const MONITOR_ROW: StoredRow = {
  _id: MONITOR_ID,
  projectId: PROJECT_ID.toString(),
  name: "Checkout latency",
  monitorType: MonitorType.Metrics,
  isArchived: false,
  labels: [],
};

interface Reader {
  name: string;
  permissions: Array<Permission>;
  // Whether the reader may read the monitor itself.
  readsMonitors: boolean;
}

const MONITOR_READERS: Array<Reader> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    readsMonitors: true,
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    readsMonitors: true,
  },
  {
    name: "a project member",
    permissions: [Permission.ProjectMember],
    readsMonitors: true,
  },
  { name: "a viewer", permissions: [Permission.Viewer], readsMonitors: true },
];

const INCIDENT_READERS: Array<Reader> = [
  ...MONITOR_READERS,
  {
    name: "an incident admin",
    permissions: [Permission.IncidentAdmin],
    readsMonitors: false,
  },
  {
    name: "an incident member",
    permissions: [Permission.IncidentMember],
    readsMonitors: false,
  },
  {
    name: "an incident viewer",
    permissions: [Permission.IncidentViewer],
    readsMonitors: false,
  },
  {
    /*
     * The card reads the incident's state timeline and the project's
     * incident states for its moments, which a custom role is given apart.
     */
    name: "a custom role that reads incidents, their timelines and states",
    permissions: [
      Permission.ReadProjectIncident,
      Permission.ReadIncidentStateTimeline,
      Permission.ReadIncidentState,
    ],
    readsMonitors: false,
  },
];

const ALERT_READERS: Array<Reader> = [
  ...MONITOR_READERS,
  {
    name: "an alert admin",
    permissions: [Permission.AlertAdmin],
    readsMonitors: false,
  },
  {
    name: "an alert member",
    permissions: [Permission.AlertMember],
    readsMonitors: false,
  },
  {
    name: "an alert viewer",
    permissions: [Permission.AlertViewer],
    readsMonitors: false,
  },
  {
    // As above: an alert's timeline and the alert states are permissions of their own.
    name: "a custom role that reads alerts, their timelines and states",
    permissions: [
      Permission.ReadAlert,
      Permission.ReadAlertStateTimeline,
      Permission.ReadAlertState,
    ],
    readsMonitors: false,
  },
];

interface Card {
  name: string;
  readers: Array<Reader>;
  // The event's read: its path, and the relation it names its monitors by.
  readPath: string;
  relation: string;
  // Puts the event in its table, with a snapshot or none.
  useEvent: (snapshot: JSONObject | null) => void;
  render: () => React.ReactElement;
}

const MONITOR_JOINED: StoredRow = {
  _id: MONITOR_ID,
  projectId: PROJECT_ID.toString(),
  name: "Checkout latency",
  monitorType: MonitorType.Metrics,
};

const CARDS: Array<Card> = [
  {
    name: "an incident's Root Cause card",
    readers: INCIDENT_READERS,
    readPath: `/api/incident/${INCIDENT_ID}/get-item`,
    relation: "monitors",
    useEvent: (snapshot: JSONObject | null): void => {
      useInMemoryTable(
        IncidentService as unknown as DatabaseService<BaseModel>,
        [
          {
            _id: INCIDENT_ID,
            projectId: PROJECT_ID.toString(),
            title: "Checkout is slow",
            isPrivate: false,
            labels: [],
            declaredAt: STARTED_AT,
            telemetryQuery: snapshot,
            seriesLabels: null,
            createdCriteriaId: null,
            monitors: [{ ...MONITOR_JOINED }],
          },
        ],
        { answersOnlySelectedColumns: true },
      );
    },
    render: (): React.ReactElement => {
      return (
        <IncidentRootCauseMetricChart incidentId={new ObjectID(INCIDENT_ID)} />
      );
    },
  },
  {
    name: "an alert's Root Cause card",
    readers: ALERT_READERS,
    readPath: `/api/alert/${ALERT_ID}/get-item`,
    relation: "monitor",
    useEvent: (snapshot: JSONObject | null): void => {
      useInMemoryTable(
        AlertService as unknown as DatabaseService<BaseModel>,
        [
          {
            _id: ALERT_ID,
            projectId: PROJECT_ID.toString(),
            title: "Checkout is slow",
            isPrivate: false,
            labels: [],
            createdAt: STARTED_AT,
            telemetryQuery: snapshot,
            seriesLabels: null,
            createdCriteriaId: null,
            monitorId: MONITOR_ID,
            monitor: { ...MONITOR_JOINED },
          },
        ],
        { answersOnlySelectedColumns: true },
      );
    },
    render: (): React.ReactElement => {
      return <AlertRootCauseMetricChart alertId={new ObjectID(ALERT_ID)} />;
    },
  },
];

const CASES: Array<[string, string, Card, Reader]> = CARDS.flatMap(
  (card: Card): Array<[string, string, Card, Reader]> => {
    return card.readers.map(
      (reader: Reader): [string, string, Card, Reader] => {
        return [card.name, reader.name, card, reader];
      },
    );
  },
);

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function setCaller(permissions: Array<Permission>): void {
  caller = {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
  PermissionGate.clearPermissionPropsCache();
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

function monitorReads(): Array<SentRequest> {
  return server.sentTo("POST", "/api/monitor/get-list");
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new IncidentAPI().getRouter(),
    new AlertAPI().getRouter(),
    new MonitorAPI().getRouter(),
    new BaseAPI<IncidentStateTimeline, DatabaseService<BaseModel>>(
      IncidentStateTimeline,
      IncidentStateTimelineService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<IncidentState, DatabaseService<BaseModel>>(
      IncidentState,
      IncidentStateService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<AlertStateTimeline, DatabaseService<BaseModel>>(
      AlertStateTimeline,
      AlertStateTimelineService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
    new BaseAPI<AlertState, DatabaseService<BaseModel>>(
      AlertState,
      AlertStateService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  mockCharted.length = 0;

  stubProjectDirectory({});
  everyServerProductIsOn();
  clearPrivateRecords();

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  useInMemoryTable(
    MonitorService as unknown as DatabaseService<BaseModel>,
    [{ ...MONITOR_ROW, monitorSteps: metricsMonitorSteps() }],
    { answersOnlySelectedColumns: true },
  );
  for (const service of [
    IncidentStateTimelineService,
    IncidentStateService,
    AlertStateTimelineService,
    AlertStateService,
  ]) {
    useInMemoryTable(service as unknown as DatabaseService<BaseModel>, []);
  }

  setCaller([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(card: Card): Promise<void> {
  await act(async () => {
    render(card.render());
  });
}

// The card's own read of its event, as the server read it.
function eventReadOf(card: Card): SentRequest {
  const reads: Array<SentRequest> = server.sentTo("POST", card.readPath);

  expect(reads.length).toBeGreaterThan(0);

  return reads[0]!;
}

function selectOfRead(sent: SentRequest): JSONObject {
  return (sent.body as JSONObject)["select"] as JSONObject;
}

// Every request the card sent, and what the server answered each.
function statuses(): Array<string> {
  return server.requests.map((sent: SentRequest): string => {
    return `${sent.path.split("?")[0]} ${sent.status}`;
  });
}

describe("an event that kept a metric snapshot is charted for every reader of it, and no monitor is read", () => {
  test.each(CASES)(
    "%s: %s",
    async (_card: string, _who: string, card: Card, reader: Reader) => {
      setCaller(reader.permissions);
      card.useEvent(STORED_SNAPSHOT);

      await renderCard(card);

      await waitFor(() => {
        expect(screen.getByTestId("root-cause-card-charted")).toBeVisible();
      });

      expect(mockCharted[mockCharted.length - 1]).toEqual({
        metricNames: [SNAPSHOT_METRIC],
        chartedFromMonitorNow: undefined,
      });
      // Which monitors it is on and what kind, read through it; nothing else of them.
      expect(selectOfRead(eventReadOf(card))[card.relation]).toEqual({
        _id: true,
        monitorType: true,
      });
      expect(monitorReads()).toEqual([]);
      // No read of the reader's was refused.
      for (const status of statuses()) {
        expect(status).toMatch(/ 200$/);
      }
    },
    FLOW_TIMEOUT_IN_MS,
  );
});

describe("an event that kept none is charted from its monitor for who may read the monitor, and shown no card to anyone else", () => {
  test.each(CASES)(
    "%s: %s",
    async (_card: string, _who: string, card: Card, reader: Reader) => {
      setCaller(reader.permissions);
      card.useEvent(null);

      await renderCard(card);

      await waitFor(() => {
        // Loaded: the card, or no card where the loading one stood.
        expect(eventReadOf(card).status).toBe(200);
        expect(
          screen.queryByTestId("root-cause-card-charted") !== null ||
            screen.queryByText("Metrics") === null,
        ).toBe(true);
      });

      expect(selectOfRead(eventReadOf(card))[card.relation]).toEqual({
        _id: true,
        monitorType: true,
      });

      if (reader.readsMonitors) {
        await waitFor(() => {
          expect(screen.getByTestId("root-cause-card-charted")).toBeVisible();
        });

        // The monitor's steps, read on the monitor by the reader's own read.
        const reads: Array<SentRequest> = monitorReads();
        expect(reads).toHaveLength(1);
        expect(reads[0]!.status).toBe(200);
        expect(selectOfRead(reads[0]!)).toEqual({
          _id: true,
          monitorType: true,
          monitorSteps: true,
        });
        expect(mockCharted[mockCharted.length - 1]!.metricNames).toEqual([
          MONITOR_METRIC,
        ]);
        expect(
          mockCharted[mockCharted.length - 1]!.chartedFromMonitorNow,
        ).toBeTruthy();
      } else {
        await waitFor(() => {
          expect(screen.queryByText("Metrics")).toBeNull();
        });

        // Not sent the monitor's read, and shown no card.
        expect(monitorReads()).toEqual([]);
        expect(screen.queryByTestId("root-cause-card-charted")).toBeNull();
        expect(mockCharted).toEqual([]);
      }

      // No read of the reader's was refused.
      for (const status of statuses()) {
        expect(status).toMatch(/ 200$/);
      }
    },
    FLOW_TIMEOUT_IN_MS,
  );
});

describe("the read the card sent until #10309 is refused to every reader: no relation reads a monitor's steps", () => {
  test.each(CASES)(
    "%s: %s",
    async (_card: string, _who: string, card: Card, reader: Reader) => {
      setCaller(reader.permissions);
      card.useEvent(null);

      let isRefused: boolean = false;

      try {
        await ModelAPI.getItem<BaseModel>({
          modelType: (card.relation === "monitors"
            ? Incident
            : Alert) as unknown as { new (): BaseModel },
          id: new ObjectID(
            card.relation === "monitors" ? INCIDENT_ID : ALERT_ID,
          ),
          select: {
            telemetryQuery: true,
            [card.relation]: {
              _id: true,
              monitorType: true,
              monitorSteps: true,
            },
          } as never,
        });
      } catch {
        // ModelAPI rejects with the server's answer, read back below.
        isRefused = true;
      }

      const sent: SentRequest = server.sentTo("POST", card.readPath)[0]!;

      expect(isRefused).toBe(true);
      expect(sent.status).toBe(400);
      expect(String((sent.answer as JSONObject)["error"] || "")).toBe(
        "Column monitorSteps on Monitor does not support read on relation query.",
      );
    },
    FLOW_TIMEOUT_IN_MS,
  );
});
