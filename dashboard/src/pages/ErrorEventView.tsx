import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import PropsType from 'prop-types';

import {
    fetchErrorTrackers,
    fetchErrorEvent,
    setCurrentErrorEvent,
} from '../actions/errorTracker';
import { fetchComponent } from '../actions/component';
import { bindActionCreators } from 'redux';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import ErrorEventDetail from '../components/errorTracker/ErrorEventDetail';
import { history } from '../store';
class ErrorEventView extends Component {
    componentDidMount() {
        this.ready();
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            String(prevProps.componentSlug) !==
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                String(this.props.componentSlug) ||
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            prevProps.currentProject !== this.props.currentProject
        ) {
            if (
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id &&
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                this.props.componentSlug
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
                this.props.fetchComponent(
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                    this.props.currentProject._id,
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
                    this.props.componentSlug
                );
            }
        }

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        if (String(prevProps.componentId) !== String(this.props.componentId)) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackers' does not exist on ty... Remove this comment to see the full error message
            this.props.fetchErrorTrackers(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerSkip' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.trackerSkip,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerLimit' does not exist on type 'Re... Remove this comment to see the full error message
                this.props.trackerLimit
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorEvent' does not exist on type ... Remove this comment to see the full error message
            this.props.fetchErrorEvent(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
                this.props.currentProject._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
                this.props.componentId,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
                this.props.errorTracker[0]._id,
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
                this.props.match.params.errorEventId
            );
        }
    }
    ready = () => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
        const componentId = this.props.componentId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
        const projectId = this.props.currentProject
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            ? this.props.currentProject._id
            : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
        const errorTrackerId = this.props.errorTracker
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            ? this.props.errorTracker[0]._id
            : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const errorEventId = this.props.match.params.errorEventId
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'match' does not exist on type 'Readonly<... Remove this comment to see the full error message
            ? this.props.match.params.errorEventId
            : null;
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchComponent' does not exist on type '... Remove this comment to see the full error message
            fetchComponent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerLimit' does not exist on type 'Re... Remove this comment to see the full error message
            trackerLimit,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'trackerSkip' does not exist on type 'Rea... Remove this comment to see the full error message
            trackerSkip,
        } = this.props;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }

        // fetching error trackers is necessary incase a reload is done on error event details page
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorTrackers' does not exist on ty... Remove this comment to see the full error message
        this.props.fetchErrorTrackers(
            projectId,
            componentId,
            trackerSkip,
            trackerLimit
        );

        // TODO fetch the current issues based on the limit and skip in the redux
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorEvent' does not exist on type ... Remove this comment to see the full error message
        this.props.fetchErrorEvent(
            projectId,
            componentId,
            errorTrackerId,
            errorEventId
        );
        setCurrentErrorEvent(errorEventId);
    };
    navigationLink = (errorEventId: $TSFixMe) => {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'setCurrentErrorEvent' does not exist on ... Remove this comment to see the full error message
            setCurrentErrorEvent,
        } = this.props;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fetchErrorEvent' does not exist on type ... Remove this comment to see the full error message
        this.props.fetchErrorEvent(
            currentProject._id,
            componentId,
            errorTracker[0]._id,
            errorEventId
        );
        setCurrentErrorEvent(errorEventId);
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/component/' +
                componentSlug +
                '/error-trackers/' +
                errorTracker[0].slug +
                '/events/' +
                errorEventId
        );
    };
    render() {
        const {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'location' does not exist on type 'Readon... Remove this comment to see the full error message
            location: { pathname },
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'component' does not exist on type 'Reado... Remove this comment to see the full error message
            component,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTracker' does not exist on type 'Re... Remove this comment to see the full error message
            errorTracker,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorEvent' does not exist on type 'Read... Remove this comment to see the full error message
            errorEvent,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentSlug' does not exist on type 'R... Remove this comment to see the full error message
            componentSlug,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'componentId' does not exist on type 'Rea... Remove this comment to see the full error message
            componentId,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentProject' does not exist on type '... Remove this comment to see the full error message
            currentProject,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'switchToProjectViewerNav' does not exist... Remove this comment to see the full error message
            switchToProjectViewerNav,
        } = this.props;

        const componentName = component ? component.name : '';
        const errorTrackerName =
            errorTracker.length > 0 ? errorTracker[0].name : null;
        const projectName = currentProject ? currentProject.name : '';
        const projectId = currentProject ? currentProject._id : '';
        return (
            <Fade>
                <BreadCrumbItem
                    route="/"
                    name={projectName}
                    projectId={projectId}
                    slug={currentProject ? currentProject.slug : null}
                    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ route: string; name: any; projectId: any; ... Remove this comment to see the full error message
                    switchToProjectViewerNav={switchToProjectViewerNav}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'error-tracker')}
                    name={componentName}
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'error-trackers')}
                    name="Error Tracking"
                />
                <BreadCrumbItem
                    route={getParentRoute(pathname, null, 'events')}
                    name={errorTrackerName}
                />
                <BreadCrumbItem
                    route={pathname}
                    name={
                        errorEvent &&
                        errorEvent.errorEvent &&
                        errorEvent.errorEvent.content
                            ? errorEvent.errorEvent.content.type
                            : ''
                    }
                    pageTitle="Error Tracking"
                    containerType="Error Tracker Container"
                />
                <ShouldRender if={!errorEvent}>
                    <LoadingState />
                </ShouldRender>
                <ShouldRender if={errorEvent}>
                    <div>
                        <ErrorEventDetail
                            errorEvent={errorEvent}
                            componentId={componentId}
                            componentSlug={componentSlug}
                            projectId={currentProject && currentProject._id}
                            errorTrackerId={
                                errorTracker[0] && errorTracker[0]._id
                            }
                            errorTrackerSlug={
                                errorTracker[0] && errorTracker[0].slug
                            }
                            navigationLink={this.navigationLink}
                        />
                    </div>
                </ShouldRender>
            </Fade>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'displayName' does not exist on type 'typ... Remove this comment to see the full error message
