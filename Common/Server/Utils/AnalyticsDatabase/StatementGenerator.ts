import ClickhouseDatabase from "../../Infrastructure/ClickhouseDatabase";
import GroupBy from "../../Types/AnalyticsDatabase/GroupBy";
import Query from "../../Types/AnalyticsDatabase/Query";
import Select from "../../Types/AnalyticsDatabase/Select";
import Sort from "../../Types/AnalyticsDatabase/Sort";
import UpdateBy from "../../Types/AnalyticsDatabase/UpdateBy";
import logger from "../Logger";
import { SQL, Statement } from "./Statement";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CommonModel, {
  Record as AnalyticsRecord,
  RecordValue,
} from "../../../Models/AnalyticsModels/AnalyticsBaseModel/CommonModel";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import AggregateBy, {
  AggregateUtil,
} from "../../Types/AnalyticsDatabase/AggregateBy";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { getPercentileLevel } from "../../../Types/BaseDatabase/AggregationType";

export default class StatementGenerator<TBaseModel extends AnalyticsBaseModel> {
  public model!: TBaseModel;
  public modelType!: { new (): TBaseModel };
  public database!: ClickhouseDatabase;

  public constructor(data: {
    modelType: { new (): TBaseModel };
    database: ClickhouseDatabase;
  }) {
    this.modelType = data.modelType;
    this.model = new this.modelType();
    this.database = data.database;
  }

  public toUpdateStatement(updateBy: UpdateBy<TBaseModel>): Statement {
    const setStatement: Statement = this.toSetStatement(updateBy.data);
    const whereStatement: Statement = this.toWhereStatement(updateBy.query);

    /* eslint-disable prettier/prettier */
    const statement: Statement = SQL`
            ALTER TABLE ${this.database.getDatasourceOptions().database!}.${
              this.model.tableName
            }
            UPDATE `
      .append(setStatement)
      .append(
        SQL`
            WHERE TRUE `
      )
      .append(whereStatement);
    /* eslint-enable prettier/prettier */

    logger.debug(`${this.model.tableName} Update Statement`);
    logger.debug(statement);

    return statement;
  }

  public getColumnNames(
    tableColumns: Array<AnalyticsTableColumn>,
  ): Array<string> {
    const columnNames: Array<string> = [];
    for (const column of tableColumns) {
      columnNames.push(column.key);
    }

    return columnNames;
  }

