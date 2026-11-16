import {
  API_KEY_SHOWN_ONCE_TEST_ID,
  API_KEY_SHOWN_ONCE_VALUE_TEST_ID,
  ApiKeyShownOnceCopy,
  RESET_API_KEY_CARD_TEST_ID,
} from "./ApiKeyShownOnceCopy";
import { resetApiKey } from "./ResetApiKeyApi";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import { ResetApiKeyAnswer } from "Common/Types/ApiKey/ApiKeyShownOnce";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ShownOnceSecretModal from "Common/UI/Components/ShownOnceSecret/ShownOnceSecretModal";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * RESET API KEY, on a key's page (#8902).
 *
 * A project's API keys are stored as their hash, so a reset is the server's
 * to make: POST /api-key/:id/reset-key makes a new key in place of the
 * current one and answers it once. (The page used to make the new key
 * itself and save it through the generic API, which now refuses any key it
 * did not make.) The card:
 *
 *   - asks first, saying what breaks: every script and tool that uses the
 *     key stops working within a minute;
 *   - then shows the new key once, in a dialog whose only way out is Done
 *     (ShownOnceSecretModal), with a copy button, and keeps it nowhere once
 *     the dialog is closed;
 *   - is locked, saying why, for someone who may not change the key: the
 *     key column's own update permissions (Project Owner, Project Admin,
 *     Edit API Key), which the server holds the reset to.
 *
 * onReset is told the new key's hint, so the page can say how the key ends
 * now.
 */

export interface ComponentProps {
  apiKeyId: ObjectID;
  onReset?: ((answer: ResetApiKeyAnswer) => void) | undefined;
}

const ResetApiKeyCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isAsked, setIsAsked] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // The key just made: shown in its dialog, and forgotten when it closes.
  const [shownKey, setShownKey] = useState<string | null>(null);

  // A reset writes the key: the key column's own update permissions.
  const resetGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new ApiKey(),
    "apiKey",
  );

  const reset: () => Promise<void> = async (): Promise<void> => {
    setIsResetting(true);
    setError("");

    try {
      const answer: ResetApiKeyAnswer = await resetApiKey(props.apiKeyId);

      setIsAsked(false);
      setShownKey(answer.apiKey);
      props.onReset?.(answer);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsResetting(false);
  };

  return (
    <div data-testid={RESET_API_KEY_CARD_TEST_ID}>
      <Card
        title={ApiKeyShownOnceCopy.resetCardTitle}
        description={ApiKeyShownOnceCopy.resetCardDescription}
        buttons={[
          {
            title: ApiKeyShownOnceCopy.resetCardTitle,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Reload,
            disabled: !resetGate.isAllowed || isResetting,
            tooltip: resetGate.disabledReason,
            onClick: () => {
              if (!resetGate.isAllowed) {
                return;
              }

              setError("");
              setIsAsked(true);
            },
          },
        ]}
      />

      {isAsked ? (
        <ConfirmModal
          title={ApiKeyShownOnceCopy.resetConfirmation.title}
          description={ApiKeyShownOnceCopy.resetConfirmation.description}
          submitButtonText={
            ApiKeyShownOnceCopy.resetConfirmation.submitButtonText
          }
          submitButtonType={
            ApiKeyShownOnceCopy.resetConfirmation.submitButtonType
          }
          isLoading={isResetting}
          error={error || undefined}
          onSubmit={() => {
            void reset();
          }}
          onClose={() => {
            setIsAsked(false);
            setError("");
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * SHOWN ONCE. The key is stored as its hash, so this is the one time
       * anyone sees it: Done is the only way out.
       */}
      {shownKey ? (
        <ShownOnceSecretModal
          title={ApiKeyShownOnceCopy.shownOnceTitle}
          description={ApiKeyShownOnceCopy.shownOnceDescription}
          doneButtonText={ApiKeyShownOnceCopy.done}
          secret={shownKey}
          onDone={() => {
            setShownKey(null);
          }}
          dataTestId={API_KEY_SHOWN_ONCE_TEST_ID}
          valueTestId={API_KEY_SHOWN_ONCE_VALUE_TEST_ID}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default ResetApiKeyCard;
