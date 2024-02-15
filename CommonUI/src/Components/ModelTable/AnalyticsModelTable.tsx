import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import BaseModelTable, { BaseTableProps, ModalType } from './BaseModelTable';
import ModelAPI from '../../Utils/AnalyticsModelAPI/AnalyticsModelAPI';
import React, { ReactElement } from 'react';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';
import Select from '../../Utils/BaseDatabase/Select';
import Query from '../../Utils/BaseDatabase/Query';
import Sort from '../../Utils/BaseDatabase/Sort';
import RequestOptions from '../../Utils/BaseDatabase/RequestOptions';
import NotImplementedException from 'Common/Types/Exception/NotImplementedException';

export interface ComponentProps<TBaseModel extends AnalyticsBaseModel>
    extends BaseTableProps<TBaseModel> {
    modelAPI?: typeof ModelAPI | undefined;
}

const AnalyticsModelTable: <TBaseModel extends AnalyticsBaseModel>(
    props: ComponentProps<TBaseModel>
) => ReactElement = <TBaseModel extends AnalyticsBaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

    return (
        <BaseModelTable
            {...props}
            callbacks={{
                getJSONFromModel: (item: TBaseModel): JSONObject => {
                    return AnalyticsBaseModel.toJSON(item, props.modelType);
                },

                updateById: async (args: {
                    id: ObjectID;
                    data: JSONObject;
                }) => {
                    const { id, data } = args;

                    await modelAPI.updateById({
                        modelType: props.modelType,
                        id: new ObjectID(id),
                        data: data,
                    });
                },

                showCreateEditModal: (_data: {
                    modalType: ModalType;
                    modelIdToEdit?: ObjectID | undefined;
                    onBeforeCreate?:
                        | ((
                              item: TBaseModel,
                              miscDataProps: JSONObject
                          ) => Promise<TBaseModel>)
                        | undefined;
                    onSuccess?: ((item: TBaseModel) => void) | undefined;
                    onClose?: (() => void) | undefined;
                }): ReactElement => {
                    throw new NotImplementedException();
                },

                toJSONArray: (items: TBaseModel[]): JSONObject[] => {
                    return AnalyticsBaseModel.toJSONArray(
                        items,
                        props.modelType
                    );
                },

                getList: async (data: {
                    query: Query<TBaseModel>;
                    limit: number;
                    skip: number;
                    sort: Sort<TBaseModel>;
                    select: Select<TBaseModel>;
                    requestOptions?: RequestOptions | undefined;
                }) => {
                    return await modelAPI.getList<TBaseModel>({
                        modelType: props.modelType,
                        query: data.query,
                        limit: data.limit,
                        skip: data.skip,
                        sort: data.sort,
                        select: data.select,
                        requestOptions: data.requestOptions,
                    });
                },

                addSlugToSelect: (
                    select: Select<TBaseModel>
                ): Select<TBaseModel> => {
                    return select;
                },

                getModelFromJSON: (item: JSONObject): TBaseModel => {
                    return AnalyticsBaseModel.fromJSON(
                        item,
                        props.modelType
                    ) as TBaseModel;
                },

                deleteItem: async (item: TBaseModel) => {
                    await modelAPI.deleteItem({
                        modelType: props.modelType,
                        id: item.id as ObjectID,
                        requestOptions: props.deleteRequestOptions,
                    });
                },
            }}
        />
    );
};

export default AnalyticsModelTable;
