import { JSONObject } from "../JSON";
import { KubernetesCondition } from "./KubernetesObjectParser";
import {
  OpenShiftClusterOperatorObject,
  OpenShiftClusterVersionObject,
  OpenShiftKind,
  OpenShiftOperandVersion,
  OpenShiftResourceType,
  getClusterOperatorState,
  getClusterVersionState,
  getConditionStatus,
  parseClusterOperatorObject,
  parseClusterVersionObject,
} from "./OpenShiftObjectParser";

/*
 * ------------------------------------------------------------------
 * The attributes ingest stamps on the log record of a ClusterOperator or
 * ClusterVersion the kubernetes-agent chart's openshift preset pulls, as
 * getKubernetesEventLogAttributes does for Kubernetes Events.
 *
 * A Kubernetes monitor reads metrics, and nothing sends metrics for these
 * objects' conditions. Their snapshots do arrive every pull interval, as
 * log records, so the OpenShift alert templates are Logs monitors that
 * count the records whose attributes say something is wrong: an operator
 * Degraded or not Available, or the cluster's update Failing.
 *
 * These keys are stored in customers' logs and in the filters and group-by
 * lists of their monitors: never rename one.
 * ------------------------------------------------------------------
 */
export enum OpenShiftObjectAttribute {
  // The record's resource type, as the k8sobjects receiver names it.
  ResourceName = "k8s.resource.name",
  // The object, as the Kubernetes Event attributes name the one they are about.
  ObjectKind = "k8s.object.kind",
  ObjectName = "k8s.object.name",
  // One word for its condition (getClusterOperatorState / getClusterVersionState).
  State = "openshift.state",
  // Its conditions' statuses - True, False or Unknown - when it reports them.
  Available = "openshift.condition.available",
  Degraded = "openshift.condition.degraded",
  Progressing = "openshift.condition.progressing",
  Upgradeable = "openshift.condition.upgradeable",
  Failing = "openshift.condition.failing",
  /*
   * The version it runs, and for the cluster the version it moves to: an
   * operator's own ("operator" in status.versions), the cluster's newest
   * Completed update.
   */
  CurrentVersion = "openshift.version.current",
  DesiredVersion = "openshift.version.desired",
}

// The resource types whose records are stamped.
export const OPENSHIFT_STATUS_RESOURCE_TYPES: ReadonlyArray<string> = [
  OpenShiftResourceType.ClusterOperators,
  OpenShiftResourceType.ClusterVersions,
];

// The record's resource type, lowercase and trimmed, or "".
function resourceTypeOf(
  attributes: Record<string, unknown> | null | undefined,
): string {
  if (!attributes || typeof attributes !== "object") {
    return "";
  }
  const resourceName: unknown =
    attributes[OpenShiftObjectAttribute.ResourceName];
  return typeof resourceName === "string"
    ? resourceName.trim().toLowerCase()
    : "";
}

// Whether a log record is a pulled ClusterOperator or ClusterVersion.
export function isOpenShiftStatusLogRecord(
  attributes: Record<string, unknown> | null | undefined,
): boolean {
  return OPENSHIFT_STATUS_RESOURCE_TYPES.includes(resourceTypeOf(attributes));
}

function conditionAttributes(
  conditions: ReadonlyArray<KubernetesCondition>,
  attributeByType: ReadonlyArray<[string, OpenShiftObjectAttribute]>,
): Record<string, string> {
  const stamped: Record<string, string> = {};
  for (const [type, attribute] of attributeByType) {
    const status: string = getConditionStatus(conditions, type);
    if (status) {
      stamped[attribute] = status;
    }
  }
  return stamped;
}

function withoutEmpty(values: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of Object.keys(values)) {
    if (values[key]) {
      kept[key] = values[key] as string;
    }
  }
  return kept;
}

/*
 * The attributes a ClusterOperator's or ClusterVersion's record is stamped
 * with, from the object the record carries (extractObjectFromLogBody). An
 * object that does not parse, or a record of another resource type, gets
 * none: its record is stored as it came.
 */
export function getOpenShiftStatusLogAttributes(data: {
  attributes: Record<string, unknown> | null | undefined;
  objectKvList: JSONObject | null;
}): Record<string, string> {
  if (!data.objectKvList) {
    return {};
  }

  const resourceType: string = resourceTypeOf(data.attributes);

  if (resourceType === OpenShiftResourceType.ClusterOperators) {
    const operator: OpenShiftClusterOperatorObject | null =
      parseClusterOperatorObject(data.objectKvList);

    if (!operator || !operator.metadata.name) {
      return {};
    }

    const ownVersion: string =
      operator.status.versions.find(
        (version: OpenShiftOperandVersion): boolean => {
          return version.name === "operator";
        },
      )?.version || "";

    return withoutEmpty({
      [OpenShiftObjectAttribute.ObjectKind]: OpenShiftKind.ClusterOperator,
      [OpenShiftObjectAttribute.ObjectName]: operator.metadata.name,
      [OpenShiftObjectAttribute.State]: getClusterOperatorState(
        operator.status.conditions,
      ),
      [OpenShiftObjectAttribute.CurrentVersion]: ownVersion,
      ...conditionAttributes(operator.status.conditions, [
        ["Available", OpenShiftObjectAttribute.Available],
        ["Degraded", OpenShiftObjectAttribute.Degraded],
        ["Progressing", OpenShiftObjectAttribute.Progressing],
        ["Upgradeable", OpenShiftObjectAttribute.Upgradeable],
      ]),
    });
  }

  if (resourceType === OpenShiftResourceType.ClusterVersions) {
    const clusterVersion: OpenShiftClusterVersionObject | null =
      parseClusterVersionObject(data.objectKvList);

    if (!clusterVersion || !clusterVersion.metadata.name) {
      return {};
    }

    return withoutEmpty({
      [OpenShiftObjectAttribute.ObjectKind]: OpenShiftKind.ClusterVersion,
      [OpenShiftObjectAttribute.ObjectName]: clusterVersion.metadata.name,
      [OpenShiftObjectAttribute.State]: getClusterVersionState(
        clusterVersion.status.conditions,
      ),
      [OpenShiftObjectAttribute.CurrentVersion]:
        clusterVersion.status.currentVersion,
      [OpenShiftObjectAttribute.DesiredVersion]:
        clusterVersion.status.desiredVersion,
      ...conditionAttributes(clusterVersion.status.conditions, [
        ["Available", OpenShiftObjectAttribute.Available],
        ["Failing", OpenShiftObjectAttribute.Failing],
        ["Progressing", OpenShiftObjectAttribute.Progressing],
        ["Upgradeable", OpenShiftObjectAttribute.Upgradeable],
      ]),
    });
  }

  return {};
}
