import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "../../../Models/AnalyticsModels/Log";
import Span from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { TelemetryFieldSignal } from "../../../Types/Telemetry/TelemetryFieldReaders";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import {
  TelemetryFilterAnd,
  TelemetryFilterComparison,
  TelemetryFilterExpression,
  TelemetryFilterNot,
  TelemetryFilterOr,
} from "../../../Utils/Telemetry/TelemetryFilterQuery";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

/*
 * A DROP FILTER'S QUERY, AS A CLICKHOUSE CONDITION ON THE RECORDS IT WOULD
 * HAVE TAKEN (#10436).
 *
 * Before a drop or sample filter is saved, its form says how many of the
 * last day's records it matches (Telemetry/DropFilterRecordCount). Ingest
 * decides with the filter's query on each record as it arrives
 * (App/FeatureSet/Telemetry/Utils/LogFilterEvaluator); the count asks the
 * stored records the same question, in one ClickHouse statement. So each
 * part of the query is read here the way the engine reads it:
 *
 *   - a field is the row's own column when the row carries one of that name
 *     - the stored table's columns, less the three ingest stamps only a
 *     record that survives the filter gets (_id, createdAt, retentionDate) -
 *     as the text the engine compares (String(value): a Bool is "true", a
 *     list "a,b"); a column with no value (NULL) is read as the attribute
 *     of that name, as the engine reads a field the row does not hold;
 *   - `attributes.<key>`, and any other field, is the attribute: its own
 *     key, or `resource.<key>` when the record has none (getAttrValue);
 *     a missing one is "";
 *   - `=` and `!=` compare the text exactly; `IN` is one of the list,
 *     exactly; `LIKE` without % holds the text anywhere, whatever the case,
 *     and with % is the whole value against the SQL wildcard pattern (%
 *     any run of text, _ any one character), whatever the case - read by
 *     RE2 through match(), as the pattern the engine compiles;
 *   - AND, OR and NOT as written.
 *
 * Every value and every key is a bound parameter; a column's name is
 * appended only from the table's own columns.
 *
 * What the count reads is what was stored: what a pipeline changed or a
 * scrub rule hid after the filter would have read the record is read as it
 * was stored. Close, and said where the count is shown.
 */

// Stamped only on a record the filter let through: the filter never reads them.
const STAMPED_AFTER_THE_FILTER: ReadonlySet<string> = new Set<string>([
  "_id",
  "createdAt",
  "retentionDate",
]);

const IDENTIFIER_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ATTRIBUTES_PREFIX: string = "attributes.";
const RESOURCE_PREFIX: string = "resource.";

const MODEL_OF_SIGNAL: Readonly<
  Record<TelemetryFieldSignal, { new (): AnalyticsBaseModel }>
> = {
  log: Log,
  trace: Span,
};

const columnsBySignal: Map<
  TelemetryFieldSignal,
  ReadonlyMap<string, AnalyticsTableColumn>
> = new Map<TelemetryFieldSignal, ReadonlyMap<string, AnalyticsTableColumn>>();

/*
 * The columns a record of the signal carries when a drop filter reads it,
 * by their names: the fields a query names that are no attribute.
 */
export function getFilterRowColumns(
  signal: TelemetryFieldSignal,
): ReadonlyMap<string, AnalyticsTableColumn> {
  const cached: ReadonlyMap<string, AnalyticsTableColumn> | undefined =
    columnsBySignal.get(signal);

  if (cached) {
    return cached;
  }

  const columns: Map<string, AnalyticsTableColumn> = new Map<
    string,
    AnalyticsTableColumn
  >();

  for (const column of new MODEL_OF_SIGNAL[signal]().tableColumns) {
    if (
      !STAMPED_AFTER_THE_FILTER.has(column.key) &&
      IDENTIFIER_PATTERN.test(column.key)
    ) {
      columns.set(column.key, column);
    }
  }

  columnsBySignal.set(signal, columns);

  return columns;
}

// An attribute as the engine reads it: its own key, else resource.<key>, else "".
function appendAttribute(statement: Statement, key: string): void {
  statement.append(
    SQL`if(mapContains(attributes, ${{
      type: TableColumnType.Text,
      value: key,
    }}), attributes[${{
      type: TableColumnType.Text,
      value: key,
    }}], attributes[${{
      type: TableColumnType.Text,
      value: `${RESOURCE_PREFIX}${key}`,
    }}])`,
  );
}

/*
 * A column's value as the text the engine compares: String(value). A Bool
 * reads "true" or "false" both ways; a list joins its items with commas, as
 * String([...]) does; the attributes map is an object, "[object Object]".
 * NULL is left NULL, for the caller to read the attribute in its place.
 */
