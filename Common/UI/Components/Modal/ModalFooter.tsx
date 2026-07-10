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
  if (!props.onClose && !props.onSubmit && !props.leftFooterElement) {
    return <></>;
  }

  return (
    <div
      className="flex shrink-0 flex-col gap-3 rounded-b-2xl border-t border-gray-100 bg-gray-50/70 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-b-xl sm:px-6"
      data-testid="modal-footer"
    >
      {props.leftFooterElement ? (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center [&>div]:w-full [&>div]:flex-col [&_button]:!w-full sm:[&>div]:w-auto sm:[&>div]:flex-row sm:[&_button]:!ml-0 sm:[&_button]:!w-auto">
          {props.leftFooterElement}
        </div>
      ) : (
        <div className="hidden sm:block" />
      )}
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
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
            className="sm:!w-auto md:!ml-0"
          />
        ) : (
          <></>
        )}

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
            className="sm:!w-auto md:!ml-0"
          />
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default ModalFooter;
