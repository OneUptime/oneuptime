import React, { ReactElement } from "react";
import Detail from "../Detail/Detail";
import FormValues from "./Types/FormValues";
import GenericObject from "../../../Types/GenericObject";
import Fields from "./Types/Fields";
import FormFieldSchemaTypeUtil from "./Utils/FormFieldSchemaTypeUtil";
import FormFieldSchemaType from "./Types/FormFieldSchemaType";
import DetailField from "../Detail/Field";
import Field from "./Types/Field";
import FieldType from "../Types/FieldType";
import { FormStep } from "./Types/FormStep";
import HorizontalRule from "../HorizontalRule/HorizontalRule";

type SummaryElementFn<T extends GenericObject> = (
  item: FormValues<T>,
) => ReactElement | undefined;

type FileSummaryItem = {
  name?: string;
  fileName?: string;
  slug?: string;
  _id?: string;
};

const getFieldName: <T extends GenericObject>(
  field: Field<T>,
) => string | undefined = <T extends GenericObject>(
  field: Field<T>,
): string | undefined => {
  if (field.overrideFieldKey) {
    return field.overrideFieldKey;
  }

  const key: string | undefined = Object.keys(field.field || {})[0];
  return key;
};

const getFileSummaryElement: <T extends GenericObject>(
  field: Field<T>,
) => SummaryElementFn<T> | undefined = <T extends GenericObject>(
  field: Field<T>,
): SummaryElementFn<T> | undefined => {
  if (
    field.fieldType !== FormFieldSchemaType.File &&
    field.fieldType !== FormFieldSchemaType.MultipleFiles
  ) {
    return undefined;
  }

  const fieldName: string | undefined = getFieldName(field);

  if (!fieldName) {
    return undefined;
  }

  const formatFileName: (
    file: FileSummaryItem | string,
    index: number,
  ) => string = (file: FileSummaryItem | string, index: number): string => {
    if (!file) {
      return `File ${index + 1}`;
    }

    if (typeof file === "string") {
      return file;
    }

    const fileObject: FileSummaryItem = file as FileSummaryItem;

    return (
      fileObject.name ||
      fileObject.fileName ||
      fileObject.slug ||
      fileObject._id ||
      `File ${index + 1}`
    );
  };

  const renderFiles: SummaryElementFn<T> = (
    item: FormValues<T>,
  ): ReactElement | undefined => {
    const formValuesRecord: Record<string, unknown> =
      (item as Record<string, unknown>) || {};

    const value: FileSummaryItem | Array<FileSummaryItem | string> | string | null =
      (formValuesRecord[fieldName] as
        | FileSummaryItem
        | Array<FileSummaryItem | string>
        | string
        | null
        | undefined) || null;

    if (!value || (Array.isArray(value) && value.length === 0)) {
      return <span className="text-gray-500">No files selected.</span>;
    }

    const files: Array<FileSummaryItem | string> = Array.isArray(value)
      ? (value as Array<FileSummaryItem | string>)
      : [value as FileSummaryItem | string];

    return (
      <ul className="list-disc pl-5 space-y-1">
        {files.map((file: FileSummaryItem | string, index: number) => {
          const displayName: string = formatFileName(file, index);
          const key: string =
            (typeof file === "object" && file && (file as FileSummaryItem)._id) ||
            `${displayName}-${index}`;

          return <li key={key}>{displayName}</li>;
        })}
      </ul>
    );
  };

  return renderFiles;
};

export interface ComponentProps<T> {
  formValues: FormValues<T>;
  formFields: Fields<T>;
  formSteps: FormStep<T>[] | undefined;
}

const FormSummary: <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { formValues, formFields } = props;

  const getDetailForFormFields: <T extends GenericObject>(
    formValues: FormValues<T>,
    formFields: Fields<T>,
  ) => ReactElement = <T extends GenericObject>(
    formValues: FormValues<T>,
    formFields: Fields<T>,
  ): ReactElement => {
    return (
      <div>
        <Detail
          item={formValues as T}
          fields={
            formFields.map((field: Field<T>) => {
              const defaultSummaryElement: SummaryElementFn<T> | undefined =
                getFileSummaryElement(field);

              const detailField: DetailField<T> = {
                title: field.title || "",
                fieldType: field.getSummaryElement
                  ? FieldType.Element
                  : FormFieldSchemaTypeUtil.toFieldType(
                      field.fieldType || FormFieldSchemaType.Text,
                    ),
                description: field.description || "",
                getElement: (field.getSummaryElement || defaultSummaryElement) as any,
                sideLink: field.sideLink,
                key: (Object.keys(field.field || {})[0]?.toString() ||
                  "") as keyof T,
              };

              if (defaultSummaryElement && !field.getSummaryElement) {
                detailField.fieldType = FieldType.Element;
              }
              return detailField;
            }) as DetailField<GenericObject>[]
          }
        />
        <HorizontalRule />
      </div>
    );
  };

  const getFormStepTitle: (formStep: FormStep<T>) => ReactElement = (
    formStep: FormStep<T>,
  ): ReactElement => {
    return (
      <h2 className="text-md font-medium text-gray-900 mb-3">
        {formStep.title}
      </h2>
    );
  };

  const getDetailForFormStep: (formStep: FormStep<T>) => ReactElement = (
    formStep: FormStep<T>,
  ): ReactElement => {
    const formFields: Fields<T> = props.formFields
      .filter((field: Field<T>) => {
        return formStep.id === field.stepId;
      })
      .filter((formField: Field<T>) => {
        if (!formField.showIf) {
          return true;
        }
        return formField.showIf(formValues);
      });

    if (formFields.length === 0) {
      return <></>;
    }

    return (
      <div>
        {getFormStepTitle(formStep)}
        {getDetailForFormFields(formValues, formFields)}
      </div>
    );
  };

  if (props.formSteps && props.formSteps.length > 0) {
    return (
      <div>
        {props.formSteps
          .filter((step: FormStep<T>) => {
            if (!step.showIf) {
              return true;
            }
            return step.showIf(props.formValues);
          })
          .map((formStep: FormStep<T>) => {
            return getDetailForFormStep(formStep);
          })}
      </div>
    );
  }

  return getDetailForFormFields(formValues, formFields);
};

export default FormSummary;
