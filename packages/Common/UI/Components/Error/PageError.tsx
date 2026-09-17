import Navigation from "../../Utils/Navigation";
import { ButtonStyleType } from "../Button/Button";
import Modal from "../Modal/Modal";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title?: string;
  message: string;
}

const PageError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let message: string = props.message;

  if (props.message === "Server Error") {
    message = "Network Error: Please reload the page and try again.";
  }

  return (
    <Modal
      title={props.title || "Oops, something went wrong."}
      onSubmit={() => {
        Navigation.reload();
      }}
      submitButtonStyleType={ButtonStyleType.NORMAL}
      submitButtonText="Reload Page"
    >
      <p className="text-sm text-gray-500">{message}</p>
    </Modal>
  );
};

export default PageError;
