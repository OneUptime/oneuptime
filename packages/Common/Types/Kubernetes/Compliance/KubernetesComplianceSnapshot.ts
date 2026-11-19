import { PodSecurity } from "../KubernetesPodSecurity";
import {
  KubernetesNetworkPolicySpec,
  KubernetesServiceAccountSpec,
} from "../KubernetesPolicyObjects";
import { KubernetesComplianceObject } from "./KubernetesComplianceFinding";
import {
  KubernetesComplianceBinding,
  KubernetesComplianceRole,
} from "./KubernetesRbac";
import { KubernetesVersion } from "./KubernetesVersion";

/*
 * ONE CLUSTER, AS ITS COMPLIANCE IS SCORED (#9627): what the inventory holds
 * of it - its pods with what each says about its security, its namespaces
 * and their Pod Security Admission labels, and, when the agent reads them,
 * its RBAC, service accounts and network policies. The server reads it from
 * the inventory; the scoring and its tests only read this.
 */

export interface KubernetesCompliancePod {
  namespace: string;
  name: string;
  // The workload the pod belongs to, or the pod itself when nothing does.
  workload: KubernetesComplianceObject;
  serviceAccountName: string;
  // What it says about its own security; null for a pod stored before it was kept.
  security: PodSecurity | null;
  // Its containers' images, to tell a policy engine's pods.
  images: Array<string>;
}

export interface KubernetesComplianceNamespace {
  name: string;
  labels: Record<string, string>;
}

export interface KubernetesComplianceServiceAccount {
  namespace: string;
  name: string;
  spec: KubernetesServiceAccountSpec;
}

export interface KubernetesComplianceNetworkPolicy {
  namespace: string;
  name: string;
  spec: KubernetesNetworkPolicySpec | null;
}

export interface KubernetesComplianceSnapshot {
  // The Pod Security Standards version the cluster is scored against.
  version: KubernetesVersion;
  // The cluster's platform, as the cluster's page names it: "EKS", "OpenShift"...
  provider: string | null;
  pods: Array<KubernetesCompliancePod>;
  namespaces: Array<KubernetesComplianceNamespace>;
  roles: Array<KubernetesComplianceRole>;
  bindings: Array<KubernetesComplianceBinding>;
  serviceAccounts: Array<KubernetesComplianceServiceAccount>;
  networkPolicies: Array<KubernetesComplianceNetworkPolicy>;
  /*
   * Whether the agent sends RBAC, service accounts and network policies
   * (the chart's resourceSpecs.compliance): every cluster has ClusterRoles,
   * so a cluster whose inventory holds none has an agent that does not.
   */
  hasPolicyObjects: boolean;
}

// The namespaces that run pods: the ones the namespace controls look at.
export function getNamespacesWithPods(
  snapshot: Pick<KubernetesComplianceSnapshot, "pods">,
): Array<string> {
  const names: Set<string> = new Set<string>();

  for (const pod of snapshot.pods) {
    if (pod.namespace) {
      names.add(pod.namespace);
    }
  }

  return Array.from(names).sort();
}
