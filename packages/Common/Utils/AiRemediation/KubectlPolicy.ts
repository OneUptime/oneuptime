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
 * Flags that take a value in the NEXT token when not written as --flag=value.
 * Needed to find the verb and the positional resource tokens correctly. An
 * unknown value-taking flag misparses conservatively: its value becomes the
 * verb, which is unknown, which is Denied.
 */
const VALUE_FLAGS: Set<string> = new Set<string>([
  "n",
  "namespace",
  "o",
  "output",
  "l",
  "selector",
  "c",
  "container",
  "since",
  "since-time",
  "tail",
  "limit-bytes",
  "field-selector",
  "sort-by",
  "replicas",
  "current-replicas",
  "timeout",
  "request-timeout",
  "revision",
  "to-revision",
  "image",
  "containers",
  "resource-version",
  "grace-period",
  "chunk-size",
  "L",
  "label-columns",
  "template",
  "type",
  "max-log-requests",
  "pod-running-timeout",
  "from",
  "subresource",
  "min",
  "max",
  "cpu-percent",
  "port",
  "target-port",
  "protocol",
  "name",
  "external-ip",
  "cluster-ip",
  "load-balancer-ip",
  "resource",
  "resource-name",
  "limits",
  "requests",
  "env",
  "e",
  "keys",
  "from-literal",
  "from-file",
  "pod-selector",
  "for",
  "restart",
  "schedule",
  "command",
  "delete-emptydir-data",
  "skip-wait-for-delete-timeout",
  "pod-network",
  "cascade",
  "field-manager",
  "dry-run",
  "resource-group",
]);

/*
 * Flags that can only ever mean "talk to a different cluster / as someone
 * else / with different credentials", or that turn kubectl into an arbitrary
 * API client or leak request bodies into output. Denied everywhere.
 */
const DENIED_FLAGS: Set<string> = new Set<string>([
  "kubeconfig",
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
  "cache-dir",
  "profile",
  "profile-output",
  "raw",
  "kustomize",
  "k",
  "filename",
  "f",
  "recursive",
  "R",
  "follow",
  "v",
  "vmodule",
  "log-file",
  "log-dir",
  "warnings-as-errors",
  "disable-compression",
]);

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
}

function normalizeKind(token: string): string {
  const lower: string = token.toLowerCase();
  /*
   * "pods.v1." / "deployments.apps" fully-qualified forms: keep the leading
   * segment, which is the kind.
   */
  const head: string = lower.split(".")[0] || lower;
  return KIND_ALIASES[head] || head;
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

    // Credential / cluster-selection / arbitrary-API flags: never.
    for (const flagName of parsed.flags.keys()) {
      if (DENIED_FLAGS.has(flagName)) {
        return deny(
          `the --${flagName} flag is not allowed (OneUptime AI may only use the cluster access it was given, and never file inputs, raw API paths, verbose request logging or streaming)`,
        );
      }
    }

    const verb: string = (parsed.positionals[0] || "").toLowerCase();

    if (!verb) {
      return deny("The command names no kubectl verb.");
    }

    if (DENIED_VERBS.has(verb)) {
      return deny(`kubectl ${verb} is not allowed for OneUptime AI`, verb);
    }

    const hasAllNamespaces: boolean =
      parsed.flags.has("A") || parsed.flags.has("all-namespaces");
    const hasAll: boolean = parsed.flags.has("all");
    const hasSelector: boolean =
      parsed.flags.has("l") || parsed.flags.has("selector");
    const hasForce: boolean = parsed.flags.has("force");

    const subcommand: string = (parsed.positionals[1] || "").toLowerCase();

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
      const kinds: Set<string> = new Set<string>();
      let namedCount: number = 0;

      for (let i: number = 0; i < kindTokens.length; i++) {
        const token: string = kindTokens[i]!;
        if (token.includes("/")) {
          kinds.add(normalizeKind(token.split("/")[0] || ""));
          namedCount++;
        } else if (i === 0) {
          // Possibly comma-separated kinds: "delete pod,job foo".
          for (const part of token.split(",")) {
            kinds.add(normalizeKind(part));
          }
        } else {
          namedCount++;
        }
      }

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

  private static parseArgs(args: Array<string>): ParsedArgs {
    const positionals: Array<string> = [];
    const flags: Map<string, Array<string>> = new Map<string, Array<string>>();

    const record: (name: string, value: string) => void = (
      name: string,
      value: string,
    ): void => {
      const existing: Array<string> = flags.get(name) || [];
      existing.push(value);
      flags.set(name, existing);
    };

    let afterDoubleDash: boolean = false;

    for (let i: number = 0; i < args.length; i++) {
      const token: string = args[i]!;

      if (afterDoubleDash) {
        positionals.push(token);
        continue;
      }

      if (token === "--") {
        afterDoubleDash = true;
        continue;
      }

      if (token.startsWith("--") && token.length > 2) {
        const eq: number = token.indexOf("=");
        const name: string = eq >= 0 ? token.slice(2, eq) : token.slice(2);
        if (eq >= 0) {
          record(name, token.slice(eq + 1));
        } else if (VALUE_FLAGS.has(name) && i + 1 < args.length) {
          record(name, args[i + 1]!);
          i++;
        } else {
          record(name, "");
        }
        continue;
      }

      if (token.startsWith("-") && token.length > 1) {
        const eq: number = token.indexOf("=");
        const name: string = eq >= 0 ? token.slice(1, eq) : token.slice(1, 2);
        const inline: string =
          eq >= 0
            ? token.slice(eq + 1)
            : token.length > 2
              ? token.slice(2)
              : "";

        if (inline) {
          record(name, inline);
        } else if (VALUE_FLAGS.has(name) && i + 1 < args.length) {
          record(name, args[i + 1]!);
          i++;
        } else {
          record(name, "");
        }
        continue;
      }

      positionals.push(token);
    }

    return { positionals, flags };
  }
}
