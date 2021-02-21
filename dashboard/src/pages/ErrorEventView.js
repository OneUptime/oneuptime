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
    ready = () => {
        const componentId = this.props.match.params.componentId
            ? this.props.match.params.componentId
            : null;
        const projectId = this.props.currentProject
            ? this.props.currentProject._id
            : null;
        const errorTrackerId = this.props.match.params.errorTrackerId
            ? this.props.match.params.errorTrackerId
            : null;
        const errorEventId = this.props.match.params.errorEventId
            ? this.props.match.params.errorEventId
            : null;

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
            component,
            errorTracker,
            setCurrentErrorEvent,
        } = this.props;
        this.props.fetchErrorEvent(
            currentProject._id,
            component._id,
            errorTracker[0]._id,
            errorEventId
        );
        setCurrentErrorEvent(errorEventId);
        history.push(
            '/dashboard/project/' +
                currentProject.slug +
                '/' +
                component._id +
                '/error-trackers/' +
                errorTracker[0]._id +
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
                                componentId={component && component._id}
                                projectId={currentProject && currentProject._id}
                                errorTrackerId={
                                    errorTracker[0] && errorTracker[0]._id
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
            setCurrentErrorEvent,
        },
        dispatch
    );
};
const mapStateToProps = (state, ownProps) => {
    const { componentId, errorTrackerId, errorEventId } = ownProps.match.params;
    const currentErrorEvent = state.errorTracker.currentErrorEvent;
    const currentErrorEventId =
        currentErrorEvent !== errorEventId ? errorEventId : currentErrorEvent;
    const currentProject = state.project.currentProject;
    let component;
    state.component.componentList.components.forEach(item => {
        item.components.forEach(c => {
            if (String(c._id) === String(componentId)) {
                component = c;
            }
        });
    });
    const errorTracker = state.errorTracker.errorTrackersList.errorTrackers.filter(
        errorTracker => errorTracker._id === errorTrackerId
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
        component,
        errorTracker,
        errorEvent,
        currentErrorEvent,
    };
};
ErrorEventView.propTypes = {
    component: PropsType.object,
    currentProject: PropsType.object,
    location: PropsType.object,
    match: PropsType.object,
    fetchErrorEvent: PropsType.func,
    errorTracker: PropsType.array,
    fetchErrorTrackers: PropsType.func,
    errorEvent: PropsType.object,
    setCurrentErrorEvent: PropsType.func,
};
export default connect(mapStateToProps, mapDispatchToProps)(ErrorEventView);
