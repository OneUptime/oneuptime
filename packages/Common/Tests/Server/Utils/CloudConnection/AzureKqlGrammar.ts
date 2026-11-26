import "@kusto/language-service-next/bridge.min.js";
import "@kusto/language-service-next/Kusto.Language.Bridge.min.js";

/*
 * THE QUERIES AN AZURE CONNECTION SENDS, READ BY MICROSOFT'S OWN PARSER
 * (#11142).
 *
 * Kusto.Language is the parser and binder of the Kusto Query Language that
 * Microsoft maintains and ships to Azure Data Explorer's editors and to
 * monaco-kusto; @kusto/language-service-next is its JavaScript build,
 * published by Microsoft. It is loaded here, in the tests only: the two
 * imports above put Bridge.NET's runtime and Kusto.Language on the global
 * object, as the package's own pages load them.
 *
 * A query is read three ways:
 *
 *   - kqlSyntaxProblems: what the grammar refuses. The subnet query that
 *     shipped in 16.0.0 put mv-expand's `limit` before what it expands, and
 *     the parser refuses it on line 3, as Resource Graph did.
 *   - resourceGraphProblems: that, and what binding the query against
 *     Resource Graph's Resources table finds (a column or function it does
 *     not have, a type that does not fit), and what Resource Graph's query
 *     language page documents beyond KQL: only its tabular operators, at
 *     most three mv-expand and three join or union in one query, and an
 *     mv-expand row limit of at most 2,000 - which every mv-expand here must
 *     state, since Resource Graph's default of 128 cuts a longer list short
 *     without saying so.
 *   - logAnalyticsProblems: the syntax, and binding against a workspace's
 *     tables, for the live read's Log Analytics query.
 *
 * Positions are said as Resource Graph says them in a ParserFailure: the
 * line from 1, the character within the line from 0. Kusto.Language and
 * Resource Graph's own front end may point at different characters of the
 * same mistake; both name its line.
 *
 * What none of this runs is Azure itself: Resource Graph's service-side
 * parser and its subset of KQL's scalar functions (which its page does not
 * list) are not exercised here. Each function the queries call is one
 * Resource Graph's own sample queries call.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// The parts of Kusto.Language read here, as its Bridge.NET build has them.
interface KustoList<ItemType> {
  Count: number;
  getItem(index: number): ItemType;
}

interface KustoDiagnostic {
  Code: string;
  Severity: string;
  Message: string;
  Start: number;
  Length: number;
}

interface KustoElement {
  Kind: number;
  ChildCount: number;
  TextStart: number;
  Width: number;
  IsToken: boolean;
  GetChild(index: number): KustoElement | null;
  // A literal expression's value, read back out of its text.
  LiteralValue?: unknown;
  // An mv-expand's `limit` clause, and the clause's number.
  RowLimitClause?: KustoElement | null;
  RowLimit?: KustoElement | null;
}

interface KustoCode {
  Syntax: KustoElement;
  GetDiagnostics(): KustoList<KustoDiagnostic>;
}

interface KustoSymbol {
  WithName(name: string): KustoSymbol;
}

interface KustoGlobals {
  WithDatabase(database: unknown): KustoGlobals;
}

interface KustoLanguage {
  KustoCode: {
    Parse(text: string): KustoCode;
    ParseAndAnalyze(text: string, globals: KustoGlobals): KustoCode;
  };
  KustoFacts: {
    GetStringLiteralValue(literal: string): string;
    GetSingleQuotedStringLiteral(text: string): string;
  };
  GlobalState: { Default: KustoGlobals };
  Symbols: {
    TableSymbol: { From(schema: string): KustoSymbol };
    DatabaseSymbol: {
      ctor: new (name: string, members: Array<KustoSymbol>) => unknown;
    };
  };
  Syntax: { SyntaxKind: Record<string, number | unknown> };
}

const KUSTO: KustoLanguage = (
  globalThis as unknown as { Kusto: { Language: KustoLanguage } }
).Kusto.Language;

// Each syntax kind's name, by its number.
const KIND_NAMES: Map<number, string> = new Map<number, string>();

for (const [name, value] of Object.entries(KUSTO.Syntax.SyntaxKind)) {
  if (typeof value === "number") {
    KIND_NAMES.set(value, name);
  }
}

export function kindName(element: KustoElement): string {
  return KIND_NAMES.get(element.Kind) || `SyntaxKind ${element.Kind}`;
}

/*
 * Resource Graph's Resources table: the columns of the rows Microsoft's
 * "Explore your Azure resources" shows (id, kind, location, managedBy,
 * name, plan, properties, resourceGroup, sku, subscriptionId, tags, type),
 * with tenantId, identity, zones and extendedLocation, which its schema
 * lists besides. Each name is bracketed: `kind` is a keyword of a schema.
 */
const RESOURCES_COLUMNS: ReadonlyArray<[string, string]> = [
  ["id", "string"],
  ["name", "string"],
  ["type", "string"],
  ["tenantId", "string"],
  ["kind", "string"],
  ["location", "string"],
  ["resourceGroup", "string"],
  ["subscriptionId", "string"],
  ["managedBy", "string"],
  ["sku", "dynamic"],
  ["plan", "dynamic"],
  ["properties", "dynamic"],
  ["tags", "dynamic"],
  ["identity", "dynamic"],
  ["zones", "dynamic"],
  ["extendedLocation", "dynamic"],
];

