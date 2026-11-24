import { JSONObject } from "../../../Types/JSON";
import {
  ExtractedInventoryRecord,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  KubernetesNodeBenchmarkBlock,
  NodeBenchmarkTarget,
  toNodeBenchmarkBlock,
} from "../../../Types/Kubernetes/KubernetesNodeBenchmark";
import {
  PodSecurity,
  toPodSecurity,
} from "../../../Types/Kubernetes/KubernetesPodSecurity";
import {
  OneUptimeAgentComponent,
  getOneUptimeAgentComponent,
} from "../../../Types/Kubernetes/Compliance/KubernetesAgentWorkloads";
import {
  PlainValue,
  toOtlpAnyValue,
} from "../../Helpers/KubernetesEventRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * A KUBE-BENCH POD, AS THE AGENT'S RESOURCE SNAPSHOTS SEND IT (#9873).
 *
 * The fixture is the pod the chart's workers CronJob ran on a kind cluster
 * (`kubectl get pod -o json`, its script and managed fields left out), encoded
 * as the collector's k8sobjects receiver sends it. The inventory reads its
 * kube-bench container's termination message whole into spec.nodeBenchmark:
 * the message every other page shows is cut to a kilobyte, and a control
 * plane node's results are near one.
 */

const RESULTS: string =
  '{"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12","targets":"node","pass":"4.1.2 4.1.5 4.1.6 4.1.10 4.2.1 4.2.2 4.2.3 4.2.6 4.2.10 4.3.1","fail":"4.1.1 4.1.9","warn":"","manual":"4.1.3 4.1.4 4.1.7 4.1.8 4.2.4 4.2.5 4.2.7 4.2.8 4.2.9 4.2.11 4.2.12 4.2.13 4.2.14"}\n';

const LABELS: Record<string, string> = {
  "app.kubernetes.io/instance": "kb-agent",
  "app.kubernetes.io/managed-by": "Helm",
  "app.kubernetes.io/name": "kubernetes-agent",
  "app.kubernetes.io/part-of": "oneuptime",
  "app.kubernetes.io/version": "1.0.0",
  "batch.kubernetes.io/job-name":
    "kb-agent-kubernetes-agent-kube-bench-workers-now",
  component: "node-benchmark",
  "helm.sh/chart": "kubernetes-agent-0.7.3",
  "job-name": "kb-agent-kubernetes-agent-kube-bench-workers-now",
  "oneuptime.com/node-group": "workers",
};

