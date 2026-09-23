import {
  KUBECTL_WRITE_NAMESPACES_ENV,
  KubectlCommandTier,
  RUNNER_POD_NAMESPACE_ENV,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { normalizeKubectlFlagName } from "Common/Utils/AiRemediation/KubectlPolicy";

/*
 * Where an AI-composed kubectl WRITE lands, and whether this Runner lets it
 * land there — the Runner's own namespace bound, checked before anything
 * spawns and independent of RBAC.
 *
 * RBAC alone is not a namespace bound worth the name: patch/update on a
 * workload's pod template, or create on a job, is running any image as any
 * ServiceAccount of that namespace and mounting its Secrets. So the Runner
 * refuses, before spawning, every non-Read argv that changes something
 *
 *   - in the namespace this Runner's pod runs in (RUNNER_POD_NAMESPACE_ENV):
 *     a change there could scale the Kubernetes agent — or this Runner, and
 *     with it any rollback — away. A namespaced write with no -n runs in
 *     the pod's own namespace in-cluster, so a missing -n counts as that
 *     namespace; or
 *   - outside KUBECTL_WRITE_NAMESPACES_ENV when that list is non-empty (the
 *     chart passes the namespaces it bound write RBAC in).
 *
 * What a write changes decides how it is judged, the way kubectl decides
 * it — kubectl ignores -n for an object that lives outside every namespace:
 *
 *   - a namespaced object (a pod, a workload, a custom resource) is judged
 *     by the namespace it lands in: -n, or the default namespace without it;
 *   - a Namespace object is judged by its NAME — `label namespace X` changes
 *     namespace X, whatever -n says — so only a namespace this Runner may
 *     write in can be changed, never its own;
 *   - a Node, and every node verb (cordon, uncordon, drain, taint), is a
 *     node operation: not namespace-scoped here, but governed by the node
 *     switch (KUBECTL_ALLOW_NODE_OPERATIONS_ENV, see resolveTargets);
 *   - any other cluster-scoped object (a PersistentVolume, a StorageClass,
 *     an IngressClass, a ClusterRole, a CRD, ...) is outside every
 *     namespace: refused when the write-namespace list is non-empty (the
 *     chart's namespaced RoleBindings could not grant it anyway), left to
 *     RBAC when it is empty.
 *
 * A write that changes several kinds of object meets every rule that
 * applies to one of them. Reads are never namespace-restricted.
 *
 * Only the built-in cluster-scoped kinds are known here (by every name
 * kubectl resolves: plural, singular, short name, Kind case and
 * group-qualified in their own API group). A custom resource is read as
 * namespaced — this Runner cannot run discovery before it decides — so a
 * cluster-scoped custom resource is judged by -n like a namespaced one. On
 * the in-cluster Runner with a write-namespace list its RoleBindings cannot
 * grant one anyway; elsewhere the credential's RBAC bounds it.
 *
 * The objects and the namespace are read the way kubectl reads the argv:
 * every flag by its arity (the same table the shared policy parses with —
 * a flag this Runner does not know makes the objects uncertain, which is
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
 * kind the named object is.
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
 * The built-in kinds that live outside any namespace, and the API group
 * each lives in. A group-qualified spelling counts only in that group
 * (`storageclasses.storage.k8s.io`, `nodes.v1.`); `nodes.example.com` is
 * some custom resource. A superset of the shared policy's
 * CLUSTER_SCOPED_KINDS (the scope test pins that parity through the
 * policy's own verdicts).
 */
const CLUSTER_SCOPED_KIND_GROUPS: Record<string, string> = {
  node: "",
  namespace: "",
  persistentvolume: "",
  componentstatus: "",
  storageclass: "storage.k8s.io",
  csidriver: "storage.k8s.io",
  csinode: "storage.k8s.io",
  volumeattachment: "storage.k8s.io",
  volumeattributesclass: "storage.k8s.io",
  customresourcedefinition: "apiextensions.k8s.io",
  apiservice: "apiregistration.k8s.io",
  mutatingwebhookconfiguration: "admissionregistration.k8s.io",
  validatingwebhookconfiguration: "admissionregistration.k8s.io",
  validatingadmissionpolicy: "admissionregistration.k8s.io",
  validatingadmissionpolicybinding: "admissionregistration.k8s.io",
  mutatingadmissionpolicy: "admissionregistration.k8s.io",
  mutatingadmissionpolicybinding: "admissionregistration.k8s.io",
  clusterrole: "rbac.authorization.k8s.io",
  clusterrolebinding: "rbac.authorization.k8s.io",
  priorityclass: "scheduling.k8s.io",
  ingressclass: "networking.k8s.io",
  ipaddress: "networking.k8s.io",
  servicecidr: "networking.k8s.io",
  runtimeclass: "node.k8s.io",
  certificatesigningrequest: "certificates.k8s.io",
  clustertrustbundle: "certificates.k8s.io",
  flowschema: "flowcontrol.apiserver.k8s.io",
  prioritylevelconfiguration: "flowcontrol.apiserver.k8s.io",
  deviceclass: "resource.k8s.io",
  resourceslice: "resource.k8s.io",
};

// Every name kubectl resolves to one of those kinds (lowercased).
const CLUSTER_SCOPED_KIND_NAMES: Record<string, string> = {
  no: "node",
  nodes: "node",
  node: "node",
  ns: "namespace",
  namespaces: "namespace",
  namespace: "namespace",
  pv: "persistentvolume",
  persistentvolumes: "persistentvolume",
  persistentvolume: "persistentvolume",
  cs: "componentstatus",
  componentstatuses: "componentstatus",
  componentstatus: "componentstatus",
  sc: "storageclass",
  storageclasses: "storageclass",
  storageclass: "storageclass",
  csidrivers: "csidriver",
  csidriver: "csidriver",
  csinodes: "csinode",
  csinode: "csinode",
  volumeattachments: "volumeattachment",
  volumeattachment: "volumeattachment",
  vac: "volumeattributesclass",
  volumeattributesclasses: "volumeattributesclass",
  volumeattributesclass: "volumeattributesclass",
  crd: "customresourcedefinition",
  crds: "customresourcedefinition",
  customresourcedefinitions: "customresourcedefinition",
  customresourcedefinition: "customresourcedefinition",
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
  clusterroles: "clusterrole",
  clusterrole: "clusterrole",
  clusterrolebindings: "clusterrolebinding",
  clusterrolebinding: "clusterrolebinding",
  pc: "priorityclass",
  priorityclasses: "priorityclass",
  priorityclass: "priorityclass",
  ingressclasses: "ingressclass",
  ingressclass: "ingressclass",
  ipaddresses: "ipaddress",
  ipaddress: "ipaddress",
  servicecidrs: "servicecidr",
  servicecidr: "servicecidr",
  runtimeclasses: "runtimeclass",
  runtimeclass: "runtimeclass",
  csr: "certificatesigningrequest",
  certificatesigningrequests: "certificatesigningrequest",
  certificatesigningrequest: "certificatesigningrequest",
  clustertrustbundles: "clustertrustbundle",
  clustertrustbundle: "clustertrustbundle",
  flowschemas: "flowschema",
  flowschema: "flowschema",
  prioritylevelconfigurations: "prioritylevelconfiguration",
  prioritylevelconfiguration: "prioritylevelconfiguration",
  deviceclasses: "deviceclass",
  deviceclass: "deviceclass",
  resourceslices: "resourceslice",
  resourceslice: "resourceslice",
};

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
}

