import AllModelTypes, {
  getModelTypeByName,
} from "../../../Models/DatabaseModels/Index";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../Types/Database/ColumnLength";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * A resource AI agent's row, as the permission layer and the schema builder
 * see it — the resource AI agent twin of KubernetesAiAgentModel.test.ts.
 *
 *  - It is server-owned: nobody creates, updates or deletes one through the
 *    API, and there is no CRUD endpoint, API documentation or MCP tool for
 *    it (the dashboard reads it through the resource's AI access status).
 *  - It is polymorphic: one table for every AiResourceType, keyed by
 *    (resourceType, resourceId) with NO foreign key on resourceId. So its
 *    readers are whoever may read a resource of any of those models — the
 *    roles all of them share, plus each model's own Read permission — and
 *    the per-resource check is the resource AI access API's.
 *  - The key hash is readable, creatable and updatable by no role at all,
 *    a project owner included.
 *  - One agent per live resource, enforced by a named unique partial index.
 *  - Column for column it is the Kubernetes AI agent's row, with the cluster
 *    reference replaced by resourceType / resourceId / resourceIdentifier.
 *  - RunnerJob.targetResourceAiAgentId, RunnerJob.resourceType/resourceId
 *    and AutoRemediationSuggestion.resourceType/resourceId are read like
 *    their Kubernetes counterparts and written by nobody but the server.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type ModelType = { new (): BaseModel; name: string };

// The model each AiResourceType's resourceId points into.
const RESOURCE_MODELS: Record<AiResourceType, ModelType> = {
  [AiResourceType.DockerHost]: DockerHost,
  [AiResourceType.PodmanHost]: PodmanHost,
  [AiResourceType.DockerSwarmCluster]: DockerSwarmCluster,
  [AiResourceType.ProxmoxCluster]: ProxmoxCluster,
  [AiResourceType.VMwareVCenter]: VMwareVCenter,
  [AiResourceType.CephCluster]: CephCluster,
  [AiResourceType.DatabaseServer]: DatabaseServer,
  [AiResourceType.Host]: Host,
};

const UNIQUE_INDEX_NAME: string =
  "IDX_ResourceAiAgent_projectId_resourceType_resourceId";

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function sorted(permissions: ReadonlyArray<Permission>): Array<Permission> {
  return [...permissions].sort();
}

function unique(permissions: ReadonlyArray<Permission>): Array<Permission> {
  return sorted(Array.from(new Set(permissions)));
}

function resourceReadLists(): Array<Array<Permission>> {
  return ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
    return new RESOURCE_MODELS[type]().getReadPermissions();
  });
}

// Whoever may read a resource of at least one AiResourceType model.
function unionOfResourceReaders(): Array<Permission> {
  return unique(resourceReadLists().flat());
}

// The roles every AiResourceType model's read list shares.
function intersectionOfResourceReaders(): Array<Permission> {
  const lists: Array<Array<Permission>> = resourceReadLists();

  return sorted(
    lists[0]!.filter((permission: Permission): boolean => {
      return lists.every((list: Array<Permission>): boolean => {
        return list.includes(permission);
      });
    }),
  );
}

function declaredColumns(model: ModelType): Array<ColumnMetadataArgs> {
  return getMetadataArgsStorage().columns.filter(
    (column: ColumnMetadataArgs): boolean => {
      return column.target === model;
    },
  );
}

function declaredColumn(
  model: ModelType,
  property: string,
): ColumnMetadataArgs {
  const declared: ColumnMetadataArgs | undefined = declaredColumns(model).find(
    (column: ColumnMetadataArgs): boolean => {
      return column.propertyName === property;
    },
  );

  if (!declared) {
    throw new Error(`${model.name} declares no column ${property}`);
  }

  return declared;
}

function declaredRelations(model: ModelType): Array<RelationMetadataArgs> {
  return getMetadataArgsStorage().relations.filter(
    (relation: RelationMetadataArgs): boolean => {
      return relation.target === model;
    },
  );
}

function declaredRelation(
  model: ModelType,
  property: string,
): RelationMetadataArgs {
  const declared: RelationMetadataArgs | undefined = declaredRelations(
    model,
  ).find((relation: RelationMetadataArgs): boolean => {
    return relation.propertyName === property;
  });

  if (!declared) {
    throw new Error(`${model.name} declares no relation ${property}`);
  }

  return declared;
}

