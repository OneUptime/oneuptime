import {
  KUBECTL_WRITE_NAMESPACES_ENV,
  KubectlCommandTier,
  RUNNER_POD_NAMESPACE_ENV,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * Where an AI-composed kubectl WRITE lands, and whether this Runner lets it
 * land there — the Runner's own namespace bound, checked before anything
 * spawns and independent of RBAC.
 *
 * RBAC alone is not a namespace bound worth the name: patch/update on a
 * workload's pod template, or create on a job, is running any image as any
 * ServiceAccount of that namespace and mounting its Secrets. So the Runner
 * refuses, before spawning, every non-Read argv whose effective namespace is
 *
 *   - the namespace this Runner's pod runs in (RUNNER_POD_NAMESPACE_ENV): a
 *     change there could scale the Kubernetes agent — or this Runner, and
 *     with it any rollback — away. A namespaced write with no -n runs in
 *     the pod's own namespace in-cluster, so a missing -n counts as that
 *     namespace; or
 *   - outside KUBECTL_WRITE_NAMESPACES_ENV when that list is non-empty (the
 *     chart passes the namespaces it bound write RBAC in).
 *
 * Reads are never namespace-restricted. Verbs that only ever act on nodes
 * (cordon, uncordon, drain, taint) are cluster-scoped: -n means nothing to
 * them, so they are not namespace-scoped here either.
 *
 * The namespace is read the way kubectl reads it (-n x, -nx, -n=x,
 * --namespace x, --namespace=x, inside a cluster of boolean short flags
 * such as -An x), and every namespace the argv sets must be allowed, not
 * just the last one kubectl uses; a write across all namespaces (-A) is
 * never inside a scope. What this reader cannot decide for
 * certain — a namespace flag that the flag before it might swallow as its
 * value, a namespace flag after `--` — is refused rather than guessed, with
 * the unambiguous spelling in the message: `kubectl -n <namespace> ...`.
 */

// Verbs whose objects are always nodes: cluster-scoped, not namespaced.
const NODE_ONLY_VERBS: Set<string> = new Set<string>([
  "cordon",
  "uncordon",
  "drain",
  "taint",
]);

/*
 * Short flags the shared policy knows, by arity. Every letter OneUptime AI
 * may use is one of these (the policy refuses the rest), so a cluster is
 * read exactly: boolean letters continue the cluster, a value letter takes
 * the rest of the token (or, when nothing is left, the next token).
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
 * --validate), which only take a value written with "=". Only used to
 * decide that a namespace flag right after one of these IS a flag; a flag
 * missing from this list makes that namespace flag ambiguous, which is
 * refused — so a gap here can only ever cost a refusal, never a bypass.
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

// A negative number or duration (`-1`, `-5s`): a value, never a flag.
const NEGATIVE_NUMBER_TOKEN: RegExp = /^-\d/;

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

function normalizeLongFlagName(name: string): string {
  // kubectl reads "_" as "-" in a long flag name.
  return name.replace(/_/g, "-");
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
    const name: string = normalizeLongFlagName(
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
    const name: string = normalizeLongFlagName(
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

    return NON_CONSUMING_LONG_FLAGS.has(normalizeLongFlagName(token.slice(2)))
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
   * Why this Runner will not run this argv in the namespace it targets, or
   * null when it may. `defaultNamespace` is what a missing -n means on this
   * path: the pod's own namespace in-cluster (null when unknown), "default"
   * for a kubeconfig built from a credential (it names no namespace).
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

    const verb: string = (data.verb.split(" ")[0] || "").toLowerCase();

    if (NODE_ONLY_VERBS.has(verb)) {
      return null;
    }

    const scopeDescription: string = KubectlWriteScope.describeScope({
      writeNamespaces,
      podNamespace,
    });

    const resolution: KubectlNamespaceResolution =
      KubectlWriteScope.resolveNamespaces(data.args);

    if (resolution.ambiguity) {
      return `this Runner cannot tell for certain which namespace "${data.displayCommand}" changes (${resolution.ambiguity}). ${scopeDescription} Put the namespace first so it cannot be misread: kubectl -n <namespace> ...`;
    }

    /*
     * The shared policy already denies a write across all namespaces; this
     * layer does not rely on that — every namespace includes the ones this
     * Runner may not change.
     */
    if (resolution.allNamespaces) {
      return `"${data.displayCommand}" would change every namespace, including ones this Runner may not change. ${scopeDescription} Name one namespace with -n <namespace>.`;
    }

    const explicit: boolean = resolution.namespaces.length > 0;
    const targets: Array<string> = explicit
      ? resolution.namespaces.map((namespace: string) => {
          return namespace.trim().toLowerCase();
        })
      : [(data.defaultNamespace || "").trim().toLowerCase()];

    for (const target of targets) {
      if (!target) {
        return `"${data.displayCommand}" names no namespace and this Runner cannot tell which one it would change. ${scopeDescription} Name the namespace with -n <namespace>.`;
      }

      if (podNamespace && target === podNamespace) {
        return explicit
          ? `"${data.displayCommand}" would change namespace "${target}", the namespace this Runner itself runs in — a change there could scale away or reconfigure the Kubernetes agent or this Runner, so OneUptime AI never makes one. ${scopeDescription}`
          : `"${data.displayCommand}" names no namespace, so kubectl would run it in "${target}", the namespace this Runner itself runs in — a change there could scale away or reconfigure the Kubernetes agent or this Runner, so OneUptime AI never makes one. ${scopeDescription} Name the target namespace with -n <namespace>.`;
      }

      if (writeNamespaces.length > 0 && !writeNamespaces.includes(target)) {
        return explicit
          ? `"${data.displayCommand}" would change namespace "${target}", which is outside the namespaces this Runner lets OneUptime AI change. ${scopeDescription}`
          : `"${data.displayCommand}" names no namespace, so kubectl would run it in "${target}", which is outside the namespaces this Runner lets OneUptime AI change. ${scopeDescription} Name the target namespace with -n <namespace>.`;
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
