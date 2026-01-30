import React, { ReactElement } from "react";
import { NotificationItem } from "./NotificationItem";
import NotificationBellItem from "./NotificationBellItem";
import NotificationBellSection from "./NotificationBellSection";
import { HeaderAlertType } from "../HeaderAlert";

export interface ComponentProps {
  items: Array<NotificationItem>;
  onItemClick: (item: NotificationItem) => void;
}

const NotificationBellDropdown: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const errorItems: Array<NotificationItem> = props.items.filter(
    (item: NotificationItem) => {
      return item.alertType === HeaderAlertType.ERROR && item.count > 0;
    },
  );

  const infoItems: Array<NotificationItem> = props.items.filter(
    (item: NotificationItem) => {
      return item.alertType === HeaderAlertType.INFO && item.count > 0;
    },
  );

  const successItems: Array<NotificationItem> = props.items.filter(
    (item: NotificationItem) => {
      return item.alertType === HeaderAlertType.SUCCESS && item.count > 0;
    },
  );

  const hasItems: boolean =
    errorItems.length > 0 || infoItems.length > 0 || successItems.length > 0;

  return (
    <div className="absolute right-0 z-10 mt-2 w-80 rounded-xl bg-white shadow-lg ring-1 ring-gray-200 max-h-96 overflow-y-auto">
      <div className="py-2">
        <div className="px-4 py-2 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-900">
            Notifications
          </span>
        </div>

        {!hasItems && (
          <div className="px-4 py-6 text-center text-sm text-gray-500">
            No notifications
          </div>
        )}

        {errorItems.length > 0 && (
          <NotificationBellSection title="Critical" alertType={HeaderAlertType.ERROR}>
            {errorItems.map((item: NotificationItem) => {
              return (
                <NotificationBellItem
                  key={item.id}
                  item={item}
                  onClick={() => {
                    props.onItemClick(item);
                  }}
                />
              );
            })}
          </NotificationBellSection>
        )}

        {infoItems.length > 0 && (
          <NotificationBellSection title="Information" alertType={HeaderAlertType.INFO}>
            {infoItems.map((item: NotificationItem) => {
              return (
                <NotificationBellItem
                  key={item.id}
                  item={item}
                  onClick={() => {
                    props.onItemClick(item);
                  }}
                />
              );
            })}
          </NotificationBellSection>
        )}

        {successItems.length > 0 && (
          <NotificationBellSection title="On-Call" alertType={HeaderAlertType.SUCCESS}>
            {successItems.map((item: NotificationItem) => {
              return (
                <NotificationBellItem
                  key={item.id}
                  item={item}
                  onClick={() => {
                    props.onItemClick(item);
                  }}
                />
              );
            })}
          </NotificationBellSection>
        )}
      </div>
    </div>
  );
};

export default NotificationBellDropdown;
