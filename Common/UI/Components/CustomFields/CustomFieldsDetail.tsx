import API from "../../Utils/API/API";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import Detail from "../Detail/Detail";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicFormModal from "../FormModal/BasicFormModal";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  title: string;
  description: string;
  modelId: ObjectID;
  modelType: DatabaseBaseModelType;
  customFieldType: DatabaseBaseModelType;
  projectId: ObjectID;
  name: string;
  isEditable?: boolean;
}

const CustomFieldsDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [schemaList, setSchemaList] = useState<Array<BaseModel>>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [model, setModel] = useState<BaseModel | null>(null);
  const [showModelForm, setShowModelForm] = useState<boolean>(false);

  const onLoad: PromiseVoidFunction = async (): Promise<void> => {
    try {
      // load schema.
      setIsLoading(true);

      const schemaList: ListResult<BaseModel> =
        await ModelAPI.getList<BaseModel>({
          modelType: props.customFieldType,
          query: {
            projectId: props.projectId,
          } as any,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            customFieldType: true,
            description: true,
          } as any,
          sort: {},
        });

      const item: BaseModel | null = await ModelAPI.getItem<BaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: {
          customFields: true,
        } as any,
      });

      setSchemaList(schemaList.data);
      setModel(item);

      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setError(API.getFriendlyMessage(err));
    }
  };

  type OnSaveFunction = (data: JSONObject) => Promise<void>;

  const onSave: OnSaveFunction = async (data: JSONObject): Promise<void> => {
    try {
      // load schema.
      setIsLoading(true);
      setShowModelForm(false);

      await ModelAPI.updateById({
        modelType: props.modelType,
        id: props.modelId,
        data: {
          customFields: data,
        },
      });

      await onLoad();
    } catch (err) {
      setIsLoading(false);
      setError(API.getFriendlyMessage(err));
    }
  };

  useAsyncEffect(async () => {
    await onLoad();
  }, []);

  const isEditable: boolean = props.isEditable !== false;

  return (
    <Card
      title={props.title}
      description={props.description}
      buttons={
        isEditable
          ? [
              {
                title: "Edit Fields",
                buttonStyle: ButtonStyleType.NORMAL,
                onClick: () => {
                  setShowModelForm(true);
                },
                icon: IconProp.Edit,
              },
            ]
          : []
      }
    >
      <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
        {isLoading && !error && <ComponentLoader />}
        {!isLoading && !error && schemaList.length === 0 && (
          <ErrorMessage message="No custom fields have been added for this resource. You may add custom fields in Project Settings." />
        )}
        {error && <ErrorMessage message={error} />}
        {!model && <ErrorMessage message={"Item not found"} />}

        {!isLoading && !error && model && (
          <Detail
            id={props.name}
            item={(model as any)["customFields"] || {}}
            fields={schemaList.map((schemaItem: BaseModel) => {
              return {
                key: (schemaItem as any).name,
                title: (schemaItem as any).name,
                description: (schemaItem as any).description,
                fieldType: (schemaItem as any).customFieldType,
                placeholder: "No data entered",
              };
            })}
            showDetailsInNumberOfColumns={1}
          />
        )}

        {showModelForm && (
          <BasicFormModal
            title={"Edit " + new props.modelType().singularName}
            onClose={() => {
              return setShowModelForm(false);
            }}
            onSubmit={async (data: JSONObject) => {
              await onSave(data).catch();
            }}
            formProps={{
              initialValues: (model as any)["customFields"] || {},
              fields: schemaList.map((schemaItem: BaseModel) => {
                return {
                  field: {
                    [(schemaItem as any).name]: true,
                  },
                  title: (schemaItem as any).name,
                  description: (schemaItem as any).description,
                  fieldType: (schemaItem as any).customFieldType,
                  required: false,
                  placeholder: "",
                };
              }),
            }}
          />
        )}
      </div>
    </Card>
  );
};

export default CustomFieldsDetail;
