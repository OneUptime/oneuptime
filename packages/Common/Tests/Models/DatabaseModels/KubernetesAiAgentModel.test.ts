import AllModelTypes, {
  getModelTypeByName,
} from "../../../Models/DatabaseModels/Index";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The Kubernetes AI agent's row, as the permission layer sees it.
 *
 *  - It is server-owned: nobody creates, updates or deletes one through the
 *    API, and there is no CRUD endpoint or API documentation for it (the
 *    dashboard reads it through the cluster's AI access status).
 *  - Whoever may read the cluster may read its agent — except the key hash,
 *    which no role may read, write or create, a project owner included.
 *  - One agent per cluster, enforced by a unique index.
 *  - RunnerJob.targetKubernetesAiAgentId is read like targetAgentId and
 *    written by nobody but the server.
 *  - KubernetesCluster.isAiInvestigationEnabled is on by default.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

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

describe("KubernetesAiAgent model", () => {
  const agent: KubernetesAiAgent = new KubernetesAiAgent();
  const cluster: KubernetesCluster = new KubernetesCluster();
  const accessControl: Record<string, ColumnAccessControl> =
    agent.getColumnAccessControlForAllColumns();

  it("is registered with the other database models", () => {
    expect(AllModelTypes).toContain(KubernetesAiAgent);
    expect(getModelTypeByName("KubernetesAiAgent")).toBe(KubernetesAiAgent);
  });

  it("names its table and itself as the design says", () => {
    expect(agent.tableName).toBe("KubernetesAiAgent");
    expect(agent.singularName).toBe("Kubernetes AI Agent");
    expect(agent.pluralName).toBe("Kubernetes AI Agents");
  });

  it("is a project's row (tenant column projectId)", () => {
    expect(agent.getTenantColumn()).toBe("projectId");
  });

  it("has no CRUD API, no API documentation and no MCP tools", () => {
    expect(agent.crudApiPath).toBeFalsy();
    expect(agent.enableDocumentation).toBeFalsy();
    expect(agent.enableMCP).toBeFalsy();
  });

  it("nobody creates, updates or deletes a row through the API", () => {
    expect(agent.getCreatePermissions()).toEqual([]);
    expect(agent.getUpdatePermissions()).toEqual([]);
    expect(agent.getDeletePermissions()).toEqual([]);
  });

  it("is readable by exactly the roles that may read the cluster", () => {
    expect(sorted(agent.getReadPermissions())).toEqual(
      sorted(cluster.getReadPermissions()),
    );
  });

  it("every column is server-written: create and update ACLs are empty", () => {
    for (const [column, acl] of Object.entries(accessControl)) {
      expect({ column, create: acl.create }).toEqual({ column, create: [] });
      expect({ column, update: acl.update }).toEqual({ column, update: [] });
    }
  });

  it("every column but the key hash is readable by the cluster's readers", () => {
    const readable: Array<string> = Object.keys(accessControl).filter(
      (column: string): boolean => {
        return column !== "keyHash";
      },
    );

    expect(readable.length).toBeGreaterThan(5);

    for (const column of readable) {
      expect({ column, read: sorted(accessControl[column]!.read) }).toEqual({
        column,
        read: sorted(cluster.getReadPermissions()),
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
          KubernetesAiAgent,
          { keyHash: "0".repeat(64) } as unknown as KubernetesAiAgent,
          propsWith([Permission.ProjectOwner, Permission.ProjectAdmin]),
          requestType,
        );
      }).toThrow(BadDataException);
    },
  );

  it("a project owner may read the table but not create in it", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        KubernetesAiAgent,
        propsWith([Permission.ProjectOwner]),
        DatabaseRequestType.Read,
      );
    }).not.toThrow();

    expect(() => {
      TablePermission.checkTableLevelPermissions(
        KubernetesAiAgent,
        propsWith([Permission.ProjectOwner]),
        DatabaseRequestType.Create,
      );
    }).toThrow();
  });

  it("a cluster's readers never select the key hash", () => {
    const readableColumns: Array<string> =
      ColumnPermissions.getModelColumnsByPermissions(
        KubernetesAiAgent,
        propsWith([Permission.ProjectOwner]).userTenantAccessPermission![
          PROJECT_ID.toString()
        ]!.permissions,
        DatabaseRequestType.Read,
      ).columns;

    expect(readableColumns).toContain("connectionStatus");
    expect(readableColumns).not.toContain("keyHash");
  });

  it("allows one agent per live cluster row, with a named unique index", () => {
    const index: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (candidate: IndexMetadataArgs): boolean => {
          return (
            candidate.target === KubernetesAiAgent &&
            candidate.name === "IDX_KubernetesAiAgent_kubernetesClusterId"
          );
        },
      );

    expect(index).toBeDefined();
    expect(index?.columns).toEqual(["kubernetesClusterId"]);
    expect(index?.unique).toBe(true);
    expect(index?.where).toBe('"deletedAt" IS NULL');
  });

  it("starts disconnected", () => {
    const metadata: ReturnType<KubernetesAiAgent["getTableColumnMetadata"]> =
      agent.getTableColumnMetadata("connectionStatus");

    expect(metadata.defaultValue).toBe("disconnected");
    expect(metadata.isDefaultValueColumn).toBe(true);
  });

  it("links to its cluster and project, and both relations cascade", () => {
    for (const relation of ["project", "kubernetesCluster"]) {
      const declared:
        | ReturnType<typeof getMetadataArgsStorage>["relations"][number]
        | undefined = getMetadataArgsStorage().relations.find(
        (candidate: { target: unknown; propertyName: string }): boolean => {
          return (
            candidate.target === KubernetesAiAgent &&
            candidate.propertyName === relation
          );
        },
      );

      expect(declared?.options.onDelete).toBe("CASCADE");
    }
  });
});

