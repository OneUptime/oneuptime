import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import BaseModelTable, { BaseTableProps } from "./BaseModelTable";
import ModelAPI from "../../Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import React, { ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import Select from "../../Utils/BaseDatabase/Select";

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