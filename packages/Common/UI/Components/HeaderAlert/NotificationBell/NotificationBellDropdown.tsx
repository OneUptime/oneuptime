import React, { ReactElement } from "react";
import {
  NOTIFICATION_BELL_SECTIONS,
  NotificationBellSection as NotificationBellSectionName,
  NotificationItem,
  getNotificationBellSection,
} from "./NotificationItem";
import NotificationBellItem from "./NotificationBellItem";
import NotificationBellSection from "./NotificationBellSection";
import { HeaderAlertType } from "../HeaderAlert";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

export interface ComponentProps {
  items: Array<NotificationItem>;
  onItemClick: (item: NotificationItem) => void;
  // Drawn first, under the panel's title (NotificationBell's notice).
  notice?: ReactElement | undefined;
}

// The colour each section's heading is drawn in.
const SECTION_ALERT_TYPES: Record<
  NotificationBellSectionName,
  HeaderAlertType
> = {
  [NotificationBellSectionName.Critical]: HeaderAlertType.ERROR,
  [NotificationBellSectionName.OnCall]: HeaderAlertType.SUCCESS,
  [NotificationBellSectionName.Information]: HeaderAlertType.INFO,
};

const NotificationBellDropdown: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Each section's items with something to show, in the order given.
  const sections: Array<{
    section: NotificationBellSectionName;
    items: Array<NotificationItem>;
  }> = NOTIFICATION_BELL_SECTIONS.map(
    (
      section: NotificationBellSectionName,
    ): {
      section: NotificationBellSectionName;
      items: Array<NotificationItem>;
    } => {
      return {
        section: section,
        items: props.items.filter((item: NotificationItem): boolean => {
          return item.count > 0 && getNotificationBellSection(item) === section;
        }),
      };
    },
  ).filter(
    (group: {
      section: NotificationBellSectionName;
      items: Array<NotificationItem>;
    }): boolean => {
      return group.items.length > 0;
    },
  );

  const hasItems: boolean = sections.length > 0;

  return (
    /*
     * w-64 below sm: the panel hangs off the bell, which sits a couple of
     * button widths in from the right edge, so a fixed 20rem runs past the
     * left edge of a phone screen.
     */
    <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl bg-white shadow-lg ring-1 ring-gray-200 max-h-96 overflow-y-auto sm:w-80">
      <div className="py-2">
        <div className="px-4 py-2 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-900">
            {translator.translateText("Notifications")}
          </span>
        </div>

        {props.notice ? (
          <div
            className="border-b border-gray-100"
            data-testid="notification-bell-notice"
          >
            {props.notice}
          </div>
        ) : (
          <></>
        )}

        {!hasItems && !props.notice && (
          <div className="px-4 py-6 text-center text-sm text-gray-500">
            {translator.translateText("No notifications")}
          </div>
        )}

        {sections.map(
          (group: {
            section: NotificationBellSectionName;
            items: Array<NotificationItem>;
          }): ReactElement => {
            return (
              <NotificationBellSection
                key={group.section}
                title={group.section}
                alertType={SECTION_ALERT_TYPES[group.section]}
              >
                {group.items.map((item: NotificationItem) => {
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
            );
          },
        )}
      </div>
    </div>
  );
};

export default NotificationBellDropdown;
