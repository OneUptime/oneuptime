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
 */

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
  /*
   * A DSN carries the password inline, so the key name is the only signal
   * we get before the value is already in the log line.
   */
  "connectionstring",
  "connectionuri",
  "dsn",
  "sslkey",
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
const TEXT_SECRET_WORDS: string =
  "password|passwd|passphrase|secret|token|credential|credentials|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?key|assertion|attestation|signature|raw[_-]?id|client[_-]?data[_-]?json|authenticator[_-]?data|user[_-]?handle|two[_-]?factor[_-]?secret";

// Bounded, so a long non-matching run cannot blow up on backtracking.
const KEY_PREFIX: string = "[A-Za-z0-9_.-]{0,40}";
const KEY_SUFFIX: string = "[A-Za-z0-9_.-]{0,40}";

interface StringRedactionRule {
  name: string;
  regex: RegExp;
  replacement: string;
}

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
      `\\b(${KEY_PREFIX}(?:${TEXT_SECRET_WORDS})${KEY_SUFFIX})(\\s*[=:]\\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic|Token)\\s+[^\\s,;&)\\]}"']+|[^\\s,;&)\\]}"']+)`,
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
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
    replacement: REDACTED,
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
    name: "private-key-block",
    regex:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
    replacement: REDACTED,
  },
  {
    // Credentials embedded in a URL: postgres://user:password@host/db
    name: "url-basic-auth",
    regex: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):[^\s/@]+@/gi,
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
