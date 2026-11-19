import { PodSecurity } from "../KubernetesPodSecurity";
import {
  KubernetesNetworkPolicySpec,
  KubernetesServiceAccountSpec,
} from "../KubernetesPolicyObjects";
import {
  KubernetesComplianceObject,
  getComplianceObjectKey,
} from "./KubernetesComplianceFinding";
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

/*
 * A workload's pod template (#9880): what the pods it would run say about
 * their security. Scored only while no pod of the workload runs - a
 * Deployment or StatefulSet scaled to zero, a CronJob between runs, a
 * DaemonSet that matches no node - as the pods it runs are what was
 * admitted, and differ from the template while a rollout is under way.
 */
export interface KubernetesComplianceTemplate {
  /*
   * The workload: a Deployment, StatefulSet, DaemonSet, ReplicaSet nothing
   * owns, Job no CronJob runs, CronJob or DeploymentConfig.
   */
  workload: KubernetesComplianceObject;
  // What its pods would say; null for one stored before it was kept.
  security: PodSecurity | null;
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
  /*
   * The cluster's workloads' pod templates (#9880). One whose workload runs
   * a pod is not scored: its pods are. Absent from a snapshot read before
   * templates were kept.
   */
  templates?: Array<KubernetesComplianceTemplate> | undefined;
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

/*
 * The pod templates scored (#9880): those of the workloads no pod of the
 * snapshot belongs to. A workload with pods - read or not yet read - is
 * scored by its pods: they are what Kubernetes admitted, mutating webhooks
 * and all, and a rollout under way runs some on the old template.
 */
export function getTemplatesToScore(
  snapshot: Pick<KubernetesComplianceSnapshot, "pods" | "templates">,
): Array<KubernetesComplianceTemplate> {
  const running: Set<string> = new Set<string>(
    snapshot.pods.map((pod: KubernetesCompliancePod): string => {
      return getComplianceObjectKey(pod.workload);
    }),
  );
  const seen: Set<string> = new Set<string>();

  return (snapshot.templates || []).filter(
    (template: KubernetesComplianceTemplate): boolean => {
      const key: string = getComplianceObjectKey(template.workload);

      if (running.has(key) || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    },
  );
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
