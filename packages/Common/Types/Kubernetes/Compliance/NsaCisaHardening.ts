import { NodeBenchmarkFamily } from "../KubernetesNodeBenchmark";
import { PodSecurity, PodSecurityContainer } from "../KubernetesPodSecurity";
import {
  bindingFinding,
  checkCisPodControl,
  evaluateCisClusterControl,
  ownBindings,
} from "./CisKubernetesBenchmark";
import {
  KubernetesComplianceDetail,
  KubernetesComplianceFinding,
} from "./KubernetesComplianceFinding";
import {
  KubernetesComplianceNetworkPolicy,
  KubernetesComplianceSnapshot,
  getNamespacesWithPods,
} from "./KubernetesComplianceSnapshot";
import { KubernetesComplianceBinding } from "./KubernetesRbac";
import { KubernetesVersion } from "./KubernetesVersion";
import {
  PodSecurityControl,
  PodSecurityLevel,
  checkPodSecurityControl,
} from "./PodSecurityStandards";
import { KubernetesSubject } from "../KubernetesPolicyObjects";

/*
 * THE NSA/CISA KUBERNETES HARDENING GUIDE, AS WHAT ONEUPTIME CAN READ (#9875).
 *
 * The guide (v1.2, August 2022) is the document US public-sector and defence
 * auditors ask for beside the CIS benchmark. It numbers nothing, so each
 * control here is named by a short title of OneUptime's own and the guide's
 * section it is from. Each is answered from one place:
 *
 *   - the pods (and the pod templates of workloads that run none, #9880),
 *     by the same reading as the Pod Security Standards, and by two checks
 *     of the guide's own: immutable root file systems, and CPU and memory
 *     limits on every container;
 *   - the RBAC, service accounts, namespaces and NetworkPolicies the agent
 *     sends, by the CIS benchmark's checks where the guide asks the same,
 *     and by two of its own: a default-deny NetworkPolicy, both ways, in
 *     every namespace that runs pods, and nothing granted to anonymous users;
 *   - the nodes and the control plane, by the CIS benchmark's node and
 *     control plane checks kube-bench reads (#9873), when it runs.
 *
 * What it asks that none of these answers - image scanning, Secrets'
 * encryption at rest, the network around the nodes, threat detection,
 * patching - is listed as not scored, with why (NSA_CISA_NOT_SCORED), and is
 * never passed or failed. A control whose source the cluster has not told -
 * no kube-bench, an agent that sends no RBAC - is not evaluated, as every
 * framework's is, and counts neither way.
 *
 * A control's requirement is its English title: what a setting stores, so
 * none changes once released. Its words are OneUptime's; where the CIS
 * benchmark checks the same thing, they are the benchmark control's.
 */

// Marks a string as a key of the Dashboard's locales, as TranslateTemplate's translationKey does.
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// The guide's sections, in its order.
export enum NsaCisaSection {
  PodSecurity = "PodSecurity",
  NetworkSeparation = "NetworkSeparation",
  Authentication = "Authentication",
  AuditLogging = "AuditLogging",
  Upgrades = "Upgrades",
}

export const NSA_CISA_SECTION_WORDS: Readonly<Record<NsaCisaSection, string>> =
  {
    [NsaCisaSection.PodSecurity]: translationKey("Kubernetes Pod security"),
    [NsaCisaSection.NetworkSeparation]: translationKey(
      "Network separation and hardening",
    ),
    [NsaCisaSection.Authentication]: translationKey(
      "Authentication and authorization",
    ),
    [NsaCisaSection.AuditLogging]: translationKey(
      "Audit logging and threat detection",
    ),
    [NsaCisaSection.Upgrades]: translationKey(
      "Upgrading and application security practices",
    ),
  };

// Where a control is answered from, which says when it cannot be yet.
export enum NsaCisaSource {
  // The pods and the templates of workloads that run none.
  Pods = "Pods",
  // RBAC, service accounts and NetworkPolicies.
  PolicyObjects = "PolicyObjects",
  // The namespaces that run pods, and their labels.
  Namespaces = "Namespaces",
  // kube-bench's node and control plane checks.
  Nodes = "Nodes",
}

export interface NsaCisaPodCheckContext {
  namespace: string;
  version: KubernetesVersion;
}

