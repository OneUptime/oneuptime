import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import getParentRoute from '../utils/getParentRoute';

import { Fade } from 'react-awesome-reveal';
import { connect } from 'react-redux';

import {
    fetchErrorTrackers,
    fetchErrorEvent,
    setCurrentErrorEvent,
} from '../actions/errorTracker';
import { fetchComponent } from '../actions/component';
import { bindActionCreators, Dispatch } from 'redux';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import ErrorEventDetail from '../components/errorTracker/ErrorEventDetail';
import { history } from '../store';

interface ErrorEventViewProps {
    component?: object;
    currentProject?: object;
    location?: object;
    componentSlug?: string;
    componentId?: string;
    match?: object;
    fetchErrorEvent?: Function;
    fetchComponent?: Function;
    errorTracker?: unknown[];
    fetchErrorTrackers?: Function;
    errorEvent?: object;
    setCurrentErrorEvent?: Function;
    switchToProjectViewerNav?: boolean;
    trackerSkip?: number;
    trackerLimit?: number;
}

class ErrorEventView extends Component<ErrorEventViewProps> {
    componentDidMount() {
        this.ready();
    }
    componentDidUpdate(prevProps: $TSFixMe) {
        if (
            String(prevProps.componentSlug) !==

            String(this.props.componentSlug) ||

            prevProps.currentProject !== this.props.currentProject
        ) {
            if (

                this.props.currentProject &&

                this.props.currentProject._id &&

                this.props.componentSlug
            ) {

                this.props.fetchComponent(

                    this.props.currentProject._id,

                    this.props.componentSlug
                );
            }
        }


        if (String(prevProps.componentId) !== String(this.props.componentId)) {

            this.props.fetchErrorTrackers(

                this.props.currentProject._id,

                this.props.componentId,

                this.props.trackerSkip,

                this.props.trackerLimit
            );

            this.props.fetchErrorEvent(

                this.props.currentProject._id,

                this.props.componentId,

                this.props.errorTracker[0]._id,

                this.props.match.params.errorEventId
            );
        }
    }
    ready = () => {

        const componentId = this.props.componentId;

        const projectId = this.props.currentProject

            ? this.props.currentProject._id
            : null;

        const errorTrackerId = this.props.errorTracker

            ? this.props.errorTracker[0]._id
            : null;

        const errorEventId = this.props.match.params.errorEventId

            ? this.props.match.params.errorEventId
            : null;
        const {

            componentSlug,

            fetchComponent,

            trackerLimit,

            trackerSkip,
        } = this.props;
        if (projectId && componentSlug) {
            fetchComponent(projectId, componentSlug);
        }

        // fetching error trackers is necessary incase a reload is done on error event details page

        this.props.fetchErrorTrackers(
            projectId,
            componentId,
            trackerSkip,
            trackerLimit
        );

        // TODO fetch the current issues based on the limit and skip in the redux

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

            currentProject,

            errorTracker,

            componentId,

            componentSlug,

            setCurrentErrorEvent,
        } = this.props;

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

            location: { pathname },

            component,

            errorTracker,

            errorEvent,

            componentSlug,

            componentId,

            currentProject,

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


ErrorEventView.displayName = 'ErrorEventView';
const mapDispatchToProps = (dispatch: Dispatch) => {
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
