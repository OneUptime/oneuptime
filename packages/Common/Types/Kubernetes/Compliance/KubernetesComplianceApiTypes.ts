import { DataSecurityComplianceTurnedOff } from "../../DataSecurity/DataSecurityApiTypes";
import { KubernetesComplianceObject } from "./KubernetesComplianceFinding";
import { KubernetesComplianceFramework } from "./KubernetesComplianceFramework";
import { KubernetesComplianceFrameworkResult } from "./KubernetesComplianceScoring";

/*
 * WHAT A CLUSTER'S COMPLIANCE ROUTE ANSWERS (#9627): how the cluster itself
 * stands against the Pod Security Standards and the CIS Kubernetes
 * Benchmark, worked out when it is asked from what the inventory holds.
 * The server (KubernetesResourceAPI) builds it and the cluster's Compliance
 * page reads it, from this one definition.
 */

// POST, with the cluster's id: read by whoever may read the cluster.
export function getKubernetesComplianceRoute(clusterId: string): string {
  return `/kubernetes-resource/compliance/${clusterId}`;
}

/*
 * What is turned off of a framework, and why: the whole framework or one
 * control, for the cluster or one namespace, with who turned it off and
 * when - as every Compliance page says it (#9629).
 */
export interface KubernetesComplianceTurnedOff
  extends DataSecurityComplianceTurnedOff {
  framework: KubernetesComplianceFramework;
  // The namespace it is for; null for the whole cluster.
  namespace: string | null;
}

/*
 * A finding accepted for one object (#9874): the object a control - or every
 * control of the framework - fails, why that is accepted, who accepted it and
 * when, and until when. Listed whether or not the object fails anything now,
 * so an acceptance whose workload was fixed or is gone, and one that expired
 * and fails again, can still be read and revoked.
 */
export interface KubernetesComplianceAcceptanceEntry {
  // The setting that accepts it (DataSecurityComplianceSetting).
  id: string;
  framework: KubernetesComplianceFramework;
  // The control it is for; null for every control of the framework.
  requirement: string | null;
  object: KubernetesComplianceObject;
  // Why it is accepted, as written.
  note: string;
  // When it was accepted, and by whom; null when not known, or an API key's.
  acceptedAt: string | null;
  acceptedBy: string | null;
  // When it fails again; null when it stays accepted until revoked.
  expiresAt: string | null;
  // Its expiry has passed: the finding fails again.
  isExpired: boolean;
  /*
   * Its object is on the cluster now. One that is not - deleted, renamed -
   * accepts nothing until an object of that kind and name comes back.
   */
  isOnCluster: boolean;
}

export interface KubernetesComplianceFrameworkResponse
  extends KubernetesComplianceFrameworkResult {
  // What is turned off of it, the latest first.
  turnedOff: Array<KubernetesComplianceTurnedOff>;
  /*
   * The findings accepted for one object (#9874), the latest first, expired
   * ones too. Absent from an older server's answer.
   */
  acceptances?: Array<KubernetesComplianceAcceptanceEntry> | undefined;
}

/*
 * One node kube-bench ran on (#9873): its newest run's benchmark, the
 * targets it checked there, when it finished, and why it could not, when it
 * could not.
 */
export interface KubernetesComplianceNodeBenchmarkNode {
  node: string;
  benchmark: string;
  targets: Array<string>;
  finishedAt: string | null;
  // It read the control plane: kube-bench found the API server on the node.
  isControlPlane: boolean;
  // Why its newest run could not finish; null for one that did.
  error: string | null;
}

/*
 * What kube-bench read of the cluster's nodes (#9873): the benchmark of the
 * runs scored, each node's newest run, and the controls the benchmark marks
 * manual, which are listed, never scored.
 */
export interface KubernetesComplianceNodeBenchmark {
  // "cis-1.12", "eks-1.8.0".
  benchmark: string;
  // "cis", "eks", "gke" or "aks".
  family: string;
  nodes: Array<KubernetesComplianceNodeBenchmarkNode>;
  // The requirements of the controls the benchmark marks manual: "1.2.1", "EKS 2.1.1".
  manual: Array<string>;
  /*
   * The benchmark the cluster's platform has one of its own, when kube-bench
   * ran the generic one there: "eks-1.8.0" on EKS.
   */
  suggestedBenchmark: string | null;
}

// A namespace that runs pods, and the Pod Security Admission levels it says.
export interface KubernetesComplianceNamespace {
  name: string;
  podCount: number;
  enforce: string | null;
  audit: string | null;
  warn: string | null;
}

export interface KubernetesComplianceResponse {
  clusterId: string;
  // The cluster's Kubernetes version, from its nodes: "1.31"; null when none reported one.
  kubernetesVersion: string | null;
  // The Pod Security Standards version the cluster is scored against.
  standardVersion: string;
  // The cluster's platform: "EKS", "OpenShift"...; null when not known.
  provider: string | null;
  // A managed platform runs the control plane, so its controls are the provider's.
  isManagedControlPlane: boolean;
  podCount: number;
  // Of them, the pods whose security fields were read.
  podsRead: number;
  /*
   * Workloads that run no pod now, read from their pod templates (#9880).
   * Absent from an older server's answer.
   */
  templateCount?: number | undefined;
  // Whether the agent sends RBAC, service accounts and network policies.
  hasPolicyObjects: boolean;
  // A policy engine the cluster runs, by name, for CIS 5.2.1.
  policyEngine: string | null;
  // More pods than one answer reads: the first ones were scored.
  isTruncated: boolean;
  namespaces: Array<KubernetesComplianceNamespace>;
  /*
   * What kube-bench read of the nodes (#9873); null when it does not run, and
   * absent from an older server's answer.
   */
  nodeBenchmark?: KubernetesComplianceNodeBenchmark | null | undefined;
  frameworks: Array<KubernetesComplianceFrameworkResponse>;
}