function kubeBenchPod(
  overrides: {
    labels?: Record<string, string>;
    containerName?: string;
    state?: PlainValue;
  } = {},
): PlainValue {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: "kb-agent-kubernetes-agent-kube-bench-workers-now-rqx84",
      namespace: "oneuptime-agent",
      uid: "8c68e43f-2c02-4340-8a6a-e22d0ca337ab",
      labels: overrides.labels || LABELS,
      ownerReferences: [
        {
          apiVersion: "batch/v1",
          blockOwnerDeletion: true,
          controller: true,
          kind: "Job",
          name: "kb-agent-kubernetes-agent-kube-bench-workers-now",
          uid: "85146adb-028d-498f-ba38-3461c12af272",
        },
      ],
      creationTimestamp: "2026-11-19T23:06:58Z",
    },
    spec: {
      serviceAccountName: "kb-agent-kubernetes-agent-node-benchmark",
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      hostPID: true,
      restartPolicy: "Never",
      securityContext: { seccompProfile: { type: "RuntimeDefault" } },
      nodeName: "kb-9873-worker",
      nodeSelector: { "kubernetes.io/os": "linux" },
      volumes: [
        { emptyDir: { sizeLimit: "32Mi" }, name: "tmp" },
        {
          hostPath: { path: "/etc/kubernetes", type: "" },
          name: "etc-kubernetes",
        },
        {
          hostPath: { path: "/var/lib/kubelet", type: "" },
          name: "var-lib-kubelet",
        },
        { hostPath: { path: "/etc/systemd", type: "" }, name: "etc-systemd" },
        { hostPath: { path: "/lib/systemd", type: "" }, name: "lib-systemd" },
      ],
      containers: [
        {
          name: overrides.containerName || "kube-bench",
          image: "docker.io/aquasec/kube-bench:v0.16.0",
          imagePullPolicy: "IfNotPresent",
          command: ["/bin/sh", "-c"],
          args: ["set -u"],
          env: [{ name: "BENCHMARK", value: "cis-1.12" }],
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { add: ["DAC_OVERRIDE"], drop: ["ALL"] },
            privileged: false,
            readOnlyRootFilesystem: true,
            runAsUser: 0,
          },
          resources: {
            limits: { cpu: "500m", memory: "256Mi" },
            requests: { cpu: "50m", memory: "64Mi" },
          },
          terminationMessagePath: "/dev/termination-log",
          terminationMessagePolicy: "File",
        },
      ],
    },
    status: {
      phase: "Succeeded",
      containerStatuses: [
        {
          containerID:
            "containerd://d653a394d173748ce1d44e49ac4eed11276a3d3c8021b617553680b2239c0cca",
          image: "docker.io/aquasec/kube-bench:v0.16.0",
          lastState: {},
          name: overrides.containerName || "kube-bench",
          ready: false,
          restartCount: 0,
          started: false,
          state: overrides.state || {
            terminated: {
              containerID:
                "containerd://d653a394d173748ce1d44e49ac4eed11276a3d3c8021b617553680b2239c0cca",
              exitCode: 0,
              finishedAt: "2026-11-19T23:07:02Z",
              message: RESULTS,
              reason: "Completed",
              startedAt: "2026-11-19T23:06:59Z",
            },
          },
        },
      ],
    },
  };
}

function extract(pod: PlainValue): ExtractedInventoryRecord {
  const record: ExtractedInventoryRecord | null = extractInventoryResource({
    resourceType: "pods",
    logBody: JSON.stringify(toOtlpAnyValue(pod)),
    lastSeenAt: new Date("2026-11-19T23:10:00.000Z"),
  });

  if (!record) {
    throw new Error("The pod was not read");
  }

  return record;
}

function storedBlock(
  record: ExtractedInventoryRecord,
): KubernetesNodeBenchmarkBlock | null {
  return toNodeBenchmarkBlock(
    ((record.resource.spec || {}) as JSONObject)["nodeBenchmark"],
  );
}

