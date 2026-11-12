import useComponentOutsideClick from "../../Types/UseComponentOutsideClick";
import Icon from "../Icon/Icon";
import Image from "../Image/Image";
import KeyboardShortcut, {
  KeyboardShortcutSize,
  KeyboardShortcutVariant,
} from "../KeyboardShortcut/KeyboardShortcut";
import {
  KeyboardKeyUtil,
  KeyboardShortcutKey,
} from "../KeyboardShortcut/KeyboardKey";
import { HeaderMenuButtonIdContext } from "./HeaderMenuContext";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  icon?: IconProp;
  iconImageUrl?: string;
  badge?: undefined | number;
  children?: undefined | ReactElement | Array<ReactElement>;
  title?: string | undefined;
  onClick?: (() => void) | undefined;
  name: string;
  showDropdown: boolean;
  isPressed?: boolean | undefined;
  /** Tints the icon, e.g. to mark an AI entry point. */
  iconClassName?: string | undefined;
  /**
   * Shortcut that triggers this button, shown as keycaps beside the label in
   * the notation of the user's platform (⌘ I on a Mac, Ctrl I elsewhere).
   */
  shortcut?: Array<KeyboardShortcutKey> | undefined;
}

const HeaderIconDropdownButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

  useEffect(() => {
    setDropdownVisible(isComponentVisible);
  }, [isComponentVisible]);

  useEffect(() => {
    setDropdownVisible(Boolean(props.showDropdown));
    setIsComponentVisible(Boolean(props.showDropdown));
  }, [props.showDropdown]);

  const hasLabel: boolean = Boolean(props.title);
  const hasDropdown: boolean = Boolean(props.children);
  const hasShortcut: boolean = Boolean(props.shortcut?.length);

  /*
   * An id of this button's own, which its menu is named by (see
   * HeaderMenuContext): Help and the profile button sit side by side.
   */
  const buttonId: string = `header-menu-button-${useId()}`;
  const buttonRef: RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  /*
   * Escape puts an open menu away, as it does every other menu and dialog
   * in the product, and hands the focus back to the button when it was in
   * the menu or on the button, so a keyboard goes on from where it was.
   */
  useEffect(() => {
    if (!hasDropdown || !isComponentVisible) {
      return;
    }

    const closeOnEscape: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      const active: Element | null = document.activeElement;
      const wasFocusHere: boolean = Boolean(
        active &&
          (buttonRef.current?.contains(active) ||
            (ref.current as HTMLElement | null)?.contains(active)),
      );

      setIsComponentVisible(false);

      if (wasFocusHere) {
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [hasDropdown, isComponentVisible]);

  /*
   * The keycaps are hidden below the sm breakpoint, so the tighter right
   * padding they need comes in at the same breakpoint they do.
   */
  const sizeClassName: string = hasLabel
    ? `h-9 gap-1.5 pl-2.5 ${hasShortcut ? "pr-3 sm:pr-1.5" : "pr-3"}`
    : "h-9 w-9 justify-center";

  /*
   * Native tooltip: the label alone on screen, the shortcut spelled out in
   * words on hover ("Ask AI · Command + I") for anyone who missed the keycaps.
   */
  const tooltip: string = hasShortcut
    ? `${props.title || props.name} · ${KeyboardKeyUtil.getShortcutLabel(
        props.shortcut!,
      )}`
    : props.title || props.name;

  return (
    <div className="relative ml-2 flex-shrink-0">
      <div>
        <button
          ref={buttonRef}
          type="button"
          title={tooltip}
          className={`flex items-center rounded-lg border hover:bg-white hover:border-gray-300 hover:shadow-sm active:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-all duration-150 ${
            props.isPressed
              ? "border-indigo-200 bg-indigo-50"
              : "border-gray-200 bg-gray-50"
          } ${sizeClassName}`}
          id={hasDropdown ? buttonId : undefined}
          aria-expanded={hasDropdown ? isDropdownVisible : undefined}
          aria-haspopup={hasDropdown ? "true" : undefined}
          aria-pressed={props.isPressed}
          aria-keyshortcuts={
            hasShortcut
              ? KeyboardKeyUtil.getAriaKeyShortcuts(props.shortcut!)
              : undefined
          }
          onClick={() => {
            props.onClick?.();
            setIsComponentVisible(!isDropdownVisible);
          }}
        >
          {!hasLabel && <span className="sr-only">{props.name}</span>}
          {props.iconImageUrl && (
            <Image
              className="h-7 w-7 rounded-md object-cover"
              onClick={() => {
                props.onClick?.();
              }}
              imageUrl={props.iconImageUrl}
              alt={props.name}
            />
          )}
          {props.icon && (
            <Icon
              className={`${hasLabel ? "h-4 w-4" : "h-5 w-5"} ${
                props.iconClassName || "text-gray-500"
              }`}
              icon={props.icon}
            />
          )}
          {hasLabel && (
            <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
              {props.title}
            </span>
          )}
          {hasShortcut && (
            /*
             * Ghost caps, not outlined ones: the button turns white on hover,
             * and a filled cap keeps its edge against both backgrounds.
             */
            <KeyboardShortcut
              keys={props.shortcut!}
              size={KeyboardShortcutSize.ExtraSmall}
              variant={KeyboardShortcutVariant.Ghost}
              className="ml-0.5 max-sm:hidden sm:inline-flex"
            />
          )}
        </button>
        {props.badge && props.badge > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white ring-2 ring-white">
            {props.badge}
          </span>
        )}
      </div>

      <div ref={ref}>
        <HeaderMenuButtonIdContext.Provider value={buttonId}>
          {isComponentVisible && props.children}
        </HeaderMenuButtonIdContext.Provider>
      </div>
    </div>
  );
};

export default HeaderIconDropdownButton;
