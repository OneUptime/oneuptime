import { ButtonStyleType } from "../Button/Button";
import Modal from "./Modal";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

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
  return (
    <Modal
      title={props.title}
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
        data-testid="confirm-modal-description"
        className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-sm leading-6 text-gray-600"
      >
        {translatedDescription}
      </div>
    </Modal>
  );
};

export default ConfirmModal;
