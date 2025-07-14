import Button, { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClose?: undefined | (() => void) | undefined;
  submitButtonText?: undefined | string;
  onSubmit: () => void;
  submitButtonStyleType?: undefined | ButtonStyleType;
  closeButtonStyleType?: undefined | ButtonStyleType;
  submitButtonType?: undefined | ButtonType;
  isLoading?: undefined | boolean;
  disableSubmitButton?: undefined | boolean;
  closeButtonText?: undefined | string;
}

const ModalFooter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="bg-gray-50 px-4 py-3 flex flex-row gap-3 md:flex-row-reverse md:px-6">
      {props.onSubmit ? (
        <Button
          buttonStyle={
            props.submitButtonStyleType
              ? props.submitButtonStyleType
              : ButtonStyleType.PRIMARY
          }
          title={
            props.submitButtonText ? props.submitButtonText : "Save Changes"
          }
          onClick={() => {
            props.onSubmit();
          }}
          disabled={props.disableSubmitButton || false}
          isLoading={props.isLoading || false}
          type={
            props.submitButtonType ? props.submitButtonType : ButtonType.Button
          }
          dataTestId="modal-footer-submit-button"
        />
      ) : (
        <></>
      )}

      {props.onClose ? (
        <Button
          buttonStyle={
            props.closeButtonStyleType
              ? props.closeButtonStyleType
              : ButtonStyleType.NORMAL
          }
          title={props.closeButtonText ? props.closeButtonText : "Cancel"}
          data-dismiss="modal"
          onClick={() => {
            props.onClose?.();
          }}
          dataTestId="modal-footer-close-button"
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default ModalFooter;
