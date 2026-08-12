/*
 * One redactor for every string the code-fix pipeline lets out of this
 * process.
 *
 * A fix run holds three kinds of secret at once: the GitHub installation
 * token the server minted for this repository, this Runner's own
 * ONEUPTIME_RUNNER_KEY, and whatever registry/toolchain credentials the
 * operator put in the Runner's environment for build commands to use. All
 * three have a way out:
 *
 *   - GIT ERROR MESSAGES. The token is embedded in the clone/push URL, and
 *     Node's execFile puts the full argv into the rejected Error's message
 *     ("Command failed: git clone https://x-access-token:ghs_...@github.com/...").
 *     That message is logged, then propagated to the server as the run's
 *     statusMessage, where it is stored and rendered in the dashboard.
 *   - COMMAND OUTPUT. `run_command` and the build/test commands inherit
 *     this process's environment; a command that echoes it (`env`, `set -x`,
 *     a failing curl, a test that dumps config) prints those values.
 *   - THE MODEL'S TRANSCRIPT. Tool output is fed back to the LLM and shipped
 *     to the server as the run's transcript, so anything a tool prints is
 *     persisted and shown on the Logs page.
 *
 * Redaction therefore happens at the point of capture, before the string is
 * logged, sent, or put in a pull request — those are the only copies.
 *
 * Two sources are combined. Values REGISTERED for the run (the repository
 * token) are exact-matched, which is the only reliable way to catch a
 * secret this process was handed rather than one it was started with.
 * Environment values are matched the same way, minus a small allowlist of
 * names that are never secret and whose values are common substrings.
 * Finally a pattern pass catches credentials in URLs and well-known token
 * shapes, so a secret that reached this string by a route nobody
 * anticipated is still not printed verbatim.
 */

/*
 * Environment names whose values are never secret. Their values are also
 * exactly the kind of common substring (a path, "true", a hostname) that
 * would shred unrelated output if blanket-replaced.
 */
const NON_SECRET_ENV_NAMES: Set<string> = new Set<string>([
  "PATH",
  "HOME",
  "PWD",
  "OLDPWD",
  "SHELL",
  "SHLVL",
  "TERM",
  "LANG",
  "LC_ALL",
  "HOSTNAME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "NODE_ENV",
  "CI",
  "_",
]);

/*
 * Values shorter than this are too collision-prone to blanket-replace — a
 * 3-character value would shred unrelated output.
 */
const MIN_SECRET_VALUE_LENGTH: number = 8;

/*
 * Credentials embedded in a URL's userinfo. Deliberately matches the
 * PASSWORD half only, so the surviving text still reads as a URL a human
 * can act on: https://x-access-token:***@github.com/acme/checkout.git
 *
 * The negative lookahead matters: this pass runs AFTER the exact-match pass,
 * so by the time it sees a registered token the value has already become
 * `[redacted:repository-token]`. Without the lookahead it would match that
 * marker as a password and overwrite it with the anonymous one, throwing away
 * the label that tells an operator WHICH credential the command was using.
 */
