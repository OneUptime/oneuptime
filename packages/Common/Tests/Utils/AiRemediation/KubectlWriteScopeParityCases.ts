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
 * KubernetesPosture.build derives it, parsed the way the server parses the
 * hostInfo it stores — so the Runner path and the two server paths are
 * asked about the same Runner. A Runner that runs kubectl in-cluster is the
 * Kubernetes agent's (named kubernetes-agent/<cluster>, reporting its
 * cluster, its pod's namespace and inCluster); a Runner that runs it
 * through a credential is an ordinary Runner created in the dashboard —
 * never an agent row, which is never handed a credential — and reports
 * only what it was started with: writes, the node switch and its write
 * namespaces (runnerNameOf, hostInfoOf).
 *
 * Each case pins its expected answer per runner, in RUNNERS order: "A" the
 * write is let through, "R" it is refused. Pinning the answer (not only
 * comparing the callers) keeps three callers that drift the same way from
 * passing.
 *
 * Every case is a write the shared policy lets through: a command it
 * denies never reaches the scope in any caller, so it cannot be a row here
 * (see POLICY_DENIED_SCOPE_CASES).
 *
 * Imported by the Common parity test (the shared rule and both server
 * wrappers) and by the Runner's KubectlWriteScopeExecutorParity test (the
 * executor, end to end).
 * ---------------------------------------------------------------------------
 */

