import ModelAPI, { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";
import API from "../../Utils/API/API";
import ModelImportExportUtil, {
  ImportResult,
} from "../../Utils/ModelImportExport";
import PermissionUtil from "../../Utils/Permission";
import User from "../../Utils/User";
import { FormType, ModelField } from "../Forms/ModelForm";
import ModelFormModal from "../ModelFormModal/ModelFormModal";
import BaseModelTable, {
  BaseTableProps,
  BulkActionProps,
  ModalType,
} from "./BaseModelTable";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "../BulkUpdate/BulkUpdateForm";
import ImportModelsModal from "../ImportExport/ImportModelsModal";
import { ButtonStyleType } from "../Button/Button";
import { ComponentProps as CardComponentProps } from "../Card/Card";
import { AnalyticsBaseModelType } from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../../Types/Dictionary";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import React, { ReactElement, useState } from "react";
import Query from "../../../Types/BaseDatabase/Query";
import GroupBy from "../../../Types/BaseDatabase/GroupBy";
import Sort from "../../../Types/BaseDatabase/Sort";
import Select from "../../../Types/BaseDatabase/Select";

export interface ComponentProps<TBaseModel extends BaseModel>
  extends BaseTableProps<TBaseModel> {
  modelAPI?: typeof ModelAPI | undefined;
  enableJsonImportExport?: boolean | undefined;
}

const ModelTable: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;
  const model: TBaseModel = new props.modelType();

  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importRefreshCounter, setImportRefreshCounter] = useState<number>(0);

  type GetExportBulkActionFunction = () => BulkActionButtonSchema<TBaseModel>;

  const getExportBulkAction: GetExportBulkActionFunction =
    (): BulkActionButtonSchema<TBaseModel> => {
      return {
        title: "Export JSON",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.Download,
        onClick: async ({
          items,
          onProgressInfo,
          onBulkActionStart,
          onBulkActionEnd,
        }: BulkActionOnClickProps<TBaseModel>) => {
          onBulkActionStart();

          const inProgressItems: Array<TBaseModel> = [...items];
          const successItems: Array<TBaseModel> = [];
          const failedItems: Array<BulkActionFailed<TBaseModel>> = [];
          const itemsToExport: Array<TBaseModel> = [];

          for (const item of items) {
            inProgressItems.splice(inProgressItems.indexOf(item), 1);

            try {
              if (!item.id) {
                throw new Error(
                  `${model.singularName || "Item"} id not found.`,
                );
              }

              const fetchedItem: TBaseModel =
                await ModelImportExportUtil.fetchItemForExport<TBaseModel>({
                  modelType: props.modelType,
                  modelId: item.id,
                  modelAPI: modelAPI,
                });

              itemsToExport.push(fetchedItem);
              successItems.push(item);
            } catch (err) {
              failedItems.push({
                item: item,
                failedMessage: API.getFriendlyMessage(err),
              });
            }

            onProgressInfo({
              totalItems: items,
              inProgressItems: [...inProgressItems],
              successItems: [...successItems],
              failed: [...failedItems],
            });
          }

          if (itemsToExport.length > 0) {
            ModelImportExportUtil.downloadExportFile({
              modelType: props.modelType,
              items: itemsToExport,
            });
          }

          onBulkActionEnd();
        },
      };
    };

  let bulkActions: BulkActionProps<TBaseModel> | undefined = props.bulkActions;
  let cardProps: CardComponentProps | undefined = props.cardProps;
  let refreshToggle: string | undefined = props.refreshToggle;

  if (props.enableJsonImportExport) {
    bulkActions = {
      ...(props.bulkActions || {}),
      buttons: [...(props.bulkActions?.buttons || []), getExportBulkAction()],
    };

    const permissions: Array<Permission> | null =
      PermissionUtil.getAllPermissions();

    const hasPermissionToCreate: boolean = permissions
      ? model.hasCreatePermissions(permissions) || User.isMasterAdmin()
      : false;

    if (hasPermissionToCreate) {
      cardProps = {
        ...(props.cardProps || {}),
        buttons: [
          ...(props.cardProps?.buttons || []),
          {
            title: "Import JSON",
            buttonStyle: ButtonStyleType.OUTLINE,
            icon: IconProp.Upload,
            onClick: () => {
              setShowImportModal(true);
            },
          },
        ],
      };
    }

    refreshToggle = `${props.refreshToggle || ""}-import-${importRefreshCounter}`;
  }

  return (
    <>
      {showImportModal && (
        <ImportModelsModal<TBaseModel>
          modelType={props.modelType as { new (): TBaseModel }}
          modelAPI={modelAPI}
          onClose={() => {
            setShowImportModal(false);
          }}
          onImportComplete={(result: ImportResult) => {
            if (result.successCount > 0) {
              setImportRefreshCounter((counter: number) => {
                return counter + 1;
              });
            }
          }}
        />
      )}
      <BaseModelTable
        {...props}
        bulkActions={bulkActions}
        cardProps={cardProps}
        refreshToggle={refreshToggle}
        callbacks={{
          getJSONFromModel: (item: TBaseModel): JSONObject => {
            return BaseModel.toJSONObject(item, props.modelType);
          },

          updateById: async (args: { id: ObjectID; data: JSONObject }) => {
            const { id, data } = args;

            await modelAPI.updateById({
              modelType: props.modelType,
              id: new ObjectID(id),
              data: data,
            });
          },

          toJSONArray: (items: TBaseModel[]): JSONObject[] => {
            return BaseModel.toJSONObjectArray(items, props.modelType);
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
            return await modelAPI.getList<TBaseModel>({
              modelType: data.modelType as { new (): TBaseModel },
              query: data.query,
              limit: data.limit,
              groupBy: data.groupBy,
              skip: data.skip,
              sort: data.sort,
              select: data.select,
              requestOptions: data.requestOptions,
            });
          },

          addSlugToSelect: (select: Select<TBaseModel>): Select<TBaseModel> => {
            const slugifyColumn: string | null = (
              model as BaseModel
            ).getSlugifyColumn();

            if (slugifyColumn) {
              (select as Dictionary<boolean>)[slugifyColumn] = true;
            }

            return select;
          },

          showCreateEditModal: (data: {
            modalType: ModalType;
            modelIdToEdit?: ObjectID | undefined;
            onBeforeCreate?:
              | ((
                  item: TBaseModel,
                  miscDataProps: JSONObject,
                ) => Promise<TBaseModel>)
              | undefined;
            onSuccess?: ((item: TBaseModel) => void) | undefined;
            onClose?: (() => void) | undefined;
          }): ReactElement => {
            const {
              modalType,
              modelIdToEdit,
              onBeforeCreate,
              onSuccess,
              onClose,
            } = data;

            return (
              <ModelFormModal<TBaseModel>
                modelAPI={props.modelAPI}
                title={
                  modalType === ModalType.Create
                    ? `${props.createVerb || "Create"} New ${
                        props.singularName || model.singularName
                      }`
                    : `Edit ${props.singularName || model.singularName}`
                }
                formRef={props.createEditFromRef}
                modalWidth={props.createEditModalWidth}
                name={
                  modalType === ModalType.Create
                    ? `${props.name} > ${props.createVerb || "Create"} New ${
                        props.singularName || model.singularName
                      }`
                    : `${props.name} > Edit ${
                        props.singularName || model.singularName
                      }`
                }
                initialValues={
                  modalType === ModalType.Create
                    ? props.createInitialValues
                    : undefined
                }
                onClose={onClose}
                submitButtonText={
                  modalType === ModalType.Create
                    ? `${props.createVerb || "Create"} ${
                        props.singularName || model.singularName
                      }`
                    : `Save Changes`
                }
                onSuccess={onSuccess}
                onBeforeCreate={onBeforeCreate}
                modelType={props.modelType}
                formProps={{
                  summary: props.formSummary,
                  name: `create-${props.modelType.name}-from`,
                  modelType: props.modelType,
                  id: `create-${props.modelType.name}-from`,
                  fields:
                    props.formFields?.filter(
                      (field: ModelField<TBaseModel>) => {
                        // If the field has doNotShowWhenEditing set to true, then don't show it when editing

                        if (modelIdToEdit) {
                          return !field.doNotShowWhenEditing;
                        }

                        // If the field has doNotShowWhenCreating set to true, then don't show it when creating

                        return !field.doNotShowWhenCreating;
                      },
                    ) || [],
                  steps: props.formSteps || [],
                  formType:
                    modalType === ModalType.Create
                      ? FormType.Create
                      : FormType.Update,
                }}
                modelIdToEdit={modelIdToEdit}
              />
            );
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
          },
        }}
      />
    </>
  );
};

export default ModelTable;
