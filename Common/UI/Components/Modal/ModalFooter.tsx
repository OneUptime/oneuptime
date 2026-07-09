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
    <div
      className="flex shrink-0 flex-col gap-3 border-t border-slate-200/80 bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
      data-testid="modal-footer"
      style={{
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
    >
      {props.leftFooterElement ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 [&_button]:!ml-0 [&_button]:!w-auto">
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
            className="!ml-0 sm:!w-auto"
            data-dismiss="modal"
            onClick={() => {
              props.onClose?.();
            }}
            dataTestId="modal-footer-close-button"
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
            className="!ml-0 sm:!w-auto"
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
      </div>
    </div>
  );
};

export default ModalFooter;
