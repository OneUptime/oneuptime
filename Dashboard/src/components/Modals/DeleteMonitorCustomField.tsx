import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { FormLoader } from '../basic/Loader';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from 'Common-ui/actions/modal';
import { deleteCustomField } from '../../actions/monitorCustomField';

interface DeleteMonitorCustomFieldProps {
    isRequesting?: boolean;
    deleteError?: string;
    closeModal?: Function;
    deleteCustomField?: Function;
    modalId?: string;
    data?: object;
}

class DeleteMonitorCustomField extends Component<ComponentProps> {
    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return this.handleCloseModal();
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.modalId,
        });
    };

    handleDelete = () => {
        const {

            deleteCustomField,

            deleteError,

            closeModal,

            modalId,

            data,
        } = this.props;
        const { projectId, customFieldId } = data;
        deleteCustomField(projectId, customFieldId).then(() => {
            if (!deleteError) {
                closeModal({ id: modalId });
            }
        });
    };

    override render() {

        const { isRequesting, modalId, closeModal, deleteError } = this.props;
        return (
            <div className="ModalLayer-wash Box-root Flex-flex Flex-alignItems--flexStart Flex-justifyContent--center">
                <div
                    className="ModalLayer-contents"
                    tabIndex={-1}
                    style={{ marginTop: 40 }}
                >
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <ClickOutside
                                onClickOutside={this.handleCloseModal}
                            >
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            <span>Confirm Deletion</span>
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to delete this
                                        custom field ?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div
                                        className="bs-Modal-footer-actions"
                                        style={{ width: 280 }}
                                    >
                                        <ShouldRender
                                            if={!isRequesting && deleteError}
                                        >
                                            <div
                                                id="deleteError"
                                                className="bs-Tail-copy"
                                            >
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--stretch Flex-direction--row Flex-justifyContent--flexStart"
                                                    style={{
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <div className="Box-root Margin-right--8">
                                                        <div className="Icon Icon--info Icon--color--red Icon--size--14 Box-root Flex-flex"></div>
                                                    </div>
                                                    <div className="Box-root">
                                                        <span
                                                            style={{
                                                                color: 'red',
                                                            }}
                                                        >
                                                            {deleteError}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </ShouldRender>
                                    </div>
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={() =>
                                                closeModal({ id: modalId })
                                            }
                                            id="cancelDeleteCustomFieldBtn"
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="deleteCustomFieldModalBtn"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            type="button"
                                            onClick={this.handleDelete}
                                            disabled={isRequesting}
                                            autoFocus={true}
                                        >
                                            {!isRequesting && (
                                                <>
                                                    <span>Delete</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {isRequesting && <FormLoader />}
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


DeleteMonitorCustomField.displayName = 'DeleteMonitorCustomField';


DeleteMonitorCustomField.propTypes = {
    isRequesting: PropTypes.bool,
    deleteError: PropTypes.string,
    closeModal: PropTypes.func,
    deleteCustomField: PropTypes.func,
    modalId: PropTypes.string,
    data: PropTypes.object,
};

const mapStateToProps = (state: RootState) => {
    return {
        isRequesting: state.monitorCustomField.monitorCustomField.requesting,
        deleteError: state.monitorCustomField.monitorCustomField.error,
        modalId: state.modal.modals[0].id,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ closeModal, deleteCustomField }, dispatch);

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DeleteMonitorCustomField);
