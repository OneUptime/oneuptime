import { describe, expect, test } from "@jest/globals";
import { Column } from "typeorm";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../Models/DatabaseModels/Index";
import ColumnType from "../../Types/Database/ColumnType";
import Dictionary from "../../Types/Dictionary";
import TableColumn, {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";

/*
 * GUARD: A REQUIRED COLUMN THAT DECLARES A DEFAULT CAN BE LEFT OUT OF A
 * CREATE, AND IS THEN STORED AS THAT DEFAULT.
 *
 * A @TableColumn's defaultValue is what the API reference and the Terraform
 * schema promise a client: the column is optional on create, with that
 * default (ModelSchema, TerraformSchema). DatabaseService.checkRequiredFields
 * keeps the promise only when the column is also flagged
 * isDefaultValueColumn - the insert then leaves the column out and Postgres
 * writes its DEFAULT. Without the flag a create that leaves the column out
 * is refused: "<column> is required".
 *
 * Issue #5158: a threat intel feed created from the Dashboard was refused,
 * "isEnabled is required". The feed's form leaves Enabled to the edit form -
 * a new feed is polled - so it sends no isEnabled, and the column was not
 * flagged. A detection rule's form does the same. This guard used to keep
 * 29 such columns on a list of known exceptions, on the belief that the
 * Dashboard's forms always send their defaults; two of them did not, and an
 * API, Terraform or workflow client never had to. All 29 are flagged now
 * (RequiredColumnDefaultsCreateContract holds each one's create), and there
 * is no list: no exceptions.
 *
 * The flag is half of the promise. The insert leaves the column out, so the
 * database must hold the very default the API reference names: the second
 * test reads each such column's @Column default - what the migrations create,
 * and Scripts/Postgres/CheckSchemaDrift holds the database to - and requires
 * it to equal the declared one.
 *
 * The detectors are pinned on models made here first, then run over every
 * model.
 */

// "<Model>.<column>" for every required column with a declared default that a create may not leave out.
function refusedWhenLeftOut(
  modelTypes: ReadonlyArray<DatabaseBaseModelType>,
): Array<string> {
  const found: Array<string> = [];

  for (const modelType of modelTypes) {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new modelType(),
    );

    for (const column of Object.keys(columns)) {
      const metadata: TableColumnMetadata | undefined = columns[column];

      if (
        metadata &&
        hasDeclaredDefault(metadata) &&
        !metadata.isDefaultValueColumn
      ) {
        found.push(`${modelType.name}.${column}`);
      }
    }
  }

  return found.sort();
}

function hasDeclaredDefault(metadata: TableColumnMetadata): boolean {
  return (
    Boolean(metadata.required) &&
    metadata.defaultValue !== undefined &&
    metadata.defaultValue !== null
  );
}

// The @Column a model (or a model it extends) declares for `propertyName`.
function databaseColumnOf(
  modelType: DatabaseBaseModelType,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  const lineage: Array<unknown> = [];

  for (
    let target: unknown = modelType;
    typeof target === "function" && target !== Function.prototype;
    target = Object.getPrototypeOf(target)
  ) {
    lineage.push(target);
  }

  return getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs): boolean => {
      return (
        args.propertyName === propertyName && lineage.includes(args.target)
      );
    })
    .pop();
}

// A JSON value - a plain object or a list - is compared as JSON; anything else as text.
function asComparableText(value: unknown): string {
  const isJson: boolean =
    Array.isArray(value) ||
    (typeof value === "object" &&
      value !== null &&
      Object.getPrototypeOf(value) === Object.prototype);

  return isJson ? JSON.stringify(value) : String(value);
}

/*
 * A raw SQL default without its quotes and cast, as a value: 'All'::character
 * varying is All, '{}' is {}. Anything else (now(), a number) as written.
 */
function sqlLiteralValue(sql: string): string {
  const closingQuote: number = sql.lastIndexOf("'");
  const rest: string = sql.slice(closingQuote + 1);

  if (
    !sql.startsWith("'") ||
    closingQuote < 1 ||
    (rest !== "" && !rest.startsWith("::"))
  ) {
    return sql;
  }

  return sql.slice(1, closingQuote).split("''").join("'");
}

/*
 * The default Postgres writes for a column the insert leaves out, as text
 * that compares with the declared one; null when there is none.
 */
function databaseDefaultText(column: ColumnMetadataArgs): string | null {
  const value: unknown = column.options.default;

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "function") {
    return sqlLiteralValue(String((value as () => unknown)()).trim());
  }

  return asComparableText(value);
}

function declaredDefaultText(metadata: TableColumnMetadata): string {
  return asComparableText(metadata.defaultValue);
}

/*
 * "<Model>.<column>: declared <x>, database <y>" for every required column
 * with a declared default that Postgres would not store as that default
 * when a create leaves it out.
 */