export interface NsaCisaControl {
  // Its key: its title, in English.
  requirement: string;
  section: NsaCisaSection;
  title: string;
  description: string;
  fix: string;
  source: NsaCisaSource;
  // Pods: what a pod, or a pod template, fails it by.
  checkPod?:
    | ((
        pod: PodSecurity,
        context: NsaCisaPodCheckContext,
      ) => Array<KubernetesComplianceDetail>)
    | undefined;
  // Pods: whether a pod's block holds what checkPod reads; every block does by default.
  isPodRead?: ((pod: PodSecurity) => boolean) | undefined;
  // PolicyObjects and Namespaces: the objects that fail it.
  evaluate?:
    | ((
        snapshot: KubernetesComplianceSnapshot,
      ) => Array<KubernetesComplianceFinding>)
    | undefined;
  // PolicyObjects: whether it also looks at the namespaces pods run in.
  needsPods?: boolean | undefined;
  // Nodes: the kube-bench checks that answer it, by benchmark family.
  nodeChecks?:
    | Partial<Record<NodeBenchmarkFamily, ReadonlyArray<string>>>
    | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * The guide's own checks
 * ---------------------------------------------------------------------------
 */

function pss(
  control: PodSecurityControl,
): (
  pod: PodSecurity,
  context: NsaCisaPodCheckContext,
) => Array<KubernetesComplianceDetail> {
  return (
    pod: PodSecurity,
    context: NsaCisaPodCheckContext,
  ): Array<KubernetesComplianceDetail> => {
    return checkPodSecurityControl(control, pod, {
      level: PodSecurityLevel.Restricted,
      version: context.version,
    });
  };
}

// The containers that run the pod's work: its containers and init containers.
function workContainers(pod: PodSecurity): Array<PodSecurityContainer> {
  return pod.containers.filter((container: PodSecurityContainer): boolean => {
    return container.list !== "ephemeralContainers";
  });
}

/*
 * Immutable container file systems: every container's root file system read
 * only, so an attacker cannot change its binaries. Windows containers have
 * no such setting.
 */
export function getWritableRootFilesystemDetails(
  pod: PodSecurity,
): Array<KubernetesComplianceDetail> {
  if (pod.osName === "windows") {
    return [];
  }

  return workContainers(pod)
    .filter((container: PodSecurityContainer): boolean => {
      return container.readOnlyRootFilesystem !== true;
    })
    .map((container: PodSecurityContainer): KubernetesComplianceDetail => {
      return container.readOnlyRootFilesystem === false
        ? {
            container: container.name,
            field: "securityContext.readOnlyRootFilesystem",
            value: "false",
          }
        : {
            container: container.name,
            field: "securityContext.readOnlyRootFilesystem",
            isNotSet: true,
          };
    });
}

// The resources the guide asks every container to be capped on.
export const NSA_CISA_LIMITED_RESOURCES: ReadonlyArray<string> = [
  "cpu",
  "memory",
];

/*
 * Resource limits: CPU and memory capped on every container, set on it or
 * by a LimitRange's defaults, so one pod cannot starve its node.
 */
export function getMissingLimitDetails(
  pod: PodSecurity,
): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  for (const container of workContainers(pod)) {
    for (const resource of NSA_CISA_LIMITED_RESOURCES) {
      if (!(container.limits || []).includes(resource)) {
        details.push({
          container: container.name,
          field: `resources.limits.${resource}`,
          isNotSet: true,
        });
      }
    }
  }

  return details;
}

function getPolicyTypes(
  policy: KubernetesComplianceNetworkPolicy,
): Array<string> {
  const spec: KubernetesComplianceNetworkPolicy["spec"] = policy.spec;

  if (!spec) {
    return [];
  }

  // As Kubernetes defaults them when a policy names none.
  if (spec.policyTypes.length === 0) {
    return spec.egressRuleCount > 0 ? ["Ingress", "Egress"] : ["Ingress"];
  }

  return spec.policyTypes;
}

