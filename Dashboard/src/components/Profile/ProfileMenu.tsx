import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withRouter } from 'react-router-dom';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { Link } from 'react-router-dom';
import { User, IS_SAAS_SERVICE } from '../../config';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import { hideProfileMenu } from '../../actions/profile';
import { logoutUser } from '../../actions/logout';
import About from '../modals/About';

import { v4 as uuidv4 } from 'uuid';

import ShouldRender from '../basic/ShouldRender';

interface ProfileMenuProps {
    visible?: boolean;
    hideProfileMenu: Function;
    closeModal?: Function;
    openModal: Function;
    logoutUser: Function;
    profileSettings?: object;
    data?: object;
    email?: string;
    position?: number;
    history?: object;
}

export class ProfileMenu extends Component<ProfileMenuProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { aboutId: uuidv4() };
    }

    override componentDidMount() {
        window.addEventListener('keydown', this.handleShortcut);
    }

    override componentWillUnmount() {
        window.removeEventListener('keydown', this.handleShortcut);
    }

    handleShortcut = (event: $TSFixMe) => {
        // Only execute keyboard shortcut when profile menu is open

        if (this.props.visible) {
            if (event.key === 'p' || event.key === 'P') {

                this.props.hideProfileMenu();

                this.props.history.push('/dashboard/profile/settings');
            }
            if (event.key === 'b' || event.key === 'B') {

                this.props.hideProfileMenu();

                this.props.history.push('/dashboard/profile/billing');
            }
            if (event.key === 'a' || event.key === 'A') {
                this.showAboutModal();
            }
        }
    };

    showAboutModal = () => {

        this.props.hideProfileMenu();

        this.props.openModal({

            id: this.state.aboutId,
            onClose: () => '',
            content: About,
        });
    };

    logout() {

        const { logoutUser }: $TSFixMe = this.props;
        logoutUser();
    }

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                return this.props.closeModal({ id: this.state.aboutId });
            default:
                return false;
        }
    };

    override render() {

        const { profileSettings, position }: $TSFixMe = this.props;

        const name: $TSFixMe = User.getName();
        let email = User.getEmail();

        if (
            profileSettings &&
            profileSettings.data &&
            profileSettings.data.email &&
            profileSettings.data.email !== email
        ) {
            email = profileSettings.data.email;
            User.setEmail(profileSettings.data.email);
        }


        return this.props.visible ? (
            <div
                onKeyDown={this.handleKeyBoard}
                className="ContextualLayer-layer--topright ContextualLayer-layer--anytop ContextualLayer-layer--anyright ContextualLayer-context--bottom ContextualLayer-context--anybottom ContextualLayer-container ContextualLayer--pointerEvents"
                style={{
                    top: '49px',
                    width: '232px',
                    left: position ? `${position - 214.25}px` : 'unset',
                    right: '40px',
                }}
            >
                <span>
                    <div
                        className="ContextualPopover"
                        style={{ transformOrigin: '100% 0px 0px' }}
                    >
                        <div className="ContextualPopover-arrowContainer">
                            <div className="ContextualPopover-arrow"></div>
                        </div>
                        <div className="ContextualPopover-contents">
                            <div
                                className="Box-root"
                                style={{ width: '232px' }}
                            >
                                <div className="Box-root Box-divider--surface-bottom-1 Padding-all--12">
                                    <div>
                                        <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--wrap">
                                            {name}
                                        </span>
                                    </div>
                                    <span className="Text-color--inherit Text-display--inline Text-fontSize--12 Text-fontWeight--regular Text-lineHeight--16 Text-typeface--base Text-wrap--wrap">
                                        <span>
                                            <span>{email}</span>
                                        </span>
                                    </span>
                                </div>
                                <div className="Box-root Padding-vertical--8">
                                    <div
                                        id="userProfile"
                                        className="Box-root"
                                        style={{
                                            padding: '10px',
                                            fontWeight: '500',
                                            marginTop: '-12px',
                                        }}
                                    >
                                        <Link
                                            to="/dashboard/profile/settings"
                                            className="ButtonLink db-Menu-item db-Menu-item--link"
                                            type="button"
                                            onClick={() =>

                                                this.props.hideProfileMenu()
                                            }
                                        >
                                            <div
                                                className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed"
                                                style={{
                                                    display: 'flex',
                                                    width: '100%',
                                                    justifyContent:
                                                        'space-between',
                                                    flexDirection: 'row',
                                                }}
                                            >
                                                <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>Profile</span>
                                                    </span>
                                                </span>
                                                <span className="profile__keycode">
                                                    P
                                                </span>
                                            </div>
                                        </Link>
                                    </div>
                                    <ShouldRender if={IS_SAAS_SERVICE}>
                                        <div
                                            id="profileBilling"
                                            className="Box-root"
                                            style={{
                                                padding: '10px',
                                                fontWeight: '500',
                                                marginTop: '-12px',
                                            }}
                                        >
                                            <Link
                                                to="/dashboard/profile/billing"
                                                className="ButtonLink db-Menu-item db-Menu-item--link"
                                                type="button"
                                                onClick={() =>

                                                    this.props.hideProfileMenu()
                                                }
                                            >
                                                <div
                                                    className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed"
                                                    style={{
                                                        display: 'flex',
                                                        width: '100%',
                                                        justifyContent:
                                                            'space-between',
                                                        flexDirection: 'row',
                                                    }}
                                                >
                                                    <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                        <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>Billing</span>
                                                        </span>
                                                    </span>
                                                    <span className="profile__keycode">
                                                        B
                                                    </span>
                                                </div>
                                            </Link>
                                        </div>
                                    </ShouldRender>
                                    <div
                                        className="Box-root"
                                        style={{
                                            padding: '10px',
                                            fontWeight: '500',
                                            marginTop: '-12px',
                                        }}
                                    >
                                        <button
                                            className="ButtonLink db-Menu-item db-Menu-item--link"
                                            id="about-button"
                                            type="button"
                                            onClick={() =>
                                                this.showAboutModal()
                                            }
                                            style={{ width: '100%' }}
                                        >
                                            <div
                                                className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed"
                                                style={{
                                                    display: 'flex',
                                                    width: '100%',
                                                    justifyContent:
                                                        'space-between',
                                                    flexDirection: 'row',
                                                }}
                                            >
                                                <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>About</span>
                                                    </span>
                                                </span>
                                                <span className="profile__keycode">
                                                    A
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <div
                                        className="Box-root"
                                        style={{
                                            padding: '10px',
                                            fontWeight: '500',
                                            marginTop: '-12px',
                                        }}
                                    >
                                        <button
                                            className="ButtonLink db-Menu-item db-Menu-item--link"
                                            id="logout-button"
                                            type="button"
                                            onClick={() => this.logout()}
                                        >
                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed">
                                                <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>Sign out</span>
                                                    </span>
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </span>
            </div>
        ) : null;
    }
}


ProfileMenu.displayName = 'ProfileMenu';

const mapStateToProps: Function = (state: RootState) => {
    return {
        profileSettings:
            state.profileSettings && state.profileSettings.profileSetting,
        position: state.profileSettings.menuPosition,
    };
};

const mapDispatchToProps: Function = (dispatch: Dispatch) => {
    return bindActionCreators(
        { openModal, closeModal, hideProfileMenu, logoutUser },
        dispatch
    );
};


ProfileMenu.propTypes = {
    visible: PropTypes.bool,
    hideProfileMenu: PropTypes.func.isRequired,
    closeModal: PropTypes.func,
    openModal: PropTypes.func.isRequired,
    logoutUser: PropTypes.func.isRequired,
    profileSettings: PropTypes.object,
    data: PropTypes.object,
    email: PropTypes.string,
    position: PropTypes.number,
    history: PropTypes.object,
};

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(withRouter(ProfileMenu));
