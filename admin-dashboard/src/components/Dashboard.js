import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import SideNav from './nav/SideNav';
import TopNav from './nav/TopNav';
import { withRouter } from 'react-router';
import ShouldRender from './basic/ShouldRender';
import ProfileMenu from './profile/ProfileMenu';
import ClickOutside from 'react-click-outside';
import { hideProfileMenu } from '../actions/profile';
import NotificationMenu from './notification/NotificationMenu';
import { closeNotificationMenu } from '../actions/notification';
import { fetchUsers } from '../actions/user';
import UnLicensedAlert from './license/UnLicensedAlert';
import { fetchLicense } from '../actions/license';
import { IS_SAAS_SERVICE } from '../config';

export class DashboardApp extends Component {
    componentDidMount() {
        const { fetchUsers, fetchLicense, ready, user, license } = this.props;
        if (
            user.users &&
            user.users.users &&
            user.users.users.length === 0 &&
            !user.users.requesting
        ) {
            fetchUsers().then(() => ready && ready());
        } else {
            this.props.ready && this.props.ready();
        }

        if (!license.data && !license.requesting && !license.error) {
            fetchLicense();
        }
    }

    showProjectForm = () => {
        this.props.showForm();
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Project Form Opened');
        }
    };

    hideProfileMenu = () => {
        this.props.hideProfileMenu();
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Profile Menu Closed');
        }
    };
    closeNotificationMenu = () => {
        this.props.closeNotificationMenu();
        if (window.location.href.indexOf('localhost') <= -1) {
            this.context.mixpanel.track('Notification Menu Closed');
        }
    };

    handleKeyBoard = e => {
        switch (e.key) {
            case 'Escape':
                this.props.closeNotificationMenu();
                this.props.hideProfileMenu();
                return true;
            default:
                return false;
        }
    };

    render() {
        const { user, children, license } = this.props;

        return (
            <Fragment>
                <ClickOutside onClickOutside={this.hideProfileMenu}>
                    <ProfileMenu visible={this.props.profile.menuVisible} />
                </ClickOutside>
                <ClickOutside onClickOutside={this.closeNotificationMenu}>
                    <NotificationMenu
                        visible={this.props.notification.notificationsVisible}
                    />
                </ClickOutside>

                <div onKeyDown={this.handleKeyBoard} className="db-World-root">
                    <ShouldRender
                        if={!user.users.requesting && user.users.success}
                    >
                        <div className="db-World-wrapper Box-root Flex-flex Flex-direction--column">
                            <SideNav />

                            <div className="db-World-mainPane Box-root Padding-right--20">
                                <div className="db-World-contentPane Box-root Padding-bottom--48">
                                    <ShouldRender
                                        if={
                                            !IS_SAAS_SERVICE &&
                                            !license.requesting &&
                                            !license.data
                                        }
                                    >
                                        <UnLicensedAlert />
                                    </ShouldRender>
                                    {children}
                                </div>
                            </div>

                            <TopNav />
                        </div>
                    </ShouldRender>

                    <ShouldRender if={user.users.requesting}>
                        <div
                            id="app-loading"
                            style={{
                                position: 'fixed',
                                top: '0',
                                bottom: '0',
                                left: '0',
                                right: '0',
                                zIndex: '999',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                            }}
                        >
                            <div style={{ transform: 'scale(2)' }}>
                                <svg
                                    viewBox="0 0 24 24"
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="bs-Spinner-svg"
                                >
                                    <ellipse
                                        cx="12"
                                        cy="12"
                                        rx="10"
                                        ry="10"
                                        className="bs-Spinner-ellipse"
                                    ></ellipse>
                                </svg>
                            </div>
                        </div>
                    </ShouldRender>

                    <ShouldRender if={user.users.error}>
                        <div
                            id="app-loading"
                            style={{
                                backgroundColor: '#E6EBF1',
                                position: 'fixed',
                                top: '0',
                                bottom: '0',
                                left: '0',
                                right: '0',
                                zIndex: '999',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                            }}
                        >
                            <div>Cannot connect to server.</div>
                        </div>
                    </ShouldRender>
                </div>
            </Fragment>
        );
    }
}

DashboardApp.displayName = 'DashboardApp';

DashboardApp.propTypes = {
    profile: PropTypes.object.isRequired,
    notification: PropTypes.object.isRequired,
    hideProfileMenu: PropTypes.func,
    closeNotificationMenu: PropTypes.func,
    showForm: PropTypes.func,
    fetchUsers: PropTypes.func,
    fetchLicense: PropTypes.func.isRequired,
    children: PropTypes.any,
    ready: PropTypes.func,
    user: PropTypes.object.isRequired,
    license: PropTypes.oneOfType([null, PropTypes.object]),
};

const mapStateToProps = state => ({
    profile: state.profileSettings,
    notification: state.notifications,
    user: state.user,
    license: state.license.license,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        {
            hideProfileMenu,
            closeNotificationMenu,
            fetchUsers,
            fetchLicense,
        },
        dispatch
    );

DashboardApp.contextTypes = {
    mixpanel: PropTypes.object.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(DashboardApp)
);