  public getRecordValuesStatement(record: AnalyticsRecord): string {
    let valueStatement: string = "";

    for (const value of record) {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          valueStatement += `[], `;
          continue;
        }

        valueStatement += `[${value.join(",")}], `;
      } else {
        valueStatement += `${value}, `;
      }
    }

    valueStatement = valueStatement.substring(0, valueStatement.length - 2); // remove last comma.

    return valueStatement;
  }

  public getValuesStatement(records: Array<AnalyticsRecord>): string {
    let statement: string = "";
    for (const record of records) {
      statement += `(${this.getRecordValuesStatement(record)}), `;
    }

    statement = statement.substring(0, statement.length - 2); // remove last comma.

    return statement;
  }

  public toCreateStatement(data: { item: Array<TBaseModel> }): string {
    if (!data.item) {
      throw new BadDataException("Item cannot be null");
    }

    const columnNames: Array<string> = this.getColumnNames(
      this.model.getTableColumns(),
    );

    const records: Array<AnalyticsRecord> = [];

    for (const item of data.item) {
      const record: AnalyticsRecord = this.getRecord(item);
      records.push(record);
    }

    /*
     * we need async insert to be enabled for clickhouse to work.
     * otherwise too many parts will be created.
     */

    const statement: string = `INSERT INTO ${
      this.database.getDatasourceOptions().database
    }.${this.model.tableName} 
        ( 
            ${columnNames.join(", ")}
        ) SETTINGS async_insert=1, wait_for_async_insert=0
        VALUES
        ${this.getValuesStatement(records)}
        `;

    logger.debug(`${this.model.tableName} Create Statement`);
    logger.debug(statement);

    return statement;
  }

  private getRecord(item: CommonModel): AnalyticsRecord {
    const record: AnalyticsRecord = [];

    for (const column of item.getTableColumns()) {
      const value: RecordValue | undefined = this.sanitizeValue(
        item.getColumnValue(column.key),
        column,
      );

      record.push(value);
    }

    return record;
  }

  private escapeStringLiteral(raw: string): string {
    // escape String literal based on https://clickhouse.com/docs/en/sql-reference/syntax#string
    return `'${raw.replace(/'|\\/g, "\\$&")}'`;
  }

  private sanitizeValue(
    value: RecordValue | undefined,
    column: AnalyticsTableColumn,
    options?: {
      isNestedModel?: boolean;
    },
  ): RecordValue {
    if (!value && value !== 0 && value !== false) {
      if (options?.isNestedModel) {
        if (column.type === TableColumnType.Text) {
          return `''`;
        }

        if (column.type === TableColumnType.Number) {
          return 0;
        }
      }

      return "NULL";
    }

    if (
      column.type === TableColumnType.ObjectID ||
      column.type === TableColumnType.Text
    ) {
      value = this.escapeStringLiteral(value?.toString());
    }

    if (column.type === TableColumnType.Date && value instanceof Date) {
      value = `parseDateTimeBestEffortOrNull('${OneUptimeDate.toString(
        value as Date,
      )}')`;
    }

    if (column.type === TableColumnType.DateTime64 && value instanceof Date) {
      value = `parseDateTimeBestEffortOrNull('${OneUptimeDate.toClickhouseDateTime64(
        value as Date,
      )}')`;
    }

    if (column.type === TableColumnType.Number) {
      if (typeof value === "string") {
        value = parseInt(value);
      }
    }

    if (column.type === TableColumnType.Decimal) {
      if (typeof value === "string") {
        value = parseFloat(value);
      }
    }

    if (column.type === TableColumnType.ArrayNumber) {
      value = `[${(value as Array<number>)
        .map((v: number) => {
          if (v && typeof v !== "number") {
            v = parseFloat(v);
            return isNaN(v) ? "NULL" : v;
          }
          return v;
        })
        .join(", ")}]`;
    }

    if (column.type === TableColumnType.ArrayText) {
      value = `[${(value as Array<string>)
        .map((v: string) => {
          return this.escapeStringLiteral(v);
        })
        .join(", ")}]`;
    }

    if (
      column.type === TableColumnType.JSON ||
      column.type === TableColumnType.JSONArray
    ) {
      value = this.escapeStringLiteral(JSON.stringify(value));
    }

    if (column.type === TableColumnType.LongNumber) {
      value = `CAST(${this.escapeStringLiteral(value.toString())} AS Int128)`;
    }

    if (column.type === TableColumnType.BigNumber) {
      if (typeof value === "string") {
        value = parseInt(value);
      }
    }

    if (column.type === TableColumnType.ArrayBigNumber) {
      value = `[${(value as Array<number>)
        .map((v: number) => {
          if (v && typeof v !== "number") {
            v = parseFloat(v);
            return isNaN(v) ? "NULL" : v;
          }
          return v;
        })
        .join(", ")}]`;
    }

    if (column.type === TableColumnType.ArrayDecimal) {
      value = `[${(value as Array<number>)
        .map((v: number) => {
          if (v && typeof v !== "number") {
            v = parseFloat(v);
            return isNaN(v) ? "NULL" : v;
          }
          /*
           * Filter non-finite (NaN/+Inf/-Inf) -> NULL so ClickHouse Float64
           * serialization succeeds (mirrors `toNumberOrNull` in OTLP ingest).
           */
          if (typeof v === "number" && !Number.isFinite(v)) {
            return "NULL";
          }
          return v;
        })
        .join(", ")}]`;
    }

    if (column.type === TableColumnType.MapStringString) {
      const mapObj: Record<string, string> = value as Record<string, string>;
      const entries: Array<string> = Object.entries(mapObj)
        .filter(([k, v]: [string, string | undefined]) => {
          return k !== undefined && k !== null && v !== undefined && v !== null;
        })
        .map(([k, v]: [string, string]) => {
          return `${this.escapeStringLiteral(k)}, ${this.escapeStringLiteral(v)}`;
        });
      value = `map(${entries.join(", ")})`;
    }

    return value;
  }

  public toSetStatement(data: TBaseModel): Statement {
    const setStatement: Statement = new Statement();

    let first: boolean = true;
    for (const column of data.getTableColumns()) {
      const value: RecordValue | undefined = data.getColumnValue(column.key);
      if (value !== undefined) {
        if (first) {
          first = false;
        } else {
          setStatement.append(SQL`, `);
        }

        /*
         * special case - ClickHouse does not support using query
         * parameters for column names in the SET statement so we
         * have to trust the column names here.
         */
        const keyStatement: string = column.key;

        setStatement.append(keyStatement).append(
          SQL` = ${{
            value,
            type: column.type,
          }}`,
        );
      }
    }

    return setStatement;
  }

  /**
   * Conditions to append to "WHERE TRUE"
   */
  public toWhereStatement(query: Query<TBaseModel>): Statement {
    const whereStatement: Statement = new Statement();

    let first: boolean = true;
    for (const key in query) {
      const value: any = query[key];
      const tableColumn: AnalyticsTableColumn | null =
        this.model.getTableColumn(key);

      if (!tableColumn) {
        throw new BadDataException(`Unknown column: ${key}`);
      }

      if (first) {
        first = false;
      } else {
        whereStatement.append(SQL` `);
      }

      if (value instanceof Search) {
        whereStatement.append(
          SQL`AND ${key} ILIKE ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof NotEqual) {
        whereStatement.append(
          SQL`AND ${key} != ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof GreaterThan) {
        whereStatement.append(
          SQL`AND ${key} > ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof LessThan) {
        whereStatement.append(
          SQL`AND ${key} < ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof LessThanOrEqual) {
        whereStatement.append(
          SQL`AND ${key} <= ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof LessThanOrNull) {
        whereStatement.append(
          SQL`AND (${key} <= ${{
            value: value,
            type: tableColumn.type,
          }} OR ${key} IS NULL)`,
        );
      } else if (value instanceof GreaterThanOrNull) {
        whereStatement.append(
          SQL`AND (${key} >= ${{
            value: value,
            type: tableColumn.type,
          }} OR ${key} IS NULL)`,
        );
      } else if (value instanceof GreaterThanOrEqual) {
        whereStatement.append(
          SQL`AND ${key} >= ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof InBetween) {
        whereStatement.append(
          SQL`AND ${key} >= ${{
            value: value.startValue,
            type: tableColumn.type,
          }} AND ${key} <= ${{
            value: value.endValue,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof Includes) {
        whereStatement.append(
          SQL`AND ${key} IN ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof IsNull) {
        if (tableColumn.type === TableColumnType.Text) {
          whereStatement.append(SQL`AND (${key} IS NULL OR ${key} = '')`);
        } else {
          whereStatement.append(SQL`AND ${key} IS NULL`);
        }
      } else if (
        tableColumn.type === TableColumnType.MapStringString &&
        typeof value === "object"
      ) {
        const mapValue: Record<string, unknown> = value as Record<
          string,
          unknown
        >;
        for (const mapKey in mapValue) {
          const mapEntry: unknown = mapValue[mapKey];
          if (mapEntry === undefined || mapEntry === null) {
            continue;
          }

          /*
           * Map filters split into two paths:
           *
           * 1. Programmatic equality / null / numeric comparisons —
           *    EqualTo, NotEqual, IsNull, NotNull, GreaterThan, etc.,
           *    or bare string/number values. Callers are dashboard
           *    pages and services that pass canonical keys already
           *    matching the stored casing, so we use ClickHouse's
           *    direct Map subscript `attributes['k']`. That's an O(1)
           *    hash lookup per row and lets the query planner push the
           *    predicate into PREWHERE, instead of paying the
           *    `arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(...))`
           *    cost which materializes mapKeys/mapValues per row and
           *    lowercases every stored key on every query. Restoring
           *    this fast path is the single biggest performance fix
           *    for Host / Logs / Traces detail pages.
           *
           * 2. User-typed substring/wildcard operators — Search,
           *    StartsWith, EndsWith, NotContains. These come from the
           *    search bar where users shouldn't have to remember
           *    whether the attribute key is `requestId` or `requestid`,
           *    so we keep the case-insensitive `arrayExists` form. The
           *    cost is acceptable because a search-bar query is
           *    bounded (one user, one click) and these operators
           *    already imply a row scan.
           *
           * ClickHouse Map subscripts return the value type's default
           * for missing keys (empty string for String values), which
           * is what the IsNull / NotNull / NotEqual branches below
           * mirror to preserve the previous semantics.
           */
          if (mapEntry instanceof IsNull) {
            whereStatement.append(
              SQL`AND ((NOT mapContains(${key}, ${{
                value: mapKey,
                type: TableColumnType.Text,
              }})) OR ${key}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}] = '')`,
            );
            continue;
          }

          if (mapEntry instanceof NotNull) {
            whereStatement.append(
              SQL`AND mapContains(${key}, ${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND ${key}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}] != ''`,
            );
            continue;
          }

          if (mapEntry instanceof Search) {
            whereStatement.append(
              SQL`AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND v ILIKE ${{
                value: mapEntry as Search<string>,
                type: TableColumnType.Text,
              }}, mapKeys(${key}), mapValues(${key}))`,
            );
            continue;
          }

          if (mapEntry instanceof NotContains) {
            const literalValue: string = `%${(mapEntry.value as string) || ""}%`;
            whereStatement.append(
              SQL`AND NOT arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND v ILIKE ${{
                value: literalValue,
                type: TableColumnType.Text,
              }}, mapKeys(${key}), mapValues(${key}))`,
            );
            continue;
          }

          if (mapEntry instanceof StartsWith) {
            const literalValue: string = `${(mapEntry.value as string) || ""}%`;
            whereStatement.append(
              SQL`AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND v ILIKE ${{
                value: literalValue,
                type: TableColumnType.Text,
              }}, mapKeys(${key}), mapValues(${key}))`,
            );
            continue;
          }

          if (mapEntry instanceof EndsWith) {
            const literalValue: string = `%${(mapEntry.value as string) || ""}`;
            whereStatement.append(
              SQL`AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND v ILIKE ${{
                value: literalValue,
                type: TableColumnType.Text,
              }}, mapKeys(${key}), mapValues(${key}))`,
            );
            continue;
          }

          if (mapEntry instanceof NotEqual) {
            whereStatement.append(
              SQL`AND ${key}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}] != ${{
                value: String((mapEntry as NotEqual<string>).value ?? ""),
                type: TableColumnType.Text,
              }}`,
            );
            continue;
          }

          if (mapEntry instanceof EqualTo) {
            whereStatement.append(
              SQL`AND ${key}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}] = ${{
                value: String((mapEntry as EqualTo<any>).value ?? ""),
                type: TableColumnType.Text,
              }}`,
            );
            continue;
          }

          /*
           * Map values are stored as text; cast to Float64 for numeric
           * comparisons. toFloat64OrNull yields NULL for non-numeric
           * values (including the empty-string default for missing
           * keys), which compares to false against any numeric
           * threshold and naturally drops those rows.
           */
          if (mapEntry instanceof GreaterThan) {
            whereStatement.append(
              SQL`AND toFloat64OrNull(${key}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}]) > ${{
                value: Number((mapEntry as GreaterThan<any>).value),
                type: TableColumnType.Number,
              }}`,
            );
            continue;
          }

          if (mapEntry instanceof GreaterThanOrEqual) {
            whereStatement.append(
              SQL`AND toFloat64OrNull(${key}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}]) >= ${{
                value: Number((mapEntry as GreaterThanOrEqual<any>).value),
                type: TableColumnType.Number,
              }}`,
            );
            continue;
          }

          if (mapEntry instanceof LessThan) {
            whereStatement.append(
              SQL`AND toFloat64OrNull(${key}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}]) < ${{
                value: Number((mapEntry as LessThan<any>).value),
                type: TableColumnType.Number,
              }}`,
            );
            continue;
          }

          if (mapEntry instanceof LessThanOrEqual) {
            whereStatement.append(
              SQL`AND toFloat64OrNull(${key}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}]) <= ${{
                value: Number((mapEntry as LessThanOrEqual<any>).value),
                type: TableColumnType.Number,
              }}`,
            );
            continue;
          }

          // Bare string/number/boolean — direct Map subscript.
          whereStatement.append(
            SQL`AND ${key}[${{
              value: mapKey,
              type: TableColumnType.Text,
            }}] = ${{
              value: String(mapEntry),
              type: TableColumnType.Text,
            }}`,
          );
        }
      } else if (
        (tableColumn.type === TableColumnType.JSON ||
          tableColumn.type === TableColumnType.JSONArray) &&
        typeof value === "object"
      ) {
        const flatValue: JSONObject = JSONFunctions.flattenObject(value);

        for (const objKey in flatValue) {
          if (flatValue[objKey] === undefined) {
            continue;
          }

          if (flatValue[objKey] && typeof flatValue[objKey] === "string") {
            whereStatement.append(
              SQL`AND JSONExtractString(${key}, ${{
                value: objKey,
                type: TableColumnType.Text,
              }}) = ${{
                value: flatValue[objKey] as string,
                type: TableColumnType.Text,
              }}`,
            );
            continue;
          }

          if (flatValue[objKey] && typeof flatValue[objKey] === "number") {
            whereStatement.append(
              SQL`AND JSONExtractInt(${key}, ${{
                value: objKey,
                type: TableColumnType.Text,
              }}) = ${{
                value: flatValue[objKey] as number,
                type: TableColumnType.Number,
              }}`,
            );
            continue;
          }

          if (flatValue[objKey] && typeof flatValue[objKey] === "boolean") {
            whereStatement.append(
              SQL`AND JSONExtractBool(${key}, ${{
                value: objKey,
                type: TableColumnType.Text,
              }}) = ${{
                value: flatValue[objKey] as any,
                type: TableColumnType.Boolean,
              }}`,
            );
            continue;
          }
        }
      } else {
        whereStatement.append(
          SQL`AND ${key} = ${{ value, type: tableColumn.type }}`,
        );
      }
    }

    return whereStatement;
  }

  public toGroupByStatement(groupBy: GroupBy<TBaseModel>): Statement {
    const groupByStatement: Statement = new Statement();

    let first: boolean = true;
    for (const key in groupBy) {
      if (!this.model.getTableColumn(key)) {
        throw new BadDataException(`Unknown column: ${key}`);
      }

      if (first) {
        first = false;
      } else {
        groupByStatement.append(SQL`, `);
      }
      groupByStatement.append(SQL`${key}`);
    }

    return groupByStatement;
  }

  public toSortStatement(sort: Sort<TBaseModel>): Statement {
    const sortStatement: Statement = new Statement();

    for (const key in sort) {
      if (!this.model.getTableColumn(key)) {
        throw new BadDataException(`Unknown column: ${key}`);
      }

      const value: SortOrder = sort[key]!;
      sortStatement.append(SQL`${key} `).append(
        {
          [SortOrder.Ascending]: SQL`ASC`,
          [SortOrder.Descending]: SQL`DESC`,
        }[value],
      );
    }

    return sortStatement;
  }

  public toSelectStatement(select: Select<TBaseModel>): {
    statement: Statement;
    columns: Array<string>;
  } {
    const selectStatement: Statement = new Statement();
    const columns: Array<string> = [];

    let first: boolean = true;
    for (const key in select) {
      const value: any = select[key];
      if (value) {
        if (!this.model.getTableColumn(key)) {
          throw new BadDataException(`Unknown column: ${key}`);
        }

        columns.push(key);
        if (first) {
          first = false;
        } else {
          selectStatement.append(SQL`, `);
        }
        selectStatement.append(SQL`${key}`);
      }
    }

    return {
      columns: columns,
      statement: selectStatement,
    };
  }

  public toAggregateSelectStatement(aggregateBy: AggregateBy<TBaseModel>): {
    statement: Statement;
    columns: Array<string>;
  } {
    /*
     * EXAMPLE:
     * SELECT sum(Metric.value) as avg_value, date_trunc('hour', toStartOfInterval(createdAt, INTERVAL 1 hour)) as createdAt
     *
     * Percentile aggregations (P50/P90/P95/P99) compile to ClickHouse's
     * `quantile(level)(column)`. This is the right thing for scalar
     * columns (Span.duration, Metric.value when the metric is a Sum or
     * Gauge, etc.). MetricService overrides this method when it has
     * histogram bucket data so the percentile is computed from the
     * actual sample distribution rather than from the per-row aggregated
     * value.
     */

    const selectStatement: Statement = new Statement();

    const aggregationInterval: string = AggregateUtil.getAggregationInterval({
      startDate: aggregateBy.startTimestamp!,
      endDate: aggregateBy.endTimestamp!,
    });
    const aggregationColumn: string =
      aggregateBy.aggregateColumnName.toString();
    const aggregationTimestampColumn: string =
      aggregateBy.aggregationTimestampColumnName.toString();

    const percentileLevel: number | null = getPercentileLevel(
      aggregateBy.aggregationType,
    );
    const aggregationExpression: string =
      percentileLevel !== null
        ? `quantile(${percentileLevel})(${aggregationColumn})`
        : `${aggregateBy.aggregationType.toLocaleLowerCase()}(${aggregationColumn})`;

    selectStatement.append(
      `${aggregationExpression} as ${aggregationColumn}, date_trunc('${aggregationInterval.toLowerCase()}', toStartOfInterval(${aggregationTimestampColumn}, INTERVAL 1 ${aggregationInterval.toLowerCase()})) as ${aggregationTimestampColumn}`,
    );

    const columns: Array<string> = [
      aggregateBy.aggregateColumnName.toString(),
      aggregateBy.aggregationTimestampColumnName.toString(),
    ];

    if (aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0) {
      const groupByStatement: Statement = this.toGroupByStatement(
        aggregateBy.groupBy,
      );
      selectStatement.append(SQL`, `).append(groupByStatement);

      // add to columns.
      for (const key in aggregateBy.groupBy) {
        columns.push(key);
      }
    }

    return {
      columns: columns,
      statement: selectStatement,
    };
  }

  public getColumnTypesStatement(columnName: string): string {
    return `SELECT type FROM system.columns WHERE table = '${
      this.model.tableName
    }' AND database = '${
      this.database.getDatasourceOptions().database
    }' AND name = '${columnName}'`;
  }

  @CaptureSpan()
  public async toRenameColumnStatement(
    oldColumnName: string,
    newColumnName: string,
  ): Promise<Statement> {
    const statement: string = `ALTER TABLE ${
      this.database.getDatasourceOptions().database
    }.${
      this.model.tableName
    } RENAME COLUMN IF EXISTS ${oldColumnName} TO ${newColumnName}`;

    return SQL`${statement}`;
  }

  public toColumnsCreateStatement(
    tableColumns: Array<AnalyticsTableColumn>,
  ): Statement {
    const columns: Statement = new Statement();

    for (let i: number = 0; i < tableColumns.length; i++) {
      const column: AnalyticsTableColumn = tableColumns[i]!;

      if (i !== 0) {
        columns.append(SQL`, `);
      }

      /*
       * special case - ClickHouse does not support using an a query parameter
       * to specify the column name when creating the table
       */
      const keyStatement: string = column.key;

      /*
       * ClickHouse rejects `Nullable(AggregateFunction(...))`, so
       * AggregateFunction columns always emit unwrapped — the engine
       * already handles "no state yet" cases via the empty initial
       * state of each aggregate function.
       */
      const isAggregateFunction: boolean =
        column.type === TableColumnType.AggregateFunction;
      columns
        .append(keyStatement)
        .append(SQL` `)
        .append(
          column.required || isAggregateFunction
            ? this.toColumnType(column)
            : SQL`Nullable(`.append(this.toColumnType(column)).append(SQL`)`),
        );

      // Append CODEC if specified
      if (column.codec) {
        const codecStr: string =
          column.codec.level !== undefined
            ? `${column.codec.codec}(${column.codec.level})`
            : column.codec.codec;
        columns.append(` CODEC(${codecStr})`);
      }
    }

    // Append skip indexes after column definitions
    const skipIndexColumns: Array<AnalyticsTableColumn> = tableColumns.filter(
      (col: AnalyticsTableColumn) => {
        return col.skipIndex !== undefined;
      },
    );

    for (const col of skipIndexColumns) {
      const idx: AnalyticsTableColumn["skipIndex"] = col.skipIndex!;
      const paramsStr: string =
        idx.params && idx.params.length > 0 ? `(${idx.params.join(", ")})` : "";
      /*
       * tokenbf_v1 and ngrambf_v1 indexes do not support Nullable columns in ClickHouse.
       * Wrap with assumeNotNull() for Nullable (non-required) columns.
       */
      const needsAssumeNotNull: boolean =
        !col.required &&
        (idx.type === SkipIndexType.TokenBF ||
          idx.type === SkipIndexType.NgramBF);
      const columnExpr: string = needsAssumeNotNull
        ? `assumeNotNull(${col.key})`
        : col.key;
      columns.append(
        `, INDEX ${idx.name} ${columnExpr} TYPE ${idx.type}${paramsStr} GRANULARITY ${idx.granularity}`,
      );
    }

    // Append projections after indexes
    if (this.model.projections && this.model.projections.length > 0) {
      for (const projection of this.model.projections) {
        columns.append(`, PROJECTION ${projection.name} (${projection.query})`);
      }
    }

    return columns;
  }

  public toTableColumnType(
    clickhouseType: string,
  ): TableColumnType | undefined {
    return {
      String: TableColumnType.Text,
      Int32: TableColumnType.Number,
      Int64: TableColumnType.BigNumber,
      Int128: TableColumnType.LongNumber,
      Float32: TableColumnType.Decimal,
      Float64: TableColumnType.Decimal,
      DateTime: TableColumnType.Date,
      "DateTime64(9)": TableColumnType.DateTime64,
      "Array(String)": TableColumnType.ArrayText,
      "Array(Int32)": TableColumnType.ArrayNumber,
      "Array(Int64)": TableColumnType.ArrayBigNumber,
      "Array(Float64)": TableColumnType.ArrayDecimal,
      "Map(String, String)": TableColumnType.MapStringString,
      JSON: TableColumnType.JSON, //JSONArray is also JSON
      Bool: TableColumnType.Boolean,
    }[clickhouseType];
  }

  /**
   * ClickHouse type fragment for a column. The full column object is
   * passed in (not just the type) because parameterized types like
   * `AggregateFunction(...)` need to read additional fields off the
   * column. Scalar types ignore the rest of the column.
   */
  public toColumnType(column: AnalyticsTableColumn): Statement {
    if (column.type === TableColumnType.AggregateFunction) {
      const def: string | undefined = column.aggregateFunctionDefinition;
      if (!def) {
        throw new BadDataException(
          `Column ${column.key} is AggregateFunction but missing aggregateFunctionDefinition.`,
        );
      }
      return SQL`AggregateFunction(`.append(def).append(SQL`)`);
    }

    const statement: Statement | undefined = {
      [TableColumnType.Text]: SQL`String`,
      [TableColumnType.ObjectID]: SQL`String`,
      [TableColumnType.Boolean]: SQL`Bool`,
      [TableColumnType.Number]: SQL`Int32`,
      [TableColumnType.Decimal]: SQL`Double`,
      [TableColumnType.IP]: SQL`String`,
      [TableColumnType.Port]: SQL`String`,
      [TableColumnType.Date]: SQL`DateTime`,
      [TableColumnType.DateTime64]: SQL`DateTime64(9)`,
      [TableColumnType.JSON]: SQL`String`, // we use JSON as a string because ClickHouse has really good JSON support for string types
      [TableColumnType.JSONArray]: SQL`String`, // we use JSON as a string because ClickHouse has really good JSON support for string types
      [TableColumnType.ArrayNumber]: SQL`Array(Int32)`,
      [TableColumnType.ArrayBigNumber]: SQL`Array(Int64)`,
      [TableColumnType.ArrayDecimal]: SQL`Array(Float64)`,
      [TableColumnType.ArrayText]: SQL`Array(String)`,
      [TableColumnType.LongNumber]: SQL`Int128`,
      [TableColumnType.BigNumber]: SQL`Int64`,
      [TableColumnType.MapStringString]: SQL`Map(String, String)`,
      [TableColumnType.UInt8]: SQL`UInt8`,
    }[column.type];

    if (!statement) {
      throw new BadDataException(
        `Unknown column type: ${column.type}. Please add support for this column type.`,
      );
    }

    return statement;
  }

  public toDoesColumnExistStatement(columnName: string): string {
    const statement: string = `SELECT name FROM system.columns WHERE table = '${
      this.model.tableName
    }' AND database = '${this.database.getDatasourceOptions()
      .database!}' AND name = '${columnName}'`;

    logger.debug(`${this.model.tableName} Does Column Exist Statement`);
    logger.debug(statement);

    return statement;
  }

  public toAddColumnStatement(column: AnalyticsTableColumn): Statement {
    // Build column definition without skip index (indexes must be added separately via ADD INDEX)
    const columnDef: Statement = new Statement();

    const isAggregateFunction: boolean =
      column.type === TableColumnType.AggregateFunction;
    columnDef
      .append(column.key)
      .append(SQL` `)
      .append(
        column.required || isAggregateFunction
          ? this.toColumnType(column)
          : SQL`Nullable(`.append(this.toColumnType(column)).append(SQL`)`),
      );

    if (column.codec) {
      const codecStr: string =
        column.codec.level !== undefined
          ? `${column.codec.codec}(${column.codec.level})`
          : column.codec.codec;
      columnDef.append(` CODEC(${codecStr})`);
    }

    const statement: Statement = SQL`
            ALTER TABLE ${this.database.getDatasourceOptions().database!}.${
              this.model.tableName
            } ADD COLUMN IF NOT EXISTS `.append(columnDef);

    logger.debug(`${this.model.tableName} Add Column Statement`);
    logger.debug(statement);

    return statement;
  }

  public toAddSkipIndexStatement(
    column: AnalyticsTableColumn,
  ): Statement | null {
    if (!column.skipIndex) {
      return null;
    }

    const idx: AnalyticsTableColumn["skipIndex"] = column.skipIndex;
    const paramsStr: string =
      idx.params && idx.params.length > 0 ? `(${idx.params.join(", ")})` : "";

    const needsAssumeNotNull: boolean =
      !column.required &&
      (idx.type === SkipIndexType.TokenBF ||
        idx.type === SkipIndexType.NgramBF);
    const columnExpr: string = needsAssumeNotNull
      ? `assumeNotNull(${column.key})`
      : column.key;

    const databaseName: string = this.database.getDatasourceOptions().database!;
    const statement: Statement = new Statement();
    statement.append(
      `ALTER TABLE ${databaseName}.${this.model.tableName} ADD INDEX IF NOT EXISTS ${idx.name} ${columnExpr} TYPE ${idx.type}${paramsStr} GRANULARITY ${idx.granularity}`,
    );

    logger.debug(`${this.model.tableName} Add Skip Index Statement`);
    logger.debug(statement);

    return statement;
  }

  public toDropSkipIndexStatement(indexName: string): string {
    const databaseName: string = this.database.getDatasourceOptions().database!;
    const statement: string = `ALTER TABLE ${databaseName}.${this.model.tableName} DROP INDEX IF EXISTS ${indexName}`;

    logger.debug(`${this.model.tableName} Drop Skip Index Statement`);
    logger.debug(statement);

    return statement;
  }

  public toDropColumnStatement(columnName: string): string {
    const statement: string = `ALTER TABLE ${this.database.getDatasourceOptions()
      .database!}.${this.model.tableName} DROP COLUMN IF EXISTS ${columnName}`;

    logger.debug(`${this.model.tableName} Drop Column Statement`);
    logger.debug(statement);

    return statement;
  }

  public toTableCreateStatement(): Statement {
    const databaseName: string = this.database.getDatasourceOptions().database!;
    const columnsStatement: Statement = this.toColumnsCreateStatement(
      this.model.tableColumns,
    );

    /*
     * special case - ClickHouse does not support using a query parameter
     * to specify the table engine
     */
    const tableEngineStatement: string = this.model.tableEngine;

    const partitionKey: string = this.model.partitionKey;

    const statement: Statement = SQL`
            CREATE TABLE IF NOT EXISTS ${databaseName}.${this.model.tableName}
            (\n`
      .append(columnsStatement)
      .append(
        SQL`
            )
            ENGINE = `,
      )
      .append(tableEngineStatement).append(`
        PARTITION BY (${partitionKey})
        `).append(SQL`
            PRIMARY KEY (`);

    for (let i: number = 0; i < this.model.primaryKeys.length; i++) {
      const key: string = this.model.primaryKeys[i]!;
      if (i !== 0) {
        statement.append(SQL`, `);
      }
      statement.append(SQL`${key}`);
    }

    statement.append(SQL`)
            ORDER BY (`);

    for (let i: number = 0; i < this.model.sortKeys.length; i++) {
      const key: string = this.model.sortKeys[i]!;
      if (i !== 0) {
        statement.append(SQL`, `);
      }
      statement.append(SQL`${key}`);
    }

    statement.append(SQL`)`);

    // Append TTL if specified
    if (this.model.ttlExpression) {
      statement.append(`\nTTL ${this.model.ttlExpression}`);
    }

    /* eslint-enable prettier/prettier */

    logger.debug(`${this.model.tableName} Table Create Statement`);
    logger.debug(statement);

    return statement;
  }
}
