import React from 'react';
import Clipboard from 'clipboard';
import PropTypes from 'prop-types';

class ClipboardWrap extends React.Component {
    button: $TSFixMe;
    clipboard: $TSFixMe;
    input: $TSFixMe;
    componentDidMount() {
        const button = this.button;
        const input = this.input;

        this.clipboard = new Clipboard(button, {
            target: () => input,
        });
    }

    componentWillUnmount() {
        this.clipboard.destroy();
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { value } = this.props;

        return (
            <div>
                <input
                    ref={element => {
                        this.input = element;
                    }}
                    type={'text'}
                    value={value}
                    className="bs-TextInput"
                    style={{
                        width: 360,
                        borderTopRightRadius: 0,
                        borderBottomRightRadius: 0,
                    }}
                    readOnly
                />
                <button
                    ref={element => {
                        this.button = element;
                    }}
                    className="bs-Button bs-Button--blue"
                    style={{
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                    }}
                >
                    Copy
                </button>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ClipboardWrap.displayName = 'ClipboardWrap';

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ClipboardWrap.propTypes = {
    value: PropTypes.string,
};

export default ClipboardWrap;