function hasSingleColumnIndex(model: ModelType, column: string): boolean {
  return getMetadataArgsStorage().indices.some(
    (index: IndexMetadataArgs): boolean => {
      return (
        index.target === model &&
        Array.isArray(index.columns) &&
        index.columns.length === 1 &&
        index.columns[0] === column
      );
    },
  );
}

describe("ResourceAiAgent model", () => {
  const agent: ResourceAiAgent = new ResourceAiAgent();
  const accessControl: Record<string, ColumnAccessControl> =
    agent.getColumnAccessControlForAllColumns();

  it("is registered with the other database models", () => {
    expect(AllModelTypes).toContain(ResourceAiAgent);
    expect(getModelTypeByName("ResourceAiAgent")).toBe(ResourceAiAgent);
    expect(
      AllModelTypes.filter((model: unknown): boolean => {
        return model === ResourceAiAgent;
      }),
    ).toHaveLength(1);
  });

  it("names its table and itself as the design says", () => {
    expect(agent.tableName).toBe("ResourceAiAgent");
    expect(agent.singularName).toBe("Resource AI Agent");
    expect(agent.pluralName).toBe("Resource AI Agents");
    expect(agent.tableDescription).toMatch(/not user-writable/);
  });

  it("is a project's row (tenant column projectId)", () => {
    expect(agent.getTenantColumn()).toBe("projectId");
  });

  it("has no CRUD API, no API documentation and no MCP tools, like the Kubernetes AI agent", () => {
    const kubernetesAgent: KubernetesAiAgent = new KubernetesAiAgent();

    expect(agent.crudApiPath).toBeFalsy();
    expect(agent.enableDocumentation).toBeFalsy();
    expect(agent.enableMCP).toBeFalsy();

    expect(Boolean(agent.crudApiPath)).toBe(
      Boolean(kubernetesAgent.crudApiPath),
    );
    expect(Boolean(agent.enableDocumentation)).toBe(
      Boolean(kubernetesAgent.enableDocumentation),
    );
    expect(Boolean(agent.enableMCP)).toBe(Boolean(kubernetesAgent.enableMCP));
  });

  it("nobody creates, updates or deletes a row through the API", () => {
    expect(agent.getCreatePermissions()).toEqual([]);
    expect(agent.getUpdatePermissions()).toEqual([]);
    expect(agent.getDeletePermissions()).toEqual([]);
  });

  it("is readable by exactly the roles that may read a resource of any AiResourceType model", () => {
    expect(sorted(agent.getReadPermissions())).toEqual(
      unionOfResourceReaders(),
    );
  });

  it.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )("whoever may read a %s may read its agent", (type: AiResourceType) => {
    for (const permission of new RESOURCE_MODELS[type]().getReadPermissions()) {
      expect({ type, permission, readable: true }).toEqual({
        type,
        permission,
        readable: agent.getReadPermissions().includes(permission),
      });
    }
  });

  /*
   * Beyond the roles every resource model shares, the list holds only the
   * models' own Read permissions — never an Edit, Create or Delete one, and
   * nothing a resource model does not itself grant read with.
   */
  it("adds nothing but the resource models' own Read permissions to the roles they all share", () => {
    const shared: Array<Permission> = intersectionOfResourceReaders();
    const extra: Array<Permission> = agent
      .getReadPermissions()
      .filter((permission: Permission): boolean => {
        return !shared.includes(permission);
      });

    expect(shared.length).toBeGreaterThan(3);
    expect(extra).toHaveLength(ALL_AI_RESOURCE_TYPES.length);

    for (const permission of extra) {
      expect(String(permission)).toMatch(/^Read/);
    }
  });

  /*
   * Mirrors the Kubernetes AI agent: its readers are the cluster's roles
   * plus Read Kubernetes Cluster; ours are the same roles plus each resource
   * model's own Read permission.
   */
  it("shares the Kubernetes AI agent's roles, with each model's own Read permission in place of the cluster's", () => {
    const kubernetesReaders: Array<Permission> =
      new KubernetesAiAgent().getReadPermissions();

    expect(kubernetesReaders).toContain(Permission.ReadKubernetesCluster);
    expect(agent.getReadPermissions()).not.toContain(
      Permission.ReadKubernetesCluster,
    );
    expect(sorted(intersectionOfResourceReaders())).toEqual(
      sorted(
        kubernetesReaders.filter((permission: Permission): boolean => {
          return permission !== Permission.ReadKubernetesCluster;
        }),
      ),
    );
  });

  it("every column is server-written: create and update ACLs are empty", () => {
    for (const [column, acl] of Object.entries(accessControl)) {
      expect({ column, create: acl.create }).toEqual({ column, create: [] });
      expect({ column, update: acl.update }).toEqual({ column, update: [] });
    }
  });

  it("every column but the key hash is readable by the resource readers", () => {
    const readable: Array<string> = Object.keys(accessControl).filter(
      (column: string): boolean => {
        return column !== "keyHash";
      },
    );

    expect(readable.length).toBeGreaterThan(10);

    for (const column of readable) {
      expect({ column, read: sorted(accessControl[column]!.read) }).toEqual({
        column,
        read: sorted(agent.getReadPermissions()),
      });
    }
  });

  it("the key hash is readable, creatable and updatable by no role at all", () => {
    expect(accessControl["keyHash"]).toEqual({
      create: [],
      read: [],
      update: [],
    });
  });

  it.each([DatabaseRequestType.Create, DatabaseRequestType.Update])(
    "a project owner and admin cannot %s the key hash",
    (requestType: DatabaseRequestType) => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          ResourceAiAgent,
          { keyHash: "0".repeat(64) } as unknown as ResourceAiAgent,
          propsWith([Permission.ProjectOwner, Permission.ProjectAdmin]),
          requestType,
        );
      }).toThrow(BadDataException);
    },
  );

  it.each([
    ["resourceType", AiResourceType.DockerHost],
    ["resourceId", ObjectID.generate()],
    ["resourceIdentifier", "docker-host-prod-1"],
    ["connectionStatus", "connected"],
    ["posture", { allowWrites: true }],
  ])(
    "a project owner and admin cannot update %s either",
    (column: string, value: unknown) => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          ResourceAiAgent,
          { [column]: value } as unknown as ResourceAiAgent,
          propsWith([Permission.ProjectOwner, Permission.ProjectAdmin]),
          DatabaseRequestType.Update,
        );
      }).toThrow(BadDataException);
    },
  );

  it("a project owner may read the table but not create, update or delete in it", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        ResourceAiAgent,
        propsWith([Permission.ProjectOwner]),
        DatabaseRequestType.Read,
      );
    }).not.toThrow();

    for (const requestType of [
      DatabaseRequestType.Create,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          ResourceAiAgent,
          propsWith([Permission.ProjectOwner]),
          requestType,
        );
      }).toThrow();
    }
  });

  it.each([
    Permission.ReadDockerHost,
    Permission.ReadCephCluster,
    Permission.ReadHost,
  ])("a holder of only %s may read the table", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        ResourceAiAgent,
        propsWith([permission]),
        DatabaseRequestType.Read,
      );
    }).not.toThrow();
  });

  it.each([
    Permission.EditDockerHost,
    Permission.ReadKubernetesCluster,
    Permission.RunbookViewer,
  ])("a holder of only %s may not read the table", (permission: Permission) => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        ResourceAiAgent,
        propsWith([permission]),
        DatabaseRequestType.Read,
      );
    }).toThrow();
  });

  it("a resource's readers never select the key hash", () => {
    const readableColumns: Array<string> =
      ColumnPermissions.getModelColumnsByPermissions(
        ResourceAiAgent,
        propsWith([Permission.ProjectOwner]).userTenantAccessPermission![
          PROJECT_ID.toString()
        ]!.permissions,
        DatabaseRequestType.Read,
      ).columns;

    expect(readableColumns).toContain("connectionStatus");
    expect(readableColumns).toContain("resourceType");
    expect(readableColumns).toContain("resourceId");
    expect(readableColumns).not.toContain("keyHash");
  });

  it("allows one agent per live resource, with a named unique partial index", () => {
    const index: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (candidate: IndexMetadataArgs): boolean => {
          return (
            candidate.target === ResourceAiAgent &&
            candidate.name === UNIQUE_INDEX_NAME
          );
        },
      );

    expect(index).toBeDefined();
    expect(index?.columns).toEqual(["projectId", "resourceType", "resourceId"]);
    expect(index?.unique).toBe(true);
    expect(index?.where).toBe('"deletedAt" IS NULL');
  });

  it("is the only unique index on the table", () => {
    const uniques: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (candidate: IndexMetadataArgs): boolean => {
          return (
            candidate.target === ResourceAiAgent && candidate.unique === true
          );
        },
      );

    expect(
      uniques.map((candidate: IndexMetadataArgs) => {
        return candidate.name;
      }),
    ).toEqual([UNIQUE_INDEX_NAME]);
  });

  it.each(["projectId", "resourceType", "resourceId"])(
    "indexes %s on its own, for lookups by project and by resource",
    (column: string) => {
      expect(hasSingleColumnIndex(ResourceAiAgent, column)).toBe(true);
    },
  );

  it("starts disconnected", () => {
    const metadata: ReturnType<ResourceAiAgent["getTableColumnMetadata"]> =
      agent.getTableColumnMetadata("connectionStatus");

    expect(metadata.defaultValue).toBe("disconnected");
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(declaredColumn(ResourceAiAgent, "connectionStatus").options).toEqual(
      expect.objectContaining({ nullable: false, default: "disconnected" }),
    );
  });

  it("links only to its project, and that relation cascades", () => {
    const relations: Array<RelationMetadataArgs> =
      declaredRelations(ResourceAiAgent);

    expect(
      relations.map((relation: RelationMetadataArgs) => {
        return relation.propertyName;
      }),
    ).toEqual(["project"]);
    expect(relations[0]!.relationType).toBe("many-to-one");
    expect(relations[0]!.options.onDelete).toBe("CASCADE");
  });

  /*
   * resourceId points into a different table for every resourceType, so it
   * can have no foreign key: no relation is declared on it, and its API
   * metadata is a plain id, not an entity.
   */
  it("keeps resourceId a plain, required, indexed id with no relation", () => {
    const metadata: ReturnType<ResourceAiAgent["getTableColumnMetadata"]> =
      agent.getTableColumnMetadata("resourceId");

    expect(metadata.type).toBe(TableColumnType.ObjectID);
    expect(metadata.required).toBe(true);
    expect(metadata.modelType).toBeUndefined();
    expect(declaredColumn(ResourceAiAgent, "resourceId").options.nullable).toBe(
      false,
    );

    for (const relation of declaredRelations(ResourceAiAgent)) {
      expect(relation.propertyName).not.toMatch(/^resource/);
    }
  });

  it("stores resourceType as a required short string", () => {
    const metadata: ReturnType<ResourceAiAgent["getTableColumnMetadata"]> =
      agent.getTableColumnMetadata("resourceType");

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(true);
    expect(declaredColumn(ResourceAiAgent, "resourceType").options).toEqual(
      expect.objectContaining({
        nullable: false,
        length: ColumnLength.ShortText,
      }),
    );
  });

  it.each(
    ALL_AI_RESOURCE_TYPES.map((type: AiResourceType) => {
      return [type];
    }),
  )("has room for the resource type %s", (type: AiResourceType) => {
    expect(type.length).toBeLessThanOrEqual(ColumnLength.ShortText);
  });

  it("keeps resourceIdentifier optional and bounded", () => {
    const metadata: ReturnType<ResourceAiAgent["getTableColumnMetadata"]> =
      agent.getTableColumnMetadata("resourceIdentifier");

    expect(metadata.type).toBe(TableColumnType.LongText);
    expect(metadata.required).toBe(false);
    expect(
      declaredColumn(ResourceAiAgent, "resourceIdentifier").options,
    ).toEqual(
      expect.objectContaining({
        nullable: true,
        length: ColumnLength.LongText,
      }),
    );
  });

  it("maps every AiResourceType to the model of the same name", () => {
    expect(Object.keys(RESOURCE_MODELS).sort()).toEqual(
      [...ALL_AI_RESOURCE_TYPES].sort(),
    );

    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(new RESOURCE_MODELS[type]().tableName).toBe(type);
      expect(getModelTypeByName(type)).toBe(RESOURCE_MODELS[type]);
    }
  });
});

