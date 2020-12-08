import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes, { string } from 'prop-types';
import { closeModal } from '../../actions/modal';

class AlertBilling extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = e => {
        const { closeModal, messageBoxId } = this.props;
        switch (e.key) {
            case 'Escape':
                return closeModal({
                    id: messageBoxId,
                });
            case 'Enter':
                return this.props.confirmThisDialog();
            default:
                return false;
        }
    };

    render() {
        const { data, confirmThisDialog } = this.props;
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
                                    autoFocus={true}
                                >
                                    <span>OK</span>
                                    <span className="create-btn__keycode">
                                        <span className="keycode__icon keycode__icon--enter" />
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

AlertBilling.displayName = 'AlertBilling';

AlertBilling.propTypes = {
    closeModal: PropTypes.func.isRequired,
    confirmThisDialog: PropTypes.func.isRequired,
    title: PropTypes.string,
    message: PropTypes.string,
    messageBoxId: PropTypes.string,
    data: PropTypes.shape({
        title: PropTypes.string,
        message: PropTypes.string,
        messageBoxId: string,
    }),
};

const mapStateToProps = state => {
    return {
        messageBoxId: state.modal.modals[0].id,
        title: state.modal.modals[0].title,
        message: state.modal.modals[0].message,
    };
};

const mapDispatchToProps = dispatch =>
    bindActionCreators({ closeModal }, dispatch);
export default connect(mapStateToProps, mapDispatchToProps)(AlertBilling);