/*
 * A Log Analytics workspace, as a resource's logs reach it: tables of
 * their own, each with its TimeGenerated.
 */
const WORKSPACE_TABLES: ReadonlyArray<[string, ReadonlyArray<[string, string]>]> =
  [
    [
      "AzureDiagnostics",
      [
        ["TimeGenerated", "datetime"],
        ["Category", "string"],
        ["ResultDescription", "string"],
        ["ResourceId", "string"],
      ],
    ],
    [
      "AzureActivity",
      [
        ["TimeGenerated", "datetime"],
        ["OperationNameValue", "string"],
        ["ActivityStatusValue", "string"],
        ["ResourceId", "string"],
      ],
    ],
  ];

function tableSymbol(
  name: string,
  columns: ReadonlyArray<[string, string]>,
): KustoSymbol {
  return KUSTO.Symbols.TableSymbol.From(
    `(${columns
      .map(([column, type]: [string, string]): string => {
        return `['${column}']:${type}`;
      })
      .join(", ")})`,
  ).WithName(name);
}

const RESOURCE_GRAPH_GLOBALS: KustoGlobals =
  KUSTO.GlobalState.Default.WithDatabase(
    new KUSTO.Symbols.DatabaseSymbol.ctor("ResourceGraph", [
      tableSymbol("Resources", RESOURCES_COLUMNS),
    ]),
  );

const LOG_ANALYTICS_GLOBALS: KustoGlobals =
  KUSTO.GlobalState.Default.WithDatabase(
    new KUSTO.Symbols.DatabaseSymbol.ctor(
      "Workspace",
      WORKSPACE_TABLES.map(
        ([name, columns]: [
          string,
          ReadonlyArray<[string, string]>,
        ]): KustoSymbol => {
          return tableSymbol(name, columns);
        },
      ),
    ),
  );

/*
 * Resource Graph's tabular operators, by the syntax kind each parses to:
 * "Supported tabular/top level operators" on Resource Graph's query
 * language page. `limit` and `take` are one operator, as are `order` and
 * `sort`, and `mvexpand` and `mv-expand`.
 */
export const RESOURCE_GRAPH_OPERATORS: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["CountOperator", "count"],
  ["DistinctOperator", "distinct"],
  ["ExtendOperator", "extend"],
  ["JoinOperator", "join"],
  ["TakeOperator", "limit"],
  ["MvExpandOperator", "mv-expand"],
  ["SortOperator", "order"],
  ["ParseOperator", "parse"],
  ["ProjectOperator", "project"],
  ["ProjectAwayOperator", "project-away"],
  ["SummarizeOperator", "summarize"],
  ["TopOperator", "top"],
  ["UnionOperator", "union"],
  ["FilterOperator", "where"],
]);

// The most rows one mv-expand may make of a row in Resource Graph; 128 unless the query says.
export const RESOURCE_GRAPH_MAX_MV_EXPAND_ROW_LIMIT: number = 2000;
// mv-expand operators, and join and union operators counted together, one query may hold.
export const RESOURCE_GRAPH_MAX_MV_EXPANDS: number = 3;
export const RESOURCE_GRAPH_MAX_JOINS_AND_UNIONS: number = 3;

// A position as Resource Graph says one: "line 3, character 18".
export function positionOf(text: string, offset: number): string {
  const before: Array<string> = text.slice(0, offset).split("\n");

  return `line ${before.length}, character ${before[before.length - 1]!.length}`;
}

function listOf<ItemType>(list: KustoList<ItemType>): Array<ItemType> {
  const items: Array<ItemType> = [];

  for (let index: number = 0; index < list.Count; index++) {
    items.push(list.getItem(index));
  }

  return items;
}

function errorsOf(code: KustoCode, text: string): Array<string> {
  return listOf(code.GetDiagnostics())
    .filter((diagnostic: KustoDiagnostic): boolean => {
      return diagnostic.Severity === "Error";
    })
    .map((diagnostic: KustoDiagnostic): string => {
      return `${positionOf(text, diagnostic.Start)}: ${diagnostic.Message} (${diagnostic.Code})`;
    });
}

// Every element of a syntax tree, the root first, each before its children.
export function elementsOf(root: KustoElement): Array<KustoElement> {
  const elements: Array<KustoElement> = [];
  const pending: Array<KustoElement> = [root];

  while (pending.length > 0) {
    const element: KustoElement = pending.pop()!;
    elements.push(element);

    for (let index: number = element.ChildCount - 1; index >= 0; index--) {
      const child: KustoElement | null = element.GetChild(index);

      if (child) {
        pending.push(child);
      }
    }
  }

  return elements;
}

export function parseKql(text: string): KustoCode {
  return KUSTO.KustoCode.Parse(text);
}

// What KQL's grammar refuses in the text: nothing for a query that parses.
export function kqlSyntaxProblems(text: string): Array<string> {
  return errorsOf(parseKql(text), text);
}

