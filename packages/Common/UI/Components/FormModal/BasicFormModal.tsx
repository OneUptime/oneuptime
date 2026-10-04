import { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicForm, {
  BaseComponentProps as BasicFormComponentProps,
  BasicFormHandle,
} from "../Forms/BasicForm";
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
  const formRef: React.MutableRefObject<BasicFormHandle | null> =
    useRef<BasicFormHandle | null>(null);

  /*
   * A stepped form walks with a plain Next and offers the dialog's action
   * ("Change State", "Add Subscribers") on its last step only, as its one
   * primary button (Forms/Utils/SteppedFormFooter.ts). Like ModelFormModal,
   * a stepped dialog is also widened to fit the step list beside the
   * fields.
   */
  const hasSteps: boolean = Boolean(
    props.formProps.steps && props.formProps.steps.length > 0,
  );

  // Starts on Next: the form reports where it is once its first step opens.
  const [isOnLastFormStep, setIsOnLastFormStep] = useState<boolean>(!hasSteps);

  /*
   * Without a submitButtonText the dialog's own default ("Save") is the
   * action: Modal draws it when handed none.
   */
  const footer: SteppedModalFooter = getSteppedModalFooter({
    hasSteps: hasSteps,
    isOnLastStep: isOnLastFormStep,
    onAction: () => {
      formRef.current?.submitAllSteps();
    },
    onNext: () => {
      formRef.current?.goToNextStep();
    },
  });

  useEffect(() => {
    setIsLoading(Boolean(props.isLoading));
  }, [props.isLoading]);

  // Which folded sections are open: an editor in one widens the dialog.
  const openFormSections: OpenFormSections = useOpenFormSections();

  return (
    <Modal
      {...props}
      submitButtonText={props.submitButtonText}
      /*
       * A form with a Markdown editor opens wide, its toolbar on one line -
       * or grows wide when a folded section with one is opened.
       */
      modalWidth={getFormModalWidth({
        fields: props.formProps.fields,
        width: props.modalWidth ?? (hasSteps ? ModalWidth.Medium : undefined),
        openSectionIds: openFormSections.openSectionIds,
      })}
      submitButtonType={ButtonType.Submit}
      isLoading={isLoading}
      onSubmit={footer.onSubmit}
      secondaryButton={footer.secondaryButton}
    >
      <OpenFormSectionsContext.Provider
        value={openFormSections.reportSectionOpen}
      >
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
      </OpenFormSectionsContext.Provider>
    </Modal>
  );
};

export default BasicFormModal;
