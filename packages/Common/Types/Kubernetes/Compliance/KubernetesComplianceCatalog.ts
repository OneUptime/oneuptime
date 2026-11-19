import { CIS_SCORED_CONTROLS } from "./CisKubernetesBenchmark";
import {
  BASELINE_CONTROLS,
  PodSecurityControl,
  RESTRICTED_ONLY_CONTROLS,
} from "./PodSecurityStandards";

/*
 * THE FRAMEWORKS A KUBERNETES CLUSTER IS SCORED AGAINST (#9627), BESIDE THE
 * DATA FRAMEWORKS ITS DATABASES ARE.
 *
 * A cluster's Compliance page scores the cluster itself against the Pod
 * Security Standards' Baseline and Restricted policies and the CIS
 * Kubernetes Benchmark, with the tiles, requirement table, Applies Here
 * switches and exports the data frameworks have. Each control here has its
 * short title, what it finds wrong, and how to fix that, in a sentence each.
 *
 * The Pod Security Standards are Kubernetes' own, published under CC BY 4.0:
 * each control keeps the standard's name. The CIS Kubernetes Benchmark is
 * CIS's, whose text is not reproduced: each control is named by its number
 * in the benchmark and a short title of OneUptime's own, and the sentences
 * are OneUptime's too.
 *
 * A framework's value is the name the page prints on its tile, and the key
 * a compliance setting stores (DataSecurityComplianceSetting.framework); a
 * control's is the requirement a setting stores. Neither changes once
 * released. Only the words the file marks are translated (the Dashboard's
 * i18n reads this file for them); field names and values are Kubernetes'.
 */

// Marks a string as a key of the Dashboard's locales, as TranslateTemplate's translationKey does.
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

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

export interface KubernetesComplianceFrameworkInfo {
  framework: KubernetesComplianceFramework;
  fullName: string;
  // What it is scored over, in a sentence.
  scope: string;
}

export const KUBERNETES_COMPLIANCE_FRAMEWORK_INFO: Readonly<
  Record<KubernetesComplianceFramework, KubernetesComplianceFrameworkInfo>
> = {
  [KubernetesComplianceFramework.PssBaseline]: {
    framework: KubernetesComplianceFramework.PssBaseline,
    fullName: translationKey("Pod Security Standards: Baseline"),
    scope: translationKey(
      "Every workload running on the cluster, against the Baseline policy of its Kubernetes version.",
    ),
  },
  [KubernetesComplianceFramework.PssRestricted]: {
    framework: KubernetesComplianceFramework.PssRestricted,
    fullName: translationKey("Pod Security Standards: Restricted"),
    scope: translationKey(
      "Every workload running on the cluster, against the Restricted policy of its Kubernetes version.",
    ),
  },
  [KubernetesComplianceFramework.CisKubernetes]: {
    framework: KubernetesComplianceFramework.CisKubernetes,
    fullName: translationKey("CIS Kubernetes Benchmark v2.0"),
    scope: translationKey(
      "The policy controls the Kubernetes API shows. Node and control plane controls are listed, not scored.",
    ),
  },
};

/*
 * ---------------------------------------------------------------------------
 * Controls
 * ---------------------------------------------------------------------------
 */

export interface KubernetesComplianceControlInfo {
  framework: KubernetesComplianceFramework;
  // The control's key: its name in the standard, or its number in the benchmark.
  requirement: string;
  // Whether the requirement is a number to draw as code (the benchmark's).
  isNumbered: boolean;
  title: string;
  // What it finds wrong, in a sentence.
  description: string;
  // How to fix it, in a sentence.
  fix: string;
}

interface ControlWords {
  title: string;
  description: string;
  fix: string;
}

