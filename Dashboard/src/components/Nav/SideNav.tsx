import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';
import NavItem from './SideNavItem';
import { allRoutes, groups } from '../../routes';
import { openModal, closeModal } from 'CommonUI/actions/modal';
import { closeSideNav } from '../../actions/page';
import ProjectSwitcher from '../project/ProjectSwitcher';

import ClickOutside from 'react-click-outside';
import {
    showProjectSwitcher,
    hideProjectSwitcher,
    hideForm,
    switchToProjectViewerNav,
} from '../../actions/project';
import { API_URL, User } from '../../config';
import { getSubProjects } from '../../actions/subProject';

import { Route, Switch, withRouter } from 'react-router-dom';
import isSubProjectViewer from '../../utils/isSubProjectViewer';

interface SideNavProps {
    project: object;
    hideProjectSwitcher: Function;
    showProjectSwitcher: Function;
    hideForm: Function;
    closeSideNav?: Function;
    sidenavopen?: boolean;
    allIndividualComponents?: unknown[];
    location?: object;
    match?: object;
    profilePic?: string;
    userName?: string;
    animateSidebar?: boolean;
    currentProject?: object;
    subProjects?: unknown[];
    switchToProjectViewerNav?: boolean;
    switchToProjectViewer?: Function;
    getSubProjects?: Function;
    activeProject?: object;
}

