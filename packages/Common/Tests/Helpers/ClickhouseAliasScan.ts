import { REPOSITORY_DIRECTORY, SKIPPED_FOLDER_NAMES } from "./TagStripScan";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ClickHouse reads a name as an alias of the SELECT before it reads it as a
 * column of the same name - at every level of a query, under its current
 * analyzer and the older one alike (prefer_column_name_to_alias is off by
 * default). An alias that spells a column the same SELECT reads elsewhere
 * therefore changes what that read means:
 *
 *   - an aggregate's alias read inside another aggregate makes an aggregate
 *     of an aggregate, and the whole query fails: "Aggregate function
 *     max(confidence) AS confidence is found inside another aggregate
 *     function" (ILLEGAL_AGGREGATION). Every threat intel match, enrichment
 *     and poll query failed so (issue #5157);
 *   - an aggregate's alias read in WHERE or PREWHERE fails the same way
 *     ("... is found in WHERE");
 *   - any other alias read there quietly reads the expression instead of the
 *     column: a WHERE on `time` beside `toStartOfInterval(time, ...) AS time`
 *     filters on bucket starts.
 *
 * An alias spells a column when its own expression reads that name
 * (`max(confidence) AS confidence`): an alias of a new name
 * (`count() AS matchCount`) is meant to be read, and is left alone. So is an
 * aggregate's alias read OUTSIDE another aggregate, by a window function
 * (`sum(groupCount) OVER (...)`) or by plain arithmetic: that reads the
 * aggregate, which is what such a read means to do.
 *
 * findAliasShadows reads SQL text - a statement as built, or what a source
 * file's string and template literals say (sqlTextsOf, every
 * `${...}` read as a name of its own) - and names each such alias.
 * findAliasesSpellingColumns is the strict form for statements that keep the
 * stricter rule: no alias may be a name any expression, WHERE, PREWHERE or
 * GROUP BY of its SELECT reads, its own expression included.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// What a `${...}` of a template literal is read as: a name nothing else spells.
export const SQL_PLACEHOLDER: string = "__SQL_PLACEHOLDER__";

type TokenKind = "word" | "quoted" | "string" | "number" | "symbol";

interface Token {
  kind: TokenKind;
  text: string;
  // For a quoted name: the quote it was written in.
  quote?: string | undefined;
}

export type AliasShadowKind =
  | "aggregate-inside-aggregate"
  | "aggregate-in-where"
  | "reads-the-alias";

export interface AliasShadow {
  alias: string;
  kind: AliasShadowKind;
  // The aliased expression, as written.
  expression: string;
  // Where the alias is read: "SELECT", "WHERE" or "PREWHERE".
  readIn: string;
}

export interface AliasSpellingColumn {
  alias: string;
  expression: string;
  // Where the name is read: "SELECT", "WHERE", "PREWHERE" or "GROUP BY".
  readIn: string;
}

/*
 * Aggregate functions, lowercased. A name with a combinator (sumIf,
 * uniqExactIf, groupArrayState, maxMerge, ...) is the aggregate before it;
 * every quantile* and median* is one.
 */
const AGGREGATES: ReadonlySet<string> = new Set<string>([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "any",
  "anylast",
  "anyheavy",
  "any_value",
  "first_value",
  "last_value",
  "argmax",
  "argmin",
  "grouparray",
  "groupuniqarray",
  "grouparrayinsertat",
  "grouparraysample",
  "grouparraylast",
  "grouparraymovingsum",
  "grouparraymovingavg",
  "groupbitand",
  "groupbitor",
  "groupbitxor",
  "groupconcat",
  "uniq",
  "uniqexact",
  "uniqcombined",
  "uniqcombined64",
  "uniqhll12",
  "uniqtheta",
  "topk",
  "topkweighted",
  "summap",
  "minmap",
  "maxmap",
  "avgweighted",
  "stddevpop",
  "stddevsamp",
  "varpop",
  "varsamp",
  "covarpop",
  "covarsamp",
  "corr",
  "entropy",
  "skewpop",
  "skewsamp",
  "kurtpop",
  "kurtsamp",
  "sumwithoverflow",
  "sumkahan",
  "histogram",
  "sequencematch",
  "sequencecount",
  "windowfunnel",
  "retention",
  "deltasum",
  "deltasumtimestamp",
  "simplelinearregression",
  "maxintersections",
  "boundingratio",
  "rankcorr",
  "exponentialmovingaverage",
  "singlevalueornull",
]);

