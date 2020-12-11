import React, { Component } from 'react';
import PropTypes from 'prop-types';

class DisabledMessage extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        return (
            <div
                className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
                id="unauthorisedModal"
            >
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>Unauthorised Action</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    This monitor is disabled. You can not create
                                    an incident on a disabled monitor. please
                                    enable the monitor to create incidents.
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                        style={{
                                            minWidth: 50,
                                            textAlign: 'center',
                                        }}
                                        type="button"
                                        onClick={this.props.closeThisDialog}
                                        autoFocus={true}
                                    >
                                        <span>Ok</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

DisabledMessage.displayName = 'DisabledMessage';

DisabledMessage.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
};

export default DisabledMessage;
