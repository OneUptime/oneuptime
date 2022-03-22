import React, { Component } from 'react';
import PropTypes from 'prop-types';

import ClickOutside from 'react-click-outside';

class NoMonitorSubscriber extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            default:
                return false;
        }
    };
    render() {

        const { closeThisDialog } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Subscriber Info</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        There&#39;s no monitor assigned to this
                                        status page so you cannot add a
                                        subscriber.
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            id="noMonitorComponent"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            autoFocus={true}
                                            onClick={closeThisDialog}
                                            style={{
                                                backgroundColor: '#000000',
                                            }}
                                        >
                                            <span>OK</span>
                                            <span className="create-btn__keycode">
                                                <span className="keycode__icon keycode__icon--enter" />
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </ClickOutside>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}


NoMonitorSubscriber.displayName = 'NoMonitorSubscriber';


NoMonitorSubscriber.propTypes = {
    closeThisDialog: PropTypes.func.isRequired,
};

export default NoMonitorSubscriber;
