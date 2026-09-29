import Icon, { ThickProp } from "../../Icon/Icon";
import React, { ReactElement } from "react";
import { NotificationItem } from "./NotificationItem";
import { HeaderAlertType } from "../HeaderAlert";

export interface ComponentProps {
  item: NotificationItem;
  onClick?: () => void;
}

const NotificationBellItem: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { item } = props;

  let textColor: string = "text-indigo-600";
  let bgColor: string = "bg-indigo-50";
  let hoverBgColor: string = "hover:bg-indigo-100";
  let borderColor: string = "border-indigo-200";

  switch (item.alertType) {
    case HeaderAlertType.SUCCESS:
      textColor = "text-emerald-600";
      bgColor = "bg-emerald-50";
      hoverBgColor = "hover:bg-emerald-100";
      borderColor = "border-emerald-200";
      break;
    case HeaderAlertType.ERROR:
      textColor = "text-red-600";
      bgColor = "bg-red-50";
      hoverBgColor = "hover:bg-red-100";
      borderColor = "border-red-200";
      break;
    case HeaderAlertType.WARNING:
      textColor = "text-amber-600";
      bgColor = "bg-amber-50";
      hoverBgColor = "hover:bg-amber-100";
      borderColor = "border-amber-200";
      break;
    case HeaderAlertType.INFO:
      textColor = "text-gray-600";
      bgColor = "bg-gray-50";
      hoverBgColor = "hover:bg-gray-100";
      borderColor = "border-gray-200";
      break;
  }

  return (
    <div
      className={`cursor-pointer ${bgColor} ${hoverBgColor} border ${borderColor} py-2 px-3 rounded-lg transition-all duration-150`}
      onClick={() => {
        if (props.onClick) {
          props.onClick();
        } else if (item.onClick) {
          item.onClick();
        }
      }}
      title={item.tooltip}
    >
      <div className="flex items-center gap-2">
        <div className={`flex-shrink-0 ${textColor}`}>
          <Icon
            icon={item.icon}
            thick={ThickProp.Thick}
            className={`h-4 w-4 stroke-[2.5px] ${textColor}`}
          />
        </div>
        <div className="flex-1">
          <span className={`text-sm font-medium ${textColor}`}>
            {item.title}
          </span>
        </div>
      </div>
    </div>
  );
};

export default NotificationBellItem;
