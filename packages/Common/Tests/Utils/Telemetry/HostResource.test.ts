import {
  APPLICATION_SDK_ATTRIBUTE_KEYS,
  CONTAINER_ATTRIBUTE_KEYS,
  CONTAINER_ENGINE_ATTRIBUTE_KEYS,
  KUBERNETES_IDENTITY_ATTRIBUTE_KEYS,
  NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS,
  NotAHostReason,
  getNotAHostReason,
  getNotAHostReasonOfAttributes,
} from "../../../Utils/Telemetry/HostResource";
import { describe, expect, test } from "@jest/globals";

/*
 * What rules a resource out as a host's own telemetry (issue #11257), read
 * from its attributes and never from its name. Each resource below is the
 * shape a real producer sends: the recordings under App/Tests/Telemetry/
 * Fixtures/HostResourceRecordings hold the Docker Agent's, the Kubernetes
 * agent's and two app pods' exactly as sent; the host collector's is what
 * OneUptime's default Linux config's resourcedetection sets.
 */

// What OneUptime's host collector sets on a host's own telemetry.
const HOST_COLLECTOR: Record<string, unknown> = {
  "host.name": "db-01",
  "host.id": "5f3a0c1e9b2d4c7a8e6f1d2c3b4a5968",
  "host.arch": "amd64",
  "os.type": "linux",
  "os.description": "Linux db-01 6.8.0-1017-azure",
  "cloud.provider": "azure",
  "cloud.platform": "azure_vm",
};

// OneUptime's Android Agent describing its device: a host, by design.
const ANDROID_AGENT_DEVICE: Record<string, unknown> = {
  "host.name": "store-0412-kiosk-02",
  "host.id": "3f2a9c1b7d4e5a60",
  "os.type": "linux",
  "os.name": "Android",
  "device.manufacturer": "Elo Touch Solutions",
  "oneuptime.agent.version": "17.0.12",
};

// The Docker Agent's container metrics (docker-agent.json, recorded).
const DOCKER_AGENT: Record<string, unknown> = {
  "container.hostname": "8cb880203d29",
  "container.id":
    "8cb880203d291c1695939ecf20c30ed34826461b83b47283fba4f98233a4750e",
  "container.image.name": "quay.io/prometheus/busybox-linux-amd64:latest",
  "container.name": "hosts11257-docker-app",
  "container.runtime": "docker",
  "host.name": "web-shop-01",
  "oneuptime.agent.version": "18.0.0",
  "os.type": "linux",
};

// The Docker Agent's logs: no container name, the runtime and the host.
const DOCKER_AGENT_LOGS: Record<string, unknown> = {
  "container.id":
    "8cb880203d291c1695939ecf20c30ed34826461b83b47283fba4f98233a4750e",
  "container.runtime": "docker",
  "host.name": "web-shop-01",
  "os.type": "linux",
};

// An app in a pod with host/os/process detectors (direct-otlp-pods.json).
const POD_APP: Record<string, unknown> = {
  "host.arch": "amd64",
  "host.name": "shop-worker-6748887dc-2wr95",
  "os.type": "linux",
  "process.runtime.name": "nodejs",
  "service.name": "shop-worker",
  "telemetry.sdk.language": "nodejs",
  "telemetry.sdk.name": "opentelemetry",
  "telemetry.sdk.version": "1.30.1",
};

// The Kubernetes agent's hostmetrics block (kubernetes-agent.json).
const KUBERNETES_NODE: Record<string, unknown> = {
  "k8s.cluster.name": "shop-cluster",
  "k8s.node.name": "hosts11257-control-plane",
  "oneuptime.agent.version": "1.0.0",
  "service.name": "kubernetes-agent-shop-cluster",
};

