import AllModelTypes from "../../../Models/DatabaseModels/Index";
import LogDropFilter from "../../../Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "../../../Models/DatabaseModels/TraceDropFilter";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { isNumericTableColumnType } from "../../../Types/Database/NumericColumnValue";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * Contract under test — two schema-wide invariants about column
 * transformers, not any one model's behaviour. Both are traps that are
 * invisible at the call site: the model reads as a perfectly ordinary
 * column, and the failure surfaces as a Postgres error a long way away.
 *
 * 1. A transformer must not fold `undefined` into `null`.
 *
 *    TypeORM runs the transformer BEFORE deciding whether the caller
 *    supplied the column:
 *
 *      InsertQueryBuilder.createColumnValueExpression
 *        -> driver.preparePersistentValue   (runs transformer.to)
 *        -> if (value === undefined) expression += "DEFAULT"
 *
 *    So on a `NOT NULL DEFAULT x` column, answering `null` makes the DEFAULT
 *    unreachable and every insert that omits the column dies on the not-null
 *    constraint. That is what shipped for the drop-filter drop counters, and
 *    creating any log drop filter in the dashboard returned HTTP 500:
 *
 *      null value in column "droppedCount" of relation "LogDropFilter"
 *      violates not-null constraint
 *
 *    github.com/OneUptime/oneuptime/issues/3026
 *
 * 2. A transformer on a number column must accept a raw number.
 *
 *    `BaseModel.fromJSON` normalizes strings bound for number columns (see
 *    github.com/OneUptime/oneuptime/issues/3027), so a column declared
 *    `TableColumnType.Number` now reliably holds a number by the time the
 *    transformer sees it — even when its in-memory type is a wrapped object
 *    like `Port` or `Decimal`. A transformer that only knew how to handle
 *    its own class and a string answered `null` for a number, which wrote
 *    NULL over a value the user had just typed.
 */

interface TransformerColumn {
  entity: string;
  property: string;
  transformer: ValueTransformer;
  defaultValue: unknown;
}

/*
 * TypeORM accepts either a single transformer or an array applied in order.
 * `to` runs last-to-first over an array, so the *last* entry is the one that
 * sees the raw entity value.
 */
function firstTransformerToRun(
  transformer: ValueTransformer | Array<ValueTransformer>,
): ValueTransformer {
  if (Array.isArray(transformer)) {
    return transformer[transformer.length - 1] as ValueTransformer;
  }

  return transformer;
}

function notNullColumnsWithADefaultAndATransformer(): Array<TransformerColumn> {
  const columns: Array<TransformerColumn> = [];

  for (const column of getMetadataArgsStorage()
    .columns as Array<ColumnMetadataArgs>) {
    const options: ColumnMetadataArgs["options"] = column.options || {};

    if (!options.transformer) {
      continue;
    }

    if (options.nullable !== false) {
      continue;
    }

    if (options.default === undefined || options.default === null) {
      continue;
    }

    columns.push({
      entity:
        (column.target as { name?: string })?.name || String(column.target),
      property: column.propertyName,
      transformer: firstTransformerToRun(options.transformer),
      defaultValue: options.default,
    });
  }

  return columns;
}

describe("NOT NULL columns that carry both a DEFAULT and a transformer", () => {
  const columns: Array<TransformerColumn> =
    notNullColumnsWithADefaultAndATransformer();

  /*
   * If this ever finds nothing, the filter above has drifted (a renamed
   * option, a TypeORM upgrade) and the real assertion below is vacuously
   * passing — which is the same as deleting it.
   */
  it("finds the drop-filter counters, so the scan itself is known to work", () => {
    const scanned: Array<string> = columns.map((column: TransformerColumn) => {
      return `${column.entity}.${column.property}`;
    });

    expect(scanned).toContain("LogDropFilter.droppedCount");
    expect(scanned).toContain("TraceDropFilter.droppedCount");
  });

  it("never lets a transformer swallow undefined into null", () => {
    const offenders: Array<string> = [];

    for (const column of columns) {
      if (!column.transformer.to) {
        continue;
      }

      if (column.transformer.to(undefined) !== undefined) {
        offenders.push(
          `${column.entity}.${column.property} (NOT NULL DEFAULT ${String(
            column.defaultValue,
          )}) maps undefined to ${String(column.transformer.to(undefined))}`,
        );
      }
    }

    /*
     * Named rather than counted: the message has to say which column will
     * 500 on every insert, because the failure surfaces as a Postgres
     * constraint error a long way from the model file.
     */
    expect(offenders).toEqual([]);
  });
});

