/*
 * Redacts credential-looking material from the output of a command a
 * resource AI agent ran, before it leaves the agent, before the server
 * stores it next to an AI run, and before a language model reads it.
 *
 * Two layers, applied in this order:
 *  1. Per-program hooks (RESOURCE_OUTPUT_REDACTION_HOOKS) for material only
 *     one tool prints: every value of a `docker inspect` "Env" list, a Ceph
 *     keyring's `key`. Each tool's kit extends its program's entry.
 *  2. The generic rules (GenericOutputRedactor): any `key: value` or
 *     `key=value` whose key looks credential-like, credential flags and
 *     their values, env name/value pairs, `scheme://user:password@`, Bearer
 *     and Basic tokens, JWTs, PEM private keys and long or padded base64.
 *
 * GenericOutputRedactor is a COPY of Utils/AiRemediation/
 * KubectlOutputRedactor (everything from its KubectlOutputRedaction
 * interface on), with only these renames: KubectlOutputRedactor ->
 * GenericOutputRedactor (and `export default class` -> `export class`),
 * KubectlOutputRedaction -> GenericOutputRedaction, KUBECTL_REDACTED_MARKER
 * -> GENERIC_REDACTED_MARKER. It is copied, not imported, because this
 * directory is import-closed (the resource AI agent carries a
 * byte-identical copy of it); ResourceOutputRedactorCopyParity.test.ts
 * fails the moment the two drift, so fix KubectlOutputRedactor and re-copy.
 * Its Kubernetes-specific rules (data blocks, describe output,
 * last-applied-configuration) are harmless on other tools' output.
 *
 * Over-masking is accepted; under-masking is not.
 */

import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { redactDatabaseOutput } from "./DatabaseQueryRedactor";

export interface GenericOutputRedaction {
  text: string;
  // How many values, blocks or tokens were masked.
  redactionCount: number;
}

export const GENERIC_REDACTED_MARKER: string = "[redacted]";

// Every marker this module writes starts with it: "[redacted-jwt]" too.
const REDACTED_PREFIX: string = "[redacted";

const DATA_BLOCK_KEYS: Set<string> = new Set<string>([
  "data",
  "stringData",
  "binaryData",
]);

const LAST_APPLIED_CONFIGURATION_ANNOTATION: string =
  "kubectl.kubernetes.io/last-applied-configuration";

/*
 * A key or env name that names credential material. Deliberately broad:
 * `auth` also catches "authorization-mode", which is harmless to hide,
 * while a narrow list would miss "DB_PASSWORD". A bare `key` is NOT
 * credential-like (taints, tolerations and secretKeyRef all have one), but
 * `tls.key`, `KEY_ID`, `api_key` and `private-key-file` are.
 *
 * `pass`, `pw` and `creds` count as a whole segment only — DB_PASS,
 * RABBITMQ_DEFAULT_PASS, LDAP_BIND_PW, DB_CREDS, `--pass` — so "bypass",
 * "compass", "passed", "MAX_PASSES" and "ssl-passthrough" stay readable,
 * and "pass-through" is spelled out as not a credential. A few names glue
 * a prefix on instead: Redis's `requirepass`, "dbpass", "smtppass".
 */
const CREDENTIAL_NAME_REGEX: RegExp =
  /passw(?:or)?d|passwd|pwd|passphrase|passcode|(?:^|[-_./])pass(?:$|[-_.](?!through))|(?:require|db|user|admin|root|smtp|mail|redis|ldap|bind|sasl|ftp)pass(?![a-z])|(?:^|[-_./])(?:pw|creds?)(?:$|[-_.])|secret|token|credential|auth|cert|bearer|cookie|dockerconfig|dockercfg|webhook|(?:api|access|private|priv|encryption|signing|client|ssh|master|license|service|account|session|app|consumer|shared)[-_.]?key|(?:^|[-_./])key[-_.]|[-_./]key$|(?:^|[-_./])(?:dsn|salt|otp)(?:[-_.]|$)|\.(?:crt|cer|pem|p12|pfx|jks)$/i;

/*
 * Keys that match the pattern above but only ever REFER to a credential —
 * the name of a Secret a volume mounts, whether a token is automounted —
 * and that an on-call engineer needs when a pod cannot start. Compared
 * lowercase, with leading dashes stripped so flag names match too.
 */
const REFERENCE_ONLY_KEYS: Set<string> = new Set<string>([
  "secretname",
  "secretnamespace",
  "secretproviderclass",
  "secretkeyref",
  "secretref",
  "configmapkeyref",
  "tokenexpirationseconds",
  "expirationseconds",
  "serviceaccounttoken",
  "automountserviceaccounttoken",
  "imagepullsecrets",
  "image pull secrets",
  "mountable secrets",
  "tokens",
  "audience",
  "authorization-mode",
  "anonymous-auth",
  "tls-min-version",
  "tls-cipher-suites",
  "cert-manager.io/cluster-issuer",
  "cert-manager.io/issuer",
]);

/*
 * Values that carry no material and read better untouched: an absent
 * value, and describe's own "<set to the key 'x' in secret 'y'>" reference
 * for an env entry that comes from a Secret.
 */
const EXEMPT_VALUES: Set<string> = new Set<string>([
  "",
  '""',
  "''",
  "null",
  "~",
  "{}",
  "[]",
  "{",
  "[",
  "<none>",
  "<nil>",
  "<unset>",
  "<invalid>",
  "<empty>",
]);

const EXEMPT_VALUE_PREFIX: string = "<set to the key ";

// YAML block scalar indicators: |, |-, |+, >, >-, >2 ...
const BLOCK_SCALAR_REGEX: RegExp = /^[|>][+-]?[0-9]*$/;

/*
 * `key: value`, `key:` and `"key": value,` at the start of a line's content.
 * Unquoted keys may contain spaces (describe prints "Image ID:") but never
 * a colon, so "2026-09-22T10:00:00Z" and "http://…" are not keys. The colon
 * must be followed by whitespace or end the line for the same reason.
 */
const KEY_VALUE_LINE_REGEX: RegExp =
  /^(?:"([^"]*)"|'([^']*)'|([^\s"'#:{}[\],][^:"']*?))[ \t]*:(?:[ \t]+|$)/;

/*
 * An unquoted key with whitespace or `=` in it may be free text rather than
 * a name: "connecting DB_PASSWORD=hunter2 host: db" parses as the key
 * "connecting DB_PASSWORD=hunter2 host". Such a key is scanned for inline
 * material too.
 */
const FREE_TEXT_KEY_REGEX: RegExp = /[\s=]/;

const LIST_ITEM_PREFIX_REGEX: RegExp = /^-(?:[ \t]+|$)/;

const LEADING_WHITESPACE_REGEX: RegExp = /^[ \t]*/;

/*
 * scheme://user:password@host — the password only; an empty user still
 * counts. The match starts at "://" and the scheme is checked by a
 * lookbehind, so the scan stays linear: a pattern that STARTS with the
 * scheme retries `[a-z][a-z0-9+.-]*` from every word boundary of a long
 * dotted run ("eyJ.eyJ.eyJ…", "a.b.c.…") and backtracks through the whole
 * run each time — 200 KB of pod log took over 30 seconds on one thread.
 */
