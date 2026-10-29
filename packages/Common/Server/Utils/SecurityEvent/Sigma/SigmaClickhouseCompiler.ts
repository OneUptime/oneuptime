import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONValue } from "../../../../Types/JSON";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import SigmaRule, {
  SigmaConditionNode,
  SigmaFieldRequirement,
  SigmaSelection,
} from "../../../../Types/SecurityEvent/SigmaRule";
import {
  SigmaWatchlist,
  SigmaWatchlists,
  getMissingSecurityWatchlistsMessage,
  readSecurityWatchlistPlaceholder,
} from "../../../../Types/SecurityEvent/SecurityWatchlist";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import {
  getSigmaWatchlistKey,
  isSigmaWatchlistRequirement,
} from "../../../../Utils/SecurityEvent/Sigma/SigmaWatchlists";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import { buildIpInRangeExpression } from "../SecurityValueMatch";
import {
  buildWatchlistArrayMatch,
  buildWatchlistTextMatch,
} from "../Watchlists/SecurityWatchlistMatch";

/*
 * Where the address-range check lives now (SecurityValueMatch, shared with
 * rule exceptions and watchlists), still importable from here.
 */
export { buildIpInRangeExpression };

/*
 * Sigma rule -> ClickHouse boolean expression over the SecurityEvent
 * table.
 *
 * Every user-controlled value is bound as a typed query parameter through
 * Statement — nothing from the rule is ever concatenated into SQL text.
 * Column references come exclusively from the fixed maps below, so a
 * hostile field name can at worst address an attributes[] key.
 *
 * Sigma matching is case-insensitive by default (ILIKE); the `cased`
 * modifier switches to exact matching. Sigma wildcards (* ?) translate to
 * LIKE wildcards (% _), with LIKE metacharacters in literal text escaped.
 */

const TEXT_COLUMNS: Set<string> = new Set<string>([
  "eventUid",
  "categoryName",
  "className",
  "activityName",
  "severityName",
  "statusName",
  "message",
  "vendorName",
  "productName",
  "ruleId",
  "ruleName",
  "principalUser",
  "principalHost",
  "principalIp",
  "principalProcess",
  "processName",
  "processPath",
  "processCommandLine",
  "parentProcessName",
  "parentProcessPath",
  "parentProcessCommandLine",
  "targetUser",
  "targetHost",
  "targetIp",
  "targetResource",
  // The request the event happened in, and how far it got.
  "traceId",
  "spanId",
  "sessionId",
  "requestOutcome",
]);

const NUMBER_COLUMNS: Set<string> = new Set<string>([
  "categoryUid",
  "classUid",
  "severityId",
  "targetPort",
]);

const ARRAY_COLUMNS: Set<string> = new Set<string>([
  "mitreTactics",
  "mitreTechniques",
  "observables",
]);

/*
 * Common Sigma field spellings -> SecurityEvent columns. Lowercased keys.
 * Anything that resolves to none of these becomes an attributes[] lookup
 * under its original spelling — which is exactly the flattened source
 * payload key, so rules written against raw UDM/OCSF field paths work.
 *
 * Image and CommandLine are the process the event is about - the one that
 * was started, in a process creation event - and ParentImage and
 * ParentCommandLine the process that started it, as Sysmon, ECS and UDM
 * all define them. principalProcess, the acting process, is never one of
 * them: in a process creation event the actor is the parent.
 */
export const FIELD_ALIASES: Record<string, string> = {
  user: "principalUser",
  username: "principalUser",
  "user.name": "principalUser",
  targetuser: "targetUser",
  target_user: "targetUser",
  host: "principalHost",
  hostname: "principalHost",
  computer: "principalHost",
  computername: "principalHost",
  "host.name": "principalHost",
  targethost: "targetHost",
  target_host: "targetHost",
  src_ip: "principalIp",
  source_ip: "principalIp",
  sourceip: "principalIp",
  sourceaddress: "principalIp",
  "source.ip": "principalIp",
  dst_ip: "targetIp",
  destination_ip: "targetIp",
  destinationip: "targetIp",
  destinationaddress: "targetIp",
  "destination.ip": "targetIp",
  target_ip: "targetIp",
  dst_port: "targetPort",
  destination_port: "targetPort",
  destinationport: "targetPort",
  target_port: "targetPort",
  commandline: "processCommandLine",
  command_line: "processCommandLine",
  cmdline: "processCommandLine",
  processcommandline: "processCommandLine",
  "process.command_line": "processCommandLine",
  image: "processPath",
  "process.executable": "processPath",
  parentimage: "parentProcessPath",
  "process.parent.executable": "parentProcessPath",
  parentcommandline: "parentProcessCommandLine",
  "process.parent.command_line": "parentProcessCommandLine",
  msg: "message",
  trace_id: "traceId",
  span_id: "spanId",
  session_id: "sessionId",
  request_outcome: "requestOutcome",
};

