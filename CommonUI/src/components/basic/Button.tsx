import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { MouseOnClick, KeyboardEventProp } from '../../types/htmlEvents';

export enum ShortcutKey {
    Enter = "Enter",
    Esc = "Esc",
    New = "N",
    Settings = "S"
}

export interface ComponentProps {
    title: string;
    onClick: MouseOnClick;
    disabled?: boolean;
    id: string;
    shortcutKey?: ShortcutKey;
}

export default class Button extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    constructor(props: ComponentProps) {
        super(props);
    }

    override componentDidMount() {

        if (this.props.shortcutKey) {
            window.addEventListener('keydown', (e) => this.handleKeyboard(e as KeyboardEventProp));
        }
    }

    override componentWillUnmount() {

        if (this.props.shortcutKey) {
            window.removeEventListener('keydown', (e) => this.handleKeyboard(e as KeyboardEventProp));
        }
    }

    handleKeyboard(event: KeyboardEventProp) {

        const { shortcutKey, onClick } = this.props;

        if (event.target instanceof HTMLBodyElement && event.key && shortcutKey) {
            switch (event.key) {
                case shortcutKey.toUpperCase():
                case shortcutKey.toLowerCase():
                    onClick && onClick();
                    return;
                default:
                    return;
            }
        }
    }

    override render() {

        const { title, shortcutKey, id, onClick, disabled } = this.props;

        return (<button
            id={id}
            onClick={onClick}
            className={`${'Button bs-ButtonLegacy ActionIconParent'} ${disabled ? 'Is--disabled' : ''
                }`}
            type="button"
            disabled={disabled}
        >
            <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                <div className="Box-root Margin-right--8">
                    <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                </div>
                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                    <span>{title}</span>
                    {shortcutKey && (
                        <span className="new-btn__keycode">
                            {shortcutKey}
                        </span>
                    )}
                </span>
            </div>
        </button>);
    }
}


Button.propTypes = {
    title: PropTypes.string.isRequired,
    onClick: PropTypes.func,
    disabled: PropTypes.bool,
    id: PropTypes.string,
    shortcutKey: PropTypes.string,
};
