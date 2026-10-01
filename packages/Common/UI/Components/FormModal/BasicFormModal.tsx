import { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, {
  BaseComponentProps as BasicFormComponentProps,
} from "../Forms/BasicForm";
import FormAnalyticsName from "../Forms/Utils/FormAnalyticsName";
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
   * it only went to the next one. Like ModelFormModal, a stepped dialog is
   * also widened to fit the step list beside the fields.
   */
  const hasSteps: boolean = Boolean(
    props.formProps.steps && props.formProps.steps.length > 0,
  );

  const [isOnLastFormStep, setIsOnLastFormStep] = useState<boolean>(true);

  const submitButtonText: string | undefined =
    hasSteps && !isOnLastFormStep ? "Next" : props.submitButtonText;

  useEffect(() => {
    setIsLoading(Boolean(props.isLoading));
  }, [props.isLoading]);

  return (
    <Modal
      {...props}
      submitButtonText={submitButtonText}
      modalWidth={
        props.modalWidth ?? (hasSteps ? ModalWidth.Medium : undefined)
      }
      submitButtonType={ButtonType.Submit}
      isLoading={isLoading}
      onSubmit={() => {
        formRef.current.submitForm();
      }}
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
            onIsLastFormStep={(isLastFormStep: boolean) => {
              setIsOnLastFormStep(isLastFormStep);
              props.formProps.onIsLastFormStep?.(isLastFormStep);
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
