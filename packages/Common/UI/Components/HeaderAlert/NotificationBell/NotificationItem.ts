import IconProp from "../../../../Types/Icon/IconProp";
import { HeaderAlertType } from "../HeaderAlert";

/*
 * The parts of the bell's panel, in the order it draws them, each named by
 * its heading: what is on fire, the person's own on-call duty, and the rest.
 */
export enum NotificationBellSection {
  Critical = "Critical",
  OnCall = "On-Call",
  Information = "Information",
}

export const NOTIFICATION_BELL_SECTIONS: ReadonlyArray<NotificationBellSection> =
  [
    NotificationBellSection.Critical,
    NotificationBellSection.OnCall,
    NotificationBellSection.Information,
  ];

export interface NotificationItem {
  id: string;
  icon: IconProp;
  title: string;
  count: number;
  alertType: HeaderAlertType;
  tooltip?: string;
  onClick?: () => void;
  suffix?: string;
  // A short sentence under the title, saying why the item is there.
  description?: string | undefined;
  /*
   * Which part of the panel draws it. Left out, its alert type says:
   * Critical for an error, On-Call for a success, Information otherwise. An
   * item about the person's own on-call setup sits under On-Call, whatever
   * its colour (#7040).
   */
  section?: NotificationBellSection | undefined;
  /*
   * Puts it away, from a button of its own beside it: an item that asks the
   * person to do something is as easy to put off as to act on (#7040).
   * dismissTitle names that button, in the reader's words.
   */
  onDismiss?: (() => void) | undefined;
  dismissTitle?: string | undefined;
}

// The part of the panel that draws an item (NotificationItem.section).
export const getNotificationBellSection: (
  item: NotificationItem,
) => NotificationBellSection = (
  item: NotificationItem,
): NotificationBellSection => {
  if (item.section) {
    return item.section;
  }

  if (item.alertType === HeaderAlertType.ERROR) {
    return NotificationBellSection.Critical;
  }

  if (item.alertType === HeaderAlertType.SUCCESS) {
    return NotificationBellSection.OnCall;
  }

  return NotificationBellSection.Information;
};

/*
 * The bell's badge: how many items of its most urgent kind there are, in
 * that kind's colour - errors, then what asks the person to do something
 * (a warning), then their on-call duty, then the rest. Null with nothing to
 * count.
 */
export interface NotificationBellBadge {
  count: number;
  alertType: HeaderAlertType;
}

const BADGE_ORDER: ReadonlyArray<HeaderAlertType> = [
  HeaderAlertType.ERROR,
  HeaderAlertType.WARNING,
  HeaderAlertType.SUCCESS,
  HeaderAlertType.INFO,
];

export const getNotificationBellBadge: (
  items: Array<NotificationItem>,
) => NotificationBellBadge | null = (
  items: Array<NotificationItem>,
): NotificationBellBadge | null => {
  for (const alertType of BADGE_ORDER) {
    const count: number = items.filter((item: NotificationItem): boolean => {
      return item.count > 0 && item.alertType === alertType;
    }).length;

    if (count > 0) {
      return { count: count, alertType: alertType };
    }
  }

  return null;
};
