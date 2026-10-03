import { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, {
  BaseComponentProps as BasicFormComponentProps,
} from "../Forms/BasicForm";
import FormAnalyticsName from "../Forms/Utils/FormAnalyticsName";
import {
  NEXT_BUTTON_TEXT,
  SteppedFormFooter,
  getSteppedFormFooter,
} from "../Forms/Utils/FinishFromAnyStep";
import { getFormModalWidth } from "../Forms/Utils/FormModalWidth";
import Modal, { ModalWidth } from "../Modal/Modal";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useRef, useState } from "react";

export interface ComponentProps<T extends GenericObject> {
  title: string;
  /*
   * Identifies this form in the "FORM SUBMIT" analytics event. Falls back to
   * formProps.name and then to the modal title, so every modal reports a
   * distinguishable conversion without each caller having to name it.
   */
  name?: string | undefined;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  onClose?: undefined | (() => void);
  submitButtonText?: undefined | string;
  onSubmit?: undefined | ((data: T) => void);
  submitButtonStyleType?: undefined | ButtonStyleType;
  formProps: BasicFormComponentProps<T>;
  description?: string | undefined;
  modalWidth?: ModalWidth | undefined;
  /*
   * The dialog edits values that are all filled in already, so a stepped
   * form saves from any step: see isEditFormWithSteps below.
   */
  saveFromAnyStep?: boolean | undefined;
}

const BasicFormModal: <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(props.isLoading));
  const formRef: any = useRef<any>(null);

  /*
   * A stepped form's button moves on until the last step, and says so: it
   * read the action ("Change State", "Add Subscribers") on every step while
   * it only went to the next one - unless every step left is optional, when
   * it is the action again, with a plain Next beside it
   * (Forms/Utils/FinishFromAnyStep.ts). Like ModelFormModal, a stepped
   * dialog is also widened to fit the step list beside the fields.
   */
  const hasSteps: boolean = Boolean(
    props.formProps.steps && props.formProps.steps.length > 0,
  );

  /*
   * A stepped EDIT dialog keeps its save button on every step, like
   * ModelFormModal's stepped edit forms: every step is filled in already,
   * and a wizard whose only button read "Next" lost the change someone made
   * on an earlier step when they closed it. The save validates every step;
   * a plain Next walks on; the step list opens any step.
   */
  const isEditFormWithSteps: boolean =
    hasSteps && Boolean(props.saveFromAnyStep);

  const [isOnLastFormStep, setIsOnLastFormStep] = useState<boolean>(true);

  const [canFinishFromCurrentStep, setCanFinishFromCurrentStep] =
    useState<boolean>(false);

  /*
   * Without a submitButtonText the dialog's own default ("Save") is the
   * action: Modal draws it when handed none.
   */
  const footer: SteppedFormFooter = getSteppedFormFooter({
    hasSteps: hasSteps,
    isOnLastStep: isOnLastFormStep,
    canFinishFromCurrentStep: canFinishFromCurrentStep,
    savesFromAnyStep: isEditFormWithSteps,
    actionText: props.submitButtonText || "",
  });

  const submitButtonText: string | undefined =
    footer.primaryButtonText || props.submitButtonText;

  useEffect(() => {
    setIsLoading(Boolean(props.isLoading));
  }, [props.isLoading]);

  return (
    <Modal
      {...props}
      submitButtonText={submitButtonText}
      // A form with a Markdown editor opens wide, its toolbar on one line.
      modalWidth={getFormModalWidth({
        fields: props.formProps.fields,
        width: props.modalWidth ?? (hasSteps ? ModalWidth.Medium : undefined),
      })}
      submitButtonType={ButtonType.Submit}
      isLoading={isLoading}
      onSubmit={() => {
        if (footer.primaryButtonSubmitsAllSteps) {
          formRef.current.submitAllSteps();
          return;
        }

        formRef.current.submitForm();
      }}
      secondaryButton={
        footer.showNextButton
          ? {
              title: NEXT_BUTTON_TEXT,
              dataTestId: "modal-footer-next-button",
              onClick: () => {
                formRef.current.goToNextStep();
              },
            }
          : undefined
      }
    >
      <>
        {isLoading && <ComponentLoader />}

        {props.error && <ErrorMessage message={props.error} />}

        {!isLoading && (
          <BasicForm
            {...props.formProps}
            name={FormAnalyticsName.resolve(
              props.name,
              props.formProps.name,
              props.title,
            )}
            hideSubmitButton={true}
            allowAnyStepNavigation={
              isEditFormWithSteps || props.formProps.allowAnyStepNavigation
            }
            onIsLastFormStep={(isLastFormStep: boolean) => {
              setIsOnLastFormStep(isLastFormStep);
              props.formProps.onIsLastFormStep?.(isLastFormStep);
            }}
            onCanFinishFromCurrentStep={(canFinish: boolean) => {
              setCanFinishFromCurrentStep(canFinish);
              props.formProps.onCanFinishFromCurrentStep?.(canFinish);
            }}
            ref={formRef}
            onLoadingChange={(isFormLoading: boolean) => {
              setIsLoading(isFormLoading);
            }}
            onSubmit={(data: T) => {
              props.onSubmit?.(data);
            }}
          />
        )}
      </>
    </Modal>
  );
};

export default BasicFormModal;