type ResolvedField =
  | { kind: "textColumn"; column: string }
  | { kind: "numberColumn"; column: string }
  | { kind: "arrayColumn"; column: string }
  | { kind: "attribute"; attributeKey: string };

export function resolveSigmaField(field: string): ResolvedField {
  const lowered: string = field.toLowerCase();

  const aliased: string | undefined = FIELD_ALIASES[lowered];
  const canonical: string | undefined =
    aliased ||
    [...TEXT_COLUMNS, ...NUMBER_COLUMNS, ...ARRAY_COLUMNS].find(
      (column: string): boolean => {
        return column.toLowerCase() === lowered;
      },
    );

  if (canonical) {
    if (NUMBER_COLUMNS.has(canonical)) {
      return { kind: "numberColumn", column: canonical };
    }
    if (ARRAY_COLUMNS.has(canonical)) {
      return { kind: "arrayColumn", column: canonical };
    }
    return { kind: "textColumn", column: canonical };
  }

  return { kind: "attribute", attributeKey: field };
}

/*
 * Sigma pattern -> LIKE pattern. Sigma: `*` any run, `?` one char, `\`
 * escapes. LIKE: `%` any run, `_` one char, `\` escapes.
 */
export function sigmaPatternToLike(value: string): {
  pattern: string;
  hasWildcard: boolean;
} {
  let pattern: string = "";
  let hasWildcard: boolean = false;
  let index: number = 0;

  while (index < value.length) {
    const char: string = value[index]!;

    if (char === "\\" && index + 1 < value.length) {
      const next: string = value[index + 1]!;
      // Escaped sigma wildcard or backslash -> literal char, LIKE-escaped.
      pattern += escapeLikeLiteral(next);
      index += 2;
      continue;
    }

    if (char === "*") {
      pattern += "%";
      hasWildcard = true;
    } else if (char === "?") {
      pattern += "_";
      hasWildcard = true;
    } else {
      pattern += escapeLikeLiteral(char);
    }

    index++;
  }

  return { pattern, hasWildcard };
}

function escapeLikeLiteral(char: string): string {
  if (char === "%" || char === "_" || char === "\\") {
    return `\\${char}`;
  }

  return char;
}

function textParam(value: string): Statement {
  return SQL`${{ type: TableColumnType.Text, value: value }}`;
}

/*
 * Numeric literals bind as Decimal (ClickHouse `Double`) rather than Number
 * (`Int32`). Sigma rules routinely carry fractional thresholds — a
 * `|gte: 0.5` on an attribute compiles to a toFloat64OrNull comparison, and
 * an Int32 bind cannot parse `0.5`, failing the whole query at runtime.
 * Double represents every Int32 exactly, so the integer cases (port numbers,
 * severity ids, `1 of them` quantifiers) are unaffected.
 */
function numberParam(value: number): Statement {
  return SQL`${{ type: TableColumnType.Decimal, value: value }}`;
}

function group(inner: Statement): Statement {
  const statement: Statement = SQL`(`;
  statement.append(inner);
  statement.append(")");
  return statement;
}

function joinStatements(parts: Array<Statement>, separator: string): Statement {
  const statement: Statement = new Statement();

  parts.forEach((part: Statement, index: number): void => {
    if (index > 0) {
      statement.append(separator);
    }
    statement.append(group(part));
  });

  return statement;
}

/*
 * SQL expression for one Sigma field reference — a bare column for the
 * fixed column sets, an attributes[] lookup otherwise. Used by the
 * detection engine to build GROUP BY expressions from a rule's
 * groupByField.
 */
export function buildSigmaFieldExpression(field: string): Statement {
  const resolved: ResolvedField = resolveSigmaField(field);

  if (resolved.kind === "attribute") {
    const statement: Statement = SQL`attributes[`;
    statement.append(textParam(resolved.attributeKey));
    statement.append("]");
    return statement;
  }

  if (resolved.kind === "numberColumn") {
    return new Statement([`toString(${resolved.column})`], []);
  }

  if (resolved.kind === "arrayColumn") {
    return new Statement([`arrayStringConcat(${resolved.column}, ',')`], []);
  }

  return new Statement([resolved.column], []);
}

