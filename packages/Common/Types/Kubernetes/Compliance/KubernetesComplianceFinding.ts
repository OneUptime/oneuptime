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

export interface KubernetesComplianceFinding {
  object: KubernetesComplianceObject;
  details: Array<KubernetesComplianceDetail>;
  // A workload's pods that fail the control, when it is a workload's.
  podCount?: number | undefined;
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
