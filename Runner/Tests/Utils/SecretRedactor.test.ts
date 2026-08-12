/*
 * ---------------------------------------------------------------------------
 * Unit tests for SecretRedactor — the last thing that touches a string before
 * the code-fix pipeline lets it out of the process.
 *
 * A fix run holds three secrets at once and each has a documented way out:
 *
 *   - THE REPOSITORY TOKEN. The server mints a GitHub installation token and
 *     hands it to the Runner. Node's execFile puts the whole argv into a
 *     rejected Error's message, and the task handlers forward that message to
 *     the server as the run's statusMessage, where it is stored and rendered
 *     in the dashboard. This is the case the environment-only redactor could
 *     never catch: the token is never in this process's environment, it is
 *     handed over at claim time.
 *   - THE RUNNER'S OWN KEY. Build and test commands inherit the Runner's
 *     environment, so a command that echoes it prints the key.
 *   - WHATEVER THE MODEL READS. Tool output is fed back to the model AND
 *     shipped to the server as the run's transcript.
 *
 * Redaction happens at capture because the redacted copy is the only one that
 * leaves. These tests therefore care about two things above all: that a
 * registered value is caught wherever it appears, and that redaction never
 * shreds ordinary output (a redactor nobody can read logs through gets turned
 * off).
 * ---------------------------------------------------------------------------
 */

import SecretRedactor from "../../Utils/SecretRedactor";

const REPO_TOKEN: string = "ghs_16C7e42F292c6912E7710c838347Ae178B4a";

afterEach(() => {
  SecretRedactor.clearRegistered();
});

describe("register / redact", () => {
  test("a registered value is replaced by a labelled marker", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");

    const redacted: string = SecretRedactor.redact(
      `cloning with ${REPO_TOKEN} now`,
    );

    expect(redacted).not.toContain(REPO_TOKEN);
    expect(redacted).toContain("[redacted:repository-token]");
    // The surrounding text is untouched — a redacted log must stay readable.
    expect(redacted.startsWith("cloning with ")).toBe(true);
    expect(redacted.endsWith(" now")).toBe(true);
  });

  test("every occurrence is replaced, not just the first", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");

    const redacted: string = SecretRedactor.redact(
      `${REPO_TOKEN} ... ${REPO_TOKEN} ... ${REPO_TOKEN}`,
    );

    expect(redacted).not.toContain(REPO_TOKEN);
    expect(redacted.split("[redacted:repository-token]")).toHaveLength(4);
  });

  /*
   * THE case the environment-only redactor missed. This is a real execFile
   * failure message, verbatim in shape: it is what a failed `git clone`
   * rejects with, it is logged, and the task handler forwards it to the
   * server as the run's status.
   */
  test("a git failure message carrying the token in argv is redacted", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");

    const gitFailure: Error = new Error(
      `Command failed: git clone https://x-access-token:${REPO_TOKEN}@github.com/acme/checkout.git\n` +
        `fatal: Authentication failed for 'https://github.com/acme/checkout.git/'`,
    );

    const message: string = SecretRedactor.redactError(gitFailure);

    expect(message).not.toContain(REPO_TOKEN);
    // The actionable part of the message survives.
    expect(message).toContain("Authentication failed");
    expect(message).toContain("github.com/acme/checkout.git");
  });

  test("redactError handles a non-Error throw", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");

    expect(SecretRedactor.redactError(`boom ${REPO_TOKEN}`)).not.toContain(
      REPO_TOKEN,
    );
    expect(SecretRedactor.redactError(undefined)).toBe("undefined");
  });

  /*
   * A value shorter than the minimum is refused rather than registered: a
   * 4-character "secret" would match inside ordinary words and turn every
   * log line into markers. Refusing is the honest behaviour — and is why the
   * pipeline must not rely on this for short credentials.
   */
  test("a too-short value is not registered, so ordinary text survives", () => {
    SecretRedactor.register("abc", "tiny");

    expect(SecretRedactor.isRegistered("abc")).toBe(false);
    expect(SecretRedactor.redact("abcdefg abc abc")).toBe("abcdefg abc abc");
  });

  test("null, undefined and non-strings are ignored on register", () => {
    SecretRedactor.register(null, "nothing");
    SecretRedactor.register(undefined, "nothing");

    expect(SecretRedactor.redact("plain text")).toBe("plain text");
  });

  test("clearRegistered forgets a run's token", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");
    expect(SecretRedactor.isRegistered(REPO_TOKEN)).toBe(true);

    SecretRedactor.clearRegistered();

    expect(SecretRedactor.isRegistered(REPO_TOKEN)).toBe(false);
  });

  /*
   * When one secret's value contains another, the LONGER must go first.
   * Replacing the shorter one first leaves a mangled fragment of the longer
   * one in the output — which is a partial credential disclosure, not a
   * cosmetic problem.
   */
  test("a secret containing another secret is fully replaced", () => {
    const short: string = "shortsecretvalue";
    const long: string = `prefix-${short}-suffix`;

    SecretRedactor.register(short, "short");
    SecretRedactor.register(long, "long");

    const redacted: string = SecretRedactor.redact(`value=${long}`);

    expect(redacted).not.toContain(short);
    expect(redacted).not.toContain(long);
    expect(redacted).toContain("[redacted:long]");
  });

  test("redaction is idempotent — running it twice changes nothing further", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");

    const once: string = SecretRedactor.redact(`token ${REPO_TOKEN} end`);
    const twice: string = SecretRedactor.redact(once);

    expect(twice).toBe(once);
  });

  test("empty and non-string inputs come back safely", () => {
    expect(SecretRedactor.redact("")).toBe("");
    expect(SecretRedactor.redact(null)).toBe("");
    expect(SecretRedactor.redact(undefined)).toBe("");
  });
});

