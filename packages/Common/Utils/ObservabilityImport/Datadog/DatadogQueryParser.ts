/*
 * DATADOG'S METRIC QUERIES AND FORMULAS, READ (issue #7697).
 *
 * The language a Datadog dashboard's widget and a metric monitor write:
 *
 *   avg:system.cpu.user{env:prod,!host:db-*} by {host}.rollup(max, 60)
 *   100 * sum:redis.mem.used{$scope} / sum:redis.mem.maxmemory{$scope}
 *   top(query1 / 1000, 10, 'mean', 'desc')
 *
 * A query is a space aggregation (avg, sum, min, max - avg when left
 * out), a metric, a scope in braces, an optional `by {tags}` and methods
 * (.as_count(), .as_rate(), .rollup(...), .fill(...)). A formula combines
 * queries - or, in a widget's formulas, the names of its queries - with
 * numbers, + - * / and functions. A scope is `*`, or tags: `key:value`
 * (`*` wildcards), a bare tag, `!` or `-` before one, `$variable` and
 * `$variable.value`, joined by commas or AND, OR and NOT, with
 * `key IN (a, b)` and parentheses.
 *
 * Read strictly: something that is not this language is a
 * DatadogQueryError, never a guess.
 */

export class DatadogQueryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DatadogQueryError";
  }
}

export enum DatadogScopeKind {
  All = "All",
  Tag = "Tag",
  Variable = "Variable",
  And = "And",
  Or = "Or",
  Not = "Not",
  In = "In",
}

export type DatadogScope =
  | { kind: DatadogScopeKind.All }
  // key:value, or a bare tag (key undefined); `*` in the value is a wildcard.
  | { kind: DatadogScopeKind.Tag; key: string | undefined; value: string }
  // $name (a whole tag), or key:$name.value
  | {
      kind: DatadogScopeKind.Variable;
      name: string;
      key: string | undefined;
    }
  | { kind: DatadogScopeKind.And; terms: Array<DatadogScope> }
  | { kind: DatadogScopeKind.Or; terms: Array<DatadogScope> }
  | { kind: DatadogScopeKind.Not; term: DatadogScope }
  | { kind: DatadogScopeKind.In; key: string; values: Array<string> };

export interface DatadogMethod {
  name: string;
  args: Array<string>;
}

export enum DatadogExpressionKind {
  Number = "Number",
  Query = "Query",
  Reference = "Reference",
  Call = "Call",
  Binary = "Binary",
  Negate = "Negate",
  Text = "Text",
}

export type DatadogExpression =
  | { kind: DatadogExpressionKind.Number; value: number }
  | { kind: DatadogExpressionKind.Text; value: string }
  | {
      kind: DatadogExpressionKind.Query;
      aggregator: string | undefined;
      metric: string;
      scope: DatadogScope;
      groupBy: Array<string>;
      methods: Array<DatadogMethod>;
    }
  // A widget formula's name for one of its queries: query1.
  | { kind: DatadogExpressionKind.Reference; name: string }
  | {
      kind: DatadogExpressionKind.Call;
      name: string;
      args: Array<DatadogExpression>;
    }
  | {
      kind: DatadogExpressionKind.Binary;
      operator: "+" | "-" | "*" | "/";
      left: DatadogExpression;
      right: DatadogExpression;
    }
  | { kind: DatadogExpressionKind.Negate; expression: DatadogExpression };

// The longest query read: far past any real one.
const MAX_QUERY_LENGTH: number = 20_000;

// How deep parentheses and calls may nest.
const MAX_DEPTH: number = 50;

const METRIC_NAME: RegExp = /^[A-Za-z][A-Za-z0-9_.]*$/;
// A name: a metric's (with its dots), a function's, a formula's query.
const IDENTIFIER_START: RegExp = /[A-Za-z_]/;
const IDENTIFIER_PART: RegExp = /[A-Za-z0-9_.]/;

class Reader {
  private readonly text: string;
  public index: number = 0;
  private depth: number = 0;

  public constructor(text: string) {
    this.text = text;
  }

  public get done(): boolean {
    this.skipSpace();
    return this.index >= this.text.length;
  }

