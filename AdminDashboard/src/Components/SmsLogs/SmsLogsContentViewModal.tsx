import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
class SmsLogsContentViewModal extends Component<ComponentProps> {
    public static displayName = '';
    public static propTypes = {};

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    override render() {
        const { isRequesting, error, closeThisDialog, content }: $TSFixMe =
            this.props;

        return (
            <div className="db-SmsLogsContentViewModal ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--large">
                            <ClickOutside onClickOutside={closeThisDialog}>
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Content</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <div className="jsonViwer Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <div className="db-SmsLogsContentViewModal-ContentViewerWrapper">
                                            <div className="db-SmsLogsContentViewModal-ContentViewerContainer">
                                                {content ? (
                                                    <div
                                                        dangerouslySetInnerHTML={{
                                                            __html: content,
                                                        }}
                                                    ></div>
                                                ) : (
                                                    <span>
                                                        The SMS Body is Empty.
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <ShouldRender if={error}>
                                            <div className="bs-Tail-copy">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div
                                                            className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                            style={{
                                                                marginTop:
                                                                    '2px',
                                                            }}
                                                        ></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {error}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                        <button
                                            className={`bs-Button btn__modal ${
                                                isRequesting && 'bs-is-disabled'
                                            }`}
                                            type="button"
                                            onClick={closeThisDialog}
                                            disabled={isRequesting}
                                            autoFocus={true}
                                        >
                                            <span>Close</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
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

SmsLogsContentViewModal.displayName = 'SmsLogsContentViewModal';

const mapStateToProps: Function = (state: RootState) => {
    return {
        isRequesting:
            state.smsLogs &&
            state.smsLogs.smsLogs &&
            state.smsLogs.smsLogs.requesting,
        error:
            state.smsLogs &&
            state.smsLogs.smsLogs &&
            state.smsLogs.smsLogs.error,
    };
};

SmsLogsContentViewModal.propTypes = {
    isRequesting: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.oneOf([null, undefined]),
    ]),
    closeThisDialog: PropTypes.func,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    content: PropTypes.string,
};

export default connect(mapStateToProps)(SmsLogsContentViewModal);
