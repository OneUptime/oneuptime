import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * Read-only guard + time-macro interpolation for SQL sent to external Data
 * Sources (PostgreSQL, MySQL, SQL Server, ClickHouse).
 *
 * Defense in depth: this classifier is the FIRST layer, applied identically
 * to every engine; connectors add server-enforced layers where the engine
 * supports them (pg `default_transaction_read_only=on`, MySQL
 * `SET SESSION TRANSACTION READ ONLY` + single-statement driver mode,
 * ClickHouse `readonly=1`). SQL Server has no session read-only mode, so
 * this classifier — plus the recommendation to connect with a read-only
 * login — is its enforcement, and the classifier is written to be sound
 * for T-SQL specifically:
 *
 *  - `#` is NOT treated as a comment. It is one in MySQL, but in T-SQL
 *    `#name` is a temp table — blanking from `#` to end-of-line would hide
 *    a smuggled `; DROP ...` from the classifier while SQL Server executed
 *    it. MySQL users must write `--` comments instead (false-rejection is
 *    the safe failure mode).
 *  - Backslash-quote (`\'`) is REJECTED outright rather than parsed:
 *    MySQL/ClickHouse treat it as an escaped quote, PostgreSQL (standard
 *    conforming strings) as a literal backslash ending the string — two
 *    engines, two parse trees, and whichever one the classifier picked
 *    would be exploitable on the other. Users write `''` instead, which
 *    every engine accepts.
 *
 * The classifier works on a STRIPPED copy of the query: contents of string
 * literals, quoted identifiers and comments are blanked first, so
 * `SELECT 'DROP TABLE x'` passes while comment-smuggling cannot. A column
 * literally named `delete` must be quoted — an accepted false-positive
 * cost. Divergences that remain (e.g. MySQL not nesting block comments)
 * are contained by that engine's server-enforced layer.
 */

const ALLOWED_HEAD_KEYWORDS: Array<string> = [
  "SELECT",
  "WITH",
  "SHOW",
  "EXPLAIN",
  "DESCRIBE",
  "DESC",
];

/*
 * Any of these appearing ANYWHERE (outside strings/comments/quoted
 * identifiers) rejects the query. Notes:
 *  - INTO catches `SELECT ... INTO table` (pg/mssql) and MySQL's
 *    `SELECT ... INTO OUTFILE`.
 *  - WITH ... DELETE/INSERT data-modifying CTEs are caught by the DML
 *    words themselves, which is why the head check alone is not enough.
 *  - SET catches session tampering (`SET GLOBAL`, `SET ROLE`).
 *  - ANALYZE is intentionally allowed so `EXPLAIN ANALYZE SELECT ...`
 *    works; under a read-only transaction it cannot write.
 *  - SYSTEM is intentionally NOT listed: `system.*` tables are the most
 *    common ClickHouse introspection target and the head check already
 *    stops `SYSTEM ...` commands.
 */
const FORBIDDEN_KEYWORDS: Array<string> = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "UPSERT",
  "REPLACE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "RENAME",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "CALL",
  "DO",
  "COPY",
  "INTO",
  "SET",
  "LOCK",
  "UNLOCK",
  "PREPARE",
  "DEALLOCATE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "VACUUM",
  "REINDEX",
  "CLUSTER",
  "CHECKPOINT",
  "LISTEN",
  "NOTIFY",
  "REFRESH",
  "LOAD",
  "HANDLER",
  "OUTFILE",
  "DUMPFILE",
  "SHUTDOWN",
  "KILL",
  "USE",
  "ATTACH",
  "DETACH",
  "OPTIMIZE",
  // T-SQL specifics (SQL Server batches don't even need semicolons).
  "BACKUP",
  "RESTORE",
  "DBCC",
  "RECONFIGURE",
  "WAITFOR",
  "OPENQUERY",
  "OPENROWSET",
  "OPENDATASOURCE",
  "OPENXML",
];

