import KubernetesCrashLoopDetector from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/KubernetesCrashLoopDetector";
import KubernetesContainer from "../../../../../Models/DatabaseModels/KubernetesContainer";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The two behaviours that decide whether this detector is usable or a pager
 * nightmare, pinned here:
 *
 *   1. Fingerprinting on the CONTROLLER, not the pod. Crash-looping pods are
 *      replaced with a new random name on every restart, so a pod-keyed
 *      fingerprint would mint a new insight — and, with escalation on, a new
 *      page — every few minutes for one broken Deployment.
 *
 *   2. Collapsing replicas. Five crashlooping pods of one Deployment are ONE
 *      finding; left ungrouped they would bump occurrenceCount five times per
 *      scan tick.
 */

const CLUSTER_ID: string = "11111111-1111-1111-1111-111111111111";

function buildContainer(data: {
  podName: string;
  containerName?: string;
  restartCount?: number;
  isInitContainer?: boolean;
}): KubernetesContainer {
  const container: KubernetesContainer = new KubernetesContainer();

  container._id = new ObjectID(ObjectID.generate().toString()).toString();
  container.kubernetesClusterId = new ObjectID(CLUSTER_ID);
  container.podNamespaceKey = "production";
  container.podName = data.podName;
  container.name = data.containerName || "checkout";
  container.reason = "CrashLoopBackOff";
  container.restartCount = data.restartCount ?? 5;
  container.isInitContainer = data.isInitContainer ?? false;

  return container;
}

describe("KubernetesCrashLoopDetector.buildFingerprint", () => {
  test("two different pod names under one controller collapse to ONE fingerprint", () => {
    // The rollout case: same Deployment, new pod name after each restart.
    const first: string = KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: CLUSTER_ID,
      namespace: "production",
      controllerOrPodName: "checkout",
      containerName: "checkout",
    });

    const second: string = KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: CLUSTER_ID,
      namespace: "production",
      controllerOrPodName: "checkout",
      containerName: "checkout",
    });

    expect(first).toBe(second);
  });

  test("different containers in the same controller stay distinct", () => {
    const app: string = KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: CLUSTER_ID,
      namespace: "production",
      controllerOrPodName: "checkout",
      containerName: "checkout",
    });

    const sidecar: string = KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: CLUSTER_ID,
      namespace: "production",
      controllerOrPodName: "checkout",
      containerName: "envoy",
    });

    expect(app).not.toBe(sidecar);
  });

  test("the same controller name in two namespaces stays distinct", () => {
    const production: string = KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: CLUSTER_ID,
      namespace: "production",
      controllerOrPodName: "checkout",
      containerName: "checkout",
    });

    const staging: string = KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: CLUSTER_ID,
      namespace: "staging",
      controllerOrPodName: "checkout",
      containerName: "checkout",
    });

    expect(production).not.toBe(staging);
  });

  test("the same controller in two clusters stays distinct", () => {
    const clusterA: string = KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: CLUSTER_ID,
      namespace: "production",
      controllerOrPodName: "checkout",
      containerName: "checkout",
    });

    const clusterB: string = KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: "22222222-2222-2222-2222-222222222222",
      namespace: "production",
      controllerOrPodName: "checkout",
      containerName: "checkout",
    });

    expect(clusterA).not.toBe(clusterB);
  });
});

describe("KubernetesCrashLoopDetector.groupByFingerprint", () => {
  const byController: (container: KubernetesContainer) => string = (
    container: KubernetesContainer,
  ): string => {
    return KubernetesCrashLoopDetector.buildFingerprint({
      clusterId: container.kubernetesClusterId?.toString() || "-",
      namespace: container.podNamespaceKey || "-",
      // Every replica resolves to the same controller.
      controllerOrPodName: "checkout",
      containerName: container.name || "-",
    });
  };

  test("five crashlooping replicas collapse to one candidate", () => {
    const containers: Array<KubernetesContainer> = [
      buildContainer({ podName: "checkout-7d9f8b6c4-aaaaa", restartCount: 3 }),
      buildContainer({ podName: "checkout-7d9f8b6c4-bbbbb", restartCount: 9 }),
      buildContainer({ podName: "checkout-7d9f8b6c4-ccccc", restartCount: 4 }),
      buildContainer({ podName: "checkout-7d9f8b6c4-ddddd", restartCount: 7 }),
      buildContainer({ podName: "checkout-7d9f8b6c4-eeeee", restartCount: 1 }),
    ];

    const groups: ReturnType<
      typeof KubernetesCrashLoopDetector.groupByFingerprint
    > = KubernetesCrashLoopDetector.groupByFingerprint(
      containers,
      byController,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.affectedPodCount).toBe(5);
  });

  test("keeps the most-broken pod as the representative", () => {
    const containers: Array<KubernetesContainer> = [
      buildContainer({ podName: "checkout-aaaaa", restartCount: 3 }),
      buildContainer({ podName: "checkout-bbbbb", restartCount: 41 }),
      buildContainer({ podName: "checkout-ccccc", restartCount: 7 }),
    ];

    const groups: ReturnType<
      typeof KubernetesCrashLoopDetector.groupByFingerprint
    > = KubernetesCrashLoopDetector.groupByFingerprint(
      containers,
      byController,
    );

    expect(groups[0]?.representative.podName).toBe("checkout-bbbbb");
    expect(groups[0]?.representative.restartCount).toBe(41);
  });

  test("distinct containers produce distinct groups", () => {
    const containers: Array<KubernetesContainer> = [
      buildContainer({ podName: "checkout-aaaaa", containerName: "checkout" }),
      buildContainer({ podName: "checkout-aaaaa", containerName: "envoy" }),
    ];

    const groups: ReturnType<
      typeof KubernetesCrashLoopDetector.groupByFingerprint
    > = KubernetesCrashLoopDetector.groupByFingerprint(
      containers,
      byController,
    );

    expect(groups).toHaveLength(2);
    expect(
      groups.every((group: { affectedPodCount: number }) => {
        return group.affectedPodCount === 1;
      }),
    ).toBe(true);
  });

  test("an init container is grouped like any other container", () => {
    /*
     * Init:CrashLoopBackOff was invisible before this feature; make sure the
     * grouping path does not special-case it out of existence.
     */
    const containers: Array<KubernetesContainer> = [
      buildContainer({
        podName: "checkout-aaaaa",
        containerName: "migrate",
        isInitContainer: true,
      }),
      buildContainer({
        podName: "checkout-bbbbb",
        containerName: "migrate",
        isInitContainer: true,
      }),
    ];

    const groups: ReturnType<
      typeof KubernetesCrashLoopDetector.groupByFingerprint
    > = KubernetesCrashLoopDetector.groupByFingerprint(
      containers,
      byController,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.affectedPodCount).toBe(2);
    expect(groups[0]?.representative.isInitContainer).toBe(true);
  });

  test("an empty input produces no groups", () => {
    expect(
      KubernetesCrashLoopDetector.groupByFingerprint([], byController),
    ).toHaveLength(0);
  });
});
