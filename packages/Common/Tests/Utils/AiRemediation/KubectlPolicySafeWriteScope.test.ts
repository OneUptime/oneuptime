import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import {
  KubectlCommandTier,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — what SafeWrite (the tier Automatic mode runs with
 * nobody asked) may reach:
 *  1. Exactly ONE named object of one built-in kind, with no selector (-l,
 *     --selector, --field-selector) and no --all. A bare kind is every
 *     object of that kind to kubectl's rollout verbs ("Restart all
 *     deployments in the namespace" is kubectl's own example for
 *     `rollout restart deployment -n NS`), a comma list of kinds or several
 *     names is several objects, and a field selector selects like -l.
 *  2. Per verb: rollout restart/undo/pause/resume of a Deployment,
 *     StatefulSet or DaemonSet; scale of a Deployment, StatefulSet or
 *     ReplicaSet to a count above zero; delete of a pod (never a Job, which
 *     nothing recreates); cordon/uncordon of a node; label/annotate of a pod
 *     or workload with keys outside kubernetes.io / k8s.io (and a few
 *     identity, admission and GitOps controller prefixes).
 *  3. Group-qualified spellings count only in the kind's own API group:
 *     `deployments.apps/web` is a Deployment, `pods.example.com` is not a pod.
 *  4. A write in kube-system, kube-public or kube-node-lease (or on one of
 *     those Namespace objects) is at least RiskyWrite, carries
 *     protectedNamespace, and evaluateForAutoExecution never auto-approves
 *     it — not with bypassApproval, not with an allowlist of "*". Reads
 *     there stay Read.
 *  5. The every-mode protections hold for node-wide evictions too: `kubectl
 *     drain` and `kubectl taint` (any effect, NoExecute included) move pods
 *     in every namespace — kube-system and the agent's own — without naming
 *     one, so they are RiskyWrite with requiresHuman, and
 *     evaluateForAutoExecution never auto-approves them: not in Bypass
 *     approval, not through any allowlist entry. cordon/uncordon only stop
 *     scheduling and stay SafeWrite.
 * Everything outside the SafeWrite shape is RiskyWrite (a human approves,
 * or the operator allowlists or bypasses), never silently Denied — the
 * negative controls pin that nothing a documented fix needs was lost.
 */

function tier(command: string): KubectlCommandTier {
  return KubectlPolicy.evaluateCommand(command).tier;
}

function autoVerdict(
  command: string,
  options: { allowlistPatterns?: Array<string>; bypassApproval?: boolean } = {},
): KubectlAutoExecutionVerdict {
  return KubectlPolicy.evaluateForAutoExecution({
    command,
    allowlistPatterns: options.allowlistPatterns || [],
    bypassApproval: options.bypassApproval,
  });
}

/*
 * ---- Negative controls: every documented single-object SafeWrite ----------
 *
 * The docs, the AI page and the model's own prompt all name these shapes as
 * what Automatic mode runs. None of the tightening below may touch them.
 */
const SINGLE_OBJECT_SAFE_WRITES: Array<string> = [
  // rollout, TYPE/NAME and TYPE NAME, every workload kind and alias.
  "kubectl rollout restart deployment/web -n web",
  "kubectl rollout restart deployment web -n web",
  "kubectl rollout restart deploy/web -n web",
  "kubectl rollout restart deployments/web -n web",
  "kubectl rollout restart deployments.apps/web -n web",
  "kubectl rollout restart deployments.v1.apps/web -n web",
  "kubectl rollout restart Deployment/web -n web",
  "kubectl rollout restart statefulset/db -n data",
  "kubectl rollout restart sts db -n data",
  "kubectl rollout restart daemonset/agent -n monitoring",
  "kubectl rollout restart ds agent -n monitoring",
  "kubectl rollout undo deployment/web -n web",
  "kubectl rollout undo deployment web -n web --to-revision=3",
  "kubectl rollout undo statefulset/db -n data",
  "kubectl rollout pause deployment web -n web",
  "kubectl rollout resume deployment/web -n web",
  "kubectl rollout restart -n web deployment/web",
  "kubectl -n web rollout restart deployment/web",
  "kubectl rollout restart deployment -n web -- web",
  "kubectl rollout restart deployment/web",
  // scale to a positive count.
  "kubectl scale deployment web --replicas=3 -n web",
  "kubectl scale deployment/web --replicas=3 -n web",
  "kubectl scale deploy/web --replicas 2 -n web",
  "kubectl scale deployments.apps web -n web --replicas=2",
  "kubectl scale statefulset db --replicas 2 -n data",
  "kubectl scale sts/db --replicas=1 -n data",
  "kubectl scale replicaset web-7d9f --replicas=2 -n web",
  "kubectl scale --replicas=3 deployment/web -n web",
  "kubectl scale deployment web --replicas=3 --current-replicas=2 -n web",
  // delete one named pod.
  "kubectl delete pod web-abc -n web",
  "kubectl delete pod/web-abc -n web",
  "kubectl delete pods web-abc -n web",
  "kubectl delete po web-abc -n web",
  "kubectl delete pods.v1. web-abc -n web",
  "kubectl delete Pod web-abc -n web",
  "kubectl delete pod web-abc -n web --grace-period=30",
  "kubectl delete pod web-abc -n web --now",
  "kubectl delete pod -n web -- web-abc",
  // cordon / uncordon one node.
  "kubectl cordon node-1",
  "kubectl uncordon node-1",
  "kubectl cordon node/node-1",
  "kubectl cordon nodes/node-1",
  "kubectl cordon node-1 --dry-run=client",
  // label / annotate one pod or workload, plain keys.
  "kubectl label pod web-abc team=a -n web",
  "kubectl label pod web-abc -n web app-",
  "kubectl label pods/web-abc -n web quarantine=true --overwrite",
  "kubectl label po web-abc -n web a=b",
  "kubectl label deploy/web -n web team=a",
  "kubectl label deployment web -n web tier=frontend",
  "kubectl label statefulset db -n data backup=nightly",
  "kubectl label daemonset/agent -n monitoring owner=sre",
  "kubectl label replicaset web-7d9f -n web a=b",
  "kubectl label job migrate-42 -n web reviewed=true",
  "kubectl label cronjob nightly -n web paused-by=oneuptime",
  "kubectl label cj/nightly -n web a=b",
  "kubectl annotate deployment web -n web oneuptime.com/note=restarted",
  "kubectl annotate pod web-abc -n web example.com/incident=INC-42",
  // A reserved string in a VALUE is just text: only keys are checked.
  "kubectl annotate deployment web -n web oneuptime.com/note=kubernetes.io/x",
  "kubectl label pod web-abc -n web note=k8s.io",
];

