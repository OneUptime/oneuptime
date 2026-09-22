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
 *   - flags that select credentials, a cluster or an identity (--kubeconfig,
 *     --kuberc, --token, --server/-s, --as, --as-group, --as-uid, --context,
 *     --cluster, --user, --username, --password, client certificate flags,
 *     --insecure-skip-tls-verify, --tls-server-name), that read files as
 *     input (-f/--filename, -k/--kustomize, -R/--recursive, --patch-file,
 *     --from-file, --from-env-file, --cert, --key), that turn kubectl into a
 *     raw API client (--raw), that write files (--cache-dir, --profile,
 *     --profile-output, --log-file, --log-dir) or that log request bodies
 *     (-v, --vmodule). Combined short-flag clusters are walked character by
 *     character the way pflag does, so `-Rf`, `-Af` and `-pf` are caught as
 *     well as `-f`, and an inline value such as `-nweb` is a value, not four
 *     flags.
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

function describeDeniedFlag(flag: string): string {
  return `the ${flag} flag is not allowed on this Runner (OneUptime AI may only use the cluster access this Runner was given, and kubectl may never read or write files on the Runner's host, use another identity, or issue raw API requests)`;
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
  /*
   * Why this argv must not spawn, or null when nothing here is refused.
   * Independent of KubectlPolicy: a null from here still needs the policy's
   * tier verdict before anything runs.
   */
  public static getRefusalReason(args: Array<string>): string | null {
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
        );
        if (reason) {
          return reason;
        }
        continue;
      }

      const reason: string | null = KubectlArgvGuard.checkShortCluster(
        token,
        next,
      );
      if (reason) {
        return reason;
      }
    }

    return null;
  }

  private static checkLongFlag(token: string, next: string): string | null {
    const eq: number = token.indexOf("=");
    const name: string = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    const lower: string = name.toLowerCase();

    if (DENIED_LONG_FLAGS.has(lower) || lower.startsWith("as-")) {
      return describeDeniedFlag(`--${name}`);
    }

    if (lower === "output") {
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
   * hide a denied one behind it.
   */
  private static checkShortCluster(token: string, next: string): string | null {
    const body: string = token.slice(1);

    for (let j: number = 0; j < body.length; j++) {
      const ch: string = body[j]!;

      if (ch === "=") {
        break;
      }

      if (DENIED_SHORT_FLAGS.has(ch)) {
        return describeDeniedFlag(`-${ch}`);
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
