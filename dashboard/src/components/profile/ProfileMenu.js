import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Link } from 'react-router-dom';
import { User, SHOULD_LOG_ANALYTICS, IS_SAAS_SERVICE } from '../../config';
import { openModal, closeModal } from '../../actions/modal';
import { hideProfileMenu } from '../../actions/profile';
import { logoutUser } from '../../actions/logout';
import About from '../modals/About';
import uuid from 'uuid';
import { logEvent } from '../../analytics';
import ShouldRender from '../basic/ShouldRender';

export class ProfileMenu extends Component {
    constructor(props) {
        super(props);

        this.state = { aboutId: uuid.v4() };
    }

    showAboutModal = () => {
        this.props.hideProfileMenu();

        this.props.openModal({
            id: this.state.aboutId,
            onClose: () => '',
            content: About,
        });
    };

    logout() {
        const { logoutUser } = this.props;
        logoutUser();
        if (SHOULD_LOG_ANALYTICS) {
            logEvent('EVENT: DASHBOARD > USER LOG OUT');
        }
    }

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                return this.props.closeModal({ id: this.state.aboutId });
            default:
                return false;
        }
    };

    render() {
        const { profileSettings, position } = this.props;

        const name = User.getName();
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
                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed">
                                                <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>Profile</span>
                                                    </span>
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
                                                <div className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed">
                                                    <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                        <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                            <span>Billing</span>
                                                        </span>
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
                                        >
                                            <div className="Box-root Flex-inlineFlex Flex-alignItems--center Flex-direction--rowReversed">
                                                <span className="ButtonLink-label Text-color--cyan Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--noWrap">
                                                    <span className="Text-color--primary Text-display--inline Text-fontSize--14 Text-fontWeight--medium Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span>About</span>
                                                    </span>
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

const mapStateToProps = state => {
    return {
        profileSettings:
            state.profileSettings && state.profileSettings.profileSetting,
        position: state.profileSettings.menuPosition,
    };
};

const mapDispatchToProps = dispatch => {
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
    data: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    email: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    position: PropTypes.number,
};

export default connect(mapStateToProps, mapDispatchToProps)(ProfileMenu);