function storedOtherThanDeclared(
  modelTypes: ReadonlyArray<DatabaseBaseModelType>,
): Array<string> {
  const found: Array<string> = [];

  for (const modelType of modelTypes) {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new modelType(),
    );

    for (const column of Object.keys(columns)) {
      const metadata: TableColumnMetadata | undefined = columns[column];

      if (!metadata || !hasDeclaredDefault(metadata)) {
        continue;
      }

      const databaseColumn: ColumnMetadataArgs | undefined = databaseColumnOf(
        modelType,
        column,
      );
      const declared: string = declaredDefaultText(metadata);
      const stored: string | null = databaseColumn
        ? databaseDefaultText(databaseColumn)
        : null;

      if (stored !== declared) {
        found.push(
          `${modelType.name}.${column}: declared ${declared}, database ${
            stored === null ? "no default" : stored
          }`,
        );
      }
    }
  }

  return found.sort();
}

// Models shaped like the columns the guard exists for.
class FeedLikeIssue5158 extends BaseModel {
  // Required, documented as defaulting to on, not flagged: a create without it is refused.
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    defaultValue: true,
  })
  @Column({ nullable: false, type: ColumnType.Boolean, default: true })
  public isEnabled?: boolean = undefined;

  // Flagged: a create may leave it out.
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    defaultValue: 60,
    isDefaultValueColumn: true,
  })
  @Column({ nullable: false, type: ColumnType.Number, default: 60 })
  public pollIntervalInMinutes?: number = undefined;

  // Not required: a create may always leave it out.
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    defaultValue: 0,
  })
  @Column({ nullable: true, type: ColumnType.Number, default: 0 })
  public minimumConfidence?: number = undefined;
}

class FlaggedWithoutTheDatabaseDefault extends BaseModel {
  // Flagged, but the insert would leave a NOT NULL column with nothing to write.
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({ nullable: false, type: ColumnType.Boolean })
  public isEnabled?: boolean = undefined;

  // Flagged, but Postgres would store something else than the API reference says.
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    defaultValue: "detections",
    isDefaultValueColumn: true,
  })
  @Column({ nullable: false, type: ColumnType.ShortText, default: "all" })
  public sendScope?: string = undefined;

  // Flagged, with the same default written as raw SQL: the same promise kept.
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    defaultValue: "All",
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    default: () => {
      return "'All'::character varying";
    },
  })
  public filterCondition?: string = undefined;

  // A JSON default, written as an object and as SQL text: the same.
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    defaultValue: {},
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
    default: () => {
      return "'{}'";
    },
  })
  public scope?: string = undefined;
}

const ALL_MODELS: ReadonlyArray<DatabaseBaseModelType> =
  Models as Array<DatabaseBaseModelType>;

describe("the detectors", () => {
  test("see a required column with a default that a create may not leave out", () => {
    expect(refusedWhenLeftOut([FeedLikeIssue5158])).toEqual([
      "FeedLikeIssue5158.isEnabled",
    ]);
  });

  test("see a flagged column the database would store otherwise", () => {
    expect(storedOtherThanDeclared([FlaggedWithoutTheDatabaseDefault])).toEqual(
      [
        "FlaggedWithoutTheDatabaseDefault.isEnabled: declared true, database no default",
        "FlaggedWithoutTheDatabaseDefault.sendScope: declared detections, database all",
      ],
    );
    expect(storedOtherThanDeclared([FeedLikeIssue5158])).toEqual([]);
  });
});

describe("required columns with a declared default", () => {
  test("every one can be left out of a create, as the API reference says", () => {
    // Flag each isDefaultValueColumn (its @Column needs a Postgres DEFAULT).
    expect(refusedWhenLeftOut(ALL_MODELS)).toEqual([]);
  });

  test("every one left out is stored as the default the API reference names", () => {
    // Give the @Column the declared default (and the migration that adds it).
    expect(storedOtherThanDeclared(ALL_MODELS)).toEqual([]);
  });

  test("the check reads every model, and the columns it is about", () => {
    let checked: number = 0;

    for (const modelType of ALL_MODELS) {
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(
        new modelType(),
      );

      checked += Object.values(columns).filter(
        (metadata: TableColumnMetadata): boolean => {
          return hasDeclaredDefault(metadata);
        },
      ).length;
    }

    // Hundreds of models, and over 500 required columns with a default.
    expect(ALL_MODELS.length).toBeGreaterThan(300);
    expect(checked).toBeGreaterThan(500);
  });

  test("the guard sees a column like the one #5095 added", () => {
    // LlmCostBudget.spendSource without its flag would be caught.
    const budget: Dictionary<TableColumnMetadata> = getTableColumns(
      new (ALL_MODELS.find((modelType: DatabaseBaseModelType): boolean => {
        return modelType.name === "LlmCostBudget";
      }) as DatabaseBaseModelType)(),
    );
    const spendSource: TableColumnMetadata | undefined = budget["spendSource"];

    expect(spendSource?.required).toBe(true);
    expect(spendSource?.defaultValue).toBeDefined();
    expect(spendSource?.isDefaultValueColumn).toBe(true);
  });

  test("the guard sees the column issue #5158 reported", () => {
    const feed: Dictionary<TableColumnMetadata> = getTableColumns(
      new (ALL_MODELS.find((modelType: DatabaseBaseModelType): boolean => {
        return modelType.name === "ThreatIntelFeed";
      }) as DatabaseBaseModelType)(),
    );

    expect(feed["isEnabled"]?.required).toBe(true);
    expect(feed["isEnabled"]?.defaultValue).toBe(true);
    expect(feed["isEnabled"]?.isDefaultValueColumn).toBe(true);
  });
});