// Each Pod Security Standards control: its name is its title.
const POD_SECURITY_WORDS: Readonly<Record<PodSecurityControl, ControlWords>> = {
  [PodSecurityControl.HostProcess]: {
    title: translationKey("HostProcess"),
    description: translationKey(
      "Windows pods must not run HostProcess containers, which have privileged access to the Windows host.",
    ),
    fix: translationKey(
      "Remove windowsOptions.hostProcess from the pod and its containers, or set it to false.",
    ),
  },
  [PodSecurityControl.HostNamespaces]: {
    title: translationKey("Host Namespaces"),
    description: translationKey(
      "Pods must not share the node's network, process or IPC namespace.",
    ),
    fix: translationKey(
      "Remove hostNetwork, hostPID and hostIPC from the pod, or set them to false.",
    ),
  },
  [PodSecurityControl.PrivilegedContainers]: {
    title: translationKey("Privileged Containers"),
    description: translationKey(
      "Containers must not run privileged: a privileged container turns off most of its isolation from the node.",
    ),
    fix: translationKey(
      "Remove securityContext.privileged, or set it to false, and add only the capabilities the container needs.",
    ),
  },
  [PodSecurityControl.Capabilities]: {
    title: translationKey("Capabilities"),
    description: translationKey(
      "Containers may add only the capabilities the Baseline policy lists, such as NET_BIND_SERVICE or CHOWN.",
    ),
    fix: translationKey(
      "Remove the other capabilities from securityContext.capabilities.add.",
    ),
  },
  [PodSecurityControl.HostPathVolumes]: {
    title: translationKey("HostPath Volumes"),
    description: translationKey(
      "Pods must not mount directories of the node with hostPath volumes.",
    ),
    fix: translationKey(
      "Use a PersistentVolumeClaim, an emptyDir, a ConfigMap or a CSI volume instead.",
    ),
  },
  [PodSecurityControl.HostPorts]: {
    title: translationKey("Host Ports"),
    description: translationKey("Containers must not bind ports on the node."),
    fix: translationKey(
      "Remove hostPort, and reach the pod through a Service.",
    ),
  },
  [PodSecurityControl.HostProbes]: {
    title: translationKey("Host Probes / Lifecycle Hooks"),
    description: translationKey(
      "Probes and lifecycle hooks must not name a host, which could reach other machines from the node.",
    ),
    fix: translationKey(
      "Remove host from the httpGet and tcpSocket probes and hooks, so they reach the pod itself.",
    ),
  },
  [PodSecurityControl.AppArmor]: {
    title: translationKey("AppArmor"),
    description: translationKey(
      "Pods must not turn off the default AppArmor profile, or override it with an unconfined one.",
    ),
    fix: translationKey(
      "Set appArmorProfile.type to RuntimeDefault or Localhost, or remove it.",
    ),
  },
  [PodSecurityControl.SELinux]: {
    title: translationKey("SELinux"),
    description: translationKey(
      "Pods must not set an SELinux user or role, or a type other than container_t, container_init_t, container_kvm_t or container_engine_t.",
    ),
    fix: translationKey(
      "Remove seLinuxOptions.user and seLinuxOptions.role, and use one of the allowed types or none.",
    ),
  },
  [PodSecurityControl.ProcMount]: {
    title: translationKey("/proc Mount Type"),
    description: translationKey(
      "Containers must keep the default masks on /proc.",
    ),
    fix: translationKey(
      "Remove securityContext.procMount, or set it to Default.",
    ),
  },
  [PodSecurityControl.Seccomp]: {
    title: translationKey("Seccomp"),
    description: translationKey(
      "Pods must not set the seccomp profile to Unconfined.",
    ),
    fix: translationKey(
      "Set seccompProfile.type to RuntimeDefault or Localhost, or remove it.",
    ),
  },
  [PodSecurityControl.Sysctls]: {
    title: translationKey("Sysctls"),
    description: translationKey(
      "Pods may set only the safe sysctls, which are isolated from the other pods on the node.",
    ),
    fix: translationKey(
      "Remove the other sysctls from securityContext.sysctls.",
    ),
  },
  [PodSecurityControl.VolumeTypes]: {
    title: translationKey("Volume Types"),
    description: translationKey(
      "Pods may use only configMap, csi, downwardAPI, emptyDir, ephemeral, persistentVolumeClaim, projected and secret volumes.",
    ),
    fix: translationKey(
      "Replace each other volume with a PersistentVolumeClaim or a CSI volume.",
    ),
  },
  [PodSecurityControl.PrivilegeEscalation]: {
    title: translationKey("Privilege Escalation"),
    description: translationKey(
      "Containers must set allowPrivilegeEscalation to false, so no process gains more privileges than its parent.",
    ),
    fix: translationKey(
      "Set securityContext.allowPrivilegeEscalation: false on every container.",
    ),
  },
  [PodSecurityControl.RunningAsNonRoot]: {
    title: translationKey("Running as Non-root"),
    description: translationKey(
      "Containers must be required to run as a user other than root.",
    ),
    fix: translationKey(
      "Set securityContext.runAsNonRoot: true on the pod, or on every container.",
    ),
  },
  [PodSecurityControl.RunningAsNonRootUser]: {
    title: translationKey("Running as Non-root user"),
    description: translationKey("Containers must not run as user 0."),
    fix: translationKey(
      "Set securityContext.runAsUser to a user other than 0, or remove it.",
    ),
  },
  [PodSecurityControl.SeccompRestricted]: {
    title: translationKey("Seccomp (Restricted)"),
    description: translationKey(
      "Every container must run with the RuntimeDefault or a Localhost seccomp profile.",
    ),
    fix: translationKey(
      "Set securityContext.seccompProfile.type: RuntimeDefault on the pod.",
    ),
  },
  [PodSecurityControl.CapabilitiesRestricted]: {
    title: translationKey("Capabilities (Restricted)"),
    description: translationKey(
      "Containers must drop ALL capabilities, and may add back only NET_BIND_SERVICE.",
    ),
    fix: translationKey(
      "Set securityContext.capabilities.drop: [ALL] on every container, and add NET_BIND_SERVICE only to bind a port under 1024.",
    ),
  },
};