/*
 * ---- Several objects, a bare kind, or a selector: RiskyWrite ---------------
 */
const NOT_ONE_NAMED_OBJECT: Array<string> = [
  /*
   * rollout with a bare kind is every object of that kind (kubectl's builder
   * selects labels.Everything() for rollout's allowEmptySelector).
   */
  "kubectl rollout restart deployment -n web",
  "kubectl rollout undo deployment -n web",
  "kubectl rollout pause deployment -n web",
  "kubectl rollout resume deployment -n web",
  "kubectl rollout pause deployments -n web",
  "kubectl rollout resume deploy -n web",
  "kubectl rollout restart statefulset -n data",
  "kubectl rollout restart daemonset -n monitoring",
  "kubectl rollout restart deployment",
  "kubectl rollout restart deployment.apps -n web",
  "kubectl rollout restart -n web -- deployment",
  "kubectl rollout undo deployment -n web --to-revision=3",
  "kubectl rollout restart -n web",
  // A comma list of kinds.
  "kubectl rollout restart deployment,statefulset,daemonset -n web",
  "kubectl rollout restart deployments,daemonsets -n web",
  "kubectl rollout restart deployment,statefulset web -n web",
  // Several names.
  "kubectl rollout restart deployment web api -n web",
  "kubectl rollout restart deployment/web deployment/api -n web",
  "kubectl rollout restart deployment/web statefulset/db -n web",
  "kubectl rollout undo deployment a b c -n web",
  "kubectl scale deployment web api --replicas=1 -n web",
  "kubectl scale deployment/web deployment/api --replicas=2 -n web",
  "kubectl scale deployment --replicas=2 -n web",
  "kubectl scale deployment,statefulset web --replicas=2 -n web",
  "kubectl delete pod a b -n web",
  "kubectl delete pods web-7d9f-abc web-7d9f-def -n web",
  "kubectl delete pod/a pod/b -n web",
  "kubectl delete pod,job web-1 -n web",
  "kubectl cordon n1 n2",
  "kubectl cordon n1 n2 n3 n4 n5",
  "kubectl uncordon n1 n2",
  "kubectl cordon",
  "kubectl label pods web-1 web-2 -n web a=b",
  "kubectl label pod,deployment web -n web a=b",
  "kubectl annotate pod/a pod/b -n web a=b",
  // Selectors, --field-selector included, and --all.
  "kubectl rollout restart deployment -n web -l tier=frontend",
  "kubectl rollout restart deployment -n web --selector=tier=frontend",
  "kubectl rollout restart deployment -n web --all",
  "kubectl label pods --field-selector=status.phase=Running app- -n web",
  "kubectl label pods -n web --field-selector status.phase=Running a=b",
  "kubectl annotate pods --field-selector=status.phase=Running a=b -n web",
  "kubectl label pods -n web -l app=web canary=true",
  "kubectl label pods -n web --all canary=true",
  "kubectl annotate deployments -n web --all a=b",
  "kubectl scale deployment --all --replicas=2 -n web",
  "kubectl scale deployment -l app=web --replicas=2 -n web",
  "kubectl cordon -l pool=spare",
  "kubectl cordon --selector=pool=spare",
  "kubectl delete pods -n web -l app=web",
  "kubectl delete pods --field-selector=status.phase=Failed -n web",
  "kubectl delete pods -n web --field-selector status.phase=Failed",
];

