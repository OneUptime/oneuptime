import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import PropTypes from 'prop-types';

import ClickOutside from 'react-click-outside';
import ShouldRender from '../basic/ShouldRender';
import { closeModal } from 'CommonUI/actions/modal';
import { deleteCallLogs } from '../../actions/callLogs';
import { FormLoader } from '../basic/Loader';

class DeleteConfirmationModal extends Component<ComponentProps> {

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
            case 'Enter':
                return this.handleDelete();
            default:
                return false;
        }
    };

    handleDelete = () => {

        const { error, deleteCallLogs, closeModal, modalId } = this.props;
        deleteCallLogs().then(() => {
            if (!error) {
                return closeModal({ id: modalId });
            }
        });
    };
    override render() {

        const { closeThisDialog, deleteRequest, error } = this.props;

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
                                            <span>Delete Call Log</span>
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
                                            id="cancelCallDelete"
                                            className={`bs-Button btn__modal ${deleteRequest &&
                                                'bs-is-disabled'}`}
                                            type="button"
                                            onClick={closeThisDialog}
                                            disabled={deleteRequest}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="confirmDelete"
                                            className={`bs-Button bs-Button--red Box-background--red btn__modal ${deleteRequest &&
                                                'bs-is-disabled'}`}
                                            onClick={this.handleDelete}
                                            disabled={deleteRequest}
                                            autoFocus={true}
                                        >
                                            <ShouldRender if={!deleteRequest}>
                                                <span>Delete Logs</span>
                                                <span className="delete-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </ShouldRender>
                                            <ShouldRender if={deleteRequest}>
                                                <span>
                                                    <FormLoader />
                                                </span>
                                            </ShouldRender>
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

const mapStateToProps = (state: RootState) => ({
    deleteRequest: state.callLogs.callLogs.deleteRequest,
    error: state.callLogs.callLogs.error,
    modalId: state.modal.modals[0].id
});

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ closeModal, deleteCallLogs }, dispatch);


DeleteConfirmationModal.displayName = 'Delete Confirmation Modal';


DeleteConfirmationModal.propTypes = {
    closeThisDialog: PropTypes.func,
    deleteRequest: PropTypes.bool,
    error: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    closeModal: PropTypes.func,
    deleteCallLogs: PropTypes.func,
    modalId: PropTypes.string,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DeleteConfirmationModal);