// Whether a policy denies a direction to every pod of its namespace, by default.
function deniesByDefault(
  policy: KubernetesComplianceNetworkPolicy,
  direction: "Ingress" | "Egress",
): boolean {
  const spec: KubernetesComplianceNetworkPolicy["spec"] = policy.spec;

  return Boolean(
    spec &&
      spec.selectsAllPods &&
      getPolicyTypes(policy).includes(direction) &&
      (direction === "Ingress"
        ? spec.ingressRuleCount === 0
        : spec.egressRuleCount === 0),
  );
}

/*
 * Default-deny NetworkPolicies: each namespace that runs pods has a policy
 * that selects all of them and allows no traffic in, and one that allows
 * none out, so only what another policy allows gets through.
 */
export function getDefaultDenyFindings(
  snapshot: Pick<KubernetesComplianceSnapshot, "pods" | "networkPolicies">,
): Array<KubernetesComplianceFinding> {
  const findings: Array<KubernetesComplianceFinding> = [];

  for (const namespace of getNamespacesWithPods(snapshot)) {
    const policies: Array<KubernetesComplianceNetworkPolicy> =
      snapshot.networkPolicies.filter(
        (policy: KubernetesComplianceNetworkPolicy): boolean => {
          return policy.namespace === namespace;
        },
      );
    const missing: Array<string> = (["Ingress", "Egress"] as const).filter(
      (direction: "Ingress" | "Egress"): boolean => {
        return !policies.some(
          (policy: KubernetesComplianceNetworkPolicy): boolean => {
            return deniesByDefault(policy, direction);
          },
        );
      },
    );

    if (missing.length > 0) {
      findings.push({
        object: { kind: "Namespace", namespace, name: namespace },
        details: missing.map(
          (direction: string): KubernetesComplianceDetail => {
            return {
              field: `NetworkPolicy podSelector: {} policyTypes: [${direction}]`,
              isNotSet: true,
            };
          },
        ),
      });
    }
  }

  return findings;
}

// The subjects anyone gets without signing in.
const ANONYMOUS_SUBJECTS: ReadonlyArray<{ kind: string; name: string }> = [
  { kind: "User", name: "system:anonymous" },
  { kind: "Group", name: "system:unauthenticated" },
];

/*
 * Nothing granted to anonymous users: a binding the cluster's owner made
 * that names system:anonymous or system:unauthenticated grants its role to
 * whoever reaches the API server. Kubernetes' own (the discovery and health
 * endpoints' roles) are built in and left out.
 */
export function getAnonymousBindingFindings(
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  return ownBindings(snapshot)
    .filter((binding: KubernetesComplianceBinding): boolean => {
      return binding.spec.subjects.some(
        (subject: KubernetesSubject): boolean => {
          return ANONYMOUS_SUBJECTS.some(
            (anonymous: { kind: string; name: string }): boolean => {
              return (
                subject.kind === anonymous.kind &&
                subject.name === anonymous.name
              );
            },
          );
        },
      );
    })
    .map(
      (binding: KubernetesComplianceBinding): KubernetesComplianceFinding => {
        return bindingFinding(binding);
      },
    );
}

/*
 * ---------------------------------------------------------------------------
 * The controls, in the guide's order
 * ---------------------------------------------------------------------------
 */

