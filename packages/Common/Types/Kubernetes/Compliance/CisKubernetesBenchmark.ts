import { PodSecurity } from "../KubernetesPodSecurity";
import {
  KubernetesComplianceDetail,
  KubernetesComplianceFinding,
} from "./KubernetesComplianceFinding";
import {
  KubernetesComplianceNamespace,
  KubernetesComplianceServiceAccount,
  KubernetesComplianceSnapshot,
  getNamespacesWithPods,
} from "./KubernetesComplianceSnapshot";
import {
  KubernetesComplianceBinding,
  KubernetesComplianceRole,
  KubernetesRbacRequest,
  bindsServiceAccount,
  describeRoleRef,
  describeSubject,
  findBoundRole,
  getGrantedRequests,
  getNodesProxyReasons,
  getOneUptimeAgentInstall,
  getWildcardFields,
  isBuiltInRbacObject,
  isOneUptimeAgentObject,
} from "./KubernetesRbac";
import { KubernetesVersion } from "./KubernetesVersion";
import {
  PodSecurityControl,
  PodSecurityLevel,
  checkPodSecurityControl,
  getSeccompRestrictedDetails,
} from "./PodSecurityStandards";
import { OPENSHIFT_KUBERNETES_PROVIDER } from "../KubernetesClusterProvider";

/*
 * THE CIS KUBERNETES BENCHMARK'S POLICY CONTROLS, AS THE API SHOWS THEM (#9627).
 *
 * Section 5 of the CIS Kubernetes Benchmark v2.0 (Kubernetes 1.34+; v1.12,
 * for 1.32 and 1.33, numbers its controls the same) is about the policies a
 * cluster runs under, and most of it can be read through the Kubernetes API
 * from what the agent reports. Each control here is checked by a rule
 * written for it - the benchmark marks these Manual, so the rule is said
 * where the control is (KubernetesComplianceCatalog), and the same rule is
 * applied to every cluster:
 *
 *   - 5.1.x, RBAC: a binding that grants cluster-admin, or a right the
 *     control names, to anyone; a role that uses a wildcard; a default
 *     service account that mounts its token or is granted a role. The
 *     roles and bindings Kubernetes and the platform keep up are left out
 *     (KubernetesRbac).
 *   - 5.2.x, Pod Security Standards: a workload that runs a pod the control
 *     names - privileged, sharing a host namespace, running as root -, by
 *     the same reading of a pod's fields as the Pod Security Standards.
 *     5.2.1 asks for a policy mechanism: a namespace that runs pods with no
 *     Pod Security Admission level enforced, unless a policy engine runs
 *     (Kyverno, Gatekeeper, Kubewarden) or the cluster is OpenShift, whose
 *     security context constraints always do.
 *   - 5.3.2: a namespace that runs pods with no NetworkPolicy.
 *   - 5.4.1, 5.6.2, 5.6.4: a container reading a Secret into its
 *     environment, a container with no seccomp profile, a workload in the
 *     default namespace.
 *
 * The rest of the benchmark - its node, control plane and etcd sections,
 * and the few policy controls no API answers - is not scored here; the
 * catalog says which and why. Pure: the server scores with it.
 */

// The benchmark version the controls' numbers are from.
export const CIS_KUBERNETES_BENCHMARK_VERSION: string = "2.0";

/*
 * How each scored control reads the cluster: from its pods, its RBAC and
 * service accounts, its namespaces' labels, or its network policies.
 */
export enum CisEvaluation {
  Pods = "Pods",
  PolicyObjects = "PolicyObjects",
  Namespaces = "Namespaces",
}

