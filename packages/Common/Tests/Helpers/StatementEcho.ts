import { Statement } from "../../Server/Utils/AnalyticsDatabase/Statement";

/*
 * A statement as ClickHouse sees it and writes it down (issue #6419).
 *
 * readStatementValues: every parameter's value as the query computes it, by
 * its position (p3 is [3]) - hex encoded text decoded, an array of texts
 * read back from its text, pieces joined - so a test can say what a
 * statement asks for without caring how it is sent.
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
 *
 * How Statement sends hex encoded text, which this reads back:
 *
 *   unhex({p0:String})                                   a text
 *   concat(unhex({p0_0:String}), unhex({p0_1:String}))   a long text, in pieces
 *   CAST(unhex({p1:String}), 'Array(String)')            an array of texts, as its text ['a','it\'s']
 *   CAST(concat(unhex({p1_0:String}), ...), 'Array(String)')   a long one, in pieces
 */

interface Placeholder {
  start: number;
  end: number;
  name: string;
  type: string;
}

// A parameter's name: p3, a piece of a hex encoded one, p4_0, or a qualified column's half, p5_t.
const PLACEHOLDER_NAME: RegExp = /^p\d+(_[a-z0-9]+)?$/;

const UNHEX: string = "unhex(";
const CONCAT: string = "concat(";
const CAST: string = "CAST(";
const AS_TEXT_ARRAY: string = ", 'Array(String)')";

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

/*
 * An array of texts read back from the text Statement sends it as
 * (toArrayText): each between quotes, with only \\ and \' escaped. Anything
 * else is refused, so a change in how arrays are sent fails loudly here.
 */
export function readArrayText(text: string): Array<string> {
  if (!text.startsWith("[") || !text.endsWith("]")) {
    throw new Error(`Not an array's text: ${text.slice(0, 80)}`);
  }

  const values: Array<string> = [];

  if (text === "[]") {
    return values;
  }

  let index: number = 1;

  for (;;) {
    if (text[index] !== "'") {
      throw new Error(`Expected a quote at ${index} of ${text.slice(0, 80)}`);
    }

    index++;

    let value: string = "";

    for (;;) {
      const char: string | undefined = text[index];

      if (char === undefined) {
        throw new Error(`An unclosed text in ${text.slice(0, 80)}`);
      }

      if (char === "\\") {
        const escaped: string | undefined = text[index + 1];

        if (escaped !== "\\" && escaped !== "'") {
          throw new Error(`Unexpected escape \\${escaped} at ${index}`);
        }

        value += escaped;
        index += 2;
        continue;
      }

      index++;

      if (char === "'") {
        break;
      }

      value += char;
    }

    values.push(value);

    if (text[index] === ",") {
      index++;
      continue;
    }

    if (text[index] === "]" && index === text.length - 1) {
      return values;
    }

    throw new Error(`Expected , or ] at ${index} of ${text.slice(0, 80)}`);
  }
}

/*
 * One parameter as the query reads it: the span of the query that reads it
 * (a placeholder, its unhex, the concat of its pieces and the CAST around
 * them), how it is sent, and the value the query computes.
 */
interface ReadParameter {
  position: number;
  start: number;
  end: number;
  kind: "plain" | "qualified" | "hex" | "hexArray";
  value: unknown;
  // The placeholders it is sent in, in order.
  placeholders: Array<Placeholder>;
}

function readParameters(
  query: string,
  params: Record<string, unknown>,
): Array<ReadParameter> {
  const byPosition: Map<number, Array<Placeholder>> = new Map();

  for (const placeholder of findPlaceholders(query)) {
    const position: number = positionOf(placeholder.name);
    const placeholders: Array<Placeholder> = byPosition.get(position) || [];

    placeholders.push(placeholder);
    byPosition.set(position, placeholders);
  }

  const read: Array<ReadParameter> = [];

  for (const [position, placeholders] of byPosition) {
    const first: Placeholder = placeholders[0]!;
    const last: Placeholder = placeholders[placeholders.length - 1]!;
    const isHex: boolean =
      query.slice(first.start - UNHEX.length, first.start) === UNHEX;

    if (placeholders.length === 2 && first.name === `p${position}_t`) {
      read.push({
        position,
        start: first.start,
        end: last.end,
        kind: "qualified",
        value: `${String(params[first.name])}.${String(params[last.name])}`,
        placeholders,
      });
      continue;
    }

    if (!isHex) {
      for (const placeholder of placeholders) {
        read.push({
          position,
          start: placeholder.start,
          end: placeholder.end,
          kind: "plain",
          value: params[placeholder.name],
          placeholders: [placeholder],
        });
      }
      continue;
    }

    // One piece is unhex(...); more are concat(unhex(...), unhex(...)).
    let start: number = first.start - UNHEX.length;
    let end: number = last.end + ")".length;

    if (placeholders.length > 1) {
      start -= CONCAT.length;
      end += ")".length;
    }

    const text: string = fromHex(
      placeholders
        .map((placeholder: Placeholder): string => {
          return String(params[placeholder.name]);
        })
        .join(""),
    );

    const isArray: boolean =
      query.slice(start - CAST.length, start) === CAST &&
      query.startsWith(AS_TEXT_ARRAY, end);

    if (isArray) {
      read.push({
        position,
        start: start - CAST.length,
        end: end + AS_TEXT_ARRAY.length,
        kind: "hexArray",
        value: readArrayText(text),
        placeholders,
      });
    } else {
      read.push({
        position,
        start,
        end,
        kind: "hex",
        value: text,
        placeholders,
      });
    }
  }

  return read.sort((a: ReadParameter, b: ReadParameter): number => {
    return a.start - b.start;
  });
}

export function readStatementValues(statement: Statement): Array<unknown> {
  const values: Array<unknown> = [];

  for (const parameter of readParameters(
    statement.query,
    statement.query_params,
  )) {
    values[parameter.position] = parameter.value;
  }

  return values;
}

/*
 * A statement's parameters by name, as the query reads them: a hex encoded
 * text decoded under its own name (p3), an array of texts read back from
 * its text, and the pieces of a long one joined under their position's name
 * (p4). What a test that looks for "the parameter holding x" reads instead
 * of query_params.
 */
export function decodedQueryParams(
  statement: Statement,
): Record<string, unknown> {
  const sent: Record<string, unknown> = statement.query_params;
  // Rebuilt in the order the placeholders come, which is the parameters' order.
  const params: Record<string, unknown> = {};

  for (const parameter of readParameters(statement.query, sent)) {
    if (parameter.kind === "hex" || parameter.kind === "hexArray") {
      params[`p${parameter.position}`] = parameter.value;
      continue;
    }

    for (const placeholder of parameter.placeholders) {
      params[placeholder.name] = sent[placeholder.name];
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
  const query: string = statement.query;
  let echo: string = "";
  let from: number = 0;

  for (const parameter of readParameters(query, statement.query_params)) {
    echo += query.slice(from, parameter.start);

    if (parameter.kind === "hexArray") {
      echo += `_CAST([${(parameter.value as Array<string>)
        .map(quoteText)
        .join(", ")}], 'Array(String)')`;
    } else if (parameter.kind === "hex") {
      echo += quoteText(parameter.value);
    } else {
      echo += echoQuery(
        query.slice(parameter.start, parameter.end),
        statement.query_params,
      );
    }

    from = parameter.end;
  }

  return echo + query.slice(from);
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
