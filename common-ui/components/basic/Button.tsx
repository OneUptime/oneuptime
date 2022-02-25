import React, { Component } from 'react';
import PropTypes from 'prop-types';

export default class Button extends Component {
    constructor(props) {
        super(props);
    }

    componentDidMount() {
        if (this.props.shortcutKey) {
            window.addEventListener('keydown', this.handleKeyboard.bind(this));
        }
    }

    componentWillUnmount() {
        if (this.props.shortcutKey) {
            window.removeEventListener('keydown', this.handleKeyboard.bind(this));
        }
    }

    handleKeyboard(event) {
        const { shortcutKey, onClick } = this.props;

        if (event.target.localName === 'body' && event.key) {
            switch (event.key) {
                case shortcutKey.toUpperCase():
                case shortcutKey.toLowerCase():
                    onClick && onClick();
                    return false;
                default:
                    return false;
            }
        }
    }

    render() {
        const { title, shortcutKey, id, onClick, disabled } = this.props;

        return (
            <button
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
            </button>
        );
    }
}

Button.propTypes = {
    title: PropTypes.string.isRequired,
    onClick: PropTypes.func,
    disabled: PropTypes.bool,
    id: PropTypes.string,
    shortcutKey: PropTypes.string,
};