import {
  KubernetesRunnerPosture,
  getKubernetesAgentRunnerName,
  parseKubernetesRunnerPosture,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { JSONObject } from "../../../Types/JSON";

// The cluster every case targets, as the Runner and the server name it.
export const PARITY_CLUSTER_IDENTIFIER: string = "prod-us";

/*
 * The Runner a credential row describes: one created under Project
 * Settings → Runners, which the Kubernetes credential is assigned to.
 */
export const PARITY_CREDENTIAL_RUNNER_NAME: string = "platform-ops-runner";

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

// The Runner row's name: the agent's server-owned name, or a dashboard one.
export function runnerNameOf(runner: KubectlWriteScopeParityRunner): string {
  return runner.usesCredential
    ? PARITY_CREDENTIAL_RUNNER_NAME
    : getKubernetesAgentRunnerName(PARITY_CLUSTER_IDENTIFIER);
}

/*
 * The hostInfo this Runner reports on every heartbeat (and the agent on
 * registration), with the Kubernetes posture built the way
 * KubernetesPosture.build builds it: writes allowed (every case is a write
 * the Runner may run at all), node operations only when both switches
 * allow them. Only the agent's Runner names a cluster, runs in-cluster
 * and says which namespace its pod runs in; a credential Runner reports
 * { inCluster: false, allowWrites, allowNodeOperations, writeNamespaces }.
 */
export function hostInfoOf(runner: KubectlWriteScopeParityRunner): JSONObject {
  const allowWrites: boolean = true;
  const allowNodeOperations: boolean =
    allowWrites && runner.allowNodeOperations;

  if (runner.usesCredential) {
    return {
      kubernetes: {
        inCluster: false,
        allowWrites,
        allowNodeOperations,
        writeNamespaces: [...runner.writeNamespaces],
      },
    };
  }

  return {
    kubernetes: {
      clusterIdentifier: PARITY_CLUSTER_IDENTIFIER,
      inCluster: true,
      allowWrites,
      allowNodeOperations,
      writeNamespaces: [...runner.writeNamespaces],
      ...(runner.podNamespace ? { podNamespace: runner.podNamespace } : {}),
    },
  };
}

// The posture the server reads off that hostInfo — what both server paths get.
export function postureOf(
  runner: KubectlWriteScopeParityRunner,
): KubernetesRunnerPosture {
  const posture: KubernetesRunnerPosture | undefined =
    parseKubernetesRunnerPosture(hostInfoOf(runner));

  if (!posture) {
    throw new Error(`${runner.label}: its hostInfo carries no posture.`);
  }

  return posture;
}

// How the cluster's AI access reaches the cluster through this Runner.
export function accessMethodOf(
  runner: KubectlWriteScopeParityRunner,
): "in_cluster" | "credential" {
  return runner.usesCredential ? "credential" : "in_cluster";
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
  // Without --overrides (see OBJECT_REPLACING_SCOPE_CASES), a Service in -n.
  {
    label: "expose makes a Service in the namespace -n names",
    command:
      "kubectl expose deployment web -n web --port=80 --target-port=8080",
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
  /*
   * The same objects in the spellings kubectl also resolves to them: a
   * short name with a prefix of its group ("group prefixing"), a version
   * before one, no group at all, and IPAddress by its short name "ip".
   * Each used to read as a namespaced custom resource judged by -n, so a
   * listed -n let the default StorageClass be changed.
   */
  {
    label: "a StorageClass by its short name and a group prefix",
    command:
      "kubectl annotate sc.storage standard storageclass.kubernetes.io/is-default-class=true --overwrite -n web",
    expected: "ARRARRARR",
  },
  {
    label: "a StorageClass by its plural and a shorter group prefix",
    command: "kubectl annotate storageclasses.stor standard note=x -n web",
    expected: "ARRARRARR",
  },
  {
    label: "a StorageClass by its short name, a version and a group prefix",
    command: "kubectl label sc.v1.storage standard team=a -n web",
    expected: "ARRARRARR",
  },
  {
    label: "a StorageClass with an empty group (any group)",
    command: "kubectl annotate sc. standard note=x -n web",
    expected: "ARRARRARR",
  },
  {
    label: "a StorageClass by its plural, a version and an empty group",
    command: "kubectl label storageclasses.v1. standard team=a -n web",
    expected: "ARRARRARR",
  },
  {
    label: "a PriorityClass by its short name and a group prefix",
    command: `kubectl patch pc.scheduling high -p '{"value":1}' -n web`,
    expected: "ARRARRARR",
  },
  {
    label: "a CertificateSigningRequest by its short name and a group prefix",
    command: "kubectl annotate csr.cert csr-1 note=x -n web",
    expected: "ARRARRARR",
  },
  {
    label: "a VolumeAttributesClass by its short name and a group prefix",
    command: "kubectl annotate vac.storage gold note=x -n web",
    expected: "ARRARRARR",
  },
  {
    label: "an IPAddress by its short name",
    command: "kubectl delete ip 10.96.0.10 -n web",
    expected: "ARRARRARR",
  },
  {
    label: "an IPAddress by its short name and a group prefix",
    command: "kubectl delete ip.networking 10.96.0.10 -n web",
    expected: "ARRARRARR",
  },
  {
    label: "a VolumeAttachment by its plural and a group prefix",
    command: "kubectl delete volumeattachments.stor va-1 -n web",
    expected: "ARRARRARR",
  },
  /*
   * kubectl rejects a version that is not one (and so a group that is not
   * a prefix): "sc.x.storage" never names the StorageClass, so it is some
   * custom resource, judged by -n like one.
   */
  {
    label: "a short name after a word that is no API version",
    command: "kubectl annotate sc.x.storage standard note=x -n web",
    expected: "AAAAARAAR",
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
  /*
   * A word with an `=` (or a trailing `-`) is one more object to every verb
   * but label, annotate, taint, set image and set env: kubectl v1.36.4
   * PATCHed the Node in `patch pod/a=b node/n1` after the missing pod's
   * error. The scope used to stop reading objects at such a word on every
   * verb, so what followed it went unjudged.
   */
  {
    label: "a Node patched after a word kubectl reads as one more object",
    command: `kubectl patch pod/a=b node/n1 -n web -p '{"spec":{"unschedulable":true}}'`,
    expected: "AARRARRAR",
  },
  {
    label:
      "an unlisted Namespace object patched after a word kubectl reads as one more object",
    command: `kubectl patch pod/a=b namespace/staging -n web -p '{"metadata":{"annotations":{"a":"b"}}}'`,
    expected: "ARRARRARR",
  },
  {
    label: "a PriorityClass patched after a word ending in -",
    command: `kubectl patch pod/x- priorityclass/high -n web -p '{"value":1}'`,
    expected: "ARRARRARR",
  },
  // Negative control: label's KEY=VALUE words are updates, never objects.
  {
    label: "a label whose update key reads like a Node",
    command: "kubectl label pod web-1 node/n1=x -n web",
    expected: "AAAAARAAR",
  },
];

/*
 * Writes to Namespace objects the command does not name — --all, a label or
 * field selector, a bare kind. They could include kube-system's Namespace
 * object, so the shared kubectl policy denies them outright ("name each
 * Namespace object"), and every caller refuses them there, before the write
 * scope is asked: the Runner re-evaluates the argv it receives, and the
 * enqueue chokepoint and the toolkit evaluate the command first. The scope
 * keeps its own unnamed_namespace_objects refusal as defense in depth
 * (KubectlWriteScopeEntryPoint and KubectlWriteScopeClusterScoped hand it
 * such a command with an explicit tier), but no caller can reach it — so
 * these are not rows of the table above. Each caller's test holds it to
 * the policy's refusal instead.
 */
export interface KubectlWriteScopePolicyDeniedCase {
  label: string;
  command: string;
}

// What the policy's reason for each of them says to do.
export const NAME_EACH_NAMESPACE_OBJECT: string = "name each Namespace object";

export const POLICY_DENIED_SCOPE_CASES: Array<KubectlWriteScopePolicyDeniedCase> =
  [
    {
      label: "Namespace objects changed with --all",
      command: "kubectl label ns --all team=a",
    },
    {
      label: "Namespace objects changed by a label selector",
      command: "kubectl label namespaces -l env=prod team=a",
    },
    {
      label: "Namespace objects changed by a field selector",
      command:
        "kubectl annotate ns --field-selector metadata.name=kube-system note=x",
    },
    {
      label: "Namespace objects behind a -n kubectl ignores for them",
      command: "kubectl label ns --all team=a -n web",
    },
    {
      label: "a bare Namespace kind, which names no object at all",
      command: "kubectl label ns team=a",
    },
  ];

/*
 * Writes that name one object and create another: kubectl merges
 * --overrides into the object it generates (the Service `kubectl expose`
 * builds, the Pod `kubectl run` does) and creates whatever the merge
 * describes — a cluster-admin ClusterRoleBinding, a default PriorityClass,
 * a Namespace outside the list, a privileged Job — while -n names a listed
 * namespace. Real kubectl v1.36.4 against a recording API server POSTed
 * each of them (PR #3953 review, round 4). The shared policy denies the
 * flag; the scope does not rely on that: it cannot tell what such a write
 * changes, so it refuses it on every Runner in the table (each has a scope
 * or node operations off). Not rows of the table, whose rows the policy
 * lets through: each caller's test holds every path to "refused before
 * kubectl runs", and the scope — handed each one as a RiskyWrite — to its
 * own refusal.
 */
export interface KubectlWriteScopeObjectReplacingCase {
  label: string;
  command: string;
  // The flag as written, which the refusal names.
  flag: string;
}

export const OBJECT_REPLACING_SCOPE_CASES: Array<KubectlWriteScopeObjectReplacingCase> =
  [
    {
      label: "expose that creates a cluster-admin ClusterRoleBinding",
      command: `kubectl expose deployment web -n web --port=80 --overrides='{"apiVersion":"rbac.authorization.k8s.io/v1","kind":"ClusterRoleBinding","metadata":{"name":"ai-escape","namespace":null,"labels":null},"spec":null,"roleRef":{"apiGroup":"rbac.authorization.k8s.io","kind":"ClusterRole","name":"cluster-admin"},"subjects":[{"kind":"ServiceAccount","name":"default","namespace":"web"}]}'`,
      flag: "--overrides",
    },
    {
      label: "expose that creates the cluster's default PriorityClass",
      command: `kubectl expose deployment web -n web --port=80 --overrides='{"apiVersion":"scheduling.k8s.io/v1","kind":"PriorityClass","metadata":{"name":"ai-default","namespace":null},"spec":null,"value":1000000,"globalDefault":true}'`,
      flag: "--overrides",
    },
    {
      label: "expose that creates a Namespace",
      command: `kubectl expose deployment web -n web --port=80 --overrides='{"apiVersion":"v1","kind":"Namespace","metadata":{"name":"ai-made","namespace":null},"spec":null}'`,
      flag: "--overrides",
    },
    {
      label: "expose that creates a privileged Job on the host",
      command: `kubectl expose deployment web -n web --port=80 --overrides='{"apiVersion":"batch/v1","kind":"Job","spec":{"template":{"spec":{"hostPID":true,"restartPolicy":"Never","containers":[{"name":"x","image":"attacker/image","securityContext":{"privileged":true},"volumeMounts":[{"name":"root","mountPath":"/host"}]}],"volumes":[{"name":"root","hostPath":{"path":"/"}}]}}}}'`,
      flag: "--overrides",
    },
    {
      label: "--overrides with its value as the next word",
      command: `kubectl expose deployment web -n web --port=80 --overrides '{"apiVersion":"v1","kind":"Namespace","metadata":{"name":"ai-made"}}'`,
      flag: "--overrides",
    },
    {
      label: "a JSON patch that replaces the kind",
      command: `kubectl expose deployment web -n web --port=80 --override-type=json --overrides='[{"op":"replace","path":"/kind","value":"Job"}]'`,
      flag: "--override-type",
    },
    {
      label: "--override_type, which kubectl reads as --override-type",
      command:
        "kubectl expose deployment web -n web --port=80 --override_type=merge",
      flag: "--override_type",
    },
    {
      label: "an override that looks harmless: still not readable",
      command: `kubectl expose deployment web -n web --port=80 --overrides='{"apiVersion":"v1","kind":"Service"}'`,
      flag: "--overrides",
    },
    {
      label: "--overrides on another verb (run)",
      command: `kubectl run debug --image=busybox -n web --overrides='{"apiVersion":"v1","kind":"Pod","spec":{"hostPID":true}}'`,
      flag: "--overrides",
    },
  ];