describe("ResourceAiAgent mirrors KubernetesAiAgent column for column", () => {
  const KUBERNETES_ONLY: Array<string> = ["kubernetesClusterId"];
  const RESOURCE_ONLY: Array<string> = [
    "resourceType",
    "resourceId",
    "resourceIdentifier",
  ];

  function propertyNames(model: ModelType): Array<string> {
    return declaredColumns(model)
      .map((column: ColumnMetadataArgs): string => {
        return column.propertyName;
      })
      .sort();
  }

  it("has the Kubernetes AI agent's columns, with the cluster replaced by the resource", () => {
    expect(propertyNames(ResourceAiAgent)).toEqual(
      [
        ...propertyNames(KubernetesAiAgent).filter((name: string): boolean => {
          return !KUBERNETES_ONLY.includes(name);
        }),
        ...RESOURCE_ONLY,
      ].sort(),
    );
  });

  it.each(
    [
      "projectId",
      "keyHash",
      "agentVersion",
      "posture",
      "lastAliveAt",
      "connectionStatus",
      "lastRegisteredAt",
      "registeredWithIngestionKeyId",
      "lastRefusedRegistrationAt",
      "lastRefusedRegistrationReason",
    ].map((property: string) => {
      return [property];
    }),
  )(
    "%s is declared exactly as on the Kubernetes AI agent",
    (property: string) => {
      const ours: ColumnMetadataArgs = declaredColumn(
        ResourceAiAgent,
        property,
      );
      const theirs: ColumnMetadataArgs = declaredColumn(
        KubernetesAiAgent,
        property,
      );

      expect({
        type: ours.options.type,
        length: ours.options.length,
        nullable: ours.options.nullable,
        default: ours.options.default,
        transformer: Boolean(ours.options.transformer),
      }).toEqual({
        type: theirs.options.type,
        length: theirs.options.length,
        nullable: theirs.options.nullable,
        default: theirs.options.default,
        transformer: Boolean(theirs.options.transformer),
      });

      const ourMetadata: ReturnType<ResourceAiAgent["getTableColumnMetadata"]> =
        new ResourceAiAgent().getTableColumnMetadata(property);
      const theirMetadata: ReturnType<
        KubernetesAiAgent["getTableColumnMetadata"]
      > = new KubernetesAiAgent().getTableColumnMetadata(property);

      expect({
        type: ourMetadata.type,
        required: ourMetadata.required,
        title: ourMetadata.title,
      }).toEqual({
        type: theirMetadata.type,
        required: theirMetadata.required,
        title: theirMetadata.title,
      });
    },
  );

  it("the project relation is declared exactly as on the Kubernetes AI agent", () => {
    const ours: RelationMetadataArgs = declaredRelation(
      ResourceAiAgent,
      "project",
    );
    const theirs: RelationMetadataArgs = declaredRelation(
      KubernetesAiAgent,
      "project",
    );

    expect(ours.options).toEqual(theirs.options);
  });
});

