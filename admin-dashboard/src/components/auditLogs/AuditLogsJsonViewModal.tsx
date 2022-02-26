import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import ReactJson from 'react-json-view';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';

class AuditLogsJsonViewModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
                return this.props.closeThisDialog();
            default:
                return false;
        }
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
            error,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeThisDialog' does not exist on type ... Remove this comment to see the full error message
            closeThisDialog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'reqLog' does not exist on type 'Readonly... Remove this comment to see the full error message
            reqLog,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resLog' does not exist on type 'Readonly... Remove this comment to see the full error message
            resLog,
        } = this.props;

        return (
            <div className="db-AuditLogsJsonViewModal ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
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
                                            <span>
                                                API Request and Response
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <div className="jsonViwer Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <div className="db-AuditLogsJsonViewModal-JsonViewerWrapper">
                                            <div className="db-AuditLogsJsonViewModal-JsonViewerContainer">
                                                <div className="Text-fontWeight--medium">
                                                    Request
                                                </div>
                                                <div className="db-AuditLogsJsonViewModal-JsonViewer">
                                                    <ReactJson
                                                        src={reqLog}
                                                        name="Request"
                                                        enableClipboard={false}
                                                        displayObjectSize={
                                                            false
                                                        }
                                                        displayDataTypes={false}
                                                        indentWidth={2}
                                                        collapsed={1}
                                                        style={{
                                                            fontSize: '12px',
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="AuditLogsJsonViewModal-JsonViewerContainer">
                                                <div className="Text-fontWeight--medium">
                                                    Response
                                                </div>
                                                <div className="db-AuditLogsJsonViewModal-JsonViewer">
                                                    <ReactJson
                                                        src={resLog}
                                                        name="Response"
                                                        enableClipboard={false}
                                                        displayObjectSize={
                                                            false
                                                        }
                                                        displayDataTypes={false}
                                                        indentWidth={2}
                                                        collapsed={1}
                                                        style={{
                                                            fontSize: '12px',
                                                        }}
                                                    />
                                                </div>
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
                                            className={`bs-Button btn__modal ${isRequesting &&
                                                'bs-is-disabled'}`}
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AuditLogsJsonViewModal.displayName = 'AuditLogsJsonViewModal';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        isRequesting:
            state.auditLogs &&
            state.auditLogs.auditLogs &&
            state.auditLogs.auditLogs.requesting,
        error:
            state.auditLogs &&
            state.auditLogs.auditLogs &&
            state.auditLogs.auditLogs.error,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
AuditLogsJsonViewModal.propTypes = {
    isRequesting: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.oneOf([null, undefined]),
    ]),
    closeThisDialog: PropTypes.func,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    reqLog: PropTypes.object,
    resLog: PropTypes.object,
};

export default connect(mapStateToProps)(AuditLogsJsonViewModal);
