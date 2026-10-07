import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../Models/DatabaseModels/Service";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import { getAffectedResourceRelations } from "../../../Server/Utils/Database/AffectedResourceRelations";
import { ProjectScopedRelation } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The schema behind the two features, pinned:
 *
 * - a Monitor carries the same affected-resource relations an incident's
 *   Other Affected Resources does - one join table per type, named like the
 *   incident's - writable and readable by exactly who may write and read
 *   the monitor, and validated like every other affected-resource list;
 * - an AutoRemediationDecision is a server-only record (no client may
 *   create, change or delete one), read by the same members as the
 *   suggestions beside it, scoped to its project, and deleted with its
 *   incident or alert.
 */

interface LinkedRelation {
  column: string;
  model: { new (): DatabaseBaseModel };
  joinTable: string;
  inverseColumn: string;
}

const LINKED_RELATIONS: Array<LinkedRelation> = [
  {
    column: "hosts",
    model: Host,
    joinTable: "MonitorHost",
    inverseColumn: "hostId",
  },
  {
    column: "kubernetesClusters",
    model: KubernetesCluster,
    joinTable: "MonitorKubernetesCluster",
    inverseColumn: "kubernetesClusterId",
  },
  {
    column: "dockerHosts",
    model: DockerHost,
    joinTable: "MonitorDockerHost",
    inverseColumn: "dockerHostId",
  },
  {
    column: "podmanHosts",
    model: PodmanHost,
    joinTable: "MonitorPodmanHost",
    inverseColumn: "podmanHostId",
  },
  {
    column: "proxmoxClusters",
    model: ProxmoxCluster,
    joinTable: "MonitorProxmoxCluster",
    inverseColumn: "proxmoxClusterId",
  },
  {
    column: "vmwareVCenters",
    model: VMwareVCenter,
    joinTable: "MonitorVMwareVCenter",
    inverseColumn: "vmwareVCenterId",
  },
  {
    column: "cephClusters",
    model: CephCluster,
    joinTable: "MonitorCephCluster",
    inverseColumn: "cephClusterId",
  },
  {
    column: "storageArrays",
    model: StorageArray,
    joinTable: "MonitorStorageArray",
    inverseColumn: "storageArrayId",
  },
  {
    column: "dockerSwarmClusters",
    model: DockerSwarmCluster,
    joinTable: "MonitorDockerSwarmCluster",
    inverseColumn: "dockerSwarmClusterId",
  },
  {
    column: "iotFleets",
    model: IoTFleet,
    joinTable: "MonitorIoTFleet",
    inverseColumn: "iotFleetId",
  },
  {
    column: "databaseServers",
    model: DatabaseServer,
    joinTable: "MonitorDatabaseServer",
    inverseColumn: "databaseServerId",
  },
  {
    column: "services",
    model: Service,
    joinTable: "MonitorService",
    inverseColumn: "serviceId",
  },
];

function joinTableOf(
  target: { new (): DatabaseBaseModel },
  propertyName: string,
): JoinTableMetadataArgs | undefined {
  return getMetadataArgsStorage().joinTables.find(
    (joinTable: JoinTableMetadataArgs): boolean => {
      return (
        joinTable.target === target && joinTable.propertyName === propertyName
      );
    },
  );
}

function relationOf(
  target: { new (): DatabaseBaseModel },
  propertyName: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === target && relation.propertyName === propertyName
      );
    },
  );
}

