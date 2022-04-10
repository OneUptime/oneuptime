import React from 'react';
import Clipboard from 'clipboard';
import PropTypes from 'prop-types';

export interface ComponentProps {
    value?: string;
}

class ClipboardWrap extends React.Component<ClipboardWrapProps> {
    button: $TSFixMe;
    clipboard: $TSFixMe;
    input: $TSFixMe;
    override componentDidMount() {
        const button = this.button;
        const input = this.input;

        this.clipboard = new Clipboard(button, {
            target: () => input,
        });
    }

    override componentWillUnmount() {
        this.clipboard.destroy();
    }

    override render() {

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


ClipboardWrap.displayName = 'ClipboardWrap';


ClipboardWrap.propTypes = {
    value: PropTypes.string,
};

export default ClipboardWrap;
