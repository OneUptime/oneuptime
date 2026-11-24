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
  SpokenKeyNames,
} from "../KeyboardShortcut/KeyboardKey";
import useSpokenKeyNames from "../KeyboardShortcut/SpokenKeyNames";
import { HeaderMenuButtonIdContext } from "./HeaderMenuContext";
import {
  getHeaderMenuChoiceStep,
  getHeaderMenuItemIndexAfterKey,
  getHeaderMenuItems,
  HEADER_MENU_ITEM_SELECTOR,
  isHeaderMenuRightToLeft,
} from "./HeaderMenuKeyboard";
import IconProp from "../../../Types/Icon/IconProp";
import PlatformUtil from "../../Utils/Platform";
import React, {
  FunctionComponent,
  MutableRefObject,
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
  const spokenKeyNames: SpokenKeyNames = useSpokenKeyNames();

  /*
   * An id of this button's own, which its menu is named by (see
   * HeaderMenuContext): Help and the profile button sit side by side.
   */
  const buttonId: string = `header-menu-button-${useId()}`;
  // The menu's own id, which IconDropdownMenu draws it with (aria-controls).
  const menuId: string = `${buttonId}-menu`;
  const buttonRef: RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  /*
   * Which row takes the focus as the menu opens: the first, or the last
   * when Up opened it (WAI-ARIA's menu button pattern).
   */
  const focusOnOpenRef: MutableRefObject<"first" | "last"> = useRef<
    "first" | "last"
  >("first");

  // The open menu: the box the button draws its children in.
  const getMenu: () => HTMLElement | null = (): HTMLElement | null => {
    return ref.current as HTMLElement | null;
  };

  /*
   * As the menu opens, the focus moves to its first row (its last, opened
   * with Up), so the arrow keys go on from there: it used to stay on the
   * button, and Down did nothing (#7237).
   */
  useEffect(() => {
    if (!hasDropdown || !isComponentVisible) {
      return;
    }

    const items: Array<HTMLElement> = getHeaderMenuItems(getMenu());
    const target: HTMLElement | undefined =
      focusOnOpenRef.current === "last" ? items[items.length - 1] : items[0];

    focusOnOpenRef.current = "first";
    target?.focus();
  }, [hasDropdown, isComponentVisible]);

  // Opens the menu as a click on its button does, its owner told too.
  const openMenu: (focusOn: "first" | "last") => void = (
    focusOn: "first" | "last",
  ): void => {
    focusOnOpenRef.current = focusOn;
    props.onClick?.();
    setIsComponentVisible(true);
  };

  /*
   * Down opens the menu on its first row, Up on its last; on an open menu
   * they move the focus into it. Enter and Space press the button, which
   * opens the menu on its first row.
   */
  const handleButtonKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => void = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (
      !hasDropdown ||
      (event.key !== "ArrowDown" && event.key !== "ArrowUp")
    ) {
      return;
    }

    event.preventDefault();

    const focusOn: "first" | "last" =
      event.key === "ArrowUp" ? "last" : "first";

    if (!isComponentVisible) {
      openMenu(focusOn);
      return;
    }

    const items: Array<HTMLElement> = getHeaderMenuItems(getMenu());

    (focusOn === "last" ? items[items.length - 1] : items[0])?.focus();
  };

  // The row of the menu an event happened in, if any.
  const getItemOf: (target: EventTarget | null) => HTMLElement | null = (
    target: EventTarget | null,
  ): HTMLElement | null => {
    if (!(target instanceof Element)) {
      return null;
    }

    const item: Element | null = target.closest(HEADER_MENU_ITEM_SELECTOR);
    const menu: HTMLElement | null = getMenu();

    return item instanceof HTMLElement && menu && menu.contains(item)
      ? item
      : null;
  };

  /*
   * Enter and Space press the row the focus is on, as one click: a link's
   * row too, which Space alone would not open, and an action drawn as a
   * link, whose own key handler would act without a click. The click is
   * what the rest hears (handleMenuClickCapture).
   */
  const handleMenuKeyDownCapture: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const item: HTMLElement | null = getItemOf(event.target);

    if (!item) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    item.click();
  };

  /*
   * Up and Down move between the rows, round from the last to the first,
   * Home and End to the first and the last, and Left and Right along a row
   * of choices (the theme's), the way the page reads. Tab closes the menu
   * and goes on from its button, as from any other control.
   */
  const handleMenuKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!isComponentVisible) {
      return;
    }

    if (event.key === "Tab") {
      buttonRef.current?.focus();
      setIsComponentVisible(false);
      return;
    }

    const items: Array<HTMLElement> = getHeaderMenuItems(getMenu());
    const current: HTMLElement | null = getItemOf(document.activeElement);
    const from: number = current ? items.indexOf(current) : -1;

    const next: number | undefined = getHeaderMenuItemIndexAfterKey({
      key: event.key,
      from: from,
      count: items.length,
    });

    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
      return;
    }

    if (!current || current.getAttribute("role") !== "menuitemradio") {
      return;
    }

    const step: number = getHeaderMenuChoiceStep({
      key: event.key,
      isRightToLeft: isHeaderMenuRightToLeft(current),
    });
    const choices: Array<HTMLElement> = current.parentElement
      ? getHeaderMenuItems(current.parentElement).filter(
          (choice: HTMLElement): boolean => {
            return choice.getAttribute("role") === "menuitemradio";
          },
        )
      : [];
    const at: number = choices.indexOf(current);

    if (step === 0 || at < 0) {
      return;
    }

    event.preventDefault();
    choices[(at + step + choices.length) % choices.length]?.focus();
  };

  /*
   * A row that does something hands the focus back to the button before
   * its own handler runs: the menu then closes with the focus on its
   * button, as WAI-ARIA's pattern asks, and a dialog the row opens (How
   * OneUptime works, Give feedback) gives the focus back there when it
   * closes - drawn after the row was gone, it remembered nothing. A choice
   * (the theme's) keeps the menu open and its focus where it is.
   */
  const handleMenuClickCapture: (
    event: React.MouseEvent<HTMLDivElement>,
  ) => void = (event: React.MouseEvent<HTMLDivElement>): void => {
    const item: HTMLElement | null = getItemOf(event.target);

    if (item && item.getAttribute("role") === "menuitem") {
      buttonRef.current?.focus();
    }
  };

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
   * words on hover ("Ask AI · Command + I") for anyone who missed the
   * keycaps - in the reader's words, as the keycaps' screen-reader label is
   * ("Поиск · Ctrl + K", never "Поиск · Control + K": #7484).
   */
  const tooltip: string = hasShortcut
    ? `${props.title || props.name} · ${KeyboardKeyUtil.getShortcutLabel(
        props.shortcut!,
        PlatformUtil.isApplePlatform(),
        spokenKeyNames,
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
          aria-haspopup={hasDropdown ? "menu" : undefined}
          aria-controls={hasDropdown && isComponentVisible ? menuId : undefined}
          aria-pressed={props.isPressed}
          aria-keyshortcuts={
            hasShortcut
              ? KeyboardKeyUtil.getAriaKeyShortcuts(props.shortcut!)
              : undefined
          }
          onClick={() => {
            focusOnOpenRef.current = "first";
            props.onClick?.();
            setIsComponentVisible(!isDropdownVisible);
          }}
          onKeyDown={handleButtonKeyDown}
        >
          {!hasLabel && <span className="sr-only">{props.name}</span>}
          {/*
           * The picture is the button's look; its words name it (the span
           * above, or its title). Its alt was the name again, so the profile
           * button - and the menu it names - read "User Profile User
           * Profile" to a screen reader.
           */}
          {props.iconImageUrl && (
            <Image
              className="h-7 w-7 rounded-md object-cover"
              imageUrl={props.iconImageUrl}
              alt=""
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

      <div
        ref={ref}
        onKeyDownCapture={handleMenuKeyDownCapture}
        onKeyDown={handleMenuKeyDown}
        onClickCapture={handleMenuClickCapture}
      >
        <HeaderMenuButtonIdContext.Provider value={buttonId}>
          {isComponentVisible && props.children}
        </HeaderMenuButtonIdContext.Provider>
      </div>
    </div>
  );
};

export default HeaderIconDropdownButton;
