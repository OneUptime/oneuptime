/*
 * Centralized, deny-by-default redaction for everything that reaches a log
 * sink.
 *
 * Every log record this process emits is written to three places: process
 * stdout/stderr, the in-memory recent-log ring buffer that the master-admin
 * support bundle surfaces, and the configured OpenTelemetry log exporter. A
 * credential that reaches a log statement therefore lands in three retention
 * systems at once, and DEBUG is a normal troubleshooting level operators turn
 * on in production.
 *
 * So call sites are not trusted to be careful. Logger runs every message body
 * and every attribute through here first, at every level, and the rules below
 * are the single place that decides what a secret looks like. Removing a
 * careless `logger.debug(requestBody)` is still the right fix at the call
 * site -- this is the net underneath it.
 *
 * Two matching strategies, both applied:
 *
 *   1. Structural. Objects are walked recursively and a value is replaced
 *      whenever its KEY names a credential (`client_secret`, `access_token`,
 *      `password`, `Authorization`, ...). This is the reliable one: it does
 *      not care what the value looks like.
 *
 *   2. Textual. Strings are swept for credentials that were already flattened
 *      into text -- `JSON.stringify(req.body)` in a template literal, an OAuth
 *      callback URL with `?code=`, an `Authorization: Bearer` header dump -- and
 *      for values that are self-identifying regardless of key (JWTs, Slack
 *      `xoxb-` tokens, PEM private key blocks).
 *
 * Over-redaction is the intended failure mode. Losing a token count from a
 * debug line costs a little context; leaking a bot token costs the workspace.
 *
 * Every rule reads a text in time in line with its length: log text is text
 * anybody can put a header or a field into (LogRedaction.test reads about
 * 400,000 characters of each rule's worst case).
 */

import { replacePrivateKeyBlocks } from "../../Utils/PrivateKeyBlocks";

export const REDACTED: string = "[REDACTED]";

// Deep enough for any real log payload, shallow enough to bound the walk.
const MAX_DEPTH: number = 12;

/*
 * A key is sensitive when its normalized form (lowercased, separators
 * stripped, so `client_secret`, `clientSecret` and `CLIENT-SECRET` all collapse
 * to `clientsecret`) CONTAINS one of these fragments. Substring matching is
 * deliberate: it catches `slackBotAccessToken`, `x-api-key`,
 * `refresh_token_expires_in` and every other spelling nobody thought to list.
 */
const SENSITIVE_KEY_FRAGMENTS: Array<string> = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "token",
  "credential",
  "authorization",
  "cookie",
  "apikey",
  "privatekey",
  "accesskey",
  "secretkey",
  "signingkey",
  "encryptionkey",
  "assertion",
  "attestation",
  "signature",
  "salt",
  "otp",
  "jwt",
  "bearer",
  "sessionid",
  "authcode",
  "authorizationcode",
  "verificationcode",
  "backupcode",
  "recoverycode",
  "onetimecode",
  "logincode",
  "resetcode",
  "codeverifier",
  /*
   * A DSN carries the password inline, so the key name is the only signal
   * we get before the value is already in the log line.
   */
  "connectionstring",
  "connectionuri",
  "dsn",
  "sslkey",
  /*
   * The keys OneUptime's own components present when they call it, in the
   * headers and bodies of a request a client was making when it failed:
   *
   *   - the cluster key its own services present to each other (the
   *     clusterkey and x-clusterkey headers, and the clusterKey field
   *     Runners of earlier releases send);
   *   - a Runner's and an AI agent's key (aiAgentKey, agentKey, x-agent-key,
   *     previousAgentKey; runnerKey, previousRunnerKey,
   *     ONEUPTIME_RUNNER_KEY);
   *   - a probe's key, and the key that registers a global probe (probeKey,
   *     PROBE_KEY; registerProbeKey, REGISTER_PROBE_KEY);
   *   - a telemetry ingestion key (x-oneuptime-ingestion-key,
   *     ONEUPTIME_INGESTION_KEY) and an enterprise licence key (licenseKey).
   */
  "clusterkey",
  "agentkey",
  "runnerkey",
  "probekey",
  "ingestionkey",
  "licensekey",
];