describe("Monitor linked resources", () => {
  const monitor: Monitor = new Monitor();

  it.each(LINKED_RELATIONS)(
    "links $column through $joinTable",
    (relation: LinkedRelation) => {
      const metadata: TableColumnMetadata = monitor.getTableColumnMetadata(
        relation.column,
      );
      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect(metadata.modelType).toBe(relation.model);
      expect(metadata.required).toBe(false);

      const joinTable: JoinTableMetadataArgs | undefined = joinTableOf(
        Monitor,
        relation.column,
      );
      expect(joinTable?.name).toBe(relation.joinTable);
      expect(
        (joinTable?.joinColumns as Array<{ name?: string }> | undefined)?.[0]
          ?.name,
      ).toBe("monitorId");
      expect(
        (
          joinTable?.inverseJoinColumns as Array<{ name?: string }> | undefined
        )?.[0]?.name,
      ).toBe(relation.inverseColumn);

      expect(relationOf(Monitor, relation.column)?.relationType).toBe(
        "many-to-many",
      );
    },
  );

  it("names each join table like the incident's, with Monitor in place of Incident", () => {
    for (const relation of LINKED_RELATIONS) {
      expect(joinTableOf(Incident, relation.column)?.name).toBe(
        relation.joinTable.replace(/^Monitor/, "Incident"),
      );
    }
  });

  it.each(LINKED_RELATIONS)(
    "lets exactly the monitor's writers and readers write and read $column",
    (relation: LinkedRelation) => {
      const access: ColumnAccessControl = monitor.getColumnAccessControlFor(
        relation.column,
      )!;
      const labels: ColumnAccessControl =
        monitor.getColumnAccessControlFor("labels")!;

      expect(access.create).toEqual(labels.create);
      expect(access.read).toEqual(labels.read);
      expect(access.update).toEqual(labels.update);
      expect(access.read).toContain(Permission.ReadProjectMonitor);
      expect(access.update).toContain(Permission.EditProjectMonitor);
      expect(access.create).toContain(Permission.CreateProjectMonitor);
    },
  );

  it("holds the same lists as an incident's Other Affected Resources, so all of them are project-checked", () => {
    const columns: Array<string> = getAffectedResourceRelations(monitor).map(
      (relation: ProjectScopedRelation): string => {
        return relation.column;
      },
    );

    expect(columns.sort()).toEqual(
      LINKED_RELATIONS.map((relation: LinkedRelation): string => {
        return relation.column;
      }).sort(),
    );
  });
});

describe("AutoRemediationDecision", () => {
  const decision: AutoRemediationDecision = new AutoRemediationDecision();
  const suggestion: AutoRemediationSuggestion = new AutoRemediationSuggestion();

  it("is a project-scoped table with its own API route", () => {
    expect(decision.tableName).toBe("AutoRemediationDecision");
    expect(decision.getTenantColumn()).toBe("projectId");
    expect(decision.getCrudApiPath()?.toString()).toBe(
      "/auto-remediation-decision",
    );
  });

  it("can be written only by the server", () => {
    expect(decision.getCreatePermissions()).toEqual([]);
    expect(decision.getUpdatePermissions()).toEqual([]);
    expect(decision.getDeletePermissions()).toEqual([]);

    for (const column of [
      "projectId",
      "incidentId",
      "alertId",
      "stage",
      "entries",
    ]) {
      const access: ColumnAccessControl =
        decision.getColumnAccessControlFor(column)!;
      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
    }
  });

  it("is read by the same members as the suggestions beside it", () => {
    expect(decision.getReadPermissions()).toEqual(
      suggestion.getReadPermissions(),
    );

    for (const column of ["incidentId", "alertId", "stage", "entries"]) {
      expect(decision.getColumnAccessControlFor(column)!.read).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
      ]);
    }
  });

  it("is deleted with its incident, alert or project", () => {
    for (const propertyName of ["incident", "alert", "project"]) {
      const relation: RelationMetadataArgs | undefined = relationOf(
        AutoRemediationDecision,
        propertyName,
      );
      expect(relation?.relationType).toBe("many-to-one");
      expect(relation?.options.onDelete).toBe("CASCADE");
    }
  });

  it("stores its stage and entries", () => {
    expect(decision.getTableColumnMetadata("stage").type).toBe(
      TableColumnType.ShortText,
    );
    expect(decision.getTableColumnMetadata("stage").required).toBe(true);
    expect(decision.getTableColumnMetadata("entries").type).toBe(
      TableColumnType.JSON,
    );
  });
});
