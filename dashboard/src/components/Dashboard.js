import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types'
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import SideNav from './nav/SideNav';
import TopNav from './nav/TopNav';
import { getProjects } from '../actions/project';
import CreateProjectModal from './project/CreateProjectModal';
import UpgradePlanModal from './project/UpgradePlanModal'
import DeleteProjectModal from './project/DeleteProjectModal';
import { withRouter } from 'react-router';
import ShouldRender from './basic/ShouldRender';
import ProfileMenu from './profile/ProfileMenu';
import { showForm } from '../actions/project';
import ClickOutside from 'react-click-outside';
import { hideProfileMenu } from '../actions/profile';
import NotificationMenu from './notification/NotificationMenu';
import { closeNotificationMenu } from '../actions/notification';
import UnVerifiedEmailBox from '../components/auth/UnVerifiedEmail';
import { logEvent } from '../analytics';
import { IS_DEV } from '../config';

export class DashboardApp extends Component {
    // eslint-disable-next-line
    constructor(props) {
        super(props);
    }

    componentDidUpdate(prevProps) {

        const { project: { currentProject }, ready } = this.props;

        if (prevProps.project.currentProject && prevProps.project.currentProject._id && currentProject && currentProject._id) {
            if (prevProps.project.currentProject._id !== currentProject._id) {
                ready && ready();
            }
        }
    }

    componentDidMount() {

        const { project, match, ready, getProjects } = this.props;

        if (project.projects && project.projects.projects && project.projects.projects.length === 0 && !project.projects.requesting) {
            getProjects(match.params.projectId || null).then(() => {
                ready && ready()
            });
        } else {
            ready && ready();
        }
    }

    showProjectForm = () => {
        this.props.showForm();
        if (!IS_DEV) {
            logEvent('Project Form Opened');
        }
    }

    hideProfileMenu = () => {
        this.props.hideProfileMenu();
        if (!IS_DEV) {
            logEvent('Profile Menu Closed');
        }
    }
    closeNotificationMenu = () => {
        this.props.closeNotificationMenu();
        if (!IS_DEV) {
            logEvent('Notification Menu Closed');
        }
    }

    handleKeyBoard = (e) => {
        switch (e.key) {
            case 'Escape':
                this.props.closeNotificationMenu();
                this.props.hideProfileMenu();
                return true;
            default:
                return false;
        }
    }

    render() {
        const { location, project, children } = this.props

        return (
            <Fragment>

                <CreateProjectModal />

                <UpgradePlanModal />

                <DeleteProjectModal />

                <ClickOutside onClickOutside={this.hideProfileMenu}>
                    <ProfileMenu visible={this.props.profile.menuVisible} />
                </ClickOutside>
                <ClickOutside onClickOutside={this.closeNotificationMenu}>
                    <NotificationMenu visible={this.props.notification.notificationsVisible} />
                </ClickOutside>

                <div onKeyDown={this.handleKeyBoard} className="db-World-root" >

                    <div className="db-World-wrapper Box-root Flex-flex Flex-direction--column">
                        <ShouldRender if={location.pathname === '/profile/settings'}>
                            <div className="db-World-scrollWrapper" >


                                <ShouldRender if={project.projects.projects !== undefined && project.projects.projects[0]}>

                                    <SideNav />

                                </ShouldRender>

                                <div className="db-World-mainPane Box-root Padding-right--20" >

                                    {children}

                                </div>

                                <TopNav />

                            </div>

                        </ShouldRender>

                        <ShouldRender if={!project.projects.requesting && project.projects.success && location.pathname !== '/profile/settings'}>
                            <div className="db-World-scrollWrapper" >

                                <ShouldRender if={project.projects.projects !== undefined && project.projects.projects[0]}>

                                    <SideNav />

                                    <div className="db-World-mainPane Box-root Padding-right--20" >
                                        <div className="db-World-contentPane Box-root Padding-bottom--48">
                                            <ShouldRender if={this.props.profile.profileSetting.data && this.props.profile.profileSetting.data.email && !this.props.profile.profileSetting.data.isVerified}>
                                                <UnVerifiedEmailBox />
                                            </ShouldRender>
                                            {children}
                                        </div>
                                    </div>

                                </ShouldRender>

                                <TopNav />


                            </div>
                        </ShouldRender>

                        <ShouldRender if={project.projects.requesting}>
                            <div id="app-loading" style={{ 'position': 'fixed', 'top': '0', 'bottom': '0', 'left': '0', 'right': '0', 'zIndex': '999', 'display': 'flex', 'justifyContent': 'center', 'alignItems': 'center' }}>
                                <div style={{ 'transform': 'scale(2)' }}>
                                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="bs-Spinner-svg">
                                        <ellipse cx="12" cy="12" rx="10" ry="10" className="bs-Spinner-ellipse"></ellipse>
                                    </svg>
                                </div>
                            </div>
                        </ShouldRender>

                        <ShouldRender if={project.projects.error}>
                            <div id="app-loading" style={{
                                'backgroundColor': '#E6EBF1',
                                'position': 'fixed',
                                'top': '0',
                                'bottom': '0',
                                'left': '0',
                                'right': '0',
                                'zIndex': '999',
                                'display': 'flex',
                                'justifyContent': 'center',
                                'alignItems': 'center',
                                'textAlign': 'center',
                                'padding': '0 10px'
                            }}>
                                <div>Cannot connect to server.</div>
                            </div>
                        </ShouldRender>

                        <ShouldRender if={project.projects.success && project.projects.projects.length === 0 && location.pathname !== '/profile/settings'}>

                            <div>

                                <div id="app-loading" style={{
                                    'position': 'fixed',
                                    'top': '0',
                                    'bottom': '0',
                                    'left': '0',
                                    'right': '0',
                                    'zIndex': '1',
                                    'display': 'flex',
                                    'justifyContent': 'center',
                                    'alignItems': 'center',
                                    'fontSize': '20px',
                                    'flexDirection': 'column',
                                    'textAlign': 'center',
                                    'padding': '0 10px'
                                }}>
                                    <div>You don&#39;t have any projects. Would you like to create one?</div>
                                    <div>
                                        <button id="createButton" className={'bs-Button bs-DeprecatedButton bs-Button--blue'} style={{ alignSelf: 'flex-end', marginTop: '20px' }} onClick={this.showProjectForm}>
                                            <span>Create Project</span>
                                        </button>
                                    </div>
                                </div>

                            </div>
                        </ShouldRender>


                    </div>
                </div>

            </Fragment>
        )
    }
}

DashboardApp.displayName = 'DashboardApp'

DashboardApp.propTypes = {
    project: PropTypes.object.isRequired,
    profile: PropTypes.object.isRequired,
    notification: PropTypes.object.isRequired,
    match: PropTypes.object,
    getProjects: PropTypes.func,
    hideProfileMenu: PropTypes.func,
    closeNotificationMenu: PropTypes.func,
    showForm: PropTypes.func,
    location: PropTypes.object.isRequired,
    children: PropTypes.any,
    ready: PropTypes.func
}

const mapStateToProps = state => ({
    project: state.project,
    profile: state.profileSettings,
    notification: state.notifications
})

const mapDispatchToProps = dispatch => (
    bindActionCreators({
        getProjects,
        showForm,
        hideProfileMenu,
        closeNotificationMenu
    }, dispatch)
)

export default withRouter(connect(mapStateToProps, mapDispatchToProps)(DashboardApp));
