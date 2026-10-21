import { CustomFieldDefinitionModel } from "./CustomFieldDefinitionTable";
import {
  CustomFieldFormCopy,
  getCustomFieldTypeLabelForValue,
  MappedCustomFieldSourceCopy,
} from "./CustomFieldSettingsCopy";
import {
  getMappedCustomFieldColumns,
  getMappedCustomFieldSourceCopy,
  getMappingSourceDefinitionModel,
  getNameAfterSourcePick,
  MappedCustomFieldColumns,
  MappedSourceDefinition,
} from "./MappedCustomField";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { CustomFieldMappingSourceInfo } from "Common/Types/CustomField/CustomFieldMappingCatalog";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import ObjectID from "Common/Types/ObjectID";
import MapFromCustomFieldInput from "Common/UI/Components/CustomFields/MapFromCustomFieldInput";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Create Mapped Custom Field dialog, from a custom field settings card's
 * More menu: a new field that copies its value from a field of a related resource
 * (MappedCustomField.ts says why it is a dialog of its own). It asks three
 * things - the field to copy, a name (the copied field's, until another is
 * typed) and a description - and takes the type and a dropdown's options
 * from the field it copies when it is saved.
 */

export const CREATE_MAPPED_CUSTOM_FIELD_FORM_ID: string =
  "create-mapped-custom-field-form";

export interface ComponentProps {
  // The resource's custom field definitions: IncidentCustomField, ...
  modelType: { new (): CustomFieldDefinitionModel };
  // What its values are copied from: one of the catalog's sources for it.
  source: CustomFieldMappingSourceInfo;
  onClose: () => void;
  onSuccess: (item: CustomFieldDefinitionModel) => void;
}

export type GetMappedCustomFieldFormFieldsFunction = (data: {
  source: CustomFieldMappingSourceInfo;
  sourceDefinitionModelType: DatabaseBaseModelType;
}) => Array<ModelField<CustomFieldDefinitionModel>>;

/**
 * The dialog's three fields: the field to copy, then a name and a
 * description, as on the plain Create form.
 */
export const getMappedCustomFieldFormFields: GetMappedCustomFieldFormFieldsFunction =
  (data: {
    source: CustomFieldMappingSourceInfo;
    sourceDefinitionModelType: DatabaseBaseModelType;
  }): Array<ModelField<CustomFieldDefinitionModel>> => {
    const copy: MappedCustomFieldSourceCopy = getMappedCustomFieldSourceCopy(
      data.source,
    );

    return [
      {
        field: {
          mapFromCustomFieldName: true,
        },
        title: copy.sourceFieldTitle,
        description: copy.sourceFieldDescription,
        fieldType: FormFieldSchemaType.CustomComponent,
        required: true,
        /*
         * Name the new field after the one it copies - unless it already
         * has a name of its own, typed in rather than put there by an
         * earlier pick.
         */
        onChange: (
          value: unknown,
          currentValues: FormValues<CustomFieldDefinitionModel>,
          setNewFormValues: (
            values: FormValues<CustomFieldDefinitionModel>,
          ) => void,
        ) => {
          if (typeof value !== "string" || !value) {
            return;
          }

          const values: Record<string, unknown> = currentValues as Record<
            string,
            unknown
          >;

          const name: string = getNameAfterSourcePick({
            currentName: values["name"],
            previousSourceFieldName: values["mapFromCustomFieldName"],
            sourceFieldName: value,
          });

          if (name !== values["name"]) {
            setNewFormValues({
              ...values,
              name: name,
            } as FormValues<CustomFieldDefinitionModel>);
          }
        },
        getCustomElement: (
          _values: FormValues<CustomFieldDefinitionModel>,
          customElementProps: CustomElementProps,
        ) => {
          return (
            <MapFromCustomFieldInput
              projectId={ProjectUtil.getCurrentProjectId()!}
              sourceDefinitionModelType={data.sourceDefinitionModelType}
              sourceTitle={data.source.title}
              offerEveryType={true}
              describeFieldType={(type: CustomFieldType | undefined) => {
                return getCustomFieldTypeLabelForValue(type);
              }}
              placeholder={copy.sourceFieldPlaceholder}
              noSourceFieldsMessage={copy.noSourceFields}
              initialValue={
                typeof customElementProps.initialValue === "string"
                  ? customElementProps.initialValue
                  : ""
              }
              error={customElementProps.error}
              tabIndex={customElementProps.tabIndex}
              ariaLabelledby={customElementProps.ariaLabelledby}
              onChange={(value: string) => {
                customElementProps.onChange?.(value);
              }}
              onBlur={() => {
                customElementProps.onBlur?.();
              }}
            />
          );
        },
      },
      {
        field: {
          name: true,
        },
        title: "Field Name",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "internal-service",
        validation: {
          minLength: 2,
        },
      },
      {
        field: {
          description: true,
        },
        title: "Field Description",
        fieldType: FormFieldSchemaType.LongText,
        required: false,
        placeholder: "This label is for all the internal services.",
      },
    ];
  };

