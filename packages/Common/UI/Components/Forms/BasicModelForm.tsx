import { ButtonStyleType } from "../Button/Button";
import BasicForm, {
  DefaultValidateFunction,
  FormErrors,
  FormProps,
  FormSummaryConfig,
} from "./BasicForm";
import Fields from "./Types/Fields";
import FormFieldSchemaType from "./Types/FormFieldSchemaType";
import { FormStep } from "./Types/FormStep";
import FormValues from "./Types/FormValues";
import FormAnalyticsName from "./Utils/FormAnalyticsName";
import { isRestatingColumnDescription } from "./Utils/ColumnDescriptionOnForm";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  model: TBaseModel;
  id: string;
  onSubmit: (
    values: FormValues<TBaseModel>,
    onSubmitSuccessful: () => void,
  ) => void;
  onChange?:
    | undefined
    | ((
        values: FormValues<TBaseModel>,
        setNewFormValues: (newValues: FormValues<TBaseModel>) => void,
      ) => void);
  onValidate?:
    | undefined
    | ((values: FormValues<TBaseModel>) => FormErrors<FormValues<TBaseModel>>);
  fields: Fields<TBaseModel>;
  submitButtonText?: undefined | string;
  submitButtonStyleType?: ButtonStyleType | undefined;
  name?: string | undefined;
  steps?: undefined | Array<FormStep<TBaseModel>>;
  onIsLastFormStep?: undefined | ((isLastFormStep: boolean) => void);
  onFormStepChange?: undefined | ((stepId: string) => void);
  title?: undefined | string;
  description?: undefined | string;
  showAsColumns?: undefined | number;
  disableAutofocus?: undefined | boolean;
  footer?: ReactElement | undefined;
  isLoading?: undefined | boolean;
  onCancel?: undefined | (() => void);
  cancelButtonText?: undefined | string;
  maxPrimaryButtonWidth?: undefined | boolean;
  error: string | null;
  hideSubmitButton?: undefined | boolean;
  formRef?: undefined | MutableRefObject<FormProps<FormValues<TBaseModel>>>;
  initialValues?: FormValues<TBaseModel> | undefined;
  summary?: FormSummaryConfig | undefined;
  values?: FormValues<TBaseModel> | undefined;
  allowAnyStepNavigation?: boolean | undefined;
  // What the form's entity dropdowns search through (see BasicForm).
  modelAPI?: typeof ModelAPI | undefined;
}

const BasicModelForm: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [formFields, setFormFields] = useState<Fields<TBaseModel>>([]);

  let initialValues: FormValues<TBaseModel> = {};

  if (props.initialValues) {
    initialValues = { ...props.initialValues };
  }

  useEffect(() => {
    const fields: Fields<TBaseModel> = [];
    // Prep
    for (const field of props.fields) {
      if (Object.keys(field.field || {}).length > 0) {
        if (
          props.model.getDisplayColumnTitleAs(
            Object.keys(field.field || {})[0] as string,
          ) &&
          !field.title
        ) {
          field.title = props.model.getDisplayColumnTitleAs(
            Object.keys(field.field || {})[0] as string,
          ) as string;
        }

        /*
         * A color column's description tells an API reader how to write a
         * color ("in Hex (#32a852 for example)"). The form's swatches need no
         * such instructions, so FormField says something plainer instead.
         */
        const columnDescription: string | null =
          props.model.getDisplayColumnDescriptionAs(
            Object.keys(field.field || {})[0] as string,
          );

        if (
          field.fieldType !== FormFieldSchemaType.Color &&
          // The field says what it means another way (Field.hideColumnDescription).
          !field.hideColumnDescription &&
          columnDescription &&
          /*
           * "Any friendly name of this object" under Name says nothing the
           * title does not, in English in every language
           * (Utils/ColumnDescriptionOnForm).
           */
          !isRestatingColumnDescription(columnDescription) &&
          !field.description
        ) {
          field.description = columnDescription;
        }
      }

      fields.push(field);
    }

    setFormFields(fields);
  }, [props.fields]);

  return (
    <BasicForm
      values={props.values}
      isLoading={props.isLoading || false}
      fields={formFields}
      id={props.id}
      onChange={props.onChange}
      onValidate={props.onValidate ? props.onValidate : DefaultValidateFunction}
      disableAutofocus={props.disableAutofocus}
      steps={props.steps}
      name={FormAnalyticsName.resolve(props.name, props.title)}
      onFormStepChange={props.onFormStepChange}
      submitButtonStyleType={props.submitButtonStyleType}
      onSubmit={props.onSubmit}
      initialValues={initialValues}
      submitButtonText={props.submitButtonText || "Save"}
      title={props.title || ""}
      description={props.description || ""}
      footer={props.footer}
      showAsColumns={props.showAsColumns || 1}
      onCancel={props.onCancel}
      cancelButtonText={props.cancelButtonText}
      maxPrimaryButtonWidth={props.maxPrimaryButtonWidth || false}
      error={props.error}
      onIsLastFormStep={props.onIsLastFormStep}
      hideSubmitButton={props.hideSubmitButton}
      ref={props.formRef}
      summary={props.summary}
      allowAnyStepNavigation={props.allowAnyStepNavigation}
      modelAPI={props.modelAPI}
    ></BasicForm>
  );
};

export default BasicModelForm;