// Each scored CIS control: a short title of OneUptime's own, by its number.
const CIS_WORDS: Readonly<Record<string, ControlWords>> = {
  "5.1.1": {
    title: translationKey("cluster-admin bound only where needed"),
    description: translationKey(
      "Bindings that grant cluster-admin, which can do anything in the cluster.",
    ),
    fix: translationKey(
      "Bind a role that grants only what the subject needs, then delete the binding.",
    ),
  },
  "5.1.2": {
    title: translationKey("Least access to Secrets"),
    description: translationKey(
      "Bindings that let someone read every Secret of a namespace or of the cluster.",
    ),
    fix: translationKey(
      "Name the Secrets the role needs with resourceNames, or remove get, list and watch on secrets.",
    ),
  },
  "5.1.3": {
    title: translationKey("No wildcards in roles"),
    description: translationKey(
      "Roles and ClusterRoles that use * for API groups, resources or verbs.",
    ),
    fix: translationKey(
      "List the API groups, resources and verbs the role needs instead of *.",
    ),
  },
  "5.1.4": {
    title: translationKey("Least access to create pods"),
    description: translationKey(
      "Bindings that let someone create pods, and with them run anything the namespace admits.",
    ),
    fix: translationKey(
      "Remove create on pods from the roles of those who do not start pods themselves.",
    ),
  },
  "5.1.5": {
    title: translationKey("Default service accounts not used"),
    description: translationKey(
      "Default service accounts that mount their token into pods, or that are granted a role.",
    ),
    fix: translationKey(
      "Set automountServiceAccountToken: false on each default service account, and give workloads that call the API a service account of their own.",
    ),
  },
  "5.1.8": {
    title: translationKey("Least use of bind, impersonate and escalate"),
    description: translationKey(
      "Bindings that let someone bind or escalate roles, or impersonate users, groups or service accounts.",
    ),
    fix: translationKey(
      "Remove the bind, escalate and impersonate verbs from the roles of those who do not manage RBAC.",
    ),
  },
  "5.1.9": {
    title: translationKey("Least access to create persistent volumes"),
    description: translationKey(
      "Bindings that let someone create persistent volumes, which can mount any path of a node.",
    ),
    fix: translationKey(
      "Let workloads use PersistentVolumeClaims, and leave creating PersistentVolumes to administrators.",
    ),
  },
  "5.1.10": {
    title: translationKey("Least access to the nodes/proxy subresource"),
    description: translationKey(
      "Bindings that grant the nodes/proxy subresource, which reaches each node's kubelet API.",
    ),
    fix: translationKey(
      "Remove nodes/proxy from the role, and read node metrics from the metrics endpoints instead.",
    ),
  },
  "5.1.11": {
    title: translationKey("Least access to approve certificate requests"),
    description: translationKey(
      "Bindings that let someone approve certificate signing requests, and so issue client certificates.",
    ),
    fix: translationKey(
      "Leave approving certificate signing requests to the controller manager and administrators.",
    ),
  },
  "5.1.12": {
    title: translationKey("Least access to webhook configurations"),
    description: translationKey(
      "Bindings that let someone create, change or delete admission webhook configurations.",
    ),
    fix: translationKey(
      "Let only the operator that owns each webhook change its configuration.",
    ),
  },
  "5.1.13": {
    title: translationKey("Least access to create service account tokens"),
    description: translationKey(
      "Bindings that let someone create tokens for service accounts.",
    ),
    fix: translationKey(
      "Remove create on serviceaccounts/token from the roles of those who do not issue tokens.",
    ),
  },
  "5.2.1": {
    title: translationKey("A policy control mechanism in place"),
    description: translationKey(
      "Namespaces that run pods with no Pod Security Admission level enforced, when no policy engine runs.",
    ),
    fix: translationKey(
      "Label each namespace with pod-security.kubernetes.io/enforce: baseline or restricted, or run a policy engine such as Kyverno or Gatekeeper.",
    ),
  },
  "5.2.2": {
    title: translationKey("No privileged containers"),
    description: translationKey("Workloads that run privileged containers."),
    fix: translationKey(
      "Remove securityContext.privileged, or set it to false.",
    ),
  },
  "5.2.3": {
    title: translationKey("No sharing of the host's process namespace"),
    description: translationKey(
      "Workloads that share the node's process namespace.",
    ),
    fix: translationKey("Remove hostPID, or set it to false."),
  },
  "5.2.4": {
    title: translationKey("No sharing of the host's IPC namespace"),
    description: translationKey(
      "Workloads that share the node's IPC namespace.",
    ),
    fix: translationKey("Remove hostIPC, or set it to false."),
  },
  "5.2.5": {
    title: translationKey("No sharing of the host's network namespace"),
    description: translationKey(
      "Workloads that share the node's network namespace.",
    ),
    fix: translationKey(
      "Remove hostNetwork, or set it to false, and reach the pod through a Service.",
    ),
  },
  "5.2.6": {
    title: translationKey("No privilege escalation"),
    description: translationKey(
      "Containers that may gain more privileges than their parent process.",
    ),
    fix: translationKey(
      "Set securityContext.allowPrivilegeEscalation: false on every container.",
    ),
  },
  "5.2.7": {
    title: translationKey("No root containers"),
    description: translationKey("Containers that may run as root."),
    fix: translationKey(
      "Set securityContext.runAsNonRoot: true, and a user other than 0.",
    ),
  },
  "5.2.8": {
    title: translationKey("No NET_RAW capability"),
    description: translationKey(
      "Containers that keep NET_RAW, which lets them craft packets on the node's network.",
    ),
    fix: translationKey(
      "Add NET_RAW, or ALL, to securityContext.capabilities.drop.",
    ),
  },
  "5.2.9": {
    title: translationKey("No added capabilities"),
    description: translationKey(
      "Containers that do not drop ALL capabilities, or that add some beyond NET_BIND_SERVICE.",
    ),
    fix: translationKey(
      "Set securityContext.capabilities.drop: [ALL], and add back only what the container needs.",
    ),
  },
  "5.2.10": {
    title: translationKey("No Windows HostProcess containers"),
    description: translationKey(
      "Windows pods that run HostProcess containers.",
    ),
    fix: translationKey(
      "Remove windowsOptions.hostProcess, or set it to false.",
    ),
  },
  "5.2.11": {
    title: translationKey("No HostPath volumes"),
    description: translationKey(
      "Workloads that mount directories of the node with hostPath volumes.",
    ),
    fix: translationKey(
      "Use a PersistentVolumeClaim, an emptyDir or a CSI volume instead.",
    ),
  },
  "5.2.12": {
    title: translationKey("No host ports"),
    description: translationKey("Containers that bind ports on the node."),
    fix: translationKey(
      "Remove hostPort, and reach the pod through a Service.",
    ),
  },
  "5.3.2": {
    title: translationKey("NetworkPolicies in every namespace"),
    description: translationKey(
      "Namespaces that run pods with no NetworkPolicy, so anything in the cluster can reach their pods.",
    ),
    fix: translationKey(
      "Add a NetworkPolicy to each namespace, starting with one that denies what is not allowed.",
    ),
  },
  "5.4.1": {
    title: translationKey("Secrets as files, not environment variables"),
    description: translationKey(
      "Containers that read Secrets into environment variables, which logs and crash reports can expose.",
    ),
    fix: translationKey(
      "Mount the Secret as a volume, and read it from the file.",
    ),
  },
  "5.6.2": {
    title: translationKey("A seccomp profile on every pod"),
    description: translationKey("Containers that run with no seccomp profile."),
    fix: translationKey(
      "Set securityContext.seccompProfile.type: RuntimeDefault on the pod.",
    ),
  },
  "5.6.4": {
    title: translationKey("Nothing in the default namespace"),
    description: translationKey("Workloads that run in the default namespace."),
    fix: translationKey("Move each workload to a namespace of its own."),
  },
};

