import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { MouseOnClick, KeyboardEventProp } from '../../Types/HtmlEvents';

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
            

        if (event.target instanceof HTMLBodyElement && event.key && this.props.shortcutKey) {
            switch (event.key) {
                case this.props.shortcutKey.toUpperCase():
                case this.props.shortcutKey.toLowerCase():
                    this.props.onClick && this.props.onClick();
                    return;
                default:
                    return;
            }
        }
    }

    override render() {


        return (<button
            id={this.props.id}
            onClick={this.props.onClick}
            className={`${'Button bs-ButtonLegacy ActionIconParent'} ${this.props.disabled ? 'Is--disabled' : ''
                }`}
            type="button"
            disabled={this.props.disabled}
        >
            <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                <div className="Box-root Margin-right--8">
                    <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                </div>
                <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                    <span>{this.props.title}</span>
                    {this.props.shortcutKey && (
                        <span className="new-btn__keycode">
                            {this.props.shortcutKey}
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
