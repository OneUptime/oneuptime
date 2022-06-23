import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import { KeyboardEventProp } from '../../Types/HtmlEvents';
import ShortcutKey from '../ShortcutKey/ShortcutKey';
import ButtonType from './ButtonTypes';
import CSS from 'csstype';
import Icon, { IconProp, SizeProp, ThickProp } from '../Icon/Icon';

export enum ButtonStyleType {
    PRIMARY,
    SECONDRY,
    NORMAL,
    DANGER,
}

export interface ComponentProps {
    title?: string;
    onClick?: () => void;
    disabled?: boolean;
    id?: string;
    shortcutKey?: ShortcutKey;
    type?: ButtonType;
    isLoading?: boolean;
    style?: CSS.Properties;
    icon?: IconProp;
    showIconOnRight?: boolean;
    iconSize?: SizeProp;
    buttonStyle?: ButtonStyleType;
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

    if (buttonStyle === ButtonStyleType.PRIMARY) {
        buttonStyleCssClass = 'btn-primary';
    }

    if (buttonStyle === ButtonStyleType.SECONDRY) {
        buttonStyleCssClass = 'btn-secondary';
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
            type={type}
            disabled={disabled}
            className={`btn ${buttonStyleCssClass} waves-effect waves-light ${
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
                    <span>
                        <span>
                            {icon && !showIconOnRight && (
                                <Icon
                                    icon={icon}
                                    size={
                                        iconSize ? iconSize : SizeProp.Regular
                                    }
                                    thick={ThickProp.Thick}
                                />
                            )}
                            {title ? ' ' : ''}
                        </span>
                        {title ? (
                            <span>
                                <b>{title}</b>
                            </span>
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
            {isLoading && <div>Implement Loader here</div>}
        </button>
    );
};

export default Button;
