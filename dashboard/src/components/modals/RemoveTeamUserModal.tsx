import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import { closeModal } from '../../actions/modal';
import { resetTeamDelete } from '../../actions/team';
import ShouldRender from '../basic/ShouldRender';
import { FormLoader } from '../basic/Loader';

class RemoveTeamUserModal extends Component {
    componentDidMount() {
        window.addEventListener('keydown', this.handleKeyBoard);
    }

    componentWillUnmount() {
        window.removeEventListener('keydown', this.handleKeyBoard);
    }

    handleKeyBoard = (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
        const { data, resetTeamDelete } = this.props;
        switch (e.key) {
            case 'Escape':
                resetTeamDelete();
                return this.handleCloseModal();
            case 'Enter':
                return data.removeTeamMember(data.values);
            default:
                return false;
        }
    };

    handleCloseModal = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.closeModal({
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            id: this.props.data.removeUserModalId,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'teamUserDelete' does not exist on type '... Remove this comment to see the full error message
            teamUserDelete,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
            closeModal,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Readonly<{... Remove this comment to see the full error message
            data,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'resetTeamDelete' does not exist on type ... Remove this comment to see the full error message
            resetTeamDelete,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleting' does not exist on type 'Readon... Remove this comment to see the full error message
            deleting,
        } = this.props;
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
                                            <span>Confirm Removal</span>
                                        </span>
                                    </div>
                                    <div className="bs-Modal-messages">
                                        <ShouldRender if={teamUserDelete.error}>
                                            <p className="bs-Modal-message">
                                                {teamUserDelete.error}
                                            </p>
                                        </ShouldRender>
                                    </div>
                                </div>
                                <div className="bs-Modal-content">
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                        Are you sure you want to remove{' '}
                                        {data.displayName
                                            ? data.displayName
                                            : 'this user'}{' '}
                                        from the team?
                                    </span>
                                </div>
                                <div className="bs-Modal-footer">
                                    <div className="bs-Modal-footer-actions">
                                        <button
                                            className="bs-Button bs-DeprecatedButton bs-Button--grey btn__modal"
                                            disabled={deleting}
                                            type="button"
                                            onClick={() => {
                                                resetTeamDelete();
                                                return closeModal({
                                                    id: data.removeUserModalId,
                                                });
                                            }}
                                        >
                                            <span>Cancel</span>
                                            <span className="cancel-btn__keycode">
                                                Esc
                                            </span>
                                        </button>
                                        <button
                                            id="removeTeamUser"
                                            className="bs-Button bs-DeprecatedButton bs-Button--red btn__modal"
                                            disabled={deleting}
                                            type="button"
                                            onClick={() =>
                                                data.removeTeamMember(
                                                    data.values
                                                )
                                            }
                                            autoFocus={true}
                                        >
                                            {!deleting && (
                                                <>
                                                    <span>Remove</span>
                                                    <span className="delete-btn__keycode">
                                                        <span className="keycode__icon keycode__icon--enter" />
                                                    </span>
                                                </>
                                            )}
                                            {deleting && <FormLoader />}
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
RemoveTeamUserModal.displayName = 'RemoveTeamUserModal';

const mapStateToProps = (state: $TSFixMe, props: $TSFixMe) => {
    const userId =
        props.data && props.data.values && props.data.values.userId
            ? props.data.values.userId
            : null;
    return {
        teamUserDelete: state.team.teamdelete,
        deleting: state.team.teamdelete.deleting.some((id: $TSFixMe) => id === userId),
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators({ closeModal, resetTeamDelete }, dispatch);
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
RemoveTeamUserModal.propTypes = {
    closeModal: PropTypes.func,
    data: PropTypes.object,
    deleting: PropTypes.bool,
    resetTeamDelete: PropTypes.any,
    teamUserDelete: PropTypes.any,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(RemoveTeamUserModal);