/*
 * ---- The same rule, verb by verb ------------------------------------------
 *
 * For every verb that can be SafeWrite: its one-named-object form is
 * SafeWrite, and the same command with a bare kind, two names, or a
 * --field-selector is RiskyWrite. (kubectl itself rejects some of the wider
 * forms — a bare kind on scale/label, --field-selector on cordon — which
 * only makes RiskyWrite the honest tier for them.)
 */
const ONE_OBJECT_MATRIX: Array<{
  verb: string;
  one: string;
  bareKind: string;
  twoNames: string;
  fieldSelector: string;
}> = [
  {
    verb: "rollout restart",
    one: "kubectl rollout restart deployment/web -n web",
    bareKind: "kubectl rollout restart deployment -n web",
    twoNames: "kubectl rollout restart deployment web api -n web",
    fieldSelector:
      "kubectl rollout restart deployment/web -n web --field-selector=metadata.name=web",
  },
  {
    verb: "rollout undo",
    one: "kubectl rollout undo deployment web -n web",
    bareKind: "kubectl rollout undo deployment -n web",
    twoNames: "kubectl rollout undo deployment/web deployment/api -n web",
    fieldSelector:
      "kubectl rollout undo deployment -n web --field-selector=metadata.name=web",
  },
  {
    verb: "rollout pause",
    one: "kubectl rollout pause deployment/web -n web",
    bareKind: "kubectl rollout pause deployment -n web",
    twoNames: "kubectl rollout pause deployment web api -n web",
    fieldSelector:
      "kubectl rollout pause deployment -n web --field-selector=metadata.name=web",
  },
  {
    verb: "rollout resume",
    one: "kubectl rollout resume deployment/web -n web",
    bareKind: "kubectl rollout resume deployment -n web",
    twoNames: "kubectl rollout resume deployment web api -n web",
    fieldSelector:
      "kubectl rollout resume deployment -n web --field-selector=metadata.name=web",
  },
  {
    verb: "scale",
    one: "kubectl scale deployment web --replicas=2 -n web",
    bareKind: "kubectl scale deployment --replicas=2 -n web",
    twoNames: "kubectl scale deployment web api --replicas=2 -n web",
    fieldSelector:
      "kubectl scale deployment --field-selector=metadata.name=web --replicas=2 -n web",
  },
  {
    verb: "cordon",
    one: "kubectl cordon node-1",
    bareKind: "kubectl cordon",
    twoNames: "kubectl cordon node-1 node-2",
    fieldSelector: "kubectl cordon --field-selector=metadata.name=node-1",
  },
  {
    verb: "uncordon",
    one: "kubectl uncordon node-1",
    bareKind: "kubectl uncordon",
    twoNames: "kubectl uncordon node-1 node-2",
    fieldSelector: "kubectl uncordon --field-selector=metadata.name=node-1",
  },
  {
    verb: "delete pod",
    one: "kubectl delete pod web-1 -n web",
    // A bare kind with no selector is refused outright (see below).
    bareKind: "kubectl delete pod -n web -l app=web",
    twoNames: "kubectl delete pod web-1 web-2 -n web",
    fieldSelector:
      "kubectl delete pod -n web --field-selector=status.phase=Failed",
  },
  {
    verb: "label",
    one: "kubectl label pod web-1 -n web a=b",
    bareKind: "kubectl label pod -n web a=b",
    twoNames: "kubectl label pod web-1 web-2 -n web a=b",
    fieldSelector:
      "kubectl label pod -n web --field-selector=status.phase=Running a=b",
  },
  {
    verb: "annotate",
    one: "kubectl annotate deployment web -n web example.com/a=b",
    bareKind: "kubectl annotate deployment -n web example.com/a=b",
    twoNames: "kubectl annotate deployment web api -n web example.com/a=b",
    fieldSelector:
      "kubectl annotate deployment -n web --field-selector=metadata.name=web example.com/a=b",
  },
];

/*
 * ---- The right shape on the wrong kind: RiskyWrite ------------------------
 */
