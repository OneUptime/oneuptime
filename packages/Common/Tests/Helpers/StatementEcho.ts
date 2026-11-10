import { Statement } from "../../Server/Utils/AnalyticsDatabase/Statement";

/*
 * A statement as ClickHouse sees it and writes it down (issue #6419).
 *
 * readStatementValues: every parameter's value as the query computes it, by
 * its position (p3 is [3]) - hex encoded text decoded, an array decoded
 * element by element - so a test can say what a statement asks for without
 * caring how it is sent.
 *
 * echoStatement: the query with every parameter filled in, the way the
 * server's error log ("(in query: ...)") and system.query_log show it:
 *
 *   {p0:String}          'it\'s'
 *   {p1:Array(String)}   _CAST(['a', 'b'], 'Array(String)')
 *   {p2:Int32}           _CAST(5, 'Int32')
 *   {p3:Identifier}      name
 *
 * clickHouseErrorLogLine: that echo in the line ClickHouse logs for a
 * failed read, with the version that once read as the attack's address.
 */

interface Placeholder {
  start: number;
  end: number;
  name: string;
  type: string;
}

// A parameter's name: p3, or one element of an array sent element by element, p4_0.
const PLACEHOLDER_NAME: RegExp = /^p\d+(_[a-z0-9]+)?$/;

function findPlaceholders(query: string): Array<Placeholder> {
  const placeholders: Array<Placeholder> = [];
  let start: number = query.indexOf("{p");

  while (start !== -1) {
    const colon: number = query.indexOf(":", start);
    const close: number = query.indexOf("}", start);

    if (colon !== -1 && close !== -1 && colon < close) {
      const name: string = query.slice(start + 1, colon);
      const type: string = query.slice(colon + 1, close);

      if (PLACEHOLDER_NAME.test(name)) {
        placeholders.push({ start, end: close + 1, name, type });
      }
    }

    start = query.indexOf("{p", start + 1);
  }

  return placeholders;
}

function fromHex(hex: string): string {
  return Buffer.from(hex, "hex").toString("utf8");
}

function positionOf(name: string): number {
  const underscore: number = name.indexOf("_");

  return Number(name.slice(1, underscore === -1 ? undefined : underscore));
}

export function readStatementValues(statement: Statement): Array<unknown> {
  const query: string = statement.query;
  const params: Record<string, unknown> = statement.query_params;
  const values: Array<unknown> = [];

  for (const placeholder of findPlaceholders(query)) {
    const position: number = positionOf(placeholder.name);
    const value: unknown = params[placeholder.name];
    const isHex: boolean =
      query.slice(placeholder.start - "unhex(".length, placeholder.start) ===
      "unhex(";
    const decoded: unknown = isHex ? fromHex(String(value)) : value;
    const suffix: string = placeholder.name.slice(`p${position}`.length + 1);

    if (suffix === "t" || suffix === "c") {
      // A qualified column: "table.column".
      values[position] =
        suffix === "t" ? `${String(value)}.` : `${values[position]}${value}`;
    } else if (suffix) {
      // An element of an array sent element by element.
      const elements: Array<unknown> = Array.isArray(values[position])
        ? (values[position] as Array<unknown>)
        : [];
      elements[Number(suffix)] = decoded;
      values[position] = elements;
    } else {
      values[position] = decoded;
    }
  }

  return values;
}

/*
 * A statement's parameters by name, as the query reads them: a hex encoded
 * text decoded under its own name (p3), an array sent element by element
 * (p4_0, p4_1) put back together under its position's name (p4). What a
 * test that looks for "the parameter holding x" reads instead of
 * query_params.
 */
