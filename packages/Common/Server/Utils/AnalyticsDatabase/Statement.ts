import { BaseQueryParams } from "@clickhouse/client";
import { integer } from "@elastic/elasticsearch/lib/api/types";
import { RecordValue } from "../../../Models/AnalyticsModels/AnalyticsBaseModel/CommonModel";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Search from "../../../Types/BaseDatabase/Search";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { holdsSecurityScanWord } from "../../../Utils/SecurityEvent/SecurityScanWords";
import { inspect } from "util";

/**
 * This file based on the sql-template-strings package, adapted for ClickHouse
 */

export type StatementParameter = {
  type: TableColumnType;
  value: RecordValue;
  /*
   * Send this text hex encoded whatever it holds (see "Hex encoded text"
   * below). A text that holds a security scan word is sent so anyway; this
   * is for a statement that binds a scan's whole vocabulary, words a line
   * is only read for together - the security log prefilter's "cef:" and
   * "login" - so nothing of it is left to read back.
   */
  sendAsHex?: boolean | undefined;
};

/*
 * HEX ENCODED TEXT. A text parameter that holds a word the security scans
 * look for - an attack string, the start of an SSH sign-in, a
 * prompt-injection phrase (Utils/SecurityEvent/SecurityScanWords.ts) - is
 * sent hex encoded, and ClickHouse decodes it:
 *
 *   {p0:String}          is sent as   unhex({p0:String})
 *   {p1:Array(String)}   is sent as   [unhex({p1_0:String}), unhex({p1_1:String})]
 *
 * ClickHouse writes down a query with its parameters filled in: in the
 * error it logs when the query fails, and in system.query_log. Sent as
 * they are, a scan's words make its own query read as the attack it looks
 * for, and the scan finds that line in the logs it reads (issue #6419).
 * Hex reads as nothing, and the query finds the same rows: unhex of a
 * constant is a constant, so a skip index still prunes, and IN and
 * multiSearchAny still take it. An array is decoded element by element,
 * because the older analyzer takes no arrayMap where IN needs a constant.
 */
type RenderedParameter =
  | { kind: "qualified"; column: QualifiedColumn }
  | {
      kind: "plain";
      dataType: string;
      parameter: StatementParameter | string;
    }
  | { kind: "hex"; value: string }
  | { kind: "hexArray"; values: Array<string> };

function isText(value: unknown): value is string {
  return typeof value === "string";
}

// A non-empty array of texts, as an array of strings; else null.
function toTexts(value: unknown): Array<string> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const texts: Array<string> = [];

  for (const item of value as Array<unknown>) {
    if (!isText(item)) {
      return null;
    }

    texts.push(item);
  }

  return texts;
}

function toHex(text: string): string {
  return Buffer.from(text, "utf8").toString("hex");
}

/*
 * Escape LIKE/ILIKE metacharacters so a user-supplied value matches
 * literally. Without this, "svc_" matches svcX (a false positive) and a
 * value containing "%" silently corrupts the whole pattern — the worst
 * possible failure mode for a security-events filter. ClickHouse honors
 * backslash escapes inside (I)LIKE patterns; backslash itself must be
 * escaped first.
 */
export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * A table-qualified column reference (`table.column`) bound as TWO
 * Identifier parameters. ClickHouse treats a dotted string bound as a
 * single Identifier parameter as one quoted identifier (`` `t.col` ``),
 * so the qualifier and the column must be bound separately.
 *
 * Qualification exists so a WHERE built by
 * StatementGenerator.toWhereStatement can reference the real table
 * column even when the surrounding SELECT aliases an expression to the
 * same name — ClickHouse substitutes SELECT aliases into same-level
 * unqualified WHERE references (an aggregate alias there is an
 * ILLEGAL_AGGREGATION error; any other alias silently changes the
 * filter), while qualified references always resolve to the table
 * column.
 */
export class QualifiedColumn {
  public constructor(
    public readonly tableAlias: string,
    public readonly column: string,
  ) {}
}

export class Statement implements BaseQueryParams {
  public constructor(
    private strings: string[] = [""],
    private values: Array<StatementParameter | string | QualifiedColumn> = [],
  ) {}

