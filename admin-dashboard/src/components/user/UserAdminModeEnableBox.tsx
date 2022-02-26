import React, { Component } from 'react';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { enableAdminMode } from '../../actions/user';
import UserAdminModeEnableModal from './UserAdminModeEnableModal';
import { openModal, closeModal } from '../../actions/modal';

export class UserAdminModeEnableBox extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { AdminModeModalId: uuidv4() };
    }

    handleClick = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'enableAdminMode' does not exist on type ... Remove this comment to see the full error message
        const { enableAdminMode, userId } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'AdminModeModalId' does not exist on type... Remove this comment to see the full error message
        const { AdminModeModalId } = this.state;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openModal' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.openModal({
            id: AdminModeModalId,
            onConfirm: (values: $TSFixMe) => {
                return enableAdminMode(userId, values);
            },
            content: UserAdminModeEnableModal,
        });
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeModal' does not exist on type 'Read... Remove this comment to see the full error message
                return this.props.closeModal({
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'AdminModeModalId' does not exist on type... Remove this comment to see the full error message
                    id: this.state.AdminModeModalId,
                });
            default:
                return false;
        }
    };

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
        const { isRequesting } = this.props;

        return (
            <div
                onKeyDown={this.handleKeyBoard}
                className="Box-root Margin-bottom--12"
            >
                <div className="bs-ContentSection Card-root Card-shadow--medium">
                    <div className="Box-root">
                        <div className="bs-ContentSection-content Box-root Box-divider--surface-bottom-1 Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--20 Padding-vertical--16">
                            <div className="Box-root">
                                <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                    <span>Enable Admin Mode</span>
                                </span>
                                <p>
                                    <span>
                                        Click the button to enable admin mode
                                        and create a temporary password for this
                                        user
                                    </span>
                                </p>
                            </div>
                            <div className="bs-ContentSection-footer bs-ContentSection-content Box-root Box-background--white Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween Padding-horizontal--0 Padding-vertical--12">
                                <span className="db-SettingsForm-footerMessage"></span>
                                <div>
                                    <button
                                        id="block"
                                        className="bs-Button bs-Button--red Box-background--red"
                                        disabled={isRequesting}
                                        onClick={this.handleClick}
                                    >
                                        <ShouldRender if={!isRequesting}>
                                            <span>Enable</span>
                                        </ShouldRender>
                                        <ShouldRender if={isRequesting}>
                                            <FormLoader />
                                        </ShouldRender>
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
UserAdminModeEnableBox.displayName = 'UserAdminModeEnableBox';

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ enableAdminMode, openModal, closeModal }, dispatch);

const mapStateToProps = (state: $TSFixMe) => {
    const userId = state.user.user.user ? state.user.user.user._id : null;

    return {
        userId,
        isRequesting:
            state.user &&
            state.user.enableAdminMode &&
            state.user.enableAdminMode.requesting,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
UserAdminModeEnableBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    enableAdminMode: PropTypes.func.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    userId: PropTypes.string,
};

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
UserAdminModeEnableBox.contextTypes = {};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(UserAdminModeEnableBox);