export const NSA_CISA_CONTROLS: ReadonlyArray<NsaCisaControl> = [
  // --- Kubernetes Pod security ----------------------------------------------
  {
    requirement: "Non-root containers",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("Non-root containers"),
    description: translationKey("Containers that may run as root."),
    fix: translationKey(
      "Set securityContext.runAsNonRoot: true, and a user other than 0.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: (
      pod: PodSecurity,
      context: NsaCisaPodCheckContext,
    ): Array<KubernetesComplianceDetail> => {
      return [
        ...pss(PodSecurityControl.RunningAsNonRoot)(pod, context),
        ...pss(PodSecurityControl.RunningAsNonRootUser)(pod, context),
      ];
    },
  },
  {
    requirement: "Immutable container file systems",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("Immutable container file systems"),
    description: translationKey(
      "Containers whose root file system is writable, so whoever runs code in one can change its binaries.",
    ),
    fix: translationKey(
      "Set securityContext.readOnlyRootFilesystem: true on every container, and mount an emptyDir where it writes.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: getWritableRootFilesystemDetails,
  },
  {
    requirement: "No privileged containers",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("No privileged containers"),
    description: translationKey("Workloads that run privileged containers."),
    fix: translationKey(
      "Remove securityContext.privileged, or set it to false.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: pss(PodSecurityControl.PrivilegedContainers),
  },
  {
    requirement: "No privilege escalation",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("No privilege escalation"),
    description: translationKey(
      "Containers that may gain more privileges than their parent process.",
    ),
    fix: translationKey(
      "Set securityContext.allowPrivilegeEscalation: false on every container.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: pss(PodSecurityControl.PrivilegeEscalation),
  },
  {
    requirement: "No host namespaces",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("No host namespaces"),
    description: translationKey(
      "Pods must not share the node's network, process or IPC namespace.",
    ),
    fix: translationKey(
      "Remove hostNetwork, hostPID and hostIPC from the pod, or set them to false.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: pss(PodSecurityControl.HostNamespaces),
  },
  {
    requirement: "No HostPath volumes",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("No HostPath volumes"),
    description: translationKey(
      "Workloads that mount directories of the node with hostPath volumes.",
    ),
    fix: translationKey(
      "Use a PersistentVolumeClaim, an emptyDir or a CSI volume instead.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: pss(PodSecurityControl.HostPathVolumes),
  },
  {
    requirement: "No added capabilities",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("No added capabilities"),
    description: translationKey(
      "Containers that do not drop ALL capabilities, or that add some beyond NET_BIND_SERVICE.",
    ),
    fix: translationKey(
      "Set securityContext.capabilities.drop: [ALL], and add back only what the container needs.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: pss(PodSecurityControl.CapabilitiesRestricted),
  },
  {
    requirement: "Seccomp, AppArmor and SELinux",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("Seccomp, AppArmor and SELinux"),
    description: translationKey(
      "Containers that run with no seccomp profile, or that turn off AppArmor or loosen SELinux.",
    ),
    fix: translationKey(
      "Set securityContext.seccompProfile.type: RuntimeDefault on the pod, and leave AppArmor and SELinux at their defaults.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: (
      pod: PodSecurity,
      context: NsaCisaPodCheckContext,
    ): Array<KubernetesComplianceDetail> => {
      return [
        ...checkCisPodControl("5.6.2", pod, context),
        ...pss(PodSecurityControl.AppArmor)(pod, context),
        ...pss(PodSecurityControl.SELinux)(pod, context),
      ];
    },
  },
  {
    requirement: "Pod security enforced",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("Pod security enforced"),
    description: translationKey(
      "Namespaces that run pods with no Pod Security Admission level enforced, when no policy engine runs.",
    ),
    fix: translationKey(
      "Label each namespace with pod-security.kubernetes.io/enforce: baseline or restricted, or run a policy engine such as Kyverno or Gatekeeper.",
    ),
    source: NsaCisaSource.Namespaces,
    evaluate: (
      snapshot: KubernetesComplianceSnapshot,
    ): Array<KubernetesComplianceFinding> => {
      return evaluateCisClusterControl("5.2.1", snapshot);
    },
  },
  {
    requirement: "Service account tokens mounted only where needed",
    section: NsaCisaSection.PodSecurity,
    title: translationKey("Default service accounts not used"),
    description: translationKey(
      "Default service accounts that mount their token into pods, or that are granted a role.",
    ),
    fix: translationKey(
      "Set automountServiceAccountToken: false on each default service account, and give workloads that call the API a service account of their own.",
    ),
    source: NsaCisaSource.PolicyObjects,
    evaluate: (
      snapshot: KubernetesComplianceSnapshot,
    ): Array<KubernetesComplianceFinding> => {
      return evaluateCisClusterControl("5.1.5", snapshot);
    },
  },
  // --- Network separation and hardening ---------------------------------------
  {
    requirement: "Workloads in namespaces of their own",
    section: NsaCisaSection.NetworkSeparation,
    title: translationKey("Nothing in the default namespace"),
    description: translationKey("Workloads that run in the default namespace."),
    fix: translationKey("Move each workload to a namespace of its own."),
    source: NsaCisaSource.Pods,
    checkPod: (
      pod: PodSecurity,
      context: NsaCisaPodCheckContext,
    ): Array<KubernetesComplianceDetail> => {
      return checkCisPodControl("5.6.4", pod, context);
    },
  },
  {
    requirement: "Default-deny network policies",
    section: NsaCisaSection.NetworkSeparation,
    title: translationKey("Default-deny network policies"),
    description: translationKey(
      "Namespaces that run pods with no NetworkPolicy that denies all traffic in, and all traffic out, by default.",
    ),
    fix: translationKey(
      "Add a NetworkPolicy with podSelector: {} and no rules for each of Ingress and Egress to every namespace, then allow only the traffic each workload needs.",
    ),
    source: NsaCisaSource.PolicyObjects,
    needsPods: true,
    evaluate: getDefaultDenyFindings,
  },
  {
    requirement: "Resource limits on every container",
    section: NsaCisaSection.NetworkSeparation,
    title: translationKey("Resource limits on every container"),
    description: translationKey(
      "Containers with no CPU or memory limit, set on them or by a LimitRange, so one pod can starve its node.",
    ),
    fix: translationKey(
      "Set resources.limits.cpu and resources.limits.memory on every container, or a LimitRange with default limits in each namespace.",
    ),
    source: NsaCisaSource.Pods,
    checkPod: getMissingLimitDetails,
    isPodRead: (pod: PodSecurity): boolean => {
      return pod.resourcesRead === true;
    },
  },
  {
    requirement: "etcd over TLS, with client certificates",
    section: NsaCisaSection.NetworkSeparation,
    title: translationKey("etcd over TLS, with client certificates"),
    description: translationKey(
      "The TLS etcd serves, the certificates it asks of its clients and peers, and the API server's to it.",
    ),
    fix: translationKey(
      "Give etcd and the API server the certificates the failing CIS controls name, and turn on client certificate authentication.",
    ),
    source: NsaCisaSource.Nodes,
    nodeChecks: {
      [NodeBenchmarkFamily.Cis]: [
        "1.2.23",
        "1.2.26",
        "2.1",
        "2.2",
        "2.3",
        "2.4",
        "2.5",
        "2.6",
      ],
    },
  },
  {
    requirement: "Control plane traffic over TLS",
    section: NsaCisaSection.NetworkSeparation,
    title: translationKey("Control plane traffic over TLS"),
    description: translationKey(
      "The API server's TLS certificate and client CA, and its certificates to the kubelets.",
    ),
    fix: translationKey(
      "Set the certificate flags the failing CIS controls name on the API server.",
    ),
    source: NsaCisaSource.Nodes,
    nodeChecks: {
      [NodeBenchmarkFamily.Cis]: ["1.2.4", "1.2.5", "1.2.24", "1.2.25"],
    },
  },
  {
    requirement: "Kubeconfig and credential files protected",
    section: NsaCisaSection.NetworkSeparation,
    title: translationKey("Kubeconfig and credential files protected"),
    description: translationKey(
      "The permissions and owners of the nodes' kubeconfig files and the control plane's credentials.",
    ),
    fix: translationKey(
      "Run the chmod and chown commands the failing CIS controls name on each node.",
    ),
    source: NsaCisaSource.Nodes,
    nodeChecks: {
      [NodeBenchmarkFamily.Cis]: [
        "1.1.13",
        "1.1.14",
        "1.1.15",
        "1.1.16",
        "1.1.17",
        "1.1.18",
        "1.1.19",
        "4.1.5",
        "4.1.6",
      ],
      [NodeBenchmarkFamily.Eks]: ["3.1.1", "3.1.2"],
      [NodeBenchmarkFamily.Gke]: ["3.1.1", "3.1.2"],
      [NodeBenchmarkFamily.Aks]: ["3.1.1", "3.1.2"],
    },
  },
  // --- Authentication and authorization ----------------------------------------
  {
    requirement: "Anonymous requests refused",
    section: NsaCisaSection.Authentication,
    title: translationKey("Anonymous requests refused"),
    description: translationKey(
      "Kubelets and API servers that answer requests from anyone who has not signed in.",
    ),
    fix: translationKey(
      "Set authentication.anonymous.enabled: false and readOnlyPort: 0 in each kubelet's configuration, and --anonymous-auth=false on the API server.",
    ),
    source: NsaCisaSource.Nodes,
    nodeChecks: {
      [NodeBenchmarkFamily.Cis]: ["1.2.1", "4.2.1", "4.2.4"],
      [NodeBenchmarkFamily.Eks]: ["3.2.1", "3.2.4"],
      [NodeBenchmarkFamily.Aks]: ["3.2.1", "3.2.4"],
    },
  },
  {
    requirement: "RBAC and Node authorization",
    section: NsaCisaSection.Authentication,
    title: translationKey("RBAC and Node authorization"),
    description: translationKey(
      "API servers that do not authorize with RBAC and Node, and kubelets that allow every request.",
    ),
    fix: translationKey(
      "Set --authorization-mode=Node,RBAC on the API server, and authorization.mode: Webhook in each kubelet's configuration.",
    ),
    source: NsaCisaSource.Nodes,
    nodeChecks: {
      [NodeBenchmarkFamily.Cis]: ["1.2.6", "1.2.7", "1.2.8", "4.2.2"],
      [NodeBenchmarkFamily.Eks]: ["3.2.2"],
      [NodeBenchmarkFamily.Aks]: ["3.2.2"],
    },
  },
  {
    requirement: "No static token authentication",
    section: NsaCisaSection.Authentication,
    title: translationKey("API server: no static token file"),
    description: translationKey(
      "API servers that accept the long-lived bearer tokens of a static token file.",
    ),
    fix: translationKey(
      "Remove --token-auth-file from the API server's manifest on each control plane node.",
    ),
    source: NsaCisaSource.Nodes,
    nodeChecks: {
      [NodeBenchmarkFamily.Cis]: ["1.2.2"],
    },
  },
  {
    requirement: "cluster-admin bound only where needed",
    section: NsaCisaSection.Authentication,
    title: translationKey("cluster-admin bound only where needed"),
    description: translationKey(
      "Bindings that grant cluster-admin, which can do anything in the cluster.",
    ),
    fix: translationKey(
      "Bind a role that grants only what the subject needs, then delete the binding.",
    ),
    source: NsaCisaSource.PolicyObjects,
    evaluate: (
      snapshot: KubernetesComplianceSnapshot,
    ): Array<KubernetesComplianceFinding> => {
      return evaluateCisClusterControl("5.1.1", snapshot);
    },
  },
  {
    requirement: "No wildcards in roles",
    section: NsaCisaSection.Authentication,
    title: translationKey("No wildcards in roles"),
    description: translationKey(
      "Roles and ClusterRoles that use * for API groups, resources or verbs.",
    ),
    fix: translationKey(
      "List the API groups, resources and verbs the role needs instead of *.",
    ),
    source: NsaCisaSource.PolicyObjects,
    evaluate: (
      snapshot: KubernetesComplianceSnapshot,
    ): Array<KubernetesComplianceFinding> => {
      return evaluateCisClusterControl("5.1.3", snapshot);
    },
  },
  {
    requirement: "Least access to Secrets",
    section: NsaCisaSection.Authentication,
    title: translationKey("Least access to Secrets"),
    description: translationKey(
      "Bindings that let someone read every Secret of a namespace or of the cluster.",
    ),
    fix: translationKey(
      "Name the Secrets the role needs with resourceNames, or remove get, list and watch on secrets.",
    ),
    source: NsaCisaSource.PolicyObjects,
    evaluate: (
      snapshot: KubernetesComplianceSnapshot,
    ): Array<KubernetesComplianceFinding> => {
      return evaluateCisClusterControl("5.1.2", snapshot);
    },
  },
  {
    requirement: "Nothing granted to anonymous users",
    section: NsaCisaSection.Authentication,
    title: translationKey("Nothing granted to anonymous users"),
    description: translationKey(
      "Bindings that grant a role to system:anonymous or system:unauthenticated: to anyone who reaches the API server.",
    ),
    fix: translationKey(
      "Remove system:anonymous and system:unauthenticated from the binding's subjects, or delete it.",
    ),
    source: NsaCisaSource.PolicyObjects,
    evaluate: getAnonymousBindingFindings,
  },
  // --- Audit logging and threat detection -------------------------------------
  {
    requirement: "API server audit logging",
    section: NsaCisaSection.AuditLogging,
    title: translationKey("API server audit logging"),
    description: translationKey(
      "API servers that keep no audit log, or keep it too briefly to investigate an incident.",
    ),
    fix: translationKey(
      "Set --audit-log-path, --audit-log-maxage=30, --audit-log-maxbackup=10 and --audit-log-maxsize=100 on the API server, with an audit policy.",
    ),
    source: NsaCisaSource.Nodes,
    nodeChecks: {
      [NodeBenchmarkFamily.Cis]: ["1.2.16", "1.2.17", "1.2.18", "1.2.19"],
    },
  },
];

export function findNsaCisaControl(
  requirement: string,
): NsaCisaControl | undefined {
  return NSA_CISA_CONTROLS.find((control: NsaCisaControl): boolean => {
    return control.requirement === requirement;
  });
}

/*
 * ---------------------------------------------------------------------------
 * What the guide asks that is not scored here
 * ---------------------------------------------------------------------------
 */

export enum NsaCisaNotScoredReason {
  // Outside what the Kubernetes API and the nodes show: the network, the cloud, the registry.
  OutsideKubernetes = "OutsideKubernetes",
  // The control plane's own configuration, which kube-bench leaves to a person.
  ControlPlane = "ControlPlane",
  // What the agent does not read yet.
  NotReadYet = "NotReadYet",
  // A judgement no API answers.
  Manual = "Manual",
}

export const NSA_CISA_NOT_SCORED_REASON_WORDS: Readonly<
  Record<NsaCisaNotScoredReason, string>
> = {
  [NsaCisaNotScoredReason.OutsideKubernetes]: translationKey(
    "Outside what the Kubernetes API and the nodes show: the network, the cloud and the image registry.",
  ),
  [NsaCisaNotScoredReason.ControlPlane]: translationKey(
    "Needs access to the control plane: the API server's, controller manager's, scheduler's and etcd's flags.",
  ),
  [NsaCisaNotScoredReason.NotReadYet]: translationKey(
    "The Kubernetes agent does not read it yet.",
  ),
  [NsaCisaNotScoredReason.Manual]: translationKey(
    "Needs a person's review: the Kubernetes API cannot answer it.",
  ),
};

export interface NsaCisaNotScored {
  title: string;
  section: NsaCisaSection;
  reason: NsaCisaNotScoredReason;
}

// The guide's recommendations no source answers, in its order.
export const NSA_CISA_NOT_SCORED: ReadonlyArray<NsaCisaNotScored> = [
  {
    title: translationKey("Container images scanned for vulnerabilities"),
    section: NsaCisaSection.PodSecurity,
    reason: NsaCisaNotScoredReason.OutsideKubernetes,
  },
  {
    title: translationKey("Rootless container engines and sandboxed runtimes"),
    section: NsaCisaSection.PodSecurity,
    reason: NsaCisaNotScoredReason.Manual,
  },
  {
    title: translationKey("Secrets encrypted at rest"),
    section: NsaCisaSection.NetworkSeparation,
    reason: NsaCisaNotScoredReason.ControlPlane,
  },
  {
    title: translationKey("LimitRanges and ResourceQuotas in every namespace"),
    section: NsaCisaSection.NetworkSeparation,
    reason: NsaCisaNotScoredReason.NotReadYet,
  },
  {
    title: translationKey("Nodes on networks of their own, behind firewalls"),
    section: NsaCisaSection.NetworkSeparation,
    reason: NsaCisaNotScoredReason.OutsideKubernetes,
  },
  {
    title: translationKey("Cloud metadata services kept from pods"),
    section: NsaCisaSection.NetworkSeparation,
    reason: NsaCisaNotScoredReason.OutsideKubernetes,
  },
  {
    title: translationKey("Strong authentication for people"),
    section: NsaCisaSection.Authentication,
    reason: NsaCisaNotScoredReason.Manual,
  },
  {
    title: translationKey("Threat detection and alerting"),
    section: NsaCisaSection.AuditLogging,
    reason: NsaCisaNotScoredReason.Manual,
  },
  {
    title: translationKey("Security patches applied promptly"),
    section: NsaCisaSection.Upgrades,
    reason: NsaCisaNotScoredReason.Manual,
  },
  {
    title: translationKey("Periodic vulnerability scans and penetration tests"),
    section: NsaCisaSection.Upgrades,
    reason: NsaCisaNotScoredReason.Manual,
  },
];
