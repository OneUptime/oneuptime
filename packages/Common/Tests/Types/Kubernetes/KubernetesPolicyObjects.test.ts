import { JSONObject } from "../../../Types/JSON";
import {
  ExtractedInventoryRecord,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  KubernetesNetworkPolicySpec,
  KubernetesPolicyObject,
  KubernetesRoleBindingSpec,
  KubernetesRoleSpec,
  KubernetesServiceAccountSpec,
  parseNetworkPolicyObject,
  parseRoleBindingObject,
  parseRoleObject,
  parseServiceAccountObject,
  readNetworkPolicySpec,
  readRoleBindingSpec,
  readRoleSpec,
  readServiceAccountSpec,
  toNetworkPolicySpec,
} from "../../../Types/Kubernetes/KubernetesPolicyObjects";
import { describe, expect, test } from "@jest/globals";

/*
 * The RBAC objects, ServiceAccounts and NetworkPolicies the agent reads for
 * the CIS Kubernetes Benchmark (#9627): from the OTLP encoding it sends them
 * in to the few fields the inventory keeps, and back from a stored row.
 */

// --- The OTLP encoding, as the agent's k8sobjects pull sends an object.

function kv(entries: Array<[string, JSONObject]>): JSONObject {
  return {
    values: entries.map(([key, value]: [string, JSONObject]) => {
      return { key, value };
    }),
  };
}

function str(value: string): JSONObject {
  return { stringValue: value };
}

function bool(value: boolean): JSONObject {
  return { boolValue: value };
}

function obj(kvList: JSONObject): JSONObject {
  return { kvlistValue: kvList };
}

function arr(items: Array<JSONObject>): JSONObject {
  return { arrayValue: { values: items } };
}

function strings(items: Array<string>): JSONObject {
  return arr(items.map(str));
}

function metadata(name: string, namespace?: string): [string, JSONObject] {
  return [
    "metadata",
    obj(
      kv([
        ["name", str(name)],
        ...(namespace
          ? ([["namespace", str(namespace)]] as Array<[string, JSONObject]>)
          : []),
        [
          "labels",
          obj(kv([["kubernetes.io/bootstrapping", str("rbac-defaults")]])),
        ],
      ]),
    ),
  ];
}

const CLUSTER_ADMIN_ROLE: JSONObject = kv([
  ["kind", str("ClusterRole")],
  metadata("cluster-admin"),
  [
    "rules",
    arr([
      obj(
        kv([
          ["apiGroups", strings(["*"])],
          ["resources", strings(["*"])],
          ["verbs", strings(["*"])],
        ]),
      ),
      obj(
        kv([
          ["nonResourceURLs", strings(["*"])],
          ["verbs", strings(["*"])],
        ]),
      ),
    ]),
  ],
]);

const CI_BINDING: JSONObject = kv([
  ["kind", str("ClusterRoleBinding")],
  metadata("ci-deployer"),
  [
    "roleRef",
    obj(
      kv([
        ["apiGroup", str("rbac.authorization.k8s.io")],
        ["kind", str("ClusterRole")],
        ["name", str("cluster-admin")],
      ]),
    ),
  ],
  [
    "subjects",
    arr([
      obj(
        kv([
          ["kind", str("ServiceAccount")],
          ["name", str("deployer")],
          ["namespace", str("ci")],
        ]),
      ),
      obj(
        kv([
          ["kind", str("User")],
          ["name", str("jane@example.com")],
          ["apiGroup", str("rbac.authorization.k8s.io")],
        ]),
      ),
    ]),
  ],
]);

describe("RBAC objects", () => {
  test("a ClusterRole keeps its rules, its non-resource URLs included", () => {
    const role: KubernetesPolicyObject<KubernetesRoleSpec> | null =
      parseRoleObject(CLUSTER_ADMIN_ROLE);

    expect(role?.metadata.name).toBe("cluster-admin");
    expect(role?.metadata.labels).toEqual({
      "kubernetes.io/bootstrapping": "rbac-defaults",
    });
    expect(role?.spec).toEqual({
      rules: [
        { apiGroups: ["*"], resources: ["*"], verbs: ["*"] },
        {
          apiGroups: [],
          resources: [],
          verbs: ["*"],
          nonResourceURLs: ["*"],
        },
      ],
    });
  });

  test("a Role keeps the names a rule is limited to, and an aggregated ClusterRole says so", () => {
    expect(
      readRoleSpec({
        rules: [
          {
            apiGroups: [""],
            resources: ["secrets"],
            resourceNames: ["tls-cert"],
            verbs: ["get"],
          },
        ],
      }),
    ).toEqual({
      rules: [
        {
          apiGroups: [""],
          resources: ["secrets"],
          verbs: ["get"],
          resourceNames: ["tls-cert"],
        },
      ],
    });
    expect(
      readRoleSpec({
        aggregationRule: {
          clusterRoleSelectors: [
            {
              matchLabels: {
                "rbac.example.com/aggregate-to-monitoring": "true",
              },
            },
          ],
        },
        rules: [],
      }),
    ).toEqual({ rules: [], isAggregated: true });
  });

  test("a binding keeps the role it grants and every subject, a ServiceAccount's namespace too", () => {
    const binding: KubernetesPolicyObject<KubernetesRoleBindingSpec> | null =
      parseRoleBindingObject(CI_BINDING);

    expect(binding?.spec).toEqual({
      roleRef: { kind: "ClusterRole", name: "cluster-admin" },
      subjects: [
        { kind: "ServiceAccount", name: "deployer", namespace: "ci" },
        { kind: "User", name: "jane@example.com" },
      ],
    });
  });

  test("a binding with no subjects, or with one missing its name, keeps only the whole ones", () => {
    expect(
      readRoleBindingSpec({
        roleRef: { kind: "Role", name: "reader" },
        subjects: [{ kind: "User" }, { kind: "Group", name: "devs" }, "x"],
      }),
    ).toEqual({
      roleRef: { kind: "Role", name: "reader" },
      subjects: [{ kind: "Group", name: "devs" }],
    });
    expect(readRoleBindingSpec({})).toEqual({
      roleRef: { kind: "", name: "" },
      subjects: [],
    });
  });

  test("a stored spec reads back as it was written", () => {
    const role: KubernetesRoleSpec = parseRoleObject(CLUSTER_ADMIN_ROLE)!.spec;
    const binding: KubernetesRoleBindingSpec =
      parseRoleBindingObject(CI_BINDING)!.spec;

    expect(readRoleSpec(JSON.parse(JSON.stringify(role)))).toEqual(role);
    expect(readRoleBindingSpec(JSON.parse(JSON.stringify(binding)))).toEqual(
      binding,
    );
  });
});

