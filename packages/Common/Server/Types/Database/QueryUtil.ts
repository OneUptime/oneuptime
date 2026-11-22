import Query from "./Query";
import QueryHelper, { ManyToManyRelatedTable } from "./QueryHelper";
import UUIDColumnFilter from "./UUIDColumnFilter";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IncludesNoneOrNull from "../../../Types/BaseDatabase/IncludesNoneOrNull";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../Types/BaseDatabase/NotEqualOrNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import OwnedBy, {
  OWNED_BY_QUERY_KEY,
} from "../../../Types/BaseDatabase/OwnedBy";
import OwnedByFilter from "./OwnedByFilter";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import Typeof from "../../../Types/Typeof";
import { And, DataSource } from "typeorm";
import { FindOperator } from "typeorm/find-options/FindOperator";
import CompareBase, { CompareType } from "../../../Types/Database/CompareBase";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";

/*
 * serializeQuery has no @CaptureSpan: an in-memory rewrite run before every
 * read, in microseconds. The statement that runs is traced instead
 * (PostgresQuerySpans).
 */
export default class QueryUtil {
  /*
   * What a comparison binds for Postgres (#8200). A Date is bound as the
   * instant it is: ISO 8601 in UTC, to the millisecond, which a timestamptz
   * column reads exactly whatever the zone of the process or the session.
   *
   * The operators' toString() is their text for people, not for the
   * database. LessThan, GreaterThan and their kin write a Date as its day
   * alone ("2026-11-15", in the process's zone), so a check on the server
   * for "updated over 20 minutes ago" asked Postgres for "updated before
   * today" and was off by up to a day. EqualTo and NotEqual write it as
   * "Sun Nov 15 2026 10:00:00 GMT+0000 (Coordinated Universal Time)", which
   * Postgres refuses.
   *
   * Anything else is bound as before. A query from the browser arrives with
   * its instants already ISO text (JSON has no dates), which toString()
   * hands back whole; a number, an id or a day written as text
   * ("2026-11-15") is still that text.
   */
  private static getComparedValue(
    key: string,
    operator: CompareBase<CompareType>,
  ): string {
    const value: CompareType = operator.value;

    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new BadDataException(
          `The filter on ${key} compares it with a date that is not valid.`,
        );
      }

