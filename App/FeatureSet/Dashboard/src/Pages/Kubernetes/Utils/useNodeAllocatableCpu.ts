import { useEffect, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import KubernetesCpuUtils, {
  NodeAllocatableCpu,
} from "./KubernetesCpuUtils";

/**
 * Load the per-node allocatable CPU lookup for a cluster so CPU charts
 * can render usage as a true "% of node capacity". Allocatable barely
 * changes, so we fetch it once over a recent window (independent of the
 * chart's own time range) and memoize per cluster.
 *
 * Returns `null` while loading; an empty lookup (denominators resolve
 * to 0) if the `k8s.node.allocatable_cpu` metric isn't available.
 */
export default function useNodeAllocatableCpu(
  clusterIdentifier: string | undefined,
): NodeAllocatableCpu | null {
  const [allocatable, setAllocatable] = useState<NodeAllocatableCpu | null>(
    null,
  );

  useEffect(() => {
    if (!clusterIdentifier) {
      return;
    }

    let cancelled: boolean = false;
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -2);

    KubernetesCpuUtils.fetchNodeAllocatableCpu({
      clusterIdentifier: clusterIdentifier,
      startDate: startDate,
      endDate: endDate,
    })
      .then((result: NodeAllocatableCpu) => {
        if (!cancelled) {
          setAllocatable(result);
        }
        return;
      })
      .catch(() => {
        if (!cancelled) {
          setAllocatable(KubernetesCpuUtils.buildAllocatable(new Map()));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clusterIdentifier]);

  return allocatable;
}