// The scored controls, and how each is read.
export const CIS_SCORED_CONTROLS: Readonly<Record<string, CisEvaluation>> = {
  "5.1.1": CisEvaluation.PolicyObjects,
  "5.1.2": CisEvaluation.PolicyObjects,
  "5.1.3": CisEvaluation.PolicyObjects,
  "5.1.4": CisEvaluation.PolicyObjects,
  "5.1.5": CisEvaluation.PolicyObjects,
  "5.1.8": CisEvaluation.PolicyObjects,
  "5.1.9": CisEvaluation.PolicyObjects,
  "5.1.10": CisEvaluation.PolicyObjects,
  "5.1.11": CisEvaluation.PolicyObjects,
  "5.1.12": CisEvaluation.PolicyObjects,
  "5.1.13": CisEvaluation.PolicyObjects,
  "5.2.1": CisEvaluation.Namespaces,
  "5.2.2": CisEvaluation.Pods,
  "5.2.3": CisEvaluation.Pods,
  "5.2.4": CisEvaluation.Pods,
  "5.2.5": CisEvaluation.Pods,
  "5.2.6": CisEvaluation.Pods,
  "5.2.7": CisEvaluation.Pods,
  "5.2.8": CisEvaluation.Pods,
  "5.2.9": CisEvaluation.Pods,
  "5.2.10": CisEvaluation.Pods,
  "5.2.11": CisEvaluation.Pods,
  "5.2.12": CisEvaluation.Pods,
  "5.3.2": CisEvaluation.PolicyObjects,
  "5.4.1": CisEvaluation.Pods,
  "5.6.2": CisEvaluation.Pods,
  "5.6.4": CisEvaluation.Pods,
};

export function isCisPodControl(id: string): boolean {
  return CIS_SCORED_CONTROLS[id] === CisEvaluation.Pods;
}

/*
 * ---------------------------------------------------------------------------
 * 5.2, 5.4.1, 5.6.2, 5.6.4: what a pod runs
 * ---------------------------------------------------------------------------
 */

const RESTRICTED: PodSecurityLevel = PodSecurityLevel.Restricted;

function hostNamespaceDetails(
  pod: PodSecurity,
  field: "hostPID" | "hostIPC" | "hostNetwork",
): Array<KubernetesComplianceDetail> {
  return pod[field] === true ? [{ field, value: "true" }] : [];
}

// 5.2.8: a container that keeps NET_RAW (drops neither it nor ALL) or adds it.
function netRawDetails(pod: PodSecurity): Array<KubernetesComplianceDetail> {
  if (pod.osName === "windows") {
    return [];
  }

  const details: Array<KubernetesComplianceDetail> = [];

  for (const container of pod.containers) {
    const dropped: Array<string> = container.capabilitiesDrop || [];

    if ((container.capabilitiesAdd || []).includes("NET_RAW")) {
      details.push({
        container: container.name,
        field: "securityContext.capabilities.add",
        value: "NET_RAW",
      });
    } else if (!dropped.includes("ALL") && !dropped.includes("NET_RAW")) {
      // The container runtime grants NET_RAW unless the container drops it.
      details.push({
        container: container.name,
        field: "securityContext.capabilities.drop",
        value: dropped.length > 0 ? dropped.join(", ") : undefined,
        isNotSet: dropped.length === 0 ? true : undefined,
      });
    }
  }

  return details;
}

// 5.4.1: the Secrets a container reads into its environment.
function secretEnvironmentDetails(
  pod: PodSecurity,
): Array<KubernetesComplianceDetail> {
  const details: Array<KubernetesComplianceDetail> = [];

  for (const container of pod.containers) {
    for (const variable of container.secretEnv || []) {
      details.push({
        container: container.name,
        field: `env[${variable.variable}].valueFrom.secretKeyRef`,
        value: variable.secret,
      });
    }

    for (const secret of container.secretEnvFrom || []) {
      details.push({
        container: container.name,
        field: "envFrom[*].secretRef",
        value: secret,
      });
    }
  }

  return details;
}

// 5.6.2: a seccomp profile on every container, as Restricted's Seccomp reads it.
function seccompDetails(pod: PodSecurity): Array<KubernetesComplianceDetail> {
  // Seccomp is a Linux kernel feature: a Windows pod has none to set.
  return pod.osName === "windows" ? [] : getSeccompRestrictedDetails(pod);
}

/*
 * What a pod of this namespace fails a pod control by; nothing when it
 * meets it. The pod's own fields, read as the Pod Security Standards read
 * them, at the version the cluster is scored against.
 */