/*
 * SQL Server system / extended stored procedures (sp_configure,
 * xp_cmdshell, ...) — callable without EXEC in some positions, so they get
 * their own pattern instead of a keyword entry.
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\b(?:xp_|sp_)\w+/i,
    description: "system stored procedures (sp_*/xp_*)",
  },
];

/*
 * A backslash immediately followed by a quote — the escape style whose
 * meaning differs per engine (see the header comment), so it is rejected
 * outright.
 */
const BACKSLASH_ESCAPED_QUOTE_REGEX: RegExp = /\\['"]/;

export default class SqlQueryGuard {
  /*
   * Blank the contents of comments, string literals and quoted identifiers
   * (replaced by spaces so token boundaries survive). Handles:
   *   -- line comments
   *   slash-star block comments (nested, as PostgreSQL and T-SQL allow)
   *   'single quotes'          with '' escaping
   *   "double-quoted idents"   with "" escaping
   *   `backtick idents`        (MySQL/ClickHouse)
   *   [bracket idents]         (SQL Server)
   *   $tag$ dollar quotes $tag$ (PostgreSQL/ClickHouse)
   *
   * Unterminated regions blank to end-of-input, which fails safe: content
   * is hidden from the ENGINE too or the engine errors on parse.
   */
  public static stripLiteralsAndComments(sql: string): string {
    const output: Array<string> = [];
    const length: number = sql.length;
    let index: number = 0;

    const blank: (count: number) => void = (count: number): void => {
      for (let blanked: number = 0; blanked < count; blanked++) {
        output.push(" ");
      }
      index += count;
    };

    while (index < length) {
      const char: string = sql[index]!;
      const next: string = index + 1 < length ? sql[index + 1]! : "";

      // Line comments: --
      if (char === "-" && next === "-") {
        while (index < length && sql[index] !== "\n") {
          blank(1);
        }
        continue;
      }

      // Block comments, nested (PostgreSQL and T-SQL nest).
      if (char === "/" && next === "*") {
        let depth: number = 0;
        while (index < length) {
          if (sql[index] === "/" && sql[index + 1] === "*") {
            depth++;
            blank(2);
            continue;
          }
          if (sql[index] === "*" && sql[index + 1] === "/") {
            depth--;
            blank(2);
            if (depth === 0) {
              break;
            }
            continue;
          }
          blank(1);
        }
        continue;
      }

      // Single-quoted string; '' escape only (see \' rejection above).
      if (char === "'") {
        blank(1);
        while (index < length) {
          if (sql[index] === "'" && sql[index + 1] === "'") {
            blank(2);
            continue;
          }
          if (sql[index] === "'") {
            blank(1);
            break;
          }
          blank(1);
        }
        continue;
      }

      // Double-quoted identifier; "" escape.
      if (char === '"') {
        blank(1);
        while (index < length) {
          if (sql[index] === '"' && sql[index + 1] === '"') {
            blank(2);
            continue;
          }
          if (sql[index] === '"') {
            blank(1);
            break;
          }
          blank(1);
        }
        continue;
      }

      // Backtick identifier (MySQL/ClickHouse); `` escape.
      if (char === "`") {
        blank(1);
        while (index < length) {
          if (sql[index] === "`" && sql[index + 1] === "`") {
            blank(2);
            continue;
          }
          if (sql[index] === "`") {
            blank(1);
            break;
          }
          blank(1);
        }
        continue;
      }

      // Bracket identifier (SQL Server); ]] escape.
      if (char === "[") {
        blank(1);
        while (index < length) {
          if (sql[index] === "]" && sql[index + 1] === "]") {
            blank(2);
            continue;
          }
          if (sql[index] === "]") {
            blank(1);
            break;
          }
          blank(1);
        }
        continue;
      }

      // Dollar-quoted string (PostgreSQL/ClickHouse): $$..$$ or $tag$..$tag$.
      if (char === "$") {
        const tagMatch: RegExpMatchArray | null = sql
          .substring(index)
          .match(/^\$[A-Za-z_]*\$/);
        if (tagMatch) {
          const tag: string = tagMatch[0];
          const closeIndex: number = sql.indexOf(tag, index + tag.length);
          const end: number =
            closeIndex === -1 ? length : closeIndex + tag.length;
          blank(end - index);
          continue;
        }
      }

      output.push(char);
      index++;
    }

    return output.join("");
  }

  /*
   * Throws BadDataException unless the query is a single read-only
   * statement.
   */
  public static assertReadOnlyQuery(sql: string): void {
    if (!sql || sql.trim().length === 0) {
      throw new BadDataException("Query is required.");
    }

    /*
     * Backslash-escaped quotes parse differently across engines (see the
     * header comment) — reject rather than guess.
     */
    if (BACKSLASH_ESCAPED_QUOTE_REGEX.test(sql)) {
      throw new BadDataException(
        "Backslash-escaped quotes are not allowed in data source queries. Use doubled quotes ('') to escape a quote character.",
      );
    }

    const stripped: string = this.stripLiteralsAndComments(sql);

    // Single statement only: any ';' other than trailing rejects.
    const withoutTrailingSemicolon: string = stripped.replace(/;\s*$/, "");
    if (withoutTrailingSemicolon.includes(";")) {
      throw new BadDataException(
        "Only a single SQL statement is allowed per query.",
      );
    }

    const firstWordMatch: RegExpMatchArray | null =
      withoutTrailingSemicolon.match(/[A-Za-z_]+/);
    const firstWord: string = firstWordMatch
      ? firstWordMatch[0].toUpperCase()
      : "";

    if (!ALLOWED_HEAD_KEYWORDS.includes(firstWord)) {
      throw new BadDataException(
        `Only read-only queries are allowed (must start with ${ALLOWED_HEAD_KEYWORDS.join(
          ", ",
        )}).`,
      );
    }

    for (const keyword of FORBIDDEN_KEYWORDS) {
      const pattern: RegExp = new RegExp(`\\b${keyword}\\b`, "i");
      if (pattern.test(withoutTrailingSemicolon)) {
        throw new BadDataException(
          `Query contains a keyword that is not allowed in read-only data source queries: ${keyword}. Quote it if it is a column or table name.`,
        );
      }
    }

    for (const forbidden of FORBIDDEN_PATTERNS) {
      if (forbidden.pattern.test(withoutTrailingSemicolon)) {
        throw new BadDataException(
          `Query contains ${forbidden.description}, which is not allowed in read-only data source queries.`,
        );
      }
    }
  }

  private static formatUtcDateTime(date: Date): string {
    const pad: (value: number) => string = (value: number): string => {
      return value.toString().padStart(2, "0");
    };
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
      date.getUTCDate(),
    )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
      date.getUTCSeconds(),
    )}`;
  }

  /*
   * Replace dashboard time macros with concrete values. Longer tokens are
   * replaced first so $__startTimeMs is not corrupted by the $__startTime
   * replacement. Timestamp literals are quoted 'YYYY-MM-DD HH:MM:SS' in
   * UTC — every supported engine parses that form; sessions are expected
   * to run in UTC (documented in the query editor help text).
   */
  public static applyTimeMacros(
    sql: string,
    startDate: Date,
    endDate: Date,
  ): string {
    const rangeSeconds: number = Math.max(
      Math.floor((endDate.getTime() - startDate.getTime()) / 1000),
      0,
    );

    return sql
      .replace(/\$__startTimeMs\b/g, startDate.getTime().toString())
      .replace(/\$__endTimeMs\b/g, endDate.getTime().toString())
      .replace(/\$__startTime\b/g, `'${this.formatUtcDateTime(startDate)}'`)
      .replace(/\$__endTime\b/g, `'${this.formatUtcDateTime(endDate)}'`)
      .replace(/\$__rangeSeconds\b/g, rangeSeconds.toString());
  }
}
