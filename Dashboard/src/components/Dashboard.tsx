import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import SideNav from './nav/SideNav';
import TopNav from './nav/TopNav';
import { getProjects } from '../actions/project';
import CreateProjectModal from './project/CreateProjectModal';
import UpgradePlanModal from './project/UpgradePlanModal';
import DeleteProjectModal from './project/DeleteProjectModal';

import { withRouter } from 'react-router-dom';
import ShouldRender from './basic/ShouldRender';
import ProfileMenu from './profile/ProfileMenu';
import { showForm } from '../actions/project';

import ClickOutside from 'react-click-outside';
import { hideProfileMenu } from '../actions/profile';
import NotificationMenu from './notification/NotificationMenu';
import { closeNotificationMenu } from '../actions/notification';
import UnVerifiedEmailBox from '../components/auth/UnVerifiedEmail';

import { User } from '../config';
import BreadCrumbItem from './breadCrumb/BreadCrumbItem';
import BreadCrumbs from './breadCrumb/BreadCrumbs';
import IncidentCreated from './incident/IncidentCreated';
import { closeModal } from '../actions/modal';
import LoadingBar from 'react-top-loading-bar';

interface DashboardAppProps {
    project: object;
    profile: object;
    notification: object;
    getProjects?: Function;
    hideProfileMenu?: Function;
    closeNotificationMenu?: Function;
    showForm?: Function;
    location: object;
    children?: any;
    projectId?: string;
    currentModal?: object;
    closeModal?: Function;
    pageName?: string;
}

export class DashboardApp extends Component<DashboardAppProps>{
    public static displayName = '';
    public static propTypes = {};
    // eslint-disable-next-line
    constructor(props: $TSFixMe) {
        super(props);
        this.state = { progress: 10 };
    }

    override componentDidMount() {

        const { project, getProjects }: $TSFixMe = this.props;

        this.setState({ progress: 100 });

        if (
            project.projects &&
            project.projects.projects &&
            project.projects.projects.length === 0 &&
            !project.projects.requesting
        ) {

            getProjects(this.props.projectId || null);
        }
    }

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
                this.closeModal();
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

            location,

            project,
            children,

            project: { currentProject },

