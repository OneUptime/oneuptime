import { describe, expect, test } from "@jest/globals";
import {
  deploymentNameFromPodName,
  getKubernetesResourceAttributes,
} from "../../../../Server/Utils/Telemetry/KubernetesResourceAttributes";
import InventoryItem from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import EntityType from "../../../../Types/Telemetry/EntityType";
import Dictionary from "../../../../Types/Dictionary";

/*
 * OneUptime's own pods used to report nothing but host.name — the pod
 * hostname — and were therefore registered as hundreds of "hosts". These
 * tests pin the Kubernetes identity the process now reports, and that the
 * entity model turns it into a pod rather than a host.
 */

const noNamespaceFile: () => string | null = (): string | null => {
  return null;
};

describe("getKubernetesResourceAttributes", () => {
  test("reports nothing outside Kubernetes", () => {
    expect(
      getKubernetesResourceAttributes({
        env: { HOSTNAME: "laptop" },
        hostname: "laptop",
        readServiceAccountNamespace: () => {
          return "should-not-be-read";
        },
      }),
    ).toEqual({});
  });

  test("uses the downward API variables the chart sets", () => {
    expect(
      getKubernetesResourceAttributes({
        env: {
          POD_NAME: "oneuptime-app-6d4f8b9c7d-x2k9p",
          POD_NAMESPACE: "oneuptime",
          NODE_NAME: "gke-pool-a-7x2k",
          POD_UID: "5f3c1a2e-0000-4000-8000-000000000001",
          K8S_DEPLOYMENT_NAME: "oneuptime-app",
          K8S_CLUSTER_NAME: "production-eu",
        },
        hostname: "ignored-when-pod-name-is-set",
        readServiceAccountNamespace: noNamespaceFile,
      }),
    ).toEqual({
      "k8s.pod.name": "oneuptime-app-6d4f8b9c7d-x2k9p",
      "k8s.namespace.name": "oneuptime",
      "k8s.node.name": "gke-pool-a-7x2k",
      "k8s.pod.uid": "5f3c1a2e-0000-4000-8000-000000000001",
      "k8s.deployment.name": "oneuptime-app",
      "k8s.cluster.name": "production-eu",
    });
  });

  test("falls back to the hostname and service account namespace inside a pod", () => {
    expect(
      getKubernetesResourceAttributes({
        env: { KUBERNETES_SERVICE_HOST: "10.96.0.1" },
        hostname: "oneuptime-worker-7b9d6c5f48-q8zwm",
        readServiceAccountNamespace: () => {
          return "oneuptime\n";
        },
      }),
    ).toEqual({
      "k8s.pod.name": "oneuptime-worker-7b9d6c5f48-q8zwm",
      "k8s.namespace.name": "oneuptime",
      "k8s.deployment.name": "oneuptime-worker",
    });
  });

  test("a broken namespace file costs only the namespace", () => {
    expect(
      getKubernetesResourceAttributes({
        env: { KUBERNETES_SERVICE_HOST: "10.96.0.1" },
        hostname: "web-0",
        readServiceAccountNamespace: () => {
          throw new Error("EACCES");
        },
      }),
    ).toEqual({ "k8s.pod.name": "web-0" });
  });

  test("ignores blank variables", () => {
    expect(
      getKubernetesResourceAttributes({
        env: {
          POD_NAME: "api-0",
          POD_NAMESPACE: "  ",
          NODE_NAME: "",
          K8S_CLUSTER_NAME: " ",
        },
        hostname: "",
        readServiceAccountNamespace: noNamespaceFile,
      }),
    ).toEqual({ "k8s.pod.name": "api-0" });
  });
});

describe("deploymentNameFromPodName", () => {
  test.each([
    ["oneuptime-app-6d4f8b9c7d-x2k9p", "oneuptime-app"],
    ["oneuptime-probe-one-7c8d9f5b6-bq2zt", "oneuptime-probe-one"],
    ["api-685856b7d7-48xkt", "api"],
  ])("%s belongs to %s", (pod: string, deployment: string) => {
    expect(deploymentNameFromPodName(pod)).toBe(deployment);
  });

  test.each([
    ["web-0"], // StatefulSet
    ["node-exporter-x2k9p"], // DaemonSet
    ["build-server-01"], // a real host
    ["api-6d4f8b9c7d-aeiou"], // vowels never appear in generated suffixes
  ])("%s is not a Deployment pod", (pod: string) => {
    expect(deploymentNameFromPodName(pod)).toBeNull();
  });
});

describe("the entity model classifies the reported identity as a pod", () => {
  const projectId: string = "8a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";

  test("a OneUptime pod is a pod in a deployment, not a host", () => {
    const attributes: Dictionary<string> = {
      "service.name": "api",
      "host.name": "oneuptime-app-6d4f8b9c7d-x2k9p",
      ...getKubernetesResourceAttributes({
        env: {
          POD_NAME: "oneuptime-app-6d4f8b9c7d-x2k9p",
          POD_NAMESPACE: "oneuptime",
          NODE_NAME: "gke-pool-a-7x2k",
          K8S_DEPLOYMENT_NAME: "oneuptime-app",
        },
        hostname: "oneuptime-app-6d4f8b9c7d-x2k9p",
        readServiceAccountNamespace: noNamespaceFile,
      }),
    };
    const types: Array<EntityType> = InventoryItem.extractEntities({
      projectId,
      attributes,
    }).map((entity: { entityType: EntityType }) => {
      return entity.entityType;
    });
    expect(types).toEqual(
      expect.arrayContaining([
        EntityType.Service,
        EntityType.KubernetesPod,
        EntityType.KubernetesNamespace,
        EntityType.KubernetesNode,
        EntityType.KubernetesDeployment,
      ]),
    );
    expect(types).not.toContain(EntityType.Host);

    // And the legacy host row that pod once minted is retired.
    expect(
      InventoryItem.extractEntitiesWithRetirements({ projectId, attributes })
        .retiredEntities?.[0]?.entityType,
    ).toBe(EntityType.Host);
  });
});
