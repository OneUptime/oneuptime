import KubernetesClusterCompliance, {
  KubernetesComplianceObjectRow,
  KubernetesCompliancePodRow,
  MAX_COMPLIANCE_PODS,
  getCronJobsByJob,
  isManagedControlPlane,
  summarizeNamespaces,
  toCompliancePod,
  toPolicySnapshot,
} from "../../../../Server/Utils/Kubernetes/KubernetesClusterCompliance";
import DataSecurityComplianceSettingService from "../../../../Server/Services/DataSecurityComplianceSettingService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import DataSecurityComplianceSetting from "../../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import User from "../../../../Models/DatabaseModels/User";
import ComplianceFramework from "../../../../Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import { DataStoreResourceKind } from "../../../../Types/DataSecurity/DataStoreResource";
import { JSONObject } from "../../../../Types/JSON";
import { KubernetesObjectRef } from "../../../../Types/Kubernetes/KubernetesHealth";
import { readPodSecurity } from "../../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceResponse,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { KubernetesComplianceFramework } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import { KubernetesCompliancePod } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A Kubernetes cluster's own compliance, read from its inventory (#9627):
 * each pod folded into the workload a person opens, the RBAC and network
 * policies the agent sends, the cluster's version from its nodes, and the
 * Compliance page's switches - every read in that cluster of that project,
 * and bounded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function podRow(
  namespace: string,
  name: string,
  options: {
    owners?: Array<{ kind: string; name: string }>;
    labels?: JSONObject;
    spec?: JSONObject | null;
    images?: Array<string>;
  } = {},
): KubernetesCompliancePodRow {
  return {
    namespaceKey: namespace,
    name,
    labels: options.labels || null,
    ownerReferences: options.owners
      ? ({ items: options.owners } as unknown as JSONObject)
      : null,
    security:
      options.spec === null
        ? null
        : JSON.parse(
            JSON.stringify(
              readPodSecurity(options.spec || { containers: [{ name: "c" }] }),
            ),
          ),
    serviceAccountName: "default",
    images: options.images || ["ghcr.io/acme/app:1"],
  };
}

describe("a pod, as the scoring reads it", () => {
  const noCronJobs: Map<string, KubernetesObjectRef> = new Map();

  test("a ReplicaSet's pod is its Deployment's", () => {
    expect(
      toCompliancePod(
        podRow("payments", "api-6d8f7c9b5-x2k9z", {
          owners: [{ kind: "ReplicaSet", name: "api-6d8f7c9b5" }],
          labels: { "pod-template-hash": "6d8f7c9b5" },
        }),
        noCronJobs,
      )?.workload,
    ).toEqual({ kind: "Deployment", namespace: "payments", name: "api" });
  });

  test("a StatefulSet's and a DaemonSet's pods are theirs", () => {
    expect(
      toCompliancePod(
        podRow("data", "postgres-0", {
          owners: [{ kind: "StatefulSet", name: "postgres" }],
        }),
        noCronJobs,
      )?.workload,
    ).toEqual({ kind: "StatefulSet", namespace: "data", name: "postgres" });
    expect(
      toCompliancePod(
        podRow("kube-system", "kube-proxy-8x2lq", {
          owners: [{ kind: "DaemonSet", name: "kube-proxy" }],
        }),
        noCronJobs,
      )?.workload,
    ).toEqual({
      kind: "DaemonSet",
      namespace: "kube-system",
      name: "kube-proxy",
    });
  });

  test("a CronJob's run is the CronJob's, and a Job of its own is the Job's", () => {
    const cronJobs: Map<string, KubernetesObjectRef> = getCronJobsByJob([
      {
        kind: "Job",
        namespaceKey: "batch",
        name: "nightly-backup-29012340",
        labels: null,
        ownerReferences: {
          items: [{ kind: "CronJob", name: "nightly-backup" }],
        } as unknown as JSONObject,
      },
    ]);

    expect(
      toCompliancePod(
        podRow("batch", "nightly-backup-29012340-q8x7d", {
          owners: [{ kind: "Job", name: "nightly-backup-29012340" }],
        }),
        cronJobs,
      )?.workload,
    ).toEqual({ kind: "CronJob", namespace: "batch", name: "nightly-backup" });
    expect(
      toCompliancePod(
        podRow("batch", "migrate-7zq2x", {
          owners: [{ kind: "Job", name: "migrate" }],
        }),
        cronJobs,
      )?.workload,
    ).toEqual({ kind: "Job", namespace: "batch", name: "migrate" });
  });

  test("a pod nothing owns, or a node's static pod, is itself", () => {
    expect(
      toCompliancePod(podRow("web", "debug"), noCronJobs)?.workload,
    ).toEqual({ kind: "Pod", namespace: "web", name: "debug" });
    expect(
      toCompliancePod(
        podRow("kube-system", "kube-apiserver-node-1", {
          owners: [{ kind: "Node", name: "node-1" }],
        }),
        noCronJobs,
      )?.workload,
    ).toEqual({
      kind: "Pod",
      namespace: "kube-system",
      name: "kube-apiserver-node-1",
    });
  });

  test("a pod stored before its security fields were kept is not read, and its images are kept", () => {
    const pod: KubernetesCompliancePod | null = toCompliancePod(
      podRow("web", "old", {
        spec: null,
        images: ["nginx:1.27", "busybox"],
      }),
      noCronJobs,
    );

    expect(pod?.security).toBeNull();
    expect(pod?.images).toEqual(["nginx:1.27", "busybox"]);
    expect(
      toCompliancePod({ ...podRow("web", "x"), name: null }, noCronJobs),
    ).toBeNull();
  });
});

