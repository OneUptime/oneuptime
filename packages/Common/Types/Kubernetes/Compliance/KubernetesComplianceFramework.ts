/*
 * THE FRAMEWORKS A KUBERNETES CLUSTER ITSELF IS SCORED AGAINST (#9627): the
 * Pod Security Standards' two policies, the CIS Kubernetes Benchmark and the
 * NSA/CISA Kubernetes Hardening Guide (#9875). Each value is the name a
 * framework's tile prints, and the key a compliance setting stores
 * (DataSecurityComplianceSetting.framework), so none changes once released.
 * Kept apart from the catalog, so the settings model reads the names without
 * the evaluators.
 */
export enum KubernetesComplianceFramework {
  PssBaseline = "PSS Baseline",
  PssRestricted = "PSS Restricted",
  CisKubernetes = "CIS Kubernetes",
  NsaCisaHardening = "NSA/CISA Hardening",
}

export const ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS: ReadonlyArray<KubernetesComplianceFramework> =
  [
    KubernetesComplianceFramework.PssBaseline,
    KubernetesComplianceFramework.PssRestricted,
    KubernetesComplianceFramework.CisKubernetes,
    KubernetesComplianceFramework.NsaCisaHardening,
  ];

export function isKubernetesComplianceFramework(
  value: unknown,
): value is KubernetesComplianceFramework {
  return (
    typeof value === "string" &&
    (ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS as ReadonlyArray<string>).includes(
      value,
    )
  );
}

/*
 * A namespace's name as Kubernetes allows one (an RFC 1123 label): what a
 * setting that names a namespace may hold.
 */
const NAMESPACE_NAME: RegExp = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function isKubernetesNamespaceName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 63 &&
    NAMESPACE_NAME.test(value)
  );
}

/*
 * THE OBJECTS A FINDING NAMES (#9874), and so the objects a finding can be
 * accepted for: a workload a pod control fails - a Deployment, StatefulSet,
 * DaemonSet, ReplicaSet, Job, CronJob, DeploymentConfig, or the pod itself
 * when nothing owns it - the roles, bindings, service accounts and
 * namespaces the CIS benchmark's other controls fail, and the nodes its
 * node and control plane controls fail, as kube-bench reads them (#9873). As
 * Kubernetes names each kind; an accepted finding stores it as written.
 */
export const KUBERNETES_COMPLIANCE_OBJECT_KINDS: ReadonlyArray<string> = [
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
  "Pod",
  "Role",
  "ClusterRole",
  "RoleBinding",
  "ClusterRoleBinding",
  "ServiceAccount",
  "Namespace",
  "Node",
];

// The kinds no namespace holds: a finding names them with none.
export const CLUSTER_SCOPED_COMPLIANCE_OBJECT_KINDS: ReadonlyArray<string> = [
  "ClusterRole",
  "ClusterRoleBinding",
  "Node",
];

export function isKubernetesComplianceObjectKind(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    KUBERNETES_COMPLIANCE_OBJECT_KINDS.includes(value)
  );
}

export function isClusterScopedComplianceObjectKind(kind: string): boolean {
  return CLUSTER_SCOPED_COMPLIANCE_OBJECT_KINDS.includes(kind);
}

// The longest name Kubernetes gives an object (a DNS subdomain).
export const KUBERNETES_OBJECT_NAME_MAX_LENGTH: number = 253;

/*
 * An object's name as Kubernetes allows one: at most 253 characters, none
 * of them a slash, a space or a control character, and never "." or "..".
 * Looser than a DNS name on purpose: a role or a binding may be named
 * "system:node-proxier".
 */
const SLASH_OR_SPACE: RegExp = /[\s/]/;

function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 32 || code === 127) {
      return true;
    }
  }

  return false;
}

export function isKubernetesObjectName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= KUBERNETES_OBJECT_NAME_MAX_LENGTH &&
    value !== "." &&
    value !== ".." &&
    !SLASH_OR_SPACE.test(value) &&
    !hasControlCharacter(value)
  );
}

/*
 * Whether an accepted finding still holds (#9874): until its expiry, when it
 * has one. Once that passes the finding fails again, as it did before it was
 * accepted; the acceptance stays listed, expired, until it is accepted again
 * or revoked.
 */
export function isKubernetesAcceptanceInForce(
  expiresAt: Date | string | null | undefined,
  now: Date,
): boolean {
  if (!expiresAt) {
    return true;
  }

  const time: number = new Date(expiresAt).getTime();

  return Number.isNaN(time) || time > now.getTime();
}
