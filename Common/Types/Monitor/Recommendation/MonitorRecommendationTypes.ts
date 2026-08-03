import ObjectID from "../../ObjectID";
import RecommendationType from "../../Recommendation/RecommendationType";
import MonitorStep from "../MonitorStep";
import MonitorType from "../MonitorType";

/*
 * The resource types that ship a curated alert-template library. There is
 * exactly one member per `<X>AlertTemplates.ts` module in
 * `Common/Types/Monitor` — adding another template module means adding a
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
  RumApplication = "RumApplication",
}

/*
 * Every template module declares its own
 * `<X>AlertTemplateSeverity = "Critical" | "Warning"` union. They are
 * identical, so the registry uses one shared type rather than a union of
 * eight structurally-equal unions.
 */
export type MonitorRecommendationSeverity = "Critical" | "Warning";

/*
 * The `<X>AlertTemplateArgs` interfaces are field-for-field identical
 * except for the name of the resource-identifier field:
 *
 *   clusterIdentifier -> Kubernetes, DockerSwarm, Proxmox, Ceph
 *   hostIdentifier    -> Host, Docker, Podman
 *   fleetIdentifier   -> IoTDevice
 *   rumApplicationId  -> RUM application
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
 * A single recommendable monitor, normalized across all template
 * modules.
 *
 * `templateId` is the id the owning module uses (e.g. `k8s-hpa-at-max-replicas`)
 * and is only unique WITHIN that module. `recommendationId` is the
 * registry-wide key — see `buildRecommendationId` — and is what UI selection
 * state and the created-monitor diff are keyed on.
 */
export interface MonitorRecommendation {
  recommendationId: string;
  /*
   * Always `RecommendationType.Monitor` for everything in this catalog. It is
   * carried on the record rather than hardcoded at the call sites so that the
   * dismissal write, the count query and the page shell — all of which are
   * kind-agnostic — read it off the recommendation instead of assuming.
   */
  recommendationType: RecommendationType;
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
 * What a created monitor should open when its condition is met.
 *
 * Every shipped template sets BOTH `createIncidents: true` and
 * `createAlerts: true` on its unhealthy criteria, so today one threshold
 * breach opens an incident AND an alert describing the same thing — two
 * records, two notification fan-outs, two things to resolve. That is almost
 * never what anyone wants, and there is no way to say so from the
 * recommendations page. This is that choice.
 *
 * The distinction the product draws (see the monitor criteria form's own
 * tooltips): an alert notifies the team; an incident notifies the team AND
 * shows on the status page.
 */
export enum MonitorRecommendationNotificationMode {
  Alert = "Alert",
  Incident = "Incident",
  Both = "Both",
}

/*
 * A project severity to use for each recommendation severity.
 *
 * Recommendation severities are a fixed two-member vocabulary the templates
 * declare (`Critical` / `Warning`); project incident and alert severities are
 * user-defined rows with an `order`. This maps one onto the other, and it is
 * the fix for a real mis-signal: `MonitorRecommendationArgs` carries a single
 * `defaultIncidentSeverityId`, which the UI fills with the project's
 * FIRST severity, so a Warning-severity recommendation like "Deployment
 * Replica Mismatch" opened a Critical Incident exactly like "Node Not Ready"
 * did. Everything paged at the same level and the severity column stopped
 * meaning anything.
 *
 * Both members are optional so a partially-configured project (one severity
 * only) still produces a usable mapping — see
 * `MonitorRecommendationSeverityMapper.getDefaultSeverityMapping`.
 */
export type MonitorRecommendationSeverityMap = {
  [key in MonitorRecommendationSeverity]?: ObjectID | undefined;
};

/*
 * What the user chose in the create form, applied to every criteria instance
 * of every monitor being created.
 *
 * `onCallPolicyIds` is the field that fixes the long-standing gap where every
 * shipped template hardcodes `onCallPolicyIds: []` — a template-created
 * monitor could fire an incident that paged nobody. See
 * `MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep`.
 */
export interface MonitorRecommendationNotificationSettings {
  /*
   * Undefined means "leave the templates alone", which is both-incident-and-
   * alert. Kept as a distinct state from an explicit `Both` so that callers
   * that never learned about this field (older tests, any future programmatic
   * caller) keep their previous behaviour rather than silently acquiring a
   * default someone else picked.
   */
  notificationMode?: MonitorRecommendationNotificationMode | undefined;
  onCallPolicyIds?: Array<ObjectID> | undefined;
  ownerTeamIds?: Array<ObjectID> | undefined;
  ownerUserIds?: Array<ObjectID> | undefined;
  labelIds?: Array<ObjectID> | undefined;
  /*
   * Severity per recommendation severity. Takes precedence over the template's
   * own choice. A missing entry for a given severity leaves that
   * recommendation on whatever the template picked.
   */
  incidentSeverityIdBySeverity?: MonitorRecommendationSeverityMap | undefined;
  alertSeverityIdBySeverity?: MonitorRecommendationSeverityMap | undefined;
}
