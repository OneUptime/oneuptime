import { JSONObject } from "../../../../Types/JSON";
import {
  PodSecurity,
  readPodSecurity,
} from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import { KubernetesPolicyRule } from "../../../../Types/Kubernetes/KubernetesPolicyObjects";
import {
  CIS_ACCESS_REQUESTS,
  CIS_SCORED_CONTROLS,
  checkCisPodControl,
  evaluateCisClusterControl,
  findPolicyEngine,
} from "../../../../Types/Kubernetes/Compliance/CisKubernetesBenchmark";
import {
  KubernetesComplianceDetail,
  KubernetesComplianceFinding,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import {
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import {
  KubernetesComplianceBinding,
  KubernetesComplianceRole,
  OneUptimeAgentInstall,
  OneUptimeAgentNodesProxyReason,
  getNodesProxyReasons,
  getOneUptimeAgentInstall,
  isBuiltInRbacObject,
  isOneUptimeAgentObject,
  ruleGrants,
} from "../../../../Types/Kubernetes/Compliance/KubernetesRbac";
import { KubernetesVersion } from "../../../../Types/Kubernetes/Compliance/KubernetesVersion";
import { describe, expect, test } from "@jest/globals";

/*
 * The CIS Kubernetes Benchmark's policy controls the API can answer
 * (#9627): RBAC as the API server's authorizer reads it, the default
 * service accounts, each namespace's policy mechanism and NetworkPolicies,
 * and the pod controls - each against roles, bindings and pods as clusters
 * run them.
 */

const V1_31: KubernetesVersion = { major: 1, minor: 31 };
const V1_36: KubernetesVersion = { major: 1, minor: 36 };

const RBAC_DEFAULTS: Record<string, string> = {
  "kubernetes.io/bootstrapping": "rbac-defaults",
};

function rule(
  apiGroups: Array<string>,
  resources: Array<string>,
  verbs: Array<string>,
  resourceNames?: Array<string>,
): KubernetesPolicyRule {
  return resourceNames
    ? { apiGroups, resources, verbs, resourceNames }
    : { apiGroups, resources, verbs };
}

function clusterRole(
  name: string,
  rules: Array<KubernetesPolicyRule>,
  labels?: Record<string, string>,
): KubernetesComplianceRole {
  return { kind: "ClusterRole", namespace: "", name, labels, spec: { rules } };
}

function namespacedRole(
  namespace: string,
  name: string,
  rules: Array<KubernetesPolicyRule>,
): KubernetesComplianceRole {
  return { kind: "Role", namespace, name, spec: { rules } };
}

function clusterRoleBinding(
  name: string,
  role: string,
  subjects: Array<{ kind: string; name: string; namespace?: string }>,
  labels?: Record<string, string>,
): KubernetesComplianceBinding {
  return {
    kind: "ClusterRoleBinding",
    namespace: "",
    name,
    labels,
    spec: { roleRef: { kind: "ClusterRole", name: role }, subjects },
  };
}

function roleBinding(
  namespace: string,
  name: string,
  roleRef: { kind: string; name: string },
  subjects: Array<{ kind: string; name: string; namespace?: string }>,
): KubernetesComplianceBinding {
  return {
    kind: "RoleBinding",
    namespace,
    name,
    spec: { roleRef, subjects },
  };
}

// The roles every cluster has, as Kubernetes creates them.
const BUILT_IN_ROLES: Array<KubernetesComplianceRole> = [
  clusterRole("cluster-admin", [rule(["*"], ["*"], ["*"])], RBAC_DEFAULTS),
  clusterRole(
    "edit",
    [
      rule([""], ["pods", "pods/exec"], ["create", "delete", "get", "list"]),
      rule([""], ["secrets", "configmaps"], ["create", "get", "list", "watch"]),
    ],
    RBAC_DEFAULTS,
  ),
  clusterRole("system:controller:certificate-controller", [
    rule(
      ["certificates.k8s.io"],
      ["certificatesigningrequests/approval"],
      ["update"],
    ),
  ]),
];

const BUILT_IN_BINDINGS: Array<KubernetesComplianceBinding> = [
  clusterRoleBinding(
    "cluster-admin",
    "cluster-admin",
    [{ kind: "Group", name: "system:masters" }],
    RBAC_DEFAULTS,
  ),
  clusterRoleBinding(
    "system:controller:certificate-controller",
    "system:controller:certificate-controller",
    [
      {
        kind: "ServiceAccount",
        name: "certificate-controller",
        namespace: "kube-system",
      },
    ],
  ),
  clusterRoleBinding("eks:addon-cluster-admin", "cluster-admin", [
    { kind: "User", name: "eks:addon-manager" },
  ]),
];

function snapshot(
  overrides: Partial<KubernetesComplianceSnapshot> = {},
): KubernetesComplianceSnapshot {
  return {
    version: V1_31,
    provider: null,
    pods: [],
    namespaces: [],
    roles: [...BUILT_IN_ROLES],
    bindings: [...BUILT_IN_BINDINGS],
    serviceAccounts: [],
    networkPolicies: [],
    hasPolicyObjects: true,
    ...overrides,
  };
}

function pod(
  namespace: string,
  name: string,
  options: { images?: Array<string>; spec?: JSONObject } = {},
): KubernetesCompliancePod {
  return {
    namespace,
    name,
    workload: { kind: "Deployment", namespace, name },
    serviceAccountName: "default",
    security: readPodSecurity(options.spec || { containers: [{ name: "c" }] }),
    images: options.images || ["ghcr.io/acme/app:1.0"],
  };
}

function objectsOf(
  findings: Array<KubernetesComplianceFinding>,
): Array<string> {
  return findings.map((finding: KubernetesComplianceFinding): string => {
    return [finding.object.kind, finding.object.namespace, finding.object.name]
      .filter(Boolean)
      .join(" ");
  });
}

describe("RBAC as the authorizer reads it", () => {
  test("a wildcard matches every group, resource and verb", () => {
    expect(
      ruleGrants(rule(["*"], ["*"], ["*"]), {
        group: "",
        resource: "secrets",
        verb: "list",
      }),
    ).toBe(true);
  });

  test("a subresource is matched by resource/subresource or */subresource, never by resource/*", () => {
    const proxy: {
      group: string;
      resource: string;
      subresource: string;
      verb: string;
    } = {
      group: "",
      resource: "nodes",
      subresource: "proxy",
      verb: "get",
    };

    expect(ruleGrants(rule([""], ["nodes/proxy"], ["get"]), proxy)).toBe(true);
    expect(ruleGrants(rule([""], ["*/proxy"], ["get"]), proxy)).toBe(true);
    expect(ruleGrants(rule([""], ["nodes/*"], ["get"]), proxy)).toBe(false);
    expect(ruleGrants(rule([""], ["nodes"], ["get"]), proxy)).toBe(false);
  });

  test("a rule for another group, resource or verb grants nothing, and one limited to named objects is not broad access", () => {
    const secrets: { group: string; resource: string; verb: string } = {
      group: "",
      resource: "secrets",
      verb: "get",
    };

    expect(ruleGrants(rule(["apps"], ["secrets"], ["get"]), secrets)).toBe(
      false,
    );
    expect(ruleGrants(rule([""], ["configmaps"], ["get"]), secrets)).toBe(
      false,
    );
    expect(ruleGrants(rule([""], ["secrets"], ["create"]), secrets)).toBe(
      false,
    );
    expect(
      ruleGrants(rule([""], ["secrets"], ["get"], ["tls-cert"]), secrets),
    ).toBe(false);
  });

  test("the roles Kubernetes and the platforms keep up are built in", () => {
    expect(isBuiltInRbacObject({ name: "edit", labels: RBAC_DEFAULTS })).toBe(
      true,
    );
    expect(isBuiltInRbacObject({ name: "system:node" })).toBe(true);
    expect(isBuiltInRbacObject({ name: "eks:node-manager" })).toBe(true);
    expect(isBuiltInRbacObject({ name: "gce:cloud-provider" })).toBe(true);
    expect(isBuiltInRbacObject({ name: "ci-deployer" })).toBe(false);
  });

  // kubeadm makes them again on every init and upgrade, kind's clusters included.
  test("kubeadm's own bindings are built in, and a name merely containing kubeadm is not", () => {
    expect(
      isBuiltInRbacObject({ name: "kubeadm:apiserver-kubelet-client" }),
    ).toBe(true);
    expect(isBuiltInRbacObject({ name: "kubeadm:cluster-admins" })).toBe(true);
    expect(isBuiltInRbacObject({ name: "kubeadm:get-nodes" })).toBe(true);
    expect(isBuiltInRbacObject({ name: "my-kubeadm:admins" })).toBe(false);
    expect(isBuiltInRbacObject({ name: "kubeadm-admins" })).toBe(false);
  });
});

/*
 * What kubeadm binds on every cluster it makes (kind's too), as `kubectl get
 * clusterrolebindings` shows it: the API server's client for the kubelets,
 * which reaches nodes/proxy, and admin.conf's group, bound to cluster-admin.
 */
const KUBEADM_BINDINGS: Array<KubernetesComplianceBinding> = [
  clusterRoleBinding(
    "kubeadm:apiserver-kubelet-client",
    "system:kubelet-api-admin",
    [{ kind: "User", name: "kube-apiserver-kubelet-client" }],
  ),
  clusterRoleBinding("kubeadm:cluster-admins", "cluster-admin", [
    { kind: "Group", name: "kubeadm:cluster-admins" },
  ]),
];

const KUBELET_API_ADMIN: KubernetesComplianceRole = clusterRole(
  "system:kubelet-api-admin",
  [
    rule(
      [""],
      ["nodes/proxy", "nodes/log", "nodes/stats", "nodes/metrics"],
      ["*"],
    ),
  ],
  RBAC_DEFAULTS,
);

describe("kubeadm's own bindings", () => {
  test("pass 5.1.1 and 5.1.10: kubeadm keeps them up, not the cluster's owner", () => {
    const cluster: KubernetesComplianceSnapshot = snapshot({
      roles: [...BUILT_IN_ROLES, KUBELET_API_ADMIN],
      bindings: [...BUILT_IN_BINDINGS, ...KUBEADM_BINDINGS],
    });

    expect(evaluateCisClusterControl("5.1.1", cluster)).toEqual([]);
    expect(evaluateCisClusterControl("5.1.10", cluster)).toEqual([]);
  });
});

describe("5.1.1 cluster-admin bound only where needed", () => {
  test("passes a cluster where only Kubernetes and the platform bind cluster-admin", () => {
    expect(evaluateCisClusterControl("5.1.1", snapshot())).toEqual([]);
  });

  test("fails each binding of cluster-admin the cluster's owner made, naming whom it grants", () => {
    const findings: Array<KubernetesComplianceFinding> =
      evaluateCisClusterControl(
        "5.1.1",
        snapshot({
          bindings: [
            ...BUILT_IN_BINDINGS,
            clusterRoleBinding("ci-deployer", "cluster-admin", [
              { kind: "ServiceAccount", name: "deployer", namespace: "ci" },
              { kind: "User", name: "jane@example.com" },
            ]),
            roleBinding(
              "payments",
              "payments-admin",
              { kind: "ClusterRole", name: "cluster-admin" },
              [{ kind: "Group", name: "payments-oncall" }],
            ),
          ],
        }),
      );

    expect(findings).toEqual([
      {
        object: {
          kind: "ClusterRoleBinding",
          namespace: "",
          name: "ci-deployer",
        },
        details: [
          { field: "roleRef", value: "ClusterRole cluster-admin" },
          {
            field: "subjects",
            value: "ServiceAccount ci/deployer, User jane@example.com",
          },
        ],
      },
      {
        object: {
          kind: "RoleBinding",
          namespace: "payments",
          name: "payments-admin",
        },
        details: [
          { field: "roleRef", value: "ClusterRole cluster-admin" },
          { field: "subjects", value: "Group payments-oncall" },
        ],
      },
    ]);
  });

  test("a binding with no subjects grants nothing", () => {
    expect(
      evaluateCisClusterControl(
        "5.1.1",
        snapshot({
          bindings: [clusterRoleBinding("orphan", "cluster-admin", [])],
        }),
      ),
    ).toEqual([]);
  });
});

describe("5.1.2-5.1.13 least access", () => {
  test("5.1.2: a team bound to the built-in edit role can read every Secret of its namespace", () => {
    const findings: Array<KubernetesComplianceFinding> =
      evaluateCisClusterControl(
        "5.1.2",
        snapshot({
          bindings: [
            ...BUILT_IN_BINDINGS,
            roleBinding(
              "web",
              "web-devs",
              { kind: "ClusterRole", name: "edit" },
              [{ kind: "Group", name: "web-devs" }],
            ),
          ],
        }),
      );

    expect(objectsOf(findings)).toEqual(["RoleBinding web web-devs"]);
    expect(findings[0]!.details).toContainEqual({
      field: "verbs",
      value: "get secrets, list secrets, watch secrets",
    });
  });

  test("5.1.2: a role that reads only the Secrets it names passes", () => {
    expect(
      evaluateCisClusterControl(
        "5.1.2",
        snapshot({
          roles: [
            ...BUILT_IN_ROLES,
            namespacedRole("cert-manager", "tls-reader", [
              rule([""], ["secrets"], ["get", "watch"], ["ca-key-pair"]),
            ]),
          ],
          bindings: [
            roleBinding(
              "cert-manager",
              "tls-reader",
              { kind: "Role", name: "tls-reader" },
              [
                {
                  kind: "ServiceAccount",
                  name: "cert-manager",
                  namespace: "cert-manager",
                },
              ],
            ),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a RoleBinding resolves a Role of its own namespace only, and a binding to a missing role grants nothing", () => {
    expect(
      evaluateCisClusterControl(
        "5.1.4",
        snapshot({
          roles: [
            ...BUILT_IN_ROLES,
            namespacedRole("ci", "pod-launcher", [
              rule([""], ["pods"], ["create"]),
            ]),
          ],
          bindings: [
            roleBinding(
              "ci",
              "runner",
              { kind: "Role", name: "pod-launcher" },
              [{ kind: "ServiceAccount", name: "runner" }],
            ),
            // The same Role's name in another namespace is another Role, which does not exist.
            roleBinding(
              "web",
              "runner",
              { kind: "Role", name: "pod-launcher" },
              [{ kind: "ServiceAccount", name: "runner" }],
            ),
            roleBinding(
              "web",
              "gone",
              { kind: "ClusterRole", name: "deleted-role" },
              [{ kind: "User", name: "sam" }],
            ),
          ],
        }),
      ),
    ).toEqual([
      {
        object: { kind: "RoleBinding", namespace: "ci", name: "runner" },
        details: [
          { field: "roleRef", value: "Role pod-launcher" },
          { field: "subjects", value: "ServiceAccount runner" },
          { field: "verbs", value: "create pods" },
        ],
      },
    ]);
  });

  test("5.1.8, 5.1.9, 5.1.11, 5.1.12 and 5.1.13 each find the binding that grants their right", () => {
    const grants: Record<string, KubernetesPolicyRule> = {
      "5.1.8": rule([""], ["users"], ["impersonate"]),
      "5.1.9": rule([""], ["persistentvolumes"], ["create"]),
      "5.1.11": rule(
        ["certificates.k8s.io"],
        ["certificatesigningrequests/approval"],
        ["update"],
      ),
      "5.1.12": rule(
        ["admissionregistration.k8s.io"],
        ["mutatingwebhookconfigurations"],
        ["patch"],
      ),
      "5.1.13": rule([""], ["serviceaccounts/token"], ["create"]),
    };

    for (const [id, granted] of Object.entries(grants)) {
      const roleName: string = `grants-${id}`;
      const cluster: KubernetesComplianceSnapshot = snapshot({
        roles: [...BUILT_IN_ROLES, clusterRole(roleName, [granted])],
        bindings: [
          ...BUILT_IN_BINDINGS,
          clusterRoleBinding(roleName, roleName, [
            { kind: "User", name: "ops" },
          ]),
        ],
      });

      expect([id, objectsOf(evaluateCisClusterControl(id, cluster))]).toEqual([
        id,
        [`ClusterRoleBinding ${roleName}`],
      ]);

      // And no other access control finds it, but the ones its right is part of.
      for (const other of Object.keys(CIS_ACCESS_REQUESTS)) {
        if (other !== id) {
          expect([
            id,
            other,
            evaluateCisClusterControl(other, cluster),
          ]).toEqual([id, other, []]);
        }
      }
    }
  });

  test("5.1.10: the nodes/proxy grant an agent's ClusterRole holds is found", () => {
    const findings: Array<KubernetesComplianceFinding> =
      evaluateCisClusterControl(
        "5.1.10",
        snapshot({
          roles: [
            ...BUILT_IN_ROLES,
            clusterRole("oneuptime-kubernetes-agent", [
              rule(
                [""],
                ["pods", "nodes", "nodes/proxy", "nodes/stats"],
                ["get", "list", "watch"],
              ),
            ]),
          ],
          bindings: [
            ...BUILT_IN_BINDINGS,
            clusterRoleBinding(
              "oneuptime-kubernetes-agent",
              "oneuptime-kubernetes-agent",
              [
                {
                  kind: "ServiceAccount",
                  name: "oneuptime-kubernetes-agent",
                  namespace: "oneuptime-agent",
                },
              ],
            ),
          ],
        }),
      );

    expect(objectsOf(findings)).toEqual([
      "ClusterRoleBinding oneuptime-kubernetes-agent",
    ]);
    expect(findings[0]!.details).toContainEqual({
      field: "verbs",
      value: "get nodes/proxy",
    });
  });

  test("the built-in controllers' own bindings are left out", () => {
    // system:controller:certificate-controller approves CSRs: Kubernetes' own.
    expect(evaluateCisClusterControl("5.1.11", snapshot())).toEqual([]);
  });
});

/*
 * The OneUptime agent's own binding (#9878). The kubernetes-agent chart labels
 * what it makes with its chart and OneUptime, and labels its ClusterRole with
 * why it still grants nodes/proxy: the page says the binding is the agent's,
 * and why.
 */
const AGENT_LABELS: Record<string, string> = {
  "helm.sh/chart": "kubernetes-agent-16.2.0",
  "app.kubernetes.io/part-of": "oneuptime",
  "app.kubernetes.io/name": "kubernetes-agent",
  "app.kubernetes.io/instance": "oneuptime-agent",
  "app.kubernetes.io/managed-by": "Helm",
};

function agentCluster(options: {
  roleLabels?: Record<string, string>;
  rules?: Array<KubernetesPolicyRule>;
  bindingLabels?: Record<string, string>;
}): KubernetesComplianceSnapshot {
  return snapshot({
    roles: [
      ...BUILT_IN_ROLES,
      clusterRole(
        "oneuptime-agent-kubernetes-agent",
        options.rules || [
          rule([""], ["pods", "nodes"], ["get", "list", "watch"]),
          rule([""], ["nodes/stats", "nodes/metrics", "nodes/pods"], ["get"]),
          rule([""], ["nodes/proxy"], ["get"]),
        ],
        options.roleLabels || AGENT_LABELS,
      ),
    ],
    bindings: [
      ...BUILT_IN_BINDINGS,
      clusterRoleBinding(
        "oneuptime-agent-kubernetes-agent",
        "oneuptime-agent-kubernetes-agent",
        [
          {
            kind: "ServiceAccount",
            name: "oneuptime-agent-kubernetes-agent",
            namespace: "oneuptime-agent",
          },
        ],
        options.bindingLabels || AGENT_LABELS,
      ),
    ],
  });
}

describe("the OneUptime agent's own binding", () => {
  test("is told by its chart's labels, whatever its release is called", () => {
    expect(isOneUptimeAgentObject({ name: "x", labels: AGENT_LABELS })).toBe(
      true,
    );
    expect(
      isOneUptimeAgentObject({
        name: "acme-agent",
        labels: {
          "helm.sh/chart": "kubernetes-agent-0.7.3",
          "app.kubernetes.io/part-of": "oneuptime",
        },
      }),
    ).toBe(true);
    // The OneUptime server's own chart, another chart named like it, no labels.
    expect(
      isOneUptimeAgentObject({
        name: "oneuptime",
        labels: {
          "helm.sh/chart": "oneuptime-16.2.0",
          "app.kubernetes.io/part-of": "oneuptime",
        },
      }),
    ).toBe(false);
    expect(
      isOneUptimeAgentObject({
        name: "kubernetes-agent",
        labels: { "helm.sh/chart": "kubernetes-agent-1.0.0" },
      }),
    ).toBe(false);
    expect(isOneUptimeAgentObject({ name: "oneuptime-agent" })).toBe(false);
  });

  test("reads why its role grants nodes/proxy, in one order, leaving out a word it does not know", () => {
    const reasons: (value: string) => Array<OneUptimeAgentNodesProxyReason> = (
      value: string,
    ): Array<OneUptimeAgentNodesProxyReason> => {
      return getNodesProxyReasons({
        name: "agent",
        labels: { "oneuptime.com/nodes-proxy": value },
      });
    };

    expect(reasons("kubelet-pods")).toEqual([
      OneUptimeAgentNodesProxyReason.KubeletPods,
    ]);
    expect(reasons("cost-prometheus.kubelet-pods")).toEqual([
      OneUptimeAgentNodesProxyReason.KubeletPods,
      OneUptimeAgentNodesProxyReason.CostPrometheus,
    ]);
    expect(reasons("cost-prometheus.something-newer")).toEqual([
      OneUptimeAgentNodesProxyReason.CostPrometheus,
    ]);
    expect(reasons("")).toEqual([]);
    expect(getNodesProxyReasons({ name: "agent" })).toEqual([]);
    expect(getNodesProxyReasons(null)).toEqual([]);
  });

  test("fails 5.1.10 while it grants nodes/proxy, saying it is the agent's and why", () => {
    const findings: Array<KubernetesComplianceFinding> =
      evaluateCisClusterControl(
        "5.1.10",
        agentCluster({
          roleLabels: {
            ...AGENT_LABELS,
            "oneuptime.com/nodes-proxy": "kubelet-pods",
          },
        }),
      );

    expect(findings).toEqual([
      {
        object: {
          kind: "ClusterRoleBinding",
          namespace: "",
          name: "oneuptime-agent-kubernetes-agent",
        },
        details: [
          {
            field: "roleRef",
            value: "ClusterRole oneuptime-agent-kubernetes-agent",
          },
          {
            field: "subjects",
            value:
              "ServiceAccount oneuptime-agent/oneuptime-agent-kubernetes-agent",
          },
          { field: "verbs", value: "get nodes/proxy" },
        ],
        oneUptimeAgent: {
          nodesProxyReasons: [OneUptimeAgentNodesProxyReason.KubeletPods],
          installedAs: OneUptimeAgentInstall.Helm,
        },
      },
    ]);
  });

  test("names both reasons when the cost Prometheus needs it too", () => {
    expect(
      evaluateCisClusterControl(
        "5.1.10",
        agentCluster({
          roleLabels: {
            ...AGENT_LABELS,
            "oneuptime.com/nodes-proxy": "kubelet-pods.cost-prometheus",
          },
        }),
      )[0]!.oneUptimeAgent,
    ).toEqual({
      nodesProxyReasons: [
        OneUptimeAgentNodesProxyReason.KubeletPods,
        OneUptimeAgentNodesProxyReason.CostPrometheus,
      ],
      installedAs: OneUptimeAgentInstall.Helm,
    });
  });

  /*
   * The Amazon EKS add-on is the same chart, which labels its ClusterRole
   * with how it was installed (#9928): its buyer drops nodes/proxy with the
   * add-on's configuration values, so the page names those.
   */
  test("reads how the agent was installed: the Amazon EKS add-on as its label says, Helm otherwise", () => {
    const install: (
      labels?: Record<string, string>,
    ) => OneUptimeAgentInstall = (
      labels?: Record<string, string>,
    ): OneUptimeAgentInstall => {
      return getOneUptimeAgentInstall({ name: "agent", labels });
    };

    expect(install({ "oneuptime.com/installed-as": "aws-eks-addon" })).toBe(
      OneUptimeAgentInstall.AwsEksAddon,
    );
    // A chart before the label, an empty one, and a word the page does not know.
    expect(install()).toBe(OneUptimeAgentInstall.Helm);
    expect(install({ "oneuptime.com/installed-as": "" })).toBe(
      OneUptimeAgentInstall.Helm,
    );
    expect(install({ "oneuptime.com/installed-as": "gke-marketplace" })).toBe(
      OneUptimeAgentInstall.Helm,
    );
    expect(getOneUptimeAgentInstall(null)).toBe(OneUptimeAgentInstall.Helm);
  });

  test("the Amazon EKS add-on's binding says it is the add-on's", () => {
    expect(
      evaluateCisClusterControl(
        "5.1.10",
        agentCluster({
          roleLabels: {
            ...AGENT_LABELS,
            "oneuptime.com/nodes-proxy": "kubelet-pods",
            "oneuptime.com/installed-as": "aws-eks-addon",
          },
        }),
      )[0]!.oneUptimeAgent,
    ).toEqual({
      nodesProxyReasons: [OneUptimeAgentNodesProxyReason.KubeletPods],
      installedAs: OneUptimeAgentInstall.AwsEksAddon,
    });
  });

  test("from a chart before the label, it is still the agent's, with no reason given", () => {
    const findings: Array<KubernetesComplianceFinding> =
      evaluateCisClusterControl(
        "5.1.10",
        agentCluster({
          // As charts before #9878 made it: nodes/proxy with get, list and watch.
          rules: [
            rule(
              [""],
              ["pods", "nodes", "nodes/proxy", "nodes/stats"],
              ["get", "list", "watch"],
            ),
          ],
        }),
      );

    expect(findings[0]!.oneUptimeAgent).toEqual({
      nodesProxyReasons: [],
      installedAs: OneUptimeAgentInstall.Helm,
    });
  });

  test("passes 5.1.10 once its role grants no nodes/proxy, only the kubelet's own subresources", () => {
    expect(
      evaluateCisClusterControl(
        "5.1.10",
        agentCluster({
          rules: [
            rule([""], ["pods", "nodes"], ["get", "list", "watch"]),
            rule([""], ["nodes/stats", "nodes/metrics", "nodes/pods"], ["get"]),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a binding someone else made that grants nodes/proxy is the cluster owner's, even named like the agent's", () => {
    const findings: Array<KubernetesComplianceFinding> =
      evaluateCisClusterControl("5.1.10", agentCluster({ bindingLabels: {} }));

    expect(objectsOf(findings)).toEqual([
      "ClusterRoleBinding oneuptime-agent-kubernetes-agent",
    ]);
    expect(findings[0]!.oneUptimeAgent).toBeUndefined();
  });
});

describe("5.1.3 no wildcards in roles", () => {
  test("fails a role the cluster's owner made with a wildcard, by each field that has one", () => {
    expect(
      evaluateCisClusterControl(
        "5.1.3",
        snapshot({
          roles: [
            ...BUILT_IN_ROLES,
            namespacedRole("web", "deployer", [
              rule(["apps"], ["deployments"], ["get", "update"]),
              rule(["apps", "batch"], ["*"], ["*"]),
            ]),
            clusterRole("monitoring-read", [
              rule([""], ["pods", "nodes"], ["get", "list"]),
            ]),
          ],
        }),
      ),
    ).toEqual([
      {
        object: { kind: "Role", namespace: "web", name: "deployer" },
        details: [
          { field: "rules[1].resources", value: "*" },
          { field: "rules[1].verbs", value: "*" },
        ],
      },
    ]);
  });

  test("passes the built-in cluster-admin, which is all wildcards", () => {
    expect(evaluateCisClusterControl("5.1.3", snapshot())).toEqual([]);
  });
});

describe("5.1.5 default service accounts not used", () => {
  test("fails a default service account that mounts its token, and one a binding grants a role", () => {
    const findings: Array<KubernetesComplianceFinding> =
      evaluateCisClusterControl(
        "5.1.5",
        snapshot({
          serviceAccounts: [
            { namespace: "payments", name: "default", spec: {} },
            {
              namespace: "web",
              name: "default",
              spec: { automountServiceAccountToken: false },
            },
            {
              namespace: "secure",
              name: "default",
              spec: { automountServiceAccountToken: false },
            },
            { namespace: "web", name: "api", spec: {} },
          ],
          bindings: [
            ...BUILT_IN_BINDINGS,
            // A RoleBinding's ServiceAccount with no namespace is of the binding's.
            roleBinding(
              "web",
              "default-view",
              { kind: "ClusterRole", name: "view" },
              [{ kind: "ServiceAccount", name: "default" }],
            ),
          ],
        }),
      );

    expect(findings).toEqual([
      {
        object: {
          kind: "ServiceAccount",
          namespace: "payments",
          name: "default",
        },
        details: [{ field: "automountServiceAccountToken", isNotSet: true }],
      },
      {
        object: { kind: "ServiceAccount", namespace: "web", name: "default" },
        details: [
          { field: "RoleBinding web/default-view", value: "ClusterRole view" },
        ],
      },
    ]);
  });
});

describe("5.2.1 a policy control mechanism in place", () => {
  const namespaces: Array<{ name: string; labels: Record<string, string> }> = [
    {
      name: "payments",
      labels: { "pod-security.kubernetes.io/enforce": "restricted" },
    },
    { name: "web", labels: { "kubernetes.io/metadata.name": "web" } },
    {
      name: "legacy",
      labels: { "pod-security.kubernetes.io/enforce": "privileged" },
    },
    { name: "empty", labels: {} },
  ];
  const pods: Array<KubernetesCompliancePod> = [
    pod("payments", "api"),
    pod("web", "frontend"),
    pod("legacy", "batch"),
  ];

  test("fails each namespace that runs pods with no level enforced, or privileged", () => {
    expect(
      evaluateCisClusterControl("5.2.1", snapshot({ namespaces, pods })),
    ).toEqual([
      {
        object: { kind: "Namespace", namespace: "legacy", name: "legacy" },
        details: [
          {
            field: 'metadata.labels["pod-security.kubernetes.io/enforce"]',
            value: "privileged",
          },
        ],
      },
      {
        object: { kind: "Namespace", namespace: "web", name: "web" },
        details: [
          {
            field: 'metadata.labels["pod-security.kubernetes.io/enforce"]',
            isNotSet: true,
          },
        ],
      },
    ]);
  });

  test("passes when a policy engine runs, or on OpenShift, whose security context constraints always do", () => {
    expect(
      evaluateCisClusterControl(
        "5.2.1",
        snapshot({
          namespaces,
          pods: [
            ...pods,
            pod("kyverno", "kyverno-admission-controller", {
              images: ["reg.kyverno.io/kyverno/kyverno:v1.13.2"],
            }),
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      evaluateCisClusterControl(
        "5.2.1",
        snapshot({ namespaces, pods, provider: "OpenShift" }),
      ),
    ).toEqual([]);
  });

  test("tells a policy engine's pods by their images", () => {
    function engineOf(image: string): string | null {
      return findPolicyEngine({ pods: [pod("x", "y", { images: [image] })] });
    }

    expect(engineOf("ghcr.io/kyverno/kyverno:v1.12.5")).toBe("Kyverno");
    expect(
      engineOf(
        "reg.kyverno.io/kyverno/kyverno@sha256:2c5e4f7b0c1d3a9e8f6b5a4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e",
      ),
    ).toBe("Kyverno");
    expect(engineOf("openpolicyagent/gatekeeper:v3.17.1")).toBe("Gatekeeper");
    expect(engineOf("ghcr.io/kubewarden/kubewarden-controller:v1.17.0")).toBe(
      "Kubewarden",
    );
    // Mirrored into a registry of the cluster's own, with a port.
    expect(engineOf("registry.example.com:5000/mirror/gatekeeper:v3")).toBe(
      "Gatekeeper",
    );
    // Kyverno's background controller does not admit pods; its admission controller does.
    expect(
      engineOf("ghcr.io/kyverno/background-controller:v1.12.5"),
    ).toBeNull();
    expect(engineOf("ghcr.io/acme/kyverno-dashboard:1")).toBeNull();
    expect(engineOf("nginx:1.27")).toBeNull();
  });
});

describe("5.3.2 NetworkPolicies in every namespace", () => {
  test("fails each namespace that runs pods with no NetworkPolicy", () => {
    expect(
      objectsOf(
        evaluateCisClusterControl(
          "5.3.2",
          snapshot({
            pods: [pod("payments", "api"), pod("web", "frontend")],
            networkPolicies: [
              {
                namespace: "payments",
                name: "default-deny",
                spec: {
                  selectsAllPods: true,
                  policyTypes: ["Ingress"],
                  ingressRuleCount: 0,
                  egressRuleCount: 0,
                },
              },
              { namespace: "idle", name: "deny", spec: null },
            ],
          }),
        ),
      ),
    ).toEqual(["Namespace web web"]);
  });
});

describe("the pod controls", () => {
  function details(
    id: string,
    spec: JSONObject,
    options: { namespace?: string; version?: KubernetesVersion } = {},
  ): Array<KubernetesComplianceDetail> {
    const security: PodSecurity = readPodSecurity(spec);

    return checkCisPodControl(id, security, {
      namespace: options.namespace || "web",
      version: options.version || V1_31,
    });
  }

  const PRIVILEGED_AGENT: JSONObject = {
    hostNetwork: true,
    hostPID: true,
    hostIPC: true,
    containers: [
      {
        name: "agent",
        ports: [{ containerPort: 9100, hostPort: 9100 }],
        securityContext: {
          privileged: true,
          capabilities: { add: ["SYS_ADMIN", "NET_RAW"] },
          runAsUser: 0,
        },
        env: [
          {
            name: "API_KEY",
            valueFrom: { secretKeyRef: { name: "agent-key", key: "key" } },
          },
        ],
        envFrom: [{ secretRef: { name: "agent-env" } }],
      },
    ],
    volumes: [{ name: "root", hostPath: { path: "/" } }],
  };

  const HARDENED: JSONObject = {
    securityContext: {
      runAsNonRoot: true,
      runAsUser: 10001,
      seccompProfile: { type: "RuntimeDefault" },
    },
    containers: [
      {
        name: "api",
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"] },
        },
        volumeMounts: [{ name: "creds", mountPath: "/etc/creds" }],
      },
    ],
    volumes: [{ name: "creds", secret: { secretName: "api-creds" } }],
  };

  test("a hardened workload passes every one of them", () => {
    for (const [id, evaluation] of Object.entries(CIS_SCORED_CONTROLS)) {
      if (evaluation === "Pods") {
        expect([id, details(id, HARDENED)]).toEqual([id, []]);
      }
    }
  });

  test("a privileged node agent fails each, saying by which field", () => {
    expect(details("5.2.2", PRIVILEGED_AGENT)).toEqual([
      {
        container: "agent",
        field: "securityContext.privileged",
        value: "true",
      },
    ]);
    expect(details("5.2.3", PRIVILEGED_AGENT)).toEqual([
      { field: "hostPID", value: "true" },
    ]);
    expect(details("5.2.4", PRIVILEGED_AGENT)).toEqual([
      { field: "hostIPC", value: "true" },
    ]);
    expect(details("5.2.5", PRIVILEGED_AGENT)).toEqual([
      { field: "hostNetwork", value: "true" },
    ]);
    expect(details("5.2.6", PRIVILEGED_AGENT)).toEqual([
      {
        container: "agent",
        field: "securityContext.allowPrivilegeEscalation",
        isNotSet: true,
      },
    ]);
    expect(details("5.2.7", PRIVILEGED_AGENT)).toEqual([
      {
        container: "agent",
        field: "securityContext.runAsNonRoot",
        isNotSet: true,
      },
      { container: "agent", field: "securityContext.runAsUser", value: "0" },
    ]);
    expect(details("5.2.8", PRIVILEGED_AGENT)).toEqual([
      {
        container: "agent",
        field: "securityContext.capabilities.add",
        value: "NET_RAW",
      },
    ]);
    expect(details("5.2.9", PRIVILEGED_AGENT)).toEqual([
      {
        container: "agent",
        field: "securityContext.capabilities.drop",
        isNotSet: true,
      },
      {
        container: "agent",
        field: "securityContext.capabilities.add",
        value: "SYS_ADMIN, NET_RAW",
      },
    ]);
    expect(details("5.2.11", PRIVILEGED_AGENT)).toEqual([
      { volume: "root", field: "hostPath", value: "/" },
    ]);
    expect(details("5.2.12", PRIVILEGED_AGENT)).toEqual([
      { container: "agent", field: "ports[*].hostPort", value: "9100" },
    ]);
    expect(details("5.4.1", PRIVILEGED_AGENT)).toEqual([
      {
        container: "agent",
        field: "env[API_KEY].valueFrom.secretKeyRef",
        value: "agent-key",
      },
      { container: "agent", field: "envFrom[*].secretRef", value: "agent-env" },
    ]);
    expect(details("5.6.2", PRIVILEGED_AGENT)).toEqual([
      {
        container: "agent",
        field: "securityContext.seccompProfile.type",
        isNotSet: true,
      },
    ]);
  });

  test("5.2.8: a container keeps NET_RAW unless it drops it or ALL", () => {
    expect(
      details("5.2.8", {
        containers: [
          {
            name: "a",
            securityContext: { capabilities: { drop: ["NET_RAW"] } },
          },
          { name: "b", securityContext: { capabilities: { drop: ["MKNOD"] } } },
        ],
      }),
    ).toEqual([
      {
        container: "b",
        field: "securityContext.capabilities.drop",
        value: "MKNOD",
      },
    ]);
  });

  test("5.2.10: a Windows HostProcess pod", () => {
    expect(
      details("5.2.10", {
        os: { name: "windows" },
        securityContext: { windowsOptions: { hostProcess: true } },
        containers: [{ name: "w" }],
      }),
    ).toEqual([
      { field: "securityContext.windowsOptions.hostProcess", value: "true" },
    ]);
  });

  test("5.6.4: a workload in the default namespace, and no other", () => {
    expect(details("5.6.4", HARDENED, { namespace: "default" })).toEqual([
      { field: "metadata.namespace", value: "default" },
    ]);
    expect(details("5.6.4", HARDENED, { namespace: "web" })).toEqual([]);
  });

  test("a Windows pod has no Linux capabilities or seccomp to set", () => {
    const windows: JSONObject = {
      os: { name: "windows" },
      containers: [{ name: "iis" }],
    };

    for (const id of ["5.2.6", "5.2.8", "5.2.9", "5.6.2"]) {
      expect([id, details(id, windows)]).toEqual([id, []]);
    }
  });

  test("5.2.7: a pod in its own user namespace is no root on the node, from 1.36", () => {
    const rootInItsNamespace: JSONObject = {
      hostUsers: false,
      containers: [{ name: "c", securityContext: { runAsUser: 0 } }],
    };

    expect(details("5.2.7", rootInItsNamespace, { version: V1_36 })).toEqual(
      [],
    );
    expect(
      details("5.2.7", rootInItsNamespace, { version: V1_31 }),
    ).toHaveLength(2);
  });

  test("a control that reads the cluster finds nothing on a pod", () => {
    expect(details("5.1.1", PRIVILEGED_AGENT)).toEqual([]);
  });
});