// What Resource Graph's documented limits refuse in a query that parses.
function resourceGraphRuleProblems(text: string): Array<string> {
  const problems: Array<string> = [];
  let mvExpands: number = 0;
  let joinsAndUnions: number = 0;

  for (const element of elementsOf(parseKql(text).Syntax)) {
    const kind: string = kindName(element);
    const at: string = positionOf(text, element.TextStart);

    if (kind.endsWith("Statement") && kind !== "ExpressionStatement") {
      problems.push(`${at}: Resource Graph runs one query, not a ${kind}.`);
    }

    if (!kind.endsWith("Operator")) {
      continue;
    }

    if (!RESOURCE_GRAPH_OPERATORS.has(kind)) {
      problems.push(
        `${at}: ${kind} is not one of Resource Graph's tabular operators.`,
      );
      continue;
    }

    if (kind === "JoinOperator" || kind === "UnionOperator") {
      joinsAndUnions++;
    }

    if (kind !== "MvExpandOperator") {
      continue;
    }

    mvExpands++;

    const limit: KustoElement | null | undefined =
      element.RowLimitClause?.RowLimit;
    // A long literal's value is Bridge.NET's System.Int64, which writes itself as its digits.
    const rows: number =
      limit && kindName(limit) === "LongLiteralExpression"
        ? Number(String(limit.LiteralValue))
        : NaN;

    if (!limit) {
      problems.push(
        `${at}: mv-expand states no row limit, and Resource Graph expands 128 rows of a row unless it does.`,
      );
    } else if (
      !Number.isInteger(rows) ||
      rows < 1 ||
      rows > RESOURCE_GRAPH_MAX_MV_EXPAND_ROW_LIMIT
    ) {
      problems.push(
        `${at}: mv-expand's row limit is ${String(rows)}; Resource Graph takes a whole number up to ${RESOURCE_GRAPH_MAX_MV_EXPAND_ROW_LIMIT}.`,
      );
    }
  }

  if (mvExpands > RESOURCE_GRAPH_MAX_MV_EXPANDS) {
    problems.push(
      `The query holds ${mvExpands} mv-expand; Resource Graph runs ${RESOURCE_GRAPH_MAX_MV_EXPANDS} at most.`,
    );
  }

  if (joinsAndUnions > RESOURCE_GRAPH_MAX_JOINS_AND_UNIONS) {
    problems.push(
      `The query holds ${joinsAndUnions} join and union; Resource Graph runs ${RESOURCE_GRAPH_MAX_JOINS_AND_UNIONS} at most.`,
    );
  }

  return problems;
}

/*
 * Everything Microsoft's parser and Resource Graph's page would refuse in a
 * Resource Graph query: nothing for one Resource Graph runs.
 */
export function resourceGraphProblems(text: string): Array<string> {
  const syntax: Array<string> = kqlSyntaxProblems(text);

  if (syntax.length > 0) {
    return syntax;
  }

  return [
    ...errorsOf(
      KUSTO.KustoCode.ParseAndAnalyze(text, RESOURCE_GRAPH_GLOBALS),
      text,
    ),
    ...resourceGraphRuleProblems(text),
  ];
}

// What the grammar, and binding against a workspace's tables, refuse in a Log Analytics query.
export function logAnalyticsProblems(text: string): Array<string> {
  const syntax: Array<string> = kqlSyntaxProblems(text);

  if (syntax.length > 0) {
    return syntax;
  }

  return errorsOf(
    KUSTO.KustoCode.ParseAndAnalyze(text, LOG_ANALYTICS_GLOBALS),
    text,
  );
}

// The operators of a query, in order, by the names Resource Graph's page gives them.
export function operatorsOf(text: string): Array<string> {
  return elementsOf(parseKql(text).Syntax)
    .map(kindName)
    .filter((kind: string): boolean => {
      return kind.endsWith("Operator");
    })
    .map((kind: string): string => {
      return RESOURCE_GRAPH_OPERATORS.get(kind) || kind;
    });
}

// The value of every string literal of a query, as Kusto reads it back.
export function stringLiteralValuesOf(text: string): Array<string> {
  return elementsOf(parseKql(text).Syntax)
    .filter((element: KustoElement): boolean => {
      return kindName(element) === "StringLiteralExpression";
    })
    .map((element: KustoElement): string => {
      return String(element.LiteralValue);
    });
}

/*
 * The shape of a query: the kind of every node and token, a literal's text
 * left out. A value placed as a literal leaves it as it was, whatever the
 * value holds; a value that ended its literal and became query text would
 * not.
 */
export function shapeOf(text: string): string {
  return elementsOf(parseKql(text).Syntax)
    .map(kindName)
    .join(" ");
}

// Microsoft's own reading of a literal's value, and its own single-quoted literal of a text.
export function kustoLiteralValue(literal: string): string {
  return KUSTO.KustoFacts.GetStringLiteralValue(literal);
}

export function kustoSingleQuotedLiteral(text: string): string {
  return KUSTO.KustoFacts.GetSingleQuotedStringLiteral(text);
}