const URL_CREDENTIAL_REGEX: RegExp =
  /:\/\/(?<=\b[a-z][a-z0-9+.-]*:\/\/)([^\s/:@"']*):([^\s/@"']+)@/gi;

const BEARER_TOKEN_REGEX: RegExp = /\b(Bearer)[ \t]+([A-Za-z0-9._~+/-]{8,}=*)/g;

// Prose ("Basic configuration", "Bearer authentication") is lowercase letters only.
const LOWERCASE_WORD_REGEX: RegExp = /^[a-z]+$/;

const BASIC_TOKEN_REGEX: RegExp =
  /\b(Basic)[ \t]+([A-Za-z0-9+/]{8,}={0,2})(?![A-Za-z0-9+/=])/g;

const JWT_REGEX: RegExp =
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;

/*
 * PEM private key blocks. A block whose END line was truncated away is
 * masked to the end of the output rather than left standing.
 */
const PRIVATE_KEY_BLOCK_REGEX: RegExp =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g;

/*
 * Compact JSON, as in a one-line `"data":{...}` — the quote may be escaped
 * when the JSON itself sits inside a JSON string.
 */
const INLINE_JSON_DATA_OBJECT_REGEX: RegExp =
  /("|\\")(?:data|stringData|binaryData)(?:"|\\")\s*:\s*\{/g;

/*
 * A JSON string body: anything but an unescaped quote. Two spellings, for
 * plain JSON and for JSON escaped inside another JSON string.
 */
const JSON_STRING_BODY: string = '(?:[^"\\\\]|\\\\.)*';
const ESCAPED_JSON_STRING_BODY: string = '(?:[^"\\\\]|\\\\[^"])*';
const JSON_QUOTE: string = '"';
const ESCAPED_JSON_QUOTE: string = '\\\\"';

function buildJsonEnvPairRegexes(isEscaped: boolean): {
  nameFirst: RegExp;
  valueFirst: RegExp;
} {
  const body: string = isEscaped ? ESCAPED_JSON_STRING_BODY : JSON_STRING_BODY;
  const q: string = isEscaped ? ESCAPED_JSON_QUOTE : JSON_QUOTE;

  return {
    nameFirst: new RegExp(
      `(${q}name${q}\\s*:\\s*${q}(${body})${q}\\s*,\\s*${q}value${q}\\s*:\\s*${q})(${body})(${q})`,
      "g",
    ),
    valueFirst: new RegExp(
      `(${q}value${q}\\s*:\\s*${q})(${body})(${q}\\s*,\\s*${q}name${q}\\s*:\\s*${q}(${body})${q})`,
      "g",
    ),
  };
}

const JSON_ENV_PAIR_REGEXES: Array<{ nameFirst: RegExp; valueFirst: RegExp }> =
  [buildJsonEnvPairRegexes(false), buildJsonEnvPairRegexes(true)];

/*
 * `"key":"value"` / `"key":123` in one-line JSON — jsonpath's `{.data}`, a
 * structured log line. The key is judged by isCredentialKey. It never
 * contains a quote, a backslash or a line break, which keeps the scan
 * linear on a long escaped line. A string the output truncated before its
 * closing quote runs to the end of the text; an object or array value is
 * left for its own pairs. The only bare value JSON has that can hold
 * material is a number, so prose such as `volume "certs" : secret "x"` is
 * not read as a pair.
 */
interface JsonCredentialPairRule {
  quote: string;
  regex: RegExp;
}

function buildJsonCredentialPairRule(
  isEscaped: boolean,
): JsonCredentialPairRule {
  const body: string = isEscaped ? ESCAPED_JSON_STRING_BODY : JSON_STRING_BODY;
  const q: string = isEscaped ? ESCAPED_JSON_QUOTE : JSON_QUOTE;

  return {
    quote: isEscaped ? '\\"' : '"',
    regex: new RegExp(
      `(${q}([^"\\\\\\n]{1,256})${q}\\s*:\\s*)(?:(${q})(${body})(${q}|$)|(-?[0-9][0-9.eE+-]*))`,
      "g",
    ),
  };
}

const JSON_CREDENTIAL_PAIR_RULES: Array<JsonCredentialPairRule> = [
  buildJsonCredentialPairRule(false),
  buildJsonCredentialPairRule(true),
];

/*
 * `key=value` / `key: value` / `key:value` anywhere in a line — logs, args,
 * Go-formatted maps (`map[password:cGFz…]`). The key is judged by
 * isCredentialKey, so this never touches "timeout=1s" or "op=Exists". A
 * JSON-escaped line break (`…\npassword: x\nuser: bob` inside a log
 * message) separates pairs like a real one.
 */
const INLINE_PAIR_REGEX: RegExp =
  /(^|[\s[,{("']|\\[nrt])([A-Za-z0-9_./-]+)([ \t]*[:=][ \t]*)("(?:[^"\\]|\\.)*"|'[^']*'|(?:[^\s,;&\]})"'\\]|\\(?![nrt]))+)/g;

/*
 * An image reference — `registry.example.com/auth:1.2.3`,
 * `ghcr.io/org/secret-service:2.0` — has the shape of an inline pair whose
 * key is a path and whose separator is a bare colon with no whitespace
 * after it. A real pair with a path-shaped key (an annotation in describe
 * output, `vault.hashicorp.com/agent-inject-token: abc123`) always has the
 * space. The tag is what an on-call engineer needs most, so it stays.
 */
function isImageReferencePair(key: string, separator: string): boolean {
  return key.includes("/") && separator === ":";
}

/*
 * A command-line flag standing alone as one argv element: "--db-password",
 * "-password". A credential flag's value is then the NEXT element, which
 * the pair rules above never see.
 */
const FLAG_TOKEN_REGEX: RegExp = /^-{1,2}[A-Za-z][A-Za-z0-9_.-]*$/;

/*
 * A flag's value inside one line: a quoted string, or a bare word that is
 * neither the next flag ("-…") nor a marker this module already wrote.
 */
const INLINE_FLAG_VALUE_PATTERN: RegExp =
  /("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'[\-,;&|`\])}][^\s"',;&|`\])}]*)/;
const INLINE_FLAG_VALUE_SOURCE: string = INLINE_FLAG_VALUE_PATTERN.source;

// Where a flag can start inside a line.
const INLINE_FLAG_BOUNDARY_PATTERN: RegExp = /(^|[\s"'[(,;&|`])/;
const INLINE_FLAG_BOUNDARY_SOURCE: string = INLINE_FLAG_BOUNDARY_PATTERN.source;

/*
 * `--requirepass value` / `-password value` in one line: a command in a
 * log, describe's probe line, an `sh -c` script. The flag is judged by
 * isCredentialKey, so "--port 8080" and "--tail 100" stay.
 */
const INLINE_SPLIT_FLAG_REGEX: RegExp = new RegExp(
  `${INLINE_FLAG_BOUNDARY_SOURCE}(--?[A-Za-z][A-Za-z0-9_.-]*)([ \\t]+)${INLINE_FLAG_VALUE_SOURCE}`,
  "g",
);

/*
 * `"--db-password","value"` — a flag and its value as neighbouring JSON
 * array strings (jsonpath `{.spec.containers[*].args}`), plain, escaped
 * inside another JSON string, or single-quoted as a Python list prints it.
 */
function buildQuotedFlagPairRegex(quote: string, body: string): RegExp {
  return new RegExp(
    `(${quote}(--?[A-Za-z][A-Za-z0-9_.-]*)${quote}\\s*,\\s*${quote})(${body})(${quote})`,
    "g",
  );
}

const QUOTED_FLAG_PAIR_REGEXES: Array<RegExp> = [
  buildQuotedFlagPairRegex(JSON_QUOTE, JSON_STRING_BODY),
  buildQuotedFlagPairRegex(ESCAPED_JSON_QUOTE, ESCAPED_JSON_STRING_BODY),
  buildQuotedFlagPairRegex("'", "[^']*"),
];

/*
 * Tools whose single-letter flag carries a password: `mysql -pS3cret`,
 * `mongosh -p S3cret`, `sshpass -p S3cret`, `redis-cli -a S3cret`. The
 * same letters mean something else everywhere else — `-p` is a port for
 * ssh, psql and redis-cli and "make parents" for mkdir — so a short flag
 * is judged only where the command names one of these tools: earlier on
 * the same line, or earlier in the same one-element-per-line argv list.
 */
const SHORT_PASSWORD_FLAG_BY_TOOL: Map<string, string> = new Map<
  string,
  string
>([
  ["mysql", "p"],
  ["mysqladmin", "p"],
  ["mysqldump", "p"],
  ["mysqlcheck", "p"],
  ["mysqlimport", "p"],
  ["mysqlshow", "p"],
  ["mysqlpump", "p"],
  ["mysqlsh", "p"],
  ["mariadb", "p"],
  ["mariadb-admin", "p"],
  ["mariadb-dump", "p"],
  ["mariadb-check", "p"],
  ["mariadb-import", "p"],
  ["mongo", "p"],
  ["mongosh", "p"],
  ["mongodump", "p"],
  ["mongorestore", "p"],
  ["mongoexport", "p"],
  ["mongoimport", "p"],
  ["mongostat", "p"],
  ["mongotop", "p"],
  ["sshpass", "p"],
  ["redis-cli", "a"],
  ["keydb-cli", "a"],
  ["valkey-cli", "a"],
]);

// One of those tools named inside a line, a path in front of it allowed.
const TOOL_NAME_REGEX: RegExp = new RegExp(
  `(^|[\\s/"'[(,;&|=\`])(${Array.from(SHORT_PASSWORD_FLAG_BY_TOOL.keys()).join("|")})(?=$|[\\s"'\\]),;&|\`\\\\])`,
  "g",
);

// Where the command a tool starts ends inside a line.
const COMMAND_END_REGEX: RegExp = /[\];|&)`]/;

interface ShortPasswordFlagRegexes {
  // "-pS3cret"
  attached: RegExp;
  // "-p S3cret", and "-p","S3cret" in a JSON array.
  separated: RegExp;
}

// The password glued to a short flag ("-pS3cret"): a bare word.
const SHORT_PASSWORD_ATTACHED_VALUE_PATTERN: RegExp =
  /([^\s"'[\-,;&|`\])}][^\s"',;&|`\])}]*)/;

// What separates a short flag from its password: blanks, or a list's ",".
const SHORT_PASSWORD_SEPARATOR_PATTERN: RegExp =
  /([ \t]+|"\s*,\s*"|\\"\s*,\s*\\"|'\s*,\s*')/;

function buildShortPasswordFlagRegexes(
  letter: string,
): ShortPasswordFlagRegexes {
  return {
    attached: new RegExp(
      `${INLINE_FLAG_BOUNDARY_SOURCE}(-${letter})${SHORT_PASSWORD_ATTACHED_VALUE_PATTERN.source}`,
      "g",
    ),
    separated: new RegExp(
      `${INLINE_FLAG_BOUNDARY_SOURCE}(-${letter})${SHORT_PASSWORD_SEPARATOR_PATTERN.source}${INLINE_FLAG_VALUE_SOURCE}`,
      "g",
    ),
  };
}

const SHORT_PASSWORD_FLAG_REGEXES: Map<string, ShortPasswordFlagRegexes> =
  new Map<string, ShortPasswordFlagRegexes>(
    Array.from(new Set<string>(SHORT_PASSWORD_FLAG_BY_TOOL.values())).map(
      (letter: string): [string, ShortPasswordFlagRegexes] => {
        return [letter, buildShortPasswordFlagRegexes(letter)];
      },
    ),
  );

/*
 * `kubectl describe configmap` prints each data entry as "KEY:", this rule
 * on the next line, and the value verbatim below it; the entries end with
 * a "BinaryData" heading underlined the same way.
 */
const DESCRIBE_DATA_ENTRY_RULE: string = "----";
const DESCRIBE_BINARY_DATA_HEADING: string = "BinaryData";
const DESCRIBE_SECTION_RULE: string = "====";

/*
 * Base64 runs. A padded run of any length is base64 by construction
 * ("cGFzc3dvcmQ=" is "password"); an unpadded run must be long and mixed to
 * count, so identifiers, hashes and hex ids stay legible. The padding must
 * end the token: "--feature-gates=Foo=true" is a flag, not a secret.
 */
const BASE64_PADDED_REGEX: RegExp =
  /(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{4,})(={1,2})(?![A-Za-z0-9+/=])/g;

const BASE64_LONG_REGEX: RegExp =
  /(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{32,})(?![A-Za-z0-9+/=])/g;

interface ParsedLine {
  raw: string;
  isBlank: boolean;
  // Width of the leading whitespace.
  indent: number;
  // A YAML sequence entry: "- key: value" or "- value".
  isListItem: boolean;
  // Where the entry's own content starts: after the "- " of a list item.
  contentIndent: number;
  // The key of a "key: value" line, without quotes; absent otherwise.
  key?: string | undefined;
  // An unquoted key with whitespace or "=" in it, which may be free text.
  keyIsFreeText?: boolean | undefined;
  // Everything after the colon, trimmed; "" for "key:".
  value?: string | undefined;
  // Column in `raw` where the value text begins.
  valueStart?: number | undefined;
}

interface RedactedLines {
  lines: Array<string>;
  // Index of the first line NOT consumed.
  next: number;
  count: number;
}

// What the up-front passes decided about lines the main pass reaches later.
interface LineMasks {
  // `value:` lines of env entries whose name looks credential-like.
  envValueLines: Set<number>;
  // Argv elements that are a credential flag's value, with their masked text.
  argvValueLines: Map<number, string>;
}

// A one-element-per-line argv list as findArgvValueLines walks it.
interface ArgvList {
  indent: number;
  isListItem: boolean;
  // The short password flag of a tool named earlier in the list ("p", "a").
  shortPasswordFlag: string | undefined;
  // The previous element was a credential flag: this one is its value.
  expectsValue: boolean;
}

function parseLine(raw: string): ParsedLine {
  const whitespaceMatch: RegExpExecArray | null =
    LEADING_WHITESPACE_REGEX.exec(raw);
  const indent: number = whitespaceMatch ? whitespaceMatch[0].length : 0;
  let content: string = raw.slice(indent);

  if (content.trim() === "") {
    return { raw, isBlank: true, indent, isListItem: false, contentIndent: 0 };
  }

  let isListItem: boolean = false;
  let contentIndent: number = indent;

  const listMatch: RegExpExecArray | null =
    LIST_ITEM_PREFIX_REGEX.exec(content);
  if (listMatch) {
    isListItem = true;
    contentIndent = indent + listMatch[0].length;
    content = content.slice(listMatch[0].length);
  }

  const keyMatch: RegExpExecArray | null = KEY_VALUE_LINE_REGEX.exec(content);

  if (!keyMatch) {
    return { raw, isBlank: false, indent, isListItem, contentIndent };
  }

  const key: string = (keyMatch[1] ?? keyMatch[2] ?? keyMatch[3] ?? "").trim();
  const valueStart: number = contentIndent + keyMatch[0].length;

  return {
    raw,
    isBlank: false,
    indent,
    isListItem,
    contentIndent,
    key,
    keyIsFreeText:
      keyMatch[3] !== undefined && FREE_TEXT_KEY_REGEX.test(keyMatch[3]),
    value: raw.slice(valueStart).trim(),
    valueStart,
  };
}

// Strip a JSON trailing comma and surrounding quotes from a scalar.
function unquote(value: string): string {
  let body: string = value.trim();
  if (body.endsWith(",")) {
    body = body.slice(0, -1).trimEnd();
  }
  if (
    body.length >= 2 &&
    ((body.startsWith('"') && body.endsWith('"')) ||
      (body.startsWith("'") && body.endsWith("'")))
  ) {
    body = body.slice(1, -1);
  }
  return body;
}

function isDocumentSeparator(line: ParsedLine): boolean {
  return line.raw.trim() === "---";
}

function isBlockScalar(value: string): boolean {
  return BLOCK_SCALAR_REGEX.test(value);
}

// "data:" or "\"data\": {" — a mapping whose entries follow on later lines.
function isContainerStart(value: string | undefined): boolean {
  return value === "" || value === "{";
}

// A value with no material in it, including a marker an earlier pass wrote.
function isExemptValue(value: string): boolean {
  let body: string = value.trim();
  if (body.endsWith(",")) {
    body = body.slice(0, -1).trimEnd();
  }
  return (
    EXEMPT_VALUES.has(body) ||
    body.startsWith(EXEMPT_VALUE_PREFIX) ||
    unquote(body).startsWith(REDACTED_PREFIX)
  );
}

function looksLikeCredentialName(name: string): boolean {
  return CREDENTIAL_NAME_REGEX.test(name.trim());
}

// A key that names credential material, minus the reference-only keys.
function isCredentialKey(key: string): boolean {
  const normalized: string = key.trim().replace(/^-+/, "").toLowerCase();
  if (REFERENCE_ONLY_KEYS.has(normalized)) {
    return false;
  }
  return looksLikeCredentialName(normalized);
}

/*
 * An argv element that can be a flag's value: not the next flag, not
 * empty, not a marker this module already wrote.
 */
function isArgvValue(element: string): boolean {
  return !element.startsWith("-") && !isExemptValue(element);
}

// The short password flag of the tool an argv element names, if any.
function shortPasswordFlagOfTool(element: string): string | undefined {
  return SHORT_PASSWORD_FLAG_BY_TOOL.get(
    element.slice(element.lastIndexOf("/") + 1),
  );
}

/*
 * A scalar replaced by the marker, keeping its quotes, a JSON trailing
 * comma and `keptPrefix` (the "-p" of "-pS3cret").
 */
function maskScalar(value: string, keptPrefix: string = ""): string {
  const trailingComma: string = value.trimEnd().endsWith(",") ? "," : "";
  const body: string = trailingComma
    ? value.trimEnd().slice(0, -1).trimEnd()
    : value.trim();

  if (body.startsWith('"')) {
    return `"${keptPrefix}${GENERIC_REDACTED_MARKER}"${trailingComma}`;
  }
  if (body.startsWith("'")) {
    return `'${keptPrefix}${GENERIC_REDACTED_MARKER}'${trailingComma}`;
  }
  return `${keptPrefix}${GENERIC_REDACTED_MARKER}${trailingComma}`;
}

/*
 * A bare value found inside a line, replaced by the marker. When the value
 * ends the body of an escaped JSON string (`…=S3cret\"`), the backslash
 * belongs to the closing quote and stays.
 */
function maskInlineValue(value: string): string {
  if (value.startsWith('"') || value.startsWith("'")) {
    return maskScalar(value);
  }
  return `${GENERIC_REDACTED_MARKER}${value.endsWith("\\") ? "\\" : ""}`;
}

/*
 * The part of a `key: value` line before its value. A key that may be free
 * text gets the inline rules; an ordinary key is returned as it is.
 */
function redactKeyPrefix(line: ParsedLine): { text: string; count: number } {
  const prefix: string = line.raw.slice(0, line.valueStart ?? 0);

  if (!line.keyIsFreeText) {
    return { text: prefix, count: 0 };
  }

  const inline: { text: string; count: number } = applyInlineRules(
    prefix.slice(line.contentIndent),
  );

  return {
    text: prefix.slice(0, line.contentIndent) + inline.text,
    count: inline.count,
  };
}

function maskValueInPlace(line: ParsedLine): { text: string; count: number } {
  if (line.valueStart === undefined || line.value === undefined) {
    return {
      text: " ".repeat(line.indent) + GENERIC_REDACTED_MARKER,
      count: 1,
    };
  }

  const prefix: { text: string; count: number } = redactKeyPrefix(line);

  return {
    text: prefix.text + maskScalar(line.value),
    count: prefix.count + 1,
  };
}

// The first line at or above `indent` — the end of a nested block.
function skipDeeperLines(
  parsed: Array<ParsedLine>,
  from: number,
  indent: number,
): number {
  let index: number = from;
  while (index < parsed.length) {
    const line: ParsedLine = parsed[index]!;
    if (!line.isBlank && line.indent <= indent) {
      break;
    }
    index++;
  }
  return index;
}

const UPPERCASE_REGEX: RegExp = /[A-Z]/;
const LOWERCASE_REGEX: RegExp = /[a-z]/;
const DIGIT_REGEX: RegExp = /[0-9]/;

function hasUpperAndLower(text: string): boolean {
  return UPPERCASE_REGEX.test(text) && LOWERCASE_REGEX.test(text);
}

function hasDigit(text: string): boolean {
  return DIGIT_REGEX.test(text);
}

// `Bearer …` / `Basic …`: the token after the scheme, unless it is prose.
function maskAuthorizationTokens(
  text: string,
  regex: RegExp,
): { text: string; count: number } {
  let count: number = 0;

  const result: string = text.replace(
    regex,
    (match: string, scheme: string, token: string): string => {
      if (LOWERCASE_WORD_REGEX.test(token)) {
        return match;
      }
      count++;
      return `${scheme} ${GENERIC_REDACTED_MARKER}`;
    },
  );

  return { text: result, count };
}

/*
 * One-line JSON env pairs, `"name":"X","value":"Y"` in either order: the
 * value is masked when the name looks credential-like and the value holds
 * something (an empty value, or one already masked, stays as it is).
 */
function maskJsonEnvPairs(
  text: string,
  regexes: { nameFirst: RegExp; valueFirst: RegExp },
): { text: string; count: number } {
  let count: number = 0;

  let result: string = text.replace(
    regexes.nameFirst,
    (
      match: string,
      prefix: string,
      name: string,
      value: string,
      closingQuote: string,
    ): string => {
      if (!looksLikeCredentialName(name) || isExemptValue(value)) {
        return match;
      }
      count++;
      return `${prefix}${GENERIC_REDACTED_MARKER}${closingQuote}`;
    },
  );

  result = result.replace(
    regexes.valueFirst,
    (
      match: string,
      prefix: string,
      value: string,
      suffix: string,
      name: string,
    ): string => {
      if (!looksLikeCredentialName(name) || isExemptValue(value)) {
        return match;
      }
      count++;
      return `${prefix}${GENERIC_REDACTED_MARKER}${suffix}`;
    },
  );

  return { text: result, count };
}

/*
 * One-line JSON `"key":"value"` pairs whose key looks credential-like, and
 * the last-applied-configuration annotation as jsonpath prints it. The
 * quotes stay, so the JSON still parses; a bare number becomes a string.
 */
function maskJsonCredentialPairs(
  text: string,
  rule: JsonCredentialPairRule,
): { text: string; count: number } {
  let count: number = 0;

  const result: string = text.replace(
    rule.regex,
    (
      match: string,
      prefix: string,
      key: string,
      openingQuote: string | undefined,
      body: string | undefined,
      closingQuote: string | undefined,
      bare: string | undefined,
    ): string => {
      if (
        key !== LAST_APPLIED_CONFIGURATION_ANNOTATION &&
        !isCredentialKey(key)
      ) {
        return match;
      }

      if (openingQuote !== undefined) {
        if (isExemptValue(body ?? "")) {
          return match;
        }
        count++;
        return `${prefix}${openingQuote}${GENERIC_REDACTED_MARKER}${closingQuote ?? ""}`;
      }

      if (bare === undefined) {
        return match;
      }
      count++;
      return `${prefix}${rule.quote}${GENERIC_REDACTED_MARKER}${rule.quote}`;
    },
  );

  return { text: result, count };
}

// `"--db-password","value"` in a one-line array: the value is masked.
function maskQuotedFlagPairs(
  text: string,
  regex: RegExp,
): { text: string; count: number } {
  let count: number = 0;

  const result: string = text.replace(
    regex,
    (
      match: string,
      prefix: string,
      flag: string,
      value: string,
      closingQuote: string,
    ): string => {
      if (!isCredentialKey(flag) || !isArgvValue(value)) {
        return match;
      }
      count++;
      return `${prefix}${GENERIC_REDACTED_MARKER}${closingQuote}`;
    },
  );

  return { text: result, count };
}

// `--requirepass value` inside one line: the value is masked.
function maskInlineSplitFlags(text: string): { text: string; count: number } {
  let count: number = 0;

  const result: string = text.replace(
    INLINE_SPLIT_FLAG_REGEX,
    (
      match: string,
      boundary: string,
      flag: string,
      separator: string,
      value: string,
    ): string => {
      if (!isCredentialKey(flag) || !isArgvValue(unquote(value))) {
        return match;
      }
      count++;
      return `${boundary}${flag}${separator}${maskInlineValue(value)}`;
    },
  );

  return { text: result, count };
}

// A tool's short password flag within the stretch of a line that is its command.
function maskShortPasswordFlag(
  text: string,
  letter: string,
): { text: string; count: number } {
  const regexes: ShortPasswordFlagRegexes | undefined =
    SHORT_PASSWORD_FLAG_REGEXES.get(letter);
  if (!regexes) {
    return { text, count: 0 };
  }

  let count: number = 0;

  let result: string = text.replace(
    regexes.separated,
    (
      match: string,
      boundary: string,
      flag: string,
      separator: string,
      value: string,
    ): string => {
      if (!isArgvValue(unquote(value))) {
        return match;
      }
      count++;
      return `${boundary}${flag}${separator}${maskInlineValue(value)}`;
    },
  );

  result = result.replace(
    regexes.attached,
    (_match: string, boundary: string, flag: string, value: string): string => {
      count++;
      return `${boundary}${flag}${maskInlineValue(value)}`;
    },
  );

  return { text: result, count };
}

/*
 * `mysql -pS3cret`, `mongosh -p S3cret`, `redis-cli -a S3cret`: a tool's
 * short password flag, judged only in the stretch of the line from the
 * tool's name to the next tool or the end of its command (`]`, `)`, `;`,
 * `|`, `&`, a backtick).
 */
function maskToolPasswordFlags(text: string): { text: string; count: number } {
  const tools: Array<{ start: number; end: number; letter: string }> = [];

  TOOL_NAME_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = TOOL_NAME_REGEX.exec(text);
  while (match) {
    const start: number = match.index + (match[1] ?? "").length;
    const name: string = match[2] ?? "";
    tools.push({
      start,
      end: start + name.length,
      letter: SHORT_PASSWORD_FLAG_BY_TOOL.get(name) ?? "",
    });
    match = TOOL_NAME_REGEX.exec(text);
  }
  TOOL_NAME_REGEX.lastIndex = 0;

  if (tools.length === 0) {
    return { text, count: 0 };
  }

  let result: string = "";
  let count: number = 0;
  let cursor: number = 0;

  tools.forEach(
    (
      tool: { start: number; end: number; letter: string },
      toolIndex: number,
    ): void => {
      /*
       * Only the stretch up to the next tool is searched for the command's
       * end, so a line naming a tool many times is still scanned once.
       */
      const nextTool: { start: number } | undefined = tools[toolIndex + 1];
      const stretch: string = text.slice(
        tool.end,
        nextTool ? nextTool.start : text.length,
      );
      const commandEnd: number = stretch.search(COMMAND_END_REGEX);
      const command: string =
        commandEnd === -1 ? stretch : stretch.slice(0, commandEnd);

      result += text.slice(cursor, tool.end);
      const masked: { text: string; count: number } = maskShortPasswordFlag(
        command,
        tool.letter,
      );
      result += masked.text;
      count += masked.count;
      cursor = tool.end + command.length;
    },
  );

  result += text.slice(cursor);

  return { text: result, count };
}

/*
 * Mask the body of every one-line `"data":{…}` object. Braces are matched
 * by depth; an object the line truncated away is masked to the end.
 */
function maskInlineJsonDataObjects(text: string): {
  text: string;
  count: number;
} {
  let result: string = text;
  let count: number = 0;
  let searchFrom: number = 0;

  while (searchFrom < result.length) {
    INLINE_JSON_DATA_OBJECT_REGEX.lastIndex = searchFrom;
    const match: RegExpExecArray | null =
      INLINE_JSON_DATA_OBJECT_REGEX.exec(result);
    if (!match) {
      break;
    }

    const quote: string = match[1] ?? '"';
    const bodyStart: number = match.index + match[0].length;
    let depth: number = 1;
    let position: number = bodyStart;

    while (position < result.length && depth > 0) {
      const character: string = result[position]!;
      if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
      }
      position++;
    }

    // `position` is just past the closing brace, or the end of the text.
    const bodyEnd: number = depth === 0 ? position - 1 : result.length;

    if (result.slice(bodyStart, bodyEnd).trim() === "") {
      searchFrom = position;
      continue;
    }

    const replacement: string = `${quote}${GENERIC_REDACTED_MARKER}${quote}:${quote}${GENERIC_REDACTED_MARKER}${quote}`;
    result = result.slice(0, bodyStart) + replacement + result.slice(bodyEnd);
    count++;
    searchFrom = bodyStart + replacement.length;
  }

  INLINE_JSON_DATA_OBJECT_REGEX.lastIndex = 0;

  return { text: result, count };
}

// The rules that apply to any line regardless of its YAML/JSON structure.
function applyInlineRules(text: string): { text: string; count: number } {
  let count: number = 0;
  let result: string = text;

  const apply: (masked: { text: string; count: number }) => void = (masked: {
    text: string;
    count: number;
  }): void => {
    result = masked.text;
    count += masked.count;
  };

  result = result.replace(
    URL_CREDENTIAL_REGEX,
    (_match: string, user: string): string => {
      count++;
      return `://${user}:${GENERIC_REDACTED_MARKER}@`;
    },
  );

  for (const tokenRegex of [BEARER_TOKEN_REGEX, BASIC_TOKEN_REGEX]) {
    apply(maskAuthorizationTokens(result, tokenRegex));
  }

  result = result.replace(JWT_REGEX, (): string => {
    count++;
    return "[redacted-jwt]";
  });

  apply(maskInlineJsonDataObjects(result));

  for (const pair of JSON_ENV_PAIR_REGEXES) {
    apply(maskJsonEnvPairs(result, pair));
  }

  for (const rule of JSON_CREDENTIAL_PAIR_RULES) {
    apply(maskJsonCredentialPairs(result, rule));
  }

  for (const regex of QUOTED_FLAG_PAIR_REGEXES) {
    apply(maskQuotedFlagPairs(result, regex));
  }

  result = result.replace(
    INLINE_PAIR_REGEX,
    (
      match: string,
      boundary: string,
      key: string,
      separator: string,
      value: string,
    ): string => {
      if (
        isImageReferencePair(key, separator) ||
        !isCredentialKey(key) ||
        isExemptValue(value)
      ) {
        return match;
      }
      count++;
      return `${boundary}${key}${separator}${GENERIC_REDACTED_MARKER}${value.endsWith("\\") ? "\\" : ""}`;
    },
  );

  apply(maskInlineSplitFlags(result));

  apply(maskToolPasswordFlags(result));

  result = result.replace(
    BASE64_PADDED_REGEX,
    (match: string, run: string): string => {
      if (!hasUpperAndLower(run) && !hasDigit(run)) {
        return match;
      }
      count++;
      return "[redacted-base64]";
    },
  );

  result = result.replace(
    BASE64_LONG_REGEX,
    (match: string, run: string): string => {
      if (!hasUpperAndLower(run) || !hasDigit(run)) {
        return match;
      }
      count++;
      return "[redacted-base64]";
    },
  );

  return { text: result, count };
}

/*
 * The inline rules over one line. A line that already parsed as
 * `key: value` has its value examined, and its key only when the key may
 * be free text: its key was judged by isCredentialKey (and possibly
 * exempted), and re-reading "Image pull secrets:" as the pair "secrets:
 * <none>" must not undo that.
 */
function applyInlineRulesToLine(line: ParsedLine): {
  text: string;
  count: number;
} {
  if (line.valueStart === undefined || line.value === undefined) {
    return applyInlineRules(line.raw);
  }

  const prefix: { text: string; count: number } = redactKeyPrefix(line);
  const inline: { text: string; count: number } = applyInlineRules(
    line.raw.slice(line.valueStart),
  );

  return {
    text: prefix.text + inline.text,
    count: prefix.count + inline.count,
  };
}

export class GenericOutputRedactor {
  public static redact(output: string): GenericOutputRedaction {
    if (!output) {
      return { text: "", redactionCount: 0 };
    }

    const parsed: Array<ParsedLine> = output
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(parseLine);

    const masks: LineMasks = {
      envValueLines: GenericOutputRedactor.findCredentialEnvValueLines(parsed),
      argvValueLines: GenericOutputRedactor.findArgvValueLines(parsed),
    };

    const out: Array<string> = [];
    let count: number = 0;
    let index: number = 0;

    while (index < parsed.length) {
      const line: ParsedLine = parsed[index]!;

      let step: RedactedLines;
      if (
        GenericOutputRedactor.isDescribeDataEntry(parsed, index) &&
        isCredentialKey(line.key ?? "")
      ) {
        step = GenericOutputRedactor.redactDescribeDataEntry(parsed, index);
      } else if (
        !line.isBlank &&
        line.key !== undefined &&
        DATA_BLOCK_KEYS.has(line.key) &&
        isContainerStart(line.value)
      ) {
        step = GenericOutputRedactor.redactDataBlock(parsed, index, masks);
      } else {
        step = GenericOutputRedactor.redactStandaloneLine(parsed, index, masks);
      }

      out.push(...step.lines);
      count += step.count;
      index = step.next;
    }

    let text: string = out.join("\n");

    text = text.replace(PRIVATE_KEY_BLOCK_REGEX, (): string => {
      count++;
      return "[redacted-private-key]";
    });

    return { text, redactionCount: count };
  }

  /*
   * Which `value:` lines belong to an env entry whose `name:` looks
   * credential-like. Found up front because the value may precede the name
   * inside its entry, and the main pass only ever moves forward.
   */
  private static findCredentialEnvValueLines(
    parsed: Array<ParsedLine>,
  ): Set<number> {
    const valueLines: Set<number> = new Set<number>();

    for (let index: number = 0; index < parsed.length; index++) {
      const line: ParsedLine = parsed[index]!;

      if (line.isBlank || line.key !== "name" || line.value === undefined) {
        continue;
      }

      const name: string = unquote(line.value);
      if (!name || !looksLikeCredentialName(name)) {
        continue;
      }

      const valueLine: number | undefined =
        GenericOutputRedactor.findSiblingValueLine(parsed, index);
      if (valueLine !== undefined) {
        valueLines.add(valueLine);
      }
    }

    return valueLines;
  }

  /*
   * Argv printed one element per line — `- --db-password` / `- value` in
   * YAML, `"--db-password",` / `"value"` in pretty JSON, describe's Command
   * and Args blocks — and the elements that are the value of a credential
   * flag before them, each with its masked text. A list's elements are
   * consecutive lines at the same indent and of the same shape; a
   * `key: value` line ends it (describe prints an argument that contains
   * ": " as is, so a flag's value may look like one). A tool's short
   * password flag counts only once the list has named the tool.
   */
  private static findArgvValueLines(
    parsed: Array<ParsedLine>,
  ): Map<number, string> {
    const masked: Map<number, string> = new Map<number, string>();
    let list: ArgvList | undefined = undefined;

    for (let index: number = 0; index < parsed.length; index++) {
      const line: ParsedLine = parsed[index]!;

      if (line.isBlank) {
        continue;
      }

      // "- key: value" is a mapping entry, never an argv element.
      if (line.isListItem && line.key !== undefined) {
        list = undefined;
        continue;
      }

      if (
        list === undefined ||
        list.indent !== line.indent ||
        list.isListItem !== line.isListItem
      ) {
        list = {
          indent: line.indent,
          isListItem: line.isListItem,
          shortPasswordFlag: undefined,
          expectsValue: false,
        };
      }

      const indentText: string = line.raw.slice(0, line.contentIndent);
      const content: string = line.raw.slice(line.contentIndent);
      const element: string = unquote(content);

      if (list.expectsValue) {
        list.expectsValue = false;
        if (isArgvValue(element)) {
          masked.set(index, indentText + maskScalar(content));
          continue;
        }
      }

      if (line.key !== undefined) {
        list = undefined;
        continue;
      }

      const shortFlag: string | undefined =
        list.shortPasswordFlag !== undefined
          ? `-${list.shortPasswordFlag}`
          : undefined;

      if (shortFlag !== undefined && element.startsWith(shortFlag)) {
        const attached: string = element.slice(shortFlag.length);
        if (attached === "") {
          list.expectsValue = true;
        } else if (isArgvValue(attached)) {
          masked.set(index, indentText + maskScalar(content, shortFlag));
        }
        continue;
      }

      if (FLAG_TOKEN_REGEX.test(element) && isCredentialKey(element)) {
        list.expectsValue = true;
        continue;
      }

      const toolFlag: string | undefined = shortPasswordFlagOfTool(element);
      if (toolFlag !== undefined) {
        list.shortPasswordFlag = toolFlag;
      }
    }

    return masked;
  }

  /*
   * The `value:` sibling of a `name:` line inside the same list entry (YAML)
   * or object (JSON). Siblings share the name line's content indent; a
   * shallower line ends the entry, a deeper one is nested under a sibling.
   */
  private static findSiblingValueLine(
    parsed: Array<ParsedLine>,
    nameIndex: number,
  ): number | undefined {
    const nameLine: ParsedLine = parsed[nameIndex]!;
    const indent: number = nameLine.contentIndent;

    for (let index: number = nameIndex + 1; index < parsed.length; index++) {
      const line: ParsedLine = parsed[index]!;
      if (line.isBlank) {
        continue;
      }
      if (line.indent < indent) {
        break;
      }
      if (line.indent > indent || line.isListItem) {
        continue;
      }
      if (line.key === "value") {
        return index;
      }
    }

    // "- name: X" is its entry's first line: nothing above it is a sibling.
    if (nameLine.isListItem) {
      return undefined;
    }

    for (let index: number = nameIndex - 1; index >= 0; index--) {
      const line: ParsedLine = parsed[index]!;
      if (line.isBlank) {
        continue;
      }
      if (line.isListItem && line.contentIndent === indent) {
        // The entry's own "- …" line — a sibling, and the entry's start.
        return line.key === "value" ? index : undefined;
      }
      if (line.indent < indent) {
        break;
      }
      if (line.indent > indent || line.isListItem) {
        continue;
      }
      if (line.key === "value") {
        return index;
      }
    }

    return undefined;
  }

  /*
   * The `kind:` sibling of a data block: same indent, same object, on
   * either side of the block. Undefined when the output does not say — a
   * truncated object, or not a Kubernetes object at all.
   */
  private static findSiblingKind(
    parsed: Array<ParsedLine>,
    blockIndex: number,
  ): string | undefined {
    const indent: number = parsed[blockIndex]!.contentIndent;

    for (let index: number = blockIndex - 1; index >= 0; index--) {
      const line: ParsedLine = parsed[index]!;
      if (line.isBlank) {
        continue;
      }
      if (isDocumentSeparator(line)) {
        break;
      }
      if (line.indent > indent) {
        continue;
      }
      if (line.isListItem && line.contentIndent === indent) {
        // The entry's own "- …" line: its first key, and the entry's start.
        if (line.key === "kind" && line.value !== undefined) {
          return unquote(line.value);
        }
        break;
      }
      if (line.indent < indent) {
        break;
      }
      if (line.isListItem) {
        continue;
      }
      if (line.key === "kind" && line.value !== undefined) {
        return unquote(line.value);
      }
    }

    for (let index: number = blockIndex + 1; index < parsed.length; index++) {
      const line: ParsedLine = parsed[index]!;
      if (line.isBlank) {
        continue;
      }
      if (isDocumentSeparator(line)) {
        break;
      }
      if (line.indent > indent) {
        continue;
      }
      if (line.indent < indent) {
        break;
      }
      if (line.isListItem) {
        continue;
      }
      if (line.key === "kind" && line.value !== undefined) {
        return unquote(line.value);
      }
    }

    return undefined;
  }

  /*
   * A `kubectl describe configmap` data entry: "KEY:" with nothing after
   * the colon, then the "----" rule at the same indent on the next line.
   */
  private static isDescribeDataEntry(
    parsed: Array<ParsedLine>,
    index: number,
  ): boolean {
    const line: ParsedLine | undefined = parsed[index];
    const rule: ParsedLine | undefined = parsed[index + 1];

    return (
      line !== undefined &&
      rule !== undefined &&
      !line.isBlank &&
      !line.isListItem &&
      line.key !== undefined &&
      line.value === "" &&
      !rule.isBlank &&
      rule.indent === line.indent &&
      rule.raw.trim() === DESCRIBE_DATA_ENTRY_RULE
    );
  }

  /*
   * Where a describe data entry's value ends: at the next entry or the
   * "BinaryData" heading after the last one — each follows a blank line at
   * the entry's indent — or at the end of the output.
   */
  private static isDescribeDataValueEnd(
    parsed: Array<ParsedLine>,
    index: number,
    indent: number,
  ): boolean {
    const line: ParsedLine = parsed[index]!;
    const previous: ParsedLine | undefined = parsed[index - 1];
    const next: ParsedLine | undefined = parsed[index + 1];

    if (line.isBlank || line.indent !== indent || !previous?.isBlank) {
      return false;
    }

    if (GenericOutputRedactor.isDescribeDataEntry(parsed, index)) {
      return true;
    }

    return (
      line.raw.trim() === DESCRIBE_BINARY_DATA_HEADING &&
      next !== undefined &&
      next.raw.trim() === DESCRIBE_SECTION_RULE
    );
  }

  /*
   * A credential-like describe data entry. The key and the rule stay; the
   * whole value — every line of it, blank lines included, since a
   * properties file or a PEM block has them — becomes one marker, and the
   * blank lines that close the entry stay. A value the Runner truncated
   * is masked to the end of the output.
   */
  private static redactDescribeDataEntry(
    parsed: Array<ParsedLine>,
    headerIndex: number,
  ): RedactedLines {
    const header: ParsedLine = parsed[headerIndex]!;
    const valueStart: number = headerIndex + 2;

    let end: number = valueStart;
    while (
      end < parsed.length &&
      !GenericOutputRedactor.isDescribeDataValueEnd(parsed, end, header.indent)
    ) {
      end++;
    }

    let lastValueLine: number = valueStart - 1;
    for (let index: number = valueStart; index < end; index++) {
      if (!parsed[index]!.isBlank) {
        lastValueLine = index;
      }
    }

    const lines: Array<string> = [header.raw, parsed[headerIndex + 1]!.raw];
    let count: number = 0;

    if (lastValueLine >= valueStart) {
      const valueLines: Array<ParsedLine> = parsed.slice(
        valueStart,
        lastValueLine + 1,
      );
      const isAlreadyMasked: boolean = valueLines.every(
        (line: ParsedLine): boolean => {
          return line.isBlank || line.raw.trim() === GENERIC_REDACTED_MARKER;
        },
      );

      if (isAlreadyMasked) {
        lines.push(
          ...valueLines.map((line: ParsedLine): string => {
            return line.raw;
          }),
        );
      } else {
        lines.push(" ".repeat(header.indent) + GENERIC_REDACTED_MARKER);
        count++;
      }
    }

    for (let index: number = lastValueLine + 1; index < end; index++) {
      lines.push(parsed[index]!.raw);
    }

    return { lines, next: end, count };
  }

  /*
   * A `data:` / `stringData:` / `binaryData:` block. Every value is masked
   * for a Secret or an object of unknown kind; only credential-like keys
   * are masked for anything else. Keys are kept either way.
   */
  private static redactDataBlock(
    parsed: Array<ParsedLine>,
    blockIndex: number,
    masks: LineMasks,
  ): RedactedLines {
    const block: ParsedLine = parsed[blockIndex]!;
    const kind: string | undefined = GenericOutputRedactor.findSiblingKind(
      parsed,
      blockIndex,
    );
    const maskEveryValue: boolean =
      kind === undefined || kind.toLowerCase() === "secret";

    const lines: Array<string> = [block.raw];
    let count: number = 0;
    let index: number = blockIndex + 1;
    let entryIndent: number | undefined = undefined;
    let entryMasked: boolean = false;

    while (index < parsed.length) {
      const line: ParsedLine = parsed[index]!;

      if (line.isBlank) {
        if (!entryMasked) {
          lines.push(line.raw);
        }
        index++;
        continue;
      }

      if (line.indent <= block.contentIndent) {
        break;
      }

      if (entryIndent === undefined) {
        entryIndent = line.indent;
      }

      // Deeper than an entry: a block scalar body or nested structure.
      if (line.indent > entryIndent) {
        if (maskEveryValue || entryMasked) {
          index++;
          continue;
        }
        const nested: RedactedLines =
          GenericOutputRedactor.redactStandaloneLine(parsed, index, masks);
        lines.push(...nested.lines);
        count += nested.count;
        index = nested.next;
        continue;
      }

      if (line.key === undefined) {
        // Not "key: value" — an unexpected shape inside a data block.
        if (maskEveryValue) {
          lines.push(" ".repeat(line.indent) + GENERIC_REDACTED_MARKER);
          count++;
          entryMasked = true;
        } else {
          const inline: { text: string; count: number } = applyInlineRules(
            line.raw,
          );
          lines.push(inline.text);
          count += inline.count;
          entryMasked = false;
        }
        index++;
        continue;
      }

      if (maskEveryValue || isCredentialKey(line.key)) {
        if (line.value !== undefined && !isExemptValue(line.value)) {
          const masked: { text: string; count: number } =
            maskValueInPlace(line);
          lines.push(masked.text);
          count += masked.count;
        } else {
          lines.push(line.raw);
        }
        entryMasked = true;
        index++;
        continue;
      }

      const inline: { text: string; count: number } =
        applyInlineRulesToLine(line);
      lines.push(inline.text);
      count += inline.count;
      entryMasked = false;
      index++;
    }

    return { lines, next: index, count };
  }

  /*
   * One line outside a data block: env value, argv value, credential-like
   * key, inline rules.
   */
  private static redactStandaloneLine(
    parsed: Array<ParsedLine>,
    index: number,
    masks: LineMasks,
  ): RedactedLines {
    const line: ParsedLine = parsed[index]!;

    if (line.isBlank) {
      return { lines: [line.raw], next: index + 1, count: 0 };
    }

    if (masks.envValueLines.has(index) && line.value !== undefined) {
      if (isBlockScalar(line.value)) {
        const masked: { text: string; count: number } = maskValueInPlace(line);
        return {
          lines: [masked.text],
          next: skipDeeperLines(parsed, index + 1, line.contentIndent),
          count: masked.count,
        };
      }
      if (!isExemptValue(line.value)) {
        const masked: { text: string; count: number } = maskValueInPlace(line);
        return { lines: [masked.text], next: index + 1, count: masked.count };
      }
    }

    const argvValue: string | undefined = masks.argvValueLines.get(index);
    if (argvValue !== undefined) {
      return { lines: [argvValue], next: index + 1, count: 1 };
    }

    if (
      line.key !== undefined &&
      line.value !== undefined &&
      (line.key === LAST_APPLIED_CONFIGURATION_ANNOTATION ||
        isCredentialKey(line.key))
    ) {
      if (isBlockScalar(line.value)) {
        const masked: { text: string; count: number } = maskValueInPlace(line);
        return {
          lines: [masked.text],
          next: skipDeeperLines(parsed, index + 1, line.contentIndent),
          count: masked.count,
        };
      }
      if (!isExemptValue(line.value)) {
        const masked: { text: string; count: number } = maskValueInPlace(line);
        return { lines: [masked.text], next: index + 1, count: masked.count };
      }
      /*
       * A credential-like key with nothing to hide on this line: its
       * children are judged on their own, and describe's "<set to the key
       * …>" reference must not be chewed up by the inline pair rule.
       */
      const prefix: { text: string; count: number } = redactKeyPrefix(line);
      return {
        lines: [prefix.text + line.raw.slice(line.valueStart ?? 0)],
        next: index + 1,
        count: prefix.count,
      };
    }

    const inline: { text: string; count: number } =
      applyInlineRulesToLine(line);
    return { lines: [inline.text], next: index + 1, count: inline.count };
  }
}

// The marker every masked value is replaced with.
export const RESOURCE_REDACTED_MARKER: string = GENERIC_REDACTED_MARKER;

export type ResourceOutputRedaction = GenericOutputRedaction;

/*
 * One tool's extra redaction pass. It receives the raw output (before the
 * generic rules run) and returns the text with its tool-specific material
 * masked and how many values it masked. Must be total and pure.
 */
export type ResourceOutputRedactionHook = (data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}) => ResourceOutputRedaction;

/*
 * `"Env": [ ... ]` as docker inspect (and docker service inspect) prints
 * it, pretty-printed or compact, possibly escaped inside another JSON
 * string. Every entry's VALUE is masked — an environment is where
 * containers keep their secrets, and a name that does not look like one
 * (APP_CONFIG, DATABASE) holds one as often as not. Names stay, so the model
 * still knows which variables are set.
 */
const DOCKER_ENV_LIST_REGEX: RegExp = /(\\?)"Env\1"\s*:\s*\[/g;

// A JSON string literal body (plain, or escaped one level).
function readJsonStringEnd(
  text: string,
  start: number,
  isEscaped: boolean,
): number {
  let index: number = start;

  while (index < text.length) {
    const ch: string = text.charAt(index);

    if (isEscaped) {
      if (text.startsWith('\\"', index)) {
        return index;
      }

      if (text.startsWith("\\\\", index)) {
        index += 2;
        continue;
      }
    } else {
      if (ch === '"') {
        return index;
      }

      if (ch === "\\") {
        index += 2;
        continue;
      }
    }

    index++;
  }

  return text.length;
}

function maskDockerEnvValues(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): ResourceOutputRedaction {
  const text: string = data.text;
  let out: string = "";
  let cursor: number = 0;
  let count: number = 0;

  DOCKER_ENV_LIST_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = DOCKER_ENV_LIST_REGEX.exec(text);

  while (match) {
    const isEscaped: boolean = match[1] === "\\";
    const quote: string = isEscaped ? '\\"' : '"';
    let index: number = match.index + match[0].length;

    out += text.slice(cursor, index);

    // Walk the list's string entries until its closing bracket (or the end).
    while (index < text.length) {
      const ch: string = text.charAt(index);

      if (ch === "]") {
        break;
      }

      if (!text.startsWith(quote, index)) {
        out += ch;
        index++;
        continue;
      }

      const bodyStart: number = index + quote.length;
      const bodyEnd: number = readJsonStringEnd(text, bodyStart, isEscaped);
      const entry: string = text.slice(bodyStart, bodyEnd);
      const equals: number = entry.indexOf("=");

      if (equals > 0 && equals < entry.length - 1) {
        out += `${quote}${entry.slice(0, equals + 1)}${RESOURCE_REDACTED_MARKER}`;
        count++;
      } else {
        out += `${quote}${entry}`;
      }

      if (bodyEnd >= text.length) {
        index = text.length;
        break;
      }

      out += quote;
      index = bodyEnd + quote.length;
    }

    cursor = index;
    DOCKER_ENV_LIST_REGEX.lastIndex = Math.max(index, match.index + 1);
    match = DOCKER_ENV_LIST_REGEX.exec(text);
  }

  out += text.slice(cursor);

  return { text: out, redactionCount: count };
}

/*
 * `docker service inspect --pretty` prints a service's environment on ONE
 * line, where the JSON hook above cannot see it:
 *   " Env:\t\tAPP_KEY=abc LOG_LEVEL=debug JAVA_OPTS=-Xmx1g -Dx=y "
 * A value may hold spaces, so the line cannot be split back into its
 * entries reliably. Every word shaped like NAME= keeps its NAME and has
 * the rest of it masked, and every other word (the tail of a value that
 * held a space) is dropped: over-masking accepted, never a value left.
 */
const DOCKER_PRETTY_ENV_LINE_REGEX: RegExp = /^([ \t]*Env:[ \t]+)(\S.*)$/gm;
const DOCKER_PRETTY_ENV_NAME_REGEX: RegExp = /^[A-Za-z_][A-Za-z0-9_.-]*=/;

function maskDockerPrettyEnvLines(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): ResourceOutputRedaction {
  let count: number = 0;

  const text: string = data.text.replace(
    DOCKER_PRETTY_ENV_LINE_REGEX,
    (_whole: string, prefix: string, entries: string): string => {
      const masked: Array<string> = [];

      for (const word of entries.split(/[ \t]+/)) {
        const name: RegExpExecArray | null =
          DOCKER_PRETTY_ENV_NAME_REGEX.exec(word);

        if (!name) {
          continue;
        }

        if (word.length > name[0].length) {
          count++;
          masked.push(`${name[0]}${RESOURCE_REDACTED_MARKER}`);
        } else {
          masked.push(word);
        }
      }

      return `${prefix}${masked.join(" ")}`;
    },
  );

  return { text, redactionCount: count };
}

/*
 * A Ceph keyring's secret: `key = AQD...==` (ceph auth get, keyring files),
 * `key: AQD...` (ceph auth ls) and `"key": "AQD..."` (-f json). The generic
 * rules deliberately leave a bare `key` alone (taints and tolerations have
 * one), but for ceph it is always a cephx secret.
 */
const CEPH_KEY_LINE_REGEX: RegExp = /^([ \t]*key[ \t]*[:=][ \t]*)(\S.*)$/gm;
const CEPH_KEY_JSON_REGEX: RegExp = /("key"\s*:\s*")((?:[^"\\]|\\.)*)(")/g;

function maskCephKeys(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): ResourceOutputRedaction {
  let count: number = 0;

  const text: string = data.text
    .replace(
      CEPH_KEY_LINE_REGEX,
      (whole: string, prefix: string, value: string): string => {
        if (value.trim() === RESOURCE_REDACTED_MARKER) {
          return whole;
        }

        count++;
        return `${prefix}${RESOURCE_REDACTED_MARKER}`;
      },
    )
    .replace(
      CEPH_KEY_JSON_REGEX,
      (
        whole: string,
        prefix: string,
        value: string,
        suffix: string,
      ): string => {
        if (!value || value === RESOURCE_REDACTED_MARKER) {
          return whole;
        }

        count++;
        return `${prefix}${RESOURCE_REDACTED_MARKER}${suffix}`;
      },
    );

  return { text, redactionCount: count };
}

/*
 * govc (VMware vCenter). A VM's extraConfig holds guestinfo.* keys —
 * cloud-init user data and metadata, vendor data, OVF environments — that
 * routinely carry passwords and SSH keys under names the generic rules
 * cannot recognise. The govc policy refuses every command that prints
 * extraConfig (vm.info -e and -json, object.collect of config); this is the
 * second line. The value of every option whose key is a guestinfo.* key (or
 * names user data, vendor data or an OVF environment, or looks
 * credential-like) is masked in each shape govc prints one: -json
 * OptionValue objects (key before or after value, any key case, the value a
 * string, a number or a {"_typeName", "_value"} object), the text listing
 * (`guestinfo.userdata:  ...`), a JSON map entry (`"guestinfo.x": "..."`)
 * and -dump's Go syntax (`Key: "...", Value: "..."`). A vSphere session id
 * or ticket in -json output (a login event's sessionId, a clone or console
 * ticket) authenticates as its user, and is masked too.
 */
const GOVC_JSON_STRING: string = '"(?:[^"\\\\]|\\\\.)*"';
const GOVC_JSON_NUMBER: string = "-?[0-9][0-9.eE+-]*";
const GOVC_JSON_SCALAR: string = `(?:${GOVC_JSON_STRING}|${GOVC_JSON_NUMBER})`;
const GOVC_TYPED_VALUE: string = `\\{\\s*(?:"_typeName"\\s*:\\s*"[^"]*"\\s*,\\s*)?"_value"\\s*:\\s*${GOVC_JSON_SCALAR}(?:\\s*,\\s*"_typeName"\\s*:\\s*"[^"]*")?\\s*\\}`;
const GOVC_OPTION_VALUE: string = `(?:${GOVC_JSON_SCALAR}|${GOVC_TYPED_VALUE})`;

const GOVC_OPTION_KEY_FIRST_REGEX: RegExp = new RegExp(
  `("key"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)("\\s*,\\s*"value"\\s*:\\s*)(${GOVC_OPTION_VALUE})`,
  "gi",
);
const GOVC_OPTION_VALUE_FIRST_REGEX: RegExp = new RegExp(
  `("value"\\s*:\\s*)(${GOVC_OPTION_VALUE})(\\s*,\\s*"key"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")`,
  "gi",
);
const GOVC_OPTION_DUMP_REGEX: RegExp =
  /(\bKey:\s*")((?:[^"\\]|\\.)*)("\s*,\s*Value:\s*)("(?:[^"\\]|\\.)*"|[^,\n}]*)/g;
const GOVC_GUESTINFO_LINE_REGEX: RegExp =
  /^([ \t]*guestinfo\.[^\s:=]*[ \t]*[:=][ \t]*)(\S.*)$/gim;
const GOVC_SECRET_JSON_PAIR_REGEX: RegExp =
  /("(?:sessionId|ticket|cloneTicket|guestinfo\.[^"\\\n]*)"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi;

// An option key whose value is (or may hold) credential material.
function isSensitiveGovcOptionKey(key: string): boolean {
  const folded: string = key.trim().toLowerCase();

  return (
    folded.startsWith("guestinfo.") ||
    folded.includes("userdata") ||
    folded.includes("vendordata") ||
    folded.includes("ovfenv") ||
    looksLikeCredentialName(folded)
  );
}

// A value this hook (or an earlier pass) has nothing left to mask in.
function isMaskedOrEmptyGovcValue(value: string): boolean {
  const body: string = value.trim();

  return (
    body === "" ||
    body === '""' ||
    body === RESOURCE_REDACTED_MARKER ||
    body === `"${RESOURCE_REDACTED_MARKER}"`
  );
}

function maskGovcSecrets(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): ResourceOutputRedaction {
  let count: number = 0;
  const maskedJson: string = `"${RESOURCE_REDACTED_MARKER}"`;

  const text: string = data.text
    .replace(
      GOVC_OPTION_KEY_FIRST_REGEX,
      (
        whole: string,
        keyPrefix: string,
        key: string,
        separator: string,
        value: string,
      ): string => {
        if (!isSensitiveGovcOptionKey(key) || isMaskedOrEmptyGovcValue(value)) {
          return whole;
        }

        count++;
        return `${keyPrefix}${key}${separator}${maskedJson}`;
      },
    )
    .replace(
      GOVC_OPTION_VALUE_FIRST_REGEX,
      (
        whole: string,
        valuePrefix: string,
        value: string,
        separator: string,
        key: string,
        closingQuote: string,
      ): string => {
        if (!isSensitiveGovcOptionKey(key) || isMaskedOrEmptyGovcValue(value)) {
          return whole;
        }

        count++;
        return `${valuePrefix}${maskedJson}${separator}${key}${closingQuote}`;
      },
    )
    .replace(
      GOVC_OPTION_DUMP_REGEX,
      (
        whole: string,
        keyPrefix: string,
        key: string,
        separator: string,
        value: string,
      ): string => {
        if (!isSensitiveGovcOptionKey(key) || isMaskedOrEmptyGovcValue(value)) {
          return whole;
        }

        count++;
        return `${keyPrefix}${key}${separator}${maskedJson}`;
      },
    )
    .replace(
      GOVC_GUESTINFO_LINE_REGEX,
      (whole: string, prefix: string, value: string): string => {
        if (isMaskedOrEmptyGovcValue(value)) {
          return whole;
        }

        count++;
        return `${prefix}${RESOURCE_REDACTED_MARKER}`;
      },
    )
    .replace(
      GOVC_SECRET_JSON_PAIR_REGEX,
      (
        whole: string,
        prefix: string,
        value: string,
        suffix: string,
      ): string => {
        if (isMaskedOrEmptyGovcValue(value)) {
          return whole;
        }

        count++;
        return `${prefix}${RESOURCE_REDACTED_MARKER}${suffix}`;
      },
    );

  return { text, redactionCount: count };
}

/*
 * The rest of a Ceph secret's footprint, after maskCephKeys:
 *  - a bare cephx secret wherever it appears (`ceph auth print-key` prints
 *    one alone; an audit entry or an escaped JSON string can hold one). A
 *    cephx secret is the base64 of a 28-byte key record whose type is 1, so
 *    it starts "AQ" and is 40 characters long with "==" padding; the
 *    pattern is looser than that on purpose;
 *  - the value of a `"val"` or `"value"` field, plain or escaped inside
 *    another JSON string: the audit channel (`ceph log last ... audit`)
 *    records every `config-key set` and `config set` a client ran, value
 *    included, and those values are where dashboard, RGW and cephadm
 *    credentials live.
 */
const CEPHX_SECRET_REGEX: RegExp =
  /(^|[^A-Za-z0-9+/])AQ[A-Za-z0-9+/]{30,}={0,2}/g;
const CEPH_VALUE_JSON_REGEX: RegExp =
  /("(?:val|value)"\s*:\s*")((?:[^"\\]|\\.)*)(")/g;
const CEPH_VALUE_ESCAPED_JSON_REGEX: RegExp =
  /(\\"(?:val|value)\\"\s*:\s*\\")((?:[^"\\]|\\\\\\["\\]|\\\\[^"\\])*)(\\")/g;

function maskCephSecretValues(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): ResourceOutputRedaction {
  let count: number = 0;

  const maskValue: (
    whole: string,
    prefix: string,
    value: string,
    suffix: string,
  ) => string = (
    whole: string,
    prefix: string,
    value: string,
    suffix: string,
  ): string => {
    if (!value || value === RESOURCE_REDACTED_MARKER) {
      return whole;
    }

    count++;
    return `${prefix}${RESOURCE_REDACTED_MARKER}${suffix}`;
  };

  const text: string = data.text
    .replace(CEPH_VALUE_JSON_REGEX, maskValue)
    .replace(CEPH_VALUE_ESCAPED_JSON_REGEX, maskValue)
    .replace(CEPHX_SECRET_REGEX, (_whole: string, before: string): string => {
      count++;
      return `${before}${RESOURCE_REDACTED_MARKER}`;
    });

  return { text, redactionCount: count };
}

/*
 * pvesh (Proxmox VE). A guest's config and pending changes carry
 * cloud-init's `cipassword`, and the cluster storage list can carry a
 * `password`, an RBD `keyring` or a PBS `encryption-key`. Masked in every
 * shape the agent prints the API's answer in: JSON pairs (plain, or escaped
 * inside another JSON string), `key: value` and `key value` lines, the rows
 * of pvesh's text tables (`│ cipassword │ ... │`), and /pending entries —
 * {"key": "cipassword", "value": ..., "pending": ...}, members in any order
 * — where the secret's NAME is itself a value, so the generic rules never
 * read it as a key. In the table and pending shapes any credential-looking
 * name (isCredentialKey) counts too; the generic rules cover it elsewhere.
 */
const PROXMOX_SECRET_KEYS: ReadonlyArray<string> = [
  "cipassword",
  "password",
  "keyring",
  "encryption-key",
];
const PROXMOX_SECRET_KEY_SOURCE: string = PROXMOX_SECRET_KEYS.join("|");
const PROXMOX_SECRET_JSON_REGEX: RegExp = new RegExp(
  `("(?:${PROXMOX_SECRET_KEY_SOURCE})"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")`,
  "gi",
);
const PROXMOX_SECRET_ESCAPED_JSON_REGEX: RegExp = new RegExp(
  `(\\\\"(?:${PROXMOX_SECRET_KEY_SOURCE})\\\\"\\s*:\\s*\\\\")((?:[^"\\\\]|\\\\[^"])*)(\\\\")`,
  "gi",
);
const PROXMOX_SECRET_LINE_REGEX: RegExp = new RegExp(
  `^([ \\t]*(?:-[ \\t]+)?(?:${PROXMOX_SECRET_KEY_SOURCE})(?:[ \\t]*[:=][ \\t]*|[ \\t]+))(\\S.*)$`,
  "gim",
);
const PROXMOX_FLAT_JSON_OBJECT_REGEX: RegExp = /\{[^{}]*\}/g;
const PROXMOX_PENDING_KEY_REGEX: RegExp = /"key"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const PROXMOX_PENDING_VALUE_REGEX: RegExp =
  /("(?:value|pending)"\s*:\s*)("(?:[^"\\]|\\.)*"|-?[0-9][0-9.eE+-]*)/g;
