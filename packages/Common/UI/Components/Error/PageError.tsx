import Navigation from "../../Utils/Navigation";
import { ButtonStyleType } from "../Button/Button";
import ErrorExplanation, {
  isUnexplainedErrorMessage,
} from "../ErrorMessage/ErrorExplanation";
import Modal from "../Modal/Modal";
import { isEmptyErrorPhrase } from "../../../Types/Exception/ErrorMessageRule";
import {
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title?: string;
  message: string;
}

/*
 * What a page that could not load shows, with Reload Page. It said "Oops,
 * something went wrong." over whatever the server answered, and turned a
 * bare "Server Error" into "Network Error: Please reload the page and try
 * again." - on a new self-hosted server whose containers kept restarting,
 * that was all a person saw (#1741). Now its title says what happened, and
 * an error nobody explained says why and what to do next (ErrorExplanation):
 * on a self-hosted server whose gateway answered for it, that is to run
 * npm run doctor, which shows the logs of a container that is not running.
 */
const PageError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // A message that says nothing is one the server did not explain.
  const message: string = isEmptyErrorPhrase(props.message)
    ? UNEXPLAINED_ERROR_MESSAGES.server
    : props.message;

  return (
    <Modal
      title={props.title || UnexplainedErrorWords.pageDidNotLoadTitle}
      onSubmit={() => {
        Navigation.reload();
      }}
      submitButtonStyleType={ButtonStyleType.PRIMARY}
      submitButtonText="Reload Page"
    >
      <p className="text-sm text-gray-500" data-testid="page-error-message">
        {isUnexplainedErrorMessage(message) ? (
          <ErrorExplanation message={message} hideWhatFailed={true} />
        ) : (
          message
        )}
      </p>
    </Modal>
  );
};

export default PageError;
