import KubernetesCpuUtils from "./KubernetesCpuUtils";

/**
 * Kubernetes memory as a real percentage, the memory half of
 * KubernetesCpuUtils:
 *
 *     Memory% = working set bytes / allocatable memory bytes * 100
 *
 * The numerator is the kubeletstats receiver's
 * `k8s.node.memory.working_set`: the memory the node's processes actually
 * hold, without the file cache the kernel frees as soon as it is needed.
 * It is what `kubectl top node` shows and what the kubelet weighs before it
 * evicts pods, so a full bar means a node is really running out.
 * `k8s.node.memory.usage` counts that cache too and sits near the node's
 * whole memory on a quiet node, which would read as a red bar for a
 * healthy cluster - or as more than 100%, since allocatable is smaller
 * than capacity.
 *
 * The denominator is the k8s_cluster receiver's
 * `k8s.node.allocatable_memory` (the agent chart reports it through
 * `allocatable_types_to_report`): the memory Kubernetes can hand out to
 * pods, what the CPU tile's `k8s.node.allocatable_cpu` is for CPU.
 */

export const NODE_MEMORY_WORKING_SET_METRIC: string =
  "k8s.node.memory.working_set";

export const NODE_ALLOCATABLE_MEMORY_METRIC: string =
  "k8s.node.allocatable_memory";

export interface ClusterMemoryUtilization {
  // Working set bytes in use across every node; null when none reported.
  usedBytes: number | null;
  /*
   * Allocatable memory across every node; null when the nodes report
   * none (an older agent, or the metric not reaching OneUptime).
   */
  allocatableBytes: number | null;
  /*
   * usedBytes as a share of allocatableBytes; null when either is
   * missing, so the tile draws no bar rather than a wrong one. Not
   * capped: a figure over 100 is a cluster using memory set aside for
   * the system, and the tile caps only its bar.
   */
  percent: number | null;
}

export default class KubernetesMemoryUtils {
  /**
   * Allocatable memory (bytes) added up across every node of a cluster
   * that reported it in the window; 0 when none did.
   */
  public static async fetchClusterAllocatableMemoryBytes(options: {
    clusterIdentifier: string;
    startDate: Date;
    endDate: Date;
  }): Promise<number> {
    const perNode: Map<string, number> =
      await KubernetesCpuUtils.fetchNodeAllocatablePerNode({
        ...options,
        metricName: NODE_ALLOCATABLE_MEMORY_METRIC,
      });
    return KubernetesMemoryUtils.sumAllocatable(perNode);
  }

  public static sumAllocatable(perNode: Map<string, number>): number {
    let total: number = 0;
    for (const bytes of perNode.values()) {
      if (Number.isFinite(bytes) && bytes > 0) {
        total += bytes;
      }
    }
    return total;
  }

  /**
   * What the cluster overview's Memory tile reads: the bytes in use, the
   * allocatable memory they are measured against, and the share - each
   * null when it cannot be known.
   */
  public static getClusterMemoryUtilization(options: {
    usedBytes: number | null;
    allocatableBytes: number | null;
  }): ClusterMemoryUtilization {
    const usedBytes: number | null =
      options.usedBytes !== null &&
      Number.isFinite(options.usedBytes) &&
      options.usedBytes >= 0
        ? options.usedBytes
        : null;
    const allocatableBytes: number | null =
      options.allocatableBytes !== null &&
      Number.isFinite(options.allocatableBytes) &&
      options.allocatableBytes > 0
        ? options.allocatableBytes
        : null;

    return {
      usedBytes: usedBytes,
      allocatableBytes: allocatableBytes,
      percent:
        usedBytes !== null && allocatableBytes !== null
          ? (usedBytes / allocatableBytes) * 100
          : null,
    };
  }
}
