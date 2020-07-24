import React from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from '../../actions/modal';
import { deleteAuditLogs } from '../../actions/auditLogs';
import { FormLoader } from '../basic/Loader';

const DeleteConfirmationModal = ({
    closeThisDialog,
    deleteRequest,
    error,
    deleteAuditLogs,
    closeModal,
    modalId,
}) => {
    const handleDelete = () => {
        deleteAuditLogs().then(() => {
            if (!error) {
                return closeModal({ id: modalId });
            }
        });
    };

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
                                    onClick={handleDelete}
                                    disabled={deleteRequest}
                                >
                                    <ShouldRender if={!deleteRequest}>
                                        <span>Delete Logs</span>
                                    </ShouldRender>
                                    <ShouldRender if={deleteRequest}>
                                        <span>
                                            <FormLoader />
                                        </span>
                                    </ShouldRender>
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
    modalId: state.modal.modals[0].id,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeModal, deleteAuditLogs }, dispatch);

DeleteConfirmationModal.displayName = 'Delete Confirmation Modal';

DeleteConfirmationModal.propTypes = {
    closeThisDialog: PropTypes.func,
    deleteRequest: PropTypes.bool,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    closeModal: PropTypes.func,
    deleteAuditLogs: PropTypes.func,
    modalId: PropTypes.string,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DeleteConfirmationModal);