/*
 * buildSigmaFieldExpression with the column's "unset" sentinel normalized
 * away, for distinct counting. Text and attribute lookups yield '' when
 * absent, which the caller's nullIf(expr, '') already excludes — but the
 * number columns are non-Nullable with 0 as their documented
 * not-applicable value, and toString(0) is '0', not ''. Mapping 0 to NULL
 * here, where the column type is known, keeps a portless event from
 * counting as distinct port "0" in a port-scan rule. severityId 0 (OCSF
 * Unknown) is deliberately treated as missing too, consistent with the
 * empty-string rule for text.
 */
export function buildSigmaDistinctCountExpression(field: string): Statement {
  const resolved: ResolvedField = resolveSigmaField(field);

  if (resolved.kind === "numberColumn") {
    return new Statement([`toString(nullIf(${resolved.column}, 0))`], []);
  }

  return buildSigmaFieldExpression(field);
}

export default class SigmaClickhouseCompiler {
  /*
   * Compile a rule (or raw YAML) into a boolean SQL expression. The
   * result is a fragment — the caller wraps it with projectId and time
   * window predicates.
   */
  public static compileYaml(ruleYaml: string): Statement {
    return this.compile(SigmaRuleParser.parse(ruleYaml));
  }

  /*
   * A rule that reads watchlists (`field|expand: '%vip_users%'`) compiles
   * only with them bound (SigmaRule.watchlists, bindSigmaWatchlists): the
   * project holds the lists, and the server reads them first.
   */
  public static compile(rule: SigmaRule): Statement {
    return this.compileConditionNode(
      rule.condition,
      rule.selections,
      rule.watchlists || {},
    );
  }

  private static compileConditionNode(
    node: SigmaConditionNode,
    selections: Array<SigmaSelection>,
    watchlists: SigmaWatchlists,
  ): Statement {
    switch (node.kind) {
      case "selection": {
        const selection: SigmaSelection | undefined = selections.find(
          (candidate: SigmaSelection): boolean => {
            return candidate.name === node.name;
          },
        );

        if (!selection) {
          throw new BadDataException(
            `Sigma compiler: unknown selection "${node.name}".`,
          );
        }

        return group(this.compileSelection(selection, watchlists));
      }

      case "and": {
        return joinStatements(
          node.children.map((child: SigmaConditionNode): Statement => {
            return this.compileConditionNode(child, selections, watchlists);
          }),
          " AND ",
        );
      }

      case "or": {
        return joinStatements(
          node.children.map((child: SigmaConditionNode): Statement => {
            return this.compileConditionNode(child, selections, watchlists);
          }),
          " OR ",
        );
      }

      case "not": {
        const statement: Statement = SQL`NOT `;
        statement.append(
          group(this.compileConditionNode(node.child, selections, watchlists)),
        );
        return statement;
      }

      case "of": {
        const matchedNames: Array<string> = SigmaRuleParser.matchSelectionNames(
          node.pattern,
          selections.map((selection: SigmaSelection): string => {
            return selection.name;
          }),
        );

        const compiled: Array<Statement> = matchedNames.map(
          (name: string): Statement => {
            return this.compileConditionNode(
              { kind: "selection", name },
              selections,
              watchlists,
            );
          },
        );

        if (compiled.length === 0) {
          throw new BadDataException(
            `Sigma compiler: pattern "${node.pattern}" matches no selection.`,
          );
        }

        if (node.quantifier === "any") {
          return joinStatements(compiled, " OR ");
        }

        if (node.quantifier === "all") {
          return joinStatements(compiled, " AND ");
        }

        /*
         * `N of x*`: count the true branches. toUInt8 over each boolean,
         * summed, compared to the threshold.
         */
        const statement: Statement = SQL`(`;
        compiled.forEach((part: Statement, index: number): void => {
          if (index > 0) {
            statement.append(" + ");
          }
          statement.append("toUInt8(");
          statement.append(group(part));
          statement.append(")");
        });
        statement.append(") >= ");
        statement.append(numberParam(node.quantifier));
        return statement;
      }

      default: {
        throw new BadDataException("Sigma compiler: unknown condition node.");
      }
    }
  }

