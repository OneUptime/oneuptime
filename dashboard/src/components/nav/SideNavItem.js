import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { Link, withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { loadPage } from '../../actions/page';
import { navKeyBind, cleanBind } from '../../utils/keybinding';
import { animateSidebar } from '../../actions/animateSidebar';
import { history } from '../../store';
import { toggleProjectSettingsMore } from '../../actions/page';

export class SidebarNavItem extends Component {
    constructor(props) {
        super(props);
        this.RenderListItems = this.RenderListItems.bind(this);
    }

    componentDidMount() {
        const { route } = this.props;
        const path = this.mainRoute();

        navKeyBind(route, path);

        route.subRoutes.map(subRoute => {
            const link = this.subRoute(subRoute);

            navKeyBind(subRoute, link);
            return subRoute;
        });
    }

    componentWillUnmount() {
        const { route } = this.props;
        const path = this.mainRoute();

        cleanBind(route, path);

        route.subRoutes.map(subRoute => {
            const link = this.subRoute(subRoute);

            cleanBind(subRoute, link);
            return subRoute;
        });
    }

    mainRoute = () => {
        const { match, currentProject, route } = this.props;
        return route.path
            .replace(
                ':projectId',
                match.params.projectId || (currentProject || {})._id
            )
            .replace(':subProjectId', match.params.subProjectId)
            .replace(':componentId', match.params.componentId)
            .replace(':monitorId', match.params.monitorId)
            .replace(':applicationLogId', match.params.applicationLogId)
            .replace(':errorTrackerId', match.params.errorTrackerId);
    };
    handleShowMore = () => {
        this.props.toggleProjectSettingsMore(!this.props.toggleMoreBtn);
    };
    subRoute = subRoute => {
        const { match, currentProject } = this.props;
        const subRoutePath = subRoute.path
            .replace(
                ':projectId',
                match.params.projectId || (currentProject || {})._id
            )
            .replace(':componentId', match.params.componentId)
            .replace(/:issueId/, match.params.issueId)
            .replace(/:scheduleId/, match.params.scheduleId)
            .replace(/:incidentId/, match.params.incidentId)
            .replace(/:monitorId/, match.params.monitorId);
        const projectSettingsSubRoutes =
            subRoute.title === 'Monitor' ||
            subRoute.title === 'Incident Settings' ||
            subRoute.title === 'Email' ||
            subRoute.title === 'SMS & Calls' ||
            subRoute.title === 'Call Routing' ||
            subRoute.title === 'Webhooks' ||
            subRoute.title === 'Probe' ||
            subRoute.title === 'Git Credentials' ||
            subRoute.title === 'Docker Credentials' ||
            subRoute.title === 'Resources';
        if (projectSettingsSubRoutes) {
            if (match.url === subRoutePath) {
                this.props.toggleProjectSettingsMore(true);
            }
        } else {
            this.props.toggleProjectSettingsMore(false);
        }
        return subRoutePath;
    };

    camalize = function camalize(str) {
        return str
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase());
    };

    render() {
        const { RenderListItems } = this;
        const {
            route,
            location,
            schedule,
            match,
            currentProject,
            loadPage,
            toggleMoreBtn,
        } = this.props;
        const path = route.path
            .replace(
                ':projectId',
                match.params.projectId || (currentProject || {})._id
            )
            .replace(':subProjectId', match.params.subProjectId)
            .replace(':componentId', match.params.componentId)
            .replace(':monitorId', match.params.monitorId)
            .replace(':applicationLogId', match.params.applicationLogId)
            .replace(':errorTrackerId', match.params.errorTrackerId);
        const isLinkActive =
            location.pathname === path ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/subProject\/([0-9]|[a-z])*\/status-page\/([0-9]|[a-z])*/
            ) &&
                route.title === 'Status Pages') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/subProject\/([0-9]|[a-z])*\/schedule\/([0-9]|[a-z])*/
            ) &&
                route.title === 'On-Call Duty') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/monitors\/([0-9]|[a-z])*/
            ) &&
                route.title === 'Monitors') ||
            (location.pathname.match(/project\/([0-9]|[a-z])*\/components*/) &&
                route.title === 'Components') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/monitoring*/
            ) &&
                route.title === 'Monitors') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/incidents\/([0-9]|[a-z])*/
            ) &&
                route.title === 'Incident Log') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/application-log*/
            ) &&
                route.title === 'Logs') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security/
            ) &&
                route.title === 'Security') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/scheduledEvents/
            ) &&
                route.title === 'Component Settings') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/settings\/basic/
            ) &&
                route.title === 'Scheduled Maintenance') ||
            (location.pathname.match(/project\/([0-9]|[a-z])*\/consulting/) &&
                route.title === 'Consulting & Services') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/error-track*/
            ) &&
                route.title === 'Error Tracking');

        const isChildLinkActive = route.subRoutes.some(link => {
            let newPath = link.path.replace(
                /:projectId/,
                match.params.projectId
            );
            newPath = newPath.replace(/:issueId/, match.params.issueId);
            newPath = newPath.replace(/:scheduleId/, match.params.scheduleId);
            newPath = newPath.replace(/:incidentId/, match.params.incidentId);
            newPath = newPath.replace(/:monitorId/, match.params.monitorId);
            newPath = newPath.replace(/:componentId/, match.params.componentId);
            newPath = newPath.replace(
                /:applicationLogId/,
                match.params.applicationLogId
            );
            newPath = newPath.replace(
                /:errorTrackerId/,
                match.params.errorTrackerId
            );

            const response =
                newPath === match.url
                    ? true
                    : (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/incidents\/([0-9]|[a-z])*/
                      ) &&
                          link.title === 'Incident') ||
                      (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security\/container/
                      ) &&
                          link.title === 'Container') ||
                      (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security\/application/
                      ) &&
                          link.title === 'Application') ||
                      (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security\/application\/([0-9]|[a-z])*/
                      ) &&
                          link.title === 'Application Detail') ||
                      (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security\/container\/([0-9]|[a-z])*/
                      ) &&
                          link.title === 'Container Detail') ||
                      (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/settings\/advanced/
                      ) &&
                          link.title === 'Advanced') ||
                      (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/settings\/basic/
                      ) &&
                          link.title === 'Basic')
                    ? true
                    : false;
            return response;
        });

        const isSubLinkActive = route.subRoutes.some(link =>
            link.title === 'Status Page' &&
            location.pathname.match(
                /project\/([0-9]|[a-z])*\/sub-project\/([0-9]|[a-z])*\/status-page\/([0-9]|[a-z])*/
            )
                ? true
                : false
        );
        const isScheduleLinkActive = route.subRoutes.some(link =>
            link.title === 'Schedule' &&
            location.pathname.match(
                /project\/([0-9]|[a-z])*\/sub-project\/([0-9]|[a-z])*\/schedule\/([0-9]|[a-z])*/
            )
                ? true
                : false
        );

        const routeStyle = {
            position: 'relative',
            marginBottom: route.title === 'Back to Dashboard' ? '10px' : '',
            marginTop:
                route.title === 'Back to Dashboard'
                    ? '20px'
                    : route.title === 'Component Settings'
                    ? '10px'
                    : 0,
        };

        const routes = route.shortcut && route.shortcut.split('+');

        return (
            <div style={routeStyle}>
                <ShouldRender if={!route.invisible}>
                    <span
                        id={this.camalize(route.title)}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                            this.props.toggleProjectSettingsMore(false);
                            if (route.title === 'Back to Dashboard') {
                                this.props.animateSidebar(true);
                                setTimeout(() => {
                                    loadPage(route.title);
                                    this.props.animateSidebar(false);
                                    history.push(path);
                                }, 200);
                            } else {
                                loadPage(route.title);
                                history.push(path);
                            }
                        }}
                        {...(route.disabled
                            ? { style: { pointerEvents: 'none' } }
                            : {})}
                    >
                        <div style={{ outline: 'none' }}>
                            <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--4">
                                <div className="Box-root Flex-flex Flex-alignItems--center tooltip">
                                    {route.icon ? (
                                        <div className="Box-root Flex-flex Flex-alignItems--center Margin-right--12">
                                            <span
                                                className={`db-SideNav-icon db-SideNav-icon--${
                                                    route.icon
                                                } ${
                                                    isLinkActive ||
                                                    isSubLinkActive ||
                                                    isScheduleLinkActive
                                                        ? 'db-SideNav-icon--selected'
                                                        : null
                                                }`}
                                            />
                                        </div>
                                    ) : null}
                                    <span
                                        className={
                                            'Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap' +
                                            (isLinkActive ||
                                            isSubLinkActive ||
                                            isScheduleLinkActive
                                                ? ' Text-color--fyipeblue Text-fontWeight--bold'
                                                : ' Text-color--dark')
                                        }
                                    >
                                        <span
                                            id={`${route.title.replace(
                                                ' ',
                                                ''
                                            )}-text`}
                                            style={route.textStyle}
                                        >
                                            {route.title === 'Incident Log'
                                                ? 'Incidents'
                                                : route.title}
                                        </span>
                                    </span>
                                    {route.shortcut && (
                                        <span className="tooltiptext">
                                            <strong>{routes[0]}</strong>
                                            <span> then </span>
                                            <strong>{routes[1]}</strong>
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </span>
                </ShouldRender>
                <div>
                    <span>
                        <ShouldRender
                            if={
                                (isLinkActive && route.subRoutes.length) ||
                                isChildLinkActive
                            }
                        >
                            <RenderListItems
                                projectId={match.params.projectId}
                                schedule={schedule}
                                active={match.url}
                                onLoad={title => loadPage(title)}
                                componentId={match.params.componentId}
                                showMore={toggleMoreBtn}
                                handleShowMore={
                                    this.props.toggleProjectSettingsMore
                                }
                            />
                        </ShouldRender>
                    </span>
                </div>
            </div>
        );
    }

    RenderListItems({
        projectId,
        schedule,
        active,
        onLoad,
        componentId,
        showMore,
        handleShowMore,
    }) {
        return this.props.route.subRoutes.map((child, index) => {
            const removedLinks = [
                'Schedule',
                'Incident',
                'Monitor View',
                'Website Issues',
                'Component View',
                'Log Container View',
                'Status Page',
                'Application Detail',
                'Container Detail',
                'Team Member Profile',
                'Scheduled Event Detail',
                'Error Tracking View',
                'Error Tracking Detail View',
            ];
            const moreRoutes =
                child.title === 'Monitor' ||
                child.title === 'Incident Settings' ||
                child.title === 'Email' ||
                child.title === 'SMS & Calls' ||
                child.title === 'Call Routing' ||
                child.title === 'Webhooks' ||
                child.title === 'Probe' ||
                child.title === 'Git Credentials' ||
                child.title === 'Docker Credentials' ||
                child.title === 'Resources';
            if (removedLinks.some(link => link === child.title)) return null;

            if (child.visible) {
                let link = child.path
                    .replace(':projectId', projectId)
                    .replace(':componentId', componentId);
                link =
                    schedule && schedule._id
                        ? link.replace(':scheduleId', schedule._id)
                        : link;
                const incidentLogLink = active.match(
                    /project\/([0-9]|[a-z])*\/incidents\/([0-9]|[a-z])*/
                )
                    ? active
                    : false;

                const applicationDetailLink = active.match(
                    /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security\/application*/
                )
                    ? active
                    : false;
                const containerDetailLink = active.match(
                    /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security\/container*/
                )
                    ? active
                    : false;
                const scheduledEventDetailLink = active.match(
                    /project\/([0-9]|[a-z])*\/scheduledEvents\/([0-9]|[a-z])*/
                )
                    ? active
                    : false;

                const isSubrouteActive =
                    child.title === 'Application'
                        ? applicationDetailLink === active
                            ? true
                            : false
                        : child.title === 'Container'
                        ? containerDetailLink === active
                            ? true
                            : false
                        : child.title === 'Scheduled Event Detail' &&
                          scheduledEventDetailLink === active
                        ? true
                        : false;

                const routes = child.shortcut && child.shortcut.split('+');
                if (child.title === 'More') {
                    return (
                        <ul key={`nav ${index}`}>
                            <li id={this.camalize(child.title)}>
                                <div
                                    style={{
                                        position: 'relative',
                                        cursor: 'pointer',
                                    }}
                                    onClick={() => handleShowMore(!showMore)}
                                >
                                    <div style={{ outline: 'none' }}>
                                        <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--2">
                                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-left--32 tooltip">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span
                                                        className={
                                                            showMore
                                                                ? 'Text-color--fyipeblue Text-fontWeight--bold'
                                                                : ''
                                                        }
                                                    >
                                                        {child.title}
                                                    </span>
                                                </span>
                                                <div className="Box-root Margin-left--8">
                                                    {showMore ? (
                                                        <div className="db-AccountSwitcherX-chevron"></div>
                                                    ) : (
                                                        <div className="more-btn-chevron-right"></div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="db-SideNav-item--root">
                                        <span></span>
                                    </div>
                                </div>
                            </li>
                        </ul>
                    );
                } else {
                    if (!showMore && moreRoutes) {
                        return null;
                    }
                    return (
                        <ul key={`nav ${index}`}>
                            <li id={this.camalize(child.title)}>
                                <div style={{ position: 'relative' }}>
                                    <Link
                                        to={link}
                                        onClick={() => {
                                            !moreRoutes &&
                                                handleShowMore(false);
                                            onLoad(child.title);
                                        }}
                                    >
                                        <div style={{ outline: 'none' }}>
                                            <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--2">
                                                <div
                                                    className="Box-root Flex-flex Flex-alignItems--center Padding-left--32 tooltip"
                                                    style={{
                                                        paddingLeft: moreRoutes
                                                            ? '40px'
                                                            : '32',
                                                    }}
                                                >
                                                    <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                        <span
                                                            className={
                                                                link ===
                                                                    active ||
                                                                incidentLogLink ===
                                                                    active ||
                                                                isSubrouteActive
                                                                    ? 'Text-color--fyipeblue Text-fontWeight--bold'
                                                                    : ''
                                                            }
                                                        >
                                                            {child.title ===
                                                            'Incident Settings'
                                                                ? 'Incidents'
                                                                : child.title}
                                                        </span>
                                                    </span>
                                                    {child.shortcut && (
                                                        <span className="tooltiptext">
                                                            <strong>
                                                                {routes[0]}
                                                            </strong>
                                                            <span> then </span>
                                                            <strong>
                                                                {routes[1]}
                                                            </strong>
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </Link>
                                    <div className="db-SideNav-item--root">
                                        <span></span>
                                    </div>
                                </div>
                            </li>
                        </ul>
                    );
                }
            } else {
                return null;
            }
        });
    }
}

SidebarNavItem.displayName = 'SidebarNavItem';

const mapStateToProps = state => ({
    component: state.component,
    currentProject: state.project.currentProject,
    schedule:
        state.schedule &&
        state.schedule.schedules &&
        state.schedule.schedules.data &&
        state.schedule.schedules.data[0],
    toggleMoreBtn: state.page.toggleProjectSettingsMore,
});

const mapDispatchToProps = dispatch =>
    bindActionCreators(
        { loadPage, animateSidebar, toggleProjectSettingsMore },
        dispatch
    );

SidebarNavItem.propTypes = {
    match: PropTypes.object.isRequired,
    location: PropTypes.object.isRequired,
    route: PropTypes.object.isRequired,
    schedule: PropTypes.oneOfType([
        PropTypes.object,
        PropTypes.oneOf([null, undefined]),
    ]),
    currentProject: PropTypes.object,
    component: PropTypes.object, // eslint-disable-line
    loadPage: PropTypes.func.isRequired,
    animateSidebar: PropTypes.func,
    toggleProjectSettingsMore: PropTypes.func.isRequired,
    closeMoreRoute: PropTypes.func.isRequired,
    toggleMoreBtn: PropTypes.bool.isRequired,
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(SidebarNavItem)
);