function describeUnknownFlag(flag: string): string {
  return `"${flag}" is a flag this Runner does not know, so it cannot tell whether the flag takes the next word as its value`;
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
      const name: string = normalizeKubectlFlagName(
        eq >= 0 ? token.slice(2, eq) : token.slice(2),
      );
      const arity: FlagArity | null = lookupFlagArity(name, verb);

      if (arity === null) {
        return { positionals, uncertainty: describeUnknownFlag(token) };
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

  return { positionals, uncertainty: null };
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
 * The built-in cluster-scoped kind a written kind names, or null for any
 * other kind (namespaced, or a custom resource whose scope this Runner
 * cannot see). kubectl reads "RESOURCE.GROUP" and "RESOURCE.VERSION.GROUP"
 * ("nodes.v1." for the core group); only the kind's own group counts.
 */
function clusterScopedKindOf(rawKind: string): string | null {
  const lower: string = rawKind.trim().toLowerCase();
  const dot: number = lower.indexOf(".");
  const head: string = dot >= 0 ? lower.slice(0, dot) : lower;

  if (!hasOwn(CLUSTER_SCOPED_KIND_NAMES, head)) {
    return null;
  }

  const kind: string = CLUSTER_SCOPED_KIND_NAMES[head]!;

  if (dot < 0) {
    return kind;
  }

  const group: string = CLUSTER_SCOPED_KIND_GROUPS[kind] ?? "";
  const qualifier: string = lower.slice(dot + 1);

  // RESOURCE.GROUP
  if (qualifier === group) {
    return kind;
  }

  // RESOURCE.VERSION.GROUP
  const versionDot: number = qualifier.indexOf(".");

  if (versionDot >= 0 && qualifier.slice(versionDot + 1) === group) {
    return kind;
  }

  return null;
}

/*
 * What a write changes, as far as this Runner's scope rules care (see the
 * header). Everything is decided from the argv alone.
 */
export interface KubectlWriteTargets {
  // The verb kubectl runs (the first positional), lowercased; "" when none.
  verb: string;
  // Why the objects cannot be read for certain, or null.
  uncertainty: string | null;
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
          `"${token}" combines "n" with a short flag this Runner does not know`,
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
   * changes lives in a namespace. The executor also asks this for the node
   * switch (KUBECTL_ALLOW_NODE_OPERATIONS_ENV), before the namespace scope.
   */
  public static resolveTargets(args: Array<string>): KubectlWriteTargets {
    const targets: KubectlWriteTargets = {
      verb: "",
      uncertainty: null,
      touchesNodes: false,
      namespaceObjects: [],
      unnamedNamespaceObjects: false,
      clusterScopedKinds: [],
      namespaced: false,
    };

    const reading: PositionalsReading = readPositionals(args);

    if (reading.uncertainty !== null) {
      targets.uncertainty = reading.uncertainty;
      return targets;
    }

    const positionals: Array<string> = reading.positionals;
    const verb: string = (positionals[0] || "").toLowerCase();
    targets.verb = verb;

    // cordon, uncordon, drain and taint only ever act on nodes.
    if (NODE_VERBS.has(verb)) {
      targets.touchesNodes = true;
      return targets;
    }

    if (verb === "create") {
      // cobra matches subcommands case-sensitively (the policy denies others).
      const subcommand: string = positionals[1] || "";

      if (!hasOwn(CREATE_SUBCOMMAND_SCOPES, subcommand)) {
        targets.uncertainty = `"create ${subcommand}" is not a kubectl create subcommand this Runner knows`;
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
      return targets;
    }

    /*
     * No object at all is a kubectl error; judging it as namespaced keeps
     * the stricter rule. expose and autoscale make a namespaced Service or
     * HorizontalPodAutoscaler whatever they name.
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
   * own verdicts: every flag name this Runner knows the arity of, a flag's
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
   * Why this Runner will not run this argv where it lands, or null when it
   * may. `defaultNamespace` is what a missing -n means on this path: the
   * pod's own namespace in-cluster (null when unknown), "default" for a
   * kubeconfig built from a credential (it names no namespace). `verb` is
   * the shared policy's verb label; the objects are read here again, and a
   * reading that disagrees with the policy's verb is refused.
   *
   * Node operations are not namespace-scoped here; the executor holds them
   * to the node switch before it asks this.
   */
  public static getRefusalReason(data: {
    args: Array<string>;
    tier: KubectlCommandTier;
    verb: string;
    displayCommand: string;
    writeNamespaces: Array<string>;
    podNamespace: string | null;
    defaultNamespace: string | null;
  }): string | null {
    if (data.tier === KubectlCommandTier.Read) {
      return null;
    }

    const writeNamespaces: Array<string> = data.writeNamespaces
      .map((namespace: string) => {
        return namespace.trim().toLowerCase();
      })
      .filter((namespace: string) => {
        return namespace.length > 0;
      });
    const podNamespace: string =
      (data.podNamespace || "").trim().toLowerCase() || "";

    if (writeNamespaces.length === 0 && !podNamespace) {
      return null;
    }

    const command: string = data.displayCommand;
    const scopeDescription: string = KubectlWriteScope.describeScope({
      writeNamespaces,
      podNamespace,
    });

    const targets: KubectlWriteTargets = KubectlWriteScope.resolveTargets(
      data.args,
    );

    if (targets.uncertainty !== null) {
      /*
       * A namespace flag that another flag may swallow is the usual cause
       * (`--selector -n web` makes "web" an object); say so, with the
       * spelling that cannot be misread.
       */
      const namespaceReading: KubectlNamespaceResolution =
        KubectlWriteScope.resolveNamespaces(data.args);

      if (namespaceReading.ambiguity) {
        return `this Runner cannot tell for certain which namespace "${command}" changes (${namespaceReading.ambiguity}). ${scopeDescription} Put the namespace first so it cannot be misread: kubectl -n <namespace> ...`;
      }

      return `this Runner cannot tell for certain which objects "${command}" changes (${targets.uncertainty}). ${scopeDescription} Name the objects right after the verb (TYPE NAME or TYPE/NAME) and give each flag its value with "=" (--selector=app=web).`;
    }

    const policyVerb: string = (data.verb.split(" ")[0] || "").toLowerCase();

    if (policyVerb && policyVerb !== targets.verb) {
      return `this Runner reads the verb of "${command}" as "${targets.verb}", but the kubectl policy read "${policyVerb}", so it cannot tell for certain what the command changes. ${scopeDescription}`;
    }

    /*
     * A Namespace object is judged by its name: kubectl ignores -n for it,
     * so `label namespace X ... -n <allowed>` changes X.
     */
    if (targets.unnamedNamespaceObjects) {
      return `"${command}" would change Namespace objects without naming them (a selector, --all or no name at all), so this Runner cannot tell whether one of them is ${
        podNamespace
          ? `"${podNamespace}", the namespace it runs in`
          : "outside the namespaces it lets OneUptime AI change"
      }. ${scopeDescription} Name each Namespace object.`;
    }

    for (const name of targets.namespaceObjects) {
      if (podNamespace && name === podNamespace) {
        return `"${command}" would change the Namespace object "${name}" — the namespace this Runner itself runs in; a change there could reconfigure the Kubernetes agent or this Runner, so OneUptime AI never makes one. ${scopeDescription}`;
      }

      if (writeNamespaces.length > 0 && !writeNamespaces.includes(name)) {
        return `"${command}" would change the Namespace object "${name}", which is outside the namespaces this Runner lets OneUptime AI change (a Namespace object is judged by its name; -n does not apply to it). ${scopeDescription}`;
      }
    }

    /*
     * Any other cluster-scoped object lives outside every namespace, so
     * outside every listed one. Without a list, RBAC bounds it.
     */
    if (targets.clusterScopedKinds.length > 0 && writeNamespaces.length > 0) {
      return `"${command}" changes ${targets.clusterScopedKinds.join(
        ", ",
      )} objects, which are cluster-scoped: they live outside every namespace, so outside the namespaces this Runner lets OneUptime AI change, whatever -n says. ${scopeDescription}`;
    }

    if (!targets.namespaced) {
      return null;
    }

    const resolution: KubectlNamespaceResolution =
      KubectlWriteScope.resolveNamespaces(data.args);

    if (resolution.ambiguity) {
      return `this Runner cannot tell for certain which namespace "${command}" changes (${resolution.ambiguity}). ${scopeDescription} Put the namespace first so it cannot be misread: kubectl -n <namespace> ...`;
    }

    /*
     * The shared policy already denies a write across all namespaces; this
     * layer does not rely on that — every namespace includes the ones this
     * Runner may not change.
     */
    if (resolution.allNamespaces) {
      return `"${command}" would change every namespace, including ones this Runner may not change. ${scopeDescription} Name one namespace with -n <namespace>.`;
    }

    const explicit: boolean = resolution.namespaces.length > 0;
    const namespaces: Array<string> = explicit
      ? resolution.namespaces.map((namespace: string) => {
          return namespace.trim().toLowerCase();
        })
      : [(data.defaultNamespace || "").trim().toLowerCase()];

    for (const target of namespaces) {
      if (!target) {
        return `"${command}" names no namespace and this Runner cannot tell which one it would change. ${scopeDescription} Name the namespace with -n <namespace>.`;
      }

      if (podNamespace && target === podNamespace) {
        return explicit
          ? `"${command}" would change namespace "${target}", the namespace this Runner itself runs in — a change there could scale away or reconfigure the Kubernetes agent or this Runner, so OneUptime AI never makes one. ${scopeDescription}`
          : `"${command}" names no namespace, so kubectl would run it in "${target}", the namespace this Runner itself runs in — a change there could scale away or reconfigure the Kubernetes agent or this Runner, so OneUptime AI never makes one. ${scopeDescription} Name the target namespace with -n <namespace>.`;
      }

      if (writeNamespaces.length > 0 && !writeNamespaces.includes(target)) {
        return explicit
          ? `"${command}" would change namespace "${target}", which is outside the namespaces this Runner lets OneUptime AI change. ${scopeDescription}`
          : `"${command}" names no namespace, so kubectl would run it in "${target}", which is outside the namespaces this Runner lets OneUptime AI change. ${scopeDescription} Name the target namespace with -n <namespace>.`;
      }
    }

    return null;
  }

  private static describeScope(data: {
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
}
