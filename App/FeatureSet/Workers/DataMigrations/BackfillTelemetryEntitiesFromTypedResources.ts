import DataMigrationBase from "./DataMigrationBase";
import ServiceService from "Common/Server/Services/ServiceService";
import HostService from "Common/Server/Services/HostService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import TelemetryEntityService from "Common/Server/Services/TelemetryEntityService";
import EntityType from "Common/Types/Telemetry/EntityType";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import Service from "Common/Models/DatabaseModels/Service";
import Host from "Common/Models/DatabaseModels/Host";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import logger from "Common/Server/Utils/Logger";

const PAGE_SIZE: number = 1000;

/*
 * One-time backfill of the TelemetryEntity registry from the rich typed
 * tables (Service / Host / DockerHost / KubernetesCluster). Each typed row
 * becomes (or links) a registry row via the polymorphic (resourceType,
 * resourceId) pointer, so historical entities are catalogued and
 * ownership-linked without waiting for them to re-emit telemetry.
 *
 * The entityKey is computed with the same EntityExtractor.entityKey used
 * at ingest. For Host / DockerHost / KubernetesCluster the typed row may
 * not store the full identifying set (e.g. a host's host.id, a cluster's
 * uid), so the backfilled key uses the best available identifier
 * (host.name / cluster name); ongoing ingest creates the precisely-keyed
 * row going forward. See Internal/Docs/OpenTelemetryEntities.md §Migration.
 */
export default class BackfillTelemetryEntitiesFromTypedResources extends DataMigrationBase {
  public constructor() {
    super("BackfillTelemetryEntitiesFromTypedResources");
  }

  public override async migrate(): Promise<void> {
    await this.backfillServices();
    await this.backfillHosts();
    await this.backfillDockerHosts();
    await this.backfillKubernetesClusters();
  }

  private async backfillServices(): Promise<void> {
    let skip: number = 0;
    for (;;) {
      const rows: Array<Service> = await ServiceService.findBy({
        query: {},
        select: { _id: true, projectId: true, name: true },
        skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        if (!row.projectId || !row.id || !row.name) {
          continue;
        }
        const identifying: Dictionary<string> = { "service.name": row.name };
        await this.safeUpsert({
          projectId: row.projectId,
          entityType: EntityType.Service,
          identifyingAttributes: identifying,
          displayName: row.name,
          resourceType: "Service",
          resourceId: row.id,
        });
      }
      if (rows.length < PAGE_SIZE) {
        break;
      }
      skip += PAGE_SIZE;
    }
  }

  private async backfillHosts(): Promise<void> {
    let skip: number = 0;
    for (;;) {
      const rows: Array<Host> = await HostService.findBy({
        query: {},
        select: {
          _id: true,
          projectId: true,
          hostIdentifier: true,
          hostId: true,
        },
        skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        if (!row.projectId || !row.id || !row.hostIdentifier) {
          continue;
        }
        const identifying: Dictionary<string> = row.hostId
          ? { "host.id": row.hostId }
          : { "host.name": row.hostIdentifier };
        await this.safeUpsert({
          projectId: row.projectId,
          entityType: EntityType.Host,
          identifyingAttributes: identifying,
          displayName: row.hostIdentifier,
          resourceType: "Host",
          resourceId: row.id,
        });
      }
      if (rows.length < PAGE_SIZE) {
        break;
      }
      skip += PAGE_SIZE;
    }
  }

  private async backfillDockerHosts(): Promise<void> {
    let skip: number = 0;
    for (;;) {
      const rows: Array<DockerHost> = await DockerHostService.findBy({
        query: {},
        select: { _id: true, projectId: true, hostIdentifier: true },
        skip,
        limit: PAGE_SIZE,
        props: { isRoot: true },
      });
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        if (!row.projectId || !row.id || !row.hostIdentifier) {
          continue;
        }
        const identifying: Dictionary<string> = {
          "host.name": row.hostIdentifier,
        };
        await this.safeUpsert({
          projectId: row.projectId,
          entityType: EntityType.Host,
          identifyingAttributes: identifying,
          displayName: row.hostIdentifier,
          resourceType: "DockerHost",
          resourceId: row.id,
        });
      }
      if (rows.length < PAGE_SIZE) {
        break;
      }
      skip += PAGE_SIZE;
    }
  }

  private async backfillKubernetesClusters(): Promise<void> {
    let skip: number = 0;
    for (;;) {
      const rows: Array<KubernetesCluster> =
        await KubernetesClusterService.findBy({
          query: {},
          select: {
            _id: true,
            projectId: true,
            name: true,
            clusterIdentifier: true,
          },
          skip,
          limit: PAGE_SIZE,
          props: { isRoot: true },
        });
      if (rows.length === 0) {
        break;
      }
      for (const row of rows) {
        if (!row.projectId || !row.id || !row.clusterIdentifier) {
          continue;
        }
        const identifying: Dictionary<string> = {
          "k8s.cluster.name": row.clusterIdentifier,
        };
        await this.safeUpsert({
          projectId: row.projectId,
          entityType: EntityType.KubernetesCluster,
          identifyingAttributes: identifying,
          displayName: row.name || row.clusterIdentifier,
          resourceType: "KubernetesCluster",
          resourceId: row.id,
        });
      }
      if (rows.length < PAGE_SIZE) {
        break;
      }
      skip += PAGE_SIZE;
    }
  }

  private async safeUpsert(data: {
    projectId: ObjectID;
    entityType: EntityType;
    identifyingAttributes: Dictionary<string>;
    displayName: string;
    resourceType: string;
    resourceId: ObjectID;
  }): Promise<void> {
    try {
      await TelemetryEntityService.upsertTypedEntity(data);
    } catch (err) {
      logger.warn(
        `BackfillTelemetryEntities: failed to upsert ${data.resourceType} ${data.resourceId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