function controlInfo(
  framework: KubernetesComplianceFramework,
  requirement: string,
  words: ControlWords,
  isNumbered: boolean,
): KubernetesComplianceControlInfo {
  return {
    framework,
    requirement,
    isNumbered,
    title: words.title,
    description: words.description,
    fix: words.fix,
  };
}

/*
 * Every control a framework is scored on, in the standard's or the
 * benchmark's order. A Pod Security Standards control a cluster's version
 * does not have yet is left out of that cluster's score
 * (getPodSecurityControls), not of the catalog.
 */
export const KUBERNETES_COMPLIANCE_CONTROLS: ReadonlyArray<KubernetesComplianceControlInfo> =
  [
    ...BASELINE_CONTROLS.map(
      (control: PodSecurityControl): KubernetesComplianceControlInfo => {
        return controlInfo(
          KubernetesComplianceFramework.PssBaseline,
          control,
          POD_SECURITY_WORDS[control],
          false,
        );
      },
    ),
    ...[...BASELINE_CONTROLS, ...RESTRICTED_ONLY_CONTROLS].map(
      (control: PodSecurityControl): KubernetesComplianceControlInfo => {
        return controlInfo(
          KubernetesComplianceFramework.PssRestricted,
          control,
          POD_SECURITY_WORDS[control],
          false,
        );
      },
    ),
    ...Object.keys(CIS_SCORED_CONTROLS).map(
      (id: string): KubernetesComplianceControlInfo => {
        return controlInfo(
          KubernetesComplianceFramework.CisKubernetes,
          id,
          CIS_WORDS[id]!,
          true,
        );
      },
    ),
  ];