const PROXMOX_TABLE_ROW_REGEX: RegExp = /^([ \t]*)([│|])(.*)$/gm;
const PROXMOX_CELL_CONTENT_REGEX: RegExp = /\S(?:.*\S)?/;

function isProxmoxSecretName(name: string): boolean {
  const folded: string = name.trim().toLowerCase();

  return PROXMOX_SECRET_KEYS.includes(folded) || isCredentialKey(folded);
}

// A value an earlier pass already masked, or one with nothing in it.
function isMaskedOrEmptyProxmoxValue(value: string): boolean {
  const body: string = unquote(value.trim().replace(/,$/, "").trim());

  return body === "" || body.startsWith(REDACTED_PREFIX);
}

function maskProxmoxSecrets(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): ResourceOutputRedaction {
  let count: number = 0;

  const maskPair: (
    whole: string,
    prefix: string,
    value: string,
    suffix: string,
  ) => string = (
    whole: string,
    prefix: string,
    value: string,
    suffix: string,
  ): string => {
    if (isMaskedOrEmptyProxmoxValue(value)) {
      return whole;
    }

    count++;
    return `${prefix}${RESOURCE_REDACTED_MARKER}${suffix}`;
  };

  const text: string = data.text
    .replace(PROXMOX_SECRET_JSON_REGEX, maskPair)
    .replace(PROXMOX_SECRET_ESCAPED_JSON_REGEX, maskPair)
    .replace(PROXMOX_FLAT_JSON_OBJECT_REGEX, (entry: string): string => {
      const key: RegExpExecArray | null = PROXMOX_PENDING_KEY_REGEX.exec(entry);

      if (!key || !isProxmoxSecretName(key[1] || "")) {
        return entry;
      }

      return entry.replace(
        PROXMOX_PENDING_VALUE_REGEX,
        (whole: string, prefix: string, value: string): string => {
          if (isMaskedOrEmptyProxmoxValue(value)) {
            return whole;
          }

          count++;
          return `${prefix}"${RESOURCE_REDACTED_MARKER}"`;
        },
      );
    })
    .replace(
      PROXMOX_SECRET_LINE_REGEX,
      (whole: string, prefix: string, value: string): string => {
        if (isMaskedOrEmptyProxmoxValue(value)) {
          return whole;
        }

        count++;
        return `${prefix}${RESOURCE_REDACTED_MARKER}`;
      },
    )
    .replace(
      PROXMOX_TABLE_ROW_REGEX,
      (
        whole: string,
        indent: string,
        separator: string,
        rest: string,
      ): string => {
        const cells: Array<string> = rest.split(separator);

        if (cells.length < 2 || !isProxmoxSecretName(cells[0] || "")) {
          return whole;
        }

        const masked: Array<string> = cells.map(
          (cell: string, index: number): string => {
            if (index === 0 || isMaskedOrEmptyProxmoxValue(cell)) {
              return cell;
            }

            count++;
            return cell.replace(
              PROXMOX_CELL_CONTENT_REGEX,
              RESOURCE_REDACTED_MARKER,
            );
          },
        );

        return `${indent}${separator}${masked.join(separator)}`;
      },
    );

  return { text, redactionCount: count };
}

