import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { closeModal } from '../../actions/modal';

class MessageBox extends Component {
    handleKeyBoard = e => {
        const { messageBoxId, closeModal } = this.props;
        switch (e.key) {
            case 'Escape':
                return closeModal({
                    id: messageBoxId,
                });
            default:
                return false;
        }
    };

    render() {
        const { title, message, messageBoxId } = this.props;
        return (
            <div
                onKeyDown={this.handleKeyBoard}
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
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        <span>{title}</span>
                                    </span>
                                </div>
                            </div>
                            <div className="bs-Modal-content">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    {message}
                                </span>
                            </div>
                            <div className="bs-Modal-footer">
                                <div className="bs-Modal-footer-actions">
                                    <button
                                        className="bs-Button bs-DeprecatedButton bs-Button--blue"
                                        type="button"
                                        onClick={() =>
                                            this.props.closeModal({
                                                id: messageBoxId,
                                            })
                                        }
                                    >
                                        <span>OK</span>
                                    </button>
                                </div>
                            </div>
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
export default connect(mapStateToProps, mapDispatchToProps)(MessageBox);
