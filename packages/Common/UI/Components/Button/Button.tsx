import { KeyboardEventProp } from "../../Types/HtmlEvents";
import Icon, { SizeProp } from "../Icon/Icon";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import ButtonType from "./ButtonTypes";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Tooltip from "../Tooltip/Tooltip";
import { GetReactElementFunction } from "../../Types/FunctionTypes";

export enum ButtonStyleType {
  PRIMARY,
  SECONDARY,
  OUTLINE,
  NORMAL,
  DANGER,
  DANGER_OUTLINE,
  SUCCESS,
  SUCCESS_OUTLINE,
  WARNING,
  WARNING_OUTLINE,
  ICON_LIGHT,
  LINK,
  SECONDARY_LINK,
  ICON,
  HOVER_DANGER_OUTLINE,
  HOVER_SUCCESS_OUTLINE,
  HOVER_PRIMARY_OUTLINE,
}

export enum ButtonSize {
  Normal = "px-3 py-2",
  Small = "px-2 py-1",
  Large = "px-4 py-2",
  ExtraSmall = "px-0 py-0",
}

/*
 * How a button that cannot be pressed looks - a locked action, a Next with
 * nothing chosen yet - whatever its style: faded as a whole, with the
 * not-allowed cursor, and no hover (the style leaves its hover classes off).
 * Before, a disabled plain or outline button looked exactly like one that
 * works until it was hovered, so a locked action looked pressable ("Turn
 * monitoring on", a viewer's Triage again, a Reset the reader may not make),
 * and the three styles that had a disabled look swapped their fill for a
 * paler one - indigo-300, red-300 - which in the dark theme was a bright
 * block brighter than the button it stood for, and on SECONDARY darker than
 * its own light fill. A loading button is busy, not locked: it keeps its
 * look and shows its spinner.
 */
export const BUTTON_DISABLED_CLASS_NAME: string =
  "cursor-not-allowed opacity-50";

// The cursor of a locked button's tooltip wrapper, which takes the pointer.
export const BUTTON_DISABLED_CURSOR_CLASS_NAME: string = "cursor-not-allowed";

/*
 * OUTLINE: the plain bordered button. NORMAL's border, fill, text, shadow,
 * hover and focus ring, sized to its label at every width - NORMAL is as
 * wide as a phone's screen and keeps a dialog footer's margin (md:ml-3),
 * which a button in a row of controls, a card or a notice does not want.
 * It used to be two class names no stylesheet defines (a Bootstrap
 * secondary outline button's, and a pale hover wash's) on a block-level
 * flex box: some 200 buttons across the product - a network
 * device's Ping and Traceroute among them - had no border, no hover and no
 * focus ring, and read as stray words. The HOVER_* outline styles are the
 * same button whose hover tints it with what it does.
 */
export const OUTLINE_BUTTON_CLASS_NAME: string =
  "inline-flex justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:text-sm";

export type OutlineButtonStyleType =
  | ButtonStyleType.OUTLINE
  | ButtonStyleType.HOVER_DANGER_OUTLINE
  | ButtonStyleType.HOVER_SUCCESS_OUTLINE
  | ButtonStyleType.HOVER_PRIMARY_OUTLINE;

export const isOutlineButtonStyle: (
  style: ButtonStyleType,
) => style is OutlineButtonStyleType = (
  style: ButtonStyleType,
): style is OutlineButtonStyleType => {
  return (
    style === ButtonStyleType.OUTLINE ||
    style === ButtonStyleType.HOVER_DANGER_OUTLINE ||
    style === ButtonStyleType.HOVER_SUCCESS_OUTLINE ||
    style === ButtonStyleType.HOVER_PRIMARY_OUTLINE
  );
};

export const OUTLINE_BUTTON_HOVER_CLASS_NAMES: Record<
  OutlineButtonStyleType,
  string
> = {
  [ButtonStyleType.OUTLINE]: "hover:bg-gray-50",
  [ButtonStyleType.HOVER_DANGER_OUTLINE]: "hover:bg-red-50 hover:text-red-700",
  [ButtonStyleType.HOVER_SUCCESS_OUTLINE]:
    "hover:bg-green-50 hover:text-green-700",
  [ButtonStyleType.HOVER_PRIMARY_OUTLINE]:
    "hover:bg-indigo-50 hover:text-indigo-700",
};

