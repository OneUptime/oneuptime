/*
 * A TABLE AS A BI TOOL NAMES IT, AND THE TABLES A QUERY READS.
 *
 * Every BI reader (BiConnectors, PowerQuery) names a table the same way -
 * its database, schema and name, and the engine and host where the tool
 * says - and the matching (BiMatching) ties it to a watched table after.
 * A query's tables are the names after FROM and JOIN, and after the commas
 * of an old-style join, never a common table expression's own name.
 */

export interface BiTableRef {
  database: string | null;
  schema: string | null;
  table: string;
  // The engine as the tool names it: postgres, snowflake, bigquery...
  engine: string | null;
  host: string | null;
  /*
   * Whether the database is named as its server names it - in the query
   * itself, or by Power BI's connector - rather than by the label a tool
   * gave its connection. Only an exact name rules other databases out.
   */
  isDatabaseExact?: boolean | undefined;
  /*
   * Whether `table` names a Dataverse entity set (accounts), as the
   * OData connectors navigate (Cds.Entities), rather than the table's
   * logical name (account), which OneUptime keys Dataverse tables by:
   * matched through the environment's own entity set names (BiMatching).
   */
  isEntitySet?: boolean | undefined;
}

export interface BiTableDefaults {
  database?: string | null;
  engine?: string | null;
  host?: string | null;
  // Whether the default database is named as its server names it.
  isDatabaseExact?: boolean | undefined;
}

// The longest part of a name kept.
export const MAX_BI_NAME_LENGTH: number = 240;

// The most tables kept of one dashboard.
export const MAX_TABLES_PER_DASHBOARD: number = 200;

// A name as SQL writes it: bare, or quoted with "", `` or [].
const IDENT: string =
  '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][A-Za-z0-9_$#@]*)';
const QUALIFIED: string = `${IDENT}(?:\\s*\\.\\s*${IDENT}){0,3}`;
const FROM_OR_JOIN: RegExp = new RegExp(
  `\\b(?:FROM|JOIN)\\s+(${QUALIFIED})`,
  "gi",
);
const CTE_NAME: RegExp =
  /(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi;

// After a table, an alias (AS x, or a bare x), then a comma and the next table of an old-style join.
const NEXT_IN_LIST: RegExp = new RegExp(
  `^\\s*(?:(?:AS\\s+)?(${IDENT}))?\\s*,\\s*(${QUALIFIED})`,
  "i",
);

// Words that end a list of tables, so never an alias.
const NOT_AN_ALIAS: ReadonlySet<string> = new Set([
  "where",
  "group",
  "order",
  "having",
  "limit",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "outer",
  "on",
  "union",
  "except",
  "intersect",
  "window",
  "qualify",
  "lateral",
  "natural",
  "using",
  "with",
  "for",
  "offset",
  "fetch",
  "pivot",
  "unpivot",
  "tablesample",
  "select",
]);

// A name in quotes, backticks or brackets.
const QUOTED_START: RegExp = /^["`[]/;

function unquote(part: string): string {
  const trimmed: string = part.trim();

  return trimmed.length >= 2 && QUOTED_START.test(trimmed)
    ? trimmed.slice(1, -1)
    : trimmed;
}

/*
 * A qualified name as its parts, the last the table: db.schema.table,
 * schema.table or table. A BigQuery name in one pair of backticks
 * (`project.dataset.table`) is split on its dots, and a linked server's
 * four-part name (server.db.schema.table) keeps its last three.
 */
export function readQualifiedName(
  value: string,
  defaults: BiTableDefaults = {},
): BiTableRef | null {
  let parts: Array<string> = (value.match(new RegExp(IDENT, "g")) || [])
    .map(unquote)
    .flatMap((part: string): Array<string> => {
      return part.includes(".") ? part.split(".") : [part];
    })
    .filter(Boolean);

  if (parts.length === 4) {
    parts = parts.slice(1);
  }

  if (parts.length === 0 || parts.length > 3) {
    return null;
  }

  const table: string = parts[parts.length - 1]!.slice(0, MAX_BI_NAME_LENGTH);
  const database: string | null =
    parts.length === 3
      ? parts[0]!.slice(0, MAX_BI_NAME_LENGTH)
      : defaults.database || null;
  const ref: BiTableRef = {
    database,
    schema:
      parts.length >= 2
        ? parts[parts.length - 2]!.slice(0, MAX_BI_NAME_LENGTH)
        : null,
    table,
    engine: defaults.engine || null,
    host: defaults.host || null,
  };

  // A database the query names itself is named as its server names it.
  if (database && (parts.length === 3 || defaults.isDatabaseExact)) {
    ref.isDatabaseExact = true;
  }

  return ref;
}

/*
 * The tables a query reads: every name after FROM or JOIN, and after the
 * commas of an old-style join (FROM orders o, customers c), but a common
 * table expression's own name. Template tags ({{...}}), strings and
 * subqueries are not names.
 */
export function readSqlTables(
  sql: string,
  defaults: BiTableDefaults = {},
): Array<BiTableRef> {
  const text: string = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
  const ctes: Set<string> = new Set(
    Array.from(text.matchAll(CTE_NAME)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!.toLowerCase();
      },
    ),
  );
  const tables: Array<BiTableRef> = [];
  const keep: (name: string) => void = (name: string): void => {
    const ref: BiTableRef | null = readQualifiedName(name, defaults);

    if (ref && !(ref.schema === null && ctes.has(ref.table.toLowerCase()))) {
      tables.push(ref);
    }
  };

  for (const match of text.matchAll(FROM_OR_JOIN)) {
    keep(match[1]!);

    // The rest of an old-style join's list: ", customers c, refunds".
    let rest: string = text.slice((match.index || 0) + match[0].length);

    for (let more: number = 0; more < 50; more++) {
      const next: RegExpMatchArray | null = rest.match(NEXT_IN_LIST);

      if (
        !next ||
        (next[1] && NOT_AN_ALIAS.has(unquote(next[1]).toLowerCase())) ||
        NOT_AN_ALIAS.has(unquote(next[2]!).toLowerCase())
      ) {
        break;
      }

      keep(next[2]!);
      rest = rest.slice(next[0].length);
    }
  }

  return tables;
}

// Each table once, by its parts in lower case.
export function uniqueTables(tables: Array<BiTableRef>): Array<BiTableRef> {
  const seen: Set<string> = new Set();

  return tables
    .filter((ref: BiTableRef): boolean => {
      const key: string = getBiTableKey(ref);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, MAX_TABLES_PER_DASHBOARD);
}

/*
 * A table as one key: its database, schema and name, in lower case. A
 * Dataverse entity set is a name of another kind, so it keys apart from a
 * table of the same letters.
 */
export function getBiTableKey(ref: BiTableRef): string {
  return [
    ref.database,
    ref.schema,
    ref.table,
    ...(ref.isEntitySet ? ["entity set"] : []),
  ]
    .map((part: string | null): string => {
      return (part || "").toLowerCase();
    })
    .join("\u0000");
}

// A table as people read it: database.schema.table, with the parts it has.
export function getBiTableName(ref: BiTableRef): string {
  return [ref.database, ref.schema, ref.table].filter(Boolean).join(".");
}