describe("ServiceAccounts", () => {
  test("a ServiceAccount keeps whether its token is mounted, and never its Secrets", () => {
    const account: KubernetesPolicyObject<KubernetesServiceAccountSpec> | null =
      parseServiceAccountObject(
        kv([
          ["kind", str("ServiceAccount")],
          metadata("default", "payments"),
          ["automountServiceAccountToken", bool(false)],
          ["secrets", arr([obj(kv([["name", str("default-token-x2k9")]]))])],
        ]),
      );

    expect(account?.metadata.namespace).toBe("payments");
    expect(account?.spec).toEqual({ automountServiceAccountToken: false });
    expect(JSON.stringify(account?.spec)).not.toContain("default-token");
  });

  test("one that does not say keeps nothing, so the default applies", () => {
    expect(readServiceAccountSpec({ metadata: { name: "default" } })).toEqual(
      {},
    );
    expect(
      readServiceAccountSpec({ automountServiceAccountToken: "true" }),
    ).toEqual({ automountServiceAccountToken: true });
  });
});

describe("NetworkPolicies", () => {
  test("a default-deny policy selects every pod and limits both ways", () => {
    const policy: KubernetesPolicyObject<KubernetesNetworkPolicySpec> | null =
      parseNetworkPolicyObject(
        kv([
          ["kind", str("NetworkPolicy")],
          metadata("default-deny", "payments"),
          [
            "spec",
            obj(
              kv([
                ["podSelector", obj(kv([]))],
                ["policyTypes", strings(["Ingress", "Egress"])],
              ]),
            ),
          ],
        ]),
      );

    expect(policy?.spec).toEqual({
      selectsAllPods: true,
      policyTypes: ["Ingress", "Egress"],
      ingressRuleCount: 0,
      egressRuleCount: 0,
    });
  });

  test("a policy for some pods counts its rules, and keeps none of its peers", () => {
    const spec: KubernetesNetworkPolicySpec = readNetworkPolicySpec({
      podSelector: { matchLabels: { app: "api" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [{ namespaceSelector: { matchLabels: { team: "web" } } }],
          ports: [{ port: 8080 }],
        },
      ],
    });

    expect(spec).toEqual({
      selectsAllPods: false,
      policyTypes: ["Ingress"],
      ingressRuleCount: 1,
      egressRuleCount: 0,
    });
    expect(toNetworkPolicySpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
    expect(toNetworkPolicySpec({})).toBeNull();
  });
});

describe("the inventory", () => {
  test("keeps each kind under its own name, with its spec and its labels", () => {
    const lastSeenAt: Date = new Date("2026-11-19T10:00:00.000Z");
    const role: ExtractedInventoryRecord | null = extractInventoryResource({
      resourceType: "clusterroles",
      logBody: JSON.stringify({ kvlistValue: CLUSTER_ADMIN_ROLE }),
      lastSeenAt,
    });
    const binding: ExtractedInventoryRecord | null = extractInventoryResource({
      resourceType: "clusterrolebindings",
      logBody: JSON.stringify({ kvlistValue: CI_BINDING }),
      lastSeenAt,
    });

    expect(role?.resource.kind).toBe("ClusterRole");
    expect(role?.resource.namespaceKey).toBe("");
    expect((role?.resource.spec as JSONObject)["rules"]).toHaveLength(2);
    expect(role?.resource.labels).toEqual({
      "kubernetes.io/bootstrapping": "rbac-defaults",
    });
    // Nothing about a role ever needs attention on the Overview.
    expect(role?.resource.healthSeverity).toBeNull();
    expect(binding?.resource.kind).toBe("ClusterRoleBinding");
    expect(readRoleBindingSpec(binding?.resource.spec).roleRef.name).toBe(
      "cluster-admin",
    );
  });

  test("a namespaced object keeps its namespace", () => {
    const record: ExtractedInventoryRecord | null = extractInventoryResource({
      resourceType: "serviceaccounts",
      logBody: JSON.stringify({
        kvlistValue: kv([
          ["kind", str("ServiceAccount")],
          metadata("default", "payments"),
        ]),
      }),
      lastSeenAt: new Date("2026-11-19T10:00:00.000Z"),
    });

    expect(record?.resource.kind).toBe("ServiceAccount");
    expect(record?.resource.namespaceKey).toBe("payments");
    expect(record?.resource.spec).toEqual({});
  });

  test("an object with no metadata is not kept", () => {
    expect(
      extractInventoryResource({
        resourceType: "roles",
        logBody: JSON.stringify({
          kvlistValue: kv([
            ["kind", str("Role")],
            ["rules", arr([])],
          ]),
        }),
        lastSeenAt: new Date(),
      }),
    ).toBeNull();
  });
});
