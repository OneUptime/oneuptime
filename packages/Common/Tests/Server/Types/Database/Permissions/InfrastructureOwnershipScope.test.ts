import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProxmoxCluster from "../../../../../Models/DatabaseModels/ProxmoxCluster";
import CephCluster from "../../../../../Models/DatabaseModels/CephCluster";
import DockerSwarmCluster from "../../../../../Models/DatabaseModels/DockerSwarmCluster";
import VMwareVCenter from "../../../../../Models/DatabaseModels/VMwareVCenter";
import IoTFleet from "../../../../../Models/DatabaseModels/IoTFleet";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import Label from "../../../../../Models/DatabaseModels/Label";
import Log from "../../../../../Models/AnalyticsModels/Log";
import Span from "../../../../../Models/AnalyticsModels/Span";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import { AnalyticsBaseModelType } from "../../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import AnalyticsQuery from "../../../../../Server/Types/AnalyticsDatabase/Query";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import Query from "../../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { MockFunction } from "../../../../MockType";

/*
 * Infrastructure telemetry uses the canonical resource ID, not a synthetic
 * Service row. These tests exercise the real registry and permission gates;
 * only the database lookups behind the registered services are mocked.
 * Missing entries used to hide permitted telemetry while the corresponding
 * inventory models silently skipped Owned scope altogether.
 */
interface InfrastructureCase {
  name: string;
  modelType: DatabaseBaseModelType;
  fkColumn: string;
  readPermission: Permission;
  serviceType: ServiceType;
}

const INFRASTRUCTURE: Array<InfrastructureCase> = [
  {
    name: "ProxmoxCluster",
    modelType: ProxmoxCluster,
    fkColumn: "proxmoxClusterId",
    readPermission: Permission.ReadProxmoxCluster,
    serviceType: ServiceType.ProxmoxCluster,
  },
  {
    name: "CephCluster",
    modelType: CephCluster,
    fkColumn: "cephClusterId",
    readPermission: Permission.ReadCephCluster,
    serviceType: ServiceType.CephCluster,
  },
  {
    name: "DockerSwarmCluster",
    modelType: DockerSwarmCluster,
    fkColumn: "dockerSwarmClusterId",
    readPermission: Permission.ReadDockerSwarmCluster,
    serviceType: ServiceType.DockerSwarmCluster,
  },
  {
    name: "VMwareVCenter",
    modelType: VMwareVCenter,
    fkColumn: "vmwareVCenterId",
    readPermission: Permission.ReadVMwareVCenter,
    serviceType: ServiceType.VMwareVCenter,
  },
  {
    name: "IoTFleet",
    modelType: IoTFleet,
    fkColumn: "iotFleetId",
    readPermission: Permission.ReadIoTFleet,
    serviceType: ServiceType.IoTDevice,
  },
  {
    name: "NetworkDevice",
    modelType: NetworkDevice,
    fkColumn: "networkDeviceId",
    readPermission: Permission.ReadNetworkDevice,
    serviceType: ServiceType.NetworkDevice,
  },
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const OWNED_ID: ObjectID = ObjectID.generate();
const TEAM_OWNED_ID: ObjectID = ObjectID.generate();
const LABELED_ID: ObjectID = ObjectID.generate();
const FOREIGN_ID: ObjectID = ObjectID.generate();
const LABEL_ID: ObjectID = ObjectID.generate();

interface LookupMocks {
  user: MockFunction;
  team: MockFunction;
  model: MockFunction;
}

interface LookupRequest {
  query: Record<string, unknown>;
  select: Record<string, boolean>;
  props: DatabaseCommonInteractionProps;
}

const lookupMocks: Map<string, LookupMocks> = new Map();

function lookups(name: string): LookupMocks {
  const result: LookupMocks | undefined = lookupMocks.get(name);
  if (!result) {
    throw new Error(`No telemetry ownership registry entry for ${name}`);
  }
  return result;
}

function grant(
  permission: Permission,
  scope: PermissionScope,
  labelIds: Array<ObjectID> = [],
  isBlockPermission: boolean = false,
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    scope,
    labelIds,
    isBlockPermission,
  };
}

function propsFor(
  permissions: Array<UserPermission>,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: USER_ID,
    userTeamIds: [TEAM_ID],
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId,
        permissions,
      },
    },
  };
}

