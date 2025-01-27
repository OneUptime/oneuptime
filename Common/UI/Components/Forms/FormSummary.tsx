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
              const detailField: DetailField<T> = {
                title: field.title || "",
                fieldType: field.getSummaryElement
                  ? FieldType.Element
                  : FormFieldSchemaTypeUtil.toFieldType(
                      field.fieldType || FormFieldSchemaType.Text,
                    ),
                description: field.description || "",
                getElement: field.getSummaryElement as any,
                sideLink: field.sideLink,
                key: (Object.keys(field.field || {})[0]?.toString() ||
                  "") as keyof T,
              };
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
