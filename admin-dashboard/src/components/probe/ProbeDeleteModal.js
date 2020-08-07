import React from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from '../../actions/modal';
import { deleteProbe } from '../../actions/probe';

export function ProbeDeleteModal({
    isRequesting,
    error,
    modalId,
    closeThisDialog,
    closeModal,
    deleteProbe,
    probeId,
}) {
    const handleDelete = () => {
        deleteProbe(probeId).then(() => {
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
                                    <span>Delete Probe</span>
                                </span>
                            </div>
                        </div>
                        <div className="bs-Modal-content">
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                Are you sure you want to delete this probe?
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
                                    className={`bs-Button ${isRequesting &&
                                        'bs-is-disabled'}`}
                                    type="button"
                                    onClick={closeThisDialog}
                                    disabled={isRequesting}
                                >
                                    <span>Cancel</span>
                                </button>
                                <button
                                    id="confirmDelete"
                                    className={`bs-Button bs-Button--red Box-background--red ${isRequesting &&
                                        'bs-is-disabled'}`}
                                    onClick={handleDelete}
                                    disabled={isRequesting}
                                >
                                    <ShouldRender if={isRequesting}>
                                        <Spinner />
                                    </ShouldRender>
                                    <span>Delete Probe</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

ProbeDeleteModal.displayName = 'ProbeDeleteModal';

const mapStateToProps = state => {
    return {
        isRequesting:
            state.probes &&
            state.probes.deleteProbe &&
            state.probes.deleteProbe.requesting,
        error:
            state.probes &&
            state.probes.deleteProbe &&
            state.probes.deleteProbe.error,
        modalId: state.modal.modals[0].id,
        probeId: state.modal.modals[0].probeId,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeModal, deleteProbe }, dispatch);

ProbeDeleteModal.propTypes = {
    isRequesting: PropTypes.oneOfType([
        PropTypes.bool,
        PropTypes.oneOf([null, undefined]),
    ]),
    closeThisDialog: PropTypes.func,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    closeModal: PropTypes.func,
    deleteProbe: PropTypes.func,
    modalId: PropTypes.string,
    probeId: PropTypes.string,
};

export default connect(mapStateToProps, mapDispatchToProps)(ProbeDeleteModal);
