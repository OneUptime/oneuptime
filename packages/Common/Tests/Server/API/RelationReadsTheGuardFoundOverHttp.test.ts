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

import {
  forgetPipelineLastErrors,
  readPipelineLastError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/PipelineLastError";
import {
  MANAGED_DEVICE_CARD_SELECT,
  readConnectionSettings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/ManagedDeviceCard";
import {
  MONITOR_GROUP_MONITORS_SELECT,
  loadMonitorGroupStatusReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupStatusReason";
import { ResourceAttentionDialogRead } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionDialog";
import { SSO_PROVIDER_DOMAINS_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/SsoProviderDomains";
import { LINEAGE_SEEN_IN_FIELD } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/TableView/Lineage";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import { ExpressRouter } from "../../../Server/Utils/Express";
import DataAssetLineageService from "../../../Server/Services/DataAssetLineageService";
import DataPipelineService from "../../../Server/Services/DataPipelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DeviceManagementConnectionService from "../../../Server/Services/DeviceManagementConnectionService";
import ManagedDeviceService from "../../../Server/Services/ManagedDeviceService";
import MonitorGroupResourceService from "../../../Server/Services/MonitorGroupResourceService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import Domain from "../../../Models/DatabaseModels/Domain";
import ManagedDevice from "../../../Models/DatabaseModels/ManagedDevice";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import Route from "../../../Types/API/Route";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Select from "../../../Types/BaseDatabase/Select";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  DEFAULT_LANGUAGE,
  Translator,
  createTranslator,
} from "../../../Types/Translator";
import Columns from "../../../UI/Components/ModelTable/Columns";
import {
  getRelationSelectFromColumns,
  getSelectFromColumns,
} from "../../../UI/Components/ModelTable/SelectFromColumns";
import FieldType from "../../../UI/Components/Types/FieldType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
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

/*
 * THE READS #10238'S GUARD FOUND, THROUGH THE SERVER'S OWN ROUTES OVER HTTP.
 *
 * Taught to read tables' columns, details' fields, selectMoreFields,
 * components' props and casts (RelationSelectColumnsWiring), the relation
 * select guard found four more pages whose read named a column the server
 * will not read through a relation - so it refused the read whole, for
 * everyone:
 *
 *   - a monitor group's "Why is this group Offline?" read each monitor's
 *     status through the monitor, a relation's relation ("You cannot query
 *     deep relations"): it reads the statuses on their own now;
 *   - a managed device's card read its connection's settings through the
 *     device: it reads them from the connection now;
 *   - Settings > SSO's providers and its notice read whether each domain is
 *     verified: Domain.isVerified is read through a relation now, beside
 *     the domain's name;
 *   - a table's Lineage read how the latest run of each edge's pipeline went,
 *     and its error: its state and start are read through the relation now,
 *     and its error, free text, from the pipeline itself.
 *
 * Each page's own read - its exported select, or the select ModelTable
 * builds from its column - goes over HTTP through Express, BaseAPI and the
 * permission layer, into tables held in memory (DashboardRequestsOverHttp),
 * and is answered; and the read each sent before is refused with the
 * sentence the page showed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10238000-0000-4000-8000-000000000001",
);

const GROUP_ID: string = "10238000-0000-4000-8000-000000000d01";
const OFFLINE_MONITOR_ID: string = "10238000-0000-4000-8000-000000000d11";
const UP_MONITOR_ID: string = "10238000-0000-4000-8000-000000000d12";
const OFFLINE_STATUS_ID: string = "10238000-0000-4000-8000-000000000d21";
const OPERATIONAL_STATUS_ID: string = "10238000-0000-4000-8000-000000000d22";

const DEVICE_ID: string = "10238000-0000-4000-8000-000000000e01";
const CONNECTION_ID: string = "10238000-0000-4000-8000-000000000e11";

const SSO_ID: string = "10238000-0000-4000-8000-000000000f01";
const OIDC_ID: string = "10238000-0000-4000-8000-000000000f02";
const VERIFIED_DOMAIN_ID: string = "10238000-0000-4000-8000-000000000f11";
const UNVERIFIED_DOMAIN_ID: string = "10238000-0000-4000-8000-000000000f12";

const EDGE_ID: string = "10238000-0000-4000-8000-000000000a01";
const TABLE_ID: string = "10238000-0000-4000-8000-000000000a11";
const PIPELINE_ID: string = "10238000-0000-4000-8000-000000000a21";
const RUN_STARTED_AT: Date = new Date("2026-11-20T06:00:00.000Z");
const RUN_ERROR: string = 'relation "orders" does not exist';

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function refusalOfRead(read: Promise<unknown>): Promise<string> {
  try {
    await read;
  } catch (err) {
    return API.getFriendlyMessage(err as Error);
  }

  return "";
}

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function routerOf(
  modelType: { new (): BaseModel },
  service: unknown,
): ExpressRouter {
  return new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
    modelType,
    service as DatabaseService<BaseModel>,
  ).getRouter();
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    routerOf(MonitorGroupResource, MonitorGroupResourceService),
    routerOf(MonitorStatus, MonitorStatusService),
    routerOf(MonitorStatusTimeline, MonitorStatusTimelineService),
    routerOf(ManagedDevice, ManagedDeviceService),
    routerOf(DeviceManagementConnection, DeviceManagementConnectionService),
    routerOf(ProjectSSO, ProjectSsoService),
    routerOf(ProjectOIDC, ProjectOidcService),
    routerOf(DataAssetLineage, DataAssetLineageService),
    routerOf(DataPipeline, DataPipelineService),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function statusesOf(path: string): Array<number> {
  return server.sentTo("POST", path).map((sent: SentRequest): number => {
    return sent.status;
  });
}

describe("a monitor group's why: its monitors, then their statuses on their own", () => {
  beforeEach(() => {
    const monitorOf: (
      id: string,
      name: string,
      statusId: string,
    ) => Record<string, unknown> = (
      id: string,
      name: string,
      statusId: string,
    ): Record<string, unknown> => {
      return {
        _id: id,
        name: name,
        isArchived: false,
        disableActiveMonitoring: false,
        currentMonitorStatusId: statusId,
      };
    };

    useInMemoryTable(MonitorGroupResourceService, [
      {
        _id: "10238000-0000-4000-8000-000000000d31",
        projectId: PROJECT_ID.toString(),
        monitorGroupId: GROUP_ID,
        monitorId: OFFLINE_MONITOR_ID,
        monitor: monitorOf(
          OFFLINE_MONITOR_ID,
          "Checkout API",
          OFFLINE_STATUS_ID,
        ),
      },
      {
        _id: "10238000-0000-4000-8000-000000000d32",
        projectId: PROJECT_ID.toString(),
        monitorGroupId: GROUP_ID,
        monitorId: UP_MONITOR_ID,
        monitor: monitorOf(UP_MONITOR_ID, "Home page", OPERATIONAL_STATUS_ID),
      },
    ]);
    useInMemoryTable(MonitorStatusService, [
      {
        _id: OFFLINE_STATUS_ID,
        projectId: PROJECT_ID.toString(),
        name: "Offline",
        isOperationalState: false,
        isOfflineState: true,
      },
      {
        _id: OPERATIONAL_STATUS_ID,
        projectId: PROJECT_ID.toString(),
        name: "Operational",
        isOperationalState: true,
        isOfflineState: false,
      },
    ]);
    useInMemoryTable(MonitorStatusTimelineService, [
      {
        _id: "10238000-0000-4000-8000-000000000d41",
        projectId: PROJECT_ID.toString(),
        monitorId: OFFLINE_MONITOR_ID,
        startsAt: new Date("2026-11-20T07:00:00.000Z"),
        endsAt: null,
        rootCause: "The website did not respond.",
      },
    ]);
  });

  test("lists the monitor that is down, and why, every read answered", async () => {
    const read: ResourceAttentionDialogRead =
      await loadMonitorGroupStatusReason({
        monitorGroupId: new ObjectID(GROUP_ID),
        translator: ENGLISH,
        getMonitorRoute: (): Route => {
          return new Route("/monitor");
        },
      });

    expect(
      read.items.map((item: { name: string }): string => {
        return item.name;
      }),
    ).toEqual(["Checkout API"]);
    expect(statusesOf("/api/monitor-group-resource/get-list")).toEqual([200]);
    expect(statusesOf("/api/monitor-status/get-list")).toEqual([200]);
    expect(statusesOf("/api/monitor-status-timeline/get-list")).toEqual([200]);
  });

  test("the read it sent before, a monitor's status through the monitor, is refused whole", async () => {
    const before: Select<MonitorGroupResource> = {
      ...MONITOR_GROUP_MONITORS_SELECT,
      monitor: {
        ...(MONITOR_GROUP_MONITORS_SELECT.monitor as JSONObject),
        currentMonitorStatus: {
          name: true,
          isOperationalState: true,
          isOfflineState: true,
        },
      },
    } as Select<MonitorGroupResource>;

    expect(
      await refusalOfRead(
        ModelAPI.getList<MonitorGroupResource>({
          modelType: MonitorGroupResource,
          query: { monitorGroupId: new ObjectID(GROUP_ID) },
          limit: 10,
          skip: 0,
          select: before,
          sort: {},
        }),
      ),
    ).toBe(
      "You cannot query deep relations. Querying deep relations is not supported.",
    );
  });
});

describe("a managed device's card: the device, and its connection's settings from the connection", () => {
  let devices: InMemoryTable;

  beforeEach(() => {
    devices = useInMemoryTable(ManagedDeviceService, [
      {
        _id: DEVICE_ID,
        projectId: PROJECT_ID.toString(),
        deviceName: "ESP-ID-AAAAW",
        connectionId: CONNECTION_ID,
        connection: {
          _id: CONNECTION_ID,
          name: "Acme fleet",
          provider: "Esper",
        },
      },
    ]);
    useInMemoryTable(DeviceManagementConnectionService, [
      {
        _id: CONNECTION_ID,
        projectId: PROJECT_ID.toString(),
        name: "Acme fleet",
        provider: "Esper",
        config: { tenant: "acme", readIntervalInMinutes: 15 },
      },
    ]);
  });

  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a viewer", [Permission.Viewer]],
  ] as Array<[string, Array<Permission>]>)(
    "%s reads the card's device, and its connection's settings from the connection",
    async (_who: string, permissions: Array<Permission>) => {
      caller = callerWith(permissions);

      const device: ManagedDevice | null =
        await ModelAPI.getItem<ManagedDevice>({
          modelType: ManagedDevice,
          id: new ObjectID(DEVICE_ID),
          select: MANAGED_DEVICE_CARD_SELECT,
        });

      expect(statusesOf(`/api/managed-device/${DEVICE_ID}/get-item`)).toEqual([
        200,
      ]);
      expect(device?.connection?.name).toBe("Acme fleet");

      expect(await readConnectionSettings(device?.connectionId)).toEqual({
        tenant: "acme",
        readIntervalInMinutes: 15,
      });
      expect(
        statusesOf(
          `/api/device-management-connection/${CONNECTION_ID}/get-item`,
        ),
      ).toEqual([200]);
    },
  );

  test("the read it sent before, the settings through the device, is refused whole", async () => {
    const before: Select<ManagedDevice> = {
      ...MANAGED_DEVICE_CARD_SELECT,
      connection: { name: true, config: true, provider: true },
    };

    expect(
      await refusalOfRead(
        ModelAPI.getItem<ManagedDevice>({
          modelType: ManagedDevice,
          id: new ObjectID(DEVICE_ID),
          select: before,
        }),
      ),
    ).toBe(
      "Column config on Device Management Connection does not support read on relation query.",
    );
    expect(devices.repository.find).not.toHaveBeenCalled();
  });

  test("a connection that cannot be read leaves the settings out, never the card", async () => {
    caller = callerWith([Permission.SecurityViewer]);

    expect(
      await readConnectionSettings(new ObjectID(CONNECTION_ID)),
    ).toBeNull();
    expect(await readConnectionSettings(undefined)).toBeNull();
  });
});

describe("Settings > SSO's providers and notice: whether each domain is verified", () => {
  const DOMAINS: Array<JSONObject> = [
    { _id: VERIFIED_DOMAIN_ID, domain: "acme.com", isVerified: true },
    { _id: UNVERIFIED_DOMAIN_ID, domain: "acme.dev", isVerified: false },
  ];

  // What the Domains column of either list reads (Settings/SSO.tsx).
  const DOMAINS_COLUMN_SELECT: JSONObject = {
    _id: true,
    domains: { _id: true, domain: true, isVerified: true },
  };

  beforeEach(() => {
    for (const [service, id, name] of [
      [ProjectSsoService, SSO_ID, "Okta"],
      [ProjectOidcService, OIDC_ID, "Google Workspace"],
    ] as Array<[unknown, string, string]>) {
      useInMemoryTable(service as DatabaseService<BaseModel>, [
        {
          _id: id,
          projectId: PROJECT_ID.toString(),
          name: name,
          isEnabled: true,
          domains: DOMAINS,
        },
      ]);
    }
  });

  test.each([
    ["SAML", ProjectSSO, "/api/project-sso/get-list"],
    ["OIDC", ProjectOIDC, "/api/project-oidc/get-list"],
  ] as Array<[string, { new (): BaseModel }, string]>)(
    "%s providers are read with their domains, verified or not: the notice's read, and the Domains column's, for a settings viewer",
    async (_kind: string, modelType: { new (): BaseModel }, path: string) => {
      caller = callerWith([Permission.SettingsViewer]);

      for (const select of [
        SSO_PROVIDER_DOMAINS_SELECT,
        DOMAINS_COLUMN_SELECT,
      ]) {
        const read: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
          modelType: modelType,
          query: { projectId: PROJECT_ID },
          limit: 10,
          skip: 0,
          select: select as Select<BaseModel>,
          sort: {},
        });

        const domains: Array<Domain> = (
          read.data[0] as unknown as {
            domains: Array<Domain>;
          }
        ).domains;

        expect(
          domains.map((domain: Domain): [string, boolean] => {
            return [String(domain.domain), Boolean(domain.isVerified)];
          }),
        ).toEqual([
          ["acme.com", true],
          ["acme.dev", false],
        ]);
      }

      expect(statusesOf(path)).toEqual([200, 200]);
    },
  );

  test("the reads reach the relation check: with the column off relations, as it was, they are refused whole", async () => {
    const original: (column: string) => TableColumnMetadata =
      Domain.prototype.getTableColumnMetadata;

    jest
      .spyOn(Domain.prototype, "getTableColumnMetadata")
      .mockImplementation(function (
        this: Domain,
        column: string,
      ): TableColumnMetadata {
        const metadata: TableColumnMetadata = original.call(this, column);

        return column === "isVerified"
          ? { ...metadata, canReadOnRelationQuery: false }
          : metadata;
      });

    expect(
      await refusalOfRead(
        ModelAPI.getList<ProjectSSO>({
          modelType: ProjectSSO,
          query: { projectId: PROJECT_ID },
          limit: 10,
          skip: 0,
          select: SSO_PROVIDER_DOMAINS_SELECT as unknown as Select<ProjectSSO>,
          sort: {},
        }),
      ),
    ).toBe(
      "Column isVerified on Domain does not support read on relation query.",
    );
  });
});

describe("a table's Lineage: each edge's pipeline, how its latest run went, and its error from the pipeline", () => {
  // The read ModelTable builds from the Seen In column, as it builds every read.
  const seenInColumns: Columns<DataAssetLineage> = [
    {
      field: LINEAGE_SEEN_IN_FIELD,
      title: "Seen In",
      type: FieldType.Element,
    },
  ];

  const SEEN_IN_SELECT: Select<DataAssetLineage> = {
    ...getSelectFromColumns<DataAssetLineage>({
      columns: seenInColumns,
      model: new DataAssetLineage(),
    }),
    ...getRelationSelectFromColumns<DataAssetLineage>({
      columns: seenInColumns,
      model: new DataAssetLineage(),
    }),
  };

  beforeEach(() => {
    forgetPipelineLastErrors();
    useInMemoryTable(DataAssetLineageService, [
      {
        _id: EDGE_ID,
        projectId: PROJECT_ID.toString(),
        downstreamDataAssetId: TABLE_ID,
        dataPipelineId: PIPELINE_ID,
        dataPipeline: {
          _id: PIPELINE_ID,
          jobName: "orders_daily.load_orders",
          lastRunState: "FAIL",
          lastRunStartedAt: RUN_STARTED_AT,
        },
      },
    ]);
    useInMemoryTable(DataPipelineService, [
      {
        _id: PIPELINE_ID,
        projectId: PROJECT_ID.toString(),
        jobName: "orders_daily.load_orders",
        lastRunState: "FAIL",
        lastRunStartedAt: RUN_STARTED_AT,
        lastErrorMessage: RUN_ERROR,
      },
    ]);
  });

  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a telemetry viewer", [Permission.TelemetryViewer]],
  ] as Array<[string, Array<Permission>]>)(
    "%s reads the Seen In column's edges, and a failed run's error from the pipeline",
    async (_who: string, permissions: Array<Permission>) => {
      caller = callerWith(permissions);

      const read: ListResult<DataAssetLineage> =
        await ModelAPI.getList<DataAssetLineage>({
          modelType: DataAssetLineage,
          query: { downstreamDataAssetId: new ObjectID(TABLE_ID) },
          limit: 10,
          skip: 0,
          select: SEEN_IN_SELECT,
          sort: {},
        });

      expect(statusesOf("/api/data-asset-lineage/get-list")).toEqual([200]);
      expect(read.data[0]?.dataPipeline?.jobName).toBe(
        "orders_daily.load_orders",
      );
      expect(read.data[0]?.dataPipeline?.lastRunState).toBe("FAIL");
      expect(read.data[0]?.dataPipelineId?.toString()).toBe(PIPELINE_ID);

      expect(
        await readPipelineLastError(
          read.data[0]!.dataPipelineId!,
          read.data[0]!.dataPipeline!.lastRunStartedAt,
        ),
      ).toBe(RUN_ERROR);
      expect(statusesOf(`/api/data-pipeline/${PIPELINE_ID}/get-item`)).toEqual([
        200,
      ]);
    },
  );

  test("a run's error, free text, stays off relations: through the edge it is refused whole", async () => {
    expect(
      await refusalOfRead(
        ModelAPI.getList<DataAssetLineage>({
          modelType: DataAssetLineage,
          query: { downstreamDataAssetId: new ObjectID(TABLE_ID) },
          limit: 10,
          skip: 0,
          select: {
            _id: true,
            dataPipeline: { jobName: true, lastErrorMessage: true },
          },
          sort: {},
        }),
      ),
    ).toBe(
      "Column lastErrorMessage on Data Pipeline does not support read on relation query.",
    );
  });

  test("the Seen In column reads nothing of the pipeline that a relation does not", () => {
    const pipeline: DataPipeline = new DataPipeline();
    const relationSelect: JSONObject = (SEEN_IN_SELECT as JSONObject)[
      "dataPipeline"
    ] as JSONObject;

    expect(Object.keys(relationSelect).sort()).toEqual(
      ["jobName", "lastRunStartedAt", "lastRunState"].sort(),
    );

    for (const column of Object.keys(relationSelect)) {
      expect({
        column: column,
        canReadOnRelationQuery: Boolean(
          pipeline.getTableColumnMetadata(column).canReadOnRelationQuery,
        ),
      }).toEqual({ column: column, canReadOnRelationQuery: true });
    }
  });
});
