import ClickhouseDatabase from "../../Infrastructure/ClickhouseDatabase";
import GroupBy from "../../Types/AnalyticsDatabase/GroupBy";
import Query from "../../Types/AnalyticsDatabase/Query";
import Select from "../../Types/AnalyticsDatabase/Select";
import Sort from "../../Types/AnalyticsDatabase/Sort";
import UpdateBy from "../../Types/AnalyticsDatabase/UpdateBy";
import logger from "../Logger";
import {
  QualifiedColumn,
  SQL,
  Statement,
  escapeIlikePattern,
} from "./Statement";
import {
  adaptTableSettingsForStorage,
  getDistributedEngine,
  getStorageEngine,
  getStorageTableName,
  onClusterClause,
} from "./ClusterConfig";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CommonModel, {
  Record as AnalyticsRecord,
  RecordValue,
} from "../../../Models/AnalyticsModels/AnalyticsBaseModel/CommonModel";
import AnalyticsTableColumn, {
  ColumnCodecConfig,
  ColumnCodecValue,
  SkipIndexType,
} from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import ObjectID from "../../../Types/ObjectID";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import GenericObject from "../../../Types/GenericObject";
import Search from "../../../Types/BaseDatabase/Search";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
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
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { getPercentileLevel } from "../../../Types/BaseDatabase/AggregationType";

/**
 * Value carried under the synthetic query key "entityScope": the
 * entity-membership read with an attribute OR-fallback. Rows stamped with
 * `entityKeys` are matched via the bloom-indexed membership column; rows
 * ingested before the column existed (empty array, no backfill by decision)
 * still match via the resource attribute. See
 * Internal/Docs/OpenTelemetryEntities.md (phase-4 read-switch).
 */
export interface EntityScopeQueryValue {
  entityKeys: Array<string>;
  attributeKey: string;
  attributeValue: string;
}

/**
 * One element of the synthetic query key "resourceEntityScopes": a single
 * resource-facet selection (a Kubernetes cluster, a host, ...) already
 * resolved to every way a row can prove it belongs to that resource.
 *
 * Unlike `entityScope` this carries an `entityIds` branch, because the same
 * resource can be a row's PRIMARY entity (agent-ingested telemetry, where
 * `primaryEntityId` holds the resource id) or merely one of its
 * memberships (OTLP telemetry primary-keyed on its Service, where the
 * resource only appears in `entityKeys`). Matching just one of the two is
 * what made a Kubernetes cluster filter return nothing for
 * collector-ingested logs.
 *
 * The three branches OR inside one scope; scopes AND with each other, so
 * two different facets intersect.
 */
export interface ResourceEntityScopeQueryValue {
  entityIds?: Array<string> | undefined;
  entityKeys?: Array<string> | undefined;
  attributeKey?: string | undefined;
  attributeValues?: Array<string> | undefined;
}

