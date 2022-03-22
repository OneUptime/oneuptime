import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';

import ClickOutside from 'react-click-outside';
import { Spinner } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from 'common-ui/actions/modal';
import { deleteProbe } from '../../actions/probe';

class ProbeDeleteModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyboard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyboard);
    }

    handleKeyboard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeThisDialog();
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleDelete = () => {

        const { error, modalId, closeModal, deleteProbe, probeId } = this.props;
        deleteProbe(probeId).then(() => {
            if (!error) {
                return closeModal({ id: modalId });
            }
        });
    };

    render() {

        const { isRequesting, error, closeThisDialog } = this.props;

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
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Delete Probe</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete this
                                        probe?
                                    </span>
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
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="confirmDelete"
                                            className={`bs-Button bs-Button--red Box-background--red btn__modal ${isRequesting &&
                                                'bs-is-disabled'}`}
                                            onClick={this.handleDelete}
                                            disabled={isRequesting}
                                            autoFocus={true}
                                        >
                                            <ShouldRender if={isRequesting}>
                                                <Spinner />
                                            </ShouldRender>
                                            <span>Delete Probe</span>
                                            <span className="delete-btn__keycode">
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


ProbeDeleteModal.displayName = 'ProbeDeleteModal';

const mapStateToProps = (state: $TSFixMe) => {
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

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ closeModal, deleteProbe }, dispatch);


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
