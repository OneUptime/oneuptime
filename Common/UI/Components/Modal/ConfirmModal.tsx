import { ButtonStyleType } from "../Button/Button";
import Modal from "./Modal";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  title: string;
  description: string | ReactElement;
  onClose?: undefined | (() => void);
  submitButtonText?: undefined | string;
  onSubmit: () => void;
  submitButtonType?: undefined | ButtonStyleType;
  closeButtonType?: undefined | ButtonStyleType;
  closeButtonText?: undefined | string;
  isLoading?: boolean;
  error?: string | undefined;
  disableSubmitButton?: boolean | undefined;
}

const ConfirmModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);
  const descriptionId: string = `confirm-modal-description-${useId()}`;

  return (
    <Modal
      title={props.title}
      ariaDescribedBy={descriptionId}
      isLoading={props.isLoading}
      onSubmit={props.onSubmit}
      onClose={props.onClose ? props.onClose : undefined}
      submitButtonText={
        props.submitButtonText ? props.submitButtonText : "Confirm"
      }
      closeButtonText={props.closeButtonText ? props.closeButtonText : "Cancel"}
      closeButtonStyleType={
        props.closeButtonType ? props.closeButtonType : ButtonStyleType.NORMAL
      }
      disableSubmitButton={
        props.disableSubmitButton ? props.disableSubmitButton : false
      }
      submitButtonStyleType={
        props.submitButtonType
          ? props.submitButtonType
          : ButtonStyleType.PRIMARY
      }
      error={props.error}
    >
      <div
        id={descriptionId}
        data-testid="confirm-modal-description"
        className="max-h-96 whitespace-pre-wrap break-words pr-1 text-sm leading-6 text-slate-600"
      >
        {translatedDescription}
      </div>
    </Modal>
  );
};

export default ConfirmModal;
