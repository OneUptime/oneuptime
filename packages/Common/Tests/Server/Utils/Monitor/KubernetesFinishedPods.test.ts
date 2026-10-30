import { describe, expect, test } from "@jest/globals";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import KubernetesFinishedPods, {
  MAX_FINISHED_PODS,
  POD_UID_ATTRIBUTE,
} from "../../../../Server/Utils/Monitor/KubernetesFinishedPods";

/*
 * Which queries leave finished pods out, and how the uids are read back
 * from the grouped `k8s.pod.phase` read. The worker suite
 * (MonitorTelemetryMonitorKubernetesFinishedPods) runs it end to end.
 */

function result(uids: Array<unknown>): AggregatedResult {
  return {
    data: uids.map((uid: unknown) => {
      return {
        timestamp: new Date(),
        value: 3,
        attributes: { [POD_UID_ATTRIBUTE]: uid },
      };
    }),
  } as unknown as AggregatedResult;
}

describe("KubernetesFinishedPods", () => {
  test("only the container request metrics leave finished pods out", () => {
    expect(
      KubernetesFinishedPods.isScopedMetric("k8s.container.cpu_request"),
    ).toBe(true);
    expect(
      KubernetesFinishedPods.isScopedMetric(" K8s.Container.Memory_Request "),
    ).toBe(true);

    for (const metricName of [
      "k8s.container.cpu_limit",
      "k8s.node.allocatable_cpu",
      "k8s.pod.phase",
      "",
      undefined,
    ]) {
      expect(KubernetesFinishedPods.isScopedMetric(metricName)).toBe(false);
    }
  });

  test("reads each pod uid once, and skips rows without one", () => {
    expect(
      KubernetesFinishedPods.readUids(
        result(["a", " b ", "a", "", null, 42, undefined]),
      ),
    ).toEqual(["a", "b"]);
  });

  test("keeps at most MAX_FINISHED_PODS", () => {
    const uids: Array<string> = Array.from(
      { length: MAX_FINISHED_PODS + 10 },
      (_value: unknown, index: number) => {
        return `pod-${index}`;
      },
    );

    expect(KubernetesFinishedPods.readUids(result(uids))).toHaveLength(
      MAX_FINISHED_PODS,
    );
  });

  test("a read with no attributes reads no uids", () => {
    expect(
      KubernetesFinishedPods.readUids({
        data: [{ timestamp: new Date(), value: 3 }],
      } as unknown as AggregatedResult),
    ).toEqual([]);
  });
});