describe("the cluster's policy objects", () => {
  test("each kind is read into its own list, a Role and a binding keeping their namespace", () => {
    const rows: Array<KubernetesComplianceObjectRow> = [
      {
        kind: "ClusterRole",
        namespaceKey: "",
        name: "ops",
        labels: { team: "ops" },
        spec: {
          rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["get"] }],
        } as unknown as JSONObject,
      },
      {
        kind: "Role",
        namespaceKey: "web",
        name: "reader",
        labels: null,
        spec: { rules: [] } as unknown as JSONObject,
      },
      {
        kind: "RoleBinding",
        namespaceKey: "web",
        name: "readers",
        labels: null,
        spec: {
          roleRef: { kind: "Role", name: "reader" },
          subjects: [{ kind: "Group", name: "devs" }],
        } as unknown as JSONObject,
      },
      {
        kind: "ServiceAccount",
        namespaceKey: "web",
        name: "default",
        labels: null,
        spec: { automountServiceAccountToken: false } as unknown as JSONObject,
      },
      {
        kind: "NetworkPolicy",
        namespaceKey: "web",
        name: "deny",
        labels: null,
        spec: {
          selectsAllPods: true,
          policyTypes: ["Ingress"],
          ingressRuleCount: 0,
          egressRuleCount: 0,
        } as unknown as JSONObject,
      },
      { kind: "Secret", namespaceKey: "web", name: "x", labels: null },
    ];

    expect(toPolicySnapshot(rows)).toEqual({
      roles: [
        {
          kind: "ClusterRole",
          namespace: "",
          name: "ops",
          labels: { team: "ops" },
          spec: {
            rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["get"] }],
          },
        },
        {
          kind: "Role",
          namespace: "web",
          name: "reader",
          labels: {},
          spec: { rules: [] },
        },
      ],
      bindings: [
        {
          kind: "RoleBinding",
          namespace: "web",
          name: "readers",
          labels: {},
          spec: {
            roleRef: { kind: "Role", name: "reader" },
            subjects: [{ kind: "Group", name: "devs" }],
          },
        },
      ],
      serviceAccounts: [
        {
          namespace: "web",
          name: "default",
          spec: { automountServiceAccountToken: false },
        },
      ],
      networkPolicies: [
        {
          namespace: "web",
          name: "deny",
          spec: {
            selectsAllPods: true,
            policyTypes: ["Ingress"],
            ingressRuleCount: 0,
            egressRuleCount: 0,
          },
        },
      ],
    });
  });
});

describe("the namespaces", () => {
  test("each namespace that runs pods, the most pods first, with the Pod Security Admission levels it says", () => {
    const pods: Array<KubernetesCompliancePod> = [
      toCompliancePod(podRow("web", "a"), new Map())!,
      toCompliancePod(podRow("web", "b"), new Map())!,
      toCompliancePod(podRow("payments", "c"), new Map())!,
    ];

    expect(
      summarizeNamespaces(pods, [
        {
          name: "payments",
          labels: {
            "pod-security.kubernetes.io/enforce": "restricted",
            "pod-security.kubernetes.io/warn": "restricted",
          },
        },
        { name: "idle", labels: {} },
      ]),
    ).toEqual([
      { name: "web", podCount: 2, enforce: null, audit: null, warn: null },
      {
        name: "payments",
        podCount: 1,
        enforce: "restricted",
        audit: null,
        warn: "restricted",
      },
    ]);
  });

  test("a managed platform runs the control plane; OpenShift and a cluster of its own do not", () => {
    expect(isManagedControlPlane("EKS")).toBe(true);
    expect(isManagedControlPlane("GKE")).toBe(true);
    expect(isManagedControlPlane("AKS")).toBe(true);
    expect(isManagedControlPlane("OpenShift")).toBe(false);
    expect(isManagedControlPlane(null)).toBe(false);
  });
});

