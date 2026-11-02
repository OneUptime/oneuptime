/** @timezone UTC */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import ChangeEvent from "../../../Models/AnalyticsModels/ChangeEvent";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import KubernetesCostAllocation from "../../../Models/AnalyticsModels/KubernetesCostAllocation";
import Log from "../../../Models/AnalyticsModels/Log";
import Metric from "../../../Models/AnalyticsModels/Metric";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import NetworkFlow from "../../../Models/AnalyticsModels/NetworkFlow";
import Profile from "../../../Models/AnalyticsModels/Profile";
import ProfileSample from "../../../Models/AnalyticsModels/ProfileSample";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import ChangeEventService from "../../../Server/Services/ChangeEventService";
import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import HostService from "../../../Server/Services/HostService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import KubernetesCostAllocationService from "../../../Server/Services/KubernetesCostAllocationService";
import LogService from "../../../Server/Services/LogService";
import MetricService from "../../../Server/Services/MetricService";
import MonitorLogService from "../../../Server/Services/MonitorLogService";
import NetworkFlowService from "../../../Server/Services/NetworkFlowService";
import OTelIngestService from "../../../Server/Services/OpenTelemetryIngestService";
import ProfileSampleService from "../../../Server/Services/ProfileSampleService";
import ProfileService from "../../../Server/Services/ProfileService";
import ProjectService from "../../../Server/Services/ProjectService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import ServiceService from "../../../Server/Services/ServiceService";
import SpanService from "../../../Server/Services/SpanService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TelemetryRetentionConfig from "../../../Types/Telemetry/TelemetryRetentionConfig";
import UserType from "../../../Types/UserType";
import { AnalyticsModelSchema } from "../../../Utils/Schema/AnalyticsModelSchema";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * A telemetry row created through its table's service - what the REST API's
 * create does (BaseAnalyticsAPI.createItem) - gets its retentionDate from the
 * server, as an ingested row does: it may not write the column. Before, it
 * could not create at all on any table with one: left out, retentionDate was
 * "required"; sent, it was refused as "set by the server".
 *
 * ClickHouse is stubbed at the service's `execute`, which receives the
 * INSERT; Postgres at the lookups the retention is read with.
 */

type ModelCtor = new () => AnalyticsBaseModel;
type AnyService = AnalyticsDatabaseService<AnalyticsBaseModel>;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// The service each telemetry table's REST API creates through (App's BaseAPI).
const SERVICES: Array<{ modelType: ModelCtor; service: AnyService }> = [
  { modelType: Log, service: LogService },
  { modelType: Span, service: SpanService },
  { modelType: Metric, service: MetricService },
  { modelType: ExceptionInstance, service: ExceptionInstanceService },
  { modelType: MonitorLog, service: MonitorLogService },
  { modelType: NetworkFlow, service: NetworkFlowService },
  {
    modelType: KubernetesCostAllocation,
    service: KubernetesCostAllocationService,
  },
  { modelType: Profile, service: ProfileService },
  { modelType: ProfileSample, service: ProfileSampleService },
  { modelType: SecurityEvent, service: SecurityEventService },
  { modelType: ChangeEvent, service: ChangeEventService },
] as unknown as Array<{ modelType: ModelCtor; service: AnyService }>;

// The tables the REST API creates rows in.
const CREATABLE_MODELS: Array<ModelCtor> = (
  AnalyticsModels as Array<ModelCtor>
).filter((modelType: ModelCtor): boolean => {
  const model: AnalyticsBaseModel = new modelType();

  return Boolean(model.crudApiPath) && model.getCreatePermissions().length > 0;
});

const serviceOf: (modelType: ModelCtor) => AnyService = (
  modelType: ModelCtor,
): AnyService => {
  return SERVICES.find(
    (entry: { modelType: ModelCtor; service: AnyService }): boolean => {
      return entry.modelType === modelType;
    },
  )!.service;
};

// The project's own retention, and the one it keeps traces for.
const PROJECT_RETENTION_DAYS: number = 15;
const PROJECT_TRACES_RETENTION_DAYS: number = 17;

const SERVICE_RETENTION_DAYS: number = 20;
const SERVICE_RETENTION_CONFIG: TelemetryRetentionConfig = {
  logs: { default: 31, bySeverity: { [LogSeverity.Error]: 41 } },
  traces: { default: 32, byStatus: { [SpanStatus.Error]: 42 } },
  metrics: { default: 33 },
  profiles: { default: 34 },
  securityEvents: { default: 35 },
};

