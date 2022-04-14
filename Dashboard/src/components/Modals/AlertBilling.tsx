import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes, { string } from 'prop-types';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'CommonUI/actions/modal';
import { FormLoader } from '../basic/Loader';

interface AlertBillingProps {
    closeModal: Function;
    confirmThisDialog: Function;
    title?: string;
    isRequesting?: boolean;
    message?: string;
    messageBoxId?: string;
    data?: {
        title?: string,
        message?: string,
        messageBoxId?: unknown
    };
}

class AlertBilling extends Component<ComponentProps> {
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

                return this.props.confirmThisDialog();
            default:
                return false;
        }
    };

    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.messageBoxId,
        });
    };

    override render() {

        const { data, confirmThisDialog, isRequesting } = this.props;

        let { title, message, messageBoxId } = this.props;
        if (data) {
            title = data.title;
            message = data.message;
            messageBoxId = data.messageBoxId;
        }
        return (
            <div
                className="ModalLayer-contents"

                tabIndex="-1"
                style={{ marginTop: '40px' }}
            >
                <ClickOutside onClickOutside={this.handleCloseModal}>
                    <div className="bs-BIM">
                        <div className="bs-Modal bs-Modal--medium">
                            <div className="bs-Modal-header">
                                <div className="bs-Modal-header-copy">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>{title}</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span
                                    id="message-modal-message"
                                    className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                >
                                    {message}
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton btn__modal"
                                        type="button"
                                        onClick={() => {

                                            this.props.closeModal({
                                                id: messageBoxId,
                                            });
                                            return false;
                                        }}
                                    >
                                        <span>Cancel</span>
                                        <span className="cancel-btn__keycode">
                                            Esc
                                        </span>
                                    </button>
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                        type="button"
                                        id="modal-ok"
                                        onClick={confirmThisDialog}
                                        disabled={isRequesting}
                                        autoFocus={true}
                                    >
                                        {!isRequesting && (
                                            <>
                                                <span>OK</span>
                                                <span className="create-btn__keycode">
                                                    <span className="keycode__icon keycode__icon--enter" />
                                                </span>
                                            </>
                                        )}
                                        {isRequesting && <FormLoader />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </ClickOutside>
            </div>
        );
    }
}


AlertBilling.displayName = 'AlertBilling';


AlertBilling.propTypes = {
    closeModal: PropTypes.func.isRequired,
    confirmThisDialog: PropTypes.func.isRequired,
    title: PropTypes.string,
    isRequesting: PropTypes.bool,
    message: PropTypes.string,
    messageBoxId: PropTypes.string,
    data: PropTypes.shape({
        title: PropTypes.string,
        message: PropTypes.string,
        messageBoxId: string,
    }),
};

const mapStateToProps: Function = (state: RootState) => {
    return {
        messageBoxId: state.modal.modals[0].id,
        title: state.modal.modals[0].title,
        message: state.modal.modals[0].message,
        isRequesting: state.project.alertOptionsUpdate.requesting,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ closeModal }, dispatch);
export default connect(mapStateToProps, mapDispatchToProps)(AlertBilling);