describe("reading a cluster's compliance", () => {
  let queries: Array<{ sql: string; parameters: Array<unknown> }>;
  let rows: {
    pods: Array<KubernetesCompliancePodRow>;
    jobs: Array<KubernetesComplianceObjectRow>;
    namespaces: Array<KubernetesComplianceObjectRow>;
    nodes: Array<{ kubeletVersion: string | null }>;
    policies: Array<KubernetesComplianceObjectRow>;
  };
  let settings: Array<DataSecurityComplianceSetting>;
  let findBy: jest.SpyInstance;

  beforeEach(() => {
    queries = [];
    rows = {
      pods: [
        podRow("kube-system", "kube-proxy-x1", {
          owners: [{ kind: "DaemonSet", name: "kube-proxy" }],
          spec: {
            hostNetwork: true,
            containers: [
              { name: "kube-proxy", securityContext: { privileged: true } },
            ],
          },
        }),
        podRow("web", "nginx"),
      ],
      jobs: [],
      namespaces: [
        { kind: "Namespace", namespaceKey: "", name: "web", labels: {} },
      ],
      nodes: [
        { kubeletVersion: "v1.33.2-eks-a" },
        { kubeletVersion: "v1.32.9-eks-b" },
      ],
      policies: [],
    };
    settings = [];

    jest.spyOn(KubernetesResourceService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<Array<unknown>> => {
          queries.push({ sql, parameters });

          if (sql.includes(`"kind" = 'Pod'`)) {
            return rows.pods;
          }

          if (sql.includes(`"kind" = 'Job'`)) {
            return rows.jobs;
          }

          if (sql.includes(`"kind" = 'Namespace'`)) {
            return rows.namespaces;
          }

          if (sql.includes(`"kind" = 'Node'`)) {
            return rows.nodes;
          }

          return rows.policies;
        },
      },
    } as never);

    findBy = jest
      .spyOn(DataSecurityComplianceSettingService, "findBy")
      .mockImplementation((async (options: { query: JSONObject }) => {
        return settings.filter((setting: DataSecurityComplianceSetting) => {
          return (
            options.query["isEnabled"] === undefined ||
            setting.isEnabled === options.query["isEnabled"]
          );
        });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function read(
    provider: string | null = "EKS",
  ): Promise<KubernetesComplianceResponse> {
    return await KubernetesClusterCompliance.readCompliance({
      projectId: PROJECT_ID,
      cluster: { id: CLUSTER_ID, name: "prod-eu", provider },
    });
  }

  function frameworkOf(
    response: KubernetesComplianceResponse,
    framework: KubernetesComplianceFramework,
  ): KubernetesComplianceFrameworkResponse {
    return response.frameworks.find(
      (each: KubernetesComplianceFrameworkResponse): boolean => {
        return each.framework === framework;
      },
    )!;
  }

  test("reads only that cluster of that project, each read bounded", async () => {
    await read();

    expect(queries).toHaveLength(5);
    for (const query of queries) {
      expect(query.parameters.slice(0, 2)).toEqual([
        PROJECT_ID.toString(),
        CLUSTER_ID.toString(),
      ]);
      expect(query.sql).toContain(`"deletedAt" IS NULL`);
      expect(query.sql).toMatch(/LIMIT \$\d/);
    }
    // A pod's security block and its images, never its whole spec.
    expect(queries[0]!.sql).toContain(`"spec"->'security'`);
    expect(
      queries[0]!.sql
        .replace(/"spec"->>?'[A-Za-z]+'/g, "")
        .replace(
          /COALESCE\("spec", '\{\}'::jsonb\), '\$\.containers\[\*\]\.image'/g,
          "",
        ),
    ).not.toContain(`"spec"`);
    expect(queries[0]!.parameters[2]).toBe(MAX_COMPLIANCE_PODS + 1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        resourceType: DataStoreResourceKind.KubernetesCluster,
        resourceId: CLUSTER_ID,
      },
    });
  });

  test("scores against the standard of the newest version the nodes report", async () => {
    const response: KubernetesComplianceResponse = await read();

    expect(response.kubernetesVersion).toBe("1.33");
    expect(response.standardVersion).toBe("1.33");
    expect(response.isManagedControlPlane).toBe(true);
    expect(response.podCount).toBe(2);
    expect(response.podsRead).toBe(2);
    expect(response.isTruncated).toBe(false);
    expect(
      response.namespaces.map((each: { name: string }) => {
        return each.name;
      }),
    ).toEqual(["kube-system", "web"]);

    const baseline: KubernetesComplianceFrameworkResponse = frameworkOf(
      response,
      KubernetesComplianceFramework.PssBaseline,
    );

    expect(baseline.workloadsEvaluated).toBe(2);
    expect(baseline.workloadsPassing).toBe(1);
  });

  test("with no ClusterRole from the agent, the RBAC controls are not evaluated", async () => {
    const response: KubernetesComplianceResponse = await read();

    expect(response.hasPolicyObjects).toBe(false);
    expect(
      frameworkOf(response, KubernetesComplianceFramework.CisKubernetes)
        .requirements[0]!.status,
    ).toBe(ComplianceRequirementStatus.NotEvaluated);
  });

  test("with the agent's RBAC, they are", async () => {
    rows.policies = [
      {
        kind: "ClusterRole",
        namespaceKey: "",
        name: "cluster-admin",
        labels: { "kubernetes.io/bootstrapping": "rbac-defaults" },
        spec: {
          rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
        } as unknown as JSONObject,
      },
    ];

    const response: KubernetesComplianceResponse = await read();

    expect(response.hasPolicyObjects).toBe(true);
    expect(
      frameworkOf(response, KubernetesComplianceFramework.CisKubernetes)
        .requirements[0]!.status,
    ).toBe(ComplianceRequirementStatus.Passing);
  });

  test("applies the cluster's switches, says who turned what off and why, and ignores its data frameworks' settings", async () => {
    const user: User = new User();
    user.name = "Jane Doe" as never;
    const namespaceOff: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();
    namespaceOff._id = "55555555-5555-4555-8555-555555555555";
    namespaceOff.framework = KubernetesComplianceFramework.PssBaseline;
    namespaceOff.namespace = "kube-system";
    namespaceOff.isEnabled = false;
    namespaceOff.note = " System components run privileged. ";
    namespaceOff.turnedOffAt = new Date("2026-11-12T09:00:00.000Z");
    namespaceOff.turnedOffByUser = user;
    const dataOff: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();
    dataOff._id = "66666666-6666-4666-8666-666666666666";
    dataOff.framework = ComplianceFramework.PCIDSS;
    dataOff.isEnabled = false;
    settings = [namespaceOff, dataOff];

    const response: KubernetesComplianceResponse = await read();
    const baseline: KubernetesComplianceFrameworkResponse = frameworkOf(
      response,
      KubernetesComplianceFramework.PssBaseline,
    );

    expect(baseline.turnedOffNamespaces).toEqual(["kube-system"]);
    expect(baseline.score).toBe(100);
    expect(baseline.turnedOff).toEqual([
      {
        id: "55555555-5555-4555-8555-555555555555",
        framework: KubernetesComplianceFramework.PssBaseline,
        resource: {
          kind: DataStoreResourceKind.KubernetesCluster,
          id: CLUSTER_ID.toString(),
          name: "prod-eu",
        },
        requirement: null,
        namespace: "kube-system",
        note: "System components run privileged.",
        turnedOffAt: "2026-11-12T09:00:00.000Z",
        turnedOffBy: "Jane Doe",
      },
    ]);
    expect(
      frameworkOf(response, KubernetesComplianceFramework.PssRestricted)
        .turnedOff,
    ).toEqual([]);
  });

  test("says so when a cluster has more pods than one answer scores", async () => {
    rows.pods = Array.from(
      { length: MAX_COMPLIANCE_PODS + 1 },
      (_: unknown, index: number): KubernetesCompliancePodRow => {
        return { ...podRow("web", `p-${index}`), security: null };
      },
    );

    const response: KubernetesComplianceResponse = await read(null);

    expect(response.isTruncated).toBe(true);
    expect(response.podCount).toBe(MAX_COMPLIANCE_PODS);
    expect(response.isManagedControlPlane).toBe(false);
  });
});
