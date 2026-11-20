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
 * AN AFFECTED RESOURCE'S DEBUG COMMANDS, FOR EACH ROLE THAT READS INCIDENTS
 * OR ALERTS, ANSWERED BY THE SERVER ITSELF (#10309).
 *
 * A grouped Metrics monitor's incident or alert about a managed device
 * offers the read-only commands for that device's readings: the command of
 * the reading its monitor reads, when the page knows which (#10209). The
 * page read that from the monitor's steps - the whole of what the monitor
 * checks - through the incident or alert, for every reader of it; no
 * relation reads them now. It reads which monitor and what kind through the
 * event, and a Metrics monitor's steps on the monitor, by the reader's own
 * read:
 *
 *   - who may read the monitor is offered the command of its reading alone;
 *   - everyone else is not sent the monitor's read and is offered every
 *     command of the device - and no read of theirs is refused.
 *
 * Everything on the Dashboard's side is real but the socket: its API client
 * sends each request over HTTP to the server's own routes, the permission
 * layer and the error handler (DashboardRequestsOverHttp), with tables held
 * in memory that join the monitor as Postgres does.
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

import AlertAffectedResources from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/AffectedResources";
import IncidentAffectedResources from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/AffectedResources";
import AlertAPI from "../../../Server/API/AlertAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
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
  useInMemoryTable,
} from "../../Server/TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../Server/TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../../Server/TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../../Server/TestingUtils/ServerProductsOn";

const PROJECT_ID: ObjectID = new ObjectID(
  "10309000-0000-4000-8000-000000000003",
);
const INCIDENT_ID: string = "10309000-0000-4000-8000-0000000000f1";
const ALERT_ID: string = "10309000-0000-4000-8000-0000000000f2";
const MONITOR_ID: string = "10309000-0000-4000-8000-0000000000f3";

const FLOW_TIMEOUT_IN_MS: number = 60000;

// The device the series is about, as its monitor grouped it.
const SERIES_LABELS: JSONObject = {
  "oneuptime.managed_device.name": "ESP-ID-AAAAW",
};

// What its monitor reads, and the purpose of that reading's command.
const BATTERY_READING: string = "oneuptime.managed_device.battery.level";
const BATTERY_COMMAND: string =
  "The device's battery at each read, in percent, as its device manager last heard it";
const CHECK_IN_COMMAND: string =
  "The device's last readings: how many minutes since it checked in at each read, its alias and its group";

// A Low Battery monitor's steps: the reading it compares.
function lowBatterySteps(): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.setMetricMonitor({
    ...MonitorStepMetricMonitorUtil.getDefault(),
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "a",
            title: "",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: BATTERY_READING,
              aggegationType: MetricsAggregationType.Avg,
            } as never,
            groupByAttributeKeys: ["oneuptime.managed_device.name"],
          },
        },
      ],
      formulaConfigs: [],
    },
  });

  const steps: MonitorSteps = new MonitorSteps();
  steps.setMonitorStepsInstanceArray([step]);
  return steps;
}

interface Reader {
  name: string;
  permissions: Array<Permission>;
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

interface Page {
  name: string;
  readers: Array<Reader>;
  readPath: string;
  relation: string;
  render: () => React.ReactElement;
}

const PAGES: Array<Page> = [
  {
    name: "an incident's Affected Resource",
    readers: [
      ...MONITOR_READERS,
      {
        name: "an incident admin",
        permissions: [Permission.IncidentAdmin],
        readsMonitors: false,
      },
      {
        name: "an incident viewer",
        permissions: [Permission.IncidentViewer],
        readsMonitors: false,
      },
      {
        name: "a custom role that reads incidents",
        permissions: [Permission.ReadProjectIncident],
        readsMonitors: false,
      },
    ],
    readPath: `/api/incident/${INCIDENT_ID}/get-item`,
    relation: "monitors",
    render: (): React.ReactElement => {
      return (
        <IncidentAffectedResources
          incidentId={new ObjectID(INCIDENT_ID)}
          seriesLabels={SERIES_LABELS}
        />
      );
    },
  },
  {
    name: "an alert's Affected Resource",
    readers: [
      ...MONITOR_READERS,
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
        name: "a custom role that reads alerts",
        permissions: [Permission.ReadAlert],
        readsMonitors: false,
      },
    ],
    readPath: `/api/alert/${ALERT_ID}/get-item`,
    relation: "monitor",
    render: (): React.ReactElement => {
      return (
        <AlertAffectedResources
          alertId={new ObjectID(ALERT_ID)}
          seriesLabels={SERIES_LABELS}
        />
      );
    },
  },
];

