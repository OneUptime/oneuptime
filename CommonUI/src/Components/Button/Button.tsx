import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import { KeyboardEventProp } from '../../Types/HtmlEvents';
import ShortcutKey from '../ShortcutKey/ShortcutKey';
import ButtonType from './ButtonTypes';
import CSS from 'csstype';
import Icon, { IconProp, SizeProp } from '../Icon/Icon';

export enum ButtonStyleType {
    PRIMARY,
    SECONDRY,
    OUTLINE,
    NORMAL,
    DANGER,
    DANGER_OUTLINE,
    SUCCESS,
    SUCCESS_OUTLINE,
    WARNING,
    WARNING_OUTLINE,
    LINK,
    ICON
}

export enum ButtonSize {
    Normal = 'btn',
    Small = 'btn-sm',
    Large = 'btn-lg',
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
    style?: undefined | CSS.Properties;
    icon?: undefined | IconProp;
    showIconOnRight?: undefined | boolean;
    iconSize?: undefined | SizeProp;
    buttonStyle?: undefined | ButtonStyleType;
    buttonSize?: ButtonSize | undefined;
    dataTestId?: string;
    textStyle?: React.CSSProperties | undefined;
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
    showIconOnRight = false,
    buttonStyle = ButtonStyleType.NORMAL,
    buttonSize = ButtonSize.Normal,
    dataTestId,
    textStyle,
}: ComponentProps): ReactElement => {
    useEffect(() => {
        // componentDidMount
        if (shortcutKey) {
            window.addEventListener('keydown', (e: KeyboardEventProp) => {
                return handleKeyboard(e);
            });
        }

        // componentDidUnmount
        return () => {
            if (shortcutKey) {
                window.removeEventListener(
                    'keydown',
                    (e: KeyboardEventProp) => {
                        return handleKeyboard(e);
                    }
                );
            }
        };
    });

    const handleKeyboard: Function = (event: KeyboardEventProp): void => {
        if (
            event.target instanceof HTMLBodyElement &&
            event.key &&
            shortcutKey
        ) {
            switch (event.key) {
                case shortcutKey.toUpperCase():
                case shortcutKey.toLowerCase():
                    onClick && onClick();
                    return;
                default:
                    return;
            }
        }
    };

    let buttonStyleCssClass: string = 'inline-flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm';
    let loadingIconClassName: string = "w-5 h-5 mr-3 -ml-1 mr-1 animate-spin";
    let iconClassName: string = "w-5 h-5 -ml-1 mr-1";

    if (buttonStyle === ButtonStyleType.LINK) {
        buttonStyleCssClass = 'no-border-on-hover font-500';
    }

    if (buttonStyle === ButtonStyleType.DANGER) {
        buttonStyleCssClass = 'inline-flex w-full justify-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm';
    }

    if (buttonStyle === ButtonStyleType.DANGER_OUTLINE) {
        buttonStyleCssClass = 'btn-outline-danger';
    }

    if (buttonStyle === ButtonStyleType.PRIMARY) {
        loadingIconClassName+= " text-slate-100"
        buttonStyleCssClass = 'inline-flex w-full justify-center rounded-md border border-transparent bg-slate-600 px-4 py-2 text-base font-medium text-white shadow-sm hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 sm:ml-3 sm:w-auto sm:text-sm';

        if (disabled) {
            buttonStyleCssClass+=" bg-slate-300"
        }
    }

    if (buttonStyle === ButtonStyleType.SECONDRY) {
        loadingIconClassName+= " text-slate-500"
        buttonStyleCssClass = 'inline-flex items-center rounded-md border border-transparent bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2';

        if (disabled) {
            buttonStyleCssClass+=" bg-slate-300"
        }
    }

    if (buttonStyle === ButtonStyleType.ICON) {
        buttonStyleCssClass = "rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
    }

    if (buttonStyle === ButtonStyleType.OUTLINE) {
        buttonStyleCssClass =
            'btn-outline-secondary background-very-light-grey-on-hover';
    }

    if (buttonStyle === ButtonStyleType.SUCCESS) {
        buttonStyleCssClass = 'btn-success';
    }

    if (buttonStyle === ButtonStyleType.SUCCESS_OUTLINE) {
        buttonStyleCssClass = 'btn-outline-success';
    }

    if (buttonStyle === ButtonStyleType.WARNING) {
        buttonStyleCssClass = 'btn-warning';
    }

    if (buttonStyle === ButtonStyleType.WARNING_OUTLINE) {
        buttonStyleCssClass = 'btn-outline-warning';
    }

   

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
        >

            {isLoading && <Icon icon={IconProp.Spinner} className={loadingIconClassName} />}

            {!isLoading && icon && <Icon icon={icon} className={iconClassName} />}

            {title && buttonStyle !== ButtonStyleType.ICON ? title :''}

            {buttonStyle === ButtonStyleType.ICON && !isLoading && <>
                <span className="sr-only">{title}</span>
                <Icon icon={icon!} size={iconSize!} />
            </>}

           
        </button>
    );
};

export default Button;
