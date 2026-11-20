import IconProp from "Common/Types/Icon/IconProp";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * YOUR EMAIL ADDRESS, AND A NEW ONE WAITING TO BE CONFIRMED (#9821).
 *
 * Changing your own email address no longer changes it at once: OneUptime
 * emails the new address, and the address changes only when the link in
 * that email is opened (the server keeps the new one in
 * `newUnverifiedTemporaryEmail` until then). The page is answered the same
 * whatever the new address - whether or not another account has it - so it
 * says the change is waiting, never more: the email to the new address says
 * the rest. Until it is confirmed you sign in with the address you have, and
 * Cancel Change forgets the new one, after which its link changes nothing.
 */
export const PENDING_EMAIL_CHANGE_COPY: {
  waiting: string;
  cancel: string;
  cancelled: string;
  formDescription: string;
  masterAdminFormDescription: string;
} = {
  waiting: translationKey(
    "Waiting for you to confirm {{email}}. Open the link we emailed there to finish changing your email address. Until then, you sign in with this one.",
  ),
  cancel: translationKey("Cancel Change"),
  cancelled: translationKey("Email address change cancelled."),
  // Under the Email field of Basic Info's form.
  formDescription: translationKey(
    "Your email address changes once you open the link we email to the new one.",
  ),
  /*
   * A master admin's own address changes at once, as any they change in
   * the Admin Dashboard does: they see every account already, so the change
   * says nothing to them. The new address is verified with a link.
   */
  masterAdminFormDescription: translationKey(
    "You will have to verify your email again if you change it",
  ),
};

export interface ComponentProps {
  email: string;
  pendingEmail: string | null;
  // The change was cancelled: the card reads the account again.
  onCancelled: () => void;
}

const PendingEmailChange: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  const cancel: () => Promise<void> = async (): Promise<void> => {
    setIsCancelling(true);

    try {
      await ModelAPI.updateById<User>({
        modelType: User,
        id: UserUtil.getUserId(),
        data: {
          newUnverifiedTemporaryEmail: null,
        },
      });

      Toast.success(
        translator.translateText(PENDING_EMAIL_CHANGE_COPY.cancelled) ||
          PENDING_EMAIL_CHANGE_COPY.cancelled,
      );
      props.onCancelled();
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    }

    setIsCancelling(false);
  };

  return (
    <div data-testid="user-profile-email">
      <p>
        <IsolatedText text={props.email} />
      </p>
      {props.pendingEmail ? (
        <div
          className="mt-3 space-y-3"
          data-testid="user-profile-pending-email"
        >
          <Alert
            type={AlertType.INFO}
            icon={IconProp.Email}
            title={
              <TranslatedSentence
                template={PENDING_EMAIL_CHANGE_COPY.waiting}
                slots={{
                  email: (
                    <strong className="font-semibold">
                      <IsolatedText text={props.pendingEmail} />
                    </strong>
                  ),
                }}
              />
            }
          />
          <Button
            title={PENDING_EMAIL_CHANGE_COPY.cancel}
            buttonStyle={ButtonStyleType.NORMAL}
            isLoading={isCancelling}
            disabled={isCancelling}
            onClick={() => {
              void cancel();
            }}
            dataTestId="user-profile-cancel-email-change"
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default PendingEmailChange;
