import React, { FunctionComponent, ReactElement } from "react";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import {
  TokenRefreshOutcome,
  getTokenRefreshDescription,
  getTokenRefreshTitle,
} from "../../Utils/Workflow/WorkflowVariableUtil";

/*
 * What happened when OneUptime asked the identity provider for a token - after
 * an OAuth 2.0 variable was created, or after its credentials were replaced.
 * Shown until dismissed: a refusal quotes the provider, and that is the thing
 * somebody needs to read.
 *
 * It opens as soon as the request goes out, with a spinner, rather than when
 * the answer comes back. A token request can take up to 20 seconds, and until
 * this modal appeared nothing on screen said anything was happening.
 */

export interface ComponentProps {
  variableName: string;
  // Null while the request to the identity provider is still out.
  outcome: TokenRefreshOutcome | null;
  onClose: () => void;
}

const WorkflowVariableTokenRefreshModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.outcome) {
    return (
      <ConfirmModal
        title="Fetching an Access Token"
        description={`Asking your identity provider for an access token for "${props.variableName}".`}
        submitButtonText="Close"
        submitButtonType={ButtonStyleType.NORMAL}
        isLoading={true}
        disableSubmitButton={true}
        onSubmit={() => {
          // Nothing to close yet: the answer replaces this modal.
        }}
      />
    );
  }

  return (
    <ConfirmModal
      title={getTokenRefreshTitle(props.outcome)}
      description={getTokenRefreshDescription(props.outcome)}
      submitButtonText="Close"
      submitButtonType={ButtonStyleType.NORMAL}
      onSubmit={props.onClose}
    />
  );
};

export default WorkflowVariableTokenRefreshModal;
