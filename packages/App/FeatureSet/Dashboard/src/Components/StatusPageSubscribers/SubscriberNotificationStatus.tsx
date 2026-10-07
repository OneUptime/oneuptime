import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationResend, {
  SubscriberNotificationResendAction,
} from "Common/Types/StatusPage/SubscriberNotificationResend";
import IconText from "Common/UI/Components/IconText/IconText";
import Button, {
  ButtonStyleType,
  ButtonSize,
} from "Common/UI/Components/Button/Button";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";
import SubscriberNotificationResendCopy from "./SubscriberNotificationResendCopy";

export interface ResendNotificationOptions {
  /*
   * Send it to every status page again rather than resume where a failed
   * send stopped: true for a Resend, and for a Retry whose confirmation's
   * "every status page" box was ticked. Only the incident-created
   * notification resumes at all, so other callers can ignore it.
   */
  isToAllStatusPages: boolean;
}

/*
 * What sending a notification again will do, and to whom, shown before it
 * is sent.
 */
export interface SubscriberNotificationResendConfirmation {
  // What Resend (after a success) does.
  resendDescription: string;
  // What Retry (after a failure) does.
  retryDescription: string;
  /*
   * Offers, with Retry, a box that sends it to every status page again
   * instead of resuming; the description replaces retryDescription while it
   * is ticked. For the incident-created notification, the one notification
   * that resumes.
   */
  retryToAllStatusPagesLabel?: string | undefined;
  retryToAllStatusPagesDescription?: string | undefined;
  // Who it would reach now: the incident's audience summary.
  audience?: ReactElement | undefined;
  /*
   * Who a Retry reaches, where that is not `audience`: the incident-created
   * notification's Retry resumes after the pages already sent it in full,
   * so its summary leaves them out. Shown for Retry unless its "every
   * status page" box is ticked; Resend, and Retry to every page, show
   * `audience`.
   */
  retryAudience?: ReactElement | undefined;
}

export interface ComponentProps {
  status?: StatusPageSubscriberNotificationStatus | undefined | null;
  subscriberNotificationStatusMessage?: string | undefined | null;
  /*
   * Replaces the generic label for the status, so a caller that knows why
   * notifications were skipped can say so in the badge itself rather than
   * behind "more details".
   */
  statusText?: string | undefined;
  /*
   * Draws the status as waiting - a clock - rather than skipped: a
   * notification held back until something happens, such as a postmortem
   * that is sent when its hidden incident is made visible. Its colour stays
   * the status's own.
   */
  isWaiting?: boolean | undefined;
  className?: string;
  onResendNotification?:
    | ((options: ResendNotificationOptions) => void)
    | undefined;
  /*
   * Offers Resend after a success as well as Retry after a failure, and asks
   * before either with this confirmation. Left out, only a failure offers
   * Retry, straight from the details dialog, as it always did: the
   * scheduled maintenance, announcement, state change and postmortem
   * statuses stay that way. A skipped notification never offers either
   * (see SubscriberNotificationResend).
   */
  resendConfirmation?: SubscriberNotificationResendConfirmation | undefined;
}

type ModalStep = "details" | "confirm";

/**
 * Utility function to get status info for notification status
 * @param status - The notification status
 * @returns Object with color, tailwindColor, text, and icon for the status
 */