const COMBINATORS: ReadonlyArray<string> = [
  "if",
  "array",
  "map",
  "state",
  "merge",
  "foreach",
  "distinct",
  "ordefault",
  "ornull",
  "resample",
  "simplestate",
];

export function isAggregateFunction(name: string): boolean {
  let lower: string = name.toLowerCase();

  for (let stripped: boolean = true; stripped; ) {
    if (
      AGGREGATES.has(lower) ||
      lower.startsWith("quantile") ||
      lower.startsWith("median")
    ) {
      return true;
    }

    stripped = false;

    for (const combinator of COMBINATORS) {
      if (lower.length > combinator.length && lower.endsWith(combinator)) {
        lower = lower.slice(0, lower.length - combinator.length);
        stripped = true;
        break;
      }
    }
  }

  return false;
}

// Words that are never a name a SELECT reads.
const KEYWORDS: ReadonlySet<string> = new Set<string>([
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "ILIKE",
  "BETWEEN",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "AS",
  "DISTINCT",
  "INTERVAL",
  "TRUE",
  "FALSE",
  "GLOBAL",
  "ASC",
  "DESC",
  "NULLS",
  "FIRST",
  "LAST",
  "OVER",
  "PARTITION",
  "BY",
  "ROWS",
  "RANGE",
  "UNBOUNDED",
  "PRECEDING",
  "FOLLOWING",
  "CURRENT",
  "ROW",
  "WITH",
  "TOTALS",
  "FILL",
  "TIES",
  "ALL",
  "EXISTS",
  "SECOND",
  "MINUTE",
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
  "MILLISECOND",
  "MICROSECOND",
  "NANOSECOND",
]);

// Words that start the next clause of a SELECT.
const CLAUSES: ReadonlySet<string> = new Set<string>([
  "FROM",
  "WHERE",
  "PREWHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "SETTINGS",
  "FORMAT",
  "UNION",
  "EXCEPT",
  "INTERSECT",
  "ARRAY",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "PASTE",
  "ASOF",
  "SEMI",
  "ANTI",
  "ON",
  "USING",
  "QUALIFY",
  "WINDOW",
  "SAMPLE",
  "FINAL",
  "INTO",
]);

// Clause words that are also functions: left(s, 3) is a call, LEFT JOIN a clause.
const CLAUSES_NAMING_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "LEFT",
  "RIGHT",
  "ARRAY",
  "FORMAT",
]);

// Words that start another statement: the SELECT before them has ended.
const STATEMENTS: ReadonlySet<string> = new Set<string>([
  "INSERT",
  "ALTER",
  "CREATE",
  "DELETE",
  "UPDATE",
  "DROP",
  "TRUNCATE",
  "OPTIMIZE",
  "SYSTEM",
  "SHOW",
  "DESCRIBE",
  "EXPLAIN",
  "RENAME",
  "EXCHANGE",
  "KILL",
  "GRANT",
  "REVOKE",
]);

function isWordStart(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36
  );
}

