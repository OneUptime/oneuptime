import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import IconText from "Common/UI/Components/IconText/IconText";
import Button, {
  ButtonStyleType,
  ButtonSize,
} from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  status?: StatusPageSubscriberNotificationStatus | undefined | null;
  subscriberNotificationStatusMessage?: string | undefined | null;
  className?: string;
  onResendNotification?: (() => void) | undefined;
}

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
 *
 * @param status - The notification status to display
 * @param subscriberNotificationStatusMessage - The detailed status message
 * @param className - Additional CSS classes to apply
 * @param onResendNotification - Callback function to handle resend notification action
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
    className = "",
    onResendNotification,
  } = props;

  const [showModal, setShowModal] = useState<boolean>(false);

  const statusInfo: {
    color: string;
    tailwindColor: string;
    text: string;
    icon: IconProp;
  } = getNotificationStatusInfo(status);

  const showResendButton: boolean =
    status === StatusPageSubscriberNotificationStatus.Failed &&
    Boolean(onResendNotification);

  const showMoreButton: boolean = Boolean(
    subscriberNotificationStatusMessage &&
      (status === StatusPageSubscriberNotificationStatus.Failed ||
        status === StatusPageSubscriberNotificationStatus.Skipped),
  );

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

  const handleModalConfirm: () => void = (): void => {
    if (showResendButton && onResendNotification) {
      onResendNotification();
    }
    setShowModal(false);
  };

  const handleModalClose: () => void = (): void => {
    setShowModal(false);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <IconText
        text={statusInfo.text}
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
            onClick={() => {
              return setShowModal(true);
            }}
          />
        </div>
      )}

      {showModal && (
        <ConfirmModal
          title="Notification Status Details"
          description={
            subscriberNotificationStatusMessage ||
            "No additional information available."
          }
          onClose={showResendButton ? handleModalClose : undefined}
          onSubmit={handleModalConfirm}
          submitButtonText={showResendButton ? "Retry" : "Close"}
          closeButtonText={showResendButton ? "Close" : undefined}
          submitButtonType={
            showResendButton ? ButtonStyleType.PRIMARY : ButtonStyleType.NORMAL
          }
        />
      )}
    </div>
  );
};

export default SubscriberNotificationStatus;