  public peek(): string {
    this.skipSpace();
    return this.text.charAt(this.index);
  }

  public skipSpace(): void {
    while (this.index < this.text.length && /\s/.test(this.text.charAt(this.index))) {
      this.index++;
    }
  }

  public expect(char: string): void {
    if (this.peek() !== char) {
      throw new DatadogQueryError(
        `expected "${char}" at character ${this.index + 1}`,
      );
    }

    this.index++;
  }

  public enter(): void {
    this.depth++;

    if (this.depth > MAX_DEPTH) {
      throw new DatadogQueryError("the query nests too deep");
    }
  }

  public leave(): void {
    this.depth--;
  }

  // A run of identifier characters: a metric name, a function, a reference.
  public identifier(): string {
    this.skipSpace();
    const start: number = this.index;

    if (!IDENTIFIER_START.test(this.text.charAt(this.index))) {
      return "";
    }

    while (
      this.index < this.text.length &&
      IDENTIFIER_PART.test(this.text.charAt(this.index))
    ) {
      this.index++;
    }

    return this.text.slice(start, this.index);
  }

  // Everything up to the brace that closes this one, nested braces counted.
  public braced(): string {
    this.expect("{");
    const start: number = this.index;
    let nesting: number = 1;

    while (this.index < this.text.length) {
      const char: string = this.text.charAt(this.index);

      if (char === "{") {
        nesting++;
      } else if (char === "}") {
        nesting--;

        if (nesting === 0) {
          const inner: string = this.text.slice(start, this.index);
          this.index++;
          return inner;
        }
      }

      this.index++;
    }

    throw new DatadogQueryError("a brace is never closed");
  }

  public number(): number | undefined {
    this.skipSpace();
    const match: RegExpMatchArray | null = this.text
      .slice(this.index)
      .match(/^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/);

    if (!match) {
      return undefined;
    }

    this.index += match[0].length;
    return Number(match[0]);
  }

  public quoted(): string | undefined {
    const quote: string = this.peek();

    if (quote !== "'" && quote !== '"') {
      return undefined;
    }

    this.index++;
    const start: number = this.index;

    while (this.index < this.text.length && this.text.charAt(this.index) !== quote) {
      this.index++;
    }

    if (this.index >= this.text.length) {
      throw new DatadogQueryError("a quote is never closed");
    }

    const value: string = this.text.slice(start, this.index);
    this.index++;
    return value;
  }

  public rest(): string {
    return this.text.slice(this.index);
  }
}

/*
 * A method's arguments as written: `.rollup(avg, 60)` -> ["avg", "60"],
 * `.fill(null)` -> ["null"].
 */
const readMethodArgs: (reader: Reader) => Array<string> = (
  reader: Reader,
): Array<string> => {
  reader.expect("(");
  const args: Array<string> = [];

  for (;;) {
    if (reader.peek() === ")") {
      reader.index++;
      return args;
    }

    const quoted: string | undefined = reader.quoted();

    if (quoted !== undefined) {
      args.push(quoted);
    } else {
      const number: number | undefined = reader.number();

      if (number !== undefined) {
        args.push(String(number));
      } else {
        const word: string = reader.identifier();

        if (!word) {
          throw new DatadogQueryError(
            `unexpected "${reader.peek()}" in a method's arguments`,
          );
        }

        args.push(word);
      }
    }

    if (reader.peek() === ",") {
      reader.index++;
    }
  }
};