function isWordPart(code: number): boolean {
  return isWordStart(code) || (code >= 48 && code <= 57);
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

// One pass over the text: every token, comments and spaces left out.
export function tokenizeSql(sql: string): Array<Token> {
  const tokens: Array<Token> = [];
  let index: number = 0;

  while (index < sql.length) {
    const code: number = sql.charCodeAt(index);
    const next: string = sql.charAt(index + 1);

    if (isSpace(code)) {
      index++;
      continue;
    }

    // -- line comment
    if (code === 45 && next === "-") {
      const end: number = sql.indexOf("\n", index);
      index = end < 0 ? sql.length : end + 1;
      continue;
    }

    // /* block comment */
    if (code === 47 && next === "*") {
      const end: number = sql.indexOf("*/", index + 2);
      index = end < 0 ? sql.length : end + 2;
      continue;
    }

    // 'text', "name" and `name`, each with its doubled or escaped quotes.
    if (code === 39 || code === 34 || code === 96) {
      const quote: string = sql.charAt(index);
      let end: number = index + 1;
      let text: string = "";

      while (end < sql.length) {
        const character: string = sql.charAt(end);

        if (character === "\\" && end + 1 < sql.length) {
          text += sql.charAt(end + 1);
          end += 2;
          continue;
        }

        if (character === quote) {
          if (sql.charAt(end + 1) === quote) {
            text += quote;
            end += 2;
            continue;
          }

          break;
        }

        text += character;
        end++;
      }

      tokens.push(
        code === 39
          ? { kind: "string", text: text }
          : { kind: "quoted", text: text, quote: quote },
      );
      index = end + 1;
      continue;
    }

    if (isWordStart(code)) {
      let end: number = index + 1;

      while (end < sql.length && isWordPart(sql.charCodeAt(end))) {
        end++;
      }

      tokens.push({ kind: "word", text: sql.slice(index, end) });
      index = end;
      continue;
    }

    if (isDigit(code)) {
      let end: number = index + 1;

      while (
        end < sql.length &&
        (isWordPart(sql.charCodeAt(end)) || sql.charAt(end) === ".")
      ) {
        end++;
      }

      tokens.push({ kind: "number", text: sql.slice(index, end) });
      index = end;
      continue;
    }

    // Two-character symbols that matter here: a lambda's ->, a cast's ::.
    if ((code === 45 && next === ">") || (code === 58 && next === ":")) {
      tokens.push({ kind: "symbol", text: sql.slice(index, index + 2) });
      index += 2;
      continue;
    }

    tokens.push({ kind: "symbol", text: sql.charAt(index) });
    index++;
  }

  return tokens;
}

function isWord(token: Token | undefined, upper?: string): boolean {
  if (!token || token.kind !== "word") {
    return false;
  }

  return upper === undefined || token.text.toUpperCase() === upper;
}

function isSymbol(token: Token | undefined, text: string): boolean {
  return Boolean(token) && token!.kind === "symbol" && token!.text === text;
}

// For each "(" its ")", for each ")" its "(", in one pass.
function matchingParentheses(tokens: Array<Token>): Map<number, number> {
  const matches: Map<number, number> = new Map<number, number>();
  const open: Array<number> = [];

  tokens.forEach((token: Token, index: number): void => {
    if (isSymbol(token, "(")) {
      open.push(index);
    } else if (isSymbol(token, ")") && open.length > 0) {
      const start: number = open.pop()!;
      matches.set(start, index);
      matches.set(index, start);
    }
  });

  return matches;
}

interface SelectLevel {
  expressions: Array<Array<Token>>;
  clauses: Map<string, Array<Token>>;
}

/*
 * Each SELECT of the text, as its expressions and its clauses at its own
 * level. A subquery inside it is a level of its own, read where its SELECT
 * is.
 */
function selectLevels(tokens: Array<Token>): Array<SelectLevel> {
  const levels: Array<SelectLevel> = [];

  tokens.forEach((token: Token, start: number): void => {
    if (!isWord(token, "SELECT")) {
      return;
    }

    const level: SelectLevel = { expressions: [[]], clauses: new Map() };
    let clause: string | null = null;
    let depth: number = 0;

    for (let index: number = start + 1; index < tokens.length; index++) {
      const current: Token = tokens[index]!;
      const upper: string =
        current.kind === "word" ? current.text.toUpperCase() : "";

      if (isSymbol(current, "(")) {
        depth++;
      } else if (isSymbol(current, ")")) {
        if (depth === 0) {
          break;
        }

        depth--;
      } else if (depth === 0) {
        if (isSymbol(current, ";") || STATEMENTS.has(upper)) {
          break;
        }

        if (upper === "SELECT" && clause !== null) {
          break;
        }

        if (
          clause === null &&
          upper === "DISTINCT" &&
          level.expressions.length === 1 &&
          level.expressions[0]!.length === 0
        ) {
          continue;
        }

        // A function of the same name (left(), right(), array()) is not a clause.
        const isCall: boolean =
          CLAUSES_NAMING_FUNCTIONS.has(upper) &&
          isSymbol(tokens[index + 1], "(");
        // GLOBAL IN and GLOBAL NOT IN are part of a condition.
        const isGlobalIn: boolean =
          upper === "GLOBAL" &&
          (isWord(tokens[index + 1], "IN") || isWord(tokens[index + 1], "NOT"));

        if (CLAUSES.has(upper) && !isCall && !isGlobalIn) {
          clause =
            (upper === "GROUP" || upper === "ORDER") &&
            isWord(tokens[index + 1], "BY")
              ? `${upper} BY`
              : upper;

          if (clause.endsWith(" BY")) {
            index++;
          }

          if (!level.clauses.has(clause)) {
            level.clauses.set(clause, []);
          }

          continue;
        }

        if (clause === null && isSymbol(current, ",")) {
          level.expressions.push([]);
          continue;
        }
      }

      if (clause === null) {
        level.expressions[level.expressions.length - 1]!.push(current);
      } else {
        level.clauses.get(clause)!.push(current);
      }
    }

    levels.push(level);
  });

  return levels;
}

interface NameRead {
  name: string;
  insideAggregate: boolean;
}

// The names a run of tokens reads: not functions, keywords, types, qualified parts, lambda parameters or subqueries.
function namesRead(tokens: Array<Token>): Array<NameRead> {
  const matches: Map<number, number> = matchingParentheses(tokens);
  const lambdaParameters: Set<string> = new Set<string>();

  tokens.forEach((token: Token, index: number): void => {
    if (!isSymbol(token, "->")) {
      return;
    }

    const before: Token | undefined = tokens[index - 1];

    if (before && (before.kind === "word" || before.kind === "quoted")) {
      lambdaParameters.add(before.text);
    } else if (isSymbol(before, ")") && matches.has(index - 1)) {
      for (
        let parameter: number = matches.get(index - 1)! + 1;
        parameter < index - 1;
        parameter++
      ) {
        const candidate: Token = tokens[parameter]!;

        if (candidate.kind === "word" || candidate.kind === "quoted") {
          lambdaParameters.add(candidate.text);
        }
      }
    }
  });

  const reads: Array<NameRead> = [];
  // For each open "(": whether the call it opens is an aggregate's.
  const aggregateStack: Array<boolean> = [];
  let previousGroupWasAggregate: boolean = false;

  for (let index: number = 0; index < tokens.length; index++) {
    const token: Token = tokens[index]!;
    const previous: Token | undefined = tokens[index - 1];
    const next: Token | undefined = tokens[index + 1];

    if (isSymbol(token, "(")) {
      const close: number | undefined = matches.get(index);

      // A subquery: its names are its own level's.
      if (
        close !== undefined &&
        (isWord(next, "SELECT") || isWord(next, "WITH"))
      ) {
        index = close;
        previousGroupWasAggregate = false;
        continue;
      }

      const followedByOver: boolean =
        close !== undefined && isWord(tokens[close + 1], "OVER");
      const callsAggregate: boolean =
        previous !== undefined &&
        previous.kind === "word" &&
        isAggregateFunction(previous.text);
      // quantile(0.5)(value): the second group belongs to the same call.
      const parametricArguments: boolean =
        isSymbol(previous, ")") && previousGroupWasAggregate;

      aggregateStack.push(
        !followedByOver && (callsAggregate || parametricArguments),
      );
      previousGroupWasAggregate = false;
      continue;
    }

    if (isSymbol(token, ")")) {
      previousGroupWasAggregate = aggregateStack.pop() || false;
      continue;
    }

    previousGroupWasAggregate = false;

    if (token.kind !== "word" && token.kind !== "quoted") {
      continue;
    }

    if (
      token.text === SQL_PLACEHOLDER ||
      lambdaParameters.has(token.text) ||
      (token.kind === "word" && KEYWORDS.has(token.text.toUpperCase())) ||
      isSymbol(next, "(") ||
      isSymbol(next, ".") ||
      isSymbol(previous, ".") ||
      isSymbol(previous, "::") ||
      isWord(previous, "AS")
    ) {
      continue;
    }

    reads.push({
      name: token.text,
      insideAggregate: aggregateStack.some((aggregate: boolean): boolean => {
        return aggregate;
      }),
    });
  }

  return reads;
}

function callsAnAggregate(tokens: Array<Token>): boolean {
  const matches: Map<number, number> = matchingParentheses(tokens);

  return tokens.some((token: Token, index: number): boolean => {
    if (!isSymbol(tokens[index + 1], "(") || token.kind !== "word") {
      return false;
    }

    const close: number | undefined = matches.get(index + 1);

    return (
      isAggregateFunction(token.text) &&
      !(close !== undefined && isWord(tokens[close + 1], "OVER"))
    );
  });
}

interface AliasedExpression {
  alias: string;
  body: Array<Token>;
  text: string;
}

// `expression AS alias`; an alias that only repeats its column (`x AS x`, `t.x AS x`) is none.
function aliasedExpression(tokens: Array<Token>): AliasedExpression | null {
  const alias: Token | undefined = tokens[tokens.length - 1];

  if (
    tokens.length < 3 ||
    !isWord(tokens[tokens.length - 2], "AS") ||
    !alias ||
    (alias.kind !== "word" && alias.kind !== "quoted") ||
    alias.text === SQL_PLACEHOLDER
  ) {
    return null;
  }

  const body: Array<Token> = tokens.slice(0, -2);
  const last: Token = body[body.length - 1]!;
  const repeatsColumn: boolean =
    (body.length === 1 || (body.length === 3 && isSymbol(body[1], "."))) &&
    (last.kind === "word" || last.kind === "quoted") &&
    last.text === alias.text;

  if (repeatsColumn) {
    return null;
  }

  return {
    alias: alias.text,
    body: body,
    text: body
      .map((token: Token): string => {
        return token.text;
      })
      .join(" "),
  };
}

export function findAliasShadows(sql: string): Array<AliasShadow> {
  const shadows: Array<AliasShadow> = [];

  for (const level of selectLevels(tokenizeSql(sql))) {
    const aliased: Array<AliasedExpression | null> = level.expressions.map(
      (expression: Array<Token>): AliasedExpression | null => {
        return aliasedExpression(expression);
      },
    );

    aliased.forEach(
      (expression: AliasedExpression | null, position: number): void => {
        // Only an alias that spells a column: its own expression reads the name.
        if (
          !expression ||
          !namesRead(expression.body).some((read: NameRead): boolean => {
            return read.name === expression.alias;
          })
        ) {
          return;
        }

        const isAggregate: boolean = callsAnAggregate(expression.body);

        level.expressions.forEach(
          (other: Array<Token>, otherPosition: number): void => {
            if (otherPosition === position) {
              return;
            }

            for (const read of namesRead(other)) {
              if (read.name !== expression.alias) {
                continue;
              }

              if (isAggregate && read.insideAggregate) {
                shadows.push({
                  alias: expression.alias,
                  kind: "aggregate-inside-aggregate",
                  expression: expression.text,
                  readIn: "SELECT",
                });
              } else if (!isAggregate) {
                shadows.push({
                  alias: expression.alias,
                  kind: "reads-the-alias",
                  expression: expression.text,
                  readIn: "SELECT",
                });
              }
            }
          },
        );

        for (const clause of ["WHERE", "PREWHERE"]) {
          for (const read of namesRead(level.clauses.get(clause) || [])) {
            if (read.name === expression.alias) {
              shadows.push({
                alias: expression.alias,
                kind: isAggregate ? "aggregate-in-where" : "reads-the-alias",
                expression: expression.text,
                readIn: clause,
              });
            }
          }
        }
      },
    );
  }

  return shadows;
}

/*
 * The strict rule: every alias that is a name its SELECT reads - in any
 * expression, its own included, or in WHERE, PREWHERE or GROUP BY. HAVING,
 * ORDER BY and LIMIT BY read aliases by design and are not looked at.
 */
export function findAliasesSpellingColumns(
  sql: string,
): Array<AliasSpellingColumn> {
  const found: Array<AliasSpellingColumn> = [];

  for (const level of selectLevels(tokenizeSql(sql))) {
    const reads: Array<{ name: string; readIn: string }> = [];

    for (const expression of level.expressions) {
      const aliased: AliasedExpression | null = aliasedExpression(expression);

      for (const read of namesRead(aliased ? aliased.body : expression)) {
        reads.push({ name: read.name, readIn: "SELECT" });
      }
    }

    for (const clause of ["WHERE", "PREWHERE", "GROUP BY"]) {
      for (const read of namesRead(level.clauses.get(clause) || [])) {
        reads.push({ name: read.name, readIn: clause });
      }
    }

    for (const expression of level.expressions) {
      const aliased: AliasedExpression | null = aliasedExpression(expression);

      if (!aliased) {
        continue;
      }

      const read: { name: string; readIn: string } | undefined = reads.find(
        (candidate: { name: string; readIn: string }): boolean => {
          return candidate.name === aliased.alias;
        },
      );

      if (read) {
        found.push({
          alias: aliased.alias,
          expression: aliased.text,
          readIn: read.readIn,
        });
      }
    }
  }

  return found;
}

// How many SELECTs a text holds: what a scan read, for its checks that it read anything.
export function countSelects(sql: string): number {
  return selectLevels(tokenizeSql(sql)).length;
}

/*
 * Whether a text is Postgres SQL, whose SELECT aliases are not visible to
 * its WHERE or its other expressions: it names a column in double quotes
 * ("_id") or takes a positional parameter ($1), as OneUptime's Postgres SQL
 * does and its ClickHouse SQL never does.
 */
export function isPostgresSql(sql: string): boolean {
  return tokenizeSql(sql).some((token: Token): boolean => {
    if (token.kind === "quoted") {
      return token.quote === '"';
    }

    return (
      token.kind === "word" &&
      token.text.length > 1 &&
      token.text.startsWith("$") &&
      isDigit(token.text.charCodeAt(1))
    );
  });
}

export interface SqlText {
  // The file's path from the repository's root.
  file: string;
  line: number;
  text: string;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span: ts.TemplateSpan): string => {
        return ` ${SQL_PLACEHOLDER} ${span.literal.text}`;
      }),
    ].join("");
  }

  return null;
}