/*
 * Every column declared as a number type that also carries a transformer.
 *
 * The declared type is not a perfect proxy for the in-memory one — an SMTP
 * port is declared `Number` but typed `Port`, a usage figure is declared
 * `Number` but typed `Decimal` — and those are exactly the columns where a
 * transformer might never have been handed a bare number before.
 */
function numericColumnsWithATransformer(): Array<TransformerColumn> {
  const columns: Array<TransformerColumn> = [];

  for (const modelType of AllModelTypes) {
    const model: BaseModel = new modelType();
    const entity: string = modelType.name;

    for (const columnName of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(columnName);

      if (!metadata || !isNumericTableColumnType(metadata.type)) {
        continue;
      }

      const column: ColumnMetadataArgs | undefined = (
        getMetadataArgsStorage().columns as Array<ColumnMetadataArgs>
      ).find((candidate: ColumnMetadataArgs) => {
        return (
          (candidate.target as { name?: string })?.name === entity &&
          candidate.propertyName === columnName
        );
      });

      if (!column?.options?.transformer) {
        continue;
      }

      columns.push({
        entity: entity,
        property: columnName,
        transformer: firstTransformerToRun(column.options.transformer),
        defaultValue: column.options.default,
      });
    }
  }

  return columns;
}

describe("number columns that carry a transformer", () => {
  const columns: Array<TransformerColumn> = numericColumnsWithATransformer();

  /*
   * The wrapped-type columns are the whole reason this scan exists. If it
   * stops finding them, the assertion below is passing vacuously.
   */
  it("finds the wrapped-type number columns, so the scan is known to work", () => {
    const scanned: Array<string> = columns.map((column: TransformerColumn) => {
      return `${column.entity}.${column.property}`;
    });

    expect(scanned).toContain("GlobalConfig.smtpPort");
    expect(scanned).toContain("ProjectSmtpConfig.port");
    expect(scanned).toContain("TelemetryUsageBilling.dataIngestedInGB");
    expect(scanned).toContain("LogDropFilter.droppedCount");
  });

  /*
   * `BaseModel.fromJSON` now hands these transformers a real number where it
   * used to hand them the string the form produced. A transformer that
   * answers null for a number writes NULL over a value the user supplied —
   * silently on a nullable column, and as a 500 on a NOT NULL one.
   */
  it("accepts a raw number rather than answering null", () => {
    const offenders: Array<string> = [];

    for (const column of columns) {
      if (!column.transformer.to) {
        continue;
      }

      /*
       * 1 is in range for every number column in the schema; 0 is the value
       * a truthiness check silently drops.
       */
      for (const sample of [1, 0]) {
        let stored: unknown;

        try {
          stored = column.transformer.to(sample);
        } catch (error) {
          offenders.push(
            `${column.entity}.${column.property} threw on ${sample}: ${
              (error as Error).message
            }`,
          );
          continue;
        }

        if (stored === null || stored === undefined) {
          offenders.push(
            `${column.entity}.${column.property} maps the number ${sample} to ${String(
              stored,
            )}`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("drop filter counter columns", () => {
  /*
   * Spelled out for the two columns the bug actually shipped on, so the
   * regression is legible without reading the scan above.
   */
  const CASES: Array<{ name: string }> = [
    { name: LogDropFilter.name },
    { name: TraceDropFilter.name },
  ];

  describe.each(CASES)("$name.droppedCount", ({ name }: { name: string }) => {
    function droppedCountColumn(): ColumnMetadataArgs {
      const column: ColumnMetadataArgs | undefined = (
        getMetadataArgsStorage().columns as Array<ColumnMetadataArgs>
      ).find((candidate: ColumnMetadataArgs) => {
        return (
          (candidate.target as { name?: string })?.name === name &&
          candidate.propertyName === "droppedCount"
        );
      });

      if (!column) {
        throw new Error(`${name}.droppedCount is not a registered column`);
      }

      return column;
    }

    it("is NOT NULL with a zero default, so the UI never renders a blank counter", () => {
      const options: ColumnMetadataArgs["options"] = droppedCountColumn()
        .options as ColumnMetadataArgs["options"];

      expect(options.nullable).toBe(false);
      expect(options.default).toBe(0);
    });

    /*
     * The exact regression: an insert that leaves the counter alone — which
     * is every create, since only the ingest path writes it — has to reach
     * Postgres as DEFAULT, not as NULL.
     */
    it("lets a create fall through to that default instead of writing NULL", () => {
      const transformer: ValueTransformer = firstTransformerToRun(
        droppedCountColumn().options.transformer as ValueTransformer,
      );

      expect(transformer.to!(undefined)).toBeUndefined();
    });
  });
});
