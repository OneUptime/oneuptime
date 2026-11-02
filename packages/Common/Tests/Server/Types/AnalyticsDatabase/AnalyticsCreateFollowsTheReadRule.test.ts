import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import KubernetesCostAllocation from "../../../../Models/AnalyticsModels/KubernetesCostAllocation";
import Log from "../../../../Models/AnalyticsModels/Log";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import MonitorLog from "../../../../Models/AnalyticsModels/MonitorLog";
import NetworkFlow from "../../../../Models/AnalyticsModels/NetworkFlow";
import Profile from "../../../../Models/AnalyticsModels/Profile";
import ProfileSample from "../../../../Models/AnalyticsModels/ProfileSample";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Span from "../../../../Models/AnalyticsModels/Span";
import Service from "../../../../Models/DatabaseModels/Service";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AnalyticsDatabaseService from "../../../../Server/Services/AnalyticsDatabaseService";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import KubernetesCostAllocationService from "../../../../Server/Services/KubernetesCostAllocationService";
import LogService from "../../../../Server/Services/LogService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorLogService from "../../../../Server/Services/MonitorLogService";
import NetworkFlowService from "../../../../Server/Services/NetworkFlowService";
import ProfileSampleService from "../../../../Server/Services/ProfileSampleService";
import ProfileService from "../../../../Server/Services/ProfileService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import ServiceService from "../../../../Server/Services/ServiceService";
import SpanService from "../../../../Server/Services/SpanService";
import AnalyticsModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import CreateScopeException from "../../../../Server/Types/Database/Permissions/CreateScopeException";
import OwnerTableRegistry from "../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import LlmConversationPrivacy from "../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import AnalyticsTableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OwnedThrough, {
  OwnedThroughMetadata,
} from "../../../../Types/Database/AccessControl/OwnedThrough";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import UserType from "../../../../Types/UserType";
import { AnalyticsModelSchema } from "../../../../Utils/Schema/AnalyticsModelSchema";

// Most creates below are refused on purpose; @CaptureSpan logs each one's stack.
jest.mock("../../../../Server/Utils/Logger");

/*
 * A CREATE OF TELEMETRY KEEPS TO WHAT ITS CALLER MAY READ, as an update and
 * a delete do (AnalyticsWritesFollowTheReadRule) and as a database model is
 * created only under a parent its creator may read: every row names, in its
 * @OwnedThrough column, a resource both the caller's grants to create the
 * table's rows and to read them reach - their labels and owners, less what a
 * block with labels takes away. A row outside is refused before anything is
 * written (ModelPermission.checkCreateScope).
 *
 * Every table the REST API creates rows in is created through its own
 * service, as BaseAnalyticsAPI.createItem does. ClickHouse is stubbed at the
 * service's `execute`, which receives the INSERT; Postgres at the lookups:
 * the resources a label or an owner reaches (the owner table registry's
 * services), and the retention a row is given (TelemetryCreateRetention).
 */

type ModelCtor = new () => AnalyticsBaseModel;
type AnyService = AnalyticsDatabaseService<AnalyticsBaseModel>;

interface Table {
  modelType: ModelCtor;
  service: AnyService;
  // The kind of resource its rows belong to, as the owner table registry names it.
  kind: string;
  // The narrowest permissions to create, and to read, its rows.
  create: Permission;
  read: Permission;
}

