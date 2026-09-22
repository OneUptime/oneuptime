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
 *     readable.
 *  2. Container env entries (`- name: X` / `value: Y`, YAML or JSON) whose
 *     name looks credential-like: the value is masked; a valueFrom
 *     reference is kept because it holds no material.
 *  3. Any `key: value` or `key=value` whose key looks credential-like,
 *     wherever it appears: describe output, kubeconfig-like text, container
 *     logs, command-line flags. A masked block scalar (`tls.key: |`) drops
 *     its whole block.
 *  4. The `kubectl.kubernetes.io/last-applied-configuration` annotation —
 *     the entire applied object, Secret data included, as one JSON string —
 *     is replaced wholesale.
 *  5. Inline material regardless of structure: `scheme://user:password@`,
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
 */
const CREDENTIAL_NAME_REGEX: RegExp =
  /passw(?:or)?d|passwd|pwd|secret|token|credential|auth|cert|bearer|cookie|passphrase|dockerconfig|dockercfg|webhook|(?:api|access|private|encryption|signing|client|ssh|master|license|service|account|session|app|consumer|shared)[-_.]?key|(?:^|[-_./])key[-_.]|[-_./]key$|(?:^|[-_./])(?:dsn|salt|otp)(?:[-_.]|$)|\.(?:crt|cer|pem|p12|pfx|jks)$/i;

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

const LIST_ITEM_PREFIX_REGEX: RegExp = /^-(?:[ \t]+|$)/;

const LEADING_WHITESPACE_REGEX: RegExp = /^[ \t]*/;