describe("environment secrets", () => {
  /*
   * Build commands inherit the Runner's environment. Mutating process.env
   * here is safe because redact() is synchronous and reads it per call.
   */
  test("a secret-looking env value echoed by a command is redacted", () => {
    process.env["ACME_REGISTRY_TOKEN"] = "env-secret-value-1234567890";

    try {
      const redacted: string = SecretRedactor.redact(
        "ACME_REGISTRY_TOKEN=env-secret-value-1234567890",
      );

      expect(redacted).not.toContain("env-secret-value-1234567890");
      expect(redacted).toContain("[redacted:ACME_REGISTRY_TOKEN]");
    } finally {
      delete process.env["ACME_REGISTRY_TOKEN"];
    }
  });

  /*
   * PATH and HOME are on the allowlist precisely because their values are
   * the most common substrings in build output. Redacting them would replace
   * every path in every stack trace and make the whole log useless.
   */
  test("PATH and HOME are never treated as secrets", () => {
    const previousPath: string | undefined = process.env["PATH"];
    process.env["PATH"] = "/usr/local/bin:/usr/bin";

    try {
      expect(SecretRedactor.redact("running /usr/local/bin/node")).toContain(
        "/usr/local/bin/node",
      );
    } finally {
      if (previousPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = previousPath;
      }
    }
  });
});