const TABLES: Array<Table> = [
  {
    modelType: Log,
    service: LogService,
    kind: "Service",
    create: Permission.CreateTelemetryServiceLog,
    read: Permission.ReadTelemetryServiceLog,
  },
  {
    modelType: Span,
    service: SpanService,
    kind: "Service",
    create: Permission.CreateTelemetryServiceTraces,
    read: Permission.ReadTelemetryServiceTraces,
  },
  {
    modelType: Metric,
    service: MetricService,
    kind: "Service",
    create: Permission.CreateTelemetryServiceMetrics,
    read: Permission.ReadTelemetryServiceMetrics,
  },
  {
    modelType: ExceptionInstance,
    service: ExceptionInstanceService,
    kind: "Service",
    create: Permission.CreateTelemetryException,
    read: Permission.ReadTelemetryException,
  },
  {
    modelType: MonitorLog,
    service: MonitorLogService,
    kind: "Monitor",
    create: Permission.CreateProjectMonitor,
    read: Permission.ReadProjectMonitor,
  },
  {
    modelType: NetworkFlow,
    service: NetworkFlowService,
    kind: "NetworkDevice",
    create: Permission.CreateNetworkDevice,
    read: Permission.ReadNetworkDevice,
  },
  {
    modelType: KubernetesCostAllocation,
    service: KubernetesCostAllocationService,
    kind: "KubernetesCluster",
    create: Permission.CreateKubernetesCluster,
    read: Permission.ReadKubernetesCluster,
  },
  {
    modelType: Profile,
    service: ProfileService,
    kind: "Service",
    create: Permission.CreateTelemetryServiceProfiles,
    read: Permission.ReadTelemetryServiceProfiles,
  },
  {
    modelType: ProfileSample,
    service: ProfileSampleService,
    kind: "Service",
    create: Permission.CreateTelemetryServiceProfiles,
    read: Permission.ReadTelemetryServiceProfiles,
  },
  {
    modelType: SecurityEvent,
    service: SecurityEventService,
    kind: "Service",
    create: Permission.CreateSecurityEvent,
    read: Permission.ReadSecurityEvent,
  },
  // Change events are created and read under the telemetry roles alone.
  {
    modelType: ChangeEvent,
    service: ChangeEventService,
    kind: "Service",
    create: Permission.TelemetryMember,
    read: Permission.TelemetryViewer,
  },
] as unknown as Array<Table>;

const tableOf: (modelType: ModelCtor) => Table = (
  modelType: ModelCtor,
): Table => {
  return TABLES.find((table: Table): boolean => {
    return table.modelType === modelType;
  })!;
};

const nameOf: (table: Table) => string = (table: Table): string => {
  return table.modelType.name;
};

const ownedThroughOf: (modelType: ModelCtor) => OwnedThroughMetadata = (
  modelType: ModelCtor,
): OwnedThroughMetadata => {
  return (new modelType() as unknown as { ownedThrough: OwnedThroughMetadata })
    .ownedThrough;
};

const LABEL_ID: ObjectID = ObjectID.generate();
const BLOCKED_LABEL_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

// The resources of one kind Postgres holds.
interface Resources {
  // Carries the label the grants below are limited to.
  labelled: ObjectID;
  // Carries no label, and the member does not own it.
  other: ObjectID;
  // The member owns it; it carries no label.
  owned: ObjectID;
  // Carries the label a block takes away.
  blocked: ObjectID;
}

const RESOURCES: Map<string, Resources> = new Map<string, Resources>(
  ["Service", "Monitor", "KubernetesCluster", "NetworkDevice"].map(
    (kind: string): [string, Resources] => {
      return [
        kind,
        {
          labelled: ObjectID.generate(),
          other: ObjectID.generate(),
          owned: ObjectID.generate(),
          blocked: ObjectID.generate(),
        },
      ];
    },
  ),
);

const resourcesOf: (table: Table) => Resources = (table: Table): Resources => {
  return RESOURCES.get(table.kind)!;
};

interface LookupRequest {
  query: Record<string, unknown>;
}

// A fresh project for every test.
let projectId: ObjectID;

// What each create sent to ClickHouse.
const statements: Array<string> = [];

// The scope's lookups: every owner table's and resource table's findBy.
let lookups: Array<unknown> = [];

const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<ObjectID>;
    isBlockPermission?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  data: {
    scope?: PermissionScope;
    labelIds?: Array<ObjectID>;
    isBlockPermission?: boolean;
  } = {},
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    scope: data.scope,
    labelIds: data.labelIds || [],
    isBlockPermission: data.isBlockPermission || false,
  };
};

const everywhere: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { scope: PermissionScope.All });
};

const labelled: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_ID],
  });
};

const owned: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { scope: PermissionScope.Owned });
};

const blockedOn: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, {
    labelIds: [BLOCKED_LABEL_ID],
    isBlockPermission: true,
  });
};

const member: (
  permissions: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions,
      },
    },
  } as DatabaseCommonInteractionProps;
};

const projectOwner: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return member([row(Permission.ProjectOwner)]);
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

/*
 * A row of the table's create example that belongs to `ownerId` (null: to
 * no resource at all), in the table's @OwnedThrough column.
 */