function scopedProps(
  scope: PermissionScope = PermissionScope.Owned,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  return propsFor(
    [
      grant(
        Permission.ProjectMember,
        scope,
        scope === PermissionScope.Labels ? [LABEL_ID] : [],
      ),
    ],
    projectId,
  );
}

function queryRecord(query: Query<BaseModel>): Record<string, unknown> {
  return query as Record<string, unknown>;
}

function boundValues(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(FindOperator);
  const operator: FindOperator<unknown> = value as FindOperator<unknown>;
  if (operator.type === "and") {
    return (operator.value as Array<FindOperator<unknown>>).flatMap(
      boundValues,
    );
  }
  if (operator.type === "equal") {
    return [String(operator.value)];
  }
  return Object.values(
    (operator.objectLiteralParameters || {}) as Record<string, unknown>,
  ).flatMap((item: unknown) => {
    return Array.isArray(item) ? item.map(String) : [String(item)];
  });
}

async function inventoryQuery(
  entry: InfrastructureCase,
  props: DatabaseCommonInteractionProps = scopedProps(),
  query: Query<BaseModel> = {},
): Promise<Record<string, unknown>> {
  return queryRecord(
    (
      await ModelPermission.checkReadQueryPermission(
        entry.modelType,
        query,
        null,
        props,
      )
    ).query,
  );
}

async function telemetryQuery(
  entry: InfrastructureCase,
  props: DatabaseCommonInteractionProps = scopedProps(),
  entityId: ObjectID = OWNED_ID,
): Promise<AnalyticsQuery<Log>> {
  return (
    await AnalyticsModelPermission.checkReadPermission(
      Log,
      {
        primaryEntityId: entityId,
        primaryEntityType: entry.serviceType,
      },
      null,
      props,
    )
  ).query;
}