describe("a kube-bench pod read into the inventory", () => {
  test("keeps what kube-bench found on its node, and when, on the pod's stored spec", () => {
    const record: ExtractedInventoryRecord = extract(kubeBenchPod());
    const block: KubernetesNodeBenchmarkBlock | null = storedBlock(record);

    expect(record.resource.kind).toBe("Pod");
    expect(record.resource.phase).toBe("Succeeded");
    expect(((record.resource.spec || {}) as JSONObject)["nodeName"]).toBe(
      "kb-9873-worker",
    );
    expect(block).toEqual({
      version: 1,
      benchmark: "cis-1.12",
      targets: [NodeBenchmarkTarget.Node],
      pass: [
        "4.1.2",
        "4.1.5",
        "4.1.6",
        "4.1.10",
        "4.2.1",
        "4.2.2",
        "4.2.3",
        "4.2.6",
        "4.2.10",
        "4.3.1",
      ],
      fail: ["4.1.1", "4.1.9"],
      warn: [],
      manual: [
        "4.1.3",
        "4.1.4",
        "4.1.7",
        "4.1.8",
        "4.2.4",
        "4.2.5",
        "4.2.7",
        "4.2.8",
        "4.2.9",
        "4.2.11",
        "4.2.12",
        "4.2.13",
        "4.2.14",
      ],
      finishedAt: "2026-11-19T23:07:02.000Z",
    });
  });

  test("reads a message longer than the kilobyte every page cuts a container's message to", () => {
    const pass: string = Array.from(
      { length: 200 },
      (_value: unknown, index: number): string => {
        return `1.2.${index + 1}`;
      },
    ).join(" ");
    const message: string = JSON.stringify({
      oneuptimeNodeBenchmark: 1,
      benchmark: "cis-1.12",
      targets: "master node",
      pass,
      fail: "",
      warn: "",
      manual: "",
    });

    expect(message.length).toBeGreaterThan(1024);

    const block: KubernetesNodeBenchmarkBlock | null = storedBlock(
      extract(
        kubeBenchPod({
          state: {
            terminated: {
              exitCode: 0,
              finishedAt: "2026-11-19T23:07:02Z",
              message,
              reason: "Completed",
            },
          },
        }),
      ),
    );

    expect(block?.pass).toHaveLength(200);
  });

  test("keeps why a run could not finish", () => {
    const block: KubernetesNodeBenchmarkBlock | null = storedBlock(
      extract(
        kubeBenchPod({
          state: {
            terminated: {
              exitCode: 1,
              finishedAt: "2026-11-19T23:22:40Z",
              message:
                '{"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12","error":"error looking for file /etc/systemd/system/kubelet.service.d/10-kubeadm.conf: stat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf: permission denied exit status 1"}\n',
              reason: "Error",
            },
          },
        }),
      ),
    );

    expect(block?.error).toMatch(/permission denied exit status 1$/);
    expect(block?.pass).toEqual([]);
  });

  test("keeps nothing while kube-bench still runs", () => {
    expect(
      storedBlock(
        extract(
          kubeBenchPod({
            state: { running: { startedAt: "2026-11-19T23:06:59Z" } },
          }),
        ),
      ),
    ).toBeNull();
  });

  test("reads only the chart's kube-bench pods, and only their kube-bench container", () => {
    const otherPod: ExtractedInventoryRecord = extract(
      kubeBenchPod({ labels: { app: "api", component: "web" } }),
    );
    const otherContainer: ExtractedInventoryRecord = extract(
      kubeBenchPod({ containerName: "sidecar" }),
    );

    expect(
      ((otherPod.resource.spec || {}) as JSONObject)["nodeBenchmark"],
    ).toBeUndefined();
    expect(storedBlock(otherContainer)).toBeNull();
  });

  test("a pod that writes something else as its message keeps nothing", () => {
    expect(
      storedBlock(
        extract(
          kubeBenchPod({
            state: {
              terminated: {
                exitCode: 0,
                message: "all checks passed",
                reason: "Completed",
              },
            },
          }),
        ),
      ),
    ).toBeNull();
  });

  test("its security block says what the Pod Security Standards will fail it on, and whose it is", () => {
    const record: ExtractedInventoryRecord = extract(kubeBenchPod());
    const security: PodSecurity | null = toPodSecurity(
      ((record.resource.spec || {}) as JSONObject)["security"],
    );

    expect(security?.hostPID).toBe(true);
    expect(security?.automountServiceAccountToken).toBe(false);
    expect(
      security?.volumes
        .filter((volume: { type: string }): boolean => {
          return volume.type === "hostPath";
        })
        .map((volume: { hostPath?: string | undefined }) => {
          return volume.hostPath;
        }),
    ).toEqual([
      "/etc/kubernetes",
      "/var/lib/kubelet",
      "/etc/systemd",
      "/lib/systemd",
    ]);
    expect(security?.containers[0]?.runAsUser).toBe(0);
    expect(security?.containers[0]?.capabilitiesAdd).toEqual(["DAC_OVERRIDE"]);
    // Its limits are read too (#9875), with the marker a block from before has not.
    expect(security?.resourcesRead).toBe(true);
    expect(security?.containers[0]?.limits).toEqual(["cpu", "memory"]);
    // The agent's own: kube-bench's pods carry the chart's labels whole (#9929).
    expect(
      getOneUptimeAgentComponent({ kind: "CronJob", labels: LABELS }),
    ).toBe(OneUptimeAgentComponent.NodeBenchmark);
  });
});
