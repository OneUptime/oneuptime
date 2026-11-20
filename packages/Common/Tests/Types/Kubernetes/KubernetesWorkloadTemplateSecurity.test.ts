import { JSONObject } from "../../../Types/JSON";
import {
  ExtractedInventoryRecord,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  CRON_JOB_POD_TEMPLATE_PATH,
  KubernetesCronJobObject,
  KubernetesDaemonSetObject,
  KubernetesDeploymentObject,
  KubernetesJobObject,
  KubernetesReplicaSetObject,
  KubernetesStatefulSetObject,
  parseCronJobObject,
  parseDaemonSetObject,
  parseDeploymentObject,
  parseJobObject,
  parseReplicaSetObject,
  parseStatefulSetObject,
  readPodTemplateSecurity,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import {
  POD_SECURITY_BLOCK_VERSION,
  PodSecurity,
  toPodSecurity,
} from "../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  OpenShiftDeploymentConfigObject,
  parseDeploymentConfigObject,
} from "../../../Types/Kubernetes/OpenShiftObjectParser";
import {
  PlainValue,
  toOtlpAnyValue,
} from "../../Helpers/KubernetesEventRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * A WORKLOAD'S POD TEMPLATE, READ INTO THE BLOCK A POD KEEPS (#9880).
 *
 * A Deployment scaled to zero, a CronJob between runs or a DaemonSet that
 * matches no node runs no pod, so the Compliance page had nothing of it to
 * score. Each workload's template is read at ingest into the same compact
 * security block a pod's spec keeps, from spec.template - for a CronJob,
 * spec.jobTemplate.spec.template - and stored on the workload's own row.
 * The fixtures are written as `kubectl get -o json` prints the objects and
 * encoded the way the collector sends them (toOtlpAnyValue).
 */

function asKvList(object: PlainValue): JSONObject {
  return toOtlpAnyValue(object)["kvlistValue"] as JSONObject;
}

// A node agent's pod template: privileged, on the host, mounting the host's logs.
const PRIVILEGED_TEMPLATE: PlainValue = {
  metadata: {
    labels: { app: "log-shipper" },
    annotations: {
      "container.apparmor.security.beta.kubernetes.io/shipper": "unconfined",
    },
  },
  spec: {
    hostNetwork: true,
    hostPID: true,
    serviceAccountName: "log-shipper",
    containers: [
      {
        name: "shipper",
        image: "fluent/fluent-bit:3.1",
        securityContext: {
          privileged: true,
          capabilities: { add: ["SYS_ADMIN"] },
        },
        ports: [{ containerPort: 2020, hostPort: 2020 }],
      },
    ],
    volumes: [{ name: "varlog", hostPath: { path: "/var/log" } }],
  },
};

// A hardened template: what Restricted asks for.
const HARDENED_TEMPLATE: PlainValue = {
  metadata: { labels: { app: "api" } },
  spec: {
    securityContext: {
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    },
    containers: [
      {
        name: "api",
        image: "ghcr.io/acme/api:1.4.0",
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"] },
        },
      },
    ],
  },
};

function metadata(name: string, namespace: string): PlainValue {
  return { name, namespace, uid: `${name}-uid` };
}

function deployment(replicas: number, template: PlainValue): PlainValue {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: metadata("log-shipper", "logging"),
    spec: {
      replicas,
      selector: { matchLabels: { app: "log-shipper" } },
      strategy: { type: "RollingUpdate" },
      template,
    },
    status: { observedGeneration: 3 },
  };
}

function expectPrivileged(security: PodSecurity | undefined): void {
  expect(security).toBeDefined();
  expect(security!.version).toBe(POD_SECURITY_BLOCK_VERSION);
  expect(security!.hostNetwork).toBe(true);
  expect(security!.hostPID).toBe(true);
  expect(security!.containers).toEqual([
    {
      name: "shipper",
      list: "containers",
      privileged: true,
      capabilitiesAdd: ["SYS_ADMIN"],
      hostPorts: [2020],
    },
  ]);
  expect(security!.volumes).toEqual([
    { name: "varlog", type: "hostPath", hostPath: "/var/log" },
  ]);
  // The template's own annotations: AppArmor's profile before the field.
  expect(security!.appArmorAnnotations).toEqual({ shipper: "unconfined" });
}