const rowOf: (table: Table, ownerId: ObjectID | string | null) => JSONObject = (
  table: Table,
  ownerId: ObjectID | string | null,
): JSONObject => {
  const ownerColumn: string = ownedThroughOf(table.modelType).fkColumn;
  const data: JSONObject = { ...createExampleOf(table.modelType) };

  delete data[ownerColumn];

  if (ownerId !== null) {
    data[ownerColumn] = ownerId.toString();
  }

  if (new table.modelType().getTableColumn("primaryEntityType")) {
    data["primaryEntityType"] = ServiceType.OpenTelemetry;
  }

  return data;
};

// Creates rows through the table's service, as the REST API creates one.
const create: (
  table: Table,
  rows: Array<JSONObject>,
  props: DatabaseCommonInteractionProps,
) => Promise<void> = async (
  table: Table,
  rows: Array<JSONObject>,
  props: DatabaseCommonInteractionProps,
): Promise<void> => {
  statements.length = 0;

  await table.service.createMany({
    items: rows.map((data: JSONObject): AnalyticsBaseModel => {
      return AnalyticsBaseModel.fromJSON(
        data,
        table.modelType,
      ) as AnalyticsBaseModel;
    }),
    props: props,
  });
};

const expectCreated: (
  table: Table,
  ownerId: ObjectID | string | null,
  props: DatabaseCommonInteractionProps,
) => Promise<void> = async (
  table: Table,
  ownerId: ObjectID | string | null,
  props: DatabaseCommonInteractionProps,
): Promise<void> => {
  await create(table, [rowOf(table, ownerId)], props);

  expect(statements).toHaveLength(1);
  expect(statements[0]).toContain(
    `INSERT INTO oneuptime.${new table.modelType().tableName}`,
  );
};

// Refused as a row outside the caller's reach, with nothing written.
const expectRefused: (
  table: Table,
  ownerId: ObjectID | string | null,
  props: DatabaseCommonInteractionProps,
) => Promise<string> = async (
  table: Table,
  ownerId: ObjectID | string | null,
  props: DatabaseCommonInteractionProps,
): Promise<string> => {
  let refusal: unknown = null;

  try {
    await create(table, [rowOf(table, ownerId)], props);
  } catch (error) {
    refusal = error;
  }

  expect(refusal).toBeInstanceOf(CreateScopeException);
  expect(refusal).toBeInstanceOf(NotAuthorizedException);
  expect(statements).toHaveLength(0);

  return (refusal as Error).message;
};