/*
 * Keys that contain a sensitive fragment but never carry the secret itself.
 * These are worth keeping: LLM token accounting and expiry timestamps are
 * exactly the sort of thing someone turns DEBUG on to look at.
 */
const NON_SENSITIVE_KEYS: Set<string> = new Set<string>([
  "tokencount",
  "tokencounts",
  "tokensused",
  "totaltokens",
  "inputtokens",
  "outputtokens",
  "prompttokens",
  "completiontokens",
  "cachedtokens",
  "reasoningtokens",
  "maxtokens",
  "tokenlimit",
  "tokenusage",
  "tokentype",
  "hastoken",
  "hasaccesstoken",
  "hasrefreshtoken",
  "tokenexpiresat",
  "tokenexpiry",
  "accesstokenexpiresat",
  "refreshtokenexpiresat",
  "expirestokenat",
  "isauthorized",
  "authorizationurl",
  "authorizationendpoint",
  // Which ingestion key a request came with: an id, never the key itself.
  "ingestionkeyid",
  "telemetryingestionkeyid",
  "registeredwithingestionkeyid",
]);

/*
 * Keys whose sensitivity depends on the value. `code` is both the OAuth
 * authorization code / TOTP code we must never log AND the `ECONNREFUSED` on
 * every network error, so it is decided by looksLikeSecretCode below.
 */
const VALUE_DEPENDENT_KEYS: Set<string> = new Set<string>(["code", "codes"]);

/*
 * Keys that are always secret but carry no fragment above -- WebAuthn
 * assertion material, mostly.
 */
const SENSITIVE_EXACT_KEYS: Set<string> = new Set<string>([
  "pin",
  "totp",
  "mfa",
  "rawid",
  "clientdatajson",
  "authenticatordata",
  "userhandle",
  "challenge",
  "twofactorsecret",
  /*
   * Database drivers attach bind values to QueryFailedError as enumerable
   * arrays. The values have no reliable self-identifying shape, so the whole
   * field must be treated as secret rather than logged positionally.
   */
  "parameters",
  "parametervalues",
  "bindparameters",
  "bindvalues",
]);

export type NormalizeLogKeyFunction = (key: string) => string;

export const normalizeLogKey: NormalizeLogKeyFunction = (
  key: string,
): string => {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
};

/*
 * Error codes (`ECONNREFUSED`, `ERR_BAD_REQUEST`), exception codes
 * (`BadDataException`) and short status-ish strings are identifiers, never
 * credentials. Anything else under a `code` key -- digits (a TOTP), or a long
 * opaque string with separators (an OAuth authorization code) -- is treated as
 * a secret.
 */
const IDENTIFIER_CODE_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9]*$/;

type LooksLikeSecretCodeFunction = (value: unknown) => boolean;

const looksLikeSecretCode: LooksLikeSecretCodeFunction = (
  value: unknown,
): boolean => {
  if (typeof value === "number") {
    // HTTP status / exit codes are small; a 6-digit TOTP is not.
    return Math.abs(value) >= 1000;
  }

  if (typeof value !== "string") {
    return false;
  }

  if (value.length === 0) {
    return false;
  }

  return !(IDENTIFIER_CODE_REGEX.test(value) && value.length < 32);
};

export type IsSensitiveLogKeyFunction = (
  key: string,
  value?: unknown,
) => boolean;

export const isSensitiveLogKey: IsSensitiveLogKeyFunction = (
  key: string,
  value?: unknown,
): boolean => {
  const normalized: string = normalizeLogKey(key);

  if (!normalized) {
    return false;
  }

  if (NON_SENSITIVE_KEYS.has(normalized)) {
    return false;
  }

  if (SENSITIVE_EXACT_KEYS.has(normalized)) {
    return true;
  }

  if (VALUE_DEPENDENT_KEYS.has(normalized)) {
    return looksLikeSecretCode(value);
  }

  return SENSITIVE_KEY_FRAGMENTS.some((fragment: string) => {
    return normalized.includes(fragment);
  });
};

