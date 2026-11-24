/*
 * A LATER READING OF A WINDOW OF KUBERNETES COSTS (#9969).
 *
 * A Kubecost that reads the cloud's bill reconciles each hour's prices with
 * what was paid about two days after the hour, after the cost agent shipped
 * it at list prices. The agent reads the hour again then and ships the
 * reading as a correction (KubernetesCostIngestPayload.correction), and
 * ingest brings what the window holds in line with it: for each workload,
 * pod and container it writes the difference from the stored sums as a row
 * of its own (KubernetesCostAllocation.isCostAdjustment), so the table only
 * ever appends and a plain sum of a window's rows is the latest figure.
 *
 * What ingest reads of a window to do so, and which costs a correction
 * changes. Isomorphic: the server writes corrections, and the Dashboard
 * leaves their rows out of every count and average.
 */

/*
 * What a window holds for one workload, pod and container: the sums of its
 * rows, the first reading and any corrections since.
 */
export interface KubernetesCostStoredSlice {
  namespace: string;
  controllerKind: string;
  controllerName: string;
  podName: string;
  containerName: string;
  nodeName: string;
  providerId: string;
  labels: Record<string, string>;
  // The engine that priced its first reading, as that row says.
  costEngine: string;
  costEngineService: string;
  cpuCost: number;
  gpuCost: number;
  ramCost: number;
  pvCost: number;
  networkCost: number;
  loadBalancerCost: number;
  sharedCost: number;
  externalCost: number;
  totalCost: number;
  efficiencyWeight: number;
  weightedEfficiency: number;
}

export type KubernetesCostCorrectedColumn =
  | "cpuCost"
  | "gpuCost"
  | "ramCost"
  | "pvCost"
  | "networkCost"
  | "loadBalancerCost"
  | "sharedCost"
  | "externalCost"
  | "totalCost"
  | "efficiencyWeight"
  | "weightedEfficiency";

/*
 * The columns a correction changes: the costs reconciliation reprices, and
 * the efficiency weights worked out from them (KubernetesCostEfficiency),
 * so a group's cost-weighted efficiency is weighted by the reconciled costs.
 */
export const KUBERNETES_COST_CORRECTED_COLUMNS: ReadonlyArray<KubernetesCostCorrectedColumn> =
  [
    "cpuCost",
    "gpuCost",
    "ramCost",
    "pvCost",
    "networkCost",
    "loadBalancerCost",
    "sharedCost",
    "externalCost",
    "totalCost",
    "efficiencyWeight",
    "weightedEfficiency",
  ];

/*
 * A difference below this is float noise, not a reconciliation: a hundred
 * millionth of a cent of a container's hour.
 */
export const KUBERNETES_COST_CORRECTION_EPSILON: number = 1e-9;
