import React, { ReactElement } from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import { NotificationItem } from "./NotificationItem";
import NotificationBellDropdown from "./NotificationBellDropdown";
import { HeaderAlertType } from "../HeaderAlert";

export interface ComponentProps {
  items: Array<NotificationItem>;
  onItemClick: (item: NotificationItem) => void;
}

const NotificationBell: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const itemsWithCount: Array<NotificationItem> = props.items.filter(
    (item: NotificationItem) => {
      return item.count > 0;
    },
  );

  // Count of critical items (ERROR type with count > 0)
  const criticalItemsCount: number = itemsWithCount.filter(
    (item: NotificationItem) => {
      return item.alertType === HeaderAlertType.ERROR;
    },
  ).length;

  const hasErrorItems: boolean = criticalItemsCount > 0;

  const badgeColor: string = hasErrorItems ? "bg-red-500" : "bg-gray-500";

  return (
    <div className="relative ml-4 flex-shrink-0" ref={ref}>
      <button
        type="button"
        className="flex items-center justify-center h-9 w-9 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150"
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        aria-expanded={isComponentVisible}
        aria-haspopup="true"
      >
        <span className="sr-only">View notifications</span>
        <Icon className="h-5 w-5 text-gray-500" icon={IconProp.Bell} />
      </button>

      {criticalItemsCount > 0 && (
        <span
          className={`absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full ${badgeColor} text-xs font-semibold text-white ring-2 ring-white`}
        >
          {criticalItemsCount > 99 ? "99+" : criticalItemsCount}
        </span>
      )}

      {isComponentVisible && (
        <NotificationBellDropdown
          items={props.items}
          onItemClick={(item: NotificationItem) => {
            setIsComponentVisible(false);
            props.onItemClick(item);
          }}
        />
      )}
    </div>
  );
};

export default NotificationBell;
