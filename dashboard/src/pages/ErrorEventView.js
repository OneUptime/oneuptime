import React, { Component } from 'react';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import Dashboard from '../components/Dashboard';
import getParentRoute from '../utils/getParentRoute';
import Fade from 'react-reveal/Fade';
import { connect } from 'react-redux';
import PropsType from 'prop-types';
import { SHOULD_LOG_ANALYTICS } from '../config';
import { logEvent } from '../analytics';
import {
    fetchErrorTrackers,
    fetchErrorEvent,
    setCurrentErrorEvent,
} from '../actions/errorTracker';
import {
    fetchComponent,
} from '../actions/component';
import { bindActionCreators } from 'redux';
import ShouldRender from '../components/basic/ShouldRender';
import { LoadingState } from '../components/basic/Loader';
import ErrorEventDetail from '../components/errorTracker/ErrorEventDetail';
import { history } from '../store';
class ErrorEventView extends Component {
    componentDidMount() {
        if (SHOULD_LOG_ANALYTICS) {
            logEvent(
                'PAGE VIEW: DASHBOARD > PROJECT > COMPONENT > ERROR TRACKING >  ERROR TRACKING DETAIL > ERROR TRACKING ISSUE DETAIL PAGE'
            );
        }
    }
    componentDidUpdate(prevProps) {
        if (
            String(prevProps.componentSlug) !== String(this.props.componentSlug)
        ) {
            this.props.fetchComponent(this.props.componentSlug);
        }

        if (String(prevProps.componentId) !== String(this.props.componentId)) {
            this.props.fetchErrorTrackers(
                this.props.currentProject._id,
                this.props.componentId
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
        const { componentSlug, fetchComponent } = this.props;
        fetchComponent(componentSlug);

        // fetching error trackers is necessary incase a reload is done on error event details page
        this.props.fetchErrorTrackers(projectId, componentId);

        // TODO fetch the current issues based on the limit and skip in the redux
        this.props.fetchErrorEvent(
            projectId,
            componentId,
            errorTrackerId,
            errorEventId
        );
        setCurrentErrorEvent(errorEventId);
    };
    navigationLink = errorEventId => {
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
                '/' +
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
        } = this.props;

        const componentName = component ? component.name : '';
        const errorTrackerName =
            errorTracker.length > 0 ? errorTracker[0].name : null;
        return (
            <Dashboard ready={this.ready}>
                <Fade>
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
            </Dashboard>
        );
    }
}

ErrorEventView.displayName = 'ErrorEventView';
const mapDispatchToProps = dispatch => {
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
const mapStateToProps = (state, ownProps) => {
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
        errorTracker => errorTracker.slug === errorTrackerSlug
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
};
export default connect(mapStateToProps, mapDispatchToProps)(ErrorEventView);