export function checkCisPodControl(
  id: string,
  pod: PodSecurity,
  context: { namespace: string; version: KubernetesVersion },
): Array<KubernetesComplianceDetail> {
  const pss: (
    control: PodSecurityControl,
  ) => Array<KubernetesComplianceDetail> = (
    control: PodSecurityControl,
  ): Array<KubernetesComplianceDetail> => {
    return checkPodSecurityControl(control, pod, {
      level: RESTRICTED,
      version: context.version,
    });
  };

  switch (id) {
    case "5.2.2":
      return pss(PodSecurityControl.PrivilegedContainers);
    case "5.2.3":
      return hostNamespaceDetails(pod, "hostPID");
    case "5.2.4":
      return hostNamespaceDetails(pod, "hostIPC");
    case "5.2.5":
      return hostNamespaceDetails(pod, "hostNetwork");
    case "5.2.6":
      return pss(PodSecurityControl.PrivilegeEscalation);
    case "5.2.7":
      return [
        ...pss(PodSecurityControl.RunningAsNonRoot),
        ...pss(PodSecurityControl.RunningAsNonRootUser),
      ];
    case "5.2.8":
      return netRawDetails(pod);
    case "5.2.9":
      return pss(PodSecurityControl.CapabilitiesRestricted);
    case "5.2.10":
      return pss(PodSecurityControl.HostProcess);
    case "5.2.11":
      return pss(PodSecurityControl.HostPathVolumes);
    case "5.2.12":
      return pss(PodSecurityControl.HostPorts);
    case "5.4.1":
      return secretEnvironmentDetails(pod);
    case "5.6.2":
      return seccompDetails(pod);
    case "5.6.4":
      return context.namespace === "default"
        ? [{ field: "metadata.namespace", value: "default" }]
        : [];
    default:
      return [];
  }
}

/*
 * ---------------------------------------------------------------------------
 * 5.1: RBAC and service accounts
 * ---------------------------------------------------------------------------
 */

const CORE: string = "";
const RBAC_GROUP: string = "rbac.authorization.k8s.io";

function requests(
  group: string,
  resources: ReadonlyArray<string>,
  verbs: ReadonlyArray<string>,
  subresource?: string,
): Array<KubernetesRbacRequest> {
  const list: Array<KubernetesRbacRequest> = [];

  for (const resource of resources) {
    for (const verb of verbs) {
      list.push({ group, resource, subresource, verb });
    }
  }

  return list;
}

// The rights each "minimize access" control looks for.
export const CIS_ACCESS_REQUESTS: Readonly<
  Record<string, ReadonlyArray<KubernetesRbacRequest>>
> = {
  // Reading Secrets.
  "5.1.2": requests(CORE, ["secrets"], ["get", "list", "watch"]),
  // Creating pods.
  "5.1.4": requests(CORE, ["pods"], ["create"]),
  // Binding or escalating roles, and impersonating users, groups or service accounts.
  "5.1.8": [
    ...requests(RBAC_GROUP, ["roles", "clusterroles"], ["bind", "escalate"]),
    ...requests(CORE, ["users", "groups", "serviceaccounts"], ["impersonate"]),
  ],
  // Creating persistent volumes.
  "5.1.9": requests(CORE, ["persistentvolumes"], ["create"]),
  // The proxy subresource of nodes, which reaches each kubelet's API.
  "5.1.10": requests(
    CORE,
    ["nodes"],
    ["get", "create", "update", "patch", "delete"],
    "proxy",
  ),
  // Approving certificate signing requests.
  "5.1.11": requests(
    "certificates.k8s.io",
    ["certificatesigningrequests"],
    ["update", "patch"],
    "approval",
  ),
  // Changing admission webhook configurations.
  "5.1.12": requests(
    "admissionregistration.k8s.io",
    ["validatingwebhookconfigurations", "mutatingwebhookconfigurations"],
    ["create", "update", "patch", "delete"],
  ),
  // Creating service account tokens.
  "5.1.13": requests(CORE, ["serviceaccounts"], ["create"], "token"),
};

function bindingFinding(
  binding: KubernetesComplianceBinding,
  extra: Array<KubernetesComplianceDetail> = [],
): KubernetesComplianceFinding {
  return {
    object: {
      kind: binding.kind,
      namespace: binding.namespace,
      name: binding.name,
    },
    details: [
      { field: "roleRef", value: describeRoleRef(binding) },
      {
        field: "subjects",
        value: binding.spec.subjects.map(describeSubject).join(", "),
      },
      ...extra,
    ],
  };
}

