import Icon, { ThickProp } from "../../Icon/Icon";
import Button, { ButtonStyleType } from "../../Button/Button";
import IconProp from "../../../../Types/Icon/IconProp";
import React, { ReactElement } from "react";
import { NotificationItem } from "./NotificationItem";
import { HeaderAlertType } from "../HeaderAlert";

export interface ComponentProps {
  item: NotificationItem;
  onClick?: () => void;
}

interface ItemColors {
  textColor: string;
  // The sentence under the title: a shade darker, for small print.
  descriptionColor: string;
  bgColor: string;
  hoverBgColor: string;
  borderColor: string;
}

export const getNotificationBellItemColors: (
  alertType: HeaderAlertType,
) => ItemColors = (alertType: HeaderAlertType): ItemColors => {
  switch (alertType) {
    case HeaderAlertType.SUCCESS:
      return {
        textColor: "text-emerald-600",
        descriptionColor: "text-emerald-700",
        bgColor: "bg-emerald-50",
        hoverBgColor: "hover:bg-emerald-100",
        borderColor: "border-emerald-200",
      };
    case HeaderAlertType.ERROR:
      return {
        textColor: "text-red-600",
        descriptionColor: "text-red-700",
        bgColor: "bg-red-50",
        hoverBgColor: "hover:bg-red-100",
        borderColor: "border-red-200",
      };
    case HeaderAlertType.WARNING:
      return {
        textColor: "text-amber-700",
        descriptionColor: "text-amber-800",
        bgColor: "bg-amber-50",
        hoverBgColor: "hover:bg-amber-100",
        borderColor: "border-amber-200",
      };
    case HeaderAlertType.INFO:
      return {
        textColor: "text-gray-600",
        descriptionColor: "text-gray-600",
        bgColor: "bg-gray-50",
        hoverBgColor: "hover:bg-gray-100",
        borderColor: "border-gray-200",
      };
    default:
      return {
        textColor: "text-indigo-600",
        descriptionColor: "text-indigo-700",
        bgColor: "bg-indigo-50",
        hoverBgColor: "hover:bg-indigo-100",
        borderColor: "border-indigo-200",
      };
  }
};

const NotificationBellItem: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { item } = props;
  const colors: ItemColors = getNotificationBellItemColors(item.alertType);

  const open: () => void = (): void => {
    if (props.onClick) {
      props.onClick();
    } else if (item.onClick) {
      item.onClick();
    }
  };

  const content: ReactElement = (
    <>
      <span
        className={`flex-shrink-0 ${colors.textColor} ${item.description ? "mt-0.5" : ""}`}
        aria-hidden="true"
      >
        <Icon
          icon={item.icon}
          thick={ThickProp.Thick}
          className={`h-4 w-4 stroke-[2.5px] ${colors.textColor}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${colors.textColor}`}>
          {item.title}
        </span>
        {item.description ? (
          <span
            className={`mt-0.5 block text-xs ${colors.descriptionColor}`}
            data-testid={`notification-bell-item-${item.id}-description`}
          >
            {item.description}
          </span>
        ) : (
          <></>
        )}
      </span>
    </>
  );

  /*
   * An item that can be put away (onDismiss) is one box with two buttons
   * side by side - open it, and put it away - never one inside the other.
   */
  if (item.onDismiss) {
    const onDismiss: () => void = item.onDismiss;

    return (
      <div
        className={`flex w-full items-start rounded-lg border ${colors.bgColor} ${colors.borderColor}`}
        data-testid={`notification-bell-item-${item.id}-box`}
      >
        <button
          type="button"
          data-testid={`notification-bell-item-${item.id}`}
          className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg py-2 ps-3 pe-1 text-start cursor-pointer ${colors.hoverBgColor} transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 [@media(pointer:coarse)]:min-h-11`}
          onClick={open}
          title={item.tooltip}
        >
          {content}
        </button>
        <Button
          buttonStyle={ButtonStyleType.ICON}
          icon={IconProp.Close}
          title={item.dismissTitle || "Dismiss"}
          isTitleTranslated={Boolean(item.dismissTitle)}
          tooltip={item.dismissTitle}
          className="flex-shrink-0 p-1 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
          dataTestId={`notification-bell-item-${item.id}-dismiss`}
          onClick={onDismiss}
        />
      </div>
    );
  }

  /*
   * A real button: it was a div with only a click, so a keyboard could open
   * the bell but not choose anything in it (#9136). Tab reaches each item,
   * Enter and Space open it, and it shows the focus ring every control does.
   */
  return (
    <button
      type="button"
      data-testid={`notification-bell-item-${item.id}`}
      className={`flex w-full ${item.description ? "items-start" : "items-center"} gap-2 text-start cursor-pointer ${colors.bgColor} ${colors.hoverBgColor} border ${colors.borderColor} py-2 px-3 rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 [@media(pointer:coarse)]:min-h-11`}
      onClick={open}
      title={item.tooltip}
    >
      {content}
    </button>
  );
};

export default NotificationBellItem;
