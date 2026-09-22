import { KubectlCommandTier } from "../../Types/Kubernetes/KubernetesClusterAiAccess";
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
 * a human unless the operator allowlisted it; Denied never runs.
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
}

export interface KubectlAutoExecutionVerdict {
  verdict: AiRemediationCommandPolicyVerdict;
  tier: KubectlCommandTier;
  reason: string;
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
 *   - "_" in a long flag name reads as "-" ("--all_namespaces").
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

const SAFE_WRITE_VERBS: Set<string> = new Set<string>([
  "scale",
  "cordon",
  "uncordon",
  "label",
  "annotate",
]);

const RISKY_WRITE_VERBS: Set<string> = new Set<string>([
  "patch",
  "set",
  "taint",
  "drain",
  "create",
  "expose",
  "autoscale",
]);

/*
 * Verbs with nothing to offer an SRE agent, or that open an interactive or
 * long-lived channel, or that could rewrite objects from input we do not
 * support. Listed explicitly so the reason names the verb; any verb not in
 * any list is Denied too.
 */
const DENIED_VERBS: Set<string> = new Set<string>([
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
 * workload, not for tearing down a cluster.
 */
const NEVER_DELETE_KINDS: Set<string> = new Set<string>([
  "namespace",
  "node",
  "persistentvolume",
  "persistentvolumeclaim",
  "customresourcedefinition",
  "clusterrole",
  "clusterrolebinding",
  "storageclass",
  "secret",
  "priorityclass",
  "apiservice",
  "mutatingwebhookconfiguration",
  "validatingwebhookconfiguration",
  "certificatesigningrequest",
  "all",
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

// Kinds a controller recreates: deleting one named instance is a safe change.
const SAFE_DELETE_KINDS: Set<string> = new Set<string>(["pod", "job"]);

const KIND_ALIASES: Record<string, string> = {
  po: "pod",
  pods: "pod",
  pod: "pod",
  jobs: "job",
  job: "job",
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
  csr: "certificatesigningrequest",
  certificatesigningrequests: "certificatesigningrequest",
  certificatesigningrequest: "certificatesigningrequest",
  all: "all",
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
  kinds: Set<string>;
  // How many objects are named (as opposed to a bare kind meaning "all").
  namedCount: number;
}

function normalizeKind(token: string): string {
  const lower: string = token.toLowerCase();
  /*
   * "pods.v1." / "deployments.apps" fully-qualified forms: keep the leading
   * segment, which is the kind.
   */
  const head: string = lower.split(".")[0] || lower;
  return Object.prototype.hasOwnProperty.call(KIND_ALIASES, head)
    ? KIND_ALIASES[head]!
    : head;
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
  let namedCount: number = 0;

  for (let i: number = 0; i < resourceTokens.length; i++) {
    const token: string = resourceTokens[i]!;
    if (token.includes("/")) {
      kinds.add(normalizeKind(token.split("/")[0] || ""));
      namedCount++;
    } else if (i === 0) {
      for (const part of token.split(",")) {
        kinds.add(normalizeKind(part));
      }
    } else {
      namedCount++;
    }
  }

  return { kinds, namedCount };
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
      return { errorMessage: "The command names no kubectl verb." };
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
      return deny("The command names no kubectl verb.");
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

    const verb: string = (parsed.positionals[0] || "").toLowerCase();

    // A denied verb is the most useful thing to say, whatever its flags.
    if (DENIED_VERBS.has(verb)) {
      return deny(`kubectl ${verb} is not allowed for OneUptime AI`, verb);
    }

    // Credential / cluster-selection / file / unknown flags: never.
    if (parsed.violation) {
      return deny(parsed.violation);
    }

    if (!verb) {
      return deny("The command names no kubectl verb.");
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

    const hasAllNamespaces: boolean =
      parsed.flags.has("A") || parsed.flags.has("all-namespaces");
    const hasAll: boolean = parsed.flags.has("all");
    const hasSelector: boolean =
      parsed.flags.has("l") || parsed.flags.has("selector");
    const hasForce: boolean = parsed.flags.has("force");

    const subcommand: string = (parsed.positionals[1] || "").toLowerCase();

    // ---- Credentials -----------------------------------------------------

    if (OBJECT_VERBS.has(verb)) {
      const named: NamedKinds = namedKinds(
        objectTokens(verb, parsed.positionals),
      );

      for (const kind of named.kinds) {
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
    }

    // ---- Read tier -------------------------------------------------------

    if (READ_VERBS.has(verb)) {
      return {
        tier: KubectlCommandTier.Read,
        reason: `kubectl ${verb} only reads the cluster`,
        args,
        verb,
        displayCommand,
      };
    }

    if (verb === "cluster-info") {
      if (subcommand === "dump") {
        return deny(
          "kubectl cluster-info dump exports the whole cluster; inspect specific resources instead",
          "cluster-info dump",
        );
      }
      return {
        tier: KubectlCommandTier.Read,
        reason: "kubectl cluster-info only reads the cluster",
        args,
        verb,
        displayCommand,
      };
    }

    if (verb === "auth") {
      if (subcommand === "can-i" || subcommand === "whoami") {
        return {
          tier: KubectlCommandTier.Read,
          reason: `kubectl auth ${subcommand} only reads the cluster`,
          args,
          verb: `auth ${subcommand}`,
          displayCommand,
        };
      }
      return deny(
        `kubectl auth ${subcommand || "(missing subcommand)"} is not allowed`,
        `auth ${subcommand}`,
      );
    }

    if (verb === "rollout") {
      const rolloutVerb: string = `rollout ${subcommand}`;

      if (subcommand === "status" || subcommand === "history") {
        return {
          tier: KubectlCommandTier.Read,
          reason: `kubectl ${rolloutVerb} only reads the cluster`,
          args,
          verb: rolloutVerb,
          displayCommand,
        };
      }

      if (
        subcommand === "restart" ||
        subcommand === "undo" ||
        subcommand === "pause" ||
        subcommand === "resume"
      ) {
        if (hasAllNamespaces) {
          return deny(
            `kubectl ${rolloutVerb} across all namespaces is not allowed`,
            rolloutVerb,
          );
        }
        if (hasSelector || hasAll) {
          return {
            tier: KubectlCommandTier.RiskyWrite,
            reason: `kubectl ${rolloutVerb} with a selector or --all touches many workloads at once`,
            args,
            verb: rolloutVerb,
            displayCommand,
          };
        }
        return {
          tier: KubectlCommandTier.SafeWrite,
          reason: `kubectl ${rolloutVerb} is a controller-managed, reversible change to one workload`,
          args,
          verb: rolloutVerb,
          displayCommand,
        };
      }

      return deny(
        `kubectl rollout ${subcommand || "(missing subcommand)"} is not allowed`,
        rolloutVerb,
      );
    }

    // ---- Write tiers -----------------------------------------------------

    if (hasAllNamespaces) {
      return deny(`kubectl ${verb} across all namespaces is not allowed`, verb);
    }

    if (verb === "delete") {
      if (hasAll) {
        return deny("kubectl delete --all is not allowed", "delete");
      }

      const kindTokens: Array<string> = parsed.positionals.slice(1);

      if (kindTokens.length === 0) {
        return deny("kubectl delete needs a resource kind and name", "delete");
      }

      /*
       * Both "delete pod foo" and "delete pod/foo" (and "delete pods foo
       * bar") are accepted; normalize to the set of kinds named.
       */
      const named: NamedKinds = namedKinds(kindTokens);
      const kinds: Set<string> = named.kinds;
      const namedCount: number = named.namedCount;

      for (const kind of kinds) {
        if (NEVER_DELETE_KINDS.has(kind)) {
          return deny(
            `deleting ${kind} objects is never allowed for OneUptime AI`,
            "delete " + kind,
          );
        }
      }

      const verbLabel: string = `delete ${Array.from(kinds).join(",")}`;

      if (namedCount === 0 && !hasSelector) {
        return deny(
          "kubectl delete needs the name of the object to delete (or a selector, which needs approval)",
          verbLabel,
        );
      }

      const allSafeKinds: boolean = Array.from(kinds).every((kind: string) => {
        return SAFE_DELETE_KINDS.has(kind);
      });

      if (allSafeKinds && namedCount > 0 && !hasSelector && !hasForce) {
        return {
          tier: KubectlCommandTier.SafeWrite,
          reason:
            "deleting a named pod or job is recreated by its controller and has a bounded blast radius",
          args,
          verb: verbLabel,
          displayCommand,
        };
      }

      return {
        tier: KubectlCommandTier.RiskyWrite,
        reason: hasForce
          ? "force-deleting skips graceful termination"
          : hasSelector
            ? "deleting by selector can remove many objects at once"
            : `deleting ${Array.from(kinds).join(",")} objects changes what is deployed`,
        args,
        verb: verbLabel,
        displayCommand,
      };
    }

    if (SAFE_WRITE_VERBS.has(verb)) {
      if (hasAll || hasSelector) {
        return {
          tier: KubectlCommandTier.RiskyWrite,
          reason: `kubectl ${verb} with a selector or --all touches many objects at once`,
          args,
          verb,
          displayCommand,
        };
      }

      if (verb === "scale" && !parsed.flags.has("replicas")) {
        return deny("kubectl scale needs --replicas", verb);
      }

      return {
        tier: KubectlCommandTier.SafeWrite,
        reason: `kubectl ${verb} is a reversible change with a bounded blast radius`,
        args,
        verb,
        displayCommand,
      };
    }

    if (RISKY_WRITE_VERBS.has(verb)) {
      const verbLabel: string =
        verb === "set" || verb === "create" ? `${verb} ${subcommand}` : verb;
      return {
        tier: KubectlCommandTier.RiskyWrite,
        reason: `kubectl ${verbLabel} can change what is deployed or affect many pods, so a human must approve it`,
        args,
        verb: verbLabel,
        displayCommand,
      };
    }

    return deny(`kubectl ${verb} is not a command OneUptime AI may run`, verb);
  }

  /*
   * The remediation verdict for one command under a cluster's settings.
   * Read and SafeWrite auto-approve; RiskyWrite auto-approves only when the
   * operator allowlisted its exact shape (same glob matcher the Bash lane
   * uses, on the rendered command); Denied stays Denied. Suggest mode never
   * consults this — everything there is RequiresApproval by construction.
   */
  public static evaluateForAutoExecution(data: {
    command: string;
    allowlistPatterns: Array<string>;
    /*
     * The cluster's operator chose to never be asked: RiskyWrite auto-approves
     * too. Denied stays Denied — that tier is what "even with approval"
     * means, and bypassing approval cannot grant more than approval would.
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

    if (
      result.tier === KubectlCommandTier.Read ||
      result.tier === KubectlCommandTier.SafeWrite
    ) {
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
      CommandPolicy.matchesAllowlist({
        command: result.displayCommand,
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
        const name: string = rawName.replace(/_/g, "-");

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
