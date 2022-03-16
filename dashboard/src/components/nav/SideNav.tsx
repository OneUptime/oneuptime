import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import NavItem from './SideNavItem';
import { allRoutes, groups } from '../../routes';
import { openModal, closeModal } from '../../actions/modal';
import { closeSideNav } from '../../actions/page';
import ProjectSwitcher from '../project/ProjectSwitcher';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import ClickOutside from 'react-click-outside';
import {
    showProjectSwitcher,
    hideProjectSwitcher,
    hideForm,
    switchToProjectViewerNav,
} from '../../actions/project';
import { API_URL, User } from '../../config';
import { getSubProjects } from '../../actions/subProject';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { Route, Switch, withRouter } from 'react-router-dom';
import isSubProjectViewer from '../../utils/isSubProjectViewer';

class SideNav extends Component {
    showProfileMenu: $TSFixMe;
    state = { navLoading: false };
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        if (this.props.currentProject) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewer' does not exist on... Remove this comment to see the full error message
            this.props.switchToProjectViewer(
                User.getUserId(),
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.subProjects,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            JSON.stringify(this.props.currentProject)
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            this.props.currentProject &&
                this.props
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'getSubProjects' does not exist on type '... Remove this comment to see the full error message
                    .getSubProjects(this.props.currentProject._id)
                    .then((res: Response) => {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewer' does not exist on... Remove this comment to see the full error message
                        this.props.switchToProjectViewer(
                            User.getUserId(),
                            res.data.data,
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                            this.props.currentProject
                        );
                        this.updateNavLoading('projectShow');
                    });
        }
    }
    updateNavLoading = (option: $TSFixMe) => this.setState({ navLoading: option });

    hideSwitcher = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (this.props.project.projectSwitcherVisible) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideProjectSwitcher' does not exist on t... Remove this comment to see the full error message
            this.props.hideProjectSwitcher();
        }
    };

    showSwitcher = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
        if (!this.props.project.projectSwitcherVisible) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'showProjectSwitcher' does not exist on t... Remove this comment to see the full error message
            this.props.showProjectSwitcher();
        }
    };

    handleKeyBoard = (e: $TSFixMe) => {
        switch (e.key) {
            case 'Escape':
                this.hideSwitcher();
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'hideForm' does not exist on type 'Readon... Remove this comment to see the full error message
                this.props.hideForm();
                return true;
            default:
                return false;
        }
    };

    renderAccountSwitcher = () => (
        <div className="Box-root Flex-flex Flex-alignItems--center Flex-justifyContent--spaceBetween">
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
            <div tabIndex="-1">
                <div
                    id="AccountSwitcherId"
                    className="db-AccountSwitcherX-button Box-root Flex-flex Flex-alignItems--center"
                    onClick={this.showSwitcher}
                >
                    <ClickOutside onClickOutside={this.hideSwitcher}>
                        <ProjectSwitcher
                            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ visible: any; }' is not assignable to type... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
                        {this.props.project.currentProject && (
                            <span className="Text-color--inherit Text-display--inline Text-fontSize--16 Text-fontWeight--medium Text-lineHeight--24 Text-typeface--base Text-wrap--noWrap">
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Readonl... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
            this.props.profilePic &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.profilePic !== '' &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
                this.props.profilePic !== 'null'
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'profilePic' does not exist on type 'Read... Remove this comment to see the full error message
                ? `url(${API_URL}/file/${this.props.profilePic})`
                : 'url(https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y)';

        return (
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
                <span
                    id="userProfileName"
                    style={{
                        height: '25px',
                        lineHeight: '25px',
                        marginLeft: '10px',
                    }}
                >
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'userName' does not exist on type 'Readon... Remove this comment to see the full error message
                    {this.props.userName}
                </span>
            </div>
        );
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'allIndividualComponents' does not exist ... Remove this comment to see the full error message
            allIndividualComponents,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProject' does not exist on type 'R... Remove this comment to see the full error message
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
                    // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
                    group.routes = group.routes.filter((route: $TSFixMe) => route.visible);
                    return group;
                });
        } else if (switchToProfileNav) {
            groupsToRender = groups
                .filter(group => group.visibleOnProfile)
                .filter(group => group.visible)
                .map(group => {
                    // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
                    group.routes = group.routes.filter((route: $TSFixMe) => {
                        if (
                            route.title === 'Back to Dashboard' &&
                            switchToProjectViewerNav
                        ) {
                            route.path =
                                '/dashboard/project/:slug/status-pages';
                        }
                        if (
                            route.title === 'Back to Dashboard' &&
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2367) FIXME: This condition will always return 'false' since th... Remove this comment to see the full error message
            if (this.state.navLoading === 'projectShow') {
                groupsToRender = groups
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'isPublic' does not exist on type '{ grou... Remove this comment to see the full error message
                    .filter(group => !group.isPublic)
                    .filter(group => !group.visibleOnComponentDetail)
                    .filter(group => !group.visibleOnProfile)
                    .filter(group => group.visible)
                    .filter(group => !group.visibleForProjectViewer);
            }
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { componentSlug } = this.props.match.params;
        const selectedComponent = allIndividualComponents.find(
            (component: $TSFixMe) => component.slug === componentSlug
        );

        return (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'closeSideNav' does not exist on type 'Re... Remove this comment to see the full error message
            <ClickOutside onClickOutside={this.props.closeSideNav}>
                <div
                    onKeyDown={this.handleKeyBoard}
                    className={`db-World-sideNavContainer${
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'sidenavopen' does not exist on type 'Rea... Remove this comment to see the full error message
                        this.props.sidenavopen ? ' open' : ''
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
                            className={`db-SideNav-navSections Box-root Flex-flex Flex-alignItems--stretch Flex-direction--column Flex-justifyContent--flexStaIt ${
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'animateSidebar' does not exist on type '... Remove this comment to see the full error message
                                this.props.animateSidebar
                                    ? ' animate-in'
                                    : ' animate-out'
                                }`}
                        >
                            // @ts-expect-error ts-migrate(2367) FIXME: This condition will always return 'false' since th... Remove this comment to see the full error message
                            {(this.state.navLoading === 'projectShow' ||
                                // @ts-expect-error ts-migrate(2367) FIXME: This condition will always return 'false' since th... Remove this comment to see the full error message
                                this.state.navLoading === 'noProjectShow') &&
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'group' implicitly has an 'any' type.
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
SideNav.displayName = 'SideNav';

const mapStateToProps = function (state: $TSFixMe) {
    const allIndividualComponents = state.component.componentList.components.reduce(
        (acc: $TSFixMe, curr: $TSFixMe) => acc.concat(curr.components || []),
        []
    );
    const settings = state.profileSettings.profileSetting.data;
    const profilePic = settings ? settings.profilePic : '';
    const userName = settings ? settings.name : '';

    const currentProject = state.project.currentProject;
    const subProjects = state.subProject.subProjects.subProjects;
    const activeSubProjectId = state.subProject.activeSubProject;
    const allProjects = [...subProjects];
    if (currentProject) {
        allProjects.push(currentProject);
    }

    const activeProject = allProjects.find(
        project => String(project._id) === String(activeSubProjectId)
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
        activeSubProjectId: state.subProject.activeSubProject,
        activeProject,
    };
};

const mapDispatchToProps = function (dispatch: $TSFixMe) {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
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

// since sideNav is above page routes we have no access to the pages' props.match,
// we rebuild the routes here to enable access to these properties

const WrappedSideNav = (props: $TSFixMe) => {
    const hideProjectNav =
        props.currentProject?._id !== props.activeSubProjectId;

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
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'exact' does not exist on type '{ title: ... Remove this comment to see the full error message
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
    activeSubProjectId: PropTypes.string,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(WrappedSideNav)
);
