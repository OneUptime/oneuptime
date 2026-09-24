/*
 * Redacts credential-looking material from kubectl output before it reaches
 * a language model or is stored next to an AI run.
 *
 * Pure and dependency-free on purpose, like KubectlPolicy: the same code can
 * run on the server (KubectlJobRunner, the one output path investigations
 * and remediation share) and, if ever needed, inside the Runner before the
 * bytes leave the cluster.
 *
 * What it understands — all deterministic and line-oriented, so output the
 * Runner truncated is handled exactly like complete output:
 *  1. The `data:` / `stringData:` / `binaryData:` blocks of Kubernetes
 *     objects, in YAML or pretty-printed JSON, single objects or Lists. For
 *     a Secret — or whenever the object's kind cannot be determined — every
 *     value in the block is masked (keys stay, so the model still knows
 *     which keys exist). For any other kind (a ConfigMap) only the values
 *     whose key looks credential-like are masked, so configuration stays
 *     readable. `kubectl describe configmap` prints the same data as
 *     "KEY:", a "----" rule and the value on the lines below; a
 *     credential-like key loses that whole value.
 *  2. Container env entries (`- name: X` / `value: Y`, YAML or JSON) whose
 *     name looks credential-like: the value is masked; a valueFrom
 *     reference is kept because it holds no material.
 *  3. Any `key: value` or `key=value` whose key looks credential-like,
 *     wherever it appears: describe output, kubeconfig-like text, container
 *     logs, command-line flags, one-line JSON (`{"password":"…"}`, as
 *     jsonpath and structured logs print it). A masked block scalar
 *     (`tls.key: |`) drops its whole block.
 *  4. A credential flag whose value is the NEXT argv element rather than
 *     `=`-joined: `- --db-password` / `- value` in YAML, the same pair in a
 *     JSON array or describe's Args block, and `--requirepass value` inside
 *     one line. A tool's short password flag (`mysql -pX`, `redis-cli -a X`)
 *     only where the command names that tool.
 *  5. The `kubectl.kubernetes.io/last-applied-configuration` annotation —
 *     the entire applied object, Secret data included, as one JSON string —
 *     is replaced wholesale.
 *  6. Inline material regardless of structure: `scheme://user:password@`,
 *     `Bearer …` / `Basic …` tokens, JWTs, PEM private keys, one-line JSON
 *     `"data":{…}` objects and `"name":"…","value":"…"` env pairs, and
 *     base64 runs that are padded or long.
 *
 * Over-masking is accepted; under-masking is not. When the structure is
 * ambiguous (no kind in sight, unexpected nesting inside a data block) the
 * value is masked.
 */

export interface KubectlOutputRedaction {
  text: string;
  // How many values, blocks or tokens were masked.
  redactionCount: number;
}

export const KUBECTL_REDACTED_MARKER: string = "[redacted]";

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
    return `"${keptPrefix}${KUBECTL_REDACTED_MARKER}"${trailingComma}`;
  }
  if (body.startsWith("'")) {
    return `'${keptPrefix}${KUBECTL_REDACTED_MARKER}'${trailingComma}`;
  }
  return `${keptPrefix}${KUBECTL_REDACTED_MARKER}${trailingComma}`;
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
  return `${KUBECTL_REDACTED_MARKER}${value.endsWith("\\") ? "\\" : ""}`;
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
      text: " ".repeat(line.indent) + KUBECTL_REDACTED_MARKER,
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
      return `${scheme} ${KUBECTL_REDACTED_MARKER}`;
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
      return `${prefix}${KUBECTL_REDACTED_MARKER}${closingQuote}`;
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
      return `${prefix}${KUBECTL_REDACTED_MARKER}${suffix}`;
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
        return `${prefix}${openingQuote}${KUBECTL_REDACTED_MARKER}${closingQuote ?? ""}`;
      }

      if (bare === undefined) {
        return match;
      }
      count++;
      return `${prefix}${rule.quote}${KUBECTL_REDACTED_MARKER}${rule.quote}`;
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
      return `${prefix}${KUBECTL_REDACTED_MARKER}${closingQuote}`;
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

    const replacement: string = `${quote}${KUBECTL_REDACTED_MARKER}${quote}:${quote}${KUBECTL_REDACTED_MARKER}${quote}`;
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
      return `://${user}:${KUBECTL_REDACTED_MARKER}@`;
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
      return `${boundary}${key}${separator}${KUBECTL_REDACTED_MARKER}${value.endsWith("\\") ? "\\" : ""}`;
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

export default class KubectlOutputRedactor {
  public static redact(output: string): KubectlOutputRedaction {
    if (!output) {
      return { text: "", redactionCount: 0 };
    }

    const parsed: Array<ParsedLine> = output
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(parseLine);

    const masks: LineMasks = {
      envValueLines: KubectlOutputRedactor.findCredentialEnvValueLines(parsed),
      argvValueLines: KubectlOutputRedactor.findArgvValueLines(parsed),
    };

    const out: Array<string> = [];
    let count: number = 0;
    let index: number = 0;

    while (index < parsed.length) {
      const line: ParsedLine = parsed[index]!;

      let step: RedactedLines;
      if (
        KubectlOutputRedactor.isDescribeDataEntry(parsed, index) &&
        isCredentialKey(line.key ?? "")
      ) {
        step = KubectlOutputRedactor.redactDescribeDataEntry(parsed, index);
      } else if (
        !line.isBlank &&
        line.key !== undefined &&
        DATA_BLOCK_KEYS.has(line.key) &&
        isContainerStart(line.value)
      ) {
        step = KubectlOutputRedactor.redactDataBlock(parsed, index, masks);
      } else {
        step = KubectlOutputRedactor.redactStandaloneLine(parsed, index, masks);
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
        KubectlOutputRedactor.findSiblingValueLine(parsed, index);
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

    if (KubectlOutputRedactor.isDescribeDataEntry(parsed, index)) {
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
      !KubectlOutputRedactor.isDescribeDataValueEnd(parsed, end, header.indent)
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
          return line.isBlank || line.raw.trim() === KUBECTL_REDACTED_MARKER;
        },
      );

      if (isAlreadyMasked) {
        lines.push(
          ...valueLines.map((line: ParsedLine): string => {
            return line.raw;
          }),
        );
      } else {
        lines.push(" ".repeat(header.indent) + KUBECTL_REDACTED_MARKER);
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
    const kind: string | undefined = KubectlOutputRedactor.findSiblingKind(
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
          KubectlOutputRedactor.redactStandaloneLine(parsed, index, masks);
        lines.push(...nested.lines);
        count += nested.count;
        index = nested.next;
        continue;
      }

      if (line.key === undefined) {
        // Not "key: value" — an unexpected shape inside a data block.
        if (maskEveryValue) {
          lines.push(" ".repeat(line.indent) + KUBECTL_REDACTED_MARKER);
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
