/*
 * ---------------------------------------------------------------------------
 * The cross-caller parity table for the kubectl write scope.
 *
 * "Would the bound Runner refuse this write?" is asked in three places: the
 * Runner itself before it spawns kubectl (KubectlExecutor), the server's
 * enqueue chokepoint (RunnerJobService.getRunnerWriteScopeRefusal) and the
 * remediation toolkit at propose/approve time
 * (RemediationCommandToolkit.getRunnerScopeRefusal). They used to be three
 * implementations with three answers: the server copies judged a Namespace
 * object or a PersistentVolume by -n, let a write with no -n through when
 * the Runner reported no pod namespace, and read node objects with their own
 * flag table. This table is what all three must answer the same way.
 *
 * Each runner below is a Runner configuration (what the Runner is started
 * with) and, through postureOf, the posture it reports — exactly the way
 * KubernetesPosture.build derives it — so the Runner path and the two
 * server paths are asked about the same Runner.
 *
 * Each case pins its expected answer per runner, in RUNNERS order: "A" the
 * write is let through, "R" it is refused. Pinning the answer (not only
 * comparing the callers) keeps three callers that drift the same way from
 * passing.
 *
 * Imported by the Common parity test (the shared rule and both server
 * wrappers) and by the Runner's KubectlWriteScopeExecutorParity test (the
 * executor, end to end).
 * ---------------------------------------------------------------------------
 */

import { KubernetesRunnerPosture } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";

// The cluster every case targets, as the Runner and the server name it.
export const PARITY_CLUSTER_IDENTIFIER: string = "prod-us";

export interface KubectlWriteScopeParityRunner {
  label: string;
  // What the Runner was started with (ONEUPTIME_KUBECTL_WRITE_NAMESPACES).
  writeNamespaces: Array<string>;
  // ONEUPTIME_RUNNER_POD_NAMESPACE, or null when it was not set.
  podNamespace: string | null;
  // The node switch, as the Runner resolved it.
  allowNodeOperations: boolean;
  /*
   * Whether kubectl runs through a Kubernetes credential's kubeconfig
   * rather than the in-cluster Runner's own ServiceAccount.
   */
  usesCredential: boolean;
}

export const PARITY_RUNNERS: Array<KubectlWriteScopeParityRunner> = [
  {
    label: "in-cluster, the default install (cluster-wide, nodes on)",
    writeNamespaces: [],
    podNamespace: "oneuptime-agent",
    allowNodeOperations: true,
    usesCredential: false,
  },
  {
    label: "in-cluster, scoped to web and api, nodes on",
    writeNamespaces: ["web", "api"],
    podNamespace: "oneuptime-agent",
    allowNodeOperations: true,
    usesCredential: false,
  },
  {
    label: "in-cluster, scoped to web and api, nodes off",
    writeNamespaces: ["web", "api"],
    podNamespace: "oneuptime-agent",
    allowNodeOperations: false,
    usesCredential: false,
  },
  {
    label: "in-cluster, cluster-wide, nodes off",
    writeNamespaces: [],
    podNamespace: "oneuptime-agent",
    allowNodeOperations: false,
    usesCredential: false,
  },
  {
    label: "in-cluster, scoped to web, its own namespace unknown",
    writeNamespaces: ["web"],
    podNamespace: null,
    allowNodeOperations: true,
    usesCredential: false,
  },
  {
    label: "through a credential, scoped to prod",
    writeNamespaces: ["prod"],
    podNamespace: null,
    allowNodeOperations: true,
    usesCredential: true,
  },
  {
    label: "through a credential, no scope, nodes off",
    writeNamespaces: [],
    podNamespace: null,
    allowNodeOperations: false,
    usesCredential: true,
  },
  {
    label: "in-cluster, scoped, configured in mixed case with spaces",
    writeNamespaces: ["Web", " API "],
    podNamespace: " OneUptime-Agent ",
    allowNodeOperations: true,
    usesCredential: false,
  },
  /*
   * Where a missing -n lands decides the answer here: "default" through a
   * credential (listed, so let through), where an in-cluster Runner with no
   * known namespace of its own could not tell.
   */
  {
    label: "through a credential, scoped to default and prod",
    writeNamespaces: ["default", "prod"],
    podNamespace: null,
    allowNodeOperations: true,
    usesCredential: true,
  },
];

/*
 * The posture this Runner reports on registration and every heartbeat,
 * built the way KubernetesPosture.build builds it: writes allowed (every
 * case is a write the Runner may run at all), node operations only when
 * both switches allow them.
 */
export function postureOf(
  runner: KubectlWriteScopeParityRunner,
): KubernetesRunnerPosture {
  const allowWrites: boolean = true;

  return {
    clusterIdentifier: PARITY_CLUSTER_IDENTIFIER,
    inCluster: !runner.usesCredential,
    allowWrites,
    writeNamespaces: [...runner.writeNamespaces],
    podNamespace: runner.podNamespace || undefined,
    allowNodeOperations: allowWrites && runner.allowNodeOperations,
  };
}

export interface KubectlWriteScopeParityCase {
  // Why this command is in the table.
  label: string;
  command: string;
  // The expected answer per runner, in PARITY_RUNNERS order ("A" / "R").
  expected: string;
}

