import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import { MouseOnClick, KeyboardEventProp } from '../../../Types/HtmlEvents';
import ShortcutKey from '../ShortcutKey/ShortcutKey';
import ButtonType from './ButtonTypes';

export interface ComponentProps {
    title: string;
    onClick?: MouseOnClick;
    disabled?: boolean;
    id?: string;
    shortcutKey?: ShortcutKey;
    type?: ButtonType;
    isLoading?: boolean;
}

const Button: FunctionComponent<ComponentProps> = ({
    title,
    onClick,
    disabled,
    id,
    shortcutKey,
    type = ButtonType.Button,
    isLoading = false,
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

    return (
        <button id={id} onClick={onClick} type={type} disabled={disabled}>
            {!isLoading && (
                <div>
                    <div>
                        <div></div>
                    </div>
                    <span>
                        <span>{title}</span>
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