  private static compileSelection(
    selection: SigmaSelection,
    watchlists: SigmaWatchlists,
  ): Statement {
    if (selection.keywords.length > 0) {
      // Keywords match the event message, OR semantics.
      return joinStatements(
        selection.keywords.map((keyword: string): Statement => {
          const { pattern } = sigmaPatternToLike(keyword);
          const statement: Statement = SQL`message ILIKE `;
          statement.append(textParam(`%${pattern}%`));
          return statement;
        }),
        " OR ",
      );
    }

    // Field maps OR together; fields inside one map AND together.
    return joinStatements(
      selection.fieldMaps.map(
        (requirements: Array<SigmaFieldRequirement>): Statement => {
          return joinStatements(
            requirements.map(
              (requirement: SigmaFieldRequirement): Statement => {
                return this.compileRequirement(requirement, watchlists);
              },
            ),
            " AND ",
          );
        },
      ),
      " OR ",
    );
  }

  private static compileRequirement(
    requirement: SigmaFieldRequirement,
    watchlists: SigmaWatchlists,
  ): Statement {
    const resolved: ResolvedField = resolveSigmaField(requirement.field);

    if (isSigmaWatchlistRequirement(requirement)) {
      // On any of the lists named: `field|expand: ['%a%', '%b%']`.
      return joinStatements(
        requirement.values.map((value: JSONValue): Statement => {
          return this.compileWatchlistValue(resolved, value, watchlists);
        }),
        " OR ",
      );
    }

    const isAll: boolean = requirement.modifiers.includes("all");

    let values: Array<JSONValue> = requirement.values;

    /*
     * windash: Windows tools accept both `-flag` and `/flag`; match both
     * spellings for every value.
     */
    if (requirement.modifiers.includes("windash")) {
      const expanded: Array<JSONValue> = [];
      for (const value of values) {
        const text: string = String(value);
        expanded.push(text);
        if (text.includes("-")) {
          expanded.push(text.replace(/-/g, "/"));
        }
      }
      values = expanded;
    }

    const parts: Array<Statement> = values.map(
      (value: JSONValue): Statement => {
        return this.compileSingleValue(resolved, requirement, value);
      },
    );

    return joinStatements(parts, isAll ? " AND " : " OR ");
  }

  /*
   * `field|expand: '%vip_users%'`: the field is on the watchlist. The
   * parser has already held the value to a list's name; the list must be
   * bound, or the rule names one the project does not have.
   */
  private static compileWatchlistValue(
    resolved: ResolvedField,
    value: JSONValue,
    watchlists: SigmaWatchlists,
  ): Statement {
    const key: string | null = getSigmaWatchlistKey(value);
    const watchlist: SigmaWatchlist | undefined =
      key && Object.prototype.hasOwnProperty.call(watchlists, key)
        ? watchlists[key]
        : undefined;

    if (!watchlist) {
      throw new BadDataException(
        getMissingSecurityWatchlistsMessage([
          readSecurityWatchlistPlaceholder(value) || String(value),
        ]),
      );
    }

    if (resolved.kind === "arrayColumn") {
      return buildWatchlistArrayMatch(resolved.column, watchlist);
    }

    return buildWatchlistTextMatch(
      this.asStringExpression(resolved, this.fieldExpression(resolved)),
      watchlist,
    );
  }

  private static fieldExpression(resolved: ResolvedField): Statement {
    if (resolved.kind === "attribute") {
      const statement: Statement = SQL`attributes[`;
      statement.append(textParam(resolved.attributeKey));
      statement.append("]");
      return statement;
    }

    // Column names come from the fixed sets above — never user input.
    return new Statement([resolved.column], []);
  }

