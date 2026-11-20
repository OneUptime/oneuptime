import {
  OneUptimeAgentInstall,
  OneUptimeAgentNodesProxyReason,
} from "./KubernetesRbac";

/*
 * WHAT A COMPLIANCE CONTROL FOUND ON A CLUSTER (#9627), in the words of the
 * objects themselves: the field a workload sets and what it sets it to, the
 * role a binding grants, the namespace with no NetworkPolicy. Field paths
 * and values are Kubernetes' own, drawn as code in every language; only the
 * control's own explanation and fix are worded (KubernetesComplianceCatalog).
 */

// One thing found wrong: a field of the object, of one of its containers or volumes.
export interface KubernetesComplianceDetail {
  container?: string | undefined;
  volume?: string | undefined;
  // The field, as Kubernetes names it from the object or the part: "securityContext.privileged".
  field: string;
  // What it is set to, as written: "true", "NET_ADMIN, SYS_ADMIN", "/var/log".
  value?: string | undefined;
  // The field is not set where the control needs it set.
  isNotSet?: boolean | undefined;
}

// The object a control failed on: a workload, a pod, a namespace, a role, a binding.
export interface KubernetesComplianceObject {
  kind: string;
  // "" for a cluster-wide object.
  namespace: string;
  name: string;
}

/*
 * A binding the OneUptime agent's chart made (#9878): the page says so, and
 * why the agent asks for what the control finds.
 */
export interface KubernetesComplianceAgentObject {
  /*
   * Why its role grants nodes/proxy, as the chart labels it
   * (OneUptimeAgentNodesProxyReason): empty from a chart before the label,
   * which grants it on every cluster.
   */
  nodesProxyReasons: Array<OneUptimeAgentNodesProxyReason>;
  /*
   * How it was installed, as its role's label says (#9928): the Amazon EKS
   * add-on's buyer drops nodes/proxy with the add-on's configuration
   * values, not with Helm. Not there from a server before it: Helm.
   */
  installedAs?: OneUptimeAgentInstall | undefined;
}

export interface KubernetesComplianceFinding {
  object: KubernetesComplianceObject;
  details: Array<KubernetesComplianceDetail>;
  // A workload's pods that fail the control, when it is a workload's.
  podCount?: number | undefined;
  /*
   * Read from the workload's pod template, as no pod of it runs now (#9880):
   * a Deployment scaled to zero, a CronJob between runs, a DaemonSet on no
   * node. Its pods, when it runs some, are read instead.
   */
  isFromTemplate?: boolean | undefined;
  // The OneUptime agent's own binding, when it is one.
  oneUptimeAgent?: KubernetesComplianceAgentObject | undefined;
}

/*
 * A finding someone accepted for its object (#9874): the object still fails
 * the control, as the details say, but it counts as passing, and is listed
 * apart from what fails, under the setting that accepts it.
 */
export interface KubernetesComplianceAcceptedFinding
  extends KubernetesComplianceFinding {
  // The setting that accepts it (DataSecurityComplianceSetting), revoked by its id.
  acceptanceId: string;
}

// A detail's own key, so the same field of the same part is said once.
export function getComplianceDetailKey(
  detail: KubernetesComplianceDetail,
): string {
  return [
    detail.container || "",
    detail.volume || "",
    detail.field,
    detail.value || "",
    detail.isNotSet ? "unset" : "",
  ].join("|");
}

export function getComplianceObjectKey(
  object: KubernetesComplianceObject,
): string {
  return `${object.kind}|${object.namespace}|${object.name}`;
}