describe("RunnerJob.targetResourceAiAgentId", () => {
  const job: RunnerJob = new RunnerJob();
  const accessControl: Record<string, ColumnAccessControl> =
    job.getColumnAccessControlForAllColumns();

  it.each(["targetResourceAiAgent", "targetResourceAiAgentId"])(
    "%s is read like targetAgentId and written by nobody but the server",
    (column: string) => {
      expect(accessControl[column]).toBeDefined();
      expect(accessControl[column]!.create).toEqual([]);
      expect(accessControl[column]!.update).toEqual([]);
      expect(sorted(accessControl[column]!.read)).toEqual(
        sorted(accessControl["targetAgentId"]!.read),
      );
    },
  );

  it("is an entity relation to ResourceAiAgent, backed by the id column", () => {
    const metadata: ReturnType<RunnerJob["getTableColumnMetadata"]> =
      job.getTableColumnMetadata("targetResourceAiAgent");

    expect(metadata.modelType).toBe(ResourceAiAgent);
    expect(metadata.manyToOneRelationColumn).toBe("targetResourceAiAgentId");
    expect(job.getTableColumnMetadata("targetResourceAiAgentId").required).toBe(
      false,
    );
    expect(
      declaredColumn(RunnerJob, "targetResourceAiAgentId").options.nullable,
    ).toBe(true);
  });

  it("is nulled, never cascaded, when the agent row goes — like the Kubernetes AI agent target", () => {
    const ours: RelationMetadataArgs = declaredRelation(
      RunnerJob,
      "targetResourceAiAgent",
    );
    const theirs: RelationMetadataArgs = declaredRelation(
      RunnerJob,
      "targetKubernetesAiAgent",
    );

    expect(ours.relationType).toBe("many-to-one");
    expect(ours.options.onDelete).toBe("SET NULL");
    expect((ours.type as () => unknown)()).toBe(ResourceAiAgent);
    expect(ours.options).toEqual(theirs.options);
  });

  it("is indexed, for the agent's claim query", () => {
    expect(hasSingleColumnIndex(RunnerJob, "targetResourceAiAgentId")).toBe(
      true,
    );
  });
});