describe("getNotAHostReasonOfAttributes", () => {
  test("a host's own collector telemetry and the Android Agent's device are hosts", () => {
    expect(getNotAHostReasonOfAttributes(HOST_COLLECTOR)).toBeNull();
    expect(getNotAHostReasonOfAttributes(ANDROID_AGENT_DEVICE)).toBeNull();
  });

  test("the Docker Agent's metrics and logs name a container engine", () => {
    expect(getNotAHostReasonOfAttributes(DOCKER_AGENT)).toBe(
      NotAHostReason.ContainerEngine,
    );
    expect(getNotAHostReasonOfAttributes(DOCKER_AGENT_LOGS)).toBe(
      NotAHostReason.ContainerEngine,
    );
  });

  test("the Podman Agent's are a container engine's too, and any other runtime's", () => {
    for (const runtime of ["podman", "containerd", "cri-o"]) {
      expect(
        getNotAHostReasonOfAttributes({
          ...DOCKER_AGENT,
          "container.runtime": runtime,
        }),
      ).toBe(NotAHostReason.ContainerEngine);
    }
  });

  test("telemetry from inside a container is a container's", () => {
    expect(
      getNotAHostReasonOfAttributes({
        ...HOST_COLLECTOR,
        "container.id": "f7c01bbfb854",
      }),
    ).toBe(NotAHostReason.Container);
  });

  test("an application's SDK telemetry is the application's, whatever host it names", () => {
    expect(getNotAHostReasonOfAttributes(POD_APP)).toBe(
      NotAHostReason.Application,
    );

    // Either required SDK attribute alone is enough.
    for (const key of APPLICATION_SDK_ATTRIBUTE_KEYS) {
      expect(
        getNotAHostReasonOfAttributes({ ...HOST_COLLECTOR, [key]: "go" }),
      ).toBe(NotAHostReason.Application);
    }
  });

  test("a Kubernetes identity wins over everything, as the Kubernetes product owns it", () => {
    expect(getNotAHostReasonOfAttributes(KUBERNETES_NODE)).toBe(
      NotAHostReason.Kubernetes,
    );
    expect(
      getNotAHostReasonOfAttributes({
        ...POD_APP,
        ...DOCKER_AGENT,
        "k8s.pod.uid": "26e2ba1b-6479-4be4-9cbd-e5d0f436b262",
      }),
    ).toBe(NotAHostReason.Kubernetes);
  });

  test("each Kubernetes identity key alone rules a resource out", () => {
    for (const key of KUBERNETES_IDENTITY_ATTRIBUTE_KEYS) {
      expect(
        getNotAHostReasonOfAttributes({ ...HOST_COLLECTOR, [key]: "x" }),
      ).toBe(NotAHostReason.Kubernetes);
    }
  });

  test("a container engine is reported before a container, a container before an application", () => {
    expect(
      getNotAHostReasonOfAttributes({ ...POD_APP, ...DOCKER_AGENT }),
    ).toBe(NotAHostReason.ContainerEngine);
    expect(
      getNotAHostReasonOfAttributes({
        ...POD_APP,
        "container.id": "abc",
      }),
    ).toBe(NotAHostReason.Container);
  });

  test("blank, missing and structured values rule nothing out", () => {
    expect(
      getNotAHostReasonOfAttributes({
        ...HOST_COLLECTOR,
        "container.runtime": "   ",
        "container.id": "",
        "telemetry.sdk.name": null,
        "telemetry.sdk.language": undefined,
        "k8s.pod.name": ["a", "b"],
      }),
    ).toBeNull();
    expect(getNotAHostReasonOfAttributes(null)).toBeNull();
    expect(getNotAHostReasonOfAttributes(undefined)).toBeNull();
  });

  test("a number or a boolean is a value", () => {
    expect(
      getNotAHostReasonOfAttributes({ ...HOST_COLLECTOR, "k8s.pod.uid": 7 }),
    ).toBe(NotAHostReason.Kubernetes);
    expect(
      getNotAHostReasonOfAttributes({
        ...HOST_COLLECTOR,
        "container.id": true,
      }),
    ).toBe(NotAHostReason.Container);
  });

  test("the host's name is never read: a pod-like name on a host's own telemetry is a host", () => {
    expect(
      getNotAHostReasonOfAttributes({
        ...HOST_COLLECTOR,
        "host.name": "checkout-7d9f6b8c5d-x2kq9",
      }),
    ).toBeNull();
  });
});

describe("getNotAHostReason", () => {
  test("reads through the caller's reader, one key at a time", () => {
    const asked: Array<string> = [];

    const reason: NotAHostReason | null = getNotAHostReason(
      (key: string): string | null => {
        asked.push(key);
        return key === "container.id" ? "abc" : null;
      },
    );

    expect(reason).toBe(NotAHostReason.Container);
    // It stops at the first group that rules the resource out.
    expect(asked).toEqual([
      ...KUBERNETES_IDENTITY_ATTRIBUTE_KEYS,
      ...CONTAINER_ENGINE_ATTRIBUTE_KEYS,
      ...CONTAINER_ATTRIBUTE_KEYS,
    ]);
  });
});

describe("NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS", () => {
  test("lists every key that rules a resource out, each once", () => {
    expect(NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS).toEqual([
      "k8s.cluster.name",
      "k8s.namespace.name",
      "k8s.node.name",
      "k8s.node.uid",
      "k8s.pod.name",
      "k8s.pod.uid",
      "k8s.deployment.name",
      "container.runtime",
      "container.id",
      "telemetry.sdk.name",
      "telemetry.sdk.language",
    ]);
    expect(new Set(NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS).size).toBe(
      NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS.length,
    );
  });

  test("each of them alone rules a host's own resource out", () => {
    for (const key of NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS) {
      expect(
        getNotAHostReasonOfAttributes({ ...HOST_COLLECTOR, [key]: "x" }),
      ).not.toBeNull();
    }
  });
});