beforeEach(() => {
  projectId = ObjectID.generate();
  statements.length = 0;
  lookups = [];

  for (const { service } of TABLES) {
    jest
      .spyOn(service, "execute")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((async (statement: any): Promise<any> => {
        statements.push(String(statement));
        return {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
  }

  // The retention a created row is given: its project's (TelemetryCreateRetention).
  jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    defaultTelemetryRetentionInDays: 15,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(null);
  jest.spyOn(HostService, "findOneById").mockResolvedValue(null);
  jest.spyOn(KubernetesClusterService, "findOneById").mockResolvedValue(null);
  jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue({
    monitorLogRetentionInDays: 3,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // The resources a label or an owner reaches, by kind.
  for (const [kind, entry] of OwnerTableRegistry.entries()) {
    if (!entry.canOwnTelemetry) {
      continue;
    }

    const resources: Resources | undefined = RESOURCES.get(kind);

    lookups.push(
      jest.spyOn(entry.ownerUserService, "findBy").mockImplementation((async (
        request: LookupRequest,
      ) => {
        if (
          !resources ||
          String(request.query["userId"]) !== USER_ID.toString()
        ) {
          return [];
        }

        return [{ [entry.fkColumn]: resources.owned.toString() }];
      }) as never),
    );

    lookups.push(
      jest
        .spyOn(entry.ownerTeamService, "findBy")
        .mockResolvedValue([] as never),
    );

    if (!entry.modelService) {
      continue;
    }

    lookups.push(
      jest.spyOn(entry.modelService, "findBy").mockImplementation((async (
        request: LookupRequest,
      ) => {
        const labelIds: Array<string> = (
          (request.query["labels"] as Array<ObjectID>) || []
        ).map((labelId: ObjectID): string => {
          return labelId.toString();
        });

        if (!resources) {
          return [];
        }

        return [
          ...(labelIds.includes(LABEL_ID.toString())
            ? [{ _id: resources.labelled.toString() }]
            : []),
          ...(labelIds.includes(BLOCKED_LABEL_ID.toString())
            ? [{ _id: resources.blocked.toString() }]
            : []),
        ];
      }) as never),
    );
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

const expectNothingLookedUp: () => void = (): void => {
  for (const lookup of lookups) {
    expect(lookup).not.toHaveBeenCalled();
  }
};

test("covers every table the REST API creates rows in, each read through the resource its rows belong to", () => {
  const creatable: Array<string> = (AnalyticsModels as Array<ModelCtor>)
    .filter((modelType: ModelCtor): boolean => {
      const model: AnalyticsBaseModel = new modelType();

      return (
        Boolean(model.crudApiPath) && model.getCreatePermissions().length > 0
      );
    })
    .map((modelType: ModelCtor): string => {
      return modelType.name;
    })
    .sort();

  expect(TABLES.map(nameOf).sort()).toEqual(creatable);

  for (const table of TABLES) {
    const model: AnalyticsBaseModel = new table.modelType();

    expect(model.getCreatePermissions()).toContain(table.create);
    expect(model.getReadPermissions()).toContain(table.read);
    expect(ownedThroughOf(table.modelType)).toBeDefined();
  }
});

describe.each(TABLES)("$modelType.name", (table: Table) => {
  test("a member limited to a label creates rows for a resource carrying it, and not for one that does not", async () => {
    const props: DatabaseCommonInteractionProps = member([
      labelled(table.create),
      labelled(table.read),
    ]);

    await expectCreated(table, resourcesOf(table).labelled, props);

    const message: string = await expectRefused(
      table,
      resourcesOf(table).other,
      props,
    );

    const ownerTitle: string = new table.modelType().getTableColumn(
      ownedThroughOf(table.modelType).fkColumn,
    )!.title;

    expect(message).toBe(
      `Your access lets you create ${new table.modelType().pluralName} only for the resources whose ${new table.modelType().pluralName} you may both create and read, and not for ${ownerTitle} "${resourcesOf(table).other.toString()}".`,
    );

    // Owning a resource is not one of the label's.
    await expectRefused(table, resourcesOf(table).owned, props);
  });

  test("a member limited to what they own creates rows for a resource they own, and not for another", async () => {
    const props: DatabaseCommonInteractionProps = member([
      owned(table.create),
      owned(table.read),
    ]);

    await expectCreated(table, resourcesOf(table).owned, props);
    await expectRefused(table, resourcesOf(table).other, props);
    await expectRefused(table, resourcesOf(table).labelled, props);
  });

  test("a member whose grants reach the whole project creates rows for any resource, and nothing is looked up", async () => {
    const props: DatabaseCommonInteractionProps = member([
      everywhere(table.create),
      everywhere(table.read),
    ]);

    await expectCreated(table, resourcesOf(table).other, props);
    await expectCreated(table, resourcesOf(table).labelled, props);
    await expectCreated(table, ObjectID.generate(), props);

    expectNothingLookedUp();
  });

  test("the project's owner and OneUptime itself create rows for any resource", async () => {
    await expectCreated(table, resourcesOf(table).other, projectOwner());
    await expectCreated(table, resourcesOf(table).other, {
      isRoot: true,
      tenantId: projectId,
    });

    expectNothingLookedUp();
  });

  test("a block with labels on reading takes its resources away from a create over the whole project", async () => {
    const props: DatabaseCommonInteractionProps = member([
      everywhere(table.create),
      everywhere(table.read),
      blockedOn(table.read),
    ]);

    await expectRefused(table, resourcesOf(table).blocked, props);
    await expectCreated(table, resourcesOf(table).other, props);
  });

  /*
   * Telemetry of no resource is kept under the project's id
   * (includeProjectScope): an Owned grant reads that bucket, a grant limited
   * to labels does not - and creates the same.
   */
  test("a row of the project's own bucket is created as it is read", async () => {
    const includesProjectScope: boolean = ownedThroughOf(
      table.modelType,
    ).includeProjectScope;

    if (includesProjectScope) {
      await expectCreated(
        table,
        projectId,
        member([owned(table.create), owned(table.read)]),
      );
    } else {
      await expectRefused(
        table,
        projectId,
        member([owned(table.create), owned(table.read)]),
      );
    }

    await expectRefused(
      table,
      projectId,
      member([labelled(table.create), labelled(table.read)]),
    );
    await expectCreated(
      table,
      projectId,
      member([everywhere(table.create), everywhere(table.read)]),
    );
  });
});

/*
 * Every table but change events has a grant that creates its rows without
 * reading them; a change event is created under a telemetry role that reads
 * them as well.
 */
describe("a member who may create rows but read none of them creates none", () => {
  const CREATE_ONLY: Array<Table> = TABLES.filter((table: Table): boolean => {
    return !new table.modelType().getReadPermissions().includes(table.create);
  });

  test("every table but change events has such a grant", () => {
    expect(CREATE_ONLY.map(nameOf).sort()).toEqual(
      TABLES.map(nameOf)
        .filter((name: string): boolean => {
          return name !== ChangeEvent.name;
        })
        .sort(),
    );
  });

  test.each(CREATE_ONLY)("$modelType.name", async (table: Table) => {
    await expect(
      create(
        table,
        [rowOf(table, resourcesOf(table).other)],
        member([everywhere(table.create)]),
      ),
    ).rejects.toThrow(
      `You do not have permissions to create ${new table.modelType().singularName}: creating a record needs permission to read it too.`,
    );

    expect(statements).toHaveLength(0);
    expectNothingLookedUp();
  });
});

describe("whose grants are weighed", () => {
  const LOGS: Table = tableOf(Log);

  test("a create over the whole project keeps to a read limited to a label", async () => {
    const props: DatabaseCommonInteractionProps = member([
      everywhere(Permission.CreateTelemetryServiceLog),
      labelled(Permission.ReadTelemetryServiceLog),
    ]);

    await expectCreated(LOGS, resourcesOf(LOGS).labelled, props);
    await expectRefused(LOGS, resourcesOf(LOGS).other, props);
  });

  test("a create limited to a label keeps to it under a read over the whole project", async () => {
    const props: DatabaseCommonInteractionProps = member([
      labelled(Permission.CreateTelemetryServiceLog),
      everywhere(Permission.ReadTelemetryServiceLog),
    ]);

    await expectCreated(LOGS, resourcesOf(LOGS).labelled, props);
    await expectRefused(LOGS, resourcesOf(LOGS).other, props);
  });

  test("a create limited to what the member owns does not reach a resource only the read's label reaches", async () => {
    const props: DatabaseCommonInteractionProps = member([
      owned(Permission.CreateTelemetryServiceLog),
      labelled(Permission.ReadTelemetryServiceLog),
    ]);

    await expectRefused(LOGS, resourcesOf(LOGS).labelled, props);
    await expectRefused(LOGS, resourcesOf(LOGS).owned, props);
  });

  test("a block with labels on creating takes its resources away", async () => {
    const props: DatabaseCommonInteractionProps = member([
      everywhere(Permission.CreateTelemetryServiceLog),
      everywhere(Permission.ReadTelemetryServiceLog),
      blockedOn(Permission.CreateTelemetryServiceLog),
    ]);

    await expectRefused(LOGS, resourcesOf(LOGS).blocked, props);
    await expectCreated(LOGS, resourcesOf(LOGS).other, props);
  });

  test("a block with no labels on reading refuses the create, in its own words", async () => {
    await expect(
      create(
        LOGS,
        [rowOf(LOGS, resourcesOf(LOGS).other)],
        member([
          everywhere(Permission.CreateTelemetryServiceLog),
          everywhere(Permission.ReadTelemetryServiceLog),
          row(Permission.ReadTelemetryServiceLog, { isBlockPermission: true }),
        ]),
      ),
    ).rejects.toThrow(
      `You are not authorized to create Log because you may not read it: ${Permission.ReadTelemetryServiceLog} is in your team's permission block list.`,
    );

    expect(statements).toHaveLength(0);
  });

  /*
   * What a company's people wrote to its AI tools is read by owners and
   * admins only (LlmConversationPrivacy): nobody else writes spans into
   * those services either.
   */
  test("spans of a company AI tool's service are created by those who may read them", async () => {
    const SPANS: Table = tableOf(Span);
    const restricted: ObjectID = resourcesOf(SPANS).other;

    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockResolvedValue([restricted.toString()]);

    const props: DatabaseCommonInteractionProps = member([
      everywhere(Permission.CreateTelemetryServiceTraces),
      everywhere(Permission.ReadTelemetryServiceTraces),
    ]);

    await expectRefused(SPANS, restricted, props);
    await expectCreated(SPANS, resourcesOf(SPANS).labelled, props);
    await expectCreated(SPANS, restricted, projectOwner());
  });
});

/*
 * A monitor log names a monitor, a cost allocation a cluster, a network flow
 * a device (onlyParentModels); a log, a span or a metric can belong to any
 * kind of resource that owns telemetry.
 */
describe("the kind of resource a row belongs to", () => {
  test.each(
    [MonitorLog, KubernetesCostAllocation, NetworkFlow].map(
      (modelType: ModelCtor): Table => {
        return tableOf(modelType);
      },
    ),
  )(
    "$modelType.name: a service carrying the label is not a resource of its kind",
    async (table: Table) => {
      const props: DatabaseCommonInteractionProps = member([
        labelled(table.create),
        labelled(table.read),
      ]);

      await expectRefused(table, RESOURCES.get("Service")!.labelled, props);
      await expectCreated(table, resourcesOf(table).labelled, props);
    },
  );

  test("a log of a monitor carrying the label is reached", async () => {
    const LOGS: Table = tableOf(Log);

    await expectCreated(
      LOGS,
      RESOURCES.get("Monitor")!.labelled,
      member([
        labelled(Permission.CreateTelemetryServiceLog),
        labelled(Permission.ReadTelemetryServiceLog),
      ]),
    );
  });
});

/*
 * A change event that names no service is a marker for the whole project
 * (it shows on every chart): only a caller whose grants reach the whole
 * project creates one, as only they read one back.
 */
describe("a change event that names no service", () => {
  const CHANGE_EVENTS: Table = tableOf(ChangeEvent);

  test("is created by a member whose grants reach the whole project, blocks with labels aside", async () => {
    await expectCreated(
      CHANGE_EVENTS,
      null,
      member([everywhere(Permission.TelemetryMember)]),
    );
    await expectCreated(
      CHANGE_EVENTS,
      null,
      member([
        everywhere(Permission.TelemetryMember),
        blockedOn(Permission.TelemetryViewer),
      ]),
    );
    await expectCreated(CHANGE_EVENTS, null, projectOwner());
    await expectCreated(CHANGE_EVENTS, null, {
      isRoot: true,
      tenantId: projectId,
    });
  });

  test("is refused to a member limited to a label, or to what they own", async () => {
    const message: string = await expectRefused(
      CHANGE_EVENTS,
      null,
      member([labelled(Permission.TelemetryMember)]),
    );

    expect(message).toBe(
      "Your access lets you create Change Events only for the resources whose Change Events you may both create and read, and not for one that names no Service ID: that belongs to the whole project.",
    );

    await expectRefused(
      CHANGE_EVENTS,
      null,
      member([owned(Permission.TelemetryMember)]),
    );
  });
});

describe("a create of many rows", () => {
  const LOGS: Table = tableOf(Log);

  test("is refused whole for one row outside, naming each resource refused once", async () => {
    const props: DatabaseCommonInteractionProps = member([
      labelled(Permission.CreateTelemetryServiceLog),
      labelled(Permission.ReadTelemetryServiceLog),
    ]);
    const { labelled: inside, other, owned: alsoOutside } = resourcesOf(LOGS);

    let refusal: unknown = null;

    try {
      await create(
        LOGS,
        [
          rowOf(LOGS, inside),
          rowOf(LOGS, other),
          rowOf(LOGS, alsoOutside),
          rowOf(LOGS, other),
        ],
        props,
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect((refusal as Error).message).toBe(
      `Your access lets you create Logs only for the resources whose Logs you may both create and read, and not for Service ID "${other.toString()}", Service ID "${alsoOutside.toString()}".`,
    );
    expect(statements).toHaveLength(0);
  });

  test("works the caller's scope out once, for every row", async () => {
    const getReadScope: unknown = jest.spyOn(
      AnalyticsModelPermission,
      "getReadScope",
    );

    await create(
      LOGS,
      [
        rowOf(LOGS, resourcesOf(LOGS).labelled),
        rowOf(LOGS, resourcesOf(LOGS).labelled),
        rowOf(LOGS, resourcesOf(LOGS).labelled),
      ],
      member([
        labelled(Permission.CreateTelemetryServiceLog),
        labelled(Permission.ReadTelemetryServiceLog),
      ]),
    );

    expect(statements).toHaveLength(1);
    // Once for the read, once for the create.
    expect(getReadScope).toHaveBeenCalledTimes(2);
  });
});

/*
 * Rows that name no resource belong to the project where the model says so
 * (includeUnattributed): an Owned grant reaches them, as it reaches the
 * project's own bucket; a grant limited to labels does not. No telemetry
 * table says so today, so a table of the test's own stands in.
 */
describe("a model whose rows of no resource belong to the project", () => {
  @OwnedThrough("primaryEntityId", Service, { includeUnattributed: true })
  class UnattributedRow extends AnalyticsBaseModel {
    public constructor() {
      const access: {
        read: Array<Permission>;
        create: Array<Permission>;
        update: Array<Permission>;
      } = {
        read: [Permission.ReadTelemetryServiceLog],
        create: [Permission.CreateTelemetryServiceLog],
        update: [],
      };

      super({
        tableName: "UnattributedRowForTest",
        singularName: "Unattributed Row",
        pluralName: "Unattributed Rows",
        accessControl: {
          read: [Permission.ReadTelemetryServiceLog],
          create: [Permission.CreateTelemetryServiceLog],
          update: [],
          delete: [],
        },
        tableColumns: [
          new AnalyticsTableColumn({
            key: "projectId",
            title: "Project ID",
            description: "The project",
            required: true,
            isTenantId: true,
            type: AnalyticsTableColumnType.ObjectID,
            accessControl: access,
          }),
          new AnalyticsTableColumn({
            key: "primaryEntityId",
            title: "Service ID",
            description: "The resource the row belongs to, if any",
            required: false,
            type: AnalyticsTableColumnType.ObjectID,
            accessControl: access,
          }),
        ],
        primaryKeys: ["projectId"],
        sortKeys: ["projectId"],
        partitionKey: "projectId",
      });
    }
  }

  const check: (
    ownerId: ObjectID | null,
    props: DatabaseCommonInteractionProps,
  ) => Promise<void> = async (
    ownerId: ObjectID | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> => {
    const data: UnattributedRow = new UnattributedRow();

    data.setColumnValue("projectId", projectId);

    if (ownerId) {
      data.setColumnValue("primaryEntityId", ownerId);
    }

    await AnalyticsModelPermission.checkCreateScope(
      UnattributedRow,
      [data],
      props,
    );
  };

  const SERVICES: Resources = RESOURCES.get("Service")!;

  test("a member limited to what they own creates one, beside rows of what they own", async () => {
    const props: DatabaseCommonInteractionProps = member([
      owned(Permission.CreateTelemetryServiceLog),
      owned(Permission.ReadTelemetryServiceLog),
    ]);

    await check(null, props);
    await check(SERVICES.owned, props);
    await expect(check(SERVICES.other, props)).rejects.toThrow(
      CreateScopeException,
    );
  });

  test("a member limited to a label does not, on either grant", async () => {
    await expect(
      check(
        null,
        member([
          labelled(Permission.CreateTelemetryServiceLog),
          labelled(Permission.ReadTelemetryServiceLog),
        ]),
      ),
    ).rejects.toThrow(CreateScopeException);

    await expect(
      check(
        null,
        member([
          labelled(Permission.CreateTelemetryServiceLog),
          owned(Permission.ReadTelemetryServiceLog),
        ]),
      ),
    ).rejects.toThrow(CreateScopeException);

    await expect(
      check(
        null,
        member([
          owned(Permission.CreateTelemetryServiceLog),
          labelled(Permission.ReadTelemetryServiceLog),
        ]),
      ),
    ).rejects.toThrow(CreateScopeException);
  });

  test("a member whose grants reach the whole project, or one of them and the other what they own, creates one", async () => {
    await check(
      null,
      member([
        everywhere(Permission.CreateTelemetryServiceLog),
        everywhere(Permission.ReadTelemetryServiceLog),
      ]),
    );
    await check(
      null,
      member([
        everywhere(Permission.CreateTelemetryServiceLog),
        owned(Permission.ReadTelemetryServiceLog),
      ]),
    );
  });
});