describe("RunnerJob.targetKubernetesAiAgentId", () => {
  const job: RunnerJob = new RunnerJob();
  const accessControl: Record<string, ColumnAccessControl> =
    job.getColumnAccessControlForAllColumns();

  it.each(["targetKubernetesAiAgent", "targetKubernetesAiAgentId"])(
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

  it("is an entity relation to KubernetesAiAgent, backed by the id column", () => {
    const metadata: ReturnType<RunnerJob["getTableColumnMetadata"]> =
      job.getTableColumnMetadata("targetKubernetesAiAgent");

    expect(metadata.modelType).toBe(KubernetesAiAgent);
    expect(metadata.manyToOneRelationColumn).toBe("targetKubernetesAiAgentId");
    expect(
      job.getTableColumnMetadata("targetKubernetesAiAgentId").required,
    ).toBe(false);
  });

  it("is indexed, for the agent's claim query", () => {
    expect(
      getMetadataArgsStorage().indices.some(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === RunnerJob &&
            Array.isArray(index.columns) &&
            index.columns.length === 1 &&
            index.columns[0] === "targetKubernetesAiAgentId"
          );
        },
      ),
    ).toBe(true);
  });
});

describe("KubernetesCluster.isAiInvestigationEnabled", () => {
  it("is on by default, in the API metadata and the column", () => {
    const metadata: ReturnType<KubernetesCluster["getTableColumnMetadata"]> =
      new KubernetesCluster().getTableColumnMetadata(
        "isAiInvestigationEnabled",
      );

    expect(metadata.defaultValue).toBe(true);
    expect(metadata.description).toContain("On by default");
    expect(metadata.description).toContain("Nothing is ever changed");

    const column: { options: { default?: unknown } } | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: { target: unknown; propertyName: string }): boolean => {
          return (
            candidate.target === KubernetesCluster &&
            candidate.propertyName === "isAiInvestigationEnabled"
          );
        },
      );

    expect(column?.options.default).toBe(true);
  });
});
