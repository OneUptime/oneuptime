import React, { Component } from 'react';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
import { fetchAlert, fetchProjectAlert } from '../actions/alert';
import PropTypes from 'prop-types';
import AlertProjectBox from '../components/alert/AlertProjectBox';
import RenderIfUserInSubProject from '../components/basic/RenderIfUserInSubProject';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';

import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
import { LoadingState } from '../components/basic/Loader';
import ShouldRender from '../components/basic/ShouldRender';

class AlertLog extends Component {
    constructor(props: $TSFixMe) {
        super(props);
        this.state = {};
    }
    componentDidMount() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (this.props?.activeProjectId) {
            this.ready();
        }
    }

    componentDidUpdate(prevProps: $TSFixMe) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
        if (prevProps?.activeProjectId !== this.props?.activeProjectId) {
            this.ready();
        }
    }

    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchAlert' does not exist on type 'Read... Remove this comment to see the full error message
        this.props.fetchAlert(this.props.activeProjectId);
    };

    prevClicked = (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectAlert' does not exist on typ... Remove this comment to see the full error message
        this.props.fetchProjectAlert(
            projectId,
            (skip || 0) > (limit || 10) ? skip - limit : 0,
            10
        );
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        this.setState({ [projectId]: this.state[projectId] - 1 });
    };

    nextClicked = (projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchProjectAlert' does not exist on typ... Remove this comment to see the full error message
        this.props.fetchProjectAlert(projectId, skip + limit, 10);
        this.setState({
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            [projectId]: !this.state[projectId] ? 2 : this.state[projectId] + 1,
        });
    };

    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subProjects' does not exist on type 'Rea... Remove this comment to see the full error message
            subProjects,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
            isRequesting,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'error' does not exist on type 'Readonly<... Remove this comment to see the full error message
            error,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'activeProjectId' does not exist on type ... Remove this comment to see the full error message
            activeProjectId,
        } = this.props;

        // Add Project Alerts to All Alerts List
        let projectAlert =
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.alerts.data &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.alerts.data.length > 0 &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.alerts.data.find(
                (projectAlert: $TSFixMe) => projectAlert._id === activeProjectId
            );
        if (
            projectAlert &&
            projectAlert.count &&
            typeof projectAlert.count === 'string'
        ) {
            projectAlert.count = parseInt(projectAlert.count, 10);
        }
        if (
            projectAlert &&
            projectAlert.skip &&
            typeof projectAlert.skip === 'string'
        ) {
            projectAlert.skip = parseInt(projectAlert.skip, 10);
        }
        if (
            projectAlert &&
            projectAlert.limit &&
            typeof projectAlert.limit === 'string'
        ) {
            projectAlert.limit = parseInt(projectAlert.limit, 10);
        }
        let canNext =
            projectAlert &&
                projectAlert.count &&
                projectAlert.count > projectAlert.skip + projectAlert.limit
                ? true
                : false;
        let canPrev = projectAlert && projectAlert.skip <= 0 ? false : true;

        if (
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
            this.props.alerts &&
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'alerts' does not exist on type 'Readonly... Remove this comment to see the full error message
            (this.props.alerts.requesting || !this.props.alerts.data)
        ) {
            canNext = false;
            canPrev = false;
        }

        const subProjectName =
            subProjects.find((obj: $TSFixMe) => obj._id === activeProjectId)?.name ||
            currentProject.name;
        projectAlert =
            projectAlert && projectAlert.alerts ? (
                <RenderIfUserInSubProject
                    subProjectId={projectAlert._id}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '() => any' is not assignable to type 'Key | ... Remove this comment to see the full error message
                    key={() => uuidv4()}
                >
                    <div className="bs-BIM">
                        <div className="Box-root Margin-bottom--12">
                            <div className="bs-ContentSection Card-root Card-shadow--medium">
                                <AlertProjectBox
                                    subProjectAlert={projectAlert}
                                    subProjectName={subProjectName}
                                    showProjectName={
                                        currentProject?._id !== activeProjectId
                                    }
                                    currentProjectId={activeProjectId}
                                    prevClicked={this.prevClicked}
                                    nextClicked={this.nextClicked}
                                    canNext={canNext}
                                    canPrev={canPrev}
                                    isRequesting={isRequesting}
                                    error={error}
                                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ subProjectAlert: any; subProjectName: any;... Remove this comment to see the full error message
                                    subProjects={subProjects}
                                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                                    pages={this.state[activeProjectId]}
                                />
                            </div>
                        </div>
                    </div>
                </RenderIfUserInSubProject>
            ) : (
                false
            );
        const allAlerts = projectAlert && [projectAlert];
        const projectName = currentProject ? currentProject.name : '';
        const projectId = activeProjectId;
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId || ''}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
                    route={getParentRoute(pathname)}
                    name="On-Call Duty"
                />
                <BreadCrumbItem route={pathname} name="Alert Log" />
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                <ShouldRender if={!this.props.isRequesting}>
                    <div className="Box-root">
                        <div>
                            <div>
                                <div
                                    id="alertLogPage"
                                    className="Margin-vertical--12"
                                >
                                    {allAlerts}
                                </div>
                            </div>
                        </div>
                    </div>
                </ShouldRender>
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequesting' does not exist on type 'Re... Remove this comment to see the full error message
                <ShouldRender if={this.props.isRequesting}>
                    <LoadingState />
                </ShouldRender>
            </Fade>
        );
    }
}

const mapDispatchToProps = (dispatch: $TSFixMe) => bindActionCreators({ fetchAlert, fetchProjectAlert }, dispatch);

const mapStateToProps = (state: $TSFixMe) => {
    let subProjects = state.subProject.subProjects.subProjects;

    // sort subprojects names for display in alphabetical order
    const subProjectNames =
        subProjects && subProjects.map((subProject: $TSFixMe) => subProject.name);
    subProjectNames && subProjectNames.sort();
    subProjects =
        subProjectNames &&
        subProjectNames.map((name: $TSFixMe) => subProjects.find((subProject: $TSFixMe) => subProject.name === name)
        );
    return {
        alerts: state.alert.alerts,
        isRequesting: state.alert.alerts.requesting,
        error: state.alert.alerts.error,
        currentProject: state.project.currentProject,
        subProjects,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        activeProjectId: state.subProject.activeSubProject,
    };
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
AlertLog.propTypes = {
    fetchAlert: PropTypes.func,
    fetchProjectAlert: PropTypes.func,
    currentProject: PropTypes.object.isRequired,
    alerts: PropTypes.object,
    error: PropTypes.object,
    isRequesting: PropTypes.bool,
    subProjects: PropTypes.array.isRequired,
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
    switchToProjectViewerNav: PropTypes.bool,
    activeProjectId: PropTypes.string,
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
AlertLog.displayName = 'AlertLog';

export default connect(mapStateToProps, mapDispatchToProps)(AlertLog);