class SideNav extends Component<ComponentProps> {
    showProfileMenu: $TSFixMe;
    state = { navLoading: false };
    override componentDidMount() {

        if (this.props.currentProject) {

            this.props.switchToProjectViewer(
                User.getUserId(),

                this.props.subProjects,

                this.props.currentProject
            );
            this.updateNavLoading('projectShow');
        } else {
            this.updateNavLoading('noProjectShow');
        }
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            JSON.stringify(prevProps.currentProject) !==

            JSON.stringify(this.props.currentProject)
        ) {

            this.props.currentProject &&
                this.props

                    .getSubProjects(this.props.currentProject._id)
                    .then((res: ExpressResponse) => {

                        this.props.switchToProjectViewer(
                            User.getUserId(),
                            res.data.data,

                            this.props.currentProject
                        );
                        this.updateNavLoading('projectShow');
                    });
        }
    }
    updateNavLoading = (option: $TSFixMe) => this.setState({ navLoading: option });

    hideSwitcher = () => {

        if (this.props.project.projectSwitcherVisible) {

            this.props.hideProjectSwitcher();
        }
    };

    showSwitcher = () => {

        if (!this.props.project.projectSwitcherVisible) {

            this.props.showProjectSwitcher();
        }
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                this.hideSwitcher();

                this.props.hideForm();
                return true;
            default:
                return false;
        }
    };

    renderAccountSwitcher = () => (
        <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">

            <div tabIndex="-1">
                <div
                    id="AccountSwitcherId"
                    className="db-AccountSwitcherX-button Box-root Flex-flex Flex-alignItems--center"
                    onClick={this.showSwitcher}
                >
                    <ClickOutside onClickOutside={this.hideSwitcher}>
                        <ProjectSwitcher

                            visible={this.props.project.projectSwitcherVisible}
                        />
                    </ClickOutside>

                    <div className="Box-root Margin-right--8">
                        <div className="db-AccountSwitcherX-activeImage">
                            <div className="db-AccountSwitcherX-accountImage Box-root Box-background--white">
                                <div className="db-AccountSwitcherX-accountImage--content db-AccountSwitcherX-accountImage--fallback" />
                            </div>
                        </div>
                    </div>
                    <div
                        style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >

                        {this.props.project.currentProject && (
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--noWrap">

                                {this.props.project.currentProject.name}
                            </span>
                        )}
                    </div>
                    <div className="Box-root Margin-left--8">
                        <div className="db-AccountSwitcherX-chevron" />
                    </div>
                </div>
            </div>
        </div>
    );

    renderUserProfile = () => {
        const IMG_URL =

            this.props.profilePic &&

                this.props.profilePic !== '' &&

                this.props.profilePic !== 'null'

                ? `url(${API_URL}/file/${this.props.profilePic})`
                : 'url(https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y)';

        return (
            <div className="Box-root Flex-flex">
                <button
                    className="bs-Button bs-DeprecatedButton db-UserMenuX"
                    id="profile-menu"
                    type="button"

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
                <span
                    id="userProfileName"
                    style={{
                        height: '25px',
                        lineHeight: '25px',
                        marginLeft: '10px',
                    }}
                >

                    {this.props.userName}
                </span>
            </div>
        );
    };

    override render() {
        const {

            location,

            allIndividualComponents,

            switchToProjectViewerNav,
        } = this.props;
        const switchToComponentDetailNav =
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/monitoring/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/issues/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/incident-log/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/incidents\/([A-Za-z0-9-]+)/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/application-log/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/performance-tracker/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/security\/container/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/security\/application/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/security/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/error-tracker/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/performance-tracker/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/settings\/basic/
            ) ||
            location.pathname.match(
                /project\/([A-Za-z0-9-]+)\/component\/([A-Za-z0-9-]+)\/settings\/advanced/
            );
        const switchToProfileNav =
            location.pathname.match(/profile\/settings/) ||
            location.pathname.match(/profile\/changePassword/) ||
            location.pathname.match(/profile\/billing/) ||
            location.pathname.match(/profile\/advanced/);

        let groupsToRender: $TSFixMe = [];

        const user = User.getUserId();

        const isViewer = isSubProjectViewer(user, this.props.activeProject);

        if ((switchToProjectViewerNav || isViewer) && !switchToProfileNav) {
            groupsToRender = groups
                .filter(group => group.visibleForProjectViewer)
                .filter(group => group.visible);
        } else if (switchToComponentDetailNav) {
            groupsToRender = groups
                .filter(group => group.visibleOnComponentDetail)
                .filter(group => group.visible)
                .map(group => {

                    group.routes = group.routes.filter((route: $TSFixMe) => route.visible);
                    return group;
                });
        } else if (switchToProfileNav) {
            groupsToRender = groups
                .filter(group => group.visibleOnProfile)
                .filter(group => group.visible)
                .map(group => {

                    group.routes = group.routes.filter((route: $TSFixMe) => {
                        if (
                            route.title === 'Back to Dashboard' &&
                            switchToProjectViewerNav
                        ) {
                            route.path =
                                '/dashboard/project/:slug/StatusPages';
                        }
                        if (
                            route.title === 'Back to Dashboard' &&

                            !this.props.currentProject
                        ) {
                            route.path = '/dashboard/project/project';
                        }
                        return (
                            route.visible &&
                            route.title !== 'Team Member Profile'
                        );
                    });
                    return group;
                });
        } else {

            if (this.state.navLoading === 'projectShow') {
                groupsToRender = groups

                    .filter(group => !group.isPublic)
                    .filter(group => !group.visibleOnComponentDetail)
                    .filter(group => !group.visibleOnProfile)
                    .filter(group => group.visible)
                    .filter(group => !group.visibleForProjectViewer);
            }
        }

        const { componentSlug } = this.props.match.params;
        const selectedComponent = allIndividualComponents.find(
            (component: $TSFixMe) => component.slug === componentSlug
        );

        return (

            <ClickOutside onClickOutside={this.props.closeSideNav}>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className={`db-World-sideNavContainer${this.props.sidenavopen ? ' open' : ''
                        }`}
                >
                    <div className="db-SideNav-container Box-root Box-background--surface Flex-flex Flex-direction--column Padding-top--20 Padding-right--2">
                        <div className="Box-root Margin-bottom--20">
                            <div>
                                {switchToProfileNav
                                    ? this.renderUserProfile()
                                    : this.renderAccountSwitcher()}
                            </div>
                        </div>

                        <div
                            className={`db-SideNav-navSections Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStaIt ${this.props.animateSidebar
                                ? ' animate-in'
                                : ' animate-out'
                                }`}
                        >

                            {(this.state.navLoading === 'projectShow' ||

                                this.state.navLoading === 'noProjectShow') &&

                                groupsToRender.map((group, index, array) => {
                                    const marginClass =
                                        index === array.length - 1
                                            ? 'Box-root '
                                            : 'Box-root Margin-bottom--16';
                                    return (
                                        <div
                                            key={group.group}
                                            className={marginClass}
                                        >
                                            <ul>
                                                {switchToComponentDetailNav && (
                                                    <div
                                                        style={{
                                                            position:
                                                                'relative',
                                                            marginBottom:
                                                                '16px',
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                outline: 'none',
                                                            }}
                                                        >
                                                            <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--4">
                                                                <div className="Box-root Flex-flex Flex-alignItems--center">
                                                                    <span
                                                                        className={
                                                                            'Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap Text-color--dark'
                                                                        }
                                                                    >
                                                                        <span
                                                                            id={`text`}
                                                                            style={{
                                                                                fontSize:
                                                                                    '13px',
                                                                                fontWeight:
                                                                                    'bold',
                                                                                color:
                                                                                    'white',
                                                                                background:
                                                                                    'rgb(0, 0, 0)',
                                                                                padding:
                                                                                    '8px',
                                                                                borderRadius:
                                                                                    '5px',
                                                                                paddingTop:
                                                                                    '4px',
                                                                                paddingBottom:
                                                                                    '4px',
                                                                            }}
                                                                        >
                                                                            Component
                                                                            {': ' +
                                                                                (selectedComponent
                                                                                    ? selectedComponent.name
                                                                                    : '')}
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {group.routes.map(
                                                    (route: $TSFixMe, index: $TSFixMe) => {
                                                        return (
                                                            <li key={index}>
                                                                <NavItem
                                                                    route={
                                                                        route
                                                                    }
                                                                />
                                                            </li>
                                                        );
                                                    }
                                                )}
                                            </ul>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>
                </div>
            </ClickOutside>
        );
    }
}


SideNav.displayName = 'SideNav';

const mapStateToProps = function (state: RootState) {
    const allIndividualComponents = state.component.componentList.components.reduce(
        (acc: $TSFixMe, curr: $TSFixMe) => acc.concat(curr.components || []),
        []
    );
    const settings = state.profileSettings.profileSetting.data;
    const profilePic = settings ? settings.profilePic : '';
    const userName = settings ? settings.name : '';

    const currentProject = state.project.currentProject;
    const subProjects = state.subProject.subProjects.subProjects;
    const activesubProjectId = state.subProject.activeSubProject;
    const allProjects = [...subProjects];
    if (currentProject) {
        allProjects.push(currentProject);
    }

    const activeProject = allProjects.find(
        project => String(project._id) === String(activesubProjectId)
    );

    return {
        allIndividualComponents,
        project: state.project,
        sidenavopen: state.page.sidenavopen,
        profilePic,
        userName,
        animateSidebar: state.animateSidebar.animateSidebar,
        currentProject: state.project.currentProject,
        subProjects: state.subProject.subProjects.subProjects,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activesubProjectId: state.subProject.activeSubProject,
        activeProject,
    };
};

const mapDispatchToProps = function (dispatch: Dispatch) {
    return bindActionCreators(
        {
            openModal,
            closeModal,
            showProjectSwitcher,
            hideProjectSwitcher,
            hideForm,
            closeSideNav,
            switchToProjectViewer: switchToProjectViewerNav,
            getSubProjects,
        },
        dispatch
    );
};


SideNav.propTypes = {
    project: PropTypes.object.isRequired,
    hideProjectSwitcher: PropTypes.func.isRequired,
    showProjectSwitcher: PropTypes.func.isRequired,
    hideForm: PropTypes.func.isRequired,
    closeSideNav: PropTypes.func,
    sidenavopen: PropTypes.bool,
    allIndividualComponents: PropTypes.array,
    location: PropTypes.object,
    match: PropTypes.object,
    profilePic: PropTypes.string,
    userName: PropTypes.string,
    animateSidebar: PropTypes.bool,
    currentProject: PropTypes.object,
    subProjects: PropTypes.array,
    switchToProjectViewerNav: PropTypes.bool,
    switchToProjectViewer: PropTypes.func,
    getSubProjects: PropTypes.func,
    activeProject: PropTypes.object,
};

interface WrappedSideNavProps {
    currentProject?: object;
    activesubProjectId?: string;
}

// since sideNav is above page routes we have no access to the pages' props.match,
// we rebuild the routes here to enable access to these properties

const WrappedSideNav: Function = (props: WrappedSideNavProps) => {
    const hideProjectNav =
        props.currentProject?._id !== props.activesubProjectId;

    const titleToExclude = [
        'Project Settings',
        'Resources',
        'Billing',
        'Integrations',
        'API',
        'Advanced',
        'More',
        'Domains',
        'Monitor',
        'Incident Settings',
        'Email',
        'SMS & Calls',
        'Call Routing',
        'Webhooks',
        'Probe',
        'Git Credentials',
        'Docker Credentials',
        'Team Groups',
    ];

    let sortedRoutes = [...allRoutes];
    if (hideProjectNav) {
        sortedRoutes = sortedRoutes.filter(
            router =>
                !titleToExclude.includes(router.title) ||
                router.path ===
                '/dashboard/project/:slug/component/:componentSlug/settings/advanced'
        );
    }

    return (
        <Switch>
            {sortedRoutes
                .filter(route => route.visible)
                .map((route, index) => {
                    return (
                        <Route

                            exact={route.exact}
                            path={route.path}
                            key={index}
                            render={(routeProps: $TSFixMe) => <SideNav {...props} {...routeProps} />}
                        />
                    );
                })}
        </Switch>
    );
};

WrappedSideNav.propTypes = {
    currentProject: PropTypes.object,
    activesubProjectId: PropTypes.string,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(WrappedSideNav)
);
