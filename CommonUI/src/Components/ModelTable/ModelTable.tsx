import React, { ReactElement } from "react";
import BaseModelTable, { BaseTableProps } from "./BaseModelTable";
import BaseModel, { BaseModelType } from "Common/Models/BaseModel";
import ModelAPI, { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import Select from "../../Utils/BaseDatabase/Select";
import Query from "../../Utils/BaseDatabase/Query";
import Sort from "../../Utils/BaseDatabase/Sort";
import { AnalyticsBaseModelType } from "Common/AnalyticsModels/BaseModel";

export interface ComponentProps<TBaseModel extends BaseModel> extends BaseTableProps<TBaseModel> {
    modelAPI?: typeof ModelAPI | undefined;
}

const ModelTable: <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {

        const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;
        const model: TBaseModel = new props.modelType();

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
                        const relationSelect: Select<TBaseModel> = {};
                
                        for (const column of props.columns || []) {
                            const key: string | null = column.field
                                ? (Object.keys(column.field)[0] as string)
                                : null;
                
                            if (key && model.isFileColumn(key)) {
                                (relationSelect as JSONObject)[key] = {
                                    file: true,
                                    _id: true,
                                    type: true,
                                    name: true,
                                };
                            } else if (key && model.isEntityColumn(key)) {
                                if (!(relationSelect as JSONObject)[key]) {
                                    (relationSelect as JSONObject)[key] = {};
                                }
                
                                (relationSelect as JSONObject)[key] = {
                                    ...((relationSelect as JSONObject)[key] as JSONObject),
                                    ...(column.field as any)[key],
                                };
                            }
                        }
                
                        return relationSelect;
                    },
                

                    getSelect: (select: Select<TBaseModel>): Select<TBaseModel> => {
                        const slugifyColumn: string | null = (model as  BaseModel).getSlugifyColumn();

                        if (slugifyColumn) {
                            (select as Dictionary<boolean>)[slugifyColumn] = true;
                        }

                        return select;
                    },

                    getModelFromJSON: (item: JSONObject): TBaseModel => {
                        return BaseModel.fromJSON(item, props.modelType) as TBaseModel;
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