/*
 * Credentials on the command lines a process listing prints (ps, top -c):
 * the value after a credential-named flag (`--password=x`, `--token x`,
 * `-Dapp.db.password=x`), a credential-named assignment (`PASSWORD=x`,
 * `DB_TOKEN=x`) and the password half of `-u user:password` (curl, wget).
 * ps and top join a process's argv with single spaces and drop its quotes,
 * so a value is the run of characters up to the next whitespace. Names
 * are judged by the generic rules' own isCredentialKey, so both layers
 * agree on what a credential is called.
 */
const PROCESS_USER_PASSWORD_FLAGS: ReadonlyArray<string> = [
  "-u",
  "--user",
  "-U",
  "--proxy-user",
];

const PROCESS_NUMERIC_REGEX: RegExp = /^[0-9]+$/;

// One process line with its credential values masked, and how many.
function maskProcessLine(line: string): { text: string; count: number } {
  // Words at even indexes, the whitespace between them at odd ones.
  const parts: Array<string> = line.split(/(\s+)/);
  let count: number = 0;
  let maskNextWord: boolean = false;
  let userPasswordNext: boolean = false;

  for (let i: number = 0; i < parts.length; i += 2) {
    const word: string = parts[i] || "";

    if (!word) {
      continue;
    }

    if (maskNextWord) {
      maskNextWord = false;

      if (!word.startsWith("-") && !isExemptValue(word)) {
        parts[i] = RESOURCE_REDACTED_MARKER;
        count++;
        continue;
      }
    }

    if (userPasswordNext) {
      userPasswordNext = false;
      const colon: number = word.indexOf(":");
      const password: string = colon > 0 ? word.slice(colon + 1) : "";

      if (
        password &&
        !word.startsWith("-") &&
        !PROCESS_NUMERIC_REGEX.test(password) &&
        !isExemptValue(password)
      ) {
        parts[i] = `${word.slice(0, colon + 1)}${RESOURCE_REDACTED_MARKER}`;
        count++;
        continue;
      }
    }

    const equals: number = word.indexOf("=");

    if (equals > 0) {
      const value: string = word.slice(equals + 1);

      if (
        value &&
        !isExemptValue(value) &&
        isCredentialKey(word.slice(0, equals))
      ) {
        parts[i] = `${word.slice(0, equals + 1)}${RESOURCE_REDACTED_MARKER}`;
        count++;
      }
      continue;
    }

    if (!word.startsWith("-") || word.length < 2) {
      continue;
    }

    if (PROCESS_USER_PASSWORD_FLAGS.includes(word)) {
      userPasswordNext = true;
      continue;
    }

    if (isCredentialKey(word)) {
      maskNextWord = true;
    }
  }

  return { text: parts.join(""), count };
}

