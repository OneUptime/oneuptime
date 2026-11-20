import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { writeReaderMoment } from "Common/UI/Utils/ReaderMoments";
import Toast from "Common/UI/Utils/Toast";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * YOUR EMAIL ADDRESS, AND A NEW ONE WAITING TO BE CONFIRMED (#9821, #9908).
 *
 * Changing your own email address no longer changes it at once: OneUptime
 * emails the new address, and the address changes only when the link in
 * that email is opened (the server keeps the new one in
 * `newUnverifiedTemporaryEmail` until then). The page is answered the same
 * whatever the new address - whether or not another account has it - so it
 * says the change is waiting, never more: the email to the new address says
 * the rest. Until it is confirmed you sign in with the address you have, and
 * Cancel Change forgets the new one, after which its link changes nothing.
 *
 * The link works for a day (#9908): the server keeps when it stops working
 * beside the waiting address (`newUnverifiedTemporaryEmailExpires`), the
 * same for a taken address as for a free one. While it works the card says
 * until when; once it has run out it says so, and Send Link Again - the
 * change asked for again, counted like any other - sends a new one. A change
 * asked for before the server kept the time reads as waiting, with both
 * buttons. The card turns to expired by itself when the link runs out while
 * the page is open.
 */
export const PENDING_EMAIL_CHANGE_COPY: {
  waiting: string;
  linkWorksUntil: string;
  expired: string;
  sendAgain: string;
  sentAgain: string;
  cancel: string;
  cancelled: string;
  formDescription: string;
  masterAdminFormDescription: string;
} = {
  waiting: translationKey(
    "Waiting for you to confirm {{email}}. Open the link we emailed there to finish changing your email address. Until then, you sign in with this one.",
  ),
  // While the link works: until when, on the reader's clock and in their zone.
  linkWorksUntil: translationKey("The link works until {{time}}."),
  expired: translationKey(
    "The link we emailed to {{email}} has expired, so your email address has not changed. Send a new link to finish the change, or cancel it.",
  ),
  sendAgain: translationKey("Send Link Again"),
  /*
   * The same whether or not another account has the address: the server
   * emails it again either way (a link to a free one, word that a taken one
   * has an account), after it has answered.
   */
  sentAgain: translationKey("We emailed the new address again."),
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

/*
 * The longest wait a browser timer keeps (setTimeout's 32-bit limit): a
 * link that ends further off than this is not watched, which no link does.
 */
const LONGEST_TIMER_IN_MS: number = 2147483647;

export interface ComponentProps {
  email: string;
  pendingEmail: string | null;
  // When the waiting address's link stops working; null when not kept.
  pendingEmailLinkExpires?: Date | string | null | undefined;
  // The change was cancelled or asked for again: the card reads the account again.
  onChanged: () => void;
}

const PendingEmailChange: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [isSendingAgain, setIsSendingAgain] = useState<boolean>(false);
  // Drawn again when the link runs out while the page is open.
  const [, setRedrawnAt] = useState<number>(0);

  const linkExpires: Date | null = props.pendingEmailLinkExpires
    ? OneUptimeDate.fromString(props.pendingEmailLinkExpires)
    : null;
  const hasLinkExpired: boolean = Boolean(
    linkExpires && OneUptimeDate.hasExpired(linkExpires),
  );
  const linkExpiresAt: number | null = linkExpires
    ? linkExpires.getTime()
    : null;

  useEffect(() => {
    if (!props.pendingEmail || linkExpiresAt === null || hasLinkExpired) {
      return;
    }

    const wait: number = linkExpiresAt - Date.now() + 1000;

    if (wait <= 0 || wait > LONGEST_TIMER_IN_MS) {
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setRedrawnAt(Date.now());
    }, wait);

    return () => {
      clearTimeout(timer);
    };
  }, [props.pendingEmail, linkExpiresAt, hasLinkExpired]);

  /*
   * A master admin's own change is written at once, so for them asking
   * again would change the address there and then: they get Cancel Change
   * alone, and change the address in the form if they mean it.
   */
  const maySendAgain: boolean = !UserUtil.isMasterAdmin();

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
      props.onChanged();
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    }

    setIsCancelling(false);
  };

  /*
   * The change asked for again: the waiting address written as the new
   * email, which the server holds for a new link exactly as it held the
   * first - counted against the same hourly limits, refused the same way,
   * answered the same whoever has the address.
   */
  const sendAgain: () => Promise<void> = async (): Promise<void> => {
    if (!props.pendingEmail) {
      return;
    }

    setIsSendingAgain(true);

    try {
      await ModelAPI.updateById<User>({
        modelType: User,
        id: UserUtil.getUserId(),
        data: {
          email: props.pendingEmail,
        },
      });

      Toast.success(
        translator.translateText(PENDING_EMAIL_CHANGE_COPY.sentAgain) ||
          PENDING_EMAIL_CHANGE_COPY.sentAgain,
      );
      props.onChanged();
    } catch (err) {
      Toast.error(API.getFriendlyMessage(err));
    }

    setIsSendingAgain(false);
  };

  const waitingAddress: ReactElement = (
    <strong className="font-semibold">
      <IsolatedText text={props.pendingEmail || ""} />
    </strong>
  );

  const isBusy: boolean = isCancelling || isSendingAgain;

  return (
    <div data-testid="user-profile-email">
      <p>
        <IsolatedText text={props.email} />
      </p>
      {props.pendingEmail ? (
        <div
          className="mt-3 space-y-3"
          data-testid={
            hasLinkExpired
              ? "user-profile-pending-email-expired"
              : "user-profile-pending-email"
          }
        >
          {hasLinkExpired ? (
            <Alert
              type={AlertType.WARNING}
              icon={IconProp.Clock}
              title={
                <TranslatedSentence
                  template={PENDING_EMAIL_CHANGE_COPY.expired}
                  slots={{
                    email: waitingAddress,
                  }}
                />
              }
            />
          ) : (
            <Alert
              type={AlertType.INFO}
              icon={IconProp.Email}
              title={
                <span className="block space-y-1">
                  <span className="block">
                    <TranslatedSentence
                      template={PENDING_EMAIL_CHANGE_COPY.waiting}
                      slots={{
                        email: waitingAddress,
                      }}
                    />
                  </span>
                  {linkExpires ? (
                    <span
                      className="block"
                      data-testid="user-profile-pending-email-link-expires"
                    >
                      <TranslatedSentence
                        template={PENDING_EMAIL_CHANGE_COPY.linkWorksUntil}
                        slots={{
                          time: (
                            <IsolatedText
                              text={writeReaderMoment(linkExpires)}
                            />
                          ),
                        }}
                      />
                    </span>
                  ) : (
                    <></>
                  )}
                </span>
              }
            />
          )}
          <div className="flex flex-wrap gap-3">
            {maySendAgain ? (
              <Button
                title={PENDING_EMAIL_CHANGE_COPY.sendAgain}
                icon={IconProp.Email}
                buttonStyle={
                  hasLinkExpired
                    ? ButtonStyleType.PRIMARY
                    : ButtonStyleType.NORMAL
                }
                isLoading={isSendingAgain}
                disabled={isBusy}
                onClick={() => {
                  void sendAgain();
                }}
                dataTestId="user-profile-send-email-change-again"
              />
            ) : (
              <></>
            )}
            <Button
              title={PENDING_EMAIL_CHANGE_COPY.cancel}
              buttonStyle={ButtonStyleType.NORMAL}
              isLoading={isCancelling}
              disabled={isBusy}
              onClick={() => {
                void cancel();
              }}
              dataTestId="user-profile-cancel-email-change"
            />
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default PendingEmailChange;
