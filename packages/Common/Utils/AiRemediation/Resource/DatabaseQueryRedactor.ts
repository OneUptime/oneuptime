/*
 * Normalizes query text in the output of a `db` command, and masks the
 * credentials and row data only database output carries, before the output
 * leaves the Database AI agent, before the server stores it and before a
 * model reads it. Registered as the "db" hook in ResourceOutputRedactor, so
 * the generic rules still run after it.
 *
 * What a session is running is the most useful thing a database can tell
 * an investigation, and the least safe to pass on verbatim: the literals
 * in a statement are customers' data (emails, card numbers, tokens) and,
 * in an ALTER USER, a password. So, the way pg_stat_statements and
 * performance_schema digests already print statements:
 *   - every string literal becomes '?' — '...' with '' and backslash
 *     escapes, E'' / B'' / X'' / N'' and MySQL _charset'' prefixes, and
 *     PostgreSQL $$...$$ / $tag$...$tag$ bodies ($tag$?$tag$);
 *   - every number literal becomes ? — 42, 3.14, 1e9, 0x1F — but never a
 *     bind parameter ($1) or a digit inside a name (t1, "col2", `x3`);
 *   - a double-quoted word is a PostgreSQL identifier or a MySQL string,
 *     and this code cannot know which: it stays only where it can only be
 *     a name (next to a dot, or after FROM, JOIN, INTO, UPDATE, TABLE and
 *     the like) and becomes "?" everywhere else;
 *   - a quoted password after PASSWORD or IDENTIFIED BY / AS is masked
 *     wherever it appears, and so are the arguments of a Redis AUTH (and
 *     HELLO ... AUTH, MIGRATE ... AUTH / AUTH2), the value after
 *     requirepass / masterauth, an ACL SETUSER password, the value of a
 *     credential setting listed as name/value, the values of Redis commands
 *     that write data (SET, HSET, LPUSH, ... keep the command and the key)
 *     and the row bytes SHOW ENGINE INNODB STATUS dumps (hex ...; asc ...).
 *
 * Where query text is found:
 *   - a JSON string value under a query-like key (query, info, sql_text,
 *     digest_text, ...) or one whose text starts like a statement: decoded,
 *     normalized and re-encoded in place;
 *   - a JSON array that is a Redis command (["AUTH", "..."], ["SET", "k",
 *     "v"]): element by element;
 *   - in plain text, from a statement keyword at the start of a field (line
 *     start, after ": ", "= ", "| ", a tab or a column gap) to the end of the
 *     field (end of line, a tab or " | "), and lines that continue a
 *     statement (starting with WHERE, AND, FROM, VALUES, ...);
 *   - a single-quoted literal anywhere in plain text (an apostrophe inside
 *     a word, as in "don't", is not one).
 * The executor makes this exact by printing query text in a JSON string
 * field (or last on its line) and Redis command arguments as a JSON array.
 *
 * Over-masking is accepted; under-masking is not. Total: anything that is
 * not text becomes "", and if normalizing ever failed the whole output
 * would be withheld rather than passed on unnormalized.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only.
 */

import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";

// What a string or number literal becomes (inside its quotes for a string).
export const DATABASE_LITERAL_PLACEHOLDER: string = "?";

// What a credential becomes; the same marker the generic rules write.
export const DATABASE_REDACTED_MARKER: string = "[redacted]";

// The whole output, when it could not be normalized safely.
export const DATABASE_UNREDACTABLE_OUTPUT: string =
  "[redacted: the database output could not be normalized, so it is withheld]";

export interface DatabaseQueryRedaction {
  text: string;
  // How many literals, values or credentials were masked.
  redactionCount: number;
}

// Words that start a statement.
const STATEMENT_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "WITH",
  "MERGE",
  "UPSERT",
  "REPLACE",
  "CALL",
  "EXEC",
  "EXECUTE",
  "EXPLAIN",
  "SET",
  "SHOW",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "VALUES",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "DECLARE",
  "FETCH",
  "PREPARE",
  "DEALLOCATE",
  "DO",
  "LOCK",
  "VACUUM",
  "ANALYZE",
  "ANALYSE",
  "REINDEX",
  "REFRESH",
  "NOTIFY",
  "OPTIMIZE",
  "KILL",
  "FLUSH",
  "RENAME",
  "HANDLER",
  "LOAD",
]);

// Words a line (or a field) that continues a statement starts with.
const CONTINUATION_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "NATURAL",
  "OUTER",
  "ON",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "RETURNING",
  "VALUES",
  "SET",
  "WHEN",
  "THEN",
  "ELSE",
  "CASE",
  "INTO",
  "USING",
  "WINDOW",
  "FETCH",
  "FOR",
  "LATERAL",
]);

/*
 * Words after which a double-quoted word can only be a name. `AS` and `BY`
 * are left out on purpose: in IDENTIFIED WITH plugin AS "hash" and
 * IDENTIFIED BY "password" the word is a MySQL string.
 */