describe("each workload's pod template is read into a pod's security block", () => {
  test("a Deployment scaled to zero keeps its template's block", () => {
    const parsed: KubernetesDeploymentObject | null = parseDeploymentObject(
      asKvList(deployment(0, PRIVILEGED_TEMPLATE)),
    );

    expect(parsed?.spec.replicas).toBe(0);
    expectPrivileged(parsed?.spec.security);
    // The rest of the projection is what it was.
    expect(parsed?.spec.selector).toEqual({ app: "log-shipper" });
    expect(parsed?.spec.strategy).toBe("RollingUpdate");
  });

  test("a StatefulSet's template", () => {
    const parsed: KubernetesStatefulSetObject | null = parseStatefulSetObject(
      asKvList({
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: metadata("ledger", "payments"),
        spec: {
          replicas: 0,
          serviceName: "ledger",
          updateStrategy: { type: "RollingUpdate" },
          template: PRIVILEGED_TEMPLATE,
        },
        status: { replicas: 0 },
      }),
    );

    expect(parsed?.spec.serviceName).toBe("ledger");
    expectPrivileged(parsed?.spec.security);
  });

  test("a DaemonSet whose node selector matches no node", () => {
    const parsed: KubernetesDaemonSetObject | null = parseDaemonSetObject(
      asKvList({
        apiVersion: "apps/v1",
        kind: "DaemonSet",
        metadata: metadata("gpu-driver", "kube-system"),
        spec: {
          updateStrategy: { type: "OnDelete" },
          template: PRIVILEGED_TEMPLATE,
        },
        status: { desiredNumberScheduled: 0, currentNumberScheduled: 0 },
      }),
    );

    expect(parsed?.status.desiredNumberScheduled).toBe(0);
    expectPrivileged(parsed?.spec.security);
  });

  test("a ReplicaSet's template, and its replicas and selector", () => {
    const parsed: KubernetesReplicaSetObject | null = parseReplicaSetObject(
      asKvList({
        apiVersion: "apps/v1",
        kind: "ReplicaSet",
        metadata: metadata("legacy-web", "web"),
        spec: {
          replicas: 0,
          selector: { matchLabels: { app: "legacy-web" } },
          template: PRIVILEGED_TEMPLATE,
        },
        status: { replicas: 0, readyReplicas: 0, availableReplicas: 0 },
      }),
    );

    expect(parsed?.metadata.name).toBe("legacy-web");
    expect(parsed?.spec.replicas).toBe(0);
    expect(parsed?.spec.selector).toEqual({ app: "legacy-web" });
    expectPrivileged(parsed?.spec.security);
  });

  test("a Job's template", () => {
    const parsed: KubernetesJobObject | null = parseJobObject(
      asKvList({
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: metadata("migrate", "payments"),
        spec: {
          completions: 1,
          parallelism: 1,
          backoffLimit: 4,
          template: PRIVILEGED_TEMPLATE,
        },
        status: { succeeded: 1 },
      }),
    );

    expect(parsed?.spec.backoffLimit).toBe(4);
    expectPrivileged(parsed?.spec.security);
  });

  test("a CronJob's template, from its job template: between runs it is all there is", () => {
    const parsed: KubernetesCronJobObject | null = parseCronJobObject(
      asKvList({
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: metadata("nightly-backup", "ops"),
        spec: {
          schedule: "0 2 * * *",
          suspend: false,
          successfulJobsHistoryLimit: 0,
          failedJobsHistoryLimit: 0,
          jobTemplate: {
            metadata: { labels: { app: "backup" } },
            spec: { backoffLimit: 2, template: PRIVILEGED_TEMPLATE },
          },
        },
        status: { lastScheduleTime: "2026-11-19T02:00:00Z" },
      }),
    );

    expect(parsed?.spec.schedule).toBe("0 2 * * *");
    expectPrivileged(parsed?.spec.security);
  });

  test("an OpenShift DeploymentConfig's template", () => {
    const parsed: OpenShiftDeploymentConfigObject | null =
      parseDeploymentConfigObject(
        asKvList({
          apiVersion: "apps.openshift.io/v1",
          kind: "DeploymentConfig",
          metadata: metadata("frontend", "shop"),
          spec: {
            replicas: 0,
            selector: { app: "frontend" },
            strategy: { type: "Rolling" },
            triggers: [{ type: "ConfigChange" }],
            template: PRIVILEGED_TEMPLATE,
          },
          status: { latestVersion: 4 },
        }),
      );

    expect(parsed?.spec.replicas).toBe(0);
    expect(parsed?.spec.triggers).toEqual(["ConfigChange"]);
    expectPrivileged(parsed?.spec.security);
  });

  test("a hardened template reads as one that sets what it sets", () => {
    const security: PodSecurity | undefined = parseDeploymentObject(
      asKvList(deployment(0, HARDENED_TEMPLATE)),
    )?.spec.security;

    expect(security).toEqual({
      version: POD_SECURITY_BLOCK_VERSION,
      runAsNonRoot: true,
      seccompProfileType: "RuntimeDefault",
      containers: [
        {
          name: "api",
          list: "containers",
          allowPrivilegeEscalation: false,
          capabilitiesDrop: ["ALL"],
        },
      ],
      volumes: [],
      resourcesRead: true,
    });
  });
});