describe("RunnerJob.resourceType and RunnerJob.resourceId", () => {
  const job: RunnerJob = new RunnerJob();
  const accessControl: Record<string, ColumnAccessControl> =
    job.getColumnAccessControlForAllColumns();

  it.each(["resourceType", "resourceId"])(
    "%s is read like kubernetesClusterId and written by nobody but the server",
    (column: string) => {
      expect(accessControl[column]).toBeDefined();
      expect(accessControl[column]!.create).toEqual([]);
      expect(accessControl[column]!.update).toEqual([]);
      expect(sorted(accessControl[column]!.read)).toEqual(
        sorted(accessControl["kubernetesClusterId"]!.read),
      );
    },
  );

  it.each(["resourceType", "resourceId"])(
    "%s is optional (set on ResourceCommand jobs only) and indexed, for a resource's AI page",
    (column: string) => {
      expect(job.getTableColumnMetadata(column).required).toBe(false);
      expect(declaredColumn(RunnerJob, column).options.nullable).toBe(true);
      expect(hasSingleColumnIndex(RunnerJob, column)).toBe(true);
    },
  );

  it("keeps resourceId a plain id: no relation, no foreign key", () => {
    expect(job.getTableColumnMetadata("resourceId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(job.getTableColumnMetadata("resourceId").modelType).toBeUndefined();
    expect(
      declaredRelations(RunnerJob).some(
        (relation: RelationMetadataArgs): boolean => {
          return relation.propertyName.startsWith("resource");
        },
      ),
    ).toBe(false);
  });

  it("stores resourceType as a short string", () => {
    expect(job.getTableColumnMetadata("resourceType").type).toBe(
      TableColumnType.ShortText,
    );
    expect(declaredColumn(RunnerJob, "resourceType").options.length).toBe(
      ColumnLength.ShortText,
    );
  });
});

describe("AutoRemediationSuggestion.resourceType and resourceId", () => {
  const suggestion: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  const accessControl: Record<string, ColumnAccessControl> =
    suggestion.getColumnAccessControlForAllColumns();

  it.each(["resourceType", "resourceId"])(
    "%s is read like kubernetesClusterId and written by nobody but the server",
    (column: string) => {
      expect(accessControl[column]).toBeDefined();
      expect(accessControl[column]!.create).toEqual([]);
      expect(accessControl[column]!.update).toEqual([]);
      expect(sorted(accessControl[column]!.read)).toEqual(
        sorted(accessControl["kubernetesClusterId"]!.read),
      );
    },
  );

  it.each(["resourceType", "resourceId"])(
    "%s is optional (set on resource rounds only) and indexed",
    (column: string) => {
      expect(suggestion.getTableColumnMetadata(column).required).toBe(false);
      expect(
        declaredColumn(AutoRemediationSuggestion, column).options.nullable,
      ).toBe(true);
      expect(hasSingleColumnIndex(AutoRemediationSuggestion, column)).toBe(
        true,
      );
    },
  );

  it("keeps resourceId a plain id: no relation, no foreign key", () => {
    expect(suggestion.getTableColumnMetadata("resourceId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(
      declaredRelations(AutoRemediationSuggestion).some(
        (relation: RelationMetadataArgs): boolean => {
          return relation.propertyName.startsWith("resource");
        },
      ),
    ).toBe(false);
  });

  it("a project owner cannot write either column through the API", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        AutoRemediationSuggestion,
        {
          resourceType: AiResourceType.DockerHost,
          resourceId: ObjectID.generate(),
        } as unknown as AutoRemediationSuggestion,
        propsWith([Permission.ProjectOwner]),
        DatabaseRequestType.Update,
      );
    }).toThrow(BadDataException);
  });
});
