import React, { Component } from 'react';
import PropTypes from 'prop-types';

export default class Button extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'shortcutKey' does not exist on type 'Rea... Remove this comment to see the full error message
        if (this.props.shortcutKey) {
            window.addEventListener('keydown', this.handleKeyboard.bind(this));
        }
    }

    componentWillUnmount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'shortcutKey' does not exist on type 'Rea... Remove this comment to see the full error message
        if (this.props.shortcutKey) {
            window.removeEventListener('keydown', this.handleKeyboard.bind(this));
        }
    }

    handleKeyboard(event: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'shortcutKey' does not exist on type 'Rea... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
Button.propTypes = {
    title: PropTypes.string.isRequired,
    onClick: PropTypes.func,
    disabled: PropTypes.bool,
    id: PropTypes.string,
    shortcutKey: PropTypes.string,
};