export function getKubernetesComplianceControls(
  framework: KubernetesComplianceFramework,
): Array<KubernetesComplianceControlInfo> {
  return KUBERNETES_COMPLIANCE_CONTROLS.filter(
    (control: KubernetesComplianceControlInfo): boolean => {
      return control.framework === framework;
    },
  );
}

export function findKubernetesComplianceControl(
  framework: KubernetesComplianceFramework,
  requirement: string,
): KubernetesComplianceControlInfo | undefined {
  return KUBERNETES_COMPLIANCE_CONTROLS.find(
    (control: KubernetesComplianceControlInfo): boolean => {
      return (
        control.framework === framework && control.requirement === requirement
      );
    },
  );
}

// Whether a requirement is a control the framework is scored on: what a setting may name.
export function isKubernetesComplianceRequirement(
  framework: KubernetesComplianceFramework,
  requirement: string,
): boolean {
  return Boolean(findKubernetesComplianceControl(framework, requirement));
}

/*
 * ---------------------------------------------------------------------------
 * What the CIS Kubernetes Benchmark asks that is not scored here
 * ---------------------------------------------------------------------------
 */

export enum CisNotScoredReason {
  // Files and the kubelet's configuration on each node.
  NodeAccess = "NodeAccess",
  // The API server's, controller manager's, scheduler's and etcd's flags.
  ControlPlaneAccess = "ControlPlaneAccess",
  // A judgement no API answers.
  Manual = "Manual",
}

export const CIS_NOT_SCORED_REASON_WORDS: Readonly<
  Record<CisNotScoredReason, string>
> = {
  [CisNotScoredReason.NodeAccess]: translationKey(
    "Needs access to the nodes: file permissions and the kubelet's configuration.",
  ),
  [CisNotScoredReason.ControlPlaneAccess]: translationKey(
    "Needs access to the control plane: the API server's, controller manager's, scheduler's and etcd's flags.",
  ),
  [CisNotScoredReason.Manual]: translationKey(
    "Needs a person's review: the Kubernetes API cannot answer it.",
  ),
};