export const PARITY_CASES: Array<KubectlWriteScopeParityCase> = [
  // Namespaced writes, judged by -n or the default namespace.
  {
    label: "a write in web",
    command: "kubectl rollout restart deployment/web -n web",
    expected: "AAAAARAAR",
  },
  {
    label: "the namespace first",
    command: "kubectl -n api rollout restart deployment/api",
    expected: "AAAARRAAR",
  },
  {
    label: "a write outside every scope",
    command: "kubectl rollout restart deployment/pay -n payments",
    expected: "ARRARRARR",
  },
  {
    label: "--namespace= outside the scope",
    command: "kubectl annotate pod web-1 note=x --namespace=payments",
    expected: "ARRARRARR",
  },
  {
    label: "a namespace written in upper case",
    command: "kubectl label deployment web x=y -n WEB",
    expected: "AAAAARAAR",
  },
  {
    label: "a RiskyWrite in prod",
    command: "kubectl set image deployment/web web=img:2 -n prod",
    expected: "ARRARAARA",
  },
  {
    label: "create job is namespaced",
    command: "kubectl create job migrate-now --from=cronjob/migrate -n web",
    expected: "AAAAARAAR",
  },
  {
    label:
      "no -n: the pod's own namespace in-cluster, unknown without one, default through a credential",
    command: "kubectl rollout restart deployment/web",
    expected: "RRRRRRARA",
  },
  {
    label: "no -n on a delete",
    command: "kubectl delete pod web-1",
    expected: "RRRRRRARA",
  },
  {
    label: "the Runner's own namespace, named",
    command: "kubectl rollout restart deployment/agent -n oneuptime-agent",
    expected: "RRRRRRARR",
  },
  // Node operations: the node switch, never the namespace scope.
  { label: "cordon", command: "kubectl cordon n1", expected: "AARRAARAA" },
  {
    label: "drain",
    command: "kubectl drain n1 --ignore-daemonsets",
    expected: "AARRAARAA",
  },
  {
    label: "taint",
    command: "kubectl taint nodes n1 dedicated=ai:NoSchedule",
    expected: "AARRAARAA",
  },
  {
    label: "a Node label",
    command: "kubectl label node n1 team=a",
    expected: "AARRAARAA",
  },
  {
    label: "a Node label with a -n kubectl ignores",
    command: "kubectl label node n1 team=a -n kube-system",
    expected: "AARRAARAA",
  },
  {
    label: "a Node annotation by its short name",
    command: "kubectl annotate no n1 note=x",
    expected: "AARRAARAA",
  },
  {
    label: "a group-qualified Node patch",
    command: `kubectl patch nodes.v1. n1 -p '{"spec":{"unschedulable":true}}'`,
    expected: "AARRAARAA",
  },
  {
    label: "a boolean flag before the Node kind",
    command: "kubectl label --save-config node n1 team=a",
    expected: "AARRAARAA",
  },
  {
    label: "a Node and a pod: the switch AND the pod's namespace",
    command: "kubectl label node/n1 pod/web-1 x=y -n web",
    expected: "AARRARRAR",
  },
  // What cannot be read for certain.
  {
    label: "a separate name after TYPE/NAME (objects uncertain)",
    command: "kubectl label node/n1 pod-1 x=y -n web",
    expected: "RRRRRRRRR",
  },
  {
    label: "a namespace flag a value flag may swallow",
    command: "kubectl rollout restart deployment/web --selector -n web",
    expected: "RRRRRRRRR",
  },
  // Namespace objects, judged by their name.
  {
    label: "a listed Namespace object with no -n",
    command: "kubectl label namespace web team=a",
    expected: "AAAAARAAR",
  },
  {
    label: "an unlisted Namespace object behind a listed -n",
    command: "kubectl label namespace staging team=a -n web",
    expected: "ARRARRARR",
  },
  {
    label: "the Runner's own Namespace object behind a listed -n",
    command: "kubectl label ns oneuptime-agent team=a -n web",
    expected: "RRRRRRARR",
  },
  {
    label: "Namespace objects it does not name",
    command: "kubectl label ns --all team=a",
    expected: "RRRRRRARR",
  },
  {
    label: "create namespace",
    command: "kubectl create namespace staging",
    expected: "ARRARRARR",
  },
  // Other cluster-scoped objects: outside every listed namespace.
  {
    label: "a PersistentVolume behind a listed -n",
    command: `kubectl patch pv pv-1 -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' -n web`,
    expected: "ARRARRARR",
  },
  {
    label: "an IngressClass behind a listed -n",
    command: "kubectl annotate ingressclass nginx note=x -n web",
    expected: "ARRARRARR",
  },
  {
    label: "create priorityclass",
    command: "kubectl create priorityclass high --value=1000",
    expected: "ARRARRARR",
  },
  // A custom resource called "nodes" is namespaced, not a Node.
  {
    label: "a custom resource named like nodes, in web",
    command: "kubectl annotate nodes.example.com n1 x=y -n web",
    expected: "AAAAARAAR",
  },
  {
    label: "a custom resource named like nodes, with no -n",
    command: "kubectl annotate nodes.example.com n1 x=y",
    expected: "RRRRRRARA",
  },
];
