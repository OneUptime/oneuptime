import React, { ReactElement } from "react";
import BaseModelTable, { BaseTableProps, ModalType, ShowTableAs } from "./BaseModelTable";
import BaseModel from "Common/Models/BaseModel";
import ModelAPI, { RequestOptions } from "../../Utils/ModelAPI/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import Select from "../../Utils/BaseDatabase/Select";
import Query from "../../Utils/BaseDatabase/Query";
import Sort from "../../Utils/BaseDatabase/Sort";
import ModelFormModal from "../ModelFormModal/ModelFormModal";
import { FormType } from "../Forms/ModelForm";

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

                    getJSONFromModel: (item: TBaseModel): JSONObject => {
                        return BaseModel.toJSONObject(item, props.modelType);
                    },

                    updateById: async (args: {
                        id: ObjectID,
                        data: JSONObject,
                    }) => {

                        const {id, data } = args;

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
                        query: Query<TBaseModel>,
                        limit: number,
                        skip: number,
                        sort: Sort<TBaseModel>,
                        select: Select<TBaseModel>,
                        requestOptions?: RequestOptions | undefined,
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

                
                    addSlugToSelect: (select: Select<TBaseModel>): Select<TBaseModel> => {
                        const slugifyColumn: string | null = (model as  BaseModel).getSlugifyColumn();

                        if (slugifyColumn) {
                            (select as Dictionary<boolean>)[slugifyColumn] = true;
                        }

                        return select;
                    },

                    showCreateEditModal: (data: {
                        modalType: ModalType,
                        modelIdToEdit?: ObjectID | undefined,
                        onBeforeCreate?: ((item: TBaseModel, miscDataProps: JSONObject) => Promise<TBaseModel>) | undefined,
                        onSuccess?: ((item: TBaseModel) => void) | undefined,
                        onClose?: (() => void) | undefined,
                    }): ReactElement => {

                        const { modalType, modelIdToEdit, onBeforeCreate, onSuccess, onClose } = data;

                        return (
                            <ModelFormModal<TBaseModel>
                                modelAPI={props.modelAPI}
                                title={
                                    modalType === ModalType.Create
                                        ? `${props.createVerb || 'Create'} New ${
                                              props.singularName || model.singularName
                                          }`
                                        : `Edit ${props.singularName || model.singularName}`
                                }
                                modalWidth={props.createEditModalWidth}
                                name={
                                    modalType === ModalType.Create
                                        ? `${props.name} > ${
                                              props.createVerb || 'Create'
                                          } New ${props.singularName || model.singularName}`
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
                                        ? `${props.createVerb || 'Create'} ${
                                              props.singularName || model.singularName
                                          }`
                                        : `Save Changes`
                                }
                                onSuccess={onSuccess}
                                onBeforeCreate={onBeforeCreate}
                                modelType={props.modelType}
                                formProps={{
                                    name: `create-${props.modelType.name}-from`,
                                    modelType: props.modelType,
                                    id: `create-${props.modelType.name}-from`,
                                    fields: props.formFields || [],
                                    steps: props.formSteps || [],
                                    formType:
                                        modalType === ModalType.Create
                                            ? FormType.Create
                                            : FormType.Update,
                                }}
                                modelIdToEdit={
                                    modelIdToEdit
                                }
                            />
                        )
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