beforeEach(() => {
  lookupMocks.clear();
  for (const [name, entry] of OwnerTableRegistry.entries()) {
    if (!entry.canOwnTelemetry || !entry.modelService) {
      continue;
    }
    lookupMocks.set(name, {
      user: jest
        .spyOn(entry.ownerUserService, "findBy")
        .mockResolvedValue([]) as unknown as MockFunction,
      team: jest
        .spyOn(entry.ownerTeamService, "findBy")
        .mockResolvedValue([]) as unknown as MockFunction,
      model: jest
        .spyOn(entry.modelService, "findBy")
        .mockResolvedValue([]) as unknown as MockFunction,
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(INFRASTRUCTURE)(
  "$name inventory ownership",
  (entry: InfrastructureCase) => {
    test("unowned inventory rows are excluded even without operational wildcard access", async () => {
      const result: Record<string, unknown> = await inventoryQuery(entry);

      expect(boundValues(result["_id"])).toEqual([
        ObjectID.getZeroObjectID().toString(),
      ]);
      expect(new entry.modelType().isOperationalResource).not.toBe(true);
    });

    test("user and team ownership are unioned and deduplicated", async () => {
      lookups(entry.name).user.mockResolvedValue([
        { [entry.fkColumn]: OWNED_ID },
        { [entry.fkColumn]: OWNED_ID },
        {},
      ]);
      lookups(entry.name).team.mockResolvedValue([
        { [entry.fkColumn]: TEAM_OWNED_ID },
        { [entry.fkColumn]: OWNED_ID },
      ]);

      const result: Record<string, unknown> = await inventoryQuery(entry);

      expect(new Set(boundValues(result["_id"]))).toEqual(
        new Set([OWNED_ID.toString(), TEAM_OWNED_ID.toString()]),
      );
      expect(boundValues(result["_id"])).toHaveLength(2);
      expect(lookups(entry.name).user).toHaveBeenCalledWith({
        query: { userId: USER_ID, projectId: PROJECT_ID },
        select: { [entry.fkColumn]: true },
        props: { isRoot: true },
        skip: 0,
        limit: LIMIT_MAX,
      });
      const teamRequest: LookupRequest = lookups(entry.name).team.mock
        .calls[0]![0];
      expect(teamRequest.query["projectId"]).toEqual(PROJECT_ID);
      expect(boundValues(teamRequest.query["teamId"])).toEqual([
        TEAM_ID.toString(),
      ]);
      expect(teamRequest.props).toEqual({ isRoot: true });
      expect(lookups(entry.name).user).toHaveBeenCalledTimes(1);
      expect(lookups(entry.name).team).toHaveBeenCalledTimes(1);
    });

    test("a requested unowned ID is intersected with ownership instead of replaced", async () => {
      lookups(entry.name).user.mockResolvedValue([
        { [entry.fkColumn]: OWNED_ID },
      ]);

      const result: Record<string, unknown> = await inventoryQuery(
        entry,
        scopedProps(),
        {
          _id: FOREIGN_ID.toString(),
        },
      );

      expect(result["_id"]).toBeInstanceOf(FindOperator);
      expect((result["_id"] as FindOperator<unknown>).type).toBe("and");
      expect(boundValues(result["_id"])).toEqual([
        FOREIGN_ID.toString(),
        OWNED_ID.toString(),
      ]);
    });

    test("label-scoped inventory reads keep their existing label restriction", async () => {
      const result: Record<string, unknown> = await inventoryQuery(
        entry,
        propsFor([
          grant(entry.readPermission, PermissionScope.Labels, [LABEL_ID]),
        ]),
      );

      expect(
        boundValues((result["labels"] as Record<string, unknown>)["_id"]),
      ).toEqual([LABEL_ID.toString()]);
      expect(lookups(entry.name).user).not.toHaveBeenCalled();
      expect(lookups(entry.name).team).not.toHaveBeenCalled();
    });

    test("an unrestricted grant still permits project-wide inventory reads", async () => {
      const result: Record<string, unknown> = await inventoryQuery(
        entry,
        scopedProps(PermissionScope.All),
      );

      expect(result).not.toHaveProperty("_id");
      expect(boundValues(result["projectId"])).toEqual([PROJECT_ID.toString()]);
      expect(lookups(entry.name).user).not.toHaveBeenCalled();
    });

    test("registering ownership does not grant ReadAllOperationalResources access", async () => {
      await expect(
        inventoryQuery(
          entry,
          propsFor([
            grant(Permission.ReadAllOperationalResources, PermissionScope.All),
          ]),
        ),
      ).rejects.toThrow(NotAuthorizedException);
      expect(lookups(entry.name).user).not.toHaveBeenCalled();
    });

    test("a blocked resource permission still rejects an otherwise allowed read", async () => {
      await expect(
        inventoryQuery(
          entry,
          propsFor([
            grant(entry.readPermission, PermissionScope.Owned),
            grant(entry.readPermission, PermissionScope.All, [], true),
          ]),
        ),
      ).rejects.toThrow(NotAuthorizedException);
      expect(lookups(entry.name).user).not.toHaveBeenCalled();
    });

    test("owning a resource does not bypass a blocked label", async () => {
      lookups(entry.name).user.mockResolvedValue([
        { [entry.fkColumn]: OWNED_ID },
      ]);
      jest.spyOn(QueryUtil, "getManyToManyRelationMetadata").mockReturnValue({
        joinTableName: `${entry.name}Label`,
        ownerColumnName: entry.fkColumn,
        relationColumnName: "labelId",
      });

      const result: Record<string, unknown> = await inventoryQuery(
        entry,
        propsFor([
          grant(entry.readPermission, PermissionScope.Owned),
          grant(entry.readPermission, PermissionScope.Labels, [LABEL_ID], true),
        ]),
      );

      const operator: FindOperator<unknown> = result[
        "_id"
      ] as FindOperator<unknown>;
      expect(operator.type).toBe("and");
      const clauses: Array<FindOperator<unknown>> = operator.value as Array<
        FindOperator<unknown>
      >;
      expect(clauses[0]?.getSql?.("resourceId")).toContain("NOT IN (SELECT");
      expect(boundValues(clauses[0])).toEqual([LABEL_ID.toString()]);
      expect(boundValues(clauses[1])).toEqual([OWNED_ID.toString()]);
    });
  },
);

describe.each(INFRASTRUCTURE)(
  "$name telemetry ownership",
  (entry: InfrastructureCase) => {
    test("owned telemetry is readable using the canonical root ID and discriminator", async () => {
      lookups(entry.name).user.mockResolvedValue([
        { [entry.fkColumn]: OWNED_ID },
      ]);

      const result: AnalyticsQuery<Log> = await telemetryQuery(entry);

      expect(result.primaryEntityId).toBeInstanceOf(Includes);
      expect((result.primaryEntityId as Includes).values).toEqual([
        OWNED_ID.toString(),
      ]);
      expect(result.primaryEntityType).toBe(entry.serviceType);
      expect(result.projectId).toEqual(PROJECT_ID);
      expect(OwnerTableRegistry.get(entry.name)?.modelService.modelType).toBe(
        entry.modelType,
      );
    });

    test("label scope resolves IDs through the actual infrastructure service without recursive permissions", async () => {
      lookups(entry.name).model.mockImplementation(
        async (request: LookupRequest) => {
          expect(request.props).toEqual({ isRoot: true });
          // The lookup's own read gate must terminate without another ownership lookup.
          await ModelPermission.checkReadQueryPermission(
            entry.modelType,
            request.query as Query<BaseModel>,
            null,
            request.props,
          );
          return [{ _id: LABELED_ID.toString() }];
        },
      );

      const result: AnalyticsQuery<Log> = await telemetryQuery(
        entry,
        scopedProps(PermissionScope.Labels),
        LABELED_ID,
      );

      expect((result.primaryEntityId as Includes).values).toEqual([
        LABELED_ID.toString(),
      ]);
      expect(lookups(entry.name).model).toHaveBeenCalledTimes(1);
      expect(lookups(entry.name).model).toHaveBeenCalledWith({
        query: { labels: [LABEL_ID], projectId: PROJECT_ID },
        select: { _id: true },
        props: { isRoot: true },
        skip: 0,
        limit: LIMIT_MAX,
      });
      expect(lookups(entry.name).user).not.toHaveBeenCalled();
    });

    test("unowned and unmatched-label telemetry fails closed", async () => {
      for (const scope of [PermissionScope.Owned, PermissionScope.Labels]) {
        const result: AnalyticsQuery<Log> = await telemetryQuery(
          entry,
          scopedProps(scope),
        );
        expect((result.primaryEntityId as Includes).values).toEqual([
          ObjectID.getZeroObjectID().toString(),
        ]);
      }
    });

    test("ownership lookups stay pinned to the requested project and do not cache across projects", async () => {
      lookups(entry.name).user.mockImplementation(
        async (request: LookupRequest) => {
          return [
            {
              [entry.fkColumn]:
                request.query["projectId"]?.toString() === PROJECT_ID.toString()
                  ? OWNED_ID
                  : FOREIGN_ID,
            },
          ];
        },
      );

      const first: AnalyticsQuery<Log> = await telemetryQuery(entry);
      const second: AnalyticsQuery<Log> = await telemetryQuery(
        entry,
        scopedProps(PermissionScope.Owned, OTHER_PROJECT_ID),
        OWNED_ID,
      );

      expect((first.primaryEntityId as Includes).values).toEqual([
        OWNED_ID.toString(),
      ]);
      expect((second.primaryEntityId as Includes).values).toEqual([
        ObjectID.getZeroObjectID().toString(),
      ]);
      expect(second.projectId).toEqual(OTHER_PROJECT_ID);
      expect(lookups(entry.name).user).toHaveBeenCalledTimes(2);
      expect(
        lookups(entry.name).user.mock.calls[1]![0].query.projectId,
      ).toEqual(OTHER_PROJECT_ID);
    });

    test("a blocked-only telemetry grant cannot become access through ownership", async () => {
      lookups(entry.name).user.mockResolvedValue([
        { [entry.fkColumn]: OWNED_ID },
      ]);
      await expect(
        telemetryQuery(
          entry,
          propsFor([
            grant(Permission.ProjectMember, PermissionScope.Owned, [], true),
          ]),
        ),
      ).rejects.toThrow(NotAuthorizedException);
      expect(lookups(entry.name).user).not.toHaveBeenCalled();
    });
  },
);

describe("infrastructure scope composition", () => {
  test("owned and labeled grants union IDs across resource types", async () => {
    lookups("ProxmoxCluster").user.mockResolvedValue([
      { proxmoxClusterId: OWNED_ID },
    ]);
    lookups("IoTFleet").team.mockResolvedValue([{ iotFleetId: TEAM_OWNED_ID }]);
    lookups("NetworkDevice").model.mockResolvedValue([
      { _id: LABELED_ID.toString() },
    ]);

    const ids: Array<ObjectID> | null =
      await AnalyticsModelPermission.getAccessibleServiceIdsForAnalyticsModel(
        Log,
        propsFor([
          grant(Permission.ProjectMember, PermissionScope.Owned),
          grant(Permission.ProjectMember, PermissionScope.Labels, [LABEL_ID]),
        ]),
        DatabaseRequestType.Read,
      );

    expect(new Set(ids?.map(String))).toEqual(
      new Set([
        OWNED_ID.toString(),
        TEAM_OWNED_ID.toString(),
        LABELED_ID.toString(),
        PROJECT_ID.toString(),
      ]),
    );
  });

  test("the same request shares resolved ownership across logs, spans, and metrics", async () => {
    lookups("VMwareVCenter").user.mockResolvedValue([
      { vmwareVCenterId: OWNED_ID },
    ]);
    const props: DatabaseCommonInteractionProps = scopedProps();

    for (const modelType of [
      Log,
      Span,
      Metric,
    ] as Array<AnalyticsBaseModelType>) {
      const ids: Array<ObjectID> | null =
        await AnalyticsModelPermission.getAccessibleServiceIdsForAnalyticsModel(
          modelType,
          props,
          DatabaseRequestType.Read,
        );
      expect(ids?.map(String)).toContain(OWNED_ID.toString());
    }
    expect(lookups("VMwareVCenter").user).toHaveBeenCalledTimes(1);
    expect(lookups("VMwareVCenter").team).toHaveBeenCalledTimes(1);
  });

  test("settings models without ownership keep their existing read scope", async () => {
    const query: Query<Label> = { projectId: PROJECT_ID };
    expect(
      await OwnedScopePermission.addOwnedScopeToQuery(
        Label,
        query,
        scopedProps(),
        DatabaseRequestType.Read,
      ),
    ).toEqual(query);
    for (const mocks of lookupMocks.values()) {
      expect(mocks.user).not.toHaveBeenCalled();
      expect(mocks.team).not.toHaveBeenCalled();
    }
  });

  test("label lookup results are isolated between requests for different projects", async () => {
    const entry: InfrastructureCase = INFRASTRUCTURE[0]!;
    lookups(entry.name).model.mockImplementation(
      async (request: LookupRequest) => {
        return [
          {
            _id:
              request.query["projectId"]?.toString() === PROJECT_ID.toString()
                ? LABELED_ID.toString()
                : FOREIGN_ID.toString(),
          },
        ];
      },
    );

    const first: AnalyticsQuery<Log> = await telemetryQuery(
      entry,
      scopedProps(PermissionScope.Labels),
      LABELED_ID,
    );
    const second: AnalyticsQuery<Log> = await telemetryQuery(
      entry,
      scopedProps(PermissionScope.Labels, OTHER_PROJECT_ID),
      LABELED_ID,
    );

    expect((first.primaryEntityId as Includes).values).toEqual([
      LABELED_ID.toString(),
    ]);
    expect((second.primaryEntityId as Includes).values).toEqual([
      ObjectID.getZeroObjectID().toString(),
    ]);
    expect(lookups(entry.name).model).toHaveBeenCalledTimes(2);
    expect(lookups(entry.name).model.mock.calls[1]![0].query.projectId).toEqual(
      OTHER_PROJECT_ID,
    );
  });

  test("registry owner lookups use root only internally and retain an explicit tenant predicate", async () => {
    const entry: InfrastructureCase = INFRASTRUCTURE[0]!;
    const registryEntry: OwnerTablePair = OwnerTableRegistry.get(entry.name)!;
    lookups(entry.name).user.mockImplementation(
      async (request: LookupRequest) => {
        expect(request.query).toEqual({
          userId: USER_ID,
          projectId: PROJECT_ID,
        });
        expect(request.props).toEqual({ isRoot: true });
        await ModelPermission.checkReadQueryPermission(
          registryEntry.ownerUserService.modelType,
          request.query as Query<BaseModel>,
          null,
          request.props,
        );
        return [{ [entry.fkColumn]: OWNED_ID }];
      },
    );

    const props: DatabaseCommonInteractionProps = scopedProps();
    await inventoryQuery(entry, props);
    expect(props.isRoot).toBeUndefined();
    expect(lookups(entry.name).user).toHaveBeenCalledTimes(1);
  });
});