const WRONG_KIND_FOR_SAFE_WRITE: Array<string> = [
  // Only Deployments, StatefulSets and DaemonSets roll out.
  "kubectl rollout restart deployments.example.com/web -n web",
  "kubectl rollout restart rollouts.argoproj.io/web -n web",
  "kubectl rollout undo replicaset/web-7d9f -n web",
  // Only Deployments, StatefulSets and ReplicaSets scale safely.
  "kubectl scale rc legacy --replicas=2 -n web",
  "kubectl scale replicationcontroller/legacy --replicas=2 -n web",
  "kubectl scale deployments.example.com/web --replicas=2 -n web",
  "kubectl scale widgets.example.com/w1 --replicas=2 -n web",
  // Deleting a Job: no controller recreates it.
  "kubectl delete job migrate-42 -n web",
  "kubectl delete job/migrate-42 -n web",
  "kubectl delete jobs migrate-42 -n web",
  "kubectl delete jobs.batch migrate-42 -n web",
  // Custom resources whose plural is "pods" or "jobs" are not pods or Jobs.
  "kubectl delete pods.example.com foo -n web",
  "kubectl delete pods.metrics.k8s.io foo -n web",
  "kubectl delete jobs.batch.volcano.sh train -n ml",
  "kubectl delete job.batch.volcano.sh/train -n ml",
  "kubectl delete deployment web -n web",
  "kubectl delete somecustomkind foo -n web",
  // cordon names nodes, nothing else.
  "kubectl cordon pod/web-1",
  // Labels and annotations on anything but a pod or workload are controls.
  "kubectl label node worker-1 pool=spare --overwrite",
  "kubectl label nodes worker-1 pool-",
  "kubectl label no/worker-1 a=b",
  "kubectl label ns web team=a",
  "kubectl label namespace web istio-injection=enabled --overwrite",
  "kubectl label service web -n web a=b",
  "kubectl annotate svc web -n web service.beta.kubernetes.io/aws-load-balancer-internal=true",
  "kubectl annotate svc web -n web example.com/owner=sre",
  "kubectl annotate ingress web -n web nginx.ingress.kubernetes.io/configuration-snippet=x",
  "kubectl annotate ingress web -n web example.com/owner=sre",
  "kubectl annotate sa default -n web eks.amazonaws.com/role-arn=arn:aws:iam::1:role/x",
  "kubectl annotate serviceaccount default -n web example.com/owner=sre",
  /*
   * Labels on roles, bindings and webhook configurations used to be listed
   * here as RiskyWrite. Every write to an RBAC, admission or API-extension
   * kind is Denied now (KubectlPolicyDenials.test.ts pins them).
   */
  "kubectl label networkpolicy np -n web a=b",
  "kubectl label configmap app-config -n web reloaded=1",
  "kubectl label pvc data -n web a=b",
  "kubectl label hpa web -n web a=b",
  "kubectl label pdb web -n web a=b",
  "kubectl label widgets.example.com w1 -n web a=b",
  "kubectl label pods.example.com p1 -n web a=b",
  "kubectl label deployments.example.com/web -n web a=b",
];

/*
 * ---- Keys Kubernetes or a controller acts on: RiskyWrite ------------------
 */
const RESERVED_KEY_WRITES: Array<string> = [
  "kubectl label pod web-1 -n web app.kubernetes.io/name=x",
  "kubectl label pod web-1 -n web kubernetes.io/os-",
  "kubectl label pod web-1 -n web k8s.io/x=y",
  "kubectl label deploy/web -n web kubernetes.io/x=y",
  "kubectl label deployment web -n web node-role.kubernetes.io/worker=true",
  "kubectl label pod web-1 -n web topology.kubernetes.io/zone=a",
  "kubectl annotate deployment web -n web kubectl.kubernetes.io/restartedAt=now",
  "kubectl annotate deployment web -n web deployment.kubernetes.io/revision=1",
  "kubectl annotate pod web-1 -n web cluster-autoscaler.kubernetes.io/safe-to-evict=false",
  "kubectl label pod web-1 -n web x.k8s.io/y=z",
  "kubectl label pod web-1 -n web App.Kubernetes.IO/name=x",
  "kubectl label pod web-1 -n web admission.gatekeeper.sh/ignore=true",
  "kubectl label deployment web -n web policies.kyverno.io/skip=true",
  "kubectl label deployment web -n web argocd.argoproj.io/instance=other",
  "kubectl label pod web-1 -n web azure.workload.identity/use=true",
  "kubectl annotate deployment web -n web iam.gke.io/gcp-service-account=x",
  "kubectl annotate deployment web -n web eks.amazonaws.com/role-arn=x",
  // One reserved key among plain ones is enough.
  "kubectl label pod web-1 -n web team=a app.kubernetes.io/part-of=x",
];

/*
 * Keys that merely LOOK reserved stay plain (the domain must BE kubernetes.io
 * / k8s.io or a subdomain of it).
 */
const LOOKALIKE_KEYS_STAY_SAFE: Array<string> = [
  "kubectl label pod web-1 -n web notkubernetes.io/x=y",
  "kubectl label pod web-1 -n web kubernetes.io.example.com/x=y",
  "kubectl label pod web-1 -n web mykubernetes.io/x=y",
  "kubectl label pod web-1 -n web k8s-io/x=y",
  "kubectl label pod web-1 -n web kubernetes=io",
];

/*
 * ---- Scaling to zero is an outage, not a nudge ----------------------------
 */
const SCALE_TO_ZERO: Array<string> = [
  "kubectl scale deployment web --replicas=0 -n web",
  "kubectl scale deployment web --replicas 0 -n web",
  "kubectl scale deployment/web --replicas=00 -n web",
  "kubectl scale statefulset db --replicas=0 -n data",
  "kubectl scale --replicas=0 deployment/web -n web",
  "kubectl scale deployment web --replicas=3 --replicas=0 -n web",
  // Not a count kubectl scale applies safely.
  "kubectl scale deployment web --replicas=-1 -n web",
  "kubectl scale deployment web --replicas=abc -n web",
  "kubectl scale deployment web '--replicas=' -n web",
];

