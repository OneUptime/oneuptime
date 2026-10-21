/*
 * The Runner's own, deliberately simple, last look at a kubectl argv before
 * it spawns — independent of the shared KubectlPolicy on purpose.
 *
 * KubectlPolicy is a full parser: it knows verbs, tiers and which flags take
 * values, and the Runner re-runs it on every argv. This guard is the belt to
 * that brace. It does not try to understand the command; it only answers one
 * question — does anything in this argv make kubectl read or write a file on
 * this host, talk to a different cluster, act as someone else, or spell a
 * denied flag in a way a parser could misread? — and refuses if so. Two
 * independent checks with different shapes are much harder to get past with
 * one clever token than either alone.
 *
 * What it refuses, everywhere in the argv (after `--` too, which is stricter
 * than kubectl):
 *
 *   - file-backed output formats: any -o/--output value whose format (the
 *     part before the first `=`) names a file — jsonpath-file,
 *     go-template-file, custom-columns-file and the legacy templatefile —
 *     and --template. kubectl reads the named path and echoes text outside
 *     the template verbatim, so `-o jsonpath-file=/var/run/secrets/.../token`
 *     prints the pod's ServiceAccount token into the output the Runner ships
 *     to the server, the model and the dashboard — from a Read-tier `get`.
 *   - flags that select credentials, preferences, a cluster or an identity
 *     (--kubeconfig, --kuberc, --token, --server/-s, --as and every --as-*
 *     such as --as-group, --as-uid and --as-user-extra, --context,
 *     --cluster, --user, --username, --password, client certificate flags,
 *     --insecure-skip-tls-verify, --tls-server-name), that read files as
 *     input (-f/--filename, -k/--kustomize, -R/--recursive, --patch-file,
 *     --from-file, --from-env-file, --cert, --key), that turn kubectl into a
 *     raw API client (--raw), that write files (--cache-dir, --profile,
 *     --profile-output, --log-file, --log-dir) or that log request bodies
 *     (-v, --vmodule), and flags that replace the object kubectl creates
 *     with whatever their value describes (--overrides, --override-type on
 *     expose and run). Combined short-flag clusters are walked character by
 *     character the way pflag does, so `-Rf`, `-Af` and `-pf` are caught as
 *     well as `-f`, and an inline value such as `-nweb` is a value, not four
 *     flags.
 *   - every spelling kubectl reads as one of those names: long flag names
 *     are compared lowercased (stricter than kubectl) and with "_" read as
 *     "-", the way kubectl's flag normalizer (cliflag.WordSepNormalizeFunc)
 *     reads them — `--from_file` IS `--from-file` to kubectl, so it is to
 *     this guard too.
 *
 * Two exceptions follow the verb, and only when the verb is certain (the
 * first token, or the first after kubectl's own global -n/--namespace/
 * --request-timeout flags). Both mirror a verb-specific meaning the shared
 * policy already allows, so the two layers never disagree about an argv the
 * policy passed:
 *
 *   - `explain --recursive` (bare, =true or =false) prints every field of a
 *     resource's documentation and reads nothing; on every other verb
 *     --recursive walks a directory of manifests and stays refused, and so
 *     does -R everywhere.
 *   - on `patch`, -p is --patch and takes a value: everything after the
 *     `p` of `-p'{"spec":...}'` is the patch, not a cluster of flags. On
 *     every other verb `p` stays a boolean letter (on logs it is
 *     --previous, so `logs -pf` is still caught as --follow's neighbour -f).
 */

// Long flag names refused wherever they appear. `as-*` is matched by prefix.
const DENIED_LONG_FLAGS: Set<string> = new Set<string>([
  "kubeconfig",
  "kuberc",
  "token",
  "server",
  "as",
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
  "raw",
  "filename",
  "kustomize",
  "recursive",
  "template",
  "patch-file",
  "from-file",
  "from-env-file",
  "cert",
  "key",
  "cache-dir",
  "profile",
  "profile-output",
  "log-file",
  "log-dir",
  "v",
  "vmodule",
  // They replace the object kubectl creates (see OBJECT_REPLACING_LONG_FLAGS).
  "overrides",
  "override-type",
]);

/*
 * Long flags (in DENIED_LONG_FLAGS) that replace the object kubectl builds
 * — `kubectl expose` and `kubectl run` merge --overrides into the Service or
 * Pod they generate, and create whatever the merge describes: a
 * ClusterRoleBinding, a Namespace, a privileged Job. The shared policy
 * denies them too; refused here as well, so no parser drift can let one
 * through.
 */
