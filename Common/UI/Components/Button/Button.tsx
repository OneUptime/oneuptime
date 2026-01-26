import { KeyboardEventProp } from "../../Types/HtmlEvents";
import Icon, { SizeProp } from "../Icon/Icon";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import ButtonType from "./ButtonTypes";
import IconProp from "../../../Types/Icon/IconProp";
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
  dataTestId?: string;
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
  useEffect(() => {
    // componentDidMount
    if (shortcutKey) {
      window.addEventListener(`keydown`, (e: KeyboardEventProp) => {
        return handleKeyboard(e);
      });
    }

    // componentDidUnmount
    return () => {
      if (shortcutKey) {
        window.removeEventListener(`keydown`, (e: KeyboardEventProp) => {
          return handleKeyboard(e);
        });
      }
    };
  });

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

  let buttonStyleCssClass: string = `inline-flex w-full justify-center rounded-md border border-gray-300 bg-white text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm`;
  let loadingIconClassName: string = `w-5 h-5 mr-3 -ml-1 mr-1 animate-spin`;
  let iconClassName: string = `w-5 h-5`;

  if (
    buttonStyle !== ButtonStyleType.ICON &&
    buttonStyle !== ButtonStyleType.ICON_LIGHT
  ) {
    iconClassName += ` mr-1`;
  } else {
    iconClassName += ` m-1`;
  }

  if (buttonStyle === ButtonStyleType.LINK) {
    buttonStyleCssClass = `text-indigo-600 hover:text-indigo-900  space-x-2`;

    if (icon) {
      buttonStyleCssClass += ` flex`;
    }
  }

  if (buttonStyle === ButtonStyleType.SECONDARY_LINK) {
    buttonStyleCssClass = `text-sm text-gray-400 hover:text-gray-500 space-x-2`;

    if (icon) {
      buttonStyleCssClass += ` flex`;
    }
  }

  if (buttonStyle === ButtonStyleType.DANGER) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-transparent bg-red-600 text-base font-medium text-white shadow-sm ${
      disabled ? "hover:bg-red-700" : ""
    } focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.DANGER_OUTLINE) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-red-700 bg-white text-base font-medium text-red-700 shadow-sm ${
      disabled ? "hover:bg-red-50" : ""
    } focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.PRIMARY) {
    loadingIconClassName += ` text-indigo-100`;
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-transparent bg-indigo-600 text-base font-medium text-white shadow-sm ${
      disabled ? "hover:bg-indigo-700" : ""
    } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 md:ml-3 md:w-auto md:text-sm`;

    if (disabled) {
      buttonStyleCssClass += ` bg-indigo-300`;
    }
  }

  if (buttonStyle === ButtonStyleType.SECONDARY) {
    loadingIconClassName += ` text-indigo-500`;
    buttonStyleCssClass = `inline-flex items-center rounded-md border border-transparent bg-indigo-100 text-sm font-medium text-indigo-700 ${
      disabled ? "hover:bg-indigo-200" : ""
    } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`;

    if (disabled) {
      buttonStyleCssClass += ` bg-indigo-300`;
    }
  }

  if (buttonStyle === ButtonStyleType.ICON_LIGHT) {
    buttonStyleCssClass = `rounded-md bg-white text-gray-400 ${
      disabled ? "hover:text-gray-500" : ""
    }  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`;
  }

  if (buttonStyle === ButtonStyleType.ICON) {
    buttonStyleCssClass = `rounded-md bg-white text-gray-600 ${
      disabled ? "hover:text-gray-900" : ""
    }  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`;
  }

  if (
    buttonStyle === ButtonStyleType.OUTLINE ||
    buttonStyle === ButtonStyleType.HOVER_DANGER_OUTLINE ||
    buttonStyle === ButtonStyleType.HOVER_SUCCESS_OUTLINE ||
    buttonStyle === ButtonStyleType.HOVER_PRIMARY_OUTLINE
  ) {
    buttonStyleCssClass = `flex btn-outline-secondary background-very-light-Gray500-on-hover md:text-sm ml-1`;

    if (buttonStyle === ButtonStyleType.HOVER_DANGER_OUTLINE) {
      buttonStyleCssClass += ` hover:text-red-500`;
    }

    if (buttonStyle === ButtonStyleType.HOVER_SUCCESS_OUTLINE) {
      buttonStyleCssClass += ` hover:text-green-500`;
    }

    if (buttonStyle === ButtonStyleType.HOVER_PRIMARY_OUTLINE) {
      buttonStyleCssClass += ` hover:text-indigo-500`;
    }
  }

  if (buttonStyle === ButtonStyleType.SUCCESS) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-transparent bg-green-600 text-base font-medium text-white shadow-sm ${
      disabled ? "hover:bg-green-700" : ""
    }  focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.SUCCESS_OUTLINE) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-green-700 bg-white text-base font-medium text-green-700 shadow-sm ${
      disabled ? "hover:bg-green-50" : ""
    }  focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.WARNING) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-transparent bg-yellow-600 text-base font-medium text-white shadow-sm  ${
      disabled ? "hover:bg-yellow-700" : ""
    }  focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 md:ml-3 md:w-auto md:text-sm`;
  }

  if (buttonStyle === ButtonStyleType.WARNING_OUTLINE) {
    buttonStyleCssClass = `inline-flex w-full justify-center rounded-md border border-yellow-700 bg-white text-base font-medium text-yellow-700 shadow-sm ${
      disabled ? "hover:bg-yellow-50" : ""
    }   focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 md:mt-0 md:ml-3 md:w-auto md:text-sm`;
  }

  buttonStyleCssClass += ` ` + buttonSize;

  if (className) {
    buttonStyleCssClass += ` ` + className;
  }

  // For icon-only buttons, use title as aria-label for accessibility
  const computedAriaLabel: string | undefined =
    ariaLabel ||
    (buttonStyle === ButtonStyleType.ICON ||
    buttonStyle === ButtonStyleType.ICON_LIGHT
      ? title || tooltip
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
        disabled={disabled || isLoading}
        className={buttonStyleCssClass}
        aria-label={computedAriaLabel}
        aria-disabled={disabled || isLoading}
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

        {title && buttonStyle !== ButtonStyleType.ICON ? title : ``}

        {shortcutKey && (
          <div className="ml-2">
            <kbd className="inline-flex items-center rounded border border-gray-200 px-2 font-sans text-sm font-medium text-gray-400">
              {shortcutKey}
            </kbd>
          </div>
        )}
      </button>
    );
  };

  if (tooltip) {
    return <Tooltip text={tooltip}>{getButton()}</Tooltip>;
  }
  return getButton();
};

export default Button;
