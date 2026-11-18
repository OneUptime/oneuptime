import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import ResourceAiAccessService from "../../../Services/ResourceAiAccessService";
import ReadAudienceReader from "../../ReadAudience/ReadAudienceReader";
import { KubernetesClusterAiAccessStatus } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceAiAccessStatus } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * THE CLUSTERS AND RESOURCES AN INVESTIGATION REACHES DIRECTLY, kept to its
 * readers (#9576).
 *
 * An investigation may run read-only kubectl against a cluster, and
 * commands against a container host, a hypervisor or a database, through
 * their AI agents (ClusterAccessContext, ResourceAccessContext). Their
 * names, and what the commands print, reach its report, which everyone who
 * may see its incident or alert reads. The clusters and resources come
 * from the subject - its Affected Resources, else what its monitors watch
 * - so they are nearly always the subject's own; one its readers may not
 * read (set apart by an owner or a label, where some role reads that kind
 * only by owner or label) is neither named nor reached.
 */
export default class InvestigationAccessForAudience {
  // Of the clusters an investigation may reach, the ones its readers may read.
  public static async keepClusters(data: {
    statuses: Array<KubernetesClusterAiAccessStatus>;
    readAudience: ReadAudience;
  }): Promise<Array<KubernetesClusterAiAccessStatus>> {
    if (data.statuses.length === 0) {
      return data.statuses;
    }

    const readable: Set<string> = await ReadAudienceReader.readReadableIds({
      service: KubernetesClusterService,
      ids: data.statuses.map(
        (status: KubernetesClusterAiAccessStatus): string => {
          return status.clusterId;
        },
      ),
      audience: data.readAudience,
    });

    return data.statuses.filter(
      (status: KubernetesClusterAiAccessStatus): boolean => {
        return readable.has(status.clusterId.toLowerCase());
      },
    );
  }

  // Of the resources an investigation may reach, the ones its readers may read.
  public static async keepResources(data: {
    statuses: Array<ResourceAiAccessStatus>;
    readAudience: ReadAudience;
  }): Promise<Array<ResourceAiAccessStatus>> {
    const byType: Map<AiResourceType, Array<string>> = new Map<
      AiResourceType,
      Array<string>
    >();

    for (const status of data.statuses) {
      byType.set(status.resourceType, [
        ...(byType.get(status.resourceType) || []),
        status.resourceId,
      ]);
    }

    const readable: Set<string> = new Set<string>();

    for (const [resourceType, ids] of byType) {
      for (const id of await ReadAudienceReader.readReadableIds({
        service: ResourceAiAccessService.getResourceService(resourceType),
        ids,
        audience: data.readAudience,
      })) {
        readable.add(`${resourceType}:${id}`);
      }
    }

    return data.statuses.filter((status: ResourceAiAccessStatus): boolean => {
      return readable.has(
        `${status.resourceType}:${status.resourceId.toLowerCase()}`,
      );
    });
  }
}