/*
 * ---------------------------------------------------------------------------
 * String rules
 * ---------------------------------------------------------------------------
 */

/*
 * Credential words as they appear INSIDE text. Kept separate from the key
 * fragment list because a couple of the structural fragments (`salt`, `otp`)
 * are too short to match safely against free-form prose.
 */
const OTHER_TEXT_SECRET_WORDS: string =
  "password|passwd|passphrase|secret|token|credential|credentials|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?key|assertion|attestation|signature|raw[_-]?id|client[_-]?data[_-]?json|authenticator[_-]?data|user[_-]?handle|two[_-]?factor[_-]?secret|code[_-]?verifier";

/*
 * The names of the keys OneUptime's own components present (see
 * SENSITIVE_KEY_FRAGMENTS), in text: clusterKey, x-clusterkey, aiAgentKey,
 * x-agent-key, previousRunnerKey, ONEUPTIME_RUNNER_KEY, registerProbeKey,
 * PROBE_KEY, x-oneuptime-ingestion-key, licenseKey... Their unquoted values
 * have a rule of their own (internal-key-value below).
 */
const INTERNAL_KEY_WORDS: string =
  "cluster[_-]?key|agent[_-]?key|runner[_-]?key|probe[_-]?key|ingestion[_-]?key|license[_-]?key";

const TEXT_SECRET_WORDS: string = `${OTHER_TEXT_SECRET_WORDS}|${INTERNAL_KEY_WORDS}`;

// Bounded, so a long non-matching run cannot blow up on backtracking.
const KEY_PREFIX: string = "[A-Za-z0-9_.-]{0,40}";
const KEY_SUFFIX: string = "[A-Za-z0-9_.-]{0,40}";

/*
 * A rule is a pattern and what replaces each match, or - where one pattern
 * cannot read a text in time in line with its length - a function that
 * reads the text itself.
 */
type StringRedactionRule =
  | {
      name: string;
      regex: RegExp;
      replacement: string;
    }
  | {
      name: string;
      redact: (text: string) => string;
    };

