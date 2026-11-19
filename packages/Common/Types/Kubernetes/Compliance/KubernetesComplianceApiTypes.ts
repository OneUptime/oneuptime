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
  frameworks: Array<KubernetesComplianceFrameworkResponse>;
}
