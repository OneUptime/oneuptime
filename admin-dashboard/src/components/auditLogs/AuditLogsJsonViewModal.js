import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import ReactJson from 'react-json-view';

export function AuditLogsJsonViewModal(props) {
    const { isRequesting, error, closeThisDialog } = props;
    const { reqLog, resLog } = props;

    return (
        <div
            onKeyDown={e => e.key === 'Escape' && closeThisDialog()}
            className="db-AuditLogsJsonViewModal ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center"
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
                                    <span>API Request and Response</span>
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
                                                displayObjectSize={false}
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
                                                displayObjectSize={false}
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
                                            style={{ marginTop: '10px' }}
                                        >
                                            <div className="Box-root Margin-right--8">
                                                <div
                                                    className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"
                                                    style={{ marginTop: '2px' }}
                                                ></div>
                                            </div>
                                            <div className="Box-root">
                                                <span style={{ color: 'red' }}>
                                                    {error}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </ShouldRender>
                                <button
                                    className={`bs-Button ${isRequesting &&
                                        'bs-is-disabled'}`}
                                    type="button"
                                    onClick={closeThisDialog}
                                    disabled={isRequesting}
                                >
                                    <span>Close</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

AuditLogsJsonViewModal.displayName = 'AuditLogsJsonViewModal';

const mapStateToProps = state => {
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