// The bindings the cluster's owner made, that grant something to someone.
function ownBindings(
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceBinding> {
  return snapshot.bindings.filter(
    (binding: KubernetesComplianceBinding): boolean => {
      return !isBuiltInRbacObject(binding) && binding.spec.subjects.length > 0;
    },
  );
}

// 5.1.1: a binding of cluster-admin the cluster's owner made.
function clusterAdminFindings(
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  return ownBindings(snapshot)
    .filter((binding: KubernetesComplianceBinding): boolean => {
      return (
        binding.spec.roleRef.kind === "ClusterRole" &&
        binding.spec.roleRef.name === "cluster-admin"
      );
    })
    .map((binding: KubernetesComplianceBinding) => {
      return bindingFinding(binding);
    });
}

// 5.1.2, 5.1.4, 5.1.8-5.1.13: a binding whose role grants the control's rights.
function accessFindings(
  snapshot: KubernetesComplianceSnapshot,
  wanted: ReadonlyArray<KubernetesRbacRequest>,
): Array<KubernetesComplianceFinding> {
  const findings: Array<KubernetesComplianceFinding> = [];

  for (const binding of ownBindings(snapshot)) {
    const role: KubernetesComplianceRole | null = findBoundRole(
      binding,
      snapshot.roles,
    );

    if (!role) {
      // A binding to a role that does not exist grants nothing.
      continue;
    }

    const granted: Array<KubernetesRbacRequest> = getGrantedRequests(
      role.spec,
      wanted,
    );

    if (granted.length > 0) {
      const finding: KubernetesComplianceFinding = bindingFinding(binding, [
        {
          field: "verbs",
          value: Array.from(
            new Set(
              granted.map((request: KubernetesRbacRequest): string => {
                const resource: string = request.subresource
                  ? `${request.resource}/${request.subresource}`
                  : request.resource;

                return `${request.verb} ${resource}`;
              }),
            ),
          ).join(", "),
        },
      ]);

      /*
       * The OneUptime agent's own binding: the page says so, and why its
       * role grants nodes/proxy, as the role's label says (#9878), with the
       * value that drops it as the agent was installed (#9928).
       */
      if (isOneUptimeAgentObject(binding)) {
        finding.oneUptimeAgent = {
          nodesProxyReasons: getNodesProxyReasons(role),
          installedAs: getOneUptimeAgentInstall(role),
        };
      }

      findings.push(finding);
    }
  }

  return findings;
}

// 5.1.3: a Role or ClusterRole the cluster's owner made that uses a wildcard.
function wildcardFindings(
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  const findings: Array<KubernetesComplianceFinding> = [];

  for (const role of snapshot.roles) {
    if (isBuiltInRbacObject(role)) {
      continue;
    }

    const fields: Array<string> = getWildcardFields(role.spec);

    if (fields.length > 0) {
      findings.push({
        object: { kind: role.kind, namespace: role.namespace, name: role.name },
        details: fields.map((field: string): KubernetesComplianceDetail => {
          return { field, value: "*" };
        }),
      });
    }
  }

  return findings;
}

/*
 * 5.1.5: each namespace's default service account must not mount its token
 * into pods by default, nor be granted a role beyond the defaults.
 */
function defaultServiceAccountFindings(
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  const findings: Array<KubernetesComplianceFinding> = [];

  for (const account of snapshot.serviceAccounts) {
    if (account.name !== "default") {
      continue;
    }

    const details: Array<KubernetesComplianceDetail> = [];

    if (account.spec.automountServiceAccountToken !== false) {
      details.push(
        account.spec.automountServiceAccountToken === true
          ? { field: "automountServiceAccountToken", value: "true" }
          : { field: "automountServiceAccountToken", isNotSet: true },
      );
    }

    for (const binding of ownBindings(snapshot)) {
      if (bindsServiceAccount(binding, account.namespace, account.name)) {
        details.push({
          field: binding.namespace
            ? `${binding.kind} ${binding.namespace}/${binding.name}`
            : `${binding.kind} ${binding.name}`,
          value: describeRoleRef(binding),
        });
      }
    }

    if (details.length > 0) {
      findings.push({
        object: serviceAccountObject(account),
        details,
      });
    }
  }

  return findings;
}

function serviceAccountObject(account: KubernetesComplianceServiceAccount): {
  kind: string;
  namespace: string;
  name: string;
} {
  return {
    kind: "ServiceAccount",
    namespace: account.namespace,
    name: account.name,
  };
}

/*
 * ---------------------------------------------------------------------------
 * 5.2.1 and 5.3.2: what each namespace that runs pods has
 * ---------------------------------------------------------------------------
 */

export const POD_SECURITY_ENFORCE_LABEL: string =
  "pod-security.kubernetes.io/enforce";

// The levels that restrict what a namespace admits.
const ENFORCING_LEVELS: ReadonlySet<string> = new Set<string>([
  "baseline",
  "restricted",
]);

/*
 * The policy engines whose admission controllers say a cluster enforces its
 * own policies, by the name of the image each runs - wherever it is
 * mirrored from: ghcr.io/kyverno/kyverno, openpolicyagent/gatekeeper.
 */
export const POLICY_ENGINES: ReadonlyArray<{
  name: string;
  imageNames: ReadonlyArray<string>;
}> = [
  { name: "Kyverno", imageNames: ["kyverno"] },
  { name: "Gatekeeper", imageNames: ["gatekeeper"] },
  { name: "Kubewarden", imageNames: ["kubewarden-controller"] },
];

// An image's name: its repository's last part, with no registry, tag or digest.
export function getImageName(image: string): string {
  const repository: string = (image.split("@")[0] || "").trim();
  const name: string = repository.split("/").pop() || "";

  return name.split(":")[0]!.toLowerCase();
}

// The policy engine a cluster runs, by its pods' images: "Kyverno", or null.
export function findPolicyEngine(
  snapshot: Pick<KubernetesComplianceSnapshot, "pods">,
): string | null {
  for (const pod of snapshot.pods) {
    for (const image of pod.images) {
      const name: string = getImageName(image);
      const engine: { name: string } | undefined = POLICY_ENGINES.find(
        (each: { imageNames: ReadonlyArray<string> }): boolean => {
          return each.imageNames.includes(name);
        },
      );

      if (engine) {
        return engine.name;
      }
    }
  }

  return null;
}

function policyMechanismFindings(
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  if (
    snapshot.provider === OPENSHIFT_KUBERNETES_PROVIDER ||
    findPolicyEngine(snapshot)
  ) {
    return [];
  }

  const namespaces: Map<string, KubernetesComplianceNamespace> = new Map();

  for (const namespace of snapshot.namespaces) {
    namespaces.set(namespace.name, namespace);
  }

  const findings: Array<KubernetesComplianceFinding> = [];

  for (const name of getNamespacesWithPods(snapshot)) {
    const level: string | undefined = (namespaces.get(name)?.labels || {})[
      POD_SECURITY_ENFORCE_LABEL
    ];

    if (!level || !ENFORCING_LEVELS.has(level)) {
      findings.push({
        object: { kind: "Namespace", namespace: name, name },
        details: [
          level
            ? {
                field: `metadata.labels["${POD_SECURITY_ENFORCE_LABEL}"]`,
                value: level,
              }
            : {
                field: `metadata.labels["${POD_SECURITY_ENFORCE_LABEL}"]`,
                isNotSet: true,
              },
        ],
      });
    }
  }

  return findings;
}

function networkPolicyFindings(
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  const covered: Set<string> = new Set<string>(
    snapshot.networkPolicies.map((policy: { namespace: string }): string => {
      return policy.namespace;
    }),
  );

  return getNamespacesWithPods(snapshot)
    .filter((name: string): boolean => {
      return !covered.has(name);
    })
    .map((name: string): KubernetesComplianceFinding => {
      return {
        object: { kind: "Namespace", namespace: name, name },
        details: [],
      };
    });
}

/*
 * What a control that reads the cluster rather than its pods finds; empty
 * when it passes. A pod control finds nothing here: its pods are read one by
 * one (checkCisPodControl).
 */
export function evaluateCisClusterControl(
  id: string,
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  switch (id) {
    case "5.1.1":
      return clusterAdminFindings(snapshot);
    case "5.1.3":
      return wildcardFindings(snapshot);
    case "5.1.5":
      return defaultServiceAccountFindings(snapshot);
    case "5.2.1":
      return policyMechanismFindings(snapshot);
    case "5.3.2":
      return networkPolicyFindings(snapshot);
    default: {
      const wanted: ReadonlyArray<KubernetesRbacRequest> | undefined =
        CIS_ACCESS_REQUESTS[id];

      return wanted ? accessFindings(snapshot, wanted) : [];
    }
  }
}