  public get query(): string {
    const rendered: Array<RenderedParameter> = this.renderParameters();

    let query: string = this.strings.reduce(
      (prev: string, curr: string, i: integer) => {
        return prev + Statement.toPlaceholder(rendered[i - 1]!, i - 1) + curr;
      },
    );

    // dedent lines
    query = query.trimEnd();
    const minIndent: number =
      query.match(/\n( *)/g)?.reduce((minIndent: number, indent: string) => {
        return Math.min(minIndent, indent.length - 1);
      }, Infinity) ?? 0;
    query = query.replace(new RegExp(`\n {${minIndent}}`, "g"), "\n");
    query = query.trimStart();

    return query;
  }

  public get query_params(): Record<string, unknown> {
    const returnObject: Record<string, unknown> = {};

    this.renderParameters().forEach(
      (rendered: RenderedParameter, index: number): void => {
        switch (rendered.kind) {
          case "qualified":
            returnObject[`p${index}_t`] = rendered.column.tableAlias;
            returnObject[`p${index}_c`] = rendered.column.column;
            return;
          case "hex":
            returnObject[`p${index}`] = rendered.value;
            return;
          case "hexArray":
            rendered.values.forEach((value: string, element: number): void => {
              returnObject[`p${index}_${element}`] = value;
            });
            return;
          default:
            returnObject[`p${index}`] = this.serializseValue(
              rendered.parameter,
            );
        }
      },
    );

    return returnObject;
  }

  /*
   * How each parameter is written into the query and sent - decided in one
   * place, so the query and its parameters always agree.
   */
  private renderParameters(): Array<RenderedParameter> {
    return this.values.map(
      (
        parameter: StatementParameter | string | QualifiedColumn,
      ): RenderedParameter => {
        return this.renderParameter(parameter);
      },
    );
  }

  private renderParameter(
    parameter: StatementParameter | string | QualifiedColumn,
  ): RenderedParameter {
    if (parameter instanceof QualifiedColumn) {
      return { kind: "qualified", column: parameter };
    }

    if (typeof parameter === "string") {
      return { kind: "plain", dataType: "Identifier", parameter };
    }

    const dataType: string = Statement.toColumnType(parameter);

    // Only text is ever hex encoded: never an identifier, an id, a number or a date.
    if (
      (parameter.type === TableColumnType.Text ||
        parameter.type === TableColumnType.ArrayText) &&
      (dataType === "String" || dataType === "Array(String)")
    ) {
      const serialized: RecordValue | Array<RecordValue> =
        this.serializseValue(parameter);

      if (
        dataType === "String" &&
        isText(serialized) &&
        (parameter.sendAsHex || holdsSecurityScanWord(serialized))
      ) {
        return { kind: "hex", value: toHex(serialized) };
      }

      const texts: Array<string> | null =
        dataType === "Array(String)" ? toTexts(serialized) : null;

      if (texts && (parameter.sendAsHex || texts.some(holdsSecurityScanWord))) {
        return { kind: "hexArray", values: texts.map(toHex) };
      }
    }

    return { kind: "plain", dataType, parameter };
  }

  private static toPlaceholder(
    rendered: RenderedParameter,
    index: number,
  ): string {
    switch (rendered.kind) {
      case "qualified":
        return `{p${index}_t:Identifier}.{p${index}_c:Identifier}`;
      case "hex":
        return `unhex({p${index}:String})`;
      case "hexArray":
        return `[${rendered.values
          .map((_value: string, element: number): string => {
            return `unhex({p${index}_${element}:String})`;
          })
          .join(", ")}]`;
      default:
        return `{p${index}:${rendered.dataType}}`;
    }
  }

