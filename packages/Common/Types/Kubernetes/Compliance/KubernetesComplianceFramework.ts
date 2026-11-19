/*
 * THE FRAMEWORKS A KUBERNETES CLUSTER ITSELF IS SCORED AGAINST (#9627): the
 * Pod Security Standards' two policies and the CIS Kubernetes Benchmark.
 * Each value is the name a framework's tile prints, and the key a
 * compliance setting stores (DataSecurityComplianceSetting.framework), so
 * none changes once released. Kept apart from the catalog, so the settings
 * model reads the names without the evaluators.
 */
export enum KubernetesComplianceFramework {
  PssBaseline = "PSS Baseline",
  PssRestricted = "PSS Restricted",
  CisKubernetes = "CIS Kubernetes",
}

export const ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS: ReadonlyArray<KubernetesComplianceFramework> =
  [
    KubernetesComplianceFramework.PssBaseline,
    KubernetesComplianceFramework.PssRestricted,
    KubernetesComplianceFramework.CisKubernetes,
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
