import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import PropTypes from 'prop-types';
import { Link, withRouter } from 'react-router-dom';
import { connect } from 'react-redux';
import ShouldRender from '../basic/ShouldRender';
import { loadPage } from '../../actions/page';

export class SidebarNavItem extends Component {
    constructor(props) {
        super(props);

        this.RenderListItems = this.RenderListItems.bind(this);
    }

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
        } = this.props;
        const path = route.path
            .replace(
                ':projectId',
                match.params.projectId || (currentProject || {})._id
            )
            .replace(':subProjectId', match.params.subProjectId)
            .replace(':componentId', match.params.componentId)
            .replace(':monitorId', match.params.monitorId);

        const isLinkActive =
            location.pathname === path ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/subProject\/([0-9]|[a-z])*\/status-page\/([0-9]|[a-z])*/
            ) &&
                route.title === 'Status Pages') ||
            (location.pathname.match(
                /project\/([0-9]|[a-z])*\/subProject\/([0-9]|[a-z])*\/schedule\/([0-9]|[a-z])*/
            ) &&
                route.title === 'Call Schedules') ||
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
                /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security/
            ) &&
                route.title === 'Security');

        const isChildLinkActive = route.subRoutes.some(link => {
            let newPath = link.path.replace(
                /:projectId/,
                match.params.projectId
            );
            newPath = newPath.replace(/:scheduleId/, match.params.scheduleId);
            newPath = newPath.replace(/:incidentId/, match.params.incidentId);
            newPath = newPath.replace(/:monitorId/, match.params.monitorId);
            newPath = newPath.replace(/:componentId/, match.params.componentId);

            const response =
                newPath === match.url
                    ? true
                    : (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/incidents\/([0-9]|[a-z])*/
                      ) &&
                          link.title === 'Incident Log') ||
                      (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security\/container*/
                      ) &&
                          link.title === 'Container') ||
                      (location.pathname.match(
                          /project\/([0-9]|[a-z])*\/([0-9]|[a-z])*\/security\/application*/
                      ) &&
                          link.title === 'Application')
                    ? true
                    : false;
            return response;
        });

        const routeStyle = {
            position: 'relative',
        };

        return (
            <div id={this.camalize(route.title)} style={routeStyle}>
                <ShouldRender if={!route.invisible}>
                    <Link
                        to={path}
                        onClick={() => loadPage(route.title)}
                        {...(route.disabled
                            ? { style: { pointerEvents: 'none' } }
                            : {})}
                    >
                        <div style={{ outline: 'none' }}>
                            <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--4">
                                <div className="Box-root Flex-flex Flex-alignItems--center">
                                    {route.icon ? (
                                        <div className="Box-root Flex-flex Flex-alignItems--center Margin-right--12">
                                            <span
                                                className={`db-SideNav-icon db-SideNav-icon--${
                                                    route.icon
                                                } ${
                                                    isLinkActive
                                                        ? 'db-SideNav-icon--selected'
                                                        : null
                                                }`}
                                            />
                                        </div>
                                    ) : null}
                                    <span
                                        className={
                                            'Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap' +
                                            (isLinkActive
                                                ? ' Text-color--fyipeblue Text-fontWeight--bold'
                                                : ' Text-color--dark')
                                        }
                                    >
                                        <span style={route.textStyle}>
                                            {route.title}
                                        </span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </Link>
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
                            />
                        </ShouldRender>
                    </span>
                </div>
            </div>
        );
    }

    RenderListItems({ projectId, schedule, active, onLoad, componentId }) {
        return this.props.route.subRoutes.map((child, index) => {
            const removedLinks = [
                'Schedule',
                'Incident',
                'Monitor View',
                'Component View',
                'Status Page',
                'Application Detail',
                'Container Detail',
            ];

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

                return (
                    <ul key={`nav ${index}`}>
                        <li id={this.camalize(child.title)}>
                            <div style={{ position: 'relative' }}>
                                <Link
                                    to={link}
                                    onClick={() => onLoad(child.title)}
                                >
                                    <div style={{ outline: 'none' }}>
                                        <div className="NavItem Box-root Box-background--surface Box-divider--surface-bottom-1 Padding-horizontal--4 Padding-vertical--2">
                                            <div className="Box-root Flex-flex Flex-alignItems--center Padding-left--32">
                                                <span className="Text-color--default Text-display--inline Text-fontSize--14 Text-fontWeight--regular Text-lineHeight--20 Text-typeface--base Text-wrap--wrap">
                                                    <span
                                                        className={
                                                            link === active ||
                                                            incidentLogLink ===
                                                                active
                                                                ? 'Text-color--fyipeblue Text-fontWeight--bold'
                                                                : ''
                                                        }
                                                    >
                                                        {child.title}
                                                    </span>
                                                </span>
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
});

const mapDispatchToProps = dispatch =>
    bindActionCreators({ loadPage }, dispatch);

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
};

export default withRouter(
    connect(mapStateToProps, mapDispatchToProps)(SidebarNavItem)
);
