import { Blue, Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Pill from "Common/UI/Components/Pill/Pill";
import Button, { ButtonStyleType, ButtonSize } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status?: StatusPageSubscriberNotificationStatus | undefined | null;
  subscriberNotificationStatusMessage?: string | undefined | null;
  className?: string;
  onResendNotification?: (() => void) | undefined;
}

/**
 * Utility function to get status info for notification status
 * @param status - The notification status
 * @returns Object with color, tailwindColor, and text for the status
 */
export const getNotificationStatusInfo = (
  status?: StatusPageSubscriberNotificationStatus | undefined | null,
): {
  color: string;
  tailwindColor: string;
  text: string;
} => {
  if (!status || status === StatusPageSubscriberNotificationStatus.Skipped) {
    return { color: "gray", tailwindColor: "gray", text: "Skipped" };
  }

  if (status === StatusPageSubscriberNotificationStatus.Pending) {
    return { color: "yellow", tailwindColor: "yellow", text: "Pending" };
  }

  if (status === StatusPageSubscriberNotificationStatus.InProgress) {
    return { color: "blue", tailwindColor: "blue", text: "In Progress" };
  }

  if (status === StatusPageSubscriberNotificationStatus.Success) {
    return { color: "green", tailwindColor: "green", text: "Sent" };
  }

  if (status === StatusPageSubscriberNotificationStatus.Failed) {
    return { color: "red", tailwindColor: "red", text: "Failed" };
  }

  return { color: "gray", tailwindColor: "gray", text: "Unknown" };
};

/**
 * SubscriberNotificationStatus Component
 * 
 * A reusable component for displaying notification status with consistent styling.
 * Supports two display styles: "pill" (using Pill component) and "badge" (using Tailwind CSS).
 * 
 * @param status - The notification status to display
 * @param isMinimal - Whether to use minimal styling (default: true)
 * @param showFailureReason - Whether to show failure reason below the status (default: false)
 * @param subscriberNotificationStatusMessage - The failure reason text to display
 * @param style - Display style: "pill" or "badge" (default: "pill")
 * @param className - Additional CSS classes to apply
 * @param onResendNotification - Callback function to handle resend notification action
 * 
 * Usage Examples:
 * 
 * // Basic pill style
 * <SubscriberNotificationStatus status={item.subscriberNotificationStatus} />
 * 
 * // Badge style with failure reason and resend callback
 * <SubscriberNotificationStatus
 *   status={item.subscriberNotificationStatus}
 *   
 *   
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
    onResendNotification
  } = props;

  const statusInfo = getNotificationStatusInfo(status);
  const showResendButton = status === StatusPageSubscriberNotificationStatus.Failed && onResendNotification;

  // Default pill style
  const colorMap = {
    gray: Gray500,
    yellow: Yellow,
    blue: Blue,
    green: Green,
    red: Red,
  };

  const pillColor = colorMap[statusInfo.color as keyof typeof colorMap] || Gray500;

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <Pill color={pillColor} text={statusInfo.text} isMinimal={true} />
        {showResendButton && (
          <Button
            title="Resend Notification to Subscribers"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={onResendNotification}
          />
        )}
      </div>
      {subscriberNotificationStatusMessage && (
        <div className="text-xs text-red-600 mt-1">
          {subscriberNotificationStatusMessage}
        </div>
      )}
    </div>
  );
};

export default SubscriberNotificationStatus;