/*
 * An outline button with an icon and no words - a phone's menu toggle, a
 * row's trash can - is a square around its icon: the padding of the size's
 * height on every side. With a label's sideways padding it was a wide box
 * whose icon sat off its middle.
 */
export const ICON_ONLY_OUTLINE_BUTTON_SIZE_CLASS_NAMES: Record<
  ButtonSize,
  string
> = {
  [ButtonSize.Normal]: "p-2",
  [ButtonSize.Small]: "p-1",
  [ButtonSize.Large]: "p-2",
  [ButtonSize.ExtraSmall]: "p-0",
};
/* Defining the props that the component will take. */

export interface ComponentProps {
  title?: undefined | string;
  onClick?: undefined | (() => void);
  disabled?: undefined | boolean;
  id?: undefined | string;
  shortcutKey?: undefined | ShortcutKey;
  type?: undefined | ButtonType;
  isLoading?: undefined | boolean;
  style?: undefined | React.CSSProperties;
  icon?: undefined | IconProp;
  iconSize?: undefined | SizeProp;
  buttonStyle?: undefined | ButtonStyleType;
  buttonSize?: ButtonSize | undefined;
  dataTestId?: string | undefined;
  className?: string | undefined;
  tooltip?: string | undefined;
  ariaLabel?: string | undefined;
  ariaExpanded?: boolean | undefined;
  ariaHaspopup?:
    | "menu"
    | "listbox"
    | "dialog"
    | "tree"
    | "grid"
    | "true"
    | "false"
    | undefined;
  ariaControls?: string | undefined;
}

