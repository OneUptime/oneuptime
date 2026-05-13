import Button, { ButtonStyleType } from "../Button/Button";
import ButtonType from "../Button/ButtonTypes";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClose?: undefined | (() => void) | undefined;
  submitButtonText?: undefined | string;
  onSubmit?: (() => void) | undefined;
  submitButtonStyleType?: undefined | ButtonStyleType;
  closeButtonStyleType?: undefined | ButtonStyleType;
  submitButtonType?: undefined | ButtonType;
  isLoading?: undefined | boolean;
  disableSubmitButton?: undefined | boolean;
  closeButtonText?: undefined | string;
  leftFooterElement?: ReactElement | undefined;
}

const ModalFooter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="bg-gray-50 px-4 py-3 flex flex-row gap-3 md:px-6 md:justify-between">
      {props.leftFooterElement ? (
        <div className="flex flex-row gap-3">{props.leftFooterElement}</div>
      ) : (
        <div />
      )}
      <div className="flex flex-row gap-3 md:flex-row-reverse">
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
              props.onSubmit?.();
            }}
            disabled={props.disableSubmitButton || false}
            isLoading={props.isLoading || false}
            type={
              props.submitButtonType
                ? props.submitButtonType
                : ButtonType.Button
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
    </div>
  );
};

export default ModalFooter;
