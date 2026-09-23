import {
  KubectlCommandTier,
  isProtectedKubernetesNamespace,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  AiRemediationCommandPolicyVerdict,
  MAX_COMMAND_LENGTH_CHARS,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import CommandPolicy from "./CommandPolicy";

/*
 * Policy gate for kubectl commands OneUptime AI composes against a cluster.
 *
 * Pure functions with no server dependencies on purpose: the same evaluation
 * runs where the AI composes the command, at the server-side enqueue
 * chokepoint, and inside the customer-side Runner right before it spawns
 * kubectl. The Runner is the last line: a compromised server still cannot
 * make it run a Denied command.
 *
 * kubectl is NEVER invoked through a shell. A command is tokenized into an
 * argv here (shell quoting only, no expansion, no operators) and the Runner
 * spawns the kubectl binary with that argv, so `;`, `|`, `$( )` and friends
 * are literal bytes in an argument, not a second command. What this policy
 * has to bound is therefore what kubectl itself can do, which is a closed
 * vocabulary of verbs and flags — a much better place to stand than a bash
 * denylist.
 *
 * Tiers (see KubectlCommandTier): Read is what an investigation may run;
 * SafeWrite is what Automatic remediation runs unattended; RiskyWrite needs
 * a human unless the operator allowlisted it (or the cluster bypasses
 * approvals); Denied never runs.
 *
 * SafeWrite is deliberately narrow: exactly ONE named object of one
 * built-in kind, with no selector (-l, --selector or --field-selector) and
 * no --all —
 *   - rollout restart/undo/pause/resume of one Deployment, StatefulSet or
 *     DaemonSet (a bare kind is every object of that kind to kubectl);
 *   - scale of one Deployment, StatefulSet or ReplicaSet to a count above
 *     zero (zero is an outage, not a nudge);
 *   - delete of one named pod (its controller recreates it; a Job is not
 *     recreated by anything, so deleting one is RiskyWrite);
 *   - cordon/uncordon of one node;
 *   - label/annotate of one pod or workload (Deployment, StatefulSet,
 *     DaemonSet, ReplicaSet, Job, CronJob) with keys outside the reserved
 *     kubernetes.io / k8s.io prefixes (and a few identity, admission and
 *     GitOps controller prefixes). Labels on namespaces, nodes, Services,
 *     RBAC objects or webhooks steer admission, scheduling, identity or
 *     traffic, so they are RiskyWrite.
 * Anything wider is RiskyWrite. A write whose namespace is one of
 * PROTECTED_KUBERNETES_NAMESPACES (kube-system, kube-public,
 * kube-node-lease), or that targets one of those Namespace objects, is at
 * least RiskyWrite and carries `protectedNamespace`: evaluateForAutoExecution
 * never runs it without a human, whatever the mode or allowlist.
 *
 * `kubectl drain` and `kubectl taint` are RiskyWrite and carry
 * `requiresHuman` for the same reason. A drain evicts every pod on the node
 * and a taint decides which pods the node keeps (a NoExecute taint evicts
 * the rest), in EVERY namespace — kube-system and the OneUptime agent's own
 * included — although the command names no namespace at all. So, like a
 * protected-namespace write, evaluateForAutoExecution never runs one without
 * a human: not in Bypass approval, not through the allowlist. cordon and
 * uncordon only stop or resume scheduling on the node and stay SafeWrite.
 *
 * Denied is what no one should be asked to approve from an AI plan:
 *   - Changes to who may do what, or to what the API server admits and
 *     serves: EVERY write (label, annotate, patch, set, scale, rollout,
 *     delete, ...) on the RBAC kinds (roles, cluster roles and their
 *     bindings) and on the admission and API-extension kinds (validating /
 *     mutating webhook configurations, validating / mutating admission
 *     policies and their bindings, APIServices, CRDs), in every spelling
 *     kubectl accepts; creating RBAC objects or ServiceAccounts; set
 *     subject; set serviceaccount; auth reconcile; certificate approve/deny.
 *     Reading these kinds stays Read.
 *   - Wiring identity, privileges, host access, Secrets or a new program
 *     into a pod: patch bodies touching POD_SECURITY_PATCH_KEYS, Pod
 *     Security Admission labels, set env --from=secret/..., and creating a
 *     workload that runs an image named in the command — `create
 *     deployment` and `create cronjob` (kubectl requires --image for both)
 *     and `create job --image`. Only `create job NAME --from=cronjob/NAME`
 *     stays, as RiskyWrite: it re-runs the CronJob's existing spec. `set
 *     image` is different on purpose: it changes the image of a workload
 *     that already exists, under the identity, security context and mounts
 *     that workload already has, and a rollback puts the old image back —
 *     so it is RiskyWrite, and a human, the allowlist or Bypass approval
 *     decides.
 *   - A patch body that is not JSON. kubectl reads any other body as YAML
 *     1.1, whose tags (`!!binary`), anchors, aliases and merge keys can
 *     spell a field name that appears nowhere in the text, so a body is
 *     only ever checked — and only ever run — as JSON (see
 *     findPatchBodyProblem).
 *   - Deleting cluster-level kinds (NEVER_DELETE_KINDS) in any spelling.
 *   - Anything that names a resource CATEGORY (all, api-extensions, ...)
 *     in a write, because kubectl expands a category into many kinds before
 *     this policy could see them.
 *   - Anything kubectl would not run as the command we read — a verb or
 *     create/set subcommand it does not have (kubectl would run a
 *     kubectl-<word> plugin from the Runner's PATH), one not written in
 *     lowercase (cobra matches case-sensitively), or a namespace set twice
 *     (pflag keeps the last one).
 *
 * Three more things are Denied because their OUTPUT is the problem, not the
 * verb. Secret objects are off-limits in every verb (get, describe, label,
 * patch, delete, create secret, create token, set env --resolve): each of
 * those can print or mint credential values, which would land in front of
 * the model and in the job record. File-backed output formats (-o
 * jsonpath-file=..., --template) make kubectl read a file off the Runner and
 * echo it. And a flag written before the verb is refused unless it is one of
 * kubectl's global flags, because kubectl picks the command before it parses
 * flags and `kubectl --all events delete` runs delete (see the Flags section).
 *
 * ---- The cluster kubectl allowlist -------------------------------------------
 *
 * The AI page's "kubectl allowlist" (KubernetesCluster.aiKubectlCommandAllowlist)
 * lets an operator pre-approve RiskyWrite SHAPES in Automatic mode. It is
 * matched token by token against the argv kubectl will get, never as one
 * glob over the rendered string (see matchesAllowlist):
 *   - A pattern is tokenized exactly like a command: shell quoting, and a
 *     leading "kubectl" (in any case) is optional, in a pattern exactly as
 *     in a command — "kubectl set image ..." and "set image ..." are the
 *     same entry. It must have the SAME number of tokens as the command, so
 *     `*` can never absorb an extra resource, a selector, a second -n or
 *     any other extra argument.
 *   - Each pattern token matches exactly one argv token. A `*` inside a
 *     token is a glob within that one token and never matches whitespace:
 *     `web=*` matches `web=nginx:1.27`, `deployment/*` matches
 *     `deployment/api`, and `-p *` matches a patch body written without
 *     spaces. A `*` is one word, so a leading `*` stands for the verb,
 *     never for "kubectl".
 *   - Flags must be spelled in the pattern to be present in the command: a
 *     command token that is a flag is only matched by a pattern token that
 *     spells the same flag literally (`-n`, `--replicas=*`); a `*` never
 *     stands for a flag.
 *   - Case-sensitive. The first 100 non-blank entries are read.
 *   - The allowlist never promotes a Denied command, never a write in a
 *     protected namespace, and never a drain or taint.
 *
 * Which entries are valid is decided in ONE place,
 * describeAllowlistPatternProblem: the server refuses to save anything
 * else, the AI page refuses it in the form, and matchesAllowlist skips it —
 * so an entry either works as written or is refused where it is typed. An
 * entry is valid when it is:
 *   - a non-blank string of at most 500 characters, on one line, with
 *     balanced quotes and at most 64 words (a bare "kubectl" names no
 *     command);
 *   - that names its kubectl verb written out: lowercase, no `*` — and, for
 *     rollout, set and create (and auth, cluster-info and top when it names
 *     one), its subcommand the same way. A wildcard verb or subcommand
 *     would pre-approve every KIND of change at once, and a leading `*`
 *     written for "kubectl" (the old whole-command glob) never matched
 *     anything;
 *   - whose verb is one OneUptime AI may run at all; and
 *   - whose flags the policy reads: a flag this policy refuses or does not
 *     know, or a non-global flag before the verb, makes every command the
 *     entry could match Denied.
 *
 * An entry is BROAD (isBroadAllowlistPattern; the AI page asks for an
 * explicit confirmation before saving one) when a `*` stands for the
 * namespace, for an object the command acts on (a kind, a name, a
 * TYPE/NAME, or an extra object ahead of the update), or for a selector or
 * --from source. A `*` in a VALUE keeps the entry about the objects it
 * names: the image pair in the documented `kubectl set image deployment/web
 * * -n web` (kubectl reads that last word either as the image update or as
 * another object with no update, which it refuses), a patch body, a replica
 * count, a revision, or the name of the Job `create job * --from=cronjob/X`
 * makes. Entries the allowlist can never promote — reads, drain and taint —
 * pre-approve nothing and are never broad.
 */

export interface KubectlPolicyResult {
  tier: KubectlCommandTier;
  // Human-readable: why this tier. Shown to the model and on approval cards.
  reason: string;
  // Normalized argv WITHOUT the leading "kubectl".
  args: Array<string>;
  // "get", "rollout restart", "delete pod", ... — for audit labels.
  verb: string;
  // The exact command, rendered for humans: "kubectl get pods -n web".
  displayCommand: string;
  /*
   * The namespace the command names with -n / --namespace (-nX, -n=X,
   * --namespace=X), exactly as kubectl parses it. Absent when the command
   * gives none — kubectl then uses the context's namespace (the Runner pod's
   * own, in-cluster). Never set on a Denied result.
   */
  namespace?: string | undefined;
  /*
   * Set on a write that lands in, or targets, one of
   * PROTECTED_KUBERNETES_NAMESPACES. Such a write is at least RiskyWrite and
   * evaluateForAutoExecution never runs it without a human: not with
   * bypassApproval, not through the allowlist.
   */
  protectedNamespace?: string | undefined;
  /*
   * Set on a node drain or taint (see the header). Such a command is
   * RiskyWrite and evaluateForAutoExecution never runs it without a human,
   * exactly like a protected-namespace write: it moves pods in every
   * namespace, kube-system and the agent's own included.
   */
  requiresHuman?: boolean | undefined;
}

/*
 * kubectl normalizes "_" to "-" in long flag names (pflag's
 * WordSepNormalizeFunc), so --as_group IS --as-group and
 * --insecure_skip_tls_verify IS --insecure-skip-tls-verify. Every flag
 * lookup here goes through this first, so an underscore spelling can never
 * slip past a deny list; anything else that inspects kubectl flags (the
 * Runner's argv guard) should use it too.
 */
export function normalizeKubectlFlagName(name: string): string {
  return (name || "").replace(/_/g, "-");
}

export interface KubectlAutoExecutionVerdict {
  verdict: AiRemediationCommandPolicyVerdict;
  tier: KubectlCommandTier;
  reason: string;
  /*
   * True when nothing an operator can configure lets this command run
   * unattended — a write in a protected namespace, or a node drain or taint
   * — so an approval card should say that (the reason does), not that the
   * cluster "only runs safe changes". Absent otherwise.
   */
  requiresHuman?: boolean | undefined;
}

export interface KubectlTokenizeResult {
  args?: Array<string> | undefined;
  errorMessage?: string | undefined;
}

const MAX_TOKENS: number = 64;

// Tokens made only of these survive a shell split unquoted.
const SHELL_SAFE_TOKEN: RegExp = /^[A-Za-z0-9_@%+=:,./-]+$/;

/*
 * ---- Flags -----------------------------------------------------------------
 *
 * kubectl parses flags with pflag, and this policy has to see the SAME
 * positionals kubectl will see, or a resource kind can hide inside what we
 * took for a flag value, and a flag value can pose as the verb. pflag's
 * rules, which parseArgs() mirrors exactly:
 *
 *   - "--flag=value" carries its value inline. "--flag value" carries it in
 *     the next token ONLY when the flag takes a value: a boolean flag never
 *     consumes the next token, and neither does an optional-value flag
 *     ("--cascade" alone means background; "--cascade=orphan" is a value).
 *   - "-abc" is a cluster of short flags read letter by letter: each letter
 *     is a boolean flag until one that takes a value, whose value is the
 *     rest of the token ("-nweb") or, when nothing is left, the next token
 *     ("-n web"). "-n=web" works too.
 *   - A value flag takes the next token whatever it looks like: "-n -A" is
 *     the namespace "-A".
 *   - "--" ends flag parsing; everything after it is positional.
 *   - "_" in a long flag name reads as "-" ("--all_namespaces"); see
 *     normalizeKubectlFlagName, which runs before every lookup.
 *   - A flag kubectl does not know is an error.
 *   - The command is picked BEFORE flags are parsed (by cobra, not pflag),
 *     and at that point any flag that is not a global flag is assumed to
 *     take the next word as its value, whatever the verb makes of it later:
 *     `kubectl --all events delete -n web` runs `delete --all events`, and
 *     `kubectl cluster-info -A x dump` runs `cluster-info dump -A`. So only
 *     GLOBAL_FLAGS may precede the verb (and, for SUBCOMMAND_VERBS, the
 *     subcommand); every other flag must follow it. kubectl itself rejects
 *     most of the other orderings ("flags cannot be placed before plugin
 *     name"), so nothing that could have run is lost.
 *
 * Every flag OneUptime AI may use is listed here with its arity. A flag that
 * is not listed is Denied: without knowing whether it swallows the next
 * token we cannot know which token is the verb or the kind, so it is refused
 * rather than guessed. kubectl rejects flags it does not know, so nothing
 * that could have run is lost.
 */
enum FlagArity {
  // Never takes a value: "--all", "-A". ("--all=false" is the only value form.)
  Boolean = "Boolean",
  // Always takes a value: "-n web", "-nweb", "-n=web", "--namespace web".
  Value = "Value",
  /*
   * Takes a value only when written "--flag=value". Written bare it means
   * its default and never consumes the next token (pflag's NoOptDefVal).
   */
  OptionalValue = "OptionalValue",
}

const KNOWN_FLAGS: Record<string, FlagArity> = {
  // Global (any verb).
  n: FlagArity.Value,
  namespace: FlagArity.Value,
  "request-timeout": FlagArity.Value,
  "match-server-version": FlagArity.Boolean,

  // Output and table shaping. The -o value itself is checked separately.
  o: FlagArity.Value,
  output: FlagArity.Value,
  "allow-missing-template-keys": FlagArity.Boolean,
  "show-labels": FlagArity.Boolean,
  "show-kind": FlagArity.Boolean,
  "show-managed-fields": FlagArity.Boolean,
  "no-headers": FlagArity.Boolean,
  "server-print": FlagArity.Boolean,
  "ignore-not-found": FlagArity.Boolean,
  "output-watch-events": FlagArity.Boolean,
  L: FlagArity.Value,
  "label-columns": FlagArity.Value,
  "sort-by": FlagArity.Value,
  "chunk-size": FlagArity.Value,
  subresource: FlagArity.Value,

  // Selecting objects.
  A: FlagArity.Boolean,
  "all-namespaces": FlagArity.Boolean,
  all: FlagArity.Boolean,
  l: FlagArity.Value,
  selector: FlagArity.Value,
  labels: FlagArity.Value,
  "field-selector": FlagArity.Value,

  // Streaming: booleans, but allowed only as "=false" (see STREAMING_FLAGS).
  w: FlagArity.Boolean,
  watch: FlagArity.Boolean,
  "watch-only": FlagArity.Boolean,
  follow: FlagArity.Boolean,

  // logs.
  c: FlagArity.Value,
  container: FlagArity.Value,
  since: FlagArity.Value,
  "since-time": FlagArity.Value,
  tail: FlagArity.Value,
  "limit-bytes": FlagArity.Value,
  "max-log-requests": FlagArity.Value,
  "pod-running-timeout": FlagArity.Value,
  previous: FlagArity.Boolean,
  timestamps: FlagArity.Boolean,
  "all-containers": FlagArity.Boolean,
  "all-pods": FlagArity.Boolean,
  "ignore-errors": FlagArity.Boolean,
  "insecure-skip-tls-verify-backend": FlagArity.Boolean,

  /*
   * Three names mean different things on different verbs; the value form is
   * the default and VERB_FLAG_OVERRIDES holds the exceptions:
   *   -p         is --patch (value) on patch, --previous (boolean) on logs
   *   --prefix   is a value on set env, a boolean on logs
   *   --containers is -c (value) on set env/resources, a boolean on top pod
   */
  p: FlagArity.Value,
  patch: FlagArity.Value,
  prefix: FlagArity.Value,
  containers: FlagArity.Value,

  // describe, top, events, api-resources, version, explain, auth.
  "show-events": FlagArity.Boolean,
  sum: FlagArity.Boolean,
  "use-protocol-buffers": FlagArity.Boolean,
  "show-capacity": FlagArity.Boolean,
  for: FlagArity.Value,
  types: FlagArity.Value,
  "api-group": FlagArity.Value,
  categories: FlagArity.Value,
  verbs: FlagArity.Value,
  cached: FlagArity.Boolean,
  namespaced: FlagArity.Boolean,
  client: FlagArity.Boolean,
  "api-version": FlagArity.Value,
  list: FlagArity.Boolean,
  q: FlagArity.Boolean,
  quiet: FlagArity.Boolean,

  // rollout, scale, delete, drain, cordon, label, annotate, taint, patch, set.
  revision: FlagArity.Value,
  "to-revision": FlagArity.Value,
  timeout: FlagArity.Value,
  "field-manager": FlagArity.Value,
  replicas: FlagArity.Value,
  r: FlagArity.Value,
  "current-replicas": FlagArity.Value,
  "resource-version": FlagArity.Value,
  "grace-period": FlagArity.Value,
  "pod-selector": FlagArity.Value,
  "skip-wait-for-delete-timeout": FlagArity.Value,
  force: FlagArity.Boolean,
  now: FlagArity.Boolean,
  wait: FlagArity.Boolean,
  "ignore-daemonsets": FlagArity.Boolean,
  "delete-emptydir-data": FlagArity.Boolean,
  "delete-local-data": FlagArity.Boolean,
  "disable-eviction": FlagArity.Boolean,
  overwrite: FlagArity.Boolean,
  local: FlagArity.Boolean,
  record: FlagArity.Boolean,
  "save-config": FlagArity.Boolean,
  cascade: FlagArity.OptionalValue,
  "dry-run": FlagArity.OptionalValue,
  validate: FlagArity.OptionalValue,
  type: FlagArity.Value,
  image: FlagArity.Value,
  env: FlagArity.Value,
  e: FlagArity.Value,
  from: FlagArity.Value,
  keys: FlagArity.Value,
  limits: FlagArity.Value,
  requests: FlagArity.Value,

  // create, expose, autoscale.
  restart: FlagArity.Value,
  schedule: FlagArity.Value,
  port: FlagArity.Value,
  "target-port": FlagArity.Value,
  protocol: FlagArity.Value,
  name: FlagArity.Value,
  "external-ip": FlagArity.Value,
  "cluster-ip": FlagArity.Value,
  "load-balancer-ip": FlagArity.Value,
  overrides: FlagArity.Value,
  "override-type": FlagArity.Value,
  "session-affinity": FlagArity.Value,
  min: FlagArity.Value,
  max: FlagArity.Value,
  cpu: FlagArity.Value,
  "cpu-percent": FlagArity.Value,
  "from-literal": FlagArity.Value,
  "append-hash": FlagArity.Boolean,
  resource: FlagArity.Value,
  "resource-name": FlagArity.Value,
  verb: FlagArity.Value,
  "non-resource-url": FlagArity.Value,
  "aggregation-rule": FlagArity.Value,
  role: FlagArity.Value,
  clusterrole: FlagArity.Value,
  group: FlagArity.Value,
  serviceaccount: FlagArity.Value,
  hard: FlagArity.Value,
  scopes: FlagArity.Value,
  "min-available": FlagArity.Value,
  "max-unavailable": FlagArity.Value,
  value: FlagArity.Value,
  "global-default": FlagArity.Boolean,
  description: FlagArity.Value,
  "preemption-policy": FlagArity.Value,
  class: FlagArity.Value,
  rule: FlagArity.Value,
  annotation: FlagArity.Value,
  "default-backend": FlagArity.Value,
  tcp: FlagArity.Value,
  "node-port": FlagArity.Value,
  clusterip: FlagArity.Value,
  "docker-server": FlagArity.Value,
  "docker-username": FlagArity.Value,
  "docker-password": FlagArity.Value,
  "docker-email": FlagArity.Value,
  "windows-line-endings": FlagArity.Boolean,
};

const KNOWN_FLAG_ARITY: Map<string, FlagArity> = new Map<string, FlagArity>(
  Object.entries(KNOWN_FLAGS),
);

/*
 * Flags whose meaning depends on the verb (see the note in KNOWN_FLAGS), and
 * one that is Denied everywhere except on the verb where it is harmless
 * (explain --recursive prints every field; -R/--recursive elsewhere walks a
 * directory of manifests). The verb is the first positional; kubectl itself
 * rejects a subcommand's boolean flag placed before the verb, so these can
 * only ever follow it.
 */
const VERB_FLAG_OVERRIDES: Record<string, Record<string, FlagArity>> = {
  logs: { p: FlagArity.Boolean, prefix: FlagArity.Boolean },
  top: { containers: FlagArity.Boolean },
  explain: { recursive: FlagArity.Boolean },
};

const VERB_FLAG_OVERRIDE_ARITY: Map<string, Map<string, FlagArity>> = new Map<
  string,
  Map<string, FlagArity>
>(
  Object.entries(VERB_FLAG_OVERRIDES).map(
    ([verb, overrides]: [string, Record<string, FlagArity>]): [
      string,
      Map<string, FlagArity>,
    ] => {
      return [verb, new Map<string, FlagArity>(Object.entries(overrides))];
    },
  ),
);

/*
 * kubectl's global flags that OneUptime AI may use. They are the only flags
 * allowed before the verb (see the Flags section): kubectl parses them at
 * the root, so writing them first cannot shift which command runs.
 */
const GLOBAL_FLAGS: Set<string> = new Set<string>([
  "n",
  "namespace",
  "request-timeout",
  "match-server-version",
]);

/*
 * Verbs whose next positional is a subcommand (rollout status, set image,
 * create job, auth can-i, cluster-info dump, top pod). The ordering rule
 * applies between the verb and the subcommand as well.
 */
const SUBCOMMAND_VERBS: Set<string> = new Set<string>([
  "rollout",
  "set",
  "create",
  "auth",
  "cluster-info",
  "top",
]);

/*
 * Flags that are Denied wherever they appear, with why. Short and long
 * spellings are both listed because a short flag can hide inside a cluster
 * ("-As", "-pf") and is found letter by letter.
 *
 * kubectl v1.36's global flags are --as --as-group --as-uid --as-user-extra
 * --cache-dir --certificate-authority --client-certificate --client-key
 * --cluster --context --disable-compression --insecure-skip-tls-verify
 * --kubeconfig --kuberc --log-flush-frequency --match-server-version
 * -n/--namespace --password --profile --profile-output --request-timeout
 * -s/--server --tls-server-name --token --user --username -v/--v --vmodule
 * --warnings-as-errors. Every one of them except GLOBAL_FLAGS is listed
 * here: each selects credentials, an identity or a cluster, writes a file
 * on the Runner, or logs request bodies. (An unlisted flag is refused
 * anyway; listing them names the reason.)
 */
const DENIED_FLAG_GROUPS: Array<{ reason: string; flags: Array<string> }> = [
  {
    reason:
      "OneUptime AI may only use the cluster access it was given, never other credentials, another identity or another cluster",
    flags: [
      "kubeconfig",
      "kuberc",
      "token",
      "server",
      "s",
      "as",
      "as-group",
      "as-uid",
      "as-user-extra",
      "context",
      "cluster",
      "user",
      "username",
      "password",
      "client-certificate",
      "client-key",
      "certificate-authority",
      "insecure-skip-tls-verify",
      "tls-server-name",
    ],
  },
  {
    reason:
      "it makes kubectl read a file on the Runner (write templates and patches inline instead)",
    flags: [
      "filename",
      "f",
      "kustomize",
      "k",
      "recursive",
      "R",
      "patch-file",
      "from-file",
      "from-env-file",
      "cert",
      "key",
    ],
  },
  {
    reason:
      "it names the template that -o go-template-file reads from a file on the Runner (write it inline as -o go-template=... or -o jsonpath=... instead)",
    flags: ["template"],
  },
  {
    reason: "it turns kubectl into a raw API client",
    flags: ["raw"],
  },
  {
    reason:
      "it resolves Secret and ConfigMap references into their plaintext values (kubectl set env --list --resolve prints them)",
    flags: ["resolve"],
  },
  {
    reason:
      "kubectl's own logging, profiling and cache flags write on the Runner or print request bodies and credentials",
    flags: [
      "v",
      "vmodule",
      "log-file",
      "log-dir",
      "log-file-max-size",
      "log-backtrace-at",
      "log-flush-frequency",
      "alsologtostderr",
      "logtostderr",
      "add-dir-header",
      "one-output",
      "skip-headers",
      "skip-log-headers",
      "stderrthreshold",
      "profile",
      "profile-output",
      "cache-dir",
    ],
  },
  {
    reason: "it needs a terminal or an editor",
    flags: ["i", "interactive", "t", "tty", "stdin", "edit"],
  },
  {
    reason:
      "it has nothing to offer an SRE agent (kubectl explain documents resources)",
    flags: ["h", "help", "warnings-as-errors", "disable-compression"],
  },
];

const DENIED_FLAG_REASONS: Map<string, string> = new Map<string, string>();

for (const group of DENIED_FLAG_GROUPS) {
  for (const flag of group.flags) {
    DENIED_FLAG_REASONS.set(flag, group.reason);
  }
}

/*
 * Flags that keep kubectl running until it is killed. Boolean, so the only
 * way to write them off is "=false", which is what the model should write
 * on rollout status (which watches by default).
 */
const STREAMING_FLAGS: Set<string> = new Set<string>([
  "w",
  "watch",
  "watch-only",
  "follow",
]);

/*
 * ---- Output formats --------------------------------------------------------
 *
 * -o/--output values, compared lowercased. Formats that take an argument
 * must carry it inline after "=": -o jsonpath={.items[*].name}. Written bare
 * they take it from --template, which is Denied, so the bare form is refused
 * too. The *-file formats make kubectl read a path on the Runner and echo it
 * — a Read-tier `get` would print the pod's ServiceAccount token — so they
 * are Denied in every spelling (-o X=..., -oX=..., --output X=...,
 * --output=X=...); anything not listed is refused rather than guessed.
 */
const OUTPUT_FORMATS: Set<string> = new Set<string>([
  "json",
  "yaml",
  "name",
  "wide",
  "plaintext",
  "plaintext-openapiv2",
]);

const OUTPUT_FORMATS_WITH_ARGUMENT: Set<string> = new Set<string>([
  "jsonpath",
  "jsonpath-as-json",
  "go-template",
  "template",
  "custom-columns",
]);

const FILE_OUTPUT_FORMATS: Set<string> = new Set<string>([
  "go-template-file",
  "templatefile",
  "jsonpath-file",
  "custom-columns-file",
]);

// ---- Verbs -------------------------------------------------------------------

const READ_VERBS: Set<string> = new Set<string>([
  "get",
  "describe",
  "logs",
  "top",
  "events",
  "api-resources",
  "api-versions",
  "version",
  "explain",
]);

/*
 * The write verbs that CAN be SafeWrite — rollout restart/undo/pause/resume,
 * delete, scale, cordon, uncordon, label and annotate — each have their own
 * branch in evaluateArgs, because each has its own "exactly one named
 * object" shape. These are always at least RiskyWrite:
 */
const RISKY_WRITE_VERBS: Set<string> = new Set<string>([
  "patch",
  "set",
  "taint",
  "drain",
  "create",
  "expose",
  "autoscale",
]);

// Verbs that act on nodes, which live outside any namespace.
const NODE_VERBS: Set<string> = new Set<string>([
  "cordon",
  "uncordon",
  "drain",
  "taint",
]);

/*
 * Node verbs that move pods off a node in every namespace (a drain evicts
 * them; a NoExecute taint makes the node evict them, and any taint decides
 * which pods it keeps). They carry `requiresHuman`: nothing an operator sets
 * on the cluster runs them unattended (see the header).
 */
const ALWAYS_HUMAN_VERBS: Set<string> = new Set<string>(["drain", "taint"]);

/*
 * The write verbs evaluateArgs tiers in a branch of their own (the ones that
 * can be SafeWrite). With READ_VERBS, RISKY_WRITE_VERBS and the two
 * read-only command groups below, these are every verb OneUptime AI may run;
 * evaluateArgs refuses any other word as an unknown verb.
 */
const OWN_BRANCH_WRITE_VERBS: Set<string> = new Set<string>([
  "rollout",
  "delete",
  "scale",
  "cordon",
  "uncordon",
  "label",
  "annotate",
]);

const READ_COMMAND_GROUPS: Set<string> = new Set<string>([
  "cluster-info",
  "auth",
]);

// Verbs whose subcommand must be written out for the command to run at all.
const SUBCOMMAND_REQUIRED_VERBS: Set<string> = new Set<string>([
  "rollout",
  "set",
  "create",
]);

function isVerbOneUptimeAiMayRun(verb: string): boolean {
  return (
    READ_VERBS.has(verb) ||
    RISKY_WRITE_VERBS.has(verb) ||
    OWN_BRANCH_WRITE_VERBS.has(verb) ||
    READ_COMMAND_GROUPS.has(verb)
  );
}

/*
 * Verbs with nothing to offer an SRE agent, or that open an interactive or
 * long-lived channel, or that could rewrite objects from input we do not
 * support. Listed explicitly so the reason names the verb; any verb not in
 * any list is Denied too — kubectl runs a `kubectl-<verb>` plugin from the
 * Runner's PATH for a word it does not know (and a kuberc alias for one it
 * has been taught), so an unknown verb is never a guess we can afford.
 */
const DENIED_VERBS: Set<string> = new Set<string>([
  "kuberc",
  "exec",
  "attach",
  "cp",
  "port-forward",
  "proxy",
  "debug",
  "run",
  "edit",
  "replace",
  "apply",
  "diff",
  "kustomize",
  "config",
  "certificate",
  "wait",
  "plugin",
  "completion",
  "options",
  "help",
  "alpha",
  "convert",
]);

/*
 * Kinds whose deletion is either unrecoverable or cluster-wide. Deleting
 * them is Denied even with a human in the loop — this lane is for fixing a
 * workload, not for tearing down a cluster. Matched on normalizeKind(), so
 * every spelling kubectl accepts is covered: plural, singular, short name,
 * Kind case and group-qualified (`crd`, `CustomResourceDefinition`,
 * `customresourcedefinitions.apiextensions.k8s.io`, `ns/prod`, ...).
 * Resource CATEGORIES (all, api-extensions) are refused separately, in every
 * write verb (see RESOURCE_CATEGORIES).
 */
const NEVER_DELETE_KINDS: Set<string> = new Set<string>([
  "namespace",
  "node",
  "persistentvolume",
  "persistentvolumeclaim",
  "customresourcedefinition",
  "clusterrole",
  "clusterrolebinding",
  "role",
  "rolebinding",
  "storageclass",
  "secret",
  "priorityclass",
  "apiservice",
  "mutatingwebhookconfiguration",
  "validatingwebhookconfiguration",
  "validatingadmissionpolicy",
  "validatingadmissionpolicybinding",
  "mutatingadmissionpolicy",
  "mutatingadmissionpolicybinding",
  "certificatesigningrequest",
]);

/*
 * Resource categories. kubectl expands a category into every kind that
 * declares it (ReplaceAliases, through discovery) BEFORE it resolves types,
 * so `kubectl delete api-extensions -l x` deletes CRDs, APIServices and
 * admission webhooks although none of those kinds appears in the command.
 * A category is therefore never allowed in a write, whatever the verb.
 * `all` and `api-extensions` are the categories the API server itself
 * defines (the only ones that can reach built-in kinds); the rest are the
 * categories widely used operators give their custom resources — a custom
 * category can only reach custom resources, which are RiskyWrite anyway, so
 * this list is a clearer refusal, not the only line. Reads (`get all`)
 * stay Read.
 */
const RESOURCE_CATEGORIES: Set<string> = new Set<string>([
  "all",
  "api-extensions",
  "crossplane",
  "managed",
  "composite",
  "claim",
  "knative",
  "serving",
  "eventing",
  "istio-io",
  "networking-istio-io",
  "security-istio-io",
  "telemetry-istio-io",
  "extensions-istio-io",
  "gateway-api",
  "cert-manager",
  "kyverno",
  "cluster-api",
  "tekton",
  "tekton-pipelines",
]);

/*
 * Kinds that decide who may do what. OneUptime AI never creates or changes
 * them in any write verb — label and annotate included (a label on a
 * ClusterRole can aggregate its rules into admin/edit/view) — because a new
 * or widened binding is a privilege grant, not a fix; nor does it delete
 * them (NEVER_DELETE_KINDS). Reading them stays Read: an investigation needs
 * to see why something is Forbidden.
 */
const RBAC_KINDS: Set<string> = new Set<string>([
  "role",
  "clusterrole",
  "rolebinding",
  "clusterrolebinding",
]);

/*
 * Kinds that decide, for the whole cluster, what the API server admits and
 * serves: admission webhooks and admission policies (and their bindings)
 * accept, reject or rewrite every object written; an APIService routes a
 * whole API group to a Service; a CRD defines (and converts) a whole kind.
 * Emptying a webhook's rules, setting a policy binding to Audit or
 * repointing an APIService switches a cluster control off as surely as
 * deleting it (which NEVER_DELETE_KINDS already refuses) — the same reason
 * Pod Security Admission labels are Denied. So every write verb on these is
 * Denied; reading them stays Read.
 */
const ADMISSION_AND_API_EXTENSION_KINDS: Set<string> = new Set<string>([
  "mutatingwebhookconfiguration",
  "validatingwebhookconfiguration",
  "validatingadmissionpolicy",
  "validatingadmissionpolicybinding",
  "mutatingadmissionpolicy",
  "mutatingadmissionpolicybinding",
  "apiservice",
  "customresourcedefinition",
]);

/*
 * Kinds whose objects ARE credentials. OneUptime AI never reads, changes or
 * deletes them, in any spelling kubectl accepts (secret, secrets, Secret,
 * secrets.v1., secret/name, pods,secrets, ...): get/describe would print
 * their values to the model, and label/annotate/patch with -o yaml print the
 * whole object too, so the rule is per kind, not per verb. `all` does not
 * include secrets, so `get all` stays Read. Pods and ConfigMaps can carry
 * plaintext env values as well; those cannot be denied without blinding the
 * investigation, so output redaction covers them, not this policy.
 */
const CREDENTIAL_KINDS: Set<string> = new Set<string>(["secret"]);

/*
 * Verbs whose positionals name objects as "kind name..." or "kind/name...",
 * where CREDENTIAL_KINDS is enforced. For rollout and set the objects follow
 * the subcommand. Node verbs (cordon, drain) name nodes, logs names pods and
 * the remaining verbs take no objects, so the kind cannot appear there.
 */
const OBJECT_VERBS: Set<string> = new Set<string>([
  "get",
  "describe",
  "delete",
  "label",
  "annotate",
  "patch",
  "scale",
  "autoscale",
  "expose",
  "taint",
  "rollout",
  "set",
]);

/*
 * Kinds whose deletion is a safe change: exactly one, and only the pod. A
 * pod with a controller (ReplicaSet, StatefulSet, DaemonSet, Job) is
 * recreated by it. A Job is NOT recreated by anything — a standalone Job (a
 * migration, a one-off batch run) is simply gone, and a CronJob only starts
 * a new one on its next schedule — so deleting a Job is RiskyWrite.
 * Matched on builtinKind(), so a custom resource that happens to be called
 * `pods.example.com` is not a pod.
 */
const SAFE_DELETE_KINDS: Set<string> = new Set<string>(["pod"]);

// The workloads `kubectl rollout restart/undo/pause/resume` acts on.
const ROLLOUT_SAFE_KINDS: Set<string> = new Set<string>([
  "deployment",
  "statefulset",
  "daemonset",
]);

/*
 * The workloads a safe `kubectl scale` may target — the ones whose scale
 * subresource the kubernetes-agent chart's remediation RBAC grants.
 */
const SCALE_SAFE_KINDS: Set<string> = new Set<string>([
  "deployment",
  "statefulset",
  "replicaset",
]);

/*
 * The kinds a safe label/annotate may target: a pod or a workload. A label
 * on these is metadata a fix may need (quarantine a pod by dropping its
 * `app` label, note a restart). On any other kind a label is a control:
 * Pod Security Admission reads namespace labels, DaemonSet nodeSelectors and
 * cloud load balancers read node labels, Services and NetworkPolicies select
 * by label, ClusterRole aggregation reads role labels, and ServiceAccount /
 * Ingress annotations bind cloud identities and inject proxy config.
 */
const LABEL_SAFE_KINDS: Set<string> = new Set<string>([
  "pod",
  "deployment",
  "statefulset",
  "daemonset",
  "replicaset",
  "job",
  "cronjob",
]);

/*
 * The API group each built-in kind named in a *_SAFE_KINDS set lives in.
 * builtinKind() accepts a group-qualified spelling only in this group, so
 * `deployments.apps/web` is a Deployment while `jobs.batch.volcano.sh` or
 * `pods.example.com` is some custom resource and never a safe target.
 */
const BUILTIN_KIND_GROUPS: Record<string, string> = {
  pod: "",
  node: "",
  deployment: "apps",
  statefulset: "apps",
  daemonset: "apps",
  replicaset: "apps",
  job: "batch",
  cronjob: "batch",
};

/*
 * Kinds that live outside any namespace. A write that names only these is
 * not "in" the namespace its -n flag names (kubectl ignores -n for them), so
 * the protected-namespace rule looks at the object instead.
 */
const CLUSTER_SCOPED_KINDS: Set<string> = new Set<string>([
  "node",
  "namespace",
  "persistentvolume",
  "customresourcedefinition",
  "clusterrole",
  "clusterrolebinding",
  "storageclass",
  "priorityclass",
  "apiservice",
  "mutatingwebhookconfiguration",
  "validatingwebhookconfiguration",
  "validatingadmissionpolicy",
  "validatingadmissionpolicybinding",
  "mutatingadmissionpolicy",
  "mutatingadmissionpolicybinding",
  "certificatesigningrequest",
  "ingressclass",
  "runtimeclass",
  "csidriver",
  "csinode",
  "volumeattachment",
  "flowschema",
  "prioritylevelconfiguration",
]);

/*
 * Label / annotation key prefixes (the DNS part before "/") that belong to
 * Kubernetes itself — kubernetes.io and k8s.io and every subdomain
 * (pod-security.kubernetes.io, node-role.kubernetes.io,
 * rbac.authorization.k8s.io, kubectl.kubernetes.io, ...) — or to the
 * identity, admission and GitOps controllers that act on them. Writing one
 * of these steers a controller rather than annotating an object, so it is
 * RiskyWrite on any kind. Matched as the domain itself or a subdomain.
 */
const RESERVED_KEY_DOMAINS: Array<string> = [
  "kubernetes.io",
  "k8s.io",
  "gatekeeper.sh",
  "kyverno.io",
  "argoproj.io",
  "eks.amazonaws.com",
  "iam.gke.io",
  "azure.workload.identity",
];

/*
 * Pod Security Admission's namespace labels. Lowering or removing them lets
 * privileged pods into the namespace, which is never a fix OneUptime AI
 * makes (Denied, in label, annotate and patch alike).
 */
const POD_SECURITY_KEY_DOMAIN: string = "pod-security.kubernetes.io";

/*
 * ClusterRole aggregation: a ClusterRole labelled with one of these has its
 * rules merged into admin / edit / view (and so granted to everyone bound
 * to them). That is an RBAC grant, Denied like creating a binding.
 */
const RBAC_AGGREGATION_KEY_PREFIX: string =
  "rbac.authorization.k8s.io/aggregate-to-";

/*
 * Field names a `kubectl patch` body may never touch, matched by key name
 * (case-insensitively) anywhere in the body — strategic-merge and merge
 * patches as keys, JSON patches as path segments. Bodies are JSON only (a
 * body JSON.parse rejects is Denied outright; see findPatchBodyProblem), so
 * the walker sees exactly the keys kubectl applies. Each one
 * changes which identity, privileges, host access, Secrets or program a pod
 * runs with. With write RBAC on a workload that is the same as running any
 * image as any ServiceAccount in the namespace and reading every Secret it
 * can mount, which no approval card should be asked to wave through. Image,
 * env values, resources and replicas stay patchable (set image / set env /
 * set resources say the same thing more plainly).
 */
const POD_SECURITY_PATCH_KEYS: Set<string> = new Set<string>(
  [
    "serviceAccountName",
    "serviceAccount",
    "automountServiceAccountToken",
    "securityContext",
    "privileged",
    "capabilities",
    "hostPath",
    "hostNetwork",
    "hostPID",
    "hostIPC",
    "volumes",
    "volumeMounts",
    "initContainers",
    "ephemeralContainers",
    "command",
    "args",
    "envFrom",
    "secretKeyRef",
    "secretRef",
    "secretName",
  ].map((key: string) => {
    return key.toLowerCase();
  }),
);

/*
 * kubectl create's subcommands and their aliases, exactly as cobra matches
 * them (case-sensitively). Anything else is not a create subcommand:
 * kubectl would look for a `kubectl-create-<name>` plugin on the Runner's
 * PATH, so it is Denied rather than tiered.
 */
const CREATE_SUBCOMMANDS: Record<string, string> = {
  namespace: "namespace",
  ns: "namespace",
  quota: "resourcequota",
  resourcequota: "resourcequota",
  secret: "secret",
  configmap: "configmap",
  cm: "configmap",
  serviceaccount: "serviceaccount",
  sa: "serviceaccount",
  service: "service",
  svc: "service",
  deployment: "deployment",
  deploy: "deployment",
  clusterrole: "clusterrole",
  clusterrolebinding: "clusterrolebinding",
  role: "role",
  rolebinding: "rolebinding",
  poddisruptionbudget: "poddisruptionbudget",
  pdb: "poddisruptionbudget",
  priorityclass: "priorityclass",
  pc: "priorityclass",
  job: "job",
  cronjob: "cronjob",
  cj: "cronjob",
  ingress: "ingress",
  ing: "ingress",
  token: "token",
};

/*
 * What `kubectl create <subcommand>` makes that OneUptime AI never makes:
 * RBAC objects and ServiceAccounts decide who may do what, and a new
 * ServiceAccount is an identity for someone to bind.
 */
const DENIED_CREATE_KINDS: Set<string> = new Set<string>([
  "clusterrole",
  "clusterrolebinding",
  "role",
  "rolebinding",
  "serviceaccount",
]);

/*
 * `kubectl create` subcommands that start a NEW workload running the image
 * named in the command: kubectl requires --image for both (it refuses them
 * without one), so every such command runs an arbitrary image as a new
 * program in the cluster — Denied, like `create job --image`.
 */
const IMAGE_WORKLOAD_CREATE_KINDS: Set<string> = new Set<string>([
  "deployment",
  "cronjob",
]);

// Cluster-scoped objects `kubectl create` can make (for the namespace rule).
const CLUSTER_SCOPED_CREATE_KINDS: Set<string> = new Set<string>([
  "namespace",
  "priorityclass",
]);

/*
 * kubectl set's subcommands OneUptime AI may use (set serviceaccount and set
 * subject are Denied by name; anything else is not a set subcommand).
 */
const SET_SUBCOMMANDS: Set<string> = new Set<string>([
  "env",
  "image",
  "resources",
  "selector",
]);

const KIND_ALIASES: Record<string, string> = {
  po: "pod",
  pods: "pod",
  pod: "pod",
  jobs: "job",
  job: "job",
  cj: "cronjob",
  cronjobs: "cronjob",
  cronjob: "cronjob",
  deploy: "deployment",
  deployments: "deployment",
  deployment: "deployment",
  sts: "statefulset",
  statefulsets: "statefulset",
  statefulset: "statefulset",
  ds: "daemonset",
  daemonsets: "daemonset",
  daemonset: "daemonset",
  rs: "replicaset",
  replicasets: "replicaset",
  replicaset: "replicaset",
  rc: "replicationcontroller",
  replicationcontrollers: "replicationcontroller",
  replicationcontroller: "replicationcontroller",
  hpa: "horizontalpodautoscaler",
  horizontalpodautoscalers: "horizontalpodautoscaler",
  horizontalpodautoscaler: "horizontalpodautoscaler",
  svc: "service",
  services: "service",
  service: "service",
  ep: "endpoints",
  endpoints: "endpoints",
  cm: "configmap",
  configmaps: "configmap",
  configmap: "configmap",
  sa: "serviceaccount",
  serviceaccounts: "serviceaccount",
  serviceaccount: "serviceaccount",
  ing: "ingress",
  ingresses: "ingress",
  ingress: "ingress",
  ingressclasses: "ingressclass",
  ingressclass: "ingressclass",
  netpol: "networkpolicy",
  networkpolicies: "networkpolicy",
  networkpolicy: "networkpolicy",
  pdb: "poddisruptionbudget",
  poddisruptionbudgets: "poddisruptionbudget",
  poddisruptionbudget: "poddisruptionbudget",
  quota: "resourcequota",
  resourcequotas: "resourcequota",
  resourcequota: "resourcequota",
  limits: "limitrange",
  limitranges: "limitrange",
  limitrange: "limitrange",
  ns: "namespace",
  namespaces: "namespace",
  namespace: "namespace",
  no: "node",
  nodes: "node",
  node: "node",
  pv: "persistentvolume",
  persistentvolumes: "persistentvolume",
  persistentvolume: "persistentvolume",
  pvc: "persistentvolumeclaim",
  persistentvolumeclaims: "persistentvolumeclaim",
  persistentvolumeclaim: "persistentvolumeclaim",
  crd: "customresourcedefinition",
  crds: "customresourcedefinition",
  customresourcedefinitions: "customresourcedefinition",
  customresourcedefinition: "customresourcedefinition",
  roles: "role",
  role: "role",
  rolebindings: "rolebinding",
  rolebinding: "rolebinding",
  clusterroles: "clusterrole",
  clusterrole: "clusterrole",
  clusterrolebindings: "clusterrolebinding",
  clusterrolebinding: "clusterrolebinding",
  sc: "storageclass",
  storageclasses: "storageclass",
  storageclass: "storageclass",
  secrets: "secret",
  secret: "secret",
  pc: "priorityclass",
  priorityclasses: "priorityclass",
  priorityclass: "priorityclass",
  apiservices: "apiservice",
  apiservice: "apiservice",
  mutatingwebhookconfigurations: "mutatingwebhookconfiguration",
  mutatingwebhookconfiguration: "mutatingwebhookconfiguration",
  validatingwebhookconfigurations: "validatingwebhookconfiguration",
  validatingwebhookconfiguration: "validatingwebhookconfiguration",
  validatingadmissionpolicies: "validatingadmissionpolicy",
  validatingadmissionpolicy: "validatingadmissionpolicy",
  validatingadmissionpolicybindings: "validatingadmissionpolicybinding",
  validatingadmissionpolicybinding: "validatingadmissionpolicybinding",
  mutatingadmissionpolicies: "mutatingadmissionpolicy",
  mutatingadmissionpolicy: "mutatingadmissionpolicy",
  mutatingadmissionpolicybindings: "mutatingadmissionpolicybinding",
  mutatingadmissionpolicybinding: "mutatingadmissionpolicybinding",
  csr: "certificatesigningrequest",
  certificatesigningrequests: "certificatesigningrequest",
  certificatesigningrequest: "certificatesigningrequest",
  runtimeclasses: "runtimeclass",
  runtimeclass: "runtimeclass",
  csidrivers: "csidriver",
  csidriver: "csidriver",
  csinodes: "csinode",
  csinode: "csinode",
  volumeattachments: "volumeattachment",
  volumeattachment: "volumeattachment",
  flowschemas: "flowschema",
  flowschema: "flowschema",
  prioritylevelconfigurations: "prioritylevelconfiguration",
  prioritylevelconfiguration: "prioritylevelconfiguration",
};

interface ParsedArgs {
  positionals: Array<string>;
  flags: Map<string, Array<string>>; // name -> values (empty string for bare)
  // The first flag problem seen: a denied flag, an unknown flag or bad syntax.
  violation?: string | undefined;
}

interface FlagRule {
  arity: FlagArity;
  /*
   * Set when the flag may not be used: the tail of the reason, after "the
   * --x flag ". Parsing still uses the arity so the verb can be found and
   * named in the message.
   */
  problem?: string | undefined;
}

interface NamedKinds {
  // Normalized kinds (normalizeKind), for the deny lists.
  kinds: Set<string>;
  // Each kind as written ("deployments.apps", "po"), for builtinKind().
  rawKinds: Array<string>;
  // How many objects are named (as opposed to a bare kind meaning "all").
  namedCount: number;
  // The names, in order ("web" from both "pod web" and "pod/web").
  names: Array<string>;
}

/*
 * The kind a token names, for the DENY lists: lowercased, the head of a
 * group-qualified form ("pods.v1." / "deployments.apps" / "secrets.foo.io"
 * all keep the leading segment) mapped through KIND_ALIASES. Folding every
 * group into the built-in kind is the safe side for a deny list — a custom
 * `secrets.example.io` is refused like a Secret — and must never be used to
 * decide that something is SAFE (see builtinKind()).
 */
function normalizeKind(token: string): string {
  const lower: string = token.toLowerCase();
  const head: string = lower.split(".")[0] || lower;
  return Object.prototype.hasOwnProperty.call(KIND_ALIASES, head)
    ? KIND_ALIASES[head]!
    : head;
}

/*
 * The built-in kind a token names, for the SAFE sets — or undefined when it
 * is not one of BUILTIN_KIND_GROUPS in that kind's own API group. kubectl
 * reads "RESOURCE.GROUP" and "RESOURCE.VERSION.GROUP" (with "pods.v1." for
 * the core group), so `deployments.apps`, `deployments.v1.apps` and
 * `pods.v1.` are the built-in kinds, and `pods.example.com` or
 * `jobs.batch.volcano.sh` are custom resources.
 */
function builtinKind(token: string): string | undefined {
  const lower: string = token.toLowerCase();
  const parts: Array<string> = lower.split(".");
  const head: string = parts[0] || "";

  if (!Object.prototype.hasOwnProperty.call(KIND_ALIASES, head)) {
    return undefined;
  }

  const kind: string = KIND_ALIASES[head]!;

  if (!Object.prototype.hasOwnProperty.call(BUILTIN_KIND_GROUPS, kind)) {
    return undefined;
  }

  if (parts.length === 1) {
    return kind;
  }

  const group: string =
    parts.length === 2 ? parts[1]! : parts.slice(2).join(".");

  return group === BUILTIN_KIND_GROUPS[kind] ? kind : undefined;
}

/*
 * The kinds named by the positionals after a verb, read the way kubectl's
 * resource builder reads them: either "kind name1 name2" (the first token
 * is the kind, possibly "pod,job"; the rest are names) or "kind/name
 * kind2/name2" (every token carries its own kind). Mixing the two is an
 * error in kubectl; here it just names both kinds, which is the safe side.
 */
function namedKinds(resourceTokens: Array<string>): NamedKinds {
  const kinds: Set<string> = new Set<string>();
  const rawKinds: Array<string> = [];
  const names: Array<string> = [];
  let namedCount: number = 0;

  for (let i: number = 0; i < resourceTokens.length; i++) {
    const token: string = resourceTokens[i]!;
    if (token.includes("/")) {
      const slash: number = token.indexOf("/");
      const rawKind: string = token.slice(0, slash);
      rawKinds.push(rawKind);
      kinds.add(normalizeKind(rawKind));
      names.push(token.slice(slash + 1));
      namedCount++;
    } else if (i === 0) {
      for (const part of token.split(",")) {
        rawKinds.push(part);
        kinds.add(normalizeKind(part));
      }
    } else {
      names.push(token);
      namedCount++;
    }
  }

  return { kinds, rawKinds, namedCount, names };
}

/*
 * True when the objects are exactly ONE named object of ONE kind — the
 * shape every SafeWrite needs. A bare kind is every object of that kind to
 * kubectl's rollout verbs, and a comma list of kinds or several names is
 * several objects.
 */
function isOneNamedObject(targets: NamedKinds): boolean {
  return targets.namedCount === 1 && targets.rawKinds.length === 1;
}

// True when every kind is built in and in `allowed` (see builtinKind()).
function everyBuiltinKindIn(
  targets: NamedKinds,
  allowed: Set<string>,
): boolean {
  return (
    targets.rawKinds.length > 0 &&
    targets.rawKinds.every((rawKind: string) => {
      const kind: string | undefined = builtinKind(rawKind);
      return kind !== undefined && allowed.has(kind);
    })
  );
}

/*
 * The object tokens of a command, split the way kubectl splits positionals:
 * after the verb (and the subcommand, for rollout and set), the leading
 * tokens that are not KEY=VALUE or KEY- pairs — kubectl's
 * GetResourcesAndPairs. So `label pod web-1 app=web` names only the pod, and
 * `label pod web-1 secret/rotated=true` names no Secret.
 */
function objectTokens(verb: string, positionals: Array<string>): Array<string> {
  const start: number = verb === "rollout" || verb === "set" ? 2 : 1;
  const tokens: Array<string> = [];

  for (const token of positionals.slice(start)) {
    if (token.includes("=") || token.endsWith("-")) {
      break;
    }
    tokens.push(token);
  }

  return tokens;
}

/*
 * The label / annotation KEYS a label or annotate command writes or removes:
 * the pair tokens after the objects, "KEY=VALUE" (the key is before the
 * first "=") or "KEY-" (removal). Values are never inspected, so a reserved
 * string in a value is just text.
 */
function labelKeys(verb: string, positionals: Array<string>): Array<string> {
  const start: number = 1 + objectTokens(verb, positionals).length;
  const keys: Array<string> = [];

  for (const token of positionals.slice(start)) {
    const eq: number = token.indexOf("=");
    if (eq >= 0) {
      keys.push(token.slice(0, eq));
    } else if (token.endsWith("-")) {
      keys.push(token.slice(0, -1));
    }
  }

  return keys;
}

// The DNS prefix of a label key ("pod-security.kubernetes.io/enforce"), lowercased.
function keyDomain(key: string): string {
  const slash: number = key.indexOf("/");
  return slash >= 0 ? key.slice(0, slash).toLowerCase() : "";
}

function isDomainOrSubdomain(domain: string, of: string): boolean {
  return domain === of || domain.endsWith(`.${of}`);
}

function isReservedKey(key: string): boolean {
  const domain: string = keyDomain(key);
  return (
    domain.length > 0 &&
    RESERVED_KEY_DOMAINS.some((reserved: string) => {
      return isDomainOrSubdomain(domain, reserved);
    })
  );
}

function isPodSecurityKey(key: string): boolean {
  return isDomainOrSubdomain(keyDomain(key), POD_SECURITY_KEY_DOMAIN);
}

function isRbacAggregationKey(key: string): boolean {
  return key.toLowerCase().startsWith(RBAC_AGGREGATION_KEY_PREFIX);
}

const MAX_PATCH_BODY_DEPTH: number = 64;

/*
 * findForbiddenJsonField's answer for a body nested past
 * MAX_PATCH_BODY_DEPTH. It can never equal a field it reports, which are
 * POD_SECURITY_PATCH_KEYS and Pod Security Admission label keys.
 */
const PATCH_BODY_TOO_DEEP: string = "\0too-deep";

/*
 * Why a `kubectl patch` body may not run, or null. The body must be JSON,
 * and the JSON is walked for POD_SECURITY_PATCH_KEYS and Pod Security
 * Admission labels (keys, and the path/from of JSON-patch operations,
 * decoded, so a \u escape or a ~1 cannot hide a name).
 *
 * Why JSON only: kubectl sends a body whose first non-space byte is "{" to
 * the API server byte for byte, and decodes every other body as YAML 1.1
 * (apimachinery's yaml.ToJSON) — including a "[" body such as a JSON patch.
 * YAML honours type tags, anchors, aliases and merge keys, so `!!binary
 * c2VydmljZUFjY291bnROYW1l` is the key serviceAccountName although that
 * word appears nowhere in the text; no scan of the text can see what
 * kubectl will apply. A body that IS valid JSON decodes to the same keys
 * and paths either way: in JSON, tag, anchor and merge-key syntax can only
 * sit inside quoted strings, where YAML reads it as plain text, and a
 * repeated key keeps its last value in JSON.parse and in kubectl alike.
 * Every patch a fix needs can be written as JSON.
 */
function findPatchBodyProblem(body: string): string | null {
  let parsed: unknown = undefined;

  try {
    parsed = JSON.parse(body);
  } catch {
    return `kubectl patch with a body that is not JSON is never allowed for OneUptime AI: kubectl reads any other body as YAML, whose tags, anchors and merge keys can spell a field name that appears nowhere in the text (write the patch body as JSON, e.g. -p '{"spec":{"replicas":3}}')`;
  }

  const field: string | null = findForbiddenJsonField(parsed, 0);

  if (field === null) {
    return null;
  }

  if (field === PATCH_BODY_TOO_DEEP) {
    return `kubectl patch with a body nested more than ${MAX_PATCH_BODY_DEPTH} levels deep is never allowed for OneUptime AI (no fix needs one)`;
  }

  return isPodSecurityKey(field)
    ? `kubectl patch of ${field} is never allowed for OneUptime AI: Pod Security Admission reads these labels to decide whether privileged pods may run in a namespace`
    : `kubectl patch that touches ${field} is never allowed for OneUptime AI: it changes which identity, privileges, host access, Secrets or program a pod runs with (patch other fields, or use set image / set env / set resources)`;
}

function forbiddenFieldInName(name: string): string | null {
  if (POD_SECURITY_PATCH_KEYS.has(name.toLowerCase())) {
    return name;
  }
  if (isPodSecurityKey(name)) {
    return name;
  }
  return null;
}

// A JSON-pointer path ("/spec/template/spec/volumes/-"), segment by segment.
function forbiddenFieldInPath(path: string): string | null {
  for (const rawSegment of path.split("/")) {
    const segment: string = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    const found: string | null = forbiddenFieldInName(segment);
    if (found) {
      return found;
    }
  }
  return null;
}

function findForbiddenJsonField(value: unknown, depth: number): string | null {
  // Nesting this deep is not a patch a fix needs; refuse rather than recurse.
  if (depth > MAX_PATCH_BODY_DEPTH) {
    return PATCH_BODY_TOO_DEEP;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found: string | null = findForbiddenJsonField(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (value === null || typeof value !== "object") {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const isJsonPatchOperation: boolean = Object.prototype.hasOwnProperty.call(
    record,
    "op",
  );

  for (const [key, child] of Object.entries(record)) {
    const keyProblem: string | null = forbiddenFieldInName(key);
    if (keyProblem) {
      return keyProblem;
    }

    /*
     * Strategic-merge directives name the list they edit after the slash:
     * "$setElementOrder/volumes", "$deleteFromPrimitiveList/args".
     */
    if (key.startsWith("$") && key.includes("/")) {
      const directiveProblem: string | null = forbiddenFieldInName(
        key.slice(key.indexOf("/") + 1),
      );
      if (directiveProblem) {
        return directiveProblem;
      }
    }

    if (
      isJsonPatchOperation &&
      (key === "path" || key === "from") &&
      typeof child === "string"
    ) {
      const pathProblem: string | null = forbiddenFieldInPath(child);
      if (pathProblem) {
        return pathProblem;
      }
    }

    const found: string | null = findForbiddenJsonField(child, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

// Same bounds CommandPolicy applies to the Bash lane's allowlist.
const MAX_ALLOWLIST_PATTERNS: number = 100;
const MAX_ALLOWLIST_PATTERN_LENGTH: number = 500;

/*
 * Exported so the server's save validation and the AI page's form
 * validation hold entries to exactly the bounds matchesAllowlist reads.
 */
export const KUBECTL_ALLOWLIST_MAX_PATTERNS: number = MAX_ALLOWLIST_PATTERNS;
export const KUBECTL_ALLOWLIST_MAX_PATTERN_LENGTH: number =
  MAX_ALLOWLIST_PATTERN_LENGTH;

function isFlagToken(token: string): boolean {
  return token.startsWith("-") && token !== "-";
}

// What tokenize() says for a command (or an allowlist entry) with no verb.
const NO_VERB_MESSAGE: string = "The command names no kubectl verb.";

// An allowlist entry as matchesAllowlist reads it (see readAllowlistEntry).
interface AllowlistEntry {
  // The entry's words without the optional leading "kubectl"; set when valid.
  args?: Array<string> | undefined;
  // pflag's reading of those words; set when valid.
  parsed?: ParsedArgs | undefined;
  // Why the entry is invalid, for the person who typed it; set when invalid.
  problem?: string | undefined;
}

/*
 * Flags whose value picks WHICH objects (or namespace) a command acts on —
 * the namespace, a selector, --all, the source object of --from — so a `*`
 * in their value makes an allowlist entry broad.
 */
const WIDENING_FLAGS: Array<string> = [
  "n",
  "namespace",
  "l",
  "selector",
  "field-selector",
  "pod-selector",
  "all",
  "A",
  "all-namespaces",
  "from",
];

// For the "write the subcommand out" message.
const SUBCOMMAND_EXAMPLES: Record<string, string> = {
  rollout: "restart deployment/web -n web",
  set: "image deployment/web * -n web",
  create: "job manual-run --from=cronjob/nightly -n web",
  auth: "can-i get pods",
  top: "pod -n web",
};

function subcommandExample(verb: string): string {
  const example: string | undefined = Object.prototype.hasOwnProperty.call(
    SUBCOMMAND_EXAMPLES,
    verb,
  )
    ? SUBCOMMAND_EXAMPLES[verb]
    : undefined;
  return example ? `, as in "kubectl ${verb} ${example}"` : "";
}

function hasWildcard(token: string): boolean {
  return token.includes("*");
}

/*
 * Whether evaluateForAutoExecution can ever promote a command with this verb
 * through the allowlist: never a read (it runs anyway), and never a drain or
 * taint (it always needs a human).
 */
function allowlistMayPromote(verb: string, subcommand: string): boolean {
  if (
    READ_VERBS.has(verb) ||
    READ_COMMAND_GROUPS.has(verb) ||
    ALWAYS_HUMAN_VERBS.has(verb)
  ) {
    return false;
  }

  return !(
    verb === "rollout" &&
    (subcommand === "status" || subcommand === "history")
  );
}

/*
 * The commands whose words after the objects are UPDATES kubectl requires
 * (label, annotate, set image, and set env unless -e/--env/--from supply the
 * variables): with no update word, kubectl refuses the command outright.
 */
function readsUpdatePairs(
  verb: string,
  subcommand: string,
  flags: Map<string, Array<string>>,
): boolean {
  if (verb === "label" || verb === "annotate") {
    return true;
  }

  if (verb !== "set") {
    return false;
  }

  if (subcommand === "image") {
    return true;
  }

  return (
    subcommand === "env" &&
    !flags.has("e") &&
    !flags.has("env") &&
    !flags.has("from")
  );
}

/*
 * An update word (KEY=VALUE or KEY-) in an allowlist entry: every word it
 * matches is one too, so it can never stand for another object.
 */
function isUpdatePairToken(token: string): boolean {
  return token.includes("=") || (token.endsWith("-") && token !== "-");
}

/*
 * One pattern token against one argv token (see the allowlist section in the
 * header). A flag is matched only by the same flag spelled literally: the
 * part up to "=" must be equal, and only a value after "=" may glob. A `*`
 * never matches whitespace; whitespace runs inside a quoted token must line
 * up with whitespace in the pattern (runs are collapsed on both sides).
 */
function allowlistTokenMatches(pattern: string, token: string): boolean {
  if (isFlagToken(token) || isFlagToken(pattern)) {
    if (!isFlagToken(token) || !isFlagToken(pattern)) {
      return false;
    }

    const tokenEq: number = token.indexOf("=");
    const patternEq: number = pattern.indexOf("=");

    if (tokenEq < 0 || patternEq < 0) {
      return pattern === token;
    }

    if (pattern.slice(0, patternEq) !== token.slice(0, tokenEq)) {
      return false;
    }

    return globWithinToken(
      pattern.slice(patternEq + 1),
      token.slice(tokenEq + 1),
    );
  }

  return globWithinToken(pattern, token);
}

function globWithinToken(pattern: string, text: string): boolean {
  const patternPieces: Array<string> = pattern.trim().split(/\s+/);
  const textPieces: Array<string> = text.trim().split(/\s+/);

  if (patternPieces.length !== textPieces.length) {
    return false;
  }

  for (let i: number = 0; i < patternPieces.length; i++) {
    if (!CommandPolicy.globMatches(patternPieces[i]!, textPieces[i]!)) {
      return false;
    }
  }

  return true;
}

// A replica count kubectl scale takes: digits only.
const REPLICA_COUNT_PATTERN: RegExp = /^[0-9]+$/;

export default class KubectlPolicy {
  /*
   * Split a command line into an argv the way a POSIX shell would split it
   * for quoting purposes ONLY: single quotes, double quotes, backslash
   * escapes. No expansion, no operators, no redirection — those characters
   * stay literal inside their token. The command must fit on one line.
   */
  public static tokenize(command: string): KubectlTokenizeResult {
    const text: string = (command || "").trim();

    if (!text) {
      return { errorMessage: "Empty command." };
    }

    if (text.length > MAX_COMMAND_LENGTH_CHARS) {
      return {
        errorMessage: `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
      };
    }

    if (text.includes("\n") || text.includes("\r") || text.includes("\0")) {
      return { errorMessage: "A kubectl command must be a single line." };
    }

    const args: Array<string> = [];
    let current: string = "";
    let inSingle: boolean = false;
    let inDouble: boolean = false;
    let hasToken: boolean = false;

    for (let i: number = 0; i < text.length; i++) {
      const ch: string = text[i]!;

      if (inSingle) {
        if (ch === "'") {
          inSingle = false;
        } else {
          current += ch;
        }
        continue;
      }

      if (inDouble) {
        if (ch === '"') {
          inDouble = false;
        } else if (ch === "\\" && i + 1 < text.length) {
          const next: string = text[i + 1]!;
          if (next === '"' || next === "\\") {
            current += next;
            i++;
          } else {
            current += ch;
          }
        } else {
          current += ch;
        }
        continue;
      }

      if (ch === "'") {
        inSingle = true;
        hasToken = true;
        continue;
      }

      if (ch === '"') {
        inDouble = true;
        hasToken = true;
        continue;
      }

      if (ch === "\\" && i + 1 < text.length) {
        current += text[i + 1];
        hasToken = true;
        i++;
        continue;
      }

      if (ch === " " || ch === "\t") {
        if (hasToken) {
          args.push(current);
          current = "";
          hasToken = false;
        }
        continue;
      }

      current += ch;
      hasToken = true;
    }

    if (inSingle || inDouble) {
      return { errorMessage: "Unbalanced quotes in the command." };
    }

    if (hasToken) {
      args.push(current);
    }

    if (args.length === 0) {
      return { errorMessage: "Empty command." };
    }

    if (args.length > MAX_TOKENS) {
      return {
        errorMessage: `A kubectl command may have at most ${MAX_TOKENS} arguments.`,
      };
    }

    // The model may or may not write the binary name; the Runner adds it.
    if (args[0]!.toLowerCase() === "kubectl") {
      args.shift();
    }

    if (args.length === 0) {
      return { errorMessage: NO_VERB_MESSAGE };
    }

    return { args };
  }

  // Tokenize, then evaluate.
  public static evaluateCommand(command: string): KubectlPolicyResult {
    const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);

    if (!tokenized.args) {
      return {
        tier: KubectlCommandTier.Denied,
        reason: tokenized.errorMessage || "Could not parse the command.",
        args: [],
        verb: "",
        displayCommand: (command || "").trim().slice(0, 200),
      };
    }

    return KubectlPolicy.evaluateArgs(tokenized.args);
  }

  /*
   * The evaluation proper, on an argv. The Runner calls this on the argv it
   * received so its verdict never depends on re-tokenizing a string the
   * same way the server did.
   */
  public static evaluateArgs(rawArgs: Array<string>): KubectlPolicyResult {
    const args: Array<string> = (rawArgs || []).filter((arg: unknown) => {
      return typeof arg === "string";
    });

    const displayCommand: string = KubectlPolicy.renderDisplayCommand(args);

    const deny: (reason: string, verb?: string) => KubectlPolicyResult = (
      reason: string,
      verb: string = "",
    ): KubectlPolicyResult => {
      return {
        tier: KubectlCommandTier.Denied,
        reason,
        args,
        verb,
        displayCommand,
      };
    };

    if (args.length === 0) {
      return deny(NO_VERB_MESSAGE);
    }

    if (args.length > MAX_TOKENS) {
      return deny(
        `A kubectl command may have at most ${MAX_TOKENS} arguments.`,
      );
    }

    for (const arg of args) {
      if (arg.includes("\n") || arg.includes("\r") || arg.includes("\0")) {
        return deny("Arguments may not contain line breaks.");
      }
    }

    const parsed: ParsedArgs = KubectlPolicy.parseArgs(args);

    const rawVerb: string = parsed.positionals[0] || "";
    const verb: string = rawVerb.toLowerCase();

    // A denied verb is the most useful thing to say, whatever its flags.
    if (DENIED_VERBS.has(verb)) {
      return deny(`kubectl ${verb} is not allowed for OneUptime AI`, verb);
    }

    // Credential / cluster-selection / file / unknown flags: never.
    if (parsed.violation) {
      return deny(parsed.violation);
    }

    if (!verb) {
      return deny(NO_VERB_MESSAGE);
    }

    /*
     * cobra matches commands case-sensitively: "Get" is not the get command,
     * and kubectl would look for a kubectl-Get plugin on the Runner's PATH
     * and run it. The same holds one level down for subcommands.
     */
    if (rawVerb !== verb) {
      return deny(
        `kubectl matches commands case-sensitively, so "${rawVerb}" is not kubectl ${verb}: kubectl would look for a kubectl-${rawVerb} plugin on the Runner (write the verb in lowercase)`,
        verb,
      );
    }

    const rawSubcommand: string = parsed.positionals[1] || "";
    const subcommand: string = rawSubcommand.toLowerCase();

    if (SUBCOMMAND_VERBS.has(verb) && rawSubcommand !== subcommand) {
      return deny(
        `kubectl matches commands case-sensitively, so "${rawSubcommand}" is not the kubectl ${verb} ${subcommand} command (write the subcommand in lowercase)`,
        `${verb} ${subcommand}`,
      );
    }

    const streamingProblem: string | null = KubectlPolicy.findStreamingFlag(
      parsed.flags,
    );

    if (streamingProblem) {
      return deny(streamingProblem);
    }

    const outputProblem: string | null = KubectlPolicy.findOutputFormatProblem(
      parsed.flags,
    );

    if (outputProblem) {
      return deny(outputProblem);
    }

    /*
     * The namespace, resolved from -n / --namespace in every spelling
     * parseArgs accepts (-n X, -nX, -n=X, --namespace X, --namespace=X).
     * pflag keeps the LAST value of a repeated flag, so `-n web ... -n
     * kube-system` would run in kube-system while a reader (or an allowlist
     * pattern) saw web first: a namespace set twice is refused outright.
     */
    const namespaceValues: Array<string> = [
      ...(parsed.flags.get("n") || []),
      ...(parsed.flags.get("namespace") || []),
    ];

    if (namespaceValues.length > 1) {
      return deny(
        `the namespace is set more than once (${namespaceValues
          .map((value: string) => {
            return `"${value}"`;
          })
          .join(", ")}); kubectl silently uses the last one, so set -n once`,
        verb,
      );
    }

    const namespace: string | undefined = namespaceValues[0];

    const hasAllNamespaces: boolean =
      parsed.flags.has("A") || parsed.flags.has("all-namespaces");
    const hasAll: boolean = parsed.flags.has("all");
    /*
     * A field selector selects exactly like a label selector (kubectl's
     * builder visits every match), so for a write both are "a selector".
     */
    const hasSelector: boolean =
      parsed.flags.has("l") ||
      parsed.flags.has("selector") ||
      parsed.flags.has("field-selector");
    const hasForce: boolean = parsed.flags.has("force");

    /*
     * The objects a write names: after the verb for delete, after the
     * verb's object tokens for the other object verbs (after the
     * subcommand for rollout and set), and none for node verbs and create.
     */
    const targets: NamedKinds =
      verb === "delete"
        ? namedKinds(parsed.positionals.slice(1))
        : OBJECT_VERBS.has(verb)
          ? namedKinds(objectTokens(verb, parsed.positionals))
          : namedKinds([]);

    const createKind: string | undefined =
      verb === "create" &&
      Object.prototype.hasOwnProperty.call(CREATE_SUBCOMMANDS, rawSubcommand)
        ? CREATE_SUBCOMMANDS[rawSubcommand]
        : undefined;

    /*
     * Where a write lands, for the protected-namespace rule. Nodes and the
     * other cluster-scoped kinds have no namespace (kubectl ignores -n for
     * them); what could be protected there is a Namespace object itself.
     */
    const isClusterScopedWrite: boolean =
      NODE_VERBS.has(verb) ||
      (createKind !== undefined &&
        CLUSTER_SCOPED_CREATE_KINDS.has(createKind)) ||
      (targets.kinds.size > 0 &&
        Array.from(targets.kinds).every((kind: string) => {
          return CLUSTER_SCOPED_KINDS.has(kind);
        }));

    let protectedNamespace: string | undefined = undefined;

    if (!isClusterScopedWrite && isProtectedKubernetesNamespace(namespace)) {
      protectedNamespace = namespace!.trim().toLowerCase();
    } else if (targets.kinds.has("namespace")) {
      const protectedObject: string | undefined = targets.names.find(
        (name: string) => {
          return isProtectedKubernetesNamespace(name);
        },
      );
      protectedNamespace = protectedObject
        ? protectedObject.trim().toLowerCase()
        : undefined;
    }

    /*
     * The result for a command that may run. A write that lands in (or
     * targets) a protected namespace is lifted from SafeWrite to RiskyWrite
     * and marked, and a drain or taint is marked too, so
     * evaluateForAutoExecution never runs either unattended.
     */
    const allowed: (
      tier: KubectlCommandTier,
      reason: string,
      verbLabel: string,
    ) => KubectlPolicyResult = (
      tier: KubectlCommandTier,
      reason: string,
      verbLabel: string,
    ): KubectlPolicyResult => {
      const result: KubectlPolicyResult = {
        tier,
        reason,
        args,
        verb: verbLabel,
        displayCommand,
      };

      if (namespace !== undefined) {
        result.namespace = namespace;
      }

      if (tier === KubectlCommandTier.Read) {
        return result;
      }

      if (ALWAYS_HUMAN_VERBS.has(verb)) {
        result.requiresHuman = true;
        result.reason =
          verb === "drain"
            ? "kubectl drain evicts every pod on the node, in every namespace (kube-system and the OneUptime agent's own included), so a human always approves it"
            : "kubectl taint decides which pods a node keeps, in every namespace (kube-system and the OneUptime agent's own included; a NoExecute taint evicts the rest at once), so a human always approves it";
      }

      if (!protectedNamespace) {
        return result;
      }

      result.protectedNamespace = protectedNamespace;

      if (tier === KubectlCommandTier.SafeWrite) {
        result.tier = KubectlCommandTier.RiskyWrite;
        result.reason = `${reason}, but it changes the protected namespace ${protectedNamespace}, so a human must approve it`;
      } else {
        result.reason = `${reason}; it changes the protected namespace ${protectedNamespace}, which always needs a human`;
      }

      return result;
    };

    // Kinds for messages: normalized for labels, as written for "not a ...".
    const kindList: string = Array.from(targets.kinds).join(",");
    const writtenKindList: string = targets.rawKinds.join(",");

    // ---- Credentials -----------------------------------------------------

    if (OBJECT_VERBS.has(verb)) {
      for (const kind of targets.kinds) {
        if (CREDENTIAL_KINDS.has(kind)) {
          return deny(
            `kubectl ${verb} on Secret objects is never allowed for OneUptime AI: it never reads, changes or deletes Secrets, whose values would otherwise reach the model and the job record (describe the workload that uses the Secret instead)`,
            `${verb} ${kind}`,
          );
        }
      }
    }

    if (verb === "create") {
      // `create token` mints a ServiceAccount token and prints it.
      if (subcommand === "token") {
        return deny(
          "kubectl create token mints a credential and prints it; OneUptime AI never handles credentials",
          "create token",
        );
      }

      if (normalizeKind(subcommand) === "secret") {
        return deny(
          "kubectl create secret is never allowed for OneUptime AI: it would put credential values in the command, the approval card and the job record (OneUptime AI never handles credentials)",
          "create secret",
        );
      }

      const deniedCreateKind: string | undefined =
        createKind && DENIED_CREATE_KINDS.has(createKind)
          ? createKind
          : RBAC_KINDS.has(normalizeKind(subcommand))
            ? normalizeKind(subcommand)
            : undefined;

      if (deniedCreateKind) {
        return deny(
          `kubectl create ${subcommand} is never allowed for OneUptime AI: roles, role bindings and ServiceAccounts decide who may do what in the cluster, and creating one is a privilege grant, not a fix (a human makes RBAC changes)`,
          `create ${deniedCreateKind}`,
        );
      }

      if (!createKind) {
        return deny(
          `kubectl create ${rawSubcommand || "(missing subcommand)"} is not a kubectl create subcommand OneUptime AI may run (for a word it does not know, kubectl would look for a kubectl-create-${rawSubcommand || "<name>"} plugin on the Runner and run it)`,
          `create ${subcommand}`,
        );
      }

      if (IMAGE_WORKLOAD_CREATE_KINDS.has(createKind)) {
        return deny(
          `kubectl create ${createKind} starts a new workload running the image named in its --image flag (kubectl requires one): a new program in the cluster, not a fix. OneUptime AI changes existing workloads (set image, rollout undo) and re-runs an existing CronJob with kubectl create job NAME --from=cronjob/NAME`,
          `create ${createKind}`,
        );
      }

      if (createKind === "job") {
        if (parsed.flags.has("image")) {
          return deny(
            "kubectl create job --image runs an arbitrary image in the cluster; OneUptime AI only re-runs an existing CronJob: kubectl create job NAME --from=cronjob/NAME",
            "create job",
          );
        }

        const fromValues: Array<string> = parsed.flags.get("from") || [];
        const from: string = fromValues.length === 1 ? fromValues[0]! : "";
        const slash: number = from.indexOf("/");
        const fromName: string = slash > 0 ? from.slice(slash + 1) : "";
        const isCronJobRef: boolean =
          slash > 0 &&
          builtinKind(from.slice(0, slash)) === "cronjob" &&
          fromName.length > 0 &&
          !fromName.includes("/");

        if (!isCronJobRef) {
          return deny(
            "kubectl create job may only re-run an existing CronJob: kubectl create job NAME --from=cronjob/NAME",
            "create job",
          );
        }

        if (parsed.positionals.length > 3) {
          return deny(
            "kubectl create job --from=cronjob/NAME takes one job NAME and no command (the CronJob's own spec runs)",
            "create job",
          );
        }
      }
    }

    if (verb === "set") {
      if (subcommand === "serviceaccount" || subcommand === "sa") {
        return deny(
          "kubectl set serviceaccount is never allowed for OneUptime AI: it changes the identity a workload's pods run as, and with it every permission and Secret they can reach",
          "set serviceaccount",
        );
      }

      if (subcommand === "subject") {
        return deny(
          "kubectl set subject is never allowed for OneUptime AI: adding users, groups or ServiceAccounts to a role binding is a privilege grant, not a fix",
          "set subject",
        );
      }

      if (!SET_SUBCOMMANDS.has(subcommand)) {
        return deny(
          `kubectl set ${rawSubcommand || "(missing subcommand)"} is not allowed`,
          `set ${subcommand}`,
        );
      }

      if (subcommand === "env") {
        for (const from of parsed.flags.get("from") || []) {
          if (CREDENTIAL_KINDS.has(normalizeKind(from.split("/")[0] || ""))) {
            return deny(
              "kubectl set env --from=secret/... wires a Secret's keys into the workload's environment; OneUptime AI never attaches Secrets to workloads (set plain values, or --from=configmap/...)",
              "set env",
            );
          }
        }
      }
    }

    // ---- Read tier -------------------------------------------------------

    if (READ_VERBS.has(verb)) {
      return allowed(
        KubectlCommandTier.Read,
        `kubectl ${verb} only reads the cluster`,
        verb,
      );
    }

    if (verb === "cluster-info") {
      if (subcommand === "dump") {
        return deny(
          "kubectl cluster-info dump exports the whole cluster; inspect specific resources instead",
          "cluster-info dump",
        );
      }
      return allowed(
        KubectlCommandTier.Read,
        "kubectl cluster-info only reads the cluster",
        verb,
      );
    }

    if (verb === "auth") {
      if (subcommand === "can-i" || subcommand === "whoami") {
        return allowed(
          KubectlCommandTier.Read,
          `kubectl auth ${subcommand} only reads the cluster`,
          `auth ${subcommand}`,
        );
      }
      return deny(
        `kubectl auth ${subcommand || "(missing subcommand)"} is not allowed`,
        `auth ${subcommand}`,
      );
    }

    if (
      verb === "rollout" &&
      (subcommand === "status" || subcommand === "history")
    ) {
      return allowed(
        KubectlCommandTier.Read,
        `kubectl rollout ${subcommand} only reads the cluster`,
        `rollout ${subcommand}`,
      );
    }

    // ---- Write tiers -----------------------------------------------------

    if (hasAllNamespaces) {
      const label: string = verb === "rollout" ? `rollout ${subcommand}` : verb;
      return deny(
        `kubectl ${label} across all namespaces is not allowed`,
        label,
      );
    }

    /*
     * A ClusterRole aggregation label names the grant it makes, so the
     * refusal names it too. Aggregation reads labels only; the same key as
     * an annotation is refused as a plain RBAC write below.
     */
    const clusterRoleAggregationKey: string | undefined =
      verb === "label" && targets.kinds.has("clusterrole")
        ? labelKeys(verb, parsed.positionals).find(isRbacAggregationKey)
        : undefined;

    if (OBJECT_VERBS.has(verb)) {
      for (const kind of targets.kinds) {
        if (RESOURCE_CATEGORIES.has(kind)) {
          return deny(
            `kubectl ${verb} on the resource category "${kind}" is never allowed for OneUptime AI: kubectl expands a category into every kind in it (api-extensions alone covers CRDs, APIServices and admission webhooks), so name the kind instead`,
            `${verb} ${kind}`,
          );
        }

        // Deleting these is refused by NEVER_DELETE_KINDS, with its own reason.
        if (verb === "delete") {
          continue;
        }

        if (RBAC_KINDS.has(kind)) {
          if (clusterRoleAggregationKey) {
            return deny(
              `kubectl ${verb} of ${clusterRoleAggregationKey} on a ClusterRole is never allowed for OneUptime AI: it merges the role's rules into admin/edit/view and so grants them to everyone bound to those, a privilege grant, not a fix`,
              `${verb} clusterrole`,
            );
          }

          return deny(
            `kubectl ${verb} on ${kind} objects is never allowed for OneUptime AI: roles and role bindings decide who may do what in the cluster, and changing them is a privilege grant, not a fix (a human makes RBAC changes)`,
            `${verb} ${kind}`,
          );
        }

        if (ADMISSION_AND_API_EXTENSION_KINDS.has(kind)) {
          return deny(
            `kubectl ${verb} on ${kind} objects is never allowed for OneUptime AI: admission webhooks and policies, APIServices and CRDs decide what the API server admits and serves for the whole cluster, and changing one can switch a cluster control off as surely as deleting it (a human makes that change)`,
            `${verb} ${kind}`,
          );
        }
      }
    }

    if (verb === "rollout") {
      const rolloutVerb: string = `rollout ${subcommand}`;

      if (
        subcommand !== "restart" &&
        subcommand !== "undo" &&
        subcommand !== "pause" &&
        subcommand !== "resume"
      ) {
        return deny(
          `kubectl rollout ${subcommand || "(missing subcommand)"} is not allowed`,
          rolloutVerb,
        );
      }

      if (hasSelector || hasAll) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl ${rolloutVerb} with a selector or --all touches many workloads at once`,
          rolloutVerb,
        );
      }

      if (targets.namedCount === 0) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl ${rolloutVerb} names no workload, and kubectl reads a bare kind as every ${kindList || "workload"} in the namespace (name one: TYPE/NAME)`,
          rolloutVerb,
        );
      }

      if (!isOneNamedObject(targets)) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl ${rolloutVerb} names several workloads at once`,
          rolloutVerb,
        );
      }

      if (!everyBuiltinKindIn(targets, ROLLOUT_SAFE_KINDS)) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl ${rolloutVerb} on ${writtenKindList} is not a Deployment, StatefulSet or DaemonSet rollout`,
          rolloutVerb,
        );
      }

      return allowed(
        KubectlCommandTier.SafeWrite,
        `kubectl ${rolloutVerb} of one named workload is a controller-managed, reversible change`,
        rolloutVerb,
      );
    }

    if (verb === "delete") {
      if (hasAll) {
        return deny("kubectl delete --all is not allowed", "delete");
      }

      if (parsed.positionals.length < 2) {
        return deny("kubectl delete needs a resource kind and name", "delete");
      }

      for (const kind of targets.kinds) {
        if (NEVER_DELETE_KINDS.has(kind)) {
          return deny(
            `deleting ${kind} objects is never allowed for OneUptime AI`,
            "delete " + kind,
          );
        }
      }

      const verbLabel: string = `delete ${kindList}`;

      if (targets.namedCount === 0 && !hasSelector) {
        return deny(
          "kubectl delete needs the name of the object to delete (or a selector, which needs approval)",
          verbLabel,
        );
      }

      if (
        !hasSelector &&
        !hasForce &&
        isOneNamedObject(targets) &&
        everyBuiltinKindIn(targets, SAFE_DELETE_KINDS)
      ) {
        return allowed(
          KubectlCommandTier.SafeWrite,
          "deleting one named pod is a bounded change: its controller recreates it",
          verbLabel,
        );
      }

      return allowed(
        KubectlCommandTier.RiskyWrite,
        hasForce
          ? "force-deleting skips graceful termination"
          : hasSelector
            ? "deleting by selector can remove many objects at once"
            : targets.namedCount > 1
              ? "deleting several objects at once"
              : targets.kinds.has("job")
                ? "a deleted Job is gone for good: no controller recreates it"
                : `deleting ${writtenKindList} objects changes what is deployed`,
        verbLabel,
      );
    }

    if (verb === "scale") {
      if (hasAll || hasSelector) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          "kubectl scale with a selector or --all touches many objects at once",
          verb,
        );
      }

      const replicas: Array<string> = parsed.flags.get("replicas") || [];

      if (replicas.length === 0) {
        return deny("kubectl scale needs --replicas", verb);
      }

      if (!isOneNamedObject(targets)) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          "kubectl scale names several workloads (or none) at once",
          verb,
        );
      }

      if (!everyBuiltinKindIn(targets, SCALE_SAFE_KINDS)) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl scale of ${writtenKindList} is not a safe change (only a Deployment, StatefulSet or ReplicaSet is)`,
          verb,
        );
      }

      for (const value of replicas) {
        const count: string = value.trim();
        if (!REPLICA_COUNT_PATTERN.test(count)) {
          return allowed(
            KubectlCommandTier.RiskyWrite,
            `--replicas=${value} is not a replica count kubectl scale can apply safely`,
            verb,
          );
        }
        if (parseInt(count, 10) === 0) {
          return allowed(
            KubectlCommandTier.RiskyWrite,
            "scaling to zero replicas stops the workload: an outage, not a reversible nudge",
            verb,
          );
        }
      }

      return allowed(
        KubectlCommandTier.SafeWrite,
        "kubectl scale of one named workload to a non-zero count is a reversible change",
        verb,
      );
    }

    if (verb === "cordon" || verb === "uncordon") {
      if (hasAll || hasSelector) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl ${verb} with a selector or --all touches many nodes at once`,
          verb,
        );
      }

      const nodes: Array<string> = parsed.positionals.slice(1);
      const node: string = nodes[0] || "";
      const namesOneNode: boolean =
        nodes.length === 1 &&
        (!node.includes("/") ||
          builtinKind(node.slice(0, node.indexOf("/"))) === "node");

      if (!namesOneNode) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl ${verb} of anything but one named node touches several nodes (or none) at once`,
          verb,
        );
      }

      return allowed(
        KubectlCommandTier.SafeWrite,
        `kubectl ${verb} of one node is a reversible change`,
        verb,
      );
    }

    if (verb === "label" || verb === "annotate") {
      const keys: Array<string> = labelKeys(verb, parsed.positionals);

      if (targets.kinds.has("namespace")) {
        const podSecurityKey: string | undefined = keys.find(isPodSecurityKey);
        if (podSecurityKey) {
          return deny(
            `kubectl ${verb} of ${podSecurityKey} on a namespace is never allowed for OneUptime AI: pod-security.kubernetes.io keys are Pod Security Admission's controls, which decide whether privileged pods may run there`,
            `${verb} namespace`,
          );
        }
      }

      if (hasAll || hasSelector) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl ${verb} with a selector or --all touches many objects at once`,
          verb,
        );
      }

      if (!isOneNamedObject(targets)) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `kubectl ${verb} names several objects (or none) at once`,
          verb,
        );
      }

      if (!everyBuiltinKindIn(targets, LABEL_SAFE_KINDS)) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `${verb === "label" ? "labels" : "annotations"} on ${writtenKindList} can steer admission, scheduling, identity or traffic (only a pod or workload is a safe target)`,
          verb,
        );
      }

      const reservedKey: string | undefined = keys.find(isReservedKey);

      if (reservedKey) {
        return allowed(
          KubectlCommandTier.RiskyWrite,
          `${reservedKey} is a key Kubernetes or a cluster controller acts on, not a plain ${verb === "label" ? "label" : "annotation"}`,
          verb,
        );
      }

      return allowed(
        KubectlCommandTier.SafeWrite,
        `kubectl ${verb} of one named pod or workload is a reversible change`,
        verb,
      );
    }

    if (verb === "patch") {
      const bodies: Array<string> = [
        ...(parsed.flags.get("p") || []),
        ...(parsed.flags.get("patch") || []),
      ];

      for (const body of bodies) {
        const problem: string | null = findPatchBodyProblem(body);
        if (problem) {
          return deny(problem, "patch");
        }
      }
    }

    if (RISKY_WRITE_VERBS.has(verb)) {
      const verbLabel: string =
        verb === "set" || verb === "create" ? `${verb} ${subcommand}` : verb;
      return allowed(
        KubectlCommandTier.RiskyWrite,
        `kubectl ${verbLabel} can change what is deployed or affect many pods, so a human must approve it`,
        verbLabel,
      );
    }

    return deny(
      `kubectl ${verb} is not a command OneUptime AI may run (for a word it does not know, kubectl would look for a kubectl-${verb} plugin on the Runner and run it)`,
      verb,
    );
  }

  /*
   * The remediation verdict for one command under a cluster's settings.
   * Read and SafeWrite auto-approve; RiskyWrite auto-approves only when the
   * cluster bypasses approvals or the operator allowlisted its exact shape
   * (matchesAllowlist: token by token, see the allowlist section in the
   * header); Denied stays Denied; and a write in a protected namespace, a
   * node drain and a taint always need a human. Suggest mode never consults
   * this — everything there is RequiresApproval by construction.
   */
  public static evaluateForAutoExecution(data: {
    command: string;
    allowlistPatterns: Array<string>;
    /*
     * The cluster's operator chose to never be asked: RiskyWrite auto-approves
     * too. Denied stays Denied — that tier is what "even with approval"
     * means, and bypassing approval cannot grant more than approval would.
     * Nor does it reach a protected namespace (kube-system and friends), a
     * drain or a taint.
     */
    bypassApproval?: boolean | undefined;
  }): KubectlAutoExecutionVerdict {
    const result: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
      data.command,
    );

    if (result.tier === KubectlCommandTier.Denied) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.Denied,
        tier: result.tier,
        reason: `Denied by the kubectl command policy: ${result.reason}. This command cannot run even with human approval.`,
      };
    }

    if (result.tier === KubectlCommandTier.Read) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        tier: result.tier,
        reason: result.reason,
      };
    }

    /*
     * Before SafeWrite, bypass and the allowlist: nothing an operator set on
     * the cluster lets OneUptime AI change kube-system on its own.
     */
    if (result.protectedNamespace) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        tier: result.tier,
        reason: `Requires human approval: ${result.reason}. Neither bypassing approvals nor the cluster's allowlist applies in ${result.protectedNamespace}.`,
        requiresHuman: true,
      };
    }

    // Nor does anything let it drain or taint a node on its own.
    if (result.requiresHuman) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        tier: result.tier,
        reason: `Requires human approval: ${result.reason}. Neither bypassing approvals nor the cluster's allowlist applies to a node drain or taint.`,
        requiresHuman: true,
      };
    }

    if (result.tier === KubectlCommandTier.SafeWrite) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        tier: result.tier,
        reason: result.reason,
      };
    }

    if (data.bypassApproval === true) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        tier: result.tier,
        reason: `Riskier change (${result.reason}) allowed without approval: the cluster bypasses approvals.`,
      };
    }

    if (
      KubectlPolicy.matchesAllowlist({
        args: result.args,
        allowlistPatterns: data.allowlistPatterns,
      })
    ) {
      return {
        verdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        tier: result.tier,
        reason: "Matched the cluster's kubectl allowlist.",
      };
    }

    return {
      verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      tier: result.tier,
      reason: `Requires human approval: ${result.reason}.`,
    };
  }

  /*
   * Whether a cluster allowlist pattern names this argv (without the
   * leading "kubectl"), token by token — the semantics are spelled out in
   * the allowlist section of the header. Tier-blind on purpose: callers
   * (evaluateForAutoExecution) decide which tiers the allowlist may promote.
   */
  public static matchesAllowlist(data: {
    args: Array<string>;
    allowlistPatterns: Array<string>;
  }): boolean {
    const args: Array<string> = (data.args || []).filter((arg: unknown) => {
      return typeof arg === "string";
    });

    if (args.length === 0) {
      return false;
    }

    const patterns: Array<string> = (data.allowlistPatterns || [])
      .filter((pattern: unknown) => {
        return typeof pattern === "string" && pattern.trim().length > 0;
      })
      .slice(0, MAX_ALLOWLIST_PATTERNS);

    for (const pattern of patterns) {
      /*
       * An entry describeAllowlistPatternProblem refuses is skipped, so what
       * the matcher reads and what the server and the AI page accept are
       * one set — including an entry stored before a rule was added.
       */
      const patternArgs: Array<string> | undefined =
        KubectlPolicy.readAllowlistEntry(pattern).args;

      if (!patternArgs || patternArgs.length !== args.length) {
        continue;
      }

      const matches: boolean = patternArgs.every(
        (patternToken: string, index: number) => {
          return allowlistTokenMatches(patternToken, args[index]!);
        },
      );

      if (matches) {
        return true;
      }
    }

    return false;
  }

  /*
   * Why an allowlist entry cannot work, in words for the person typing it —
   * or null when it is valid. This is the ONE definition of a valid entry
   * (see the allowlist section of the header): the server validates saves
   * with it, the AI page validates its form with it, and matchesAllowlist
   * skips every entry it refuses, so no entry is stored that the matcher
   * would silently ignore. (The entry count is checked by the callers
   * against KUBECTL_ALLOWLIST_MAX_PATTERNS.)
   */
  public static describeAllowlistPatternProblem(
    pattern: unknown,
  ): string | null {
    return KubectlPolicy.readAllowlistEntry(pattern).problem || null;
  }

  /*
   * Does this allowlist entry pre-approve riskier changes beyond the objects
   * it names? True when a `*` stands for the namespace, for an object the
   * command acts on, or for a selector or --from source — see the allowlist
   * section of the header. The AI page asks for an explicit confirmation
   * before saving a broad entry.
   *
   * The entry is read with the policy's own tokenizer and flag parser, the
   * way matchesAllowlist reads it (a leading "kubectl" is dropped once, in
   * any case), so every spelling of -n (`-n *`, `-n=*`, `--namespace=*`, a
   * cluster such as `-An *`) is seen, and a value flag's `*` (`-p *`,
   * `--replicas *`) is never mistaken for an object. An invalid entry is
   * never broad: it is refused before anyone could be asked to confirm it.
   */
  public static isBroadAllowlistPattern(pattern: unknown): boolean {
    const entry: AllowlistEntry = KubectlPolicy.readAllowlistEntry(pattern);

    if (!entry.parsed) {
      return false;
    }

    const parsed: ParsedArgs = entry.parsed;
    const verb: string = parsed.positionals[0] || "";
    const subcommand: string = parsed.positionals[1] || "";

    // Reads, drains and taints are never promoted: the entry pre-approves nothing.
    if (!allowlistMayPromote(verb, subcommand)) {
      return false;
    }

    for (const flag of WIDENING_FLAGS) {
      for (const value of parsed.flags.get(flag) || []) {
        if (value.includes("*")) {
          return true;
        }
      }
    }

    // A wildcard in create's positionals names the NEW object, not an existing one.
    if (verb === "create") {
      return false;
    }

    let operands: Array<string> = parsed.positionals.slice(
      SUBCOMMAND_VERBS.has(verb) ? 2 : 1,
    );

    // kubectl set selector reads its LAST word as the selector expression.
    if (verb === "set" && subcommand === "selector") {
      operands = operands.slice(0, -1);
    }

    if (!readsUpdatePairs(verb, subcommand, parsed.flags)) {
      return operands.some(hasWildcard);
    }

    /*
     * label, annotate, set image and set env read their operands the way
     * kubectl's GetResourcesAndPairs does: objects first, then the updates
     * (KEY=VALUE or KEY-), and an object after an update is an error. So a
     * wildcard can stand for an object only before the first update, and
     * only when another word follows it: a wildcard that is the LAST word
     * is read either as the update or as one more object with no update at
     * all, which kubectl refuses ("at least one ... update is required").
     */
    for (let i: number = 0; i < operands.length; i++) {
      const operand: string = operands[i]!;

      if (isUpdatePairToken(operand)) {
        return false;
      }

      if (hasWildcard(operand) && i < operands.length - 1) {
        return true;
      }
    }

    return false;
  }

  /*
   * An allowlist entry read the way matchesAllowlist reads it: its argv
   * (the optional leading "kubectl" dropped by tokenize) and its parse when
   * it is valid, or the problem that makes it invalid.
   */
  private static readAllowlistEntry(pattern: unknown): AllowlistEntry {
    if (typeof pattern !== "string" || pattern.trim().length === 0) {
      return { problem: "An allowlist entry cannot be blank." };
    }

    if (pattern.length > MAX_ALLOWLIST_PATTERN_LENGTH) {
      return {
        problem: `An allowlist entry can be at most ${MAX_ALLOWLIST_PATTERN_LENGTH} characters long.`,
      };
    }

    const shown: string = pattern.trim();
    const namesNoCommand: string = `"${shown}" names no kubectl command: write out the command it pre-approves, such as "kubectl set image deployment/web * -n web".`;
    const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(pattern);

    if (!tokenized.args) {
      return {
        problem:
          tokenized.errorMessage === NO_VERB_MESSAGE
            ? namesNoCommand
            : `"${shown}" cannot be read as one kubectl command: ${
                tokenized.errorMessage || "it could not be split into words."
              }`,
      };
    }

    const parsed: ParsedArgs = KubectlPolicy.parseArgs(tokenized.args);
    const verb: string | undefined = parsed.positionals[0];

    if (verb === undefined) {
      return { problem: namesNoCommand };
    }

    if (hasWildcard(verb)) {
      return {
        problem: `"${shown}" has a * where the kubectl verb goes. A * stands for exactly one word, and the first word is the verb (the leading "kubectl" is optional and never needs a wildcard), so write the verb out, as in "kubectl set image deployment/web * -n web".`,
      };
    }

    if (verb !== verb.toLowerCase()) {
      return {
        problem: `"${shown}" can never match a command that runs: kubectl matches commands case-sensitively, so "${verb}" is not kubectl ${verb.toLowerCase()} (write the verb in lowercase).`,
      };
    }

    if (!isVerbOneUptimeAiMayRun(verb)) {
      return {
        problem: `"${shown}" can never match a command that runs: kubectl ${verb} is not a command OneUptime AI may run.`,
      };
    }

    if (SUBCOMMAND_VERBS.has(verb)) {
      const subcommand: string | undefined = parsed.positionals[1];

      if (subcommand === undefined) {
        if (SUBCOMMAND_REQUIRED_VERBS.has(verb)) {
          return {
            problem: `"${shown}" names no kubectl ${verb} subcommand: write it out${subcommandExample(verb)}.`,
          };
        }
      } else if (hasWildcard(subcommand)) {
        return {
          problem: `"${shown}" has a * where the kubectl ${verb} subcommand goes: a * stands for exactly one word, and the subcommand decides what kind of change runs, so write it out${subcommandExample(verb)}.`,
        };
      } else if (subcommand !== subcommand.toLowerCase()) {
        return {
          problem: `"${shown}" can never match a command that runs: kubectl matches commands case-sensitively, so "${subcommand}" is not the kubectl ${verb} ${subcommand.toLowerCase()} command (write the subcommand in lowercase).`,
        };
      }
    }

    if (parsed.violation) {
      return {
        problem: `"${shown}" can never match a command that runs: ${parsed.violation}.`,
      };
    }

    return { args: tokenized.args, parsed };
  }

  public static isReadOnly(command: string): boolean {
    return (
      KubectlPolicy.evaluateCommand(command).tier === KubectlCommandTier.Read
    );
  }

  /*
   * Render an argv back to the one-line form humans read on approval cards
   * and in the activity feed. Tokens that would not survive a shell split
   * are single-quoted, so the rendering round-trips through tokenize().
   */
  public static renderDisplayCommand(args: Array<string>): string {
    const rendered: Array<string> = ["kubectl"];

    for (const arg of args) {
      if (arg === "") {
        rendered.push("''");
      } else if (SHELL_SAFE_TOKEN.test(arg)) {
        rendered.push(arg);
      } else {
        rendered.push(`'${arg.replace(/'/g, `'\\''`)}'`);
      }
    }

    return rendered.join(" ");
  }

  /*
   * What a flag name means here: its arity, and whether it may be used at
   * all. `verb` is the first positional seen so far (undefined before it),
   * for the few flags whose meaning depends on it.
   */
  private static lookupFlag(name: string, verb: string | undefined): FlagRule {
    const override: FlagArity | undefined =
      verb !== undefined
        ? VERB_FLAG_OVERRIDE_ARITY.get(verb)?.get(name)
        : undefined;

    if (override) {
      return { arity: override };
    }

    const denyReason: string | undefined = DENIED_FLAG_REASONS.get(name);

    if (denyReason) {
      return {
        arity: FlagArity.Boolean,
        problem: `is not allowed: ${denyReason}`,
      };
    }

    const arity: FlagArity | undefined = KNOWN_FLAG_ARITY.get(name);

    if (arity) {
      return { arity };
    }

    return {
      arity: FlagArity.Boolean,
      problem:
        "is not a kubectl flag OneUptime AI may use (an unknown flag could hide the verb or the resource behind its value, so it is refused rather than guessed)",
    };
  }

  // Streaming flags may only ever be switched off explicitly.
  private static findStreamingFlag(
    flags: Map<string, Array<string>>,
  ): string | null {
    for (const name of STREAMING_FLAGS) {
      const values: Array<string> | undefined = flags.get(name);

      if (!values) {
        continue;
      }

      for (const value of values) {
        if (value !== "false") {
          const shown: string = name.length === 1 ? `-${name}` : `--${name}`;
          return `the ${shown} flag streams until kubectl is killed; OneUptime AI reads a bounded snapshot (${shown}=false is fine)`;
        }
      }
    }

    return null;
  }

  // Every -o/--output value must be an inline format kubectl prints itself.
  private static findOutputFormatProblem(
    flags: Map<string, Array<string>>,
  ): string | null {
    const values: Array<string> = [
      ...(flags.get("o") || []),
      ...(flags.get("output") || []),
    ];

    for (const value of values) {
      const lower: string = value.toLowerCase();
      const eq: number = lower.indexOf("=");
      const format: string = eq >= 0 ? lower.slice(0, eq) : lower;

      if (FILE_OUTPUT_FORMATS.has(format)) {
        return `the output format "${value}" makes kubectl read a file on the Runner and echo it; write the template inline (-o jsonpath=..., -o go-template=..., -o custom-columns=...)`;
      }

      /*
       * A template format without its template would take it from
       * --template, which is Denied, so the bare form can never run.
       */
      if (OUTPUT_FORMATS_WITH_ARGUMENT.has(format)) {
        if (eq < 0) {
          return `the output format "${value}" needs its template inline: -o ${format}=... (--template is not allowed)`;
        }
        continue;
      }

      if (eq >= 0 || !OUTPUT_FORMATS.has(format)) {
        return `the output format "${value}" is not one OneUptime AI may use (json, yaml, name, wide, jsonpath=..., go-template=..., custom-columns=...)`;
      }
    }

    return null;
  }

  /*
   * Split an argv into positionals and flags exactly as pflag will (see the
   * Flags section above). Never throws and never stops early: it records the
   * first problem and keeps going, so the caller can still name the verb.
   */
  private static parseArgs(args: Array<string>): ParsedArgs {
    const positionals: Array<string> = [];
    const flags: Map<string, Array<string>> = new Map<string, Array<string>>();
    const problems: Array<string> = [];
    let verb: string | undefined = undefined;
    let subcommand: string | undefined = undefined;
    let afterDoubleDash: boolean = false;

    const record: (name: string, value: string) => void = (
      name: string,
      value: string,
    ): void => {
      const existing: Array<string> = flags.get(name) || [];
      existing.push(value);
      flags.set(name, existing);
    };

    /*
     * True once the positionals name the command kubectl will run: the verb,
     * plus its subcommand for SUBCOMMAND_VERBS. Until then only GLOBAL_FLAGS
     * may appear (see the Flags section: kubectl picks the command first and
     * would take the word after any other flag as that flag's value).
     */
    const commandFound: () => boolean = (): boolean => {
      return (
        verb !== undefined &&
        (!SUBCOMMAND_VERBS.has(verb) || subcommand !== undefined)
      );
    };

    const orderingProblem: (name: string, shown: string) => string | null = (
      name: string,
      shown: string,
    ): string | null => {
      if (commandFound() || GLOBAL_FLAGS.has(name)) {
        return null;
      }
      const after: string =
        verb === undefined ? "the verb" : `the kubectl ${verb} subcommand`;
      return `the ${shown} flag must come after ${after}: kubectl picks the command before it parses flags and would take the word after this flag as its value`;
    };

    for (let i: number = 0; i < args.length; i++) {
      const token: string = args[i]!;

      if (afterDoubleDash || !token.startsWith("-") || token === "-") {
        positionals.push(token);
        if (verb === undefined) {
          verb = token.toLowerCase();
        } else if (subcommand === undefined) {
          subcommand = token.toLowerCase();
        }
        continue;
      }

      if (token === "--") {
        if (!commandFound()) {
          problems.push(`"--" must come after the verb`);
        }
        afterDoubleDash = true;
        continue;
      }

      if (token.startsWith("--")) {
        const eq: number = token.indexOf("=");
        const rawName: string = eq >= 0 ? token.slice(2, eq) : token.slice(2);
        const name: string = normalizeKubectlFlagName(rawName);

        if (!name || name.startsWith("-")) {
          problems.push(`"${token}" is not valid flag syntax`);
          continue;
        }

        const rule: FlagRule = KubectlPolicy.lookupFlag(name, verb);
        const ordering: string | null = orderingProblem(name, `--${rawName}`);

        if (rule.problem) {
          problems.push(`the --${rawName} flag ${rule.problem}`);
        } else if (ordering) {
          problems.push(ordering);
        }

        if (eq >= 0) {
          record(name, token.slice(eq + 1));
        } else if (rule.arity === FlagArity.Value && i + 1 < args.length) {
          record(name, args[i + 1]!);
          i++;
        } else {
          record(name, "");
        }
        continue;
      }

      // "-abc": a cluster of short flags, read letter by letter like pflag.
      let rest: string = token.slice(1);

      while (rest.length > 0) {
        const letter: string = rest.charAt(0);
        const rule: FlagRule = KubectlPolicy.lookupFlag(letter, verb);
        const where: string =
          token === `-${letter}` || token.startsWith(`-${letter}=`)
            ? ""
            : ` (in "${token}")`;
        const ordering: string | null = orderingProblem(
          letter,
          `-${letter}${where}`,
        );

        if (rule.problem) {
          problems.push(`the -${letter} flag${where} ${rule.problem}`);
        } else if (ordering) {
          problems.push(ordering);
        }

        // "-n=web"
        if (rest.charAt(1) === "=") {
          record(letter, rest.slice(2));
          break;
        }

        // A boolean (or optional-value) letter: the next letter is another flag.
        if (rule.arity !== FlagArity.Value) {
          record(letter, "");
          rest = rest.slice(1);
          continue;
        }

        // "-nweb"
        if (rest.length > 1) {
          record(letter, rest.slice(1));
          break;
        }

        // "-n web"
        if (i + 1 < args.length) {
          record(letter, args[i + 1]!);
          i++;
        } else {
          record(letter, "");
        }
        break;
      }
    }

    return { positionals, flags, violation: problems[0] };
  }
}
