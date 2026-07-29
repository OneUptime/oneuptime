import ObjectID from "../../ObjectID";
import MonitorStep from "../MonitorStep";
import MonitorType from "../MonitorType";

/*
 * The infrastructure resource types that ship a curated alert-template
 * library. There is exactly one member per `<X>AlertTemplates.ts` module in
 * `Common/Types/Monitor` — adding a ninth template module means adding a
 * member here and an adapter in `MonitorRecommendationCatalog.ts`, and the
 * catalog's own tests fail until both exist.
 *
 * These values are persisted nowhere. They are a UI/registry key only, so
 * they are free to differ from `MonitorType` (which they do: `DockerSwarm`
 * here vs `"Docker Swarm"` there).
 */
export enum MonitorRecommendationResourceType {
  Kubernetes = "Kubernetes",
  Host = "Host",
  Docker = "Docker",
  DockerSwarm = "DockerSwarm",
  Podman = "Podman",
  Proxmox = "Proxmox",
  Ceph = "Ceph",
  IoTDevice = "IoTDevice",
}

/*
 * Every template module declares its own
 * `<X>AlertTemplateSeverity = "Critical" | "Warning"` union. They are
 * identical, so the registry uses one shared type rather than a union of
 * eight structurally-equal unions.
 */
export type MonitorRecommendationSeverity = "Critical" | "Warning";

/*
 * The eight `<X>AlertTemplateArgs` interfaces are field-for-field identical
 * except for the name of the resource-identifier field:
 *
 *   clusterIdentifier -> Kubernetes, DockerSwarm, Proxmox, Ceph
 *   hostIdentifier    -> Host, Docker, Podman
 *   fleetIdentifier   -> IoTDevice
 *
 * The registry normalizes that single difference into `resourceIdentifier`
 * and each catalog adapter renames it back on the way into the module's own
 * `getMonitorStep`. Nothing else about the args differs, which is why this
 * one interface can drive all eight.
 */
export interface MonitorRecommendationArgs {
  resourceIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

/*
 * A single recommendable monitor, normalized across all eight template
 * modules.
 *
 * `templateId` is the id the owning module uses (e.g. `k8s-hpa-at-max-replicas`)
 * and is only unique WITHIN that module. `recommendationId` is the
 * registry-wide key — see `buildRecommendationId` — and is what UI selection
 * state and the created-monitor diff are keyed on.
 */
export interface MonitorRecommendation {
  recommendationId: string;
  resourceType: MonitorRecommendationResourceType;
  monitorType: MonitorType;
  templateId: string;
  name: string;
  description: string;
  category: string;
  severity: MonitorRecommendationSeverity;
  getMonitorStep: (args: MonitorRecommendationArgs) => MonitorStep;
}

/*
 * Registry-wide unique id for a recommendation.
 *
 * Every template module happens to self-prefix its ids today (`host-high-cpu`,
 * `docker-high-cpu`, `podman-high-cpu`), so the 76 template ids are in fact
 * globally unique right now. That is a convention across eight independently
 * maintained files, not a contract — each module only guarantees uniqueness
 * WITHIN itself. Prefixing here makes the registry correct regardless: without
 * it, the day two modules pick the same id, selecting one card in the UI would
 * silently also select the other. `MonitorRecommendationCatalog.test.ts` keeps
 * a canary on the current global uniqueness so the drift is at least visible.
 */
export function buildRecommendationId(
  resourceType: MonitorRecommendationResourceType,
  templateId: string,
): string {
  return `${resourceType}:${templateId}`;
}

/*
 * What the user chose in the create form, applied to every criteria instance
 * of every monitor being created.
 *
 * This is the field that fixes the long-standing gap where every shipped
 * template hardcodes `onCallPolicyIds: []` — a template-created monitor could
 * fire an incident that paged nobody. See
 * `MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep`.
 */
export interface MonitorRecommendationNotificationSettings {
  onCallPolicyIds?: Array<ObjectID> | undefined;
  ownerTeamIds?: Array<ObjectID> | undefined;
  ownerUserIds?: Array<ObjectID> | undefined;
  labelIds?: Array<ObjectID> | undefined;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
}
