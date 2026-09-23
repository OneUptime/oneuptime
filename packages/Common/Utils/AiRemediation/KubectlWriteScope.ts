import {
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_WRITE_NAMESPACES_ENV,
  KubectlCommandTier,
  RUNNER_POD_NAMESPACE_ENV,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import KubectlPolicy, { normalizeKubectlFlagName } from "./KubectlPolicy";

/*
 * Where an AI-composed kubectl WRITE lands, and whether the Runner that
 * runs it lets it land there — the Runner's own bound, independent of RBAC.
 *
 * ONE rule, asked in three places that must never disagree:
 *
 *   - the Runner (KubectlExecutor), before it spawns kubectl, with the
 *     configuration it was started with — the authoritative check;
 *   - the server's enqueue chokepoint (RunnerJobService
 *     .getRunnerWriteScopeRefusal), with the posture that Runner reported,
 *     so nothing is enqueued or counted by the circuit breaker only to be
 *     refused on the Runner;
 *   - the remediation toolkit (RemediationCommandToolkit
 *     .getRunnerScopeRefusal), at propose and approve time, so nothing is
 *     composed or approved only to be refused.
 *
 * All three call getRefusal with the same five inputs (the command, the
 * write namespaces, the pod's namespace, the node switch, and whether
 * kubectl runs through a credential's kubeconfig or the in-cluster
 * ServiceAccount) and word the answer for their own reader. This module is
 * pure: it reads no environment and no Node API; the Runner passes its
 * configuration in, the server passes the posture.
 *
 * RBAC alone is not a namespace bound worth the name: patch/update on a
 * workload's pod template, or create on a job, is running any image as any
 * ServiceAccount of that namespace and mounting its Secrets. So every
 * non-Read argv is refused that
 *
 *   - is a node operation while the node switch is off
 *     (KUBECTL_ALLOW_NODE_OPERATIONS_ENV, the chart's
 *     aiAccess.remediation.nodeOperations) — or might be one: a write whose
 *     objects cannot be read for certain;
 *   - changes something in the namespace the Runner's pod runs in
 *     (RUNNER_POD_NAMESPACE_ENV): a change there could scale the Kubernetes
 *     agent — or the Runner, and with it any rollback — away. A namespaced
 *     write with no -n runs in the pod's own namespace in-cluster, so a
 *     missing -n counts as that namespace; or
 *   - changes something outside KUBECTL_WRITE_NAMESPACES_ENV when that list
 *     is non-empty (the chart passes the namespaces it bound write RBAC in).
 *
 * What a write changes decides how it is judged, the way kubectl decides
 * it — kubectl ignores -n for an object that lives outside every namespace:
 *
 *   - a namespaced object (a pod, a workload, a custom resource) is judged
 *     by the namespace it lands in: -n, or the default namespace without it
 *     (the pod's own in-cluster, "default" through a credential's
 *     kubeconfig, which names none);
 *   - a Namespace object is judged by its NAME — `label namespace X` changes
 *     namespace X, whatever -n says — so only a namespace the Runner may
 *     write in can be changed, never its own;
 *   - a Node, and every node verb (cordon, uncordon, drain, taint), is a
 *     node operation: not namespace-scoped, but governed by the node
 *     switch;
 *   - any other cluster-scoped object (a PersistentVolume, a StorageClass,
 *     an IngressClass, a ClusterRole, a CRD, ...) is outside every
 *     namespace: refused when the write-namespace list is non-empty (the
 *     chart's namespaced RoleBindings could not grant it anyway), left to
 *     RBAC when it is empty.
 *
 * A write that changes several kinds of object meets every rule that
 * applies to one of them. Reads are never restricted.
 *
 * Only the built-in cluster-scoped kinds are known here — every one the API
 * server serves — by every name kubectl resolves: plural, singular, short
 * name and Kind case, bare or group-qualified the way kubectl qualifies
 * them (its own API group, any prefix of it — "sc.storage", "csr.cert" —
 * or none: "sc.", "storageclasses.v1."; see clusterScopedKindOf). A custom
 * resource is read as namespaced — nobody can run discovery before
 * deciding — so a cluster-scoped custom resource is judged by -n like a
 * namespaced one. On the in-cluster Runner with a write-namespace list its
 * RoleBindings cannot grant one anyway; elsewhere the credential's RBAC
 * bounds it.
 *
 * A flag that replaces the object kubectl builds (--overrides and
 * --override-type, on expose and run) makes what the write changes
 * unreadable: kubectl creates whatever object the flag's value describes.
 * Such a write is uncertain on every verb, whatever the shared policy
 * decides about the flag.
 *
 * The objects and the namespace are read the way kubectl reads the argv:
 * every flag by its arity (the same table the shared policy parses with —
 * a flag this reader does not know makes the objects uncertain, which is
 * refused), -n x, -nx, -n=x, --namespace x, --namespace=x, inside a cluster
 * of boolean short flags such as -An x. Every namespace the argv sets must
 * be allowed, not just the last one kubectl uses; a namespaced write across
 * all namespaces (-A) is never inside a scope. What this reader cannot
 * decide for certain — a namespace flag that the flag before it might
 * swallow as its value, a namespace flag after `--` — is refused rather
 * than guessed, with the unambiguous spelling in the message:
 * `kubectl -n <namespace> ...`.
 */

// Verbs whose objects are always nodes: cluster-scoped, not namespaced.
const NODE_VERBS: Set<string> = new Set<string>([
  "cordon",
  "uncordon",
  "drain",
  "taint",
]);

/*
 * Verbs whose positionals name objects as "kind name..." or "kind/name...",
 * mirroring the shared policy's OBJECT_VERBS. For rollout and set the
 * objects follow the subcommand.
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
 * Verbs that make a NEW namespaced object from the one they name (a
 * Service, a HorizontalPodAutoscaler) in the namespace -n names, whatever
 * kind the named object is. That holds only without --overrides, which
 * lets expose create any object at all (see OBJECT_REPLACING_FLAGS).
 */
const CREATES_NAMESPACED_OBJECT_VERBS: Set<string> = new Set<string>([
  "expose",
  "autoscale",
]);

/*
 * What each `kubectl create` subcommand makes, by every alias cobra
 * matches. Anything not listed here is uncertain (the shared policy denies
 * it anyway).
 */
const CREATE_SUBCOMMAND_SCOPES: Record<
  string,
  "namespace-object" | "cluster-scoped" | "namespaced"
> = {
  namespace: "namespace-object",
  ns: "namespace-object",
  priorityclass: "cluster-scoped",
  pc: "cluster-scoped",
  clusterrole: "cluster-scoped",
  clusterrolebinding: "cluster-scoped",
  quota: "namespaced",
  resourcequota: "namespaced",
  secret: "namespaced",
  configmap: "namespaced",
  cm: "namespaced",
  serviceaccount: "namespaced",
  sa: "namespaced",
  service: "namespaced",
  svc: "namespaced",
  deployment: "namespaced",
  deploy: "namespaced",
  role: "namespaced",
  rolebinding: "namespaced",
  poddisruptionbudget: "namespaced",
  pdb: "namespaced",
  job: "namespaced",
  cronjob: "namespaced",
  cj: "namespaced",
  ingress: "namespaced",
  ing: "namespaced",
  token: "namespaced",
};

// The kind a `kubectl create <subcommand>` of this scope makes, for messages.
const CREATE_CLUSTER_SCOPED_KINDS: Record<string, string> = {
  priorityclass: "priorityclass",
  pc: "priorityclass",
  clusterrole: "clusterrole",
  clusterrolebinding: "clusterrolebinding",
};

/*
 * A built-in kind that lives outside any namespace, the way discovery
 * describes it: its API group ("" for the core group), its plural resource
 * name and its short names. kubectl knows it by exactly those, its
 * singular (the key below) and its Kind, which is the singular in another
 * case.
 */
interface ClusterScopedKind {
  group: string;
  plural: string;
  shortNames: Array<string>;
}

/*
 * EVERY built-in cluster-scoped kind the Kubernetes API server serves
 * (upstream discovery, api/discovery/aggregated_v2.json and api__v1.json of
 * v1.36), keyed by its singular — alpha and beta kinds included, since a
 * cluster may switch them on. A superset of the shared policy's
 * CLUSTER_SCOPED_KINDS (the scope test pins that parity through the
 * policy's own verdicts).
 */
const BUILTIN_CLUSTER_SCOPED_KINDS: Record<string, ClusterScopedKind> = {
  node: { group: "", plural: "nodes", shortNames: ["no"] },
  namespace: { group: "", plural: "namespaces", shortNames: ["ns"] },
  persistentvolume: {
    group: "",
    plural: "persistentvolumes",
    shortNames: ["pv"],
  },
  componentstatus: {
    group: "",
    plural: "componentstatuses",
    shortNames: ["cs"],
  },
  storageclass: {
    group: "storage.k8s.io",
    plural: "storageclasses",
    shortNames: ["sc"],
  },
  csidriver: { group: "storage.k8s.io", plural: "csidrivers", shortNames: [] },
  csinode: { group: "storage.k8s.io", plural: "csinodes", shortNames: [] },
  volumeattachment: {
    group: "storage.k8s.io",
    plural: "volumeattachments",
    shortNames: [],
  },
  volumeattributesclass: {
    group: "storage.k8s.io",
    plural: "volumeattributesclasses",
    shortNames: ["vac"],
  },
  storageversionmigration: {
    group: "storagemigration.k8s.io",
    plural: "storageversionmigrations",
    shortNames: [],
  },
  customresourcedefinition: {
    group: "apiextensions.k8s.io",
    plural: "customresourcedefinitions",
    shortNames: ["crd", "crds"],
  },
  apiservice: {
    group: "apiregistration.k8s.io",
    plural: "apiservices",
    shortNames: [],
  },
  mutatingwebhookconfiguration: {
    group: "admissionregistration.k8s.io",
    plural: "mutatingwebhookconfigurations",
    shortNames: [],
  },
  validatingwebhookconfiguration: {
    group: "admissionregistration.k8s.io",
    plural: "validatingwebhookconfigurations",
    shortNames: [],
  },
  validatingadmissionpolicy: {
    group: "admissionregistration.k8s.io",
    plural: "validatingadmissionpolicies",
    shortNames: [],
  },
  validatingadmissionpolicybinding: {
    group: "admissionregistration.k8s.io",
    plural: "validatingadmissionpolicybindings",
    shortNames: [],
  },
  mutatingadmissionpolicy: {
    group: "admissionregistration.k8s.io",
    plural: "mutatingadmissionpolicies",
    shortNames: [],
  },
  mutatingadmissionpolicybinding: {
    group: "admissionregistration.k8s.io",
    plural: "mutatingadmissionpolicybindings",
    shortNames: [],
  },
  clusterrole: {
    group: "rbac.authorization.k8s.io",
    plural: "clusterroles",
    shortNames: [],
  },
  clusterrolebinding: {
    group: "rbac.authorization.k8s.io",
    plural: "clusterrolebindings",
    shortNames: [],
  },
  tokenreview: {
    group: "authentication.k8s.io",
    plural: "tokenreviews",
    shortNames: [],
  },
  selfsubjectreview: {
    group: "authentication.k8s.io",
    plural: "selfsubjectreviews",
    shortNames: [],
  },
  subjectaccessreview: {
    group: "authorization.k8s.io",
    plural: "subjectaccessreviews",
    shortNames: [],
  },
  selfsubjectaccessreview: {
    group: "authorization.k8s.io",
    plural: "selfsubjectaccessreviews",
    shortNames: [],
  },
  selfsubjectrulesreview: {
    group: "authorization.k8s.io",
    plural: "selfsubjectrulesreviews",
    shortNames: [],
  },
  priorityclass: {
    group: "scheduling.k8s.io",
    plural: "priorityclasses",
    shortNames: ["pc"],
  },
  ingressclass: {
    group: "networking.k8s.io",
    plural: "ingressclasses",
    shortNames: [],
  },
  ipaddress: {
    group: "networking.k8s.io",
    plural: "ipaddresses",
    shortNames: ["ip"],
  },
  servicecidr: {
    group: "networking.k8s.io",
    plural: "servicecidrs",
    shortNames: [],
  },
  runtimeclass: {
    group: "node.k8s.io",
    plural: "runtimeclasses",
    shortNames: [],
  },
  certificatesigningrequest: {
    group: "certificates.k8s.io",
    plural: "certificatesigningrequests",
    shortNames: ["csr"],
  },
  clustertrustbundle: {
    group: "certificates.k8s.io",
    plural: "clustertrustbundles",
    shortNames: [],
  },
  flowschema: {
    group: "flowcontrol.apiserver.k8s.io",
    plural: "flowschemas",
    shortNames: [],
  },
  prioritylevelconfiguration: {
    group: "flowcontrol.apiserver.k8s.io",
    plural: "prioritylevelconfigurations",
    shortNames: [],
  },
  storageversion: {
    group: "internal.apiserver.k8s.io",
    plural: "storageversions",
    shortNames: [],
  },
  deviceclass: {
    group: "resource.k8s.io",
    plural: "deviceclasses",
    shortNames: [],
  },
  devicetaintrule: {
    group: "resource.k8s.io",
    plural: "devicetaintrules",
    shortNames: [],
  },
  resourceslice: {
    group: "resource.k8s.io",
    plural: "resourceslices",
    shortNames: [],
  },
  resourcepoolstatusrequest: {
    group: "resource.k8s.io",
    plural: "resourcepoolstatusrequests",
    shortNames: [],
  },
};

// A name kubectl resolves to a cluster-scoped kind, and whether it is short.
interface ClusterScopedKindName {
  kind: string;
  isShortName: boolean;
}

/*
 * Every name kubectl resolves to one of those kinds (lowercased): plural,
 * singular and short names. A Kind ("StorageClass") is its singular once
 * lowercased, which is how kubectl matches it too.
 */
function buildClusterScopedKindNames(): Record<string, ClusterScopedKindName> {
  const names: Record<string, ClusterScopedKindName> = {};

  for (const kind of Object.keys(BUILTIN_CLUSTER_SCOPED_KINDS)) {
    const definition: ClusterScopedKind = BUILTIN_CLUSTER_SCOPED_KINDS[kind]!;

    names[kind] = { kind, isShortName: false };
    names[definition.plural] = { kind, isShortName: false };

    for (const shortName of definition.shortNames) {
      names[shortName] = { kind, isShortName: true };
    }
  }

  return names;
}

const CLUSTER_SCOPED_KIND_NAMES: Record<string, ClusterScopedKindName> =
  buildClusterScopedKindNames();

/*
 * An API version as Kubernetes spells one ("v1", "v1beta2", "v2alpha1"):
 * the middle segment of "RESOURCE.VERSION.GROUP".
 */
const API_VERSION_SEGMENT: RegExp = /^v\d+(?:(?:alpha|beta)\d+)?$/;

/*
 * Flags by arity, mirroring the shared policy's KNOWN_FLAGS (every flag
 * OneUptime AI may use; the policy denies the rest). "value" flags take a
 * value — the rest of a short cluster, or the next token; "none" flags
 * (booleans, and optional-value flags such as --cascade, --dry-run and
 * --validate, which only take one written with "=") never consume the next
 * token.
 */
const BOOLEAN_SHORT_FLAGS: Set<string> = new Set<string>(["A", "w", "q"]);

const VALUE_SHORT_FLAGS: Set<string> = new Set<string>([
  "n",
  "o",
  "L",
  "l",
  "c",
  "p",
  "e",
  "r",
]);

/*
 * Long flags that never take the next token as their value: the policy's
 * boolean flags and its optional-value flags (--cascade, --dry-run,
 * --validate), which only take a value written with "=". The namespace
 * reader only uses it to decide that a namespace flag right after one of
 * these IS a flag (a flag missing from it makes that namespace flag
 * ambiguous, which is refused); the object reader needs every flag's
 * arity, and refuses a flag it finds in neither table.
 */
const NON_CONSUMING_LONG_FLAGS: Set<string> = new Set<string>([
  "match-server-version",
  "allow-missing-template-keys",
  "show-labels",
  "show-kind",
  "show-managed-fields",
  "no-headers",
  "server-print",
  "ignore-not-found",
  "output-watch-events",
  "all-namespaces",
  "all",
  "watch",
  "watch-only",
  "follow",
  "previous",
  "timestamps",
  "all-containers",
  "all-pods",
  "ignore-errors",
  "insecure-skip-tls-verify-backend",
  "show-events",
  "sum",
  "use-protocol-buffers",
  "show-capacity",
  "cached",
  "namespaced",
  "client",
  "list",
  "quiet",
  "force",
  "now",
  "wait",
  "ignore-daemonsets",
  "delete-emptydir-data",
  "delete-local-data",
  "disable-eviction",
  "overwrite",
  "local",
  "record",
  "save-config",
  "append-hash",
  "global-default",
  "windows-line-endings",
  "cascade",
  "dry-run",
  "validate",
]);

// Long flags that always take a value: "--selector app=web", "--image=x".
const VALUE_LONG_FLAGS: Set<string> = new Set<string>([
  "namespace",
  "request-timeout",
  "output",
  "label-columns",
  "sort-by",
  "chunk-size",
  "subresource",
  "selector",
  "labels",
  "field-selector",
  "container",
  "since",
  "since-time",
  "tail",
  "limit-bytes",
  "max-log-requests",
  "pod-running-timeout",
  "patch",
  "prefix",
  "containers",
  "for",
  "types",
  "api-group",
  "categories",
  "verbs",
  "api-version",
  "revision",
  "to-revision",
  "timeout",
  "field-manager",
  "replicas",
  "current-replicas",
  "resource-version",
  "grace-period",
  "pod-selector",
  "skip-wait-for-delete-timeout",
  "type",
  "image",
  "env",
  "from",
  "keys",
  "limits",
  "requests",
  "restart",
  "schedule",
  "port",
  "target-port",
  "protocol",
  "name",
  "external-ip",
  "cluster-ip",
  "load-balancer-ip",
  "overrides",
  "override-type",
  "session-affinity",
  "min",
  "max",
  "cpu",
  "cpu-percent",
  "from-literal",
  "resource",
  "resource-name",
  "verb",
  "non-resource-url",
  "aggregation-rule",
  "role",
  "clusterrole",
  "group",
  "serviceaccount",
  "hard",
  "scopes",
  "min-available",
  "max-unavailable",
  "value",
  "description",
  "preemption-policy",
  "class",
  "rule",
  "annotation",
  "default-backend",
  "tcp",
  "node-port",
  "clusterip",
  "docker-server",
  "docker-username",
  "docker-password",
  "docker-email",
]);

type FlagArity = "value" | "none";

/*
 * Flags whose arity depends on the verb, as in the policy's
 * VERB_FLAG_OVERRIDES: -p is --previous (boolean) on logs, --prefix a
 * boolean on logs, --containers a boolean on top, and --recursive a boolean
 * on explain.
 */
const VERB_FLAG_ARITY_OVERRIDES: Record<string, Record<string, FlagArity>> = {
  logs: { p: "none", prefix: "none" },
  top: { containers: "none" },
  explain: { recursive: "none" },
};

// A negative number or duration (`-1`, `-5s`): a value, never a flag.
const NEGATIVE_NUMBER_TOKEN: RegExp = /^-\d/;

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/*
 * A flag's arity the way the policy looks it up: by its name alone (short
 * letters and long names share one table), after the verb's own meaning of
 * it. Null for a flag neither table knows.
 */
function lookupFlagArity(
  name: string,
  verb: string | undefined,
): FlagArity | null {
  if (verb !== undefined && hasOwn(VERB_FLAG_ARITY_OVERRIDES, verb)) {
    const overrides: Record<string, FlagArity> =
      VERB_FLAG_ARITY_OVERRIDES[verb]!;

    if (hasOwn(overrides, name)) {
      return overrides[name]!;
    }
  }

  if (BOOLEAN_SHORT_FLAGS.has(name) || NON_CONSUMING_LONG_FLAGS.has(name)) {
    return "none";
  }

  if (VALUE_SHORT_FLAGS.has(name) || VALUE_LONG_FLAGS.has(name)) {
    return "value";
  }

  return null;
}

interface PositionalsReading {
  positionals: Array<string>;
  // Why the positionals cannot be split for certain, or null.
  uncertainty: string | null;
  /*
   * The first flag that replaces the object kubectl builds (see
   * OBJECT_REPLACING_FLAGS), as written without its value, or null.
   */
  objectReplacingFlag: string | null;
}

function describeUnknownFlag(flag: string): string {
  return `"${flag}" is a flag the write scope does not know, so whether it takes the next word as its value cannot be told`;
}

/*
 * Flags that replace the object kubectl builds with one the flag's value
 * describes: kubectl merges --overrides (a JSON merge, strategic merge or
 * JSON patch, per --override-type) into the Service `kubectl expose`
 * generates — or the Pod `kubectl run` does — and then picks the REST
 * mapping, and so the kind and the namespace it creates in, from the
 * merged object. `kubectl expose deployment web -n prod --overrides=...`
 * can therefore create a ClusterRoleBinding, a PriorityClass, a Namespace
 * or a privileged Job instead of a Service in prod. Read by their
 * normalized name ("--override_type" is "--override-type" to kubectl).
 */
const OBJECT_REPLACING_FLAGS: Set<string> = new Set<string>([
  "overrides",
  "override-type",
]);

function describeObjectReplacingFlag(flag: string): string {
  return `"${flag}" lets kubectl create whatever object its value describes instead of the one the command names — of any kind, in any namespace — so what the command changes cannot be read from it`;
}

/*
 * The positionals of an argv, split exactly the way the shared policy (and
 * pflag) split them: a value flag takes the rest of its short cluster or
 * the next token, "--flag=value" carries its own, and everything after
 * "--" is positional. A flag neither arity table knows makes the split
 * uncertain — whether it swallows the next word decides which word is the
 * kind — so the reason is returned instead of a guess.
 */
function readPositionals(args: Array<string>): PositionalsReading {
  const positionals: Array<string> = [];
  let verb: string | undefined = undefined;
  let afterDoubleDash: boolean = false;
  let objectReplacingFlag: string | null = null;

  for (let i: number = 0; i < args.length; i++) {
    const token: string = args[i]!;

    if (afterDoubleDash || !token.startsWith("-") || token === "-") {
      positionals.push(token);
      if (verb === undefined) {
        verb = token.toLowerCase();
      }
      continue;
    }

    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (token.startsWith("--")) {
      const eq: number = token.indexOf("=");
      const written: string = eq >= 0 ? token.slice(0, eq) : token;
      const name: string = normalizeKubectlFlagName(written.slice(2));
      const arity: FlagArity | null = lookupFlagArity(name, verb);

      if (arity === null) {
        return {
          positionals,
          uncertainty: describeUnknownFlag(token),
          objectReplacingFlag,
        };
      }

      if (objectReplacingFlag === null && OBJECT_REPLACING_FLAGS.has(name)) {
        objectReplacingFlag = written;
      }

      if (eq < 0 && arity === "value") {
        i++; // Its value is the next token, whatever it looks like.
      }
      continue;
    }

    // "-abc": a cluster of short flags, read letter by letter.
    let rest: string = token.slice(1);

    while (rest.length > 0) {
      const letter: string = rest.charAt(0);
      const arity: FlagArity | null = lookupFlagArity(letter, verb);

      if (arity === null) {
        return {
          positionals,
          uncertainty: describeUnknownFlag(`-${letter}`),
          objectReplacingFlag,
        };
      }

      // "-n=web"
      if (rest.charAt(1) === "=") {
        break;
      }

      if (arity === "none") {
        rest = rest.slice(1);
        continue;
      }

      // "-n web" takes the next token; "-nweb" carries its value inline.
      if (rest.length === 1) {
        i++;
      }
      break;
    }
  }

  return { positionals, uncertainty: null, objectReplacingFlag };
}

/*
 * The object tokens of a command, split the way kubectl (and the policy)
 * split positionals: every token after the verb for delete; for the other
 * object verbs, the leading tokens after the verb (and the subcommand, for
 * rollout and set) that are not KEY=VALUE or KEY- pairs.
 */
function objectTokens(verb: string, positionals: Array<string>): Array<string> {
  if (verb === "delete") {
    return positionals.slice(1);
  }

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

interface ObjectReference {
  // The kind as written ("nodes", "ns", "storageclasses.storage.k8s.io").
  rawKind: string;
  // The object's name; null for a bare kind (every object, or a selector).
  name: string | null;
}

interface ObjectReferencesReading {
  references: Array<ObjectReference>;
  uncertainty: string | null;
}

/*
 * The objects the tokens name, read the way kubectl's resource builder
 * reads them: "kind[,kind2] name1 name2" (each name of each kind) or
 * "kind/name kind2/name2". A separate name after a kind/name is an error in
 * kubectl, and uncertain here.
 */
function readObjectReferences(tokens: Array<string>): ObjectReferencesReading {
  const references: Array<ObjectReference> = [];
  let kinds: Array<string> = [];
  const names: Array<string> = [];

  for (let i: number = 0; i < tokens.length; i++) {
    const token: string = tokens[i]!;
    const slash: number = token.indexOf("/");

    if (slash >= 0) {
      references.push({
        rawKind: token.slice(0, slash),
        name: token.slice(slash + 1),
      });
    } else if (i === 0) {
      kinds = token.split(",");
    } else if (kinds.length === 0) {
      return {
        references,
        uncertainty: `"${token}" follows "${tokens[0]}", and kubectl does not accept a separate name after TYPE/NAME`,
      };
    } else {
      names.push(token);
    }
  }

  for (const kind of kinds) {
    if (names.length === 0) {
      references.push({ rawKind: kind, name: null });
      continue;
    }

    for (const name of names) {
      references.push({ rawKind: kind, name });
    }
  }

  return { references, uncertainty: null };
}

/*
 * Does a group written after a kind name match that kind's own group, the
 * way kubectl matches it? An empty group matches the name in every group
 * (as the bare name does); otherwise the kind's own group, or — kubectl's
 * "group prefixing" fallback when no group matches exactly — any prefix of
 * it. The core group is never a prefix match ("nodes.core" is an error).
 */
function writtenGroupNamesKindGroup(data: {
  written: string;
  group: string;
  prefixMatches: boolean;
}): boolean {
  if (data.written === "" || data.written === data.group) {
    return true;
  }

  return (
    data.prefixMatches &&
    data.group !== "" &&
    data.group.startsWith(data.written)
  );
}

/*
 * The built-in cluster-scoped kind a written kind names, or null for any
 * other kind (namespaced, or a custom resource whose scope this reader
 * cannot see). Read the way kubectl's resource builder reads it
 * (schema.ParseResourceArg, then client-go's shortcut expander and REST
 * mapper):
 *
 *   - with two dots or more, first as "RESOURCE.VERSION.GROUP". A short
 *     name there matches its kind in any group that GROUP is a prefix of
 *     ("sc.v1.storage"), and in every group when GROUP is empty — whatever
 *     the version, which the expansion drops ("sc.v1.", "sc.foo.", "no.x.").
 *     A plural or singular name matches with an empty GROUP or its own,
 *     after a real API version ("nodes.v1.", "storageclasses.v1.") or none
 *     ("nodes..");
 *   - then as "RESOURCE.GROUP", GROUP being everything after the first dot:
 *     empty ("sc.", "nodes."), the kind's own group, or any prefix of it
 *     ("sc.storage", "storageclasses.stor", "csr.cert", "ip.net",
 *     "storageclasses.storage.").
 *
 * The core group is never a prefix match: "nodes.core" and "no.x" are
 * errors in kubectl, and "nodes.example.com" is some custom resource.
 *
 * A custom resource that shares a name, a short name or a group prefix with
 * a built-in kind loses to it — discovery lists the built-in groups first,
 * and kubectl takes the first match — so the prefix spellings are the
 * built-in kind exactly as the bare name is.
 */
function clusterScopedKindOf(rawKind: string): string | null {
  const lower: string = rawKind.trim().toLowerCase();
  const dot: number = lower.indexOf(".");
  const head: string = dot >= 0 ? lower.slice(0, dot) : lower;

  if (!hasOwn(CLUSTER_SCOPED_KIND_NAMES, head)) {
    return null;
  }

  const name: ClusterScopedKindName = CLUSTER_SCOPED_KIND_NAMES[head]!;

  if (dot < 0) {
    return name.kind;
  }

  const group: string = BUILTIN_CLUSTER_SCOPED_KINDS[name.kind]!.group;
  const qualifier: string = lower.slice(dot + 1);
  const versionDot: number = qualifier.indexOf(".");

  // RESOURCE.VERSION.GROUP
  if (versionDot >= 0) {
    const version: string = qualifier.slice(0, versionDot);
    const versionedGroup: string = qualifier.slice(versionDot + 1);

    // A short name's expansion keeps no version when no group is written.
    if (name.isShortName && versionedGroup === "") {
      return name.kind;
    }

    if (
      (version === "" || API_VERSION_SEGMENT.test(version)) &&
      writtenGroupNamesKindGroup({
        written: versionedGroup,
        group,
        // With a version, only a short name falls back to a group prefix.
        prefixMatches: name.isShortName || version === "",
      })
    ) {
      return name.kind;
    }
  }

  // RESOURCE.GROUP
  if (
    writtenGroupNamesKindGroup({
      written: qualifier,
      group,
      prefixMatches: true,
    })
  ) {
    return name.kind;
  }

  return null;
}

/*
 * What a write changes, as far as the scope rules care (see the
 * header). Everything is decided from the argv alone.
 */
export interface KubectlWriteTargets {
  // The verb kubectl runs (the first positional), lowercased; "" when none.
  verb: string;
  // Why the objects cannot be read for certain, or null.
  uncertainty: string | null;
  /*
   * With an uncertainty, what to change in the command so its objects can
   * be read, as a sentence for whoever composes it; "" otherwise.
   */
  uncertaintyFix: string;
  // A node operation: a node verb, or a Node among the objects.
  touchesNodes: boolean;
  // The Namespace objects it names, lowercased, in order.
  namespaceObjects: Array<string>;
  // It changes Namespace objects it does not name (a selector, --all, none).
  unnamedNamespaceObjects: boolean;
  // The other built-in cluster-scoped kinds it changes (not node/namespace).
  clusterScopedKinds: Array<string>;
  // Something it changes lives in a namespace (-n, or the default one).
  namespaced: boolean;
}

type NamespaceFlag =
  | { kind: "inline"; value: string }
  | { kind: "next" }
  | { kind: "uncertain" };

export interface KubectlNamespaceResolution {
  // Every namespace the argv sets, in order (kubectl uses the last one).
  namespaces: Array<string>;
  // Whether it asks for every namespace (-A / --all-namespaces).
  allNamespaces: boolean;
  // Why the namespace cannot be read with certainty, or null.
  ambiguity: string | null;
}

function isFlagToken(token: string): boolean {
  return (
    token.startsWith("-") &&
    token !== "-" &&
    token !== "--" &&
    !NEGATIVE_NUMBER_TOKEN.test(token)
  );
}

/*
 * Does this token switch on --all-namespaces (-A alone, or inside a cluster
 * of boolean letters)? Not when it is written "=false".
 */
function readsAllNamespaces(token: string): boolean {
  if (!isFlagToken(token)) {
    return false;
  }

  if (token.startsWith("--")) {
    const eq: number = token.indexOf("=");
    const name: string = normalizeKubectlFlagName(
      eq >= 0 ? token.slice(2, eq) : token.slice(2),
    );
    const value: string = eq >= 0 ? token.slice(eq + 1) : "";

    return name === "all-namespaces" && value.trim().toLowerCase() !== "false";
  }

  const body: string = token.slice(1);

  for (let j: number = 0; j < body.length; j++) {
    const letter: string = body[j]!;

    if (letter === "A") {
      const rest: string = body.slice(j + 1);

      return rest.startsWith("=")
        ? rest.slice(1).trim().toLowerCase() !== "false"
        : true;
    }

    if (BOOLEAN_SHORT_FLAGS.has(letter)) {
      continue;
    }

    if (VALUE_SHORT_FLAGS.has(letter) || letter === "=") {
      // The rest of the token is that flag's value.
      return false;
    }

    // A letter this reader does not know: assume the worst about what follows.
    return body.slice(j + 1).includes("A");
  }

  return false;
}

/*
 * Does this token set the namespace, and where is its value? Null when it
 * does not. "uncertain" for a short cluster where an unknown letter comes
 * before an `n` — whether kubectl reaches that `n` depends on the letter.
 */
function readNamespaceFlag(token: string): NamespaceFlag | null {
  if (!isFlagToken(token)) {
    return null;
  }

  if (token.startsWith("--")) {
    const eq: number = token.indexOf("=");
    const name: string = normalizeKubectlFlagName(
      eq >= 0 ? token.slice(2, eq) : token.slice(2),
    );

    if (name !== "namespace") {
      return null;
    }

    return eq >= 0
      ? { kind: "inline", value: token.slice(eq + 1) }
      : { kind: "next" };
  }

  const body: string = token.slice(1);

  for (let j: number = 0; j < body.length; j++) {
    const letter: string = body[j]!;

    if (letter === "n") {
      const rest: string = body.slice(j + 1);

      if (rest.startsWith("=")) {
        return { kind: "inline", value: rest.slice(1) };
      }

      return rest ? { kind: "inline", value: rest } : { kind: "next" };
    }

    if (BOOLEAN_SHORT_FLAGS.has(letter)) {
      continue;
    }

    if (VALUE_SHORT_FLAGS.has(letter) || letter === "=") {
      // The rest of the token is that flag's value, not more flags.
      return null;
    }

    // A letter the policy does not know: its arity decides whether `n` counts.
    return body.slice(j + 1).includes("n") ? { kind: "uncertain" } : null;
  }

  return null;
}

/*
 * Could this token, read as a flag, take the NEXT token as its value? "no"
 * only when that is certain; "maybe" otherwise (a value flag written
 * without "=", a flag this reader does not know). A token that is itself a
 * value can never take the next one, so "no" for a positional is exact.
 */
function mayTakeNextToken(token: string): "no" | "maybe" {
  if (!isFlagToken(token)) {
    return "no";
  }

  if (token.startsWith("--")) {
    const eq: number = token.indexOf("=");

    if (eq >= 0) {
      return "no";
    }

    return NON_CONSUMING_LONG_FLAGS.has(
      normalizeKubectlFlagName(token.slice(2)),
    )
      ? "no"
      : "maybe";
  }

  const body: string = token.slice(1);

  for (let j: number = 0; j < body.length; j++) {
    const letter: string = body[j]!;

    if (letter === "=") {
      return "no";
    }

    if (BOOLEAN_SHORT_FLAGS.has(letter)) {
      continue;
    }

    if (VALUE_SHORT_FLAGS.has(letter)) {
      // An inline value ("-lapp=web", "-nweb") leaves nothing to take.
      return j + 1 < body.length ? "no" : "maybe";
    }

    return "maybe";
  }

  // A cluster of boolean letters only ("-A").
  return "no";
}

/*
 * A command as the write scope judges it: the argv and what the shared
 * policy made of it. A KubectlPolicyResult is one.
 */
export interface KubectlWriteScopeCommand {
  // The argv, without the leading "kubectl".
  args: Array<string>;
  // Only Read is exempt; every other tier is judged as a write.
  tier: KubectlCommandTier;
  /*
   * The policy's verb label ("rollout restart"). The objects are read here
   * again, and a reading whose verb disagrees with it is refused; ""
   * skips that cross-check.
   */
  verb: string;
  // The command as rendered for humans, for messages.
  displayCommand: string;
}

// Everything the one write-scope question is asked with (see getRefusal).
export interface KubectlWriteScopeInput {
  /*
   * The command: the shared policy's verdict on it (a KubectlPolicyResult,
   * which every caller already has), or its argv, which is then evaluated
   * with KubectlPolicy.evaluateArgs — what the Runner does with the argv it
   * receives.
   */
  command: KubectlWriteScopeCommand | Array<string>;
  /*
   * The namespaces AI-composed writes may land in
   * (KUBECTL_WRITE_NAMESPACES_ENV, the chart's
   * aiAccess.remediation.namespaces); empty means cluster-wide.
   */
  writeNamespaces: Array<string>;
  /*
   * The namespace the Runner's own pod runs in (RUNNER_POD_NAMESPACE_ENV),
   * or null when it is not known.
   */
  podNamespace: string | null;
  /*
   * The node switch (KUBECTL_ALLOW_NODE_OPERATIONS_ENV), as the Runner
   * applies it.
   */
  allowNodeOperations: boolean;
  /*
   * Whether kubectl runs through a kubeconfig built from a Kubernetes
   * credential — which names no namespace, so a missing -n means
   * "default" — rather than with the in-cluster Runner's own
   * ServiceAccount, where a missing -n means the pod's own namespace.
   */
  usesCredential: boolean;
}

/*
 * Why a write is refused. Every caller words the refusal for its own
 * reader from the facts that come with it.
 */
export type KubectlWriteScopeRefusalCode =
  /*
   * A node operation while the node switch is off — or, when `uncertainty`
   * is set, a write whose objects cannot be read for certain, which could
   * be one.
   */
  | "node_operations"
  // The objects the write changes cannot be read for certain.
  | "objects_uncertain"
  // The namespace the write lands in cannot be read for certain.
  | "namespace_uncertain"
  // The objects were read with another verb than the policy's.
  | "verb_mismatch"
  // It changes Namespace objects it does not name (a selector, --all).
  | "unnamed_namespace_objects"
  // It changes other cluster-scoped objects while a write list is set.
  | "cluster_scoped"
  // A namespaced write across every namespace (-A).
  | "all_namespaces"
  // A namespaced write with no -n, where the default namespace is unknown.
  | "no_namespace"
  // It changes the Runner's own namespace.
  | "own_namespace"
  // It changes a namespace outside the write-namespace list.
  | "outside_scope";

// How an own_namespace or outside_scope write reaches its namespace.
export type KubectlWriteScopeNamespaceSource =
  // It changes that Namespace object, which is judged by its name.
  | "namespace_object"
  // -n / --namespace names it.
  | "namespace_flag"
  // It names no namespace, and kubectl would use this one.
  | "default_namespace";

// The facts behind a refusal, for callers that word it themselves.
export interface KubectlWriteScopeRefusalFacts {
  code: KubectlWriteScopeRefusalCode;
  // The command as rendered for humans.
  displayCommand: string;
  // The scope it was judged against, trimmed and lowercased.
  writeNamespaces: Array<string>;
  // The Runner pod's namespace, trimmed and lowercased; "" when unknown.
  podNamespace: string;
  // own_namespace, outside_scope: the namespace, and how the write reaches it.
  namespace: string | null;
  namespaceSource: KubectlWriteScopeNamespaceSource | null;
  /*
   * Why the reading is not certain: set for objects_uncertain and
   * namespace_uncertain, and for node_operations when the write only
   * might be one.
   */
  uncertainty: string | null;
  // cluster_scoped: the kinds it changes.
  clusterScopedKinds: Array<string>;
  // verb_mismatch: the verb read here, and the policy's.
  readVerb: string;
  policyVerb: string;
  /*
   * What to change in the command itself so it can be read or run, as a
   * sentence for whoever composes it — or "" when no rewrite of the
   * command helps (the node switch, a namespace outside the scope).
   */
  fix: string;
}

export interface KubectlWriteScopeRefusal
  extends KubectlWriteScopeRefusalFacts {
  /*
   * The whole refusal in the Runner's own words ("this Runner ..."), as it
   * reports it after "Refused by the Runner: ".
   */
  reason: string;
}

const FIX_PUT_THE_NAMESPACE_FIRST: string =
  "Put the namespace first so it cannot be misread: kubectl -n <namespace> ...";
const FIX_NAME_THE_OBJECTS: string =
  'Name the objects right after the verb (TYPE NAME or TYPE/NAME) and give each flag its value with "=" (--selector=app=web).';
const FIX_LEAVE_OUT_OVERRIDES: string =
  "Leave out --overrides and --override-type, so kubectl creates only the object the command itself describes.";
const FIX_NAME_EACH_NAMESPACE_OBJECT: string = "Name each Namespace object.";
const FIX_NAME_ONE_NAMESPACE: string =
  "Name one namespace with -n <namespace>.";
const FIX_NAME_THE_NAMESPACE: string =
  "Name the namespace with -n <namespace>.";
const FIX_NAME_THE_TARGET_NAMESPACE: string =
  "Name the target namespace with -n <namespace>.";

function normalizeNamespace(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeNamespaces(
  values: Array<string> | null | undefined,
): Array<string> {
  return (values || [])
    .map((value: string) => {
      return normalizeNamespace(value);
    })
    .filter((value: string) => {
      return value.length > 0;
    });
}

// The Runner's scope, in its own words, for the end of a refusal.
function describeRunnerScope(data: {
  writeNamespaces: Array<string>;
  podNamespace: string;
}): string {
  const parts: Array<string> = [];

  if (data.writeNamespaces.length > 0) {
    parts.push(
      `This Runner only lets OneUptime AI change ${data.writeNamespaces
        .map((namespace: string) => {
          return `"${namespace}"`;
        })
        .join(
          ", ",
        )} (${KUBECTL_WRITE_NAMESPACES_ENV}, from aiAccess.remediation.namespaces on the Kubernetes agent chart).`,
    );
  }

  if (data.podNamespace) {
    parts.push(
      `It never changes its own namespace "${data.podNamespace}" (${RUNNER_POD_NAMESPACE_ENV}).`,
    );
  }

  parts.push("Reads are not restricted.");

  return parts.join(" ");
}

// A sentence and, when there is one, the fix after it.
function withFix(sentence: string, fix: string): string {
  return fix ? `${sentence} ${fix}` : sentence;
}

/*
 * A refusal in the Runner's own words. The Runner reports a node-switch
 * refusal with its own host's setting instead (KubectlExecutor); this
 * wording is the fallback that names the variable.
 */
function describeForRunner(refusal: KubectlWriteScopeRefusalFacts): string {
  const command: string = refusal.displayCommand;
  const scope: string = describeRunnerScope(refusal);
  const target: string = refusal.namespace || "";

  switch (refusal.code) {
    case "node_operations":
      return withFix(
        `${
          refusal.uncertainty === null
            ? `"${command}" is a node operation (cordon, uncordon, drain, taint, or a change to a Node object)`
            : `this Runner cannot tell for certain whether "${command}" changes a node (${refusal.uncertainty})`
        }, and this Runner does not allow AI-composed node operations (${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}).`,
        refusal.fix,
      );
    case "namespace_uncertain":
      return withFix(
        `this Runner cannot tell for certain which namespace "${command}" changes (${refusal.uncertainty}). ${scope}`,
        refusal.fix,
      );
    case "objects_uncertain":
      return withFix(
        `this Runner cannot tell for certain which objects "${command}" changes (${refusal.uncertainty}). ${scope}`,
        refusal.fix,
      );
    case "verb_mismatch":
      return `this Runner reads the verb of "${command}" as "${refusal.readVerb}", but the kubectl policy read "${refusal.policyVerb}", so it cannot tell for certain what the command changes. ${scope}`;
    case "unnamed_namespace_objects":
      return withFix(
        `"${command}" would change Namespace objects without naming them (a selector, --all or no name at all), so this Runner cannot tell whether one of them is ${
          refusal.podNamespace
            ? `"${refusal.podNamespace}", the namespace it runs in`
            : "outside the namespaces it lets OneUptime AI change"
        }. ${scope}`,
        refusal.fix,
      );
    case "cluster_scoped":
      return `"${command}" changes ${refusal.clusterScopedKinds.join(
        ", ",
      )} objects, which are cluster-scoped: they live outside every namespace, so outside the namespaces this Runner lets OneUptime AI change, whatever -n says. ${scope}`;
    case "all_namespaces":
      return withFix(
        `"${command}" would change every namespace, including ones this Runner may not change. ${scope}`,
        refusal.fix,
      );
    case "no_namespace":
      return withFix(
        `"${command}" names no namespace and this Runner cannot tell which one it would change. ${scope}`,
        refusal.fix,
      );
    case "own_namespace":
      if (refusal.namespaceSource === "namespace_object") {
        return `"${command}" would change the Namespace object "${target}" — the namespace this Runner itself runs in; a change there could reconfigure the Kubernetes agent or this Runner, so OneUptime AI never makes one. ${scope}`;
      }

      return withFix(
        `"${command}" ${
          refusal.namespaceSource === "namespace_flag"
            ? `would change namespace "${target}"`
            : `names no namespace, so kubectl would run it in "${target}"`
        }, the namespace this Runner itself runs in — a change there could scale away or reconfigure the Kubernetes agent or this Runner, so OneUptime AI never makes one. ${scope}`,
        refusal.fix,
      );
    case "outside_scope":
      if (refusal.namespaceSource === "namespace_object") {
        return `"${command}" would change the Namespace object "${target}", which is outside the namespaces this Runner lets OneUptime AI change (a Namespace object is judged by its name; -n does not apply to it). ${scope}`;
      }

      return withFix(
        `"${command}" ${
          refusal.namespaceSource === "namespace_flag"
            ? `would change namespace "${target}"`
            : `names no namespace, so kubectl would run it in "${target}"`
        }, which is outside the namespaces this Runner lets OneUptime AI change. ${scope}`,
        refusal.fix,
      );
    default: {
      const unhandled: never = refusal.code;
      return unhandled;
    }
  }
}

export default class KubectlWriteScope {
  /*
   * The namespaces an argv sets, read the way kubectl reads them, or why
   * that cannot be decided for certain.
   */
  public static resolveNamespaces(
    args: Array<string>,
  ): KubectlNamespaceResolution {
    const namespaces: Array<string> = [];
    let allNamespaces: boolean = false;
    // Whether the previous token might take this one as its value.
    let previous: "no" | "maybe" = "no";
    let afterDoubleDash: boolean = false;

    const ambiguous: (reason: string) => KubectlNamespaceResolution = (
      reason: string,
    ): KubectlNamespaceResolution => {
      return { namespaces, allNamespaces, ambiguity: reason };
    };

    for (let i: number = 0; i < args.length; i++) {
      const token: string = args[i]!;
      const flag: NamespaceFlag | null = readNamespaceFlag(token);

      if (afterDoubleDash) {
        if (flag) {
          return ambiguous(
            `"${token}" comes after "--", where kubectl does not read it as a flag`,
          );
        }
        continue;
      }

      if (token === "--") {
        afterDoubleDash = true;
        continue;
      }

      /*
       * Counted even when the token might be the previous flag's value:
       * assuming "every namespace" can only ever cost a refusal.
       */
      if (readsAllNamespaces(token)) {
        allNamespaces = true;
      }

      if (!flag) {
        previous = mayTakeNextToken(token);
        continue;
      }

      if (previous === "maybe") {
        return ambiguous(
          `"${token}" follows "${args[i - 1]}", which may take it as its own value`,
        );
      }

      if (flag.kind === "uncertain") {
        return ambiguous(
          `"${token}" combines "n" with a short flag the write scope does not know`,
        );
      }

      if (flag.kind === "inline") {
        namespaces.push(flag.value);
        previous = "no";
        continue;
      }

      // "-n web" / "--namespace web": the value is the next token, whatever it is.
      if (i + 1 >= args.length) {
        return ambiguous(`"${token}" has no namespace after it`);
      }

      namespaces.push(args[i + 1]!);
      i++;
      previous = "no";
    }

    return { namespaces, allNamespaces, ambiguity: null };
  }

  /*
   * What a write changes, read from the argv the way kubectl reads it (see
   * the header): whether it is a node operation, which Namespace objects
   * and other cluster-scoped kinds it names, and whether anything it
   * changes lives in a namespace. getRefusal judges both the node switch
   * and the namespace scope from this one reading.
   */
  public static resolveTargets(args: Array<string>): KubectlWriteTargets {
    const targets: KubectlWriteTargets = {
      verb: "",
      uncertainty: null,
      uncertaintyFix: "",
      touchesNodes: false,
      namespaceObjects: [],
      unnamedNamespaceObjects: false,
      clusterScopedKinds: [],
      namespaced: false,
    };

    const reading: PositionalsReading = readPositionals(args);

    if (reading.uncertainty !== null) {
      targets.uncertainty = reading.uncertainty;
      targets.uncertaintyFix = FIX_NAME_THE_OBJECTS;
      return targets;
    }

    const positionals: Array<string> = reading.positionals;
    const verb: string = (positionals[0] || "").toLowerCase();
    targets.verb = verb;

    /*
     * --overrides decides what kubectl creates, whatever the verb and the
     * objects say (see OBJECT_REPLACING_FLAGS) — on every verb, not only
     * expose, so this reading never depends on the shared policy denying
     * the flag first.
     */
    if (reading.objectReplacingFlag !== null) {
      targets.uncertainty = describeObjectReplacingFlag(
        reading.objectReplacingFlag,
      );
      targets.uncertaintyFix = FIX_LEAVE_OUT_OVERRIDES;
      return targets;
    }

    // cordon, uncordon, drain and taint only ever act on nodes.
    if (NODE_VERBS.has(verb)) {
      targets.touchesNodes = true;
      return targets;
    }

    if (verb === "create") {
      // cobra matches subcommands case-sensitively (the policy denies others).
      const subcommand: string = positionals[1] || "";

      if (!hasOwn(CREATE_SUBCOMMAND_SCOPES, subcommand)) {
        targets.uncertainty = `"create ${subcommand}" is not a kubectl create subcommand the write scope knows`;
        targets.uncertaintyFix = FIX_NAME_THE_OBJECTS;
        return targets;
      }

      const scope: string = CREATE_SUBCOMMAND_SCOPES[subcommand]!;

      if (scope === "namespace-object") {
        const name: string = (positionals[2] || "").trim().toLowerCase();

        if (name) {
          targets.namespaceObjects.push(name);
        } else {
          targets.unnamedNamespaceObjects = true;
        }
      } else if (scope === "cluster-scoped") {
        targets.clusterScopedKinds.push(
          CREATE_CLUSTER_SCOPED_KINDS[subcommand] || subcommand,
        );
      } else {
        targets.namespaced = true;
      }

      return targets;
    }

    // Any other verb acts in the namespace kubectl runs it in.
    if (!OBJECT_VERBS.has(verb)) {
      targets.namespaced = true;
      return targets;
    }

    const references: ObjectReferencesReading = readObjectReferences(
      objectTokens(verb, positionals),
    );

    if (references.uncertainty !== null) {
      targets.uncertainty = references.uncertainty;
      targets.uncertaintyFix = FIX_NAME_THE_OBJECTS;
      return targets;
    }

    /*
     * No object at all is a kubectl error; judging it as namespaced keeps
     * the stricter rule. expose and autoscale make a namespaced Service or
     * HorizontalPodAutoscaler whatever they name (--overrides, which could
     * make it anything else, was refused as uncertain above).
     */
    if (
      references.references.length === 0 ||
      CREATES_NAMESPACED_OBJECT_VERBS.has(verb)
    ) {
      targets.namespaced = true;
    }

    for (const reference of references.references) {
      const kind: string | null = clusterScopedKindOf(reference.rawKind);

      if (kind === null) {
        targets.namespaced = true;
        continue;
      }

      if (kind === "node") {
        targets.touchesNodes = true;
        continue;
      }

      if (kind === "namespace") {
        const name: string = (reference.name || "").trim().toLowerCase();

        if (!name) {
          targets.unnamedNamespaceObjects = true;
        } else if (!targets.namespaceObjects.includes(name)) {
          targets.namespaceObjects.push(name);
        }
        continue;
      }

      if (!targets.clusterScopedKinds.includes(kind)) {
        targets.clusterScopedKinds.push(kind);
      }
    }

    return targets;
  }

  /*
   * Test seams, so a test can hold these tables against the shared policy's
   * own verdicts: every flag name this reader knows the arity of, a flag's
   * arity ("value", "none", or null when unknown), every kind spelling it
   * knows is cluster-scoped, and the cluster-scoped kind a spelling names.
   */
  public static readonly knownFlagNames: ReadonlyArray<string> = [
    ...Array.from(BOOLEAN_SHORT_FLAGS),
    ...Array.from(VALUE_SHORT_FLAGS),
    ...Array.from(NON_CONSUMING_LONG_FLAGS),
    ...Array.from(VALUE_LONG_FLAGS),
  ];

  public static readonly verbFlagArityOverrides: ReadonlyArray<{
    verb: string;
    flag: string;
    arity: FlagArity;
  }> = Object.entries(VERB_FLAG_ARITY_OVERRIDES).flatMap(
    ([verb, overrides]: [string, Record<string, FlagArity>]) => {
      return Object.entries(overrides).map(
        ([flag, arity]: [string, FlagArity]) => {
          return { verb, flag, arity };
        },
      );
    },
  );

  public static readonly clusterScopedKindSpellings: ReadonlyArray<string> =
    Object.keys(CLUSTER_SCOPED_KIND_NAMES);

  public static getFlagArity(
    name: string,
    verb?: string | undefined,
  ): FlagArity | null {
    return lookupFlagArity(name, verb);
  }

  public static getClusterScopedKind(rawKind: string): string | null {
    return clusterScopedKindOf(rawKind);
  }

  /*
   * THE write-scope question, for every caller (see the header): why the
   * Runner will not run this command where it lands — or null when it
   * will. Read commands are never refused; every other tier is judged as a
   * write (the policy refuses a Denied one on its own, before or after).
   *
   * In order: the node switch (a node operation, or a write whose objects
   * cannot be read for certain, while it is off); then, when a scope is
   * set at all (write namespaces, or a known pod namespace), what the write
   * changes — Namespace objects by name, other cluster-scoped objects
   * against the write-namespace list, and namespaced objects by the
   * namespace they land in.
   */
  public static getRefusal(
    input: KubectlWriteScopeInput,
  ): KubectlWriteScopeRefusal | null {
    const command: KubectlWriteScopeCommand = Array.isArray(input.command)
      ? KubectlPolicy.evaluateArgs(input.command)
      : input.command;

    if (command.tier === KubectlCommandTier.Read) {
      return null;
    }

    const writeNamespaces: Array<string> = normalizeNamespaces(
      input.writeNamespaces,
    );
    const podNamespace: string = normalizeNamespace(input.podNamespace);
    const hasScope: boolean = writeNamespaces.length > 0 || podNamespace !== "";

    if (input.allowNodeOperations && !hasScope) {
      return null;
    }

    const refuse: (
      code: KubectlWriteScopeRefusalCode,
      facts?: Partial<KubectlWriteScopeRefusalFacts>,
    ) => KubectlWriteScopeRefusal = (
      code: KubectlWriteScopeRefusalCode,
      facts: Partial<KubectlWriteScopeRefusalFacts> = {},
    ): KubectlWriteScopeRefusal => {
      const refusalFacts: KubectlWriteScopeRefusalFacts = {
        code,
        displayCommand: command.displayCommand,
        writeNamespaces,
        podNamespace,
        namespace: null,
        namespaceSource: null,
        uncertainty: null,
        clusterScopedKinds: [],
        readVerb: "",
        policyVerb: "",
        fix: "",
        ...facts,
      };

      return { ...refusalFacts, reason: describeForRunner(refusalFacts) };
    };

    const targets: KubectlWriteTargets = KubectlWriteScope.resolveTargets(
      command.args,
    );

    /*
     * The node switch: nodes are cluster-scoped, so no namespace scope can
     * bound them, and the chart's node role is optional. A write whose
     * objects cannot be read for certain could be a node operation, so it
     * is refused too.
     */
    if (
      !input.allowNodeOperations &&
      (targets.touchesNodes || targets.uncertainty !== null)
    ) {
      return refuse("node_operations", {
        uncertainty: targets.uncertainty,
        fix: targets.uncertainty === null ? "" : targets.uncertaintyFix,
      });
    }

    if (!hasScope) {
      return null;
    }

    if (targets.uncertainty !== null) {
      /*
       * A namespace flag that another flag may swallow is the usual cause
       * (`--selector -n web` makes "web" an object); say so, with the
       * spelling that cannot be misread.
       */
      const namespaceReading: KubectlNamespaceResolution =
        KubectlWriteScope.resolveNamespaces(command.args);

      if (namespaceReading.ambiguity) {
        return refuse("namespace_uncertain", {
          uncertainty: namespaceReading.ambiguity,
          fix: FIX_PUT_THE_NAMESPACE_FIRST,
        });
      }

      return refuse("objects_uncertain", {
        uncertainty: targets.uncertainty,
        fix: targets.uncertaintyFix,
      });
    }

    const policyVerb: string = (command.verb.split(" ")[0] || "").toLowerCase();

    if (policyVerb && policyVerb !== targets.verb) {
      return refuse("verb_mismatch", {
        readVerb: targets.verb,
        policyVerb,
      });
    }

    /*
     * A Namespace object is judged by its name: kubectl ignores -n for it,
     * so `label namespace X ... -n <allowed>` changes X.
     */
    if (targets.unnamedNamespaceObjects) {
      return refuse("unnamed_namespace_objects", {
        fix: FIX_NAME_EACH_NAMESPACE_OBJECT,
      });
    }

    for (const name of targets.namespaceObjects) {
      if (podNamespace && name === podNamespace) {
        return refuse("own_namespace", {
          namespace: name,
          namespaceSource: "namespace_object",
        });
      }

      if (writeNamespaces.length > 0 && !writeNamespaces.includes(name)) {
        return refuse("outside_scope", {
          namespace: name,
          namespaceSource: "namespace_object",
        });
      }
    }

    /*
     * Any other cluster-scoped object lives outside every namespace, so
     * outside every listed one. Without a list, RBAC bounds it.
     */
    if (targets.clusterScopedKinds.length > 0 && writeNamespaces.length > 0) {
      return refuse("cluster_scoped", {
        clusterScopedKinds: [...targets.clusterScopedKinds],
      });
    }

    if (!targets.namespaced) {
      return null;
    }

    const resolution: KubectlNamespaceResolution =
      KubectlWriteScope.resolveNamespaces(command.args);

    if (resolution.ambiguity) {
      return refuse("namespace_uncertain", {
        uncertainty: resolution.ambiguity,
        fix: FIX_PUT_THE_NAMESPACE_FIRST,
      });
    }

    /*
     * The shared policy already denies a write across all namespaces; this
     * layer does not rely on that — every namespace includes the ones the
     * Runner may not change.
     */
    if (resolution.allNamespaces) {
      return refuse("all_namespaces", { fix: FIX_NAME_ONE_NAMESPACE });
    }

    const explicit: boolean = resolution.namespaces.length > 0;
    const source: KubectlWriteScopeNamespaceSource = explicit
      ? "namespace_flag"
      : "default_namespace";
    // What a missing -n means: see KubectlWriteScopeInput.usesCredential.
    const defaultNamespace: string = input.usesCredential
      ? "default"
      : podNamespace;
    /*
     * Every namespace the argv sets, blanks kept: `-n ""` names no
     * namespace kubectl could be held to.
     */
    const namespaces: Array<string> = explicit
      ? resolution.namespaces.map((namespace: string) => {
          return normalizeNamespace(namespace);
        })
      : [defaultNamespace];
    const fix: string = explicit ? "" : FIX_NAME_THE_TARGET_NAMESPACE;

    for (const target of namespaces) {
      if (!target) {
        return refuse("no_namespace", { fix: FIX_NAME_THE_NAMESPACE });
      }

      if (podNamespace && target === podNamespace) {
        return refuse("own_namespace", {
          namespace: target,
          namespaceSource: source,
          fix,
        });
      }

      if (writeNamespaces.length > 0 && !writeNamespaces.includes(target)) {
        return refuse("outside_scope", {
          namespace: target,
          namespaceSource: source,
          fix,
        });
      }
    }

    return null;
  }
}