            notification: {
                notifications: { notifications },
            },
        } = this.props;
        const projectId: $TSFixMe = currentProject ? currentProject._id : '';
        const incidentNotifications: $TSFixMe = notifications.filter(
            (notification: $TSFixMe) => notification.read.length === 0 &&
                notification.meta &&
                notification.meta.type === 'Incident' &&
                !notification.closed.includes(User.getUserId())
        );

        const userProfile: $TSFixMe =
            location.pathname === '/dashboard/profile/billing' ||
            location.pathname === '/dashboard/profile/settings' ||
            location.pathname === '/dashboard/profile/changePassword' ||
            location.pathname === '/dashboard/profile/advanced';

        const profileFunc: Function = () => {
            let val;
            if (location.pathname === '/dashboard/profile/billing') {
                const path: $TSFixMe = location.pathname.split('/');
                val = {
                    route: path[path.length - 1],
                    name: 'Billing',
                };
            } else if (location.pathname === '/dashboard/profile/settings') {
                const path: $TSFixMe = location.pathname.split('/');
                val = {
                    route: path[path.length - 1],
                    name: 'Profile Settings',
                };
            } else if (
                location.pathname === '/dashboard/profile/changePassword'
            ) {
                const path: $TSFixMe = location.pathname.split('/');
                val = {
                    route: path[path.length - 1],
                    name: 'Change Password',
                };
            } else if (location.pathname === '/dashboard/profile/advanced') {
                const path: $TSFixMe = location.pathname.split('/');
                val = {
                    route: path[path.length - 1],
                    name: 'Advanced',
                };
            }
            return val;
        };

        // forcing children to re-render on dashboard redraw
        // when projectId is changed/switched in user profile pages
        // * usually children components are unmounted/remounted when project is switched
        const childrenWithProps = React.Children.map(children, child: $TSFixMe => {
            // Checking isValidElement to ensure child is an element
            if (React.isValidElement(child)) {
                return React.cloneElement(child, { key: projectId });
            }
            return child;
        });

        return (
            <Fragment>

                <LoadingBar color="#000000" progress={this.state.progress} />
                {userProfile && (
                    <BreadCrumbItem

                        route={profileFunc().route}

                        name={profileFunc().name}
                    />
                )}
                <CreateProjectModal />

                <UpgradePlanModal />

                <DeleteProjectModal />

                <ClickOutside onClickOutside={this.hideProfileMenu}>

                    <ProfileMenu visible={this.props.profile.menuVisible} />
                </ClickOutside>
                <ClickOutside onClickOutside={this.closeNotificationMenu}>
                    <NotificationMenu

                        visible={this.props.notification.notificationsVisible}
                    />
                </ClickOutside>

                <div onKeyDown={this.handleKeyBoard} className="db-World-root">
                    <div className="db-World-wrapper Box-root Flex-flex Flex-direction--column">
                        <ShouldRender if={userProfile}>
                            <div className="db-World-scrollWrapper">
                                <SideNav />

                                <div className="db-World-mainPane Box-root Margin-top--60 Padding-right--20">
                                    <div className="db-World-contentPane Box-root Padding-bottom--48">
                                        {childrenWithProps}
                                    </div>
                                </div>

                                <TopNav projectId={projectId} />
                            </div>
                        </ShouldRender>

                        <ShouldRender
                            if={
                                !project.projects.requesting &&
                                project.projects.success &&
                                !userProfile
                            }
                        >
                            <div className="db-World-scrollWrapper">
                                <ShouldRender
                                    if={
                                        project.projects.projects !==
                                        undefined &&
                                        project.projects.projects[0]
                                    }
                                >
                                    <SideNav />

                                    <div className="db-World-mainPane Box-root Margin-top--60">
                                        <div className="db-World-contentPane Box-root Padding-bottom--48">
                                            <BreadCrumbs
                                                styles="breadCrumbContainer Card-shadow--medium db-mb"

                                                name={this.props.pageName}
                                            />
                                            <ShouldRender
                                                if={

                                                    this.props.profile
                                                        .profileSetting.data &&

                                                    this.props.profile
                                                        .profileSetting.data
                                                        .email &&

                                                    !this.props.profile
                                                        .profileSetting.data
                                                        .isVerified
                                                }
                                            >
                                                <UnVerifiedEmailBox />
                                            </ShouldRender>
                                            {childrenWithProps}
                                        </div>
                                    </div>
                                </ShouldRender>

                                <TopNav projectId={projectId} />
                            </div>
                        </ShouldRender>

                        <ShouldRender if={project.projects.requesting}>
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

                        <ShouldRender if={project.projects.error}>
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
                                    textAlign: 'center',
                                    padding: '0 10px',
                                }}
                            >
                                <div>Cannot connect to server.</div>
                            </div>
                        </ShouldRender>

                        <ShouldRender
                            if={
                                project.projects.success &&
                                project.projects.projects.length === 0 &&
                                !userProfile
                            }
                        >
                            <div>
                                <div
                                    id="app-loading"
                                    style={{
                                        position: 'fixed',
                                        top: '0',
                                        bottom: '0',
                                        left: '0',
                                        right: '0',
                                        zIndex: '1',
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                        fontSize: '20px',
                                        flexDirection: 'column',
                                        textAlign: 'center',
                                        padding: '0 10px',
                                    }}
                                >
                                    <div>
                                        You don&#39;t have any projects. Would
                                        you like to create one?
                                    </div>
                                    <div>
                                        <button
                                            id="createButton"
                                            className={
                                                'bs-Button bs-DeprecatedButton bs-Button--blue'
                                            }
                                            style={{
                                                alignSelf: 'flex-end',
                                                marginTop: '20px',
                                            }}
                                            onClick={this.showProjectForm}
                                        >
                                            <span>Create Project</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </ShouldRender>
                    </div>
                </div>
                <ShouldRender
                    if={
                        incidentNotifications &&
                        incidentNotifications.length > 0
                    }
                >
                    <IncidentCreated

                        notifications={incidentNotifications}
                        slug={currentProject ? currentProject.slug : null}
                    />
                </ShouldRender>
            </Fragment>
        );
    }
}


DashboardApp.displayName = 'DashboardApp';


DashboardApp.propTypes = {
    project: PropTypes.object.isRequired,
    profile: PropTypes.object.isRequired,
    notification: PropTypes.object.isRequired,
    getProjects: PropTypes.func,
    hideProfileMenu: PropTypes.func,
    closeNotificationMenu: PropTypes.func,
    showForm: PropTypes.func,
    location: PropTypes.object.isRequired,
    children: PropTypes.any,
    projectId: PropTypes.string,
    currentModal: PropTypes.object,
    closeModal: PropTypes.func,
    pageName: PropTypes.string,
};

const mapStateToProps: Function = (state: RootState) => ({
    project: state.project,
    profile: state.profileSettings,
    projectId: state.project.currentProject && state.project.currentProject._id,
    notification: state.notifications,

    currentModal:
        state.modal.modals && state.modal.modals.length > 0
            ? state.modal.modals[state.modal.modals.length - 1]
            : null,

    switchToProjectViewerNav: state.project.switchToProjectViewerNav,
    pageName: state.page.title
});

const mapDispatchToProps: Function = (dispatch: Dispatch) => bindActionCreators(
    {
        getProjects,
        showForm,
        hideProfileMenu,
        closeNotificationMenu,
        closeModal,
    },
    dispatch
);

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(DashboardApp)
);