const CASES: Array<[string, string, Page, Reader]> = PAGES.flatMap(
  (page: Page): Array<[string, string, Page, Reader]> => {
    return page.readers.map(
      (reader: Reader): [string, string, Page, Reader] => {
        return [page.name, reader.name, page, reader];
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

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new IncidentAPI().getRouter(),
    new AlertAPI().getRouter(),
    new MonitorAPI().getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;

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

  const joined: JSONObject = {
    _id: MONITOR_ID,
    projectId: PROJECT_ID.toString(),
    name: "Low Battery",
    monitorType: MonitorType.Metrics,
  };

  useInMemoryTable(
    IncidentService as unknown as DatabaseService<BaseModel>,
    [
      {
        _id: INCIDENT_ID,
        projectId: PROJECT_ID.toString(),
        title: "ESP-ID-AAAAW is low on battery",
        isPrivate: false,
        labels: [],
        seriesLabels: SERIES_LABELS,
        monitors: [{ ...joined }],
      },
    ],
    { answersOnlySelectedColumns: true },
  );
  useInMemoryTable(
    AlertService as unknown as DatabaseService<BaseModel>,
    [
      {
        _id: ALERT_ID,
        projectId: PROJECT_ID.toString(),
        title: "ESP-ID-AAAAW is low on battery",
        isPrivate: false,
        labels: [],
        seriesLabels: SERIES_LABELS,
        monitorId: MONITOR_ID,
        monitor: { ...joined },
      },
    ],
    { answersOnlySelectedColumns: true },
  );
  useInMemoryTable(
    MonitorService as unknown as DatabaseService<BaseModel>,
    [
      {
        ...joined,
        isArchived: false,
        labels: [],
        monitorSteps: lowBatterySteps(),
      },
    ],
    { answersOnlySelectedColumns: true },
  );

  setCaller([Permission.ProjectOwner]);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("an Affected Resource's commands, for each reader of the incident or alert", () => {
  test.each(CASES)(
    "%s: %s",
    async (_page: string, _who: string, page: Page, reader: Reader) => {
      setCaller(reader.permissions);

      await act(async () => {
        render(page.render());
      });

      await waitFor(() => {
        expect(screen.getByText(BATTERY_COMMAND)).toBeVisible();
      });

      // Which monitor and what kind, through the event; never its steps.
      const reads: Array<SentRequest> = server.sentTo("POST", page.readPath);
      expect(
        reads.map((sent: SentRequest): number => {
          return sent.status;
        }),
      ).toEqual([200]);
      expect(
        ((reads[0]!.body as JSONObject)["select"] as JSONObject)[page.relation],
      ).toEqual({ _id: true, monitorType: true });

      const monitorReads: Array<SentRequest> = server.sentTo(
        "POST",
        "/api/monitor/get-list",
      );

      if (reader.readsMonitors) {
        // The monitor's steps on the monitor: its reading's command alone.
        await waitFor(() => {
          expect(screen.queryByText(CHECK_IN_COMMAND)).toBeNull();
        });
        expect(monitorReads).toHaveLength(1);
        expect(monitorReads[0]!.status).toBe(200);
      } else {
        // Not sent the monitor's read: every command of the device.
        expect(monitorReads).toEqual([]);
        expect(screen.getByText(CHECK_IN_COMMAND)).toBeVisible();
      }

      // No read of the reader's was refused.
      for (const sent of server.requests) {
        expect(`${sent.path} ${sent.status}`).toMatch(/ 200$/);
      }
    },
    FLOW_TIMEOUT_IN_MS,
  );
});