function appendColumnText(
  statement: Statement,
  column: AnalyticsTableColumn,
): void {
  const name: string = column.key;

  switch (column.type) {
    case TableColumnType.MapStringString:
      statement.append("'[object Object]'");
      return;
    case TableColumnType.ArrayText:
      statement.append(`arrayStringConcat(${name}, ',')`);
      return;
    case TableColumnType.ArrayNumber:
    case TableColumnType.ArrayBigNumber:
    case TableColumnType.ArrayDecimal:
      statement.append(
        `arrayStringConcat(arrayMap(x -> toString(x), ${name}), ',')`,
      );
      return;
    default:
      statement.append(`toString(${name})`);
  }
}

// What the engine compares a condition's field as (getRowFieldValue).
function appendFieldText(
  statement: Statement,
  field: string,
  columns: ReadonlyMap<string, AnalyticsTableColumn>,
): void {
  if (field.startsWith(ATTRIBUTES_PREFIX)) {
    appendAttribute(statement, field.slice(ATTRIBUTES_PREFIX.length));
    return;
  }

  const column: AnalyticsTableColumn | undefined = columns.get(field);

  if (!column) {
    // No such field on the row: the engine reads the attribute of that name.
    appendAttribute(statement, field);
    return;
  }

  if (column.required || column.type === TableColumnType.MapStringString) {
    appendColumnText(statement, column);
    return;
  }

  // A column with no value is read as the attribute, as a field the row lacks.
  statement.append("ifNull(");
  appendColumnText(statement, column);
  statement.append(", ");
  appendAttribute(statement, field);
  statement.append(")");
}

/*
 * A LIKE pattern with % as the engine compiles it: escaped, then % any run
 * of text and _ any one character, the whole value, without case - for
 * RE2, which reads the escapes the same way.
 */
export function toLikePattern(value: string): string {
  const pattern: string = escapeRegExp(value)
    .replace(/%/g, ".*")
    .replace(/_/g, ".");

  return `(?i)^${pattern}$`;
}

function appendComparison(
  statement: Statement,
  comparison: TelemetryFilterComparison,
  columns: ReadonlyMap<string, AnalyticsTableColumn>,
): void {
  const value: string | Array<string> = comparison.value;

  switch (comparison.operator) {
    case "=":
    case "!=": {
      statement.append("(");
      appendFieldText(statement, comparison.field, columns);
      // The operator is this file's own text: a substitution would be an identifier.
      statement.append(comparison.operator === "=" ? " = " : " != ");
      statement.append(
        SQL`${{
          type: TableColumnType.Text,
          value: String(value),
        }})`,
      );
      return;
    }
    case "LIKE": {
      const raw: string = String(value);

      if (!raw.includes("%")) {
        statement.append("(positionCaseInsensitiveUTF8(");
        appendFieldText(statement, comparison.field, columns);
        statement.append(
          SQL`, ${{ type: TableColumnType.Text, value: raw }}) > 0)`,
        );
        return;
      }

      statement.append("match(");
      appendFieldText(statement, comparison.field, columns);
      statement.append(
        SQL`, ${{ type: TableColumnType.Text, value: toLikePattern(raw) }})`,
      );
      return;
    }
    case "IN": {
      const values: Array<string> = Array.isArray(value)
        ? value.map(String)
        : [String(value)];

      if (values.length === 0) {
        statement.append("0");
        return;
      }

      statement.append(
        SQL`has(${{ type: TableColumnType.ArrayText, value: values }}, `,
      );
      appendFieldText(statement, comparison.field, columns);
      statement.append(")");
      return;
    }
    default:
      // An operator the engine does not know never matches.
      statement.append("0");
  }
}

function appendExpression(
  statement: Statement,
  expr: TelemetryFilterExpression,
  columns: ReadonlyMap<string, AnalyticsTableColumn>,
): void {
  switch (expr.type) {
    case "comparison":
      appendComparison(statement, expr as TelemetryFilterComparison, columns);
      return;
    case "and":
    case "or": {
      const pair: TelemetryFilterAnd | TelemetryFilterOr = expr as
        | TelemetryFilterAnd
        | TelemetryFilterOr;
      statement.append("(");
      appendExpression(statement, pair.left, columns);
      statement.append(expr.type === "and" ? " AND " : " OR ");
      appendExpression(statement, pair.right, columns);
      statement.append(")");
      return;
    }
    case "not":
      statement.append("(NOT ");
      appendExpression(statement, (expr as TelemetryFilterNot).expr, columns);
      statement.append(")");
      return;
    default:
      statement.append("0");
  }
}

/*
 * The condition a record of the signal meets when the filter's query
 * matches it, for a WHERE or a countIf.
 */
export function buildTelemetryFilterCondition(data: {
  signal: TelemetryFieldSignal;
  expr: TelemetryFilterExpression;
}): Statement {
  const statement: Statement = SQL``;

  appendExpression(statement, data.expr, getFilterRowColumns(data.signal));

  return statement;
}