const OBJECT_REPLACING_LONG_FLAGS: Set<string> = new Set<string>([
  "overrides",
  "override-type",
]);

// Short flags refused wherever they appear, alone or inside a cluster.
const DENIED_SHORT_FLAGS: Set<string> = new Set<string>([
  "s",
  "f",
  "k",
  "R",
  "v",
]);

/*
 * Short flags that take a value: in a cluster, everything after them is
 * that value (`-nweb` is namespace "web"). Denied shorts are checked before
 * this set is consulted, so listing `s`/`f`/`k`/`v` here is only for
 * completeness.
 */
const VALUE_TAKING_SHORT_FLAGS: Set<string> = new Set<string>([
  "n",
  "o",
  "l",
  "c",
  "L",
  "e",
  "s",
  "f",
  "k",
  "v",
]);

/*
 * kubectl splits an output value on its first `=` into the format and the
 * template (`jsonpath-file=/path`), and every format that reads that
 * template from a path has "file" in its name: jsonpath-file,
 * go-template-file, custom-columns-file and the legacy templatefile (no
 * dash — which is why the marker is the bare word). No inline format does
 * (json, yaml, name, wide, jsonpath, jsonpath-as-json, go-template,
 * template, custom-columns), so a file-reading format kubectl adds later is
 * refused by construction. Only the format is inspected: a template that
 * merely mentions a file in a field path is inline, and inline is fine.
 */
const FILE_BACKED_OUTPUT_MARKER: string = "file";

// A negative number or duration (`-1`, `-5s`): a value, never a flag.
const NEGATIVE_NUMBER_TOKEN: RegExp = /^-\d/;

/*
 * kubectl's global flags that take a value and may precede the verb. The
 * verb is only "certain" when nothing else comes before it: kubectl picks
 * the command before it parses flags, and any other flag there makes the
 * word after it ambiguous (the shared policy refuses such an argv anyway).
 */
const GLOBAL_VALUE_LONG_FLAGS: Set<string> = new Set<string>([
  "namespace",
  "request-timeout",
]);

const GLOBAL_BOOLEAN_LONG_FLAGS: Set<string> = new Set<string>([
  "match-server-version",
]);

// The values --recursive may carry on `explain`, where it is a boolean.
const EXPLAIN_RECURSIVE_VALUES: Set<string> = new Set<string>([
  "",
  "true",
  "false",
]);

/*
 * A long flag's name the way kubectl reads it: "_" is "-". Lowercased too,
 * which kubectl does not do — a guard that is stricter than kubectl costs
 * nothing, one that is looser is a bypass.
 */
function normalizeLongFlagName(name: string): string {
  return name.toLowerCase().replace(/_/g, "-");
}

function describeDeniedFlag(flag: string): string {
  return `the ${flag} flag is not allowed on this Runner (OneUptime AI may only use the cluster access this Runner was given, and kubectl may never read or write files on the Runner's host, use another identity, or issue raw API requests)`;
}

function describeObjectReplacingFlag(flag: string): string {
  return `the ${flag} flag is not allowed on this Runner (it replaces the object kubectl creates with whatever its value describes — any kind, in any namespace — so what the command changes cannot be known before it runs)`;
}

function describeFileBackedOutput(value: string): string {
  return `the output format "${value}" reads a template file from the Runner's host and echoes its contents; only inline output formats (json, yaml, wide, name, jsonpath=..., custom-columns=..., go-template=...) are allowed`;
}

function isFileBackedOutputFormat(value: string): boolean {
  const eq: number = value.indexOf("=");
  const format: string = (eq >= 0 ? value.slice(0, eq) : value).toLowerCase();

  return format.includes(FILE_BACKED_OUTPUT_MARKER);
}

export default class KubectlArgvGuard {
  // The long flag names refused everywhere (test seam, for exhaustive tests).
  public static readonly deniedLongFlags: ReadonlyArray<string> =
    Array.from(DENIED_LONG_FLAGS);