/*
 * ---- Protected namespaces ------------------------------------------------
 *
 * Writes that would otherwise be SafeWrite (so Automatic mode ran them) and
 * RiskyWrites (so bypass or the allowlist ran them) in kube-system /
 * kube-public / kube-node-lease, in every -n spelling the parser accepts.
 */
const PROTECTED_NAMESPACE_WRITES: Array<[string, string]> = [
  [
    "kubectl scale deployment coredns -n kube-system --replicas=2",
    "kube-system",
  ],
  [
    "kubectl scale deployment coredns -n kube-system --replicas=0",
    "kube-system",
  ],
  ["kubectl rollout restart deployment/coredns -n kube-system", "kube-system"],
  ["kubectl rollout restart daemonset/kube-proxy -nkube-system", "kube-system"],
  ["kubectl rollout undo deployment/coredns -n=kube-system", "kube-system"],
  ["kubectl -n kube-system rollout restart daemonset", "kube-system"],
  ["kubectl --namespace=kube-system rollout restart ds/cilium", "kube-system"],
  ["kubectl --namespace kube-system delete pod coredns-abc", "kube-system"],
  ["kubectl delete pod coredns-abc --namespace=kube-system", "kube-system"],
  ["kubectl label pod coredns-abc -n kube-system a=b", "kube-system"],
  ["kubectl annotate deployment coredns -n kube-system a=b", "kube-system"],
  [
    "kubectl set image deployment/coredns -n kube-system coredns=evil:1",
    "kube-system",
  ],
  [
    'kubectl patch deployment coredns -n kube-system -p \'{"spec":{"replicas":1}}\'',
    "kube-system",
  ],
  ["kubectl create job x --from=cronjob/y -n kube-system", "kube-system"],
  ["kubectl delete deployment coredns -n kube-system", "kube-system"],
  ["kubectl scale deployment x -n kube-public --replicas=2", "kube-public"],
  ["kubectl delete pod x -n kube-public", "kube-public"],
  ["kubectl label pod x -n kube-node-lease a=b", "kube-node-lease"],
  [
    "kubectl rollout restart deployment/x -n kube-node-lease",
    "kube-node-lease",
  ],
  // The Namespace objects themselves, whatever -n says.
  ["kubectl label ns kube-system team=platform", "kube-system"],
  ["kubectl annotate namespace/kube-public a=b", "kube-public"],
  ["kubectl label namespaces kube-node-lease a=b -n web", "kube-node-lease"],
];

// Reads there stay Read: an investigation needs to look at kube-system.
const PROTECTED_NAMESPACE_READS: Array<string> = [
  "kubectl get pods -n kube-system",
  "kubectl describe pod coredns-abc -n kube-system",
  "kubectl logs coredns-abc -n kube-system --tail=100",
  "kubectl rollout status deployment/coredns -n kube-system --watch=false",
  "kubectl rollout history daemonset/kube-proxy -n kube-system",
  "kubectl get events -n kube-public",
  "kubectl top pods -n kube-system",
  "kubectl get namespace kube-system -o yaml",
];

/*
 * Names that only resemble a protected namespace, and cluster-scoped writes
 * whose -n kubectl ignores: none of these is protected.
 */
const NOT_PROTECTED: Array<[string, KubectlCommandTier]> = [
  [
    "kubectl scale deployment web -n kube-systemx --replicas=2",
    KubectlCommandTier.SafeWrite,
  ],
  [
    "kubectl scale deployment web -n my-kube-system --replicas=2",
    KubectlCommandTier.SafeWrite,
  ],
  ["kubectl delete pod web-1 -n kube", KubectlCommandTier.SafeWrite],
  [
    "kubectl rollout restart deployment/web -n web",
    KubectlCommandTier.SafeWrite,
  ],
  ["kubectl cordon node-1 -n kube-system", KubectlCommandTier.SafeWrite],
  [
    "kubectl uncordon node-1 --namespace=kube-system",
    KubectlCommandTier.SafeWrite,
  ],
  [
    "kubectl drain node-1 --ignore-daemonsets -n kube-system",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl taint nodes node-1 a=b:NoSchedule -n kube-system",
    KubectlCommandTier.RiskyWrite,
  ],
  [
    "kubectl label node node-1 pool=spare -n kube-system",
    KubectlCommandTier.RiskyWrite,
  ],
  ["kubectl label ns web team=a -n kube-system", KubectlCommandTier.RiskyWrite],
  // A pod NAMED like a protected namespace is just a pod.
  ["kubectl delete pod kube-system -n web", KubectlCommandTier.SafeWrite],
];

/*
 * ---- Node-wide evictions: always a human -----------------------------------
 *
 * With each, the allowlist entries an operator could write for it — the
 * command itself and the wildcard shapes — none of which may promote it.
 */
