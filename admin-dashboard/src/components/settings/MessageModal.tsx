import React from 'react';

import { PropTypes } from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';

const MessageModal = (props: $TSFixMe) => {
    const { closeThisDialog, testError, email } = props;

    return (
        <div
            onKeyDown={e => e.key === 'Escape' && closeThisDialog()}
            className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
        >
            <div
                className="ModalLayer-contents"
                tabIndex={-1}
                style={{ marginTop: 40 }}
            >
                <div className="bs-BIM">
                    <div
                        className="bs-Modal bs-Modal--medium"
                        style={{ minWidth: '400px' }}
                    >
                        <ClickOutside onClickOutside={closeThisDialog}>
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span id="test-result">
                                            {testError
                                                ? 'Test Failed'
                                                : 'Test Email Sent'}
                                        </span>
                                    </span>
                                </div>
                            </div>
                            <div className="Flex-flex bs-Modal-content">
                                <ShouldRender if={testError}>
                                    <span
                                        className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                        style={{ flex: 1 }}
                                    >
                                        {testError}
                                    </span>
                                </ShouldRender>
                                <ShouldRender if={!testError}>
                                    <span
                                        className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                        style={{ flex: 1 }}
                                    >
                                        We&#39;ve successfully sent a test email
                                        to {email}. If you do not see it, please
                                        check spam.
                                    </span>
                                </ShouldRender>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        id="confirmDelete"
                                        className="bs-Button"
                                        onClick={closeThisDialog}
                                    >
                                        <span>Ok</span>
                                    </button>
                                </div>
                            </div>
                        </ClickOutside>
                    </div>
                </div>
            </div>
        </div>
    );
};

MessageModal.displayName = 'MessageModal';

MessageModal.propTypes = {
    closeThisDialog: PropTypes.func,
    testError: PropTypes.string,
    email: PropTypes.string,
};

const mapStateToProps = (state: $TSFixMe) => {
    return {
        testError: state.settings.error,
    };
};

export default connect(mapStateToProps, null)(MessageModal);