ErrorEventView.displayName = 'ErrorEventView';
const mapDispatchToProps = (dispatch: $TSFixMe) => {
    return bindActionCreators(
        {
            fetchErrorEvent,
            fetchErrorTrackers,
            fetchComponent,
            setCurrentErrorEvent,
        },
        dispatch
    );
};
const mapStateToProps = (state: $TSFixMe, ownProps: $TSFixMe) => {
    const {
        componentSlug,
        errorTrackerSlug,
        errorEventId,
    } = ownProps.match.params;
    const currentErrorEvent = state.errorTracker.currentErrorEvent;
    const currentErrorEventId =
        currentErrorEvent !== errorEventId ? errorEventId : currentErrorEvent;
    const currentProject = state.project.currentProject;
    const errorTracker = state.errorTracker.errorTrackersList.errorTrackers.filter(
        (errorTracker: $TSFixMe) => errorTracker.slug === errorTrackerSlug
    );
    let errorEvent = {};
    const errorEvents = state.errorTracker.errorEvents;
    if (errorEvents) {
        for (const errorEventKey in errorEvents) {
            if (
                errorEventKey === currentErrorEventId &&
                errorEvents[errorEventKey]
            ) {
                errorEvent = errorEvents[errorEventKey];
            }
        }
    }
    return {
        currentProject,
        component:
            state.component && state.component.currentComponent.component,
        componentSlug,
        errorTracker,
        componentId:
            state.component.currentComponent.component &&
            state.component.currentComponent.component._id,
        errorEvent,
        currentErrorEvent,
        switchToProjectViewerNav: state.project.switchToProjectViewerNav,
        trackerSkip: state.errorTracker.errorTrackersList.skip || 0,
        trackerLimit: state.errorTracker.errorTrackersList.limit || 5,
    };
};
// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
ErrorEventView.propTypes = {
    component: PropsType.object,
    currentProject: PropsType.object,
    location: PropsType.object,
    componentSlug: PropsType.string,
    componentId: PropsType.string,
    match: PropsType.object,
    fetchErrorEvent: PropsType.func,
    fetchComponent: PropsType.func,
    errorTracker: PropsType.array,
    fetchErrorTrackers: PropsType.func,
    errorEvent: PropsType.object,
    setCurrentErrorEvent: PropsType.func,
    switchToProjectViewerNav: PropsType.bool,
    trackerSkip: PropsType.number,
    trackerLimit: PropsType.number,
};
export default connect(mapStateToProps, mapDispatchToProps)(ErrorEventView);