      return value.toISOString();
    }

    return operator.toString();
  }

  /*
   * A relation filtered by ids - a plain id (`incident: "<id>"`) or several
   * in Includes (`incident: new Includes([...])`) - is a filter on the
   * relation's key (`incidentId`), and is written there. It is added to
   * whatever the key already holds - the condition a permission check put
   * on it, the caller's own filter on the key - and never takes its place:
   * both hold.
   */
  private static moveRelationFilterToKey<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    relation: string,
    keyColumn: string,
    relationIds: string | FindOperator<any>,
  ): void {
    const record: Record<string, unknown> = query as Record<string, unknown>;
    delete record[relation];

    const existing: unknown = record[keyColumn];

    if (existing === undefined) {
      record[keyColumn] = relationIds;
      return;
    }

    record[keyColumn] = QueryUtil.getBothFilters({
      modelType: modelType,
      column: keyColumn,
      existing: existing,
      added: relationIds,
      addedFrom: relation,
    });
  }

  /*
   * Two filters on one column, as one condition that holds where both do:
   * the column's own filter, serialized as serializeQuery serializes it
   * whether reached yet or not, and a condition written onto the column from
   * another key (`addedFrom`) - a relation's ids onto the relation's key, an
   * operator nested under a relation onto the related record's key or _id
   * (serializeRelationFilter). Never the one in place of the other.
   */
  private static getBothFilters<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    column: string;
    existing: unknown;
    added: unknown;
    addedFrom: string;
  }): FindOperator<any> {
    const existingFilter: unknown = (
      QueryUtil.serializeQuery(data.modelType, {
        [data.column]: data.existing,
      } as Query<TBaseModel>) as Record<string, unknown>
    )[data.column];

    const addedFilter: FindOperator<any> | null =
      data.added instanceof FindOperator
        ? data.added
        : typeof data.added === Typeof.String
          ? (QueryHelper.equalTo(data.added as string) as FindOperator<any>)
          : null;

    if (addedFilter && typeof existingFilter === Typeof.String) {
      return And(
        QueryHelper.equalTo(existingFilter as string) as FindOperator<any>,
        addedFilter,
      );
    }

    if (addedFilter && existingFilter instanceof FindOperator) {
      return And(existingFilter, addedFilter);
    }

    throw new BadDataException(
      `Cannot combine the filter on ${data.addedFrom} with the filter on ${data.column}.`,
    );
  }

  /*
   * A FILTER ON A RELATED RECORD'S OWN COLUMNS, nested under the relation -
   * `{ monitor: { createdAt: new LessThan(date) } }` on an incident - is a
   * query of the related model: each of OneUptime's operators in it is
   * written as a query of that model writes it (#8378).
   *
   * serializeQuery used to visit a query's own keys only, and under a
   * relation turned only the text searches (Search, StartsWith...) into SQL.
   * Every other operator reached TypeORM as the class itself, which TypeORM
   * does not know: it bound the object, as its JSON, so a date was compared
   * with '{"_type":"LessThan",...}' and Postgres refused the read, and a
   * text compared with that JSON matched nothing, with no error. Now a
   * comparison, a range, a list, a null check or a search under a relation
   * says what it says at the top of a query: a Date bound as the instant it
   * is (getComparedValue), ids checked as uuids (UUIDColumnFilter), a
   * relation of the related record filtered by ids written onto its key.
   * The same goes for a filter a level deeper, under the related record's
   * own relation, and under a many-to-many relation.
   *
   * A filter on a JSON column of the related record - its custom fields,
   * `{ incident: { customFields: { Team: "Payments" } } }` - is written as
   * at the top of a query too (#8466): a containment check per key, an
   * operator under a key (Includes...) as the checks it stands for, a null
   * check on the whole column. Handed to TypeORM as it was given, the plain
   * object was compared TypeORM's own way rather than as a filter on the
   * keys it names, and an operator under a key was bound as its JSON and
   * matched nothing.
   *
   * Only these are rewritten: the operators, the values on a JSON column,
   * and the relation filters nested further in. Every other value - an id, a
   * plain value, a list, one of TypeORM's own operators - stays exactly as
   * it was given: the filters the permission checks put under a relation
   * (the labels a member may read, @CanAccessIfCanReadOn: always the Label
   * relation, never a JSON column) are unchanged. An operator that reaches beyond
   * the column it is keyed on is refused: a MultiSearch names columns of its
   * own and an OwnedBy the owner tables, which the read check of a filter
   * under a relation (QueryPermission.checkRelationFilterPermission, by key)
   * does not hold them to. Written, either would let a filter read columns
   * the caller may not; handed on, it matched nothing, with no error.
   *
   * An operator the related model writes onto another of its keys - the ids
   * of the related record's relation onto that relation's key, a
   * many-to-many check onto _id - is added to what the filter holds on that
   * key: both hold (getBothFilters).
   */
  private static serializeRelationFilter<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    filter: Record<string, unknown>,
  ): void {
    const model: BaseModel = new modelType();
    const rewritten: Record<string, unknown> = {};

    for (const key of Object.keys(filter)) {
      const value: unknown = filter[key];

      if (value instanceof MultiSearch || value instanceof OwnedBy) {
        throw new BadDataException(
          `The filter on ${key} of a related ${model.singularName || "record"} ${
            value instanceof MultiSearch
              ? "searches several fields at once"
              : "is by owners"
          }, which a filter on a related record cannot do. Filter the related records with a query of their own.`,
        );
      }

      const column: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(key);

      if (!column) {
        continue;
      }

      if (
        value instanceof QueryOperator ||
        QueryUtil.isRelationFilter(column, value) ||
        // A filter on a JSON column - the custom fields - whatever its shape (#8466).
        (column.type === TableColumnType.JSON && value !== undefined)
      ) {
        rewritten[key] = value;
      }
    }

    const rewrittenKeys: Array<string> = Object.keys(rewritten);

    if (rewrittenKeys.length === 0) {
      return;
    }

    for (const key of rewrittenKeys) {
      delete filter[key];
    }

    const serialized: Record<string, unknown> = QueryUtil.serializeQuery(
      modelType,
      rewritten as Query<TBaseModel>,
    ) as Record<string, unknown>;

    for (const [key, value] of Object.entries(serialized)) {
      filter[key] =
        filter[key] === undefined
          ? value
          : QueryUtil.getBothFilters({
              modelType: modelType,
              column: key,
              existing: filter[key],
              added: value,
              addedFrom: rewrittenKeys.join(", "),
            });
    }
  }

  /*
   * A condition on the record's id that a filter on one of its many-to-many
   * relations stands for (IsNull, NotNull, IncludesAll, IncludesNone: a
   * subquery on the join table), added to what the id's own filter holds -
   * whatever order the query's keys come in. An id filter not serialized
   * yet, because its key comes later (an ObjectID, Includes, a list), is
   * serialized first: taking its place dropped it, and a read of some
   * records by id read every record the relation's filter matched.
   */
  private static addConditionOnId<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    condition: FindOperator<any>,
  ): void {
    let existing: unknown = (query as Record<string, unknown>)["_id"];

    // As serializeQuery writes it, the id checked as a uuid: idempotent.
    if (existing !== undefined && !(existing instanceof FindOperator)) {
      existing = (
        QueryUtil.serializeQuery(modelType, {
          _id: existing,
        } as Query<TBaseModel>) as Record<string, unknown>
      )["_id"];
    }

    if (existing === undefined) {
      (query as any)._id = condition;
    } else if (existing instanceof FindOperator) {
      (query as any)._id = And(existing, condition);
    } else if (typeof existing === Typeof.String && existing !== "") {
      (query as any)._id = And(
        QueryHelper.equalTo(existing as string) as FindOperator<any>,
        condition,
      );
    } else {
      throw new BadDataException(
        "The filter on _id cannot be combined with the other filters of the query.",
      );
    }
  }

  /*
   * A filter on a related record's own columns: a plain object under a
   * relation (one record or many), never a list of ids, an id or an
   * operator.
   */
  private static isRelationFilter(
    column: TableColumnMetadata,
    value: unknown,
  ): value is Record<string, unknown> {
    if (
      !column.modelType ||
      (column.type !== TableColumnType.Entity &&
        column.type !== TableColumnType.EntityArray) ||
      !value ||
      typeof value !== Typeof.Object ||
      Array.isArray(value)
    ) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }

  public static serializeQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
  ): Query<TBaseModel> {
    const model: BaseModel = new modelType();

    query = query as Query<TBaseModel>;
    const groupedRelationFilters: Array<FindOperator<unknown>> = [];

    /*
     * Conditions on the record's id that a key of its own stands for - a
     * multi-field search, a filter by owners - added after the id's own
     * filter has been serialized (at the end), beside it.
     */
    const conditionsOnId: Array<FindOperator<unknown>> = [];

    /*
     * Who owns the records (OwnedBy, under "owners"): a subquery on the
     * kind's owner tables, held on `_id` (QueryHelper.ownedBy). The key is
     * no column, so TypeORM never sees it. A kind without owners is refused
     * rather than listed in full (OwnedByFilter). QueryPermission has held
     * the caller to the owner tables' read before this.
     */
    for (const key in query) {
      const value: unknown = query[key];

      if (!(value instanceof OwnedBy)) {
        continue;
      }

      if (key !== OWNED_BY_QUERY_KEY) {
        throw new BadDataException(
          `A filter by owners goes under "${OWNED_BY_QUERY_KEY}", not "${key}".`,
        );
      }

      delete query[key];

      conditionsOnId.push(
        OwnedByFilter.getIdCondition(modelType, value) as FindOperator<unknown>,
      );
    }

    /*
     * Multi-field text search:
     * A MultiSearch operator on any key fans out into an ILIKE OR across the
     * listed entity fields. We hang the Raw expression off `_id` so it lands
     * in the WHERE clause without TypeORM treating the synthetic key as a
     * real column. Falls through silently if metadata is unavailable or no
     * fields resolve (e.g. property name typo).
     */
    for (const key in query) {
      const value: any = query[key];
      if (!(value instanceof MultiSearch)) {
        continue;
      }

      delete query[key];

      const ms: MultiSearch = value as MultiSearch;
      if (!ms.value || ms.fields.length === 0) {
        continue;
      }

      /*
       * Validate the requested fields against entity metadata so we only
       * emit identifiers TypeORM's post-processor can map back to real
       * columns (otherwise the alias.field token survives unescaped and
       * Postgres lowercases the table name → "missing FROM-clause entry").
       */
      const validPropertyNames: Array<string> = [];
      if (PostgresAppInstance.isConnected()) {
        const dataSource: DataSource | null =
          PostgresAppInstance.getDataSource();
        if (dataSource) {
          let entityMetadata: EntityMetadata | undefined;
          try {
            entityMetadata = dataSource.getMetadata(modelType);
          } catch {
            entityMetadata = undefined;
          }
          if (entityMetadata) {
            for (const fieldName of ms.fields) {
              const column: any = entityMetadata.columns.find((c: any) => {
                return c.propertyName === fieldName;
              });
              if (column) {
                validPropertyNames.push(fieldName);
              }
            }
          }
        }
      }

      if (validPropertyNames.length === 0) {
        continue;
      }

      /*
       * Beside the id's own filter, once that is serialized (below): an id
       * filtered by a list (Includes) or by one ObjectID is not yet a
       * FindOperator here, and taking its place dropped it - a search on a
       * list narrowed to some records searched all of them.
       */
      conditionsOnId.push(
        QueryHelper.multiSearch(
          validPropertyNames,
          ms.value,
        ) as FindOperator<unknown>,
      );
    }

    for (const key in query) {
      const tableColumnMetadata: TableColumnMetadata =
        model.getTableColumnMetadata(key);

      /*
       * From here on every id the filter compares a uuid column with is text
       * Postgres reads as a uuid, or the query has been refused with a 400.
       * See UUIDColumnFilter.
       */
      if (tableColumnMetadata) {
        query[key] = UUIDColumnFilter.normalizeFilter({
          columnName: key,
          column: tableColumnMetadata,
          value: query[key],
        }) as any;
      }

      if (query[key] instanceof IncludesAnyOfGroups) {
        if (tableColumnMetadata?.type !== TableColumnType.EntityArray) {
          throw new BadDataException(
            "IncludesAnyOfGroups requires a many-to-many entity relation.",
          );
        }

        const relation: {
          joinTableName: string;
          ownerColumnName: string;
          relationColumnName: string;
        } | null = QueryUtil.getManyToManyRelationMetadata(modelType, key);

        if (!relation) {
          throw new BadDataException(
            "IncludesAnyOfGroups requires available many-to-many relation metadata.",
          );
        }

        for (const group of (query[key] as IncludesAnyOfGroups).groups) {
          groupedRelationFilters.push(
            QueryHelper.anyOfEntitiesInManyToMany({
              ...relation,
              values: group,
            }) as FindOperator<unknown>,
          );
        }
        delete query[key];
        continue;
      }

      /*
       * A list of related records (a monitor's labels) that is null holds
       * none of them: IsNull, below. Handed to TypeORM as IS NULL on the
       * relation, it refused the read with a server error.
       */
      if (
        tableColumnMetadata?.type === TableColumnType.EntityArray &&
        query[key] === null
      ) {
        query[key] = new IsNull() as any;
      }

      if (tableColumnMetadata && query[key] === null) {
        query[key] = QueryHelper.isNull();
      } else if (
        query[key] &&
        query[key] instanceof NotNull &&
        tableColumnMetadata
      ) {
        if (tableColumnMetadata.type === TableColumnType.EntityArray) {
          const manyToManyMeta: {
            joinTableName: string;
            ownerColumnName: string;
            relationColumnName: string;
          } | null = QueryUtil.getManyToManyRelationMetadata(modelType, key);

          if (manyToManyMeta) {
            const subqueryFilter: any = QueryHelper.anyEntitiesInManyToMany({
              joinTableName: manyToManyMeta.joinTableName,
              ownerColumnName: manyToManyMeta.ownerColumnName,
            });

            delete query[key];

            QueryUtil.addConditionOnId(modelType, query, subqueryFilter);
          } else {
            /*
             * Metadata unavailable — drop the filter rather than emit
             * invalid SQL against a relation that isn't a real column.
             */
            delete query[key];
          }
        } else {
          query[key] = QueryHelper.notNull();
        }
      } else if (
        query[key] &&
        query[key] instanceof EqualToOrNull &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.equalToOrNull(
          QueryUtil.getComparedValue(key, query[key] as EqualToOrNull<any>),
        ) as FindOperator<any> as any;
      } else if (
        query[key] &&
        query[key] instanceof EqualTo &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.equalTo(
          QueryUtil.getComparedValue(key, query[key] as EqualTo<any>),
        ) as FindOperator<any> as any;
      } else if (
        query[key] &&
        tableColumnMetadata &&
        tableColumnMetadata.type === TableColumnType.JSON
      ) {
        query[key] = QueryHelper.queryJson(
          query[key] as any,
        ) as FindOperator<any> as any;
      } else if (
        query[key] &&
        query[key] instanceof NotEqual &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.notEquals(
          QueryUtil.getComparedValue(key, query[key] as NotEqual<any>),
        ) as FindOperator<any> as any;
      } else if (
        query[key] &&
        query[key] instanceof NotEqualOrNull &&
        tableColumnMetadata
      ) {
        // Anything but the value, an empty column included (#10399).
        query[key] = QueryHelper.notEqualsOrNull(
          QueryUtil.getComparedValue(key, query[key] as NotEqualOrNull<any>),
        ) as FindOperator<any> as any;
      } else if (
        query[key] &&
        (query[key] as any)._value &&
        Array.isArray((query[key] as any)._value) &&
        (query[key] as any)._value.length > 0 &&
        tableColumnMetadata
      ) {
        let counter: number = 0;
        for (const item of (query[key] as any)._value) {
          if (item instanceof ObjectID) {
            ((query[key] as any)._value as any)[counter] = (
              (query[key] as any)._value as any
            )[counter].toString();
          }
          counter++;
        }
      } else if (
        query[key] &&
        query[key] instanceof ObjectID &&
        tableColumnMetadata &&
        tableColumnMetadata.type !== TableColumnType.EntityArray
      ) {
        query[key] = QueryHelper.equalTo(
          (query[key] as ObjectID).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof Search &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.search(
          (query[key] as Search<string>).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof NotContains &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.notContains(
          (query[key] as NotContains<string>).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof StartsWith &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.startsWith(
          (query[key] as StartsWith<string>).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof EndsWith &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.endsWith(
          (query[key] as EndsWith<string>).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof Wildcard &&
        tableColumnMetadata
      ) {
        // Several globs are any of them; one (or none) reads as it always has.
        const globs: Array<string> = (query[key] as Wildcard<string>).values;

        query[key] = (
          globs.length > 1
            ? QueryHelper.wildcardAny(globs)
            : QueryHelper.wildcard(
                (query[key] as Wildcard<string>).toString() as any,
              )
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof NotWildcard &&
        tableColumnMetadata
      ) {
        const globs: Array<string> = (query[key] as NotWildcard<string>).values;

        query[key] = (
          globs.length > 1
            ? QueryHelper.notWildcardAny(globs)
            : QueryHelper.notWildcard(
                (query[key] as NotWildcard<string>).toString() as any,
              )
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof LessThan &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.lessThan(
          QueryUtil.getComparedValue(
            key,
            query[key] as LessThan<CompareType>,
          ) as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof IsNull &&
        tableColumnMetadata
      ) {
        if (tableColumnMetadata.type === TableColumnType.EntityArray) {
          const manyToManyMeta: {
            joinTableName: string;
            ownerColumnName: string;
            relationColumnName: string;
          } | null = QueryUtil.getManyToManyRelationMetadata(modelType, key);

          if (manyToManyMeta) {
            const subqueryFilter: any = QueryHelper.noEntitiesInManyToMany({
              joinTableName: manyToManyMeta.joinTableName,
              ownerColumnName: manyToManyMeta.ownerColumnName,
            });

            delete query[key];

            QueryUtil.addConditionOnId(modelType, query, subqueryFilter);
          } else {
            delete query[key];
          }
        } else {
          query[key] = QueryHelper.isNull() as any;
        }
      } else if (
        query[key] &&
        query[key] instanceof InBetween &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.inBetween(
          (query[key] as InBetween<CompareType>).startValue as any,
          (query[key] as InBetween<CompareType>).endValue as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof GreaterThan &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.greaterThan(
          QueryUtil.getComparedValue(
            key,
            query[key] as GreaterThan<CompareType>,
          ) as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof IncludesAll &&
        tableColumnMetadata
      ) {
        if (tableColumnMetadata.type === TableColumnType.EntityArray) {
          const includesAll: IncludesAll = query[key] as IncludesAll;
          const values: Array<string | ObjectID> = (
            includesAll.values as Array<string | ObjectID | number>
          ).map((item: string | ObjectID | number) => {
            if (
              item !== null &&
              typeof item === Typeof.Object &&
              !(item instanceof ObjectID)
            ) {
              const itemRecord: JSONObject = item as unknown as JSONObject;
              if (itemRecord["_id"]) {
                return itemRecord["_id"] as string;
              }
            }
            return item.toString();
          });

          const manyToManyMeta: {
            joinTableName: string;
            ownerColumnName: string;
            relationColumnName: string;
          } | null = QueryUtil.getManyToManyRelationMetadata(modelType, key);

          if (manyToManyMeta && values.length > 0) {
            const subqueryFilter: any = QueryHelper.allEntitiesInManyToMany({
              values,
              joinTableName: manyToManyMeta.joinTableName,
              ownerColumnName: manyToManyMeta.ownerColumnName,
              relationColumnName: manyToManyMeta.relationColumnName,
            });

            /*
             * Remove the relation-based filter so TypeORM does not create a
             * JOIN that would yield OR semantics.
             */
            delete query[key];

            QueryUtil.addConditionOnId(modelType, query, subqueryFilter);
          } else {
            // Fall back to OR behavior when metadata cannot be resolved.
            query[key] = values as any;
          }
        } else if (tableColumnMetadata.type === TableColumnType.Entity) {
          // Entity (single) columns treat AND as a single match — same as OR.
          query[key] = (query[key] as IncludesAll).values as any;
        } else {
          query[key] = QueryHelper.any(
            (query[key] as IncludesAll).values,
          ) as any;
        }
      } else if (
        query[key] &&
        (query[key] instanceof IncludesNone ||
          query[key] instanceof IncludesNoneOrNull) &&
        tableColumnMetadata
      ) {
        /*
         * A list of related records (a monitor's labels) that holds none at
         * all holds none of these either: the subquery below keeps it, for
         * IncludesNone and IncludesNoneOrNull alike.
         */
        if (tableColumnMetadata.type === TableColumnType.EntityArray) {
          const includesNone: IncludesNone | IncludesNoneOrNull = query[key] as
            | IncludesNone
            | IncludesNoneOrNull;
          const values: Array<string | ObjectID> = (
            includesNone.values as Array<string | ObjectID | number>
          ).map((item: string | ObjectID | number) => {
            if (
              item !== null &&
              typeof item === Typeof.Object &&
              !(item instanceof ObjectID)
            ) {
              const itemRecord: JSONObject = item as unknown as JSONObject;
              if (itemRecord["_id"]) {
                return itemRecord["_id"] as string;
              }
            }
            return item.toString();
          });

          const manyToManyMeta: {
            joinTableName: string;
            ownerColumnName: string;
            relationColumnName: string;
          } | null = QueryUtil.getManyToManyRelationMetadata(modelType, key);

          if (manyToManyMeta && values.length > 0) {
            const subqueryFilter: any = QueryHelper.noneEntitiesInManyToMany({
              values,
              joinTableName: manyToManyMeta.joinTableName,
              ownerColumnName: manyToManyMeta.ownerColumnName,
              relationColumnName: manyToManyMeta.relationColumnName,
            });

            delete query[key];

            QueryUtil.addConditionOnId(modelType, query, subqueryFilter);
          } else {
            delete query[key];
          }
        } else {
          const excluded: Array<string | ObjectID> = (
            query[key] as IncludesNone | IncludesNoneOrNull
          ).values as Array<string | ObjectID>;

          /*
           * `NOT IN` alone is not true of an empty column, so IncludesNone
           * leaves it out; IncludesNoneOrNull keeps it (#10581), as a list's
           * "is not" filter means.
           */
          query[key] = (
            query[key] instanceof IncludesNoneOrNull
              ? QueryHelper.notInOrNull(excluded)
              : QueryHelper.notIn(excluded)
          ) as any;
        }
      } else if (
        query[key] &&
        query[key] instanceof Includes &&
        tableColumnMetadata
      ) {
        if (
          tableColumnMetadata.type === TableColumnType.Entity &&
          tableColumnMetadata.manyToOneRelationColumn
        ) {
          // A filter on the relation's key, beside what the key holds.
          QueryUtil.moveRelationFilterToKey(
            modelType,
            query,
            key,
            tableColumnMetadata.manyToOneRelationColumn,
            QueryHelper.any(
              (query[key] as Includes).values,
            ) as FindOperator<any>,
          );
          continue;
        } else if (
          tableColumnMetadata.type === TableColumnType.EntityArray ||
          tableColumnMetadata.type === TableColumnType.Entity
        ) {
          query[key] = (query[key] as Includes).values as any;
        } else {
          query[key] = QueryHelper.any((query[key] as Includes).values) as any;
        }
      } else if (
        query[key] &&
        query[key] instanceof GreaterThanOrEqual &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.greaterThanEqualTo(
          QueryUtil.getComparedValue(
            key,
            query[key] as GreaterThanOrEqual<CompareType>,
          ) as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof LessThanOrEqual &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.lessThanEqualTo(
          QueryUtil.getComparedValue(
            key,
            query[key] as LessThanOrEqual<CompareType>,
          ) as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof LessThanOrNull &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.lessThanOrNull(
          QueryUtil.getComparedValue(
            key,
            query[key] as LessThanOrNull<CompareType>,
          ) as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof GreaterThanOrNull &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.greaterThanOrNull(
          QueryUtil.getComparedValue(
            key,
            query[key] as GreaterThanOrNull<CompareType>,
          ) as any,
        ) as any;
      } else if (
        query[key] &&
        Array.isArray(query[key]) &&
        tableColumnMetadata &&
        tableColumnMetadata.type !== TableColumnType.EntityArray
      ) {
        query[key] = QueryHelper.any(
          query[key] as any,
        ) as FindOperator<any> as any;
      }

      if (
        tableColumnMetadata &&
        tableColumnMetadata.manyToOneRelationColumn &&
        typeof query[key] === Typeof.String
      ) {
        QueryUtil.moveRelationFilterToKey(
          modelType,
          query,
          key,
          tableColumnMetadata.manyToOneRelationColumn,
          query[key] as unknown as string,
        );
      }

      if (
        tableColumnMetadata &&
        tableColumnMetadata.modelType &&
        tableColumnMetadata.type === TableColumnType.EntityArray &&
        Array.isArray(query[key])
      ) {
        query[key] = (query[key] as Array<string | JSONObject>).map(
          (item: string | JSONObject) => {
            if (typeof item === Typeof.String) {
              return item;
            }

            if (item && (item as JSONObject)["_id"]) {
              return (item as JSONObject)["_id"] as string;
            }

            return item;
          },
        ) as any;

        /*
         * The records carrying one of these labels - the dashboard's label
         * chips, a label pick in a dropdown - as a condition on the
         * record's id (getLabelsFilterCondition), as a grant limited to
         * labels keeps them (AccessControlPermission.addLabelIdsToQuery):
         * the records the filter through the relation matched, with no
         * to-many join in the read, so its page and its count are read as
         * an unfiltered list's are (PagedFind, CappedCount). Each record
         * is read with all its labels: through the relation, the filter
         * also trimmed the labels a record came back with to the ones it
         * matched. Another relation of many records keeps its filter
         * through the relation.
         */
        const carriesLabels: FindOperator<unknown> | null =
          QueryUtil.getLabelsFilterCondition(
            modelType,
            key,
            query[key] as unknown as Array<string>,
          );

        if (carriesLabels) {
          groupedRelationFilters.push(carriesLabels);
          delete query[key];
          continue;
        }

        (query as any)[key] = {
          _id: QueryHelper.any(query[key] as Array<string>),
        };
      }

      /*
       * A filter on the related record's own columns, nested under the
       * relation: its operators written as a query of the related model
       * writes them (serializeRelationFilter, #8378). Rewritten on a copy:
       * the caller's filter stays as it was given.
       */
      if (
        tableColumnMetadata &&
        QueryUtil.isRelationFilter(tableColumnMetadata, query[key])
      ) {
        const relationFilter: Record<string, unknown> = {
          ...(query[key] as Record<string, unknown>),
        };

        QueryUtil.serializeRelationFilter(
          tableColumnMetadata.modelType!,
          relationFilter,
        );

        query[key] = relationFilter as any;
      }
    }

    // Groups of related records first, then searches and owners.
    const idFilters: Array<FindOperator<unknown>> = [
      ...groupedRelationFilters,
      ...conditionsOnId,
    ];

    if (idFilters.length > 0) {
      /*
       * Apply these only after scalar operators have been serialized, so an
       * existing id condition survives regardless of the query's key order.
       */
      const existingIdFilter: unknown = query._id;
      if (existingIdFilter !== undefined) {
        if (existingIdFilter instanceof FindOperator) {
          idFilters.unshift(existingIdFilter);
        } else if (typeof existingIdFilter === "string") {
          idFilters.unshift(
            QueryHelper.equalTo(existingIdFilter) as FindOperator<unknown>,
          );
        } else {
          throw new BadDataException(
            "The filter on _id cannot be combined with the other filters of the query.",
          );
        }
      }
      query._id = And(...idFilters) as any;
    }

    return query;
  }

  /**
   * Resolves the join-table metadata for a many-to-many relation declared on
   * the provided model. Returns null when the column is not a many-to-many
   * relation, the database connection is not yet ready, or required metadata
   * is missing.
   */
  public static getManyToManyRelationMetadata<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    propertyPath: string,
  ): {
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  } | null {
    if (!PostgresAppInstance.isConnected()) {
      return null;
    }

    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return null;
    }

    let entityMetadata: EntityMetadata | undefined;
    try {
      entityMetadata = dataSource.getMetadata(modelType);
    } catch {
      return null;
    }

    if (!entityMetadata) {
      return null;
    }

    const relation: RelationMetadata | undefined =
      entityMetadata.findRelationWithPropertyPath(propertyPath);

    if (!relation || !relation.isManyToMany) {
      return null;
    }

    /*
     * Only the owning side of a many-to-many has join/inverse columns. Follow
     * the inverse relation when needed.
     */
    const owningRelation: RelationMetadata = relation.isOwning
      ? relation
      : relation.inverseRelation ?? relation;

    const joinTableName: string | undefined =
      owningRelation.junctionEntityMetadata?.tableName;

    if (!joinTableName) {
      return null;
    }

    /*
     * When `modelType` is the owning side, its id lives on joinColumns. When
     * it is the inverse side, its id lives on inverseJoinColumns.
     */
    const ownerColumns: Array<any> = relation.isOwning
      ? owningRelation.joinColumns
      : owningRelation.inverseJoinColumns;
    const relationColumns: Array<any> = relation.isOwning
      ? owningRelation.inverseJoinColumns
      : owningRelation.joinColumns;

    const ownerColumnName: string | undefined = ownerColumns[0]?.databaseName;
    const relationColumnName: string | undefined =
      relationColumns[0]?.databaseName;

    if (!ownerColumnName || !relationColumnName) {
      return null;
    }

    return {
      joinTableName,
      ownerColumnName,
      relationColumnName,
    };
  }

  /*
   * The condition on the record's id that a filter by the model's own
   * labels stands for (serializeQuery: `labels: [ids]`, Includes): the
   * records carrying one of `labelIds` (getLinkedToAnyCondition). Null for
   * any other relation, which keeps its filter through the relation, and
   * without the join table's names (no database).
   */
  public static getLabelsFilterCondition<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    propertyPath: string,
    labelIds: Array<string | ObjectID>,
  ): FindOperator<unknown> | null {
    if (propertyPath !== new modelType().getAccessControlColumn()) {
      return null;
    }

    return QueryUtil.getLinkedToAnyCondition(modelType, propertyPath, labelIds);
  }

  /*
   * THE RECORDS LINKED, THROUGH A MANY-TO-MANY RELATION, TO ONE OF `ids`, as
   * a condition on the record's id: its join table names one of them, the
   * related row there and not deleted - the records a filter through the
   * relation itself (`labels: { _id: In(ids) }`) matches, since TypeORM's
   * join leaves deleted rows out. One uncorrelated subquery
   * (QueryHelper.anyOfEntitiesInManyToMany): it reads the same in a SELECT,
   * an UPDATE and a DELETE, and joins nothing into the read, which returns
   * one row per record. No ids match nothing. Null when the join table
   * cannot be followed: not a many-to-many relation, or no database.
   */
  public static getLinkedToAnyCondition<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    propertyPath: string,
    ids: Array<string | ObjectID>,
  ): FindOperator<unknown> | null {
    const links: ReturnType<typeof QueryUtil.getManyToManyRelationMetadata> =
      QueryUtil.getManyToManyRelationMetadata(modelType, propertyPath);

    if (!links) {
      return null;
    }

    return QueryHelper.anyOfEntitiesInManyToMany({
      values: ids,
      joinTableName: links.joinTableName,
      ownerColumnName: links.ownerColumnName,
      relationColumnName: links.relationColumnName,
      relatedTable: QueryUtil.getManyToManyRelatedTable(
        modelType,
        propertyPath,
      ),
    }) as unknown as FindOperator<unknown>;
  }

  /*
   * The table a many-to-many relation's join table links the model's
   * records to (a monitor's labels: Label), the column of it the join table
   * names, and the column that marks a row of it deleted, if it has one.
   * Null when the column is not a many-to-many relation or the database is
   * not connected (getManyToManyRelationMetadata).
   *
   * A filter through the relation itself joins only the related rows not
   * marked deleted (TypeORM adds `deletedAt IS NULL` to the join), so a
   * condition on the join table that is to match the same records asks the
   * same of the row it links to (QueryHelper.anyOfEntitiesInManyToMany).
   */
  public static getManyToManyRelatedTable<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    propertyPath: string,
  ): ManyToManyRelatedTable | null {
    if (!PostgresAppInstance.isConnected()) {
      return null;
    }

    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return null;
    }

    let entityMetadata: EntityMetadata | undefined;

    try {
      entityMetadata = dataSource.getMetadata(modelType);
    } catch {
      return null;
    }

    const relation: RelationMetadata | undefined =
      entityMetadata?.findRelationWithPropertyPath(propertyPath);

    if (!relation || !relation.isManyToMany) {
      return null;
    }

    const owningRelation: RelationMetadata = relation.isOwning
      ? relation
      : relation.inverseRelation ?? relation;

    // The join table's column that names the related row, and what it names.
    const relationColumn: RelationMetadata["joinColumns"][number] | undefined =
      relation.isOwning
        ? owningRelation.inverseJoinColumns[0]
        : owningRelation.joinColumns[0];

    const relatedMetadata: EntityMetadata = relation.inverseEntityMetadata;
    const columnName: string | undefined =
      relationColumn?.referencedColumn?.databaseName;

    if (!relatedMetadata?.tableName || !columnName) {
      return null;
    }

    return {
      tableName: relatedMetadata.tableName,
      columnName: columnName,
      deleteDateColumnName:
        relatedMetadata.deleteDateColumn?.databaseName || null,
    };
  }
}
