import { BaseQueryParams } from "@clickhouse/client";
import { integer } from "@elastic/elasticsearch/lib/api/types";
import { RecordValue } from "../../../Models/AnalyticsModels/AnalyticsBaseModel/CommonModel";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import Search from "../../../Types/BaseDatabase/Search";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { inspect } from "util";

/**
 * This file based on the sql-template-strings package, adapted for ClickHouse
 */

export type StatementParameter = {
  type: TableColumnType;
  value: RecordValue;
};

export class Statement implements BaseQueryParams {
  public constructor(
    private strings: string[] = [""],
    private values: Array<StatementParameter | string> = [],
  ) {}

  public get query(): string {
    let query: string = this.strings.reduce(
      (prev: string, curr: string, i: integer) => {
        const param: StatementParameter | string = this.values[i - 1]!;

        const dataType: string =
          typeof param === "string"
            ? "Identifier"
            : Statement.toColumnType(param);

        return prev + `{p${i - 1}:${dataType}}` + curr;
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
    let index: number = 0;

    const returnObject: Record<string, unknown> = {};

    for (const v of this.values) {
      const finalValue: RecordValue | Array<RecordValue> =
        this.serializseValue(v);
      returnObject[`p${index}`] = finalValue;
      index++;
    }

    return returnObject;
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
      finalValue = `%${v.value.toString()}%`;
    } else if (
      v.value instanceof LessThan ||
      v.value instanceof LessThanOrEqual ||
      v.value instanceof GreaterThan ||
      v.value instanceof GreaterThanOrEqual ||
      v.value instanceof LessThanOrNull ||
      v.value instanceof GreaterThanOrNull
    ) {
      finalValue = v.value.value;
    } else if (v.value instanceof Includes) {
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
      finalValue = OneUptimeDate.toClickhouseDateTime(v.value);
    } else {
      finalValue = v.value;
    }

    // serialize to date.

    if (typeof v !== "string" && v.type === TableColumnType.Date) {
      finalValue = OneUptimeDate.fromString(finalValue as string);
      finalValue = OneUptimeDate.toClickhouseDateTime(finalValue);
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
      [TableColumnType.JSON]: "JSON",
      [TableColumnType.ArrayNumber]: "Array(Int32)",
      [TableColumnType.ArrayText]: "Array(String)",
      [TableColumnType.LongNumber]: "Int128",
    };

    if ((statementParam as StatementParameter).value instanceof Includes) {
      const includesValues: Array<string | number | ObjectID> = (
        (statementParam as StatementParameter).value as Includes
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
 * other substitution values must be StatementParameters.
 */
export function SQL(
  strings: TemplateStringsArray,
  ...values: Array<StatementParameter | string>
): Statement {
  return new Statement(strings.slice(0), values.slice(0));
}
