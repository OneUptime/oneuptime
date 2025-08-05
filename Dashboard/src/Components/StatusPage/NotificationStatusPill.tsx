import { Blue, Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status?: StatusPageSubscriberNotificationStatus | undefined | null;
  isMinimal?: boolean;
  showFailureReason?: boolean;
  failureReason?: string | undefined | null;
  style?: "pill" | "badge";
  className?: string;
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
 * NotificationStatusPill Component
 * 
 * A reusable component for displaying notification status with consistent styling.
 * Supports two display styles: "pill" (using Pill component) and "badge" (using Tailwind CSS).
 * 
 * @param status - The notification status to display
 * @param isMinimal - Whether to use minimal styling (default: true)
 * @param showFailureReason - Whether to show failure reason below the status (default: false)
 * @param failureReason - The failure reason text to display
 * @param style - Display style: "pill" or "badge" (default: "pill")
 * @param className - Additional CSS classes to apply
 * 
 * Usage Examples:
 * 
 * // Basic pill style
 * <NotificationStatusPill status={item.subscriberNotificationStatus} />
 * 
 * // Badge style with failure reason
 * <NotificationStatusPill
 *   status={item.subscriberNotificationStatus}
 *   style="badge"
 *   showFailureReason={true}
 *   failureReason={item.subscriberNotificationFailedReason}
 * />
 */
const NotificationStatusPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { 
    status, 
    isMinimal = true, 
    showFailureReason = false, 
    failureReason,
    style = "pill",
    className = ""
  } = props;

  const statusInfo = getNotificationStatusInfo(status);

  if (style === "badge") {
    return (
      <div className={className}>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-${statusInfo.tailwindColor}-100 text-${statusInfo.tailwindColor}-800`}
        >
          {statusInfo.text}
        </span>
        {showFailureReason && failureReason && (
          <div className="text-xs text-red-600 mt-1">
            {failureReason}
          </div>
        )}
      </div>
    );
  }

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
      <Pill color={pillColor} text={statusInfo.text} isMinimal={isMinimal} />
      {showFailureReason && failureReason && (
        <div className="text-xs text-red-600 mt-1">
          {failureReason}
        </div>
      )}
    </div>
  );
};

export default NotificationStatusPill;