const SIMPLE_AGGREGATE_FUNCTION_NAME_REGEX: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

  /*
   * Map(String,String) and JSON columns have per-sub-key handling further
   * down the operator chain; a scalar operator applied to the whole column
   * would compile to SQL ClickHouse rejects with a cryptic type error.
   * Fail with the same loud BadDataException the fallback uses.
   */
  /*
   * `(<subject> ILIKE {p0} OR <subject> ILIKE {p1} ...)` — the disjunction a
   * multi-glob Wildcard compiles to. Always parenthesised, so a caller can
   * wrap it in `NOT` or AND it into a lambda body without the OR escaping
   * its intended scope.
   */
  private static buildIlikeDisjunction(input: {
    patterns: Array<string>;
    subject: Statement;
  }): Statement {
    const disjunction: Statement = SQL`(`;

    input.patterns.forEach((pattern: string, index: number) => {
      if (index > 0) {
        disjunction.append(SQL` OR `);
      }

      disjunction.append(input.subject).append(
        SQL` ILIKE ${{
          value: pattern,
          type: TableColumnType.Text,
        }}`,
      );
    });

    return disjunction.append(SQL`)`);
  }

  private throwIfMapOrJsonColumn(input: {
    operator: QueryOperator<GenericObject | number | string>;
    tableColumn: AnalyticsTableColumn;
    key: string;
  }): void {
    if (
      input.tableColumn.type === TableColumnType.MapStringString ||
      input.tableColumn.type === TableColumnType.JSON ||
      input.tableColumn.type === TableColumnType.JSONArray
    ) {
      throw new BadDataException(
        `Unsupported query operator ${input.operator.constructor.name} on column: ${input.key}`,
      );
    }
  }

  private appendMapKeyPresenceFilter(input: {
    whereStatement: Statement;
    mapColumn: AnalyticsTableColumn;
    mapKey: string;
    skip?: boolean;
    tableAlias?: string | undefined;
  }): void {
    const mapKeysColumnName: string | undefined = input.mapColumn.mapKeysColumn;

    if (input.skip || !mapKeysColumnName) {
      return;
    }

    const mapKeysColumn: AnalyticsTableColumn | null =
      this.model.getTableColumn(mapKeysColumnName);

    if (!mapKeysColumn || mapKeysColumn.type !== TableColumnType.ArrayText) {
      return;
    }

    const keysColumnRef: string | QualifiedColumn = input.tableAlias
      ? new QualifiedColumn(input.tableAlias, mapKeysColumn.key)
      : mapKeysColumn.key;

    /*
     * Keep empty key-array rows eligible so data written before the
     * denormalized column existed, or by a lagging ingest path, is still
     * checked by the canonical map['key'] predicate that follows.
     */
    input.whereStatement.append(
      SQL`AND (empty(${keysColumnRef}) OR hasAny(${keysColumnRef}, ${{
        value: [input.mapKey],
        type: TableColumnType.ArrayText,
      }})) `,
    );
  }

  public toUpdateStatement(updateBy: UpdateBy<TBaseModel>): Statement {
    const setStatement: Statement = this.toSetStatement(updateBy.data);
    const whereStatement: Statement = this.toWhereStatement(updateBy.query);

    /*
     * `ALTER TABLE … UPDATE` is a mutation and cannot target a Distributed
     * table, so in cluster mode it runs against the local storage table and is
     * dispatched to every shard via ON CLUSTER (replicated within each shard by
     * Keeper). onClusterClause() is appended as RAW SQL — it is not an
     * identifier and must not become a {pN:Identifier} parameter — and is empty
     * in single-node mode, leaving the original statement unchanged.
     */
    /* eslint-disable prettier/prettier */
    const statement: Statement = SQL`
            ALTER TABLE ${this.database.getDatasourceOptions().database!}.${getStorageTableName(
              this.model.tableName,
            )}`
      .append(onClusterClause())
      .append(
        SQL`
            UPDATE `,
      )
      .append(setStatement)
      .append(
        SQL`
            WHERE TRUE `,
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

  private escapeStringLiteral(raw: string | undefined | null): string {
    // escape String literal based on https://clickhouse.com/docs/en/sql-reference/syntax#string
    if (raw === undefined || raw === null) {
      return "''";
    }
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

    if (column.type === TableColumnType.UInt64) {
      value = `CAST(${this.escapeStringLiteral(value.toString())} AS UInt64)`;
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
   * Conditions to append to "WHERE TRUE".
   *
   * Compiles a Query into an `AND col <op> ...` chain. When
   * `options.tableAlias` is set, every column reference is emitted
   * table-qualified (`alias.col`). Builders whose SELECT aliases an
   * expression to a real column name (aggregate statements — see
   * AggregateUtil.buildBucketTimestampSelect) MUST pass the alias of the
   * table the WHERE executes against: ClickHouse substitutes SELECT
   * aliases into same-level unqualified WHERE references, which turns a
   * `Total` aggregation's `min(col) as col` into an ILLEGAL_AGGREGATION
   * error and silently snaps bucketed time filters to bucket boundaries.
   * Statements that embed this WHERE against a different table (MV
   * paths, cascade deletes) must stay unqualified.
   */
  public toWhereStatement(
    query: Query<TBaseModel>,
    options?: { tableAlias?: string | undefined },
  ): Statement {
    const whereStatement: Statement = new Statement();

    type ColumnRefFunction = (columnName: string) => string | QualifiedColumn;
    const columnRef: ColumnRefFunction = (
      columnName: string,
    ): string | QualifiedColumn => {
      return options?.tableAlias
        ? new QualifiedColumn(options.tableAlias, columnName)
        : columnName;
    };

    let first: boolean = true;
    for (const key in query) {
      const value: any = query[key];

      /*
       * MultiSearch is a synthetic operator that fans out into an ILIKE OR
       * across multiple columns — it does not correspond to `key` itself, so
       * we resolve column metadata per field below.
       */
      if (value instanceof MultiSearch) {
        const ms: MultiSearch = value;
        if (!ms.value || ms.fields.length === 0) {
          continue;
        }

        const resolvedColumns: Array<AnalyticsTableColumn> = [];
        for (const field of ms.fields) {
          const col: AnalyticsTableColumn | null =
            this.model.getTableColumn(field);
          if (col) {
            resolvedColumns.push(col);
          }
        }

        if (resolvedColumns.length === 0) {
          continue;
        }

        if (first) {
          first = false;
          whereStatement.append(SQL`AND (`);
        } else {
          whereStatement.append(SQL` AND (`);
        }

        let isFirstCol: boolean = true;
        for (const col of resolvedColumns) {
          if (isFirstCol) {
            isFirstCol = false;
          } else {
            whereStatement.append(SQL` OR `);
          }
          whereStatement.append(
            SQL`${columnRef(col.key)} ILIKE ${{
              value: new Search<string>(ms.value),
              type: col.type,
            }}`,
          );
        }

        whereStatement.append(SQL`)`);
        continue;
      }

      /*
       * "entityScope" is a synthetic query key (not a column):
       * { entityKeys, attributeKey, attributeValue } compiles to
       *   (hasAny(entityKeys, [...]) OR attributes['k'] = 'v')
       * so new rows ride the bloom-indexed `entityKeys` membership column
       * while pre-column rows (empty array — no backfill by decision) still
       * match via the resource attribute. Both sides are parameter-bound:
       * the array exactly like the Includes/hasAny path above, the
       * attribute lookup exactly like the map-equality fast path below.
       * Ignored (no predicate, no throw) for models without an
       * `entityKeys` Array(String) column.
       */
      if (key === "entityScope") {
        const scope: EntityScopeQueryValue | undefined = value as
          | EntityScopeQueryValue
          | undefined;

        const entityKeysColumn: AnalyticsTableColumn | null =
          this.model.getTableColumn("entityKeys");

        if (
          !scope ||
          !entityKeysColumn ||
          entityKeysColumn.type !== TableColumnType.ArrayText
        ) {
          continue;
        }

        const scopeEntityKeys: Array<string> = scope.entityKeys || [];

        const attributesColumn: AnalyticsTableColumn | null =
          this.model.getTableColumn("attributes");
        const hasAttributeFallback: boolean =
          Boolean(scope.attributeKey) &&
          Boolean(attributesColumn) &&
          attributesColumn!.type === TableColumnType.MapStringString;

        if (scopeEntityKeys.length === 0 && !hasAttributeFallback) {
          continue;
        }

        if (first) {
          first = false;
        } else {
          whereStatement.append(SQL` `);
        }

        if (scopeEntityKeys.length > 0 && hasAttributeFallback) {
          whereStatement.append(
            SQL`AND (hasAny(${columnRef(entityKeysColumn.key)}, ${{
              value: scopeEntityKeys,
              type: TableColumnType.ArrayText,
            }}) OR ${columnRef(attributesColumn!.key)}[${{
              value: scope.attributeKey,
              type: TableColumnType.Text,
            }}] = ${{
              value: String(scope.attributeValue ?? ""),
              type: TableColumnType.Text,
            }})`,
          );
        } else if (scopeEntityKeys.length > 0) {
          whereStatement.append(
            SQL`AND hasAny(${columnRef(entityKeysColumn.key)}, ${{
              value: scopeEntityKeys,
              type: TableColumnType.ArrayText,
            }})`,
          );
        } else {
          whereStatement.append(
            SQL`AND ${columnRef(attributesColumn!.key)}[${{
              value: scope.attributeKey,
              type: TableColumnType.Text,
            }}] = ${{
              value: String(scope.attributeValue ?? ""),
              type: TableColumnType.Text,
            }}`,
          );
        }

        continue;
      }

      /*
       * "resourceEntityScopes" is a synthetic query key (not a column): an
       * array of already-resolved resource-facet selections. Each element
       * compiles to
       *   (primaryEntityId IN (...) OR hasAny(entityKeys, [...]) OR
       *    attributes['resource.x'] IN (...))
       * and the elements AND with each other.
       *
       * The OR is what makes one facet work across both ingestion shapes:
       * agent telemetry has the resource in `primaryEntityId`, OTLP
       * telemetry that carries a service.name only records it in
       * `entityKeys`. The AND is what makes two different facets intersect
       * ("cluster X" + "service Y") instead of union. See
       * Common/Server/Utils/Telemetry/ResourceEntityFilter.
       *
       * Every branch is parameter-bound; branches whose backing column is
       * absent on this model are dropped, and a scope left with no branch
       * at all emits no predicate (never an empty IN, which would match
       * nothing).
       */
      if (key === "resourceEntityScopes") {
        const scopes: Array<ResourceEntityScopeQueryValue> = Array.isArray(
          value,
        )
          ? (value as Array<ResourceEntityScopeQueryValue>)
          : [];

        const primaryEntityIdColumn: AnalyticsTableColumn | null =
          this.model.getTableColumn("primaryEntityId");
        const scopeEntityKeysColumn: AnalyticsTableColumn | null =
          this.model.getTableColumn("entityKeys");
        const scopeAttributesColumn: AnalyticsTableColumn | null =
          this.model.getTableColumn("attributes");

        for (const scope of scopes) {
          if (!scope || typeof scope !== "object") {
            continue;
          }

          const entityIds: Array<string> = (scope.entityIds || []).filter(
            (id: string): boolean => {
              return typeof id === "string" && id.length > 0;
            },
          );
          const membershipKeys: Array<string> = (scope.entityKeys || []).filter(
            (entityKey: string): boolean => {
              return typeof entityKey === "string" && entityKey.length > 0;
            },
          );
          const attributeValues: Array<string> = (
            scope.attributeValues || []
          ).filter((attributeValue: string): boolean => {
            return typeof attributeValue === "string";
          });

          const branches: Array<Statement> = [];

          if (entityIds.length > 0 && primaryEntityIdColumn) {
            branches.push(
              SQL`${columnRef(primaryEntityIdColumn.key)} IN ${{
                value: new Includes(entityIds),
                type: primaryEntityIdColumn.type,
              }}`,
            );
          }

          if (
            membershipKeys.length > 0 &&
            scopeEntityKeysColumn &&
            scopeEntityKeysColumn.type === TableColumnType.ArrayText
          ) {
            branches.push(
              SQL`hasAny(${columnRef(scopeEntityKeysColumn.key)}, ${{
                value: membershipKeys,
                type: TableColumnType.ArrayText,
              }})`,
            );
          }

          if (
            attributeValues.length > 0 &&
            scope.attributeKey &&
            scopeAttributesColumn &&
            scopeAttributesColumn.type === TableColumnType.MapStringString
          ) {
            branches.push(
              SQL`${columnRef(scopeAttributesColumn.key)}[${{
                value: scope.attributeKey,
                type: TableColumnType.Text,
              }}] IN ${{
                value: new Includes(attributeValues),
                type: TableColumnType.Text,
              }}`,
            );
          }

          if (branches.length === 0) {
            continue;
          }

          if (first) {
            first = false;
          } else {
            whereStatement.append(SQL` `);
          }

          whereStatement.append(SQL`AND (`);

          for (const [branchIndex, branch] of branches.entries()) {
            if (branchIndex > 0) {
              whereStatement.append(SQL` OR `);
            }
            whereStatement.append(branch);
          }

          whereStatement.append(SQL`)`);
        }

        continue;
      }

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

      /*
       * Several operators AND-ed onto ONE column — e.g.
       * `observables: [Includes([x]), IncludesNone([y])]` for "mentions x
       * AND does not mention y". The flat query map has a single slot per
       * column, so without this an AND of two predicates on the same column
       * is inexpressible (the Security Events correlation builder needs
       * it). Each element compiles through a single-key recursive call, so
       * every per-operator branch below applies unchanged; elements whose
       * branch drops the predicate (e.g. an empty Includes) contribute
       * nothing. A bare value array (exact-array equality on ArrayText)
       * has non-operator elements and falls through untouched.
       */
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((element: unknown) => {
          return element instanceof QueryOperator;
        })
      ) {
        let isFirstFragment: boolean = true;
        for (const operator of value) {
          const fragment: Statement = this.toWhereStatement(
            { [key]: operator } as Query<TBaseModel>,
            options,
          );
          if (!fragment.query) {
            continue;
          }
          if (isFirstFragment) {
            isFirstFragment = false;
          } else {
            whereStatement.append(SQL` `);
          }
          whereStatement.append(fragment);
        }
        continue;
      }

      if (
        value instanceof Search &&
        tableColumn.type === TableColumnType.ArrayText
      ) {
        /*
         * Substring search over an Array(String) column ("any element
         * contains v"): `arrayExists(x -> x ILIKE '%v%', col)`. The scalar
         * `col ILIKE ...` form below would declare the bound parameter as
         * Array(String) while carrying a single pattern string, which
         * ClickHouse rejects at parameter-parse time — so array columns get
         * their own per-element form. This is what makes a plain text filter
         * on `observables` (Security Events) work at all.
         */
        whereStatement.append(
          SQL`AND arrayExists(x -> x ILIKE ${{
            value: value,
            type: TableColumnType.Text,
          }}, ${columnRef(key)})`,
        );
      } else if (value instanceof Search) {
        whereStatement.append(
          SQL`AND ${columnRef(key)} ILIKE ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (
        value instanceof NotEqual &&
        tableColumn.type === TableColumnType.ArrayText
      ) {
        /*
         * "not equal to v" on an Array(String) column means "does not
         * mention v" — the scalar `col != v` form would bind a single
         * string against an Array(String) parameter and fail at
         * ClickHouse parameter-parse time.
         */
        whereStatement.append(
          SQL`AND NOT has(${columnRef(key)}, ${{
            value: String((value as NotEqual<string>).value ?? ""),
            type: TableColumnType.Text,
          }})`,
        );
      } else if (value instanceof NotEqual) {
        whereStatement.append(
          SQL`AND ${columnRef(key)} != ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof GreaterThan) {
        whereStatement.append(
          SQL`AND ${columnRef(key)} > ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof LessThan) {
        whereStatement.append(
          SQL`AND ${columnRef(key)} < ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof LessThanOrEqual) {
        whereStatement.append(
          SQL`AND ${columnRef(key)} <= ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof LessThanOrNull) {
        whereStatement.append(
          SQL`AND (${columnRef(key)} <= ${{
            value: value,
            type: tableColumn.type,
          }} OR ${columnRef(key)} IS NULL)`,
        );
      } else if (value instanceof GreaterThanOrNull) {
        whereStatement.append(
          SQL`AND (${columnRef(key)} >= ${{
            value: value,
            type: tableColumn.type,
          }} OR ${columnRef(key)} IS NULL)`,
        );
      } else if (value instanceof GreaterThanOrEqual) {
        whereStatement.append(
          SQL`AND ${columnRef(key)} >= ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (value instanceof InBetween) {
        whereStatement.append(
          SQL`AND ${columnRef(key)} >= ${{
            value: value.startValue,
            type: tableColumn.type,
          }} AND ${columnRef(key)} <= ${{
            value: value.endValue,
            type: tableColumn.type,
          }}`,
        );
      } else if (
        value instanceof Includes &&
        tableColumn.type === TableColumnType.ArrayText
      ) {
        /*
         * Array(String) membership (e.g. `entityKeys` / `attributeKeys`):
         * `hasAny(col, [v1, v2])` — true when the row's array contains any
         * of the values. Repurposes Includes for array columns, where the
         * scalar `col IN (...)` form is invalid. The bloom_filter skip index
         * on these columns prunes granules for this predicate. An empty
         * Includes drops to no predicate (mirrors the map-Includes behavior),
         * never `hasAny(col, [])`.
         */
        const arrayIncludeValues: Array<string> =
          ((value as Includes).values as Array<string>) || [];
        if (arrayIncludeValues.length > 0) {
          whereStatement.append(
            SQL`AND hasAny(${columnRef(key)}, ${{
              value: arrayIncludeValues,
              type: TableColumnType.ArrayText,
            }})`,
          );
        }
      } else if (value instanceof Includes) {
        whereStatement.append(
          SQL`AND ${columnRef(key)} IN ${{
            value: value,
            type: tableColumn.type,
          }}`,
        );
      } else if (
        value instanceof IncludesNone &&
        tableColumn.type === TableColumnType.ArrayText
      ) {
        /*
         * Array(String) exclusion — the negation of the Includes/hasAny
         * branch above. An empty IncludesNone excludes nothing, so it
         * drops to no predicate (mirrors the empty-Includes behavior).
         */
        const arrayExcludeValues: Array<string> =
          ((value as IncludesNone).values as Array<string>) || [];
        if (arrayExcludeValues.length > 0) {
          whereStatement.append(
            SQL`AND NOT hasAny(${columnRef(key)}, ${{
              value: arrayExcludeValues,
              type: TableColumnType.ArrayText,
            }})`,
          );
        }
      } else if (value instanceof IncludesNone) {
        /*
         * Scalar exclusion ("is none of"): `col NOT IN (v1, v2, ...)`.
         * An empty IncludesNone means "exclude nothing" — skip the
         * predicate entirely rather than emitting `NOT IN ()`.
         */
        const excludeValues: Array<string | ObjectID | number> =
          ((value as IncludesNone).values as Array<string | ObjectID>) || [];
        if (excludeValues.length > 0) {
          whereStatement.append(
            SQL`AND ${columnRef(key)} NOT IN ${{
              value: value,
              type: tableColumn.type,
            }}`,
          );
        }
      } else if (value instanceof IsNull) {
        if (tableColumn.type === TableColumnType.ArrayText) {
          /*
           * Array(String) columns are non-Nullable — `IS NULL` would be
           * constant-false. "Not set" for an array is the empty array.
           */
          whereStatement.append(SQL`AND empty(${columnRef(key)})`);
        } else if (tableColumn.type === TableColumnType.Text) {
          whereStatement.append(
            SQL`AND (${columnRef(key)} IS NULL OR ${columnRef(key)} = '')`,
          );
        } else {
          whereStatement.append(SQL`AND ${columnRef(key)} IS NULL`);
        }
      } else if (value instanceof NotNull) {
        /*
         * Mirror of IsNull above: Text columns store '' as their "not set"
         * default (they are non-nullable Strings unless optional), so a
         * present-value check must reject the empty string too; Array
         * columns are non-Nullable, so `IS NOT NULL` would be constant-true
         * — presence for an array means "has at least one element".
         */
        if (tableColumn.type === TableColumnType.ArrayText) {
          whereStatement.append(SQL`AND notEmpty(${columnRef(key)})`);
        } else if (tableColumn.type === TableColumnType.Text) {
          whereStatement.append(
            SQL`AND (${columnRef(key)} IS NOT NULL AND ${columnRef(key)} != '')`,
          );
        } else {
          whereStatement.append(SQL`AND ${columnRef(key)} IS NOT NULL`);
        }
      } else if (value instanceof EqualTo) {
        /*
         * Explicit equality wrapper. Before this branch existed an EqualTo
         * instance fell through to the bare-value fallback, which bound the
         * operator OBJECT as the parameter — a silent match-nothing filter.
         * Scalars bind the wrapped value exactly like a bare value; on an
         * Array(String) column "equals v" means membership (`has`), which
         * is what a table filter's Equal To on `observables` intends. Map
         * and JSON columns have no scalar equality — fail loudly instead
         * of emitting SQL ClickHouse will reject with a cryptic error.
         */
        this.throwIfMapOrJsonColumn({ operator: value, tableColumn, key });
        if (tableColumn.type === TableColumnType.ArrayText) {
          whereStatement.append(
            SQL`AND has(${columnRef(key)}, ${{
              value: String((value as EqualTo<string>).value ?? ""),
              type: TableColumnType.Text,
            }})`,
          );
        } else {
          whereStatement.append(
            SQL`AND ${columnRef(key)} = ${{
              value: (value as EqualTo<string>).value,
              type: tableColumn.type,
            }}`,
          );
        }
      } else if (value instanceof EqualToOrNull) {
        this.throwIfMapOrJsonColumn({ operator: value, tableColumn, key });
        if (tableColumn.type === TableColumnType.ArrayText) {
          throw new BadDataException(
            `Unsupported query operator EqualToOrNull on column: ${key}`,
          );
        }
        if (tableColumn.type === TableColumnType.Text) {
          whereStatement.append(
            SQL`AND (${columnRef(key)} = ${{
              value: (value as EqualToOrNull<string>).value,
              type: tableColumn.type,
            }} OR ${columnRef(key)} IS NULL OR ${columnRef(key)} = '')`,
          );
        } else {
          whereStatement.append(
            SQL`AND (${columnRef(key)} = ${{
              value: (value as EqualToOrNull<string>).value,
              type: tableColumn.type,
            }} OR ${columnRef(key)} IS NULL)`,
          );
        }
      } else if (value instanceof StartsWith) {
        /*
         * Prefix / suffix / negated-substring matching, previously only
         * implemented for map (attributes) sub-keys. Array(String) columns
         * get the per-element arrayExists form (see the Search branch
         * above); scalars get a plain ILIKE. Patterns bind as Text because
         * the pattern itself is a string whatever the column type is, and
         * the user value is escaped so it matches literally rather than as
         * wildcard syntax.
         */
        this.throwIfMapOrJsonColumn({ operator: value, tableColumn, key });
        const startsWithPattern: string = `${escapeIlikePattern(
          (value.value as string) || "",
        )}%`;
        if (tableColumn.type === TableColumnType.ArrayText) {
          whereStatement.append(
            SQL`AND arrayExists(x -> x ILIKE ${{
              value: startsWithPattern,
              type: TableColumnType.Text,
            }}, ${columnRef(key)})`,
          );
        } else {
          whereStatement.append(
            SQL`AND ${columnRef(key)} ILIKE ${{
              value: startsWithPattern,
              type: TableColumnType.Text,
            }}`,
          );
        }
      } else if (value instanceof EndsWith) {
        this.throwIfMapOrJsonColumn({ operator: value, tableColumn, key });
        const endsWithPattern: string = `%${escapeIlikePattern(
          (value.value as string) || "",
        )}`;
        if (tableColumn.type === TableColumnType.ArrayText) {
          whereStatement.append(
            SQL`AND arrayExists(x -> x ILIKE ${{
              value: endsWithPattern,
              type: TableColumnType.Text,
            }}, ${columnRef(key)})`,
          );
        } else {
          whereStatement.append(
            SQL`AND ${columnRef(key)} ILIKE ${{
              value: endsWithPattern,
              type: TableColumnType.Text,
            }}`,
          );
        }
      } else if (value instanceof NotContains) {
        /*
         * On a nullable scalar, `NOT (NULL ILIKE ...)` is NULL and would
         * filter the row out — but a row with no value at all trivially
         * "does not contain" the needle, so NULL rows are let through
         * explicitly (mirrors how missing map keys pass the map-branch
         * NotContains).
         */
        this.throwIfMapOrJsonColumn({ operator: value, tableColumn, key });
        const notContainsPattern: string = `%${escapeIlikePattern(
          (value.value as string) || "",
        )}%`;
        if (tableColumn.type === TableColumnType.ArrayText) {
          whereStatement.append(
            SQL`AND NOT arrayExists(x -> x ILIKE ${{
              value: notContainsPattern,
              type: TableColumnType.Text,
            }}, ${columnRef(key)})`,
          );
        } else {
          whereStatement.append(
            SQL`AND (NOT (${columnRef(key)} ILIKE ${{
              value: notContainsPattern,
              type: TableColumnType.Text,
            }}) OR ${columnRef(key)} IS NULL)`,
          );
        }
      } else if (value instanceof Wildcard || value instanceof NotWildcard) {
        /*
         * Glob matching (`api-*`, `*.internal`, `svc-?`), one ILIKE per glob
         * OR-ed together so an any-of list can mix patterns with literals.
         * The patterns come from `toLikePattern`, which is the only place
         * that decides which `%`/`_` are wildcards and which are literal
         * characters the user typed — escaping here as well would escape the
         * wildcards it just produced.
         *
         * The negated form mirrors NotContains rather than simply wrapping
         * the positive one in NOT: on a nullable scalar `NOT (NULL ILIKE
         * ...)` is NULL, and a row with no value at all trivially fails to
         * match a glob, so NULL rows are let through explicitly.
         */
        this.throwIfMapOrJsonColumn({ operator: value, tableColumn, key });
        const wildcardPatterns: Array<string> = value.toPatterns();
        const isNegated: boolean = value instanceof NotWildcard;

        /*
         * An empty pattern list constrains nothing — "All", the same reading
         * the empty Includes branch below takes. Emitting `()` would be a
         * parse error and dropping to a bare NOT would match everything.
         */
        if (wildcardPatterns.length > 0) {
          if (tableColumn.type === TableColumnType.ArrayText) {
            const elementDisjunction: Statement =
              StatementGenerator.buildIlikeDisjunction({
                patterns: wildcardPatterns,
                subject: SQL`x`,
              });

            whereStatement.append(
              (isNegated
                ? SQL`AND NOT arrayExists(x -> `
                : SQL`AND arrayExists(x -> `
              )
                .append(elementDisjunction)
                .append(SQL`, ${columnRef(key)})`),
            );
          } else {
            const columnDisjunction: Statement =
              StatementGenerator.buildIlikeDisjunction({
                patterns: wildcardPatterns,
                subject: SQL`${columnRef(key)}`,
              });

            if (isNegated) {
              whereStatement.append(
                SQL`AND (NOT `
                  .append(columnDisjunction)
                  .append(SQL` OR ${columnRef(key)} IS NULL)`),
              );
            } else {
              whereStatement.append(SQL`AND `.append(columnDisjunction));
            }
          }
        }
      } else if (
        value instanceof IncludesAll &&
        tableColumn.type === TableColumnType.ArrayText
      ) {
        /*
         * Array(String) conjunction ("mentions ALL of these"): `hasAll`,
         * the AND-counterpart of the Includes/hasAny branch above. This is
         * what a correlation like "events naming host X AND ip Y" compiles
         * to on the `observables` column. An empty IncludesAll constrains
         * nothing — drop the predicate (hasAll(col, []) is vacuously true
         * anyway, but skipping keeps parity with the empty-Includes path).
         */
        const arrayAllValues: Array<string> =
          ((value as IncludesAll).values as Array<string>) || [];
        if (arrayAllValues.length > 0) {
          whereStatement.append(
            SQL`AND hasAll(${columnRef(key)}, ${{
              value: arrayAllValues,
              type: TableColumnType.ArrayText,
            }})`,
          );
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
          /*
           * Several operators AND-ed onto ONE attribute — `@k:a* @k:*b`, or
           * a chip plus a typed filter on the same key. The attributes map
           * has a single slot per key, so without this the second predicate
           * either overwrote the first or (worse) an array reached the
           * bare-value branch below and bound as `String(array)`, a silent
           * match-nothing. Each element compiles through a single-key
           * recursive call, so every branch below applies unchanged.
           */
          if (
            Array.isArray(mapEntry) &&
            mapEntry.length > 0 &&
            mapEntry.every((element: unknown) => {
              return element instanceof QueryOperator;
            })
          ) {
            for (const operator of mapEntry) {
              const fragment: Statement = this.toWhereStatement(
                { [key]: { [mapKey]: operator } } as Query<TBaseModel>,
                options,
              );

              if (!fragment.query) {
                continue;
              }

              whereStatement.append(fragment);
            }

            continue;
          }

          if (mapEntry instanceof IsNull) {
            whereStatement.append(
              SQL`AND ((NOT mapContains(${columnRef(key)}, ${{
                value: mapKey,
                type: TableColumnType.Text,
              }})) OR ${columnRef(key)}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}] = '')`,
            );
            continue;
          }

          if (mapEntry instanceof NotNull) {
            this.appendMapKeyPresenceFilter({
              whereStatement,
              mapColumn: tableColumn,
              mapKey,
              tableAlias: options?.tableAlias,
            });
            whereStatement.append(
              SQL`AND mapContains(${columnRef(key)}, ${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND ${columnRef(key)}[${{
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
              }}, mapKeys(${columnRef(key)}), mapValues(${columnRef(key)}))`,
            );
            continue;
          }

          if (
            mapEntry instanceof Wildcard ||
            mapEntry instanceof NotWildcard
          ) {
            /*
             * Glob matching on an attribute value — `@platform.team:a*`.
             *
             * Case-insensitive key match (the arrayExists form) for the same
             * reason Search / StartsWith / EndsWith use it: the key was typed
             * by a person, not read off a column list, so `requestId` and
             * `requestid` have to be the same filter. That also rules out
             * `appendMapKeyPresenceFilter`, whose `hasAny` prunes on an
             * EXACT key and would drop rows whose stored key differs only in
             * case.
             *
             * The negated form is `NOT arrayExists(...)`, so a row that does
             * not carry the attribute at all passes — it trivially does not
             * match the glob. That mirrors the NotContains branch below and
             * the missing-key semantics of the scalar map subscript.
             */
            const wildcardPatterns: Array<string> = mapEntry.toPatterns();

            if (wildcardPatterns.length === 0) {
              // Empty means "All" — see the Includes branch below.
              continue;
            }

            const negated: boolean = mapEntry instanceof NotWildcard;

            const valueDisjunction: Statement =
              StatementGenerator.buildIlikeDisjunction({
                patterns: wildcardPatterns,
                subject: SQL`v`,
              });

            const wildcardPredicate: Statement =
              SQL`arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND `
                .append(valueDisjunction)
                .append(
                  SQL`, mapKeys(${columnRef(key)}), mapValues(${columnRef(
                    key,
                  )}))`,
                );

            whereStatement.append(
              (negated ? SQL`AND NOT ` : SQL`AND `).append(wildcardPredicate),
            );
            continue;
          }

          if (mapEntry instanceof NotContains) {
            const literalValue: string = `%${escapeIlikePattern(
              (mapEntry.value as string) || "",
            )}%`;
            whereStatement.append(
              SQL`AND NOT arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND v ILIKE ${{
                value: literalValue,
                type: TableColumnType.Text,
              }}, mapKeys(${columnRef(key)}), mapValues(${columnRef(key)}))`,
            );
            continue;
          }

          if (mapEntry instanceof StartsWith) {
            const literalValue: string = `${escapeIlikePattern(
              (mapEntry.value as string) || "",
            )}%`;
            whereStatement.append(
              SQL`AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND v ILIKE ${{
                value: literalValue,
                type: TableColumnType.Text,
              }}, mapKeys(${columnRef(key)}), mapValues(${columnRef(key)}))`,
            );
            continue;
          }

          if (mapEntry instanceof EndsWith) {
            const literalValue: string = `%${escapeIlikePattern(
              (mapEntry.value as string) || "",
            )}`;
            whereStatement.append(
              SQL`AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
                value: mapKey,
                type: TableColumnType.Text,
              }}) AND v ILIKE ${{
                value: literalValue,
                type: TableColumnType.Text,
              }}, mapKeys(${columnRef(key)}), mapValues(${columnRef(key)}))`,
            );
            continue;
          }

          if (mapEntry instanceof NotEqual) {
            whereStatement.append(
              SQL`AND ${columnRef(key)}[${{
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
            const equalityValue: string = String(
              (mapEntry as EqualTo<any>).value ?? "",
            );
            this.appendMapKeyPresenceFilter({
              whereStatement,
              mapColumn: tableColumn,
              mapKey,
              skip: equalityValue === "",
              tableAlias: options?.tableAlias,
            });
            whereStatement.append(
              SQL`AND ${columnRef(key)}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}] = ${{
                value: equalityValue,
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
           *
           * The threshold binds as Decimal (ClickHouse `Double`), not
           * Number (`Int32`): the attribute filter form builds these
           * with `Number(input)` (see buildDictionaryValue in
           * Common/UI/Components/Dictionary/DictionaryFilterOperator.ts),
           * so a user can legitimately ask for `duration > 0.5` and an
           * Int32 bind would fail to parse the fractional value. Double
           * represents every Int32 exactly, so integer thresholds are
           * unaffected, and it matches the Float64 comparison side.
           */
          if (mapEntry instanceof GreaterThan) {
            this.appendMapKeyPresenceFilter({
              whereStatement,
              mapColumn: tableColumn,
              mapKey,
              tableAlias: options?.tableAlias,
            });
            whereStatement.append(
              SQL`AND toFloat64OrNull(${columnRef(key)}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}]) > ${{
                value: Number((mapEntry as GreaterThan<any>).value),
                type: TableColumnType.Decimal,
              }}`,
            );
            continue;
          }

          if (mapEntry instanceof GreaterThanOrEqual) {
            this.appendMapKeyPresenceFilter({
              whereStatement,
              mapColumn: tableColumn,
              mapKey,
              tableAlias: options?.tableAlias,
            });
            whereStatement.append(
              SQL`AND toFloat64OrNull(${columnRef(key)}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}]) >= ${{
                value: Number((mapEntry as GreaterThanOrEqual<any>).value),
                type: TableColumnType.Decimal,
              }}`,
            );
            continue;
          }

          if (mapEntry instanceof LessThan) {
            this.appendMapKeyPresenceFilter({
              whereStatement,
              mapColumn: tableColumn,
              mapKey,
              tableAlias: options?.tableAlias,
            });
            whereStatement.append(
              SQL`AND toFloat64OrNull(${columnRef(key)}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}]) < ${{
                value: Number((mapEntry as LessThan<any>).value),
                type: TableColumnType.Decimal,
              }}`,
            );
            continue;
          }

          if (mapEntry instanceof LessThanOrEqual) {
            this.appendMapKeyPresenceFilter({
              whereStatement,
              mapColumn: tableColumn,
              mapKey,
              tableAlias: options?.tableAlias,
            });
            whereStatement.append(
              SQL`AND toFloat64OrNull(${columnRef(key)}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}]) <= ${{
                value: Number((mapEntry as LessThanOrEqual<any>).value),
                type: TableColumnType.Decimal,
              }}`,
            );
            continue;
          }

          /*
           * Multi-value selection (dashboard variables, ad-hoc filters):
           * an empty `Includes` would expand to `IN ()`, which ClickHouse
           * treats as "match nothing" and is never the user's intent
           * here — skip the predicate instead so a cleared multi-select
           * behaves like "All".
           */
          if (mapEntry instanceof Includes) {
            const includesValues: Array<string> = (
              (mapEntry as Includes).values || []
            ).map((v: string | ObjectID | number) => {
              return String(v);
            });
            if (includesValues.length === 0) {
              continue;
            }
            this.appendMapKeyPresenceFilter({
              whereStatement,
              mapColumn: tableColumn,
              mapKey,
              skip: includesValues.includes(""),
              tableAlias: options?.tableAlias,
            });
            whereStatement.append(
              SQL`AND ${columnRef(key)}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}] IN ${{
                value: new Includes(includesValues),
                type: TableColumnType.Text,
              }}`,
            );
            continue;
          }

          /*
           * Multi-value exclusion (IncludesNone / "is none of"):
           * `attributes['k'] NOT IN (...)`. Map subscript returns '' for a
           * missing key, so (like NotEqual above) rows lacking the attribute
           * pass the NOT IN test, which matches "the value is none of these".
           * An empty IncludesNone is treated as "All" — skip the predicate
           * rather than emit `NOT IN ()`. Values bind via a fresh `Includes`
           * since Statement only types `Includes` as Array(String).
           */
          if (mapEntry instanceof IncludesNone) {
            const excludeValues: Array<string> = (
              (mapEntry as IncludesNone).values || []
            ).map((v: string | ObjectID | number) => {
              return String(v);
            });
            if (excludeValues.length === 0) {
              continue;
            }
            whereStatement.append(
              SQL`AND ${columnRef(key)}[${{
                value: mapKey,
                type: TableColumnType.Text,
              }}] NOT IN ${{
                value: new Includes(excludeValues),
                type: TableColumnType.Text,
              }}`,
            );
            continue;
          }

          // Bare string/number/boolean — direct Map subscript.
          const equalityValue: string = String(mapEntry);
          this.appendMapKeyPresenceFilter({
            whereStatement,
            mapColumn: tableColumn,
            mapKey,
            skip: equalityValue === "",
            tableAlias: options?.tableAlias,
          });
          whereStatement.append(
            SQL`AND ${columnRef(key)}[${{
              value: mapKey,
              type: TableColumnType.Text,
            }}] = ${{
              value: equalityValue,
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
              SQL`AND JSONExtractString(${columnRef(key)}, ${{
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
              SQL`AND JSONExtractInt(${columnRef(key)}, ${{
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
              SQL`AND JSONExtractBool(${columnRef(key)}, ${{
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
        /*
         * Bare-value equality. A query operator that reaches this point has
         * no branch for this column type (e.g. IncludesAll on a scalar) —
         * binding the operator object itself would produce a silent
         * match-nothing filter, so fail loudly instead.
         */
        if (value instanceof QueryOperator) {
          throw new BadDataException(
            `Unsupported query operator ${value.constructor.name} on column: ${key}`,
          );
        }
        whereStatement.append(
          SQL`AND ${columnRef(key)} = ${{ value, type: tableColumn.type }}`,
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

    /*
     * Keys must be comma separated. Without the separator a multi-key sort
     * concatenates into a single malformed term (`time DESCseverity ASC`),
     * so every ORDER BY beyond the first key was unusable. Mirrors
     * toGroupByStatement above.
     */
    let first: boolean = true;
    for (const key in sort) {
      if (!this.model.getTableColumn(key)) {
        throw new BadDataException(`Unknown column: ${key}`);
      }

      if (first) {
        first = false;
      } else {
        sortStatement.append(SQL`, `);
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

    const aggregationInterval: AggregationInterval =
      AggregateUtil.getAggregationInterval({
        startDate: aggregateBy.startTimestamp!,
        endDate: aggregateBy.endTimestamp!,
        aggregationInterval: aggregateBy.aggregationInterval,
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
      `${aggregationExpression} as ${aggregationColumn}, ${AggregateUtil.buildBucketTimestampSelect(aggregationInterval, aggregationTimestampColumn)}`,
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
    }.${getStorageTableName(
      this.model.tableName,
    )} RENAME COLUMN IF EXISTS ${oldColumnName} TO ${newColumnName}`;

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

      columns
        .append(keyStatement)
        .append(SQL` `)
        .append(this.toFullColumnType(column));

      // Append CODEC if specified
      if (column.codec) {
        columns.append(
          ` CODEC(${StatementGenerator.buildCodecString(column.codec)})`,
        );
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
      UInt64: TableColumnType.UInt64,
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
    const simpleAggregateFunction: string | undefined =
      column.simpleAggregateFunction;

    if (simpleAggregateFunction !== undefined) {
      if (column.type === TableColumnType.AggregateFunction) {
        throw new BadDataException(
          `Column ${column.key} cannot declare both AggregateFunction and SimpleAggregateFunction.`,
        );
      }

      /*
       * The function name is emitted as raw ClickHouse DDL, so accept only a
       * plain function identifier. Besides catching accidental whitespace /
       * empty definitions, this prevents a model field from injecting another
       * type or table clause into generated schema SQL.
       */
      if (
        simpleAggregateFunction.trim() !== simpleAggregateFunction ||
        !SIMPLE_AGGREGATE_FUNCTION_NAME_REGEX.test(simpleAggregateFunction)
      ) {
        throw new BadDataException(
          `Column ${column.key} has invalid simpleAggregateFunction "${simpleAggregateFunction}".`,
        );
      }
    }

    if (column.type === TableColumnType.AggregateFunction) {
      const def: string | undefined = column.aggregateFunctionDefinition;
      if (!def) {
        throw new BadDataException(
          `Column ${column.key} is AggregateFunction but missing aggregateFunctionDefinition.`,
        );
      }
      return SQL`AggregateFunction(`.append(def).append(SQL`)`);
    }

    const scalarStatement: Statement | undefined = {
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
      [TableColumnType.UInt64]: SQL`UInt64`,
    }[column.type];

    if (!scalarStatement) {
      throw new BadDataException(
        `Unknown column type: ${column.type}. Please add support for this column type.`,
      );
    }

    if (simpleAggregateFunction) {
      return SQL`SimpleAggregateFunction(`
        .append(simpleAggregateFunction)
        .append(SQL`, `)
        .append(scalarStatement)
        .append(SQL`)`);
    }

    return scalarStatement;
  }

  /**
   * Full ClickHouse type for a column, including the Nullable and
   * LowCardinality wrappers. Wrapping order matters:
   * `LowCardinality(Nullable(String))` — LowCardinality is the outermost
   * wrapper. AggregateFunction columns are never wrapped (ClickHouse rejects
   * `Nullable(AggregateFunction(...))`, and the engine already handles the
   * empty initial state).
   */
  public toFullColumnType(column: AnalyticsTableColumn): Statement {
    const isAggregateFunction: boolean =
      column.type === TableColumnType.AggregateFunction ||
      Boolean(column.simpleAggregateFunction);

    let typeStatement: Statement = this.toColumnType(column);

    if (!(column.required || isAggregateFunction)) {
      typeStatement = SQL`Nullable(`.append(typeStatement).append(SQL`)`);
    }

    if (column.isLowCardinality && !isAggregateFunction) {
      typeStatement = SQL`LowCardinality(`.append(typeStatement).append(SQL`)`);
    }

    return typeStatement;
  }

  /**
   * Renders a column's codec into the string that goes inside CODEC(...).
   * Accepts a single codec or an ordered pipeline; the pipeline is joined
   * with ", " so [{codec:"DoubleDelta"},{codec:"ZSTD",level:1}] becomes
   * "DoubleDelta, ZSTD(1)".
   */
  public static buildCodecString(codec: ColumnCodecValue): string {
    const specs: Array<ColumnCodecConfig> = Array.isArray(codec)
      ? codec
      : [codec];

    return specs
      .map((spec: ColumnCodecConfig) => {
        return spec.level !== undefined
          ? `${spec.codec}(${spec.level})`
          : spec.codec;
      })
      .join(", ");
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

    columnDef
      .append(column.key)
      .append(SQL` `)
      .append(this.toFullColumnType(column));

    if (column.codec) {
      columnDef.append(
        ` CODEC(${StatementGenerator.buildCodecString(column.codec)})`,
      );
    }

    /*
     * ON CLUSTER is appended as RAW SQL right after the table reference. The
     * analytics schema is ALWAYS a sharded + replicated cluster (see
     * ClusterConfig: a single node is just a "cluster of one"). A bare
     * `ALTER … ADD COLUMN` reaches only the shard the client is connected to —
     * Keeper replicates within a shard but never across shards — so the column
     * lands on one shard and a later scatter-gather read through the Distributed
     * wrapper hits a shard that lacks it and fails with
     * "Missing columns: '<col>'" (Code 47 UNKNOWN_IDENTIFIER). ON CLUSTER also
     * makes this ADD COLUMN wait for cluster-wide completion, so the separate
     * `ADD INDEX` that addColumnInDatabase issues next never races a column that
     * has not yet propagated to the node the index DDL lands on.
     */
    const statement: Statement = SQL`
            ALTER TABLE ${this.database.getDatasourceOptions().database!}.${getStorageTableName(
              this.model.tableName,
            )}`
      .append(onClusterClause())
      .append(" ADD COLUMN IF NOT EXISTS ")
      .append(columnDef);

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
    /*
     * ON CLUSTER (raw SQL) so the skip index is added on every shard, matching
     * toAddColumnStatement. A bare ADD INDEX only reaches the connected shard,
     * and if the column it references has not propagated to that node yet it
     * fails with "Missing columns: '<col>'" (Code 47).
     */
    statement.append(
      `ALTER TABLE ${databaseName}.${getStorageTableName(this.model.tableName)}${onClusterClause()} ADD INDEX IF NOT EXISTS ${idx.name} ${columnExpr} TYPE ${idx.type}${paramsStr} GRANULARITY ${idx.granularity}`,
    );

    logger.debug(`${this.model.tableName} Add Skip Index Statement`);
    logger.debug(statement);

    return statement;
  }

  public toDropSkipIndexStatement(indexName: string): string {
    const databaseName: string = this.database.getDatasourceOptions().database!;
    const statement: string = `ALTER TABLE ${databaseName}.${getStorageTableName(this.model.tableName)}${onClusterClause()} DROP INDEX IF EXISTS ${indexName}`;

    logger.debug(`${this.model.tableName} Drop Skip Index Statement`);
    logger.debug(statement);

    return statement;
  }

  public toDropColumnStatement(columnName: string): string {
    const statement: string = `ALTER TABLE ${this.database.getDatasourceOptions()
      .database!}.${getStorageTableName(
      this.model.tableName,
    )}${onClusterClause()} DROP COLUMN IF EXISTS ${columnName}`;

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
     * special case - ClickHouse does not support using a query parameter to
     * specify the table name, engine, or ON CLUSTER clause, so these are
     * interpolated as raw SQL (the SQL tag only parameterizes ${{value,type}}
     * objects, not plain string interpolations).
     *
     * In cluster mode this builds the LOCAL storage table
     * (`<tableName>Local` with a Replicated* engine) `ON CLUSTER '<name>'`; the
     * app-facing Distributed table is created separately via
     * toDistributedTableCreateStatement(). In single-node mode it builds the
     * model's own table with its plain engine, exactly as before.
     */
    const tableEngineStatement: string = getStorageEngine(
      this.model.tableEngine,
    );

    const storageTableName: string = getStorageTableName(this.model.tableName);

    const onCluster: string = onClusterClause();

    const partitionKey: string = this.model.partitionKey;

    const statement: Statement = SQL`
            CREATE TABLE IF NOT EXISTS ${databaseName}.${storageTableName}`
      /*
       * ON CLUSTER is appended as RAW SQL — the SQL tag turns every ${..}
       * interpolation into a {pN:Identifier} parameter, which would wrongly
       * quote the whole " ON CLUSTER '<name>'" clause as a single identifier.
       * onCluster is "" in single-node mode, so this is a no-op there.
       */
      .append(onCluster)
      .append(
        SQL`
            (\n`,
      )
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

    /*
     * Append table-level SETTINGS if specified (e.g. ttl_only_drop_parts = 1
     * so TTL drops whole time-partitions instead of rewriting parts). In
     * cluster mode the non-replicated dedup window is rewritten to its
     * replicated equivalent so insert idempotency survives.
     */
    const tableSettings: string | undefined = adaptTableSettingsForStorage(
      this.model.tableSettings,
    );
    if (tableSettings) {
      statement.append(`\nSETTINGS ${tableSettings}`);
    }

    /* eslint-enable prettier/prettier */

    logger.debug(`${this.model.tableName} Table Create Statement`);
    logger.debug(statement);

    return statement;
  }

  /*
   * The app-facing Distributed table that wraps the model's local storage table.
   * Built with `AS <db>.<local>` so its column layout is copied from — and stays
   * identical to — the local table, and with `CREATE OR REPLACE` so re-running it
   * every boot atomically re-syncs the wrapper after a column is reconciled onto
   * the local table (the Distributed table holds no data, so the replace is cheap
   * and lossless). The Distributed engine routes writes by the model's sharding
   * key and scatter-gathers reads across all shards.
   */
  public toDistributedTableCreateStatement(): Statement {
    const databaseName: string = this.database.getDatasourceOptions().database!;
    const distributedTableName: string = this.model.tableName;
    const localTableName: string = getStorageTableName(this.model.tableName);
    const onCluster: string = onClusterClause();
    const distributedEngine: string = getDistributedEngine(
      localTableName,
      this.model.shardingKey,
    );

    const statement: Statement = new Statement();
    statement.append(
      `CREATE OR REPLACE TABLE ${databaseName}.${distributedTableName}${onCluster} AS ${databaseName}.${localTableName} ENGINE = ${distributedEngine}`,
    );

    logger.debug(`${this.model.tableName} Distributed Table Create Statement`);
    logger.debug(statement);

    return statement;
  }
}
