import Query from './Query';
import QueryHelper from './QueryHelper';
import BaseModel from 'Common/Models/BaseModel';
import EqualToOrNull from 'Common/Types/BaseDatabase/EqualToOrNull';
import GreaterThan from 'Common/Types/BaseDatabase/GreaterThan';
import GreaterThanOrEqual from 'Common/Types/BaseDatabase/GreaterThanOrEqual';
import InBetween from 'Common/Types/BaseDatabase/InBetween';
import Includes from 'Common/Types/BaseDatabase/Includes';
import IsNull from 'Common/Types/BaseDatabase/IsNull';
import LessThan from 'Common/Types/BaseDatabase/LessThan';
import LessThanOrEqual from 'Common/Types/BaseDatabase/LessThanOrEqual';
import NotEqual from 'Common/Types/BaseDatabase/NotEqual';
import NotNull from 'Common/Types/BaseDatabase/NotNull';
import Search from 'Common/Types/BaseDatabase/Search';
import { TableColumnMetadata } from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import Typeof from 'Common/Types/Typeof';
import { FindOperator } from 'typeorm/find-options/FindOperator';

export default class QueryUtil {
    public static serializeQuery<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>
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
                    query[key] as any
                ) as FindOperator<any> as any;
            } else if (
                query[key] &&
                tableColumnMetadata &&
                tableColumnMetadata.type === TableColumnType.JSON
            ) {
                query[key] = QueryHelper.queryJson(
                    query[key] as any
                ) as FindOperator<any> as any;
            } else if (
                query[key] &&
                query[key] instanceof NotEqual &&
                tableColumnMetadata
            ) {
                query[key] = QueryHelper.notEquals(
                    query[key] as any
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
                    (query[key] as ObjectID).toString() as any
                ) as any;
            } else if (
                query[key] &&
                query[key] instanceof Search &&
                tableColumnMetadata
            ) {
                query[key] = QueryHelper.search(
                    (query[key] as Search).toString() as any
                ) as any;
            } else if (
                query[key] &&
                query[key] instanceof LessThan &&
                tableColumnMetadata
            ) {
                query[key] = QueryHelper.lessThan(
                    (query[key] as LessThan).toString() as any
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
                    (query[key] as InBetween).startValue as any,
                    (query[key] as InBetween).endValue as any
                ) as any;
            } else if (
                query[key] &&
                query[key] instanceof GreaterThan &&
                tableColumnMetadata
            ) {
                query[key] = QueryHelper.greaterThan(
                    (query[key] as GreaterThan).toString() as any
                ) as any;
            } else if (
                query[key] &&
                query[key] instanceof Includes &&
                tableColumnMetadata
            ) {
                query[key] = QueryHelper.in(
                    (query[key] as Includes).values
                ) as any;
            } else if (
                query[key] &&
                query[key] instanceof GreaterThanOrEqual &&
                tableColumnMetadata
            ) {
                query[key] = QueryHelper.greaterThanEqualTo(
                    (query[key] as GreaterThanOrEqual).toString() as any
                ) as any;
            } else if (
                query[key] &&
                query[key] instanceof LessThanOrEqual &&
                tableColumnMetadata
            ) {
                query[key] = QueryHelper.lessThanEqualTo(
                    (query[key] as LessThanOrEqual).toString() as any
                ) as any;
            } else if (
                query[key] &&
                Array.isArray(query[key]) &&
                tableColumnMetadata &&
                tableColumnMetadata.type !== TableColumnType.EntityArray
            ) {
                query[key] = QueryHelper.in(
                    query[key] as any
                ) as FindOperator<any> as any;
            }

            if (
                tableColumnMetadata &&
                tableColumnMetadata.manyToOneRelationColumn &&
                typeof query[key] === Typeof.String
            ) {
                (query as any)[tableColumnMetadata.manyToOneRelationColumn] =
                    query[key] as string;
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

                        if (item && (item as JSONObject)['_id']) {
                            return (item as JSONObject)['_id'] as string;
                        }

                        return item;
                    }
                ) as any;

                (query as any)[key] = {
                    _id: QueryHelper.in(query[key] as Array<string>),
                };
            }
        }

        return query;
    }
}