function maskProcessCredentialArguments(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): ResourceOutputRedaction {
  let count: number = 0;

  const lines: Array<string> = data.text
    .split("\n")
    .map((line: string): string => {
      const masked: { text: string; count: number } = maskProcessLine(line);
      count += masked.count;
      return masked.text;
    });

  return { text: lines.join("\n"), redactionCount: count };
}

/*
 * `ceph status` (and `ceph -s`) in its plain format calls its usage section
 * "data:" — pools, objects, usage and PG states — and the generic rules,
 * written for kubectl, read a "data:" block as a Kubernetes Secret's and
 * mask every line of it, which leaves the model blind to the one summary it
 * asks for first. For exactly that shape — a "  data:" header after the
 * "  cluster:" / "    id: FSID" / "  services:" headers, holding only
 * ceph's own usage lines and their continuation lines — the header is
 * renamed to a placeholder the generic rules read as an ordinary key while
 * they run, and written back afterwards. Every line under it still gets the
 * generic per-line rules. Any other shape (and output that already holds
 * the placeholder) is left to the generic rules whole: over-masking is
 * accepted, under-masking is not.
 */
const CEPH_STATUS_DATA_PLACEHOLDER: string = "ceph-status-usage-section";
const CEPH_STATUS_DATA_HEADER: string = "  data:";
const CEPH_STATUS_DATA_KEYS: ReadonlyArray<string> = [
  "volumes",
  "pools",
  "objects",
  "usage",
  "pgs",
];
const CEPH_STATUS_FSID_LINE_REGEX: RegExp =
  /^ {4}id: +[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CEPH_STATUS_DATA_ENTRY_REGEX: RegExp = /^ {4}([a-z]+):(?: |$)/;
const CEPH_STATUS_PLACEHOLDER_LINE_REGEX: RegExp = new RegExp(
  `^( {2})${CEPH_STATUS_DATA_PLACEHOLDER}:`,
);

export interface ShieldedOutput {
  // The output as the generic rules should read it.
  text: string;
  // The generic rules' answer with the shielded header written back.
  restore: (redacted: string) => string;
}

export function shieldCephStatusDataSection(
  text: string,
): ShieldedOutput | null {
  if (typeof text !== "string" || text.includes(CEPH_STATUS_DATA_PLACEHOLDER)) {
    return null;
  }

  const lines: Array<string> = text.split("\n");
  const bare: Array<string> = lines.map((line: string): string => {
    return line.replace(/\r$/, "");
  });
  const clusterIndex: number = bare.indexOf("  cluster:");

  if (
    clusterIndex < 0 ||
    !CEPH_STATUS_FSID_LINE_REGEX.test(bare[clusterIndex + 1] || "")
  ) {
    return null;
  }

  const servicesIndex: number = bare.indexOf("  services:", clusterIndex);
  const dataIndex: number =
    servicesIndex < 0
      ? -1
      : bare.indexOf(CEPH_STATUS_DATA_HEADER, servicesIndex);

  if (dataIndex < 0) {
    return null;
  }

  let entries: number = 0;

  for (let index: number = dataIndex + 1; index < bare.length; index++) {
    const line: string = bare[index] as string;

    if (line.trim() === "") {
      break;
    }

    const indent: number = line.length - line.trimStart().length;

    if (indent <= 2) {
      break;
    }

    if (indent === 4) {
      const entry: RegExpExecArray | null =
        CEPH_STATUS_DATA_ENTRY_REGEX.exec(line);

      if (!entry || !CEPH_STATUS_DATA_KEYS.includes(entry[1] || "")) {
        return null;
      }

      entries++;
      continue;
    }

    // Deeper: the continuation of the entry above ("  12 active+clean").
    if (indent > 4 && entries > 0) {
      continue;
    }

    return null;
  }

  if (entries === 0) {
    return null;
  }

  const shielded: Array<string> = lines.slice();
  shielded[dataIndex] = (lines[dataIndex] as string).replace(
    "data:",
    `${CEPH_STATUS_DATA_PLACEHOLDER}:`,
  );

  return {
    text: shielded.join("\n"),
    restore: (redacted: string): string => {
      return redacted
        .split("\n")
        .map((line: string): string => {
          return line.replace(CEPH_STATUS_PLACEHOLDER_LINE_REGEX, "$1data:");
        })
        .join("\n");
    },
  };
}

/*
 * Output a program prints that the generic rules misread, shielded while
 * they run (see shieldCephStatusDataSection); null for everything else.
 */
function shieldFromGenericRules(
  program: string,
  text: string,
): ShieldedOutput | null {
  try {
    return program === "ceph" ? shieldCephStatusDataSection(text) : null;
  } catch {
    return null;
  }
}

/*
 * The per-program hooks, run on the raw output before the generic rules.
 * Keyed by argv[0]; a program with no entry gets the generic rules only.
 * Each tool's kit extends its program's list (pvesh `cipassword`, govc
 * credentials, db query literals, ...).
 */
export const RESOURCE_OUTPUT_REDACTION_HOOKS: Readonly<
  Record<string, ReadonlyArray<ResourceOutputRedactionHook>>
> = {
  ps: [maskProcessCredentialArguments],
  top: [maskProcessCredentialArguments],
  docker: [maskDockerEnvValues, maskDockerPrettyEnvLines],
  ceph: [maskCephKeys, maskCephSecretValues],
  pvesh: [maskProxmoxSecrets],
  govc: [maskGovcSecrets],
  db: [redactDatabaseOutput],
};

// The hooks for one program; none for a program the table does not list.
export function getResourceOutputRedactionHooks(
  program: string,
): ReadonlyArray<ResourceOutputRedactionHook> {
  if (
    typeof program !== "string" ||
    !Object.prototype.hasOwnProperty.call(
      RESOURCE_OUTPUT_REDACTION_HOOKS,
      program,
    )
  ) {
    return [];
  }

  return RESOURCE_OUTPUT_REDACTION_HOOKS[program] || [];
}

/*
 * Redact one command's output: the program's hooks, then the generic rules.
 * Total: anything that is not text comes back as "", and a hook that throws
 * is skipped (the generic rules still run over what it was given).
 */
export function redactResourceCommandOutputWithCount(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): ResourceOutputRedaction {
  if (!data || typeof data.text !== "string" || !data.text) {
    return { text: "", redactionCount: 0 };
  }

  let text: string = data.text;
  let count: number = 0;

  for (const hook of getResourceOutputRedactionHooks(data.program)) {
    try {
      const hooked: ResourceOutputRedaction = hook({
        resourceType: data.resourceType,
        program: data.program,
        text,
      });

      if (hooked && typeof hooked.text === "string") {
        text = hooked.text;
        count +=
          typeof hooked.redactionCount === "number" ? hooked.redactionCount : 0;
      }
    } catch {
      // A broken hook must never leak the output unredacted by the generic rules.
    }
  }

  const shield: ShieldedOutput | null = shieldFromGenericRules(
    data.program,
    text,
  );
  const generic: ResourceOutputRedaction = GenericOutputRedactor.redact(
    shield ? shield.text : text,
  );

  return {
    text: shield ? shield.restore(generic.text) : generic.text,
    redactionCount: count + generic.redactionCount,
  };
}

export function redactResourceCommandOutput(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): string {
  return redactResourceCommandOutputWithCount(data).text;
}