const Button: FunctionComponent<ComponentProps> = ({
  title,
  onClick,
  disabled,
  id,
  shortcutKey,
  type = ButtonType.Button,
  isLoading = false,
  style,
  icon,
  iconSize,
  buttonStyle = ButtonStyleType.NORMAL,
  buttonSize = ButtonSize.Normal,
  dataTestId,
  className,
  tooltip,
  ariaLabel,
  ariaExpanded,
  ariaHaspopup,
  ariaControls,
}: ComponentProps): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string | undefined = translateString(title);
  const translatedTooltip: string | undefined = translateString(tooltip);
  useEffect(() => {
    if (!shortcutKey) {
      return undefined;
    }

    /*
     * One stable function for the whole subscription. The previous version
     * passed a fresh arrow function to removeEventListener, which never
     * matches the one that was added — every render leaked a live keydown
     * listener for the lifetime of the page.
     */
    const onKeyDown: (event: KeyboardEventProp) => void = (
      event: KeyboardEventProp,
    ): void => {
      return handleKeyboard(event);
    };

    window.addEventListener(`keydown`, onKeyDown);

    return () => {
      window.removeEventListener(`keydown`, onKeyDown);
    };
  }, [shortcutKey, onClick]);

  type HandleKeyboardFunction = (event: KeyboardEventProp) => void;

  const handleKeyboard: HandleKeyboardFunction = (
    event: KeyboardEventProp,
  ): void => {
    if (event.target instanceof HTMLBodyElement && event.key && shortcutKey) {
      switch (event.key) {
        case shortcutKey.toUpperCase():
        case shortcutKey.toLowerCase():
          if (onClick) {
            onClick();
          }
          return;
        default:
          return;
      }
    }
  };

  /*
   * Locked - it cannot be pressed - or busy, which cannot be pressed while
   * it works: neither answers the pointer with a hover. Only a locked one
   * fades (BUTTON_DISABLED_CLASS_NAME). A busy one keeps its look beside
   * its spinner, also when its caller locks it for as long as it works
   * (disabled={isSaving} with isLoading={isSaving}): faded, a Test or a
   * Save that had just been pressed looked as if it had been turned off.
   */
  const isInert: boolean = Boolean(disabled || isLoading);
  const isLocked: boolean = Boolean(disabled) && !isLoading;

  /*
   * The focus ring is for keyboard focus only (focus-visible). Drawn on every
   * :focus it also ringed whatever a script focused: a dialog opened with a
   * click put its initial focus on Cancel, and the ring made Cancel the most
   * prominent button on the dialog - a plain button wearing the highlight the
   * action should have. The browser still draws it for anyone moving through
   * the page with the keyboard, which is who it is for.
   */
  let buttonStyleCssClass: string = `inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm ${
    isInert ? "" : "hover:bg-gray-50"
  } focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm`;

  // Words after the icon: the title, which an ICON button never draws.
  const hasWords: boolean =
    Boolean(translatedTitle) && buttonStyle !== ButtonStyleType.ICON;

  /*
   * The gap between an icon (or a spinner) and the words is on the words'
   * side in either direction: margin-inline-end, not margin-right. In
   * Persian a button's icon sits to the right of its words, and a right
   * margin left it touching them, with the gap on the button's edge. A
   * button with no words has no gap to keep: its icon sits in its middle.
   */
  let loadingIconClassName: string = hasWords
    ? `w-5 h-5 -ms-1 me-3 animate-spin`
    : `w-5 h-5 animate-spin`;
  let iconClassName: string = `w-5 h-5`;

  if (
    buttonStyle !== ButtonStyleType.ICON &&
    buttonStyle !== ButtonStyleType.ICON_LIGHT
  ) {
    if (hasWords) {
      iconClassName += ` me-1`;
    }
  } else {
    iconClassName += ` m-1`;
  }

  /*
   * A link's icon - or its spinner while it is busy - sits on its words'
   * line: drawn as a block, the spinner pushed the words onto a line of
   * their own.
   */
  if (buttonStyle === ButtonStyleType.LINK) {
    buttonStyleCssClass = `text-indigo-600 ${
      isInert ? "" : "hover:text-indigo-900"
    } space-x-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`;

    if (icon || isLoading) {
      buttonStyleCssClass += ` flex`;
    }
  }

  if (buttonStyle === ButtonStyleType.SECONDARY_LINK) {
    buttonStyleCssClass = `text-sm text-gray-400 ${
      isInert ? "" : "hover:text-gray-500"
    } space-x-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`;

    if (icon || isLoading) {
      buttonStyleCssClass += ` flex`;
    }
  }

  /*
   * A Delete that cannot be pressed yet - its dialog is still checking what
   * it would change - looks it (BUTTON_DISABLED_CLASS_NAME).
   */
  if (buttonStyle === ButtonStyleType.DANGER) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-transparent bg-red-600 ${
      isInert ? "" : "hover:bg-red-700"
    } text-base font-medium text-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.DANGER_OUTLINE) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-red-700 bg-white text-base font-medium text-red-700 shadow-sm ${
      isInert ? "" : "hover:bg-red-50"
    } focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.PRIMARY) {
    loadingIconClassName += ` text-indigo-100`;
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-transparent bg-indigo-600 ${
      isInert ? "" : "hover:bg-indigo-700"
    } text-base font-medium text-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.SECONDARY) {
    loadingIconClassName += ` text-indigo-500`;
    buttonStyleCssClass = `inline-flex rounded-md border border-transparent bg-indigo-100 ${
      isInert ? "" : "hover:bg-indigo-200"
    } text-sm font-medium text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`;
  }

  if (buttonStyle === ButtonStyleType.ICON_LIGHT) {
    buttonStyleCssClass = `rounded-md bg-white text-gray-400 ${
      isInert ? "" : "hover:text-gray-500"
    }  focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`;
  }

  if (buttonStyle === ButtonStyleType.ICON) {
    buttonStyleCssClass = `rounded-md bg-transparent text-gray-600 ${
      isInert ? "" : "hover:text-gray-900"
    }  focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2`;
  }

  if (isOutlineButtonStyle(buttonStyle)) {
    buttonStyleCssClass = isInert
      ? OUTLINE_BUTTON_CLASS_NAME
      : `${OUTLINE_BUTTON_CLASS_NAME} ${OUTLINE_BUTTON_HOVER_CLASS_NAMES[buttonStyle]}`;
  }

  if (buttonStyle === ButtonStyleType.SUCCESS) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-transparent bg-green-600 text-base font-medium text-white shadow-sm ${
      isInert ? "" : "hover:bg-green-700"
    }  focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.SUCCESS_OUTLINE) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-green-700 bg-white text-base font-medium text-green-700 shadow-sm ${
      isInert ? "" : "hover:bg-green-50"
    }  focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.WARNING) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-transparent bg-yellow-600 text-base font-medium text-white shadow-sm  ${
      isInert ? "" : "hover:bg-yellow-700"
    }  focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.WARNING_OUTLINE) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-yellow-700 bg-white text-base font-medium text-yellow-700 shadow-sm ${
      isInert ? "" : "hover:bg-yellow-50"
    }   focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 focus-visible:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm`;
  }

  // Locked: faded as a whole, whatever the style. Busy is not locked.
  if (isLocked) {
    buttonStyleCssClass += ` ${BUTTON_DISABLED_CLASS_NAME}`;
  }

  // Center the icon against both desktop and taller mobile label lines.
  buttonStyleCssClass += ` items-center`;

  /*
   * The one shared point every variant funnels through: hover/focus colour
   * changes ease in instead of snapping, at the same 150ms the other
   * primitives use.
   */
  buttonStyleCssClass += ` transition-colors duration-150 ease-out`;

  // An outline button that is only its icon is a square round it.
  const isIconOnlyOutline: boolean =
    isOutlineButtonStyle(buttonStyle) &&
    !hasWords &&
    !shortcutKey &&
    Boolean(icon || isLoading);

  buttonStyleCssClass +=
    ` ` +
    (isIconOnlyOutline
      ? ICON_ONLY_OUTLINE_BUTTON_SIZE_CLASS_NAMES[buttonSize]
      : buttonSize);

  /*
   * A disabled <button> swallows the pointer without dispatching anything, so
   * the hover never reaches the wrapper that carries the tooltip. Taking the
   * button out of hit-testing hands the pointer to that wrapper instead. Only
   * applied when there is a tooltip to show, so nothing else changes.
   */
  if (isInert && translatedTooltip) {
    buttonStyleCssClass += ` pointer-events-none`;
  }

  if (className) {
    buttonStyleCssClass += ` ` + className;
  }

  /*
   * An icon button, or any button with no words (a phone's menu toggle, a
   * row's trash can), is named by its title or else its tooltip.
   */
  const computedAriaLabel: string | undefined =
    translateString(ariaLabel) ||
    (buttonStyle === ButtonStyleType.ICON ||
    buttonStyle === ButtonStyleType.ICON_LIGHT ||
    !hasWords
      ? translatedTitle || translatedTooltip
      : undefined);

  const getButton: GetReactElementFunction = (): ReactElement => {
    return (
      <button
        style={style}
        id={id}
        onClick={() => {
          if (onClick) {
            onClick();
          }
        }}
        data-testid={dataTestId}
        type={type}
        disabled={isInert}
        className={buttonStyleCssClass}
        aria-label={computedAriaLabel}
        aria-disabled={isInert}
        aria-expanded={ariaExpanded}
        aria-haspopup={ariaHaspopup}
        aria-controls={ariaControls}
      >
        {isLoading && buttonStyle !== ButtonStyleType.ICON && (
          <Icon icon={IconProp.Spinner} className={loadingIconClassName} />
        )}

        {!isLoading && icon && (
          <Icon
            icon={icon}
            className={iconClassName}
            size={iconSize || undefined}
          />
        )}

        {translatedTitle && buttonStyle !== ButtonStyleType.ICON
          ? translatedTitle
          : ``}

        {shortcutKey && (
          <div className="ms-2">
            <kbd className="inline-flex items-center rounded border border-gray-200 px-2 font-sans text-sm font-medium text-gray-400">
              {shortcutKey}
            </kbd>
          </div>
        )}
      </button>
    );
  };

  if (translatedTooltip) {
    /*
     * Tippy makes its child the trigger element, and a disabled control is
     * both unhoverable and unfocusable - tippy.js even bails out of show()
     * when the trigger has a `disabled` attribute. Explaining WHY a button is
     * disabled is exactly when the tooltip matters most, so wrap the disabled
     * button in an element that can still be hovered and tabbed to.
     */
    if (isInert) {
      return (
        <Tooltip text={translatedTooltip}>
          <span
            /*
             * The button takes no pointer here (see above), so the
             * not-allowed cursor of a locked one is this wrapper's.
             */
            className={
              isLocked
                ? `inline-flex ${BUTTON_DISABLED_CURSOR_CLASS_NAME}`
                : "inline-flex"
            }
            tabIndex={0}
            data-testid={
              dataTestId ? `${dataTestId}-disabled-wrapper` : undefined
            }
          >
            {getButton()}
          </span>
        </Tooltip>
      );
    }

    return <Tooltip text={translatedTooltip}>{getButton()}</Tooltip>;
  }
  return getButton();
};

export default Button;