describe("pattern backstop", () => {
  /*
   * A credential can reach a string without ever having been registered —
   * minted mid-run, echoed by a tool, or read by the model out of a config
   * file in the repository being fixed. The pattern pass is what keeps that
   * out of a pull request body.
   */
  test("URL credentials are stripped even when the value is unknown", () => {
    const redacted: string = SecretRedactor.redact(
      "remote: https://x-access-token:some-unregistered-value@github.com/acme/app.git",
    );

    expect(redacted).not.toContain("some-unregistered-value");
    expect(redacted).toContain("https://x-access-token:[redacted]@github.com");
  });

  test.each([
    ["GitHub app server token", "ghs_16C7e42F292c6912E7710c838347Ae178B4a"],
    ["GitHub PAT", "ghp_16C7e42F292c6912E7710c838347Ae178B4a"],
    [
      "GitHub fine-grained PAT",
      "github_pat_11ABCDE0Y0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789",
    ],
    ["AWS access key id", "AKIAIOSFODNN7EXAMPLE"],
    ["Slack token", "xoxb-1234567890-abcdefghijklmnop"],
  ])("an unregistered %s is still not printed", (_label: string, secret: string) => {
    const redacted: string = SecretRedactor.redact(`found ${secret} in config`);

    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[redacted]");
  });

  test("a private key header is redacted", () => {
    expect(
      SecretRedactor.redact("-----BEGIN RSA PRIVATE KEY-----\nMIIE..."),
    ).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  /*
   * A registered value keeps its LABEL rather than collapsing to the generic
   * marker, because the label is what makes a redacted log debuggable: an
   * operator reading "[redacted:repository-token]" knows which credential the
   * command was using.
   */
  test("a registered token keeps its label rather than the generic marker", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");

    expect(SecretRedactor.redact(`token=${REPO_TOKEN}`)).toContain(
      "[redacted:repository-token]",
    );
  });

  /*
   * REGRESSION. The two passes overlap on exactly the string that matters
   * most — a token inside a git remote URL. Exact-match runs first and turns
   * it into `[redacted:repository-token]`; the URL pass then sees that marker
   * sitting in the password position and, without a guard, overwrites it with
   * the anonymous `[redacted]`. Still safe, but it throws away the label that
   * tells an operator WHICH credential the failing command was using — which
   * is the whole reason a redacted log is still debuggable.
   */
  test("a registered token inside a URL keeps its label through the pattern pass", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");

    const redacted: string = SecretRedactor.redact(
      `Command failed: git push https://x-access-token:${REPO_TOKEN}@github.com/acme/app.git`,
    );

    expect(redacted).not.toContain(REPO_TOKEN);
    expect(redacted).toContain("[redacted:repository-token]");
    expect(redacted).toContain("@github.com/acme/app.git");
  });

  test("an UNregistered credential in a URL still gets the anonymous marker", () => {
    const redacted: string = SecretRedactor.redact(
      "https://user:totally-unknown-secret@example.com/repo.git",
    );

    expect(redacted).not.toContain("totally-unknown-secret");
    expect(redacted).toContain("https://user:[redacted]@example.com");
  });

  test("ordinary build output is left completely alone", () => {
    const buildOutput: string = [
      "> checkout@1.0.0 test",
      "> jest --ci",
      "PASS src/checkout.test.ts",
      "Tests: 42 passed, 42 total",
      "at Object.<anonymous> (/repo/src/checkout.ts:31:15)",
    ].join("\n");

    expect(SecretRedactor.redact(buildOutput)).toBe(buildOutput);
  });
});

describe("redactJSON", () => {
  /*
   * The tool ARGUMENTS are shipped to the run's transcript too, and a
   * write_file call's `content` is a whole source file — which can perfectly
   * well contain a credential the model just read out of the repository.
   */
  test("redacts strings nested anywhere in a structure", () => {
    SecretRedactor.register(REPO_TOKEN, "repository-token");

    const redacted: Record<string, unknown> = SecretRedactor.redactJSON({
      path: "src/config.ts",
      content: `export const token = "${REPO_TOKEN}";`,
      nested: { list: [`${REPO_TOKEN}`, "harmless"] },
    });

    expect(JSON.stringify(redacted)).not.toContain(REPO_TOKEN);
    expect((redacted["nested"] as Record<string, Array<string>>)["list"]?.[1]).toBe(
      "harmless",
    );
  });

  test("leaves non-string leaves and nullish values as they are", () => {
    expect(
      SecretRedactor.redactJSON({ n: 42, b: true, z: null, u: undefined }),
    ).toEqual({ n: 42, b: true, z: null, u: undefined });
    expect(SecretRedactor.redactJSON(undefined)).toBeUndefined();
  });
});