export type FetchMappedSourceDefinitionFunction = (data: {
  sourceDefinitionModelType: DatabaseBaseModelType;
  sourceFieldName: string;
}) => Promise<MappedSourceDefinition | undefined>;

// The source field as it is stored now, read by its name in this project.
export const fetchMappedSourceDefinition: FetchMappedSourceDefinitionFunction =
  async (data: {
    sourceDefinitionModelType: DatabaseBaseModelType;
    sourceFieldName: string;
  }): Promise<MappedSourceDefinition | undefined> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
      modelType: data.sourceDefinitionModelType,
      query: {
        ...(projectId ? { projectId: projectId } : {}),
        name: data.sourceFieldName,
      } as never,
      limit: 1,
      skip: 0,
      select: {
        name: true,
        customFieldType: true,
        dropdownOptions: true,
      } as never,
      sort: {},
    });

    const row: BaseModel | undefined = result.data[0];

    if (!row) {
      return undefined;
    }

    const read: (column: string) => unknown = (column: string): unknown => {
      return (row as unknown as Record<string, unknown>)[column];
    };

    return {
      name: read("name") as string | undefined,
      customFieldType: read("customFieldType") as CustomFieldType | undefined,
      dropdownOptions: read("dropdownOptions") as string | undefined,
    };
  };

const CreateMappedCustomFieldModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: MappedCustomFieldSourceCopy = getMappedCustomFieldSourceCopy(
    props.source,
  );

  const sourceDefinitionModelType: DatabaseBaseModelType | undefined =
    getMappingSourceDefinitionModel(props.source);

  if (!sourceDefinitionModelType) {
    return <></>;
  }

  return (
    <ModelFormModal<CustomFieldDefinitionModel>
      title={CustomFieldFormCopy.createMappedFieldTitle}
      description={copy.dialogDescription}
      name="Settings > Custom Fields > Create Mapped Custom Field"
      modelType={props.modelType}
      onClose={props.onClose}
      submitButtonText={CustomFieldFormCopy.createMappedFieldSubmit}
      onSuccess={props.onSuccess}
      onBeforeCreate={async (
        item: CustomFieldDefinitionModel,
      ): Promise<CustomFieldDefinitionModel> => {
        const sourceFieldName: string = String(
          item.getColumnValue("mapFromCustomFieldName") || "",
        );

        const columns: MappedCustomFieldColumns = getMappedCustomFieldColumns({
          source: props.source,
          sourceFieldName: sourceFieldName,
          sourceDefinition: await fetchMappedSourceDefinition({
            sourceDefinitionModelType: sourceDefinitionModelType,
            sourceFieldName: sourceFieldName,
          }),
        });

        item.setColumnValue("mapFromResourceType", columns.mapFromResourceType);
        item.setColumnValue(
          "mapFromCustomFieldName",
          columns.mapFromCustomFieldName,
        );
        item.setColumnValue("customFieldType", columns.customFieldType);

        if (columns.dropdownOptions !== undefined) {
          item.setColumnValue("dropdownOptions", columns.dropdownOptions);
        }

        return item;
      }}
      formProps={{
        name: CREATE_MAPPED_CUSTOM_FIELD_FORM_ID,
        id: CREATE_MAPPED_CUSTOM_FIELD_FORM_ID,
        modelType: props.modelType,
        formType: FormType.Create,
        fields: getMappedCustomFieldFormFields({
          source: props.source,
          sourceDefinitionModelType: sourceDefinitionModelType,
        }),
      }}
    />
  );
};

export default CreateMappedCustomFieldModal;
