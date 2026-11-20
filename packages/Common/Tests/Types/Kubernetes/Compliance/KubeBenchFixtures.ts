/*
 * WHAT KUBE-BENCH v0.16.0 WROTE ON A REAL CLUSTER (#9873).
 *
 * Each message is the termination message the kubernetes-agent chart's
 * kube-bench container wrote (templates/_node-benchmark.tpl), from kube-bench
 * v0.16.0's own JSON cut by the chart's jq program, on a kind v0.33 cluster
 * of one control plane node and one worker. The control plane node ran the
 * generic benchmark, and kube-bench found the API server and etcd there; the
 * worker ran each managed platform's benchmark in turn, so each reads as that
 * platform's worker node would (kind's kubelet files are kubeadm's, so the
 * platforms' own path checks fail where their nodes keep them elsewhere).
 * Kept as written: each check's number by its result, never CIS's text.
 */

export const CONTROL_PLANE_CIS_1_12: string =
  '{"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12","targets":"master etcd controlplane node","pass":"1.1.1 1.1.2 1.1.3 1.1.4 1.1.5 1.1.6 1.1.7 1.1.8 1.1.11 1.1.13 1.1.14 1.1.15 1.1.16 1.1.17 1.1.18 1.1.19 1.2.2 1.2.4 1.2.6 1.2.7 1.2.8 1.2.10 1.2.12 1.2.13 1.2.14 1.2.21 1.2.22 1.2.23 1.2.24 1.2.25 1.2.26 1.3.3 1.3.4 1.3.5 1.3.6 1.3.7 1.4.2 2.1 2.2 2.3 2.4 2.5 2.6 4.1.2 4.1.5 4.1.6 4.1.10 4.2.1 4.2.2 4.2.3 4.2.6 4.2.10 4.3.1","fail":"1.1.12 1.2.5 1.2.15 1.2.16 1.2.17 1.2.18 1.2.19 1.2.30 1.3.2 1.4.1 4.1.1 4.1.9","warn":"","manual":"1.1.9 1.1.10 1.1.20 1.1.21 1.2.1 1.2.3 1.2.9 1.2.11 1.2.20 1.2.27 1.2.28 1.2.29 1.3.1 2.7 3.1.1 3.1.2 3.1.3 3.2.1 3.2.2 4.1.3 4.1.4 4.1.7 4.1.8 4.2.4 4.2.5 4.2.7 4.2.8 4.2.9 4.2.11 4.2.12 4.2.13 4.2.14"}';

export const WORKER_CIS_1_12: string =
  '{"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12","targets":"node","pass":"4.1.2 4.1.5 4.1.6 4.1.10 4.2.1 4.2.2 4.2.3 4.2.6 4.2.10 4.3.1","fail":"4.1.1 4.1.9","warn":"","manual":"4.1.3 4.1.4 4.1.7 4.1.8 4.2.4 4.2.5 4.2.7 4.2.8 4.2.9 4.2.11 4.2.12 4.2.13 4.2.14"}';

export const WORKER_EKS_1_8_0: string =
  '{"oneuptimeNodeBenchmark":1,"benchmark":"eks-1.8.0","targets":"node","pass":"3.1.1 3.1.2 3.1.3 3.1.4 3.2.1 3.2.2 3.2.3 3.2.5 3.2.6 3.2.7 3.2.8","fail":"3.2.4 3.2.9","warn":"","manual":""}';

export const WORKER_GKE_1_9_0: string =
  '{"oneuptimeNodeBenchmark":1,"benchmark":"gke-1.9.0","targets":"node","pass":"3.1.3 3.1.4","fail":"3.1.1 3.1.2","warn":"","manual":""}';

export const WORKER_AKS_1_8: string =
  '{"oneuptimeNodeBenchmark":1,"benchmark":"aks-1.8","targets":"node","pass":"3.1.1 3.1.2 3.1.3 3.1.4 3.2.1 3.2.2 3.2.3 3.2.5 3.2.6 3.2.8","fail":"3.2.4 3.2.7 3.2.9","warn":"","manual":""}';

// A benchmark the page does not score: k3s keeps its flags in the journal.
export const WORKER_K3S_CIS_1_9: string =
  '{"oneuptimeNodeBenchmark":1,"benchmark":"k3s-cis-1.9","targets":"node","pass":"4.1.5 4.1.6 4.1.8 4.2.1 4.2.2 4.2.3 4.2.6 4.2.9 4.2.10 4.2.11 4.3.1","fail":"4.1.3 4.1.4 4.1.7 4.2.4","warn":"4.1.1 4.1.2 4.1.9 4.1.10 4.2.7","manual":"4.2.5 4.2.8 4.2.12 4.2.13"}';

/*
 * What the chart writes when kube-bench cannot finish: the end of its log,
 * without the version warning it always logs, and its exit status. Written
 * by the chart's pod on a kind node with DAC_OVERRIDE dropped too, so root
 * could not search the kubelet's drop-in directory, which kind's node image
 * ships without the search bit.
 */
export const KUBE_BENCH_COULD_NOT_FINISH: string =
  '{"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12","error":"error looking for file /etc/systemd/system/kubelet.service.d/10-kubeadm.conf: stat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf: permission denied exit status 1"}';

// The generic benchmark's automated checks kube-bench v0.16.0 scored on the two nodes.
export function getAutomatedChecks(message: string): Array<string> {
  const parsed: Record<string, string> = JSON.parse(message) as Record<
    string,
    string
  >;

  return [
    ...(parsed["pass"] || "").split(" "),
    ...(parsed["fail"] || "").split(" "),
    ...(parsed["warn"] || "").split(" "),
  ].filter((id: string): boolean => {
    return id.length > 0;
  });
}