// scheme://user:password@host — the password only; an empty user still counts.
const URL_CREDENTIAL_REGEX: RegExp =
  /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/:@"']*):([^\s/@"']+)@/gi;

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
function buildJsonEnvPairRegexes(isEscaped: boolean): {
  nameFirst: RegExp;
  valueFirst: RegExp;
} {
  const body: string = isEscaped
    ? '(?:[^"\\\\]|\\\\[^"])*'
    : '(?:[^"\\\\]|\\\\.)*';
  const q: string = isEscaped ? '\\\\"' : '"';

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
 * `key=value` / `key: value` / `key:value` anywhere in a line — logs, args,
 * Go-formatted maps (`map[password:cGFz…]`). The key is judged by
 * isCredentialKey, so this never touches "timeout=1s" or "op=Exists".
 */
const INLINE_PAIR_REGEX: RegExp =
  /(^|[\s[,{("'])([A-Za-z0-9_./-]+)([ \t]*[:=][ \t]*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s,;&\]})"']+)/g;

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

function isExemptValue(value: string): boolean {
  let body: string = value.trim();
  if (body.endsWith(",")) {
    body = body.slice(0, -1).trimEnd();
  }
  return EXEMPT_VALUES.has(body) || body.startsWith(EXEMPT_VALUE_PREFIX);
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

function maskScalar(value: string): string {
  const trailingComma: string = value.trimEnd().endsWith(",") ? "," : "";
  const body: string = trailingComma
    ? value.trimEnd().slice(0, -1).trimEnd()
    : value.trim();

  if (body.startsWith('"')) {
    return `"${KUBECTL_REDACTED_MARKER}"${trailingComma}`;
  }
  if (body.startsWith("'")) {
    return `'${KUBECTL_REDACTED_MARKER}'${trailingComma}`;
  }
  return `${KUBECTL_REDACTED_MARKER}${trailingComma}`;
}

function maskValueInPlace(line: ParsedLine): string {
  if (line.valueStart === undefined || line.value === undefined) {
    return " ".repeat(line.indent) + KUBECTL_REDACTED_MARKER;
  }
  return line.raw.slice(0, line.valueStart) + maskScalar(line.value);
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
 * value is masked when the name looks credential-like.
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
      _value: string,
      closingQuote: string,
    ): string => {
      if (!looksLikeCredentialName(name)) {
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
      _value: string,
      suffix: string,
      name: string,
    ): string => {
      if (!looksLikeCredentialName(name)) {
        return match;
      }
      count++;
      return `${prefix}${KUBECTL_REDACTED_MARKER}${suffix}`;
    },
  );

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

  result = result.replace(
    URL_CREDENTIAL_REGEX,
    (_match: string, scheme: string, user: string): string => {
      count++;
      return `${scheme}${user}:${KUBECTL_REDACTED_MARKER}@`;
    },
  );

  for (const tokenRegex of [BEARER_TOKEN_REGEX, BASIC_TOKEN_REGEX]) {
    const masked: { text: string; count: number } = maskAuthorizationTokens(
      result,
      tokenRegex,
    );
    result = masked.text;
    count += masked.count;
  }

  result = result.replace(JWT_REGEX, (): string => {
    count++;
    return "[redacted-jwt]";
  });

  const dataObjects: { text: string; count: number } =
    maskInlineJsonDataObjects(result);
  result = dataObjects.text;
  count += dataObjects.count;

  for (const pair of JSON_ENV_PAIR_REGEXES) {
    const masked: { text: string; count: number } = maskJsonEnvPairs(
      result,
      pair,
    );
    result = masked.text;
    count += masked.count;
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
        isExemptValue(value) ||
        value.startsWith("[redacted")
      ) {
        return match;
      }
      count++;
      return `${boundary}${key}${separator}${KUBECTL_REDACTED_MARKER}`;
    },
  );

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
 * `key: value` only has its value examined: its key was judged by
 * isCredentialKey (and possibly exempted), and re-reading "Image pull
 * secrets:" as the pair "secrets: <none>" must not undo that.
 */
function applyInlineRulesToLine(line: ParsedLine): {
  text: string;
  count: number;
} {
  if (line.valueStart === undefined || line.value === undefined) {
    return applyInlineRules(line.raw);
  }

  const inline: { text: string; count: number } = applyInlineRules(
    line.raw.slice(line.valueStart),
  );

  return {
    text: line.raw.slice(0, line.valueStart) + inline.text,
    count: inline.count,
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

    const envValueLines: Set<number> =
      KubectlOutputRedactor.findCredentialEnvValueLines(parsed);

    const out: Array<string> = [];
    let count: number = 0;
    let index: number = 0;

    while (index < parsed.length) {
      const line: ParsedLine = parsed[index]!;

      const step: RedactedLines =
        !line.isBlank &&
        line.key !== undefined &&
        DATA_BLOCK_KEYS.has(line.key) &&
        isContainerStart(line.value)
          ? KubectlOutputRedactor.redactDataBlock(parsed, index, envValueLines)
          : KubectlOutputRedactor.redactStandaloneLine(
              parsed,
              index,
              envValueLines,
            );

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
   * A `data:` / `stringData:` / `binaryData:` block. Every value is masked
   * for a Secret or an object of unknown kind; only credential-like keys
   * are masked for anything else. Keys are kept either way.
   */
  private static redactDataBlock(
    parsed: Array<ParsedLine>,
    blockIndex: number,
    envValueLines: Set<number>,
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
          KubectlOutputRedactor.redactStandaloneLine(
            parsed,
            index,
            envValueLines,
          );
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
          lines.push(maskValueInPlace(line));
          count++;
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

  // One line outside a data block: env value, credential-like key, inline rules.
  private static redactStandaloneLine(
    parsed: Array<ParsedLine>,
    index: number,
    envValueLines: Set<number>,
  ): RedactedLines {
    const line: ParsedLine = parsed[index]!;

    if (line.isBlank) {
      return { lines: [line.raw], next: index + 1, count: 0 };
    }

    if (envValueLines.has(index) && line.value !== undefined) {
      if (isBlockScalar(line.value)) {
        return {
          lines: [maskValueInPlace(line)],
          next: skipDeeperLines(parsed, index + 1, line.contentIndent),
          count: 1,
        };
      }
      if (!isExemptValue(line.value)) {
        return { lines: [maskValueInPlace(line)], next: index + 1, count: 1 };
      }
    }

    if (
      line.key !== undefined &&
      line.value !== undefined &&
      (line.key === LAST_APPLIED_CONFIGURATION_ANNOTATION ||
        isCredentialKey(line.key))
    ) {
      if (isBlockScalar(line.value)) {
        return {
          lines: [maskValueInPlace(line)],
          next: skipDeeperLines(parsed, index + 1, line.contentIndent),
          count: 1,
        };
      }
      if (!isExemptValue(line.value)) {
        return { lines: [maskValueInPlace(line)], next: index + 1, count: 1 };
      }
      /*
       * A credential-like key with nothing to hide on this line: its
       * children are judged on their own, and describe's "<set to the key
       * …>" reference must not be chewed up by the inline pair rule.
       */
      return { lines: [line.raw], next: index + 1, count: 0 };
    }

    const inline: { text: string; count: number } =
      applyInlineRulesToLine(line);
    return { lines: [inline.text], next: index + 1, count: inline.count };
  }
}
