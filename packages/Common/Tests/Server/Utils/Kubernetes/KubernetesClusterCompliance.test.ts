import KubernetesClusterCompliance, {
  KUBERNETES_TEMPLATE_KINDS,
  KubernetesComplianceObjectRow,
  KubernetesCompliancePodRow,
  KubernetesNodeBenchmarkPodRow,
  MAX_COMPLIANCE_PODS,
  MAX_COMPLIANCE_WORKLOADS,
  getAcceptancesInForce,
  getAgentComponentsByWorkload,
  getCronJobsByJob,
  getObjectsOnCluster,
  getOneUptimeAgentNamespaces,
  getUnownedReplicaSets,
  isAcceptanceSetting,
  isManagedControlPlane,
  readAcceptedObject,
  summarizeNamespaces,
  toCompliancePod,
  toComplianceTemplates,
  toNodeBenchmarkRuns,
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
  KubernetesNodeBenchmarkBlock,
  readNodeBenchmarkMessage,
} from "../../../../Types/Kubernetes/KubernetesNodeBenchmark";
import { OneUptimeAgentComponent } from "../../../../Types/Kubernetes/Compliance/KubernetesAgentWorkloads";
import {
  CONTROL_PLANE_CIS_1_12,
  WORKER_CIS_1_12,
} from "../../../Types/Kubernetes/Compliance/KubeBenchFixtures";
import {
  KubernetesComplianceAcceptanceEntry,
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceResponse,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { KubernetesComplianceFinding } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { KubernetesComplianceRequirementResult } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import { KubernetesComplianceFramework } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesCompliancePod,
  KubernetesComplianceTemplate,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSnapshot";
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

/*
 * The workloads' pod templates (#9880): the one each workload's pods would
 * be named by, a CronJob's Jobs folded into it, a Deployment's ReplicaSets
 * its revisions.
 */
describe("the workloads' pod templates", () => {
  function workloadRow(
    kind: string,
    namespace: string,
    name: string,
    options: {
      owners?: Array<{ kind: string; name: string }>;
      spec?: JSONObject | null;
    } = {},
  ): KubernetesComplianceObjectRow {
    return {
      kind,
      namespaceKey: namespace,
      name,
      labels: null,
      ownerReferences: options.owners
        ? ({ items: options.owners } as unknown as JSONObject)
        : null,
      security:
        options.spec === null
          ? null
          : JSON.parse(
              JSON.stringify(
                readPodSecurity(
                  options.spec || { containers: [{ name: "c" }] },
                ),
              ),
            ),
    };
  }

  test("each workload kind that holds a template is read: the six, and OpenShift's DeploymentConfig", () => {
    expect([...KUBERNETES_TEMPLATE_KINDS]).toEqual([
      "Deployment",
      "StatefulSet",
      "DaemonSet",
      "ReplicaSet",
      "Job",
      "CronJob",
      "DeploymentConfig",
    ]);
    expect(MAX_COMPLIANCE_WORKLOADS).toBe(25000);
  });

  test("a CronJob's Job folds into the CronJob, and a Deployment's ReplicaSet into the Deployment", () => {
    const templates: Array<KubernetesComplianceTemplate> =
      toComplianceTemplates([
        workloadRow("Deployment", "payments", "api"),
        workloadRow("ReplicaSet", "payments", "api-7d9f8", {
          owners: [{ kind: "Deployment", name: "api" }],
        }),
        workloadRow("ReplicaSet", "web", "legacy-web"),
        workloadRow("CronJob", "ops", "backup"),
        workloadRow("Job", "ops", "backup-29000000", {
          owners: [{ kind: "CronJob", name: "backup" }],
        }),
        workloadRow("Job", "ops", "migrate"),
        workloadRow("StatefulSet", "payments", "ledger"),
        workloadRow("DaemonSet", "kube-system", "cilium"),
        workloadRow("DeploymentConfig", "shop", "frontend"),
        // Not a workload: never a template.
        workloadRow("Namespace", "", "ops"),
        { ...workloadRow("Deployment", "payments", "x"), name: null },
      ]);

    expect(
      templates.map((each: KubernetesComplianceTemplate): string => {
        return `${each.workload.kind} ${each.workload.namespace}/${each.workload.name}`;
      }),
    ).toEqual([
      "Deployment payments/api",
      "ReplicaSet web/legacy-web",
      "CronJob ops/backup",
      "Job ops/migrate",
      "StatefulSet payments/ledger",
      "DaemonSet kube-system/cilium",
      "DeploymentConfig shop/frontend",
    ]);
  });

  test("a template stored before it was read is kept, as not read", () => {
    expect(
      toComplianceTemplates([
        workloadRow("Deployment", "payments", "api", { spec: null }),
      ])[0]!.security,
    ).toBeNull();
  });

  test("a ReplicaSet nothing owns names its pods; one a Deployment owns does not", () => {
    const unowned: Set<string> = getUnownedReplicaSets([
      workloadRow("ReplicaSet", "web", "legacy-web"),
      workloadRow("ReplicaSet", "payments", "api-7d9f8", {
        owners: [{ kind: "Deployment", name: "api" }],
      }),
      workloadRow("Deployment", "payments", "api"),
    ]);

    expect([...unowned]).toEqual(["web/legacy-web"]);
    expect(
      toCompliancePod(
        podRow("web", "legacy-web-x1", {
          owners: [{ kind: "ReplicaSet", name: "legacy-web" }],
        }),
        new Map(),
        unowned,
      )?.workload,
    ).toEqual({ kind: "ReplicaSet", namespace: "web", name: "legacy-web" });
    expect(
      toCompliancePod(
        podRow("payments", "api-7d9f8-x1", {
          owners: [{ kind: "ReplicaSet", name: "api-7d9f8" }],
          labels: { "pod-template-hash": "7d9f8" },
        }),
        new Map(),
        unowned,
      )?.workload,
    ).toEqual({ kind: "Deployment", namespace: "payments", name: "api" });
  });
});

/*
 * An accepted finding (#9874) is a setting that names one object: read
 * apart from the settings that turn a framework, a control or a namespace
 * off, as the object a finding names.
 */
describe("an accepted finding's setting", () => {
  function setting(
    data: Partial<DataSecurityComplianceSetting>,
  ): DataSecurityComplianceSetting {
    const row: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();
    Object.assign(row, data);
    return row;
  }

  test("is one that names an object", () => {
    expect(isAcceptanceSetting(setting({ objectName: "cilium" }))).toBe(true);
    expect(isAcceptanceSetting(setting({ objectName: " " }))).toBe(false);
    expect(isAcceptanceSetting(setting({ namespace: "kube-system" }))).toBe(
      false,
    );
  });

  test("names the object as a finding does", () => {
    expect(
      readAcceptedObject(
        setting({
          objectKind: "DaemonSet",
          objectName: "cilium",
          namespace: "kube-system",
        }),
      ),
    ).toEqual({ kind: "DaemonSet", namespace: "kube-system", name: "cilium" });
    expect(
      readAcceptedObject(
        setting({
          objectKind: "ClusterRoleBinding",
          objectName: "break-glass",
          namespace: "stray",
        }),
      ),
    ).toEqual({
      kind: "ClusterRoleBinding",
      namespace: "",
      name: "break-glass",
    });
    expect(
      readAcceptedObject(
        setting({ objectKind: "Namespace", objectName: "ops" }),
      ),
    ).toEqual({ kind: "Namespace", namespace: "ops", name: "ops" });
    expect(
      readAcceptedObject(
        setting({ objectKind: "Secret", objectName: "token" }),
      ),
    ).toBeNull();
  });

  test("an expired acceptance accepts nothing", () => {
    const entry: KubernetesComplianceAcceptanceEntry = {
      id: "a",
      framework: KubernetesComplianceFramework.PssBaseline,
      requirement: null,
      object: { kind: "DaemonSet", namespace: "kube-system", name: "cilium" },
      note: "CNI",
      acceptedAt: null,
      acceptedBy: null,
      expiresAt: null,
      isExpired: false,
      isOnCluster: true,
    };

    expect(
      getAcceptancesInForce([entry, { ...entry, id: "b", isExpired: true }]),
    ).toEqual([
      {
        id: "a",
        framework: KubernetesComplianceFramework.PssBaseline,
        requirement: "",
        object: entry.object,
      },
    ]);
  });

  test("the objects on the cluster: every pod's workload, every workload and policy object, every namespace", () => {
    const keys: Set<string> = getObjectsOnCluster({
      pods: [
        toCompliancePod(
          podRow("kube-system", "cilium-a", {
            owners: [{ kind: "DaemonSet", name: "cilium" }],
          }),
          new Map(),
        )!,
      ],
      rows: [
        {
          kind: "CronJob",
          namespaceKey: "ops",
          name: "backup",
          labels: null,
        },
        {
          kind: "ClusterRoleBinding",
          namespaceKey: "",
          name: "break-glass",
          labels: null,
        },
        { kind: "Namespace", namespaceKey: "", name: "ops", labels: null },
      ],
    });

    expect([...keys].sort()).toEqual([
      "ClusterRoleBinding||break-glass",
      "CronJob|ops|backup",
      "DaemonSet|kube-system|cilium",
      "Namespace|ops|ops",
    ]);
  });
});

describe("reading a cluster's compliance", () => {
  let queries: Array<{ sql: string; parameters: Array<unknown> }>;
  let rows: {
    pods: Array<KubernetesCompliancePodRow>;
    jobs: Array<KubernetesComplianceObjectRow>;
    namespaces: Array<KubernetesComplianceObjectRow>;
    nodes: Array<{ name?: string | null; kubeletVersion: string | null }>;
    policies: Array<KubernetesComplianceObjectRow>;
    nodeBenchmarks: Array<KubernetesNodeBenchmarkPodRow>;
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
      nodeBenchmarks: [],
    };
    settings = [];

    jest.spyOn(KubernetesResourceService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<Array<unknown>> => {
          queries.push({ sql, parameters });

          // kube-bench's runs (#9873): the pods that hold what it found.
          if (sql.includes(`'nodeBenchmark'`)) {
            return rows.nodeBenchmarks;
          }

          if (sql.includes(`"kind" = 'Pod'`)) {
            return rows.pods;
          }

          // The workloads with their pod templates (#9880), the Jobs among them.
          if (sql.includes(`AS "security"`) && sql.includes(`= ANY($3)`)) {
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

    // Pods, workloads, namespaces, nodes, kube-bench's runs and policy objects.
    expect(queries).toHaveLength(6);
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

  test("a workload that runs no pod is scored from its template, read with the workloads", async () => {
    rows.jobs = [
      {
        kind: "CronJob",
        namespaceKey: "ops",
        name: "nightly-backup",
        labels: null,
        ownerReferences: null,
        security: JSON.parse(
          JSON.stringify(
            readPodSecurity({
              containers: [
                { name: "backup", securityContext: { privileged: true } },
              ],
            }),
          ),
        ),
      },
    ];

    const response: KubernetesComplianceResponse = await read();
    const workloads: { sql: string; parameters: Array<unknown> } = queries.find(
      (query: { sql: string }): boolean => {
        return query.sql.includes(`AS "security"`) && query.sql.includes("ANY");
      },
    )!;

    // One read of the workloads, their templates' blocks and never their whole spec.
    expect(workloads.parameters[2]).toEqual([...KUBERNETES_TEMPLATE_KINDS]);
    expect(workloads.parameters[3]).toBe(MAX_COMPLIANCE_WORKLOADS);
    expect(workloads.sql.replace(/"spec"->'security'/g, "")).not.toContain(
      `"spec"`,
    );
    expect(response.templateCount).toBe(1);

    const privileged: KubernetesComplianceRequirementResult = frameworkOf(
      response,
      KubernetesComplianceFramework.PssBaseline,
    ).requirements.find((each: KubernetesComplianceRequirementResult) => {
      return each.requirement === "Privileged Containers";
    })!;

    // Beside kube-proxy, read from its running pod.
    expect(privileged.findings).toEqual([
      expect.objectContaining({
        object: {
          kind: "DaemonSet",
          namespace: "kube-system",
          name: "kube-proxy",
        },
        podCount: 1,
      }),
      {
        object: { kind: "CronJob", namespace: "ops", name: "nightly-backup" },
        details: [
          {
            container: "backup",
            field: "securityContext.privileged",
            value: "true",
          },
        ],
        isFromTemplate: true,
      },
    ]);
  });

  test("an accepted finding is listed with who, when, why and until when, and turns nothing off", async () => {
    const user: User = new User();
    user.name = "Jane Doe" as never;
    const accepted: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();
    accepted._id = "77777777-7777-4777-8777-777777777777";
    accepted.framework = KubernetesComplianceFramework.PssBaseline;
    accepted.requirement = "Privileged Containers";
    accepted.namespace = "kube-system";
    accepted.objectKind = "DaemonSet";
    accepted.objectName = "kube-proxy";
    accepted.isEnabled = false;
    accepted.note = " kube-proxy programs iptables. ";
    accepted.expiresAt = new Date("2027-05-01T00:00:00.000Z");
    accepted.turnedOffAt = new Date("2026-11-12T09:00:00.000Z");
    accepted.turnedOffByUser = user;
    settings = [accepted];

    const response: KubernetesComplianceResponse =
      await KubernetesClusterCompliance.readCompliance({
        projectId: PROJECT_ID,
        cluster: { id: CLUSTER_ID, name: "prod-eu", provider: "EKS" },
        now: new Date("2026-11-19T12:00:00.000Z"),
      });
    const baseline: KubernetesComplianceFrameworkResponse = frameworkOf(
      response,
      KubernetesComplianceFramework.PssBaseline,
    );
    const privileged: KubernetesComplianceRequirementResult =
      baseline.requirements.find(
        (each: KubernetesComplianceRequirementResult) => {
          return each.requirement === "Privileged Containers";
        },
      )!;

    // kube-system is not turned off: only kube-proxy's finding is accepted.
    expect(baseline.turnedOffNamespaces).toEqual([]);
    expect(baseline.turnedOff).toEqual([]);
    expect(privileged.status).toBe(ComplianceRequirementStatus.Passing);
    expect(privileged.accepted![0]).toMatchObject({
      object: {
        kind: "DaemonSet",
        namespace: "kube-system",
        name: "kube-proxy",
      },
      acceptanceId: "77777777-7777-4777-8777-777777777777",
      podCount: 1,
    });
    expect(baseline.acceptances).toEqual([
      {
        id: "77777777-7777-4777-8777-777777777777",
        framework: KubernetesComplianceFramework.PssBaseline,
        requirement: "Privileged Containers",
        object: {
          kind: "DaemonSet",
          namespace: "kube-system",
          name: "kube-proxy",
        },
        note: "kube-proxy programs iptables.",
        acceptedAt: "2026-11-12T09:00:00.000Z",
        acceptedBy: "Jane Doe",
        expiresAt: "2027-05-01T00:00:00.000Z",
        isExpired: false,
        isOnCluster: true,
      },
    ]);
    // Read in that cluster of that project, as OneUptime.
    expect(
      findBy.mock.calls.some((call: Array<unknown>): boolean => {
        const options: {
          query: JSONObject;
          props: JSONObject;
          select: JSONObject;
        } = call[0] as {
          query: JSONObject;
          props: JSONObject;
          select: JSONObject;
        };
        return (
          options.select["objectKind"] === true &&
          options.query["resourceId"] === CLUSTER_ID &&
          options.query["isEnabled"] === false &&
          options.props["isRoot"] === true
        );
      }),
    ).toBe(true);
    expect(
      frameworkOf(response, KubernetesComplianceFramework.PssRestricted)
        .acceptances,
    ).toEqual([]);
  });

  test("once its expiry passes, the finding fails again and the acceptance says it expired", async () => {
    const accepted: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();
    accepted._id = "77777777-7777-4777-8777-777777777777";
    accepted.framework = KubernetesComplianceFramework.PssBaseline;
    accepted.requirement = "Privileged Containers";
    accepted.namespace = "kube-system";
    accepted.objectKind = "DaemonSet";
    accepted.objectName = "kube-proxy";
    accepted.isEnabled = false;
    accepted.note = "Until the CNI moves.";
    accepted.expiresAt = new Date("2026-11-01T00:00:00.000Z");
    settings = [accepted];

    const response: KubernetesComplianceResponse =
      await KubernetesClusterCompliance.readCompliance({
        projectId: PROJECT_ID,
        cluster: { id: CLUSTER_ID, name: "prod-eu", provider: "EKS" },
        now: new Date("2026-11-19T12:00:00.000Z"),
      });
    const baseline: KubernetesComplianceFrameworkResponse = frameworkOf(
      response,
      KubernetesComplianceFramework.PssBaseline,
    );

    expect(baseline.acceptances![0]!.isExpired).toBe(true);
    expect(
      baseline.requirements.find(
        (each: KubernetesComplianceRequirementResult) => {
          return each.requirement === "Privileged Containers";
        },
      )!.status,
    ).toBe(ComplianceRequirementStatus.Failing);
  });

  test("an acceptance whose object is gone from the cluster stays listed, and says so", async () => {
    const accepted: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();
    accepted._id = "77777777-7777-4777-8777-777777777777";
    accepted.framework = KubernetesComplianceFramework.PssBaseline;
    accepted.namespace = "kube-system";
    accepted.objectKind = "DaemonSet";
    accepted.objectName = "weave-net";
    accepted.isEnabled = false;
    accepted.note = "Weave needed host networking.";
    settings = [accepted];

    const baseline: KubernetesComplianceFrameworkResponse = frameworkOf(
      await read(),
      KubernetesComplianceFramework.PssBaseline,
    );

    expect(baseline.acceptances).toMatchObject([
      {
        requirement: null,
        object: { kind: "DaemonSet", name: "weave-net" },
        isOnCluster: false,
        isExpired: false,
      },
    ]);
    expect(baseline.acceptedCount).toBe(0);
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

  // The agent's own workloads (#9929), and its kube-bench runs (#9873).
  function agentWorkload(
    kind: string,
    name: string,
    component: string,
    namespace: string = "oneuptime-agent",
  ): KubernetesComplianceObjectRow {
    return {
      kind,
      namespaceKey: namespace,
      name,
      labels: {
        "app.kubernetes.io/part-of": "oneuptime",
        "helm.sh/chart": "kubernetes-agent-17.1.0",
        component,
      },
      ownerReferences: null,
      security: null,
    };
  }

  function kubeBenchRun(
    namespace: string,
    name: string,
    nodeName: string | null,
    message: string,
  ): KubernetesNodeBenchmarkPodRow {
    const block: KubernetesNodeBenchmarkBlock | null = readNodeBenchmarkMessage(
      message,
      "2026-11-19T22:41:07Z",
    );

    return {
      namespaceKey: namespace,
      name,
      nodeName,
      nodeBenchmark: JSON.parse(JSON.stringify(block)),
    };
  }

  test("reads kube-bench's runs from the agent's own namespace alone, and scores the node controls by node", async () => {
    rows.jobs = [
      agentWorkload("Deployment", "kubernetes-agent", "metrics-collector"),
      agentWorkload(
        "CronJob",
        "kubernetes-agent-kube-bench-workers",
        "node-benchmark",
      ),
      // A CronJob dressed as kube-bench in a tenant's namespace makes it no agent's.
      agentWorkload("CronJob", "fake-kube-bench", "node-benchmark", "tenant"),
    ];
    rows.nodes = [
      { name: "kind-control-plane", kubeletVersion: "v1.33.2" },
      { name: "kind-worker", kubeletVersion: "v1.33.2" },
    ];
    rows.nodeBenchmarks = [
      kubeBenchRun(
        "oneuptime-agent",
        "kubernetes-agent-kube-bench-control-plane-x1",
        "kind-control-plane",
        CONTROL_PLANE_CIS_1_12,
      ),
      kubeBenchRun(
        "oneuptime-agent",
        "kubernetes-agent-kube-bench-workers-x1",
        "kind-worker",
        WORKER_CIS_1_12,
      ),
      // Forged: every check passing, from outside the agent's namespace.
      kubeBenchRun(
        "tenant",
        "fake-kube-bench-x1",
        "kind-worker",
        '{"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12","targets":"node","pass":"4.1.1 4.1.9","fail":"","warn":"","manual":""}',
      ),
      // On no node: not a run.
      kubeBenchRun(
        "oneuptime-agent",
        "kubernetes-agent-kube-bench-workers-pending",
        null,
        WORKER_CIS_1_12,
      ),
    ];

    const response: KubernetesComplianceResponse = await read(null);
    const cis: KubernetesComplianceFrameworkResponse = frameworkOf(
      response,
      KubernetesComplianceFramework.CisKubernetes,
    );
    const kubeletService: KubernetesComplianceRequirementResult | undefined =
      cis.requirements.find((row: KubernetesComplianceRequirementResult) => {
        return row.requirement === "4.1.1";
      });

    expect(
      queries.find((query: { sql: string }) => {
        return query.sql.includes(`'nodeBenchmark'`);
      })?.sql,
    ).toContain(`"spec"->'nodeBenchmark' IS NOT NULL`);
    expect(response.nodeBenchmark?.benchmark).toBe("cis-1.12");
    expect(
      response.nodeBenchmark?.nodes.map(
        (node: { node: string; isControlPlane: boolean }) => {
          return [node.node, node.isControlPlane];
        },
      ),
    ).toEqual([
      ["kind-control-plane", true],
      ["kind-worker", false],
    ]);
    expect(kubeletService?.status).toBe(ComplianceRequirementStatus.Failing);
    expect(
      kubeletService?.findings.map((finding: { object: { name: string } }) => {
        return finding.object.name;
      }),
    ).toEqual(["kind-control-plane", "kind-worker"]);
    expect(cis.requirements).toHaveLength(27 + 65);
  });

  test("with no kube-bench run, says none, and scores the CIS benchmark from the API alone", async () => {
    const response: KubernetesComplianceResponse = await read();

    expect(response.nodeBenchmark).toBeNull();
    expect(
      frameworkOf(response, KubernetesComplianceFramework.CisKubernetes)
        .requirements,
    ).toHaveLength(27);
    // The NSA/CISA guide is scored with the others.
    expect(
      frameworkOf(response, KubernetesComplianceFramework.NsaCisaHardening)
        .requirements.length,
    ).toBeGreaterThan(0);
  });

  function nodeAcceptance(
    id: string,
    node: string,
    note: string,
  ): DataSecurityComplianceSetting {
    const accepted: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();
    accepted._id = id;
    accepted.framework = KubernetesComplianceFramework.CisKubernetes;
    accepted.requirement = "4.1.1";
    accepted.objectKind = "Node";
    accepted.objectName = node;
    accepted.isEnabled = false;
    accepted.note = note;
    return accepted;
  }

  test("a node's accepted finding is listed, on the cluster while its node is", async () => {
    rows.nodes = [{ name: "kind-worker", kubeletVersion: "v1.33.2" }];
    settings = [
      nodeAcceptance(
        "33333333-3333-4333-8333-333333333333",
        "kind-worker",
        "The kind node image ships the kubelet's drop-in this way.",
      ),
      nodeAcceptance(
        "44444444-4444-4444-8444-444444444444",
        "deleted-node",
        "Gone.",
      ),
    ];

    const acceptances: Array<KubernetesComplianceAcceptanceEntry> =
      frameworkOf(await read(null), KubernetesComplianceFramework.CisKubernetes)
        .acceptances || [];

    expect(
      acceptances.map((entry: KubernetesComplianceAcceptanceEntry) => {
        return [entry.object, entry.isOnCluster];
      }),
    ).toEqual([
      [{ kind: "Node", namespace: "", name: "kind-worker" }, true],
      [{ kind: "Node", namespace: "", name: "deleted-node" }, false],
    ]);
  });

  test("the agent's own workloads' findings say which of its components they are", async () => {
    rows.jobs = [
      agentWorkload("DaemonSet", "kubernetes-agent-ebpf", "ebpf-instrument"),
    ];
    rows.pods = [
      podRow("oneuptime-agent", "kubernetes-agent-ebpf-x1", {
        owners: [{ kind: "DaemonSet", name: "kubernetes-agent-ebpf" }],
        spec: {
          hostPID: true,
          containers: [
            { name: "ebpf-instrument", securityContext: { privileged: true } },
          ],
        },
      }),
      podRow("kube-system", "cilium-x1", {
        owners: [{ kind: "DaemonSet", name: "cilium" }],
        spec: {
          containers: [
            { name: "agent", securityContext: { privileged: true } },
          ],
        },
      }),
    ];

    const baseline: KubernetesComplianceFrameworkResponse = frameworkOf(
      await read(null),
      KubernetesComplianceFramework.PssBaseline,
    );
    const privileged: KubernetesComplianceRequirementResult | undefined =
      baseline.requirements.find(
        (row: KubernetesComplianceRequirementResult) => {
          return row.requirement === "Privileged Containers";
        },
      );

    expect(
      privileged?.findings.map((finding: KubernetesComplianceFinding) => {
        return [finding.object.name, finding.oneUptimeAgent?.component];
      }),
    ).toEqual([
      ["cilium", undefined],
      ["kubernetes-agent-ebpf", OneUptimeAgentComponent.Ebpf],
    ]);
  });
});

describe("the OneUptime agent's own workloads and kube-bench's runs, read from the inventory", () => {
  const AGENT_LABELS: JSONObject = {
    "app.kubernetes.io/part-of": "oneuptime",
    "helm.sh/chart": "kubernetes-agent-17.1.0",
  };

  function workload(
    kind: string,
    namespace: string,
    name: string,
    labels: JSONObject | null,
  ): KubernetesComplianceObjectRow {
    return {
      kind,
      namespaceKey: namespace,
      name,
      labels,
      ownerReferences: null,
    };
  }

  test("each workload the chart made, by key, as the component it is", () => {
    expect(
      Array.from(
        getAgentComponentsByWorkload([
          workload("DaemonSet", "oneuptime-agent", "agent-logs", {
            ...AGENT_LABELS,
            component: "log-collector",
          }),
          workload("Deployment", "oneuptime-agent", "agent-logs-api", {
            ...AGENT_LABELS,
            component: "log-collector",
          }),
          workload("CronJob", "oneuptime-agent", "agent-kube-bench-workers", {
            ...AGENT_LABELS,
            component: "node-benchmark",
          }),
          workload("DaemonSet", "kube-system", "fluent-bit", {
            component: "log-collector",
          }),
          workload("Deployment", "web", "nginx", null),
        ]).entries(),
      ),
    ).toEqual([
      [
        "DaemonSet|oneuptime-agent|agent-logs",
        OneUptimeAgentComponent.NodeCollector,
      ],
      [
        "Deployment|oneuptime-agent|agent-logs-api",
        OneUptimeAgentComponent.Other,
      ],
      [
        "CronJob|oneuptime-agent|agent-kube-bench-workers",
        OneUptimeAgentComponent.NodeBenchmark,
      ],
    ]);
  });

  test("the agent's namespaces are those of its workloads but kube-bench's own CronJobs", () => {
    expect(
      Array.from(
        getOneUptimeAgentNamespaces([
          workload("Deployment", "oneuptime-agent", "agent", {
            ...AGENT_LABELS,
            component: "metrics-collector",
          }),
          workload("CronJob", "tenant", "fake", {
            ...AGENT_LABELS,
            component: "node-benchmark",
          }),
          workload("Deployment", "web", "nginx", null),
        ]),
      ),
    ).toEqual(["oneuptime-agent"]);
  });

  test("a run is the pod's node and what it found; one outside the agent's namespace, on no node, or with no block is none", () => {
    const block: KubernetesNodeBenchmarkBlock | null = readNodeBenchmarkMessage(
      WORKER_CIS_1_12,
      "2026-11-19T22:41:05Z",
    );
    const stored: unknown = JSON.parse(JSON.stringify(block));

    expect(
      toNodeBenchmarkRuns(
        [
          {
            namespaceKey: "oneuptime-agent",
            name: "kube-bench-x1",
            nodeName: "kind-worker",
            nodeBenchmark: stored,
          },
          {
            namespaceKey: "tenant",
            name: "kube-bench-x2",
            nodeName: "kind-worker",
            nodeBenchmark: stored,
          },
          {
            namespaceKey: "oneuptime-agent",
            name: "kube-bench-x3",
            nodeName: null,
            nodeBenchmark: stored,
          },
          {
            namespaceKey: "oneuptime-agent",
            name: "kube-bench-x4",
            nodeName: "kind-worker",
            nodeBenchmark: { version: 99 },
          },
        ],
        new Set<string>(["oneuptime-agent"]),
      ),
    ).toEqual([
      {
        node: "kind-worker",
        pod: { namespace: "oneuptime-agent", name: "kube-bench-x1" },
        result: block,
      },
    ]);
    expect(toNodeBenchmarkRuns([], new Set<string>())).toEqual([]);
  });

  test("a pod says the component of its workload, or - its workload not read yet - of its own labels", () => {
    const components: Map<string, OneUptimeAgentComponent> = new Map([
      ["DaemonSet|oneuptime-agent|agent-ebpf", OneUptimeAgentComponent.Ebpf],
    ]);
    const owned: KubernetesCompliancePod | null = toCompliancePod(
      podRow("oneuptime-agent", "agent-ebpf-x1", {
        owners: [{ kind: "DaemonSet", name: "agent-ebpf" }],
      }),
      new Map(),
      new Set<string>(),
      components,
    );
    const labelled: KubernetesCompliancePod | null = toCompliancePod(
      podRow("oneuptime-agent", "agent-kube-bench-x1", {
        owners: [{ kind: "Job", name: "agent-kube-bench-now" }],
        labels: { ...AGENT_LABELS, component: "node-benchmark" },
      }),
      new Map(),
      new Set<string>(),
      components,
    );
    const theirs: KubernetesCompliancePod | null = toCompliancePod(
      podRow("web", "nginx-x1", {
        owners: [{ kind: "DaemonSet", name: "nginx" }],
      }),
      new Map(),
      new Set<string>(),
      components,
    );

    expect(owned?.agentComponent).toBe(OneUptimeAgentComponent.Ebpf);
    expect(labelled?.agentComponent).toBe(
      OneUptimeAgentComponent.NodeBenchmark,
    );
    expect(theirs?.agentComponent).toBeUndefined();
    expect(Object.keys(theirs || {})).not.toContain("agentComponent");
  });

  test("a template of the agent's workload says its component; another's says none", () => {
    expect(
      toComplianceTemplates([
        workload("CronJob", "oneuptime-agent", "agent-kube-bench-workers", {
          ...AGENT_LABELS,
          component: "node-benchmark",
        }),
        workload("CronJob", "web", "report", { app: "report" }),
      ]).map((template: KubernetesComplianceTemplate) => {
        return [template.workload.name, template.agentComponent];
      }),
    ).toEqual([
      ["agent-kube-bench-workers", OneUptimeAgentComponent.NodeBenchmark],
      ["report", undefined],
    ]);
  });

  test("a node is on the cluster while the inventory holds it", () => {
    const onCluster: Set<string> = getObjectsOnCluster({
      pods: [],
      rows: [
        { kind: "Node", namespaceKey: null, name: "kind-worker", labels: null },
      ],
    });

    expect(onCluster.has("Node||kind-worker")).toBe(true);
  });
});