describe("a workload sent without a template has no block", () => {
  test("no template, or one with no spec: not evaluated, rather than read as setting nothing", () => {
    const withoutTemplate: KubernetesDeploymentObject | null =
      parseDeploymentObject(
        asKvList({
          kind: "Deployment",
          metadata: metadata("api", "payments"),
          spec: { replicas: 0 },
        }),
      );
    const withoutPodSpec: KubernetesDeploymentObject | null =
      parseDeploymentObject(
        asKvList(deployment(0, { metadata: { labels: { app: "api" } } })),
      );

    expect(withoutTemplate?.spec.security).toBeUndefined();
    expect(withoutPodSpec?.spec.security).toBeUndefined();
    // Nor is the key written, so a stored row keeps its old shape.
    expect(Object.keys(withoutTemplate?.spec || {})).not.toContain("security");
  });

  test("a CronJob's template is read from its job template, never from a spec.template of its own", () => {
    const misplaced: KubernetesCronJobObject | null = parseCronJobObject(
      asKvList({
        kind: "CronJob",
        metadata: metadata("nightly-backup", "ops"),
        spec: { schedule: "0 2 * * *", template: PRIVILEGED_TEMPLATE },
      }),
    );

    expect(misplaced?.spec.security).toBeUndefined();
  });

  test("the reader takes a path, and a value that is no kvlist anywhere on it gives none", () => {
    expect(readPodTemplateSecurity(null)).toBeUndefined();
    expect(readPodTemplateSecurity("text")).toBeUndefined();
    expect(
      readPodTemplateSecurity(
        asKvList({ jobTemplate: "not an object" }),
        CRON_JOB_POD_TEMPLATE_PATH,
      ),
    ).toBeUndefined();
    expect(
      readPodTemplateSecurity(
        asKvList({ jobTemplate: { spec: { template: PRIVILEGED_TEMPLATE } } }),
        CRON_JOB_POD_TEMPLATE_PATH,
      )?.hostPID,
    ).toBe(true);
  });
});

describe("the inventory row keeps the template's block, for the Compliance page", () => {
  test.each([
    ["deployments", "Deployment", deployment(0, PRIVILEGED_TEMPLATE)],
    [
      "statefulsets",
      "StatefulSet",
      {
        kind: "StatefulSet",
        metadata: metadata("ledger", "payments"),
        spec: { replicas: 0, template: PRIVILEGED_TEMPLATE },
      },
    ],
    [
      "daemonsets",
      "DaemonSet",
      {
        kind: "DaemonSet",
        metadata: metadata("gpu-driver", "kube-system"),
        spec: { template: PRIVILEGED_TEMPLATE },
      },
    ],
    [
      "replicasets",
      "ReplicaSet",
      {
        kind: "ReplicaSet",
        metadata: metadata("legacy-web", "web"),
        spec: { replicas: 0, template: PRIVILEGED_TEMPLATE },
      },
    ],
    [
      "jobs",
      "Job",
      {
        kind: "Job",
        metadata: metadata("migrate", "payments"),
        spec: { template: PRIVILEGED_TEMPLATE },
      },
    ],
    [
      "cronjobs",
      "CronJob",
      {
        kind: "CronJob",
        metadata: metadata("nightly-backup", "ops"),
        spec: {
          schedule: "0 2 * * *",
          jobTemplate: { spec: { template: PRIVILEGED_TEMPLATE } },
        },
      },
    ],
    [
      "deploymentconfigs",
      "DeploymentConfig",
      {
        kind: "DeploymentConfig",
        metadata: metadata("frontend", "shop"),
        spec: { replicas: 0, template: PRIVILEGED_TEMPLATE },
      },
    ],
  ])(
    "%s: stored as a %s with spec.security",
    (resourceType: string, kind: string, object: PlainValue) => {
      const record: ExtractedInventoryRecord | null = extractInventoryResource({
        resourceType,
        logBody: JSON.stringify(toOtlpAnyValue(object)),
        lastSeenAt: new Date("2026-11-19T10:00:00.000Z"),
      });
      const spec: JSONObject = (record?.resource.spec || {}) as JSONObject;

      expect(record?.resource.kind).toBe(kind);
      // Stored, then read back as the scoring reads it.
      expect(
        toPodSecurity(JSON.parse(JSON.stringify(spec["security"]))),
      ).toEqual(toPodSecurity(spec["security"]));
      expect(toPodSecurity(spec["security"])?.hostNetwork).toBe(true);
      expect(toPodSecurity(spec["security"])?.containers[0]?.privileged).toBe(
        true,
      );
    },
  );

  test("the template's whole spec is never kept: only its block", () => {
    const record: ExtractedInventoryRecord | null = extractInventoryResource({
      resourceType: "deployments",
      logBody: JSON.stringify(
        toOtlpAnyValue(deployment(0, PRIVILEGED_TEMPLATE)),
      ),
      lastSeenAt: new Date("2026-11-19T10:00:00.000Z"),
    });
    const stored: string = JSON.stringify(record?.resource.spec);

    expect(stored).not.toContain("fluent/fluent-bit");
    expect(stored).not.toContain("serviceAccountName");
    expect(Object.keys(record?.resource.spec || {}).sort()).toEqual([
      "paused",
      "replicas",
      "security",
      "selector",
      "strategy",
    ]);
  });
});
