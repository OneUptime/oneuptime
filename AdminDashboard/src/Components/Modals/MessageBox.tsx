import React, { Component } from 'react';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import PropTypes, { string } from 'prop-types';

import ClickOutside from 'react-click-outside';
import { closeModal } from 'common-ui/actions/modal';

class MessageBox extends Component<ComponentProps> {

    public static displayName = '';
    public static propTypes = {};

    override componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
            case 'Enter':
                return this.handleCloseModal();
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

        const { data } = this.props;

        let { title, message, messageBoxId } = this.props;
        if (data) {
            title = data.title;
            message = data.message;
            messageBoxId = data.messageBoxId;
        }

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
                                            className="bs-Button bs-DeprecatedButton bs-Button--white btn__modal"
                                            type="button"
                                            id="modal-ok"
                                            onClick={() =>

                                                this.props.closeModal({
                                                    id: messageBoxId,
                                                })
                                            }
                                            autoFocus={true}
                                        >
                                            <span>OK</span>
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


MessageBox.displayName = 'MessageBoxModal';


MessageBox.propTypes = {
    closeModal: PropTypes.func.isRequired,
    title: PropTypes.string,
    message: PropTypes.string,
    messageBoxId: PropTypes.string,
    data: PropTypes.shape({
        title: PropTypes.string,
        message: PropTypes.string,
        messageBoxId: string,
    }),
};

const mapStateToProps = (state: RootState) => {
    return {
        messageBoxId: state.modal.modals[0].id,
        title: state.modal.modals[0].title,
        message: state.modal.modals[0].message,
    };
};

const mapDispatchToProps = (dispatch: Dispatch) => bindActionCreators({ closeModal }, dispatch);
export default connect(mapStateToProps, mapDispatchToProps)(MessageBox);
