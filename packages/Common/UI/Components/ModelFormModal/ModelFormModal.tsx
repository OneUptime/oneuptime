import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Alert, { AlertType } from "../Alerts/Alert";
import { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import { BasicFormHandle, FormProps } from "../Forms/BasicForm";
import ModelForm, {
  ComponentProps as ModelFormComponentProps,
  FormType,
  ModelFormOnBeforeCreate,
} from "../Forms/ModelForm";
import FormValues from "../Forms/Types/FormValues";
import FormAnalyticsName from "../Forms/Utils/FormAnalyticsName";
import { getFormModalWidth } from "../Forms/Utils/FormModalWidth";
import Modal, { ModalWidth } from "../Modal/Modal";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import React, { MutableRefObject, ReactElement, useRef, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  title: string;
  description?: string | undefined;
  modelAPI?: typeof ModelAPI | undefined;
  name?: string | undefined;
  modelType: { new (): TBaseModel };
  initialValues?: FormValues<TBaseModel> | undefined;
  onClose?: undefined | (() => void);
  submitButtonText?: undefined | string;
  modalWidth?: ModalWidth | undefined;
  onSuccess?: undefined | ((data: TBaseModel) => void);
  submitButtonStyleType?: undefined | ButtonStyleType;
  formProps: ModelFormComponentProps<TBaseModel>;
  modelIdToEdit?: ObjectID | undefined;
  onBeforeCreate?: ModelFormOnBeforeCreate<TBaseModel> | undefined;
  footer?: ReactElement | undefined;
  formRef?: undefined | MutableRefObject<FormProps<FormValues<TBaseModel>>>;
}

const ModelFormModal: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [isFormLoading, setIsFormLoading] = useState<boolean>(false);

  const hasSteps: boolean = Boolean(
    props.formProps.steps && props.formProps.steps.length > 0,
  );

  /*
   * A stepped EDIT form keeps its save button on every step. Every step of
   * an edit form is filled in already, so there is nothing to walk through
   * first - and a wizard whose only button read "Next" lost edits: someone
   * changed a field on the first step, saw no Save, closed the dialog and
   * the change was gone (dbb2f8920b took the Probe form's steps away for
   * exactly that). So the submit button saves from wherever the user is,
   * after validating every step; a plain Next walks on; and the step list
   * opens any step, not only the ones already passed.
   *
   * A create form is unchanged: Next until the last step, then the action.
   */
  const isEditFormWithSteps: boolean =
    hasSteps && props.formProps.formType === FormType.Update;

  const [isOnLastFormStep, setIsOnLastFormStep] = useState<boolean>(true);

  const submitButtonText: string =
    isEditFormWithSteps || isOnLastFormStep
      ? props.submitButtonText || "Save"
      : "Next";

  const formRef: MutableRefObject<FormProps<FormValues<TBaseModel>>> =
    props.formRef ||
    (useRef<FormProps<FormValues<TBaseModel>>>(null) as MutableRefObject<
      FormProps<FormValues<TBaseModel>>
    >);

  const [error, setError] = useState<string>("");

  let modalWidth: ModalWidth = props.modalWidth || ModalWidth.Normal;

  if (hasSteps) {
    modalWidth = props.modalWidth || ModalWidth.Medium;
  }

  // A form with a Markdown editor opens wide, its toolbar on one line.
  modalWidth =
    getFormModalWidth({
      fields: props.formProps.fields,
      width: modalWidth,
    }) ?? modalWidth;

  return (
    <Modal
      {...props}
      submitButtonText={submitButtonText}
      modalWidth={modalWidth}
      submitButtonType={ButtonType.Submit}
      isLoading={isFormLoading}
      description={props.description}
      disableSubmitButton={isFormLoading}
      onSubmit={async () => {
        if (isEditFormWithSteps) {
          (
            formRef.current as unknown as BasicFormHandle | null
          )?.submitAllSteps();
          return;
        }

        await formRef.current?.submitForm();
      }}
      secondaryButton={
        isEditFormWithSteps && !isOnLastFormStep
          ? {
              title: "Next",
              dataTestId: "modal-footer-next-button",
              onClick: () => {
                void formRef.current?.submitForm();
              },
            }
          : undefined
      }
      error={error}
    >
      {!error ? (
        <>
          <ModelForm<TBaseModel>
            {...props.formProps}
            name={FormAnalyticsName.resolve(
              props.name,
              props.formProps.name,
              props.title,
            )}
            modelAPI={props.modelAPI}
            modelType={props.modelType}
            onIsLastFormStep={(isLastFormStep: boolean) => {
              setIsOnLastFormStep(isLastFormStep);
            }}
            allowAnyStepNavigation={isEditFormWithSteps}
            modelIdToEdit={props.modelIdToEdit}
            hideSubmitButton={true}
            formRef={formRef}
            onLoadingChange={(isFormLoading: boolean) => {
              setIsFormLoading(isFormLoading);
            }}
            initialValues={props.initialValues}
            onSuccess={(data: TBaseModel) => {
              if (props.onSuccess) {
                props.onSuccess(
                  BaseModel.fromJSONObject(data as TBaseModel, props.modelType),
                );
              }
            }}
            onError={(error: string) => {
              setError(error);
            }}
            onBeforeCreate={props.onBeforeCreate}
          />

          {props.footer}
        </>
      ) : (
        <></>
      )}

      {error ? <Alert title={error} type={AlertType.DANGER} /> : <></>}
    </Modal>
  );
};

export default ModelFormModal;