  /*
   * Why this argv must not spawn, or null when nothing here is refused.
   * Independent of KubectlPolicy: a null from here still needs the policy's
   * tier verdict before anything runs.
   */
  public static getRefusalReason(args: Array<string>): string | null {
    const verb: string | null = KubectlArgvGuard.getCertainVerb(args);

    for (let i: number = 0; i < args.length; i++) {
      const token: string = args[i]!;
      const next: string = args[i + 1] ?? "";

      /*
       * Positionals, the bare `--` separator, and negative numbers
       * (`--tail -1`, `--since -5s`) are never flags to kubectl.
       */
      if (
        !token.startsWith("-") ||
        token === "-" ||
        token === "--" ||
        NEGATIVE_NUMBER_TOKEN.test(token)
      ) {
        continue;
      }

      if (token.startsWith("--")) {
        const reason: string | null = KubectlArgvGuard.checkLongFlag(
          token,
          next,
          verb,
        );
        if (reason) {
          return reason;
        }
        continue;
      }

      const reason: string | null = KubectlArgvGuard.checkShortCluster(
        token,
        next,
        verb,
      );
      if (reason) {
        return reason;
      }
    }

    return null;
  }

  /*
   * The verb kubectl will run, when it is certain: the first token that is
   * not a flag, with only kubectl's global -n/--namespace/--request-timeout
   * (and their values) and --match-server-version allowed before it. Any
   * other flag before the verb, or a `--`, makes it uncertain, and an
   * uncertain verb earns none of the verb-specific exceptions.
   */
  public static getCertainVerb(args: Array<string>): string | null {
    for (let i: number = 0; i < args.length; i++) {
      const token: string = args[i]!;

      if (!token.startsWith("-") || token === "-") {
        return token;
      }

      if (token === "--") {
        return null;
      }

      if (token.startsWith("--")) {
        const eq: number = token.indexOf("=");
        const name: string = normalizeLongFlagName(
          eq >= 0 ? token.slice(2, eq) : token.slice(2),
        );

        if (GLOBAL_VALUE_LONG_FLAGS.has(name)) {
          if (eq < 0) {
            i++; // Its value is the next token, whatever it looks like.
          }
          continue;
        }

        if (GLOBAL_BOOLEAN_LONG_FLAGS.has(name)) {
          continue;
        }

        return null;
      }

      // -n web, -nweb, -n=web: the only short global flag.
      if (token.startsWith("-n")) {
        if (token === "-n") {
          i++;
        }
        continue;
      }

      return null;
    }

    return null;
  }

  private static checkLongFlag(
    token: string,
    next: string,
    verb: string | null,
  ): string | null {
    const eq: number = token.indexOf("=");
    const name: string = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    const normalized: string = normalizeLongFlagName(name);

    if (
      normalized === "recursive" &&
      verb === "explain" &&
      EXPLAIN_RECURSIVE_VALUES.has(eq >= 0 ? token.slice(eq + 1) : "")
    ) {
      return null;
    }

    if (OBJECT_REPLACING_LONG_FLAGS.has(normalized)) {
      return describeObjectReplacingFlag(`--${name}`);
    }

    if (DENIED_LONG_FLAGS.has(normalized) || normalized.startsWith("as-")) {
      return describeDeniedFlag(`--${name}`);
    }

    if (normalized === "output") {
      const value: string = eq >= 0 ? token.slice(eq + 1) : next;
      if (isFileBackedOutputFormat(value)) {
        return describeFileBackedOutput(value);
      }
    }

    return null;
  }

  /*
   * Walk a `-abc` cluster the way pflag does: each character is a flag until
   * one that takes a value, whose value is the rest of the token (or, when
   * nothing is left, the next token). A character we do not know is treated
   * as a boolean flag and the walk continues, so an unknown flag can never
   * hide a denied one behind it. On `patch`, `p` is --patch and takes a
   * value (see the header): the inline patch is never walked as flags.
   */
  private static checkShortCluster(
    token: string,
    next: string,
    verb: string | null,
  ): string | null {
    const body: string = token.slice(1);

    for (let j: number = 0; j < body.length; j++) {
      const ch: string = body[j]!;

      if (ch === "=") {
        break;
      }

      if (DENIED_SHORT_FLAGS.has(ch)) {
        return describeDeniedFlag(`-${ch}`);
      }

      if (ch === "p" && verb === "patch") {
        break;
      }

      if (VALUE_TAKING_SHORT_FLAGS.has(ch)) {
        let value: string = body.slice(j + 1);
        if (value.startsWith("=")) {
          value = value.slice(1);
        }
        if (!value) {
          value = next;
        }

        if (ch === "o" && isFileBackedOutputFormat(value)) {
          return describeFileBackedOutput(value);
        }

        break;
      }
    }

    return null;
  }
}
