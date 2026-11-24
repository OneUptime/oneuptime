import ModelAPI from "../../Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import DatabaseModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Query from "../../../Types/BaseDatabase/Query";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import BaseModelTable, { BaseTableProps, ModalType } from "./BaseModelTable";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NotImplementedException from "../../../Types/Exception/NotImplementedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import React, { ReactElement } from "react";
import Select from "../../../Types/BaseDatabase/Select";
import Sort from "../../../Types/BaseDatabase/Sort";
import GroupBy from "../../../Types/BaseDatabase/GroupBy";
import RequestOptions from "../../Utils/API/RequestOptions";
import { ModelFormOnBeforeCreate } from "../Forms/ModelForm";

export interface ComponentProps<TBaseModel extends AnalyticsBaseModel>
  extends BaseTableProps<TBaseModel> {
  modelAPI?: typeof ModelAPI | undefined;
}

const AnalyticsModelTable: <TBaseModel extends AnalyticsBaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends AnalyticsBaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

  return (
    <BaseModelTable
      {...props}
      callbacks={{
        getJSONFromModel: (item: TBaseModel): JSONObject => {
          return AnalyticsBaseModel.toJSON(item, props.modelType);
        },

        updateById: async (args: { id: ObjectID; data: JSONObject }) => {
          const { id, data } = args;

          await modelAPI.updateById({
            modelType: props.modelType,
            id: new ObjectID(id),
            data: data,
          });
        },

        moveInList: async (_args: {
          id: ObjectID;
          placeOfId: ObjectID;
        }): Promise<void> => {
          // Telemetry rows are no list anyone puts in order.
          throw new NotImplementedException();
        },

        showCreateEditModal: (_data: {
          modalType: ModalType;
          modelIdToEdit?: ObjectID | undefined;
          onBeforeCreate?: ModelFormOnBeforeCreate<TBaseModel> | undefined;
          onSuccess?: ((item: TBaseModel) => void) | undefined;
          onClose?: (() => void) | undefined;
        }): ReactElement => {
          // Analytics database like clickhuse dont support edit operations
          throw new NotImplementedException();
        },

        toJSONArray: (items: TBaseModel[]): JSONObject[] => {
          return AnalyticsBaseModel.toJSONArray(items, props.modelType);
        },

        getList: async (data: {
          modelType: DatabaseBaseModelType | AnalyticsBaseModelType;
          query: Query<TBaseModel>;
          groupBy?: GroupBy<TBaseModel> | undefined;
          limit: number;
          skip: number;
          sort: Sort<TBaseModel>;
          select: Select<TBaseModel>;
          requestOptions?: RequestOptions | undefined;
        }) => {
          /*
           * A filter's records of the project's database - the services a
           * Service filter searches and names by their ids - are read
           * through the database's list route, as any other list's
           * pickers read them (#10764). The rows, and any other analytics
           * model, go through the analytics API.
           */
          if (data.modelType.prototype instanceof BaseModel) {
            return (await DatabaseModelAPI.getList<BaseModel>({
              modelType: data.modelType as DatabaseBaseModelType,
              query: data.query as Query<BaseModel>,
              groupBy: data.groupBy as GroupBy<BaseModel> | undefined,
              limit: data.limit,
              skip: data.skip,
              sort: data.sort as Sort<BaseModel>,
              select: data.select as Select<BaseModel>,
              requestOptions: data.requestOptions,
            })) as unknown as ListResult<TBaseModel>;
          }

          return await modelAPI.getList<TBaseModel>({
            modelType: data.modelType as { new (): TBaseModel },
            query: data.query,
            groupBy: data.groupBy,
            limit: data.limit,
            skip: data.skip,
            sort: data.sort,
            select: data.select,
            requestOptions: data.requestOptions,
          });
        },

        addSlugToSelect: (select: Select<TBaseModel>): Select<TBaseModel> => {
          return select;
        },

        getModelFromJSON: (item: JSONObject): TBaseModel => {
          return AnalyticsBaseModel.fromJSON(
            item,
            props.modelType,
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
