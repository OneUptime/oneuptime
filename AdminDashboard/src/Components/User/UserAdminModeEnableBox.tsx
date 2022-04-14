import React, { Component } from 'react';

import { v4 as uuidv4 } from 'uuid';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, Dispatch } from 'redux';
import { FormLoader } from '../basic/Loader';
import ShouldRender from '../basic/ShouldRender';
import { enableAdminMode } from '../../actions/user';
import UserAdminModeEnableModal from './UserAdminModeEnableModal';
import { openModal, closeModal } from 'CommonUI/actions/modal';

export class UserAdminModeEnableBox extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    constructor(props: $TSFixMe) {
        super(props);
        this.state = { AdminModeModalId: uuidv4() };
    }

    handleClick = () => {

        const { enableAdminMode, userId } = this.props;

        const { AdminModeModalId } = this.state;


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

                return this.props.closeModal({

                    id: this.state.AdminModeModalId,
                });
            default:
                return false;
        }
    };

    override render() {

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


UserAdminModeEnableBox.displayName = 'UserAdminModeEnableBox';

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators({ enableAdminMode, openModal, closeModal }, dispatch);

const mapStateToProps: Function = (state: RootState) => {
    const userId = state.user.user.user ? state.user.user.user._id : null;

    return {
        userId,
        isRequesting:
            state.user &&
            state.user.enableAdminMode &&
            state.user.enableAdminMode.requesting,
    };
};


UserAdminModeEnableBox.propTypes = {
    isRequesting: PropTypes.oneOf([null, undefined, true, false]),
    enableAdminMode: PropTypes.func.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    userId: PropTypes.string,
};


UserAdminModeEnableBox.contextTypes = {};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(UserAdminModeEnableBox);
