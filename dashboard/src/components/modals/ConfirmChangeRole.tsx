import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';

import { PropTypes } from 'prop-types';

import ClickOutside from 'react-click-outside';
import { openModal, closeModal } from 'common-ui/actions/modal';
import { User } from '../../config';

interface ConfirmChangeRoleProps {
    closeModal?: Function;
    ConfirmationDialogId?: string;
    data?: {
        updateTeamMemberRole?: Function,
        ConfirmationDialogId?: string,
        name?: string,
        values?: object,
        role?: string,
        userId?: string,
        newRole?: string
    };
}

class ConfirmChangeRole extends Component<ConfirmChangeRoleProps> {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }
    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return document.getElementById('cancelResetKey').click();
            case 'Enter':

                return document.getElementById('confirmResetKey').click();
            default:
                return false;
        }
    };
    handleCloseModal = () => {

        this.props.closeModal({

            id: this.props.data.ConfirmationDialogId,
        });
    };

    render() {
        const {

            data: { updateTeamMemberRole, name, values, role, userId, newRole },
        } = this.props;
        const authUserName = User.getName() || User.getEmail();

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
                    <ClickOutside onClickOutside={this.handleCloseModal}>
                        <div className="bs-BIM">
                            <div className="bs-Modal bs-Modal--medium">
                                <div className="bs-Modal-header">
                                    <div className="bs-Modal-header-copy">
                                        <span
                                            className="Text-color--inherit Text-display--inline Text-fontSize--20 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap"
                                            id="modalTitle"
                                        >
                                            Confirm Role Change
                                        </span>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        {`Making ${name} the Owner of this project will make ${authUserName} an Administrator. Please click Ok to continue.`}
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            id="cancelResetKey"
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            type="button"
                                            onClick={this.handleCloseModal}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="confirmRoleChange"
                                            className="bs-Button bs-DeprecatedButton bs-Button--blue btn__modal"
                                            type="button"
                                            onClick={() => {
                                                this.handleCloseModal();
                                                return updateTeamMemberRole(
                                                    {
                                                        ...values,
                                                        role,
                                                        userId,
                                                    },
                                                    newRole
                                                );
                                            }}
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
                    </ClickOutside>
                </div>
            </div>
        );
    }
}


ConfirmChangeRole.displayName = 'ConfirmChangeRole';


ConfirmChangeRole.propTypes = {
    closeModal: PropTypes.func,
    ConfirmationDialogId: PropTypes.string,
    data: PropTypes.shape({
        updateTeamMemberRole: PropTypes.func,
        ConfirmationDialogId: PropTypes.string,
        name: PropTypes.string,
        values: PropTypes.object,
        role: PropTypes.string,
        userId: PropTypes.string,
        newRole: PropTypes.string,
    }),
};

const mapStateToProps = () => {
    return {};
};

const mapDispatchToProps = (dispatch: Dispatch) => {
    return bindActionCreators({ openModal, closeModal }, dispatch);
};

export default connect(mapStateToProps, mapDispatchToProps)(ConfirmChangeRole);