const HOST_RETENTION_DAYS: number = 50;
const HOST_LOGS_RETENTION_DAYS: number = 51;
const CLUSTER_RETENTION_DAYS: number = 25;
const MONITOR_LOG_RETENTION_DAYS: number = 3;
const PROJECT_WIDE_CHANGE_EVENT_RETENTION_DAYS: number = 365;

const SERVICE_ID: ObjectID = ObjectID.generate();
const HOST_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();

/*
 * A fresh project for every test, so that its retention, which ingest keeps
 * in memory for minutes, is read again; and the projects the service, the
 * host and the cluster are in.
 */
let projectId: ObjectID;
let serviceProjectId: ObjectID;
let hostProjectId: ObjectID;
let clusterProjectId: ObjectID;

// What each create sent to ClickHouse.
const statements: Array<string> = [];

const ownerOf: (project: ObjectID) => DatabaseCommonInteractionProps = (
  project: ObjectID,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: project,
    userTenantAccessPermission: {
      [project.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: project,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
};

// A table's create example, as the OpenAPI spec publishes it.
const createExampleOf: (modelType: ModelCtor) => JSONObject = (
  modelType: ModelCtor,
): JSONObject => {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register(
    "Create",
    AnalyticsModelSchema.getCreateModelSchema({ modelType }),
  );

  const schemas: JSONObject = (new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents().components?.schemas || {}) as JSONObject;

  return (schemas["Create"] as JSONObject)["example"] as JSONObject;
};

interface Created {
  item: AnalyticsBaseModel;
  insert: string;
}

// A row created through its table's service, as the REST API creates it.
const create: (data: {
  modelType: ModelCtor;
  row: JSONObject;
  props?: DatabaseCommonInteractionProps | undefined;
}) => Promise<Created> = async (data: {
  modelType: ModelCtor;
  row: JSONObject;
  props?: DatabaseCommonInteractionProps | undefined;
}): Promise<Created> => {
  const item: AnalyticsBaseModel = AnalyticsBaseModel.fromJSON(
    data.row,
    data.modelType,
  ) as AnalyticsBaseModel;

  statements.length = 0;

  await serviceOf(data.modelType).create({
    data: item,
    props: data.props || ownerOf(projectId),
  });

  expect(statements).toHaveLength(1);

  return { item: item, insert: statements[0]! };
};

// A row of the service, from the table's own create example.
const rowOfService: (modelType: ModelCtor, row?: JSONObject) => JSONObject = (
  modelType: ModelCtor,
  row?: JSONObject,
): JSONObject => {
  return {
    ...createExampleOf(modelType),
    primaryEntityId: SERVICE_ID.toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    ...(row || {}),
  };
};

/*
 * The row's retentionDate is `days` after `from` (its createdAt, or a cost
 * allocation's windowStart), and the INSERT writes it.
 */
const expectRetention: (
  created: Created,
  days: number,
  from?: "createdAt" | "windowStart",
) => void = (
  created: Created,
  days: number,
  from?: "createdAt" | "windowStart",
): void => {
  const base: Date = created.item.getColumnValue<Date>(from || "createdAt")!;
  const retentionDate: Date =
    created.item.getColumnValue<Date>("retentionDate")!;

  expect(retentionDate).toBeInstanceOf(Date);
  expect((retentionDate.getTime() - base.getTime()) / DAY_IN_MS).toBe(days);
  expect(created.insert).toContain(
    `parseDateTimeBestEffortOrNull('${retentionDate.toISOString()}')`,
  );
};

beforeEach(() => {
  projectId = ObjectID.generate();
  serviceProjectId = projectId;
  hostProjectId = projectId;
  clusterProjectId = projectId;

  for (const { service } of SERVICES) {
    jest
      .spyOn(service, "execute")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((async (statement: any): Promise<any> => {
        statements.push(String(statement));
        return {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
  }

  // The project's retention is read from Postgres, with no cache to answer.
  jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    defaultTelemetryRetentionInDays: PROJECT_RETENTION_DAYS,
    telemetryRetentionConfig: {
      traces: { default: PROJECT_TRACES_RETENTION_DAYS },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // The rows Postgres holds: a service, a host and a cluster, each in one project.
  jest
    .spyOn(ServiceService, "findOneBy")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation((async (findBy: any): Promise<any> => {
      const query: JSONObject = findBy.query as JSONObject;

      // As Postgres answers: a query that names no project finds it in any.
      if (
        query["_id"] === SERVICE_ID.toString() &&
        (query["projectId"] === undefined ||
          String(query["projectId"]) === serviceProjectId.toString())
      ) {
        return {
          retainTelemetryDataForDays: SERVICE_RETENTION_DAYS,
          telemetryRetentionConfig: SERVICE_RETENTION_CONFIG,
        };
      }

      return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

  jest
    .spyOn(HostService, "findOneById")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation((async (findBy: any): Promise<any> => {
      if (findBy.id.toString() !== HOST_ID.toString()) {
        return null;
      }

      return {
        retainTelemetryDataForDays: HOST_RETENTION_DAYS,
        telemetryRetentionConfig: {
          logs: { default: HOST_LOGS_RETENTION_DAYS },
        },
        projectId: hostProjectId,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

  jest
    .spyOn(KubernetesClusterService, "findOneById")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation((async (findBy: any): Promise<any> => {
      if (findBy.id.toString() !== CLUSTER_ID.toString()) {
        return null;
      }

      return {
        retainTelemetryDataForDays: CLUSTER_RETENTION_DAYS,
        telemetryRetentionConfig: null,
        projectId: clusterProjectId,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

  // The installation's monitor log retention (MonitorLogUtil).
  jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue({
    monitorLogRetentionInDays: MONITOR_LOG_RETENTION_DAYS,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("covers every table the REST API creates rows in", () => {
  expect(
    CREATABLE_MODELS.map((modelType: ModelCtor): string => {
      return modelType.name;
    }).sort(),
  ).toEqual(
    SERVICES.map(
      (entry: { modelType: ModelCtor; service: AnyService }): string => {
        return entry.modelType.name;
      },
    ).sort(),
  );

  // Every one but network flows, which has no retentionDate.
  expect(
    CREATABLE_MODELS.filter((modelType: ModelCtor): boolean => {
      return Boolean(new modelType().getTableColumn("retentionDate"));
    }),
  ).toHaveLength(SERVICES.length - 1);
});

/*
 * Retention overrides - by telemetry type, per service or resource - are an
 * Enterprise feature; ingest applies them only while it is active.
 */
describe("with retention overrides (Enterprise Edition)", () => {
  beforeAll(() => {
    installFakeEnterpriseModule();
  });

  afterAll(() => {
    uninstallEnterpriseModule();
  });

  test.each([
    {
      name: "a log, by its severity",
      modelType: Log,
      row: { severityText: LogSeverity.Error },
      days: 41,
    },
    {
      name: "a log of a severity with no retention of its own",
      modelType: Log,
      row: { severityText: LogSeverity.Information },
      days: 31,
    },
    {
      name: "a span, by its status",
      modelType: Span,
      row: { statusCode: SpanStatus.Error },
      days: 42,
    },
    {
      name: "a span of a status with no retention of its own",
      modelType: Span,
      row: { statusCode: SpanStatus.Ok },
      days: 32,
    },
    {
      name: "an exception, by its span's status",
      modelType: ExceptionInstance,
      row: { spanStatusCode: SpanStatus.Error },
      days: 42,
    },
    { name: "a metric", modelType: Metric, row: {}, days: 33 },
    { name: "a profile", modelType: Profile, row: {}, days: 34 },
    { name: "a profile sample", modelType: ProfileSample, row: {}, days: 34 },
    { name: "a security event", modelType: SecurityEvent, row: {}, days: 35 },
    {
      name: "a change event of a service, by its metrics retention",
      modelType: ChangeEvent,
      row: {},
      days: 33,
    },
  ])(
    "$name gets its service's retention, from when it is written",
    async (data: {
      modelType: ModelCtor;
      row: JSONObject;
      days: number;
    }): Promise<void> => {
      const created: Created = await create({
        modelType: data.modelType,
        row: rowOfService(data.modelType, data.row),
      });

      expectRetention(created, data.days);

      // The service is looked up in the row's own project.
      expect(ServiceService.findOneBy).toHaveBeenCalledWith({
        query: { _id: SERVICE_ID.toString(), projectId: projectId },
        select: {
          retainTelemetryDataForDays: true,
          telemetryRetentionConfig: true,
        },
        props: { isRoot: true },
      });
    },
  );

  test("a row sent with a time long past is kept for its retention, not stamped expired", async () => {
    const created: Created = await create({
      modelType: Log,
      row: rowOfService(Log, {
        time: "2025-01-01T00:00:00.000Z",
        severityText: LogSeverity.Error,
      }),
    });

    expectRetention(created, 41);
    expect(
      created.item.getColumnValue<Date>("retentionDate")!.getTime(),
    ).toBeGreaterThan(Date.now());
  });

  test("a row that names no type is a service's", async () => {
    const row: JSONObject = rowOfService(Metric);
    delete row["primaryEntityType"];

    expectRetention(await create({ modelType: Metric, row: row }), 33);
  });

  test("a row of a resource that has no retention of its own gets the project's, for its kind of telemetry", async () => {
    const elsewhere: JSONObject = {
      primaryEntityId: ObjectID.generate().toString(),
    };

    expectRetention(
      await create({ modelType: Log, row: rowOfService(Log, elsewhere) }),
      PROJECT_RETENTION_DAYS,
    );
    expectRetention(
      await create({ modelType: Span, row: rowOfService(Span, elsewhere) }),
      PROJECT_TRACES_RETENTION_DAYS,
    );
  });

  test("a row of a host gets the host's retention", async () => {
    const created: Created = await create({
      modelType: Log,
      row: rowOfService(Log, {
        primaryEntityId: HOST_ID.toString(),
        primaryEntityType: ServiceType.Host,
      }),
    });

    expectRetention(created, HOST_LOGS_RETENTION_DAYS);
    expect(ServiceService.findOneBy).not.toHaveBeenCalled();
  });

  /*
   * The caller names the resource. One of another project gives no
   * retention: the row gets its own project's, never another's.
   */
  test("a row naming a service of another project gets its own project's retention", async () => {
    serviceProjectId = ObjectID.generate();

    expectRetention(
      await create({ modelType: Metric, row: rowOfService(Metric) }),
      PROJECT_RETENTION_DAYS,
    );
  });

  test("a row naming a host of another project gets its own project's retention", async () => {
    hostProjectId = ObjectID.generate();

    expectRetention(
      await create({
        modelType: Log,
        row: rowOfService(Log, {
          primaryEntityId: HOST_ID.toString(),
          primaryEntityType: ServiceType.Host,
        }),
      }),
      PROJECT_RETENTION_DAYS,
    );
  });

  test("a row naming an id that is not one is not looked up, and gets the project's retention", async () => {
    expectRetention(
      await create({
        modelType: Log,
        row: rowOfService(Log, { primaryEntityId: "not-an-id" }),
      }),
      PROJECT_RETENTION_DAYS,
    );
    expect(ServiceService.findOneBy).not.toHaveBeenCalled();
  });

  /*
   * Ingest's memo of resource retention is not filled by ids a request
   * names: each create reads its resource.
   */
  test("a created row's resource is read for it, not from ingest's memo", async () => {
    const row: JSONObject = rowOfService(Log, {
      primaryEntityId: HOST_ID.toString(),
      primaryEntityType: ServiceType.Host,
    });

    await create({ modelType: Log, row: row });
    await create({ modelType: Log, row: row });

    expect(HostService.findOneById).toHaveBeenCalledTimes(2);

    await OTelIngestService.buildResourceMetadataForNonService({
      serviceName: "host",
      resourceId: HOST_ID,
      primaryEntityType: ServiceType.Host,
      projectId: projectId,
    });

    expect(HostService.findOneById).toHaveBeenCalledTimes(3);
  });

  test("a change event of no resource is kept a year, as ingest keeps a project-wide marker", async () => {
    const created: Created = await create({
      modelType: ChangeEvent,
      row: createExampleOf(ChangeEvent),
    });

    expect(created.item.getColumnValue("primaryEntityId")).toBeUndefined();
    expectRetention(created, PROJECT_WIDE_CHANGE_EVENT_RETENTION_DAYS);
    expect(ServiceService.findOneBy).not.toHaveBeenCalled();
  });

  test("a cost allocation gets its cluster's retention, from the start of its window", async () => {
    const created: Created = await create({
      modelType: KubernetesCostAllocation,
      row: {
        ...createExampleOf(KubernetesCostAllocation),
        kubernetesClusterId: CLUSTER_ID.toString(),
      },
    });

    expectRetention(created, CLUSTER_RETENTION_DAYS, "windowStart");
  });

  test("a cost allocation of a cluster of another project gets its own project's retention", async () => {
    clusterProjectId = ObjectID.generate();

    const created: Created = await create({
      modelType: KubernetesCostAllocation,
      row: {
        ...createExampleOf(KubernetesCostAllocation),
        kubernetesClusterId: CLUSTER_ID.toString(),
      },
    });

    expectRetention(created, PROJECT_RETENTION_DAYS, "windowStart");
  });

  test("a monitor log gets the installation's monitor log retention", async () => {
    expectRetention(
      await create({
        modelType: MonitorLog,
        row: createExampleOf(MonitorLog),
      }),
      MONITOR_LOG_RETENTION_DAYS,
    );
  });

  test("a retentionDate a caller sends is still refused: it is the server's to write", async () => {
    statements.length = 0;

    await expect(
      LogService.create({
        data: AnalyticsBaseModel.fromJSON(
          {
            ...rowOfService(Log),
            retentionDate: "2026-07-01T00:00:00.000Z",
          },
          Log,
        ) as Log,
        props: ownerOf(projectId),
      }),
    ).rejects.toThrow(ColumnWriteRefusedException);

    expect(statements).toHaveLength(0);
  });

  test("a retentionDate OneUptime itself writes is kept", async () => {
    const created: Created = await create({
      modelType: Log,
      row: { ...rowOfService(Log), retentionDate: "2026-07-01T00:00:00.000Z" },
      props: { isRoot: true, tenantId: projectId },
    });

    expect(created.item.getColumnValue<Date>("retentionDate")).toEqual(
      new Date("2026-07-01T00:00:00.000Z"),
    );
    expect(ServiceService.findOneBy).not.toHaveBeenCalled();
  });

  test("a row OneUptime itself creates without one gets its retention too", async () => {
    expectRetention(
      await create({
        modelType: Metric,
        row: rowOfService(Metric),
        props: { isRoot: true, tenantId: projectId },
      }),
      33,
    );
  });

  test("a create whose resource cannot be read fails, rather than guessing its retention", async () => {
    jest
      .spyOn(ServiceService, "findOneBy")
      .mockRejectedValue(new Error("Postgres is down"));

    statements.length = 0;

    await expect(
      LogService.create({
        data: AnalyticsBaseModel.fromJSON(rowOfService(Log), Log) as Log,
        props: ownerOf(projectId),
      }),
    ).rejects.toThrow("Postgres is down");

    expect(statements).toHaveLength(0);
  });

  /*
   * What the OpenAPI spec publishes as each create's example: its IDs name
   * no resource of the project, so each row gets the project's retention for
   * its kind of telemetry.
   */
  test("every published create example goes through its table's service", async () => {
    const days: Map<ModelCtor, number> = new Map<ModelCtor, number>([
      [Log, PROJECT_RETENTION_DAYS],
      [Span, PROJECT_TRACES_RETENTION_DAYS],
      [Metric, PROJECT_RETENTION_DAYS],
      [ExceptionInstance, PROJECT_TRACES_RETENTION_DAYS],
      [MonitorLog, MONITOR_LOG_RETENTION_DAYS],
      [KubernetesCostAllocation, PROJECT_RETENTION_DAYS],
      [Profile, PROJECT_RETENTION_DAYS],
      [ProfileSample, PROJECT_RETENTION_DAYS],
      [SecurityEvent, PROJECT_RETENTION_DAYS],
      [ChangeEvent, PROJECT_WIDE_CHANGE_EVENT_RETENTION_DAYS],
    ]);

    for (const modelType of CREATABLE_MODELS) {
      const created: Created = await create({
        modelType: modelType,
        row: createExampleOf(modelType),
      });

      expect(created.insert).toContain(
        `INSERT INTO oneuptime.${new modelType().tableName}`,
      );

      if (modelType === NetworkFlow) {
        expect(new modelType().getTableColumn("retentionDate")).toBeNull();
        continue;
      }

      expectRetention(
        created,
        days.get(modelType)!,
        modelType === KubernetesCostAllocation ? "windowStart" : "createdAt",
      );
    }
  });
});

describe("without retention overrides (Community Edition)", () => {
  beforeAll(() => {
    uninstallEnterpriseModule();
  });

  test("a row of a service gets the project's retention, as ingest gives it", async () => {
    expectRetention(
      await create({
        modelType: Span,
        row: rowOfService(Span, { statusCode: SpanStatus.Error }),
      }),
      PROJECT_RETENTION_DAYS,
    );
  });

  test("a cost allocation gets the project's retention, from the start of its window", async () => {
    expectRetention(
      await create({
        modelType: KubernetesCostAllocation,
        row: {
          ...createExampleOf(KubernetesCostAllocation),
          kubernetesClusterId: CLUSTER_ID.toString(),
        },
      }),
      PROJECT_RETENTION_DAYS,
      "windowStart",
    );
  });
});
