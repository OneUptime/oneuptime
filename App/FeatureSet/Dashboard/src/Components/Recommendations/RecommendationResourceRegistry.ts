import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * The App-side half of the recommendation registry.
 *
 * `MonitorRecommendationCatalog` in Common knows what to recommend for a
 * resource type. It cannot know which Postgres model that resource type is,
 * or which of that model's columns carries the identifier the telemetry is
 * tagged with — those are dashboard concerns. Before this file, that knowledge
 * was copy-pasted into nearly identical `View/Recommendations.tsx` pages
 * (fetch the model, read one field, pass three props), and there was no way
 * for anything else — like a side-menu count badge — to ask the same question
 * without a ninth copy.
 *
 * A resource type missing from this table renders no recommendations and no
 * badge, silently. `RecommendationResourceRegistry.test.ts` enumerates the
 * ENUM rather than this table, so adding a member to
 * `MonitorRecommendationResourceType` fails there until it is wired up here.
 */
export interface RecommendationResourceDefinition {
  resourceType: MonitorRecommendationResourceType;
  modelType: { new (): BaseModel };
  /*
   * The column whose value the monitor step is scoped to. It MUST be the same
   * value existing monitors were created with, or the already-created diff
   * finds nothing and every recommendation reappears as available.
   *
   * Note this is not uniform: the four resources that ship an agent-reported
   * identifier use it, and the four that do not fall back to `name`. That is
   * the behaviour the individual pages already had — see the table below.
   */
  identifierFieldName: string;
  // The column used to name created monitors, e.g. "prod-cluster - Job Failures".
  displayNameFieldName: string;
}

/*
 * Which column each resource type scopes its monitors by, and why they differ:
 *
 *   Kubernetes  clusterIdentifier  agent-reported, stable across renames
 *   Host        hostIdentifier     agent-reported
 *   Docker      hostIdentifier     agent-reported
 *   Podman      hostIdentifier     agent-reported
 *   DockerSwarm name               model has no identifier column
 *   Proxmox     name               model has no identifier column
 *   Ceph        name               model has no identifier column
 *   IoTDevice   name               IoTFleet has no identifier column
 *   RUM         _id                Metric/Span/Exception.primaryEntityId is
 *                                  the RumApplication row id
 *
 * The four `name` rows mean renaming one of those resources orphans its
 * existing monitors from the diff — they will show as available again. That is
 * pre-existing behaviour inherited from the per-page wiring, faithfully
 * preserved here rather than quietly changed: switching them to a different
 * column would break the diff for every monitor already created.
 */
const RESOURCE_DEFINITIONS: Array<RecommendationResourceDefinition> = [
  {
    resourceType: MonitorRecommendationResourceType.Kubernetes,
    modelType: KubernetesCluster,
    identifierFieldName: "clusterIdentifier",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Host,
    modelType: Host,
    identifierFieldName: "hostIdentifier",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Docker,
    modelType: DockerHost,
    identifierFieldName: "hostIdentifier",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.DockerSwarm,
    modelType: DockerSwarmCluster,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Podman,
    modelType: PodmanHost,
    identifierFieldName: "hostIdentifier",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Proxmox,
    modelType: ProxmoxCluster,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Ceph,
    modelType: CephCluster,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.IoTDevice,
    modelType: IoTFleet,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.RumApplication,
    modelType: RumApplication,
    identifierFieldName: "_id",
    displayNameFieldName: "name",
  },
];

export default class RecommendationResourceRegistry {
  public static getDefinitions(): Array<RecommendationResourceDefinition> {
    return [...RESOURCE_DEFINITIONS];
  }

  public static getDefinition(
    resourceType: MonitorRecommendationResourceType,
  ): RecommendationResourceDefinition | undefined {
    return RESOURCE_DEFINITIONS.find(
      (definition: RecommendationResourceDefinition) => {
        return definition.resourceType === resourceType;
      },
    );
  }

  /*
   * The `select` to pass to `ModelAPI.getItem` for a resource type.
   *
   * Built from the definition rather than written out per page so that the
   * identifier column can never be selected on one code path and forgotten on
   * another — a forgotten select yields `undefined`, which reads as "this
   * resource has no telemetry yet" rather than as an error.
   */
  public static getSelect(
    resourceType: MonitorRecommendationResourceType,
  ): Record<string, boolean> {
    const definition: RecommendationResourceDefinition | undefined =
      this.getDefinition(resourceType);

    if (!definition) {
      return {};
    }

    const select: Record<string, boolean> = {};

    select[definition.identifierFieldName] = true;
    select[definition.displayNameFieldName] = true;

    return select;
  }

  /*
   * Pull the identifier and display name out of a fetched model.
   *
   * `resourceDisplayName` falls back to the identifier so a resource with a
   * blank name still produces meaningfully-named monitors rather than
   * monitors called " - Node Not Ready".
   */
  public static readResourceFields(data: {
    resourceType: MonitorRecommendationResourceType;
    model: BaseModel | null;
  }): { resourceIdentifier: string; resourceDisplayName: string } {
    const definition: RecommendationResourceDefinition | undefined =
      this.getDefinition(data.resourceType);

    if (!definition || !data.model) {
      return { resourceIdentifier: "", resourceDisplayName: "" };
    }

    const record: Record<string, unknown> = data.model as unknown as Record<
      string,
      unknown
    >;

    const identifierValue: unknown = record[definition.identifierFieldName];
    const displayNameValue: unknown = record[definition.displayNameFieldName];

    const resourceIdentifier: string =
      typeof identifierValue === "string" ? identifierValue : "";
    const resourceDisplayName: string =
      typeof displayNameValue === "string" ? displayNameValue : "";

    return {
      resourceIdentifier: resourceIdentifier,
      resourceDisplayName: resourceDisplayName || resourceIdentifier,
    };
  }
}