const NODE_WIDE_EVICTIONS: Array<[string, Array<string>]> = [
  [
    "kubectl drain node-1 --ignore-daemonsets",
    [
      "kubectl drain * --ignore-daemonsets",
      "kubectl drain node-* --ignore-daemonsets",
    ],
  ],
  [
    "kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data --force",
    ["kubectl drain * --ignore-daemonsets --delete-emptydir-data --force"],
  ],
  ["kubectl drain node-1", ["kubectl drain *", "drain node-1"]],
  [
    "kubectl drain node-1 --ignore-daemonsets --timeout=120s --grace-period=30",
    ["kubectl drain * --ignore-daemonsets --timeout=* --grace-period=*"],
  ],
  [
    "kubectl drain -l pool=spare --ignore-daemonsets",
    ["kubectl drain -l * --ignore-daemonsets"],
  ],
  ["kubectl drain node-1 -n kube-system", ["kubectl drain * -n *"]],
  [
    "kubectl taint nodes node-1 dedicated=db:NoExecute",
    ["kubectl taint nodes * *", "kubectl taint nodes node-1 *"],
  ],
  [
    "kubectl taint nodes node-1 dedicated=db:NoSchedule",
    ["kubectl taint nodes * *", "kubectl taint nodes node-1 dedicated=db:*"],
  ],
  [
    "kubectl taint nodes node-1 dedicated=db:PreferNoSchedule --overwrite",
    ["kubectl taint nodes * * --overwrite"],
  ],
  ["kubectl taint node/node-1 dedicated-", ["kubectl taint node/* *"]],
  [
    "kubectl taint nodes --all dedicated=db:NoExecute",
    ["kubectl taint nodes --all *"],
  ],
  [
    "kubectl taint no node-1 k=v:NoExecute -n kube-system",
    ["kubectl taint no * * -n *"],
  ],
];

// Neighbours that must keep running unattended where they did before.
const NODE_WIDE_NEIGHBOURS: Array<string> = [
  "kubectl cordon node-1",
  "kubectl uncordon node-1",
  "kubectl uncordon node/node-1",
];

