import Query from "./Query";
import QueryHelper from "./QueryHelper";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Typeof from "../../../Types/Typeof";
import { And, DataSource } from "typeorm";
import { FindOperator } from "typeorm/find-options/FindOperator";
import { CompareType } from "../../../Types/Database/CompareBase";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";

export default class QueryUtil {
  @CaptureSpan()
  public static serializeQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
  ): Query<TBaseModel> {
    const model: BaseModel = new modelType();

    query = query as Query<TBaseModel>;

    for (const key in query) {
      const tableColumnMetadata: TableColumnMetadata =
        model.getTableColumnMetadata(key);

      if (tableColumnMetadata && query[key] === null) {
        query[key] = QueryHelper.isNull();
      } else if (
        query[key] &&
        query[key] instanceof NotNull &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.notNull();
      } else if (
        query[key] &&
        query[key] instanceof EqualToOrNull &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.equalToOrNull(
          query[key] as any,
        ) as FindOperator<any> as any;
      } else if (
        query[key] &&
        query[key] instanceof EqualTo &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.equalTo(
          query[key] as any,
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
          query[key] as any,
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
        query[key] instanceof LessThan &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.lessThan(
          (query[key] as LessThan<CompareType>).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof IsNull &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.isNull() as any;
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
          (query[key] as GreaterThan<CompareType>).toString() as any,
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

            // Remove the relation-based filter so TypeORM does not create a
            // JOIN that would yield OR semantics.
            delete query[key];

            const existingIdFilter: any = (query as any)._id;
            if (existingIdFilter instanceof FindOperator) {
              (query as any)._id = And(existingIdFilter, subqueryFilter);
            } else if (
              existingIdFilter &&
              typeof existingIdFilter === Typeof.String
            ) {
              (query as any)._id = And(
                QueryHelper.equalTo(existingIdFilter as string),
                subqueryFilter,
              );
            } else {
              (query as any)._id = subqueryFilter;
            }
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
        query[key] instanceof IncludesNone &&
        tableColumnMetadata
      ) {
        if (tableColumnMetadata.type === TableColumnType.EntityArray) {
          const includesNone: IncludesNone = query[key] as IncludesNone;
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

            const existingIdFilter: any = (query as any)._id;
            if (existingIdFilter instanceof FindOperator) {
              (query as any)._id = And(existingIdFilter, subqueryFilter);
            } else if (
              existingIdFilter &&
              typeof existingIdFilter === Typeof.String
            ) {
              (query as any)._id = And(
                QueryHelper.equalTo(existingIdFilter as string),
                subqueryFilter,
              );
            } else {
              (query as any)._id = subqueryFilter;
            }
          } else {
            delete query[key];
          }
        } else if (tableColumnMetadata.type === TableColumnType.Entity) {
          query[key] = QueryHelper.notIn(
            (query[key] as IncludesNone).values as Array<string | ObjectID>,
          ) as any;
        } else {
          query[key] = QueryHelper.notIn(
            (query[key] as IncludesNone).values as Array<string | ObjectID>,
          ) as any;
        }
      } else if (
        query[key] &&
        query[key] instanceof Includes &&
        tableColumnMetadata
      ) {
        if (
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
          (query[key] as GreaterThanOrEqual<CompareType>).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof LessThanOrEqual &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.lessThanEqualTo(
          (query[key] as LessThanOrEqual<CompareType>).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof LessThanOrNull &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.lessThanOrNull(
          (query[key] as LessThanOrNull<CompareType>).toString() as any,
        ) as any;
      } else if (
        query[key] &&
        query[key] instanceof GreaterThanOrNull &&
        tableColumnMetadata
      ) {
        query[key] = QueryHelper.greaterThanOrNull(
          (query[key] as LessThanOrNull<CompareType>).toString() as any,
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
        (query as any)[tableColumnMetadata.manyToOneRelationColumn] = query[
          key
        ] as string;
        delete query[key];
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

        (query as any)[key] = {
          _id: QueryHelper.any(query[key] as Array<string>),
        };
      }
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

    // Only the owning side of a many-to-many has join/inverse columns. Follow
    // the inverse relation when needed.
    const owningRelation: RelationMetadata = relation.isOwning
      ? relation
      : (relation.inverseRelation ?? relation);

    const joinTableName: string | undefined =
      owningRelation.junctionEntityMetadata?.tableName;

    if (!joinTableName) {
      return null;
    }

    // When `modelType` is the owning side, its id lives on joinColumns. When
    // it is the inverse side, its id lives on inverseJoinColumns.
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
}