const URL_CREDENTIAL_PATTERN: RegExp =
  /(:\/\/[^/\s:@]+:)((?!\[redacted)[^@\s/]+)(@)/g;

/*
 * Well-known credential shapes, as a backstop for values that reached the
 * string without being registered — a token minted mid-run, one echoed by a
 * tool, one read out of a config file in the repository.
 */
const TOKEN_PATTERNS: Array<RegExp> = [
  // GitHub: ghp_ (PAT), gho_ (OAuth), ghu_/ghs_ (app user/server), ghr_ (refresh).
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  // GitHub fine-grained PATs.
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Slack.
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  // Private key blocks.
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
];

export default class SecretRedactor {
  /*
   * Secrets handed to this process for the current run, mapped to the label
   * that replaces them. Registration is additive and explicitly cleared at
   * the end of a run so one repository's token cannot outlive it.
   */
  private static registeredSecrets: Map<string, string> = new Map<
    string,
    string
  >();

  /*
   * Register a value to redact for the rest of the run — the repository
   * access token, as soon as the server hands it over and BEFORE it is put
   * in a git remote URL.
   *
   * Values below the minimum length are ignored rather than registered: a
   * short value would match everywhere and make output unreadable, and a
   * credential that short is not one this redactor can safely handle.
   */
  public static register(
    value: string | null | undefined,
    label: string,
  ): void {
    if (typeof value !== "string" || value.length < MIN_SECRET_VALUE_LENGTH) {
      return;
    }

    this.registeredSecrets.set(value, label);
  }

  // Forget every registered secret. Called when a run finishes.
  public static clearRegistered(): void {
    this.registeredSecrets.clear();
  }

  // Whether a specific value is currently registered (for tests).
  public static isRegistered(value: string): boolean {
    return this.registeredSecrets.has(value);
  }

  /*
   * Redact every known secret out of a string.
   *
   * Longest values first: when one secret's value contains another,
   * replacing the shorter one first would leave a mangled fragment of the
   * longer one behind rather than removing it.
   */
  public static redact(text: string | null | undefined): string {
    if (typeof text !== "string" || text.length === 0) {
      return typeof text === "string" ? text : "";
    }

    let redacted: string = text;

    const secrets: Array<{ value: string; label: string }> = [
      ...Array.from(this.registeredSecrets.entries()).map(
        ([value, label]: [string, string]) => {
          return { value, label };
        },
      ),
      ...Object.entries(process.env)
        .filter(([name, value]: [string, string | undefined]) => {
          return (
            typeof value === "string" &&
            value.length >= MIN_SECRET_VALUE_LENGTH &&
            !NON_SECRET_ENV_NAMES.has(name)
          );
        })
        .map(([name, value]: [string, string | undefined]) => {
          return { value: value as string, label: name };
        }),
    ].sort((a: { value: string }, b: { value: string }): number => {
      return b.value.length - a.value.length;
    });

    for (const secret of secrets) {
      if (!redacted.includes(secret.value)) {
        continue;
      }

      redacted = redacted
        .split(secret.value)
        .join(`[redacted:${secret.label}]`);
    }

    /*
     * Pattern pass last, so a value that was registered is named in the
     * output ("[redacted:repository-token]") rather than reduced to the
     * generic marker — the label is what makes a redacted log debuggable.
     */
    redacted = redacted.replace(
      URL_CREDENTIAL_PATTERN,
      (
        _match: string,
        prefix: string,
        _credential: string,
        suffix: string,
      ): string => {
        return `${prefix}[redacted]${suffix}`;
      },
    );

    for (const pattern of TOKEN_PATTERNS) {
      redacted = redacted.replace(pattern, "[redacted]");
    }

    return redacted;
  }

  /*
   * Redact every string inside a JSON structure, in place of the original.
   * Used for the tool arguments shipped to the run's transcript — a
   * write_file call's `content` is a full source file, which can legitimately
   * contain a credential the model just read out of the repository.
   */
  public static redactJSON<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string") {
      return this.redact(value) as unknown as T;
    }

    if (Array.isArray(value)) {
      return value.map((entry: unknown) => {
        return this.redactJSON(entry);
      }) as unknown as T;
    }

    if (typeof value === "object") {
      const redacted: Record<string, unknown> = {};

      for (const [key, entry] of Object.entries(
        value as Record<string, unknown>,
      )) {
        redacted[key] = this.redactJSON(entry);
      }

      return redacted as unknown as T;
    }

    return value;
  }

  /*
   * Redact an unknown thrown value and return its message.
   *
   * Every catch block on the code-fix path funnels through here: a git
   * failure's Error message carries the full argv, and that argv carries
   * the authenticated remote URL.
   */
  public static redactError(error: unknown): string {
    const message: string =
      error instanceof Error ? error.message : String(error);

    return this.redact(message);
  }
}