const IDENTIFIER_CONTEXT_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "FROM",
  "JOIN",
  "INTO",
  "UPDATE",
  "TABLE",
  "INDEX",
  "VIEW",
  "ON",
  "EXISTS",
  "ONLY",
  "SCHEMA",
  "SEQUENCE",
  "TRIGGER",
  "FUNCTION",
  "PROCEDURE",
  "TYPE",
  "COLUMN",
  "CONSTRAINT",
  "REFERENCES",
  "DATABASE",
  "EXTENSION",
]);

// JSON keys whose string value is statement text (compared lowercase).
const QUERY_KEYS: ReadonlySet<string> = new Set<string>([
  "query",
  "queries",
  "info",
  "sql",
  "sql_text",
  "sqltext",
  "digest_text",
  "query_text",
  "querytext",
  "query_sample_text",
  "sample_query",
  "example_query",
  "normalized_query",
  "statement",
  "stmt",
  "current_query",
  "last_query",
  "last_statement",
]);

/*
 * Redis commands whose arguments after the key are data: only the command
 * and the key stay.
 */
const REDIS_DATA_WRITE_COMMANDS: ReadonlySet<string> = new Set<string>([
  "set",
  "setex",
  "psetex",
  "setnx",
  "getset",
  "getex",
  "append",
  "setrange",
  "mset",
  "msetnx",
  "hset",
  "hmset",
  "hsetnx",
  "lpush",
  "rpush",
  "lpushx",
  "rpushx",
  "lset",
  "linsert",
  "lrem",
  "sadd",
  "srem",
  "sismember",
  "smismember",
  "zadd",
  "zrem",
  "zincrby",
  "xadd",
  "geoadd",
  "pfadd",
  "publish",
  "spublish",
  "eval",
  "evalsha",
  "eval_ro",
  "evalsha_ro",
  "fcall",
  "fcall_ro",
  "restore",
  "json.set",
  // Later commands that carry values (or members) after the key.
  "hsetex",
  "smove",
  "lpos",
  "zscore",
  "zmscore",
  "zrank",
  "zrevrank",
  "json.mset",
  "json.merge",
  "json.arrappend",
  "json.arrinsert",
  "json.arrindex",
  "json.strappend",
  "bf.add",
  "bf.madd",
  "bf.exists",
  "bf.mexists",
  "bf.insert",
  "cf.add",
  "cf.addnx",
  "cf.exists",
  "cf.insert",
]);

// A setting name whose value is a credential (Valkey names masterauth primaryauth).
const CREDENTIAL_SETTING_NAME_REGEX: RegExp =
  /pass|pwd|secret|token|credential|masterauth|primaryauth|auth$/i;

// The Redis / Valkey settings whose value is a password.
const REDIS_CREDENTIAL_SETTINGS: ReadonlySet<string> = new Set<string>([
  "requirepass",
  "masterauth",
  "primaryauth",
]);

// A CONFIG SET parameter whose value is (or may be) a credential; compared lowercase.
const REDIS_SECRET_PARAMETER_REGEX: RegExp =
  /pass|auth|secret|token|key|cred|user/;

