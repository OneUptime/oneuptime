import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import { KeyboardEventProp } from '../../Types/HtmlEvents';
import ShortcutKey from '../ShortcutKey/ShortcutKey';
import ButtonType from './ButtonTypes';
import CSS from 'csstype';
import Icon, { IconProp, SizeProp, ThickProp } from '../Icon/Icon';
import Loader, { LoaderType } from '../Loader/Loader';
import { White } from 'Common/Types/BrandColors';

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
}

export enum ButtonSize {
    Normal = 'btn',
    Small = 'btn-sm',
    Large = 'btn-lg',
}

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

    let buttonStyleCssClass: string = 'no-border-on-hover';

    if (buttonStyle === ButtonStyleType.DANGER) {
        buttonStyleCssClass = 'btn-danger';
    }

    if (buttonStyle === ButtonStyleType.DANGER_OUTLINE) {
        buttonStyleCssClass = 'btn-outline-danger';
    }

    if (buttonStyle === ButtonStyleType.PRIMARY) {
        buttonStyleCssClass = 'btn-primary';
    }

    if (buttonStyle === ButtonStyleType.SECONDRY) {
        buttonStyleCssClass = 'btn-secondary';
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
            disabled={disabled}
            className={`btn ${buttonStyleCssClass} ${buttonSize} waves-effect waves-light ${
                !title && buttonStyle === ButtonStyleType.NORMAL
                    ? 'no-border-on-hover'
                    : ''
            }`}
        >
            {!isLoading && (
                <div>
                    <div>
                        <div></div>
                    </div>
                    <span className="justify-center">
                        <span>
                            {icon && !showIconOnRight && (
                                <Icon
                                    icon={icon}
                                    size={
                                        iconSize ? iconSize : SizeProp.Regular
                                    }
                                    thick={
                                        buttonSize === ButtonSize.Small
                                            ? ThickProp.LessThick
                                            : ThickProp.Thick
                                    }
                                />
                            )}
                        </span>
                        {title ? (
                            <div
                                style={{
                                    marginLeft:
                                        icon && !showIconOnRight
                                            ? '4px'
                                            : '0px',
                                    marginTop: '1px',
                                }}
                            >
                                <b>{title}</b>
                            </div>
                        ) : (
                            <></>
                        )}
                        <span
                            style={{
                                marginLeft: '5px',
                            }}
                        >
                            {icon && showIconOnRight && (
                                <Icon
                                    icon={icon}
                                    size={
                                        iconSize ? iconSize : SizeProp.Regular
                                    }
                                    thick={ThickProp.Thick}
                                />
                            )}
                        </span>
                        {shortcutKey && (
                            <span className="newButtonKeycode">
                                {shortcutKey}
                            </span>
                        )}
                    </span>
                </div>
            )}
            {isLoading && (
                <div>
                    <Loader
                        loaderType={LoaderType.Beats}
                        color={White}
                        size={10}
                    />
                </div>
            )}
        </button>
    );
};

export default Button;