const STRING_REDACTION_RULES: Array<StringRedactionRule> = [
  {
    /*
     * Runs first: a bare `Bearer <token>` with no key in front of it would
     * otherwise survive every rule below.
     *
     * The lookahead requires the value to carry a digit or a separator, so the
     * scheme words keep working as English -- "Basic authentication failed" and
     * "Token exchange completed" are log lines, not credentials.
     */
    name: "authorization-scheme",
    regex:
      /\b(Bearer|Basic|Token)\s+(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `$1 ${REDACTED}`,
  },
  {
    /*
     * JSON string members: {"client_secret":"abc"} -- the shape produced by
     * JSON.stringify(req.body) inside a log message. The value pattern allows
     * escaped quotes so an escaped-quote-bearing password cannot end the match
     * early and leave its tail in the clear.
     */
    name: "json-string-member",
    regex: new RegExp(
      `"(${KEY_PREFIX}(?:${TEXT_SECRET_WORDS})${KEY_SUFFIX})"(\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`,
      "gi",
    ),
    replacement: `"$1"$2"${REDACTED}"`,
  },
  {
    // JSON numeric members: {"password":123456}
    name: "json-number-member",
    regex: new RegExp(
      `"(${KEY_PREFIX}(?:${TEXT_SECRET_WORDS})${KEY_SUFFIX})"(\\s*:\\s*)-?\\d+(?:\\.\\d+)?`,
      "gi",
    ),
    replacement: `"$1"$2"${REDACTED}"`,
  },
  {
    /*
     * JSON string members of JSON text that was stringified again: the
     * body a client kept as a JSON string, written out with the error that
     * carries it (JSON.stringify(error) puts its request's body in as
     * {"data":"{\"probeKey\":\"...\"}"}). Each time a text is stringified
     * again, the quotes inside it gain backslashes: a member's quotes are
     * a run of them and a quote. Its value runs to the next quote with a
     * run of exactly as many backslashes - a quote inside the value has
     * more - or to the end of the text.
     *
     * Linear in the text's length: a run is at most 15 backslashes, the
     * name is bounded (KEY_PREFIX, KEY_SUFFIX), and every member found
     * runs to its end, or the text's, before the next is looked for
     * (LogRedaction.test reads 400,000 characters of each worst case).
     */
    name: "escaped-json-string-member",
    regex: new RegExp(
      `(?<!\\\\)(\\\\{1,15})"(${KEY_PREFIX}(?:${TEXT_SECRET_WORDS})${KEY_SUFFIX})\\1"(\\s*:\\s*)\\1"[\\s\\S]*?(?:(?<!\\\\)\\1"|$)`,
      "gi",
    ),
    replacement: `$1"$2$1"$3$1"${REDACTED}$1"`,
  },
  {
    // Numeric members of JSON text stringified again: {"data":"{\"password\":1234}"}
    name: "escaped-json-number-member",
    regex: new RegExp(
      `(?<!\\\\)(\\\\{1,15})"(${KEY_PREFIX}(?:${TEXT_SECRET_WORDS})${KEY_SUFFIX})\\1"(\\s*:\\s*)-?\\d+(?:\\.\\d+)?`,
      "gi",
    ),
    replacement: `$1"$2$1"$3$1"${REDACTED}$1"`,
  },
  {
    /*
     * The keys OneUptime's own components present (INTERNAL_KEY_WORDS), as
     * they travel. The cluster key goes URI-encoded
     * (ClusterKeyAuthorization.getClusterKey), which leaves ' ( ) ! * ~ as
     * they are, and a key an operator sets (ONEUPTIME_RUNNER_KEY, PROBE_KEY,
     * REGISTER_PROBE_KEY) can hold any character. The rule below ends a
     * value at ' and ), so it would leave the rest of such a key in the
     * clear. Here a value is read whole:
     *
     *   - double-quoted, to its closing quote, escapes included;
     *   - single-quoted, as a console prints a string, to the closing quote
     *     on its line that a delimiter or the end follows - so a value
     *     printed with a quote inside it falls to the next form;
     *   - unquoted, to whitespace or a delimiter an encoded key never holds
     *     (, ; & ] } " and a backslash),
     *
     * so a header line (`x-agent-key: ...`), a field (`probeKey=...`,
     * `PROBE_KEY=...`), a console's `{ agentKey: '...' }` and a raw request
     * stringified again keep none of it. JSON members are the JSON rules'
     * above.
     *
     * Linear in the text's length: the name's prefix and suffix are bounded
     * (KEY_PREFIX, KEY_SUFFIX), an unquoted value stops at whitespace and a
     * quoted one at its closing quote or (single-quoted) its line's end
     * (LogRedaction.test reads 400,000 characters of each worst case).
     */
    name: "internal-key-value",
    regex: new RegExp(
      `\\b(${KEY_PREFIX}(?:${INTERNAL_KEY_WORDS})${KEY_SUFFIX})(\\s*[=:]\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\\\r\\n]|\\\\.)*'(?=[\\s,;&)\\]}]|$)|[^\\s,;&\\]}"\\\\]+)`,
      "gi",
    ),
    replacement: `$1$2${REDACTED}`,
  },
  {
    /*
     * Unquoted key/value text: form bodies (`client_secret=abc&...`), query
     * strings, header dumps (`Authorization: Bearer abc`) and prose
     * (`password: hunter2`).
     *
     * The value alternation tries `Bearer <token>` first, so a header dump is
     * consumed whole -- stopping at the scheme word would leave the token
     * itself sitting in the clear right after the placeholder.
     */
    name: "key-value-text",
    regex: new RegExp(
      `\\b(${KEY_PREFIX}(?:${OTHER_TEXT_SECRET_WORDS})${KEY_SUFFIX})(\\s*[=:]\\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic|Token)\\s+[^\\s,;&)\\]}"']+|[^\\s,;&)\\]}"']+)`,
      "gi",
    ),
    replacement: `$1$2${REDACTED}`,
  },
  {
    /*
     * OAuth authorization codes and OTPs as query/form parameters. Restricted
     * to the `code=` form so ordinary prose ("error code: ECONNREFUSED") keeps
     * its meaning -- structural redaction covers the JSON case.
     */
    name: "code-parameter",
    regex: /\b(code|pin|otp|totp)(=)[^\s&#"'<>]+/gi,
    replacement: `$1$2${REDACTED}`,
  },
  {
    // {"code":"..."} in flattened JSON.
    name: "json-code-member",
    regex: /"(code|pin|otp|totp)"(\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    replacement: `"$1"$2"${REDACTED}"`,
  },
  {
    /*
     * A JWT, looked for once per run of the characters it is made of: at the
     * first place in the run one may begin (the run's start, or just after a
     * "-" in it - where the word boundary allowed one), with the text of the
     * run before that place put back ($1). A later place in the same run has
     * a shorter first segment and ends no better, so this redacts exactly
     * the tokens a search from every word boundary did, while each run is
     * read a bounded number of times - in time in line with the text's
     * length.
     */
    name: "jwt",
    regex:
      /(?<![A-Za-z0-9_-])(?=((?:[A-Za-z0-9_-]*?-)??)eyJ)\1eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
    replacement: `$1${REDACTED}`,
  },
  {
    name: "slack-token",
    regex: /\bxox[abeprs]-[A-Za-z0-9-]{8,}/gi,
    replacement: REDACTED,
  },
  {
    name: "slack-app-token",
    regex: /\bxapp-[A-Za-z0-9-]{8,}/gi,
    replacement: REDACTED,
  },
  {
    name: "github-token",
    regex:
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: REDACTED,
  },
  {
    name: "aws-access-key-id",
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[0-9A-Z]{16}\b/g,
    replacement: REDACTED,
  },
  {
    name: "google-api-key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: REDACTED,
  },
  {
    /*
     * Telegram puts the bot credential in the request path rather than a
     * header. Network clients commonly copy that URL into exception messages,
     * so structural key redaction cannot see it.
     */
    name: "telegram-bot-token-path",
    regex: /(\/bot)[0-9]{5,}:[A-Za-z0-9_-]{20,}/g,
    replacement: `$1${REDACTED}`,
  },
  {
    /*
     * A PEM private key block, from its BEGIN line to the first END line
     * after it. Read by PrivateKeyBlocks, in time in line with the text's
     * length however many BEGIN lines it holds with no END after them.
     */
    name: "private-key-block",
    redact: (text: string): string => {
      return replacePrivateKeyBlocks(text, REDACTED).text;
    },
  },
  {
    /*
     * Credentials embedded in a URL: postgres://user:password@host/db
     *
     * The scheme is bounded (64 characters, far more than any scheme that
     * carries credentials), so the time this takes grows in line with the
     * text's length: a scheme can start at every word, and each start reads
     * no further than that (LogRedaction.test reads 400,000 characters of
     * the worst cases).
     */
    name: "url-basic-auth",
    regex: /\b([a-z][a-z0-9+.-]{0,63}:\/\/)([^\s/:@]+):[^\s/@]+@/gi,
    replacement: `$1$2:${REDACTED}@`,
  },
];

/*
 * Cheap pre-filter. Almost every log line contains none of these, and skipping
 * fifteen regexes for those keeps redaction off the cost of ordinary logging.
 * It must stay a superset of every rule above -- a word missing here is a
 * credential that never gets redacted.
 */
const SENSITIVE_TEXT_HINT_REGEX: RegExp = new RegExp(
  [
    TEXT_SECRET_WORDS,
    "code=",
    "pin=",
    "otp=",
    "totp=",
    '"code"',
    '"pin"',
    '"otp"',
    '"totp"',
    "bearer\\s",
    "basic\\s",
    "eyJ",
    "xox",
    "xapp-",
    "gh[opusr]_",
    "github_pat_",
    "AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA",
    "AIza",
    "/bot[0-9]{5,}:",
    "-----BEGIN",
    "://",
  ].join("|"),
  "i",
);

export type RedactLogStringFunction = (value: string) => string;

export const redactLogString: RedactLogStringFunction = (
  value: string,
): string => {
  if (!value) {
    return value;
  }

  if (!SENSITIVE_TEXT_HINT_REGEX.test(value)) {
    return value;
  }

  let redacted: string = value;

  for (const rule of STRING_REDACTION_RULES) {
    if ("redact" in rule) {
      redacted = rule.redact(redacted);
      continue;
    }

    /*
     * The rules carry the /g flag and are module-level, so lastIndex has to be
     * reset -- String.replace does that itself, but .test() on the hint regex
     * above and any future .test() here would not.
     */
    rule.regex.lastIndex = 0;
    redacted = redacted.replace(rule.regex, rule.replacement);
  }

  return redacted;
};

/*
 * ---------------------------------------------------------------------------
 * Structural walk
 * ---------------------------------------------------------------------------
 */

type RedactValueFunction = (
  value: unknown,
  depth: number,
  seen: Set<unknown>,
) => unknown;

const redactValue: RedactValueFunction = (
  value: unknown,
  depth: number,
  seen: Set<unknown>,
): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactLogString(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (typeof value === "function") {
    return "[Function]";
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    // Buffers hold key material as often as they hold anything readable.
    return `[Buffer ${value.length} bytes]`;
  }

  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  try {
    if (value instanceof Error) {
      const redactedError: Record<string, unknown> = {
        name: value.name,
        message: redactLogString(value.message),
      };

      if (value.stack) {
        redactedError["stack"] = redactLogString(value.stack);
      }

      for (const key of Object.keys(value)) {
        redactedError[key] = isSensitiveLogKey(
          key,
          (value as unknown as Record<string, unknown>)[key],
        )
          ? REDACTED
          : redactValue(
              (value as unknown as Record<string, unknown>)[key],
              depth + 1,
              seen,
            );
      }

      return redactedError;
    }

    if (Array.isArray(value)) {
      return value.map((item: unknown) => {
        return redactValue(item, depth + 1, seen);
      });
    }

    if (value instanceof Map) {
      const fromMap: Record<string, unknown> = {};

      for (const [mapKey, mapValue] of value.entries()) {
        const keyAsString: string = String(mapKey);

        fromMap[keyAsString] = isSensitiveLogKey(keyAsString, mapValue)
          ? REDACTED
          : redactValue(mapValue, depth + 1, seen);
      }

      return fromMap;
    }

    if (value instanceof Set) {
      return Array.from(value).map((item: unknown) => {
        return redactValue(item, depth + 1, seen);
      });
    }

    /*
     * Models, ObjectIDs and the other Common types serialize through toJSON.
     * Honouring it keeps redacted output shaped exactly like what
     * JSON.stringify would have produced without this pass.
     */
    const maybeToJSON: unknown = (value as Record<string, unknown>)["toJSON"];

    if (typeof maybeToJSON === "function") {
      try {
        const json: unknown = (maybeToJSON as () => unknown).call(value);

        if (json !== value) {
          return redactValue(json, depth, seen);
        }
      } catch {
        // Fall through to the plain-object walk below.
      }
    }

    const redactedObject: Record<string, unknown> = {};

    for (const key of Object.keys(value as Record<string, unknown>)) {
      const propertyValue: unknown = (value as Record<string, unknown>)[key];

      redactedObject[key] = isSensitiveLogKey(key, propertyValue)
        ? REDACTED
        : redactValue(propertyValue, depth + 1, seen);
    }

    return redactedObject;
  } finally {
    /*
     * Only the path currently being walked is "seen", so a value referenced
     * twice in a tree is redacted twice instead of being reported as circular.
     */
    seen.delete(value);
  }
};

/**
 * Returns a redacted deep copy of any log body. The input is never mutated:
 * logging must not change what the caller is holding.
 */
export type RedactLogValueFunction = (value: unknown) => unknown;

export const redactLogValue: RedactLogValueFunction = (
  value: unknown,
): unknown => {
  try {
    return redactValue(value, 0, new Set<unknown>());
  } catch {
    /*
     * A getter that throws, an exotic proxy... nothing here is worth crashing
     * a log call for, but the body cannot be passed through unredacted either.
     */
    return REDACTED;
  }
};
