import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Alert, { AlertType } from "../Alerts/Alert";
import { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import { BasicFormHandle, FormProps } from "../Forms/BasicForm";
import ModelForm, {
  ComponentProps as ModelFormComponentProps,
  FormType,
  ModelFormOnBeforeCreate,
  ModelFormOnBeforeUpdate,
} from "../Forms/ModelForm";
import FormValues from "../Forms/Types/FormValues";
import FormAnalyticsName from "../Forms/Utils/FormAnalyticsName";
import {
  SteppedModalFooter,
  getSteppedModalFooter,
} from "../Forms/Utils/SteppedFormFooter";
import { getFormModalWidth } from "../Forms/Utils/FormModalWidth";
import {
  OpenFormSections,
  OpenFormSectionsContext,
  useOpenFormSections,
} from "../Forms/Utils/OpenFormSections";
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
  onBeforeUpdate?: ModelFormOnBeforeUpdate<TBaseModel> | undefined;
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
   * A stepped form, create or edit, walks with a plain Next and offers its
   * action - Create, Save Changes - on the last step only, as its one
   * primary button (Forms/Utils/SteppedFormFooter.ts). The action checks
   * every step first and opens the first one with a problem.
   *
   * An edit form's step list opens any step, not only the ones already
   * passed: every step of an edit form is filled in already, so a change on
   * the first step is saved by clicking the last step in the list and Save
   * Changes there - not by walking every step in between.
   */
  const isEditFormWithSteps: boolean =
    hasSteps && props.formProps.formType === FormType.Update;

  // Starts on Next: the form reports where it is once its first step opens.
  const [isOnLastFormStep, setIsOnLastFormStep] = useState<boolean>(
    !hasSteps,
  );

  /*
   * Made on every render and used when the caller passes no ref of its own.
   * Calling useRef only when props.formRef was missing made the number of
   * hooks depend on a prop, which React cannot survive changing.
   */
  const ownFormRef: MutableRefObject<FormProps<FormValues<TBaseModel>>> =
    useRef<FormProps<FormValues<TBaseModel>>>(null) as MutableRefObject<
      FormProps<FormValues<TBaseModel>>
    >;

  const formRef: MutableRefObject<FormProps<FormValues<TBaseModel>>> =
    props.formRef || ownFormRef;

  const [error, setError] = useState<string>("");

  const footer: SteppedModalFooter = getSteppedModalFooter({
    hasSteps: hasSteps,
    isOnLastStep: isOnLastFormStep,
    onAction: () => {
      (formRef.current as unknown as BasicFormHandle | null)?.submitAllSteps();
    },
    onNext: () => {
      (formRef.current as unknown as BasicFormHandle | null)?.goToNextStep();
    },
  });

  // Which folded sections are open: an editor in one widens the dialog.
  const openFormSections: OpenFormSections = useOpenFormSections();

  let modalWidth: ModalWidth = props.modalWidth || ModalWidth.Normal;

  if (hasSteps) {
    modalWidth = props.modalWidth || ModalWidth.Medium;
  }

  /*
   * A form with a Markdown editor opens wide, its toolbar on one line - or
   * grows wide when a folded section with one is opened.
   */
  modalWidth =
    getFormModalWidth({
      fields: props.formProps.fields,
      width: modalWidth,
      openSectionIds: openFormSections.openSectionIds,
    }) ?? modalWidth;

  return (
    <Modal
      {...props}
      submitButtonText={props.submitButtonText || "Save"}
      modalWidth={modalWidth}
      submitButtonType={ButtonType.Submit}
      isLoading={isFormLoading}
      description={props.description}
      disableSubmitButton={isFormLoading}
      onSubmit={footer.onSubmit}
      secondaryButton={footer.secondaryButton}
      error={error}
    >
      {!error ? (
        <OpenFormSectionsContext.Provider
          value={openFormSections.reportSectionOpen}
        >
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
            onBeforeUpdate={props.onBeforeUpdate}
          />

          {props.footer}
        </OpenFormSectionsContext.Provider>
      ) : (
        <></>
      )}

      {error ? <Alert title={error} type={AlertType.DANGER} /> : <></>}
    </Modal>
  );
};

export default ModelFormModal;