  public serializseValue(
    v: StatementParameter | string,
  ): RecordValue | Array<RecordValue> {
    let finalValue: RecordValue | Array<RecordValue> = v as RecordValue;

    // if of type date, convert to database date

    if (typeof v === "string") {
      finalValue = v;
    } else if (Array.isArray(v.value)) {
      const tempArr: Array<RecordValue> = [];

      for (const val of v.value) {
        tempArr.push(
          this.serializseValue({
            type: v.type,
            value: val,
          }) as RecordValue,
        );
      }

      finalValue = tempArr;
    } else if (v.value instanceof ObjectID) {
      finalValue = v.value.toString();
    } else if (v.value instanceof Search) {
      finalValue = `%${escapeIlikePattern(v.value.toString())}%`;
    } else if (
      v.value instanceof LessThan ||
      v.value instanceof LessThanOrEqual ||
      v.value instanceof GreaterThan ||
      v.value instanceof GreaterThanOrEqual ||
      v.value instanceof LessThanOrNull ||
      v.value instanceof GreaterThanOrNull ||
      v.value instanceof NotEqual
    ) {
      finalValue = v.value.value;
    } else if (v.value instanceof Includes || v.value instanceof IncludesNone) {
      if (
        v.type === TableColumnType.Text ||
        v.type === TableColumnType.ObjectID
      ) {
        finalValue = v.value.values.map((val: string | ObjectID | number) => {
          return `${val.toString()}`;
        });
      } else {
        finalValue = v.value.values;
      }
    } else if (v.value instanceof Date) {
      if (typeof v !== "string" && v.type === TableColumnType.DateTime64) {
        finalValue = OneUptimeDate.toClickhouseDateTime64(v.value);
      } else {
        finalValue = OneUptimeDate.toClickhouseDateTime(v.value);
      }
    } else {
      finalValue = v.value;
    }

    // serialize to date (only for string values that need parsing, not already processed Date objects)

    if (
      typeof v !== "string" &&
      v.type === TableColumnType.Date &&
      !(v.value instanceof Date)
    ) {
      finalValue = OneUptimeDate.fromString(finalValue as string);
      finalValue = OneUptimeDate.toClickhouseDateTime(finalValue);
    }

    if (
      typeof v !== "string" &&
      v.type === TableColumnType.DateTime64 &&
      !(v.value instanceof Date)
    ) {
      finalValue = OneUptimeDate.fromString(finalValue as string);
      finalValue = OneUptimeDate.toClickhouseDateTime64(finalValue);
    }

    return finalValue;
  }

  /**
   * Append an escaped SQL fragment. If you pass a raw String
   * it is appended as trusted SQL!
   */
  public append(statement: Statement | string): Statement {
    if (statement instanceof Statement) {
      this.strings[this.strings.length - 1]! += statement.strings[0];
      this.strings.push(...statement.strings.slice(1));
      this.values.push(...statement.values);
    } else {
      this.strings[this.strings.length - 1] += statement;
    }
    return this;
  }

  // custom inspect for logging
  public [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Statement ${inspect({
      query: this.query,
      query_params: this.query_params,
    })}`;
  }

  /*
   * What a log line shows of a statement (the logger serializes through
   * toJSON): the query and parameters as they are sent, hex encoded text
   * and all - never the values a scan's words are in.
   */
  public toJSON(): { query: string; query_params: Record<string, unknown> } {
    return {
      query: this.query,
      query_params: this.query_params,
    };
  }

  private static toColumnType(
    statementParam: StatementParameter | string,
  ): string {
    /*
     * ensure we have a mapping for all types (a missing mapping will
     * be a compile error)
     */
    const columnTypes: Dictionary<string> = {
      [TableColumnType.Text]: "String",
      [TableColumnType.ObjectID]: "String",
      [TableColumnType.Boolean]: "Bool",
      [TableColumnType.Number]: "Int32",
      [TableColumnType.Decimal]: "Double",
      [TableColumnType.Date]: "DateTime",
      [TableColumnType.DateTime64]: "DateTime64(9)",
      [TableColumnType.JSON]: "JSON",
      [TableColumnType.ArrayNumber]: "Array(Int32)",
      [TableColumnType.ArrayText]: "Array(String)",
      [TableColumnType.LongNumber]: "Int128",
      [TableColumnType.BigNumber]: "Int64",
      [TableColumnType.UInt64]: "UInt64",
    };

    if (
      (statementParam as StatementParameter).value instanceof Includes ||
      (statementParam as StatementParameter).value instanceof IncludesNone
    ) {
      const includesValues: Array<string | number | ObjectID> = (
        (statementParam as StatementParameter).value as Includes | IncludesNone
      ).values as Array<string | number | ObjectID>;

      const isNumberArray: boolean = includesValues.every(
        (v: string | number | ObjectID) => {
          return typeof v === "number";
        },
      );

      if (isNumberArray) {
        return "Array(Int32)";
      }

      return "Array(String)";
    }

    return columnTypes[(statementParam as StatementParameter).type] || "String";
  }
}

/**
 * ClickHouse SQL template literal tag.
 *
 * String substitution values are interpereted as Identifiers (e.g. table or column names),
 * QualifiedColumn values compile to `table.column` identifier pairs,
 * other substitution values must be StatementParameters.
 */
export function SQL(
  strings: TemplateStringsArray,
  ...values: Array<StatementParameter | string | QualifiedColumn>
): Statement {
  return new Statement(strings.slice(0), values.slice(0));
}
