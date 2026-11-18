import React, { ReactElement, useRef } from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import {
  NotificationBellBadge,
  NotificationItem,
  getNotificationBellBadge,
} from "./NotificationItem";
import NotificationBellDropdown from "./NotificationBellDropdown";
import { HeaderAlertType } from "../HeaderAlert";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

// The badge's colour for the kind of item it counts.
export const BADGE_COLOR_CLASS_NAMES: Record<HeaderAlertType, string> = {
  [HeaderAlertType.ERROR]: "bg-red-500",
  // 600, not 500: its white count reads on it.
  [HeaderAlertType.WARNING]: "bg-amber-600",
  [HeaderAlertType.SUCCESS]: "bg-emerald-500",
  [HeaderAlertType.INFO]: "bg-gray-500",
};

export interface ComponentProps {
  items: Array<NotificationItem>;
  onItemClick: (item: NotificationItem) => void;
  /*
   * A line of its own at the top of the panel, drawn as given: what the
   * bell could not check - who is on call - with Try again (#9120).
   */
  notice?: ReactElement | undefined;
}

const NotificationBell: (props: ComponentProps) => ReactElement = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const bellButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  /*
   * The badge counts the most urgent kind of item there is, in its colour:
   * critical, then what asks the person to do something, then their
   * on-call duty, then the rest (getNotificationBellBadge).
   */
  const badge: NotificationBellBadge | null = getNotificationBellBadge(
    props.items,
  );
  const badgeCount: number = badge ? badge.count : 0;
  const badgeColor: string = badge
    ? BADGE_COLOR_CLASS_NAMES[badge.alertType]
    : BADGE_COLOR_CLASS_NAMES[HeaderAlertType.INFO];

  /*
   * Escape closes the panel from anywhere in it and hands focus back to the
   * bell, so a keyboard that opened it is never left inside a closed panel.
   */
  const handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Escape" && isComponentVisible) {
      event.stopPropagation();
      setIsComponentVisible(false);
      bellButtonRef.current?.focus();
    }
  };

  return (
    <div
      className="relative ml-4 flex-shrink-0"
      ref={ref}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={bellButtonRef}
        type="button"
        className="flex items-center justify-center h-9 w-9 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150"
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        aria-expanded={isComponentVisible}
        aria-haspopup="true"
      >
        <span className="sr-only">
          {translator.translateText("View notifications")}
        </span>
        <Icon className="h-5 w-5 text-gray-500" icon={IconProp.Bell} />
      </button>

      {badgeCount > 0 && (
        <span
          className={`absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full ${badgeColor} text-xs font-semibold text-white ring-2 ring-white`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}

      {isComponentVisible && (
        <NotificationBellDropdown
          items={props.items}
          notice={props.notice}
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
