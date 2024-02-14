import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import BaseModelTable, { BaseTableProps } from "./BaseModelTable";
import ModelAPI from "../../Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import React, { ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import Select from "../../Utils/BaseDatabase/Select";
import Query from "../../Utils/BaseDatabase/Query";
import Sort from "../../Utils/BaseDatabase/Sort";
import RequestOptions from "../../Utils/BaseDatabase/RequestOptions";

export interface ComponentProps<TBaseModel extends AnalyticsBaseModel> extends BaseTableProps<TBaseModel> {
    modelAPI?: typeof ModelAPI | undefined;
}

const ModelTable: <TBaseModel extends AnalyticsBaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends AnalyticsBaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {

        const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

        return (
            <BaseModelTable
                {...props}
                callbacks={{

                    getList: async (data: {
                        modelType: {new (): TBaseModel};
                        query: Query<TBaseModel>,
                        limit: number,
                        skip: number,
                        sort: Sort<TBaseModel>,
                        select: Select<TBaseModel>,
                        requestOptions?: RequestOptions,
                    }) => {
                        return await modelAPI.getList<TBaseModel>({
                            modelType: data.modelType,
                            query: data.query,
                            limit: data.limit,
                            skip: data.skip,
                            sort: data.sort,
                            select: data.select,
                            requestOptions: data.requestOptions,
                        });
                    },

                    getRelationSelect: (): Select<TBaseModel> => {
                        return {};
                    },

                    getSelect: (select: Select<TBaseModel>): Select<TBaseModel> => {
                        return select;
                    },

                    getModelFromJSON: (item: JSONObject): TBaseModel => {
                        return AnalyticsBaseModel.fromJSON(item, props.modelType) as TBaseModel;
                    },

                    deleteItem: async (item: TBaseModel) => {
                        await modelAPI.deleteItem({
                            modelType: props.modelType,
                            id: item.id as ObjectID,
                            requestOptions: props.deleteRequestOptions,
                        });
                    }
                }}
            />
        );
    }

export default ModelTable;