  private static compileSingleValue(
    resolved: ResolvedField,
    requirement: SigmaFieldRequirement,
    value: JSONValue,
  ): Statement {
    const modifiers: Array<string> = requirement.modifiers;
    const fieldExpr: Statement = this.fieldExpression(resolved);

    // null: the field is absent.
    if (value === null) {
      if (resolved.kind === "attribute") {
        const statement: Statement = SQL`NOT mapContains(attributes, `;
        statement.append(textParam(resolved.attributeKey));
        statement.append(")");
        return statement;
      }

      if (resolved.kind === "numberColumn") {
        const statement: Statement = new Statement();
        statement.append(fieldExpr);
        statement.append(" = 0");
        return statement;
      }

      const statement: Statement = new Statement();
      statement.append(fieldExpr);
      statement.append(" = ''");
      return statement;
    }

    // exists modifier: value is true/false.
    if (modifiers.includes("exists")) {
      const wantsExists: boolean = value === true || value === "true";

      if (resolved.kind === "attribute") {
        const statement: Statement = wantsExists
          ? SQL`mapContains(attributes, `
          : SQL`NOT mapContains(attributes, `;
        statement.append(textParam(resolved.attributeKey));
        statement.append(")");
        return statement;
      }

      const statement: Statement = new Statement();
      statement.append(fieldExpr);
      statement.append(wantsExists ? " != ''" : " = ''");
      return statement;
    }

    // Regular expression matching.
    if (modifiers.includes("re")) {
      const statement: Statement = SQL`match(`;
      statement.append(this.asStringExpression(resolved, fieldExpr));
      statement.append(", ");
      statement.append(textParam(String(value)));
      statement.append(")");
      return statement;
    }

    /*
     * CIDR matching on IP-carrying fields: an event whose field holds no
     * address (most events hold '' in one IP field or the other) does not
     * match, rather than failing the rule's whole read.
     */
    if (modifiers.includes("cidr")) {
      return buildIpInRangeExpression(
        this.asStringExpression(resolved, fieldExpr),
        String(value),
      );
    }

    // Numeric comparisons.
    const comparison: string | null = modifiers.includes("gt")
      ? ">"
      : modifiers.includes("gte")
        ? ">="
        : modifiers.includes("lt")
          ? "<"
          : modifiers.includes("lte")
            ? "<="
            : null;

    if (comparison) {
      const numeric: number = Number(value);

      if (!Number.isFinite(numeric)) {
        throw new BadDataException(
          `Sigma compiler: field "${requirement.field}" uses a numeric comparison with non-numeric value "${String(value)}".`,
        );
      }

      const statement: Statement = new Statement();

      if (resolved.kind === "numberColumn") {
        statement.append(fieldExpr);
      } else {
        statement.append("toFloat64OrNull(");
        statement.append(this.asStringExpression(resolved, fieldExpr));
        statement.append(")");
      }

      statement.append(` ${comparison} `);
      statement.append(numberParam(numeric));
      return statement;
    }

    // Array columns: membership (or fuzzy membership with contains).
    if (resolved.kind === "arrayColumn") {
      if (modifiers.includes("contains")) {
        const { pattern } = sigmaPatternToLike(String(value));
        const statement: Statement = new Statement();
        statement.append(`arrayExists(x -> x ILIKE `);
        statement.append(textParam(`%${pattern}%`));
        statement.append(`, ${resolved.column})`);
        return statement;
      }

      const statement: Statement = new Statement([`has(${resolved.column}, `]);
      statement.append(textParam(String(value)));
      statement.append(")");
      return statement;
    }

    // Numeric column with a plain numeric value: numeric equality.
    if (
      resolved.kind === "numberColumn" &&
      typeof value === "number" &&
      !modifiers.includes("contains") &&
      !modifiers.includes("startswith") &&
      !modifiers.includes("endswith")
    ) {
      const statement: Statement = new Statement();
      statement.append(fieldExpr);
      statement.append(" = ");
      statement.append(numberParam(value));
      return statement;
    }

    // String matching: equality/contains/startswith/endswith.
    const caseSensitive: boolean = modifiers.includes("cased");
    const raw: string = String(value);
    const { pattern, hasWildcard } = sigmaPatternToLike(raw);

    let likePattern: string = pattern;

    if (modifiers.includes("contains")) {
      likePattern = `%${pattern}%`;
    } else if (modifiers.includes("startswith")) {
      likePattern = `${pattern}%`;
    } else if (modifiers.includes("endswith")) {
      likePattern = `%${pattern}`;
    } else if (!hasWildcard) {
      /*
       * Plain equality, no wildcards: use = for exact matching, or
       * case-folded = for the default case-insensitive semantics. Cheaper
       * than LIKE and keeps bloom-filter indexes usable for the cased
       * variant.
       */
      const statement: Statement = new Statement();

      if (caseSensitive) {
        statement.append(this.asStringExpression(resolved, fieldExpr));
        statement.append(" = ");
        statement.append(textParam(raw));
        return statement;
      }

      statement.append("lowerUTF8(");
      statement.append(this.asStringExpression(resolved, fieldExpr));
      statement.append(") = ");
      statement.append(textParam(raw.toLowerCase()));
      return statement;
    }

    const statement: Statement = new Statement();
    statement.append(this.asStringExpression(resolved, fieldExpr));
    statement.append(caseSensitive ? " LIKE " : " ILIKE ");
    statement.append(textParam(likePattern));
    return statement;
  }

  /*
   * Wrap number columns in toString so string operators apply; text
   * expressions pass through.
   */
  private static asStringExpression(
    resolved: ResolvedField,
    fieldExpr: Statement,
  ): Statement {
    if (resolved.kind === "numberColumn") {
      const statement: Statement = new Statement();
      statement.append("toString(");
      statement.append(fieldExpr);
      statement.append(")");
      return statement;
    }

    return fieldExpr;
  }
}