export const getNotificationStatusInfo: (
  status?: StatusPageSubscriberNotificationStatus | undefined | null,
) => {
  color: string;
  tailwindColor: string;
  text: string;
  icon: IconProp;
} = (
  status?: StatusPageSubscriberNotificationStatus | undefined | null,
): {
  color: string;
  tailwindColor: string;
  text: string;
  icon: IconProp;
} => {
  if (!status || status === StatusPageSubscriberNotificationStatus.Skipped) {
    return {
      color: "gray",
      tailwindColor: "gray",
      text: "Notifications skipped.",
      icon: IconProp.CircleClose,
    };
  }

  if (status === StatusPageSubscriberNotificationStatus.Pending) {
    return {
      color: "yellow",
      tailwindColor: "yellow",
      text: "Sending Soon",
      icon: IconProp.Clock,
    };
  }

  if (status === StatusPageSubscriberNotificationStatus.InProgress) {
    return {
      color: "blue",
      tailwindColor: "blue",
      text: "Notifications Being Sent",
      icon: IconProp.Info,
    };
  }

  if (status === StatusPageSubscriberNotificationStatus.Success) {
    return {
      color: "green",
      tailwindColor: "green",
      text: "Notifications Sent",
      icon: IconProp.CheckCircle,
    };
  }

  if (status === StatusPageSubscriberNotificationStatus.Failed) {
    return {
      color: "red",
      tailwindColor: "red",
      text: "Failed",
      icon: IconProp.Error,
    };
  }

  return {
    color: "gray",
    tailwindColor: "gray",
    text: "Unknown",
    icon: IconProp.Info,
  };
};

/**
 * SubscriberNotificationStatus Component
 *
 * A reusable component for displaying notification status with consistent styling.
 * Uses IconText component for status display and provides a "more" button for detailed messages.
 * Shows ConfirmModal with message details and retry button for failed notifications.
 * With resendConfirmation, a notification that went out offers Resend too,
 * and either one asks first, saying what it will do and to whom.
 *
 * @param status - The notification status to display
 * @param subscriberNotificationStatusMessage - The detailed status message
 * @param className - Additional CSS classes to apply
 * @param onResendNotification - Callback function to handle resend notification action
 * @param resendConfirmation - Offer Resend after a success, and confirm before sending again
 *
 * Usage Examples:
 *
 * // Basic usage
 * <SubscriberNotificationStatus status={item.subscriberNotificationStatus} />
 *
 * // With message and resend callback
 * <SubscriberNotificationStatus
 *   status={item.subscriberNotificationStatus}
 *   subscriberNotificationStatusMessage={item.subscriberNotificationStatusMessage}
 *   onResendNotification={() => handleResend(item)}
 * />
 */
const SubscriberNotificationStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const {
    status,
    subscriberNotificationStatusMessage,
    statusText,
    isWaiting,
    className = "",
    onResendNotification,
    resendConfirmation,
  } = props;

  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalStep, setModalStep] = useState<ModalStep>("details");
  const [isToAllStatusPages, setIsToAllStatusPages] = useState<boolean>(false);

  const statusInfo: {
    color: string;
    tailwindColor: string;
    text: string;
    icon: IconProp;
  } = {
    ...getNotificationStatusInfo(status),
    ...(isWaiting ? { icon: IconProp.Clock } : {}),
  };

  // Retry after a failure; Resend after a success, where it is offered.
  const resendAction: SubscriberNotificationResendAction | null =
    onResendNotification
      ? SubscriberNotificationResend.getAction({
          status: status,
          isResendAfterSuccessOffered: Boolean(resendConfirmation),
        })
      : null;

  const showResendButton: boolean = resendAction !== null;

  /*
   * The details are one click away for a failure or a skip with a message
   * and, where Resend is offered, for every notification that can be sent
   * again - that dialog is where the button lives.
   */
  const showMoreButton: boolean =
    Boolean(
      subscriberNotificationStatusMessage &&
        (status === StatusPageSubscriberNotificationStatus.Failed ||
          status === StatusPageSubscriberNotificationStatus.Skipped),
    ) ||
    (Boolean(resendConfirmation) && showResendButton);

  // Color mapping for IconText
  const colorMap: Record<string, Color> = {
    gray: Gray500,
    yellow: Yellow500,
    blue: Blue500,
    green: Green500,
    red: Red500,
  };

  const iconColor: Color =
    colorMap[statusInfo.color as keyof typeof colorMap] || Gray500;

  const openModal: () => void = (): void => {
    setModalStep("details");
    setIsToAllStatusPages(false);
    setShowModal(true);
  };

  const handleModalClose: () => void = (): void => {
    setShowModal(false);
  };

  const sendAgain: () => void = (): void => {
    if (onResendNotification) {
      onResendNotification({
        isToAllStatusPages:
          resendAction === SubscriberNotificationResendAction.Resend ||
          isToAllStatusPages,
      });
    }

    setShowModal(false);
  };

  const handleModalConfirm: () => void = (): void => {
    if (!showResendButton) {
      setShowModal(false);
      return;
    }

    // Asked first, where the caller says what sending it again does.
    if (resendConfirmation) {
      setModalStep("confirm");
      return;
    }

    sendAgain();
  };

  const isResend: boolean =
    resendAction === SubscriberNotificationResendAction.Resend;

  const getConfirmation: (
    confirmation: SubscriberNotificationResendConfirmation,
  ) => ReactElement = (
    confirmation: SubscriberNotificationResendConfirmation,
  ): ReactElement => {
    const isToAllOffered: boolean = Boolean(
      !isResend && confirmation.retryToAllStatusPagesLabel,
    );

    let description: string = isResend
      ? confirmation.resendDescription
      : confirmation.retryDescription;

    if (
      isToAllOffered &&
      isToAllStatusPages &&
      confirmation.retryToAllStatusPagesDescription
    ) {
      description = confirmation.retryToAllStatusPagesDescription;
    }

    return (
      <div
        className="space-y-3"
        data-testid="subscriber-notification-resend-confirmation"
      >
        <p data-testid="subscriber-notification-resend-description">
          {tx(description)}
        </p>
        {isToAllOffered ? (
          <CheckboxElement
            title={tx(confirmation.retryToAllStatusPagesLabel || "")}
            value={isToAllStatusPages}
            dataTestId="subscriber-notification-resend-to-all-pages"
            onChange={(value: boolean) => {
              setIsToAllStatusPages(value);
            }}
          />
        ) : (
          <></>
        )}
        {(!isResend && !isToAllStatusPages && confirmation.retryAudience
          ? confirmation.retryAudience
          : confirmation.audience) || <></>}
      </div>
    );
  };

  const getConfirmSubmitText: () => string = (): string => {
    if (isResend) {
      return SubscriberNotificationResendCopy.resendButton;
    }

    return isToAllStatusPages
      ? SubscriberNotificationResendCopy.resendToAllStatusPagesButton
      : SubscriberNotificationResendCopy.retryButton;
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <IconText
        text={
          statusText
            ? translateString(statusText) || statusText
            : statusInfo.text
        }
        icon={statusInfo.icon}
        iconColor={iconColor}
        textColor={iconColor}
        iconClassName="h-4 w-4"
        textClassName="text-sm font-medium"
        spacing="sm"
        alignment="left"
      />

      {showMoreButton && (
        <div className="-ml-2 text-gray-500">
          <Button
            title="more details"
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            buttonSize={ButtonSize.Small}
            onClick={openModal}
          />
        </div>
      )}

      {showModal && modalStep === "details" && (
        <ConfirmModal
          title="Notification Status Details"
          description={
            subscriberNotificationStatusMessage ||
            "No additional information available."
          }
          onClose={showResendButton ? handleModalClose : undefined}
          onSubmit={handleModalConfirm}
          submitButtonText={
            showResendButton
              ? isResend
                ? SubscriberNotificationResendCopy.resendButton
                : SubscriberNotificationResendCopy.retryButton
              : "Close"
          }
          closeButtonText={showResendButton ? "Close" : undefined}
          submitButtonType={
            showResendButton ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
          }
        />
      )}

      {showModal && modalStep === "confirm" && resendConfirmation && (
        <ConfirmModal
          title={
            isResend
              ? SubscriberNotificationResendCopy.resendConfirmTitle
              : SubscriberNotificationResendCopy.retryConfirmTitle
          }
          description={getConfirmation(resendConfirmation)}
          onClose={handleModalClose}
          onSubmit={sendAgain}
          submitButtonText={getConfirmSubmitText()}
          closeButtonText={SubscriberNotificationResendCopy.cancelButton}
          submitButtonType={ButtonStyleType.PRIMARY}
        />
      )}
    </div>
  );
};

export default SubscriberNotificationStatus;
