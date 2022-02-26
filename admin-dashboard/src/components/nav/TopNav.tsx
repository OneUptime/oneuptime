import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { showProfileMenu } from '../../actions/profile';
import { openNotificationMenu } from '../../actions/notification';
import { API_URL, User } from '../../config';
import { openSideNav } from '../../actions/page';
import { getVersion } from '../../actions/version';
import { getProbes } from '../../actions/probe';

class TopContent extends Component {
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getVersion' does not exist on type 'Read... Remove this comment to see the full error message
        const { getVersion } = this.props;
        getVersion();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'getProbes' does not exist on type 'Reado... Remove this comment to see the full error message
        this.props.getProbes(0, 10);
    }
    showProfileMenu = (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'showProfileMenu' does not exist on type ... Remove this comment to see the full error message
        this.props.showProfileMenu(e.clientX);
    };

    showNotificationsMenu = (e: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'openNotificationMenu' does not exist on ... Remove this comment to see the full error message
        this.props.openNotificationMenu(e.clientX);
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                return true;
            default:
                return false;
        }
    };

    render() {
        const IMG_URL =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.profilePic && this.props.profilePic !== ''
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
                ? `url(${API_URL}/file/${this.props.profilePic})`
                : 'url(https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y)';
        const userId = User.getUserId();
        let count = 0;
        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
            this.props.notifications &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
            this.props.notifications.notifications &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
            this.props.notifications.notifications.length
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'notifications' does not exist on type 'R... Remove this comment to see the full error message
            this.props.notifications.notifications.map((notification: $TSFixMe) => {
                if (notification.read.indexOf(userId) > -1) {
                    return notification;
                } else {
                    count++;
                    return notification;
                }
            });
        }

        return (
            <div
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                tabIndex="0"
                onKeyDown={this.handleKeyBoard}
                style={{ zIndex: '2' }}
                className="db-World-topContent Box-root Box-background--surface Padding-vertical--20"
            >
                <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'openSideNav' does not exist on type 'Rea... Remove this comment to see the full error message
                    <div className="Box-root" onClick={this.props.openSideNav}>
                        <div className="db-MenuContainer">
                            <div
                                className={
                                    'db-MenuIcon Box-root Box-background--white'
                                }
                            >
                                <div className="db-MenuIcon--content db-MenuIcon--menu" />
                            </div>
                        </div>
                    </div>

                    <div className="Box-root Flex-flex">
                        <div>
                            <div
                                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                                tabIndex="-1"
                                style={{ outline: 'none', marginRight: '15px' }}
                            >
                                <button
                                    className={
                                        count
                                            ? 'db-Notifications-button active-notification'
                                            : 'db-Notifications-button'
                                    }
                                    onClick={this.showNotificationsMenu}
                                >
                                    <span className="db-Notifications-icon db-Notifications-icon--empty" />
                                </button>
                            </div>
                        </div>
                        <div className="Box-root">
                            <div>
                                <div className="Box-root Flex-flex">
                                    <div className="Box-root Flex-flex">
                                        <button
                                            className="bs-Button bs-DeprecatedButton db-UserMenuX"
                                            id="profile-menu"
                                            type="button"
                                            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
                                            tabIndex="-1"
                                            onClick={this.showProfileMenu}
                                        >
                                            <div
                                                className="db-GravatarImage db-UserMenuX-image"
                                                style={{
                                                    backgroundImage: IMG_URL,
                                                }}
                                            />
                                        </button>
                                    </div>
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
TopContent.displayName = 'TopContent';

const mapStateToProps = (state: $TSFixMe) => {
    return {
        notifications: state.notifications.notifications,
    };
};

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators(
    {
        showProfileMenu,
        openNotificationMenu,
        openSideNav,
        getVersion,
        getProbes,
    },
    dispatch
);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TopContent.propTypes = {
    getVersion: PropTypes.func,
    openSideNav: PropTypes.func,
    showProfileMenu: PropTypes.func.isRequired,
    openNotificationMenu: PropTypes.func.isRequired,
    profilePic: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.oneOf([null, undefined]),
    ]),
    notifications: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    length: PropTypes.number,
    map: PropTypes.func,
    getProbes: PropTypes.func.isRequired,
};

// @ts-expect-error ts-migrate(2551) FIXME: Property 'contextTypes' does not exist on type 'ty... Remove this comment to see the full error message
TopContent.contextTypes = {};

export default connect(mapStateToProps, mapDispatchToProps)(TopContent);