// One query: [aggregator:]metric{scope}[ by {tags}][.method(...)]*
const readQuery: (reader: Reader, first: string) => DatadogExpression = (
  reader: Reader,
  first: string,
): DatadogExpression => {
  let aggregator: string | undefined = undefined;
  let metric: string = first;

  if (reader.peek() === ":") {
    reader.index++;
    aggregator = first;
    metric = reader.identifier();
  }

  if (!METRIC_NAME.test(metric) || metric.endsWith(".")) {
    throw new DatadogQueryError(`"${metric}" is not a metric name`);
  }

  const scope: DatadogScope = parseDatadogScope(reader.braced());
  let groupBy: Array<string> = [];

  // ` by {host,env}`
  const rest: string = reader.rest();
  const by: RegExpMatchArray | null = rest.match(/^\s*by\s*\{/);

  if (by) {
    reader.index += by[0].length - 1;
    groupBy = reader
      .braced()
      .split(",")
      .map((tag: string): string => {
        return tag.trim();
      })
      .filter((tag: string): boolean => {
        return tag.length > 0;
      });
  }

  const methods: Array<DatadogMethod> = [];

  while (reader.peek() === ".") {
    reader.index++;
    const name: string = reader.identifier();

    if (!name) {
      throw new DatadogQueryError("a method has no name");
    }

    methods.push({ name, args: readMethodArgs(reader) });
  }

  return {
    kind: DatadogExpressionKind.Query,
    aggregator,
    metric,
    scope,
    groupBy,
    methods,
  };
};

const readPrimary: (reader: Reader) => DatadogExpression = (
  reader: Reader,
): DatadogExpression => {
  const char: string = reader.peek();

  if (char === "(") {
    reader.index++;
    reader.enter();
    const inner: DatadogExpression = readSum(reader);
    reader.leave();
    reader.expect(")");
    return inner;
  }

  if (char === "-") {
    reader.index++;
    return { kind: DatadogExpressionKind.Negate, expression: readPrimary(reader) };
  }

  const quoted: string | undefined = reader.quoted();

  if (quoted !== undefined) {
    return { kind: DatadogExpressionKind.Text, value: quoted };
  }

  const number: number | undefined = reader.number();

  if (number !== undefined) {
    return { kind: DatadogExpressionKind.Number, value: number };
  }

  const word: string = reader.identifier();

  if (!word) {
    throw new DatadogQueryError(
      char ? `unexpected "${char}"` : "the query ends too soon",
    );
  }

  // A query: a metric followed by its scope, maybe after its aggregator.
  if (reader.peek() === "{" || reader.peek() === ":") {
    return readQuery(reader, word);
  }

  // Otherwise a function's call, or a formula's name for one of its queries.
  if (reader.peek() === "(") {
    reader.index++;
    reader.enter();
    const args: Array<DatadogExpression> = [];

    if (reader.peek() !== ")") {
      for (;;) {
        args.push(readArgument(reader));

        if (reader.peek() === ",") {
          reader.index++;
          continue;
        }

        break;
      }
    }

    reader.leave();
    reader.expect(")");
    return { kind: DatadogExpressionKind.Call, name: word, args };
  }

  return { kind: DatadogExpressionKind.Reference, name: word };
};

/*
 * One argument of a function: an expression, or a named one, as
 * anomalies(q, 'basic', 2, direction='above') writes it - read as text.
 */
const readArgument: (reader: Reader) => DatadogExpression = (
  reader: Reader,
): DatadogExpression => {
  const start: number = reader.index;
  const name: string = reader.identifier();

  if (name && reader.peek() === "=" && reader.rest().charAt(1) !== "=") {
    reader.index++;
    const quoted: string | undefined = reader.quoted();
    const value: string =
      quoted !== undefined
        ? quoted
        : String(reader.number() ?? reader.identifier());

    return { kind: DatadogExpressionKind.Text, value: `${name}=${value}` };
  }

  reader.index = start;
  return readSum(reader);
};

const readProduct: (reader: Reader) => DatadogExpression = (
  reader: Reader,
): DatadogExpression => {
  let left: DatadogExpression = readPrimary(reader);

  for (;;) {
    const char: string = reader.peek();

    if (char !== "*" && char !== "/") {
      return left;
    }

    reader.index++;
    left = {
      kind: DatadogExpressionKind.Binary,
      operator: char,
      left,
      right: readPrimary(reader),
    };
  }
};

const readSum: (reader: Reader) => DatadogExpression = (
  reader: Reader,
): DatadogExpression => {
  let left: DatadogExpression = readProduct(reader);

  for (;;) {
    const char: string = reader.peek();

    if (char !== "+" && char !== "-") {
      return left;
    }

    reader.index++;
    left = {
      kind: DatadogExpressionKind.Binary,
      operator: char,
      left,
      right: readProduct(reader),
    };
  }
};

// A widget's query or formula, or a monitor's query without its window.
export const parseDatadogExpression: (text: string) => DatadogExpression = (
  text: string,
): DatadogExpression => {
  const source: string = (text || "").trim();

  if (!source) {
    throw new DatadogQueryError("the query is empty");
  }

  if (source.length > MAX_QUERY_LENGTH) {
    throw new DatadogQueryError("the query is too long");
  }

  const reader: Reader = new Reader(source);
  const expression: DatadogExpression = readSum(reader);

  if (!reader.done) {
    throw new DatadogQueryError(
      `unexpected "${reader.peek()}" at character ${reader.index + 1}`,
    );
  }

  return expression;
};

// ------------------------------------------------------------------ scope

type ScopeToken = { kind: "word" | "(" | ")" | ","; text: string };

const tokenizeScope: (text: string) => Array<ScopeToken> = (
  text: string,
): Array<ScopeToken> => {
  const tokens: Array<ScopeToken> = [];
  let index: number = 0;

  while (index < text.length) {
    const char: string = text.charAt(index);

    if (/\s/.test(char)) {
      index++;
      continue;
    }

    if (char === "(" || char === ")" || char === ",") {
      tokens.push({ kind: char, text: char });
      index++;
      continue;
    }

    if (char === '"' || char === "'") {
      const end: number = text.indexOf(char, index + 1);

      if (end === -1) {
        throw new DatadogQueryError("a quote in the scope is never closed");
      }

      tokens.push({ kind: "word", text: text.slice(index + 1, end) });
      index = end + 1;
      continue;
    }

    const start: number = index;

    while (index < text.length && !/[\s(),]/.test(text.charAt(index))) {
      index++;
    }

    tokens.push({ kind: "word", text: text.slice(start, index) });
  }

  return tokens;
};

class ScopeReader {
  private readonly tokens: Array<ScopeToken>;
  private index: number = 0;
  private depth: number = 0;

  public constructor(tokens: Array<ScopeToken>) {
    this.tokens = tokens;
  }

  public get done(): boolean {
    return this.index >= this.tokens.length;
  }

  private peek(): ScopeToken | undefined {
    return this.tokens[this.index];
  }

  private isKeyword(word: string): boolean {
    const token: ScopeToken | undefined = this.peek();
    return Boolean(
      token && token.kind === "word" && token.text.toUpperCase() === word,
    );
  }

  public readOr(): DatadogScope {
    const terms: Array<DatadogScope> = [this.readAnd()];

    while (this.isKeyword("OR")) {
      this.index++;
      terms.push(this.readAnd());
    }

    return terms.length === 1
      ? terms[0]!
      : { kind: DatadogScopeKind.Or, terms };
  }

  private readAnd(): DatadogScope {
    const terms: Array<DatadogScope> = [this.readNot()];

    for (;;) {
      const token: ScopeToken | undefined = this.peek();

      if (token?.kind === ",") {
        this.index++;
        terms.push(this.readNot());
        continue;
      }

      if (this.isKeyword("AND")) {
        this.index++;
        terms.push(this.readNot());
        continue;
      }

      break;
    }

    return terms.length === 1
      ? terms[0]!
      : { kind: DatadogScopeKind.And, terms };
  }

  private readNot(): DatadogScope {
    if (this.isKeyword("NOT")) {
      this.index++;
      return { kind: DatadogScopeKind.Not, term: this.readNot() };
    }

    return this.readPrimary();
  }

  private readList(): Array<string> {
    const open: ScopeToken | undefined = this.peek();

    if (open?.kind !== "(") {
      throw new DatadogQueryError("IN takes a list in parentheses");
    }

    this.index++;
    const values: Array<string> = [];

    for (;;) {
      const token: ScopeToken | undefined = this.peek();

      if (!token) {
        throw new DatadogQueryError("an IN list is never closed");
      }

      this.index++;

      if (token.kind === ")") {
        return values;
      }

      if (token.kind === "word") {
        values.push(token.text);
      }
    }
  }

  private readPrimary(): DatadogScope {
    const token: ScopeToken | undefined = this.peek();

    if (!token) {
      throw new DatadogQueryError("the scope ends too soon");
    }

    if (token.kind === "(") {
      this.index++;
      this.depth++;

      if (this.depth > MAX_DEPTH) {
        throw new DatadogQueryError("the scope nests too deep");
      }

      const inner: DatadogScope = this.readOr();
      this.depth--;
      const close: ScopeToken | undefined = this.peek();

      if (close?.kind !== ")") {
        throw new DatadogQueryError("a parenthesis in the scope is never closed");
      }

      this.index++;
      return inner;
    }

    if (token.kind !== "word") {
      throw new DatadogQueryError(`unexpected "${token.text}" in the scope`);
    }

    this.index++;

    // key IN (a, b), key NOT IN (a, b)
    if (this.isKeyword("IN")) {
      this.index++;
      return { kind: DatadogScopeKind.In, key: token.text, values: this.readList() };
    }

    if (
      this.isKeyword("NOT") &&
      this.tokens[this.index + 1]?.kind === "word" &&
      this.tokens[this.index + 1]!.text.toUpperCase() === "IN"
    ) {
      this.index += 2;
      return {
        kind: DatadogScopeKind.Not,
        term: {
          kind: DatadogScopeKind.In,
          key: token.text,
          values: this.readList(),
        },
      };
    }

    return readScopeWord(token.text);
  }
}

// One word of a scope: a tag, its negation, or a variable.
const readScopeWord: (word: string) => DatadogScope = (
  word: string,
): DatadogScope => {
  if (word === "*") {
    return { kind: DatadogScopeKind.All };
  }

  if (word.startsWith("!") || word.startsWith("-")) {
    return { kind: DatadogScopeKind.Not, term: readScopeWord(word.slice(1)) };
  }

  if (word.startsWith("$")) {
    const name: string = word.slice(1).replace(/\.value$/, "");
    return { kind: DatadogScopeKind.Variable, name, key: undefined };
  }

  const colon: number = word.indexOf(":");

  if (colon === -1) {
    return { kind: DatadogScopeKind.Tag, key: undefined, value: word };
  }

  const key: string = word.slice(0, colon);
  const value: string = word.slice(colon + 1);

  // key:$variable.value - the variable's value under this key.
  if (value.startsWith("$")) {
    return {
      kind: DatadogScopeKind.Variable,
      name: value.slice(1).replace(/\.value$/, ""),
      key,
    };
  }

  return { kind: DatadogScopeKind.Tag, key, value };
};

export const parseDatadogScope: (text: string) => DatadogScope = (
  text: string,
): DatadogScope => {
  const tokens: Array<ScopeToken> = tokenizeScope(text);

  if (tokens.length === 0) {
    return { kind: DatadogScopeKind.All };
  }

  const reader: ScopeReader = new ScopeReader(tokens);
  const scope: DatadogScope = reader.readOr();

  if (!reader.done) {
    throw new DatadogQueryError("the scope has words left over");
  }

  return scope;
};

/*
 * A monitor's query: `<time aggregation>(<window>):<query> <comparison>
 * <threshold>`, as Datadog's metric monitors write it.
 */
export interface DatadogMonitorQuery {
  timeAggregation: string;
  window: string;
  expression: string;
  comparison: string;
  threshold: number;
}

export const parseDatadogMonitorQuery: (
  text: string,
) => DatadogMonitorQuery = (text: string): DatadogMonitorQuery => {
  const source: string = (text || "").trim();
  const head: RegExpMatchArray | null = source.match(
    /^([a-z_]+)\(\s*([a-z0-9_]+)\s*\)\s*:([\s\S]*)$/,
  );

  if (!head) {
    throw new DatadogQueryError(
      "a metric monitor's query starts with its time aggregation and window, as avg(last_5m):",
    );
  }

  const body: string = head[3] || "";
  const tail: RegExpMatchArray | null = body.match(
    /^([\s\S]*?)\s*(>=|<=|==|!=|>|<|=)\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*$/,
  );

  if (!tail) {
    throw new DatadogQueryError(
      "a metric monitor's query ends in a comparison with a number, as > 90",
    );
  }

  return {
    timeAggregation: head[1] || "",
    window: head[2] || "",
    expression: (tail[1] || "").trim(),
    comparison: tail[2] || "",
    threshold: Number(tail[3]),
  };
};