// An ACL SETUSER rule that sets or removes a password (>pw, <pw) or its hash (#h, !h).
const ACL_PASSWORD_RULE_REGEX: RegExp = /^[<>#!]/;

const TRAILING_WHITESPACE_REGEX: RegExp = /\s*$/;

const ASCII_WORD_CHAR_REGEX: RegExp = /[A-Za-z0-9_$]/;
const ASCII_WORD_START_REGEX: RegExp = /[A-Za-z_]/;
const DIGIT_REGEX: RegExp = /[0-9]/;
const WHITESPACE_REGEX: RegExp = /\s/;
// A literal's prefix: E'', B'', X'', N'' and MySQL's _charset''.
const STRING_PREFIX_REGEX: RegExp =
  /(?:^|[^A-Za-z0-9_$])(?:[EeBbXxNn]|_[A-Za-z0-9]+)$/;
const DOLLAR_TAG_REGEX: RegExp = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
const NUMBER_REGEX: RegExp =
  /0[xX][0-9A-Fa-f]+|[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?/y;
const LETTERS_REGEX: RegExp = /[A-Za-z_]+/y;

// A letter of a name: ASCII word characters, and any non-ASCII character.
function isWordChar(ch: string): boolean {
  return (
    ch !== "" && (ch.charCodeAt(0) > 127 || ASCII_WORD_CHAR_REGEX.test(ch))
  );
}

function isWordStart(ch: string): boolean {
  return (
    ch !== "" && (ch.charCodeAt(0) > 127 || ASCII_WORD_START_REGEX.test(ch))
  );
}

function isDigit(ch: string): boolean {
  return ch !== "" && DIGIT_REGEX.test(ch);
}

function isWhitespace(ch: string): boolean {
  return ch !== "" && WHITESPACE_REGEX.test(ch);
}

// Already masked (by an earlier pass or an earlier run): kept, and not counted again.
function isPlaceholder(content: string): boolean {
  return (
    content === DATABASE_LITERAL_PLACEHOLDER ||
    content === DATABASE_REDACTED_MARKER
  );
}

/*
 * Where the single-quoted literal opening at `start` ends: the index after
 * its closing quote, or the end of the text when it never closes. A doubled
 * '' and a backslash both escape. When a closing quote is glued to a word
 * (`'a\' , 'secret'` read the MySQL way ends right before "secret"), the
 * backslash was a PostgreSQL literal one, so the literal runs on to the next
 * quote that ends a word — the longer reading, which masks both.
 */
function scanSingleQuoted(text: string, start: number): number {
  let index: number = start + 1;

  while (index < text.length) {
    const ch: string = text.charAt(index);

    if (ch === "\\" && index + 1 < text.length) {
      index += 2;
      continue;
    }

    if (ch === "'") {
      if (text.charAt(index + 1) === "'") {
        index += 2;
        continue;
      }

      if (isWordChar(text.charAt(index + 1))) {
        index++;
        continue;
      }

      return index + 1;
    }

    index++;
  }

  return text.length;
}

/*
 * Where a double-quoted (or backtick-quoted) word opening at `start` ends:
 * a doubled quote escapes, and so does a backslash inside double quotes.
 */
function scanQuoted(text: string, start: number, quote: string): number {
  let index: number = start + 1;

  while (index < text.length) {
    const ch: string = text.charAt(index);

    if (ch === "\\" && quote === '"' && index + 1 < text.length) {
      index += 2;
      continue;
    }

    if (ch === quote) {
      if (text.charAt(index + 1) === quote) {
        index += 2;
        continue;
      }

      return index + 1;
    }

    index++;
  }

  return text.length;
}

// Did the quoted run from `start` to `end` close with `quote`?
function isClosed(
  text: string,
  start: number,
  end: number,
  quote: string,
): boolean {
  return end - start >= 2 && text.charAt(end - 1) === quote;
}

// The last word already written (uppercased) and the last non-space character.
function lastWordOf(out: string): { word: string; lastChar: string } {
  let end: number = out.length;

  while (end > 0 && isWhitespace(out.charAt(end - 1))) {
    end--;
  }

  const lastChar: string = end > 0 ? out.charAt(end - 1) : "";
  let begin: number = end;

  while (begin > 0 && isWordChar(out.charAt(begin - 1))) {
    begin--;
  }

  return { word: out.slice(begin, end).toUpperCase(), lastChar };
}

// Can the double-quoted word ending at `end` only be a name?
function isIdentifierPosition(out: string, text: string, end: number): boolean {
  if (text.charAt(end) === ".") {
    return true;
  }

  const previous: { word: string; lastChar: string } = lastWordOf(out);

  return (
    previous.lastChar === "." || IDENTIFIER_CONTEXT_KEYWORDS.has(previous.word)
  );
}

interface LexResult {
  out: string;
  count: number;
  // Where the statement stopped in the text (its length when it ran to the end).
  end: number;
}

/*
 * Normalize the statement starting at `start`. With `stopAtColumn` (plain
 * text output) it stops at a tab or " | " outside quotes: the next column
 * of a table, not more of the statement.
 */
function lexStatement(
  text: string,
  start: number,
  stopAtColumn: boolean,
): LexResult {
  let out: string = "";
  let count: number = 0;
  let index: number = start;

  while (index < text.length) {
    const ch: string = text.charAt(index);

    if (
      stopAtColumn &&
      (ch === "\t" || (ch === " " && text.startsWith(" | ", index)))
    ) {
      break;
    }

    if (ch === "'") {
      const end: number = scanSingleQuoted(text, index);
      const closed: boolean = isClosed(text, index, end, "'");

      if (closed && isPlaceholder(text.slice(index + 1, end - 1))) {
        out += text.slice(index, end);
      } else {
        out += `'${DATABASE_LITERAL_PLACEHOLDER}'`;
        count++;
      }

      index = end;
      continue;
    }

    if (ch === '"') {
      const end: number = scanQuoted(text, index, '"');
      const closed: boolean = isClosed(text, index, end, '"');

      if (
        closed &&
        (isPlaceholder(text.slice(index + 1, end - 1)) ||
          isIdentifierPosition(out, text, end))
      ) {
        out += text.slice(index, end);
      } else {
        out += `"${DATABASE_LITERAL_PLACEHOLDER}"`;
        count++;
      }

      index = end;
      continue;
    }

    if (ch === "`") {
      const end: number = scanQuoted(text, index, "`");
      out += text.slice(index, end);
      index = end;
      continue;
    }

    if (ch === "$") {
      DOLLAR_TAG_REGEX.lastIndex = index;
      const tagMatch: RegExpExecArray | null = DOLLAR_TAG_REGEX.exec(text);

      if (tagMatch) {
        const tag: string = tagMatch[0];
        const close: number = text.indexOf(tag, index + tag.length);

        if (
          close >= 0 &&
          isPlaceholder(text.slice(index + tag.length, close))
        ) {
          out += text.slice(index, close + tag.length);
        } else {
          out += `${tag}${DATABASE_LITERAL_PLACEHOLDER}${close >= 0 ? tag : ""}`;
          count++;
        }

        index = close >= 0 ? close + tag.length : text.length;
        continue;
      }

      // $1: a bind parameter, kept whole.
      let end: number = index + 1;

      while (isDigit(text.charAt(end))) {
        end++;
      }

      out += text.slice(index, end);
      index = end;
      continue;
    }

    if (isWordStart(ch)) {
      let end: number = index + 1;

      while (end < text.length && isWordChar(text.charAt(end))) {
        end++;
      }

      out += text.slice(index, end);
      index = end;
      continue;
    }

    if (
      isDigit(ch) ||
      (ch === "." &&
        isDigit(text.charAt(index + 1)) &&
        !isWordChar(text.charAt(index - 1)))
    ) {
      NUMBER_REGEX.lastIndex = index;
      const number: RegExpExecArray | null = NUMBER_REGEX.exec(text);
      let end: number = number ? index + number[0].length : index + 1;

      if (isWordChar(text.charAt(end))) {
        // A name that starts with digits (MySQL allows 1col): kept whole.
        while (end < text.length && isWordChar(text.charAt(end))) {
          end++;
        }

        out += text.slice(index, end);
      } else {
        out += DATABASE_LITERAL_PLACEHOLDER;
        count++;
      }

      index = end;
      continue;
    }

    out += ch;
    index++;
  }

  return { out, count, end: index };
}

/*
 * Normalize one statement's text: string and number literals become ?, a
 * double-quoted word that could be a string becomes "?". Pure and total.
 */
export function normalizeSqlText(sql: string): DatabaseQueryRedaction {
  if (typeof sql !== "string" || !sql) {
    return { text: "", redactionCount: 0 };
  }

  const lexed: LexResult = lexStatement(sql, 0, false);

  return { text: lexed.out, redactionCount: lexed.count };
}

// normalizeSqlText, the text only: for an executor that normalizes a query column itself.
export function redactDatabaseQueryText(sql: string): string {
  return normalizeSqlText(sql).text;
}

// Skip whitespace, "(" and comments before the first word of a statement.
function statementStart(text: string): number {
  let index: number = 0;

  while (index < text.length) {
    const ch: string = text.charAt(index);

    if (isWhitespace(ch) || ch === "(") {
      index++;
      continue;
    }

    if (text.startsWith("/*", index)) {
      const close: number = text.indexOf("*/", index + 2);
      index = close >= 0 ? close + 2 : text.length;
      continue;
    }

    if (text.startsWith("--", index)) {
      const close: number = text.indexOf("\n", index);
      index = close >= 0 ? close + 1 : text.length;
      continue;
    }

    break;
  }

  return index;
}

// The keyword at `index`, uppercased, when a whole word stands there; "" otherwise.
function keywordAt(text: string, index: number): string {
  if (index > 0 && isWordChar(text.charAt(index - 1))) {
    return "";
  }

  LETTERS_REGEX.lastIndex = index;
  const match: RegExpExecArray | null = LETTERS_REGEX.exec(text);

  if (!match) {
    return "";
  }

  const after: string = text.charAt(index + match[0].length);

  // "SELECT", "SELECT(", "SELECT*", "BEGIN;" — never "selection" or "set_config".
  if (after !== "" && !isWhitespace(after) && !"(;*".includes(after)) {
    return "";
  }

  return match[0].toUpperCase();
}

// Does this text start (after whitespace, "(" and comments) like a statement?
export function looksLikeSqlStatement(text: string): boolean {
  if (typeof text !== "string" || !text) {
    return false;
  }

  return STATEMENT_KEYWORDS.has(keywordAt(text, statementStart(text)));
}

// Decode a JSON string body; null when it is not valid JSON.
function decodeJsonString(body: string): string | null {
  try {
    const decoded: unknown = JSON.parse(`"${body}"`);
    return typeof decoded === "string" ? decoded : null;
  } catch {
    return null;
  }
}

interface JsonStringScan {
  // After the closing quote when closed; else where the scan stopped (a line break or the end).
  end: number;
  closed: boolean;
}

/*
 * The JSON string opening at `start`: backslash escapes only, and never
 * past a line break (JSON strings hold none). When one does not close
 * before the line ends, no later quote on that line can close one either
 * (every quote after it is escaped, and a scan from an escaped quote pairs
 * the backslashes after it the same way), so callers skip to the next line:
 * the scans stay linear on hostile text.
 */
function scanJsonString(text: string, start: number): JsonStringScan {
  let index: number = start + 1;

  while (index < text.length) {
    const ch: string = text.charAt(index);

    if (ch === "\\") {
      if (index + 1 >= text.length || text.charAt(index + 1) === "\n") {
        return { end: index + 1, closed: false };
      }

      index += 2;
      continue;
    }

    if (ch === "\n") {
      return { end: index, closed: false };
    }

    if (ch === '"') {
      return { end: index + 1, closed: true };
    }

    index++;
  }

  return { end: text.length, closed: false };
}

/*
 * JSON string values that hold statement text: under a query-like key, or
 * starting like a statement. Decoded, normalized and re-encoded in place;
 * keys and every other string stay byte for byte.
 */
function maskJsonStatementStrings(text: string): DatabaseQueryRedaction {
  let out: string = "";
  let cursor: number = 0;
  let count: number = 0;
  let index: number = 0;
  // Where the last query-like key's colon ended, while its value may follow.
  let queryKeyEnd: number = -1;

  while (index < text.length) {
    const quote: number = text.indexOf('"', index);

    if (quote < 0) {
      break;
    }

    const scan: JsonStringScan = scanJsonString(text, quote);

    if (!scan.closed) {
      index = scan.end + 1;
      queryKeyEnd = -1;
      continue;
    }

    const body: string = text.slice(quote + 1, scan.end - 1);
    let after: number = scan.end;

    while (isWhitespace(text.charAt(after))) {
      after++;
    }

    if (text.charAt(after) === ":") {
      const key: string | null = decodeJsonString(body);
      queryKeyEnd =
        key !== null && QUERY_KEYS.has(key.toLowerCase()) ? after + 1 : -1;
      index = after + 1;
      continue;
    }

    const isQueryValue: boolean =
      queryKeyEnd >= 0 && !text.slice(queryKeyEnd, quote).trim();
    queryKeyEnd = -1;
    index = scan.end;

    const decoded: string | null = decodeJsonString(body);
    const value: string = decoded === null ? body : decoded;

    if (!isQueryValue && !looksLikeSqlStatement(value)) {
      continue;
    }

    const normalized: DatabaseQueryRedaction = normalizeSqlText(value);

    if (normalized.redactionCount === 0) {
      continue;
    }

    count += normalized.redactionCount;
    out += text.slice(cursor, quote);
    out +=
      decoded === null
        ? `"${normalized.text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : JSON.stringify(normalized.text);
    cursor = scan.end;
  }

  out += text.slice(cursor);

  return { text: out, redactionCount: count };
}

/*
 * A credential setting listed as a name/value object — {"name":
 * "requirepass", "value": "..."} or pg_settings' {"name": ..., "setting":
 * ...}: the property right after the name is masked, whatever it is called.
 */
const JSON_CREDENTIAL_SETTING_REGEX: RegExp =
  /("(?:name|variable_name|parameter|param|key|setting_name)"\s*:\s*"((?:[^"\\\n]|\\.)*)"\s*,\s*"[A-Za-z_]+"\s*:\s*")((?:[^"\\\n]|\\.)*)(")/gi;

function maskJsonCredentialSettings(text: string): DatabaseQueryRedaction {
  let count: number = 0;

  const masked: string = text.replace(
    JSON_CREDENTIAL_SETTING_REGEX,
    (
      whole: string,
      prefix: string,
      name: string,
      value: string,
      suffix: string,
    ): string => {
      if (
        !CREDENTIAL_SETTING_NAME_REGEX.test(name) ||
        !value ||
        isPlaceholder(value)
      ) {
        return whole;
      }

      count++;
      return `${prefix}${DATABASE_REDACTED_MARKER}${suffix}`;
    },
  );

  return { text: masked, redactionCount: count };
}

interface JsonArrayElement {
  // Where the element's body (inside its quotes) starts and ends.
  start: number;
  end: number;
  value: string;
}

// Which arguments of a Redis command (args[0] is the command) are secrets or data.
function redisMaskedIndexes(args: Array<string>): Array<number> {
  const lower: Array<string> = args.map((arg: string): string => {
    return arg.toLowerCase();
  });
  const command: string = lower[0] || "";
  const indexes: Array<number> = [];

  const maskFrom: (from: number) => void = (from: number): void => {
    for (let index: number = from; index < args.length; index++) {
      indexes.push(index);
    }
  };

  if (command === "auth") {
    maskFrom(1);
  } else if (command === "hello" || command === "migrate") {
    for (let index: number = 1; index < args.length; index++) {
      if (lower[index] === "auth") {
        indexes.push(index + 1);

        // HELLO protover AUTH username password
        if (command === "hello") {
          indexes.push(index + 2);
        }
      } else if (lower[index] === "auth2") {
        indexes.push(index + 1, index + 2);
      }
    }
  } else if (command === "config" && lower[1] === "set") {
    for (let index: number = 2; index + 1 < args.length; index += 2) {
      if (REDIS_SECRET_PARAMETER_REGEX.test(lower[index] || "")) {
        indexes.push(index + 1);
      }
    }
  } else if (command === "acl" && lower[1] === "setuser") {
    for (let index: number = 3; index < args.length; index++) {
      if (ACL_PASSWORD_RULE_REGEX.test(args[index] || "")) {
        indexes.push(index);
      }
    }
  } else if (REDIS_DATA_WRITE_COMMANDS.has(command)) {
    maskFrom(2);
  }

  // A credential setting followed by its value, wherever it sits (a CONFIG GET reply).
  for (let index: number = 0; index + 1 < args.length; index++) {
    if (REDIS_CREDENTIAL_SETTINGS.has(lower[index] || "")) {
      indexes.push(index + 1);
    }
  }

  return indexes.filter((index: number): boolean => {
    return index > 0 && index < args.length;
  });
}

/*
 * A Redis command's arguments (args[0] is the command) with its secret and
 * data arguments replaced by the redaction marker — the same arguments the
 * output hook masks in a JSON array. For an executor that prints a command
 * it read from the server (SLOWLOG GET): masked before anything can cut
 * the array short (an unclosed element is never masked) or encode it as a
 * JSON string inside a JSON document (where no array is seen at all).
 */
export function redactRedisCommandArguments(
  args: ReadonlyArray<unknown>,
): Array<string> {
  const words: Array<string> = (Array.isArray(args) ? args : []).map(
    (arg: unknown): string => {
      return typeof arg === "string" ? arg : String(arg ?? "");
    },
  );
  const masked: Array<number> = redisMaskedIndexes(words);

  return words.map((word: string, index: number): string => {
    return masked.includes(index) && !isPlaceholder(word)
      ? DATABASE_REDACTED_MARKER
      : word;
  });
}

const JSON_ARRAY_START_REGEX: RegExp = /\[\s*"/g;

/*
 * JSON arrays of strings that are a Redis command (SLOWLOG entries, a
 * CONFIG GET reply): secret and data arguments are masked in place.
 */
function maskRedisCommandArrays(text: string): DatabaseQueryRedaction {
  let out: string = "";
  let cursor: number = 0;
  let count: number = 0;

  JSON_ARRAY_START_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = JSON_ARRAY_START_REGEX.exec(text);

  while (match) {
    const elements: Array<JsonArrayElement> = [];
    let index: number = match.index + 1;

    while (index < text.length) {
      while (isWhitespace(text.charAt(index))) {
        index++;
      }

      if (text.charAt(index) !== '"') {
        break;
      }

      const scan: JsonStringScan = scanJsonString(text, index);

      if (!scan.closed) {
        // Nothing later on this line can close a string: go on from the next line.
        index = scan.end + 1;
        break;
      }

      const end: number = scan.end;
      const body: string = text.slice(index + 1, end - 1);
      const decoded: string | null = decodeJsonString(body);

      elements.push({
        start: index + 1,
        end: end - 1,
        value: decoded === null ? body : decoded,
      });
      index = end;

      while (isWhitespace(text.charAt(index))) {
        index++;
      }

      if (text.charAt(index) !== ",") {
        break;
      }

      index++;
    }

    const masked: Array<number> = redisMaskedIndexes(
      elements.map((element: JsonArrayElement): string => {
        return element.value;
      }),
    );

    for (let position: number = 0; position < elements.length; position++) {
      const element: JsonArrayElement = elements[position]!;

      if (
        element.start >= cursor &&
        masked.includes(position) &&
        !isPlaceholder(element.value)
      ) {
        out += text.slice(cursor, element.start) + DATABASE_REDACTED_MARKER;
        cursor = element.end;
        count++;
      }
    }

    JSON_ARRAY_START_REGEX.lastIndex = Math.max(index, match.index + 1);
    match = JSON_ARRAY_START_REGEX.exec(text);
  }

  out += text.slice(cursor);

  return { text: out, redactionCount: count };
}

// One argument in plain text: stops at whitespace, a quote or a closing bracket.
const TEXT_ARGUMENT: string = "(?:[^\\s\"'\\]\\\\]|\\\\.)+";

/*
 * PASSWORD 'x', ENCRYPTED PASSWORD "x", PASSWORD('x'), PASSWORD = 'x',
 * IDENTIFIED BY 'x', IDENTIFIED WITH plugin BY|AS 'x'. Quoted values only,
 * and only after a space, "=" or "(": "password authentication failed",
 * PASSWORD EXPIRE and a JSON key "password": ... read as they are (the
 * generic rules mask a credential key's value).
 */
const PASSWORD_PHRASE_REGEX: RegExp =
  /\b((?:IDENTIFIED\s+(?:WITH\s+[A-Za-z0-9_$]+\s+)?(?:BY|AS)(?:\s+PASSWORD)?)|(?:(?:UN)?ENCRYPTED\s+)?PASSWORD)(\s*=\s*\(?\s*|\s*\(\s*|\s+)('(?:[^'\\\n]|\\.|'')*'?|"(?:[^"\\\n]|\\.|"")*"?)/gi;

/*
 * AUTH [username] password where a Redis command starts (a line, a quoted
 * field, a list item, after ": ", "= " or "| "): the rest of the field is
 * masked. `cmd=auth` in CLIENT LIST names the command only and is left.
 */
const REDIS_AUTH_REGEX: RegExp =
  /(^|[[("'\t)]|[:=|] )([ \t]*)(auth)([ \t]+)((?:[^"\\\]\n]|\\.)+)/gim;

// HELLO protover AUTH username password (AUTH comes right after protover).
const REDIS_HELLO_AUTH_REGEX: RegExp = new RegExp(
  `(\\bhello[ \\t]+[^\\s\\]]+[ \\t]+auth[ \\t]+)(${TEXT_ARGUMENT})((?:[ \\t]+${TEXT_ARGUMENT})?)`,
  "gi",
);

/*
 * MIGRATE host port key|"" db timeout [COPY] [REPLACE] AUTH password |
 * AUTH2 username password: AUTH comes after five to seven words.
 */
const REDIS_MIGRATE_AUTH_REGEX: RegExp = new RegExp(
  `(\\bmigrate(?:[ \\t]+[^\\s\\]]+){5,7}?[ \\t]+)(auth2?)([ \\t]+)(${TEXT_ARGUMENT})((?:[ \\t]+${TEXT_ARGUMENT})?)`,
  "gi",
);

/*
 * requirepass / masterauth (primaryauth on Valkey) and the value after them, separated by spaces
 * (CONFIG SET text) or on the next line (a redis-cli CONFIG GET reply:
 * `1) "requirepass"` / `2) "value"`). JSON pairs and key: value lines are
 * the generic rules' and maskJsonCredentialSettings' to mask.
 */
const REDIS_CREDENTIAL_SETTING_REGEX: RegExp = new RegExp(
  `\\b(requirepass|masterauth|primaryauth)\\b((?:["']?[ \\t]*\\r?\\n[ \\t]*(?:\\d+\\)[ \\t]*)?|[ \\t]+)["']?)(${TEXT_ARGUMENT})`,
  "gi",
);

/*
 * SHOW ENGINE INNODB STATUS prints the bytes of the rows a deadlocked or
 * waiting transaction locked, one field per line: ` 0: len 4; hex
 * 80000007; asc     ;;`. They are table data (the asc rendering may hold
 * any character, ";" included), so everything after "hex " to the end of
 * the line is masked; the field's number and length stay.
 */
const INNODB_RECORD_DUMP_REGEX: RegExp = /\blen [0-9]+; hex /;

function maskInnodbRecordDumps(text: string): DatabaseQueryRedaction {
  let count: number = 0;

  if (!text.includes("; hex ")) {
    return { text, redactionCount: 0 };
  }

  const lines: Array<string> = text.split("\n").map((line: string): string => {
    const match: RegExpExecArray | null = INNODB_RECORD_DUMP_REGEX.exec(line);

    if (!match) {
      return line;
    }

    const start: number = match.index + match[0].length;
    const rest: string = line.slice(start);

    if (!rest || rest.startsWith(DATABASE_REDACTED_MARKER)) {
      return line;
    }

    count++;

    const asc: string = rest.includes("; asc ")
      ? `; asc ${DATABASE_REDACTED_MARKER}`
      : "";
    const end: string = rest.endsWith(";;")
      ? ";;"
      : rest.endsWith(";")
        ? ";"
        : "";

    return `${line.slice(0, start)}${DATABASE_REDACTED_MARKER}${asc}${end}`;
  });

  return { text: lines.join("\n"), redactionCount: count };
}

function isMaskedWord(value: string): boolean {
  const bare: string = value.replace(/^['"]|['"]$/g, "");

  return isPlaceholder(bare) || bare.startsWith("[redacted");
}

function maskSecretPhrases(text: string): DatabaseQueryRedaction {
  let count: number = 0;

  const maskWord: (word: string) => string = (word: string): string => {
    if (!word || isMaskedWord(word)) {
      return word;
    }

    count++;
    return DATABASE_REDACTED_MARKER;
  };

  // "  user  pass" -> "  [redacted]  [redacted]": each word masked, the spacing kept.
  const maskWords: (words: string) => string = (words: string): string => {
    return words.replace(/\S+/g, (word: string): string => {
      return maskWord(word);
    });
  };

  const masked: string = text
    .replace(
      PASSWORD_PHRASE_REGEX,
      (
        whole: string,
        phrase: string,
        separator: string,
        value: string,
      ): string => {
        const quote: string = value.charAt(0);
        let body: string = value.slice(1);

        if (body.endsWith(quote)) {
          body = body.slice(0, -1);
        }

        if (!body || isMaskedWord(body)) {
          return whole;
        }

        count++;
        return `${phrase}${separator}${quote}${DATABASE_REDACTED_MARKER}${quote}`;
      },
    )
    .replace(
      REDIS_AUTH_REGEX,
      (
        whole: string,
        lead: string,
        space: string,
        auth: string,
        gap: string,
        rest: string,
      ): string => {
        const trailingMatch: RegExpExecArray | null =
          TRAILING_WHITESPACE_REGEX.exec(rest);
        const trailing: string = trailingMatch ? trailingMatch[0] : "";
        const words: string = rest.slice(0, rest.length - trailing.length);

        if (!words || isMaskedWord(words)) {
          return whole;
        }

        count++;
        return `${lead}${space}${auth}${gap}${DATABASE_REDACTED_MARKER}${trailing}`;
      },
    )
    .replace(
      REDIS_HELLO_AUTH_REGEX,
      (_whole: string, lead: string, first: string, second: string): string => {
        return `${lead}${maskWord(first)}${maskWords(second || "")}`;
      },
    )
    .replace(
      REDIS_MIGRATE_AUTH_REGEX,
      (
        _whole: string,
        lead: string,
        auth: string,
        gap: string,
        first: string,
        second: string,
      ): string => {
        const rest: string =
          auth.toLowerCase() === "auth2"
            ? maskWords(second || "")
            : second || "";

        return `${lead}${auth}${gap}${maskWord(first)}${rest}`;
      },
    )
    .replace(
      REDIS_CREDENTIAL_SETTING_REGEX,
      (
        _whole: string,
        name: string,
        separator: string,
        value: string,
      ): string => {
        return `${name}${separator}${maskWord(value)}`;
      },
    );

  return { text: masked, redactionCount: count };
}

// Is the keyword at `index` at the start of a field of plain-text output?
function isFieldStart(line: string, index: number): boolean {
  let before: number = index - 1;
  let spaces: number = 0;
  let sawTab: boolean = false;

  while (
    before >= 0 &&
    (line.charAt(before) === " " || line.charAt(before) === "\t")
  ) {
    if (line.charAt(before) === "\t") {
      sawTab = true;
    }

    spaces++;
    before--;
  }

  if (before < 0 || sawTab || spaces >= 2) {
    return true;
  }

  return ":=|(>;,".includes(line.charAt(before));
}

// Could the single quote at `index` open a literal (not an apostrophe inside a word)?
function isLiteralOpening(line: string, index: number): boolean {
  const previous: string = line.charAt(index - 1);

  if (!isWordChar(previous)) {
    return true;
  }

  return STRING_PREFIX_REGEX.test(line.slice(Math.max(0, index - 40), index));
}

// One line of plain-text output: statements normalized, single-quoted literals masked.
function maskTextLine(line: string): DatabaseQueryRedaction {
  let out: string = "";
  let count: number = 0;
  let index: number = 0;
  // Right after a statement a column stop cut short: its next clause continues it.
  let afterStatement: boolean = false;
  // Once a double quote does not close, no later one on the line can (see scanJsonString).
  let quotesArePlain: boolean = false;
  const firstWord: number = line.search(/\S/);

  while (index < line.length) {
    const ch: string = line.charAt(index);

    if (ch === '"' && !quotesArePlain) {
      const scan: JsonStringScan = scanJsonString(line, index);

      // A JSON string (normalized already when it held a statement) or a name.
      if (scan.closed) {
        out += line.slice(index, scan.end);
        index = scan.end;
        afterStatement = false;
        continue;
      }

      quotesArePlain = true;
    }

    if (ch === "'" && isLiteralOpening(line, index)) {
      const end: number = scanSingleQuoted(line, index);
      const closed: boolean = isClosed(line, index, end, "'");

      if (closed && isPlaceholder(line.slice(index + 1, end - 1))) {
        out += line.slice(index, end);
      } else {
        out += `'${DATABASE_LITERAL_PLACEHOLDER}'`;
        count++;
      }

      index = end;
      continue;
    }

    if (isWordStart(ch) && !isWordChar(line.charAt(index - 1))) {
      const keyword: string = keywordAt(line, index);
      const startsStatement: boolean =
        (STATEMENT_KEYWORDS.has(keyword) && isFieldStart(line, index)) ||
        (CONTINUATION_KEYWORDS.has(keyword) &&
          (index === firstWord ||
            (afterStatement && isFieldStart(line, index))));

      if (startsStatement) {
        const lexed: LexResult = lexStatement(line, index, true);
        out += lexed.out;
        count += lexed.count;
        index = Math.max(lexed.end, index + 1);
        afterStatement = true;
        continue;
      }

      let end: number = index + 1;

      while (end < line.length && isWordChar(line.charAt(end))) {
        end++;
      }

      out += line.slice(index, end);
      index = end;
      afterStatement = false;
      continue;
    }

    out += ch;
    index++;
  }

  return { text: out, redactionCount: count };
}

function maskTextLines(text: string): DatabaseQueryRedaction {
  let count: number = 0;

  const lines: Array<string> = text.split("\n").map((line: string): string => {
    const masked: DatabaseQueryRedaction = maskTextLine(line);
    count += masked.redactionCount;
    return masked.text;
  });

  return { text: lines.join("\n"), redactionCount: count };
}

// The passes, in order: credentials first, then JSON, then plain text.
const REDACTION_PASSES: ReadonlyArray<
  (text: string) => DatabaseQueryRedaction
> = [
  maskSecretPhrases,
  maskInnodbRecordDumps,
  maskJsonCredentialSettings,
  maskRedisCommandArrays,
  maskJsonStatementStrings,
  maskTextLines,
];

/*
 * Normalize every statement in a `db` command's output and mask the
 * credentials and row data database output carries. The "db" hook of
 * ResourceOutputRedactor (a ResourceOutputRedactionHook); the generic rules
 * run after it.
 */
export function redactDatabaseOutput(data: {
  resourceType: AiResourceType;
  program: string;
  text: string;
}): DatabaseQueryRedaction {
  if (!data || typeof data.text !== "string" || !data.text) {
    return { text: "", redactionCount: 0 };
  }

  try {
    let text: string = data.text;
    let count: number = 0;

    for (const pass of REDACTION_PASSES) {
      const result: DatabaseQueryRedaction = pass(text);
      text = result.text;
      count += result.redactionCount;
    }

    return { text, redactionCount: count };
  } catch {
    // Never pass on output that could not be normalized.
    return { text: DATABASE_UNREDACTABLE_OUTPUT, redactionCount: 1 };
  }
}
