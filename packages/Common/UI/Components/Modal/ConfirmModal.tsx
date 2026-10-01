import { ButtonStyleType } from "../Button/Button";
import Modal from "./Modal";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  description: string | ReactElement;
  /*
   * Gives the dialog a way out: the footer's Cancel button, the header's X and
   * the Escape key. Without it the dialog is a notice - its one button is the
   * only way out - and that button is drawn plain unless submitButtonType says
   * otherwise.
   */
  onClose?: undefined | (() => void);
  submitButtonText?: undefined | string;
  onSubmit: () => void;
  /*
   * Defaults to PRIMARY when there is a Cancel (the submit is the action the
   * dialog asks about) and to NORMAL when there is not (the submit only
   * acknowledges). Pass DANGER for an action that destroys something.
   */
  submitButtonType?: undefined | ButtonStyleType;
  closeButtonType?: undefined | ButtonStyleType;
  closeButtonText?: undefined | string;
  isLoading?: boolean;
  error?: string | undefined;
  disableSubmitButton?: boolean | undefined;
  // Rendered under the description - for confirmations that also ask something.
  children?: ReactElement | undefined;
}

/*
 * The style a ConfirmModal's submit button gets when the caller does not say.
 *
 * A dialog has one primary button, and it is the thing the dialog exists to
 * do. With a Cancel beside it, the submit is that thing ("Run this step",
 * "Archive") and is PRIMARY. Without one, the dialog is a notice ("Code sent",
 * "Something went wrong") and its single button only closes it, which is no
 * more an action than Cancel is - so it is drawn the way Cancel and Close are.
 */
export const getDefaultConfirmSubmitButtonType: (
  hasCancel: boolean,
) => ButtonStyleType = (hasCancel: boolean): ButtonStyleType => {
  return hasCancel ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL;
};

const ConfirmModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);

  /*
   * Compared with undefined, not by truthiness: ButtonStyleType.PRIMARY is the
   * enum's first member, 0, so `props.submitButtonType ? ... : default` read an
   * explicit PRIMARY as "not given".
   */
  const submitButtonType: ButtonStyleType =
    props.submitButtonType !== undefined
      ? props.submitButtonType
      : getDefaultConfirmSubmitButtonType(Boolean(props.onClose));

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
      closeButtonStyleType={props.closeButtonType ?? ButtonStyleType.NORMAL}
      disableSubmitButton={
        props.disableSubmitButton ? props.disableSubmitButton : false
      }
      submitButtonStyleType={submitButtonType}
      error={props.error}
    >
      {/*
       * The modal body is already the scroll container. A second one here gave
       * a long confirmation two nested scrollbars, and the inner one clipped
       * the text well short of the space the modal had spare.
       */}
      <div>
        <div
          data-testid="confirm-modal-description"
          className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-600"
        >
          {translatedDescription}
        </div>
        {props.children ? <div className="mt-4">{props.children}</div> : <></>}
      </div>
    </Modal>
  );
};

export default ConfirmModal;
