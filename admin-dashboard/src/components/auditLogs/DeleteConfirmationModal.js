import React from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';

const DeleteConfirmationModal = ({
    confirmThisDialog,
    closeThisDialog,
    deleteRequest,
    error,
}) => {
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
                    <div className="bs-Modal bs-Modal--medium">
                        <div className="bs-Modal-header">
                            <div className="bs-Modal-header-copy">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Delete Audit Log</span>
                                </span>
                            </div>
                        </div>
                        <div className="bs-Modal-content">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                Do you want to delete all the logs?
                            </span>
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
                                    id="cancelAuditDelete"
                                    className={`bs-Button ${deleteRequest &&
                                        'bs-is-disabled'}`}
                                    type="button"
                                    onClick={closeThisDialog}
                                    disabled={deleteRequest}
                                >
                                    <span>Cancel</span>
                                </button>
                                <button
                                    id="confirmDelete"
                                    className={`bs-Button bs-Button--red Box-background--red ${deleteRequest &&
                                        'bs-is-disabled'}`}
                                    onClick={confirmThisDialog}
                                    disabled={deleteRequest}
                                >
                                    <span>Delete Logs</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const mapStateToProps = state => ({
    deleteRequest: state.auditLogs.auditLogs.deleteRequest,
    error: state.auditLogs.auditLogs.error,
});

DeleteConfirmationModal.displayName = 'Delete Confirmation Modal';

DeleteConfirmationModal.propTypes = {
    confirmThisDialog: PropTypes.func.isRequired,
    closeThisDialog: PropTypes.func,
    deleteRequest: PropTypes.bool,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
};

export default connect(mapStateToProps)(DeleteConfirmationModal);