export interface CisNotScoredGroup {
  // A section of the benchmark, or one control: "1.2", "5.5.1".
  id: string;
  title: string;
  // How many of the benchmark's controls it holds.
  controlCount: number;
  reason: CisNotScoredReason;
  // Why, for a single control.
  why?: string | undefined;
}

// The benchmark's sections and controls no API answers, in its order.
export const CIS_NOT_SCORED: ReadonlyArray<CisNotScoredGroup> = [
  {
    id: "1.1",
    title: translationKey("Control plane node configuration files"),
    controlCount: 21,
    reason: CisNotScoredReason.NodeAccess,
  },
  {
    id: "1.2",
    title: translationKey("API server"),
    controlCount: 30,
    reason: CisNotScoredReason.ControlPlaneAccess,
  },
  {
    id: "1.3",
    title: translationKey("Controller manager"),
    controlCount: 7,
    reason: CisNotScoredReason.ControlPlaneAccess,
  },
  {
    id: "1.4",
    title: translationKey("Scheduler"),
    controlCount: 2,
    reason: CisNotScoredReason.ControlPlaneAccess,
  },
  {
    id: "2",
    title: translationKey("etcd"),
    controlCount: 7,
    reason: CisNotScoredReason.ControlPlaneAccess,
  },
  {
    id: "3.1",
    title: translationKey("Authentication and authorization"),
    controlCount: 3,
    reason: CisNotScoredReason.ControlPlaneAccess,
  },
  {
    id: "3.2",
    title: translationKey("Logging"),
    controlCount: 2,
    reason: CisNotScoredReason.ControlPlaneAccess,
  },
  {
    id: "4.1",
    title: translationKey("Worker node configuration files"),
    controlCount: 10,
    reason: CisNotScoredReason.NodeAccess,
  },
  {
    id: "4.2",
    title: translationKey("Kubelet"),
    controlCount: 14,
    reason: CisNotScoredReason.NodeAccess,
  },
  {
    id: "4.3",
    title: translationKey("kube-proxy"),
    controlCount: 1,
    reason: CisNotScoredReason.NodeAccess,
  },
  {
    id: "5.1.6",
    title: translationKey("Service account tokens mounted only where needed"),
    controlCount: 1,
    reason: CisNotScoredReason.Manual,
    why: translationKey(
      "Which pods need to call the Kubernetes API is yours to decide: 5.1.5 checks the default service accounts.",
    ),
  },
  {
    id: "5.1.7",
    title: translationKey("No use of the system:masters group"),
    controlCount: 1,
    reason: CisNotScoredReason.Manual,
    why: translationKey(
      "Membership of system:masters comes from client certificates, which the API does not list.",
    ),
  },
  {
    id: "5.3.1",
    title: translationKey("A CNI that enforces NetworkPolicies"),
    controlCount: 1,
    reason: CisNotScoredReason.Manual,
    why: translationKey(
      "Whether the network plugin enforces NetworkPolicies cannot be read from the API.",
    ),
  },
  {
    id: "5.4.2",
    title: translationKey("External secret storage"),
    controlCount: 1,
    reason: CisNotScoredReason.Manual,
    why: translationKey(
      "Where secrets are kept outside the cluster is a choice the API cannot see.",
    ),
  },
  {
    id: "5.5.1",
    title: translationKey("Image provenance through ImagePolicyWebhook"),
    controlCount: 1,
    reason: CisNotScoredReason.ControlPlaneAccess,
  },
  {
    id: "5.6.1",
    title: translationKey("Namespaces as administrative boundaries"),
    controlCount: 1,
    reason: CisNotScoredReason.Manual,
    why: translationKey(
      "Which namespaces mark an administrative boundary needs a person's review.",
    ),
  },
  {
    id: "5.6.3",
    title: translationKey("Security contexts on pods and containers"),
    controlCount: 1,
    reason: CisNotScoredReason.Manual,
    why: translationKey(
      "Which security context fits a workload needs a person's review: Pod Security Standards: Restricted checks the settings that matter most.",
    ),
  },
];

// How many of the benchmark's controls are not scored here.
export function getCisNotScoredControlCount(): number {
  return CIS_NOT_SCORED.reduce(
    (total: number, group: CisNotScoredGroup): number => {
      return total + group.controlCount;
    },
    0,
  );
}
