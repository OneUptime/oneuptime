import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import SideNav from './nav/SideNav';
import TopNav from './nav/TopNav';

import { Link, withRouter } from 'react-router-dom';
import ShouldRender from './basic/ShouldRender';
import ProfileMenu from './profile/ProfileMenu';

import ClickOutside from 'react-click-outside';
import { hideProfileMenu } from '../actions/profile';
import NotificationMenu from './notification/NotificationMenu';
import { closeNotificationMenu } from '../actions/notification';
import { fetchUsers } from '../actions/user';
import UnLicensedAlert from './license/UnLicensedAlert';
import { fetchLicense } from '../actions/license';
import { IS_SAAS_SERVICE, IS_THIRD_PARTY_BILLING } from '../config';
import { fetchSettings } from '../actions/settings';
import AlertPanel from './basic/AlertPanel';
import { closeModal } from '../actions/Modal';
import { loadDashboard } from '../actions/dashboard';

export class DashboardApp extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    componentDidMount = async () => {
        const {

            fetchLicense,

            user,

            license,

            fetchSettings,

            loadDashboard,
        } = this.props;
        if (
            user.users &&
            user.users.users &&
            user.users.users.length === 0 &&
            !user.users.requesting
        ) {
            await loadDashboard();
        }

        if (
            !IS_THIRD_PARTY_BILLING &&
            !license.data &&
            !license.requesting &&
            !license.error
        ) {
            fetchLicense();
        }
        fetchSettings('twilio');
        fetchSettings('smtp');
    };

    showProjectForm = () => {

        this.props.showForm();
    };

    hideProfileMenu = () => {

        this.props.hideProfileMenu();
    };
    closeNotificationMenu = () => {

        this.props.closeNotificationMenu();
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':

                this.props.closeNotificationMenu();

                this.props.hideProfileMenu();
                return true;
            default:
                return false;
        }
    };

    closeModal = () =>

        this.props.closeModal({

            id: this.props.currentModal ? this.props.currentModal.id : '',
        });

    override render() {
        const {
            children,

            license,

            settings,

            twilio,

            smtp,

            dashboardLoadState,
        } = this.props;

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
                        if={
                            !dashboardLoadState.requesting &&
                            dashboardLoadState.success
                        }
                    >
                        <div className="db-World-wrapper Box-root Flex-flex Flex-direction--column">
                            <div className="db-World-scrollWrapper">
                                <SideNav />

                                <div className="db-World-mainPane Box-root Padding-right--20">
                                    <div className="db-World-contentPane Box-root Padding-bottom--48">
                                        <ShouldRender
                                            if={
                                                !IS_THIRD_PARTY_BILLING &&
                                                !IS_SAAS_SERVICE &&
                                                !license.requesting &&
                                                !license.data
                                            }
                                        >
                                            <UnLicensedAlert />
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                !settings.requesting &&
                                                Object.keys(smtp).length === 1
                                            }
                                        >
                                            <AlertPanel

                                                className="bs-ContentSection Card-root"
                                                message={
                                                    <span>
                                                        SMTP Settings are not
                                                        configured. To send
                                                        Email alerts you need to
                                                        configure these
                                                        settings. Please click{' '}
                                                        <Link
                                                            className="Border-bottom--white Text-fontWeight--bold Text-color--white"
                                                            to="/admin/settings/smtp"
                                                        >
                                                            here
                                                        </Link>{' '}
                                                        to configure them.
                                                    </span>
                                                }
                                            />
                                        </ShouldRender>
                                        <ShouldRender
                                            if={
                                                !settings.requesting &&
                                                Object.keys(twilio).length === 1
                                            }
                                        >
                                            <AlertPanel

                                                className="bs-ContentSection Card-root"
                                                message={
                                                    <span>
                                                        Twilio Settings are not
                                                        configured. To send call
                                                        and SMS alerts you need
                                                        to configure these
                                                        settings. Please click{' '}
                                                        <a
                                                            className="Border-bottom--white Text-fontWeight--bold Text-color--white"
                                                            href="/admin/settings/twilio"
                                                        >
                                                            here
                                                        </a>{' '}
                                                        to configure them.
                                                    </span>
                                                }
                                            />
                                        </ShouldRender>
                                        {children}
                                    </div>
                                </div>

                                <TopNav />
                            </div>
                        </div>
                    </ShouldRender>

                    <ShouldRender if={dashboardLoadState.requesting}>
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

                    <ShouldRender if={dashboardLoadState.error}>
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
    fetchLicense: PropTypes.func.isRequired,
    children: PropTypes.any,
    user: PropTypes.object.isRequired,
    license: PropTypes.object,
    fetchSettings: PropTypes.func.isRequired,
    settings: PropTypes.object.isRequired,
    twilio: PropTypes.object.isRequired,
    smtp: PropTypes.object.isRequired,
    currentModal: PropTypes.object,
    closeModal: PropTypes.func,
    dashboardLoadState: PropTypes.object,
    loadDashboard: PropTypes.func,
};

const mapStateToProps: Function = (state: RootState) => ({
    profile: state.profileSettings,
    notification: state.notifications,
    user: state.user,
    license: state.license.license,
    settings: state.settings,
    twilio: state.settings.twilio,
    smtp: state.settings.smtp,

    currentModal:
        state.modal.modals && state.modal.modals.length > 0
            ? state.modal.modals[state.modal.modals.length - 1]
            : '',

    dashboardLoadState: state.dashboard
});

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        hideProfileMenu,
        closeNotificationMenu,
        fetchUsers,
        fetchLicense,
        fetchSettings,
        closeModal,
        loadDashboard,
    },
    dispatch
);


DashboardApp.contextTypes = {};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(DashboardApp)
);