export function decodedQueryParams(
  statement: Statement,
): Record<string, unknown> {
  const query: string = statement.query;
  const sent: Record<string, unknown> = statement.query_params;
  // Rebuilt in the order the placeholders come, which is the parameters' order.
  const params: Record<string, unknown> = {};

  for (const placeholder of findPlaceholders(query)) {
    const isHex: boolean =
      query.slice(placeholder.start - "unhex(".length, placeholder.start) ===
      "unhex(";
    const position: number = positionOf(placeholder.name);
    const isElement: boolean = isHex && placeholder.name !== `p${position}`;

    if (!isHex) {
      params[placeholder.name] = sent[placeholder.name];
    } else if (!isElement) {
      params[placeholder.name] = fromHex(String(sent[placeholder.name]));
    } else {
      const name: string = `p${position}`;
      const elements: Array<unknown> = Array.isArray(params[name])
        ? (params[name] as Array<unknown>)
        : [];
      elements.push(fromHex(String(sent[placeholder.name])));
      params[name] = elements;
    }
  }

  return params;
}

function quoteText(value: unknown): string {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function toLiteral(value: unknown, type: string): string {
  if (type === "Identifier") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `_CAST([${value.map(quoteText).join(", ")}], '${type}')`;
  }

  if (type === "String") {
    return quoteText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `_CAST(${String(value)}, '${type}')`;
  }

  return `_CAST(${quoteText(typeof value === "string" ? value : JSON.stringify(value))}, '${type}')`;
}

export function echoStatement(statement: Statement): string {
  return echoQuery(statement.query, statement.query_params);
}

function echoQuery(query: string, params: Record<string, unknown>): string {
  let echo: string = "";
  let from: number = 0;

  for (const placeholder of findPlaceholders(query)) {
    echo += query.slice(from, placeholder.start);
    echo += toLiteral(params[placeholder.name], placeholder.type);
    from = placeholder.end;
  }

  return echo + query.slice(from);
}

/*
 * The echo as it was before hex encoding: each hex encoded parameter
 * written down as the text it decodes to. What a guard test holds the real
 * echo against, to show it would see the words if they were sent again.
 */
export function echoStatementAsWritten(statement: Statement): string {
  const values: Array<unknown> = readStatementValues(statement);
  let query: string = statement.query;

  values.forEach((value: unknown, position: number): void => {
    if (Array.isArray(value)) {
      const elements: string = value
        .map((_element: unknown, index: number): string => {
          return `unhex({p${position}_${index}:String})`;
        })
        .join(", ");

      query = query
        .split(`[${elements}]`)
        .join(`_CAST([${value.map(quoteText).join(", ")}], 'Array(String)')`);
    } else {
      query = query
        .split(`unhex({p${position}:String})`)
        .join(quoteText(value));
    }
  });

  return echoQuery(query, statement.query_params);
}

// ClickHouse's own version, as the customer's line carried it.
export const CLICKHOUSE_VERSION: string = "26.7.38.18";

/*
 * The line ClickHouse 26.7 logs for a read stopped part-way, as its server
 * writes it (captured from clickhouse/clickhouse-server:26.7), with
 * `query` as the text it ran.
 */
export function clickHouseErrorLogLine(query: string): string {
  return `2026.11.09 13:04:23.240838 [ 87 ] {fe9cb701-f25d-4f87-b54d-c190941a9c60} <Error> executeQuery: Code: 158. DB::Exception: Limit for rows or bytes to read exceeded, max rows: 1.00, current rows: 200.00 thousand: While executing MergeTreeSelect(pool: ReadPool, algorithm: Thread). (TOO_MANY_ROWS) (version ${CLICKHOUSE_VERSION} (official build)) (from 10.20.0.15:42742) (query 1, line 1) (in query: ${query}), Stack trace (when copying this message, always include the lines below):`;
}

// The query string the ClickHouse client sends a statement's parameters in.
export function statementUrlQuery(statement: Statement): string {
  const search: URLSearchParams = new URLSearchParams();

  for (const [name, value] of Object.entries(statement.query_params)) {
    search.set(
      `param_${name}`,
      Array.isArray(value)
        ? `[${value.map(quoteText).join(",")}]`
        : String(value),
    );
  }

  return search.toString();
}