/*
 * What a source file says in SQL: each string or template literal that
 * holds a SELECT, and - since a statement is often appended in pieces (the
 * SELECT list in one literal, its WHERE in the next) - the literals of each
 * function body joined in order. A `${...}` is read as SQL_PLACEHOLDER.
 */
export function sqlTextsOf(file: string, sourceText: string): Array<SqlText> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const texts: Array<SqlText> = [];
  const byFunction: Map<
    ts.Node,
    Array<{ line: number; text: string }>
  > = new Map<ts.Node, Array<{ line: number; text: string }>>();

  const visit: (node: ts.Node, owner: ts.Node) => void = (
    node: ts.Node,
    owner: ts.Node,
  ): void => {
    const text: string | null = literalText(node);

    if (text !== null) {
      const line: number =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

      if (!byFunction.has(owner)) {
        byFunction.set(owner, []);
      }

      byFunction.get(owner)!.push({ line, text });

      // A template's own spans are read as part of it.
      if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) {
          visit(span.expression, owner);
        }
      }

      return;
    }

    const nextOwner: ts.Node =
      ts.isFunctionLike(node) && "body" in node && node.body ? node : owner;

    ts.forEachChild(node, (child: ts.Node): void => {
      visit(child, nextOwner);
    });
  };

  visit(source, source);

  for (const literals of byFunction.values()) {
    for (const literal of literals) {
      if (countSelects(literal.text) > 0) {
        texts.push({ file, line: literal.line, text: literal.text });
      }
    }

    if (literals.length > 1) {
      const joined: string = literals
        .map((literal: { line: number; text: string }): string => {
          return literal.text;
        })
        .join(" ");

      if (countSelects(joined) > 0) {
        texts.push({ file, line: literals[0]!.line, text: joined });
      }
    }
  }

  return texts;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

/*
 * The server code that builds ClickHouse SQL, by path from the repository's
 * root: every .ts file under `roots` but tests, frontends and declarations.
 */
export function listServerSourceFiles(
  roots: ReadonlyArray<string>,
  skippedFolders: ReadonlySet<string>,
): Array<string> {
  const files: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        SKIPPED_FOLDER_NAMES.has(entry.name) ||
        skippedFolders.has(entry.name)
      ) {
        continue;
      }

      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (
        entry.isFile() &&
        SOURCE_FILE.test(entry.name) &&
        !DECLARATION_FILE.test(entry.name) &&
        !entry.name.includes(".test.")
      ) {
        files.push(
          path
            .relative(REPOSITORY_DIRECTORY, fullPath)
            .split(path.sep)
            .join("/"),
        );
      }
    }
  };

  for (const root of roots) {
    const directory: string = path.join(REPOSITORY_DIRECTORY, root);

    if (fs.existsSync(directory)) {
      walk(directory);
    }
  }

  return files.sort();
}