describe("KubectlPolicy SafeWrite scope", () => {
  describe("every documented single-object SafeWrite stays SafeWrite (negative controls)", () => {
    it.each(SINGLE_OBJECT_SAFE_WRITES)(
      "tiers %s as SafeWrite",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.SafeWrite);
        expect(result.protectedNamespace).toBeUndefined();
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
      },
    );
  });

  describe("a bare kind, several objects or a selector is RiskyWrite", () => {
    it.each(NOT_ONE_NAMED_OBJECT)(
      "tiers %s as RiskyWrite",
      (command: string) => {
        expect(tier(command)).toBe(KubectlCommandTier.RiskyWrite);
      },
    );

    it.each(NOT_ONE_NAMED_OBJECT)(
      "never runs %s unattended in Automatic mode, but a human, the allowlist or bypass still can",
      (command: string) => {
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
        expect(
          autoVerdict(command, { allowlistPatterns: [command] }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
      },
    );

    it("says a bare kind is every object of that kind, and how to name one", () => {
      const text: string = KubectlPolicy.evaluateCommand(
        "kubectl rollout undo deployment -n prod",
      ).reason;
      expect(text).toContain("names no workload");
      expect(text).toContain("every deployment in the namespace");
      expect(text).toContain("TYPE/NAME");
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl rollout restart deployment/a deployment/b -n prod",
        ).reason,
      ).toContain("several workloads");
      expect(
        KubectlPolicy.evaluateCommand("kubectl delete pod a b -n web").reason,
      ).toContain("several objects");
    });

    it("keeps the Read forms of rollout and --field-selector reads untouched", () => {
      expect(
        tier("kubectl rollout status deployment -n web --watch=false"),
      ).toBe(KubectlCommandTier.Read);
      expect(tier("kubectl rollout history deployment -n web")).toBe(
        KubectlCommandTier.Read,
      );
      expect(
        tier("kubectl get pods --field-selector=status.phase=Pending -n web"),
      ).toBe(KubectlCommandTier.Read);
      expect(tier("kubectl get pods -l app=web -n web")).toBe(
        KubectlCommandTier.Read,
      );
    });

    it.each(ONE_OBJECT_MATRIX)(
      "$verb: one named object is SafeWrite; a bare kind, two names or --field-selector is RiskyWrite",
      (row: {
        verb: string;
        one: string;
        bareKind: string;
        twoNames: string;
        fieldSelector: string;
      }) => {
        expect(tier(row.one)).toBe(KubectlCommandTier.SafeWrite);
        expect(tier(row.bareKind)).toBe(KubectlCommandTier.RiskyWrite);
        expect(tier(row.twoNames)).toBe(KubectlCommandTier.RiskyWrite);
        expect(tier(row.fieldSelector)).toBe(KubectlCommandTier.RiskyWrite);
      },
    );

    it("still refuses a delete that names nothing at all", () => {
      expect(tier("kubectl delete pod -n web")).toBe(KubectlCommandTier.Denied);
      expect(tier("kubectl delete pods")).toBe(KubectlCommandTier.Denied);
    });
  });

  describe("the right shape on the wrong kind is RiskyWrite", () => {
    it.each(WRONG_KIND_FOR_SAFE_WRITE)(
      "tiers %s as RiskyWrite",
      (command: string) => {
        expect(tier(command)).toBe(KubectlCommandTier.RiskyWrite);
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
      },
    );

    it("says why a deleted Job is not a safe change", () => {
      expect(
        KubectlPolicy.evaluateCommand("kubectl delete job db-migrate -n prod")
          .reason,
      ).toContain("no controller recreates it");
    });

    it("names the kind as written when a custom resource borrows a built-in name", () => {
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl delete pods.example.com foo -n x",
        ).reason,
      ).toContain("pods.example.com");
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl rollout restart deployments.example.com/web -n web",
        ).reason,
      ).toContain("deployments.example.com");
    });

    it("says a label on a non-workload kind steers a controller", () => {
      const text: string = KubectlPolicy.evaluateCommand(
        "kubectl label node worker-1 pool=spare",
      ).reason;
      expect(text).toContain("labels on node");
      expect(text).toContain("only a pod or workload is a safe target");
    });
  });

  describe("reserved label and annotation keys are RiskyWrite", () => {
    it.each(RESERVED_KEY_WRITES)(
      "tiers %s as RiskyWrite",
      (command: string) => {
        expect(tier(command)).toBe(KubectlCommandTier.RiskyWrite);
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
      },
    );

    it.each(LOOKALIKE_KEYS_STAY_SAFE)(
      "keeps %s SafeWrite (the domain is not kubernetes.io or k8s.io)",
      (command: string) => {
        expect(tier(command)).toBe(KubectlCommandTier.SafeWrite);
      },
    );

    it("names the reserved key", () => {
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl label pod web-1 -n web app.kubernetes.io/name=x",
        ).reason,
      ).toContain("app.kubernetes.io/name");
    });
  });

  describe("scaling to zero replicas is RiskyWrite", () => {
    it.each(SCALE_TO_ZERO)("tiers %s as RiskyWrite", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.RiskyWrite);
      expect(autoVerdict(command).verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
    });

    it("calls zero an outage", () => {
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl scale deployment web --replicas=0 -n web",
        ).reason,
      ).toContain("outage");
    });

    it("still needs --replicas at all", () => {
      expect(tier("kubectl scale deployment web -n web")).toBe(
        KubectlCommandTier.Denied,
      );
    });

    it("keeps one replica and more SafeWrite", () => {
      for (const count of ["1", "2", "10", "100"]) {
        expect(
          tier(`kubectl scale deployment web --replicas=${count} -n web`),
        ).toBe(KubectlCommandTier.SafeWrite);
      }
    });
  });

  describe("writes in a protected namespace always need a human", () => {
    it("covers exactly kube-system, kube-public and kube-node-lease", () => {
      expect([...PROTECTED_KUBERNETES_NAMESPACES].sort()).toEqual([
        "kube-node-lease",
        "kube-public",
        "kube-system",
      ]);
    });

    it.each(PROTECTED_NAMESPACE_WRITES)(
      "tiers %s at least RiskyWrite and marks it protected (%s)",
      (command: string, namespace: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.protectedNamespace).toBe(namespace);
        expect(result.reason).toContain(`protected namespace ${namespace}`);
      },
    );

    it.each(PROTECTED_NAMESPACE_WRITES)(
      "never auto-approves %s: not in Automatic, not with bypass, not through any allowlist",
      (command: string, namespace: string) => {
        for (const options of [
          {},
          { bypassApproval: true },
          { allowlistPatterns: ["*"] },
          { allowlistPatterns: ["kubectl *"] },
          { allowlistPatterns: [command] },
          { allowlistPatterns: [command], bypassApproval: true },
        ]) {
          const verdict: KubectlAutoExecutionVerdict = autoVerdict(
            command,
            options,
          );
          expect(verdict.verdict).toBe(
            AiRemediationCommandPolicyVerdict.RequiresApproval,
          );
          expect(verdict.reason).toContain(namespace);
        }
      },
    );

    it.each(PROTECTED_NAMESPACE_READS)(
      "keeps %s Read and auto-approved",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.Read);
        expect(result.protectedNamespace).toBeUndefined();
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
      },
    );

    it.each(NOT_PROTECTED)(
      "does not treat %s as a protected-namespace write",
      (command: string, expected: KubectlCommandTier) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(expected);
        expect(result.protectedNamespace).toBeUndefined();
      },
    );

    it("keeps Denied Denied in a protected namespace", () => {
      for (const command of [
        "kubectl delete secret x -n kube-system",
        "kubectl create token admin -n kube-system",
        "kubectl delete namespace kube-system",
        "kubectl exec -it coredns-abc -n kube-system -- sh",
      ]) {
        expect(tier(command)).toBe(KubectlCommandTier.Denied);
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.Denied,
        );
      }
    });

    it("reports the namespace the command names, so the Runner can scope writes", () => {
      expect(
        KubectlPolicy.evaluateCommand("kubectl delete pod web-1 -nweb")
          .namespace,
      ).toBe("web");
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl --namespace=data rollout restart sts/db",
        ).namespace,
      ).toBe("data");
      expect(
        KubectlPolicy.evaluateCommand("kubectl get pods -n=web").namespace,
      ).toBe("web");
      expect(
        KubectlPolicy.evaluateCommand("kubectl cordon node-1").namespace,
      ).toBeUndefined();
      expect(
        KubectlPolicy.evaluateArgs([
          "delete",
          "pod",
          "x",
          "--namespace",
          "kube-system",
        ]).protectedNamespace,
      ).toBe("kube-system");
    });
  });

  describe("a node drain or taint always needs a human, in every mode", () => {
    it.each(NODE_WIDE_EVICTIONS)(
      "tiers %s RiskyWrite with requiresHuman, and nothing runs it unattended",
      (command: string, entries: Array<string>) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.requiresHuman).toBe(true);
        // Node verbs name no namespace: the flag is not the protected-namespace one.
        expect(result.protectedNamespace).toBeUndefined();
        expect(result.reason).toContain("in every namespace");
        expect(result.reason).toContain("kube-system");

        for (const entry of entries) {
          // The entries are valid and do match: the rule, not a miss, stops them.
          expect(
            KubectlPolicy.describeAllowlistPatternProblem(entry),
          ).toBeNull();
          expect(
            KubectlPolicy.matchesAllowlist({
              args: result.args,
              allowlistPatterns: [entry],
            }),
          ).toBe(true);
        }

        for (const options of [
          {},
          { bypassApproval: true },
          { allowlistPatterns: [command] },
          { allowlistPatterns: entries },
          { allowlistPatterns: [command, ...entries], bypassApproval: true },
        ]) {
          const verdict: KubectlAutoExecutionVerdict = autoVerdict(
            command,
            options,
          );
          expect(verdict.verdict).toBe(
            AiRemediationCommandPolicyVerdict.RequiresApproval,
          );
          expect(verdict.requiresHuman).toBe(true);
          expect(verdict.reason).toContain(
            "Neither bypassing approvals nor the cluster's allowlist applies to a node drain or taint",
          );
        }
      },
    );

    it.each(NODE_WIDE_NEIGHBOURS)(
      "negative control: %s stays SafeWrite and runs unattended",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.SafeWrite);
        expect(result.requiresHuman).toBeUndefined();
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
      },
    );

    it("negative control: other riskier node and workload changes still run under Bypass approval or a matching entry", () => {
      for (const command of [
        "kubectl label node node-1 pool=spare",
        "kubectl cordon node-1 node-2",
        'kubectl patch deployment web -n web -p \'{"spec":{"replicas":2}}\'',
        "kubectl set image deployment/web web=img:2 -n web",
      ]) {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.requiresHuman).toBeUndefined();
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
        expect(
          autoVerdict(command, { allowlistPatterns: [command] }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
        expect(autoVerdict(command).requiresHuman).toBeUndefined();
      }
    });

    it("marks a protected-namespace refusal as needing a human too", () => {
      const verdict: KubectlAutoExecutionVerdict = autoVerdict(
        "kubectl rollout restart deployment/coredns -n kube-system",
        { bypassApproval: true },
      );
      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.requiresHuman).toBe(true);
    });
  });

  describe("evaluateCommand and evaluateArgs agree on every table above", () => {
    const allCommands: Array<string> = [
      ...SINGLE_OBJECT_SAFE_WRITES,
      ...NODE_WIDE_EVICTIONS.map(([command]: [string, Array<string>]) => {
        return command;
      }),
      ...NODE_WIDE_NEIGHBOURS,
      ...NOT_ONE_NAMED_OBJECT,
      ...ONE_OBJECT_MATRIX.flatMap(
        (row: {
          one: string;
          bareKind: string;
          twoNames: string;
          fieldSelector: string;
        }) => {
          return [row.one, row.bareKind, row.twoNames, row.fieldSelector];
        },
      ),
      ...WRONG_KIND_FOR_SAFE_WRITE,
      ...RESERVED_KEY_WRITES,
      ...LOOKALIKE_KEYS_STAY_SAFE,
      ...SCALE_TO_ZERO,
      ...PROTECTED_NAMESPACE_WRITES.map(([command]: [string, string]) => {
        return command;
      }),
      ...PROTECTED_NAMESPACE_READS,
      ...NOT_PROTECTED.map(([command]: [string, KubectlCommandTier]) => {
        return command;
      }),
    ];

    it.each(allCommands)(
      "returns the same verdict for %s",
      (command: string) => {
        const tokenized: KubectlTokenizeResult =
          KubectlPolicy.tokenize(command);
        expect(tokenized.args).toBeDefined();
        const viaCommand: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(KubectlPolicy.evaluateArgs(tokenized.args!)).toEqual(viaCommand);
        expect(KubectlPolicy.tokenize(viaCommand.displayCommand).args).toEqual(
          tokenized.args,
        );
      },
    );
  });
});
